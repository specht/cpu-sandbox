# Graphics algorithms on MiniCPU 8S and 8X

Graphics remain **software algorithms**: no instruction draws a character or
line. The browser display only interprets the bytes in RAM.

## 8S — Text from pixels

Open `23-stack-bitmap-text.asm` on **MiniCPU 8S**. A seven-byte bitmap glyph
encodes one five-pixel-wide letter with its pixels left aligned in an 8-bit
row. The three glyphs C, P, and U are stored as data, not as an image resource.

`drawChar` accepts A = address of the glyph, B = address of the first screen
byte, then loads seven rows and writes one row byte every three addresses. Each
`CALL` stores a return address in the last bytes of 256-byte shared RAM;
`RET` returns to the next instruction. The three calls use the **same routine**
with different parameters.

- Display: 24×8 monochrome, 24 bytes starting at `0xD0`.
- Drawn rows: seven; bottom row stays blank.
- Stack: grows downward from `0x100` and does not overlap the screen.
- Exercise: add another glyph; change the font or spacing; draw a letter
  upside down by walking backwards through its rows.

## 8X — Bresenham line rasterizer and isometric cube

Open `24-extended-wireframe-cube.asm` on **MiniCPU 8X**. The twelve edge
endpoints come from an isometric projection of eight cube vertices. All edges
are drawn (including ones that would be hidden in a solid rendering).

`drawLine` accepts (A,B) = start (x,y), (C,D) = end (x,y). It stores these
coordinates in zero-page variables, calculates the absolute differences
`dx` and `dy`, and takes the longer axis as its *major axis*. On each step,
its error accumulator determines when to advance the minor axis as well. All
numbers fit in one byte because screen coordinates are only 0..63 and 0..47.
This is the integer, major-axis form of **Bresenham's line algorithm**.

`plot` maps a pixel coordinate to a memory address:

```text
address = 0x0800 + y * 8 + (x / 8)   # integer division
bit     = 0x80 >> (x % 8)
RAM[address] |= bit
```

The address is 16 bits, but the instruction set only permits `LDX` with an
*immediate* 16-bit operand, and `INCX`/`DECX`. To plot arbitrary pixels without
adding opcodes, the example writes the computed low and high address bytes into
the `LDX` instruction in the `load_x` subroutine. When that subroutine executes,
it loads the **modified machine code**. This is intentional self-modifying code,
not a simulator trick: the modified bytes are visible in normal shared RAM.

- Display: 64×48, monochrome, 384 bytes from `0x0800`.
- Assembly: uses `CALL drawLine`, ordinary branches, shifts, flags and stores.
- Zero page: endpoint coordinates, error accumulator, and writable `LDX`
  instruction; stack remains near `0x1000`.
- The geometry is **static**; the routine actually draws twelve lines, but
  3D projection/rotation has not yet been implemented in assembly.

**Discussion and extension tasks:**

1. Change the projected vertices and predict which edge pixels change.
2. Replace the self-modifying pointer trick with a new instruction such as
   `ADDX A` or `LDX A,B` (two 8-bit halves). What complexity moves into the CPU?
3. Make hidden edges dotted. Extend Bresenham with a dash counter.
4. Store 3D vertices and calculate their 2D projection from integer formulas.
5. Animate one transformation only after the static line routine is understood.

## Transparent jump encoding and two index registers

Students write `JMP label` and `CALL label`, regardless of distance. On 8X,
the assembler uses a **short, signed PC-relative** encoding when the target is
within −128..+127 bytes of the following instruction, otherwise a **long
absolute 16-bit** encoding. It iterates the address layout until all forward
and backward targets are correct. The machine-code inspector makes the
encoding visible, but source programs need not select it.

8X also has symmetric **X** and **Y** 16-bit index registers. Both support
`LDX`/`LDY` (immediate address), `INCX`/`INCY`, `DECX`/`DECY`, and
`LDA A, [X]`/`LDA A, [Y]` and corresponding stores. A simple block-copy
program illustrates X as source and Y as destination; both access the same
shared 4 KiB RAM. They do not provide arithmetic addressing yet.

## X/Y — simple byte copies

Open `25-extended-block-copy.asm` on MiniCPU 8X. A precomputed 16×8 mosaic
is stored at `0x0400`. `X` reads source bytes, while `Y` writes to the display
region at `0x0800`. Neither memory region is special CPU hardware. Both
registers are advanced independently after each byte, making the distinction
between a source pointer and a destination pointer explicit.
