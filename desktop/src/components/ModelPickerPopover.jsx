import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, Star, Search, SlidersHorizontal, Sparkles, Shield, ShieldAlert,
  Zap, Flame, Check, Hand, X
} from 'lucide-react';
import {
  classifyModel, FREEDOM_TIERS, CAPABILITY_FILTERS, OPENROUTER_UPSTREAMS, filterModelsForProvider
} from '../lib/model-catalog.mjs';
import {
  AUTONOMY_LEVELS, normalizeAutonomyId, detectProviderId, PROVIDER_META,
  providerLabel, formatPricePerM
} from '../lib/format.mjs';

const EFFORT_LEVELS = [
  ['none', 'Off'],
  ['low', 'Low'],
  ['medium', 'Med'],
  ['high', 'High'],
  ['xhigh', 'XHigh'],
  ['max', 'Max'],
  ['auto', 'Auto'],
];

const ROUTE_STRATEGIES = [
  ['auto', 'Auto'],
  ['price', 'Cheapest'],
  ['throughput', 'Fastest'],
  ['latency', 'Lowest Latency'],
];

const AUTONOMY_ICONS = {
  interactive: Hand,
  'semi-autopilot': Shield,
  autopilot: Zap,
  unrestricted: Flame,
};

export const MODES = AUTONOMY_LEVELS;

