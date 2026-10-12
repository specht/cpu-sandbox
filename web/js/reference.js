// The documentation dialog. The instruction tables are generated from the same tables the
// assembler and the CPU use, so it can never disagree with them.
import { ARCHITECTURES } from '/src/architectures.js';
import { INSTRUCTIONS, WIDE_OPERATIONS, availableOn, sizeOf, cycleLabel } from '/src/opcodes.js';
import { MODES } from '/src/display.js';
import { DEVICES } from '/src/devices.js';
import { PALETTES, defaultPalette } from '/src/palettes.js';
import { hex } from '/src/cpu.js';
import { el } from './util.js';

const LEVELS = {
  cpu8: {
    lead: 'Everything a CPU needs and nothing more.',
    points: [
      ['RAM', '256 bytes, addresses 0x00–0xFF. Program, data and screen all live in this one memory; nothing stops a program from overwriting its own instructions.'],
      ['Registers', 'A, B, C, D — 8 bits each, values 0–255. PC (program counter) holds the address of the next instruction.'],
      ['Flags', 'ZF is set when a result is zero. CF is set on a carry (ADD, ADC, INC, SHL), on a borrow (SUB, SBC, DEC, CMP: the first value was smaller) and by the bit SHR shifts out. AND, OR and XOR clear CF. Loads, stores, MOV and jumps leave the flags alone.'],
      ['Values and memory', 'The destination comes first. Square brackets always mean “the memory at”: LDI A, 0x70 loads the number 0x70, LDA A, [0x70] the byte stored at address 0x70, LDA A, [B] the byte at the address that is in B. Whether a number is written in decimal or hex makes no difference.'],
      ['Start', 'The CPU starts at address 0x00 and runs until HLT.'],
      ['Devices', 'IN and OUT talk to devices at numbered I/O ports: joystick, keyboard, timer, random numbers, speaker and a number display (see Devices).'],
    ],
    note: 'Cycles: one per instruction byte, one per data byte read or written, one when PC jumps. Register numbers: A=0, B=1, C=2, D=3; two registers share one byte (first × 16 + second).',
  },
  cpu8s: {
    lead: 'MiniCPU 8 plus a stack: subroutines, arguments, local variables and recursion.',
    points: [
      ['Stack', 'SP (stack pointer) starts at 0x100, just past the end of RAM. PUSH A stores A below SP, POP A reads it back. The stack grows downwards through ordinary RAM.'],
      ['Subroutines', 'CALL pushes the address of the next instruction and jumps; RET pops that address and continues there. Calls can be nested.'],
      ['Stack frames', 'SUB SP, n makes room for n bytes of local variables, ADD SP, n frees them. LDA and STA with [SP+n] reach n bytes above SP without popping: first the locals, then the return address, then the arguments the caller pushed. Results usually come back in A. There is no base pointer: every PUSH shifts the offsets.'],
      ['Same RAM', 'Stack, code and screen share 256 bytes. Too many PUSHes or calls overwrite whatever lies below — watch SP.'],
    ],
    note: 'Cycles: one per instruction byte, one per data byte read or written (CALL and RET move the return address), one when PC jumps, one for ADD SP and SUB SP. Register numbers: A=0, B=1, C=2, D=3.',
  },
  cpu8x: {
    lead: 'MiniCPU 8S with 256 times the memory and two 16-bit registers to reach it.',
    points: [
      ['RAM', '65,536 bytes (64 KiB), addresses 0x0000–0xFFFF: everything a 16-bit address can reach. Room for tables, big screens with two pages, sprites and longer programs.'],
      ['Addresses', 'Two bytes, low byte first. LDA, STA, jumps and CALL become one byte longer and one cycle slower. PC, SP and return addresses are 16 bits.'],
      ['X and Y', 'A–D can only hold 0–255, so 8X adds two 16-bit registers. They work with the instructions you already know: LDI X, 0x0800 · LDA X, [addr] · STA [addr], X · MOV X, Y · ADD X, 32 · ADD X, A · SUB · CMP X, 0x0900 · INC X · DEC X · PUSH X · POP X. As pointers: LDA A, [X] and STA [X], A. On X and Y, ZF and CF look at all 16 bits.'],
      ['XL, XH, YL, YH', 'The low and high byte of X and Y. MOV copies between them and A–D: MOV XH, A.'],
      ['Wider is slower', 'A constant for X or Y takes two bytes, LDA and STA move two bytes, and the 8-bit ALU needs an extra cycle for 16-bit arithmetic. The table shows the cost with X or Y in the X/Y column.'],
    ],
    note: 'Cycles: one per instruction byte, one per data byte read or written (two for X and Y), one when PC jumps, one for 16-bit arithmetic. Register numbers: A=0, B=1, C=2, D=3, XL=4, XH=5, YL=6, YH=7, X=8, Y=9.',
  },
};

