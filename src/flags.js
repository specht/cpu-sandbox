/**
 * Why ZF and CF are what they are: an explanation in words, from the last
 * instruction and the values it worked on. Shown when hovering the flags.
 */
const ARITHMETIC = new Set(['ADD', 'ADC', 'SUB', 'SBC', 'CMP', 'INC', 'DEC']);
const LOGIC = new Set(['AND', 'OR', 'XOR']);
const SHIFTS = new Set(['SHL', 'SHR']);
const BYTES = ['A', 'B', 'C', 'D'];

/** The value of an operand before the instruction: a register, a constant or [memory]. */
function operand(text, before, memory) {
  const t = text.trim();
  if (BYTES.includes(t)) return before.registers[BYTES.indexOf(t)];
  if (t === 'X' || t === 'Y') return before[t.toLowerCase()];
  const m = t.match(/^\[(.+)\]$/);
  if (m) {
    const inner = m[1].trim(), address = inner === 'X' || inner === 'Y' ? before[inner.toLowerCase()] : BYTES.includes(inner) ? before.registers[BYTES.indexOf(inner)] : Number(inner);
    return Number.isFinite(address) ? memory[address] ?? 0 : null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** { ZF, CF }: one sentence each, or null when there is no step yet. */
export function explainFlags(cpu) {
  const step = cpu.lastStep();
  if (!step) return null;
  const [mnemonic, rest = ''] = step.text.split(/ (.*)/s);
  const args = rest ? rest.split(',').map(s => s.trim()) : [];
  const { zf, cf } = cpu, b = step.before;
  const unchanged = `${mnemonic} does not change the flags: ${zf === b.zf && cf === b.cf ? 'they are still from an earlier instruction' : 'they changed when stepping back'}.`;
  if (mnemonic === 'CLF') return { ZF: 'CLF cleared both flags: ZF = 0.', CF: 'CLF cleared both flags: CF = 0.' };
  if (!ARITHMETIC.has(mnemonic) && !LOGIC.has(mnemonic) && !SHIFTS.has(mnemonic)) return { ZF: unchanged, CF: unchanged };

  const dest = args[0], wide = dest === 'X' || dest === 'Y', bits = wide ? 16 : 8, size = 2 ** bits;
  const a = operand(dest, b, cpu.memory);
  const zfText = r => (zf ? `the result of ${step.text} is 0, so ZF = 1.` : `the result of ${step.text} is ${r ?? 'not 0'}, not 0, so ZF = 0.`);

  if (LOGIC.has(mnemonic)) {
    const c = operand(args[1], b, cpu.memory);
    const r = a === null || c === null ? null : mnemonic === 'AND' ? a & c : mnemonic === 'OR' ? a | c : a ^ c;
    return { ZF: zfText(r), CF: `${mnemonic} always clears the carry: CF = 0.` };
  }
  if (SHIFTS.has(mnemonic)) {
    const out = mnemonic === 'SHL' ? 'bit 7' : 'bit 0';
    const r = a === null ? null : mnemonic === 'SHL' ? (a << 1) & 255 : a >> 1;
    return { ZF: zfText(r), CF: `${mnemonic} shifts ${out} of ${a} (0b${(a ?? 0).toString(2).padStart(8, '0')}) out into the carry: it was ${cf ? 1 : 0}, so CF = ${cf ? 1 : 0}.` };
  }

  // Arithmetic: compute the exact result, then see whether it fits.
  const one = mnemonic === 'INC' || mnemonic === 'DEC';
  const c = one ? 1 : operand(args[1], b, cpu.memory);
  const carryIn = (mnemonic === 'ADC' || mnemonic === 'SBC') && b.cf ? 1 : 0;
  if (a === null || c === null) return { ZF: zfText(null), CF: `CF = ${cf ? 1 : 0} after ${step.text}.` };
  const plus = mnemonic === 'ADD' || mnemonic === 'ADC' || mnemonic === 'INC';
  const exact = plus ? a + c + carryIn : a - c - carryIn;
  const shown = `${a} ${plus ? '+' : '−'} ${c}${carryIn ? ` ${plus ? '+' : '−'} 1 (the carry)` : ''} = ${exact}`;
  const r = ((exact % size) + size) % size;
  let CF;
  if (plus) {
    CF = exact >= size
      ? `${shown} does not fit into ${bits} bits, so CF = 1 and ${dest} keeps ${exact} − ${size} = ${r}.`
      : `${shown} fits into ${bits} bits, so CF = 0.`;
  } else {
    CF = exact < 0
      ? `${shown}: ${a} is smaller than ${c + carryIn}, a borrow is needed, so CF = 1${mnemonic === 'CMP' ? '' : ` and ${dest} becomes ${exact} + ${size} = ${r}`}.`
      : `${shown}: no borrow is needed, so CF = 0.`;
    if (mnemonic === 'CMP') CF += ' (CMP subtracts only to set the flags: CF = 1 means the first value is smaller.)';
  }
  const ZF = mnemonic === 'CMP'
    ? (zf ? `CMP ${dest}, ${args[1]}: both values are ${a}, the difference is 0, so ZF = 1.` : `CMP ${dest}, ${args[1]}: ${a} and ${c} differ, so ZF = 0.`)
    : zfText(r);
  return { ZF, CF };
}
