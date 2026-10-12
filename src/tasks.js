/**
 * Tasks with automatic checks. A program belongs to a task through a comment
 * line near the top, "; Task: add" in assembly or "// Task: add" in C. The
 * checks run each test case on a fresh machine: the task puts its input into
 * RAM or types keys, the program runs until HLT, and the result is compared
 * with what the task expects. The browser (Check button) and the server
 * (class progress) use this same module.
 *
 * Where the input lies depends on the CPU level: from 0x80 on MiniCPU 8 and
 * 8S, from 0x8000 on 8X, where a compiled C program fills the low addresses
 * with its code. Addresses in texts and starters are written {+n} (n bytes
 * after the start), in cases and expectations as offsets.
 *
 * A task:
 *   id, title, short      the marker name, a title and a short title (class progress)
 *   chapter               the part of the course: Memory, Devices, MiniCPU 8X or C
 *   language              'any' (assembly on MiniCPU 8, or C) or 'c' (C on 8X)
 *   cpu                   the level of a new assembly program (C always starts on 8X)
 *   text                  what to do ({answer}: A in assembly, the number display in C)
 *   input, result         the contract: where the input is and where the result goes
 *   example               one case in short
 *   starter: { asm, c }   the beginning of a new program
 *   limit                 cycles per case before the program counts as stuck
 *   cases: [{ name, memory: { offset: [bytes] }, typed: 'text', expect }]
 *   expect: { A: 7, memory: { offset: [bytes] }, numbers: [10, 9, …], answer, check(run) }
 *     answer: in A for an assembly program, on the number display for C
 *     check(run) returns a message when something is wrong, else null; run has
 *     cpu, memory, base, numbers (values written to the number display) and read(offset).
 */
import { build } from './build.js';
import { MiniCPU, CpuFault, hex } from './cpu.js';
import { Devices, PORT } from './devices.js';

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const bytes = text => [...text].map(c => c.charCodeAt(0));
const show = list => list.length > 12 ? `${list.slice(0, 12).join(' ')} …` : list.join(' ');
const at = (offset, values) => ({ [offset]: values });
const int16 = n => [n & 255, (n >> 8) & 255];

/** The CPU level a program asks for: .cpu in assembly (default 8), #pragma cpu in C (default 8X). */
export function levelOf(source, language) {
  const m = language === 'c'
    ? source.match(/^[ \t]*#[ \t]*pragma[ \t]+cpu[ \t]+(8s|8x|8)\b/im)
    : source.match(/^[ \t]*\.cpu[ \t]+(8s|8x|8)\b/im);
  return `cpu${(m?.[1] ?? (language === 'c' ? '8x' : '8')).toLowerCase()}`;
}
/** Where a task's input starts on a CPU level. */
export const baseOf = level => (level === 'cpu8x' ? 0x8000 : 0x80);
/** Fills in the {+n} addresses of a text for a CPU level. */
export function place(text, level) {
  const base = baseOf(level);
  return text.replace(/\{\+(0x[0-9a-f]+|\d+)\}/gi, (_, n) => `0x${hex(base + Number(n), base > 255 ? 4 : 2)}`);
}

/** Breaks text into lines of at most `width` characters; later lines start with `indent`. */
function wrap(text, width, indent = '') {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) { lines.push(line); line = indent + word; }
    else line = line ? `${line} ${word}` : word;
  }
  return line ? [...lines, line] : lines;
}

const ANSWER = { asm: 'A', c: 'the number display' };

/**
 * The task as lines of text for the top of a program: the title, what to do,
 * and the contract (where the input is, where the result goes, an example and
 * what Check runs), with the addresses for the program's CPU level.
 */
export function taskLines(t, language, level) {
  const fill = text => place(text, level).replaceAll('{answer}', ANSWER[language === 'c' ? 'c' : 'asm']);
  const contract = [
    ['Input', t.input ?? 'none'],
    ['Result', t.result],
    ['Example', t.example],
    ['Check', `${t.cases.length} test case${t.cases.length === 1 ? '' : 's'}, at most ${t.limit.toLocaleString('en')} cycles each`],
  ].filter(([, value]) => value);
  return [
    `Task: ${t.id} · ${t.title}`,
    '',
    ...wrap(fill(t.text), 64),
    '',
    ...contract.flatMap(([name, value]) => wrap(fill(value), 55).map((line, i) => `${i ? '' : name}`.padEnd(9) + line)),
  ];
}

