// The program list from the local server, refreshed in the background so
// that git pulls and other editors show up without reloading the page.
import { el, icon } from './util.js';

export async function request(url, options) {
  let response;
  try { response = await fetch(url, options); } catch (_) { throw new Error('The local server is not reachable. Is ./run still running?'); }
  let data;
  try { data = await response.json(); } catch (_) { throw new Error(`The server answered with HTTP ${response.status}`); }
  if (!response.ok) { const error = new Error(data.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
  return data;
}

export class Catalog {
  constructor() {
    this.groups = [];
    this.programsExists = true;
    this.connected = null;
    this.listeners = new Set();
    this.statusListeners = new Set();
  }

  onChange(listener) { this.listeners.add(listener); }
  onStatus(listener) { this.statusListeners.add(listener); }

  async refresh() {
    try {
      const data = await request('/api/catalog');
      this.groups = data.groups;
      this.programsExists = data.programsExists;
      this.setConnected(true);
      for (const listener of this.listeners) listener();
    } catch (error) {
      this.setConnected(false);
      throw error;
    }
  }

  poll(interval = 2500) {
    const tick = () => this.refresh().catch(() => {}).finally(() => setTimeout(tick, interval));
    setTimeout(tick, interval);
  }

  setConnected(on) {
    if (this.connected === on) return;
    this.connected = on;
    for (const listener of this.statusListeners) listener(on);
  }

  find(group, file) {
    return this.groups.find(g => g.id === group)?.files.find(f => f.name === file) ?? null;
  }

  get studentGroups() { return this.groups.filter(g => !g.readonly); }
}

const levelTag = cpu => cpu ? el('span', { class: `level-tag level-${cpu}` }, cpu.toUpperCase()) : null;
const prettyName = name => name.replace(/\.(asm|c)$/i, '');
const languageLabel = name => (/\.c$/i.test(name) ? 'C' : 'Assembly');

/**
 * A searchable dropdown over all examples and student programs, the same
 * picker as in the Sorting and Data Structure sandboxes: name · student (or
 * "Examples") [language] [CPU level]. Typing filters; all words must match.
 */
export class ProgramPicker {
  constructor(container, catalog, { onSelect }) {
    this.catalog = catalog;
    this.onSelect = onSelect;
    this.value = null; // {group, file}
    this.open = false;
    this.active = 0;
    this.filtered = [];
    this.button = el('button', { type: 'button', class: 'picker-button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', onclick: () => this.toggle() });
    this.filter = el('input', { type: 'search', class: 'picker-filter', placeholder: 'Filter by name, student, language or CPU…', 'aria-label': 'Filter programs', autocomplete: 'off', spellcheck: 'false' });
    this.options = el('div', { class: 'picker-options', role: 'listbox', 'aria-label': 'Programs' });
    this.popover = el('div', { class: 'picker-popover', hidden: true }, this.filter, this.options);
    container.append(this.button, this.popover);
    this.filter.addEventListener('input', () => { this.active = 0; this.renderOptions(); });
    this.filter.addEventListener('keydown', event => this.keydown(event));
    this.button.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' && !this.open) { event.preventDefault(); this.toggle(true); }
    });
    document.addEventListener('pointerdown', event => { if (this.open && !container.contains(event.target)) this.toggle(false); });
    catalog.onChange(() => this.render());
    this.render();
  }

  entries() {
    return this.catalog.groups.flatMap(group => group.files.map(file => ({ group, file })));
  }

  /** The program's name, its student (or Examples) and its tags. */
  describe({ group, file }, mixed) {
    return [el('span', { class: 'picker-name' }, prettyName(file.name)),
      el('span', { class: 'picker-author' }, group.label),
      mixed ? el('span', { class: 'picker-language' }, languageLabel(file.name)) : null,
      levelTag(file.cpu)];
  }

  /** True when the list has both C and assembly programs. */
  mixed() {
    return new Set(this.entries().map(({ file }) => languageLabel(file.name))).size > 1;
  }

  setValue(value) { this.value = value; this.render(); }

  toggle(force) {
    const open = force ?? !this.open;
    if (open === this.open) return;
    this.open = open;
    this.popover.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    if (open) {
      this.filter.value = '';
      this.renderOptions();
      this.active = Math.max(0, this.filtered.findIndex(e => this.isSelected(e)));
      this.renderOptions();
      this.filter.focus();
      this.options.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    }
  }

  isSelected({ group, file }) { return this.value?.group === group.id && this.value?.file === file.name; }

  keydown(event) {
    if (event.key === 'Escape') { this.toggle(false); this.button.focus(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.filtered.length) return;
      this.active = (this.active + (event.key === 'ArrowDown' ? 1 : -1) + this.filtered.length) % this.filtered.length;
      this.renderOptions();
      this.options.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const choice = this.filtered[this.active];
      if (choice) this.choose(choice);
    }
  }

  choose({ group, file }) {
    this.toggle(false);
    this.button.focus();
    if (!this.isSelected({ group, file })) this.onSelect({ group: group.id, file: file.name });
  }

  render() {
    const group = this.catalog.groups.find(g => g.id === this.value?.group);
    const file = group?.files.find(f => f.name === this.value?.file);
    this.button.replaceChildren();
    if (!file) this.button.append(el('span', { class: 'picker-placeholder' }, this.entries().length ? 'Choose a program' : 'No programs'));
    // The code panel is narrow: the button leaves out the language tag (the
    // C / Assembly tabs show it), the options show it.
    else this.button.append(...this.describe({ group, file }, false).filter(Boolean));
    this.button.title = file ? `${prettyName(file.name)} · ${group.label} · ${languageLabel(file.name)}` : '';
    this.button.append(icon('chevron-down', 'picker-chevron'));
    if (this.open) this.renderOptions();
  }

  renderOptions() {
    const words = this.filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const mixed = this.mixed();
    this.filtered = this.entries().filter(({ group, file }) => {
      const text = `${file.name} ${group.label} ${languageLabel(file.name)} ${file.cpu ?? ''}`.toLowerCase();
      return words.every(word => text.includes(word));
    });
    if (this.active >= this.filtered.length) this.active = Math.max(0, this.filtered.length - 1);
    const nodes = [];
    this.filtered.forEach((entry, index) => {
      nodes.push(el('div', {
        class: `picker-option${index === this.active ? ' active' : ''}${this.isSelected(entry) ? ' selected' : ''}`,
        role: 'option', 'aria-selected': String(this.isSelected(entry)),
        onpointerdown: event => event.preventDefault(),
        onclick: () => this.choose(entry),
        onpointermove: () => {
          if (this.active === index) return;
          this.active = index;
          this.options.querySelectorAll('.picker-option').forEach((node, i) => node.classList.toggle('active', i === index));
        },
      }, ...this.describe(entry, mixed),
      el('span', { class: 'picker-check' }, this.isSelected(entry) ? icon('check') : null)));
    });
    if (!this.filtered.length) nodes.push(el('div', { class: 'picker-empty' }, 'No program matches this filter.'));
    this.options.replaceChildren(...nodes);
  }
}
