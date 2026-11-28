import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';

const execFileAsync = promisify(execFile);

const WIREPROXY_RELEASE_API = 'https://api.github.com/repos/windtf/wireproxy/releases/latest';
const VAULT_KEY = 'WIREGUARD_PROFILES_JSON';

// Parses and validates a standard WireGuard .conf (Mullvad, IVPN, Proton, AirVPN, Windscribe, custom).
// Extracts non-secret metadata for UI display while validating required cryptographic keys & endpoint.
export function parseWireGuardConfig(rawText = '', explicitName = '') {
  const text = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!text) throw new Error('WireGuard configuration is empty.');

  const lines = text.split('\n');
  let section = '';
  let privateKey = '';
  let address = '';
  let dns = '';
  let publicKey = '';
  let endpoint = '';
  let allowedIps = '';
  let hasPresharedKey = false;
  let inferredProvider = 'WireGuard';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const secM = /^\[([^\]]+)\]$/.exec(line);
    if (secM) {
      section = secM[1].trim().toLowerCase();
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim();
    if (section === 'interface') {
      if (key === 'privatekey') privateKey = val;
      else if (key === 'address') address = val;
      else if (key === 'dns') dns = val;
    } else if (section === 'peer') {
      if (key === 'publickey') publicKey = val;
      else if (key === 'endpoint') endpoint = val;
      else if (key === 'allowedips') allowedIps = val;
      else if (key === 'presharedkey' && val) hasPresharedKey = true;
    }
  }

  // Infer provider ONLY from explicit profile name or non-comment Endpoint hostname (never from free-form # comments)
  const providerHintSource = `${explicitName || ''} ${endpoint || ''}`;
  if (/mullvad/i.test(providerHintSource)) inferredProvider = 'Mullvad';
  else if (/ivpn/i.test(providerHintSource)) inferredProvider = 'IVPN';
  else if (/proton/i.test(providerHintSource)) inferredProvider = 'Proton VPN';
  else if (/airvpn/i.test(providerHintSource)) inferredProvider = 'AirVPN';
  else if (/windscribe/i.test(providerHintSource)) inferredProvider = 'Windscribe';

  if (!privateKey || privateKey.length < 32) {
    throw new Error('Invalid WireGuard .conf: missing [Interface] PrivateKey.');
  }
  if (!address) {
    throw new Error('Invalid WireGuard .conf: missing [Interface] Address.');
  }
  if (!publicKey || publicKey.length < 32) {
    throw new Error('Invalid WireGuard .conf: missing [Peer] PublicKey.');
  }
  if (!endpoint || !endpoint.includes(':')) {
    throw new Error('Invalid WireGuard .conf: missing [Peer] Endpoint (host:port).');
  }

  // Strip any pre-existing [Socks5] / [http] section so NEXUS controls the loopback binding safely
  const cleanLines = [];
  let skipSection = false;
  for (const rawLine of lines) {
    const t = rawLine.trim();
    const secM = /^\[([^\]]+)\]$/.exec(t);
    if (secM) {
      const sName = secM[1].trim().toLowerCase();
      skipSection = sName === 'socks5' || sName === 'http';
      if (!skipSection) cleanLines.push(rawLine);
      continue;
    }
    if (!skipSection) cleanLines.push(rawLine);
  }

  const endpointHost = endpoint.replace(/^\[([^\]]+)\]:\d+$/, '$1').replace(/:\d+$/, '');
  const cleanName = String(explicitName || '').trim().slice(0, 80) || `${inferredProvider} · ${endpointHost}`;
  const allowedIpsDefaulted = !Boolean(allowedIps);

  return {
    name: cleanName,
    provider: inferredProvider,
    endpoint,
    endpointHost,
    address,
    dns: dns || '1.1.1.1',
    allowedIps: allowedIps || '0.0.0.0/0, ::/0',
    allowedIpsDefaulted,
    ...(allowedIpsDefaulted ? { warning: 'No AllowedIPs specified in [Peer]; defaulted to full app-scoped tunnel (0.0.0.0/0, ::/0).' } : {}),
    hasPresharedKey,
    publicKeyPrefix: publicKey.slice(0, 10) + '…',
    cleanConfig: cleanLines.join('\n').trim(),
  };
}

