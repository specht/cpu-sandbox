import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble, AssemblyError, MNEMONICS } from '../src/assembler.js';
import { MiniCPU } from '../src/cpu.js';
import { renderDisplay } from '../src/display.js';
import { PALETTES } from '../src/palettes.js';
import { OPCODES as OP } from '../src/opcodes.js';

function example(file) { return readFileSync(new URL(`../examples/${file}`,import.meta.url),'utf8'); }
function run(source, arch, limit=100000) {
  const asm=assemble(source,{architecture:arch});
  const cpu=new MiniCPU(asm.memory,arch);
  let steps=0;
  while(!cpu.halted && steps<limit) {cpu.step();steps++;}
  assert.equal(cpu.halted,true,`${arch} should halt before ${limit} steps`);
  return {asm,cpu,steps};
}
test('address width follows the CPU model, not the mnemonic',()=>{
  for(const m of ['JMP16','JZ16','JNZ16','JC16','JNC16','CALL16']) {
    assert.equal(MNEMONICS.includes(m),false);
    assert.throws(()=>assemble(`${m} 0x0200`,{architecture:'cpu8x'}),AssemblyError);
  }
  assert.deepEqual(Array.from(assemble('JMP end\nend: HLT').bytes),[OP.JMP,2,OP.HLT]);
  assert.deepEqual(Array.from(assemble('JMP end\nend: HLT',{architecture:'cpu8x'}).bytes),[OP.JMP_REL,0,OP.HLT]);
  assert.throws(()=>assemble('JMP 0x0200',{architecture:'cpu8'}),AssemblyError);
  const src='JMP far\n.org 0x0200\nfar: LDI A, 42\nHLT';
  assert.equal(run(src,'cpu8x').cpu.registers[0],42);
});
test('8S bitmap font is drawn by repeated calls without touching source or stack',()=>{
  const {asm,cpu,steps}=run(example('23-stack-bitmap-text.asm'),'cpu8s');
  assert.equal(steps,184); assert.equal(cpu.sp,256);
  assert.equal(asm.display.width,24); assert.equal(asm.display.height,8);
  assert.equal(asm.display.start,0xD0);
  const pixels=renderDisplay(cpu.memory,asm.display,PALETTES);
  assert.equal(pixels.filter(x=>x.index).length,43);
  assert.ok(pixels.slice(7*24).every(x=>x.index===0));
  assert.deepEqual(Array.from(cpu.memory.slice(0,asm.loadedBytes)),Array.from(asm.memory.slice(0,asm.loadedBytes)));
  assert.throws(()=>assemble(example('23-stack-bitmap-text.asm'),{architecture:'cpu8'}),/MiniCPU 8S/);
});
test('8X cube draws twelve projected edges by integer rasterization',()=>{
  const {asm,cpu,steps}=run(example('24-extended-wireframe-cube.asm'),'cpu8x',50000);
  assert.equal(steps,20273); assert.equal(cpu.sp,4096);
  assert.equal(asm.display.width,64); assert.equal(asm.display.height,48);
  assert.equal(asm.display.start,0x800);
  const pixels=renderDisplay(cpu.memory,asm.display,PALETTES);
  assert.equal(pixels.filter(x=>x.index).length,251);
  assert.equal(pixels[4*64+32].index,1);
  assert.equal(pixels[28*64+32].index,1);
  const entry=asm.labels.get('load_x');
  assert.notDeepEqual(Array.from(cpu.memory.slice(entry+1,entry+3)),Array.from(asm.memory.slice(entry+1,entry+3)),
    'plot must update the operand of LDX in real shared RAM');
  assert.throws(()=>assemble(example('24-extended-wireframe-cube.asm'),{architecture:'cpu8s'}),/MiniCPU 8X/);
});
