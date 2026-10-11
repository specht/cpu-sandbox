# The three MiniCPU levels

MiniCPU comes in three levels. Each level keeps everything of the one before
and adds one idea, so a class can start small and move up when a program
needs more. The CPU level is part of the program: write `.cpu 8`, `.cpu 8s`
or `.cpu 8x` in the source (without the line, a program runs on MiniCPU 8).
The CPU menu in the browser edits that line.

| | MiniCPU 8 | MiniCPU 8S | MiniCPU 8X |
| --- | --- | --- | --- |
| Idea | registers, flags, jumps | + a stack | + memory and pointers |
| RAM | 256 bytes | 256 bytes | 4096 bytes |
| Addresses | 1 byte | 1 byte | 2 bytes |
| Registers | A B C D, PC | + SP | + X Y (16 bit), XL XH YL YH |
| New instructions | — | `PUSH POP CALL RET`, `[SP+n]`, `ADD/SUB SP, n` | none: the known instructions work with X and Y |
| Demo | `11-fire.asm` | `14-scroller.asm` | `17-mandelbrot.asm`, `18-inferno.asm` |

## One instruction set

The same rules hold on every level, so nothing has to be unlearned when a
class moves up:

- **The destination comes first**: `LDI A, 5`, `ADD A, B`, `STA [0x70], A`.
- **Square brackets always mean "the memory at"**. `LDI A, 0x70` loads the
  number 0x70, `LDA A, [0x70]` the byte stored at address 0x70, and
  `LDA A, [B]` the byte at the address that is in B. Whether a number is
  written in decimal, hex or binary never matters.
- **Every arithmetic and logic instruction takes a register or a constant**
  as its second operand: `ADD A, B` and `ADD A, 16`, `AND A, 0x0F`,
  `CMP A, 10`.
- **Higher levels add registers, not new spellings.** 8S adds SP, 8X adds X
  and Y — which then work with `LDI`, `LDA`, `STA`, `MOV`, `ADD`, `SUB`,
  `CMP`, `INC`, `DEC`, `PUSH` and `POP`, exactly like A–D.

The assembler explains mistakes in these terms: `LDA A, 0x70` is answered with
"LDA reads memory: write LDA A, [0x70] for the byte at address 0x70, or
LDI A, 0x70 for the number itself".

## MiniCPU 8 — the starting point

- **One RAM of 256 bytes** (`0x00`–`0xFF`). Program, data and screen share
  it; nothing stops a program from overwriting its own instructions.
- **Four 8-bit registers** A, B, C, D (values 0–255) and the **program
  counter** PC. The CPU starts at `0x00` and runs until `HLT`.
- **Two flags.** ZF is set when a result is zero. CF is set on a carry out of
  bit 7 (`ADD`, `ADC`, `INC`, `SHL`), on a borrow (`SUB`, `SBC`, `DEC`, `CMP`:
  the first value was smaller), or by the bit shifted out (`SHR`). `AND`,
  `OR`, `XOR` clear CF. Loads, stores, `MOV` and jumps leave the flags alone.
- **Numbers larger than 255** are stored in two bytes. `ADC` and `SBC` add or
  subtract the carry of the previous instruction, so `ADD B, D` followed by
  `ADC C, 0` adds D to the 16-bit number C:B.
- **Devices.** `IN A, port` and `OUT port, A` talk to the joystick, keyboard,
  timer, random generator, speaker and number display at numbered I/O ports,
  on all three levels. See [devices.md](devices.md).

## MiniCPU 8S — a stack

- **SP**, the stack pointer, starts at `0x100`, one past the end of RAM.
  `PUSH A` decrements SP and stores A there; `POP A` reads it and
  increments SP. The stack grows downwards through ordinary RAM.
- **`CALL label`** pushes the address of the next instruction and jumps;
  **`RET`** pops it and continues there. Calls can be nested.
