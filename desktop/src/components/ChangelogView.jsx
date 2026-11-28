import React, { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Download, ShieldCheck, CheckCircle2, ExternalLink, Search,
  Sparkles, Shield, Wrench, Bug, Calendar, Tag, Archive, AlertTriangle
} from 'lucide-react';
import { cleanError } from '../lib/format.mjs';

const api = (method, args) => window.nexus.invoke(method, args);

const KIND_META = {
  added: { label: 'Added', Icon: Sparkles, cls: 'ok' },
  security: { label: 'Security & Privacy', Icon: Shield, cls: 'info' },
  improved: { label: 'Improved', Icon: Wrench, cls: '' },
  fixed: { label: 'Fixed', Icon: Bug, cls: 'warn' },
  other: { label: 'Notes', Icon: Tag, cls: '' },
};

function renderInlineMd(text) {
  if (!text) return null;
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={idx} className="mono" style={{ fontSize: '0.9em', padding: '1px 4px', borderRadius: 4, background: 'var(--bg-code)' }}>{part.slice(1, -1)}</code>;
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export default function ChangelogView({ state, act, notify, updateStatus, onRefreshUpdate }) {
  const s = state.settings;
  const [changelog, setChangelog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState(null);
  const [backingUp, setBackingUp] = useState(false);

  const loadChangelog = async () => {
    setLoading(true);
    try { setChangelog(await api('changelog')); }
    catch (e) { notify(cleanError(e), 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadChangelog(); }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      const res = await onRefreshUpdate();
      if (res?.updateAvailable) notify(`NEXUS v${res.latestVersion} is available on GitHub.`, 'ok');
      else if (res?.ok) notify(`You are on the latest version (v${res.currentVersion}).`, 'info');
      else if (res?.error) notify(res.error, 'error');
    } finally { setChecking(false); }
  };

  const handleApplyUpdate = async () => {
    setUpdating(true);
    try {
      const res = await act('applyUpdate', { restart: true });
      if (res) {
        setUpdateResult(res);
        if (res.restarting) {
          notify(`Backed up your custom prompts & launched updater for v${res.version}. NEXUS will restart shortly.`, 'ok');
        } else if (res.downloaded) {
          notify(res.message || `Downloaded v${res.version} with custom prompts backed up.`, 'ok');
        } else {
          notify(res.message || 'No newer release to install.', 'info');
        }
      }
    } finally { setUpdating(false); }
  };

  const handleBackupPrompts = async () => {
    setBackingUp(true);
    try {
      const res = await act('backupCustomPrompts');
      if (res?.ok) notify(`Backed up custom prompts & config to ${res.backupDir}`, 'ok');
    } finally { setBackingUp(false); }
  };

  const releases = useMemo(() => {
    const raw = changelog?.releases || [];
    const q = query.trim().toLowerCase();
    return raw.map(rel => {
      const sections = (rel.sections || []).map(sec => {
        if (kindFilter !== 'all' && sec.kind !== kindFilter) return null;
        const items = q
          ? sec.items.filter(it => [it.title, it.text, ...(it.details || []), rel.version, sec.title].join(' ').toLowerCase().includes(q))
          : sec.items;
        return items.length ? { ...sec, items } : null;
      }).filter(Boolean);
      return sections.length ? { ...rel, sections } : null;
    }).filter(Boolean);
  }, [changelog, query, kindFilter]);

  const currentVersion = updateStatus?.currentVersion || changelog?.releases?.[0]?.version || '1.5.0';
  const hasCustomPrompts = Boolean(s.globalInstructionsCustomized || (s.customSystemPrompt || '').trim());

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1>Release Timeline & GitHub Auto-Updater</h1>
            <p className="subtitle">Visual history of every NEXUS release alongside safe, one-click GitHub Releases updates that preserve your custom system prompts, memory, and vault.</p>
          </div>
          <div className="row">
            <button type="button" className="btn-secondary" disabled={backingUp} onClick={handleBackupPrompts}>
              <Archive size={14} /> {backingUp ? 'Backing up…' : 'Backup Custom Prompts'}
            </button>
            <button type="button" className="btn-primary" disabled={checking} onClick={handleCheckUpdate}>
              <RefreshCw size={14} className={checking ? 'spin' : ''} /> {checking ? 'Checking GitHub…' : 'Check for Updates'}
            </button>
          </div>
        </div>

        {/* Auto-Updater & Custom Prompt Preservation Strip */}
        <section className="panel-card" style={{ marginBottom: 20 }}>
          <div className="row-between" style={{ gap: 14, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 260, flex: 1 }}>
              <div className="row" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 16 }}>Installed: NEXUS v{currentVersion}</strong>
                {updateStatus?.updateAvailable ? (
                  <span className="pill ok">Update Available: v{updateStatus.latestVersion}</span>
                ) : updateStatus?.ok ? (
                  <span className="pill info"><CheckCircle2 size={12} /> Up to date</span>
                ) : updateStatus?.error ? (
                  <span className="pill warn"><AlertTriangle size={12} /> Offline / Check skipped</span>
                ) : null}
                <span className={`pill ${hasCustomPrompts ? 'ok' : ''}`} title="Custom system instructions, Custom Prompt Addendum, nexus.config.json, workspace.json, memories, and DPAPI secrets live in your local user profile and are never overwritten by app updates.">
                  <ShieldCheck size={12} /> {hasCustomPrompts ? 'Custom Prompts Protected' : 'Prompt Preservation Guard Active'}
                </span>
              </div>
              <p className="hint" style={{ margin: 0 }}>
                Updates pull signed releases from <code className="mono">{s.updateRepo || 'Ezequiel24123z/Nexus'}</code>
                {s.torRouteAllTraffic ? ' through your encrypted Tor/SOCKS5 route' : ''}.
                Before replacing app binaries, NEXUS snapshots <code>nexus.config.json</code>, <code>workspace.json</code>, and your custom system prompts into <code>backups/</code> and never touches your user profile.
              </p>
              {updateStatus?.error && (
                <p className="hint" style={{ color: 'var(--warn-fg)', marginTop: 6 }}>{updateStatus.error}</p>
              )}
              {updateResult?.message && (
                <p className="hint" style={{ color: 'var(--ok-fg)', marginTop: 6 }}>{updateResult.message}</p>
              )}
            </div>

            <div className="row" style={{ gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
              {updateStatus?.releaseUrl && (
                <button type="button" className="btn-secondary" onClick={() => api('openExternal', { url: updateStatus.releaseUrl })}>
                  <ExternalLink size={13} /> View on GitHub
                </button>
              )}
              {updateStatus?.updateAvailable && (
                <button type="button" className="btn-primary" disabled={updating} onClick={handleApplyUpdate}>
                  <Download size={14} /> {updating ? 'Downloading & Applying…' : `Install v${updateStatus.latestVersion}`}
                </button>
              )}
            </div>
          </div>

          {updateStatus?.updateAvailable && (updateStatus.releaseNotes || updateStatus.body) && (
            <details style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--ink-secondary)', fontWeight: 550 }}>
                Release notes for v{updateStatus.latestVersion} ({updateStatus.asset?.name || 'portable package'})
              </summary>
              <pre className="pre-box" style={{ marginTop: 8, maxHeight: 220, whiteSpace: 'pre-wrap' }}>{updateStatus.releaseNotes || updateStatus.body}</pre>
            </details>
          )}
        </section>

        {/* Timeline Filter & Search Bar */}
        <div className="row-between" style={{ gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {[
              ['all', 'All Changes'],
              ['added', 'Added'],
              ['security', 'Security & Privacy'],
              ['improved', 'Improved'],
              ['fixed', 'Fixed'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`filter-chip ${kindFilter === id ? 'active' : ''}`}
                onClick={() => setKindFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="sidebar-search" style={{ width: 280, maxWidth: '100%' }}>
            <Search size={13} />
            <input
              aria-label="Filter changelog entries"
              placeholder="Search versions, features, fixes…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Visual Vertical Release Timeline */}
        {loading ? (
          <p className="hint">Loading release timeline…</p>
        ) : releases.length === 0 ? (
          <div className="panel-card">
            <p className="hint" style={{ margin: 0 }}>No changelog entries match your filter.</p>
          </div>
        ) : (
          <div className="timeline-track">
            {releases.map((rel, idx) => (
              <article key={rel.version + rel.date} className={`timeline-node ${idx === 0 ? 'latest' : ''}`}>
                <div className="timeline-rail" aria-hidden="true">
                  <span className="timeline-dot" />
                </div>

                <div className="timeline-card">
                  <header className="timeline-head">
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span className={`pill ${idx === 0 ? 'ok' : 'info'} mono`}>v{rel.version}</span>
                      <h2 style={{ margin: 0, fontSize: 16.5 }}>{rel.title || `Release v${rel.version}`}</h2>
                      {idx === 0 && <span className="tag-chip">Current</span>}
                    </div>
                    {rel.date && (
                      <span className="hint row mono" style={{ fontSize: 12, gap: 5 }}>
                        <Calendar size={12} /> {rel.date}
                      </span>
                    )}
                  </header>

                  {rel.summary && (
                    <p style={{ margin: '8px 0 14px', color: 'var(--ink-secondary)', fontSize: 13.5, lineHeight: 1.55, maxWidth: '72ch' }}>
                      {rel.summary}
                    </p>
                  )}

                  <div className="timeline-sections">
                    {rel.sections.map(sec => {
                      const meta = KIND_META[sec.kind] || KIND_META.other;
                      const SecIcon = meta.Icon;
                      return (
                        <div key={sec.title} className="timeline-section">
                          <div className="timeline-section-label">
                            <SecIcon size={13} />
                            <span>{sec.title}</span>
                            <span className="hint tabular" style={{ fontSize: 11 }}>({sec.items.length})</span>
                          </div>
                          <ul className="timeline-list">
                            {sec.items.map((it, i) => (
                              <li key={i}>
                                {it.title && <strong>{renderInlineMd(it.title)}</strong>}
                                {it.title && it.text ? ': ' : ''}
                                <span>{renderInlineMd(it.text)}</span>
                                {(it.details || []).length > 0 && (
                                  <ul style={{ margin: '5px 0 2px', paddingLeft: 16, display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--ink-muted)' }}>
                                    {it.details.map((d, j) => <li key={j}>{renderInlineMd(d)}</li>)}
                                  </ul>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
