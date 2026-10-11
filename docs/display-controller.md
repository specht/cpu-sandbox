# Display controller: interpreting memory as pixels

MiniCPU has **one** 256-byte RAM array. The CPU and assembler have no concept
of a display. The sandbox interprets the **same bytes** as pixels. Adjusting
controller settings—even while running—never modifies RAM or CPU state.

## Controls

- **Start address:** first byte to interpret, decimal or `0x` hexadecimal.
- **Width and height:** sliders for raster dimensions, in pixels.
- **Bit depth:** slider selecting 1, 2, 4, 8 or 24 bits per pixel.
- **Interpretation:** at 1/2/4 bpp, indexed color; at 8 bpp, indexed,
  grayscale or RGB332; at 24 bpp, RGB888 (true color).
- **Palette:** available *only* for indexed color, and **only with exactly
  2^bits entries**. For example, 2-bit pixels offer the 4-color CGA palette;
  4-bit pixels offer PICO-8 and other 16-color palettes; 8-bit indexed offers
  VGA's 256-color palette. Grayscale and RGB bypass palettes.

Rows are tightly packed, each beginning on a new byte. **There is no stride
control.** The row size follows from the chosen dimensions and bit depth:

`rowBytes = ceil(width × bitsPerPixel / 8)`

`totalBytes = height × rowBytes`

`lastAddress = start + totalBytes − 1`

The mapping is valid only when `lastAddress <= 255`. In a partial final byte
of a row, unused bits are ignored. Bytes are never added to the memory model.

The browser scales the raster to fit the available region, always preserving
**square pixels**. There is no emulation of historically non-square CRT pixels.

## Bit order and colors

Packed 1-, 2-, and 4-bit indices occupy each byte **most-significant bits
first**:

| RAM byte | 1-bit pixels | 2-bit pixels | 4-bit pixels |
| --- | --- | --- | --- |
| `0x1B` (`00011011`) | `0 0 0 1 1 0 1 1` | `0 1 2 3` | `1 11` |

For indexed modes, each pixel is a palette index rather than a direct RGB
value. Grayscale interprets one byte as brightness (0–255). RGB332 packs
3 red, 3 green and 2 blue bits into one byte. RGB888 uses three bytes per
pixel (red, green, blue).

Palettes are sourced from
[`specht/pixelram/tools/palettes.yaml`](https://github.com/specht/pixelram/blob/main/tools/palettes.yaml),
revision `951d93a0cd6dd254cd0e84faa2edefa935f9de50`.
Only palettes whose **full original color count** matches the indexed mode
are presented; palettes are never silently truncated or padded.

## Program suggestions

A program can suggest initial controller values with the sandbox-only
`.display` directive (no emitted bytes, no reserved RAM):

```asm
.display 0xC0, 32, 16, mono, 1bit_monitor_glow
.display 0x80, 16, 8, gray8
```

Syntax: `.display start, width, height, mode [, palette]` (one directive per
program). The palette argument is **required** for indexed modes and
**forbidden** for grayscale/RGB. Start/width/height accept constant
expressions. Invalid displays cause source-line assembly errors.

**Use suggested** restores the current program's suggestion, or defaults to
16×8 grayscale at `0x80` when a program has none. Students may override
all settings without changing the source file.

## Comparison table

| Configuration | Pixels | Bytes |
| --- | ---: | ---: |
| 32×16, 1-bit monochrome | 512 | 64 |
| 16×16, 2-bit indexed | 256 | 64 |
| 16×8, 4-bit indexed | 128 | 64 |
| 8×8, 8-bit indexed / gray / RGB332 | 64 | 64 |
| 4×5, 24-bit RGB888 | 20 | 60 |

These figures concern the **display region only**. Program instructions and
variables occupy the same 256-byte address space. Deliberately mapping
pixels over code can demonstrate self-modifying code; accidentally doing so
can break a program. The sandbox warns about overlaps but allows them.
