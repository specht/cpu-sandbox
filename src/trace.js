/**
 * The cycles of one instruction. The cycle model of the MiniCPU is: one cycle
 * per instruction byte fetched, one per data byte read or written (RAM, stack
 * or device), one when PC jumps, one for 16-bit arithmetic and one for ADD SP
 * and SUB SP. traceInstruction() runs the next instruction on a copy of the
 * machine and records every bus access in order, so the result is exactly
 * the instruction's cycles, each with what was on the address and data bus.
 *
 * A cycle: { kind, address, value, pc, port, detail }
 *   fetch   the CPU reads an instruction byte at PC (address), PC moves on (pc)
 *   read    a data byte from RAM (also POP and RET from the stack)
 *   write   a data byte to RAM (also PUSH and CALL on the stack)
 *   in/out  a byte from or to a device at port
 *   jump    PC is loaded with a new address (pc)
 *   alu     an extra internal cycle: the high byte of a 16-bit value, or SP
 */
import { MiniCPU, CpuFault } from './cpu.js';
import { Devices, PORT } from './devices.js';
import { INSTRUCTIONS } from './opcodes.js';

const BY_CODE = new Map(INSTRUCTIONS.map(i => [i.code, i]));
const JUMPS = new Set(['JMP', 'JZ', 'JNZ', 'JC', 'JNC', 'CALL', 'RET']);

/** A copy of the devices that the shadow CPU can change freely. */
function copyDevices(devices) {
  const copy = new Devices();
  copy.joystick = devices.joystick;
  copy.held = [...devices.held];
  copy.shift = devices.shift;
  copy.typed = [...devices.typed];
  copy.random = devices.random;
  copy.outputs = new Map(devices.outputs);
  copy.palette = devices.palette.slice();
  copy.colorIndex = devices.colorIndex;
  copy.colorPart = devices.colorPart;
  return copy;
}

/**
 * Returns { text, info, cycles, total, fault } for the instruction at PC,
 * or null when the CPU has halted. Nothing of the real machine changes.
 */
export function traceInstruction(cpu) {
  if (cpu.halted || cpu.fault) return null;
  const shadow = new MiniCPU(cpu.memory, cpu.arch.id, { historySize: 1, devices: copyDevices(cpu.io), clockHz: cpu.clockHz });
  shadow.registers.set(cpu.registers);
  Object.assign(shadow, { pc: cpu.pc, zf: cpu.zf, cf: cpu.cf, sp: cpu.sp, x: cpu.x, y: cpu.y, time: cpu.time });
  const cycles = [], proto = MiniCPU.prototype;
  shadow.fetch = function () {
    const address = this.pc, value = proto.fetch.call(this);
    cycles.push({ kind: 'fetch', address, value, pc: this.pc });
    return value;
  };
  shadow.read = function (addr, n) {
    const value = proto.read.call(this, addr, n);
    cycles.push({ kind: 'read', address: addr, value: this.memory[addr] });
    if (n >= 8) cycles.push({ kind: 'read', address: addr + 1, value: this.memory[addr + 1] });
    return value;
  };
  shadow.pop = function () {
    const address = this.sp, value = proto.pop.call(this);
    cycles.push({ kind: 'read', address, value, detail: 'stack' });
    return value;
  };
  shadow.write = function (addr, value) {
    proto.write.call(this, addr, value);
    cycles.push({ kind: 'write', address: addr, value: value & 0xFF, detail: addr >= this.sp - 1 && this.arch.stack ? 'stack' : null });
  };
  const io = shadow.io, read = io.read.bind(io), write = io.write.bind(io);
  io.read = (port, c) => { const value = read(port, c); cycles.push({ kind: 'in', port, value }); return value; };
  io.write = (port, value) => { cycles.push({ kind: 'out', port, value }); return write(port, value); };

  const start = cpu.pc, info = BY_CODE.get(cpu.memory[start]) ?? null;
  let total, fault = null;
  try {
    total = shadow.step();
  } catch (error) {
    if (!(error instanceof CpuFault)) throw error;
    fault = error.message;
  }
  if (!fault) {
    const name = info?.name;
    // A taken jump loads PC: the last cycle of a jump, CALL or RET.
    if (JUMPS.has(name) && (name === 'CALL' || name === 'RET' || name === 'JMP' || shadow.pc !== start + cycles.filter(c => c.kind === 'fetch').length)) {
      cycles.push({ kind: 'jump', pc: shadow.pc });
    }
    // Vsync idles; everything else is an internal cycle of the ALU.
    const internal = info && io && cycles.some(c => c.kind === 'in' && c.port === PORT.VSYNC) ? 0 : total - cycles.length;
    const at = cycles.findLastIndex(c => c.kind === 'fetch') + 1;
    for (let i = 0; i < internal; i++) cycles.splice(at, 0, { kind: 'alu', detail: name === 'ADD_SP' || name === 'SUB_SP' ? 'sp' : 'high byte' });
  }
  return { text: cpu.disassemble(start).text, info, cycles, total: total ?? cycles.length, fault, after: fault ? null : { registers: Array.from(shadow.registers), pc: shadow.pc, sp: shadow.sp, x: shadow.x, y: shadow.y, zf: shadow.zf, cf: shadow.cf } };
}
