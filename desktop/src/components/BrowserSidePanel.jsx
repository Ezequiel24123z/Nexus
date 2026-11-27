import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, RotateCw, Lock, Search, Send, Camera, X,
  Maximize2, Shield, UserCheck, Trash2, Globe, ExternalLink, Bot, Monitor
} from 'lucide-react';
import { cleanError } from '../lib/format.mjs';

const api = (method, args) => window.nexus.invoke(method, args);

const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', home: 'https://duckduckgo.com/', search: q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}&kp=-2` },
  startpage: { name: 'Startpage', home: 'https://www.startpage.com/', search: q => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}` },
  brave: { name: 'Brave Search', home: 'https://search.brave.com/', search: q => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
  qwant: { name: 'Qwant', home: 'https://www.qwant.com/', search: q => `https://www.qwant.com/?q=${encodeURIComponent(q)}` },
  searxng: { name: 'SearXNG', home: 'https://searx.be/', search: (q, base) => `${String(base || 'https://searx.be').replace(/\/+$/, '')}/search?q=${encodeURIComponent(q)}` },
};

function normalizeAddress(raw, engineId, searxUrl) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return SEARCH_ENGINES[engineId]?.home || 'https://duckduckgo.com/';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(trimmed)) return 'http://' + trimmed;
  if (!trimmed.includes(' ') && trimmed.includes('.')) return 'https://' + trimmed;
  const eng = SEARCH_ENGINES[engineId] || SEARCH_ENGINES.duckduckgo;
  return eng.search(trimmed, searxUrl);
}

