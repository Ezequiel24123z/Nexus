import React, { useState } from 'react';
import {
  CheckCircle2, XCircle, Loader2, Slash, ChevronRight, ChevronDown,
  RotateCcw, Terminal, FileEdit, Search, GitBranch, Globe, Cpu, Layers, Clock
} from 'lucide-react';
import { formatDuration, prettyJson } from '../lib/format.mjs';

function pickToolIcon(name = '') {
  if (name.includes('command') || name.includes('shell') || name.includes('process')) return Terminal;
  if (name.includes('write') || name.includes('edit') || name.includes('patch') || name.includes('delete') || name.includes('move')) return FileEdit;
  if (name.includes('grep') || name.includes('glob') || name.includes('search') || name.includes('read') || name.includes('outline') || name.includes('tree')) return Search;
  if (name.includes('git')) return GitBranch;
  if (name.includes('web') || name.includes('http') || name.includes('browser') || name.includes('connector')) return Globe;
  if (name.includes('subagent')) return Cpu;
  if (name.includes('automation')) return Clock;
  return Layers;
}

function shortPath(p = '') {
  const clean = String(p || '').replace(/\\/g, '/');
  const parts = clean.split('/').filter(Boolean);
  return parts.length <= 2 ? clean : parts.slice(-2).join('/');
}

