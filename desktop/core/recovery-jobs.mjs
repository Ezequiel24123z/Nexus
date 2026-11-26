import {Worker} from 'node:worker_threads';
export function recoveryJob(input){
 return new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('./storage-recovery-worker.mjs',import.meta.url),{workerData:input,resourceLimits:{maxOldGenerationSizeMb:768}});
   let received=false;
   const timeout=setTimeout(()=>{received=true;void worker.terminate();reject(new Error('Recovery exceeded two minutes. The active session was not replaced; keep any diagnostic folder created.'));},120000);
   worker.once('message',message=>{received=true;clearTimeout(timeout);message.ok?resolve(message.result):reject(new Error(message.error));});
   worker.once('error',error=>{clearTimeout(timeout);reject(error);});
   worker.once('exit',code=>{clearTimeout(timeout);if(!received)reject(new Error('Recovery check exited without a result ('+code+'). The active session was not replaced.'));});
 });
}
