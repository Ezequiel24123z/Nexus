import React,{useRef,useState} from 'react';
import {FileJson,Search,X,CheckCircle2,AlertCircle} from 'lucide-react';
import {FocusDialog} from './WorkspaceExperience.jsx';
import './openapi.css';

export default function OpenApiImport({close,done}) {
  const [source,setSource]=useState(''),[prefix,setPrefix]=useState('API'),[baseUrl,setBaseUrl]=useState(''),[secretRef,setSecretRef]=useState('');
  const [plan,setPlan]=useState(null),[selected,setSelected]=useState(new Set()),[query,setQuery]=useState(''),[offset,setOffset]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[fileName,setFileName]=useState('');
  const active=useRef(true),searchRef=useRef(null);
  React.useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  React.useEffect(()=>{if(plan)searchRef.current?.focus();},[plan]);
  const leave=()=>{if(!busy)close();};
  const run=async action=>{setBusy(true);setError('');try{await action();}catch(error){if(active.current)setError(error.message);}finally{if(active.current)setBusy(false);}};
  const args={source,prefix,baseUrl,secretRef};
  const visible=plan?.entries.filter(item=>(item.name+' '+item.path+' '+item.method+' '+item.description+' '+(item.issue||'')).toLocaleLowerCase().includes(query.toLocaleLowerCase()))||[];
  const page=visible.slice(offset,offset+20);
  const toggle=id=>setSelected(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next;});
  return <FocusDialog label="Import OpenAPI" close={leave} className="openapi-dialog">
    <header className="openapi-heading"><div><span className="eyebrow">EXPAND YOUR LIBRARY</span><h2>Import OpenAPI</h2></div><button aria-label="Close import" disabled={busy} onClick={leave}><X size={18}/></button></header>
    <div className="openapi-steps" aria-label="Import progress"><span className={!plan?'current':''}>1 · Specification</span><span className={plan?'current':''}>2 · Review & Select</span></div>
    <div className="openapi-content">
    {!plan?<>
      <p className="hint">Add REST operations from a local JSON file or pasted specification. Review runs locally without contacting any server or resolving external references.</p>
      <label className="openapi-file"><FileJson size={22}/><span><strong>{fileName||'Choose JSON file'}</strong><small>OpenAPI 3.0 / 3.1 · up to 2 MB · 500 operations per document</small></span><input aria-label="OpenAPI file" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)run(async()=>{if(file.size>2*1024*1024)throw new Error('File exceeds 2 MB.');const text=await file.text();if(active.current){setSource(text);setFileName(file.name);}});e.target.value='';}}/></label>
      <label>Or paste the specification<textarea aria-label="OpenAPI specification" rows={7} value={source} spellCheck={false} disabled={busy} onChange={e=>{setSource(e.target.value);setFileName('');}} placeholder={'{"openapi":"3.1.0","info":{…},"paths":{…}}'}/></label>
      <div className="openapi-fields"><label>Name prefix<input aria-label="OpenAPI prefix" maxLength={32} value={prefix} disabled={busy} onChange={e=>setPrefix(e.target.value)}/></label><label>Bearer secret reference, if required<input aria-label="OpenAPI secret" placeholder="CONNECTOR_MY_API" value={secretRef} disabled={busy} onChange={e=>setSecretRef(e.target.value)}/></label></div>
      <label>Override server URL (optional)<input aria-label="OpenAPI server" placeholder="https://api.example.com/v1" value={baseUrl} disabled={busy} onChange={e=>setBaseUrl(e.target.value)}/></label>
      <p className="hint">Leave blank to use each operation's first effective server. Review target endpoints before importing. Secret values are saved in Settings, never here.</p>
      <details><summary>Compatibility notes</summary><p className="hint">Public or HTTP Bearer auth; GET, POST, PUT, PATCH, and DELETE; simple path/query parameters and JSON request bodies. Schemas with types, properties, required fields, arrays, and enums. OAuth, header API keys, multipart, YAML, and complex schemas appear as unsupported.</p></details>
    </>:<>
      <div className="openapi-summary"><CheckCircle2 size={20}/><div><strong>{plan.title}</strong><p>{plan.compatible} compatible of {plan.entries.length} · {selected.size} selected</p></div></div>
      <p className="hint">Only selected operations will be saved. No network calls are executed and existing connectors are never overwritten.</p>
      <label className="library-search"><Search size={16}/><input ref={searchRef} aria-label="Search OpenAPI operations" placeholder="Filter by route, name, method…" value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}}/></label>
      <div className="openapi-selection"><button disabled={busy||!page.some(item=>!item.issue)} onClick={()=>setSelected(current=>new Set([...current,...page.filter(item=>!item.issue).map(item=>item.id)]))}>Select compatible on this page</button><button disabled={busy||!selected.size} onClick={()=>setSelected(new Set())}>Clear selection</button></div>
      <div className="openapi-operations">{page.map(item=><label className={'openapi-operation'+(item.issue?' unavailable':'')} key={item.id}><input type="checkbox" aria-label={'Import '+item.id} checked={selected.has(item.id)} disabled={busy||!!item.issue} onChange={()=>toggle(item.id)}/><div><div className="openapi-route"><span>{item.method}</span><strong>{item.path}</strong></div><p>{item.description||item.name}</p>{item.issue?<small className="openapi-issue"><AlertCircle size={13}/>{item.issue}</small>:<><small>{item.endpoint} · {item.authentication}</small><small>{item.name}</small></>}</div></label>)}</div>
      {!visible.length&&<p className="hint">No matching operations.</p>}
      <div className="library-pagination"><small>{visible.length} results · selection preserved across pages</small><div className="row"><button disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>Previous</button><button disabled={busy||offset+20>=visible.length} onClick={()=>setOffset(offset+20)}>Next</button></div></div>
    </>}
    </div>
    {error&&<p role="alert" className="openapi-error">{error}</p>}
    <footer className="openapi-footer"><button disabled={busy} onClick={()=>{if(plan){setPlan(null);setSelected(new Set());setQuery('');setOffset(0);setError('');}else leave();}}>{plan?'Back to specification':'Cancel'}</button><button className="primary" disabled={busy||(!plan&&!source.trim())||(!!plan&&!selected.size)} onClick={()=>run(async()=>{
      if(!plan){const preview=await window.nexus.invoke('previewOpenApi',args);if(active.current){setPlan(preview);setSelected(new Set());}}
      else {const result=await window.nexus.invoke('importOpenApi',{...args,selected:[...selected]});if(active.current)done(result);}
    })}>{busy?'Processing…':plan?`Import ${selected.size} operations`:'Review specification'}</button></footer>
  </FocusDialog>;
}
