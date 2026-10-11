# CPU Sandbox

A browser-based assembly editor, two-pass assembler and interactive **8-bit MiniCPU**.
Students select their **own assembly programs from a directory on disk**, edit them in
the browser, and save them back to the same files. Git remains the source of truth.

No C compiler, Ruby runtime, Dart SDK, external frontend libraries, database, or
account is required. The first implementation uses a dependency-free **Node.js local
host** and JavaScript assembler/CPU. A Dart host could later implement the same small
HTTP API; this version prioritizes a tested, self-contained workflow.

## Start

Prerequisite: Node.js 18+ (22+ recommended).

```sh
./run
# Open http://127.0.0.1:8765
```

The bundled examples are available immediately, without student files. They
are read-only by design: **Copy example** saves a new copy into a student directory.

### Attach a class repository

As in the Data Structures Sandbox, keep the classroom sources in a **separate Git
repository**, cloned into a fixed directory. For example:

```sh
cd cpu-sandbox
# Substitute the GitLab URL for this particular class/year:
git clone git@git.nhcham.org:YOUR-GROUP/YOUR-CLASS-ASSEMBLY.git programs
./run
```

The expected layout is:

```text
cpu-sandbox/                      # app (teacher)
├── run
├── server.mjs
├── src/                      # browser assembler and CPU
├── examples/                 # bundled read-only demonstrations
├── web/
└── programs/                 # separate Git repository, not tracked by the app
    ├── anna/
    │   ├── sum.asm
    │   └── rectangle.asm
    └── ben/
        └── square-root.asm
```

Student folders and `.asm` files are discovered **on every refresh**, so new Git
pulls or changes from other editors appear without restarting the host. Existing
student files are **never created or overwritten** during application startup.

For a local trial without Git, use:

```sh
mkdir -p programs/demo-student
cp examples/01-add.asm programs/demo-student/add.asm
./run
```

Do this *instead of* cloning a class repository into `programs/`, not before it.

## In the browser

1. Choose **Student** and **Program**, or start with a read-only **Example**.
   Syntax coloring and assembly happen automatically after a short typing pause
   (about 280 ms); errors point to source lines. **Save** (Ctrl+S) is independent
   and explicitly writes the `.asm` back to disk.
2. Study the machine state: registers A–D, ZF/CF, program counter, RAM, and
   the decoded pixels. The source line of the current instruction is highlighted.
3. **Step** / **Back** to inspect instructions; **Play** and **speed** for
   animation; **Run to end** for bounded fast execution; **Reset** restores the
   initial assembled program image. Infinite-loop demos remain stoppable.
4. Switch inspector tabs between **RAM**, **Machine code**, and **Execution
   trace**. A program that modifies its own machine code displays the actual
   changed bytes in the machine-code inspector.
5. Open **Configure display** to alter the memory-mapped screen controller
   *live*, including during execution. Width, height and bit depth use sliders;
   indexed palettes are filtered by bit depth. Screen pixels stay square.
   These controls NEVER alter CPU memory.
   The program's `.display` directive is merely the initial suggestion: **Use
   suggested** restores it. No directive means a 16×8 grayscale interpretation
   starting at `0x80`.
6. **Save** (Ctrl+S) writes the edited `.asm` file to the student directory.
   If another editor or a Git operation changed it meanwhile, the server
   refuses to overwrite and reports a revision conflict.

There is no required **Assemble** button. When assembly succeeds after a source
change, the CPU restarts with the new program; unsaved edits may still run.
A new assembly never silently saves the file. The compiled bytes and execution
history exist only in browser memory.

The two panels fill the available desktop viewport, with independent scrolling
for the editor and the inspector; smaller screens use a responsive vertical
layout. Syntax highlighting is dependency-free and based on assembly tokens.

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+S | Save source to disk |
| Ctrl+Enter | Force immediate assembly (usually unnecessary) |
| Tab | Insert two spaces in editor |
| Right / Left | Step forward / backward (outside editor) |
| Space | Play / Pause (outside editor) |

## Memory-mapped display controller

MiniCPU 8 and 8S have **256 shared bytes of RAM**, while 8X has **4 KiB**.
None has dedicated graphics hardware. The screen is simply a configurable interpretation of bytes from
this RAM. For example, these modes all use 64 bytes of memory:

| Pixel format | Example resolution | Layout |
| --- | --- | --- |
| Monochrome (`mono`) | 32×16 | 1 bit/pixel, eight pixels/byte |
| 2-bit indexed (`indexed2`) | 16×16 | 2 bits/pixel, four pixels/byte |
| 4-bit indexed (`indexed4`) | 16×8 | 4 bits/pixel, two pixels/byte |
| 8-bit (`indexed8`, `gray8`, `rgb332`) | 8×8 | one pixel/byte |
| RGB888 (`rgb24`) | 4×5 | three bytes/pixel = 60 bytes |

