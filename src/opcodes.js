/** MiniCPU teaching ISA, deliberately grouped by operation family.
 * This is the only source for opcode numbers; assembler and interpreter import it.
 * The three models extend the instruction set without renumbering existing ops.
 * Bytecode from the historical Ruby MiniCPU is intentionally incompatible.
 */
export const OPCODES = Object.freeze({
  NOP: 0x00, // cpu8 · Control
  HLT: 0x01, // cpu8 · Control
  CLF: 0x02, // cpu8 · Control
  LDI: 0x10, // cpu8 · Data movement
  LDA_DIRECT: 0x11, // cpu8 · Data movement
  LDA_INDIRECT: 0x12, // cpu8 · Data movement
  STA_DIRECT: 0x13, // cpu8 · Data movement
  STA_INDIRECT: 0x14, // cpu8 · Data movement
  MOV: 0x15, // cpu8 · Data movement
  LDA_X: 0x16, // cpu8x · Data movement
  STA_X: 0x17, // cpu8x · Data movement
  LDX: 0x18, // cpu8x · Data movement
  INCX: 0x19, // cpu8x · Data movement
  DECX: 0x1A, // cpu8x · Data movement
  ADD: 0x20, // cpu8 · Arithmetic & shifts
  SUB: 0x21, // cpu8 · Arithmetic & shifts
  INC: 0x22, // cpu8 · Arithmetic & shifts
  DEC: 0x23, // cpu8 · Arithmetic & shifts
  SHL: 0x24, // cpu8 · Arithmetic & shifts
  SHR: 0x25, // cpu8 · Arithmetic & shifts
  AND: 0x30, // cpu8 · Bitwise logic
  OR: 0x31, // cpu8 · Bitwise logic
  XOR: 0x32, // cpu8 · Bitwise logic
  CMP_IMM: 0x40, // cpu8 · Comparison
  CMP_REG: 0x41, // cpu8 · Comparison
  PUSH: 0x50, // cpu8s · Stack & subroutines
  POP: 0x51, // cpu8s · Stack & subroutines
  CALL: 0x52, // cpu8s · Stack & subroutines
  RET: 0x53, // cpu8s · Stack & subroutines
  CALL16: 0x54, // cpu8x · Stack & subroutines
  JMP: 0x60, // cpu8 · Branches
  JZ: 0x61, // cpu8 · Branches
  JNZ: 0x62, // cpu8 · Branches
  JC: 0x63, // cpu8 · Branches
  JNC: 0x64, // cpu8 · Branches
  JMP16: 0x68, // cpu8x · Branches
  JZ16: 0x69, // cpu8x · Branches
  JNZ16: 0x6A, // cpu8x · Branches
  JC16: 0x6B, // cpu8x · Branches
  JNC16: 0x6C, // cpu8x · Branches
});