- **`LDA A, [SP+n]`** and **`STA [SP+n], A`** read and write the stack
  without popping it, `n` bytes above SP. **`SUB SP, n`** makes room for `n`
  bytes, **`ADD SP, n`** frees them. That is what makes arguments and local
  variables possible.
- Stack, code and screen still share 256 bytes: too many PUSHes overwrite
  whatever lies below the stack. The RAM view marks the stack.

A calling convention that works with these instructions (used in
`13-recursion.asm`):

1. The caller PUSHes the arguments and CALLs the function.
2. The function makes room for its locals with `SUB SP, n`.
3. It reads and writes locals and arguments with `[SP+n]`. On 8S, with one
   local: `[SP+0]` is the local, `[SP+1]` the return address, `[SP+2]` the
   last argument pushed. (On 8X the return address takes two bytes, so the
   arguments start one byte higher.)
4. It frees its locals with `ADD SP, n` and RETurns, with the result in A.
5. The caller frees the arguments with `ADD SP, n`.

Each call gets its own arguments and locals, so functions can call themselves.

There is no separate base (frame) pointer: all offsets are counted from SP.
That keeps the CPU small, but every PUSH inside a function moves SP and shifts
the offsets by one. The simplest rule is to reserve all locals at the start
with `SUB SP, n` and not to PUSH in the middle of a function — or to recount
the offsets, which is a good exercise in itself.

## MiniCPU 8X — memory and pointers

- **4 KiB of RAM** (`0x0000`–`0x0FFF`): room for tables, bigger screens and
  longer programs.
- **Every address is two bytes** (low byte first): `LDA A, [0x0812]`,
  `STA [0x0812], A`, jumps and `CALL` are one byte longer and one cycle slower
  than on 8/8S. PC and SP are 16 bits; `CALL` pushes a two-byte return
  address (high byte first, so the address reads low byte first in RAM).
- **X and Y**, two 16-bit registers, because A–D can only point into the
  first 256 bytes. They need no new instructions:

  | | |
  | --- | --- |
  | `LDI X, 0x0800` | load a 16-bit constant |
  | `LDA X, [0x0700]` · `STA [0x0700], X` | load and store two bytes, low byte first |
  | `LDA X, [SP+2]` · `STA [SP+2], X` | the same on the stack |
  | `MOV X, Y` | copy |
  | `ADD X, 32` · `ADD X, A` · `ADD X, Y` | add a constant, a byte (0–255) or a 16-bit register; `SUB` likewise |
  | `CMP X, 0x0900` · `CMP X, Y` | compare all 16 bits |
  | `INC X` · `DEC X` | step to the next or previous byte |
  | `PUSH X` · `POP X` | two bytes on the stack |
  | `LDA A, [X]` · `STA [X], A` | X as a pointer |

  On X and Y, ZF and CF look at all 16 bits. Shifts, logic, `ADC` and `SBC`
  stay 8-bit only.
- **XL, XH, YL, YH** are the low and high byte of X and Y. `MOV` copies
  between them and A–D: `MOV XH, A`. They work with `MOV` only.
- **Wider is slower.** A constant for X or Y is two bytes long, loads and
  stores move two bytes, and the 8-bit ALU takes an extra cycle for 16-bit
  arithmetic. The last column of the table below shows the cost.

## Clock and cycles

The speed slider sets the clock from 1 Hz to 16 MHz, and the CPU runs in real
time at that clock. Each instruction takes a number of cycles determined by a
simple model of an 8-bit CPU whose speed is limited by its memory bus:

- 1 cycle for every instruction byte fetched,
- 1 cycle for every data byte read or written (RAM, stack, return address,
  port) — 2 for X and Y,
- 1 cycle to load a new value into PC (`JMP`, a taken `Jcc`, `CALL`, `RET`),
- 1 cycle for 16-bit arithmetic (on X, Y or SP), because the ALU is 8 bits wide.

So `ADD A, B` takes 2 cycles, `LDI A, 5` 3, `LDA A, [0x70]` 4 (5 on 8X), and
`JNZ loop` 2 when it falls through and 3 when it jumps. The status line shows
the cycles used and how long that takes at the chosen clock.

