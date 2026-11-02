import React,{useState,useRef} from 'react';
import {FileText,Image,Paperclip,X} from 'lucide-react';
export const fileSize=bytes=>bytes<1024?bytes+' B':bytes<1048576?(bytes/1024).toFixed(1)+' KB':(bytes/1048576).toFixed(1)+' MB';
const usage=item=>item.kind==='image'?'Vision':item.kind==='text'?'Chunked read':'Local file · requires extraction';

export default function Attachments({items=[],remove,disabled=false}){
 const [preview,setPreview]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const request=useRef(0);
 const close=()=>{request.current++;setPreview(null);};
 const inspect=async item=>{const token=++request.current;setPreview({attachment:item});setError('');setLoading(true);try{const result=await window.nexus.invoke('previewAttachment',{id:item.id});if(request.current===token)setPreview(result);}catch{if(request.current===token)setError('Could not read this attachment.');}finally{if(request.current===token)setLoading(false);}};
 if(!items.length)return null;
 return <><div className="attachment-list" aria-label="Attached files">{items.map(item=><div className="attachment-chip" key={item.id}><button type="button" onClick={()=>inspect(item)} title={'Preview of '+item.name}>{item.kind==='image'?<Image size={17}/>:item.kind==='text'?<FileText size={17}/>:<Paperclip size={17}/>}<span><strong>{item.name}</strong><small>{fileSize(item.bytes)} · {usage(item)}</small></span></button>{remove&&<button type="button" disabled={disabled} aria-label={'Remove attachment '+item.name} onClick={()=>remove(item.id)}><X size={14}/></button>}</div>)}</div>{preview&&<div className="modal-backdrop"><section className="modal attachment-preview" role="dialog" aria-modal="true" aria-label="Attachment preview"><button type="button" className="modal-close" aria-label="Close preview" onClick={close}><X size={19}/></button><h2>{preview.attachment.name}</h2><p className="hint">{fileSize(preview.attachment.bytes)} · {usage(preview.attachment)}</p>{loading?<p>Preparing preview…</p>:error?<p role="alert">{error}</p>:preview.image?<img src={preview.image} alt={preview.attachment.name}/>:preview.content!==undefined?<><pre>{preview.content||'(Empty file)'}</pre>{preview.next!==null&&<p className="hint">Partial preview. The agent can read the remaining content in chunks.</p>}</>:<p>{preview.note}</p>}</section></div>}</>;
}
