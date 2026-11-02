import fs from 'node:fs/promises';
import path from 'node:path';

export async function openApiSmoke({evaluate:rawEvaluate,click,settle,capture,runtime,output,check}) {
  const evaluate=async script=>{try{return await rawEvaluate(script);}catch(error){await fs.writeFile(path.join(output,'openapi-failure.png'),(await capture()).toPNG());throw new Error('OpenAPI UI: '+script.slice(0,250)+' — '+error.message);}};
  const set=async(selector,value)=>{await evaluate(`{const el=document.querySelector(${JSON.stringify(selector)});const prototype=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));}`);await settle();};
  const open=async()=>{await evaluate("{const button=[...document.querySelectorAll('button')].find(button=>button.textContent==='Importar OpenAPI');button.focus();button.click();}");await settle();};
  const originalRequest=runtime.request;let calls=0;
  runtime.request=async()=>{calls++;throw new Error('Unexpected network call during OpenAPI UI test');};
  try {
    await click('Conectores');await open();
    check(await evaluate("document.activeElement?.getAttribute('aria-label')==='Archivo OpenAPI'"),'importador abre con foco accesible en el archivo local');
    await set('[aria-label="Definición OpenAPI"]','invalid JSON');await click('Revisar definición');
    check(await evaluate("document.querySelector('.openapi-error')?.textContent.includes('JSON válido')"),'JSON inválido se explica dentro del importador sin cerrar el diálogo');
    const document={openapi:'3.1.0',info:{title:'Catálogo local de prueba'},servers:[{url:'https://example.test/v1'}],paths:Object.fromEntries(Array.from({length:21},(_,i)=>['/items/'+i,{get:{operationId:'item'+i,summary:'Consultar elemento '+i}}]))};
    document.paths['/private']={get:{security:[{oauth:[]}]}};
    document.components={securitySchemes:{oauth:{type:'oauth2',flows:{}}}};
    await evaluate(`{const input=document.querySelector('[aria-label="Archivo OpenAPI"]');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(document))}],'fixture-openapi.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}`);await settle();
    check(await evaluate("document.querySelector('[aria-label=\"Definición OpenAPI\"]').value.includes('Catálogo local')&&document.querySelector('.openapi-file strong').textContent==='fixture-openapi.json'"),'archivo JSON local carga mediante el selector de la interfaz');
    await set('[aria-label="Prefijo OpenAPI"]','SmokeAPI');
    const before=runtime.store.state.connectors.length;await click('Revisar definición');
    check(await evaluate("document.querySelectorAll('.openapi-operation').length===20"),'vista previa pagina veinte operaciones sin ejecutar llamadas');
    check(runtime.store.state.connectors.length===before,'vista previa no cambia los conectores guardados');
    await evaluate("document.querySelector('[aria-label=\"Importar GET /items/0\"]').click()");await settle();
    await evaluate("[...document.querySelectorAll('.openapi-dialog button')].find(button=>button.textContent==='Siguiente').click()");await settle();
    check(await evaluate("document.querySelectorAll('.openapi-operation').length===2&&document.querySelector('[aria-label=\"Importar GET /private\"]').disabled"),'página final explica autenticación no compatible y no permite seleccionarla');
    await evaluate("document.querySelector('[aria-label=\"Importar GET /items/20\"]').click()");await settle();
    await set('[aria-label="Buscar operaciones OpenAPI"]','/items/0');
    check(await evaluate("document.querySelector('[aria-label=\"Importar GET /items/0\"]').checked&&document.querySelector('.openapi-footer .primary').textContent==='Importar 2 operaciones'"),'selección se conserva al cambiar de página y filtrar');
    await set('[aria-label="Buscar operaciones OpenAPI"]','');
    await fs.writeFile(path.join(output,'openapi-preview.png'),(await capture()).toPNG());
    check(await evaluate("(()=>{const footer=document.querySelector('.openapi-footer').getBoundingClientRect();const dialog=document.querySelector('.openapi-dialog').getBoundingClientRect();return footer.bottom<=innerHeight&&dialog.left>=0&&dialog.right<=innerWidth;})()"),'pie de importación permanece visible sin desbordamiento horizontal');
    await click('Importar 2 operaciones');await settle();
    check(runtime.store.state.connectors.length===before+2,'importación selectiva guarda sólo dos operaciones desde la interfaz');
    check(await evaluate("!document.querySelector('[aria-label=\"Importar OpenAPI\"]')&&document.body.textContent.includes('2 operaciones importadas')"),'importación termina con confirmación local y cierra el diálogo');
    await set('[aria-label="Buscar conectores"]','SmokeAPI');await settle();
    await evaluate("document.querySelector('.connector-list .capability-card').click()");await settle();
    check(await evaluate("!!document.querySelector('.openapi-contract')&&document.querySelector('.settings-grid form select').disabled&&document.querySelectorAll('.settings-grid form label input')[1].readOnly"),'conector importado expone contrato y evita cambios accidentales de método o ruta');
    await open();await set('[aria-label="Definición OpenAPI"]',JSON.stringify(document));await set('[aria-label="Prefijo OpenAPI"]','SmokeAPI');await click('Revisar definición');
    check(await evaluate("document.querySelector('[aria-label=\"Importar GET /items/0\"]').disabled&&document.querySelector('.openapi-operations').textContent.includes('Ya existe')"),'importación repetida marca conflictos y nunca sobrescribe definiciones');
    await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await settle();
    check(await evaluate("!document.querySelector('[role=dialog]')&&document.activeElement.textContent==='Importar OpenAPI'"),'Escape cancela la revisión y devuelve el foco al botón de importación');
    check(calls===0,'seleccionar archivo, revisar, importar y cancelar generan cero llamadas de API');
    await click('Configuración');
  } finally {runtime.request=originalRequest;}
}
