// Namespaced model IDs keep the provider attached to each chat, including after restart.
import {isNetworkFailure,networkFailure,providerHttpFailure} from './provider-errors.mjs';

export const arliModel = 'arliai/DeepSeek-V4.1-Flash-1017';

export const PROVIDERS = [
  { id: 'openrouter', name: 'OpenRouter', key: 'OPENROUTER_API_KEY', base: 'https://openrouter.ai/api/v1', prefix: '' },
  { id: 'arliai', name: 'Arli.ai', key: 'ARLIAI_API_KEY', base: 'https://api.arliai.com/v1', prefix: 'arliai/' },
  { id: 'openai', name: 'OpenAI', key: 'OPENAI_API_KEY', base: 'https://api.openai.com/v1', prefix: 'openai/' },
  { id: 'copilot', name: 'GitHub Copilot', key: 'GITHUB_COPILOT_TOKEN', base: 'https://api.githubcopilot.com', prefix: 'copilot/' },
  { id: 'anthropic', name: 'Anthropic', key: 'ANTHROPIC_API_KEY', base: 'https://api.anthropic.com/v1', prefix: 'anthropic/' },
  { id: 'custom', name: 'Custom / Local', key: 'CUSTOM_API_KEY', base: 'http://localhost:11434/v1', prefix: 'custom/', optionalKey: true },
];

export const SECRET_KEYS = ['ARLIAI_API_KEY', 'OPENROUTER_API_KEY', 'OPENROUTER_MANAGEMENT_KEY', 'OPENAI_API_KEY', 'GITHUB_COPILOT_TOKEN', 'ANTHROPIC_API_KEY', 'CUSTOM_API_KEY'];

export function modelConnection(model = '', settings = {}) {
  const value = String(model || '');
  if (value.startsWith('arliai/')) return { id: 'arliai', name: 'Arli.ai', key: 'ARLIAI_API_KEY', base: 'https://api.arliai.com/v1', model: value.slice(7) };
  if (value.startsWith('openai/')) return { id: 'openai', name: 'OpenAI', key: 'OPENAI_API_KEY', base: 'https://api.openai.com/v1', model: value.slice(7) };
  if (value.startsWith('copilot/')) return { id: 'copilot', name: 'GitHub Copilot', key: 'GITHUB_COPILOT_TOKEN', base: settings?.copilotBaseUrl || 'https://api.githubcopilot.com', model: value.slice(8) };
  if (value.startsWith('anthropic/')) return { id: 'anthropic', name: 'Anthropic', key: 'ANTHROPIC_API_KEY', base: 'https://api.anthropic.com/v1', model: value.slice(10) };
  if (value.startsWith('custom/') || value.startsWith('local/')) {
    const raw = value.startsWith('custom/') ? value.slice(7) : value.slice(6);
    const base = String(settings?.customBaseUrl || 'http://localhost:11434/v1').replace(/\/+$/, '');
    return { id: 'custom', name: 'Custom / Local', key: 'CUSTOM_API_KEY', base, model: raw, optionalKey: true };
  }
  const clean = value.startsWith('openrouter/') ? value.slice(11) : value;
  return { id: 'openrouter', name: 'OpenRouter', key: 'OPENROUTER_API_KEY', base: 'https://openrouter.ai/api/v1', model: clean };
}

