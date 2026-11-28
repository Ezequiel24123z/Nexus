import React, { useState } from 'react';
import {
  XCircle, Loader2, Slash, ChevronRight, ChevronDown,
  RotateCcw, Terminal, FileText, FilePenLine, FilePlus2, FileMinus2,
  Search, Folder, GitBranch, Globe, Cpu, Layers, Clock, Shield,
  SlidersHorizontal, Bookmark, ListChecks, Pencil, Image, Monitor, Wrench
} from 'lucide-react';
import { formatDuration, prettyJson } from '../lib/format.mjs';

function shortFileName(p = '') {
  const clean = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : clean;
}

function shortPath(p = '') {
  const clean = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  return parts.length <= 2 ? clean : parts.slice(-2).join('/');
}

function pickToolIcon(name = '', tool = null) {
  if (name === 'run_command' || name === 'shell_session' || name === 'manage_process') return Terminal;
  if (name === 'write_file') return tool?.hasBackup ? FilePenLine : FilePlus2;
  if (name === 'replace_text' || name === 'multi_edit' || name === 'apply_patch' || name === 'move_file') return FilePenLine;
  if (name === 'delete_file') return FileMinus2;
  if (name === 'read_file' || name === 'batch_read_files' || name === 'code_outline' || name === 'read_artifact' || name === 'read_checkpoint' || name === 'read_attachment') return FileText;
  if (name === 'list_files' || name === 'dir_tree' || name === 'glob_files') return Folder;
  if (name === 'grep_search' || name === 'search_files' || name === 'search_journal' || name === 'search_history') return Search;
  if (name === 'git_operation') return GitBranch;
  if (name === 'web_search' || name === 'web_fetch' || name === 'browser_inspect' || name === 'http_request' || name === 'invoke_connector') return Globe;
  if (name === 'manage_privacy') return Shield;
  if (name === 'nexus_control') return SlidersHorizontal;
  if (name === 'manage_session') return Pencil;
  if (name === 'memory_store') return Bookmark;
  if (name === 'todo_write' || name === 'todo_read') return ListChecks;
  if (name === 'present_media') return Image;
  if (name.startsWith('desktop_')) return Monitor;
  if (name === 'delegate_subagent' || name === 'spawn_session' || name === 'send_session_message' || name === 'read_session' || name === 'list_sessions') return Cpu;
  if (name === 'manage_automation') return Clock;
  if (name === 'create_dynamic_tool' || name === 'scaffold_mcp_server' || name === 'load_toolset') return Wrench;
  return Layers;
}