// Builds a wireproxy config exposing a strictly loopback-only SOCKS5 proxy (zero Windows routing changes).
export function buildWireproxyConfig(cleanWgConfig, socksPort = 9060) {
  const port = Math.max(1024, Math.min(65535, Number(socksPort) || 9060));
  return `${String(cleanWgConfig || '').trim()}\n\n[Socks5]\nBindAddress = 127.0.0.1:${port}\n`;
}

function waitForTcp(host, port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect({ host, port });
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() >= deadline) reject(new Error(`WireGuard local SOCKS5 proxy did not open on ${host}:${port} within ${timeoutMs}ms.`));
        else setTimeout(attempt, 180);
      });
    };
    attempt();
  });
}

// App-scoped user-space WireGuard VPN manager powered by wireproxy (zero admin rights, zero Windows adapters).
export class WireGuardManager extends EventEmitter {
  constructor(dataDir, { vault = null, bundledDir = '', socksPort = 9060 } = {}) {
    super();
    this.dataDir = dataDir;
    this.vault = vault;
    this.bundledDir = bundledDir;
    this.installDir = path.join(dataDir, 'wireguard');
    this.socksPort = socksPort;
    this.child = null;
    this.activeConfigPath = null;
    this.activeProfileId = null;
    this.statusState = 'stopped'; // stopped | installing | starting | running | error
    this.installProgress = '';
    this.error = null;
    this.version = null;
    this.logs = [];
    this.installingPromise = null;
    this.startingPromise = null;
  }

