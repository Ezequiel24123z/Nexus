import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Plus, Search, Settings2, Folder, FolderOpen, MessageSquare, BookOpen, ListTodo,
  Network, Plug, Swords, PanelLeft, Sun, Moon, Pin, Trash2, GitFork, RefreshCw, X,
  ChevronRight, Globe, Clock, Sparkles, Brain, Pencil, History, Ghost, ShieldAlert,
  Loader2, CheckCircle2, PauseCircle, AlertCircle
} from 'lucide-react';
import { installNexusBridge } from './bridge.mjs';
import './styles/tokens.css';
import './styles/app.css';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import ChatView from './components/ChatView.jsx';
import ArenaView from './components/ArenaView.jsx';
import StudioView from './components/StudioView.jsx';
import LibraryView from './components/LibraryView.jsx';
import MemoryView from './components/MemoryView.jsx';
import GalleryView from './components/GalleryView.jsx';
import ConnectorsView from './components/ConnectorsView.jsx';
import McpView from './components/McpView.jsx';
import TasksView from './components/TasksView.jsx';
import SettingsView from './components/SettingsView.jsx';
import PrivateBrowserView from './components/PrivateBrowserView.jsx';
import AutomationsView from './components/AutomationsView.jsx';
import ChangelogView from './components/ChangelogView.jsx';
import Modal from './components/Modal.jsx';
import useDrafts from './useDrafts.jsx';
import { mergeById } from './chat-state.mjs';
import { detectProviderId, providerLabel, formatMoney, cleanError, normalizeAutonomyId, AUTONOMY_LEVELS } from './lib/format.mjs';

installNexusBridge();
const api = (method, args) => window.nexus.invoke(method, args);