function instructionTable(arch) {
  const previous = { cpu8: null, cpu8s: 'cpu8', cpu8x: 'cpu8s' }[arch.id];
  const pointers = arch.id === 'cpu8x';
  const columns = pointers ? 7 : 6;
  const rows = [];
  let family = null;
  for (const info of INSTRUCTIONS) {
    if (!availableOn(info, arch.id)) continue;
    if (info.family !== family) {
      family = info.family;
      rows.push(el('tr', { class: 'family-row' }, el('th', { colspan: columns }, family)));
    }
    const isNew = previous && !availableOn(info, previous);
    const changed = !isNew && previous && sizeOf(info, arch) !== sizeOf(info, ARCHITECTURES[previous]);
    const wide = pointers && WIDE_OPERATIONS.has(info.name);
    rows.push(el('tr', { class: isNew ? 'new' : '' },
      el('td', {}, el('code', {}, info.syntax), isNew ? el('span', { class: 'new-tag' }, 'new') : null),
      el('td', {}, info.summary),
      el('td', { class: 'flags' }, info.flags),
      el('td', { class: `num${changed ? ' changed' : ''}` }, String(sizeOf(info, arch))),
      el('td', { class: `num${changed ? ' changed' : ''}` }, cycleLabel(info, arch)),
      pointers ? el('td', { class: 'num wide-cost', title: 'Bytes · cycles with X or Y' }, wide ? `${sizeOf(info, arch, true)} · ${cycleLabel(info, arch, true)}` : '') : null,
      el('td', { class: 'num' }, el('code', {}, hex(info.code)))));
  }
  return el('table', { class: 'reference-table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Instruction'), el('th', {}, 'Effect'), el('th', {}, 'Flags'),
      el('th', { class: 'num' }, 'Bytes'), el('th', { class: 'num', title: 'Clock cycles; for conditional jumps: not taken / taken' }, 'Cycles'),
      pointers ? el('th', { class: 'num', title: 'Bytes · cycles with X or Y' }, 'X/Y') : null,
      el('th', { class: 'num' }, 'Opcode'))),
    el('tbody', {}, rows));
}

function levelPage(arch) {
  const text = LEVELS[arch.id];
  return el('div', { class: 'reference-page' },
    el('p', { class: 'reference-lead' }, text.lead),
    el('dl', { class: 'reference-facts' }, text.points.flatMap(([term, detail]) => [el('dt', {}, term), el('dd', {}, detail)])),
    instructionTable(arch),
    el('p', { class: 'muted reference-note' }, text.note));
}

