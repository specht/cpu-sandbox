import { architecture } from './architectures.js';
import { Devices } from './devices.js';
import { OPCODES as OP, BY_CODE, INSTRUCTIONS, REGISTER_NAMES, availableOn, cyclesOf } from './opcodes.js';

export class CpuFault extends Error {
  constructor(pc, message) { super(message); this.name = 'CpuFault'; this.pc = pc; }
}
export const hex = (v, digits = 2) => Number(v).toString(16).toUpperCase().padStart(digits, '0');

const NAME = REGISTER_NAMES;
const BYTE = 1, HALF = 2, WIDE = 4; // register kinds an operand may be
const ROW = 12; // journal row: pc, A, B, C, D, flags, SP, X, Y, cycles, out port, old out value

/**
 * The MiniCPU interpreter. Code, data, stack and pixels all live in one RAM.
 * Every step is journaled (old register values and overwritten bytes), so
 * execution can be undone step by step without copying the whole RAM.
 *
 * Registers: A–D (8 bits); on 8S also SP; on 8X also X and Y (16 bits), whose
 * bytes XL, XH, YL, YH can be used with MOV.
 */
export class MiniCPU {
  constructor(memory = new Uint8Array(256), profile = 'cpu8', { historySize = 50000, devices = new Devices(), clockHz = 1e6 } = {}) {
    this.arch = architecture(profile);
    this.io = devices;
    this.clockHz = clockHz; // only used for the machine time (timer port)
    this.historySize = historySize;
    // Clock cycles per opcode: [taken, not taken, with X/Y] (taken/not taken only differ for Jcc).
    this.timing = new Uint8Array(256 * 3);
    for (const info of INSTRUCTIONS) {
      this.timing[info.code * 3] = cyclesOf(info, this.arch, { taken: true });
      this.timing[info.code * 3 + 1] = cyclesOf(info, this.arch, { taken: false });
      this.timing[info.code * 3 + 2] = cyclesOf(info, this.arch, { wide: true });
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
    this.time = 0;         // machine time in seconds: cycles / clock
    this.sp = this.arch.stack ? this.arch.memorySize : null;
    this.x = this.arch.index ? 0 : null;
    this.y = this.arch.index ? 0 : null;
    this.fault = null;
    // The journal: one row per step in a ring buffer of typed arrays (no
    // garbage for the collector, so a long history costs no speed), and a
    // ring of [address, old byte] pairs for the RAM writes.
    const size = this.historySize;
    this.rows = new Int32Array(size * ROW);
    this.times = new Float64Array(size);
    this.writeStart = new Float64Array(size);
    this.logSize = Math.max(1024, size * 4);
    this.log = new Int32Array(this.logSize * 2);
    this.logTotal = 0;     // pairs written so far
    this.head = 0;         // next row
    this.count = 0;        // rows that can be undone
  }

  get canUndo() { return this.count > 0; }

  /** Executes one instruction and returns its cycles. Throws CpuFault (state unchanged) on errors. */
  step() {
    if (this.halted || this.fault) return null;
    const r = this.registers, start = this.startPc = this.pc;
    const row = this.head, at = row * ROW, rows = this.rows;
    rows[at] = start; rows[at + 1] = r[0]; rows[at + 2] = r[1]; rows[at + 3] = r[2]; rows[at + 4] = r[3];
    rows[at + 5] = (this.zf ? 1 : 0) | (this.cf ? 2 : 0);
    rows[at + 6] = this.sp ?? -1; rows[at + 7] = this.x ?? -1; rows[at + 8] = this.y ?? -1;
    rows[at + 10] = -1; rows[at + 11] = -1;
    this.times[row] = this.time;
    this.writeStart[row] = this.logTotal;
    let opcode = 0, timing = 0;
    this.wideOp = false;
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

        case OP.LDI: { const d = this.reg(BYTE | WIDE); this.set(d, this.constant(d)); break; }
        case OP.LDA: { const d = this.reg(BYTE | WIDE); this.set(d, this.read(this.address(), d)); break; }
        case OP.STA: { const addr = this.address(), s = this.reg(BYTE | WIDE); this.store(addr, s); break; }
        case OP.LDA_R: { const [d, p] = this.pair(BYTE, BYTE | WIDE); this.wideOp = false; this.set(d, this.read(this.get(p), d)); break; }
        case OP.STA_R: { const [p, s] = this.pair(BYTE | WIDE, BYTE); this.wideOp = false; this.store(this.get(p), s); break; }
        case OP.MOV: {
          const [d, s] = this.pair(BYTE | HALF | WIDE, BYTE | HALF | WIDE);
          if ((d >= 8) !== (s >= 8)) this.fail(`MOV ${NAME[d]}, ${NAME[s]}: registers of different sizes`);
          this.set(d, this.get(s));
          break;
        }

        case OP.ADD: case OP.SUB: case OP.CMP: {
          const [d, s] = this.pair(BYTE | WIDE, BYTE | WIDE);
          if (d < 8 && s >= 8) this.fail(`${NAME[d]} cannot take a 16-bit register`);
          this.arith(opcode === OP.ADD ? 1 : -1, d, this.get(s), opcode !== OP.CMP);
          break;
        }
        case OP.ADD_I: case OP.SUB_I: case OP.CMP_I: {
          const d = this.reg(BYTE | WIDE);
          this.arith(opcode === OP.ADD_I ? 1 : -1, d, this.constant(d), opcode !== OP.CMP_I);
          break;
        }
        case OP.ADC: case OP.SBC: { const [d, s] = this.pair(BYTE, BYTE); this.arith(opcode === OP.ADC ? 1 : -1, d, r[s], true, this.cf ? 1 : 0); break; }
        case OP.ADC_I: case OP.SBC_I: { const d = this.reg(BYTE); this.arith(opcode === OP.ADC_I ? 1 : -1, d, this.fetch(), true, this.cf ? 1 : 0); break; }
        case OP.INC: { const d = this.reg(BYTE | WIDE); this.arith(1, d, 1, true); break; }
        case OP.DEC: { const d = this.reg(BYTE | WIDE); this.arith(-1, d, 1, true); break; }
        case OP.SHL: { const d = this.reg(BYTE), v = r[d] << 1; r[d] = v; this.cf = v > 255; this.zf = (v & 255) === 0; break; }
        case OP.SHR: { const d = this.reg(BYTE), v = r[d]; this.cf = (v & 1) === 1; r[d] = v >> 1; this.zf = r[d] === 0; break; }

        case OP.AND: case OP.OR: case OP.XOR: { const [d, s] = this.pair(BYTE, BYTE); this.logic(opcode, d, r[s]); break; }
        case OP.AND_I: { const d = this.reg(BYTE); this.logic(OP.AND, d, this.fetch()); break; }
        case OP.OR_I: { const d = this.reg(BYTE); this.logic(OP.OR, d, this.fetch()); break; }
        case OP.XOR_I: { const d = this.reg(BYTE); this.logic(OP.XOR, d, this.fetch()); break; }

        case OP.PUSH: {
          const s = this.reg(BYTE | WIDE), v = this.get(s);
          if (s >= 8) { this.push(v >> 8); this.push(v & 0xFF); } else this.push(v);
          break;
        }
        case OP.POP: {
          const d = this.reg(BYTE | WIDE);
          this.set(d, d >= 8 ? this.pop() | (this.pop() << 8) : this.pop());
          break;
        }
        case OP.CALL: {
          const target = this.checked(this.address());
          if (this.arch.index) this.push(this.pc >> 8);
          this.push(this.pc & 0xFF);
          this.pc = target;
          break;
        }
        case OP.RET: {
          const low = this.pop(), high = this.arch.index ? this.pop() : 0;
          this.pc = this.checked((high << 8) | low);
          break;
        }
        case OP.LDA_SP: { const d = this.reg(BYTE | WIDE); this.set(d, this.read(this.sp + this.fetch(), d)); break; }
        case OP.STA_SP: { const n = this.fetch(), s = this.reg(BYTE | WIDE); this.store(this.sp + n, s); break; }
        case OP.ADD_SP: { const n = this.fetch(); if (this.sp + n > this.memory.length) this.fail('Stack underflow: more freed than was reserved'); this.sp += n; break; }
        case OP.SUB_SP: { const n = this.fetch(); if (this.sp - n < 0) this.fail('Stack overflow'); this.sp -= n; break; }

        case OP.JMP: case OP.JZ: case OP.JNZ: case OP.JC: case OP.JNC: {
          const target = this.checked(this.address());
          const taken = opcode === OP.JMP || (opcode === OP.JZ && this.zf) || (opcode === OP.JNZ && !this.zf)
            || (opcode === OP.JC && this.cf) || (opcode === OP.JNC && !this.cf);
          if (taken) this.pc = target; else timing = 1;
          break;
        }

        case OP.IN: {
          const d = this.reg(BYTE), port = this.fetch(), value = this.io.read(port, this);
          if (value === undefined) this.fail(`Nothing is plugged into port 0x${hex(port)}`);
          r[d] = value;
          break;
        }
        case OP.OUT: {
          const port = this.fetch(), s = this.reg(BYTE), before = this.io.outputs.get(port);
          if (!this.io.write(port, r[s])) this.fail(`Nothing is plugged into port 0x${hex(port)}`);
          rows[at + 10] = port; rows[at + 11] = before === undefined ? -1 : before;
          break;
        }
        default: this.fail(`Unknown opcode 0x${hex(opcode)}`);
      }
    } catch (error) {
      this.undoRow(row);
      if (error instanceof CpuFault) this.fault = error;
      throw error;
    }
    if (this.wideOp) timing = 2;
    const cycles = this.timing[opcode * 3 + timing];
    rows[at + 9] = cycles;
    this.cycles += cycles;
    this.time += cycles / this.clockHz;
    this.instructions++;
    // Commit the row; forget the oldest rows whose RAM writes the log has overwritten.
    const size = this.historySize;
    this.head = (row + 1) % size;
    if (this.count < size) this.count++;
    const limit = this.logTotal - this.logSize;
    while (this.count && this.writeStart[(this.head - this.count + size) % size] < limit) this.count--;
    return cycles;
  }

  // ------------------------------------------------------------ operands

  fail(message) { throw new CpuFault(this.startPc, message); }
  checked(addr) { return addr >= 0 && addr < this.memory.length ? addr : this.fail(`Address 0x${hex(addr, 4)} is outside RAM`); }
  fetch() { return this.pc < this.memory.length ? this.memory[this.pc++] : this.fail('The program counter left RAM'); }
  address() { return this.arch.index ? this.fetch() | (this.fetch() << 8) : this.fetch(); }

  /** Checks a register number against the kinds an operand allows and the CPU level. */
  check(n, kinds) {
    const kind = n < 4 ? BYTE : n < 8 ? HALF : n < 10 ? WIDE : 0;
    if (!kind || (kind !== BYTE && !this.arch.index) || !(kinds & kind)) this.fail(`Invalid register number ${n}`);
    if (kind === WIDE) this.wideOp = true;
    return n;
  }
  reg(kinds) { return this.check(this.fetch(), kinds); }
  pair(first, second) { const b = this.fetch(); return [this.check(b >> 4, first), this.check(b & 15, second)]; }
  /** A constant: two bytes (low first) for X/Y, else one. */
  constant(n) { return n >= 8 ? this.fetch() | (this.fetch() << 8) : this.fetch(); }

  get(n) {
    if (n < 4) return this.registers[n];
    switch (n) {
      case 4: return this.x & 0xFF;
      case 5: return this.x >> 8;
      case 6: return this.y & 0xFF;
      case 7: return this.y >> 8;
      case 8: return this.x;
      default: return this.y;
    }
  }

  set(n, value) {
    if (n < 4) this.registers[n] = value;
    else if (n === 4) this.x = (this.x & 0xFF00) | (value & 0xFF);
    else if (n === 5) this.x = (this.x & 0x00FF) | ((value & 0xFF) << 8);
    else if (n === 6) this.y = (this.y & 0xFF00) | (value & 0xFF);
    else if (n === 7) this.y = (this.y & 0x00FF) | ((value & 0xFF) << 8);
    else if (n === 8) this.x = value & 0xFFFF;
    else this.y = value & 0xFFFF;
  }

  /** Reads one byte, or two (low byte first) when the register is X or Y. */
  read(addr, n) {
    const mem = this.memory;
    return n >= 8 ? mem[this.checked(addr)] | (mem[this.checked(addr + 1)] << 8) : mem[this.checked(addr)];
  }

  store(addr, n) {
    const v = this.get(n);
    if (n >= 8) { this.write(addr, v & 0xFF); this.write(addr + 1, v >> 8); } else this.write(addr, v);
  }

  /** ADD/SUB/CMP/INC/DEC/ADC/SBC with ZF and CF for 8 or 16 bits. */
  arith(sign, d, operand, keep, carry = 0) {
    const wide = d >= 8, max = wide ? 0xFFFF : 0xFF;
    const v = sign > 0 ? this.get(d) + operand + carry : this.get(d) - operand - carry;
    this.cf = sign > 0 ? v > max : v < 0;
    this.zf = (v & max) === 0;
    if (keep) this.set(d, v & max);
  }

  logic(opcode, d, operand) {
    const r = this.registers;
    if (opcode === OP.AND) r[d] &= operand; else if (opcode === OP.OR) r[d] |= operand; else r[d] ^= operand;
    this.cf = false;
    this.zf = r[d] === 0;
  }

  write(addr, value) {
    this.checked(addr);
    const i = (this.logTotal % this.logSize) * 2;
    this.log[i] = addr;
    this.log[i + 1] = this.memory[addr];
    this.logTotal++;
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

  // ------------------------------------------------------------ history

  /** Undoes the most recent step. Returns false if there is no history left. */
  back() {
    if (!this.count) return false;
    const row = (this.head - 1 + this.historySize) % this.historySize, at = row * ROW;
    this.undoRow(row);
    this.head = row;
    this.count--;
    this.halted = false;
    this.fault = null;
    this.cycles -= this.rows[at + 9];
    this.time = this.times[row];
    if (this.rows[at + 10] >= 0) this.io.restore(this.rows[at + 10], this.rows[at + 11] < 0 ? undefined : this.rows[at + 11]);
    this.instructions--;
    return true;
  }

  /** Restores the registers of a row and the RAM bytes written since it began. */
  undoRow(row) {
    const rows = this.rows, at = row * ROW, start = this.writeStart[row];
    for (let k = this.logTotal - 1; k >= start; k--) {
      const i = (k % this.logSize) * 2;
      this.memory[this.log[i]] = this.log[i + 1];
    }
    this.logTotal = start;
    this.pc = rows[at];
    this.registers[0] = rows[at + 1]; this.registers[1] = rows[at + 2]; this.registers[2] = rows[at + 3]; this.registers[3] = rows[at + 4];
    this.zf = (rows[at + 5] & 1) !== 0; this.cf = (rows[at + 5] & 2) !== 0;
    this.sp = rows[at + 6] < 0 ? null : rows[at + 6];
    this.x = rows[at + 7] < 0 ? null : rows[at + 7];
    this.y = rows[at + 8] < 0 ? null : rows[at + 8];
  }

  /** Addresses the most recent step wrote to. */
  lastWrites() {
    if (!this.count) return [];
    const row = (this.head - 1 + this.historySize) % this.historySize, out = [];
    for (let k = this.writeStart[row]; k < this.logTotal; k++) out.push(this.log[(k % this.logSize) * 2]);
    return out;
  }

  /** Registers changed by the most recent step: names like 'A', 'X', 'SP', 'ZF'. */
  changedByLastStep() {
    const changed = new Set();
    if (!this.count) return changed;
    const at = ((this.head - 1 + this.historySize) % this.historySize) * ROW, rows = this.rows;
    for (let i = 0; i < 4; i++) if (rows[at + 1 + i] !== this.registers[i]) changed.add(NAME[i]);
    if (((rows[at + 5] & 1) !== 0) !== this.zf) changed.add('ZF');
    if (((rows[at + 5] & 2) !== 0) !== this.cf) changed.add('CF');
    if (rows[at + 6] !== (this.sp ?? -1)) changed.add('SP');
    if (rows[at + 7] !== (this.x ?? -1)) changed.add('X');
    if (rows[at + 8] !== (this.y ?? -1)) changed.add('Y');
    return changed;
  }

  /** Decodes the instruction at an address (without executing it). */
  disassemble(addr = this.pc) {
    return disassemble(this.memory, addr, this.arch);
  }
}