export function completionRequest({ model, messages, settings = {}, tools, outputLimit, effort, sessionId }) {
  const connection = modelConnection(model, settings);
  const { id } = connection;
  const isOpenRouter = id === 'openrouter';
  const isArli = id === 'arliai';
  const isOpenAI = id === 'openai';
  const isCopilot = id === 'copilot';
  const isAnthropic = id === 'anthropic';
  const level = effort || settings.reasoningEffort || 'none';

  const useMaxCompletionTokens = isArli || isOpenAI || isCopilot;
  const tokenField = outputLimit > 0 ? { [useMaxCompletionTokens ? 'max_completion_tokens' : 'max_tokens']: outputLimit } : {};

  let reasoningField = {};
  if (level !== 'auto') {
    if (isArli) {
      reasoningField = { reasoning_effort: level, include_reasoning: false };
    } else if (isOpenRouter) {
      reasoningField = { reasoning: { effort: level } };
    } else if ((isOpenAI || isCopilot) && !['none', 'minimal'].includes(level)) {
      const mapped = ['xhigh', 'max'].includes(level) ? 'high' : level;
      reasoningField = { reasoning_effort: mapped };
    }
  }

  let toolsField = {};
  if (tools && tools.length) {
    if (isOpenRouter) {
      toolsField = {
        tools,
        provider: {
          require_parameters: true,
          ...(settings.providerRouting && settings.providerRouting !== 'auto' ? { sort: settings.providerRouting } : {}),
        },
      };
    } else {
      toolsField = { tools, tool_choice: 'auto' };
    }
  }

  const streamUsage = (isArli || isOpenAI || isCopilot) && settings.streaming ? { stream_options: { include_usage: true } } : {};
  const affinity = isOpenRouter && sessionId ? { session_id: sessionId } : {};

  const body = {
    model: connection.model,
    messages,
    stream: Boolean(settings.streaming),
    ...tokenField,
    ...reasoningField,
    ...toolsField,
    ...affinity,
    ...streamUsage,
  };

  const headers = {
    'Content-Type': 'application/json',
    ...(isOpenRouter ? { 'X-OpenRouter-Title': 'NEXUS Desktop', 'X-OpenRouter-Metadata': 'enabled' } : {}),
    ...(isCopilot ? {
      'Copilot-Integration-Id': 'vscode-chat',
      'Editor-Version': 'vscode/1.99.0',
      'Editor-Plugin-Version': 'copilot-chat/0.26.0',
      'Openai-Intent': 'conversation-edits',
    } : {}),
    ...(isAnthropic ? { 'anthropic-version': '2023-06-01' } : {}),
  };

  return { connection, body, headers };
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
    { id: 'anthropic/claude-sonnet-4-5', name: 'Anthropic · Claude Sonnet 4.5', context_length: 200000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] }, pricing: { prompt: '0.000003', completion: '0.000015' }, provider: 'anthropic', description: 'Industry-leading agentic coding and tool-use model.' },
    { id: 'anthropic/claude-opus-4-5', name: 'Anthropic · Claude Opus 4.5', context_length: 200000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] }, pricing: { prompt: '0.000015', completion: '0.000075' }, provider: 'anthropic', description: 'Frontier model for complex multi-system architecture and deep investigations.' },
    { id: 'anthropic/claude-haiku-4-5', name: 'Anthropic · Claude Haiku 4.5', context_length: 200000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'], reasoning: null, pricing: { prompt: '0.0000008', completion: '0.000004' }, provider: 'anthropic', description: 'Ultra-fast model for bounded retrieval, triage, and high-speed edits.' },
  ],
  custom: [
    { id: 'custom/qwen2.5-coder:32b', name: 'Local · Qwen 2.5 Coder 32B', context_length: 131072, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'], reasoning: null, pricing: {}, provider: 'custom', description: 'Local unrestricted coding model via Ollama / vLLM / LM Studio.' },
    { id: 'custom/deepseek-r1:32b', name: 'Local · DeepSeek R1 32B', context_length: 131072, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'], reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] }, pricing: {}, provider: 'custom', description: 'Local reasoning model via OpenAI-compatible server.' },
    { id: 'custom/llama3.3:70b', name: 'Local · Llama 3.3 70B', context_length: 131072, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'], reasoning: null, pricing: {}, provider: 'custom', description: 'General-purpose local model with tool support.' },
  ],
};

export async function providerCatalog(provider, { sort = '', request = fetch, settings = {} } = {}) {
  if (STATIC_CATALOGS[provider]) {
    if (provider === 'custom' && settings?.customBaseUrl) {
      try {
        const base = String(settings.customBaseUrl).replace(/\/+$/, '');
        const res = await request(base + '/models', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : data?.data;
          if (Array.isArray(list) && list.length) {
            return list.map(m => ({
              id: 'custom/' + (m.id || m.name),
              name: 'Local · ' + (m.id || m.name),
              context_length: Number(m.context_length || m.max_model_len || 131072),
              architecture: { input_modalities: ['text', 'image'] },
              supported_parameters: ['tools'],
              reasoning: { supported_efforts: ['none', 'low', 'medium', 'high'] },
              pricing: {},
              provider: 'custom',
              description: 'Discovered from local/custom endpoint ' + base,
            }));
          }
        }
      } catch {}
    }
    return STATIC_CATALOGS[provider];
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
  const provider = PROVIDERS.find(p => p.id === providerId) || PROVIDERS[0];
  if (!key && !provider.optionalKey) throw new Error('Save your ' + provider.name + ' credential first.');
  const base = providerId === 'custom' ? String(settings?.customBaseUrl || provider.base).replace(/\/+$/, '') : provider.base;
  const headers = {
    ...(key ? { Authorization: 'Bearer ' + key } : {}),
    ...(providerId === 'copilot' ? { 'Copilot-Integration-Id': 'vscode-chat', 'Editor-Version': 'vscode/1.99.0' } : {}),
    ...(providerId === 'anthropic' ? { 'anthropic-version': '2023-06-01', 'x-api-key': key } : {}),
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
