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

A program may not put its own bytes where a task puts its input (for most
tasks 0x80 and up on MiniCPU 8): the check says so. On MiniCPU 8X the inputs
start at 0x8000.

## The tasks

| Task | CPU | What to do |
| --- | --- | --- |
| `add` | 8 | Add the bytes at 0x80 and 0x81, write the sum to 0x82. |
| `countdown` | 8 | Show 10, 9, …, 0 on the number display. |
| `maximum` | 8 | Leave the largest of the eight bytes at 0x80–0x87 in A. |
| `length` | 8 | Leave the length of the zero-terminated text at 0x80 in A. |
| `multiply` | 8 | Multiply 0x80 × 0x81, 16-bit product to 0x82 (low) and 0x83 (high). |
| `checkerboard` | 8 | Paint a checkerboard on the 16 × 8 gray screen at 0x80. |
| `sort` | 8 | Sort the eight bytes at 0x80–0x87 in place. |
| `digits` | 8 | Show typed digits on the number display until Enter. |
| `fibonacci` | 8 | Write 1, 1, 2, 3, … 233 to 0x80–0x8C. |
| `average` | 8X | Show the average of n bytes (n at 0x8000) on the number display. |
| `reverse` | 8X | Reverse the zero-terminated text at 0x8000 in place. |

The CPU column is the level a new program starts with. A program may use a
higher level, for example MiniCPU 8S for subroutines. The MiniCPU 8 tasks are
meant for assembly; C needs the stack of 8S and is often too big for the
space below 0x80.

## Adding a task

Tasks live in `src/tasks.js`. A new one is an entry in `TASKS`:

```js
task({
  id: 'double', title: 'Double it',
  text: 'Double the byte at 0x80 and write the result to 0x81. It stays below 256.',
  cases: [[1], [0], [100], [127]].map(([n]) => ({
    name: `2 × ${n}`, memory: { 0x80: [n] }, expect: { memory: { 0x81: [2 * n] } },
  })),
}),
```

| Field | |
| --- | --- |
| `id` | the name in the `Task:` line |
| `title`, `text` | shown in the task bar and in class progress |
| `cpu` | `cpu8` (default), `cpu8s` or `cpu8x` for new programs |
| `starter` | `{ asm, c }`: the first lines of a new program after the marker |
| `limit` | cycles per case before the program counts as stuck (default 200,000) |
| `cases` | `name`; `memory: { address: [bytes] }` and `typed: 'text'` as input |
| `expect` | `A`–`D`: register values; `memory: { address: [bytes] }`; `numbers: [...]`, the values shown on the number display in order; `check(run)`, a function that returns a message when something is wrong |

Add a reference solution to `test/tasks.test.js`; `npm test` then checks
that the task can be solved and that every starter builds.
