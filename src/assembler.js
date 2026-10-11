import { architecture, architectureFromDirective, ARCHITECTURES } from './architectures.js';
import { INSTRUCTIONS, OPCODES as OP, availableOn } from './opcodes.js';
import { validateDisplay, MODES } from './display.js';
import { PALETTES } from './palettes.js';

/** MiniCPU two-pass assembler. No eval and no dependencies. */

export class AssemblyError extends Error {
  constructor(line, message) {
    super(line ? `Line ${line}: ${message}` : message);
    this.name = 'AssemblyError';
    this.line = line;
    this.detail = message;
  }
}
const fail = (line, message) => { throw new AssemblyError(line, message); };

const REGISTERS = Object.freeze({ A: 0, B: 1, C: 2, D: 3 });
const BYTE_REGISTERS = Object.freeze({ XL: 4, XH: 5, YL: 6, YH: 7 });
const SPECIAL = new Set(['X', 'Y', 'SP', 'PC', ...Object.keys(REGISTERS), ...Object.keys(BYTE_REGISTERS)]);

/** Every mnemonic the assembler accepts (used for syntax highlighting). */
export const MNEMONICS = Object.freeze([...new Set(INSTRUCTIONS.map(i => i.syntax.split(' ')[0]))]);
export const DIRECTIVES = Object.freeze(['.cpu', '.org', '.db', '.equ', '.display']);

const isRegister = token => Object.hasOwn(REGISTERS, token.trim().toUpperCase());
const bracketed = token => /^\[.*\]$/.test(token.trim());
const inner = token => token.trim().slice(1, -1).trim().toUpperCase();

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ';') return line.slice(0, i);
  }
  return line;
}

function splitOperands(value) {
  const parts = []; let token = '', quote = null, depth = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      token += c;
      if (c === '\\') token += value[++i] ?? '';
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
    const line = index + 1;
    let code = stripComment(raw).trim();
    if (!code) return [];
    let label = null;
    const labelled = code.match(/^([a-z_]\w*)\s*:\s*(.*)$/i);
    if (labelled) { label = labelled[1]; code = labelled[2].trim(); }
    if (!code) return [{ line, raw, label, type: 'label' }];
    const equ = code.match(/^([a-z_]\w*)\s+\.equ\b\s*(.*)$/i);
    if (equ) return [{ line, raw, label, type: 'equ', args: [equ[1], equ[2].trim()] }];
    const directive = code.match(/^\.(\w+)\b\s*(.*)$/);
    if (directive) return [{ line, raw, label, type: directive[1].toLowerCase(), args: splitOperands(directive[2]) }];
    if (/^\w+\s*:/.test(code)) fail(line, 'A label must start with a letter or _');
    const instruction = code.match(/^([a-z][a-z0-9]*)\b\s*(.*)$/i);
    if (instruction) return [{ line, raw, label, type: 'instruction', op: instruction[1].toUpperCase(), args: splitOperands(instruction[2]) }];
    return fail(line, `Cannot read “${code}”`);
  });
}

function decodeString(token, line) {
  if (!/^"(?:[^"\\]|\\.)*"$/.test(token)) fail(line, 'Unterminated string');
  const text = token.slice(1, -1).replace(/\\(.)/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', 0: '\0' })[c] ?? c);
  return Array.from(new TextEncoder().encode(text));
}

