import { architecture } from './architectures.js';
import { OPCODES as OP, BY_CODE, INSTRUCTIONS, REGISTER_NAMES, availableOn, cyclesOf } from './opcodes.js';

export class CpuFault extends Error {
  constructor(pc, message) { super(message); this.name = 'CpuFault'; this.pc = pc; }
}
export const hex = (v, digits = 2) => Number(v).toString(16).toUpperCase().padStart(digits, '0');

const NAME = REGISTER_NAMES;

/**
 * The MiniCPU interpreter. Code, data, stack and pixels all live in one RAM.
 * Every step is journaled (old register values and overwritten bytes), so
 * execution can be undone step by step without copying the whole RAM.
 */
export class MiniCPU {
  constructor(memory = new Uint8Array(256), profile = 'cpu8', { historySize = 50000 } = {}) {
    this.arch = architecture(profile);
    this.historySize = historySize;
    // Clock cycles per opcode: [taken, not taken] (they only differ for Jcc).
    this.timing = new Uint8Array(512);
    for (const info of INSTRUCTIONS) {
      this.timing[info.code * 2] = cyclesOf(info, this.arch, true);
      this.timing[info.code * 2 + 1] = cyclesOf(info, this.arch, false);
    }
    this.allowed = new Uint8Array(256);
    for (const info of INSTRUCTIONS) if (availableOn(info, this.arch.id)) this.allowed[info.code] = 1;
    this.load(memory);
  }

  load(memory) {
    if (memory.length > this.arch.memorySize) throw new RangeError(`RAM is limited to ${this.arch.memorySize} bytes`);
    this.memory = new Uint8Array(this.arch.memorySize);
    this.memory.set(memory);
    this.registers = new Uint8Array(4);
    this.pc = 0; this.zf = false; this.cf = false; this.halted = false;
    this.cycles = 0;       // clock cycles
    this.instructions = 0; // executed instructions
    this.sp = this.arch.stack ? this.arch.memorySize : null;
    this.x = this.arch.index ? 0 : null;
    this.y = this.arch.index ? 0 : null;
    this.fault = null;
    this.history = [];
    this.historyStart = 0; // ring buffer: oldest entry
    this.lastRecord = null;
  }

  get canUndo() { return this.history.length > 0; }