export default function ComposerControls({ task, settings, models, providerKeys = {}, act, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const popRef = useRef(null);
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  const customProviders = settings.customProviders || [];

  const activeModelId = task?.model || settings.model || '';
  const activeProvider = detectProviderId(activeModelId, customProviders);
  const activeEffort = task?.reasoningEffort ?? settings.reasoningEffort ?? 'none';
  const activeRoute = task?.providerRouting ?? settings.providerRouting ?? 'auto';
  const activeWindow = task?.contextWindow || settings.contextWindow || 50000;
  const activeOrder = task?.providerOrder || settings.providerOrder || [];
  const autonomy = normalizeAutonomyId(task?.agentMode || settings.agentMode || 'autopilot');
  const locked = Boolean(task && (task.compacting || ['running', 'approval', 'queued'].includes(task.status)));

  const classifiedCatalog = useMemo(() => {
    const favorites = settings.favoriteModels || [];
    const merged = [
      ...models,
      ...favorites.filter(id => !models.some(m => m.id === id)).map(id => ({ id, name: id })),
    ];
    return merged.map(m => classifyModel(m, customProviders));
  }, [models, settings.favoriteModels, customProviders]);

  const activeModelMeta = classifiedCatalog.find(m => m.id === activeModelId) || classifyModel({ id: activeModelId, name: activeModelId }, customProviders);

  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (popRef.current && !popRef.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const applyUpdate = patch => act(task ? 'updateChat' : 'settings', { ...(task ? { id: task.id } : {}), ...patch });

  return (
    <div className="composer-top" ref={popRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="model-trigger"
        aria-label="Choose model and thinking"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <Sparkles size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span>{activeModelMeta.name || activeModelId || 'Select model'}</span>
        <small className="tabular">
          · {EFFORT_LEVELS.find(([id]) => id === activeEffort)?.[1] || activeEffort} · {Math.round(activeWindow / 1000)}K
        </small>
        <ChevronDown size={14} style={{ flexShrink: 0, color: 'var(--ink-muted)' }} />
      </button>

      {/* 4-Tier Autonomy Level Segmented Selector */}
      <div className="mode-segmented" role="group" aria-label="Autonomy level">
        {AUTONOMY_LEVELS.map(level => {
          const Icon = AUTONOMY_ICONS[level.id] || Zap;
          const active = autonomy === level.id;
          return (
            <button
              key={level.id}
              type="button"
              disabled={locked}
              aria-pressed={active}
              title={level.hint}
              className={`mode-seg-btn ${level.id} ${active ? 'active' : ''}`}
              onClick={() => applyUpdate({ agentMode: level.id })}
            >
              <Icon size={12} />
              <span>{level.short}</span>
            </button>
          );
        })}
      </div>

      {open && (
        <ModelPopoverPanel
          task={task}
          settings={settings}
          catalog={classifiedCatalog}
          providerKeys={providerKeys}
          activeProvider={activeProvider}
          activeModelId={activeModelId}
          activeModelMeta={activeModelMeta}
          activeEffort={activeEffort}
          activeRoute={activeRoute}
          activeWindow={activeWindow}
          activeOrder={activeOrder}
          locked={locked}
          applyUpdate={applyUpdate}
          act={act}
          close={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function ModelPopoverPanel({
  task, settings, catalog, providerKeys, activeProvider, activeModelId, activeModelMeta,
  activeEffort, activeRoute, activeWindow, activeOrder,
  locked, applyUpdate, act, close,
}) {
  const customProviders = settings.customProviders || [];
  const favorites = settings.favoriteModels || [];
  const enabledModelsMap = settings.enabledModels || {};
  const [query, setQuery] = useState('');
  const [freedomFilter, setFreedomFilter] = useState('all');
  const [capFilter, setCapFilter] = useState('all');
  const [selectedProvider, setSelectedProvider] = useState(activeProvider);
  const [manageMode, setManageMode] = useState(false);
  const [sortBy, setSortBy] = useState('quality');
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [showConfig, setShowConfig] = useState(true);
  const [manualId, setManualId] = useState('');
  const [upstreamPin, setUpstreamPin] = useState((activeOrder || [])[0] || '');
  const searchRef = useRef(null);

  useEffect(() => { setSelectedProvider(activeProvider); }, [activeProvider]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  // Only list the active provider plus providers that actually have credentials/configuration enabled
  const providerOptions = useMemo(() => {
    const allBuiltins = Object.entries(PROVIDER_META).map(([id, m]) => [id, m.name]);
    const allCustom = customProviders.map(cp => [cp.id, `Custom · ${cp.name}`]);
    const combined = [...allBuiltins, ...allCustom];
    const filteredProvs = combined.filter(([id]) => id === activeProvider || id === selectedProvider || Boolean(providerKeys?.[id]));
    return filteredProvs.length ? filteredProvs : [[activeProvider, providerLabel(activeProvider, customProviders)]];
  }, [customProviders, providerKeys, activeProvider, selectedProvider]);

  const enabledForProvider = useMemo(
    () => (Array.isArray(enabledModelsMap[selectedProvider]) ? enabledModelsMap[selectedProvider] : []),
    [enabledModelsMap, selectedProvider]
  );
  const providerFullCatalog = useMemo(
    () => filterModelsForProvider(catalog, settings, selectedProvider, { activeModelId, includeAllOfProvider: true }),
    [catalog, settings, selectedProvider, activeModelId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const scoped = filterModelsForProvider(catalog, settings, selectedProvider, {
      activeModelId,
      includeAllOfProvider: manageMode,
    });
    const list = scoped.filter(item => {
      if (/:batch$/i.test(item.id) && !q.includes('batch')) return false;
      if (onlyFavs && !favorites.includes(item.id)) return false;
      if (freedomFilter !== 'all') {
        const targetRank = FREEDOM_TIERS.find(f => f.id === freedomFilter)?.rank ?? 99;
        if (item.freedomRank > targetRank) return false;
      }
      if (capFilter !== 'all' && !item.caps.has(capFilter)) return false;
      if (q && !(item.id + ' ' + item.name + ' ' + item.freedomLabel + ' ' + item.provider).toLowerCase().includes(q)) return false;
      return true;
    });

    list.sort((a, b) => {
      const favDiff = Number(favorites.includes(b.id)) - Number(favorites.includes(a.id));
      if (favDiff !== 0) return favDiff;
      if (sortBy === 'freedom') return a.freedomRank - b.freedomRank || b.quality - a.quality;
      if (sortBy === 'price') return (a.promptPerM ?? 999) - (b.promptPerM ?? 999);
      if (sortBy === 'context') return (b.context || 0) - (a.context || 0);
      return b.quality - a.quality;
    });
    return list.slice(0, 60);
  }, [catalog, settings, selectedProvider, activeModelId, manageMode, query, freedomFilter, capFilter, sortBy, onlyFavs, favorites]);

  const toggleEnabledModel = (e, id) => {
    e.stopPropagation();
    const cur = enabledForProvider.length
      ? new Set(enabledForProvider)
      : new Set(providerFullCatalog.map(m => m.id));
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    const nextMap = { ...enabledModelsMap };
    if (cur.size === 0 || cur.size >= providerFullCatalog.length) {
      delete nextMap[selectedProvider];
    } else {
      nextMap[selectedProvider] = [...cur];
    }
    void act('settings', { enabledModels: nextMap });
  };

  const selectModel = async id => {
    if (locked || !id) return;
    await applyUpdate({ model: id });
  };

  const toggleFav = (e, id) => {
    e.stopPropagation();
    const next = favorites.includes(id) ? favorites.filter(x => x !== id) : [...favorites, id];
    void act('settings', { favoriteModels: next });
  };

  const isOpenRouter = detectProviderId(activeModelId, customProviders) === 'openrouter';
  const modelMaxCtx = Number(activeModelMeta?.context) || 200000;
  const ctxPresets = [32000, 50000, 96000, 128000, 200000].filter(v => v <= Math.max(200000, modelMaxCtx));
  const supportedEfforts = activeModelMeta?.reasoning?.supported_efforts;

  return (
    <div className="model-popover" role="dialog" aria-label="Model selector">
      {/* Top Search & Quick Controls */}
      <div className="model-pop-head">
        <div className="sidebar-search" style={{ flex: 1, margin: 0 }}>
          <Search size={14} />
          <input
            ref={searchRef}
            placeholder={`Search ${providerLabel(selectedProvider, customProviders)} models…`}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && filtered[0]) { e.preventDefault(); void selectModel(filtered[0].id); }
            }}
          />
          {query && <button type="button" className="btn-icon" style={{ width: 20, height: 20 }} onClick={() => setQuery('')}><X size={12} /></button>}
        </div>
        <button
          type="button"
          className={manageMode ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '5px 8px', fontSize: 11.5 }}
          title="Choose which models of this provider are enabled in the picker"
          onClick={() => setManageMode(v => !v)}
        >
          {manageMode ? 'Done' : `Enabled${enabledForProvider.length ? ` (${enabledForProvider.length})` : ''}`}
        </button>
        <button
          type="button"
          className={onlyFavs ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '5px 8px', fontSize: 11.5 }}
          title="Show favorites only"
          onClick={() => setOnlyFavs(v => !v)}
        >
          <Star size={13} fill={onlyFavs ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className={showConfig ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '5px 9px', fontSize: 11.5 }}
          title="Toggle active model tuning"
          onClick={() => setShowConfig(v => !v)}
        >
          <SlidersHorizontal size={13} /> Tune
        </button>
      </div>

      {/* Filter Bar: Active Provider Scope + Freedom + Capability + Sort */}
      <div className="model-pop-filters">
        <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
          <span className="hint" style={{ fontSize: 10.5, fontWeight: 600, marginRight: 2 }}>Restrictions:</span>
          {[
            ['all', 'Any'],
            ['unrestricted', '0% Unrestricted'],
            ['minimal', 'Minimal (DeepSeek/Grok)'],
            ['low', 'Low (GLM/Qwen/Llama)'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`filter-chip ${freedomFilter === id ? 'active' : ''}`}
              onClick={() => setFreedomFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
          {CAPABILITY_FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              className={`filter-chip ${capFilter === f.id ? 'active' : ''}`}
              onClick={() => setCapFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
          <select aria-label="Selected provider" value={selectedProvider} onChange={e => setSelectedProvider(e.target.value)} style={{ width: 'auto', padding: '3px 8px', fontSize: 11, marginLeft: 'auto' }}>
            {providerOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <select aria-label="Sort models" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ width: 'auto', padding: '3px 8px', fontSize: 11 }}>
            <option value="quality">Best Capability</option>
            <option value="freedom">Least Restricted</option>
            <option value="price">Cheapest First</option>
            <option value="context">Largest Context</option>
          </select>
        </div>
        {manageMode && (
          <div className="row-between" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
            <small className="hint" style={{ fontSize: 11 }}>
              Toggle which <strong>{providerLabel(selectedProvider, customProviders)}</strong> models appear in the picker ({enabledForProvider.length ? `${enabledForProvider.length}/${providerFullCatalog.length} enabled` : `all ${providerFullCatalog.length} enabled`}).
            </small>
            {enabledForProvider.length > 0 && (
              <button
                type="button"
                className="filter-chip"
                onClick={() => {
                  const nextMap = { ...enabledModelsMap };
                  delete nextMap[selectedProvider];
                  void act('settings', { enabledModels: nextMap });
                }}
              >
                Enable All
              </button>
            )}
          </div>
        )}
      </div>

      {/* Scrollable Compact Model List */}
      <div className="model-pop-list">
        {locked && <div className="pill warn" style={{ margin: '6px 8px' }}>Pause the active task before changing models.</div>}
        {filtered.map(item => {
          const isSelected = item.id === activeModelId;
          const isFav = favorites.includes(item.id);
          const isEnabled = enabledForProvider.length === 0 || enabledForProvider.includes(item.id);
          return (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              className={`model-row ${isSelected ? 'selected' : ''}`}
              style={manageMode && !isEnabled ? { opacity: 0.48 } : undefined}
              onClick={e => manageMode ? toggleEnabledModel(e, item.id) : void selectModel(item.id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); manageMode ? toggleEnabledModel(e, item.id) : void selectModel(item.id); } }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 6 }}>
                  {manageMode && (
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      aria-label={`Enable ${item.name}`}
                      onClick={e => e.stopPropagation()}
                      onChange={e => toggleEnabledModel(e, item.id)}
                      style={{ width: 14, height: 14, margin: 0, flexShrink: 0 }}
                    />
                  )}
                  {isSelected && <Check size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                  <strong style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</strong>
                  <span className={`pill ${item.freedomColor}`} style={{ padding: '1px 6px', fontSize: 10 }}>{item.freedomLabel}</span>
                  {item.caps.has('frontier') && <span className="tag-chip" style={{ color: 'var(--accent)', borderColor: 'var(--accent-border)' }}>Frontier</span>}
                  {item.caps.has('reasoning') && <span className="tag-chip">Thinking</span>}
                </div>
                <div className="row" style={{ gap: 8, marginTop: 2 }}>
                  <small className="hint mono" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.id}</small>
                </div>
              </div>
              <div className="row" style={{ flexShrink: 0, gap: 6 }}>
                <span className="hint tabular" style={{ fontSize: 11 }}>{item.context ? `${Math.round(item.context / 1000)}K` : '—'}</span>
                <span className="hint tabular" style={{ fontSize: 11, minWidth: 54, textAlign: 'right' }}>
                  {item.isFree ? 'Free' : item.promptPerM != null ? formatPricePerM(item.pricing?.prompt) : providerLabel(item.provider, customProviders)}
                </span>
                <button type="button" className="btn-icon" style={{ width: 22, height: 22 }} title={isFav ? 'Unstar' : 'Favorite'} onClick={e => toggleFav(e, item.id)}>
                  <Star size={12} fill={isFav ? 'currentColor' : 'none'} style={{ color: isFav ? 'var(--warn-fg)' : undefined }} />
                </button>
              </div>
            </div>
          );
        })}

        {!filtered.length && (
          <div style={{ padding: 14 }}>
            <p className="hint" style={{ marginBottom: 8 }}>No catalog match. Enter any custom model ID directly:</p>
            <div className="row">
              <input placeholder="e.g. deepseek/deepseek-v4.1-flash or custom/qwen3:32b" value={manualId || query} onChange={e => setManualId(e.target.value)} />
              <button type="button" className="btn-primary" onClick={() => void selectModel((manualId || query).trim())}>Use ID</button>
            </div>
          </div>
        )}
      </div>

      {/* Inline Active Model Tuning Drawer (Reasoning, Context Window, Provider Routing) */}
      {showConfig && (
        <div className="model-pop-config">
          <div className="model-tune-row">
            <span className="tune-label">Reasoning</span>
            <div className="row" style={{ gap: 3, flexWrap: 'wrap' }}>
              {EFFORT_LEVELS.map(([id, label]) => {
                const disabled = locked || (id !== 'auto' && Array.isArray(supportedEfforts) && !supportedEfforts.includes(id));
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={disabled}
                    className={`filter-chip ${activeEffort === id ? 'active' : ''}`}
                    onClick={() => applyUpdate({ reasoningEffort: id })}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="model-tune-row">
            <span className="tune-label">Context</span>
            <div className="row" style={{ gap: 3, flexWrap: 'wrap' }}>
              {ctxPresets.map(val => (
                <button
                  key={val}
                  type="button"
                  disabled={locked}
                  className={`filter-chip tabular ${activeWindow === val ? 'active' : ''}`}
                  onClick={() => applyUpdate({ contextWindow: val })}
                >
                  {Math.round(val / 1000)}K
                </button>
              ))}
              {modelMaxCtx > 200000 && (
                <button
                  type="button"
                  disabled={locked}
                  className={`filter-chip tabular ${activeWindow === modelMaxCtx ? 'active' : ''}`}
                  onClick={() => applyUpdate({ contextWindow: modelMaxCtx })}
                >
                  Max ({Math.round(modelMaxCtx / 1000)}K)
                </button>
              )}
            </div>
          </div>

          <div className="model-tune-row">
            <span className="tune-label">Efficiency</span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`filter-chip ${settings.lazyToolLoading ? 'active' : ''}`}
                title="Load only core tools upfront and activate optional toolsets on demand via load_toolset (~50% fewer input tokens)"
                onClick={() => act('settings', { lazyToolLoading: !settings.lazyToolLoading })}
              >
                Lazy Tools: {settings.lazyToolLoading ? 'ON (~55% savings)' : 'OFF (All)'}
              </button>
              <button
                type="button"
                className={`filter-chip ${settings.silentToolSteps ? 'active' : ''}`}
                title="When ON, the model chains tool calls silently without sending intermediate follow-up text between each tool round until finished or asking an important question."
                onClick={() => act('settings', { silentToolSteps: !settings.silentToolSteps })}
              >
                Silent Steps: {settings.silentToolSteps ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                className={`filter-chip ${settings.promptCaching !== false ? 'active' : ''}`}
                title="Send explicit prompt cache breakpoints on supported providers"
                onClick={() => act('settings', { promptCaching: settings.promptCaching === false })}
              >
                Prompt Cache: {settings.promptCaching !== false ? 'ON' : 'OFF'}
              </button>
              {isOpenRouter && (
                <button
                  type="button"
                  className={`filter-chip ${settings.cacheAffinity ? 'active' : ''}`}
                  title="Send opaque session_id to OpenRouter to maximize backend KV cache hit rate"
                  onClick={() => act('settings', { cacheAffinity: !settings.cacheAffinity })}
                >
                  Cache Affinity: {settings.cacheAffinity ? 'ON' : 'OFF'}
                </button>
              )}
            </div>
          </div>

          {isOpenRouter && (
            <div className="model-tune-row">
              <span className="tune-label">Routing</span>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap', flex: 1 }}>
                {ROUTE_STRATEGIES.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    disabled={locked}
                    className={`filter-chip ${activeRoute === id ? 'active' : ''}`}
                    onClick={() => applyUpdate({ providerRouting: id })}
                  >
                    {label}
                  </button>
                ))}
                <select
                  aria-label="Preferred upstream provider"
                  value={upstreamPin}
                  disabled={locked}
                  style={{ width: 'auto', padding: '2px 7px', fontSize: 11, marginLeft: 'auto' }}
                  onChange={e => {
                    const val = e.target.value;
                    setUpstreamPin(val);
                    void applyUpdate({ providerOrder: val ? [val] : [] });
                  }}
                >
                  <option value="">Any Upstream</option>
                  {OPENROUTER_UPSTREAMS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="row-between" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
            <small className="hint">{task ? 'Saved for this chat only' : 'Default for new chats'}</small>
            <button type="button" className="btn-secondary" style={{ padding: '3px 10px', fontSize: 11.5 }} onClick={close}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
