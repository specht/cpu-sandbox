import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, AssemblyError } from '../src/assembler.js';
import { MiniCPU, CpuFault, disassemble } from '../src/cpu.js';
import { ARCHITECTURES } from '../src/architectures.js';
import { OPCODES as OP, INSTRUCTIONS, cyclesOf, sizeOf } from '../src/opcodes.js';

const run = (source, limit = 100000) => {
  const asm = assemble(source);
  const cpu = new MiniCPU(asm.memory, asm.architecture);
  while (!cpu.halted && cpu.instructions < limit) cpu.step();
  return { asm, cpu };
};
const fails = (source, pattern, line = 1) => assert.throws(() => assemble(source),
  e => e instanceof AssemblyError && e.line === line && pattern.test(e.message), source);

test('the opcode table is unique, grouped by family, and only grows with the CPU level', () => {
  assert.equal(new Set(INSTRUCTIONS.map(i => i.code)).size, INSTRUCTIONS.length);
  const family = { Control: 0, 'Data movement': 1, Arithmetic: 2, Logic: 3, Comparison: 4, Stack: 5, Jumps: 6, 'Input/output': 7 };
  for (const i of INSTRUCTIONS) assert.equal(i.code >> 4, family[i.family], i.name);
  assert.deepEqual(INSTRUCTIONS.map(i => i.code), INSTRUCTIONS.map(i => i.code).sort((a, b) => a - b));
});

test('LDI / ADD / HLT encode as documented', () => {
  const { asm, cpu } = run('LDI A, 5\nLDI B, 3\nADD A, B\nHLT');
  assert.deepEqual(Array.from(asm.memory.slice(0, 9)), [OP.LDI, 0, 5, OP.LDI, 1, 3, OP.ADD, 0x01, OP.HLT]);
  assert.equal(cpu.registers[0], 8);
  assert.equal(cpu.instructions, 4);
  assert.equal(cpu.cycles, 3 + 3 + 2 + 1);
});

test('flags: CF is carry for ADD/INC/SHL and borrow for SUB/DEC/CMP', () => {
  let { cpu } = run('LDI A, 255\nINC A\nHLT');
  assert.equal(cpu.registers[0], 0); assert.ok(cpu.zf && cpu.cf);
  ({ cpu } = run('LDI A, 2\nCMP A, 3\nHLT'));
  assert.ok(cpu.cf && !cpu.zf);
  ({ cpu } = run('LDI A, 0x81\nSHR A\nHLT'));
  assert.equal(cpu.registers[0], 0x40); assert.ok(cpu.cf);
  ({ cpu } = run('LDI A, 0xF0\nLDI B, 0x0F\nAND A, B\nHLT'));
  assert.ok(cpu.zf && !cpu.cf);
});

test('expressions: arithmetic, shifts, masks, characters and negative bytes', () => {
  const asm = assemble("W .equ 16\nLDI A, 2 * W + 1\nLDI B, 0x1234 >> 8 & 0xF\nLDI C, 'A'\nLDI D, -1\nHLT");
  assert.deepEqual([asm.memory[2], asm.memory[5], asm.memory[8], asm.memory[11]], [33, 2, 65, 255]);
});

test('helpful assembly errors point at the right line', () => {
  fails('WHOOPS', /Unknown instruction/);
  fails('top:\ntop:\nHLT', /defined twice/, 2);
  fails('LDI A, 300', /does not fit in a byte/);
  fails('.org 0xFF\nLDI A, 4', /does not fit/, 2);
  fails('C: HLT', /register name/);
  fails('LDA A, 0x70', /write LDA A, \[0x70\] for the byte at address 0x70, or LDI A, 0x70/);
  fails('STA 0x70, A', /write STA \[0x70\], A/);
  fails('LDI A, [0x70]', /LDA A, \[0x70\]/);
  fails('PUSH A', /needs MiniCPU 8S or 8X/);
  fails('LDI X, 0x100', /needs MiniCPU 8X/);
  fails('.cpu 8x\nSHL X', /X and Y work with LDI, LDA, STA/, 2);
  fails('.cpu 8x\nADD A, X', /does not fit into 8 bits/, 2);
  fails('.cpu 8x\nMOV A, X', /same size/, 2);
  fails('.cpu 8s\nLDA A, [X]', /needs MiniCPU 8X/, 2);
  fails('.cpu 8s\nMOV XL, A', /needs MiniCPU 8X/, 2);
  fails('.cpu 8x\nINC XL', /only be used with MOV/, 2);
  fails('.cpu 9', /\.cpu expects/);
});

