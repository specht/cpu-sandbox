/**
 * MiniC: a small C for the MiniCPU. It compiles to the same assembly that
 * students write by hand, so the generated code can be read, stepped through
 * and compared with their own.
 *
 * The language is a subset of C:
 *   types        char (8 bits, unsigned), int (signed) and unsigned int,
 *                pointers, arrays, void; int and pointers have 16 bits on
 *                MiniCPU 8X and 8 bits on 8 and 8S
 *   statements   if/else, while, do/while, for, break, continue, return,
 *                blocks, asm("…")
 *   expressions  all C operators except the comma in function arguments
 *                (+ - * / % & | ^ ~ << >> ! && || == != < <= > >= ?: = op=
 *                ++ -- & * [] casts sizeof)
 *   preprocessor #define (also with parameters), #pragma cpu 8x,
 *                #pragma display <like .display>
 *   built in     in(port), out(port, value) and the port names TIMER,
 *                JOYSTICK, KEYBOARD, RANDOM, SPEAKER, NUMBER, SCREEN_PAGE, JOY_LEFT, …
 *
 * Differences from C, chosen to match an 8-bit CPU:
 *   - char arithmetic stays 8 bits wide (200 + 100 is 44 for two chars);
 *     as soon as an int takes part, the computation is done in int.
 *   - Local arrays and & of local variables are not supported (there is no
 *     instruction that reads SP); arrays live outside of functions.
 *   - MiniCPU 8 has no stack: only main(), no other functions, and no
 *     * / % (except by powers of two) or shifts by a variable amount.
 *
 * Calling convention (MiniCPU 8S/8X): the caller pushes the arguments from
 * left to right and calls; the function reserves its locals with SUB SP, n,
 * returns its result in A (8 bits) or X (16 bits) and frees the locals with
 * ADD SP, n; the caller frees the arguments. A–D, X and Y are scratch
 * registers; values that must survive a call live on the stack.
 */
import { ARCHITECTURES, architectureFromDirective } from './architectures.js';
import { formatSource } from './format.js';

export class CompileError extends Error {
  constructor(line, message) {
    super(line ? `Line ${line}: ${message}` : message);
    this.name = 'CompileError';
    this.line = line;
    this.detail = message;
  }
}
const fail = (line, message) => { throw new CompileError(line, message); };

// ================================================================== tokens

const PUNCTUATORS = ['<<=', '>>=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  '+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '<', '>', '=', '?', ':', ';', ',', '(', ')', '[', ']', '{', '}', '.'];
const KEYWORDS = new Set(['void', 'char', 'int', 'unsigned', 'signed', 'const', 'volatile', 'static', 'register', 'auto', 'extern',
  'if', 'else', 'while', 'do', 'for', 'return', 'break', 'continue', 'sizeof', 'asm',
  'long', 'short', 'float', 'double', 'struct', 'union', 'enum', 'switch', 'case', 'default', 'goto', 'typedef']);
const UNSUPPORTED = {
  long: 'MiniC has no long: int is the widest type',
  short: 'MiniC has no short: use char or int',
  float: 'MiniC has no floating-point numbers: use int as fixed point, e.g. 64 for 1.0',
  double: 'MiniC has no floating-point numbers: use int as fixed point, e.g. 64 for 1.0',
  struct: 'MiniC has no structs: use one array per field',
  union: 'MiniC has no unions',
  enum: 'MiniC has no enum: use #define',
  switch: 'MiniC has no switch: use if / else if',
  case: 'MiniC has no switch: use if / else if',
  default: 'MiniC has no switch: use if / else if',
  goto: 'MiniC has no goto',
  typedef: 'MiniC has no typedef: use #define',
  signed: 'MiniC has no signed char: use int for negative numbers',
};
const ESCAPES = { n: 10, t: 9, r: 13, 0: 0, a: 7, b: 8, e: 27, '\\': 92, "'": 39, '"': 34 };

function unescape(text, line) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (c === '\\') {
      c = text[++i];
      if (c === 'x') {
        const hex = text.slice(i + 1).match(/^[0-9a-fA-F]{1,2}/)?.[0];
        if (!hex) fail(line, '\\x needs hex digits, e.g. \\x41');
        out.push(parseInt(hex, 16));
        i += hex.length;
      } else if (c in ESCAPES) out.push(ESCAPES[c]);
      else fail(line, `Unknown escape \\${c ?? ''} (known: \\n \\t \\r \\0 \\\\ \\' \\" \\xHH)`);
    } else {
      const code = text.charCodeAt(i);
      if (code > 255) fail(line, `“${c}” is not an ASCII character and does not fit into a byte`);
      out.push(code);
    }
  }
  return out;
}

function tokenize(source, firstLine = 1, directives = true) {
  const tokens = [];
  let i = 0, line = firstLine, lineStart = true;
  const s = source;
  while (i < s.length) {
    const c = s[i];
    if (c === '\n') { line++; i++; lineStart = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (s.startsWith('//', i)) { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (s.startsWith('/*', i)) {
      const end = s.indexOf('*/', i + 2);
      if (end < 0) fail(line, 'The comment /* is never closed with */');
      for (let k = i; k < end; k++) if (s[k] === '\n') line++;
      i = end + 2;
      continue;
    }
    if (c === '#' && lineStart && directives) {
      let end = s.indexOf('\n', i);
      if (end < 0) end = s.length;
      tokens.push({ t: 'dir', v: s.slice(i + 1, end), line });
      i = end;
      continue;
    }
    lineStart = false;
    const rest = s.slice(i, i + 200);
    let m;
    if ((m = rest.match(/^(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+)[uUlL]*/))) {
      const text = m[1];
      const value = /^0[bB]/.test(text) ? parseInt(text.slice(2), 2) : Number(text);
      if (/^0\d/.test(text)) fail(line, `${text}: octal numbers are not supported; write ${Number(text)} or 0x${Number(text).toString(16)}`);
      tokens.push({ t: 'num', v: value, line });
      i += m[0].length;
      continue;
    }
    if (c === "'") {
      m = rest.match(/^'((?:\\x[0-9a-fA-F]{1,2}|\\.|[^'\\\n]))'/);
      if (!m) fail(line, "A character is written like 'A' or '\\n'");
      tokens.push({ t: 'num', v: unescape(m[1], line)[0], line, char: true });
      i += m[0].length;
      continue;
    }
    if (c === '"') {
      let k = i + 1;
      while (k < s.length && s[k] !== '"' && s[k] !== '\n') k += s[k] === '\\' ? 2 : 1;
      if (s[k] !== '"') fail(line, 'The string is not closed with "');
      tokens.push({ t: 'str', v: unescape(s.slice(i + 1, k), line), line });
      i = k + 1;
      continue;
    }
    if ((m = rest.match(/^[A-Za-z_]\w*/))) {
      tokens.push({ t: KEYWORDS.has(m[0]) ? 'kw' : 'id', v: m[0], line });
      i += m[0].length;
      continue;
    }
    const p = PUNCTUATORS.find(q => s.startsWith(q, i));
    if (!p) fail(line, `Unexpected character “${c}”`);
    tokens.push({ t: 'p', v: p, line });
    i += p.length;
  }
  return { tokens, lastLine: line };
}

// ================================================================== preprocessor

/** Names every program knows without #include. */
export const PREDEFINED = Object.freeze({
  JOYSTICK: 0x00, KEYBOARD: 0x01, TIMER: 0x02, RANDOM: 0x03, SPEAKER: 0x10, NUMBER: 0x11, SCREEN_PAGE: 0x12,
  JOY_LEFT: 1, JOY_RIGHT: 2, JOY_UP: 4, JOY_DOWN: 8, JOY_FIRE: 16,
  NULL: 0, true: 1, false: 0,
});

function preprocess(tokens) {
  const macros = new Map(Object.entries(PREDEFINED).map(([name, v]) => [name, { params: null, body: [{ t: 'num', v }] }]));
  const pragmas = {};
  const plain = [];
  for (const token of tokens) {
    if (token.t !== 'dir') { plain.push(token); continue; }
    const line = token.line, text = token.v.trim();
    const m = text.match(/^(\w+)\s*([\s\S]*)$/);
    if (!m) fail(line, 'Expected a directive after #, e.g. #define');
    const [, name, rest] = m;
    if (name === 'define') {
      const d = rest.match(/^([A-Za-z_]\w*)(\(([^)]*)\))?\s*([\s\S]*)$/);
      if (!d) fail(line, 'Write #define NAME value');
      const params = d[2] ? d[3].split(',').map(p => p.trim()).filter(Boolean) : null;
      if (params?.some(p => !/^[A-Za-z_]\w*$/.test(p))) fail(line, 'Macro parameters are names, e.g. #define SQUARE(x) ((x) * (x))');
      macros.set(d[1], { params, body: tokenize(d[4], line, false).tokens });
    } else if (name === 'undef') {
      macros.delete(rest.trim());
    } else if (name === 'pragma') {
      const p = rest.match(/^(\w+)\s*([\s\S]*)$/);
      if (p?.[1] === 'cpu') {
        const arch = architectureFromDirective(p[2]);
        if (!arch) fail(line, `#pragma cpu expects ${Object.values(ARCHITECTURES).map(a => a.directive).join(', ')}`);
        if (pragmas.cpu) fail(line, 'Only one #pragma cpu is allowed');
        pragmas.cpu = { arch, line };
      } else if (p?.[1] === 'display') {
        if (pragmas.display) fail(line, 'Only one #pragma display is allowed');
        pragmas.display = { text: p[2].trim(), line };
      } else fail(line, 'Known pragmas: #pragma cpu 8x, #pragma display start, width, height, format[, palette]');
    } else if (name === 'include') {
      fail(line, 'MiniC has no header files: in(), out() and the port names (TIMER, JOYSTICK, …) are always there');
    } else fail(line, `Unknown directive #${name} (known: #define, #undef, #pragma)`);
  }

  const expand = (list, hidden) => {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const token = list[i], macro = token.t === 'id' && !hidden.has(token.v) ? macros.get(token.v) : null;
      if (!macro) { out.push(token); continue; }
      let body = macro.body;
      if (macro.params) {
        if (list[i + 1]?.v !== '(') { out.push(token); continue; }
        const args = [[]];
        let depth = 0, k = i + 2;
        for (; k < list.length; k++) {
          const v = list[k].t === 'p' ? list[k].v : null;
          if (v === ')' && depth === 0) break;
          if (v === '(') depth++;
          if (v === ')') depth--;
          if (v === ',' && depth === 0) { args.push([]); continue; }
          args.at(-1).push(list[k]);
        }
        if (k >= list.length) fail(token.line, `${token.v}( is never closed`);
        if (args.length === 1 && !args[0].length) args.length = 0;
        if (args.length !== macro.params.length) fail(token.line, `${token.v} expects ${macro.params.length} argument${macro.params.length === 1 ? '' : 's'}`);
        const expanded = args.map(a => expand(a, hidden));
        body = body.flatMap(b => {
          const at = b.t === 'id' ? macro.params.indexOf(b.v) : -1;
          return at >= 0 ? expanded[at] : [b];
        });
        i = k;
      }
      out.push(...expand(body.map(b => ({ ...b, line: token.line })), new Set([...hidden, token.v])));
    }
    return out;
  };
  return { tokens: expand(plain, new Set()), pragmas };
}

