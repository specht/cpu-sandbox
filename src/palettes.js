// The predefined palettes: the screen's palette chip starts with one of them.
// Most come from specht/pixelram/tools/palettes.yaml (commit 951d93a), in
// their original index order; programs can change every color themselves
// (ports 0x13 and 0x14, see devices.js).
const parse = str => str.trim().split(/\s+/).map(c => `#${c.toUpperCase()}`);
const hex2 = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

// black → dark red → orange → yellow → white, for heat values 0..255
const fire = Array.from({ length: 256 }, (_, i) => {
  const t = i / 255;
  return hex2(t * 3 * 255) + hex2((t - 0.33) * 2.6 * 255) + hex2((t - 0.72) * 3.6 * 255);
}).join(' ');

export const PALETTES = Object.freeze({
  '1bit_monitor_glow': parse('222323 f0f6f0'),
  'cga_palette_1_high': parse('000000 ff55ff 55ffff ffffff'),
  'color_graphics_adapter': parse('000000 555555 aaaaaa ffffff 0000aa 5555ff 00aa00 55ff55 00aaaa 55ffff aa0000 ff5555 aa00aa ff55ff aa5500 ffff55'),
  'pico_8': parse('000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa'),
  'sweetie_16': parse('1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179 29366f 3b5dc9 41a6f6 73eff7 f4f4f4 94b0c2 566c86 333c57'),
  // PixelRAM VGA has 256 entries; the first 16 correspond to VGA's basic colors.
  'vga': parse(`000000 0000aa 00aa00 00aaaa aa0000 aa00aa aa5500 aaaaaa 555555 5555ff 55ff55 55ffff ff5555 ff55ff ffff55 ffffff
    000000 141414 202020 2c2c2c 383838 454545 515151 616161 717171 828282 929292 a2a2a2 b6b6b6 cbcbcb e3e3e3 ffffff
    0000ff 4100ff 7d00ff be00ff ff00ff ff00be ff007d ff0041 ff0000 ff4100 ff7d00 ffbe00 ffff00 beff00 7dff00 41ff00 00ff00 00ff41 00ff7d 00ffbe 00ffff 00beff 007dff 0041ff
    7d7dff 9e7dff be7dff df7dff ff7dff ff7ddf ff7dbe ff7d9e ff7d7d ff9e7d ffbe7d ffdf7d ffff7d dfff7d beff7d 9eff7d 7dff7d 7dff9e 7dffbe 7dffdf 7dffff 7ddfff 7dbeff 7d9eff
    b6b6ff c7b6ff dbb6ff ebb6ff ffb6ff ffb6eb ffb6db ffb6c7 ffb6b6 ffc7b6 ffdbb6 ffebb6 ffffb6 ebffb6 dbffb6 c7ffb6 b6ffb6 b6ffc7 b6ffdb b6ffeb b6ffff b6ebff b6dbff b6c7ff
    000071 1c0071 380071 550071 710071 710055 710038 71001c 710000 711c00 713800 715500 717100 557100 387100 1c7100 007100 00711c 007138 007155 007171 005571 003871 001c71
    383871 453871 553871 613871 713871 713861 713855 713845 713838 714538 715538 716138 717138 617138 557138 457138 387138 387145 387155 387161 387171 386171 385571 384571
    515171 595171 615171 695171 715171 715169 715161 715159 715151 715951 716151 716951 717151 697151 617151 597151 517151 517159 517161 517169 517171 516971 516171 515971
    000041 100041 200041 300041 410041 410030 410020 410010 410000 411000 412000 413000 414100 304100 204100 104100 004100 004110 004120 004130 004141 003041 002041 001041
    202041 282041 302041 382041 412041 412038 412030 412028 412020 412820 413020 413820 414120 384120 304120 284120 204120 204128 204130 204138 204141 203841 203041 202841
    2c2c41 302c41 342c41 3c2c41 412c41 412c3c 412c34 412c30 412c2c 41302c 41342c 413c2c 41412c 3c412c 34412c 30412c 2c412c 2c4130 2c4134 2c413c 2c4141 2c3c41 2c3441 2c3041
    000000 000000 000000 000000 000000 000000 000000 000000`.replace(/\s+/g, ' ').trim()),
  // CPU Sandbox: heat 0..255 from black over red, orange and yellow to white.
  'fire_256': parse(fire),
});

/** The palette a screen format starts with when .display names none: the first one that fits. */
export function defaultPalette(colors) {
  return Object.keys(PALETTES).find(key => PALETTES[key].length === colors) ?? null;
}

/** A palette as bytes: red, green, blue for every color. */
export function paletteBytes(name) {
  const colors = PALETTES[name] ?? [];
  const bytes = new Uint8Array(colors.length * 3);
  colors.forEach((c, i) => { for (let k = 0; k < 3; k++) bytes[i * 3 + k] = parseInt(c.slice(1 + 2 * k, 3 + 2 * k), 16); });
  return bytes;
}
