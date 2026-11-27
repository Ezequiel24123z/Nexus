// Unified NEXUS bridge: connects cleanly to the native .NET WebView2 host when present,
// and falls back seamlessly to the local NEXUS Core HTTP/SSE server in standalone browser mode.

function resolveConnection() {
  const boot = window.__NEXUS_BOOTSTRAP__;
  const params = new URLSearchParams(window.location.search);
  const token = boot?.token || params.get('token') || sessionStorage.getItem('nexus-token') || '';
  if (token) {
    try { sessionStorage.setItem('nexus-token', token); } catch {}
  }
  const serverUrl = boot?.serverUrl || (window.location.origin.startsWith('http') ? window.location.origin : 'http://127.0.0.1:4789');
  const nativeHost = Boolean(boot?.nativeHost && window.chrome?.webview);
  return { serverUrl, token, nativeHost };
}

const conn = resolveConnection();
const pendingNative = new Map();
const changeListeners = new Set();
const deltaListeners = new Set();
const terminalListeners = new Set();
const notifyListeners = new Set();
const torListeners = new Set();
const wireguardListeners = new Set();
const browserListeners = new Set();
let nativeSeq = 0;

if (conn.nativeHost && window.chrome?.webview) {
  window.chrome.webview.addEventListener('message', event => {
    let msg;
    try { msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
    if (!msg) return;
    if (msg.event === 'browserState') {
      for (const cb of browserListeners) { try { cb(msg.data); } catch {} }
      return;
    }
    if (msg.event === 'conpty') {
      for (const cb of terminalListeners) { try { cb(msg.data); } catch {} }
      return;
    }
    if (!msg.id) return;
    const entry = pendingNative.get(msg.id);
    if (!entry) return;
    pendingNative.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error || 'Native host call failed.'));
  });
}

export function callNative(method, args = {}) {
  if (!conn.nativeHost || !window.chrome?.webview) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const id = 'nat-' + (++nativeSeq);
    pendingNative.set(id, { resolve, reject });
    window.chrome.webview.postMessage({ id, method, args });
  });
}

