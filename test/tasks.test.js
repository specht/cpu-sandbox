import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, taskOf, checkSource, place, levelOf, caseInput } from '../src/tasks.js';
import { build } from '../src/build.js';

// A reference solution for every task: each must pass all of its cases.
const SOLUTIONS = {
  add: `; Task: add
        LDA A, [0x80]
        LDA B, [0x81]
        ADD A, B
        STA [0x82], A
        HLT`,
  countdown: `; Task: countdown
        LDI A, 10
loop:   OUT 0x11, A
        DEC A
        JNC loop        ; DEC sets CF when A goes from 0 to 255
        HLT`,
  maximum: `; Task: maximum
        LDI B, 0x80
        LDI A, 0
next:   LDA C, [B]
        CMP A, C
        JNC keep
        MOV A, C
keep:   INC B
        CMP B, 0x88
        JNZ next
        HLT`,
  length: `; Task: length
        LDI B, 0x80
        LDI A, 0
next:   LDA C, [B]
        CMP C, 0
        JZ done
        INC A
        INC B
        JMP next
done:   HLT`,
  multiply: `; Task: multiply
        LDI A, 0        ; low byte
        LDI B, 0        ; high byte
        LDA C, [0x81]
        LDA D, [0x80]
        CMP C, 0
        JZ done
again:  ADD A, D
        ADC B, 0
        DEC C
        JNZ again
done:   STA [0x82], A
        STA [0x83], B
        HLT`,
  checkerboard: `; Task: checkerboard
.display 0x80, 16, 8, gray8
        LDI B, 0x80
next:   MOV A, B        ; x + y is even when bit 0 of x equals bit 0 of y,
        MOV C, B        ; and the address is 0x80 + 16 · y + x
        SHR C
        SHR C
        SHR C
        SHR C
        XOR A, C
        AND A, 1
        LDI C, 255
        JZ white
        LDI C, 0
white:  STA [B], C
        INC B
        JNZ next        ; B wraps from 0xFF to 0
        HLT`,
  sort: `; Task: sort
outer:  LDI D, 0        ; swapped?
        LDI B, 0x80
inner:  LDA A, [B]
        MOV C, B
        INC C
        LDA C, [C]
        CMP C, A        ; CF if the right one is smaller
        JNC ok
        STA [B], C
        INC B
        STA [B], A
        DEC B
        LDI D, 1
ok:     INC B
        CMP B, 0x87
        JNZ inner
        CMP D, 0
        JNZ outer
        HLT`,
  digits: `; Task: digits
read:   IN A, 0x01
        CMP A, 0
        JZ read
        CMP A, 13
        JZ done
        CMP A, '0'
        JC read
        CMP A, '9' + 1
        JNC read
        SUB A, '0'
        OUT 0x11, A
        JMP read
done:   HLT`,
  fibonacci: `// Task: fibonacci
#pragma cpu 8s
void main() {
    char *f = (char*)0x80;
    f[0] = 1; f[1] = 1;
    for (char i = 2; i < 13; i++) f[i] = f[i - 1] + f[i - 2];
}`,
  average: `// Task: average
#pragma cpu 8x
#define DATA ((char*)0x8000)
void main() {
    char n = DATA[0];
    int sum = 0;
    for (char i = 1; i <= n; i++) sum += DATA[i];
    out(NUMBER, sum / n);
}`,
  reverse: `// Task: reverse
#pragma cpu 8x
#define TEXT ((char*)0x8000)
void main() {
    int n = 0;
    while (TEXT[n]) n++;
    for (int i = 0, j = n - 1; i < j; i++, j--) {
        char t = TEXT[i]; TEXT[i] = TEXT[j]; TEXT[j] = t;
    }
}`,
  factorial: `// Task: factorial
#pragma cpu 8x
#define N (*(char*)0x8000)
#define RESULT (*(int*)0x8002)
int factorial(int n) { return n == 0 ? 1 : n * factorial(n - 1); }
void main() { RESULT = factorial(N); }`,
  gcd: `// Task: gcd
#pragma cpu 8x
#define A (*(int*)0x8000)
#define B (*(int*)0x8002)
#define RESULT (*(int*)0x8004)
int gcd(int a, int b) { return b == 0 ? a : gcd(b, a % b); }
void main() { RESULT = gcd(A, B); }`,
  primes: `// Task: primes
#pragma cpu 8x
char crossed[100];
void main() {
    for (char p = 2; p < 100; p++) {
        if (crossed[p]) continue;
        out(NUMBER, p);
        for (int m = (int)p * p; m < 100; m += p) crossed[m] = 1;   // (int): p · p does not fit into a char
    }
}`,
  letters: `// Task: letters
#pragma cpu 8x
#define TEXT ((char*)0x8000)
#define COUNT ((char*)0x8100)
void main() {
    for (char i = 0; i < 26; i++) COUNT[i] = 0;
    for (char *p = TEXT; *p; p++) {
        char c = *p | 32;               // lower case
        if (c >= 'a' && c <= 'z') COUNT[c - 'a']++;
    }
}`,
  line: `// Task: line
#pragma cpu 8x
#define IN ((char*)0x8000)
#define SCREEN ((char*)0x8100)
int abs(int v) { return v < 0 ? -v : v; }
void main() {
    int x = IN[0], y = IN[1], x1 = IN[2], y1 = IN[3];
    int dx = abs(x1 - x), dy = -abs(y1 - y);
    int sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1, err = dx + dy;
    for (;;) {                          // Bresenham
        SCREEN[y * 32 + x] = 255;
        if (x == x1 && y == y1) break;
        int e2 = 2 * err;
        if (e2 >= dy) { err += dy; x += sx; }
        if (e2 <= dx) { err += dx; y += sy; }
    }
}`,
};