function useAppearance() {
  const [preferences, setPreferences] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('nexus-appearance') || '{}');
      return {
        density: saved.density === 'compact' ? 'compact' : 'comfortable',
        motion: saved.motion === 'reduced' ? 'reduced' : 'system',
        theme: ['dark', 'light', 'slate', 'system'].includes(saved.theme) ? saved.theme : 'dark',
      };
    } catch {
      return { density: 'comfortable', motion: 'system', theme: 'dark' };
    }
  });

  const [resolvedTheme, setResolvedTheme] = useState('dark');

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = preferences.theme === 'system' ? (mq?.matches ? 'dark' : 'light') : preferences.theme;
      setResolvedTheme(resolved);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.density = preferences.density;
      document.documentElement.dataset.motion = preferences.motion;
      window.dispatchEvent(new Event('nexus-appearance'));
      void api('setNativeTheme', { theme: resolved }).catch(() => {});
    };
    apply();
    mq?.addEventListener?.('change', apply);
    return () => mq?.removeEventListener?.('change', apply);
  }, [preferences]);

  const update = (key, value) => {
    setPreferences(prev => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem('nexus-appearance', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  return { preferences, resolvedTheme, update };
}

function App() {
  const appearance = useAppearance();
  const [state, setState] = useState(null);
  const [view, setView] = useState('chat');
  const [selected, setSelected] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [query, setQuery] = useState('');
  const [sessionFilter, setSessionFilter] = useState('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [models, setModels] = useState([]);
  const [balance, setBalance] = useState(null);
  const [balanceBusy, setBalanceBusy] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [projectModal, setProjectModal] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [loaded, setLoaded] = useState({ id: null, conversation: [], conversationStart: 0, events: [], eventsStart: 0 });
  const toastSeq = useRef(0);
  const renameCommitRef = useRef(false);

  const startRename = (targetTask, location) => {
    if (!targetTask) return;
    renameCommitRef.current = false;
    setRenaming({ id: targetTask.id, value: targetTask.title || '', original: targetTask.title || '', location });
  };

  const commitRename = async () => {
    if (!renaming || renameCommitRef.current) return;
    renameCommitRef.current = true;
    const nextTitle = renaming.value.trim();
    const targetId = renaming.id;
    const orig = renaming.original;
    setRenaming(null);
    if (!nextTitle || nextTitle === orig) return;
    if (await act('updateChat', { id: targetId, title: nextTitle })) {
      notify('Session renamed.', 'ok');
    }
  };

  const cancelRename = () => {
    renameCommitRef.current = true;
    setRenaming(null);
  };

  const notify = (message, kind = 'info') => {
    const id = ++toastSeq.current;
    setToasts(prev => [...prev.slice(-3), { id, message: String(message), kind }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), kind === 'error' ? 7000 : 3800);
  };

  const draftManager = useDrafts(msg => notify(msg, 'error'));
  const draftKey = selected ? 'task:' + selected : 'new:' + (projectId || '');

  const act = async (method, args) => {
    try {
      return await api(method, args);
    } catch (e) {
      notify(cleanError(e), 'error');
      return null;
    }
  };

  const reloadModels = () => api('models', { sort: 'intelligence-high-to-low' }).then(setModels).catch(() => {});
  const refreshUpdate = async () => {
    try {
      const res = await api('checkUpdate');
      setUpdateStatus(res);
      return res;
    } catch { return null; }
  };
  const refreshBalance = async () => {
    setBalanceBusy(true);
    try { setBalance(await api('balance')); } catch {}
    finally { setBalanceBusy(false); }
  };

  useEffect(() => {
    api('snapshot').then(snap => {
      setState(snap);
      if (snap?.settings?.autoCheckUpdates !== false) {
        setTimeout(() => { void refreshUpdate(); }, 2500);
      }
    }).catch(e => notify(cleanError(e), 'error'));
    const off = window.nexus.subscribe(setState);
    void reloadModels();
    void refreshBalance();
    const timer = setInterval(refreshBalance, 60000);
    return () => { off(); clearInterval(timer); };
  }, []);

  // Live Custom CSS & Accent Color injection from Settings / nexus.config.json
  useEffect(() => {
    let styleEl = document.getElementById('nexus-user-css');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'nexus-user-css';
      document.head.appendChild(styleEl);
    }
    const accent = state?.settings?.accentColor;
    const accentCss = accent ? `:root, html[data-theme="dark"], html[data-theme="light"], html[data-theme="slate"] { --accent: ${accent}; --accent-hover: ${accent}; }\n` : '';
    styleEl.textContent = accentCss + (state?.settings?.customCss || '');
  }, [state?.settings?.customCss, state?.settings?.accentColor]);

  // Sync tray preference with native host
  useEffect(() => {
    if (state?.settings?.minimizeToTray !== undefined) {
      void api('setTrayMode', { enabled: Boolean(state.settings.minimizeToTray) }).catch(() => {});
    }
  }, [state?.settings?.minimizeToTray]);

  // Global keyboard shortcuts (Ctrl+N new chat, Ctrl+B toggle sidebar)
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); setSelected(null); setView('chat'); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); setSidebarCollapsed(c => !c); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Watch active chat on core server
  useEffect(() => {
    let live = true;
    api('watchChat', { id: view === 'chat' ? selected : null })
      .then(next => { if (live) setState(next); })
      .catch(() => {});
    return () => { live = false; };
  }, [selected, view]);

  // Merge incoming chat snapshot into loaded history
  useEffect(() => {
    if (!state || !selected) return;
    const remote = state.tasks.find(t => t.id === selected);
    if (!remote || !Array.isArray(remote.conversation)) return;
    setLoaded(prev => prev.id !== selected
      ? { id: selected, conversation: remote.conversation, conversationStart: remote.conversationStart, events: remote.events, eventsStart: remote.eventsStart }
      : {
          ...prev,
          conversation: prev.windowed
            ? mergeById(prev.conversation, remote.conversation.filter(m => prev.conversation.some(i => i.id === m.id)))
            : mergeById(prev.conversation, remote.conversation),
          conversationStart: prev.windowed ? prev.conversationStart : Math.min(prev.conversationStart, remote.conversationStart),
          events: mergeById(prev.events, remote.events),
          eventsStart: Math.min(prev.eventsStart, remote.eventsStart),
        });
  }, [state, selected]);

  if (!state || !draftManager.ready) {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center', color: 'var(--ink-muted)' }}>
        <div className="row"><span className="brand-mark">N</span><span>Launching NEXUS…</span></div>
      </div>
    );
  }

  const s = state.settings;
  const task = state.tasks.find(t => t.id === selected) || null;
  const currentProject = state.projects.find(p => p.id === projectId) || null;
  const activeWorkspace = task?.workspace || currentProject?.workspace || workspace;
  const activeProvider = detectProviderId(task?.model || s.model, s.customProviders);
  const isTaskActive = t => Boolean(t?.compacting || ['running', 'approval', 'queued'].includes(t?.status));
  const activeCount = state.tasks.filter(isTaskActive).length;
  const scopedTasks = state.tasks
    .filter(t => (!projectId || t.projectId === projectId) && (t.title + ' ' + t.prompt).toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const scopedActiveCount = scopedTasks.filter(isTaskActive).length;
  const scopedDoneCount = scopedTasks.filter(t => t.status === 'complete').length;
  const visibleTasks = scopedTasks.filter(t => {
    if (sessionFilter === 'active') return isTaskActive(t);
    if (sessionFilter === 'done') return !isTaskActive(t);
    return true;
  });

  const openTask = id => { setSelected(id); setView('chat'); };
  const newChat = () => { setSelected(null); setView('chat'); };
  const isDark = appearance.resolvedTheme !== 'light';

  const navItems = [
    ['memory', Brain, 'Memory & Profile'],
    ['browser', Globe, 'Private Browser'],
    ['gallery', Sparkles, 'Skills & Plugins'],
    ['arena', Swords, 'Model Arena'],
    ['files', FolderOpen, 'Code & Git Studio'],
    ['automations', Clock, 'Automations'],
    ['queue', ListTodo, 'Tasks'],
    ['library', BookOpen, 'Library'],
    ['connectors', Network, 'Connectors'],
    ['mcp', Plug, 'MCP Extensions'],
  ];

  const viewTitle = {
    chat: task?.title || currentProject?.name || 'New Chat',
    memory: 'User Memory & Profile',
    browser: 'Private & Agent Browser',
    gallery: 'Skills & Plugins Gallery',
    arena: 'Model Arena',
    files: 'Code & Git Studio',
    automations: 'Automations',
    queue: 'Tasks',
    library: 'Library',
    connectors: 'Connectors',
    mcp: 'MCP Extensions',
    changelog: 'Release Timeline & Updates',
    settings: 'Settings',
  }[view];

  const autonomyId = normalizeAutonomyId(task?.agentMode || s.agentMode);
  const autonomyShort = AUTONOMY_LEVELS.find(l => l.id === autonomyId)?.short || autonomyId;
  const enabledAutomations = (state.automations || []).filter(a => a.enabled).length;

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand-bar">
          <span className="brand-mark">N</span>
          <strong>NEXUS</strong>
          <span className="brand-tag">NATIVE</span>
        </div>

        <button type="button" className="new-chat-btn" onClick={newChat}>
          <Plus size={15} />
          <span>New Chat</span>
          <kbd>Ctrl N</kbd>
        </button>

        <div className="sidebar-search">
          <Search size={14} />
          <input aria-label="Search chats" placeholder="Search chats…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>

        <nav className="sidebar-nav">
          {navItems.map(([id, Icon, label]) => (
            <button key={id} type="button" className={`nav-btn ${view === id ? 'active' : ''}`} onClick={() => setView(id)}>
              <Icon size={15} />
              <span>{label}</span>
              {id === 'memory' && (state.memoryCount || 0) > 0 && <span className="nav-badge tabular">{state.memoryCount}</span>}
              {id === 'queue' && activeCount > 0 && <span className="nav-badge tabular">{activeCount}</span>}
              {id === 'automations' && enabledAutomations > 0 && <span className="nav-badge tabular">{enabledAutomations}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-scroll">
          <div className="side-section-head">
            <span>Projects</span>
            <button type="button" aria-label="New project" title="New project" onClick={() => setProjectModal({ name: '', workspace: '', instructions: '' })}><Plus size={13} /></button>
          </div>
          <button type="button" className={`nav-btn ${!projectId && view === 'chat' ? 'active' : ''}`} onClick={() => { setProjectId(''); newChat(); }}>
            <MessageSquare size={14} /><span>All Chats</span>
          </button>
          {state.projects.map(p => (
            <div key={p.id} className={`chat-item ${projectId === p.id ? 'selected' : ''}`}>
              <button type="button" className="chat-item-main" title={p.workspace || 'No linked root folder'} onClick={() => { setProjectId(p.id); if (p.workspace) setWorkspace(p.workspace); newChat(); }}>
                <Folder size={14} style={{ color: projectId === p.id ? 'var(--accent)' : 'var(--ink-muted)', flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block' }}>{p.name}</span>
                  {p.workspace && <small className="hint mono" style={{ display: 'block', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.workspace.split(/[\\/]/).slice(-2).join('\\')}</small>}
                </div>
              </button>
              <div className="chat-item-actions">
                <button type="button" title="Edit project" onClick={() => setProjectModal({ ...p })}><Settings2 size={11} /></button>
              </div>
            </div>
          ))}

          <div className="side-section-head">
            <span>{currentProject?.name || 'Sessions'}</span>
            <div className="row" style={{ gap: 5 }}>
              {scopedActiveCount > 0 && (
                <span className="session-live-counter tabular" title={`${scopedActiveCount} active session(s)`}>
                  <i className="status-dot running" /> {scopedActiveCount} live
                </span>
              )}
              <span className="tabular">{scopedTasks.length}</span>
            </div>
          </div>
          {scopedTasks.length > 0 && (
            <div className="sidebar-status-filter" role="tablist" aria-label="Filter sessions by status">
              {[
                ['all', `All (${scopedTasks.length})`],
                ['active', `Active (${scopedActiveCount})`],
                ['done', `Done (${scopedDoneCount})`],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={sessionFilter === id}
                  className={`sidebar-filter-btn ${sessionFilter === id ? 'active' : ''}`}
                  onClick={() => setSessionFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {(() => {
            const byId = new Map(visibleTasks.map(t => [t.id, t]));
            const childrenOf = new Map();
            const roots = [];
            for (const t of visibleTasks) {
              if (t.parentTaskId && byId.has(t.parentTaskId)) {
                if (!childrenOf.has(t.parentTaskId)) childrenOf.set(t.parentTaskId, []);
                childrenOf.get(t.parentTaskId).push(t);
              } else {
                roots.push(t);
              }
            }
            const statusMetaFor = t => {
              if (t.compacting) return { state: 'running', label: 'Compact', Icon: Loader2, spin: true, tip: 'Compacting context…' };
              if (t.status === 'running') return { state: 'running', label: 'Live', Icon: Loader2, spin: true, tip: t.liveActivity || 'Running…' };
              if (t.status === 'approval') return { state: 'approval', label: 'Approve', Icon: ShieldAlert, spin: false, tip: 'Waiting for your approval' };
              if (t.status === 'queued') return { state: 'queued', label: 'Queued', Icon: Clock, spin: false, tip: 'Queued to start' };
              if (t.status === 'failed') return { state: 'failed', label: 'Error', Icon: AlertCircle, spin: false, tip: 'Stopped with an error' };
              if (t.status === 'paused') return { state: 'paused', label: 'Paused', Icon: PauseCircle, spin: false, tip: 'Paused' };
              return { state: 'complete', label: 'Done', Icon: CheckCircle2, spin: false, tip: 'Completed' };
            };
            const renderTaskRow = (t, depth = 0) => {
              const kids = childrenOf.get(t.id) || [];
              const isRenamingHere = renaming?.id === t.id && renaming?.location === 'sidebar';
              const meta = statusMetaFor(t);
              const StatusIcon = meta.Icon;
              return (
                <React.Fragment key={t.id}>
                  <div className={`chat-item state-${meta.state} ${selected === t.id && view === 'chat' ? 'selected' : ''} ${depth > 0 ? 'nested-item' : ''}`} style={depth > 0 ? { marginLeft: Math.min(depth * 14, 28) } : undefined}>
                    {isRenamingHere ? (
                      <div className="chat-item-main" style={{ paddingRight: 6 }}>
                        <StatusIcon size={13} className={`session-status-icon ${meta.state} ${meta.spin ? 'spin' : ''}`} />
                        <input
                          aria-label="Rename session"
                          autoFocus
                          maxLength={120}
                          value={renaming.value}
                          onFocus={e => e.target.select()}
                          onChange={e => setRenaming(prev => prev ? { ...prev, value: e.target.value } : prev)}
                          onBlur={() => void commitRename()}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
                            else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                          }}
                          style={{ flex: 1, minWidth: 0, padding: '2px 6px', fontSize: 12.5, height: 24 }}
                        />
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="chat-item-main"
                          onClick={() => openTask(t.id)}
                          onDoubleClick={e => { e.stopPropagation(); startRename(t, 'sidebar'); }}
                          title={`${meta.tip} · Click to open · Double-click to rename`}
                        >
                          <StatusIcon size={13} className={`session-status-icon ${meta.state} ${meta.spin ? 'spin' : ''}`} />
                          <span className="chat-item-title">{t.title}</span>
                          {t.ephemeral && <small className="tag-chip ram-tag" title="RAM-Only Ephemeral Session (zero disk traces)">RAM</small>}
                          {t.adminMode && <small className="tag-chip admin-tag" title="Windows Administrator Rights enabled">ADM</small>}
                          {kids.length > 0 && <small className="tag-chip tabular" style={{ fontSize: 9.5, padding: '0 5px' }}>{kids.length}</small>}
                          {t.pinned && <Pin size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                          <small className={`session-state-pill ${meta.state}`}>{meta.label}</small>
                        </button>
                        <div className="chat-item-actions">
                          <button type="button" title="Rename session" aria-label="Rename session" onClick={e => { e.stopPropagation(); startRename(t, 'sidebar'); }}><Pencil size={11} /></button>
                          <button type="button" title={t.pinned ? 'Unpin' : 'Pin'} onClick={() => act('updateChat', { id: t.id, pinned: !t.pinned })}><Pin size={11} /></button>
                          <button type="button" title="Fork chat" onClick={async () => { const r = await act('forkTask', { id: t.id }); if (r?.id) openTask(r.id); }}><GitFork size={11} /></button>
                          <button type="button" title="Delete chat" onClick={async () => {
                            if (await act('deleteTask', { id: t.id })) {
                              if (selected === t.id) setSelected(null);
                              notify('Chat deleted.', 'ok');
                            }
                          }}><Trash2 size={11} /></button>
                        </div>
                      </>
                    )}
                  </div>
                  {kids.map(child => renderTaskRow(child, depth + 1))}
                </React.Fragment>
              );
            };
            return roots.map(r => renderTaskRow(r, 0));
          })()}
          {!visibleTasks.length && (
            <p className="hint" style={{ padding: '6px 10px' }}>
              {scopedTasks.length > 0 ? `No ${sessionFilter} sessions.` : 'Start a new chat or create a Project rooted in a folder.'}
            </p>
          )}
        </div>

        <div className="sidebar-footer">
          <div className="provider-foot">
            <div>
              <span>{providerLabel(activeProvider, s.customProviders)}</span>
              <strong className="tabular">{activeProvider === 'openrouter' ? formatMoney(balance?.remaining) : (state.providerKeys?.[activeProvider] ? 'Connected' : 'Configure key')}</strong>
            </div>
            <button type="button" className="btn-icon" aria-label="Refresh balance" disabled={balanceBusy} onClick={refreshBalance}><RefreshCw size={13} className={balanceBusy ? 'spin' : ''} /></button>
          </div>
          <button type="button" className={`nav-btn ${view === 'changelog' ? 'active' : ''}`} onClick={() => setView('changelog')}>
            <History size={15} />
            <span>Changelog & Updates</span>
            {updateStatus?.updateAvailable
              ? <span className="nav-badge" style={{ background: 'var(--ok-bg)', color: 'var(--ok-fg)' }}>v{updateStatus.latestVersion}</span>
              : <span className="nav-badge mono" style={{ opacity: 0.75 }}>v{updateStatus?.currentVersion || '1.4.0'}</span>}
          </button>
          <button type="button" className={`nav-btn ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
            <Settings2 size={15} /><span>Settings & Config</span>
          </button>
        </div>
      </aside>

      <main className="main-col">
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="btn-icon" title="Toggle sidebar · Ctrl+B" aria-label="Toggle sidebar" onClick={() => setSidebarCollapsed(c => !c)}><PanelLeft size={16} /></button>
            <span className="topbar-crumb">NEXUS</span>
            <ChevronRight size={13} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
            {view === 'chat' && task && renaming?.id === task.id && renaming?.location === 'topbar' ? (
              <input
                aria-label="Rename active session"
                autoFocus
                maxLength={120}
                value={renaming.value}
                onFocus={e => e.target.select()}
                onChange={e => setRenaming(prev => prev ? { ...prev, value: e.target.value } : prev)}
                onBlur={() => void commitRename()}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
                  else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                }}
                style={{ width: 280, maxWidth: '40vw', padding: '3px 8px', fontSize: 13.5, fontWeight: 550, height: 28 }}
              />
            ) : view === 'chat' && task ? (
              <div className="row" style={{ gap: 4, minWidth: 0 }}>
                <span
                  className="topbar-title"
                  style={{ cursor: 'pointer' }}
                  title="Click to rename session"
                  onClick={() => startRename(task, 'topbar')}
                >
                  {viewTitle}
                </span>
                {task.ephemeral && <span className="pill ram-pill" title="RAM-Only session (zero disk traces)"><Ghost size={11} /> RAM-Only</span>}
                {task.adminMode && <span className="pill warn" title="Windows Administrator rights active for this session"><ShieldAlert size={11} /> Admin</span>}
                <button
                  type="button"
                  className="btn-icon"
                  style={{ width: 24, height: 24, opacity: 0.7 }}
                  title="Rename session"
                  aria-label="Rename active session"
                  onClick={() => startRename(task, 'topbar')}
                >
                  <Pencil size={12} />
                </button>
              </div>
            ) : (
              <span className="topbar-title">{viewTitle}</span>
            )}
          </div>

          <div className="topbar-right">
            <CommandPalette
              state={state}
              navigate={setView}
              openTask={openTask}
              newChat={newChat}
              appearance={appearance}
              toggleSidebar={() => setSidebarCollapsed(c => !c)}
              onAction={method => act(method)}
              onOpenChange={setPaletteOpen}
            />
            <button
              type="button"
              className="btn-icon"
              title={isDark ? 'Switch to Studio Paper (Light)' : 'Switch to Obsidian (Dark)'}
              aria-label="Toggle color theme"
              onClick={() => appearance.update('theme', isDark ? 'light' : 'dark')}
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <span className={`pill ${autonomyId === 'unrestricted' ? 'warn' : autonomyId === 'semi-autopilot' ? 'info' : ''}`}>
              {providerLabel(activeProvider, s.customProviders)} · {autonomyShort}
            </span>
            {currentProject && (
              <button type="button" className="btn-icon" title="Edit project" onClick={() => setProjectModal({ ...currentProject })}><Settings2 size={15} /></button>
            )}
          </div>
        </header>

        {view === 'chat' && (
          <ChatView
            state={state}
            task={task}
            currentProject={currentProject}
            projectId={projectId}
            workspace={workspace}
            setWorkspace={setWorkspace}
            models={models}
            draftManager={draftManager}
            draftKey={draftKey}
            loaded={loaded}
            setLoaded={setLoaded}
            act={act}
            notify={notify}
            openTask={openTask}
            navigate={setView}
            overlayOpen={paletteOpen || Boolean(projectModal)}
          />
        )}
        {view === 'browser' && (
          <PrivateBrowserView
            state={state}
            act={act}
            notify={notify}
            modalOpen={paletteOpen || Boolean(projectModal)}
            onSendToChat={text => {
              draftManager.update(draftKey, { text });
              setView('chat');
              notify('Page content copied into your chat composer.', 'ok');
            }}
            onAttachScreenshot={(att, url) => {
              const cur = draftManager.get(draftKey);
              draftManager.update(draftKey, {
                attachments: [...(cur.attachments || []), att],
                text: cur.text || `Inspect this screenshot from ${url}:`,
              });
              setView('chat');
            }}
          />
        )}
        {view === 'memory' && <MemoryView state={state} workspace={activeWorkspace} act={act} notify={notify} />}
        {view === 'gallery' && <GalleryView act={act} notify={notify} navigate={setView} />}
        {view === 'arena' && <ArenaView state={state} models={models} workspace={activeWorkspace} setWorkspace={setWorkspace} projectId={projectId} openTask={openTask} act={act} notify={notify} />}
        {view === 'files' && <StudioView workspace={activeWorkspace} setWorkspace={setWorkspace} act={act} notify={notify} onOpenInChat={path => { setWorkspace(path); newChat(); }} />}
        {view === 'automations' && <AutomationsView state={state} workspace={activeWorkspace} models={models} act={act} notify={notify} openTask={openTask} />}
        {view === 'queue' && <TasksView state={state} projectId={projectId} workspace={activeWorkspace} setWorkspace={setWorkspace} openTask={openTask} navigate={setView} act={act} notify={notify} />}
        {view === 'library' && <LibraryView state={state} act={act} notify={notify} navigate={setView} />}
        {view === 'connectors' && <ConnectorsView act={act} count={state.connectorCount ?? state.connectors.length} notify={notify} />}
        {view === 'mcp' && <McpView state={state} workspace={activeWorkspace} act={act} notify={notify} />}
        {view === 'changelog' && (
          <ChangelogView
            state={state}
            act={act}
            notify={notify}
            updateStatus={updateStatus}
            onRefreshUpdate={refreshUpdate}
          />
        )}
        {view === 'settings' && (
          <SettingsView
            state={state}
            appearance={appearance}
            models={models}
            reloadModels={reloadModels}
            balance={balance}
            balanceBusy={balanceBusy}
            refreshBalance={refreshBalance}
            act={act}
            notify={notify}
            navigate={setView}
            updateStatus={updateStatus}
            onRefreshUpdate={refreshUpdate}
          />
        )}
      </main>

      {projectModal && (
        <Modal label={projectModal.id ? 'Edit Project' : 'New Project'} close={() => setProjectModal(null)}>
          <h2>{projectModal.id ? 'Edit Project' : 'New Project'}</h2>
          <form onSubmit={async e => {
            e.preventDefault();
            const id = await act('saveProject', projectModal);
            if (id) { setProjectId(id); setProjectModal(null); notify('Project saved.', 'ok'); }
          }}>
            <label className="field"><span>Project Name</span><input required value={projectModal.name} onChange={e => setProjectModal({ ...projectModal, name: e.target.value })} placeholder="e.g. Nexus Core, Trading Bot, Client WebApp" /></label>
            <label className="field">
              <span>Project Root Folder</span>
              <div className="row">
                <input className="mono" style={{ flex: 1 }} value={projectModal.workspace || ''} onChange={e => setProjectModal({ ...projectModal, workspace: e.target.value })} placeholder="C:\Projects\my-app (auto-loads NEXUS.md, CLAUDE.md, .nexus/skills/*/SKILL.md)" />
                <button type="button" className="btn-secondary" onClick={async () => { const p = await act('chooseWorkspace'); if (p) setProjectModal({ ...projectModal, workspace: p }); }}>
                  <FolderOpen size={14} /> Browse
                </button>
              </div>
            </label>
            <label className="field"><span>Project Instructions</span><textarea rows={5} value={projectModal.instructions} onChange={e => setProjectModal({ ...projectModal, instructions: e.target.value })} placeholder="Domain conventions, build steps, or architecture guidelines…" /></label>
            <div className="row-between" style={{ marginTop: 14 }}>
              {projectModal.id ? (
                <button type="button" className="btn-danger" onClick={async () => { if (await act('removeProject', { id: projectModal.id })) { setProjectId(''); setProjectModal(null); notify('Project removed (chats kept).', 'info'); } }}>Remove Project</button>
              ) : <span />}
              <div className="row">
                <button type="button" className="btn-secondary" onClick={() => setProjectModal(null)}>Cancel</button>
                <button className="btn-primary">Save Project</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      <div className="toast-stack" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <div className="toast-msg">{t.message}</div>
            <button type="button" className="btn-icon" style={{ width: 22, height: 22 }} onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}><X size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