export function describeToolAction(name = '', args = {}, running = false, tool = null) {
  const a = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'read_file': {
      const range = a.startLine ? `lines ${a.startLine}–${a.endLine || 'EOF'}` : '';
      return { label: `View ${shortFileName(a.path) || 'file'}`, detail: range, monoDetail: false };
    }
    case 'batch_read_files': {
      const count = Array.isArray(a.files) ? a.files.length : 0;
      const names = Array.isArray(a.files) ? a.files.map(f => shortFileName(f.path)).slice(0, 3).join(', ') : '';
      return { label: `View ${count || ''} files`.trim(), detail: names, monoDetail: false };
    }
    case 'write_file': {
      const verb = tool?.hasBackup ? 'Edit' : 'Create';
      return { label: `${verb} ${shortFileName(a.path) || 'file'}`, detail: '', monoDetail: false };
    }
    case 'replace_text':
    case 'multi_edit':
    case 'apply_patch':
      return { label: `Edit ${shortFileName(a.path) || 'file'}`, detail: '', monoDetail: false };
    case 'delete_file':
      return { label: `Delete ${shortFileName(a.path) || 'file'}`, detail: '', monoDetail: false };
    case 'move_file':
      return { label: `Move ${shortFileName(a.from) || 'file'}`, detail: a.to ? `→ ${shortPath(a.to)}` : '', monoDetail: true };
    case 'list_files':
    case 'dir_tree':
      return { label: `List ${a.path ? shortPath(a.path) : 'workspace'}`, detail: '', monoDetail: false };
    case 'glob_files':
      return { label: 'Find files', detail: String(a.pattern || ''), monoDetail: true };
    case 'grep_search':
    case 'search_files':
      return { label: a.query ? `Search "${String(a.query).slice(0, 44)}"` : 'Search files', detail: a.glob || (a.path ? shortPath(a.path) : ''), monoDetail: true };
    case 'code_outline':
      return { label: `Outline ${shortFileName(a.path || '.')}`, detail: '', monoDetail: false };
    case 'run_diagnostics':
      return { label: 'Check diagnostics', detail: a.path ? shortPath(a.path) : '', monoDetail: true };
    case 'run_command':
    case 'shell_session': {
      const cmdOneLine = String(a.command || '').replace(/\s+/g, ' ').trim();
      const reason = String(a.reason || '').trim();
      return {
        label: reason || (cmdOneLine.slice(0, 56) || 'Run shell command'),
        detail: reason ? cmdOneLine.slice(0, 96) : '',
        monoDetail: true,
      };
    }
    case 'manage_process':
      return { label: `Process ${a.action || ''}`.trim(), detail: String(a.label || a.command || a.id || '').slice(0, 64), monoDetail: true };
    case 'git_operation':
      return { label: `Git ${a.operation || ''}`.trim(), detail: String(a.branch || a.target || a.message || '').slice(0, 64), monoDetail: true };
    case 'web_search':
      return { label: 'Search web', detail: a.query ? `"${String(a.query).slice(0, 64)}"` : '', monoDetail: false };
    case 'web_fetch':
    case 'browser_inspect': {
      let host = String(a.url || '');
      try { const u = new URL(host); host = u.hostname + (u.pathname && u.pathname !== '/' ? u.pathname.slice(0, 28) : ''); } catch {}
      return { label: name === 'browser_inspect' ? 'Inspect page' : 'Fetch page', detail: host, monoDetail: true };
    }
    case 'http_request': {
      let host = String(a.url || '');
      try { host = new URL(host).hostname; } catch {}
      return { label: `HTTP ${(a.method || 'GET').toUpperCase()}`, detail: host, monoDetail: true };
    }
    case 'manage_session': {
      const act = String(a.action || 'info');
      if (act === 'rename') return { label: 'Rename session', detail: a.title ? `"${a.title}"` : '', monoDetail: false };
      if (act === 'set_ephemeral') return { label: a.ephemeral ? 'Switch to RAM-Only' : 'Switch to Persistent', detail: '', monoDetail: false };
      return { label: `Session ${act.replaceAll('_', ' ')}`, detail: String(a.projectName || a.workspace || '').slice(0, 50), monoDetail: false };
    }
    case 'manage_project':
      return { label: `Project ${a.action || 'list'}`, detail: String(a.name || a.newName || '').slice(0, 50), monoDetail: false };
    case 'manage_privacy': {
      const act = String(a.action || 'status').replaceAll('_', ' ');
      return { label: `Privacy ${act}`, detail: String(a.preset || a.mode || a.provider || (a.enabled !== undefined ? (a.enabled ? 'on' : 'off') : '')), monoDetail: true };
    }
    case 'nexus_control': {
      const act = String(a.action || 'inspect');
      const lbl = act === 'guide' ? 'Read NEXUS guide' : act === 'inspect' ? 'Inspect NEXUS' : act === 'update_settings' ? 'Update NEXUS settings' : act === 'update_session' ? 'Update session state' : act === 'manage_provider' ? `Provider ${a.providerAction || ''}`.trim() : `Tools ${a.toolAction || ''}`.trim();
      const det = String(a.topic || a.section || a.providerId || a.provider || (a.settings ? Object.keys(a.settings).slice(0, 3).join(', ') : '') || '').slice(0, 60);
      return { label: lbl, detail: det, monoDetail: true };
    }
    case 'present_media':
      return { label: 'Show inline media', detail: shortFileName(a.path || a.items?.[0]?.path || a.title || ''), monoDetail: false };
    case 'load_toolset':
      return { label: 'Load toolset', detail: Array.isArray(a.toolsets) ? a.toolsets.join(', ') : '', monoDetail: true };
    case 'desktop_windows':
      return { label: 'List desktop windows', detail: '', monoDetail: false };
    case 'desktop_ui_tree':
      return { label: 'Inspect UI tree', detail: String(a.windowTitle || a.query || '').slice(0, 48), monoDetail: false };
    case 'desktop_screenshot':
      return { label: 'Capture screen', detail: String(a.windowTitle || (a.monitor != null ? `monitor ${a.monitor}` : '')), monoDetail: false };
    case 'desktop_action':
      return { label: `Desktop ${a.action || ''}`.trim(), detail: a.text ? `"${String(a.text).slice(0, 32)}"` : (a.x != null ? `${a.x}, ${a.y}` : ''), monoDetail: true };
    case 'spawn_session':
      return { label: 'Spawn child session', detail: String(a.title || a.prompt || '').slice(0, 56), monoDetail: false };
    case 'read_session':
      return { label: a.wait ? 'Wait on session' : 'Read session', detail: String(a.sessionId || '').slice(0, 8), monoDetail: true };
    case 'send_session_message':
      return { label: 'Message session', detail: String(a.message || '').slice(0, 56), monoDetail: false };
    case 'list_sessions':
      return { label: 'List sessions', detail: '', monoDetail: false };
    case 'delegate_subagent':
      return { label: 'Delegate sub-agent', detail: String(a.objective || '').slice(0, 56), monoDetail: false };
    case 'todo_write':
      return { label: 'Update plan', detail: Array.isArray(a.todos) ? `${a.todos.filter(t => t.status === 'completed').length}/${a.todos.length} done` : '', monoDetail: false };
    case 'todo_read':
      return { label: 'Check plan', detail: '', monoDetail: false };
    case 'document_progress':
      return { label: 'Document progress', detail: '', monoDetail: false };
    case 'memory_store':
      return { label: `Memory ${a.action || ''}`.trim(), detail: String(a.key || a.query || '').slice(0, 50), monoDetail: false };
    case 'scaffold_mcp_server':
      return { label: 'Create MCP server', detail: String(a.name || ''), monoDetail: true };
    case 'create_dynamic_tool':
      return { label: 'Create dynamic tool', detail: String(a.name || ''), monoDetail: true };
    case 'invoke_mcp':
      return { label: 'Call MCP tool', detail: `${a.server || ''}:${a.tool || ''}`, monoDetail: true };
    case 'invoke_connector':
      return { label: 'Call connector', detail: String(a.name || ''), monoDetail: true };
    case 'system_info':
      return { label: 'Inspect system', detail: '', monoDetail: false };
    default:
      return { label: name.replaceAll('_', ' '), detail: summarizeArgs(name, a), monoDetail: true };
  }
}

