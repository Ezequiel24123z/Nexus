import React, { useEffect, useState } from 'react';
import {
  KeyRound, CheckCircle2, RefreshCw, Plus, Trash2, FolderOpen, Terminal,
  Palette, Cpu, Sliders, FileJson, ShieldOff, Database, Globe, ShieldCheck, Archive, History
} from 'lucide-react';
import StoragePanel from '../StoragePanel.jsx';
import { PROVIDER_META, AUTONOMY_LEVELS, normalizeAutonomyId, detectProviderId, providerLabel, formatMoney, cleanError } from '../lib/format.mjs';
import { filterModelsForProvider } from '../lib/model-catalog.mjs';

const api = (method, args) => window.nexus.invoke(method, args);

const ACCENT_SWATCHES = ['#3ecf8e', '#38bdf8', '#a78bfa', '#fb923c', '#f43f5e', '#facc15', '#1d7a55'];

function SecretRow({ name, label, act, notify }) {
  const [val, setVal] = useState('');
  const [saved, setSaved] = useState(false);
  return (
    <form className="field" style={{ margin: '10px 0' }} onSubmit={async e => {
      e.preventDefault();
      if (await act('saveKey', { name, value: val })) {
        setVal('');
        setSaved(true);
        notify(`Saved ${name} encrypted locally.`, 'ok');
      }
    }}>
      <span>{label} <code className="mono" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{name}</code></span>
      <div className="row">
        <input type="password" autoComplete="off" value={val} onChange={e => setVal(e.target.value)} placeholder="Stored encrypted with Windows DPAPI (never sent to models)" />
        <button className="btn-primary" disabled={!val.trim()}>Save</button>
        <button type="button" className="btn-secondary" onClick={async () => { if (await act('saveKey', { name, value: '' })) { setSaved(false); notify(`Cleared ${name}.`, 'info'); } }}>Clear</button>
      </div>
      {saved && <small className="hint" style={{ color: 'var(--ok-fg)' }}>Saved in local vault.</small>}
    </form>
  );
}