export const OPCODE_TABLE = Object.freeze([
  Object.freeze({ name: 'NOP', code: OPCODES.NOP, family: 'Control', since: 'cpu8' }),
  Object.freeze({ name: 'HLT', code: OPCODES.HLT, family: 'Control', since: 'cpu8' }),
  Object.freeze({ name: 'CLF', code: OPCODES.CLF, family: 'Control', since: 'cpu8' }),
  Object.freeze({ name: 'LDI', code: OPCODES.LDI, family: 'Data movement', since: 'cpu8' }),
  Object.freeze({ name: 'LDA_DIRECT', code: OPCODES.LDA_DIRECT, family: 'Data movement', since: 'cpu8' }),
  Object.freeze({ name: 'LDA_INDIRECT', code: OPCODES.LDA_INDIRECT, family: 'Data movement', since: 'cpu8' }),
  Object.freeze({ name: 'STA_DIRECT', code: OPCODES.STA_DIRECT, family: 'Data movement', since: 'cpu8' }),
  Object.freeze({ name: 'STA_INDIRECT', code: OPCODES.STA_INDIRECT, family: 'Data movement', since: 'cpu8' }),
  Object.freeze({ name: 'MOV', code: OPCODES.MOV, family: 'Data movement', since: 'cpu8' }),
  Object.freeze({ name: 'LDA_X', code: OPCODES.LDA_X, family: 'Data movement', since: 'cpu8x' }),
  Object.freeze({ name: 'STA_X', code: OPCODES.STA_X, family: 'Data movement', since: 'cpu8x' }),
  Object.freeze({ name: 'LDX', code: OPCODES.LDX, family: 'Data movement', since: 'cpu8x' }),
  Object.freeze({ name: 'INCX', code: OPCODES.INCX, family: 'Data movement', since: 'cpu8x' }),
  Object.freeze({ name: 'DECX', code: OPCODES.DECX, family: 'Data movement', since: 'cpu8x' }),
  Object.freeze({ name: 'ADD', code: OPCODES.ADD, family: 'Arithmetic & shifts', since: 'cpu8' }),
  Object.freeze({ name: 'SUB', code: OPCODES.SUB, family: 'Arithmetic & shifts', since: 'cpu8' }),
  Object.freeze({ name: 'INC', code: OPCODES.INC, family: 'Arithmetic & shifts', since: 'cpu8' }),
  Object.freeze({ name: 'DEC', code: OPCODES.DEC, family: 'Arithmetic & shifts', since: 'cpu8' }),
  Object.freeze({ name: 'SHL', code: OPCODES.SHL, family: 'Arithmetic & shifts', since: 'cpu8' }),
  Object.freeze({ name: 'SHR', code: OPCODES.SHR, family: 'Arithmetic & shifts', since: 'cpu8' }),
  Object.freeze({ name: 'AND', code: OPCODES.AND, family: 'Bitwise logic', since: 'cpu8' }),
  Object.freeze({ name: 'OR', code: OPCODES.OR, family: 'Bitwise logic', since: 'cpu8' }),
  Object.freeze({ name: 'XOR', code: OPCODES.XOR, family: 'Bitwise logic', since: 'cpu8' }),
  Object.freeze({ name: 'CMP_IMM', code: OPCODES.CMP_IMM, family: 'Comparison', since: 'cpu8' }),
  Object.freeze({ name: 'CMP_REG', code: OPCODES.CMP_REG, family: 'Comparison', since: 'cpu8' }),
  Object.freeze({ name: 'PUSH', code: OPCODES.PUSH, family: 'Stack & subroutines', since: 'cpu8s' }),
  Object.freeze({ name: 'POP', code: OPCODES.POP, family: 'Stack & subroutines', since: 'cpu8s' }),
  Object.freeze({ name: 'CALL', code: OPCODES.CALL, family: 'Stack & subroutines', since: 'cpu8s' }),
  Object.freeze({ name: 'RET', code: OPCODES.RET, family: 'Stack & subroutines', since: 'cpu8s' }),
  Object.freeze({ name: 'CALL16', code: OPCODES.CALL16, family: 'Stack & subroutines', since: 'cpu8x' }),
  Object.freeze({ name: 'JMP', code: OPCODES.JMP, family: 'Branches', since: 'cpu8' }),
  Object.freeze({ name: 'JZ', code: OPCODES.JZ, family: 'Branches', since: 'cpu8' }),
  Object.freeze({ name: 'JNZ', code: OPCODES.JNZ, family: 'Branches', since: 'cpu8' }),
  Object.freeze({ name: 'JC', code: OPCODES.JC, family: 'Branches', since: 'cpu8' }),
  Object.freeze({ name: 'JNC', code: OPCODES.JNC, family: 'Branches', since: 'cpu8' }),
  Object.freeze({ name: 'JMP16', code: OPCODES.JMP16, family: 'Branches', since: 'cpu8x' }),
  Object.freeze({ name: 'JZ16', code: OPCODES.JZ16, family: 'Branches', since: 'cpu8x' }),
  Object.freeze({ name: 'JNZ16', code: OPCODES.JNZ16, family: 'Branches', since: 'cpu8x' }),
  Object.freeze({ name: 'JC16', code: OPCODES.JC16, family: 'Branches', since: 'cpu8x' }),
  Object.freeze({ name: 'JNC16', code: OPCODES.JNC16, family: 'Branches', since: 'cpu8x' }),
]);