/** Integer expressions: numbers, 'c', labels, + - * / & | << >> and parentheses. */
function expression(input, symbols, line) {
  const s = (input ?? '').trim();
  if (!s) fail(line, 'Expected a value');
  const tokens = [];
  for (let i = 0; i < s.length;) {
    if (/\s/.test(s[i])) { i++; continue; }
    const rest = s.slice(i);
    const op = rest.match(/^(<<|>>|[-+*/&|()])/);
    if (op) { tokens.push(op[0]); i += op[0].length; continue; }
    const char = rest.match(/^'(\\?.)'/);
    if (char) { tokens.push({ value: char[1].replace(/^\\/, '').codePointAt(0) }); i += char[0].length; continue; }
    const word = rest.match(/^(0x[\da-f_]+|0b[01_]+|\d+|[a-z_]\w*)/i);
    if (!word) fail(line, `Unexpected “${rest}”`);
    tokens.push(word[0]); i += word[0].length;
  }
  let at = 0;
  const atom = () => {
    const tok = tokens[at++];
    if (tok === undefined) fail(line, 'Incomplete expression');
    if (tok === '(') {
      const value = binary(0);
      if (tokens[at++] !== ')') fail(line, 'Missing )');
      return value;
    }
    if (tok === '-') return -atom();
    if (tok === '+') return atom();
    if (typeof tok === 'object') return tok.value;
    if (/^0x/i.test(tok)) return parseInt(tok.slice(2).replaceAll('_', ''), 16);
    if (/^0b/i.test(tok)) return parseInt(tok.slice(2).replaceAll('_', ''), 2);
    if (/^\d+$/.test(tok)) return Number(tok);
    if (symbols.has(tok)) return symbols.get(tok);
    if (SPECIAL.has(tok.toUpperCase())) fail(line, `${tok.toUpperCase()} is a register and cannot be used here`);
    return fail(line, `Unknown label or constant “${tok}”`);
  };
  const LEVELS = [['|'], ['&'], ['<<', '>>'], ['+', '-'], ['*', '/']];
  const apply = (op, a, b) => ({
    '|': a | b, '&': a & b, '<<': a << b, '>>': a >> b, '+': a + b, '-': a - b, '*': a * b,
    '/': b === 0 ? fail(line, 'Division by zero') : Math.trunc(a / b),
  })[op];
  const binary = level => {
    if (level === LEVELS.length) return atom();
    let value = binary(level + 1);
    while (LEVELS[level].includes(tokens[at])) { const op = tokens[at++]; value = apply(op, value, binary(level + 1)); }
    return value;
  };
  const value = binary(0);
  if (at < tokens.length) fail(line, `Unexpected “${tokens[at]}”`);
  return value;
}

const ranged = (token, symbols, line, max, what) => {
  const v = expression(token, symbols, line);
  if (v < 0 || v > max) fail(line, `${what} ${v} is out of range (0..${max})`);
  return v;
};
const byteValue = (token, symbols, line) => {
  const v = expression(token, symbols, line);
  if (v < -128 || v > 255) fail(line, `${v} does not fit in a byte (0..255, or −128..−1)`);
  return v & 0xFF;
};

function register(token, line, arch, { bytes = false } = {}) {
  const name = (token ?? '').trim().toUpperCase();
  if (Object.hasOwn(REGISTERS, name)) return REGISTERS[name];
  if (Object.hasOwn(BYTE_REGISTERS, name)) {
    if (!arch.index) fail(line, `${name} is part of the pointer register ${name[0]}, which needs MiniCPU 8X`);
    if (!bytes) fail(line, `${name} can only be used with MOV`);
    return BYTE_REGISTERS[name];
  }
  if (name === 'X' || name === 'Y') fail(line, `${name} holds an address: use [${name}], LD${name}, INC${name} or MOV with ${name}L/${name}H`);
  return fail(line, `Expected a register (A, B, C or D), got “${token ?? ''}”`);
}

const LEVEL_NAME = { cpu8s: 'MiniCPU 8S or 8X', cpu8x: 'MiniCPU 8X' };

/**
 * Picks the instruction for a source line and checks its operands.
 * Returns {info, size, emit(put, symbols)}.
 */
