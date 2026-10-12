/**
 * Tasks with automatic checks. A program belongs to a task through a comment
 * line near the top, "; Task: add" in assembly or "// Task: add" in C. The
 * checks run each test case on a fresh machine: the task puts its input into
 * RAM or types keys, the program runs until HLT, and the result is compared
 * with what the task expects. The browser (Check button) and the server
 * (class progress) use this same module.
 *
 * A task:
 *   id, title, cpu        the marker name, a title, the CPU level for new programs
 *   text                  what to do (shown above the editor)
 *   starter: { asm, c }   the beginning of a new program
 *   limit                 cycles per case before the program counts as stuck
 *   cases: [{ name, memory: { address: [bytes] }, typed: 'text', expect }]
 *   expect: { A: 7, memory: { address: [bytes] }, numbers: [10, 9, …], check(run) }
 *     check(run) returns a message when something is wrong, else null; run has
 *     cpu, memory, numbers (values written to the number display) and read(address).
 */
import { build } from './build.js';
import { MiniCPU, CpuFault, hex } from './cpu.js';
import { Devices, PORT } from './devices.js';

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const bytes = text => [...text].map(c => c.charCodeAt(0));
const show = list => list.length > 12 ? `${list.slice(0, 12).join(' ')} …` : list.join(' ');
const at = (address, values) => ({ [address]: values });

const ASM_HEAD = (id, cpu) => `; Task: ${id}\n${cpu === 'cpu8' ? '' : `.cpu ${cpu.slice(3)}\n`}`;
const C_HEAD = (id, cpu) => `// Task: ${id}\n#pragma cpu ${cpu.slice(3)}\n`;

function task(spec) {
  const level = spec.cpu ?? 'cpu8';
  return Object.freeze({
    limit: 200_000,
    ...spec,
    cpu: level,
    starter: {
      asm: `${ASM_HEAD(spec.id, level)}${spec.starter?.asm ?? '\n        HLT\n'}`,
      c: `${C_HEAD(spec.id, level === 'cpu8' ? 'cpu8s' : level)}${spec.starter?.c ?? '\nvoid main() {\n}\n'}`,
    },
  });
}

