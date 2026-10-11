/** A display controller is ONLY a view of RAM, never additional CPU memory. */
export const MODES = Object.freeze({
  mono: { bits: 1, indexed: true, label: '1-bit indexed' },
  indexed2: { bits: 2, indexed: true, label: '2-bit indexed' },
  indexed4: { bits: 4, indexed: true, label: '4-bit indexed' },
  indexed8: { bits: 8, indexed: true, label: '8-bit indexed' },
  gray8: { bits: 8, indexed: false, label: '8-bit grayscale' },
  rgb332: { bits: 8, indexed: false, label: 'RGB332 (8-bit)' },
  rgb24: { bits: 24, indexed: false, label: 'RGB888 (24-bit)' },
});
export const DEFAULT_DISPLAY = Object.freeze({ start: 0x80, width: 16, height: 8, mode: 'gray8', palette: null });
const assertInt = (n, lo, hi, label) => {
  if (!Number.isInteger(n) || n < lo || n > hi) throw new RangeError(`${label} must be ${lo}..${hi}`);
};
export function validateDisplay(config) {
  if (!MODES[config.mode]) throw new RangeError(`Unknown pixel format: ${config.mode}`);
  const bits = MODES[config.mode].bits;
  assertInt(config.start, 0, 255, 'Starting address');
  assertInt(config.width, 1, 256, 'Width');
  assertInt(config.height, 1, 256, 'Height');
  // Each row starts at the next byte; incomplete final bytes are padding.
  const rowBytes = Math.ceil(config.width * bits / 8);
  const end = config.start + config.height * rowBytes;
  if (end > 256) throw new RangeError(`Display ends at 0x${(end - 1).toString(16).toUpperCase()}; RAM ends at 0xFF`);
  return { ...config, rowBytes, bytesSpanned: end - config.start, endExclusive: end, bits };
}
const byteHex = n => n.toString(16).toUpperCase().padStart(2, '0');
export function renderDisplay(memory, config, palettes) {
  const c = validateDisplay(config), result = [], colors = palettes[c.palette];
  if (MODES[c.mode].indexed && (!colors || colors.length !== 2 ** c.bits))
    throw new RangeError(`Palette for ${c.bits}-bit indexed color must have exactly ${2 ** c.bits} entries`);
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const offset = x * c.bits, address = c.start + y * c.rowBytes + Math.floor(offset / 8);
    let index, color;
    if (c.mode === 'rgb24') {
      const rgb = [memory[address], memory[address + 1], memory[address + 2]];
      color = `#${rgb.map(byteHex).join('')}`;
    } else {
      const v = memory[address];
      index = c.bits < 8 ? (v >>> (8 - c.bits - (offset % 8))) & ((1 << c.bits) - 1) : v;
      if (MODES[c.mode].indexed) color = colors[index] ?? '#FF00FF'; // visible invalid palette index
      else if (c.mode === 'gray8') color = `#${byteHex(index).repeat(3)}`;
      else color = `#${byteHex(Math.round(((index >>> 5) & 7) * 255 / 7))}${byteHex(Math.round(((index >>> 2) & 7) * 255 / 7))}${byteHex(Math.round((index & 3) * 255 / 3))}`;
    }
    result.push({ x, y, address, index, color });
  }
  return result;
}
