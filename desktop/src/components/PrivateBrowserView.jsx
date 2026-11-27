import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, RotateCw, Shield, ShieldCheck, Globe, Trash2,
  Camera, Send, Sliders, Lock, RefreshCw, Search, ExternalLink, UserCheck, Play, Square,
  Bot, Monitor, EyeOff, AlertTriangle, CheckCircle2, Link2, Upload, Plus, Layers
} from 'lucide-react';
import { cleanError } from '../lib/format.mjs';

const api = (method, args) => window.nexus.invoke(method, args);

const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', home: 'https://duckduckgo.com/', search: q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}&kp=-2` },
  startpage: { name: 'Startpage', home: 'https://www.startpage.com/', search: q => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}` },
  brave: { name: 'Brave Search', home: 'https://search.brave.com/', search: q => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
  mojeek: { name: 'Mojeek (Independent)', home: 'https://www.mojeek.com/', search: q => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}` },
  qwant: { name: 'Qwant', home: 'https://www.qwant.com/', search: q => `https://www.qwant.com/?q=${encodeURIComponent(q)}` },
  searxng: { name: 'SearXNG', home: 'https://searx.be/', search: (q, base) => `${String(base || 'https://searx.be').replace(/\/+$/, '')}/search?q=${encodeURIComponent(q)}` },
  ahmia: { name: 'Ahmia (.onion index)', home: 'https://ahmia.fi/', search: q => `https://ahmia.fi/search/?q=${encodeURIComponent(q)}` },
  torch: { name: 'Torch (.onion via Tor)', home: 'http://xmh57jrknzkhv6y3ls3ubitzfqnkrwxhopf5aygthi7d6rplyvk3noyd.onion/', search: (q, _b, torchUrl) => `${String(torchUrl || 'http://xmh57jrknzkhv6y3ls3ubitzfqnkrwxhopf5aygthi7d6rplyvk3noyd.onion/cgi-bin/omega/omega').replace(/\?.*$/, '')}?P=${encodeURIComponent(q)}&DEFAULTOP=and` },
};

function normalizeAddress(raw, engineId, searxUrl, torchUrl) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return SEARCH_ENGINES[engineId]?.home || 'https://duckduckgo.com/';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/\.onion(\/|$)/i.test(trimmed)) return 'http://' + trimmed;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(trimmed)) return 'http://' + trimmed;
  if (!trimmed.includes(' ') && trimmed.includes('.')) return 'https://' + trimmed;
  const eng = SEARCH_ENGINES[engineId] || SEARCH_ENGINES.duckduckgo;
  return eng.search(trimmed, searxUrl, torchUrl);
}