/** The instruction at `addr` as source text, and its size in bytes. */
export function disassemble(mem, addr, arch) {
  const wideAddresses = arch.addressBits === 16, digits = wideAddresses ? 4 : 2;
  let at = addr;
  const next = () => mem[at++] ?? 0;
  const info = BY_CODE[next()];
  if (!info) return { text: `.db 0x${hex(mem[addr] ?? 0)}`, size: 1 };
  const name = n => NAME[n] ?? `?${n}`;
  const address = () => `[0x${hex(wideAddresses ? next() | (next() << 8) : next(), digits)}]`;
  const target = () => `0x${hex(wideAddresses ? next() | (next() << 8) : next(), digits)}`;
  const constant = n => (n >= 8 ? `0x${hex(next() | (next() << 8), 4)}` : String(next()));
  const mnemonic = info.syntax.split(' ')[0];
  let operands = '';
  switch (info.form) {
    case 'r': operands = name(next()); break;
    case 'ri': { const n = next(); operands = `${name(n)}, ${constant(n)}`; break; }
    case 'rr': {
      const b = next(), d = name(b >> 4), s = name(b & 15);
      operands = info.name === 'LDA_R' ? `${d}, [${s}]` : info.name === 'STA_R' ? `[${d}], ${s}` : `${d}, ${s}`;
      break;
    }
    case 'ra': { const n = name(next()); operands = `${n}, ${address()}`; break; }
    case 'ar': { const a = address(); operands = `${a}, ${name(next())}`; break; }
    case 'a': operands = target(); break;
    case 'i': operands = `SP, ${next()}`; break;
    case 'rp': { const n = name(next()); operands = `${n}, 0x${hex(next())}`; break; }
    case 'pr': { const port = next(); operands = `0x${hex(port)}, ${name(next())}`; break; }
    case 'rs': { const n = name(next()); operands = `${n}, [SP+${next()}]`; break; }
    case 'sr': { const off = next(); operands = `[SP+${off}], ${name(next())}`; break; }
    default: break;
  }
  return { text: operands ? `${mnemonic} ${operands}` : mnemonic, size: at - addr };
}
