import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const uuid='[a-f0-9-]{36}';
const keyPattern=new RegExp('^(task:'+uuid+'|new:('+uuid+')?)$');
function validate(value){
  if(!value || !keyPattern.test(value.key) || !Number.isSafeInteger(value.revision) || value.revision<1 || typeof value.text!=='string' || !Array.isArray(value.attachmentIds) || value.attachmentIds.some(id=>typeof id!=='string'||!new RegExp('^'+uuid+'$').test(id)))throw new Error('Borrador no válido.');
  if(value.workspace!==undefined && typeof value.workspace!=='string')throw new Error('Carpeta de borrador no válida.');
  return value;
}
export class DraftStore {
  constructor(directory){this.directory=path.join(directory,'drafts');fs.mkdirSync(this.directory,{recursive:true});this.items=new Map();this.issues=[];this.load();}
  filename(key){if(!keyPattern.test(key))throw new Error('Chat de borrador no válido.');return path.join(this.directory,crypto.createHash('sha256').update(key).digest('hex')+'.json');}
  load(){
    const files=new Set(fs.readdirSync(this.directory).filter(name=>/^[a-f0-9]{64}\.json(\.tmp|\.bak)?$/.test(name)).map(name=>name.replace(/\.(tmp|bak)$/,'')));
    for(const name of files){
      const primary=path.join(this.directory,name);let recovered=false;
      for(const candidate of [primary,primary+'.tmp',primary+'.bak']){
        try{
          const value=validate(JSON.parse(fs.readFileSync(candidate,'utf8')));
          if(this.filename(value.key)!==primary)throw new Error('Referencia de borrador incorrecta.');
          this.items.set(value.key,value);recovered=true;
          if(candidate!==primary)this.issues.push('Se recuperó un borrador desde una copia local.');
          break;
        }catch{}
      }
      if(!recovered)this.issues.push('Un borrador no se pudo leer; sus archivos originales se conservan.');
    }
  }
  list(){return {items:Object.fromEntries(this.items),issues:[...this.issues]};}
  save(input){
    validate(input);
    const current=this.items.get(input.key);
    // Late IPC responses and writes cannot resurrect a cleared or newer draft.
    if(current && input.revision<=current.revision)return current;
    const value={key:input.key,revision:input.revision,text:input.text,attachmentIds:[...new Set(input.attachmentIds)],workspace:input.workspace||'',updatedAt:new Date().toISOString()};
    const filename=this.filename(input.key),temporary=filename+'.tmp';
    if(fs.existsSync(filename)){
      try{validate(JSON.parse(fs.readFileSync(filename,'utf8')));fs.copyFileSync(filename,filename+'.bak');}
      catch{fs.copyFileSync(filename,filename+'.corrupt-'+Date.now());}
    }
    fs.writeFileSync(temporary,JSON.stringify(value));fs.renameSync(temporary,filename);
    this.items.set(value.key,value);return value;
  }
  clear(key,revision){
    const current=this.items.get(key);
    if(!current || current.revision!==revision)return current||null;
    return this.save({key,revision:revision+1,text:'',attachmentIds:[]});
  }
}
