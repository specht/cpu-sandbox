/**
 * The MiniCPU instruction set — the single source for opcode numbers, operand
 * layouts, sizes, cycles and the reference shown in the browser.
 *
 * One set of rules holds on every level:
 *   - The destination comes first: LDI A, 5 / STA [0x70], A.
 *   - Square brackets always mean "the memory at this address".
 *     Without brackets, a value is a constant.
 *   - Higher levels do not add new spellings, they add registers:
 *     MiniCPU 8S adds SP, MiniCPU 8X adds the 16-bit pointer registers X and Y
 *     (and their bytes XL, XH, YL, YH for MOV).
 *
 * Opcodes are grouped by family, so the first hex digit tells what kind of
 * instruction a byte is.
 *
 * Register numbers (one byte, or one nibble in a register pair):
 *   A=0 B=1 C=2 D=3 · XL=4 XH=5 YL=6 YH=7 · X=8 Y=9   (4..9 only on 8X)
 *
 * Operand layouts:
 *   none   no operand bytes
 *   r      register byte
 *   ri     register byte, constant (1 byte, 2 for X/Y)
 *   rr     one byte: first register << 4 | second register
 *   ra     register byte, address
 *   ar     address, register byte
 *   a      address
 *   rs     register byte, offset above SP
 *   sr     offset above SP, register byte
 *   i      one constant byte
 *   rp     register byte, port
 *   pr     port, register byte
 * An address is one byte on MiniCPU 8/8S and two bytes (low byte first) on 8X.
 */
const I = (code, name, form, since, family, syntax, summary, flags = '') =>
  Object.freeze({ code, name, form, since, family, syntax, summary, flags });

