import fs from 'node:fs/promises';
import path from 'node:path';

export async function providerSmoke({evaluate,click,settle,capture,output,check}) {
 await click('Configuración');
 await evaluate("window.nexus.invoke('settings',{model:'arliai/DeepSeek-V4.1-Flash-1017',reasoningEffort:'max',contextWindow:96000,concurrency:1})");await settle();
 check(await evaluate("document.querySelector('[aria-label=\"Servicio de modelos\"]').value==='arliai'"),'Arli.ai aparece como proveedor seleccionado');
 check((await evaluate('document.body.innerText')).includes('Usar GLM · Derestricted'),'GLM Derestricted puede seleccionarse desde configuración');
 await click('Usar GLM · Derestricted');
 const glm=await evaluate("window.nexus.invoke('snapshot').then(s=>({model:s.settings.model,effort:s.settings.reasoningEffort}))");
 check(glm.model==='arliai/GLM-4.6-Derestricted-v5'&&glm.effort==='high','GLM selecciona un nivel de razonamiento compatible');
 await click('Usar DeepSeek · coding');
 const state=await evaluate("window.nexus.invoke('snapshot').then(s=>({model:s.settings.model,context:s.settings.contextWindow,concurrency:s.settings.concurrency,hasKey:s.hasKey}))");
 check(state.model==='arliai/DeepSeek-V4.1-Flash-1017'&&state.context===96000&&state.concurrency===1,'DeepSeek y los ajustes de Plus quedan guardados');
 check(!state.hasKey,'la clave de OpenRouter no se usa como clave de Arli.ai');
 await evaluate("document.querySelector('[aria-label=\"Servicio de modelos\"]').scrollIntoView({block:'start'})");await settle();
 await fs.writeFile(path.join(output,'arliai-settings.png'),(await capture()).toPNG());
}
