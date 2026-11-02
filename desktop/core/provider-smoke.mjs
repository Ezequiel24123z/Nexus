import fs from 'node:fs/promises';
import path from 'node:path';

export async function providerSmoke({evaluate,click,settle,capture,output,check}) {
 await click('Settings');
 await evaluate("window.nexus.invoke('settings',{model:'arliai/DeepSeek-V4.1-Flash-1017',reasoningEffort:'max',contextWindow:96000,concurrency:1})");await settle();
 check(await evaluate("document.querySelector('[aria-label=\"Model service\"]').value==='arliai'"),'Arli.ai appears as selected provider');
 check((await evaluate('document.body.innerText')).includes('Use GLM · Derestricted'),'GLM Derestricted can be selected from settings');
 await click('Use GLM · Derestricted');
 const glm=await evaluate("window.nexus.invoke('snapshot').then(s=>({model:s.settings.model,effort:s.settings.reasoningEffort}))");
 check(glm.model==='arliai/GLM-4.6-Derestricted-v5'&&glm.effort==='high','GLM selects a compatible reasoning level');
 await click('Use DeepSeek · coding');
 const state=await evaluate("window.nexus.invoke('snapshot').then(s=>({model:s.settings.model,context:s.settings.contextWindow,concurrency:s.settings.concurrency,hasKey:s.hasKey}))");
 check(state.model==='arliai/DeepSeek-V4.1-Flash-1017'&&state.context===96000&&state.concurrency===1,'DeepSeek and Plus settings are saved');
 check(!state.hasKey,'OpenRouter key is not used as Arli.ai key');
 await evaluate("document.querySelector('[aria-label=\"Model service\"]').scrollIntoView({block:'start'})");await settle();
 await fs.writeFile(path.join(output,'arliai-settings.png'),(await capture()).toPNG());
}
