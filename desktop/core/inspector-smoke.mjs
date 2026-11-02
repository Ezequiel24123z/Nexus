import fs from 'node:fs/promises';
import path from 'node:path';

export async function inspectorSmoke({evaluate,click,settle,capture,runtime,output,check}) {
  const oldClosed=runtime.closed,oldRequest=runtime.request;let requests=0;
  runtime.closed=true;runtime.request=async()=>{requests++;throw new Error('Inspector must not call model');};
  try {
    const task=runtime.store.task(runtime.create({prompt:'Context and spend test',workspace:runtime.store.directory}));
    task.title='Inspector test';task.status='complete';
    task.messages=[{role:'user',content:'ORIGINAL-VERIFIABLE '+ 'detail '.repeat(1800)},{role:'assistant',content:'Preserved response',reasoning_details:[{text:'HIDDEN_INTERNAL_REASONING'}]}];
    runtime.store.checkpoint(task,'VERIFIABLE-MEMORY: preserve original detail.',[],{before:12000,after:3500,estimated:true,cost:.002,unknownCosts:0});
    task.lastCompression={before:12000,after:3500,cost:.002,unknownCosts:0};
    task.calls=Array.from({length:25},(_,i)=>({id:'inspector-call-'+i,at:new Date().toISOString(),kind:i===0?'compression':'generation',status:'complete',model:'fixture/model',input:100,cached:i===1?null:80,output:20,cost:i===1?null:i===0?.002:.001,retried:i===2}));
    runtime.changed(task);await settle();
    await evaluate("[...document.querySelectorAll('.chat-link')].find(button=>button.textContent.includes('Inspector test')).click()");await settle();
    await evaluate("{const button=document.querySelector('[aria-label=\"Inspect context and spend\"]');button.focus();button.click();}");await settle();
    check(await evaluate("!!document.querySelector('[aria-label=\"Context & Spend\"]')&&document.querySelector('.inspector-sections').textContent.includes('Available Tools')"),'inspector opens from chat with real context and tool schemas');
    check(await evaluate("document.activeElement.textContent==='Context'"),'inspector focuses its navigation after loading');
    check(await evaluate("(()=>{const button=document.querySelector('.inspector-tabs button');const rect=button.getBoundingClientRect();return document.querySelectorAll('[role=dialog]').length===1&&button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));})()"),'inspector is the only visible dialog and controls are unobstructed');
    const wire=await evaluate(`window.nexus.invoke('inspectContext',{id:${JSON.stringify(task.id)}})`);
    check(!JSON.stringify(wire).includes('VERIFIABLE-MEMORY'),'initial inspector returns metadata without context bodies');
    await fs.writeFile(path.join(output,'context-inspector.png'),(await capture()).toPNG());
    await evaluate("[...document.querySelectorAll('.inspector-section')].find(button=>button.textContent.includes('Compacted Continuity')).click()");await settle();
    check(await evaluate("document.querySelector('.inspector-preview').textContent.includes('VERIFIABLE-MEMORY')"),'continuity detail loads on demand');
    await click('Back to inspector');await click('Spend & Cache');
    check(await evaluate("document.querySelectorAll('.cost-calls details').length===20&&document.querySelector('.inspector-body').textContent.includes('1 call without reported cost')"),'spend shows 20 calls and flags unknown costs');
    await fs.writeFile(path.join(output,'cost-inspector.png'),(await capture()).toPNG());
    await evaluate("[...document.querySelectorAll('.inspector-dialog button')].find(button=>button.textContent==='Next').click()");await settle();
    check(await evaluate("document.querySelectorAll('.cost-calls details').length===5"),'spend log paginates full history');
    await click('Compactions');await click('View originals');
    check(await evaluate("document.querySelector('.inspector-preview').textContent.includes('ORIGINAL-VERIFIABLE')&&!document.querySelector('.inspector-preview').textContent.includes('HIDDEN_INTERNAL_REASONING')"),'compaction originals are inspectable without exposing hidden reasoning');
    await evaluate("[...document.querySelectorAll('.inspector-dialog button')].find(button=>button.textContent==='Next').click()");await settle();
    check(await evaluate("document.querySelector('.library-pagination small').textContent.startsWith('6000')||document.querySelector('.library-pagination small').textContent.startsWith('6,000')"),'large checkpoint is queried in bounded chunks');
    await click('Back to inspector');await click('Context');
    task.summary+=' SUBSEQUENT CHANGE';runtime.changed(task);await settle();
    await evaluate("[...document.querySelectorAll('.inspector-section')].find(button=>button.textContent.includes('Compacted Continuity')).click()");await settle();
    check(await evaluate("document.querySelector('.inspector-error').textContent.includes('context changed')"),'stale snapshot is not presented as current context');
    await evaluate("document.querySelector('[aria-label=\"Refresh inspector\"]').click()");await settle();
    check(await evaluate("!document.querySelector('.inspector-error')"),'refresh recovers inspector after context changes');
    await evaluate("document.querySelector('[aria-label=\"Close inspector\"]').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));");await settle();
    check(await evaluate("!document.querySelector('.inspector-dialog')&&document.activeElement.getAttribute('aria-label')==='Inspect context and spend'"),'Escape closes inspector and restores focus to chat');
    check(requests===0,'context, spend, and checkpoints are inspected with zero API calls');
    await click('Tasks');await click('Create batch');
    check(await evaluate("document.querySelectorAll('[role=dialog]').length===1&&document.querySelector('[aria-label=\"Task batch\"]')?.textContent.includes('Create Task Batch')"),'batch dialog remains available without colliding with inspector');
    await evaluate("document.querySelector('[aria-label=\"Task batch\"] [aria-label=\"Close\"]').click()");await settle();
    await click('Settings');
    await evaluate("[...document.querySelectorAll('.toggle')].find(label=>label.textContent.includes('Per-conversation provider affinity')).querySelector('input').click()");await settle();
    check(runtime.store.state.settings.cacheAffinity===true,'experimental affinity enables explicitly from Settings');
    await evaluate("[...document.querySelectorAll('.toggle')].find(label=>label.textContent.includes('Per-conversation provider affinity')).querySelector('input').click()");await settle();
    check(runtime.store.state.settings.cacheAffinity===false&&requests===0,'affinity can be disabled without calling provider');
  } finally {runtime.closed=oldClosed;runtime.request=oldRequest;}
}
