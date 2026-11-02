import fs from 'node:fs';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
const require=createRequire(import.meta.url);
const collections=['messages','conversation','events','calls','effects'];
const transient=new Set(['liveText','liveReasoning','liveActivity']);

export function persistedState(state){
 return JSON.parse(JSON.stringify({...state,tasks:state.tasks.map(task=>Object.fromEntries(Object.entries(task).filter(([key])=>!transient.has(key))))}));
}
function encodeTask(task){
 const data={},sizes={},items={};
 for(const [key,value] of Object.entries(task)){
   if(transient.has(key))continue;
   if(collections.includes(key)&&Array.isArray(value)){sizes[key]=value.length;items[key]=value.map(item=>{const text=JSON.stringify(item);if(text===undefined)throw new Error('Invalid history record.');return text;});}
   else data[key]=value;
 }
 return {meta:JSON.stringify({data,sizes}),items};
}

export class SqliteWorkspace {
 constructor(filename,{create=false,readOnly=false}={}){
   if(create&&readOnly)throw new Error('Cannot create a database in read-only mode.');
   if(!create&&!fs.existsSync(filename))throw new Error('SQLite store is missing. Did not fall back to stale legacy history.');
   const {DatabaseSync}=require('node:sqlite');this.filename=filename;this.readOnly=readOnly;this.db=new DatabaseSync(filename,{timeout:3000,readOnly,defensive:true});
   try{
     this.db.exec(readOnly?'PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;':'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
     if(create){this.db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
       CREATE TABLE tasks(id TEXT PRIMARY KEY,data TEXT NOT NULL);
       CREATE TABLE entries(task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,collection TEXT NOT NULL,ordinal INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(task_id,collection,ordinal));
       PRAGMA user_version=1;`);}
     if(this.db.prepare('PRAGMA user_version').get().user_version!==1)throw new Error('Unsupported SQLite storage version.');
     if(this.db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('SQLite store requires recovery.');
     this.cache=new Map();this.root=null;this.revision=0;this.lastSave=null;
     if(readOnly)return;
     this.putMeta=this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
     this.putTask=this.db.prepare('INSERT INTO tasks(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data');
     this.putEntry=this.db.prepare('INSERT INTO entries(task_id,collection,ordinal,data) VALUES(?,?,?,?) ON CONFLICT(task_id,collection,ordinal) DO UPDATE SET data=excluded.data');
     this.trim=this.db.prepare('DELETE FROM entries WHERE task_id=? AND collection=? AND ordinal>=?');
   }catch(error){this.db.close();throw error;}
 }
 read(){
   this.db.exec('BEGIN');
   try{const state=this.readSnapshot();this.db.exec('COMMIT');return state;}
   catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 readSnapshot(){
   const root=this.db.prepare("SELECT value FROM meta WHERE key='root'").get();if(!root)throw new Error('Incomplete SQLite migration; no committed root record.');
   const data=JSON.parse(root.value);if(!Array.isArray(data.tasks)||new Set(data.tasks).size!==data.tasks.length)throw new Error('Invalid task index.');
   const tasks=new Map(),cache=new Map();
   for(const row of this.db.prepare('SELECT id,data FROM tasks').all()){
     const item=JSON.parse(row.data);if(item.data?.id!==row.id||!item.sizes)throw new Error('Invalid task metadata.');
     const task=item.data,raw={meta:row.data,items:{}};
     for(const [name,length] of Object.entries(item.sizes)){if(!collections.includes(name)||!Number.isSafeInteger(length)||length<0)throw new Error('Invalid collection.');task[name]=[];raw.items[name]=[];}
     tasks.set(row.id,{task,sizes:item.sizes});cache.set(row.id,raw);
   }
   for(const row of this.db.prepare('SELECT task_id,collection,ordinal,data FROM entries ORDER BY task_id,collection,ordinal').all()){
     const item=tasks.get(row.task_id),array=item?.task[row.collection];if(!collections.includes(row.collection)||!Array.isArray(array)||row.ordinal!==array.length||row.ordinal>=item.sizes[row.collection])throw new Error('Incomplete or non-contiguous SQLite history.');
     array.push(JSON.parse(row.data));cache.get(row.task_id).items[row.collection].push(row.data);
   }
   if(tasks.size!==data.tasks.length||data.tasks.some(id=>!tasks.has(id)))throw new Error('Task index and history do not match.');
   for(const {task,sizes} of tasks.values())for(const [name,length] of Object.entries(sizes))if(task[name].length!==length)throw new Error('Missing history records.');
   this.root=root.value;this.cache=cache;this.revision=Number(this.db.prepare("SELECT value FROM meta WHERE key='revision'").get()?.value||0);
   return {...data,tasks:data.tasks.map(id=>tasks.get(id).task)};
 }
 save(state,focus=undefined){
   if(this.readOnly)throw new Error('The database is opened in read-only mode.');
   const started=performance.now(),root=JSON.stringify({...state,tasks:state.tasks.map(task=>task.id)}),ids=new Set(state.tasks.map(task=>task.id));
   if(ids.size!==state.tasks.length||state.tasks.some(task=>typeof task.id!=='string'||!task.id))throw new Error('Invalid task identifiers.');
   const target=focus?.id??focus;
   const changed=new Map(),writes=[],removed=[...this.cache.keys()].filter(id=>!ids.has(id));let encodedBytes=0,scannedTasks=0;
   for(const task of state.tasks){
     if(focus!==undefined&&task.id!==target&&this.cache.has(task.id))continue;
     scannedTasks++;const next=encodeTask(task),prior=this.cache.get(task.id);
     if(next.meta!==prior?.meta){writes.push(['task',task.id,next.meta]);encodedBytes+=Buffer.byteLength(next.meta);}
     for(const name of collections){
       const before=prior?.items[name]||[],after=next.items[name]||[];
       if(before.length>after.length)writes.push(['trim',task.id,name,after.length]);
       for(let i=0;i<after.length;i++)if(after[i]!==before[i]){writes.push(['entry',task.id,name,i,after[i]]);encodedBytes+=Buffer.byteLength(after[i]);}
     }
     changed.set(task.id,next);
   }
   const rootChanged=root!==this.root;
   const stats={scannedTasks,rowsWritten:writes.length+removed.length+(rootChanged?1:0),entryRowsWritten:writes.filter(item=>item[0]==='entry').length,changedPayloadBytes:encodedBytes+(rootChanged?Buffer.byteLength(root):0)};
   if(!stats.rowsWritten){this.lastSave={...stats,milliseconds:performance.now()-started};return this.lastSave;}
   this.db.exec('BEGIN IMMEDIATE');
   try{
     const revision=Number(this.db.prepare("SELECT value FROM meta WHERE key='revision'").get()?.value||0);
     if(revision!==this.revision)throw new Error('The store changed from another process. Close and reopen NEXUS before saving.');
     for(const id of removed)this.db.prepare('DELETE FROM tasks WHERE id=?').run(id);
     for(const [kind,...args] of writes){if(kind==='task')this.putTask.run(...args);else if(kind==='entry')this.putEntry.run(...args);else this.trim.run(...args);}
     if(rootChanged)this.putMeta.run('root',root);
     this.putMeta.run('revision',String(revision+1));this.db.exec('COMMIT');this.revision=revision+1;
   }catch(error){try{this.db.exec('ROLLBACK');}catch{}throw error;}
   for(const id of removed)this.cache.delete(id);for(const [id,next] of changed)this.cache.set(id,next);this.root=root;
   this.lastSave={...stats,milliseconds:performance.now()-started};return this.lastSave;
 }
 backup(filename){this.db.prepare('VACUUM INTO ?').run(filename);}
 close(){if(this.db){this.db.close();this.db=null;}}
}
