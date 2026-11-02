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
  return <FocusDialog label="Importar OpenAPI" close={leave} className="openapi-dialog">
    <header className="openapi-heading"><div><span className="eyebrow">AMPLÍA TU BIBLIOTECA</span><h2>Importar OpenAPI</h2></div><button aria-label="Cerrar importación" disabled={busy} onClick={leave}><X size={18}/></button></header>
    <div className="openapi-steps" aria-label="Progreso de importación"><span className={!plan?'current':''}>1 · Definición</span><span className={plan?'current':''}>2 · Revisar y elegir</span></div>
    <div className="openapi-content">
    {!plan?<>
      <p className="hint">Añade operaciones REST a partir de un archivo local o JSON pegado. La revisión no contacta con el servidor ni descarga referencias externas.</p>
      <label className="openapi-file"><FileJson size={22}/><span><strong>{fileName||'Elegir archivo JSON'}</strong><small>OpenAPI 3.0 / 3.1 · hasta 2 MB · 500 operaciones por documento</small></span><input aria-label="Archivo OpenAPI" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)run(async()=>{if(file.size>2*1024*1024)throw new Error('El archivo supera los 2 MB.');const text=await file.text();if(active.current){setSource(text);setFileName(file.name);}});e.target.value='';}}/></label>
      <label>O pega la definición<textarea aria-label="Definición OpenAPI" rows={7} value={source} spellCheck={false} disabled={busy} onChange={e=>{setSource(e.target.value);setFileName('');}} placeholder={'{"openapi":"3.1.0","info":{…},"paths":{…}}'}/></label>
      <div className="openapi-fields"><label>Prefijo de nombres<input aria-label="Prefijo OpenAPI" maxLength={32} value={prefix} disabled={busy} onChange={e=>setPrefix(e.target.value)}/></label><label>Referencia Bearer, si procede<input aria-label="Secreto OpenAPI" placeholder="CONNECTOR_MI_API" value={secretRef} disabled={busy} onChange={e=>setSecretRef(e.target.value)}/></label></div>
      <label>Servidor alternativo (opcional)<input aria-label="Servidor OpenAPI" placeholder="https://api.ejemplo.com/v1" value={baseUrl} disabled={busy} onChange={e=>setBaseUrl(e.target.value)}/></label>
      <p className="hint">Vacío: usa el primer servidor efectivo de cada operación. Revisa el destino antes de importar. Los valores secretos se guardan en Configuración, nunca aquí.</p>
      <details><summary>Compatibilidad de esta versión</summary><p className="hint">Acceso público o Bearer; GET, POST, PUT, PATCH y DELETE; parámetros simples de ruta/consulta y cuerpos JSON. Esquemas con tipos, propiedades, requeridos, listas y enumeraciones. OAuth, claves en cabeceras, multipart, YAML y esquemas complejos aparecerán como no compatibles. Los formatos (fecha, email…) son informativos, no se validan.</p></details>
    </>:<>
      <div className="openapi-summary"><CheckCircle2 size={20}/><div><strong>{plan.title}</strong><p>{plan.compatible} compatibles de {plan.entries.length} · {selected.size} seleccionadas</p></div></div>
      <p className="hint">Sólo se guardarán las operaciones seleccionadas. No se ejecutan llamadas ni se sobrescriben conectores existentes.</p>
      <label className="library-search"><Search size={16}/><input ref={searchRef} aria-label="Buscar operaciones OpenAPI" placeholder="Filtrar por ruta, nombre, método…" value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}}/></label>
      <div className="openapi-selection"><button disabled={busy||!page.some(item=>!item.issue)} onClick={()=>setSelected(current=>new Set([...current,...page.filter(item=>!item.issue).map(item=>item.id)]))}>Seleccionar compatibles de esta página</button><button disabled={busy||!selected.size} onClick={()=>setSelected(new Set())}>Limpiar selección</button></div>
      <div className="openapi-operations">{page.map(item=><label className={'openapi-operation'+(item.issue?' unavailable':'')} key={item.id}><input type="checkbox" aria-label={'Importar '+item.id} checked={selected.has(item.id)} disabled={busy||!!item.issue} onChange={()=>toggle(item.id)}/><div><div className="openapi-route"><span>{item.method}</span><strong>{item.path}</strong></div><p>{item.description||item.name}</p>{item.issue?<small className="openapi-issue"><AlertCircle size={13}/>{item.issue}</small>:<><small>{item.endpoint} · {item.authentication}</small><small>{item.name}</small></>}</div></label>)}</div>
      {!visible.length&&<p className="hint">No hay coincidencias.</p>}
      <div className="library-pagination"><small>{visible.length} resultados · selección conservada entre páginas</small><div className="row"><button disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>Anterior</button><button disabled={busy||offset+20>=visible.length} onClick={()=>setOffset(offset+20)}>Siguiente</button></div></div>
    </>}
    </div>
    {error&&<p role="alert" className="openapi-error">{error}</p>}
    <footer className="openapi-footer"><button disabled={busy} onClick={()=>{if(plan){setPlan(null);setSelected(new Set());setQuery('');setOffset(0);setError('');}else leave();}}>{plan?'Volver a definición':'Cancelar'}</button><button className="primary" disabled={busy||(!plan&&!source.trim())||(!!plan&&!selected.size)} onClick={()=>run(async()=>{
      if(!plan){const preview=await window.nexus.invoke('previewOpenApi',args);if(active.current){setPlan(preview);setSelected(new Set());}}
      else {const result=await window.nexus.invoke('importOpenApi',{...args,selected:[...selected]});if(active.current)done(result);}
    })}>{busy?'Procesando…':plan?`Importar ${selected.size} operaciones`:'Revisar definición'}</button></footer>
  </FocusDialog>;
}
