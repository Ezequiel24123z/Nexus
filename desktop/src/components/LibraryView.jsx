import React, { useEffect, useState } from 'react';
import { BookOpen, Braces, Plus, Search, Brain, Trash2, Sparkles, Terminal } from 'lucide-react';
import Modal from './Modal.jsx';
import { MODES } from './ModelPickerPopover.jsx';
import { cleanError } from '../lib/format.mjs';

const api = (method, args) => window.nexus.invoke(method, args);
const emptyCap = kind => ({ kind, name: '', description: '', tags: [], enabled: true, instructions: '', tool: 'read_file', defaults: {} });

export default function LibraryView({ state, act, notify, navigate }) {
  const [subTab, setSubTab] = useState('capabilities');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(null);
  const [editor, setEditor] = useState(null);
  const [defaultsJson, setDefaultsJson] = useState('{}');
  const [tagsText, setTagsText] = useState('');

  // Memories
  const [memories, setMemories] = useState([]);
  const [memKey, setMemKey] = useState('');
  const [memVal, setMemVal] = useState('');
  const [memScope, setMemScope] = useState('global');

  // Custom Slash Commands
  const [cmdName, setCmdName] = useState('');
  const [cmdDesc, setCmdDesc] = useState('');
  const [cmdTemplate, setCmdTemplate] = useState('');
  const [cmdMode, setCmdMode] = useState('autopilot');

  // Self-Improve Analyzer
  const [analysis, setAnalysis] = useState(null);

  const loadPage = () => {
    api('capabilitiesPage', { query, kind, offset, limit: 24 }).then(setPage).catch(() => {});
  };

  useEffect(() => {
    const t = setTimeout(loadPage, 150);
    return () => clearTimeout(t);
  }, [query, kind, offset, state.capabilities?.revision]);

  useEffect(() => {
    api('memoriesList').then(list => setMemories(list || [])).catch(() => {});
  }, [state.memoryCount]);

  const openEditor = async id => {
    const cap = await act('getCapability', { id });
    if (cap) {
      setEditor(cap);
      setDefaultsJson(JSON.stringify(cap.defaults || {}, null, 2));
      setTagsText((cap.tags || []).join(', '));
    }
  };

  const saveCap = async e => {
    e.preventDefault();
    try {
      const payload = {
        ...editor,
        tags: tagsText.split(',').map(t => t.trim()).filter(Boolean),
        ...(editor.kind === 'function' ? { defaults: JSON.parse(defaultsJson || '{}') } : {}),
      };
      const saved = await act('saveCapability', payload);
      if (saved) { setEditor(null); notify(`Saved ${saved.name}.`, 'ok'); loadPage(); }
    } catch (err) { notify(cleanError(err), 'error'); }
  };

  const customCommands = state.settings.customCommands || [];

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1>Library & Agent Toolbox</h1>
            <p className="subtitle">Reusable skills, tool functions, persistent memories, custom slash commands, and autonomous self-improvement.</p>
          </div>
          <div className="row">
            <button type="button" className="btn-secondary" onClick={() => navigate('gallery')}><Sparkles size={14} /> Skills & Plugins Gallery</button>
            <button type="button" className="btn-secondary" onClick={() => { setEditor(emptyCap('function')); setDefaultsJson('{}'); setTagsText(''); }}><Braces size={14} /> New Function</button>
            <button type="button" className="btn-primary" onClick={() => { setEditor(emptyCap('skill')); setTagsText(''); }}><Plus size={14} /> New Skill</button>
          </div>
        </div>

        <div className="stat-strip">
          <div className="stat-tile"><small>Skills</small><strong>{page?.summary?.skills ?? 0}</strong></div>
          <div className="stat-tile"><small>Functions</small><strong>{page?.summary?.functions ?? 0}</strong></div>
          <div className="stat-tile"><small>Memories</small><strong>{memories.length}</strong></div>
          <button type="button" className="stat-tile" onClick={() => navigate('mcp')}><small>MCP Servers</small><strong>{state.mcpServers.length}</strong></button>
        </div>

        <div className="sticky-pills">
          <button type="button" aria-pressed={subTab === 'capabilities'} onClick={() => setSubTab('capabilities')}><BookOpen size={14} /> Skills & Functions</button>
          <button type="button" aria-pressed={subTab === 'memories'} onClick={() => setSubTab('memories')}><Brain size={14} /> Memories ({memories.length})</button>
          <button type="button" aria-pressed={subTab === 'commands'} onClick={() => setSubTab('commands')}><Terminal size={14} /> Custom Slash Commands ({customCommands.length})</button>
          <button type="button" aria-pressed={subTab === 'improve'} onClick={async () => { setSubTab('improve'); setAnalysis(await act('selfImprove', { action: 'analyze' })); }}><Sparkles size={14} /> Self-Improve Telemetry</button>
        </div>

        {subTab === 'capabilities' && (
          <div>
            <div className="row-between" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
              <div className="row">
                {[['all', 'All'], ['skill', 'Skills'], ['function', 'Functions']].map(([val, label]) => (
                  <button key={val} type="button" className={kind === val ? 'btn-primary' : 'btn-secondary'} style={{ padding: '5px 11px', fontSize: 12 }} onClick={() => { setKind(val); setOffset(0); }}>{label}</button>
                ))}
              </div>
              <div className="sidebar-search" style={{ width: 320, margin: 0 }}>
                <Search size={14} />
                <input placeholder="Search skills & functions…" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} />
              </div>
            </div>

            <div className="grid-3">
              {(page?.items || []).map(item => (
                <button key={item.id} type="button" className="cap-card" onClick={() => openEditor(item.id)}>
                  <div className="row-between" style={{ width: '100%' }}>
                    <span className="pill">{item.kind}</span>
                    <small className="hint">{item.enabled ? 'Active' : 'Disabled'}</small>
                  </div>
                  <strong style={{ fontSize: 14 }}>{item.name}</strong>
                  <p className="hint" style={{ margin: 0 }}>{item.description || 'No description'}</p>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                    {(item.tags || []).slice(0, 4).map(t => <span key={t} className="tag-chip">{t}</span>)}
                  </div>
                </button>
              ))}
            </div>
            {!page?.items?.length && <div className="panel-card"><p className="hint">No capabilities yet. Create a Skill or Function above, or run `/self-improve` in chat.</p></div>}
          </div>
        )}

        {subTab === 'memories' && (
          <div className="panel-card">
            <div className="row-between" style={{ marginBottom: 8 }}>
              <div>
                <h2 style={{ margin: 0 }}>Persistent User & Project Memories</h2>
                <p className="hint" style={{ margin: '4px 0 0' }}>Priorities, preferences, constraints, and facts automatically injected into sessions.</p>
              </div>
              <button type="button" className="btn-secondary" onClick={() => navigate('memory')}><Brain size={14} /> Open Full Memory Studio</button>
            </div>
            <form className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }} onSubmit={async e => {
              e.preventDefault();
              if (!memKey.trim() || !memVal.trim()) return;
              const list = await act('memorySave', { key: memKey, value: memVal, scope: memScope, category: 'preference', priority: 'high' });
              if (list) { setMemories(list); setMemKey(''); setMemVal(''); notify('Memory stored.', 'ok'); }
            }}>
              <input placeholder="Topic / key" value={memKey} onChange={e => setMemKey(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
              <input placeholder="Preference, priority, or rule to remember…" value={memVal} onChange={e => setMemVal(e.target.value)} style={{ flex: 2, minWidth: 240 }} />
              <select value={memScope} onChange={e => setMemScope(e.target.value)} style={{ width: 120 }}><option value="global">Global</option><option value="project">Project</option></select>
              <button className="btn-primary"><Plus size={14} /> Remember</button>
            </form>
            {memories.map(m => (
              <div key={m.id} className="list-row">
                <div>
                  <strong>{m.key}</strong>
                  <span className="pill" style={{ marginLeft: 6 }}>{m.category || 'fact'}</span>
                  <span className="pill info" style={{ marginLeft: 4 }}>{m.priority || 'normal'}</span>
                  <span className="pill" style={{ marginLeft: 4 }}>{m.scope}</span>
                  <p className="hint" style={{ margin: '4px 0 0' }}>{m.value}</p>
                </div>
                <button type="button" className="btn-danger" onClick={async () => setMemories(await act('memoryDelete', { id: m.id }) || [])}><Trash2 size={14} /></button>
              </div>
            ))}
            {!memories.length && <p className="hint">No stored memories yet.</p>}
          </div>
        )}

        {subTab === 'commands' && (
          <div className="panel-card">
            <h2>Custom Slash Commands</h2>
            <p className="hint">Define reusable <code>/commands</code> available in the chat autocomplete popover. Use <code>{'{{args}}'}</code> to inject trailing user text.</p>
            <form onSubmit={async e => {
              e.preventDefault();
              if (!cmdName.trim() || !cmdTemplate.trim()) return;
              const next = [...customCommands, { command: '/' + cmdName.trim().replace(/^\/+/, ''), description: cmdDesc.trim() || 'Custom command', template: cmdTemplate.trim(), mode: cmdMode }];
              if (await act('settings', { customCommands: next })) {
                setCmdName(''); setCmdDesc(''); setCmdTemplate('');
                notify('Custom slash command saved.', 'ok');
              }
            }}>
              <div className="grid-3">
                <label className="field"><span>Command (e.g. /deploy)</span><input required value={cmdName} onChange={e => setCmdName(e.target.value)} placeholder="/refactor" /></label>
                <label className="field"><span>Description</span><input value={cmdDesc} onChange={e => setCmdDesc(e.target.value)} placeholder="Short description" /></label>
                <label className="field"><span>Operating Mode</span><select value={cmdMode} onChange={e => setCmdMode(e.target.value)}>{MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
              </div>
              <label className="field"><span>Prompt Template</span><textarea required rows={3} value={cmdTemplate} onChange={e => setCmdTemplate(e.target.value)} placeholder="Refactor {{args}} with zero regressions and run tests…" /></label>
              <button className="btn-primary"><Plus size={14} /> Add Slash Command</button>
            </form>

            <div style={{ marginTop: 18 }}>
              {customCommands.map((c, idx) => (
                <div key={c.command + idx} className="list-row">
                  <div>
                    <strong className="mono" style={{ color: 'var(--accent)' }}>{c.command}</strong> <span className="pill" style={{ marginLeft: 6 }}>{c.mode || 'default'}</span>
                    <p className="hint" style={{ margin: '4px 0 0' }}>{c.description} — <code>{c.template.slice(0, 120)}</code></p>
                  </div>
                  <button type="button" className="btn-danger" onClick={() => act('settings', { customCommands: customCommands.filter((_, i) => i !== idx) })}><Trash2 size={14} /></button>
                </div>
              ))}
              {!customCommands.length && <p className="hint">No custom commands added yet.</p>}
            </div>
          </div>
        )}

        {subTab === 'improve' && (
          <div className="panel-card">
            <div className="row-between" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Workspace Telemetry & Self-Improvement</h2>
              <button type="button" className="btn-secondary" onClick={async () => setAnalysis(await act('selfImprove', { action: 'analyze' }))}>Re-Analyze</button>
            </div>
            {analysis ? (
              <>
                <div className="stat-strip">
                  <div className="stat-tile"><small>Total Tasks</small><strong>{analysis.summary.totalTasks}</strong></div>
                  <div className="stat-tile"><small>Completed</small><strong>{analysis.summary.completedTasks}</strong></div>
                  <div className="stat-tile"><small>Model Calls</small><strong>{analysis.summary.totalModelCalls}</strong></div>
                  <div className="stat-tile"><small>Recent Tool Errors</small><strong>{analysis.recentToolErrors.length}</strong></div>
                </div>
                <h3>Recommendations</h3>
                <ul>{(analysis.recommendations || []).map((r, i) => <li key={i} className="hint">{r}</li>)}</ul>
                {analysis.recentToolErrors.length > 0 && (
                  <>
                    <h3>Recent Tool Errors</h3>
                    <pre className="pre-box" style={{ maxHeight: 220 }}>{JSON.stringify(analysis.recentToolErrors, null, 2)}</pre>
                  </>
                )}
              </>
            ) : <p className="hint">Running telemetry introspection…</p>}
          </div>
        )}

        {editor && (
          <Modal label={editor.kind === 'skill' ? 'Skill Editor' : 'Function Editor'} close={() => setEditor(null)} wide>
            <h2>{editor.id ? `Edit ${editor.kind}` : `New ${editor.kind}`}</h2>
            <form onSubmit={saveCap}>
              <label className="field"><span>Name</span><input required value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })} /></label>
              <label className="field"><span>Description</span><input value={editor.description} onChange={e => setEditor({ ...editor, description: e.target.value })} /></label>
              <label className="field"><span>Tags (comma-separated)</span><input value={tagsText} onChange={e => setTagsText(e.target.value)} /></label>
              {editor.kind === 'skill' ? (
                <label className="field"><span>Instructions</span><textarea className="mono" rows={8} required value={editor.instructions} onChange={e => setEditor({ ...editor, instructions: e.target.value })} /></label>
              ) : (
                <>
                  <label className="field"><span>Target Tool</span><select value={editor.tool} onChange={e => setEditor({ ...editor, tool: e.target.value })}>{(page?.functionTargets || ['read_file']).map(t => <option key={t}>{t}</option>)}</select></label>
                  <label className="field"><span>Default Arguments (JSON)</span><textarea className="mono" rows={6} value={defaultsJson} onChange={e => setDefaultsJson(e.target.value)} /></label>
                </>
              )}
              <label className="switch-row">
                <div><strong>Enabled for agents</strong><p>Disable to hide from discovery without deleting history.</p></div>
                <input type="checkbox" className="switch-input" checked={editor.enabled} onChange={e => setEditor({ ...editor, enabled: e.target.checked })} />
              </label>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn-secondary" onClick={() => setEditor(null)}>Cancel</button>
                <button className="btn-primary">Save Definition</button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    </div>
  );
}
