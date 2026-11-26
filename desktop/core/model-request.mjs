import crypto from 'node:crypto';
import {baseTools, READ_ONLY_TOOL_NAMES, CORE_TOOL_NAMES, TOOLSET_GROUPS} from './tools.mjs';
import {modelConnection} from './providers.mjs';

export function requestTools(settings = {}, pluginManager = null, activeToolsets = null) {
  const mode = settings.agentMode || 'autopilot';
  const disabled = new Set(Array.isArray(settings.disabledTools) ? settings.disabledTools : []);
  const lazy = settings.lazyToolLoading === true;
  const loadedSet = new Set(Array.isArray(activeToolsets) ? activeToolsets : []);
  const loadAll = loadedSet.has('all');

  let allowedNames = null;
  if (lazy && !loadAll) {
    allowedNames = new Set(CORE_TOOL_NAMES);
    for (const group of loadedSet) {
      const members = TOOLSET_GROUPS[group];
      if (members) for (const m of members) allowedNames.add(m);
    }
  }

  let local = baseTools.filter(tool => {
    const name = tool.function.name;
    if (disabled.has(name)) return false;
    if (!lazy && name === 'load_toolset') return false;
    if (!settings.desktopEnabled && name.startsWith('desktop_')) return false;
    if (allowedNames && !allowedNames.has(name)) return false;
    return true;
  });

  if (pluginManager && (!lazy || loadAll || loadedSet.has('plugins'))) {
    local = [...local, ...pluginManager.getToolSchemas(disabled)];
  }
  if (mode === 'explore') {
    local = local.filter(tool => READ_ONLY_TOOL_NAMES.has(tool.function.name) || pluginManager?.findTool(tool.function.name)?.tool?.readOnly);
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

