import { assemble, AssemblyError } from '/assembler.js';
import { MiniCPU, hex, CpuFault } from '/cpu.js';
import { DEFAULT_DISPLAY, MODES, validateDisplay, renderDisplay } from '/display.js';
import { PALETTES } from '/palettes.js';
const $ = id => document.getElementById(id);
const all = { group: $('group'), program: $('program'), source: $('source') };
let catalog = [], selected = null, original = '', revision = '', dirty = false;
let assembled = null, assembledSource = null, cpu = null, frames = [], trace = [], playback = null, selectedAddress = null;
const MAX_HISTORY = 3000, MAX_RUN = 200000;
const regNames = ['A', 'B', 'C', 'D'];
const memElements = [];
let currentDisplay = { ...DEFAULT_DISPLAY }, displayOverridden = false;
let assembleTimer = null;
const depthSteps = [1, 2, 4, 8, 24];
const displayFields = ['start','width','height','depth','mode','palette'];
const modesByDepth = bits => Object.entries(MODES).filter(([, spec]) => spec.bits === bits);
const paletteKeys = bits => Object.keys(PALETTES).filter(key => PALETTES[key].length === 2 ** bits);
const safe = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function syntaxLine(text) {
  const at = text.indexOf(';');
  const code = at < 0 ? text : text.slice(0,at);
  const comment = at < 0 ? '' : `<span class="hl-comment">${safe(text.slice(at))}</span>`;
  const pattern = /(?:\.[A-Za-z]+|0[xX][\da-fA-F]+|0[bB][01_]+|\b\d+\b|\b[A-Za-z_][\w]*\b|"[^"\n]*")/g;
  const mnemonics = new Set(['LDI','LDA','STA','MOV','ADD','SUB','INC','DEC','SHL','SHR','AND','OR','XOR','CMP','JZ','JNZ','JC','JNC','JMP','CLF','NOP','HLT']);
  let result = '', previous = 0;
  for (const match of code.matchAll(pattern)) {
    result += safe(code.slice(previous,match.index));
    const word = match[0], upper = word.toUpperCase();
    const kind = word[0] === '.' ? 'directive' : word[0] === '"' ? 'string' : /^0[xXbB]|^\d/.test(word) ? 'number' : mnemonics.has(upper) ? 'mnemonic' : /^(A|B|C|D|R[0-3])$/.test(upper) ? 'register' : 'label';
    result += `<span class="hl-${kind}">${safe(word)}</span>`;
    previous = match.index + word.length;
  }
  return result + safe(code.slice(previous)) + comment;
}
function highlightSource() {
  const active = cpu && assembled?.sourceMap.get(cpu.pc);
  $('highlight').innerHTML = all.source.value.split('\n').map((line, i) => `<span class="hl-line${active === i+1 ? ' current' : ''}">${syntaxLine(line) || ' '}</span>`).join('');
  const layer = $('highlight-layer');
  layer.scrollTop = all.source.scrollTop; layer.scrollLeft = all.source.scrollLeft;
}
function assembleSoon() {
  clearTimeout(assembleTimer);
  stopPlayback();
  // Running the old machine image after source edits would be misleading.
  clearCpu();
  setStatus('Assembling edited source…');
  assembleTimer = setTimeout(assembleSource, 280);
}
function populateModes(bits, preferred) {
  const select = $('display-mode');
  select.replaceChildren();
  for (const [mode, spec] of modesByDepth(bits)) select.add(new Option(spec.label, mode));
  select.value = modesByDepth(bits).some(([mode]) => mode === preferred)
    ? preferred : modesByDepth(bits)[0][0];
}
function populatePalettes(mode, preferred) {
  const select = $('display-palette');
  select.replaceChildren();
  if (!MODES[mode].indexed) {
    select.add(new Option('Not applicable', ''));
    select.disabled = true;
    return null;
  }
  const keys = paletteKeys(MODES[mode].bits);
  for (const key of keys) select.add(new Option(key.replaceAll('_', ' '), key));
  const choice = keys.includes(preferred) ? preferred : keys[0];
  select.value = choice;
  select.disabled = false;
  return choice;
}
function updateDisplayLabels() {
  $('display-width-value').textContent = `${$('display-width').value} px`;
  $('display-height-value').textContent = `${$('display-height').value} px`;
  $('display-depth-value').textContent = `${depthSteps[Number($('display-depth').value)]} bpp`;
}
function setDisplay(config, overridden = false) {
  currentDisplay = { ...config };
  displayOverridden = overridden;
  $('display-start').value = `0x${hex(currentDisplay.start)}`;
  $('display-width').value = currentDisplay.width;
  $('display-height').value = currentDisplay.height;
  const depthIndex = depthSteps.indexOf(MODES[currentDisplay.mode].bits);
  $('display-depth').value = depthIndex;
  populateModes(depthSteps[depthIndex], currentDisplay.mode);
  currentDisplay.palette = populatePalettes(currentDisplay.mode, currentDisplay.palette);
  updateDisplayLabels();
  renderDisplayView();
}
function displayInput(event) {
  displayOverridden = true;
  const text = $('display-start').value.trim();
  const start = /^0x/i.test(text) ? Number.parseInt(text.slice(2), 16) : Number(text);
  if (event.target.id === 'display-depth') {
    populateModes(depthSteps[Number($('display-depth').value)], currentDisplay.mode);
  }
  const mode = $('display-mode').value;
  const palette = populatePalettes(mode, $('display-palette').value || currentDisplay.palette);
  currentDisplay = {
    start, width: Number($('display-width').value), height: Number($('display-height').value),
    mode, palette,
  };
  updateDisplayLabels();
  renderDisplayView();
}
function fitFrameBuffer() {
  const wrap = $('framebuffer-wrap'), view = $('framebuffer');
  if (!view.children.length || !currentDisplay.width || !currentDisplay.height) return;
  const style = getComputedStyle(wrap);
  const availableWidth = wrap.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availableHeight = wrap.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (availableWidth <= 0 || availableHeight <= 0) return;
  const cell = Math.floor(Math.min(availableWidth / currentDisplay.width,
    availableHeight / currentDisplay.height, 500 / currentDisplay.width) * 100) / 100;
  view.style.width = `${cell * currentDisplay.width}px`;
  view.style.height = `${cell * currentDisplay.height}px`;
}
function renderDisplayView() {
  const view = $('framebuffer');
  try {
    const config = validateDisplay(currentDisplay), data = renderDisplay(cpu?.memory ?? new Uint8Array(256), config, PALETTES);
    const occupied = assembled?.occupied;
    let overlaps = false;
    if (occupied) for(let y=0;y<config.height;y++) {
      const base = config.start+y*config.rowBytes;
      if (occupied.slice(base,base+config.rowBytes).some(Boolean)) { overlaps=true; break; }
    }
    $('display-notice').textContent = overlaps ? 'This display overlaps assembled code/data in shared RAM.' : '';
    $('display-notice').className = 'display-notice';
    const rebuild = view.children.length !== data.length;
    if (rebuild) {
      view.replaceChildren();
      const nodes = document.createDocumentFragment();
      for (let i=0;i<data.length;i++) {
        const node = document.createElement('div'); node.className = 'pixel';
        node.addEventListener('click', () => {selectedAddress = Number(node.dataset.address); selectInspector('memory');renderCpu();});
        nodes.append(node);
      }
      view.append(nodes);
    }
    view.style.gridTemplateColumns = `repeat(${config.width}, minmax(0, 1fr))`;
    view.style.gridTemplateRows = `repeat(${config.height}, minmax(0, 1fr))`;
    fitFrameBuffer(); // Equal width and height per pixel, regardless of panel shape.
    // Update existing cells rather than allocate thousands of DOM nodes per frame.
    for (let i=0;i<data.length;i++) {
      const entry = data[i], node = view.children[i];
      node.className = 'pixel' + (cpu?.last?.changedMemory.includes(entry.address) ? ' changed' : '');
      node.dataset.address = entry.address;
      node.style.backgroundColor = entry.color;
      node.title = `(${entry.x}, ${entry.y}) · RAM[0x${hex(entry.address)}]` + (entry.index === undefined ? ' · RGB' : ` · index/value ${entry.index}`);
    }
    $('display-summary').textContent = `${config.width}×${config.height} · ${config.bits} bpp · ${config.rowBytes} bytes/row · ${config.bytesSpanned} bytes`;
    $('pixel-count').textContent = `${data.length} pixels`;
  } catch (error) {
    view.replaceChildren();
    $('display-notice').textContent = error.message;
    $('display-notice').className = 'display-notice error';
    $('display-summary').textContent = 'Invalid display mapping';
    $('pixel-count').textContent = '';
  }
}
function selectInspector(panel) {
  for (const name of ['memory','code','trace']) {
    $('panel-'+name).hidden = panel !== name;
    $('tab-'+name).setAttribute('aria-selected', String(panel === name));
  }
}

