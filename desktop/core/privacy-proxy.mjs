import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const VPN_ADAPTER_PATTERNS = /wireguard|wintun|tailscale|mullvad|proton|openvpn|nordlynx|warp|cloudflare|expressvpn|surfshark|anyconnect|fortinet|pulse|zerotier|tap-windows|vpn/i;

export const TRACKER_DOMAINS = [
  'doubleclick.net', 'google-analytics.com', 'googletagmanager.com', 'googlesyndication.com',
  'googleadservices.com', 'adservice.google.com', 'connect.facebook.net', 'pixel.facebook.com',
  'analytics.tiktok.com', 'ads-twitter.com', 'static.ads-twitter.com', 'bat.bing.com',
  'clarity.ms', 'hotjar.com', 'mixpanel.com', 'segment.io', 'cdn.segment.com',
  'amplitude.com', 'scorecardresearch.com', 'quantserve.com', 'taboola.com',
  'outbrain.com', 'criteo.com', 'pubmatic.com', 'rubiconproject.com', 'adnxs.com',
  'amazon-adsystem.com', 'moatads.com', 'newrelic.com', 'bam.nr-data.net', 'sentry.io',
];

export const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}&kp=-2`, home: 'https://duckduckgo.com/' },
  startpage: { name: 'Startpage', url: q => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`, home: 'https://www.startpage.com/' },
  brave: { name: 'Brave Search', url: q => `https://search.brave.com/search?q=${encodeURIComponent(q)}`, home: 'https://search.brave.com/' },
  qwant: { name: 'Qwant', url: q => `https://www.qwant.com/?q=${encodeURIComponent(q)}`, home: 'https://www.qwant.com/' },
  searxng: { name: 'SearXNG (Custom)', url: (q, base) => `${String(base || 'https://searx.be').replace(/\/+$/, '')}/search?q=${encodeURIComponent(q)}`, home: 'https://searx.be/' },
};

export function resolveEffectiveProxyUrl(settings = {}, torManager = null) {
  const mode = settings?.browserProxyMode || 'direct';
  if (mode === 'direct') return '';
  if (mode === 'managed-tor') {
    return torManager?.isRunning?.() ? torManager.getSocksUrl() : 'socks5://127.0.0.1:9055';
  }
  if (mode === 'tor') {
    if (torManager?.isRunning?.()) return torManager.getSocksUrl();
    return settings.browserProxyUrl?.trim() || 'socks5://127.0.0.1:9050';
  }
  if (mode === 'custom' || mode === 'socks5' || mode === 'http') return String(settings.browserProxyUrl || '').trim();
  return '';
}

export function probeTcpPort(host, port, timeoutMs = 280) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export async function probeLocalProxies() {
  const candidates = [
    { id: 'nexus-tor', label: 'NEXUS Managed Tor (SOCKS5)', url: 'socks5://127.0.0.1:9055', host: '127.0.0.1', port: 9055 },
    { id: 'tor-daemon', label: 'Tor Daemon (SOCKS5)', url: 'socks5://127.0.0.1:9050', host: '127.0.0.1', port: 9050 },
    { id: 'tor-browser', label: 'Tor Browser (SOCKS5)', url: 'socks5://127.0.0.1:9150', host: '127.0.0.1', port: 9150 },
    { id: 'socks-1080', label: 'Local SOCKS5 (1080)', url: 'socks5://127.0.0.1:1080', host: '127.0.0.1', port: 1080 },
    { id: 'clash-7890', label: 'Local Proxy (7890)', url: 'http://127.0.0.1:7890', host: '127.0.0.1', port: 7890 },
    { id: 'http-8080', label: 'HTTP Proxy (8080)', url: 'http://127.0.0.1:8080', host: '127.0.0.1', port: 8080 },
  ];
  const results = await Promise.all(candidates.map(async c => ({ ...c, reachable: await probeTcpPort(c.host, c.port) })));
  return results;
}

export async function detectSystemVpn() {
  const adapters = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    const activeV4 = (list || []).find(i => !i.internal && i.family === 'IPv4');
    if (!activeV4) continue;
    if (VPN_ADAPTER_PATTERNS.test(name)) {
      adapters.push({ name, address: activeV4.address, source: 'interface' });
    }
  }
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        "Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object Name,InterfaceDescription | ConvertTo-Json -Compress",
      ], { timeout: 3500, windowsHide: true });
      const raw = stdout.trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of list) {
          const desc = `${item.Name || ''} ${item.InterfaceDescription || ''}`;
          if (VPN_ADAPTER_PATTERNS.test(desc) && !adapters.some(a => a.name === item.Name)) {
            adapters.push({ name: item.Name, description: item.InterfaceDescription, source: 'windows-adapter' });
          }
        }
      }
    } catch {}
  }
  return { active: adapters.length > 0, adapters };
}

