import React, { useState } from 'react';
import Modal from './components/Modal.jsx';
import { contextAdvice } from './context-advice.mjs';

export default function ChatSettings({ task, state, act, close }) {
  const [form, setForm] = useState({
    title: task.title,
    model: task.model,
    projectId: task.projectId || '',
    temperature: task.temperature ?? '',
    systemPromptOverride: task.systemPromptOverride || '',
  });
  const [compacting, setCompacting] = useState(false);
  const advice = contextAdvice(task, state.settings);
  const num = v => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v);

  return (
    <Modal label="Chat Settings" close={close}>
      <h2>Chat Settings</h2>
      <form onSubmit={async e => {
        e.preventDefault();
        const nextTemp = form.temperature === '' ? null : Number(form.temperature);
        const prevTemp = task.temperature ?? null;
        const payload = {
          id: task.id,
          title: form.title.trim(),
          projectId: form.projectId,
          ...(form.model !== task.model ? { model: form.model } : {}),
          ...(nextTemp !== prevTemp ? { temperature: nextTemp } : {}),
          ...((form.systemPromptOverride || '') !== (task.systemPromptOverride || '') ? { systemPromptOverride: form.systemPromptOverride } : {}),
        };
        if (await act('updateChat', payload)) close();
      }}>
        <label className="field"><span>Title</span><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required /></label>
        <div className="grid-2">
          <label className="field">
            <span>Project</span>
            <select value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })}>
              <option value="">No project</option>
              {state.projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Temperature Override (0–2)</span>
            <input type="number" step="0.05" min="0" max="2" placeholder="Inherit global" value={form.temperature} onChange={e => setForm({ ...form, temperature: e.target.value })} />
          </label>
        </div>
        <label className="field"><span>Model for Subsequent Turns</span><input value={form.model} required onChange={e => setForm({ ...form, model: e.target.value })} /></label>
        <label className="field"><span>Per-Chat System Prompt Override (optional)</span><textarea rows={4} placeholder="Leave blank to inherit global instructions…" value={form.systemPromptOverride} onChange={e => setForm({ ...form, systemPromptOverride: e.target.value })} /></label>

        <div className="panel-card" style={{ padding: 12, marginTop: 12 }}>
          <p className="hint tabular" style={{ margin: 0 }}>Estimated context: {advice.current == null ? 'Unavailable' : num(advice.current)} tok · Auto threshold: {advice.threshold == null ? 'Unavailable' : num(advice.threshold)} tok.</p>
          {advice.saved && <p className="hint tabular" style={{ margin: '4px 0 0' }}>Last compaction: {advice.saved.tokens > 0 ? `reduced ${num(advice.saved.tokens)} tok (${advice.saved.percent.toFixed(1)}%)` : `delta ${num(-advice.saved.tokens)} tok`}.</p>}
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn-secondary" disabled={compacting || task.compacting || ['running', 'approval', 'queued'].includes(task.status)} onClick={async () => {
              setCompacting(true);
              try { if (await act('compact', { id: task.id })) close(); }
              finally { setCompacting(false); }
            }}>{compacting || task.compacting ? 'Compacting…' : 'Compact Context Now'}</button>
            {(compacting || task.compacting) && <button type="button" className="btn-danger" onClick={() => act('pause', { id: task.id })}>Pause Compaction</button>}
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
          <button className="btn-primary" disabled={compacting || task.compacting}>Save Changes</button>
        </div>
      </form>
    </Modal>
  );
}