export function formatThoughtDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 500) return '';
  const totalSec = Math.max(1, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function summarizeArgs(name, args = {}) {
  if (!args || typeof args !== 'object') return '';
  if (args.path) return args.startLine ? `${args.path}:${args.startLine}-${args.endLine || ''}` : String(args.path);
  if (args.from && args.to) return `${args.from} → ${args.to}`;
  if (args.files && Array.isArray(args.files)) return args.files.map(f => f.path).slice(0, 3).join(', ');
  if (args.command) return String(args.command).slice(0, 90);
  if (args.query) return `"${args.query}"${args.glob ? ` (${args.glob})` : ''}`;
  if (args.pattern) return String(args.pattern);
  if (args.operation) return `${args.operation}${args.target ? ' ' + args.target : ''}`;
  if (args.url) return String(args.url);
  if (args.objective) return String(args.objective).slice(0, 90);
  if (args.server && args.tool) return `${args.server} → ${args.tool}`;
  const keys = Object.keys(args);
  return keys.length ? keys.slice(0, 3).map(k => `${k}=${JSON.stringify(args[k])}`).join(', ').slice(0, 90) : '';
}

function InlineDiffView({ diff }) {
  if (!diff) return null;
  return (
    <pre className="cp-code-box">
      {String(diff).split('\n').map((line, i) => {
        const cls = line.startsWith('+') && !line.startsWith('+++')
          ? 'diff-add'
          : line.startsWith('-') && !line.startsWith('---')
            ? 'diff-del'
            : line.startsWith('@@')
              ? 'diff-hunk'
              : '';
        return <span key={i} className={cls}>{line + '\n'}</span>;
      })}
    </pre>
  );
}

export const ToolActivityRow = React.memo(function ToolActivityRow({ tool, taskId, onRevert, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [reverting, setReverting] = useState(false);

  const Icon = pickToolIcon(tool.name, tool);
  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error' || (typeof tool.exitCode === 'number' && tool.exitCode !== 0 && !isRunning);
  const isDenied = tool.status === 'denied';
  const isShell = tool.name === 'run_command' || tool.name === 'shell_session';
  const desc = describeToolAction(tool.name, tool.args, isRunning, tool);
  const hasDiffStats = (tool.addedLines || 0) > 0 || (tool.removedLines || 0) > 0;

  const handleRevert = async e => {
    e.stopPropagation();
    if (!tool.fileChangeEventId || !onRevert) return;
    setReverting(true);
    try { await onRevert(taskId, tool.fileChangeEventId); }
    finally { setReverting(false); }
  };

  return (
    <div className={`cp-row ${isRunning ? 'is-running' : ''} ${isError ? 'is-error' : ''} ${isDenied ? 'is-denied' : ''} ${open ? 'is-open' : ''}`}>
      <button type="button" className="cp-row-btn" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="cp-row-icon">
          {isRunning ? <Loader2 size={13} className="spin" style={{ color: 'var(--accent)' }} />
            : isError ? <XCircle size={13} style={{ color: 'var(--err-fg)' }} />
            : isDenied ? <Slash size={13} style={{ color: 'var(--warn-fg)' }} />
            : <Icon size={13} />}
        </span>
        <span className={`cp-row-label ${isRunning ? 'shimmer-text' : ''}`}>{desc.label}</span>
        {desc.detail && (
          <span className={`cp-row-detail ${desc.monoDetail ? 'mono' : ''}`}>{desc.detail}</span>
        )}
        {hasDiffStats && (
          <span className="cp-diff-stat tabular">
            {tool.addedLines > 0 && <em className="add">+{tool.addedLines}</em>}
            {tool.removedLines > 0 && <em className="del">-{tool.removedLines}</em>}
          </span>
        )}
        {isShell && typeof tool.exitCode === 'number' && tool.exitCode !== 0 && !isRunning && (
          <span className="cp-exit-pill err tabular">exit {tool.exitCode}</span>
        )}
        {tool.hasBackup && tool.fileChangeEventId && onRevert && (
          <span
            role="button"
            tabIndex={0}
            className="cp-revert-btn"
            title="Revert this file to its automatic pre-edit backup"
            onClick={handleRevert}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') void handleRevert(e); }}
          >
            <RotateCcw size={10} /> {reverting ? 'Reverting…' : 'Revert'}
          </span>
        )}
        <span className="cp-row-right">
          {tool.durationMs != null && tool.durationMs >= 100 && <span className="cp-dur tabular">{formatDuration(tool.durationMs)}</span>}
          {open ? <ChevronDown size={12} className="cp-chev" /> : <ChevronRight size={12} className="cp-chev" />}
        </span>
      </button>

      {open && (
        <div className="cp-drawer">
          {isShell && tool.args?.command && (
            <div className="cp-drawer-section">
              <div className="cp-cmd-line mono">
                <span className="cp-cmd-prompt">$</span>
                <span>{tool.args.command}</span>
                {typeof tool.exitCode === 'number' && (
                  <span className={`cp-exit-pill ${tool.exitCode === 0 ? 'ok' : 'err'} tabular`}>exit {tool.exitCode}</span>
                )}
              </div>
              {tool.preview && <pre className="cp-code-box">{tool.preview}</pre>}
              {!tool.preview && !tool.error && <span className="hint" style={{ fontSize: 11.5 }}>(No output)</span>}
            </div>
          )}

          {tool.diff && (
            <div className="cp-drawer-section">
              {tool.args?.path && <div className="cp-path-line mono">{tool.args.path}</div>}
              <InlineDiffView diff={tool.diff} />
            </div>
          )}

          {tool.error && (
            <div className="cp-drawer-section">
              <pre className="cp-code-box err">{tool.error}</pre>
            </div>
          )}

          {!isShell && !tool.diff && tool.args && Object.keys(tool.args).length > 0 && (
            <div className="cp-drawer-section">
              <small className="cp-drawer-label">Parameters</small>
              <pre className="cp-code-box">{prettyJson(tool.args)}</pre>
            </div>
          )}

          {!isShell && !tool.diff && tool.preview && (
            <div className="cp-drawer-section">
              <small className="cp-drawer-label">Result</small>
              <pre className="cp-code-box">{tool.preview}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

const ToolTimeline = React.memo(function ToolTimeline({ tools = [], taskId, onRevert, defaultExpandDiff = false }) {
  if (!tools?.length) return null;
  return (
    <div className="cp-stream" aria-label="Tool execution steps">
      {tools.map(tool => (
        <ToolActivityRow
          key={tool.id}
          tool={tool}
          taskId={taskId}
          onRevert={onRevert}
          defaultOpen={defaultExpandDiff && Boolean(tool.diff)}
        />
      ))}
    </div>
  );
});

export default ToolTimeline;
