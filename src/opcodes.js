/**
 * The MiniCPU instruction set — the single source for opcode numbers, operand
 * layouts and the reference shown in the browser.
 *
 * Opcodes are grouped by family, so the first hex digit tells what kind of
 * instruction a byte is. Higher CPU levels add instructions but never
 * renumber existing ones.
 *
 * Operand layouts:
 *   none   no operand bytes
 *   r      one register byte (A=0, B=1, C=2, D=3)
 *   ri     register byte, 8-bit immediate
 *   rr     one byte: destination << 4 | source
 *   ra     register byte, address
 *   ar     address, register byte
 *   a      address
 *   w      16-bit immediate (little-endian)
 *   rs     register byte, offset above SP
 *   sr     offset above SP, register byte
 *   i      8-bit immediate
 * An address is one byte on MiniCPU 8/8S and two bytes (little-endian) on 8X.
 */
const I = (code, name, form, since, family, syntax, summary, flags = '') =>
  Object.freeze({ code, name, form, since, family, syntax, summary, flags });

export const INSTRUCTIONS = Object.freeze([
  I(0x00, 'NOP', 'none', 'cpu8', 'Control', 'NOP', 'Do nothing.'),
  I(0x01, 'HLT', 'none', 'cpu8', 'Control', 'HLT', 'Stop the CPU.'),
  I(0x02, 'CLF', 'none', 'cpu8', 'Control', 'CLF', 'Clear ZF and CF.', 'ZF CF'),

  I(0x10, 'LDI', 'ri', 'cpu8', 'Data movement', 'LDI A, 42', 'Load a constant into a register.'),
  I(0x11, 'LDA', 'ra', 'cpu8', 'Data movement', 'LDA A, 0x70', 'Load the byte at a fixed address.'),
  I(0x12, 'LDA_R', 'rr', 'cpu8', 'Data movement', 'LDA A, [B]', 'Load the byte whose address is in a register.'),
  I(0x13, 'STA', 'ar', 'cpu8', 'Data movement', 'STA 0x70, A', 'Store a register at a fixed address.'),
  I(0x14, 'STA_R', 'rr', 'cpu8', 'Data movement', 'STA [B], A', 'Store a register at the address in another register.'),
  I(0x15, 'MOV', 'rr', 'cpu8', 'Data movement', 'MOV A, B', 'Copy a register. On 8X also XL, XH, YL, YH.'),
  I(0x16, 'LDA_X', 'r', 'cpu8x', 'Data movement', 'LDA A, [X]', 'Load the byte X points to.'),
  I(0x17, 'STA_X', 'r', 'cpu8x', 'Data movement', 'STA [X], A', 'Store a register where X points to.'),
  I(0x18, 'LDX', 'w', 'cpu8x', 'Data movement', 'LDX 0x0800', 'Load a 16-bit address into X.'),
  I(0x19, 'INCX', 'none', 'cpu8x', 'Data movement', 'INCX', 'X = X + 1 (16 bits).'),
  I(0x1A, 'DECX', 'none', 'cpu8x', 'Data movement', 'DECX', 'X = X − 1 (16 bits).'),
  I(0x1B, 'LDA_Y', 'r', 'cpu8x', 'Data movement', 'LDA A, [Y]', 'Load the byte Y points to.'),
  I(0x1C, 'STA_Y', 'r', 'cpu8x', 'Data movement', 'STA [Y], A', 'Store a register where Y points to.'),
  I(0x1D, 'LDY', 'w', 'cpu8x', 'Data movement', 'LDY 0x0800', 'Load a 16-bit address into Y.'),
  I(0x1E, 'INCY', 'none', 'cpu8x', 'Data movement', 'INCY', 'Y = Y + 1 (16 bits).'),
  I(0x1F, 'DECY', 'none', 'cpu8x', 'Data movement', 'DECY', 'Y = Y − 1 (16 bits).'),

  I(0x20, 'ADD', 'rr', 'cpu8', 'Arithmetic', 'ADD A, B', 'A = A + B. CF = carry out of bit 7.', 'ZF CF'),
  I(0x21, 'SUB', 'rr', 'cpu8', 'Arithmetic', 'SUB A, B', 'A = A − B. CF = borrow (A was smaller).', 'ZF CF'),
  I(0x22, 'INC', 'r', 'cpu8', 'Arithmetic', 'INC A', 'A = A + 1.', 'ZF CF'),
  I(0x23, 'DEC', 'r', 'cpu8', 'Arithmetic', 'DEC A', 'A = A − 1.', 'ZF CF'),
  I(0x24, 'SHL', 'r', 'cpu8', 'Arithmetic', 'SHL A', 'Shift left; bit 7 goes to CF.', 'ZF CF'),
  I(0x25, 'SHR', 'r', 'cpu8', 'Arithmetic', 'SHR A', 'Shift right; bit 0 goes to CF.', 'ZF CF'),

  I(0x30, 'AND', 'rr', 'cpu8', 'Logic', 'AND A, B', 'Bitwise AND. Clears CF.', 'ZF CF'),
  I(0x31, 'OR', 'rr', 'cpu8', 'Logic', 'OR A, B', 'Bitwise OR. Clears CF.', 'ZF CF'),
  I(0x32, 'XOR', 'rr', 'cpu8', 'Logic', 'XOR A, B', 'Bitwise XOR. Clears CF.', 'ZF CF'),

  I(0x40, 'CMP', 'ri', 'cpu8', 'Comparison', 'CMP A, 10', 'Compute A − 10 for the flags only.', 'ZF CF'),
  I(0x41, 'CMP_R', 'rr', 'cpu8', 'Comparison', 'CMP A, B', 'Compute A − B for the flags only.', 'ZF CF'),

  I(0x50, 'PUSH', 'r', 'cpu8s', 'Stack', 'PUSH A', 'SP = SP − 1, then store A at SP.'),
  I(0x51, 'POP', 'r', 'cpu8s', 'Stack', 'POP A', 'Load A from SP, then SP = SP + 1.'),
  I(0x52, 'CALL', 'a', 'cpu8s', 'Stack', 'CALL label', 'Push the return address, then jump.'),
  I(0x53, 'RET', 'none', 'cpu8s', 'Stack', 'RET', 'Pop the return address and jump there.'),
  I(0x54, 'LDA_SP', 'rs', 'cpu8s', 'Stack', 'LDA A, [SP+2]', 'Load the byte 2 places above SP: an argument or a local variable.'),
  I(0x55, 'STA_SP', 'sr', 'cpu8s', 'Stack', 'STA [SP+2], A', 'Store a register 2 places above SP.'),
  I(0x56, 'SUB_SP', 'i', 'cpu8s', 'Stack', 'SUB SP, 3', 'Make room for 3 bytes of local variables on the stack.'),
  I(0x57, 'ADD_SP', 'i', 'cpu8s', 'Stack', 'ADD SP, 3', 'Free 3 bytes of the stack (locals, or arguments after a call).'),

  I(0x60, 'JMP', 'a', 'cpu8', 'Jumps', 'JMP label', 'Always jump.'),
  I(0x61, 'JZ', 'a', 'cpu8', 'Jumps', 'JZ label', 'Jump if ZF = 1 (result was zero / equal).'),
  I(0x62, 'JNZ', 'a', 'cpu8', 'Jumps', 'JNZ label', 'Jump if ZF = 0.'),
  I(0x63, 'JC', 'a', 'cpu8', 'Jumps', 'JC label', 'Jump if CF = 1 (carry / borrow / less than).'),
  I(0x64, 'JNC', 'a', 'cpu8', 'Jumps', 'JNC label', 'Jump if CF = 0.'),
]);

