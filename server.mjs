#!/usr/bin/env node
/** Local, dependency-free backend. Student work is always stored on disk. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const base = path.dirname(fileURLToPath(import.meta.url));
const isName = name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name);
const isProgram = name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.asm$/i.test(name) && !name.startsWith('.');
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
export function createServer({ programsDir = path.join(base, 'programs'), examplesDir = path.join(base, 'examples') } = {}) {
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
  const files = new Map([
    ['/', ['web/index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['web/app.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['web/style.css', 'text/css; charset=utf-8']],
    ['/assembler.js', ['src/assembler.js', 'text/javascript; charset=utf-8']],
    ['/cpu.js', ['src/cpu.js', 'text/javascript; charset=utf-8']],
    ['/display.js', ['src/display.js', 'text/javascript; charset=utf-8']],
    ['/palettes.js', ['src/palettes.js', 'text/javascript; charset=utf-8']],
    ['/vendor/tabler-icons.svg', ['web/vendor/tabler-icons.svg', 'image/svg+xml']],
    ['/vendor/fonts/OpenSans.ttf', ['web/vendor/fonts/OpenSans.ttf', 'font/ttf']],
    ['/vendor/fonts/0xProtoNerdFont.ttf', ['web/vendor/fonts/0xProtoNerdFont.ttf', 'font/ttf']],
  ]);
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
        if (safeDirectory(exampleRoot)) groups.push({ id: '@examples', label: 'Examples', readonly: true, files: listAsm(exampleRoot) });
        if (safeDirectory(programRoot)) {
          for (const e of fs.readdirSync(programRoot, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
            if (e.isDirectory() && !e.isSymbolicLink() && isName(e.name)) groups.push({ id: e.name, label: e.name, readonly: false, files: listAsm(path.join(programRoot, e.name)) });
          }
        }
        return json(res, 200, { groups, workspace: 'programs/', tip: 'Clone the class repository into programs/; each student has their own directory.' });
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
        if (digest(current) !== input.revision) throw new ApiError(409, 'The file changed on disk. Reload and compare before saving.');
        // Single local Node process serializes this synchronous check + write.
        fs.writeFileSync(full, input.source, { flag: 'w' });
        return json(res, 200, { revision: digest(Buffer.from(input.source)), saved: true });
      }
      if (route === '/api/programs' && req.method === 'POST') {
        const input = await bodyJson(req);
        const full = location(input.group, input.file, true);
        const source = typeof input.source === 'string' ? input.source : '; New assembly program\nHLT\n';
        if (Buffer.byteLength(source) > MAX_SOURCE) throw new ApiError(413, 'Source is too large');
        try { fs.writeFileSync(full, source, { flag: 'wx' }); }
        catch (e) { if (e.code === 'EEXIST') throw new ApiError(409, 'Program already exists'); throw e; }
        return json(res, 201, { group: input.group, file: input.file, revision: digest(Buffer.from(source)) });
      }
      if (req.method === 'GET' && files.has(route)) {
        const [relative, type] = files.get(route);
        const filePath = path.join(base, relative);
        if (!fs.existsSync(filePath)) throw new ApiError(404, 'Bundled asset not installed');
        return send(res, 200, fs.readFileSync(filePath), type);
      }
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
