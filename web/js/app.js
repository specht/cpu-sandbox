// CPU Sandbox: editor, assembler, CPU, screen and RAM view.
import { ARCHITECTURES } from '/src/architectures.js';
import { assemble, AssemblyError } from '/src/assembler.js';
import { MiniCPU, CpuFault, hex } from '/src/cpu.js';
import { DEFAULT_DISPLAY, validateDisplay } from '/src/display.js';
import { $, el, icon, grouped, formatHz, formatDuration, loadPreferences, savePreferences } from './util.js';
import { Catalog, ProgramPicker, request } from './catalog.js';
import { SourceEditor } from './editor.js';
import { Screen } from './screen.js';
import { MemoryView } from './memory.js';
import { Reference } from './reference.js';

const CLOCKS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 4e6, 8e6, 16e6];
const preferences = loadPreferences();

const state = {
  program: null,        // {group, file, readonly, revision, original}
  dirty: false,
  saving: false,
  assembly: null,       // last successful assembly of the current text
  arch: ARCHITECTURES.cpu8,
  cpu: null,
  screenOverride: false,
  running: false,
  budget: 0,
  lastFrame: 0,
  skipBreakpoint: false,
  breakpoints: new Set(),
  selected: null,
  message: null,        // {text, kind} shown in the run status
};

// ------------------------------------------------------------ components

const catalog = new Catalog();
const picker = new ProgramPicker($('program-picker'), catalog, { onSelect: value => openProgram(value) });
const editor = new SourceEditor($('source-editor'), {
  onChange: () => { updateDirty(); scheduleAssembly(); },
  onSave: () => save(),
  onBreakpoints: () => updateBreakpoints(),
});
const screen = new Screen({
  canvas: $('screen'), area: $('screen-area'), grip: $('screen-grip'), info: $('screen-info'),
  format: $('screen-format'), palette: $('screen-palette'), start: $('screen-start'), width: $('screen-width'), height: $('screen-height'),
}, {
  onChange: () => { state.screenOverride = true; $('screen-reset').disabled = false; renderMachine(); },
  onPick: address => { memory.select(address); renderMachine(); },
});
const memory = new MemoryView({ grid: $('memory'), page: $('memory-page') }, {
  onSelect: () => { renderMachine(); },
});
const reference = new Reference({ dialog: $('reference-dialog'), tabs: $('reference-tabs'), body: $('reference-body'), close: $('reference-close') });

for (const arch of Object.values(ARCHITECTURES)) $('architecture').add(new Option(arch.name, arch.id));

// ------------------------------------------------------------ programs

