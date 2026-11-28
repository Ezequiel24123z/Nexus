// Namespaced model IDs keep the provider attached to each chat, including after restart.
import {isNetworkFailure,networkFailure,providerHttpFailure} from './provider-errors.mjs';

export const arliModel = 'arliai/DeepSeek-V4.1-Flash-1017';

export const PROVIDERS = [
  { id: 'openrouter', name: 'OpenRouter', key: 'OPENROUTER_API_KEY', base: 'https://openrouter.ai/api/v1', prefix: '', apiFormat: 'openai' },
  { id: 'yeta', name: 'Yeta Labs', key: 'YETA_API_KEY', base: 'https://platform.yeta.ai/v1', prefix: 'yeta/', apiFormat: 'openai' },
  { id: 'arliai', name: 'Arli.ai', key: 'ARLIAI_API_KEY', base: 'https://api.arliai.com/v1', prefix: 'arliai/', apiFormat: 'openai' },
  { id: 'openai', name: 'OpenAI', key: 'OPENAI_API_KEY', base: 'https://api.openai.com/v1', prefix: 'openai/', apiFormat: 'openai' },
  { id: 'copilot', name: 'GitHub Copilot', key: 'GITHUB_COPILOT_TOKEN', base: 'https://api.githubcopilot.com', prefix: 'copilot/', apiFormat: 'openai' },
  { id: 'anthropic', name: 'Anthropic', key: 'ANTHROPIC_API_KEY', base: 'https://api.anthropic.com/v1', prefix: 'anthropic/', apiFormat: 'anthropic' },
  { id: 'deepseek', name: 'DeepSeek Direct', key: 'DEEPSEEK_API_KEY', base: 'https://api.deepseek.com/v1', prefix: 'deepseek-direct/', apiFormat: 'openai' },
  { id: 'gemini', name: 'Google Gemini', key: 'GEMINI_API_KEY', base: 'https://generativelanguage.googleapis.com/v1beta/openai', prefix: 'gemini/', apiFormat: 'openai' },
  { id: 'xai', name: 'xAI (Grok)', key: 'XAI_API_KEY', base: 'https://api.x.ai/v1', prefix: 'xai/', apiFormat: 'openai' },
  { id: 'groq', name: 'Groq', key: 'GROQ_API_KEY', base: 'https://api.groq.com/openai/v1', prefix: 'groq/', apiFormat: 'openai' },
  { id: 'custom', name: 'Custom / Local', key: 'CUSTOM_API_KEY', base: 'http://localhost:11434/v1', prefix: 'custom/', optionalKey: true, apiFormat: 'openai' },
];

export const SECRET_KEYS = [
  'YETA_API_KEY',
  'ARLIAI_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MANAGEMENT_KEY',
  'OPENAI_API_KEY',
  'GITHUB_COPILOT_TOKEN',
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'GEMINI_API_KEY',
  'XAI_API_KEY',
  'GROQ_API_KEY',
  'CUSTOM_API_KEY',
];

// In-memory cache for short-lived GitHub Copilot session tokens exchanged from GitHub OAuth tokens.
const copilotTokenCache = new Map();

