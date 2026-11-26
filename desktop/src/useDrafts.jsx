import {useEffect,useRef,useState} from 'react';
import {DraftController} from './draft-controller.mjs';
export default function useDrafts(onError){
  const [,paint]=useState(0),ref=useRef(null),errorRef=useRef(onError);errorRef.current=onError;
  if(!ref.current)ref.current=new DraftController((method,args)=>window.nexus.invoke(method,args),()=>paint(value=>value+1),{debounceMs:250});
  const controller=ref.current;
  useEffect(()=>{let live=true;controller.load().then(issues=>{if(live&&issues.length)errorRef.current(issues.join(' '));}).catch(()=>{if(live)errorRef.current('Could not recover saved drafts. Reopen NEXUS to retry.');});
    const off=window.nexus.beforeClose(async()=>{try{await controller.flush();return true;}catch(error){errorRef.current(error.message);return false;}});
    return()=>{live=false;off();};
  },[controller]);
  return controller;
}
