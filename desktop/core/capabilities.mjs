import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const functionTargets=['list_files','read_file','search_files','glob_files','grep_search','write_file','replace_text','multi_edit','apply_patch','git_operation','run_command','manage_process','web_fetch','invoke_connector','invoke_mcp','read_attachment','search_history','search_journal'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const metadata=entry=>({id:entry.id,kind:entry.kind,name:entry.name,description:entry.description,tags:entry.tags,enabled:entry.enabled,revision:entry.revision,updatedAt:entry.updatedAt});
export function catalogPage(items,{query='',offset=0,limit=24}={}){
 if(typeof query!=='string'||query.length>300||!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>50)throw new Error('Invalid library query.');
 const terms=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 const matches=items.filter(item=>terms.every(term=>[item.name,item.description,...(item.tags||[])].join(' ').toLocaleLowerCase().includes(term)));
 return {items:matches.slice(offset,offset+limit),total:matches.length,offset,next:offset+limit<matches.length?offset+limit:null};
}
export class CapabilityLibrary{
 constructor(directory){
   this.directory=path.join(directory,'capabilities');this.index=new Map();this.revision=0;this.issues=[];this.counts={skills:0,functions:0};
   fs.mkdirSync(this.directory,{recursive:true});
   for(const filename of fs.readdirSync(this.directory)){
     if(!/^[a-f0-9-]{36}\.json$/.test(filename))continue;
     try{const entry=this.read(filename.slice(0,-5));this.validate(entry);if(!Number.isSafeInteger(entry.revision)||entry.revision<1)throw new Error('Invalid revision');this.index.set(entry.id,metadata(entry));this.counts[entry.kind==='skill'?'skills':'functions']++;}
     catch{this.issues.push(filename);}
   }
 }
 summary(){return {total:this.index.size,...this.counts,revision:this.revision,damaged:this.issues.length};}
 filename(id){if(!validId(id))throw new Error('Invalid capability identifier.');return path.join(this.directory,id+'.json');}
 read(id){const filename=this.filename(id);if(fs.statSync(filename).size>160000)throw new Error('Capability definition is too large.');const entry=JSON.parse(fs.readFileSync(filename,'utf8'));if(entry.id!==id)throw new Error('Inconsistent capability identifier.');return entry;}
 validate(entry){
   if(!object(entry)||!['skill','function'].includes(entry.kind))throw new Error('Invalid capability kind.');
   if(typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>100)throw new Error('Provide a name of up to 100 characters.');
   if(typeof entry.description!=='string'||entry.description.length>600)throw new Error('Description supports up to 600 characters.');
   if(!Array.isArray(entry.tags)||entry.tags.length>20||entry.tags.some(tag=>typeof tag!=='string'||tag.length>40))throw new Error('Invalid tags.');
   if(typeof entry.enabled!=='boolean')throw new Error('Invalid capability enabled state.');
   if(entry.kind==='skill'&&(typeof entry.instructions!=='string'||!entry.instructions.trim()||entry.instructions.length>60000))throw new Error('Skill requires instructions of up to 60,000 characters.');
   if(entry.kind==='function'&&(!functionTargets.includes(entry.tool)||!object(entry.defaults)||JSON.stringify(entry.defaults).length>60000))throw new Error('Choose a supported tool and JSON default arguments of up to 60,000 characters.');
 }
 list({kind='all',includeDisabled=false,...options}={}){
   if(!['all','skill','function'].includes(kind))throw new Error('Invalid library kind.');
   return catalogPage([...this.index.values()].filter(item=>(kind==='all'||item.kind===kind)&&(includeDisabled||item.enabled)),options);
 }
 get(id,{includeDisabled=false}={}){
   const entry=this.read(id);this.validate(entry);
   if(!includeDisabled&&!entry.enabled)throw new Error('This capability is disabled.');return entry;
 }
 save(input){
   const id=input.id||crypto.randomUUID(),prior=input.id?this.get(id,{includeDisabled:true}):null;
   if(prior&&input.revision!==prior.revision)throw new Error('The definition changed. Reopen it before saving.');
   if(prior&&input.kind!==prior.kind)throw new Error('Cannot change the kind of an existing capability definition.');
   const entry={id,kind:input.kind,name:input.name?.trim(),description:input.description||'',tags:input.tags||[],enabled:input.enabled??true,
     revision:(prior?.revision||0)+1,updatedAt:new Date().toISOString(),...(input.kind==='skill'?{instructions:input.instructions}:{tool:input.tool,defaults:input.defaults})};
   this.validate(entry);
   if(Buffer.byteLength(JSON.stringify(entry,null,2))>160000)throw new Error('Definition exceeds 160 KB in UTF-8. Split instructions or use reference files.');
   if([...this.index.values()].some(item=>item.id!==id&&item.kind===entry.kind&&item.name.toLocaleLowerCase()===entry.name.toLocaleLowerCase()))throw new Error('A definition of this kind with that name already exists.');
   const target=this.filename(id);
   if(prior){const history=path.join(this.directory,'history',id);fs.mkdirSync(history,{recursive:true});const backup=path.join(history,prior.revision+'.json');if(!fs.existsSync(backup))fs.copyFileSync(target,backup,fs.constants.COPYFILE_EXCL);}
   const temp=target+'.'+crypto.randomUUID()+'.tmp',fd=fs.openSync(temp,'wx');
   try{fs.writeFileSync(fd,JSON.stringify(entry,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   fs.renameSync(temp,target);this.index.set(id,metadata(entry));if(!prior)this.counts[entry.kind==='skill'?'skills':'functions']++;this.revision++;return entry;
 }
 resolve(id,input={}){
   const entry=this.get(id);if(entry.kind!=='function'||!object(input))throw new Error('Invalid function or input.');
   return {tool:entry.tool,args:{...entry.defaults,...input},capability:{id:entry.id,name:entry.name,revision:entry.revision}};
 }
}