export const INSTRUCTIONS = Object.freeze([
  I(0x00, 'NOP', 'none', 'cpu8', 'Control', 'NOP', 'Do nothing.'),
  I(0x01, 'HLT', 'none', 'cpu8', 'Control', 'HLT', 'Stop the CPU.'),
  I(0x02, 'CLF', 'none', 'cpu8', 'Control', 'CLF', 'Clear ZF and CF.', 'ZF CF'),

  I(0x10, 'LDI', 'ri', 'cpu8', 'Data movement', 'LDI A, 42', 'Load the constant 42 into A.'),
  I(0x11, 'LDA', 'ra', 'cpu8', 'Data movement', 'LDA A, [0x70]', 'Load the byte at address 0x70 into A.'),
  I(0x12, 'LDA_R', 'rr', 'cpu8', 'Data movement', 'LDA A, [B]', 'Load the byte at the address that is in B.'),
  I(0x13, 'STA', 'ar', 'cpu8', 'Data movement', 'STA [0x70], A', 'Store A at address 0x70.'),
  I(0x14, 'STA_R', 'rr', 'cpu8', 'Data movement', 'STA [B], A', 'Store A at the address that is in B.'),
  I(0x15, 'MOV', 'rr', 'cpu8', 'Data movement', 'MOV A, B', 'Copy B into A.'),

  I(0x20, 'ADD', 'rr', 'cpu8', 'Arithmetic', 'ADD A, B', 'A = A + B. CF = carry out of the top bit.', 'ZF CF'),
  I(0x21, 'ADD_I', 'ri', 'cpu8', 'Arithmetic', 'ADD A, 5', 'A = A + 5.', 'ZF CF'),
  I(0x22, 'SUB', 'rr', 'cpu8', 'Arithmetic', 'SUB A, B', 'A = A − B. CF = borrow (A was smaller).', 'ZF CF'),
  I(0x23, 'SUB_I', 'ri', 'cpu8', 'Arithmetic', 'SUB A, 5', 'A = A − 5.', 'ZF CF'),
  I(0x24, 'ADC', 'rr', 'cpu8', 'Arithmetic', 'ADC A, B', 'A = A + B + CF: adds the carry of a previous ADD.', 'ZF CF'),
  I(0x25, 'ADC_I', 'ri', 'cpu8', 'Arithmetic', 'ADC A, 0', 'A = A + 0 + CF.', 'ZF CF'),
  I(0x26, 'SBC', 'rr', 'cpu8', 'Arithmetic', 'SBC A, B', 'A = A − B − CF: subtracts the borrow of a previous SUB.', 'ZF CF'),
  I(0x27, 'SBC_I', 'ri', 'cpu8', 'Arithmetic', 'SBC A, 0', 'A = A − 0 − CF.', 'ZF CF'),
  I(0x28, 'INC', 'r', 'cpu8', 'Arithmetic', 'INC A', 'A = A + 1.', 'ZF CF'),
  I(0x29, 'DEC', 'r', 'cpu8', 'Arithmetic', 'DEC A', 'A = A − 1.', 'ZF CF'),
  I(0x2A, 'SHL', 'r', 'cpu8', 'Arithmetic', 'SHL A', 'Shift left; the top bit goes to CF.', 'ZF CF'),
  I(0x2B, 'SHR', 'r', 'cpu8', 'Arithmetic', 'SHR A', 'Shift right; bit 0 goes to CF.', 'ZF CF'),

  I(0x30, 'AND', 'rr', 'cpu8', 'Logic', 'AND A, B', 'Bitwise AND. Clears CF.', 'ZF CF'),
  I(0x31, 'AND_I', 'ri', 'cpu8', 'Logic', 'AND A, 0x0F', 'Bitwise AND with a constant. Clears CF.', 'ZF CF'),
  I(0x32, 'OR', 'rr', 'cpu8', 'Logic', 'OR A, B', 'Bitwise OR. Clears CF.', 'ZF CF'),
  I(0x33, 'OR_I', 'ri', 'cpu8', 'Logic', 'OR A, 0x80', 'Bitwise OR with a constant. Clears CF.', 'ZF CF'),
  I(0x34, 'XOR', 'rr', 'cpu8', 'Logic', 'XOR A, B', 'Bitwise XOR. Clears CF.', 'ZF CF'),
  I(0x35, 'XOR_I', 'ri', 'cpu8', 'Logic', 'XOR A, 0xFF', 'Bitwise XOR with a constant. Clears CF.', 'ZF CF'),

  I(0x40, 'CMP', 'rr', 'cpu8', 'Comparison', 'CMP A, B', 'Compute A − B for the flags only.', 'ZF CF'),
  I(0x41, 'CMP_I', 'ri', 'cpu8', 'Comparison', 'CMP A, 10', 'Compute A − 10 for the flags only.', 'ZF CF'),

  I(0x50, 'PUSH', 'r', 'cpu8s', 'Stack', 'PUSH A', 'SP = SP − 1, then store A at [SP].'),
  I(0x51, 'POP', 'r', 'cpu8s', 'Stack', 'POP A', 'Load A from [SP], then SP = SP + 1.'),
  I(0x52, 'CALL', 'a', 'cpu8s', 'Stack', 'CALL label', 'Push the return address, then jump.'),
  I(0x53, 'RET', 'none', 'cpu8s', 'Stack', 'RET', 'Pop the return address and jump there.'),
  I(0x54, 'LDA_SP', 'rs', 'cpu8s', 'Stack', 'LDA A, [SP+2]', 'Load the byte 2 places above SP: an argument or a local variable.'),
  I(0x55, 'STA_SP', 'sr', 'cpu8s', 'Stack', 'STA [SP+2], A', 'Store A 2 places above SP.'),
  I(0x56, 'ADD_SP', 'i', 'cpu8s', 'Stack', 'ADD SP, 3', 'Free 3 bytes of the stack (locals, or arguments after a call).'),
  I(0x57, 'SUB_SP', 'i', 'cpu8s', 'Stack', 'SUB SP, 3', 'Make room for 3 bytes of local variables.'),

  I(0x60, 'JMP', 'a', 'cpu8', 'Jumps', 'JMP label', 'Always jump.'),
  I(0x61, 'JZ', 'a', 'cpu8', 'Jumps', 'JZ label', 'Jump if ZF = 1 (zero, or equal after CMP).'),
  I(0x62, 'JNZ', 'a', 'cpu8', 'Jumps', 'JNZ label', 'Jump if ZF = 0.'),
  I(0x63, 'JC', 'a', 'cpu8', 'Jumps', 'JC label', 'Jump if CF = 1 (carry, or less than after CMP).'),
  I(0x64, 'JNC', 'a', 'cpu8', 'Jumps', 'JNC label', 'Jump if CF = 0.'),

  I(0x70, 'IN', 'rp', 'cpu8', 'Input/output', 'IN A, 0x02', 'Read a byte from the device at port 2.'),
  I(0x71, 'OUT', 'pr', 'cpu8', 'Input/output', 'OUT 0x11, A', 'Send A to the device at port 0x11.'),
]);

