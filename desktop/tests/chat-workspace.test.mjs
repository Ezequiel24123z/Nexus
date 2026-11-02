import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {Store} from '../core/store.mjs';
import {Runtime} from '../core/runtime.mjs';
import {searchConversation,conversationWindow,taskResults,previewTaskResult} from '../core/chat-workspace.mjs';
import {validateModelCapabilities} from '../core/chat-options.mjs';
import {executeTool} from '../core/tools.mjs';
import {materializeToolResult} from '../core/artifacts.mjs';

async function setup(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-chat-workspace-'));t.after(async()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(directory,{recursive:true,force:true});});const store=new Store(directory),runtime=new Runtime(store,{getSecret:()=> 'synthetic-test'});runtime.closed=true;const task=store.task(runtime.create({prompt:'Prueba',workspace:directory}));return {store,runtime,task,directory};}

test('search includes old messages, literal symbols, pagination and no reasoning payload',()=>{
 const task={conversation:Array.from({length:1000},(_,i)=>({id:String(i),role:'user',content:'Mensaje '+i+' [literal]',reasoning:'NOT_SEARCHABLE'}))};
 let page=searchConversation(task,'[LITERAL]',{limit:3});assert.equal(page.total,1000);assert.equal(page.items[0].id,'0');assert.equal(page.next,3);assert.equal(JSON.stringify(page).includes('NOT_SEARCHABLE'),false);
 assert.equal(searchConversation(task,'NOT_SEARCHABLE').total,0);assert.equal(searchConversation(task,' ').total,0);assert.equal(searchConversation(task,'mensaje',{offset:998,limit:50}).next,null);
 assert.throws(()=>searchConversation(task,'x'.repeat(501)),/500/);
});
test('message windows are bounded and can reach both ends without silently dropping ranges',()=>{
 const task={conversation:Array.from({length:1000},(_,i)=>({id:String(i),content:'message'}))};
 const page=conversationWindow(task,'20');assert.equal(page.start,0);assert.equal(page.end,120);assert.equal(page.total,1000);assert.equal(page.items[20].id,'20');
 const tail=conversationWindow(task,'999');assert.equal(tail.end,1000);assert.equal(tail.items.at(-1).id,'999');assert.throws(()=>conversationWindow(task,'missing'),/not found/);
});
test('result index includes only recorded changes, durable outputs and valid source origins',()=>{
 const task={conversation:[{id:'m',sources:[{url:'https://example.com',title:'Fuente'},{url:'file:///secret'},{url:'https://user:pass@example.com'}]}],events:[{id:'attempt',kind:'write_intent',detail:{path:'not-written'}},{id:'e1',kind:'file_change',detail:{path:'a.txt',reason:'first'}},{id:'e2',kind:'file_change',detail:{path:'a.txt',reason:'last'}},{id:'p',kind:'progress',detail:{verification:'not independently verified'}}]};
 const page=taskResults(task);assert.equal(page.total,3);assert.equal(page.items.find(x=>x.kind==='file').id,'e2');assert.equal(page.items.find(x=>x.kind==='source').messageId,'m');assert.equal(page.items.some(x=>x.name==='not-written'),false);assert.equal(taskResults(task,{limit:1}).next,1);
});
test('result previews use recorded ids, stay bounded and do not treat binaries as text',async t=>{
 const {store,runtime,task,directory}=await setup(t);await executeTool(runtime,task,'write_file',{path:'result.txt',content:'contenido '.repeat(3000),reason:'test'},new AbortController().signal);
 const item=taskResults(task).items[0];const preview=await previewTaskResult(store,task,item.id);assert.ok(Buffer.byteLength(preview.content)<=12000);assert.match(preview.note,/partial/);
 await assert.rejects(previewTaskResult(store,task,'../workspace.json'),/not found/);
 await fs.writeFile(path.join(directory,'result.txt'),Buffer.from([0,1,2]));assert.equal((await previewTaskResult(store,task,item.id)).content,undefined);
 const a=await materializeToolResult(store,task,'run_command',{text:'x'.repeat(15000)});const event=store.journal(task,'tool_result',{name:'run_command',result:a.journal});assert.equal((await previewTaskResult(store,task,event.id)).content.length,12000);
});
test('chat model settings persist without changing defaults or another chat',async t=>{
 const {runtime,store,task,directory}=await setup(t);const other=store.task(runtime.create({prompt:'Other'}));const original=store.state.settings.reasoningEffort;
 runtime.updateChat({id:task.id,model:'manual/test',reasoningEffort:'high',providerRouting:'price'});
 assert.equal(task.reasoningEffort,'high');assert.equal(other.reasoningEffort,undefined);assert.equal(store.state.settings.reasoningEffort,original);assert.equal(new Store(directory).task(task.id).providerRouting,'price');
 runtime.settings({favoriteModels:['manual/test','manual/test']});assert.deepEqual(store.state.settings.favoriteModels,['manual/test']);
});
test('invalid chat updates are atomic and active calls cannot change model or reasoning',async t=>{
 const {runtime,task}=await setup(t);const original=task.model;
 assert.throws(()=>runtime.updateChat({id:task.id,model:'changed',reasoningEffort:'invented'}));assert.equal(task.model,original);
 assert.throws(()=>runtime.updateChat({id:task.id,model:'changed',projectId:'missing'}));assert.equal(task.model,original);
 runtime.active.set(task.id,new AbortController());assert.throws(()=>runtime.updateChat({id:task.id,reasoningEffort:'high'}),/Pause/);assert.equal(task.reasoningEffort,undefined);runtime.active.clear();
 runtime.compacting.add(task.id);assert.throws(()=>runtime.updateChat({id:task.id,model:'changed'}),/Pause/);runtime.compacting.clear();
});
test('per-chat thinking and provider preferences reach provider payload; compression effort stays explicit',async t=>{
 const {runtime,task,store}=await setup(t);store.state.settings.streaming=false;
 runtime.updateChat({id:task.id,model:'manual/test',reasoningEffort:'high',providerRouting:'price'});const requests=[];
 runtime.request=async(_,options)=>{requests.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{content:'OK'}}],usage:{prompt_tokens:3,completion_tokens:1,total_tokens:4}}),{headers:{'Content-Type':'application/json'}});};
 await runtime.completion([{role:'user',content:'test'}],task,new AbortController().signal);assert.equal(requests[0].reasoning.effort,'high');assert.equal(requests[0].provider.sort,'price');assert.equal(requests[0].model,'manual/test');assert.equal(requests[0].max_tokens,undefined);
 await runtime.completion([{role:'user',content:'summary'}],task,new AbortController().signal,{tools:false,effort:'none'});assert.equal(requests[1].reasoning.effort,'none');
 runtime.updateChat({id:task.id,reasoningEffort:null,providerRouting:null});assert.equal(task.reasoningEffort,null);
});
test('known model capabilities reject unsupported tools and thinking but allow manual unknown models',()=>{
 assert.throws(()=>validateModelCapabilities({reasoningEffort:'none'},{supported_parameters:['tools'],reasoning:{mandatory:true}}));
 assert.throws(()=>validateModelCapabilities({reasoningEffort:'high'},{supported_parameters:['tools'],reasoning:{supported_efforts:['low']}}));
 assert.throws(()=>validateModelCapabilities({},{supported_parameters:['temperature']}));
 assert.doesNotThrow(()=>validateModelCapabilities({reasoningEffort:'high'},undefined));
});
test('search benchmark: 10,000 synthetic messages, bounded payload, measured not claimed as UI latency',t=>{
 const task={conversation:Array.from({length:10000},(_,i)=>({id:String(i),role:'assistant',content:('Texto sintético de prueba '+i+' ').repeat(20)+(i%9===0?'aguja':'')}))};const samples=[];
 for(let n=0;n<25;n++){const start=performance.now();const page=searchConversation(task,'aguja');samples.push(performance.now()-start);assert.equal(page.items.length,30);assert.ok(JSON.stringify(page).length<25000);}
 samples.sort((a,b)=>a-b);t.diagnostic(JSON.stringify({messages:10000,samples:25,p50ms:samples[12],p95ms:samples[23]}));
});
