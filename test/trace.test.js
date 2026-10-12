import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from '../src/build.js';
import { assemble } from '../src/assembler.js';
import { MiniCPU } from '../src/cpu.js';
import { traceInstruction } from '../src/trace.js';

test('a trace has exactly the cycles of the instruction, and changes nothing', () => {
  const dir = new URL('../examples/', import.meta.url);
  for (const file of fs.readdirSync(dir)) {
    const program = build(fs.readFileSync(new URL(file, dir), 'utf8'), file.endsWith('.c') ? 'c' : 'asm');
    const cpu = new MiniCPU(program.memory, program.architecture, { historySize: 1 });
    for (let i = 0; i < 3000 && !cpu.halted; i++) {
      const before = { pc: cpu.pc, a: cpu.registers[0], cycles: cpu.cycles, typed: cpu.io.typed.length };
      const trace = traceInstruction(cpu);
      assert.deepEqual({ pc: cpu.pc, a: cpu.registers[0], cycles: cpu.cycles, typed: cpu.io.typed.length }, before, `${file}: the trace changed the machine`);
      const cycles = cpu.step();
      if (trace.cycles.some(c => c.kind === 'in' && c.port === 0x04)) continue;   // vsync idles
      assert.equal(trace.cycles.length, cycles, `${file} @${before.pc.toString(16)} ${trace.text}: ${trace.cycles.map(c => c.kind).join(' ')}`);
      assert.equal(trace.cycles[0].kind, 'fetch');
      const internal = trace.cycles.filter(c => c.kind === 'alu').length;
      if (internal) assert.ok(internal === 1 && /\b(X|Y|SP)\b/.test(trace.text), `${file}: ${trace.text} has ${internal} internal cycles`);
    }
  }
});

test('the cycles of a load, a store, a call and a jump', () => {
  const asm = assemble('.cpu 8s\nLDA A, [0x80]\nSTA [0x81], A\nCALL sub\nHLT\nsub: RET');
  const cpu = new MiniCPU(asm.memory, 'cpu8s');
  cpu.memory[0x80] = 42;
  const kinds = () => traceInstruction(cpu).cycles.map(c => c.kind).join(' ');
  assert.equal(kinds(), 'fetch fetch fetch read');
  assert.deepEqual(traceInstruction(cpu).cycles[3], { kind: 'read', address: 0x80, value: 42 });
  cpu.step();
  assert.equal(kinds(), 'fetch fetch fetch write');
  cpu.step();
  assert.equal(kinds(), 'fetch fetch write jump');
  cpu.step();
  assert.equal(kinds(), 'fetch read jump');
});