// ================================================================== types

const CHAR = Object.freeze({ k: 'char' }), INT = Object.freeze({ k: 'int' }), UINT = Object.freeze({ k: 'uint' }), VOID = Object.freeze({ k: 'void' });
const ptr = to => ({ k: 'ptr', to });
const arr = (of, n) => ({ k: 'arr', of, n });
const isPointer = t => t.k === 'ptr' || t.k === 'arr';
const isInteger = t => t.k === 'char' || t.k === 'int' || t.k === 'uint';
const decay = t => (t.k === 'arr' ? ptr(t.of) : t);
function typeName(t) {
  switch (t.k) {
    case 'char': return 'char';
    case 'int': return 'int';
    case 'uint': return 'unsigned int';
    case 'void': return 'void';
    case 'ptr': return `${typeName(t.to)}*`;
    case 'arr': return `${typeName(t.of)}[${t.n ?? ''}]`;
    default: return '?';
  }
}

// ================================================================== parser

class Parser {
  constructor(tokens, lastLine) { this.tokens = tokens; this.i = 0; this.lastLine = lastLine; }

  peek(offset = 0) { return this.tokens[this.i + offset] ?? { t: 'eof', v: '', line: this.lastLine }; }
  next() { return this.tokens[this.i++] ?? { t: 'eof', v: '', line: this.lastLine }; }
  is(v, offset = 0) { const t = this.peek(offset); return (t.t === 'p' || t.t === 'kw') && t.v === v; }
  accept(v) { if (this.is(v)) { this.i++; return true; } return false; }
  expect(v, context = '') {
    if (this.accept(v)) return;
    const t = this.peek();
    fail(t.line, `Expected “${v}”${context ? ` ${context}` : ''}, found ${t.t === 'eof' ? 'the end of the file' : `“${t.t === 'str' ? '"…"' : t.v}”`}`);
  }
  name(what = 'a name') {
    const t = this.next();
    if (t.t !== 'id') fail(t.line, `Expected ${what}, found “${t.t === 'eof' ? 'the end' : t.v}”${t.t === 'kw' ? ' (a keyword)' : ''}`);
    return t.v;
  }

  isType(offset = 0) {
    const t = this.peek(offset);
    return t.t === 'kw' && ['void', 'char', 'int', 'unsigned', 'signed', 'const', 'volatile', 'static', 'register', 'auto', 'extern',
      'long', 'short', 'float', 'double', 'struct', 'union', 'enum'].includes(t.v);
  }

  baseType() {
    let type = null, unsigned = false;
    const line = this.peek().line;
    for (;;) {
      const t = this.peek();
      if (t.t !== 'kw') break;
      if (['const', 'volatile', 'static', 'register', 'auto', 'extern'].includes(t.v)) { this.i++; continue; }
      if (UNSUPPORTED[t.v]) fail(t.line, UNSUPPORTED[t.v]);
      if (t.v === 'unsigned') { unsigned = true; this.i++; continue; }
      if (['void', 'char', 'int'].includes(t.v)) {
        if (type) fail(t.line, `Two types: ${type.k} and ${t.v}`);
        type = t.v === 'void' ? VOID : t.v === 'char' ? CHAR : INT;
        this.i++;
        continue;
      }
      break;
    }
    if (!type && !unsigned) fail(line, 'Expected a type: char, int, unsigned int or void');
    if (unsigned) {
      if (type === VOID) fail(line, 'unsigned void is not a type');
      type = type === CHAR ? CHAR : UINT;
    }
    return type;
  }

  pointers(type) {
    while (this.accept('*')) { type = ptr(type); while (this.accept('const') || this.accept('volatile')); }
    return type;
  }

  /** Array suffixes: name[3] or name[] (size from the initializer). */
  arraySuffix(type) {
    if (!this.is('[')) return type;
    const line = this.peek().line;
    this.next();
    let n = null;
    if (!this.is(']')) n = this.expression();
    this.expect(']', 'after the array size');
    if (this.is('[')) fail(line, 'MiniC has no arrays of arrays: use one array and compute y * width + x');
    return { ...arr(type, null), sizeExpr: n, line };
  }

  program() {
    const items = [];
    while (this.peek().t !== 'eof') {
      if (this.accept(';')) continue;
      const line = this.peek().line;
      if (!this.isType()) fail(line, `Expected a declaration (int x; or int f() { … }), found “${this.peek().v}”`);
      const base = this.baseType();
      let first = true;
      for (;;) {
        const type = this.pointers(base);
        const nameLine = this.peek().line;
        const name = this.name('a name for the variable or function');
        if (first && this.is('(')) { items.push(this.func(type, name, nameLine)); break; }
        first = false;
        const full = this.arraySuffix(type);
        if (full.k === 'void') fail(nameLine, `${name} cannot be void`);
        let init = null;
        if (this.accept('=')) init = this.initializer();
        items.push({ kind: 'global', name, type: full, init, line: nameLine });
        if (this.accept(',')) continue;
        this.expect(';', `after the declaration of ${name}`);
        break;
      }
    }
    return items;
  }

  initializer() {
    if (this.is('{')) {
      const line = this.next().line, list = [];
      while (!this.is('}')) {
        list.push(this.assignment());
        if (!this.accept(',')) break;
      }
      this.expect('}', 'to close the list of values');
      return { k: 'list', list, line };
    }
    return this.assignment();
  }

  func(ret, name, line) {
    this.expect('(');
    const params = [];
    if (this.is('void') && this.is(')', 1)) this.next();
    while (!this.is(')')) {
      const pline = this.peek().line;
      if (!this.isType()) fail(pline, `Expected a parameter type in ${name}(…)`);
      let type = this.pointers(this.baseType());
      const pname = this.name('a parameter name');
      if (this.accept('[')) { this.expect(']', 'array parameters are written int a[]'); type = ptr(type); }
      if (type === VOID) fail(pline, 'A parameter cannot be void');
      params.push({ name: pname, type, line: pline });
      if (!this.accept(',')) break;
    }
    this.expect(')', `after the parameters of ${name}`);
    if (this.accept(';')) return { kind: 'func', name, ret, params, body: null, line };
    if (!this.is('{')) fail(this.peek().line, `Expected { to start the body of ${name}`);
    return { kind: 'func', name, ret, params, body: this.block(), line };
  }

  block() {
    const line = this.peek().line;
    this.expect('{');
    const items = [];
    while (!this.is('}')) {
      if (this.peek().t === 'eof') fail(line, 'This { is never closed with }');
      items.push(this.statement());
    }
    this.expect('}');
    return { kind: 'block', items, line };
  }

  declaration() {
    const base = this.baseType(), list = [];
    do {
      const type = this.pointers(base);
      const line = this.peek().line;
      const name = this.name('a variable name');
      const full = this.arraySuffix(type);
      if (full.k === 'void') fail(line, `${name} cannot be void`);
      if (full.k === 'arr') fail(line, `${name}: arrays must be declared outside of functions in MiniC`);
      let init = null;
      if (this.accept('=')) {
        if (this.is('{')) fail(line, 'Only arrays take a list of values');
        init = this.assignment();
      }
      list.push({ kind: 'decl', name, type: full, init, line });
    } while (this.accept(','));
    this.expect(';', 'after the declaration');
    return list.length === 1 ? list[0] : { kind: 'decls', list, line: list[0].line };
  }

  statement() {
    const t = this.peek(), line = t.line;
    if (t.t === 'kw' && UNSUPPORTED[t.v] && !['long', 'short', 'float', 'double', 'struct', 'union', 'enum', 'signed'].includes(t.v)) fail(line, UNSUPPORTED[t.v]);
    if (this.is('{')) return this.block();
    if (this.isType()) return this.declaration();
    if (this.accept(';')) return { kind: 'empty', line };
    if (this.accept('if')) {
      this.expect('(', 'after if');
      const cond = this.expression();
      this.expect(')', 'after the condition');
      const then = this.statement();
      const otherwise = this.accept('else') ? this.statement() : null;
      return { kind: 'if', cond, then, otherwise, line };
    }
    if (this.accept('while')) {
      this.expect('(', 'after while');
      const cond = this.expression();
      this.expect(')', 'after the condition');
      return { kind: 'while', cond, body: this.statement(), line };
    }
    if (this.accept('do')) {
      const body = this.statement();
      this.expect('while', 'after the body of do');
      this.expect('(');
      const cond = this.expression();
      this.expect(')');
      this.expect(';', 'after do … while (…)');
      return { kind: 'do', body, cond, line };
    }
    if (this.accept('for')) {
      this.expect('(', 'after for');
      let init = null;
      if (this.isType()) init = this.declaration();
      else { if (!this.is(';')) init = { kind: 'expr', expr: this.expression(), line }; this.expect(';', 'after the start of the for loop'); }
      const cond = this.is(';') ? null : this.expression();
      this.expect(';', 'after the condition of the for loop');
      const step = this.is(')') ? null : this.expression();
      this.expect(')', 'to close for (…)');
      return { kind: 'for', init, cond, step, body: this.statement(), line };
    }
    if (this.accept('return')) {
      const value = this.is(';') ? null : this.expression();
      this.expect(';', 'after return');
      return { kind: 'return', value, line };
    }
    if (this.accept('break')) { this.expect(';'); return { kind: 'break', line }; }
    if (this.accept('continue')) { this.expect(';'); return { kind: 'continue', line }; }
    if (this.accept('asm')) {
      this.expect('(', 'after asm');
      const parts = [];
      while (this.peek().t === 'str') parts.push(String.fromCharCode(...this.next().v));
      if (!parts.length) fail(line, 'Write asm("INC A");');
      this.expect(')');
      this.expect(';', 'after asm(…)');
      return { kind: 'asm', text: parts.join(''), line };
    }
    const expr = this.expression();
    this.expect(';', 'after the statement');
    return { kind: 'expr', expr, line };
  }

