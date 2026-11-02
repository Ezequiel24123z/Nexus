import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {aggregateUsage} from './telemetry.mjs';
import {requestTools} from './model-request.mjs';

const known=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const bound=(value,fallback,max)=>Number.isInteger(value)&&value>=0?Math.min(value,max):fallback;
function printable(value) {
  return JSON.stringify(value,(key,item)=>{
    if(key==='reasoning_details')return undefined;
    if(key==='image_url')return '[Image: binary payload omitted from preview]';
    return item;
  },2);
}
function plan(runtime,task) {
  const {messages,sections}=runtime.buildContext(task,{hydrate:false,inspect:true});
  const tools=requestTools(runtime.effectiveSettings?runtime.effectiveSettings(task):{...runtime.store.state.settings,model:task.model});
  sections.push({id:'tools',label:'Available Tools',reason:'Tool schemas sent alongside generation. Catalog contracts are queried on demand.',value:tools,count:tools.length});
  const fingerprint=crypto.createHash('sha256').update(printable({messages,tools})).digest('hex');
  return {sections,fingerprint,total:runtime.estimate(task,messages)+runtime.estimate(task,tools)};
}
export function inspectContext(runtime,task) {
  const current=plan(runtime,task),settings=runtime.store.state.settings;
  const sections=current.sections.map(({value,...section})=>({...section,tokens:runtime.estimate(task,value),characters:printable(value).length}));
  const threshold=Math.floor(settings.contextWindow*settings.compressionPercent/100);
  return {at:new Date().toISOString(),fingerprint:current.fingerprint,sections,total:current.total,threshold,ceiling:settings.contextWindow,estimated:true,
    lastReportedInput:(task.calls||[]).findLast(call=>call.kind==='generation'&&known(call.input))?.input??(task.lastInputTokens||null),needsCompression:Math.max(current.total,task.lastInputTokens||0)>=threshold,
    live:runtime.active.has(task.id)||runtime.compacting.has(task.id),affinity:settings.cacheAffinity===true,
    compression:task.lastCompression||null,compressions:task.compressions||0,
    checkpoints:(task.events||[]).filter(event=>event.kind==='compression').slice(-15).reverse().map(event=>({at:event.at,checkpoint:event.detail.checkpoint,before:event.detail.before??null,after:event.detail.after??null,truncated:!!event.detail.truncated,cost:event.detail.cost??null,unknownCosts:event.detail.unknownCosts??null})),
    note:'Snapshot of the current context before the next model call. Local token estimate, not exact tokenizer output; images and server web tools may add provider-specific overhead.'};
}
export function contextSection(runtime,task,args) {
  const current=plan(runtime,task);
  if(args.fingerprint!==current.fingerprint)throw new Error('The context changed. Refresh the inspector before opening section details.');
  const section=current.sections.find(item=>item.id===args.section);
  if(!section)throw new Error('Section not found.');
  const text=printable(section.value),offset=bound(args.offset,0,text.length),length=6000;
  return {label:section.label,content:text.slice(offset,offset+length),offset,total:text.length,next:offset+length<text.length?offset+length:null};
}
function summarise(calls) {
  const aggregate=aggregateUsage(calls),comparable=calls.filter(call=>known(call.input)&&known(call.cached)&&call.cached<=call.input);
  return {...aggregate,uncached:comparable.length?comparable.reduce((sum,call)=>sum+call.input-call.cached,0):null,
    failed:calls.filter(call=>call.status==='failed').length,interrupted:calls.filter(call=>call.status==='interrupted').length,pending:calls.filter(call=>call.status==='pending').length};
}
export function inspectCosts(task,{offset=0,version}={}) {
  const calls=task.calls||[],start=bound(offset,0,calls.length),page=[...calls].reverse().slice(start,start+20);
  const currentVersion=crypto.createHash('sha256').update(JSON.stringify(calls)).digest('hex');
  if(version&&version!==currentVersion)throw new Error('The cost log changed. Refresh the inspector before changing pages.');
  const groups=[['generation','Generation'],['compression','Compaction'],['other','Other']].map(([kind,label])=>({kind,label,...summarise(calls.filter(call=>kind==='other'?!['generation','compression'].includes(call.kind):call.kind===kind))}));
  const items=page.map(call=>({id:call.id,at:call.at,kind:call.kind,status:call.status,model:String(call.model||'').slice(0,180),cost:known(call.cost)?call.cost:null,input:known(call.input)?call.input:null,output:known(call.output)?call.output:null,cached:known(call.cached)?call.cached:null,retried:!!call.retried,latencyMs:known(call.latencyMs)?call.latencyMs:null,sessionAffinity:call.sessionAffinity===true,provider:String(call.router?.provider_name||call.router?.provider||'Not reported').slice(0,180)}));
  return {at:new Date().toISOString(),version:currentVersion,total:summarise(calls),groups,retries:summarise(calls.filter(call=>call.retried)),items,offset:start,next:start+20<calls.length?start+20:null};
}
export async function previewCheckpoint(store,task,{checkpoint,section='summary',offset=0}) {
  if(!Number.isSafeInteger(checkpoint)||checkpoint<1||checkpoint>task.compressions||!['summary','messages'].includes(section))throw new Error('Invalid checkpoint identifier.');
  const filename=path.join(store.directoryFor(task.id),'checkpoint-'+checkpoint+'.json');
  const handle=await fs.open(filename,'r');let data;
  try{const stat=await handle.stat();if(stat.size>32*1024*1024)throw new Error('Checkpoint is too large for this view. Query fragments using the agent tools.');data=JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}
  const text=section==='summary'?String(data.summary||''):printable(data.messages||[]),start=bound(offset,0,text.length);
  return {label:'Checkpoint '+checkpoint+' · '+(section==='summary'?'summary':'originals'),content:text.slice(start,start+6000),offset:start,total:text.length,next:start+6000<text.length?start+6000:null};
}
