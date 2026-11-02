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
 return <aside className="chat-side-panel" aria-label={mode==='search'?'Búsqueda en el chat':'Resultados del chat'}><header><strong>{mode==='search'?<><Search size={16}/>Buscar en el chat</>:<><FileText size={16}/>Resultados</>}</strong><button aria-label="Cerrar panel del chat" onClick={close}><X size={17}/></button></header>
 {mode==='search'?<input ref={input} aria-label="Texto a buscar en el chat" placeholder="Buscar en todo el historial…" value={query} maxLength={500} onChange={e=>setQuery(e.target.value)}/>:<><p className="hint">Archivos modificados, resultados guardados, fuentes y notas. No incluye archivos creados por comandos que no hayan sido registrados.</p><button className="secondary" disabled={busy} onClick={()=>fetchPage()}><RefreshCw size={13}/>Actualizar resultados</button></>}
 <p className="hint" role="status">{busy?'Buscando…':error?'No se pudo cargar.':mode==='search'&&!query.trim()?'Busca una palabra o una frase.':`${data?.total??0} ${mode==='search'?'mensajes encontrados':'resultados registrados'}`}</p>{error&&<p role="alert">{error}</p>}
 <div className="panel-items">{data?.items.map(item=>mode==='search'?<button className="search-result" key={item.id} onClick={()=>jump(item.id)}><small>{item.role==='user'?'Tú':'NEXUS'}</small><span>{item.snippet}</span><em>Ir al mensaje →</em></button>:<section className="result-card" key={item.id}><small>{{file:'Archivo modificado',artifact:'Resultado guardado',source:'Fuente citada',progress:'Nota del agente'}[item.kind]}</small><strong>{item.name}</strong>{item.note&&<p>{item.note}</p>}{item.kind==='source'?<button onClick={()=>jump(item.messageId)}>Ver mensaje de origen →</button>:<button onClick={()=>inspect(item)}>Ver {item.kind==='progress'?'nota':'contenido'} →</button>}</section>)}</div>{data?.next!=null&&<button className="secondary" disabled={busy} onClick={()=>fetchPage(data.next)}>Cargar más resultados</button>}
 {preview&&<ResultPreview preview={preview} close={()=>{previewRequest.current++;setPreview(null);}}/>}</aside>;
}
function ResultPreview({preview,close}){
 const ref=useRef(null);useDialogFocus(ref,close);
 return <div className="modal-backdrop"><section ref={ref} className="modal result-preview" role="dialog" aria-modal="true" aria-label="Vista previa del resultado"><button className="modal-close" aria-label="Cerrar resultado" onClick={close}><X size={18}/></button><h2>{preview.name}</h2>{preview.loading?<p>Preparando vista previa…</p>:preview.error?<p role="alert">{preview.error}</p>:<><p className="hint">{preview.note}</p>{preview.content!==undefined&&<pre>{preview.content||'(Vacío)'}</pre>}</>}</section></div>;
}
