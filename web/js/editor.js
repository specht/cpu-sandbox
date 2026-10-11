// The source editor: bundled CodeMirror with MiniCPU syntax colors, the
// address and bytes of every line in the margin, breakpoints, and the line
// of the next instruction.
import { MNEMONICS } from '/src/assembler.js';
import { hex } from '/src/cpu.js';
import { el } from './util.js';

const MNEMONIC_SET = new Set(MNEMONICS);
const REGISTER_SET = new Set(['A', 'B', 'C', 'D', 'X', 'Y', 'XL', 'XH', 'YL', 'YH']);

CodeMirror.defineMode('minicpu', () => ({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.peek() === ';') { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^'(?:\\.|[^'])'/)) return 'string';
    if (stream.match(/^\.[a-z]+/i)) return 'meta';
    if (stream.match(/^(?:0x[\da-f_]+|0b[01_]+|\d+)/i)) return 'number';
    if (stream.match(/^[a-z_]\w*(?=\s*:)/i)) return 'def';
    const word = stream.match(/^[a-z_]\w*/i);
    if (word) {
      const upper = word[0].toUpperCase();
      if (MNEMONIC_SET.has(upper)) return 'keyword';
      if (REGISTER_SET.has(upper)) return 'variable-2';
      return 'variable';
    }
    if (stream.match(/^[[\]]/)) return 'bracket';
    stream.next();
    return null;
  },
  lineComment: ';',
}));

const MAX_SHOWN_BYTES = 4;

export class SourceEditor {
  constructor(container, { onChange, onSave, onBreakpoints }) {
    this.container = container;
    this.onChange = onChange;
    this.onBreakpoints = onBreakpoints;
    this.suppress = false;
    this.executionLine = null;
    this.problemLines = [];
    this.marks = [];
    this.byteMarkers = [];
    this.editor = CodeMirror(container, {
      value: '', mode: 'minicpu', lineNumbers: true, lineWrapping: false,
      gutters: ['cm-breakpoints', 'CodeMirror-linenumbers', 'cm-bytes'],
      indentUnit: 8, tabSize: 8, indentWithTabs: false, readOnly: 'nocursor', viewportMargin: 30,
      extraKeys: {
        'Ctrl-S': () => onSave(), 'Cmd-S': () => onSave(),
        'Ctrl-/': cm => this.toggleComment(cm), 'Cmd-/': cm => this.toggleComment(cm),
        'Ctrl-#': cm => this.toggleComment(cm), 'Ctrl-Shift-7': cm => this.toggleComment(cm),
        'Ctrl-Shift-K': cm => cm.execCommand('deleteLine'), 'Cmd-Shift-K': cm => cm.execCommand('deleteLine'),
        Tab: cm => (cm.somethingSelected() ? cm.indentSelection('add') : cm.execCommand('insertSoftTab')),
        'Shift-Tab': cm => cm.indentSelection('subtract'),
      },
    });
    this.editor.on('change', () => { if (!this.suppress) onChange(); });
    this.editor.on('gutterClick', (cm, line, gutter) => {
      if (gutter === 'cm-bytes') return;
      this.toggleBreakpoint(line);
    });
  }

  get value() { return this.editor.getValue(); }

  /** Replaces the whole text (a newly loaded file). */
  load(text, { editable = true } = {}) {
    this.suppress = true;
    this.editor.setValue(text);
    this.editor.clearHistory();
    this.suppress = false;
    this.executionLine = null;
    this.editor.setOption('readOnly', editable ? false : 'nocursor');
    this.container.classList.toggle('is-editing', editable);
    this.container.classList.remove('source-empty');
    this.editor.setOption('lineNumbers', true);
    this.editor.refresh();
  }

  placeholder(text) {
    this.load(text, { editable: false });
    this.container.classList.add('source-empty');
    this.editor.setOption('lineNumbers', false);
  }

  /** Replaces text in one edit (keeps undo history), e.g. for the .cpu line. */
  replaceAll(text) {
    const cursor = this.editor.getCursor(), last = this.editor.lastLine();
    this.editor.replaceRange(text, { line: 0, ch: 0 }, { line: last, ch: this.editor.getLine(last).length }, '+cpu');
    this.editor.setCursor(cursor);
  }

  toggleComment(cm) {
    if (cm.getOption('readOnly')) return;
    const from = cm.getCursor('from'), to = cm.getCursor('to');
    const last = to.line > from.line && to.ch === 0 ? to.line - 1 : to.line;
    const lines = [];
    for (let line = from.line; line <= last; line++) if (cm.getLine(line).trim()) lines.push(line);
    if (!lines.length) return;
    const uncomment = lines.every(line => /^\s*;/.test(cm.getLine(line)));
    cm.operation(() => {
      for (const line of lines) {
        const text = cm.getLine(line), indent = text.match(/^\s*/)[0].length;
        if (uncomment) cm.replaceRange('', { line, ch: indent }, { line, ch: indent + (text.slice(indent).startsWith('; ') ? 2 : 1) });
        else cm.replaceRange('; ', { line, ch: indent });
      }
    });
  }

  // ------------------------------------------------------------ breakpoints

  toggleBreakpoint(line) {
    const info = this.editor.lineInfo(line);
    const on = !info.gutterMarkers?.['cm-breakpoints'];
    this.editor.setGutterMarker(line, 'cm-breakpoints', on ? el('span', { class: 'breakpoint', title: 'Breakpoint' }) : null);
    this.onBreakpoints();
  }