Indexed modes use the pixel value as the **index into a palette**. Grayscale uses
0–255 brightness, RGB332 stores 3 red, 3 green and 2 blue bits, and RGB24 uses
three consecutive R,G,B bytes. Packed pixels are read **most-significant bits
first**. Only palettes whose number of entries matches the bit depth can be chosen. Current built-in palettes
are a curated subset of [PixelRAM's palettes](https://github.com/specht/pixelram/blob/main/tools/palettes.yaml):
1-bit monitor glow, CGA, Color Graphics Adapter 16, VGA 256,
PICO-8, Sweetie 16, Dreamscape 8, SLSO8 and Endesga 32. The original palette
indices are preserved. CPU Sandbox additionally bundles an original cyclic
16-color palette (`aurora_cycle_16`) for the static plasma example.

A program can suggest a display configuration without emitting instructions:

```asm
; 256 pixels, 32 by 8, packed into 32 bytes at 0xA0
.display 0xA0, 32, 8, mono, 1bit_monitor_glow
```

Syntax: `.display start, width, height, mode [, palette]`. Every row starts
immediately after the previous row (rounded up to the next byte when packed).
Indexed modes require a palette with exactly 2^bit-depth colors; grayscale
and RGB modes take no palette. The mapping must fit the selected CPU’s RAM (256 bytes on 8/8S or 4 KiB on 8X).
The browser controller can override the suggestion; it never changes RAM. [Display controller reference](docs/display-controller.md)
contains more examples and an explanation of the mapping.

Try examples `09`–`15` to compare packing, color indices, RGB and genuinely
self-modifying code. In example `12`, the processor overwrites an `LDI`
instruction's immediate operand: both its bytes and its effect change while
its assembly source text remains unchanged.

## Instruction set

Designed to remain compatible with `specht/lowlevel/minicpu`:

| Category | Mnemonics |
| --- | --- |
| Move / memory | `LDI`, `LDA`, `STA`, `MOV` |
| Arithmetic | `ADD`, `SUB`, `INC`, `DEC`, `SHL`, `SHR` |
| Boolean | `AND`, `OR`, `XOR` |
| Comparison | `CMP` immediate or register |
| Branching | `JMP`, `JZ`, `JNZ`, `JC`, `JNC` |
| Other | `CLF`, `NOP`, `HLT` |
| Assembly directives | `.org`, `.db` / `.byte`, `.equ`, `.display` (metadata only), labels |

The CPU uses 8-bit unsigned wraparound and flags: `CF` represents carry for
addition/shifts and borrow for subtraction/comparison. `ZF` indicates zero.
LDI, LDA, STA and MOV do not change flags. `HLT` terminates execution. More
examples and exercises: [docs/teaching.md](docs/teaching.md).

## Run tests

```sh
npm test            # uses Node's built-in test runner; no npm install needed
```

Tests exercise assembly, instruction encoding and execution (including 61,704
instructions in the prime-number demo), display bit packing, palette sizes, packed row alignment, palette
indices, self-modifying code, disk discovery/read/write, optimistic conflicts,
and path-traversal/symlink rejection.

## Architecture and boundaries

- **Local backend:** `server.mjs` serves the browser and a small filesystem API.
  It reads real `.asm` files under `programs/<student>/` and writes only there.
  A read-only `@examples` group is provided separately.
- **Browser:** `src/assembler.js` compiles editor text into MiniCPU bytecode;
  `src/cpu.js` executes it instruction by instruction; `src/display.js`
  decodes the same 256 RAM bytes into configurable pixels and never mutates
  them; `web/app.js` renders everything and interacts with the disk API.
- **Security:** HTTP server listens on `127.0.0.1` by default, has **no login**, and
  must **not** be published on the open internet. Filename checks and symlink
  rejection prevent basic filesystem traversal; writes require same-origin JSON.
  Larger deployments would require authentication and additional sandboxing.
- **Limits:** programs have max 256-byte address space; individual source files
  max 64 KiB; fast execution capped at 200,000 instructions; reverse history
  keeps the last 3,000 snapshots to keep memory bounded.
- **No native C tools:** this is a fresh independent project, not a modification
  of the old `lowlevel` source repository. No source file or commit is touched on
  your GitLab server.

## Backend endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/catalog` | List examples, student directories and `.asm` files |
| GET | `/api/source?group=anna&file=sum.asm` | Retrieve source and SHA-256 revision |
| PUT | `/api/source?group=anna&file=sum.asm` | Save `{source, revision}`; HTTP 409 on conflict |
| POST | `/api/programs` | Create `{group, file, source}` with no-overwrite semantics |

`--programs /path/to/class-repo`, `--port 8765`, and `--host 127.0.0.1` are
available to `./run`. Use `--host` other than loopback only on a *trusted* network.

## Local fonts and icons

The interface uses **Open Sans** for controls and headings, **0xProto Nerd Font**
for the editor, memory, and machine listings, and a bundled
`web/vendor/tabler-icons.svg` sprite for buttons. It makes **no CDN requests**
and does not search sibling projects or the host's installed fonts.

Font binary files must be placed in the app itself before packaging/deploying:

- `web/vendor/fonts/OpenSans.ttf` (Open Sans, SIL Open Font License 1.1)
- `web/vendor/fonts/0xProtoNerdFont.ttf` (0xProto Nerd Font, SIL Open Font License 1.1)

Include the respective upstream license texts when distributing these fonts.
The font stylesheet falls back to system fonts until both local TTF assets
have been added. Tabler icon artwork is MIT-licensed (https://tabler.io/icons).


### Color demo: Rainbow Interference

Load `16-rainbow-interference.asm` and press **Play**. Increase the speed to
watch a shifting 16-color pattern appear, while the RAM inspector shows the
same 128 bytes that encode its **256 square pixels**. Each byte contains two
4-bit indices into the `sweetie_16` palette. No dedicated framebuffer or
extra CPU RAM is involved. Pause and change the display controller between
4-bit indexed, monochrome, and grayscale to explore the same bytes.

The example continually overwrites only addresses `0x80..0xFF`, leaving its
own executable instructions untouched. This is also a good starting point for
asking how to draw larger/colorful images within a 256-byte shared address
space before considering an extended architecture.

### Graphics showcases: one for each CPU model

All images below are computed by the CPU using ordinary arithmetic and RAM
writes. They are **not pre-rendered bitmaps** and need no graphics instructions.
Choose the matching CPU in the top bar, open the example, and select
**Run to end**. Step through individual writes to see how colors are packed.

| CPU | Example | Output | Framebuffer | Main technique |
| --- | --- | --- | --- | --- |
| MiniCPU 8 | `17-prism-gradient.asm` | 16×16, 16 colors | 128 B at `0x80` | Nested loops, palette indices, 2 pixels/byte |
| MiniCPU 8S | `21-stack-neon-halo.asm` | 16×12, 16 colors | 96 B at `0x90` | CALL/RET, saved register, Manhattan-distance rings |
| MiniCPU 8X | `22-extended-neon-orbit.asm` | 64×48, 16 colors | 1,536 B at `0x0800` | 16-bit index X, CALL16, approximate radial distance |

The **8S framebuffer ends at `0xEF`** to leave space for the stack at
`0xF0..0xFF`. All three programs leave their machine code intact. You can
reinterpret their exact framebuffer bytes by changing the display controller
or selecting a different 16-color palette—neither alters RAM.

See [the graphics walkthrough](docs/graphics-showcases.md) for the assembly
algorithms, memory maps, and discussion prompts.

## CPU models and opcode families

Select the processor at the top of the browser. The source is automatically
reassembled and the CPU reset when the model changes; unsaved source edits are
not discarded. The three models share **one deliberately designed opcode map**:

| Model | Program counter | RAM | New facilities |
| --- | --- | --- | --- |
| MiniCPU 8 | 8-bit | 256 B | Basic A–D registers, flags, jumps |
| MiniCPU 8S | 8-bit | 256 B | Shared-RAM stack, `PUSH`, `POP`, `CALL`, `RET` |
| MiniCPU 8X | 16-bit | 4 KiB | 16-bit X and SP, extended jumps, `CALL16`, `[X]` access |

| Opcode range | Family |
| --- | --- |
| `00`–`0F` | Control (`NOP`, `HLT`, `CLF`) |
| `10`–`1F` | Data movement and addressing (`LDI`, `LDA`, `STA`, `MOV`, `LDX`) |
| `20`–`2F` | Arithmetic and shifts |
| `30`–`3F` | Bitwise logic |
| `40`–`4F` | Comparisons |
| `50`–`5F` | Stack and subroutines |
| `60`–`6F` | Jumps, including long jumps |
| `70`–`FF` | Reserved |

See [the complete instruction encodings](docs/instruction-encoding.md).
The ISA is **source-compatible across model levels**: every MiniCPU 8 assembly
program can be reassembled for 8S or 8X. The earlier Ruby emulator's machine
code bytes are **not** compatible. Assemblies and examples are not binary files,
so there is no migration step.

The stack is ordinary memory at the high end of the address space and grows
downward. Its content may overlap a framebuffer or other program data: this is
intentional and visible to students, so keep the display away from the stack
when writing graphics subroutines. A short jump or `CALL` uses an 8-bit absolute
address; use `JMP16`, `JZ16`, `JNZ16`, `JC16`, `JNC16`, or `CALL16` to reach code
above `0x00FF` on 8X.
