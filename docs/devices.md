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
| `0x10` | Speaker | `OUT` | plays a short beep; the value is a MIDI note number (60 = middle C, 69 = 440 Hz) |
| `0x11` | Number display | `OUT` | shows the value as a decimal number |

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
  between two reads is never seen — try it with `19-breakout.asm`.
- The keyboard keeps typed characters in a queue until they are read.
- The timer counts **machine time** (cycles ÷ clock). A game that waits for
  the next timer tick runs at the same speed at any clock — as long as the CPU
  can do its work between two ticks. Below that, the game slows down.

Stepping back undoes an `OUT` on the number display, but it does not un-press
keys or un-type characters: input comes from outside the machine.
