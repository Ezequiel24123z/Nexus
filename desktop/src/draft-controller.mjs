// Compact per-chat draft persistence. Optional debounce reduces disk churn during fast typing
// while flush() always drains pending edits before send or window close.
export class DraftController {
  constructor(api,changed=()=>{},{debounceMs=0}={}){
    this.api=api;this.changed=changed;this.debounceMs=debounceMs;
    this.items={};this.status={};this.inflight=new Set();this.timers=new Map();this.pendingValues=new Map();this.ready=false;
  }
  async load(){const result=await this.api('getDrafts');this.items=result.items;this.ready=true;this.changed();return result.issues;}
  get(key){return this.items[key]||{key,text:'',attachments:[],revision:0};}
  track(promise){this.inflight.add(promise);promise.then(()=>this.inflight.delete(promise),()=>this.inflight.delete(promise));return promise;}
  update(key,change){
    if(!this.ready)throw new Error('Wait for saved drafts to finish loading.');
    const previous=this.get(key),value={...previous,...change,revision:previous.revision+1,key};
    this.items={...this.items,[key]:value};this.status={...this.status,[key]:'saving'};this.changed();
    if(this.debounceMs>0){
      clearTimeout(this.timers.get(key));
      this.pendingValues.set(key,value);
      this.timers.set(key,setTimeout(()=>{
        this.timers.delete(key);
        const latest=this.pendingValues.get(key);
        this.pendingValues.delete(key);
        if(latest)this.persist(latest);
      },this.debounceMs));
    } else {
      this.persist(value);
    }
    return value;
  }
  persist(value){
    const promise=this.api('saveDraft',{key:value.key,revision:value.revision,text:value.text,workspace:value.workspace||'',attachmentIds:value.attachments.map(item=>item.id)}).then(saved=>{
      if(this.get(value.key).revision===value.revision){
        if(saved.revision!==value.revision)throw new Error('The draft changed in another session. Reload to recover it.');
        this.status={...this.status,[value.key]:'saved'};this.changed();
      }
    }).catch(()=>{if(this.get(value.key).revision===value.revision){this.status={...this.status,[value.key]:'error'};this.changed();}});
    return this.track(promise);
  }
  flushPendingTimers(){
    for(const [key,timer] of [...this.timers.entries()]){
      clearTimeout(timer);this.timers.delete(key);
      const latest=this.pendingValues.get(key);this.pendingValues.delete(key);
      if(latest)this.persist(latest);
    }
  }
  async flush(){
    this.flushPendingTimers();
    while(this.inflight.size)await Promise.all([...this.inflight]);
    if(Object.values(this.status).includes('error'))throw new Error('Could not save a draft. Retry saving before closing or sending.');
  }
  async clear(key,revision){
    clearTimeout(this.timers.get(key));this.timers.delete(key);this.pendingValues.delete(key);
    const saved=await this.track(this.api('clearDraft',{key,revision}));
    if(saved && this.get(key).revision===revision){
      if(saved.revision!==revision+1||saved.text||saved.attachmentIds.length)throw new Error('The draft changed; keeping the latest version.');
      this.items={...this.items,[key]:{...saved,attachments:[]}};this.status={...this.status,[key]:'saved'};this.changed();
    }
  }
  retry(key){return this.persist(this.get(key));}
}
