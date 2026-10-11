// Regenerates the instruction table in docs/cpu-levels.md from src/opcodes.js:
//   npm run docs
import fs from 'node:fs';
import { INSTRUCTIONS, WIDE_OPERATIONS, sizeOf, cycleLabel } from '../src/opcodes.js';
import { ARCHITECTURES } from '../src/architectures.js';

const file = new URL('../docs/cpu-levels.md', import.meta.url);
const { cpu8, cpu8x } = ARCHITECTURES;
const level = { cpu8: '8', cpu8s: '8S', cpu8x: '8X' };
const rows = INSTRUCTIONS.map(i => {
  const code = i.code.toString(16).toUpperCase().padStart(2, '0');
  const wide = WIDE_OPERATIONS.has(i.name) ? `${sizeOf(i, cpu8x, true)} · ${cycleLabel(i, cpu8x, true)}` : '';
  return `| \`${code}\` | \`${i.syntax}\` | ${i.summary} | ${i.flags} | ${level[i.since]} | ${sizeOf(i, cpu8)} · ${sizeOf(i, cpu8x)} | ${cycleLabel(i, cpu8)} · ${cycleLabel(i, cpu8x)} | ${wide} |`;
});
const table = ['| Opcode | Instruction | Effect | Flags | Since | Bytes 8/8S · 8X | Cycles 8/8S · 8X | With X/Y: bytes · cycles |',
  '|---|---|---|---|---|---|---|---|', ...rows].join('\n');
const doc = fs.readFileSync(file, 'utf8');
const begin = '<!-- instructions -->', end = '<!-- /instructions -->';
const a = doc.indexOf(begin), b = doc.indexOf(end);
if (a < 0 || b < 0) throw new Error(`docs/cpu-levels.md needs the markers ${begin} and ${end}`);
fs.writeFileSync(file, `${doc.slice(0, a + begin.length)}\n${table}\n${doc.slice(b)}`);
console.log(`${rows.length} instructions written to docs/cpu-levels.md`);
