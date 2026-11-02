import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../core/store.mjs';
import { Runtime, estimateTokens } from '../core/runtime.mjs';
import { workspacePath, executeTool, command } from '../core/tools.mjs';
import {hydrateAttachmentReferences,materializeImageAttachment,materializeToolResult,readArtifact} from '../core/artifacts.mjs';

const reply = (content,tool_calls) => new Response(JSON.stringify({ choices:[{message:{content,tool_calls}}],usage:{prompt_tokens:100,total_tokens:120} }),{headers:{'Content-Type':'application/json'}});
const call = (name,args,id='call-1') => ({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const until = async predicate => {
  const start=Date.now();
  while(!predicate()) { if(Date.now()-start>10000)throw new Error('Timed out'); await new Promise(r=>setTimeout(r,10)); }
};

test('autonomy is default, has no step cap, and can write outside project with backup',async t=>{
 const {runtime,store,workspace,directory}=await setup(t);
 assert.equal(store.state.settings.maxSteps,0);assert.equal(runtime.needsApproval('run_command'),false);
 const id=runtime.create({prompt:'Test',workspace});await until(()=>!runtime.active.size);
 const target=path.join(directory,'outside.txt');await fs.writeFile(target,'before');
 const r=await executeTool(runtime,store.task(id),'write_file',{path:target,content:'after',reason:'explicit test'},new AbortController().signal);
 assert.equal(await fs.readFile(target,'utf8'),'after');assert.equal(await fs.readFile(r.backup,'utf8'),'before');
});
test('projects, editable instructions, pins and latest request survive compression and restart',async t=>{
 const {runtime,store,workspace}=await setup(t,async()=>reply('Continuidad suficiente: preservar decisiones, rutas y pruebas; comprobar los siguientes resultados.'));
 runtime.closed=true;
 const projectId=store.project({name:'Project',workspace,instructions:'Use exact project rule'});
 runtime.settings({globalInstructions:'My editable global rule'});
 const id=runtime.create({prompt:'Original prompt',projectId});const task=store.task(id);
 task.conversation[0].pinned=true;
 runtime.resume(id,'Most recent exact direction');
 await runtime.compact(task,new AbortController().signal);
 const context=JSON.stringify(runtime.buildContext(task));
 for(const text of ['My editable global rule','Use exact project rule','Original prompt','Most recent exact direction'])assert.ok(context.includes(text));
 assert.equal(task.telemetry.calls,1);assert.equal(task.calls[0].kind,'compression');
 assert.ok(task.lastCompression.after>0);
 const restored=new Store(store.directory);assert.equal(restored.task(id).conversation[0].pinned,true);assert.equal(restored.state.projects[0].id,projectId);
 const found=await executeTool(runtime,task,'search_history',{query:'Most recent exact'},new AbortController().signal);assert.equal(found.total,1);
});
test('session and final-turn cost include all tool calls and compaction without inventing missing cost',async t=>{
 let n=0;const {runtime,store,workspace}=await setup(t,async()=>new Response(JSON.stringify({choices:[{message:{content:'Done'}}],usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110,cost:++n*.01,prompt_tokens_details:{cached_tokens:50}}})));
 const id=runtime.create({prompt:'First',workspace});await until(()=>!runtime.active.size);
 runtime.resume(id,'Second');await until(()=>!runtime.active.size);
 const task=store.task(id);assert.ok(Math.abs(task.telemetry.cost-.03)<1e-9);assert.equal(task.lastTurnTelemetry.cost,.02);assert.equal(task.conversation.at(-1).telemetry.cost,.02);
 assert.equal(task.telemetry.cacheHitRate,.5);
});
test('a network failure records an unknown-cost attempt instead of claiming zero cost',async t=>{
 const {runtime,store}=await setup(t,async()=>{throw new Error('Network interrupted');});
 const id=runtime.create({prompt:'Network test'});await until(()=>!runtime.active.size);
 const task=store.task(id);assert.equal(task.status,'failed');assert.equal(task.telemetry.unknownCosts,1);assert.equal(task.telemetry.cost,null);assert.equal(task.calls[0].status,'failed');
});
test('output truncated by provider is retained but never declared complete',async t=>{
 const {runtime,store}=await setup(t,async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'Partial answer'}}],usage:{cost:.02}})));
 const id=runtime.create({prompt:'Truncated test'});await until(()=>!runtime.active.size);const task=store.task(id);
 assert.equal(task.status,'failed');assert.match(task.conversation.at(-1).content,/Partial answer/);assert.equal(task.telemetry.cost,.02);
});
test('oversized context is compacted in bounded chunks while originals remain checkpointed',async t=>{
 const requests=[];const {runtime,store,workspace}=await setup(t,async(_,options)=>{requests.push(JSON.parse(options.body));return reply('Continuidad: marcador NEXUS_BOUNDARY_MARKER, rutas, decisiones y pruebas conservadas con pendientes claros.');});
 runtime.closed=true;const id=runtime.create({prompt:'Compact',workspace});const task=store.task(id);
 task.messages.push({role:'user',content:Array.from({length:6000},(_,i)=>`unique_record_${i}_payload_${i*7919}`).join('\n')});
 await runtime.compact(task,new AbortController().signal);
 assert.ok(requests.length>2);assert.ok(task.events.some(e=>e.kind==='compression_chunked'));assert.equal(task.compressions,1);
 const checkpoint=JSON.parse(await fs.readFile(path.join(store.directoryFor(id),'checkpoint-1.json'),'utf8'));assert.match(checkpoint.messages.at(-1).content,/unique_record_5999/);
});
test('partial chunk summaries request enough bounded output to terminate cleanly',async t=>{
 const seen=[];const {runtime,store,workspace}=await setup(t,async(_,options)=>{seen.push(JSON.parse(options.body));return reply('Continuidad: rutas, decisiones, pruebas y pendientes claros.');});
 runtime.closed=true;const id=runtime.create({prompt:'Compact',workspace});const task=store.task(id);task.messages.push({role:'user',content:'payload '.repeat(30000)});
 await runtime.compact(task,new AbortController().signal);
 assert.ok(seen.some(body=>body.max_tokens===2000&&body.messages.at(-1).content.includes('Maximum 900 words')));
});
test('reasoning is disabled by default but remains user-configurable',async t=>{
 let body;const {runtime,store}=await setup(t,async(_,options)=>{body=JSON.parse(options.body);return reply('Done');});
 const id=runtime.create({prompt:'Reasoning mode'});await until(()=>!runtime.active.size);assert.equal(body.reasoning.effort,'none');
 runtime.settings({reasoningEffort:'low'});runtime.resume(id,'Again');await until(()=>!runtime.active.size);assert.equal(body.reasoning.effort,'low');assert.throws(()=>runtime.settings({reasoningEffort:'invalid'}));
});

