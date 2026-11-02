import React,{useEffect,useRef,useState} from 'react';
import {Search,ArrowUpRight,Command,X} from 'lucide-react';
import {useDialogFocus} from './ChatModelPicker.jsx';
export function FocusDialog({children,close,label,className=''}){
 const ref=useRef(null);useDialogFocus(ref,close);
 return <div className="modal-backdrop"><section ref={ref} role="dialog" aria-modal="true" aria-label={label} className={'modal '+className}>{children}</section></div>;
}
export function useAppearance(){
 const [preferences,setPreferences]=useState(()=>{try{const saved=JSON.parse(localStorage.getItem('nexus-appearance')||'{}');return {density:saved.density==='compact'?'compact':'comfortable',motion:saved.motion==='reduced'?'reduced':'system'};}catch{return {density:'comfortable',motion:'system'};}});
 const [error,setError]=useState('');
 useEffect(()=>{document.documentElement.dataset.motion=preferences.motion;document.documentElement.dataset.density=preferences.density;window.dispatchEvent(new Event('nexus-appearance'));},[preferences]);
 const update=(key,value)=>{const next={...preferences,[key]:value};setPreferences(next);try{localStorage.setItem('nexus-appearance',JSON.stringify(next));setError('');}catch{setError('La preferencia se aplica ahora, pero no pudo guardarse para el próximo inicio.');}};
 return {preferences,update,error};
}
export function AppearancePanel({appearance}){
 const {preferences,update,error}=appearance;
 return <section className="card"><h2>Apariencia y movimiento</h2><p className="hint">Un espacio blanco y tranquilo. Ajustes locales que no cambian las instrucciones del modelo.</p><label>Densidad<select aria-label="Densidad de interfaz" value={preferences.density} onChange={e=>update('density',e.target.value)}><option value="comfortable">Cómoda · más aire</option><option value="compact">Compacta · más contenido</option></select></label><label>Animaciones<select aria-label="Animaciones de interfaz" value={preferences.motion} onChange={e=>update('motion',e.target.value)}><option value="system">Sutiles · respetar preferencia del sistema</option><option value="reduced">Reducir movimiento</option></select></label><p className="hint">Ctrl+K abre la navegación rápida. El movimiento reducido también desactiva el suavizado visual del streaming.</p>{error&&<p role="alert" className="hint">{error}</p>}</section>;
}
export function SettingsNav(){
 const groups=[['Modelo','Modelo y conexión'],['Aspecto','Apariencia y movimiento'],['Instrucciones','Instrucciones globales'],['Ejecución','Autonomía y ejecución'],['Contexto','Compresión de contexto'],['Datos','Almacenamiento local']];
 return <nav className="settings-nav" aria-label="Secciones de configuración">{groups.map(([label,title])=><button key={title} onClick={()=>{const heading=[...document.querySelectorAll('.settings-grid h2')].find(node=>node.textContent===title);if(heading){heading.closest('section').scrollIntoView({block:'start',behavior:'auto'});heading.tabIndex=-1;heading.focus({preventScroll:true});}}}>{label}</button>)}</nav>;
}
export function CommandMenu({state,navigate,openTask,newChat}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState('');
 useEffect(()=>{const key=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){if(document.querySelector('[role=dialog]')&&!open)return;e.preventDefault();setQuery('');setOpen(value=>!value);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[open]);
 const actions=[{id:'new',title:'Nuevo chat',detail:'Empezar algo nuevo',run:newChat},...Object.entries({library:'Biblioteca',queue:'Tareas',files:'Archivos',connectors:'Conectores',mcp:'Extensiones MCP',settings:'Configuración'}).map(([id,title])=>({id,title,detail:'Ir a sección',run:()=>navigate(id)})),...state.tasks.map(task=>({id:task.id,title:task.title,detail:'Chat · '+task.status,run:()=>openTask(task.id)}))];
 const results=actions.filter(item=>(item.title+' '+item.detail).toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0,20);
 return <><button className="command-trigger" aria-label="Navegación rápida" title="Navegación rápida · Ctrl K" onClick={()=>{setQuery('');setOpen(true);}}><Search size={15}/><span>Ir a…</span><kbd>Ctrl K</kbd></button>{open&&<FocusDialog label="Navegación rápida" close={()=>setOpen(false)} className="command-dialog"><div className="command-search"><Command size={19}/><input aria-label="Buscar sección o chat" placeholder="¿Adónde quieres ir?" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&results[0]){e.preventDefault();setOpen(false);results[0].run();}if(e.key==='ArrowDown'){e.preventDefault();document.querySelector('.command-results button')?.focus();}}}/><button aria-label="Cerrar navegación" onClick={()=>setOpen(false)}><X size={17}/></button></div><div className="command-results" onKeyDown={e=>{if(!['ArrowDown','ArrowUp'].includes(e.key))return;const buttons=[...e.currentTarget.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}}>{results.map(item=><button key={item.id} onClick={()=>{setOpen(false);item.run();}}><div><strong>{item.title}</strong><small>{item.detail}</small></div><ArrowUpRight size={15}/></button>)}{!results.length&&<p className="hint">No hay coincidencias. Prueba otro nombre.</p>}</div><footer>↑ ↓ para recorrer · Enter para abrir · Esc para cerrar</footer></FocusDialog>}</>;
}
