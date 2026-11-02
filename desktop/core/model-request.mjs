import crypto from 'node:crypto';
import {baseTools} from './tools.mjs';
import {modelConnection} from './providers.mjs';

export function requestTools(settings) {
  const local=baseTools.filter(tool=>settings.desktopEnabled||!tool.function.name.startsWith('desktop_'));
  if(!settings.webSearchEnabled||modelConnection(settings.model).id==='arliai')return local;
  return [...local,{type:'openrouter:web_search',parameters:{engine:settings.webSearchEngine,max_results:settings.webMaxResults,search_context_size:settings.webSearchContext,...(settings.webMaxUses>0?{max_uses:settings.webMaxUses}:{})}}];
}
export function affinitySession(task,tools=true) {
  // Opaque, stable across restart; never send paths, titles, prompts or key material.
  return 'nexus-'+crypto.createHash('sha256').update(String(task.id)).digest('hex').slice(0,40)+(tools?'-chat':'-summary');
}
