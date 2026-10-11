// The instruction-set reference, generated from the same tables the
// assembler and the CPU use, so it can never disagree with them.
import { ARCHITECTURES } from '/src/architectures.js';
import { INSTRUCTIONS, availableOn, sizeOf, cycleLabel } from '/src/opcodes.js';
import { MODES } from '/src/display.js';
import { hex } from '/src/cpu.js';
import { el } from './util.js';

const LEVELS = {
  cpu8: {
    lead: 'The starting point: everything a CPU needs and nothing more.',
    points: [
      ['RAM', '256 bytes, addresses 0x00–0xFF. Program, data and screen all live in this one memory.'],
      ['Registers', 'A, B, C, D — 8 bits each, values 0–255. PC (program counter) points at the next instruction.'],
      ['Flags', 'ZF is set when a result is zero, CF on a carry (ADD, INC, SHL) or a borrow (SUB, DEC, CMP: “less than”).'],
      ['Addresses', 'One byte. LDA, STA and jumps carry the address right after the opcode.'],
      ['Start', 'The CPU starts at address 0x00 and runs until HLT.'],
    ],
    limits: 'Without a stack, a piece of code cannot be reused from several places: there is no way to remember where to go back to.',
  },
  cpu8s: {
    lead: 'MiniCPU 8 plus a stack: functions with arguments, local variables and recursion.',
    points: [
      ['Stack', 'SP (stack pointer) starts at 0x100, just past the end of RAM. PUSH stores a byte below SP, POP reads it back. The stack grows downwards through ordinary RAM.'],
      ['Subroutines', 'CALL pushes the address of the next instruction and jumps; RET pops that address and continues there. Calls can be nested.'],
      ['Stack frames', 'SUB SP, n makes room for n bytes of local variables, ADD SP, n frees them. LDA and STA with [SP+n] reach n bytes above SP without popping: first the locals, then the return address, then the arguments the caller pushed. Results usually come back in A. There is no base pointer: every PUSH shifts the offsets.'],
      ['Same RAM', 'Stack, code and screen share 256 bytes. Too many PUSHes or calls overwrite whatever lies below — watch SP.'],
    ],
    limits: 'Still 256 bytes in total: room for small programs and small screens only.',
  },
  cpu8x: {
    lead: 'MiniCPU 8S with 16 times the memory and pointer registers.',
    points: [
      ['RAM', '4096 bytes (4 KiB), addresses 0x0000–0x0FFF. Big enough for tables, larger screens and longer programs.'],
      ['Addresses', 'Two bytes, low byte first. LDA, STA, jumps and CALL become one byte longer and one cycle slower. PC, SP and return addresses are 16 bits.'],
      ['X and Y', 'A–D still hold only 0–255, so 8X adds two 16-bit pointer registers. LDX/LDY load them, [X]/[Y] read and write where they point, INCX/DECX/INCY/DECY move them.'],
      ['XL, XH, YL, YH', 'The low and high byte of X and Y. MOV copies between them and A–D, so a program can compute an address, e.g. MOV XH, A.'],
    ],
    limits: 'Registers and arithmetic stay 8 bits wide: 16-bit numbers need two bytes and the carry flag.',
  },
};

function instructionTable(arch) {
  const previous = { cpu8: null, cpu8s: 'cpu8', cpu8x: 'cpu8s' }[arch.id];
  const rows = [];
  let family = null;
  for (const info of INSTRUCTIONS) {
    if (!availableOn(info, arch.id)) continue;
    if (info.family !== family) {
      family = info.family;
      rows.push(el('tr', { class: 'family-row' }, el('th', { colspan: 6 }, family)));
    }
    const isNew = previous && !availableOn(info, previous);
    const changed = !isNew && previous && sizeOf(info, arch) !== sizeOf(info, ARCHITECTURES[previous]);
    rows.push(el('tr', { class: isNew ? 'new' : '' },
      el('td', {}, el('code', {}, info.syntax), isNew ? el('span', { class: 'new-tag' }, 'new') : null),
      el('td', {}, info.summary),
      el('td', { class: 'flags' }, info.flags),
      el('td', { class: `num${changed ? ' changed' : ''}` }, String(sizeOf(info, arch))),
      el('td', { class: `num${changed ? ' changed' : ''}` }, cycleLabel(info, arch)),
      el('td', { class: 'num' }, el('code', {}, hex(info.code)))));
  }
  return el('table', { class: 'reference-table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Instruction'), el('th', {}, 'Effect'), el('th', {}, 'Flags'),
      el('th', { class: 'num' }, 'Bytes'), el('th', { class: 'num', title: 'Clock cycles; for conditional jumps: not taken / taken' }, 'Cycles'), el('th', { class: 'num' }, 'Opcode'))),
    el('tbody', {}, rows));
}

