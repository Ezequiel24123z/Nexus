import fs from 'node:fs/promises';
import path from 'node:path';

export async function openApiSmoke({evaluate:rawEvaluate,click,settle,capture,runtime,output,check}) {
  const evaluate=async script=>{try{return await rawEvaluate(script);}catch(error){await fs.writeFile(path.join(output,'openapi-failure.png'),(await capture()).toPNG());throw new Error('OpenAPI UI: '+script.slice(0,250)+' — '+error.message);}};
  const set=async(selector,value)=>{await evaluate(`{const el=document.querySelector(${JSON.stringify(selector)});const prototype=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));}`);await settle();};
  const open=async()=>{await evaluate("{const button=[...document.querySelectorAll('button')].find(button=>button.textContent==='Import OpenAPI');button.focus();button.click();}");await settle();};
  const originalRequest=runtime.request;let calls=0;
  runtime.request=async()=>{calls++;throw new Error('Unexpected network call during OpenAPI UI test');};
  try {
    await click('Connectors');await open();
    check(await evaluate("document.activeElement?.getAttribute('aria-label')==='OpenAPI file'"),'importer opens with accessible focus on local file');
    await set('[aria-label="OpenAPI specification"]','invalid JSON');await click('Review specification');
    check(await evaluate("document.querySelector('.openapi-error')?.textContent.includes('valid JSON')"),'invalid JSON is explained inside importer without closing dialog');
    const document={openapi:'3.1.0',info:{title:'Local test catalog'},servers:[{url:'https://example.test/v1'}],paths:Object.fromEntries(Array.from({length:21},(_,i)=>['/items/'+i,{get:{operationId:'item'+i,summary:'Query item '+i}}]))};
    document.paths['/private']={get:{security:[{oauth:[]}]}};
    document.components={securitySchemes:{oauth:{type:'oauth2',flows:{}}}};
    await evaluate(`{const input=document.querySelector('[aria-label="OpenAPI file"]');const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(document))}],'fixture-openapi.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}`);await settle();
    check(await evaluate("document.querySelector('[aria-label=\"OpenAPI specification\"]').value.includes('Local test catalog')&&document.querySelector('.openapi-file strong').textContent==='fixture-openapi.json'"),'local JSON file loads via UI file input');
    await set('[aria-label="OpenAPI prefix"]','SmokeAPI');
    const before=runtime.store.state.connectors.length;await click('Review specification');
    check(await evaluate("document.querySelectorAll('.openapi-operation').length===20"),'preview paginates 20 operations without executing calls');
    check(runtime.store.state.connectors.length===before,'preview does not mutate saved connectors');
    await evaluate("document.querySelector('[aria-label=\"Import GET /items/0\"]').click()");await settle();
    await evaluate("[...document.querySelectorAll('.openapi-dialog button')].find(button=>button.textContent==='Next').click()");await settle();
    check(await evaluate("document.querySelectorAll('.openapi-operation').length===2&&document.querySelector('[aria-label=\"Import GET /private\"]').disabled"),'final page explains unsupported auth and disables selection');
    await evaluate("document.querySelector('[aria-label=\"Import GET /items/20\"]').click()");await settle();
    await set('[aria-label="Search OpenAPI operations"]','/items/0');
    check(await evaluate("document.querySelector('[aria-label=\"Import GET /items/0\"]').checked&&document.querySelector('.openapi-footer .primary').textContent==='Import 2 operations'"),'selection is preserved across pagination and filtering');
    await set('[aria-label="Search OpenAPI operations"]','');
    await fs.writeFile(path.join(output,'openapi-preview.png'),(await capture()).toPNG());
    check(await evaluate("(()=>{const footer=document.querySelector('.openapi-footer').getBoundingClientRect();const dialog=document.querySelector('.openapi-dialog').getBoundingClientRect();return footer.bottom<=innerHeight&&dialog.left>=0&&dialog.right<=innerWidth;})()"),'import footer stays visible without horizontal overflow');
    await click('Import 2 operations');await settle();
    check(runtime.store.state.connectors.length===before+2,'selective import saves only two operations from UI');
    check(await evaluate("!document.querySelector('[aria-label=\"Import OpenAPI\"]')&&document.body.textContent.includes('2 operations imported')"),'import finishes with local confirmation and closes dialog');
    await set('[aria-label="Search connectors"]','SmokeAPI');await settle();
    await evaluate("document.querySelector('.connector-list .capability-card').click()");await settle();
    check(await evaluate("!!document.querySelector('.openapi-contract')&&document.querySelector('.settings-grid form select').disabled&&document.querySelectorAll('.settings-grid form label input')[1].readOnly"),'imported connector exposes contract and prevents accidental route or method edits');
    await open();await set('[aria-label="OpenAPI specification"]',JSON.stringify(document));await set('[aria-label="OpenAPI prefix"]','SmokeAPI');await click('Review specification');
    check(await evaluate("document.querySelector('[aria-label=\"Import GET /items/0\"]').disabled&&document.querySelector('.openapi-operations').textContent.includes('Already exists')"),'repeated import flags conflicts and never overwrites definitions');
    await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await settle();
    check(await evaluate("!document.querySelector('[role=dialog]')&&document.activeElement.textContent==='Import OpenAPI'"),'Escape cancels review and returns focus to import button');
    check(calls===0,'selecting file, reviewing, importing, and cancelling generate zero API calls');
    await click('Settings');
  } finally {runtime.request=originalRequest;}
}
