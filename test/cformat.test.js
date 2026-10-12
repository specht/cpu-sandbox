import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatC, lineIndent } from '../src/cformat.js';

test('the C examples are already formatted, and formatting twice changes nothing', () => {
  const dir = new URL('../examples/', import.meta.url);
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.c'))) {
    const source = fs.readFileSync(new URL(file, dir), 'utf8');
    assert.equal(formatC(source), source, file);
  }
});

test('formatting indents blocks, single statements and closing braces, and keeps every line', () => {
  const messy = 'int f(int a) {\nif (a > 1) {\nreturn a; // big\n} else\nreturn 0;\n}\n  #define N 3\nvoid main()\n{\nfor (char i = 0; i < N; i++)\nif (i)\nout(NUMBER, i);\nint x = f(3)\n        + 4;\nchar *s = "{ not a brace";\n}   ';
  const out = formatC(messy);
  assert.equal(out, 'int f(int a) {\n    if (a > 1) {\n        return a; // big\n    } else\n        return 0;\n}\n#define N 3\nvoid main()\n{\n    for (char i = 0; i < N; i++)\n        if (i)\n            out(NUMBER, i);\n    int x = f(3)\n            + 4;\n    char *s = "{ not a brace";\n}');
  assert.equal(out.split('\n').length, messy.split('\n').length);
  assert.equal(formatC(out), out);
});

test('the editor indents a new line like the formatter', () => {
  assert.equal(lineIndent('void main() {'), 4);
  assert.equal(lineIndent('void main() {\n    if (x)'), 8);
  assert.equal(lineIndent('void main() {\n    if (x)\n        y++;'), 4);
  assert.equal(lineIndent('void main() {\n    while (1) {\n        a++;', '}'), 4);
});
