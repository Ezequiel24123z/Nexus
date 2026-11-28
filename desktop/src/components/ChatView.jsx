import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp, ArrowDown, Square, Pause, Play, Pin, Search, Activity,
  Settings2, Download, FolderOpen, Plus, GitFork, Pencil, RefreshCw, CheckCircle2,
  Circle, Clock, AlertCircle, Cpu, Sparkles, PanelRight, Loader2, Check, X, Layers, ChevronRight, Globe, Ghost, ShieldAlert
} from 'lucide-react';
import { MarkdownRenderer, StreamingMarkdown, CopyButton } from './MarkdownRenderer.jsx';
import ChatMediaCard from './ChatMediaCard.jsx';
import ToolTimeline, { ToolActivityRow, describeToolAction, formatThoughtDuration } from './ToolTimeline.jsx';
import useSmoothStream from '../useSmoothStream.jsx';
import ComposerControls from './ModelPickerPopover.jsx';
import SessionMetricsPopover from './SessionMetricsPopover.jsx';
import BrowserSidePanel from './BrowserSidePanel.jsx';
import ChatDrawer from './ChatDrawer.jsx';
import ContextInspectorModal from './ContextInspectorModal.jsx';
import Modal from './Modal.jsx';
import Attachments from '../Attachments.jsx';
import ChatSettings from '../ChatSettings.jsx';
import { fileToBase64 } from '../bridge.mjs';
import { STATUS_LABELS, BUILTIN_SLASH_COMMANDS, formatCount, formatMoney, formatDuration, prettyJson, cleanError } from '../lib/format.mjs';

const api = (method, args) => window.nexus.invoke(method, args);