export default function BrowserSidePanel({
  state, act, notify, overlayOpen,
  onSendToChat, onAttachScreenshot, onExpandFull, onClose,
}) {
  const s = state.settings;
  const native = Boolean(window.nexus?.nativeHost);
  const engineId = s.browserSearchEngine || 'duckduckgo';
  const persistent = Boolean(s.browserPersistentProfile);
  const proxyMode = s.browserProxyMode || 'direct';
  const proxyUrl = proxyMode === 'direct' ? ''
    : (proxyMode === 'wireguard' ? 'socks5://127.0.0.1:9060'
      : ((proxyMode === 'managed-tor' || proxyMode === 'wireguard-tor') ? 'socks5://127.0.0.1:9055'
        : (proxyMode === 'tor' ? (s.browserProxyUrl || 'socks5://127.0.0.1:9050') : (s.browserProxyUrl || ''))));
  const blockTrackers = s.browserBlockTrackers !== false;
  const antiFingerprint = s.browserAntiFingerprint !== false;

  const viewportRef = useRef(null);
  const [width, setWidth] = useState(520);
  const [viewMode, setViewMode] = useState(native ? 'standard' : 'agent');
  const [address, setAddress] = useState(SEARCH_ENGINES[engineId]?.home || 'https://duckduckgo.com/');
  const [bState, setBState] = useState({ url: address, title: 'NEXUS Browser', loading: false, blockedCount: 0, canGoBack: false, canGoForward: false });
  const [readerPage, setReaderPage] = useState(null);
  const [readerBusy, setReaderBusy] = useState(false);

  const shouldShowNative = native && viewMode === 'standard' && !overlayOpen;

  useEffect(() => {
    if (!native || !window.nexus?.subscribeBrowser) return;
    return window.nexus.subscribeBrowser(evt => {
      setBState(prev => ({ ...prev, ...evt }));
      if (evt.url) setAddress(evt.url);
    });
  }, [native]);

  useEffect(() => {
    if (!native) return;
    if (!shouldShowNative) {
      void api('browserHide').catch(() => {});
      return;
    }
    const syncBounds = (init = false) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect || rect.width < 120 || rect.height < 120) return;
      if (init) {
        void api('browserShow', {
          x: rect.left, y: rect.top, width: rect.width, height: rect.height,
          url: bState.url || SEARCH_ENGINES[engineId]?.home,
          proxyUrl, blockTrackers, antiFingerprint, persistent,
        }).catch(e => notify(cleanError(e), 'error'));
      } else {
        void api('browserBounds', { x: rect.left, y: rect.top, width: rect.width, height: rect.height }).catch(() => {});
      }
    };
    syncBounds(true);
    const obs = new ResizeObserver(() => syncBounds(false));
    if (viewportRef.current) obs.observe(viewportRef.current);
    const onResize = () => syncBounds(false);
    window.addEventListener('resize', onResize);
    return () => {
      obs.disconnect();
      window.removeEventListener('resize', onResize);
      void api('browserHide').catch(() => {});
    };
  }, [native, shouldShowNative, proxyUrl, blockTrackers, antiFingerprint, persistent]);

  const startResize = e => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = ev => {
      const next = Math.max(360, Math.min(860, startW + (startX - ev.clientX)));
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const navigateTo = async raw => {
    const url = normalizeAddress(raw, engineId, s.browserSearxUrl);
    setAddress(url);
    if (native && viewMode === 'standard') {
      await api('browserNavigate', { url });
    } else {
      setReaderBusy(true);
      try { setReaderPage(await api('agentBrowserSnapshot', { url, engine: 'agent-fast' })); }
      catch (err) { notify(cleanError(err), 'error'); }
      finally { setReaderBusy(false); }
    }
  };

  const sendPage = async () => {
    try {
      if (viewMode === 'agent' && readerPage) {
        onSendToChat(`Context from NEXUS Agent Browser:\n\n${(readerPage.agentSnapshot || readerPage.text || '').slice(0, 10000)}`);
        return;
      }
      const page = native ? await api('browserExtract') : readerPage;
      if (!page) { notify('Open a webpage first.', 'info'); return; }
      onSendToChat(`Context from NEXUS Browser:\nURL: ${page.url}\nTitle: ${page.title}\n\n${page.selection ? `Selection:\n${page.selection}\n\n` : ''}Content:\n${(page.text || '').slice(0, 8000)}`);
    } catch (e) { notify(cleanError(e), 'error'); }
  };

  const snapShot = async () => {
    if (!native) return;
    try {
      const shot = await api('browserScreenshot');
      if (shot?.base64) {
        const att = await api('uploadAttachment', { name: `browser-${Date.now()}.png`, base64: shot.base64 });
        if (att) {
          onAttachScreenshot(att, shot.url);
          notify('Browser screenshot attached to chat.', 'ok');
        }
      }
    } catch (e) { notify(cleanError(e), 'error'); }
  };

  return (
    <aside className="browser-side-panel" style={{ width }} aria-label="Integrated side browser">
      <div className="side-resizer" title="Drag to resize browser panel" onMouseDown={startResize} />
      <div className="browser-side-chrome">
        <div className="row-between" style={{ gap: 4, marginBottom: 6 }}>
          <div className="row" style={{ gap: 2 }}>
            <button type="button" className="btn-icon" style={{ width: 26, height: 26 }} title="Back" disabled={!native || !bState.canGoBack} onClick={() => api('browserBack')}><ArrowLeft size={13} /></button>
            <button type="button" className="btn-icon" style={{ width: 26, height: 26 }} title="Forward" disabled={!native || !bState.canGoForward} onClick={() => api('browserForward')}><ArrowRight size={13} /></button>
            <button type="button" className="btn-icon" style={{ width: 26, height: 26 }} title="Reload" onClick={() => native ? api('browserReload') : void navigateTo(address)}><RotateCw size={12} className={bState.loading || readerBusy ? 'spin' : ''} /></button>
          </div>

          <div className="row" style={{ gap: 4 }}>
            {native && (
              <button
                type="button"
                className={`filter-chip ${viewMode === 'agent' ? 'active' : ''}`}
                title={viewMode === 'agent' ? 'Agent View (@eN refs + Markdown). Click for Standard visual browser.' : 'Standard visual browser. Click for specialized Agent View (@eN refs).'}
                onClick={() => {
                  const next = viewMode === 'agent' ? 'standard' : 'agent';
                  setViewMode(next);
                  if (next === 'agent' && address) void navigateTo(address);
                }}
              >
                {viewMode === 'agent' ? <><Bot size={11} /> Agent</> : <><Monitor size={11} /> Visual</>}
              </button>
            )}
            <button
              type="button"
              className={`filter-chip ${persistent ? 'active' : ''}`}
              title={persistent
                ? 'Account Mode: saves logins & cookies inside NEXUS so you can sign into your accounts. Click to switch to zero-trace InPrivate.'
                : 'InPrivate Mode: ephemeral zero-trace session wiped on close. Click to switch to Account Mode to stay logged in.'}
              onClick={() => act('settings', { browserPersistentProfile: !persistent })}
            >
              {persistent ? <><UserCheck size={11} /> Account</> : <><Shield size={11} /> InPrivate</>}
            </button>
            <button type="button" className="btn-icon" style={{ width: 26, height: 26 }} title="Send page content to chat" onClick={sendPage}><Send size={12} /></button>
            {native && <button type="button" className="btn-icon" style={{ width: 26, height: 26 }} title="Attach screenshot to chat" onClick={snapShot}><Camera size={12} /></button>}
            <button type="button" className="btn-icon" style={{ width: 26, height: 26 }} title="Wipe cookies & cache" onClick={() => native ? api('browserWipe', { url: SEARCH_ENGINES[engineId]?.home, proxyUrl, blockTrackers, antiFingerprint, persistent }) : setReaderPage(null)}><Trash2 size={12} /></button>
            <button type="button" className="btn-icon" style={{ width: 26, height: 26 }} title="Open full browser & VPN/Proxy settings" onClick={onExpandFull}><Maximize2 size={12} /></button>
            <button type="button" className="btn-icon" style={{ width: 26, height: 26 }} title="Close side browser" onClick={onClose}><X size={13} /></button>
          </div>
        </div>

        <form className="browser-url-bar" onSubmit={e => { e.preventDefault(); void navigateTo(address); }}>
          <Lock size={12} style={{ color: address.startsWith('https://') ? 'var(--ok-fg)' : 'var(--ink-faint)', flexShrink: 0 }} />
          <input
            aria-label="Side browser URL or search"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Enter URL or search…"
          />
          <button type="submit" className="btn-icon" style={{ width: 22, height: 22 }}><Search size={12} /></button>
        </form>
      </div>

      {native && viewMode === 'standard' ? (
        <div ref={viewportRef} className="browser-side-viewport">
          <div className="hint row" style={{ fontSize: 12 }}>
            <Globe size={14} style={{ color: 'var(--accent)' }} />
            <span>{overlayOpen ? 'Browser paused while menu is open…' : (persistent ? 'Loading Account Browser…' : 'Loading InPrivate Browser…')}</span>
          </div>
        </div>
      ) : (
        <div className="side-drawer-body" style={{ flex: 1 }}>
          {readerPage ? (
            <div>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>{readerPage.title}</strong>
                <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: '3px 7px' }} onClick={() => api('openExternal', { url: readerPage.url })}><ExternalLink size={11} /> External</button>
              </div>
              {(readerPage.refs || []).length > 0 && (
                <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {readerPage.refs.slice(0, 12).map(r => (
                    <button key={r.ref} type="button" className="tag-chip mono" style={{ cursor: r.url ? 'pointer' : 'default' }} onClick={() => r.url && void navigateTo(r.url)}>
                      {r.ref} {(r.name || r.role).slice(0, 22)}
                    </button>
                  ))}
                </div>
              )}
              <pre className="pre-box" style={{ maxHeight: '66vh', whiteSpace: 'pre-wrap' }}>{readerPage.text}</pre>
            </div>
          ) : (
            <p className="hint">Enter a URL or .onion address above to inspect a page in Specialized Agent View (compact @eN refs + clean Markdown).</p>
          )}
        </div>
      )}
    </aside>
  );
}