export async function resolveCopilotAuth(rawToken, { request = fetch, base = 'https://api.githubcopilot.com' } = {}) {
  const token = String(rawToken || '').trim();
  if (!token) throw new Error('Add your GitHub Copilot API key in Settings.');
  const isGithubOAuth = /^(gho_|ghu_|ghp_|github_pat_)/.test(token);
  if (!isGithubOAuth) return { token, base };
  const cached = copilotTokenCache.get(token);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return { token: cached.token, base: cached.base || base };
  }
  const response = await request('https://api.github.com/copilot_internal/v2/token', {
    method: 'GET',
    headers: {
      Authorization: 'token ' + token,
      Accept: 'application/json',
      'User-Agent': 'NEXUS-Desktop/1.2',
      'Editor-Version': 'vscode/1.99.0',
      'Editor-Plugin-Version': 'copilot-chat/0.26.0',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    // Allow direct fallback if user uses GitHub Models or a proxy endpoint that accepts gh tokens directly.
    if (base !== 'https://api.githubcopilot.com') return { token, base };
    throw providerHttpFailure(response.status, 'GitHub Copilot');
  }
  const data = await response.json();
  if (!data?.token) throw new Error('GitHub Copilot token exchange returned no session token.');
  const expiresAt = typeof data.expires_at === 'number' ? data.expires_at * 1000 : Date.now() + 20 * 60 * 1000;
  const endpoint = data.endpoints?.api ? String(data.endpoints.api).replace(/\/+$/, '') : base;
  copilotTokenCache.set(token, { token: data.token, base: endpoint, expiresAt });
  return { token: data.token, base: endpoint };
}

export function clearCopilotTokenCache() {
  copilotTokenCache.clear();
}

export function allProviders(settings = {}) {
  const builtinIds = new Set(PROVIDERS.map(p => p.id));
  const extras = Array.isArray(settings?.customProviders)
    ? settings.customProviders
        .filter(p => p && typeof p.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(p.id) && typeof p.baseUrl === 'string' && p.baseUrl.trim() && !builtinIds.has(p.id.toLowerCase()))
        .map(p => ({
          id: p.id.toLowerCase(),
          name: String(p.name || p.id),
          key: p.keyName || ('PROVIDER_' + p.id.toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '_KEY'),
          base: String(p.baseUrl).trim().replace(/\/+$/, ''),
          prefix: p.id.toLowerCase() + '/',
          optionalKey: p.optionalKey !== false,
          apiFormat: p.apiFormat === 'anthropic' ? 'anthropic' : 'openai',
          headers: p.headers && typeof p.headers === 'object' ? p.headers : {},
          defaultModel: p.defaultModel || '',
          custom: true,
        }))
    : [];
  return [...PROVIDERS, ...extras];
}

export function modelConnection(model = '', settings = {}) {
  const value = String(model || '');
  if (Array.isArray(settings?.customProviders)) {
    for (const p of allProviders(settings).filter(item => item.custom)) {
      if (value.startsWith(p.prefix)) {
        return {
          id: p.id,
          name: p.name,
          key: p.key,
          base: p.base,
          model: value.slice(p.prefix.length),
          optionalKey: p.optionalKey,
          apiFormat: p.apiFormat,
          headers: p.headers,
          custom: true,
        };
      }
    }
  }
  if (value.startsWith('yeta/')) return { id: 'yeta', name: 'Yeta Labs', key: 'YETA_API_KEY', base: 'https://platform.yeta.ai/v1', model: value.slice(5), apiFormat: 'openai' };
  if (value.startsWith('arliai/')) return { id: 'arliai', name: 'Arli.ai', key: 'ARLIAI_API_KEY', base: 'https://api.arliai.com/v1', model: value.slice(7), apiFormat: 'openai' };
  if (value.startsWith('openai/')) return { id: 'openai', name: 'OpenAI', key: 'OPENAI_API_KEY', base: 'https://api.openai.com/v1', model: value.slice(7), apiFormat: 'openai' };
  if (value.startsWith('copilot/')) return { id: 'copilot', name: 'GitHub Copilot', key: 'GITHUB_COPILOT_TOKEN', base: settings?.copilotBaseUrl || 'https://api.githubcopilot.com', model: value.slice(8), apiFormat: 'openai' };
  if (value.startsWith('anthropic/')) return { id: 'anthropic', name: 'Anthropic', key: 'ANTHROPIC_API_KEY', base: 'https://api.anthropic.com/v1', model: value.slice(10), apiFormat: 'anthropic' };
  if (value.startsWith('deepseek-direct/')) return { id: 'deepseek', name: 'DeepSeek Direct', key: 'DEEPSEEK_API_KEY', base: 'https://api.deepseek.com/v1', model: value.slice(16), apiFormat: 'openai' };
  if (value.startsWith('gemini/')) return { id: 'gemini', name: 'Google Gemini', key: 'GEMINI_API_KEY', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: value.slice(7), apiFormat: 'openai' };
  if (value.startsWith('xai/')) return { id: 'xai', name: 'xAI (Grok)', key: 'XAI_API_KEY', base: 'https://api.x.ai/v1', model: value.slice(4), apiFormat: 'openai' };
  if (value.startsWith('groq/')) return { id: 'groq', name: 'Groq', key: 'GROQ_API_KEY', base: 'https://api.groq.com/openai/v1', model: value.slice(5), apiFormat: 'openai' };
  if (value.startsWith('custom/') || value.startsWith('local/')) {
    const raw = value.startsWith('custom/') ? value.slice(7) : value.slice(6);
    const base = String(settings?.customBaseUrl || 'http://localhost:11434/v1').replace(/\/+$/, '');
    return { id: 'custom', name: 'Custom / Local', key: 'CUSTOM_API_KEY', base, model: raw, optionalKey: true, apiFormat: 'openai' };
  }
  const clean = value.startsWith('openrouter/') ? value.slice(11) : value;
  return { id: 'openrouter', name: 'OpenRouter', key: 'OPENROUTER_API_KEY', base: 'https://openrouter.ai/api/v1', model: clean, apiFormat: 'openai' };
}

function toAnthropicContentBlocks(content) {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  const blocks = [];
  for (const part of content) {
    if (!part) continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_url' && typeof part.image_url?.url === 'string') {
      const match = /^data:([^;,]+);base64,(.+)$/.exec(part.image_url.url);
      if (match) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
      }
    }
  }
  return blocks;
}

