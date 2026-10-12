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
  assert.equal(run('02-countdown.asm').cpu.registers[0], 0);
  assert.deepEqual(Array.from(run('03-division.asm').cpu.registers).slice(2), [3, 1]);
  assert.equal(run('04-square-root.asm').cpu.registers[3], 4);
  const memory = run('05-memory.asm').cpu;
  assert.deepEqual(Array.from(memory.registers).slice(0, 3), [0x61, 72, 101]);
});

test('rectangle, primes and self-modifying code', () => {
  const rect = run('06-rectangle.asm');
  assert.equal(screen(rect).filter(v => v === 0xCC).length, 32);
  const primes = run('07-primes.asm');
  const expected = Array.from({ length: 128 }, (_, n) => n > 1 && [...Array(n).keys()].slice(2).every(d => n % d) ? 255 : 0);
  assert.deepEqual(screen(primes), expected);
  const smc = run('08-self-modifying.asm');
  assert.equal(smc.cpu.registers[1], 42);
  assert.notEqual(smc.cpu.memory[smc.asm.labels.get('target') + 2], smc.asm.memory[smc.asm.labels.get('target') + 2]);
});

test('pixel formats: one even ramp of bytes', () => {
  const r = run('09-pixel-formats.asm');
  assert.deepEqual(screen(r), Array.from({ length: 128 }, (_, i) => (2 * i) & 255));
});

test('fire (MiniCPU 8) animates forever without touching its code', () => {
  const r = run('11-fire.asm', 60000);
  assert.equal(r.cpu.halted, false);
  codeUnchanged(r);
  const heat = screen(r);
  assert.ok(heat.some(v => v > 150) && heat.some(v => v === 0), 'hot and cold pixels');
  assert.ok(r.asm.loadedBytes <= r.asm.display.start, 'code fits below the screen');
});

test('inferno (MiniCPU 8X) burns hot at the bottom and fades out at the top', () => {
  const r = run('18-inferno.asm', 1_500_000);
  assert.equal(r.asm.architecture, 'cpu8x');
  codeUnchanged(r);
  const heat = screen(r), row = y => heat.slice(y * 128, y * 128 + 128);
  const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
  assert.ok(mean(row(95)) > 200, 'white-hot above the embers');
  assert.ok(mean(row(0)) < 40, 'dark at the top');
  assert.ok(new Set(row(30)).size > 4, 'flickering flames in between');
});

test('recursion (8S) fills a table with Fibonacci numbers', () => {
  const r = run('13-recursion.asm');
  assert.equal(r.cpu.sp, 256);
  assert.deepEqual(screen(r), [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]);
});

test('scroller (MiniCPU 8S) shows letters and keeps the stack balanced', () => {
  const asm = load('14-scroller.asm');
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
  const sub = run('12-subroutines.asm');
  assert.equal(sub.cpu.sp, 256);
  assert.equal(screen(sub).filter(Boolean).length, 4);
  const ptr = run('15-pointers.asm');
  assert.equal(ptr.cpu.sp, 0x10000);
  assert.deepEqual(Array.from(ptr.cpu.memory.slice(0x800, 0x840)), Array.from(ptr.asm.memory.slice(0x400, 0x440)));
});

test('lines (8X) draws a cube outline without self-modifying code', () => {
  const r = run('16-lines.asm');
  assert.ok(r.cpu.halted);
  codeUnchanged(r, r.asm.labels.get('x0'));
  const pixels = screen(r), at = (x, y) => pixels[y * 64 + x];
  for (const [x, y] of [[32, 4], [10, 16], [54, 36], [32, 47], [10, 26]]) assert.equal(at(x, y), 1, `${x},${y}`);
  assert.equal(at(0, 0), 0);
});

test('Mandelbrot (8X) renders the set in many colors', () => {
  const r = run('17-mandelbrot.asm');
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
  const asm = load('19-input.asm');
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
  const asm = load('20-breakout.asm'), L = asm.labels;
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

test('first steps in C: a gray ramp and the sum of five squares', () => {
  const { program, cpu } = runC('21-first-c.c', 1e6);
  assert.ok(cpu.halted);
  assert.equal(cpu.io.outputs.get(0x11), 55);
  assert.equal(cpu.memory[program.display.start + 10], 40);
});

test('solid cube (C): page flipping shows finished pictures of shaded faces', () => {
  const { program, cpu } = runC('22-cube.c', 3e6);
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
  const program = build(fs.readFileSync(new URL('23-snake.c', dir), 'utf8'), 'c');
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
  const program = build(fs.readFileSync(new URL('27-color-cycling.c', dir), 'utf8'), 'c');
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
  const plasma = runC('24-plasma.c', 3e6);
  const page = plasma.cpu.io.outputs.get(0x12) * 256;
  assert.ok(new Set(plasma.cpu.memory.slice(page, page + 80 * 60)).size > 12, 'many colors');
  const life = runC('25-life.c', 4e6);
  assert.ok(life.cpu.io.outputs.get(0x11) >= 2, 'generations pass');
  const alive = life.cpu.memory.slice(0x4000, 0x4000 + 64 * 48).filter(v => v === 255 || v >= 120).length;
  assert.ok(alive > 50 && alive < 2000, `living cells: ${alive}`);
  const stars = runC('26-stars.c', 2e6);
  const dots = stars.cpu.memory.slice(0x4000, 0x4000 + 128 * 96).filter(v => v >= 10 && v <= 31).length;
  assert.ok(dots > 60 && dots <= 320, `stars on the screen: ${dots}`);
});
