import fs from 'node:fs';
import path from 'node:path';
import { allProviders, providerCatalog, checkProviderConnection, modelConnection } from './providers.mjs';
import { buildPrivacyAudit, PRIVACY_MODE_GUIDE } from './privacy-proxy.mjs';
import { SEARCH_PROVIDER_CATALOG } from './search-engines.mjs';
import { isProcessElevated } from './coding-engine.mjs';
import { validateChatOptions, agentModes, efforts, routes } from './chat-options.mjs';

// Structured, live-generated feature guide so the AI inside NEXUS understands
// every capability, setting, and tool without having to read NEXUS source code.
export function buildNexusFeatureGuide(topic = 'all') {
  const sections = {
    overview: {
      summary: 'NEXUS is a standalone native Windows (.NET 10 + WebView2, Zero Electron) autonomous agentic coding & personal operator workstation backed by a local Node 24 ESM Core Server.',
      corePrinciple: 'Use structured tools (nexus_control, manage_privacy, manage_session, manage_project, memory_store, manage_automation) to inspect and configure NEXUS instead of reading or editing NEXUS installation/source files.',
      selfEditProtection: 'Editing NEXUS application files, bundled UI/core code, protected internal state files (workspace.json, nexus.config.json, vault.*), or killing/restarting NEXUS is strictly protected and requires explicit user permission even in Unrestricted mode.',
    },
    providers: {
      summary: 'Multi-provider LLM engine with built-in providers and unlimited OpenAI- or Anthropic-compatible Custom Providers.',
      builtinProviders: [
        { id: 'openrouter', name: 'OpenRouter', prefix: '(none)', format: 'openai', keyName: 'OPENROUTER_API_KEY', notes: 'Unified router (300+ models), supports providerRouting (auto/price/throughput/latency), providerOrder, cacheAffinity, promptCaching, native web search.' },
        { id: 'yeta', name: 'Yeta Labs', prefix: 'yeta/', format: 'openai', keyName: 'YETA_API_KEY', base: 'https://platform.yeta.ai/v1', notes: 'First-class provider for DeepSeek V4.1 Flash (Uncensored & standard, 1M ctx, vision), GLM 5.3 Flash, Kimi K3.1 Pro, and image models (GPT-Image-2, Seedream 5.5). Normalizes per-model reasoning_effort automatically.' },
        { id: 'arliai', name: 'Arli.ai', prefix: 'arliai/', format: 'openai', keyName: 'ARLIAI_API_KEY', notes: 'Dedicated uncensored/derestricted coding models.' },
        { id: 'openai', name: 'OpenAI', prefix: 'openai/', format: 'openai', keyName: 'OPENAI_API_KEY' },
        { id: 'copilot', name: 'GitHub Copilot', prefix: 'copilot/', format: 'openai', keyName: 'GITHUB_COPILOT_TOKEN', notes: 'Supports OAuth token exchange via gh auth token.' },
        { id: 'anthropic', name: 'Anthropic', prefix: 'anthropic/', format: 'anthropic', keyName: 'ANTHROPIC_API_KEY', notes: 'Native /v1/messages API with prompt caching & extended thinking.' },
        { id: 'deepseek', name: 'DeepSeek Direct', prefix: 'deepseek-direct/', format: 'openai', keyName: 'DEEPSEEK_API_KEY' },
        { id: 'gemini', name: 'Google Gemini', prefix: 'gemini/', format: 'openai', keyName: 'GEMINI_API_KEY' },
        { id: 'xai', name: 'xAI (Grok)', prefix: 'xai/', format: 'openai', keyName: 'XAI_API_KEY' },
        { id: 'groq', name: 'Groq', prefix: 'groq/', format: 'openai', keyName: 'GROQ_API_KEY' },
        { id: 'custom', name: 'Custom / Local', prefix: 'custom/', format: 'openai', keyName: 'CUSTOM_API_KEY (optional)', notes: 'Ollama, LM Studio, vLLM, llama.cpp via settings.customBaseUrl.' },
      ],
      customProviders: 'Unlimited custom profiles stored in settings.customProviders via nexus_control(action="manage_provider", providerAction="add_custom"|"update_custom"|"remove_custom").',
      secretStorage: 'API keys are stored encrypted with Windows DPAPI in vault.dpapi. Raw keys are NEVER exposed to models or UI; only keyConfigured booleans are visible.',
    },
    models: {
      summary: 'Model Picker is scoped strictly to the currently selected provider and its enabled models.',
      enabledModels: 'settings.enabledModels maps providerId -> array of enabled model IDs. Empty/unset means all models of the active provider are shown. Use nexus_control(action="manage_provider", providerAction="set_enabled_models"|"enable_model"|"disable_model"|"clear_enabled_models"|"list_models") to manage enabled models.',
      tuning: 'Per-chat or global settings: model, reasoningEffort (auto/none/minimal/low/medium/high/xhigh/max), contextWindow, compressionPercent, maxOutput (0 = provider max), temperature, topP, presencePenalty, frequencyPenalty, seed, streaming, promptCaching, cacheAffinity, lazyToolLoading, microCompaction, silentToolSteps, providerRouting, providerOrder.',
    },
    autonomy: {
      levels: [
        { id: 'interactive', description: 'Asks user confirmation before every mutating or external action.' },
        { id: 'semi-autopilot', description: 'Auto-runs reads and normal workspace edits; asks approval on risky commands, deletions, git mutations, external HTTP mutations, desktop actions, and privacy changes. Customizable via semiAutoAllowRules & semiAutoDenyRules.' },
        { id: 'autopilot', description: 'Executes engineering tasks autonomously end-to-end.' },
        { id: 'unrestricted', description: 'Full autonomous permissions across local Windows machine, EXCEPT NEXUS App Self-Edit Protection still always requires explicit user permission.' },
      ],
      adminRights: 'Per-session Windows Administrator Rights (task.adminMode) run run_command & shell_session elevated via a persistent single-UAC ElevatedAdminBroker (Windows prompts UAC only ONCE, then reuses that elevated worker across all commands without repeated popups).',
      changeVia: 'nexus_control(action="update_settings", settings={agentMode:...}) or nexus_control(action="update_session", session={agentMode:..., adminMode:...}).',
    },
    privacy: {
      summary: 'Full app-scoped anonymity, routing, and OPSEC suite controlled directly via manage_privacy.',
      actions: ['status', 'explain', 'verify', 'apply_preset', 'stealth', 'set_routing', 'set_search', 'set_pii', 'set_browser', 'wireguard_import', 'wireguard_select', 'wireguard_remove', 'wireguard_install', 'wireguard_connect', 'wireguard_disconnect', 'set_wireguard_binary', 'tor_install', 'tor_start', 'tor_stop', 'tor_new_identity', 'wipe_browser'],
      presets: ['maximum (Stealth + WireGuard->Tor or Managed Tor + Kill-Switch + PII Scrubber + InPrivate + Zero-Track Search)', 'wireguard-tor', 'wireguard', 'tor', 'balanced', 'off'],
      routingModes: PRIVACY_MODE_GUIDE.map(m => ({ id: m.id, rank: m.rank, label: m.label, protectionLevel: m.protectionLevel })),
      stealthNote: '1-Click Stealth Mode explicitly preserves promptCaching and cacheAffinity.',
      piiScrubber: 'Replaces C:\\Users\\<user>, hostname, and custom rules before cloud LLM calls; transparently restores real values for local tools and local chat display.',
    },
    sessions: {
      summary: 'Sessions support inline/AI renaming, Projects, RAM-Only ephemeral mode, per-session Admin Rights, nested child sessions, forking, editing, regeneration, and 2-stage lossless compaction.',
      renaming: 'Use manage_session(action="rename", title="...") on step 1 to replace raw prompt titles and again whenever the conversation topic/goal shifts.',
      ramOnly: 'manage_session(action="set_ephemeral", ephemeral=true|false) live-migrates between RAM-Only (zero disk traces, purges disk files immediately) and Regular persistent storage.',
      nestedOrchestration: 'spawn_session, list_sessions, send_session_message, read_session, delegate_subagent (in "sessions" toolset).',
      compaction: 'Stage 1 zero-cost Micro-Compaction prunes old oversized tool outputs into lossless artifacts; Stage 2 creates structured continuity checkpoints readable via read_checkpoint / search_journal / search_history.',
    },
    projects: {
      summary: 'Projects bind a root workspace folder and shared project instructions; auto-discover NEXUS.md/CLAUDE.md/AGENTS.md and .nexus/.github/.claude/skills/*/SKILL.md.',
      tool: 'manage_project(action="list"|"create"|"update"|"delete") and manage_session(action="assign_project"|"set_workspace").',
    },
    memory: {
      summary: 'Structured persistent user & project memory across sessions (categories: priority, preference, constraint, workflow, profile, fact; priorities: critical, high, normal, low; global or project scope; pinning).',
      tool: 'memory_store(action="list"|"search"|"remember"|"update"|"forget"|"profile").',
    },
    browser: {
      summary: 'Dual-mode Agent & Private Browser: agent-fast (zero-bloat @e1..@eN Markdown snapshot, works over Tor/.onion), agent-js (headless WebView2 JS execution + @eN DOM actions + resource blocking), and standard visual InPrivate/Account WebView2 browser.',
      tools: 'browser_inspect, web_fetch, web_search, http_request (in "web_browser" toolset). Configure via manage_privacy(action="set_browser").',
    },
    search: {
      summary: '13 privacy-ranked search modes including SearXNG, DuckDuckGo, Mojeek, Brave ZDR, Kagi, LangSearch, Tavily, Exa, Ahmia (.onion), Torch (.onion via Tor), Combined .onion, and optional Bing RSS (blocked under Strict Zero-Track).',
      providers: SEARCH_PROVIDER_CATALOG.map(p => ({ id: p.id, name: p.name, tier: p.tier, needsKey: Boolean(p.secretKey), onion: Boolean(p.onion) })),
      configureVia: 'manage_privacy(action="set_search", provider=..., strictZeroTrack=..., searxUrl=..., torchOnionUrl=...).',
    },
    tools: {
      summary: '60+ built-in tools with optional Smart Lazy Toolsets (load_toolset), individual tool enable/disable (disabledTools), custom slash commands (customCommands), dynamic JS plugins (create_dynamic_tool), local Skills & Functions (capabilities), and stdio MCP servers.',
      toolsets: ['git', 'shell_processes', 'web_browser', 'sessions', 'capabilities_mcp', 'connectors', 'memory_history', 'desktop', 'automations_evolve', 'plugins'],
      manageVia: 'nexus_control(action="manage_tools", toolAction="list"|"enable"|"disable"|"enable_all"|"add_command"|"remove_command").',
    },
    automations: {
      summary: 'Local cron, interval, daily, weekly, and one-shot scheduled agent missions that run automatically while NEXUS is open (even minimized to Windows tray).',
      tool: 'manage_automation(action="list"|"create"|"toggle"|"run"|"delete") (in "automations_evolve" toolset).',
    },
    media: {
      summary: 'Display local images (with Lightbox), HTML5 streaming videos (HTTP 206 Range), audio, PDFs, Markdown, CSV tables, and code documents directly inline in chat.',
      tool: 'present_media(path=..., title=..., caption=..., kind=...) or present_media(items=[...]).',
    },
    appearance: {
      summary: 'Obsidian Dark, Studio Paper Light, Midnight Slate themes, custom accentColor, live customCss injection, global summon hotkey (Ctrl+Shift+Space), and minimizeToTray.',
      configureVia: 'nexus_control(action="update_settings", settings={accentColor, customCss, minimizeToTray, globalHotkey}).',
    },
    updates: {
      summary: 'Built-in GitHub portable auto-updater with SHA-256 verification and automatic protection/backup for customized system prompts (globalInstructionsCustomized + customSystemPrompt).',
      configKeys: ['autoCheckUpdates', 'updateRepo', 'customSystemPrompt'],
    },
  };

  const key = String(topic || 'all').toLowerCase();
  if (key === 'all') {
    return {
      availableTopics: Object.keys(sections),
      guide: sections,
    };
  }
  if (sections[key]) {
    return { topic: key, availableTopics: Object.keys(sections), guide: sections[key] };
  }
  // Fuzzy match topic
  const match = Object.keys(sections).find(k => k.includes(key) || key.includes(k));
  if (match) return { topic: match, availableTopics: Object.keys(sections), guide: sections[match] };
  return {
    error: `Unknown guide topic "${topic}".`,
    availableTopics: Object.keys(sections),
  };
}

