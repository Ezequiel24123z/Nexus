import React,{useState} from 'react';
import {KeyRound,CheckCircle2,Sparkles} from 'lucide-react';

const PROVIDER_META = {
  openrouter: { name: 'OpenRouter', key: 'OPENROUTER_API_KEY', defaultModel: 'deepseek/deepseek-v4.1-flash', effort: 'none', hint: 'Unified router across 300+ models with prompt caching, routing preferences, and server web search.' },
  arliai: { name: 'Arli.ai', key: 'ARLIAI_API_KEY', defaultModel: 'arliai/DeepSeek-V4.1-Flash-1017', effort: 'max', hint: 'Dedicated uncensored/derestricted and high-context coding models (DeepSeek V4.1 Flash, GLM Derestricted, QwQ).' },
  openai: { name: 'OpenAI', key: 'OPENAI_API_KEY', defaultModel: 'openai/gpt-5', effort: 'medium', hint: 'Direct OpenAI API connection for GPT-5, GPT-4.1, o3, and o4-mini with native tool calling and reasoning.' },
  copilot: { name: 'GitHub Copilot', key: 'GITHUB_COPILOT_TOKEN', defaultModel: 'copilot/claude-sonnet-4.5', effort: 'medium', hint: 'Use your GitHub Copilot / GitHub Models token. Import automatically from GitHub CLI (`gh auth login`) or paste your token.' },
  anthropic: { name: 'Anthropic', key: 'ANTHROPIC_API_KEY', defaultModel: 'anthropic/claude-sonnet-4-5', effort: 'medium', hint: 'Direct Anthropic API for Claude Sonnet 4.5, Claude Opus 4.5, and Claude Haiku 4.5.' },
  custom: { name: 'Custom / Local', key: 'CUSTOM_API_KEY', defaultModel: 'custom/qwen2.5-coder:32b', effort: 'none', hint: 'Connect to any local or self-hosted OpenAI-compatible server (Ollama, LM Studio, vLLM, llama.cpp) with zero external filters.' },
};

export function detectProviderId(model = '') {
  const m = String(model || '');
  if (m.startsWith('arliai/')) return 'arliai';
  if (m.startsWith('openai/')) return 'openai';
  if (m.startsWith('copilot/')) return 'copilot';
  if (m.startsWith('anthropic/')) return 'anthropic';
  if (m.startsWith('custom/') || m.startsWith('local/')) return 'custom';
  return 'openrouter';
}

