import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, RotateCw, Shield, ShieldCheck, Globe, Trash2,
  Camera, Send, Sliders, Lock, RefreshCw, Search, ExternalLink, UserCheck, Play, Square
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

export default function PrivateBrowserView({ state, act, notify, onSendToChat, onAttachScreenshot, modalOpen }) {
  const s = state.settings;
  const native = Boolean(window.nexus?.nativeHost);
  const engineId = s.browserSearchEngine || 'duckduckgo';
  const persistent = Boolean(s.browserPersistentProfile);
  const proxyMode = s.browserProxyMode || 'direct';
  const proxyUrl = proxyMode === 'direct' ? ''
    : (proxyMode === 'managed-tor' ? 'socks5://127.0.0.1:9055'
      : (proxyMode === 'tor' ? (s.browserProxyUrl || 'socks5://127.0.0.1:9050') : (s.browserProxyUrl || '')));
  const blockTrackers = s.browserBlockTrackers !== false;
  const antiFingerprint = s.browserAntiFingerprint !== false;

  const viewportRef = useRef(null);
  const [address, setAddress] = useState(SEARCH_ENGINES[engineId]?.home || 'https://duckduckgo.com/');
  const [browserState, setBrowserState] = useState({ url: address, title: 'NEXUS Browser', loading: false, blockedCount: 0, canGoBack: false, canGoForward: false, proxyUrl: '' });
  const [showPrivacyDrawer, setShowPrivacyDrawer] = useState(false);
  const [privacyStatus, setPrivacyStatus] = useState(null);
  const [torState, setTorState] = useState(null);
  const [torBusy, setTorBusy] = useState(false);
  const [checkingIp, setCheckingIp] = useState(false);
  const [customProxyInput, setCustomProxyInput] = useState(s.browserProxyUrl || '');
  const [searxInput, setSearxInput] = useState(s.browserSearxUrl || '');
  const [readerPage, setReaderPage] = useState(null);
  const [readerBusy, setReaderBusy] = useState(false);

  const shouldShowNative = native && !showPrivacyDrawer && !modalOpen;

  useEffect(() => {
    void api('torStatus').then(setTorState).catch(() => {});
    if (!window.nexus?.subscribeTor) return;
    return window.nexus.subscribeTor(setTorState);
  }, []);

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
    try { setPrivacyStatus(await api('privacyStatus')); }
    catch (e) { notify(cleanError(e), 'error'); }
    finally { setCheckingIp(false); }
  };

  useEffect(() => {
    if (showPrivacyDrawer && !privacyStatus) void checkIpAndVpn();
  }, [showPrivacyDrawer]);

  const navigateTo = async targetRaw => {
    const url = normalizeAddress(targetRaw, engineId, s.browserSearxUrl);
    setAddress(url);
    if (native) {
      await api('browserNavigate', { url });
    } else {
      setReaderBusy(true);
      try { setReaderPage(await api('browserFetchReader', { url })); }
      catch (e) { notify(cleanError(e), 'error'); }
      finally { setReaderBusy(false); }
    }
  };

  const wipeSession = async () => {
    const home = SEARCH_ENGINES[engineId]?.home || 'https://duckduckgo.com/';
    if (native) {
      await api('browserWipe', { url: home, proxyUrl, blockTrackers, antiFingerprint, persistent });
      notify('Browser session wiped: cookies, cache & profile cleared.', 'ok');
    } else {
      setReaderPage(null);
      notify('Reader session cleared.', 'ok');
    }
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
      const page = native ? await api('browserExtract') : readerPage;
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

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Private Browser Chrome Toolbar */}
      <div className="browser-toolbar">
        <div className="row" style={{ gap: 3 }}>
          <button type="button" className="btn-icon" title="Back" disabled={!native || !browserState.canGoBack} onClick={() => api('browserBack')}><ArrowLeft size={15} /></button>
          <button type="button" className="btn-icon" title="Forward" disabled={!native || !browserState.canGoForward} onClick={() => api('browserForward')}><ArrowRight size={15} /></button>
          <button type="button" className="btn-icon" title="Reload" onClick={() => native ? api('browserReload') : void navigateTo(address)}><RotateCw size={14} className={browserState.loading || readerBusy ? 'spin' : ''} /></button>
        </div>

        <form className="browser-url-bar" onSubmit={e => { e.preventDefault(); void navigateTo(address); }}>
          <Lock size={13} style={{ color: address.startsWith('https://') ? 'var(--ok-fg)' : 'var(--ink-faint)', flexShrink: 0 }} />
          <input
            aria-label="Private browser URL or search"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder={`Search privately with ${SEARCH_ENGINES[engineId]?.name || 'DuckDuckGo'} or enter URL…`}
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
          <span className={`pill ${proxyUrl ? 'ok' : 'info'}`} title={proxyUrl ? `App-scoped routing via ${proxyUrl}` : 'Direct / System VPN'}>
            <ShieldCheck size={12} /> {proxyUrl ? (proxyMode.includes('tor') ? 'Tor SOCKS5' : 'Proxy Active') : 'Direct'} · {browserState.blockedCount || 0} blocked
          </span>
          <button type="button" className="btn-secondary" style={{ padding: '5px 9px', fontSize: 12 }} title="Send current page text to AI chat" onClick={sendCurrentPageToChat}><Send size={13} /> Send to AI</button>
          {native && <button type="button" className="btn-secondary" style={{ padding: '5px 9px', fontSize: 12 }} title="Capture screenshot for AI vision" onClick={captureForAi}><Camera size={13} /></button>}
          <button type="button" className="btn-secondary" style={{ padding: '5px 9px', fontSize: 12 }} title="Wipe cookies, cache & create fresh identity" onClick={wipeSession}><Trash2 size={13} /> Wipe</button>
          <button type="button" className={showPrivacyDrawer ? 'btn-primary' : 'btn-secondary'} style={{ padding: '5px 9px', fontSize: 12 }} onClick={() => setShowPrivacyDrawer(v => !v)}>
            <Sliders size={13} /> VPN & Proxy
          </button>
        </div>
      </div>

      {/* VPN / Tor / Proxy / Search Privacy Configuration View OR Native Browser Viewport */}
      {showPrivacyDrawer ? (
        <div className="page-scroll">
          <div className="page-inner">
            <div className="page-header">
              <div>
                <h1>Integrated Browser · Account, VPN & App-Scoped Proxy</h1>
                <p className="subtitle">Switch between persistent Account Mode (stay signed in) and zero-trace InPrivate Mode, with optional app-scoped Tor/SOCKS5/HTTP proxy that never modifies Windows system settings.</p>
              </div>
              <div className="row">
                <button type="button" className="btn-secondary" disabled={checkingIp} onClick={checkIpAndVpn}><RefreshCw size={14} className={checkingIp ? 'spin' : ''} /> Run IP & VPN Check</button>
                <button type="button" className="btn-primary" onClick={() => setShowPrivacyDrawer(false)}>Return to Browser</button>
              </div>
            </div>

            <div className="settings-grid">
              <section className="panel-card">
                <h2>NEXUS-Managed Portable Tor (App-Scoped Only)</h2>
                <p className="hint">Runs a dedicated local <code>tor.exe</code> bound strictly to <code>127.0.0.1:9055</code> inside NEXUS — routes ONLY NEXUS's browser & optional agent tools, never touching Windows system proxy. Respects corporate/Defender network policies.</p>
                <div className="list-row">
                  <span className="hint">Status</span>
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
                      <button type="button" className="btn-secondary" onClick={handleNewIdentity}><RefreshCw size={13} /> New Identity</button>
                      <button type="button" className="btn-danger" disabled={torBusy} onClick={handleStopTor}><Square size={12} /> Stop Tor</button>
                    </>
                  )}
                </div>

                <h2 style={{ marginTop: 20 }}>Proxy & Profile Routing</h2>
                <label className="switch-row">
                  <div><strong>Persistent Account Profile</strong><p>When ON, saves your logins & cookies in <code>browser-account-profile</code> so you stay signed in across chats. Turn OFF for zero-trace InPrivate.</p></div>
                  <input type="checkbox" className="switch-input" checked={persistent} onChange={e => act('settings', { browserPersistentProfile: e.target.checked })} />
                </label>

                <label className="field" style={{ marginTop: 10 }}>
                  <span>Network Routing Mode (NEXUS-only)</span>
                  <select value={proxyMode} onChange={e => act('settings', { browserProxyMode: e.target.value })}>
                    <option value="direct">Direct / System VPN (WireGuard, Tailscale, Mullvad, Proton, WARP)</option>
                    <option value="managed-tor">NEXUS Managed Tor (socks5://127.0.0.1:9055 · app-scoped)</option>
                    <option value="tor">External Tor SOCKS5 (socks5://127.0.0.1:9050)</option>
                    <option value="socks5">Custom SOCKS5 Proxy (VPN SOCKS5, SSH -D)</option>
                    <option value="http">Custom HTTP / HTTPS Proxy (local or approved proxy)</option>
                  </select>
                </label>

                {proxyMode !== 'direct' && (
                  <label className="field">
                    <span>Proxy Endpoint URL</span>
                    <div className="row">
                      <input className="mono" value={customProxyInput} onChange={e => setCustomProxyInput(e.target.value)} placeholder="socks5://127.0.0.1:9050 or http://127.0.0.1:8080" />
                      <button type="button" className="btn-primary" onClick={async () => {
                        await act('settings', { browserProxyUrl: customProxyInput.trim() });
                        notify('Proxy URL saved. Click Wipe/Apply to restart browser with new route.', 'ok');
                      }}>Save</button>
                    </div>
                  </label>
                )}

                <label className="switch-row">
                  <div><strong>Route AI Agent Web Tools Through This Proxy Too</strong><p>Routes <code>web_search</code>, <code>web_fetch</code>, <code>http_request</code>, and <code>browser_inspect</code> through the configured SOCKS5/Tor/HTTP proxy.</p></div>
                  <input type="checkbox" className="switch-input" checked={!!s.browserRouteAgentTraffic} onChange={e => act('settings', { browserRouteAgentTraffic: e.target.checked })} />
                </label>

                <label className="switch-row">
                  <div><strong>Network-Level Tracker & Ad Blocker</strong><p>Cancels analytics, ad networks, and telemetry scripts inside WebView2 before they leave your machine.</p></div>
                  <input type="checkbox" className="switch-input" checked={blockTrackers} onChange={e => act('settings', { browserBlockTrackers: e.target.checked })} />
                </label>

                <label className="switch-row">
                  <div><strong>Anti-Fingerprinting & WebRTC IP-Leak Shield</strong><p>Disables non-proxied WebRTC UDP, sends GPC/DNT, blocks sendBeacon telemetry, and wipes temp profile on exit.</p></div>
                  <input type="checkbox" className="switch-input" checked={antiFingerprint} onChange={e => act('settings', { browserAntiFingerprint: e.target.checked })} />
                </label>

                <label className="field">
                  <span>Private Search Engine</span>
                  <select value={engineId} onChange={e => act('settings', { browserSearchEngine: e.target.value })}>
                    {Object.entries(SEARCH_ENGINES).map(([id, e]) => <option key={id} value={id}>{e.name}</option>)}
                  </select>
                </label>
                {engineId === 'searxng' && (
                  <label className="field">
                    <span>Custom SearXNG Instance URL</span>
                    <div className="row">
                      <input value={searxInput} onChange={e => setSearxInput(e.target.value)} placeholder="https://searx.be" />
                      <button type="button" className="btn-secondary" onClick={() => act('settings', { browserSearxUrl: searxInput.trim() })}>Save</button>
                    </div>
                  </label>
                )}
              </section>

              <section className="panel-card">
                <h2>Live Network, VPN & Local Proxy Detection</h2>
                {privacyStatus ? (
                  <>
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

                    <h3 style={{ marginTop: 16 }}>Detected Local Proxies & Tor Ports</h3>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {(privacyStatus.localProxies || []).map(p => (
                        <div key={p.id} className="list-row" style={{ padding: '7px 10px', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                          <div>
                            <strong style={{ fontSize: 12.5 }}>{p.label}</strong>
                            <div className="hint mono">{p.url}</div>
                          </div>
                          <div className="row">
                            <span className={`pill ${p.reachable ? 'ok' : ''}`}>{p.reachable ? 'Running' : 'Offline'}</span>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ padding: '4px 8px', fontSize: 11.5 }}
                              onClick={async () => {
                                setCustomProxyInput(p.url);
                                await act('settings', { browserProxyMode: p.id.startsWith('tor') ? 'tor' : (p.url.startsWith('socks') ? 'socks5' : 'http'), browserProxyUrl: p.url });
                                notify(`Selected ${p.label}.`, 'ok');
                              }}
                            >
                              Use
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : <p className="hint">Checking VPN adapters, local Tor/SOCKS5 ports, and exit IP…</p>}
              </section>
            </div>
          </div>
        </div>
      ) : native ? (
        <div ref={viewportRef} style={{ flex: 1, position: 'relative', background: 'var(--bg-code)', display: 'grid', placeItems: 'center' }}>
          <div className="hint row"><Shield size={16} style={{ color: 'var(--accent)' }} /><span>Initializing isolated InPrivate WebView2 sandbox…</span></div>
        </div>
      ) : (
        <div className="page-scroll">
          <div className="page-inner">
            <div className="panel-card">
              <div className="row-between" style={{ marginBottom: 10 }}>
                <div className="row"><Globe size={16} style={{ color: 'var(--accent)' }} /><h2 style={{ margin: 0 }}>Private Proxy Reader (Web Fallback)</h2></div>
                {readerPage?.url && <button type="button" className="btn-secondary" onClick={() => api('openExternal', { url: readerPage.url })}><ExternalLink size={13} /> Open External</button>}
              </div>
              <p className="hint">Run NEXUS via <code>NEXUS.exe</code> for the full interactive native InPrivate WebView2 browser. In browser mode, pages are fetched privately through your configured proxy and rendered cleanly below.</p>
              {readerPage ? (
                <div style={{ marginTop: 14 }}>
                  <h3>{readerPage.title}</h3>
                  <pre className="pre-box" style={{ maxHeight: '58vh' }}>{readerPage.text}</pre>
                </div>
              ) : <p className="hint">Enter a URL or search query in the bar above and press Enter.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
