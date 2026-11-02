import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {DraftStore} from '../core/drafts.mjs';
import {DraftController} from '../src/draft-controller.mjs';

const key='task:11111111-1111-4111-8111-111111111111';
const attachmentId='22222222-2222-4222-8222-222222222222';
const input=(revision,text='Texto pendiente')=>({key,revision,text,attachmentIds:[attachmentId],workspace:'D:\\Proyecto'});
async function setup(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-drafts-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 return {directory,store:new DraftStore(directory)};
}
function apiFor(store){return async(method,args)=>{
 if(method==='getDrafts'){const result=store.list();for(const [key,value] of Object.entries(result.items))result.items[key]={...value,attachments:value.attachmentIds.map(id=>({id}))};return result;}
 if(method==='saveDraft')return store.save(args);
 if(method==='clearDraft')return store.clear(args.key,args.revision);
 throw new Error(method);
};}

test('drafts restore text, attachment references and folder without rewriting the workspace',async t=>{
 const {directory,store}=await setup(t);const workspace=path.join(directory,'workspace.json');
 await fs.writeFile(workspace,'untouched workspace');const before=await fs.stat(workspace);
 store.save(input(1));const restored=new DraftStore(directory).list().items[key];
 assert.equal(restored.text,'Texto pendiente');assert.deepEqual(restored.attachmentIds,[attachmentId]);assert.equal(restored.workspace,'D:\\Proyecto');
 assert.equal(await fs.readFile(workspace,'utf8'),'untouched workspace');assert.equal((await fs.stat(workspace)).mtimeMs,before.mtimeMs);
});
test('stale writes and clear requests cannot overwrite a newer draft, even after restart',async t=>{
 const {directory,store}=await setup(t);store.save(input(2,'Nueva versión'));
 assert.equal(store.save(input(1)).text,'Nueva versión');assert.equal(store.clear(key,1).text,'Nueva versión');
 assert.equal(store.clear(key,2).revision,3);
 const restored=new DraftStore(directory);assert.equal(restored.save(input(2)).text,'');assert.deepEqual(restored.list().items[key].attachmentIds,[]);
 assert.equal(restored.save(input(4,'Otra edición')).text,'Otra edición');
});
test('draft identifiers reject traversal and invalid revisions before creating files',async t=>{
 const {store}=await setup(t);
 for(const value of [{...input(1),key:'../../secret'},{...input(1),attachmentIds:['../../secret']},input(0),input(NaN)])assert.throws(()=>store.save(value));
 assert.deepEqual(await fs.readdir(store.directory),[]);
});
test('a damaged draft recovers its backup and preserves the damaged source',async t=>{
 const {directory,store}=await setup(t);store.save(input(1,'Copia recuperable'));store.save(input(2));
 await fs.writeFile(store.filename(key),'{broken');const recovered=new DraftStore(directory);
 assert.equal(recovered.list().items[key].text,'Copia recuperable');assert.equal(recovered.issues.length,1);
 recovered.save(input(3));assert.ok((await fs.readdir(store.directory)).some(name=>name.includes('.corrupt-')));
 assert.equal(new DraftStore(directory).list().items[key].revision,3);
});
test('out-of-order draft requests retain the newest edit and report the correct saved state',async t=>{
 const {store}=await setup(t);const api=apiFor(store),pending=[];
 const controller=new DraftController((method,args)=>method==='saveDraft'?new Promise(resolve=>pending.push(()=>api(method,args).then(resolve))):api(method,args));
 await controller.load();controller.update(key,{text:'Primera'});controller.update(key,{text:'Segunda'});
 pending[1]();pending[0]();await controller.flush();
 assert.equal(store.list().items[key].text,'Segunda');assert.equal(controller.status[key],'saved');assert.equal(controller.get(key).text,'Segunda');
});
test('failed draft saves block close/send until a successful retry',async t=>{
 const {store}=await setup(t);const api=apiFor(store);let failing=true;
 const controller=new DraftController(async(method,args)=>{if(method==='saveDraft'&&failing)throw new Error('Disk full');return api(method,args);});
 await controller.load();controller.update(key,{text:'No perder'});
 await assert.rejects(controller.flush(),/No se pudo guardar/);assert.equal(controller.status[key],'error');assert.equal(controller.get(key).text,'No perder');
 failing=false;await controller.retry(key);await controller.flush();assert.equal(controller.status[key],'saved');
});
test('clearing one submitted draft retains other chats and edits made while sending',async t=>{
 const {store}=await setup(t);const controller=new DraftController(apiFor(store));await controller.load();
 controller.update(key,{text:'Mensaje'});controller.update('new:',{text:'Otro chat'});await controller.flush();
 controller.update(key,{text:'Edición posterior'});await controller.flush();await controller.clear(key,1);
 assert.equal(controller.get(key).text,'Edición posterior');assert.equal(controller.get('new:').text,'Otro chat');
 await controller.clear(key,2);assert.equal(controller.get(key).text,'');assert.equal(store.list().items[key].revision,3);
});
test('desktop close acknowledgment waits for the renderer save barrier and reports failure',async()=>{
 let bridge,handler;const sent=[];
 const code=await fs.readFile(new URL('../preload.cjs',import.meta.url),'utf8');
 vm.runInNewContext(code,{require:()=>({contextBridge:{exposeInMainWorld:(_,value)=>bridge=value},ipcRenderer:{on:(_,cb)=>handler=cb,send:(...args)=>sent.push(args),removeListener:()=>{handler=null;}}})});
 let release;const gate=new Promise(resolve=>release=resolve);const off=bridge.beforeClose(()=>gate);
 handler();await Promise.resolve();assert.equal(sent.length,1);assert.equal(sent[0][0],'nexus:drafts:ready');
 release(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(sent.at(-1)[1],true);off();assert.equal(handler,null);
 bridge.beforeClose(async()=>{throw new Error('Save failed');});handler();await new Promise(resolve=>setImmediate(resolve));assert.equal(sent.at(-1)[1],false);
});