function encode(node, arch) {
  const { op, args, line } = node;
  const count = n => {
    if (args.length !== n || args.some(a => !a)) fail(line, `${op} expects ${n === 0 ? 'no operands' : n === 1 ? 'one operand' : 'two operands'}`);
  };
  const need = name => {
    const info = INSTRUCTIONS.find(i => i.name === name);
    if (!availableOn(info, arch.id)) fail(line, `${info.syntax.replace(/ .*/, '')}${/^(LDA|STA)_(X|Y|SP)$/.test(name) ? ` with [${name.split('_')[1]}${name.endsWith('SP') ? '+n' : ''}]` : /_SP$/.test(name) ? ' SP' : ''} needs ${LEVEL_NAME[info.since]} (use .cpu ${info.since.slice(3)})`);
    return info;
  };
  const addrBytes = arch.addressBits / 8;
  const addr = (token, symbols, put) => {
    if (bracketed(token)) fail(line, `Brackets mean “address in a register”; write a fixed address without brackets`);
    const v = ranged(token, symbols, line, arch.memorySize - 1, 'Address');
    put(v & 0xFF);
    if (addrBytes === 2) put(v >> 8);
  };
  const simple = (name, form) => {
    const info = need(name);
    switch (form) {
      case 'none': count(0); return { info, size: 1, emit: put => put(info.code) };
      case 'r': count(1); { const r = register(args[0], line, arch); return { info, size: 2, emit: put => { put(info.code); put(r); } }; }
      case 'rr': count(2); {
        const d = register(args[0], line, arch), s = register(args[1], line, arch);
        return { info, size: 2, emit: put => { put(info.code); put((d << 4) | s); } };
      }
      case 'a': count(1); return { info, size: 1 + addrBytes, emit: (put, symbols) => { put(info.code); addr(args[0], symbols, put); } };
      case 'w': count(1); return {
        info, size: 3, emit: (put, symbols) => {
          const v = ranged(args[0], symbols, line, arch.memorySize - 1, 'Address');
          put(info.code); put(v & 0xFF); put(v >> 8);
        },
      };
      default: throw new Error(form);
    }
  };
  const stackOffset = token => token.trim().slice(1, -1).trim().match(/^SP\b\s*(?:\+(.*))?$/i);
  const pointer = token => {
    const name = inner(token);
    if (name === 'X' || name === 'Y') return name;
    if (Object.hasOwn(REGISTERS, name)) return 'R';
    return fail(line, `[${name}] is not a pointer: use [A]..[D], [SP+n], or [X]/[Y] on 8X`);
  };

  switch (op) {
    case 'NOP': case 'HLT': case 'CLF': case 'RET': case 'INCX': case 'DECX': case 'INCY': case 'DECY':
      return simple(op, 'none');
    case 'INC': case 'DEC': case 'SHL': case 'SHR': case 'PUSH': case 'POP':
      return simple(op, 'r');
    case 'ADD': case 'SUB':
      if (args[0]?.trim().toUpperCase() === 'SP') {
        count(2);
        const info = need(`${op}_SP`);
        return { info, size: 2, emit: (put, symbols) => { put(info.code); put(ranged(args[1], symbols, line, 255, 'Byte count')); } };
      }
      return simple(op, 'rr');
    case 'AND': case 'OR': case 'XOR':
      return simple(op, 'rr');
    case 'JMP': case 'JZ': case 'JNZ': case 'JC': case 'JNC': case 'CALL':
      return simple(op, 'a');
    case 'LDX': case 'LDY':
      return simple(op, 'w');
    case 'MOV': {
      count(2);
      const info = need('MOV');
      const d = register(args[0], line, arch, { bytes: true }), s = register(args[1], line, arch, { bytes: true });
      return { info, size: 2, emit: put => { put(info.code); put((d << 4) | s); } };
    }
    case 'LDI': {
      count(2);
      const info = need('LDI'), r = register(args[0], line, arch);
      return { info, size: 3, emit: (put, symbols) => { put(info.code); put(r); put(byteValue(args[1], symbols, line)); } };
    }
    case 'CMP': {
      count(2);
      if (isRegister(args[1])) return simple('CMP_R', 'rr');
      const info = need('CMP'), r = register(args[0], line, arch);
      return { info, size: 3, emit: (put, symbols) => { put(info.code); put(r); put(byteValue(args[1], symbols, line)); } };
    }
    case 'LDA': {
      count(2);
      const d = register(args[0], line, arch);
      if (bracketed(args[1]) && stackOffset(args[1])) {
        const info = need('LDA_SP'), offset = stackOffset(args[1])[1] ?? '0';
        return { info, size: 3, emit: (put, symbols) => { put(info.code); put(d); put(ranged(offset, symbols, line, 255, 'Offset')); } };
      }
      if (bracketed(args[1])) {
        const kind = pointer(args[1]);
        if (kind === 'R') {
          const info = need('LDA_R'), p = REGISTERS[inner(args[1])];
          return { info, size: 2, emit: put => { put(info.code); put((d << 4) | p); } };
        }
        const info = need(`LDA_${kind}`);
        return { info, size: 2, emit: put => { put(info.code); put(d); } };
      }
      const info = need('LDA');
      return { info, size: 2 + addrBytes, emit: (put, symbols) => { put(info.code); put(d); addr(args[1], symbols, put); } };
    }
    case 'STA': {
      count(2);
      const s = register(args[1], line, arch);
      if (bracketed(args[0]) && stackOffset(args[0])) {
        const info = need('STA_SP'), offset = stackOffset(args[0])[1] ?? '0';
        return { info, size: 3, emit: (put, symbols) => { put(info.code); put(ranged(offset, symbols, line, 255, 'Offset')); put(s); } };
      }
      if (bracketed(args[0])) {
        const kind = pointer(args[0]);
        if (kind === 'R') {
          const info = need('STA_R'), p = REGISTERS[inner(args[0])];
          return { info, size: 2, emit: put => { put(info.code); put((p << 4) | s); } };
        }
        const info = need(`STA_${kind}`);
        return { info, size: 2, emit: put => { put(info.code); put(s); } };
      }
      const info = need('STA');
      return { info, size: 2 + addrBytes, emit: (put, symbols) => { put(info.code); addr(args[0], symbols, put); put(s); } };
    }
    default:
      return fail(line, `Unknown instruction ${op}`);
  }
}