function TodoTracker({ todos = [] }) {
  const done = todos.filter(t => t.status === 'completed').length;
  const active = todos.find(t => t.status === 'in_progress');
  return (
    <details className="todo-bar">
      <summary>
        <div className="row" style={{ minWidth: 0, flex: 1 }}>
          <ChevronRight size={12} className="ghost-chevron" />
          <strong style={{ fontSize: 12, flexShrink: 0 }}>Plan</strong>
          <span className="hint tabular" style={{ fontSize: 11.5, flexShrink: 0 }}>{done}/{todos.length}</span>
          {active && <span className="ghost-preview">· {active.title}</span>}
        </div>
        <div className="ctx-bar" style={{ width: 96, flexShrink: 0 }}>
          <div className="ctx-bar-fill" style={{ width: `${Math.round((done / Math.max(1, todos.length)) * 100)}%` }} />
        </div>
      </summary>
      <div className="todo-items">
        {todos.map(t => (
          <div key={t.id} className={`todo-card ${t.status}`}>
            {t.status === 'completed' ? <CheckCircle2 size={13} /> : t.status === 'in_progress' ? <Clock size={13} style={{ color: 'var(--accent)' }} /> : t.status === 'blocked' ? <AlertCircle size={13} style={{ color: 'var(--err-fg)' }} /> : <Circle size={13} />}
            <span>{t.title}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function LiveReasoningContent({ text }) {
  const shown = useSmoothStream(text, { startFromEmpty: true });
  const boxRef = useRef(null);
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [shown]);
  return (
    <div className="reasoning-rail live-rail" ref={boxRef}>
      <MarkdownRenderer text={shown} />
    </div>
  );
}

const ReasoningBlock = React.memo(function ReasoningBlock({ text, durationMs = null, startedAt = null, live = false }) {
  const [open, setOpen] = useState(Boolean(live));
  const [elapsedMs, setElapsedMs] = useState(() => (live && startedAt ? Math.max(0, Date.now() - startedAt) : durationMs));

  useEffect(() => {
    if (!live) {
      setElapsedMs(durationMs);
      return;
    }
    const base = startedAt || Date.now();
    const tick = () => setElapsedMs(Math.max(0, Date.now() - base));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [live, startedAt, durationMs]);

  if (!text) return null;
  const durStr = formatThoughtDuration(elapsedMs);
  const label = live
    ? (durStr ? `Thinking… ${durStr}` : 'Thinking…')
    : (durStr ? `Thought for ${durStr}` : 'Thought');

  return (
    <div className={`cp-row cp-thought ${live ? 'is-running' : ''} ${open ? 'is-open' : ''}`}>
      <button type="button" className="cp-row-btn" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="cp-row-icon">
          {live ? <Loader2 size={13} className="spin" style={{ color: 'var(--accent)' }} /> : <Sparkles size={13} />}
        </span>
        <span className={`cp-row-label cp-thought-label ${live ? 'shimmer-text' : ''}`}>{label}</span>
        <span className="cp-row-right">
          <ChevronRight size={12} className={`cp-chev ${open ? 'rot' : ''}`} />
        </span>
      </button>
      {open && (
        <div className="cp-drawer cp-thought-drawer">
          {live ? <LiveReasoningContent text={text} /> : <div className="reasoning-rail"><MarkdownRenderer text={text} /></div>}
        </div>
      )}
    </div>
  );
});

function groupConversationTurns(messages = [], isRunning = false) {
  const turns = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role === 'user') {
      turns.push({ kind: 'user', message: m });
      i++;
      continue;
    }
    const batch = [];
    while (i < messages.length && messages[i].role === 'assistant') {
      batch.push(messages[i]);
      i++;
    }
    const isLastTurn = i === messages.length;
    const last = batch[batch.length - 1];
    turns.push({
      kind: 'assistant',
      id: batch[0].id,
      batch,
      primary: last,
      activeTurn: isLastTurn && isRunning,
    });
  }
  return turns;
}

// Build flat chronological Copilot-style stream inside ONE NEXUS turn:
// Interleaves Reasoning rows ("Thought for 18s"), individual Tool rows ("View ...", "Edit ... +2 -2", ">_ Run ..."),
// and inline prose cleanly in exact execution order — no awkward nested accordion boxes!
function buildTurnSegments(batch = [], silentToolSteps = false) {
  const segments = [];
  const pushActivity = item => {
    const prev = segments[segments.length - 1];
    if (prev && prev.kind === 'activity') {
      prev.items.push(item);
    } else {
      segments.push({ kind: 'activity', key: 'act-' + item.key, items: [item] });
    }
  };

  for (let idx = 0; idx < batch.length; idx++) {
    const step = batch[idx];
    const hasTools = Boolean(step.toolRuns?.length);
    const isLast = idx === batch.length - 1;
    if (step.reasoning?.trim()) {
      pushActivity({
        kind: 'reasoning',
        key: 'reason-' + step.id,
        step: step.step,
        text: step.reasoning,
        durationMs: step.reasoningDurationMs ?? null,
      });
    }
    const showProse = Boolean(
      (step.content?.trim() && (!silentToolSteps || !hasTools || isLast)) ||
      step.attachments?.length ||
      step.media?.length ||
      step.sources?.length
    );
    if (showProse) {
      segments.push({
        kind: 'prose',
        key: 'prose-' + step.id,
        id: step.id,
        content: step.content || '',
        attachments: step.attachments || [],
        media: step.media || [],
        sources: step.sources || [],
      });
    }
    if (hasTools) {
      for (const tool of step.toolRuns) {
        pushActivity({ kind: 'tool', key: 'tool-' + tool.id, tool });
      }
    }
  }
  return segments;
}

const ActivityStreamBlock = React.memo(function ActivityStreamBlock({ items = [], taskId, onRevert, activeTurn = false }) {
  const [showAll, setShowAll] = useState(false);
  if (!items.length) return null;

  const COLLAPSE_THRESHOLD = 16;
  const shouldFold = !activeTurn && !showAll && items.length > COLLAPSE_THRESHOLD;
  const visibleItems = shouldFold ? items.slice(-5) : items;
  const hiddenCount = items.length - visibleItems.length;

  const toolItems = items.filter(it => it.kind === 'tool').map(it => it.tool);
  const editCount = toolItems.filter(t => ['write_file', 'replace_text', 'multi_edit', 'apply_patch'].includes(t.name)).length;
  const added = toolItems.reduce((m, t) => m + (t.addedLines || 0), 0);
  const removed = toolItems.reduce((m, t) => m + (t.removedLines || 0), 0);

  return (
    <div className="cp-stream" aria-label="Agent activity timeline">
      {shouldFold && (
        <button type="button" className="cp-fold-btn" onClick={() => setShowAll(true)}>
          <ChevronRight size={12} />
          <span>Show {hiddenCount} earlier steps</span>
          {editCount > 0 && (
            <span className="cp-diff-stat tabular">
              {added > 0 && <em className="add">+{added}</em>}
              {removed > 0 && <em className="del">-{removed}</em>}
            </span>
          )}
        </button>
      )}
      {visibleItems.map(item => (
        item.kind === 'reasoning'
          ? <ReasoningBlock key={item.key} text={item.text} durationMs={item.durationMs} />
          : <ToolActivityRow key={item.key} tool={item.tool} taskId={taskId} onRevert={onRevert} />
      ))}
    </div>
  );
});

const AssistantTurnBody = React.memo(function AssistantTurnBody({ batch, taskId, onRevert, silentToolSteps = false, activeTurn = false }) {
  const segments = useMemo(() => buildTurnSegments(batch, silentToolSteps), [batch, silentToolSteps]);
  return (
    <div className="turn-flow">
      {segments.map(seg => {
        if (seg.kind === 'activity') {
          return <ActivityStreamBlock key={seg.key} items={seg.items} taskId={taskId} onRevert={onRevert} activeTurn={activeTurn} />;
        }
        return (
          <div key={seg.key} id={'message-' + seg.id} tabIndex={-1} className="turn-prose">
            {seg.content && <MarkdownRenderer text={seg.content} />}
            {seg.media?.length > 0 && <ChatMediaCard items={seg.media} />}
            {seg.attachments?.length > 0 && <Attachments items={seg.attachments} />}
            {seg.sources?.length > 0 && (
              <details className="sources-box">
                <summary>Cited sources ({seg.sources.length})</summary>
                <ol>
                  {seg.sources.map(src => (
                    <li key={src.url}><a href={src.url} onClick={e => { e.preventDefault(); void api('openExternal', { url: src.url }); }}>{src.title || src.url}</a></li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
});

export default function ChatView({
  state, task, currentProject, projectId, workspace, setWorkspace,
  models, draftManager, draftKey, loaded, setLoaded,
  act, notify, openTask, navigate, overlayOpen = false,
}) {
  const s = state.settings;
  const draft = draftManager.get(draftKey);
  const prompt = draft.text;
  const pendingAttachments = draft.attachments || [];

  const [tab, setTab] = useState('chat');
  const [drawer, setDrawer] = useState(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [stick, setStick] = useState(true);
  const [targetMsg, setTargetMsg] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [autoIdx, setAutoIdx] = useState(0);
  const [liveDelta, setLiveDelta] = useState(null);
  const [showAllTurns, setShowAllTurns] = useState(false);
  const [spawnModal, setSpawnModal] = useState(null);
  const [msgModal, setMsgModal] = useState(null);
  const [newEphemeral, setNewEphemeral] = useState(false);
  const [newAdminMode, setNewAdminMode] = useState(false);

  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const textareaRef = useRef(null);
  const stickRef = useRef(true);
  stickRef.current = stick;

  const activeWorkspace = task?.workspace || currentProject?.workspace || draft.workspace || workspace || '';
  const conversation = loaded.id === task?.id ? loaded.conversation : (task?.conversation || []);
  const events = loaded.id === task?.id ? loaded.events : (task?.events || []);
  const conversationStart = loaded.id === task?.id ? loaded.conversationStart : (task?.conversationStart || 0);
  const eventsStart = loaded.id === task?.id ? loaded.eventsStart : (task?.eventsStart || 0);

  useEffect(() => {
    setLiveDelta(null);
    setShowAllTurns(false);
    if (!task?.id || !window.nexus?.subscribeDelta) return;
    return window.nexus.subscribeDelta(delta => {
      if (delta?.taskId === task.id) setLiveDelta(delta);
    });
  }, [task?.id]);

  useEffect(() => {
    if (!task) { setLiveDelta(null); return; }
    if (!['running', 'approval', 'queued'].includes(task.status) && !task.compacting) {
      setLiveDelta(null);
    } else if (liveDelta && task.liveText === '' && !task.liveActivity && conversation.length > 0) {
      setLiveDelta(null);
    }
  }, [task?.status, task?.compacting, conversation.length]);

  const matchedDelta = (task?.id && liveDelta?.taskId === task.id) ? liveDelta : null;
  const effectiveLiveText = matchedDelta?.liveText || task?.liveText || '';
  const effectiveLiveReasoning = matchedDelta?.liveReasoning || task?.liveReasoning || '';
  const effectiveLiveReasoningStartedAt = matchedDelta?.liveReasoningStartedAt || task?.liveReasoningStartedAt || null;
  const effectiveLiveActivity = matchedDelta?.liveActivity || task?.liveActivity || '';
  const effectiveLiveSubagents = (matchedDelta?.liveSubagents?.length ? matchedDelta.liveSubagents : task?.liveSubagents) || [];
  const isRunning = Boolean(task && (task.compacting || ['running', 'approval', 'queued'].includes(task.status)));

  const setPrompt = text => draftManager.update(draftKey, { text });

  useEffect(() => {
    if (!activeWorkspace) { setWorkspaceFiles([]); return; }
    let live = true;
    api('fileTree', { workspace: activeWorkspace, limit: 350 })
      .then(res => { if (live) setWorkspaceFiles(res?.matches || []); })
      .catch(() => {});
    return () => { live = false; };
  }, [activeWorkspace]);

  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && task && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        setDrawer(d => (d === 'search' ? null : 'search'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [task]);

  useEffect(() => {
    const content = contentRef.current;
    const container = scrollRef.current;
    if (!content || !container) return;
    const scrollIfStuck = () => {
      if (stickRef.current) container.scrollTop = container.scrollHeight;
    };
    const observer = new ResizeObserver(scrollIfStuck);
    observer.observe(content);
    scrollIfStuck();
    return () => observer.disconnect();
  }, [task?.id, tab]);

  useEffect(() => {
    setTargetMsg(null);
    setTab('chat');
    stickRef.current = true;
    setStick(true);
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
  }, [task?.id]);

  useLayoutEffect(() => {
    if (!targetMsg) return;
    const el = document.getElementById('message-' + targetMsg);
    if (el) { el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); }
  }, [targetMsg, loaded.windowed]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(200, Math.max(48, el.scrollHeight)) + 'px';
  }, [prompt, task?.id]);

  const autocomplete = useMemo(() => {
    const trimmed = prompt.trimStart();
    if (trimmed.startsWith('/') && !trimmed.includes(' ') && !trimmed.includes('\n')) {
      const needle = trimmed.toLowerCase();
      const all = [
        ...BUILTIN_SLASH_COMMANDS,
        ...(s.customCommands || []).map(c => ({ command: c.command, description: c.description || 'Custom command', mode: c.mode })),
      ];
      const matches = all.filter(c => c.command.toLowerCase().startsWith(needle));
      return matches.length ? { kind: 'slash', token: trimmed, items: matches.slice(0, 10) } : null;
    }
    const atMatch = /(?:^|\s)@([^\s]*)$/.exec(prompt);
    if (atMatch) {
      const q = atMatch[1].toLowerCase();
      const specials = [
        { command: '@git', description: 'Reference current Git status and working tree diff' },
        { command: '@diagnostics', description: 'Reference workspace syntax & JSON diagnostics' },
        { command: '@memories', description: 'Reference persistent project & global memories' },
      ];
      const fileItems = workspaceFiles
        .filter(f => !q || f.toLowerCase().includes(q))
        .slice(0, 10)
        .map(f => ({ command: '@' + f, description: 'Workspace file' }));
      const items = [...specials.filter(x => !q || x.command.includes(q)), ...fileItems].slice(0, 12);
      return items.length ? { kind: 'mention', token: '@' + atMatch[1], items } : null;
    }
    return null;
  }, [prompt, s.customCommands, workspaceFiles]);

  const applyAutocomplete = item => {
    if (!autocomplete || !item) return;
    if (autocomplete.kind === 'slash') {
      setPrompt(item.command + ' ');
    } else {
      const idx = prompt.lastIndexOf(autocomplete.token);
      if (idx >= 0) setPrompt(prompt.slice(0, idx) + item.command + ' ');
    }
    setAutoIdx(0);
    textareaRef.current?.focus();
  };

  const attachLocalFiles = async filesList => {
    if (!filesList?.length) return;
    setUploading(true);
    try {
      const added = [];
      for (const file of filesList) {
        const base64 = await fileToBase64(file);
        added.push(await api('uploadAttachment', { name: file.name, base64 }));
      }
      if (added.length) draftManager.update(draftKey, { attachments: [...draftManager.get(draftKey).attachments, ...added] });
    } catch (e) { notify(cleanError(e), 'error'); }
    finally { setUploading(false); }
  };

  const chooseAttachments = async () => {
    setUploading(true);
    try {
      const res = await api('chooseAttachments');
      if (res?.attachments?.length) draftManager.update(draftKey, { attachments: [...draftManager.get(draftKey).attachments, ...res.attachments] });
      if (res?.errors?.length) notify(res.errors.join('\n'), 'error');
    } catch (e) { notify(cleanError(e), 'error'); }
    finally { setUploading(false); }
  };

  const removeAttachment = id => draftManager.update(draftKey, { attachments: draftManager.get(draftKey).attachments.filter(a => a.id !== id) });

  const goLatest = () => {
    setTargetMsg(null);
    setLoaded(prev => prev.id !== task?.id ? prev : { ...prev, windowed: false, conversation: task.conversation || prev.conversation, conversationStart: task.conversationStart || 0, conversationEnd: task.conversationTotal });
    stickRef.current = true;
    setStick(true);
    setTab('chat');
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
  };

  const jumpMessage = async messageId => {
    const page = await act('messageWindow', { id: task.id, messageId });
    if (!page) return;
    stickRef.current = false;
    setStick(false);
    setTab('chat');
    setLoaded(prev => ({ ...prev, id: task.id, windowed: true, conversation: page.items, conversationStart: page.start, conversationEnd: page.end }));
    setTargetMsg(messageId);
  };

  const loadOlder = async collection => {
    if (!task) return;
    const before = collection === 'conversation' ? conversationStart : eventsStart;
    const page = await act('taskPage', { id: task.id, collection, before, limit: 120 });
    if (!page) return;
    setLoaded(prev => prev.id !== task.id ? prev : collection === 'conversation'
      ? { ...prev, conversation: [...page.items, ...prev.conversation], conversationStart: page.start }
      : { ...prev, events: [...page.items, ...prev.events], eventsStart: page.start });
  };

  const submit = async e => {
    e.preventDefault();
    if (busy || uploading || (!prompt.trim() && !pendingAttachments.length)) return;
    const rev = draft.revision;
    setBusy(true);
    try {
      const attachmentIds = pendingAttachments.map(a => a.id);
      await draftManager.flush();
      if (task) {
        await api('resume', { id: task.id, instruction: prompt, attachmentIds });
      } else {
        const id = await api('createTask', { prompt, attachmentIds, workspace: activeWorkspace, projectId: projectId || null, ephemeral: newEphemeral, adminMode: newAdminMode });
        if (newEphemeral) setNewEphemeral(false);
        if (newAdminMode) setNewAdminMode(false);
        openTask(id);
      }
      await draftManager.clear(draftKey, rev).catch(() => {});
      if (task) goLatest();
      else { stickRef.current = true; setStick(true); }
    } catch (err) {
      notify(cleanError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRevert = useCallback(async (taskId, eventId) => {
    const res = await act('revertFileChange', { id: taskId, eventId });
    if (res?.reverted) notify(`Reverted ${res.path} to its automatic backup.`, 'ok');
  }, [act, notify]);

  const handleFork = async messageId => {
    const res = await act('forkTask', { id: task.id, messageId });
    if (res?.id) {
      openTask(res.id);
      notify('Forked conversation into a new independent branch.', 'ok');
    }
  };

  const handleRegenerate = async () => {
    const ok = await act('regenerate', { id: task.id });
    if (ok) notify('Regenerating assistant response…', 'ok');
  };

  const handleEditSave = async e => {
    e.preventDefault();
    if (!editingMsg?.content?.trim()) return;
    const ok = await act('editMessage', { id: task.id, messageId: editingMsg.id, content: editingMsg.content });
    if (ok) { setEditingMsg(null); notify('Rewound conversation and sent edited prompt.', 'ok'); }
  };

  const effectiveWindow = task?.contextWindow || s.contextWindow || 50000;
  const ctxPct = task ? Math.min(100, Math.round(((task.contextTokens || 0) / Math.max(1, effectiveWindow)) * 100)) : 0;
  const approvals = (state.approvals || []).filter(a => task && a.taskId === task.id);

  const groupedTurns = useMemo(
    () => groupConversationTurns(tab === 'pins' ? conversation.filter(m => m.pinned) : conversation, isRunning),
    [conversation, tab, isRunning]
  );

  const TURN_WINDOW = 40;
  const hiddenTurnCount = !showAllTurns && groupedTurns.length > TURN_WINDOW ? groupedTurns.length - TURN_WINDOW : 0;
  const visibleTurns = hiddenTurnCount > 0 ? groupedTurns.slice(hiddenTurnCount) : groupedTurns;

  const lastTurnIsActiveAssistant = groupedTurns.length > 0 && groupedTurns[groupedTurns.length - 1].kind === 'assistant' && isRunning;

  return (
    <div className="chat-layout">
      <div className="chat-column">
        <div className="chat-subbar">
          {task ? (
            <div className="tab-strip" role="tablist">
              {[['chat', 'Chat'], ['activity', 'Activity'], ['memory', 'Continuity'], ['pins', 'Pinned']].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
              ))}
            </div>
          ) : (
            <span className="hint" style={{ fontSize: 12 }}>New Session</span>
          )}
          <div className="row" style={{ gap: 4 }}>
            {task && <span className={`pill ${task.status}`}>{STATUS_LABELS[task.status] || task.status}</span>}
            {task && (
              <SessionMetricsPopover
                task={task}
                effectiveWindow={effectiveWindow}
                isRunning={isRunning}
                act={act}
                notify={notify}
                onOpenInspector={() => setModal('inspector')}
                onOpenChange={setMetricsOpen}
                compact={Boolean(browserOpen || drawer)}
              />
            )}
            <button
              type="button"
              className="btn-icon"
              aria-label="Toggle integrated browser side panel"
              aria-pressed={browserOpen}
              title="Toggle Integrated Browser Side Panel (Account or InPrivate)"
              onClick={() => { setBrowserOpen(v => !v); if (!browserOpen) setDrawer(null); }}
            >
              <Globe size={15} style={browserOpen ? { color: 'var(--accent)' } : undefined} />
            </button>
            {task && (
              <button
                type="button"
                className={`filter-chip ${task.ephemeral ? 'ram-chip-active' : ''}`}
                style={{ padding: '3px 8px', fontSize: 11 }}
                title={task.ephemeral
                  ? 'RAM-Only Session (zero disk traces). Click to migrate & persist as Regular session.'
                  : 'Regular Persistent Session. Click to live-migrate to RAM-Only and immediately purge disk traces.'}
                onClick={async () => {
                  const next = !task.ephemeral;
                  const res = await act('setSessionEphemeral', { id: task.id, ephemeral: next });
                  if (res) notify(next ? 'Migrated session to RAM-Only and purged disk traces.' : 'Migrated session to Regular persistent storage.', 'ok');
                }}
              >
                <Ghost size={11} /> {task.ephemeral ? 'RAM-Only' : 'Regular'}
              </button>
            )}
            {task && (
              <button
                type="button"
                className={`filter-chip ${task.adminMode ? 'admin-chip-active' : ''}`}
                style={{ padding: '3px 8px', fontSize: 11 }}
                title={task.adminMode
                  ? 'Windows Administrator Rights ENABLED (single-UAC persistent elevated worker — no repeated Windows prompts). Click to revoke.'
                  : 'Standard user privileges. Click to grant Windows Administrator rights (prompts Windows UAC once, then reuses elevated session automatically).'}
                onClick={async () => {
                  const next = !task.adminMode;
                  if (await act('updateChat', { id: task.id, adminMode: next })) {
                    notify(next ? 'Admin Rights enabled — Windows will ask UAC once on first elevated command, then run automatically without repeated popups.' : 'Revoked Admin Rights for this session.', 'info');
                  }
                }}
              >
                <ShieldAlert size={11} /> {task.adminMode ? 'Admin ON' : 'Admin'}
              </button>
            )}
            {task && <button type="button" className="btn-icon" title="Spawn nested child session" onClick={() => setSpawnModal({ title: '', prompt: '', notifyParentOnIdle: true, ephemeral: Boolean(task.ephemeral), adminMode: false })}><Layers size={15} /></button>}
            {task && <button type="button" className="btn-icon" title="Search in chat · Ctrl+F" aria-label="Search in chat" aria-pressed={drawer === 'search'} onClick={() => { setBrowserOpen(false); setDrawer(d => d === 'search' ? null : 'search'); }}><Search size={15} /></button>}
            <button type="button" className="btn-icon" aria-label="Workspace drawer" aria-pressed={drawer === 'files' || drawer === 'shell' || drawer === 'results'} title="Split Files / Results / Shell" onClick={() => { setBrowserOpen(false); setDrawer(d => d ? null : 'files'); }}><PanelRight size={15} /></button>
            {task && <button type="button" className="btn-icon" title={task.pinned ? 'Unpin chat' : 'Pin chat'} onClick={() => act('updateChat', { id: task.id, pinned: !task.pinned })}><Pin size={15} fill={task.pinned ? 'currentColor' : 'none'} /></button>}
            {task && <button type="button" className="btn-icon" title="Chat settings" onClick={() => setModal('chat')}><Settings2 size={15} /></button>}
            {task && <button type="button" className="btn-icon" title="Export Markdown" onClick={() => act('exportTask', { id: task.id })}><Download size={15} /></button>}
            {task && (isRunning
              ? <button type="button" className="btn-icon" title="Pause" onClick={() => act('pause', { id: task.id })}><Pause size={15} /></button>
              : task.status !== 'complete' && <button type="button" className="btn-icon" title="Resume" onClick={() => act('resume', { id: task.id })}><Play size={15} /></button>)}
          </div>
        </div>

        {task && (() => {
          const parentSession = task.parentTaskId ? (state.tasks || []).find(t => t.id === task.parentTaskId) : null;
          const childSessions = (state.tasks || []).filter(t => t.parentTaskId === task.id);
          if (!parentSession && !childSessions.length) return null;
          return (
            <div className="subagent-banner" style={{ flexWrap: 'wrap', gap: 6 }}>
              <Layers size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              {parentSession && (
                <button type="button" className="btn-secondary" style={{ fontSize: 11.5, padding: '2px 8px' }} onClick={() => openTask(parentSession.id)}>
                  ↑ Parent: {parentSession.title}
                </button>
              )}
              {childSessions.length > 0 && (
                <>
                  <strong style={{ fontSize: 11.5 }}>Nested Sessions:</strong>
                  {childSessions.map(c => (
                    <div key={c.id} className="row" style={{ gap: 2 }}>
                      <button type="button" className="btn-secondary" style={{ fontSize: 11.5, padding: '2px 8px', gap: 5 }} onClick={() => openTask(c.id)}>
                        <i className={`status-dot ${c.status}`} /> {c.title}
                      </button>
                      <button type="button" className="btn-icon" style={{ width: 22, height: 22 }} title={`Send message to ${c.title}`} onClick={() => setMsgModal({ targetId: c.id, targetTitle: c.title, message: '' })}>
                        <ArrowUp size={11} />
                      </button>
                    </div>
                  ))}
                </>
              )}
              <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: '2px 8px', marginLeft: 'auto' }} onClick={() => setSpawnModal({ title: '', prompt: '', notifyParentOnIdle: true })}>
                <Plus size={11} /> Spawn Child
              </button>
            </div>
          );
        })()}

        {task?.todos?.length > 0 && <TodoTracker todos={task.todos} />}

        {effectiveLiveSubagents.length > 0 && (
          <div className="subagent-banner">
            <Cpu size={14} className="spin" />
            <strong>Active Sub-Agents:</strong>
            {effectiveLiveSubagents.map(sub => (
              <span key={sub.id} className="pill info">[{sub.mode}] Step {sub.step}/{sub.maxSteps} · {sub.objective}</span>
            ))}
          </div>
        )}

        <div
          className="chat-scroll"
          ref={scrollRef}
          onScroll={e => {
            const el = e.currentTarget;
            const nearBottom = !loaded.windowed && (el.scrollHeight - el.scrollTop - el.clientHeight < 110);
            stickRef.current = nearBottom;
            setStick(nearBottom);
          }}
        >
          {!task ? (
            <div className="welcome">
              <div className="welcome-badge">N</div>
              <h1>What are we building today?</h1>
              <p>Autonomous local agentic workstation. Native Windows desktop. Unrestricted environment, Private Browser & multi-provider freedom.</p>
              <div className="welcome-grid">
                {[
                  ['Audit & Refactor Codebase', 'Inspect architecture, find bugs, refactor cleanly, and verify with tests.', '/review Focus on architecture, edge cases, and performance'],
                  ['Architect a Feature', 'Explore files with dir_tree & code_outline and generate a step-by-step plan.', '/architect '],
                  ['Launch Private Browser', 'Browse & search privately via Tor / SOCKS5 / VPN with tracker blocking.', '__BROWSER__'],
                  ['Launch Multi-Model Arena', 'Run the same challenge across 2–4 models side-by-side.', '__ARENA__'],
                ].map(([title, desc, value]) => (
                  <button key={title} type="button" className="welcome-card" onClick={() => value === '__ARENA__' ? navigate('arena') : value === '__BROWSER__' ? navigate('browser') : setPrompt(value)}>
                    <strong>{title}</strong>
                    <span>{desc}</span>
                  </button>
                ))}
              </div>
              {!state.hasKey && (
                <button type="button" className="btn-primary" style={{ marginTop: 22 }} onClick={() => navigate('settings')}>
                  Configure Provider Connection
                </button>
              )}
            </div>
          ) : (
            <div className="conversation" ref={contentRef}>
              {(tab === 'chat' || tab === 'pins') && (
                <>
                  {loaded.windowed && (
                    <div className="panel-card row-between" style={{ padding: '10px 14px' }}>
                      <span className="hint">Viewing an archived history slice.</span>
                      <button type="button" className="btn-secondary" onClick={goLatest}>Return to latest</button>
                    </div>
                  )}
                  {tab === 'chat' && conversationStart > 0 && (
                    <button type="button" className="btn-secondary" style={{ marginBottom: 16 }} onClick={() => loadOlder('conversation')}>Load earlier messages</button>
                  )}
                  {hiddenTurnCount > 0 && (
                    <button type="button" className="btn-secondary" style={{ marginBottom: 14, width: '100%' }} onClick={() => setShowAllTurns(true)}>
                      Show {hiddenTurnCount} earlier turns (windowed for 60 FPS performance)
                    </button>
                  )}

                  {visibleTurns.map((turn, tIdx) => {
                    if (turn.kind === 'user') {
                      const m = turn.message;
                      return (
                        <article key={m.id} id={'message-' + m.id} tabIndex={-1} className={`message user ${targetMsg === m.id ? 'search-target' : ''}`}>
                          <div className="message-head">
                            <strong>YOU</strong>
                            {m.pinned && <span className="pill ok"><Pin size={10} /> Pinned</span>}
                          </div>
                          {m.content && <MarkdownRenderer text={m.content} />}
                          {m.attachments?.length > 0 && (() => {
                            const richItems = m.attachments
                              .filter(a => a.kind === 'image' || /\.(mp4|webm|mov|mkv|mp3|wav|ogg|pdf)$/i.test(a.name || ''))
                              .map(a => {
                                const ext = (a.name || '').match(/\.[^.]+$/)?.[0]?.toLowerCase() || '';
                                const kind = a.kind === 'image' ? 'image'
                                  : /\.(mp4|webm|mov|mkv)$/i.test(ext) ? 'video'
                                  : /\.(mp3|wav|ogg)$/i.test(ext) ? 'audio' : 'pdf';
                                return { id: a.id, mediaId: 'att-' + a.id, kind, mime: a.mime, ext, name: a.name, title: a.name, bytes: a.bytes };
                              });
                            return (
                              <>
                                {richItems.length > 0 && <ChatMediaCard items={richItems} />}
                                <Attachments items={m.attachments} />
                              </>
                            );
                          })()}
                          <div className="message-actions">
                            {m.content && <CopyButton text={m.content} label="Copy" compact />}
                            <button type="button" onClick={() => act('pinMessage', { id: task.id, messageId: m.id, pinned: !m.pinned })}><Pin size={12} /> {m.pinned ? 'Unpin' : 'Pin'}</button>
                            <button type="button" onClick={() => handleFork(m.id)}><GitFork size={12} /> Fork</button>
                            {!isRunning && <button type="button" onClick={() => setEditingMsg({ id: m.id, content: m.content || '' })}><Pencil size={12} /> Edit</button>}
                          </div>
                        </article>
                      );
                    }

                    const m = turn.primary;
                    const isLastTurn = tIdx === visibleTurns.length - 1;
                    const showLiveInsideThisTurn = isLastTurn && lastTurnIsActiveAssistant && tab === 'chat' && !loaded.windowed;

                    return (
                      <article key={turn.id} id={'message-' + m.id} tabIndex={-1} className={`message assistant ${targetMsg === m.id ? 'search-target' : ''}`}>
                        <div className="message-head">
                          <div className="row" style={{ gap: 8 }}>
                            <strong>NEXUS</strong>
                            {showLiveInsideThisTurn && (
                              <span className="working-pill">
                                {task.compacting ? 'Compacting' : (effectiveLiveActivity || 'Working')}
                                <span className="working-dots"><i /><i /><i /></span>
                              </span>
                            )}
                          </div>
                          <div className="row" style={{ gap: 6 }}>
                            {m.recovered && <span className="pill warn">Recovered · incomplete</span>}
                            {m.pinned && <span className="pill ok"><Pin size={10} /> Pinned</span>}
                          </div>
                        </div>

                        <AssistantTurnBody batch={turn.batch} taskId={task.id} onRevert={handleRevert} silentToolSteps={Boolean(s.silentToolSteps)} activeTurn={turn.activeTurn} />

                        {showLiveInsideThisTurn && (
                          <div className="live-continuation">
                            {effectiveLiveReasoning && <ReasoningBlock text={effectiveLiveReasoning} startedAt={effectiveLiveReasoningStartedAt} live />}
                            {effectiveLiveText && <StreamingMarkdown text={effectiveLiveText} />}
                          </div>
                        )}

                        {!showLiveInsideThisTurn && (
                          <div className="message-actions">
                            {m.content && <CopyButton text={m.content} label="Copy" compact />}
                            <button type="button" onClick={() => act('pinMessage', { id: task.id, messageId: m.id, pinned: !m.pinned })}><Pin size={12} /> {m.pinned ? 'Unpin' : 'Pin'}</button>
                            <button type="button" onClick={() => handleFork(m.id)}><GitFork size={12} /> Fork</button>
                            {isLastTurn && !isRunning && <button type="button" onClick={handleRegenerate}><RefreshCw size={12} /> Regenerate</button>}
                            {m.telemetry && (
                              <span className="message-meta">
                                {formatMoney(m.telemetry.cost)} · {formatCount(m.telemetry.total)} tok
                                {m.telemetry.cached > 0 && m.telemetry.input > 0 ? ` · ${Math.round((m.telemetry.cached / m.telemetry.input) * 100)}% cached` : ''}
                              </span>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}

                  {tab === 'chat' && !loaded.windowed && isRunning && !lastTurnIsActiveAssistant && (
                    <article className="message assistant live">
                      <div className="message-head">
                        <div className="row" style={{ gap: 8 }}>
                          <strong>NEXUS</strong>
                          <span className="working-pill">
                            {task.compacting ? 'Compacting context' : (effectiveLiveActivity || 'Thinking')}
                            <span className="working-dots"><i /><i /><i /></span>
                          </span>
                        </div>
                      </div>
                      {effectiveLiveReasoning && <ReasoningBlock text={effectiveLiveReasoning} startedAt={effectiveLiveReasoningStartedAt} live />}
                      {effectiveLiveText && <StreamingMarkdown text={effectiveLiveText} />}
                    </article>
                  )}
                </>
              )}

              {tab === 'activity' && (
                <div style={{ display: 'grid', gap: 10 }}>
                  {task.effects?.length > 0 && (
                    <section className="panel-card">
                      <h3>External Side Effects Ledger ({task.effects.length})</h3>
                      <p className="hint">Uncertain external effects are never silently replayed on restart.</p>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {task.effects.slice().reverse().map(eff => (
                          <details key={eff.id} className="tool-card">
                            <summary className="tool-card-head" style={{ listStyle: 'none' }}>
                              <span className="tool-name">{eff.tool}</span>
                              <span className={`pill ${eff.status === 'observed' || eff.status === 'confirmed' ? 'ok' : eff.status === 'uncertain' ? 'warn' : ''}`}>{eff.status}</span>
                              <span className="tool-dur">{new Date(eff.updatedAt).toLocaleTimeString()}</span>
                            </summary>
                            <div className="tool-card-body"><pre>{prettyJson(eff)}</pre></div>
                          </details>
                        ))}
                      </div>
                    </section>
                  )}
                  {eventsStart > 0 && <button type="button" className="btn-secondary" onClick={() => loadOlder('events')}>Load earlier events</button>}
                  {events.slice().reverse().map(ev => (
                    <details key={ev.id} className="tool-card">
                      <summary className="tool-card-head" style={{ listStyle: 'none' }}>
                        <span className="tool-name">{ev.kind}</span>
                        <span className="tool-arg-preview">{ev.detail?.name || ev.detail?.path || ''}</span>
                        <span className="tool-dur">{new Date(ev.at).toLocaleTimeString()}</span>
                      </summary>
                      <div className="tool-card-body"><pre>{prettyJson(ev.detail)}</pre></div>
                    </details>
                  ))}
                </div>
              )}

              {tab === 'memory' && (
                <section className="panel-card">
                  <h2>Continuity State & Checkpoints</h2>
                  <p className="hint">Compaction preserves complete original history in checkpoints on disk. Pinned messages are always injected verbatim.</p>
                  <div style={{ margin: '14px 0' }}>
                    <MarkdownRenderer text={task.summary || '*This conversation has not been compacted yet.*'} />
                  </div>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <button type="button" className="btn-primary" disabled={isRunning} onClick={async () => { const r = await act('compact', { id: task.id }); if (r) notify('Compacted conversation into a new lossless checkpoint.', 'ok'); }}>Compact Now</button>
                    <button type="button" className="btn-secondary" disabled={isRunning} onClick={async () => { const r = await act('compact', { id: task.id, microOnly: true }); if (r) notify(r.micro?.prunedCount ? `Pruned ${r.micro.prunedCount} old tool outputs (~${r.micro.estimatedTokensFreed} tok freed, $0).` : 'No oversized old tool outputs to prune.', 'ok'); }}>Micro-Prune ($0)</button>
                    <button type="button" className="btn-secondary" onClick={() => act('openJournal', { id: task.id })}><FolderOpen size={14} /> Open Journal Folder</button>
                    <button type="button" className="btn-secondary" onClick={() => setModal('inspector')}><Activity size={14} /> Inspect Context & Checkpoints</button>
                  </div>
                </section>
              )}

              {task.error && (
                <div className="panel-card" style={{ borderColor: 'var(--err-fg)', color: 'var(--err-fg)' }}>
                  <strong>Session Notice</strong>
                  <p style={{ margin: '6px 0 0', fontSize: 13 }}>{task.error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {task && !stick && tab === 'chat' && (
          <div className="jump-btn-wrap">
            <button type="button" className="jump-btn" onClick={goLatest}><ArrowDown size={14} /> Jump to latest</button>
          </div>
        )}

        {approvals.map(a => (
          <div key={a.id} className={`approval-card ${a.criticalSelfEdit ? 'critical-self-edit' : ''}`}>
            <div className="row-between" style={{ flexWrap: 'wrap' }}>
              <div>
                <div className="row">
                  <span className={`pill ${a.criticalSelfEdit ? 'err' : 'warn'}`}>
                    {a.criticalSelfEdit ? 'NEXUS Self-Edit Protection' : 'Approval Required'}
                  </span>
                  <strong className="mono" style={{ fontSize: 13 }}>{a.name}</strong>
                </div>
                {a.reason && <small className="hint" style={{ display: 'block', marginTop: 4, color: a.criticalSelfEdit ? 'var(--err-fg)' : undefined }}>{a.reason}</small>}
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn-primary" onClick={() => act('approve', { id: a.id, allowed: true })}>
                  <Check size={14} /> {a.criticalSelfEdit ? 'Approve Once' : 'Execute'}
                </button>
                {!a.criticalSelfEdit && a.suggestedPattern && (
                  <button
                    type="button"
                    className="btn-secondary"
                    title={`Save "${a.suggestedPattern}" to Semi-Autopilot allow rules permanently`}
                    onClick={() => act('approve', { id: a.id, allowed: true, alwaysAllowPattern: a.suggestedPattern })}
                  >
                    Always Allow: <code style={{ fontSize: 11 }}>{a.suggestedPattern}</code>
                  </button>
                )}
                {!a.criticalSelfEdit && (
                  <button type="button" className="btn-secondary" onClick={() => act('approve', { id: a.id, allowed: true, allowSession: true })}>Allow All This Session</button>
                )}
                <button type="button" className="btn-danger" onClick={() => act('approve', { id: a.id, allowed: false })}><X size={14} /> Decline</button>
              </div>
            </div>
            <pre>{prettyJson(a.args)}</pre>
          </div>
        ))}

        <div className="composer-wrap">
          <ComposerControls task={task} settings={s} models={models} providerKeys={state.providerKeys} act={act} onOpenChange={setModelPickerOpen} />

          <form
            className={`composer-box ${dragOver ? 'drag-over' : ''}`}
            onSubmit={submit}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); void attachLocalFiles([...(e.dataTransfer?.files || [])]); }}
          >
            {autocomplete && (
              <div className="autocomplete-pop" role="listbox" aria-label="Suggestions">
                {autocomplete.items.map((item, idx) => (
                  <button
                    key={item.command}
                    type="button"
                    className={`autocomplete-item ${idx === autoIdx ? 'active' : ''}`}
                    onMouseEnter={() => setAutoIdx(idx)}
                    onClick={() => applyAutocomplete(item)}
                  >
                    <strong>{item.command}</strong>
                    <small>{item.description}</small>
                  </button>
                ))}
              </div>
            )}

            <Attachments items={pendingAttachments} remove={removeAttachment} disabled={busy || uploading} />

            <textarea
              ref={textareaRef}
              disabled={busy}
              aria-label="Message"
              placeholder={task ? (isRunning ? 'Steer or queue a follow-up for the next step…' : 'Continue the conversation… (type / for commands, @ for files)') : 'Ask, architect, code, or automate anything… (/ commands · @ files · drop or paste images)'}
              value={prompt}
              onChange={e => { setPrompt(e.target.value); setAutoIdx(0); }}
              onPaste={e => {
                const files = [...(e.clipboardData?.files || [])];
                if (files.length) { e.preventDefault(); void attachLocalFiles(files); }
              }}
              onKeyDown={e => {
                if (autocomplete) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setAutoIdx(i => (i + 1) % autocomplete.items.length); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setAutoIdx(i => (i - 1 + autocomplete.items.length) % autocomplete.items.length); return; }
                  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); applyAutocomplete(autocomplete.items[autoIdx]); return; }
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!busy) e.currentTarget.form.requestSubmit();
                }
              }}
            />

            <div className="composer-foot">
              <div className="row" style={{ minWidth: 0 }}>
                <button type="button" className="btn-icon" aria-label="Attach files" title="Attach files or images (or paste/drag-drop)" disabled={busy || uploading} onClick={chooseAttachments}><Plus size={17} /></button>
                <button
                  type="button"
                  className="workspace-chip"
                  title="Choose local workspace folder"
                  onClick={async () => {
                    const p = await act('chooseWorkspace');
                    if (p) {
                      setWorkspace(p);
                      draftManager.update(draftKey, { workspace: p });
                      if (task && !isRunning) void act('updateChat', { id: task.id, workspace: p });
                    }
                  }}
                >
                  <FolderOpen size={14} style={{ color: activeWorkspace ? 'var(--accent)' : 'var(--ink-faint)', flexShrink: 0 }} />
                  <span>{activeWorkspace || 'Select workspace folder'}</span>
                </button>
                {!task && (
                  <>
                    <button
                      type="button"
                      className={`filter-chip ${newEphemeral ? 'ram-chip-active' : ''}`}
                      style={{ padding: '4px 8px', fontSize: 11.5 }}
                      title={newEphemeral ? 'New session will run RAM-Only (zero disk writes, vanishes on close)' : 'New session will save normally. Click for RAM-Only zero-trace mode.'}
                      onClick={() => setNewEphemeral(v => !v)}
                    >
                      <Ghost size={12} /> {newEphemeral ? 'RAM-Only' : 'Regular'}
                    </button>
                    <button
                      type="button"
                      className={`filter-chip ${newAdminMode ? 'admin-chip-active' : ''}`}
                      style={{ padding: '4px 8px', fontSize: 11.5 }}
                      title={newAdminMode ? 'New session will have Windows Administrator rights (VPN, services, firewall)' : 'Grant Windows Administrator privileges to this new session'}
                      onClick={() => setNewAdminMode(v => !v)}
                    >
                      <ShieldAlert size={12} /> {newAdminMode ? 'Admin ON' : 'Admin'}
                    </button>
                  </>
                )}
                {uploading && <span className="hint">Uploading…</span>}
              </div>

              <div className="row">
                {task && isRunning && (
                  <button type="button" className="stop-btn" aria-label="Pause response" title="Pause agent" onClick={() => act('pause', { id: task.id })}>
                    <Square size={12} fill="currentColor" />
                  </button>
                )}
                <button className="send-btn" aria-label="Send message" disabled={busy || uploading || (!prompt.trim() && !pendingAttachments.length)}>
                  <ArrowUp size={17} />
                </button>
              </div>
            </div>
          </form>

          <div className="composer-hints">
            <span>Type <code>/</code> for commands · <code>@</code> to mention files · Drop or paste images</span>
            <span>{draftManager.status[draftKey] === 'saving' ? 'Saving draft…' : draftManager.status[draftKey] === 'error' ? 'Draft save failed' : prompt ? 'Draft saved' : 'Enter send · Shift+Enter newline'}</span>
          </div>
        </div>
      </div>

      {browserOpen && (
        <BrowserSidePanel
          state={state}
          act={act}
          notify={notify}
          overlayOpen={Boolean(overlayOpen || modal || editingMsg || spawnModal || msgModal || metricsOpen || modelPickerOpen)}
          onSendToChat={text => {
            setPrompt(prompt ? `${prompt}\n\n${text}` : text);
            notify('Page content copied into your composer.', 'ok');
            textareaRef.current?.focus();
          }}
          onAttachScreenshot={(att, url) => {
            draftManager.update(draftKey, {
              attachments: [...draftManager.get(draftKey).attachments, att],
              text: prompt || `Inspect this screenshot from ${url}:`,
            });
          }}
          onExpandFull={() => { setBrowserOpen(false); navigate('browser'); }}
          onClose={() => setBrowserOpen(false)}
        />
      )}

      {drawer && (
        <ChatDrawer
          task={task}
          workspace={activeWorkspace}
          mode={drawer}
          setMode={setDrawer}
          close={() => setDrawer(null)}
          jump={jumpMessage}
          onInsertMention={token => { setPrompt(prompt ? `${prompt} ${token} ` : `${token} `); textareaRef.current?.focus(); }}
        />
      )}

      {modal === 'chat' && task && <ChatSettings task={task} state={state} act={act} close={() => setModal(null)} />}
      {modal === 'inspector' && task && <ContextInspectorModal taskId={task.id} close={() => setModal(null)} />}

      {editingMsg && (
        <Modal label="Edit Prompt & Rewind" close={() => setEditingMsg(null)}>
          <h2>Edit Message & Rewind</h2>
          <p className="hint">Rewinds this conversation to this turn and sends your revised prompt.</p>
          <form onSubmit={handleEditSave}>
            <textarea rows={6} value={editingMsg.content} onChange={e => setEditingMsg({ ...editingMsg, content: e.target.value })} required />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" className="btn-secondary" onClick={() => setEditingMsg(null)}>Cancel</button>
              <button className="btn-primary">Save & Re-Run</button>
            </div>
          </form>
        </Modal>
      )}

      {spawnModal && task && (
        <Modal label="Spawn Nested Child Session" close={() => setSpawnModal(null)}>
          <h2>Spawn Nested Child Session</h2>
          <p className="hint">Launches an independent concurrent child session nested under <strong>{task.title}</strong> inside the same project root.</p>
          <form onSubmit={async e => {
            e.preventDefault();
            if (!spawnModal.prompt.trim()) return;
            const res = await act('spawnChildSession', {
              parentId: task.id,
              title: spawnModal.title.trim() || undefined,
              prompt: spawnModal.prompt.trim(),
              notifyParentOnIdle: spawnModal.notifyParentOnIdle,
              ephemeral: Boolean(spawnModal.ephemeral),
              adminMode: Boolean(spawnModal.adminMode),
            });
            if (res?.sessionId) {
              setSpawnModal(null);
              notify(`Spawned child session "${res.title}".`, 'ok');
            }
          }}>
            <label className="field"><span>Title (optional)</span><input value={spawnModal.title} onChange={e => setSpawnModal({ ...spawnModal, title: e.target.value })} placeholder="e.g. Security Audit Worker" /></label>
            <label className="field"><span>Child Objective / Kickoff Prompt</span><textarea rows={4} required value={spawnModal.prompt} onChange={e => setSpawnModal({ ...spawnModal, prompt: e.target.value })} placeholder="Inspect auth middleware and report any edge cases…" /></label>
            <label className="switch-row">
              <div><strong>RAM-Only Ephemeral Child Session</strong><p>Runs strictly in RAM with zero disk traces (recommended for sensitive or high-risk subtasks).</p></div>
              <input type="checkbox" className="switch-input" checked={Boolean(spawnModal.ephemeral)} onChange={e => setSpawnModal({ ...spawnModal, ephemeral: e.target.checked })} />
            </label>
            <label className="switch-row">
              <div><strong>Grant Windows Administrator Rights</strong><p>Allows this child session to execute elevated commands (services, VPN adapters, firewall).</p></div>
              <input type="checkbox" className="switch-input" checked={Boolean(spawnModal.adminMode)} onChange={e => setSpawnModal({ ...spawnModal, adminMode: e.target.checked })} />
            </label>
            <label className="switch-row">
              <div><strong>Auto-Handoff on Completion</strong><p>Automatically send the child's final report back into this parent session when finished.</p></div>
              <input type="checkbox" className="switch-input" checked={spawnModal.notifyParentOnIdle} onChange={e => setSpawnModal({ ...spawnModal, notifyParentOnIdle: e.target.checked })} />
            </label>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn-secondary" onClick={() => setSpawnModal(null)}>Cancel</button>
              <button className="btn-primary"><Layers size={14} /> Spawn Child Session</button>
            </div>
          </form>
        </Modal>
      )}

      {msgModal && task && (
        <Modal label="Send Inter-Session Message" close={() => setMsgModal(null)}>
          <h2>Send Message to "{msgModal.targetTitle}"</h2>
          <p className="hint">Delivers a direct inter-session message and wakes the target session automatically.</p>
          <form onSubmit={async e => {
            e.preventDefault();
            if (!msgModal.message.trim()) return;
            const res = await act('sendSessionMessage', { fromId: task.id, sessionId: msgModal.targetId, message: msgModal.message.trim() });
            if (res?.delivered) {
              setMsgModal(null);
              notify(`Delivered message to "${msgModal.targetTitle}".`, 'ok');
            }
          }}>
            <textarea rows={4} required value={msgModal.message} onChange={e => setMsgModal({ ...msgModal, message: e.target.value })} placeholder="Focus specifically on edge cases in…" />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn-secondary" onClick={() => setMsgModal(null)}>Cancel</button>
              <button className="btn-primary"><ArrowUp size={14} /> Send Message</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
