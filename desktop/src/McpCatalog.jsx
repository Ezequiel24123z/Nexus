import React, { useEffect, useState } from 'react';

export default function McpCatalog({ server }) {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      window.nexus.invoke('mcpToolsPage', { server, query, offset })
        .then(v => { if (live) { setPage(v); setError(''); } })
        .catch(e => { if (live) setError(e.message); });
    }, 150);
    return () => { live = false; clearTimeout(timer); };
  }, [server, query, offset]);

  return (
    <div style={{ marginTop: 10 }}>
      <input placeholder="Filter tools…" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} style={{ marginBottom: 8, padding: '6px 9px', fontSize: 12 }} />
      {error && <p className="pill err">{error}</p>}
      <div style={{ display: 'grid', gap: 6 }}>
        {(page?.items || []).map(tool => (
          <div key={tool.name} style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--bg-chrome)', border: '1px solid var(--border-subtle)' }}>
            <strong className="mono" style={{ fontSize: 12 }}>{tool.name}</strong>
            <div className="hint">{tool.description}</div>
          </div>
        ))}
      </div>
      <div className="row-between" style={{ marginTop: 8 }}>
        <small className="hint">{page?.total ?? 0} tools</small>
        <div className="row">
          <button type="button" className="btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }} disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>Prev</button>
          <button type="button" className="btn-secondary" style={{ padding: '4px 8px', fontSize: 11 }} disabled={page?.next == null} onClick={() => setOffset(page.next)}>Next</button>
        </div>
      </div>
    </div>
  );
}