  // ------------------------------------------------------------ expressions

  expression() {
    let e = this.assignment();
    while (this.is(',')) { const line = this.next().line; e = { k: 'comma', l: e, r: this.assignment(), line }; }
    return e;
  }

  assignment() {
    const l = this.conditional();
    const t = this.peek();
    if (t.t === 'p' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(t.v)) {
      this.next();
      return { k: 'assign', op: t.v === '=' ? null : t.v.slice(0, -1), l, r: this.assignment(), line: t.line };
    }
    return l;
  }

  conditional() {
    const c = this.binary(0);
    if (!this.is('?')) return c;
    const line = this.next().line;
    const a = this.expression();
    this.expect(':', 'in … ? … : …');
    return { k: 'cond', c, a, b: this.conditional(), line };
  }

  binary(level) {
    const LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
    if (level === LEVELS.length) return this.unary();
    let l = this.binary(level + 1);
    for (;;) {
      const t = this.peek();
      if (t.t !== 'p' || !LEVELS[level].includes(t.v)) return l;
      this.next();
      l = { k: 'bin', op: t.v, l, r: this.binary(level + 1), line: t.line };
    }
  }

  unary() {
    const t = this.peek(), line = t.line;
    if (t.t === 'p') {
      if (t.v === '++' || t.v === '--') { this.next(); return { k: 'inc', op: t.v, prefix: true, e: this.unary(), line }; }
      if (['-', '+', '!', '~'].includes(t.v)) { this.next(); return { k: 'un', op: t.v, e: this.unary(), line }; }
      if (t.v === '*') { this.next(); return { k: 'deref', e: this.unary(), line }; }
      if (t.v === '&') { this.next(); return { k: 'addr', e: this.unary(), line }; }
      if (t.v === '(' && this.isType(1)) {
        this.next();
        const type = this.pointers(this.baseType());
        this.expect(')', 'after the type of the cast');
        return { k: 'cast', type, e: this.unary(), line };
      }
    }
    if (this.accept('sizeof')) {
      if (this.is('(') && this.isType(1)) {
        this.next();
        const type = this.arraySuffix(this.pointers(this.baseType()));
        this.expect(')');
        return { k: 'sizeof', type, line };
      }
      return { k: 'sizeof', e: this.unary(), line };
    }
    return this.postfix();
  }

  postfix() {
    let e = this.primary();
    for (;;) {
      const t = this.peek();
      if (this.accept('[')) {
        const index = this.expression();
        this.expect(']', 'after the index');
        e = { k: 'deref', e: { k: 'bin', op: '+', l: e, r: index, line: t.line }, line: t.line, index: true };
      } else if (this.accept('(')) {
        if (e.k !== 'id') fail(t.line, 'Only functions can be called, by name');
        const args = [];
        while (!this.is(')')) {
          args.push(this.assignment());
          if (!this.accept(',')) break;
        }
        this.expect(')', `to close the call of ${e.name}`);
        e = { k: 'call', name: e.name, args, line: e.line };
      } else if (this.is('++') || this.is('--')) {
        this.next();
        e = { k: 'inc', op: t.v, prefix: false, e, line: t.line };
      } else if (this.is('.') || this.is('->')) {
        fail(t.line, UNSUPPORTED.struct);
      } else return e;
    }
  }

  primary() {
    const t = this.next(), line = t.line;
    if (t.t === 'num') return { k: 'num', v: t.v, line };
    if (t.t === 'str') {
      let bytes = t.v;
      while (this.peek().t === 'str') bytes = bytes.concat(this.next().v);
      return { k: 'str', bytes, line };
    }
    if (t.t === 'id') return { k: 'id', name: t.v, line };
    if (t.t === 'p' && t.v === '(') {
      const e = this.expression();
      this.expect(')', 'to close the parenthesis');
      return e;
    }
    if (t.t === 'kw' && UNSUPPORTED[t.v]) fail(line, UNSUPPORTED[t.v]);
    fail(line, t.t === 'eof' ? 'The program ends in the middle of an expression' : `Expected a value, found “${t.v}”`);
  }
}

// ================================================================== code generation

const RELATIONAL = new Set(['==', '!=', '<', '<=', '>', '>=']);
const LOGICAL = new Set(['&&', '||']);
const isPowerOfTwo = v => v > 0 && (v & (v - 1)) === 0;
const log2 = v => Math.round(Math.log2(v));

/** Runtime routines, appended only when a program uses them. A–D, X, Y are scratch. */
const RUNTIME = {
  mul8: { needs: [], code: `
; A = A * B (8 bits)
mul8:   LDI C, 0
mul8_loop:
        CMP B, 0
        JZ mul8_done
        SHR B                   ; CF = lowest bit of B
        JNC mul8_skip
        ADD C, A
mul8_skip:
        ADD A, A
        JMP mul8_loop
mul8_done:
        MOV A, C
        RET` },
  divu8: { needs: [], code: `
; A = A / B, B = A % B (8 bits, unsigned)
divu8:  LDI C, 0                ; remainder
        LDI D, 8
divu8_loop:
        SHL A                   ; the next bit of the dividend …
        ADC C, C                ; … moves into the remainder
        JC divu8_sub
        CMP C, B
        JC divu8_next
divu8_sub:
        SUB C, B
        INC A                   ; this bit of the quotient is 1
divu8_next:
        DEC D
        JNZ divu8_loop
        MOV B, C
        RET` },
  divs8: { needs: ['divu8'], code: `
; A = A / B, B = A % B (8 bits, signed)
divs8:  LDI D, 0                ; bit 0: negative quotient, bit 1: negative remainder
        CMP A, 0x80
        JC divs8_a
        XOR A, 0xFF
        INC A
        LDI D, 3
divs8_a:
        CMP B, 0x80
        JC divs8_b
        XOR B, 0xFF
        INC B
        XOR D, 1
divs8_b:
        PUSH D
        CALL divu8
        POP D
        MOV C, D
        AND C, 1
        JZ divs8_q
        XOR A, 0xFF
        INC A
divs8_q:
        AND D, 2
        JZ divs8_r
        XOR B, 0xFF
        INC B
divs8_r:
        RET` },
  shl8: { needs: [], code: `
; A = A << B
shl8:   CMP B, 0
        JZ shl8_done
        SHL A
        DEC B
        JMP shl8
shl8_done:
        RET` },
  shr8: { needs: [], code: `
; A = A >> B (unsigned)
shr8:   CMP B, 0
        JZ shr8_done
        SHR A
        DEC B
        JMP shr8
shr8_done:
        RET` },
  sar8: { needs: [], code: `
; A = A >> B (signed: the sign bit stays)
sar8:   CMP B, 0
        JZ sar8_done
        CMP A, 0x80             ; CF = 0 for negative numbers
        JC sar8_positive
        SHR A
        OR A, 0x80
        JMP sar8_next
sar8_positive:
        SHR A
sar8_next:
        DEC B
        JMP sar8
sar8_done:
        RET` },
  mul16: { needs: [], code: `
; X = X * Y (16 bits)
mul16:  LDI C, 0                ; D:C = result
        LDI D, 0
mul16_loop:
        CMP Y, 0
        JZ mul16_done
        MOV A, YL               ; Y = Y >> 1, CF = the bit shifted out
        SHR A
        MOV B, A
        JNC mul16_skip
        MOV A, XL               ; D:C = D:C + X
        ADD C, A
        MOV A, XH
        ADC D, A
mul16_skip:
        MOV A, YH
        SHR A
        MOV YH, A
        JNC mul16_low
        OR B, 0x80
mul16_low:
        MOV YL, B
        ADD X, X
        JMP mul16_loop
mul16_done:
        MOV XL, C
        MOV XH, D
        RET` },
  divu16: { needs: [], code: `
; X = X / Y, Y = X % Y (16 bits, unsigned)
divu16: LDI C, 0                ; D:C = remainder
        LDI D, 0
        LDI A, 16
        PUSH A                  ; [SP+0] = bits left
divu16_loop:
        ADD X, X                ; the next bit of the dividend …
        ADC C, C                ; … moves into the remainder
        ADC D, D
        JC divu16_sub
        MOV A, YH               ; remainder ≥ divisor?
        CMP D, A
        JC divu16_next
        JNZ divu16_sub
        MOV A, YL
        CMP C, A
        JC divu16_next
divu16_sub:
        MOV A, YL
        SUB C, A
        MOV A, YH
        SBC D, A
        INC X                   ; this bit of the quotient is 1
divu16_next:
        LDA A, [SP+0]
        DEC A
        STA [SP+0], A
        JNZ divu16_loop
        ADD SP, 1
        MOV YL, C
        MOV YH, D
        RET` },
  neg16: { needs: [], code: `
; X = −X and Y = −Y
negx16: MOV A, XL
        XOR A, 0xFF
        MOV XL, A
        MOV A, XH
        XOR A, 0xFF
        MOV XH, A
        INC X
        RET
negy16: MOV A, YL
        XOR A, 0xFF
        MOV YL, A
        MOV A, YH
        XOR A, 0xFF
        MOV YH, A
        INC Y
        RET` },
  divs16: { needs: ['divu16', 'neg16'], code: `
; X = X / Y, Y = X % Y (16 bits, signed)
divs16: LDI C, 0                ; bit 0: negative quotient, bit 1: negative remainder
        MOV A, XH
        CMP A, 0x80
        JC divs16_x
        CALL negx16
        LDI C, 3
divs16_x:
        MOV A, YH
        CMP A, 0x80
        JC divs16_y
        CALL negy16
        XOR C, 1
divs16_y:
        PUSH C
        CALL divu16
        POP C
        MOV A, C
        AND A, 1
        JZ divs16_q
        CALL negx16
divs16_q:
        AND C, 2
        JZ divs16_r
        CALL negy16
divs16_r:
        RET` },
  shl16: { needs: [], code: `
; X = X << B
shl16:  CMP B, 0
        JZ shl16_done
        ADD X, X
        DEC B
        JMP shl16
shl16_done:
        RET` },
  shr16: { needs: [], code: `
; X = X >> B (unsigned)
shr16:  CMP B, 0
        JZ shr16_done
        MOV A, XL
        SHR A
        MOV C, A
        MOV A, XH
        SHR A                   ; CF = the bit that moves into the low byte
        MOV XH, A
        JNC shr16_low
        OR C, 0x80
shr16_low:
        MOV XL, C
        DEC B
        JMP shr16
shr16_done:
        RET` },
  sar16: { needs: [], code: `
; X = X >> B (signed: the sign bit stays)
sar16:  CMP B, 0
        JZ sar16_done
        MOV A, XL
        SHR A
        MOV C, A                ; C = low byte >> 1
        MOV A, XH
        SHR A                   ; CF = the bit that moves into the low byte
        JNC sar16_low
        OR C, 0x80
sar16_low:
        MOV D, XH
        CMP D, 0x80             ; CF = 0 for negative numbers
        JC sar16_high
        OR A, 0x80
sar16_high:
        MOV XH, A
        MOV XL, C
        DEC B
        JMP sar16
sar16_done:
        RET` },
};

