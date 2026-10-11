/**
 * Turns a program into memory contents: assembly is assembled directly, MiniC
 * is compiled to assembly first. For C, every address is mapped back to the C
 * line it came from, so the editor can show the bytes and the running line
 * next to the C source, and the generated assembly can be shown beside it.
 */
import { assemble, AssemblyError } from './assembler.js';
import { compile, CompileError } from './minic.js';

export const languageOf = file => (/\.c$/i.test(file ?? '') ? 'c' : 'asm');

/** Bytes reserved for the stack before the compiler warns that the program is too big. */
const STACK_RESERVE = 32;

export function build(text, language = 'asm') {
  if (language !== 'c') return { ...assemble(text), language: 'asm' };
  const compiled = compile(text);
  let assembly;
  try {
    assembly = assemble(compiled.asm);
  } catch (error) {
    if (!(error instanceof AssemblyError)) throw error;
    const line = compiled.lines[error.line - 1] ?? 0;
    throw new CompileError(line, /does not fit/.test(error.detail) ? error.detail : `In the generated assembly: ${error.detail}`);
  }
  const cLine = asmLine => compiled.lines[asmLine - 1] || 0;

  // Every address belongs to the C line its instruction came from.
  const sourceMap = new Map();
  for (const [address, line] of assembly.sourceMap) { const c = cLine(line); if (c) sourceMap.set(address, c); }

  // The margin of the C editor: per C line, its first run of consecutive bytes.
  const byLine = new Map();
  for (const entry of assembly.listing) {
    const line = cLine(entry.line);
    if (!line) continue;
    const known = byLine.get(line);
    if (!known) byLine.set(line, { line, address: entry.address, size: entry.size, bytes: [...entry.bytes], source: entry.source });
    else if (known.address + known.size === entry.address) { known.size += entry.size; known.bytes.push(...entry.bytes); }
  }
  const listing = [...byLine.values()];
  const lineAddresses = new Map(listing.map(entry => [entry.line, entry.address]));

  const warnings = [...compiled.warnings, ...assembly.warnings.map(w => ({ ...w, line: cLine(w.line) }))];
  const end = assembly.listing.reduce((max, e) => Math.max(max, e.address + e.size), 0);
  const free = assembly.memory.length - end;
  if (free < STACK_RESERVE && assembly.architecture !== 'cpu8') {
    warnings.push({ line: 0, message: `Only ${free} bytes are left for the stack at the end of RAM: calls and local variables may overwrite the variables` });
  }
  return {
    ...assembly,
    language: 'c',
    asm: compiled.asm,
    asmAssembly: assembly,
    sourceMap,
    listing,
    lineAddresses,
    warnings,
  };
}

export { AssemblyError, CompileError };
