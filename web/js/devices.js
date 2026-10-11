// The devices at the I/O ports: what the program reads and writes, the keys
// that go to the joystick and keyboard while the screen has the focus, and
// the speaker's beeps.
import { DEVICES, PORT, JOYSTICK } from '/src/devices.js';
import { hex } from '/src/cpu.js';
import { el, icon, loadPreferences, savePreferences } from './util.js';

const JOYSTICK_KEYS = {
  ArrowLeft: JOYSTICK.LEFT, ArrowRight: JOYSTICK.RIGHT, ArrowUp: JOYSTICK.UP, ArrowDown: JOYSTICK.DOWN,
  a: JOYSTICK.LEFT, d: JOYSTICK.RIGHT, w: JOYSTICK.UP, s: JOYSTICK.DOWN, ' ': JOYSTICK.FIRE,
};
const BUTTONS = [['←', JOYSTICK.LEFT], ['→', JOYSTICK.RIGHT], ['↑', JOYSTICK.UP], ['↓', JOYSTICK.DOWN], ['Space', JOYSTICK.FIRE]];
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
    this.pendingNote = null;
    this.lastNote = null;
    this.noteTime = 0;
    this.noteHint = ui.note.textContent;
    devices.onOutput((port, value) => { if (port === PORT.SPEAKER) { this.pendingNote = value; this.lastNote = value; } });
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
    });
    canvas.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') { canvas.blur(); return; }
      const bit = JOYSTICK_KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (bit) devices.joystick |= bit;
      if (event.key.length === 1) devices.type(event.key);
      else if (event.key === 'Enter') devices.typed.push(13);
      else if (event.key === 'Backspace') devices.typed.push(8);
      if (bit || event.key.length === 1 || event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Tab') event.preventDefault();
    });
    canvas.addEventListener('keyup', event => {
      const bit = JOYSTICK_KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (bit) devices.joystick &= ~bit;
    });
  }

  // ------------------------------------------------------------ sound

  play(note) {
    if (this.muted || !note) return;
    try {
      this.audio ??= new AudioContext();
      const ctx = this.audio, now = ctx.currentTime;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 440 * 2 ** ((note - 69) / 12);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.09);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } catch (_) {
      // No audio (unsupported or not allowed yet): the panel still shows the note.
    }
  }

  // ------------------------------------------------------------ panel

  build(ports) {
    const chips = ports.map(port => {
      const device = DEVICES.find(d => d.port === port);
      const head = el('span', { class: 'device-name' }, device.name, el('span', { class: 'device-port' }, hex(port)));
      const chip = el('span', { class: 'device', title: device.summary, dataset: { port } }, head);
      if (port === PORT.JOYSTICK) {
        this.buttons = BUTTONS.map(([label, bit]) => {
          const button = el('button', { type: 'button', class: 'key-cap', 'aria-pressed': 'false', 'aria-label': `Joystick ${label}` }, label);
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
      } else this.value(chip, port);
      return chip;
    });
    this.hint = el('span', { class: 'device-hint muted' }, ports.some(p => p <= PORT.KEYBOARD) ? 'Click the screen for the keys' : '');
    this.ui.strip.replaceChildren(...chips, this.hint);
  }

  value(chip, key) {
    const node = el('span', { class: 'device-value' });
    this.values[key] = node;
    chip.append(node);
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
    this.ui.strip.hidden = !ports.length;
    if (this.pendingNote !== null) {
      this.play(this.pendingNote);
      this.noteTime = performance.now();
      this.pendingNote = null;
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
    set(PORT.TIMER, cpu ? String(Math.floor(cpu.time * 60) & 255) : '0');
    set(PORT.RANDOM, String(d.lastRandom));
    const note = d.outputs.get(PORT.SPEAKER);
    set('speaker', note ? `♪ ${noteName(note)}` : '—');
    this.values.speaker?.classList.toggle('sounding', performance.now() - this.noteTime < 120);
    const number = d.outputs.get(PORT.NUMBER);
    set(PORT.NUMBER, number === undefined ? '—' : String(number));
    const page = d.outputs.get(PORT.SCREEN);
    set(PORT.SCREEN, page === undefined ? '—' : `0x${hex(page * 256, 4)}`);
  }
}
