/** MiniCPU: the same 8-bit instruction encodings and flags as specht/lowlevel. */
export class CpuFault extends Error {
  constructor(pc, message) { super(`CPU at 0x${hex(pc)}: ${message}`); this.name = 'CpuFault'; this.pc = pc; }
}
export const hex = (v, digits = 2) => Number(v).toString(16).toUpperCase().padStart(digits, '0');
const NAMES = ['A', 'B', 'C', 'D'];
export class MiniCPU {
  constructor(memory = new Uint8Array(256)) { this.load(memory); }
  load(memory) {
    if (memory.length > 256) throw new RangeError('RAM is limited to 256 bytes');
    this.memory = new Uint8Array(256);
    this.memory.set(memory);
    this.registers = new Uint8Array(4);
    this.pc = 0; this.zf = false; this.cf = false; this.halted = false; this.cycles = 0;
    this.last = null;
  }
  snapshot() {
    return { memory: this.memory.slice(), registers: this.registers.slice(), pc: this.pc, zf: this.zf, cf: this.cf, halted: this.halted, cycles: this.cycles, last: this.last };
  }
  restore(s) {
    this.memory.set(s.memory); this.registers.set(s.registers);
    this.pc = s.pc; this.zf = s.zf; this.cf = s.cf; this.halted = s.halted; this.cycles = s.cycles; this.last = s.last;
  }
  fetch() {
    if (this.pc < 0 || this.pc > 255) throw new CpuFault(this.pc, 'Program counter outside RAM');
    return this.memory[this.pc++];
  }
  checkReg(index, start) {
    if (index > 3) throw new CpuFault(start, `Invalid register index ${index}`);
    return index;
  }
  step() {
    if (this.halted) return this.last;
    const start = this.pc, oldMemory = this.memory.slice(), oldReg = this.registers.slice();
    const oldZF = this.zf, oldCF = this.cf;
    const opcode = this.fetch(), r = this.registers;
    const take = () => this.checkReg(this.fetch(), start);
    const pair = () => {
      const b = this.fetch();
      return [this.checkReg(b >> 4, start), this.checkReg(b & 15, start)];
    };
    const zero = v => { this.zf = (v === 0); };
    let text = '';
    switch (opcode) {
      case 0x01: { const d = take(), imm = this.fetch(); r[d] = imm; text = `LDI ${NAMES[d]}, 0x${hex(imm)}`; break; }
      case 0x02: { const d = take(), addr = this.fetch(); r[d] = this.memory[addr]; text = `LDA ${NAMES[d]}, 0x${hex(addr)}`; break; }
      case 0x03: { const addr = this.fetch(), src = take(); this.memory[addr] = r[src]; text = `STA 0x${hex(addr)}, ${NAMES[src]}`; break; }
      case 0x04: { const [d, s] = pair(); r[d] = r[s]; text = `MOV ${NAMES[d]}, ${NAMES[s]}`; break; }
      case 0x05: { const [d, address] = pair(); r[d] = this.memory[r[address]]; text = `LDA ${NAMES[d]}, [${NAMES[address]}]`; break; }
      case 0x06: { const [address, s] = pair(); this.memory[r[address]] = r[s]; text = `STA [${NAMES[address]}], ${NAMES[s]}`; break; }
      case 0x20: { const [d, s] = pair(), value = r[d] + r[s]; r[d] = value & 255; this.cf = value > 255; zero(r[d]); text = `ADD ${NAMES[d]}, ${NAMES[s]}`; break; }
      case 0x21: { const [d, s] = pair(), value = r[d] - r[s]; r[d] = value & 255; this.cf = value < 0; zero(r[d]); text = `SUB ${NAMES[d]}, ${NAMES[s]}`; break; }
      case 0x22: { const d = take(), value = r[d] + 1; r[d] = value & 255; this.cf = value > 255; zero(r[d]); text = `INC ${NAMES[d]}`; break; }
      case 0x23: { const d = take(), value = r[d] - 1; r[d] = value & 255; this.cf = value < 0; zero(r[d]); text = `DEC ${NAMES[d]}`; break; }
      case 0x24: { const d = take(), value = r[d] << 1; r[d] = value & 255; this.cf = value > 255; zero(r[d]); text = `SHL ${NAMES[d]}`; break; }
      case 0x25: { const d = take(), value = r[d]; this.cf = (value & 1) !== 0; r[d] = value >>> 1; zero(r[d]); text = `SHR ${NAMES[d]}`; break; }
      case 0x30: { const [d, s] = pair(); r[d] &= r[s]; this.cf = false; zero(r[d]); text = `AND ${NAMES[d]}, ${NAMES[s]}`; break; }
      case 0x31: { const [d, s] = pair(); r[d] |= r[s]; this.cf = false; zero(r[d]); text = `OR ${NAMES[d]}, ${NAMES[s]}`; break; }
      case 0x32: { const [d, s] = pair(); r[d] ^= r[s]; this.cf = false; zero(r[d]); text = `XOR ${NAMES[d]}, ${NAMES[s]}`; break; }
      case 0x40: { const d = take(), imm = this.fetch(), value = r[d] - imm; this.cf = value < 0; zero(value); text = `CMP ${NAMES[d]}, 0x${hex(imm)}`; break; }
      case 0x41: { const [d, s] = pair(), value = r[d] - r[s]; this.cf = value < 0; zero(value); text = `CMP ${NAMES[d]}, ${NAMES[s]}`; break; }
      case 0x80: { const addr = this.fetch(); if (this.zf) this.pc = addr; text = `JZ 0x${hex(addr)}`; break; }
      case 0x81: { const addr = this.fetch(); if (!this.zf) this.pc = addr; text = `JNZ 0x${hex(addr)}`; break; }
      case 0x90: { const addr = this.fetch(); if (this.cf) this.pc = addr; text = `JC 0x${hex(addr)}`; break; }
      case 0x91: { const addr = this.fetch(); if (!this.cf) this.pc = addr; text = `JNC 0x${hex(addr)}`; break; }
      case 0xA0: { const addr = this.fetch(); this.pc = addr; text = `JMP 0x${hex(addr)}`; break; }
      case 0xE0: this.zf = false; this.cf = false; text = 'CLF'; break;
      case 0xFE: text = 'NOP'; break;
      case 0xFF: this.halted = true; this.pc = start; text = 'HLT'; break;
      default: this.halted = true; throw new CpuFault(start, `Unknown opcode 0x${hex(opcode)}`);
    }
    this.cycles++;
    const changedMemory = [];
    for (let i = 0; i < 256; i++) if (oldMemory[i] !== this.memory[i]) changedMemory.push(i);
    const changedRegisters = [];
    for (let i = 0; i < 4; i++) if (oldReg[i] !== r[i]) changedRegisters.push(i);
    this.last = { pc: start, nextPC: this.pc, text, opcode, changedMemory, changedRegisters, flagsChanged: oldZF !== this.zf || oldCF !== this.cf };
    return this.last;
  }
}
