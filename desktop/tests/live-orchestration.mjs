// Opt-in live scheduler probe: two independent turns run together; a dependent turn waits for A.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/store.mjs';
import {Runtime} from '../core/runtime.mjs';
const key=process.env.NEXUS_LIVE_OPENROUTER_KEY;if(!key)throw new Error('Set NEXUS_LIVE_OPENROUTER_KEY.');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-live-orchestration-'));const store=new Store(path.join(root,'data'));
store.state.settings={...store.state.settings,model:'deepseek/deepseek-v4.1-flash',reasoningEffort:'none',streaming:true,concurrency:3,maxOutput:300};store.save();
const starts=[];const request=async(url,options)=>{const body=JSON.parse(options.body);const prompt=body.messages.map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');starts.push({at:Date.now(),prompt});return fetch(url,options);};
const runtime=new Runtime(store,{getSecret:n=>n==='OPENROUTER_API_KEY'?key:undefined,request});
const wait=async()=>{const start=Date.now();while(runtime.active.size||store.state.tasks.some(t=>t.status==='queued')){if(Date.now()-start>180000)throw new Error('Timed out');await new Promise(r=>setTimeout(r,100));}};
try{
 const a=runtime.create({prompt:'Responde exclusivamente ORCHESTRATION_A_OK.'});
 const b=runtime.create({prompt:'Responde exclusivamente ORCHESTRATION_B_OK.'});
 const c=runtime.create({prompt:'Usa el resultado de la dependencia y responde exclusivamente ORCHESTRATION_C_OK.',dependsOn:[a]});
 await wait();const tasks=[a,b,c].map(id=>store.task(id));for(const task of tasks)assert.equal(task.status,'complete',task.error);
 assert.match(store.task(a).result,/ORCHESTRATION_A_OK/);assert.match(store.task(b).result,/ORCHESTRATION_B_OK/);assert.match(store.task(c).result,/ORCHESTRATION_C_OK/);
 const aStart=starts.find(s=>s.prompt?.includes('ORCHESTRATION_A_OK'))?.at,bStart=starts.find(s=>s.prompt?.includes('ORCHESTRATION_B_OK'))?.at,cStart=starts.find(s=>s.prompt?.includes('ORCHESTRATION_C_OK'))?.at;
 assert.ok(aStart&&bStart&&cStart);assert.ok(Math.abs(aStart-bStart)<1500,'Independent tasks did not begin together');assert.ok(cStart>=Math.min(aStart,bStart),'Dependency began before the initial wave');
 console.log(JSON.stringify({model:store.state.settings.model,concurrency:store.state.settings.concurrency,starts:starts.map(s=>({offsetMs:s.at-Math.min(aStart,bStart),prompt:s.prompt.match(/ORCHESTRATION_[ABC]_OK/)?.[0]})),tasks:tasks.map(t=>({title:t.title,status:t.status,cost:t.telemetry.cost,calls:t.telemetry.calls}))},null,2));
}finally{runtime.shutdown();await fs.rm(root,{recursive:true,force:true});}
