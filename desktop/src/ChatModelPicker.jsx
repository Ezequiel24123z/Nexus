import React,{useEffect,useRef,useState} from 'react';
import {ChevronDown,Star,X,ShieldAlert,Compass,Compass as ArchitectIcon,Zap} from 'lucide-react';
import {detectProviderId} from './ProviderConnection.jsx';

export function useDialogFocus(ref,close,returnRef){
 const closeRef=useRef(close);closeRef.current=close;
 useEffect(()=>{const prior=returnRef?.current||document.activeElement,node=ref.current;if(!node)return;(node.querySelector('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')||node.querySelector('button:not(:disabled)'))?.focus();const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeRef.current();}if(e.key==='Tab'){const nodes=[...node.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(item=>item.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(!first)return;if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};node.addEventListener('keydown',key);return()=>{node.removeEventListener('keydown',key);if(prior?.isConnected)prior.focus();};},[]);
}
const levels=[['auto','Automatic'],['none','Disabled'],['minimal','Minimal'],['low','Low'],['medium','Medium'],['high','High'],['xhigh','Very high'],['max','Maximum']];
const routes=[['auto','Automatic'],['price','Lowest price'],['throughput','Highest throughput'],['latency','Lowest latency']];
const modes=[
  ['agent','Agent · Full Coding & Execution'],
  ['architect','Architect · Plan & Design Only'],
  ['explore','Explore · Read-Only Fast Search'],
  ['unrestricted','Unrestricted · Full Local Environment'],
];

export default function ChatModelPicker({task,settings,models,act}){
 const [open,setOpen]=useState(false),opener=useRef(null);
 const model=task?.model||settings.model,thinking=task?.reasoningEffort??settings.reasoningEffort,mode=task?.agentMode||settings.agentMode||'agent';
 const locked=task&&(task.compacting||['running','approval','queued'].includes(task.status));
 const setMode=nextMode=>act(task?'updateChat':'settings',{...(task?{id:task.id}:{}),agentMode:nextMode});
 return <div className="composer-controls-bar">
  <button ref={opener} className="quick-model" type="button" aria-label="Choose model and thinking" onClick={()=>setOpen(true)}>
   <span>{models.find(item=>item.id===model)?.name||model||'Select model'}</span>
   <small>Thinking: {levels.find(([id])=>id===thinking)?.[1]||thinking}</small>
   <ChevronDown size={13}/>
  </button>
  <div className="mode-pills" role="group" aria-label="Agent operating mode">
   {[['agent','Agent',Zap],['architect','Architect',ArchitectIcon],['explore','Explore',Compass],['unrestricted','Unrestricted',ShieldAlert]].map(([id,label,Icon])=>(
    <button key={id} type="button" disabled={locked} aria-pressed={mode===id} className={'mode-pill '+(mode===id?'active ':'')+id} onClick={()=>setMode(id)} title={modes.find(([m])=>m===id)?.[1]}>
     <Icon size={12}/><span>{label}</span>
    </button>
   ))}
  </div>
  {open&&<ModelDialog key={task?.id||'new'} task={task} settings={settings} models={models} act={act} close={()=>setOpen(false)} opener={opener}/>}
 </div>;
}
function ModelDialog({task,settings,models,act,close,opener}){
 const ref=useRef(null);useDialogFocus(ref,close,opener);
 const [model,setModel]=useState(task?.model||settings.model),[thinking,setThinking]=useState(task?.reasoningEffort??settings.reasoningEffort),[route,setRoute]=useState(task?.providerRouting??settings.providerRouting),[mode,setMode]=useState(task?.agentMode||settings.agentMode||'agent'),[query,setQuery]=useState(''),[busy,setBusy]=useState(false);
 const [error,setError]=useState('');const chosen=models.find(item=>item.id===model),available=chosen?.reasoning?.supported_efforts;
 const favorites=settings.favoriteModels||[],locked=task&&(task.compacting||['running','approval','queued'].includes(task.status));
 const activeProvider=detectProviderId(task?.model||settings.model);
 const [providerFilter,setProviderFilter]=useState(activeProvider);
 const catalog=[...models,...favorites.filter(id=>!models.some(item=>item.id===id)).map(id=>({id,name:id,provider:detectProviderId(id)}))];
 const visible=catalog.filter(item=>providerFilter==='all'||detectProviderId(item.id)===providerFilter).filter(item=>!query||(item.id+' '+item.name).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>Number(favorites.includes(b.id))-Number(favorites.includes(a.id))).slice(0,35);
 const invalid=chosen?.tools===false?'This model does not declare tool support.':thinking==='none'&&chosen?.reasoning?.mandatory?'This model requires reasoning.':thinking!=='auto'&&Array.isArray(available)&&!available.includes(thinking)?'Select a supported thinking effort level.':'';
 const save=async e=>{e.preventDefault();if(locked||busy||invalid)return;setBusy(true);setError('');try{const result=await act(task?'updateChat':'settings',{...(task?{id:task.id}:{}),model:model.trim(),reasoningEffort:thinking,providerRouting:route,agentMode:mode});if(result)close();else setError('Could not apply changes. Check the application notice.');}finally{setBusy(false);}};
 return <div className="modal-backdrop"><section ref={ref} className="modal model-dialog" role="dialog" aria-modal="true" aria-label="Chat model"><button className="modal-close" aria-label="Close model picker" onClick={close}><X size={18}/></button><h2>Model, Thinking & Mode</h2><p className="hint">{task?'Applies only to this chat on the next turn.':'Default model for new chats. Global thinking and provider routing for chats without custom overrides.'} The context ceiling remains unchanged.</p>{locked&&<p className="model-warning" role="status">Pause the task and wait for the current call to finish before applying changes.</p>}
 <form onSubmit={save}>
  <label>Model ID<input aria-label="Quick model" value={model} onChange={e=>setModel(e.target.value)} required disabled={locked||busy} placeholder="e.g. deepseek/deepseek-v4.1-flash, openai/gpt-5, copilot/claude-sonnet-4.5"/></label>
  <div className="filter-pills" style={{marginBottom:10,flexWrap:'wrap'}} role="group" aria-label="Filter catalog by provider">
   {[['all','All'],['openrouter','OpenRouter'],['arliai','Arli.ai'],['openai','OpenAI'],['copilot','Copilot'],['anthropic','Anthropic'],['custom','Local']].map(([id,label])=><button key={id} type="button" aria-pressed={providerFilter===id} onClick={()=>setProviderFilter(id)}>{label}</button>)}
  </div>
  <div className="row"><input aria-label="Filter models" placeholder="Search catalog…" value={query} onChange={e=>setQuery(e.target.value)}/><button type="button" aria-label={favorites.includes(model)?'Remove favorite model':'Save favorite model'} disabled={!model.trim()||busy} onClick={()=>act('settings',{favoriteModels:favorites.includes(model)?favorites.filter(id=>id!==model):[...favorites,model.trim()]})}><Star size={17} fill={favorites.includes(model)?'currentColor':'none'}/></button></div>
  <div className="quick-model-list">{visible.map(item=><button key={item.id} type="button" disabled={locked||busy||item.tools===false} className={item.id===model?'selected':''} onClick={()=>setModel(item.id)}><span>{favorites.includes(item.id)&&'★ '}{item.name}</span><small>{item.id} · {item.context?.toLocaleString()||'—'} ctx{item.vision?' · Vision':''}{item.tools===false?' · No tools':''}</small></button>)}{!visible.length&&<p className="hint">No matching models. You can type any model identifier manually; compatibility is not pre-verified.</p>}</div>
  <div className="two">
   <label>Thinking<select aria-label="Chat thinking" value={thinking} disabled={locked||busy} onChange={e=>setThinking(e.target.value)}>{levels.map(([id,label])=><option key={id} value={id} disabled={id!=='auto'&&Array.isArray(available)&&!available.includes(id)}>{label}</option>)}</select></label>
   <label>Provider Routing<select aria-label="Chat provider" value={route} disabled={detectProviderId(model)!=='openrouter'||locked||busy} onChange={e=>setRoute(e.target.value)}>{routes.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
  </div>
  <label>Operating Mode<select aria-label="Chat operating mode" value={mode} disabled={locked||busy} onChange={e=>setMode(e.target.value)}>{modes.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
  {!Array.isArray(available)&&<p className="hint">Unpublished effort levels: acceptance depends on the model and provider.</p>}{chosen?.context<settings.contextWindow&&<p className="model-warning">The model context window is smaller than your operating context ceiling. Lower the ceiling before continuing a long chat.</p>}{(invalid||error)&&<p role="alert" className="model-warning">{invalid||error}</p>}<button className="primary" disabled={locked||busy||!!invalid||!model.trim()}>{busy?'Applying…':'Apply selection'}</button></form></section></div>;
}