export default function ProviderConnection({settings,state,act,SecretField,reload}) {
 const providerId = detectProviderId(settings.model);
 const meta = PROVIDER_META[providerId] || PROVIDER_META.openrouter;
 const arli = providerId === 'arliai';
 const [checking,setChecking]=useState(false),[result,setResult]=useState(''),[customUrl,setCustomUrl]=useState(settings.customBaseUrl||'http://localhost:11434/v1');
 const hasKey = Boolean(state.providerKeys?.[providerId]);

 const check=async()=>{
   setChecking(true);setResult('');
   try{
     const data=await act(arli?'checkArli':'checkProvider',{provider:providerId});
     if(data?.ok){
       setResult(`Connection verified: ${data.models.length} models accessible on ${meta.name}. Generation availability depends on your plan.`);
       await reload();
     }
   }finally{setChecking(false);}
 };

 const importCopilot=async()=>{
   setChecking(true);setResult('');
   try{
     const res=await act('importCopilotToken');
     if(res?.ok)setResult(`Imported GitHub token from ${res.source}.`);
   }finally{setChecking(false);}
 };

 return <>
  <label>Model Provider Service
   <select aria-label="Model service" value={providerId} onChange={e=>{
     const next = e.target.value;
     const info = PROVIDER_META[next] || PROVIDER_META.openrouter;
     setResult('');
     if(next==='arliai') act('settings',{model:info.defaultModel,reasoningEffort:'max',providerRouting:'auto',contextWindow:96000,concurrency:1});
     else act('settings',{model:info.defaultModel,reasoningEffort:info.effort});
   }}>
    <option value="openrouter">OpenRouter (Multi-Provider Router)</option>
    <option value="arliai">Arli.ai (Uncensored & Coding Models)</option>
    <option value="openai">OpenAI Direct (GPT-5 / o3 / Codex)</option>
    <option value="copilot">GitHub Copilot / GitHub Account</option>
    <option value="anthropic">Anthropic Direct (Claude 4.5)</option>
    <option value="custom">Custom / Local (Ollama, LM Studio, vLLM)</option>
   </select>
  </label>
  <div className="row" style={{justifyContent:'space-between',marginBottom:6}}>
   <span className={'status '+(hasKey?'complete':'paused')}>{providerId==='custom'?'Local / Optional Key':hasKey?'Key saved':'No '+meta.name+' key'}</span>
   <button type="button" className="secondary" disabled={checking||(!hasKey&&providerId!=='custom')} onClick={check}>{checking?'Checking…':`Verify ${meta.name} connection`}</button>
  </div>
  <p className="hint">{meta.hint}</p>
  {providerId==='custom'&&<label>OpenAI-Compatible Base URL<div className="row"><input value={customUrl} onChange={e=>setCustomUrl(e.target.value)} placeholder="http://localhost:11434/v1"/><button type="button" className="secondary" onClick={async()=>{await act('settings',{customBaseUrl:customUrl});await reload();}}>Save URL</button></div></label>}
  <SecretField key={providerId} name={meta.key} label={`${meta.name} API Key / Token${providerId==='custom'?' (optional)':''}`} act={act}/>
  {providerId==='copilot'&&<div className="row" style={{marginTop:8}}><button type="button" className="secondary" disabled={checking} onClick={importCopilot}><KeyRound size={14}/>Import token from GitHub CLI / Copilot</button><button type="button" onClick={()=>act('settings',{model:'copilot/claude-sonnet-4.5',reasoningEffort:'medium'})}>Use Copilot · Claude Sonnet 4.5</button><button type="button" onClick={()=>act('settings',{model:'copilot/gpt-5',reasoningEffort:'medium'})}>Use Copilot · GPT-5</button></div>}
  {arli&&<><p className="hint">Recommended for coding: DeepSeek-V4.1-Flash-1017 with max reasoning. Arli.ai Plus provides 128K total context and 1 concurrent request; NEXUS sets a 96K working ceiling to reserve headroom for output.</p><div className="row"><button type="button" onClick={()=>act('settings',{model:'arliai/DeepSeek-V4.1-Flash-1017',reasoningEffort:'max'})}><Sparkles size={13}/>Use DeepSeek · coding</button><button type="button" onClick={()=>act('settings',{model:'arliai/GLM-4.6-Derestricted-v5',reasoningEffort:'high'})}>Use GLM · Derestricted</button></div><p className="hint">Verification queries your account catalog without generating text. OpenRouter native web search and provider routing only apply to OpenRouter models.</p></>}
  {providerId==='openai'&&<div className="row" style={{marginTop:8}}><button type="button" onClick={()=>act('settings',{model:'openai/gpt-5',reasoningEffort:'medium'})}>Use GPT-5</button><button type="button" onClick={()=>act('settings',{model:'openai/gpt-4.1',reasoningEffort:'none'})}>Use GPT-4.1</button><button type="button" onClick={()=>act('settings',{model:'openai/o3',reasoningEffort:'high'})}>Use o3</button></div>}
  {providerId==='anthropic'&&<div className="row" style={{marginTop:8}}><button type="button" onClick={()=>act('settings',{model:'anthropic/claude-sonnet-4-5',reasoningEffort:'medium'})}>Use Claude Sonnet 4.5</button><button type="button" onClick={()=>act('settings',{model:'anthropic/claude-opus-4-5',reasoningEffort:'high'})}>Use Claude Opus 4.5</button></div>}
  {result&&<p role="status" className="hint" style={{color:'var(--accent)'}}><CheckCircle2 size={13} style={{verticalAlign:'middle',marginRight:4}}/>{result}</p>}
 </>;
}