  /** Executes one instruction. Throws CpuFault (state unchanged) on errors. */
  step() {
    if (this.halted || this.fault) return null;
    const mem = this.memory, r = this.registers, wide = this.arch.index;
    const start = this.pc;
    const record = this.current = {
      pc: start, a: r[0], b: r[1], c: r[2], d: r[3], zf: this.zf, cf: this.cf,
      sp: this.sp, x: this.x, y: this.y, writes: null, cycles: 0,
    };
    let opcode = 0, skipped = 0;
    try {
      opcode = this.fetch();
      if (!this.allowed[opcode]) {
        const info = BY_CODE[opcode];
        this.fail(info ? `${info.syntax.split(' ')[0]} needs ${info.since === 'cpu8s' ? 'MiniCPU 8S or 8X' : 'MiniCPU 8X'}` : `Unknown opcode 0x${hex(opcode)}`);
      }
      switch (opcode) {
        case OP.NOP: break;
        case OP.HLT: this.halted = true; this.pc = start; break;
        case OP.CLF: this.zf = false; this.cf = false; break;

        case OP.LDI: { const d = this.reg(); r[d] = this.fetch(); break; }
        case OP.LDA: { const d = this.reg(); r[d] = mem[this.checked(this.address())]; break; }
        case OP.LDA_R: { this.pair(); r[this.d] = mem[r[this.s]]; break; }
        case OP.STA: { const addr = this.address(), s = this.reg(); this.write(addr, r[s]); break; }
        case OP.STA_R: { this.pair(); this.write(r[this.d], r[this.s]); break; }
        case OP.MOV: {
          const b = this.fetch(), d = b >> 4, s = b & 15, limit = wide ? 8 : 4;
          if (d >= limit || s >= limit) this.fail(`Invalid register pair 0x${hex(b)}`);
          this.setRegister(d, this.getRegister(s));
          break;
        }
        case OP.LDA_X: { const d = this.reg(); r[d] = mem[this.checked(this.x)]; break; }
        case OP.STA_X: { const s = this.reg(); this.write(this.x, r[s]); break; }
        case OP.LDX: this.x = this.fetch() | (this.fetch() << 8); break;
        case OP.INCX: this.x = (this.x + 1) & 0xFFFF; break;
        case OP.DECX: this.x = (this.x - 1) & 0xFFFF; break;
        case OP.LDA_Y: { const d = this.reg(); r[d] = mem[this.checked(this.y)]; break; }
        case OP.STA_Y: { const s = this.reg(); this.write(this.y, r[s]); break; }
        case OP.LDY: this.y = this.fetch() | (this.fetch() << 8); break;
        case OP.INCY: this.y = (this.y + 1) & 0xFFFF; break;
        case OP.DECY: this.y = (this.y - 1) & 0xFFFF; break;

        case OP.ADD: { this.pair(); const v = r[this.d] + r[this.s]; r[this.d] = v; this.cf = v > 255; this.zf = (v & 255) === 0; break; }
        case OP.SUB: { this.pair(); const v = r[this.d] - r[this.s]; r[this.d] = v; this.cf = v < 0; this.zf = (v & 255) === 0; break; }
        case OP.INC: { const d = this.reg(), v = r[d] + 1; r[d] = v; this.cf = v > 255; this.zf = (v & 255) === 0; break; }
        case OP.DEC: { const d = this.reg(), v = r[d] - 1; r[d] = v; this.cf = v < 0; this.zf = (v & 255) === 0; break; }
        case OP.SHL: { const d = this.reg(), v = r[d] << 1; r[d] = v; this.cf = v > 255; this.zf = (v & 255) === 0; break; }
        case OP.SHR: { const d = this.reg(), v = r[d]; this.cf = (v & 1) === 1; r[d] = v >> 1; this.zf = r[d] === 0; break; }

        case OP.AND: { this.pair(); r[this.d] &= r[this.s]; this.cf = false; this.zf = r[this.d] === 0; break; }
        case OP.OR: { this.pair(); r[this.d] |= r[this.s]; this.cf = false; this.zf = r[this.d] === 0; break; }
        case OP.XOR: { this.pair(); r[this.d] ^= r[this.s]; this.cf = false; this.zf = r[this.d] === 0; break; }

        case OP.CMP: { const d = this.reg(), v = r[d] - this.fetch(); this.cf = v < 0; this.zf = v === 0; break; }
        case OP.CMP_R: { this.pair(); const v = r[this.d] - r[this.s]; this.cf = v < 0; this.zf = v === 0; break; }

        case OP.PUSH: { const s = this.reg(); this.push(r[s]); break; }
        case OP.POP: { const d = this.reg(); r[d] = this.pop(); break; }
        case OP.CALL: {
          const target = this.checked(this.address());
          if (wide) this.push(this.pc >> 8);
          this.push(this.pc & 0xFF);
          this.pc = target;
          break;
        }
        case OP.LDA_SP: { const d = this.reg(); r[d] = mem[this.checked(this.sp + this.fetch())]; break; }
        case OP.STA_SP: { const n = this.fetch(), s = this.reg(); this.write(this.sp + n, r[s]); break; }
        case OP.SUB_SP: { const n = this.fetch(); if (this.sp - n < 0) this.fail('Stack overflow'); this.sp -= n; break; }
        case OP.ADD_SP: { const n = this.fetch(); if (this.sp + n > mem.length) this.fail('Stack underflow: more freed than was reserved'); this.sp += n; break; }
        case OP.RET: {
          const low = this.pop(), high = wide ? this.pop() : 0;
          this.pc = this.checked((high << 8) | low);
          break;
        }

        case OP.JMP: case OP.JZ: case OP.JNZ: case OP.JC: case OP.JNC: {
          const target = this.checked(this.address());
          const taken = opcode === OP.JMP || (opcode === OP.JZ && this.zf) || (opcode === OP.JNZ && !this.zf)
            || (opcode === OP.JC && this.cf) || (opcode === OP.JNC && !this.cf);
          if (taken) this.pc = target; else skipped = 1;
          break;
        }
        default: this.fail(`Unknown opcode 0x${hex(opcode)}`);
      }
    } catch (error) {
      this.undoRecord(record);
      if (error instanceof CpuFault) this.fault = error;
      throw error;
    }
    record.cycles = this.timing[opcode * 2 + skipped];
    this.cycles += record.cycles;
    this.instructions++;
    this.remember(record);
    return record;
  }

  fail(message) { throw new CpuFault(this.current.pc, message); }
  checked(addr) { return addr >= 0 && addr < this.memory.length ? addr : this.fail(`Address 0x${hex(addr, 4)} is outside RAM`); }
  fetch() { return this.pc < this.memory.length ? this.memory[this.pc++] : this.fail('The program counter left RAM'); }
  address() { return this.arch.index ? this.fetch() | (this.fetch() << 8) : this.fetch(); }
  reg() { const n = this.fetch(); return n < 4 ? n : this.fail(`Invalid register number ${n}`); }
  pair() {
    const b = this.fetch();
    this.d = b >> 4; this.s = b & 15;
    if (this.d > 3 || this.s > 3) this.fail(`Invalid register pair 0x${hex(b)}`);
  }
  write(addr, value) {
    this.checked(addr);
    const rec = this.current;
    (rec.writes ??= []).push(addr, this.memory[addr]);
    this.memory[addr] = value;
  }
  push(value) {
    if (this.sp <= 0) this.fail('Stack overflow');
    this.write(this.sp - 1, value);
    this.sp--;
  }
  pop() {
    if (this.sp >= this.memory.length) this.fail('Stack underflow: POP or RET without a matching PUSH or CALL');
    return this.memory[this.sp++];
  }