## Encoding

Opcodes are grouped by family, so the first hex digit tells what kind of
instruction a byte is: `0x` control, `1x` data movement, `2x` arithmetic,
`3x` logic, `4x` comparison, `5x` stack, `6x` jumps, `7x` input/output.
Higher levels add opcodes but never renumber existing ones.

- A register byte is A = 0, B = 1, C = 2, D = 3; on 8X also XL = 4, XH = 5,
  YL = 6, YH = 7, X = 8, Y = 9.
- Two registers share one byte: first register × 16 + second register, so
  `ADD A, B` is `20 01` and `MOV B, A` is `15 10`.
- Constants follow the register byte: one byte, two (low byte first) for X
  and Y. `LDI A, 5` is `10 00 05`, `LDI X, 0x0800` is `10 08 00 08`.
- Addresses follow as one byte (8, 8S) or two bytes, low byte first (8X):
  `JMP 0x23` is `60 23` on 8/8S and `60 23 00` on 8X.

The table is generated from `src/opcodes.js` with `npm run docs`.

<!-- instructions -->
| Opcode | Instruction | Effect | Flags | Since | Bytes 8/8S · 8X | Cycles 8/8S · 8X | With X/Y: bytes · cycles |
|---|---|---|---|---|---|---|---|
| `00` | `NOP` | Do nothing. |  | 8 | 1 · 1 | 1 · 1 |  |
| `01` | `HLT` | Stop the CPU. |  | 8 | 1 · 1 | 1 · 1 |  |
| `02` | `CLF` | Clear ZF and CF. | ZF CF | 8 | 1 · 1 | 1 · 1 |  |
| `10` | `LDI A, 42` | Load the constant 42 into A. |  | 8 | 3 · 3 | 3 · 3 | 4 · 5 |
| `11` | `LDA A, [0x70]` | Load the byte at address 0x70 into A. |  | 8 | 3 · 4 | 4 · 5 | 4 · 6 |
| `12` | `LDA A, [B]` | Load the byte at the address that is in B. |  | 8 | 2 · 2 | 3 · 3 |  |
| `13` | `STA [0x70], A` | Store A at address 0x70. |  | 8 | 3 · 4 | 4 · 5 | 4 · 6 |
| `14` | `STA [B], A` | Store A at the address that is in B. |  | 8 | 2 · 2 | 3 · 3 |  |
| `15` | `MOV A, B` | Copy B into A. |  | 8 | 2 · 2 | 2 · 2 | 2 · 3 |
| `20` | `ADD A, B` | A = A + B. CF = carry out of the top bit. | ZF CF | 8 | 2 · 2 | 2 · 2 | 2 · 3 |
| `21` | `ADD A, 5` | A = A + 5. | ZF CF | 8 | 3 · 3 | 3 · 3 | 4 · 5 |
| `22` | `SUB A, B` | A = A − B. CF = borrow (A was smaller). | ZF CF | 8 | 2 · 2 | 2 · 2 | 2 · 3 |
| `23` | `SUB A, 5` | A = A − 5. | ZF CF | 8 | 3 · 3 | 3 · 3 | 4 · 5 |
| `24` | `ADC A, B` | A = A + B + CF: adds the carry of a previous ADD. | ZF CF | 8 | 2 · 2 | 2 · 2 |  |
| `25` | `ADC A, 0` | A = A + 0 + CF. | ZF CF | 8 | 3 · 3 | 3 · 3 |  |
| `26` | `SBC A, B` | A = A − B − CF: subtracts the borrow of a previous SUB. | ZF CF | 8 | 2 · 2 | 2 · 2 |  |
| `27` | `SBC A, 0` | A = A − 0 − CF. | ZF CF | 8 | 3 · 3 | 3 · 3 |  |
| `28` | `INC A` | A = A + 1. | ZF CF | 8 | 2 · 2 | 2 · 2 | 2 · 3 |
| `29` | `DEC A` | A = A − 1. | ZF CF | 8 | 2 · 2 | 2 · 2 | 2 · 3 |
| `2A` | `SHL A` | Shift left; the top bit goes to CF. | ZF CF | 8 | 2 · 2 | 2 · 2 |  |
| `2B` | `SHR A` | Shift right; bit 0 goes to CF. | ZF CF | 8 | 2 · 2 | 2 · 2 |  |
| `30` | `AND A, B` | Bitwise AND. Clears CF. | ZF CF | 8 | 2 · 2 | 2 · 2 |  |
| `31` | `AND A, 0x0F` | Bitwise AND with a constant. Clears CF. | ZF CF | 8 | 3 · 3 | 3 · 3 |  |
| `32` | `OR A, B` | Bitwise OR. Clears CF. | ZF CF | 8 | 2 · 2 | 2 · 2 |  |
| `33` | `OR A, 0x80` | Bitwise OR with a constant. Clears CF. | ZF CF | 8 | 3 · 3 | 3 · 3 |  |
| `34` | `XOR A, B` | Bitwise XOR. Clears CF. | ZF CF | 8 | 2 · 2 | 2 · 2 |  |
| `35` | `XOR A, 0xFF` | Bitwise XOR with a constant. Clears CF. | ZF CF | 8 | 3 · 3 | 3 · 3 |  |
| `40` | `CMP A, B` | Compute A − B for the flags only. | ZF CF | 8 | 2 · 2 | 2 · 2 | 2 · 3 |
| `41` | `CMP A, 10` | Compute A − 10 for the flags only. | ZF CF | 8 | 3 · 3 | 3 · 3 | 4 · 5 |
| `50` | `PUSH A` | SP = SP − 1, then store A at [SP]. |  | 8S | 2 · 2 | 3 · 3 | 2 · 4 |
| `51` | `POP A` | Load A from [SP], then SP = SP + 1. |  | 8S | 2 · 2 | 3 · 3 | 2 · 4 |
| `52` | `CALL label` | Push the return address, then jump. |  | 8S | 2 · 3 | 4 · 6 |  |
| `53` | `RET` | Pop the return address and jump there. |  | 8S | 1 · 1 | 3 · 4 |  |
| `54` | `LDA A, [SP+2]` | Load the byte 2 places above SP: an argument or a local variable. |  | 8S | 3 · 3 | 4 · 4 | 3 · 5 |
| `55` | `STA [SP+2], A` | Store A 2 places above SP. |  | 8S | 3 · 3 | 4 · 4 | 3 · 5 |
| `56` | `ADD SP, 3` | Free 3 bytes of the stack (locals, or arguments after a call). |  | 8S | 2 · 2 | 3 · 3 |  |
| `57` | `SUB SP, 3` | Make room for 3 bytes of local variables. |  | 8S | 2 · 2 | 3 · 3 |  |
| `60` | `JMP label` | Always jump. |  | 8 | 2 · 3 | 3 · 4 |  |
| `61` | `JZ label` | Jump if ZF = 1 (zero, or equal after CMP). |  | 8 | 2 · 3 | 2 / 3 · 3 / 4 |  |
| `62` | `JNZ label` | Jump if ZF = 0. |  | 8 | 2 · 3 | 2 / 3 · 3 / 4 |  |
| `63` | `JC label` | Jump if CF = 1 (carry, or less than after CMP). |  | 8 | 2 · 3 | 2 / 3 · 3 / 4 |  |
| `64` | `JNC label` | Jump if CF = 0. |  | 8 | 2 · 3 | 2 / 3 · 3 / 4 |  |
| `70` | `IN A, 0x02` | Read a byte from the device at port 2. |  | 8 | 3 · 3 | 4 · 4 |  |
| `71` | `OUT 0x11, A` | Send A to the device at port 0x11. |  | 8 | 3 · 3 | 4 · 4 |  |
<!-- /instructions -->
