import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assemble } from '../src/assembler.js';
import { MiniCPU } from '../src/cpu.js';
import { validateDisplay, pixelValue } from '../src/display.js';
import { formatSource } from '../src/format.js';
import { build } from '../src/build.js';

const dir = new URL('../examples/', import.meta.url);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.asm')).sort();
const load = name => assemble(fs.readFileSync(new URL(name, dir), 'utf8'));
const run = (name, limit = 3_000_000) => {
  const asm = load(name);
  const cpu = new MiniCPU(asm.memory, asm.architecture, { historySize: 1 });
  while (!cpu.halted && cpu.instructions < limit) cpu.step();
  return { asm, cpu };
};
const screen = ({ asm, cpu }) => {
  const c = validateDisplay(asm.display, cpu.memory.length), out = [];
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) out.push(pixelValue(cpu.memory, c, x, y));
  return out;
};
const codeUnchanged = ({ asm, cpu }, end = asm.loadedBytes) =>
  assert.deepEqual(Array.from(cpu.memory.slice(0, end)), Array.from(asm.memory.slice(0, end)));

test('every example assembles without warnings and fits its screen into RAM', () => {
  assert.ok(files.length >= 12);
  for (const name of files) {
    const asm = load(name);
    assert.deepEqual(asm.warnings, [], name);
    if (asm.display) validateDisplay(asm.display, asm.memory.length);
    const source = fs.readFileSync(new URL(name, dir), 'utf8');
    assert.match(source, /^; [A-Z]/, `${name} starts with a title comment`);
    assert.equal(formatSource(source), source, `${name} is formatted`);
  }
});

test('arithmetic examples compute what their comments promise', () => {
  assert.equal(run('01-add.asm').cpu.registers[0], 8);
  assert.deepEqual(Array.from(run('02-loop.asm').cpu.registers).slice(0, 2), [0, 15]);
  assert.deepEqual(Array.from(run('03-division.asm').cpu.registers).slice(2), [3, 1]);
  const memory = run('04-memory.asm').cpu;
  assert.deepEqual(Array.from(memory.registers).slice(0, 3), [0x61, 72, 101]);
});

test('rectangle and self-modifying code', () => {
  const rect = run('06-rectangle.asm');
  assert.equal(screen(rect).filter(v => v === 0xCC).length, 32);
  const smc = run('05-self-modifying.asm');
  assert.equal(smc.cpu.registers[1], 42);
  assert.notEqual(smc.cpu.memory[smc.asm.labels.get('target') + 2], smc.asm.memory[smc.asm.labels.get('target') + 2]);
});

test('pixel formats: one even ramp of bytes', () => {
  const r = run('07-pixel-formats.asm');
  assert.deepEqual(screen(r), Array.from({ length: 128 }, (_, i) => (2 * i) & 255));
});

test('fire (MiniCPU 8) animates forever without touching its code', () => {
  const r = run('09-fire.asm', 60000);
  assert.equal(r.cpu.halted, false);
  codeUnchanged(r);
  const heat = screen(r);
  assert.ok(heat.some(v => v > 150) && heat.some(v => v === 0), 'hot and cold pixels');
  assert.ok(r.asm.loadedBytes <= r.asm.display.start, 'code fits below the screen');
});

test('inferno (MiniCPU 8X) burns hot at the bottom and fades out at the top', () => {
  const r = run('15-inferno.asm', 1_500_000);
  assert.equal(r.asm.architecture, 'cpu8x');
  codeUnchanged(r);
  const heat = screen(r), row = y => heat.slice(y * 128, y * 128 + 128);
  const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
  assert.ok(mean(row(95)) > 200, 'white-hot above the embers');
  assert.ok(mean(row(0)) < 40, 'dark at the top');
  assert.ok(new Set(row(30)).size > 4, 'flickering flames in between');
});

test('Hanoi (8S) moves the tower to the right peg in 15 moves', () => {
  const r = run('11-hanoi.asm');
  assert.ok(r.cpu.halted);
  assert.equal(r.cpu.sp, 256);
  assert.equal(r.cpu.memory[r.asm.labels.get('moves')], 15);
  assert.equal(r.cpu.io.outputs.get(0x11), 15);
  const tower = [0x18, 0x3C, 0x7E, 0xFF];
  assert.deepEqual(Array.from(r.cpu.memory.slice(0xC0, 0xCC)), tower.flatMap(d => [0, 0, d]));
  assert.ok(r.asm.loadedBytes <= r.asm.display.start, 'code fits below the screen');
  codeUnchanged(r, r.asm.labels.get('top'));
});

