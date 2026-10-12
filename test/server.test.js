import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'cpu-sandbox-test-'));
  const programs=path.join(root,'programs'), examples=path.join(root,'examples');
  fs.mkdirSync(programs); fs.mkdirSync(examples);
  fs.mkdirSync(path.join(programs,'anna'));
  fs.mkdirSync(path.join(programs,'ben'));
  fs.writeFileSync(path.join(programs,'anna','sum.asm'),'LDI A, 1\nHLT\n');
  fs.writeFileSync(path.join(examples,'demo.asm'),'HLT\n');
  fs.writeFileSync(path.join(programs,'ben','note.txt'),'not shown');
  const server=createServer({ programsDir:programs, examplesDir:examples, settingsFile:path.join(root,'.settings.yaml') });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(route,options={})=>{ const response=await fetch(base+route,options);let payload; try{payload=await response.json();}catch{payload=null;}return{response,payload}; };
  const write=(method,route,data)=>request(route,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  return{root,programs,examples,base,request,write};
}
test('catalog lists real student folders and only .asm files (no browser state)',async t=>{
  const {request}=await fixture(t), {payload}=await request('/api/catalog');
  assert.deepEqual(payload.groups.map(g=>g.id),['@examples','anna','ben']);
  assert.deepEqual(payload.groups[1].files.map(f=>f.name),['sum.asm']);
  assert.equal(payload.groups[1].files[0].cpu,'8');
  assert.match(payload.groups[1].files[0].revision,/^[0-9a-f]{64}$/);
  assert.deepEqual(payload.groups[2].files,[]);
  assert.equal(payload.programsExists,true);
});
test('disk backed source can be fetched and saved with revision',async t=>{
  const {request,write,programs}=await fixture(t);
  const route='/api/source?group=anna&file=sum.asm';
  const before=(await request(route)).payload;
  assert.equal(before.source,'LDI A, 1\nHLT\n');
  const updated=await write('PUT',route,{source:'LDI A, 5\nHLT\n',revision:before.revision});
  assert.equal(updated.response.status,200);
  assert.equal(fs.readFileSync(path.join(programs,'anna','sum.asm'),'utf8'),'LDI A, 5\nHLT\n');
  assert.notEqual(updated.payload.revision,before.revision);
});
test('concurrent external Git/editor modifications cause conflict, never silent clobber',async t=>{
  const {request,write,programs}=await fixture(t),route='/api/source?group=anna&file=sum.asm';
  const source=(await request(route)).payload;
  fs.writeFileSync(path.join(programs,'anna','sum.asm'),'HLT\n');
  const reply=await write('PUT',route,{source:'NOP\n',revision:source.revision});
  assert.equal(reply.response.status,409);
  assert.equal(fs.readFileSync(path.join(programs,'anna','sum.asm'),'utf8'),'HLT\n');
});
test('examples cannot be modified and new sources cannot overwrite existing files',async t=>{
  const {request,write}=await fixture(t);
  const src=(await request('/api/source?group=@examples&file=demo.asm')).payload;
  assert.equal(src.readonly,true);
  assert.equal((await write('PUT','/api/source?group=@examples&file=demo.asm',{revision:src.revision,source:'NOP'})).response.status,403);
  assert.equal((await write('POST','/api/programs',{group:'anna',file:'sum.asm',source:'HLT'})).response.status,409);
  const created=await write('POST','/api/programs',{group:'ben',file:'new.asm',source:'.cpu 8x\nHLT'});
  assert.equal(created.response.status,201);
  const ben=(await request('/api/catalog')).payload.groups.find(g=>g.id==='ben');
  assert.deepEqual(ben.files.map(f=>[f.name,f.cpu]),[['new.asm','8x']]);
  assert.equal((await write('POST','/api/programs',{group:'@examples',file:'x.asm',source:'HLT'})).response.status,403);
});
test('path traversal and symlink escape are rejected',async t=>{
  const {root,programs,request,write}=await fixture(t);
  fs.symlinkSync(root,path.join(programs,'link'));
  fs.symlinkSync(path.join(root,'programs','anna','sum.asm'),path.join(programs,'ben','escape.asm'));
  for(const route of ['/api/source?group=..&file=sum.asm','/api/source?group=link&file=sum.asm','/api/source?group=ben&file=escape.asm','/api/source?group=anna&file=../sum.asm']) {
    const resp=await request(route);
    assert.ok(resp.response.status>=400,route);
  }
  assert.equal((await write('POST','/api/programs',{group:'..',file:'new.asm',source:'HLT'})).response.status,400);
});
test('reject large source and cross-origin writes',async t=>{
  const {request,write}=await fixture(t),src=(await request('/api/source?group=anna&file=sum.asm')).payload;
  assert.equal((await write('PUT','/api/source?group=anna&file=sum.asm',{revision:src.revision,source:'a'.repeat(65537)})).response.status,413);
  const bad=await request('/api/source?group=anna&file=sum.asm',{method:'PUT',headers:{Origin:'http://evil.example','Content-Type':'application/json'},body:JSON.stringify({revision:src.revision,source:'NOP'})});
  assert.equal(bad.response.status,403);
});
test('a copy can start a new student folder inside programs/',async t=>{
  const {write,programs}=await fixture(t);
  const created=await write('POST','/api/programs',{group:'clara',file:'fire.asm',source:'HLT\n'});
  assert.equal(created.response.status,201);
  assert.equal(fs.readFileSync(path.join(programs,'clara','fire.asm'),'utf8'),'HLT\n');
  assert.equal((await write('POST','/api/programs',{group:'clara',file:'../x.asm',source:'HLT'})).response.status,400);
});
test('the page, its modules, the shared CPU code and vendored assets are served',async t=>{
  const {base}=await fixture(t);
  for(const [uri,type] of [['/','text/html'],['/style.css','text/css'],['/js/app.js','text/javascript'],['/src/cpu.js','text/javascript'],
    ['/src/opcodes.js','text/javascript'],['/vendor/codemirror.js','text/javascript'],['/vendor/tabler-icons.svg','image/svg+xml'],
    ['/vendor/fonts/OpenSans.ttf','font/ttf'],['/background.jpg','image/jpeg']]) {
    const res=await fetch(base+uri);
    assert.equal(res.status,200,uri);
    assert.ok(res.headers.get('content-type').startsWith(type),uri);
  }
  for(const uri of ['/server.mjs','/src/../server.mjs','/vendor/LICENSE','/test/cpu.test.js']) {
    assert.equal((await fetch(base+uri)).status,404,uri);
  }
});

