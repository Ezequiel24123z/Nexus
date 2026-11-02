import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {arliModel,modelConnection,completionRequest,providerCatalog,checkArliConnection} from '../core/providers.mjs';
import {requestTools} from '../core/model-request.mjs';
import {Store} from '../core/store.mjs';
import {Runtime} from '../core/runtime.mjs';
import {networkFailure} from '../core/provider-errors.mjs';

const settings={streaming:true,reasoningEffort:'max',providerRouting:'price',webSearchEnabled:true,desktopEnabled:false,model:arliModel};

test('Arli requests use their exact model ID, reasoning, usage and tool parameters without router extensions',()=>{
 const tools=requestTools(settings);
 const spec=completionRequest({model:arliModel,messages:[{role:'user',content:'Test'}],settings,tools,outputLimit:12000,sessionId:'private-session'});
 assert.equal(spec.connection.key,'ARLIAI_API_KEY');assert.equal(spec.body.model,'DeepSeek-V4.1-Flash-1017');
 assert.equal(spec.body.reasoning_effort,'max');assert.equal(spec.body.tool_choice,'auto');assert.equal(spec.body.max_completion_tokens,12000);
 assert.deepEqual(spec.body.stream_options,{include_usage:true});assert.equal(spec.body.include_reasoning,false);
 for(const key of ['reasoning','provider','session_id','max_tokens'])assert.equal(spec.body[key],undefined);
 assert.ok(!tools.some(t=>t.type==='openrouter:web_search'));assert.ok(!tools.some(t=>t.function?.name.startsWith('desktop_')));
 assert.equal(spec.headers['X-OpenRouter-Title'],undefined);
});

test('existing OpenRouter model IDs and request features remain available',()=>{
 const s={...settings,model:'deepseek/deepseek-v4.1-flash'};
 const spec=completionRequest({model:s.model,messages:[],settings:s,tools:requestTools(s),outputLimit:100,sessionId:'opaque'});
 assert.equal(spec.connection.key,'OPENROUTER_API_KEY');assert.equal(spec.body.model,s.model);
 assert.deepEqual(spec.body.reasoning,{effort:'max'});assert.equal(spec.body.provider.sort,'price');assert.equal(spec.body.session_id,'opaque');
 assert.ok(spec.body.tools.some(t=>t.type==='openrouter:web_search'));assert.equal(spec.body.max_tokens,100);
});

test('provider catalog excludes offline models and distinguishes plan limits from native model context',async()=>{
 const list=await providerCatalog('arliai',{request:async url=>{
  assert.equal(url,'https://api.arliai.com/model/all');
  return Response.json([{name:'GLM-4.6-Derestricted-v5',status:true,contextSize:'202752',vlm:false,reasoning:true,parameters:'355B'},
   {name:'DeepSeek-V4.1-Flash-1017',status:true,contextSize:'524288',vlm:true,reasoning:true,parameters:'552B'},
   {name:'Offline',status:false}]);
 }});
 assert.equal(list.length,2);assert.equal(list[0].id,arliModel);assert.equal(list[0].context_length,524288);
 assert.ok(list[0].architecture.input_modalities.includes('image'));assert.ok(list[1].supported_parameters.includes('tools'));
 assert.equal(list[1].architecture.input_modalities.includes('image'),false);assert.equal(list[1].pricing.prompt,undefined);
});

test('connection validation uses only account catalog and never generates text or returns credentials',async()=>{
 const result=await checkArliConnection('test-arli-secret',{request:async(url,options)=>{
  assert.equal(url,'https://api.arliai.com/v1/models');assert.equal(options.headers.Authorization,'Bearer test-arli-secret');
  assert.equal(options.method,undefined);return Response.json({data:[{id:'DeepSeek-V4.1-Flash-1017',context_length:131072}]});
 }});
 assert.equal(result.models[0].context,131072);assert.ok(!JSON.stringify(result).includes('secret'));
 await assert.rejects(checkArliConnection('key',{request:async()=>new Response('private provider detail',{status:401})}),/401/);
});

async function fixture(t,getSecret,request){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-arli-'));const store=new Store(dir);
 const runtime=new Runtime(store,{getSecret,request});runtime.closed=true;
 t.after(()=>{runtime.shutdown();store.close();return fs.rm(dir,{recursive:true,force:true});});
 return {dir,store,runtime};
}

