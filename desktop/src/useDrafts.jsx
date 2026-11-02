import {useEffect,useRef,useState} from 'react';
import {DraftController} from './draft-controller.mjs';
export default function useDrafts(onError){
  const [,paint]=useState(0),ref=useRef(null),errorRef=useRef(onError);errorRef.current=onError;
  if(!ref.current)ref.current=new DraftController((method,args)=>window.nexus.invoke(method,args),()=>paint(value=>value+1));
  const controller=ref.current;
  useEffect(()=>{let live=true;controller.load().then(issues=>{if(live&&issues.length)errorRef.current(issues.join(' '));}).catch(()=>{if(live)errorRef.current('No se pudieron recuperar los borradores. Vuelve a abrir la aplicación.');});
    const off=window.nexus.beforeClose(async()=>{try{await controller.flush();return true;}catch(error){errorRef.current(error.message);return false;}});
    return()=>{live=false;off();};
  },[controller]);
  return controller;
}
