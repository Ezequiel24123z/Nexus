import {Worker} from 'node:worker_threads';
export function recoveryJob(input){
 return new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('./storage-recovery-worker.mjs',import.meta.url),{workerData:input,resourceLimits:{maxOldGenerationSizeMb:768}});
   let received=false;
   const timeout=setTimeout(()=>{received=true;void worker.terminate();reject(new Error('La recuperación superó dos minutos. La sesión abierta no se ha sustituido; conserva cualquier carpeta de diagnóstico creada.'));},120000);
   worker.once('message',message=>{received=true;clearTimeout(timeout);message.ok?resolve(message.result):reject(new Error(message.error));});
   worker.once('error',error=>{clearTimeout(timeout);reject(error);});
   worker.once('exit',code=>{clearTimeout(timeout);if(!received)reject(new Error('La comprobación terminó sin resultado ('+code+'). La sesión abierta no se ha sustituido.'));});
 });
}
