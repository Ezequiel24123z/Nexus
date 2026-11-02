import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/store.mjs';
import {Runtime} from '../core/runtime.mjs';
import {inspectContext,contextSection,inspectCosts,previewCheckpoint} from '../core/context-inspector.mjs';
import {requestTools,affinitySession} from '../core/model-request.mjs';
import {aggregateUsage} from '../core/telemetry.mjs';

async function setup(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-inspector-'));t.after(async()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(directory,{recursive:true,force:true});});const store=new Store(directory),runtime=new Runtime(store,{getSecret:()=>{throw new Error('No credential access during inspection');}});runtime.closed=true;const task=store.task(runtime.create({prompt:'Objetivo de prueba',workspace:directory}));return {directory,store,runtime,task};}
const reply=(content='Respuesta verificada suficientemente extensa.',usage={prompt_tokens:100,completion_tokens:20,total_tokens:120,cost:0})=>new Response(JSON.stringify({id:'fixture-'+Math.random(),choices:[{message:{content},finish_reason:'stop'}],usage}),{headers:{'Content-Type':'application/json'}});
test('inspection matches unhydrated outgoing context without changing it or reading secrets',async t=>{
 const {runtime,task,store}=await setup(t);task.summary='Estado conservado';task.messages=[{role:'user',content:'Consulta reciente'},{role:'assistant',content:'Respuesta',reasoning_details:[{text:'PRIVATE_REASONING'}]}];task.conversation.push({id:'pinned',role:'user',content:'DECISION_FIJADA',pinned:true});
 const before=JSON.stringify(task),context=runtime.buildContext(task,{hydrate:false}),report=inspectContext(runtime,task);
 assert.equal(report.total,runtime.estimate(task,context)+runtime.estimate(task,requestTools(store.state.settings)));
 assert.deepEqual(runtime.buildContext(task,{hydrate:false,inspect:true}).messages,context);assert.equal(JSON.stringify(task),before);
 assert.ok(report.sections.some(section=>section.id==='pins'));assert.ok(report.sections.some(section=>section.id==='summary'));assert.ok(report.sections.some(section=>section.id==='latest'));
 assert.ok(!JSON.stringify(report).includes('DECISION_FIJADA'));assert.equal(report.affinity,false);
 const detail=contextSection(runtime,task,{fingerprint:report.fingerprint,section:'history-assistant'});assert.ok(!detail.content.includes('PRIVATE_REASONING'));
});
test('tool estimates and actual request share desktop and web configuration',async t=>{
 const {runtime,task,store}=await setup(t);store.state.settings.desktopEnabled=false;store.state.settings.webSearchEnabled=true;store.state.settings.streaming=false;
 const tools=requestTools(store.state.settings),report=inspectContext(runtime,task);assert.ok(!tools.some(tool=>tool.function?.name.startsWith('desktop_')));assert.equal(tools.at(-1).type,'openrouter:web_search');
 assert.equal(report.sections.find(section=>section.id==='tools').count,tools.length);
 runtime.getSecret=()=> 'synthetic-key';let body;runtime.request=async(_,options)=>{body=JSON.parse(options.body);return reply();};await runtime.completion(runtime.buildContext(task),task,new AbortController().signal);
 assert.deepEqual(body.tools,tools);assert.equal(body.session_id,undefined);assert.equal(body.max_tokens,undefined);
});
test('context previews are bounded and refuse a stale snapshot after a context edit',async t=>{
 const {runtime,task}=await setup(t);task.messages=[{role:'user',content:'x'.repeat(16000)}];const report=inspectContext(runtime,task);
 const args={section:'history-user',fingerprint:report.fingerprint},first=contextSection(runtime,task,args);assert.equal(first.content.length,6000);assert.equal(first.next,6000);
 const second=contextSection(runtime,task,{...args,offset:first.next});assert.equal(second.offset,6000);assert.equal(second.content.length,6000);
 task.messages.push({role:'user',content:'Cambio'});assert.throws(()=>contextSection(runtime,task,args),/cambió/);
});
test('image previews omit binary data without hydrating attachment references',async t=>{
 const {runtime,task}=await setup(t);task.messages=[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,DO_NOT_RENDER_BINARY'}},{type:'nexus_attachment',attachment:{id:'missing-file',kind:'image',name:'fixture.png'}}]}];
 const report=inspectContext(runtime,task),detail=contextSection(runtime,task,{fingerprint:report.fingerprint,section:'history-user'});assert.ok(!detail.content.includes('DO_NOT_RENDER_BINARY'));assert.ok(detail.content.includes('fixture.png'));
});
test('cost groups distinguish compression, retries and unknown costs without double counting',()=>{
 const task={calls:[{id:'a',kind:'generation',input:100,cached:80,cost:.02,status:'complete'},{id:'b',kind:'compression',input:50,cached:0,cost:.01,status:'complete'},{id:'c',kind:'generation',cost:null,retried:true,status:'failed'},{id:'d',kind:'generation',input:0,cached:0,cost:0,status:'complete'}]};
 const report=inspectCosts(task);assert.equal(report.total.cost,.03);assert.equal(report.total.unknownCosts,1);assert.equal(report.total.uncached,70);assert.equal(report.total.cacheHitRate,80/150);assert.equal(report.total.cacheCoverage,.75);assert.equal(report.retries.calls,1);assert.equal(report.retries.cost,null);assert.equal(report.groups.find(group=>group.kind==='compression').cost,.01);
});
test('cost pages read full history rather than the last UI snapshot and detect live changes',()=>{
 const task={calls:Array.from({length:101},(_,i)=>({id:String(i),kind:'generation',cost:0,input:10,cached:5,status:'complete'}))};const report=inspectCosts(task);
 assert.equal(report.total.calls,101);assert.equal(report.items.length,20);assert.equal(report.items[0].id,'100');
 assert.equal(inspectCosts(task,{offset:100,version:report.version}).items[0].id,'0');task.calls[100].cost=.2;assert.throws(()=>inspectCosts(task,{offset:20,version:report.version}),/cambió/);
});
test('invalid cache counters and costs are not presented as valid coverage or free usage',()=>{
 const result=aggregateUsage([{input:100,cached:150,cost:-1},{input:-2,cached:0,cost:'0'},{input:10,cached:5,cost:0}]);assert.equal(result.cacheHitRate,.5);assert.equal(result.cacheCoverage,1/3);assert.equal(result.cost,0);assert.equal(result.unknownCosts,2);
});
test('checkpoint preview is local, paged, redacts hidden reasoning and validates identifiers',async t=>{
 const {store,runtime,task}=await setup(t);task.messages=[{role:'assistant',content:'Verificado',reasoning_details:[{text:'PRIVATE_CHAIN'}]},{role:'user',content:[{type:'image_url',image_url:{url:'data:SECRET_BINARY'}}]}];
 store.checkpoint(task,'Resumen de continuidad',[], {before:9000,after:3000});
 const report=inspectContext(runtime,task);assert.equal(report.checkpoints[0].before,9000);
 const original=await previewCheckpoint(store,task,{checkpoint:1,section:'messages'});assert.ok(original.content.includes('Verificado'));assert.ok(!original.content.includes('PRIVATE_CHAIN'));assert.ok(!original.content.includes('SECRET_BINARY'));
 assert.equal((await previewCheckpoint(store,task,{checkpoint:1,section:'summary'})).content,'Resumen de continuidad');
 for(const checkpoint of [-1,'../workspace',2])await assert.rejects(previewCheckpoint(store,task,{checkpoint}),/válido/);
});
test('session affinity is opt-in, opaque, stable on restart and separates summaries',async t=>{
 const {runtime,task,store,directory}=await setup(t);runtime.settings({cacheAffinity:true,streaming:false});runtime.getSecret=()=> 'synthetic-key';const requests=[];runtime.request=async(_,options)=>{requests.push(JSON.parse(options.body));return reply();};
 await runtime.completion(runtime.buildContext(task),task,new AbortController().signal);
 await runtime.completion([{role:'user',content:'Resumir'}],task,new AbortController().signal,{tools:false});
 assert.equal(requests[0].session_id,affinitySession(task));assert.equal(requests[1].session_id,affinitySession(task,false));assert.notEqual(requests[0].session_id,requests[1].session_id);assert.ok(!requests[0].session_id.includes(directory));assert.ok(!requests[0].session_id.includes(task.prompt));assert.ok(task.calls.every(call=>call.sessionAffinity));
 store.save();const reopened=new Store(directory);assert.equal(reopened.state.settings.cacheAffinity,true);assert.equal(affinitySession(reopened.task(task.id)),requests[0].session_id);
});
test('compaction stores estimated before/after and its own reported cost with recoverable originals',async t=>{
 const {runtime,task,store}=await setup(t);store.state.settings.streaming=false;runtime.getSecret=()=> 'synthetic-key';runtime.request=async()=>reply('Objetivo: prueba. Hecho: conservar el nombre EXACTO-314. Siguiente: comprobar los originales.',{prompt_tokens:200,completion_tokens:25,total_tokens:225,cost:.003});
 task.messages=[{role:'user',content:'Conserva EXACTO-314. '+ 'material '.repeat(7000)}];
 task.lastInputTokens=49000;
 await runtime.compact(task,new AbortController().signal);
 assert.equal(task.lastCompression.cost,.003);assert.equal(task.lastCompression.unknownCosts,0);assert.ok(task.lastCompression.before>task.lastCompression.after);
 assert.equal(task.lastInputTokens,0);assert.equal(inspectContext(runtime,task).needsCompression,false);
 const checkpoint=inspectContext(runtime,task).checkpoints[0];assert.equal(checkpoint.before,task.lastCompression.before);assert.equal(checkpoint.after,task.lastCompression.after);
 assert.ok((await previewCheckpoint(store,task,{checkpoint:1,section:'messages'})).content.includes('EXACTO-314'));
});
test('an automatic transport retry preserves affinity and accounts for both attempts',async t=>{
 const {runtime,task}=await setup(t);runtime.settings({cacheAffinity:true,streaming:false});runtime.getSecret=()=> 'synthetic-key';const requests=[];
 runtime.request=async(_,options)=>{requests.push(JSON.parse(options.body));return requests.length===1?new Response('invalid JSON'):reply();};
 await runtime.completion(runtime.buildContext(task),task,new AbortController().signal);
 assert.equal(requests.length,2);assert.equal(requests[0].session_id,requests[1].session_id);assert.equal(task.calls[0].status,'failed');assert.equal(task.calls[1].retried,true);assert.equal(task.calls[1].sessionAffinity,true);
 const costs=inspectCosts(task);assert.equal(costs.total.calls,2);assert.equal(costs.total.unknownCosts,1);assert.equal(costs.retries.calls,1);
});
test('calibration uses the tools sent even when settings change during the request',async t=>{
 const {runtime,task,store}=await setup(t);store.state.settings.streaming=false;runtime.getSecret=()=> 'synthetic-key';const messages=runtime.buildContext(task),tools=requestTools(store.state.settings);
 const bytes=Buffer.byteLength(JSON.stringify({messages,tools}),'utf8'),promptTokens=Math.ceil(bytes/3.2);
 runtime.request=async()=>{runtime.settings({desktopEnabled:false});return reply('Respuesta de prueba',{prompt_tokens:promptTokens,completion_tokens:3,total_tokens:promptTokens+3,cost:0});};
 await runtime.completion(messages,task,new AbortController().signal);
 assert.equal(task.bytesPerToken,+(bytes/promptTokens).toFixed(3));assert.ok(requestTools(store.state.settings).length<tools.length);
});
