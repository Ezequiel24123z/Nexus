import React,{useEffect,useRef,useState} from 'react';
import {Activity,RefreshCw,X,ChevronRight,ArrowLeft} from 'lucide-react';
import {FocusDialog} from './WorkspaceExperience.jsx';
import './inspector.css';
const api=(method,args)=>window.nexus.invoke(method,args);
const n=value=>value==null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(value);
const money=value=>value==null?'Not reported':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:6}).format(value);
const percent=value=>value==null?'—':new Intl.NumberFormat('en-US',{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1}).format(value);
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
  return <FocusDialog label="Context & Spend" close={close} className="inspector-dialog">
    <header className="inspector-header"><div><span className="eyebrow">CHAT OBSERVABILITY</span><h2><Activity size={19}/>Context & Spend</h2></div><div className="row"><button aria-label="Refresh inspector" title="Refresh snapshot" disabled={busy} onClick={refresh}><RefreshCw size={16}/></button><button aria-label="Close inspector" onClick={close}><X size={18}/></button></div></header>
    {!preview&&<nav className="inspector-tabs" aria-label="Inspector sections">{[['context','Context'],['cost','Spend & Cache'],['compression','Compactions']].map(([id,label])=><button ref={id==='context'?tabRef:null} key={id} aria-pressed={tab===id} onClick={()=>{setTab(id);setError('');}}>{label}</button>)}</nav>}
    <div className="inspector-body" aria-busy={busy}>
      {error&&<p className="inspector-error" role="alert">{error}</p>}
      {!data?<p role="status">{busy?'Preparing local snapshot…':'Could not load snapshot. Click refresh to retry.'}</p>:preview?<>
        <button className="inspector-back" onClick={back}><ArrowLeft size={14}/>Back to inspector</button><h3 ref={detailRef} tabIndex={-1}>{preview.label}</h3><p className="hint">Local text preview. Binary payloads and hidden reasoning details are omitted.</p><pre className="inspector-preview">{preview.content||'(Empty)'}</pre><div className="library-pagination"><small>{n(preview.offset)}–{n(preview.offset+preview.content.length)} of {n(preview.total)} characters</small><div className="row"><button disabled={busy||preview.offset===0} onClick={()=>inspect(preview.method,preview.args,Math.max(0,preview.offset-6000))}>Previous</button><button disabled={busy||preview.next==null} onClick={()=>inspect(preview.method,preview.args,preview.next)}>Next</button></div></div>
      </>:<>
        {tab==='context'&&<>
          <div className="inspector-stats"><div><small>Estimated Context</small><strong>≈ {n(data.total)}</strong></div><div><small>Auto Threshold</small><strong>{n(data.threshold)}</strong></div><div><small>Operating Ceiling</small><strong>{n(data.ceiling)}</strong></div></div>
          <progress className="context-meter" aria-label="Estimated context usage" value={Math.min(data.total,data.ceiling)} max={data.ceiling}/>
          <p className="hint">{data.needsCompression?'Compaction will run before the next generation call.':'Currently within the automatic compaction threshold.'} Last reported input from provider: {n(data.lastReportedInput)} tokens.</p>
          <div className="inspector-sections">{data.sections.map(section=><button key={section.id} className="inspector-section" disabled={busy} onClick={()=>inspect('contextSection',{section:section.id,fingerprint:data.fingerprint})}><div><strong>{section.label}</strong><p>{section.reason}</p><small>{n(section.count)} {section.count===1?'item':'items'} · ≈ {n(section.tokens)} tokens</small></div><ChevronRight size={16}/></button>)}</div>
          <p className="hint">{data.note}</p><p className="hint">Session affinity: {data.affinity?'enabled':'disabled'}. Configured under Settings → Context Compaction.</p>
        </>}
        {tab==='cost'&&costs&&<>
          <div className="inspector-stats"><div><small>Reported Cost</small><strong>{money(costs.total.cost)}</strong><small>{costs.total.unknownCosts?`${costs.total.unknownCosts} ${costs.total.unknownCosts===1?'call':'calls'} without reported cost`:costs.total.calls?'All calls have reported cost':'No recorded calls'}</small></div><div><small>Token Cache Hit</small><strong>{percent(costs.total.cacheHitRate)}</strong><small>Coverage: {percent(costs.total.cacheCoverage)}</small></div><div><small>Uncached Input*</small><strong>{n(costs.total.uncached)}</strong><small>*Comparable calls only</small></div></div>
          <div className="cost-groups">{costs.groups.filter(group=>group.calls).map(group=><div key={group.kind}><span>{group.label}<small>{n(group.calls)} {group.calls===1?'call':'calls'}</small></span><strong>{money(group.cost)}{group.unknownCosts>0&&<small>Partial · {group.unknownCosts} unreported</small>}</strong></div>)}</div>
          <p className="hint">Retries: {n(costs.retries.calls)} · {money(costs.retries.cost)}{costs.retries.unknownCosts?' (partial)':''}. Already included above, not double-counted. Failed: {costs.total.failed}; interrupted: {costs.total.interrupted}; pending: {costs.total.pending}.</p>
          <p className="hint">Costs are provider-reported in USD, not an invoice estimate. Failed or cancelled calls may have unknown cost. Coverage shows how many calls reported both valid input and cached token counts.</p>
          <h3>Call Log</h3><div className="cost-calls">{costs.items.map((call,index)=><details key={call.id+'-'+index}><summary><span>{call.kind==='compression'?'Compaction':'Generation'}{call.retried?' · retry':''}<small>{call.model} · {call.status}</small></span><strong>{money(call.cost)}</strong></summary><dl><dt>Input / Output</dt><dd>{n(call.input)} / {n(call.output)}</dd><dt>Cached Read</dt><dd>{n(call.cached)}</dd><dt>Provider</dt><dd>{call.provider}</dd><dt>Affinity Sent</dt><dd>{call.sessionAffinity?'Yes':'No'}</dd><dt>Duration</dt><dd>{call.latencyMs==null?'—':(call.latencyMs/1000).toFixed(2)+' s'}</dd></dl></details>)}</div>
          {!costs.total.calls&&<p className="hint">This chat has no recorded calls yet.</p>}<div className="library-pagination"><small>{n(costs.total.calls)} calls · newest first</small><div className="row"><button disabled={busy||!costs.offset} onClick={()=>page(Math.max(0,costs.offset-20))}>Previous</button><button disabled={busy||costs.next==null} onClick={()=>page(costs.next)}>Next</button></div></div>
        </>}
        {tab==='compression'&&<>
          <p className="hint">Last 15 recorded checkpoints. Reducing tokens does not guarantee monetary savings or that every nuance is retained: you can compare the summary against the originals anytime.</p>
          {data.compression&&<div className="inspector-stats"><div><small>Latest: Before</small><strong>≈ {n(data.compression.before)}</strong></div><div><small>After</small><strong>≈ {n(data.compression.after)}</strong></div><div><small>Reported Cost</small><strong>{money(data.compression.cost)}</strong></div></div>}
          <div className="checkpoint-list">{data.checkpoints.map(item=><section key={item.checkpoint}><h3>Checkpoint {item.checkpoint}</h3><p className="hint">≈ {n(item.before)} → {n(item.after)} tokens · {money(item.cost)}{item.unknownCosts?' (partial)':''}{item.truncated?' · Incomplete summary':''}</p><div className="row"><button disabled={busy} onClick={()=>inspect('checkpointPreview',{checkpoint:item.checkpoint,section:'summary'})}>View summary</button><button disabled={busy} onClick={()=>inspect('checkpointPreview',{checkpoint:item.checkpoint,section:'messages'})}>View originals</button></div></section>)}</div>
          {!data.checkpoints.length&&<p className="hint">No checkpoints recorded yet.</p>}
        </>}
      </>}
    </div>
    <footer className="inspector-footer"><small>{busy?'Updating…':data?`Snapshot at ${new Date(data.at).toLocaleTimeString('en-US')}${data.live?' · task is actively running':''}`:'Local read'}</small><span>Zero API usage</span></footer>
  </FocusDialog>;
}
