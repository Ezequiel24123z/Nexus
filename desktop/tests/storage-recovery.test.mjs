import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {Store} from '../core/store.mjs';
import {SqliteWorkspace} from '../core/sqlite-workspace.mjs';
import {inspectRecovery,restoreIsolated,validateRecoveryState,isolatedRecoveryParent} from '../core/storage-recovery.mjs';
import {recoveryJob} from '../core/recovery-jobs.mjs';

function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-recovery-test-')),active=path.join(root,'active'),source=path.join(root,'export.json');
 fs.mkdirSync(active);const handles=[];
 t.after(()=>{for(const handle of handles)handle.close();assert.ok(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
 const task={id:crypto.randomUUID(),title:'Español 🧪',status:'running',dependsOn:[],messages:[{role:'user',content:'Recordar decisión'}],conversation:[{id:'message',role:'user',content:'Texto privado que no debe viajar en el preview'}],effects:[{id:'effect',status:'dispatched'}],calls:[{id:'call',status:'pending'}],events:[]};
 const state={schemaVersion:4,settings:{model:'test/model'},projects:[],connectors:[],mcpServers:[],tasks:[task]};
 fs.writeFileSync(source,JSON.stringify(state));
 return {root,active,source,state,task,handles};
}

test('preview reports counts without exposing conversation bodies or changing the source',t=>{
 const {source}=setup(t),before=fs.readFileSync(source);const preview=inspectRecovery(source);
 assert.equal(preview.chats,1);assert.equal(preview.messages,1);assert.equal(preview.interrupted,1);assert.equal(preview.format,'json');
 assert.equal(JSON.stringify(preview).includes('Texto privado'),false);assert.deepEqual(fs.readFileSync(source),before);
});

test('isolated restoration preserves source and active data, pauses work and verifies reopened state',t=>{
 const {root,active,source,task,handles}=setup(t),original=fs.readFileSync(source);
 fs.writeFileSync(path.join(active,'sentinel'),'no modificar');const preview=inspectRecovery(source);
 const result=restoreIsolated({source,parent:root,activeDirectory:active,expectedFingerprint:preview.fingerprint});
 assert.notEqual(result.directory,active);assert.deepEqual(fs.readFileSync(source),original);assert.equal(fs.readFileSync(path.join(active,'sentinel'),'utf8'),'no modificar');
 const store=new Store(result.directory);handles.push(store);const restored=store.task(task.id);
 assert.equal(restored.status,'paused');assert.equal(restored.calls[0].status,'interrupted');assert.equal(restored.effects[0].status,'uncertain');
 assert.equal(restored.messages[0].content,'Recordar decisión');assert.equal(restored.conversation[0].content,task.conversation[0].content);
 assert.equal(fs.existsSync(path.join(result.directory,'vault.bin')),false);assert.equal(fs.existsSync(path.join(result.directory,'uploads')),false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(result.directory,'recovery-report.json'))).notActivated,true);
});

test('changed source cannot restore under an earlier confirmation',t=>{
 const {root,active,source,state}=setup(t),preview=inspectRecovery(source);
 state.tasks[0].title='Changed';fs.writeFileSync(source,JSON.stringify(state));
 assert.throws(()=>restoreIsolated({source,parent:root,activeDirectory:active,expectedFingerprint:preview.fingerprint}),/changed/);
 assert.equal(fs.readdirSync(root).some(name=>name.startsWith('nexus-restored-')),false);
});

test('preview flags a frozen legacy JSON beside a SQLite marker and shows file age',t=>{
 const {root,source}=setup(t),legacy=path.join(root,'workspace.json');fs.copyFileSync(source,legacy);fs.writeFileSync(path.join(root,'storage-engine.json'),'{}');
 const preview=inspectRecovery(legacy);assert.ok(preview.warnings.some(text=>text.includes('frozen')));assert.ok(Number.isFinite(Date.parse(preview.modifiedAt)));
 assert.equal(inspectRecovery(source).warnings.some(text=>text.includes('frozen')),false);
});

test('invalid versions, collections, identities and dependencies are rejected before restoration',t=>{
 const {state,source}=setup(t);
 for(const mutate of [s=>s.schemaVersion=99,s=>s.tasks.push(s.tasks[0]),s=>s.tasks[0].id='../escape',s=>s.tasks[0].calls={},s=>s.tasks[0].effects=[null],s=>s.settings=[],s=>s.tasks[0].dependsOn=['missing']]){
   const invalid=structuredClone(state);mutate(invalid);assert.throws(()=>validateRecoveryState(invalid));
 }
 fs.writeFileSync(source,'{"tasks":');assert.throws(()=>inspectRecovery(source));
});

