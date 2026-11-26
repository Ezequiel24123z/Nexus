import React, { useEffect, useMemo, useState } from 'react';
import {
  Brain, Plus, Search, Pin, Pencil, Trash2, Download, Upload, Eye, ShieldAlert,
  Target, Sliders, User, Workflow, BookMarked, Check
} from 'lucide-react';
import Modal from './Modal.jsx';
import { MarkdownRenderer } from './MarkdownRenderer.jsx';
import { cleanError } from '../lib/format.mjs';

const api = (method, args) => window.nexus.invoke(method, args);

const CATEGORIES = [
  { id: 'priority', label: 'Priorities', icon: Target, hint: 'Active goals, focus areas, and deadlines' },
  { id: 'preference', label: 'Preferences', icon: Sliders, hint: 'How you like things done, style, tone, and tooling' },
  { id: 'constraint', label: 'Constraints', icon: ShieldAlert, hint: 'Hard rules and boundaries NEXUS must always obey' },
  { id: 'workflow', label: 'Workflows', icon: Workflow, hint: 'Repeatable build, git, testing, and review habits' },
  { id: 'profile', label: 'User Profile', icon: User, hint: 'Role, environment, hardware, stack, and background' },
  { id: 'fact', label: 'Facts', icon: BookMarked, hint: 'Technical facts and project-specific knowledge' },
];

const PRIORITIES = [
  { id: 'critical', label: 'Critical', pill: 'err' },
  { id: 'high', label: 'High', pill: 'warn' },
  { id: 'normal', label: 'Normal', pill: 'info' },
  { id: 'low', label: 'Low', pill: '' },
];

const emptyForm = (workspace = '') => ({
  id: '',
  key: '',
  value: '',
  category: 'preference',
  priority: 'high',
  scope: 'global',
  workspace,
  tagsText: '',
  pinned: false,
});

