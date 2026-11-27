import os from 'node:os';
import path from 'node:path';

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Reversible Outbound PII & Local Path Scrubber.
// Replaces local Windows username, home directory, hostname, and user-defined patterns
// with deterministic neutral tokens BEFORE sending requests to cloud LLMs,
// and transparently restores them when executing local tools so workflows never break.
export class PiiScrubber {
  constructor({ enabled = false, customRules = [], homeDir, username, hostname } = {}) {
    this.enabled = Boolean(enabled);
    this.pairs = []; // { real, token, ci, regex, revRegex }

    if (!this.enabled) return;

    const realHome = homeDir ?? (() => { try { return os.homedir(); } catch { return ''; } })();
    const realUser = username ?? (() => { try { return os.userInfo().username; } catch { return ''; } })();
    const realHost = hostname ?? (() => { try { return os.hostname(); } catch { return ''; } })();

    const rawPairs = [];

    // 1. Home directory (Windows backslash + forward-slash variants)
    // Use opaque unambiguous sentinels (__NEXUS_USER__, __NEXUS_HOST__) rather than common
    // English words like "operator" so reversible tool-argument restoration never corrupts prose or code.
    if (realHome && realHome.length >= 4) {
      const winHome = realHome.replace(/\//g, '\\').replace(/\\+$/, '');
      const posixHome = winHome.replace(/\\/g, '/');
      const fakeWinHome = process.platform === 'win32' || /^[a-zA-Z]:\\/.test(winHome)
        ? 'C:\\Users\\__NEXUS_USER__'
        : '/home/__NEXUS_USER__';
      const fakePosixHome = fakeWinHome.replace(/\\/g, '/');
      rawPairs.push({ real: winHome, token: fakeWinHome, ci: true, kind: 'home-path' });
      if (posixHome !== winHome) {
        rawPairs.push({ real: posixHome, token: fakePosixHome, ci: true, kind: 'home-path-posix' });
      }
    }

    // 2. Hostname (only if non-trivial length to avoid false matches)
    if (realHost && realHost.length >= 3 && !/^localhost$/i.test(realHost)) {
      rawPairs.push({ real: realHost, token: '__NEXUS_HOST__', ci: true, kind: 'hostname' });
    }

    // 3. OS Username (word-boundary / path-segment aware)
    if (realUser && realUser.length >= 3 && !/^(root|user|admin|__nexus_user__)$/i.test(realUser)) {
      rawPairs.push({ real: realUser, token: '__NEXUS_USER__', ci: true, kind: 'username', boundary: true });
    }

    // 4. User-defined custom sensitive strings (emails, real names, org domains, internal codenames)
    let customIdx = 0;
    for (const rawRule of (Array.isArray(customRules) ? customRules : [])) {
      const rule = String(rawRule || '').trim();
      if (!rule || rule.length < 3) continue;
      let real = rule;
      let token = `[REDACTED_${++customIdx}]`;
      const arrow = rule.indexOf('=>');
      if (arrow > 0) {
        real = rule.slice(0, arrow).trim();
        const customTok = rule.slice(arrow + 2).trim();
        if (customTok) token = customTok;
      }
      if (real.length < 3) continue;
      rawPairs.push({ real, token, ci: true, kind: 'custom' });
    }

    // Deduplicate & sort longest-first so full paths match before bare usernames
    const seen = new Set();
    rawPairs.sort((a, b) => b.real.length - a.real.length);
    for (const item of rawPairs) {
      const key = item.real.toLowerCase();
      if (seen.has(key) || item.real.toLowerCase() === item.token.toLowerCase()) continue;
      seen.add(key);
      const flags = item.ci ? 'gi' : 'g';
      const pattern = item.boundary
        ? `(?<![A-Za-z0-9])${escapeRegex(item.real)}(?![A-Za-z0-9])`
        : escapeRegex(item.real);
      const revPattern = item.boundary
        ? `(?<![A-Za-z0-9])${escapeRegex(item.token)}(?![A-Za-z0-9])`
        : escapeRegex(item.token);
      this.pairs.push({
        ...item,
        regex: new RegExp(pattern, flags),
        revRegex: new RegExp(revPattern, flags),
      });
    }
  }

  scrubText(input) {
    if (!this.enabled || typeof input !== 'string' || !input || !this.pairs.length) return input;
    let out = input;
    for (const p of this.pairs) {
      out = out.replace(p.regex, p.token);
    }
    return out;
  }

  unscrubText(input) {
    if (!this.enabled || typeof input !== 'string' || !input || !this.pairs.length) return input;
    let out = input;
    // Restore longest tokens first (e.g. C:\Users\operator before bare operator)
    const revSorted = [...this.pairs].sort((a, b) => b.token.length - a.token.length);
    for (const p of revSorted) {
      out = out.replace(p.revRegex, p.real);
    }
    return out;
  }

  scrubValue(val) {
    if (!this.enabled || !this.pairs.length) return val;
    if (typeof val === 'string') return this.scrubText(val);
    if (Array.isArray(val)) return val.map(v => this.scrubValue(v));
    if (val && typeof val === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(val)) {
        // Never touch base64 image data URLs
        if (k === 'url' && typeof v === 'string' && v.startsWith('data:image/')) {
          out[k] = v;
        } else {
          out[k] = this.scrubValue(v);
        }
      }
      return out;
    }
    return val;
  }

  unscrubValue(val) {
    if (!this.enabled || !this.pairs.length) return val;
    if (typeof val === 'string') return this.unscrubText(val);
    if (Array.isArray(val)) return val.map(v => this.unscrubValue(v));
    if (val && typeof val === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(val)) {
        out[k] = this.unscrubValue(v);
      }
      return out;
    }
    return val;
  }

  scrubMessages(messages) {
    if (!this.enabled || !Array.isArray(messages) || !this.pairs.length) return messages;
    return messages.map(m => this.scrubValue(m));
  }

  summary() {
    // Never disclose secret characters. This payload is returned to the UI AND
    // to the model by manage_privacy(status), so any real character here leaks
    // to the cloud provider — exactly what the scrubber exists to prevent.
    const rules = this.pairs.map(p => {
      const effective = p.real.toLowerCase() !== p.token.toLowerCase();
      return {
        kind: p.kind,
        token: p.token,
        length: String(p.real || '').length,
        effective,
        preview: '•'.repeat(Math.max(3, String(p.real || '').length)),
      };
    });
    return {
      enabled: this.enabled,
      ruleCount: rules.length,
      effectiveRuleCount: rules.filter(r => r.effective).length,
      placeholders: ['__NEXUS_USER__', '__NEXUS_HOST__'],
      rules,
    };
  }
}

export function isLocalModelEndpoint(baseUrl = '') {
  try {
    const rawHost = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (rawHost === '127.0.0.1' || rawHost === 'localhost' || rawHost === '::1' || rawHost.endsWith('.local')) {
      return true;
    }
    // RFC 1918 & link-local private LAN addresses (e.g. home Ollama/vLLM GPU server on 192.168.x.x / 10.x.x.x)
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(rawHost);
    if (ipv4) {
      const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
      if (a === 10 || a === 127) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 169 && b === 254) return true;
    }
    if (/^(fc|fd)[0-9a-f]{2}:/i.test(rawHost) || /^fe80:/i.test(rawHost)) return true;
    return false;
  } catch { return false; }
}
