// Model classification engine: maps every model across all providers to
// Freedom (Restrictions) tier, Capability tags, Quality score, and Cost tier.
import { detectProviderId } from './format.mjs';

export const FREEDOM_TIERS = [
  { id: 'all', label: 'Any Restrictions', short: 'Any', rank: 99 },
  { id: 'unrestricted', label: 'Unrestricted (0% filters)', short: 'Unrestricted', rank: 0, color: 'ok' },
  { id: 'minimal', label: 'Minimal (DeepSeek / Grok / Mistral)', short: 'Minimal', rank: 1, color: 'ok' },
  { id: 'low', label: 'Low (GLM / Qwen / Llama / Kimi)', short: 'Low', rank: 2, color: 'info' },
  { id: 'moderate', label: 'Moderate (Gemini / OpenAI)', short: 'Moderate', rank: 3, color: 'warn' },
  { id: 'standard', label: 'Standard (Claude / Enterprise)', short: 'Standard', rank: 4, color: '' },
];

export const CAPABILITY_FILTERS = [
  { id: 'all', label: 'All Models' },
  { id: 'frontier', label: 'Frontier' },
  { id: 'coding', label: 'Coding' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'fast', label: 'Fast' },
  { id: 'vision', label: 'Vision' },
  { id: 'long', label: '200K+ Ctx' },
  { id: 'budget', label: 'Budget / Free' },
];

export const OPENROUTER_UPSTREAMS = [
  'DeepInfra', 'Together', 'Fireworks', 'Novita', 'Groq', 'Cerebras',
  'Chutes', 'Nebius', 'Anthropic', 'OpenAI', 'Google', 'xAI', 'DeepSeek', 'SiliconFlow',
];

export function classifyModel(model, customProviders = []) {
  const id = String(model?.id || '');
  const lower = (id + ' ' + (model?.name || '') + ' ' + (model?.description || '')).toLowerCase();
  const provider = detectProviderId(id, customProviders);

  // 1. Freedom / restriction tier heuristic
  let freedom = 'moderate';
  if (
    provider === 'arliai' ||
    provider === 'custom' ||
    (customProviders || []).some(p => p.id === provider) ||
    /(derestricted|uncensored|abliterated|dolphin|venice|midnight|euryale|lumimaid|magnum|eva-|mythomax|hermes-3|hermes-4)/i.test(lower)
  ) {
    freedom = 'unrestricted';
  } else if (/(deepseek|grok|mistral|mixtral|codestral|devstral|nousresearch)/i.test(lower)) {
    freedom = 'minimal';
  } else if (/(glm|z-ai|qwen|llama|kimi|moonshot|minimax|yi-|command-r|mimo|stepfun)/i.test(lower)) {
    freedom = 'low';
  } else if (/(claude|anthropic)/i.test(lower)) {
    freedom = 'standard';
  } else if (/(gemini|openai|gpt-|o1|o3|o4)/i.test(lower)) {
    freedom = 'moderate';
  }

  // 2. Price calculation (prompt $/1M tokens)
  const promptPrice = Number(model?.pricing?.prompt);
  const promptPerM = Number.isFinite(promptPrice) ? promptPrice * 1e6 : null;
  const isFree = promptPerM === 0 || lower.includes(':free');
  const isBudget = isFree || (promptPerM !== null && promptPerM <= 0.6);

  // 3. Capabilities
  const caps = new Set();
  if (model?.vision) caps.add('vision');
  if (model?.tools !== false) caps.add('tools');
  if (model?.reasoning || /(r1|reasoner|thinking|o1|o3|o4|qwq|deepseek-v4|claude-opus|claude-sonnet-4|gpt-5|grok-4|gemini-2\.5)/i.test(lower)) {
    caps.add('reasoning');
  }
  if (/(coder|codestral|devstral|deepseek|claude-sonnet|claude-opus|gpt-5|gpt-4\.1|qwen.*coder|qwen3|glm-4|grok-code|gemini-2\.5-pro|kimi)/i.test(lower)) {
    caps.add('coding');
  }
  if (/(opus-4|sonnet-4\.5|gpt-5(?!-mini|-nano)|o3(?!-mini)|deepseek-v4|deepseek-r1|deepseek-v3\.2|gemini-2\.5-pro|grok-4|qwen3-235|glm-4\.6|glm-4\.5|kimi-k2)/i.test(lower)) {
    caps.add('frontier');
  }
  if (/(flash|mini|haiku|fast|nano|instant|turbo|groq|8b|7b|14b|32b)/i.test(lower) || provider === 'groq') {
    caps.add('fast');
  }
  if (Number(model?.context || 0) >= 200000) caps.add('long');
  if (isBudget) caps.add('budget');

  // 4. Quality / intelligence rank score (higher = stronger)
  let quality = 50;
  if (caps.has('frontier')) quality += 35;
  if (caps.has('coding')) quality += 12;
  if (caps.has('reasoning')) quality += 10;
  if (caps.has('long')) quality += 5;
  if (caps.has('vision')) quality += 3;
  if (model?.tools === false) quality -= 25;
  if (/(deepseek-v4|claude-opus-4\.5|claude-sonnet-4\.5|gpt-5(?!-mini)|gemini-2\.5-pro|grok-4|glm-4\.6)/i.test(lower)) quality += 10;

  const freedomMeta = FREEDOM_TIERS.find(f => f.id === freedom) || FREEDOM_TIERS[4];

  return {
    ...model,
    provider,
    freedom,
    freedomRank: freedomMeta.rank,
    freedomLabel: freedomMeta.short,
    freedomColor: freedomMeta.color,
    caps,
    promptPerM,
    isFree,
    quality,
  };
}

// Strict per-provider & per-enabled-models filter shared across Model Picker, Settings, Automations, and Arena.
// Never mixes models from other providers (e.g. OpenRouter) into the active provider's menu.
export function filterModelsForProvider(models = [], settings = {}, providerId = '', { activeModelId = '', includeAllOfProvider = false } = {}) {
  const customProviders = settings?.customProviders || [];
  const targetProvider = providerId || detectProviderId(activeModelId || settings?.model || '', customProviders);
  const enabledList = Array.isArray(settings?.enabledModels?.[targetProvider]) ? settings.enabledModels[targetProvider] : [];
  const enabledSet = new Set(enabledList);
  const activeProv = activeModelId ? detectProviderId(activeModelId, customProviders) : '';

  const providerModels = (models || []).filter(m => detectProviderId(m?.id, customProviders) === targetProvider);
  if (includeAllOfProvider || enabledSet.size === 0) {
    return providerModels;
  }
  return providerModels.filter(m => enabledSet.has(m.id) || (activeProv === targetProvider && m.id === activeModelId));
}

export function filterModelsForConfiguredProviders(models = [], settings = {}, providerKeys = {}) {
  const customProviders = settings?.customProviders || [];
  const activeProvider = detectProviderId(settings?.model || '', customProviders);
  const configured = new Set([activeProvider]);
  for (const [pid, ok] of Object.entries(providerKeys || {})) {
    if (ok) configured.add(pid);
  }
  const out = [];
  for (const pid of configured) {
    out.push(...filterModelsForProvider(models, settings, pid, { activeModelId: settings?.model || '' }));
  }
  const seen = new Set();
  return out.filter(m => {
    if (!m?.id || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}
