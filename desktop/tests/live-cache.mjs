// Opt-in cache measurement for one stable NEXUS conversation. No key or prompt data is persisted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/store.mjs';
import {Runtime} from '../core/runtime.mjs';
const key=process.env.NEXUS_LIVE_OPENROUTER_KEY;if(!key)throw new Error('Set NEXUS_LIVE_OPENROUTER_KEY.');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-live-cache-'));const store=new Store(path.join(root,'data'));
store.state.settings={...store.state.settings,model:'deepseek/deepseek-v4.1-flash',reasoningEffort:'none',streaming:true,globalInstructions:'Prefijo estable de NEXUS para medir caché del proveedor. No reformules estas reglas.\n'+('Regla de arquitectura estable. La misma secuencia debe conservarse entre turnos.\n'.repeat(1200))};store.save();
const runtime=new Runtime(store,{getSecret:n=>n==='OPENROUTER_API_KEY'?key:undefined});
const wait=async()=>{const start=Date.now();while(runtime.active.size){if(Date.now()-start>120000)throw new Error('Timed out');await new Promise(r=>setTimeout(r,100));}};
try{
 const id=runtime.create({prompt:'Responde exclusivamente CACHE_TURN_0.'});await wait();const task=store.task(id);assert.equal(task.status,'complete',task.error);
 for(let i=1;i<5;i++){runtime.resume(id,`Responde exclusivamente CACHE_TURN_${i}.`);await wait();assert.equal(task.status,'complete',task.error);assert.match(task.result,new RegExp(`CACHE_TURN_${i}`));}
 const calls=task.calls.map((c,index)=>({index:index+1,input:c.input,cached:c.cached,cacheHitRate:c.input?c.cached/c.input:null,cost:c.cost,latencyMs:c.latencyMs,provider:c.router?.provider_name||c.router?.provider||null,route:c.router?.route||null}));
 console.log(JSON.stringify({model:task.model,calls,aggregate:task.telemetry},null,2));
}finally{runtime.shutdown();await fs.rm(root,{recursive:true,force:true});}