/** The task as a comment block: ";" lines in assembly, "//" lines in C. */
export function taskComment(t, language, level) {
  const mark = language === 'c' ? '//' : ';';
  return taskLines(t, language, level).map(line => (line ? `${mark} ${line}` : mark)).join('\n') + '\n';
}

function task(spec) {
  const level = spec.cpu ?? 'cpu8';
  const t = { limit: 200_000, language: 'any', ...spec, cpu: level };
  return Object.freeze({
    ...t,
    starter: {
      asm: `${taskComment(t, 'asm', level)}${level === 'cpu8' ? '' : `.cpu ${level.slice(3)}\n`}${place(spec.starter?.asm ?? '\n        HLT\n', level)}`,
      c: `${taskComment(t, 'c', 'cpu8x')}#pragma cpu 8x\n${place(spec.starter?.c ?? '\nvoid main() {\n}\n', 'cpu8x')}`,
    },
  });
}

/** For the line task: exactly one pixel per step along the longer axis, at most half a pixel off the ideal line. */
function checkLine([x0, y0, x1, y1]) {
  return run => {
    const W = 32, H = 24, screen = Array.from(run.memory.slice(run.base + 0x100, run.base + 0x100 + W * H));
    const lit = (x, y) => screen[y * W + x] === 255;
    const stray = screen.findIndex(v => v !== 0 && v !== 255);
    if (stray >= 0) return `Pixel (${stray % W}, ${Math.floor(stray / W)}) is ${screen[stray]}: only 0 and 255 are allowed`;
    const dx = x1 - x0, dy = y1 - y0, steps = Math.max(Math.abs(dx), Math.abs(dy));
    const count = screen.filter(v => v === 255).length;
    if (!lit(x0, y0)) return `The start (${x0}, ${y0}) is not white`;
    if (!lit(x1, y1)) return `The end (${x1}, ${y1}) is not white`;
    for (let i = 0; i <= steps; i++) {
      const xAxis = Math.abs(dx) >= Math.abs(dy);
      const major = (xAxis ? x0 : y0) + Math.sign(xAxis ? dx : dy) * i;
      const ideal = steps ? (xAxis ? y0 + dy * i / steps : x0 + dx * i / steps) : (xAxis ? y0 : x0);
      const hits = range(xAxis ? H : W, k => k).filter(k => (xAxis ? lit(major, k) : lit(k, major)));
      if (hits.length !== 1) return `${xAxis ? `Column x = ${major}` : `Row y = ${major}`} should have exactly one white pixel, but has ${hits.length}`;
      if (Math.abs(hits[0] - ideal) > 0.5 + 1e-9) return `Pixel ${xAxis ? `(${major}, ${hits[0]})` : `(${hits[0]}, ${major})`} is too far from the line`;
    }
    if (count !== steps + 1) return `${count} pixels are white, but the line has ${steps + 1}`;
    return null;
  };
}

