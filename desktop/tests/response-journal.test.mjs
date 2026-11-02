import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../core/store.mjs';
import {Runtime} from '../core/runtime.mjs';
import {ResponseJournal,readResponseJournal} from '../core/response-journal.mjs';
import {contextAdvice} from '../src/context-advice.mjs';

async function setup(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-response-test-'));
 t.after(async()=>{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true});});
 const store=new Store(directory),runtime=new Runtime(store,{getSecret:()=> 'synthetic'});runtime.closed=true;t.after(()=>runtime.shutdown());
 const task=store.task(runtime.create({prompt:'Synthetic response',model:'test/model'}));
 return {directory,store,runtime,task};
}
test('response fragments append linearly without rewriting the complete workspace',async t=>{
 const {store,task}=await setup(t);const before=await fs.readFile(store.filename,'utf8');
 const journal=new ResponseJournal(store.directoryFor(task.id),crypto.randomUUID());let text='';
 for(let index=0;index<2000;index++){text+='á🧪'+index+' ';journal.update(text);}journal.close();
 assert.equal(readResponseJournal(store.directoryFor(task.id)).text,text);
 assert.ok((await fs.stat(journal.filename)).size<Buffer.byteLength(text)*10,'must store deltas rather than cumulative snapshots');
 assert.equal(await fs.readFile(store.filename,'utf8'),before);
});
test('incomplete JSON at the end of a response preserves complete Unicode fragments',async t=>{
 const {store,task}=await setup(t);const journal=new ResponseJournal(store.directoryFor(task.id),crypto.randomUUID());
 journal.update('Dato válido ñ 🧪');journal.close();await fs.appendFile(journal.filename,'{"type":"text","delta":"cortado');
 const result=readResponseJournal(store.directoryFor(task.id));assert.equal(result.text,'Dato válido ñ 🧪');assert.equal(result.damaged,true);
});
test('recovering a response is idempotent and never injects unfinished text into model history',async t=>{
 const {store,task,directory}=await setup(t);const responseId=crypto.randomUUID();
 const journal=new ResponseJournal(store.directoryFor(task.id),responseId);journal.update('Respuesta incompleta');journal.close();
 const restored=new Store(directory),recovered=restored.task(task.id);
 assert.equal(recovered.status,'paused');assert.equal(recovered.messages.length,1);assert.equal(recovered.conversation.at(-1).id,responseId);assert.equal(recovered.conversation.at(-1).recovered,true);
 assert.equal(new Store(directory).task(task.id).conversation.filter(message=>message.id===responseId).length,1);
});
test('a committed final answer is not recovered a second time',async t=>{
 const {store,task,directory}=await setup(t);const responseId=crypto.randomUUID();
 const journal=new ResponseJournal(store.directoryFor(task.id),responseId);journal.update('Final correcto');journal.close();
 task.conversation.push({id:responseId,role:'assistant',content:'Final correcto'});task.status='complete';store.save();
 const recovered=new Store(directory).task(task.id);assert.equal(recovered.status,'complete');assert.equal(recovered.conversation.length,2);assert.equal(recovered.conversation.at(-1).recovered,undefined);
});
test('provider id and reported cost recover into the latest interrupted attempt only',async t=>{
 const {store,task,directory}=await setup(t);const responseId=crypto.randomUUID();
 task.calls=[{id:'failed-local',responseId,status:'failed',cost:null},{id:'retry-local',responseId,status:'pending',cost:null}];task.status='running';store.save();
 const journal=new ResponseJournal(store.directoryFor(task.id),responseId);journal.call({id:'gen-retry',responseId,input:100,output:8,cached:80,cost:.002,reasoning_details:'never persist',Authorization:'never persist'});journal.close();
 const content=await fs.readFile(journal.filename,'utf8');assert.ok(!content.includes('never persist'));
 const recovered=new Store(directory).task(task.id);assert.equal(recovered.calls[0].cost,null);assert.equal(recovered.calls[1].cost,.002);assert.equal(recovered.calls[1].id,'gen-retry');assert.equal(recovered.calls[1].status,'interrupted');assert.equal(recovered.telemetry.unknownCosts,1);assert.equal(recovered.conversation.length,1);
});
test('a local response journal failure does not trigger an extra provider request',async t=>{
 const {store,runtime,task}=await setup(t);let requests=0;const original=ResponseJournal.prototype.write;
 t.after(()=>{ResponseJournal.prototype.write=original;});ResponseJournal.prototype.write=()=>{throw new Error('Synthetic disk failure');};
 runtime.request=async()=>{requests++;return new Response('data: {"id":"gen-disk","choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});};
 await assert.rejects(runtime.run(task,new AbortController().signal),/Synthetic disk failure/);assert.equal(requests,1);
 assert.equal(store.task(task.id).calls[0].status,'failed');
});
test('hard termination of a real child process recovers text and usage without executing partial tools',async t=>{
 const {directory}=await setup(t);const childDirectory=path.join(directory,'child');
 const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/stream-crash.mjs',import.meta.url)),childDirectory],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);const exited=new Promise(resolve=>child.once('exit',resolve));
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;});
 await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Child did not produce text: '+stderr)),10000);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('READY')){clearTimeout(timer);resolve();}});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);if(!output.includes('READY'))reject(new Error('Child exited early: '+stderr));});});
 child.kill('SIGKILL');await exited;
 const recovered=new Store(childDirectory).state.tasks[0];assert.equal(recovered.status,'paused');assert.match(recovered.conversation.at(-1).content,/Texto recuperable: español y emoji 🧪/);assert.equal(recovered.messages.length,1);assert.equal(recovered.effects.length,0);assert.equal(recovered.calls[0].id,'gen-synthetic-crash-917');assert.equal(recovered.calls[0].status,'interrupted');assert.equal(recovered.telemetry.cost,.001);
 assert.equal(new Store(childDirectory).state.tasks[0].conversation.length,2);
});
test('compression advice distinguishes short contexts, threshold and growth without promising savings',()=>{
 const settings={contextWindow:50000,compressionPercent:95};
 assert.equal(contextAdvice({contextTokens:4000},settings).short,true);
 assert.equal(contextAdvice({contextTokens:48000},settings).short,false);
 assert.equal(contextAdvice({contextTokens:NaN},settings).current,null);
 assert.equal(contextAdvice({contextTokens:900,lastCompression:{before:1000,after:1100}},settings).saved.tokens,-100);
 assert.equal(contextAdvice({lastCompression:{before:0,after:5}},settings).saved,null);
 assert.equal(contextAdvice({},settings).threshold,47500);
});
