import crypto from 'node:crypto';
import {baseTools, READ_ONLY_TOOL_NAMES} from './tools.mjs';
import {modelConnection} from './providers.mjs';

export function requestTools(settings = {}) {
  const mode = settings.agentMode || 'agent';
  let local = baseTools.filter(tool => settings.desktopEnabled || !tool.function.name.startsWith('desktop_'));
  if (mode === 'explore') {
    local = local.filter(tool => READ_ONLY_TOOL_NAMES.has(tool.function.name));
  } else if (mode === 'architect') {
    local = local.filter(tool => READ_ONLY_TOOL_NAMES.has(tool.function.name) || ['todo_write', 'document_progress', 'memory_store'].includes(tool.function.name));
  }
  if (!settings.webSearchEnabled || modelConnection(settings.model, settings).id !== 'openrouter') return local;
  return [...local, { type: 'openrouter:web_search', parameters: { engine: settings.webSearchEngine, max_results: settings.webMaxResults, search_context_size: settings.webSearchContext, ...(settings.webMaxUses > 0 ? { max_uses: settings.webMaxUses } : {}) } }];
}
export function affinitySession(task,tools=true) {
  // Opaque, stable across restart; never send paths, titles, prompts or key material.
  return 'nexus-'+crypto.createHash('sha256').update(String(task.id)).digest('hex').slice(0,40)+(tools?'-chat':'-summary');
}