function isPrime(n) { if (n < 2) return false; for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; }
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export const TASKS = Object.freeze([
  // ---------------------------------------------------------------- memory: loads, stores, loops, pointers
  task({
    id: 'add', chapter: 'Memory', short: 'Add', title: 'Add two numbers',
    text: 'The bytes at {+0} and {+1} hold two numbers. Write their sum to {+2}, then halt. The sum is always below 256.',
    input: '{+0}, {+1}: two numbers', result: '{+2}: their sum', example: '3, 4 → 7',
    starter: { asm: '\n        LDA A, [{+0}]\n        ; …\n        HLT\n', c: '\n#define IN ((char*){+0})\n\nvoid main() {\n    IN[2] = 0;      // …\n}\n' },
    cases: [[3, 4], [200, 55], [0, 0], [100, 27], [1, 254]].map(([a, b]) => ({
      name: `${a} + ${b}`, memory: at(0, [a, b]), expect: { memory: at(2, [a + b]) },
    })),
  }),
  task({
    id: 'length', chapter: 'Memory', short: 'Length', title: 'Length of a text',
    text: 'A text starts at {+0}; a byte 0 marks its end. Count its characters, then halt.',
    input: '{+0} …: the text, then a byte 0', result: '{answer}: the number of characters', example: '"Hello" → 5',
    starter: { c: '\n#define TEXT ((char*){+0})\n\nvoid main() {\n}\n' },
    cases: ['Hello', '', 'A', 'MiniCPU 8 is small', 'abcdefghijklmnopqrstuvwxyz'].map(s => ({
      name: `"${s}"`, memory: at(0, [...bytes(s), 0]), expect: { answer: s.length },
    })),
  }),
  task({
    id: 'maximum', chapter: 'Memory', short: 'Maximum', title: 'The largest number',
    text: 'The eight bytes at {+0}–{+7} are numbers 0–255. Find the largest, then halt.',
    input: '{+0}–{+7}: eight numbers', result: '{answer}: the largest of them', example: '3 9 2 7 1 8 5 4 → 9',
    starter: { c: '\n#define DATA ((char*){+0})\n\nvoid main() {\n}\n' },
    cases: [[3, 9, 2, 7, 1, 8, 5, 4], [255, 0, 0, 0, 0, 0, 0, 0], [1, 2, 3, 4, 5, 6, 7, 200], [7, 7, 7, 7, 7, 7, 7, 7], [0, 0, 0, 0, 0, 0, 0, 0], [12, 130, 129, 128, 250, 3, 251, 99]]
      .map(list => ({ name: show(list), memory: at(0, list), expect: { answer: Math.max(...list) } })),
  }),
  task({
    id: 'fibonacci', chapter: 'Memory', short: 'Fibonacci', title: 'Fibonacci numbers',
    text: 'Write the Fibonacci numbers 1, 1, 2, 3, 5, 8, … 233 (13 numbers) to {+0}–{+12}, then halt. Each number is the sum of the two before it.',
    result: '{+0}–{+12}: 1 1 2 3 5 8 13 21 34 55 89 144 233',
    starter: { c: '\n#define F ((char*){+0})\n\nvoid main() {\n}\n' },
    cases: [{ name: '1 1 2 3 … 233', memory: at(0, range(13, () => 0x55)), expect: { memory: at(0, [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]) } }],
  }),
  task({
    id: 'multiply', chapter: 'Memory', short: 'Multiply', title: 'Multiply',
    text: 'Multiply the bytes at {+0} and {+1}. Write the 16-bit product to {+2} (low byte) and {+3} (high byte), then halt. There is no multiplication instruction: add, or shift and add. (In C, * does it for you — compare the cycles.)',
    input: '{+0}, {+1}: two numbers', result: '{+2}: low byte, {+3}: high byte of the product', example: '255 × 255 = 65025 = 0xFE01 → 0x01, 0xFE',
    starter: { c: '\n#define IN ((char*){+0})\n#define PRODUCT (*(int*){+2})\n\nvoid main() {\n}\n' },
    limit: 400_000,
    cases: [[6, 7], [0, 99], [99, 0], [255, 255], [16, 16], [3, 200], [200, 3]].map(([a, b]) => ({
      name: `${a} × ${b}`, memory: at(0, [a, b]), expect: { memory: at(2, int16(a * b)) },
    })),
  }),
  task({
    id: 'sort', chapter: 'Memory', short: 'Sort', title: 'Sort',
    text: 'Sort the eight bytes at {+0}–{+7} into ascending order, in place, then halt.',
    input: '{+0}–{+7}: eight numbers', result: '{+0}–{+7}: the same numbers, smallest first', example: '5 3 8 1 9 2 7 4 → 1 2 3 4 5 7 8 9',
    starter: { c: '\n#define DATA ((char*){+0})\n\nvoid main() {\n}\n' },
    limit: 400_000,
    cases: [[5, 3, 8, 1, 9, 2, 7, 4], [1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1], [9, 9, 1, 1, 255, 0, 128, 127], [0, 0, 0, 0, 0, 0, 0, 0]]
      .map(list => ({ name: show(list), memory: at(0, list), expect: { memory: at(0, [...list].sort((a, b) => a - b)) } })),
  }),
  task({
    id: 'checkerboard', chapter: 'Memory', short: 'Board', title: 'Checkerboard',
    text: 'The screen is 16 × 8 gray pixels at {+0}, one byte per pixel, row after row. Paint a checkerboard: pixel (x, y) is 255 where x + y is even and 0 where it is odd. Then halt.',
    input: 'none, but the screen is not empty at the start', result: '{+0}–{+0x7F}: the screen, every pixel 0 or 255', example: 'top row 255 0 255 0 …, next row 0 255 0 255 …',
    starter: { asm: '.display {+0}, 16, 8, gray8\n\n        HLT\n', c: '#pragma display {+0}, 16, 8, gray8\n\n#define SCREEN ((char*){+0})\n\nvoid main() {\n}\n' },
    cases: [{
      name: '16 × 8 pixels',
      memory: at(0, range(128, i => (i * 37) & 255)),     // not a clean screen: every pixel must be set
      expect: { memory: at(0, range(128, i => ((i % 16) + (i >> 4)) % 2 ? 0 : 255)) },
    }],
  }),
  // ---------------------------------------------------------------- devices: IN and OUT
  task({
    id: 'countdown', chapter: 'Devices', short: 'Countdown', title: 'Countdown',
    text: 'Show 10, 9, 8, …, 1, 0 on the number display (OUT to port 0x11, in C out(NUMBER, …)), one after the other, then halt.',
    result: 'the number display: 10, 9, 8, …, 0',
    cases: [{ name: '10 to 0', expect: { numbers: range(11, i => 10 - i) } }],
  }),
  task({
    id: 'digits', chapter: 'Devices', short: 'Digits', title: 'Typed digits',
    text: 'Read the keyboard (port 0x01, in C in(KEYBOARD); 0 while nothing was typed). Show every typed digit 0–9 on the number display as its value (the key 7 shows 7), ignore other characters, and halt after Enter (13).',
    input: 'the keyboard, port 0x01: a character code, or 0', result: 'the number display: each typed digit', example: 'a 1 b 2 Enter → 1, 2',
    cases: [['42\r', [4, 2]], ['a1b2c3\r', [1, 2, 3]], ['\r', []], ['9876543210\r', [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]], ['/:09\r', [0, 9]]].map(([typed, numbers]) => ({
      name: JSON.stringify(typed.replace('\r', '⏎')), typed, expect: { numbers },
    })),
  }),
  // ---------------------------------------------------------------- 64 KiB: X and Y
  task({
    id: 'average', chapter: 'MiniCPU 8X', short: 'Average', title: 'Average', cpu: 'cpu8x',
    text: 'At {+0} is a count n (1–100), followed by n bytes at {+1}, {+2}, … Show their average, rounded down, on the number display, then halt. The sum can be larger than 255.',
    input: '{+0}: n, {+1} …: n numbers', result: 'the number display: the average, rounded down', example: 'n = 3: 1 2 3 → 2',
    starter: { c: '\n#define DATA ((char*){+0})\n\nvoid main() {\n    char n = DATA[0];\n    // …\n}\n' },
    limit: 1_000_000,
    cases: [[1, 2, 3], [200, 100], [255], range(100, i => 255 - i), [0, 0, 1], range(50, i => (i * 41) & 255)].map(list => ({
      name: `${list.length} byte${list.length === 1 ? '' : 's'}: ${show(list)}`, memory: at(0, [list.length, ...list]),
      expect: { numbers: [Math.floor(list.reduce((a, b) => a + b, 0) / list.length)] },
    })),
  }),
  task({
    id: 'reverse', chapter: 'MiniCPU 8X', short: 'Reverse', title: 'Reverse a text', cpu: 'cpu8x',
    text: 'A text starts at {+0} and ends with a byte 0. Reverse it in place, then halt.',
    input: '{+0} …: the text, then a byte 0', result: 'the same bytes: the text backwards, the 0 stays', example: '"Hello" → "olleH"',
    starter: { c: '\n#define TEXT ((char*){+0})\n\nvoid main() {\n}\n' },
    limit: 1_000_000,
    cases: ['Hello', 'ab', 'x', '', 'A man, a plan, a canal: Panama', 'MiniCPU'].map(s => ({
      name: `"${s}"`, memory: at(0, [...bytes(s), 0]), expect: { memory: at(0, [...bytes([...s].reverse().join('')), 0]) },
    })),
  }),
  // ---------------------------------------------------------------- C: functions, recursion, arrays, graphics
  task({
    id: 'factorial', chapter: 'C', short: 'n!', title: 'Factorial, recursively', language: 'c', cpu: 'cpu8x',
    text: 'Write a recursive function int factorial(int n): 0! = 1, n! = n · (n − 1)!. At {+0} is n (0–8); write n! as an int to {+2} (low byte first, so *(int*){+2} = …), then halt. 8! = 40320 needs all 16 bits.',
    input: '{+0}: n, a char 0–8', result: '{+2}: n! as an int', example: '5 → 120',
    starter: { c: '\n#define N (*(char*){+0})\n#define RESULT (*(int*){+2})\n\nint factorial(int n) {\n    return 1;   // …\n}\n\nvoid main() {\n    RESULT = factorial(N);\n}\n' },
    cases: [0, 1, 3, 5, 7, 8].map(n => {
      const f = range(n, i => i + 1).reduce((a, b) => a * b, 1);
      return { name: `${n}! = ${f}`, memory: at(0, [n]), expect: { memory: at(2, int16(f)) } };
    }),
  }),
  task({
    id: 'gcd', chapter: 'C', short: 'gcd', title: 'Greatest common divisor', language: 'c', cpu: 'cpu8x',
    text: 'At {+0} and {+2} are two ints a and b (1–30000). Write their greatest common divisor as an int to {+4}, then halt. Euclid: gcd(a, b) = gcd(b, a % b), and gcd(a, 0) = a.',
    input: '{+0}: a, {+2}: b, two ints', result: '{+4}: gcd(a, b) as an int', example: '12, 18 → 6',
    starter: { c: '\n#define A (*(int*){+0})\n#define B (*(int*){+2})\n#define RESULT (*(int*){+4})\n\nint gcd(int a, int b) {\n    return a;   // …\n}\n\nvoid main() {\n    RESULT = gcd(A, B);\n}\n' },
    limit: 1_000_000,
    cases: [[12, 18], [17, 5], [30000, 12345], [1024, 768], [7, 7], [1, 29999], [27720, 30000]].map(([a, b]) => ({
      name: `gcd(${a}, ${b}) = ${gcd(a, b)}`, memory: at(0, [...int16(a), ...int16(b)]), expect: { memory: at(4, int16(gcd(a, b))) },
    })),
  }),
  task({
    id: 'primes', chapter: 'C', short: 'Primes', title: 'Prime numbers', language: 'c', cpu: 'cpu8x',
    text: 'Show every prime number below 100 on the number display, smallest first (2, 3, 5, 7, 11, …, 97), then halt. The sieve of Eratosthenes: an array of 100 marks, cross out every multiple of each prime.',
    result: 'the number display: 2, 3, 5, 7, 11, …, 97',
    starter: { c: '\nchar crossed[100];\n\nvoid main() {\n}\n' },
    limit: 2_000_000,
    cases: [{ name: '2 3 5 … 97', expect: { numbers: range(100, i => i).filter(isPrime) } }],
  }),
  task({
    id: 'letters', chapter: 'C', short: 'Letters', title: 'Count the letters', language: 'c', cpu: 'cpu8x',
    text: 'A text starts at {+0} and ends with a byte 0. Count how often each letter appears, upper and lower case together, and write the 26 counts (a, b, …, z) to {+0x100}–{+0x119}, then halt.',
    input: '{+0} …: the text, then a byte 0', result: '{+0x100}–{+0x119}: the counts of a, b, …, z', example: '"Hello" → e 1, h 1, l 2, o 1, all others 0',
    starter: { c: '\n#define TEXT ((char*){+0})\n#define COUNT ((char*){+0x100})\n\nvoid main() {\n}\n' },
    limit: 1_000_000,
    cases: ['Hello, World!', 'The quick brown fox jumps over the lazy dog', '', 'AaAaBb zz Z', 'MiniCPU 8X: 64 KiB'].map(s => {
      const counts = range(26, i => [...s.toLowerCase()].filter(c => c.charCodeAt(0) === 97 + i).length);
      return { name: `"${s}"`, memory: { 0: [...bytes(s), 0], 0x100: range(26, () => 0x55) }, expect: { memory: at(0x100, counts) } };
    }),
  }),
  task({
    id: 'line', chapter: 'C', short: 'Line', title: 'Draw a line', language: 'c', cpu: 'cpu8x',
    text: 'The screen is 32 × 24 gray pixels at {+0x100}, one byte per pixel, all 0. At {+0}–{+3} are x0, y0, x1, y1. Draw the straight line from (x0, y0) to (x1, y1) in white (255): one pixel for every step along the longer axis, each as close to the exact line as possible. Then halt.',
    input: '{+0}–{+3}: x0, y0, x1, y1', result: '{+0x100} …: the screen, the line in white (255)', example: '(0, 0) to (23, 23): the diagonal, 24 pixels',
    starter: { c: '#pragma display {+0x100}, 32, 24, gray8\n\n#define IN ((char*){+0})\n#define SCREEN ((char*){+0x100})\n\nvoid plot(int x, int y) {\n    SCREEN[y * 32 + x] = 255;\n}\n\nvoid main() {\n}\n' },
    limit: 1_000_000,
    cases: [[2, 3, 29, 3], [5, 1, 5, 22], [0, 0, 23, 23], [3, 20, 30, 5], [28, 2, 10, 21], [16, 12, 16, 12], [31, 0, 0, 23]].map(points => ({
      name: `(${points[0]}, ${points[1]}) to (${points[2]}, ${points[3]})`, memory: at(0, points), expect: { check: checkLine(points) },
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

/** A case's input as absolute addresses for a CPU level: [[address, bytes], …]. */
export function caseInput(testCase, level) {
  const base = baseOf(level);
  return Object.entries(testCase.memory ?? {}).map(([offset, values]) => [base + Number(offset), values]);
}

/** Runs one case on a fresh machine. Returns { pass, message, cycles }. */
export function runCase(program, t, testCase) {
  const base = baseOf(program.architecture);
  const devices = new Devices({ seed: 7 });
  devices.reset(null);
  const numbers = [];
  devices.onOutput((port, value) => { if (port === PORT.NUMBER) numbers.push(value); });
  const memory = new Uint8Array(program.memory.length);
  memory.set(program.memory);
  const used = (program.asmAssembly ?? program).listing;
  const digits = memory.length > 256 ? 4 : 2;
  for (const [start, values] of caseInput(testCase, program.architecture)) {
    const end = start + values.length;
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
  const message = expectation(testCase.expect ?? {}, { cpu, base, memory: cpu.memory, numbers, read: offset => cpu.memory[base + offset], language: program.language }, digits);
  return { pass: !message, message, cycles: cpu.cycles };
}

function expectation(expect, run, digits) {
  const { cpu } = run;
  for (const name of ['A', 'B', 'C', 'D']) {
    if (expect[name] === undefined) continue;
    const value = cpu.registers['ABCD'.indexOf(name)];
    if (value !== expect[name]) return `${name} should be ${expect[name]}, but it is ${value}`;
  }
  // "answer": in A for assembly, on the number display for C (which has no way to set A on its own).
  if (expect.answer !== undefined) {
    if (run.language === 'c') {
      const shown = run.numbers.at(-1);
      if (shown !== expect.answer) return run.numbers.length ? `The number display shows ${shown}, expected ${expect.answer}` : `The number display shows nothing, expected ${expect.answer}`;
    } else if (cpu.registers[0] !== expect.answer) return `A should be ${expect.answer}, but it is ${cpu.registers[0]}`;
  }
  for (const [offset, values] of Object.entries(expect.memory ?? {})) {
    const start = run.base + Number(offset);
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
      const i = e.findIndex((v, k) => v !== a[k]), n = i < 0 ? e.length : i;
      if (n < 12) return `The number display showed ${a.length ? show(a) : 'nothing'}, expected ${e.length ? show(e) : 'nothing'}`;
      // Far into a long list: say where it goes wrong.
      return n < e.length
        ? `Number ${n + 1} on the display was ${a[n] ?? 'missing'}, expected ${e[n]} (after ${show(e.slice(n - 3, n))})`
        : `After the ${e.length} expected numbers, the display showed ${show(a.slice(n))} as well`;
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
    return { task: t.id, passed: 0, total: t.cases.length, results: [], bytes: 0, cycles: 0, language, instructions: 0, error: error.line ? `Line ${error.line}: ${error.detail ?? error.message}` : error.message };
  }
  const results = t.cases.map(c => ({ name: c.name, ...runCase(program, t, c) }));
  return {
    task: t.id,
    passed: results.filter(r => r.pass).length,
    total: results.length,
    results,
    bytes: program.loadedBytes,
    cycles: results.reduce((sum, r) => sum + r.cycles, 0),
    language,
    instructions: (program.asmAssembly ?? program).listing.filter(e => e.kind === 'code').length,
    error: null,
  };
}