test('zero output ceiling omits max_tokens while bounded compression calls retain their technical cap',async t=>{
 let body;const {runtime,store}=await setup(t,async(_,options)=>{body=JSON.parse(options.body);return reply('Done');});
 runtime.settings({maxOutput:0});const id=runtime.create({prompt:'Native output limit'});await until(()=>!runtime.active.size);
 assert.equal(body.max_tokens,undefined);assert.doesNotThrow(()=>runtime.settings({maxOutput:0}));
});
test('snapshot flags a legacy chat that will compact before its next model call',async t=>{
 const {runtime,store}=await setup(t);runtime.closed=true;store.state.settings.contextWindow=50000;store.state.settings.compressionPercent=95;
 const id=runtime.create({prompt:'Legacy long chat'});store.task(id).contextTokens=48000;
 assert.equal(runtime.snapshot().tasks.find(task=>task.id===id).needsCompression,true);
 store.task(id).contextTokens=47000;assert.equal(runtime.snapshot().tasks.find(task=>task.id===id).needsCompression,false);
});
test('three-byte context estimate avoids rejecting a cacheable long stable prefix',async t=>{
 const {runtime,store}=await setup(t,async()=>reply('Cache prefix accepted'));
 store.state.settings.contextWindow=50000;store.state.settings.compressionPercent=95;
 store.state.settings.globalInstructions='Stable instruction.\n'.repeat(2400);
 const id=runtime.create({prompt:'Tiny task'});await until(()=>!runtime.active.size);assert.equal(store.task(id).status,'complete');
});
test('requests opt into router metadata and retain the provider diagnostic',async t=>{
 const {runtime,store}=await setup(t,async(_,options)=>{assert.equal(options.headers['X-OpenRouter-Metadata'],'enabled');return new Response(JSON.stringify({id:'gen-test',openrouter_metadata:{provider:'test-provider'},choices:[{message:{content:'Done'}}],usage:{cost:.01}}));});
 const id=runtime.create({prompt:'Route metadata'});await until(()=>!runtime.active.size);assert.equal(store.task(id).calls[0].router.provider,'test-provider');
});
test('provider preference is optional, validated, and only sent for normal tool calls',async t=>{
 const bodies=[];const {runtime}=await setup(t,async(_,options)=>{bodies.push(JSON.parse(options.body));return reply('Done');});
 runtime.settings({providerRouting:'latency'});const id=runtime.create({prompt:'Prefer fastest compatible provider'});await until(()=>!runtime.active.size);
 assert.equal(bodies[0].provider.sort,'latency');assert.equal(bodies[0].provider.require_parameters,true);
 assert.throws(()=>runtime.settings({providerRouting:'unknown'}));
});
test('web search is an optional OpenRouter server tool with telemetry preserved',async t=>{
 let body;const {runtime,store}=await setup(t,async(_,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'Fuentes incluidas.'}}],usage:{cost:.01,server_tool_use:{web_search_requests:2}}}));});
 runtime.settings({webSearchEnabled:true,webSearchEngine:'exa',webSearchContext:'low',webMaxResults:7,webMaxUses:2});const id=runtime.create({prompt:'Busca información actual'});await until(()=>!runtime.active.size);
 const tool=body.tools.find(item=>item.type==='openrouter:web_search');assert.deepEqual(tool.parameters,{engine:'exa',max_results:7,search_context_size:'low',max_uses:2});assert.equal(store.task(id).telemetry.webSearchRequests,2);
 assert.throws(()=>runtime.settings({webSearchEngine:'invalid'}));assert.throws(()=>runtime.settings({webMaxResults:26}));
});
async function setup(t,request) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'nexus-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const store=new Store(path.join(directory,'data'));
  store.state.settings.model='test/model';
  const runtime=new Runtime(store,{getSecret:()=> 'test-secret',request:request || (async()=>reply('Done'))});
  t.after(()=>runtime.shutdown());
  const workspace=path.join(directory,'project'); await fs.mkdir(workspace);
  return {runtime,store,directory,workspace};
}