// RFC 1928 SOCKS5 TCP tunnel with remote hostname resolution (zero DNS leaks!)
export function connectSocks5({ proxyHost, proxyPort, username = '', password = '', targetHost, targetPort, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxyHost, port: proxyPort });
    let stage = 'greeting';
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('SOCKS5 proxy connection timed out.')); }, timeoutMs);
    const fail = err => { clearTimeout(timer); socket.destroy(); reject(err); };

    socket.on('error', fail);
    socket.on('connect', () => {
      const methods = username ? [0x00, 0x02] : [0x00];
      socket.write(Buffer.from([0x05, methods.length, ...methods]));
    });

    const sendConnect = () => {
      stage = 'connect';
      const hostBuf = Buffer.from(targetHost, 'utf8');
      if (hostBuf.length > 255) return fail(new Error('SOCKS5 target hostname exceeds 255 bytes.'));
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(targetPort, 0);
      socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]), hostBuf, portBuf]));
    };

    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'greeting' && buffer.length >= 2) {
        const ver = buffer[0], method = buffer[1];
        buffer = buffer.subarray(2);
        if (ver !== 0x05 || method === 0xff) return fail(new Error('SOCKS5 proxy rejected authentication method.'));
        if (method === 0x02) {
          stage = 'auth';
          const u = Buffer.from(username, 'utf8'), p = Buffer.from(password, 'utf8');
          socket.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]));
        } else {
          sendConnect();
        }
      } else if (stage === 'auth' && buffer.length >= 2) {
        const status = buffer[1];
        buffer = buffer.subarray(2);
        if (status !== 0x00) return fail(new Error('SOCKS5 proxy authentication failed.'));
        sendConnect();
      } else if (stage === 'connect' && buffer.length >= 4) {
        if (buffer[0] !== 0x05 || buffer[1] !== 0x00) return fail(new Error(`SOCKS5 connect failed (code ${buffer[1]}).`));
        const atyp = buffer[3];
        let needed = 4;
        if (atyp === 0x01) needed = 4 + 4 + 2;
        else if (atyp === 0x03) needed = buffer.length >= 5 ? 5 + buffer[4] + 2 : 9999;
        else if (atyp === 0x04) needed = 4 + 16 + 2;
        else return fail(new Error(`SOCKS5 unsupported address type (${atyp}).`));
        if (buffer.length >= needed) {
          const leftover = buffer.subarray(needed);
          clearTimeout(timer);
          socket.removeAllListeners('data');
          socket.removeAllListeners('error');
          if (leftover.length) socket.unshift(leftover);
          resolve(socket);
        }
      }
    });
  });
}

