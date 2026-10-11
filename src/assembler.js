import { architecture } from './architectures.js';
import { OPCODES as OP } from './opcodes.js';
import { validateDisplay, MODES } from './display.js';
import { PALETTES } from './palettes.js';
/** MiniCPU two-pass assembler. No eval, no external dependencies. */
const REGISTERS = Object.freeze({ A: 0, B: 1, C: 2, D: 3, R0: 0, R1: 1, R2: 2, R3: 3 });
const FORMS = Object.freeze({
  LDI: ['ri', OP.LDI], LDA: ['load', OP.LDA_DIRECT], STA: ['store', OP.STA_DIRECT],
  MOV: ['rr', OP.MOV],
  ADD: ['rr', OP.ADD], SUB: ['rr', OP.SUB],
  INC: ['r', OP.INC], DEC: ['r', OP.DEC], SHL: ['r', OP.SHL], SHR: ['r', OP.SHR],
  AND: ['rr', OP.AND], OR: ['rr', OP.OR], XOR: ['rr', OP.XOR],
  CMP: ['cmp', OP.CMP_IMM],
  JZ: ['address', OP.JZ], JNZ: ['address', OP.JNZ],
  JC: ['address', OP.JC], JNC: ['address', OP.JNC], JMP: ['address', OP.JMP],
  CLF: ['none', OP.CLF], NOP: ['none', OP.NOP], HLT: ['none', OP.HLT],
  PUSH: ['r', OP.PUSH], POP: ['r', OP.POP], CALL: ['address', OP.CALL], RET: ['none', OP.RET],
  LDX: ['word', OP.LDX], INCX: ['none', OP.INCX], DECX: ['none', OP.DECX],
  JMP16: ['word', OP.JMP16], JZ16: ['word', OP.JZ16], JNZ16: ['word', OP.JNZ16],
  JC16: ['word', OP.JC16], JNC16: ['word', OP.JNC16], CALL16: ['word', OP.CALL16],
});
export const MNEMONICS = Object.freeze(Object.keys(FORMS));

export class AssemblyError extends Error {
  constructor(line, message) {
    super(`Line ${line}: ${message}`);
    this.name = 'AssemblyError';
    this.line = line;
  }
}
const fail = (line, message) => { throw new AssemblyError(line, message); };
const register = value => Object.hasOwn(REGISTERS, (value ?? '').trim().toUpperCase());
const reg = (token, line) => {
  const r = REGISTERS[(token ?? '').trim().toUpperCase()];
  return r === undefined ? fail(line, `Unknown register ${token ?? '(missing)'}`) : r;
};
const bracketed = token => /^\[.*\]$/.test((token ?? '').trim());
const inner = token => token.trim().slice(1, -1).trim();

