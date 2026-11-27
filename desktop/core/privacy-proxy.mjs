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

export const PRIVACY_MODE_GUIDE = [
  {
    id: 'wireguard-tor',
    rank: 1,
    label: 'Double-Hop: WireGuard → Tor',
    protectionLevel: 'Maximum Untraceability',
    whatIspSees: 'Only encrypted WireGuard UDP packets to your VPN server — your ISP NEVER sees that you are using Tor.',
    whatTargetSees: 'Only a rotating Tor exit node IP (or .onion rendezvous) — neither the VPN nor your ISP sees what sites or APIs you access.',
    tradeoffs: 'Higher latency (Tor 3-hop) and occasional CAPTCHAs on clearnet; full .onion / Torch access; zero impact on Windows.',
    requires: 'Imported WireGuard .conf (e.g. Mullvad / IVPN) + NEXUS Managed Tor.',
  },
  {
    id: 'wireguard',
    rank: 2,
    label: 'App-Scoped WireGuard VPN',
    protectionLevel: 'High · Fast Daily Driver',
    whatIspSees: 'Only encrypted WireGuard UDP traffic to your no-logs VPN server (zero DNS leaks).',
    whatTargetSees: 'Only the shared no-logs VPN server IP — hides your home/work IP with ~10ms latency and almost zero CAPTCHAs.',
    tradeoffs: 'Does not open .onion hidden services (switch to WireGuard → Tor or Managed Tor for .onion). Trusts the no-logs VPN provider.',
    requires: 'Imported WireGuard .conf (Mullvad €4.50/mo Monero, IVPN, Proton VPN, AirVPN).',
  },
  {
    id: 'managed-tor',
    rank: 3,
    label: 'NEXUS Managed Tor (App-Scoped)',
    protectionLevel: 'High · Free & .onion Ready',
    whatIspSees: 'Sees that you connect to a Tor guard node (encrypted content, unknown destinations).',
    whatTargetSees: 'Only a rotating Tor exit node IP; supports .onion hidden services (Torch, Ahmia) natively.',
    tradeoffs: 'Free and requires no VPN account, but slower than WireGuard and your ISP can tell Tor is in use.',
    requires: 'NEXUS Managed Tor started (127.0.0.1:9055).',
  },
  {
    id: 'tor',
    rank: 4,
    label: 'External Tor SOCKS5',
    protectionLevel: 'High · External Tor Daemon',
    whatIspSees: 'Tor guard node connection via your external Tor Browser / Tor service.',
    whatTargetSees: 'Tor exit node IP; supports .onion hidden services.',
    tradeoffs: 'Requires running Tor Browser or system Tor daemon externally on 127.0.0.1:9050 or 9150.',
    requires: 'External Tor SOCKS5 proxy running.',
  },
  {
    id: 'socks5',
    rank: 5,
    label: 'Custom SOCKS5 Proxy',
    protectionLevel: 'Custom Tunnel',
    whatIspSees: 'Traffic to your custom SOCKS5 server (e.g. SSH -D tunnel or VPN SOCKS5 endpoint).',
    whatTargetSees: 'IP of your SOCKS5 exit host.',
    tradeoffs: 'Privacy depends completely on the SOCKS5 server you point to.',
    requires: 'Valid socks5://host:port URL.',
  },
  {
    id: 'http',
    rank: 6,
    label: 'Custom HTTP / HTTPS Proxy',
    protectionLevel: 'Custom Proxy',
    whatIspSees: 'Connection to your configured HTTP proxy.',
    whatTargetSees: 'Exit IP of your HTTP proxy.',
    tradeoffs: 'Useful for corporate/approved proxies; does not resolve .onion.',
    requires: 'Valid http://host:port URL.',
  },
  {
    id: 'direct',
    rank: 7,
    label: 'Direct / System VPN',
    protectionLevel: 'Baseline (Uses OS Network)',
    whatIspSees: 'Normal traffic unless you have a system-wide VPN active on Windows.',
    whatTargetSees: 'Your real IP (or your system-wide Windows VPN IP if active).',
    tradeoffs: 'Fastest and zero setup, but relies on a Windows-wide VPN for IP privacy.',
    requires: 'None.',
  },
];