async function callServer(method, args = {}) {
  const res = await fetch(`${conn.serverUrl}/api/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(conn.token ? { 'X-Nexus-Token': conn.token } : {}),
    },
    body: JSON.stringify({ method, args }),
  });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data.result;
}

function browserPickFiles({ multiple = true, accept = '' } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    if (accept) input.accept = accept;
    input.onchange = () => resolve([...(input.files || [])]);
    input.click();
  });
}

export async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function downloadBlob(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const NATIVE_PASSTHROUGH = new Set([
  'setTrayMode', 'openDevTools', 'relaunchElevated', 'notify', 'logError',
  'browserShow', 'browserBounds', 'browserHide', 'browserNavigate',
  'browserBack', 'browserForward', 'browserReload', 'browserWipe',
  'browserExtract', 'browserScreenshot',
]);

if (typeof window !== 'undefined' && conn.nativeHost) {
  window.addEventListener('error', ev => {
    void callNative('logError', { source: 'window.onerror', message: `${ev.message} (${ev.filename}:${ev.lineno})` }).catch(() => {});
  });
  window.addEventListener('unhandledrejection', ev => {
    void callNative('logError', { source: 'unhandledrejection', message: String(ev.reason?.stack || ev.reason || 'Promise rejection').slice(0, 1200) }).catch(() => {});
  });
}

const CONPTY_MAP = {
  termCreate: 'conptyCreate',
  termWrite: 'conptyWrite',
  termResize: 'conptyResize',
  termInterrupt: 'conptyInterrupt',
  termClear: 'conptyClear',
  termGet: 'conptyGet',
  termList: 'conptyList',
  termClose: 'conptyClose',
};

async function invoke(method, args = {}) {
  if (method === 'setNativeTheme') {
    if (conn.nativeHost) return callNative('setTheme', args);
    return true;
  }
  if (CONPTY_MAP[method]) {
    if (conn.nativeHost) {
      try { return await callNative(CONPTY_MAP[method], args); }
      catch { /* fall back gracefully to Node server terminal if ConPTY is unavailable */ }
    }
    if (method === 'termResize') return { ok: true };
    return callServer(method, args);
  }
  if (NATIVE_PASSTHROUGH.has(method)) {
    return conn.nativeHost ? callNative(method, args) : null;
  }
  if (method === 'chooseWorkspace') {
    if (conn.nativeHost) return callNative('chooseWorkspace', args);
    const entered = window.prompt('Enter local workspace folder path:', args.defaultPath || '');
    return entered && entered.trim() ? entered.trim() : null;
  }
  if (method === 'chooseAttachments') {
    if (conn.nativeHost) {
      const paths = await callNative('chooseAttachments');
      if (!Array.isArray(paths) || !paths.length) return { attachments: [], errors: [] };
      return callServer('importAttachmentPaths', { filePaths: paths });
    }
    const files = await browserPickFiles({ multiple: true });
    if (!files.length) return { attachments: [], errors: [] };
    const attachments = [], errors = [];
    for (const file of files) {
      try {
        const base64 = await fileToBase64(file);
        attachments.push(await callServer('uploadAttachment', { name: file.name, base64 }));
      } catch (e) {
        errors.push(`${file.name}: ${e.message}`);
      }
    }
    return { attachments, errors };
  }
  if (method === 'inspectRecovery') {
    let source = args.source;
    if (!source) {
      if (conn.nativeHost) source = await callNative('pickBackupFile');
      else source = window.prompt('Enter full path to backup (.json or .sqlite):');
    }
    if (!source) return null;
    return callServer('inspectRecoveryPath', { source });
  }
  if (method === 'restoreRecovery') {
    let destination = args.destination;
    if (!destination) {
      if (conn.nativeHost) destination = await callNative('pickDirectory', { title: 'Destination folder for isolated recovery' });
      else destination = window.prompt('Enter destination folder path for isolated recovery:');
    }
    if (!destination) return null;
    return callServer('restoreRecoveryPath', { token: args.token, destination });
  }
  if (method === 'exportStorage') {
    let filePath = args.filePath;
    if (!filePath && conn.nativeHost) {
      filePath = await callNative('pickSaveFile', { defaultPath: 'nexus-workspace-export.json', filter: 'NEXUS State (*.json)|*.json' });
      if (!filePath) return false;
    }
    const res = await callServer('exportStoragePath', { filePath });
    return res?.ok ? res : false;
  }
  if (method === 'exportTask') {
    if (conn.nativeHost) {
      const filePath = await callNative('pickSaveFile', { defaultPath: `nexus-${String(args.id || '').slice(0, 8)}.md`, filter: 'Markdown (*.md)|*.md' });
      if (!filePath) return false;
      return callServer('exportTaskMarkdown', { id: args.id, filePath });
    }
    const data = await callServer('exportTaskMarkdown', { id: args.id });
    downloadBlob(data.filename, data.markdown, 'text/markdown;charset=utf-8');
    return true;
  }
  if (method === 'openExternal' && conn.nativeHost) {
    return callNative('openExternal', { target: args.url });
  }
  return callServer(method, args);
}

let eventSource = null;

function ensureStream() {
  if (eventSource || typeof EventSource === 'undefined') return;
  const qs = conn.token ? `?token=${encodeURIComponent(conn.token)}` : '';
  eventSource = new EventSource(`${conn.serverUrl}/api/events${qs}`);
  eventSource.addEventListener('change', event => {
    try {
      const state = JSON.parse(event.data);
      for (const cb of changeListeners) cb(state);
    } catch {}
  });
  eventSource.addEventListener('delta', event => {
    try {
      const delta = JSON.parse(event.data);
      for (const cb of deltaListeners) cb(delta);
    } catch {}
  });
  eventSource.addEventListener('terminal', event => {
    try {
      const data = JSON.parse(event.data);
      for (const cb of terminalListeners) cb({ type: 'data', ...data });
    } catch {}
  });
  eventSource.addEventListener('terminal_exit', event => {
    try {
      const data = JSON.parse(event.data);
      for (const cb of terminalListeners) cb({ type: 'exit', ...data });
    } catch {}
  });
  eventSource.addEventListener('notify', event => {
    try {
      const data = JSON.parse(event.data);
      if (conn.nativeHost && document.hidden) void callNative('notify', data).catch(() => {});
      for (const cb of notifyListeners) cb(data);
    } catch {}
  });
  eventSource.addEventListener('tor', event => {
    try {
      const data = JSON.parse(event.data);
      for (const cb of torListeners) cb(data);
    } catch {}
  });
  eventSource.addEventListener('wireguard', event => {
    try {
      const data = JSON.parse(event.data);
      for (const cb of wireguardListeners) cb(data);
    } catch {}
  });
}

function maybeCloseStream() {
  if (!changeListeners.size && !deltaListeners.size && !terminalListeners.size && !notifyListeners.size && !torListeners.size && !wireguardListeners.size && eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

const subscribe = cb => { changeListeners.add(cb); ensureStream(); return () => { changeListeners.delete(cb); maybeCloseStream(); }; };
const subscribeDelta = cb => { deltaListeners.add(cb); ensureStream(); return () => { deltaListeners.delete(cb); maybeCloseStream(); }; };
const subscribeTerminal = cb => { terminalListeners.add(cb); ensureStream(); return () => { terminalListeners.delete(cb); maybeCloseStream(); }; };
const subscribeNotify = cb => { notifyListeners.add(cb); ensureStream(); return () => { notifyListeners.delete(cb); maybeCloseStream(); }; };
const subscribeTor = cb => { torListeners.add(cb); ensureStream(); return () => { torListeners.delete(cb); maybeCloseStream(); }; };
const subscribeWireguard = cb => { wireguardListeners.add(cb); ensureStream(); return () => { wireguardListeners.delete(cb); maybeCloseStream(); }; };
const subscribeBrowser = cb => { browserListeners.add(cb); return () => { browserListeners.delete(cb); }; };

function mediaUrl(mediaId) {
  if (!mediaId) return '';
  const qs = conn.token ? `?token=${encodeURIComponent(conn.token)}` : '';
  return `${conn.serverUrl}/api/media/${encodeURIComponent(mediaId)}${qs}`;
}

function beforeClose(callback) {
  const handler = () => { void Promise.resolve().then(callback).catch(() => {}); };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}

export function installNexusBridge() {
  if (!window.nexus) {
    window.nexus = {
      invoke,
      subscribe,
      subscribeDelta,
      subscribeTerminal,
      subscribeNotify,
      subscribeTor,
      subscribeWireguard,
      subscribeBrowser,
      mediaUrl,
      beforeClose,
      nativeHost: conn.nativeHost,
      serverUrl: conn.serverUrl,
    };
  }
  return window.nexus;
}

export { invoke, subscribe, subscribeDelta, subscribeTerminal, subscribeNotify, subscribeTor, subscribeWireguard, subscribeBrowser, mediaUrl, beforeClose, conn as bridgeConnection };
