// The cycles of one instruction: a strip of its cycles, a small picture of
// the CPU, the buses, RAM and the devices, and one sentence per cycle. The
// cycles come from src/trace.js and are exactly those the clock counts.
import { DEVICES } from '/src/devices.js';
import { hex } from '/src/cpu.js';
import { el } from './util.js';

// What the bytes after the opcode are, per instruction form.
const ROLES = {
  r: ['the register'], ri: ['the register', 'the constant'], rr: ['the two registers (one per half byte)'],
  ra: ['the register', 'the address'], ar: ['the address', 'the register'], a: ['the address'],
  i: ['the amount'], rp: ['the register', 'the port'], pr: ['the port', 'the register'],
  rs: ['the register', 'the offset'], sr: ['the offset', 'the register'],
};
const KIND_LABEL = { fetch: 'Fetch', read: 'Read', write: 'Write', in: 'Input', out: 'Output', jump: 'Jump', alu: 'ALU' };
const portName = port => DEVICES.find(d => d.port === port)?.name ?? 'a device';

/** A role for every operand byte that is fetched after the opcode. */
function roles(trace, wideAddresses) {
  const fetched = trace.cycles.filter(c => c.kind === 'fetch').length - 1;
  const out = [];
  for (const role of ROLES[trace.info?.form] ?? []) {
    if (role === 'the address' && wideAddresses) out.push('the address, low byte', 'the address, high byte');
    else out.push(role);
  }
  // A constant for X or Y has two bytes.
  if (out.length + 1 === fetched && out.includes('the constant')) out.splice(out.indexOf('the constant'), 1, 'the constant, low byte', 'the constant, high byte');
  return out.length === fetched ? out : Array(fetched).fill('an operand byte');
}

export class CyclePanel {
  constructor(node) {
    this.node = node;
  }

