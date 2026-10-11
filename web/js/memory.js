// RAM as a hex grid of square cells, 16 per row. It shows as many rows as
// fit and scrolls through all of RAM; the page menu follows the scrolling.
import { hex } from '/src/cpu.js';
import { el } from './util.js';

export class MemoryView {
  constructor(ui, { onSelect }) {
    this.ui = ui;
    this.onSelect = onSelect;
    this.size = 256;
    this.digits = 2;
    this.selected = null;
    this.first = 0;      // first visible row
    this.cell = 20;      // cell size in px
    this.rows = [];      // [{label, cells}]
    this.state = null;

    const head = el('div', { class: 'mem-head-row' }, el('span', { class: 'mem-corner' }),
      ...Array.from({ length: 16 }, (_, i) => el('span', { class: 'mem-head' }, hex(i, 1))));
    this.window = el('div', { class: 'mem-window' });
    this.spacer = el('div', { class: 'mem-spacer' });
    this.scroller = el('div', { class: 'mem-scroll' }, this.spacer, this.window);
    ui.grid.replaceChildren(head, this.scroller);

    this.scroller.addEventListener('scroll', () => {
      const first = Math.floor(this.scroller.scrollTop / this.cell);
      if (first === this.first) return;
      this.first = first;
      this.syncPage();
      this.invalidate();
      if (this.state) this.render(this.state);
    });
    ui.page.addEventListener('change', () => { this.scrollToRow(Number(ui.page.value) * 16, 'top'); });
    new ResizeObserver(() => this.layout()).observe(this.scroller);
  }

  setMemorySize(size) {
    this.size = size;
    this.digits = size > 256 ? 4 : 2;
    const pages = size / 256;
    this.ui.page.replaceChildren(...Array.from({ length: pages }, (_, i) => new Option(`0x${hex(i * 256, 4)}`, String(i))));
    this.ui.page.hidden = pages === 1;
    this.selected = null;
    this.layout();
    this.scroller.scrollTop = 0;
    this.first = 0;
    this.syncPage();
  }

  /** Square cells as wide as the frame allows; as many rows as fit. */
  layout() {
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

  syncPage() {
    if (!this.ui.page.hidden) this.ui.page.value = String(Math.floor(this.first / 16));
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
  showAddress(address) { this.scrollToRow(address >> 4); }

  select(address) {
    this.selected = address;
    if (address !== null) this.showAddress(address);
    this.onSelect(address);
  }

  invalidate() {
    for (const row of this.rows) { row.values = null; row.classes = null; }
  }

  /**
   * state: {memory, pc, pcSize, writes (Set), screen: [start, end), stack: [sp, end) or null, occupied}
   * Only visible cells whose value or role changed are touched.
   */
  render(state) {
    this.state = state;
    const { memory, pc, pcSize, writes, screen, stack, occupied } = state;
    this.window.style.transform = `translateY(${this.first * this.cell}px)`;
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
        if (occupied?.[addr]) cls += ' code';
        if (screen && addr >= screen[0] && addr < screen[1]) cls += ' screen';
        if (stack && addr >= stack[0] && addr < stack[1]) cls += ' stack';
        if (addr >= pc && addr < pc + pcSize) cls += ' pc';
        if (writes?.has(addr)) cls += ' written';
        if (addr === this.selected) cls += ' selected';
        if (row.values[c] !== value) { cell.textContent = hex(value); row.values[c] = value; }
        if (row.classes[c] !== cls) { cell.className = cls; row.classes[c] = cls; }
      }
    });
  }
}
