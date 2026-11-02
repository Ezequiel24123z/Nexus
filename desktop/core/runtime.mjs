import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { baseTools, executeTool, READ_ONLY_TOOL_NAMES } from './tools.mjs';
import { ProcessManager, StatefulShellManager, discoverWorkspaceInstructions, expandSlashCommand } from './coding-engine.mjs';
import { aggregateUsage, normalizeUsage } from './telemetry.mjs';
import {citationsFromAnnotations, readCompletionStream} from './stream.mjs';
import {hydrateAttachmentReferences, materializeImageAttachment, materializeToolResult} from './artifacts.mjs';
import {AttachmentStore,attachmentMessage} from './attachments.mjs';
import {ResponseJournal} from './response-journal.mjs';
import {validateChatOptions, agentModes} from './chat-options.mjs';
import {requestTools,affinitySession} from './model-request.mjs';
import {CapabilityLibrary} from './capabilities.mjs';
import {openApiRequest,validateOpenApiConnector} from './openapi.mjs';
import {modelConnection,completionRequest} from './providers.mjs';
import {isNetworkFailure,retryableNetworkFailure,networkFailure,providerHttpFailure} from './provider-errors.mjs';
import {setTimeout as retryDelay} from 'node:timers/promises';

const externalEffects=new Set(['write_file','replace_text','multi_edit','apply_patch','run_command','git_operation','manage_process','invoke_mcp','invoke_connector','desktop_action','create_connector','save_capability']);

// Only retain explicit provider summaries; never resend literal hidden reasoning.
export const reasoningToText = details => Array.isArray(details) ? details.map(item => item?.summary || '').filter(Boolean).join('\n\n') : '';

export const estimateTokens = (value, bytesPerToken = 3) => {
  let images = 0;
  const text = JSON.stringify(value, (key,item) => {
    if(item?.type === 'nexus_attachment' && item.attachment?.kind === 'image') {images++;return '[image]';}
    if(key === 'image_url') {images++;return '[image]';}
    return item;
  });
  return Math.ceil(Buffer.byteLength(text,'utf8') / bytesPerToken) + images * 2500;
};

