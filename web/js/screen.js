// The screen: a canvas that shows a window of RAM as pixels. Dragging the
// picture moves the window through RAM, the corner grip resizes it, and the
// bar above chooses how bytes become colors. None of this changes RAM.
// Indexed formats take their colors from the palette chip (devices.palette).
// While the program runs, the app captures a picture at the start of every
// frame and presents the latest one, like a monitor fed by a video chip.
import { MODES, MAX_SIDE, validateDisplay, decodeScreen, pixelAddress, pixelValue } from '/src/display.js';
import { PALETTES } from '/src/palettes.js';
import { hex } from '/src/cpu.js';
import { grouped } from './util.js';

const paletteName = key => key.replaceAll('_', ' ');

export class Screen {
  constructor(ui, { onChange, onPick }) {
    this.ui = ui;
    this.onChange = onChange;
    this.onPick = onPick;
    this.memorySize = 256;
    this.config = null;
    this.memory = new Uint8Array(256);
    this.palette = new Uint8Array(768);
    this.captured = false;
    this.error = null;
    this.cell = 1;
    this.frozenCell = null;
    this.hover = null;
    this.context = ui.canvas.getContext('2d');
    this.image = null;

    for (const [mode, spec] of Object.entries(MODES)) ui.format.add(new Option(spec.label, mode));
    ui.format.addEventListener('change', () => {
      const mode = ui.format.value, bits = MODES[mode].bits;
      const palette = MODES[mode].indexed ? (PALETTES[this.config.palette]?.length === 2 ** bits ? this.config.palette : this.palettesFor(mode)[0]) : null;
      this.change({ mode, palette });
    });
    ui.palette.addEventListener('change', () => this.change({ palette: ui.palette.value }));
    ui.start.addEventListener('change', () => {
      const text = ui.start.value.trim(), value = /^0x/i.test(text) ? parseInt(text.slice(2), 16) : /^[0-9a-f]+$/i.test(text) ? parseInt(text, 16) : NaN;
      if (Number.isInteger(value)) this.change({ start: value }); else this.syncFields();
    });
    for (const key of ['width', 'height']) {
      ui[key].addEventListener('change', () => {
        const value = Number(ui[key].value);
        if (Number.isInteger(value) && value >= 1 && value <= MAX_SIDE) this.change({ [key]: value }); else this.syncFields();
      });
    }
    this.bindPointer();
    new ResizeObserver(() => this.fit()).observe(ui.area);
  }

  palettesFor(mode) {
    return Object.keys(PALETTES).filter(key => PALETTES[key].length === 2 ** MODES[mode].bits);
  }

  setMemorySize(size) { this.memorySize = size; }

  /** Sets the mapping without reporting it as a user change. */
  set(config, { draw = true } = {}) {
    this.config = { ...config };
    this.syncFields();
    if (draw) this.draw();
  }

  /** A user change: keeps the screen inside RAM where possible. */
  change(patch) {
    const next = this.clamp({ ...this.config, ...patch });
    if (JSON.stringify(next) === JSON.stringify(this.config)) { this.syncFields(); return; }
    this.config = next;
    this.syncFields();
    this.draw();
    this.onChange(this.config);
  }

  clamp(config) {
    const bits = MODES[config.mode].bits, rowBytes = Math.ceil(config.width * bits / 8);
    const c = { ...config };
    c.width = Math.max(1, Math.min(MAX_SIDE, c.width));
    c.height = Math.max(1, Math.min(MAX_SIDE, c.height, Math.floor(this.memorySize / rowBytes) || 1));
    const span = c.height * rowBytes;
    c.start = Math.max(0, Math.min(c.start, this.memorySize - span));
    return c;
  }

  syncFields() {
    const { ui, config } = this;
    if (!config) return;
    const digits = this.memorySize > 256 ? 4 : 2;
    ui.format.value = config.mode;
    const palettes = MODES[config.mode].indexed ? this.palettesFor(config.mode) : [];
    ui.palette.replaceChildren(...palettes.map(key => new Option(paletteName(key), key)));
    ui.palette.hidden = !palettes.length;
    if (palettes.length) ui.palette.value = config.palette;
    if (document.activeElement !== ui.start) ui.start.value = `0x${hex(config.start, digits)}`;
    if (document.activeElement !== ui.width) ui.width.value = config.width;
    if (document.activeElement !== ui.height) ui.height.value = config.height;
  }

  // ------------------------------------------------------------ drawing

  /** Draws RAM now (while paused, or after a change of the mapping). */
  render(memory, palette) {
    this.capture(memory, palette);
    this.present();
  }

  draw() { this.render(this.memory, this.palette); }

  /** Takes a picture of RAM and the palette chip, shown by the next present(). */
  capture(memory, palette = this.palette) {
    this.memory = memory;
    this.palette = palette;
    if (!this.prepare()) return;
    decodeScreen(memory.length >= this.memorySize ? memory : new Uint8Array(this.memorySize), this.config, palette, this.image.data);
    this.captured = true;
  }

  /** Shows the last picture taken. */
  present() {
    if (!this.valid) return;
    if (this.captured) { this.context.putImageData(this.image, 0, 0); this.captured = false; }
    this.showInfo();
  }

