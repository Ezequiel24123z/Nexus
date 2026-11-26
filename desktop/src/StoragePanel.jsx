import React, { useEffect, useState } from 'react';
import RecoveryPanel from './RecoveryPanel.jsx';

export default function StoragePanel({ state, act }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const active = state.tasks.some(task => ['running', 'queued', 'approval'].includes(task.status) || task.compacting);

  useEffect(() => {
    let live = true;
    act('storageInfo').then(v => { if (live) setInfo(v); });
    return () => { live = false; };
  }, []);

  const migrate = async () => {
    setBusy(true); setNote('');
    try {
      const result = await act('migrateStorage');
      if (result) { setInfo(result); setConfirm(false); setNote('Migration to incremental SQLite verified. Original JSON backup preserved.'); }
    } finally { setBusy(false); }
  };

  return (
    <>
      <section className="panel-card wide" aria-label="Local storage">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Local Storage Engine</h2>
          <span className={`pill ${info?.engine === 'sqlite' ? 'ok' : 'info'}`}>{info?.engine === 'sqlite' ? 'Incremental SQLite · Active' : info ? 'JSON · Active' : 'Checking…'}</span>
        </div>
        <p className="hint">SQLite writes only changed rows in atomic WAL transactions, eliminating full-file serialization stalls on long histories.</p>
        {info?.engine === 'json' && (
          <div style={{ margin: '12px 0' }}>
            {active && <p className="pill warn">Pause all active tasks before migrating to SQLite.</p>}
            {!confirm ? (
              <button type="button" className="btn-primary" disabled={busy || active} onClick={() => setConfirm(true)}>Migrate to Incremental SQLite</button>
            ) : (
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" className="btn-primary" disabled={busy || active} onClick={migrate}>{busy ? 'Verifying…' : 'Confirm Backup & Activate SQLite'}</button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
              </div>
            )}
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn-secondary" disabled={busy || active} onClick={async () => {
            setBusy(true);
            try {
              const res = await act('exportStorage');
              if (res) setNote(`Workspace exported${res.path ? ' to ' + res.path : ''}.`);
            } finally { setBusy(false); }
          }}>Export Compatible JSON State</button>
        </div>
        {note && <p className="hint" style={{ color: 'var(--ok-fg)', marginTop: 8 }} role="status">{note}</p>}
      </section>
      <RecoveryPanel act={act} />
    </>
  );
}