  /** 1-based line numbers that carry a breakpoint. */
  breakpoints() {
    const lines = [];
    this.editor.eachLine(handle => {
      if (handle.gutterMarkers?.['cm-breakpoints']) lines.push(this.editor.getLineNumber(handle) + 1);
    });
    return lines;
  }

  clearBreakpoints() { this.editor.clearGutter('cm-breakpoints'); }

  // ------------------------------------------------------------ machine code

  /** Shows the address and bytes of every assembled line in the margin. */
  showListing(listing, addressDigits) {
    this.editor.clearGutter('cm-bytes');
    this.byteMarkers = [];
    if (!listing) return;
    const widest = Math.max(1, ...listing.map(entry => entry.size));
    const columns = addressDigits + 1 + Math.min(widest, MAX_SHOWN_BYTES) * 3 + (widest > MAX_SHOWN_BYTES ? 2 : 0);
    const width = `calc(${(columns * 11 / 13).toFixed(2)}ch + 24px)`; // marker text is 11px, the gutter 13px
    if (this.container.style.getPropertyValue('--bytes-width') !== width) {
      this.container.style.setProperty('--bytes-width', width);
      requestAnimationFrame(() => this.editor.refresh());
    }
    this.editor.operation(() => {
      for (const entry of listing) {
        const bytes = el('span', { class: 'asm-bytes-values' });
        const marker = el('span', { class: 'asm-bytes' }, el('span', { class: 'asm-address' }, hex(entry.address, addressDigits)), bytes);
        this.byteMarkers.push({ entry, marker, bytes, modified: null });
        this.editor.setGutterMarker(entry.line - 1, 'cm-bytes', marker);
      }
    });
    this.updateBytes(null);
  }

  /** Shows the current RAM bytes; bytes changed by the program are marked. */
  updateBytes(memory) {
    for (const item of this.byteMarkers) {
      const { entry } = item;
      let modified = false;
      if (memory) for (let i = 0; i < entry.size; i++) if (memory[entry.address + i] !== entry.bytes[i]) { modified = true; break; }
      if (modified === item.modified && !modified) continue;
      const values = memory && modified ? Array.from(memory.subarray(entry.address, entry.address + entry.size)) : entry.bytes;
      const shown = values.slice(0, MAX_SHOWN_BYTES).map(v => hex(v)).join(' ') + (values.length > MAX_SHOWN_BYTES ? ' …' : '');
      if (item.bytes.textContent !== shown) item.bytes.textContent = shown;
      if (modified !== item.modified) {
        item.marker.classList.toggle('modified', modified);
        item.marker.title = modified
          ? `Changed by the program. Assembled as ${entry.bytes.map(v => hex(v)).join(' ')}`
          : `${entry.size} byte${entry.size === 1 ? '' : 's'} at 0x${hex(entry.address, 4)}: ${entry.bytes.map(v => hex(v)).join(' ')}`;
        item.modified = modified;
      }
    }
  }

  // ------------------------------------------------------------ highlighting

  /** Highlights the line of the next instruction (null clears it). */
  highlight(line, { scroll = true, kind = 'source-execution-line' } = {}) {
    if (this.executionLine !== null) {
      this.editor.removeLineClass(this.executionLine.line, 'background', this.executionLine.kind);
      this.executionLine = null;
    }
    if (!Number.isInteger(line) || line < 1 || line > this.editor.lineCount()) return;
    this.executionLine = { line: line - 1, kind };
    this.editor.addLineClass(line - 1, 'background', kind);
    if (scroll) this.scrollTo(line - 1);
  }

  scrollTo(line) {
    const info = this.editor.getScrollInfo();
    const top = this.editor.heightAtLine(line, 'local');
    if (top < info.top + 20 || top > info.top + info.clientHeight - 40) this.editor.scrollTo(null, Math.max(0, top - info.clientHeight / 3));
  }

  jumpTo(line) {
    if (!Number.isInteger(line) || line < 1 || line > this.editor.lineCount()) return;
    this.editor.setCursor({ line: line - 1, ch: 0 });
    this.scrollTo(line - 1);
    this.editor.focus();
  }

  /** Marks problem lines: [{line, message, severity: 'error'|'warning'}]. */
  markProblems(problems) {
    for (const { line, kind } of this.problemLines) this.editor.removeLineClass(line, 'background', kind);
    for (const mark of this.marks) mark.clear();
    this.problemLines = []; this.marks = [];
    for (const problem of problems) {
      if (!problem.line || problem.line > this.editor.lineCount()) continue;
      const line = problem.line - 1, kind = problem.severity === 'error' ? 'source-error-line' : 'source-warning-line';
      this.editor.addLineClass(line, 'background', kind);
      this.problemLines.push({ line, kind });
      const text = this.editor.getLine(line), code = text.replace(/;.*/, '');
      const start = code.length - code.trimStart().length, end = code.trimEnd().length;
      if (problem.severity === 'error' && end > start) {
        this.marks.push(this.editor.markText({ line, ch: start }, { line, ch: end }, { className: 'source-error-underline', title: problem.message }));
      }
    }
  }

  refresh() { this.editor.refresh(); }
}
