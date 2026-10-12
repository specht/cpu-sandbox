# Devices and I/O ports

Devices are plugged into numbered **ports**, separate from RAM: they cost no
memory, on every CPU level. `IN` reads a byte from a port, `OUT` writes one.

```asm
        IN A, 0x02          ; A = timer
        OUT 0x11, A         ; show A on the number display
```

Both instructions are 3 bytes long and take 4 cycles (3 bytes fetched plus
one access to the device).

| Port | Device | | The byte |
| --- | --- | --- | --- |
| `0x00` | Joystick | `IN` | keys held right now: bit 0 ←, 1 →, 2 ↑, 3 ↓, 4 Space |
| `0x01` | Keyboard | `IN` | the next typed character (ASCII), or 0 if nothing was typed |
| `0x02` | Timer | `IN` | counts 60 times per second of machine time, 0–255, then starts over |
| `0x03` | Random | `IN` | a new random number on every read |
| `0x04` | Vsync | `IN` | waits until the screen takes its next picture, then returns the timer value |
| `0x05` | Keys held | `IN` | where the last key pressed and still held sits: row × 16 + column, +128 with Shift; 0 if none |
| `0x10` | Speaker | `OUT` | plays a note; the value is a MIDI note number (60 = middle C, 69 = 440 Hz) |
| `0x11` | Number display | `OUT` | shows the value as a decimal number |
| `0x12` | Screen page | `OUT` | moves the screen to address value × 256 (page flipping) |
| `0x13` | Palette index | `OUT` | chooses the palette color that port `0x14` changes next |
| `0x14` | Palette color | `OUT` | red, green, blue of that color; then the next color |
| `0x15` | Note length | `OUT` | how long the following notes sound, in 1/60 s (default 6) |

Reading a port nobody is plugged into, or writing to an input device, is an
assembly error.

## In the browser

When a program uses a port, its device appears in the bar above the screen
with its current value. **Click the screen** to send keys to the program: the
arrow keys (or W A S D) and Space go to the joystick, and every typed
character also goes to the keyboard. Esc gives the keys back. When a program
reads the joystick or the keyboard, **Run** gives the screen the keys
automatically. The joystick buttons in the bar can be clicked as well, and the
speaker has a mute button.

The number display has a big readout of its own at the top right of the
screen.

## Keys held: the keyboard as an instrument

The keyboard device delivers *characters*. The keys-held device reports
*places*: where the last key that is still held down sits on the keyboard,
whatever layout the computer uses. Q is in the same place on a German and an
English keyboard, Y and Z are not, but both give `0x40`.

| Row | Keys (German layout) | Codes |
| --- | --- | --- |
| 1 | `1 2 3 4 5 6 7 8 9 0 ß ´` | `0x10`–`0x1B` |
| 2 | `Q W E R T Z U I O P Ü +` | `0x20`–`0x2B` |
| 3 | `A S D F G H J K L Ö Ä #` | `0x30`–`0x3B` |
| 4 | `Y X C V B N M , . -` | `0x40`–`0x49` |

Shift adds `0x80`; with no key held the device gives 0. In C the port is
`KEYS` and the Shift bit `KEY_SHIFT`. `28-arpeggio-organ.c` turns the three
letter rows into three octaves of chords.

## Sound

`OUT 0x10, A` plays note A (a MIDI note number) for the length set at port
`0x15` (in frames, 1/60 s; 6 if never set). The note starts at the machine
time of the `OUT`, not when the browser happens to draw the next picture, so
a melody keeps its rhythm exactly — as exactly as the program's timing.

## Polling and time

The CPU has no interrupts: a program **polls** its devices, reading them
again and again in a loop.

- The joystick reports the keys that are held *right now*. A key tapped
  between two reads is never seen — try it with `20-breakout.asm`.
- The keyboard keeps typed characters in a queue until they are read.
- The timer counts **machine time** (cycles ÷ clock). A game that waits for
  the next timer tick runs at the same speed at any clock — as long as the CPU
  can do its work between two ticks. Below that, the game slows down.
- **Vsync** waits for the next frame without a loop: `IN A, 0x04` lets the
  CPU idle until the screen takes its next picture. That is the simplest way
  to pace a game (`23-snake.c`, `26-stars.c`), and at a high clock it saves
  the browser millions of wasted instructions per second. The vsync, screen
  page and palette ports are explained in [The screen](screen.md).

## Page flipping

Drawing a moving picture directly on the visible screen shows half-finished
frames: the old picture is partly erased, the new one partly drawn. The
**screen page** device moves the screen to another part of RAM, like the start
register of a real video chip. A program keeps two pictures (pages), draws
into the hidden one and then shows it with a single `OUT`:

```asm
        LDI A, 0x0C
        OUT 0x12, A         ; the screen now starts at 0x0C00
```

The screen settings above the canvas follow the device. `22-cube.c` waits for
vsync before it flips, so every picture shows one finished cube.
On MiniCPU 8 and 8S RAM is a single page, so the device is useful on 8X.

Stepping back undoes an `OUT` (number display, screen page, palette) and the
wait of a vsync, but it does not un-press
keys or un-type characters: input comes from outside the machine.
