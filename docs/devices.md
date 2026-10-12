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
| `0x10` | Speaker | `OUT` | plays a short beep; the value is a MIDI note number (60 = middle C, 69 = 440 Hz) |
| `0x11` | Number display | `OUT` | shows the value as a decimal number |
| `0x12` | Screen page | `OUT` | moves the screen to address value × 256 (page flipping) |
| `0x13` | Palette index | `OUT` | chooses the palette color that port `0x14` changes next |
| `0x14` | Palette color | `OUT` | red, green, blue of that color; then the next color |

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
