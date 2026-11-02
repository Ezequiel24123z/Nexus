// Explicit opt-in real-provider regression suite. No desktop automation or user chat writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/store.mjs';
import {Runtime} from '../core/runtime.mjs';
import {aggregateUsage} from '../core/telemetry.mjs';

const key=process.env.NEXUS_LIVE_OPENROUTER_KEY;
if(!key)throw new Error('Run using the encrypted-vault test runner.');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-live-recovery-'));
const workspace=path.join(root,'workspace');await fs.mkdir(workspace);
const report={startedAt:new Date().toISOString(),model:'deepseek/deepseek-v4.1-flash',directory:root,checks:[],requests:[],passed:false};
const destination=process.env.NEXUS_LIVE_REPORT_PATH||path.join(root,'report.json');
sync.mkdirSync(path.dirname(destination),{recursive:true});
let store=new Store(path.join(root,'data')),runtime,queueDuringCompression=null,liveUpdates=0;
store.state.settings={...store.state.settings,model:report.model,reasoningEffort:'none',contextWindow:50000,compressionPercent:95,streaming:true,maxOutput:0,autonomous:false,autoWorkspaceWrites:true,desktopEnabled:false,webSearchEnabled:false,concurrency:2};
store.save();
const allCalls=()=>store.state.tasks.flatMap(task=>task.calls||[]);
const usage=()=>aggregateUsage(allCalls());
function checkpoint(){sync.writeFileSync(destination,JSON.stringify({...report,usage:usage(),updatedAt:new Date().toISOString()},null,2));}
const request=async(url,options)=>{
  const known=usage(),finished=allCalls().filter(call=>call.status!=='pending');
  if(report.requests.length>=22 || (known.cost||0)>=0.08 || finished.some(call=>call.cost==null))throw new Error('Test batch stopped: request/cost guard or unreported prior cost.');
  const body=JSON.parse(options.body);
  assert.equal(body.model,report.model);assert.equal(body.reasoning.effort,'none');
  report.requests.push({at:Date.now(),compression:!body.tools,maxTokensSent:Object.hasOwn(body,'max_tokens'),bytes:Buffer.byteLength(options.body)});
  checkpoint();
  if(queueDuringCompression&&!body.tools){const id=queueDuringCompression;queueDuringCompression=null;runtime.resume(id,'Seguimiento durante compresión: responde exclusivamente FOLLOWUP_COMPRESSION_917. No uses herramientas.');}
  return fetch(url,{...options,signal:AbortSignal.any([options.signal,AbortSignal.timeout(90000)])});
};
function makeRuntime(){
  const engine=new Runtime(store,{getSecret:name=>name==='OPENROUTER_API_KEY'?key:undefined,request});
  // This isolated test allows workspace files but never shells, desktop actions or external connectors.
  engine.approval=async()=>{throw new Error('This isolated test does not permit commands or external effects.');};
  engine.on('change',()=>{if(store.state.tasks.some(task=>task.liveText))liveUpdates++;});
  return engine;
}
runtime=makeRuntime();
async function wait(){const start=Date.now();while(runtime.active.size||store.state.tasks.some(task=>task.status==='queued')){if(Date.now()-start>180000)throw new Error('Test task timed out');await new Promise(resolve=>setTimeout(resolve,80));}}
function check(name,verify){verify();const result={name,usage:usage()};report.checks.push(result);checkpoint();console.log(JSON.stringify({check:name,cost:result.usage.cost,calls:result.usage.calls}));}
try{
  await fs.writeFile(path.join(workspace,'seed.txt'),'NEXUS_FILE_FACT_917\nEstado inicial.');
  const attachmentFile=path.join(root,'fuente.txt');await fs.writeFile(attachmentFile,'Dato verificable del adjunto: NEXUS_ATTACHMENT_FACT_628.');
  const attachment=await runtime.attachments.importFile(attachmentFile);
  const id=runtime.create({title:'QA real: archivos, adjuntos y recuperación',workspace,attachmentIds:[attachment.id],prompt:'Ensayo aislado: lee seed.txt con read_file y el adjunto fuente.txt con read_attachment. Crea resultado.json con dos campos: fileMarker (marcador del archivo) y attachmentMarker (marcador del adjunto). Vuelve a leer resultado.json para verificarlo y documenta el hito. No uses comandos, red ni escritorio. No accedas fuera de la carpeta. Termina con una tabla Markdown breve y QA_FILES_OK.'});
  await wait();let task=store.task(id);
  const output=JSON.parse(await fs.readFile(path.join(workspace,'resultado.json'),'utf8'));
  check('files_and_attachment_tool_loop',()=>{assert.equal(task.status,'complete',task.error);assert.equal(output.fileMarker,'NEXUS_FILE_FACT_917');assert.equal(output.attachmentMarker,'NEXUS_ATTACHMENT_FACT_628');assert.match(task.result,/QA_FILES_OK/);for(const tool of ['read_file','write_file','read_attachment'])assert.ok(task.events.some(event=>event.kind==='tool_result'&&event.detail.name===tool),tool);assert.ok(liveUpdates>0);});
  runtime.resume(id,'Sin herramientas, responde únicamente CACHE_FOLLOWUP_OK.');await wait();
  check('cached_followup_and_native_output',()=>{assert.equal(task.status,'complete',task.error);assert.match(task.result,/CACHE_FOLLOWUP_OK/);assert.ok(report.requests.filter(request=>!request.compression).every(request=>!request.maxTokensSent));assert.equal(task.telemetry.reasoning,0);});

  queueDuringCompression=id;
  await runtime.compact(task,new AbortController().signal);await wait();
  check('followup_survives_live_compression',()=>{assert.equal(task.compressions,1);assert.equal(task.status,'complete',task.error);assert.match(task.result,/FOLLOWUP_COMPRESSION_917/);assert.equal(task.pendingFollowups,0);assert.equal(task.messages.filter(message=>typeof message.content==='string'&&message.content.startsWith('Seguimiento durante compresión:')).length,1);});
  report.compression=task.lastCompression;

  runtime.shutdown();store=new Store(path.join(root,'data'));runtime=makeRuntime();task=store.task(id);
  runtime.resume(id,'Después del reinicio, lee otra vez el adjunto fuente.txt con read_attachment (usa list_attachments si necesitas su id). Responde RESTART_ATTACHMENT_OK y su marcador exacto. No uses otras herramientas.');await wait();
  check('attachment_after_compression_and_restart',()=>{assert.equal(task.status,'complete',task.error);assert.match(task.result,/RESTART_ATTACHMENT_OK/);assert.match(task.result,/NEXUS_ATTACHMENT_FACT_628/);});

  const starts=report.requests.length;
  const a=runtime.create({title:'QA paralelo A',prompt:'Sin herramientas, responde exclusivamente PARALLEL_A_917.'});
  const b=runtime.create({title:'QA paralelo B',prompt:'Sin herramientas, responde exclusivamente PARALLEL_B_917.'});
  const c=runtime.create({title:'QA consecutivo C',dependsOn:[a],prompt:'Sin herramientas, responde exclusivamente DEPENDENT_C_917.'});
  let dependencyViolated=false;
  const watch=()=>{if(runtime.active.has(c)&&store.task(a).status!=='complete')dependencyViolated=true;};runtime.on('change',watch);
  await wait();runtime.off('change',watch);
  check('parallel_and_dependent_tasks',()=>{for(const [taskId,marker] of [[a,'PARALLEL_A_917'],[b,'PARALLEL_B_917'],[c,'DEPENDENT_C_917']]){assert.equal(store.task(taskId).status,'complete',store.task(taskId).error);assert.ok(store.task(taskId).result.includes(marker));}assert.equal(dependencyViolated,false);assert.ok(Math.abs(report.requests[starts].at-report.requests[starts+1].at)<2000);});
  report.passed=true;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
  runtime.shutdown();const stop=Date.now();while(runtime.active.size&&Date.now()-stop<10000)await new Promise(resolve=>setTimeout(resolve,50));
  report.finishedAt=new Date().toISOString();report.usage=usage();report.liveUpdates=liveUpdates;
  report.calls=allCalls().map(({id,kind,status,input,output,cached,cost,reasoning,latencyMs,firstTokenMs})=>({id,kind,status,input,output,cached,cost,reasoning,latencyMs,firstTokenMs}));
  await fs.writeFile(destination,JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,error:report.error,report:destination,data:root,usage:report.usage},null,2));
}
