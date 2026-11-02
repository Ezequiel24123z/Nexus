import {useEffect,useRef,useState} from 'react';
import {nextStreamText} from './stream-display.mjs';
export default function useSmoothStream(text){
 const [shown,setShown]=useState(text);
 const shownRef=useRef(text);
 const [reduced,setReduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.dataset.motion==='reduced');
 useEffect(()=>{const query=window.matchMedia('(prefers-reduced-motion: reduce)'),changed=()=>setReduced(query.matches||document.documentElement.dataset.motion==='reduced');query.addEventListener('change',changed);window.addEventListener('nexus-appearance',changed);return()=>{query.removeEventListener('change',changed);window.removeEventListener('nexus-appearance',changed);};},[]);
 useEffect(()=>{
   if(reduced){shownRef.current=text;setShown(text);return;}
   if(shownRef.current===text)return;
   let frame,previous=0;
   const advance=now=>{if(now-previous>=30){previous=now;shownRef.current=nextStreamText(shownRef.current,text);setShown(shownRef.current);}if(shownRef.current!==text)frame=requestAnimationFrame(advance);};
   frame=requestAnimationFrame(advance);return()=>cancelAnimationFrame(frame);
 },[text,reduced]);
 return !text.startsWith(shown)||reduced?text:shown;
}
