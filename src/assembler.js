import { architecture, architectureFromDirective, ARCHITECTURES } from './architectures.js';
import { INSTRUCTIONS, availableOn, sizeOf, REG, WIDE_OPERATIONS } from './opcodes.js';
import { validateDisplay, MODES } from './display.js';
import { PALETTES } from './palettes.js';
import { DEVICES, deviceAt } from './devices.js';

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

const SPECIAL = new Set([...Object.keys(REG), 'SP', 'PC']);
const BYTE = 1, HALF = 2, WIDE = 4; // kinds of registers an operand may be

/** Every mnemonic the assembler accepts (used for syntax highlighting). */
export const MNEMONICS = Object.freeze([...new Set(INSTRUCTIONS.map(i => i.syntax.split(' ')[0]))]);
export const DIRECTIVES = Object.freeze(['.cpu', '.org', '.db', '.equ', '.display']);

const upper = token => (token ?? '').trim().toUpperCase();
const isRegister = token => Object.hasOwn(REG, upper(token));
const bracketed = token => /^\[.*\]$/.test((token ?? '').trim());

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

const LEVEL_NAME = { cpu8s: 'MiniCPU 8S or 8X', cpu8x: 'MiniCPU 8X' };
const WIDE_LIST = 'LDI, LDA, STA, MOV, ADD, SUB, CMP, INC, DEC, PUSH and POP';

/**
 * Splits an operand into a register, a memory reference or a constant:
 *   A … Y              {kind: 'reg', n}
 *   [0x70] / [label]   {kind: 'mem', at: 'abs', text}
 *   [B] / [X]          {kind: 'mem', at: 'reg', n}
 *   [SP] / [SP+2]      {kind: 'mem', at: 'sp', text}
 *   42 / label         {kind: 'const', text}
 */
function operand(token, line) {
  const text = (token ?? '').trim();
  if (upper(text) === 'SP') return { kind: 'sp' };
  if (isRegister(text)) return { kind: 'reg', n: REG[upper(text)] };
  if (!bracketed(text)) return { kind: 'const', text };
  const inside = text.slice(1, -1).trim();
  if (!inside) fail(line, 'Empty brackets');
  if (isRegister(inside)) return { kind: 'mem', at: 'reg', n: REG[upper(inside)] };
  const stack = inside.match(/^SP\b\s*(?:\+(.*))?$/i);
  if (stack) return { kind: 'mem', at: 'sp', text: stack[1]?.trim() || '0' };
  if (/^SP\b/i.test(inside)) fail(line, 'Only [SP+n] is possible: n counts up from SP');
  return { kind: 'mem', at: 'abs', text: inside };
}

/**
 * Picks the instruction for a source line and checks its operands.
 * Returns {info, size, emit(put, symbols)}.
 */
