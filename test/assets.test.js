import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.mjs';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(base,'web/index.html'), 'utf8');
const css = fs.readFileSync(path.join(base,'web/style.css'), 'utf8');
const sprite = fs.readFileSync(path.join(base,'web/vendor/tabler-icons.svg'), 'utf8');

test('buttons use real bundled Tabler sprite IDs, not Unicode glyphs', () => {
  const names = [...page.matchAll(/\/vendor\/tabler-icons\.svg#(ti-[a-z-]+)/g)].map(x => x[1]);
  assert.ok(names.length >= 12);
  for (const id of names) assert.match(sprite, new RegExp(`id="${id}"`));
  for (const id of ['ti-player-pause','ti-player-play']) assert.match(sprite, new RegExp(`id="${id}"`));
  assert.doesNotMatch(page, /▶|↻|⏯|Ⅱ Pause|← Back|Step →/);
});
test('font styles use local files and preserve fallback families', () => {
  assert.match(css, /font-family:'Open Sans'/);
  assert.match(css, /font-family:'0xProto Nerd Font'/);
  assert.match(css, /\/vendor\/fonts\/OpenSans\.ttf/);
  assert.match(css, /\/vendor\/fonts\/0xProtoNerdFont\.ttf/);
  assert.doesNotMatch(page+css, /https:\/\/fonts\.|fonts\.googleapis|cdn\.jsdelivr/);
});
test('backend serves icon sprite with SVG mime type', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/vendor/tabler-icons.svg`);
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/image\/svg\+xml/);
  assert.match(await response.text(),/id="ti-cpu"/);
});

test('editor syntax overlay uses identical font metrics and no header logo', () => {
  assert.doesNotMatch(page, /class="logo"/);
  assert.doesNotMatch(page, /tabler-icons\.svg#ti-cpu/);
  assert.match(css, /#highlight-layer code,[\s\S]*?font-family:\s*'0xProto Nerd Font'/);
  assert.match(css, /#highlight-layer \.hl-mnemonic\s*\{\s*font-weight:\s*400/);
  assert.match(css, /font-variant-ligatures:\s*none/);
  const app = fs.readFileSync(path.join(base, 'web/app.js'), 'utf8');
  assert.match(app, /layer\.style\.left = .*line-numbers.*getBoundingClientRect\(\)\.width/);
});
