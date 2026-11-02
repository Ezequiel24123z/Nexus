import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { baseTools, executeTool } from './tools.mjs';
import { aggregateUsage, normalizeUsage } from './telemetry.mjs';
import {citationsFromAnnotations, readCompletionStream} from './stream.mjs';
import {hydrateAttachmentReferences, materializeImageAttachment, materializeToolResult} from './artifacts.mjs';
import {AttachmentStore,attachmentMessage} from './attachments.mjs';
import {ResponseJournal} from './response-journal.mjs';
import {validateChatOptions} from './chat-options.mjs';
import {requestTools,affinitySession} from './model-request.mjs';
import {CapabilityLibrary} from './capabilities.mjs';
import {openApiRequest,validateOpenApiConnector} from './openapi.mjs';
import {modelConnection,completionRequest} from './providers.mjs';
import {isNetworkFailure,retryableNetworkFailure,networkFailure,providerHttpFailure} from './provider-errors.mjs';
import {setTimeout as retryDelay} from 'node:timers/promises';

const externalEffects=new Set(['write_file','replace_text','run_command','invoke_mcp','invoke_connector','desktop_action','create_connector','save_capability']);

// Sólo se conserva el resumen que el proveedor haya marcado explícitamente como tal.
export const reasoningToText = details => Array.isArray(details) ? details.map(item => item?.summary || '').filter(Boolean).join('\n\n') : '';

export const estimateTokens = (value, bytesPerToken = 3) => {
  let images = 0;
  const text = JSON.stringify(value, (key,item) => {
    if(item?.type === 'nexus_attachment' && item.attachment?.kind === 'image') {images++;return '[image]';}
    if(key === 'image_url') {images++;return '[image]';}
    return item;
  });
  // 3 bytes/token is deliberately cautious for mixed Spanish prose, code and JSON,
  // while avoiding the early compactions produced by the former 2-byte heuristic.
  return Math.ceil(Buffer.byteLength(text,'utf8') / bytesPerToken) + images * 2500;
};