class Generator {
  constructor(arch, source) {
    this.arch = arch;
    this.wide = arch.index;
    this.stack = arch.stack;
    this.W = this.wide ? 2 : 1;
    this.sourceLines = source.split('\n');
    this.out = [];         // [text, cLine]
    this.line = 0;
    this.commented = 0;
    this.labels = 0;
    this.need = new Set();
    this.globals = new Map();
    this.functions = new Map();
    this.strings = [];
    this.temps = 0;        // MiniCPU 8: static slots instead of PUSH/POP
    this.tempDepth = 0;
    this.warnings = [];
  }

  // ------------------------------------------------------------ output
  emit(text) { this.out.push([`        ${text}`, this.line]); }
  label(name) { this.out.push([`${name}:`, this.line]); }
  raw(text, line = this.line) { this.out.push([text, line]); }
  newLabel(kind) { return `${kind}_${++this.labels}`; }
  at(node) {
    if (!node?.line) return;
    this.line = node.line;
    if (this.commented !== node.line) {
      this.commented = node.line;
      const text = this.sourceLines[node.line - 1]?.trim();
      if (text) this.raw(`; ${text}`);
    }
  }

  // ------------------------------------------------------------ types and sizes
  size(t, line = this.line) {
    switch (t.k) {
      case 'char': return 1;
      case 'int': case 'uint': case 'ptr': return this.W;
      case 'arr': return t.n * this.size(t.of, line);
      default: return fail(line, `${typeName(t)} has no size`);
    }
  }
  reg(size) { return size === 1 ? 'A' : 'X'; }
  second(size) { return size === 1 ? 'B' : 'Y'; }
  mask(v, size) { return size === 1 ? v & 0xFF : v & 0xFFFF; }
  signed(t) { return t.k === 'int'; }

  // ------------------------------------------------------------ scopes
  lookup(name, line) {
    for (let s = this.scopes.length - 1; s >= 0; s--) if (this.scopes[s].has(name)) return this.scopes[s].get(name);
    if (this.globals.has(name)) return this.globals.get(name);
    if (this.functions.has(name)) fail(line, `${name} is a function: call it with ${name}(…)`);
    return fail(line, `${name} is not declared`);
  }

  // ------------------------------------------------------------ constants
  constant(e) {
    if (e.konst !== undefined) return e.konst;
    let v = null;
    const c = x => this.constant(x);
    switch (e.k) {
      case 'num': v = e.v; break;
      case 'sizeof': v = this.size(e.type ? this.resolveArray(e.type) : this.typeOf(e.e), e.line); break;
      case 'un': { const a = c(e.e); if (a !== null) v = e.op === '-' ? -a : e.op === '+' ? a : e.op === '~' ? ~a : (a ? 0 : 1); break; }
      case 'cast': { const a = c(e.e); if (a !== null && e.type.k !== 'ptr') v = e.type.k === 'char' ? a & 0xFF : a; else if (a !== null) v = a; break; }
      case 'cond': { const a = c(e.c); if (a !== null) v = a ? c(e.a) : c(e.b); break; }
      case 'bin': {
        const a = c(e.l), b = c(e.r);
        if (a === null || b === null) break;
        if (isPointer(this.typeOf(e.l)) || isPointer(this.typeOf(e.r))) break;
        if ((e.op === '/' || e.op === '%') && b === 0) fail(e.line, 'Division by zero');
        v = { '+': a + b, '-': a - b, '*': a * b, '/': Math.trunc(a / b), '%': a % b, '&': a & b, '|': a | b, '^': a ^ b,
          '<<': a << b, '>>': a >> b, '==': +(a === b), '!=': +(a !== b), '<': +(a < b), '<=': +(a <= b), '>': +(a > b), '>=': +(a >= b),
          '&&': +(!!a && !!b), '||': +(!!a || !!b) }[e.op];
        break;
      }
      default: break;
    }
    // A constant has the type of its expression: (char)300 is 44, -1 as unsigned int is 0xFFFF.
    if (v !== null) {
      const t = this.typeOf(e);
      if (!e.flexible && isInteger(t)) v = this.wrap(v, t);
    }
    e.konst = v;
    return v;
  }
  wrap(v, t) {
    if (t.k === 'char') return v & 0xFF;
    const bits = this.W * 8, m = 2 ** bits;
    v = ((v % m) + m) % m;
    return t.k === 'int' && v >= m / 2 ? v - m : v;
  }
  resolveArray(t) {
    if (t.k !== 'arr' || t.n !== null || !t.sizeExpr) return t;
    const n = this.constant(t.sizeExpr);
    if (n === null || n < 1) fail(t.line, 'The size of an array must be a constant, e.g. char screen[64];');
    return arr(t.of, n);
  }

  /** The type of an expression (arrays not yet decayed). */
  typeOf(e) {
    if (e.type) return e.type;
    let t;
    switch (e.k) {
      case 'num': t = INT; e.flexible = true; break;
      case 'str': t = arr(CHAR, e.bytes.length + 1); break;
      case 'sizeof': t = INT; e.flexible = true; break;
      case 'id': t = this.lookup(e.name, e.line).type; break;
      case 'call': {
        if (e.name === 'in') t = CHAR;
        else if (e.name === 'out') t = VOID;
        else {
          const f = this.functions.get(e.name);
          if (!f) fail(e.line, this.globals.has(e.name) ? `${e.name} is a variable, not a function` : `The function ${e.name} is not declared`);
          t = f.ret;
        }
        break;
      }
      case 'un':
        if (e.op === '!') t = CHAR;
        else {
          const a = decay(this.typeOf(e.e));
          if (!isInteger(a)) fail(e.line, `${e.op} needs a number, not ${typeName(a)}`);
          t = a;
          if (this.typeOf(e.e) && e.e.flexible) e.flexible = true;
        }
        break;
      case 'deref': {
        const a = decay(this.typeOf(e.e));
        if (a.k !== 'ptr') fail(e.line, e.index ? `Only arrays and pointers can be indexed, not ${typeName(a)}` : `* needs a pointer, not ${typeName(a)}`);
        if (a.to.k === 'void') fail(e.line, 'A void* cannot be dereferenced: cast it, e.g. *(char*)p');
        t = a.to;
        break;
      }
      case 'addr': {
        const a = this.typeOf(e.e);
        if (e.e.k === 'id') {
          const s = this.lookup(e.e.name, e.line);
          if (s.where === 'stack') fail(e.line, `&${e.e.name}: MiniC cannot take the address of a local variable. Declare ${e.e.name} outside of the function`);
        } else if (e.e.k !== 'deref') fail(e.line, '& needs a variable or an array element');
        t = ptr(a.k === 'arr' ? a.of : a);
        if (a.k === 'arr') e.arrayAddress = true;
        break;
      }
      case 'cast': this.typeOf(e.e); t = e.type; break;
      case 'inc': {
        const a = this.typeOf(e.e);
        if (!isInteger(a) && a.k !== 'ptr') fail(e.line, `${e.op} needs a number or a pointer`);
        t = a;
        break;
      }
      case 'assign': {
        t = this.typeOf(e.l);
        this.typeOf(e.r);
        if (t.k === 'arr') fail(e.line, 'An array cannot be assigned as a whole: assign its elements one by one');
        break;
      }
      case 'cond': {
        const a = decay(this.typeOf(e.a)), b = decay(this.typeOf(e.b));
        this.typeOf(e.c);
        t = a.k === 'ptr' ? a : b.k === 'ptr' ? b : this.common(e.a, e.b);
        break;
      }
      case 'comma': this.typeOf(e.l); t = this.typeOf(e.r); break;
      case 'bin': {
        const a = decay(this.typeOf(e.l)), b = decay(this.typeOf(e.r));
        if (RELATIONAL.has(e.op) || LOGICAL.has(e.op)) { t = CHAR; break; }
        if (e.op === '+' && (a.k === 'ptr' || b.k === 'ptr')) {
          if (a.k === 'ptr' && b.k === 'ptr') fail(e.line, 'Two pointers cannot be added');
          if (!isInteger(a.k === 'ptr' ? b : a)) fail(e.line, 'A pointer can only be moved by a number');
          t = a.k === 'ptr' ? a : b;
          break;
        }
        if (e.op === '-' && a.k === 'ptr') {
          if (b.k === 'ptr') t = INT;
          else if (isInteger(b)) t = a;
          else fail(e.line, 'Only a number or a pointer can be subtracted from a pointer');
          break;
        }
        if (!isInteger(a) || !isInteger(b)) fail(e.line, `${e.op} needs numbers, not ${typeName(isInteger(a) ? b : a)}`);
        if (e.op === '<<' || e.op === '>>') { t = e.l.flexible ? INT : a; break; }
        t = this.common(e.l, e.r);
        if (e.l.flexible && e.r.flexible) e.flexible = true;
        break;
      }
      default: fail(e.line, 'Unknown expression');
    }
    e.type = t;
    return t;
  }