test('tool loop writes approved workspace file, keeps backup, and returns result to model',async t=>{
  let count=0;
  const env=await setup(t,async(_,options)=>{
    const body=JSON.parse(options.body);count++;
    if(count===1)return reply(null,[call('write_file',{path:'hello.txt',content:'after',reason:'test change'})]);
    assert.equal(body.messages.at(-1).role,'tool');
    assert.ok(JSON.parse(body.messages.at(-1).content).backup);
    return reply('Verified change');
  });
  await fs.writeFile(path.join(env.workspace,'hello.txt'),'before');
  env.store.state.settings.autoWorkspaceWrites=true;
  const id=env.runtime.create({prompt:'Update hello',workspace:env.workspace});
  await until(()=>!env.runtime.active.size);
  const task=env.store.task(id);
  assert.equal(task.status,'complete');
  assert.equal(await fs.readFile(path.join(env.workspace,'hello.txt'),'utf8'),'after');
  const change=task.events.find(e=>e.kind==='file_change');
  assert.equal(await fs.readFile(change.detail.backup,'utf8'),'before');
  assert.equal(task.steps,2);
});

test('rejected approval cannot execute a tool',async t=>{
  let count=0;
  const {runtime,store,workspace}=await setup(t,async()=>++count===1?reply(null,[call('write_file',{path:'blocked.txt',content:'bad',reason:'test'})]):reply('Denied respected'));
  store.state.settings.autonomous=false;store.state.settings.autoWorkspaceWrites=false;
  const id=runtime.create({prompt:'Try change',workspace});
  await until(()=>runtime.approvals.size===1);
  assert.equal(store.task(id).status,'approval');
  runtime.approve([...runtime.approvals.keys()][0],false);
  await until(()=>!runtime.active.size);
  await assert.rejects(fs.access(path.join(workspace,'blocked.txt')));
  assert.equal(store.task(id).status,'complete');
});

test('tasks run in parallel across projects, serialize within a project, and wait for dependencies',async t=>{
  const pending=[];
  const {runtime,store,workspace,directory}=await setup(t,(_,options)=>new Promise(resolve=>pending.push({body:JSON.parse(options.body),resolve})));
  const other=path.join(directory,'other');await fs.mkdir(other);
  const a=runtime.create({prompt:'A',workspace});
  const b=runtime.create({prompt:'B',workspace});
  const c=runtime.create({prompt:'C',workspace:other});
  const d=runtime.create({prompt:'D',dependsOn:[a]});
  await until(()=>pending.length===2);
  assert.equal(runtime.active.size,2);
  assert.equal(store.task(b).status,'queued');
  assert.equal(store.task(d).status,'queued');
  pending[0].resolve(reply('A result'));
  await until(()=>pending.length===4);
  const dependent=pending.find(p=>JSON.stringify(p.body.messages).includes('A result'));
  assert.ok(dependent);
  for(const item of pending.slice(1))item.resolve(reply('done'));
  await until(()=>!runtime.active.size);
  assert.ok([a,b,c,d].every(id=>store.task(id).status==='complete'));
});

test('compression keeps full checkpoint and transcript, passes continuity into next call',async t=>{
  let compressed=false;
  const {runtime,store,workspace}=await setup(t,async(_,options)=>{
    const body=JSON.parse(options.body);
    if(!body.tools){compressed=true;return reply('Decisión: preservar la ruta exacta src/domain.ts; test pendiente: verificar cálculo; siguiente paso: validar.');}
    assert.ok(JSON.stringify(body.messages).includes('src/domain.ts'));
    return reply('Continued from summary');
  });
  runtime.closed=true;
  const id=runtime.create({prompt:'Need continuity',workspace,dependsOn:[]});
  const task=store.task(id);
  task.messages.push({role:'user',content:'Detailed original '.repeat(2000)});
  store.save();
  await runtime.compact(task,new AbortController().signal);
  assert.ok(compressed);
  assert.equal(task.messages.length,0);
  assert.equal(task.compressions,1);
  const checkpoint=JSON.parse(await fs.readFile(path.join(store.directoryFor(id),'checkpoint-1.json'),'utf8'));
  assert.ok(checkpoint.messages.some(m=>m.content?.includes('Detailed original')));
  assert.ok(JSON.stringify(runtime.buildContext(task)).includes('src/domain.ts'));
  runtime.closed=false;runtime.resume(id);
  await until(()=>!runtime.active.size);
  assert.equal(task.status,'complete');
});

test('compaction keeps a recent user tail, preserves the stable prefix, and never sends stored reasoning',async t=>{
  const bodies=[];const {runtime,store,workspace,directory}=await setup(t,async(_,options)=>{bodies.push(JSON.parse(options.body));return reply('Estado de continuidad: cambios verificados, incertidumbres separadas y siguiente acción concreta.');});
  runtime.closed=true;const id=runtime.create({prompt:'Mantener continuidad',workspace});const task=store.task(id);
  const prefix=runtime.buildContext(task)[0].content;
  task.messages.push(
    {role:'user',content:'historial-antiguo '.repeat(9000)},
    {role:'assistant',content:'resultado anterior',reasoning_details:[{type:'reasoning.text',text:'reasoning-privado-no-reenviar'}]},
    {role:'user',content:'INSTRUCCION_RECIENTE_LITERAL'}
  );
  await runtime.compact(task,new AbortController().signal);
  assert.equal(runtime.buildContext(task)[0].content,prefix);
  assert.deepEqual(task.messages,[{role:'user',content:'INSTRUCCION_RECIENTE_LITERAL'}]);
  assert.ok(!JSON.stringify(bodies).includes('reasoning-privado-no-reenviar'));
  const checkpoint=JSON.parse(await fs.readFile(path.join(store.directoryFor(id),'checkpoint-1.json'),'utf8'));
  assert.ok(JSON.stringify(checkpoint.messages).includes('reasoning-privado-no-reenviar'),'el original local permanece recuperable');
  assert.equal(checkpoint.messages.length,4);
});

