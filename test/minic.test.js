import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, CompileError } from '../src/minic.js';
import { build } from '../src/build.js';
import { formatSource } from '../src/format.js';
import { MiniCPU } from '../src/cpu.js';

/** Compiles and runs C; returns a reader for global variables. */
function run(source, limit = 2_000_000) {
  const program = build(source, 'c');
  const cpu = new MiniCPU(program.memory, program.architecture, { historySize: 1 });
  while (!cpu.halted && cpu.instructions < limit) cpu.step();
  assert.ok(cpu.halted, 'the program halts');
  const wide = program.architecture === 'cpu8x';
  const read = (name, index = 0, size = wide ? 2 : 1) => {
    const at = program.labels.get(`_${name}`) + index * size;
    const v = size === 2 ? cpu.memory[at] | cpu.memory[at + 1] << 8 : cpu.memory[at];
    return size === 2 && v >= 0x8000 ? v - 0x10000 : v;
  };
  return { program, cpu, read };
}
const fails = (source, pattern) => assert.throws(() => compile(source), e => e instanceof CompileError && pattern.test(e.detail), source);

test('functions, recursion, arguments and local variables', () => {
  const { read, cpu } = run(`
    int r[3];
    int fib(int n) { if (n < 2) return n; return fib(n - 1) + fib(n - 2); }
    int max(int a, int b) { return a > b ? a : b; }
    int sum(int n) { int s = 0; for (int i = 1; i <= n; i++) s += i; return s; }
    void main() { r[0] = fib(12); r[1] = max(-3, -7); r[2] = sum(100); }`);
  assert.deepEqual([read('r', 0), read('r', 1), read('r', 2)], [144, -3, 5050]);
  assert.equal(cpu.sp, 0x10000, 'the stack is balanced');
});

test('16-bit arithmetic: signed and unsigned *, /, %, shifts and comparisons', () => {
  const { read } = run(`
    int a = -520, b = 7;
    unsigned int u = 60000;
    int r[10];
    void main() {
      r[0] = a * b;  r[1] = a / b;  r[2] = a % b;  r[3] = a >> 6;  r[4] = a / 64;
      r[5] = u / 7;  r[6] = a < b;  r[7] = (unsigned int)a > (unsigned int)b;
      r[8] = ~a & 0x0FF0;  r[9] = a << 3;
    }`);
  const r = Array.from({ length: 10 }, (_, i) => read('r', i));
  assert.deepEqual(r, [-3640, -74, -2, -9, -8, 8571, 1, 1, (~-520) & 0x0FF0, -4160]);
});

test('char arithmetic stays 8 bits wide; an int operand widens it', () => {
  const { read } = run(`
    char a = 200, b = 100;
    int r[3];
    void main() { r[0] = a + b; r[1] = (int)a + b; r[2] = a + 300; }`);
  assert.deepEqual([read('r', 0), read('r', 1), read('r', 2)], [44, 300, 500]);
});

test('pointers, arrays, strings and ++ on elements', () => {
  const { read, cpu, program } = run(`
    char text[] = "Hello";
    char copy[8];
    int values[] = {5, -3, 1000};
    int r[3];
    void copy_string(char *to, char *from) { while (*from) *to++ = *from++; *to = 0; }
    int length(char *s) { int n = 0; while (s[n]) n++; return n; }
    void main() {
      copy_string(copy, text);
      values[1]++;
      int *p = values + 2;
      r[0] = length(copy);
      r[1] = values[1];
      r[2] = *p - *(p - 2);
    }`);
  const at = program.labels.get('_copy');
  assert.equal(String.fromCharCode(...cpu.memory.slice(at, at + 5)), 'Hello');
  assert.deepEqual([read('r', 0), read('r', 1), read('r', 2)], [5, -2, 995]);
});

test('MiniCPU 8S: everything is 8 bits; MiniCPU 8: only main, with static locals', () => {
  const small = run(`#pragma cpu 8s
    char r[2];
    char twice(char n) { return n + n; }
    void main() { r[0] = twice(21); r[1] = 7 * 9; }`);
  assert.equal(small.program.architecture, 'cpu8s');
  assert.deepEqual([small.read('r', 0), small.read('r', 1)], [42, 63]);
  const tiny = run('#pragma cpu 8\nchar r;\nvoid main() { char i = 0; while (i < 10) i++; r = i * 4; }');
  assert.equal(tiny.read('r'), 40);
  fails('#pragma cpu 8\nchar f() { return 1; }\nvoid main() { }', /need a stack/);
  fails('#pragma cpu 8\nchar a, b;\nvoid main() { a = a * b; }', /MiniCPU 8S or 8X/);
});

test('devices, #define with parameters and asm()', () => {
  const { program } = run(`
    #define SQUARE(x) ((x) * (x))
    void main() { out(NUMBER, SQUARE(5)); out(SPEAKER, in(TIMER)); asm("NOP"); }`);
  assert.deepEqual(program.ports, [0x02, 0x10, 0x11]);
  assert.match(program.asm, /OUT 0x11, A/);
  assert.match(program.asm, /^\s+NOP$/m);
});

test('helpful errors for what MiniC does not support', () => {
  fails('void main() { int a[3]; }', /outside of functions/);
  fails('int f() { int x; int *p = &x; return 0; }\nvoid main() {}', /address of a local variable/);
  fails('struct point { int x; };', /no structs/);
  fails('void main() { float f; }', /floating-point/);
  fails('void main() { g(); }', /not declared/);
  fails('int x;', /needs a function main/);
  fails('#include <stdio.h>\nvoid main() {}', /no header files/);
  fails('void main() { char *p = 5; }', /cast it/);
  fails('void main() { int x = 1 / 0; }', /Division by zero/);
});

test('the build maps addresses to C lines and shows formatted assembly', () => {
  const source = '#pragma cpu 8x\nint x;\nvoid main() {\n  x = 1;\n  x = x + 2;\n}\n';
  const program = build(source, 'c');
  assert.equal(formatSource(program.asm.trimEnd()), program.asm.trimEnd());
  assert.match(program.asm, /; x = x \+ 2;/, 'each C line appears as a comment');
  const address = program.lineAddresses.get(5);
  assert.equal(program.sourceMap.get(address), 5);
  assert.ok(program.listing.some(entry => entry.line === 4 && entry.bytes.length > 0));
  assert.ok(program.asmAssembly.listing.length > program.listing.length);
});
