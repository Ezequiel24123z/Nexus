export const STATUS_LABELS = {
  queued: 'Queued',
  running: 'Working',
  approval: 'Approval needed',
  paused: 'Paused',
  failed: 'Needs review',
  complete: 'Completed',
};

export const PROVIDER_META = {
  openrouter: { name: 'OpenRouter', key: 'OPENROUTER_API_KEY', defaultModel: 'deepseek/deepseek-v4.1-flash', effort: 'none', hint: 'Unified router across 300+ models with prompt caching, routing priority, and web search.' },
  arliai: { name: 'Arli.ai', key: 'ARLIAI_API_KEY', defaultModel: 'arliai/DeepSeek-V4.1-Flash-1017', effort: 'max', hint: 'Dedicated uncensored/derestricted and high-context coding models.' },
  openai: { name: 'OpenAI', key: 'OPENAI_API_KEY', defaultModel: 'openai/gpt-5', effort: 'medium', hint: 'Direct OpenAI API for GPT-5, GPT-4.1, o3, and o4-mini.' },
  copilot: { name: 'GitHub Copilot', key: 'GITHUB_COPILOT_TOKEN', defaultModel: 'copilot/claude-sonnet-4.5', effort: 'medium', hint: 'GitHub Copilot with automatic OAuth token exchange via gh auth token.' },
  anthropic: { name: 'Anthropic', key: 'ANTHROPIC_API_KEY', defaultModel: 'anthropic/claude-sonnet-4-5', effort: 'medium', hint: 'Native Anthropic Messages API with prompt caching and extended thinking.' },
  deepseek: { name: 'DeepSeek Direct', key: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-direct/deepseek-chat', effort: 'none', hint: 'Direct DeepSeek V3 / R1 API.' },
  gemini: { name: 'Google Gemini', key: 'GEMINI_API_KEY', defaultModel: 'gemini/gemini-2.5-pro', effort: 'medium', hint: 'Google Gemini 2.5 Pro & Flash (1M context) via OpenAI-compatible API.' },
  xai: { name: 'xAI (Grok)', key: 'XAI_API_KEY', defaultModel: 'xai/grok-4', effort: 'medium', hint: 'Direct xAI Grok API.' },
  groq: { name: 'Groq', key: 'GROQ_API_KEY', defaultModel: 'groq/llama-3.3-70b-versatile', effort: 'none', hint: 'Ultra-low-latency Groq LPU inference.' },
  custom: { name: 'Custom / Local', key: 'CUSTOM_API_KEY', defaultModel: 'custom/qwen2.5-coder:32b', effort: 'none', hint: 'Any local or self-hosted OpenAI-compatible server (Ollama, LM Studio, vLLM, llama.cpp).' },
};

export function detectProviderId(model = '', customProviders = []) {
  const m = String(model || '');
  for (const cp of customProviders || []) {
    if (cp?.id && m.startsWith(cp.id + '/')) return cp.id;
  }
  if (m.startsWith('arliai/')) return 'arliai';
  if (m.startsWith('openai/')) return 'openai';
  if (m.startsWith('copilot/')) return 'copilot';
  if (m.startsWith('anthropic/')) return 'anthropic';
  if (m.startsWith('deepseek-direct/')) return 'deepseek';
  if (m.startsWith('gemini/')) return 'gemini';
  if (m.startsWith('xai/')) return 'xai';
  if (m.startsWith('groq/')) return 'groq';
  if (m.startsWith('custom/') || m.startsWith('local/')) return 'custom';
  return 'openrouter';
}

export function providerLabel(id, customProviders = []) {
  const custom = (customProviders || []).find(p => p.id === id);
  if (custom) return custom.name || custom.id;
  return PROVIDER_META[id]?.name || id;
}

export const formatMoney = v => (v == null ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(v));
export const formatCount = v => (v == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v));
export const formatPercent = v => (v == null ? '—' : (100 * v).toFixed(1) + '%');
export const formatPricePerM = v => {
  const n = Number(v);
  return Number.isFinite(n) ? '$' + (n * 1e6).toFixed(n * 1e6 < 0.01 ? 4 : 2) + '/M' : '—';
};
export const formatDuration = ms => (ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);
export const prettyJson = v => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
export const cleanError = e => String(e?.message || e || 'Unknown error').replace(/^Error invoking remote method .*?: /, '');

export const AUTONOMY_LEVELS = [
  { id: 'interactive', label: 'Interactive', short: 'Interactive', hint: 'Ask confirmation before every file edit, command, Git change, or external call.' },
  { id: 'semi-autopilot', label: 'Semi-Autopilot', short: 'Semi-Auto', hint: 'Auto-run safe workspace edits & reads; ask permission before risky commands, deletions, git push, or external mutations.' },
  { id: 'autopilot', label: 'Autopilot', short: 'Autopilot', hint: 'Execute engineering tasks autonomously end-to-end without routine interruption.' },
  { id: 'unrestricted', label: 'Unrestricted', short: 'Unrestricted', hint: 'Absolute autonomous permissions across your entire local Windows machine with zero limits.' },
];

export function normalizeAutonomyId(mode = 'autopilot') {
  if (['interactive', 'semi-autopilot', 'autopilot', 'unrestricted'].includes(mode)) return mode;
  if (mode === 'explore' || mode === 'architect') return 'interactive';
  return 'autopilot';
}

export const BUILTIN_SLASH_COMMANDS = [
  { command: '/compact', description: 'Compact conversation context into a lossless continuity checkpoint now', mode: null },
  { command: '/init', description: 'Scan workspace and create/update NEXUS.md', mode: 'agent' },
  { command: '/review', description: 'Inspect git diff & status and run a thorough code review', mode: 'explore' },
  { command: '/architect', description: 'Design a step-by-step architecture plan with todo checklist', mode: 'architect' },
  { command: '/diagnostics', description: 'Run syntax/JSON diagnostics and fix reported issues', mode: 'agent' },
  { command: '/explain', description: 'Explain architecture and modules with file/line citations', mode: 'explore' },
  { command: '/fix', description: 'Investigate root cause, implement fix, and verify with tests', mode: 'agent' },
  { command: '/test', description: 'Run test suite, diagnose failures, and add focused tests', mode: 'agent' },
  { command: '/mcp-create', description: 'Scaffold and hot-connect a new local MCP server', mode: 'agent' },
  { command: '/self-improve', description: 'Analyze workspace telemetry and synthesize reusable skills', mode: 'agent' },
];
