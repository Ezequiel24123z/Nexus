import React, { useState, useEffect } from 'react';
import { GitBranch, Terminal, Play, Square, RefreshCw, Check, Plus, Minus, Cpu } from 'lucide-react';

const api = (method, args) => window.nexus.invoke(method, args);

export default function CodeGitStudio({ workspace, onNotice, onError }) {
  const [subTab, setSubTab] = useState('git');
  const [git, setGit] = useState(null);
  const [diff, setDiff] = useState('');
  const [diffTarget, setDiffTarget] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [termCmd, setTermCmd] = useState('');
  const [termHistory, setTermHistory] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [bgCmd, setBgCmd] = useState('');
  const [bgLabel, setBgLabel] = useState('');
  const [selectedProc, setSelectedProc] = useState(null);

  const refreshGit = async () => {
    if (!workspace) return;
    try {
      const status = await api('gitStatus', { workspace });
      setGit(status);
      const d = await api('gitDiff', { workspace, target: diffTarget || undefined, staged: false });
      setDiff(d?.diff || '');
    } catch (e) {
      onError?.(e.message);
    }
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

  useEffect(() => {
    if (workspace && subTab === 'git') void refreshGit();
    if (subTab === 'processes') void refreshProcesses();
  }, [workspace, subTab]);

  const inspectFileDiff = async (path, staged = false) => {
    setDiffTarget(path);
    try {
      const d = await api('gitDiff', { workspace, target: path, staged });
      setDiff(d?.diff || '(No diff changes)');
    } catch (e) {
      onError?.(e.message);
    }
  };

  const gitStageToggle = async (file) => {
    setBusy(true);
    try {
      const status = await api('gitAction', {
        workspace,
        operation: file.staged ? 'unstage' : 'stage',
        paths: [file.path],
      });
      setGit(status);
      await inspectFileDiff(file.path, !file.staged);
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async (e) => {
    e.preventDefault();
    if (!commitMsg.trim() || !workspace) return;
    setBusy(true);
    try {
      const res = await api('gitAction', { workspace, operation: 'commit', message: commitMsg.trim(), stageAll: true });
      setCommitMsg('');
      setGit(res.status);
      setDiff('');
      onNotice?.('Changes committed to ' + (res.status?.branch || 'repository') + '.');
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  };

  const runTerminal = async (e) => {
    e.preventDefault();
    if (!termCmd.trim() || !workspace) return;
    const cmd = termCmd.trim();
    setBusy(true);
    try {
      const res = await api('terminalExec', { workspace, command: cmd });
      setTermHistory(prev => [{ cmd, exitCode: res.exitCode, output: res.output, at: new Date().toLocaleTimeString() }, ...prev.slice(0, 19)]);
      setTermCmd('');
    } catch (e) {
      setTermHistory(prev => [{ cmd, exitCode: 1, output: e.message, at: new Date().toLocaleTimeString() }, ...prev.slice(0, 19)]);
    } finally {
      setBusy(false);
    }
  };

  const startBgProcess = async (e) => {
    e.preventDefault();
    if (!bgCmd.trim()) return;
    setBusy(true);
    try {
      const proc = await api('processStart', { workspace, command: bgCmd.trim(), label: bgLabel.trim() || bgCmd.trim().slice(0, 40) });
      setBgCmd('');
      setBgLabel('');
      setSelectedProc(proc);
      await refreshProcesses();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="studio-panel card wide">
      <div className="studio-header">
        <div className="filter-pills" role="group" aria-label="Developer studio tools">
          <button type="button" aria-pressed={subTab === 'git'} onClick={() => setSubTab('git')}><GitBranch size={14} /> Git & Diff</button>
          <button type="button" aria-pressed={subTab === 'terminal'} onClick={() => setSubTab('terminal')}><Terminal size={14} /> Quick Terminal</button>
          <button type="button" aria-pressed={subTab === 'processes'} onClick={() => setSubTab('processes')}><Cpu size={14} /> Background Processes ({processes.filter(p => p.status === 'running').length})</button>
        </div>
        {git?.isRepo && (
          <span className="git-branch-pill">
            <GitBranch size={13} /> <strong>{git.branch}</strong>
            {git.clean ? ' · Clean' : ` · ${git.files?.length || 0} changed`}
          </span>
        )}
      </div>

      {subTab === 'git' && (
        !workspace ? <p className="hint">Select a workspace folder above to inspect Git status, stage changes, and view diffs.</p> :
        !git?.isRepo ? <p className="hint">This workspace is not an active Git repository ({git?.error || 'no .git directory'}).</p> : (
          <div className="studio-git-grid">
            <div className="studio-git-sidebar">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <strong>Working Tree ({git.files.length})</strong>
                <button type="button" className="secondary" disabled={busy} onClick={refreshGit}><RefreshCw size={13} /> Refresh</button>
              </div>
              <div className="git-file-list">
                {git.files.map(file => (
                  <div className={'git-file-row ' + (diffTarget === file.path ? 'selected' : '')} key={file.path}>
                    <button type="button" className="git-file-btn" onClick={() => inspectFileDiff(file.path, file.staged)}>
                      <span className={'git-badge ' + (file.staged ? 'staged' : file.untracked ? 'untracked' : 'modified')}>
                        {file.staged ? 'S' : file.untracked ? 'U' : 'M'}
                      </span>
                      <span>{file.path}</span>
                    </button>
                    <button type="button" title={file.staged ? 'Unstage file' : 'Stage file'} onClick={() => gitStageToggle(file)}>
                      {file.staged ? <Minus size={13} /> : <Plus size={13} />}
                    </button>
                  </div>
                ))}
                {!git.files.length && <p className="hint">Working tree is clean.</p>}
              </div>
              <form className="git-commit-box" onSubmit={handleCommit}>
                <input placeholder="Commit message (stages all & commits)…" value={commitMsg} onChange={e => setCommitMsg(e.target.value)} />
                <button className="primary" disabled={busy || !commitMsg.trim() || !git.files.length}><Check size={14} /> Commit</button>
              </form>
              {git.commits?.length > 0 && (
                <div className="git-commits-mini">
                  <small>Recent Commits</small>
                  {git.commits.slice(0, 5).map(c => (
                    <div key={c.hash} className="git-commit-item">
                      <code>{c.hash}</code> <span>{c.subject}</span> <small>{c.relativeDate}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="studio-diff-viewer">
              <div className="code-actions">
                <span className="code-language">{diffTarget ? `diff · ${diffTarget}` : 'Working Tree Diff'}</span>
              </div>
              <pre className="diff-pre">
                {(diff || '(Select a modified file or make edits to inspect the unified diff)').split('\n').map((line, i) => {
                  const cls = line.startsWith('+') && !line.startsWith('+++') ? 'diff-add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-del' : line.startsWith('@@') ? 'diff-hunk' : '';
                  return <div key={i} className={cls}>{line}</div>;
                })}
              </pre>
            </div>
          </div>
        )
      )}

      {subTab === 'terminal' && (
        !workspace ? <p className="hint">Select a workspace folder above to run PowerShell commands in that directory.</p> : (
          <div className="studio-terminal">
            <form className="row" onSubmit={runTerminal}>
              <input placeholder={`Run PowerShell command in ${workspace}…`} value={termCmd} onChange={e => setTermCmd(e.target.value)} disabled={busy} />
              <button className="primary" disabled={busy || !termCmd.trim()}><Play size={14} /> Run</button>
            </form>
            <div className="terminal-history">
              {termHistory.map((item, idx) => (
                <div className="terminal-entry" key={idx}>
                  <div className="terminal-entry-head">
                    <code>PS&gt; {item.cmd}</code>
                    <span className={'status ' + (item.exitCode === 0 ? 'complete' : 'failed')}>Exit {item.exitCode} · {item.at}</span>
                  </div>
                  <pre>{item.output || '(No output)'}</pre>
                </div>
              ))}
              {!termHistory.length && <p className="hint">Commands run directly with your local Windows permissions. Output appears here.</p>}
            </div>
          </div>
        )
      )}

      {subTab === 'processes' && (
        <div className="studio-processes">
          <form className="row" onSubmit={startBgProcess}>
            <input placeholder="Background command (e.g. npm run dev)…" value={bgCmd} onChange={e => setBgCmd(e.target.value)} style={{ flex: 2 }} />
            <input placeholder="Label (optional)" value={bgLabel} onChange={e => setBgLabel(e.target.value)} style={{ flex: 1 }} />
            <button className="primary" disabled={busy || !bgCmd.trim()}><Play size={14} /> Start Background Process</button>
            <button type="button" className="secondary" onClick={refreshProcesses}><RefreshCw size={14} /></button>
          </form>
          <div className="studio-git-grid" style={{ marginTop: 14 }}>
            <div className="git-file-list">
              {processes.map(proc => (
                <div className={'git-file-row ' + (selectedProc?.id === proc.id ? 'selected' : '')} key={proc.id}>
                  <button type="button" className="git-file-btn" onClick={async () => setSelectedProc(await api('processOutput', { id: proc.id }))}>
                    <i className={'dot ' + (proc.status === 'running' ? 'running' : proc.status === 'completed' ? 'complete' : 'failed')} />
                    <div>
                      <strong>{proc.label}</strong>
                      <small style={{ display: 'block' }}>{proc.id} · PID {proc.pid || '—'} · {proc.status}</small>
                    </div>
                  </button>
                  {proc.status === 'running' && (
                    <button type="button" title="Stop process" onClick={async () => { await api('processStop', { id: proc.id }); await refreshProcesses(); }}>
                      <Square size={13} />
                    </button>
                  )}
                </div>
              ))}
              {!processes.length && <p className="hint">No background processes started in this session.</p>}
            </div>
            <div className="studio-diff-viewer">
              <div className="code-actions">
                <span className="code-language">{selectedProc ? `${selectedProc.label} (${selectedProc.status})` : 'Process Output'}</span>
              </div>
              <pre className="diff-pre">{selectedProc?.output || selectedProc?.outputPreview || '(Select a process to view its stdout/stderr stream)'}</pre>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