// HTTP/HTTPS request routed over SOCKS5 or HTTP proxy, returning a standard Web Response
export async function proxiedFetch(urlInput, options = {}, proxyUrl = '') {
  if (!proxyUrl) return fetch(urlInput, options);
  const proxy = new URL(proxyUrl);
  const target = new URL(urlInput);
  const isHttps = target.protocol === 'https:';
  const targetPort = Number(target.port) || (isHttps ? 443 : 80);
  const method = (options.method || 'GET').toUpperCase();
  const headers = { Host: target.host, ...(options.headers || {}) };
  const bodyBuf = options.body !== undefined && options.body !== null
    ? (Buffer.isBuffer(options.body) ? options.body : Buffer.from(typeof options.body === 'string' ? options.body : JSON.stringify(options.body)))
    : null;
  if (bodyBuf && !headers['Content-Length'] && !headers['content-length']) {
    headers['Content-Length'] = String(bodyBuf.length);
  }
  if (options.signal?.aborted) throw new Error('Aborted');

  let tunnelSocket;
  if (proxy.protocol === 'socks5:' || proxy.protocol === 'socks5h:') {
    tunnelSocket = await connectSocks5({
      proxyHost: proxy.hostname,
      proxyPort: Number(proxy.port) || 1080,
      username: decodeURIComponent(proxy.username || ''),
      password: decodeURIComponent(proxy.password || ''),
      targetHost: target.hostname,
      targetPort,
    });
  } else if (proxy.protocol === 'http:' || proxy.protocol === 'https:') {
    tunnelSocket = await new Promise((resolve, reject) => {
      const connectReq = (proxy.protocol === 'https:' ? https : http).request({
        host: proxy.hostname,
        port: Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 8080),
        method: 'CONNECT',
        path: `${target.hostname}:${targetPort}`,
        timeout: 20000,
        headers: proxy.username ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64') } : {},
      });
      const onAbort = () => { connectReq.destroy(new Error('Aborted')); };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      connectReq.on('timeout', () => { connectReq.destroy(new Error('HTTP proxy CONNECT timed out.')); });
      connectReq.on('connect', (res, sock) => {
        options.signal?.removeEventListener('abort', onAbort);
        if (res.statusCode !== 200) { sock.destroy(); reject(new Error(`HTTP proxy CONNECT failed (${res.statusCode})`)); }
        else resolve(sock);
      });
      connectReq.on('error', err => { options.signal?.removeEventListener('abort', onAbort); reject(err); });
      connectReq.end();
    });
  } else {
    throw new Error('Unsupported proxy protocol: ' + proxy.protocol);
  }

  const transportSocket = isHttps
    ? tls.connect({ socket: tunnelSocket, servername: target.hostname })
    : tunnelSocket;

  return new Promise((resolve, reject) => {
    let settled = false;
    const doneReject = err => { if (!settled) { settled = true; reject(err); } };
    const doneResolve = val => { if (!settled) { settled = true; resolve(val); } };
    transportSocket.on('error', doneReject);
    const req = (isHttps ? https : http).request({
      createConnection: () => transportSocket,
      hostname: target.hostname,
      port: targetPort,
      path: target.pathname + target.search,
      method,
      headers,
    }, res => {
      const chunks = [];
      res.on('error', doneReject);
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const respHeaders = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (Array.isArray(v)) for (const item of v) respHeaders.append(k, item);
          else if (v !== undefined) respHeaders.set(k, String(v));
        }
        const status = res.statusCode || 200;
        const nullBody = status === 204 || status === 205 || status === 304;
        doneResolve(new Response(nullBody ? null : Buffer.concat(chunks), { status, headers: respHeaders }));
      });
    });
    req.on('error', doneReject);
    if (options.signal) {
      if (options.signal.aborted) { req.destroy(); return doneReject(new Error('Aborted')); }
      options.signal.addEventListener('abort', () => req.destroy(new Error('Aborted')), { once: true });
    }
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

export async function checkPrivacyStatus(settings = {}, torManager = null) {
  const proxyUrl = resolveEffectiveProxyUrl(settings, torManager);
  const [vpn, localProxies] = await Promise.all([detectSystemVpn(), probeLocalProxies()]);
  let ipInfo = null;
  let ipError = null;
  let isTorExit = false;
  try {
    const res = await proxiedFetch('https://ipwho.is/', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(14000) }, proxyUrl);
    if (res.ok) {
      const data = await res.json();
      ipInfo = {
        ip: data.ip || null,
        country: data.country || null,
        countryCode: data.country_code || null,
        city: data.city || null,
        isp: data.connection?.isp || data.connection?.org || null,
        viaProxy: Boolean(proxyUrl),
      };
    }
  } catch (err) {
    ipError = err?.message || 'Could not reach IP check endpoint';
  }
  if (proxyUrl && (settings?.browserProxyMode === 'managed-tor' || settings?.browserProxyMode === 'tor')) {
    try {
      const torRes = await proxiedFetch('https://check.torproject.org/api/ip', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(14000) }, proxyUrl);
      if (torRes.ok) {
        const torJson = await torRes.json();
        isTorExit = Boolean(torJson.IsTor);
        if (!ipInfo && torJson.IP) {
          ipInfo = { ip: torJson.IP, country: null, countryCode: null, city: null, isp: 'Tor Exit Relay', viaProxy: true };
          ipError = null;
        }
      }
    } catch {}
  }
  return {
    checkedAt: new Date().toISOString(),
    proxyMode: settings?.browserProxyMode || 'direct',
    proxyUrl,
    isTorExit,
    tor: torManager ? torManager.status() : null,
    vpn,
    localProxies,
    ipInfo,
    ipError,
  };
}
