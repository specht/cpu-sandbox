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
and the program starts with the marker, the right CPU level and a few
starter lines.

## In the browser

- The **task bar** above the editor shows the task of the open program; the
  arrow shows the whole text.
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
The task bar shows the addresses for the CPU level of the open program.

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

| Task | Language | What to do |
| --- | --- | --- |
| `add` | either | Add the bytes at +0 and +1, write the sum to +2. |
| `countdown` | either | Show 10, 9, …, 0 on the number display. |
| `maximum` | either | Find the largest of eight bytes (assembly: in A; C: on the number display). |
| `length` | either | Count the characters of a zero-terminated text (assembly: in A; C: on the number display). |
| `multiply` | either | Multiply +0 × +1, 16-bit product to +2 (low) and +3 (high). |
| `checkerboard` | either | Paint a checkerboard on a 16 × 8 gray screen at +0. |
| `sort` | either | Sort eight bytes in place. |
| `digits` | either | Show typed digits on the number display until Enter. |
| `fibonacci` | either | Write 1, 1, 2, 3, … 233 to +0 … +12. |
| `average` | either | Show the average of n bytes (n at +0) on the number display. |
| `reverse` | either | Reverse a zero-terminated text in place. |
| `factorial` | C | A recursive factorial; n! as an int to +2. |
| `gcd` | C | The greatest common divisor of two ints. |
| `primes` | C | Show every prime below 100 (sieve of Eratosthenes). |
| `letters` | C | Count each letter of a text into 26 counters at +0x100. |
| `line` | C | Draw a line on a 32 × 24 gray screen at +0x100. |

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
| `title`, `text` | shown in the task bar and in class progress |
| `language` | `'any'` (default) or `'c'` for a C task |
| `cpu` | `cpu8` (default), `cpu8s` or `cpu8x` for new assembly programs; C starts on `cpu8x` |
| `starter` | `{ asm, c }`: the first lines of a new program after the marker |
| `limit` | cycles per case before the program counts as stuck (default 200,000) |
| `cases` | `name`; `memory: { offset: [bytes] }` (from the start of the input) and `typed: 'text'` as input |
| `expect` | `A`–`D`: register values; `memory: { offset: [bytes] }`; `numbers: [...]`, the values shown on the number display in order; `answer`: in A for assembly, on the number display for C; `check(run)`, a function that returns a message when something is wrong |

In `text` and `starter`, write addresses as `{+0}`, `{+2}`, `{+0x100}`: they
become 0x80, 0x82, … or 0x8000, 0x8002, … for the CPU level.

Add a reference solution to `test/tasks.test.js`; `npm test` then checks
that the task can be solved and that every starter builds.
