import { architecture } from './architectures.js';
import { OPCODES as OP } from './opcodes.js';
/** Shared memory MiniCPU. The opcode table is in opcodes.js. */
export class CpuFault extends Error {
  constructor(pc, message) { super(`CPU at 0x${hex(pc)}: ${message}`); this.name = 'CpuFault'; this.pc = pc; }
}
export const hex = (v, digits = 2) => Number(v).toString(16).toUpperCase().padStart(digits, '0');
const NAMES = ['A', 'B', 'C', 'D'];
export class MiniCPU {
  constructor(memory = new Uint8Array(256), profile = 'cpu8') { this.arch = architecture(profile); this.load(memory); }
  load(memory) {
    if (memory.length > this.arch.memorySize) throw new RangeError(`RAM is limited to ${this.arch.memorySize} bytes`);
    this.memory = new Uint8Array(this.arch.memorySize);
    this.memory.set(memory);
    this.registers = new Uint8Array(4);
    this.pc = 0; this.zf = false; this.cf = false; this.halted = false; this.cycles = 0;
    this.sp = this.arch.stack ? this.arch.memorySize : null;
    this.x = this.arch.index ? 0 : null;
    this.y = this.arch.index ? 0 : null;
    this.last = null;
  }
  snapshot() {
    return { memory: this.memory.slice(), registers: this.registers.slice(), pc: this.pc, zf: this.zf, cf: this.cf, halted: this.halted, cycles: this.cycles, sp: this.sp, x: this.x, y: this.y, last: this.last };
  }
  restore(s) {
    this.memory.set(s.memory); this.registers.set(s.registers);
    this.pc = s.pc; this.zf = s.zf; this.cf = s.cf; this.halted = s.halted; this.cycles = s.cycles; this.sp = s.sp; this.x = s.x; this.y = s.y; this.last = s.last;
  }
  fetch() {
    if (this.pc < 0 || this.pc >= this.memory.length) throw new CpuFault(this.pc, 'Program counter outside RAM');
    return this.memory[this.pc++];
  }
  push(value, start) {
    if (!this.arch.stack) throw new CpuFault(start, 'Stack is not available on MiniCPU 8');
    if (this.sp <= 0) throw new CpuFault(start, 'Stack overflow');
    this.memory[--this.sp] = value & 0xFF;
  }
  pop(start) {
    if (!this.arch.stack) throw new CpuFault(start, 'Stack is not available on MiniCPU 8');
    if (this.sp >= this.memory.length) throw new CpuFault(start, 'Stack underflow');
    return this.memory[this.sp++];
  }
  pushReturn(address, start) {
    this.push(address & 0xFF, start);
    if (this.arch.index) this.push((address >> 8) & 0xFF, start);
  }
  popReturn(start) {
    const upper = this.arch.index ? this.pop(start) : 0;
    return (upper << 8) | this.pop(start);
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
    const requireStack = () => { if (!this.arch.stack) throw new CpuFault(start, 'Instruction requires MiniCPU 8S or 8X'); };
    const requireExtended = () => { if (!this.arch.index) throw new CpuFault(start, 'Instruction requires MiniCPU 8X'); };
    const word = () => { const lo = this.fetch(), hi = this.fetch(); return lo | (hi << 8); };
    const relative = () => { const b = this.fetch(); return checkAddress(this.pc + (b < 128 ? b : b - 256)); };
    const checkAddress = addr => { if (addr < 0 || addr >= this.memory.length) throw new CpuFault(start, `Address 0x${hex(addr,4)} outside RAM`); return addr; };
    let text = '';
    switch (opcode) {
      // Extended instructions are grouped alongside their related base operations.
      case OP.LDX: { requireExtended(); const value = word(); this.x = value; text = `LDX 0x${hex(value,4)}`; break; }
      case OP.LDA_X: { requireExtended(); const d = take(); r[d] = this.memory[checkAddress(this.x)]; text = `LDA ${NAMES[d]}, [X]`; break; }
      case OP.STA_X: { requireExtended(); const s = take(); this.memory[checkAddress(this.x)] = r[s]; text = `STA [X], ${NAMES[s]}`; break; }
      case OP.INCX: { requireExtended(); this.x = (this.x + 1) & 0xFFFF; text = 'INCX'; break; }
      case OP.DECX: { requireExtended(); this.x = (this.x - 1) & 0xFFFF; text = 'DECX'; break; }
      case OP.LDY: { requireExtended(); const value = word(); this.y = value; text = `LDY 0x${hex(value,4)}`; break; }
      case OP.LDA_Y: { requireExtended(); const d = take(); r[d] = this.memory[checkAddress(this.y)]; text = `LDA ${NAMES[d]}, [Y]`; break; }
      case OP.STA_Y: { requireExtended(); const s = take(); this.memory[checkAddress(this.y)] = r[s]; text = `STA [Y], ${NAMES[s]}`; break; }
      case OP.INCY: { requireExtended(); this.y = (this.y + 1) & 0xFFFF; text = 'INCY'; break; }
      case OP.DECY: { requireExtended(); this.y = (this.y - 1) & 0xFFFF; text = 'DECY'; break; }
      case OP.PUSH: { requireStack(); const d = take(); this.push(r[d],start); text = `PUSH ${NAMES[d]}`; break; }
      case OP.POP: { requireStack(); const d = take(); r[d] = this.pop(start); text = `POP ${NAMES[d]}`; break; }
      case OP.CALL: case OP.CALL_REL: case OP.CALL_LONG: {
        requireStack();
        if (opcode !== OP.CALL && !this.arch.index) throw new CpuFault(start, 'Long/relative CALL requires MiniCPU 8X');
        const addr = opcode === OP.CALL_REL ? relative() : checkAddress(opcode === OP.CALL_LONG ? word() : this.fetch());
        this.pushReturn(this.pc,start); this.pc = addr;
        text = `CALL 0x${hex(addr,this.arch.addressBits===16?4:2)}`; break;
      }
      case OP.RET: { requireStack(); this.pc = checkAddress(this.popReturn(start)); text = 'RET'; break; }
      case OP.LDI: { const d = take(), imm = this.fetch(); r[d] = imm; text = `LDI ${NAMES[d]}, 0x${hex(imm)}`; break; }
      case OP.LDA_DIRECT: { const d = take(), addr = this.fetch(); r[d] = this.memory[addr]; text = `LDA ${NAMES[d]}, 0x${hex(addr)}`; break; }
      case OP.STA_DIRECT: { const addr = this.fetch(), src = take(); this.memory[addr] = r[src]; text = `STA 0x${hex(addr)}, ${NAMES[src]}`; break; }
      case OP.MOV: { const [d, s] = pair(); r[d] = r[s]; text = `MOV ${NAMES[d]}, ${NAMES[s]}`; break; }
      case OP.LDA_INDIRECT: { const [d, address] = pair(); r[d] = this.memory[r[address]]; text = `LDA ${NAMES[d]}, [${NAMES[address]}]`; break; }
      case OP.STA_INDIRECT: { const [address, s] = pair(); this.memory[r[address]] = r[s]; text = `STA [${NAMES[address]}], ${NAMES[s]}`; break; }
      case OP.ADD: { const [d, s] = pair(), value = r[d] + r[s]; r[d] = value & 255; this.cf = value > 255; zero(r[d]); text = `ADD ${NAMES[d]}, ${NAMES[s]}`; break; }
      case OP.SUB: { const [d, s] = pair(), value = r[d] - r[s]; r[d] = value & 255; this.cf = value < 0; zero(r[d]); text = `SUB ${NAMES[d]}, ${NAMES[s]}`; break; }
      case OP.INC: { const d = take(), value = r[d] + 1; r[d] = value & 255; this.cf = value > 255; zero(r[d]); text = `INC ${NAMES[d]}`; break; }
      case OP.DEC: { const d = take(), value = r[d] - 1; r[d] = value & 255; this.cf = value < 0; zero(r[d]); text = `DEC ${NAMES[d]}`; break; }
      case OP.SHL: { const d = take(), value = r[d] << 1; r[d] = value & 255; this.cf = value > 255; zero(r[d]); text = `SHL ${NAMES[d]}`; break; }
      case OP.SHR: { const d = take(), value = r[d]; this.cf = (value & 1) !== 0; r[d] = value >>> 1; zero(r[d]); text = `SHR ${NAMES[d]}`; break; }
      case OP.AND: { const [d, s] = pair(); r[d] &= r[s]; this.cf = false; zero(r[d]); text = `AND ${NAMES[d]}, ${NAMES[s]}`; break; }
      case OP.OR: { const [d, s] = pair(); r[d] |= r[s]; this.cf = false; zero(r[d]); text = `OR ${NAMES[d]}, ${NAMES[s]}`; break; }
      case OP.XOR: { const [d, s] = pair(); r[d] ^= r[s]; this.cf = false; zero(r[d]); text = `XOR ${NAMES[d]}, ${NAMES[s]}`; break; }
      case OP.CMP_IMM: { const d = take(), imm = this.fetch(), value = r[d] - imm; this.cf = value < 0; zero(value); text = `CMP ${NAMES[d]}, 0x${hex(imm)}`; break; }
      case OP.CMP_REG: { const [d, s] = pair(), value = r[d] - r[s]; this.cf = value < 0; zero(value); text = `CMP ${NAMES[d]}, ${NAMES[s]}`; break; }
      case OP.JMP: case OP.JZ: case OP.JNZ: case OP.JC: case OP.JNC:
      case OP.JMP_REL: case OP.JZ_REL: case OP.JNZ_REL: case OP.JC_REL: case OP.JNC_REL:
      case OP.JMP_LONG: case OP.JZ_LONG: case OP.JNZ_LONG: case OP.JC_LONG: case OP.JNC_LONG: {
        const mnemonic = Object.keys(OP).find(name => OP[name] === opcode).split('_')[0];
        const form = Object.keys(OP).find(name => OP[name] === opcode);
        if (form.includes('_') && !this.arch.index) throw new CpuFault(start, 'Extended jump requires MiniCPU 8X');
        const addr = form.endsWith('_REL') ? relative() : checkAddress(form.endsWith('_LONG') ? word() : this.fetch());
        const taken = mnemonic === 'JMP' || (mnemonic === 'JZ' && this.zf) || (mnemonic === 'JNZ' && !this.zf)
          || (mnemonic === 'JC' && this.cf) || (mnemonic === 'JNC' && !this.cf);
        if (taken) this.pc = addr;
        text = `${mnemonic} 0x${hex(addr,this.arch.addressBits===16?4:2)}`;
        break;
      }
      case OP.CLF: this.zf = false; this.cf = false; text = 'CLF'; break;
      case OP.NOP: text = 'NOP'; break;
      case OP.HLT: this.halted = true; this.pc = start; text = 'HLT'; break;
      default: this.halted = true; throw new CpuFault(start, `Unknown opcode 0x${hex(opcode)}`);
    }
    this.cycles++;
    const changedMemory = [];
    for (let i = 0; i < this.memory.length; i++) if (oldMemory[i] !== this.memory[i]) changedMemory.push(i);
    const changedRegisters = [];
    for (let i = 0; i < 4; i++) if (oldReg[i] !== r[i]) changedRegisters.push(i);
    this.last = { pc: start, nextPC: this.pc, text, opcode, changedMemory, changedRegisters, flagsChanged: oldZF !== this.zf || oldCF !== this.cf };
    return this.last;
  }
}