export class Runtime extends EventEmitter {
  constructor(store, { getSecret, desktop, mcp, request = fetch } = {}) {
    super(); this.store = store; this.getSecret = getSecret; this.desktop = desktop; this.request = request;
    this.active = new Map(); this.approvals = new Map(); this.closed = false; this.desktopOwner = null;this.mcp=mcp;
    this.compacting=new Set();
    this.compressionControllers=new Map();
    this.attachments=new AttachmentStore(store);
  }
  changed(task=undefined) { this.store.save(task); this.emit('change'); }
  get capabilities(){return this._capabilities ||= new CapabilityLibrary(this.store.directory);}
  snapshot(activeTaskId=undefined) {
    const compressionThreshold=this.store.state.settings.contextWindow*this.store.state.settings.compressionPercent/100;
    return { ...this.store.state, connectors:activeTaskId===undefined?this.store.state.connectors:[],connectorCount:this.store.state.connectors.length,capabilities:this._capabilities?.summary()||{total:0,skills:0,functions:0,revision:0,damaged:0}, mcpStatus:this.mcp?.status({compact:activeTaskId!==undefined}) || {}, tasks: this.store.state.tasks.map(task => {
      // Background chats only need navigation/queue metadata. Do not even touch
      // their histories: those may be large and later backed by a disk index.
      if(activeTaskId!==undefined&&task.id!==activeTaskId)return {
        id:task.id,title:task.title,prompt:task.prompt,projectId:task.projectId,workspace:task.workspace,
        status:task.status,model:task.model,dependsOn:task.dependsOn,pinned:task.pinned,createdAt:task.createdAt,
        compacting:this.compacting.has(task.id),summaryOnly:true
      };
      const conversationStart=Math.max(0,task.conversation.length-120),eventsStart=Math.max(0,task.events.length-80);
      const contextTokens=task.contextTokens || 0;
      return {...task,messages:undefined,pendingImages:undefined,compacting:this.compacting.has(task.id),calls:(task.calls||[]).slice(-80),callsTotal:(task.calls||[]).length,callsStart:Math.max(0,(task.calls||[]).length-80),effects:(task.effects||[]).slice(-60),effectsTotal:(task.effects||[]).length,events:task.events.slice(eventsStart),eventsStart,eventsTotal:task.events.length,conversation:task.conversation.slice(conversationStart),conversationStart,conversationTotal:task.conversation.length,contextTokens,needsCompression:contextTokens>=compressionThreshold};
    }), approvals: [...this.approvals].filter(([,item])=>activeTaskId===undefined||item.taskId===activeTaskId).map(([id, item]) => ({ id, taskId: item.taskId, name: item.name, args: item.args })), hasKey: Boolean(this.getSecret(modelConnection(this.store.state.settings.model).key)), providerKeys:{arliai:Boolean(this.getSecret('ARLIAI_API_KEY')),openrouter:Boolean(this.getSecret('OPENROUTER_API_KEY'))} };
  }
  page(id, collection, before, limit) {
    const task=this.store.task(id);
    if(!['conversation','events','calls'].includes(collection))throw new Error('Colección no válida.');
    const values=task[collection]||[];
    limit=Math.max(1,Math.min(Number.isInteger(limit)?limit:120,200));
    before=before===undefined?values.length:before;
    if(!Number.isInteger(before)||before<0||before>values.length)throw new Error('Cursor no válido.');
    const start=Math.max(0,before-limit);
    return {items:values.slice(start,before),start,total:values.length,hasMore:start>0};
  }
  create({ prompt, workspace = '', model, dependsOn = [], title, projectId, attachmentIds=[] }) {
    const attachments=this.attachments.resolve(attachmentIds);
    if(!prompt?.trim()&&attachments.length)prompt='Analiza los archivos adjuntos.';
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100000) throw new Error('Describe una tarea de hasta 100.000 caracteres.');
    if (!Array.isArray(dependsOn) || dependsOn.some(id => !this.store.state.tasks.some(t => t.id === id))) throw new Error('Dependencia no válida.');
    const project = projectId && this.store.state.projects.find(p=>p.id===projectId);
    if(projectId && !project)throw new Error('Proyecto no encontrado');
    workspace = project?.workspace || workspace;
    const task = { id: crypto.randomUUID(), title: (title || prompt).slice(0, 80), prompt, workspace, projectId:projectId || null, engine:modelConnection(model || this.store.state.settings.model).id, model: model || this.store.state.settings.model,
      dependsOn, attachments, status: 'queued', createdAt: new Date().toISOString(), messages: [], conversation: [], events: [], effects: [], summary: '', compressions: 0, steps: 0, contextTokens: 0 };
    if (!task.model) throw new Error('Selecciona un modelo en ajustes.');
    if(!task.workspace&&attachments.length)task.workspace=this.attachments.workspace(task.id);
    this.store.state.tasks.unshift(task);
    this.store.transcript(task, attachmentMessage(prompt,attachments));
    task.conversation.push({ id:crypto.randomUUID(), role:'user', content: prompt, attachments });
    this.store.journal(task, 'created', { prompt, workspace:task.workspace, model: task.model, dependsOn });
    this.changed(task); this.schedule(); return task.id;
  }
  settings(input) {
    const s = {...this.store.state.settings};
    for (const [key,min,max] of [['compressionPercent',10,95],['concurrency',1,64],['contextWindow',8000,10000000],['maxSteps',0,1000000],['maxOutput',0,1000000],['webMaxResults',1,25],['webMaxUses',0,30]]) {
      if (input[key] !== undefined) {
        if (!Number.isFinite(input[key]) || input[key] < min || input[key] > max) throw new Error('Ajuste no válido: ' + key);
        s[key] = Math.round(input[key]);
      }
    }
    for (const key of ['autonomous','autoWorkspaceWrites','desktopEnabled','streaming','cacheAffinity']) if (typeof input[key] === 'boolean') s[key] = input[key];
    if(input.reasoningEffort!==undefined){
      if(!['auto','none','minimal','low','medium','high','xhigh','max'].includes(input.reasoningEffort))throw new Error('Nivel de razonamiento no válido');
      s.reasoningEffort=input.reasoningEffort;
    }
    if(input.providerRouting!==undefined){
      if(!['auto','price','throughput','latency'].includes(input.providerRouting))throw new Error('Preferencia de proveedor no válida');
      s.providerRouting=input.providerRouting;
    }
    if(typeof input.webSearchEnabled==='boolean')s.webSearchEnabled=input.webSearchEnabled;
    if(input.webSearchEngine!==undefined){
      if(!['auto','native','exa','firecrawl','parallel','perplexity'].includes(input.webSearchEngine))throw new Error('Motor de búsqueda no válido');
      s.webSearchEngine=input.webSearchEngine;
    }
    if(input.webSearchContext!==undefined){
      if(!['low','medium','high'].includes(input.webSearchContext))throw new Error('Contexto de búsqueda no válido');
      s.webSearchContext=input.webSearchContext;
    }
    if(typeof input.globalInstructions === 'string')s.globalInstructions=input.globalInstructions;
    if (typeof input.model === 'string' && input.model.length < 180) s.model = input.model;
    if(input.favoriteModels!==undefined){if(!Array.isArray(input.favoriteModels)||input.favoriteModels.length>100||input.favoriteModels.some(id=>typeof id!=='string'||!id.trim()||id.length>180))throw new Error('Lista de favoritos no válida.');s.favoriteModels=[...new Set(input.favoriteModels.map(id=>id.trim()))];}
    this.store.state.settings=s;
    this.changed(null); this.schedule();
  }
  schedule() {
    if (this.closed) return;
    for (const task of [...this.store.state.tasks].reverse()) {
      if (this.active.size >= this.store.state.settings.concurrency) break;
      if (task.status !== 'queued') continue;
      if (this.compacting.has(task.id)) continue;
      const dependencies = task.dependsOn.map(id => this.store.task(id));
      if (dependencies.some(t => t.status !== 'complete')) continue;
      // Whole-project lease prevents concurrent editing of the same checkout.
      if (task.workspace && [...this.active.keys()].some(id => this.store.task(id).workspace.toLowerCase() === task.workspace.toLowerCase())) continue;
      const controller = new AbortController();
      this.active.set(task.id, controller); task.status = 'running'; task.error = null;
      this.changed(task);
      void this.run(task, controller.signal).catch(error => {
        task.status = controller.signal.aborted ? 'paused' : 'failed';
        task.error = error.message;
        this.store.journal(task, 'stopped', { reason: error.message });
      }).finally(() => { this.active.delete(task.id); task.liveText='';task.liveReasoning='';task.liveActivity='';if(this.desktopOwner===task.id)this.desktopOwner=null; if(task.status==='complete'&&task.pendingFollowups>0){task.status='queued';task.error=null;} this.changed(task); this.schedule(); });
    }
  }
  updateChat(input){
    const task=this.store.task(input.id),options=validateChatOptions(input);
    if(Object.keys(options).some(key=>options[key]!==task[key])&&(this.active.has(task.id)||this.compacting.has(task.id)))throw new Error('Pausa la tarea y espera a que termine la llamada antes de cambiar modelo o thinking.');
    if(input.projectId&& !this.store.state.projects.some(project=>project.id===input.projectId))throw new Error('Proyecto no encontrado');
    Object.assign(task,options);
    if(typeof input.title==='string'&&input.title.trim())task.title=input.title.trim();
    if(typeof input.pinned==='boolean')task.pinned=input.pinned;
    if(input.projectId!==undefined)task.projectId=input.projectId||null;
    this.changed(task);return true;
  }
  pause(id) {
    const task = this.store.task(id);
    this.active.get(id)?.abort();
    this.compressionControllers.get(id)?.abort();
    if (!this.active.has(id)) task.status = 'paused';
    this.changed(task);
  }
  followup(task, text, attachments=[]) {
    task.conversation.push({id:crypto.randomUUID(),role:'user', content:text,attachments});
    (task.followupQueue ||= []).push(attachments.length?{text,attachments}:text);
    task.pendingFollowups=task.followupQueue.length;
    this.store.journal(task,'user_followup',{instruction:text,whileRunning:true});
    this.changed(task);
  }
  flushFollowups(task) {
    while(task.followupQueue?.length){
      const item=task.followupQueue.shift(),count=task.messages.length;
      task.pendingFollowups=task.followupQueue.length;
      try{this.store.transcript(task,typeof item==='string'?attachmentMessage(item):attachmentMessage(item.text,item.attachments));}
      catch(error){task.messages.length=count;task.followupQueue.unshift(item);task.pendingFollowups=task.followupQueue.length;throw error;}
    }
  }
  flushPendingImages(task){
    while(task.pendingImages?.length){
      const capture=task.pendingImages.shift(),count=task.messages.length;
      const description=capture.dimensions?'Captura guardada'+(capture.createdAt?' ('+capture.createdAt+')':'')+'; dimensiones: '+JSON.stringify(capture.dimensions):'Imagen adjunta: '+capture.name;
      try{this.store.transcript(task,{role:'user',content:[{type:'text',text:description},{type:'nexus_attachment',attachment:capture}]});}
      catch(error){task.messages.length=count;task.pendingImages.unshift(capture);throw error;}
    }
  }
  resume(id, instruction, attachmentIds=[]) {
    const task = this.store.task(id);
    const attachments=this.attachments.resolve(attachmentIds);
    if(!instruction?.trim()&&attachments.length)instruction='Analiza los archivos adjuntos.';
    if(attachments.length)task.attachments=[...new Map([...(task.attachments||[]),...attachments].map(item=>[item.id,item])).values()];
    if(attachments.length&&!task.workspace)task.workspace=this.attachments.workspace(task.id);
    if (this.active.has(id) || this.compacting.has(id)) {
      if (!instruction?.trim()) throw new Error('La tarea aún está deteniéndose.');
      this.followup(task, instruction.trim(),attachments);
      if(!this.active.has(id)){task.status='queued';this.changed(task);}
      return;
    }
    this.repairInterruptedCalls(task);
    this.flushPendingImages(task);
    this.flushFollowups(task);
    if (instruction?.trim()) {
      this.store.transcript(task, attachmentMessage(instruction.trim(),attachments));
      task.conversation.push({id:crypto.randomUUID(),role:'user', content:instruction.trim(),attachments});
      this.store.journal(task,'user_followup',{instruction:instruction.trim()});
    } else if (task.status === 'complete') throw new Error('Escribe una instrucción para continuar una tarea completada.');
    task.status = 'queued'; task.error = null; this.changed(task); this.schedule();
  }
  approve(id, allowed) {
    const pending = this.approvals.get(id);
    if (!pending) throw new Error('Aprobación caducada.');
    pending.resolve(Boolean(allowed));
  }
  approval(task, name, args, signal) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const finish = (allowed) => {
        signal.removeEventListener('abort', cancel); this.approvals.delete(id);
        task.status = 'running';
        this.store.journal(task, 'approval', { name, allowed });
        this.changed(task); resolve(allowed);
      };
      const cancel = () => { this.approvals.delete(id); this.changed(task); reject(new Error('Cancelado')); };
      if (signal.aborted) return cancel();
      signal.addEventListener('abort', cancel, { once: true });
      this.approvals.set(id, { taskId: task.id, name, args, resolve:finish }); task.status = 'approval'; this.changed(task);
    });
  }
  needsApproval(name) {
    if(['search_capabilities','get_capability','get_connector'].includes(name))return false;
    if(this.store.state.settings.autonomous)return false;
    if (['list_attachments','read_attachment','list_files','read_file','search_files','document_progress','search_journal','search_history','list_connectors','read_checkpoint'].includes(name)) return false;
    if (['write_file','replace_text'].includes(name) && this.store.state.settings.autoWorkspaceWrites) return false;
    return true;
  }
  async completion(messages, task, signal, { tools = true, maxOutput, effort, acceptTruncated } = {}) {
    const connection=modelConnection(task.model);
    const key = this.getSecret(connection.key);
    if (!key) throw new Error('Añade tu clave de '+connection.name+' en Ajustes.');
    const settings = {...this.store.state.settings,model:task.model,reasoningEffort:task.reasoningEffort??this.store.state.settings.reasoningEffort,providerRouting:task.providerRouting??this.store.state.settings.providerRouting};
    const started=Date.now();
    const streamingMode=Boolean(settings.streaming);
    const guard=new AbortController();
    let lastActivity=Date.now();
    const bump=()=>{lastActivity=Date.now();};
    const hardCap=setTimeout(()=>guard.abort(new DOMException('Tiempo máximo de generación superado.','TimeoutError')),streamingMode?1800000:900000);
    const idleTimer=streamingMode?setInterval(()=>{if(Date.now()-lastActivity>120000)guard.abort(new DOMException('El proveedor dejó de enviar datos durante 120 s.','TimeoutError'));},5000):null;
    const responseId=crypto.randomUUID();
    const responseJournal=tools?new ResponseJournal(this.store.directoryFor(task.id),responseId):null;
    let record=normalizeUsage(undefined,{id:crypto.randomUUID(),responseId,model:task.model,kind:tools?'generation':'compression',status:'pending',sessionAffinity:connection.id==='openrouter'&&settings.cacheAffinity===true});
    let attemptStarted=started, receivedOutput=false;
    task.calls ||= [];task.calls.push(record);task.liveText='';task.liveActivity='Consultando el modelo…';
    const account=()=>{task.telemetry=aggregateUsage(task.calls);task.lastTurnTelemetry=aggregateUsage(task.calls.slice(task.turnCallStart||0));};
    account();this.changed(task);
    let lastPaint=0;
    try{
    const outputLimit=maxOutput ?? settings.maxOutput;
    const selectedTools=requestTools(settings);
    const spec=completionRequest({model:task.model,messages,settings,tools:tools?selectedTools:undefined,outputLimit,effort,sessionId:settings.cacheAffinity?affinitySession(task,tools):undefined});
    const send = () => this.request(connection.base+'/chat/completions', {
      method:'POST', headers:{Authorization:'Bearer ' + key,...spec.headers},
      body:JSON.stringify(spec.body),
      signal: AbortSignal.any([signal, guard.signal])
    });
    const streamOptions={
      onActivity:bump,
      onMetadata:metadata=>{if(metadata.id)record.id=metadata.id;if(metadata.model)record.model=metadata.model;responseJournal?.call(record);},
      onOutput:()=>{receivedOutput=true;},
      onText:text=>{
        bump();
        if(!tools)return;task.liveText=text;if(!record.firstTokenMs)record.firstTokenMs=Date.now()-started;responseJournal.update(text);
        if(Date.now()-lastPaint>100){lastPaint=Date.now();this.emit('change');}
      },
      onReasoning:text=>{
        bump();
        if(!tools)return;task.liveReasoning=text;task.liveActivity='El modelo ha actualizado su resumen de razonamiento.';
        if(Date.now()-lastPaint>100){lastPaint=Date.now();this.emit('change');}
      },
      onUsage:usage=>{bump();for(const [key,value] of Object.entries(normalizeUsage(usage)))if(value!==null)record[key]=value;responseJournal?.call(record);}};
    const readBody=res=>res.headers.get('content-type')?.includes('text/event-stream')?readCompletionStream(res,streamOptions):res.json();
    let data;
    for(let attempt=0;attempt<2;attempt++) {
      let reading=false;
      try {
        const response=await send();bump();
        if(!response.ok){await response.body?.cancel().catch(()=>{});throw providerHttpFailure(response.status,connection.name);}
        reading=true;data=await readBody(response);break;
      } catch(error) {
        const network=isNetworkFailure(error);
        // One shared retry budget for connection failures, unavailable upstreams
        // and streams cut before output. Never replay text, reasoning or tool calls.
        const retryable=network?retryableNetworkFailure(error):reading||error.retryable===true;
        if(attempt>0||!retryable||signal.aborted||guard.signal.aborted||receivedOutput||task.liveText||responseJournal?.error||!error?.message)throw network&&!signal.aborted&&!guard.signal.aborted?networkFailure(error,connection.name):error;
        record.status='failed';record.latencyMs=Date.now()-attemptStarted;
        const priorId=record.id;
        record=normalizeUsage(undefined,{id:crypto.randomUUID(),responseId,model:task.model,kind:tools?'generation':'compression',status:'pending',retried:true,retryOf:priorId,sessionAffinity:connection.id==='openrouter'&&settings.cacheAffinity===true});
        task.calls.push(record);attemptStarted=Date.now();task.liveActivity='La conexión falló. Reintentando una vez…';account();this.changed(task);
        if(network||error.retryable)await retryDelay(750,undefined,{signal:AbortSignal.any([signal,guard.signal])});
      }
    }
    for(const [key,value] of Object.entries(normalizeUsage(data.usage)))if(value!==null)record[key]=value;
    Object.assign(record,{id:data.id||record.id,model:data.model||task.model,status:'complete',router:data.openrouter_metadata||null});
    this.calibrate(task, messages, tools, data.usage?.prompt_tokens,selectedTools);
    const message = data.choices?.[0]?.message;
    if(data.error)throw new Error('El proveedor devolvió un error durante la generación.');
    if(tools&&message?.content){task.liveText=message.content;responseJournal.update(message.content);}
    signal.throwIfAborted();guard.signal.throwIfAborted();
    const citations=citationsFromAnnotations(message?.annotations);
    if(data.choices?.[0]?.finish_reason==='length'){
      if(tools&&message?.content)task.liveText=message.content;
      if(acceptTruncated&&typeof message?.content==='string'&&message.content.trim().length>=20)return { message:{ role:'assistant', content:message.content, ...(message.reasoning_details?{reasoning_details:message.reasoning_details}:{}), ...(citations.length?{sources:citations}:{}) }, usage:data.usage, truncated:true };
      throw new Error('El modelo agotó su presupuesto de salida antes de terminar. El texto parcial, si lo hubo, se conserva; puedes continuar con una instrucción o subir los tokens máximos de respuesta.');
    }
    if (!message || (!message.content && !message.tool_calls?.length)) throw new Error('El proveedor devolvió una respuesta vacía.');
    return { responseId, message: { role:'assistant', content:message.content || null, ...(message.reasoning_details ? {reasoning_details:message.reasoning_details} : {}), ...(message.tool_calls?.length ? { tool_calls:message.tool_calls } : {}), ...(citations.length ? {sources:citations} : {}) }, usage:data.usage };
    }catch(error){const guardFired=guard.signal.aborted&&!signal.aborted;const timedOut=guardFired&&(error?.name==='TimeoutError'||error?.name==='AbortError'||/aborted due to timeout/i.test(error?.message||''));record.status=signal.aborted?'interrupted':'failed';if(task.liveText){task.conversation.push({id:responseId,role:'assistant',content:task.liveText+'\n\n[Respuesta interrumpida; no completada.]'});this.store.journal(task,'partial_response',{text:task.liveText});}if(timedOut)throw new Error('El proveedor dejó de responder a tiempo (lentitud o límite de generación). El texto parcial, si lo hubo, se conservó; puedes continuar la tarea.');throw error;}
    finally{clearTimeout(hardCap);if(idleTimer)clearInterval(idleTimer);responseJournal?.close();record.latencyMs=Date.now()-attemptStarted;task.liveText='';task.liveReasoning='';task.liveActivity='';account();this.changed(task);}
  }
  // El ratio real medido varía entre ~2,6 y ~3,2 B/token según el contenido.
  // Un divisor fijo de 3 comprime tarde con payloads ASCII y pronto con texto denso:
  // se aprende de cada respuesta real y se acota para no oscilar.
  calibrate(task, messages, tools, promptTokens,toolSchema=requestTools({...this.store.state.settings,model:task.model})) {
    if (!Number.isFinite(promptTokens) || promptTokens <= 0) return;
    // Image pricing/tokenization depends on the provider. Its base64 byte size must never
    // train the text-only ratio and make the next text request look artificially smaller.
    if(messages.some(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url'||part.type==='nexus_attachment')))return;
    const bytes = Buffer.byteLength(JSON.stringify({ messages, ...(tools ? { tools: toolSchema } : {}) }), 'utf8');
    const observed = bytes / promptTokens;
    if (!Number.isFinite(observed) || observed <= 0) return;
    const clamped = Math.min(4.2, Math.max(2.6, observed));
    task.bytesPerToken = task.bytesPerToken ? +(task.bytesPerToken * .7 + clamped * .3).toFixed(3) : +clamped.toFixed(3);
  }
  estimate(task, value) { return estimateTokens(value, task?.bytesPerToken || 3); }
  scrubMessages(messages = [], {compact=false} = {}) {
    // Los detalles de reasoning sólo pertenecen a la respuesta original del proveedor.
    // Nunca deben entrar en contexto normal ni en el material de una compresión por bloques.
    return messages.map(message => {
      // Sources are preserved for the UI/history but are display metadata, not an
      // OpenRouter message field.  Reasoning details are likewise never resent.
      const {reasoning_details, sources, ...rest}=message;
      if(compact && Array.isArray(rest.content))rest.content=rest.content.map(part=>part.type==='image_url'?{type:'text',text:'[Imagen del historial original; consultar el checkpoint para recuperarla.]'}:part);
      if(compact && sources?.length)rest.sources=sources;
      return rest;
    });
  }
  compactionTail(task, messages = []) {
    // Mantener un pequeño tramo reciente conserva el estado inmediato de herramientas sin
    // convertir cada compresión en un borrado total del trabajo que acaba de ocurrir.
    const budget=Math.max(3000,Math.min(12000,Math.floor(this.store.state.settings.contextWindow*.16)));
    let start=messages.length,tokens=0;
    for(let index=messages.length-1;index>=0;index--){
      const weight=this.estimate(task,this.scrubMessages([messages[index]]));
      if(tokens+weight>budget){
        if(start===messages.length)return {archived:messages,tail:[]};
        break;
      }
      start=index;tokens+=weight;
    }
    // Si todo cabe en el tramo, una compactación manual sigue creando un checkpoint útil.
    if(start===0)return {archived:messages,tail:[]};
    // Un resultado de herramienta sin su llamada asistente no es un historial válido.
    if(messages[start]?.role==='tool'){
      let call=start-1;while(call>=0&&messages[call].role==='tool')call--;
      if(messages[call]?.role==='assistant')start=call;
    }
    // Si el límite cae justo antes de una respuesta normal, es preferible conservar la
    // siguiente instrucción de usuario que arrastrar una petición antigua y enorme.
    if(messages[start]?.role==='assistant'&&!messages[start]?.tool_calls)start++;
    return {archived:messages.slice(0,start),tail:messages.slice(start)};
  }
  refreshProgressReminder(task) {
    const last = Number.isInteger(task.lastProgressStep) ? task.lastProgressStep : 0;
    if (task.steps < 12 || task.steps - last < 12 || task.progressDue) return;
    task.progressDue = true;
    this.store.journal(task, 'progress_due', {step:task.steps, sinceStep:last, note:'Documenta decisiones, cambios, verificacion y siguiente accion antes de continuar trabajo largo.'});
  }
  buildContext(task, {hydrate=true,inspect=false} = {}) {
    const dependencyContext = task.dependsOn.map(id => { const t = this.store.task(id); return { title:t.title, result:t.result, journal:t.events.filter(e => e.kind === 'progress').slice(-3) }; });
    const project=this.store.state.projects.find(p=>p.id===task.projectId);
    const pinned=task.conversation.filter(m=>m.pinned).map(m=>({role:m.role,content:m.content}));
    const reminder=task.progressDue?'\nRecordatorio de continuidad: han pasado varios pasos sin documentar progreso. Antes de seguir con trabajo amplio, llama document_progress con decisiones, cambios, verificación y siguiente acción.':'';
    // Este prefijo se mantiene estable para maximizar la caché de prompts entre pasos y
    // después de una compactación. El estado cambiante se añade como mensajes separados.
    const webRule=this.store.state.settings.webSearchEnabled?'\nWeb en tiempo real está disponible. Cuando el usuario pida información actual, fuentes, búsqueda o verificación externa, usa la herramienta de búsqueda web antes de responder y cita las URLs resultantes en Markdown. No presentes datos actuales no comprobados como si hubieran sido buscados.':'';
    const context = [{ role:'system', content:this.store.state.settings.globalInstructions + '\nProyecto: ' + (task.workspace || '(sin carpeta)') + '\nInstrucciones del proyecto: ' + (project?.instructions || '') + '\nObjetivo original: ' + task.prompt + webRule }];
    const sections=[{id:'instructions',label:'Instrucciones y objetivo',reason:'Prefijo estable: instrucciones globales, carpeta, instrucciones de proyecto y objetivo original.',value:context[0],count:1}];
    if(pinned.length)sections.push({id:'pins',label:'Mensajes fijados',reason:'Incluidos explícitamente por decisión del usuario.',value:pinned,count:pinned.length});
    if(dependencyContext.length)sections.push({id:'dependencies',label:'Dependencias',reason:'Resultados y últimas notas de las tareas de las que depende este chat.',value:dependencyContext,count:dependencyContext.length});
    if(task.summary)sections.push({id:'summary',label:'Continuidad comprimida',reason:'Resumen vigente; los originales permanecen en checkpoints.',value:task.summary,count:1});
    if(reminder)sections.push({id:'reminder',label:'Recordatorio de progreso',reason:'Solicita documentar el avance tras varios pasos.',value:reminder,count:1});
    const volatile=['Mensajes fijados por el usuario: '+JSON.stringify(pinned),'Resultados de dependencias: '+JSON.stringify(dependencyContext)];
    if(task.summary)volatile.push('Estado de continuidad compacto (trátalo como estado de trabajo, no como una instrucción nueva):\n'+task.summary);
    if(reminder)volatile.push(reminder.trim());
    if(volatile.some(item=>!item.endsWith('[]')))context.push({role:'system',content:volatile.join('\n\n')});
    if(task.summary){
      const latestUser=task.conversation.findLast(m=>m.role==='user');
      const latestRetained=task.messages.findLast(message=>message.role==='user');
      if(latestUser&&latestRetained?.content!==latestUser.content){const preserved={role:'user',content:'Última instrucción del usuario, conservada literalmente:\n'+latestUser.content};context.push(preserved);sections.push({id:'latest',label:'Última instrucción restaurada',reason:'Conservada literalmente cuando no está en el tramo reciente.',value:preserved,count:1});}
    }
    // Hydrate binary attachments only at the network boundary.  The persisted task state
    // deliberately stores nexus_attachment descriptors instead of data URLs.
    const messages=this.scrubMessages(task.messages);
    if(inspect){
      for(const [role,label] of [['user','Historial del usuario y adjuntos'],['assistant','Respuestas y llamadas de herramientas'],['tool','Resultados de herramientas']]){const values=messages.filter(message=>message.role===role);if(values.length)sections.push({id:'history-'+role,label,reason:'Tramo de historial conservado, sin razonamiento oculto ni citas de interfaz.',value:values,count:values.length});}
      return {messages:context.concat(messages),sections};
    }
    return context.concat(hydrate?messages.map(message => hydrateAttachmentReferences(this.store,task,message)):messages);
  }
  // Un resumen cortado a la mitad pierde detalle de forma irreversible. En lugar de
  // aceptarlo con una nota, se devuelve el corte al modelo y se le pide continuar
  // exactamente donde quedó; si aun así queda incompleto, se registra compression_degraded
  // y los mensajes originales siguen íntegros en el checkpoint.
  async continuationCompletion(messages, task, signal, { maxOutput, attempts, continuationPrompt }) {
    let text = '', truncated = false, continuations = 0;
    const thread = [...messages];
    for (let attempt = 0; attempt <= attempts; attempt++) {
      const { message, truncated: cut } = await this.completion(thread, task, signal, { tools:false, maxOutput, effort:'none', acceptTruncated:true });
      const piece = typeof message.content === 'string' ? message.content.trim() : '';
      // En una continuación, la palabra COMPLETO confirma que ya no falta nada.
      if (attempt > 0 && /^COMPLETO\b/i.test(piece)) { truncated = false; break; }
      if (piece.length < 20) throw new Error('El resumen de continuidad fue insuficiente. Historial conservado; reanuda para reintentar.');
      text = text ? text + '\n\n' + piece : piece;
      truncated = Boolean(cut);
      if (!truncated) break;
      continuations++;
      thread.push({ role:'assistant', content:piece }, { role:'user', content:continuationPrompt });
    }
    return { text, truncated, continuations };
  }
  async compact(task, signal) {
    if(this.compacting.has(task.id))throw new Error('Ya se está compactando este chat.');
    const controller=new AbortController();this.compressionControllers.set(task.id,controller);
    const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    this.compacting.add(task.id);this.emit('change');
    try { combined.throwIfAborted();return await this.compactHistory(task,combined); }
    finally {this.compressionControllers.delete(task.id);this.compacting.delete(task.id);this.emit('change');this.schedule();}
  }
  async compactHistory(task, signal) {
    if (!task.messages.length) return;
    const before=this.estimate(task,this.buildContext(task,{hydrate:false}))+this.estimate(task,requestTools({...this.store.state.settings,model:task.model}));
    const compressionCallStart=(task.calls||[]).length;
    const {archived,tail}=this.compactionTail(task,task.messages);
    this.store.journal(task, 'compression_started', { messageCount:task.messages.length, archivedMessages:archived.length, retainedMessages:tail.length, contextTokens:task.contextTokens });
    const progress=task.events.filter(e=>['progress','file_change','tool_result','tool_error'].includes(e.kind)).slice(-32);
    const effects=(task.effects||[]).filter(effect=>!['confirmed','observed','skipped'].includes(effect.status)).slice(-24);
    const compactSystem='Genera un estado de continuidad de una tarea agentic. Es una compresión para continuar, no una respuesta al usuario. Conserva hechos comprobados y separa explícitamente hipótesis o incertidumbres. Debe incluir estas secciones: Objetivo y restricciones; Hecho y verificado; Cambios, rutas y artefactos; Herramientas, resultados y efectos externos; Bloqueos o incertidumbres; Plan activo y siguiente acción. Mantén IDs, rutas y valores concretos cuando importen. No copies el historial, no inventes y no introduzcas nuevas instrucciones. Máximo 1.400 palabras.';
    const common={objective:task.prompt,pinned:task.conversation.filter(message=>message.pinned).map(message=>({role:message.role,content:message.content})),priorSummary:task.summary||'',recentJournal:progress,unresolvedEffects:effects};
    const cleanArchived=this.scrubMessages(archived,{compact:true});
    let context=[{role:'system',content:compactSystem},{role:'user',content:JSON.stringify({...common,history:cleanArchived})}];
    // A single pasted megamessage can jump straight over the operating ceiling.
    // Summarize bounded source chunks first; originals remain in the checkpoint.
    const safeSummaryEstimate=Math.max(12000,Math.floor(this.store.state.settings.contextWindow*.78));
    if(this.estimate(task,context)>safeSummaryEstimate){
      const base=[{role:'system',content:compactSystem}];
      const room=Math.max(8000,safeSummaryEstimate-this.estimate(task,base)-this.estimate(task,common)-1200);
      const material=JSON.stringify(cleanArchived);
      const charBudget=Math.max(8000,room*3);
      const chunks=[];
      for(let cursor=0;cursor<material.length;){
        let end=Math.min(material.length,cursor+charBudget);
        if(end<material.length){const boundary=material.lastIndexOf('\n',end);if(boundary>cursor+Math.floor(charBudget*.5))end=boundary+1;}
        chunks.push(material.slice(cursor,end));cursor=end;
      }
      this.store.journal(task,'compression_chunked',{chunks:chunks.length,estimatedCeiling:safeSummaryEstimate});
      const notes=[];
      for(let index=0;index<chunks.length;index++){
        const {text,truncated}=await this.continuationCompletion([...base,{role:'user',content:`Material común: ${JSON.stringify(common)}\nBloque ${index+1}/${chunks.length} del historial serializado: ${chunks[index]}\nExtrae notas fieles para un estado de continuidad. No copies el bloque. Máximo 900 palabras; termina con "Pendientes".`}],task,signal,{maxOutput:2000,attempts:1,continuationPrompt:'Tu respuesta anterior se cortó. Continúa el mismo bloque de notas exactamente donde quedó, sin repetir lo ya escrito, y cierra con la sección "Pendientes".'});
        notes.push(`### Bloque ${index+1}${truncated?' (incompleto)':''}\n${text}`);
      }
      context=[...base,{role:'user',content:'Material común: '+JSON.stringify(common)+'\nUne estas notas parciales en un único estado de continuidad, conservando detalles concretos y señalando incertidumbres.\n\nNOTAS PARCIALES:\n'+notes.join('\n\n')}];
    }
    const {text:summaryText,truncated,continuations} = await this.continuationCompletion(context,task,signal,{maxOutput:6000,attempts:2,continuationPrompt:'Tu documento anterior se cortó al agotar el límite de salida. Continúa exactamente donde quedó, sin repetir lo ya escrito y sin resumirlo de nuevo. Si el documento ya estaba completo, responde sólo con la palabra COMPLETO.'});
    signal.throwIfAborted();
    if(truncated)this.store.journal(task,'compression_degraded',{continuations,note:'El resumen quedó incompleto incluso tras pedir la continuación; los mensajes originales están en el checkpoint.'});
    const finalSummary = truncated ? summaryText + '\n\n(Nota: el resumen se truncó incluso tras pedir su continuación; puede faltar detalle. Los originales completos están en los checkpoints y en read_checkpoint.)' : summaryText;
    const after=this.estimate(task,this.buildContext({...task,summary:finalSummary,messages:tail},{hydrate:false}))+this.estimate(task,requestTools({...this.store.state.settings,model:task.model}));
    const compressionUsage=aggregateUsage((task.calls||[]).slice(compressionCallStart));
    this.store.checkpoint(task, finalSummary, tail, {before,after,estimated:true,truncated,cost:compressionUsage.cost,unknownCosts:compressionUsage.unknownCosts,archivedMessages:archived.length,retainedMessages:tail.length});
    // A manual compaction also invalidates the pre-compaction provider count.
    // Otherwise resuming can immediately pay for a second, unnecessary summary.
    task.lastInputTokens=0;
    task.contextTokens = this.estimate(task,this.buildContext(task,{hydrate:false}))+this.estimate(task,requestTools({...this.store.state.settings,model:task.model}));
    task.lastCompression={at:new Date().toISOString(),before,after:task.contextTokens,estimated:true,continuations,truncated,cost:compressionUsage.cost,unknownCosts:compressionUsage.unknownCosts,archivedMessages:archived.length,retainedMessages:tail.length};
    this.changed(task);
  }
  repairInterruptedCalls(task) {
    // Resolve unfinished calls after interruption without replaying an external action.
    const lastAssistant = task.messages.findLast(m => m.tool_calls);
    if (lastAssistant) {
      for (const call of lastAssistant.tool_calls) {
        if (!task.messages.some(m => m.tool_call_id === call.id)) this.store.transcript(task, {role:'tool',tool_call_id:call.id,content:'Interrumpida: verifica el diario y el estado real antes de repetir. Puede haber efectos parciales.'});
      }
    }
  }
  async run(task, signal) {
    task.turnCallStart=task.calls?.length || 0;
    this.repairInterruptedCalls(task);
    this.flushPendingImages(task);
    const maxSteps = this.store.state.settings.maxSteps;
    for (let step = 0; !maxSteps || step < maxSteps; step++) {
      signal.throwIfAborted();
      this.flushFollowups(task);
      this.refreshProgressReminder(task);
      task.liveActivity=step ? 'Revisando los resultados y preparando el siguiente paso…' : 'Analizando la solicitud y preparando el plan…';
      this.changed(task);
      const settings = this.store.state.settings;
      task.contextTokens = Math.max(this.estimate(task, this.buildContext(task,{hydrate:false})) + this.estimate(task, requestTools({...this.store.state.settings,model:task.model})), task.lastInputTokens || 0);
      // This is an operating ceiling, not the provider's native context window.
      // Compact before the configured fraction of it; output headroom belongs to the post-compaction turn.
      const threshold = settings.contextWindow * settings.compressionPercent / 100;
      if (task.contextTokens >= threshold) { await this.compact(task, signal); task.lastInputTokens = 0; }
      if (this.estimate(task, this.buildContext(task,{hydrate:false})) + this.estimate(task, requestTools({...this.store.state.settings,model:task.model})) > settings.contextWindow) throw new Error('El contexto no cabe después de comprimir. Aumenta el techo o divide la tarea; se ha conservado el historial.');
      const {message, usage,responseId} = await this.completion(this.buildContext(task), task, signal);
      task.steps++; task.lastInputTokens = usage?.prompt_tokens || 0; task.usage = (task.usage || 0) + (usage?.total_tokens || 0);
      this.store.transcript(task, message);
      const stepReasoning=reasoningToText(message.reasoning_details);
      if (message.content) task.conversation.push({id:responseId,role:'assistant',content:message.content,reasoning:stepReasoning,sources:message.sources,step:task.steps||undefined,telemetry:task.lastTurnTelemetry});
      else if (stepReasoning) task.conversation.push({id:responseId,role:'assistant',content:null,reasoning:stepReasoning,sources:message.sources,step:task.steps||undefined,telemetry:task.lastTurnTelemetry});
      task.contextTokens=this.estimate(task,this.buildContext(task,{hydrate:false}))+this.estimate(task,requestTools({...this.store.state.settings,model:task.model}));
      this.changed(task);
      if (!message.tool_calls?.length) {
        task.result = message.content; task.status = 'complete';
        this.store.journal(task, 'complete', { result:message.content });
        return;
      }
      for (const call of message.tool_calls) {
        signal.throwIfAborted();
        let result,effect;
        try {
          if (!baseTools.some(t => t.function.name === call.function.name)) throw new Error('Herramienta desconocida');
          let args = JSON.parse(call.function.arguments);
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Argumentos inválidos');
          let name = call.function.name;
          if(name==='invoke_function'){
            const resolved=this.capabilities.resolve(args.id,args.input);
            name=resolved.tool;args=resolved.args;
            this.store.journal(task,'function_resolved',{...resolved.capability,tool:name});
          }
          if(name.startsWith('desktop_')) {
            if(this.desktopOwner && this.desktopOwner !== task.id) throw new Error('Otro agente está utilizando el escritorio. Continúa con trabajo independiente o termina y reanuda después.');
            this.desktopOwner = task.id;
          }
          if (this.needsApproval(name) && !(await this.approval(task, name, args, signal))) result = { denied:true, reason:'El usuario rechazó esta acción. Respeta la decisión.' };
          else {
            this.store.journal(task, 'tool_intent', {name,args});
            if(externalEffects.has(name)){
              effect=this.store.beginEffect(task,name,args);
              this.store.updateEffect(task,effect.id,'dispatched');
            }
            task.liveActivity='Ejecutando '+name.replaceAll('_',' ')+'…';
            this.changed(task);
            result = await executeTool(this, task, name, args, signal, effect);
          }
          if (result?.image) {
            const attachment=await materializeImageAttachment(this.store,task,result.image,{dimensions:result.dimensions,name:result.name||'captura-de-escritorio'});
            // Persist the pending image with the tool result; a pause between tools must
            // not lose the capture or inject it in the middle of unresolved tool calls.
            task.pendingImages ||= [];
            task.pendingImages.push(attachment);
            this.store.journal(task, 'tool_result', {name, result:'Captura guardada como adjunto local', attachment});
            this.store.transcript(task, {role:'tool',tool_call_id:call.id, content:JSON.stringify({captured:true,dimensions:result.dimensions})});
            if(effect)this.store.updateEffect(task,effect.id,'observed',{artifact:attachment});
            // Attach image after all tool results, preserving a valid tool-call transcript.
            continue;
          }
          const materialized=await materializeToolResult(this.store,task,name,result);
          this.store.journal(task, 'tool_result', {name, result:materialized.journal});
          if(effect)this.store.updateEffect(task,effect.id,'observed',{artifact:materialized.artifact || null});
          task.liveActivity='Verificando el resultado de '+name.replaceAll('_',' ')+'…';
          result=materialized.model;
        } catch (error) {
          if (signal.aborted) { if(effect)this.store.updateEffect(task,effect.id,'uncertain',{note:'La tarea se pausó antes de observar un resultado verificable.'}); throw error; }
          if(effect)this.store.updateEffect(task,effect.id,'uncertain',{note:'La ejecución devolvió un error o se interrumpió antes de observar un resultado verificable.',error:error.message});
          result = {error:error.message}; this.store.journal(task, 'tool_error', {name:call.function.name,error:error.message});
        }
        const serialized = typeof result === 'string' ? result : JSON.stringify(result);
        this.store.transcript(task, {role:'tool',tool_call_id:call.id,content:serialized});
        this.changed(task);
      }
      this.flushPendingImages(task);
    }
    throw new Error('Límite de pasos alcanzado. El progreso está guardado; puedes continuar.');
  }
  validateConnector(connector) {
    if (!connector || typeof connector.name !== 'string' || !/^[\w -]{1,80}$/.test(connector.name)) throw new Error('Nombre de conector no válido.');
    const url = new URL(connector.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Usa una URL HTTPS sin credenciales.');
    if (!['GET','POST','PUT','PATCH','DELETE'].includes(connector.method)) throw new Error('Método no admitido');
    if (connector.secretRef && !/^CONNECTOR_[A-Z0-9_]+$/.test(connector.secretRef)) throw new Error('El secreto debe empezar por CONNECTOR_.');
    if(connector.idempotencyHeader !== undefined && typeof connector.idempotencyHeader !== 'boolean')throw new Error('Configuración de idempotencia no válida.');
    if(connector.openapi)validateOpenApiConnector(connector);
    if(connector.reconciliationUrl){
      if(typeof connector.reconciliationUrl !== 'string')throw new Error('URL de conciliación no válida.');
      const check=new URL(connector.reconciliationUrl.replaceAll('{operationId}','00000000-0000-0000-0000-000000000000'));
      if(check.protocol!=='https:'||check.username||check.password)throw new Error('La URL de conciliación debe ser HTTPS y no incluir credenciales.');
    }
  }
  connectorHeaders(connector) {
    const headers={'Content-Type':'application/json'};
    if (connector.secretRef) {
      const secret = this.getSecret(connector.secretRef);
      if (!secret) throw new Error('Configura el secreto ' + connector.secretRef);
      headers.Authorization = 'Bearer ' + secret;
    }
    return headers;
  }
  async invokeConnector(args, signal, effect) {
    const connector = this.store.state.connectors.find(c => c.name === args.name);
    if (!connector) throw new Error('Conector no encontrado');
    this.validateConnector(connector);
    const request = connector.openapi ? openApiRequest(connector,args.input) : {url:new URL(connector.url),body:connector.method==='GET'?undefined:JSON.stringify(args.input||{})};
    const {url,body}=request, headers = this.connectorHeaders(connector);
    if(connector.idempotencyHeader && effect?.id)headers['Idempotency-Key']=effect.id;
    if (!connector.openapi && connector.method === 'GET') for (const [key,value] of Object.entries(args.input || {})) url.searchParams.set(key,String(value));
    const response = await this.request(url, {method:connector.method, headers, redirect:'error', body, signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
    const reader = response.body?.getReader(); let text = ''; const decoder = new TextDecoder();
    if(reader)try { while (text.length < 32000) { const chunk = await reader.read(); if(chunk.done) {text+=decoder.decode();break;} text += decoder.decode(chunk.value,{stream:true}); } } finally { await reader.cancel(); }
    return {status:response.status,body:text.slice(0,32000),idempotencyKey:connector.idempotencyHeader&&effect?.id?effect.id:null};
  }
  async verifyEffect(task,id,signal) {
    const effect=task.effects.find(item=>item.id===id);if(!effect||effect.tool!=='invoke_connector')throw new Error('El efecto no corresponde a un conector REST.');
    const connector=this.store.state.connectors.find(item=>item.name===effect.args?.name);if(!connector?.reconciliationUrl)throw new Error('Este conector no tiene una URL de conciliación configurada.');
    this.validateConnector(connector);
    const url=new URL(connector.reconciliationUrl.replaceAll('{operationId}',effect.id));
    const response=await this.request(url,{method:'GET',headers:this.connectorHeaders(connector),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
    const body=(await response.text()).slice(0,8000);
    if(response.ok)return this.store.updateEffect(task,id,'confirmed',{evidence:`GET de conciliación devolvió HTTP ${response.status}.`,verification:{status:response.status,body}});
    if(response.status===404)return this.store.updateEffect(task,id,'not_found',{evidence:'GET de conciliación devolvió HTTP 404.',verification:{status:404,body}});
    return this.store.updateEffect(task,id,'uncertain',{note:`La conciliación devolvió HTTP ${response.status}.`,verification:{status:response.status,body}});
  }
  async retryEffect(task,id,signal) {
    const effect=task.effects.find(item=>item.id===id);if(!effect||effect.tool!=='invoke_connector')throw new Error('El efecto no corresponde a un conector REST.');
    const connector=this.store.state.connectors.find(item=>item.name===effect.args?.name);if(!connector?.idempotencyHeader)throw new Error('El conector no declara soporte Idempotency-Key; no se puede reintentar automáticamente.');
    if(effect.status!=='uncertain')throw new Error('Sólo se reintentan efectos inciertos tras comprobar su estado.');
    this.store.updateEffect(task,id,'dispatched',{retries:(effect.retries||0)+1,note:'Reintento con la misma Idempotency-Key.'});
    try { const result=await this.invokeConnector(effect.args,signal,effect);return this.store.updateEffect(task,id,'observed',{lastStatus:result.status}); }
    catch(error){this.store.updateEffect(task,id,'uncertain',{note:'El reintento no produjo un resultado verificable.',error:error.message});throw error;}
  }
  shutdown() { this.closed = true; for (const controller of this.active.values()) controller.abort();for(const controller of this.compressionControllers.values())controller.abort(); }
}