test('active directory, descendants and junction aliases are not restoration destinations',t=>{
 const {root,active}=setup(t),child=path.join(active,'child'),alias=path.join(root,'alias');fs.mkdirSync(child);
 assert.throws(()=>isolatedRecoveryParent(active,active),/outside/);assert.throws(()=>isolatedRecoveryParent(child,active),/outside/);
 fs.symlinkSync(active,alias,process.platform==='win32'?'junction':'dir');assert.throws(()=>isolatedRecoveryParent(alias,active),/outside/);
 assert.equal(isolatedRecoveryParent(root,active),fs.realpathSync(root));
});

test('SQLite inspection is read-only and includes committed WAL records',t=>{
 const {root,state,handles}=setup(t),filename=path.join(root,'copy.sqlite'),db=new SqliteWorkspace(filename,{create:true});handles.push(db);db.save(state);
 state.tasks[0].conversation.push({id:'wal-message',role:'assistant',content:'Confirmado en WAL'});db.save(state);
 const before=fs.readFileSync(filename),preview=inspectRecovery(filename);assert.equal(preview.messages,2);assert.equal(preview.format,'sqlite');assert.deepEqual(fs.readFileSync(filename),before);
 const reader=new SqliteWorkspace(filename,{readOnly:true});handles.push(reader);assert.throws(()=>reader.save(state),/read-only/);assert.equal(reader.read().tasks[0].conversation.length,2);
});

test('standalone SQLite backup restores into a compatible JSON workspace',t=>{
 const {root,active,state,handles}=setup(t),live=path.join(root,'live.sqlite'),source=path.join(root,'backup.sqlite');
 const db=new SqliteWorkspace(live,{create:true});handles.push(db);db.save(state);db.backup(source);
 const preview=inspectRecovery(source),result=restoreIsolated({source,parent:root,activeDirectory:active,expectedFingerprint:preview.fingerprint});
 assert.equal(JSON.parse(fs.readFileSync(path.join(result.directory,'workspace.json'))).tasks[0].title,state.tasks[0].title);
 assert.equal(fs.existsSync(path.join(result.directory,'storage-engine.json')),false);
});

test('failed verified rename keeps a candidate but never replaces current workspace',t=>{
 const {root,source,active}=setup(t),preview=inspectRecovery(source);
 t.mock.method(fs,'renameSync',()=>{throw new Error('synthetic write failure');});
 assert.throws(()=>restoreIsolated({source,parent:root,activeDirectory:active,expectedFingerprint:preview.fingerprint}),/Diagnostic/);
 const directory=path.join(root,fs.readdirSync(root).find(name=>name.startsWith('nexus-restored-')));
 assert.equal(fs.existsSync(path.join(directory,'workspace.json')),false);assert.ok(fs.existsSync(path.join(directory,'workspace.recovery-candidate.json')));
 assert.throws(()=>new Store(directory),/incomplete recovery/);
 assert.ok(fs.existsSync(source));assert.equal(fs.readdirSync(active).length,0);
});

test('SQLite readers keep one consistent revision when a writer commits between queries',t=>{
 const {root,state,handles}=setup(t),filename=path.join(root,'concurrent.sqlite');
 const writer=new SqliteWorkspace(filename,{create:true});handles.push(writer);writer.save(state);
 const reader=new SqliteWorkspace(filename,{readOnly:true});handles.push(reader);
 const prepare=reader.db.prepare.bind(reader.db);let injected=false;
 t.mock.method(reader.db,'prepare',sql=>{
   const statement=prepare(sql);
   if(sql==="SELECT value FROM meta WHERE key='root'")return {get(){
     const value=statement.get();if(!injected){injected=true;state.tasks[0].title='New revision';state.tasks[0].conversation.push({id:'new',role:'assistant',content:'Nueva respuesta'});writer.save(state);}return value;
   }};
   return statement;
 });
 const original=reader.read();assert.equal(original.tasks[0].title,'Español 🧪');assert.equal(original.tasks[0].conversation.length,1);assert.equal(reader.revision,1);
 const current=reader.read();assert.equal(current.tasks[0].title,'New revision');assert.equal(current.tasks[0].conversation.length,2);assert.equal(reader.revision,2);
});

test('worker validates and restores without changing the open store',async t=>{
 const {root,active,source}=setup(t);let ticks=0;const timer=setInterval(()=>ticks++,1);t.after(()=>clearInterval(timer));
 const preview=await recoveryJob({operation:'inspect',source});
 const result=await recoveryJob({operation:'restore',source,parent:root,activeDirectory:active,expectedFingerprint:preview.fingerprint});
 assert.equal(result.chats,1);assert.ok(ticks>0);assert.equal(fs.readdirSync(active).length,0);
 await assert.rejects(recoveryJob({operation:'inspect',source:path.join(root,'missing.json')}));
});