export function resolveEffectiveProxyUrl(settings = {}, torManager = null, wgManager = null) {
  const mode = settings?.browserProxyMode || 'direct';
  if (mode === 'direct') return '';
  if (mode === 'wireguard') {
    return wgManager?.isRunning?.() ? wgManager.getSocksUrl() : 'socks5://127.0.0.1:9060';
  }
  if (mode === 'wireguard-tor') {
    return torManager?.isRunning?.() ? torManager.getSocksUrl() : 'socks5://127.0.0.1:9055';
  }
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
    { id: 'nexus-wireguard', label: 'NEXUS App-Scoped WireGuard (SOCKS5)', url: 'socks5://127.0.0.1:9060', host: '127.0.0.1', port: 9060 },
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
      const respHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (Array.isArray(v)) for (const item of v) respHeaders.append(k, item);
        else if (v !== undefined) respHeaders.set(k, String(v));
      }
      const status = res.statusCode || 200;
      const nullBody = status === 204 || status === 205 || status === 304;
      if (nullBody) {
        res.resume();
        return doneResolve(new Response(null, { status, headers: respHeaders }));
      }
      const bodyStream = new ReadableStream({
        start(controller) {
          res.on('data', chunk => {
            try { controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)); } catch {}
          });
          res.on('end', () => {
            try { controller.close(); } catch {}
          });
          res.on('error', err => {
            try { controller.error(err); } catch {}
          });
        },
        cancel() {
          try { res.destroy(); } catch {}
          try { req.destroy(); } catch {}
        },
      });
      doneResolve(new Response(bodyStream, { status, headers: respHeaders }));
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

