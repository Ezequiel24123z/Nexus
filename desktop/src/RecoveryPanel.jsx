import React,{useState} from 'react';
export default function RecoveryPanel({act}){
 const [busy,setBusy]=useState(false),[preview,setPreview]=useState(null),[result,setResult]=useState(null);
 const inspect=async()=>{setBusy(true);setPreview(null);setResult(null);try{setPreview(await act('inspectRecovery'));}finally{setBusy(false);}};
 const restore=async()=>{setBusy(true);try{const value=await act('restoreRecovery',{token:preview.token});if(value){setResult(value);setPreview(null);}}finally{setBusy(false);}};
 return <section className="card wide recovery-panel" aria-label="Backup recovery" aria-busy={busy}>
  <h2>Recover a Backup</h2><p className="hint">Verify an exported JSON or SQLite backup and stage its state into a new isolated folder. Your active session is never overwritten.</p>
  <button className="secondary" disabled={busy} onClick={inspect}>{busy?'Checking…':'Select backup to review'}</button>
  {busy&&<p role="status" className="hint">Processing in background worker. Do not close the application until it finishes.</p>}
  {preview&&<div className="recovery-preview"><h3>{preview.name}</h3><p className="hint">Modified: {new Date(preview.modifiedAt).toLocaleString()} · {(preview.bytes/1024/1024).toFixed(2)} MiB. File timestamp does not guarantee all latest changes are included.</p>
   <dl className="recovery-counts"><div><dt>Chats</dt><dd>{preview.chats}</dd></div><div><dt>Visible messages</dt><dd>{preview.messages}</dd></div><div><dt>Projects</dt><dd>{preview.projects}</dd></div><div><dt>Format</dt><dd>{preview.format.toUpperCase()}</dd></div></dl>
   {preview.interrupted>0&&<p>{preview.interrupted} interrupted tasks will be placed in paused state.</p>}
   <ul className="hint">{preview.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul>
   <div className="row"><button className="primary" disabled={busy} onClick={restore}>Restore into new folder</button><button disabled={busy} onClick={()=>setPreview(null)}>Cancel review</button></div>
  </div>}
  {result&&<div role="status" className="recovery-result"><h3>State recovered and verified</h3><p>{result.chats} chats saved in:</p><p className="recovery-path">{result.directory}</p><p className="hint">Not automatically activated, and attachments, project files, or credentials were not copied. Keep originals. Review recovery-report.json and paths before using this directory.</p></div>}
 </section>;
}
