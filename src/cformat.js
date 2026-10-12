/**
 * Formats MiniC in the style of the examples: four spaces per level of
 * braces, one more for the single statement of an if, for, while or else
 * without braces, and preprocessor lines at column 0. Lines that continue an
 * open parenthesis keep their alignment (they move with the line that opened
 * it). Comments, strings and the spacing inside a line are kept; trailing
 * spaces go. Every line stays on its line, so the result can be applied line
 * by line (breakpoints and undo survive).
 */
const UNIT = '    ';
const HEADER = /^(?:\}\s*)?(?:(?:else\s+)?if|for|while)\b.*\)$|^(?:\}\s*)?else$|^do$/;

/** The code of a line without strings, characters and comments; tracks block comments. */
function codeOf(line, state) {
  let out = '', i = 0;
  while (i < line.length) {
    if (state.comment) {
      const end = line.indexOf('*/', i);
      if (end < 0) return out;
      state.comment = false;
      i = end + 2;
      continue;
    }
    const c = line[i];
    if (c === '/' && line[i + 1] === '/') break;
    if (c === '/' && line[i + 1] === '*') { state.comment = true; i += 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === '\\' ? 2 : 1;
      out += c + c;
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function formatC(text) {
  const state = { comment: false };
  const open = [];               // the level of each line that opened a brace that is still open
  let parens = 0, delta = 0, pending = 0, continued = false;
  return text.split('\n').map(raw => {
    const line = raw.replace(/\s+$/, '');
    const indent = line.match(/^\s*/)[0].replace(/\t/g, UNIT).length;
    const trimmed = line.trim();
    const inComment = state.comment;
    const code = codeOf(line, state).trim();
    if (!trimmed) return '';
    if (inComment) return line;                          // inside /* … */: as written
    if (parens > 0 || continued) {
      // A continuation (inside parentheses, or of an expression): it moves
      // with the line it continues, so its alignment is kept.
      for (const c of code) parens = Math.max(0, parens + (c === '(' ? 1 : c === ')' ? -1 : 0));
      if (parens === 0 && /[;{}]$/.test(code)) { continued = false; pending = 0; }
      return ' '.repeat(Math.max(0, indent + delta)) + trimmed;
    }
    if (trimmed.startsWith('#')) return trimmed;
    const base = open.length ? open.at(-1) + 1 : 0;
    let level;
    if (code.startsWith('}')) level = open.length ? open.pop() : 0;
    else if (code.startsWith('{')) level = base + Math.max(0, pending - 1);   // a brace on its own line belongs to the line above
    else level = base + pending;
    delta = level * UNIT.length - indent;
    [...code].forEach((c, i) => {
      if (c === '{') open.push(level);
      else if (c === '}' && !(i === 0 && code.startsWith('}'))) open.pop();
      else if (c === '(') parens++;
      else if (c === ')') parens = Math.max(0, parens - 1);
    });
    // An if, for, while or else without braces indents the next statement.
    if (code && parens === 0) {
      if (HEADER.test(code)) pending++;
      else pending = 0;
      continued = !HEADER.test(code) && !/[;{},]$/.test(code) && open.length > 0;
    }
    return UNIT.repeat(level) + trimmed;
  }).join('\n');
}

/**
 * For the editor: the indentation of `line` below the text `before`, by the
 * same rules (Enter starts a new line with lineIndent(before, '')).
 */
export function lineIndent(before, line = '') {
  const formatted = formatC(`${before}\n${line.trim() || 'x'}`).split('\n').at(-1);
  return formatted.match(/^\s*/)[0].length;
}