export function buildAnthropicPayload({ connection, messages = [], settings = {}, tools, outputLimit, effort }) {
  const systemBlocks = [];
  const converted = [];
  for (const msg of messages) {
    if (!msg) continue;
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
      if (text.trim()) systemBlocks.push({ type: 'text', text });
      continue;
    }
    if (msg.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id || 'tool_call',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''),
      };
      const prev = converted.at(-1);
      if (prev && prev.role === 'user' && Array.isArray(prev.content)) prev.content.push(block);
      else converted.push({ role: 'user', content: [block] });
      continue;
    }
    if (msg.role === 'assistant') {
      const blocks = toAnthropicContentBlocks(msg.content);
      if (Array.isArray(msg.tool_calls)) {
        for (const call of msg.tool_calls) {
          let input = {};
          try { input = JSON.parse(call.function?.arguments || '{}'); } catch { input = {}; }
          blocks.push({ type: 'tool_use', id: call.id || 'call_' + blocks.length, name: call.function?.name || 'tool', input });
        }
      }
      if (blocks.length) converted.push({ role: 'assistant', content: blocks });
      continue;
    }
    const blocks = toAnthropicContentBlocks(msg.content);
    if (!blocks.length) continue;
    const content = blocks.length === 1 && blocks[0].type === 'text' ? blocks[0].text : blocks;
    const prev = converted.at(-1);
    if (prev && prev.role === 'user') {
      const prevBlocks = Array.isArray(prev.content) ? prev.content : [{ type: 'text', text: String(prev.content) }];
      prev.content = [...prevBlocks, ...(Array.isArray(content) ? content : [{ type: 'text', text: String(content) }])];
    } else {
      converted.push({ role: 'user', content });
    }
  }
  const enableCache = settings.promptCaching !== false;
  if (enableCache && systemBlocks.length > 0) {
    systemBlocks[systemBlocks.length - 1] = { ...systemBlocks[systemBlocks.length - 1], cache_control: { type: 'ephemeral' } };
  }
  if (enableCache && converted.length >= 2) {
    const target = converted[converted.length - 2];
    if (typeof target.content === 'string') {
      target.content = [{ type: 'text', text: target.content, cache_control: { type: 'ephemeral' } }];
    } else if (Array.isArray(target.content) && target.content.length) {
      target.content[target.content.length - 1] = { ...target.content[target.content.length - 1], cache_control: { type: 'ephemeral' } };
    }
  }
  const level = effort || settings.reasoningEffort || 'none';
  const budgetMap = { minimal: 1024, low: 2048, medium: 6000, high: 12000, xhigh: 20000, max: 32000 };
  const thinkingBudget = budgetMap[level] || 0;
  const maxTokens = outputLimit > 0
    ? Math.max(outputLimit, thinkingBudget ? thinkingBudget + 2048 : outputLimit)
    : (thinkingBudget ? Math.max(16384, thinkingBudget + 8192) : 16384);

  const anthropicTools = Array.isArray(tools) && tools.length
    ? tools.filter(t => t?.type === 'function' && t.function).map(t => ({
        name: t.function.name,
        description: t.function.description || '',
        input_schema: t.function.parameters || { type: 'object', properties: {} },
      }))
    : undefined;
  if (enableCache && anthropicTools?.length) {
    anthropicTools[anthropicTools.length - 1] = { ...anthropicTools[anthropicTools.length - 1], cache_control: { type: 'ephemeral' } };
  }

  const body = {
    model: connection.model,
    max_tokens: maxTokens,
    stream: Boolean(settings.streaming),
    ...(systemBlocks.length ? { system: systemBlocks } : {}),
    messages: converted.length ? converted : [{ role: 'user', content: 'Continue.' }],
    ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
    ...(thinkingBudget ? { thinking: { type: 'enabled', budget_tokens: thinkingBudget } } : {}),
  };

  if (typeof settings.temperature === 'number' && Number.isFinite(settings.temperature) && !thinkingBudget) {
    body.temperature = settings.temperature;
  }
  if (typeof settings.topP === 'number' && Number.isFinite(settings.topP) && !thinkingBudget) {
    body.top_p = settings.topP;
  }
  if (settings.extraBody && typeof settings.extraBody === 'object' && !Array.isArray(settings.extraBody)) {
    Object.assign(body, settings.extraBody);
  }
  return body;
}

