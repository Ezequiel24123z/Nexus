import React, { useEffect, useState } from 'react';
import {
  Sparkles, Download, Check, Trash2, Plug, Puzzle, CloudDownload, Search, Plus, BookOpen, Code2
} from 'lucide-react';
import { cleanError } from '../lib/format.mjs';

const api = (method, args) => window.nexus.invoke(method, args);

export default function GalleryView({ act, notify, navigate }) {
  const [tab, setTab] = useState('skills');
  const [catalog, setCatalog] = useState(null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState('');
  const [cloudUrl, setCloudUrl] = useState('');
  const [ghQuery, setGhQuery] = useState('');
  const [ghResults, setGhResults] = useState(null);
  const [ghBusy, setGhBusy] = useState(false);
  const [mcpTestState, setMcpTestState] = useState({});
  const [newTool, setNewTool] = useState({
    name: 'parse_env_file',
    description: 'Parse a .env file into key names (values masked)',
    readOnly: true,
    parameters: '{"type":"object","properties":{"filePath":{"type":"string"}},"required":["filePath"]}',
    handlerCode: 'const raw = await fs.readFile(path.resolve(workspace, args.filePath), "utf8");\nconst keys = raw.split(/\\r?\\n/).filter(l => l.trim() && !l.trim().startsWith("#")).map(l => l.split("=")[0].trim());\nreturn { count: keys.length, keys };',
  });

  const refresh = () => api('galleryCatalog').then(setCatalog).catch(e => notify(cleanError(e), 'error'));
  useEffect(() => { void refresh(); }, []);

  const installSkill = async id => {
    setBusyId(id);
    try {
      const res = await act('galleryInstallSkill', { id });
      if (res?.installed) { notify(`Installed skill "${res.skill.name}".`, 'ok'); await refresh(); }
    } finally { setBusyId(''); }
  };

  const installAllSkills = async () => {
    setBusyId('all-skills');
    try {
      const res = await act('galleryInstallAllSkills');
      if (res) { notify(`Installed ${res.installedCount} curated skills into your Library.`, 'ok'); await refresh(); }
    } finally { setBusyId(''); }
  };

  const installPlugin = async id => {
    setBusyId(id);
    try {
      const res = await act('galleryInstallPlugin', { id });
      if (res?.installed) {
        notify(res.kind === 'mcp'
          ? `Installed MCP plugin "${res.server}". Connect it in MCP Extensions or use directly in chat.`
          : `Hot-loaded native plugin "${res.plugin.name}" (${res.plugin.toolNames.join(', ')}).`, 'ok');
        await refresh();
      }
    } finally { setBusyId(''); }
  };

  const importFromUrl = async url => {
    const target = (url ?? cloudUrl).trim();
    if (!target) return;
    setBusyId('cloud-import');
    try {
      const res = await act('galleryImportSkillUrl', { url: target });
      if (res?.imported) {
        setCloudUrl('');
        notify(`Downloaded & adapted "${res.skill.name}" from GitHub into your Library.`, 'ok');
        await refresh();
      }
    } finally { setBusyId(''); }
  };

  const testConnectMcp = async id => {
    setBusyId('test-' + id);
    try {
      const res = await act('galleryTestConnectMcp', { id });
      if (res?.connected) {
        setMcpTestState(prev => ({ ...prev, [id]: res }));
        notify(`Connected MCP "${res.server}" — ${res.toolCount} live tools ready.`, 'ok');
        await refresh();
      }
    } finally { setBusyId(''); }
  };

  const searchGithub = async e => {
    e?.preventDefault();
    setGhBusy(true);
    try {
      const res = await api('gallerySearchGithubSkills', { query: ghQuery.trim() });
      setGhResults(res?.items || []);
    } catch (err) {
      notify(cleanError(err), 'error');
    } finally { setGhBusy(false); }
  };

  const createTool = async e => {
    e.preventDefault();
    setBusyId('create-tool');
    try {
      const parsedParams = JSON.parse(newTool.parameters || '{}');
      const res = await act('pluginCreateTool', { ...newTool, parameters: parsedParams });
      if (res) {
        notify(`Hot-registered live tool "${newTool.name}"! Immediately usable by agents.`, 'ok');
        await refresh();
      }
    } catch (err) {
      notify(cleanError(err), 'error');
    } finally { setBusyId(''); }
  };

  const q = query.trim().toLowerCase();
  const match = item => !q || (item.name + ' ' + item.description + ' ' + (item.category || '') + ' ' + (item.tags || []).join(' ')).toLowerCase().includes(q);

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1>Skills & Plugins Gallery</h1>
            <p className="subtitle">Curated cloud-adapted skills, zero-dependency live JS plugins, official MCP servers, and direct GitHub <code>SKILL.md</code> import.</p>
          </div>
          <div className="row">
            <button type="button" className="btn-secondary" onClick={() => navigate('library')}><BookOpen size={14} /> My Library</button>
            <button type="button" className="btn-primary" disabled={busyId === 'all-skills'} onClick={installAllSkills}>
              <Download size={14} /> {busyId === 'all-skills' ? 'Installing…' : 'Install All 12 Core Skills'}
            </button>
          </div>
        </div>

        <div className="row-between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div className="sticky-pills" style={{ marginBottom: 0 }}>
            <button type="button" aria-pressed={tab === 'skills'} onClick={() => setTab('skills')}><Sparkles size={14} /> Curated Skills ({catalog?.skills?.length ?? 12})</button>
            <button type="button" aria-pressed={tab === 'native'} onClick={() => setTab('native')}><Puzzle size={14} /> Native JS Plugins ({catalog?.nativePlugins?.length ?? 4})</button>
            <button type="button" aria-pressed={tab === 'mcp'} onClick={() => setTab('mcp')}><Plug size={14} /> Cloud MCP Plugins ({catalog?.mcpPlugins?.length ?? 9})</button>
            <button type="button" aria-pressed={tab === 'cloud'} onClick={() => setTab('cloud')}><CloudDownload size={14} /> Import GitHub SKILL.md</button>
            <button type="button" aria-pressed={tab === 'author'} onClick={() => setTab('author')}><Code2 size={14} /> Live Tool Author</button>
          </div>
          {['skills', 'native', 'mcp'].includes(tab) && (
            <div className="sidebar-search" style={{ width: 280, margin: 0 }}>
              <Search size={14} />
              <input placeholder="Filter gallery…" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
          )}
        </div>

        {!catalog ? <p className="hint">Loading gallery…</p> : (
          <>
            {tab === 'skills' && (
              <div className="grid-3">
                {catalog.skills.filter(match).map(skill => (
                  <section key={skill.id} className="panel-card" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="row-between">
                      <span className="pill info">{skill.category}</span>
                      <small className="hint" style={{ fontSize: 10.5 }}>{skill.source}</small>
                    </div>
                    <strong style={{ fontSize: 14 }}>{skill.name}</strong>
                    <p className="hint" style={{ flex: 1, margin: 0 }}>{skill.description}</p>
                    <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                      {skill.tags.map(t => <span key={t} className="tag-chip">{t}</span>)}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <button
                        type="button"
                        className={skill.installed ? 'btn-secondary' : 'btn-primary'}
                        style={{ width: '100%' }}
                        disabled={busyId === skill.id}
                        onClick={() => installSkill(skill.id)}
                      >
                        {skill.installed ? <><Check size={14} /> Installed (Re-sync)</> : <><Download size={14} /> Install Skill</>}
                      </button>
                    </div>
                  </section>
                ))}
              </div>
            )}

            {tab === 'native' && (
              <div>
                <div className="grid-2" style={{ marginBottom: 20 }}>
                  {catalog.nativePlugins.filter(match).map(plugin => (
                    <section key={plugin.id} className="panel-card" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div className="row-between">
                        <span className="pill ok">{plugin.category}</span>
                        <small className="hint">{plugin.author}</small>
                      </div>
                      <strong style={{ fontSize: 15 }}>{plugin.name}</strong>
                      <p className="hint" style={{ flex: 1, margin: 0 }}>{plugin.description}</p>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                        {plugin.tools.map(t => <span key={t} className="tag-chip mono">{t}</span>)}
                      </div>
                      <div className="row" style={{ marginTop: 6 }}>
                        <button
                          type="button"
                          className={plugin.installed ? 'btn-secondary' : 'btn-primary'}
                          style={{ flex: 1 }}
                          disabled={busyId === plugin.id}
                          onClick={() => installPlugin(plugin.id)}
                        >
                          {plugin.installed ? <><Check size={14} /> Hot-Loaded</> : <><Download size={14} /> Install & Activate</>}
                        </button>
                        {plugin.installed && (
                          <button type="button" className="btn-danger" onClick={async () => { await act('pluginUninstall', { id: plugin.id }); await refresh(); }}><Trash2 size={14} /></button>
                        )}
                      </div>
                    </section>
                  ))}
                </div>

                {catalog.installedPlugins?.length > 0 && (
                  <section className="panel-card">
                    <h2>All Installed Dynamic Plugins ({catalog.installedPlugins.length})</h2>
                    {catalog.installedPlugins.map(p => (
                      <div key={p.id} className="list-row">
                        <div>
                          <strong>{p.name}</strong> <span className="pill" style={{ marginLeft: 6 }}>{p.toolNames.join(', ') || 'No tools'}</span>
                          <div className="hint">{p.description}</div>
                        </div>
                        <div className="row">
                          <input type="checkbox" className="switch-input" checked={p.enabled !== false} onChange={async e => { await act('pluginToggle', { id: p.id, enabled: e.target.checked }); await refresh(); }} />
                          <button type="button" className="btn-danger" onClick={async () => { await act('pluginUninstall', { id: p.id }); await refresh(); }}><Trash2 size={13} /></button>
                        </div>
                      </div>
                    ))}
                  </section>
                )}
              </div>
            )}

            {tab === 'mcp' && (
              <div className="grid-3">
                {catalog.mcpPlugins.filter(match).map(plugin => (
                  <section key={plugin.id} className="panel-card" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="row-between">
                      <span className="pill info">{plugin.category}</span>
                      <span className={`pill ${plugin.requiresKey ? 'warn' : 'ok'}`}>{plugin.requiresKey ? 'API Key Optional/Req' : 'Zero-Key'}</span>
                    </div>
                    <strong style={{ fontSize: 14 }}>{plugin.name}</strong>
                    <small className="hint" style={{ marginTop: -4 }}>By {plugin.author}</small>
                    <p className="hint" style={{ flex: 1, margin: 0 }}>{plugin.description}</p>
                    <code className="hint mono" style={{ fontSize: 10.5 }}>{plugin.serverConfig.command} {plugin.serverConfig.args.join(' ')}</code>
                    {plugin.secretHint && <small className="hint">Secret ref: <code>{plugin.secretHint}</code></small>}
                    {mcpTestState[plugin.id] && (
                      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                        <span className="pill ok">{mcpTestState[plugin.id].toolCount} live tools</span>
                        {(mcpTestState[plugin.id].sampleTools || []).slice(0, 4).map(t => <span key={t} className="tag-chip mono">{t}</span>)}
                      </div>
                    )}
                    <div className="row" style={{ marginTop: 4 }}>
                      <button
                        type="button"
                        className={plugin.installed ? 'btn-secondary' : 'btn-primary'}
                        style={{ flex: 1 }}
                        disabled={busyId === plugin.id || busyId === 'test-' + plugin.id}
                        onClick={() => installPlugin(plugin.id)}
                      >
                        {plugin.installed ? <><Check size={14} /> Installed</> : <><Download size={14} /> Install</>}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={busyId === 'test-' + plugin.id}
                        title="Install, start MCP server, and verify live discovered tools"
                        onClick={() => testConnectMcp(plugin.id)}
                      >
                        <Plug size={13} /> {busyId === 'test-' + plugin.id ? 'Testing…' : 'Test & Connect'}
                      </button>
                    </div>
                  </section>
                ))}
              </div>
            )}

            {tab === 'cloud' && (
              <div className="settings-grid">
                <section className="panel-card wide">
                  <h2>Live GitHub <code>SKILL.md</code> Cloud Search</h2>
                  <p className="hint">Search open-standard <code>SKILL.md</code> files across <code>obra/superpowers</code>, <code>anthropics/skills</code>, <code>github/awesome-copilot</code>, and public GitHub repositories in real time.</p>
                  <form className="row" onSubmit={searchGithub} style={{ marginBottom: 12 }}>
                    <input
                      style={{ flex: 1 }}
                      value={ghQuery}
                      onChange={e => setGhQuery(e.target.value)}
                      placeholder="Search cloud skills (e.g. react, security, testing, docker, python, or leave blank to browse all)…"
                    />
                    <button className="btn-primary" disabled={ghBusy}><Search size={14} /> {ghBusy ? 'Searching GitHub…' : 'Search GitHub'}</button>
                  </form>
                  {ghResults && (
                    <div style={{ display: 'grid', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                      {ghResults.map(item => (
                        <div key={item.rawUrl} className="list-row" style={{ padding: '8px 10px', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <div className="row" style={{ gap: 6 }}>
                              <strong style={{ fontSize: 12.5 }}>{item.name}</strong>
                              <span className="tag-chip mono">{item.repo}</span>
                              {item.stars > 0 && <span className="hint tabular" style={{ fontSize: 10.5 }}>★ {item.stars}</span>}
                            </div>
                            <div className="hint mono" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.path}</div>
                          </div>
                          <button type="button" className="btn-primary" style={{ fontSize: 11.5, padding: '4px 10px', flexShrink: 0 }} disabled={busyId === 'cloud-import'} onClick={() => importFromUrl(item.rawUrl)}>
                            <Download size={12} /> Install
                          </button>
                        </div>
                      ))}
                      {!ghResults.length && <p className="hint">No matching <code>SKILL.md</code> files found for "{ghQuery}".</p>}
                    </div>
                  )}
                </section>

                <section className="panel-card">
                  <h2>Import Any Cloud <code>SKILL.md</code></h2>
                  <p className="hint">Paste any GitHub or raw HTTPS URL to a standard <code>SKILL.md</code> file. NEXUS downloads it, parses YAML frontmatter, adapts it, and registers it immediately.</p>
                  <form onSubmit={e => { e.preventDefault(); void importFromUrl(); }}>
                    <label className="field">
                      <span>GitHub or Raw SKILL.md URL</span>
                      <input required value={cloudUrl} onChange={e => setCloudUrl(e.target.value)} placeholder="https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md" />
                    </label>
                    <button className="btn-primary" disabled={busyId === 'cloud-import' || !cloudUrl.trim()}>
                      <CloudDownload size={14} /> {busyId === 'cloud-import' ? 'Downloading…' : 'Fetch & Install Skill'}
                    </button>
                  </form>
                </section>

                <section className="panel-card">
                  <h2>Popular Upstream Open-Source Skills</h2>
                  <p className="hint">1-click download directly from the leading open-source GitHub skill repositories:</p>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {(catalog.cloudSources || []).map(src => (
                      <div key={src.url} className="list-row" style={{ padding: '8px 10px', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ fontSize: 12.5 }}>{src.name}</strong>
                          <div className="hint mono" style={{ fontSize: 10.5 }}>{src.repo}</div>
                        </div>
                        <button type="button" className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 9px' }} disabled={busyId === 'cloud-import'} onClick={() => importFromUrl(src.url)}>
                          <Download size={12} /> Fetch
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {tab === 'author' && (
              <form className="panel-card" onSubmit={createTool}>
                <h2>Hot-Register a New Native JS Agent Tool</h2>
                <p className="hint">Write any Node.js async function and hot-load it straight into NEXUS's live agent toolbelt without restarting. Agents can also do this autonomously using <code>create_dynamic_tool</code>.</p>
                <div className="grid-2">
                  <label className="field"><span>Tool Name (snake_case)</span><input className="mono" required value={newTool.name} onChange={e => setNewTool({ ...newTool, name: e.target.value })} /></label>
                  <label className="field"><span>Description</span><input required value={newTool.description} onChange={e => setNewTool({ ...newTool, description: e.target.value })} /></label>
                </div>
                <label className="field"><span>Input JSON Schema</span><textarea className="mono" rows={3} value={newTool.parameters} onChange={e => setNewTool({ ...newTool, parameters: e.target.value })} /></label>
                <label className="field"><span>Async JS Handler Body (receives <code>args</code> + <code>fs, path, os, net, dns, crypto, execFileAsync, require, fetch, workspace</code>)</span><textarea className="mono" rows={6} required value={newTool.handlerCode} onChange={e => setNewTool({ ...newTool, handlerCode: e.target.value })} /></label>
                <label className="switch-row">
                  <div><strong>Read-Only Tool</strong><p>Read-only tools run in parallel and never require Semi-Autopilot confirmation.</p></div>
                  <input type="checkbox" className="switch-input" checked={newTool.readOnly} onChange={e => setNewTool({ ...newTool, readOnly: e.target.checked })} />
                </label>
                <button className="btn-primary" disabled={busyId === 'create-tool'}><Plus size={14} /> Hot-Load Tool Now</button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
