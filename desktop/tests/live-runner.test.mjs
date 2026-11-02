import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import path from 'node:path';

const source=await fs.readFile(new URL('./run-live-from-vault.cjs',import.meta.url),'utf8');
async function harness(){
 const child=new EventEmitter(),errors=[];let quits=0,spawnArgs;
 const process={argv:['electron','runner','test.mjs'],env:{},execPath:'electron',exitCode:undefined};
 const app={setName(){},setPath(){},getPath:()=>'/test-vault',whenReady:()=>Promise.resolve(),quit:()=>quits++};
 vm.runInNewContext(source,{process,console:{error:message=>errors.push(message)},require:name=>{
   if(name==='electron')return {app,safeStorage:{isEncryptionAvailable:()=>true,decryptString:()=>JSON.stringify({OPENROUTER_API_KEY:'fake-test-key'})}};
   if(name==='node:fs')return {existsSync:()=>true,readFileSync:()=>Buffer.from('encrypted')};
   if(name==='node:path')return path;
   if(name==='node:child_process')return {spawn:(...args)=>{spawnArgs=args;return child;}};
   if(name==='../core/datadir.cjs')return {resolveDataDirectory:()=>'/test-vault'};
   throw new Error(name);
 }});
 await new Promise(resolve=>setImmediate(resolve));return {child,process,errors,get quits(){return quits;},spawnArgs};
}
test('live runner does not report interrupted or failed child startup as success',async()=>{
 for(const event of ['signal','error']){
   const result=await harness();
   if(event==='signal')result.child.emit('exit',null,'SIGTERM');else result.child.emit('error',new Error('Synthetic startup error'));
   result.child.emit('exit',0,null);
   assert.equal(result.process.exitCode,1);assert.equal(result.quits,1);assert.equal(result.errors.length,1);
 }
});
test('live runner keeps secrets out of arguments and passes successful child status',async()=>{
 const result=await harness();result.child.emit('exit',0,null);
 assert.equal(result.process.exitCode,0);assert.equal(result.quits,1);assert.equal(result.spawnArgs[2].windowsHide,true);
 assert.ok(!JSON.stringify(result.spawnArgs.slice(0,2)).includes('fake-test-key'));assert.equal(result.spawnArgs[2].env.NEXUS_LIVE_OPENROUTER_KEY,'fake-test-key');
 assert.deepEqual(result.errors,[]);
});