export function completionRequest({ model, messages, settings = {}, tools, outputLimit, effort, sessionId, apiKey }) {
  const connection = modelConnection(model, settings);
  const { id } = connection;
  const isOpenRouter = id === 'openrouter';
  const isArli = id === 'arliai';
  const isOpenAI = id === 'openai';
  const isCopilot = id === 'copilot';
  const isAnthropic = connection.apiFormat === 'anthropic';
  const level = effort || settings.reasoningEffort || 'none';

  if (isAnthropic) {
    const body = buildAnthropicPayload({ connection, messages, settings, tools, outputLimit, effort });
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      ...(connection.headers || {}),
      ...(settings.extraHeaders && typeof settings.extraHeaders === 'object' ? settings.extraHeaders : {}),
    };
    return { connection, apiFormat: 'anthropic', url: connection.base + '/messages', body, headers };
  }

  const useMaxCompletionTokens = isArli || isOpenAI || isCopilot || id === 'yeta';
  const tokenField = outputLimit > 0 ? { [useMaxCompletionTokens ? 'max_completion_tokens' : 'max_tokens']: outputLimit } : {};

  let reasoningField = {};
  if (level !== 'auto') {
    if (isArli) {
      reasoningField = { reasoning_effort: level, include_reasoning: false };
    } else if (isOpenRouter) {
      reasoningField = { reasoning: { effort: level } };
    } else if (id === 'yeta') {
      const m = connection.model.toLowerCase();
      if (!/(gpt-image|seedream|imagen|flux)/i.test(m)) {
        const allowed = /kimi/.test(m)
          ? ['low', 'high', 'max']
          : /glm/.test(m)
            ? ['none', 'low', 'medium', 'high', 'xhigh', 'max']
            : ['none', 'low', 'high', 'xhigh', 'max'];
        let mapped = level;
        if (!allowed.includes(mapped)) {
          if (['none', 'minimal'].includes(mapped)) mapped = allowed.includes('none') ? 'none' : 'low';
          else if (mapped === 'medium') mapped = 'high';
          else if (['xhigh', 'max'].includes(mapped)) mapped = allowed.includes('max') ? 'max' : 'high';
          else mapped = allowed[1] || 'high';
        }
        reasoningField = { reasoning_effort: mapped };
      }
    } else if ((isOpenAI || isCopilot || id === 'xai') && !['none', 'minimal'].includes(level)) {
      const mapped = ['xhigh', 'max'].includes(level) ? 'high' : level;
      reasoningField = { reasoning_effort: mapped };
    }
  }

  let toolsField = {};
  const openRouterOrder = Array.isArray(settings.providerOrder) && settings.providerOrder.length ? settings.providerOrder : null;
  if (tools && tools.length) {
    if (isOpenRouter) {
      toolsField = {
        tools,
        provider: {
          require_parameters: true,
          ...(settings.providerRouting && settings.providerRouting !== 'auto' ? { sort: settings.providerRouting } : {}),
          ...(openRouterOrder ? { order: openRouterOrder } : {}),
        },
      };
    } else {
      toolsField = { tools, tool_choice: 'auto' };
    }
  } else if (isOpenRouter && ((settings.providerRouting && settings.providerRouting !== 'auto') || openRouterOrder)) {
    toolsField = {
      provider: {
        ...(settings.providerRouting && settings.providerRouting !== 'auto' ? { sort: settings.providerRouting } : {}),
        ...(openRouterOrder ? { order: openRouterOrder } : {}),
      },
    };
  }

  const streamUsage = (isArli || isOpenAI || isCopilot || id === 'deepseek' || id === 'gemini' || id === 'xai' || id === 'groq' || id === 'yeta') && settings.streaming ? { stream_options: { include_usage: true } } : {};
  const affinity = isOpenRouter && sessionId ? { session_id: sessionId } : (isOpenAI && sessionId ? { prompt_cache_key: sessionId } : {});

  // Apply OpenRouter explicit ephemeral cache breakpoints for Claude / Gemini models when promptCaching is active
  let finalMessages = messages;
  if (settings.promptCaching !== false && isOpenRouter && /^(anthropic|google)\//i.test(connection.model) && Array.isArray(messages) && messages.length) {
    const withBreakpoint = msg => {
      if (!msg) return msg;
      if (typeof msg.content === 'string' && msg.content.length >= 256) {
        return { ...msg, content: [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }] };
      }
      if (Array.isArray(msg.content) && msg.content.length) {
        const clone = msg.content.map(p => (p && typeof p === 'object' ? { ...p } : p));
        const lastIdx = clone.length - 1;
        if (clone[lastIdx]?.type === 'text') clone[lastIdx].cache_control = { type: 'ephemeral' };
        return { ...msg, content: clone };
      }
      return msg;
    };
    finalMessages = messages.map((m, idx) => {
      if (idx === 0 && m?.role === 'system') return withBreakpoint(m);
      if (messages.length >= 4 && idx === messages.length - 2 && m?.role !== 'system') return withBreakpoint(m);
      return m;
    });
  }

  const sampling = {};
  if (typeof settings.temperature === 'number' && Number.isFinite(settings.temperature)) sampling.temperature = settings.temperature;
  if (typeof settings.topP === 'number' && Number.isFinite(settings.topP)) sampling.top_p = settings.topP;
  if (typeof settings.presencePenalty === 'number' && Number.isFinite(settings.presencePenalty)) sampling.presence_penalty = settings.presencePenalty;
  if (typeof settings.frequencyPenalty === 'number' && Number.isFinite(settings.frequencyPenalty)) sampling.frequency_penalty = settings.frequencyPenalty;
  if (Number.isInteger(settings.seed)) sampling.seed = settings.seed;

  const body = {
    model: connection.model,
    messages: finalMessages,
    stream: Boolean(settings.streaming),
    ...tokenField,
    ...reasoningField,
    ...toolsField,
    ...affinity,
    ...streamUsage,
    ...sampling,
    ...(settings.extraBody && typeof settings.extraBody === 'object' && !Array.isArray(settings.extraBody) ? settings.extraBody : {}),
  };

  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {}),
    ...(isOpenRouter ? { 'X-OpenRouter-Title': 'NEXUS Desktop', 'X-OpenRouter-Metadata': 'enabled' } : {}),
    ...(isCopilot ? {
      'Copilot-Integration-Id': 'vscode-chat',
      'Editor-Version': 'vscode/1.99.0',
      'Editor-Plugin-Version': 'copilot-chat/0.26.0',
      'Openai-Intent': 'conversation-edits',
    } : {}),
    ...(connection.headers || {}),
    ...(settings.extraHeaders && typeof settings.extraHeaders === 'object' ? settings.extraHeaders : {}),
  };

  return { connection, apiFormat: 'openai', url: connection.base + '/chat/completions', body, headers };
}

