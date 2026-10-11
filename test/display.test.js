import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assemble } from '../src/assembler.js';
import { MiniCPU } from '../src/cpu.js';
import { DEFAULT_DISPLAY, validateDisplay, renderDisplay } from '../src/display.js';
import { PALETTES } from '../src/palettes.js';
const rgb = (mem,config) => renderDisplay(mem,config,PALETTES);
const config = (options = {}) => ({...DEFAULT_DISPLAY, ...options});
const example = filename => assemble(fs.readFileSync(new URL(`../examples/${filename}`,import.meta.url),'utf8'));
const run = (asm, max=10000) => { const cpu = new MiniCPU(asm.memory); for(let i=0;i<max&&!cpu.halted;i++)cpu.step();return cpu; };
test('MSB-first monochrome packs eight pixels into one byte', () => {
  const memory=new Uint8Array(256);memory[0x80]=0b10110001;
  const pixels=rgb(memory,config({width:8,height:1,mode:'mono',palette:'1bit_monitor_glow'}));
  assert.deepEqual(pixels.map(p=>p.index),[1,0,1,1,0,0,0,1]);
  assert.equal(pixels[0].color,PALETTES['1bit_monitor_glow'][1]);
});
test('2bpp and 4bpp pixels preserve order and palette indexes', () => {
  const mem=new Uint8Array(256);mem[128]=0x1b;
  assert.deepEqual(rgb(mem,config({width:4,height:1,mode:'indexed2',palette:'cga_palette_1_high'})).map(p=>p.index),[0,1,2,3]);
  assert.deepEqual(rgb(mem,config({width:2,height:1,mode:'indexed4',palette:'pico_8'})).map(p=>p.index),[1,11]);
});
test('rows are always tightly byte-aligned, including a partially filled final byte', () => {
  const mem=new Uint8Array(256);mem.set([0b01000000,0b10000000],128);
  const c=config({width:3,height:2,mode:'indexed2',palette:'cga_palette_1_high'});
  const p=rgb(mem,c);
  assert.equal(validateDisplay(c).rowBytes,1);
  assert.deepEqual(p.map(x=>x.index),[1,0,0,2,0,0]);
  assert.deepEqual(p.map(x=>x.address),[128,128,128,129,129,129]);
});
test('RGB332 and RGB24 decode raw bytes without palette lookup', () => {
  const mem=new Uint8Array(256);mem.set([0b11100011,255,128,0],128);
  assert.equal(rgb(mem,config({width:1,height:1,mode:'rgb332'}))[0].color,'#FF00FF');
  assert.equal(rgb(mem,config({width:1,height:1,mode:'rgb24',start:129}))[0].color,'#FF8000');
});
test('display controller rejects configurations extending beyond shared RAM', () => {
  assert.throws(()=>validateDisplay(config({start:0xf0,width:16,height:2})),/RAM ends/);
  assert.throws(()=>validateDisplay(config({start:0xF0,width:16,height:1,mode:'rgb24'})),/RAM ends/);
  assert.equal(validateDisplay(config({start:0xC0,width:32,height:16,mode:'mono'})).bytesSpanned,64);
});
test('same RAM and CPU state admit different live display interpretations', () => {
  const asm=example('10-cga-2bit.asm'), cpu=run(asm), before=cpu.snapshot();
  const color=rgb(cpu.memory,asm.display).map(p=>p.color);
  const mono=rgb(cpu.memory,config({start:160,width:32,height:8,mode:'mono',palette:'1bit_monitor_glow'}));
  assert.notEqual(color.length,mono.length);
  assert.deepEqual(cpu.snapshot(),before);
});
test('.display is metadata only; no emitted bytes and .equ constants work', () => {
  const program=assemble('BASE .equ 0x80\n.display BASE, 32, 8, mono, 1bit_monitor_glow\nLDI A, 5\nHLT');
  assert.deepEqual(Array.from(program.bytes),[0x10,0,5,0x01]);
  assert.equal(program.display.start,128);assert.equal(program.display.width,32);
  assert.equal(program.sourceMap.get(0),3);
});
test('new packed graphics examples fit within RAM and produce expected graphics', () => {
  for(const name of ['09-monochrome-32x8.asm','10-cga-2bit.asm','11-pico8-4bit.asm','13-rgb332.asm','14-rgb24.asm']) {
    const asm=example(name),cpu=run(asm);
    assert.ok(cpu.halted,name);
    const c=validateDisplay(asm.display);assert.ok(c.endExclusive<=256,name);
    assert.equal(rgb(cpu.memory,c).length,c.width*c.height);
  }
});
test('self-modifying code patches an immediate operand, not just the source string', () => {
  const asm=example('12-self-modifying.asm'),cpu=new MiniCPU(asm.memory);
  const before=Array.from(cpu.memory);
  cpu.step();cpu.step();
  assert.equal(cpu.memory[10],42); // target LDI immediate byte at address 10
  assert.notDeepEqual(Array.from(cpu.memory),before);
  cpu.step();cpu.step();cpu.step();
  assert.equal(cpu.registers[1],42);assert.equal(cpu.halted,true);
});