function sanitizeSettings(settings = {}) {
  const out = {};
  for (const [k, v] of Object.entries(settings)) {
    if (/key|token|secret|pass/i.test(k) && typeof v === 'string') {
      out[k] = v ? '[SET]' : '';
    } else if (k === 'extraHeaders' && v && typeof v === 'object') {
      const safeHeaders = {};
      for (const [hk, hv] of Object.entries(v)) {
        safeHeaders[hk] = /auth|key|token|secret|cookie/i.test(hk) ? '[REDACTED]' : hv;
      }
      out[k] = safeHeaders;
    } else if (k === 'customProviders' && Array.isArray(v)) {
      out[k] = v.map(p => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        apiFormat: p.apiFormat,
        keyName: p.keyName,
        optionalKey: p.optionalKey,
        defaultModel: p.defaultModel,
        headerKeys: Object.keys(p.headers || {}),
      }));
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function executeNexusControl(runtime, currentTask, args = {}, { appRoot = '', appVersion = '' } = {}) {
  const action = String(args.action || 'inspect').toLowerCase();
  const s = runtime.store.state.settings || {};

  if (action === 'guide') {
    return buildNexusFeatureGuide(args.topic || 'all');
  }

  if (action === 'inspect') {
    const section = String(args.section || 'summary').toLowerCase();
    const providers = allProviders(s).map(p => ({
      id: p.id,
      name: p.name,
      base: p.id === 'custom' ? (s.customBaseUrl || p.base) : p.base,
      prefix: p.prefix,
      apiFormat: p.apiFormat,
      optionalKey: Boolean(p.optionalKey),
      custom: Boolean(p.custom),
      defaultModel: p.defaultModel || '',
      keyName: p.key,
      keyConfigured: Boolean(p.optionalKey || runtime.getSecret?.(p.key)),
      enabledModels: Array.isArray(s.enabledModels?.[p.id]) ? s.enabledModels[p.id] : [],
    }));
    const activeConn = modelConnection(currentTask?.model || s.model, s);

    const buildSessionInfo = t => !t ? null : ({
      id: t.id,
      title: t.title,
      titleCustomized: Boolean(t.titleCustomized),
      status: t.status,
      model: t.model,
      provider: modelConnection(t.model, s).id,
      agentMode: t.agentMode || s.agentMode,
      reasoningEffort: t.reasoningEffort ?? s.reasoningEffort,
      contextWindow: t.contextWindow || s.contextWindow,
      providerRouting: t.providerRouting ?? s.providerRouting,
      workspace: t.workspace || '',
      projectId: t.projectId || null,
      parentTaskId: t.parentTaskId || null,
      pinned: Boolean(t.pinned),
      ephemeral: Boolean(t.ephemeral),
      adminMode: Boolean(t.adminMode),
      steps: t.steps || 0,
      contextTokens: t.contextTokens || 0,
      loadedToolsets: t.loadedToolsets || [],
      createdAt: t.createdAt,
      updatedAt: t.updatedAt || t.createdAt,
    });

    const hostInfo = {
      version: appVersion || (() => {
        try { return JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version || '1.4.0'; }
        catch { return '1.4.0'; }
      })(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      isElevated: isProcessElevated(),
      adminBrokerConnected: Boolean(runtime.adminBroker?.isConnected?.()),
      appRoot,
      dataDir: runtime.store.directory,
      configPath: runtime.configFile?.filename || path.join(runtime.store.directory, 'nexus.config.json'),
    };

    const mcpServers = (runtime.store.state.mcpServers || []).map(srv => ({
      name: srv.name,
      transport: srv.transport || (srv.url ? 'http' : 'stdio'),
      command: srv.command || undefined,
      url: srv.url || undefined,
      status: runtime.mcp?.status?.({ compact: true })?.[srv.name] || 'disconnected',
    }));

    const plugins = runtime.plugins?.list?.().map(p => ({
      id: p.id,
      name: p.name,
      enabled: Boolean(p.enabled),
      tools: (p.tools || []).map(t => t.name || t),
    })) || [];

    const privacy = await runtime.managePrivacy(currentTask, { action: 'status' });

    const allData = {
      host: hostInfo,
      activeProvider: activeConn.id,
      activeModel: currentTask?.model || s.model,
      activeSession: buildSessionInfo(currentTask),
      settings: sanitizeSettings(s),
      providers,
      sessions: (runtime.store.state.tasks || []).slice(0, 40).map(buildSessionInfo),
      projects: (runtime.store.state.projects || []).map(p => ({ id: p.id, name: p.name, workspace: p.workspace || '', hasInstructions: Boolean(p.instructions?.trim()) })),
      privacy,
      tools: {
        disabledTools: s.disabledTools || [],
        lazyToolLoading: Boolean(s.lazyToolLoading),
        loadedToolsetsInCurrentSession: currentTask?.loadedToolsets || [],
        customCommands: (s.customCommands || []).map(c => ({ command: c.command, description: c.description, mode: c.mode || null })),
        semiAutoAllowRules: s.semiAutoAllowRules || [],
        semiAutoDenyRules: s.semiAutoDenyRules || [],
      },
      mcpServers,
      plugins,
      automations: (runtime.store.state.automations || []).map(a => ({ id: a.id, name: a.name, enabled: Boolean(a.enabled), scheduleType: a.scheduleType, model: a.model || '' })),
      memories: {
        count: (runtime.store.state.memories || []).length,
        pinnedCount: (runtime.store.state.memories || []).filter(m => m.pinned).length,
      },
      storage: runtime.store.storageInfo(),
    };

    if (section === 'all') return allData;
    if (section === 'summary') {
      return {
        host: allData.host,
        activeProvider: allData.activeProvider,
        activeModel: allData.activeModel,
        activeSession: allData.activeSession,
        autonomyMode: s.agentMode,
        providersConfigured: providers.filter(p => p.keyConfigured).map(p => ({ id: p.id, name: p.name, enabledModelsCount: p.enabledModels.length })),
        privacyPosture: privacy.posture,
        privacyWarnings: privacy.warnings,
        counts: {
          sessions: (runtime.store.state.tasks || []).length,
          runningSessions: (runtime.store.state.tasks || []).filter(t => ['running', 'queued', 'approval'].includes(t.status)).length,
          projects: allData.projects.length,
          memories: allData.memories.count,
          mcpServers: mcpServers.length,
          plugins: plugins.length,
          automations: allData.automations.length,
          disabledTools: (s.disabledTools || []).length,
        },
        storage: allData.storage,
        hint: 'Pass section="settings"|"providers"|"privacy"|"sessions"|"projects"|"tools"|"mcp"|"plugins"|"automations"|"all" for complete details, or action="guide" for full documentation of how every feature works.',
      };
    }
    if (section === 'session') return { activeSession: allData.activeSession };
    if (section === 'models') {
      const activeProvId = args.provider || activeConn.id;
      return {
        activeProvider: activeProvId,
        activeModel: allData.activeModel,
        enabledModelsForProvider: s.enabledModels?.[activeProvId] || [],
        allEnabledModels: s.enabledModels || {},
        favoriteModels: s.favoriteModels || [],
      };
    }
    if (Object.hasOwn(allData, section)) {
      return { [section]: allData[section] };
    }
    throw new Error(`Unknown inspect section "${section}". Use: summary, all, host, settings, providers, models, privacy, session, sessions, projects, tools, mcp, plugins, automations, memories, or storage.`);
  }

  if (action === 'update_settings') {
    const patch = args.settings;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('nexus_control update_settings requires a "settings" object.');
    }
    // Protect user's globalInstructions from accidental overwrites unless explicitly requested
    const safePatch = { ...patch };
    if (safePatch.globalInstructions !== undefined && args.confirmReplaceGlobalInstructions !== true) {
      throw new Error('Do not overwrite globalInstructions directly; update customSystemPrompt instead or pass confirmReplaceGlobalInstructions: true when explicitly requested by the user.');
    }
    runtime.settings(safePatch);
    if (currentTask) runtime.store.journal(currentTask, 'nexus_settings_updated', { keys: Object.keys(safePatch) });
    return {
      updated: true,
      appliedKeys: Object.keys(safePatch),
      settings: sanitizeSettings(runtime.store.state.settings),
    };
  }

  if (action === 'update_session') {
    const target = args.sessionId ? runtime.store.task(args.sessionId) : currentTask;
    if (!target) throw new Error('Target session not found.');
    const spec = args.session && typeof args.session === 'object' ? args.session : args;
    const chatOpts = validateChatOptions(spec);
    Object.assign(target, chatOpts);
    if (chatOpts.model) target.engine = modelConnection(chatOpts.model, runtime.store.state.settings).id;
    if (typeof spec.title === 'string' && spec.title.trim()) {
      target.title = spec.title.trim().slice(0, 120);
      target.titleCustomized = true;
      target.titleUpdatedAt = new Date().toISOString();
    }
    if (typeof spec.pinned === 'boolean') target.pinned = spec.pinned;
    if (typeof spec.adminMode === 'boolean') target.adminMode = spec.adminMode;
    if (typeof spec.ephemeral === 'boolean') runtime.store.setTaskEphemeral(target.id, spec.ephemeral, String(spec.reason || 'Updated via nexus_control'));
    if (spec.projectId !== undefined) {
      if (spec.projectId && !runtime.store.state.projects.some(p => p.id === spec.projectId)) throw new Error('Project not found.');
      target.projectId = spec.projectId || null;
    }
    if (typeof spec.workspace === 'string') target.workspace = spec.workspace;
    runtime.store.journal(target, 'nexus_session_updated', { keys: Object.keys(spec) });
    runtime.changed(target);
    return {
      updated: true,
      session: {
        id: target.id,
        title: target.title,
        model: target.model,
        agentMode: target.agentMode || runtime.store.state.settings.agentMode,
        reasoningEffort: target.reasoningEffort ?? runtime.store.state.settings.reasoningEffort,
        contextWindow: target.contextWindow || runtime.store.state.settings.contextWindow,
        workspace: target.workspace || '',
        projectId: target.projectId || null,
        pinned: Boolean(target.pinned),
        ephemeral: Boolean(target.ephemeral),
        adminMode: Boolean(target.adminMode),
      },
    };
  }

  if (action === 'manage_provider') {
    const sub = String(args.providerAction || 'list').toLowerCase();
    const provId = String(args.providerId || args.provider || '').trim().toLowerCase();
    const curCustom = Array.isArray(s.customProviders) ? [...s.customProviders] : [];

    if (sub === 'list') {
      return executeNexusControl(runtime, currentTask, { action: 'inspect', section: 'providers' }, { appRoot, appVersion });
    }
    if (sub === 'add_custom' || sub === 'update_custom') {
      const p = args.providerConfig || args;
      const id = String(p.id || provId).trim().toLowerCase();
      if (!id || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) throw new Error('Custom provider requires a valid lowercase id (alphanumerics, hyphen, underscore).');
      if (!p.baseUrl || typeof p.baseUrl !== 'string') throw new Error('Custom provider requires baseUrl.');
      const entry = {
        id,
        name: String(p.name || id).trim(),
        baseUrl: String(p.baseUrl).trim().replace(/\/+$/, ''),
        apiFormat: p.apiFormat === 'anthropic' ? 'anthropic' : 'openai',
        keyName: p.keyName || ('PROVIDER_' + id.toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '_KEY'),
        optionalKey: p.optionalKey !== false,
        defaultModel: String(p.defaultModel || '').trim(),
        headers: p.headers && typeof p.headers === 'object' ? p.headers : {},
      };
      const next = [...curCustom.filter(x => x.id !== id), entry];
      runtime.settings({ customProviders: next });
      if (currentTask) runtime.store.journal(currentTask, 'nexus_provider_updated', { sub, id });
      return { saved: true, provider: entry, note: `Store its API key (if required) in Settings under key name "${entry.keyName}".` };
    }
    if (sub === 'remove_custom') {
      if (!provId) throw new Error('remove_custom requires providerId.');
      const next = curCustom.filter(x => x.id !== provId);
      runtime.settings({ customProviders: next });
      if (currentTask) runtime.store.journal(currentTask, 'nexus_provider_updated', { sub, id: provId });
      return { removed: true, providerId: provId };
    }
    if (sub === 'set_enabled_models' || sub === 'enable_model' || sub === 'disable_model' || sub === 'clear_enabled_models') {
      const targetProv = provId || modelConnection(currentTask?.model || s.model, s).id;
      const map = { ...(s.enabledModels || {}) };
      if (sub === 'clear_enabled_models') {
        delete map[targetProv];
      } else if (sub === 'set_enabled_models') {
        if (!Array.isArray(args.models)) throw new Error('set_enabled_models requires a "models" array of model IDs.');
        map[targetProv] = [...new Set(args.models.map(x => String(x || '').trim()).filter(Boolean))];
      } else if (sub === 'enable_model') {
        const mid = String(args.modelId || '').trim();
        if (!mid) throw new Error('enable_model requires modelId.');
        map[targetProv] = [...new Set([...(map[targetProv] || []), mid])];
      } else if (sub === 'disable_model') {
        const mid = String(args.modelId || '').trim();
        if (!mid) throw new Error('disable_model requires modelId.');
        map[targetProv] = (map[targetProv] || []).filter(x => x !== mid);
      }
      runtime.settings({ enabledModels: map });
      if (currentTask) runtime.store.journal(currentTask, 'nexus_enabled_models_updated', { provider: targetProv, count: (map[targetProv] || []).length });
      return { updated: true, provider: targetProv, enabledModels: map[targetProv] || [] };
    }
    if (sub === 'list_models') {
      const targetProv = provId || modelConnection(currentTask?.model || s.model, s).id;
      const list = await providerCatalog(targetProv, { settings: s, getSecret: k => runtime.getSecret?.(k), request: runtime.request });
      const enabledSet = new Set(s.enabledModels?.[targetProv] || []);
      return {
        provider: targetProv,
        total: list.length,
        enabledFilterActive: enabledSet.size > 0,
        models: list.slice(0, 80).map(m => ({
          id: m.id,
          name: m.name,
          context: m.context_length,
          vision: Boolean(m.architecture?.input_modalities?.includes('image')),
          reasoning: m.reasoning || null,
          enabledInMenu: enabledSet.size === 0 || enabledSet.has(m.id),
        })),
      };
    }
    if (sub === 'check_connection') {
      const targetProv = provId || modelConnection(currentTask?.model || s.model, s).id;
      const pMeta = allProviders(s).find(p => p.id === targetProv);
      if (!pMeta) throw new Error('Provider not found: ' + targetProv);
      return checkProviderConnection(targetProv, runtime.getSecret?.(pMeta.key), { settings: s, request: runtime.request });
    }
    throw new Error('Unsupported providerAction: ' + sub);
  }

  if (action === 'manage_tools') {
    const sub = String(args.toolAction || 'list').toLowerCase();
    const disabled = new Set(s.disabledTools || []);
    if (sub === 'list') {
      return {
        disabledTools: [...disabled],
        lazyToolLoading: Boolean(s.lazyToolLoading),
        loadedToolsetsInCurrentSession: currentTask?.loadedToolsets || [],
        customCommands: s.customCommands || [],
      };
    }
    if (sub === 'enable' || sub === 'disable') {
      const names = Array.isArray(args.tools) ? args.tools : (args.toolName ? [args.toolName] : []);
      if (!names.length) throw new Error(`${sub} requires toolName or tools array.`);
      for (const n of names) {
        if (sub === 'disable') disabled.add(String(n));
        else disabled.delete(String(n));
      }
      runtime.settings({ disabledTools: [...disabled] });
      return { updated: true, disabledTools: [...disabled] };
    }
    if (sub === 'enable_all') {
      runtime.settings({ disabledTools: [] });
      return { updated: true, disabledTools: [] };
    }
    if (sub === 'add_command') {
      const cmd = String(args.command || '').trim();
      const template = String(args.template || '').trim();
      if (!cmd || !template) throw new Error('add_command requires command and template.');
      const normCmd = '/' + cmd.replace(/^\/+/, '');
      const cur = Array.isArray(s.customCommands) ? s.customCommands.filter(c => c.command !== normCmd) : [];
      const next = [...cur, { command: normCmd, description: String(args.description || 'Custom slash command'), template, ...(agentModes.includes(args.mode) ? { mode: args.mode } : {}) }];
      runtime.settings({ customCommands: next });
      return { saved: true, command: normCmd, customCommands: runtime.store.state.settings.customCommands };
    }
    if (sub === 'remove_command') {
      const normCmd = '/' + String(args.command || '').trim().replace(/^\/+/, '');
      const next = (s.customCommands || []).filter(c => c.command !== normCmd);
      runtime.settings({ customCommands: next });
      return { removed: true, command: normCmd };
    }
    throw new Error('Unsupported toolAction: ' + sub);
  }

  throw new Error('Unsupported nexus_control action: ' + action);
}

export const NEXUS_CONTROL_ENUMS = { agentModes, efforts, routes };
