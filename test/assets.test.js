import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8');
const page = read('web/index.html'), css = read('web/style.css'), sprite = read('web/vendor/tabler-icons.svg');
const scripts = fs.readdirSync(path.join(base, 'web/js')).map(f => read(`web/js/${f}`)).join('\n');

test('every icon used by the page and its scripts exists in the bundled sprite', () => {
  const used = new Set([
    ...[...page.matchAll(/tabler-icons\.svg#(ti-[a-z0-9-]+)/g)].map(m => m[1]),
    ...[...scripts.matchAll(/icon\('([a-z0-9-]+)'/g)].map(m => `ti-${m[1]}`),
    ...[...scripts.matchAll(/icon\([^()]*\? '([a-z0-9-]+)' : '([a-z0-9-]+)'/g)].flatMap(m => [`ti-${m[1]}`, `ti-${m[2]}`]),
    'ti-edit', 'ti-book', // the source chip
  ]);
  assert.ok(used.size >= 10);
  for (const id of used) assert.match(sprite, new RegExp(`id="${id}"`), id);
});

test('fonts, icons and the editor are local; nothing comes from a CDN', () => {
  assert.match(css, /\/vendor\/fonts\/OpenSans\.ttf/);
  assert.match(css, /\/vendor\/fonts\/0xProtoNerdFont\.ttf/);
  assert.match(page, /\/vendor\/codemirror\.js/);
  assert.doesNotMatch(page + css + scripts, /https?:\/\/(?!127\.0\.0\.1|www\.w3\.org)[a-z]/i);
});

test('the top bar shows only the name, like the other sandboxes', () => {
  const brand = page.match(/<div class="brand">([\s\S]*?)<\/div>/)[1];
  assert.equal(brand.trim(), '<strong>CPU SANDBOX</strong>');
});

test('docs/cpu-levels.md lists every instruction with its opcode, size and cycles', async () => {
  const { INSTRUCTIONS, sizeOf, cycleLabel } = await import('../src/opcodes.js');
  const { ARCHITECTURES } = await import('../src/architectures.js');
  const doc = read('docs/cpu-levels.md');
  for (const i of INSTRUCTIONS) {
    const code = i.code.toString(16).toUpperCase().padStart(2, '0');
    const row = doc.split('\n').find(line => line.startsWith(`| \`${code}\` | \`${i.syntax}\``));
    assert.ok(row, `${i.syntax} is missing (regenerate the table)`);
    assert.ok(row.includes(`${sizeOf(i, ARCHITECTURES.cpu8x)} | `) && row.includes(`· ${cycleLabel(i, ARCHITECTURES.cpu8x)} |`), `${i.syntax} is out of date`);
  }
});