test('scroller (MiniCPU 8S) shows letters and keeps the stack balanced', () => {
  const asm = load('12-scroller.asm');
  assert.equal(asm.architecture, 'cpu8s');
  const cpu = new MiniCPU(asm.memory, 'cpu8s', { historySize: 1 });
  const frame = asm.labels.get('frame');
  let frames = 0;
  while (frames < 40) { cpu.step(); if (cpu.pc === frame) { frames++; assert.equal(cpu.sp, 256); } }
  const pixels = screen({ asm, cpu });
  assert.ok(pixels.filter(Boolean).length > 20);
  codeUnchanged({ asm, cpu }, asm.labels.get('column'));
});

test('subroutines (8S) and pointers (8X) halt with balanced stacks', () => {
  const sub = run('10-subroutines.asm');
  assert.equal(sub.cpu.sp, 256);
  assert.equal(screen(sub).filter(Boolean).length, 4);
  const ptr = run('13-pointers.asm');
  assert.equal(ptr.cpu.sp, 0x10000);
  assert.deepEqual(Array.from(ptr.cpu.memory.slice(0x800, 0x840)), Array.from(ptr.asm.memory.slice(0x400, 0x440)));
});

test('Mandelbrot (8X) renders the set in many colors', () => {
  const r = run('14-mandelbrot.asm');
  assert.ok(r.cpu.halted);
  assert.equal(r.cpu.sp, 0x10000);
  const pixels = screen(r);
  assert.ok(new Set(pixels).size >= 14);
  const inside = pixels.filter(v => v === 0).length;
  assert.ok(inside > 1200 && inside < 2400, `inside: ${inside}`);
  assert.equal(pixels[30 * 80 + 60], 0, 'c = −0.06 is in the set');
  assert.notEqual(pixels[0], 0, 'the corner is outside');
  assert.ok(r.cpu.cycles < 8_000_000, 'fast enough to watch at 1 MHz');
  assert.deepEqual(Array.from(r.cpu.io.palette.slice(3, 6)), [0x0B, 0x10, 0x33], 'the program sets its own colors');
});

test('input (MiniCPU 8): the joystick moves the dot, typed keys reach the number display', () => {
  const asm = load('08-input.asm');
  const cpu = new MiniCPU(asm.memory, asm.architecture, { clockHz: 1e5, historySize: 1 });
  const runFor = seconds => { const end = cpu.time + seconds; while (cpu.time < end) cpu.step(); };
  const dot = () => Array.from(cpu.memory.slice(0x80)).indexOf(255);
  runFor(0.2);
  const before = dot();
  cpu.io.joystick = 2; runFor(0.5); cpu.io.joystick = 0;
  assert.equal(dot() - before, 5, '10 moves per second to the right');
  cpu.io.joystick = 8; runFor(0.15); cpu.io.joystick = 0;
  const down = dot() - before - 5;
  assert.ok(down > 0 && down % 16 === 0, 'rows down');
  cpu.io.type('A'); runFor(0.05);
  assert.equal(cpu.io.outputs.get(0x11), 65);
});

test('Breakout (8X): a scripted player clears bricks; without a player the game ends', () => {
  const asm = load('16-breakout.asm'), L = asm.labels;
  const play = (seconds, player) => {
    const cpu = new MiniCPU(asm.memory, asm.architecture, { clockHz: 1e6, historySize: 1 }), m = cpu.memory;
    while (cpu.time < seconds) {
      if ((cpu.instructions & 255) === 0) cpu.io.joystick = player(m, cpu);
      cpu.step();
    }
    return { cpu, score: m[L.get('score')], lives: m[L.get('lives')], bricks: m[L.get('bricks')] };
  };
  const launch = cpu => ((cpu.instructions >> 14) & 1 ? 16 : 0);
  const follow = (m, cpu) => {
    const ball = m[L.get('ballx')], middle = m[L.get('paddle')] + 3;
    return (ball < middle ? 1 : ball > middle + 1 ? 2 : 0) | (m[L.get('serving')] ? launch(cpu) : 0);
  };
  const good = play(30, follow);
  assert.ok(good.score >= 20, `score ${good.score}`);
  assert.equal(good.lives, 5);
  assert.equal(good.score + good.bricks, 48);
  assert.equal(good.cpu.io.outputs.get(0x11), good.score);
  assert.ok(good.cpu.io.outputs.has(0x10), 'it beeps');
  const idle = play(150, (m, cpu) => 1 | launch(cpu)); // paddle parked on the left
  assert.equal(idle.lives, 0);
  assert.ok(idle.cpu.pc >= L.get('game_over') && idle.cpu.pc < L.get('move_paddle'), 'waiting on the game over screen');
});