export function describeToolAction(name = '', args = {}, running = false) {
  const a = args && typeof args === 'object' ? args : {};
  const verb = (past, ing) => (running ? ing : past);
  switch (name) {
    case 'read_file': return { label: verb('Read', 'Reading'), detail: a.path ? `${shortPath(a.path)}${a.startLine ? `:${a.startLine}-${a.endLine || ''}` : ''}` : '' };
    case 'batch_read_files': return { label: verb(`Read ${a.files?.length || ''} files`.trim(), 'Reading files'), detail: Array.isArray(a.files) ? a.files.map(f => shortPath(f.path)).slice(0, 3).join(', ') : '' };
    case 'write_file': return { label: verb('Wrote', 'Writing'), detail: shortPath(a.path) };
    case 'replace_text':
    case 'multi_edit':
    case 'apply_patch': return { label: verb('Edited', 'Editing'), detail: shortPath(a.path) };
    case 'delete_file': return { label: verb('Deleted', 'Deleting'), detail: shortPath(a.path) };
    case 'move_file': return { label: verb('Moved', 'Moving'), detail: a.from && a.to ? `${shortPath(a.from)} → ${shortPath(a.to)}` : '' };
    case 'list_files':
    case 'dir_tree': return { label: verb('Explored', 'Exploring'), detail: a.path ? shortPath(a.path) : '.' };
    case 'glob_files': return { label: verb('Found files', 'Finding files'), detail: String(a.pattern || '') };
    case 'grep_search':
    case 'search_files': return { label: verb('Searched', 'Searching'), detail: a.query ? `"${String(a.query).slice(0, 50)}"${a.glob ? ` in ${a.glob}` : ''}` : '' };
    case 'code_outline': return { label: verb('Outlined', 'Outlining'), detail: shortPath(a.path || '.') };
    case 'run_diagnostics': return { label: verb('Checked diagnostics', 'Checking diagnostics'), detail: shortPath(a.path || '.') };
    case 'run_command':
    case 'shell_session': return { label: verb('Ran command', 'Running command'), detail: String(a.reason || a.command || '').replace(/\s+/g, ' ').slice(0, 72) };
    case 'manage_process': return { label: verb(`Process ${a.action || ''}`.trim(), `Process ${a.action || ''}`.trim()), detail: String(a.label || a.command || a.id || '').slice(0, 60) };
    case 'git_operation': return { label: `Git ${a.operation || ''}`.trim(), detail: String(a.branch || a.target || a.message || '').slice(0, 60) };
    case 'web_search': return { label: verb('Searched web', 'Searching web'), detail: a.query ? `"${String(a.query).slice(0, 60)}"` : '' };
    case 'web_fetch':
    case 'browser_inspect': {
      let host = String(a.url || '');
      try { host = new URL(host).hostname + new URL(host).pathname.slice(0, 30); } catch {}
      return { label: verb('Fetched', 'Fetching'), detail: host };
    }
    case 'http_request': {
      let host = String(a.url || '');
      try { host = new URL(host).hostname; } catch {}
      return { label: `HTTP ${(a.method || 'GET').toUpperCase()}`, detail: host };
    }
    case 'load_toolset': return { label: verb('Loaded tools', 'Loading tools'), detail: Array.isArray(a.toolsets) ? a.toolsets.join(', ') : '' };
    case 'desktop_screenshot': return { label: verb('Captured screen', 'Capturing screen'), detail: '' };
    case 'desktop_action': return { label: `Desktop ${a.action || ''}`.trim(), detail: a.text ? `"${String(a.text).slice(0, 32)}"` : (a.x != null ? `${a.x}, ${a.y}` : '') };
    case 'spawn_session': return { label: verb('Spawned session', 'Spawning session'), detail: String(a.title || a.prompt || '').slice(0, 60) };
    case 'read_session': return { label: verb('Read session', 'Waiting on session'), detail: String(a.sessionId || '').slice(0, 8) };
    case 'send_session_message': return { label: verb('Messaged session', 'Messaging session'), detail: String(a.message || '').slice(0, 55) };
    case 'list_sessions': return { label: verb('Listed sessions', 'Listing sessions'), detail: '' };
    case 'delegate_subagent': return { label: verb('Delegated sub-agent', 'Running sub-agent'), detail: String(a.objective || '').slice(0, 60) };
    case 'todo_write': return { label: verb('Updated plan', 'Updating plan'), detail: Array.isArray(a.todos) ? `${a.todos.filter(t => t.status === 'completed').length}/${a.todos.length} done` : '' };
    case 'document_progress': return { label: verb('Documented progress', 'Documenting progress'), detail: '' };
    case 'memory_store': return { label: `Memory ${a.action || ''}`.trim(), detail: String(a.key || '') };
    case 'scaffold_mcp_server': return { label: verb('Scaffolded MCP', 'Scaffolding MCP'), detail: String(a.name || '') };
    case 'create_dynamic_tool': return { label: verb('Created tool', 'Creating tool'), detail: String(a.name || '') };
    case 'invoke_mcp': return { label: verb('Called MCP', 'Calling MCP'), detail: `${a.server || ''}:${a.tool || ''}` };
    case 'invoke_connector': return { label: verb('Called connector', 'Calling connector'), detail: String(a.name || '') };
    case 'system_info': return { label: verb('Checked system', 'Checking system'), detail: '' };
    default: return { label: name.replaceAll('_', ' '), detail: summarizeArgs(name, a) };
  }
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
    <pre className="pre-box" style={{ maxHeight: 260, fontSize: 11.5, padding: '8px 10px' }}>
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

const ToolTimeline = React.memo(function ToolTimeline({ tools = [], taskId, onRevert, defaultExpandDiff = false, quiet = false }) {
  const [expanded, setExpanded] = useState({});
  const [reverting, setReverting] = useState('');
  if (!tools?.length) return null;

  const toggle = id => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  const handleRevert = async (e, tool) => {
    e.stopPropagation();
    if (!tool.fileChangeEventId || !onRevert) return;
    setReverting(tool.id);
    try { await onRevert(taskId, tool.fileChangeEventId); }
    finally { setReverting(''); }
  };

  return (
    <div className={quiet ? 'tool-list-quiet' : 'tool-timeline'} aria-label="Tool execution steps">
      {tools.map(tool => {
        const Icon = pickToolIcon(tool.name);
        const isOpen = expanded[tool.id] !== undefined ? expanded[tool.id] : (defaultExpandDiff && Boolean(tool.diff));
        const desc = describeToolAction(tool.name, tool.args, tool.status === 'running');
        const hasDiffStats = (tool.addedLines || 0) > 0 || (tool.removedLines || 0) > 0;
        return (
          <div key={tool.id} className={`${quiet ? 'tool-row-quiet' : 'tool-card'} ${tool.status || ''}`}>
            <button type="button" className={quiet ? 'tool-row-head' : 'tool-card-head'} onClick={() => toggle(tool.id)} aria-expanded={isOpen}>
              {quiet && (isOpen ? <ChevronDown size={12} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} /> : <ChevronRight size={12} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />)}
              {tool.status === 'running' ? <Loader2 size={12} className="spin" style={{ color: 'var(--accent)', flexShrink: 0 }} /> :
               tool.status === 'error' ? <XCircle size={12} style={{ color: 'var(--err-fg)', flexShrink: 0 }} /> :
               tool.status === 'denied' ? <Slash size={12} style={{ color: 'var(--warn-fg)', flexShrink: 0 }} /> :
               <CheckCircle2 size={12} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />}
              {!quiet && <Icon size={12} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />}
              <span className="tool-label-text">{desc.label}</span>
              {desc.detail && <span className="tool-arg-preview">{desc.detail}</span>}
              {hasDiffStats && (
                <span className="diff-stat-inline tabular">
                  {tool.addedLines > 0 && <em className="add">+{tool.addedLines}</em>}
                  {tool.removedLines > 0 && <em className="del">-{tool.removedLines}</em>}
                </span>
              )}
              {tool.hasBackup && tool.fileChangeEventId && onRevert && (
                <span
                  role="button"
                  tabIndex={0}
                  className="quiet-revert-btn"
                  title="Revert this file to its automatic pre-edit backup"
                  onClick={e => handleRevert(e, tool)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleRevert(e, tool); }}
                >
                  <RotateCcw size={10} /> {reverting === tool.id ? 'Reverting…' : 'Revert'}
                </span>
              )}
              {tool.durationMs != null && <span className="tool-dur">{formatDuration(tool.durationMs)}</span>}
              {!quiet && (isOpen ? <ChevronDown size={12} style={{ color: 'var(--ink-faint)' }} /> : <ChevronRight size={12} style={{ color: 'var(--ink-faint)' }} />)}
            </button>
            {isOpen && (
              <div className={quiet ? 'tool-row-body' : 'tool-card-body'}>
                {tool.diff && (
                  <div>
                    <small className="hint" style={{ display: 'block', marginBottom: 4 }}>File diff</small>
                    <InlineDiffView diff={tool.diff} />
                  </div>
                )}
                {tool.args && Object.keys(tool.args).length > 0 && (
                  <div>
                    <small className="hint" style={{ display: 'block', marginBottom: 4 }}>Arguments</small>
                    <pre>{prettyJson(tool.args)}</pre>
                  </div>
                )}
                {tool.error && (
                  <div>
                    <small className="hint" style={{ display: 'block', marginBottom: 4, color: 'var(--err-fg)' }}>Error</small>
                    <pre style={{ color: 'var(--err-fg)' }}>{tool.error}</pre>
                  </div>
                )}
                {tool.preview && !tool.diff && (
                  <div>
                    <small className="hint" style={{ display: 'block', marginBottom: 4 }}>Output preview</small>
                    <pre>{tool.preview}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

export default ToolTimeline;
