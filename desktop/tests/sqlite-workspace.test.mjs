import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../core/store.mjs';
import {Runtime} from '../core/runtime.mjs';
import {SqliteWorkspace,persistedState} from '../core/sqlite-workspace.mjs';

async function setup(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-sqlite-')),handles=[];
 const open=()=>{const store=new Store(directory);handles.push(store);return store;};
 t.after(async()=>{for(const handle of handles)handle.close();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(directory,{recursive:true,force:true});});
 const store=open(),runtime=new Runtime(store,{getSecret:()=>null});runtime.closed=true;const task=store.task(runtime.create({prompt:'Prueba de migración',workspace:directory}));task.status='paused';store.save();
 return {directory,store,runtime,task,open,handles};
}
test('migration preserves all durable state, creates a legacy backup and switches only after verification',async t=>{
 const {store,task,open,directory}=await setup(t);task.conversation.push({id:crypto.randomUUID(),role:'assistant',content:'Español 🧪',pinned:true});store.save();const before=persistedState(store.state);const original=await fs.readFile(store.filename,'utf8');
 const info=store.migrateToSqlite();assert.equal(info.engine,'sqlite');assert.deepEqual(store.backend.read(),before);assert.equal(await fs.readFile(store.filename,'utf8'),original);assert.equal(await fs.readFile(path.join(directory,info.migration.backup),'utf8'),original);
 store.close();const restored=open();assert.equal(restored.storageInfo().engine,'sqlite');assert.equal(restored.task(task.id).conversation.at(-1).content,'Español 🧪');
});
test('appending a record only writes changed rows and leaves unrelated histories untouched',async t=>{
 const {store,runtime,task}=await setup(t);const other=store.task(runtime.create({prompt:'Otra tarea'}));other.status='paused';store.save();store.migrateToSqlite();
 Object.defineProperty(other,'conversation',{get(){throw new Error('Read unrelated history');},configurable:true});
 task.conversation.push({id:'new',role:'assistant',content:'Un cambio'});store.save(task);assert.equal(store.backend.lastSave.scannedTasks,1);assert.equal(store.backend.lastSave.entryRowsWritten,1);assert.ok(store.backend.lastSave.changedPayloadBytes<3000);
 store.save(task);assert.equal(store.backend.lastSave.rowsWritten,0);
});
test('updates, truncation, compression-style replacement and task removal survive reload',async t=>{
 const {store,task,runtime}=await setup(t);const second=runtime.create({prompt:'Eliminar sólo de fixture'});store.migrateToSqlite();
 task.conversation[0].pinned=true;task.messages=[{role:'system',content:'Cápsula'}];task.calls=[{id:'c',cost:.1}];store.save(task);task.calls[0].cost=.2;store.save(task);store.state.tasks=store.state.tasks.filter(t=>t.id!==second);store.save(null);
 const state=store.backend.read();assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].conversation[0].pinned,true);assert.equal(state.tasks[0].calls[0].cost,.2);assert.equal(state.tasks[0].messages[0].content,'Cápsula');
});
test('failed transaction rolls back rows and caches; retry preserves the intended update',async t=>{
 const {store,task}=await setup(t);store.migrateToSqlite();const original=structuredClone(store.backend.read());task.conversation.push({id:'retry',role:'assistant',content:'Intento'});
 store.backend.db.exec("CREATE TRIGGER reject_entries BEFORE INSERT ON entries BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END");
 assert.throws(()=>store.save(task),/synthetic disk failure/);assert.deepEqual(store.backend.read(),original);store.backend.db.exec('DROP TRIGGER reject_entries');store.save(task);assert.equal(store.backend.read().tasks[0].conversation.at(-1).id,'retry');
});
test('failure before activating marker keeps JSON authoritative and candidate recoverable',async t=>{
 const {store,directory,open}=await setup(t),rename=sync.renameSync;
 t.mock.method(sync,'renameSync',(from,to)=>{if(path.basename(to)==='storage-engine.json')throw new Error('activation failure');return rename(from,to);});
 assert.throws(()=>store.migrateToSqlite(),/activation failure/);assert.equal(sync.existsSync(path.join(directory,'storage-engine.json')),false);assert.equal(open().storageInfo().engine,'json');assert.ok((await fs.readdir(directory)).some(name=>name.endsWith('.sqlite')));
});
test('legacy writes after activation are detected instead of silently discarding either history',async t=>{
 const {store,open}=await setup(t);store.migrateToSqlite();store.close();await fs.appendFile(store.filename,'\n');assert.throws(()=>open(),/cambió después de migrar/);
});
test('missing or corrupt active database never falls back silently to stale JSON',async t=>{
 const {store,open}=await setup(t);const info=store.migrateToSqlite();store.close();await fs.rename(info.file,info.file+'.preserved');assert.throws(()=>open(),/SQLite store is missing/);await fs.writeFile(info.file,'broken');assert.throws(()=>open());
});
test('SQLite backups and JSON export preserve current records independently of live database',async t=>{
 const {store,task,directory,handles}=await setup(t);store.migrateToSqlite();task.conversation.push({id:'latest',role:'assistant',content:'Contenido posterior a migración'});store.save(task);
 const backup=path.join(directory,'backup-test.sqlite');store.backend.backup(backup);const db=new SqliteWorkspace(backup);handles.push(db);assert.equal(db.read().tasks[0].conversation.at(-1).id,'latest');
 const output=path.join(directory,'export.json');store.exportState(output);assert.equal(JSON.parse(await fs.readFile(output,'utf8')).tasks[0].conversation.at(-1).id,'latest');
});
test('stale independent writer is rejected before it can overwrite a committed revision',async t=>{
 const {store,task,handles}=await setup(t);const info=store.migrateToSqlite(),other=new SqliteWorkspace(info.file);handles.push(other);const stale=other.read();task.title='Nuevo título';store.save(task);stale.tasks[0].title='Viejo';assert.throws(()=>other.save(stale),/another process/);assert.equal(store.backend.read().tasks[0].title,'Nuevo título');
});
test('hard process termination rolls back uncommitted SQLite work and retains committed state',async t=>{
 const {store,task,directory,open}=await setup(t);store.migrateToSqlite();store.close();
 const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/sqlite-crash.mjs',import.meta.url)),directory],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 const exited=new Promise(resolve=>child.once('exit',resolve));t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;});
 await new Promise((resolve,reject)=>{let output='',error='';const timer=setTimeout(()=>reject(new Error('Child timeout: '+error)),10000);child.stderr.on('data',chunk=>error+=chunk);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('READY')){clearTimeout(timer);resolve();}});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);if(!output.includes('READY'))reject(new Error(error));});});
 child.kill('SIGKILL');await exited;const restored=open();assert.equal(restored.task(task.id).title,'Prueba de migración');assert.equal(restored.task(task.id).conversation.at(-1).id,'committed-before-crash');
});
test('synthetic incremental save reports payload reduction without claiming physical disk bytes',async t=>{
 const {store,task}=await setup(t);task.conversation=Array.from({length:10000},(_,i)=>({id:String(i),role:'assistant',content:'Historial sintético '.repeat(25)}));store.save();const legacyBytes=Buffer.byteLength(JSON.stringify(store.state,null,2));store.migrateToSqlite();
 task.conversation.push({id:'new',role:'assistant',content:'Una respuesta nueva'});store.save(task);const stats=store.backend.lastSave;assert.equal(stats.entryRowsWritten,1);assert.ok(stats.changedPayloadBytes<legacyBytes*.01);t.diagnostic(JSON.stringify({messages:10000,legacySnapshotBytes:legacyBytes,...stats,note:'Payload lógico cambiado, no bytes físicos de WAL/fsync'}));
});
test('activation followed by an open failure freezes legacy writes until restart',async t=>{
 const {store,open}=await setup(t),read=SqliteWorkspace.prototype.read;let reads=0;
 const mock=t.mock.method(SqliteWorkspace.prototype,'read',function(){if(++reads===2)throw new Error('synthetic post-activation failure');return read.call(this);});
 assert.throws(()=>store.migrateToSqlite(),/post-activation/);assert.throws(()=>store.save(),/halted/);store.close();mock.mock.restore();const restored=open();assert.equal(restored.storageInfo().engine,'sqlite');
});
test('agent tool loop and compaction persist correctly using only the migrated backend',async t=>{
 const {store,runtime,task,open,directory}=await setup(t);store.migrateToSqlite();runtime.getSecret=()=> 'synthetic-only';let steps=0;
 runtime.request=async(_,options)=>{const input=JSON.parse(options.body);let message;
   if(!input.tools)message={content:'Continuidad: se escribió resultado.txt y se comprobó la escritura. No repetir herramientas terminadas. Próximo paso: revisar el resultado si el usuario lo solicita. '.repeat(4)};
   else if(steps++===0)message={content:'Escribiendo',tool_calls:[{id:'write-once',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'resultado.txt',content:'correcto',reason:'prueba SQLite'})}}]};
   else message={content:'Resultado comprobado'};
   return new Response(JSON.stringify({choices:[{message}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110,cost:.00001}}),{headers:{'Content-Type':'application/json'}});
 };
 await runtime.run(task,new AbortController().signal);assert.equal(await fs.readFile(path.join(directory,'resultado.txt'),'utf8'),'correcto');assert.equal(task.status,'complete');await runtime.compact(task,new AbortController().signal);store.save(task);
 const before=persistedState(store.state);assert.deepEqual(store.backend.read(),before);store.close();const restored=open().task(task.id);assert.ok(restored.compressions>0);assert.equal(restored.effects[0].status,'observed');assert.ok(restored.conversation.some(message=>message.content==='Resultado comprobado'));
});
