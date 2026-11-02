import fs from 'node:fs/promises';
import path from 'node:path';

export async function inspectorSmoke({evaluate,click,settle,capture,runtime,output,check}) {
  const oldClosed=runtime.closed,oldRequest=runtime.request;let requests=0;
  runtime.closed=true;runtime.request=async()=>{requests++;throw new Error('Inspector must not call model');};
  try {
    const task=runtime.store.task(runtime.create({prompt:'Prueba de contexto y gasto',workspace:runtime.store.directory}));
    task.title='Inspector de prueba';task.status='complete';
    task.messages=[{role:'user',content:'ORIGINAL-VERIFICABLE '+ 'detalle '.repeat(1800)},{role:'assistant',content:'Respuesta conservada',reasoning_details:[{text:'HIDDEN_INTERNAL_REASONING'}]}];
    runtime.store.checkpoint(task,'MEMORIA-VERIFICABLE: conservar el detalle original.',[],{before:12000,after:3500,estimated:true,cost:.002,unknownCosts:0});
    task.lastCompression={before:12000,after:3500,cost:.002,unknownCosts:0};
    task.calls=Array.from({length:25},(_,i)=>({id:'inspector-call-'+i,at:new Date().toISOString(),kind:i===0?'compression':'generation',status:'complete',model:'fixture/model',input:100,cached:i===1?null:80,output:20,cost:i===1?null:i===0?.002:.001,retried:i===2}));
    runtime.changed(task);await settle();
    await evaluate("[...document.querySelectorAll('.chat-link')].find(button=>button.textContent.includes('Inspector de prueba')).click()");await settle();
    await evaluate("{const button=document.querySelector('[aria-label=\"Inspeccionar contexto y gasto\"]');button.focus();button.click();}");await settle();
    check(await evaluate("!!document.querySelector('[aria-label=\"Contexto y gasto\"]')&&document.querySelector('.inspector-sections').textContent.includes('Herramientas disponibles')"),'inspector abre desde el chat con contexto real y esquemas disponibles');
    check(await evaluate("document.activeElement.textContent==='Contexto'"),'inspector sitúa el foco en su navegación después de cargar');
    check(await evaluate("(()=>{const button=document.querySelector('.inspector-tabs button');const rect=button.getBoundingClientRect();return document.querySelectorAll('[role=dialog]').length===1&&button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));})()"),'inspector es el único diálogo visible y sus controles no quedan tapados');
    const wire=await evaluate(`window.nexus.invoke('inspectContext',{id:${JSON.stringify(task.id)}})`);
    check(!JSON.stringify(wire).includes('MEMORIA-VERIFICABLE'),'inspector inicial entrega metadatos y no cuerpos del contexto');
    await fs.writeFile(path.join(output,'context-inspector.png'),(await capture()).toPNG());
    await evaluate("[...document.querySelectorAll('.inspector-section')].find(button=>button.textContent.includes('Continuidad comprimida')).click()");await settle();
    check(await evaluate("document.querySelector('.inspector-preview').textContent.includes('MEMORIA-VERIFICABLE')"),'detalle de continuidad carga bajo demanda');
    await click('Volver al inspector');await click('Gasto y caché');
    check(await evaluate("document.querySelectorAll('.cost-calls details').length===20&&document.querySelector('.inspector-body').textContent.includes('1 llamada sin coste informado')"),'gasto muestra veinte llamadas y señala costes desconocidos');
    await fs.writeFile(path.join(output,'cost-inspector.png'),(await capture()).toPNG());
    await evaluate("[...document.querySelectorAll('.inspector-dialog button')].find(button=>button.textContent==='Siguiente').click()");await settle();
    check(await evaluate("document.querySelectorAll('.cost-calls details').length===5"),'registro de gasto pagina el historial completo');
    await click('Compresiones');await click('Ver originales');
    check(await evaluate("document.querySelector('.inspector-preview').textContent.includes('ORIGINAL-VERIFICABLE')&&!document.querySelector('.inspector-preview').textContent.includes('HIDDEN_INTERNAL_REASONING')"),'originales de compresión consultables sin mostrar razonamiento oculto');
    await evaluate("[...document.querySelectorAll('.inspector-dialog button')].find(button=>button.textContent==='Siguiente').click()");await settle();
    check(await evaluate("document.querySelector('.library-pagination small').textContent.startsWith('6000')||document.querySelector('.library-pagination small').textContent.startsWith('6.000')"),'checkpoint grande se consulta por fragmentos acotados');
    await click('Volver al inspector');await click('Contexto');
    task.summary+=' CAMBIO POSTERIOR';runtime.changed(task);await settle();
    await evaluate("[...document.querySelectorAll('.inspector-section')].find(button=>button.textContent.includes('Continuidad comprimida')).click()");await settle();
    check(await evaluate("document.querySelector('.inspector-error').textContent.includes('contexto cambió')"),'una fotografía obsoleta no se presenta como contexto actual');
    await evaluate("document.querySelector('[aria-label=\"Actualizar inspector\"]').click()");await settle();
    check(await evaluate("!document.querySelector('.inspector-error')"),'actualizar recupera el inspector después de cambios del contexto');
    await evaluate("document.querySelector('[aria-label=\"Cerrar inspector\"]').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));");await settle();
    check(await evaluate("!document.querySelector('.inspector-dialog')&&document.activeElement.getAttribute('aria-label')==='Inspeccionar contexto y gasto'"),'Escape cierra inspector y restaura el foco en el chat');
    check(requests===0,'contexto, gasto y checkpoints se inspeccionan sin llamadas de API');
    await click('Tareas');await click('Crear lote');
    check(await evaluate("document.querySelectorAll('[role=dialog]').length===1&&document.querySelector('[aria-label=\"Lote de tareas\"]')?.textContent.includes('Crear lote')"),'el diálogo de lotes continúa disponible sin mezclarse con el inspector');
    await evaluate("document.querySelector('[aria-label=\"Lote de tareas\"] [aria-label=\"Cerrar\"]').click()");await settle();
    await click('Configuración');
    await evaluate("[...document.querySelectorAll('.toggle')].find(label=>label.textContent.includes('Afinidad de proveedor por conversación')).querySelector('input').click()");await settle();
    check(runtime.store.state.settings.cacheAffinity===true,'afinidad experimental se activa explícitamente desde Configuración');
    await evaluate("[...document.querySelectorAll('.toggle')].find(label=>label.textContent.includes('Afinidad de proveedor por conversación')).querySelector('input').click()");await settle();
    check(runtime.store.state.settings.cacheAffinity===false&&requests===0,'afinidad puede desactivarse sin llamar al proveedor');
  } finally {runtime.closed=oldClosed;runtime.request=oldRequest;}
}