export const TASKS = Object.freeze([
  task({
    id: 'add', title: 'Add two numbers',
    text: 'The bytes at 0x80 and 0x81 hold two numbers. Write their sum to 0x82, then halt. The sum is always below 256.',
    starter: { asm: '\n        LDA A, [0x80]\n        ; …\n        HLT\n', c: '\n#define IN1 (*(char*)0x80)\n#define IN2 (*(char*)0x81)\n#define SUM (*(char*)0x82)\n\nvoid main() {\n    // …\n}\n' },
    cases: [[3, 4], [200, 55], [0, 0], [100, 27], [1, 254]].map(([a, b]) => ({
      name: `${a} + ${b}`, memory: at(0x80, [a, b]), expect: { memory: at(0x82, [a + b]) },
    })),
  }),
  task({
    id: 'countdown', title: 'Countdown',
    text: 'Show 10, 9, 8, …, 1, 0 on the number display (OUT to port 0x11), one after the other, then halt.',
    cases: [{ name: '10 to 0', expect: { numbers: range(11, i => 10 - i) } }],
  }),
  task({
    id: 'maximum', title: 'The largest number',
    text: 'The eight bytes at 0x80–0x87 are numbers 0–255. Leave the largest of them in A, then halt.',
    cases: [[3, 9, 2, 7, 1, 8, 5, 4], [255, 0, 0, 0, 0, 0, 0, 0], [1, 2, 3, 4, 5, 6, 7, 200], [7, 7, 7, 7, 7, 7, 7, 7], [0, 0, 0, 0, 0, 0, 0, 0], [12, 130, 129, 128, 250, 3, 251, 99]]
      .map(list => ({ name: show(list), memory: at(0x80, list), expect: { A: Math.max(...list) } })),
  }),
  task({
    id: 'length', title: 'Length of a text',
    text: 'A text starts at 0x80; a byte 0 marks its end. Leave the number of characters in A, then halt.',
    cases: ['Hello', '', 'A', 'MiniCPU 8 is small', 'abcdefghijklmnopqrstuvwxyz'].map(s => ({
      name: `"${s}"`, memory: at(0x80, [...bytes(s), 0]), expect: { A: s.length },
    })),
  }),
  task({
    id: 'multiply', title: 'Multiply',
    text: 'Multiply the bytes at 0x80 and 0x81. Write the 16-bit product to 0x82 (low byte) and 0x83 (high byte), then halt. There is no multiplication instruction: add, or shift and add.',
    limit: 400_000,
    cases: [[6, 7], [0, 99], [99, 0], [255, 255], [16, 16], [3, 200], [200, 3]].map(([a, b]) => ({
      name: `${a} × ${b}`, memory: at(0x80, [a, b]), expect: { memory: at(0x82, [(a * b) & 255, (a * b) >> 8]) },
    })),
  }),
  task({
    id: 'checkerboard', title: 'Checkerboard',
    text: 'The screen is 16 × 8 gray pixels at 0x80, one byte per pixel, row after row. Paint a checkerboard: pixel (x, y) is 255 where x + y is even and 0 where it is odd. Then halt.',
    starter: { asm: '.display 0x80, 16, 8, gray8\n\n        HLT\n', c: '#pragma display 0x80, 16, 8, gray8\n\nvoid main() {\n}\n' },
    cases: [{
      name: '16 × 8 pixels',
      memory: at(0x80, range(128, i => (i * 37) & 255)),     // not a clean screen: every pixel must be set
      expect: { memory: at(0x80, range(128, i => ((i % 16) + (i >> 4)) % 2 ? 0 : 255)) },
    }],
  }),
  task({
    id: 'sort', title: 'Sort',
    text: 'Sort the eight bytes at 0x80–0x87 into ascending order, in place, then halt.',
    limit: 400_000,
    cases: [[5, 3, 8, 1, 9, 2, 7, 4], [1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1], [9, 9, 1, 1, 255, 0, 128, 127], [0, 0, 0, 0, 0, 0, 0, 0]]
      .map(list => ({ name: show(list), memory: at(0x80, list), expect: { memory: at(0x80, [...list].sort((a, b) => a - b)) } })),
  }),
  task({
    id: 'digits', title: 'Typed digits',
    text: 'Read the keyboard (port 0x01, 0 while nothing was typed). Show every typed digit 0–9 on the number display as its value (the key 7 shows 7), ignore other characters, and halt after Enter (13).',
    cases: [['42\r', [4, 2]], ['a1b2c3\r', [1, 2, 3]], ['\r', []], ['9876543210\r', [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]], ['/:09\r', [0, 9]]].map(([typed, numbers]) => ({
      name: JSON.stringify(typed.replace('\r', '⏎')), typed, expect: { numbers },
    })),
  }),
  task({
    id: 'fibonacci', title: 'Fibonacci numbers',
    text: 'Write the Fibonacci numbers 1, 1, 2, 3, 5, 8, … 233 (13 numbers) to 0x80–0x8C, then halt. Each number is the sum of the two before it.',
    cases: [{ name: '1 1 2 3 … 233', memory: at(0x80, range(13, () => 0x55)), expect: { memory: at(0x80, [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]) } }],
  }),
  task({
    id: 'average', title: 'Average', cpu: 'cpu8x',
    text: 'At 0x8000 is a count n (1–100), followed by n bytes at 0x8001, 0x8002, … Show their average, rounded down, on the number display, then halt. The sum can be larger than 255.',
    starter: { c: '\n#define DATA ((char*)0x8000)\n\nvoid main() {\n    char n = DATA[0];\n    // …\n}\n' },
    limit: 1_000_000,
    cases: [[1, 2, 3], [200, 100], [255], range(100, i => 255 - i), [0, 0, 1], range(50, i => (i * 41) & 255)].map(list => ({
      name: `${list.length} byte${list.length === 1 ? "" : "s"}: ${show(list)}`, memory: at(0x8000, [list.length, ...list]),
      expect: { numbers: [Math.floor(list.reduce((a, b) => a + b, 0) / list.length)] },
    })),
  }),
  task({
    id: 'reverse', title: 'Reverse a text', cpu: 'cpu8x',
    text: 'A text starts at 0x8000 and ends with a byte 0. Reverse it in place ("Hello" becomes "olleH"), then halt.',
    starter: { c: '\n#define TEXT ((char*)0x8000)\n\nvoid main() {\n}\n' },
    limit: 1_000_000,
    cases: ['Hello', 'ab', 'x', '', 'A man, a plan, a canal: Panama', 'MiniCPU'].map(s => ({
      name: `"${s}"`, memory: at(0x8000, [...bytes(s), 0]), expect: { memory: at(0x8000, [...bytes([...s].reverse().join('')), 0]) },
    })),
  }),
]);

const BY_ID = new Map(TASKS.map(t => [t.id, t]));
export const taskById = id => BY_ID.get(id) ?? null;

