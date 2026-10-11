/**
 * Formats MiniCPU assembly in the style of the examples:
 *
 *   NAME    .equ 16                 constants in a block share one column
 *   label:  LDI A, [0x70]           label, then the instruction at column 8
 *           ADD A, B                ; comments after code at column 32
 *   ; a comment on its own line keeps column 0 or the code column
 *
 * Mnemonics and register names become upper case, directives lower case,
 * operands are separated by ", ". Labels, expressions, .db data and comment
 * texts are kept as written. Every line stays on its line, so the result can
 * be applied line by line (breakpoints and undo survive).
 */
import { MNEMONICS } from './assembler.js';
import { REG } from './opcodes.js';

const CODE = 8, COMMENT = 32;
const MNEMONIC_SET = new Set(MNEMONICS);
const REGISTERS = new Set([...Object.keys(REG), 'SP']);
const TOP_LEVEL = new Set(['.cpu', '.display', '.org']);

/** Index of the ';' that starts the comment, or -1 (ignores ';' in quotes). */
function commentStart(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ';') return i;
  }
  return -1;
}

/** Splits operands at commas outside quotes. */
function splitOperands(text) {
  const parts = [];
  let quote = null, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ',') { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map(part => part.trim());
}

function operand(text) {
  if (REGISTERS.has(text.toUpperCase())) return text.toUpperCase();
  const memory = text.match(/^\[\s*(.*?)\s*\]$/);
  if (!memory) return text;
  const inner = memory[1];
  if (REGISTERS.has(inner.toUpperCase())) return `[${inner.toUpperCase()}]`;
  const stack = inner.match(/^sp\s*\+\s*(.+)$/i);
  if (stack) return `[SP+${stack[1]}]`;
  return `[${inner}]`;
}

function statement(text) {
  const match = text.match(/^(\.?[A-Za-z_]\w*)\s*(.*)$/);
  if (!match) return text;
  let [, op, rest] = match;
  if (op.startsWith('.')) op = op.toLowerCase();
  else if (MNEMONIC_SET.has(op.toUpperCase())) op = op.toUpperCase();
  else return text;
  if (!rest) return op;
  if (op === '.db') return `${op} ${rest.trim()}`; // data keeps its own grouping
  const operands = op.startsWith('.') ? splitOperands(rest) : splitOperands(rest).map(operand);
  return `${op} ${operands.join(', ')}`;
}

function withComment(code, comment) {
  if (comment === null) return code;
  if (!code) return comment;
  const column = code.length + 2 <= COMMENT ? COMMENT : Math.ceil((code.length + 2) / 4) * 4;
  return code.padEnd(column) + comment;
}

/** Parses one line into {kind, …}; formatting happens in formatSource. */
function parse(line) {
  line = line.replace(/\t/g, '        ').replace(/\s+$/, '');
  const at = commentStart(line);
  const comment = at < 0 ? null : line.slice(at);
  const code = (at < 0 ? line : line.slice(0, at)).trimEnd();
  if (!code.trim()) {
    if (comment === null) return { kind: 'blank' };
    return { kind: 'comment', text: (at === 0 ? '' : ' '.repeat(CODE)) + comment };
  }
  const equ = code.match(/^\s*([A-Za-z_]\w*)\s+\.equ\b\s*(.*)$/i);
  if (equ) return { kind: 'equ', name: equ[1], value: equ[2].trim(), comment };
  const label = code.match(/^\s*([A-Za-z_]\w*)\s*:\s*(.*)$/);
  if (label) return { kind: 'code', label: label[1], body: label[2] ? statement(label[2]) : '', comment };
  const body = statement(code.trim());
  return { kind: 'code', label: null, body, top: TOP_LEVEL.has(body.split(' ')[0]), comment };
}

/** Returns the formatted text; the number of lines never changes. */
export function formatSource(text) {
  const lines = text.split('\n').map(parse);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.kind === 'blank') out.push('');
    else if (line.kind === 'comment') out.push(line.text);
    else if (line.kind === 'equ') {
      let end = i;
      while (end + 1 < lines.length && lines[end + 1].kind === 'equ') end++;
      const width = Math.max(CODE, ...lines.slice(i, end + 1).map(l => l.name.length + 1));
      for (let k = i; k <= end; k++) {
        const { name, value, comment } = lines[k];
        out.push(withComment(`${name.padEnd(width)}.equ ${value}`.trimEnd(), comment));
      }
      i = end;
    } else if (line.label !== null && line.body) {
      // Labels with code or data on the same line; a run of them (a table of
      // variables, say) shares one column.
      let end = i;
      while (end + 1 < lines.length && lines[end + 1].kind === 'code' && lines[end + 1].label !== null && lines[end + 1].body) end++;
      const width = Math.max(CODE, ...lines.slice(i, end + 1).map(l => l.label.length + 2));
      for (let k = i; k <= end; k++) out.push(withComment(`${lines[k].label}:`.padEnd(width) + lines[k].body, lines[k].comment));
      i = end;
    } else {
      const code = line.label !== null ? `${line.label}:` : (line.top ? '' : ' '.repeat(CODE)) + line.body;
      out.push(withComment(code, line.comment));
    }
  }
  return out.join('\n');
}