const setStatus = (msg, kind = '') => { $('diagnostics').className = 'diagnostics ' + kind; $('diagnostics').textContent = msg; };
const formatCount = value => Number(value).toLocaleString('en-US');
const discardConfirm = () => !dirty || confirm('Discard unsaved changes to the current source?');
const selectedGroup = () => catalog.find(g => g.id === all.group.value);
const selectedFile = () => all.program.value;
function markDirty() {
  dirty = all.source.value !== original;
  $('dirty').hidden = !dirty;
  $('save').disabled = !selected || selected.readonly || !dirty;
  $('filename').textContent = selected ? `${selected.file}${dirty ? ' *' : ''}` : 'Select a program';
  $('footer-status').textContent = !selected ? 'No program' : `${selected.readonly ? 'Read-only example' : 'Disk-backed source'} · ${dirty ? 'not saved' : 'saved'}`;
}
async function request(url, options) {
  let response;
  try { response = await fetch(url, options); }
  catch { throw new Error('Cannot reach the local server. Start ./run.'); }
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`Server returned HTTP ${response.status}`); }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function renderGroupOptions(previousGroup) {
  all.group.replaceChildren();
  for (const g of catalog) { const o = new Option(g.label + (g.readonly ? ' · examples' : ''), g.id); all.group.add(o); }
  if (catalog.some(g => g.id === previousGroup)) all.group.value = previousGroup;
}
function renderProgramOptions(preferred) {
  all.program.replaceChildren();
  const g = selectedGroup();
  for (const filename of g?.files ?? []) all.program.add(new Option(filename, filename));
  if (g?.files.includes(preferred)) all.program.value = preferred;
  all.program.disabled = !(g?.files.length);
  $('new-program').disabled = !g || g.readonly;
  $('copy-program').hidden = !g?.readonly;
}
async function refreshCatalog({ group, file, force = false } = {}) {
  if (!force && !discardConfirm()) return false;
  try {
    const data = await request('/api/catalog');
    catalog = data.groups;
    renderGroupOptions(group ?? selected?.group ?? '@examples');
    renderProgramOptions(file ?? selected?.file);
    $('connection').textContent = 'Local server';
    await loadSelected();
    return true;
  } catch (error) { setStatus(error.message, 'error'); $('connection').textContent = 'Disconnected'; return false; }
}
async function loadSelected() {
  stopPlayback();
  const group = all.group.value, file = selectedFile();
  if (!group || !file) {
    selected = null; original = ''; all.source.value = ''; all.source.disabled = true;
    markDirty(); clearCpu(); setStatus('No .asm files in this directory. Use + New, or clone a class repository into programs/.');
    updateNumbers(); highlightSource(); return;
  }
  try {
    const data = await request(`/api/source?group=${encodeURIComponent(group)}&file=${encodeURIComponent(file)}`);
    selected = { group, file, readonly: data.readonly };
    original = data.source; revision = data.revision;
    all.source.disabled = false;
    all.source.value = original;
    markDirty(); updateNumbers();
    displayOverridden = false;
    assembleSource();
  } catch (error) { setStatus(error.message, 'error'); }
}
function updateNumbers() {
  const text = all.source.value;
  const total = text.split('\n').length;
  const rail = $('line-numbers');
  if (rail.children.length !== total) {
    rail.replaceChildren();
    for (let i = 1; i <= total; i++) { const span = document.createElement('span'); span.textContent = String(i); rail.append(span); }
  }
  const start = all.source.selectionStart;
  const before = text.slice(0, start), lines = before.split('\n');
  $('line-pos').textContent = `Ln ${lines.length}, Col ${lines.at(-1).length + 1}`;
  $('line-numbers').scrollTop = all.source.scrollTop;
  highlightSource();
}
function clearCpu() {
  cpu = null; assembled = null; assembledSource = null; frames.length = 0; trace.length = 0;
  $('operation').textContent = 'Not assembled';
  $('trace').replaceChildren(); $('machine-listing').replaceChildren();
  $('byte-count').textContent = '—';
  renderCpu();
}
function assembleSource() {
  clearTimeout(assembleTimer);
  assembleTimer = null;
  stopPlayback();
  clearCpu();
  if (!selected) return;
  try {
    assembled = assemble(all.source.value);
    if (!displayOverridden) setDisplay(assembled.display ?? DEFAULT_DISPLAY);
    // Invalid suggested metadata is diagnosed as source error, not silently ignored.
    if (assembled.display) validateDisplay(assembled.display);
    assembledSource = all.source.value;
    cpu = new MiniCPU(assembled.memory);
    const warnings = assembled.diagnostics;
    const notes = `${assembled.loadedBytes} bytes assembled · ${assembled.listing.length} listing entries`;
    setStatus(warnings.length ? `${notes}. ${warnings.map(w => w.message).join(' ')}` : notes, warnings.length ? 'warning' : 'ok');
    renderListing();
    renderCpu();
    highlightSource();
    return true;
  } catch (error) {
    if (error instanceof AssemblyError) {
      setStatus(error.message, 'error');
      $('diagnostics').onclick = () => jumpToLine(error.line);
    } else setStatus(String(error.message || error), 'error');
    renderCpu();
    highlightSource();
    return false;
  }
}
function jumpToLine(line) {
  if (!line || !selected) return;
  const parts = all.source.value.split('\n');
  const pos = parts.slice(0, Math.max(0, line - 1)).reduce((n, s) => n + s.length + 1, 0);
  all.source.focus(); all.source.setSelectionRange(pos, pos + (parts[line - 1]?.length ?? 0));
  const top = Math.max(0, (line - 4) * 22);
  all.source.scrollTop = top; updateNumbers();
}
function stopPlayback() {
  if (playback) { playback.cancelled = true; clearInterval(playback.interval); clearTimeout(playback.timeout); }
  playback = null;
  $('play').textContent = '▶ Play';
}
function stepOnce() {
  if (!cpu || cpu.halted) return false;
  if (frames.length >= MAX_HISTORY) frames.shift();
  frames.push(cpu.snapshot());
  try {
    const last = cpu.step();
    trace.push({ text: last.text, pc: last.pc, cycle: cpu.cycles });
    if (trace.length > 60) trace.shift();
    return !cpu.halted;
  } catch (error) {
    // Keep pre-fault snapshot so users can undo a fault.
    stopPlayback();
    setStatus(error instanceof CpuFault ? error.message : String(error), 'error');
    return false;
  }
}
function goBack() {
  if (!cpu || !frames.length) return;
  stopPlayback();
  cpu.restore(frames.pop());
  if (trace.length) trace.pop();
  renderCpu();
}
function goPlay() {
  if (playback) { stopPlayback(); renderCpu(); return; }
  if (!cpu || cpu.halted) return;
  const play = { cancelled: false }; playback = play;
  $('play').textContent = 'Ⅱ Pause';
  play.interval = setInterval(() => {
    if (play.cancelled || !cpu || cpu.halted) { stopPlayback(); renderCpu(); return; }
    const speed = Number($('speed').value);
    const chunk = speed < 70 ? 1 : speed < 90 ? 5 : 25;
    for (let i = 0; i < chunk; i++) {
      if (!stepOnce() || cpu.cycles >= MAX_RUN) { stopPlayback(); break; }
    }
    if (cpu.cycles >= MAX_RUN && !cpu.halted) setStatus(`Paused at ${formatCount(MAX_RUN)} executed instructions (safety limit). You may step or reset.`, 'warning');
    renderCpu();
  }, Math.max(20, Math.round(550 * Math.pow((101 - Number($('speed').value)) / 100, 2))));
  renderCpu();
}
function runToEnd() {
  if (!cpu || cpu.halted) return;
  stopPlayback();
  const job = { cancelled: false }; playback = job;
  const batch = () => {
    if (job.cancelled || !cpu) return;
    let i = 0;
    while (i++ < 1500 && cpu.cycles < MAX_RUN && !cpu.halted && !job.cancelled) {
      if (!stepOnce()) break;
    }
    renderCpu();
    if (cpu.halted || cpu.cycles >= MAX_RUN || job.cancelled) {
      stopPlayback();
      if (!cpu.halted && cpu.cycles >= MAX_RUN) setStatus(`Stopped at ${formatCount(MAX_RUN)} instructions. Possible infinite loop; machine state is preserved.`, 'warning');
      renderCpu();
    } else job.timeout = setTimeout(batch, 0);
  };
  job.timeout = setTimeout(batch, 0);
}
function renderTrace() {
  const node = $('trace'); node.replaceChildren();
  if (!trace.length) { node.textContent = 'No instructions executed yet.'; return; }
  for (const entry of trace.slice(-24)) {
    const row = document.createElement('div'); row.className = 'trace-row';
    row.innerHTML = `<span class="address">${hex(entry.pc)}</span><span></span><span class="cycles">${entry.cycle}</span>`;
    row.children[1].textContent = entry.text;
    node.append(row);
  }
  node.lastElementChild?.classList.add('current');
  node.scrollTop = node.scrollHeight;
}
function renderListing() {
  const node = $('machine-listing'); node.replaceChildren();
  if (!assembled) return;
  $('byte-count').textContent = `${assembled.loadedBytes} bytes`;
  for (const entry of assembled.listing) {
    const row = document.createElement('div'); row.className = 'machine-code-row'; row.dataset.addr = String(entry.address);
    const addr = document.createElement('span'); addr.textContent = hex(entry.address);
    const bytes = document.createElement('span'); bytes.className = 'bytes'; bytes.textContent = entry.bytes.map(b => hex(b)).join(' ');
    const source = document.createElement('span'); source.className = 'source-snippet'; source.textContent = entry.source;
    row.append(addr, bytes, source);
    row.title = `Source line ${entry.line}`;
    row.addEventListener('click', () => jumpToLine(entry.line));
    node.append(row);
  }
}
function createMemory() {
  const mem = $('memory');
  const label = text => { const div = document.createElement('span'); div.className = 'mem-head'; div.textContent = text; return div; };
  mem.append(label(''));
  for (let i = 0; i < 16; i++) mem.append(label(hex(i,1)));
  for (let row = 0; row < 16; row++) {
    const lab = label(hex(row * 16)); lab.className = 'mem-label'; mem.append(lab);
    for (let col = 0; col < 16; col++) {
      const addr = row * 16 + col, cell = document.createElement('button');
      cell.className = 'mem-byte'; cell.textContent = '00'; cell.title = `RAM[0x${hex(addr)}]`;
      cell.addEventListener('click', () => { selectedAddress = addr; renderCpu(); });
      memElements.push(cell); mem.append(cell);
    }
  }

}
function renderCpu() {
  const live = !!cpu;
  $('back').disabled = !live || !frames.length;
  $('step').disabled = !live || cpu.halted || !!playback;
  $('play').disabled = !live || cpu.halted;
  $('instant').disabled = !live || cpu.halted || !!playback;
  $('reset').disabled = !assembled;
  $('pc').textContent = live ? hex(cpu.pc) : '--';
  $('cycles').textContent = live ? formatCount(cpu.cycles) : '0';
  $('zf').textContent = live && cpu.zf ? '1' : '0';
  $('cf').textContent = live && cpu.cf ? '1' : '0';
  const state = $('run-state');
  state.textContent = !live ? 'ASSEMBLE' : cpu.halted ? 'HALTED' : playback ? 'RUNNING' : 'PAUSED';
  state.className = 'state-tag' + (playback ? ' running' : '');
  $('operation').textContent = !live ? 'Not assembled' : cpu.last?.text || 'Ready at 0x00';
  const last = live ? cpu.last : null;
  $('registers').replaceChildren();
  for (let i = 0; i < 4; i++) {
    const reg = document.createElement('div'); reg.className = 'reg' + (last?.changedRegisters.includes(i) ? ' changed' : '');
    const left = document.createElement('b'); left.textContent = regNames[i];
    const value = document.createElement('strong'); value.textContent = live ? `0x${hex(cpu.registers[i])}` : '--';
    reg.append(left, value); reg.title = live ? `${regNames[i]} = ${cpu.registers[i]} decimal` : '';
    $('registers').append(reg);
  }
  for (let i = 0; i < 256; i++) {
    const value = live ? cpu.memory[i] : 0;
    const cell = memElements[i];
    cell.textContent = hex(value);
    cell.className = 'mem-byte' + (value ? ' nonzero' : '') + (last?.changedMemory.includes(i) ? ' changed' : '') + (i === cpu?.pc ? ' active' : '') + (selectedAddress === i ? ' selected' : '');
    cell.title = `0x${hex(i)} (${i}): 0x${hex(value)} (${value})`;
  }
  renderDisplayView();
  const activeLine = live && assembled?.sourceMap.get(cpu.pc);
  for (const element of $('line-numbers').children) element.classList.toggle('active', !!activeLine && Number(element.textContent) === activeLine);
  $('selected-byte').textContent = selectedAddress === null || !live ? '—' : `0x${hex(selectedAddress)} = ${hex(cpu.memory[selectedAddress])} (${cpu.memory[selectedAddress]})`;
  for (const row of $('machine-listing').children) {
    const addr = Number(row.dataset.addr), entry = assembled?.listing.find(e => e.address === addr);
    const changed = !!live && !!entry && entry.bytes.some((v,i) => cpu.memory[addr+i] !== v);
    row.classList.toggle('active', live && addr === cpu.pc);
    row.classList.toggle('changed', changed);
    if (changed) {
      row.children[1].textContent = Array.from(cpu.memory.slice(addr,addr+entry.size)).map(v=>hex(v)).join(' ');
      row.title = `Self-modified instruction/data · source line ${entry.line} · originally ${entry.bytes.map(hex).join(' ')}`;
    } else if (entry) {
      row.children[1].textContent = entry.bytes.map(v=>hex(v)).join(' ');
      row.title = `Source line ${entry.line}`;
    }
  }
  highlightSource();
  renderTrace();
}
async function save() {
  if (!selected || selected.readonly || !dirty) return;
  try {
    const data = await request(`/api/source?group=${encodeURIComponent(selected.group)}&file=${encodeURIComponent(selected.file)}`, {
      method:'PUT', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ source:all.source.value, revision })
    });
    revision = data.revision; original = all.source.value; markDirty();
    setStatus(`Saved ${selected.group}/${selected.file} to disk.`, 'ok');
  } catch (error) { setStatus(`Save failed: ${error.message}`, 'error'); }
}
async function newProgram({ copy = false } = {}) {
  const groups = catalog.filter(g => !g.readonly);
  if (!groups.length) { setStatus('No student directories. Clone your class repository into programs/ first.', 'warning'); return; }
  const targetGroup = selectedGroup()?.readonly ? prompt(`Choose student directory (${groups.map(g => g.id).join(', ')}):`, groups[0].id) : all.group.value;
  if (!targetGroup) return;
  const suggested = copy ? selected?.file?.replace(/\.asm$/i, '-copy.asm') : 'new-program.asm';
  let file = prompt('New assembly filename (.asm):', suggested);
  if (!file) return;
  if (!file.toLowerCase().endsWith('.asm')) file += '.asm';
  const source = copy ? all.source.value : '; My assembly program\nLDI A, 0\nHLT\n';
  try {
    await request('/api/programs', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ group:targetGroup,file,source }) });
    await refreshCatalog({ group:targetGroup,file,force:true });
    setStatus(`Created programs/${targetGroup}/${file}.`, 'ok');
  } catch(error) { setStatus(error.message, 'error'); }
}
function bind() {
  all.source.addEventListener('input', () => { markDirty(); updateNumbers(); assembleSoon(); });
  all.source.addEventListener('scroll', updateNumbers);
  for (const event of ['click','keyup','select']) all.source.addEventListener(event, updateNumbers);
  all.source.addEventListener('keydown', ev => {
    if (ev.key === 'Tab') { ev.preventDefault(); const s = all.source.selectionStart, e = all.source.selectionEnd; all.source.setRangeText('  ',s,e,'end'); all.source.dispatchEvent(new Event('input')); }
  });
  document.addEventListener('keydown', ev => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 's') { ev.preventDefault(); save(); }
    if (mod && ev.key === 'Enter') { ev.preventDefault(); assembleSource(); }
    if (ev.target === all.source || ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT' || $('help-dialog').open) return;
    if (ev.key === 'ArrowRight') { ev.preventDefault(); if (cpu && !playback) { stepOnce(); renderCpu(); } }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); goBack(); }
    if (ev.key === ' ') { ev.preventDefault(); goPlay(); }
  });
  window.addEventListener('beforeunload', ev => { if (dirty) { ev.preventDefault(); ev.returnValue = ''; } });
  $('save').addEventListener('click', save);
  $('refresh').addEventListener('click', () => refreshCatalog());
  $('new-program').addEventListener('click', () => newProgram());
  $('copy-program').addEventListener('click', () => newProgram({copy:true}));
  all.group.addEventListener('change', async () => {
    if (!discardConfirm()) { all.group.value = selected?.group ?? '@examples'; return; }
    renderProgramOptions(null); await loadSelected();
  });
  all.program.addEventListener('change', async () => {
    if (!discardConfirm()) { all.program.value = selected?.file ?? ''; return; }
    await loadSelected();
  });
  for (const field of displayFields) $('display-'+field).addEventListener('input', displayInput);
  $('display-default').addEventListener('click', () => setDisplay(assembled?.display ?? DEFAULT_DISPLAY, false));
  for (const button of document.querySelectorAll('[data-panel]')) button.addEventListener('click', () => selectInspector(button.dataset.panel));
  $('reset').addEventListener('click', () => {
    stopPlayback(); if (assembled) { cpu = new MiniCPU(assembled.memory); frames = []; trace = []; renderCpu(); }
  });
  $('step').addEventListener('click', () => { stopPlayback(); stepOnce(); renderCpu(); });
  $('back').addEventListener('click', goBack);
  $('play').addEventListener('click', goPlay);
  $('instant').addEventListener('click', runToEnd);
  $('speed').addEventListener('input', () => { $('speed-label').textContent = $('speed').value; if (playback) { stopPlayback(); goPlay(); } });
  $('help').addEventListener('click', () => $('help-dialog').showModal());
  $('close-help').addEventListener('click', () => $('help-dialog').close());
}
function configureDisplayControls() {
  setDisplay(DEFAULT_DISPLAY);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitFrameBuffer).observe($('framebuffer-wrap'));
  else window.addEventListener('resize', fitFrameBuffer);
}
createMemory(); configureDisplayControls(); bind(); refreshCatalog({ force:true });
