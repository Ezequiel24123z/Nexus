import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function dpapiProtect(plaintext) {
  const b64 = Buffer.from(plaintext, 'utf8').toString('base64');
  const script = [
    'Add-Type -AssemblyName System.Security',
    `$bytes = [Convert]::FromBase64String('${b64}')`,
    '$enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Convert]::ToBase64String($enc))',
  ].join('; ');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 15000,
    encoding: 'utf8',
  }).trim();
}

function dpapiUnprotect(cipherBase64) {
  const script = [
    'Add-Type -AssemblyName System.Security',
    `$bytes = [Convert]::FromBase64String('${cipherBase64.replace(/[^A-Za-z0-9+/=]/g, '')}')`,
    '$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($dec))',
  ].join('; ');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 15000,
    encoding: 'utf8',
  });
}

// Local secret store: encrypts on Windows with CurrentUser DPAPI (vault.dpapi),
// with optional plaintext vault.plain.json override for power users who prefer direct editing.
export class SecretVault {
  constructor(directory) {
    this.directory = directory;
    this.dpapiFile = path.join(directory, 'vault.dpapi');
    this.plainFile = path.join(directory, 'vault.plain.json');
    this.secrets = {};
    this.load();
  }

  load() {
    fs.mkdirSync(this.directory, { recursive: true });
    if (fs.existsSync(this.dpapiFile) && process.platform === 'win32') {
      try {
        const raw = fs.readFileSync(this.dpapiFile, 'utf8').trim();
        if (raw) {
          const parsed = JSON.parse(dpapiUnprotect(raw));
          if (parsed && typeof parsed === 'object') Object.assign(this.secrets, parsed);
        }
      } catch (err) {
        const rescue = path.join(this.directory, 'vault-unreadable-' + stamp() + '.dpapi');
        try { fs.copyFileSync(this.dpapiFile, rescue); } catch {}
        console.error('NEXUS: could not decrypt vault.dpapi; backup kept at ' + rescue, err.message);
      }
    }
    if (fs.existsSync(this.plainFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.plainFile, 'utf8'));
        if (parsed && typeof parsed === 'object') Object.assign(this.secrets, parsed);
      } catch {}
    }
  }

  get(name) {
    return this.secrets[name] || process.env[name] || null;
  }

  set(name, value) {
    if (typeof value === 'string' && value.trim()) this.secrets[name] = value.trim();
    else delete this.secrets[name];
    this.save();
  }

  listNames() {
    return Object.keys(this.secrets);
  }

  save() {
    fs.mkdirSync(this.directory, { recursive: true });
    const json = JSON.stringify(this.secrets);
    if (process.platform === 'win32') {
      try {
        const encrypted = dpapiProtect(json);
        if (fs.existsSync(this.dpapiFile)) {
          try { fs.copyFileSync(this.dpapiFile, path.join(this.directory, 'vault-backup-' + stamp() + '.dpapi')); } catch {}
        }
        const tmp = this.dpapiFile + '.tmp';
        fs.writeFileSync(tmp, encrypted, 'utf8');
        fs.renameSync(tmp, this.dpapiFile);
        return;
      } catch (err) {
        console.error('NEXUS: DPAPI encryption unavailable, falling back to local vault.plain.json:', err.message);
      }
    }
    const tmp = this.plainFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.secrets, null, 2), 'utf8');
    fs.renameSync(tmp, this.plainFile);
  }
}