  resolveBinary(customPath = '') {
    const candidates = [
      ...(customPath ? [customPath] : []),
      path.join(this.installDir, 'wireproxy.exe'),
      path.join(this.installDir, 'bin', 'wireproxy.exe'),
      ...(this.bundledDir ? [
        path.join(this.bundledDir, 'wireguard', 'wireproxy.exe'),
        path.join(this.bundledDir, 'wireproxy.exe'),
      ] : []),
    ];
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p;
    }
    return null;
  }

  getSocksUrl() {
    return `socks5://127.0.0.1:${this.socksPort}`;
  }

  isRunning() {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null && this.statusState === 'running');
  }

  _loadProfilesRaw() {
    if (!this.vault) return [];
    const raw = this.vault.get(VAULT_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  _saveProfilesRaw(list) {
    if (!this.vault) throw new Error('DPAPI SecretVault is required to store WireGuard private keys securely.');
    this.vault.set(VAULT_KEY, JSON.stringify(list));
  }

  // Public metadata only — NEVER returns private keys or raw .conf text to the renderer.
  listProfiles() {
    return this._loadProfilesRaw().map(p => ({
      id: p.id,
      name: p.name,
      provider: p.provider,
      endpoint: p.endpoint,
      endpointHost: p.endpointHost,
      address: p.address,
      dns: p.dns,
      hasPresharedKey: Boolean(p.hasPresharedKey),
      publicKeyPrefix: p.publicKeyPrefix,
      addedAt: p.addedAt,
      active: p.id === this.activeProfileId && this.isRunning(),
    }));
  }

  addProfile({ name = '', configText = '' } = {}) {
    const parsed = parseWireGuardConfig(configText, name);
    const list = this._loadProfilesRaw();
    const id = 'wg-' + crypto.randomUUID().slice(0, 8);
    const entry = {
      id,
      name: parsed.name,
      provider: parsed.provider,
      endpoint: parsed.endpoint,
      endpointHost: parsed.endpointHost,
      address: parsed.address,
      dns: parsed.dns,
      hasPresharedKey: parsed.hasPresharedKey,
      publicKeyPrefix: parsed.publicKeyPrefix,
      cleanConfig: parsed.cleanConfig,
      addedAt: new Date().toISOString(),
    };
    list.push(entry);
    this._saveProfilesRaw(list);
    this.emitStatus();
    return this.listProfiles().find(p => p.id === id);
  }

  async removeProfile(id) {
    if (this.activeProfileId === id) await this.stop();
    const list = this._loadProfilesRaw().filter(p => p.id !== id);
    this._saveProfilesRaw(list);
    this.emitStatus();
    return this.listProfiles();
  }

  pushLog(line) {
    const clean = String(line || '').trim();
    if (!clean) return;
    this.logs.push(clean.slice(0, 300));
    if (this.logs.length > 80) this.logs.shift();
  }

  status(customBinaryPath = '') {
    const bin = this.resolveBinary(customBinaryPath);
    const profiles = this.listProfiles();
    const activeProfile = profiles.find(p => p.id === this.activeProfileId) || null;
    return {
      installed: Boolean(bin),
      binaryPath: bin || null,
      state: this.statusState,
      running: this.isRunning(),
      installProgress: this.installProgress,
      socksPort: this.socksPort,
      socksUrl: this.getSocksUrl(),
      version: this.version,
      activeProfileId: this.activeProfileId,
      activeProfile,
      profiles,
      error: this.error,
      logs: this.logs.slice(-25),
    };
  }

  emitStatus() {
    this.emit('status', this.status());
  }

  async install({ force = false, request = fetch } = {}) {
    if (!force && this.resolveBinary()) return this.status();
    if (this.installingPromise) return this.installingPromise;

    this.installingPromise = (async () => {
      if (process.platform !== 'win32') {
        throw new Error('NEXUS WireGuard user-space installer targets Windows x64.');
      }
      this.error = null;
      this.statusState = 'installing';
      this.installProgress = 'Fetching official wireproxy Windows release…';
      this.emitStatus();
      try {
        await fsp.mkdir(this.installDir, { recursive: true });
        const metaRes = await request(WIREPROXY_RELEASE_API, {
          headers: { 'User-Agent': 'NEXUS/1.5.0', Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(15000),
        });
        if (!metaRes.ok) throw new Error(`GitHub wireproxy release lookup failed (HTTP ${metaRes.status}).`);
        const rel = await metaRes.json();
        const asset = (rel.assets || []).find(a => /wireproxy_windows_amd64\.tar\.gz$/i.test(a.name))
          || (rel.assets || []).find(a => /windows.*amd64.*\.(tar\.gz|zip)$/i.test(a.name));
        if (!asset?.browser_download_url) {
          throw new Error('Could not find wireproxy_windows_amd64.tar.gz in latest release.');
        }
        this.version = String(rel.tag_name || '').replace(/^v/i, '');
        this.installProgress = `Downloading wireproxy ${rel.tag_name} (${(asset.size / 1048576).toFixed(1)} MB)…`;
        this.emitStatus();

        const dl = await request(asset.browser_download_url, {
          headers: { 'User-Agent': 'NEXUS/1.5.0' },
          signal: AbortSignal.timeout(90000),
        });
        if (!dl.ok) throw new Error(`wireproxy download failed (HTTP ${dl.status}).`);
        const buf = Buffer.from(await dl.arrayBuffer());

        if (asset.digest && asset.digest.startsWith('sha256:')) {
          const expected = asset.digest.slice(7).toLowerCase();
          const actual = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
          if (actual !== expected) {
            throw new Error(`wireproxy SHA-256 verification failed (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…).`);
          }
        }

        const archivePath = path.join(this.installDir, asset.name);
        await fsp.writeFile(archivePath, buf);
        this.installProgress = 'Extracting wireproxy.exe…';
        this.emitStatus();
        await execFileAsync('tar.exe', ['-xzf', archivePath, '-C', this.installDir], { timeout: 60000, windowsHide: true });
        await fsp.rm(archivePath, { force: true }).catch(() => {});

        const bin = this.resolveBinary();
        if (!bin) throw new Error('wireproxy.exe was not found after extraction.');
        this.installProgress = '';
        this.statusState = 'stopped';
        this.pushLog(`Installed wireproxy ${this.version} at ${bin}`);
        this.emitStatus();
        return this.status();
      } catch (err) {
        this.error = err?.message || String(err);
        this.installProgress = '';
        this.statusState = 'error';
        this.pushLog('Install error: ' + this.error);
        this.emitStatus();
        throw err;
      } finally {
        this.installingPromise = null;
      }
    })();

    return this.installingPromise;
  }

  async start({ profileId = '', autoInstall = true, customBinaryPath = '', request = fetch } = {}) {
    if (this.startingPromise) return this.startingPromise;

    this.startingPromise = (async () => {
      const profiles = this._loadProfilesRaw();
      const target = (profileId ? profiles.find(p => p.id === profileId) : null)
        || (this.activeProfileId ? profiles.find(p => p.id === this.activeProfileId) : null)
        || profiles[0];
      if (!target) {
        throw new Error('No WireGuard profile imported yet. Import a .conf file from Mullvad, IVPN, Proton VPN, or AirVPN first.');
      }

      let bin = this.resolveBinary(customBinaryPath);
      if (!bin) {
        if (!autoInstall) throw new Error('wireproxy.exe is not installed yet.');
        await this.install({ request });
        bin = this.resolveBinary(customBinaryPath);
      }
      if (!bin) throw new Error('Could not locate wireproxy.exe.');

      await this.stop();
      await fsp.mkdir(this.installDir, { recursive: true });

      this.error = null;
      this.statusState = 'starting';
      this.activeProfileId = target.id;
      this.emitStatus();

      const cfgPath = path.join(this.installDir, `.active-${crypto.randomUUID().slice(0, 8)}.conf`);
      const cfgContent = buildWireproxyConfig(target.cleanConfig, this.socksPort);
      await fsp.writeFile(cfgPath, cfgContent, { encoding: 'utf8', mode: 0o600 });
      this.activeConfigPath = cfgPath;

      const child = spawn(bin, ['-c', cfgPath], {
        cwd: this.installDir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;

      let earlyExitErr = null;
      const onOutput = chunk => {
        for (const line of String(chunk || '').split(/\r?\n/)) {
          if (line.trim()) this.pushLog(line.trim());
        }
      };
      child.stdout?.on('data', onOutput);
      child.stderr?.on('data', onOutput);
      child.once('exit', code => {
        const wasCurrent = this.child === child;
        if (wasCurrent) {
          this.child = null;
          if (this.statusState === 'starting') {
            earlyExitErr = new Error(`wireproxy exited early (code ${code ?? 'unknown'}). ${this.logs.at(-1) || ''}`.trim());
          }
          if (this.statusState !== 'stopped') {
            this.statusState = code === 0 ? 'stopped' : 'error';
            if (code && code !== 0 && !this.error) this.error = `wireproxy exited with code ${code}`;
          }
          this._cleanupTempConfig();
          this.emitStatus();
        }
      });

      try {
        await waitForTcp('127.0.0.1', this.socksPort, 8000);
        if (earlyExitErr) throw earlyExitErr;
        this.statusState = 'running';
        this.pushLog(`WireGuard tunnel connected (${target.name}) -> socks5://127.0.0.1:${this.socksPort}`);
        this.emitStatus();
        return this.status(customBinaryPath);
      } catch (err) {
        await this.stop();
        this.error = earlyExitErr?.message || err?.message || String(err);
        this.statusState = 'error';
        this.emitStatus();
        throw new Error(this.error);
      }
    })();

    try { return await this.startingPromise; }
    finally { this.startingPromise = null; }
  }

  _cleanupTempConfig() {
    if (this.activeConfigPath) {
      const p = this.activeConfigPath;
      this.activeConfigPath = null;
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
    }
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this.statusState = 'stopped';
    this.error = null;
    if (child && !child.killed) {
      try { child.kill(); } catch {}
      await new Promise(resolve => {
        const t = setTimeout(resolve, 1500);
        child.once('exit', () => { clearTimeout(t); resolve(); });
      });
    }
    this._cleanupTempConfig();
    this.emitStatus();
    return this.status();
  }
}
