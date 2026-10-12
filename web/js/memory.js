// The RAM view. At 16 bytes per row every byte is a hex cell; zoomed out to
// 64 or 256 bytes per row every byte is one colored dot, so all of a 64 KiB
// RAM fits at once: the color says what the byte is (code, data, screen,
// stack), its brightness the value, and a glow shows where the program has
// just been writing. Hovering a byte explains it; clicking a dot zooms in there.
import { hex } from '/src/cpu.js';
import { REGION } from '/src/memorymap.js';
import { el } from './util.js';

const ZOOMS = [16, 64, 256];

// [color of 0, color of 255] for every kind of byte in the map view.
const RAMPS = {
  free: ['#0d1522', '#b9c6d8'],
  code: ['#2a1c05', '#ffc65c'],
  data: ['#071a33', '#6fb6ff'],
  screen: ['#06200f', '#79f0a2'],
  stack: ['#1f0f33', '#d29bff'],
};
const KINDS = Object.keys(RAMPS);

function rgb(text) { const n = parseInt(text.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
/** 256 colors from dark to bright as ABGR words for ImageData. */
function ramp([from, to]) {
  const a = rgb(from), b = rgb(to), out = new Uint32Array(256);
  for (let v = 0; v < 256; v++) {
    const t = v === 0 ? 0 : 0.28 + 0.72 * (v / 255);
    const c = a.map((x, i) => Math.round(x + (b[i] - x) * t));
    out[v] = 0xFF000000 | (c[2] << 16) | (c[1] << 8) | c[0];
  }
  return out;
}

export class MemoryView {
  constructor(ui, { onSelect, onHover = () => {} }) {
    this.ui = ui;
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.size = 256;
    this.step = 256;
    this.digits = 2;
    this.zoom = 16;
    this.selected = null;
    this.first = 0;      // first visible row (hex view)
    this.cell = 20;      // cell size in px (hex view)
    this.rows = [];      // [{label, cells}]
    this.state = null;
    this.ramps = KINDS.map(kind => ramp(RAMPS[kind]));

    const head = el('div', { class: 'mem-head-row' }, el('span', { class: 'mem-corner' }),
      ...Array.from({ length: 16 }, (_, i) => el('span', { class: 'mem-head' }, hex(i, 1))));
    this.window = el('div', { class: 'mem-window' });
    this.spacer = el('div', { class: 'mem-spacer' });
    this.scroller = el('div', { class: 'mem-scroll' }, this.spacer, this.window);
    this.hexView = el('div', { class: 'mem-hex' }, head, this.scroller);

    this.canvas = el('canvas', { class: 'mem-canvas' });
    this.gutter = el('div', { class: 'mem-gutter' });
    this.mapView = el('div', { class: 'mem-map', hidden: true }, el('div', { class: 'mem-map-inner' }, this.gutter, this.canvas));
    ui.grid.replaceChildren(this.hexView, this.mapView);

    this.scroller.addEventListener('scroll', () => {
      const first = Math.floor(this.scroller.scrollTop / this.cell);
      if (first === this.first) return;
      this.first = first;
      this.syncPage();
      this.invalidate();
      if (this.state) this.render(this.state);
    });
    this.mapView.addEventListener('scroll', () => this.syncPage());
    ui.page.addEventListener('change', () => this.showAddress(Number(ui.page.value) * this.step, 'top'));
    new ResizeObserver(() => this.layout()).observe(ui.grid);

    // Hover explains a byte; leaving the view goes back to the selection.
    this.window.addEventListener('mousemove', event => {
      const cell = event.target.closest?.('.mem-byte');
      if (cell?.dataset.address) this.hover(Number(cell.dataset.address));
    });
    this.canvas.addEventListener('mousemove', event => this.hover(this.mapAddress(event)));
    this.canvas.addEventListener('click', event => {
      const address = this.mapAddress(event);
      if (address === null) return;
      this.setZoom(16);
      this.select(address);
    });
    for (const node of [this.window, this.canvas]) node.addEventListener('mouseleave', () => this.hover(null));

    for (const button of ui.zoom.querySelectorAll('button')) button.addEventListener('click', () => this.setZoom(Number(button.dataset.zoom)));
  }

  hover(address) {
    if (address === this.hovered) return;
    this.hovered = address;
    this.onHover(address);
  }

  setMemorySize(size) {
    this.size = size;
    this.digits = size > 256 ? 4 : 2;
    // The menu jumps in steps of 256 bytes, or 4 KiB in a large RAM.
    this.step = size > 4096 ? 4096 : 256;
    const pages = size / this.step;
    this.ui.page.replaceChildren(...Array.from({ length: pages }, (_, i) => new Option(`0x${hex(i * this.step, 4)}`, String(i))));
    this.ui.page.hidden = pages === 1;
    this.ui.zoom.hidden = size <= 256;
    this.selected = null;
    this.previous = null;
    this.heat = new Uint8Array(size);
    if (size <= 256 && this.zoom !== 16) this.setZoom(16);
    this.layout();
    this.scroller.scrollTop = 0;
    this.mapView.scrollTop = 0;
    this.first = 0;
    this.syncPage();
  }

  setZoom(zoom) {
    if (!ZOOMS.includes(zoom)) zoom = 16;
    this.zoom = zoom;
    for (const button of this.ui.zoom.querySelectorAll('button')) button.setAttribute('aria-selected', String(Number(button.dataset.zoom) === zoom));
    this.hexView.hidden = zoom !== 16;
    this.mapView.hidden = zoom === 16;
    this.layout();
    if (zoom !== 16 && this.selected !== null) this.showAddress(this.selected);
  }

  /** Hex view: square cells as wide as the frame allows. Map view: the canvas fills the width. */
  layout() {
    if (this.zoom !== 16) return this.layoutMap();
    const width = this.scroller.clientWidth, height = this.scroller.clientHeight;
    if (!width || !height) return;
    const label = this.digits * 8 + 10;
    const cell = Math.max(16, Math.min(34, Math.floor((width - label - 4) / 16)));
    const visible = Math.ceil(height / cell) + 1;
    const total = this.size / 16;
    this.cell = cell;
    this.ui.grid.style.setProperty('--cell', `${cell}px`);
    this.ui.grid.style.setProperty('--label', `${label}px`);
    this.spacer.style.height = `${total * cell}px`;
    const count = Math.min(visible, total);
    if (count !== this.rows.length) {
      this.rows = Array.from({ length: count }, (_, r) => {
        const labelNode = el('span', { class: 'mem-label' });
        const cells = Array.from({ length: 16 }, (_, c) => el('button', {
          type: 'button', class: 'mem-byte', tabindex: -1,
          onclick: () => this.select((this.first + r) * 16 + c),
        }, '00'));
        return { label: labelNode, cells };
      });
      this.window.replaceChildren(...this.rows.flatMap(row => [row.label, ...row.cells]));
    }
    this.first = Math.min(Math.floor(this.scroller.scrollTop / cell), Math.max(0, total - 1));
    this.invalidate();
    if (this.state) this.render(this.state);
  }

  layoutMap() {
    const perRow = this.zoom, rows = this.size / perRow;
    if (this.canvas.width !== perRow || this.canvas.height !== rows) {
      this.canvas.width = perRow;
      this.canvas.height = rows;
      this.image = this.canvas.getContext('2d').createImageData(perRow, rows);
      this.pixels = new Uint32Array(this.image.data.buffer);
    }
    const width = this.canvas.clientWidth;
    if (!width) return;
    // Address labels every 4 KiB (or every 1 KiB when the rows are tall enough).
    const scale = width / perRow;
    const every = rows * scale > 900 ? 1024 : 4096;
    const labels = [];
    for (let a = 0; a < this.size; a += every) labels.push(el('span', { style: `top:${(a / perRow) * scale}px` }, hex(a, 4)));
    this.gutter.replaceChildren(...labels);
    if (this.state) this.render(this.state);
  }

  mapAddress(event) {
    const box = this.canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - box.left) / box.width * this.zoom);
    const y = Math.floor((event.clientY - box.top) / box.height * (this.size / this.zoom));
    if (x < 0 || y < 0 || x >= this.zoom) return null;
    const address = y * this.zoom + x;
    return address < this.size ? address : null;
  }

  syncPage() {
    if (this.ui.page.hidden) return;
    let address = this.first * 16;
    if (this.zoom !== 16) {
      const scale = this.canvas.clientWidth / this.zoom;
      address = scale ? Math.floor(this.mapView.scrollTop / scale) * this.zoom : 0;
    }
    this.ui.page.value = String(Math.min(this.size / this.step - 1, Math.floor(address / this.step)));
  }

  scrollToRow(row, where = 'nearest') {
    const visible = Math.floor(this.scroller.clientHeight / this.cell);
    let first = this.first;
    if (where === 'top') first = row;
    else if (row < this.first) first = row;
    else if (row >= this.first + visible) first = row - visible + 1;
    this.scroller.scrollTop = first * this.cell;
  }

  /** Makes an address visible (for example after clicking a pixel). */
  showAddress(address, where = 'nearest') {
    if (this.zoom === 16) { this.scrollToRow(address >> 4, where); return; }
    const scale = this.canvas.clientWidth / this.zoom, y = Math.floor(address / this.zoom) * scale;
    const view = this.mapView;
    if (where === 'top' || y < view.scrollTop || y > view.scrollTop + view.clientHeight - scale) view.scrollTop = where === 'top' ? y : y - view.clientHeight / 2;
  }

  select(address) {
    this.selected = address;
    if (address !== null) this.showAddress(address);
    this.onSelect(address);
  }

  invalidate() {
    for (const row of this.rows) { row.values = null; row.classes = null; }
  }

  /**
   * state: {memory, pc, pcSize, writes (Set), screen: [start, end), stack: [sp, end) or null,
   *         map (from memoryMap) or null, frames: stack items of a C program}
   */
  render(state) {
    this.state = state;
    this.trackWrites(state.memory);
    if (this.zoom === 16) this.renderHex(state); else this.renderMap(state);
  }

  /** Remembers which bytes changed recently (the glow in the map view). */
  trackWrites(memory) {
    if (!this.heat || this.heat.length !== memory.length) { this.heat = new Uint8Array(memory.length); this.previous = null; }
    const heat = this.heat, previous = this.previous;
    if (previous && previous.length === memory.length) {
      for (let i = 0; i < memory.length; i++) {
        if (memory[i] !== previous[i]) heat[i] = 255;
        else if (heat[i]) heat[i] = heat[i] > 24 ? heat[i] - 24 : 0;
      }
      previous.set(memory);
    } else this.previous = memory.slice();
  }

  renderMap({ memory, pc, pcSize, screen, stack, map }) {
    if (!this.pixels) this.layoutMap();
    const pixels = this.pixels, ramps = this.ramps, heat = this.heat, region = map?.region;
    const [free, code, data, scr, stk] = ramps;
    for (let a = 0; a < this.size; a++) {
      let table = free;
      if (stack && a >= stack[0] && a < stack[1]) table = stk;
      else if (screen && a >= screen[0] && a < screen[1]) table = scr;
      else if (region) table = region[a] === REGION.CODE ? code : region[a] === REGION.DATA ? data : free;
      let color = table[memory[a]];
      const h = heat[a];
      if (h) {
        // Blend towards white: recently written bytes glow.
        const t = h / 400, r = color & 255, g = (color >> 8) & 255, b = (color >> 16) & 255;
        color = 0xFF000000 | (Math.round(b + (255 - b) * t) << 16) | (Math.round(g + (255 - g) * t) << 8) | Math.round(r + (255 - r) * t);
      }
      pixels[a] = color;
    }
    for (let a = pc; a < pc + pcSize && a < this.size; a++) if (a >= 0) pixels[a] = 0xFFFFFFFF;
    if (this.selected !== null) pixels[this.selected] = 0xFF4FC6F7;
    this.canvas.getContext('2d').putImageData(this.image, 0, 0);
  }

  renderHex({ memory, pc, pcSize, writes, screen, stack, map, frames }) {
    this.window.style.transform = `translateY(${this.first * this.cell}px)`;
    const region = map?.region, starts = map?.starts;
    let frameStarts = null, returns = null;
    if (frames?.length) {
      frameStarts = new Set(frames.filter(f => f.kind !== 'pushed').map(f => f.start));
      returns = new Set(frames.filter(f => f.kind === 'return').flatMap(f => Array.from({ length: f.size }, (_, i) => f.start + i)));
    }
    this.rows.forEach((row, r) => {
      const base = (this.first + r) * 16, inside = base < this.size;
      row.values ??= new Int16Array(16).fill(-1);
      row.classes ??= new Array(16).fill('');
      const label = inside ? hex(base, this.digits) : '';
      if (row.label.textContent !== label) row.label.textContent = label;
      for (let c = 0; c < 16; c++) {
        const addr = base + c, cell = row.cells[c];
        if (!inside) { if (row.classes[c] !== 'mem-byte hidden') { cell.className = row.classes[c] = 'mem-byte hidden'; } continue; }
        const value = memory[addr];
        let cls = 'mem-byte';
        if (value) cls += ' nonzero';
        if (region) { if (region[addr] === REGION.CODE) cls += ' code'; else if (region[addr] === REGION.DATA) cls += ' data'; }
        if (starts?.[addr] || frameStarts?.has(addr)) cls += ' named';
        if (screen && addr >= screen[0] && addr < screen[1]) cls += ' screen';
        if (stack && addr >= stack[0] && addr < stack[1]) cls += returns?.has(addr) ? ' stack return' : ' stack';
        if (addr >= pc && addr < pc + pcSize) cls += ' pc';
        if (writes?.has(addr)) cls += ' written';
        if (addr === this.selected) cls += ' selected';
        if (row.values[c] !== value) { cell.textContent = hex(value); row.values[c] = value; }
        if (row.classes[c] !== cls) { cell.className = cls; row.classes[c] = cls; cell.dataset.address = addr; }
      }
    });
  }
}