// The same tasks in C on MiniCPU 8X: the input starts at 0x8000 there.
const IN_C = {
  add: `// Task: add
#pragma cpu 8x
#define IN ((char*)0x8000)
void main() { IN[2] = IN[0] + IN[1]; }`,
  maximum: `// Task: maximum
#pragma cpu 8x
#define DATA ((char*)0x8000)
void main() {
    char best = 0;
    for (char i = 0; i < 8; i++) if (DATA[i] > best) best = DATA[i];
    out(NUMBER, best);
}`,
  multiply: `// Task: multiply
#pragma cpu 8x
#define IN ((char*)0x8000)
void main() { *(int*)0x8002 = (int)IN[0] * IN[1]; }`,
  sort: `// Task: sort
#pragma cpu 8x
#define DATA ((char*)0x8000)
void main() {
    for (char i = 0; i < 7; i++)
        for (char j = 0; j < 7 - i; j++)
            if (DATA[j] > DATA[j + 1]) { char t = DATA[j]; DATA[j] = DATA[j + 1]; DATA[j + 1] = t; }
}`,
  checkerboard: `// Task: checkerboard
#pragma cpu 8x
#define SCREEN ((char*)0x8000)
void main() { for (char i = 0; i < 128; i++) SCREEN[i] = ((i & 15) + (i >> 4)) & 1 ? 0 : 255; }`,
};

test('every task has a reference solution that passes all its cases', () => {
  assert.deepEqual(Object.keys(SOLUTIONS).sort(), TASKS.map(t => t.id).sort());
  for (const [id, source] of Object.entries(SOLUTIONS)) {
    const result = checkSource(source, source.startsWith('//') ? 'c' : 'asm');
    assert.ok(result, id);
    assert.equal(result.error, null, `${id}: ${result.error}`);
    const failed = result.results.filter(r => !r.pass).map(r => `${r.name}: ${r.message}`);
    assert.deepEqual(failed, [], id);
    assert.ok(result.cycles > 0 && result.bytes > 0, id);
  }
});

test('the earlier tasks also work in C on MiniCPU 8X, where the input starts at 0x8000', () => {
  for (const [id, source] of Object.entries(IN_C)) {
    const result = checkSource(source, 'c');
    assert.equal(result.error, null, id);
    assert.deepEqual(result.results.filter(r => !r.pass).map(r => `${r.name}: ${r.message}`), [], id);
    const asm = checkSource(SOLUTIONS[id], 'asm');
    assert.ok(result.bytes > asm.bytes, `${id}: C costs more bytes (${result.bytes} vs ${asm.bytes})`);
  }
});

