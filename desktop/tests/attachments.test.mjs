import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Store} from '../core/store.mjs';
import {Runtime,estimateTokens} from '../core/runtime.mjs';
import {assertImageCapability} from '../core/attachments.mjs';
import {executeTool} from '../core/tools.mjs';

async function setup(t,request){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-uploads-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=new Store(path.join(directory,'data'));
 const runtime=new Runtime(store,{getSecret:()=> 'test-only',request:request|| (async()=>new Response(JSON.stringify({choices:[{message:{content:'Continuidad: preservar archivos adjuntos y leer sus fragmentos cuando se necesiten.'}}]})))});
 runtime.closed=true;t.after(()=>runtime.shutdown());
 return {runtime,store,directory};
}
test('large text attachments are copied once and read by bounded UTF-8 pages without filling the prompt',async t=>{
 const {runtime,store,directory}=await setup(t);const filename=path.join(directory,'datos.txt');
 const original='á🙂línea de prueba\n'.repeat(20000);await fs.writeFile(filename,original);
 const attachment=await runtime.attachments.importFile(filename);
 await fs.writeFile(filename,'archivo modificado después');
 const id=runtime.create({prompt:'Revisa el adjunto',attachmentIds:[attachment.id]});const task=store.task(id);
 assert.equal(attachment.bytes,Buffer.byteLength(original));assert.equal(attachment.kind,'text');
 assert.ok(JSON.stringify(runtime.buildContext(task)).length<10000);
 assert.ok(!JSON.stringify(store.state).includes(original));
 const page=await executeTool(runtime,task,'read_attachment',{id:attachment.id,length:9},new AbortController().signal);
 const second=await runtime.attachments.read(task,attachment.id,{offset:page.next,length:17});
 assert.ok(original.startsWith(page.content+second.content));assert.ok(!page.content.includes('�'));
 assert.equal(await fs.readFile(runtime.attachments.filename(attachment.id),'utf8'),original);
});
test('attachment metadata and retrieval survive compaction and restart',async t=>{
 const {runtime,store,directory}=await setup(t);const filename=path.join(directory,'notas.md');await fs.writeFile(filename,'Detalle exacto que debe seguir recuperable.');
 const file=await runtime.attachments.importFile(filename);const id=runtime.create({prompt:'Analiza',attachmentIds:[file.id]});
 await runtime.compact(store.task(id),new AbortController().signal);
 const restored=new Store(store.directory),next=new Runtime(restored,{getSecret:()=>''});t.after(()=>next.shutdown());
 const listed=await executeTool(next,restored.task(id),'list_attachments',{},new AbortController().signal);
 assert.equal(listed[0].id,file.id);
 const page=await next.attachments.read(restored.task(id),file.id);assert.match(page.content,/Detalle exacto/);
});
test('image bytes are hydrated for outbound vision but kept out of persisted messages',async t=>{
 const {runtime,store,directory}=await setup(t);const filename=path.join(directory,'pixel.png');
 const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 await fs.writeFile(filename,Buffer.from(base64,'base64'));const attachment=await runtime.attachments.importFile(filename);
 const id=runtime.create({prompt:'Describe',attachmentIds:[attachment.id]});const task=store.task(id);
 assert.equal(attachment.kind,'image');
 assert.ok(JSON.stringify(runtime.buildContext(task)).includes(base64));
 assert.ok(!JSON.stringify(store.state).includes(base64));
 assert.ok(estimateTokens(runtime.buildContext(task,{hydrate:false}))>2500);
});
test('unknown IDs and cross-chat reads cannot inject attachment paths',async t=>{
 const {runtime,store,directory}=await setup(t);const filename=path.join(directory,'a.txt');await fs.writeFile(filename,'a');
 const file=await runtime.attachments.importFile(filename),id=runtime.create({prompt:'Sin adjuntos'});
 await assert.rejects(runtime.attachments.read(store.task(id),file.id),/no pertenece/);
 assert.throws(()=>runtime.create({prompt:'Inyección',attachmentIds:['../../vault.bin']}));
 assert.throws(()=>runtime.create({prompt:'Inyección',attachmentIds:[{id:file.id,path:'C:\\otro'}]}));
 assert.equal(store.state.tasks.length,1);
});
test('binary files remain local without being misrepresented as UTF-8 or sent as file contents',async t=>{
 const {runtime,store,directory}=await setup(t);const filename=path.join(directory,'documento.pdf');await fs.writeFile(filename,Buffer.from('%PDF-1.7\n\0binary'));
 const attachment=await runtime.attachments.importFile(filename);assert.equal(attachment.kind,'file');
 const id=runtime.create({prompt:'Revisa',attachmentIds:[attachment.id]});const page=await runtime.attachments.read(store.task(id),attachment.id);
 assert.ok(page.path);assert.equal(page.content,undefined);assert.match(page.note,/extracción/);
 assert.ok(!JSON.stringify(runtime.buildContext(store.task(id))).includes('%PDF'));
});
test('attachment follow-ups remain queued until a valid tool boundary',async t=>{
 const {runtime,store,directory}=await setup(t);const filename=path.join(directory,'seguimiento.txt');await fs.writeFile(filename,'Seguimiento con datos');
 const file=await runtime.attachments.importFile(filename);const id=runtime.create({prompt:'Inicio'});const task=store.task(id);
 runtime.active.set(id,new AbortController());runtime.resume(id,'Lee esto',[file.id]);
 assert.equal(task.messages.length,1);assert.equal(task.pendingFollowups,1);
 runtime.active.delete(id);runtime.flushFollowups(task);
 assert.ok(JSON.stringify(task.messages.at(-1)).includes(file.id));assert.equal(task.conversation.at(-1).attachments[0].id,file.id);
});
test('preflight prevents sending images to unconfirmed text-only models',()=>{
 assert.throws(()=>assertImageCapability([{kind:'image'}],{architecture:{input_modalities:['text']}}),/visión/);
 assert.throws(()=>assertImageCapability([{kind:'image'}],undefined));
 assert.doesNotThrow(()=>assertImageCapability([{kind:'image'}],{architecture:{input_modalities:['text','image']}}));
 assert.doesNotThrow(()=>assertImageCapability([{kind:'text'}],undefined));
});

