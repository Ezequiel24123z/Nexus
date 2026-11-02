import fs from 'node:fs/promises';
import {readArtifact} from './artifacts.mjs';
import {externalWebUrl} from './web-links.mjs';

const bounded=(value,fallback,max)=>Number.isInteger(value)&&value>=0?Math.min(value,max):fallback;
export function searchConversation(task,query,{offset=0,limit=30}={}){
  if(typeof query!=='string'||query.length>500)throw new Error('Busca un texto de hasta 500 caracteres.');
  const needle=query.trim().toLocaleLowerCase();offset=bounded(offset,0,10000000);limit=Math.max(1,bounded(limit,30,50));
  const items=[];let total=0;
  if(needle)for(const message of task.conversation||[]){
    const content=typeof message.content==='string'?message.content:'';
    const index=content.toLocaleLowerCase().indexOf(needle);if(index<0)continue;
    if(total>=offset&&items.length<limit)items.push({id:message.id,role:message.role,snippet:(index>70?'…':'')+content.slice(Math.max(0,index-70),index+needle.length+140)+(index+needle.length+140<content.length?'…':'')});
    total++;
  }
  return {items,total,offset,next:offset+items.length<total?offset+items.length:null};
}
export function conversationWindow(task,messageId){
  const index=task.conversation.findIndex(message=>message.id===messageId);if(index<0)throw new Error('Mensaje no encontrado.');
  const start=Math.max(0,index-40),end=Math.min(task.conversation.length,start+120);
  return {items:task.conversation.slice(start,end),start,end,total:task.conversation.length};
}

// Only durable, observed records become results. Commands are not guessed to have
// created files; source URLs are data, never executable markup.
export function taskResults(task,{offset=0,limit=40}={}){
  const entries=new Map();
  for(const message of task.conversation||[])for(const source of message.sources||[]){
    try{const url=externalWebUrl(source.url);entries.set('source:'+url,{id:'source:'+url,kind:'source',name:source.title||url,url,messageId:message.id});}catch{}
  }
  for(const event of task.events||[]){
    const detail=event.detail||{};
    if(event.kind==='file_change'&&typeof detail.path==='string')entries.set('file:'+detail.path,{id:event.id,kind:'file',name:detail.path,bytes:detail.bytes,at:event.at,note:detail.reason});
    if(event.kind==='tool_result'&&detail.result?.artifact){const a=detail.result.artifact;entries.set('artifact:'+a.id,{id:event.id,kind:'artifact',name:a.name||detail.name,bytes:a.bytes,at:event.at,note:detail.result.preview});}
    if(event.kind==='progress')entries.set('progress:'+event.id,{id:event.id,kind:'progress',name:'Nota de progreso',at:event.at,note:detail.verification||detail.changes||detail.next||''});
  }
  const all=[...entries.values()].reverse();offset=bounded(offset,0,10000000);limit=Math.max(1,bounded(limit,40,80));
  return {items:all.slice(offset,offset+limit).map(item=>({...item,name:String(item.name).slice(0,1000),note:item.note?String(item.note).slice(0,1000):undefined})),total:all.length,next:offset+limit<all.length?offset+limit:null};
}

export async function previewTaskResult(store,task,resultId){
  const event=task.events.find(item=>item.id===resultId);
  if(!event)throw new Error('Resultado no encontrado en este chat.');
  if(event.kind==='tool_result'&&event.detail?.result?.artifact)return {...await readArtifact(store,task,event.detail.result.artifact.id,0,12000),name:event.detail.result.artifact.name,note:'Resultado guardado · vista previa de hasta 12.000 caracteres.'};
  if(event.kind==='progress')return {name:'Nota de progreso',content:JSON.stringify(event.detail,null,2).slice(0,12000),note:'Documentación del agente; no equivale a una prueba independiente. Vista previa de hasta 12.000 caracteres.'};
  if(event.kind!=='file_change'||typeof event.detail?.path!=='string')throw new Error('Este resultado no tiene vista previa.');
  const handle=await fs.open(event.detail.path,'r');
  try{
    const info=await handle.stat();if(!info.isFile())throw new Error('La ruta ya no es un archivo.');
    const buffer=Buffer.alloc(Math.min(info.size,12000));const {bytesRead}=await handle.read(buffer,0,buffer.length,0);const bytes=buffer.subarray(0,bytesRead);
    const binary=bytes.includes(0);
    return {name:event.detail.path,content:binary?undefined:bytes.toString('utf8'),note:binary?'Archivo binario: no se interpreta como texto.':info.size>bytesRead?'Contenido actual · vista previa parcial de 12 KB.':'Contenido actual del archivo; puede haber cambiado desde la acción.',bytes:info.size};
  }finally{await handle.close();}
}