function stripComment(line) {
  let quote = null, escaped = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ';' || c === '#') return line.slice(0, i);
  }
  return line;
}
function splitOperands(value) {
  const parts = []; let token = '', quote = null, escaped = false, depth = 0;
  for (const c of value.trim()) {
    if (quote) {
      token += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") { quote = c; token += c; }
    else if (c === '(' || c === '[') { depth++; token += c; }
    else if (c === ')' || c === ']') { depth--; token += c; }
    else if (c === ',' && depth === 0) { parts.push(token.trim()); token = ''; }
    else token += c;
  }
  if (token.trim() || parts.length) parts.push(token.trim());
  return parts;
}
function parseSource(text) {
  return text.split(/\r?\n/).flatMap((raw, index) => {
    let code = stripComment(raw).trim();
    if (!code) return [];
    let label = null;
    const labelled = code.match(/^([a-z_]\w*)\s*:\s*(.*)$/i);
    if (labelled) { label = labelled[1]; code = labelled[2].trim(); }
    if (!code) return [{ line: index + 1, raw, label, type: 'label' }];
    const oldEqu = code.match(/^([a-z_]\w*)\s+\.equ\b\s*(.*)$/i);
    if (oldEqu) return [{ line: index + 1, raw, label, type: 'equ', args: [oldEqu[1], ...splitOperands(oldEqu[2])] }];
    const directive = code.match(/^\.(\w+)\b\s*(.*)$/i);
    if (directive) return [{ line: index + 1, raw, label, type: directive[1].toLowerCase(), args: splitOperands(directive[2]) }];
    const instruction = code.match(/^([a-z][a-z0-9]*)\b\s*(.*)$/i);
    if (instruction) return [{ line: index + 1, raw, label, type: 'instruction', op: instruction[1].toUpperCase(), args: splitOperands(instruction[2]) }];
    return fail(index + 1, `Cannot parse: ${code}`);
  });
}
function decodeString(token, line) {
  if (!/^"(?:[^"\\]|\\.)*"$/.test(token)) fail(line, 'Invalid or unterminated string literal');
  const s = token.slice(1, -1).replace(/\\(n|r|t|"|\\)/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[c]);
  return Array.from(new TextEncoder().encode(s));
}
const isString = token => token.trim().startsWith('"');
function expression(input, symbols, line) {
  const source = (input ?? '').trim();
  if (!source) fail(line, 'Expected an expression');
  // Brackets around numeric addresses are allowed for compatibility.
  const s = bracketed(source) && !register(inner(source)) ? inner(source) : source;
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    if (/[()+-]/.test(s[i])) { tokens.push(s[i++]); continue; }
    const remainder = s.slice(i);
    if (remainder.startsWith("'")) {
      const m = remainder.match(/^'([^'\\])'/);
      if (!m) fail(line, 'Character literals must contain one character');
      tokens.push({ value: m[1].codePointAt(0) }); i += m[0].length; continue;
    }
    if (remainder.startsWith('"')) {
      const m = remainder.match(/^"(?:[^"\\]|\\.)*"/);
      if (!m) fail(line, 'Unterminated string literal');
      const bytes = decodeString(m[0], line);
      if (bytes.length !== 1) fail(line, 'Byte expression requires a one-byte string');
      tokens.push({ value: bytes[0] }); i += m[0].length; continue;
    }
    const m = remainder.match(/^(0x[\da-f]+|0b[01_]+|\d+|[a-z_]\w*)/i);
    if (!m) fail(line, `Unexpected expression token near "${remainder}"`);
    tokens.push(m[0]); i += m[0].length;
  }
  let at = 0;
  const atom = () => {
    const tok = tokens[at++];
    if (tok === undefined) fail(line, 'Unexpected end of expression');
    if (tok === '(') {
      const value = sum();
      if (tokens[at++] !== ')') fail(line, 'Missing closing parenthesis');
      return value;
    }
    if (typeof tok === 'object') return tok.value;
    if (/^0x/i.test(tok)) return parseInt(tok.slice(2), 16);
    if (/^0b/i.test(tok)) return parseInt(tok.slice(2).replaceAll('_', ''), 2);
    if (/^\d+$/.test(tok)) return Number(tok);
    if (!symbols.has(tok)) fail(line, `Unknown label or constant: ${tok}`);
    return symbols.get(tok);
  };
  const signed = () => {
    let sign = 1;
    while (tokens[at] === '+' || tokens[at] === '-') if (tokens[at++] === '-') sign *= -1;
    return sign * atom();
  };
  const sum = () => {
    let v = signed();
    while (tokens[at] === '+' || tokens[at] === '-') {
      const operator = tokens[at++]; v += (operator === '+' ? 1 : -1) * signed();
    }
    return v;
  };
  const value = sum();
  if (at < tokens.length) fail(line, `Unexpected token: ${tokens[at]}`);
  if (!Number.isSafeInteger(value)) fail(line, 'Expression is not a valid integer');
  return value;
}
const bounded = (token, symbols, line, upper, label) => {
  const v = expression(token, symbols, line);
  if (v < 0 || v > upper) fail(line, `${label} out of range: ${v} (expected 0..${upper})`);
  return v;
};
const byte = (token, symbols, line) => {
  const v = expression(token, symbols, line);
  if (v < 0 || v > 255) fail(line, `Byte out of range: ${v} (expected 0..255)`);
  return v;
};
const STACK_OPS = new Set(['PUSH','POP','CALL','RET']);
const EXT_OPS = new Set(['LDX','INCX','DECX','JMP16','JZ16','JNZ16','JC16','JNC16','CALL16']);
function supported(node, arch) {
  if (STACK_OPS.has(node.op) && !arch.stack) fail(node.line, `${node.op} requires MiniCPU 8S or 8X`);
  if (EXT_OPS.has(node.op) && !arch.index) fail(node.line, `${node.op} requires MiniCPU 8X`);
  if (node.op === 'LDA' && node.args?.[1]?.trim().toUpperCase() === '[X]' && !arch.index) fail(node.line, 'Address register X requires MiniCPU 8X');
  if (node.op === 'STA' && node.args?.[0]?.trim().toUpperCase() === '[X]' && !arch.index) fail(node.line, 'Address register X requires MiniCPU 8X');
}
function expected(node, count) {
  if (node.args.length !== count || node.args.some(s => !s)) fail(node.line, `${node.op ?? '.' + node.type} expects ${count} operand(s), got ${node.args.length}`);
}
function sizeOf(node, arch) {
  if (node.type !== 'instruction') return 0;
  const form = FORMS[node.op]?.[0];
  if (!form) fail(node.line, `Unknown instruction: ${node.op}`);
  supported(node, arch);
  expected(node, form === 'none' ? 0 : ['r', 'address', 'word'].includes(form) ? 1 : 2);
  if (form === 'none') return 1;
  if (form === 'word') return 3;
  if (form === 'r' || form === 'rr' || form === 'address') return 2;
  if (form === 'cmp') return register(node.args[1]) ? 2 : 3;
  if (form === 'load') return bracketed(node.args[1]) && (register(inner(node.args[1])) || inner(node.args[1]).toUpperCase()==='X') ? 2 : 3;
  if (form === 'store') return bracketed(node.args[0]) && (register(inner(node.args[0])) || inner(node.args[0]).toUpperCase()==='X') ? 2 : 3;
  return 3;
}

