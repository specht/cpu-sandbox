# CPU Sandbox

Write assembly for a small 8-bit fantasy CPU in the browser, step through it
instruction by instruction, and watch registers, RAM and a memory-mapped
screen change. Student programs are plain `.asm` files on disk, kept in a
class Git repository.

Requirements: Node.js 18 or newer. Nothing to install, no build step.

```sh
./run
# open http://127.0.0.1:8765
```

The bundled examples work right away. They are read-only; **Save copy**
stores a copy in a student folder.

## Class repository

As in the Sorting and Data Structure Sandboxes, student programs live in a
separate Git repository cloned into `programs/`:

```sh
cd cpu-sandbox
git clone git@git.nhcham.org:YOUR-GROUP/YOUR-CLASS-ASSEMBLY.git programs
./run
```

```text
cpu-sandbox/            the app
├── examples/           bundled, read-only
└── programs/           the class repository (ignored by the app's Git)
    ├── anna/
    │   └── sum.asm
    └── ben/
        └── fire.asm
```

New folders, files and changes from `git pull` appear in the browser within a
few seconds. **Save** refuses to overwrite a file that changed on disk in the
meantime. `./run --programs DIR --port 8765 --host 127.0.0.1` changes the
defaults.

## Three CPU levels

| | MiniCPU 8 | MiniCPU 8S | MiniCPU 8X |
| --- | --- | --- | --- |
| Adds | registers A–D, ZF/CF, jumps | a stack: `PUSH POP CALL RET`, arguments and locals at `[SP+n]` | 4 KiB RAM, 16-bit addresses, pointers X/Y |
| RAM | 256 bytes | 256 bytes | 4096 bytes |
| Demo | fire | scrolling text | Mandelbrot set |

A program states its level with `.cpu 8`, `.cpu 8s` or `.cpu 8x` (default 8);
the CPU menu edits that line. The same source runs on higher levels, where
8X encodes every address in two bytes. Details, the full instruction table and
the cycle model: [docs/cpu-levels.md](docs/cpu-levels.md). The **Instruction
set** button shows the same reference in the browser.

## In the browser

- **Left:** the editor. The margin shows the address and the bytes of every
  line; bytes the program has overwritten turn amber. Assembly happens while
  you type, problems are listed under the editor. Click a line number to set a
  breakpoint.
- **Right:** registers and flags (changes are highlighted), the screen, and
  RAM. The next instruction is blue in RAM and highlighted in the editor.
- **Bottom:** restart, step back, run/pause, step, and the **clock** from 1 Hz
  to 16 MHz. Every instruction costs a realistic number of cycles, so a
  program takes as long as it would on real hardware at that clock.

The screen is a view of RAM: drag the picture to move through memory, drag its
corner to resize it, and pick the pixel format and palette above it. This
never changes RAM. See [docs/screen.md](docs/screen.md).

Devices sit at I/O ports, read with `IN` and written with `OUT`: a joystick, a
keyboard, a timer, random numbers, a speaker and a number display. The devices
a program uses appear above the screen; **click the screen** to send your keys
to the program (Esc gives them back). See [docs/devices.md](docs/devices.md).

| Keys | |
| --- | --- |
| Ctrl+S | save |
| Space | run / pause (outside the editor and the screen) |
| ← → | step back / forward |
| Home | restart |
| Ctrl+/ | comment lines |

## Examples

| | Level | |
| --- | --- | --- |
| `01-add` … `04-square-root` | 8 | registers, flags, loops |
| `05-memory`, `06-rectangle` | 8 | addressing, pixels in RAM |
| `07-primes`, `08-self-modifying` | 8 | cost of algorithms, code is data |
| `09-pixel-formats`, `10-bouncing-dot` | 8 | screen formats, an endless loop |
| `11-fire` | 8 | demo: rising flames in 96 bytes |
| `12-subroutines`, `13-recursion` | 8S | the stack, arguments and local variables |
| `14-scroller` | 8S | demo: LED sign |
| `15-pointers`, `16-lines` | 8X | X/Y, Bresenham lines |
| `17-mandelbrot` | 8X | demo: fixed-point fractal with a table of squares |
| `18-input` | 8 | devices: joystick, keyboard, timer, number display |
| `19-breakout` | 8X | a game: paddle, ball, colored bricks, sound |

A suggested order with questions and exercises: [docs/teaching.md](docs/teaching.md).

## Assembly in brief

```asm
.cpu 8s                         ; CPU level
.display 0x80, 16, 8, gray8     ; suggested screen

SIZE    .equ 16                 ; constant
        LDI A, 0x80             ; label, instruction, operands
loop:   STA [A], A
        INC A
        JNZ loop
        HLT
message: .db "Hi", 0            ; data
```

Numbers: `42`, `0x2A`, `0b101010`, `'A'`; expressions with `+ - * / & | << >>`.
Comments start with `;`.

## Tests

```sh
npm test        # Node's built-in test runner, no npm install
```

## How it works

- `src/` — assembler, CPU, screen decoding and palettes. The same modules run
  in Node (tests) and in the browser. `src/opcodes.js` is the only place that
  defines opcodes, sizes and cycles; the browser reference is generated from it.
- `web/` — the page. CodeMirror, fonts and icons are bundled; there are no
  requests to other servers.
- `server.mjs` — serves the page and reads and writes `.asm` files under
  `programs/<student>/`. It listens on `127.0.0.1`, has no login and must not be
  exposed to an untrusted network. Writes need same-origin JSON; file names,
  symbolic links and sizes (64 KiB) are checked.

| Method | Endpoint | |
| --- | --- | --- |
| GET | `/api/catalog` | examples and student folders with their files |
| GET, PUT | `/api/source?group=anna&file=sum.asm` | read / save (HTTP 409 if changed on disk) |
| POST | `/api/programs` | create `{group, file, source}`; never overwrites |

The interpreter runs a few million instructions per second in the browser,
well above the 16 MHz clock setting. Each step is journaled, so **step back**
undoes the last 50,000 instructions exactly.
