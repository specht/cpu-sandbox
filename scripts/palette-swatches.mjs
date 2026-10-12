// Draws every predefined palette as an SVG for docs/screen.md:
//   npm run docs
// Every color is a square of the same size, in rows of up to 32, like the
// Screen page of the Documentation dialog. test/assets.test.js checks that the files are current.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PALETTES } from '../src/palettes.js';

const CELL = 16;

export function paletteSvg(name) {
  const colors = PALETTES[name], columns = Math.min(colors.length, 32), cell = CELL;
  const rows = Math.ceil(colors.length / columns), width = columns * cell, height = rows * cell;
  const rects = colors.map((c, i) => `<rect x="${(i % columns) * cell}" y="${Math.floor(i / columns) * cell}" width="${cell}" height="${cell}" fill="${c}"><title>${i} = ${c}</title></rect>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${rects.join('\n')}\n</svg>\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = new URL('../docs/palettes/', import.meta.url);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of Object.keys(PALETTES)) fs.writeFileSync(new URL(`${name}.svg`, dir), paletteSvg(name));
  for (const file of fs.readdirSync(dir)) if (!PALETTES[file.replace(/\.svg$/, '')]) fs.rmSync(new URL(file, dir));
  console.log(`${Object.keys(PALETTES).length} palettes drawn in docs/palettes/`);
}