/** @returns {{memory:Uint8Array,bytes:Uint8Array,listing:Array,sourceMap:Map,labels:Map,diagnostics:Array,loadedBytes:number}} */
export function assemble(text, { architecture: architectureId = 'cpu8' } = {}) {
  const arch = architecture(architectureId);
  const nodes = parseSource(text);
  const symbols = new Map();
  const diagnostics = [];
  let pc = 0;
  for (const node of nodes) {
    if (node.label) {
      if (symbols.has(node.label)) fail(node.line, `Duplicate symbol: ${node.label}`);
      symbols.set(node.label, pc);
    }
    if (node.type === 'equ') {
      expected({ ...node, op: '.equ' }, 2);
      const [name, value] = node.args;
      if (!/^[a-z_]\w*$/i.test(name) || symbols.has(name)) fail(node.line, `Invalid or duplicate constant: ${name}`);
      symbols.set(name, bounded(value, symbols, node.line, arch.memorySize - 1, 'Constant'));
    } else if (node.type === 'org') {
      expected({ ...node, op: '.org' }, 1);
      pc = bounded(node.args[0], symbols, node.line, arch.memorySize - 1, 'Origin');
    } else if (node.type === 'display') {
      // Visualization metadata: no bytes, no effect on the CPU. Parsed after labels are known.
      if (![4, 5].includes(node.args.length)) fail(node.line, '.display needs start, width, height, mode [, palette]');
    } else if (node.type === 'db' || node.type === 'byte') {
      if (!node.args.length || node.args.some(s => !s)) fail(node.line, '.db needs one or more values');
      pc += node.args.reduce((n, s) => n + (isString(s) ? decodeString(s, node.line).length : 1), 0);
    } else if (node.type === 'instruction') {
      pc += sizeOf(node, arch);
    } else if (!['label'].includes(node.type)) fail(node.line, `Unknown directive: .${node.type}`);
    if (pc > arch.memorySize) fail(node.line, `Program exceeds the ${arch.memorySize}-byte address space`);
  }
  let display = null;
  for (const node of nodes.filter(n => n.type === 'display')) {
    if (display) fail(node.line, 'Only one .display directive is allowed');
    const [start, width, height, mode, palette] = node.args;
    display = {
      start: bounded(start, symbols, node.line, arch.memorySize - 1, 'Display start'),
      width: expression(width, symbols, node.line),
      height: expression(height, symbols, node.line),
      mode: mode.toLowerCase(),
      palette: palette?.toLowerCase() ?? null,
    };
    try {
      validateDisplay(display, arch.memorySize);
      const indexed = MODES[display.mode].indexed;
      if (indexed && !palette) fail(node.line, `Mode ${display.mode} requires a palette`);
      if (!indexed && palette) fail(node.line, `Mode ${display.mode} does not use a palette`);
      if (indexed && (!Object.hasOwn(PALETTES, display.palette) || PALETTES[display.palette].length !== 2 ** MODES[display.mode].bits))
        fail(node.line, `Palette ${display.palette} must contain exactly ${2 ** MODES[display.mode].bits} colors for ${display.mode}`);
    } catch (error) {
      if (error instanceof AssemblyError) throw error;
      fail(node.line, error.message);
    }
  }
  const memory = new Uint8Array(arch.memorySize), used = new Uint8Array(arch.memorySize);
  const listing = [], sourceMap = new Map();
  pc = 0;
  const put = (value, node) => {
    if (pc >= arch.memorySize) fail(node.line, `Write beyond RAM at 0x${pc.toString(16).toUpperCase()}`);
    if (used[pc]) fail(node.line, `Overlapping code or data at 0x${pc.toString(16).padStart(2, '0').toUpperCase()}`);
    used[pc] = 1; memory[pc++] = value;
  };
  const addrValue = (token, node) => {
    const val = bracketed(token) ? inner(token) : token;
    if (bracketed(token) && /^\d+$/.test(val)) diagnostics.push({ line: node.line, severity: 'warning', message: `Address [${val}] is decimal; hex notation may be clearer.` });
    return byte(val, symbols, node.line);
  };
  for (const node of nodes) {
    if (node.type === 'org') { pc = bounded(node.args[0], symbols, node.line, arch.memorySize - 1, 'Origin'); continue; }
    if (['equ', 'label', 'display'].includes(node.type)) continue;
    const start = pc;
    if (node.type === 'db' || node.type === 'byte') {
      for (const s of node.args) for (const v of isString(s) ? decodeString(s, node.line) : [byte(s, symbols, node.line)]) put(v, node);
    } else {
      const [form, op] = FORMS[node.op];
      const a = node.args;
      const rr = (left, right) => (reg(left, node.line) << 4) | reg(right, node.line);
      if (form === 'none') put(op, node);
      else if (form === 'word') {
        const v = bounded(a[0], symbols, node.line, 65535, '16-bit operand');
        if (v >= arch.memorySize) fail(node.line, `Address 0x${v.toString(16).toUpperCase()} is outside installed RAM`);
        put(op, node); put(v & 255, node); put(v >> 8, node);
      }
      else if (form === 'r') { put(op, node); put(reg(a[0], node.line), node); }
      else if (form === 'ri') { put(op, node); put(reg(a[0], node.line), node); put(byte(a[1], symbols, node.line), node); }
      else if (form === 'rr') { put(op, node); put(rr(a[0], a[1]), node); }
      else if (form === 'address') { put(op, node); put(byte(a[0], symbols, node.line), node); }
      else if (form === 'cmp') {
        if (register(a[1])) { put(OP.CMP_REG, node); put(rr(a[0], a[1]), node); }
        else { put(OP.CMP_IMM, node); put(reg(a[0], node.line), node); put(byte(a[1], symbols, node.line), node); }
      } else if (form === 'load') {
        if (bracketed(a[1]) && inner(a[1]).toUpperCase() === 'X') { put(OP.LDA_X,node); put(reg(a[0],node.line),node); }
        else if (bracketed(a[1]) && register(inner(a[1]))) { put(OP.LDA_INDIRECT, node); put(rr(a[0], inner(a[1])), node); }
        else { put(OP.LDA_DIRECT, node); put(reg(a[0], node.line), node); put(addrValue(a[1], node), node); }
      } else if (form === 'store') {
        if (bracketed(a[0]) && inner(a[0]).toUpperCase() === 'X') { put(OP.STA_X,node); put(reg(a[1],node.line),node); }
        else if (bracketed(a[0]) && register(inner(a[0]))) { put(OP.STA_INDIRECT, node); put(rr(inner(a[0]), a[1]), node); }
        else { put(OP.STA_DIRECT, node); put(addrValue(a[0], node), node); put(reg(a[1], node.line), node); }
      }
    }
    if (pc !== start) {
      const item = { address: start, size: pc - start, line: node.line, source: node.raw.trim(), bytes: Array.from(memory.slice(start, pc)) };
      listing.push(item);
      for (let address = start; address < pc; address++) sourceMap.set(address, node.line);
    }
  }
  const last = used.lastIndexOf(1);
  // The display controller is independent of CPU memory; code and graphics may overlap.
  // Warn about assembled bytes intersecting the suggested display range.
  if (display) {
    const rowBytes = Math.ceil(display.width * MODES[display.mode].bits / 8);
    const overlaps = used.slice(display.start, display.start + display.height * rowBytes).some(Boolean);
    if (overlaps) diagnostics.push({line:0,severity:'warning',message:'Display mapping overlaps assembled code/data. RAM is shared; stores can change machine code.'});
  }
  if (!listing.length) diagnostics.push({ line: 0, severity: 'warning', message: 'No program bytes assembled.' });
  return { architecture: arch.id, memory, occupied: used, display, bytes: memory.slice(0, last + 1), listing, sourceMap, labels: symbols, diagnostics, loadedBytes: used.reduce((a, b) => a + b, 0) };
}