export default function PrivateBrowserView({ state, act, notify, onSendToChat, onAttachScreenshot, modalOpen }) {
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
  const wgFileRef = useRef(null);
  const [viewMode, setViewMode] = useState(native ? 'standard' : 'agent'); // 'standard' | 'agent'
  const [address, setAddress] = useState(SEARCH_ENGINES[engineId]?.home || 'https://duckduckgo.com/');
  const [browserState, setBrowserState] = useState({ url: address, title: 'NEXUS Browser', loading: false, blockedCount: 0, canGoBack: false, canGoForward: false, proxyUrl: '' });
  const [showPrivacyDrawer, setShowPrivacyDrawer] = useState(false);
  const [privacyStatus, setPrivacyStatus] = useState(null);
  const [privacyAudit, setPrivacyAudit] = useState(null);
  const [searchCatalog, setSearchCatalog] = useState([]);
  const [torState, setTorState] = useState(null);
  const [torBusy, setTorBusy] = useState(false);
  const [wgState, setWgState] = useState(null);
  const [wgBusy, setWgBusy] = useState(false);
  const [wgNameInput, setWgNameInput] = useState('');
  const [wgConfInput, setWgConfInput] = useState('');
  const [piiSummary, setPiiSummary] = useState(null);
  const [piiRuleInput, setPiiRuleInput] = useState('');
  const [checkingIp, setCheckingIp] = useState(false);
  const [customProxyInput, setCustomProxyInput] = useState(s.browserProxyUrl || '');
  const [searxInput, setSearxInput] = useState(s.browserSearxUrl || '');
  const [torchInput, setTorchInput] = useState(s.searchTorchOnionUrl || '');

  // Specialized Agent Browser state
  const [agentSnap, setAgentSnap] = useState(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentEngine, setAgentEngine] = useState('agent-fast'); // 'agent-fast' | 'agent-js'
  const [agentSearchQuery, setAgentSearchQuery] = useState('');
  const [agentSearchProvider, setAgentSearchProvider] = useState(s.searchProvider || 'auto');
  const [agentSearchResults, setAgentSearchResults] = useState(null);
  const [agentSearchBusy, setAgentSearchBusy] = useState(false);

  const shouldShowNative = native && viewMode === 'standard' && !showPrivacyDrawer && !modalOpen;

  useEffect(() => {
    void api('torStatus').then(setTorState).catch(() => {});
    void api('wireguardStatus').then(setWgState).catch(() => {});
    void api('searchCatalog').then(res => setSearchCatalog(Array.isArray(res) ? res : (res?.providers || []))).catch(() => {});
    const offTor = window.nexus?.subscribeTor?.(setTorState);
    const offWg = window.nexus?.subscribeWireguard?.(setWgState);
    return () => { offTor?.(); offWg?.(); };
  }, []);

  useEffect(() => {
    setAgentSearchProvider(s.searchProvider || 'auto');
  }, [s.searchProvider]);

  // Listen for native WebView2 browser navigation / tracker block state
  useEffect(() => {
    if (!native || !window.nexus?.subscribeBrowser) return;
    return window.nexus.subscribeBrowser(evt => {
      setBrowserState(prev => ({ ...prev, ...evt }));
      if (evt.url) setAddress(evt.url);
    });
  }, [native]);

  // Keep native WebView2 synced with our viewport container bounds
  useEffect(() => {
    if (!native) return;
    if (!shouldShowNative) {
      void api('browserHide').catch(() => {});
      return;
    }
    const syncBounds = (init = false) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect || rect.width < 100 || rect.height < 100) return;
      if (init) {
        void api('browserShow', {
          x: rect.left, y: rect.top, width: rect.width, height: rect.height,
          url: browserState.url || SEARCH_ENGINES[engineId]?.home,
          proxyUrl, blockTrackers, antiFingerprint, persistent,
        }).catch(e => notify(cleanError(e), 'error'));
      } else {
        void api('browserBounds', { x: rect.left, y: rect.top, width: rect.width, height: rect.height }).catch(() => {});
      }
    };
    syncBounds(true);
    const observer = new ResizeObserver(() => syncBounds(false));
    if (viewportRef.current) observer.observe(viewportRef.current);
    const onResize = () => syncBounds(false);
    window.addEventListener('resize', onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      void api('browserHide').catch(() => {});
    };
  }, [native, shouldShowNative, proxyUrl, blockTrackers, antiFingerprint, persistent]);

  const checkIpAndVpn = async () => {
    setCheckingIp(true);
    try {
      const [st, audit] = await Promise.all([
        api('privacyStatus').catch(() => null),
        api('privacyAudit').catch(() => null),
      ]);
      if (st) setPrivacyStatus(st);
      if (audit) setPrivacyAudit(audit);
    } catch (e) { notify(cleanError(e), 'error'); }
    finally { setCheckingIp(false); }
  };

  useEffect(() => {
    if (showPrivacyDrawer) {
      void api('privacyAudit').then(setPrivacyAudit).catch(() => {});
      void api('piiScrubberSummary').then(setPiiSummary).catch(() => {});
      if (!privacyStatus) void checkIpAndVpn();
    }
  }, [showPrivacyDrawer, s.torRouteAllTraffic, s.torStrictFailClosed, s.browserProxyMode, s.browserBlockTrackers, s.browserAntiFingerprint, s.browserPersistentProfile, s.searchProvider, s.searchStrictZeroTrack, s.privacyScrubPii, s.privacyScrubCustomRules, s.stealthMode, wgState?.running, torState?.running]);

  const loadAgentSnapshot = async (url, engine = agentEngine) => {
    setAgentBusy(true);
    setAgentSearchResults(null);
    try {
      const snap = await api('agentBrowserSnapshot', { url, engine });
      setAgentSnap(snap);
      if (snap?.url) setAddress(snap.url);
    } catch (e) {
      notify(cleanError(e), 'error');
    } finally {
      setAgentBusy(false);
    }
  };

  const runDirectSearch = async (queryOverride, providerOverride) => {
    const q = (queryOverride ?? agentSearchQuery).trim();
    if (!q) return;
    setAgentSearchBusy(true);
    setViewMode('agent');
    setShowPrivacyDrawer(false);
    try {
      const res = await api('webSearchDirect', { query: q, provider: providerOverride || agentSearchProvider, maxResults: 12 });
      setAgentSearchResults(res);
    } catch (e) {
      notify(cleanError(e), 'error');
    } finally {
      setAgentSearchBusy(false);
    }
  };

  const navigateTo = async targetRaw => {
    const trimmed = String(targetRaw || '').trim();
    const isUrlLike = /^https?:\/\//i.test(trimmed) || /\.onion(\/|$)/i.test(trimmed) || (!trimmed.includes(' ') && trimmed.includes('.')) || /^localhost(:\d+)?/i.test(trimmed);
    if (viewMode === 'agent' && !isUrlLike && trimmed) {
      setAgentSearchQuery(trimmed);
      await runDirectSearch(trimmed, agentSearchProvider);
      return;
    }
    const url = normalizeAddress(trimmed, engineId, s.browserSearxUrl, s.searchTorchOnionUrl);
    setAddress(url);
    if (viewMode === 'agent' || !native) {
      await loadAgentSnapshot(url);
    } else {
      await api('browserNavigate', { url });
    }
  };

  const wipeSession = async () => {
    const home = SEARCH_ENGINES[engineId]?.home || 'https://duckduckgo.com/';
    if (native) {
      await api('browserWipe', { url: home, proxyUrl, blockTrackers, antiFingerprint, persistent });
      notify('Browser session wiped: cookies, cache & profile cleared.', 'ok');
    }
    setAgentSnap(null);
    setAgentSearchResults(null);
  };

  const handleStartTor = async () => {
    setTorBusy(true);
    try {
      const st = await act('torStart', { autoInstall: true, activate: true });
      if (st) {
        setTorState(st);
        notify('NEXUS Managed Tor connected (app-scoped only — Windows proxy untouched).', 'ok');
      }
    } finally { setTorBusy(false); }
  };

  const handleStopTor = async () => {
    setTorBusy(true);
    try {
      const st = await act('torStop');
      if (st) { setTorState(st); notify('NEXUS Managed Tor stopped.', 'info'); }
    } finally { setTorBusy(false); }
  };

  const handleNewIdentity = async () => {
    const res = await act('torNewIdentity');
    if (res?.rotated) notify('Rotated Tor exit circuit (New Identity).', 'ok');
  };

  const sendCurrentPageToChat = async () => {
    try {
      if (viewMode === 'agent' && agentSnap) {
        onSendToChat(`Context from NEXUS Agent Browser (${agentSnap.engine || 'agent-fast'}):\n\n${(agentSnap.agentSnapshot || agentSnap.text || '').slice(0, 12000)}`);
        return;
      }
      const page = native ? await api('browserExtract') : agentSnap;
      if (!page) { notify('Load a page first.', 'info'); return; }
      const snippet = `Analyze this webpage from NEXUS Private Browser:\nURL: ${page.url}\nTitle: ${page.title}\n\n${page.selection ? `Selected text:\n${page.selection}\n\n` : ''}Content:\n${(page.text || '').slice(0, 8000)}`;
      onSendToChat(snippet);
    } catch (e) { notify(cleanError(e), 'error'); }
  };

  const captureForAi = async () => {
    if (!native) { notify('Visual screenshot capture requires the native NEXUS.exe host.', 'info'); return; }
    try {
      const shot = await api('browserScreenshot');
      if (shot?.base64) {
        const att = await api('uploadAttachment', { name: `browser-${Date.now()}.png`, base64: shot.base64 });
        if (att) {
          onAttachScreenshot(att, shot.url);
          notify('Captured private browser screenshot and attached it to chat.', 'ok');
        }
      }
    } catch (e) { notify(cleanError(e), 'error'); }
  };

  const switchToAgentMode = () => {
    setViewMode('agent');
    setShowPrivacyDrawer(false);
    if (address && /^https?:\/\//i.test(address) && agentSnap?.url !== address) {
      void loadAgentSnapshot(address);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Private & Agent Browser Chrome Toolbar */}
      <div className="browser-toolbar">
        <div className="row" style={{ gap: 3 }}>
          <button type="button" className="btn-icon" title="Back" disabled={!native || viewMode !== 'standard' || !browserState.canGoBack} onClick={() => api('browserBack')}><ArrowLeft size={15} /></button>
          <button type="button" className="btn-icon" title="Forward" disabled={!native || viewMode !== 'standard' || !browserState.canGoForward} onClick={() => api('browserForward')}><ArrowRight size={15} /></button>
          <button type="button" className="btn-icon" title="Reload" onClick={() => viewMode === 'agent' ? void loadAgentSnapshot(address) : (native ? api('browserReload') : void loadAgentSnapshot(address))}><RotateCw size={14} className={browserState.loading || agentBusy ? 'spin' : ''} /></button>
        </div>

        {/* Dual Browser Mode Segmented Toggle: Standard Visual vs Specialized Agent Browser */}
        <div className="browser-mode-switch" role="group" aria-label="Browser engine mode">
          {native && (
            <button
              type="button"
              className={viewMode === 'standard' && !showPrivacyDrawer ? 'active' : ''}
              title="Standard Visual WebView2 Browser (full interactive rendering & login)"
              onClick={() => { setViewMode('standard'); setShowPrivacyDrawer(false); }}
            >
              <Monitor size={12} /> Standard
            </button>
          )}
          <button
            type="button"
            className={viewMode === 'agent' && !showPrivacyDrawer ? 'active' : ''}
            title="Specialized Agent Browser (@e1..@eN accessibility refs, clean Markdown, zero tracker bloat, full .onion/Tor support)"
            onClick={switchToAgentMode}
          >
            <Bot size={12} /> Agent View
          </button>
        </div>

        <form className="browser-url-bar" onSubmit={e => { e.preventDefault(); void navigateTo(address); }}>
          <Lock size={13} style={{ color: address.includes('.onion') ? 'var(--info-fg)' : address.startsWith('https://') ? 'var(--ok-fg)' : 'var(--ink-faint)', flexShrink: 0 }} />
          <input
            aria-label="Private browser URL or search"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder={viewMode === 'agent' ? 'Enter URL, .onion address, or private search query…' : `Search privately with ${SEARCH_ENGINES[engineId]?.name || 'DuckDuckGo'} or enter URL…`}
          />
          <button type="submit" className="btn-icon" style={{ width: 24, height: 24 }}><Search size={13} /></button>
        </form>

        <div className="row" style={{ gap: 5, flexShrink: 0 }}>
          <button
            type="button"
            className={`filter-chip ${persistent ? 'active' : ''}`}
            style={{ padding: '4px 9px', fontSize: 11.5 }}
            title={persistent
              ? 'Account Mode: keeps your logins & cookies inside NEXUS. Click for zero-trace InPrivate.'
              : 'InPrivate Mode: ephemeral zero-trace session. Click for Account Mode to sign into your accounts.'}
            onClick={() => act('settings', { browserPersistentProfile: !persistent })}
          >
            {persistent ? <><UserCheck size={12} /> Account</> : <><Shield size={12} /> InPrivate</>}
          </button>
          <span className={`pill ${proxyUrl ? (s.torRouteAllTraffic ? 'ok' : 'info') : ''}`} title={proxyUrl ? (s.torRouteAllTraffic ? `ALL NEXUS traffic encrypted via ${proxyUrl}` : `Browser routed via ${proxyUrl}`) : 'Direct / System VPN'}>
            <ShieldCheck size={12} /> {proxyMode === 'wireguard-tor' ? 'WG → Tor' : proxyMode === 'wireguard' ? 'WireGuard VPN' : proxyUrl ? (s.torRouteAllTraffic ? 'All-App Tor' : (proxyMode.includes('tor') ? 'Tor Browser' : 'Proxy')) : 'Direct'}{s.torStrictFailClosed ? ' · Kill-Switch' : ''}
          </span>
          <button type="button" className="btn-secondary" style={{ padding: '5px 9px', fontSize: 12 }} title="Send current page / Agent snapshot to AI chat" onClick={sendCurrentPageToChat}><Send size={13} /> Send to AI</button>
          {native && viewMode === 'standard' && <button type="button" className="btn-secondary" style={{ padding: '5px 9px', fontSize: 12 }} title="Capture screenshot for AI vision" onClick={captureForAi}><Camera size={13} /></button>}
          <button type="button" className="btn-secondary" style={{ padding: '5px 9px', fontSize: 12 }} title="Wipe cookies, cache & create fresh identity" onClick={wipeSession}><Trash2 size={13} /></button>
          <button type="button" className={showPrivacyDrawer ? 'btn-primary' : 'btn-secondary'} style={{ padding: '5px 9px', fontSize: 12 }} onClick={() => setShowPrivacyDrawer(v => !v)}>
            <Sliders size={13} /> Privacy & Search
          </button>
        </div>
      </div>

      {/* Privacy, All-Traffic Tor, OPSEC Scorecard & Multi-Tier Search Configuration Drawer */}
      {showPrivacyDrawer ? (
        <div className="page-scroll">
          <div className="page-inner">
            <div className="page-header">
              <div>
                <h1>App-Wide Tor Privacy, OPSEC & Multi-Tier Search</h1>
                <p className="subtitle">Encrypt every outbound & inbound NEXUS connection through Tor/SOCKS5h (never touching Windows proxy), choose zero-track or .onion Torch search engines, and audit your real-time anonymity posture.</p>
              </div>
              <div className="row">
                <button type="button" className="btn-secondary" disabled={checkingIp} onClick={checkIpAndVpn}><RefreshCw size={14} className={checkingIp ? 'spin' : ''} /> Run IP & Audit Check</button>
                <button type="button" className="btn-primary" onClick={() => setShowPrivacyDrawer(false)}>Return to Browser</button>
              </div>
            </div>

            {/* 1-Click Stealth Mode Banner (Preserves Prompt Caching & Cache Affinity) */}
            <div className={`stealth-banner ${s.stealthMode || privacyAudit?.stealthActive ? 'active' : ''}`}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div className="row" style={{ gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <ShieldCheck size={17} style={{ color: 'var(--accent)' }} />
                  <strong style={{ fontSize: 15 }}>1-Click Stealth Mode</strong>
                  <span className={`pill ${s.stealthMode || privacyAudit?.stealthActive ? 'ok' : ''}`}>
                    {s.stealthMode || privacyAudit?.stealthActive ? 'ACTIVE' : 'OFF'}
                  </span>
                  <span className="pill info">Prompt Caching &amp; Cache Affinity Preserved</span>
                </div>
                <p className="hint" style={{ margin: 0 }}>
                  Enables All-App VPN/Tor routing, Fail-Closed Kill-Switch, Reversible Outbound PII/Path Scrubber, InPrivate Browser, Tracker Shield, and Strict Zero-Track Search — while keeping your Prompt Caching &amp; Cache Affinity intact.
                </p>
              </div>
              <button
                type="button"
                className={s.stealthMode || privacyAudit?.stealthActive ? 'btn-secondary' : 'btn-primary'}
                onClick={async () => {
                  const next = !(s.stealthMode || privacyAudit?.stealthActive);
                  const res = await act('toggleStealthMode', { enabled: next });
                  if (res) {
                    if (res.audit) setPrivacyAudit(res.audit);
                    notify(next ? 'Stealth Mode enabled (Prompt Caching & Cache Affinity preserved).' : 'Stealth Mode disabled.', next ? 'ok' : 'info');
                  }
                }}
              >
                <EyeOff size={14} /> {s.stealthMode || privacyAudit?.stealthActive ? 'Disable Stealth Mode' : 'Activate Stealth Mode'}
              </button>
            </div>

            {/* Security & Anonymity Scorecard */}
            {privacyAudit && (
              <section className="panel-card" style={{ marginBottom: 18 }}>
                <div className="row-between" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                  <div>
                    <div className="row" style={{ gap: 10 }}>
                      <h2 style={{ margin: 0 }}>Anonymity & OPSEC Scorecard</h2>
                      <span className={`pill ${privacyAudit.score >= 85 ? 'ok' : privacyAudit.score >= 60 ? 'info' : 'warn'}`}>
                        {privacyAudit.score}/100 · {privacyAudit.tier || 'Standard'}
                      </span>
                    </div>
                    <p className="hint" style={{ margin: '4px 0 0' }}>
                      Live audit of your routing encryption, kill-switch protection, DNS leak prevention, search tracking, and browser fingerprint isolation.
                    </p>
                  </div>
                  <div className="score-meter" aria-label={`Privacy score ${privacyAudit.score} out of 100`}>
                    <div className="score-meter-fill" style={{ width: `${privacyAudit.score}%`, background: privacyAudit.score >= 85 ? 'var(--ok-fg)' : privacyAudit.score >= 60 ? 'var(--info-fg)' : 'var(--warn-fg)' }} />
                  </div>
                </div>

                <div className="opsec-check-grid">
                  {(privacyAudit.checks || []).map(ch => {
                    const isPass = ch.status === 'pass';
                    const isFail = ch.status === 'fail';
                    return (
                      <div key={ch.id} className={`opsec-check-item ${ch.status || ''}`}>
                        {isPass
                          ? <CheckCircle2 size={14} style={{ color: 'var(--ok-fg)', flexShrink: 0, marginTop: 2 }} />
                          : <AlertTriangle size={14} style={{ color: isFail ? 'var(--err-fg)' : ch.status === 'warn' ? 'var(--warn-fg)' : 'var(--info-fg)', flexShrink: 0, marginTop: 2 }} />}
                        <div>
                          <strong style={{ fontSize: 12.5 }}>{ch.label}</strong>
                          <p className="hint" style={{ margin: '2px 0 0', fontSize: 11.5 }}>{ch.detail}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {(privacyAudit.recommendations || []).length > 0 && (
                  <div style={{ marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                    <strong style={{ fontSize: 12.5, display: 'block', marginBottom: 8 }}>Recommended OPSEC Hardening for Maximum Untraceability</strong>
                    <ul className="timeline-list" style={{ maxWidth: 'none' }}>
                      {privacyAudit.recommendations.map((rec, i) => (
                        <li key={i}>{typeof rec === 'string' ? rec : rec.detail || rec.title}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            <div className="settings-grid">
              <section className="panel-card">
                <h2>NEXUS-Managed Tor & App-Wide Encryption</h2>
                <p className="hint">Runs a dedicated local <code>tor.exe</code> bound strictly to <code>127.0.0.1:9055</code> inside NEXUS (never alters Windows proxy). Respects corporate/Defender network policies.</p>
                <div className="list-row">
                  <span className="hint">Tor Daemon Status</span>
                  <span className={`pill ${torState?.bootstrapped ? 'ok' : torState?.state === 'error' ? 'err' : torState?.running ? 'info' : ''}`}>
                    {torState?.bootstrapped ? `Connected (100% · v${torState.version || 'portable'})`
                      : torState?.state === 'installing' ? (torState.installProgress || 'Installing…')
                      : torState?.state === 'starting' ? `Bootstrapping ${torState.bootstrapPct || 0}%…`
                      : torState?.installed ? 'Installed · Stopped' : 'Not installed'}
                  </span>
                </div>
                {torState?.error && <p className="hint" style={{ color: 'var(--warn-fg)', marginTop: 6 }}>{torState.error}</p>}
                <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                  {!torState?.running ? (
                    <button type="button" className="btn-primary" disabled={torBusy} onClick={handleStartTor}>
                      <Play size={13} /> {torBusy ? 'Starting Tor…' : (torState?.installed ? 'Start NEXUS Tor' : 'Install & Start NEXUS Tor')}
                    </button>
                  ) : (
                    <>
                      <button type="button" className="btn-secondary" onClick={handleNewIdentity}><RefreshCw size={13} /> New Tor Circuit</button>
                      <button type="button" className="btn-danger" disabled={torBusy} onClick={handleStopTor}><Square size={12} /> Stop Tor</button>
                    </>
                  )}
                </div>

                <h2 style={{ marginTop: 18 }}>App-Wide Encryption & Kill-Switch</h2>
                <label className="switch-row">
                  <div><strong>Route ALL App Traffic Through Tor / SOCKS5h</strong><p>Encrypts LLM APIs, streaming, web search, Agent Browser, MCP HTTP calls, Skills downloads, and GitHub update checks through SOCKS5h (DNS resolved inside Tor; localhost always stays local).</p></div>
                  <input type="checkbox" className="switch-input" checked={!!s.torRouteAllTraffic} onChange={e => act('settings', { torRouteAllTraffic: e.target.checked, ...(e.target.checked ? { browserRouteAgentTraffic: true } : {}) })} />
                </label>

                <label className="switch-row">
                  <div><strong>Fail-Closed Kill-Switch (Zero Clearnet Leaks)</strong><p>When active, blocks all clearnet requests if Tor/proxy goes down instead of silently falling back to your ISP. (<code>.onion</code> domains are ALWAYS fail-closed.)</p></div>
                  <input type="checkbox" className="switch-input" checked={!!s.torStrictFailClosed} onChange={e => act('settings', { torStrictFailClosed: e.target.checked })} />
                </label>

                <label className="field" style={{ marginTop: 10 }}>
                  <span>Network Routing Mode (NEXUS-only)</span>
                  <select value={proxyMode} onChange={e => act('settings', { browserProxyMode: e.target.value })}>
                    <option value="direct">Direct / System VPN (WireGuard, Tailscale, Mullvad, Proton, WARP)</option>
                    <option value="wireguard">NEXUS App-Scoped WireGuard VPN (socks5://127.0.0.1:9060 · fast, zero system impact)</option>
                    <option value="wireguard-tor">NEXUS Double-Hop: WireGuard → Tor (ISP never sees Tor · max untraceability)</option>
                    <option value="managed-tor">NEXUS Managed Tor (socks5://127.0.0.1:9055 · app-scoped)</option>
                    <option value="tor">External Tor SOCKS5 (socks5://127.0.0.1:9050)</option>
                    <option value="socks5">Custom SOCKS5 Proxy (VPN SOCKS5, SSH -D)</option>
                    <option value="http">Custom HTTP / HTTPS Proxy (local or approved proxy)</option>
                  </select>
                </label>

                {(() => {
                  const guide = (privacyAudit?.modeGuide || []).find(g => g.id === proxyMode);
                  if (!guide) return null;
                  const needsWg = (proxyMode === 'wireguard' || proxyMode === 'wireguard-tor') && !wgState?.running;
                  const needsTor = (proxyMode === 'managed-tor' || proxyMode === 'wireguard-tor') && !torState?.running;
                  const hasProfile = (wgState?.profiles || []).length > 0;
                  return (
                    <div style={{ marginTop: 8, marginBottom: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-quiet-block)', fontSize: 12, display: 'grid', gap: 5 }}>
                      <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <strong>#{guide.rank} · {guide.label}</strong>
                        <span className={`pill ${guide.rank <= 2 ? 'ok' : guide.rank <= 4 ? 'info' : ''}`}>{guide.protectionLevel}</span>
                      </div>
                      <div><strong style={{ color: 'var(--ink-secondary)' }}>ISP sees:</strong> <span className="hint">{guide.whatIspSees}</span></div>
                      <div><strong style={{ color: 'var(--ink-secondary)' }}>Websites / LLM see:</strong> <span className="hint">{guide.whatTargetSees}</span></div>
                      <div><strong style={{ color: 'var(--ink-secondary)' }}>Trade-offs:</strong> <span className="hint">{guide.tradeoffs}</span></div>
                      {(needsWg || needsTor) && (
                        <div className="row-between" style={{ marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--border-subtle)', gap: 8, flexWrap: 'wrap' }}>
                          <span className="hint" style={{ color: 'var(--warn-fg)' }}>
                            {proxyMode === 'wireguard-tor' && !hasProfile
                              ? 'Mode saved. Import a WireGuard .conf below (e.g. Mullvad / IVPN) to start Double-Hop.'
                              : proxyMode === 'wireguard' && !hasProfile
                                ? 'Mode saved. Import a WireGuard .conf below to connect.'
                                : 'Mode saved — tunnel is currently stopped.'}
                          </span>
                          {proxyMode === 'wireguard-tor' && hasProfile && (
                            <button type="button" className="btn-primary" style={{ padding: '3px 9px', fontSize: 11.5 }} disabled={wgBusy} onClick={async () => {
                              setWgBusy(true);
                              try {
                                const res = await act('wireguardStartChainTor', {});
                                if (res) { setWgState(res.wireguard); setTorState(res.tor); notify('Double-Hop WireGuard → Tor connected.', 'ok'); }
                              } finally { setWgBusy(false); }
                            }}><Layers size={11} /> Start WG → Tor</button>
                          )}
                          {proxyMode === 'wireguard' && hasProfile && (
                            <button type="button" className="btn-primary" style={{ padding: '3px 9px', fontSize: 11.5 }} disabled={wgBusy} onClick={async () => {
                              setWgBusy(true);
                              try {
                                const st = await act('wireguardStart', { activate: true });
                                if (st) { setWgState(st); notify('WireGuard tunnel connected.', 'ok'); }
                              } finally { setWgBusy(false); }
                            }}><Play size={11} /> Start WireGuard</button>
                          )}
                          {proxyMode === 'managed-tor' && (
                            <button type="button" className="btn-primary" style={{ padding: '3px 9px', fontSize: 11.5 }} disabled={torBusy} onClick={handleStartTor}>
                              <Play size={11} /> Start Managed Tor
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {proxyMode !== 'direct' && (
                  <label className="field">
                    <span>Proxy Endpoint URL</span>
                    <div className="row">
                      <input className="mono" value={customProxyInput} onChange={e => setCustomProxyInput(e.target.value)} placeholder="socks5://127.0.0.1:9050 or http://127.0.0.1:8080" />
                      <button type="button" className="btn-primary" onClick={async () => {
                        await act('settings', { browserProxyUrl: customProxyInput.trim() });
                        notify('Proxy URL saved.', 'ok');
                      }}>Save</button>
                    </div>
                  </label>
                )}

                <label className="switch-row">
                  <div><strong>Route AI Agent Web Tools Through Proxy</strong><p>Routes <code>web_search</code>, <code>web_fetch</code>, <code>http_request</code>, and <code>browser_inspect</code> through the configured proxy.</p></div>
                  <input type="checkbox" className="switch-input" checked={!!s.browserRouteAgentTraffic} onChange={e => act('settings', { browserRouteAgentTraffic: e.target.checked })} />
                </label>

                <label className="switch-row">
                  <div><strong>Persistent Account Profile</strong><p>Keep logins inside NEXUS. Turn OFF for zero-trace ephemeral InPrivate browsing.</p></div>
                  <input type="checkbox" className="switch-input" checked={persistent} onChange={e => act('settings', { browserPersistentProfile: e.target.checked })} />
                </label>

                <label className="switch-row">
                  <div><strong>Tracker Blocker & Anti-Fingerprinting Shield</strong><p>Cancels analytics/ad trackers before they leave your PC, blocks non-proxied WebRTC UDP, and sends GPC/DNT.</p></div>
                  <input type="checkbox" className="switch-input" checked={blockTrackers && antiFingerprint} onChange={e => act('settings', { browserBlockTrackers: e.target.checked, browserAntiFingerprint: e.target.checked })} />
                </label>

                <h2 style={{ marginTop: 22 }}>App-Scoped WireGuard VPN (Zero Admin · Zero System Impact)</h2>
                <p className="hint">
                  Runs user-space <code>wireproxy.exe</code> strictly on <code>127.0.0.1:9060</code> ONLY for NEXUS (never alters Windows routes). Import any WireGuard <code>.conf</code> from <strong>Mullvad</strong> (€4.50/mo with Monero, zero email), <strong>IVPN</strong>, <strong>Proton VPN</strong>, or <strong>AirVPN</strong> — private keys stay encrypted in Windows DPAPI.
                </p>
                <div className="list-row">
                  <span className="hint">WireGuard Tunnel</span>
                  <span className={`pill ${wgState?.running ? 'ok' : wgState?.state === 'error' ? 'err' : ''}`}>
                    {wgState?.running ? `Connected · ${wgState.activeProfile?.name || 'Active'}` : wgState?.installProgress || (wgState?.installed ? 'wireproxy Ready · Stopped' : 'Auto-installs wireproxy on Connect')}
                  </span>
                </div>
                {wgState?.error && <p className="hint" style={{ color: 'var(--warn-fg)', marginTop: 4 }}>{wgState.error}</p>}

                {(wgState?.profiles || []).length > 0 && (
                  <div style={{ display: 'grid', gap: 6, margin: '10px 0' }}>
                    {wgState.profiles.map(p => (
                      <div key={p.id} className="list-row" style={{ padding: '7px 10px', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ fontSize: 12.5 }}>{p.name}</strong>
                          <div className="hint mono" style={{ fontSize: 11 }}>{p.provider} · {p.endpoint}</div>
                        </div>
                        <div className="row" style={{ gap: 5, flexShrink: 0 }}>
                          {p.active ? (
                            <button type="button" className="btn-danger" style={{ padding: '3px 8px', fontSize: 11 }} disabled={wgBusy} onClick={async () => {
                              setWgBusy(true);
                              try { setWgState(await act('wireguardStop')); notify('WireGuard tunnel stopped.', 'info'); }
                              finally { setWgBusy(false); }
                            }}><Square size={11} /> Stop</button>
                          ) : (
                            <>
                              <button type="button" className="btn-primary" style={{ padding: '3px 8px', fontSize: 11 }} disabled={wgBusy} onClick={async () => {
                                setWgBusy(true);
                                try {
                                  const st = await act('wireguardStart', { profileId: p.id, activate: true });
                                  if (st) { setWgState(st); notify(`Connected app-scoped WireGuard (${p.name}).`, 'ok'); }
                                } finally { setWgBusy(false); }
                              }}><Play size={11} /> VPN</button>
                              <button type="button" className="btn-secondary" style={{ padding: '3px 8px', fontSize: 11 }} disabled={wgBusy} title="Chain Managed Tor INSIDE this WireGuard tunnel (ISP never sees Tor)" onClick={async () => {
                                setWgBusy(true);
                                try {
                                  const res = await act('wireguardStartChainTor', { profileId: p.id });
                                  if (res) { setWgState(res.wireguard); setTorState(res.tor); notify(`Double-Hop WireGuard → Tor active via ${p.name}.`, 'ok'); }
                                } finally { setWgBusy(false); }
                              }}><Layers size={11} /> WG→Tor</button>
                            </>
                          )}
                          <button type="button" className="btn-icon" style={{ width: 24, height: 24 }} title="Remove profile" onClick={async () => {
                            const st = await act('wireguardRemoveProfile', { id: p.id });
                            if (st) setWgState(st);
                          }}><Trash2 size={11} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <input
                  ref={wgFileRef}
                  type="file"
                  accept=".conf,.txt"
                  style={{ display: 'none' }}
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    const cleanBase = file.name.replace(/\.conf$/i, '');
                    const st = await act('wireguardAddProfile', { name: wgNameInput.trim() || cleanBase, configText: text });
                    if (st) { setWgState(st); setWgNameInput(''); notify(`Imported encrypted WireGuard profile "${cleanBase}".`, 'ok'); }
                    e.target.value = '';
                  }}
                />
                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn-secondary" style={{ fontSize: 12 }} onClick={() => wgFileRef.current?.click()}>
                    <Upload size={13} /> Import .conf File
                  </button>
                  <input style={{ flex: 1, minWidth: 140 }} value={wgNameInput} onChange={e => setWgNameInput(e.target.value)} placeholder="Optional profile label (e.g. Mullvad SE)" />
                </div>
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--ink-secondary)' }}>Or paste WireGuard .conf text directly…</summary>
                  <div style={{ marginTop: 6 }}>
                    <textarea className="mono" rows={5} value={wgConfInput} onChange={e => setWgConfInput(e.target.value)} placeholder={'[Interface]\nPrivateKey = ...\nAddress = 10.64.x.x/32\n\n[Peer]\nPublicKey = ...\nEndpoint = 193.x.x.x:51820'} />
                    <button type="button" className="btn-primary" style={{ marginTop: 6, fontSize: 12 }} disabled={!wgConfInput.trim()} onClick={async () => {
                      const st = await act('wireguardAddProfile', { name: wgNameInput.trim(), configText: wgConfInput });
                      if (st) { setWgState(st); setWgConfInput(''); setWgNameInput(''); notify('Saved WireGuard profile encrypted in DPAPI vault.', 'ok'); }
                    }}><Plus size={13} /> Save Encrypted Profile</button>
                  </div>
                </details>

                <h2 style={{ marginTop: 22 }}>Reversible Outbound PII &amp; Path Scrubber</h2>
                <label className="switch-row">
                  <div><strong>Redact Local Paths, Username &amp; Hostname on Cloud Calls</strong><p>Automatically replaces <code>C:\Users\&lt;you&gt;</code> → <code>C:\Users\__NEXUS_USER__</code> and your PC hostname → <code>__NEXUS_HOST__</code> before sending prompts to cloud LLMs (skipped for localhost/LAN models), and restores them transparently for local tools.</p></div>
                  <input type="checkbox" className="switch-input" checked={!!s.privacyScrubPii} onChange={e => act('settings', { privacyScrubPii: e.target.checked })} />
                </label>
                {piiSummary && s.privacyScrubPii && (
                  <p className="hint" style={{ marginTop: 6, color: 'var(--ok-fg)' }}>
                    Active: {piiSummary.ruleCount} reversible redaction rule(s) shielding outbound cloud prompts.
                  </p>
                )}
                <form className="row" style={{ gap: 6, marginTop: 8 }} onSubmit={e => {
                  e.preventDefault();
                  if (!piiRuleInput.trim()) return;
                  void act('settings', { privacyScrubCustomRules: [...new Set([...(s.privacyScrubCustomRules || []), piiRuleInput.trim()])] });
                  setPiiRuleInput('');
                }}>
                  <input className="mono" style={{ flex: 1 }} value={piiRuleInput} onChange={e => setPiiRuleInput(e.target.value)} placeholder="Custom string or secret => [ALIAS]" />
                  <button type="submit" className="btn-secondary" style={{ fontSize: 12 }}><Plus size={12} /> Add Rule</button>
                </form>
                {(s.privacyScrubCustomRules || []).length > 0 && (
                  <div className="row" style={{ gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                    {(s.privacyScrubCustomRules || []).map(rule => (
                      <span key={rule} className="pill mono" style={{ gap: 5 }}>
                        {rule.includes('=>') ? rule.split('=>')[1].trim() : `${rule.slice(0, 2)}•••${rule.slice(-2)}`}
                        <button type="button" style={{ background: 'none', padding: 0, color: 'inherit' }} onClick={() => act('settings', { privacyScrubCustomRules: (s.privacyScrubCustomRules || []).filter(r => r !== rule) })}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </section>

              <section className="panel-card">
                <h2>Multi-Tier Private & .onion Search Engines</h2>
                <p className="hint">Choose zero-tracking engines (SearXNG, DuckDuckGo, Mojeek, Brave ZDR, Kagi), AI agent search APIs (LangSearch, Tavily, Exa), or Tor hidden-service search via <strong>Ahmia</strong> and <strong>Torch</strong>.</p>

                <label className="field">
                  <span>Default AI & Agent Search Engine</span>
                  <select value={s.searchProvider || 'auto'} onChange={e => act('settings', { searchProvider: e.target.value })}>
                    <option value="auto">Auto · Privacy-First Cascade (SearXNG → Brave/Kagi → DuckDuckGo → Mojeek)</option>
                    <option value="searxng">SearXNG (Self-Hosted / Private Metasearch · Zero Tracking)</option>
                    <option value="duckduckgo">DuckDuckGo HTML (No Tracking · Free · Tor-Friendly)</option>
                    <option value="mojeek">Mojeek (Independent Crawler · Zero Tracking · UK)</option>
                    <option value="brave">Brave Search API (Independent Index · Zero Data Retention)</option>
                    <option value="kagi">Kagi Search API (Zero Ads / Zero Tracking · Paid)</option>
                    <option value="langsearch">LangSearch API (AI Semantic Search · Free Key)</option>
                    <option value="tavily">Tavily AI Search (RAG-Optimized · API Key)</option>
                    <option value="exa">Exa Neural Search (Embeddings Index · API Key)</option>
                    <option value="ahmia">Ahmia (.onion Clearnet/Tor Index)</option>
                    <option value="torch">Torch (.onion Hidden Service · Strictly Tor Only)</option>
                    <option value="onion">Combined Tor .onion (Ahmia + Torch via Tor)</option>
                    <option value="bing-rss">Bing RSS (Clearnet Fallback — disabled in Strict Zero-Track)</option>
                  </select>
                </label>

                <label className="switch-row">
                  <div><strong>Strict Zero-Track Search Mode</strong><p>Never falls back to mainstream tracking engines (Bing/Google) even if a private search engine rate-limits or times out.</p></div>
                  <input type="checkbox" className="switch-input" checked={s.searchStrictZeroTrack !== false} onChange={e => act('settings', { searchStrictZeroTrack: e.target.checked })} />
                </label>

                <label className="field" style={{ marginTop: 10 }}>
                  <span>Default Agent Browser Engine</span>
                  <select value={s.browserEngineMode || 'auto'} onChange={e => act('settings', { browserEngineMode: e.target.value })}>
                    <option value="auto">Auto (Fast Zero-Bloat Agent Browser first, WebView2 JS when needed)</option>
                    <option value="agent-fast">Fast Agent Browser (HTML → @eN Refs + Markdown · 10× faster, full Tor/.onion)</option>
                    <option value="agent-js">JS Agent Browser (Headless WebView2 + @eN Refs + Tracker/Media Blocker)</option>
                    <option value="standard">Standard Visual WebView2 Browser</option>
                  </select>
                </label>

                <label className="field">
                  <span>Visual Browser Search Bar Engine</span>
                  <select value={engineId} onChange={e => act('settings', { browserSearchEngine: e.target.value })}>
                    {Object.entries(SEARCH_ENGINES).map(([id, e]) => <option key={id} value={id}>{e.name}</option>)}
                  </select>
                </label>

                <label className="field">
                  <span>Self-Hosted / Private SearXNG URL (optional)</span>
                  <div className="row">
                    <input className="mono" value={searxInput} onChange={e => setSearxInput(e.target.value)} placeholder="http://127.0.0.1:8888 or https://searx.be" />
                    <button type="button" className="btn-secondary" onClick={() => { void act('settings', { browserSearxUrl: searxInput.trim() }); notify('SearXNG URL saved.', 'ok'); }}>Save</button>
                  </div>
                </label>

                <label className="field">
                  <span>Torch .onion Endpoint Override (optional, Tor-only)</span>
                  <div className="row">
                    <input className="mono" value={torchInput} onChange={e => setTorchInput(e.target.value)} placeholder="http://xmh57jrknzkhv6y3ls3ubitzfqnkrwxhopf5aygthi7d6rplyvk3noyd.onion/..." />
                    <button type="button" className="btn-secondary" onClick={() => { void act('settings', { searchTorchOnionUrl: torchInput.trim() }); notify('Torch .onion URL saved.', 'ok'); }}>Save</button>
                  </div>
                </label>

                <h3 style={{ marginTop: 16 }}>Live Exit IP, VPN & Local Proxies</h3>
                {privacyStatus ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div className="list-row">
                      <span className="hint">Exit Public IP</span>
                      <strong className="mono">{privacyStatus.ipInfo?.ip || privacyStatus.ipError || 'Unavailable'}</strong>
                    </div>
                    {privacyStatus.ipInfo?.country && (
                      <div className="list-row">
                        <span className="hint">Exit Location / ISP</span>
                        <strong>{privacyStatus.ipInfo.city ? `${privacyStatus.ipInfo.city}, ` : ''}{privacyStatus.ipInfo.country} · {privacyStatus.ipInfo.isp || 'Unknown'}</strong>
                      </div>
                    )}
                    <div className="list-row">
                      <span className="hint">Windows VPN Tunnel</span>
                      <span className={`pill ${privacyStatus.vpn?.active ? 'ok' : ''}`}>
                        {privacyStatus.vpn?.active ? `Active (${privacyStatus.vpn.adapters.map(a => a.name).join(', ')})` : 'No VPN adapter detected'}
                      </span>
                    </div>
                    {(privacyStatus.localProxies || []).map(p => (
                      <div key={p.id} className="list-row" style={{ padding: '6px 9px', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                        <div>
                          <strong style={{ fontSize: 12 }}>{p.label}</strong>
                          <div className="hint mono" style={{ fontSize: 11 }}>{p.url}</div>
                        </div>
                        <div className="row">
                          <span className={`pill ${p.reachable ? 'ok' : ''}`}>{p.reachable ? 'Running' : 'Offline'}</span>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: '3px 7px', fontSize: 11 }}
                            onClick={async () => {
                              setCustomProxyInput(p.url);
                              await act('settings', { browserProxyMode: p.id.startsWith('tor') ? 'tor' : (p.url.startsWith('socks') ? 'socks5' : 'http'), browserProxyUrl: p.url });
                              notify(`Selected ${p.label}.`, 'ok');
                            }}
                          >Use</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="hint">Checking VPN adapters, local Tor/SOCKS5 ports, and exit IP…</p>}
              </section>
            </div>
          </div>
        </div>
      ) : viewMode === 'agent' ? (
        /* Specialized Agent Browser Workspace: Private/Onion Search + @e1..@eN Accessibility Refs + Clean Markdown */
        <div className="page-scroll">
          <div className="page-inner">
            <div className="panel-card" style={{ marginBottom: 16 }}>
              <div className="row-between" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Bot size={16} style={{ color: 'var(--accent)' }} />
                  <h2 style={{ margin: 0 }}>Specialized Agent Browser & Private / .onion Search</h2>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <select
                    aria-label="Agent browser render engine"
                    value={agentEngine}
                    onChange={e => setAgentEngine(e.target.value)}
                    style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
                  >
                    <option value="agent-fast">Fast Zero-Bloat (@eN Refs · Tor/.onion)</option>
                    {native && <option value="agent-js">Headless JS WebView2 (@eN Refs + SPA)</option>}
                  </select>
                  {agentSnap?.url && (
                    <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '4px 9px' }} onClick={() => void loadAgentSnapshot(agentSnap.url, agentEngine)}>
                      <RefreshCw size={12} className={agentBusy ? 'spin' : ''} /> Re-Snapshot
                    </button>
                  )}
                </div>
              </div>

              <form className="row" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={e => { e.preventDefault(); void runDirectSearch(); }}>
                <select
                  aria-label="Private search provider"
                  value={agentSearchProvider}
                  onChange={e => setAgentSearchProvider(e.target.value)}
                  style={{ width: 230, flexShrink: 0 }}
                >
                  <option value="auto">Auto (Privacy-First Cascade)</option>
                  {searchCatalog.filter(p => p.id !== 'auto').map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.tier === 'onion' || p.torOnly ? ' [.onion]' : ''}{p.requiresKey ? (p.hasKey ? ' [Key Ready]' : ' [Needs Key]') : ''}
                    </option>
                  ))}
                </select>
                <input
                  style={{ flex: 1, minWidth: 200 }}
                  value={agentSearchQuery}
                  onChange={e => setAgentSearchQuery(e.target.value)}
                  placeholder="Run zero-track search, AI search (Brave/Kagi/LangSearch/Tavily/Exa), or Tor .onion search (Ahmia/Torch)…"
                />
                <button type="submit" className="btn-primary" disabled={agentSearchBusy || !agentSearchQuery.trim()}>
                  <Search size={13} /> {agentSearchBusy ? 'Searching…' : 'Search'}
                </button>
              </form>
            </div>

            {/* Private / Onion Search Results */}
            {agentSearchResults && (
              <div className="panel-card" style={{ marginBottom: 16 }}>
                <div className="row-between" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <h2 style={{ margin: 0 }}>Search Results ({agentSearchResults.results?.length || 0})</h2>
                    <span className="pill ok">{agentSearchResults.engine || 'search'}</span>
                    {agentSearchResults.privacyTier && <span className="pill">{agentSearchResults.privacyTier}</span>}
                    {agentSearchResults.viaTor && <span className="pill info"><EyeOff size={11} /> Tor / Proxy Routed</span>}
                  </div>
                  <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '4px 9px' }} onClick={() => {
                    const summary = (agentSearchResults.results || []).map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
                    onSendToChat(`Private search results (${agentSearchResults.engine || 'search'}) for "${agentSearchResults.query}":\n\n${summary}`);
                  }}>
                    <Send size={12} /> Send Results to AI
                  </button>
                </div>

                {agentSearchResults.answer && (
                  <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-quiet-block)', border: '1px solid var(--border-subtle)', marginBottom: 12, fontSize: 13 }}>
                    {agentSearchResults.answer}
                  </div>
                )}

                {agentSearchResults.note && (
                  <p className="hint" style={{ color: 'var(--warn-fg)', marginBottom: 10 }}>{agentSearchResults.note}</p>
                )}

                <div style={{ display: 'grid', gap: 8 }}>
                  {(agentSearchResults.results || []).map((r, i) => (
                    <div key={r.url + i} className="agent-result-row">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong style={{ fontSize: 13.5, display: 'block' }}>{r.title}</strong>
                        <div className="hint mono" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</div>
                        {r.snippet && <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>{r.snippet}</p>}
                      </div>
                      <div className="row" style={{ gap: 5, flexShrink: 0 }}>
                        <button type="button" className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={() => void loadAgentSnapshot(r.url)}>
                          <Bot size={12} /> Agent Open
                        </button>
                        {native && (
                          <button type="button" className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={() => { setViewMode('standard'); setAddress(r.url); void api('browserNavigate', { url: r.url }); }}>
                            <Monitor size={12} /> Visual
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {!(agentSearchResults.results || []).length && <p className="hint">No results returned for this query.</p>}
                </div>
              </div>
            )}

            {/* Specialized Agent Snapshot View (@e1..@eN refs + clean Markdown) */}
            {agentBusy ? (
              <div className="panel-card"><p className="hint" style={{ margin: 0 }}>Capturing compact @eN accessibility snapshot…</p></div>
            ) : agentSnap ? (
              <div className="agent-snap-grid">
                <section className="panel-card">
                  <div className="row-between" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <h2 style={{ margin: 0 }}>{agentSnap.title}</h2>
                      <div className="hint mono" style={{ fontSize: 11.5 }}>{agentSnap.url}</div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="pill ok mono">{agentSnap.engine || 'agent-fast'}</span>
                      <span className="pill tabular">{(agentSnap.refs || []).length} @refs</span>
                      <button type="button" className="btn-secondary" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={() => api('openExternal', { url: agentSnap.url })}><ExternalLink size={12} /> External</button>
                    </div>
                  </div>
                  <pre className="pre-box" style={{ maxHeight: '62vh', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{agentSnap.text}</pre>
                </section>

                <section className="panel-card">
                  <h2 style={{ marginBottom: 8 }}>Interactive Accessibility Tree (@e1–@e{(agentSnap.refs || []).length})</h2>
                  <p className="hint" style={{ marginBottom: 10 }}>Click any link ref to navigate directly inside Agent View, or use these exact <code>@eN</code> handles in AI prompts with <code>browser_inspect</code>.</p>
                  <div className="agent-ref-list">
                    {(agentSnap.refs || []).slice(0, 60).map(r => (
                      <div key={r.ref} className="agent-ref-row">
                        <code className="pill info mono" style={{ fontSize: 11, flexShrink: 0 }}>{r.ref}</code>
                        <span className="tag-chip" style={{ flexShrink: 0 }}>{r.role}</span>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }}>{r.name || r.url || r.selector}</span>
                        {r.url && (
                          <button type="button" className="btn-icon" style={{ width: 24, height: 24 }} title={`Open ${r.url} in Agent View`} onClick={() => void loadAgentSnapshot(r.url)}>
                            <Link2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                    {!(agentSnap.refs || []).length && <p className="hint">No interactive refs extracted on this page.</p>}
                  </div>
                </section>
              </div>
            ) : !agentSearchResults ? (
              <div className="panel-card">
                <h2>Ready for Fast Zero-Bloat Agent Browsing</h2>
                <p className="hint" style={{ maxWidth: '68ch' }}>
                  Enter any clearnet URL or Tor <code>.onion</code> address in the top bar — or run a zero-track / Torch search above.
                  Agent View strips ads, scripts, and trackers, rendering clean Markdown alongside stable <code>@e1..@eN</code> accessibility refs that cut AI token usage by 80–90% compared to raw HTML.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div ref={viewportRef} style={{ flex: 1, position: 'relative', background: 'var(--bg-code)', display: 'grid', placeItems: 'center' }}>
          <div className="hint row"><Shield size={16} style={{ color: 'var(--accent)' }} /><span>Initializing isolated {persistent ? 'Account' : 'InPrivate'} WebView2 sandbox…</span></div>
        </div>
      )}
    </div>
  );
}

