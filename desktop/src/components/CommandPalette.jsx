import React, { useEffect, useMemo, useState } from 'react';
import { Command, ArrowUpRight, Search } from 'lucide-react';
import Modal from './Modal.jsx';

export default function CommandPalette({ state, navigate, openTask, newChat, appearance, toggleSidebar, onAction, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  useEffect(() => { onOpenChange?.(open); }, [open]);

  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        if (document.querySelector('[role="dialog"]') && !open) return;
        e.preventDefault();
        setQuery('');
        setIndex(0);
        setOpen(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const actions = useMemo(() => {
    const items = [
      { id: 'new', title: 'New Chat', detail: 'Start a new autonomous agent session', run: newChat },
      { id: 'nav-chat', title: 'Chat Workspace', detail: 'View · Agent chat', run: () => navigate('chat') },
      { id: 'nav-memory', title: 'User Memory & Profile', detail: 'Priorities, preferences, working style, constraints & facts', run: () => navigate('memory') },
      { id: 'nav-browser', title: 'Private Browser (VPN / Tor / Proxy)', detail: 'View · Isolated InPrivate WebView2 + tracker shield', run: () => navigate('browser') },
      { id: 'nav-arena', title: 'Model Arena', detail: 'Compare 2–4 models side-by-side', run: () => navigate('arena') },
      { id: 'nav-studio', title: 'Files & Git Studio', detail: 'Editor, Git diff, Interactive Terminal, Processes, Worktrees', run: () => navigate('files') },
      { id: 'nav-auto', title: 'Automations & Cron Scheduler', detail: 'View · Recurring & scheduled local agent jobs', run: () => navigate('automations') },
      { id: 'nav-queue', title: 'Tasks & Batches', detail: 'Parallel queue and dependency chains', run: () => navigate('queue') },
      { id: 'nav-library', title: 'Library & Memories', detail: 'Skills, Functions, Custom Commands, Self-Improve', run: () => navigate('library') },
      { id: 'nav-gallery', title: 'Skills & Plugins Gallery', detail: 'Marketplace · Cloud SKILL.md, Native JS Plugins, Official MCPs', run: () => navigate('gallery') },
      { id: 'nav-connectors', title: 'REST Connectors & OpenAPI', detail: 'HTTP endpoints and live tester', run: () => navigate('connectors') },
      { id: 'nav-mcp', title: 'MCP Extensions', detail: 'Connect, discover, or scaffold local MCP servers', run: () => navigate('mcp') },
      { id: 'nav-settings', title: 'Settings & Raw Config', detail: 'Providers, parameters, tools, custom CSS, nexus.config.json', run: () => navigate('settings') },
      { id: 'theme-dark', title: 'Theme: Obsidian (Dark)', detail: 'Appearance', run: () => appearance.update('theme', 'dark') },
      { id: 'theme-light', title: 'Theme: Studio Paper (Light)', detail: 'Appearance', run: () => appearance.update('theme', 'light') },
      { id: 'theme-slate', title: 'Theme: Midnight Slate', detail: 'Appearance', run: () => appearance.update('theme', 'slate') },
      { id: 'toggle-sidebar', title: 'Toggle Sidebar', detail: 'Layout · Ctrl+B', run: toggleSidebar },
      { id: 'open-data', title: 'Open NEXUS Data Directory', detail: 'System · nexus.config.json & store', run: () => onAction?.('openDataDir') },
      { id: 'devtools', title: 'Open Native DevTools', detail: 'Debug · Inspect WebView2', run: () => onAction?.('openDevTools') },
      ...(state?.tasks || []).map(task => ({
        id: 'task-' + task.id,
        title: task.title,
        detail: `Chat · ${task.status} · ${task.model}`,
        run: () => openTask(task.id),
      })),
    ];
    const q = query.trim().toLowerCase();
    return (q ? items.filter(i => (i.title + ' ' + i.detail).toLowerCase().includes(q)) : items).slice(0, 24);
  }, [state, query, appearance, navigate, openTask, newChat, toggleSidebar, onAction]);

  const runItem = item => {
    if (!item) return;
    setOpen(false);
    item.run();
  };

  return (
    <>
      <button type="button" className="cmd-trigger" aria-label="Quick navigation" title="Command Palette · Ctrl+K" onClick={() => { setQuery(''); setIndex(0); setOpen(true); }}>
        <Search size={13} />
        <span>Command Palette…</span>
        <kbd>Ctrl K</kbd>
      </button>

      {open && (
        <Modal label="Command Palette" close={() => setOpen(false)}>
          <div className="row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10, marginBottom: 8, paddingRight: 30 }}>
            <Command size={17} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <input
              aria-label="Search commands or chats"
              placeholder="Jump to view, chat, theme, or action…"
              value={query}
              onChange={e => { setQuery(e.target.value); setIndex(0); }}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(actions.length - 1, i + 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(0, i - 1)); }
                if (e.key === 'Enter' && actions[index]) { e.preventDefault(); runItem(actions[index]); }
              }}
              style={{ border: 0, background: 'transparent', boxShadow: 'none', padding: '4px 0' }}
            />
          </div>

          <div style={{ maxHeight: 360, overflowY: 'auto', display: 'grid', gap: 2 }}>
            {actions.map((item, i) => (
              <button
                key={item.id}
                type="button"
                className={`autocomplete-item ${i === index ? 'active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => runItem(item)}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 550, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                  <small>{item.detail}</small>
                </div>
                <ArrowUpRight size={14} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
              </button>
            ))}
            {!actions.length && <p className="hint" style={{ padding: 14, textAlign: 'center' }}>No matching commands or chats.</p>}
          </div>

          <div className="row-between" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, marginTop: 10, fontSize: 11, color: 'var(--ink-faint)' }}>
            <span>↑ ↓ navigate · Enter execute · Esc close</span>
            <span>{actions.length} items</span>
          </div>
        </Modal>
      )}
    </>
  );
}
