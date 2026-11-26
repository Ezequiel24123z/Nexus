import fs from 'node:fs';
import path from 'node:path';

// Human-editable nexus.config.json stored in the NEXUS data directory.
// Keeps settings, custom providers, custom slash commands, disabled tools, and UI overrides
// directly inspectable and live-reloadable both from disk and from the UI.
const CONFIG_KEYS = [
  'model',
  'agentMode',
  'customBaseUrl',
  'copilotBaseUrl',
  'streaming',
  'cacheAffinity',
  'promptCaching',
  'lazyToolLoading',
  'microCompaction',
  'silentToolSteps',
  'semiAutoAllowRules',
  'semiAutoDenyRules',
  'reasoningEffort',
  'providerRouting',
  'providerOrder',
  'webSearchEnabled',
  'webSearchEngine',
  'webSearchContext',
  'webMaxResults',
  'webMaxUses',
  'globalInstructions',
  'contextWindow',
  'compressionPercent',
  'concurrency',
  'maxSteps',
  'maxOutput',
  'autonomous',
  'autoWorkspaceWrites',
  'desktopEnabled',
  'favoriteModels',
  'temperature',
  'topP',
  'presencePenalty',
  'frequencyPenalty',
  'seed',
  'extraBody',
  'extraHeaders',
  'customProviders',
  'customCommands',
  'disabledTools',
  'customCss',
  'accentColor',
  'globalHotkey',
  'minimizeToTray',
  'browserProxyMode',
  'browserProxyUrl',
  'browserPersistentProfile',
  'browserBlockTrackers',
  'browserAntiFingerprint',
  'browserSearchEngine',
  'browserSearxUrl',
  'browserRouteAgentTraffic',
];

export class ConfigFileManager {
  constructor(directory, runtime) {
    this.directory = directory;
    this.filename = path.join(directory, 'nexus.config.json');
    this.runtime = runtime;
    this.watcher = null;
    this.lastWritten = '';
    this.syncFromDiskOrInit();
  }

  extractFromSettings(settings = {}) {
    const out = {};
    for (const key of CONFIG_KEYS) {
      if (settings[key] !== undefined) out[key] = settings[key];
    }
    return out;
  }

  readRaw() {
    if (!fs.existsSync(this.filename)) {
      this.writeSettings(this.runtime.store.state.settings);
    }
    return fs.readFileSync(this.filename, 'utf8');
  }

  writeSettings(settings) {
    const payload = JSON.stringify(this.extractFromSettings(settings), null, 2) + '\n';
    if (payload === this.lastWritten && fs.existsSync(this.filename)) return;
    this.lastWritten = payload;
    const tmp = this.filename + '.' + process.pid + '.tmp';
    try {
      fs.writeFileSync(tmp, payload, 'utf8');
      fs.renameSync(tmp, this.filename);
    } catch {
      try { fs.writeFileSync(this.filename, payload, 'utf8'); } catch {}
      try { fs.unlinkSync(tmp); } catch {}
    }
  }

  applyRawJson(rawText) {
    if (typeof rawText !== 'string' || !rawText.trim()) throw new Error('Configuration JSON cannot be empty.');
    let parsed;
    try { parsed = JSON.parse(rawText); } catch (e) { throw new Error('Invalid JSON: ' + e.message); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Configuration root must be a JSON object.');
    }
    const allowed = {};
    for (const key of CONFIG_KEYS) {
      if (Object.hasOwn(parsed, key)) allowed[key] = parsed[key];
    }
    this.runtime.settings(allowed);
    this.writeSettings(this.runtime.store.state.settings);
    return { path: this.filename, raw: this.readRaw(), appliedKeys: Object.keys(allowed) };
  }

  syncFromDiskOrInit() {
    if (!fs.existsSync(this.filename)) {
      this.writeSettings(this.runtime.store.state.settings);
      return;
    }
    try {
      const raw = fs.readFileSync(this.filename, 'utf8');
      this.lastWritten = raw;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const subset = {};
        for (const key of CONFIG_KEYS) if (Object.hasOwn(parsed, key)) subset[key] = parsed[key];
        if (Object.keys(subset).length) this.runtime.settings(subset);
      }
    } catch (err) {
      console.error('NEXUS: could not parse nexus.config.json on startup:', err.message);
    }
  }

  startWatching() {
    if (this.watcher) return;
    let debounce = null;
    try {
      this.watcher = fs.watch(this.directory, (_, changedName) => {
        if (changedName !== 'nexus.config.json') return;
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          try {
            if (!fs.existsSync(this.filename)) return;
            const raw = fs.readFileSync(this.filename, 'utf8');
            if (raw === this.lastWritten) return;
            this.lastWritten = raw;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              const subset = {};
              for (const key of CONFIG_KEYS) if (Object.hasOwn(parsed, key)) subset[key] = parsed[key];
              if (Object.keys(subset).length) this.runtime.settings(subset);
            }
          } catch {}
        }, 250);
      });
    } catch {}
  }

  close() {
    this.watcher?.close();
    this.watcher = null;
  }
}
