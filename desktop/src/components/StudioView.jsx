import React, { useEffect, useRef, useState } from 'react';
import {
  FolderOpen, Folder, FileText, GitBranch, Terminal, Cpu, ShieldCheck, Layers,
  RefreshCw, Plus, Minus, Check, Play, Square, Save, Trash2, RotateCcw, ArrowUpRight, Eye, Code2
} from 'lucide-react';
import { tokenizeCode } from '../lib/highlight.mjs';
import { parseAnsiSegments } from '../lib/ansi.mjs';
import { cleanError } from '../lib/format.mjs';

const api = (method, args) => window.nexus.invoke(method, args);

export default function StudioView({ workspace, setWorkspace, act, notify, onOpenInChat }) {
  const [tab, setTab] = useState('files');
  const [busy, setBusy] = useState(false);

  // Files & Editor
  const [filePath, setFilePath] = useState('.');
  const [entries, setEntries] = useState([]);
  const [filterText, setFilterText] = useState('');
  const [openFile, setOpenFile] = useState(null);
  const [editorText, setEditorText] = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  const [newPath, setNewPath] = useState('');

  // Git
  const [git, setGit] = useState(null);
  const [branches, setBranches] = useState([]);
  const [newBranch, setNewBranch] = useState('');
  const [diff, setDiff] = useState('');
  const [diffTarget, setDiffTarget] = useState('');
  const [diffStaged, setDiffStaged] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');

  // Interactive Streaming Terminal (persistent PowerShell + live SSE stdout/stderr + ANSI colors)
  const [termSession, setTermSession] = useState(null);
  const [termBuffer, setTermBuffer] = useState('');
  const [termCmd, setTermCmd] = useState('');
  const [cmdHistory, setCmdHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const termEndRef = useRef(null);

  // Background Processes (auto-polling!)
  const [processes, setProcesses] = useState([]);
  const [bgCmd, setBgCmd] = useState('');
  const [bgLabel, setBgLabel] = useState('');
  const [selectedProc, setSelectedProc] = useState(null);

  // Diagnostics & Worktrees
  const [diag, setDiag] = useState(null);
  const [worktrees, setWorktrees] = useState([]);
  const [wtBranch, setWtBranch] = useState('');
  const [wtPath, setWtPath] = useState('');

  const loadFiles = async (loc = '.') => {
    if (!workspace) return;
    try {
      const list = await api('files', { workspace, path: loc });
      setEntries(list || []);
      setFilePath(loc);
    } catch (e) { notify(cleanError(e), 'error'); }
  };

  const openCodeFile = async rel => {
    try {
      const content = await api('readFile', { workspace, path: rel });
      setOpenFile({ path: rel, original: content });
      setEditorText(content);
      setPreviewMode(false);
    } catch (e) { notify(cleanError(e), 'error'); }
  };

  const saveOpenFile = async () => {
    if (!openFile || !workspace) return;
    setBusy(true);
    try {
      await api('writeFileDirect', { workspace, path: openFile.path, content: editorText });
      setOpenFile({ ...openFile, original: editorText });
      notify(`Saved ${openFile.path}`, 'ok');
    } catch (e) { notify(cleanError(e), 'error'); }
    finally { setBusy(false); }
  };

  const refreshGit = async () => {
    if (!workspace) return;
    try {
      const [status, br, d] = await Promise.all([
        api('gitStatus', { workspace }),
        api('gitAction', { workspace, operation: 'branch' }).catch(() => ({ branches: [] })),
        api('gitDiff', { workspace, target: diffTarget || undefined, staged: diffStaged }).catch(() => ({ diff: '' })),
      ]);
      setGit(status);
      setBranches(br?.branches || []);
      setDiff(d?.diff || '');
    } catch (e) { notify(cleanError(e), 'error'); }
  };

  const refreshProcesses = async () => {
    try {
      const list = await api('processesList');
      setProcesses(list || []);
      if (selectedProc) {
        const detail = await api('processOutput', { id: selectedProc.id }).catch(() => null);
        if (detail) setSelectedProc(detail);
      }
    } catch {}
  };

  const refreshDiagnostics = async () => {
    if (!workspace) return;
    setBusy(true);
    try { setDiag(await api('runDiagnostics', { workspace })); }
    catch (e) { notify(cleanError(e), 'error'); }
    finally { setBusy(false); }
  };

  const refreshWorktrees = async () => {
    if (!workspace) return;
    try {
      const res = await api('gitAction', { workspace, operation: 'worktree_list' });
      setWorktrees(res?.worktrees || []);
    } catch {}
  };

  useEffect(() => {
    if (workspace && tab === 'files') void loadFiles('.');
    if (workspace && tab === 'git') void refreshGit();
    if (workspace && tab === 'diagnostics') void refreshDiagnostics();
    if (workspace && tab === 'worktrees') void refreshWorktrees();
  }, [workspace, tab]);

  // Auto-poll background processes every 2 seconds while tab is open
  useEffect(() => {
    if (tab !== 'processes') return;
    void refreshProcesses();
    const timer = setInterval(refreshProcesses, 2000);
    return () => clearInterval(timer);
  }, [tab, selectedProc?.id]);

  // Ctrl+S saves open file in editor
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && tab === 'files' && openFile) {
        e.preventDefault();
        void saveOpenFile();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, openFile, editorText]);

  const inspectFileDiff = async (target, staged = false) => {
    setDiffTarget(target);
    setDiffStaged(staged);
    try {
      const d = await api('gitDiff', { workspace, target, staged });
      setDiff(d?.diff || '(No diff changes)');
    } catch (e) { notify(cleanError(e), 'error'); }
  };

  const handleCommit = async stageAll => {
    if (!commitMsg.trim() || !workspace) return;
    setBusy(true);
    try {
      const res = await api('gitAction', { workspace, operation: 'commit', message: commitMsg.trim(), stageAll });
      setCommitMsg('');
      setGit(res.status);
      setDiff('');
      notify(`Committed to ${res.status?.branch || 'repository'}.`, 'ok');
    } catch (e) { notify(cleanError(e), 'error'); }
    finally { setBusy(false); }
  };

  const startInteractiveShell = async () => {
    try {
      const s = await api('termCreate', { cwd: workspace || undefined, title: 'PowerShell', cols: 120, rows: 30 });
      setTermSession(s);
      setTermBuffer(s.buffer || '');
    } catch (e) { notify(cleanError(e), 'error'); }
  };

  const handleTerminalKeyDown = async e => {
    if (!termSession || termSession.status !== 'running') return;
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      const sel = window.getSelection()?.toString();
      if (sel) return; // allow normal copy when text is selected
      e.preventDefault();
      await api('termInterrupt', { id: termSession.id });
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      await api('termWrite', { id: termSession.id, data: '\x0c' });
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const keyMap = {
      Enter: '\r',
      Backspace: '\x7f',
      Tab: '\t',
      Escape: '\x1b',
      ArrowUp: '\x1b[A',
      ArrowDown: '\x1b[B',
      ArrowRight: '\x1b[C',
      ArrowLeft: '\x1b[D',
      Home: '\x1b[H',
      End: '\x1b[F',
      Delete: '\x1b[3~',
    };
    if (keyMap[e.key]) {
      e.preventDefault();
      await api('termWrite', { id: termSession.id, data: keyMap[e.key] });
    } else if (e.key.length === 1) {
      e.preventDefault();
      await api('termWrite', { id: termSession.id, data: e.key });
    }
  };

  useEffect(() => {
    if (tab !== 'terminal') return;
    if (!termSession) {
      api('termList').then(list => {
        if (list?.length) {
          const alive = list.find(s => s.status === 'running') || list[0];
          void api('termGet', { id: alive.id }).then(full => { setTermSession(full); setTermBuffer(full.buffer || ''); });
        } else {
          void startInteractiveShell();
        }
      }).catch(() => {});
    }
    if (!window.nexus?.subscribeTerminal) return;
    return window.nexus.subscribeTerminal(evt => {
      setTermSession(cur => {
        if (!cur || evt.id !== cur.id) return cur;
        if (evt.type === 'data') {
          setTermBuffer(prev => (prev + evt.chunk).slice(-120000));
          requestAnimationFrame(() => termEndRef.current?.scrollIntoView({ block: 'end' }));
        } else if (evt.type === 'exit') {
          return { ...cur, status: 'exited', exitCode: evt.exitCode };
        }
        return cur;
      });
    });
  }, [tab, termSession?.id]);

  const sendToShell = async rawCmd => {
    const cmd = (rawCmd ?? termCmd);
    if (!termSession || termSession.status !== 'running') { await startInteractiveShell(); return; }
    try {
      await api('termWrite', { id: termSession.id, data: cmd + '\r\n' });
      if (cmd.trim()) setCmdHistory(prev => [cmd.trim(), ...prev.filter(x => x !== cmd.trim()).slice(0, 40)]);
      setHistIdx(-1);
      setTermCmd('');
    } catch (e) { notify(cleanError(e), 'error'); }
  };

  const dirty = openFile && editorText !== openFile.original;
  const stagedFiles = (git?.files || []).filter(f => f.staged);
  const unstagedFiles = (git?.files || []).filter(f => !f.staged);
  const visibleEntries = entries.filter(e => !filterText || e.name.toLowerCase().includes(filterText.toLowerCase()));
  const ext = openFile?.path.split('.').pop() || 'text';
  const highlightedPreview = previewMode && openFile ? tokenizeCode(editorText, ext) : null;

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1>Code & Git Studio</h1>
            <p className="subtitle mono" style={{ fontSize: 12 }}>{workspace || 'Select a local workspace folder to unlock full editor, Git, diagnostics, and worktrees.'}</p>
          </div>
          <div className="row">
            {workspace && <button type="button" className="btn-secondary" onClick={() => act('openProject', { workspace })}><ArrowUpRight size={14} /> Open in Explorer</button>}
            <button type="button" className="btn-primary" onClick={async () => { const root = await act('chooseWorkspace'); if (root) setWorkspace(root); }}>
              <FolderOpen size={14} /> Choose Folder
            </button>
          </div>
        </div>

        <div className="sticky-pills" role="tablist">
          {[
            ['files', FileText, 'Files & Editor'],
            ['git', GitBranch, `Git & Diff${git?.files?.length ? ` (${git.files.length})` : ''}`],
            ['terminal', Terminal, 'Stateful Shell'],
            ['processes', Cpu, `Processes (${processes.filter(p => p.status === 'running').length})`],
            ['diagnostics', ShieldCheck, 'Diagnostics'],
            ['worktrees', Layers, 'Worktrees'],
          ].map(([id, Icon, label]) => (
            <button key={id} type="button" role="tab" aria-pressed={tab === id} onClick={() => setTab(id)}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {tab === 'files' && (
          !workspace ? <div className="panel-card"><p className="hint">Choose a folder above to browse and edit project files.</p></div> : (
            <div className="studio-split">
              <div className="studio-box">
                <div className="studio-box-head">
                  <button
                    type="button"
                    className="mono"
                    style={{ padding: '2px 6px', fontSize: 11.5 }}
                    onClick={() => loadFiles(filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') || '.' : '.')}
                  >
                    {filePath === '.' ? '/' : `← /${filePath}`}
                  </button>
                  <button type="button" className="btn-icon" style={{ width: 26, height: 26 }} onClick={() => loadFiles(filePath)}><RefreshCw size={13} /></button>
                </div>
                <div style={{ padding: '8px 8px 4px' }}>
                  <input placeholder="Filter folder…" value={filterText} onChange={e => setFilterText(e.target.value)} style={{ padding: '5px 8px', fontSize: 12 }} />
                </div>
                <div className="file-list">
                  {visibleEntries.map(item => {
                    const rel = filePath === '.' ? item.name : `${filePath}/${item.name}`;
                    return (
                      <button key={item.name} type="button" className={`file-row ${openFile?.path === rel ? 'selected' : ''}`} onClick={() => item.directory ? loadFiles(rel) : openCodeFile(rel)}>
                        {item.directory ? <Folder size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} /> : <FileText size={14} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />}
                        <span>{item.name}</span>
                      </button>
                    );
                  })}
                  {!visibleEntries.length && <p className="hint" style={{ padding: 10 }}>Empty folder.</p>}
                </div>
                <form
                  className="row"
                  style={{ padding: 8, borderTop: '1px solid var(--border-subtle)' }}
                  onSubmit={async e => {
                    e.preventDefault();
                    if (!newPath.trim()) return;
                    const fullRel = filePath === '.' ? newPath.trim() : `${filePath}/${newPath.trim()}`;
                    const isDir = fullRel.endsWith('/');
                    const res = await act('createFileOrDir', { workspace, path: fullRel.replace(/\/$/, ''), directory: isDir });
                    if (res) {
                      setNewPath('');
                      await loadFiles(filePath);
                      if (!isDir) await openCodeFile(fullRel);
                    }
                  }}
                >
                  <input placeholder="New file or dir/…" value={newPath} onChange={e => setNewPath(e.target.value)} style={{ padding: '5px 8px', fontSize: 11.5 }} />
                  <button className="btn-secondary" style={{ padding: '5px 8px' }} title="Create"><Plus size={13} /></button>
                </form>
              </div>

              <div className="studio-box">
                <div className="studio-box-head">
                  <strong className="mono" style={{ fontSize: 12 }}>{openFile ? `${openFile.path}${dirty ? ' •' : ''}` : 'Code Editor'}</strong>
                  {openFile && (
                    <div className="row" style={{ gap: 5 }}>
                      <button type="button" className="btn-secondary" style={{ padding: '4px 8px', fontSize: 11.5 }} onClick={() => setPreviewMode(p => !p)}>
                        {previewMode ? <><Code2 size={13} /> Edit</> : <><Eye size={13} /> Highlight</>}
                      </button>
                      <button type="button" className="btn-primary" style={{ padding: '4px 10px', fontSize: 11.5 }} disabled={busy || !dirty} onClick={saveOpenFile}>
                        <Save size={13} /> Save (Ctrl+S)
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        style={{ padding: '4px 8px', fontSize: 11.5 }}
                        title="Delete file"
                        onClick={async () => {
                          if (!window.confirm(`Delete ${openFile.path}?`)) return;
                          if (await act('deleteFileOrDir', { workspace, path: openFile.path })) {
                            setOpenFile(null);
                            await loadFiles(filePath);
                          }
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
                {!openFile ? (
                  <div style={{ padding: 28 }}><p className="hint">Select a file from the left to edit with Ctrl+S saving or syntax-highlighted inspection.</p></div>
                ) : previewMode && highlightedPreview ? (
                  <pre className="pre-box" style={{ flex: 1, maxHeight: 540, border: 0, borderRadius: 0 }}>
                    <code>
                      {highlightedPreview.isDiff
                        ? highlightedPreview.lines.map(l => <span key={l.line} className={l.cls}>{l.text + '\n'}</span>)
                        : highlightedPreview.tokens.map((t, i) => t.type === 'plain' ? t.value : <span key={i} className={`tok-${t.type}`}>{t.value}</span>)}
                    </code>
                  </pre>
                ) : (
                  <textarea className="code-editor-area" spellCheck={false} value={editorText} onChange={e => setEditorText(e.target.value)} />
                )}
              </div>
            </div>
          )
        )}

        {tab === 'git' && (
          !workspace ? <div className="panel-card"><p className="hint">Select a workspace folder to manage Git branches, diffs, and commits.</p></div> :
          !git?.isRepo ? <div className="panel-card"><p className="hint">Not a Git repository ({git?.error || 'no .git found'}).</p></div> : (
            <div>
              <div className="panel-card row-between" style={{ padding: '12px 16px', flexWrap: 'wrap' }}>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <span className="pill ok"><GitBranch size={13} /> {git.branch}</span>
                  {(git.ahead > 0 || git.behind > 0) && <span className="pill info">↑{git.ahead} ↓{git.behind}</span>}
                  <select
                    aria-label="Switch branch"
                    value={git.branch}
                    style={{ width: 200, padding: '5px 8px', fontSize: 12 }}
                    onChange={async e => {
                      const target = e.target.value;
                      if (!target || target === git.branch) return;
                      if (await act('gitAction', { workspace, operation: 'checkout', branch: target })) {
                        await refreshGit();
                        notify(`Switched to branch ${target}`, 'ok');
                      }
                    }}
                  >
                    {branches.filter(b => !b.name.startsWith('remotes/')).map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                  </select>
                  <form className="row" onSubmit={async e => {
                    e.preventDefault();
                    if (!newBranch.trim()) return;
                    if (await act('gitAction', { workspace, operation: 'checkout', branch: newBranch.trim(), create: true })) {
                      setNewBranch('');
                      await refreshGit();
                      notify(`Created branch ${newBranch.trim()}`, 'ok');
                    }
                  }}>
                    <input placeholder="New branch…" value={newBranch} onChange={e => setNewBranch(e.target.value)} style={{ width: 150, padding: '5px 8px', fontSize: 12 }} />
                    <button className="btn-secondary" style={{ padding: '5px 9px', fontSize: 12 }}><Plus size={13} /> Branch</button>
                  </form>
                </div>
                <div className="row">
                  <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '5px 9px' }} onClick={async () => { if (await act('gitAction', { workspace, operation: 'stash' })) { await refreshGit(); notify('Stashed working tree.', 'ok'); } }}>Stash</button>
                  <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '5px 9px' }} onClick={async () => { if (await act('gitAction', { workspace, operation: 'pull' })) { await refreshGit(); notify('Pulled latest.', 'ok'); } }}>Pull</button>
                  <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '5px 9px' }} onClick={async () => { if (await act('gitAction', { workspace, operation: 'push' })) { await refreshGit(); notify('Pushed branch.', 'ok'); } }}>Push</button>
                  <button type="button" className="btn-icon" onClick={refreshGit}><RefreshCw size={14} /></button>
                </div>
              </div>

              <div className="studio-split" style={{ gridTemplateColumns: '330px minmax(0, 1fr)' }}>
                <div className="studio-box" style={{ padding: 12, gap: 12 }}>
                  <div>
                    <strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Staged ({stagedFiles.length})</strong>
                    {stagedFiles.map(file => (
                      <div key={'s-' + file.path} className="row-between" style={{ padding: '3px 4px', borderRadius: 6, background: diffTarget === file.path && diffStaged ? 'var(--bg-active)' : undefined }}>
                        <button type="button" className="file-row" style={{ flex: 1 }} onClick={() => inspectFileDiff(file.path, true)}>
                          <span className="pill ok" style={{ padding: '1px 5px', fontSize: 10 }}>S</span>
                          <span>{file.path}</span>
                        </button>
                        <button type="button" className="btn-icon" style={{ width: 24, height: 24 }} title="Unstage" onClick={async () => { const s = await act('gitAction', { workspace, operation: 'unstage', paths: [file.path] }); if (s) setGit(s); }}><Minus size={12} /></button>
                      </div>
                    ))}
                    {!stagedFiles.length && <p className="hint" style={{ margin: '2px 0 0' }}>Nothing staged.</p>}
                  </div>

                  <div>
                    <strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Unstaged Changes ({unstagedFiles.length})</strong>
                    {unstagedFiles.map(file => (
                      <div key={'u-' + file.path} className="row-between" style={{ padding: '3px 4px', borderRadius: 6, background: diffTarget === file.path && !diffStaged ? 'var(--bg-active)' : undefined }}>
                        <button type="button" className="file-row" style={{ flex: 1 }} onClick={() => inspectFileDiff(file.path, false)}>
                          <span className={`pill ${file.untracked ? '' : 'warn'}`} style={{ padding: '1px 5px', fontSize: 10 }}>{file.untracked ? 'U' : 'M'}</span>
                          <span>{file.path}</span>
                        </button>
                        <div className="row" style={{ gap: 2 }}>
                          {!file.untracked && (
                            <button type="button" className="btn-icon" style={{ width: 24, height: 24 }} title="Discard changes" onClick={async () => { if (!window.confirm(`Discard changes in ${file.path}?`)) return; const s = await act('gitAction', { workspace, operation: 'discard', target: file.path }); if (s) { setGit(s); setDiff(''); } }}><RotateCcw size={12} /></button>
                          )}
                          <button type="button" className="btn-icon" style={{ width: 24, height: 24 }} title="Stage" onClick={async () => { const s = await act('gitAction', { workspace, operation: 'stage', paths: [file.path] }); if (s) setGit(s); }}><Plus size={12} /></button>
                        </div>
                      </div>
                    ))}
                    {!unstagedFiles.length && <p className="hint" style={{ margin: '2px 0 0' }}>Working tree clean.</p>}
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                    <input placeholder="Commit message…" value={commitMsg} onChange={e => setCommitMsg(e.target.value)} style={{ marginBottom: 8 }} />
                    <div className="row">
                      <button type="button" className="btn-primary" style={{ flex: 1 }} disabled={busy || !commitMsg.trim() || !stagedFiles.length} onClick={() => handleCommit(false)}><Check size={13} /> Commit Staged</button>
                      <button type="button" className="btn-secondary" disabled={busy || !commitMsg.trim() || !git.files.length} onClick={() => handleCommit(true)}>Stage All & Commit</button>
                    </div>
                  </div>

                  {git.commits?.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                      <small className="hint" style={{ display: 'block', marginBottom: 6 }}>Recent Commits</small>
                      {git.commits.slice(0, 6).map(c => (
                        <div key={c.hash} className="row" style={{ fontSize: 11.5, marginBottom: 4 }}>
                          <code className="mono" style={{ color: 'var(--accent)' }}>{c.hash}</code>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.subject}</span>
                          <small className="hint">{c.relativeDate}</small>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="studio-box">
                  <div className="studio-box-head">
                    <span className="mono">{diffTarget ? `${diffStaged ? 'staged · ' : ''}${diffTarget}` : 'Working Tree Diff'}</span>
                  </div>
                  <pre className="pre-box" style={{ flex: 1, maxHeight: 560, border: 0, borderRadius: 0 }}>
                    {(diff || '(Select a modified file to view its unified diff)').split('\n').map((line, i) => {
                      const cls = line.startsWith('+') && !line.startsWith('+++') ? 'diff-add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-del' : line.startsWith('@@') ? 'diff-hunk' : '';
                      return <span key={i} className={cls}>{line + '\n'}</span>;
                    })}
                  </pre>
                </div>
              </div>
            </div>
          )
        )}

        {tab === 'terminal' && (
          <div className="panel-card">
            <div className="row-between" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
              <div>
                <div className="row">
                  <h2 style={{ margin: 0 }}>Interactive Streaming Terminal</h2>
                  {termSession && <span className={`pill ${termSession.status === 'running' ? 'ok' : 'warn'}`}>{termSession.conpty ? 'Win32 ConPTY · ' : ''}{termSession.status} · PID {termSession.pid || '—'}</span>}
                </div>
                <small className="hint mono">Click inside the terminal screen to type interactively (Tab completion, arrows, Ctrl+C, TUI apps) or use the command bar below</small>
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {['git status', 'npm test', 'npm run build'].map(preset => (
                  <button key={preset} type="button" className="btn-secondary mono" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => void sendToShell(preset)}>{preset}</button>
                ))}
                {termSession?.status === 'running' && (
                  <button type="button" className="btn-danger" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => api('termInterrupt', { id: termSession.id })}>Ctrl+C</button>
                )}
                <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={async () => { if (termSession) await api('termClear', { id: termSession.id }); setTermBuffer(''); }}>Clear</button>
                <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={async () => { if (termSession) await api('termClose', { id: termSession.id }); await startInteractiveShell(); }}>Restart Shell</button>
              </div>
            </div>

            <div
              className="term-screen"
              role="log"
              aria-live="polite"
              tabIndex={0}
              title="Click and type directly into the live ConPTY terminal"
              onKeyDown={e => void handleTerminalKeyDown(e)}
            >
              <pre>
                {parseAnsiSegments(termBuffer || 'Starting persistent PowerShell session…\n').map((seg, i) => (
                  <span key={i} style={{ color: seg.color || undefined, fontWeight: seg.bold ? 700 : undefined, opacity: seg.dim ? 0.6 : undefined }}>{seg.text}</span>
                ))}
                <span ref={termEndRef} />
              </pre>
            </div>

            <form className="row" onSubmit={e => { e.preventDefault(); void sendToShell(); }} style={{ marginTop: 10 }}>
              <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>PS&gt;</span>
              <input
                className="mono"
                placeholder="Type any command or interactive stdin (↑/↓ for history)…"
                value={termCmd}
                onChange={e => setTermCmd(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'ArrowUp' && cmdHistory.length) {
                    e.preventDefault();
                    const next = Math.min(cmdHistory.length - 1, histIdx + 1);
                    setHistIdx(next);
                    setTermCmd(cmdHistory[next]);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = histIdx - 1;
                    setHistIdx(next);
                    setTermCmd(next < 0 ? '' : cmdHistory[next]);
                  }
                }}
              />
              <button className="btn-primary"><Play size={14} /> Send</button>
            </form>
          </div>
        )}

        {tab === 'processes' && (
          <div className="panel-card">
            <div className="row-between" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Background Processes (Live Polling)</h2>
              <button type="button" className="btn-secondary" onClick={refreshProcesses}><RefreshCw size={13} /> Refresh</button>
            </div>
            <form className="row" style={{ marginBottom: 14 }} onSubmit={async e => {
              e.preventDefault();
              if (!bgCmd.trim()) return;
              const proc = await act('processStart', { workspace, command: bgCmd.trim(), label: bgLabel.trim() || bgCmd.trim().slice(0, 40) });
              if (proc) { setBgCmd(''); setBgLabel(''); setSelectedProc(proc); await refreshProcesses(); }
            }}>
              <input placeholder="Command (e.g. npm run dev)" value={bgCmd} onChange={e => setBgCmd(e.target.value)} style={{ flex: 2 }} />
              <input placeholder="Label (optional)" value={bgLabel} onChange={e => setBgLabel(e.target.value)} style={{ flex: 1 }} />
              <button className="btn-primary" disabled={!bgCmd.trim()}><Play size={13} /> Start</button>
            </form>
            <div className="studio-split">
              <div className="studio-box" style={{ padding: 8 }}>
                {processes.map(proc => (
                  <div key={proc.id} className="row-between" style={{ padding: 6, borderRadius: 8, background: selectedProc?.id === proc.id ? 'var(--bg-active)' : undefined }}>
                    <button type="button" className="file-row" style={{ flex: 1 }} onClick={async () => setSelectedProc(await api('processOutput', { id: proc.id }))}>
                      <i className={`status-dot ${proc.status === 'running' ? 'running' : proc.status === 'completed' ? 'complete' : 'failed'}`} />
                      <div><strong style={{ display: 'block', fontSize: 12.5 }}>{proc.label}</strong><small className="hint">PID {proc.pid || '—'} · {proc.status}</small></div>
                    </button>
                    {proc.status === 'running' && <button type="button" className="btn-danger" style={{ padding: 5 }} onClick={async () => { await act('processStop', { id: proc.id }); await refreshProcesses(); }}><Square size={12} /></button>}
                  </div>
                ))}
                {!processes.length && <p className="hint" style={{ padding: 10 }}>No background processes running.</p>}
              </div>
              <div className="studio-box">
                <div className="studio-box-head"><span className="mono">{selectedProc ? `${selectedProc.label} (${selectedProc.status})` : 'Live Output'}</span></div>
                <pre className="pre-box" style={{ flex: 1, maxHeight: 460, border: 0, borderRadius: 0 }}>{selectedProc?.output || selectedProc?.outputPreview || '(Select a process to stream stdout/stderr)'}</pre>
              </div>
            </div>
          </div>
        )}

        {tab === 'diagnostics' && (
          <div className="panel-card">
            <div className="row-between" style={{ marginBottom: 14 }}>
              <strong>{diag ? `${diag.checkedFiles} files checked · ${diag.passed ? 'All passed' : `${diag.diagnostics.length} errors`}` : 'Workspace Syntax & JSON Diagnostics'}</strong>
              <button type="button" className="btn-primary" disabled={busy || !workspace} onClick={refreshDiagnostics}><RefreshCw size={13} /> Run Diagnostics</button>
            </div>
            {(diag?.diagnostics || []).map((item, idx) => (
              <div key={idx} className="tool-card error" style={{ marginBottom: 8 }}>
                <div className="tool-card-head" onClick={() => { setTab('files'); void openCodeFile(item.file); }}>
                  <span className="tool-name">{item.file}{item.line ? `:${item.line}` : ''}</span>
                  <span className="pill err">{item.tool}</span>
                </div>
                <div className="tool-card-body"><pre>{item.message}</pre></div>
              </div>
            ))}
            {diag?.passed && <p className="pill ok">Zero syntax or JSON errors across {diag.checkedFiles} files.</p>}
          </div>
        )}

        {tab === 'worktrees' && (
          <div className="panel-card">
            <h2>Git Worktrees (Parallel Isolated Branches)</h2>
            <p className="hint">Run multiple independent agents on the same repository simultaneously by giving each agent its own isolated worktree.</p>
            <form className="row" style={{ marginBottom: 16 }} onSubmit={async e => {
              e.preventDefault();
              if (!wtBranch.trim() || !wtPath.trim()) return;
              if (await act('gitAction', { workspace, operation: 'worktree_add', branch: wtBranch.trim(), path: wtPath.trim() })) {
                setWtBranch(''); setWtPath('');
                await refreshWorktrees();
                notify('Worktree created.', 'ok');
              }
            }}>
              <input placeholder="New branch (e.g. feat/parallel)" value={wtBranch} onChange={e => setWtBranch(e.target.value)} style={{ flex: 1 }} />
              <input placeholder="Target directory path…" value={wtPath} onChange={e => setWtPath(e.target.value)} style={{ flex: 2 }} />
              <button className="btn-primary" disabled={!workspace || !wtBranch.trim() || !wtPath.trim()}><Plus size={14} /> Add Worktree</button>
            </form>
            {worktrees.map(wt => (
              <div key={wt.path} className="list-row">
                <div>
                  <strong>{wt.branch}</strong> <code className="mono" style={{ color: 'var(--accent)', marginLeft: 8 }}>{wt.head}</code>
                  <div className="hint mono">{wt.path}</div>
                </div>
                <div className="row">
                  {onOpenInChat && <button type="button" className="btn-secondary" onClick={() => onOpenInChat(wt.path)}>New Chat Here</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
