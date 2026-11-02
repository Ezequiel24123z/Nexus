// Opt-in real provider probe: confirm that normal agent turns omit max_tokens when configured as 0.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/store.mjs';
import {Runtime} from '../core/runtime.mjs';
import {readResponseJournal} from '../core/response-journal.mjs';
const key=process.env.NEXUS_LIVE_OPENROUTER_KEY;if(!key)throw new Error('Encrypted vault runner required.');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-live-native-output-'));const store=new Store(path.join(root,'data'));
store.state.settings={...store.state.settings,model:'deepseek/deepseek-v4.1-flash',reasoningEffort:'none',streaming:true,maxOutput:0};store.save();
let body;const request=async(url,options)=>{body=JSON.parse(options.body);return fetch(url,options);};
const runtime=new Runtime(store,{getSecret:name=>name==='OPENROUTER_API_KEY'?key:undefined,request});
const report={model:store.state.settings.model,passed:false};
try{
 const id=runtime.create({prompt:'Responde exclusivamente NEXUS_NATIVE_OUTPUT_OK.'});
 const started=Date.now();while(runtime.active.size){if(Date.now()-started>120000)throw new Error('Timed out');await new Promise(resolve=>setTimeout(resolve,100));}
 const task=store.task(id);assert.equal(task.status,'complete',task.error);assert.match(task.result,/NEXUS_NATIVE_OUTPUT_OK/);assert.equal(body.max_tokens,undefined);
 const journal=readResponseJournal(store.directoryFor(id));assert.match(journal.text,/NEXUS_NATIVE_OUTPUT_OK/);assert.equal(journal.call.id,task.calls[0].id);
 const restored=new Store(store.directory).task(id);assert.equal(restored.status,'complete');assert.equal(restored.conversation.length,task.conversation.length);assert.equal(restored.conversation.at(-1).recovered,undefined);
 Object.assign(report,{passed:true,maxTokensSent:Object.hasOwn(body,'max_tokens'),status:task.status,usage:task.telemetry,providerIdPersisted:true,finalAnswerNotDuplicated:true});
 console.log(JSON.stringify(report,null,2));
}catch(error){report.error=error.message;throw error;}
finally{runtime.shutdown();if(process.env.NEXUS_LIVE_REPORT_PATH){await fs.mkdir(path.dirname(process.env.NEXUS_LIVE_REPORT_PATH),{recursive:true});await fs.writeFile(process.env.NEXUS_LIVE_REPORT_PATH,JSON.stringify(report,null,2));}assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});}