  /** Common type of two integer operands; a constant adopts the other side's type if it fits. */
  common(l, r) {
    const a = decay(this.typeOf(l)), b = decay(this.typeOf(r));
    const fits = (e, t) => { const v = this.constant(e); return v !== null && (t.k !== 'char' || (v >= 0 && v <= 255)); };
    if (l.flexible && !r.flexible && fits(l, b)) return b;
    if (r.flexible && !l.flexible && fits(r, a)) return a;
    if (a.k === 'ptr' || b.k === 'ptr') return a.k === 'ptr' ? a : b;
    if (a.k === 'uint' || b.k === 'uint') return UINT;
    if (a.k === 'int' || b.k === 'int') return INT;
    return CHAR;
  }

  // ------------------------------------------------------------ temporaries
  push(size) {
    if (this.stack) {
      this.emit(`PUSH ${this.reg(size)}`);
      this.depth += size;
    } else {
      const slot = this.tempDepth++;
      this.temps = Math.max(this.temps, this.tempDepth);
      this.emit(`STA [tmp${slot}], A`);
    }
  }
  /** Pops into the given register (B/Y for the second operand, A/X to restore). */
  pop(size, register) {
    if (this.stack) {
      this.emit(`POP ${register}`);
      this.depth -= size;
    } else {
      const slot = --this.tempDepth;
      this.emit(`LDA ${register}, [tmp${slot}]`);
    }
  }
  callRuntime(name, what, line) {
    if (!this.stack) fail(line, `${what} needs the helper routine ${name}, and calls need a stack: use MiniCPU 8S or 8X (#pragma cpu 8x)`);
    const add = n => { if (this.need.has(n)) return; this.need.add(n); RUNTIME[n].needs.forEach(add); };
    add(name === 'negx16' || name === 'negy16' ? 'neg16' : name);
    this.emit(`CALL ${name}`);
  }

  // ------------------------------------------------------------ variables
  /** Operand text of a variable: [label] or [SP+n]. */
  slot(sym, line, extra = 0) {
    if (sym.where === 'global') return extra ? `[${sym.label} + ${extra}]` : `[${sym.label}]`;
    const offset = this.depth + sym.offset + extra;
    if (offset > 255) fail(line, 'Too many local variables and arguments: [SP+n] reaches only 255 bytes');
    return `[SP+${offset}]`;
  }

  /** A simple operand that can be loaded straight into a register: constant, scalar variable, string. */
  loadDirect(e, register, size) {
    const v = this.constant(e);
    if (v !== null) { this.emit(`LDI ${register}, ${this.mask(v, size)}`); return true; }
    if (e.k === 'id') {
      const sym = this.lookup(e.name, e.line), t = sym.type;
      if (t.k === 'arr') {
        if (sym.where !== 'global' || size !== this.W) return false;
        this.emit(`LDI ${register}, ${sym.label}`);
        return true;
      }
      if (this.size(t) !== size) return false;
      this.emit(`LDA ${register}, ${this.slot(sym, e.line)}`);
      return true;
    }
    if (e.k === 'str' && size === this.W) { this.emit(`LDI ${register}, ${this.string(e.bytes)}`); return true; }
    return false;
  }

  /** The address as an assembler expression, if it is known before the program runs. */
  staticAddress(e) {
    if (e.k === 'id') {
      const sym = this.lookup(e.name, e.line);
      return sym.where === 'global' && sym.type.k === 'arr' ? sym.label : null;
    }
    if (e.k === 'str') return this.string(e.bytes);
    if (e.k === 'addr' && e.e.k === 'id') {
      const sym = this.lookup(e.e.name, e.line);
      return sym.where === 'global' ? sym.label : null;
    }
    if (e.k === 'cast' && e.type.k === 'ptr') {
      const v = this.constant(e.e);
      if (v !== null) return String(v & (this.W === 2 ? 0xFFFF : 0xFF));
      return this.staticAddress(e.e);
    }
    if (e.k === 'bin' && (e.op === '+' || e.op === '-') && decay(this.typeOf(e)).k === 'ptr' && decay(this.typeOf(e.l)).k === 'ptr') {
      const base = this.staticAddress(e.l), v = this.constant(e.r);
      if (base === null || v === null) return null;
      const offset = v * this.size(decay(this.typeOf(e.l)).to, e.line) * (e.op === '-' ? -1 : 1);
      return offset ? `${base} ${offset < 0 ? '-' : '+'} ${Math.abs(offset)}` : base;
    }
    return null;
  }

  string(bytes) {
    const key = bytes.join(',');
    let entry = this.strings.find(s => s.key === key);
    if (!entry) { entry = { key, bytes, label: `string_${this.strings.length + 1}` }; this.strings.push(entry); }
    return entry.label;
  }

  // ------------------------------------------------------------ conversions
  /** Converts the value in A/X from type `from` to type `to`. */
  convert(from, to, line) {
    from = decay(from);
    if (to.k === 'void') return;
    if (from.k === 'void') fail(line, 'A void function returns no value');
    const a = this.size(from, line), b = this.size(to, line);
    if (a === b) return;
    if (a === 1) { this.emit('LDI X, 0'); this.emit('MOV XL, A'); } else this.emit('MOV A, XL');
  }

  /** Computes e as type t into A (8 bits) or X (16 bits). */
  value(e, t) {
    const v = this.constant(e);
    if (v !== null && t.k !== 'void') { this.emit(`LDI ${this.reg(this.size(t))}, ${this.mask(v, this.size(t))}`); return; }
    const from = this.typeOf(e);
    if (t.k === 'ptr' && isInteger(decay(from)) && v === null && decay(from).k !== 'ptr') {
      // int → pointer only with a cast; constants were handled above
    }
    this.gen(e);
    this.convert(from, t, e.line);
  }

  checkAssignable(to, e, line) {
    const from = decay(this.typeOf(e));
    if (to.k === 'ptr' && isInteger(from) && this.constant(e) !== 0) fail(line, `A number is not a ${typeName(to)}: cast it, e.g. (${typeName(to)})${this.constant(e) ?? 'n'}`);
    if (isInteger(to) && from.k === 'ptr' && this.size(to) !== this.W) fail(line, `A pointer does not fit into ${typeName(to)}`);
    if (to.k === 'ptr' && from.k === 'ptr' && from.to.k !== to.to.k && to.to.k !== 'void' && from.to.k !== 'void') {
      this.warnings.push({ line, message: `${typeName(from)} is used as ${typeName(to)}` });
    }
  }

  // ------------------------------------------------------------ expressions
  /** Generates e; the result (decayed) is in A (8 bits) or X (16 bits). */
  gen(e) {
    const t = this.typeOf(e);
    const v = this.constant(e);
    if (v !== null) { this.emit(`LDI ${this.reg(this.size(decay(t)))}, ${this.mask(v, this.size(decay(t)))}`); return; }
    switch (e.k) {
      case 'str': this.emit(`LDI ${this.reg(this.W)}, ${this.string(e.bytes)}`); return;
      case 'id': {
        const sym = this.lookup(e.name, e.line);
        if (sym.type.k === 'arr') {
          if (sym.where !== 'global') fail(e.line, 'Local arrays are not supported');
          this.emit(`LDI ${this.reg(this.W)}, ${sym.label}`);
        } else this.emit(`LDA ${this.reg(this.size(sym.type))}, ${this.slot(sym, e.line)}`);
        return;
      }
      case 'call': return this.call(e);
      case 'assign': return this.assign(e);
      case 'inc': return this.increment(e);
      case 'cast': {
        const from = decay(this.typeOf(e.e));
        if (e.type.k === 'void') { this.gen(e.e); return; }
        this.gen(e.e);
        this.convert(from, e.type, e.line);
        return;
      }
      case 'comma': this.gen(e.l); this.gen(e.r); return;
      case 'deref': return this.load(e);
      case 'addr': {
        const fixed = this.staticAddress(e);
        if (fixed !== null) { this.emit(`LDI ${this.reg(this.W)}, ${fixed}`); return; }
        this.address(e.e);
        return;
      }
      case 'un': {
        const size = this.size(t);
        if (e.op === '!') return this.condition(e);
        this.gen(e.e);
        this.convert(this.typeOf(e.e), t, e.line);
        if (e.op === '+') return;
        if (size === 1) {
          this.emit('XOR A, 0xFF');
          if (e.op === '-') this.emit('INC A');
        } else {
          for (const half of ['XL', 'XH']) { this.emit(`MOV A, ${half}`); this.emit('XOR A, 0xFF'); this.emit(`MOV ${half}, A`); }
          if (e.op === '-') this.emit('INC X');
        }
        return;
      }
      case 'cond': {
        const otherwise = this.newLabel('else'), end = this.newLabel('end');
        this.branch(e.c, otherwise, false);
        this.value(e.a, decay(t));
        this.emit(`JMP ${end}`);
        this.label(otherwise);
        this.value(e.b, decay(t));
        this.label(end);
        return;
      }
      case 'bin':
        if (RELATIONAL.has(e.op) || LOGICAL.has(e.op)) return this.condition(e);
        return this.arithmetic(e);
      default: fail(e.line, 'Unknown expression');
    }
  }

  /** A comparison or logic expression as a value 0 or 1 in A. */
  condition(e) {
    const no = this.newLabel('false'), end = this.newLabel('end');
    this.branch(e, no, false);
    this.emit('LDI A, 1');
    this.emit(`JMP ${end}`);
    this.label(no);
    this.emit('LDI A, 0');
    this.label(end);
  }