function downloadText(filename, content, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function MemoryView({ state, workspace, act, notify }) {
  const [memories, setMemories] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(() => emptyForm(workspace || ''));
  const [previewModal, setPreviewModal] = useState(null);
  const [importModal, setImportModal] = useState(false);
  const [importText, setImportText] = useState('');

  const loadMemories = () => {
    api('memoriesList').then(list => setMemories(list || [])).catch(e => notify(cleanError(e), 'error'));
  };

  useEffect(() => { loadMemories(); }, [state.memoryCount]);

  const counts = useMemo(() => {
    const map = { total: memories.length, pinned: 0, critical: 0 };
    for (const c of CATEGORIES) map[c.id] = 0;
    for (const m of memories) {
      if (m.pinned) map.pinned++;
      if (m.priority === 'critical') map.critical++;
      if (map[m.category] !== undefined) map[m.category]++;
    }
    return map;
  }, [memories]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return memories.filter(m => {
      if (categoryFilter !== 'all' && m.category !== categoryFilter) return false;
      if (priorityFilter !== 'all' && m.priority !== priorityFilter) return false;
      if (scopeFilter !== 'all' && m.scope !== scopeFilter) return false;
      if (q) {
        const hay = `${m.key} ${m.value} ${m.category} ${m.priority} ${(m.tags || []).join(' ')} ${m.workspace || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [memories, categoryFilter, priorityFilter, scopeFilter, query]);

  const submitForm = async e => {
    e.preventDefault();
    if (!form.key.trim() || !form.value.trim()) return;
    const tags = form.tagsText.split(',').map(t => t.trim()).filter(Boolean);
    const list = await act('memorySave', {
      ...(form.id ? { id: form.id } : {}),
      key: form.key.trim(),
      value: form.value.trim(),
      category: form.category,
      priority: form.priority,
      scope: form.scope,
      workspace: form.scope === 'project' ? (form.workspace || workspace || '') : '',
      tags,
      pinned: Boolean(form.pinned),
    });
    if (list) {
      setMemories(list);
      notify(form.id ? `Updated memory "${form.key.trim()}".` : `Saved memory "${form.key.trim()}".`, 'ok');
      setForm(emptyForm(workspace || ''));
    }
  };

  const togglePin = async m => {
    const list = await act('memorySave', { ...m, pinned: !m.pinned });
    if (list) setMemories(list);
  };

  const openPreview = async () => {
    const res = await act('memoriesPreview', { workspace: workspace || '' });
    if (res) setPreviewModal(res);
  };

  const handleExport = async format => {
    const res = await act('memoriesExport');
    if (!res) return;
    if (format === 'json') downloadText('nexus-user-memories.json', res.json, 'application/json;charset=utf-8');
    else downloadText(res.filename || 'nexus-user-memories.md', res.markdown, 'text/markdown;charset=utf-8');
    notify(`Exported ${format.toUpperCase()} memory profile.`, 'ok');
  };

  const handleImport = async e => {
    e.preventDefault();
    if (!importText.trim()) return;
    const res = await act('memoriesImport', { json: importText });
    if (res) {
      setMemories(res.memories || []);
      setImportText('');
      setImportModal(false);
      notify(`Imported ${res.imported} new and updated ${res.updated} memories.`, 'ok');
    }
  };

  const catMeta = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
  const prioMeta = id => PRIORITIES.find(p => p.id === id) || PRIORITIES[2];

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1>User Memory, Priorities & Working Style</h1>
            <p className="subtitle">Teach NEXUS your priorities, preferences, hard constraints, and workflows. Pinned and high-priority memories are automatically injected into every session.</p>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn-secondary" onClick={openPreview}><Eye size={14} /> Prompt Preview</button>
            <button type="button" className="btn-secondary" onClick={() => void handleExport('md')}><Download size={14} /> Export MD</button>
            <button type="button" className="btn-secondary" onClick={() => void handleExport('json')}><Download size={14} /> Export JSON</button>
            <button type="button" className="btn-secondary" onClick={() => setImportModal(true)}><Upload size={14} /> Import</button>
          </div>
        </div>

        <div className="stat-strip">
          <div className="stat-tile"><small>Total Memories</small><strong className="tabular">{counts.total}</strong></div>
          <div className="stat-tile"><small>Priorities & Constraints</small><strong className="tabular">{counts.priority + counts.constraint}</strong></div>
          <div className="stat-tile"><small>Preferences & Style</small><strong className="tabular">{counts.preference + counts.workflow}</strong></div>
          <div className="stat-tile"><small>Pinned / Critical</small><strong className="tabular">{counts.pinned} / {counts.critical}</strong></div>
        </div>

        <div className="settings-grid">
          <form className="panel-card" onSubmit={submitForm}>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>{form.id ? 'Edit Memory' : 'Add User Memory'}</h2>
              {form.id && (
                <button type="button" className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={() => setForm(emptyForm(workspace || ''))}>Cancel Edit</button>
              )}
            </div>

            <label className="field">
              <span>Topic / Key</span>
              <input required value={form.key} onChange={e => setForm({ ...form, key: e.target.value })} placeholder="e.g. Response language, Git workflow, Current Q4 priority" />
            </label>

            <label className="field">
              <span>Rule, Preference, Priority, or Important Detail</span>
              <textarea required rows={4} value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} placeholder="Describe clearly how you prefer NEXUS to work, what matters most, or what to avoid…" />
            </label>

            <div className="grid-2">
              <label className="field">
                <span>Category</span>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Priority</span>
                <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                  {PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
            </div>

            <div className="grid-2">
              <label className="field">
                <span>Scope</span>
                <select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })}>
                  <option value="global">Global (all sessions)</option>
                  <option value="project">Project workspace only</option>
                </select>
              </label>
              <label className="field">
                <span>Tags (comma-separated)</span>
                <input value={form.tagsText} onChange={e => setForm({ ...form, tagsText: e.target.value })} placeholder="coding, tone, security" />
              </label>
            </div>

            {form.scope === 'project' && (
              <label className="field">
                <span>Project Workspace Path</span>
                <input className="mono" value={form.workspace} onChange={e => setForm({ ...form, workspace: e.target.value })} placeholder={workspace || 'C:\\Projects\\my-app'} />
              </label>
            )}

            <label className="switch-row" style={{ marginBottom: 12 }}>
              <div><strong>Pin Memory</strong><p>Always inject verbatim at the top of NEXUS context, even under tight token budgets.</p></div>
              <input type="checkbox" className="switch-input" checked={form.pinned} onChange={e => setForm({ ...form, pinned: e.target.checked })} />
            </label>

            <button className="btn-primary" style={{ width: '100%' }}>
              {form.id ? <><Check size={14} /> Save Changes</> : <><Plus size={14} /> Save to Memory Profile</>}
            </button>
          </form>

          <div>
            <div className="sticky-pills" style={{ marginBottom: 10 }}>
              <button type="button" aria-pressed={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>
                <Brain size={13} /> All ({counts.total})
              </button>
              {CATEGORIES.map(c => {
                const Icon = c.icon;
                return (
                  <button key={c.id} type="button" aria-pressed={categoryFilter === c.id} onClick={() => setCategoryFilter(c.id)}>
                    <Icon size={13} /> {c.label} ({counts[c.id] || 0})
                  </button>
                );
              })}
            </div>

            <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div className="sidebar-search" style={{ flex: 1, minWidth: 200, margin: 0 }}>
                <Search size={14} />
                <input placeholder="Search memories, tags, or values…" value={query} onChange={e => setQuery(e.target.value)} />
              </div>
              <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} style={{ width: 130 }}>
                <option value="all">All Priorities</option>
                {PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)} style={{ width: 130 }}>
                <option value="all">All Scopes</option>
                <option value="global">Global</option>
                <option value="project">Project</option>
              </select>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              {filtered.map(m => {
                const cat = catMeta(m.category);
                const prio = prioMeta(m.priority);
                return (
                  <section key={m.id} className="panel-card" style={{ margin: 0, padding: '12px 14px' }}>
                    <div className="row-between" style={{ gap: 8, marginBottom: 6 }}>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                        <strong>{m.key}</strong>
                        <span className="pill">{cat.label}</span>
                        <span className={`pill ${prio.pill}`}>{prio.label}</span>
                        <span className="pill">{m.scope === 'project' ? 'Project' : 'Global'}</span>
                        {m.source === 'agent' && <span className="pill info">Learned by NEXUS</span>}
                      </div>
                      <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                        <button type="button" className="btn-icon" title={m.pinned ? 'Unpin' : 'Pin'} onClick={() => void togglePin(m)}>
                          <Pin size={13} fill={m.pinned ? 'currentColor' : 'none'} style={m.pinned ? { color: 'var(--accent)' } : undefined} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          title="Edit memory"
                          onClick={() => setForm({
                            id: m.id,
                            key: m.key,
                            value: m.value,
                            category: m.category || 'fact',
                            priority: m.priority || 'normal',
                            scope: m.scope || 'global',
                            workspace: m.workspace || workspace || '',
                            tagsText: (m.tags || []).join(', '),
                            pinned: Boolean(m.pinned),
                          })}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          title="Delete memory"
                          onClick={async () => {
                            const list = await act('memoryDelete', { id: m.id });
                            if (list) { setMemories(list); notify(`Removed memory "${m.key}".`, 'info'); }
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.value}</p>
                    <div className="row-between" style={{ flexWrap: 'wrap', gap: 6 }}>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                        {(m.tags || []).map(t => <span key={t} className="tag-chip">#{t}</span>)}
                        {m.workspace && <span className="hint mono" style={{ fontSize: 11 }}>{m.workspace}</span>}
                      </div>
                      <small className="hint">{m.updatedAt ? `Updated ${new Date(m.updatedAt).toLocaleDateString()}` : ''}</small>
                    </div>
                  </section>
                );
              })}
              {!filtered.length && (
                <div className="panel-card">
                  <p className="hint" style={{ margin: 0 }}>
                    {memories.length
                      ? 'No memories match the current filter.'
                      : 'No user memories saved yet. Add your priorities, coding style, communication preferences, or constraints on the left — or tell NEXUS in chat how you like to work.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {previewModal && (
          <Modal label="Injected Memory Prompt Preview" close={() => setPreviewModal(null)} wide>
            <h2>Live Prompt Context Preview ({previewModal.count}/{previewModal.total} active)</h2>
            <p className="hint">This exact structured profile is injected automatically into new and ongoing NEXUS sessions{workspace ? ` for ${workspace}` : ''}.</p>
            <div className="panel-card" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <MarkdownRenderer text={previewModal.markdown || '*No active memories for this scope.*'} />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn-primary" onClick={() => setPreviewModal(null)}>Close</button>
            </div>
          </Modal>
        )}

        {importModal && (
          <Modal label="Import Memories JSON" close={() => setImportModal(false)} wide>
            <h2>Import Memories (JSON)</h2>
            <p className="hint">Paste an exported NEXUS memory JSON array to merge into your local profile.</p>
            <form onSubmit={handleImport}>
              <textarea className="mono" rows={12} required value={importText} onChange={e => setImportText(e.target.value)} placeholder='[{"key":"Code Style","value":"Prefer concise TypeScript without redundant comments","category":"preference","priority":"high","pinned":true}]' />
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn-secondary" onClick={() => setImportModal(false)}>Cancel</button>
                <button className="btn-primary">Import & Merge</button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    </div>
  );
}
