import React,{useEffect,useRef,useState} from 'react';
import {Search,ArrowUpRight,Command,X} from 'lucide-react';
import {useDialogFocus} from './ChatModelPicker.jsx';
export function FocusDialog({children,close,label,className=''}){
 const ref=useRef(null);useDialogFocus(ref,close);
 return <div className="modal-backdrop"><section ref={ref} role="dialog" aria-modal="true" aria-label={label} className={'modal '+className}>{children}</section></div>;
}
export function useAppearance(){
 const [preferences,setPreferences]=useState(()=>{try{const saved=JSON.parse(localStorage.getItem('nexus-appearance')||'{}');return {density:saved.density==='compact'?'compact':'comfortable',motion:saved.motion==='reduced'?'reduced':'system',theme:['dark','light','system'].includes(saved.theme)?saved.theme:'light'};}catch{return {density:'comfortable',motion:'system',theme:'light'};}});
 const [error,setError]=useState('');
 useEffect(()=>{
   document.documentElement.dataset.motion=preferences.motion;
   document.documentElement.dataset.density=preferences.density;
   const resolvedTheme=preferences.theme==='system'?(window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light'):preferences.theme;
   document.documentElement.dataset.theme=resolvedTheme;
   window.dispatchEvent(new Event('nexus-appearance'));
 },[preferences]);
 const update=(key,value)=>{const next={...preferences,[key]:value};setPreferences(next);try{localStorage.setItem('nexus-appearance',JSON.stringify(next));setError('');}catch{setError('Preference applied for this session, but could not be saved for next startup.');}};
 return {preferences,update,error};
}
export function AppearancePanel({appearance}){
 const {preferences,update,error}=appearance;
 return <section className="card"><h2>Appearance & Motion</h2><p className="hint">Customize visual theme, layout density, and motion. Local interface settings do not alter model instructions.</p>
  <label>Color Theme<select aria-label="Interface theme" value={preferences.theme||'light'} onChange={e=>update('theme',e.target.value)}><option value="light">Light · Studio Paper</option><option value="dark">Dark · Obsidian Carbon</option><option value="system">System preference</option></select></label>
  <label>Density<select aria-label="Interface density" value={preferences.density} onChange={e=>update('density',e.target.value)}><option value="comfortable">Comfortable · more breathing room</option><option value="compact">Compact · higher information density</option></select></label>
  <label>Motion<select aria-label="Interface animations" value={preferences.motion} onChange={e=>update('motion',e.target.value)}><option value="system">Subtle · respect system preference</option><option value="reduced">Reduce motion</option></select></label>
  <p className="hint">Ctrl+K opens quick navigation. Reduced motion also disables smooth streaming text interpolation.</p>{error&&<p role="alert" className="hint">{error}</p>}</section>;
}
export function SettingsNav(){
 const groups=[['Model','Model & Connection'],['Appearance','Appearance & Motion'],['Instructions','Global Instructions'],['Execution','Autonomy & Execution'],['Context','Context Compaction'],['Storage','Local Storage']];
 return <nav className="settings-nav" aria-label="Settings sections">{groups.map(([label,title])=><button key={title} onClick={()=>{const heading=[...document.querySelectorAll('.settings-grid h2')].find(node=>node.textContent===title);if(heading){heading.closest('section').scrollIntoView({block:'start',behavior:'auto'});heading.tabIndex=-1;heading.focus({preventScroll:true});}}}>{label}</button>)}</nav>;
}
export function CommandMenu({state,navigate,openTask,newChat,appearance}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState('');
 useEffect(()=>{const key=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){if(document.querySelector('[role=dialog]')&&!open)return;e.preventDefault();setQuery('');setOpen(value=>!value);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[open]);
 const actions=[
   {id:'new',title:'New chat',detail:'Start a new agent session',run:newChat},
   ...Object.entries({library:'Library',queue:'Tasks',files:'Files',connectors:'Connectors',mcp:'MCP Extensions',settings:'Settings'}).map(([id,title])=>({id,title,detail:'Navigate to section',run:()=>navigate(id)})),
   ...(appearance?[{id:'toggle-theme',title:appearance.preferences.theme==='dark'?'Switch to Light Theme':'Switch to Dark Theme',detail:'Appearance · Theme',run:()=>appearance.update('theme',appearance.preferences.theme==='dark'?'light':'dark')}]:[]),
   ...state.tasks.map(task=>({id:task.id,title:task.title,detail:'Chat · '+task.status,run:()=>openTask(task.id)}))
 ];
 const results=actions.filter(item=>(item.title+' '+item.detail).toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0,20);
 return <><button className="command-trigger" aria-label="Quick navigation" title="Quick navigation · Ctrl K" onClick={()=>{setQuery('');setOpen(true);}}><Search size={15}/><span>Go to…</span><kbd>Ctrl K</kbd></button>{open&&<FocusDialog label="Quick navigation" close={()=>setOpen(false)} className="command-dialog"><div className="command-search"><Command size={19}/><input aria-label="Search section or chat" placeholder="Where would you like to go?" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&results[0]){e.preventDefault();setOpen(false);results[0].run();}if(e.key==='ArrowDown'){e.preventDefault();document.querySelector('.command-results button')?.focus();}}}/><button aria-label="Close navigation" onClick={()=>setOpen(false)}><X size={17}/></button></div><div className="command-results" onKeyDown={e=>{if(!['ArrowDown','ArrowUp'].includes(e.key))return;const buttons=[...e.currentTarget.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}}>{results.map(item=><button key={item.id} onClick={()=>{setOpen(false);item.run();}}><div><strong>{item.title}</strong><small>{item.detail}</small></div><ArrowUpRight size={15}/></button>)}{!results.length&&<p className="hint">No matches found. Try another search term.</p>}</div><footer>↑ ↓ to navigate · Enter to open · Esc to close</footer></FocusDialog>}</>;
}