test('.cpu chooses the level; without it the option (default MiniCPU 8) applies', () => {
  assert.equal(assemble('HLT').architecture, 'cpu8');
  assert.equal(assemble('HLT', { architecture: 'cpu8s' }).architecture, 'cpu8s');
  assert.equal(assemble('; comment\n.cpu 8X\nHLT').architecture, 'cpu8x');
  assert.equal(assemble('.cpu 8s\nHLT', { architecture: 'cpu8x' }).architecture, 'cpu8s');
});

test('MiniCPU 8X uses two-byte addresses for LDA, STA, jumps and CALL', () => {
  const asm = assemble('.cpu 8x\nLDA A, [0x0812]\nSTA [0x0F00], B\nJMP far\n.org 0x0300\nfar: CALL sub\nHLT\nsub: RET');
  assert.deepEqual(Array.from(asm.memory.slice(0, 12)), [OP.LDA, 0, 0x12, 0x08, OP.STA, 0x00, 0x0F, 1, OP.JMP, 0x00, 0x03, 0]);
  const cpu = new MiniCPU(asm.memory, 'cpu8x');
  for (let i = 0; i < 4; i++) cpu.step();
  assert.equal(cpu.pc, 0x0304);
  assert.equal(cpu.sp, 4094);
  assert.deepEqual([cpu.memory[4094], cpu.memory[4095]], [0x03, 0x03], 'return address, low byte first');
  cpu.step();
  assert.equal(cpu.pc, 0x0303);
  assert.equal(cpu.sp, 4096);
});

test('the same source assembles to longer code on 8X, but computes the same', () => {
  const source = 'LDI A, 13\nLDI B, 4\nLDI C, 0\nloop: CMP A, B\nJC done\nSUB A, B\nINC C\nJMP loop\ndone: STA [0x70], C\nHLT';
  const small = run(source), wide = run('.cpu 8x\n' + source);
  assert.equal(wide.asm.loadedBytes - small.asm.loadedBytes, 3);
  assert.deepEqual(Array.from(small.cpu.registers), Array.from(wide.cpu.registers));
  assert.equal(wide.cpu.memory[0x70], 3);
  assert.ok(wide.cpu.cycles > small.cpu.cycles);
});

test('MOV with XL/XH/YL/YH builds pointers from 8-bit values', () => {
  const { cpu } = run('.cpu 8x\nLDI A, 0x08\nLDI B, 0x34\nMOV XH, A\nMOV XL, B\nLDI C, 99\nSTA [X], C\nMOV YL, B\nMOV D, XH\nHLT');
  assert.equal(cpu.x, 0x0834);
  assert.equal(cpu.memory[0x0834], 99);
  assert.equal(cpu.y, 0x0034);
  assert.equal(cpu.registers[3], 0x08);
});

test('8S: PUSH/POP keep the flags, nested calls balance the stack', () => {
  const { cpu } = run('.cpu 8s\nLDI A, 3\nCMP A, 4\nPUSH A\nCALL f\nPOP B\nHLT\nf: CALL g\nRET\ng: RET');
  assert.equal(cpu.registers[1], 3);
  assert.ok(cpu.cf);
  assert.equal(cpu.sp, 256);
});

test('8S: [SP+n] reads and writes the stack without popping it', () => {
  const asm = assemble('.cpu 8s\nLDI A, 7\nPUSH A\nCALL f\nPOP B\nHLT\nf: LDA C, [SP+1]\nINC C\nSTA [SP+1], C\nLDA D, [SP]\nRET');
  assert.deepEqual(Array.from(asm.memory.slice(10, 13)), [OP.LDA_SP, 2, 1]);
  const cpu = new MiniCPU(asm.memory, 'cpu8s');
  while (!cpu.halted) cpu.step();
  assert.equal(cpu.registers[1], 8, 'the callee changed the argument slot');
  assert.equal(cpu.registers[3], 7, '[SP] was the low byte of the return address');
  assert.equal(cpu.sp, 256);
  fails('LDA A, [SP+1]', /with \[SP\+n\] needs MiniCPU 8S/);
  fails('SUB SP, 2', /SUB SP needs MiniCPU 8S/);
  const frame = run('.cpu 8s\nSUB SP, 3\nLDI A, 9\nSTA [SP+2], A\nLDA B, [SP+2]\nADD SP, 3\nHLT').cpu;
  assert.equal(frame.memory[255], 9);
  assert.equal(frame.registers[1], 9);
  assert.equal(frame.sp, 256);
  assert.throws(() => run('.cpu 8s\nADD SP, 1'), /underflow/);
});