test('palette definitions have the expected historic sizes', () => {
  assert.equal(PALETTES.vga.length,256);
  assert.equal(PALETTES.pico_8.length,16);
  assert.equal(PALETTES.cga_palette_1_high.length,4);
});
test('invalid .display reports source-line assembly error, not an unusable CPU', () => {
  for (const directive of [
    '.display 0xFF, 8, 2, mono, 1bit_monitor_glow',
    '.display 0x80, 16, 8, rgb24, pico_8',
    '.display 0x80, 16, 8, indexed4, nonexistent_palette',
    '.display 0x80, 16, 8, indexed4, cga_palette_1_high',
    '.display 0x80, 16, 8, indexed8, pico_8',
    '.display 0x80, 16, 8, indexed2',
    '.display 0x80, 16, 8, indexed6, pico_8',
  ]) assert.throws(()=>assemble('HLT\n'+directive), e => e.name === 'AssemblyError' && e.line === 2);
});

test('indexed palettes must exactly match the current pixel bit depth', () => {
  const mem = new Uint8Array(256);
  assert.throws(() => rgb(mem, config({mode:'indexed4',palette:'vga',width:2,height:2})), /16 entries/);
  assert.throws(() => rgb(mem, config({mode:'mono',palette:'cga_palette_1_high',width:2,height:2})), /2 entries/);
  const names = Object.entries(PALETTES).filter(([, colors]) => colors.length === 16).map(([name]) => name);
  assert.ok(names.includes('pico_8') && names.includes('sweetie_16'));
  assert.ok(!names.includes('vga'));
});
test('stride parameter is removed from the assembler syntax', () => {
  assert.throws(() => assemble('HLT\n.display 0x80, 16, 8, mono, 2, 1bit_monitor_glow'), /needs start, width, height, mode/);
  assert.equal(assemble('HLT\n.display 0x80, 16, 8, gray8').display.palette, null);
  assert.equal(assemble('HLT\n.display 0xA0, 8, 8, mono, 1bit_monitor_glow').display.width, 8);
});
test('32x16 monochrome animation stays within 256-byte unified RAM', () => {
  const asm = example('15-checkerboard-animation.asm');
  const cpu = new MiniCPU(asm.memory);
  assert.equal(validateDisplay(asm.display).bytesSpanned, 64);
  assert.ok(asm.loadedBytes <= 192);
  const firstImage = Array.from(cpu.memory.slice(0, asm.loadedBytes));
  for (let i=0;i<1000;i++) {
    cpu.step();
    if (cpu.cycles > 10 && cpu.pc === asm.labels.get('frame')) break;
  }
  assert.deepEqual(Array.from(cpu.memory.slice(0, asm.loadedBytes)), firstImage);
  assert.equal(cpu.memory[0xC0],0xAA);
  assert.equal(cpu.memory[0xC4],0x55);
  for (let i=0;i<1000;i++) {
    cpu.step();
    if (cpu.cycles > 350 && cpu.pc === asm.labels.get('frame')) break;
  }
  assert.equal(cpu.memory[0xC0],0x55);
  assert.equal(cpu.memory[0xC4],0xAA);
  assert.ok(!cpu.halted);
});