  arithmetic(e) {
    const t = decay(this.typeOf(e)), l = decay(this.typeOf(e.l)), r = decay(this.typeOf(e.r));
    // Pointer arithmetic: p ± n moves by n elements, p − q counts elements.
    if (t.k === 'ptr' || (e.op === '-' && l.k === 'ptr')) {
      const pointerLeft = l.k === 'ptr';
      const p = pointerLeft ? e.l : e.r, n = pointerLeft ? e.r : e.l;
      const pt = pointerLeft ? l : r;
      const element = this.size(pt.to, e.line);
      if (e.op === '-' && r.k === 'ptr') {
        this.binary(e.l, e.r, '-', pt, e.line);
        if (element === 2) { this.emit('LDI B, 1'); this.callRuntime('sar16', 'Subtracting int pointers', e.line); }
        return;
      }
      const k = this.constant(n);
      this.gen(p);
      if (k !== null) {
        const delta = k * element;
        if (delta) this.emit(`${e.op === '-' ? 'SUB' : 'ADD'} ${this.reg(this.W)}, ${this.mask(Math.abs(delta) * Math.sign(delta), this.W)}`);
        return;
      }
      const nt = decay(this.typeOf(n));
      if (this.W === 2 && this.size(nt) === 1) {
        // An 8-bit index: ADD X, A adds it to all 16 bits.
        if (!this.loadDirect(n, 'A', 1)) { this.push(2); this.gen(n); this.pop(2, 'X'); }
        for (let i = 0; i < element; i++) this.emit(`${e.op === '-' ? 'SUB' : 'ADD'} X, A`);
        return;
      }
      const size = this.W;
      if (!this.loadDirect(n, this.second(size), size)) {
        this.push(size);
        this.value(n, size === 2 ? INT : CHAR);
        this.emit(`MOV ${this.second(size)}, ${this.reg(size)}`);
        this.pop(size, this.reg(size));
      }
      for (let i = 0; i < element; i++) this.emit(`${e.op === '-' ? 'SUB' : 'ADD'} ${this.reg(size)}, ${this.second(size)}`);
      return;
    }
    if (e.op === '<<' || e.op === '>>') return this.shift(e, t);
    this.binary(e.l, e.r, e.op, t, e.line);
  }

  /** l op r in type t: left in A/X, right as a constant, B/Y, or via the stack. */
  binary(l, r, op, t, line) {
    const size = this.size(t), A = this.reg(size), B = this.second(size);
    this.value(l, t);
    const k = this.constant(r);
    if (k !== null) return this.applyConstant(op, t, k, line);
    if (!this.loadDirect(r, B, size) || decay(this.typeOf(r)).k !== decay(t).k && this.size(decay(this.typeOf(r))) !== size) {
      this.push(size);
      this.value(r, t);
      this.emit(`MOV ${B}, ${A}`);
      this.pop(size, A);
    }
    this.applyRegister(op, t, line);
  }

  applyConstant(op, t, k, line) {
    const size = this.size(t), A = this.reg(size), m = this.mask(k, size);
    const bytewise = name => {
      if (size === 1) { this.emit(`${name} A, ${m}`); return; }
      [['XL', m & 0xFF], ['XH', m >> 8]].forEach(([half, byte]) => {
        if ((name === 'AND' && byte === 0xFF) || (name !== 'AND' && byte === 0)) return;
        this.emit(`MOV A, ${half}`);
        this.emit(`${name} A, ${byte}`);
        this.emit(`MOV ${half}, A`);
      });
    };
    switch (op) {
      case '+': if (m) this.emit(`ADD ${A}, ${m}`); return;
      case '-': if (m) this.emit(`SUB ${A}, ${m}`); return;
      case '&': return bytewise('AND');
      case '|': return bytewise('OR');
      case '^': return bytewise('XOR');
      case '*':
        if (m === 0) { this.emit(`LDI ${A}, 0`); return; }
        if (isPowerOfTwo(m)) { for (let i = 0; i < log2(m); i++) this.emit(size === 1 ? 'SHL A' : 'ADD X, X'); return; }
        break;
      case '/': case '%':
        if (k === 0) fail(line, 'Division by zero');
        if (isPowerOfTwo(m) && !this.signed(t)) {
          if (op === '%') return this.applyConstant('&', t, m - 1, line);
          if (m === 1) return;
          if (size === 1) { for (let i = 0; i < log2(m); i++) this.emit('SHR A'); return; }
          this.emit(`LDI B, ${log2(m)}`);
          this.callRuntime('shr16', '/', line);
          return;
        }
        if (op === '/' && k > 1 && isPowerOfTwo(k) && this.stack) {
          // Signed division by 2^n rounds towards zero: add 2^n − 1 to negative numbers, then shift.
          const positive = this.newLabel('positive');
          this.emit(size === 1 ? 'CMP A, 0x80' : 'MOV A, XH');
          if (size === 2) this.emit('CMP A, 0x80');
          this.emit(`JC ${positive}`);
          this.emit(`ADD ${A}, ${k - 1}`);
          this.label(positive);
          this.emit(`LDI B, ${log2(k)}`);
          this.callRuntime(size === 1 ? 'sar8' : 'sar16', '/', line);
          return;
        }
        break;
      default: break;
    }
    this.emit(`LDI ${this.second(size)}, ${m}`);
    this.applyRegister(op, t, line);
  }

  applyRegister(op, t, line) {
    const size = this.size(t), A = this.reg(size), B = this.second(size), signed = this.signed(t);
    const bytewise = name => {
      if (size === 1) { this.emit(`${name} A, B`); return; }
      for (const [x, y] of [['XL', 'YL'], ['XH', 'YH']]) { this.emit(`MOV A, ${x}`); this.emit(`MOV B, ${y}`); this.emit(`${name} A, B`); this.emit(`MOV ${x}, A`); }
    };
    switch (op) {
      case '+': this.emit(`ADD ${A}, ${B}`); return;
      case '-': this.emit(`SUB ${A}, ${B}`); return;
      case '&': return bytewise('AND');
      case '|': return bytewise('OR');
      case '^': return bytewise('XOR');
      case '*': this.callRuntime(size === 1 ? 'mul8' : 'mul16', '*', line); return;
      case '/': case '%': {
        const routine = `div${signed ? 's' : 'u'}${size === 1 ? 8 : 16}`;
        this.callRuntime(routine, op, line);
        if (op === '%') this.emit(`MOV ${A}, ${B}`);
        return;
      }
      default: fail(line, `Unknown operator ${op}`);
    }
  }

  shift(e, t) {
    const size = this.size(t), k = this.constant(e.r), left = e.op === '<<';
    const routine = `${left ? 'shl' : this.signed(t) ? 'sar' : 'shr'}${size === 1 ? 8 : 16}`;
    this.value(e.l, t);
    if (k !== null) {
      if (k < 0) fail(e.line, 'A shift by a negative amount');
      if (k === 0) return;
      if (k >= size * 8) { this.emit(`LDI ${this.reg(size)}, 0`); return; }
      if (left && (size === 1 || k <= 4)) { for (let i = 0; i < k; i++) this.emit(size === 1 ? 'SHL A' : 'ADD X, X'); return; }
      if (left && k >= 8) {
        this.emit('MOV A, XL'); this.emit('MOV XH, A'); this.emit('LDI A, 0'); this.emit('MOV XL, A');
        for (let i = 8; i < k; i++) this.emit('ADD X, X');
        return;
      }
      if (!left && size === 1 && !this.signed(t)) { for (let i = 0; i < k; i++) this.emit('SHR A'); return; }
      if (!left && size === 2 && k >= 8 && !this.signed(t)) {
        this.emit('MOV A, XH'); this.emit('MOV XL, A'); this.emit('LDI A, 0'); this.emit('MOV XH, A');
        if (k > 8) { this.emit(`LDI B, ${k - 8}`); this.callRuntime('shr16', '>>', e.line); }
        return;
      }
      this.emit(`LDI B, ${k}`);
      this.callRuntime(routine, e.op, e.line);
      return;
    }
    this.push(size);
    this.value(e.r, CHAR);
    this.emit('MOV B, A');
    this.pop(size, this.reg(size));
    this.callRuntime(routine, e.op, e.line);
  }

  // ------------------------------------------------------------ conditions
  /**
   * Jumps to `target` when the truth of e equals `when`, otherwise falls through.
   */
  branch(e, target, when) {
    const k = this.constant(e);
    if (k !== null) { if (!!k === when) this.emit(`JMP ${target}`); return; }
    if (e.k === 'un' && e.op === '!') return this.branch(e.e, target, !when);
    if (e.k === 'bin' && LOGICAL.has(e.op)) {
      const and = e.op === '&&';
      if (and !== when) { this.branch(e.l, target, when); this.branch(e.r, target, when); return; }
      const skip = this.newLabel('skip');
      this.branch(e.l, skip, !when);
      this.branch(e.r, target, when);
      this.label(skip);
      return;
    }
    if (e.k === 'bin' && RELATIONAL.has(e.op)) return this.compare(e, target, when);
    const t = decay(this.typeOf(e));
    if (t.k === 'void') fail(e.line, 'A void function has no value to test');
    this.gen(e);
    this.emit(`CMP ${this.reg(this.size(t))}, 0`);
    this.emit(`${when ? 'JNZ' : 'JZ'} ${target}`);
  }

  compare(e, target, when) {
    let { op, l, r } = e;
    // a > b is b < a, a <= b is b >= a
    if (op === '>' || op === '<=') { [l, r] = [r, l]; op = op === '>' ? '<' : '>='; }
    const lt = decay(this.typeOf(l)), rt = decay(this.typeOf(r));
    let t;
    if (lt.k === 'ptr' || rt.k === 'ptr') {
      if (isInteger(lt) && this.constant(l) !== 0 || isInteger(rt) && this.constant(r) !== 0) fail(e.line, 'A pointer can only be compared with a pointer or 0');
      t = lt.k === 'ptr' ? lt : rt;
    } else t = this.common(l, r);
    const size = this.size(t), A = this.reg(size), B = this.second(size), signed = this.signed(t);
    const flip = register => {
      if (size === 1) { this.emit(`XOR ${register}, 0x80`); return; }
      this.emit(`MOV A, ${register}H`); this.emit('XOR A, 0x80'); this.emit(`MOV ${register}H, A`);
    };
    this.value(l, t);
    const k = this.constant(r);
    if (k !== null) {
      if (signed && op !== '==' && op !== '!=') {
        flip('X'.slice(0, size - 1) || 'A');
        this.emit(`CMP ${A}, ${this.mask(k, size) ^ (size === 1 ? 0x80 : 0x8000)}`);
      } else this.emit(`CMP ${A}, ${this.mask(k, size)}`);
    } else {
      if (!this.loadDirect(r, B, size)) {
        this.push(size);
        this.value(r, t);
        this.emit(`MOV ${B}, ${A}`);
        this.pop(size, A);
      }
      if (signed && op !== '==' && op !== '!=') {
        if (size === 1) { flip('A'); flip('B'); } else { flip('X'); flip('Y'); }
      }
      this.emit(`CMP ${A}, ${B}`);
    }
    const jump = { '==': ['JZ', 'JNZ'], '!=': ['JNZ', 'JZ'], '<': ['JC', 'JNC'], '>=': ['JNC', 'JC'] }[op][when ? 0 : 1];
    this.emit(`${jump} ${target}`);
  }

