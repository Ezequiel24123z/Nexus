import React, { useRef, useState } from 'react';
import { FileJson, Search, CheckCircle2, AlertCircle } from 'lucide-react';
import Modal from './components/Modal.jsx';

export default function OpenApiImport({ close, done }) {
  const [source, setSource] = useState('');
  const [prefix, setPrefix] = useState('API');
  const [baseUrl, setBaseUrl] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [plan, setPlan] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const active = useRef(true);

  React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const leave = () => { if (!busy) close(); };
  const run = async action => {
    setBusy(true); setError('');
    try { await action(); }
    catch (err) { if (active.current) setError(err.message); }
    finally { if (active.current) setBusy(false); }
  };

  const args = { source, prefix, baseUrl, secretRef };
  const visible = plan?.entries.filter(item => (item.name + ' ' + item.path + ' ' + item.method + ' ' + item.description + ' ' + (item.issue || '')).toLowerCase().includes(query.toLowerCase())) || [];
  const page = visible.slice(offset, offset + 20);
  const toggle = id => setSelected(cur => { const next = new Set(cur); next.has(id) ? next.delete(id) : next.add(id); return next; });

  return (
    <Modal label="Import OpenAPI" close={leave} wide>
      <h2>Import OpenAPI 3.0 / 3.1 Specification</h2>
      {!plan ? (
        <div>
          <p className="hint">Load a local OpenAPI JSON file or paste its JSON below. Review runs locally with zero outbound network calls.</p>
          <label className="cap-card" style={{ width: '100%', cursor: 'pointer', flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <FileJson size={20} style={{ color: 'var(--accent)' }} />
            <div style={{ flex: 1 }}>
              <strong>{fileName || 'Choose OpenAPI JSON File'}</strong>
              <div className="hint">Up to 2 MB · up to 500 operations</div>
            </div>
            <input type="file" accept=".json,application/json" style={{ display: 'none' }} disabled={busy} onChange={e => {
              const f = e.target.files?.[0];
              if (f) void run(async () => { const text = await f.text(); if (active.current) { setSource(text); setFileName(f.name); } });
              e.target.value = '';
            }} />
          </label>
          <label className="field"><span>Or Paste JSON Spec</span><textarea className="mono" rows={7} value={source} spellCheck={false} onChange={e => { setSource(e.target.value); setFileName(''); }} placeholder='{"openapi":"3.1.0","info":{...},"paths":{...}}' /></label>
          <div className="grid-2">
            <label className="field"><span>Name Prefix</span><input maxLength={32} value={prefix} onChange={e => setPrefix(e.target.value)} /></label>
            <label className="field"><span>Bearer Secret Ref (optional)</span><input placeholder="CONNECTOR_MY_API" value={secretRef} onChange={e => setSecretRef(e.target.value)} /></label>
          </div>
          <label className="field"><span>Override Server URL (optional)</span><input placeholder="https://api.example.com/v1" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} /></label>
        </div>
      ) : (
        <div>
          <div className="row" style={{ marginBottom: 12 }}>
            <CheckCircle2 size={18} style={{ color: 'var(--ok-fg)' }} />
            <strong>{plan.title}</strong>
            <span className="pill">{plan.compatible}/{plan.entries.length} compatible · {selected.size} selected</span>
          </div>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <div className="sidebar-search" style={{ flex: 1, margin: 0 }}>
              <Search size={14} />
              <input placeholder="Filter operations…" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} />
            </div>
            <button type="button" className="btn-secondary" onClick={() => setSelected(cur => new Set([...cur, ...page.filter(i => !i.issue).map(i => i.id)]))}>Select Page</button>
            <button type="button" className="btn-secondary" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
          <div style={{ maxHeight: 340, overflowY: 'auto', display: 'grid', gap: 6 }}>
            {page.map(item => (
              <label key={item.id} className="cap-card" style={{ flexDirection: 'row', alignItems: 'flex-start', width: '100%', opacity: item.issue ? 0.55 : 1, cursor: item.issue ? 'default' : 'pointer' }}>
                <input type="checkbox" style={{ width: 16, height: 16, marginTop: 2 }} checked={selected.has(item.id)} disabled={busy || !!item.issue} onChange={() => toggle(item.id)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row"><span className="pill info">{item.method}</span><strong className="mono" style={{ fontSize: 12 }}>{item.path}</strong></div>
                  <p className="hint" style={{ margin: '4px 0 0' }}>{item.description || item.name}</p>
                  {item.issue && <small style={{ color: 'var(--warn-fg)' }}><AlertCircle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{item.issue}</small>}
                </div>
              </label>
            ))}
          </div>
          <div className="row-between" style={{ marginTop: 10 }}>
            <small className="hint">{visible.length} results</small>
            <div className="row">
              <button type="button" className="btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</button>
              <button type="button" className="btn-secondary" disabled={offset + 20 >= visible.length} onClick={() => setOffset(offset + 20)}>Next</button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="pill err" role="alert" style={{ marginTop: 10 }}>{error}</p>}
      <div className="row-between" style={{ marginTop: 16 }}>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => plan ? (setPlan(null), setSelected(new Set()), setError('')) : leave()}>
          {plan ? 'Back' : 'Cancel'}
        </button>
        <button type="button" className="btn-primary" disabled={busy || (!plan && !source.trim()) || (!!plan && !selected.size)} onClick={() => run(async () => {
          if (!plan) { const p = await window.nexus.invoke('previewOpenApi', args); if (active.current) { setPlan(p); setSelected(new Set()); } }
          else { const res = await window.nexus.invoke('importOpenApi', { ...args, selected: [...selected] }); if (active.current) done(res); }
        })}>
          {busy ? 'Processing…' : plan ? `Import ${selected.size} Operations` : 'Review Specification'}
        </button>
      </div>
    </Modal>
  );
}