// ------------------------------------------------------------ MiniC examples
const runC = (name, cycles) => {
  const program = build(fs.readFileSync(new URL(name, dir), 'utf8'), 'c');
  const cpu = new MiniCPU(program.memory, program.architecture, { historySize: 1, clockHz: 16e6 });
  while (!cpu.halted && cpu.cycles < cycles) cpu.step();
  return { program, cpu };
};

test('every C example compiles without warnings and starts with a title comment', () => {
  const cFiles = fs.readdirSync(dir).filter(f => f.endsWith('.c'));
  assert.ok(cFiles.length >= 2);
  for (const name of cFiles) {
    const source = fs.readFileSync(new URL(name, dir), 'utf8');
    assert.match(source, /^\/\/ [A-Z]/, `${name} starts with a title comment`);
    assert.deepEqual(build(source, 'c').warnings, [], name);
  }
});

test('landscape (C): a fractal height map, and a lake that mirrors the land', async () => {
  const { Devices } = await import('../src/devices.js');
  const program = build(fs.readFileSync(new URL('26-landscape.c', dir), 'utf8'), 'c');
  assert.ok(program.loadedBytes <= 0x8000, 'code and data end below the screen');
  const devices = new Devices();
  const cpu = new MiniCPU(program.memory, program.architecture, { historySize: 1, clockHz: 64e6, devices });
  const L = name => program.labels.get(name);
  // The columns come in the order 0, 128, 64, …: when the third one starts,
  // the arrays describe column 128, in the middle.
  let columns = 0;
  const until = n => { while (columns < n) { cpu.step(); if (cpu.pc === L('_column')) columns++; } };
  until(3);
  const map = cpu.memory.slice(L('_map'), L('_map') + 129 * 128);
  const water = map.filter(h => h < 64).length / map.length;
  assert.ok(Math.max(...map) > 240 && water > 0.1 && water < 0.6, `mountains and lakes (${Math.round(water * 100)} % water)`);
  const camera = (cpu.memory[L('_cam_y') + 1] & 127) * 129 + (cpu.memory[L('_cam_x') + 1] & 127);
  assert.ok(map[camera] < 64, 'the camera floats over a lake');
  const rowStep = cpu.memory.slice(L('_row_step'), L('_row_step') + 192), rowTone = cpu.memory.slice(L('_row_tone'), L('_row_tone') + 192);
  const rows = [...rowStep.keys()];
  assert.ok(rows.some(r => rowStep[r] === 255 && rowTone[r] >= 64), 'land in the middle column');
  assert.ok(rows.some(r => rowStep[r] !== 255 && rowTone[r] >= 64), 'and its mirror image in the water');
  // After a quarter of the columns, most pixels show the new picture: 16 colors, sky at the top.
  until(65);
  assert.ok(cpu.cycles < 120_000_000, `a new landscape and a quarter of the columns in ${Math.round(cpu.cycles / 1e6)} M cycles`);
  const screen = cpu.memory.slice(0x8000, 0x8000 + 128 * 192);
  assert.ok(new Set([...screen].flatMap(v => [v >> 4, v & 15])).size >= 12, 'most of the 16 colors');
  assert.ok(screen.slice(0, 128).every(v => (v >> 4) < 4 && (v & 15) < 4), 'blue sky in the top row');
  assert.ok(screen.slice(128 * 191).every(v => (v >> 4) < 4 && (v & 15) < 4), 'blue water in the bottom row');
});

