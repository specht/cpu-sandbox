/**
 * What lives where in RAM, for the RAM view: code and data, the named things
 * the assembler or the compiler knows about (labels, C variables, strings,
 * helper routines), and, while a C program runs, its stack frames: local
 * variables, arguments and return addresses.
 */
import { hex } from './cpu.js';

export const REGION = Object.freeze({ FREE: 0, CODE: 1, DATA: 2 });

const KIND_TEXT = {
  function: 'function', runtime: 'helper routine', global: 'global variable', static: 'variable',
  string: 'string', temp: 'temporary value', label: 'label', data: 'data',
};

/** Builds the static map of a program: regions, named items and the owner of every byte. */
export function memoryMap(program) {
  const size = program.memory.length;
  const region = new Uint8Array(size);
  const instructions = program.asmAssembly?.listing ?? program.listing;
  for (const entry of instructions) region.fill(entry.kind === 'data' ? REGION.DATA : REGION.CODE, entry.address, entry.address + entry.size);

  const items = [];
  if (program.language === 'c') {
    for (const s of program.symbols ?? []) {
      if (s.address === undefined) continue;
      items.push({ ...s, start: s.address, size: s.size ?? 0 });
    }
  } else {
    for (const [name, { address, line }] of program.addressLabels ?? []) {
      if (address >= size) continue;
      items.push({ name, label: name, start: address, size: 0, line, kind: region[address] === REGION.DATA ? 'data' : 'label' });
    }
  }
  // Items without a size reach up to the next item or the end of their run of code or data.
  items.sort((a, b) => a.start - b.start);
  items.forEach((item, i) => {
    if (item.size) return;
    const next = items.slice(i + 1).find(other => other.start > item.start)?.start ?? size;
    let end = item.start;
    const kind = region[item.start];
    while (end < next && region[end] === kind && kind !== REGION.FREE) end++;
    item.size = end - item.start;
  });
  const owner = new Int32Array(size).fill(-1);
  items.forEach((item, i) => { for (let a = item.start; a < item.start + item.size && a < size; a++) if (owner[a] < 0) owner[a] = i; });
  const starts = new Uint8Array(size);
  for (const item of items) if (item.size && item.start < size) starts[item.start] = 1;

  // The instruction that covers each code byte, for the hover text.
  const instruction = new Int32Array(size).fill(-1);
  instructions.forEach((entry, i) => { if (entry.kind !== 'data') instruction.fill(i, entry.address, entry.address + entry.size); });
  return { region, items, owner, starts, instruction, instructions };
}

/**
 * The stack frames of a running C program, innermost first: locals,
 * arguments, return addresses and values waiting on the stack.
 */
export function stackItems(program, cpu) {
  const out = [];
  if (program.language !== 'c' || !program.frames || cpu.sp === null) return out;
  const memory = cpu.memory, wide = program.architecture === 'cpu8x';
  const callSize = wide ? 3 : 2;
  let sp = cpu.sp, pc = cpu.pc, depth = 0, args = 0;   // args: bytes the callee already showed as its arguments
  for (let guard = 0; guard < 64; guard++) {
    const frame = program.frames.get(pc);
    const info = frame && program.functions[frame.fn];
    if (!info) break;
    const base = sp + frame.depth;
    const fn = `${frame.fn}()`, level = depth++;
    if (frame.depth > args) out.push({ start: sp + args, size: frame.depth - args, name: 'pushed value', kind: 'pushed', level, detail: `a value ${fn} keeps on the stack while it computes` });
    for (const local of info.locals) out.push({ start: base + local.offset, size: local.size, name: local.name, kind: 'local', level, detail: `${local.type} ${local.name} · local variable of ${fn}` });
    const at = base + info.frame;
    if (at + info.ret > memory.length) break;
    const back = wide ? memory[at] | memory[at + 1] << 8 : memory[at];
    out.push({ start: at, size: info.ret, name: 'return address', kind: 'return', level, detail: `return address of ${fn}: back to 0x${hex(back, wide ? 4 : 2)}` });
    for (const param of info.params) out.push({ start: base + param.offset, size: param.size, name: param.name, kind: 'argument', level, detail: `${param.type} ${param.name} · argument of ${fn}` });
    sp = at + info.ret;
    pc = back - callSize;
    args = info.params.reduce((n, param) => n + param.size, 0);
  }
  return out.filter(item => item.start >= cpu.sp && item.start < memory.length);
}

/** One line about a byte: its value and what it belongs to. */
export function describe(map, program, address, value, stack = []) {
  const parts = [`0x${hex(address, program.memory.length > 256 ? 4 : 2)} = 0x${hex(value)} = ${value}${value >= 32 && value < 127 ? ` = '${String.fromCharCode(value)}'` : ''}`];
  const onStack = stack.find(item => address >= item.start && address < item.start + item.size);
  if (onStack) {
    parts.push(onStack.size > 1 ? `${onStack.detail} (byte ${address - onStack.start + 1} of ${onStack.size})` : onStack.detail);
    return parts.join(' · ');
  }
  const i = map.owner[address], item = i >= 0 ? map.items[i] : null;
  const code = map.instruction[address] >= 0 ? map.instructions[map.instruction[address]] : null;
  if (item) {
    const kind = KIND_TEXT[item.kind] ?? item.kind;
    if (item.kind === 'global' || item.kind === 'static') {
      const offset = address - item.start;
      const element = item.element ? `${item.name}[${Math.floor(offset / item.element)}]${item.element > 1 ? `, ${offset % item.element ? 'high' : 'low'} byte` : ''}`
        : item.size > 1 ? `${offset ? 'high' : 'low'} byte` : '';
      parts.push(`${item.type ? `${item.type.replace(/\[\d*\]$/, '')} ` : ''}${item.name}${item.element ? `[${item.size / item.element}]` : ''} · ${kind}${element ? ` · ${element}` : ''}`);
    } else if (item.kind === 'function') parts.push(`${item.type ?? item.name} · ${kind}`);
    else if (item.kind === 'string') parts.push(`${kind} ${item.type}`);
    else if (item.kind === 'runtime') parts.push(`${item.name}: ${item.type} · ${kind}`);
    else parts.push(`${item.name}: ${kind}`);
  }
  if (code) {
    const line = program.sourceMap.get(code.address);
    parts.push(`${code.source.replace(/\s*;.*$/, '').replace(/^\w+:\s*/, '')}${line ? ` · line ${line}` : ''}`);
  } else if (!item && map.region[address] === REGION.DATA) {
    const line = program.sourceMap.get(address);
    parts.push(`data${line ? ` · line ${line}` : ''}`);
  }
  return parts.join(' · ');
}
