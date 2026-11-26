import React, { useEffect, useRef, useState } from 'react';
import { Activity, Minimize2, Sparkles, RefreshCw, ExternalLink, Layers } from 'lucide-react';
import { formatCount, formatMoney, formatPercent, cleanError } from '../lib/format.mjs';

const api = (method, args) => window.nexus.invoke(method, args);

function compactK(n) {
  if (n == null || !Number.isFinite(n)) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
  return String(Math.round(n));
}

export default function SessionMetricsPopover({ task, effectiveWindow, isRunning, act, notify, onOpenInspector, onOpenChange, compact = false }) {
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState(null);
  const [costs, setCosts] = useState(null);
  const [busy, setBusy] = useState(false);
  const [compacting, setCompacting] = useState('');
  const popRef = useRef(null);

  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  const load = async () => {
    if (!task?.id) return;
    setBusy(true);
    try {
      const [c, co] = await Promise.all([
        api('inspectContext', { id: task.id }),
        api('inspectCosts', { id: task.id }),
      ]);
      setCtx(c);
      setCosts(co);
    } catch {}
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (open) void load();
  }, [open, task?.id, task?.steps, task?.compressions]);

  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (popRef.current && !popRef.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const ctxTokens = ctx?.total ?? task?.contextTokens ?? 0;
  const ceiling = ctx?.ceiling ?? effectiveWindow ?? 50000;
  const ctxPct = Math.min(100, Math.round((ctxTokens / Math.max(1, ceiling)) * 100));
  const tel = task?.telemetry || {};
  const totalIn = costs?.total?.input ?? tel.input ?? 0;
  const totalOut = costs?.total?.output ?? tel.output ?? 0;
  const totalCached = costs?.total?.cached ?? tel.cached ?? 0;
  const totalReasoning = costs?.total?.reasoning ?? tel.reasoning ?? 0;
  const totalCost = costs?.total?.cost ?? tel.cost ?? null;
  const cacheRate = costs?.total?.cacheHitRate ?? (totalIn > 0 && totalCached > 0 ? totalCached / totalIn : null);
  const latestProvider = costs?.items?.find(c => c.provider && c.provider !== 'Not reported')?.provider || null;

  const triggerMicro = async () => {
    setCompacting('micro');
    try {
      const res = await act('compact', { id: task.id, microOnly: true });
      if (res) {
        notify(res.micro?.prunedCount
          ? `Micro-pruned ${res.micro.prunedCount} old tool outputs (~${formatCount(res.micro.estimatedTokensFreed)} tok freed, $0).`
          : 'No oversized old tool outputs to prune.', 'ok');
        await load();
      }
    } finally { setCompacting(''); }
  };

  const triggerCompact = async () => {
    setCompacting('full');
    try {
      const res = await act('compact', { id: task.id });
      if (res) {
        notify('Session compacted into a new lossless checkpoint.', 'ok');
        await load();
      }
    } catch (e) {
      notify(cleanError(e), 'error');
    } finally { setCompacting(''); }
  };

  return (
    <div className="metrics-wrap" ref={popRef}>
      <button
        type="button"
        className={`ctx-pill tabular ${ctxPct >= 80 ? 'warn' : ''}`}
        aria-expanded={open}
        title="Session metrics, tokens, cache hit rate & compaction"
        onClick={() => setOpen(v => !v)}
      >
        <div className="ctx-bar"><div className={`ctx-bar-fill ${ctxPct >= 80 ? 'high' : ''}`} style={{ width: `${ctxPct}%` }} /></div>
        <span>{ctxPct}%</span>
        {!compact && (
          <>
            <span style={{ color: 'var(--ink-faint)' }}>·</span>
            <span>{compactK(totalIn + totalOut)} tok</span>
          </>
        )}
        {cacheRate != null && cacheRate > 0 && (
          <>
            <span style={{ color: 'var(--ink-faint)' }}>·</span>
            <span style={{ color: 'var(--ok-fg)' }}>{Math.round(cacheRate * 100)}% cache</span>
          </>
        )}
        {!compact && (
          <>
            <span style={{ color: 'var(--ink-faint)' }}>·</span>
            <span>{formatMoney(totalCost)}</span>
          </>
        )}
      </button>

      {open && (
        <div className="metrics-popover" role="dialog" aria-label="Session metrics and compaction">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 6 }}>
              <Activity size={14} style={{ color: 'var(--accent)' }} />
              <strong style={{ fontSize: 13 }}>Session Metrics & Compaction</strong>
            </div>
            <button type="button" className="btn-icon" style={{ width: 24, height: 24 }} disabled={busy} title="Refresh metrics" onClick={load}>
              <RefreshCw size={12} className={busy ? 'spin' : ''} />
            </button>
          </div>

          {/* Active Context Window */}
          <div className="metrics-section">
            <div className="row-between" style={{ marginBottom: 5 }}>
              <span className="hint" style={{ fontSize: 11.5 }}>Active Context Window</span>
              <strong className="tabular" style={{ fontSize: 12 }}>
                ≈ {formatCount(ctxTokens)} / {formatCount(ceiling)} ({ctxPct}%)
              </strong>
            </div>
            <div className="ctx-bar" style={{ width: '100%', height: 6 }}>
              <div className={`ctx-bar-fill ${ctxPct >= 80 ? 'high' : ''}`} style={{ width: `${ctxPct}%` }} />
            </div>
            <div className="row-between hint tabular" style={{ fontSize: 10.5, marginTop: 4 }}>
              <span>Auto-compact at {formatCount(ctx?.threshold ?? Math.round(ceiling * 0.95))} tok</span>
              <span>{ctx?.lazyToolLoading ? 'Lazy Tools ON' : 'All Tools'}</span>
            </div>

            {ctx?.sections?.length > 0 && (
              <div className="metrics-breakdown">
                {ctx.sections.slice(0, 6).map(sec => (
                  <div key={sec.id} className="row-between" style={{ fontSize: 11 }}>
                    <span className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 210 }}>{sec.label}</span>
                    <span className="tabular" style={{ color: 'var(--ink-secondary)' }}>≈ {compactK(sec.tokens)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cumulative Token & Cache Totals */}
          <div className="metrics-grid tabular">
            <div className="metric-cell">
              <small>Input Tokens</small>
              <strong>{formatCount(totalIn)}</strong>
              <span className="hint">{costs?.total?.uncached != null ? `${formatCount(costs.total.uncached)} uncached` : 'cumulative'}</span>
            </div>
            <div className="metric-cell">
              <small>Output Tokens</small>
              <strong>{formatCount(totalOut)}</strong>
              <span className="hint">{totalReasoning > 0 ? `${formatCount(totalReasoning)} reasoning` : `${costs?.total?.calls ?? task?.callsTotal ?? 0} calls`}</span>
            </div>
            <div className="metric-cell">
              <small>Cached Input</small>
              <strong style={{ color: cacheRate > 0.2 ? 'var(--ok-fg)' : undefined }}>{formatCount(totalCached)}</strong>
              <span className="hint">{cacheRate != null ? `${formatPercent(cacheRate)} hit rate` : 'not reported'}</span>
            </div>
            <div className="metric-cell">
              <small>Reported Spend</small>
              <strong>{formatMoney(totalCost)}</strong>
              <span className="hint">{latestProvider ? `via ${latestProvider}` : `${task?.steps || 0} steps`}</span>
            </div>
          </div>

          {/* Compaction Stats & 1-Click Triggers */}
          <div className="metrics-section" style={{ marginBottom: 0 }}>
            <div className="row-between" style={{ marginBottom: 6 }}>
              <span className="row" style={{ gap: 5, fontSize: 11.5, color: 'var(--ink-secondary)' }}>
                <Layers size={12} /> <strong>Compaction</strong>
              </span>
              <span className="hint tabular" style={{ fontSize: 11 }}>
                {ctx?.compressions ?? task?.compressions ?? 0} checkpoints
                {ctx?.microCompactions?.tokensFreed ? ` · ${compactK(ctx.microCompactions.tokensFreed)} pruned ($0)` : ''}
              </span>
            </div>

            {ctx?.compression && (
              <p className="hint tabular" style={{ fontSize: 11, margin: '0 0 8px' }}>
                Last checkpoint: ≈ {formatCount(ctx.compression.before)} → {formatCount(ctx.compression.after)} tok
                {ctx.compression.before > 0 ? ` (-${Math.max(0, Math.round((1 - ctx.compression.after / ctx.compression.before) * 100))}%)` : ''}
                {ctx.compression.cost != null ? ` · ${formatMoney(ctx.compression.cost)}` : ''}
              </p>
            )}

            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ flex: 1, fontSize: 11.5, padding: '6px 8px' }}
                disabled={isRunning || Boolean(compacting)}
                onClick={triggerMicro}
              >
                <Sparkles size={12} /> {compacting === 'micro' ? 'Pruning…' : 'Micro-Prune ($0)'}
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1, fontSize: 11.5, padding: '6px 8px' }}
                disabled={isRunning || Boolean(compacting)}
                onClick={triggerCompact}
              >
                <Minimize2 size={12} /> {compacting === 'full' ? 'Compacting…' : 'Compact Now'}
              </button>
            </div>
            <button
              type="button"
              className="btn-secondary"
              style={{ width: '100%', marginTop: 6, fontSize: 11.5, padding: '5px 8px' }}
              onClick={() => { setOpen(false); onOpenInspector(); }}
            >
              <ExternalLink size={12} /> Open Full Context & Checkpoints Inspector
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
