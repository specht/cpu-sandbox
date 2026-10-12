import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../src/assembler.js';
import { MiniCPU } from '../src/cpu.js';
import { explainFlags } from '../src/flags.js';

/** Runs every instruction and returns the explanations after the last one. */
function after(source, profile = 'cpu8') {
  const asm = assemble(source);
  const cpu = new MiniCPU(asm.memory, profile);
  const steps = asm.listing.filter(e => e.kind === 'code').length;
  for (let i = 0; i < steps - 1; i++) cpu.step();   // up to the instruction before HLT
  return explainFlags(cpu);
}

test('the flags are explained from the last instruction and its values', () => {
  assert.equal(after('LDI A, 200\nLDI B, 100\nADD A, B\nHLT').CF,
    '200 + 100 = 300 does not fit into 8 bits, so CF = 1 and A keeps 300 − 256 = 44.');
  assert.equal(after('LDI A, 20\nADD A, 30\nHLT').CF, '20 + 30 = 50 fits into 8 bits, so CF = 0.');
  const cmp = after('LDI A, 3\nCMP A, 5\nHLT');
  assert.match(cmp.CF, /^3 − 5 = -2: 3 is smaller than 5, a borrow is needed, so CF = 1\./);
  assert.equal(cmp.ZF, 'CMP A, 5: 3 and 5 differ, so ZF = 0.');
  assert.equal(after('LDI A, 7\nCMP A, 7\nHLT').ZF, 'CMP A, 7: both values are 7, the difference is 0, so ZF = 1.');
  assert.equal(after('LDI A, 1\nDEC A\nHLT').ZF, 'the result of DEC A is 0, so ZF = 1.');
  assert.equal(after('LDI A, 0\nDEC A\nHLT').CF, '0 − 1 = -1: 0 is smaller than 1, a borrow is needed, so CF = 1 and A becomes -1 + 256 = 255.');
  assert.equal(after('LDI A, 0x0F\nAND A, 0xF0\nHLT').CF, 'AND always clears the carry: CF = 0.');
  assert.match(after('LDI A, 0x81\nSHL A\nHLT').CF, /SHL shifts bit 7 of 129 \(0b10000001\) out into the carry: it was 1, so CF = 1\./);
  assert.match(after('LDI A, 5\nHLT\n').ZF ?? '', /^LDI does not change the flags/);
});

test('16-bit arithmetic is explained with 16 bits', () => {
  const r = after('.cpu 8x\nLDI X, 0xFFFF\nINC X\nHLT', 'cpu8x');
  assert.equal(r.CF, '65535 + 1 = 65536 does not fit into 16 bits, so CF = 1 and X keeps 65536 − 65536 = 0.');
  assert.equal(r.ZF, 'the result of INC X is 0, so ZF = 1.');
});
