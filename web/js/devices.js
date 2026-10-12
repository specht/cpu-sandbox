// The devices at the I/O ports: what the program reads and writes, the keys
// that go to the joystick and keyboard while the screen has the focus, and
// the speaker's beeps.
import { DEVICES, PORT, JOYSTICK, KEY_POSITIONS, DEFAULT_NOTE_LENGTH, FRAMES_PER_SECOND, frameAt } from '/src/devices.js';
import { hex } from '/src/cpu.js';
import { el, icon, loadPreferences, savePreferences } from './util.js';

const JOYSTICK_KEYS = {
  ArrowLeft: JOYSTICK.LEFT, ArrowRight: JOYSTICK.RIGHT, ArrowUp: JOYSTICK.UP, ArrowDown: JOYSTICK.DOWN,
  a: JOYSTICK.LEFT, d: JOYSTICK.RIGHT, w: JOYSTICK.UP, s: JOYSTICK.DOWN, ' ': JOYSTICK.FIRE,
};
// [label, joystick bit, icon]
const BUTTONS = [['Left', JOYSTICK.LEFT, 'arrow-left'], ['Right', JOYSTICK.RIGHT, 'arrow-right'], ['Up', JOYSTICK.UP, 'arrow-up'], ['Down', JOYSTICK.DOWN, 'arrow-down'], ['Space', JOYSTICK.FIRE, null]];
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = n => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

export class DevicePanel {
  constructor(ui, devices, { cpu }) {
    this.ui = ui;
    this.devices = devices;
    this.cpu = cpu;
    this.shown = '';
    this.values = {};
    this.muted = !!loadPreferences().muted;
    this.audio = null;
    this.queue = [];       // notes written since the last render: { note, time, length }
    this.audioOffset = null;   // audio clock − machine time
    this.lastNote = null;
    this.noteTime = 0;
    this.noteHint = ui.note.textContent;
    this.keyLabels = new Map();   // key position → the character it showed
    devices.onOutput((port, value) => {
      if (port !== PORT.SPEAKER) return;
      this.lastNote = value;
      const length = (devices.outputs.get(PORT.NOTE_LENGTH) ?? DEFAULT_NOTE_LENGTH) / FRAMES_PER_SECOND;
      if (this.queue.length < 64) this.queue.push({ note: value, time: this.cpu()?.time ?? 0, length });
    });
    this.bindKeys();
  }

  // ------------------------------------------------------------ keyboard