test('the tool loop reads an attachment into a bounded result and completes without requiring a project',async t=>{
 let attachment,requests=0;
 const {runtime,store,directory}=await setup(t,async(_,options)=>{
   requests++;const body=JSON.parse(options.body);
   if(requests===1)return new Response(JSON.stringify({choices:[{message:{content:null,tool_calls:[{id:'read-upload',type:'function',function:{name:'read_attachment',arguments:JSON.stringify({id:attachment.id,length:50})}}]}}]}));
   assert.match(body.messages.at(-1).content,/marcador-local-verified/);
   return new Response(JSON.stringify({choices:[{message:{content:'Comprobado.'}}]}));
 });
 const filename=path.join(directory,'fuente.txt');await fs.writeFile(filename,'marcador-local-verified');attachment=await runtime.attachments.importFile(filename);
 const id=runtime.create({prompt:'Lee el adjunto',attachmentIds:[attachment.id]});const task=store.task(id);
 assert.ok(task.workspace.startsWith(store.directoryFor(id)));await runtime.run(task,new AbortController().signal);
 assert.equal(requests,2);assert.equal(task.status,'complete');assert.equal(task.result,'Comprobado.');
});
test('renderer bridge exposes attachment and web link methods while rejecting unknown operations',async()=>{
 let bridge;const sent=[];
 const code=await fs.readFile(new URL('../preload.cjs',import.meta.url),'utf8');
 vm.runInNewContext(code,{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(_,value)=>bridge=value},ipcRenderer:{invoke:(...args)=>{sent.push(args);return Promise.resolve(true);}}};}});
 for(const method of ['chooseAttachments','previewAttachment','openExternal','searchChat','messageWindow','taskResults','previewResult','watchChat','storageInfo','migrateStorage','exportStorage','inspectRecovery','restoreRecovery','capabilitiesPage','getCapability','saveCapability','connectorsPage','getConnector','updateConnector','mcpToolsPage','previewOpenApi','importOpenApi','inspectContext','contextSection','inspectCosts','checkpointPreview'])await bridge.invoke(method,{id:'example'});
 assert.equal(sent.length,26);await assert.rejects(bridge.invoke('exec'));
});
