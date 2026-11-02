import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {SqliteWorkspace,persistedState} from './sqlite-workspace.mjs';
import {normalizeTask} from './store.mjs';

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const arrayFields=['messages','conversation','events','calls','effects','attachments','pendingInstructions','dependsOn'];
const fingerprint=state=>crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
const uuid=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);

export function validateRecoveryState(state){
 if(!record(state)||!Array.isArray(state.tasks)||!record(state.settings))throw new Error('The backup does not contain a valid NEXUS state.');
 if(!Number.isInteger(state.schemaVersion)||state.schemaVersion<1||state.schemaVersion>4)throw new Error('Backup version is not compatible with this recovery assistant.');
 for(const key of ['projects','connectors','mcpServers'])if(state[key]!==undefined&&(!Array.isArray(state[key])||state[key].some(item=>!record(item))))throw new Error('Invalid collection: '+key);
 const ids=new Set();
 for(const task of state.tasks){
   if(!record(task)||!uuid(task.id)||ids.has(task.id))throw new Error('The backup contains invalid or duplicate chat identifiers.');
   ids.add(task.id);
   for(const key of arrayFields)if(task[key]!==undefined&&!Array.isArray(task[key]))throw new Error('Invalid history array: '+key);
   for(const key of ['messages','conversation','events','calls','effects','attachments'])if(task[key]?.some(item=>!record(item)))throw new Error('Invalid record in: '+key);
   for(const key of ['title','prompt','workspace','model','summary'])if(task[key]!==undefined&&typeof task[key]!=='string')throw new Error('Invalid chat field: '+key);
 }
 for(const task of state.tasks)if(task.dependsOn?.some(id=>!ids.has(id)||id===task.id))throw new Error('The backup contains missing or invalid task dependencies.');
 return state;
}

function readSource(filename){
 const stat=fs.statSync(filename);
 if(!stat.isFile()||stat.size>200*1024*1024)throw new Error('Select a backup file of up to 200 MiB for this assistant.');
 const extension=path.extname(filename).toLowerCase();let state;
 if(extension==='.json')state=JSON.parse(fs.readFileSync(filename,'utf8').replace(/^\uFEFF/,''));
 else if(extension==='.sqlite'){
   const database=new SqliteWorkspace(filename,{readOnly:true});
   try{state=database.read();}finally{database.close();}
 }else throw new Error('Select a JSON or SQLite NEXUS backup.');
 validateRecoveryState(state);
 return {state:persistedState(state),bytes:stat.size,modifiedAt:stat.mtime.toISOString(),format:extension.slice(1)};
}

export function inspectRecovery(filename){
 const {state,bytes,format,modifiedAt}=readSource(filename);
 const legacyWarning=path.basename(filename).toLowerCase()==='workspace.json'&&fs.existsSync(path.join(path.dirname(filename),'storage-engine.json'));
 return {name:path.basename(filename),format,bytes,modifiedAt,fingerprint:fingerprint(state),chats:state.tasks.length,projects:state.projects?.length||0,
   messages:state.tasks.reduce((n,task)=>n+(task.conversation?.length||0),0),
   interrupted:state.tasks.filter(task=>['running','queued','approval'].includes(task.status)).length,
   warnings:[...(legacyWarning?['This JSON file sits next to a SQLite marker: it may be the frozen pre-migration history. Prefer a recent export or SQLite backup.']:[]),'Recovers state only. Does not copy attachments, project files, drafts, or credentials.',
     'Preserved paths may point to the original project folders. Review workspaces and connectors before running tasks.',
     'The local skill and function library lives in capabilities and must be backed up separately.',
     'The recovered folder does not replace or automatically merge into the active session.']};
}

export function isolatedRecoveryParent(parent,activeDirectory){
 const target=fs.realpathSync(parent),active=fs.realpathSync(activeDirectory),relative=path.relative(active,target);
 if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new Error('Choose a destination outside the active data directory.');
 if(!fs.statSync(target).isDirectory())throw new Error('Destination must be a directory.');
 return target;
}

function writeDurable(filename,value){const fd=fs.openSync(filename,'wx');try{fs.writeFileSync(fd,value);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}

export function restoreIsolated({source,parent,activeDirectory,expectedFingerprint}){
 const target=isolatedRecoveryParent(parent,activeDirectory),{state}=readSource(source);
 if(fingerprint(state)!==expectedFingerprint)throw new Error('The backup file changed after review. Select it again.');
 for(const task of state.tasks){
   for(const key of arrayFields)task[key]||=[];
   normalizeTask(task);
 }
 const durable=persistedState(state),directory=fs.mkdtempSync(path.join(target,'nexus-restored-'));
 try{
   const candidate=path.join(directory,'workspace.recovery-candidate.json');
   writeDurable(candidate,JSON.stringify(durable,null,2));
   if(!isDeepStrictEqual(JSON.parse(fs.readFileSync(candidate,'utf8')),durable))throw new Error('Verification read does not match.');
   const report={version:1,sourceName:path.basename(source),sourceFingerprint:expectedFingerprint,at:new Date().toISOString(),chats:durable.tasks.length,
     stateOnly:true,notActivated:true,missing:['attachments','project-files','drafts','credentials','capabilities'],reviewOriginalPaths:true};
   writeDurable(path.join(directory,'recovery-report.json'),JSON.stringify(report,null,2));
   fs.renameSync(candidate,path.join(directory,'workspace.json'));
   return {directory,chats:durable.tasks.length,stateOnly:true};
 }catch(error){throw new Error('Recovery did not complete. Diagnostic folder preserved at '+directory+'. '+error.message);}
}