function chooseArchitecture(nodes, fallback) {
  const directives = nodes.filter(n => n.type === 'cpu');
  if (directives.length > 1) fail(directives[1].line, 'Only one .cpu directive is allowed');
  if (!directives.length) return { arch: architecture(fallback), line: null };
  const node = directives[0];
  const arch = node.args.length === 1 ? architectureFromDirective(node.args[0]) : null;
  if (!arch) fail(node.line, `.cpu expects ${Object.values(ARCHITECTURES).map(a => a.directive).join(', ')}`);
  return { arch, line: node.line };
}

/**
 * Assembles source text. The CPU level comes from a `.cpu` directive; without
 * one, `options.architecture` (default MiniCPU 8) is used.
 */
export function assemble(text, { architecture: fallback = 'cpu8' } = {}) {
  const nodes = parseSource(text);
  const { arch, line: cpuLine } = chooseArchitecture(nodes, fallback);
  const warnings = [];

  // Pass 1: addresses of labels and the size of every line.
  const symbols = new Map();
  let pc = 0;
  for (const node of nodes) {
    node.address = pc;
    if (node.label) {
      if (SPECIAL.has(node.label.toUpperCase())) fail(node.line, `${node.label} is a register name and cannot be a label`);
      if (symbols.has(node.label)) fail(node.line, `“${node.label}” is defined twice`);
      symbols.set(node.label, pc);
    }
    switch (node.type) {
      case 'label': case 'cpu': case 'display': break;
      case 'equ': {
        const [name, value] = node.args;
        if (node.args.length !== 2 || !/^[a-z_]\w*$/i.test(name ?? '')) fail(node.line, 'Write NAME .equ value');
        if (symbols.has(name)) fail(node.line, `“${name}” is defined twice`);
        if (SPECIAL.has(name.toUpperCase())) fail(node.line, `${name} is a register name`);
        symbols.set(name, expression(value, symbols, node.line));
        break;
      }
      case 'org':
        if (node.args.length !== 1) fail(node.line, '.org expects one address');
        pc = ranged(node.args[0], symbols, node.line, arch.memorySize - 1, 'Address');
        node.address = pc;
        break;
      case 'db':
        if (!node.args.length || node.args.some(a => !a)) fail(node.line, '.db expects one or more values');
        pc += node.args.reduce((n, a) => n + (a.startsWith('"') ? decodeString(a, node.line).length : 1), 0);
        break;
      case 'instruction':
        node.encoding = encode(node, arch);
        pc += node.encoding.size;
        break;
      default:
        fail(node.line, `Unknown directive .${node.type} (known: ${DIRECTIVES.join(', ')})`);
    }
    if (pc > arch.memorySize) fail(node.line, `The program does not fit into ${arch.memorySize} bytes of RAM`);
  }

  // Pass 2: bytes.
  const memory = new Uint8Array(arch.memorySize), occupied = new Uint8Array(arch.memorySize);
  const listing = [], sourceMap = new Map(), lineAddresses = new Map();
  for (const node of nodes) {
    if (node.type !== 'instruction' && node.type !== 'db') continue;
    let at = node.address;
    const put = value => {
      if (at >= arch.memorySize) fail(node.line, 'Write beyond the end of RAM');
      if (occupied[at]) fail(node.line, `Address 0x${at.toString(16).toUpperCase()} is already used by line ${sourceMap.get(at)}`);
      occupied[at] = 1; memory[at] = value; sourceMap.set(at, node.line); at++;
    };
    if (node.type === 'db') {
      for (const a of node.args) for (const v of a.startsWith('"') ? decodeString(a, node.line) : [byteValue(a, symbols, node.line)]) put(v);
    } else node.encoding.emit(put, symbols);
    listing.push({ address: node.address, size: at - node.address, line: node.line, source: node.raw.trim(), bytes: Array.from(memory.slice(node.address, at)) });
    lineAddresses.set(node.line, node.address);
  }

  // The .display directive only suggests how the screen should read RAM.
  const displays = nodes.filter(n => n.type === 'display');
  if (displays.length > 1) fail(displays[1].line, 'Only one .display directive is allowed');
  let display = null;
  if (displays.length) {
    const node = displays[0];
    if (![4, 5].includes(node.args.length)) fail(node.line, '.display expects start, width, height, format [, palette]');
    const [start, width, height, mode, palette] = node.args;
    display = {
      start: expression(start, symbols, node.line),
      width: expression(width, symbols, node.line),
      height: expression(height, symbols, node.line),
      mode: mode.toLowerCase(),
      palette: palette?.toLowerCase() ?? null,
    };
    const spec = MODES[display.mode];
    if (!spec) fail(node.line, `Unknown pixel format ${mode} (known: ${Object.keys(MODES).join(', ')})`);
    if (spec.indexed && !palette) fail(node.line, `${display.mode} needs a palette with ${2 ** spec.bits} colors`);
    if (!spec.indexed && palette) fail(node.line, `${display.mode} does not use a palette`);
    if (spec.indexed && PALETTES[display.palette]?.length !== 2 ** spec.bits) {
      const fitting = Object.keys(PALETTES).filter(k => PALETTES[k].length === 2 ** spec.bits);
      fail(node.line, `Palette ${display.palette} is not a ${2 ** spec.bits}-color palette (try ${fitting.join(', ')})`);
    }
    try { validateDisplay(display, arch.memorySize); } catch (error) { fail(node.line, error.message); }
    const end = validateDisplay(display, arch.memorySize).endExclusive;
    if (occupied.slice(display.start, end).some(Boolean)) warnings.push({ line: node.line, message: 'The screen shows bytes of the program itself.' });
  }

  return {
    architecture: arch.id, cpuLine, memory, occupied, display, listing, sourceMap, lineAddresses,
    labels: symbols, warnings, loadedBytes: occupied.reduce((a, b) => a + b, 0),
  };
}