  bindKeys() {
    const { canvas, note } = this.ui, devices = this.devices;
    canvas.addEventListener('focus', () => {
      canvas.parentElement.classList.add('captured');
      note.textContent = 'Keys go to the program · Esc gives them back';
    });
    canvas.addEventListener('blur', () => {
      canvas.parentElement.classList.remove('captured');
      note.textContent = this.noteHint;
      devices.joystick = 0;
      devices.held = [];
      devices.shift = false;
    });
    canvas.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') { canvas.blur(); return; }
      devices.shift = event.shiftKey;
      const position = KEY_POSITIONS[event.code];
      if (position) {
        // The keys-held device reports where the key is, whatever character it types.
        this.keyLabels.set(position, event.key.length === 1 ? event.key.toUpperCase() : event.code);
        devices.press(position);
        event.preventDefault();
      }
      const bit = JOYSTICK_KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (bit) devices.joystick |= bit;
      if (event.key.length === 1) devices.type(event.key);
      else if (event.key === 'Enter') devices.typed.push(13);
      else if (event.key === 'Backspace') devices.typed.push(8);
      if (bit || event.key.length === 1 || event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Tab') event.preventDefault();
    });
    canvas.addEventListener('keyup', event => {
      devices.shift = event.shiftKey;
      if (KEY_POSITIONS[event.code]) devices.release(KEY_POSITIONS[event.code]);
      const bit = JOYSTICK_KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (bit) devices.joystick &= ~bit;
    });
  }

  // ------------------------------------------------------------ sound

  /**
   * Plays a note at its machine time: notes keep their exact rhythm even
   * though the browser renders only 60 times per second. The audio clock
   * follows machine time with a small lead; after a pause or when the
   * browser falls behind, it is set again.
   */
  play({ note, time, length }) {
    if (this.muted || !note) return;
    try {
      this.audio ??= new AudioContext();
      const ctx = this.audio, now = ctx.currentTime;
      let at = this.audioOffset === null ? -1 : time + this.audioOffset;
      if (at < now || at > now + 0.25) { this.audioOffset = now + 0.05 - time; at = now + 0.05; }
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 440 * 2 ** ((note - 69) / 12);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.06, at + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0005, at + Math.max(0.03, length));
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + Math.max(0.03, length) + 0.01);
    } catch (_) {
      // No audio (unsupported or not allowed yet): the panel still shows the note.
    }
  }

  // ------------------------------------------------------------ panel

  build(ports) {
    // The number display has its own big readout above the screen.
    const number = ports.includes(PORT.NUMBER);
    this.ui.number.hidden = !number;
    this.ui.area.classList.toggle('with-number', number);
    const chips = ports.filter(port => port !== PORT.NUMBER).map(port => {
      const device = DEVICES.find(d => d.port === port);
      const head = el('span', { class: 'device-name' }, device.name, el('span', { class: 'device-port' }, hex(port)));
      const chip = el('span', { class: 'device', title: device.summary, dataset: { port } }, head);
      if (port === PORT.JOYSTICK) {
        this.buttons = BUTTONS.map(([label, bit, glyph]) => {
          const button = el('button', { type: 'button', class: `key-cap${glyph ? ' arrow' : ''}`, 'aria-pressed': 'false', 'aria-label': `Joystick ${label}`, title: label }, glyph ? icon(glyph) : label);
          const release = () => { this.devices.joystick &= ~bit; };
          button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); this.devices.joystick |= bit; });
          button.addEventListener('pointerup', release);
          button.addEventListener('pointercancel', release);
          return [button, bit];
        });
        chip.append(...this.buttons.map(([button]) => button));
      } else if (port === PORT.SPEAKER) {
        this.muteButton = el('button', { type: 'button', class: 'icon-button device-mute', onclick: () => this.toggleMute() });
        this.value(chip, 'speaker');
        chip.append(this.muteButton);
        this.renderMute();
      } else if (port === PORT.COLOR) {
        this.swatch = el('span', { class: 'device-swatch' });
        chip.append(this.swatch);
        this.value(chip, port);
      } else this.value(chip, port);
      return chip;
    });
    this.hint = el('span', { class: 'device-hint muted' }, ports.some(p => p <= PORT.KEYBOARD || p === PORT.KEYS) ? 'Click the screen for the keys' : '');
    this.ui.strip.replaceChildren(...chips, this.hint);
  }

  value(chip, key) {
    const node = el('span', { class: 'device-value' });
    this.values[key] = node;
    chip.append(node);
  }

  /** Three LED digits; unlit segments show as dim 8s. */
  renderNumber(value) {
    const text = value === undefined ? '' : String(value);
    if (text === this.numberText) return;
    const first = this.numberText === undefined;
    this.numberText = text;
    const node = this.ui.numberValue;
    node.replaceChildren(el('span', { class: 'ghost' }, '8'.repeat(3 - text.length)), text);
    node.setAttribute('aria-label', text || 'nothing yet');
    if (first || !text) return;
    this.ui.number.classList.add('changed');
    clearTimeout(this.flash);
    this.flash = setTimeout(() => this.ui.number.classList.remove('changed'), 120);
  }

  toggleMute() {
    this.muted = !this.muted;
    savePreferences({ muted: this.muted });
    this.renderMute();
  }

  renderMute() {
    this.muteButton.replaceChildren(icon(this.muted ? 'volume-off' : 'volume'));
    this.muteButton.title = this.muted ? 'Sound is off' : 'Sound is on';
    this.muteButton.setAttribute('aria-label', this.muteButton.title);
  }

  /** Updates the panel; plays the last note written since the previous call. */
  render(ports) {
    const key = ports.join(',');
    if (key !== this.shown) { this.shown = key; this.build(ports); }
    this.ui.strip.hidden = !ports.some(port => port !== PORT.NUMBER);
    if (this.queue.length) {
      for (const note of this.queue) this.play(note);
      this.queue = [];
      this.noteTime = performance.now();
    }
    if (!ports.length) return;
    this.hint.hidden = document.activeElement === this.ui.canvas;
    const d = this.devices, cpu = this.cpu();
    const set = (k, text) => { const node = this.values[k]; if (node && node.textContent !== text) node.textContent = text; };
    if (this.buttons) for (const [button, bit] of this.buttons) {
      const on = String(!!(d.joystick & bit));
      if (button.getAttribute('aria-pressed') !== on) button.setAttribute('aria-pressed', on);
    }
    set(PORT.KEYBOARD, d.typed.length ? d.typed.map(c => (c >= 32 && c < 127 ? String.fromCharCode(c) : `·`)).join('').slice(0, 8) : '—');
    set(PORT.TIMER, cpu ? String(frameAt(cpu.time) & 255) : '0');
    set(PORT.VSYNC, cpu ? `frame ${frameAt(cpu.time) & 255}` : '—');
    set(PORT.PALETTE, String(d.colorIndex));
    if (this.swatch) {
      // The color being written, or else the one just finished.
      const i = d.colorPart ? d.colorIndex : (d.colorIndex + 255) & 255, p = d.palette;
      const color = `#${hex((p[i * 3] << 16) | (p[i * 3 + 1] << 8) | p[i * 3 + 2], 6)}`;
      if (this.swatch.dataset.color !== `${i}${color}`) {
        this.swatch.dataset.color = `${i}${color}`;
        this.swatch.style.background = color;
        this.swatch.title = `Color ${i} = ${color}`;
      }
      set(PORT.COLOR, d.changedColors.size ? `${d.changedColors.size} set` : '—');
    }
    set(PORT.RANDOM, String(d.lastRandom));
    const position = d.held.at(-1);
    set(PORT.KEYS, position ? `${d.shift ? '⇧' : ''}${this.keyLabels.get(position) ?? ''} ${hex(position | (d.shift ? 0x80 : 0))}` : '—');
    const note = d.outputs.get(PORT.SPEAKER);
    set('speaker', note ? `♪ ${noteName(note)}` : '—');
    this.values.speaker?.classList.toggle('sounding', performance.now() - this.noteTime < 120);
    this.renderNumber(d.outputs.get(PORT.NUMBER));
    const page = d.outputs.get(PORT.SCREEN);
    set(PORT.SCREEN, page === undefined ? '—' : `0x${hex(page * 256, 4)}`);
  }
}
