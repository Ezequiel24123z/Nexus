// Opt-in live integration probe. It never contains a key: set NEXUS_LIVE_OPENROUTER_KEY.
// It writes only to a fresh OS temp directory and prints aggregate usage, never prompts or headers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/store.mjs';
import {Runtime} from '../core/runtime.mjs';

const key=process.env.NEXUS_LIVE_OPENROUTER_KEY;
if(!key)throw new Error('Set NEXUS_LIVE_OPENROUTER_KEY to opt in to the live probe.');
const scope=process.env.NEXUS_LIVE_SCOPE||'all';
if(!['all','cache','compaction','web'].includes(scope))throw new Error('NEXUS_LIVE_SCOPE must be all, cache, compaction or web.');
const reportPath=process.env.NEXUS_LIVE_REPORT_PATH;
const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-live-'));
const workspace=path.join(root,'workspace');await fs.mkdir(workspace);await fs.writeFile(path.join(workspace,'probe.txt'),'NEXUS_LIVE_FILE_CONTENT_417','utf8');
const store=new Store(path.join(root,'data'));
store.state.settings={...store.state.settings,model:'deepseek/deepseek-v4.1-flash',contextWindow:50000,compressionPercent:95,maxOutput:1000,streaming:true,autonomous:true};store.save();
const runtime=new Runtime(store,{getSecret:name=>name==='OPENROUTER_API_KEY'?key:undefined});
const wait=async predicate=>{const start=Date.now();while(!predicate()){if(Date.now()-start>180000)throw new Error('Live test timed out');await new Promise(r=>setTimeout(r,100));}};
const report={model:store.state.settings.model,operatingContextCeiling:50000,tests:[]};
try{
 if(scope==='all'||scope==='cache'){
 const toolId=runtime.create({title:'Live tool probe',workspace,prompt:'Lee exactamente el archivo probe.txt mediante read_file. Después responde con el marcador NEXUS_LIVE_TOOL_OK y el contenido exacto del archivo. No uses ninguna otra herramienta.'});
 await wait(()=>!runtime.active.size);const tool=store.task(toolId);
 assert.equal(tool.status,'complete',tool.error);assert.ok(tool.events.some(e=>e.kind==='tool_result'&&e.detail.name==='read_file'),'The model did not use read_file');assert.match(tool.result,/NEXUS_LIVE_TOOL_OK/);assert.match(tool.result,/NEXUS_LIVE_FILE_CONTENT_417/);
 report.tests.push({name:'tool_loop_streaming',status:tool.status,calls:tool.calls.length,usage:tool.telemetry,toolCalls:tool.events.filter(e=>e.kind==='tool_result').map(e=>e.detail.name)});

 // Repeated static prefix deliberately exercises provider-side prompt caching without fake calculations.
 store.state.settings.globalInstructions='Proyecto de caché NEXUS. Mantén estas especificaciones estables.\n'+('Regla estable de prefijo para medición de caché.\n'.repeat(700));store.save();
 const cacheId=runtime.create({title:'Live cache probe',workspace,prompt:'Responde únicamente CACHE_FIRST_OK.'});await wait(()=>!runtime.active.size);const cache=store.task(cacheId);assert.equal(cache.status,'complete',cache.error);
 runtime.resume(cacheId,'Responde únicamente CACHE_SECOND_OK.');await wait(()=>!runtime.active.size);assert.equal(cache.status,'complete',cache.error);assert.match(cache.result,/CACHE_SECOND_OK/);
 report.tests.push({name:'repeated_prefix_cache',status:cache.status,calls:cache.calls.length,usage:cache.telemetry,lastTurn:cache.lastTurnTelemetry,rawCalls:cache.calls.map(c=>({input:c.input,cached:c.cached,cost:c.cost,status:c.status,latencyMs:c.latencyMs}))});
 }

 if(scope==='all'||scope==='web'){
 store.state.settings={...store.state.settings,globalInstructions:'Para esta prueba debes usar openrouter:web_search antes de contestar. No respondas desde memoria.',webSearchEnabled:true,webSearchEngine:'exa',webSearchContext:'low',webMaxResults:3,webMaxUses:1};store.save();
 const webId=runtime.create({title:'Live web probe',workspace,prompt:'Busca en la web la fecha de hoy y responde con el marcador NEXUS_LIVE_WEB_OK, la fecha y al menos una fuente en Markdown. Usa la búsqueda web para comprobarla.'});
 await wait(()=>!runtime.active.size);const web=store.task(webId);
 assert.equal(web.status,'complete',web.error);assert.match(web.result,/NEXUS_LIVE_WEB_OK/);
 report.tests.push({name:'web_search_server_tool',status:web.status,reportedWebSearchRequests:web.telemetry.webSearchRequests,result: web.result, calls:web.calls.length,usage:web.telemetry,rawCalls:web.calls.map(c=>({input:c.input,cached:c.cached,output:c.output,cost:c.cost,webSearchRequests:c.webSearchRequests,status:c.status,latencyMs:c.latencyMs}))});
 }

 if(scope==='all'||scope==='compaction'){
 // Distinct identifiers make this input less repetition-friendly for the provider tokenizer.
 // It triggers the configured 95% of the 50k operating ceiling, then verifies continuity.
 store.state.settings.globalInstructions='';store.save();
 const large=Array.from({length:4000},(_,i)=>`context_fidelity_record_${i.toString(36).padStart(5,'0')} unique_payload_${(i*7919).toString(36)}`).join('\n');
 // Seed the synthetic long turn after creating a short task while scheduling is stopped.
 // This measures compaction itself without treating the test fixture as an ordinary user prompt.
 runtime.closed=true;
 const compactId=runtime.create({title:'Live compaction probe',workspace,prompt:'Ejecuta un ensayo de continuidad. Al finalizar responde exactamente COMPACTION_OK.'});
 const compact=store.task(compactId);
 compact.messages.push({role:'user',content:'Este es un ensayo de continuidad. Conserva literalmente el marcador NEXUS_COMPACTION_MARKER_781. No uses herramientas. Al terminar responde exactamente COMPACTION_OK.\n'+large});
 runtime.closed=false;runtime.schedule();
 await wait(()=>!runtime.active.size);
 assert.equal(compact.status,'complete',compact.error);assert.ok(compact.compressions>=1,'Compression did not trigger');assert.ok(compact.lastCompression.after<compact.lastCompression.before,'Compression did not shrink active context');assert.match(compact.result,/COMPACTION_OK/);
 const checkpoint=JSON.parse(await fs.readFile(path.join(store.directoryFor(compactId),'checkpoint-1.json'),'utf8'));assert.match(checkpoint.summary,/NEXUS_COMPACTION_MARKER_781/);
 report.tests.push({name:'50k_compaction_continuity',status:compact.status,calls:compact.calls.length,compressions:compact.compressions,compression:compact.lastCompression,usage:compact.telemetry,rawCalls:compact.calls.map(c=>({input:c.input,cached:c.cached,output:c.output,cost:c.cost,status:c.status,latencyMs:c.latencyMs}))});
 }
 console.log(JSON.stringify(report,null,2));
}catch(error){
 report.error=error.message;
 throw error;
}finally{
 if(reportPath){await fs.mkdir(path.dirname(reportPath),{recursive:true});await fs.writeFile(reportPath,JSON.stringify(report,null,2));}
 runtime.shutdown();await fs.rm(root,{recursive:true,force:true});
}
