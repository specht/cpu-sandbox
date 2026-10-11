import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble, AssemblyError } from '../src/assembler.js';
import { MiniCPU, CpuFault } from '../src/cpu.js';
import { ARCHITECTURES } from '../src/architectures.js';
import { validateDisplay, renderDisplay } from '../src/display.js';
import { PALETTES } from '../src/palettes.js';
import { OPCODES as OP, OPCODE_TABLE } from '../src/opcodes.js';
const example = file => readFileSync(new URL(`../examples/${file}`, import.meta.url), 'utf8');
function run(source, profile, limit=100000) {
  const assembly = assemble(source, { architecture: profile });
  const cpu = new MiniCPU(assembly.memory, profile);
  let instructions = 0;
  while (!cpu.halted && instructions++ < limit) cpu.step();
  return { cpu, assembly, instructions };
}
test('three sequential, cumulative models share the same 8-bit instructions', () => {
  assert.deepEqual(Object.keys(ARCHITECTURES),['cpu8','cpu8s','cpu8x']);
  for (const name of ['01-add.asm','02-countdown.asm','03-division.asm','04-square-root.asm','17-prism-gradient.asm']) {
    const program = example(name);
    const base = assemble(program);
    for (const id of Object.keys(ARCHITECTURES)) {
      const result = run(program,id,200000);
      if (id !== 'cpu8x') assert.deepEqual(Array.from(result.assembly.bytes), Array.from(base.bytes), `${name}, ${id}`);
      assert.equal(result.cpu.halted,true,`${name}, ${id}`);
      assert.deepEqual(Array.from(result.cpu.registers),Array.from(run(program,'cpu8',200000).cpu.registers));
    }
  }
});
test('basic profile rejects extensions with helpful source line diagnostics', () => {
  for(const mnemonic of ['PUSH A','CALL target\ntarget: HLT','LDX 0x0800','LDX 0x0200','RET'])
    assert.throws(()=>assemble(mnemonic), e=>e instanceof AssemblyError && e.line===1 && /requires MiniCPU/.test(e.message));
  assert.throws(()=>assemble('LDX 0x0800',{architecture:'cpu8s'}),/MiniCPU 8X/);
  assert.throws(()=>assemble('LDA A, [X]',{architecture:'cpu8s'}),/MiniCPU 8X/);
  assert.throws(()=>assemble('STA [X], A',{architecture:'cpu8'}),/MiniCPU 8X/);
});
test('8S: nested calls, PUSH/POP, return-address stack and snapshot/restore', () => {
  const source=example('18-stack-subroutines.asm');
  const asm=assemble(source,{architecture:'cpu8s'});
  const cpu=new MiniCPU(asm.memory,'cpu8s');
  const original=cpu.snapshot();
  cpu.step();cpu.step();cpu.step();
  assert.equal(cpu.sp,255); // CALL saves 8-bit return address.
  cpu.restore(original);
  assert.equal(cpu.sp,256);
  for(let i=0;i<200&&!cpu.halted;i++)cpu.step();
  assert.equal(cpu.halted,true);
  assert.equal(cpu.sp,256);
  assert.equal(cpu.registers[0],0xE0);
  assert.equal(cpu.memory[0xE0],255);
  assert.equal(cpu.memory[0xE1],255);
});
test('8S: PUSH/POP do not affect condition flags; overflow and underflow fault', () => {
  const cpu=new MiniCPU(assemble('LDI A, 3\nCMP A,4\nPUSH A\nPOP B\nHLT',{architecture:'cpu8s'}).memory,'cpu8s');
  for(let i=0;i<5;i++)cpu.step();
  assert.equal(cpu.registers[1],3);
  assert.equal(cpu.cf,true);
  assert.equal(cpu.zf,false);
  assert.equal(cpu.sp,256);
  assert.throws(()=>new MiniCPU(assemble('POP A',{architecture:'cpu8s'}).memory,'cpu8s').step(),CpuFault);
  cpu.sp=0;
  assert.throws(()=>cpu.push(1,0),CpuFault);
});
test('8X: 16-bit code addresses, index register and 4 KiB RAM', () => {
  const r=run(example('20-extended-high-code.asm'),'cpu8x');
  assert.equal(r.cpu.halted,true);
  assert.equal(r.cpu.registers[0],43);
  assert.equal(r.cpu.pc,r.assembly.labels.get('subroutine') - 1); // HLT is before the subroutine
  assert.equal(r.cpu.sp,4096);
  assert.equal(r.assembly.memory.length,4096);
  assert.deepEqual(Array.from(r.assembly.memory.slice(0,3)),[OP.JMP_LONG,0,2]);
});
test('8X: color gradient uses high RAM, 32x32 4bpp without modifying code', () => {
  const r=run(example('19-extended-color-gradient.asm'),'cpu8x',25000);
  assert.equal(r.cpu.halted,true);
  assert.equal(r.cpu.sp,4096);
  assert.equal(r.cpu.x,0x0A00);
  assert.equal(r.assembly.display.start,0x0800);
  assert.equal(validateDisplay(r.assembly.display,4096).bytesSpanned,512);
  assert.deepEqual(Array.from(r.cpu.memory.slice(0, r.assembly.loadedBytes)),Array.from(r.assembly.memory.slice(0,r.assembly.loadedBytes)));
  const pixels=renderDisplay(r.cpu.memory,r.assembly.display,PALETTES);
  assert.equal(pixels.length,1024);
  assert.equal(new Set(pixels.map(p=>p.index)).size,16);
  assert.ok(new Set(pixels.map(p=>p.color)).size>=16);
});
test('8X: JMP always addresses 16-bit labels without special mnemonics', () => {
  const r=run('JMP short\nLDI A,99\nshort: JMP far\n.org 0x300\nfar: LDI A,42\nHLT','cpu8x');
  assert.equal(r.cpu.registers[0],42);
  assert.equal(r.cpu.halted,true);
  assert.equal(run('JMP far\n.org 0x300\nfar: HLT','cpu8x').cpu.halted,true);
});
test('8X: native 16-bit address rejects out of installed RAM; display validates memory size',()=>{
  assert.throws(()=>assemble('LDX 0x1000',{architecture:'cpu8x'}),AssemblyError);
  assert.throws(()=>assemble('.org 0x1000\nHLT',{architecture:'cpu8x'}),AssemblyError);
  assert.throws(()=>assemble('.display 0x0FF0, 32, 16, mono, 1bit_monitor_glow\nHLT',{architecture:'cpu8x'}),AssemblyError);
  const config={ start:0x800,width:16,height:16,mode:'indexed4',palette:'sweetie_16' };
  assert.throws(()=>validateDisplay(config),RangeError);
  assert.equal(validateDisplay(config,4096).bytesSpanned,128);
});

