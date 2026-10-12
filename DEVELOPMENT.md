# CPU Sandbox · development guide

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
stores a copy in a student folder, and the **+** next to the program menu
creates a new assembly or C program there.

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
| Adds | registers A–D, ZF/CF, jumps | a stack: `PUSH POP CALL RET`, arguments and locals at `[SP+n]` | 64 KiB RAM, 16-bit addresses, 16-bit registers X/Y |
| RAM | 256 bytes | 256 bytes | 65,536 bytes |
| Demo | fire | scrolling text | Mandelbrot set, a bigger fire |

A program states its level with `.cpu 8`, `.cpu 8s` or `.cpu 8x` (default 8);
the CPU menu edits that line. All levels share one instruction set: higher
levels add registers (SP, then X and Y), and the instructions students already
know work with them. The same source runs on higher levels, where 8X encodes
every address in two bytes. Details, the full instruction table and the cycle
model: [docs/cpu-levels.md](docs/cpu-levels.md). The **Documentation** button
shows the same reference in the browser, together with the devices, the
assembler directives and an ASCII table.

## In the browser

- **Left:** the editor. The margin shows the address and the bytes of every
  line; bytes the program has overwritten turn amber. Assembly happens while
  you type, problems are listed under the editor. Click a line number to set a
  breakpoint.
- **Right:** registers and flags (changes are highlighted; a click switches
  the registers between hex and binary; hovering a flag explains why the last
  instruction set or cleared it), the screen, and RAM. Clicking a byte of the
  program in RAM puts the cursor on its line. The next instruction is blue in RAM and highlighted in the editor.
  Pointing at a byte says what it is: an instruction and its line, a variable
  (`int score`, `letters[2]`, high byte), a string, a helper routine, or —
  while a C program is paused — a local variable, an argument or a return
  address on the stack. With 64 KiB, **64** and **256** bytes per row show
  all of RAM as colored dots (code, data, screen, stack; brighter = larger
  value), and bytes the program is writing glow; click a dot to zoom in.
- **Bottom:** restart, step back, run/pause, step, and the **clock** from 1 Hz
  to 64 MHz. Every instruction costs a realistic number of cycles, so a
  program takes as long as it would on real hardware at that clock. If the
  browser cannot keep up, the status line says how fast it really runs.

The screen is a view of RAM: drag the picture up or down to move through memory, drag its
corner to resize it, and pick the pixel format and palette above it. This
never changes RAM. Programs can set their own colors in the palette chip and
wait for the screen's next picture (vsync). See [docs/screen.md](docs/screen.md).

Devices sit at I/O ports, read with `IN` and written with `OUT`: a joystick, a
keyboard, the keys held (by their place on the keyboard), a timer, vsync,
random numbers, a speaker with note lengths, a number display, a screen
page register for flicker-free animation (page flipping) and the palette chip. The devices
a program uses appear above the screen; **click the screen** to send your keys
to the program (Esc gives them back). See [docs/devices.md](docs/devices.md).

| Keys | |
| --- | --- |
| Ctrl+S | save |
| Space | run / pause (outside the editor and the screen) |
| ← → | step back / forward |
| Home | restart |
| Ctrl+/ or Ctrl+# | comment lines |
| Ctrl+Shift+K | delete the line |
| Shift+Alt+F | format the source (also the **Format** button) |

The sun/moon button switches between the dark and the light theme. The choice
is stored in `.settings.yaml` in the app folder, which Git ignores, so it
stays on this computer and never reaches a student repository.

## Examples

