#!/usr/bin/env node
/** Local, dependency-free backend. Student work is always stored on disk. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { TASKS, taskOf, checkSource } from './src/tasks.js';

const base = path.dirname(fileURLToPath(import.meta.url));
const isName = name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name);
const isProgram = name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.(asm|c)$/i.test(name) && !name.startsWith('.');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_SOURCE = 64 * 1024;
const json = (res, status, object) => send(res, status, JSON.stringify(object), 'application/json; charset=utf-8');
function send(res, status, data, type) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'", 'Referrer-Policy': 'no-referrer' });
  res.end(data);
}
function safeDirectory(p) { return fs.existsSync(p) && fs.lstatSync(p).isDirectory() && !fs.lstatSync(p).isSymbolicLink(); }
function listAsm(p) { return fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isFile() && !d.isSymbolicLink() && isProgram(d.name)).map(d => d.name).sort((a,b) => a.localeCompare(b,undefined,{numeric:true})); }
function fileInFolder(folder, filename) {
  if (!safeDirectory(folder) || !isProgram(filename)) throw new ApiError(400, 'Invalid or unavailable program directory/name');
  const file = path.join(folder, filename);
  if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) throw new ApiError(403, 'Non-regular files and symbolic links are not allowed');
  return file;
}
// Local settings of this installation (the theme) live in .settings.yaml next to
// the app, outside Git and outside the class repository. Only simple
// "key: value" lines are read; other lines are kept as they are.
const THEMES = new Set(['dark', 'light']);
export function readSettings(file) {
  const settings = { theme: 'dark' };
  if (!fs.existsSync(file)) return settings;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*theme\s*:\s*["']?(\w+)["']?\s*(?:#.*)?$/);
    if (m && THEMES.has(m[1])) settings.theme = m[1];
  }
  return settings;
}
export function writeSettings(file, changes) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\n$/, '').split('\n') : ['# Local settings of this sandbox. Not part of Git.'];
  for (const [key, value] of Object.entries(changes)) {
    const at = lines.findIndex(line => new RegExp(`^\\s*${key}\\s*:`).test(line));
    if (at < 0) lines.push(`${key}: ${value}`); else lines[at] = `${key}: ${value}`;
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function bodyJson(req) {
  const chunks = []; let n = 0;
  for await (const chunk of req) {
    n += chunk.length;
    if (n > MAX_SOURCE + 4096) throw new ApiError(413, 'Source is too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'Invalid JSON'); }
}
export function createServer({ programsDir = path.join(base, 'programs'), examplesDir = path.join(base, 'examples'), settingsFile = path.join(base, '.settings.yaml') } = {}) {
  const programRoot = path.resolve(programsDir);
  const exampleRoot = path.resolve(examplesDir);
  function location(group, filename, write = false) {
    if (group === '@examples') {
      if (write) throw new ApiError(403, 'Examples are read-only');
      return fileInFolder(exampleRoot, filename);
    }
    if (!isName(group)) throw new ApiError(400, 'Invalid student directory');
    if (!safeDirectory(programRoot)) throw new ApiError(404, 'No student repository found. Clone or create programs/ first.');
    return fileInFolder(path.join(programRoot, group), filename);
  }
  // Static files: the page, its modules, the shared CPU code and vendored assets.
  const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.jpg': 'image/jpeg',
  };
  const STATIC = [['/src/', 'src'], ['/js/', 'web/js'], ['/vendor/fonts/', 'web/vendor/fonts'], ['/vendor/', 'web/vendor'], ['/', 'web']];
  function staticFile(route) {
    if (route === '/') route = '/index.html';
    for (const [prefix, dir] of STATIC) {
      if (!route.startsWith(prefix)) continue;
      const name = route.slice(prefix.length);
      if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(name) || !TYPES[path.extname(name)]) return null;
      const file = path.join(base, dir, name);
      return fs.existsSync(file) && fs.statSync(file).isFile() ? [file, TYPES[path.extname(name)]] : null;
    }
    return null;
  }
  // The CPU level a program asks for: .cpu in assembly, #pragma cpu in MiniC (default 8X).
  const cpuOf = (text, name) => (/\.c$/i.test(name)
    ? text.match(/^[ \t]*#[ \t]*pragma[ \t]+cpu[ \t]+(8s|8x|8)\b/im)?.[1] ?? '8x'
    : text.match(/^[ \t]*\.cpu[ \t]+(8s|8x|8)\b/im)?.[1] ?? '8').toLowerCase();
  const describe = folder => listAsm(folder).map(name => {
    const bytes = fs.readFileSync(path.join(folder, name));
    return { name, cpu: cpuOf(bytes.toString('utf8'), name), revision: digest(bytes) };
  });
  // Class progress: every student program that names a task is checked; results
  // are kept per file content, so only changed files run again.
  const checked = new Map();   // digest → result
  function progress() {
    const students = [];
    if (!safeDirectory(programRoot)) return { tasks: TASKS.map(t => ({ id: t.id, title: t.title, cpu: t.cpu })), students };
    for (const e of fs.readdirSync(programRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || e.isSymbolicLink() || !isName(e.name)) continue;
      const folder = path.join(programRoot, e.name), cells = {};
      for (const file of listAsm(folder)) {
        const bytes = fs.readFileSync(path.join(folder, file));
        if (bytes.length > MAX_SOURCE) continue;
        const text = bytes.toString('utf8'), id = taskOf(text);
        if (!id) continue;
        const key = digest(bytes) + file.slice(-2);
        if (!checked.has(key)) checked.set(key, checkSource(text, /\.c$/i.test(file) ? 'c' : 'asm'));
        const result = checked.get(key);
        if (!result) continue;
        const cell = { file, passed: result.passed, total: result.total, bytes: result.bytes, cycles: result.cycles, error: result.error };
        // The best attempt per task: most cases passed, then fewest cycles.
        const best = cells[id];
        if (!best || cell.passed > best.passed || (cell.passed === best.passed && cell.cycles < best.cycles)) cells[id] = { ...cell, attempts: (best?.attempts ?? 0) + 1 };
        else best.attempts++;
      }
      students.push({ id: e.name, cells });
    }
    return { tasks: TASKS.map(t => ({ id: t.id, title: t.title, cpu: t.cpu })), students };
  }
  return http.createServer(async (req, res) => {
    try {
      // Only same-origin calls are accepted for writes. The server listens on loopback by default.
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`) throw new ApiError(403, 'Cross-origin writes are not allowed');
        if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new ApiError(415, 'Expected application/json');
      }
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname;
      if (route === '/api/catalog' && req.method === 'GET') {
        const groups = [];
        if (safeDirectory(exampleRoot)) groups.push({ id: '@examples', label: 'Examples', readonly: true, files: describe(exampleRoot) });
        const programsExists = safeDirectory(programRoot);
        if (programsExists) {
          for (const e of fs.readdirSync(programRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (e.isDirectory() && !e.isSymbolicLink() && isName(e.name)) groups.push({ id: e.name, label: e.name, readonly: false, files: describe(path.join(programRoot, e.name)) });
          }
        }
        return json(res, 200, { groups, programsExists });
      }
      if (route === '/api/source' && (req.method === 'GET' || req.method === 'PUT')) {
        const group = url.searchParams.get('group'), file = url.searchParams.get('file');
        const full = location(group, file, req.method === 'PUT');
        if (req.method === 'GET') {
          if (!fs.existsSync(full)) throw new ApiError(404, 'Source not found');
          const bytes = fs.readFileSync(full);
          if (bytes.length > MAX_SOURCE) throw new ApiError(413, 'Source is too large');
          return json(res, 200, { group, file, source: bytes.toString('utf8'), revision: digest(bytes), readonly: group === '@examples' });
        }
        const input = await bodyJson(req);
        if (typeof input.source !== 'string' || Buffer.byteLength(input.source) > MAX_SOURCE) throw new ApiError(413, 'Source must be UTF-8 text of at most 64 KiB');
        if (typeof input.revision !== 'string') throw new ApiError(400, 'Expected revision');
        if (!fs.existsSync(full)) throw new ApiError(404, 'Source not found');
        const current = fs.readFileSync(full);
        if (digest(current) !== input.revision) throw new ApiError(409, 'The file changed on disk');
        // Single local Node process serializes this synchronous check + write.
        fs.writeFileSync(full, input.source, { flag: 'w' });
        return json(res, 200, { revision: digest(Buffer.from(input.source)), saved: true });
      }
      if (route === '/api/programs' && req.method === 'POST') {
        const input = await bodyJson(req);
        if (input.group === '@examples') throw new ApiError(403, 'Examples are read-only');
        if (!isName(input.group)) throw new ApiError(400, 'A folder name may contain letters, digits, - and _');
        if (!isProgram(input.file)) throw new ApiError(400, 'A file name may contain letters, digits, ., - and _ and must end in .asm or .c');
        if (!safeDirectory(programRoot)) throw new ApiError(404, 'There is no programs/ folder yet. Clone the class repository into programs/ first.');
        const folder = path.join(programRoot, input.group);
        if (!fs.existsSync(folder)) fs.mkdirSync(folder);
        const full = location(input.group, input.file, true);
        const source = typeof input.source === 'string' ? input.source : 'HLT\n';
        if (Buffer.byteLength(source) > MAX_SOURCE) throw new ApiError(413, 'Source is too large');
        try { fs.writeFileSync(full, source, { flag: 'wx' }); }
        catch (e) { if (e.code === 'EEXIST') throw new ApiError(409, `${input.group}/${input.file} already exists`); throw e; }
        return json(res, 201, { group: input.group, file: input.file, revision: digest(Buffer.from(source)) });
      }
      if (route === '/api/progress' && req.method === 'GET') return json(res, 200, progress());
      if (route === '/api/settings' && req.method === 'GET') return json(res, 200, readSettings(settingsFile));
      if (route === '/api/settings' && req.method === 'PUT') {
        const input = await bodyJson(req);
        if (!THEMES.has(input.theme)) throw new ApiError(400, 'theme must be dark or light');
        writeSettings(settingsFile, { theme: input.theme });
        return json(res, 200, readSettings(settingsFile));
      }
      const asset = req.method === 'GET' && staticFile(route);
      if (asset && asset[0].endsWith('index.html')) {
        // The theme is part of the page, so it never flashes dark first.
        const page = fs.readFileSync(asset[0], 'utf8').replace('<html lang="en">', `<html lang="en" data-theme="${readSettings(settingsFile).theme}">`);
        return send(res, 200, page, asset[1]);
      }
      if (asset) return send(res, 200, fs.readFileSync(asset[0]), asset[1]);
      throw new ApiError(404, 'Not found');
    } catch (e) {
      if (e instanceof ApiError) return json(res, e.status, { error: e.message });
      console.error(e);
      return json(res, 500, { error: 'Internal server error' });
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const arg = (k, fallback) => { const i = args.indexOf(k); return i < 0 ? fallback : args[i + 1]; };
  if (args.includes('--help')) {
    console.log('Usage: node server.mjs [--port 8765] [--host 127.0.0.1] [--programs DIR]');
    process.exit(0);
  }
  const host = arg('--host', '127.0.0.1');
  const port = Number(arg('--port', '8765'));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be 0..65535');
  const programsDir = arg('--programs', path.join(base, 'programs'));
  createServer({ programsDir }).listen(port, host, function () {
    console.log(`CPU Sandbox: http://${host}:${this.address().port}`);
    console.log(`Student files: ${path.resolve(programsDir)}`);
    if (host !== '127.0.0.1' && host !== 'localhost') console.warn('WARNING: No authentication. Do not expose this server to untrusted networks.');
  });
}