test('unsafe paths and directory junction escapes are denied',async t=>{
  const {workspace,directory}=await setup(t);
  await assert.rejects(workspacePath(workspace,'../outside.txt',true));
  const outside=path.join(directory,'outside');await fs.mkdir(outside);
  await fs.symlink(outside,path.join(workspace,'link'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(workspacePath(workspace,'link/file.txt',true));
  // Windows runners can expose TEMP through an 8.3 alias; workspacePath returns the real root.
  const canonicalWorkspace=await fs.realpath(workspace);
  assert.equal(await workspacePath(workspace,'new/sub/file.txt',true),path.join(canonicalWorkspace,'new','sub','file.txt'));
});

test('interrupted unfinished tool calls are not replayed when resuming',async t=>{
  const {runtime,store,workspace}=await setup(t,async(_,options)=>{
    const body=JSON.parse(options.body);
    assert.equal(body.messages.at(-1).role,'tool');
    assert.match(body.messages.at(-1).content,/Interrupted/);
    return reply('Inspected interrupted state');
  });
  runtime.closed=true;
  const id=runtime.create({prompt:'Do not replay',workspace});
  store.transcript(store.task(id),{role:'assistant',content:null,tool_calls:[call('write_file',{path:'no-replay.txt',content:'x',reason:'interrupted'})]});
  store.task(id).status='paused';
  runtime.closed=false;runtime.resume(id);
  await until(()=>!runtime.active.size);
  await assert.rejects(fs.access(path.join(workspace,'no-replay.txt')));
  assert.equal(store.task(id).status,'complete');
});

test('restart pauses formerly running work and keeps journal',async t=>{
  const {store,runtime,workspace}=await setup(t);
  runtime.closed=true;
  const id=runtime.create({prompt:'Restart',workspace});
  store.task(id).status='running';store.save();
  const restored=new Store(store.directory);
  assert.equal(restored.task(id).status,'paused');
  assert.equal(restored.task(id).events[0].kind,'created');
});

test('shell cancellation stops the child process',async()=>{
  const abort=new AbortController();
  const result=command(process.execPath,['-e','setTimeout(()=>{},60000)'],{signal:abort.signal,timeout:1000});
  abort.abort();
  await assert.rejects(result,/stopped/);
});

test('literal replace uses exact match and preserves dollar patterns',async t=>{
  const {runtime,store,workspace}=await setup(t);
  runtime.closed=true;const id=runtime.create({prompt:'replace',workspace});
  await fs.writeFile(path.join(workspace,'file.txt'),'hello world');
  await executeTool(runtime,store.task(id),'replace_text',{path:'file.txt',oldText:'world',newText:'$& $1',reason:'literal'},new AbortController().signal);
  assert.equal(await fs.readFile(path.join(workspace,'file.txt'),'utf8'),'hello $& $1');
});

test('image token estimation excludes base64 expansion',()=>{
  assert.ok(estimateTokens([{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,'+'a'.repeat(100000)}}]}])<3000);
});

test('desktop images are durable local attachments, not base64 in task state or checkpoints',async t=>{
  const {runtime,store,workspace}=await setup(t);runtime.closed=true;
  const id=runtime.create({prompt:'revisa la pantalla',workspace});const task=store.task(id);
  const source='data:image/png;base64,iVBORw0KGgo=';
  const attachment=await materializeImageAttachment(store,task,source,{dimensions:{image:{width:1,height:1}}});
  const message={role:'user',content:[{type:'text',text:'Pantalla actual'},{type:'nexus_attachment',attachment}]};
  store.transcript(task,message);
  const durable=JSON.stringify(store.state);
  assert.ok(!durable.includes(source),'workspace.json only keeps an attachment descriptor');
  assert.equal(task.messages.at(-1).content[1].type,'nexus_attachment');
  const outbound=JSON.stringify(runtime.buildContext(task));
  assert.ok(outbound.includes(source),'the model still receives the image when vision is needed');
  const hydrated=hydrateAttachmentReferences(store,task,message);
  assert.equal(hydrated.content[1].type,'image_url');
  assert.ok((await fs.stat(path.join(store.directoryFor(id),'attachments',attachment.id+'.png'))).size>0);
});

test('snapshots use bounded task pages while the durable history remains pageable',async t=>{
 const {runtime,store,workspace}=await setup(t);runtime.closed=true;
 const id=runtime.create({prompt:'pages',workspace});const task=store.task(id);
 task.conversation=Array.from({length:260},(_,index)=>({id:String(index),role:'user',content:'message '+index}));
 task.events=Array.from({length:180},(_,index)=>({id:String(index),kind:'event',detail:{index}}));
 const view=runtime.snapshot().tasks.find(t=>t.id===id);
 assert.equal(view.conversation.length,120);assert.equal(view.conversationStart,140);assert.equal(view.events.length,80);assert.equal(view.eventsStart,100);
 const older=runtime.page(id,'conversation',140,120);assert.equal(older.start,20);assert.equal(older.items[0].content,'message 20');assert.equal(older.hasMore,true);
 assert.throws(()=>runtime.page(id,'unknown',0,1));
});

test('outbound context never resends stored reasoning',async t=>{
  const {runtime,store,workspace}=await setup(t);runtime.closed=true;
  const id=runtime.create({prompt:'razonamiento',workspace});const task=store.task(id);
  task.messages.push(
    {role:'assistant',content:'respuesta visible',reasoning_details:[{type:'reasoning.text',text:'cadena-secreta-uno'}]},
    {role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'list_files',arguments:'{}'}}],reasoning_details:[{type:'reasoning.text',text:'cadena-secreta-dos'}]}
  );
  const context=JSON.stringify(runtime.buildContext(task));
  assert.ok(!context.includes('cadena-secreta'));
  assert.ok(context.includes('respuesta visible'));
  assert.ok(context.includes('list_files'));
});

test('compaction runs with reasoning disabled even when the chat uses max effort',async t=>{
  const bodies=[];
  const {runtime,store,workspace}=await setup(t,async(_,options)=>{bodies.push(JSON.parse(options.body));return reply('Resumen de continuidad suficientemente largo para pasar la validacion del compactador sin problemas.');});
  runtime.closed=true;
  runtime.settings({reasoningEffort:'max'});
  const id=runtime.create({prompt:'compacto',workspace});const task=store.task(id);
  task.conversation.push({id:'u1',role:'user',content:'instruccion'});
  task.messages.push({role:'user',content:'hola'},{role:'assistant',content:'mundo',reasoning_details:[{type:'reasoning.text',text:'razonamiento-largo'}]});
  await runtime.compact(task,new AbortController().signal);
  const compactions=bodies.filter(body=>!body.tools);
  assert.ok(compactions.length>=1);
  assert.ok(compactions.every(body=>body.reasoning&&body.reasoning.effort==='none'));
  const restored=new Store(store.directory);
  assert.ok(restored.task(id).summary.length>30);
  assert.equal(restored.task(id).messages.length,0);
});

test('a truncated compaction summary is continued by the model instead of being accepted as final',async t=>{
  const bodies=[];let calls=0;
  const truncated=()=>new Response(JSON.stringify({choices:[{message:{content:'Resumen parcial que alcanzó el límite de salida pero conserva decisiones, rutas, pruebas y pendientes relevantes.'},finish_reason:'length'}],usage:{prompt_tokens:100,total_tokens:120}}),{headers:{'Content-Type':'application/json'}});
  const {runtime,store,workspace,directory}=await setup(t,async(_,options)=>{bodies.push(JSON.parse(options.body));calls++;return truncated();});
  runtime.closed=true;const id=runtime.create({prompt:'Compact truncado',workspace});const task=store.task(id);
  task.messages.push({role:'user',content:'payload '.repeat(100)});
  await runtime.compact(task,new AbortController().signal);
  assert.equal(task.compressions,1);
  assert.equal(calls,3,'el compactador pide hasta dos continuaciones antes de rendirse');
  assert.match(JSON.stringify(bodies[1].messages),/Continue exactly where it stopped/,'la segunda llamada continúa el corte en lugar de aceptarlo');
  assert.ok(task.events.some(e=>e.kind==='compression_degraded'),'si aun así queda cortado se degrada, no se acepta en silencio');
  assert.equal(task.lastCompression.continuations,3);
  assert.match(task.summary,/Note: summary was truncated/);
  assert.ok(task.summary.includes('Resumen parcial'),'el texto parcial sigue disponible en el resumen');
  const checkpoint=JSON.parse(await fs.readFile(path.join(directory,'data','tasks',id,'checkpoint-1.json'),'utf8'));
  assert.equal(checkpoint.messages.length,2,'el prompt inicial y el mensaje original quedan íntegros en el checkpoint');
  assert.equal(checkpoint.messages.at(-1).content,'payload '.repeat(100));
});

test('a complete compaction summary is stored in one call without asking for a continuation',async t=>{
  let calls=0;
  const {runtime,store,workspace}=await setup(t,async()=>{calls++;return reply('Resumen de continuidad completo: objetivo, restricciones, decisiones, rutas exactas, cambios, pruebas y pendientes quedan documentados sin necesidad de continuar el texto.');});
  runtime.closed=true;const id=runtime.create({prompt:'Compact completo',workspace});const task=store.task(id);
  task.messages.push({role:'user',content:'payload'});
  await runtime.compact(task,new AbortController().signal);
  assert.equal(calls,1);assert.equal(task.lastCompression.continuations,0);
  assert.ok(!task.events.some(e=>e.kind==='compression_degraded'));
  assert.ok(!task.summary.includes('was truncated'));
});

test('read_checkpoint lists originals, pages fragments and needs no project folder',async t=>{
  const {runtime,store,directory}=await setup(t,async()=>reply('Resumen de continuidad suficientemente largo para pasar la validación del compactador sin problemas y con pendientes claros.'));
  runtime.closed=true;
  store.state.settings.autonomous=false;
  assert.equal(runtime.needsApproval('read_checkpoint'),false,'leer checkpoints es solo-lectura');
  const id=runtime.create({prompt:'checkpoints'});const task=store.task(id);
  task.messages.push({role:'user',content:'detalle-original-íntegro'});
  await runtime.compact(task,new AbortController().signal);
  const signal=new AbortController().signal;
  const listed=await executeTool(runtime,task,'read_checkpoint',{},signal);
  assert.deepEqual(listed.available,[1]);
  assert.equal(listed.checkpoints[0].messageCount,2);
  assert.ok(listed.checkpoints[0].summaryChars>30);
  const page=await executeTool(runtime,task,'read_checkpoint',{checkpoints:[1],offset:0,length:40},signal);
  assert.equal(page.content.length,40);assert.equal(page.next,40);assert.equal(page.section,'summary');
  const originals=await executeTool(runtime,task,'read_checkpoint',{checkpoints:[1],section:'messages',offset:0,length:20000},signal);
  assert.match(originals.content,/detalle-original-íntegro/);assert.equal(originals.next,null);
  assert.equal(originals.messageCount,2);
  const stored=JSON.parse(await fs.readFile(path.join(directory,'data','tasks',id,'checkpoint-1.json'),'utf8'));
  assert.equal(stored.messages.at(-1).content,'detalle-original-íntegro');
  task.messages.push({role:'user',content:'segundo-detalle-íntegro'});
  await runtime.compact(task,new AbortController().signal);
  const many=await executeTool(runtime,task,'read_checkpoint',{checkpoints:[2,2,1],offset:0,length:10},signal);
  assert.deepEqual(many.checkpoints.map(c=>c.checkpoint),[1,2],'los checkpoints repetidos se leen una sola vez y se ordenan');
  await assert.rejects(executeTool(runtime,task,'read_checkpoint',{checkpoints:[9]},signal),/not found/);
  await assert.rejects(executeTool(runtime,task,'read_checkpoint',{checkpoints:[0]},signal),/Invalid checkpoint list/);
  await assert.rejects(executeTool(runtime,task,'read_checkpoint',{checkpoints:[1],length:0},signal),/Invalid range/);
  await assert.rejects(executeTool(runtime,task,'read_checkpoint',{checkpoints:[1],section:'otros'},signal),/Invalid section/);
});

test('follow-ups sent while running are appended and delivered to the next step',async t=>{
  let release;const gate=new Promise(r=>release=r);const bodies=[];let calls=0;
  const {runtime,store,workspace}=await setup(t,async(_,options)=>{
    bodies.push(JSON.parse(options.body));calls++;
    if(calls===1){await gate;return reply(null,[call('list_files',{path:'.'},'c1')]);}
    if(calls===2)return reply(null,[call('list_files',{path:'.'},'c2')]);
    return reply('Final tras seguimiento');
  });
  const id=runtime.create({prompt:'follow',workspace});
  await until(()=>runtime.active.size===1);
  runtime.resume(id,'Seguimiento en caliente');
  const task=store.task(id);
  assert.ok(task.conversation.some(m=>m.content==='Seguimiento en caliente'));
  assert.ok(task.events.some(e=>e.kind==='user_followup'&&e.detail.whileRunning===true));
  release();
  await until(()=>!runtime.active.size&&store.task(id).status==='complete');
  assert.ok(bodies.some(b=>JSON.stringify(b.messages).includes('Seguimiento en caliente')));
  assert.equal(store.task(id).result,'Final tras seguimiento');
});

test('a transient provider cut before any output retries once',async t=>{
  let calls=0;
  const cut=()=>new Response(new ReadableStream({start(c){c.error(new Error('network reset'));}}),{headers:{'Content-Type':'text/event-stream'}});
  const {runtime,store}=await setup(t,async()=>{calls++;if(calls===1)return cut();return reply('Completado tras reintento');});
  const id=runtime.create({prompt:'retry'});
  await until(()=>!runtime.active.size);
  assert.equal(calls,2);
  assert.equal(store.task(id).status,'complete');
  assert.equal(store.task(id).result,'Completado tras reintento');
  assert.equal(store.task(id).calls.length,2);
  assert.equal(store.task(id).calls[0].status,'failed');
  assert.equal(store.task(id).calls[1].retryOf,store.task(id).calls[0].id);
});

test('an interrupted tool stream is not automatically requested again and executes no partial action',async t=>{
 let requests=0;
 const {runtime,store}=await setup(t,async()=>{requests++;return new Response('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'incomplete',function:{name:'write_file',arguments:'{"path":'}}]}}]})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});});
 const id=runtime.create({prompt:'Prueba de corte de herramientas'});await until(()=>!runtime.active.size);
 assert.equal(requests,1);assert.equal(store.task(id).status,'failed');assert.equal(store.task(id).effects.length,0);
});

test('invalid settings updates are atomic and cannot partially alter a running configuration',async t=>{
 const {runtime,store}=await setup(t);runtime.closed=true;
 const previous={...store.state.settings};
 assert.throws(()=>runtime.settings({contextWindow:80000,concurrency:0}));
 assert.deepEqual(store.state.settings,previous);
});

test('simultaneous manual compactions cannot bill twice or race the checkpoint',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve);let requests=0;
 const {runtime,store}=await setup(t,async()=>{requests++;await gate;return reply('Continuidad comprobada: preservar decisiones y pruebas; siguiente paso pendiente documentado.');});
 runtime.closed=true;const id=runtime.create({prompt:'Compactar una vez'});const task=store.task(id);
 const first=runtime.compact(task,new AbortController().signal);
 await assert.rejects(runtime.compact(task,new AbortController().signal),/already being compacted/);
 assert.equal(runtime.snapshot().tasks[0].compacting,true);
 release();await first;assert.equal(requests,1);assert.equal(task.compressions,1);assert.equal(runtime.compacting.size,0);
});

test('long session snapshots bound call history without losing totals or older records',async t=>{
 const {runtime,store}=await setup(t);runtime.closed=true;
 const id=runtime.create({prompt:'Historial largo'});const task=store.task(id);
 task.calls=Array.from({length:500},(_,index)=>({id:String(index),cost:.01}));
 const snapshot=runtime.snapshot().tasks[0];
 assert.equal(snapshot.calls.length,80);assert.equal(snapshot.callsTotal,500);assert.equal(snapshot.calls.at(-1).id,'499');
 assert.equal(runtime.page(id,'calls',420,80).items[0].id,'340');assert.equal(task.calls.length,500);
});

test('legacy images never enter compaction as base64 and image calls cannot train the text estimator',async t=>{
 const bodies=[];
 const {runtime,store}=await setup(t,async(_,options)=>{bodies.push(JSON.parse(options.body));return reply('Resumen: conservar el objetivo y la captura original del checkpoint. La tarea pendiente es verificar el siguiente paso.');});
 runtime.closed=true;const id=runtime.create({prompt:'Inspeccionar imagen'});const task=store.task(id);
 const image={role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,'+'a'.repeat(100000)}}]};
 task.messages.push(image);task.bytesPerToken=3;
 runtime.calibrate(task,[image],true,5000);assert.equal(task.bytesPerToken,3);
 assert.ok(estimateTokens({type:'nexus_attachment',attachment:{kind:'image',id:'test'}})>=2500);
 await runtime.compact(task,new AbortController().signal);
 assert.ok(!JSON.stringify(bodies).includes('data:image'));
 const original=JSON.parse(await fs.readFile(path.join(store.directoryFor(id),'checkpoint-1.json'),'utf8'));
 assert.equal(original.messages.at(-1).content[0].image_url.url,image.content[0].image_url.url);
});

test('streamed usage is merged across frames instead of erasing previously reported costs',async t=>{
 const frames=[{choices:[{delta:{content:'OK'}}],usage:{cost:.02,prompt_tokens:100}},{choices:[{delta:{},finish_reason:'stop'}],usage:{completion_tokens:10,total_tokens:110}}];
 const {runtime,store}=await setup(t,async()=>new Response(frames.map(frame=>'data: '+JSON.stringify(frame)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}));
 const id=runtime.create({prompt:'Coste fragmentado'});await until(()=>!runtime.active.size);
 const task=store.task(id);assert.equal(task.status,'complete');assert.equal(task.telemetry.cost,.02);assert.equal(task.telemetry.input,100);assert.equal(task.telemetry.output,10);
});

test('large external results become local artifacts instead of prompt-sized journal entries',async t=>{
  const {runtime,store,workspace}=await setup(t);runtime.closed=true;
  const id=runtime.create({prompt:'artifact',workspace});const task=store.task(id);
  const original={payload:'x'.repeat(30000),source:'test'};
  const item=await materializeToolResult(store,task,'invoke_mcp',original);
  assert.equal(item.journal.truncated,true);assert.ok(item.model.length<3000);assert.equal(item.artifact.bytes,Buffer.byteLength(JSON.stringify(original)));
  const page=await readArtifact(store,task,item.artifact.id,0,100);
  assert.match(page.content,/payload/);assert.equal(page.next,100);
});

test('external effects have a durable lifecycle and interrupted dispatch becomes uncertain on restart',async t=>{
 const {runtime,store,workspace}=await setup(t);runtime.closed=true;
 const id=runtime.create({prompt:'effects',workspace});const task=store.task(id);
 const effect=store.beginEffect(task,'invoke_connector',{name:'billing'});store.updateEffect(task,effect.id,'dispatched');store.save();
 const restored=new Store(store.directory);const recovered=restored.task(id).effects[0];
 assert.equal(recovered.status,'uncertain');assert.match(recovered.note,/Do not repeat/);
 const reconciled=await executeTool(runtime,task,'reconcile_effect',{id:effect.id,status:'confirmed',evidence:'GET /status devolvió el recurso esperado'},new AbortController().signal);
 assert.equal(reconciled.status,'confirmed');assert.match(reconciled.evidence,/GET/);
});

test('idempotent connectors reuse the effect id and can be reconciled or retried',async t=>{
 const requests=[];const {runtime,store,workspace}=await setup(t,async(url,options)=>{requests.push({url:String(url),options});return new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}});});
 runtime.closed=true;const id=runtime.create({prompt:'idempotent connector',workspace});const task=store.task(id);
 store.state.connectors.push({name:'orders',url:'https://api.example/orders',method:'POST',description:'Crea pedidos',idempotencyHeader:true,reconciliationUrl:'https://api.example/operations/{operationId}'});
 const effect=store.beginEffect(task,'invoke_connector',{name:'orders',input:{sku:'test'}});store.updateEffect(task,effect.id,'dispatched');
 const first=await runtime.invokeConnector(effect.args,new AbortController().signal,effect);
 assert.equal(first.idempotencyKey,effect.id);assert.equal(requests[0].options.headers['Idempotency-Key'],effect.id);
 store.updateEffect(task,effect.id,'uncertain',{note:'Corte simulado'});
 const verified=await runtime.verifyEffect(task,effect.id,new AbortController().signal);assert.equal(verified.status,'confirmed');assert.match(verified.evidence,/HTTP 200/);
 store.updateEffect(task,effect.id,'uncertain',{note:'Reintento simulado'});
 const retried=await runtime.retryEffect(task,effect.id,new AbortController().signal);assert.equal(retried.status,'observed');assert.equal(requests.at(-1).options.headers['Idempotency-Key'],effect.id);
});

test('long work receives a durable progress reminder without imposing a step limit',async t=>{
 const {runtime,store,workspace}=await setup(t);runtime.closed=true;
 const id=runtime.create({prompt:'Document progress',workspace});const task=store.task(id);task.steps=12;
 runtime.refreshProgressReminder(task);assert.equal(task.progressDue,true);assert.match(JSON.stringify(runtime.buildContext(task)),/Continuity reminder/);
 await executeTool(runtime,task,'document_progress',{decisions:'d',changes:'c',verification:'v',next:'n'},new AbortController().signal);
 assert.equal(task.progressDue,false);assert.equal(task.lastProgressStep,12);
});

test('follow-up consumption persists the drained queue with every transcript update',async t=>{
 const {runtime,store}=await setup(t);runtime.closed=true;
 const id=runtime.create({prompt:'Inicio'}),task=store.task(id);runtime.followup(task,'Primero');runtime.followup(task,'Segundo');
 const original=store.transcript.bind(store),snapshots=[];
 store.transcript=(...args)=>{original(...args);snapshots.push(new Store(store.directory).task(id));};
 runtime.flushFollowups(task);
 assert.deepEqual(snapshots[0].followupQueue,['Segundo']);assert.equal(snapshots[0].pendingFollowups,1);
 assert.deepEqual(snapshots[1].followupQueue,[]);assert.equal(snapshots[1].pendingFollowups,0);
 const restored=new Store(store.directory).task(id);runtime.flushFollowups(restored);
 for(const text of ['Primero','Segundo'])assert.equal(restored.messages.filter(message=>message.content===text).length,1);
});

test('failed transcript writes retain pending follow-ups and images in memory',async t=>{
 const {runtime,store}=await setup(t);runtime.closed=true;
 const task=store.task(runtime.create({prompt:'Inicio'}));runtime.followup(task,'Pendiente');task.pendingImages=[{name:'capture.png',id:'image'}];
 const count=task.messages.length;store.transcript=(task,message)=>{task.messages.push(message);throw new Error('Disk full');};
 assert.throws(()=>runtime.flushFollowups(task),/Disk full/);assert.equal(task.messages.length,count);assert.deepEqual(task.followupQueue,['Pendiente']);assert.equal(task.pendingFollowups,1);
 assert.throws(()=>runtime.flushPendingImages(task),/Disk full/);assert.equal(task.messages.length,count);assert.equal(task.pendingImages.length,1);
});

test('resume closes interrupted tool calls before delivering saved images and new instructions',async t=>{
 const {runtime,store}=await setup(t);runtime.closed=true;
 const id=runtime.create({prompt:'Inicio'}),task=store.task(id);
 store.transcript(task,{role:'assistant',content:null,tool_calls:[call('desktop_capture',{})]});
 task.pendingImages=[{id:'saved-capture',name:'capture.png',dimensions:{width:10,height:10},createdAt:'2026-09-17T10:00:00Z'}];store.save();
 runtime.resume(id,'Sigue con esto');
 assert.deepEqual(task.messages.map(message=>message.role),['user','assistant','tool','user','user']);
 assert.equal(task.messages[2].tool_call_id,'call-1');assert.match(task.messages[3].content[0].text,/2026-09-17/);assert.equal(task.messages[4].content,'Sigue con esto');
 const restored=new Store(store.directory).task(id);assert.deepEqual(restored.pendingImages,[]);runtime.flushPendingImages(restored);assert.equal(restored.messages.length,5);
});

test('pause cancels manual compression even when the provider returns a late response',async t=>{
 let release,started=false;const gate=new Promise(resolve=>release=resolve);
 const {runtime,store}=await setup(t,async()=>{started=true;await gate;return reply('Resumen tardío que nunca debe reemplazar el historial conservado.');});runtime.closed=true;
 const id=runtime.create({prompt:'Conservar original'}),task=store.task(id),original=JSON.stringify(task.messages);
 const pending=runtime.compact(task,new AbortController().signal);await until(()=>started);
 runtime.pause(id);release();await assert.rejects(pending);
 assert.equal(task.status,'paused');assert.equal(task.compressions,0);assert.equal(JSON.stringify(task.messages),original);assert.equal(runtime.compacting.size,0);assert.equal(runtime.compressionControllers.size,0);
});

test('shutdown aborts a manual compression request and preserves history',async t=>{
 let started=false;
 const {runtime,store}=await setup(t,async(_,options)=>new Promise((resolve,reject)=>{started=true;options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});}));runtime.closed=true;
 const task=store.task(runtime.create({prompt:'Cierre durante compresión'}));
 const pending=runtime.compact(task,new AbortController().signal);await until(()=>started);runtime.shutdown();await assert.rejects(pending);
 assert.equal(task.compressions,0);assert.equal(task.messages[0].content,'Cierre durante compresión');assert.equal(runtime.compressionControllers.size,0);
});

test('instructions sent during manual compression are queued and cannot disappear at checkpoint',async t=>{
 let release,started=false;const gate=new Promise(resolve=>release=resolve);
 const {runtime,store}=await setup(t,async()=>{started=true;await gate;return reply('Continuidad verificada: objetivo original, pendientes y decisiones documentadas.');});runtime.closed=true;
 const id=runtime.create({prompt:'Objetivo original'}),task=store.task(id);
 const pending=runtime.compact(task,new AbortController().signal);await until(()=>started);runtime.resume(id,'Nueva dirección durante la compresión');
 assert.equal(task.pendingFollowups,1);assert.equal(task.messages.some(message=>message.content==='Nueva dirección durante la compresión'),false);
 release();await pending;assert.equal(task.status,'queued');assert.equal(task.pendingFollowups,1);
 runtime.flushFollowups(task);assert.equal(task.messages.filter(message=>message.content==='Nueva dirección durante la compresión').length,1);
 assert.equal(new Store(store.directory).task(id).followupQueue.length,0);
});

test('a failure before contacting the provider clears stale live activity',async t=>{
 const {runtime,store}=await setup(t);runtime.getSecret=()=>'';
 const id=runtime.create({prompt:'Sin clave configurada'});await until(()=>!runtime.active.size);
 const task=store.task(id);assert.equal(task.status,'failed');assert.equal(task.liveActivity,'');assert.equal(task.liveText,'');assert.equal(task.liveReasoning,'');
 assert.equal(new Store(store.directory).task(id).liveActivity,'');
});

test('a provider reply received after pause is retained as interrupted, never declared complete',async t=>{
 let release,started=false;const gate=new Promise(resolve=>release=resolve);
 const {runtime,store}=await setup(t,async()=>{started=true;await gate;return reply('Respuesta recibida después de pausar');});
 const id=runtime.create({prompt:'Pausa en carrera'});await until(()=>started);runtime.pause(id);release();await until(()=>!runtime.active.size);
 const task=store.task(id);assert.equal(task.status,'paused');assert.equal(task.calls[0].status,'interrupted');assert.equal(task.result,undefined);
 assert.match(task.conversation.at(-1).content,/Respuesta recibida después de pausar/);assert.match(task.conversation.at(-1).content,/incomplete/);assert.equal(task.liveActivity,'');
});
