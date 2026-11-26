import React, { useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw, ChevronRight, ArrowLeft } from 'lucide-react';
import Modal from './Modal.jsx';
import { formatCount, formatMoney, formatPercent, cleanError } from '../lib/format.mjs';

const api = (method, args) => window.nexus.invoke(method, args);

export default function ContextInspectorModal({ taskId, close }) {
  const [data, setData] = useState(null);
  const [costs, setCosts] = useState(null);
  const [tab, setTab] = useState('context');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rev = useRef(0);

  const run = async fn => {
    const token = ++rev.current;
    setBusy(true);
    setError('');
    try {
      const res = await fn();
      return token === rev.current ? res : null;
    } catch (e) {
      if (token === rev.current) setError(cleanError(e));
      return null;
    } finally {
      if (token === rev.current) setBusy(false);
    }
  };

  const refresh = async () => {
    const res = await run(() => Promise.all([api('inspectContext', { id: taskId }), api('inspectCosts', { id: taskId })]));
    if (res) { setData(res[0]); setCosts(res[1]); setPreview(null); }
  };

  useEffect(() => { void refresh(); return () => { rev.current++; }; }, [taskId]);

  const inspect = async (method, args, offset = 0) => {
    const res = await run(() => api(method, { id: taskId, ...args, offset }));
    if (res) setPreview({ ...res, method, args });
  };

  const loadCostPage = async offset => {
    const res = await run(() => api('inspectCosts', { id: taskId, offset, version: costs.version }));
    if (res) setCosts(res);
  };

  return (
    <Modal label="Context, Cache & Spend" close={close} wide>
      <div className="row-between" style={{ paddingRight: 48, marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div className="row">
          <Activity size={18} style={{ color: 'var(--accent)' }} />
          <h2 style={{ margin: 0 }}>Context, Cache & Spend Inspector</h2>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || data?.live}
            title="Prune old oversized tool outputs into lossless artifacts ($0 cost)"
            onClick={async () => {
              const res = await run(() => api('compact', { id: taskId, microOnly: true }));
              if (res) await refresh();
            }}
          >
            Micro-Prune ($0)
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || data?.live}
            title="Create a full structured continuity checkpoint now"
            onClick={async () => {
              const res = await run(() => api('compact', { id: taskId }));
              if (res) await refresh();
            }}
          >
            Compact Now
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={refresh}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {!preview && (
        <div className="row" style={{ borderBottom: '1px solid var(--border)', marginBottom: 16, gap: 4 }}>
          {[['context', 'Context Sections'], ['cost', 'Spend & Cache'], ['compression', 'Checkpoints']].map(([id, label]) => (
            <button key={id} type="button" className={`tab-btn ${tab === id ? 'active' : ''}`} style={{ height: 36 }} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      )}

      {error && <p className="pill err" role="alert" style={{ marginBottom: 12 }}>{error}</p>}

      {!data ? (
        <p className="hint">{busy ? 'Loading local snapshot…' : 'Snapshot unavailable.'}</p>
      ) : preview ? (
        <div>
          <button type="button" className="btn-secondary" style={{ marginBottom: 12 }} onClick={() => setPreview(null)}><ArrowLeft size={14} /> Back</button>
          <h3>{preview.label}</h3>
          <pre className="pre-box" style={{ maxHeight: 380 }}>{preview.content || '(Empty)'}</pre>
          <div className="row-between" style={{ marginTop: 12 }}>
            <small className="hint tabular">{formatCount(preview.offset)}–{formatCount(preview.offset + preview.content.length)} of {formatCount(preview.total)} chars</small>
            <div className="row">
              <button type="button" className="btn-secondary" disabled={busy || preview.offset === 0} onClick={() => inspect(preview.method, preview.args, Math.max(0, preview.offset - 6000))}>Previous</button>
              <button type="button" className="btn-secondary" disabled={busy || preview.next == null} onClick={() => inspect(preview.method, preview.args, preview.next)}>Next</button>
            </div>
          </div>
        </div>
      ) : tab === 'context' ? (
        <div>
          <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <div className="stat-tile"><small>Estimated Context</small><strong>≈ {formatCount(data.total)}</strong></div>
            <div className="stat-tile"><small>Auto Compaction</small><strong>{formatCount(data.threshold)}</strong></div>
            <div className="stat-tile"><small>Operating Ceiling</small><strong>{formatCount(data.ceiling)}</strong></div>
            <div className="stat-tile"><small>Micro-Pruned ($0)</small><strong>{formatCount(data.microCompactions?.tokensFreed || 0)} tok</strong><small>{data.lazyToolLoading ? 'Lazy tools ON' : 'All tools'}</small></div>
          </div>
          <div className="ctx-bar" style={{ width: '100%', height: 7, marginBottom: 14 }}>
            <div className={`ctx-bar-fill ${data.needsCompression ? 'high' : ''}`} style={{ width: `${Math.min(100, Math.round((data.total / Math.max(1, data.ceiling)) * 100))}%` }} />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {data.sections.map(sec => (
              <button key={sec.id} type="button" className="cap-card" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }} onClick={() => inspect('contextSection', { section: sec.id, fingerprint: data.fingerprint })}>
                <div>
                  <strong style={{ display: 'block', fontSize: 13 }}>{sec.label}</strong>
                  <small className="hint">{sec.reason}</small>
                </div>
                <div className="row" style={{ flexShrink: 0 }}>
                  <span className="tag-chip tabular">≈ {formatCount(sec.tokens)} tok</span>
                  <ChevronRight size={15} style={{ color: 'var(--ink-faint)' }} />
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : tab === 'cost' && costs ? (
        <div>
          <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <div className="stat-tile"><small>Reported Spend</small><strong>{formatMoney(costs.total.cost)}</strong><small>{costs.total.unknownCosts ? `${costs.total.unknownCosts} unreported` : `${costs.total.calls} calls`}</small></div>
            <div className="stat-tile"><small>Cache Hit Rate</small><strong>{formatPercent(costs.total.cacheHitRate)}</strong><small>Coverage {formatPercent(costs.total.cacheCoverage)}</small></div>
            <div className="stat-tile"><small>Uncached Input</small><strong>{formatCount(costs.total.uncached)}</strong><small>Comparable calls</small></div>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {costs.items.map((call, idx) => (
              <details key={call.id + '-' + idx} className="tool-card">
                <summary className="tool-card-head" style={{ listStyle: 'none' }}>
                  <span className="tool-name">{call.kind === 'compression' ? 'Compaction' : 'Generation'}</span>
                  <span className="tool-arg-preview">{call.model} · {call.status}</span>
                  <strong className="tabular" style={{ fontSize: 12 }}>{formatMoney(call.cost)}</strong>
                </summary>
                <div className="tool-card-body">
                  <div className="grid-3 hint tabular">
                    <span>In/Out: {formatCount(call.input)} / {formatCount(call.output)}</span>
                    <span>Cached: {formatCount(call.cached)}</span>
                    <span>Latency: {call.latencyMs == null ? '—' : `${(call.latencyMs / 1000).toFixed(2)} s`}</span>
                  </div>
                </div>
              </details>
            ))}
          </div>
          <div className="row-between" style={{ marginTop: 12 }}>
            <small className="hint tabular">{formatCount(costs.total.calls)} total calls</small>
            <div className="row">
              <button type="button" className="btn-secondary" disabled={busy || !costs.offset} onClick={() => loadCostPage(Math.max(0, costs.offset - 20))}>Previous</button>
              <button type="button" className="btn-secondary" disabled={busy || costs.next == null} onClick={() => loadCostPage(costs.next)}>Next</button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {data.checkpoints.map(cp => (
            <div key={cp.checkpoint} className="panel-card" style={{ margin: 0 }}>
              <div className="row-between">
                <div>
                  <strong>Checkpoint #{cp.checkpoint}</strong>
                  <p className="hint tabular" style={{ margin: '3px 0 0' }}>≈ {formatCount(cp.before)} → {formatCount(cp.after)} tokens · {formatMoney(cp.cost)}</p>
                </div>
                <div className="row">
                  <button type="button" className="btn-secondary" onClick={() => inspect('checkpointPreview', { checkpoint: cp.checkpoint, section: 'summary' })}>Summary</button>
                  <button type="button" className="btn-secondary" onClick={() => inspect('checkpointPreview', { checkpoint: cp.checkpoint, section: 'messages' })}>Originals</button>
                </div>
              </div>
            </div>
          ))}
          {!data.checkpoints.length && <p className="hint">No compaction checkpoints recorded yet.</p>}
        </div>
      )}
    </Modal>
  );
}
