import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assemble } from '../src/assembler.js';
import { MiniCPU } from '../src/cpu.js';
import { validateDisplay, pixelValue } from '../src/display.js';

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
    assert.match(fs.readFileSync(new URL(name, dir), 'utf8'), /^; [A-Z]/, `${name} starts with a title comment`);
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
  codeUnchanged(r, r.asm.labels.get('random'));
  const heat = screen(r);
  assert.ok(heat.some(v => v > 150) && heat.some(v => v === 0), 'hot and cold pixels');
  assert.ok(r.asm.loadedBytes <= r.asm.display.start, 'code fits below the screen');
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
  assert.equal(ptr.cpu.sp, 4096);
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
  assert.equal(r.cpu.sp, 4096);
  const pixels = screen(r);
  assert.ok(new Set(pixels).size >= 14);
  const inside = pixels.filter(v => v === 0).length;
  assert.ok(inside > 1200 && inside < 2400, `inside: ${inside}`);
  assert.equal(pixels[30 * 80 + 60], 0, 'c = −0.06 is in the set');
  assert.notEqual(pixels[0], 0, 'the corner is outside');
  assert.ok(r.cpu.cycles < 8_000_000, 'fast enough to watch at 1 MHz');
});
