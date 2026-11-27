import crypto from 'node:crypto';
import fsSync from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { baseTools, executeTool, READ_ONLY_TOOL_NAMES } from './tools.mjs';
import { ProcessManager, StatefulShellManager, discoverWorkspaceInstructions, expandSlashCommand, revertFileBackup } from './coding-engine.mjs';
import { aggregateUsage, normalizeUsage } from './telemetry.mjs';
import {citationsFromAnnotations, readCompletionStream, readAnthropicStream, normalizeAnthropicResponse} from './stream.mjs';
import {hydrateAttachmentReferences, materializeImageAttachment, materializeToolResult, saveRawArtifact} from './artifacts.mjs';
import {AttachmentStore,attachmentMessage} from './attachments.mjs';
import {ResponseJournal} from './response-journal.mjs';
import {validateChatOptions, agentModes} from './chat-options.mjs';
import {requestTools,affinitySession} from './model-request.mjs';
import {CapabilityLibrary} from './capabilities.mjs';
import {PluginManager, discoverWorkspaceSkills} from './plugins.mjs';
import {selectMemoriesForContext, formatMemoriesForPrompt} from './memory.mjs';
import {openApiRequest,validateOpenApiConnector} from './openapi.mjs';
import {modelConnection,completionRequest,allProviders,resolveCopilotAuth} from './providers.mjs';
import {isNetworkFailure,retryableNetworkFailure,networkFailure,providerHttpFailure,extractSafeProviderDetail} from './provider-errors.mjs';
import {isStockGlobalInstructions, globalInstructions as stockGlobalInstructions} from './store.mjs';
import {PiiScrubber, isLocalModelEndpoint} from './pii-scrubber.mjs';
import {buildPrivacyAudit, PRIVACY_MODE_GUIDE} from './privacy-proxy.mjs';
import {SEARCH_PROVIDER_CATALOG} from './search-engines.mjs';
import {setTimeout as retryDelay} from 'node:timers/promises';

const externalEffects=new Set(['write_file','replace_text','multi_edit','apply_patch','delete_file','move_file','run_command','shell_session','git_operation','manage_process','invoke_mcp','invoke_connector','http_request','desktop_action','create_connector','save_capability','scaffold_mcp_server','manage_automation','create_dynamic_tool']);

const RISKY_COMMAND_RE = /\b(rm|rmdir|del|erase|remove-item|format|diskpart|stop-process|taskkill|shutdown|restart-computer|netsh|icacls|takeown|bcdedit|invoke-expression|iex|chmod|chown|runas|sudo|reg\s+(add|delete)|git\s+(push|reset\s+--hard|clean\s+-f)|npm\s+publish)\b|\|\s*(sh|bash|powershell|iex)\b/i;

export function matchesSemiAutoRule(rule, name, args = {}) {
  const raw = String(rule || '').trim();
  if (!raw) return false;
  const targetDetail = String(args?.command || args?.operation || args?.path || args?.to || args?.url || (args?.server ? `${args.server}:${args.tool || ''}` : '') || '');
  const composite = `${name}:${targetDetail}`;
  if (raw.startsWith('/') && raw.lastIndexOf('/') > 0) {
    const last = raw.lastIndexOf('/');
    try {
      const re = new RegExp(raw.slice(1, last), raw.slice(last + 1) || 'i');
      return re.test(composite) || re.test(targetDetail) || re.test(name);
    } catch { return false; }
  }
  if (!raw.includes(':')) {
    return raw.toLowerCase() === name.toLowerCase();
  }
  const [ruleTool, ...rest] = raw.split(':');
  const needle = rest.join(':').trim().toLowerCase();
  if (ruleTool.trim() !== '*' && ruleTool.trim().toLowerCase() !== name.toLowerCase()) return false;
  return !needle || targetDetail.toLowerCase().includes(needle);
}

export function suggestAllowPattern(name, args = {}) {
  if (['run_command', 'shell_session', 'manage_process'].includes(name)) {
    const head = String(args?.command || '').trim().split(/\s+/).slice(0, 2).join(' ');
    return head ? `${name}:${head}` : name;
  }
  if (name === 'git_operation' && args?.operation) return `git_operation:${args.operation}`;
  if (name === 'invoke_mcp' && args?.server) return `invoke_mcp:${args.server}:${args.tool || ''}`;
  if ((name === 'http_request' || name === 'invoke_connector') && args?.url) {
    try { return `${name}:${new URL(args.url).hostname}`; } catch { return name; }
  }
  return name;
}

export function assessActionRisk(name, args = {}, task = {}, settings = {}) {
  const denyRules = Array.isArray(settings?.semiAutoDenyRules) ? settings.semiAutoDenyRules : [];
  for (const rule of denyRules) {
    if (matchesSemiAutoRule(rule, name, args)) {
      return { risky: true, reason: `Matched deny rule (${rule})` };
    }
  }
  const allowRules = Array.isArray(settings?.semiAutoAllowRules) ? settings.semiAutoAllowRules : [];
  for (const rule of allowRules) {
    if (matchesSemiAutoRule(rule, name, args)) {
      return { risky: false, reason: '' };
    }
  }
  if (name === 'browser_inspect' && ((Array.isArray(args?.actions) && args.actions.length > 0) || args?.useAccountSession)) {
    return { risky: true, reason: `Interactive browser automation (${args?.url || 'page'})` };
  }
  if (READ_ONLY_TOOL_NAMES.has(name) || ['document_progress', 'todo_write', 'memory_store', 'search_capabilities', 'get_capability', 'get_connector'].includes(name)) {
    return { risky: false, reason: '' };
  }
  if (['delete_file', 'desktop_action', 'scaffold_mcp_server', 'create_connector', 'manage_automation'].includes(name)) {
    return { risky: true, reason: `High-impact tool (${name})` };
  }
  if (name === 'manage_project' && args?.action === 'delete') {
    return { risky: true, reason: 'Deleting a project definition' };
  }
  if (name === 'manage_privacy') {
    const act = String(args?.action || 'status').toLowerCase();
    if (act === 'status' || act === 'explain') return { risky: false, reason: '' };
    return { risky: true, reason: `Changing NEXUS privacy/network setting (${act})` };
  }
  if (name === 'invoke_mcp') {
    return { risky: true, reason: `External MCP tool (${args?.server || 'server'}:${args?.tool || 'tool'})` };
  }
  if (name === 'git_operation' && ['push', 'discard', 'worktree_remove', 'commit'].includes(args?.operation)) {
    return { risky: true, reason: `Git mutation (${args.operation})` };
  }
  if ((name === 'http_request' || name === 'invoke_connector') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(args?.method || 'POST').toUpperCase())) {
    return { risky: true, reason: `External HTTP ${args?.method || 'mutation'}` };
  }
  if (['run_command', 'shell_session', 'manage_process'].includes(name)) {
    const cmd = String(args?.command || '');
    if (args?.elevated === true || (Boolean(task?.adminMode) && name === 'run_command' && args?.elevated !== false)) {
      return { risky: true, reason: 'Windows Administrator elevated command execution' };
    }
    if (RISKY_COMMAND_RE.test(cmd)) {
      return { risky: true, reason: 'Potentially destructive or elevated shell command' };
    }
    return { risky: false, reason: '' };
  }
  if (['write_file', 'replace_text', 'multi_edit', 'apply_patch', 'move_file'].includes(name)) {
    const targetPath = String(args?.path || args?.to || '');
    if (task?.workspace && targetPath) {
      const wsRoot = path.resolve(task.workspace);
      const resolvedTarget = path.resolve(wsRoot, targetPath);
      const rel = path.relative(wsRoot, resolvedTarget);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return { risky: true, reason: `File write outside workspace (${targetPath})` };
      }
    }
    return { risky: false, reason: '' };
  }
  return { risky: false, reason: '' };
}

