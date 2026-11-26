import React, { useEffect, useState } from 'react';
import { Network, Plus, Play, Trash2, Search } from 'lucide-react';
import OpenApiImport from '../OpenApiImport.jsx';
import { cleanError, prettyJson } from '../lib/format.mjs';

const api = (method, args) => window.nexus.invoke(method, args);
const empty = () => ({ name: '', url: '', method: 'GET', description: '', secretRef: '', idempotencyHeader: false, reconciliationUrl: '' });

export default function ConnectorsView({ act, count, notify }) {
  const [form, setForm] = useState(empty);
  const [revision, setRevision] = useState(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(null);
  const [importing, setImporting] = useState(false);
  const [testInput, setTestInput] = useState('{}');
  const [testResult, setTestResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api('connectorsPage', { query, offset: 0, limit: 40 }).then(setPage).catch(() => {});
  };

  useEffect(() => { const t = setTimeout(load, 150); return () => clearTimeout(t); }, [query, count]);

  const reset = () => { setForm(empty()); setRevision(null); setTestResult(null); };

  const runLiveTest = async () => {
    if (!form.name) return;
    setBusy(true);
    setTestResult(null);
    try {
      const input = JSON.parse(testInput || '{}');
      const res = await api('testConnector', { name: form.name, input });
      setTestResult(res);
    } catch (e) {
      setTestResult({ error: cleanError(e) });
    } finally { setBusy(false); }
  };

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1>REST Connectors</h1>
            <p className="subtitle">Define HTTP/HTTPS endpoints (local, LAN, or cloud), test live requests, or bulk-import OpenAPI 3.0/3.1 specs.</p>
          </div>
          <div className="row">
            <button type="button" className="btn-secondary" onClick={() => setImporting(true)}>Import OpenAPI</button>
            <button type="button" className="btn-primary" onClick={reset}><Plus size={14} /> New Connector</button>
          </div>
        </div>

        <div className="settings-grid">
          <div className="panel-card">
            <h2>{revision ? `Edit · ${form.name}` : 'New REST Connector'}</h2>
            <form onSubmit={async e => {
              e.preventDefault();
              setBusy(true);
              try {
                const ok = await act(revision ? 'updateConnector' : 'addConnector', revision ? { definition: form, revision } : form);
                if (ok) { reset(); load(); notify('Connector saved.', 'ok'); }
              } finally { setBusy(false); }
            }}>
              <label className="field"><span>Name</span><input required readOnly={!!revision} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="local_api_status" /></label>
              <label className="field"><span>HTTP / HTTPS Endpoint</span><input required readOnly={!!form.openapi} value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="http://localhost:8080/api/health" /></label>
              <div className="grid-2">
                <label className="field"><span>Method</span><select disabled={!!form.openapi} value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m}>{m}</option>)}</select></label>
                <label className="field"><span>Secret Ref (optional)</span><input value={form.secretRef || ''} onChange={e => setForm({ ...form, secretRef: e.target.value })} placeholder="CONNECTOR_MY_API" /></label>
              </div>
              <label className="field"><span>Description</span><input value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
              <label className="field"><span>Reconciliation URL (optional)</span><input value={form.reconciliationUrl || ''} onChange={e => setForm({ ...form, reconciliationUrl: e.target.value })} placeholder="https://api.example.com/ops/{operationId}" /></label>
              <label className="switch-row">
                <div><strong>Supports Idempotency-Key</strong><p>Enable if target API honors Idempotency-Key for safe retries.</p></div>
                <input type="checkbox" className="switch-input" checked={!!form.idempotencyHeader} onChange={e => setForm({ ...form, idempotencyHeader: e.target.checked })} />
              </label>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn-primary" disabled={busy}>Save Connector</button>
                {revision && <button type="button" className="btn-danger" onClick={async () => { if (await act('removeConnector', { name: form.name })) { reset(); load(); notify('Connector removed.', 'ok'); } }}><Trash2 size={14} /> Delete</button>}
              </div>
            </form>

            {revision && (
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <h3>Live Test Playground</h3>
                <label className="field"><span>Input Payload (JSON)</span><textarea className="mono" rows={3} value={testInput} onChange={e => setTestInput(e.target.value)} /></label>
                <button type="button" className="btn-secondary" disabled={busy} onClick={runLiveTest}><Play size={13} /> Send Live Request</button>
                {testResult && (
                  <div style={{ marginTop: 10 }}>
                    {testResult.error ? <p className="pill err">{testResult.error}</p> : (
                      <>
                        <div className="row" style={{ marginBottom: 6 }}>
                          <span className={`pill ${testResult.status < 400 ? 'ok' : 'err'}`}>HTTP {testResult.status}</span>
                          <span className="pill tabular">{testResult.latencyMs} ms</span>
                        </div>
                        <pre className="pre-box" style={{ maxHeight: 220 }}>{prettyJson(testResult.body)}</pre>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="sidebar-search" style={{ marginBottom: 12 }}>
              <Search size={14} />
              <input placeholder="Search connectors…" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {(page?.items || []).map(item => (
                <button key={item.name} type="button" className="cap-card" style={{ width: '100%' }} onClick={async () => {
                  const res = await act('getConnector', { name: item.name });
                  if (res) { setForm({ ...empty(), ...res.definition }); setRevision(res.revision); setTestResult(null); }
                }}>
                  <div className="row-between" style={{ width: '100%' }}>
                    <span className="pill info">{item.method}</span>
                    <Network size={14} style={{ color: 'var(--ink-muted)' }} />
                  </div>
                  <strong>{item.name}</strong>
                  <small className="hint mono">{item.url || item.description}</small>
                </button>
              ))}
              {!page?.items?.length && <div className="panel-card"><p className="hint">No connectors configured yet.</p></div>}
            </div>
          </div>
        </div>

        {importing && <OpenApiImport close={() => setImporting(false)} done={res => { setImporting(false); load(); notify(`Imported ${res.imported} OpenAPI operations.`, 'ok'); }} />}
      </div>
    </div>
  );
}
