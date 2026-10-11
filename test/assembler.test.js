import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assemble, AssemblyError } from '../src/assembler.js';
import { MiniCPU, CpuFault } from '../src/cpu.js';
import { OPCODES as OP } from '../src/opcodes.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = name => assemble(fs.readFileSync(path.join(root,'examples',name), 'utf8'));
function run(source, limit = 100000) {
  const assembled = typeof source === 'string' ? assemble(source) : source;
  const cpu = new MiniCPU(assembled.memory);
  let steps = 0;
  while (!cpu.halted && steps < limit) { cpu.step(); steps++; }
  return { cpu, steps, assembled };
}
test('LDI / ADD / HLT encode according to the grouped teaching ISA', () => {
  const r = run(example('01-add.asm'));
  assert.deepEqual(Array.from(r.assembled.bytes), [OP.LDI,0,5,OP.LDI,1,3,OP.ADD,1,OP.HLT]);
  assert.equal(r.cpu.registers[0], 8); assert.equal(r.steps, 4); assert.equal(r.cpu.halted, true);
});
test('countdown terminates and can restore CPU snapshot', () => {
  const a = example('02-countdown.asm'); const cpu = new MiniCPU(a.memory), first = cpu.snapshot();
  cpu.step(); assert.equal(cpu.registers[0], 5);
  cpu.restore(first); assert.equal(cpu.registers[0], 0); assert.equal(cpu.pc, 0);
  const r = run(a); assert.equal(r.cpu.registers[0], 0); assert.equal(r.cpu.halted,true);
});
test('division has quotient 3 remainder 1', () => {
  const r = run(example('03-division.asm')); assert.deepEqual(Array.from(r.cpu.registers), [13,4,3,1]);
});
test('square root floors sqrt(24) = 4', () => {
  const r = run(example('04-square-root.asm')); assert.equal(r.cpu.registers[3],4);
});
test('rectangle paints 8 by 4 pixels exactly', () => {
  const r = run(example('05-fill-rectangle.asm'));
  const painted = [];
  for (let addr=128;addr<256;addr++) if (r.cpu.memory[addr]) painted.push(addr);
  assert.equal(painted.length,32);
  for(let y=2;y<6;y++)for(let x=3;x<11;x++)assert.equal(r.cpu.memory[128+y*16+x], 0xcc);
});
test('primes mark exactly primes 2 through 127', () => {
  const r = run(example('06-primes.asm'));
  assert.ok(r.cpu.halted); assert.equal(r.steps,61704);
  for(let n=0;n<128;n++) {
    const prime=n>=2 && [...Array(Math.floor(Math.sqrt(n))+1).keys()].slice(2).every(d=>n%d!==0);
    assert.equal(r.cpu.memory[128+n],prime?255:0,`n=${n}`);
  }
});
test('bouncing dot is intentionally infinite, confined to framebuffer and history bytes', () => {
  const r = run(example('07-bouncing-dot.asm'),5000);
  assert.equal(r.cpu.halted,false);
  assert.ok([...r.cpu.memory.slice(128)].some(Boolean));
  assert.ok(r.cpu.registers[0] >= 0xf0 && r.cpu.registers[0] <= 0xff);
});
test('.org, named label and .db strings preserve byte addresses', () => {
  const r = run(example('08-data.asm'));
  assert.equal(r.cpu.registers[1],72); assert.equal(r.assembled.memory[0x60],72);
  assert.equal(r.assembled.bytes.length,0x6c);
});
test('CMP, conditional jump, carry, zero behavior', () => {
  const source = 'LDI A, 2\nCMP A, 3\nJC yes\nLDI B, 9\nyes:\nHLT';
  const r=run(source); assert.equal(r.cpu.registers[1],0); assert.equal(r.cpu.cf,true);
  const r2=run('LDI A,255\nINC A\nJZ good\nLDI B,1\ngood:\nHLT');
  assert.equal(r2.cpu.registers[0],0);assert.equal(r2.cpu.registers[1],0);
});
test('indirect LDA and STA and source map', () => {
  const src = 'LDI A, 0x70\nLDI B, 0x42\nSTA [A], B\nLDA C, [A]\nHLT';
  const r=run(src); assert.equal(r.cpu.memory[0x70],0x42);assert.equal(r.cpu.registers[2],0x42);
  assert.equal(r.assembled.sourceMap.get(6),3);
});
test('assembler catches unknown mnemonic, duplicate labels, range and overflow', () => {
  const bad=['WHOOPS','foo:\nfoo:\nHLT','LDI A, 300','.org 0xff\nLDI A, 4'];
  for(const src of bad)assert.throws(()=>assemble(src), AssemblyError);
});
test('CPU fails safely on unsupported opcode', () => {
  assert.throws(()=>new MiniCPU(Uint8Array.from([0xaa])).step(),CpuFault);
});
test('assembly labels and constants are resolved correctly', () => {
  const a=assemble('OFFSET .equ 4\nLDI A, (OFFSET + 2)\nJMP halt\nLDI A, 99\nhalt: HLT');
  assert.deepEqual(Array.from(a.bytes),[OP.LDI,0,6,OP.JMP,8,OP.LDI,0,99,OP.HLT]);
});