export class Runtime extends EventEmitter {
  constructor(store, { getSecret, desktop, browserInspect, mcp, request = fetch } = {}) {
    super(); this.store = store; this.getSecret = getSecret; this.desktop = desktop; this.browserInspect = browserInspect; this.request = request;
    this.active = new Map(); this.approvals = new Map(); this.closed = false; this.desktopOwner = null;this.mcp=mcp;
    this.compacting=new Set();
    this.compressionControllers=new Map();
    this.attachments=new AttachmentStore(store);
    this.processes=new ProcessManager();
    this.shells=new StatefulShellManager();
  }
  changed(task=undefined) { this.store.save(task); this.emit('change'); }
  get capabilities(){return this._capabilities ||= new CapabilityLibrary(this.store.directory);}
  snapshot(activeTaskId=undefined) {
    const compressionThreshold=this.store.state.settings.contextWindow*this.store.state.settings.compressionPercent/100;
    const conn=modelConnection(this.store.state.settings.model,this.store.state.settings);
    return {
      ...this.store.state,
      connectors:activeTaskId===undefined?this.store.state.connectors:[],
      connectorCount:this.store.state.connectors.length,
      memories:activeTaskId===undefined?(this.store.state.memories||[]):[],
      memoryCount:(this.store.state.memories||[]).length,
      capabilities:this._capabilities?.summary()||{total:0,skills:0,functions:0,revision:0,damaged:0},
      mcpStatus:this.mcp?.status({compact:activeTaskId!==undefined}) || {},
      tasks: this.store.state.tasks.map(task => {
        if(activeTaskId!==undefined&&task.id!==activeTaskId)return {
          id:task.id,title:task.title,prompt:task.prompt,projectId:task.projectId,workspace:task.workspace,
          status:task.status,model:task.model,agentMode:task.agentMode,dependsOn:task.dependsOn,pinned:task.pinned,createdAt:task.createdAt,
          compacting:this.compacting.has(task.id),summaryOnly:true
        };
        const conversationStart=Math.max(0,task.conversation.length-120),eventsStart=Math.max(0,task.events.length-80);
        const contextTokens=task.contextTokens || 0;
        return {...task,messages:undefined,pendingImages:undefined,compacting:this.compacting.has(task.id),todos:task.todos||[],calls:(task.calls||[]).slice(-80),callsTotal:(task.calls||[]).length,callsStart:Math.max(0,(task.calls||[]).length-80),effects:(task.effects||[]).slice(-60),effectsTotal:(task.effects||[]).length,events:task.events.slice(eventsStart),eventsStart,eventsTotal:task.events.length,conversation:task.conversation.slice(conversationStart),conversationStart,conversationTotal:task.conversation.length,contextTokens,needsCompression:contextTokens>=compressionThreshold};
      }),
      approvals: [...this.approvals].filter(([,item])=>activeTaskId===undefined||item.taskId===activeTaskId).map(([id, item]) => ({ id, taskId: item.taskId, name: item.name, args: item.args })),
      hasKey: Boolean(conn.optionalKey || this.getSecret(conn.key)),
      providerKeys:{
        arliai:Boolean(this.getSecret('ARLIAI_API_KEY')),
        openrouter:Boolean(this.getSecret('OPENROUTER_API_KEY')),
        openai:Boolean(this.getSecret('OPENAI_API_KEY')),
        copilot:Boolean(this.getSecret('GITHUB_COPILOT_TOKEN')),
        anthropic:Boolean(this.getSecret('ANTHROPIC_API_KEY')),
        custom:true,
      }
    };
  }
  page(id, collection, before, limit) {
    const task=this.store.task(id);
    if(!['conversation','events','calls'].includes(collection))throw new Error('Invalid collection.');
    const values=task[collection]||[];
    limit=Math.max(1,Math.min(Number.isInteger(limit)?limit:120,200));
    before=before===undefined?values.length:before;
    if(!Number.isInteger(before)||before<0||before>values.length)throw new Error('Invalid cursor.');
    const start=Math.max(0,before-limit);
    return {items:values.slice(start,before),start,total:values.length,hasMore:start>0};
  }
  create({ prompt, workspace = '', model, agentMode, dependsOn = [], title, projectId, attachmentIds=[] }) {
    const attachments=this.attachments.resolve(attachmentIds);
    if(!prompt?.trim()&&attachments.length)prompt='Analyze the attached files.';
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100000) throw new Error('Describe a task of up to 100,000 characters.');
    if (!Array.isArray(dependsOn) || dependsOn.some(id => !this.store.state.tasks.some(t => t.id === id))) throw new Error('Invalid task dependency.');
    const project = projectId && this.store.state.projects.find(p=>p.id===projectId);
    if(projectId && !project)throw new Error('Project not found');
    workspace = project?.workspace || workspace;
    const expanded = expandSlashCommand(prompt);
    const effectivePrompt = expanded.prompt;
    const effectiveMode = agentMode || expanded.mode;
    if(effectiveMode!==undefined && !agentModes.includes(effectiveMode))throw new Error('Invalid agent mode.');
    const chosenModel = model || this.store.state.settings.model;
    const task = { id: crypto.randomUUID(), title: (title || prompt).slice(0, 80), prompt: effectivePrompt, workspace, projectId:projectId || null, engine:modelConnection(chosenModel, this.store.state.settings).id, model: chosenModel,
      ...(effectiveMode ? { agentMode: effectiveMode } : {}),
      dependsOn, attachments, status: 'queued', createdAt: new Date().toISOString(), messages: [], conversation: [], events: [], effects: [], todos: [], summary: '', compressions: 0, steps: 0, contextTokens: 0 };
    if (!task.model) throw new Error('Select a model in Settings.');
    if(!task.workspace&&attachments.length)task.workspace=this.attachments.workspace(task.id);
    this.store.state.tasks.unshift(task);
    this.store.transcript(task, attachmentMessage(effectivePrompt,attachments));
    task.conversation.push({ id:crypto.randomUUID(), role:'user', content: prompt, attachments });
    this.store.journal(task, 'created', { prompt: effectivePrompt, workspace:task.workspace, model: task.model, dependsOn });
    this.changed(task); this.schedule(); return task.id;
  }
  settings(input) {
    const s = {...this.store.state.settings};
    for (const [key,min,max] of [['compressionPercent',10,95],['concurrency',1,64],['contextWindow',8000,10000000],['maxSteps',0,1000000],['maxOutput',0,1000000],['webMaxResults',1,25],['webMaxUses',0,30]]) {
      if (input[key] !== undefined) {
        if (!Number.isFinite(input[key]) || input[key] < min || input[key] > max) throw new Error('Invalid setting: ' + key);
        s[key] = Math.round(input[key]);
      }
    }
    for (const key of ['autonomous','autoWorkspaceWrites','desktopEnabled','streaming','cacheAffinity']) if (typeof input[key] === 'boolean') s[key] = input[key];
    if(input.reasoningEffort!==undefined){
      if(!['auto','none','minimal','low','medium','high','xhigh','max'].includes(input.reasoningEffort))throw new Error('Invalid reasoning effort level');
      s.reasoningEffort=input.reasoningEffort;
    }
    if(input.providerRouting!==undefined){
      if(!['auto','price','throughput','latency'].includes(input.providerRouting))throw new Error('Invalid provider routing preference');
      s.providerRouting=input.providerRouting;
    }
    if(input.agentMode!==undefined){
      if(!agentModes.includes(input.agentMode))throw new Error('Invalid agent mode');
      s.agentMode=input.agentMode;
    }
    if(typeof input.customBaseUrl==='string'&&input.customBaseUrl.trim()){
      const u=new URL(input.customBaseUrl.trim());
      if(!['http:','https:'].includes(u.protocol))throw new Error('Invalid custom endpoint URL');
      s.customBaseUrl=input.customBaseUrl.trim().replace(/\/+$/,'');
    }
    if(typeof input.webSearchEnabled==='boolean')s.webSearchEnabled=input.webSearchEnabled;
    if(input.webSearchEngine!==undefined){
      if(!['auto','native','exa','firecrawl','parallel','perplexity'].includes(input.webSearchEngine))throw new Error('Invalid web search engine');
      s.webSearchEngine=input.webSearchEngine;
    }
    if(input.webSearchContext!==undefined){
      if(!['low','medium','high'].includes(input.webSearchContext))throw new Error('Invalid web search context size');
      s.webSearchContext=input.webSearchContext;
    }
    if(typeof input.globalInstructions === 'string')s.globalInstructions=input.globalInstructions;
    if (typeof input.model === 'string' && input.model.length < 180) s.model = input.model;
    if(input.favoriteModels!==undefined){if(!Array.isArray(input.favoriteModels)||input.favoriteModels.length>100||input.favoriteModels.some(id=>typeof id!=='string'||!id.trim()||id.length>180))throw new Error('Invalid favorite models list.');s.favoriteModels=[...new Set(input.favoriteModels.map(id=>id.trim()))];}
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
    if(Object.keys(options).some(key=>options[key]!==task[key])&&(this.active.has(task.id)||this.compacting.has(task.id)))throw new Error('Pause the task and wait for the active call to finish before changing model, mode, or thinking.');
    if(input.projectId&& !this.store.state.projects.some(project=>project.id===input.projectId))throw new Error('Project not found');
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
      const description=capture.dimensions?'Saved screenshot'+(capture.createdAt?' ('+capture.createdAt+')':'')+'; dimensions: '+JSON.stringify(capture.dimensions):'Attached image: '+capture.name;
      try{this.store.transcript(task,{role:'user',content:[{type:'text',text:description},{type:'nexus_attachment',attachment:capture}]});}
      catch(error){task.messages.length=count;task.pendingImages.unshift(capture);throw error;}
    }
  }
  resume(id, instruction, attachmentIds=[]) {
    const task = this.store.task(id);
    const attachments=this.attachments.resolve(attachmentIds);
    if(!instruction?.trim()&&attachments.length)instruction='Analyze the attached files.';
    if(attachments.length)task.attachments=[...new Map([...(task.attachments||[]),...attachments].map(item=>[item.id,item])).values()];
    if(attachments.length&&!task.workspace)task.workspace=this.attachments.workspace(task.id);
    if (this.active.has(id) || this.compacting.has(id)) {
      if (!instruction?.trim()) throw new Error('The task is still stopping.');
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
    } else if (task.status === 'complete') throw new Error('Write a follow-up instruction to continue a completed task.');
    task.status = 'queued'; task.error = null; this.changed(task); this.schedule();
  }
  approve(id, allowed) {
    const pending = this.approvals.get(id);
    if (!pending) throw new Error('Approval request expired.');
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
      const cancel = () => { this.approvals.delete(id); this.changed(task); reject(new Error('Cancelled')); };
      if (signal.aborted) return cancel();
      signal.addEventListener('abort', cancel, { once: true });
      this.approvals.set(id, { taskId: task.id, name, args, resolve:finish }); task.status = 'approval'; this.changed(task);
    });
  }
  needsApproval(name, task) {
    if(['search_capabilities','get_capability','get_connector'].includes(name))return false;
    if(this.store.state.settings.autonomous || task?.agentMode === 'unrestricted')return false;
    if (READ_ONLY_TOOL_NAMES.has(name) || ['document_progress','todo_write','memory_store'].includes(name)) return false;
    if (['write_file','replace_text','multi_edit','apply_patch'].includes(name) && this.store.state.settings.autoWorkspaceWrites) return false;
    return true;
  }
  effectiveSettings(task) {
    return {
      ...this.store.state.settings,
      model: task.model,
      reasoningEffort: task.reasoningEffort ?? this.store.state.settings.reasoningEffort,
      providerRouting: task.providerRouting ?? this.store.state.settings.providerRouting,
      ...(task.agentMode ? { agentMode: task.agentMode } : {}),
    };
  }
  async completion(messages, task, signal, { tools = true, maxOutput, effort, acceptTruncated, customTools } = {}) {
    const settings = this.effectiveSettings(task);
    const connection=modelConnection(task.model, settings);
    const key = this.getSecret(connection.key) || (connection.optionalKey ? 'local-key' : '');
    if (!key) throw new Error('Add your '+connection.name+' API key in Settings.');
    const started=Date.now();
    const streamingMode=Boolean(settings.streaming);
    const guard=new AbortController();
    let lastActivity=Date.now();
    const bump=()=>{lastActivity=Date.now();};
    const hardCap=setTimeout(()=>guard.abort(new DOMException('Maximum generation time exceeded.','TimeoutError')),streamingMode?1800000:900000);
    const idleTimer=streamingMode?setInterval(()=>{if(Date.now()-lastActivity>120000)guard.abort(new DOMException('Provider stopped sending data for 120 seconds.','TimeoutError'));},5000):null;
    const responseId=crypto.randomUUID();
    const responseJournal=tools?new ResponseJournal(this.store.directoryFor(task.id),responseId):null;
    let record=normalizeUsage(undefined,{id:crypto.randomUUID(),responseId,model:task.model,kind:tools?'generation':'compression',status:'pending',sessionAffinity:connection.id==='openrouter'&&settings.cacheAffinity===true});
    let attemptStarted=started, receivedOutput=false;
    task.calls ||= [];task.calls.push(record);task.liveText='';task.liveActivity='Querying model…';
    const account=()=>{task.telemetry=aggregateUsage(task.calls);task.lastTurnTelemetry=aggregateUsage(task.calls.slice(task.turnCallStart||0));};
    account();this.changed(task);
    let lastPaint=0;
    try{
    const outputLimit=maxOutput ?? settings.maxOutput;
    const selectedTools=customTools || requestTools(settings);
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
        if(!tools)return;task.liveReasoning=text;task.liveActivity='The model updated its reasoning summary.';
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
        const retryable=network?retryableNetworkFailure(error):reading||error.retryable===true;
        if(attempt>0||!retryable||signal.aborted||guard.signal.aborted||receivedOutput||task.liveText||responseJournal?.error||!error?.message)throw network&&!signal.aborted&&!guard.signal.aborted?networkFailure(error,connection.name):error;
        record.status='failed';record.latencyMs=Date.now()-attemptStarted;
        const priorId=record.id;
        record=normalizeUsage(undefined,{id:crypto.randomUUID(),responseId,model:task.model,kind:tools?'generation':'compression',status:'pending',retried:true,retryOf:priorId,sessionAffinity:connection.id==='openrouter'&&settings.cacheAffinity===true});
        task.calls.push(record);attemptStarted=Date.now();task.liveActivity='Connection interrupted. Retrying once…';account();this.changed(task);
        if(network||error.retryable)await retryDelay(750,undefined,{signal:AbortSignal.any([signal,guard.signal])});
      }
    }
    for(const [key,value] of Object.entries(normalizeUsage(data.usage)))if(value!==null)record[key]=value;
    Object.assign(record,{id:data.id||record.id,model:data.model||task.model,status:'complete',router:data.openrouter_metadata||null});
    this.calibrate(task, messages, tools, data.usage?.prompt_tokens,selectedTools);
    const message = data.choices?.[0]?.message;
    if(data.error)throw new Error('The provider returned an error during generation.');
    if(tools&&message?.content){task.liveText=message.content;responseJournal.update(message.content);}
    signal.throwIfAborted();guard.signal.throwIfAborted();
    const citations=citationsFromAnnotations(message?.annotations);
    if(data.choices?.[0]?.finish_reason==='length'){
      if(tools&&message?.content)task.liveText=message.content;
      if(acceptTruncated&&typeof message?.content==='string'&&message.content.trim().length>=20)return { message:{ role:'assistant', content:message.content, ...(message.reasoning_details?{reasoning_details:message.reasoning_details}:{}), ...(citations.length?{sources:citations}:{}) }, usage:data.usage, truncated:true };
      throw new Error('The model exhausted its output token budget before finishing. Any partial text has been preserved; you can continue with a follow-up instruction or increase max output tokens.');
    }
    if (!message || (!message.content && !message.tool_calls?.length)) throw new Error('The provider returned an empty response.');
    return { responseId, message: { role:'assistant', content:message.content || null, ...(message.reasoning_details ? {reasoning_details:message.reasoning_details} : {}), ...(message.tool_calls?.length ? { tool_calls:message.tool_calls } : {}), ...(citations.length ? {sources:citations} : {}) }, usage:data.usage };
    }catch(error){const guardFired=guard.signal.aborted&&!signal.aborted;const timedOut=guardFired&&(error?.name==='TimeoutError'||error?.name==='AbortError'||/aborted due to timeout/i.test(error?.message||''));record.status=signal.aborted?'interrupted':'failed';if(task.liveText){task.conversation.push({id:responseId,role:'assistant',content:task.liveText+'\n\n[Interrupted response; incomplete.]'});this.store.journal(task,'partial_response',{text:task.liveText});}if(timedOut)throw new Error('The provider stopped responding in time (slow stream or generation timeout). Any partial text has been preserved; you can resume the task.');throw error;}
    finally{clearTimeout(hardCap);if(idleTimer)clearInterval(idleTimer);responseJournal?.close();record.latencyMs=Date.now()-attemptStarted;task.liveText='';task.liveReasoning='';task.liveActivity='';account();this.changed(task);}
  }
  calibrate(task, messages, tools, promptTokens,toolSchema=requestTools(this.effectiveSettings(task))) {
    if (!Number.isFinite(promptTokens) || promptTokens <= 0) return;
    if(messages.some(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url'||part.type==='nexus_attachment')))return;
    const bytes = Buffer.byteLength(JSON.stringify({ messages, ...(tools ? { tools: toolSchema } : {}) }), 'utf8');
    const observed = bytes / promptTokens;
    if (!Number.isFinite(observed) || observed <= 0) return;
    const clamped = Math.min(4.2, Math.max(2.6, observed));
    task.bytesPerToken = task.bytesPerToken ? +(task.bytesPerToken * .7 + clamped * .3).toFixed(3) : +clamped.toFixed(3);
  }
  estimate(task, value) { return estimateTokens(value, task?.bytesPerToken || 3); }
  scrubMessages(messages = [], {compact=false} = {}) {
    return messages.map(message => {
      const {reasoning_details, sources, ...rest}=message;
      if(compact && Array.isArray(rest.content))rest.content=rest.content.map(part=>part.type==='image_url'?{type:'text',text:'[Image from original history; query the checkpoint to retrieve it.]'}:part);
      if(compact && sources?.length)rest.sources=sources;
      return rest;
    });
  }
  compactionTail(task, messages = []) {
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
    if(start===0)return {archived:messages,tail:[]};
    if(messages[start]?.role==='tool'){
      let call=start-1;while(call>=0&&messages[call].role==='tool')call--;
      if(messages[call]?.role==='assistant')start=call;
    }
    if(messages[start]?.role==='assistant'&&!messages[start]?.tool_calls)start++;
    return {archived:messages.slice(0,start),tail:messages.slice(start)};
  }
  refreshProgressReminder(task) {
    const last = Number.isInteger(task.lastProgressStep) ? task.lastProgressStep : 0;
    if (task.steps < 12 || task.steps - last < 12 || task.progressDue) return;
    task.progressDue = true;
    this.store.journal(task, 'progress_due', {step:task.steps, sinceStep:last, note:'Document decisions, changes, verification, and next action before continuing long work.'});
  }
  buildContext(task, {hydrate=true,inspect=false} = {}) {
    const dependencyContext = task.dependsOn.map(id => { const t = this.store.task(id); return { title:t.title, result:t.result, journal:t.events.filter(e => e.kind === 'progress').slice(-3) }; });
    const project=this.store.state.projects.find(p=>p.id===task.projectId);
    const pinned=task.conversation.filter(m=>m.pinned).map(m=>({role:m.role,content:m.content}));
    const reminder=task.progressDue?'\nContinuity reminder: several steps have elapsed without documenting progress. Before continuing broad work, call document_progress with decisions, changes, verification, and next action.':'';
    const webRule=this.store.state.settings.webSearchEnabled?'\nReal-time web search is available. When the user requests current information, sources, search, or external verification, use the web search tool before answering and cite resulting URLs in Markdown. Do not present unverified current data as if it had been searched.':'';
    const mode=task.agentMode||this.store.state.settings.agentMode||'agent';
    const modeRule=mode==='architect'?'\nOperating Mode: ARCHITECT (Plan & Design). Inspect files, analyze architecture, and maintain a structured checklist with todo_write, without mutating project files until switched to Agent mode.':mode==='explore'?'\nOperating Mode: EXPLORE (Read-Only Research). Use fast search and file inspection tools to answer questions accurately with file and line evidence.':mode==='unrestricted'?'\nOperating Mode: UNRESTRICTED OPERATOR. Full local environment access is enabled without client-side restrictions; execute the user objective directly.':'';
    const context = [{ role:'system', content:this.store.state.settings.globalInstructions + '\nProject: ' + (task.workspace || '(no folder)') + '\nProject instructions: ' + (project?.instructions || '') + '\nOriginal objective: ' + task.prompt + webRule + modeRule }];
    const sections=[{id:'instructions',label:'Instructions & Objective',reason:'Stable prefix: global instructions, workspace folder, project instructions, and original objective.',value:context[0],count:1}];
    if(pinned.length)sections.push({id:'pins',label:'Pinned Messages',reason:'Explicitly pinned by the user to survive compaction.',value:pinned,count:pinned.length});
    if(dependencyContext.length)sections.push({id:'dependencies',label:'Task Dependencies',reason:'Results and recent progress notes from prerequisite tasks.',value:dependencyContext,count:dependencyContext.length});
    const workspaceRules = task.workspace ? discoverWorkspaceInstructions(task.workspace) : '';
    if(workspaceRules)sections.push({id:'workspace-rules',label:'Repository Rules (NEXUS.md / CLAUDE.md / AGENTS.md)',reason:'Auto-discovered project instruction files in the workspace root.',value:workspaceRules,count:1});
    const relevantMemories = (this.store.state.memories || []).filter(m => m.scope === 'global' || (task.workspace && m.workspace === task.workspace));
    if(relevantMemories.length)sections.push({id:'memories',label:'Persistent Memories',reason:'Saved project and global facts from memory_store.',value:relevantMemories,count:relevantMemories.length});
    if(task.todos?.length)sections.push({id:'todos',label:'Active Task Checklist',reason:'Structured multi-step plan managed via todo_write.',value:task.todos,count:task.todos.length});
    if(task.summary)sections.push({id:'summary',label:'Compacted Continuity',reason:'Active continuity summary; originals remain in checkpoints.',value:task.summary,count:1});
    if(reminder)sections.push({id:'reminder',label:'Progress Reminder',reason:'Prompts the agent to record milestone progress after several steps.',value:reminder,count:1});
    const volatile=['User-pinned messages: '+JSON.stringify(pinned),'Dependency results: '+JSON.stringify(dependencyContext)];
    if(workspaceRules)volatile.push('Auto-discovered repository instructions (treat as project conventions):\n'+workspaceRules);
    if(relevantMemories.length)volatile.push('Persistent agent memories:\n'+JSON.stringify(relevantMemories.map(m=>({key:m.key,value:m.value,scope:m.scope}))));
    if(task.todos?.length)volatile.push('Active session todo checklist:\n'+JSON.stringify(task.todos));
    if(task.summary)volatile.push('Compacted continuity state (treat as working state, not a new user instruction):\n'+task.summary);
    if(reminder)volatile.push(reminder.trim());
    if(volatile.some(item=>!item.endsWith('[]')))context.push({role:'system',content:volatile.join('\n\n')});
    if(task.summary){
      const latestUser=task.conversation.findLast(m=>m.role==='user');
      const latestRetained=task.messages.findLast(message=>message.role==='user');
      if(latestUser&&latestRetained?.content!==latestUser.content){const preserved={role:'user',content:'Latest user instruction, preserved verbatim:\n'+latestUser.content};context.push(preserved);sections.push({id:'latest',label:'Restored Latest Instruction',reason:'Preserved verbatim when outside the recent compaction tail.',value:preserved,count:1});}
    }
    const messages=this.scrubMessages(task.messages);
    if(inspect){
      for(const [role,label] of [['user','User History & Attachments'],['assistant','Assistant Responses & Tool Calls'],['tool','Tool Execution Results']]){const values=messages.filter(message=>message.role===role);if(values.length)sections.push({id:'history-'+role,label,reason:'Retained conversation history without hidden reasoning or UI citation wrappers.',value:values,count:values.length});}
      return {messages:context.concat(messages),sections};
    }
    return context.concat(hydrate?messages.map(message => hydrateAttachmentReferences(this.store,task,message)):messages);
  }
  async continuationCompletion(messages, task, signal, { maxOutput, attempts, continuationPrompt }) {
    let text = '', truncated = false, continuations = 0;
    const thread = [...messages];
    for (let attempt = 0; attempt <= attempts; attempt++) {
      const { message, truncated: cut } = await this.completion(thread, task, signal, { tools:false, maxOutput, effort:'none', acceptTruncated:true });
      const piece = typeof message.content === 'string' ? message.content.trim() : '';
      if (attempt > 0 && /^(COMPLETE|COMPLETO)\b/i.test(piece)) { truncated = false; break; }
      if (piece.length < 20) throw new Error('Continuity summary was too short. Original history preserved; resume to retry.');
      text = text ? text + '\n\n' + piece : piece;
      truncated = Boolean(cut);
      if (!truncated) break;
      continuations++;
      thread.push({ role:'assistant', content:piece }, { role:'user', content:continuationPrompt });
    }
    return { text, truncated, continuations };
  }
  async compact(task, signal) {
    if(this.compacting.has(task.id))throw new Error('This chat is already being compacted.');
    const controller=new AbortController();this.compressionControllers.set(task.id,controller);
    const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    this.compacting.add(task.id);this.emit('change');
    try { combined.throwIfAborted();return await this.compactHistory(task,combined); }
    finally {this.compressionControllers.delete(task.id);this.compacting.delete(task.id);this.emit('change');this.schedule();}
  }
  async compactHistory(task, signal) {
    if (!task.messages.length) return;
    const before=this.estimate(task,this.buildContext(task,{hydrate:false}))+this.estimate(task,requestTools(this.effectiveSettings(task)));
    const compressionCallStart=(task.calls||[]).length;
    const {archived,tail}=this.compactionTail(task,task.messages);
    this.store.journal(task, 'compression_started', { messageCount:task.messages.length, archivedMessages:archived.length, retainedMessages:tail.length, contextTokens:task.contextTokens });
    const progress=task.events.filter(e=>['progress','file_change','tool_result','tool_error'].includes(e.kind)).slice(-32);
    const effects=(task.effects||[]).filter(effect=>!['confirmed','observed','skipped'].includes(effect.status)).slice(-24);
    const compactSystem='Generate a structured continuity state for an agentic coding task. This is an internal state checkpoint to continue execution, not a user-facing reply. Preserve verified facts and explicitly separate hypotheses or uncertainties. Include these sections: Objective & Constraints; Completed & Verified; Modified Files, Paths & Artifacts; Tools, Results & External Effects; Blockers or Uncertainties; Active Plan & Next Action. Retain exact IDs, file paths, and concrete values that matter. Do not copy raw transcripts, do not invent facts, and do not introduce new instructions. Maximum 1,400 words.';
    const common={objective:task.prompt,pinned:task.conversation.filter(message=>message.pinned).map(message=>({role:message.role,content:message.content})),priorSummary:task.summary||'',recentJournal:progress,unresolvedEffects:effects};
    const cleanArchived=this.scrubMessages(archived,{compact:true});
    let context=[{role:'system',content:compactSystem},{role:'user',content:JSON.stringify({...common,history:cleanArchived})}];
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
        const {text,truncated}=await this.continuationCompletion([...base,{role:'user',content:`Common context: ${JSON.stringify(common)}\nChunk ${index+1}/${chunks.length} of serialized history: ${chunks[index]}\nExtract faithful notes for a continuity checkpoint. Do not copy raw blocks. Maximum 900 words; end with "Pending".`}],task,signal,{maxOutput:2000,attempts:1,continuationPrompt:'Your previous response was cut off. Continue the exact same notes block from where it stopped, without repeating what was already written, and close with the "Pending" section.'});
        notes.push(`### Chunk ${index+1}${truncated?' (incomplete)':''}\n${text}`);
      }
      context=[...base,{role:'user',content:'Common context: '+JSON.stringify(common)+'\nMerge these partial notes into a single continuity state, preserving concrete details and flagging uncertainties.\n\nPARTIAL NOTES:\n'+notes.join('\n\n')}];
    }
    const {text:summaryText,truncated,continuations} = await this.continuationCompletion(context,task,signal,{maxOutput:6000,attempts:2,continuationPrompt:'Your previous continuity document was cut off at the output token limit. Continue exactly where it stopped, without repeating or re-summarizing prior text. If the document was already complete, reply only with the word COMPLETE.'});
    signal.throwIfAborted();
    if(truncated)this.store.journal(task,'compression_degraded',{continuations,note:'The summary remained incomplete even after continuation requests; original messages remain intact in the checkpoint.'});
    const finalSummary = truncated ? summaryText + '\n\n(Note: summary was truncated even after requesting continuation; some detail may be missing. Complete originals are preserved in checkpoints and read_checkpoint.)' : summaryText;
    const after=this.estimate(task,this.buildContext({...task,summary:finalSummary,messages:tail},{hydrate:false}))+this.estimate(task,requestTools(this.effectiveSettings(task)));
    const compressionUsage=aggregateUsage((task.calls||[]).slice(compressionCallStart));
    this.store.checkpoint(task, finalSummary, tail, {before,after,estimated:true,truncated,cost:compressionUsage.cost,unknownCosts:compressionUsage.unknownCosts,archivedMessages:archived.length,retainedMessages:tail.length});
    task.lastInputTokens=0;
    task.contextTokens = this.estimate(task,this.buildContext(task,{hydrate:false}))+this.estimate(task,requestTools(this.effectiveSettings(task)));
    task.lastCompression={at:new Date().toISOString(),before,after:task.contextTokens,estimated:true,continuations,truncated,cost:compressionUsage.cost,unknownCosts:compressionUsage.unknownCosts,archivedMessages:archived.length,retainedMessages:tail.length};
    this.changed(task);
  }
  repairInterruptedCalls(task) {
    const lastAssistant = task.messages.findLast(m => m.tool_calls);
    if (lastAssistant) {
      for (const call of lastAssistant.tool_calls) {
        if (!task.messages.some(m => m.tool_call_id === call.id)) this.store.transcript(task, {role:'tool',tool_call_id:call.id,content:'Interrupted: check the journal and actual state before repeating. Partial side effects may have occurred.'});
      }
    }
  }
  async runSubagent(parentTask, args = {}, signal) {
    const objective = String(args.objective || '').trim();
    if (!objective) throw new Error('Provide an objective for delegate_subagent.');
    const mode = ['explore', 'architect', 'agent'].includes(args.mode) ? args.mode : 'explore';
    const maxSteps = Math.max(1, Math.min(Number(args.maxSteps) || 6, 12));
    const subSettings = { ...this.effectiveSettings(parentTask), agentMode: mode };
    const subTools = requestTools(subSettings).filter(t => t.function?.name !== 'delegate_subagent');
    const thread = [
      { role: 'system', content: `You are a focused NEXUS sub-agent operating in ${mode.toUpperCase()} mode inside workspace ${parentTask.workspace || '(no folder)'}. Complete the delegated objective concisely with concrete file/line evidence and return a compact synthesis.` },
      { role: 'user', content: objective },
    ];
    let stepsExecuted = 0;
    for (let step = 0; step < maxSteps; step++) {
      signal.throwIfAborted();
      const { message } = await this.completion(thread, parentTask, signal, { tools: true, customTools: subTools });
      stepsExecuted++;
      thread.push(message);
      if (!message.tool_calls?.length) {
        this.store.journal(parentTask, 'subagent_complete', { mode, stepsExecuted, objective: objective.slice(0, 200) });
        return { mode, stepsExecuted, report: message.content || '' };
      }
      for (const call of message.tool_calls) {
        signal.throwIfAborted();
        let toolResult;
        try {
          const parsedArgs = JSON.parse(call.function.arguments || '{}');
          toolResult = await executeTool(this, parentTask, call.function.name, parsedArgs, signal);
        } catch (err) {
          toolResult = { error: err.message };
        }
        const serialized = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
        thread.push({ role: 'tool', tool_call_id: call.id, content: serialized.slice(0, 12000) });
      }
    }
    return { mode, stepsExecuted, report: thread.findLast(m => m.role === 'assistant' && m.content)?.content || 'Sub-agent reached step ceiling.' };
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
      task.liveActivity=step ? 'Reviewing results and preparing next step…' : 'Analyzing request and preparing execution plan…';
      this.changed(task);
      const settings = this.store.state.settings;
      const effectiveTools = requestTools(this.effectiveSettings(task));
      task.contextTokens = Math.max(this.estimate(task, this.buildContext(task,{hydrate:false})) + this.estimate(task, effectiveTools), task.lastInputTokens || 0);
      const threshold = settings.contextWindow * settings.compressionPercent / 100;
      if (task.contextTokens >= threshold) { await this.compact(task, signal); task.lastInputTokens = 0; }
      if (this.estimate(task, this.buildContext(task,{hydrate:false})) + this.estimate(task, effectiveTools) > settings.contextWindow) throw new Error('Context exceeds the operating ceiling even after compaction. Increase the context ceiling or split the task; history is preserved.');
      const {message, usage,responseId} = await this.completion(this.buildContext(task), task, signal);
      task.steps++; task.lastInputTokens = usage?.prompt_tokens || 0; task.usage = (task.usage || 0) + (usage?.total_tokens || 0);
      this.store.transcript(task, message);
      const stepReasoning=reasoningToText(message.reasoning_details);
      if (message.content) task.conversation.push({id:responseId,role:'assistant',content:message.content,reasoning:stepReasoning,sources:message.sources,step:task.steps||undefined,telemetry:task.lastTurnTelemetry});
      else if (stepReasoning) task.conversation.push({id:responseId,role:'assistant',content:null,reasoning:stepReasoning,sources:message.sources,step:task.steps||undefined,telemetry:task.lastTurnTelemetry});
      task.contextTokens=this.estimate(task,this.buildContext(task,{hydrate:false}))+this.estimate(task,requestTools(this.effectiveSettings(task)));
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
          if (!baseTools.some(t => t.function.name === call.function.name)) throw new Error('Unknown tool');
          let args = JSON.parse(call.function.arguments);
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments');
          let name = call.function.name;
          if(name==='invoke_function'){
            const resolved=this.capabilities.resolve(args.id,args.input);
            name=resolved.tool;args=resolved.args;
            this.store.journal(task,'function_resolved',{...resolved.capability,tool:name});
          }
          if(name.startsWith('desktop_')) {
            if(this.desktopOwner && this.desktopOwner !== task.id) throw new Error('Another agent is currently using the desktop. Continue with independent work or finish and resume later.');
            this.desktopOwner = task.id;
          }
          if (this.needsApproval(name, task) && !(await this.approval(task, name, args, signal))) result = { denied:true, reason:'The user declined this action. Respect this decision.' };
          else {
            this.store.journal(task, 'tool_intent', {name,args});
            if(externalEffects.has(name)){
              effect=this.store.beginEffect(task,name,args);
              this.store.updateEffect(task,effect.id,'dispatched');
            }
            task.liveActivity='Executing '+name.replaceAll('_',' ')+'…';
            this.changed(task);
            result = await executeTool(this, task, name, args, signal, effect);
          }
          if (result?.image) {
            const attachment=await materializeImageAttachment(this.store,task,result.image,{dimensions:result.dimensions,name:result.name||'desktop-screenshot'});
            task.pendingImages ||= [];
            task.pendingImages.push(attachment);
            this.store.journal(task, 'tool_result', {name, result:'Screenshot saved as local attachment', attachment});
            this.store.transcript(task, {role:'tool',tool_call_id:call.id, content:JSON.stringify({captured:true,dimensions:result.dimensions})});
            if(effect)this.store.updateEffect(task,effect.id,'observed',{artifact:attachment});
            continue;
          }
          const materialized=await materializeToolResult(this.store,task,name,result);
          this.store.journal(task, 'tool_result', {name, result:materialized.journal});
          if(effect)this.store.updateEffect(task,effect.id,'observed',{artifact:materialized.artifact || null});
          task.liveActivity='Verifying output of '+name.replaceAll('_',' ')+'…';
          result=materialized.model;
        } catch (error) {
          if (signal.aborted) { if(effect)this.store.updateEffect(task,effect.id,'uncertain',{note:'Task was paused before observing a verifiable result.'}); throw error; }
          if(effect)this.store.updateEffect(task,effect.id,'uncertain',{note:'Execution returned an error or was interrupted before observing a verifiable result.',error:error.message});
          result = {error:error.message}; this.store.journal(task, 'tool_error', {name:call.function.name,error:error.message});
        }
        const serialized = typeof result === 'string' ? result : JSON.stringify(result);
        this.store.transcript(task, {role:'tool',tool_call_id:call.id,content:serialized});
        this.changed(task);
      }
      this.flushPendingImages(task);
    }
    throw new Error('Step limit reached. Progress is saved; you can resume anytime.');
  }
  validateConnector(connector) {
    if (!connector || typeof connector.name !== 'string' || !/^[\w -]{1,80}$/.test(connector.name)) throw new Error('Invalid connector name.');
    const url = new URL(connector.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use an HTTPS URL without embedded credentials.');
    if (!['GET','POST','PUT','PATCH','DELETE'].includes(connector.method)) throw new Error('Unsupported HTTP method');
    if (connector.secretRef && !/^CONNECTOR_[A-Z0-9_]+$/.test(connector.secretRef)) throw new Error('Secret reference must start with CONNECTOR_.');
    if(connector.idempotencyHeader !== undefined && typeof connector.idempotencyHeader !== 'boolean')throw new Error('Invalid idempotency configuration.');
    if(connector.openapi)validateOpenApiConnector(connector);
    if(connector.reconciliationUrl){
      if(typeof connector.reconciliationUrl !== 'string')throw new Error('Invalid reconciliation URL.');
      const check=new URL(connector.reconciliationUrl.replaceAll('{operationId}','00000000-0000-0000-0000-000000000000'));
      if(check.protocol!=='https:'||check.username||check.password)throw new Error('Reconciliation URL must be HTTPS and must not contain embedded credentials.');
    }
  }
  connectorHeaders(connector) {
    const headers={'Content-Type':'application/json'};
    if (connector.secretRef) {
      const secret = this.getSecret(connector.secretRef);
      if (!secret) throw new Error('Configure secret ' + connector.secretRef);
      headers.Authorization = 'Bearer ' + secret;
    }
    return headers;
  }
  async invokeConnector(args, signal, effect) {
    const connector = this.store.state.connectors.find(c => c.name === args.name);
    if (!connector) throw new Error('Connector not found');
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
    const effect=task.effects.find(item=>item.id===id);if(!effect||effect.tool!=='invoke_connector')throw new Error('Effect does not belong to a REST connector.');
    const connector=this.store.state.connectors.find(item=>item.name===effect.args?.name);if(!connector?.reconciliationUrl)throw new Error('This connector has no reconciliation URL configured.');
    this.validateConnector(connector);
    const url=new URL(connector.reconciliationUrl.replaceAll('{operationId}',effect.id));
    const response=await this.request(url,{method:'GET',headers:this.connectorHeaders(connector),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
    const body=(await response.text()).slice(0,8000);
    if(response.ok)return this.store.updateEffect(task,id,'confirmed',{evidence:`Reconciliation GET returned HTTP ${response.status}.`,verification:{status:response.status,body}});
    if(response.status===404)return this.store.updateEffect(task,id,'not_found',{evidence:'Reconciliation GET returned HTTP 404.',verification:{status:404,body}});
    return this.store.updateEffect(task,id,'uncertain',{note:`Reconciliation returned HTTP ${response.status}.`,verification:{status:response.status,body}});
  }
  async retryEffect(task,id,signal) {
    const effect=task.effects.find(item=>item.id===id);if(!effect||effect.tool!=='invoke_connector')throw new Error('Effect does not belong to a REST connector.');
    const connector=this.store.state.connectors.find(item=>item.name===effect.args?.name);if(!connector?.idempotencyHeader)throw new Error('Connector does not declare Idempotency-Key support; cannot retry automatically.');
    if(effect.status!=='uncertain')throw new Error('Only uncertain effects can be retried after checking their status.');
    this.store.updateEffect(task,id,'dispatched',{retries:(effect.retries||0)+1,note:'Retried with the same Idempotency-Key.'});
    try { const result=await this.invokeConnector(effect.args,signal,effect);return this.store.updateEffect(task,id,'observed',{lastStatus:result.status}); }
    catch(error){this.store.updateEffect(task,id,'uncertain',{note:'Retry did not produce a verifiable result.',error:error.message});throw error;}
  }
  shutdown() { this.closed = true; for (const controller of this.active.values()) controller.abort();for(const controller of this.compressionControllers.values())controller.abort(); this.processes?.stopAll(); }
}