export function isLoopbackHost(hostname = '') {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

export function isOnionHost(hostname = '') {
  return String(hostname || '').toLowerCase().endsWith('.onion');
}

// App-wide outbound fetcher enforcing:
// 1. Strict Tor-only routing for .onion URLs (never leaks .onion to clearnet DNS)
// 2. Optional All-Traffic Tor/Proxy encryption (torRouteAllTraffic) for LLMs, web tools, connectors, gallery & updates
// 3. Optional Fail-Closed Kill-Switch (torStrictFailClosed) refusing direct clearnet fallback when Tor/Proxy is down
export function createNexusFetcher(getSettings, torManager = null, { baseFetch = fetch, scope = 'all', wgManager = null } = {}) {
  return async (urlInput, options = {}) => {
    const settings = typeof getSettings === 'function' ? (getSettings() || {}) : (getSettings || {});
    let parsed;
    try { parsed = new URL(String(urlInput)); } catch { return baseFetch(urlInput, options); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return baseFetch(urlInput, options);
    if (isLoopbackHost(parsed.hostname)) return baseFetch(urlInput, options);

    const onion = isOnionHost(parsed.hostname);
    const proxyUrl = resolveEffectiveProxyUrl(settings, torManager, wgManager);
    const mode = settings.browserProxyMode || 'direct';
    const routeAll = Boolean(settings.torRouteAllTraffic);
    const routeAgent = Boolean(settings.browserRouteAgentTraffic);
    const strictKillSwitch = Boolean(settings.torStrictFailClosed);

    if (onion) {
      const torProxy = (mode === 'managed-tor' || mode === 'wireguard-tor' || mode === 'tor') && proxyUrl && /^socks5h?:/i.test(proxyUrl)
        ? proxyUrl
        : (torManager?.isRunning?.() ? torManager.getSocksUrl() : '');
      if (!torProxy) {
        throw new Error('NEXUS Tor Shield blocked .onion request: an active Tor SOCKS5 proxy (or WireGuard -> Tor mode) is required to resolve .onion hidden services without DNS leaks.');
      }
      return proxiedFetch(parsed.href, options, torProxy);
    }

    const shouldProxy = routeAll || (scope === 'agent' && routeAgent);
    if (!shouldProxy) {
      return baseFetch(urlInput, options);
    }

    if (!proxyUrl) {
      if (strictKillSwitch) {
        throw new Error('NEXUS Kill-Switch blocked direct outbound connection: All-Traffic VPN/Tor routing is enabled, but no tunnel is configured.');
      }
      return baseFetch(urlInput, options);
    }

    if (mode === 'wireguard' && wgManager && !wgManager.isRunning()) {
      if (strictKillSwitch) {
        throw new Error('NEXUS Kill-Switch blocked direct outbound connection: App-Scoped WireGuard VPN is stopped. Start WireGuard or disable Strict Kill-Switch.');
      }
      return baseFetch(urlInput, options);
    }

    if ((mode === 'managed-tor' || mode === 'wireguard-tor') && torManager && !torManager.isRunning()) {
      if (strictKillSwitch) {
        throw new Error('NEXUS Kill-Switch blocked direct outbound connection: Managed Tor is stopped. Start Tor or disable Strict Kill-Switch.');
      }
      return baseFetch(urlInput, options);
    }

    if (mode === 'wireguard-tor' && wgManager && !wgManager.isRunning()) {
      if (strictKillSwitch) {
        throw new Error('NEXUS Kill-Switch blocked direct outbound connection: WireGuard -> Tor chain requires WireGuard to be running.');
      }
      return baseFetch(urlInput, options);
    }

    try {
      return await proxiedFetch(parsed.href, options, proxyUrl);
    } catch (err) {
      if (strictKillSwitch) {
        throw new Error(`NEXUS Kill-Switch blocked direct fallback after proxy failure (${err?.message || err}).`);
      }
      throw err;
    }
  };
}

export function buildPrivacyAudit(settings = {}, torManager = null, store = null, wgManager = null) {
  const proxyMode = settings.browserProxyMode || 'direct';
  const proxyUrl = resolveEffectiveProxyUrl(settings, torManager, wgManager);
  const torRunning = Boolean(torManager?.isRunning?.());
  const wgRunning = Boolean(wgManager?.isRunning?.());
  const routeAll = Boolean(settings.torRouteAllTraffic);
  const killSwitch = Boolean(settings.torStrictFailClosed);
  const strictSearch = Boolean(settings.searchStrictZeroTrack);
  const scrubPii = Boolean(settings.privacyScrubPii);
  const zeroLogSearch = ['searxng', 'duckduckgo', 'mojeek', 'startpage', 'brave', 'kagi', 'ahmia', 'torch', 'onion'].includes(settings.searchProvider || 'auto');
  const localModel = /^(custom|local)\//i.test(settings.model || '') || (settings.customProviders || []).some(p => /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(p.baseUrl) && String(settings.model || '').startsWith(p.id + '/'));
  const tunnelLive = (proxyMode === 'wireguard-tor' && wgRunning && torRunning)
    || (proxyMode === 'wireguard' && wgRunning)
    || (proxyMode === 'managed-tor' && torRunning)
    || (['tor', 'socks5', 'http'].includes(proxyMode) && Boolean(proxyUrl));

  const checks = [
    {
      id: 'inbound-loopback',
      category: 'Inbound',
      label: 'Loopback-Only Local Core Server + Constant-Time Auth',
      status: 'pass',
      weight: 12,
      detail: 'Core HTTP/SSE API binds strictly to 127.0.0.1 with 192-bit timing-safe token and loopback-only CORS (zero LAN/WAN exposure).',
    },
    {
      id: 'dpapi-vault',
      category: 'Storage',
      label: 'Encrypted Local Secret Vault (Windows DPAPI)',
      status: 'pass',
      weight: 8,
      detail: 'API keys & WireGuard private keys are encrypted per-user with Windows DPAPI and never exposed to renderer or prompts.',
    },
    {
      id: 'outbound-tor',
      category: 'Outbound',
      label: proxyMode === 'wireguard-tor'
        ? 'Double-Hop WireGuard -> Tor App-Scoped Tunnel'
        : proxyMode === 'wireguard'
          ? 'App-Scoped WireGuard VPN Tunnel (Zero System Impact)'
          : 'All-Traffic VPN / Tor Encrypted Tunneling',
      status: routeAll && proxyUrl ? (tunnelLive ? 'pass' : 'warn') : (proxyUrl ? 'warn' : 'fail'),
      weight: 25,
      detail: routeAll && proxyUrl
        ? (proxyMode === 'wireguard-tor'
          ? 'Maximum transport untraceability: ALL NEXUS traffic tunnels through Tor inside app-scoped WireGuard (ISP never sees Tor; VPN never sees destinations).'
          : `ALL outbound NEXUS traffic (LLMs, search, web tools, connectors, updates, browser) routes over ${proxyUrl} with remote DNS resolution.`)
        : proxyUrl
          ? `Tunnel (${proxyUrl}) applies to Browser only. Enable "Encrypt ALL App Traffic" or 1-Click Stealth Mode.`
          : 'Direct clearnet connections active. Import a WireGuard .conf (Mullvad/IVPN/Proton) or start Managed Tor.',
    },
    {
      id: 'kill-switch',
      category: 'Outbound',
      label: 'Fail-Closed Kill-Switch (No Clearnet Leak)',
      status: killSwitch && routeAll ? 'pass' : 'warn',
      weight: 15,
      detail: killSwitch
        ? 'Active: NEXUS refuses to fall back to direct clearnet if WireGuard/Tor disconnects; .onion requests are always fail-closed.'
        : 'Disabled: Enable Fail-Closed Kill-Switch so NEXUS never leaks clearnet traffic if your tunnel stops.',
    },
    {
      id: 'pii-scrubber',
      category: 'Context',
      label: 'Reversible Outbound PII & Local Path Scrubber',
      status: scrubPii ? 'pass' : 'warn',
      weight: 15,
      detail: scrubPii
        ? 'Active: Your Windows username, home directory, hostname, and custom rules are redacted from cloud LLM prompts and transparently restored for local tools.'
        : 'Disabled: Enable Outbound PII Scrubber so C:\\Users\\<name> and your PC hostname never leak into cloud prompts.',
    },
    {
      id: 'browser-shield',
      category: 'Browser',
      label: 'InPrivate Isolation, Tracker Blocker & WebRTC/DNS Shield',
      status: !settings.browserPersistentProfile && settings.browserBlockTrackers !== false && settings.browserAntiFingerprint !== false ? 'pass' : 'warn',
      weight: 10,
      detail: settings.browserPersistentProfile
        ? 'Account Mode active (cookies persist for logins). Switch to InPrivate + Wipe for untraceable research sessions.'
        : 'InPrivate ephemeral profile + network tracker blocker + WebRTC non-proxied UDP block + anti-fingerprinting enabled.',
    },
    {
      id: 'search-privacy',
      category: 'Search',
      label: 'Zero-Track Private Search Policy',
      status: strictSearch || zeroLogSearch ? 'pass' : 'warn',
      weight: 10,
      detail: strictSearch
        ? `Strict Zero-Track enabled (provider: ${settings.searchProvider || 'auto'}). Regular commercial fallbacks are disabled.`
        : `Active search provider: ${settings.searchProvider || 'auto'}. Enable Strict Zero-Track or configure SearXNG / Brave ZDR / Tor Onion search.`,
    },
    {
      id: 'inference-sovereignty',
      category: 'OPSEC',
      label: 'Model Inference & Prompt Caching Status',
      status: localModel ? 'pass' : 'info',
      weight: 5,
      detail: localModel
        ? `Using local inference (${settings.model}) — prompts never leave your machine.`
        : `Cloud model (${settings.model || 'default'}) · Prompt Caching ${settings.promptCaching !== false ? 'ON (preserved)' : 'OFF'} · Cache Affinity ${settings.cacheAffinity ? 'ON (preserved)' : 'OFF'}. Pay ZDR & VPN with no-KYC crypto (e.g. Monero) to break billing correlation.`,
    },
  ];

  const earned = checks.reduce((sum, c) => sum + (c.status === 'pass' ? c.weight : c.status === 'warn' || c.status === 'info' ? Math.round(c.weight * 0.45) : 0), 0);
  const recommendations = [
    !routeAll && 'Activate 1-Click Stealth Mode (or "Encrypt ALL App Traffic" + "Fail-Closed Kill-Switch") so LLM calls, searches, and updates route through your encrypted tunnel (preserving Prompt Caching & Cache Affinity).',
    !scrubPii && 'Enable "Reversible Outbound PII & Path Scrubber" so your Windows username (C:\\Users\\...) and PC hostname are never sent to cloud ZDR providers.',
    proxyMode === 'direct' && 'Import a WireGuard .conf from Mullvad (€4.50/mo with Monero, zero email) or IVPN for app-scoped VPN — or chain WireGuard -> Tor so your ISP never even sees Tor traffic.',
    !strictSearch && 'Enable "Strict Zero-Track Search" with SearXNG, DuckDuckGo, Mojeek, Brave ZDR, Kagi, or Torch/Ahmia (.onion).',
    'Use RAM-Only sessions for sensitive or high-risk topics (zero disk writes, convertible RAM-Only <-> Regular anytime by you or the AI).',
    'For true payment untraceability with a ZDR provider + Mullvad/IVPN: pay strictly with no-KYC crypto (e.g. Monero) and register over the InPrivate Tor/VPN browser.',
  ].filter(Boolean);

  return {
    score: Math.min(100, earned),
    tier: earned >= 85 ? 'Hardened' : earned >= 60 ? 'Protected' : 'Standard',
    checks,
    recommendations,
    stealthActive: Boolean(routeAll && killSwitch && scrubPii && strictSearch && !settings.browserPersistentProfile),
    cachingPreserved: Boolean(settings.promptCaching !== false || settings.cacheAffinity),
    customPromptProtected: Boolean(settings.globalInstructionsCustomized || settings.customSystemPrompt?.trim()),
    projectsCount: store?.state?.projects?.length || 0,
    modeGuide: PRIVACY_MODE_GUIDE,
  };
}

export async function checkPrivacyStatus(settings = {}, torManager = null, wgManager = null) {
  const proxyUrl = resolveEffectiveProxyUrl(settings, torManager, wgManager);
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
  if (proxyUrl && (settings?.browserProxyMode === 'managed-tor' || settings?.browserProxyMode === 'wireguard-tor' || settings?.browserProxyMode === 'tor')) {
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