function levelPage(arch) {
  const text = LEVELS[arch.id];
  return el('div', { class: 'reference-page' },
    el('p', { class: 'reference-lead' }, text.lead),
    el('dl', { class: 'reference-facts' }, text.points.flatMap(([term, detail]) => [el('dt', {}, term), el('dd', {}, detail)])),
    el('p', { class: 'muted reference-limit' }, text.limits),
    instructionTable(arch),
    el('p', { class: 'muted reference-note' },
      'Cycles: one per instruction byte, one per data byte read or written, one when PC jumps, one for pointer arithmetic. ',
      'Registers are encoded as A=0, B=1, C=2, D=3; two registers share one byte (first << 4 | second).'));
}

function assemblerPage() {
  const row = (code, text) => el('tr', {}, el('td', {}, el('code', {}, code)), el('td', {}, text));
  return el('div', { class: 'reference-page' },
    el('h3', {}, 'Directives'),
    el('table', { class: 'reference-table compact' }, el('tbody', {},
      row('.cpu 8x', 'Chooses the CPU level: 8, 8s or 8x. Without it, a program runs on MiniCPU 8. The CPU menu edits this line.'),
      row('.org 0x60', 'Continue placing bytes at this address.'),
      row('.db 1, 2, "Hi", 0', 'Put bytes into RAM: numbers, characters or strings.'),
      row('WIDTH .equ 16', 'A named constant.'),
      row('loop:', 'A label is the address of the following byte.'),
      row('.display 0x80, 16, 8, indexed4, pico_8', 'Suggests how the screen should show RAM: start, width, height, pixel format [, palette].'),
    )),
    el('h3', {}, 'Values'),
    el('p', {}, 'Decimal ', el('code', {}, '42'), ', hexadecimal ', el('code', {}, '0x2A'), ', binary ', el('code', {}, '0b101010'),
      ', characters ', el('code', {}, "'A'"), ', labels and constants, combined with ', el('code', {}, '+ - * / & | << >>'),
      ' and parentheses, e.g. ', el('code', {}, 'screen + 16 * y'), ' or ', el('code', {}, 'table >> 8'), '. Negative bytes wrap: ',
      el('code', {}, '-1'), ' is 255. Comments start with ', el('code', {}, ';'), '.'),
    el('h3', {}, 'Pixel formats'),
    el('table', { class: 'reference-table compact' }, el('tbody', {},
      Object.entries(MODES).map(([mode, spec]) => row(mode, `${spec.label}${spec.indexed ? ' from a palette' : ''}${spec.bits < 8 ? `, ${8 / spec.bits} pixels per byte (leftmost pixel in the highest bits)` : ''}`)))),
    el('p', {}, 'Every screen row starts on a new byte. The screen only reads RAM: changing the format, the start or the size never changes a byte.'));
}

export class Reference {
  constructor(ui) {
    this.ui = ui;
    this.pages = { ...Object.fromEntries(Object.values(ARCHITECTURES).map(arch => [arch.id, () => levelPage(arch)])), assembler: assemblerPage };
    const labels = { cpu8: '8', cpu8s: '8S', cpu8x: '8X', assembler: 'Assembler' };
    this.tabs = Object.keys(this.pages).map(key => el('button', {
      type: 'button', role: 'tab', 'aria-selected': 'false', dataset: { page: key }, onclick: () => this.show(key),
    }, key === 'assembler' ? labels[key] : `MiniCPU ${labels[key]}`));
    ui.tabs.replaceChildren(...this.tabs);
    ui.close.addEventListener('click', () => ui.dialog.close());
  }

  open(page) {
    this.show(page);
    this.ui.dialog.showModal();
  }

  show(page) {
    for (const tab of this.tabs) tab.setAttribute('aria-selected', String(tab.dataset.page === page));
    this.ui.body.replaceChildren(this.pages[page]());
    this.ui.body.scrollTop = 0;
  }
}