  /** micro: { trace, index, done } (index −1: nothing of it has happened yet). */
  render(micro, arch) {
    const { trace } = micro;
    if (!trace) { this.node.replaceChildren(el('p', { class: 'cycle-text muted' }, 'The CPU has stopped: there is no next instruction.')); return; }
    const digits = arch.addressBits / 4, a = n => `0x${hex(n, digits)}`, b = n => `0x${hex(n)}`;
    const index = micro.index, cycle = trace.cycles[index] ?? null, last = trace.cycles.length - 1;
    const operandRoles = roles(trace, arch.addressBits === 16);
    let fetches = 0;
    const strip = trace.cycles.map((c, i) => {
      const role = c.kind === 'fetch' ? (fetches++ === 0 ? 'opcode' : operandRoles[fetches - 2]?.replace(/^the /, '') ?? '') : '';
      const state = i < index ? 'done' : i === index ? 'current' : 'next';
      return el('span', { class: `cycle-chip ${c.kind} ${state}`, title: role ? `${KIND_LABEL[c.kind]}: ${role}` : KIND_LABEL[c.kind] },
        el('b', {}, String(i + 1)), KIND_LABEL[c.kind]);
    });

    // The buses in this cycle.
    let address = null, data = null, direction = '', target = '', text;
    const ir = trace.info ? `${b(trace.cycles[0].value)} ${trace.info.name.replace(/_.*/, '')}` : '?';
    if (!cycle) {
      text = micro.done
        ? `${micro.done.text} is done after ${micro.done.total} cycle${micro.done.total === 1 ? '' : 's'}. Next: ${trace.text}, ${trace.cycles.length} cycles. Press → for its first cycle.`
        : `Next: ${trace.text}, ${trace.cycles.length} cycle${trace.cycles.length === 1 ? '' : 's'}. Press → for the first cycle: fetching the opcode.`;
    } else if (cycle.kind === 'fetch' && index === 0) {
      address = a(cycle.address); data = b(cycle.value); direction = 'in'; target = 'ram';
      text = `Fetch: PC = ${a(cycle.address)} goes onto the address bus, RAM answers with ${b(cycle.value)} on the data bus. The instruction register keeps it: the opcode of ${trace.info?.name.replace(/_.*/, '') ?? '?'}. PC moves on to ${a(cycle.pc)}. `
        + `Decode: ${trace.text} has ${trace.cycles.filter(c => c.kind === 'fetch').length} byte${trace.cycles.filter(c => c.kind === 'fetch').length === 1 ? '' : 's'} and takes ${trace.cycles.length} cycle${trace.cycles.length === 1 ? '' : 's'}.`;
    } else if (cycle.kind === 'fetch') {
      const n = trace.cycles.slice(1, index + 1).filter(c => c.kind === 'fetch').length - 1;
      address = a(cycle.address); data = b(cycle.value); direction = 'in'; target = 'ram';
      text = `Fetch: the next byte at ${a(cycle.address)} is ${b(cycle.value)}: ${operandRoles[n]}. PC moves on to ${a(cycle.pc)}.`;
    } else if (cycle.kind === 'read') {
      address = a(cycle.address); data = b(cycle.value); direction = 'in'; target = 'ram';
      text = `Read: the CPU puts ${a(cycle.address)} on the address bus, RAM answers with ${b(cycle.value)}${cycle.detail === 'stack' ? ' from the stack' : ''}.`;
    } else if (cycle.kind === 'write') {
      address = a(cycle.address); data = b(cycle.value); direction = 'out'; target = 'ram';
      text = `Write: the CPU puts ${a(cycle.address)} on the address bus and ${b(cycle.value)} on the data bus; RAM stores it${cycle.detail === 'stack' ? ' on the stack' : ''}.`;
    } else if (cycle.kind === 'in') {
      address = `port ${b(cycle.port)}`; data = b(cycle.value); direction = 'in'; target = 'io';
      text = `Input: the CPU asks port ${b(cycle.port)} (${portName(cycle.port)}), which answers with ${b(cycle.value)}.`;
    } else if (cycle.kind === 'out') {
      address = `port ${b(cycle.port)}`; data = b(cycle.value); direction = 'out'; target = 'io';
      text = `Output: the CPU sends ${b(cycle.value)} to port ${b(cycle.port)} (${portName(cycle.port)}).`;
    } else if (cycle.kind === 'jump') {
      text = `Jump: PC is loaded with ${a(cycle.pc)}; the next instruction is fetched from there.`;
    } else {
      text = cycle.detail === 'sp'
        ? 'ALU: SP is changed, an extra cycle without the buses.'
        : 'ALU: X and Y have 16 bits, but the ALU only 8: the high byte takes a second cycle.';
    }
    if (cycle && index === last) text += ' The instruction is complete: its result is now in the registers.';

    const pc = cycle?.kind === 'jump' ? cycle.pc : [...trace.cycles.slice(0, index + 1)].reverse().find(c => c.kind === 'fetch')?.pc ?? trace.cycles[0].address;
    const box = (name, cls, ...content) => el('div', { class: `dp-box ${cls}` }, el('b', {}, name), ...content);
    const bus = (label, value, dir) => el('div', { class: `dp-bus ${value === null ? 'idle' : dir}` },
      el('span', { class: 'dp-label' }, label), el('span', { class: 'dp-line' }), el('code', {}, value ?? '—'));
    const diagram = el('div', { class: 'datapath' },
      box('CPU', `cpu${cycle?.kind === 'alu' || cycle?.kind === 'jump' ? ' active' : ''}`,
        el('span', {}, 'PC ', el('code', {}, a(pc))),
        el('span', {}, 'IR ', el('code', {}, index >= 0 ? ir : '—')),
        el('span', { class: cycle?.kind === 'alu' ? 'lit' : '' }, 'ALU')),
      el('div', { class: 'dp-buses' },
        bus('address bus →', address, 'out'),
        bus(direction === 'out' ? 'data bus →' : 'data bus ←', data, direction)),
      el('div', { class: 'dp-side' },
        box('RAM', target === 'ram' ? 'active' : '', el('code', {}, target === 'ram' ? `[${address}] = ${data}` : '')),
        box('Devices', target === 'io' ? 'active' : '', el('code', {}, target === 'io' ? `${address}` : ''))));
    this.node.replaceChildren(
      el('div', { class: 'cycle-head' }, el('code', { class: 'cycle-instruction' }, trace.text), el('div', { class: 'cycle-strip' }, strip)),
      diagram,
      el('p', { class: 'cycle-text' }, text));
  }
}
