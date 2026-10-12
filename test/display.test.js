import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../src/assembler.js';
import { DEFAULT_DISPLAY, MODES, validateDisplay, decodeScreen, pixelValue, pixelAddress } from '../src/display.js';
import { PALETTES, paletteBytes, defaultPalette } from '../src/palettes.js';

const config = (options = {}) => ({ ...DEFAULT_DISPLAY, ...options });
const values = (memory, c) => {
  const out = [];
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) out.push(pixelValue(memory, c, x, y));
  return out;
};
const rgba = (memory, c, i = 0) => Array.from(decodeScreen(memory, c, c.palette ? paletteBytes(c.palette) : null).slice(i * 4, i * 4 + 3));

test('packed pixels are read most-significant bits first', () => {
  const memory = new Uint8Array(256);
  memory[0x80] = 0b10110001;
  assert.deepEqual(values(memory, config({ width: 8, height: 1, mode: 'mono', palette: '1bit_monitor_glow' })), [1, 0, 1, 1, 0, 0, 0, 1]);
  memory[0x80] = 0x1B;
  assert.deepEqual(values(memory, config({ width: 4, height: 1, mode: 'indexed2', palette: 'cga_palette_1_high' })), [0, 1, 2, 3]);
  assert.deepEqual(values(memory, config({ width: 2, height: 1, mode: 'indexed4', palette: 'pico_8' })), [1, 11]);
});

test('every row starts on a new byte', () => {
  const c = config({ width: 3, height: 2, mode: 'indexed2', palette: 'cga_palette_1_high' });
  assert.equal(validateDisplay(c).rowBytes, 1);
  assert.equal(pixelAddress(c, 0, 1), 0x81);
  const memory = new Uint8Array(256);
  memory.set([0b01000000, 0b10000000], 0x80);
  assert.deepEqual(values(memory, c), [1, 0, 0, 2, 0, 0]);
});

test('palettes, grayscale, RGB332 and RGB24 decode to the expected colors', () => {
  const memory = new Uint8Array(256);
  memory.set([0b11100011, 255, 128, 0], 0x80);
  assert.deepEqual(rgba(memory, config({ width: 1, height: 1, mode: 'rgb332' })), [255, 0, 255]);
  assert.deepEqual(rgba(memory, config({ width: 1, height: 1, mode: 'rgb24', start: 0x81 })), [255, 128, 0]);
  assert.deepEqual(rgba(memory, config({ width: 1, height: 1, mode: 'gray8', start: 0x82 })), [128, 128, 128]);
  assert.deepEqual(rgba(memory, config({ width: 1, height: 1, mode: 'indexed8', palette: 'fire_256', start: 0x81 })), [255, 255, 255]);
});

test('a screen must fit into RAM', () => {
  assert.throws(() => validateDisplay(config({ start: 0xF0, width: 16, height: 2 })), /RAM ends/);
  assert.equal(validateDisplay(config({ start: 0xC0, width: 32, height: 16, mode: 'mono' })).bytesSpanned, 64);
  assert.equal(validateDisplay(config({ start: 0x400, width: 80, height: 60, mode: 'indexed4' }), 4096).bytesSpanned, 2400);
});

test('indexed formats need a palette with exactly 2^bits colors', () => {
  const memory = new Uint8Array(256);
  assert.throws(() => decodeScreen(memory, config({ mode: 'indexed4' }), paletteBytes('cga_palette_1_high')), /16 colors/);
  for (const [name, colors] of Object.entries(PALETTES)) {
    assert.ok(Object.values(MODES).some(m => m.indexed && 2 ** m.bits === colors.length), `${name} must be usable by a pixel format`);
    for (const c of colors) assert.match(c, /^#[0-9A-F]{6}$/, name);
  }
});

test('.display is only a suggestion: no bytes, checked at its source line', () => {
  const asm = assemble('BASE .equ 0x80\n.display BASE, 32, 8, mono, 1bit_monitor_glow\nLDI A, 5\nHLT');
  assert.equal(asm.loadedBytes, 4);
  assert.deepEqual(asm.display, { start: 0x80, width: 32, height: 8, mode: 'mono', palette: '1bit_monitor_glow' });
  for (const directive of [
    '.display 0xFF, 8, 2, mono, 1bit_monitor_glow',
    '.display 0x80, 16, 8, rgb24, pico_8',
    '.display 0x80, 16, 8, indexed4, nonexistent',
    '.display 0x80, 16, 8, indexed4, cga_palette_1_high',
    '.display 0x80, 16, 8, indexed6, pico_8',
  ]) assert.throws(() => assemble(`HLT\n${directive}`), e => e.name === 'AssemblyError' && e.line === 2, directive);
});

test('without a palette name, an indexed format starts with the standard palette of its size', () => {
  assert.equal(assemble('.display 0x80, 16, 8, indexed2\nHLT').display.palette, 'cga_palette_1_high');
  assert.equal(assemble('.cpu 8x\n.display 0x1000, 64, 48, indexed8\nHLT').display.palette, 'vga');
  assert.equal(defaultPalette(16), 'color_graphics_adapter');
});

test('a screen over the program itself is allowed, with a warning', () => {
  const asm = assemble('.display 0, 4, 1, gray8\nHLT');
  assert.equal(asm.warnings.length, 1);
});