const STATIC_CATALOGS = {
  openai: [
    { id: 'openai/gpt-5', name: 'OpenAI · GPT-5', context_length: 400000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] }, pricing: { prompt: '0.00000125', completion: '0.00001' }, provider: 'openai', description: 'Flagship OpenAI model for agentic coding, architecture, and deep reasoning.' },
    { id: 'openai/gpt-5-mini', name: 'OpenAI · GPT-5 Mini', context_length: 400000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] }, pricing: { prompt: '0.00000025', completion: '0.000002' }, provider: 'openai', description: 'Fast, low-cost OpenAI reasoning model for high-frequency tool loops.' },
    { id: 'openai/gpt-4.1', name: 'OpenAI · GPT-4.1', context_length: 1047576, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: null, pricing: { prompt: '0.000002', completion: '0.000008' }, provider: 'openai', description: '1M context non-reasoning workhorse optimized for precise diffs and code edits.' },
    { id: 'openai/o3', name: 'OpenAI · o3', context_length: 200000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { mandatory: true, supported_efforts: ['low', 'medium', 'high'] }, pricing: { prompt: '0.000002', completion: '0.000008' }, provider: 'openai', description: 'Deep analytical reasoning model for complex debugging and architecture.' },
    { id: 'openai/o4-mini', name: 'OpenAI · o4-mini', context_length: 200000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { mandatory: true, supported_efforts: ['low', 'medium', 'high'] }, pricing: { prompt: '0.0000011', completion: '0.0000044' }, provider: 'openai', description: 'High-speed reasoning model for code generation and tool execution.' },
  ],
  copilot: [
    { id: 'copilot/claude-sonnet-4.5', name: 'Copilot · Claude Sonnet 4.5', context_length: 200000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] }, pricing: {}, provider: 'copilot', description: 'Claude Sonnet 4.5 via GitHub Copilot subscription.' },
    { id: 'copilot/gpt-5', name: 'Copilot · GPT-5', context_length: 200000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] }, pricing: {}, provider: 'copilot', description: 'OpenAI GPT-5 via GitHub Copilot subscription.' },
    { id: 'copilot/gpt-4.1', name: 'Copilot · GPT-4.1', context_length: 128000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: null, pricing: {}, provider: 'copilot', description: 'Fast daily coding model via GitHub Copilot.' },
    { id: 'copilot/claude-opus-4.5', name: 'Copilot · Claude Opus 4.5', context_length: 200000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['low', 'medium', 'high'] }, pricing: {}, provider: 'copilot', description: 'High-intelligence architectural model via GitHub Copilot.' },
    { id: 'copilot/gemini-2.5-pro', name: 'Copilot · Gemini 2.5 Pro', context_length: 1000000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['low', 'medium', 'high'] }, pricing: {}, provider: 'copilot', description: 'Large-context multimodal coding model via GitHub Copilot.' },
    { id: 'copilot/o3-mini', name: 'Copilot · o3-mini', context_length: 200000, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'], reasoning: { mandatory: true, supported_efforts: ['low', 'medium', 'high'] }, pricing: {}, provider: 'copilot', description: 'Fast reasoning model via GitHub Copilot.' },
  ],
  anthropic: [
    { id: 'anthropic/claude-sonnet-4-5', name: 'Anthropic · Claude Sonnet 4.5', context_length: 200000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'medium', 'high', 'max'] }, pricing: { prompt: '0.000003', completion: '0.000015' }, provider: 'anthropic', description: 'Native Anthropic Messages API with prompt caching and extended thinking.' },
    { id: 'anthropic/claude-opus-4-5', name: 'Anthropic · Claude Opus 4.5', context_length: 200000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'medium', 'high', 'max'] }, pricing: { prompt: '0.000015', completion: '0.000075' }, provider: 'anthropic', description: 'Frontier model for complex multi-system architecture and deep investigations.' },
    { id: 'anthropic/claude-haiku-4-5', name: 'Anthropic · Claude Haiku 4.5', context_length: 200000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] }, pricing: { prompt: '0.0000008', completion: '0.000004' }, provider: 'anthropic', description: 'Ultra-fast model for bounded retrieval, triage, and high-speed edits.' },
  ],
  deepseek: [
    { id: 'deepseek-direct/deepseek-chat', name: 'DeepSeek · V3 Chat', context_length: 128000, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'], reasoning: null, pricing: { prompt: '0.00000027', completion: '0.0000011' }, provider: 'deepseek', description: 'Direct DeepSeek V3 endpoint for fast coding and tool execution.' },
    { id: 'deepseek-direct/deepseek-reasoner', name: 'DeepSeek · R1 Reasoner', context_length: 128000, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'], reasoning: { mandatory: true, supported_efforts: ['low', 'medium', 'high'] }, pricing: { prompt: '0.00000055', completion: '0.00000219' }, provider: 'deepseek', description: 'Direct DeepSeek R1 chain-of-thought reasoning model.' },
  ],
  gemini: [
    { id: 'gemini/gemini-2.5-pro', name: 'Gemini · 2.5 Pro', context_length: 1048576, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] }, pricing: {}, provider: 'gemini', description: '1M-context multimodal coding and architecture model via Google Gemini API.' },
    { id: 'gemini/gemini-2.5-flash', name: 'Gemini · 2.5 Flash', context_length: 1048576, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] }, pricing: {}, provider: 'gemini', description: 'High-speed, 1M-context model for rapid code iteration.' },
  ],
  xai: [
    { id: 'xai/grok-4', name: 'xAI · Grok 4', context_length: 256000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] }, pricing: {}, provider: 'xai', description: 'Frontier xAI model with native tool calling and reasoning.' },
    { id: 'xai/grok-code-fast-1', name: 'xAI · Grok Code Fast', context_length: 256000, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'], reasoning: null, pricing: {}, provider: 'xai', description: 'Low-latency coding model optimized for agent loops.' },
  ],
  groq: [
    { id: 'groq/llama-3.3-70b-versatile', name: 'Groq · Llama 3.3 70B', context_length: 131072, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'], reasoning: null, pricing: {}, provider: 'groq', description: 'Ultra-high throughput LPU inference.' },
    { id: 'groq/qwen-qwq-32b', name: 'Groq · QwQ 32B', context_length: 131072, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['low', 'medium', 'high'] }, pricing: {}, provider: 'groq', description: 'High-speed reasoning on Groq LPU.' },
  ],
  yeta: [
    { id: 'yeta/deepseek-v4.1-flash-uncensored', name: 'Yeta · DeepSeek V4.1 Flash Uncensored', context_length: 1000000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'high', 'xhigh', 'max'] }, pricing: { prompt: '0.00000008', completion: '0.00000035' }, provider: 'yeta', description: 'DeepSeek V4.1 Flash without refusal behavior · 1M context · vision · zero data retention.' },
    { id: 'yeta/deepseek-v4.1-flash', name: 'Yeta · DeepSeek V4.1 Flash', context_length: 1000000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'high', 'xhigh', 'max'] }, pricing: { prompt: '0.00000008', completion: '0.00000035' }, provider: 'yeta', description: 'DeepSeek V4.1 Flash · 1M context · vision · zero data retention.' },
    { id: 'yeta/glm-5.3-flash', name: 'Yeta · GLM 5.3 Flash', context_length: 262000, architecture: { input_modalities: ['text', 'image', 'video'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }, pricing: { prompt: '0.00000008', completion: '0.00000042' }, provider: 'yeta', description: 'GLM 5.3 Flash · 262K context · multimodal · zero data retention.' },
    { id: 'yeta/kimi-k3.1-pro', name: 'Yeta · Kimi K3.1 Pro', context_length: 262000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'high', 'max'] }, pricing: { prompt: '0.00000008', completion: '0.00000042' }, provider: 'yeta', description: 'Moonshot Kimi K3.1 Pro · vision + native tool calling · zero data retention.' },
    { id: 'yeta/gpt-image-2', name: 'Yeta · GPT-Image-2', context_length: 32000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: null, pricing: {}, provider: 'yeta', description: 'Image generation and style transfer via Yeta Labs.' },
    { id: 'yeta/seedream-5.5-uncensored', name: 'Yeta · Seedream 5.5 Uncensored', context_length: 32000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: null, pricing: {}, provider: 'yeta', description: 'Seedream 5.5 image generation without refusal behavior.' },
    { id: 'yeta/seedream-5.5', name: 'Yeta · Seedream 5.5', context_length: 32000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: null, pricing: {}, provider: 'yeta', description: 'Seedream 5.5 image generation via Yeta Labs.' },
  ],
  custom: [
    { id: 'custom/qwen2.5-coder:32b', name: 'Local · Qwen 2.5 Coder 32B', context_length: 131072, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'], reasoning: null, pricing: {}, provider: 'custom', description: 'Local unrestricted coding model via Ollama / vLLM / LM Studio.' },
    { id: 'custom/deepseek-r1:32b', name: 'Local · DeepSeek R1 32B', context_length: 131072, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] }, pricing: {}, provider: 'custom', description: 'Local reasoning model via OpenAI-compatible server.' },
    { id: 'custom/llama3.3:70b', name: 'Local · Llama 3.3 70B', context_length: 131072, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'], reasoning: null, pricing: {}, provider: 'custom', description: 'General-purpose local model with tool support.' },
  ],
};