test('first steps in C: a gray ramp and the sum of five squares', () => {
  const { program, cpu } = runC('17-first-c.c', 1e6);
  assert.ok(cpu.halted);
  assert.equal(cpu.io.outputs.get(0x11), 55);
  assert.equal(cpu.memory[program.display.start + 10], 40);
});

test('solid cube (C): page flipping shows finished pictures of shaded faces', () => {
  const { program, cpu } = runC('18-cube.c', 3e6);
  const end = Math.max(...program.asmAssembly.listing.map(e => e.address + e.size));
  assert.ok(end <= 0x4000, 'code and data stay below the screen pages');
  const page = cpu.io.outputs.get(0x12);
  assert.ok(page === 0x40 || page === 0x70, 'a page is shown');
  const shown = cpu.memory.slice(page * 256, page * 256 + 128 * 96);
  const colors = new Set(shown.filter(Boolean));
  assert.ok(colors.size >= 2 && colors.size <= 3, `two or three faces are visible (${[...colors]})`);
  const lit = shown.filter(Boolean).length;
  assert.ok(lit > 1000 && lit < 6000, 'a cube of a sensible size');
  assert.equal(shown[0], 0, 'the corners of the screen are cleared');
  assert.equal(cpu.memory.slice(0xA000, 0xFF00).some(Boolean), false, 'the stack stays small');
});

test('snake (C): steering towards the apples scores points', () => {
  const program = build(fs.readFileSync(new URL('19-snake.c', dir), 'utf8'), 'c');
  const cpu = new MiniCPU(program.memory, program.architecture, { historySize: 1, clockHz: 1e6 });
  const at = (x, y) => { const b = cpu.memory[0x2000 + y * 16 + (x >> 1)]; return x & 1 ? b & 15 : b >> 4; };
  const find = color => { for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) if (at(x, y) === color) return [x, y]; return null; };
  const moves = [[1, -1, 0], [2, 1, 0], [4, 0, -1], [8, 0, 1]];
  let frame = -1;
  while (cpu.time < 20) {
    cpu.step();
    if (Math.floor(cpu.time * 60) === frame) continue;   // steer once per frame
    frame = Math.floor(cpu.time * 60);
    const head = find(10), apple = find(8);
    if (!head || !apple) continue;
    const wanted = moves.filter(([, dx, dy]) => Math.sign(apple[0] - head[0]) === dx && dx || Math.sign(apple[1] - head[1]) === dy && dy);
    const safe = [...wanted, ...moves].find(([, dx, dy]) => [0, 8].includes(at(head[0] + dx, head[1] + dy)));
    cpu.io.joystick = safe ? safe[0] : 0;
  }
  assert.ok(cpu.io.outputs.get(0x11) >= 5, `score ${cpu.io.outputs.get(0x11)}`);
});

test('color cycling (C): after drawing, only the palette changes', () => {
  const program = build(fs.readFileSync(new URL('23-color-cycling.c', dir), 'utf8'), 'c');
  const cpu = new MiniCPU(program.memory, program.architecture, { historySize: 1, clockHz: 16e6 });
  while (cpu.time < 1.2) cpu.step();
  const screen = cpu.memory.slice(0x4000, 0x4000 + 128 * 96), colors = cpu.io.palette.slice(3, 3 * 65);
  assert.equal(new Set(screen).size, 64, 'all 64 colors are used');
  assert.ok(screen.every(v => v >= 1 && v <= 64));
  const frame = Math.floor(cpu.time * 60);
  while (cpu.time < 1.5) cpu.step();
  assert.ok(Math.floor(cpu.time * 60) - frame >= 17, 'vsync paces it at 60 frames per second');
  assert.ok(cpu.memory.slice(0x4000, 0x4000 + 128 * 96).every((v, i) => v === screen[i]), 'the screen stays the same');
  assert.notDeepEqual(cpu.io.palette.slice(3, 3 * 65), colors, 'the colors move');
});

