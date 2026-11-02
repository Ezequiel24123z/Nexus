import React,{useEffect,useRef,useState} from 'react';
import {Activity,RefreshCw,X,ChevronRight,ArrowLeft} from 'lucide-react';
import {FocusDialog} from './WorkspaceExperience.jsx';
import './inspector.css';
const api=(method,args)=>window.nexus.invoke(method,args);
const n=value=>value==null?'—':new Intl.NumberFormat('es-ES',{maximumFractionDigits:0}).format(value);
const money=value=>value==null?'No reportado':new Intl.NumberFormat('es-ES',{style:'currency',currency:'USD',maximumFractionDigits:6}).format(value);
const percent=value=>value==null?'—':new Intl.NumberFormat('es-ES',{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1}).format(value);
export default function ContextInspector({taskId,close}) {
  const [data,setData]=useState(null),[costs,setCosts]=useState(null),[tab,setTab]=useState('context'),[preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const revision=useRef(0),tabRef=useRef(null),detailRef=useRef(null),previewTrigger=useRef(null);
  const request=async action=>{const token=++revision.current;setBusy(true);setError('');try{const result=await action();if(token!==revision.current)return null;return result;}catch(error){if(token===revision.current)setError(error.message.replace(/^Error invoking remote method .*?: /,''));return null;}finally{if(token===revision.current)setBusy(false);}};
  const refresh=async()=>{const result=await request(()=>Promise.all([api('inspectContext',{id:taskId}),api('inspectCosts',{id:taskId})]));if(result){setData(result[0]);setCosts(result[1]);setPreview(null);if(!data)requestAnimationFrame(()=>tabRef.current?.focus());}};
  useEffect(()=>{void refresh();return()=>{revision.current++;};},[taskId]);
  useEffect(()=>{if(preview)detailRef.current?.focus();},[preview?.label]);
  const page=async offset=>{const result=await request(()=>api('inspectCosts',{id:taskId,offset,version:costs.version}));if(result)setCosts(result);};
  const inspect=async(method,args,offset=0)=>{if(!preview)previewTrigger.current=document.activeElement;const result=await request(()=>api(method,{id:taskId,...args,offset}));if(result)setPreview({...result,method,args});};
  const back=()=>{setPreview(null);setError('');requestAnimationFrame(()=>previewTrigger.current?.isConnected?previewTrigger.current.focus():tabRef.current?.focus());};
  return <FocusDialog label="Contexto y gasto" close={close} className="inspector-dialog">
    <header className="inspector-header"><div><span className="eyebrow">OBSERVABILIDAD DEL CHAT</span><h2><Activity size={19}/>Contexto y gasto</h2></div><div className="row"><button aria-label="Actualizar inspector" title="Actualizar fotografía" disabled={busy} onClick={refresh}><RefreshCw size={16}/></button><button aria-label="Cerrar inspector" onClick={close}><X size={18}/></button></div></header>
    {!preview&&<nav className="inspector-tabs" aria-label="Secciones del inspector">{[['context','Contexto'],['cost','Gasto y caché'],['compression','Compresiones']].map(([id,label])=><button ref={id==='context'?tabRef:null} key={id} aria-pressed={tab===id} onClick={()=>{setTab(id);setError('');}}>{label}</button>)}</nav>}
    <div className="inspector-body" aria-busy={busy}>
      {error&&<p className="inspector-error" role="alert">{error}</p>}
      {!data?<p role="status">{busy?'Preparando fotografía local…':'No se pudo cargar. Puedes actualizar para reintentar.'}</p>:preview?<>
        <button className="inspector-back" onClick={back}><ArrowLeft size={14}/>Volver al inspector</button><h3 ref={detailRef} tabIndex={-1}>{preview.label}</h3><p className="hint">Vista local de texto. Binarios y detalles de razonamiento oculto no se muestran.</p><pre className="inspector-preview">{preview.content||'(Vacío)'}</pre><div className="library-pagination"><small>{n(preview.offset)}–{n(preview.offset+preview.content.length)} de {n(preview.total)} caracteres</small><div className="row"><button disabled={busy||preview.offset===0} onClick={()=>inspect(preview.method,preview.args,Math.max(0,preview.offset-6000))}>Anterior</button><button disabled={busy||preview.next==null} onClick={()=>inspect(preview.method,preview.args,preview.next)}>Siguiente</button></div></div>
      </>:<>
        {tab==='context'&&<>
          <div className="inspector-stats"><div><small>Contexto estimado</small><strong>≈ {n(data.total)}</strong></div><div><small>Umbral automático</small><strong>{n(data.threshold)}</strong></div><div><small>Techo operativo</small><strong>{n(data.ceiling)}</strong></div></div>
          <progress className="context-meter" aria-label="Ocupación estimada del contexto" value={Math.min(data.total,data.ceiling)} max={data.ceiling}/>
          <p className="hint">{data.needsCompression?'Se prevé una compresión antes de la próxima generación.':'Actualmente dentro del umbral de compresión.'} Última entrada reportada por el proveedor: {n(data.lastReportedInput)} tokens.</p>
          <div className="inspector-sections">{data.sections.map(section=><button key={section.id} className="inspector-section" disabled={busy} onClick={()=>inspect('contextSection',{section:section.id,fingerprint:data.fingerprint})}><div><strong>{section.label}</strong><p>{section.reason}</p><small>{n(section.count)} {section.count===1?'elemento':'elementos'} · ≈ {n(section.tokens)} tokens</small></div><ChevronRight size={16}/></button>)}</div>
          <p className="hint">{data.note}</p><p className="hint">Afinidad de sesión: {data.affinity?'activada':'desactivada'}. Se configura en Ajustes → Compresión de contexto. Su ahorro todavía no está medido en esta revisión.</p>
        </>}
        {tab==='cost'&&costs&&<>
          <div className="inspector-stats"><div><small>Coste reportado</small><strong>{money(costs.total.cost)}</strong><small>{costs.total.unknownCosts?`${costs.total.unknownCosts} ${costs.total.unknownCosts===1?'llamada':'llamadas'} sin coste informado`:costs.total.calls?'Todas las llamadas tienen coste informado':'Sin llamadas registradas'}</small></div><div><small>Cache hit por tokens</small><strong>{percent(costs.total.cacheHitRate)}</strong><small>Cobertura: {percent(costs.total.cacheCoverage)}</small></div><div><small>Entrada no cacheada*</small><strong>{n(costs.total.uncached)}</strong><small>*Sólo llamadas comparables</small></div></div>
          <div className="cost-groups">{costs.groups.filter(group=>group.calls).map(group=><div key={group.kind}><span>{group.label}<small>{n(group.calls)} {group.calls===1?'llamada':'llamadas'}</small></span><strong>{money(group.cost)}{group.unknownCosts>0&&<small>Parcial · {group.unknownCosts} sin informar</small>}</strong></div>)}</div>
          <p className="hint">Reintentos: {n(costs.retries.calls)} · {money(costs.retries.cost)}{costs.retries.unknownCosts?' (parcial)':''}. Ya incluidos arriba, no se suman otra vez. Fallidas: {costs.total.failed}; interrumpidas: {costs.total.interrupted}; pendientes: {costs.total.pending}.</p>
          <p className="hint">Son costes recibidos del proveedor en USD, no una estimación de factura. Una llamada fallida o cancelada puede tener coste desconocido. La cobertura indica cuántas llamadas informan tanto entrada como caché válida.</p>
          <h3>Registro de llamadas</h3><div className="cost-calls">{costs.items.map((call,index)=><details key={call.id+'-'+index}><summary><span>{call.kind==='compression'?'Compresión':'Generación'}{call.retried?' · reintento':''}<small>{call.model} · {call.status}</small></span><strong>{money(call.cost)}</strong></summary><dl><dt>Entrada / salida</dt><dd>{n(call.input)} / {n(call.output)}</dd><dt>Caché leída</dt><dd>{n(call.cached)}</dd><dt>Proveedor</dt><dd>{call.provider}</dd><dt>Afinidad enviada</dt><dd>{call.sessionAffinity?'Sí':'No'}</dd><dt>Duración</dt><dd>{call.latencyMs==null?'—':(call.latencyMs/1000).toFixed(2)+' s'}</dd></dl></details>)}</div>
          {!costs.total.calls&&<p className="hint">Este chat aún no registra llamadas.</p>}<div className="library-pagination"><small>{n(costs.total.calls)} llamadas · más recientes primero</small><div className="row"><button disabled={busy||!costs.offset} onClick={()=>page(Math.max(0,costs.offset-20))}>Anterior</button><button disabled={busy||costs.next==null} onClick={()=>page(costs.next)}>Siguiente</button></div></div>
        </>}
        {tab==='compression'&&<>
          <p className="hint">Últimos 15 checkpoints registrados. Reducir tokens no demuestra ahorro monetario ni que se conserve cada detalle: puedes contrastar el resumen con los originales.</p>
          {data.compression&&<div className="inspector-stats"><div><small>Última: antes</small><strong>≈ {n(data.compression.before)}</strong></div><div><small>Después</small><strong>≈ {n(data.compression.after)}</strong></div><div><small>Coste reportado</small><strong>{money(data.compression.cost)}</strong></div></div>}
          <div className="checkpoint-list">{data.checkpoints.map(item=><section key={item.checkpoint}><h3>Checkpoint {item.checkpoint}</h3><p className="hint">≈ {n(item.before)} → {n(item.after)} tokens · {money(item.cost)}{item.unknownCosts?' (parcial)':''}{item.truncated?' · Resumen incompleto':''}</p><div className="row"><button disabled={busy} onClick={()=>inspect('checkpointPreview',{checkpoint:item.checkpoint,section:'summary'})}>Ver resumen</button><button disabled={busy} onClick={()=>inspect('checkpointPreview',{checkpoint:item.checkpoint,section:'messages'})}>Ver originales</button></div></section>)}</div>
          {!data.checkpoints.length&&<p className="hint">No hay checkpoints registrados para mostrar.</p>}
        </>}
      </>}
    </div>
    <footer className="inspector-footer"><small>{busy?'Actualizando…':data?`Fotografía de ${new Date(data.at).toLocaleTimeString('es-ES')}${data.live?' · la tarea sigue trabajando':''}`:'Lectura local'}</small><span>No consume API</span></footer>
  </FocusDialog>;
}