| | Level | |
| --- | --- | --- |
| `01-add` … `04-square-root` | 8 | registers, flags, loops |
| `05-memory`, `06-rectangle` | 8 | addressing, pixels in RAM |
| `07-primes`, `08-self-modifying` | 8 | cost of algorithms, code is data |
| `09-pixel-formats`, `10-bouncing-dot` | 8 | screen formats, an endless loop |
| `11-fire` | 8 | demo: flickering flames, code and screen in 256 bytes |
| `12-subroutines`, `13-recursion` | 8S | the stack, arguments and local variables |
| `14-scroller` | 8S | demo: LED sign |
| `15-pointers`, `16-lines` | 8X | X/Y, Bresenham lines |
| `17-mandelbrot` | 8X | demo: fixed-point fractal with a table of squares |
| `18-inferno` | 8X | demo: the DOOM fire at 128 × 96 pixels |
| `19-input` | 8 | devices: joystick, keyboard, timer, number display |
| `20-breakout` | 8X | a game: paddle, ball, colored bricks, sound |
| `21-first-c.c` | 8S | C: functions, locals on the stack, the generated assembly |
| `22-cube.c` | 8X | C demo: a solid, shaded 3D cube with its own palette, vsync, page flipping and an assembly inner loop |
| `23-snake.c` | 8X | C game: joystick, vsync, random numbers, speaker, number display |
| `24-plasma.c` | 8X | C demo: the plasma effect in RGB 3-3-2 |
| `25-life.c` | 8X | C: Conway's Game of Life with glowing cells |
| `26-stars.c` | 8X | C: flying through a starfield, speed on the joystick |
| `27-color-cycling.c` | 8X | C: a picture drawn once, animated only through the palette chip and vsync |
| `28-arpeggio-organ.c` | 8X | C: three octaves of chords on the keyboard, arpeggios in exact rhythm, adjustable tempo |
| `29-raycaster.c` | 8X | C: a 3D maze with textured walls, floor and ceiling, fog from the palette, a map |

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

Square brackets always mean memory: `LDI A, 0x70` loads the number 0x70,
`LDA A, [0x70]` the byte at address 0x70, `LDA A, [B]` the byte at the address
in B. Numbers: `42`, `0x2A`, `0b101010`, `'A'`; expressions with
`+ - * / & | << >>`. Comments start with `;`.

## C

Programs in `.c` files are written in MiniC, a small C that compiles to
MiniCPU assembly as you type. The margin shows the bytes of every C line, and
the **Assembly** tab shows the generated code under each C line. `char` has 8
bits, `int` and pointers 16 bits on 8X; there are functions, pointers, arrays,
strings, `in()`/`out()` for the devices and `#define`. Details and the
differences from C: [docs/minic.md](docs/minic.md).

## Tasks

A program takes part in a task when one of its first lines is `; Task: add`
(`// Task: add` in C). The task bar above the editor shows the task, **Check**
runs its test cases on fresh machines and **Try it** loads a case into the
machine to debug it. **Class progress** (top right) checks every program in
`programs/` on the server and shows the best attempt per student and task;
clicking a task compares the working solutions by cycles and bytes. The tasks,
their starter programs and their cases are defined in `src/tasks.js`; see
[docs/tasks.md](docs/tasks.md) for the list and how to add one.

## Tests

```sh
npm test        # Node's built-in test runner, no npm install
npm run docs    # regenerate the instruction table in docs/cpu-levels.md
node scripts/light-theme.mjs web/style.css web/light.css   # after changing colors
```

## How it works

- `src/` — assembler, MiniC compiler (`minic.js`), CPU, screen decoding and palettes. The same modules run
  in Node (tests) and in the browser. `src/opcodes.js` is the only place that
  defines opcodes, sizes and cycles; the browser reference is generated from it.
- `web/` — the page. CodeMirror, fonts and icons are bundled; there are no
  requests to other servers.
- `src/tasks.js` — the tasks and their checks, used by the browser (Check) and
  the server (class progress).
- `server.mjs` — serves the page and reads and writes `.asm` and `.c` files under
  `programs/<student>/`. It listens on `127.0.0.1`, has no login and must not be
  exposed to an untrusted network. Writes need same-origin JSON; file names,
  symbolic links and sizes (64 KiB) are checked.

| Method | Endpoint | |
| --- | --- | --- |
| GET | `/api/catalog` | examples and student folders with their files |
| GET, PUT | `/api/source?group=anna&file=sum.asm` | read / save (HTTP 409 if changed on disk) |
| POST | `/api/programs` | create `{group, file, source}`; never overwrites |
| GET | `/api/progress` | every student's best attempt per task (results are cached per file content) |

The interpreter runs roughly 30–50 million cycles per second in Node and a
little less in the browser. Each step is journaled in typed arrays (no garbage
for the collector), so **step back** undoes the last 50,000 instructions
exactly without slowing the CPU down.