function encode(node, arch) {
  const { op, args, line } = node;
  const count = n => {
    if (args.length !== n || args.some(a => !a)) fail(line, `${op} expects ${n === 0 ? 'no operands' : n === 1 ? 'one operand' : 'two operands'}`);
  };
  const need = (name, detail = '') => {
    const info = INSTRUCTIONS.find(i => i.name === name);
    if (!availableOn(info, arch.id)) fail(line, `${op}${detail} needs ${LEVEL_NAME[info.since]} (use .cpu ${info.since.slice(3)})`);
    return info;
  };
  /** A register operand of the allowed kinds; explains what is wrong otherwise. */
  const reg = (o, kinds, name = op) => {
    if (o.kind === 'sp') fail(line, 'SP only appears in ADD SP, n · SUB SP, n · [SP+n]');
    if (o.kind !== 'reg') fail(line, `${name} expects a register here`);
    const n = o.n, kind = n < 4 ? BYTE : n < 8 ? HALF : WIDE, label = Object.keys(REG).find(k => REG[k] === n);
    if (kind !== BYTE && !arch.index) fail(line, `${label} ${kind === WIDE ? 'is a 16-bit pointer register' : `is a byte of ${label[0]}`}, which needs MiniCPU 8X (use .cpu 8x)`);
    if (!(kinds & kind)) {
      if (kind === HALF) fail(line, `${label} can only be used with MOV`);
      if (kind === WIDE) fail(line, `${name} does not work with ${label}. X and Y work with ${WIDE_LIST}`);
      fail(line, `${name} expects X or Y here`);
    }
    return n;
  };
  const addrBytes = arch.addressBits / 8;
  const putAddress = (text, symbols, put) => {
    const v = ranged(text, symbols, line, arch.memorySize - 1, 'Address');
    put(v & 0xFF);
    if (addrBytes === 2) put(v >> 8);
  };
  const putConstant = (text, symbols, put, wide) => {
    const v = expression(text, symbols, line);
    if (wide) {
      if (v < -32768 || v > 0xFFFF) fail(line, `${v} does not fit in 16 bits`);
      put(v & 0xFF); put((v >> 8) & 0xFF);
    } else {
      if (v < -128 || v > 255) fail(line, `${v} does not fit in a byte (0..255, or −128..−1)`);
      put(v & 0xFF);
    }
  };
  const result = (info, wide, emit) => ({ info, size: sizeOf(info, arch, wide), emit });
  const none = name => { count(0); const info = need(name); return result(info, false, put => put(info.code)); };
  const single = (name, kinds) => {
    count(1);
    const info = need(name), n = reg(operand(args[0], line), kinds);
    return result(info, n >= 8, put => { put(info.code); put(n); });
  };
  /** ADD/SUB/CMP/ADC/SBC/AND/OR/XOR: register or constant as second operand. */
  const alu = (name, destKinds, sourceKinds) => {
    count(2);
    const dest = operand(args[0], line), source = operand(args[1], line);
    const d = reg(dest, destKinds);
    if (source.kind === 'mem') fail(line, `${op} works on registers; load the byte first with LDA`);
    if (source.kind === 'const') {
      const info = need(`${name}_I`);
      return result(info, d >= 8, (put, symbols) => { put(info.code); put(d); putConstant(source.text, symbols, put, d >= 8); });
    }
    const info = need(name), s = reg(source, sourceKinds);
    if (d < 8 && s >= 8) fail(line, `${op} ${Object.keys(REG)[d]}, ${Object.keys(REG).find(k => REG[k] === s)}: a 16-bit register does not fit into 8 bits`);
    return result(info, d >= 8, put => { put(info.code); put((d << 4) | s); });
  };

  switch (op) {
    case 'NOP': case 'HLT': case 'CLF': case 'RET':
      return none(op);
    case 'INC': case 'DEC':
      return single(op, BYTE | WIDE);
    case 'PUSH': case 'POP':
      return single(op, BYTE | WIDE);
    case 'SHL': case 'SHR':
      return single(op, BYTE);
    case 'ADD': case 'SUB': {
      if (operand(args[0], line).kind === 'sp') {
        count(2);
        const info = need(`${op}_SP`, ' SP');
        return result(info, false, (put, symbols) => { put(info.code); put(ranged(args[1], symbols, line, 255, 'Byte count')); });
      }
      return alu(op, BYTE | WIDE, BYTE | WIDE);
    }
    case 'CMP':
      return alu(op, BYTE | WIDE, BYTE | WIDE);
    case 'ADC': case 'SBC': case 'AND': case 'OR': case 'XOR':
      return alu(op, BYTE, BYTE);
    case 'JMP': case 'JZ': case 'JNZ': case 'JC': case 'JNC': case 'CALL': {
      count(1);
      const info = need(op);
      if (bracketed(args[0])) fail(line, `${op} takes a label or an address, without brackets`);
      return result(info, false, (put, symbols) => { put(info.code); putAddress(args[0], symbols, put); });
    }
    case 'IN': {
      count(2);
      const info = need('IN'), d = reg(operand(args[0], line), BYTE);
      return { ...result(info, false, (put, symbols) => { put(info.code); put(d); put(ranged(args[1], symbols, line, 255, 'Port')); }), port: args[1] };
    }
    case 'OUT': {
      count(2);
      const info = need('OUT'), s = reg(operand(args[1], line), BYTE);
      return { ...result(info, false, (put, symbols) => { put(info.code); put(ranged(args[0], symbols, line, 255, 'Port')); put(s); }), port: args[0] };
    }
    case 'MOV': {
      count(2);
      const info = need('MOV');
      const dest = operand(args[0], line), source = operand(args[1], line);
      if (source.kind === 'const') fail(line, `MOV copies a register; use LDI ${args[0].trim()}, ${args[1].trim()} for a constant`);
      if (source.kind === 'mem' || dest.kind === 'mem') fail(line, 'MOV copies between registers; use LDA and STA for memory');
      const d = reg(dest, BYTE | HALF | WIDE), s = reg(source, BYTE | HALF | WIDE);
      if ((d >= 8) !== (s >= 8)) fail(line, 'MOV needs two registers of the same size: X and Y have 16 bits, all others 8');
      return result(info, d >= 8, put => { put(info.code); put((d << 4) | s); });
    }
    case 'LDI': {
      count(2);
      const info = need('LDI'), d = reg(operand(args[0], line), BYTE | WIDE), source = operand(args[1], line);
      if (source.kind === 'mem') fail(line, `LDI loads a constant. To read the memory at ${args[1].trim()}, write LDA ${args[0].trim()}, ${args[1].trim()}`);
      if (source.kind === 'reg') fail(line, `To copy a register, write MOV ${args[0].trim()}, ${args[1].trim()}`);
      return result(info, d >= 8, (put, symbols) => { put(info.code); put(d); putConstant(source.text, symbols, put, d >= 8); });
    }
    case 'LDA': {
      count(2);
      const dest = operand(args[0], line), source = operand(args[1], line);
      if (source.kind !== 'mem') {
        fail(line, source.kind === 'const'
          ? `LDA reads memory: write LDA ${args[0].trim()}, [${args[1].trim()}] for the byte at address ${args[1].trim()}, or LDI ${args[0].trim()}, ${args[1].trim()} for the number itself`
          : `To copy a register, write MOV ${args[0].trim()}, ${args[1].trim()}`);
      }
      if (source.at === 'sp') {
        const info = need('LDA_SP', ' with [SP+n]'), d = reg(dest, BYTE | WIDE);
        return result(info, d >= 8, (put, symbols) => { put(info.code); put(d); put(ranged(source.text, symbols, line, 255, 'Offset')); });
      }
      if (source.at === 'reg') {
        const info = need('LDA_R'), d = reg(dest, BYTE), p = reg({ kind: 'reg', n: source.n }, BYTE | WIDE, 'A pointer');
        return result(info, false, put => { put(info.code); put((d << 4) | p); });
      }
      const info = need('LDA'), d = reg(dest, BYTE | WIDE);
      return result(info, d >= 8, (put, symbols) => { put(info.code); put(d); putAddress(source.text, symbols, put); });
    }
    case 'STA': {
      count(2);
      const dest = operand(args[0], line), source = operand(args[1], line);
      if (dest.kind !== 'mem') fail(line, `STA writes to memory: write STA [${args[0].trim()}], ${args[1].trim()}`);
      if (source.kind !== 'reg') fail(line, 'STA stores a register; load the value into a register first');
      if (dest.at === 'sp') {
        const info = need('STA_SP', ' with [SP+n]'), s = reg(source, BYTE | WIDE);
        return result(info, s >= 8, (put, symbols) => { put(info.code); put(ranged(dest.text, symbols, line, 255, 'Offset')); put(s); });
      }
      if (dest.at === 'reg') {
        const info = need('STA_R'), p = reg({ kind: 'reg', n: dest.n }, BYTE | WIDE, 'A pointer'), s = reg(source, BYTE);
        return result(info, false, put => { put(info.code); put((p << 4) | s); });
      }
      const info = need('STA'), s = reg(source, BYTE | WIDE);
      return result(info, s >= 8, (put, symbols) => { put(info.code); putAddress(dest.text, symbols, put); put(s); });
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
  const listing = [], sourceMap = new Map(), lineAddresses = new Map(), ports = new Set();
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
    } else {
      node.encoding.emit(put, symbols);
      if (node.encoding.port !== undefined) {
        const port = expression(node.encoding.port, symbols, node.line), device = deviceAt(port);
        if (!device) fail(node.line, `Nothing is plugged into port 0x${port.toString(16).toUpperCase().padStart(2, "0")} (ports: ${DEVICES.map(d => `0x${d.port.toString(16).toUpperCase().padStart(2, '0')} ${d.name}`).join(', ')})`);
        if ((node.op === 'IN') !== (device.direction === 'in')) fail(node.line, `The ${device.name} at port 0x${port.toString(16).toUpperCase().padStart(2, '0')} only supports ${device.direction === 'in' ? 'IN' : 'OUT'}`);
        ports.add(port);
      }
    }
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
    labels: symbols, warnings, ports: [...ports].sort((a, b) => a - b), loadedBytes: occupied.reduce((a, b) => a + b, 0),
  };
}