  /** Checks the mapping and sizes the canvas; false (with a message) if the mapping is invalid. */
  prepare() {
    if (!this.config) return false;
    const { canvas } = this.ui;
    try {
      this.valid = validateDisplay(this.config, this.memorySize);
      this.error = null;
    } catch (error) {
      this.valid = null;
      this.error = error.message;
      this.ui.info.textContent = error.message;
      this.context.clearRect(0, 0, canvas.width, canvas.height);
      return false;
    }
    const { width, height } = this.config;
    if (canvas.width !== width || canvas.height !== height || !this.image) {
      canvas.width = width; canvas.height = height;
      this.image = this.context.createImageData(width, height);
      this.fit();
    }
    return true;
  }

  fit() {
    if (!this.config) return;
    const area = this.ui.area, style = getComputedStyle(area);
    const availableWidth = area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const availableHeight = area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (availableWidth <= 0 || availableHeight <= 0) return;
    let cell = this.frozenCell ?? Math.min(availableWidth / this.config.width, availableHeight / this.config.height);
    if (!this.frozenCell && cell >= 2) cell = Math.floor(cell); // whole screen pixels stay crisp
    this.cell = cell;
    this.ui.canvas.style.width = `${cell * this.config.width}px`;
    this.ui.canvas.style.height = `${cell * this.config.height}px`;
  }

  showInfo() {
    const c = this.valid, digits = this.memorySize > 256 ? 4 : 2;
    if (this.hover) {
      const { x, y } = this.hover;
      const addr = pixelAddress(c, x, y), value = pixelValue(this.memory, c, x, y);
      let shown = c.bits === 24 ? `#${hex(value, 6)}` : c.bits === 8 ? `${value} (0x${hex(value)})` : `${value}`;
      if (MODES[c.mode].indexed) shown += ` = #${hex((this.palette[value * 3] << 16) | (this.palette[value * 3 + 1] << 8) | this.palette[value * 3 + 2], 6)}`;
      this.ui.info.textContent = `(${x}, ${y}) · byte 0x${hex(addr, digits)} · value ${shown}`;
    } else {
      this.ui.info.textContent = `${c.width} × ${c.height} · ${grouped(c.bytesSpanned)} bytes · 0x${hex(c.start, digits)}–0x${hex(c.endExclusive - 1, digits)}`;
    }
  }

  // ------------------------------------------------------------ pointer

  pixelAt(event) {
    const rect = this.ui.canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / rect.width * this.config.width);
    const y = Math.floor((event.clientY - rect.top) / rect.height * this.config.height);
    return x >= 0 && y >= 0 && x < this.config.width && y < this.config.height ? { x, y } : null;
  }

  bindPointer() {
    const { canvas, grip, area } = this.ui;
    let drag = null;
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !this.valid) return;
      canvas.setPointerCapture(event.pointerId);
      drag = { kind: 'move', x: event.clientX, y: event.clientY, start: this.config.start, moved: false, pixel: this.pixelAt(event) };
      canvas.classList.add('dragging');
    });
    grip.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !this.valid) return;
      event.stopPropagation();
      grip.setPointerCapture(event.pointerId);
      this.frozenCell = this.cell;
      drag = { kind: 'resize', x: event.clientX, y: event.clientY, width: this.config.width, height: this.config.height };
    });
    const move = event => {
      if (!drag) {
        if (event.target === canvas && this.valid) { this.hover = this.pixelAt(event); this.showInfo(); }
        return;
      }
      const dx = (event.clientX - drag.x) / this.cell, dy = (event.clientY - drag.y) / this.cell;
      if (drag.kind === 'move') {
        if (Math.abs(dx) + Math.abs(dy) > 0.6) drag.moved = true;
        if (!drag.moved) return;
        // Only up and down, by whole rows: sideways the picture would shear.
        const rowBytes = Math.ceil(this.config.width * MODES[this.config.mode].bits / 8);
        this.change({ start: drag.start - Math.round(dy) * rowBytes });
      } else {
        this.change({ width: Math.round(drag.width + dx), height: Math.round(drag.height + dy) });
      }
    };
    const end = event => {
      if (!drag) return;
      if (drag.kind === 'move' && !drag.moved && drag.pixel) this.onPick(pixelAddress(this.config, drag.pixel.x, drag.pixel.y));
      if (drag.kind === 'resize') { this.frozenCell = null; this.fit(); }
      canvas.classList.remove('dragging');
      drag = null;
      if (event.type === 'pointerup' && event.target === canvas) { this.hover = this.pixelAt(event); this.showInfo(); }
    };
    canvas.addEventListener('pointermove', move);
    grip.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    grip.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    grip.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { if (!drag) { this.hover = null; if (this.valid) this.showInfo(); } });
    let wheel = 0;
    area.addEventListener('wheel', event => {
      if (!this.valid) return;
      event.preventDefault();
      wheel += event.deltaY;
      const rows = Math.trunc(wheel / 40);
      if (!rows) return;
      wheel -= rows * 40;
      const rowBytes = Math.ceil(this.config.width * MODES[this.config.mode].bits / 8);
      this.change({ start: this.config.start + rows * rowBytes });
    }, { passive: false });
  }
}
