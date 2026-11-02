import fs from 'node:fs';
import path from 'node:path';

// Only the latest response per task is retained here. Append-only fragments avoid
// rewriting workspace.json for every streamed token. No tools/reasoning/credentials.
export class ResponseJournal {
  constructor(directory,responseId){this.filename=path.join(directory,'response-live.jsonl');this.responseId=responseId;this.fd=null;this.text='';}
  append(entry){
    try{
    if(this.fd===null){
      this.fd=fs.openSync(this.filename,'w');
      this.write({type:'start',version:1,responseId:this.responseId,at:new Date().toISOString()});
    }
    this.write(entry);
    }catch(error){this.error=error;throw error;}
  }
  write(entry){
    const buffer=Buffer.from(JSON.stringify(entry)+'\n');let offset=0;
    while(offset<buffer.length){const written=fs.writeSync(this.fd,buffer,offset,buffer.length-offset);if(!written)throw new Error('No se pudo guardar la respuesta en curso.');offset+=written;}
  }
  update(text){
    if(text===this.text)return;
    this.append(text.startsWith(this.text)?{type:'text',delta:text.slice(this.text.length)}:{type:'replace',text});this.text=text;
  }
  call(record){
    const fields=['id','responseId','model','kind','input','output','total','cached','cacheWrite','reasoning','webSearchRequests','cost','firstTokenMs','at'];
    this.append({type:'call',call:Object.fromEntries(fields.filter(key=>record[key]!==undefined).map(key=>[key,record[key]]))});
  }
  close(){if(this.fd!==null){const fd=this.fd;this.fd=null;fs.closeSync(fd);}}
}

export function readResponseJournal(directory){
  let source;try{source=fs.readFileSync(path.join(directory,'response-live.jsonl'),'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
  const lines=source.split('\n');let result=null;
  for(let index=0;index<lines.length;index++){
    if(!lines[index])continue;
    let entry;try{entry=JSON.parse(lines[index]);}catch{if(result)result.damaged=true;break;}
    if(!result){
      if(entry.type!=='start'||entry.version!==1||typeof entry.responseId!=='string'||!/^[a-f0-9-]{36}$/.test(entry.responseId))return null;
      result={responseId:entry.responseId,at:entry.at,text:'',call:null,damaged:false};continue;
    }
    if(entry.type==='text'&&typeof entry.delta==='string')result.text+=entry.delta;
    else if(entry.type==='replace'&&typeof entry.text==='string')result.text=entry.text;
    else if(entry.type==='call'&&entry.call?.responseId===result.responseId)result.call=entry.call;
    else{result.damaged=true;break;}
  }
  return result;
}