export const OPCODES = Object.freeze(Object.fromEntries(INSTRUCTIONS.map(i => [i.name, i.code])));
export const BY_CODE = Object.freeze(Object.fromEntries(INSTRUCTIONS.map(i => [i.code, i])));

const LEVEL = { cpu8: 0, cpu8s: 1, cpu8x: 2 };
/** True if the instruction exists on the given architecture id. */
export const availableOn = (instruction, archId) => LEVEL[instruction.since] <= LEVEL[archId];

/** Register numbers. */
export const REGISTER_NAMES = Object.freeze(['A', 'B', 'C', 'D', 'XL', 'XH', 'YL', 'YH', 'X', 'Y']);
export const REG = Object.freeze({ A: 0, B: 1, C: 2, D: 3, XL: 4, XH: 5, YL: 6, YH: 7, X: 8, Y: 9 });
export const isWide = n => n === REG.X || n === REG.Y;

/**
 * What 8X allows with X and Y (8 = X or Y, 1 = an 8-bit register A–D):
 *   LDI X, n · LDA X, [addr] · STA [addr], X · LDA X, [SP+n] · MOV X, Y
 *   ADD/SUB X, n · ADD/SUB X, A (adds the unsigned byte) · ADD/SUB X, Y
 *   CMP X, n · CMP X, Y · INC X · DEC X · PUSH X · POP X
 *   and as pointers: LDA A, [X] · STA [X], A
 */
export const WIDE_OPERATIONS = Object.freeze(new Set(['LDI', 'LDA', 'STA', 'LDA_SP', 'STA_SP', 'MOV', 'ADD', 'ADD_I', 'SUB', 'SUB_I', 'CMP', 'CMP_I', 'INC', 'DEC', 'PUSH', 'POP']));

/**
 * Number of bytes of one instruction. `wide` is true when its register is X
 * or Y, which makes a constant two bytes long.
 */
export function sizeOf(instruction, arch, wide = false) {
  const addr = arch.addressBits / 8;
  return {
    none: 1, r: 2, ri: wide ? 4 : 3, rr: 2, ra: 2 + addr, ar: 2 + addr, a: 1 + addr,
    rs: 3, sr: 3, i: 2, rp: 3, pr: 3,
  }[instruction.form];
}

const MEMORY_ACCESS = new Set(['LDA', 'LDA_R', 'STA', 'STA_R', 'LDA_SP', 'STA_SP', 'PUSH', 'POP', 'IN', 'OUT']);
const CONDITIONAL = new Set(['JZ', 'JNZ', 'JC', 'JNC']);
const STACK_POINTER_MATH = new Set(['ADD_SP', 'SUB_SP']);

/**
 * Clock cycles of one instruction. The model is that of a simple 8-bit CPU
 * whose speed is limited by its memory bus:
 *   1 cycle for every instruction byte fetched,
 *   1 cycle for every data byte read or written (RAM, stack, return address,
 *     device port) — 2 for X and Y,
 *   1 cycle to load a new value into PC (JMP, a taken Jcc, CALL, RET),
 *   1 cycle for 16-bit arithmetic (on X, Y or SP), because the ALU is 8 bits wide.
 * Wider addresses and registers on MiniCPU 8X therefore cost real time.
 */
export function cyclesOf(instruction, arch, { taken = true, wide = false } = {}) {
  let cycles = sizeOf(instruction, arch, wide);
  const name = instruction.name, returnBytes = arch.addressBits / 8;
  if (MEMORY_ACCESS.has(name)) cycles += wide ? 2 : 1;
  else if (wide) cycles += 1;
  if (STACK_POINTER_MATH.has(name)) cycles += 1;
  if (name === 'CALL' || name === 'RET') cycles += returnBytes + 1;
  if (name === 'JMP' || (CONDITIONAL.has(name) && taken)) cycles += 1;
  return cycles;
}

/** "3" or "2 / 3" (not taken / taken) for the reference table. */
export function cycleLabel(instruction, arch, wide = false) {
  const taken = cyclesOf(instruction, arch, { taken: true, wide }), skipped = cyclesOf(instruction, arch, { taken: false, wide });
  return taken === skipped ? String(taken) : `${skipped} / ${taken}`;
}
