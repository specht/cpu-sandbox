# Tasks with automatic checks

A task describes what a program should do and comes with test cases. A
program takes part when one of its first lines names the task:

```asm
; Task: maximum
```

```c
// Task: average
```

The **+** button can create a program for a task: choose it under **Task**,
and the program starts with the task itself as a comment, the right CPU
level and a few starter lines:

```asm
; Task: add · Add two numbers
;
; The bytes at 0x80 and 0x81 hold two numbers. Write their sum to
; 0x82, then halt. The sum is always below 256.
;
; Input    0x80, 0x81: two numbers
; Result   0x82: their sum
; Example  3, 4 → 7
; Check    5 test cases, at most 200,000 cycles each

        LDA A, [0x80]
        ; …
        HLT
```

The comment is the contract: where the input is, where the result goes (in
tasks that ask for one number, A in assembly and the number display in C)
and what **Check** runs. Only the `Task:` line matters to the check; the rest
can be deleted or changed.

## In the browser

- The **task bar** above the editor names the task of the open program;
  its tooltip repeats the whole task.
- **Check** runs every case on a fresh machine: the task puts its input into
  RAM (or types it on the keyboard), the program runs until `HLT`, and the
  result is compared with what the task expects. Each case shows what went
  wrong, for example `0x82 should be 7, but it is 8`, or how many cycles it
  took.
- **Try it** loads a case into the machine: its input is in RAM, and Run,
  Step and Step back work as usual. The task bar shows the loaded case; ×
  removes it again.
- **Class progress** (top right) checks the programs of all students and
  shows the best attempt per student and task: ✓ when all cases pass,
  otherwise how many do. A click on a cell opens the program. A click on a
  task compares the working solutions: fewest cycles first, and the smallest
  program in bytes is marked too.

A program may not put its own bytes where a task puts its input: the check
says so. The input starts at 0x80 on MiniCPU 8 and 8S and at 0x8000 on
MiniCPU 8X, where a compiled C program fills the low addresses with its code.
The comment shows the addresses for the CPU level the program was created
for; the tooltip of the task bar follows the `.cpu` line.

## A progression: assembly first, then C

1. **Assembly on MiniCPU 8.** The first eleven tasks are small enough to
   write by hand: every byte and every cycle is the student's own.
2. **The same tasks in C on MiniCPU 8X.** **+** with language C creates the
   C version of any of them (the input moves to 0x8000). The Assembly tab
   shows what the compiler made of it, and Class progress lists assembly and
   C solutions side by side. The price of C, measured with straightforward
   solutions:

   | Task | Assembly: bytes · cycles | C: bytes · cycles |
   | --- | ---: | ---: |
   | add | 12 · 75 | 25 · 180 |
   | maximum | 22 · 820 | 88 · 3,420 |
   | checkerboard | 35 · 4,099 | 99 · 12,387 |
   | sort | 42 · 4,260 | 176 · 19,271 |
   | multiply | 33 · 5,991 | 92 · 1,935 |

   C needs two to four times the bytes and usually the cycles, for a
   program that is much quicker to write. `multiply` is the exception: the
   compiler's shift-and-add routine beats adding the number again and
   again — a better algorithm wins over hand-written instructions.
3. **C tasks on MiniCPU 8X.** Things that would take a long time in
   assembly: recursion, Euclid's algorithm with `%`, a sieve in an array,
   counting with a table of 26 counters, and drawing a line on a screen.
   They are about 120–460 bytes of machine code each.

## The tasks

In the order of [teaching.md](teaching.md), after the examples that
prepare them:

| Chapter | Task | Language | What to do |
| --- | --- | --- | --- |
| Memory (after `07-pixel-formats`) | `add` | either | Add the bytes at +0 and +1, write the sum to +2. |
| | `length` | either | Count the characters of a zero-terminated text (assembly: in A; C: on the number display). |
| | `maximum` | either | Find the largest of eight bytes (assembly: in A; C: on the number display). |
| | `fibonacci` | either | Write 1, 1, 2, 3, … 233 to +0 … +12. |
| | `multiply` | either | Multiply +0 × +1, 16-bit product to +2 (low) and +3 (high). |
| | `sort` | either | Sort eight bytes in place. |
| | `checkerboard` | either | Paint a checkerboard on a 16 × 8 gray screen at +0. |
| Devices (after `09-fire`) | `countdown` | either | Show 10, 9, …, 0 on the number display. |
| | `digits` | either | Show typed digits on the number display until Enter. |
| MiniCPU 8X (after `16-breakout`) | `average` | either | Show the average of n bytes (n at +0) on the number display. |
| | `reverse` | either | Reverse a zero-terminated text in place. |
| C (after `17-first-c`) | `factorial` | C | A recursive factorial; n! as an int to +2. |
| | `gcd` | C | The greatest common divisor of two ints. |
| | `primes` | C | Show every prime below 100 (sieve of Eratosthenes). |
| | `letters` | C | Count each letter of a text into 26 counters at +0x100. |
| | `line` | C | Draw a line on a 32 × 24 gray screen at +0x100. |

The examples show the instructions and ideas the tasks need, but none of
them solves a task.

+n means n bytes after the start of the input (0x80 or 0x8000). A program
of an "either" task in assembly starts on MiniCPU 8 (`average` and
`reverse` on 8X, for X and Y); every C program starts on 8X.

## Adding a task

Tasks live in `src/tasks.js`. A new one is an entry in `TASKS`:

```js
task({
  id: 'double', title: 'Double it',
  text: 'Double the byte at {+0} and write the result to {+1}. It stays below 256.',
  cases: [[1], [0], [100], [127]].map(([n]) => ({
    name: `2 × ${n}`, memory: { 0: [n] }, expect: { memory: { 1: [2 * n] } },
  })),
}),
```

| Field | |
| --- | --- |
| `id` | the name in the `Task:` line |
| `title`, `short` | in the task bar, the **+** dialog and class progress |
| `text` | what to do, in the comment at the top of a new program; `{answer}` becomes A (assembly) or the number display (C) |
| `input`, `result`, `example` | the contract lines of that comment (`input` defaults to none) |
| `language` | `'any'` (default) or `'c'` for a C task |
| `cpu` | `cpu8` (default), `cpu8s` or `cpu8x` for new assembly programs; C starts on `cpu8x` |
| `starter` | `{ asm, c }`: the first lines of a new program after the comment |
| `limit` | cycles per case before the program counts as stuck (default 200,000) |
| `cases` | `name`; `memory: { offset: [bytes] }` (from the start of the input) and `typed: 'text'` as input |
| `expect` | `A`–`D`: register values; `memory: { offset: [bytes] }`; `numbers: [...]`, the values shown on the number display in order; `answer`: in A for assembly, on the number display for C; `check(run)`, a function that returns a message when something is wrong |

In `text`, `input`, `result`, `example` and `starter`, write addresses as `{+0}`, `{+2}`, `{+0x100}`: they
become 0x80, 0x82, … or 0x8000, 0x8002, … for the CPU level.

Add a reference solution to `test/tasks.test.js`; `npm test` then checks
that the task can be solved and that every starter builds.