  // ------------------------------------------------------------ memory
  /** Computes the address of an lvalue (variable or *p) into X (8X) or A. */
  address(e) {
    const fixed = e.k === 'id' ? null : this.staticAddress(e.k === 'deref' ? e.e : e);
    if (e.k === 'id') {
      const sym = this.lookup(e.name, e.line);
      if (sym.where !== 'global') fail(e.line, `MiniC cannot take the address of the local variable ${e.name}`);
      this.emit(`LDI ${this.reg(this.W)}, ${sym.label}`);
      return;
    }
    if (e.k !== 'deref') fail(e.line, 'Only variables and *pointer / array[index] can be assigned');
    if (fixed !== null) { this.emit(`LDI ${this.reg(this.W)}, ${fixed}`); return; }
    this.gen(e.e);
  }

  /** *p as a value. */
  load(e) {
    const t = decay(this.typeOf(e)), size = this.size(t);
    if (this.typeOf(e).k === 'arr') { this.address(e); return; } // an element that is itself an array: its address
    const fixed = this.staticAddress(e.e);
    if (fixed !== null) { this.emit(`LDA ${this.reg(size)}, [${fixed}]`); return; }
    this.gen(e.e);
    if (this.W === 1) { this.emit('MOV B, A'); this.emit('LDA A, [B]'); return; }
    if (size === 1) { this.emit('LDA A, [X]'); return; }
    this.emit('LDA A, [X]'); this.emit('INC X'); this.emit('LDA B, [X]');
    this.emit('MOV XL, A'); this.emit('MOV XH, B');
  }

  /** Stores A/X at the address in Y (8X) or B. */
  storeIndirect(size) {
    if (this.W === 1) { this.emit('STA [B], A'); return; }
    if (size === 1) { this.emit('STA [Y], A'); return; }
    this.emit('MOV A, XL'); this.emit('STA [Y], A'); this.emit('INC Y'); this.emit('MOV A, XH'); this.emit('STA [Y], A');
  }

  hasSideEffects(e) {
    if (!e || typeof e !== 'object') return false;
    if (e.k === 'call' || e.k === 'assign' || e.k === 'inc') return true;
    return ['e', 'l', 'r', 'c', 'a', 'b'].some(key => this.hasSideEffects(e[key]));
  }

  assign(e) {
    const t = this.typeOf(e), lhs = e.l;
    if (lhs.k !== 'id' && lhs.k !== 'deref') fail(e.line, 'Only variables and *pointer / array[index] can be assigned');
    if (lhs.k === 'id' && this.lookup(lhs.name, lhs.line).const) fail(e.line, `${lhs.name} is a constant`);
    let rhs = e.r;
    if (e.op) {
      if (lhs.k === 'deref' && this.hasSideEffects(lhs.e)) fail(e.line, `Write it out: x = x ${e.op} …, because the address here has side effects`);
      rhs = { k: 'bin', op: e.op, l: lhs, r: e.r, line: e.line };
    } else this.checkAssignable(decay(t), rhs, e.line);
    const size = this.size(t);
    if (lhs.k === 'id') {
      const sym = this.lookup(lhs.name, lhs.line);
      this.value(rhs, t);
      this.emit(`STA ${this.slot(sym, e.line)}, ${this.reg(size)}`);
      return;
    }
    const fixed = this.staticAddress(lhs.e);
    if (fixed !== null) {
      this.value(rhs, t);
      this.emit(`STA [${fixed}], ${this.reg(size)}`);
      return;
    }
    // *p = value: the address goes to Y (8X) or B, the value to A/X.
    this.gen(lhs.e);
    if (this.W === 2) {
      if (size === 1 && this.loadDirect(rhs, 'A', 1)) { this.emit('MOV Y, X'); this.storeIndirect(1); return; }
      this.push(2);
      this.value(rhs, t);
      this.pop(2, 'Y');
    } else {
      if (this.loadDirect(rhs, 'B', 1)) { this.emit('MOV C, B'); this.emit('MOV B, A'); this.emit('MOV A, C'); this.storeIndirect(1); return; }
      this.push(1);
      this.value(rhs, t);
      this.pop(1, 'B');
    }
    this.storeIndirect(size);
  }

  increment(e) {
    const t = this.typeOf(e), size = this.size(t), A = this.reg(size);
    const step = t.k === 'ptr' ? this.size(t.to, e.line) : 1;
    const op = e.op === '++' ? 'ADD' : 'SUB';
    const short = step === 1 ? (e.op === '++' ? 'INC' : 'DEC') : null;
    if (e.e.k === 'id') {
      const sym = this.lookup(e.e.name, e.line);
      if (sym.type.k === 'arr') fail(e.line, `${e.e.name} is an array; use a pointer to walk through it`);
      const where = this.slot(sym, e.line);
      this.emit(`LDA ${A}, ${where}`);
      if (e.prefix) {
        this.emit(short ? `${short} ${A}` : `${op} ${A}, ${step}`);
        this.emit(`STA ${where}, ${A}`);
      } else {
        const B = this.second(size);
        this.emit(`MOV ${B}, ${A}`);
        this.emit(short ? `${short} ${B}` : `${op} ${B}, ${step}`);
        this.emit(`STA ${where}, ${B}`);
      }
      return;
    }
    if (e.e.k !== 'deref') fail(e.line, `${e.op} needs a variable or an array element`);
    if (this.hasSideEffects(e.e.e)) fail(e.line, `Write it out: x = x ${e.op === '++' ? '+' : '-'} 1, because the address here has side effects`);
    this.assign({ k: 'assign', op: e.op === '++' ? '+' : '-', l: e.e, r: { k: 'num', v: 1, line: e.line }, line: e.line, type: t });
    if (!e.prefix) this.emit(short ? `${short === 'INC' ? 'DEC' : 'INC'} ${A}` : `${op === 'ADD' ? 'SUB' : 'ADD'} ${A}, ${step}`);
  }

  call(e) {
    if (e.name === 'in') {
      if (e.args.length !== 1) fail(e.line, 'in(port) reads one device port, e.g. in(TIMER)');
      const port = this.constant(e.args[0]);
      if (port === null || port < 0 || port > 255) fail(e.line, 'The port of in(…) must be a constant, e.g. in(JOYSTICK)');
      this.emit(`IN A, 0x${port.toString(16).toUpperCase().padStart(2, '0')}`);
      return;
    }
    if (e.name === 'out') {
      if (e.args.length !== 2) fail(e.line, 'out(port, value) writes one device port, e.g. out(NUMBER, score)');
      const port = this.constant(e.args[0]);
      if (port === null || port < 0 || port > 255) fail(e.line, 'The port of out(…) must be a constant, e.g. out(SPEAKER, 60)');
      this.value(e.args[1], CHAR);
      this.emit(`OUT 0x${port.toString(16).toUpperCase().padStart(2, '0')}, A`);
      return;
    }
    const f = this.functions.get(e.name);
    if (!this.stack) fail(e.line, `Calling ${e.name}() needs a stack: use MiniCPU 8S or 8X (#pragma cpu 8x)`);
    if (e.args.length !== f.params.length) fail(e.line, `${e.name} expects ${f.params.length} argument${f.params.length === 1 ? '' : 's'}, not ${e.args.length}`);
    let bytes = 0;
    e.args.forEach((arg, i) => {
      const t = f.params[i].type;
      this.checkAssignable(t, arg, arg.line ?? e.line);
      this.value(arg, t);
      this.push(this.size(t));
      bytes += this.size(t);
    });
    this.emit(`CALL _${e.name}`);
    if (bytes) { this.emit(`ADD SP, ${bytes}`); this.depth -= bytes; }
  }

