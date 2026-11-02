// Every edit is sent immediately to the main process. Only compact per-chat draft files
// are written; typing never rewrites workspace.json or broadcasts chat snapshots.
export class DraftController {
  constructor(api,changed=()=>{}){this.api=api;this.changed=changed;this.items={};this.status={};this.inflight=new Set();this.ready=false;}
  async load(){const result=await this.api('getDrafts');this.items=result.items;this.ready=true;this.changed();return result.issues;}
  get(key){return this.items[key]||{key,text:'',attachments:[],revision:0};}
  track(promise){this.inflight.add(promise);promise.then(()=>this.inflight.delete(promise),()=>this.inflight.delete(promise));return promise;}
  update(key,change){
    if(!this.ready)throw new Error('Espera a que se recuperen los borradores.');
    const previous=this.get(key),value={...previous,...change,revision:previous.revision+1,key};
    this.items={...this.items,[key]:value};this.status={...this.status,[key]:'saving'};this.changed();
    this.persist(value);return value;
  }
  persist(value){
    const promise=this.api('saveDraft',{key:value.key,revision:value.revision,text:value.text,workspace:value.workspace||'',attachmentIds:value.attachments.map(item=>item.id)}).then(saved=>{
      if(this.get(value.key).revision===value.revision){
        if(saved.revision!==value.revision)throw new Error('El borrador cambió en otra sesión. Recarga para recuperarlo.');
        this.status={...this.status,[value.key]:'saved'};this.changed();
      }
    }).catch(()=>{if(this.get(value.key).revision===value.revision){this.status={...this.status,[value.key]:'error'};this.changed();}});
    return this.track(promise);
  }
  async flush(){while(this.inflight.size)await Promise.all([...this.inflight]);if(Object.values(this.status).includes('error'))throw new Error('No se pudo guardar un borrador. Reintenta el guardado antes de cerrar o enviar.');}
  async clear(key,revision){
    const saved=await this.track(this.api('clearDraft',{key,revision}));
    if(saved && this.get(key).revision===revision){
      if(saved.revision!==revision+1||saved.text||saved.attachmentIds.length)throw new Error('El borrador cambió; se conserva la versión más reciente.');
      this.items={...this.items,[key]:{...saved,attachments:[]}};this.status={...this.status,[key]:'saved'};this.changed();
    }
  }
  retry(key){return this.persist(this.get(key));}
}
