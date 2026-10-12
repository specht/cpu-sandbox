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
const prettyName = name => name.replace(/\.asm$/i, '');

/** A searchable dropdown over all examples and student programs. */
export class ProgramPicker {
  constructor(container, catalog, { onSelect }) {
    this.catalog = catalog;
    this.onSelect = onSelect;
    this.value = null; // {group, file}
    this.open = false;
    this.active = 0;
    this.filtered = [];
    this.button = el('button', { type: 'button', class: 'picker-button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', onclick: () => this.toggle() });
    this.filter = el('input', { type: 'search', class: 'picker-filter', placeholder: 'Filter by file or student…', 'aria-label': 'Filter programs', autocomplete: 'off', spellcheck: 'false' });
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
    else this.button.append(el('span', { class: 'picker-name' }, prettyName(file.name)), el('span', { class: 'picker-author' }, group.label), levelTag(file.cpu));
    this.button.append(icon('chevron-down', 'picker-chevron'));
    if (this.open) this.renderOptions();
  }

  renderOptions() {
    const query = this.filter.value.trim().toLowerCase();
    this.filtered = this.entries().filter(({ group, file }) => !query || `${file.name} ${group.label}`.toLowerCase().includes(query));
    if (this.active >= this.filtered.length) this.active = Math.max(0, this.filtered.length - 1);
    const nodes = [];
    let lastGroup = null;
    this.filtered.forEach((entry, index) => {
      if (entry.group !== lastGroup) {
        lastGroup = entry.group;
        nodes.push(el('div', { class: 'picker-group' }, entry.group.readonly ? 'Examples' : entry.group.label));
      }
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
      }, el('span', { class: 'picker-name' }, prettyName(entry.file.name)), levelTag(entry.file.cpu),
      el('span', { class: 'picker-check' }, this.isSelected(entry) ? icon('check') : null)));
    });
    if (!this.filtered.length) nodes.push(el('div', { class: 'picker-empty' }, 'No program matches this filter.'));
    this.options.replaceChildren(...nodes);
  }
}