test('grouped opcode layout is unique, ordered, and cumulative', () => {
  assert.equal(OPCODE_TABLE.length, Object.keys(OP).length);
  assert.equal(new Set(OPCODE_TABLE.map(x => x.code)).size, OPCODE_TABLE.length);
  const families = new Map([
    ['Control', 0x00], ['Data movement', 0x10], ['Arithmetic & shifts', 0x20],
    ['Bitwise logic', 0x30], ['Comparison', 0x40], ['Stack & subroutines', 0x50],
    ['Branches', 0x60],
  ]);
  for (const {name,code,family,since} of OPCODE_TABLE) {
    assert.equal(OP[name], code);
    assert.equal(code >> 4, families.get(family) >> 4, `${name} is in wrong family`);
    assert.ok(['cpu8','cpu8s','cpu8x'].includes(since));
    assert.ok(code < 0x70, '0x70..0xFF are reserved');
  }
  assert.deepEqual(OPCODE_TABLE.map(x=>x.code),[...OPCODE_TABLE].map(x=>x.code).sort((a,b)=>a-b));
});
test('original machine-code bytes are intentionally rejected when no longer valid', () => {
  assert.throws(() => new MiniCPU(Uint8Array.from([0xFF])).step(), CpuFault);
  // 0x01 is now HLT, whereas the historical implementation used it for LDI.
  assert.equal(new MiniCPU(Uint8Array.from([OP.HLT])).step().text,'HLT');
});

test('8S neon halo uses a subroutine and leaves code and framebuffer clear of stack', () => {
  const source=example('21-stack-neon-halo.asm');
  const asm=assemble(source,{architecture:'cpu8s'});
  assert.equal(asm.loadedBytes,105);
  assert.ok(asm.listing.some(entry=>entry.op === 'CALL' || entry.text?.includes('CALL')) || /\bCALL\b/.test(source));
  const display=validateDisplay(asm.display,256);
  assert.deepEqual([display.start,display.width,display.height,display.bytesSpanned,display.endExclusive],[0x90,16,12,96,0xF0]);
  assert.ok(asm.loadedBytes < display.start);
  const {cpu,instructions}=run(source,'cpu8s',10000);
  assert.equal(cpu.halted,true);
  assert.equal(cpu.sp,256,'stack must be balanced after returning');
  assert.equal(instructions,3842);
  assert.deepEqual(Array.from(cpu.memory.slice(0,asm.loadedBytes)),Array.from(asm.memory.slice(0,asm.loadedBytes)));
  const pixels=renderDisplay(cpu.memory,asm.display,PALETTES);
  assert.equal(pixels.length,192);
  assert.equal(new Set(pixels.map(p=>p.index)).size,16);
  assert.notDeepEqual(Array.from(cpu.memory.slice(0x90,0xF0)),Array.from(asm.memory.slice(0x90,0xF0)));
  assert.throws(()=>assemble(source,{architecture:'cpu8'}),/MiniCPU 8S or 8X/);
});

test('8X neon orbit draws 3072 pixels with 8-bit registers and 16-bit addressing', () => {
  const source=example('22-extended-neon-orbit.asm');
  const asm=assemble(source,{architecture:'cpu8x'});
  assert.ok(asm.loadedBytes>0);
  const display=validateDisplay(asm.display,4096);
  assert.deepEqual([display.start,display.width,display.height,display.bytesSpanned,display.endExclusive],[0x800,64,48,1536,0xE00]);
  const {cpu,instructions}=run(source,'cpu8x',120000);
  assert.equal(cpu.halted,true);
  assert.ok(instructions>90000);
  assert.equal(cpu.sp,4096,'all call and pixel stacks must be balanced');
  assert.equal(cpu.x,0xE00,'one framebuffer byte is written per pair of pixels');
  // The final two bytes are deliberately writable x/y scratch variables.
  const codeEnd=asm.labels.get('xpos');
  assert.deepEqual(Array.from(cpu.memory.slice(0,codeEnd)),Array.from(asm.memory.slice(0,codeEnd)));
  assert.equal(cpu.memory[asm.labels.get('xpos')],64);
  assert.equal(cpu.memory[asm.labels.get('ypos')],48);
  const pixels=renderDisplay(cpu.memory,asm.display,PALETTES);
  assert.equal(pixels.length,3072);
  assert.equal(new Set(pixels.map(p=>p.index)).size,16);
  assert.notDeepEqual(Array.from(cpu.memory.slice(0x800,0xE00)),Array.from(asm.memory.slice(0x800,0xE00)));
  assert.throws(()=>assemble(source,{architecture:'cpu8s'}),/MiniCPU 8X/);
});