test('the theme is a local setting in .settings.yaml and is written into the page',async t=>{
  const {request,write,root,base}=await fixture(t), file=path.join(root,'.settings.yaml');
  assert.deepEqual((await request('/api/settings')).payload,{theme:'dark'});
  assert.match(await (await fetch(base+'/')).text(),/<html lang="en" data-theme="dark">/);
  assert.equal((await write('PUT','/api/settings',{theme:'light'})).response.status,200);
  assert.match(fs.readFileSync(file,'utf8'),/^theme: light$/m);
  assert.match(await (await fetch(base+'/')).text(),/data-theme="light"/);
  fs.writeFileSync(file,'# mine\ntheme: light\nother: 1\n');
  await write('PUT','/api/settings',{theme:'dark'});
  assert.equal(fs.readFileSync(file,'utf8'),'# mine\ntheme: dark\nother: 1\n','other lines stay');
  assert.equal((await write('PUT','/api/settings',{theme:'pink'})).response.status,400);
  assert.match(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname),'..','.gitignore'),'utf8'),/^\.settings\.yaml$/m);
});

test('C programs are programs too: .c files are listed with the level from #pragma cpu',async t=>{
  const {request,write,programs}=await fixture(t);
  fs.writeFileSync(path.join(programs,'anna','cube.c'),'#pragma cpu 8s\nvoid main() {}\n');
  fs.writeFileSync(path.join(programs,'anna','plain.c'),'void main() {}\n');
  const files=(await request('/api/catalog')).payload.groups[1].files;
  assert.deepEqual(files.map(f=>[f.name,f.cpu]),[['cube.c','8s'],['plain.c','8x'],['sum.asm','8']]);
  assert.equal((await write('POST','/api/programs',{group:'anna',file:'new.c',source:'void main() {}'})).response.status,201);
  assert.equal((await write('POST','/api/programs',{group:'anna',file:'new.py',source:''})).response.status,400);
});
test('class progress checks every program that names a task, and keeps the best attempt',async t=>{
  const {request,programs}=await fixture(t);
  fs.writeFileSync(path.join(programs,'anna','add.asm'),'; Task: add\n LDA A, [0x80]\n LDA B, [0x81]\n ADD A, B\n STA [0x82], A\n HLT\n');
  fs.writeFileSync(path.join(programs,'anna','add2.asm'),'; Task: add\n LDA A, [0x80]\n STA [0x82], A\n HLT\n');
  fs.writeFileSync(path.join(programs,'ben','count.asm'),'; Task: countdown\n LDI A, 3\n OUT 0x11, A\n HLT\n');
  const {payload}=await request('/api/progress');
  assert.ok(payload.tasks.some(task=>task.id==='add'&&task.title));
  const anna=payload.students.find(s=>s.id==='anna'), ben=payload.students.find(s=>s.id==='ben');
  assert.equal(anna.cells.add.file,'add.asm');
  assert.equal(anna.cells.add.passed,anna.cells.add.total);
  assert.equal(anna.cells.add.attempts,2);
  assert.ok(anna.cells.add.cycles>0&&anna.cells.add.bytes===12, `${anna.cells.add.bytes} bytes`);
  assert.equal(ben.cells.countdown.passed,0);
  assert.equal(anna.cells.add.other,null);
  // A C solution of the same task rides along for the comparison.
  fs.writeFileSync(path.join(programs,'anna','add.c'),'// Task: add\n#pragma cpu 8x\nvoid main() { char *in = (char*)0x8000; in[2] = in[0] + in[1]; }\n');
  const again=(await request('/api/progress')).payload.students.find(s=>s.id==='anna').cells.add;
  assert.equal(again.language,'asm');
  assert.equal(again.other.language,'c');
  assert.equal(again.other.passed,again.other.total);
  assert.ok(again.other.bytes>again.bytes);
  assert.equal(payload.tasks.find(task=>task.id==='line').language,'c');
  assert.equal(anna.cells.countdown,undefined);
});