test('Arli streaming tool round trip remains on Arli when global model changes to OpenRouter',async t=>{
 let count=0;
 const {dir,store,runtime}=await fixture(t,name=>name==='ARLIAI_API_KEY'?'test-arli-secret':null,async(url,options)=>{
  const body=JSON.parse(options.body);assert.equal(url,'https://api.arliai.com/v1/chat/completions');
  assert.equal(options.headers.Authorization,'Bearer test-arli-secret');assert.equal(body.model,'DeepSeek-V4.1-Flash-1017');
  assert.equal(body.tool_choice,'auto');assert.ok(!body.tools.some(t=>t.type==='openrouter:web_search'));
  const frames=++count===1?[
   {choices:[{delta:{tool_calls:[{index:0,id:'files-1',type:'function',function:{name:'list_files',arguments:'{"path":"."}'}}]}}]},
   {choices:[{delta:{},finish_reason:'tool_calls'}]}]:[
   {choices:[{delta:{content:'Verified file listing.'}}]},
   {choices:[{delta:{},finish_reason:'stop'}]},
   {choices:[],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}}];
  return new Response(frames.map(data=>'data: '+JSON.stringify(data)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 });
 store.state.settings={...store.state.settings,...settings};
 const id=runtime.create({prompt:'List files',workspace:dir}),task=store.task(id);
 store.state.settings.model='deepseek/deepseek-v4.1-flash';
 await runtime.run(task,new AbortController().signal);
 assert.equal(count,2);assert.equal(task.engine,'arliai');assert.equal(task.model,arliModel);
 assert.ok(task.messages.some(m=>m.role==='tool'));assert.match(task.conversation.at(-1).content,/Verified/);
 assert.equal(task.calls.at(-1).input,100);assert.equal(task.calls.at(-1).cost,null);
 const restored=new Store(dir);assert.equal(restored.task(id).model,arliModel);restored.close();
});

test('Arli never falls back to a saved OpenRouter key and credential status follows the selected service',async t=>{
 let requested=false;
 const {store,runtime}=await fixture(t,name=>name==='OPENROUTER_API_KEY'?'router-key':null,async()=>{requested=true;});
 store.state.settings.model=arliModel;const id=runtime.create({prompt:'Test'});
 await assert.rejects(runtime.completion([],store.task(id),new AbortController().signal),/clave de Arli.ai/);
 assert.equal(requested,false);assert.equal(runtime.snapshot().hasKey,false);assert.equal(runtime.snapshot().providerKeys.openrouter,true);
});

test('GLM model resolves to Arli while unprefixed model IDs retain OpenRouter routing',()=>{
 assert.equal(modelConnection('arliai/GLM-4.6-Derestricted-v5').model,'GLM-4.6-Derestricted-v5');
 assert.equal(modelConnection('z-ai/glm-4.6').id,'openrouter');
});

test('a connection reset retries once with separate unknown-cost accounting and the same provider',async t=>{
 let calls=0;
 const {runtime,store}=await fixture(t,()=> 'private-test-key',async(url,options)=>{
  assert.equal(url,'https://api.arliai.com/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer private-test-key');
  if(++calls===1)throw new TypeError('fetch failed',{cause:Object.assign(new Error('private diagnostic'),{code:'ECONNRESET'})});
  return Response.json({choices:[{message:{content:'Recovered'}}],usage:{prompt_tokens:100,completion_tokens:5}});
 });
 store.state.settings.model=arliModel;const task=store.task(runtime.create({prompt:'Connectivity test'}));
 const result=await runtime.completion([],task,new AbortController().signal);
 assert.equal(result.message.content,'Recovered');assert.equal(calls,2);assert.equal(task.calls.length,2);
 assert.equal(task.calls[0].status,'failed');assert.equal(task.calls[1].status,'complete');assert.equal(task.calls[1].retryOf,task.calls[0].id);
 assert.equal(task.telemetry.unknownCosts,2);assert.equal(task.telemetry.cost,null);
});

test('persistent fetch failures stop after one retry with a readable and sanitized explanation',async t=>{
 let calls=0;
 const {runtime,store}=await fixture(t,()=> 'private-test-key',async()=>{calls++;throw new TypeError('fetch failed',{cause:Object.assign(new Error('private-test-key'),{code:'UND_ERR_SOCKET'})});});
 store.state.settings.model=arliModel;const task=store.task(runtime.create({prompt:'Test'}));
 await assert.rejects(runtime.completion([],task,new AbortController().signal),error=>{
  assert.match(error.message,/No se pudo conectar con Arli.ai/);assert.match(error.message,/mensaje se conserva/);
  assert.ok(!error.message.includes('private-test-key'));assert.ok(!error.message.includes('fetch failed'));return true;
 });
 assert.equal(calls,2);assert.equal(task.calls.length,2);
});

test('HTTP 503 retries once while invalid credentials fail without retry',async t=>{
 let calls=0;
 const {runtime,store}=await fixture(t,()=> 'key',async()=>{calls++;return new Response('provider private body',{status:503});});
 store.state.settings.model=arliModel;const task=store.task(runtime.create({prompt:'Test'}));
 await assert.rejects(runtime.completion([],task,new AbortController().signal),/HTTP 503.*temporalmente/);assert.equal(calls,2);
 calls=0;runtime.request=async()=>{calls++;return new Response('provider private body',{status:401});};
 await assert.rejects(runtime.completion([],task,new AbortController().signal),/clave no fue aceptada/);assert.equal(calls,1);
});

test('a broken stream after visible output is preserved without replaying the request',async t=>{
 let calls=0;
 const {runtime,store}=await fixture(t,()=> 'key',async()=>{
  calls++;
  const body=new ReadableStream({start(controller){
   controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'Partial preserved'}}]})+'\n\n'));
   setTimeout(()=>controller.error(new TypeError('terminated',{cause:Object.assign(new Error('closed'),{code:'UND_ERR_SOCKET'})})),10);
  }});
  return new Response(body,{headers:{'content-type':'text/event-stream'}});
 });
 store.state.settings.model=arliModel;const task=store.task(runtime.create({prompt:'Test'}));
 await assert.rejects(runtime.completion([],task,new AbortController().signal),/No se pudo conectar/);
 assert.equal(calls,1);assert.match(task.conversation.at(-1).content,/Partial preserved/);
});

test('certificate failures are explained and never retried or bypassed',async t=>{
 let calls=0;
 const error=new TypeError('fetch failed',{cause:Object.assign(new Error('certificate details'),{code:'CERT_HAS_EXPIRED'})});
 const {runtime,store}=await fixture(t,()=> 'key',async()=>{calls++;throw error;});
 store.state.settings.model=arliModel;const task=store.task(runtime.create({prompt:'Test'}));
 await assert.rejects(runtime.completion([],task,new AbortController().signal),/verificar el certificado/);assert.equal(calls,1);
 assert.ok(!networkFailure(error,'Arli.ai').message.includes('certificate details'));
});
