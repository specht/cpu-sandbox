# MiniC: C for the MiniCPU

Programs in `.c` files are written in MiniC, a small C that the sandbox
compiles to MiniCPU assembly while you type. Nothing is hidden: the margin of
the editor shows the address and the bytes of every C line, and the
**Assembly** tab above the editor shows the generated program, each part below
its C line as a comment. Running and stepping work as for assembly; a step is
one instruction, and the C line it belongs to is highlighted.

```c
#pragma cpu 8x                          // the CPU level (default 8X)
#pragma display 0x0800, 64, 48, mono    // the suggested screen, like .display

#define SCREEN ((char*)0x0800)

int squares[10];

int square(int n) {
    return n * n;
}

void main() {
    for (int i = 0; i < 10; i++)
        squares[i] = square(i);
    out(NUMBER, squares[9]);            // 81 on the number display
}
```

## What is there

| | |
| --- | --- |
| Types | `char` (8 bits, 0–255), `int` (signed), `unsigned int`, `void`, pointers, arrays. `int` and pointers have 16 bits on MiniCPU 8X and 8 bits on 8 and 8S. |
| Statements | `if`/`else`, `while`, `do`/`while`, `for`, `break`, `continue`, `return`, blocks; declarations anywhere in a block. |
| Operators | `+ - * / % & \| ^ ~ << >> ! && \|\| == != < <= > >= ?: = += -= … ++ -- & * [] (casts) sizeof` |
| Values | `42`, `0x2A`, `0b101010`, `'A'`, `"strings"` (with `\n`, `\0`, `\xHH`). |
| Preprocessor | `#define NAME value`, `#define NAME(a, b) …`, `#undef`, `#pragma cpu`, `#pragma display`. |
| Devices | `in(port)` returns a `char`, `out(port, value)` writes one. Predefined: `JOYSTICK KEYBOARD TIMER RANDOM VSYNC KEYS SPEAKER NUMBER SCREEN_PAGE PALETTE COLOR NOTE_LENGTH`, `KEY_SHIFT`, `JOY_LEFT JOY_RIGHT JOY_UP JOY_DOWN JOY_FIRE`, `NULL true false`. |
| Assembly | `asm("INC A");` inserts instructions, one per line: `asm("loop:\n" "DEC A\n" "JNZ loop");` Labels and `;` comments work as in assembly. |

The CPU menu edits the `#pragma cpu` line.

## Different from C, on purpose

- **char arithmetic stays 8 bits wide**, like the registers: for two `char`s,
  `200 + 100` is 44. As soon as an `int` takes part, the computation is done
  in `int`; a constant takes the type of the other operand if it fits.
  Write `(int)a + b` to compute a `char` sum without overflow.
- **Arrays live outside of functions**, and `&` works only on global
  variables. Local variables are on the stack and are reached with `[SP+n]`,
  but there is no instruction that copies SP into a register, so their address
  cannot be computed.
- **No** `struct`, `union`, `enum`, `switch`, `goto`, `typedef`, floating
  point, `long` or `#include`. Fixed point replaces floating point (64 = 1.0
  in `22-cube.c`).
- **MiniCPU 8** has no stack: a program has only `main`, its local variables
  become global ones, and `*`, `/`, `%` (except by powers of two) and shifts
  by a variable amount are not available, because they need helper routines.

## The generated code

- The value of an expression ends up in A (8 bits) or X (16 bits). For a
  binary operator, the left side is computed first; if the right side is not a
  constant or a variable, the left value waits on the stack (`PUSH`) meanwhile.
- **Functions**: the caller `PUSH`es the arguments from left to right and
  `CALL`s the function, which starts with `SUB SP, n` for its local variables
  and reaches them and the arguments with `[SP+n]`. The result comes back in A
  or X; the function frees its locals with `ADD SP, n`, the caller frees the
  arguments. A–D, X and Y can be changed by any call.
- **Globals** are labels with an underscore (`_score`) after the code, strings
  are labels `string_1`, … Control flow uses labels like `while_3`.
- `*`, `/`, `%` and shifts by a variable amount call helper routines (`mul16`,
  `divs16`, `sar16`, …), which are added at the end of the program only when
  it uses them. Multiplication and division by powers of two become shifts.
- The C program starts with `CALL _main` and halts when `main` returns.

On 8S and 8X the stack grows down from the end of RAM. A program that fills
all of RAM leaves no room for it; the compiler warns when fewer than 32 bytes
are left.
