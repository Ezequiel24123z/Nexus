import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';

const execFileAsync = promisify(execFile);

const TOR_MIRRORS = [
  'https://dist.torproject.org/torbrowser/',
];

const FALLBACK_VERSION = '16.0.3';

// NEXUS-managed portable Tor daemon.
// Runs an isolated tor.exe bound strictly to 127.0.0.1 (never touches Windows system proxy).
// Routes ONLY NEXUS's integrated browser and optional NEXUS agent outbound requests.
export class TorManager extends EventEmitter {
  constructor(dataDir, { bundledDir = '' } = {}) {
    super();
    this.dataDir = dataDir;
    this.bundledDir = bundledDir;
    this.installDir = path.join(dataDir, 'tor');
    this.torDataDir = path.join(dataDir, 'tor-data');
    this.socksPort = 9055;
    this.controlPort = 9056;
    this.child = null;
    this.statusState = 'stopped'; // stopped | installing | starting | running | error
    this.bootstrapPct = 0;
    this.bootstrapSummary = '';
    this.installProgress = '';
    this.error = null;
    this.version = null;
    this.logs = [];
    this.upstreamSocks5 = '';
    this.installingPromise = null;
    this.startingPromise = null;
  }

  resolveTorBinary() {
    const candidates = [
      path.join(this.installDir, 'tor', 'tor.exe'),
      path.join(this.installDir, 'tor.exe'),
      ...(this.bundledDir ? [
        path.join(this.bundledDir, 'tor', 'tor', 'tor.exe'),
        path.join(this.bundledDir, 'tor', 'tor.exe'),
      ] : []),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  resolveDataFile(torExe, name) {
    const base = path.dirname(torExe);
    const candidates = [
      path.join(base, '..', 'data', name),
      path.join(base, name),
      path.join(this.installDir, 'data', name),
    ];
    return candidates.find(p => fs.existsSync(p)) || '';
  }

  getSocksUrl() {
    return `socks5://127.0.0.1:${this.socksPort}`;
  }

  isRunning() {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null && (this.statusState === 'running' || this.statusState === 'starting'));
  }

  status() {
    const bin = this.resolveTorBinary();
    return {
      installed: Boolean(bin),
      binaryPath: bin || null,
      state: this.statusState,
      running: this.isRunning(),
      bootstrapped: this.statusState === 'running' && this.bootstrapPct >= 100,
      bootstrapPct: this.bootstrapPct,
      bootstrapSummary: this.bootstrapSummary,
      installProgress: this.installProgress,
      socksPort: this.socksPort,
      controlPort: this.controlPort,
      socksUrl: this.getSocksUrl(),
      upstreamSocks5: this.upstreamSocks5 || null,
      version: this.version,
      error: this.error,
      logs: this.logs.slice(-25),
    };
  }

  pushLog(line) {
    const clean = String(line || '').trim();
    if (!clean) return;
    this.logs.push(clean.slice(0, 300));
    if (this.logs.length > 80) this.logs.shift();
  }

  emitStatus() {
    this.emit('status', this.status());
  }

  async discoverBundleUrl({ request = fetch } = {}) {
    const errors = [];
    for (const base of TOR_MIRRORS) {
      try {
        const res = await request(base, {
          headers: { 'User-Agent': 'NEXUS/1.1' },
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) continue;
        const html = await res.text();
        const versions = [...html.matchAll(/href="(\d+\.\d+(?:\.\d+)*)\/"/g)]
          .map(m => m[1])
          .filter(v => !/[a-z]/i.test(v))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const latest = versions.at(-1) || FALLBACK_VERSION;
        const dirRes = await request(`${base}${latest}/`, {
          headers: { 'User-Agent': 'NEXUS/1.1' },
          signal: AbortSignal.timeout(7000),
        });
        if (!dirRes.ok) continue;
        const dirHtml = await dirRes.text();
        const match = dirHtml.match(/href="(tor-expert-bundle-windows-x86_64-[^"]+\.tar\.gz)"/i);
        if (match) {
          return { url: `${base}${latest}/${match[1]}`, version: latest, filename: match[1] };
        }
      } catch (err) {
        errors.push(`${base}: ${err?.cause?.code || err?.message}`);
      }
    }
    throw new Error(
      `Could not reach official Tor Project download server (dist.torproject.org). ` +
      `If you are on a corporate or Defender-managed network, Tor downloads may be restricted by network policy. ` +
      `You can still use NEXUS Private Browser in InPrivate/Account mode or point to an approved local SOCKS5/HTTP proxy. (${errors.join('; ')})`
    );
  }

  async install({ force = false, request = fetch } = {}) {
    if (!force && this.resolveTorBinary()) return this.status();
    if (this.installingPromise) return this.installingPromise;

    this.installingPromise = (async () => {
      if (process.platform !== 'win32') {
        throw new Error('NEXUS Managed Tor Expert Bundle installer currently targets Windows x64.');
      }
      this.error = null;
      this.statusState = 'installing';
      this.installProgress = 'Finding official Tor Expert Bundle mirror…';
      this.emitStatus();

      try {
        await fsp.mkdir(this.installDir, { recursive: true });
        const found = await this.discoverBundleUrl({ request });
        this.version = found.version;
        this.installProgress = `Downloading Tor Expert Bundle ${found.version}…`;
        this.pushLog(`Downloading ${found.url}`);
        this.emitStatus();

        const res = await request(found.url, {
          headers: { 'User-Agent': 'NEXUS/1.1' },
          signal: AbortSignal.timeout(120000),
        });
        if (!res.ok) throw new Error(`Tor download failed (HTTP ${res.status})`);
        const totalBytes = Number(res.headers.get('content-length')) || 0;
        const archivePath = path.join(this.installDir, found.filename);

        const chunks = [];
        let downloaded = 0;
        let lastEmit = 0;
        const reader = res.body?.getReader();
        if (reader) {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(Buffer.from(value));
            downloaded += value.length;
            if (Date.now() - lastEmit > 350) {
              lastEmit = Date.now();
              const pct = totalBytes ? Math.round((downloaded / totalBytes) * 100) : null;
              this.installProgress = pct != null
                ? `Downloading Tor ${found.version} (${pct}% · ${(downloaded / 1048576).toFixed(1)} MB)…`
                : `Downloading Tor ${found.version} (${(downloaded / 1048576).toFixed(1)} MB)…`;
              this.emitStatus();
            }
          }
          await fsp.writeFile(archivePath, Buffer.concat(chunks));
        } else {
          const buf = Buffer.from(await res.arrayBuffer());
          await fsp.writeFile(archivePath, buf);
        }

        this.installProgress = 'Extracting portable tor.exe…';
        this.emitStatus();
        await execFileAsync('tar.exe', ['-xzf', archivePath, '-C', this.installDir], { timeout: 60000, windowsHide: true });
        await fsp.rm(archivePath, { force: true }).catch(() => {});

        const bin = this.resolveTorBinary();
        if (!bin) throw new Error('tor.exe was not found after extracting the Tor Expert Bundle.');
        this.pushLog(`Installed portable Tor ${found.version} at ${bin}`);
        this.installProgress = '';
        this.statusState = 'stopped';
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

  async start({ autoInstall = true, waitForBootstrap = true, timeoutMs = 45000, upstreamSocks5 = '' } = {}) {
    const normalizedUpstream = String(upstreamSocks5 || '').trim().replace(/^socks5h?:\/\//i, '');
    if (this.statusState === 'running' && this.bootstrapPct >= 100 && this.isRunning() && this.upstreamSocks5 === normalizedUpstream) {
      return this.status();
    }
    if (this.startingPromise) return this.startingPromise;

    this.startingPromise = (async () => {
      let bin = this.resolveTorBinary();
      if (!bin) {
        if (!autoInstall) throw new Error('Portable Tor is not installed yet.');
        await this.install();
        bin = this.resolveTorBinary();
      }
      if (!bin) throw new Error('Could not locate tor.exe.');

      await this.stop();
      await fsp.mkdir(this.torDataDir, { recursive: true });
      this.error = null;
      this.bootstrapPct = 0;
      this.upstreamSocks5 = normalizedUpstream;
      this.bootstrapSummary = normalizedUpstream
        ? `Starting Tor chained inside WireGuard (${normalizedUpstream})…`
        : 'Starting local Tor daemon…';
      this.statusState = 'starting';
      this.emitStatus();

      const geoip = this.resolveDataFile(bin, 'geoip');
      const geoip6 = this.resolveDataFile(bin, 'geoip6');
      const cookieFile = path.join(this.torDataDir, 'control_auth_cookie');
      const torrcPath = path.join(this.torDataDir, 'torrc');
      const quoteTorPath = p => '"' + String(p).replace(/\\/g, '/').replace(/"/g, '\\"') + '"';
      const torrcLines = [
        `SocksPort 127.0.0.1:${this.socksPort} IsolateDestAddr`,
        `ControlPort 127.0.0.1:${this.controlPort}`,
        'CookieAuthentication 1',
        `CookieAuthFile ${quoteTorPath(cookieFile)}`,
        `DataDirectory ${quoteTorPath(this.torDataDir)}`,
        'ClientOnly 1',
        'AvoidDiskWrites 1',
        ...(normalizedUpstream ? [`Socks5Proxy ${normalizedUpstream}`] : []),
        ...(geoip ? [`GeoIPFile ${quoteTorPath(geoip)}`] : []),
        ...(geoip6 ? [`GeoIPv6File ${quoteTorPath(geoip6)}`] : []),
      ];
      await fsp.writeFile(torrcPath, torrcLines.join('\n') + '\n', 'utf8');

      const child = spawn(bin, ['-f', torrcPath], {
        cwd: path.dirname(bin),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child = child;

      let resolveBoot, rejectBoot;
      const bootPromise = new Promise((res, rej) => { resolveBoot = res; rejectBoot = rej; });
      if (!waitForBootstrap) bootPromise.catch(() => {});
      const bootTimer = waitForBootstrap ? setTimeout(() => {
        rejectBoot(new Error(`Tor bootstrap timed out at ${this.bootstrapPct}% (${this.bootstrapSummary || 'network may block direct Tor relays'}).`));
      }, timeoutMs) : null;

      const handleLine = rawLine => {
        const line = String(rawLine || '').trim();
        if (!line) return;
        this.pushLog(line);
        const verMatch = /Tor (\d+\.\d+\.\d+(?:\.\d+)?)/i.exec(line);
        if (verMatch && !this.version) this.version = verMatch[1];
        const m = /Bootstrapped\s+(\d+)%(?:\s*\(([^)]+)\))?(?::\s*(.*))?/i.exec(line);
        if (m) {
          this.bootstrapPct = Math.min(100, Number(m[1]) || 0);
          this.bootstrapSummary = (m[3] || m[2] || '').trim();
          if (this.bootstrapPct >= 100) {
            this.statusState = 'running';
            clearTimeout(bootTimer);
            resolveBoot(this.status());
          }
          this.emitStatus();
        }
      };

      let stdoutBuf = '';
      child.stdout?.on('data', chunk => {
        stdoutBuf += chunk.toString('utf8');
        const lines = stdoutBuf.split(/\r?\n/);
        stdoutBuf = lines.pop() || '';
        for (const l of lines) handleLine(l);
      });
      child.stderr?.on('data', chunk => {
        for (const l of chunk.toString('utf8').split(/\r?\n/)) handleLine(l);
      });
      child.on('error', err => {
        clearTimeout(bootTimer);
        this.error = err.message;
        this.statusState = 'error';
        this.emitStatus();
        rejectBoot(err);
      });
      child.on('close', code => {
        clearTimeout(bootTimer);
        if (this.child === child) this.child = null;
        if (this.statusState === 'starting') {
          this.error = `Tor exited early (code ${code}). ${this.logs.at(-1) || ''}`.trim();
          this.statusState = 'error';
          this.emitStatus();
          rejectBoot(new Error(this.error));
        } else if (this.statusState === 'running') {
          this.statusState = 'stopped';
          this.bootstrapPct = 0;
          this.emitStatus();
        }
      });

      if (!waitForBootstrap) return this.status();
      return await bootPromise;
    })().finally(() => {
      this.startingPromise = null;
    });

    return this.startingPromise;
  }

  async newIdentity() {
    if (!this.isRunning()) throw new Error('Managed Tor is not running.');
    const cookiePath = path.join(this.torDataDir, 'control_auth_cookie');
    const cookieHex = (await fsp.readFile(cookiePath)).toString('hex');
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port: this.controlPort });
      let out = '';
      let stage = 0;
      const timer = setTimeout(() => { sock.destroy(); reject(new Error('Tor ControlPort timeout.')); }, 6000);
      sock.on('error', err => { clearTimeout(timer); reject(err); });
      sock.on('connect', () => {
        sock.write(`AUTHENTICATE ${cookieHex}\r\n`);
      });
      sock.on('data', chunk => {
        out += chunk.toString('utf8');
        if (stage === 0 && out.includes('250 OK')) {
          stage = 1;
          out = '';
          sock.write('SIGNAL NEWNYM\r\n');
        } else if (stage === 1 && out.includes('250 OK')) {
          clearTimeout(timer);
          sock.write('QUIT\r\n');
          sock.end();
          this.pushLog('Rotated Tor circuit (SIGNAL NEWNYM)');
          this.emitStatus();
          resolve({ rotated: true, at: new Date().toISOString() });
        } else if (/^5\d\d\s/m.test(out)) {
          clearTimeout(timer);
          sock.destroy();
          reject(new Error('Tor ControlPort rejected command: ' + out.trim()));
        }
      });
    });
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this.statusState = 'stopped';
    this.bootstrapPct = 0;
    this.bootstrapSummary = '';
    if (child && child.exitCode === null) {
      try {
        if (process.platform === 'win32' && child.pid) {
          await execFileAsync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 4000 }).catch(() => {});
        } else {
          child.kill('SIGTERM');
        }
      } catch {}
    }
    this.emitStatus();
    return this.status();
  }
}
