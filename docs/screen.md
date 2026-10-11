# The screen: RAM as pixels

The CPU has no graphics hardware. The screen is only a way of *looking at*
RAM: it reads a block of bytes and draws them as pixels. Changing the screen
settings, even while a program runs, never changes a byte of RAM.

## Settings

The bar above the screen holds:

- **Pixel format**: 1, 2 or 4 bits per pixel from a palette; 8 bits from a
  palette, as gray levels or as RGB 3-3-2; or 24-bit RGB (three bytes per pixel).
- **Palette** (palette formats only): only palettes with exactly 2^bits colors
  are offered, so 4-bit pixels get the 16-color palettes.
- **Start address, width and height.**

On the screen itself:

- **Drag the picture up or down** to move the window through RAM by whole
  rows. The mouse wheel does the same.
- **Drag the corner grip** to change width and height.
- **Click a pixel** to select its byte in the RAM view.
- **Hover** to see the coordinates, the address and the value of a pixel.

The reset button goes back to the program's `.display` line.

## Layout

Every row starts on a new byte:

`row bytes = ⌈width × bits per pixel / 8⌉`, `screen bytes = height × row bytes`.

Packed pixels are read **most-significant bits first**:

| RAM byte | 1-bit pixels | 2-bit pixels | 4-bit pixels |
| --- | --- | --- | --- |
| `0x1B` (`00011011`) | `0 0 0 1 1 0 1 1` | `0 1 2 3` | `1 11` |

So pixel (x, y) of a 16-pixel-wide 8-bit screen at `0x80` lives at
`0x80 + 16·y + x`, and on a 1-bit screen 64 pixels wide at
`screen + 8·y + x/8`, bit `7 − x mod 8`.

## `.display`

A program suggests its screen with one `.display` line. It produces no bytes:

```asm
.display 0x80, 16, 8, gray8
.display screen, 80, 60, indexed4, twilight_16
```

Syntax: `.display start, width, height, format [, palette]`, with the formats
`mono`, `indexed2`, `indexed4`, `indexed8` (these need a palette), `gray8`,
`rgb332` and `rgb24`. Without the line, the screen shows 16 × 8 gray pixels at
`0x80`. A screen that covers the program's own bytes is allowed — the
assembler warns, and the fire demo invites you to drag its screen over its code.

## Palettes

| Colors | Palettes |
| --- | --- |
| 2 | `1bit_monitor_glow` |
| 4 | `cga_palette_1_high` |
| 16 | `color_graphics_adapter`, `pico_8`, `sweetie_16`, `twilight_16` |
| 256 | `vga`, `fire_256` |

Most palettes come from
[PixelRAM](https://github.com/specht/pixelram/blob/main/tools/palettes.yaml)
with their original color order. `twilight_16` (black, then blue over white to
red) and `fire_256` (black → red → yellow → white) were made for the
Mandelbrot and fire demos.

## How many pixels fit?

| Screen | Pixels | Bytes |
| --- | ---: | ---: |
| 32 × 16, 1 bit | 512 | 64 |
| 16 × 16, 2 bits | 256 | 64 |
| 16 × 8, 4 bits | 128 | 64 |
| 8 × 8, 8 bits | 64 | 64 |
| 80 × 60, 4 bits (8X only) | 4800 | 2400 |
