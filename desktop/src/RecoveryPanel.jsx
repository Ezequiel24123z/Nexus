import React,{useState} from 'react';
export default function RecoveryPanel({act}){
 const [busy,setBusy]=useState(false),[preview,setPreview]=useState(null),[result,setResult]=useState(null);
 const inspect=async()=>{setBusy(true);setPreview(null);setResult(null);try{setPreview(await act('inspectRecovery'));}finally{setBusy(false);}};
 const restore=async()=>{setBusy(true);try{const value=await act('restoreRecovery',{token:preview.token});if(value){setResult(value);setPreview(null);}}finally{setBusy(false);}};
 return <section className="card wide recovery-panel" aria-label="Recuperación de copias" aria-busy={busy}>
  <h2>Recuperar una copia</h2><p className="hint">Comprueba un JSON exportado o una copia SQLite y prepara su estado en una carpeta nueva. Tu sesión actual no se modifica.</p>
  <button className="secondary" disabled={busy} onClick={inspect}>{busy?'Comprobando…':'Seleccionar copia para revisar'}</button>
  {busy&&<p role="status" className="hint">Procesando fuera de la interfaz. No cierres la aplicación hasta que termine.</p>}
  {preview&&<div className="recovery-preview"><h3>{preview.name}</h3><p className="hint">Archivo modificado: {new Date(preview.modifiedAt).toLocaleString()} · {(preview.bytes/1024/1024).toFixed(2)} MiB. La fecha del archivo no garantiza que incluya los últimos cambios.</p>
   <dl className="recovery-counts"><div><dt>Chats</dt><dd>{preview.chats}</dd></div><div><dt>Mensajes visibles</dt><dd>{preview.messages}</dd></div><div><dt>Proyectos</dt><dd>{preview.projects}</dd></div><div><dt>Formato</dt><dd>{preview.format.toUpperCase()}</dd></div></dl>
   {preview.interrupted>0&&<p>{preview.interrupted} tareas interrumpidas quedarán pausadas.</p>}
   <ul className="hint">{preview.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul>
   <div className="row"><button className="primary" disabled={busy} onClick={restore}>Recuperar en carpeta nueva</button><button disabled={busy} onClick={()=>setPreview(null)}>Cancelar revisión</button></div>
  </div>}
  {result&&<div role="status" className="recovery-result"><h3>Estado recuperado y verificado</h3><p>{result.chats} chats guardados en:</p><p className="recovery-path">{result.directory}</p><p className="hint">No se ha activado ni se han copiado adjuntos, archivos de proyecto o credenciales. Conserva los originales. Revisa recovery-report.json y las rutas antes de usar esta carpeta.</p></div>}
 </section>;
}