test('IN and OUT talk to devices at ports on every level, and can be undone', () => {
  const asm = assemble('IN A, 0x03\nIN B, 0x02\nOUT 0x11, A\nIN C, 0x00\nIN D, 0x01\nHLT');
  assert.deepEqual(asm.ports, [0x00, 0x01, 0x02, 0x03, 0x11]);
  assert.deepEqual(Array.from(asm.memory.slice(0, 3)), [OP.IN, 0, 3]);
  const cpu = new MiniCPU(asm.memory, 'cpu8', { clockHz: 60 });
  cpu.io.joystick = 0b10010;
  cpu.io.type('Hi');
  while (!cpu.halted) cpu.step();
  assert.equal(cpu.registers[1], 4, 'timer: 4 cycles at 60 Hz = 4 ticks');
  assert.equal(cpu.io.outputs.get(0x11), cpu.registers[0]);
  assert.equal(cpu.registers[2], 0b10010);
  assert.equal(cpu.registers[3], 72);
  assert.equal(cpu.cycles, 4 * 5 + 1);
  cpu.back(); cpu.back(); cpu.back(); cpu.back();
  assert.equal(cpu.io.outputs.has(0x11), false, 'stepping back removes the output again');
  fails('IN A, 0x42', /Nothing is plugged into port 0x42/);
  fails('OUT 0x00, A', /only supports IN/);
  fails('IN A, 0x10', /only supports OUT/);
});

test('cycle model: bytes fetched + data accesses + PC loads + pointer math', () => {
  const [cpu8, cpu8x] = [ARCHITECTURES.cpu8, ARCHITECTURES.cpu8x];
  const info = name => INSTRUCTIONS.find(i => i.name === name);
  assert.equal(cyclesOf(info('LDI'), cpu8), 3);
  assert.equal(cyclesOf(info('LDA'), cpu8), 4);
  assert.equal(cyclesOf(info('LDA'), cpu8x), 5);
  assert.equal(cyclesOf(info('JZ'), cpu8, { taken: false }), 2);
  assert.equal(cyclesOf(info('JZ'), cpu8, { taken: true }), 3);
  assert.equal(cyclesOf(info('CALL'), ARCHITECTURES.cpu8s), 4);
  assert.equal(cyclesOf(info('CALL'), cpu8x), 6);
  assert.equal(cyclesOf(info('INC'), cpu8x, { wide: true }), 3);
  assert.equal(cyclesOf(info('LDI'), cpu8x, { wide: true }), 5);
  assert.equal(cyclesOf(info('LDA'), cpu8x, { wide: true }), 6);
  assert.equal(cyclesOf(info('SUB_SP'), cpu8x), 3);
  assert.equal(sizeOf(info('JMP'), cpu8x), 3);
  const { cpu } = run('LDI A, 1\nCMP A, 1\nJZ next\nnext: JNZ next\nHLT');
  assert.equal(cpu.cycles, 3 + 3 + 3 + 2 + 1);
});

test('every step can be undone exactly, including RAM writes', () => {
  const asm = assemble('.cpu 8s\nLDI A, 0x80\nloop: STA [A], A\nPUSH A\nPOP B\nINC A\nJNZ loop\nHLT');
  const cpu = new MiniCPU(asm.memory, 'cpu8s');
  const start = { memory: cpu.memory.slice(), registers: cpu.registers.slice() };
  let steps = 0;
  while (!cpu.halted) { cpu.step(); steps++; }
  assert.ok(steps > 500);
  while (cpu.back()) steps--;
  assert.equal(steps, 0);
  assert.deepEqual(cpu.memory, start.memory);
  assert.deepEqual(cpu.registers, start.registers);
  assert.equal(cpu.pc, 0); assert.equal(cpu.cycles, 0); assert.equal(cpu.sp, 256);
});

test('the undo history is bounded', () => {
  const asm = assemble('loop: INC A\nJMP loop');
  const cpu = new MiniCPU(asm.memory, 'cpu8', { historySize: 10 });
  for (let i = 0; i < 25; i++) cpu.step();
  let undone = 0;
  while (cpu.back()) undone++;
  assert.equal(undone, 10);
  assert.equal(cpu.instructions, 15);
});

test('faults leave the state unchanged and stop the CPU until undone', () => {
  const cpu = new MiniCPU(Uint8Array.from([OP.LDI, 0, 7, 0xAA]));
  cpu.step();
  assert.throws(() => cpu.step(), e => e instanceof CpuFault && e.pc === 3 && /Unknown opcode/.test(e.message));
  assert.equal(cpu.pc, 3);
  assert.equal(cpu.step(), null);
  cpu.back();
  assert.equal(cpu.fault, null);
  assert.throws(() => new MiniCPU(assemble('.cpu 8s\nPOP A').memory, 'cpu8s').step(), /underflow/);
  assert.throws(() => new MiniCPU(Uint8Array.from([OP.PUSH, 0]), 'cpu8').step(), /needs MiniCPU 8S/);
});