function cPage() {
  const row = (code, text) => el('tr', {}, el('td', {}, el('code', {}, code)), el('td', {}, text));
  return el('div', { class: 'reference-page' },
    el('p', { class: 'reference-lead' }, 'MiniC: a small C that compiles to the assembly of this CPU.'),
    el('p', {}, 'Programs in .c files are compiled while you type. The margin shows the address and bytes of every C line, ',
      'and the Assembly tab above the editor shows the generated code, each part under its C line. Stepping runs one instruction at a time.'),
    el('h3', {}, 'The language'),
    el('table', { class: 'reference-table compact' }, el('tbody', {},
      row('char  int  unsigned int  void', 'char has 8 bits (0–255). int and pointers have 16 bits on MiniCPU 8X, 8 bits on 8 and 8S.'),
      row('char *p   int a[10]', 'Pointers and arrays, also strings: char *s = "Hi"; p[i] is *(p + i).'),
      row('if else while do for break continue return', 'The usual statements; variables can be declared anywhere in a block.'),
      row('+ - * / % & | ^ ~ << >> ! && || ?: ++ --', 'All C operators. *, / and % call small helper routines, because the CPU cannot multiply.'),
      row('#define N 10   #define SQ(x) ((x)*(x))', 'Constants and macros.'),
      row('#pragma cpu 8x', 'The CPU level (default 8X). The CPU menu edits this line.'),
      row('#pragma display 0x0800, 64, 48, mono', 'Suggests the screen, like .display.'),
      row('in(TIMER)   out(NUMBER, x)', 'Read and write device ports. JOYSTICK, KEYBOARD, TIMER, RANDOM, VSYNC, KEYS, SPEAKER, NUMBER, SCREEN_PAGE, PALETTE, COLOR, NOTE_LENGTH, JOY_LEFT … JOY_FIRE and KEY_SHIFT are predefined.'),
      row('asm("INC A\\n" "INC B");', 'Inserts assembly instructions, one per line (\\n); labels and ; comments work as in assembly.'),
    )),
    el('h3', {}, 'Different from C'),
    el('ul', {},
      el('li', {}, 'char arithmetic stays 8 bits wide, like the registers: for two chars, 200 + 100 is 44. As soon as an int takes part, the computation uses int.'),
      el('li', {}, 'Arrays are declared outside of functions, and & works only on those global variables: no instruction can read SP.'),
      el('li', {}, 'No structs, floats, switch or #include. Fixed point replaces floats, e.g. 64 for 1.0.'),
      el('li', {}, 'MiniCPU 8 has no stack: only main() and no * / % except by powers of two.')),
    el('h3', {}, 'How functions work'),
    el('p', {}, 'The caller PUSHes the arguments from left to right and CALLs the function. The function makes room for its local variables with ',
      el('code', {}, 'SUB SP, n'), ' and reaches arguments and locals with ', el('code', {}, '[SP+n]'),
      '. The result comes back in A (8 bits) or X (16 bits). Global variables are labels with an underscore, e.g. ', el('code', {}, '_score'), '.'));
}

/** Printable ASCII as a 16-column grid: row = high hex digit, column = low digit. */
function asciiPage() {
  const name = { 0x20: 'SP', 0x7F: 'DEL' };
  const head = el('tr', {}, el('th', {}), ...Array.from({ length: 16 }, (_, i) => el('th', {}, hex(i, 1))));
  const rows = [2, 3, 4, 5, 6, 7].map(high => el('tr', {}, el('th', {}, `${hex(high, 1)}_`),
    ...Array.from({ length: 16 }, (_, low) => {
      const code = high * 16 + low;
      return el('td', { title: `0x${hex(code)} = ${code}` }, el('b', { class: name[code] ? 'ascii-name' : '' }, name[code] ?? String.fromCharCode(code)), el('small', {}, String(code)));
    })));
  return el('div', { class: 'reference-page' },
    el('p', { class: 'reference-lead' }, 'Characters are bytes, too: \'A\' is 0x41 = 65.'),
    el('p', {}, 'Find the high hex digit on the left and the low one at the top; the small number is the decimal value. ',
      'In a program, ', el('code', {}, "LDI A, 'A'"), ' and ', el('code', {}, '.db "Hi", 0'), ' write characters directly. ',
      'The registers show the character of their value, too.'),
    el('table', { class: 'ascii-table' }, el('thead', {}, head), el('tbody', {}, rows)),
    el('p', { class: 'muted' }, 'Below 0x20 are control codes: 0 often ends a string, 10 (0x0A) is a new line, 8 backspace, 13 return. Digits are 0x30–0x39, so a digit d is the character 0x30 + d. Upper and lower case differ by 0x20.'));
}

// The keys of a German keyboard, row by row, as the keys-held device numbers them.
const KEY_MAP = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'ß', '´'],
  ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P', 'Ü', '+'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ö', 'Ä', '#'],
  ['Y', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '-'],
];

function keyMap() {
  const cap = (label, code, extra = '') => el('span', { class: `keymap-key${extra}` }, el('b', {}, label), el('small', {}, code));
  return el('div', { class: 'keymap', role: 'img', 'aria-label': 'Key positions: row × 16 + column; Shift adds 0x80' },
    KEY_MAP.map((row, r) => el('div', { class: 'keymap-row', style: `padding-left:${r === 3 ? 0 : r * 14}px` },
      r === 3 ? cap('⇧ Shift', '+80', ' shift') : null,
      row.map((label, c) => cap(label, hex((r + 1) * 16 + c))))));
}

