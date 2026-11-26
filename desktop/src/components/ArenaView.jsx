import React, { useEffect, useState } from 'react';
import { Swords, Play, Plus, Trash2, ArrowUpRight, FolderOpen, Pause, Loader2 } from 'lucide-react';
import { MarkdownRenderer, StreamingMarkdown } from './MarkdownRenderer.jsx';
import { MODES } from './ModelPickerPopover.jsx';
import { formatCount, formatMoney, STATUS_LABELS, cleanError } from '../lib/format.mjs';

const api = (method, args) => window.nexus.invoke(method, args);

export default function ArenaView({ state, models, workspace, setWorkspace, projectId, openTask, act, notify }) {
  const [selectedModels, setSelectedModels] = useState([
    state.settings.model || 'deepseek/deepseek-v4.1-flash',
    'anthropic/claude-sonnet-4-5',
  ]);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState('autopilot');
  const [busy, setBusy] = useState(false);
  const [activeIds, setActiveIds] = useState([]);
  const [arenaTasks, setArenaTasks] = useState([]);

  // Find latest arena groups from existing tasks
  const recentGroups = React.useMemo(() => {
    const groups = new Map();
    for (const t of state.tasks || []) {
      if (!t.arenaGroupId) continue;
      if (!groups.has(t.arenaGroupId)) groups.set(t.arenaGroupId, []);
      groups.get(t.arenaGroupId).push(t);
    }
    return [...groups.entries()].slice(0, 6);
  }, [state.tasks]);

  useEffect(() => {
    if (!activeIds.length && recentGroups.length) {
      setActiveIds(recentGroups[0][1].map(t => t.id));
    }
  }, [recentGroups.length]);

  useEffect(() => {
    if (!activeIds.length) { setArenaTasks([]); return; }
    let live = true;
    const poll = () => {
      api('arenaTasks', { ids: activeIds })
        .then(res => { if (live) setArenaTasks(res || []); })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 700);
    return () => { live = false; clearInterval(timer); };
  }, [activeIds, state]);

  const launch = async e => {
    e.preventDefault();
    const cleanModels = selectedModels.map(m => m.trim()).filter(Boolean);
    if (cleanModels.length < 2 || !prompt.trim()) return;
    setBusy(true);
    try {
      const res = await api('createArena', {
        prompt: prompt.trim(),
        models: cleanModels,
        agentMode: mode,
        workspace: workspace || '',
        projectId: projectId || null,
      });
      if (res?.ids?.length) {
        setActiveIds(res.ids);
        setPrompt('');
        notify(`Launched ${res.ids.length}-way parallel Model Arena.`, 'ok');
      }
    } catch (err) {
      notify(cleanError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1>Model Arena</h1>
            <p className="subtitle">Dispatch the exact same prompt to 2–4 models in parallel and compare speed, reasoning, code quality, and cost side-by-side.</p>
          </div>
          <div className="row">
            <button type="button" className="btn-secondary" onClick={async () => { const p = await act('chooseWorkspace'); if (p) setWorkspace(p); }}>
              <FolderOpen size={14} /> {workspace ? workspace.split(/[\\/]/).pop() : 'Optional workspace'}
            </button>
          </div>
        </div>

        <form className="panel-card" onSubmit={launch}>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Configure Contenders ({selectedModels.length}/4)</h2>
            <div className="row">
              <select aria-label="Arena mode" value={mode} onChange={e => setMode(e.target.value)} style={{ width: 150 }}>
                {MODES.map(m => <option key={m.id} value={m.id}>{m.label} mode</option>)}
              </select>
              {selectedModels.length < 4 && (
                <button type="button" className="btn-secondary" onClick={() => setSelectedModels([...selectedModels, 'openai/gpt-5'])}><Plus size={14} /> Add Model</button>
              )}
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom: 12 }}>
            {selectedModels.map((m, idx) => (
              <div key={idx} className="row">
                <input
                  list="arena-model-list"
                  value={m}
                  onChange={e => setSelectedModels(prev => prev.map((v, i) => (i === idx ? e.target.value : v)))}
                  placeholder={`Model #${idx + 1} (e.g. openai/gpt-5)`}
                  required
                />
                {selectedModels.length > 2 && (
                  <button type="button" className="btn-icon" title="Remove contender" onClick={() => setSelectedModels(prev => prev.filter((_, i) => i !== idx))}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <datalist id="arena-model-list">
            {models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </datalist>

          <textarea
            rows={4}
            required
            placeholder="Enter a coding challenge, architecture problem, or analysis prompt to run across all selected models simultaneously…"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            style={{ marginBottom: 12 }}
          />

          <div className="row-between">
            <span className="hint">{workspace ? `Workspace: ${workspace}` : 'Running without workspace (pure reasoning / general tools)'}</span>
            <button className="btn-primary" disabled={busy || !prompt.trim()}><Swords size={15} /> {busy ? 'Launching…' : 'Launch Side-by-Side Arena'}</button>
          </div>
        </form>

        {recentGroups.length > 1 && (
          <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
            <span className="hint">Recent comparisons:</span>
            {recentGroups.map(([gid, items]) => (
              <button key={gid} type="button" className={activeIds[0] === items[0].id ? 'btn-primary' : 'btn-secondary'} style={{ padding: '4px 10px', fontSize: 11.5 }} onClick={() => setActiveIds(items.map(i => i.id))}>
                {items.length} models · {items[0].prompt.slice(0, 32)}
              </button>
            ))}
          </div>
        )}

        {arenaTasks.length > 0 && (
          <div className="arena-columns" style={{ gridTemplateColumns: `repeat(${Math.min(arenaTasks.length, 4)}, minmax(0, 1fr))` }}>
            {arenaTasks.map(t => {
              const lastAssistant = [...(t.conversation || [])].reverse().find(m => m.role === 'assistant');
              const running = ['running', 'queued', 'approval'].includes(t.status);
              return (
                <section key={t.id} className="arena-col">
                  <div className="arena-col-head">
                    <div style={{ minWidth: 0 }}>
                      <strong className="mono" style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.model}</strong>
                      <span className={`pill ${t.status}`} style={{ marginTop: 4 }}>{STATUS_LABELS[t.status] || t.status}</span>
                    </div>
                    <div className="row" style={{ gap: 4 }}>
                      {running && <button type="button" className="btn-icon" title="Pause" onClick={() => act('pause', { id: t.id })}><Pause size={14} /></button>}
                      <button type="button" className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 9px' }} onClick={() => openTask(t.id)}>
                        Open <ArrowUpRight size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="arena-col-body">
                    {running && t.liveActivity && <div className="live-activity-line"><Loader2 size={13} className="spin" /><span>{t.liveActivity}</span></div>}
                    {running && t.liveText ? <StreamingMarkdown text={t.liveText} /> :
                     lastAssistant?.content ? <MarkdownRenderer text={lastAssistant.content} /> :
                     t.error ? <p className="pill err">{t.error}</p> :
                     <p className="hint">{running ? 'Waiting for first token…' : 'No response yet.'}</p>}
                  </div>
                  <div className="arena-col-foot tabular">
                    <span>{formatCount(t.telemetry?.total)} tok · {t.telemetry?.latencyMs ? `${(t.telemetry.latencyMs / 1000).toFixed(1)}s` : '—'}</span>
                    <strong>{formatMoney(t.telemetry?.cost)}</strong>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
