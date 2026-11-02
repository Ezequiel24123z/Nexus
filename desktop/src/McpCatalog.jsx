import React,{useEffect,useState} from 'react';
export default function McpCatalog({server}){
 const [query,setQuery]=useState(''),[offset,setOffset]=useState(0),[page,setPage]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let current=true;const timer=setTimeout(()=>{window.nexus.invoke('mcpToolsPage',{server,query,offset}).then(value=>{if(current){setPage(value);setError('');}}).catch(e=>{if(current)setError(e.message);});},150);return()=>{current=false;clearTimeout(timer);};},[server,query,offset]);
 return <div className="mcp-catalog"><label>Buscar herramienta<input aria-label={'Buscar herramientas de '+server} value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}}/></label>{error&&<p role="alert" className="hint">{error}</p>}{page?.items.map(tool=><p key={tool.name}><strong>{tool.name}</strong><br/><small>{tool.description}</small></p>)}<div className="library-pagination"><small>{page?.total??0} herramientas</small><button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-20))}>Anterior</button><button disabled={page?.next==null} onClick={()=>setOffset(page.next)}>Siguiente</button></div></div>;
}