async function openProgram(value, { force = false } = {}) {
  if (!force && state.dirty && !confirm('Discard your unsaved changes to this program?')) { picker.setValue(state.program); return; }
  stop();
  try {
    const data = await request(`/api/source?group=${encodeURIComponent(value.group)}&file=${encodeURIComponent(value.file)}`);
    state.program = { group: value.group, file: value.file, readonly: data.readonly, revision: data.revision, original: data.source };
    state.screenOverride = false;
    picker.setValue(value);
    editor.clearBreakpoints();
    editor.load(data.source);
    savePreferences({ program: value });
    updateDirty();
    setStatus('');
    assembleNow({ restart: true });
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function updateDirty() {
  const program = state.program;
  state.dirty = !!program && editor.value !== program.original;
  $('source-save').disabled = !state.dirty || state.saving || program?.readonly;
  $('source-save').hidden = !!program?.readonly;
  $('source-revert').disabled = !state.dirty || state.saving;
  $('source-copy').disabled = !program;
  const chip = $('source-chip');
  chip.replaceChildren();
  chip.hidden = !program || (!state.dirty && !program.readonly);
  if (!chip.hidden) {
    const [text, kind, glyph] = state.dirty
      ? [program.readonly ? 'Changed · save a copy to keep it' : 'Unsaved', 'dirty', 'edit']
      : ['Example', 'busy', 'book'];
    chip.className = `source-chip source-chip-${kind}`;
    chip.append(icon(glyph), el('span', {}, text));
  }
}

async function save() {
  const program = state.program;
  if (!program || !state.dirty || state.saving) return;
  if (program.readonly) { openCopyDialog(); return; }
  state.saving = true;
  updateDirty();
  const content = editor.value;
  try {
    const data = await request(`/api/source?group=${encodeURIComponent(program.group)}&file=${encodeURIComponent(program.file)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: content, revision: program.revision }),
    });
    program.revision = data.revision;
    program.original = content;
    setStatus(`Saved ${program.group}/${program.file}`);
  } catch (error) {
    setStatus(error.status === 409 ? 'The file was changed on disk in the meantime. Save a copy, or revert to load the new version.' : `Not saved: ${error.message}`, 'error');
  } finally {
    state.saving = false;
    updateDirty();
  }
}

function revert() {
  if (!state.dirty || !confirm('Discard your unsaved changes and restore the saved version?')) return;
  editor.load(state.program.original);
  updateDirty();
  assembleNow({ restart: true });
}

// Files can change on disk (git pull, another editor): reload clean ones.
catalog.onChange(() => {
  const missing = $('repository-missing');
  missing.hidden = catalog.programsExists;
  if (!catalog.programsExists) {
    missing.replaceChildren(icon('info-circle'), el('span', {},
      'There is no class repository yet. Clone it from a terminal in the app folder: ',
      el('code', {}, 'git clone <class-repository-url> programs'),
      ' — it shows up here automatically. The examples work without it.'));
  }
  const program = state.program;
  if (!program || state.saving) return;
  const entry = catalog.find(program.group, program.file);
  if (!entry || entry.revision === program.revision) return;
  if (state.dirty) {
    setStatus('This file changed on disk. Your edits are kept; Revert loads the new version.', 'warning');
    program.revision = entry.revision; // Saving would now overwrite the disk version knowingly.
  } else openProgram({ group: program.group, file: program.file }, { force: true });
});
catalog.onStatus(connected => {
  const label = $('connection');
  label.textContent = connected ? 'Connected' : 'Connection lost · retrying…';
  label.className = `connection ${connected ? 'connected' : 'disconnected'}`;
});

// ------------------------------------------------------------ copy dialog

function openCopyDialog() {
  const groups = catalog.studentGroups;
  $('copy-groups').replaceChildren(...groups.map(g => new Option(g.label, g.id)));
  const own = !state.program.readonly ? state.program.group : (preferences.copyGroup ?? groups[0]?.id ?? '');
  $('copy-group').value = own;
  const base = state.program.file.replace(/^\d+-/, '');
  $('copy-file').value = state.program.readonly ? base : base.replace(/\.asm$/i, '-copy.asm');
  $('copy-error').hidden = true;
  $('copy-dialog').showModal();
  $(own ? 'copy-file' : 'copy-group').focus();
}

$('copy-form').addEventListener('submit', async event => {
  event.preventDefault();
  const group = $('copy-group').value.trim();
  let file = $('copy-file').value.trim();
  if (!/\.asm$/i.test(file)) file += '.asm';
  try {
    await request('/api/programs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group, file, source: editor.value }) });
    preferences.copyGroup = group;
    savePreferences({ copyGroup: group });
    $('copy-dialog').close();
    await catalog.refresh();
    await openProgram({ group, file }, { force: true });
    setStatus(`Saved as programs/${group}/${file}`);
  } catch (error) {
    $('copy-error').textContent = error.message;
    $('copy-error').hidden = false;
  }
});
$('copy-close').addEventListener('click', () => $('copy-dialog').close());

// ------------------------------------------------------------ assembling

let assemblyTimer = null;
function scheduleAssembly() {
  clearTimeout(assemblyTimer);
  assemblyTimer = setTimeout(() => assembleNow({ restart: true }), 250);
}

function assembleNow({ restart }) {
  clearTimeout(assemblyTimer);
  const text = editor.value;
  let assembly;
  try {
    assembly = assemble(text);
  } catch (error) {
    stop();
    state.assembly = null;
    const message = error instanceof AssemblyError ? error.detail : String(error.message ?? error);
    showProblems([{ line: error.line ?? 0, message, severity: 'error' }]);
    setStatus('');
    $('source-editor').classList.add('stale');
    renderMachine();
    return;
  }
  state.assembly = assembly;
  $('source-editor').classList.remove('stale');
  showProblems(assembly.warnings.map(w => ({ ...w, severity: 'warning' })));
  setArchitecture(ARCHITECTURES[assembly.architecture]);
  editor.showListing(assembly.listing, state.arch.addressBits / 4);
  if (!state.screenOverride) setSuggestedScreen();
  updateBreakpoints();
  const last = assembly.listing.at(-1);
  const digits = state.arch.addressBits / 4;
  setStatus(last ? `${grouped(assembly.loadedBytes)} bytes · 0x${hex(assembly.listing[0].address, digits)}–0x${hex(last.address + last.size - 1, digits)}` : 'No instructions yet');
  if (restart) restartMachine();
}

function setArchitecture(arch) {
  $('architecture').value = arch.id;
  const facts = [arch.memorySize === 4096 ? '4 KiB RAM' : '256 bytes RAM', `${arch.addressBits}-bit addresses`];
  if (arch.stack) facts.push('stack');
  if (arch.index) facts.push('X, Y');
  $('architecture-summary').replaceChildren(el('span', {}, facts.join(' · ')),
    el('button', { type: 'button', class: 'link-button', onclick: () => reference.open(arch.id) }, `What can ${arch.name} do?`));
  if (arch === state.arch && state.cpu) return;
  state.arch = arch;
  screen.setMemorySize(arch.memorySize);
  memory.setMemorySize(arch.memorySize);
  $('legend-stack').hidden = !arch.stack;
}

function setSuggestedScreen() {
  let config = state.assembly?.display ?? DEFAULT_DISPLAY;
  try { validateDisplay(config, state.arch.memorySize); } catch (_) { config = DEFAULT_DISPLAY; }
  screen.set(config);
  state.screenOverride = false;
  $('screen-reset').disabled = true;
}

/** The CPU menu edits the .cpu line, so the source always says which CPU it needs. */
function chooseArchitecture(id) {
  const arch = ARCHITECTURES[id], text = editor.value;
  const pattern = /^[ \t]*\.cpu\b[^\n;]*/im;
  let next;
  if (pattern.test(text)) next = text.replace(pattern, `.cpu ${arch.directive}`);
  else if (arch.id === 'cpu8') return;
  else {
    const lines = text.split('\n');
    let at = 0;
    while (at < lines.length && /^\s*(;.*)?$/.test(lines[at])) at++;
    lines.splice(at, 0, `.cpu ${arch.directive}`);
    next = lines.join('\n');
  }
  if (next !== text) { editor.replaceAll(next); assembleNow({ restart: true }); }
}
$('architecture').addEventListener('change', () => chooseArchitecture($('architecture').value));

function showProblems(problems) {
  editor.markProblems(problems);
  const list = $('source-problem-list');
  list.replaceChildren(...problems.map(problem => el('li', {}, el('button', {
    type: 'button', class: `source-problem ${problem.severity}`, onclick: () => editor.jumpTo(problem.line),
  }, problem.line ? `Line ${problem.line}: ${problem.message}` : problem.message))));
  $('source-problems').hidden = !problems.length;
  $('source-problems').classList.toggle('warnings-only', problems.every(p => p.severity !== 'error'));
}

function setStatus(text, kind = '') {
  const status = $('source-status');
  status.textContent = text;
  status.hidden = !text;
  status.className = `source-status${kind ? ` ${kind}` : ''}`;
}

function updateBreakpoints() {
  state.breakpoints = new Set();
  const addresses = state.assembly?.lineAddresses;
  if (!addresses) return;
  for (const line of editor.breakpoints()) if (addresses.has(line)) state.breakpoints.add(addresses.get(line));
}

// ------------------------------------------------------------ running

function restartMachine() {
  stop();
  state.cpu = state.assembly ? new MiniCPU(state.assembly.memory, state.assembly.architecture) : null;
  state.message = null;
  state.budget = 0;
  renderMachine();
}

const clockHz = () => CLOCKS[Number($('clock').value)];

function start() {
  if (state.running || !canRun()) return;
  state.running = true;
  state.budget = 0;
  state.lastFrame = performance.now();
  state.skipBreakpoint = true;
  state.message = null;
  requestAnimationFrame(frame);
  renderControls();
}

function stop() {
  if (!state.running) return;
  state.running = false;
  renderMachine();
}

const canRun = () => !!state.cpu && !!state.assembly && !state.cpu.halted && !state.cpu.fault;

function frame(now) {
  if (!state.running) return;
  const cpu = state.cpu;
  const elapsed = Math.min(0.1, (now - state.lastFrame) / 1000);
  state.lastFrame = now;
  state.budget += clockHz() * elapsed;
  const deadline = performance.now() + 12;
  let count = 0;
  while (state.budget > 0) {
    if (state.breakpoints.has(cpu.pc) && !state.skipBreakpoint) {
      state.message = { text: `Breakpoint in line ${state.assembly.sourceMap.get(cpu.pc)}`, kind: '' };
      state.running = false;
      break;
    }
    state.skipBreakpoint = false;
    const record = execute();
    if (!record) { state.running = false; break; }
    state.budget -= record.cycles;
    if (cpu.halted) { state.running = false; break; }
    if ((++count & 1023) === 0 && performance.now() > deadline) { state.budget = 0; break; } // the browser cannot keep up
  }
  renderMachine();
  if (state.running) requestAnimationFrame(frame);
}

/** One instruction; reports faults. Returns the step record or null. */
function execute() {
  try {
    return state.cpu.step();
  } catch (error) {
    if (!(error instanceof CpuFault)) throw error;
    const line = state.assembly?.sourceMap.get(error.pc);
    state.message = { text: `${error.message}${line ? ` (line ${line})` : ''}`, kind: 'error' };
    return null;
  }
}

function stepForward() {
  if (!canRun()) return;
  stop();
  state.message = null;
  execute();
  renderMachine();
}

function stepBack() {
  if (!state.cpu?.canUndo) return;
  stop();
  state.cpu.back();
  state.message = null;
  renderMachine();
}

// ------------------------------------------------------------ rendering

function renderControls() {
  const cpu = state.cpu, live = !!cpu && !!state.assembly;
  $('restart').disabled = !state.assembly;
  $('step-back').disabled = !live || !cpu.canUndo;
  $('step-next').disabled = !canRun();
  $('run').disabled = !canRun() && !state.running;
  const run = $('run');
  run.replaceChildren(icon(state.running ? 'player-pause' : 'player-play'), el('span', {}, state.running ? 'Pause' : 'Run'));
}

const REGISTER_ORDER = ['PC', 'A', 'B', 'C', 'D', 'SP', 'X', 'Y', 'ZF', 'CF'];

function renderRegisters() {
  const cpu = state.cpu, arch = state.arch, digits = arch.addressBits / 4;
  const changed = cpu && !state.running ? cpu.changedByLastStep() : new Set();
  const chips = [];
  for (const name of REGISTER_ORDER) {
    if (name === 'SP' && !arch.stack) continue;
    if ((name === 'X' || name === 'Y') && !arch.index) continue;
    let value = '—', detail = '', title = '';
    if (cpu) {
      if (name === 'PC') { value = hex(cpu.pc, digits); title = 'Program counter: address of the next instruction'; }
      else if (name === 'SP') { value = hex(cpu.sp, digits); title = 'Stack pointer: the stack is RAM from SP to the end'; }
      else if (name === 'X' || name === 'Y') { value = hex(cpu[name.toLowerCase()], 4); title = `Pointer register ${name}: ${name}H = ${hex(cpu[name.toLowerCase()] >> 8)}, ${name}L = ${hex(cpu[name.toLowerCase()] & 255)}`; }
      else if (name === 'ZF' || name === 'CF') { value = cpu[name.toLowerCase()] ? '1' : '0'; title = name === 'ZF' ? 'Zero flag' : 'Carry flag'; }
      else {
        const v = cpu.registers['ABCD'.indexOf(name)];
        value = hex(v); detail = String(v);
        title = `${name} = ${v} = 0b${v.toString(2).padStart(8, '0')}`;
      }
    }
    chips.push(el('span', { class: `register${changed.has(name) ? ' changed' : ''}${name.endsWith('F') ? ' flag' : ''}`, title },
      el('span', { class: 'register-name' }, name), el('span', { class: 'register-value' }, value),
      detail ? el('span', { class: 'register-decimal' }, detail) : null));
  }
  $('registers').replaceChildren(...chips);
}

function renderMachine() {
  const cpu = state.cpu, assembly = state.assembly, arch = state.arch;
  renderControls();
  renderRegisters();
  const ram = cpu?.memory ?? new Uint8Array(arch.memorySize);
  screen.render(ram);

  const writes = cpu?.lastRecord?.writes;
  const written = new Set();
  if (writes) for (let i = 0; i < writes.length; i += 2) written.add(writes[i]);
  const scr = screen.valid;
  memory.render({
    memory: ram, occupied: assembly?.occupied,
    pc: cpu ? cpu.pc : -1, pcSize: cpu ? cpu.disassemble().size : 0,
    writes: written, screen: scr ? [scr.start, scr.endExclusive] : null,
    stack: cpu && arch.stack ? [cpu.sp, arch.memorySize] : null,
  });
  renderSelected(ram);

  const fast = state.running && clockHz() > 2000;
  const line = cpu && assembly && !fast ? assembly.sourceMap.get(cpu.pc) : null;
  editor.highlight(line ?? null, { scroll: !state.running || clockHz() <= 20, kind: cpu?.fault ? 'source-runtime-error-line' : 'source-execution-line' });
  editor.updateBytes(cpu ? ram : null);

  const digits = arch.addressBits / 4;
  $('cycle-label').textContent = cpu
    ? `${grouped(cpu.cycles)} cycles · ${grouped(cpu.instructions)} instructions · ${formatDuration(cpu.cycles / clockHz())} at ${formatHz(clockHz())}`
    : '0 cycles';
  $('next-instruction').textContent = cpu && !cpu.halted && assembly ? `next: ${cpu.disassemble().text}  @ ${hex(cpu.pc, digits)}` : '';
  const status = $('run-status');
  let text, kind = '';
  if (!assembly) { text = cpu ? 'Fix the problem to run' : 'Not assembled'; kind = 'error'; }
  else if (state.message) ({ text, kind } = state.message);
  else if (!cpu) text = 'Ready';
  else if (cpu.halted) text = 'Halted';
  else if (state.running) { text = 'Running'; kind = 'busy'; }
  else text = cpu.instructions ? 'Paused' : 'Ready';
  status.textContent = text;
  status.className = `run-status${kind ? ` ${kind}` : ''}`;
}

function renderSelected(ram) {
  const address = memory.selected, info = $('memory-info'), digits = state.arch.addressBits / 4;
  if (address === null || address >= ram.length) { info.textContent = 'Click a byte or a pixel to inspect it.'; return; }
  const v = ram[address], line = state.assembly?.sourceMap.get(address);
  info.textContent = `0x${hex(address, digits)} = 0x${hex(v)} = ${v} = 0b${v.toString(2).padStart(8, '0')}${v >= 32 && v < 127 ? ` = '${String.fromCharCode(v)}'` : ''}${line ? ` · line ${line}` : ''}`;
}

// ------------------------------------------------------------ controls

function setClock(index) {
  $('clock').value = String(index);
  $('clock-output').textContent = formatHz(CLOCKS[index]);
  savePreferences({ clock: CLOCKS[index] });
  renderMachine();
}
$('clock').max = String(CLOCKS.length - 1);
$('clock').addEventListener('input', () => setClock(Number($('clock').value)));
$('run').addEventListener('click', () => (state.running ? stop() : start()));
$('step-next').addEventListener('click', stepForward);
$('step-back').addEventListener('click', stepBack);
$('restart').addEventListener('click', restartMachine);
$('screen-reset').addEventListener('click', () => { setSuggestedScreen(); renderMachine(); });
$('source-save').addEventListener('click', save);
$('source-revert').addEventListener('click', revert);
$('source-copy').addEventListener('click', openCopyDialog);
$('reference-open').addEventListener('click', () => reference.open(state.arch.id));

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); return; }
  const target = event.target;
  if (target.closest?.('.CodeMirror, input, select, textarea, dialog') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === ' ') { event.preventDefault(); if (state.running) stop(); else start(); }
  else if (event.key === 'ArrowRight') { event.preventDefault(); stepForward(); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); stepBack(); }
  else if (event.key === 'Home') { event.preventDefault(); restartMachine(); }
});
window.addEventListener('beforeunload', event => {
  if (!state.dirty || state.program?.readonly) return;
  event.preventDefault();
  event.returnValue = '';
});

// ------------------------------------------------------------ start

const savedClock = CLOCKS.indexOf(preferences.clock);
setClock(savedClock >= 0 ? savedClock : CLOCKS.indexOf(1e4));
setArchitecture(ARCHITECTURES.cpu8);
setSuggestedScreen();
editor.placeholder('Loading…');
renderMachine();

catalog.refresh().then(() => {
  const saved = preferences.program;
  const first = catalog.groups.find(g => g.files.length);
  const choice = saved && catalog.find(saved.group, saved.file) ? saved : first ? { group: first.id, file: first.files[0].name } : null;
  if (choice) openProgram(choice, { force: true });
  else editor.placeholder('No programs found.');
}).catch(error => {
  editor.placeholder(error.message);
}).finally(() => catalog.poll());