function devicesPage() {
  return el('div', { class: 'reference-page' },
    el('p', { class: 'reference-lead' }, 'Devices sit at numbered ports, not in RAM. IN reads a port, OUT writes one.'),
    el('p', {}, el('code', {}, 'IN A, 0x02'), ' reads the timer into A, ', el('code', {}, 'OUT 0x11, A'),
      ' shows A on the number display. Both work on every CPU level and take 4 cycles. A program polls its input devices: it reads them again and again in a loop.'),
    el('table', { class: 'reference-table' },
      el('thead', {}, el('tr', {}, el('th', { class: 'num' }, 'Port'), el('th', {}, 'Device'), el('th', {}, ''), el('th', {}, 'What the byte means'))),
      el('tbody', {}, DEVICES.map(d => el('tr', {},
        el('td', { class: 'num' }, el('code', {}, `0x${hex(d.port)}`)), el('td', {}, d.name),
        el('td', {}, el('code', {}, d.direction === 'in' ? 'IN' : 'OUT')), el('td', {}, d.summary))))),
    el('p', {}, 'Click the screen to send keys to the program: the arrow keys (or W A S D) and Space go to the joystick, every typed character also to the keyboard, and every key\'s place on the keyboard to keys held. Esc gives the keys back. The device bar above the screen shows each device the program uses; its joystick buttons can be clicked, too. The number display has a big readout of its own above the screen.'),
    el('h3', {}, 'Keys held: where each key sits'),
    el('p', {}, 'Port 0x05 gives the place of the last key that is still held: row × 16 + column, the same on every keyboard layout (here: German). Shift adds 0x80, so T is 0x24 and Shift+T is 0xA4; in C: ',
      el('code', {}, 'in(KEYS) & KEY_SHIFT'), '. With no key held (or only Shift) it gives 0. The device bar shows a Shift key that lights up while Shift is held and can be held with the mouse.'),
    keyMap(),
    el('p', {}, 'The speaker plays each note at the machine time of its OUT, for the length set at port 0x15.'),
    el('p', { class: 'muted' }, 'The timer counts machine time (cycles ÷ clock), so a game paced by the timer or by vsync keeps its speed at any clock — as long as the CPU is fast enough to do its work between two frames. The screen ports (vsync, screen page, palette) are explained under Screen.'));
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
      row('.display 0x80, 16, 8, indexed4, pico_8', 'Suggests how the screen should show RAM: start, width, height, pixel format [, palette]. See Screen.'),
    )),
    el('h3', {}, 'Values'),
    el('p', {}, 'Decimal ', el('code', {}, '42'), ', hexadecimal ', el('code', {}, '0x2A'), ', binary ', el('code', {}, '0b101010'),
      ', characters ', el('code', {}, "'A'"), ', labels and constants, combined with ', el('code', {}, '+ - * / & | << >>'),
      ' and parentheses, e.g. ', el('code', {}, 'screen + 16 * y'), ' or ', el('code', {}, 'table >> 8'), '. Negative bytes wrap: ',
      el('code', {}, '-1'), ' is 255. Comments start with ', el('code', {}, ';'), '.'));
}

const paletteName = key => key.replaceAll('_', ' ');

/** All colors of a palette as squares of the same size in every palette, in rows of up to 32. */
function swatches(colors) {
  return el('div', { class: 'palette-swatches', style: `grid-template-columns:repeat(${Math.min(colors.length, 32)}, 16px)` },
    colors.map((color, i) => el('span', { style: `background:${color}`, title: `${i} = ${color}` })));
}

