import React, { useState } from 'react';
import { Clock, Play, Plus, Trash2, FolderOpen, ArrowUpRight } from 'lucide-react';
import { AUTONOMY_LEVELS } from '../lib/format.mjs';
import { filterModelsForProvider } from '../lib/model-catalog.mjs';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function describeSchedule(a) {
  if (a.scheduleType === 'interval') return `Every ${a.everyMinutes} min`;
  if (a.scheduleType === 'daily') return `Daily at ${String(a.hour ?? 9).padStart(2, '0')}:${String(a.minute ?? 0).padStart(2, '0')}`;
  if (a.scheduleType === 'weekly') return `${WEEKDAYS[a.weekday ?? 1]} at ${String(a.hour ?? 9).padStart(2, '0')}:${String(a.minute ?? 0).padStart(2, '0')}`;
  if (a.scheduleType === 'cron') return `Cron: ${a.cronExpression}`;
  if (a.scheduleType === 'once') return `Once at ${a.runAt ? new Date(a.runAt).toLocaleString() : '—'}`;
  return a.scheduleType;
}

export default function AutomationsView({ state, workspace, models, act, notify, openTask }) {
  const automations = state.automations || [];
  const [form, setForm] = useState({
    name: '',
    prompt: '',
    workspace: workspace || '',
    model: state.settings.model || '',
    agentMode: 'autopilot',
    scheduleType: 'interval',
    everyMinutes: 60,
    hour: 9,
    minute: 0,
    weekday: 1,
    cronExpression: '0 9 * * 1-5',
    runAt: '',
  });

  const save = async e => {
    e.preventDefault();
    const res = await act('automationSave', form);
    if (res) {
      setForm({ ...form, name: '', prompt: '' });
      notify(`Automation "${res.name}" scheduled.`, 'ok');
    }
  };

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1>Local Automations & Cron Scheduler</h1>
            <p className="subtitle">Run autonomous agent missions on a recurring interval, calendar time, or standard 5-field cron while NEXUS runs (even minimized in the Windows tray).</p>
          </div>
        </div>

        <div className="settings-grid">
          <form className="panel-card" onSubmit={save}>
            <h2>New Scheduled Automation</h2>
            <label className="field"><span>Name</span><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Morning Git & Test Health Check" /></label>
            <label className="field"><span>Agent Objective Prompt</span><textarea required rows={4} value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} placeholder="Run git status, run_diagnostics, and summarize any pending changes or failing tests…" /></label>
            <div className="grid-2">
              <label className="field">
                <span>Schedule Type</span>
                <select value={form.scheduleType} onChange={e => setForm({ ...form, scheduleType: e.target.value })}>
                  <option value="interval">Every N minutes</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="cron">Custom 5-field Cron</option>
                  <option value="once">One-Time Run</option>
                </select>
              </label>
              <label className="field">
                <span>Autonomy Level</span>
                <select value={form.agentMode} onChange={e => setForm({ ...form, agentMode: e.target.value })}>
                  {AUTONOMY_LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </label>
            </div>

            {form.scheduleType === 'interval' && (
              <label className="field"><span>Run every (minutes)</span><input type="number" min="1" max="43200" value={form.everyMinutes} onChange={e => setForm({ ...form, everyMinutes: +e.target.value })} /></label>
            )}
            {(form.scheduleType === 'daily' || form.scheduleType === 'weekly') && (
              <div className="grid-3">
                {form.scheduleType === 'weekly' && (
                  <label className="field"><span>Weekday</span><select value={form.weekday} onChange={e => setForm({ ...form, weekday: +e.target.value })}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
                )}
                <label className="field"><span>Hour (0–23)</span><input type="number" min="0" max="23" value={form.hour} onChange={e => setForm({ ...form, hour: +e.target.value })} /></label>
                <label className="field"><span>Minute (0–59)</span><input type="number" min="0" max="59" value={form.minute} onChange={e => setForm({ ...form, minute: +e.target.value })} /></label>
              </div>
            )}
            {form.scheduleType === 'cron' && (
              <label className="field"><span>5-Field Cron (min hour dom mon dow)</span><input className="mono" value={form.cronExpression} onChange={e => setForm({ ...form, cronExpression: e.target.value })} placeholder="30 9 * * 1-5" /></label>
            )}
            {form.scheduleType === 'once' && (
              <label className="field"><span>Run At (local date & time)</span><input type="datetime-local" value={form.runAt} onChange={e => setForm({ ...form, runAt: e.target.value })} required /></label>
            )}

            <div className="grid-2">
              <label className="field">
                <span>Model (optional)</span>
                <input list="auto-models" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Inherit default" />
                <datalist id="auto-models">{filterModelsForProvider(models, state.settings, '', { activeModelId: form.model || state.settings.model }).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist>
              </label>
              <label className="field">
                <span>Workspace Folder</span>
                <div className="row">
                  <input value={form.workspace} onChange={e => setForm({ ...form, workspace: e.target.value })} placeholder="Optional path" />
                  <button type="button" className="btn-secondary" onClick={async () => { const p = await act('chooseWorkspace'); if (p) setForm({ ...form, workspace: p }); }}><FolderOpen size={14} /></button>
                </div>
              </label>
            </div>
            <button className="btn-primary" style={{ marginTop: 8 }}><Plus size={14} /> Schedule Automation</button>
          </form>

          <div>
            <h2>Scheduled Jobs ({automations.length})</h2>
            {automations.map(a => (
              <section key={a.id} className="panel-card">
                <div className="row-between" style={{ marginBottom: 6 }}>
                  <div className="row">
                    <Clock size={15} style={{ color: a.enabled ? 'var(--accent)' : 'var(--ink-faint)' }} />
                    <strong>{a.name}</strong>
                    <span className={`pill ${a.enabled ? 'ok' : ''}`}>{describeSchedule(a)}</span>
                  </div>
                  <input type="checkbox" className="switch-input" checked={a.enabled} onChange={e => act('automationToggle', { id: a.id, enabled: e.target.checked })} />
                </div>
                <p className="hint" style={{ marginBottom: 10 }}>{a.prompt.slice(0, 220)}</p>
                <div className="row-between">
                  <small className="hint tabular">Runs: {a.runCount || 0}{a.lastRunAt ? ` · Last: ${new Date(a.lastRunAt).toLocaleString()}` : ''}</small>
                  <div className="row">
                    {a.lastTaskId && <button type="button" className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={() => openTask(a.lastTaskId)}>Last Run <ArrowUpRight size={12} /></button>}
                    <button type="button" className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 9px' }} onClick={async () => { const r = await act('automationRunNow', { id: a.id }); if (r?.taskId) { notify(`Triggered "${a.name}"`, 'ok'); openTask(r.taskId); } }}><Play size={12} /> Run Now</button>
                    <button type="button" className="btn-danger" style={{ padding: '4px 8px' }} onClick={() => act('automationDelete', { id: a.id })}><Trash2 size={13} /></button>
                  </div>
                </div>
              </section>
            ))}
            {!automations.length && <div className="panel-card"><p className="hint">No automations scheduled yet. Create one on the left or ask the agent to schedule one via <code>manage_automation</code>.</p></div>}
          </div>
        </div>
      </div>
    </div>
  );
}