test('colorful 4-bit interference demo animates without changing program bytes', () => {
  const asm = example('16-rainbow-interference.asm');
  assert.ok(asm.loadedBytes < 0x80, 'program must fit before the bitmap at 0x80');
  assert.equal(asm.display.mode, 'indexed4');
  assert.equal(asm.display.width * asm.display.height, 256);
  assert.equal(validateDisplay(asm.display).bytesSpanned, 128);
  const cpu = new MiniCPU(asm.memory);
  const code = Array.from(cpu.memory.slice(0, 0x80));
  for (let i=0;i<1500;i++) cpu.step();
  assert.ok(!cpu.halted, 'endless animation should be stoppable with Pause');
  const frame1 = Array.from(cpu.memory.slice(0x80));
  const colors = renderDisplay(cpu.memory, asm.display, PALETTES).map(p => p.color);
  assert.ok(new Set(colors).size >= 12, 'rainbow graphic should use many colors');
  for (let i=0;i<1500;i++) cpu.step();
  assert.notDeepEqual(Array.from(cpu.memory.slice(0x80)), frame1, 'animation evolves over time');
  assert.deepEqual(Array.from(cpu.memory.slice(0, 0x80)), code, 'graphics must not overwrite executable code');
});

test('static plasma garden renders a full 16-color image entirely in 256-byte shared RAM', () => {
  const asm = example('17-plasma-garden.asm');
  const frame = validateDisplay(asm.display);
  assert.deepEqual([frame.width, frame.height, frame.bits, frame.bytesSpanned], [16, 16, 4, 128]);
  assert.equal(frame.start, 0x80);
  assert.equal(asm.labels.get('diagonal'), 0x6F);
  assert.equal(asm.labels.get('wave'), 0x70);
  assert.equal(PALETTES.aurora_cycle_16.length, 16);
  assert.ok(asm.listing.filter(x => x.address < 0x6F).every(x => x.address + x.size <= 0x6F));

  const cpu = run(asm, 10000);
  assert.equal(cpu.halted, true, 'single-frame demo must halt');
  assert.equal(cpu.cycles, 5762, 'demo execution should remain deterministic');
  assert.deepEqual(Array.from(cpu.memory.slice(0, 0x6F)), Array.from(asm.memory.slice(0, 0x6F)), 'instructions are untouched');
  assert.deepEqual(Array.from(cpu.memory.slice(0x70, 0x80)), Array.from(asm.memory.slice(0x70, 0x80)), 'wave table is untouched');
  const pixels = renderDisplay(cpu.memory, asm.display, PALETTES);
  assert.equal(pixels.length, 256);
  assert.equal(new Set(pixels.map(p => p.index)).size, 16, 'all sixteen colors appear');
  assert.ok(new Set(cpu.memory.slice(0x80)).size >= 14, 'the program computes a varied image, not a flat fill');
  assert.notDeepEqual(Array.from(cpu.memory.slice(0x80)), Array.from(asm.memory.slice(0x80)));

  const before = cpu.snapshot();
  const alternative = renderDisplay(cpu.memory, {...asm.display, palette:'pico_8'}, PALETTES);
  assert.notDeepEqual(alternative.map(p => p.color), pixels.map(p => p.color));
  assert.deepEqual(cpu.snapshot(), before, 'changing the display palette does not alter the CPU');
});