function screenPage() {
  const row = (code, text) => el('tr', {}, el('td', {}, el('code', {}, code)), el('td', {}, text));
  const code = text => el('pre', { class: 'reference-code' }, text);
  return el('div', { class: 'reference-page' },
    el('p', { class: 'reference-lead' }, 'The screen is a window on RAM: a video chip reads the bytes and turns them into pixels, 60 pictures per second.'),
    el('p', {}, el('code', {}, '.display 0x4000, 128, 96, indexed8'), ' (in C: ', el('code', {}, '#pragma display …'),
      ') suggests where the screen starts, its width and height and the pixel format. The bar above the screen can change all of that while the program runs; RAM stays the same.'),
    el('h3', {}, 'Pixel formats'),
    el('table', { class: 'reference-table compact' }, el('tbody', {},
      Object.entries(MODES).map(([mode, spec]) => row(mode, `${spec.label}${spec.indexed ? ', colors from the palette chip' : ''}${spec.bits < 8 ? `, ${8 / spec.bits} pixels per byte (leftmost pixel in the highest bits)` : ''}`)))),
    el('p', {}, 'Every screen row starts on a new byte. gray8 shows the byte as a gray level, rgb332 as 3 bits red, 3 bits green and 2 bits blue, rgb24 takes three bytes per pixel.'),
    el('h3', {}, 'The palette chip'),
    el('p', {}, 'In the indexed formats a pixel is a color number. The video chip looks the number up in its palette: 256 colors of red, green and blue, 0–255 each. ',
      'The palette lives in the chip, not in RAM. At the start it holds the palette named in .display, or else the first predefined one of the right size (below); choosing a palette in the screen bar loads it, too.'),
    el('p', {}, 'A program sets its own colors with two ports: ', el('code', {}, 'OUT 0x13'), ' chooses a color number, then three ', el('code', {}, 'OUT 0x14'),
      ' give red, green and blue. After blue the chip moves on to the next color by itself, so a loop can write many colors in a row:'),
    code('LDI A, 1\nOUT 0x13, A      ; color 1 is …\nLDI A, 255\nOUT 0x14, A      ; … red 255,\nLDI A, 128\nOUT 0x14, A      ; green 128,\nLDI A, 0\nOUT 0x14, A      ; blue 0: orange'),
    el('p', {}, 'In C: ', el('code', {}, 'out(PALETTE, 1); out(COLOR, 255); out(COLOR, 128); out(COLOR, 0);'),
      '. Changing a color changes every pixel with that number at once, without touching RAM: that is color cycling (27-color-cycling.c). The device bar shows the color written last.'),
    el('h3', {}, 'Vsync and page flipping'),
    el('p', {}, 'At the start of every frame — 60 times per second of machine time — the screen takes its picture of RAM and the palette. ',
      el('code', {}, 'IN A, 0x04'), ' (in C: ', el('code', {}, 'in(VSYNC)'), ') waits for that moment; the CPU idles until then. ',
      'What the program changes right after it appears together in the next picture, never half done. The wait also paces a game at 60 steps per second at any clock.'),
    el('p', {}, 'For bigger changes, draw into a second screen page that is not shown, then wait for vsync and show it with ', el('code', {}, 'OUT 0x12'),
      ' (in C: ', el('code', {}, 'out(SCREEN_PAGE, address >> 8)'), '). While paused or stepping, the screen shows RAM as it is right now.'),
    el('h3', {}, 'Predefined palettes'),
    el('div', { class: 'palette-list' }, Object.entries(PALETTES).map(([key, colors]) => el('div', { class: 'palette-entry' },
      el('div', { class: 'palette-head' }, el('code', {}, key), el('span', { class: 'muted' },
        `${colors.length} colors${defaultPalette(colors.length) === key ? ' · the default' : ''}`)),
      swatches(colors)))),
    el('p', { class: 'muted' }, 'Hover a color to see its number and value. 1bit monitor glow, the CGA palettes, PICO-8, Sweetie 16 and VGA come from PixelRAM; fire 256 runs from black over red, orange and yellow to white.'));
}

export class Reference {
  constructor(ui) {
    this.ui = ui;
    this.pages = { ...Object.fromEntries(Object.values(ARCHITECTURES).map(arch => [arch.id, () => levelPage(arch)])), assembler: assemblerPage, c: cPage, devices: devicesPage, screen: screenPage, ascii: asciiPage };
    const labels = { cpu8: '8', cpu8s: '8S', cpu8x: '8X', devices: 'Devices', screen: 'Screen', assembler: 'Assembler', c: 'C', ascii: 'ASCII' };
    this.tabs = Object.keys(this.pages).map(key => el('button', {
      type: 'button', role: 'tab', 'aria-selected': 'false', dataset: { page: key }, onclick: () => this.show(key),
    }, key.startsWith('cpu') ? `MiniCPU ${labels[key]}` : labels[key]));
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
