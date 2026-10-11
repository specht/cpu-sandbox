// RAM as a 16 × 16 hex grid, one 256-byte page at a time.
import { hex } from '/src/cpu.js';
import { el } from './util.js';

export class MemoryView {
  constructor(ui, { onSelect }) {
    this.ui = ui;
    this.onSelect = onSelect;
    this.page = 0;
    this.pages = 1;
    this.selected = null;
    this.cells = [];
    this.labels = [];
    this.previous = new Int16Array(256).fill(-1);
    this.previousClass = new Array(256).fill('');

    const grid = ui.grid;
    grid.append(el('span', { class: 'mem-corner' }));
    for (let i = 0; i < 16; i++) grid.append(el('span', { class: 'mem-head' }, hex(i, 1)));
    for (let row = 0; row < 16; row++) {
      const label = el('span', { class: 'mem-label' });
      this.labels.push(label);
      grid.append(label);
      for (let col = 0; col < 16; col++) {
        const offset = row * 16 + col;
        const cell = el('button', { type: 'button', class: 'mem-byte', tabindex: -1, onclick: () => this.select(this.page * 256 + offset) }, '00');
        this.cells.push(cell);
        grid.append(cell);
      }
    }
    ui.page.addEventListener('change', () => { this.page = Number(ui.page.value); this.invalidate(); this.onSelect(null); });
  }

  setMemorySize(size) {
    this.pages = size / 256;
    this.digits = size > 256 ? 4 : 2;
    this.page = Math.min(this.page, this.pages - 1);
    this.ui.page.replaceChildren(...Array.from({ length: this.pages }, (_, i) => new Option(`0x${hex(i * 256, 4)}`, String(i))));
    this.ui.page.value = String(this.page);
    this.ui.page.hidden = this.pages === 1;
    this.selected = null;
    this.invalidate();
  }

  showAddress(address) {
    const page = Math.floor(address / 256);
    if (page !== this.page) { this.page = page; this.ui.page.value = String(page); this.invalidate(); }
  }

  select(address) {
    this.selected = address;
    if (address !== null) this.showAddress(address);
    this.onSelect(address);
  }

  invalidate() {
    this.previous.fill(-1);
    this.previousClass.fill('');
    for (let row = 0; row < 16; row++) this.labels[row].textContent = hex(this.page * 256 + row * 16, this.digits);
  }

  /**
   * state: {memory, pc, pcSize, writes (Set), screen: [start, end), stack: [sp, end) or null, occupied}
   * Only cells whose value or role changed are touched.
   */
  render(state) {
    const base = this.page * 256, { memory, pc, pcSize, writes, screen, stack, occupied } = state;
    for (let i = 0; i < 256; i++) {
      const addr = base + i, value = memory[addr], cell = this.cells[i];
      let cls = 'mem-byte';
      if (value) cls += ' nonzero';
      if (occupied?.[addr]) cls += ' code';
      if (screen && addr >= screen[0] && addr < screen[1]) cls += ' screen';
      if (stack && addr >= stack[0] && addr < stack[1]) cls += ' stack';
      if (addr >= pc && addr < pc + pcSize) cls += ' pc';
      if (writes?.has(addr)) cls += ' written';
      if (addr === this.selected) cls += ' selected';
      if (this.previous[i] !== value) { cell.textContent = hex(value); this.previous[i] = value; }
      if (this.previousClass[i] !== cls) { cell.className = cls; this.previousClass[i] = cls; }
    }
  }
}
