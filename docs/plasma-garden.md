# Plasma Garden: color from 8-bit assembly

`examples/17-plasma-garden.asm` is a **static**, computed picture. Select it in
CPU Sandbox and press **Run to end**. Step through it to inspect individual
writes, or change the display controller to reinterpret those same bytes.

## Why it fits the basic machine

| Region | Purpose |
| --- | --- |
| `0x00..0x66` | Executable machine code (103 bytes) |
| `0x67..0x6E` | Unused gap |
| `0x6F` | One scratch byte for a wave result |
| `0x70..0x7F` | 16-entry wave lookup table |
| `0x80..0xFF` | 16×16 pixels, packed at 4 bits/pixel (128 bytes) |

The framebuffer is *ordinary RAM*. A byte such as `0x4B` means two palette
indices: `4` for the first pixel and `11` for the next. The display controller
interprets each index using `aurora_cycle_16`, an original cyclic palette whose
ends meet in similar colors. The CPU never reads or writes RGB values.

## How the algorithm works

For each byte of the framebuffer, the program derives a horizontal coordinate
from its three low address bits and a vertical coordinate from its upper bits.
It looks up three waves in the same 16-byte table:

1. A horizontal wave indexed by the even x-coordinate (0, 2, …, 14).
2. A vertical wave indexed by the row (0 through 15).
3. A diagonal wave indexed by (x + y) modulo 16.

The three wave values are added and reduced modulo 16 to select one of sixteen
colors. A neighboring palette index is packed into the same byte, giving the
image a 16-pixel-wide appearance despite operating on pairs of pixels.

`LDA B, [B]` is the crucial operation: it uses a register as the address of a
lookup-table element, allowing a sinusoid-like effect without any floating
point, multiplication, or dedicated graphics instructions. The table is a
simple approximation; this is a *plasma-style interference pattern*, not a
numerically accurate simulation of waves.

## Questions for students

- Why does `SHL B` appear immediately after extracting the horizontal position?
- How can 256 colored pixels fit into just 128 bytes?
- What would happen if the framebuffer began at `0x60` instead of `0x80`?
- Why can changing the palette radically change the image without changing RAM?
- Why is **Run to end** preferable to Play for this static example?
- What would be needed for twice the width, at the same color depth?

Try changing the 16 `.db` wave values and then running the program again.
Changing values alone can transform the picture. The display controller
allows experimenting with another 16-color palette independently from the
assembly source.