test('the task texts name the addresses of the CPU level', () => {
  const add = TASKS.find(t => t.id === 'add');
  assert.match(place(add.text, 'cpu8'), /^The bytes at 0x80 and 0x81 .* to 0x82,/);
  assert.match(place(add.text, 'cpu8x'), /^The bytes at 0x8000 and 0x8001 .* to 0x8002,/);
  assert.match(add.starter.c, /#pragma cpu 8x[\s\S]*\(char\*\)0x8000/);
  assert.equal(levelOf('// Task: add\nvoid main() {}', 'c'), 'cpu8x');
  assert.equal(levelOf('; Task: add\n.cpu 8s\nHLT', 'asm'), 'cpu8s');
});

test('a case puts its input at the start address of the CPU level (also for Try it)', () => {
  const factorial = TASKS.find(t => t.id === 'factorial');
  assert.deepEqual(caseInput(factorial.cases[0], 'cpu8x'), [[0x8000, [0]]]);
  const letters = TASKS.find(t => t.id === 'letters');
  assert.deepEqual(caseInput(letters.cases[0], 'cpu8x').map(([a]) => a), [0x8000, 0x8100]);
  assert.deepEqual(caseInput(TASKS[0].cases[0], 'cpu8'), [[0x80, [3, 4]]]);
});

test('the ternary operator works in a recursive factorial', () => {
  const source = SOLUTIONS.factorial.replace(/int factorial[^}]*\}/, 'int factorial(int n) { return (n < 2) ? 1 : factorial(n - 1) * n; }');
  assert.match(source, /\? 1 : factorial/);
  const result = checkSource(source, 'c');
  assert.equal(result.passed, result.total);
});

test('a line that misses a pixel or wanders off is caught', () => {
  const ok = checkSource(SOLUTIONS.line, 'c');
  assert.equal(ok.passed, ok.total);
  const thick = SOLUTIONS.line.replace('SCREEN[y * 32 + x] = 255;', 'SCREEN[y * 32 + x] = 255; SCREEN[y * 32 + x + 1] = 255;');
  assert.match(checkSource(thick, 'c').results[0].message, /exactly one white pixel|pixels are white/);
});

test('wrong programs fail with a helpful message', () => {
  const off = checkSource('; Task: add\n LDA A, [0x80]\n LDA B, [0x81]\n ADD A, B\n INC A\n STA [0x82], A\n HLT', 'asm');
  assert.equal(off.passed, 0);
  assert.equal(off.results[0].message, '0x82 should be 7, but it is 8');
  const stuck = checkSource('; Task: countdown\nloop: JMP loop', 'asm');
  assert.match(stuck.results[0].message, /Still running after 200,000 cycles/);
  const shows = checkSource('; Task: countdown\n LDI A, 3\n OUT 0x11, A\n HLT', 'asm');
  assert.equal(shows.results[0].message, 'The number display showed 3, expected 10 9 8 7 6 5 4 3 2 1 0');
  const broken = checkSource('; Task: add\n LDA Q, [0x80]', 'asm');
  assert.match(broken.error, /^Line 2/);
  // A program that sits where the task puts its input is told so.
  const clash = checkSource(`; Task: add\n.org 0x80\n HLT`, 'asm');
  assert.match(clash.results[0].message, /The program uses 0x80, where the task puts its input/);
});

test('the task marker is a comment near the top, in either language', () => {
  assert.equal(taskOf('; Task: sort\nHLT'), 'sort');
  assert.equal(taskOf('// task: Average\n#pragma cpu 8x'), 'average');
  assert.equal(taskOf('HLT\n; no task here'), null);
  assert.equal(checkSource('; Task: no-such-task\nHLT', 'asm'), null);
});

test('every starter compiles and names its task', () => {
  for (const t of TASKS) {
    for (const language of ['asm', 'c']) {
      const source = t.starter[language];
      assert.equal(taskOf(source), t.id, `${t.id} ${language}`);
      assert.doesNotThrow(() => build(source, language), `${t.id} ${language}`);
    }
  }
});