test('plasma, life and stars (C) draw what they promise', () => {
  const plasma = runC('20-plasma.c', 3e6);
  const page = plasma.cpu.io.outputs.get(0x12) * 256;
  assert.ok(new Set(plasma.cpu.memory.slice(page, page + 80 * 60)).size > 12, 'many colors');
  const life = runC('21-life.c', 4e6);
  assert.ok(life.cpu.io.outputs.get(0x11) >= 2, 'generations pass');
  const alive = life.cpu.memory.slice(0x4000, 0x4000 + 64 * 48).filter(v => v === 255 || v >= 120).length;
  assert.ok(alive > 50 && alive < 2000, `living cells: ${alive}`);
  const stars = runC('22-stars.c', 2e6);
  const dots = stars.cpu.memory.slice(0x4000, 0x4000 + 128 * 96).filter(v => v >= 10 && v <= 31).length;
  assert.ok(dots > 60 && dots <= 320, `stars on the screen: ${dots}`);
});

test('arpeggio organ (C): the first key starts the beat, later keys change the chord at once', async () => {
  const { Devices, KEY_POSITIONS } = await import('../src/devices.js');
  const program = build(fs.readFileSync(new URL('24-arpeggio-organ.c', dir), 'utf8'), 'c');
  const devices = new Devices();
  const notes = [];
  const cpu = new MiniCPU(program.memory, program.architecture, { historySize: 1, clockHz: 8e6, devices });
  devices.onOutput((port, value) => { if (port === 0x10) notes.push([cpu.time, value]); });
  const press = (code, shift, from, to) => { if (cpu.time >= from && cpu.time < to) { devices.held = [KEY_POSITIONS[code]]; devices.shift = shift; return true; } return false; };
  while (cpu.time < 3) {
    cpu.step();
    if (!press('KeyT', true, 0.5, 0.6) && !press('BracketRight', false, 1.0, 1.1)) { devices.held = []; devices.shift = false; }
  }
  // Shift+T at 0.5 s starts the beat; + at 1.0 s changes the chord at once, and the beat goes on.
  const frame = n => Math.round(n[0] * 60);
  const changed = notes.findIndex(n => n[0] >= 1.0);
  assert.ok(Math.abs(frame(notes[0]) - 30) <= 1 && Math.abs(frame(notes[changed]) - 60) <= 1, 'each chord sounds right after its key');
  assert.deepEqual(notes.slice(0, changed).map(n => n[1]), [64, 71, 76, 79], 'Shift+T, a semitone per key from Q: E minor (E B E G), from its first note');
  const grid = notes.filter((n, i) => i !== changed).map(frame);
  assert.ok(grid.every(f => (f - grid[0]) % 9 === 0), `100 BPM: a sixteenth every 9 frames, from the first key on (${grid})`);
  const root = notes.findIndex((n, i) => i > changed && n[1] === 71);
  assert.equal((frame(notes[root]) - frame(notes[0])) % 72, 0, 'H starts its arpeggio on the half bar the first key began');
  assert.deepEqual(notes.slice(root, root + 8).map(n => n[1]), [71, 78, 83, 87, 90, 87, 83, 78], 'H (B) major');
  assert.equal(devices.outputs.get(0x11), 100, 'the number display shows the tempo');
});

test('arpeggio organ: ← → choose the pattern, the number display shows it for a while', async () => {
  const { Devices, KEY_POSITIONS } = await import('../src/devices.js');
  const program = build(fs.readFileSync(new URL('24-arpeggio-organ.c', dir), 'utf8'), 'c');
  const devices = new Devices();
  const notes = [], numbers = [];
  const cpu = new MiniCPU(program.memory, program.architecture, { historySize: 1, clockHz: 8e6, devices });
  devices.onOutput((port, value) => { if (port === 0x10) notes.push(value); if (port === 0x11) numbers.push([cpu.time, value]); });
  const until = t => { while (cpu.time < t) cpu.step(); };
  until(0.2); devices.joystick = 2; until(0.3); devices.joystick = 0;     // → once: pattern 2, rising
  until(0.5); devices.held = [KEY_POSITIONS.KeyQ]; until(0.6); devices.held = [];
  until(1.8);
  assert.deepEqual(notes.slice(0, 8), [60, 64, 67, 72, 76, 79, 84, 88], 'C major, rising');
  assert.deepEqual(numbers.map(n => n[1]), [100, 2, 100], 'the pattern number, then the tempo again');
  assert.ok(Math.abs(numbers[2][0] - numbers[1][0] - 1.5) < 0.05, 'for one and a half seconds');
  devices.joystick = 1; until(1.9); devices.joystick = 0; until(2.0);     // ← twice: back to 1, then 5
  devices.joystick = 1; until(2.1); devices.joystick = 0;
  assert.deepEqual(numbers.slice(3).map(n => n[1]), [1, 5]);
});