export async function providerCatalog(provider, { sort = '', request = fetch, settings = {}, getSecret } = {}) {
  const customProfile = allProviders(settings).find(p => p.custom && p.id === provider);
  if (customProfile) {
    try {
      const key = getSecret?.(customProfile.key);
      const headers = {
        ...(key ? (customProfile.apiFormat === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { Authorization: 'Bearer ' + key }) : {}),
        ...(customProfile.headers || {}),
      };
      const res = await request(customProfile.base + '/models', { headers, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
        if (list.length) {
          return list.map(m => ({
            id: customProfile.prefix + (m.id || m.name),
            name: customProfile.name + ' · ' + (m.id || m.name),
            context_length: Number(m.context_length || m.max_model_len || 131072),
            architecture: { input_modalities: ['text', 'image'] },
            supported_parameters: ['tools'],
            reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] },
            pricing: {},
            provider: customProfile.id,
            description: 'Live model from ' + customProfile.base,
          }));
        }
      }
    } catch {}
    return customProfile.defaultModel ? [{
      id: customProfile.prefix + customProfile.defaultModel,
      name: customProfile.name + ' · ' + customProfile.defaultModel,
      context_length: 131072,
      architecture: { input_modalities: ['text', 'image'] },
      supported_parameters: ['tools'],
      reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] },
      pricing: {},
      provider: customProfile.id,
      description: 'Configured default model for ' + customProfile.name,
    }] : [];
  }
  if (STATIC_CATALOGS[provider]) {
    const fallback = STATIC_CATALOGS[provider];
    const providerMeta = PROVIDERS.find(p => p.id === provider);
    const key = getSecret?.(providerMeta?.key);
    const canQueryLive = (provider === 'custom' && settings?.customBaseUrl) || (key && ['yeta', 'openai', 'anthropic', 'copilot', 'deepseek', 'xai', 'groq'].includes(provider));
    if (canQueryLive) {
      try {
        let base = provider === 'custom' ? String(settings.customBaseUrl).replace(/\/+$/, '') : providerMeta.base;
        let authHeader = key ? { Authorization: 'Bearer ' + key } : {};
        if (provider === 'anthropic') authHeader = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
        if (provider === 'copilot') {
          const resolved = await resolveCopilotAuth(key, { request, base: settings?.copilotBaseUrl || base });
          base = resolved.base;
          authHeader = { Authorization: 'Bearer ' + resolved.token, 'Copilot-Integration-Id': 'vscode-chat', 'Editor-Version': 'vscode/1.99.0' };
        }
        const res = await request(base + '/models', { headers: authHeader, signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
          if (list.length) {
            const prefix = providerMeta?.prefix || (provider + '/');
            const staticMap = new Map(fallback.map(item => [item.id, item]));
            const liveItems = list.slice(0, 80).map(m => {
              const id = prefix + (m.id || m.name);
              const known = staticMap.get(id);
              return known || {
                id,
                name: (providerMeta?.name || provider) + ' · ' + (m.display_name || m.id || m.name),
                context_length: Number(m.context_length || m.max_model_len || m.capabilities?.limits?.max_context_window_tokens || 131072),
                architecture: { input_modalities: ['text', 'image'] },
                supported_parameters: ['tools'],
                reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] },
                pricing: {},
                provider,
                description: 'Discovered from ' + base,
              };
            });
            const merged = new Map(fallback.map(item => [item.id, item]));
            for (const item of liveItems) merged.set(item.id, item);
            return [...merged.values()];
          }
        }
      } catch {}
    }
    return fallback;
  }
  const arli = provider === 'arliai';
  const response = await request(
    arli ? 'https://api.arliai.com/model/all' : 'https://openrouter.ai/api/v1/models' + (sort ? '?sort=' + encodeURIComponent(sort) : ''),
    { signal: AbortSignal.timeout(30000) }
  );
  if (!response.ok) throw new Error((arli ? 'Arli.ai' : 'OpenRouter') + ' catalog unavailable (' + response.status + ').');
  const data = await response.json();
  if (!arli) return data.data;
  if (!Array.isArray(data)) throw new Error('Unrecognized Arli.ai catalog format.');
  return data.filter(m => m.status === true).map(m => ({
    id: 'arliai/' + m.name,
    name: 'Arli.ai · ' + m.name,
    context_length: Number(m.contextSize),
    architecture: { input_modalities: m.vlm ? ['text', 'image'] : ['text'] },
    ...(/^(DeepSeek|GLM|Qwen|MiMo|Llama|Mistral)/i.test(m.name) ? { supported_parameters: ['tools'] } : { supported_parameters: [] }),
    reasoning: m.reasoning ? { supported_efforts: m.name.startsWith('DeepSeek-V4') ? ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] : ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] } : null,
    pricing: {},
    description: (m.modelRecommendation || 'Unrestricted / Coding model') + ' · ' + m.parameters + ' · Max native model context; your account plan may cap it.',
    provider: 'arliai',
    available: true,
  })).sort((a, b) => Number(b.id === arliModel) - Number(a.id === arliModel));
}

