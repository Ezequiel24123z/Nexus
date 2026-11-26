import React, { useEffect, useState } from 'react';
import { X, Search, FileText, FolderOpen, Terminal, RefreshCw, Play, Folder } from 'lucide-react';
import Modal from './Modal.jsx';
import { cleanError } from '../lib/format.mjs';

const api = (method, args) => window.nexus.invoke(method, args);

export default function ChatDrawer({ task, workspace, mode, setMode, close, jump, onInsertMention }) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  // Quick Files state
  const [filePath, setFilePath] = useState('.');
  const [entries, setEntries] = useState([]);
  const [fileContent, setFileContent] = useState(null);

  // Quick Shell state
  const [shellCmd, setShellCmd] = useState('');
  const [shellLog, setShellLog] = useState([]);

  const activeWorkspace = task?.workspace || workspace || '';

  useEffect(() => {
    if (!task || (mode !== 'search' && mode !== 'results')) return;
    let active = true;
    setBusy(true);
    setError('');
    const timer = setTimeout(() => {
      api(mode === 'search' ? 'searchChat' : 'taskResults', { id: task.id, query })
        .then(res => { if (active) setData(res); })
        .catch(e => { if (active) setError(cleanError(e)); })
        .finally(() => { if (active) setBusy(false); });
    }, mode === 'search' ? 180 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [task?.id, mode, query]);

  const loadFiles = async (loc = '.') => {
    if (!activeWorkspace) return;
    setBusy(true);
    setError('');
    try {
      const list = await api('files', { workspace: activeWorkspace, path: loc });
      setEntries(list || []);
      setFilePath(loc);
      setFileContent(null);
    } catch (e) { setError(cleanError(e)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (mode === 'files' && activeWorkspace) void loadFiles('.');
  }, [mode, activeWorkspace]);

  const runShell = async e => {
    e.preventDefault();
    if (!shellCmd.trim()) return;
    const cmd = shellCmd.trim();
    setBusy(true);
    try {
      const res = await api('terminalExec', { workspace: activeWorkspace, command: cmd, sessionId: 'drawer-' + (task?.id || 'global') });
      setShellLog(prev => [{ cmd, exitCode: res.exitCode, cwd: res.cwd, output: res.output }, ...prev.slice(0, 15)]);
      setShellCmd('');
    } catch (err) {
      setShellLog(prev => [{ cmd, exitCode: 1, output: cleanError(err) }, ...prev.slice(0, 15)]);
    } finally { setBusy(false); }
  };

  const inspectResult = async item => {
    setPreview({ name: item.name, loading: true });
    try {
      setPreview(await api('previewResult', { id: task.id, resultId: item.id }));
    } catch (e) {
      setPreview({ name: item.name, error: cleanError(e) });
    }
  };

  return (
    <aside className="side-drawer" aria-label="Workspace side drawer">
      <div className="side-drawer-head">
        <div className="row" style={{ gap: 2 }}>
          {task && <button type="button" className={mode === 'search' ? 'btn-secondary' : ''} style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => setMode('search')}><Search size={13} /> Search</button>}
          {task && <button type="button" className={mode === 'results' ? 'btn-secondary' : ''} style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => setMode('results')}><FileText size={13} /> Results</button>}
          <button type="button" className={mode === 'files' ? 'btn-secondary' : ''} style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => setMode('files')}><FolderOpen size={13} /> Files</button>
          <button type="button" className={mode === 'shell' ? 'btn-secondary' : ''} style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => setMode('shell')}><Terminal size={13} /> Shell</button>
        </div>
        <button type="button" className="btn-icon" aria-label="Close side drawer" onClick={close}><X size={16} /></button>
      </div>

      <div className="side-drawer-body">
        {error && <p className="pill err" style={{ marginBottom: 10 }}>{error}</p>}

        {mode === 'search' && task && (
          <div>
            <input aria-label="Search text in chat" placeholder="Search full chat history…" value={query} onChange={e => setQuery(e.target.value)} style={{ marginBottom: 10 }} />
            <p className="hint">{busy ? 'Searching…' : `${data?.total ?? 0} messages found`}</p>
            <div style={{ display: 'grid', gap: 8 }}>
              {(data?.items || []).map(item => (
                <button key={item.id} type="button" className="cap-card" style={{ width: '100%' }} onClick={() => jump(item.id)}>
                  <small className="hint">{item.role === 'user' ? 'You' : 'NEXUS'}</small>
                  <span style={{ fontSize: 12 }}>{item.snippet}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'results' && task && (
          <div>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <span className="hint">{data?.total ?? 0} recorded outputs</span>
              <button type="button" className="btn-secondary" style={{ padding: '4px 8px', fontSize: 11.5 }} onClick={() => setQuery(q => q + ' ')}><RefreshCw size={12} /> Refresh</button>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {(data?.items || []).map(item => (
                <div key={item.id} className="cap-card" style={{ width: '100%' }}>
                  <span className="tag-chip">{item.kind}</span>
                  <strong className="mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{item.name}</strong>
                  {item.note && <small className="hint">{item.note}</small>}
                  <button type="button" className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 9px' }} onClick={() => item.kind === 'source' ? jump(item.messageId) : inspectResult(item)}>
                    {item.kind === 'source' ? 'Jump to message' : 'Inspect content'}
                  </button>
                </div>
              ))}
              {!data?.items?.length && <p className="hint">Modified files, large tool artifacts, cited sources, and progress notes will appear here.</p>}
            </div>
          </div>
        )}

        {mode === 'files' && (
          !activeWorkspace ? <p className="hint">Choose a workspace folder in the composer to browse files alongside chat.</p> : (
            <div>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <button type="button" className="btn-secondary mono" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={() => loadFiles(filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') || '.' : '.')}>
                  {filePath === '.' ? '/' : `← /${filePath}`}
                </button>
                <button type="button" className="btn-icon" onClick={() => loadFiles(filePath)}><RefreshCw size={13} /></button>
              </div>
              {fileContent ? (
                <div>
                  <div className="row-between" style={{ marginBottom: 8 }}>
                    <strong className="mono" style={{ fontSize: 11.5, overflowWrap: 'anywhere' }}>{fileContent.path}</strong>
                    <div className="row">
                      {onInsertMention && <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: '3px 7px' }} onClick={() => onInsertMention(`@${fileContent.path}`)}>@Mention</button>}
                      <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: '3px 7px' }} onClick={() => setFileContent(null)}>Back</button>
                    </div>
                  </div>
                  <pre className="pre-box" style={{ maxHeight: '68vh', fontSize: 11.5 }}>{fileContent.content}</pre>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 2 }}>
                  {entries.map(item => (
                    <button
                      key={item.name}
                      type="button"
                      className="file-row"
                      onClick={async () => {
                        const rel = filePath === '.' ? item.name : `${filePath}/${item.name}`;
                        if (item.directory) void loadFiles(rel);
                        else {
                          try {
                            const content = await api('readFile', { workspace: activeWorkspace, path: rel });
                            setFileContent({ path: rel, content });
                          } catch (e) { setError(cleanError(e)); }
                        }
                      }}
                    >
                      {item.directory ? <Folder size={14} style={{ color: 'var(--accent)' }} /> : <FileText size={14} style={{ color: 'var(--ink-muted)' }} />}
                      <span>{item.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        )}

        {mode === 'shell' && (
          <div>
            <p className="hint" style={{ marginBottom: 8 }}>Stateful PowerShell session — persists directory (`cd`) and env vars.</p>
            <form className="row" onSubmit={runShell} style={{ marginBottom: 10 }}>
              <input placeholder="Run command…" value={shellCmd} onChange={e => setShellCmd(e.target.value)} disabled={busy} />
              <button className="btn-primary" style={{ padding: '7px 11px' }} disabled={busy || !shellCmd.trim()}><Play size={13} /></button>
            </form>
            <div style={{ display: 'grid', gap: 8 }}>
              {shellLog.map((entry, idx) => (
                <div key={idx} className="tool-card">
                  <div className="tool-card-head" style={{ cursor: 'default' }}>
                    <span className="tool-name" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>PS&gt; {entry.cmd}</span>
                    <span className={`pill ${entry.exitCode === 0 ? 'ok' : 'err'}`}>{entry.exitCode}</span>
                  </div>
                  <div className="tool-card-body">
                    <pre>{entry.output || '(No output)'}</pre>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {preview && (
        <Modal label="Result Preview" close={() => setPreview(null)} wide>
          <h3>{preview.name}</h3>
          {preview.loading ? <p className="hint">Loading…</p> : preview.error ? <p className="pill err">{preview.error}</p> : (
            <>
              <p className="hint">{preview.note}</p>
              <pre className="pre-box" style={{ maxHeight: '60vh' }}>{preview.content || '(Empty)'}</pre>
            </>
          )}
        </Modal>
      )}
    </aside>
  );
}