test('raycaster (C): textured walls, floor and ceiling; walking never enters a wall', () => {
  const program = build(fs.readFileSync(new URL('25-raycaster.c', dir), 'utf8'), 'c');
  const cpu = new MiniCPU(program.memory, program.architecture, { historySize: 1, clockHz: 32e6 });
  const flips = [];
  cpu.io.onOutput(port => { if (port === 0x12) flips.push(cpu.cycles); });
  const px = () => cpu.memory[program.labels.get('_px')] | cpu.memory[program.labels.get('_px') + 1] << 8;
  const py = () => cpu.memory[program.labels.get('_py')] | cpu.memory[program.labels.get('_py') + 1] << 8;
  const map = program.labels.get('_map');
  let x = 0;
  while (cpu.time < 1) cpu.step();
  const page = cpu.io.outputs.get(0x12) * 256, shown = cpu.memory.slice(page, page + 80 * 50);
  assert.ok(new Set(shown).size > 20, 'many shades of the textures');
  assert.ok(new Set(shown.slice(0, 80 * 10)).size > 3 && new Set(shown.slice(80 * 40)).size > 3, 'textured ceiling and floor');
  const busy = flips.at(-1) - flips.at(-4);
  assert.ok(busy / 3 < 2_200_000, `at most two frames per picture at 64 MHz (${Math.round(busy / 3)} cycles)`);
  // The sine table is negative in the second half (-char stays a char: the table needs -(int)).
  const s16 = address => ((cpu.memory[address] | cpu.memory[address + 1] << 8) << 16) >> 16;
  const sine = program.labels.get('_sine'), at = name => s16(program.labels.get(name));
  for (let i = 1; i < 128; i++) assert.equal(s16(sine + 2 * (256 - i)), -s16(sine + 2 * i), `sine[${256 - i}]`);
  // One small step to the left: the wall on the left still shows its bricks
  // (it once turned into stripes, when the side of the wall was misjudged).
  cpu.io.joystick = 1;
  while (cpu.memory[program.labels.get('_angle')] === 0) cpu.step();
  cpu.io.joystick = 0;
  const tap = cpu.time;
  while (cpu.time < tap + 0.3) cpu.step();
  assert.ok(cpu.memory[program.labels.get('_angle')] >= 250, 'a few steps at most');
  const left = cpu.io.outputs.get(0x12) * 256;
  for (const y of [22, 26, 30]) assert.ok(new Set(cpu.memory.slice(left + 80 * y, left + 80 * y + 24)).size > 1, `row ${y} of the left wall is textured`);
  // Turning left for half a second: north-east, so dir_y < 0 (y grows southwards).
  cpu.io.joystick = 1;
  const start = cpu.time;
  while (cpu.time < start + 0.5) cpu.step();
  cpu.io.joystick = 0;
  while (cpu.time < start + 0.6) cpu.step();
  const angle = cpu.memory[program.labels.get('_angle')], radians = angle * Math.PI / 128;
  assert.ok(angle > 192 && angle < 250, `angle ${angle}`);
  assert.ok(Math.abs(at('_dir_x') - 64 * Math.cos(radians)) <= 1.5 && Math.abs(at('_dir_y') - 64 * Math.sin(radians)) <= 1.5, `direction at angle ${angle}`);
  assert.equal(at('_plane_x'), Math.trunc(-at('_dir_y') * 2 / 3));
  // Walk around at random for a while: never inside a wall.
  const moves = [4, 4, 4, 1, 2, 8];
  while (cpu.time < 6) {
    cpu.step();
    if (++x % 20000 === 0) cpu.io.joystick = moves[(x / 20000) % moves.length | 0] | (x % 140000 === 0 ? 16 : 0);
    if (x % 5000 === 0) assert.equal(cpu.memory[map + (py() >> 8) * 16 + (px() >> 8)], 0, `inside a wall at ${px()}, ${py()}`);
  }
});