  // ------------------------------------------------------------ statements
  statement(s) {
    switch (s.kind) {
      case 'block':
        this.scopes.push(new Map());
        s.items.forEach(item => this.statement(item));
        this.scopes.pop();
        return;
      case 'decls': s.list.forEach(d => this.statement(d)); return;
      case 'decl': {
        this.at(s);
        const scope = this.scopes.at(-1);
        if (scope.has(s.name)) fail(s.line, `${s.name} is declared twice`);
        const sym = s.sym;
        scope.set(s.name, sym);
        if (s.init) {
          this.checkAssignable(s.type, s.init, s.line);
          this.value(s.init, s.type);
          this.emit(`STA ${this.slot(sym, s.line)}, ${this.reg(this.size(s.type))}`);
        }
        return;
      }
      case 'empty': return;
      case 'expr': this.at(s); this.gen(s.expr); return;
      case 'asm': {
        this.at(s);
        for (const line of s.text.split(/\n|;(?=(?:[^"']|"[^"]*"|'[^']*')*$)/)) if (line.trim()) this.emit(line.trim());
        return;
      }
      case 'if': {
        this.at(s);
        const otherwise = this.newLabel('else'), end = this.newLabel('endif');
        this.branch(s.cond, s.otherwise ? otherwise : end, false);
        this.statement(s.then);
        if (s.otherwise) {
          this.emit(`JMP ${end}`);
          this.label(otherwise);
          this.statement(s.otherwise);
        }
        this.label(end);
        return;
      }
      case 'while': {
        this.at(s);
        const top = this.newLabel('while'), end = this.newLabel('endwhile');
        this.label(top);
        this.branch(s.cond, end, false);
        this.loops.push({ breakTo: end, continueTo: top });
        this.statement(s.body);
        this.loops.pop();
        this.line = s.line;
        this.emit(`JMP ${top}`);
        this.label(end);
        return;
      }
      case 'do': {
        this.at(s);
        const top = this.newLabel('do'), next = this.newLabel('dowhile'), end = this.newLabel('enddo');
        this.label(top);
        this.loops.push({ breakTo: end, continueTo: next });
        this.statement(s.body);
        this.loops.pop();
        this.at(s.cond);
        this.label(next);
        this.branch(s.cond, top, true);
        this.label(end);
        return;
      }
      case 'for': {
        this.at(s);
        this.scopes.push(new Map());
        if (s.init) this.statement(s.init);
        const top = this.newLabel('for'), next = this.newLabel('next'), end = this.newLabel('endfor');
        this.label(top);
        this.line = s.line;
        if (s.cond) this.branch(s.cond, end, false);
        this.loops.push({ breakTo: end, continueTo: next });
        this.statement(s.body);
        this.loops.pop();
        this.line = s.line;
        this.label(next);
        if (s.step) this.gen(s.step);
        this.emit(`JMP ${top}`);
        this.label(end);
        this.scopes.pop();
        return;
      }
      case 'break': case 'continue': {
        this.at(s);
        const loop = this.loops.at(-1);
        if (!loop) fail(s.line, `${s.kind} only works inside a loop`);
        this.emit(`JMP ${s.kind === 'break' ? loop.breakTo : loop.continueTo}`);
        return;
      }
      case 'return': {
        this.at(s);
        const f = this.current;
        if (s.value) {
          if (f.ret.k === 'void') fail(s.line, `${f.name} is void and returns no value`);
          this.checkAssignable(f.ret, s.value, s.line);
          this.value(s.value, f.ret);
        } else if (f.ret.k !== 'void' && f.name !== 'main') fail(s.line, `${f.name} must return a ${typeName(f.ret)}`);
        this.emit(`JMP ${f.exit}`);
        return;
      }
      default: fail(s.line, 'Unknown statement');
    }
  }

  /** Assigns stack slots (or static cells on MiniCPU 8) to all locals of a function. */
  allocate(f) {
    let offset = 0;
    const visit = s => {
      if (!s) return;
      if (s.kind === 'decl') {
        if (s.type.k === 'arr') fail(s.line, `${s.name}: arrays must be declared outside of functions in MiniC`);
        const size = this.size(s.type, s.line);
        if (this.stack) { s.sym = { where: 'stack', type: s.type, offset, name: s.name }; offset += size; } else {
          const label = `_${f.name}_${s.name}_${s.line}`;
          s.sym = { where: 'global', type: s.type, label, name: s.name };
          this.statics.push({ label, size, line: s.line });
        }
      }
      for (const key of ['items', 'list']) if (s[key]) s[key].forEach(visit);
      for (const key of ['then', 'otherwise', 'body', 'init']) if (s[key] && typeof s[key] === 'object' && s[key].kind) visit(s[key]);
    };
    visit(f.body);
    return offset;
  }

  func(f) {
    this.current = f;
    this.line = f.line;
    this.commented = 0;
    this.raw('');
    this.at(f);
    if (f.name !== 'main' && !this.stack) fail(f.line, `Functions other than main need a stack: use MiniCPU 8S or 8X (#pragma cpu 8x)`);
    this.label(`_${f.name}`);
    this.depth = 0;
    const frame = this.allocate(f);
    const ret = this.arch.addressBits / 8;
    // Parameters sit above the locals and the return address; the last one is closest.
    const scope = new Map();
    let above = 0;
    for (let i = f.params.length - 1; i >= 0; i--) {
      const p = f.params[i];
      if (scope.has(p.name)) fail(p.line, `The parameter ${p.name} appears twice`);
      scope.set(p.name, { where: 'stack', type: p.type, offset: frame + ret + above, name: p.name });
      above += this.size(p.type, p.line);
    }
    this.scopes = [scope];
    this.loops = [];
    f.exit = `return_${f.name}`;
    if (frame) this.emit(`SUB SP, ${frame}`);
    this.statement(f.body);
    if (this.depth !== 0) fail(f.line, 'Internal error: the stack is not balanced');
    this.line = f.body.line;
    this.label(f.exit);
    if (frame) this.emit(`ADD SP, ${frame}`);
    this.emit(this.stack ? 'RET' : 'HLT');
  }

  // ------------------------------------------------------------ data
  dataBytes(g) {
    const t = g.type, line = g.line;
    const constant = (e, what) => {
      const v = this.constant(e);
      if (v !== null) return v;
      const fixed = isPointer(decay(this.typeOf(e))) ? this.staticAddress(e) : null;
      if (fixed !== null) return fixed;
      return fail(e.line ?? line, `The start value of ${what} must be a constant`);
    };
    const bytes = (value, size) => {
      if (typeof value === 'number') return size === 1 ? [value & 0xFF] : [value & 0xFF, (value >> 8) & 0xFF];
      return size === 1 ? [`${value} & 0xFF`] : [`${value} & 0xFF`, `${value} >> 8`];
    };
    if (t.k === 'arr') {
      const element = this.size(t.of, line);
      let values = [];
      if (g.init?.k === 'str') {
        if (t.of.k !== 'char') fail(line, `A string can only fill a char array, not ${typeName(t)}`);
        values = [...g.init.bytes, 0];
      } else if (g.init?.k === 'list') {
        values = g.init.list.flatMap((e, i) => { this.typeOf(e); return bytes(constant(e, `${g.name}[${i}]`), element); });
      } else if (g.init) fail(line, `An array starts with a list of values, e.g. int ${g.name}[] = {1, 2, 3};`);
      const total = t.n * element;
      if (values.length > total) fail(line, `${g.name} has room for ${t.n} values, but ${values.length / element} are given`);
      while (values.length < total) values.push(0);
      return values;
    }
    if (!g.init) return new Array(this.size(t, line)).fill(0);
    if (g.init.k === 'list') fail(line, `${g.name} is not an array`);
    this.typeOf(g.init);
    this.checkAssignable(t, g.init, line);
    return bytes(constant(g.init, g.name), this.size(t, line));
  }

  emitData(label, values, line) {
    this.line = line;
    if (!values.length) { this.raw(`${label}:`, line); return; }
    for (let i = 0; i < values.length; i += 16) {
      const chunk = values.slice(i, i + 16).join(', ');
      const head = `${label}:`;
      this.raw(i === 0 ? `${head.length < 8 ? head.padEnd(8) : `${head} `}.db ${chunk}` : `        .db ${chunk}`, line);
    }
  }

  stringData(bytes) {
    const parts = [];
    let text = '';
    for (const b of bytes) {
      if (b >= 32 && b < 127 && b !== 34 && b !== 92) text += String.fromCharCode(b);
      else { if (text) parts.push(`"${text}"`); text = ''; parts.push(String(b)); }
    }
    if (text) parts.push(`"${text}"`);
    parts.push('0');
    return parts.join(', ');
  }

  // ------------------------------------------------------------ program
  program(items, pragmas) {
    // Declarations first, so functions can call each other in any order.
    for (const item of items) {
      if (item.kind === 'func') {
        if (['in', 'out'].includes(item.name)) fail(item.line, `${item.name} is built in`);
        const known = this.functions.get(item.name);
        if (known && known.body && item.body) fail(item.line, `The function ${item.name} is defined twice`);
        if (this.globals.has(item.name)) fail(item.line, `${item.name} is already a variable`);
        if (!known || item.body) this.functions.set(item.name, item);
      } else {
        if (this.globals.has(item.name) || this.functions.has(item.name)) fail(item.line, `${item.name} is declared twice`);
        let type = this.resolveArray(item.type);
        if (type.k === 'arr' && type.n === null) {
          if (item.init?.k === 'str') type = arr(type.of, item.init.bytes.length + 1);
          else if (item.init?.k === 'list') type = arr(type.of, item.init.list.length);
          else fail(item.line, `The size of ${item.name} is missing: write ${item.name}[10]`);
        }
        item.type = type;
        this.globals.set(item.name, { where: 'global', type, label: `_${item.name}`, name: item.name, item });
      }
    }
    const main = this.functions.get('main');
    if (!main?.body) fail(0, 'The program needs a function main: void main() { … }');
    for (const f of this.functions.values()) if (!f.body) fail(f.line, `${f.name} is declared but has no body`);
    if (main.params.length) fail(main.line, 'main takes no parameters');

    this.statics = [];
    this.raw(`; Compiled by MiniC for ${this.arch.name}`, 0);
    this.raw(`.cpu ${this.arch.directive}`, pragmas.cpu?.line ?? 0);
    if (pragmas.display) this.raw(`.display ${pragmas.display.text}`, pragmas.display.line);
    if (this.stack) {
      this.raw('', 0);
      this.line = main.line;
      this.emit('CALL _main');
      this.emit('HLT');
    }
    this.func(main);
    for (const f of this.functions.values()) if (f !== main) this.func(f);

    const runtime = Object.keys(RUNTIME).filter(name => this.need.has(name));
    if (runtime.length) {
      this.raw('', 0);
      this.raw('; ---- MiniC runtime: helper routines for the operators above', 0);
      for (const name of runtime) for (const text of RUNTIME[name].code.split('\n')) if (text) this.raw(text, 0);
    }
    const globals = [...this.globals.values()];
    if (globals.length || this.statics.length || this.temps) {
      this.raw('', 0);
      this.raw('; ---- variables', 0);
    }
    for (const g of globals) {
      this.scopes = [];
      this.emitData(g.label, this.dataBytes(g.item), g.item.line);
    }
    for (const s of this.statics) this.emitData(s.label, new Array(s.size).fill(0), s.line);
    for (let i = 0; i < this.temps; i++) this.emitData(`tmp${i}`, [0], 0);
    if (this.strings.length) {
      this.raw('', 0);
      this.raw('; ---- strings', 0);
      for (const s of this.strings) this.raw(`${s.label}: .db ${this.stringData(s.bytes)}`, 0);
    }
  }
}

/**
 * Compiles MiniC source to MiniCPU assembly.
 * Returns {asm, lines: C line of every assembly line (0 = none), architecture, warnings}.
 */
export function compile(source, { architecture: fallback = 'cpu8x' } = {}) {
  const { tokens, lastLine } = tokenize(source);
  const { tokens: expanded, pragmas } = preprocess(tokens);
  const items = new Parser(expanded, lastLine).program();
  const arch = pragmas.cpu?.arch ?? ARCHITECTURES[fallback];
  const generator = new Generator(arch, source);
  generator.program(items, pragmas);
  // A jump to the very next line does nothing: leave it out.
  const out = generator.out.filter(([text], i, all) => {
    const jump = text.match(/^\s+JMP (\w+)$/);
    if (!jump) return true;
    let k = i + 1;
    while (k < all.length && /^\s*(;.*)?$/.test(all[k][0])) k++;
    return all[k]?.[0] !== `${jump[1]}:`;
  });
  return {
    asm: formatSource(out.map(([text]) => text).join('\n')) + '\n',
    lines: out.map(([, line]) => line),
    architecture: arch.id,
    warnings: generator.warnings,
  };
}
