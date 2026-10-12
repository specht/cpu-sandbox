import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../src/build.js';
import { MiniCPU } from '../src/cpu.js';
import { memoryMap, stackItems, describe, REGION } from '../src/memorymap.js';

test('the RAM map knows code, data and labels of an assembly program', () => {
  const program = build('        LDI A, 5\nloop:   DEC A\n        JNZ loop\n        HLT\ncount:  .db 7, 8\n', 'asm');
  const map = memoryMap(program);
  assert.equal(map.region[0], REGION.CODE);
  const count = program.labels.get('count');
  assert.equal(map.region[count], REGION.DATA);
  assert.equal(map.region[count + 2], REGION.FREE);
  assert.ok(map.starts[count] && map.starts[program.labels.get('loop')]);
  assert.match(describe(map, program, count + 1, 8), /count: data/);
  assert.match(describe(map, program, 3, 0x28), /DEC A · line 2/);
});

test('C: globals, arrays, strings and helper routines are named; the stack shows frames', () => {
  const source = `int total;
char letters[4];
char *greeting = "hi";
int twice(int n) { int result = n * 3 - n; return result; }
void main() { total = twice(21); }`;
  const program = build(source, 'c');
  const map = memoryMap(program);
  const total = program.labels.get('_total'), letters = program.labels.get('_letters');
  assert.match(describe(map, program, total + 1, 0), /int total · global variable · high byte/);
  assert.match(describe(map, program, letters + 2, 0), /char letters\[4\] · global variable · letters\[2\]/);
  assert.match(describe(map, program, program.labels.get('string_1'), 104), /string "hi"/);
  assert.match(describe(map, program, program.labels.get('mul16'), 0), /helper routine/);

  // Stop inside twice(), after result was stored.
  const cpu = new MiniCPU(program.memory, program.architecture, { historySize: 1 });
  const stop = program.labels.get('return_twice');
  while (!cpu.halted && cpu.pc !== stop) cpu.step();
  const frames = stackItems(program, cpu);
  const names = frames.map(f => `${f.kind}:${f.name}`);
  assert.deepEqual(names.slice(0, 3), ['local:result', 'return:return address', 'argument:n']);
  const result = frames[0];
  assert.equal(cpu.memory[result.start] | cpu.memory[result.start + 1] << 8, 42);
  assert.match(describe(map, program, frames[2].start, 21, frames), /int n · argument of twice\(\)/);
  assert.ok(frames.some(f => f.kind === 'return' && /main/.test(f.detail)), 'the frame of main follows');
});
