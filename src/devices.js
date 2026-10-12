/**
 * Devices plugged into the CPU's I/O ports. IN reads a byte from a port,
 * OUT writes one. Ports are separate from RAM: they cost no memory.
 */
import { paletteBytes } from './palettes.js';

export const DEVICES = Object.freeze([
  Object.freeze({ port: 0x00, name: 'Joystick', direction: 'in', summary: 'Keys held right now: bit 0 ←, 1 →, 2 ↑, 3 ↓, 4 Space.' }),
  Object.freeze({ port: 0x01, name: 'Keyboard', direction: 'in', summary: 'The next typed character (ASCII), or 0 if nothing was typed.' }),
  Object.freeze({ port: 0x02, name: 'Timer', direction: 'in', summary: 'Counts 60 times per second of machine time, 0–255, then starts over.' }),
  Object.freeze({ port: 0x03, name: 'Random', direction: 'in', summary: 'A new random number 0–255 on every read.' }),
  Object.freeze({ port: 0x04, name: 'Vsync', direction: 'in', summary: 'Waits until the screen takes its next picture (60 times per second), then returns the timer value. Changes made right after it appear together in the next picture.' }),
  Object.freeze({ port: 0x10, name: 'Speaker', direction: 'out', summary: 'Plays a short beep; the value is the pitch as a MIDI note (60 = middle C).' }),
  Object.freeze({ port: 0x11, name: 'Number display', direction: 'out', summary: 'Shows the value as a decimal number.' }),
  Object.freeze({ port: 0x12, name: 'Screen page', direction: 'out', summary: 'Moves the screen to address value × 256. Draw the next picture into a hidden page, then show it at once (page flipping).' }),
  Object.freeze({ port: 0x13, name: 'Palette index', direction: 'out', summary: 'Chooses the palette color that port 0x14 changes next (0–255).' }),
  Object.freeze({ port: 0x14, name: 'Palette color', direction: 'out', summary: 'Red, then green, then blue (0–255 each) of the chosen color; after blue, the next color is chosen.' }),
]);
export const PORT = Object.freeze({ JOYSTICK: 0x00, KEYBOARD: 0x01, TIMER: 0x02, RANDOM: 0x03, VSYNC: 0x04, SPEAKER: 0x10, NUMBER: 0x11, SCREEN: 0x12, PALETTE: 0x13, COLOR: 0x14 });
export const FRAMES_PER_SECOND = 60;
/** The number of the frame (screen picture) at a machine time; tolerant of rounding at the boundaries. */
export const frameAt = time => Math.floor(time * FRAMES_PER_SECOND + 1e-6);
export const JOYSTICK = Object.freeze({ LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, FIRE: 16 });
export const deviceAt = port => DEVICES.find(d => d.port === port) ?? null;

export class Devices {
  constructor({ seed = 1 } = {}) {
    this.joystick = 0;
    this.typed = [];
    this.random = seed & 0xFFFF || 1;
    this.lastRandom = 0;
    this.outputs = new Map(); // port -> last value written
    this.listeners = new Set();
    // The palette chip: red, green, blue of 256 colors. Indexed screen formats
    // look up their colors here; it starts with a predefined palette.
    this.palette = new Uint8Array(768);
    this.paletteName = null;
    this.colorIndex = 0;   // the color port 0x14 writes to
    this.colorPart = 0;    // 0 red, 1 green, 2 blue
    this.changedColors = new Set();   // colors the program has set
  }

  /** A fresh start: forget typed keys and output values (held keys stay held); load the palette chip. */
  reset(paletteName = this.paletteName) {
    this.typed = [];
    this.outputs.clear();
    this.loadPalette(paletteName);
  }

  /** Fills the palette chip with a predefined palette (the other colors become black). */
  loadPalette(name) {
    this.paletteName = name ?? null;
    this.palette.fill(0);
    if (name) this.palette.set(paletteBytes(name));
    this.colorIndex = 0;
    this.colorPart = 0;
    this.changedColors.clear();
  }

  /** Called with (port, value) after every OUT. */
  onOutput(listener) { this.listeners.add(listener); }

  type(text) { for (const ch of text) this.typed.push(ch.codePointAt(0) & 0xFF); }

  /** Value of an input port, or undefined if nothing is plugged in there. */
  read(port, cpu) {
    switch (port) {
      case PORT.JOYSTICK: return this.joystick;
      case PORT.KEYBOARD: return this.typed.length ? this.typed.shift() : 0;
      case PORT.TIMER: return frameAt(cpu.time) & 0xFF;
      case PORT.VSYNC: return (frameAt(cpu.time) + 1) & 0xFF;   // the CPU waits for that frame
      case PORT.RANDOM: {
        // 16-bit xorshift: deterministic for tests, random enough for games.
        let x = this.random;
        x ^= (x << 7) & 0xFFFF; x ^= x >> 9; x ^= (x << 8) & 0xFFFF;
        this.random = x || 1;
        this.lastRandom = x & 0xFF;
        return this.lastRandom;
      }
      default: return undefined;
    }
  }

  /** Returns false if nothing is plugged into the port. */
  write(port, value) {
    if (port === PORT.PALETTE) {
      this.colorIndex = value;
      this.colorPart = 0;
    } else if (port === PORT.COLOR) {
      this.palette[this.colorIndex * 3 + this.colorPart] = value;
      this.changedColors.add(this.colorIndex);
      if (++this.colorPart === 3) { this.colorPart = 0; this.colorIndex = (this.colorIndex + 1) & 0xFF; }
    } else if (port !== PORT.SPEAKER && port !== PORT.NUMBER && port !== PORT.SCREEN) return false;
    this.outputs.set(port, value);
    for (const listener of this.listeners) listener(port, value);
    return true;
  }

  /**
   * Undo support: everything an OUT to this port is about to change, as one
   * number (-1 for nothing). restore() puts it back.
   */
  snapshot(port) {
    const out = this.outputs.has(port) ? this.outputs.get(port) : 0x1FF; // 9 bits: the last value or none
    if (port === PORT.PALETTE || port === PORT.COLOR) {
      const position = this.colorIndex * 3 + this.colorPart;          // 0..767, 10 bits
      const changed = this.changedColors.has(this.colorIndex) ? 1 : 0;
      return ((position * 256 + this.palette[position]) * 2 + changed) * 512 + out;
    }
    return out === 0x1FF ? -1 : out;
  }

  restore(port, saved) {
    if (port === PORT.PALETTE || port === PORT.COLOR) {
      const out = saved % 512;
      let rest = Math.floor(saved / 512);
      const changed = rest % 2; rest = Math.floor(rest / 2);
      const byte = rest % 256, position = Math.floor(rest / 256);
      this.colorIndex = Math.floor(position / 3);
      this.colorPart = position % 3;
      if (port === PORT.COLOR) {
        this.palette[position] = byte;
        if (!changed) this.changedColors.delete(this.colorIndex);
      }
      if (out === 0x1FF) this.outputs.delete(port); else this.outputs.set(port, out);
      return;
    }
    if (saved === undefined || saved < 0) this.outputs.delete(port); else this.outputs.set(port, saved);
  }
}
