import crypto from 'node:crypto';

export const MEMORY_CATEGORIES = ['priority', 'preference', 'constraint', 'workflow', 'profile', 'fact'];
export const MEMORY_PRIORITIES = ['critical', 'high', 'normal', 'low'];

export const CATEGORY_LABELS = {
  constraint: 'Hard Constraints & Boundaries',
  priority: 'Active User Priorities & Goals',
  preference: 'User Preferences & Working Style',
  profile: 'User Profile & Context',
  workflow: 'Workflows & Conventions',
  fact: 'Saved Facts & Project Knowledge',
};

const PRIORITY_WEIGHT = { critical: 4, high: 3, normal: 2, low: 1 };
const CATEGORY_ORDER = { constraint: 0, priority: 1, preference: 2, profile: 3, workflow: 4, fact: 5 };

function cleanTags(tags) {
  if (typeof tags === 'string') {
    tags = tags.split(',').map(t => t.trim());
  }
  if (!Array.isArray(tags)) return [];
  return [...new Set(
    tags
      .map(t => String(t || '').trim().toLowerCase().replace(/[^a-z0-9_.:/-]+/g, '-').slice(0, 40))
      .filter(Boolean)
  )].slice(0, 12);
}

export function normalizeMemory(raw = {}) {
  const now = new Date().toISOString();
  const scope = raw.scope === 'project' ? 'project' : 'global';
  const category = MEMORY_CATEGORIES.includes(raw.category) ? raw.category : 'fact';
  const priority = MEMORY_PRIORITIES.includes(raw.priority)
    ? raw.priority
    : (category === 'constraint' || category === 'priority' ? 'high' : 'normal');
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : crypto.randomUUID(),
    key: String(raw.key || '').trim().slice(0, 120),
    value: String(raw.value || '').trim().slice(0, 4000),
    category,
    priority,
    scope,
    workspace: scope === 'project' ? String(raw.workspace || '').trim() : '',
    tags: cleanTags(raw.tags),
    pinned: Boolean(raw.pinned),
    source: raw.source === 'agent' ? 'agent' : 'user',
    useCount: Number.isInteger(raw.useCount) && raw.useCount >= 0 ? raw.useCount : 0,
    lastUsedAt: raw.lastUsedAt || null,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

export function normalizeMemories(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(m => m && typeof m === 'object' && m.key && m.value).map(normalizeMemory);
}

export function sortMemories(list = []) {
  return [...list].sort((a, b) => {
    const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinDiff !== 0) return pinDiff;
    const prioDiff = (PRIORITY_WEIGHT[b.priority] || 2) - (PRIORITY_WEIGHT[a.priority] || 2);
    if (prioDiff !== 0) return prioDiff;
    const catDiff = (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9);
    if (catDiff !== 0) return catDiff;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}

export function upsertMemory(list, input = {}, { defaultScope = 'global', defaultWorkspace = '', defaultSource = 'user' } = {}) {
  const key = String(input.key || '').trim();
  const value = String(input.value || '').trim();
  if (!key || !value) throw new Error('Memory requires both a non-empty key and value.');
  const scope = input.scope === 'project' ? 'project' : (input.scope === 'global' ? 'global' : defaultScope);
  const workspace = scope === 'project' ? String(input.workspace !== undefined ? input.workspace : defaultWorkspace).trim() : '';
  const now = new Date().toISOString();

  const existing = list.find(m =>
    (input.id && m.id === input.id) ||
    (m.key.toLowerCase() === key.toLowerCase() && m.scope === scope && (m.workspace || '') === workspace)
  );

  if (existing) {
    const nextCategory = input.category !== undefined && MEMORY_CATEGORIES.includes(input.category) ? input.category : (existing.category || 'fact');
    const nextPriority = input.priority !== undefined && MEMORY_PRIORITIES.includes(input.priority) ? input.priority : (existing.priority || 'normal');
    Object.assign(existing, normalizeMemory({
      ...existing,
      key,
      value,
      category: nextCategory,
      priority: nextPriority,
      scope,
      workspace,
      tags: input.tags !== undefined ? cleanTags(input.tags) : existing.tags,
      pinned: input.pinned !== undefined ? Boolean(input.pinned) : existing.pinned,
      source: input.source || existing.source || defaultSource,
      updatedAt: now,
    }));
    return { memory: existing, updated: true };
  }

  const created = normalizeMemory({
    ...input,
    id: input.id || crypto.randomUUID(),
    key,
    value,
    scope,
    workspace,
    source: input.source || defaultSource,
    createdAt: now,
    updatedAt: now,
  });
  list.push(created);
  return { memory: created, updated: false };
}

export function removeMemory(list, { id, key, workspace = '' } = {}) {
  const before = list.length;
  const keyLower = String(key || '').trim().toLowerCase();
  const kept = list.filter(m => {
    if (id && m.id === id) return false;
    if (!id && keyLower && m.key.toLowerCase() === keyLower && (m.scope === 'global' || !workspace || m.workspace === workspace)) return false;
    return true;
  });
  return { memories: kept, removed: before - kept.length };
}

export function searchMemories(list = [], { query = '', category = 'all', priority = 'all', scope = 'all', workspace = '', includeOtherProjects = false, limit = 50 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const scored = [];

  for (const raw of list) {
    const m = normalizeMemory(raw);
    if (!includeOtherProjects && scope === 'all' && m.scope === 'project' && workspace && m.workspace && m.workspace.toLowerCase() !== workspace.toLowerCase()) continue;
    if (scope === 'global' && m.scope !== 'global') continue;
    if (scope === 'project' && (m.scope !== 'project' || (workspace && m.workspace && m.workspace.toLowerCase() !== workspace.toLowerCase()))) continue;
    if (category && category !== 'all' && m.category !== category) continue;
    if (priority && priority !== 'all' && m.priority !== priority) continue;

    let score = (m.pinned ? 20 : 0) + (PRIORITY_WEIGHT[m.priority] || 2) * 4;
    if (tokens.length) {
      const hay = `${m.key} ${m.value} ${m.category} ${(m.tags || []).join(' ')}`.toLowerCase();
      if (!tokens.every(tok => hay.includes(tok))) continue;
      for (const tok of tokens) {
        if (m.key.toLowerCase().includes(tok)) score += 10;
        if ((m.tags || []).some(t => t.includes(tok))) score += 6;
        if (m.value.toLowerCase().includes(tok)) score += 4;
      }
    }
    scored.push({ memory: m, score });
  }

  scored.sort((a, b) => b.score - a.score || String(b.memory.updatedAt).localeCompare(String(a.memory.updatedAt)));
  return scored.slice(0, Math.max(1, Math.min(Number(limit) || 50, 200))).map(x => x.memory);
}

export function selectMemoriesForContext(list = [], { workspace = '', maxItems = 40, maxChars = 7000 } = {}) {
  const wsLower = String(workspace || '').trim().toLowerCase();
  const eligible = list
    .map(normalizeMemory)
    .filter(m => m.scope === 'global' || (wsLower && m.workspace && m.workspace.toLowerCase() === wsLower));

  const sorted = sortMemories(eligible);
  const selected = [];
  let usedChars = 0;

  for (const m of sorted) {
    if (selected.length >= maxItems) break;
    const cost = m.key.length + m.value.length + 32;
    const alwaysInclude = m.pinned || m.priority === 'critical' || m.category === 'constraint';
    if (!alwaysInclude && usedChars + cost > maxChars) continue;
    selected.push(m);
    usedChars += cost;
  }
  return selected;
}

export function formatMemoriesForPrompt(memories = []) {
  if (!memories.length) return '';
  const grouped = new Map();
  for (const m of memories) {
    const cat = MEMORY_CATEGORIES.includes(m.category) ? m.category : 'fact';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat).push(m);
  }
  const orderedCats = [...grouped.keys()].sort((a, b) => (CATEGORY_ORDER[a] ?? 9) - (CATEGORY_ORDER[b] ?? 9));
  const lines = [];
  for (const cat of orderedCats) {
    lines.push(`### ${CATEGORY_LABELS[cat] || cat}`);
    for (const m of grouped.get(cat)) {
      const badges = [];
      if (m.pinned) badges.push('PINNED');
      if (m.priority === 'critical' || m.priority === 'high') badges.push(m.priority.toUpperCase());
      if (m.scope === 'project') badges.push('project');
      const prefix = badges.length ? `[${badges.join(' · ')}] ` : '';
      const tagSuffix = m.tags?.length ? ` (#${m.tags.join(' #')})` : '';
      lines.push(`- ${prefix}**${m.key}**: ${m.value}${tagSuffix}`);
    }
  }
  return lines.join('\n');
}

export function exportMemoriesMarkdown(list = []) {
  const normalized = sortMemories(normalizeMemories(list));
  const header = `# NEXUS User Memory & Preference Profile\n\nExported: ${new Date().toISOString()} (${normalized.length} entries)\n\n`;
  if (!normalized.length) return header + '_No memories stored._\n';
  return header + formatMemoriesForPrompt(normalized) + '\n';
}

export function importMemoriesJson(list, rawJson) {
  const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  const entries = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.memories) ? parsed.memories : null);
  if (!entries) throw new Error('Expected a JSON array of memory entries or { "memories": [...] }.');
  let imported = 0, updated = 0;
  for (const item of entries.slice(0, 500)) {
    if (!item || !item.key || !item.value) continue;
    const res = upsertMemory(list, item);
    if (res.updated) updated++;
    else imported++;
  }
  return { imported, updated, total: list.length };
}
