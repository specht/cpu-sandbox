/** The screen is only a way of looking at RAM; it never adds memory or changes bytes. */
export const MODES = Object.freeze({
  mono: { bits: 1, indexed: true, label: '1 bit · 2 colors' },
  indexed2: { bits: 2, indexed: true, label: '2 bits · 4 colors' },
  indexed4: { bits: 4, indexed: true, label: '4 bits · 16 colors' },
  indexed8: { bits: 8, indexed: true, label: '8 bits · 256 colors' },
  gray8: { bits: 8, indexed: false, label: '8 bits · grayscale' },
  rgb332: { bits: 8, indexed: false, label: '8 bits · RGB 3-3-2' },
  rgb24: { bits: 24, indexed: false, label: '24 bits · RGB' },
});
export const DEFAULT_DISPLAY = Object.freeze({ start: 0x80, width: 16, height: 8, mode: 'gray8', palette: null });
export const MAX_SIDE = 256;

const assertInt = (n, lo, hi, label) => {
  if (!Number.isInteger(n) || n < lo || n > hi) throw new RangeError(`${label} must be ${lo}..${hi}`);
};
const hex = n => n.toString(16).toUpperCase();

/** Checks a screen mapping and adds its derived sizes. Rows always start on a new byte. */
export function validateDisplay(config, memorySize = 256) {
  const spec = MODES[config.mode];
  if (!spec) throw new RangeError(`Unknown pixel format: ${config.mode}`);
  assertInt(config.start, 0, memorySize - 1, 'Start address');
  assertInt(config.width, 1, MAX_SIDE, 'Width');
  assertInt(config.height, 1, MAX_SIDE, 'Height');
  const rowBytes = Math.ceil(config.width * spec.bits / 8);
  const end = config.start + config.height * rowBytes;
  if (end > memorySize) throw new RangeError(`The screen would end at 0x${hex(end - 1)}, but RAM ends at 0x${hex(memorySize - 1)}`);
  return { ...config, rowBytes, bytesSpanned: end - config.start, endExclusive: end, bits: spec.bits };
}

/** Address of the byte that holds pixel (x, y). */
export function pixelAddress(config, x, y) {
  const bits = MODES[config.mode].bits;
  return config.start + y * Math.ceil(config.width * bits / 8) + Math.floor(x * bits / 8);
}

function paletteRGB(colors) {
  return colors.map(c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
}
const rgbCache = new WeakMap();

/**
 * Decodes the screen into RGBA bytes (one entry per pixel, row by row).
 * Packed pixels are read most-significant bits first.
 */
export function decodeScreen(memory, config, palettes, target) {
  const c = validateDisplay(config, memory.length), spec = MODES[c.mode];
  let colors = null;
  if (spec.indexed) {
    const list = palettes[c.palette];
    if (!list || list.length !== 2 ** c.bits) throw new RangeError(`${c.mode} needs a palette with ${2 ** c.bits} colors`);
    colors = rgbCache.get(list) ?? paletteRGB(list);
    rgbCache.set(list, colors);
  }
  const out = target ?? new Uint8ClampedArray(c.width * c.height * 4);
  let o = 0;
  for (let y = 0; y < c.height; y++) {
    const row = c.start + y * c.rowBytes;
    for (let x = 0; x < c.width; x++, o += 4) {
      let r, g, b;
      if (c.bits === 24) {
        const a = row + x * 3; r = memory[a]; g = memory[a + 1]; b = memory[a + 2];
      } else {
        const bit = x * c.bits, v = memory[row + (bit >> 3)];
        const index = c.bits === 8 ? v : (v >> (8 - c.bits - (bit & 7))) & ((1 << c.bits) - 1);
        if (colors) [r, g, b] = colors[index];
        else if (c.mode === 'gray8') r = g = b = index;
        else { r = Math.round((index >> 5) * 255 / 7); g = Math.round(((index >> 2) & 7) * 255 / 7); b = Math.round((index & 3) * 255 / 3); }
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  return out;
}

/** Pixel value (palette index, gray level, RGB332 byte or 24-bit color) at (x, y). */
export function pixelValue(memory, config, x, y) {
  const bits = MODES[config.mode].bits, addr = pixelAddress(config, x, y);
  if (bits === 24) return (memory[addr] << 16) | (memory[addr + 1] << 8) | memory[addr + 2];
  const v = memory[addr];
  return bits === 8 ? v : (v >> (8 - bits - ((x * bits) & 7))) & ((1 << bits) - 1);
}