export default function SettingsView({ state, appearance, models, reloadModels, balance, balanceBusy, refreshBalance, act, notify, navigate, updateStatus, onRefreshUpdate }) {
  const s = state.settings;
  const customProviders = s.customProviders || [];
  const activeProvider = detectProviderId(s.model, customProviders);
  const builtinMeta = PROVIDER_META[activeProvider];
  const customMeta = customProviders.find(p => p.id === activeProvider);

  const [section, setSection] = useState('providers');
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState('');
  const [customUrl, setCustomUrl] = useState(s.customBaseUrl || 'http://localhost:11434/v1');
  const [globalInstr, setGlobalInstr] = useState(s.globalInstructions || '');
  const [customAddendum, setCustomAddendum] = useState(s.customSystemPrompt || '');
  const [customCss, setCustomCss] = useState(s.customCss || '');
  const [extraBodyText, setExtraBodyText] = useState(s.extraBody ? JSON.stringify(s.extraBody, null, 2) : '');
  const [extraHeadersText, setExtraHeadersText] = useState(s.extraHeaders ? JSON.stringify(s.extraHeaders, null, 2) : '');
  const [connSecretName, setConnSecretName] = useState('CONNECTOR_API');

  // New custom provider form
  const [newProv, setNewProv] = useState({ id: '', name: '', baseUrl: '', apiFormat: 'openai', defaultModel: '', optionalKey: true });

  // Raw nexus.config.json editor
  const [configPath, setConfigPath] = useState('');
  const [rawConfig, setRawConfig] = useState('');
  const [sysInfo, setSysInfo] = useState(null);
  const [hostInfo, setHostInfo] = useState(null);
  const [logs, setLogs] = useState(null);
  const [availableTools, setAvailableTools] = useState([]);
  const [newAllowRule, setNewAllowRule] = useState('');
  const [newDenyRule, setNewDenyRule] = useState('');
  const [modelSearch, setModelSearch] = useState('');

  useEffect(() => { setGlobalInstr(s.globalInstructions || ''); }, [s.globalInstructions]);
  useEffect(() => { setCustomAddendum(s.customSystemPrompt || ''); }, [s.customSystemPrompt]);
  useEffect(() => { setCustomCss(s.customCss || ''); }, [s.customCss]);

  useEffect(() => {
    if (section === 'config') {
      api('getConfig').then(res => { setConfigPath(res.path); setRawConfig(res.raw); }).catch(() => {});
    }
    if (section === 'autonomy' && !availableTools.length) {
      api('availableTools').then(list => setAvailableTools(list || [])).catch(() => {});
    }
    if (section === 'system') {
      Promise.all([api('systemInfo').catch(() => null), api('hostInfo').catch(() => null), api('getLogs').catch(() => null)]).then(([si, hi, lg]) => {
        setSysInfo(si);
        setHostInfo(hi);
        setLogs(lg);
      });
    }
  }, [section]);

  const setSetting = (key, val) => act('settings', { [key]: val });
  const disabledTools = new Set(s.disabledTools || []);

  const toggleTool = name => {
    const next = new Set(disabledTools);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    void setSetting('disabledTools', [...next]);
  };

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1>Settings & Power-User Control</h1>
            <p className="subtitle">Full control over providers, model parameters, tools, custom CSS, and live <code>nexus.config.json</code>. Zero client-side content filters.</p>
          </div>
          <div className="row">
            <button type="button" className="btn-secondary" onClick={() => act('openDataDir')}><FolderOpen size={14} /> Open Data Folder</button>
            <button type="button" className="btn-secondary" onClick={() => act('openDevTools')}><Terminal size={14} /> DevTools</button>
          </div>
        </div>

        <div className="sticky-pills">
          {[
            ['providers', Globe, 'Providers & Models'],
            ['params', Sliders, 'Parameters & Prompt'],
            ['appearance', Palette, 'Themes & Custom CSS'],
            ['autonomy', ShieldOff, 'Autonomy & Tools'],
            ['storage', Database, 'Storage & Recovery'],
            ['system', Cpu, 'System & Host'],
            ['config', FileJson, 'nexus.config.json'],
          ].map(([id, Icon, label]) => (
            <button key={id} type="button" aria-pressed={section === id} onClick={() => setSection(id)}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {section === 'providers' && (
          <div className="settings-grid">
            <section className="panel-card">
              <h2>Active Provider & Connection</h2>
              <label className="field">
                <span>Provider Service</span>
                <select
                  aria-label="Model service"
                  value={activeProvider}
                  onChange={e => {
                    const next = e.target.value;
                    setCheckMsg('');
                    const built = PROVIDER_META[next];
                    if (built) {
                      if (next === 'arliai') void act('settings', { model: built.defaultModel, reasoningEffort: 'max', providerRouting: 'auto', contextWindow: 96000, concurrency: 1 });
                      else void act('settings', { model: built.defaultModel, reasoningEffort: built.effort });
                    } else {
                      const cp = customProviders.find(p => p.id === next);
                      if (cp) void act('settings', { model: `${cp.id}/${cp.defaultModel || 'default'}` });
                    }
                  }}
                >
                  {Object.entries(PROVIDER_META).map(([id, m]) => <option key={id} value={id}>{m.name}</option>)}
                  {customProviders.map(cp => <option key={cp.id} value={cp.id}>Custom · {cp.name}</option>)}
                </select>
              </label>

              <p className="hint">{builtinMeta?.hint || `Custom ${customMeta?.apiFormat || 'openai'} endpoint at ${customMeta?.baseUrl}`}</p>

              <div className="row-between" style={{ marginBottom: 10 }}>
                <span className={`pill ${state.providerKeys?.[activeProvider] ? 'ok' : 'warn'}`}>
                  {state.providerKeys?.[activeProvider] ? 'Ready / Credential Saved' : 'Credential Not Set'}
                </span>
                <button type="button" className="btn-secondary" disabled={checking} onClick={async () => {
                  setChecking(true); setCheckMsg('');
                  try {
                    const res = await act(activeProvider === 'arliai' ? 'checkArli' : 'checkProvider', { provider: activeProvider });
                    if (res?.ok) {
                      setCheckMsg(`Verified: ${res.models?.length ?? 0} models reachable.`);
                      await reloadModels();
                    }
                  } finally { setChecking(false); }
                }}>{checking ? 'Checking…' : 'Verify Connection'}</button>
              </div>

              {activeProvider === 'custom' && (
                <label className="field">
                  <span>OpenAI-Compatible Base URL</span>
                  <div className="row">
                    <input value={customUrl} onChange={e => setCustomUrl(e.target.value)} placeholder="http://localhost:11434/v1" />
                    <button type="button" className="btn-secondary" onClick={async () => { await setSetting('customBaseUrl', customUrl); await reloadModels(); notify('Updated local endpoint URL.', 'ok'); }}>Save URL</button>
                  </div>
                </label>
              )}

              <SecretRow
                key={activeProvider}
                name={builtinMeta?.key || customMeta?.keyName || 'CUSTOM_API_KEY'}
                label={`${builtinMeta?.name || customMeta?.name || activeProvider} API Key / Token`}
                act={act}
                notify={notify}
              />

              {activeProvider === 'copilot' && (
                <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                  <button type="button" className="btn-secondary" disabled={checking} onClick={async () => {
                    setChecking(true);
                    try {
                      const res = await act('importCopilotToken');
                      if (res?.ok) { setCheckMsg(`Imported token from ${res.source}.`); notify(`Imported GitHub token from ${res.source}.`, 'ok'); }
                    } finally { setChecking(false); }
                  }}><KeyRound size={14} /> Import from GitHub CLI / Copilot</button>
                </div>
              )}

              {checkMsg && <p className="hint" style={{ color: 'var(--ok-fg)', marginTop: 8 }}><CheckCircle2 size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />{checkMsg}</p>}

              <label className="field" style={{ marginTop: 16 }}>
                <span>Default Model ID ({providerLabel(activeProvider, customProviders)})</span>
                <input list="settings-models" value={s.model || ''} onChange={e => setSetting('model', e.target.value)} />
                <datalist id="settings-models">
                  {filterModelsForProvider(models, s, activeProvider, { activeModelId: s.model }).map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </datalist>
              </label>

              {(() => {
                const providerAllModels = filterModelsForProvider(models, s, activeProvider, { includeAllOfProvider: true });
                const enabledMap = s.enabledModels || {};
                const enabledList = Array.isArray(enabledMap[activeProvider]) ? enabledMap[activeProvider] : [];
                const q = modelSearch.trim().toLowerCase();
                const visibleList = providerAllModels
                  .filter(m => !q || (m.id + ' ' + (m.name || '')).toLowerCase().includes(q))
                  .slice(0, 60);
                const toggleModel = id => {
                  const cur = enabledList.length ? new Set(enabledList) : new Set(providerAllModels.map(m => m.id));
                  if (cur.has(id)) cur.delete(id);
                  else cur.add(id);
                  const nextMap = { ...enabledMap };
                  if (cur.size === 0 || cur.size >= providerAllModels.length) delete nextMap[activeProvider];
                  else nextMap[activeProvider] = [...cur];
                  void setSetting('enabledModels', nextMap);
                };
                return (
                  <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
                    <div className="row-between" style={{ marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                      <strong style={{ fontSize: 12.5 }}>
                        Enabled Models in Picker · {providerLabel(activeProvider, customProviders)}{' '}
                        <span className="hint tabular">({enabledList.length ? `${enabledList.length}/${providerAllModels.length}` : `All ${providerAllModels.length}`})</span>
                      </strong>
                      <div className="row" style={{ gap: 4 }}>
                        <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: '3px 7px' }} onClick={() => reloadModels()}>
                          <RefreshCw size={11} /> Reload
                        </button>
                        {enabledList.length > 0 && (
                          <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: '3px 7px' }} onClick={() => {
                            const nextMap = { ...enabledMap };
                            delete nextMap[activeProvider];
                            void setSetting('enabledModels', nextMap);
                          }}>Enable All</button>
                        )}
                      </div>
                    </div>
                    <p className="hint" style={{ marginBottom: 8 }}>The composer model menu shows ONLY enabled models for the currently selected provider.</p>
                    {providerAllModels.length > 8 && (
                      <input
                        placeholder={`Filter ${providerLabel(activeProvider, customProviders)} models…`}
                        value={modelSearch}
                        onChange={e => setModelSearch(e.target.value)}
                        style={{ marginBottom: 8, padding: '5px 9px', fontSize: 12 }}
                      />
                    )}
                    <div className="tool-toggle-grid" style={{ maxHeight: 220, overflowY: 'auto' }}>
                      {visibleList.map(m => {
                        const checked = enabledList.length === 0 || enabledList.includes(m.id);
                        return (
                          <label key={m.id} className={`tool-toggle-chip ${checked ? '' : 'disabled'}`} title={m.id}>
                            <input type="checkbox" checked={checked} onChange={() => toggleModel(m.id)} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || m.id}</span>
                          </label>
                        );
                      })}
                      {!visibleList.length && <span className="hint">No models loaded for this provider yet. Click Reload or Verify Connection.</span>}
                    </div>
                  </div>
                );
              })()}
            </section>

            <section className="panel-card">
              <h2>Custom Provider Profiles ({customProviders.length})</h2>
              <p className="hint">Add unlimited OpenAI-compatible or Anthropic-compatible servers (vLLM, Ollama, LM Studio, LiteLLM, corporate proxies, local fine-tunes).</p>
              <form onSubmit={async e => {
                e.preventDefault();
                if (!newProv.id.trim() || !newProv.baseUrl.trim()) return;
                const next = [...customProviders.filter(p => p.id !== newProv.id.trim().toLowerCase()), { ...newProv, id: newProv.id.trim().toLowerCase(), name: newProv.name.trim() || newProv.id.trim() }];
                if (await setSetting('customProviders', next)) {
                  setNewProv({ id: '', name: '', baseUrl: '', apiFormat: 'openai', defaultModel: '', optionalKey: true });
                  await reloadModels();
                  notify('Custom provider profile added.', 'ok');
                }
              }}>
                <div className="grid-2">
                  <label className="field"><span>Namespace ID (e.g. lmstudio)</span><input required value={newProv.id} onChange={e => setNewProv({ ...newProv, id: e.target.value })} placeholder="ollama-gpu" /></label>
                  <label className="field"><span>Display Name</span><input value={newProv.name} onChange={e => setNewProv({ ...newProv, name: e.target.value })} placeholder="Ollama GPU Rig" /></label>
                </div>
                <label className="field"><span>Base URL</span><input required value={newProv.baseUrl} onChange={e => setNewProv({ ...newProv, baseUrl: e.target.value })} placeholder="http://192.168.1.50:11434/v1" /></label>
                <div className="grid-2">
                  <label className="field"><span>API Format</span><select value={newProv.apiFormat} onChange={e => setNewProv({ ...newProv, apiFormat: e.target.value })}><option value="openai">OpenAI Compatible (/chat/completions)</option><option value="anthropic">Anthropic Native (/messages)</option></select></label>
                  <label className="field"><span>Default Model</span><input value={newProv.defaultModel} onChange={e => setNewProv({ ...newProv, defaultModel: e.target.value })} placeholder="qwen3:32b" /></label>
                </div>
                <button className="btn-primary"><Plus size={14} /> Add Custom Provider</button>
              </form>

              {customProviders.length > 0 && (
                <div style={{ marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                  {customProviders.map(cp => (
                    <div key={cp.id} className="list-row">
                      <div>
                        <strong>{cp.name}</strong> <span className="pill" style={{ marginLeft: 6 }}>{cp.id}/ · {cp.apiFormat}</span>
                        <div className="hint mono">{cp.baseUrl}</div>
                      </div>
                      <button type="button" className="btn-danger" onClick={() => setSetting('customProviders', customProviders.filter(p => p.id !== cp.id))}><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="panel-card">
              <h2>OpenRouter Balance & Management Key</h2>
              <div className="row-between" style={{ marginBottom: 10 }}>
                <strong className="tabular" style={{ fontSize: 22 }}>{formatMoney(balance?.remaining)}</strong>
                <button type="button" className="btn-secondary" disabled={balanceBusy} onClick={refreshBalance}><RefreshCw size={14} /> Refresh</button>
              </div>
              <SecretRow name="OPENROUTER_MANAGEMENT_KEY" label="Management Key (optional)" act={act} notify={notify} />
              <p className="hint">Key remaining: {balance?.keyUnlimited ? 'Unlimited' : formatMoney(balance?.keyRemaining)}.</p>
            </section>

            <section className="panel-card">
              <h2>Connector & MCP Secret Vault</h2>
              <p className="hint">Store secrets referenced by REST Connectors (<code>CONNECTOR_*</code>) or Custom Providers (<code>PROVIDER_*</code>).</p>
              <label className="field"><span>Secret Key Name</span><input className="mono" value={connSecretName} onChange={e => setConnSecretName(e.target.value.toUpperCase())} /></label>
              <SecretRow name={connSecretName} label="Secret Value" act={act} notify={notify} />
            </section>

            <section className="panel-card wide">
              <h2>Private & AI Search Engine API Keys (DPAPI Vault)</h2>
              <p className="hint">Optional keys for zero-tracking or AI-native search APIs (SearXNG, DuckDuckGo, Mojeek HTML, Ahmia, and Torch .onion work with zero keys). Configure search routing in the Private Browser view.</p>
              <div className="grid-2">
                <SecretRow name="SEARCH_BRAVE_KEY" label="Brave Search API (Zero Data Retention)" act={act} notify={notify} />
                <SecretRow name="SEARCH_KAGI_KEY" label="Kagi Search API (Zero Ads / Zero Tracking)" act={act} notify={notify} />
                <SecretRow name="SEARCH_LANGSEARCH_KEY" label="LangSearch API (AI Semantic Search)" act={act} notify={notify} />
                <SecretRow name="SEARCH_TAVILY_KEY" label="Tavily AI Search API" act={act} notify={notify} />
                <SecretRow name="SEARCH_EXA_KEY" label="Exa Neural Search API" act={act} notify={notify} />
                <SecretRow name="SEARCH_MOJEEK_KEY" label="Mojeek Official API (optional)" act={act} notify={notify} />
              </div>
            </section>
          </div>
        )}

        {section === 'params' && (
          <div className="settings-grid">
            <section className="panel-card">
              <h2>Generation Parameters & Raw JSON Overrides</h2>
              <p className="hint">Leave blank to use provider defaults. Values set here are sent directly in outbound model payloads.</p>
              <div className="grid-2">
                <label className="field"><span>Temperature (0–2)</span><input type="number" step="0.05" min="0" max="2" placeholder="Default" defaultValue={s.temperature ?? ''} onBlur={e => setSetting('temperature', e.target.value === '' ? null : Number(e.target.value))} /></label>
                <label className="field"><span>Top P (0–1)</span><input type="number" step="0.05" min="0" max="1" placeholder="Default" defaultValue={s.topP ?? ''} onBlur={e => setSetting('topP', e.target.value === '' ? null : Number(e.target.value))} /></label>
                <label className="field"><span>Presence Penalty (-2 to 2)</span><input type="number" step="0.1" min="-2" max="2" placeholder="Default" defaultValue={s.presencePenalty ?? ''} onBlur={e => setSetting('presencePenalty', e.target.value === '' ? null : Number(e.target.value))} /></label>
                <label className="field"><span>Frequency Penalty (-2 to 2)</span><input type="number" step="0.1" min="-2" max="2" placeholder="Default" defaultValue={s.frequencyPenalty ?? ''} onBlur={e => setSetting('frequencyPenalty', e.target.value === '' ? null : Number(e.target.value))} /></label>
              </div>
              <label className="field"><span>Seed (integer, optional)</span><input type="number" placeholder="Random" defaultValue={s.seed ?? ''} onBlur={e => setSetting('seed', e.target.value === '' ? null : Math.round(Number(e.target.value)))} /></label>

              <label className="field"><span>Extra Request Body JSON (merged into payload)</span><textarea className="mono" rows={4} value={extraBodyText} onChange={e => setExtraBodyText(e.target.value)} placeholder='{"repetition_penalty": 1.05}' /></label>
              <label className="field"><span>Extra HTTP Headers JSON</span><textarea className="mono" rows={3} value={extraHeadersText} onChange={e => setExtraHeadersText(e.target.value)} placeholder='{"X-Custom-Header": "value"}' /></label>
              <button type="button" className="btn-primary" onClick={() => {
                try {
                  const body = extraBodyText.trim() ? JSON.parse(extraBodyText) : null;
                  const headers = extraHeadersText.trim() ? JSON.parse(extraHeadersText) : null;
                  void act('settings', { extraBody: body, extraHeaders: headers });
                  notify('Saved raw request overrides.', 'ok');
                } catch (err) { notify('Invalid JSON: ' + cleanError(err), 'error'); }
              }}>Save Raw Overrides</button>
            </section>

            <section className="panel-card">
              <h2>Context Window, Compaction & Web Search</h2>
              <label className="field">
                <span>Auto-compact trigger: {s.compressionPercent}%</span>
                <input type="range" min="10" max="95" value={s.compressionPercent} onChange={e => setSetting('compressionPercent', +e.target.value)} />
              </label>
              <div className="grid-2">
                <label className="field"><span>Context Ceiling (tokens)</span><input type="number" key={s.contextWindow} defaultValue={s.contextWindow} min="8000" max="10000000" onBlur={e => setSetting('contextWindow', +e.target.value)} /></label>
                <label className="field"><span>Max Output (0 = provider max)</span><input type="number" key={s.maxOutput} defaultValue={s.maxOutput} min="0" max="1000000" onBlur={e => setSetting('maxOutput', +e.target.value)} /></label>
              </div>
              <label className="switch-row">
                <div><strong>Real-time Streaming (SSE)</strong><p>Disable only for custom servers without SSE support.</p></div>
                <input type="checkbox" className="switch-input" checked={s.streaming} onChange={e => setSetting('streaming', e.target.checked)} />
              </label>
              <label className="switch-row">
                <div><strong>Silent Tool Chaining (Skip Intermediate Follow-Ups)</strong><p>Instructs the model to chain function calls directly without narrating between steps, speaking only at the final answer or when it needs to ask you something important.</p></div>
                <input type="checkbox" className="switch-input" checked={!!s.silentToolSteps} onChange={e => setSetting('silentToolSteps', e.target.checked)} />
              </label>
              <label className="switch-row">
                <div><strong>Smart Lazy Toolsets (<code>load_toolset</code>)</strong><p>Start each turn with ~18 core tools and dynamically activate optional groups (Git, Web, Sessions, MCP, Desktop, Plugins) on demand — cuts input tokens by ~50–60%.</p></div>
                <input type="checkbox" className="switch-input" checked={!!s.lazyToolLoading} onChange={e => setSetting('lazyToolLoading', e.target.checked)} />
              </label>
              <label className="switch-row">
                <div><strong>Explicit Prompt Caching (<code>cache_control</code>)</strong><p>Inserts ephemeral cache breakpoints on Anthropic Direct and OpenRouter Claude/Gemini payloads + byte-stable prefixes.</p></div>
                <input type="checkbox" className="switch-input" checked={s.promptCaching !== false} onChange={e => setSetting('promptCaching', e.target.checked)} />
              </label>
              <label className="switch-row">
                <div><strong>Stage 1 Zero-Cost Micro-Compaction</strong><p>Automatically prunes old oversized tool outputs into lossless artifact pointers ($0 cost) before triggering full LLM compaction.</p></div>
                <input type="checkbox" className="switch-input" checked={s.microCompaction !== false} onChange={e => setSetting('microCompaction', e.target.checked)} />
              </label>
              <label className="switch-row">
                <div><strong>OpenRouter Prompt Cache Affinity</strong><p>Sends an opaque per-conversation session hash to improve cache hits.</p></div>
                <input type="checkbox" className="switch-input" checked={!!s.cacheAffinity} onChange={e => setSetting('cacheAffinity', e.target.checked)} />
              </label>
              <label className="switch-row">
                <div><strong>OpenRouter Native Web Search</strong><p>Allows OpenRouter models to invoke server-side web search with structured citations.</p></div>
                <input type="checkbox" className="switch-input" checked={!!s.webSearchEnabled} onChange={e => setSetting('webSearchEnabled', e.target.checked)} />
              </label>
              <label className="field" style={{ marginTop: 12 }}>
                <span>Web Tool User-Agent Override (blank = standard Edge/Chrome Windows browser)</span>
                <input
                  key={s.webUserAgent || 'default-ua'}
                  defaultValue={s.webUserAgent || ''}
                  placeholder="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 …"
                  onBlur={e => setSetting('webUserAgent', e.target.value.trim())}
                />
              </label>
            </section>

            <section className="panel-card wide">
              <div className="row-between" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <div className="row" style={{ gap: 8 }}>
                  <h2 style={{ margin: 0 }}>Global System Instructions & Custom Prompt Protection</h2>
                  <span className={`pill ${s.globalInstructionsCustomized ? 'ok' : 'info'}`}>
                    <ShieldCheck size={12} /> {s.globalInstructionsCustomized ? 'Customized · Update-Protected' : 'Stock Default · Auto-Upgrades Safely'}
                  </span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn-secondary" style={{ fontSize: 12 }} onClick={async () => {
                    const res = await act('backupCustomPrompts');
                    if (res?.ok) notify(`Backed up custom prompts to ${res.backupDir}`, 'ok');
                  }}><Archive size={13} /> Backup Prompts</button>
                  {s.globalInstructionsCustomized && (
                    <button type="button" className="btn-secondary" style={{ fontSize: 12 }} onClick={async () => {
                      await act('settings', { resetGlobalInstructions: true });
                      notify('Restored latest stock base instructions (your Custom Prompt Addendum below is untouched).', 'ok');
                    }}>Reset Base to Stock</button>
                  )}
                </div>
              </div>
              <p className="hint">Any edit you make to Global System Instructions is automatically flagged as customized and will NEVER be overwritten by future NEXUS releases or GitHub auto-updates.</p>
              <textarea rows={6} value={globalInstr} onChange={e => setGlobalInstr(e.target.value)} style={{ marginBottom: 10 }} />
              <button type="button" className="btn-primary" disabled={globalInstr === s.globalInstructions} onClick={() => { void setSetting('globalInstructions', globalInstr); notify('Global instructions saved & locked against update overwrites.', 'ok'); }}>Save Global Instructions</button>

              <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>Personal Custom System Prompt Addendum (Always Preserved)</h3>
                <p className="hint">Recommended place for your permanent persona, tone, rules, or private directives. Appended on every turn and completely decoupled from NEXUS stock updates.</p>
                <textarea rows={4} value={customAddendum} onChange={e => setCustomAddendum(e.target.value)} placeholder="Write your permanent custom system directives here — never overwritten on upgrade…" style={{ marginBottom: 10 }} />
                <button type="button" className="btn-primary" disabled={customAddendum === (s.customSystemPrompt || '')} onClick={() => { void setSetting('customSystemPrompt', customAddendum); notify('Custom system prompt addendum saved.', 'ok'); }}>Save Personal Addendum</button>
              </div>
            </section>
          </div>
        )}

        {section === 'appearance' && (
          <div className="settings-grid">
            <section className="panel-card">
              <h2>Theme, Density & Motion</h2>
              <label className="field">
                <span>Color Theme</span>
                <select aria-label="Interface theme" value={appearance.preferences.theme} onChange={e => appearance.update('theme', e.target.value)}>
                  <option value="dark">Obsidian (Dark)</option>
                  <option value="light">Studio Paper (Light)</option>
                  <option value="slate">Midnight Slate</option>
                  <option value="system">Match Windows System Theme</option>
                </select>
              </label>
              <label className="field">
                <span>Layout Density</span>
                <select aria-label="Interface density" value={appearance.preferences.density} onChange={e => appearance.update('density', e.target.value)}>
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact · High Information Density</option>
                </select>
              </label>
              <label className="field">
                <span>Motion & Animations</span>
                <select aria-label="Interface animations" value={appearance.preferences.motion} onChange={e => appearance.update('motion', e.target.value)}>
                  <option value="system">Fluid · Respect Windows Reduce Motion</option>
                  <option value="reduced">Reduced Motion</option>
                </select>
              </label>

              <div className="field">
                <span>Custom Accent Color</span>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {ACCENT_SWATCHES.map(hex => (
                    <button
                      key={hex}
                      type="button"
                      title={hex}
                      onClick={() => setSetting('accentColor', hex)}
                      style={{ width: 26, height: 26, borderRadius: '50%', background: hex, padding: 0, border: s.accentColor === hex ? '2px solid var(--ink)' : '1px solid var(--border)' }}
                    />
                  ))}
                  <input value={s.accentColor || ''} placeholder="#3ecf8e" style={{ width: 110, padding: '5px 8px' }} onChange={e => setSetting('accentColor', e.target.value)} />
                  {s.accentColor && <button type="button" className="btn-secondary" style={{ padding: '5px 8px', fontSize: 11 }} onClick={() => setSetting('accentColor', '')}>Reset</button>}
                </div>
              </div>
            </section>

            <section className="panel-card">
              <h2>Live Custom CSS Override</h2>
              <p className="hint">Inject any custom CSS rules live into NEXUS — tweak fonts, radii, sidebar widths, colors, or animations however you want.</p>
              <textarea className="mono" rows={10} value={customCss} onChange={e => setCustomCss(e.target.value)} placeholder={':root {\n  --radius-md: 6px;\n}\n.conversation {\n  max-width: 980px;\n}'} style={{ marginBottom: 10 }} />
              <div className="row">
                <button type="button" className="btn-primary" onClick={() => { void setSetting('customCss', customCss); notify('Custom CSS applied live.', 'ok'); }}>Apply Live CSS</button>
                {customCss && <button type="button" className="btn-secondary" onClick={() => { setCustomCss(''); void setSetting('customCss', ''); }}>Clear</button>}
              </div>
            </section>
          </div>
        )}

        {section === 'autonomy' && (
          <div className="settings-grid">
            <section className="panel-card">
              <h2>Default Autonomy Level & Local Environment</h2>
              <label className="field">
                <span>Default Autonomy Level for New Chats</span>
                <select value={normalizeAutonomyId(s.agentMode)} onChange={e => setSetting('agentMode', e.target.value)}>
                  {AUTONOMY_LEVELS.map(l => <option key={l.id} value={l.id}>{l.label} — {l.hint}</option>)}
                </select>
              </label>
              <label className="switch-row">
                <div><strong>Windows Desktop Automation</strong><p>Expose screen capture and native Win32 mouse/keyboard control tools to agents.</p></div>
                <input type="checkbox" className="switch-input" checked={s.desktopEnabled} onChange={e => setSetting('desktopEnabled', e.target.checked)} />
              </label>
              <label className="switch-row">
                <div><strong>Minimize to Windows System Tray</strong><p>Keep NEXUS running in the tray when closing the window (summon anytime with Ctrl+Shift+Space).</p></div>
                <input type="checkbox" className="switch-input" checked={!!s.minimizeToTray} onChange={e => { void setSetting('minimizeToTray', e.target.checked); void api('setTrayMode', { enabled: e.target.checked }); }} />
              </label>
              <div className="grid-2">
                <label className="field"><span>Concurrent Agents (1–64)</span><input type="number" key={s.concurrency} defaultValue={s.concurrency} min="1" max="64" onBlur={e => setSetting('concurrency', +e.target.value)} /></label>
                <label className="field"><span>Max Steps per Turn (0 = unlimited)</span><input type="number" key={s.maxSteps} defaultValue={s.maxSteps} min="0" max="1000000" onBlur={e => setSetting('maxSteps', +e.target.value)} /></label>
              </div>
            </section>

            <section className="panel-card">
              <div className="row-between" style={{ marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>Built-in Tools ({availableTools.length - disabledTools.size}/{availableTools.length} enabled)</h2>
                {disabledTools.size > 0 && <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => setSetting('disabledTools', [])}>Enable All</button>}
              </div>
              <p className="hint">Enable or disable any built-in agent tool individually. Disabled tools are omitted from model tool schemas to save context tokens.</p>
              <div className="tool-toggle-grid">
                {availableTools.map(tool => {
                  const enabled = !disabledTools.has(tool.name);
                  return (
                    <label key={tool.name} className={`tool-toggle-chip ${enabled ? '' : 'disabled'}`} title={tool.description}>
                      <input type="checkbox" checked={enabled} onChange={() => toggleTool(tool.name)} />
                      <span>{tool.name}</span>
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="panel-card wide">
              <h2>Semi-Autopilot Granular Allow & Deny Rules</h2>
              <p className="hint">Customize exactly which commands, tools, or paths bypass or always trigger confirmation in Semi-Autopilot mode. Formats: <code>tool_name</code>, <code>tool:substring</code> (e.g. <code>run_command:npm test</code>, <code>git_operation:push</code>), or <code>/regex/i</code>. Deny rules always take precedence.</p>
              <div className="grid-2" style={{ marginTop: 10 }}>
                <div>
                  <strong style={{ fontSize: 12.5, display: 'block', marginBottom: 6, color: 'var(--ok-fg)' }}>Always Allow Rules ({(s.semiAutoAllowRules || []).length})</strong>
                  <form className="row" style={{ marginBottom: 8 }} onSubmit={e => {
                    e.preventDefault();
                    if (!newAllowRule.trim()) return;
                    void setSetting('semiAutoAllowRules', [...new Set([...(s.semiAutoAllowRules || []), newAllowRule.trim()])]);
                    setNewAllowRule('');
                  }}>
                    <input className="mono" style={{ flex: 1 }} value={newAllowRule} onChange={e => setNewAllowRule(e.target.value)} placeholder="e.g. run_command:npm test" />
                    <button className="btn-secondary"><Plus size={13} /> Add</button>
                  </form>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 5 }}>
                    {(s.semiAutoAllowRules || []).map(rule => (
                      <span key={rule} className="pill ok mono" style={{ gap: 5 }}>
                        {rule}
                        <button type="button" style={{ padding: 0, background: 'none', color: 'inherit' }} onClick={() => setSetting('semiAutoAllowRules', (s.semiAutoAllowRules || []).filter(r => r !== rule))}>×</button>
                      </span>
                    ))}
                    {!(s.semiAutoAllowRules || []).length && <small className="hint">No custom allow rules yet.</small>}
                  </div>
                </div>

                <div>
                  <strong style={{ fontSize: 12.5, display: 'block', marginBottom: 6, color: 'var(--warn-fg)' }}>Always Ask (Deny) Rules ({(s.semiAutoDenyRules || []).length})</strong>
                  <form className="row" style={{ marginBottom: 8 }} onSubmit={e => {
                    e.preventDefault();
                    if (!newDenyRule.trim()) return;
                    void setSetting('semiAutoDenyRules', [...new Set([...(s.semiAutoDenyRules || []), newDenyRule.trim()])]);
                    setNewDenyRule('');
                  }}>
                    <input className="mono" style={{ flex: 1 }} value={newDenyRule} onChange={e => setNewDenyRule(e.target.value)} placeholder="e.g. run_command:docker or /prod/i" />
                    <button className="btn-secondary"><Plus size={13} /> Add</button>
                  </form>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 5 }}>
                    {(s.semiAutoDenyRules || []).map(rule => (
                      <span key={rule} className="pill warn mono" style={{ gap: 5 }}>
                        {rule}
                        <button type="button" style={{ padding: 0, background: 'none', color: 'inherit' }} onClick={() => setSetting('semiAutoDenyRules', (s.semiAutoDenyRules || []).filter(r => r !== rule))}>×</button>
                      </span>
                    ))}
                    {!(s.semiAutoDenyRules || []).length && <small className="hint">No custom deny rules yet.</small>}
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {section === 'storage' && (
          <div className="settings-grid">
            <StoragePanel state={state} act={act} />
          </div>
        )}

        {section === 'system' && (
          <div className="settings-grid">
            <section className="panel-card">
              <h2>Standalone Native Runtime</h2>
              {hostInfo ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div className="list-row"><span className="hint">App Architecture</span><strong>{hostInfo.nativeHost ? 'Native Windows .NET 10 + WebView2 (Zero Electron)' : 'Standalone Local Core + Browser'}</strong></div>
                  <div className="list-row"><span className="hint">Engine Version</span><strong className="mono">NEXUS v{hostInfo.version} · Node {hostInfo.nodeVersion}</strong></div>
                  <div className="list-row">
                    <span className="hint">Windows Privileges</span>
                    <div className="row" style={{ gap: 8 }}>
                      <span className={`pill ${hostInfo.isElevated ? 'warn' : 'ok'}`}>{hostInfo.isElevated ? 'Administrator (Elevated)' : 'Standard User'}</span>
                      {hostInfo.nativeHost && !hostInfo.isElevated && (
                        <button type="button" className="btn-secondary" style={{ fontSize: 11.5, padding: '3px 8px' }} onClick={() => void api('relaunchElevated').catch(e => notify(cleanError(e), 'error'))}>
                          Restart as Admin
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="list-row"><span className="hint">Global Summon Hotkey</span><strong className="mono">Ctrl + Shift + Space</strong></div>
                  <div className="list-row"><span className="hint">Data Directory</span><strong className="mono" style={{ fontSize: 11.5 }}>{hostInfo.dataDir}</strong></div>
                  <div className="list-row"><span className="hint">Live Config File</span><strong className="mono" style={{ fontSize: 11.5 }}>{hostInfo.configPath}</strong></div>
                </div>
              ) : <p className="hint">Loading host info…</p>}
            </section>

            <section className="panel-card">
              <h2>Host Machine & Developer Runtimes</h2>
              {sysInfo ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div className="list-row"><span className="hint">OS / Arch</span><strong>{sysInfo.platform} ({sysInfo.arch}) · {sysInfo.release}</strong></div>
                  <div className="list-row"><span className="hint">CPU / RAM</span><strong className="tabular">{sysInfo.cpus} cores · {sysInfo.freeMemoryGb} / {sysInfo.totalMemoryGb} GB free</strong></div>
                  {Object.entries(sysInfo.tools || {}).map(([name, ver]) => (
                    <div key={name} className="list-row"><span className="hint mono">{name}</span><span className={`pill ${ver ? 'ok' : ''}`}>{ver || 'Not detected'}</span></div>
                  ))}
                </div>
              ) : <p className="hint">Inspecting environment…</p>}
            </section>

            <section className="panel-card">
              <h2>GitHub Auto-Updates & Prompt Safety</h2>
              <label className="switch-row">
                <div><strong>Automatically Check GitHub Releases on Startup</strong><p>Checks for new releases in the background (routed through Tor when All-App Tor is active) without auto-installing until you approve.</p></div>
                <input type="checkbox" className="switch-input" checked={s.autoCheckUpdates !== false} onChange={e => setSetting('autoCheckUpdates', e.target.checked)} />
              </label>
              <label className="field" style={{ marginTop: 10 }}>
                <span>GitHub Release Repository (owner/repo)</span>
                <input className="mono" key={s.updateRepo || 'Ezequiel24123z/Nexus'} defaultValue={s.updateRepo || 'Ezequiel24123z/Nexus'} onBlur={e => setSetting('updateRepo', e.target.value.trim() || 'Ezequiel24123z/Nexus')} />
              </label>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => void onRefreshUpdate?.()}>
                  <RefreshCw size={13} /> Check GitHub Now
                </button>
                <button type="button" className="btn-primary" onClick={() => navigate?.('changelog')}>
                  <History size={13} /> Open Changelog & Updater
                </button>
              </div>
              {updateStatus?.updateAvailable && (
                <p className="hint" style={{ color: 'var(--ok-fg)', marginTop: 8 }}>
                  Update ready: NEXUS v{updateStatus.latestVersion} (installed: v{updateStatus.currentVersion}).
                </p>
              )}
            </section>

            <section className="panel-card wide">
              <div className="row-between" style={{ marginBottom: 10 }}>
                <div>
                  <h2 style={{ margin: 0 }}>Runtime & Crash Diagnostics Logs</h2>
                  <small className="hint mono">{logs?.logsDir || ''}</small>
                </div>
                <button type="button" className="btn-secondary" onClick={() => api('getLogs').then(setLogs).catch(() => {})}><RefreshCw size={13} /> Refresh Logs</button>
              </div>
              <div className="grid-2">
                <div>
                  <h3 style={{ fontSize: 12.5 }}>Native Host Log (host.log)</h3>
                  <pre className="pre-box" style={{ maxHeight: 220, fontSize: 11 }}>{logs?.host || '(No host errors recorded)'}</pre>
                </div>
                <div>
                  <h3 style={{ fontSize: 12.5 }}>Core Daemon Log (core.log)</h3>
                  <pre className="pre-box" style={{ maxHeight: 220, fontSize: 11 }}>{logs?.core || '(No core errors recorded)'}</pre>
                </div>
              </div>
            </section>
          </div>
        )}

        {section === 'config' && (
          <section className="panel-card">
            <div className="row-between" style={{ marginBottom: 10 }}>
              <div>
                <h2 style={{ margin: 0 }}>Raw Configuration (nexus.config.json)</h2>
                <small className="hint mono">{configPath} · Changes on disk hot-reload automatically</small>
              </div>
              <div className="row">
                <button type="button" className="btn-secondary" onClick={() => api('getConfig').then(r => setRawConfig(r.raw))}>Reload from Disk</button>
                <button type="button" className="btn-primary" onClick={async () => {
                  const res = await act('saveConfig', { raw: rawConfig });
                  if (res) { setRawConfig(res.raw); notify(`Applied ${res.appliedKeys.length} keys from nexus.config.json.`, 'ok'); }
                }}>Validate & Apply JSON</button>
              </div>
            </div>
            <textarea className="mono" rows={22} spellCheck={false} value={rawConfig} onChange={e => setRawConfig(e.target.value)} />
          </section>
        )}
      </div>
    </div>
  );
}