export async function checkArliConnection(key, { request = fetch } = {}) {
  if (!key) throw new Error('Save your Arli.ai API key first.');
  let response;
  try {
    response = await request('https://api.arliai.com/v1/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(30000) });
  } catch (error) {
    throw isNetworkFailure(error) ? networkFailure(error, 'Arli.ai') : error;
  }
  if (!response.ok) throw providerHttpFailure(response.status, 'Arli.ai');
  const data = await response.json();
  const entries = Array.isArray(data) ? data : data.data;
  if (!Array.isArray(entries)) throw new Error('Arli.ai responded, but its account catalog had an unexpected format.');
  return {
    ok: true,
    models: entries.map(m => ({ id: m.id || m.name, context: Number(m.context_length || m.max_context || m.context_window || m.contextSize) || null })),
    checkedAt: new Date().toISOString(),
  };
}

export async function checkProviderConnection(providerId, key, { request = fetch, settings = {} } = {}) {
  if (providerId === 'arliai') return checkArliConnection(key, { request });
  const provider = allProviders(settings).find(p => p.id === providerId) || PROVIDERS[0];
  if (!key && !provider.optionalKey) throw new Error('Save your ' + provider.name + ' credential first.');
  let base = providerId === 'custom' ? String(settings?.customBaseUrl || provider.base).replace(/\/+$/, '') : provider.base;
  let token = key;
  if (providerId === 'copilot' && key && /^(gho_|ghu_|ghp_|github_pat_)/.test(key) && request === fetch) {
    const resolved = await resolveCopilotAuth(key, { request, base: settings?.copilotBaseUrl || base });
    token = resolved.token;
    base = resolved.base;
  }
  const headers = {
    ...(token && provider.apiFormat !== 'anthropic' ? { Authorization: 'Bearer ' + token } : {}),
    ...(providerId === 'copilot' ? { 'Copilot-Integration-Id': 'vscode-chat', 'Editor-Version': 'vscode/1.99.0' } : {}),
    ...(provider.apiFormat === 'anthropic' ? { 'anthropic-version': '2023-06-01', ...(token ? { 'x-api-key': token } : {}) } : {}),
    ...(provider.headers || {}),
  };
  let response;
  try {
    response = await request(base + '/models', { headers, signal: AbortSignal.timeout(20000) });
  } catch (error) {
    throw isNetworkFailure(error) ? networkFailure(error, provider.name) : error;
  }
  if (!response.ok) throw providerHttpFailure(response.status, provider.name);
  const data = await response.json().catch(() => ({ data: [] }));
  const entries = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []));
  return {
    ok: true,
    models: entries.map(m => ({ id: m.id || m.name, context: Number(m.context_length || m.max_context || m.contextSize) || null })),
    checkedAt: new Date().toISOString(),
  };
}