  getRegister(n) {
    if (n < 4) return this.registers[n];
    return [this.x & 0xFF, this.x >> 8, this.y & 0xFF, this.y >> 8][n - 4];
  }

  setRegister(n, value) {
    if (n < 4) this.registers[n] = value;
    else if (n === 4) this.x = (this.x & 0xFF00) | value;
    else if (n === 5) this.x = (this.x & 0x00FF) | (value << 8);
    else if (n === 6) this.y = (this.y & 0xFF00) | value;
    else this.y = (this.y & 0x00FF) | (value << 8);
  }

  remember(record) {
    const h = this.history;
    if (h.length < this.historySize) h.push(record);
    else { h[this.historyStart] = record; this.historyStart = (this.historyStart + 1) % this.historySize; }
    this.lastRecord = record;
  }

  /** Undoes the most recent step. Returns false if there is no history left. */
  back() {
    const h = this.history;
    if (!h.length) return false;
    let record;
    if (this.historyStart === 0) record = h.pop();
    else {
      // Unroll the ring buffer once; afterwards it behaves like a plain stack.
      this.history = h.slice(this.historyStart).concat(h.slice(0, this.historyStart));
      this.historyStart = 0;
      record = this.history.pop();
    }
    this.undoRecord(record);
    this.halted = false;
    this.fault = null;
    this.cycles -= record.cycles;
    this.instructions--;
    this.lastRecord = this.history.length ? this.history[this.history.length - 1] : null;
    return true;
  }

  undoRecord(record) {
    const w = record.writes;
    if (w) for (let i = w.length - 2; i >= 0; i -= 2) this.memory[w[i]] = w[i + 1];
    this.registers[0] = record.a; this.registers[1] = record.b; this.registers[2] = record.c; this.registers[3] = record.d;
    this.pc = record.pc; this.zf = record.zf; this.cf = record.cf; this.sp = record.sp; this.x = record.x; this.y = record.y;
  }

  /** Registers changed by the most recent step: names like 'A', 'X', 'SP', 'ZF'. */
  changedByLastStep() {
    const rec = this.lastRecord, changed = new Set();
    if (!rec) return changed;
    ['a', 'b', 'c', 'd'].forEach((key, i) => { if (rec[key] !== this.registers[i]) changed.add(NAME[i]); });
    if (rec.zf !== this.zf) changed.add('ZF');
    if (rec.cf !== this.cf) changed.add('CF');
    if (rec.sp !== this.sp) changed.add('SP');
    if (rec.x !== this.x) changed.add('X');
    if (rec.y !== this.y) changed.add('Y');
    return changed;
  }

  /** Decodes the instruction at an address (without executing it). */
  disassemble(addr = this.pc) {
    return disassemble(this.memory, addr, this.arch);
  }
}

export function disassemble(mem, addr, arch) {
  const wide = arch.addressBits === 16, digits = wide ? 4 : 2;
  let at = addr;
  const next = () => mem[at++] ?? 0;
  const info = BY_CODE[next()];
  if (!info) return { text: `.db 0x${hex(mem[addr] ?? 0)}`, size: 1 };
  const regName = n => NAME[n] ?? `?${n}`;
  const address = () => `0x${hex(wide ? next() | (next() << 8) : next(), digits)}`;
  const mnemonic = info.syntax.split(' ')[0];
  let operands = '';
  switch (info.form) {
    case 'r': {
      const n = regName(next());
      operands = info.name.endsWith('_X') || info.name.endsWith('_Y')
        ? (info.name.startsWith('LDA') ? `${n}, [${info.name.at(-1)}]` : `[${info.name.at(-1)}], ${n}`)
        : n;
      break;
    }
    case 'ri': { const n = regName(next()); operands = `${n}, ${next()}`; break; }
    case 'rr': {
      const b = next(), d = regName(b >> 4), s = regName(b & 15);
      operands = info.name === 'LDA_R' ? `${d}, [${s}]` : info.name === 'STA_R' ? `[${d}], ${s}` : `${d}, ${s}`;
      break;
    }
    case 'ra': { const n = regName(next()); operands = `${n}, ${address()}`; break; }
    case 'ar': { const a = address(); operands = `${a}, ${regName(next())}`; break; }
    case 'a': operands = address(); break;
    case 'w': operands = `0x${hex(next() | (next() << 8), 4)}`; break;
    case 'i': operands = `SP, ${next()}`; break;
    case 'rs': { const n = regName(next()); operands = `${n}, [SP+${next()}]`; break; }
    case 'sr': { const off = next(); operands = `[SP+${off}], ${regName(next())}`; break; }
    default: break;
  }
  return { text: operands ? `${mnemonic} ${operands}` : mnemonic, size: at - addr };
}
