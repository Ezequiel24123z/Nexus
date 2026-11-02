import React,{useEffect,useRef,useState} from 'react';
import {X,Search,FileText,RefreshCw} from 'lucide-react';
import {useDialogFocus} from './ChatModelPicker.jsx';
const api=(method,args)=>window.nexus.invoke(method,args);
export default function ChatPanel({task,mode,close,jump}){
 const [query,setQuery]=useState(''),[data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState(null);
 const request=useRef(0),input=useRef(null),previewRequest=useRef(0);
 useEffect(()=>{if(mode==='search')input.current?.focus();},[mode]);
 useEffect(()=>{return()=>{request.current++;previewRequest.current++;};},[]);
 const fetchPage=async(offset=0)=>{const token=++request.current;setBusy(true);setError('');try{const result=await api(mode==='search'?'searchChat':'taskResults',{id:task.id,query,offset});if(request.current===token)setData(previous=>offset&&previous?{...result,items:[...previous.items,...result.items]}:result);}catch(e){if(request.current===token)setError(e.message);}finally{if(request.current===token)setBusy(false);}};
 useEffect(()=>{request.current++;setData(null);setPreview(null);previewRequest.current++;const timer=setTimeout(()=>void fetchPage(),mode==='search'?200:0);return()=>{clearTimeout(timer);request.current++;};},[query,mode,task.id]);
 const inspect=async item=>{const token=++previewRequest.current;setPreview({name:item.name,loading:true});try{const value=await api('previewResult',{id:task.id,resultId:item.id});if(token===previewRequest.current)setPreview(value);}catch(e){if(token===previewRequest.current)setPreview({name:item.name,error:e.message});}};
 return <aside className="chat-side-panel" aria-label={mode==='search'?'Chat search':'Chat results'}><header><strong>{mode==='search'?<><Search size={16}/>Search in chat</>:<><FileText size={16}/>Results</>}</strong><button aria-label="Close chat panel" onClick={close}><X size={17}/></button></header>
 {mode==='search'?<input ref={input} aria-label="Search text in chat" placeholder="Search full history…" value={query} maxLength={500} onChange={e=>setQuery(e.target.value)}/>:<><p className="hint">Modified files, saved outputs, cited sources, and progress notes. Does not include files created by shell commands that were not recorded.</p><button className="secondary" disabled={busy} onClick={()=>fetchPage()}><RefreshCw size={13}/>Refresh results</button></>}
 <p className="hint" role="status">{busy?'Searching…':error?'Could not load.':mode==='search'&&!query.trim()?'Search for a word or phrase.':`${data?.total??0} ${mode==='search'?'messages found':'recorded results'}`}</p>{error&&<p role="alert">{error}</p>}
 <div className="panel-items">{data?.items.map(item=>mode==='search'?<button className="search-result" key={item.id} onClick={()=>jump(item.id)}><small>{item.role==='user'?'You':'NEXUS'}</small><span>{item.snippet}</span><em>Jump to message →</em></button>:<section className="result-card" key={item.id}><small>{{file:'Modified file',artifact:'Saved output',source:'Cited source',progress:'Agent note'}[item.kind]}</small><strong>{item.name}</strong>{item.note&&<p>{item.note}</p>}{item.kind==='source'?<button onClick={()=>jump(item.messageId)}>View source message →</button>:<button onClick={()=>inspect(item)}>View {item.kind==='progress'?'note':'content'} →</button>}</section>)}</div>{data?.next!=null&&<button className="secondary" disabled={busy} onClick={()=>fetchPage(data.next)}>Load more results</button>}
 {preview&&<ResultPreview preview={preview} close={()=>{previewRequest.current++;setPreview(null);}}/>}</aside>;
}
function ResultPreview({preview,close}){
 const ref=useRef(null);useDialogFocus(ref,close);
 return <div className="modal-backdrop"><section ref={ref} className="modal result-preview" role="dialog" aria-modal="true" aria-label="Result preview"><button className="modal-close" aria-label="Close result" onClick={close}><X size={18}/></button><h2>{preview.name}</h2>{preview.loading?<p>Preparing preview…</p>:preview.error?<p role="alert">{preview.error}</p>:<><p className="hint">{preview.note}</p>{preview.content!==undefined&&<pre>{preview.content||'(Empty)'}</pre>}</>}</section></div>;
}
