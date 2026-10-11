import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble, AssemblyError, MNEMONICS } from '../src/assembler.js';
import { MiniCPU } from '../src/cpu.js';
import { OPCODES as OP, OPCODE_TABLE } from '../src/opcodes.js';
import { renderDisplay } from '../src/display.js';
import { PALETTES } from '../src/palettes.js';

const asm8x = source => assemble(source,{architecture:'cpu8x'});
const source = name => readFileSync(new URL(`../examples/${name}`, import.meta.url),'utf8');
function run(code, limit=20000) {
  const assembly = asm8x(code);
  const cpu = new MiniCPU(assembly.memory,'cpu8x');
  let executed = 0;
  while (!cpu.halted && executed < limit) { cpu.step(); executed++; }
  assert.ok(cpu.halted,`failed to halt within ${limit} instructions`);
  return {assembly,cpu,executed};
}

test('8X chooses short jumps even for local labels beyond page zero', () => {
  const assembly = asm8x('.org 0x0200\nJMP next\nNOP\nnext: HLT');
  assert.equal(assembly.memory[0x200],OP.JMP_REL);
  assert.equal(assembly.memory[0x201],1); // relative to PC after JMP
  const cpu = new MiniCPU(assembly.memory,'cpu8x');
  cpu.pc = 0x200;
  cpu.step();
  assert.equal(cpu.pc,0x203);
  cpu.step();
  assert.ok(cpu.halted);
});

test('assembler relaxes long forward JMP/CALL and signed backward branches', () => {
  const far = asm8x('JMP far\n.org 0x0300\nfar: HLT');
  assert.deepEqual(Array.from(far.memory.slice(0,3)),[OP.JMP_LONG,0,3]);
  assert.ok(run('JMP far\n.org 0x0300\nfar: HLT').cpu.halted);
  const near = asm8x('LDI A, 1\nloop: DEC A\nJNZ loop\nHLT');
  assert.equal(near.memory[5],OP.JNZ_REL);
  assert.equal(near.memory[6],0xFC); // -4 relative to next PC
  assert.equal(run('LDI A, 1\nloop: DEC A\nJNZ loop\nHLT').cpu.registers[0],0);
  const call = asm8x('CALL high\nHLT\n.org 0x0300\nhigh: RET');
  assert.equal(call.memory[0],OP.CALL_LONG);
  assert.equal(run('CALL high\nHLT\n.org 0x0300\nhigh: RET').cpu.sp,4096);
});

test('short-jump signed edge values and iterative widening update labels', () => {
  const db = n => `.db ${Array(n).fill('0').join(',')}`;
  const edge=asm8x(`JMP target\n${db(127)}\ntarget: HLT`);
  assert.equal(edge.memory[0],OP.JMP_REL);
  const distant=asm8x(`JMP target\n${db(128)}\ntarget: HLT`);
  assert.equal(distant.memory[0],OP.JMP_LONG);
  const cascade=asm8x(`JMP end\nJMP far\n${db(125)}\nend: HLT\n.org 0x0300\nfar: HLT`);
  assert.equal(cascade.memory[0],OP.JMP_LONG);
  assert.equal(cascade.memory[3],OP.JMP_LONG);
  assert.equal(cascade.labels.get('end'),131);
  assert.equal(cascade.memory[1],131);
});

test('Y register mirrors X; both persist through snapshot/restore', () => {
  const {assembly,cpu}=run(source('25-extended-block-copy.asm'));
  assert.equal(cpu.x,0x0440);
  assert.equal(cpu.y,0x0840);
  assert.equal(cpu.sp,4096);
  assert.deepEqual(Array.from(cpu.memory.slice(0x800,0x840)),Array.from(cpu.memory.slice(0x400,0x440)));
  assert.deepEqual(Array.from(assembly.memory.slice(0x800,0x840)),Array(64).fill(0));
  const colors=new Set(renderDisplay(cpu.memory,assembly.display,PALETTES).map(p=>p.index));
  assert.equal(colors.size,16);
  const copy=new MiniCPU(assembly.memory,'cpu8x');
  copy.step(); copy.step();
  const snap=copy.snapshot();
  copy.y=0x0F00;
  copy.restore(snap);
  assert.equal(copy.y,0x0800);
});

test('Y is not accessible on smaller CPUs; compact instruction set remains unique', () => {
  for(const inst of ['LDY 0x0800','INCY','DECY','LDA A, [Y]','STA [Y], A']) {
    for(const model of ['cpu8','cpu8s'])
      assert.throws(()=>assemble(inst,{architecture:model}),/MiniCPU 8X/);
  }
  assert.ok(MNEMONICS.includes('LDY'));
  for(const invalid of ['JMP16 0x200','CALL16 0x200'])
    assert.throws(()=>asm8x(invalid),AssemblyError);
  assert.equal(new Set(OPCODE_TABLE.map(x=>x.code)).size,OPCODE_TABLE.length);
});
