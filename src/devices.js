/**
 * Devices plugged into the CPU's I/O ports. IN reads a byte from a port,
 * OUT writes one. Ports are separate from RAM: they cost no memory.
 */
export const DEVICES = Object.freeze([
  Object.freeze({ port: 0x00, name: 'Joystick', direction: 'in', summary: 'Keys held right now: bit 0 ←, 1 →, 2 ↑, 3 ↓, 4 Space.' }),
  Object.freeze({ port: 0x01, name: 'Keyboard', direction: 'in', summary: 'The next typed character (ASCII), or 0 if nothing was typed.' }),
  Object.freeze({ port: 0x02, name: 'Timer', direction: 'in', summary: 'Counts 60 times per second of machine time, 0–255, then starts over.' }),
  Object.freeze({ port: 0x03, name: 'Random', direction: 'in', summary: 'A new random number 0–255 on every read.' }),
  Object.freeze({ port: 0x10, name: 'Speaker', direction: 'out', summary: 'Plays a short beep; the value is the pitch as a MIDI note (60 = middle C).' }),
  Object.freeze({ port: 0x11, name: 'Number display', direction: 'out', summary: 'Shows the value as a decimal number.' }),
]);
export const PORT = Object.freeze({ JOYSTICK: 0x00, KEYBOARD: 0x01, TIMER: 0x02, RANDOM: 0x03, SPEAKER: 0x10, NUMBER: 0x11 });
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
  }

  /** A fresh start: forget typed keys and output values (held keys stay held). */
  reset() {
    this.typed = [];
    this.outputs.clear();
  }

  /** Called with (port, value) after every OUT. */
  onOutput(listener) { this.listeners.add(listener); }

  type(text) { for (const ch of text) this.typed.push(ch.codePointAt(0) & 0xFF); }

  /** Value of an input port, or undefined if nothing is plugged in there. */
  read(port, cpu) {
    switch (port) {
      case PORT.JOYSTICK: return this.joystick;
      case PORT.KEYBOARD: return this.typed.length ? this.typed.shift() : 0;
      case PORT.TIMER: return Math.floor(cpu.time * 60) & 0xFF;
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
    if (port !== PORT.SPEAKER && port !== PORT.NUMBER) return false;
    this.outputs.set(port, value);
    for (const listener of this.listeners) listener(port, value);
    return true;
  }

  /** Undo support: puts back the value an output port showed before. */
  restore(port, value) {
    if (value === undefined) this.outputs.delete(port); else this.outputs.set(port, value);
  }
}
