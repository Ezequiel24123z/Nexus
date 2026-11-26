import React, { useState } from 'react';
import { Plus, Pause, Play, Trash2, GitFork, Swords } from 'lucide-react';
import Modal from './Modal.jsx';
import { STATUS_LABELS } from '../lib/format.mjs';

export default function TasksView({ state, projectId, workspace, setWorkspace, openTask, navigate, act, notify }) {
  const [filter, setFilter] = useState('all');
  const [batchOpen, setBatchOpen] = useState(false);
  const [bulk, setBulk] = useState('');
  const [chain, setChain] = useState(true);
  const [dep, setDep] = useState('');
  const [busy, setBusy] = useState(false);

  const tasks = (state.tasks || []).filter(t => {
    if (filter === 'active') return ['running', 'queued', 'approval'].includes(t.status);
    if (filter === 'paused') return t.status === 'paused';
    if (filter === 'complete') return t.status === 'complete';
    if (filter === 'failed') return t.status === 'failed';
    return true;
  });

  const activeCount = (state.tasks || []).filter(t => ['running', 'approval', 'queued'].includes(t.status)).length;

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1>Tasks & Orchestration Queue</h1>
            <p className="subtitle tabular">{activeCount} active · up to {state.settings.concurrency} concurrent workers</p>
          </div>
          <div className="row">
            <button type="button" className="btn-secondary" onClick={() => navigate('arena')}><Swords size={14} /> Model Arena</button>
            <button type="button" className="btn-primary" onClick={() => setBatchOpen(true)}><Plus size={14} /> Create Task Batch</button>
          </div>
        </div>

        <div className="sticky-pills">
          {[['all', 'All'], ['active', 'Active'], ['paused', 'Paused'], ['complete', 'Completed'], ['failed', 'Needs Review']].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>

        <div className="panel-card" style={{ padding: 0, overflow: 'hidden' }}>
          {tasks.map(t => (
            <div key={t.id} className="list-row">
              <button type="button" style={{ flex: 1, justifyContent: 'flex-start', textAlign: 'left', minWidth: 0 }} onClick={() => openTask(t.id)}>
                <i className={`status-dot ${t.status}`} />
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block', fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</strong>
                  <small className="hint mono">{t.model} · {t.workspace || 'No workspace'}{t.dependsOn?.length ? ` · After ${state.tasks.find(d => d.id === t.dependsOn[0])?.title || 'dependency'}` : ''}</small>
                </div>
              </button>
              <div className="row" style={{ flexShrink: 0 }}>
                <span className={`pill ${t.status}`}>{STATUS_LABELS[t.status] || t.status}</span>
                {['running', 'queued', 'approval'].includes(t.status)
                  ? <button type="button" className="btn-icon" title="Pause" onClick={() => act('pause', { id: t.id })}><Pause size={14} /></button>
                  : t.status !== 'complete' && <button type="button" className="btn-icon" title="Resume" onClick={() => act('resume', { id: t.id })}><Play size={14} /></button>}
                <button type="button" className="btn-icon" title="Fork" onClick={async () => { const r = await act('forkTask', { id: t.id }); if (r?.id) openTask(r.id); }}><GitFork size={14} /></button>
                <button type="button" className="btn-icon" title="Delete" onClick={async () => { if (await act('deleteTask', { id: t.id })) notify('Task deleted.', 'ok'); }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {!tasks.length && <p className="hint" style={{ padding: 20 }}>No tasks match this filter.</p>}
        </div>

        {batchOpen && (
          <Modal label="Create Task Batch" close={() => setBatchOpen(false)}>
            <h2>Create Parallel / Chained Task Batch</h2>
            <form onSubmit={async e => {
              e.preventDefault();
              setBusy(true);
              try {
                let prev = dep;
                const lines = bulk.split('\n').map(l => l.trim()).filter(Boolean);
                for (const line of lines) {
                  const id = await act('createTask', { prompt: line, workspace: workspace || '', projectId: projectId || null, dependsOn: prev ? [prev] : [] });
                  if (chain && id) prev = id;
                }
                setBulk('');
                setBatchOpen(false);
                notify(`Queued ${lines.length} tasks.`, 'ok');
              } finally { setBusy(false); }
            }}>
              <label className="field"><span>One objective per line</span><textarea required rows={7} value={bulk} onChange={e => setBulk(e.target.value)} placeholder="Audit backend routes&#10;Write regression tests&#10;Update documentation" /></label>
              <label className="field"><span>Initial prerequisite</span><select value={dep} onChange={e => setDep(e.target.value)}><option value="">None (start immediately)</option>{state.tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
              <label className="switch-row">
                <div><strong>Chain sequentially</strong><p>Pass each completed task's output into the next task. Disable to run in parallel.</p></div>
                <input type="checkbox" className="switch-input" checked={chain} onChange={e => setChain(e.target.checked)} />
              </label>
              <div className="row-between" style={{ marginTop: 12 }}>
                <button type="button" className="btn-secondary" onClick={async () => { const p = await act('chooseWorkspace'); if (p) setWorkspace(p); }}>{workspace || 'Select workspace folder'}</button>
                <button className="btn-primary" disabled={busy}>Queue Batch</button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    </div>
  );
}