test('the disassembler reproduces every listing line', () => {
  const asm = assemble('.cpu 8x\nLDI A, 5\nLDA B, [C]\nSTA [X], D\nMOV XL, A\nLDA A, [0x0812]\nCMP A, B\nJNZ 0x0100\nLDI X, 0x0800\nINC Y\nCMP X, 0x0806\nADD A, 16\nSTA [0x0123], Y\nPUSH X\nSUB SP, 4\nIN B, 2\nOUT 0x10, C\nLDA A, [SP+3]\nSTA [SP+0], B\nRET');
  const texts = asm.listing.map(e => disassemble(asm.memory, e.address, ARCHITECTURES.cpu8x).text);
  assert.deepEqual(texts, ['LDI A, 5', 'LDA B, [C]', 'STA [X], D', 'MOV XL, A', 'LDA A, [0x0812]', 'CMP A, B', 'JNZ 0x0100', 'LDI X, 0x0800', 'INC Y', 'CMP X, 0x0806', 'ADD A, 16', 'STA [0x0123], Y', 'PUSH X', 'SUB SP, 4', 'IN B, 0x02', 'OUT 0x10, C', 'LDA A, [SP+3]', 'STA [SP+0], B', 'RET']);
});

test('one instruction set: X and Y take part in loads, stores, arithmetic and the stack', () => {
  const { asm, cpu } = run(`.cpu 8x
        LDI X, 0x0800
        LDI Y, 0x0FFE
        STA [0x0700], X         ; two bytes, low byte first
        LDA Y, [0x0700]
        ADD X, 0x0100
        ADD X, A                ; an 8-bit register is added to all 16 bits
        INC Y
        PUSH X
        POP Y
        LDI A, 0xFF
        LDI B, 0x01
        ADD A, B                ; A = 0, CF = 1
        ADC B, 0                ; B = 2
        SBC A, 0                ; A = 0 − 0 − 0 = 0 … CF was cleared by ADC
        CMP X, 0x0900
        HLT`);
  assert.deepEqual(Array.from(asm.memory.slice(0, 4)), [OP.LDI, 8, 0x00, 0x08]);
  assert.deepEqual([cpu.memory[0x0700], cpu.memory[0x0701]], [0x00, 0x08]);
  assert.equal(cpu.x, 0x0900);
  assert.equal(cpu.y, 0x0900);
  assert.equal(cpu.registers[1], 2);
  assert.ok(cpu.zf && !cpu.cf, 'CMP X, 0x0900 compares all 16 bits');
  let flags = run('.cpu 8x\nLDI X, 0xFFFF\nINC X\nHLT').cpu;
  assert.equal(flags.x, 0); assert.ok(flags.zf && flags.cf, '16-bit carry');
  flags = run('.cpu 8x\nLDI X, 0x00FF\nINC X\nHLT').cpu;
  assert.equal(flags.x, 0x0100); assert.ok(!flags.zf && !flags.cf, 'no carry out of the low byte');
});

test('immediates work with every arithmetic and logic instruction on every level', () => {
  const { cpu } = run('LDI A, 10\nADD A, 5\nSUB A, 3\nAND A, 0x0E\nOR A, 0x10\nXOR A, 0x01\nLDI B, 250\nADD B, 10\nADC C, 0\nHLT');
  assert.equal(cpu.registers[0], ((10 + 5 - 3) & 0x0E | 0x10) ^ 1);
  assert.equal(cpu.registers[1], 4);
  assert.equal(cpu.registers[2], 1, 'ADC added the carry of ADD B, 10');
});

test('the formatter aligns labels, instructions and comments without changing the bytes', async () => {
  const { formatSource } = await import('../src/format.js');
  const source = 'size .equ 16\nlong_name .equ 2\nloop: ldi a,size ; count\n  sta [ 0x70 ],a\n   ; note\n.ORG 0x40\nmsg:   .db "a;b, c",  0\nhlt';
  assert.equal(formatSource(source), [
    'size      .equ 16',
    'long_name .equ 2',
    'loop:   LDI A, size             ; count',
    '        STA [0x70], A',
    '        ; note',
    '.org 0x40',
    'msg:    .db "a;b, c",  0',
    '        HLT'].join('\n'));
  assert.deepEqual(assemble(formatSource(source)).memory, assemble(source).memory);
  assert.equal(formatSource(formatSource(source)), formatSource(source));
});
