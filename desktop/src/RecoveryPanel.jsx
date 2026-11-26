import React, { useState } from 'react';

export default function RecoveryPanel({ act }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  const inspect = async () => {
    setBusy(true); setPreview(null); setResult(null);
    try { setPreview(await act('inspectRecovery')); }
    finally { setBusy(false); }
  };

  const restore = async () => {
    setBusy(true);
    try {
      const value = await act('restoreRecovery', { token: preview.token });
      if (value) { setResult(value); setPreview(null); }
    } finally { setBusy(false); }
  };

  return (
    <section className="panel-card wide" aria-label="Backup recovery" aria-busy={busy}>
      <h2>Isolated Backup Verification & Recovery</h2>
      <p className="hint">Verify any exported JSON or SQLite backup in a background worker and restore into a new isolated folder without overwriting your live workspace.</p>
      <button type="button" className="btn-secondary" disabled={busy} onClick={inspect}>{busy ? 'Checking…' : 'Select Backup to Verify'}</button>
      {preview && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
          <h3>{preview.name}</h3>
          <div className="stat-strip" style={{ marginTop: 10 }}>
            <div className="stat-tile"><small>Chats</small><strong>{preview.chats}</strong></div>
            <div className="stat-tile"><small>Messages</small><strong>{preview.messages}</strong></div>
            <div className="stat-tile"><small>Projects</small><strong>{preview.projects}</strong></div>
            <div className="stat-tile"><small>Format</small><strong>{preview.format.toUpperCase()}</strong></div>
          </div>
          <div className="row">
            <button type="button" className="btn-primary" disabled={busy} onClick={restore}>Restore into New Folder</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}
      {result && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
          <h3 style={{ color: 'var(--ok-fg)' }}>Backup Restored & Verified</h3>
          <p className="hint">{result.chats} chats staged in:</p>
          <pre className="pre-box">{result.directory}</pre>
        </div>
      )}
    </section>
  );
}
