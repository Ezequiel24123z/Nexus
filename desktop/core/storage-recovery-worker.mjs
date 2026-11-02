import {parentPort,workerData} from 'node:worker_threads';
import {inspectRecovery,restoreIsolated} from './storage-recovery.mjs';
try{
 const result=workerData.operation==='inspect'?inspectRecovery(workerData.source):workerData.operation==='restore'?restoreIsolated(workerData):null;
 if(!result)throw new Error('Operación de recuperación no válida.');
 parentPort.postMessage({ok:true,result});
}catch(error){parentPort.postMessage({ok:false,error:error.message});}
