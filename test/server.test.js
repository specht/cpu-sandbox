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
  const server=createServer({ programsDir:programs, examplesDir:examples });
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
  assert.deepEqual(payload.groups[1].files,['sum.asm']);
  assert.deepEqual(payload.groups[2].files,[]);
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
  const created=await write('POST','/api/programs',{group:'ben',file:'new.asm',source:'HLT'});
  assert.equal(created.response.status,201);
  assert.ok((await request('/api/catalog')).payload.groups.find(g=>g.id==='ben').files.includes('new.asm'));
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
test('static web entrypoint and ES modules are accessible',async t=>{
  const {base}=await fixture(t);
  for(const uri of ['/','/app.js','/assembler.js','/cpu.js','/display.js','/palettes.js','/style.css']) {
    const res=await fetch(base+uri);assert.equal(res.status,200,uri);
    assert.ok((await res.text()).length>20);
  }
});

test('browser can import the shared opcode module', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/opcodes.js`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /export const OPCODES/);
});