/** The task a program belongs to: the first "Task: id" comment in its first lines. */
export function taskOf(source) {
  for (const line of source.split('\n', 12)) {
    const m = line.match(/^\s*(?:;|\/\/)\s*Task:\s*([A-Za-z0-9_-]+)/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/** Runs one case on a fresh machine. Returns { pass, message, cycles }. */
export function runCase(program, t, testCase) {
  const devices = new Devices({ seed: 7 });
  devices.reset(null);
  const numbers = [];
  devices.onOutput((port, value) => { if (port === PORT.NUMBER) numbers.push(value); });
  const memory = new Uint8Array(program.memory.length);
  memory.set(program.memory);
  const used = (program.asmAssembly ?? program).listing;
  const digits = memory.length > 256 ? 4 : 2;
  for (const [address, values] of Object.entries(testCase.memory ?? {})) {
    const start = Number(address), end = start + values.length;
    if (end > memory.length) return { pass: false, message: `This task needs RAM up to 0x${hex(end - 1, 4)}: use a bigger CPU level`, cycles: 0 };
    const clash = used.find(e => e.address < end && e.address + e.size > start && e.size);
    if (clash) return { pass: false, message: `The program uses 0x${hex(clash.address, digits)}, where the task puts its input (0x${hex(start, digits)}–0x${hex(end - 1, digits)})`, cycles: 0 };
    memory.set(values, start);
  }
  const cpu = new MiniCPU(memory, program.architecture, { devices, historySize: 1, clockHz: 1e6 });
  if (testCase.typed) devices.type(testCase.typed);
  try {
    while (!cpu.halted && cpu.cycles < t.limit) cpu.step();
  } catch (error) {
    if (!(error instanceof CpuFault)) throw error;
    const line = program.sourceMap?.get(error.pc);
    return { pass: false, message: `${error.message}${line ? ` (line ${line})` : ''}`, cycles: cpu.cycles };
  }
  if (!cpu.halted) return { pass: false, message: `Still running after ${t.limit.toLocaleString('en')} cycles: does it reach HLT?`, cycles: cpu.cycles };
  const message = expectation(testCase.expect ?? {}, { cpu, memory: cpu.memory, numbers, read: a => cpu.memory[a] }, digits);
  return { pass: !message, message, cycles: cpu.cycles };
}

function expectation(expect, run, digits) {
  const { cpu } = run;
  for (const name of ['A', 'B', 'C', 'D']) {
    if (expect[name] === undefined) continue;
    const value = cpu.registers['ABCD'.indexOf(name)];
    if (value !== expect[name]) return `${name} should be ${expect[name]}, but it is ${value}`;
  }
  for (const [address, values] of Object.entries(expect.memory ?? {})) {
    const start = Number(address);
    const actual = Array.from(cpu.memory.slice(start, start + values.length));
    const wrong = values.findIndex((v, i) => v !== actual[i]);
    if (wrong >= 0) {
      return values.length === 1
        ? `0x${hex(start, digits)} should be ${values[0]}, but it is ${actual[0]}`
        : `0x${hex(start + wrong, digits)} should be ${values[wrong]}, but it is ${actual[wrong]}. Expected: ${show(values)} — found: ${show(actual)}`;
    }
  }
  if (expect.numbers) {
    const a = run.numbers, e = expect.numbers;
    if (a.length !== e.length || a.some((v, i) => v !== e[i])) {
      return `The number display showed ${a.length ? show(a) : 'nothing'}, expected ${e.length ? show(e) : 'nothing'}`;
    }
  }
  return expect.check ? expect.check(run) : null;
}

/**
 * Checks a program against its task. Returns null if it names no known task,
 * else { task, passed, total, results, bytes, cycles, error }: cycles is the
 * sum over all cases (only meaningful when all pass), bytes the program size.
 */
export function checkSource(source, language) {
  const t = taskById(taskOf(source) ?? '');
  if (!t) return null;
  let program;
  try {
    program = build(source, language);
  } catch (error) {
    return { task: t.id, passed: 0, total: t.cases.length, results: [], bytes: 0, cycles: 0, error: error.line ? `Line ${error.line}: ${error.detail ?? error.message}` : error.message };
  }
  const results = t.cases.map(c => ({ name: c.name, ...runCase(program, t, c) }));
  return {
    task: t.id,
    passed: results.filter(r => r.pass).length,
    total: results.length,
    results,
    bytes: program.loadedBytes,
    cycles: results.reduce((sum, r) => sum + r.cycles, 0),
    error: null,
  };
}
