// CPU Sandbox: editor, assembler, CPU, screen and RAM view.
import { ARCHITECTURES } from '/src/architectures.js';
import { build, languageOf } from '/src/build.js';
import { MiniCPU, CpuFault, hex } from '/src/cpu.js';
import { DEFAULT_DISPLAY, MODES, validateDisplay } from '/src/display.js';
import { Devices, PORT, frameAt } from '/src/devices.js';
import { DevicePanel } from './devices.js';
import { $, el, icon, grouped, formatHz, formatDuration, loadPreferences, savePreferences } from './util.js';
import { Catalog, ProgramPicker, request } from './catalog.js';
import { SourceEditor } from './editor.js';
import { Screen } from './screen.js';
import { MemoryView } from './memory.js';
import { Reference } from './reference.js';
import { memoryMap, stackItems, describe } from '/src/memorymap.js';

const CLOCKS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 4e6, 8e6, 16e6, 32e6, 64e6];
const preferences = loadPreferences();

const state = {
  program: null,        // {group, file, readonly, revision, original}
  language: 'asm',      // 'asm' or 'c', from the file name
  view: 'c',            // for C programs: show the C source or the generated assembly
  dirty: false,
  saving: false,
  assembly: null,       // last successful assembly of the current text
  arch: ARCHITECTURES.cpu8,
  cpu: null,
  screenOverride: false,
  running: false,
  measured: { cycles: 0, seconds: 0 },
  achievedHz: null,     // cycles per second the browser really manages
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
  onFormat: () => formatDraft(),
});
const asmView = new SourceEditor($('asm-view'), { viewer: true });
const screen = new Screen({
  canvas: $('screen'), area: $('screen-area'), grip: $('screen-grip'), info: $('screen-info'),
  format: $('screen-format'), palette: $('screen-palette'), start: $('screen-start'), width: $('screen-width'), height: $('screen-height'),
}, {
  onChange: () => { state.screenOverride = true; $('screen-reset').disabled = false; syncPalette(); renderMachine(); },
  onPick: address => { memory.select(address); renderMachine(); },
});
const memory = new MemoryView({ grid: $('memory'), page: $('memory-page'), zoom: $('memory-zoom') }, {
  onSelect: address => { showCodeAt(address); renderMachine(); },
  onHover: () => renderSelected(state.cpu?.memory ?? new Uint8Array(state.arch.memorySize)),
});
const devices = new Devices({ seed: Date.now() & 0xFFFF });
const devicePanel = new DevicePanel({ strip: $('devices'), canvas: $('screen'), note: $('screen-note'), area: $('screen-area'), number: $('number-display'), numberValue: $('number-value') }, devices, {
  cpu: () => state.cpu,
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
    state.language = languageOf(value.file);
    editor.setLanguage(state.language);
    editor.load(data.source);
    showView(state.language === 'c' ? state.view : 'c');
    savePreferences({ program: value });
    updateDirty();
    setStatus('');
    assembleNow({ restart: true });
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function formatDraft() {
  if (!state.program || state.saving) return;
  if (state.language === 'c') { setStatus('Formatting is available for assembly programs'); return; }
  const changed = editor.format();
  setStatus(changed ? `Formatted ${changed} line${changed === 1 ? '' : 's'}${state.program.readonly ? '' : ' · save with Ctrl+S'}` : 'Already formatted');
}

function updateDirty() {
  const program = state.program;
  state.dirty = !!program && editor.value !== program.original;
  $('source-save').disabled = !state.dirty || state.saving || program?.readonly;
  $('source-save').hidden = !!program?.readonly;
  $('source-revert').disabled = !state.dirty || state.saving;
  $('source-copy').disabled = !program;
  $('source-format').disabled = !program || state.saving || state.language === 'c';
  $('source-format').title = state.language === 'c' ? 'Formatting is available for assembly programs' : 'Format the current draft (Shift+Alt+F)';
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

// ------------------------------------------------------------ new program / save a copy

/** The first lines of a new program, so it assembles (or compiles) and runs at once. */
function template(language, arch, name) {
  const title = name.replace(/\.(asm|c)$/i, '').replace(/[-_]+/g, ' ').toUpperCase();
  if (language === 'c') {
    return `// ${title}\n//\n// What does this program do?\n\n#pragma cpu ${arch.directive}\n\nvoid main() {\n    out(NUMBER, 42);\n}\n`;
  }
  return `; ${title}\n;\n; What does this program do?\n${arch.id === 'cpu8' ? '' : `\n.cpu ${arch.directive}\n`}\n        LDI A, 42\n        HLT\n`;
}

const dialog = { mode: 'copy', language: 'asm' };

function setNewLanguage(language) {
  dialog.language = language;
  for (const tab of $('new-language').querySelectorAll('button')) tab.setAttribute('aria-selected', String(tab.dataset.language === language));
  $('new-cpu').value = language === 'c' ? 'cpu8x' : 'cpu8';
  const file = $('copy-file');
  if (file.value) file.value = file.value.replace(/\.(asm|c)$/i, '') + (language === 'c' ? '.c' : '.asm');
  file.placeholder = language === 'c' ? 'program.c' : 'program.asm';
}
for (const tab of $('new-language').querySelectorAll('button')) tab.addEventListener('click', () => setNewLanguage(tab.dataset.language));
for (const arch of Object.values(ARCHITECTURES)) $('new-cpu').add(new Option(arch.name, arch.id));

function openProgramDialog(mode) {
  dialog.mode = mode;
  const groups = catalog.studentGroups, copy = mode === 'copy';
  $('copy-groups').replaceChildren(...groups.map(g => new Option(g.label, g.id)));
  const own = state.program && !state.program.readonly ? state.program.group : (preferences.copyGroup ?? groups[0]?.id ?? '');
  $('copy-group').value = own;
  $('copy-title').textContent = copy ? 'Save a copy' : 'New program';
  $('copy-submit').querySelector('span').textContent = copy ? 'Save copy' : 'Create';
  $('copy-submit').querySelector('use').setAttribute('href', `/vendor/tabler-icons.svg#ti-${copy ? 'device-floppy' : 'plus'}`);
  $('copy-note').replaceChildren(copy ? 'The copy is written to ' : 'The program is created in ', el('code', {}, 'programs/'), ' and opened right away.');
  $('new-fields').hidden = copy;
  if (copy) {
    const base = state.program.file.replace(/^\d+-/, '');
    $('copy-file').value = state.program.readonly ? base : base.replace(/\.(asm|c)$/i, '-copy.$1');
  } else {
    $('copy-file').value = '';
    setNewLanguage(preferences.newLanguage ?? 'asm');
  }
  $('copy-error').hidden = true;
  $('copy-dialog').showModal();
  $(own ? 'copy-file' : 'copy-group').focus();
}
const openCopyDialog = () => openProgramDialog('copy');

$('copy-form').addEventListener('submit', async event => {
  event.preventDefault();
  const copy = dialog.mode === 'copy';
  const language = copy ? state.language : dialog.language;
  const group = $('copy-group').value.trim();
  let file = $('copy-file').value.trim();
  if (!/\.(asm|c)$/i.test(file)) file += language === 'c' ? '.c' : '.asm';
  const source = copy ? editor.value : template(languageOf(file), ARCHITECTURES[$('new-cpu').value], file);
  try {
    await request('/api/programs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group, file, source }) });
    preferences.copyGroup = group;
    if (!copy) preferences.newLanguage = languageOf(file);
    savePreferences({ copyGroup: group, newLanguage: preferences.newLanguage });
    $('copy-dialog').close();
    await catalog.refresh();
    await openProgram({ group, file }, { force: true });
    setStatus(`${copy ? 'Saved as' : 'Created'} programs/${group}/${file}`);
  } catch (error) {
    $('copy-error').textContent = error.message;
    $('copy-error').hidden = false;
  }
});
$('program-new').addEventListener('click', () => {
  if (state.dirty && !state.program?.readonly && !confirm('Discard your unsaved changes to this program?')) return;
  openProgramDialog('new');
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
    assembly = build(text, state.language);
  } catch (error) {
    stop();
    state.assembly = null;
    const message = error.detail ?? String(error.message ?? error);
    showProblems([{ line: error.line ?? 0, message, severity: 'error' }]);
    setStatus('');
    $('source-editor').classList.add('stale');
    renderMachine();
    return;
  }
  state.assembly = assembly;
  state.map = memoryMap(assembly);
  $('source-editor').classList.remove('stale');
  showProblems(assembly.warnings.map(w => ({ ...w, severity: 'warning' })));
  setArchitecture(ARCHITECTURES[assembly.architecture]);
  editor.showListing(assembly.listing, state.arch.addressBits / 4);
  if (assembly.language === 'c') {
    asmView.load(assembly.asm, { editable: false });
    asmView.setLanguage('asm');
    asmView.showListing(assembly.asmAssembly.listing, state.arch.addressBits / 4);
  }
  if (!state.screenOverride) setSuggestedScreen();
  updateBreakpoints();
  const last = assembly.listing.at(-1);
  const digits = state.arch.addressBits / 4;
  setStatus(last ? `${grouped(assembly.loadedBytes)} bytes · 0x${hex(assembly.listing[0].address, digits)}–0x${hex(last.address + last.size - 1, digits)}` : 'No instructions yet');
  if (restart) restartMachine();
}

function setArchitecture(arch) {
  $('architecture').value = arch.id;
  const facts = [arch.memorySize > 256 ? `${arch.memorySize / 1024} KiB RAM` : '256 bytes RAM', `${arch.addressBits}-bit addresses`];
  if (arch.stack) facts.push('stack');
  if (arch.index) facts.push('X, Y');
  $('architecture-summary').textContent = facts.join(' · ');
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
  syncPalette();
}

/** The palette chosen for the screen is loaded into the palette chip (and replaces the program's colors). */
const chosenPalette = () => (screen.config && MODES[screen.config.mode].indexed ? screen.config.palette : null);
function syncPalette() {
  if (chosenPalette() !== devices.paletteName) devices.loadPalette(chosenPalette());
}

/** The CPU menu edits the .cpu line (#pragma cpu in C), so the source always says which CPU it needs. */
function chooseArchitecture(id) {
  const arch = ARCHITECTURES[id], text = editor.value, c = state.language === 'c';
  const pattern = c ? /^[ \t]*#[ \t]*pragma[ \t]+cpu\b[^\n]*/im : /^[ \t]*\.cpu\b[^\n;]*/im;
  const directive = c ? `#pragma cpu ${arch.directive}` : `.cpu ${arch.directive}`;
  let next;
  if (pattern.test(text)) next = text.replace(pattern, directive);
  else if (arch.id === (c ? 'cpu8x' : 'cpu8')) return;
  else {
    const lines = text.split('\n');
    let at = 0;
    while (at < lines.length && (c ? /^\s*(\/\/.*)?$/ : /^\s*(;.*)?$/).test(lines[at])) at++;
    lines.splice(at, 0, directive);
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

/** C programs: show the C source or the assembly the compiler generated. */
function showView(view) {
  const c = state.language === 'c';
  state.view = view;
  $('view-tabs').hidden = !c;
  for (const tab of $('view-tabs').querySelectorAll('button')) tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  const showAsm = c && view === 'asm';
  $('source-editor').hidden = showAsm;
  $('asm-view').hidden = !showAsm;
  (showAsm ? asmView : editor).refresh();
  if (c) savePreferences({ view });
  renderMachine();
}
for (const tab of $('view-tabs').querySelectorAll('button')) tab.addEventListener('click', () => showView(tab.dataset.view));

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
  devices.reset(chosenPalette());
  state.cpu = state.assembly ? new MiniCPU(state.assembly.memory, state.assembly.architecture, { devices, clockHz: clockHz() }) : null;
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
  state.measured = { cycles: 0, seconds: 0 };
  state.achievedHz = null;
  state.frame = frameAt(state.cpu.time);
  if (state.cpu) state.cpu.clockHz = clockHz();
  if (state.assembly.ports.some(port => port <= PORT.KEYBOARD || port === PORT.KEYS)) $('screen').focus(); // the keys go to the program
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
  const before = cpu.cycles;
  const deadline = performance.now() + 12;
  let count = 0;
  while (state.budget > 0) {
    if (state.breakpoints.has(cpu.pc) && !state.skipBreakpoint) {
      state.message = { text: `Breakpoint in line ${state.assembly.sourceMap.get(cpu.pc)}`, kind: '' };
      state.running = false;
      break;
    }
    state.skipBreakpoint = false;
    const cycles = execute();
    if (!cycles) { state.running = false; break; }
    state.budget -= cycles;
    // At the start of every frame the screen takes its picture, like a video chip.
    if (frameAt(cpu.time) !== state.frame) { state.frame = frameAt(cpu.time); captureScreen(); }
    if (cpu.halted) { state.running = false; break; }
    if ((++count & 1023) === 0 && performance.now() > deadline) { state.budget = 0; break; } // the browser cannot keep up
  }
  // How fast the browser really runs the CPU (shown when it falls behind the clock).
  state.measured.cycles += cpu.cycles - before;
  state.measured.seconds += elapsed;
  if (state.measured.seconds >= 0.5) {
    state.achievedHz = state.measured.cycles / state.measured.seconds;
    state.measured = { cycles: 0, seconds: 0 };
    // When the browser falls behind the clock, machine time follows the speed it
    // really reaches, so the timer (and every game paced by it) keeps real time.
    cpu.clockHz = state.achievedHz < clockHz() * 0.9 ? state.achievedHz : clockHz();
  }
  renderMachine();
  if (state.running) requestAnimationFrame(frame);
}

/** One instruction; reports faults. Returns its cycles, or null. */
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
  // Only touch the button when its state changes: replacing its children
  // while the mouse is down would swallow the click.
  const run = $('run');
  if (run.dataset.running !== String(state.running)) {
    run.dataset.running = String(state.running);
    run.querySelector('use').setAttribute('href', `/vendor/tabler-icons.svg#ti-player-${state.running ? 'pause' : 'play'}`);
    run.querySelector('span').textContent = state.running ? 'Pause' : 'Run';
  }
}

const REGISTER_GROUPS = [['A', 'B', 'C', 'D'], ['X', 'Y'], ['PC', 'SP'], ['ZF', 'CF']];
const printable = v => (v >= 0x21 && v < 0x7F ? String.fromCharCode(v) : '');

function renderRegisters() {
  const cpu = state.cpu, arch = state.arch, digits = arch.addressBits / 4;
  const changed = cpu && !state.running ? cpu.changedByLastStep() : new Set();
  const groups = [];
  for (const group of REGISTER_GROUPS) {
    const chips = [];
    for (const name of group) {
      if (name === 'SP' && !arch.stack) continue;
      if ((name === 'X' || name === 'Y') && !arch.index) continue;
      let value = '—', title = '';
      const extra = [];
      if (name === 'PC') { title = 'Program counter: address of the next instruction'; if (cpu) value = hex(cpu.pc, digits); }
      else if (name === 'SP') { title = 'Stack pointer: the stack is RAM from SP to the end'; if (cpu) value = hex(cpu.sp, digits); }
      else if (name === 'X' || name === 'Y') {
        const v = cpu ? cpu[name.toLowerCase()] : 0;
        title = `${name}: 16-bit pointer register. ${name}H = ${hex(v >> 8)}, ${name}L = ${hex(v & 255)}`;
        if (cpu) { value = hex(v, 4); extra.push(el('span', { class: 'register-decimal wide' }, String(v))); }
      } else if (name === 'ZF' || name === 'CF') {
        title = name === 'ZF' ? 'Zero flag: the last result was zero' : 'Carry flag: carry or borrow of the last result';
        if (cpu) value = cpu[name.toLowerCase()] ? '1' : '0';
      } else {
        const v = cpu ? cpu.registers['ABCD'.indexOf(name)] : 0;
        title = `${name} = 0x${hex(v)} = ${v} = 0b${v.toString(2).padStart(8, '0')}${printable(v) ? ` = '${printable(v)}'` : ''}`;
        if (cpu) {
          value = hex(v);
          extra.push(el('span', { class: 'register-decimal' }, String(v)), el('span', { class: 'register-char' }, printable(v)));
        }
      }
      chips.push(el('span', { class: `register${changed.has(name) ? ' changed' : ''}${name.endsWith('F') ? ' flag' : ''}`, title },
        // SP can be one past the end of RAM (0x100, 0x10000): keep room for that digit so nothing moves.
        el('b', { class: 'register-name' }, name), el('span', { class: 'register-value', style: name === 'SP' ? `width:${digits + 1}ch;text-align:right` : null }, value), ...extra));
    }
    if (chips.length) groups.push(el('span', { class: 'register-group' }, ...chips));
  }
  const key = groups.map(group => group.outerHTML).join('');
  if (key !== renderRegisters.key) { renderRegisters.key = key; $('registers').replaceChildren(...groups); }
}

function renderMachine() {
  const cpu = state.cpu, assembly = state.assembly, arch = state.arch;
  renderControls();
  renderRegisters();
  devicePanel.render(state.assembly?.ports ?? []);
  const ram = cpu?.memory ?? new Uint8Array(arch.memorySize);
  if (state.running) screen.present();   // the picture of the last frame
  else { followScreenPage(); screen.render(ram, devices.palette); }

  const written = new Set(cpu && !state.running ? cpu.lastWrites() : []);
  const scr = screen.valid;
  state.frames = cpu && assembly && !state.running ? stackItems(assembly, cpu) : [];
  memory.render({
    memory: ram, map: assembly ? state.map : null, frames: state.frames,
    pc: cpu ? cpu.pc : -1, pcSize: cpu ? cpu.disassemble().size : 0,
    writes: written, screen: scr ? [scr.start, scr.endExclusive] : null,
    stack: cpu && arch.stack ? [cpu.sp, arch.memorySize] : null,
  });
  renderSelected(ram);

  const fast = state.running && clockHz() > 2000;
  const line = cpu && assembly && !fast ? assembly.sourceMap.get(cpu.pc) : null;
  const highlight = { scroll: !state.running || clockHz() <= 20, kind: cpu?.fault ? 'source-runtime-error-line' : 'source-execution-line' };
  editor.highlight(line ?? null, highlight);
  editor.updateBytes(cpu ? ram : null);
  if (assembly?.language === 'c' && state.view === 'asm') {
    asmView.highlight(cpu && !fast ? assembly.asmAssembly.sourceMap.get(cpu.pc) ?? null : null, highlight);
    asmView.updateBytes(cpu ? ram : null);
  }

  const digits = arch.addressBits / 4;
  $('cycle-label').textContent = cpu
    ? `${grouped(cpu.cycles)} cycles · ${grouped(cpu.instructions)} instructions · ${formatDuration(cpu.time)} at ${formatHz(clockHz())}${state.running && state.achievedHz && state.achievedHz < clockHz() * 0.9 ? ` · this browser manages ${formatHz(state.achievedHz)}` : ''}`
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

function captureScreen() {
  followScreenPage({ draw: false });
  screen.capture(state.cpu.memory, devices.palette);
}

/** The screen page device moves the screen, like the start register of a video chip. */
function followScreenPage({ draw = true } = {}) {
  const page = devices.outputs.get(PORT.SCREEN);
  if (page === state.screenPage) return;
  state.screenPage = page;
  if (page === undefined) { if (!state.screenOverride) setSuggestedScreen(); return; }
  screen.set(screen.clamp({ ...screen.config, start: page * 256 }), { draw });
}

/**
 * Clicking a byte of the program in the RAM view puts the cursor on its line,
 * in the C source or in the generated assembly, whichever is shown.
 */
function showCodeAt(address) {
  const assembly = state.assembly;
  if (address === null || address === undefined || !assembly) return;
  const inside = e => e.size && address >= e.address && address < e.address + e.size;
  if (assembly.language === 'c') {
    const entry = assembly.asmAssembly.listing.find(inside);
    if (!entry) return;
    if (state.view === 'asm') { asmView.jumpTo(entry.line); return; }
    const line = assembly.sourceMap.get(entry.address) ?? assembly.listing.find(inside)?.line;
    if (line) editor.jumpTo(line);
    return;
  }
  const entry = assembly.listing.find(inside);
  if (entry) editor.jumpTo(entry.line);
}

/** The footer of the RAM view explains the byte under the mouse, or else the selected one. */
function renderSelected(ram) {
  const address = memory.hovered ?? memory.selected, info = $('memory-info');
  if (address === null || address === undefined || address >= ram.length) {
    info.textContent = state.arch.memorySize > 256 ? 'Point at a byte to see what it is. 64 and 256 show all of RAM.' : 'Point at a byte to see what it is.';
    return;
  }
  const v = ram[address];
  let text = state.assembly ? describe(state.map, state.assembly, address, v, state.frames ?? [])
    : `0x${hex(address, state.arch.addressBits / 4)} = 0x${hex(v)} = ${v}`;
  const scr = screen.valid;
  if (scr && address >= scr.start && address < scr.endExclusive) {
    const offset = address - scr.start, row = Math.floor(offset / scr.rowBytes);
    text += ` · screen row ${row}`;
  } else if (state.cpu && state.arch.stack && address >= state.cpu.sp && !(state.frames ?? []).some(f => address >= f.start && address < f.start + f.size)) text += ' · stack';
  if (info.textContent !== text) info.textContent = text;
}

// ------------------------------------------------------------ controls

function setClock(index) {
  $('clock').value = String(index);
  $('clock-output').textContent = formatHz(CLOCKS[index]);
  if (state.cpu) state.cpu.clockHz = CLOCKS[index];
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
$('source-format').addEventListener('click', () => formatDraft());
$('source-copy').addEventListener('click', openCopyDialog);
$('reference-open').addEventListener('click', () => reference.open(state.language === 'c' ? 'c' : state.arch.id));

// A click on the backdrop closes a dialog, as in the Data Structure Sandbox.
for (const dialog of document.querySelectorAll('dialog.app-dialog')) {
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
}

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); return; }
  const target = event.target;
  if (target.closest?.('.CodeMirror, input, select, textarea, dialog, canvas') || event.ctrlKey || event.metaKey || event.altKey) return;
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

if (preferences.view === 'asm') state.view = 'asm';
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