export const OPCODES = Object.freeze(Object.fromEntries(INSTRUCTIONS.map(i => [i.name, i.code])));
export const BY_CODE = Object.freeze(Object.fromEntries(INSTRUCTIONS.map(i => [i.code, i])));

const LEVEL = { cpu8: 0, cpu8s: 1, cpu8x: 2 };
/** True if the instruction exists on the given architecture id. */
export const availableOn = (instruction, archId) => LEVEL[instruction.since] <= LEVEL[archId];

/** Number of bytes an instruction occupies on the given architecture. */
export function sizeOf(instruction, arch) {
  const addr = arch.addressBits / 8;
  return { none: 1, r: 2, ri: 3, rr: 2, ra: 2 + addr, ar: 2 + addr, a: 1 + addr, w: 3, rs: 3, sr: 3, i: 2 }[instruction.form];
}

const DATA_ACCESS = new Set(['LDA', 'LDA_R', 'LDA_X', 'LDA_Y', 'LDA_SP', 'STA', 'STA_R', 'STA_X', 'STA_Y', 'STA_SP', 'PUSH', 'POP']);
const POINTER_MATH = new Set(['INCX', 'DECX', 'INCY', 'DECY', 'SUB_SP', 'ADD_SP']);
const CONDITIONAL = new Set(['JZ', 'JNZ', 'JC', 'JNC']);

/**
 * Clock cycles of one instruction. The model is that of a simple 8-bit CPU
 * whose speed is limited by its memory bus:
 *   1 cycle for every instruction byte fetched,
 *   1 cycle for every data byte read or written (RAM, stack, return address),
 *   1 cycle to load a new value into PC (JMP, a taken Jcc, CALL, RET),
 *   1 cycle for pointer arithmetic (INCX … DECY, ADD SP / SUB SP).
 * Wider addresses on MiniCPU 8X therefore cost real time.
 */
export function cyclesOf(instruction, arch, taken = true) {
  let cycles = sizeOf(instruction, arch);
  const name = instruction.name, returnBytes = arch.addressBits / 8;
  if (DATA_ACCESS.has(name)) cycles += 1;
  if (POINTER_MATH.has(name)) cycles += 1;
  if (name === 'CALL' || name === 'RET') cycles += returnBytes + 1;
  if (name === 'JMP' || (CONDITIONAL.has(name) && taken)) cycles += 1;
  return cycles;
}

/** "3" or "2 / 3" (not taken / taken) for the reference table. */
export function cycleLabel(instruction, arch) {
  const taken = cyclesOf(instruction, arch, true), skipped = cyclesOf(instruction, arch, false);
  return taken === skipped ? String(taken) : `${skipped} / ${taken}`;
}

/** Register numbers. XL..YH are the bytes of X and Y and only work with MOV on 8X. */
export const REGISTER_NAMES = Object.freeze(['A', 'B', 'C', 'D', 'XL', 'XH', 'YL', 'YH']);