// Extract readable reasoning text/summaries for local UI display; scrubMessages() always strips reasoning_details before outbound model calls.
export const reasoningToText = details => Array.isArray(details)
  ? details.filter(item => item && item.type !== 'reasoning.encrypted').map(item => item?.summary || item?.text || item?.plain || '').filter(Boolean).join('\n\n')
  : '';

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
  constructor(store, { getSecret, desktop, browserInspect, mcp, registerMedia, request = fetch } = {}) {
    super(); this.store = store; this.getSecret = getSecret; this.desktop = desktop; this.browserInspect = browserInspect; this.registerMedia = registerMedia; this.request = request;
    this.active = new Map(); this.approvals = new Map(); this.closed = false; this.desktopOwner = null;this.mcp=mcp;
    this.compacting=new Set();
    this.compressionControllers=new Map();
    this.attachments=new AttachmentStore(store);
    this.processes=new ProcessManager();
    this.shells=new StatefulShellManager();
    this.plugins=new PluginManager(store.directory);
  }
  activePiiScrubber() {
    const s = this.store.state.settings || {};
    return new PiiScrubber({
      enabled: Boolean(s.privacyScrubPii),
      customRules: s.privacyScrubCustomRules || [],
    });
  }
  toggleStealthMode(enabled) {
    const on = Boolean(enabled);
    const s = this.store.state.settings || {};
    if (on) {
      // Stealth Mode hardens routing, kill-switch, InPrivate, zero-track search & PII scrubbing
      // while EXPLICITLY PRESERVING promptCaching and cacheAffinity per user preference.
      const preferredProxy = s.browserProxyMode && s.browserProxyMode !== 'direct'
        ? s.browserProxyMode
        : (this.wireguard?.isRunning?.() ? 'wireguard' : (this.tor?.isRunning?.() ? 'managed-tor' : 'managed-tor'));
      this.settings({
        stealthMode: true,
        browserProxyMode: preferredProxy,
        torRouteAllTraffic: true,
        browserRouteAgentTraffic: true,
        torStrictFailClosed: true,
        browserPersistentProfile: false,
        browserBlockTrackers: true,
        browserAntiFingerprint: true,
        searchStrictZeroTrack: true,
        privacyScrubPii: true,
      });
    } else {
      this.settings({
        stealthMode: false,
        torStrictFailClosed: false,
      });
    }
    return {
      stealthMode: Boolean(this.store.state.settings.stealthMode),
      promptCachingPreserved: this.store.state.settings.promptCaching !== false,
      cacheAffinityPreserved: Boolean(this.store.state.settings.cacheAffinity),
      settings: this.store.state.settings,
    };
  }
  changed(task=undefined, { immediate = false } = {}) {
    try {
      if (!immediate && task && this.active.has(task.id)) this.store.scheduleSave(task);
      else this.store.save(task);
    } catch (err) { console.error('NEXUS store.save error:', err?.message || err); }
    this.emit('change');
  }
  emitDelta(task) {
    if (!task) return;
    this.emit('delta', {
      taskId: task.id,
      status: task.status,
      compacting: this.compacting.has(task.id),
      liveText: task.liveText || '',
      liveReasoning: task.liveReasoning || '',
      liveActivity: task.liveActivity || '',
      liveTools: task.liveTools || [],
      liveSubagents: task.liveSubagents || [],
    });
  }
  get capabilities(){return this._capabilities ||= new CapabilityLibrary(this.store.directory);}
  snapshot(activeTaskId=undefined) {
    const conn=modelConnection(this.store.state.settings.model,this.store.state.settings);
    return {
      ...this.store.state,
      connectors:activeTaskId===undefined?this.store.state.connectors:[],
      connectorCount:this.store.state.connectors.length,
      memories:activeTaskId===undefined?(this.store.state.memories||[]):[],
      memoryCount:(this.store.state.memories||[]).length,
      automations:this.store.state.automations||[],
      capabilities:this._capabilities?.summary()||{total:0,skills:0,functions:0,revision:0,damaged:0},
      mcpStatus:this.mcp?.status({compact:activeTaskId!==undefined}) || {},
      tasks: this.store.state.tasks.map(task => {
        if(activeTaskId!==undefined&&task.id!==activeTaskId)return {
          id:task.id,title:task.title,prompt:task.prompt,projectId:task.projectId,parentTaskId:task.parentTaskId||null,workspace:task.workspace,
          status:task.status,model:task.model,agentMode:task.agentMode,ephemeral:Boolean(task.ephemeral),adminMode:Boolean(task.adminMode),arenaGroupId:task.arenaGroupId||null,dependsOn:task.dependsOn,pinned:task.pinned,createdAt:task.createdAt,
          compacting:this.compacting.has(task.id),summaryOnly:true
        };
        const conversationStart=Math.max(0,task.conversation.length-120),eventsStart=Math.max(0,task.events.length-80);
        const contextTokens=task.contextTokens || 0;
        const effectiveWindow=task.contextWindow || this.store.state.settings.contextWindow;
        const compressionThreshold=effectiveWindow*this.store.state.settings.compressionPercent/100;
        return {...task,messages:undefined,pendingImages:undefined,_ramArtifacts:undefined,_ramAttachments:undefined,ramCheckpoints:undefined,compacting:this.compacting.has(task.id),todos:task.todos||[],liveTools:task.liveTools||[],liveSubagents:task.liveSubagents||[],calls:(task.calls||[]).slice(-80),callsTotal:(task.calls||[]).length,callsStart:Math.max(0,(task.calls||[]).length-80),effects:(task.effects||[]).slice(-60),effectsTotal:(task.effects||[]).length,events:task.events.slice(eventsStart),eventsStart,eventsTotal:task.events.length,conversation:task.conversation.slice(conversationStart),conversationStart,conversationTotal:task.conversation.length,contextTokens,needsCompression:contextTokens>=compressionThreshold};
      }),
      approvals: [...this.approvals].filter(([,item])=>activeTaskId===undefined||item.taskId===activeTaskId).map(([id, item]) => ({ id, taskId: item.taskId, name: item.name, args: item.args, reason: item.reason || '', suggestedPattern: item.suggestedPattern || item.name })),
      hasKey: Boolean(conn.optionalKey || this.getSecret(conn.key)),
      providerKeys: Object.fromEntries(allProviders(this.store.state.settings).map(p => [p.id, Boolean(p.optionalKey || this.getSecret(p.key))])),
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
  create({ prompt, workspace = '', model, agentMode, dependsOn = [], title, projectId, parentTaskId = null, notifyParentOnIdle = false, attachmentIds=[], arenaGroupId = null, temperature = undefined, systemPromptOverride = '', ephemeral = false, adminMode = false }) {
    const attachments=this.attachments.resolve(attachmentIds);
    if(!prompt?.trim()&&attachments.length)prompt='Analyze the attached files.';
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100000) throw new Error('Describe a task of up to 100,000 characters.');
    if (!Array.isArray(dependsOn) || dependsOn.some(id => !this.store.state.tasks.some(t => t.id === id))) throw new Error('Invalid task dependency.');
    const project = projectId && this.store.state.projects.find(p=>p.id===projectId);
    if(projectId && !project)throw new Error('Project not found');
    workspace = workspace || project?.workspace || '';
    const expanded = expandSlashCommand(prompt, this.store.state.settings.customCommands);
    const effectivePrompt = expanded.prompt;
    const effectiveMode = agentMode || expanded.mode;
    if(effectiveMode!==undefined && !agentModes.includes(effectiveMode))throw new Error('Invalid agent mode.');
    const chosenModel = model || this.store.state.settings.model;
    const task = { id: crypto.randomUUID(), title: (title || prompt).slice(0, 80), prompt: effectivePrompt, workspace, projectId:projectId || null, parentTaskId: parentTaskId || null, notifyParentOnIdle: Boolean(notifyParentOnIdle), ephemeral: Boolean(ephemeral), adminMode: Boolean(adminMode), engine:modelConnection(chosenModel, this.store.state.settings).id, model: chosenModel,
      ...(effectiveMode ? { agentMode: effectiveMode } : {}),
      ...(arenaGroupId ? { arenaGroupId } : {}),
      ...(typeof temperature === 'number' ? { temperature } : {}),
      ...(systemPromptOverride ? { systemPromptOverride } : {}),
      dependsOn, attachments, status: 'queued', createdAt: new Date().toISOString(), messages: [], conversation: [], events: [], effects: [], todos: [], liveTools: [], liveSubagents: [], summary: '', compressions: 0, steps: 0, contextTokens: 0 };
    if (!task.model) throw new Error('Select a model in Settings.');
    if(!task.workspace&&attachments.length)task.workspace=this.attachments.workspace(task.id);
    this.store.state.tasks.unshift(task);
    this.store.transcript(task, attachmentMessage(effectivePrompt,attachments));
    task.conversation.push({ id:crypto.randomUUID(), role:'user', content: prompt, attachments });
    this.store.journal(task, 'created', { prompt: effectivePrompt, workspace:task.workspace, model: task.model, dependsOn, ephemeral: task.ephemeral, adminMode: task.adminMode });
    this.changed(task); this.schedule(); return task.id;
  }
  settings(input, { skipConfigWrite = false } = {}) {
    const s = {...this.store.state.settings};
    for (const [key,min,max] of [['compressionPercent',10,95],['concurrency',1,64],['contextWindow',8000,10000000],['maxSteps',0,1000000],['maxOutput',0,1000000],['webMaxResults',1,25],['webMaxUses',0,30]]) {
      if (input[key] !== undefined) {
        if (!Number.isFinite(input[key]) || input[key] < min || input[key] > max) throw new Error('Invalid setting: ' + key);
        s[key] = Math.round(input[key]);
      }
    }
    for (const [key,min,max] of [['temperature',0,2],['topP',0,1],['presencePenalty',-2,2],['frequencyPenalty',-2,2]]) {
      if (input[key] !== undefined) {
        if (input[key] === null || input[key] === '') s[key] = null;
        else if (typeof input[key] === 'number' && Number.isFinite(input[key]) && input[key] >= min && input[key] <= max) s[key] = input[key];
        else throw new Error('Invalid setting: ' + key);
      }
    }
    if (input.seed !== undefined) {
      if (input.seed === null || input.seed === '') s.seed = null;
      else if (Number.isInteger(input.seed)) s.seed = input.seed;
      else throw new Error('Invalid seed.');
    }
    for (const key of ['extraBody','extraHeaders']) {
      if (input[key] !== undefined) {
        if (input[key] === null) s[key] = null;
        else if (typeof input[key] === 'object' && !Array.isArray(input[key])) s[key] = input[key];
        else throw new Error('Invalid JSON object for ' + key);
      }
    }
    for (const key of ['autonomous','autoWorkspaceWrites','desktopEnabled','streaming','cacheAffinity','promptCaching','lazyToolLoading','microCompaction','silentToolSteps','minimizeToTray','browserPersistentProfile','browserBlockTrackers','browserAntiFingerprint','browserRouteAgentTraffic','torRouteAllTraffic','torStrictFailClosed','searchStrictZeroTrack','privacyScrubPii','stealthMode','autoCheckUpdates','globalInstructionsCustomized']) if (typeof input[key] === 'boolean') s[key] = input[key];
    for (const ruleKey of ['semiAutoAllowRules', 'semiAutoDenyRules', 'privacyScrubCustomRules']) {
      if (input[ruleKey] !== undefined) {
        if (!Array.isArray(input[ruleKey]) || input[ruleKey].length > 200) throw new Error('Invalid ' + ruleKey);
        s[ruleKey] = [...new Set(input[ruleKey].map(x => String(x || '').trim()).filter(Boolean).slice(0, 200))];
      }
    }
    if(input.browserProxyMode!==undefined&&['direct','wireguard','wireguard-tor','managed-tor','tor','custom','socks5','http'].includes(input.browserProxyMode))s.browserProxyMode=input.browserProxyMode;
    if(typeof input.wireguardActiveProfileId==='string'&&input.wireguardActiveProfileId.length<=80)s.wireguardActiveProfileId=input.wireguardActiveProfileId.trim();
    if(typeof input.wireguardBinaryPath==='string'&&input.wireguardBinaryPath.length<=400)s.wireguardBinaryPath=input.wireguardBinaryPath.trim();
    if(typeof input.browserProxyUrl==='string'&&input.browserProxyUrl.length<=300)s.browserProxyUrl=input.browserProxyUrl.trim();
    if(input.browserSearchEngine!==undefined&&['duckduckgo','startpage','brave','qwant','searxng','mojeek','kagi'].includes(input.browserSearchEngine))s.browserSearchEngine=input.browserSearchEngine;
    if(typeof input.browserSearxUrl==='string'&&input.browserSearxUrl.length<=300)s.browserSearxUrl=input.browserSearxUrl.trim();
    if(input.browserEngineMode!==undefined&&['dual','agent-fast','agent-js','standard'].includes(input.browserEngineMode))s.browserEngineMode=input.browserEngineMode;
    if(input.searchProvider!==undefined&&['auto','searxng','duckduckgo','mojeek','brave','kagi','langsearch','tavily','exa','ahmia','torch','onion','bing-rss'].includes(input.searchProvider))s.searchProvider=input.searchProvider;
    if(typeof input.searchTorchOnionUrl==='string'&&input.searchTorchOnionUrl.length<=300)s.searchTorchOnionUrl=input.searchTorchOnionUrl.trim();
    if(typeof input.updateRepo==='string'&&input.updateRepo.length<=160&&input.updateRepo.trim())s.updateRepo=input.updateRepo.trim();
    if(input.reasoningEffort!==undefined){
      if(!['auto','none','minimal','low','medium','high','xhigh','max'].includes(input.reasoningEffort))throw new Error('Invalid reasoning effort level');
      s.reasoningEffort=input.reasoningEffort;
    }
    if(input.providerRouting!==undefined){
      if(!['auto','price','throughput','latency'].includes(input.providerRouting))throw new Error('Invalid provider routing preference');
      s.providerRouting=input.providerRouting;
    }
    if(input.providerOrder!==undefined){
      if(input.providerOrder===null||input.providerOrder==='')s.providerOrder=[];
      else if(Array.isArray(input.providerOrder))s.providerOrder=input.providerOrder.map(x=>String(x).trim()).filter(Boolean).slice(0,12);
      else if(typeof input.providerOrder==='string')s.providerOrder=input.providerOrder.split(',').map(x=>x.trim()).filter(Boolean).slice(0,12);
      else throw new Error('Invalid provider order');
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
    if(typeof input.copilotBaseUrl==='string'&&input.copilotBaseUrl.trim()){
      const u=new URL(input.copilotBaseUrl.trim());
      if(!['http:','https:'].includes(u.protocol))throw new Error('Invalid Copilot endpoint URL');
      s.copilotBaseUrl=input.copilotBaseUrl.trim().replace(/\/+$/,'');
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
    if(typeof input.webUserAgent==='string'&&input.webUserAgent.length<=400)s.webUserAgent=input.webUserAgent.trim();
    if (input.resetGlobalInstructions === true) {
      s.globalInstructions = stockGlobalInstructions;
      s.globalInstructionsCustomized = false;
    } else if (typeof input.globalInstructions === 'string') {
      s.globalInstructions = input.globalInstructions;
      if (input.globalInstructionsCustomized === undefined) {
        s.globalInstructionsCustomized = !isStockGlobalInstructions(input.globalInstructions);
      }
    }
    if (typeof input.customSystemPrompt === 'string' && input.customSystemPrompt.length <= 40000) {
      s.customSystemPrompt = input.customSystemPrompt;
    }
    if (typeof input.model === 'string' && input.model.length < 180) s.model = input.model;
    if(input.favoriteModels!==undefined){if(!Array.isArray(input.favoriteModels)||input.favoriteModels.length>100||input.favoriteModels.some(id=>typeof id!=='string'||!id.trim()||id.length>180))throw new Error('Invalid favorite models list.');s.favoriteModels=[...new Set(input.favoriteModels.map(id=>id.trim()))];}
    if(input.customProviders!==undefined){
      if(!Array.isArray(input.customProviders)||input.customProviders.length>50)throw new Error('Invalid customProviders list.');
      s.customProviders=input.customProviders.filter(p=>p&&typeof p.id==='string'&&/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(p.id)&&typeof p.baseUrl==='string'&&p.baseUrl.trim()).map(p=>({
        id:p.id.toLowerCase(),name:String(p.name||p.id).slice(0,80),baseUrl:String(p.baseUrl).trim().replace(/\/+$/,''),
        apiFormat:p.apiFormat==='anthropic'?'anthropic':'openai',keyName:p.keyName||('PROVIDER_'+p.id.toUpperCase().replace(/[^A-Z0-9_]/g,'_')+'_KEY'),
        optionalKey:p.optionalKey!==false,defaultModel:String(p.defaultModel||'').slice(0,120),
        headers:p.headers&&typeof p.headers==='object'&&!Array.isArray(p.headers)?p.headers:{},
      }));
    }
    if(input.customCommands!==undefined){
      if(!Array.isArray(input.customCommands)||input.customCommands.length>100)throw new Error('Invalid customCommands list.');
      s.customCommands=input.customCommands.filter(c=>c&&typeof c.command==='string'&&c.command.trim()&&typeof c.template==='string'&&c.template.trim()).map(c=>({
        command:'/'+c.command.trim().replace(/^\/+/,''),
        description:String(c.description||'Custom slash command').slice(0,200),
        template:c.template,
        mode:agentModes.includes(c.mode)?c.mode:undefined,
      }));
    }
    if(input.disabledTools!==undefined){
      if(!Array.isArray(input.disabledTools))throw new Error('Invalid disabledTools list.');
      s.disabledTools=[...new Set(input.disabledTools.filter(x=>typeof x==='string'))];
    }
    if(typeof input.customCss==='string'&&input.customCss.length<=100000)s.customCss=input.customCss;
    if(typeof input.accentColor==='string'&&input.accentColor.length<=40)s.accentColor=input.accentColor.trim();
    if(typeof input.globalHotkey==='string'&&input.globalHotkey.length<=40)s.globalHotkey=input.globalHotkey.trim();
    this.store.state.settings=s;
    if (!skipConfigWrite) this.configFile?.writeSettings(s);
    this.changed(null); this.schedule();
  }
  schedule() {
    if (this.closed) return;
    for (const task of [...this.store.state.tasks].reverse()) {
      const isActiveNestedChild = Boolean(task.parentTaskId && this.active.has(task.parentTaskId));
      const effectiveLimit = isActiveNestedChild
        ? Math.max(this.store.state.settings.concurrency, 4)
        : this.store.state.settings.concurrency;
      if (this.active.size >= effectiveLimit) continue;
      if (task.status !== 'queued') continue;
      if (this.compacting.has(task.id)) continue;
      const dependencies = (task.dependsOn || []).map(id => this.store.state.tasks.find(t => t.id === id)).filter(Boolean);
      if (dependencies.some(t => t.status !== 'complete')) continue;
      if (task.workspace && [...this.active.keys()].some(id => {
        const other = this.store.task(id);
        if (!other.workspace || other.workspace.toLowerCase() !== task.workspace.toLowerCase()) return false;
        // Allow nested session trees (parent/child/siblings) and Arena peers to run concurrently in the same project root
        if (task.parentTaskId && (other.id === task.parentTaskId || other.parentTaskId === task.parentTaskId)) return false;
        if (other.parentTaskId === task.id) return false;
        if (task.arenaGroupId && other.arenaGroupId === task.arenaGroupId) return false;
        return true;
      })) continue;
      const controller = new AbortController();
      this.active.set(task.id, controller); task.status = 'running'; task.error = null;
      this.changed(task);
      void this.run(task, controller.signal).catch(error => {
        task.status = controller.signal.aborted ? 'paused' : 'failed';
        task.error = error.message;
        try { this.store.journal(task, 'stopped', { reason: error.message }); } catch {}
      }).finally(() => {
        try {
          this.active.delete(task.id);
          task.liveText='';task.liveReasoning='';task.liveActivity='';task.liveTools=[];task.liveSubagents=[];
          if(this.desktopOwner===task.id)this.desktopOwner=null;
          if(task.status==='complete'&&task.pendingFollowups>0){task.status='queued';task.error=null;}
          if(task.status==='complete') this.emit('notify', { title: 'NEXUS · Task Complete', body: task.title });
          // Auto-handoff nested child session completion back to its parent orchestrator
          if (task.parentTaskId && task.notifyParentOnIdle && ['complete', 'failed'].includes(task.status)) {
            const parent = this.store.state.tasks.find(t => t.id === task.parentTaskId);
            if (parent) {
              const summary = task.status === 'complete'
                ? String(task.result || task.conversation.findLast(m => m.role === 'assistant')?.content || '(Completed without text)').slice(0, 4000)
                : `Failed with error: ${task.error || 'Unknown error'}`;
              const handoff = `[Nested child session "${task.title}" (${task.id}) finished (${task.status})]:\n${summary}`;
              this.store.journal(parent, 'child_session_handoff', { childId: task.id, title: task.title, status: task.status });
              if (this.active.has(parent.id) || this.compacting.has(parent.id)) {
                this.followup(parent, handoff);
              } else {
                this.resume(parent.id, handoff);
              }
            }
          }
          this.changed(task);
          this.schedule();
        } catch (err) {
          console.error('NEXUS schedule finalize error:', err?.message || err);
        }
      });
    }
  }
  updateChat(input){
    const task=this.store.task(input.id),options=validateChatOptions(input);
    const optionChanged = key => {
      const next = options[key];
      const prev = task[key];
      if (next === prev) return false;
      if ((next === null || next === undefined || next === '') && (prev === null || prev === undefined || prev === '')) return false;
      return true;
    };
    if(Object.keys(options).some(optionChanged)&&(this.active.has(task.id)||this.compacting.has(task.id)))throw new Error('Pause the task and wait for the active call to finish before changing model, mode, or thinking.');
    if(input.projectId&& !this.store.state.projects.some(project=>project.id===input.projectId))throw new Error('Project not found');
    Object.assign(task,options);
    if(options.model)task.engine=modelConnection(options.model,this.store.state.settings).id;
    if(typeof input.title==='string'&&input.title.trim())task.title=input.title.trim().slice(0,120);
    if(typeof input.pinned==='boolean')task.pinned=input.pinned;
    if(typeof input.adminMode==='boolean')task.adminMode=input.adminMode;
    if(typeof input.ephemeral==='boolean')this.store.setTaskEphemeral(task.id, input.ephemeral, 'User toggled storage mode');
    if(input.projectId!==undefined)task.projectId=input.projectId||null;
    if(typeof input.workspace==='string')task.workspace=input.workspace;
    this.changed(task);return true;
  }
  deleteTask(id) {
    const task = this.store.task(id);
    this.active.get(id)?.abort();
    this.compressionControllers.get(id)?.abort();
    for (const [approvalId, pending] of [...this.approvals.entries()]) {
      if (pending.taskId === id) { this.approvals.delete(approvalId); try { pending.resolve(false); } catch {} }
    }
    this.store.state.tasks = this.store.state.tasks.filter(t => t.id !== id);
    for (const other of this.store.state.tasks) {
      if (Array.isArray(other.dependsOn) && other.dependsOn.includes(id)) {
        other.dependsOn = other.dependsOn.filter(dep => dep !== id);
      }
    }
    this.changed(null);
    return { deleted: true, id: task.id };
  }
  forkTask(id, messageId) {
    const source = this.store.task(id);
    const convIdx = messageId ? source.conversation.findIndex(m => m.id === messageId) : source.conversation.length - 1;
    const slicedConv = convIdx >= 0 ? source.conversation.slice(0, convIdx + 1) : [...source.conversation];
    const clonedConv = slicedConv.map(m => ({ ...m, id: crypto.randomUUID() }));
    const clonedMessages = slicedConv
      .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
      .map(m => ({ role: m.role, content: m.content || '' }));
    const forked = {
      id: crypto.randomUUID(),
      title: ('Fork · ' + source.title).slice(0, 80),
      prompt: source.prompt,
      workspace: source.workspace,
      projectId: source.projectId,
      engine: source.engine,
      model: source.model,
      ...(source.agentMode ? { agentMode: source.agentMode } : {}),
      ...(source.reasoningEffort ? { reasoningEffort: source.reasoningEffort } : {}),
      ...(source.providerRouting ? { providerRouting: source.providerRouting } : {}),
      ...(source.temperature !== undefined ? { temperature: source.temperature } : {}),
      ...(source.systemPromptOverride ? { systemPromptOverride: source.systemPromptOverride } : {}),
      dependsOn: [],
      attachments: [...(source.attachments || [])],
      status: 'paused',
      createdAt: new Date().toISOString(),
      messages: [],
      conversation: clonedConv,
      events: [],
      effects: [],
      todos: (source.todos || []).map(t => ({ ...t })),
      liveTools: [],
      liveSubagents: [],
      summary: source.summary || '',
      compressions: 0,
      steps: 0,
      contextTokens: 0,
    };
    this.store.state.tasks.unshift(forked);
    for (const msg of clonedMessages) this.store.transcript(forked, msg);
    this.store.journal(forked, 'forked', { fromTaskId: source.id, fromMessageId: messageId || null, messageCount: clonedConv.length });
    this.changed(forked);
    return forked.id;
  }
  editMessageAndResend(id, messageId, newContent) {
    const task = this.store.task(id);
    if (this.active.has(id) || this.compacting.has(id)) throw new Error('Pause the task before editing a previous message.');
    const text = String(newContent || '').trim();
    if (!text) throw new Error('Message content cannot be empty.');
    const idx = task.conversation.findIndex(m => m.id === messageId && m.role === 'user');
    if (idx < 0) throw new Error('User message not found.');
    const prior = task.conversation[idx];
    const kept = task.conversation.slice(0, idx);
    const expanded = expandSlashCommand(text, this.store.state.settings.customCommands);
    if (expanded.mode) task.agentMode = expanded.mode;
    task.conversation = [...kept, { id: crypto.randomUUID(), role: 'user', content: text, attachments: prior.attachments || [] }];
    task.messages = kept
      .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
      .map(m => ({ role: m.role, content: m.content || '' }));
    this.store.transcript(task, attachmentMessage(expanded.prompt, prior.attachments || []));
    this.store.journal(task, 'message_edited', { replacedMessageId: messageId, prompt: expanded.prompt });
    task.status = 'queued';
    task.error = null;
    this.changed(task);
    this.schedule();
    return true;
  }
  regenerate(id) {
    const task = this.store.task(id);
    if (this.active.has(id) || this.compacting.has(id)) throw new Error('Pause the task before regenerating.');
    while (task.conversation.length && task.conversation.at(-1).role === 'assistant') {
      task.conversation.pop();
    }
    while (task.messages.length && task.messages.at(-1).role !== 'user') {
      task.messages.pop();
    }
    if (!task.messages.length) throw new Error('No user prompt available to regenerate.');
    this.store.journal(task, 'regenerated', { at: new Date().toISOString() });
    task.status = 'queued';
    task.error = null;
    this.changed(task);
    this.schedule();
    return true;
  }
  spawnChildSession(parentTask, args = {}) {
    const prompt = String(args.prompt || '').trim();
    if (!prompt) throw new Error('spawn_session requires a non-empty prompt.');
    const inheritEphemeral = args.ephemeral !== undefined ? Boolean(args.ephemeral) : Boolean(parentTask.ephemeral);
    const childId = this.create({
      title: args.title ? String(args.title).slice(0, 80) : prompt.slice(0, 64),
      prompt,
      workspace: args.workspace !== undefined ? String(args.workspace) : (parentTask.workspace || ''),
      projectId: parentTask.projectId || null,
      parentTaskId: parentTask.id,
      notifyParentOnIdle: args.notifyParentOnIdle !== false,
      model: args.model || parentTask.model,
      agentMode: args.agentMode || parentTask.agentMode,
      ephemeral: inheritEphemeral,
      adminMode: Boolean(args.adminMode),
    });
    const child = this.store.task(childId);
    this.store.journal(parentTask, 'child_session_spawned', { childId, title: child.title, workspace: child.workspace, model: child.model, ephemeral: child.ephemeral, adminMode: child.adminMode });
    return { sessionId: childId, title: child.title, status: child.status, workspace: child.workspace, model: child.model, ephemeral: child.ephemeral, adminMode: child.adminMode };
  }
  listSessionsFor(currentTask, { scope = 'tree' } = {}) {
    const tasks = this.store.state.tasks || [];
    const filtered = scope === 'all'
      ? tasks
      : tasks.filter(t =>
          t.id === currentTask.id ||
          t.parentTaskId === currentTask.id ||
          (currentTask.parentTaskId && (t.id === currentTask.parentTaskId || t.parentTaskId === currentTask.parentTaskId))
        );
    return {
      currentSessionId: currentTask.id,
      parentSessionId: currentTask.parentTaskId || null,
      sessions: filtered.slice(0, 50).map(t => {
        const lastAssistant = [...(t.conversation || [])].reverse().find(m => m.role === 'assistant' && m.content);
        return {
          id: t.id,
          title: t.title,
          parentTaskId: t.parentTaskId || null,
          relation: t.id === currentTask.id ? 'self' : t.id === currentTask.parentTaskId ? 'parent' : t.parentTaskId === currentTask.id ? 'child' : 'peer',
          status: t.status,
          model: t.model,
          workspace: t.workspace,
          ephemeral: Boolean(t.ephemeral),
          adminMode: Boolean(t.adminMode),
          lastOutputPreview: lastAssistant?.content ? String(lastAssistant.content).slice(0, 400) : '',
        };
      }),
    };
  }
  sendSessionMessage(senderTask, { sessionId, message } = {}) {
    if (!sessionId || typeof message !== 'string' || !message.trim()) {
      throw new Error('send_session_message requires sessionId and a non-empty message.');
    }
    if (senderTask && sessionId === senderTask.id) throw new Error('A session cannot send an inter-session message to itself.');
    const target = this.store.task(sessionId);
    const senderLabel = senderTask ? `"${senderTask.title}" (${senderTask.id.slice(0, 8)})` : 'User Coordinator';
    const envelope = `[Inter-session message from ${senderLabel}]:\n${message.trim()}`;
    if (senderTask) this.store.journal(senderTask, 'session_message_sent', { toSessionId: target.id, toTitle: target.title, preview: message.trim().slice(0, 200) });
    this.store.journal(target, 'session_message_received', { fromSessionId: senderTask?.id || null, fromTitle: senderTask?.title || 'Coordinator', preview: message.trim().slice(0, 200) });
    this.resume(target.id, envelope);
    return { delivered: true, targetSessionId: target.id, targetTitle: target.title, targetStatus: target.status };
  }
  async readSession({ sessionId, wait = false, timeoutSeconds = 60 } = {}, signal) {
    const target = this.store.task(sessionId);
    if (wait && ['queued', 'running', 'approval'].includes(target.status)) {
      const deadline = Date.now() + Math.max(1, Math.min(Number(timeoutSeconds) || 60, 300)) * 1000;
      while (Date.now() < deadline && ['queued', 'running', 'approval'].includes(target.status)) {
        signal?.throwIfAborted();
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    return {
      sessionId: target.id,
      title: target.title,
      parentTaskId: target.parentTaskId || null,
      status: target.status,
      error: target.error || null,
      result: target.result || null,
      todos: target.todos || [],
      recentMessages: (target.conversation || []).slice(-6).map(m => ({
        role: m.role,
        content: m.content ? String(m.content).slice(0, 2000) : '',
      })),
    };
  }
  manageProject(currentTask, args = {}) {
    const action = String(args.action || 'list').toLowerCase();
    this.store.state.projects ||= [];
    const findProject = () => {
      if (args.projectId || args.id) return this.store.state.projects.find(p => p.id === (args.projectId || args.id));
      if (args.name) return this.store.state.projects.find(p => p.name.toLowerCase() === String(args.name).trim().toLowerCase());
      return null;
    };
    if (action === 'list') {
      const counts = new Map();
      for (const t of this.store.state.tasks || []) {
        if (t.projectId) counts.set(t.projectId, (counts.get(t.projectId) || 0) + 1);
      }
      return {
        projects: this.store.state.projects.map(p => ({
          id: p.id,
          name: p.name,
          workspace: p.workspace || '',
          instructions: p.instructions || '',
          sessionCount: counts.get(p.id) || 0,
        })),
      };
    }
    if (action === 'create') {
      if (!args.name || !String(args.name).trim()) throw new Error('manage_project create requires a non-empty name.');
      const existing = this.store.state.projects.find(p => p.name.toLowerCase() === String(args.name).trim().toLowerCase());
      if (existing) throw new Error(`A project named "${existing.name}" already exists (id: ${existing.id}). Use action="update" or assign_project instead.`);
      const id = this.store.project({
        name: String(args.name).trim(),
        workspace: args.workspace !== undefined ? String(args.workspace).trim() : (currentTask?.workspace || ''),
        instructions: String(args.instructions || ''),
      });
      const created = this.store.state.projects.find(p => p.id === id);
      if (args.assignCurrentSession && currentTask) {
        currentTask.projectId = id;
        if (created?.workspace && !currentTask.workspace) currentTask.workspace = created.workspace;
        this.store.journal(currentTask, 'session_project_assigned', { projectId: id, projectName: created?.name });
      }
      this.changed(currentTask || null);
      return { created: true, project: created, assignedToCurrentSession: Boolean(args.assignCurrentSession && currentTask) };
    }
    if (action === 'update') {
      const target = findProject();
      if (!target) throw new Error('Project not found. Pass a valid id/projectId from manage_project(action="list").');
      const id = this.store.project({
        id: target.id,
        name: args.newName ? String(args.newName).trim() : (args.name ? String(args.name).trim() : target.name),
        workspace: args.workspace !== undefined ? String(args.workspace).trim() : target.workspace,
        instructions: args.instructions !== undefined ? String(args.instructions) : target.instructions,
      });
      const updated = this.store.state.projects.find(p => p.id === id);
      this.changed(null);
      return { updated: true, project: updated };
    }
    if (action === 'delete') {
      const target = findProject();
      if (!target) throw new Error('Project not found.');
      this.store.state.projects = this.store.state.projects.filter(p => p.id !== target.id);
      for (const t of this.store.state.tasks || []) {
        if (t.projectId === target.id) t.projectId = null;
      }
      this.changed(null);
      return { deleted: true, id: target.id, name: target.name };
    }
    throw new Error('Unsupported manage_project action: ' + action);
  }
  manageSession(currentTask, args = {}) {
    const action = String(args.action || 'info').toLowerCase();
    const target = args.sessionId ? this.store.task(args.sessionId) : currentTask;
    if (!target) throw new Error('Target session not found.');
    const proj = target.projectId ? this.store.state.projects.find(p => p.id === target.projectId) : null;

    if (action === 'info') {
      return {
        sessionId: target.id,
        title: target.title,
        projectId: target.projectId || null,
        projectName: proj?.name || null,
        workspace: target.workspace || '',
        parentTaskId: target.parentTaskId || null,
        pinned: Boolean(target.pinned),
        ephemeral: Boolean(target.ephemeral),
        adminMode: Boolean(target.adminMode),
        status: target.status,
        model: target.model,
        agentMode: target.agentMode || this.store.state.settings.agentMode,
      };
    }
    if (action === 'rename') {
      const nextTitle = String(args.title || '').trim().slice(0, 120);
      if (!nextTitle) throw new Error('manage_session rename requires a non-empty title.');
      const previous = target.title;
      target.title = nextTitle;
      this.store.journal(target, 'session_renamed', { previous, title: nextTitle });
      this.changed(target);
      return { renamed: true, sessionId: target.id, previousTitle: previous, title: nextTitle };
    }
    if (action === 'assign_project') {
      if (args.projectId === null || args.projectId === '' || args.unassign === true) {
        target.projectId = null;
        this.store.journal(target, 'session_project_assigned', { projectId: null, projectName: null });
        this.changed(target);
        return { assigned: true, sessionId: target.id, projectId: null, projectName: null };
      }
      const match = args.projectId
        ? this.store.state.projects.find(p => p.id === args.projectId)
        : (args.projectName ? this.store.state.projects.find(p => p.name.toLowerCase() === String(args.projectName).trim().toLowerCase()) : null);
      if (!match) throw new Error('Project not found. List projects with manage_project(action="list") or create one first.');
      target.projectId = match.id;
      if (args.adoptWorkspace !== false && match.workspace) {
        target.workspace = match.workspace;
      }
      this.store.journal(target, 'session_project_assigned', { projectId: match.id, projectName: match.name, workspace: target.workspace });
      this.changed(target);
      return { assigned: true, sessionId: target.id, projectId: match.id, projectName: match.name, workspace: target.workspace };
    }
    if (action === 'set_workspace') {
      const ws = String(args.workspace || '').trim();
      target.workspace = ws;
      this.store.journal(target, 'session_workspace_updated', { workspace: ws });
      this.changed(target);
      return { updated: true, sessionId: target.id, workspace: ws };
    }
    if (action === 'pin') {
      target.pinned = args.pinned !== false;
      this.changed(target);
      return { updated: true, sessionId: target.id, pinned: target.pinned };
    }
    if (action === 'set_ephemeral') {
      if (typeof args.ephemeral !== 'boolean') throw new Error('manage_session set_ephemeral requires boolean "ephemeral" (true = RAM-Only, false = Regular persistent).');
      const res = this.store.setTaskEphemeral(target.id, args.ephemeral, String(args.reason || '').slice(0, 300));
      this.changed(target, { immediate: true });
      return { sessionId: target.id, ...res, storageMode: target.ephemeral ? 'ram-only' : 'regular' };
    }
    throw new Error('Unsupported manage_session action: ' + action);
  }
  privacyPostureLine() {
    const s = this.store.state.settings || {};
    const audit = buildPrivacyAudit(s, this.tor || null, this.store, this.wireguard || null);
    const wgRunning = Boolean(this.wireguard?.isRunning?.());
    const wgProf = this.wireguard?.status?.(s.wireguardBinaryPath)?.activeProfile?.name || '';
    const torRunning = Boolean(this.tor?.isRunning?.());
    const pii = this.activePiiScrubber().summary();
    const piiDesc = pii.enabled
      ? `ON (${pii.effectiveRuleCount} rules; outbound paths/user/host redacted to __NEXUS_USER__/__NEXUS_HOST__ and transparently restored for local tool calls)`
      : 'OFF';
    return `Active Privacy & Network Posture: routing=${s.browserProxyMode || 'direct'} (WireGuard=${wgRunning ? `connected:${wgProf || 'active'}` : 'stopped'}, Tor=${torRunning ? (this.tor?.upstreamSocks5 ? 'chained-over-wg' : 'running') : 'stopped'}), allAppTraffic=${s.torRouteAllTraffic ? 'ON' : 'OFF'}, killSwitch=${s.torStrictFailClosed ? 'ON' : 'OFF'}, stealthMode=${s.stealthMode ? 'ON' : 'OFF'}, piiScrubber=${piiDesc}, searchProvider=${s.searchProvider || 'auto'} (strictZeroTrack=${s.searchStrictZeroTrack ? 'ON' : 'OFF'}), browser=${s.browserPersistentProfile ? 'Account' : 'InPrivate'} (engine=${s.browserEngineMode || 'dual'}), promptCaching=${s.promptCaching !== false ? 'ON' : 'OFF'}, cacheAffinity=${s.cacheAffinity ? 'ON' : 'OFF'}, opsecScore=${audit.score}/100 (${audit.tier}).`;
  }
  async managePrivacy(currentTask, args = {}) {
    const action = String(args.action || 'status').toLowerCase();
    const s = this.store.state.settings || {};
    const getStatusPayload = () => ({
      posture: this.privacyPostureLine(),
      audit: buildPrivacyAudit(s, this.tor || null, this.store, this.wireguard || null),
      settings: {
        browserProxyMode: s.browserProxyMode || 'direct',
        browserProxyUrl: s.browserProxyUrl || '',
        torRouteAllTraffic: Boolean(s.torRouteAllTraffic),
        browserRouteAgentTraffic: Boolean(s.browserRouteAgentTraffic),
        torStrictFailClosed: Boolean(s.torStrictFailClosed),
        stealthMode: Boolean(s.stealthMode),
        privacyScrubPii: Boolean(s.privacyScrubPii),
        privacyScrubCustomRulesCount: (s.privacyScrubCustomRules || []).length,
        searchProvider: s.searchProvider || 'auto',
        searchStrictZeroTrack: Boolean(s.searchStrictZeroTrack),
        browserSearxUrl: s.browserSearxUrl || '',
        searchTorchOnionUrl: s.searchTorchOnionUrl || '',
        browserPersistentProfile: Boolean(s.browserPersistentProfile),
        browserBlockTrackers: s.browserBlockTrackers !== false,
        browserAntiFingerprint: s.browserAntiFingerprint !== false,
        browserEngineMode: s.browserEngineMode || 'dual',
        promptCaching: s.promptCaching !== false,
        cacheAffinity: Boolean(s.cacheAffinity),
      },
      tor: this.tor?.status?.() || { installed: false, running: false },
      wireguard: this.wireguard?.status?.(s.wireguardBinaryPath) || { installed: false, running: false, profiles: [] },
      piiScrubber: this.activePiiScrubber().summary(),
    });

    if (action === 'status') {
      return getStatusPayload();
    }
    if (action === 'explain') {
      return {
        currentPosture: this.privacyPostureLine(),
        routingModesRanked: PRIVACY_MODE_GUIDE,
        searchProviders: SEARCH_PROVIDER_CATALOG,
        additionalLayers: {
          stealthMode: '1-click preset enabling All-App Tunnel + Fail-Closed Kill-Switch + Reversible PII Scrubber + InPrivate Browser + Tracker Shield + Strict Zero-Track Search while explicitly preserving Prompt Caching & Cache Affinity.',
          piiScrubber: 'Replaces C:\\Users\\<you>, your hostname, and custom sensitive strings before cloud LLM calls and transparently restores them for local tools.',
          ramOnlySessions: 'Sessions created or migrated via manage_session(action="set_ephemeral", ephemeral=true) live purely in RAM with zero disk traces.',
          cryptoBilling: 'For true payment untraceability with Mullvad (€4.50/mo) / IVPN and a ZDR LLM provider, pay with no-KYC crypto (e.g. Monero) and register over InPrivate Tor/VPN.',
        },
      };
    }
    if (action === 'set_routing') {
      const patch = {};
      if (args.mode !== undefined) patch.browserProxyMode = args.mode;
      if (args.proxyUrl !== undefined) patch.browserProxyUrl = String(args.proxyUrl || '');
      if (typeof args.routeAllTraffic === 'boolean') {
        patch.torRouteAllTraffic = args.routeAllTraffic;
        if (args.routeAllTraffic) patch.browserRouteAgentTraffic = true;
      }
      if (typeof args.routeAgentTraffic === 'boolean') patch.browserRouteAgentTraffic = args.routeAgentTraffic;
      if (typeof args.killSwitch === 'boolean') patch.torStrictFailClosed = args.killSwitch;
      this.settings(patch);
      if (currentTask) this.store.journal(currentTask, 'privacy_updated', { action, patch });
      return { updated: true, applied: patch, ...getStatusPayload() };
    }
    if (action === 'stealth') {
      const res = this.toggleStealthMode(args.enabled !== false);
      if (currentTask) this.store.journal(currentTask, 'privacy_updated', { action, enabled: res.stealthMode });
      return { updated: true, ...res, ...getStatusPayload() };
    }
    if (action === 'set_search') {
      const patch = {};
      if (args.provider !== undefined) patch.searchProvider = args.provider;
      if (typeof args.strictZeroTrack === 'boolean') patch.searchStrictZeroTrack = args.strictZeroTrack;
      if (typeof args.searxUrl === 'string') patch.browserSearxUrl = args.searxUrl;
      if (typeof args.torchOnionUrl === 'string') patch.searchTorchOnionUrl = args.torchOnionUrl;
      this.settings(patch);
      if (currentTask) this.store.journal(currentTask, 'privacy_updated', { action, patch });
      return { updated: true, applied: patch, ...getStatusPayload() };
    }
    if (action === 'set_pii') {
      const patch = {};
      if (typeof args.enabled === 'boolean') patch.privacyScrubPii = args.enabled;
      let rules = [...(s.privacyScrubCustomRules || [])];
      if (Array.isArray(args.rules)) rules = [...args.rules];
      if (Array.isArray(args.addRules)) rules = [...new Set([...rules, ...args.addRules])];
      if (Array.isArray(args.removeRules)) {
        const rm = new Set(args.removeRules.map(x => String(x).trim()));
        rules = rules.filter(r => !rm.has(r));
      }
      if (args.rules !== undefined || args.addRules !== undefined || args.removeRules !== undefined) {
        patch.privacyScrubCustomRules = rules;
      }
      this.settings(patch);
      if (currentTask) this.store.journal(currentTask, 'privacy_updated', { action, enabled: this.store.state.settings.privacyScrubPii, ruleCount: rules.length });
      return { updated: true, ...getStatusPayload() };
    }
    if (action === 'set_browser') {
      const patch = {};
      if (typeof args.persistentProfile === 'boolean') patch.browserPersistentProfile = args.persistentProfile;
      if (typeof args.blockTrackers === 'boolean') patch.browserBlockTrackers = args.blockTrackers;
      if (typeof args.antiFingerprint === 'boolean') patch.browserAntiFingerprint = args.antiFingerprint;
      if (args.engineMode !== undefined) patch.browserEngineMode = args.engineMode;
      this.settings(patch);
      if (currentTask) this.store.journal(currentTask, 'privacy_updated', { action, patch });
      return { updated: true, applied: patch, ...getStatusPayload() };
    }
    if (action === 'wireguard_import') {
      if (!this.wireguard) throw new Error('WireGuard manager is not available in this runtime.');
      let confText = String(args.configText || '');
      let derivedName = String(args.name || '');
      if (!confText && args.filePath) {
        const fp = path.resolve(currentTask?.workspace || process.cwd(), String(args.filePath));
        if (!fsSync.existsSync(fp)) throw new Error('WireGuard .conf file not found: ' + fp);
        confText = fsSync.readFileSync(fp, 'utf8');
        if (!derivedName) derivedName = path.basename(fp).replace(/\.conf$/i, '');
      }
      const profile = this.wireguard.addProfile({ name: derivedName, configText: confText });
      if (!s.wireguardActiveProfileId) this.settings({ wireguardActiveProfileId: profile.id });
      if (currentTask) this.store.journal(currentTask, 'privacy_updated', { action, profileId: profile.id, name: profile.name });
      return { imported: true, profile, ...getStatusPayload() };
    }
    if (action === 'wireguard_connect') {
      if (!this.privacyController) throw new Error('WireGuard/Tor daemon control is not attached to this runtime.');
      const res = args.chainTor
        ? await this.privacyController.wireguardStartChainTor({ profileId: args.profileId || '', autoInstall: args.autoInstall !== false })
        : await this.privacyController.wireguardStart({ profileId: args.profileId || '', autoInstall: args.autoInstall !== false, activate: true });
      if (currentTask) this.store.journal(currentTask, 'privacy_updated', { action, chainTor: Boolean(args.chainTor) });
      return { connected: true, result: res, ...getStatusPayload() };
    }
    if (action === 'wireguard_disconnect') {
      if (!this.privacyController) throw new Error('WireGuard daemon control is not attached to this runtime.');
      await this.privacyController.wireguardStop();
      if (currentTask) this.store.journal(currentTask, 'privacy_updated', { action });
      return { disconnected: true, ...getStatusPayload() };
    }
    if (action === 'tor_start') {
      if (!this.privacyController) throw new Error('Tor daemon control is not attached to this runtime.');
      const st = await this.privacyController.torStart({ autoInstall: args.autoInstall !== false, activate: true });
      if (currentTask) this.store.journal(currentTask, 'privacy_updated', { action });
      return { started: true, tor: st, ...getStatusPayload() };
    }
    if (action === 'tor_stop') {
      if (!this.privacyController) throw new Error('Tor daemon control is not attached to this runtime.');
      const st = await this.privacyController.torStop();
      if (currentTask) this.store.journal(currentTask, 'privacy_updated', { action });
      return { stopped: true, tor: st, ...getStatusPayload() };
    }
    if (action === 'tor_new_identity') {
      if (!this.privacyController) throw new Error('Tor daemon control is not attached to this runtime.');
      const res = await this.privacyController.torNewIdentity();
      if (currentTask) this.store.journal(currentTask, 'privacy_updated', { action });
      return { rotated: true, ...res, ...getStatusPayload() };
    }
    throw new Error('Unsupported manage_privacy action: ' + action);
  }
  async revertFileChange(id, eventId) {
    const task = this.store.task(id);
    const res = await revertFileBackup(this.store, task, eventId);
    this.changed(task);
    return res;
  }
  pause(id) {
    const task = this.store.task(id);
    this.active.get(id)?.abort();
    this.compressionControllers.get(id)?.abort();
    if (!this.active.has(id)) task.status = 'paused';
    this.changed(task);
  }
  followup(task, text, attachments=[]) {
    const expanded = expandSlashCommand(text, this.store.state.settings.customCommands);
    task.conversation.push({id:crypto.randomUUID(),role:'user', content:text,attachments});
    (task.followupQueue ||= []).push(attachments.length?{text:expanded.prompt,attachments}:expanded.prompt);
    task.pendingFollowups=task.followupQueue.length;
    this.store.journal(task,'user_followup',{instruction:expanded.prompt,whileRunning:true});
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
      if (/^\/compact\b/i.test(instruction.trim())) {
        void (async () => {
          if (this.store.state.settings.microCompaction !== false) await this.microCompactTask(task);
          await this.compact(task);
        })().catch(err => {
          task.error = err?.message || 'Compaction failed.';
          this.changed(task);
        });
        return;
      }
      const expanded = expandSlashCommand(instruction.trim(), this.store.state.settings.customCommands);
      if (expanded.mode) task.agentMode = expanded.mode;
      this.store.transcript(task, attachmentMessage(expanded.prompt,attachments));
      task.conversation.push({id:crypto.randomUUID(),role:'user', content:instruction.trim(),attachments});
      this.store.journal(task,'user_followup',{instruction:expanded.prompt});
    } else if (task.status === 'complete') throw new Error('Write a follow-up instruction to continue a completed task.');
    task.status = 'queued'; task.error = null; this.changed(task); this.schedule();
  }
  approve(id, allowed, { allowSession = false, alwaysAllowPattern = '' } = {}) {
    const pending = this.approvals.get(id);
    if (!pending) throw new Error('Approval request expired.');
    if (allowed && allowSession) {
      const task = this.store.state.tasks.find(t => t.id === pending.taskId);
      if (task) task.sessionAutoApprove = true;
    }
    if (allowed && alwaysAllowPattern) {
      const pattern = String(alwaysAllowPattern).trim();
      if (pattern) {
        const cur = Array.isArray(this.store.state.settings.semiAutoAllowRules) ? this.store.state.settings.semiAutoAllowRules : [];
        if (!cur.includes(pattern)) {
          this.settings({ semiAutoAllowRules: [...cur, pattern] });
        }
      }
    }
    pending.resolve(Boolean(allowed));
  }
  approval(task, name, args, signal, reason = '') {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const finish = (allowed) => {
        signal.removeEventListener('abort', cancel); this.approvals.delete(id);
        task.status = 'running';
        this.store.journal(task, 'approval', { name, allowed, reason });
        this.changed(task); resolve(allowed);
      };
      const cancel = () => { this.approvals.delete(id); this.changed(task); reject(new Error('Cancelled')); };
      if (signal.aborted) return cancel();
      signal.addEventListener('abort', cancel, { once: true });
      this.approvals.set(id, { taskId: task.id, name, args, reason, suggestedPattern: suggestAllowPattern(name, args), resolve:finish }); task.status = 'approval'; this.changed(task);
    });
  }
  approvalCheck(name, task, args = {}) {
    if (['search_capabilities', 'get_capability', 'get_connector', 'load_toolset'].includes(name)) return { required: false, reason: '' };
    if (task?.sessionAutoApprove) return { required: false, reason: '' };
    const level = task?.agentMode || this.store.state.settings.agentMode || 'autopilot';
    if (level === 'unrestricted') return { required: false, reason: '' };
    const isInteractiveBrowser = name === 'browser_inspect' && ((Array.isArray(args?.actions) && args.actions.length > 0) || Boolean(args?.useAccountSession));
    if (!isInteractiveBrowser && (READ_ONLY_TOOL_NAMES.has(name) || this.plugins?.findTool(name)?.tool?.readOnly || ['document_progress', 'todo_write', 'memory_store', 'manage_session'].includes(name))) {
      return { required: false, reason: '' };
    }
    if (name === 'manage_project' && args?.action !== 'delete') {
      return { required: false, reason: '' };
    }
    if (level === 'interactive') {
      return { required: true, reason: 'Interactive autonomy: confirm each modifying or external step.' };
    }
    if (level === 'semi-autopilot') {
      const risk = assessActionRisk(name, args, task, this.store.state.settings);
      return risk.risky ? { required: true, reason: `Semi-Autopilot: ${risk.reason}` } : { required: false, reason: '' };
    }
    if (level === 'autopilot' && task?.agentMode === 'autopilot') {
      return { required: false, reason: '' };
    }
    if (this.store.state.settings.autonomous) return { required: false, reason: '' };
    if (['write_file', 'replace_text', 'multi_edit', 'apply_patch'].includes(name) && this.store.state.settings.autoWorkspaceWrites) return { required: false, reason: '' };
    return { required: true, reason: 'Approval required by workspace autonomy setting.' };
  }
  needsApproval(name, task, args = {}) {
    return this.approvalCheck(name, task, args).required;
  }
  effectiveSettings(task) {
    return {
      ...this.store.state.settings,
      model: task.model,
      reasoningEffort: task.reasoningEffort ?? this.store.state.settings.reasoningEffort,
      providerRouting: task.providerRouting ?? this.store.state.settings.providerRouting,
      contextWindow: task.contextWindow || this.store.state.settings.contextWindow,
      ...(Array.isArray(task.providerOrder) && task.providerOrder.length ? { providerOrder: task.providerOrder } : {}),
      ...(task.agentMode ? { agentMode: task.agentMode } : {}),
      ...(task.temperature !== undefined && task.temperature !== null ? { temperature: task.temperature } : {}),
    };
  }
  async completion(messages, task, signal, { tools = true, maxOutput, effort, acceptTruncated, customTools, silent = false, keepLiveOnSuccess = false } = {}) {
    const settings = this.effectiveSettings(task);
    const connection=modelConnection(task.model, settings);
    let key = this.getSecret(connection.key) || (connection.optionalKey ? 'local-key' : '');
    if (!key) throw new Error('Add your '+connection.name+' API key in Settings.');
    const started=Date.now();
    const streamingMode=Boolean(settings.streaming);
    const guard=new AbortController();
    let lastActivity=Date.now();
    const bump=()=>{lastActivity=Date.now();};
    const hardCap=setTimeout(()=>guard.abort(new DOMException('Maximum generation time exceeded.','TimeoutError')),streamingMode?1800000:900000);
    const idleTimer=streamingMode?setInterval(()=>{if(Date.now()-lastActivity>120000)guard.abort(new DOMException('Provider stopped sending data for 120 seconds.','TimeoutError'));},5000):null;
    const responseId=crypto.randomUUID();
    const responseJournal=tools && !silent && !task.ephemeral ? new ResponseJournal(this.store.directoryFor(task.id),responseId) : null;
    let record=normalizeUsage(undefined,{id:crypto.randomUUID(),responseId,model:task.model,kind:tools?'generation':'compression',status:'pending',sessionAffinity:connection.id==='openrouter'&&settings.cacheAffinity===true});
    let attemptStarted=started, receivedOutput=false, succeeded=false;
    task.calls ||= [];task.calls.push(record);
    if (!silent) { task.liveText=''; task.liveReasoning=''; task.liveActivity='Querying model…'; }
    const account=()=>{task.telemetry=aggregateUsage(task.calls);task.lastTurnTelemetry=aggregateUsage(task.calls.slice(task.turnCallStart||0));};
    account();
    try { this.store.save(task); } catch {}
    if (!silent) this.emitDelta(task);
    let lastPaint=0;
    try{
    let effectiveBase = connection.base;
    if (connection.id === 'copilot' && /^(gho_|ghu_|ghp_|github_pat_)/.test(key) && this.request === fetch) {
      const resolved = await resolveCopilotAuth(key, { request: this.request, base: connection.base });
      key = resolved.token;
      effectiveBase = resolved.base;
    }
    const outputLimit=maxOutput ?? settings.maxOutput;
    const selectedTools=customTools || requestTools(settings, this.plugins, task.loadedToolsets);
    const scrubber = this.activePiiScrubber();
    const outboundMessages = (scrubber.enabled && !isLocalModelEndpoint(effectiveBase))
      ? scrubber.scrubMessages(messages)
      : messages;
    const spec=completionRequest({model:task.model,messages:outboundMessages,settings:{...settings,...(connection.id==='copilot'&&effectiveBase!==connection.base?{copilotBaseUrl:effectiveBase}:{})},tools:tools?selectedTools:undefined,outputLimit,effort,sessionId:settings.cacheAffinity?affinitySession(task,tools):undefined,apiKey:key});
    const send = () => this.request(spec.url, {
      method:'POST', headers:spec.headers,
      body:JSON.stringify(spec.body),
      signal: AbortSignal.any([signal, guard.signal])
    });
    const streamOptions={
      onActivity:bump,
      onMetadata:metadata=>{if(metadata.id)record.id=metadata.id;if(metadata.model)record.model=metadata.model;responseJournal?.call(record);},
      onOutput:()=>{receivedOutput=true;},
      onText:text=>{
        bump();
        if(!tools||silent)return;
        const firstToken = !record.firstTokenMs;
        task.liveText=text;
        task.liveActivity='';
        if(firstToken)record.firstTokenMs=Date.now()-started;
        try { responseJournal?.update(text); } catch {}
        if(firstToken){lastPaint=Date.now();this.emit('change');this.emitDelta(task);}
        else if(Date.now()-lastPaint>45){lastPaint=Date.now();this.emitDelta(task);}
      },
      onReasoning:text=>{
        bump();
        if(!tools||silent)return;
        task.liveReasoning=text;
        task.liveActivity='Thinking…';
        if(Date.now()-lastPaint>60){lastPaint=Date.now();this.emitDelta(task);}
      },
      onUsage:usage=>{bump();for(const [key,value] of Object.entries(normalizeUsage(usage)))if(value!==null)record[key]=value;responseJournal?.call(record);}};
    const readBody=async res=>{
      if (spec.apiFormat === 'anthropic') {
        return res.headers.get('content-type')?.includes('text/event-stream')
          ? readAnthropicStream(res, streamOptions)
          : normalizeAnthropicResponse(await res.json());
      }
      return res.headers.get('content-type')?.includes('text/event-stream')
        ? readCompletionStream(res, streamOptions)
        : res.json();
    };
    let data;
    for(let attempt=0;attempt<2;attempt++) {
      let reading=false;
      try {
        const response=await send();bump();
        if(!response.ok){
          const errBody = await response.text().catch(()=>'');
          const detail = extractSafeProviderDetail(errBody, key);
          throw providerHttpFailure(response.status, connection.name, detail);
        }
        reading=true;data=await readBody(response);break;
      } catch(error) {
        const network=isNetworkFailure(error);
        const retryable=network?retryableNetworkFailure(error):reading||error.retryable===true;
        if(attempt>0||!retryable||signal.aborted||guard.signal.aborted||receivedOutput||(!silent&&task.liveText)||responseJournal?.error||!error?.message)throw network&&!signal.aborted&&!guard.signal.aborted?networkFailure(error,connection.name):error;
        record.status='failed';record.latencyMs=Date.now()-attemptStarted;
        const priorId=record.id;
        record=normalizeUsage(undefined,{id:crypto.randomUUID(),responseId,model:task.model,kind:tools?'generation':'compression',status:'pending',retried:true,retryOf:priorId,sessionAffinity:connection.id==='openrouter'&&settings.cacheAffinity===true});
        task.calls.push(record);attemptStarted=Date.now();if(!silent)task.liveActivity='Connection interrupted. Retrying once…';account();this.changed(task);
        if(network||error.retryable)await retryDelay(750,undefined,{signal:AbortSignal.any([signal,guard.signal])});
      }
    }
    for(const [key,value] of Object.entries(normalizeUsage(data.usage)))if(value!==null)record[key]=value;
    const rawRouter = data.openrouter_metadata;
    const resolvedProvider = rawRouter?.provider_name || rawRouter?.provider || rawRouter?.endpoints?.available?.find?.(e => e.selected)?.provider || data.provider || null;
    const compactRouter = rawRouter ? {
      provider: resolvedProvider,
      provider_name: resolvedProvider,
      region: rawRouter.region || null,
      strategy: rawRouter.strategy || null,
      summary: rawRouter.summary || null,
      generation_time: rawRouter.generation_time ?? null,
    } : (data.provider ? { provider: data.provider, provider_name: data.provider } : null);
    Object.assign(record,{id:data.id||record.id,model:data.model||task.model,status:'complete',router:compactRouter});
    if(!silent)this.calibrate(task, messages, tools, data.usage?.prompt_tokens,selectedTools);
    const message = data.choices?.[0]?.message;
    if(data.error)throw new Error('The provider returned an error during generation.');
    if(tools&&!silent&&message?.content){task.liveText=message.content;responseJournal?.update(message.content);}
    signal.throwIfAborted();guard.signal.throwIfAborted();
    const citations=citationsFromAnnotations(message?.annotations);
    if(data.choices?.[0]?.finish_reason==='length'){
      if(tools&&!silent&&message?.content)task.liveText=message.content;
      if(acceptTruncated&&typeof message?.content==='string'&&message.content.trim().length>=20)return { message:{ role:'assistant', content:message.content, ...(message.reasoning_details?{reasoning_details:message.reasoning_details}:{}), ...(citations.length?{sources:citations}:{}) }, usage:data.usage, truncated:true };
      throw new Error('The model exhausted its output token budget before finishing. Any partial text has been preserved; you can continue with a follow-up instruction or increase max output tokens.');
    }
    if (!message || (!message.content && !message.tool_calls?.length)) throw new Error('The provider returned an empty response.');
    succeeded = true;
    return { responseId, message: { role:'assistant', content:message.content || null, ...(message.reasoning_details ? {reasoning_details:message.reasoning_details} : {}), ...(message.tool_calls?.length ? { tool_calls:message.tool_calls } : {}), ...(citations.length ? {sources:citations} : {}) }, usage:data.usage };
    }catch(error){const guardFired=guard.signal.aborted&&!signal.aborted;const timedOut=guardFired&&(error?.name==='TimeoutError'||error?.name==='AbortError'||/aborted due to timeout/i.test(error?.message||''));record.status=signal.aborted?'interrupted':'failed';if(!silent&&task.liveText){task.conversation.push({id:responseId,role:'assistant',content:task.liveText+'\n\n[Interrupted response; incomplete.]'});this.store.journal(task,'partial_response',{text:task.liveText});}if(timedOut)throw new Error('The provider stopped responding in time (slow stream or generation timeout). Any partial text has been preserved; you can resume the task.');throw error;}
    finally{clearTimeout(hardCap);if(idleTimer)clearInterval(idleTimer);try{responseJournal?.close();}catch{}record.latencyMs=Date.now()-attemptStarted;account();if(!silent&&(!keepLiveOnSuccess||!succeeded)){task.liveText='';task.liveReasoning='';task.liveActivity='';this.changed(task);}else if(silent){this.changed(task);}}
  }
  calibrate(task, messages, tools, promptTokens,toolSchema=requestTools(this.effectiveSettings(task), this.plugins, task.loadedToolsets)) {
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
  compactionTail(task, messages = [], { forceEmptyTail = false } = {}) {
    if (forceEmptyTail || !messages.length) return { archived: messages, tail: [] };
    const windowSize = task?.contextWindow || this.store.state.settings.contextWindow;
    const budget = Math.max(3000, Math.min(12000, Math.floor(windowSize * 0.16)));
    let start = messages.length, tokens = 0;
    for (let index = messages.length - 1; index >= 0; index--) {
      const weight = this.estimate(task, this.scrubMessages([messages[index]]));
      if (tokens + weight > budget) {
        if (start === messages.length) return { archived: messages, tail: [] };
        break;
      }
      start = index; tokens += weight;
    }
    if (start === 0) return { archived: messages, tail: [] };
    // Never cut inside a tool_calls -> tool response group
    if (messages[start]?.role === 'tool') {
      let call = start - 1;
      while (call >= 0 && messages[call].role === 'tool') call--;
      if (call > 0 && messages[call]?.role === 'assistant' && messages[call]?.tool_calls?.length) {
        const groupWeight = this.estimate(task, this.scrubMessages(messages.slice(call)));
        if (groupWeight <= Math.floor(budget * 1.5)) {
          start = call;
        } else {
          // Tool group is too large for tail budget; advance past all its tool responses so the full group is archived cleanly
          let afterTools = start;
          while (afterTools < messages.length && messages[afterTools].role === 'tool') afterTools++;
          start = afterTools;
        }
      } else {
        // Reaching index 0 would archive nothing; advance past the tool outputs instead
        let afterTools = start;
        while (afterTools < messages.length && messages[afterTools].role === 'tool') afterTools++;
        start = afterTools;
      }
    }
    // Skip dangling assistant messages at the start of tail so providers requiring user-first alternation stay valid
    while (start < messages.length && messages[start]?.role === 'assistant') {
      if (messages[start]?.tool_calls?.length) {
        start++;
        while (start < messages.length && messages[start]?.role === 'tool') start++;
      } else {
        start++;
      }
    }
    if (start === 0 || start >= messages.length) return { archived: messages, tail: [] };
    return { archived: messages.slice(0, start), tail: messages.slice(start) };
  }
  async microCompactTask(task, { keepRecent = 6, minChars = 1200 } = {}) {
    if (!Array.isArray(task.messages) || task.messages.length <= keepRecent) return { prunedCount: 0, estimatedTokensFreed: 0 };
    const cutoff = task.messages.length - keepRecent;
    let prunedCount = 0, freedChars = 0;
    const callNames = new Map();
    for (const msg of task.messages) {
      if (msg?.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        for (const c of msg.tool_calls) if (c?.id) callNames.set(c.id, c.function?.name || 'tool');
      }
    }
    for (let i = 0; i < cutoff; i++) {
      const msg = task.messages[i];
      if (!msg || msg.role !== 'tool' || typeof msg.content !== 'string') continue;
      if (msg.content.length < minChars) continue;
      if (msg.content.startsWith('[Micro-compacted ') || msg.content.includes('"artifact":{')) continue;
      const toolName = callNames.get(msg.tool_call_id) || 'tool';
      try {
        const saved = await saveRawArtifact(this.store, task, `micro_${toolName}`, msg.content);
        const origLen = msg.content.length;
        msg.content = `[Micro-compacted earlier ${toolName} output (${origLen} chars freed). Full original saved in artifact ${saved.id}; call read_artifact or search_history if exact details are needed.]`;
        freedChars += Math.max(0, origLen - msg.content.length);
        prunedCount++;
      } catch {
        // Keep original intact if artifact write fails
      }
    }
    if (!prunedCount) return { prunedCount: 0, estimatedTokensFreed: 0 };
    const estimatedTokensFreed = Math.ceil(freedChars / (task.bytesPerToken || 3));
    this.store.journal(task, 'micro_compaction', { prunedCount, freedChars, estimatedTokensFreed });
    this.changed(task);
    return { prunedCount, freedChars, estimatedTokensFreed };
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
    const mode=task.agentMode||this.store.state.settings.agentMode||'autopilot';
    const modeRule=mode==='interactive'?'\nAutonomy Level: INTERACTIVE. Collaborate step-by-step with the user; mutating and external actions will pause for explicit user confirmation.':
      mode==='semi-autopilot'?'\nAutonomy Level: SEMI-AUTOPILOT. Read files and apply normal workspace edits autonomously; risky shell commands, deletions, git push/reset, external HTTP mutations, and desktop actions will request user confirmation.':
      mode==='autopilot'?'\nAutonomy Level: AUTOPILOT. Execute tasks end-to-end autonomously across workspace files, terminal, Git, and web tools.':
      mode==='unrestricted'?'\nAutonomy Level: FULL UNRESTRICTED. Absolute autonomous local environment access with zero path confinement and zero approval prompts; execute the user objective directly.':
      mode==='architect'?'\nOperating Mode: ARCHITECT (Plan & Design). Inspect files, analyze architecture, and maintain a structured checklist with todo_write.':
      mode==='explore'?'\nOperating Mode: EXPLORE (Read-Only Research). Use fast search and file inspection tools to answer questions accurately with file and line evidence.':'';
    const silentRule = this.store.state.settings.silentToolSteps
      ? '\nExecution Style: SILENT TOOL CHAINING. Do NOT emit progress narrations, status updates, or intermediate follow-up text between tool calls. Emit tool calls directly with empty assistant content until the entire task is complete or you genuinely need to ask the user an important question.'
      : '';
    const storageRule = task.ephemeral
      ? '\nSession Storage: RAM-ONLY (EPHEMERAL). Zero disk traces are written for this session; child sessions inherit RAM-Only by default. You can migrate back to Regular storage via manage_session(action="set_ephemeral", ephemeral=false) if requested.'
      : '';
    const adminRule = task.adminMode
      ? '\nWindows Privileges: ADMINISTRATOR RIGHTS ENABLED for this session. run_command executes elevated (services, VPN/network adapters, firewall, registry, system administration).'
      : '';
    const privacyLine = '\n' + this.privacyPostureLine();
    const baseInstructions = task.systemPromptOverride?.trim() || this.store.state.settings.globalInstructions;
    const customAddendum = this.store.state.settings.customSystemPrompt?.trim()
      ? `\n\n[User Custom System Prompt — Always Preserved]\n${this.store.state.settings.customSystemPrompt.trim()}`
      : '';
    const unrestricted = mode === 'unrestricted' || mode === 'autopilot' || this.store.state.settings.autonomous;
    const workspaceLabel = task.workspace || (unrestricted ? `${process.cwd()} (default cwd; unrestricted access)` : '(no folder)');
    const context = [{ role:'system', content:baseInstructions + customAddendum + '\nProject: ' + workspaceLabel + (project?.name ? ` (${project.name})` : '') + '\nProject instructions: ' + (project?.instructions || '') + '\nOriginal objective: ' + task.prompt + webRule + modeRule + silentRule + storageRule + adminRule + privacyLine }];
    const sections=[{id:'instructions',label:'Instructions & Objective',reason:'Stable prefix: global instructions, workspace folder, project instructions, and original objective.',value:context[0],count:1}];
    if(pinned.length)sections.push({id:'pins',label:'Pinned Messages',reason:'Explicitly pinned by the user to survive compaction.',value:pinned,count:pinned.length});
    if(dependencyContext.length)sections.push({id:'dependencies',label:'Task Dependencies',reason:'Results and recent progress notes from prerequisite tasks.',value:dependencyContext,count:dependencyContext.length});
    const workspaceRules = task.workspace ? discoverWorkspaceInstructions(task.workspace) : '';
    if(workspaceRules)sections.push({id:'workspace-rules',label:'Repository Rules (NEXUS.md / CLAUDE.md / AGENTS.md)',reason:'Auto-discovered project instruction files in the workspace root.',value:workspaceRules,count:1});
    const projectSkills = task.workspace ? discoverWorkspaceSkills(task.workspace) : [];
    if(projectSkills.length)sections.push({id:'project-skills',label:'Project Skills (SKILL.md)',reason:'Auto-discovered SKILL.md files in .nexus/skills, .github/skills, or .claude/skills.',value:projectSkills.map(s=>({name:s.name,description:s.description,sourcePath:s.sourcePath})),count:projectSkills.length});
    const relevantMemories = selectMemoriesForContext(this.store.state.memories || [], { workspace: task.workspace || '' });
    const formattedMemories = formatMemoriesForPrompt(relevantMemories);
    if(relevantMemories.length)sections.push({id:'memories',label:'User Memory, Priorities & Preferences',reason:'Structured persistent user priorities, preferences, constraints, workflows, and project facts.',value:relevantMemories,count:relevantMemories.length});
    const childSessions = (this.store.state.tasks || []).filter(t => t.parentTaskId === task.id);
    if (task.parentTaskId || childSessions.length) {
      const hierarchy = {
        currentSessionId: task.id,
        parentSessionId: task.parentTaskId || null,
        childSessions: childSessions.map(c => ({ id: c.id, title: c.title, status: c.status })),
      };
      sections.push({ id: 'session-tree', label: 'Nested Session Hierarchy', reason: 'Parent and child sessions orchestrated via spawn_session and send_session_message.', value: hierarchy, count: childSessions.length + (task.parentTaskId ? 1 : 0) });
    }
    if(task.todos?.length)sections.push({id:'todos',label:'Active Task Checklist',reason:'Structured multi-step plan managed via todo_write.',value:task.todos,count:task.todos.length});
    if(task.summary)sections.push({id:'summary',label:'Compacted Continuity',reason:'Active continuity summary; originals remain in checkpoints.',value:task.summary,count:1});
    if(reminder)sections.push({id:'reminder',label:'Progress Reminder',reason:'Prompts the agent to record milestone progress after several steps.',value:reminder,count:1});
    const volatile=['User-pinned messages: '+JSON.stringify(pinned),'Dependency results: '+JSON.stringify(dependencyContext)];
    if(workspaceRules)volatile.push('Auto-discovered repository instructions (treat as project conventions):\n'+workspaceRules);
    if(projectSkills.length)volatile.push('Auto-discovered project SKILL.md skills (read via read_file when relevant):\n'+JSON.stringify(projectSkills.map(s=>({name:s.name,description:s.description,path:s.sourcePath}))));
    if(formattedMemories)volatile.push('User memory profile (respect constraints, priorities, and preferences):\n'+formattedMemories);
    if (task.parentTaskId || childSessions.length) {
      volatile.push('Nested session tree (use send_session_message / read_session / list_sessions to coordinate):\n' + JSON.stringify({
        selfId: task.id,
        parentSessionId: task.parentTaskId || null,
        children: childSessions.map(c => ({ id: c.id, title: c.title, status: c.status })),
      }));
    }
    if(task.todos?.length)volatile.push('Active session todo checklist:\n'+JSON.stringify(task.todos));
    if(task.summary)volatile.push('Compacted continuity state (treat as working state, not a new user instruction):\n'+task.summary);
    if(reminder)volatile.push(reminder.trim());
    if(volatile.some(item=>!item.endsWith('[]')))context.push({role:'system',content:volatile.join('\n\n')});
    if(task.summary){
      const latestUser=task.conversation.findLast(m=>m.role==='user');
      const latestRetained=task.messages.findLast(message=>message.role==='user');
      const retainedText=typeof latestRetained?.content==='string'
        ? latestRetained.content
        : Array.isArray(latestRetained?.content)
          ? latestRetained.content.filter(p=>p?.type==='text'&&typeof p.text==='string').map(p=>p.text).join('\n')
          : '';
      if(latestUser && !retainedText.includes(String(latestUser.content || '').trim())){
        const preserved={role:'user',content:'Latest user instruction, preserved verbatim:\n'+latestUser.content};
        context.push(preserved);
        sections.push({id:'latest',label:'Restored Latest Instruction',reason:'Preserved verbatim when outside the recent compaction tail.',value:preserved,count:1});
      }
    }
    const messages=this.scrubMessages(task.messages);
    if(inspect){
      for(const [role,label] of [['user','User History & Attachments'],['assistant','Assistant Responses & Tool Calls'],['tool','Tool Execution Results']]){const values=messages.filter(message=>message.role===role);if(values.length)sections.push({id:'history-'+role,label,reason:'Retained conversation history without hidden reasoning or UI citation wrappers.',value:values,count:values.length});}
      return {messages:context.concat(messages),sections};
    }
    if (!hydrate) return context.concat(messages);
    // Keep user uploads + only the latest 2 desktop screenshots hydrated as base64 to avoid multi-MB payload bloat on long desktop sessions
    const desktopImgIndices = [];
    for (let idx = 0; idx < messages.length; idx++) {
      const m = messages[idx];
      if (Array.isArray(m?.content) && m.content.some(p => p?.type === 'nexus_attachment' && p.attachment?.kind === 'image' && p.attachment?.storage !== 'uploads')) {
        desktopImgIndices.push(idx);
      }
    }
    const staleDesktopIndices = new Set(desktopImgIndices.slice(0, Math.max(0, desktopImgIndices.length - 2)));
    return context.concat(messages.map((message, idx) => {
      if (staleDesktopIndices.has(idx) && Array.isArray(message?.content)) {
        return {
          ...message,
          content: message.content.map(part => (
            part?.type === 'nexus_attachment' && part.attachment?.kind === 'image' && part.attachment?.storage !== 'uploads'
              ? { type: 'text', text: `[Earlier desktop screenshot saved as attachment ${part.attachment.id}; call read_attachment if needed.]` }
              : part
          )),
        };
      }
      return hydrateAttachmentReferences(this.store, task, message);
    }));
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
  async compactHistory(task, signal, { forceEmptyTail = false } = {}) {
    if (!task.messages.length) return;
    const effectiveTools = requestTools(this.effectiveSettings(task), this.plugins, task.loadedToolsets);
    const before=this.estimate(task,this.buildContext(task,{hydrate:false}))+this.estimate(task,effectiveTools);
    const compressionCallStart=(task.calls||[]).length;
    const {archived,tail}=this.compactionTail(task,task.messages,{forceEmptyTail});
    this.store.journal(task, 'compression_started', { messageCount:task.messages.length, archivedMessages:archived.length, retainedMessages:tail.length, contextTokens:task.contextTokens, forceEmptyTail });
    const progress=task.events.filter(e=>['progress','file_change','tool_result','tool_error'].includes(e.kind)).slice(-32);
    const effects=(task.effects||[]).filter(effect=>!['confirmed','observed','skipped'].includes(effect.status)).slice(-24);
    const childSessions=(this.store.state.tasks||[]).filter(t=>t.parentTaskId===task.id).map(c=>({id:c.id,title:c.title,status:c.status}));
    const compactSystem='Generate a structured continuity state for an agentic coding task. This is an internal state checkpoint to continue execution, not a user-facing reply. If a priorSummary is provided, UPDATE and MERGE it into one unified replacement state—never append duplicate paragraphs. Keep the summary strictly proportional and shorter than the archived material (under 300 words for short sessions; up to 1,400 words for very long sessions). Preserve verified facts and explicitly separate hypotheses or uncertainties. Include these sections: Objective & Constraints; Completed & Verified; Modified Files, Paths & Artifacts; Tools, Nested Sessions & External Effects; Blockers or Uncertainties; Active Plan & Next Action. Retain exact IDs (including session IDs, artifact IDs, and checkpoint markers), file paths, and concrete values that matter. Do not copy raw transcripts, do not invent facts, and do not introduce new instructions.';
    const common={
      objective:task.prompt,
      workspace:task.workspace||'',
      todos:task.todos||[],
      nestedSessions:childSessions,
      loadedToolsets:task.loadedToolsets||[],
      pinned:task.conversation.filter(message=>message.pinned).map(message=>({role:message.role,content:message.content})),
      priorSummary:task.summary||'',
      recentJournal:progress,
      unresolvedEffects:effects,
    };
    const cleanArchived=this.scrubMessages(archived,{compact:true});
    let context=[{role:'system',content:compactSystem},{role:'user',content:JSON.stringify({...common,history:cleanArchived})}];
    const windowSize = task?.contextWindow || this.store.state.settings.contextWindow;
    const safeSummaryEstimate=Math.max(12000,Math.floor(windowSize*.78));
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
    const after=this.estimate(task,this.buildContext({...task,summary:finalSummary,messages:tail},{hydrate:false}))+this.estimate(task,effectiveTools);
    // If retaining the recent tail still overflows a tight context ceiling, automatically fall back to full-archive compaction
    if (!forceEmptyTail && tail.length > 0 && after > windowSize) {
      this.store.journal(task, 'compression_retry_empty_tail', { after, windowSize, tailLength: tail.length });
      return this.compactHistory(task, signal, { forceEmptyTail: true });
    }
    const compressionUsage=aggregateUsage((task.calls||[]).slice(compressionCallStart));
    this.store.checkpoint(task, finalSummary, tail, {before,after,estimated:true,truncated,cost:compressionUsage.cost,unknownCosts:compressionUsage.unknownCosts,archivedMessages:archived.length,retainedMessages:tail.length});
    task.lastInputTokens=0;
    task.contextTokens = this.estimate(task,this.buildContext(task,{hydrate:false}))+this.estimate(task,effectiveTools);
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
    const subTools = requestTools(subSettings, this.plugins).filter(t => t.function?.name !== 'delegate_subagent');
    const subId = crypto.randomUUID().slice(0, 8);
    const subState = { id: subId, mode, objective: objective.slice(0, 140), status: 'running', step: 0, maxSteps, startedAt: new Date().toISOString() };
    parentTask.liveSubagents = [...(parentTask.liveSubagents || []), subState];
    this.store.journal(parentTask, 'subagent_started', { id: subId, mode, objective: objective.slice(0, 200) });
    this.emit('change');
    const thread = [
      { role: 'system', content: `You are a focused NEXUS sub-agent operating in ${mode.toUpperCase()} mode inside workspace ${parentTask.workspace || '(no folder)'}. Complete the delegated objective concisely with concrete file/line evidence and return a compact synthesis.` },
      { role: 'user', content: objective },
    ];
    let stepsExecuted = 0;
    try {
      for (let step = 0; step < maxSteps; step++) {
        signal.throwIfAborted();
        subState.step = step + 1;
        this.emit('change');
        const { message } = await this.completion(thread, parentTask, signal, { tools: true, customTools: subTools, silent: true });
        stepsExecuted++;
        thread.push(message);
        if (!message.tool_calls?.length) {
          subState.status = 'complete';
          this.store.journal(parentTask, 'subagent_complete', { id: subId, mode, stepsExecuted, objective: objective.slice(0, 200) });
          return { mode, stepsExecuted, report: message.content || '' };
        }
        for (const call of message.tool_calls) {
          signal.throwIfAborted();
          let toolResult;
          try {
            let parsedArgs = JSON.parse(call.function.arguments || '{}');
            const scrubber = this.activePiiScrubber();
            if (scrubber.enabled) parsedArgs = scrubber.unscrubValue(parsedArgs);
            const approvalDecision = this.approvalCheck(call.function.name, parentTask, parsedArgs);
            if (approvalDecision.required && !(await this.approval(parentTask, call.function.name, parsedArgs, signal, approvalDecision.reason))) {
              toolResult = { denied: true, reason: 'The user declined this sub-agent action.' };
            } else {
              toolResult = await executeTool(this, parentTask, call.function.name, parsedArgs, signal);
            }
          } catch (err) {
            toolResult = { error: err.message };
          }
          const serialized = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
          thread.push({ role: 'tool', tool_call_id: call.id, content: serialized.slice(0, 12000) });
        }
      }
      // Reached maxSteps while still invoking tools: run one final tool-free synthesis turn so we never return empty "\n\n"
      signal.throwIfAborted();
      thread.push({ role: 'user', content: 'You have reached the sub-agent step limit. Do not call any more tools. Provide your concise final synthesis report now based strictly on the evidence already gathered.' });
      let finalReport = '';
      try {
        const synth = await this.completion(thread, parentTask, signal, { tools: false, silent: true, maxOutput: 3000 });
        finalReport = String(synth?.message?.content || '').trim();
      } catch {}
      if (!finalReport) {
        finalReport = String(thread.findLast(m => m.role === 'assistant' && String(m.content || '').trim())?.content || '').trim()
          || 'Sub-agent reached step ceiling without producing a final synthesis.';
      }
      subState.status = 'complete';
      this.store.journal(parentTask, 'subagent_complete', { id: subId, mode, stepsExecuted, synthesizedAtCeiling: true, objective: objective.slice(0, 200) });
      return { mode, stepsExecuted, report: finalReport };
    } catch (error) {
      subState.status = 'error';
      throw error;
    } finally {
      parentTask.liveSubagents = (parentTask.liveSubagents || []).filter(s => s.id !== subId);
      this.emit('change');
    }
  }
  async executeSingleToolCall(task, call, signal, toolRunRecord) {
    let result, effect;
    const started = Date.now();
    try {
      if (!baseTools.some(t => t.function.name === call.function.name) && !this.plugins?.findTool(call.function.name)) throw new Error('Unknown tool');
      let args = JSON.parse(call.function.arguments || '{}');
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments');
      // Transparently restore PII-scrubbed local paths/hostnames before local tool execution
      const scrubber = this.activePiiScrubber();
      if (scrubber.enabled) args = scrubber.unscrubValue(args);
      let name = call.function.name;
      if(name==='invoke_function'){
        const resolved=this.capabilities.resolve(args.id,args.input);
        name=resolved.tool;args=resolved.args;
        this.store.journal(task,'function_resolved',{...resolved.capability,tool:name});
      }
      toolRunRecord.name = name;
      toolRunRecord.args = args;
      if(name.startsWith('desktop_')) {
        if(this.desktopOwner && this.desktopOwner !== task.id) throw new Error('Another agent is currently using the desktop. Continue with independent work or finish and resume later.');
        this.desktopOwner = task.id;
      }
      const approvalDecision = this.approvalCheck(name, task, args);
      if (approvalDecision.required && !(await this.approval(task, name, args, signal, approvalDecision.reason))) {
        result = { denied:true, reason:'The user declined this action. Respect this decision.' };
        toolRunRecord.status = 'denied';
      } else {
        this.store.journal(task, 'tool_intent', {name,args});
        if(externalEffects.has(name)){
          effect=this.store.beginEffect(task,name,args);
          this.store.updateEffect(task,effect.id,'dispatched');
        }
        task.liveActivity='Executing '+name.replaceAll('_',' ')+'…';
        this.emitDelta(task);
        result = await executeTool(this, task, name, args, signal, effect);
        toolRunRecord.status = 'done';
      }
      if (result?.image) {
        const { image: rawImage, dimensions, name: imgName, ...restResult } = result;
        const attachment=await materializeImageAttachment(this.store,task,rawImage,{dimensions,name:imgName||'desktop-screenshot'});
        task.pendingImages ||= [];
        task.pendingImages.push(attachment);
        this.store.journal(task, 'tool_result', {name, result:'Screenshot saved as local attachment', attachment});
        if(effect)this.store.updateEffect(task,effect.id,'observed',{artifact:attachment});
        toolRunRecord.durationMs = Date.now() - started;
        toolRunRecord.preview = 'Captured screenshot attachment';
        const hasExtraPayload = Object.keys(restResult).length > 0;
        if (hasExtraPayload) {
          const materializedExtra = await materializeToolResult(this.store, task, name, { ...restResult, capturedScreenshot: true, dimensions });
          const serializedExtra = typeof materializedExtra.model === 'string' ? materializedExtra.model : JSON.stringify(materializedExtra.model);
          toolRunRecord.preview = serializedExtra.slice(0, 800);
          return { callId: call.id, serialized: serializedExtra };
        }
        return { callId: call.id, serialized: JSON.stringify({captured:true,dimensions}) };
      }
      if (Array.isArray(result?.chatMedia) && result.chatMedia.length) {
        task.conversation.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          media: result.chatMedia,
          isMediaCard: true,
        });
        this.store.journal(task, 'media_presented', { count: result.chatMedia.length, items: result.chatMedia.map(m => ({ id: m.id, kind: m.kind, name: m.name, bytes: m.bytes })) });
        this.changed(task);
        const compactModelReply = {
          presented: true,
          count: result.chatMedia.length,
          items: result.chatMedia.map(m => ({ id: m.id, kind: m.kind, title: m.title, name: m.name, mime: m.mime, bytes: m.bytes })),
        };
        const serializedMedia = JSON.stringify(compactModelReply);
        toolRunRecord.durationMs = Date.now() - started;
        toolRunRecord.preview = `Presented ${result.chatMedia.length} media item(s) inline in chat`;
        return { callId: call.id, serialized: serializedMedia };
      }
      const materialized=await materializeToolResult(this.store,task,name,result);
      this.store.journal(task, 'tool_result', {name, result:materialized.journal});
      if(effect)this.store.updateEffect(task,effect.id,'observed',{artifact:materialized.artifact || null});
      task.liveActivity='Verifying output of '+name.replaceAll('_',' ')+'…';
      if (result && typeof result === 'object' && result.written) {
        const lastFileEvent = task.events.findLast(e => e.kind === 'file_change');
        toolRunRecord.filePath = result.written;
        toolRunRecord.fileChangeEventId = lastFileEvent?.id || null;
        toolRunRecord.hasBackup = Boolean(result.backup || lastFileEvent);
        if (result.diff) {
          toolRunRecord.diff = String(result.diff).slice(0, 6000);
          toolRunRecord.addedLines = result.addedLines || 0;
          toolRunRecord.removedLines = result.removedLines || 0;
        }
      }
      result=materialized.model;
      const serialized = typeof result === 'string' ? result : JSON.stringify(result);
      toolRunRecord.durationMs = Date.now() - started;
      toolRunRecord.preview = serialized.slice(0, 800);
      task._repeatErrorKey = '';
      task._repeatErrorCount = 0;
      return { callId: call.id, serialized };
    } catch (error) {
      toolRunRecord.durationMs = Date.now() - started;
      toolRunRecord.status = 'error';
      toolRunRecord.error = error.message;
      if (signal.aborted) { if(effect)this.store.updateEffect(task,effect.id,'uncertain',{note:'Task was paused before observing a verifiable result.'}); throw error; }
      if(effect)this.store.updateEffect(task,effect.id,'uncertain',{note:'Execution returned an error or was interrupted before observing a verifiable result.',error:error.message});
      this.store.journal(task, 'tool_error', {name:call.function.name,error:error.message});
      const errKey = `${call.function.name}|${call.function.arguments || ''}|${error.message}`;
      if (task._repeatErrorKey === errKey) task._repeatErrorCount = (task._repeatErrorCount || 1) + 1;
      else { task._repeatErrorKey = errKey; task._repeatErrorCount = 1; }
      const payload = { error: error.message };
      if (task._repeatErrorCount >= 3) {
        payload.loopWarning = `You have called ${call.function.name} with the exact same arguments and hit the same error ${task._repeatErrorCount} times in a row. Do NOT repeat this identical call; change the arguments, use an alternative operation/tool, or report the limitation.`;
      }
      return { callId: call.id, serialized: JSON.stringify(payload) };
    }
  }
  async run(task, signal) {
    await this.plugins.ready;
    task.turnCallStart=task.calls?.length || 0;
    this.repairInterruptedCalls(task);
    this.flushPendingImages(task);
    const maxSteps = this.store.state.settings.maxSteps;
    for (let step = 0; !maxSteps || step < maxSteps; step++) {
      signal.throwIfAborted();
      this.flushFollowups(task);
      this.refreshProgressReminder(task);
      task.liveActivity=step ? 'Analyzing tool output…' : 'Thinking…';
      task.liveTools = [];
      this.emitDelta(task);
      const settings = this.effectiveSettings(task);
      const effectiveTools = requestTools(settings, this.plugins, task.loadedToolsets);
      task.contextTokens = Math.max(this.estimate(task, this.buildContext(task,{hydrate:false})) + this.estimate(task, effectiveTools), task.lastInputTokens || 0);
      const threshold = settings.contextWindow * settings.compressionPercent / 100;
      if (task.contextTokens >= threshold) {
        // Stage 1: Zero-cost micro-compaction prunes old oversized tool outputs into lossless artifact references first
        if (settings.microCompaction !== false) {
          const micro = await this.microCompactTask(task);
          if (micro.prunedCount > 0) {
            task.lastInputTokens = 0;
            task.contextTokens = this.estimate(task, this.buildContext(task, { hydrate: false })) + this.estimate(task, effectiveTools);
          }
        }
        // Stage 2: Full structured LLM checkpoint compaction if still at or above threshold
        if (task.contextTokens >= threshold) {
          await this.compact(task, signal);
          task.lastInputTokens = 0;
        }
      }
      if (this.estimate(task, this.buildContext(task,{hydrate:false})) + this.estimate(task, effectiveTools) > settings.contextWindow) throw new Error('Context exceeds the operating ceiling even after compaction. Increase the context ceiling or split the task; history is preserved.');
      const {message, usage, responseId} = await this.completion(this.buildContext(task), task, signal, { keepLiveOnSuccess: true });
      task.steps++; task.lastInputTokens = usage?.prompt_tokens || 0; task.usage = (task.usage || 0) + (usage?.total_tokens || 0);
      this.store.transcript(task, message);
      const stepReasoning=reasoningToText(message.reasoning_details);
      const cleanContent = typeof message.content === 'string' && message.content.trim() ? message.content : null;
      const toolRecords = (message.tool_calls || []).map(call => ({
        id: crypto.randomUUID(),
        callId: call.id,
        step: task.steps,
        name: call.function.name,
        args: {},
        status: 'running',
        durationMs: null,
        preview: '',
      }));
      let convEntry = null;
      if (cleanContent || stepReasoning || toolRecords.length) {
        convEntry = {
          id: responseId,
          role: 'assistant',
          content: cleanContent,
          ...(stepReasoning ? { reasoning: stepReasoning } : {}),
          ...(message.sources?.length ? { sources: message.sources } : {}),
          ...(toolRecords.length ? { toolRuns: toolRecords } : {}),
          step: task.steps || undefined,
          telemetry: task.lastTurnTelemetry,
        };
        task.conversation.push(convEntry);
      }
      // Clear live stream atomically in the same synchronous frame as pushing convEntry (zero flicker!)
      task.liveText = '';
      task.liveReasoning = '';
      task.liveActivity = toolRecords.length ? `Running ${toolRecords.length} ${toolRecords.length === 1 ? 'tool' : 'tools'}…` : '';
      task.liveTools = [];
      task.contextTokens=this.estimate(task,this.buildContext(task,{hydrate:false}))+this.estimate(task,requestTools(this.effectiveSettings(task), this.plugins, task.loadedToolsets));
      if (!message.tool_calls?.length) {
        task.result = message.content; task.status = 'complete';
        this.store.journal(task, 'complete', { result:message.content });
        this.changed(task);
        return;
      }
      this.changed(task);

      const canParallel = message.tool_calls.length > 1 && message.tool_calls.every(call =>
        (READ_ONLY_TOOL_NAMES.has(call.function.name) || this.plugins?.findTool(call.function.name)?.tool?.readOnly) && !this.needsApproval(call.function.name, task)
      );
      if (canParallel) {
        const results = await Promise.all(message.tool_calls.map((call, idx) => this.executeSingleToolCall(task, call, signal, toolRecords[idx])));
        for (const item of results) {
          this.store.transcript(task, { role: 'tool', tool_call_id: item.callId, content: item.serialized });
        }
        this.changed(task);
      } else {
        for (let idx = 0; idx < message.tool_calls.length; idx++) {
          signal.throwIfAborted();
          const item = await this.executeSingleToolCall(task, message.tool_calls[idx], signal, toolRecords[idx]);
          this.store.transcript(task, { role: 'tool', tool_call_id: item.callId, content: item.serialized });
          this.changed(task);
        }
      }
      this.flushPendingImages(task);
    }
    throw new Error('Step limit reached. Progress is saved; you can resume anytime.');
  }
  validateConnector(connector) {
    if (!connector || typeof connector.name !== 'string' || !/^[\w -]{1,80}$/.test(connector.name)) throw new Error('Invalid connector name.');
    const url = new URL(connector.url);
    const allowedProtocols = connector.openapi ? ['https:'] : ['https:', 'http:'];
    if (!allowedProtocols.includes(url.protocol) || url.username || url.password) throw new Error(connector.openapi ? 'Use an HTTPS URL without embedded credentials.' : 'Use an HTTP or HTTPS URL without embedded credentials.');
    if (!['GET','POST','PUT','PATCH','DELETE'].includes(connector.method)) throw new Error('Unsupported HTTP method');
    if (connector.secretRef && !/^CONNECTOR_[A-Z0-9_]+$/.test(connector.secretRef)) throw new Error('Secret reference must start with CONNECTOR_.');
    if(connector.idempotencyHeader !== undefined && typeof connector.idempotencyHeader !== 'boolean')throw new Error('Invalid idempotency configuration.');
    if(connector.openapi)validateOpenApiConnector(connector);
    if(connector.reconciliationUrl){
      if(typeof connector.reconciliationUrl !== 'string')throw new Error('Invalid reconciliation URL.');
      const check=new URL(connector.reconciliationUrl.replaceAll('{operationId}','00000000-0000-0000-0000-000000000000'));
      if(!['https:', 'http:'].includes(check.protocol)||check.username||check.password)throw new Error('Reconciliation URL must be HTTP or HTTPS and must not contain embedded credentials.');
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
    if (!connector.openapi && connector.method === 'GET') {
      for (const [key, value] of Object.entries(args.input || {})) {
        if (value === undefined || value === null) continue;
        if (key === 'query' && typeof value === 'object' && !Array.isArray(value)) {
          for (const [qk, qv] of Object.entries(value)) {
            if (qv === undefined || qv === null) continue;
            url.searchParams.set(qk, typeof qv === 'object' ? JSON.stringify(qv) : String(qv));
          }
          continue;
        }
        url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
    }
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
  shutdown() { this.closed = true; for (const controller of this.active.values()) controller.abort();for(const controller of this.compressionControllers.values())controller.abort(); this.processes?.stopAll(); try{this.store.flushSave();}catch{} }
}
