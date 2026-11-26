import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { DraftStore } from './drafts.mjs';
import { Runtime } from './runtime.mjs';
import { McpManager, validateServer } from './mcp.mjs';
import { SecretVault } from './vault.mjs';
import { ConfigFileManager } from './config-file.mjs';
import { AutomationsManager } from './automations.mjs';
import { InteractiveTerminalManager } from './pty-shell.mjs';
import { checkPrivacyStatus, probeLocalProxies, detectSystemVpn, proxiedFetch, resolveEffectiveProxyUrl } from './privacy-proxy.mjs';
import { TorManager } from './tor-manager.mjs';
import { CURATED_SKILLS, CURATED_NATIVE_PLUGINS, CURATED_MCP_PLUGINS, CLOUD_SKILL_SOURCES } from './gallery.mjs';
import { discoverWorkspaceSkills, searchGithubSkills } from './plugins.mjs';
import { inspectWebPage } from './coding-engine.mjs';
import { readBalance } from './telemetry.mjs';
import { command, workspacePath, baseTools, READ_ONLY_TOOL_NAMES } from './tools.mjs';
import { recoveryJob } from './recovery-jobs.mjs';
import { functionTargets, catalogPage } from './capabilities.mjs';
import { previewOpenApi, importOpenApi } from './openapi.mjs';
import { inspectContext, contextSection, inspectCosts, previewCheckpoint } from './context-inspector.mjs';
import { searchConversation, conversationWindow, taskResults, previewTaskResult } from './chat-workspace.mjs';
import { validateChatOptions, validateModelCapabilities } from './chat-options.mjs';
import { modelConnection, providerCatalog, checkArliConnection, checkProviderConnection, SECRET_KEYS, allProviders } from './providers.mjs';
import { inspectGitWorkspace, executeGitOperation, inspectSystemEnvironment, detectLocalCopilotToken, scaffoldMcpServer, runSelfImprovement, runCodeDiagnostics, discoverWorkspaceMcpServers, globWorkspaceFiles } from './coding-engine.mjs';
import { assertImageCapability } from './attachments.mjs';
import { externalWebUrl } from './web-links.mjs';

const require = createRequire(import.meta.url);
const { resolveDataDirectory } = require('./datadir.cjs');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const APP_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')).version || '1.1.0'; }
  catch { return '1.1.0'; }
})();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const connectorRevision = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function openWithShell(target) {
  const safeTarget = String(target || '').trim();
  if (!safeTarget) throw new Error('Target cannot be empty.');
  if (process.platform === 'win32') {
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:NEXUS_OPEN_TARGET'], {
      env: { ...process.env, NEXUS_OPEN_TARGET: safeTarget },
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    }).unref();
    return true;
  }
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [safeTarget], { detached: true, stdio: 'ignore' }).unref();
  return true;
}

function allowedCorsOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    if (['http:', 'https:'].includes(parsed.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
      return origin;
    }
  } catch {}
  return null;
}

function safeTokenEqual(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readJsonBody(req, maxBytes = 25 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Request payload exceeds limit.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export async function createNexusServer({
  dataDir = resolveDataDirectory(),
  uiDir = path.join(desktopRoot, 'ui'),
  port = 0,
  host = '127.0.0.1',
  token = crypto.randomBytes(24).toString('hex'),
  requireToken = true,
  nativeHost = false,
  desktopHandler = null,
} = {}) {
  const store = new Store(dataDir);
  const drafts = new DraftStore(dataDir);
  const vault = new SecretVault(dataDir);
  const mcp = new McpManager(store, name => vault.get(name));
  const modelCatalog = new Map();
  let activeUiTask = null;
  let recoverySelection = null;
  let recoveryBusy = false;

  const resolveNativeHostExe = () => {
    const candidates = [
      process.env.NEXUS_HOST_EXE,
      path.join(desktopRoot, 'release', 'NEXUS', 'NEXUS.exe'),
      path.join(desktopRoot, 'NEXUS.exe'),
    ].filter(Boolean);
    return candidates.find(p => fs.existsSync(p)) || null;
  };

  const defaultDesktop = async (name, args, signal) => {
    if (typeof desktopHandler === 'function') return desktopHandler(name, args, signal);
    if (process.platform !== 'win32') throw new Error('Desktop control currently requires Windows.');
    const hostExe = resolveNativeHostExe();
    if (name === 'desktop_screenshot') {
      const tempImg = path.join(os.tmpdir(), 'nexus-shot-' + crypto.randomUUID() + '.jpg');
      try {
        let res;
        if (hostExe) {
          res = await command(hostExe, ['--screenshot', tempImg], { signal, timeout: 15000 });
        } else {
          const psPath = tempImg.replace(/'/g, "''");
          const script = [
            'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
            '$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
            '$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)',
            '$g = [System.Drawing.Graphics]::FromImage($bmp)',
            '$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)',
            '$g.Dispose()',
            `$bmp.Save('${psPath}', [System.Drawing.Imaging.ImageFormat]::Jpeg)`,
            '$bmp.Dispose()',
            '$out = @{ physicalWidth=$b.Width; physicalHeight=$b.Height; imageWidth=$b.Width; imageHeight=$b.Height; scaleFactor=1 }',
            '[Console]::Out.Write(($out | ConvertTo-Json -Compress))',
          ].join('; ');
          res = await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { signal, timeout: 15000 });
        }
        if (res.exitCode !== 0) throw new Error('Desktop screenshot failed: ' + res.output.trim().slice(0, 300));
        const parsed = JSON.parse(res.output.trim());
        const imgBuf = await fsp.readFile(tempImg);
        return {
          image: 'data:image/jpeg;base64,' + imgBuf.toString('base64'),
          dimensions: {
            physicalWidth: parsed.physicalWidth,
            physicalHeight: parsed.physicalHeight,
            image: { width: parsed.imageWidth, height: parsed.imageHeight },
            scaleFactor: parsed.scaleFactor,
            origin: { x: 0, y: 0 },
          },
        };
      } finally {
        await fsp.rm(tempImg, { force: true }).catch(() => {});
      }
    }
    if (!['click', 'double_click', 'right_click', 'type', 'key', 'scroll'].includes(args.action)) {
      throw new Error('Unsupported desktop action: ' + args.action);
    }
    const encoded = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
    if (hostExe) {
      return command(hostExe, ['--desktop-action', encoded], { signal, timeout: 15000 });
    }
    const script = path.join(desktopRoot, 'native', 'desktop.ps1');
    return command('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Payload', encoded], { signal, timeout: 15000 });
  };

  const runtime = new Runtime(store, {
    mcp,
    getSecret: name => vault.get(name),
    desktop: defaultDesktop,
  });
  void runtime.capabilities;

  const automations = new AutomationsManager(store, runtime);
  runtime.automations = automations;
  automations.start(30000);

  const terminals = new InteractiveTerminalManager();
  const tor = new TorManager(dataDir, { bundledDir: desktopRoot });
  runtime.tor = tor;

  const configFile = new ConfigFileManager(dataDir, runtime);
  runtime.configFile = configFile;
  configFile.startWatching();

  async function checkAttachmentModel(ids, model, task) {
    const files = runtime.attachments.resolve(ids || []);
    const retained = (task?.messages || []).flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'nexus_attachment').map(part => part.attachment) : []);
    if (![...files, ...retained].some(file => file.kind === 'image')) return;
    if (!modelCatalog.has(model)) {
      const entries = await providerCatalog(modelConnection(model, store.state.settings).id, { settings: store.state.settings, getSecret: name => vault.get(name) });
      for (const item of entries) modelCatalog.set(item.id, item);
    }
    assertImageCapability([...files, ...retained], modelCatalog.get(model));
  }

  // SSE subscribers: full state changes + ultra-lightweight live streaming deltas + terminal + notifications
  const sseClients = new Set();
  const pushSse = (eventName, data) => {
    if (!sseClients.size) return;
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of [...sseClients]) {
      try { res.write(payload); } catch { sseClients.delete(res); }
    }
  };

  let broadcastTimer = null;
  const broadcast = () => {
    if (!sseClients.size || broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      pushSse('change', runtime.snapshot(activeUiTask));
    }, 120);
  };
  let deltaTimer = null;
  const pendingDeltas = new Map();
  const broadcastDelta = payload => {
    if (!sseClients.size || !payload?.taskId) return;
    pendingDeltas.set(payload.taskId, payload);
    if (deltaTimer) return;
    deltaTimer = setTimeout(() => {
      deltaTimer = null;
      for (const d of pendingDeltas.values()) pushSse('delta', d);
      pendingDeltas.clear();
    }, 36);
  };

  runtime.on('change', broadcast);
  runtime.on('delta', broadcastDelta);
  runtime.on('notify', payload => pushSse('notify', payload));
  automations.on('triggered', ({ automation }) => pushSse('notify', { title: 'NEXUS · Automation Started', body: automation.name }));
  terminals.on('data', evt => pushSse('terminal', evt));
  terminals.on('exit', evt => pushSse('terminal_exit', evt));
  tor.on('status', st => pushSse('tor', st));
  mcp.on('change', () => runtime.emit('change'));

  async function invoke(method, args = {}) {
    switch (method) {
      case 'hostInfo':
        return {
          standalone: true,
          nativeHost,
          engine: 'node',
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          dataDir,
          configPath: configFile.filename,
          logsDir: path.join(dataDir, 'logs'),
          version: APP_VERSION,
        };
      case 'getLogs': {
        const logsDir = path.join(dataDir, 'logs');
        const readLog = name => {
          const full = path.join(logsDir, name);
          if (!fs.existsSync(full)) return '';
          return fs.readFileSync(full, 'utf8').slice(-24000);
        };
        return { host: readLog('host.log'), core: readLog('core.log'), logsDir };
      }
      case 'automationsList': return automations.list();
      case 'automationSave': return automations.save(args);
      case 'automationToggle': return automations.toggle(args.id, args.enabled);
      case 'automationDelete': return automations.remove(args.id);
      case 'automationRunNow': return automations.runNow(args.id);
      case 'termCreate': return terminals.create({ cwd: args.cwd || process.cwd(), title: args.title || 'PowerShell' });
      case 'termWrite': return terminals.write(args.id, args.data);
      case 'termInterrupt': return terminals.interrupt(args.id);
      case 'termClear': return terminals.clearBuffer(args.id);
      case 'termGet': return terminals.get(args.id);
      case 'termList': return terminals.list();
      case 'termClose': return terminals.close(args.id);
      case 'privacyStatus': return checkPrivacyStatus(store.state.settings, tor);
      case 'privacyProbes': return { vpn: await detectSystemVpn(), localProxies: await probeLocalProxies(), tor: tor.status() };
      case 'torStatus': return tor.status();
      case 'torInstall': return tor.install({ force: Boolean(args.force) });
      case 'torStart': {
        const st = await tor.start({ autoInstall: args.autoInstall !== false, waitForBootstrap: args.waitForBootstrap !== false, timeoutMs: args.timeoutMs || 55000 });
        if (args.activate !== false) {
          runtime.settings({ browserProxyMode: 'managed-tor', browserProxyUrl: tor.getSocksUrl() });
        }
        return st;
      }
      case 'torStop': {
        const st = await tor.stop();
        if (store.state.settings.browserProxyMode === 'managed-tor') {
          runtime.settings({ browserProxyMode: 'direct' });
        }
        return st;
      }
      case 'torNewIdentity': return tor.newIdentity();
      case 'browserFetchReader': {
        const proxyUrl = resolveEffectiveProxyUrl(store.state.settings, tor);
        const fetcher = (url, opts) => (proxyUrl ? proxiedFetch(url, opts, proxyUrl) : fetch(url, opts));
        return inspectWebPage(args.url, { extractLinks: true, extractForms: true, request: fetcher });
      }
      case 'galleryCatalog': {
        await runtime.plugins.ready;
        const installedSkillNames = new Set([...runtime.capabilities.index.values()].filter(i => i.kind === 'skill').map(i => i.name.toLowerCase()));
        const installedPlugins = new Map(runtime.plugins.list().map(p => [p.id, p]));
        const installedMcpNames = new Set((store.state.mcpServers || []).map(s => s.name.toLowerCase()));
        return {
          skills: CURATED_SKILLS.map(s => ({ ...s, installed: installedSkillNames.has(s.name.toLowerCase()) })),
          nativePlugins: CURATED_NATIVE_PLUGINS.map(({ toolsCode, ...meta }) => ({ ...meta, installed: installedPlugins.has(meta.id), enabled: installedPlugins.get(meta.id)?.enabled ?? false })),
          mcpPlugins: CURATED_MCP_PLUGINS.map(p => ({ ...p, installed: installedMcpNames.has(p.serverConfig.name.toLowerCase()) })),
          cloudSources: CLOUD_SKILL_SOURCES,
          installedPlugins: runtime.plugins.list(),
        };
      }
      case 'galleryInstallSkill': {
        const item = CURATED_SKILLS.find(s => s.id === args.id);
        if (!item) throw new Error('Gallery skill not found.');
        const existing = [...runtime.capabilities.index.values()].find(i => i.kind === 'skill' && i.name.toLowerCase() === item.name.toLowerCase());
        const saved = runtime.capabilities.save({
          ...(existing ? { id: existing.id, revision: existing.revision } : {}),
          kind: 'skill',
          name: item.name,
          description: item.description,
          tags: item.tags,
          enabled: true,
          instructions: item.instructions,
        });
        runtime.emit('change');
        return { installed: true, skill: saved };
      }
      case 'galleryInstallAllSkills': {
        let count = 0;
        for (const item of CURATED_SKILLS) {
          const existing = [...runtime.capabilities.index.values()].find(i => i.kind === 'skill' && i.name.toLowerCase() === item.name.toLowerCase());
          if (existing) continue;
          runtime.capabilities.save({ kind: 'skill', name: item.name, description: item.description, tags: item.tags, enabled: true, instructions: item.instructions });
          count++;
        }
        runtime.emit('change');
        return { installedCount: count };
      }
      case 'galleryImportSkillUrl': {
        const res = await runtime.plugins.importSkillFromUrl(args.url, runtime.capabilities);
        runtime.emit('change');
        return res;
      }
      case 'gallerySearchGithubSkills': {
        const items = await searchGithubSkills(args.query || '');
        return { query: args.query || '', items };
      }
      case 'galleryTestConnectMcp': {
        const mcpItem = CURATED_MCP_PLUGINS.find(p => p.id === args.id);
        if (!mcpItem) throw new Error('Gallery MCP plugin not found.');
        const cfg = { ...mcpItem.serverConfig };
        validateServer(cfg);
        const idx = store.state.mcpServers.findIndex(s => s.name === cfg.name);
        if (idx >= 0) store.state.mcpServers[idx] = cfg;
        else store.state.mcpServers.push(cfg);
        runtime.changed(null);
        const tools = await mcp.list(cfg.name);
        runtime.emit('change');
        return {
          installed: true,
          connected: true,
          server: cfg.name,
          toolCount: tools.length,
          sampleTools: tools.slice(0, 8).map(t => t.name),
        };
      }
      case 'galleryInstallPlugin': {
        await runtime.plugins.ready;
        const nativeItem = CURATED_NATIVE_PLUGINS.find(p => p.id === args.id);
        if (nativeItem) {
          const installed = await runtime.plugins.installPlugin({
            id: nativeItem.id,
            name: nativeItem.name,
            description: nativeItem.description,
            category: nativeItem.category,
            author: nativeItem.author,
            toolsCode: nativeItem.toolsCode,
            enabled: true,
          });
          runtime.emit('change');
          return { installed: true, kind: 'native', plugin: installed };
        }
        const mcpItem = CURATED_MCP_PLUGINS.find(p => p.id === args.id);
        if (mcpItem) {
          const cfg = { ...mcpItem.serverConfig };
          validateServer(cfg);
          const idx = store.state.mcpServers.findIndex(s => s.name === cfg.name);
          if (idx >= 0) store.state.mcpServers[idx] = cfg;
          else store.state.mcpServers.push(cfg);
          runtime.changed(null);
          return { installed: true, kind: 'mcp', server: cfg.name };
        }
        throw new Error('Gallery plugin not found.');
      }
      case 'pluginsList':
        await runtime.plugins.ready;
        return runtime.plugins.list();
      case 'pluginToggle': {
        const res = await runtime.plugins.togglePlugin(args.id, args.enabled);
        runtime.emit('change');
        return res;
      }
      case 'pluginUninstall': {
        const res = await runtime.plugins.uninstallPlugin(args.id);
        runtime.emit('change');
        return res;
      }
      case 'pluginCreateTool': {
        const res = await runtime.plugins.createSingleTool(args);
        runtime.emit('change');
        return res;
      }
      case 'projectSkills':
        return { skills: discoverWorkspaceSkills(args.workspace || '') };
      case 'spawnChildSession':
        return runtime.spawnChildSession(store.task(args.parentId), args);
      case 'sendSessionMessage':
        return runtime.sendSessionMessage(args.fromId ? store.task(args.fromId) : null, args);
      case 'getConfig':
        return { path: configFile.filename, raw: configFile.readRaw() };
      case 'saveConfig':
        return configFile.applyRawJson(args.raw);
      case 'getDrafts': {
        const result = drafts.list();
        for (const draft of Object.values(result.items)) {
          const attachments = draft.attachmentIds.map(id => {
            try { return runtime.attachments.resolve([id])[0]; }
            catch { return { id, name: 'Unavailable attachment', kind: 'file', bytes: 0, missing: true }; }
          });
          result.items[draft.key] = { ...draft, attachments };
        }
        return result;
      }
      case 'saveDraft':
        return drafts.save(args);
      case 'clearDraft':
        return drafts.clear(args.key, args.revision);
      case 'openExternal':
        return openWithShell(externalWebUrl(args.url));
      case 'openProject':
        if (!args.workspace || !fs.existsSync(args.workspace)) throw new Error('Workspace folder does not exist.');
        return openWithShell(args.workspace);
      case 'openJournal':
        return openWithShell(store.directoryFor(store.task(args.id).id));
      case 'openDataDir':
        return openWithShell(dataDir);
      case 'snapshot':
        return runtime.snapshot(activeUiTask);
      case 'availableTools':
        return baseTools.map(t => ({ name: t.function.name, description: t.function.description, readOnly: READ_ONLY_TOOL_NAMES.has(t.function.name) }));
      case 'arenaTasks': {
        const ids = Array.isArray(args.ids) ? args.ids : [];
        return ids.map(id => {
          try {
            const snap = runtime.snapshot(id);
            return snap.tasks.find(t => t.id === id) || null;
          } catch { return null; }
        }).filter(Boolean);
      }
      case 'watchChat': {
        if (args.id != null) store.task(args.id);
        activeUiTask = args.id ?? null;
        return runtime.snapshot(activeUiTask);
      }
      case 'taskPage': return runtime.page(args.id, args.collection, args.before, args.limit);
      case 'searchChat': return searchConversation(store.task(args.id), args.query, args);
      case 'messageWindow': return conversationWindow(store.task(args.id), args.messageId);
      case 'taskResults': return taskResults(store.task(args.id), args);
      case 'previewResult': return previewTaskResult(store, store.task(args.id), args.resultId);
      case 'inspectContext': return inspectContext(runtime, store.task(args.id));
      case 'contextSection': return contextSection(runtime, store.task(args.id), args);
      case 'inspectCosts': return inspectCosts(store.task(args.id), args);
      case 'checkpointPreview': return previewCheckpoint(store, store.task(args.id), args);
      case 'storageInfo': return store.storageInfo();
      case 'capabilitiesPage': return { ...runtime.capabilities.list({ ...args, includeDisabled: true }), summary: runtime.capabilities.summary(), functionTargets };
      case 'getCapability': return runtime.capabilities.get(args.id, { includeDisabled: true });
      case 'saveCapability': { const result = runtime.capabilities.save(args); runtime.emit('change'); return result; }
      case 'connectorsPage': return catalogPage(store.state.connectors.map(item => ({ name: item.name, description: String(item.description || '').slice(0, 600), method: item.method, url: item.url })), args);
      case 'previewOpenApi': {
        const plan = previewOpenApi(args, store.state.connectors);
        return { ...plan, entries: plan.entries.map(({ connector, ...metadata }) => metadata) };
      }
      case 'importOpenApi': return importOpenApi(runtime, args);
      case 'mcpToolsPage': return catalogPage((await mcp.list(args.server)).map(item => ({ name: item.name, description: String(item.description || '').slice(0, 600) })), { query: args.query, offset: args.offset, limit: 20 });
      case 'mcpLogs': return { server: args.server, logs: mcp.getLogs(args.server) };
      case 'discoverMcp': return { servers: discoverWorkspaceMcpServers(args.workspace) };
      case 'getConnector': {
        const definition = store.state.connectors.find(item => item.name === args.name);
        if (!definition) throw new Error('Connector not found.');
        return { definition, revision: connectorRevision(definition) };
      }
      case 'updateConnector': {
        runtime.validateConnector(args.definition);
        const index = store.state.connectors.findIndex(item => item.name === args.definition.name);
        if (index < 0 || connectorRevision(store.state.connectors[index]) !== args.revision) throw new Error('The connector changed. Reopen it before saving.');
        store.state.connectors[index] = args.definition;
        runtime.changed(null);
        return true;
      }
      case 'testConnector': {
        const started = Date.now();
        const res = await runtime.invokeConnector({ name: args.name, input: args.input || {} }, new AbortController().signal);
        return { ...res, latencyMs: Date.now() - started };
      }
      case 'addConnector':
        runtime.validateConnector(args);
        if (store.state.connectors.some(c => c.name === args.name)) throw new Error('A connector with that name already exists.');
        store.state.connectors.push(args);
        runtime.changed();
        return true;
      case 'removeConnector':
        store.state.connectors = store.state.connectors.filter(c => c.name !== args.name);
        runtime.changed();
        return true;
      case 'inspectRecoveryPath': {
        if (recoveryBusy) throw new Error('A backup check is already in progress.');
        if (!args.source || !fs.existsSync(args.source)) throw new Error('Backup file not found.');
        recoveryBusy = true;
        recoverySelection = null;
        try {
          const source = fs.realpathSync(args.source);
          const preview = await recoveryJob({ operation: 'inspect', source });
          const recoveryToken = crypto.randomUUID();
          recoverySelection = { source, token: recoveryToken, fingerprint: preview.fingerprint };
          return { ...preview, token: recoveryToken };
        } finally { recoveryBusy = false; }
      }
      case 'restoreRecoveryPath': {
        if (recoveryBusy) throw new Error('A backup check is already in progress.');
        if (!recoverySelection || args.token !== recoverySelection.token) throw new Error('Select and review a backup before restoring it.');
        if (!args.destination) throw new Error('Choose a destination folder.');
        recoveryBusy = true;
        try {
          const result = await recoveryJob({
            operation: 'restore',
            source: recoverySelection.source,
            expectedFingerprint: recoverySelection.fingerprint,
            parent: args.destination,
            activeDirectory: store.directory,
          });
          recoverySelection = null;
          return result;
        } finally { recoveryBusy = false; }
      }
      case 'migrateStorage': {
        if (runtime.active.size || runtime.compacting.size || store.state.tasks.some(task => task.status === 'queued')) {
          throw new Error('Pause all tasks and wait for active calls to finish before migrating.');
        }
        const info = store.migrateToSqlite();
        runtime.emit('change');
        return info;
      }
      case 'exportStoragePath': {
        if (runtime.active.size || runtime.compacting.size) throw new Error('Pause all tasks before exporting workspace state.');
        const dest = args.filePath || path.join(dataDir, 'exports', 'nexus-export-' + Date.now() + '.json');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        store.exportState(dest);
        return { ok: true, path: dest };
      }
      case 'importAttachmentPaths': {
        const filePaths = Array.isArray(args.filePaths) ? args.filePaths : [];
        const attachments = [], errors = [];
        for (const filename of filePaths) {
          try { attachments.push(await runtime.attachments.importFile(filename)); }
          catch (error) { errors.push(path.basename(filename) + ': ' + error.message); }
        }
        return { attachments, errors };
      }
      case 'uploadAttachment': {
        if (!args.name || typeof args.base64 !== 'string') throw new Error('Attachment name and base64 data are required.');
        const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-upload-'));
        const safeName = path.basename(String(args.name)).replace(/[<>:"/\\|?*]/g, '_');
        const tmpFile = path.join(tmpDir, safeName || 'attachment.bin');
        try {
          await fsp.writeFile(tmpFile, Buffer.from(args.base64, 'base64'));
          return await runtime.attachments.importFile(tmpFile);
        } finally {
          await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
      }
      case 'previewAttachment': {
        const preview = await runtime.attachments.preview(args.id, { offset: args.offset ?? 0, length: args.length ?? 8000 });
        if (preview.attachment.kind === 'image') {
          const buf = fs.readFileSync(runtime.attachments.filename(args.id));
          preview.image = `data:${preview.attachment.mime};base64,${buf.toString('base64')}`;
        }
        return preview;
      }
      case 'createTask': {
        await checkAttachmentModel(args.attachmentIds, args.model || store.state.settings.model);
        return runtime.create(args);
      }
      case 'createArena': {
        if (!Array.isArray(args.models) || args.models.length < 2) throw new Error('Select at least two models for Arena comparison.');
        const arenaGroupId = crypto.randomUUID();
        const ids = [];
        for (const m of args.models.slice(0, 4)) {
          const shortModel = String(m).split('/').pop();
          const id = runtime.create({
            prompt: args.prompt,
            title: `[Arena · ${shortModel}] ${String(args.prompt).slice(0, 48)}`,
            model: m,
            agentMode: args.agentMode || undefined,
            projectId: args.projectId || null,
            workspace: args.workspace || '',
            arenaGroupId,
          });
          ids.push(id);
        }
        return { ids, arenaGroupId };
      }
      case 'deleteTask': return runtime.deleteTask(args.id);
      case 'forkTask': return { id: runtime.forkTask(args.id, args.messageId) };
      case 'editMessage': return runtime.editMessageAndResend(args.id, args.messageId, args.content);
      case 'regenerate': return runtime.regenerate(args.id);
      case 'revertFileChange': return runtime.revertFileChange(args.id, args.eventId);
      case 'pause': return runtime.pause(args.id);
      case 'compact': {
        const task = store.task(args.id);
        if (runtime.active.has(task.id)) throw new Error('Pause the task before compacting.');
        if (args.microOnly) {
          const micro = await runtime.microCompactTask(task, { keepRecent: args.keepRecent ?? 4, minChars: args.minChars ?? 800 });
          runtime.changed(task);
          return { ok: true, micro };
        }
        try {
          if (store.state.settings.microCompaction !== false) await runtime.microCompactTask(task);
          await runtime.compact(task, new AbortController().signal);
        }
        catch (error) { if (error.name === 'AbortError') return false; throw error; }
        runtime.changed();
        return { ok: true, lastCompression: task.lastCompression };
      }
      case 'resume': {
        await checkAttachmentModel(args.attachmentIds, store.task(args.id).model, store.task(args.id));
        runtime.resume(args.id, args.instruction, args.attachmentIds);
        return true;
      }
      case 'approve': return runtime.approve(args.id, args.allowed, {
        allowSession: Boolean(args.allowSession),
        alwaysAllowPattern: args.alwaysAllowPattern || '',
      });
      case 'settings': runtime.settings(args); return runtime.snapshot(activeUiTask);
      case 'balance': {
        const providerId = modelConnection(store.state.settings.model, store.state.settings).id;
        return providerId === 'openrouter' ? readBalance(name => vault.get(name)) : { subscription: true, provider: providerId, remaining: null, keyRemaining: null };
      }
      case 'checkArli': return checkArliConnection(vault.get('ARLIAI_API_KEY'));
      case 'checkProvider': {
        const providerId = args.provider || modelConnection(store.state.settings.model, store.state.settings).id;
        const provider = allProviders(store.state.settings).find(p => p.id === providerId) || allProviders(store.state.settings)[0];
        return checkProviderConnection(provider.id, vault.get(provider.key), { settings: store.state.settings });
      }
      case 'importCopilotToken': {
        const detected = await detectLocalCopilotToken();
        vault.set('GITHUB_COPILOT_TOKEN', detected.token);
        runtime.changed();
        return { ok: true, source: detected.source };
      }
      case 'saveKey': {
        const name = String(args.name || 'OPENROUTER_API_KEY').trim().toUpperCase();
        if (!SECRET_KEYS.includes(name) && !/^(CONNECTOR|PROVIDER)_[A-Z0-9_]+$/.test(name)) {
          throw new Error('Secret name must be a provider key or start with CONNECTOR_ or PROVIDER_.');
        }
        if (typeof args.value !== 'string' || args.value.length > 10000) throw new Error('Invalid key value.');
        vault.set(name, args.value);
        runtime.changed();
        return true;
      }
      case 'models': {
        const sorts = new Set(['pricing-low-to-high', 'context-high-to-low', 'throughput-high-to-low', 'latency-low-to-high', 'most-popular', 'newest', 'intelligence-high-to-low', 'design-arena-elo-high-to-low']);
        const providerIds = allProviders(store.state.settings).map(p => p.id);
        const results = await Promise.allSettled(providerIds.map(provider =>
          providerCatalog(provider, { sort: sorts.has(args.sort) ? args.sort : '', settings: store.state.settings, getSecret: name => vault.get(name) })
        ));
        const entries = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
        if (!entries.length) throw new Error('Model catalogs unavailable. You can type any model ID manually and retry.');
        for (const model of entries) modelCatalog.set(model.id, model);
        return entries.map(m => ({
          id: m.id,
          name: m.name,
          provider: m.provider || 'openrouter',
          context: m.context_length,
          tools: m.supported_parameters?.includes('tools'),
          vision: m.architecture?.input_modalities?.includes('image'),
          reasoning: m.reasoning || null,
          pricing: m.pricing || {},
          topProvider: m.top_provider ? { context: m.top_provider.context_length, maxOutput: m.top_provider.max_completion_tokens } : null,
          benchmarks: m.benchmarks || null,
          description: m.description || '',
        }));
      }
      case 'saveMcp': {
        validateServer(args);
        await mcp.disconnect(args.name);
        const existing = store.state.mcpServers.findIndex(s => s.name === args.name);
        if (existing >= 0) store.state.mcpServers[existing] = args;
        else store.state.mcpServers.push(args);
        runtime.changed();
        return true;
      }
      case 'scaffoldMcp': {
        const res = await scaffoldMcpServer(store, mcp, args);
        runtime.changed();
        return res;
      }
      case 'selfImprove': return runSelfImprovement(runtime, null, args);
      case 'connectMcp': await mcp.list(args.name); return true;
      case 'disconnectMcp': await mcp.disconnect(args.name); return true;
      case 'removeMcp':
        await mcp.disconnect(args.name);
        store.state.mcpServers = store.state.mcpServers.filter(s => s.name !== args.name);
        runtime.changed();
        return true;
      case 'saveProject': {
        const id = store.project(args);
        runtime.changed();
        return id;
      }
      case 'removeProject': {
        store.state.projects = store.state.projects.filter(p => p.id !== args.id);
        for (const task of store.state.tasks) if (task.projectId === args.id) task.projectId = null;
        runtime.changed();
        return true;
      }
      case 'pinMessage': {
        const task = store.task(args.id);
        const message = task.conversation.find(m => m.id === args.messageId);
        if (!message) throw new Error('Message not found');
        message.pinned = Boolean(args.pinned);
        runtime.changed();
        return true;
      }
      case 'updateChat': {
        const task = store.task(args.id);
        const options = validateChatOptions(args);
        const model = options.model || task.model;
        if (Object.keys(options).some(key => options[key] !== task[key])) {
          validateModelCapabilities({
            ...task,
            ...options,
            reasoningEffort: options.reasoningEffort === null ? store.state.settings.reasoningEffort : options.reasoningEffort ?? task.reasoningEffort ?? store.state.settings.reasoningEffort,
          }, modelCatalog.get(model));
          if (model !== task.model) await checkAttachmentModel([], model, task);
        }
        return runtime.updateChat(args);
      }
      case 'files': {
        if (!args.workspace) throw new Error('Select a workspace folder first.');
        const target = await workspacePath(args.workspace, args.path || '.', false);
        return fs.readdirSync(target, { withFileTypes: true })
          .filter(f => f.name !== '.git' && f.name !== 'node_modules')
          .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
          .slice(0, 500)
          .map(f => ({ name: f.name, directory: f.isDirectory() }));
      }
      case 'fileTree': {
        if (!args.workspace) return { matches: [], count: 0 };
        return globWorkspaceFiles(args.workspace, args.pattern || '**/*', { maxResults: Math.min(Number(args.limit) || 400, 1000) });
      }
      case 'readFile': {
        if (!args.workspace) throw new Error('Select a workspace folder first.');
        const target = await workspacePath(args.workspace, args.path, false);
        const stat = fs.statSync(target);
        if (stat.size > 2 * 1024 * 1024) throw new Error('Preview supports files up to 2 MB.');
        return fs.readFileSync(target, 'utf8');
      }
      case 'writeFileDirect': {
        if (!args.workspace || !args.path) throw new Error('Workspace and file path are required.');
        const target = await workspacePath(args.workspace, args.path, true);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, String(args.content ?? ''), 'utf8');
        return { saved: true, path: args.path, bytes: Buffer.byteLength(String(args.content ?? ''), 'utf8') };
      }
      case 'createFileOrDir': {
        if (!args.workspace || !args.path) throw new Error('Workspace and target path are required.');
        const target = await workspacePath(args.workspace, args.path, true);
        if (args.directory) {
          await fsp.mkdir(target, { recursive: true });
        } else {
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await fsp.writeFile(target, String(args.content ?? ''), 'utf8');
        }
        return { created: true, path: args.path };
      }
      case 'deleteFileOrDir': {
        if (!args.workspace || !args.path) throw new Error('Workspace and target path are required.');
        const target = await workspacePath(args.workspace, args.path, false);
        const realWorkspace = await fsp.realpath(args.workspace);
        if (path.resolve(target) === path.resolve(realWorkspace)) {
          throw new Error('Cannot delete the workspace root directory.');
        }
        await fsp.rm(target, { recursive: true, force: true });
        return { deleted: true, path: args.path };
      }
      case 'gitStatus': {
        if (!args.workspace) throw new Error('Select a workspace folder first.');
        return inspectGitWorkspace(args.workspace);
      }
      case 'gitDiff': {
        if (!args.workspace) throw new Error('Select a workspace folder first.');
        return executeGitOperation(args.workspace, { operation: 'diff', target: args.target, staged: args.staged });
      }
      case 'gitAction': {
        if (!args.workspace) throw new Error('Select a workspace folder first.');
        return executeGitOperation(args.workspace, args);
      }
      case 'runDiagnostics': {
        if (!args.workspace) throw new Error('Select a workspace folder first.');
        return runCodeDiagnostics(args.workspace, args.path || '.');
      }
      case 'terminalExec': {
        const cwd = args.workspace || process.cwd();
        if (typeof args.command !== 'string' || !args.command.trim()) throw new Error('Enter a command to execute.');
        return runtime.shells.exec(args.sessionId || 'studio-terminal', args.command, { defaultCwd: cwd, timeout: 120000 });
      }
      case 'processesList': return runtime.processes.list();
      case 'processStart': return runtime.processes.start({ command: args.command, cwd: args.workspace || process.cwd(), label: args.label });
      case 'processOutput': return runtime.processes.get(args.id);
      case 'processStop': return runtime.processes.stop(args.id);
      case 'memoriesList': return store.state.memories || [];
      case 'memorySave': {
        store.state.memories ||= [];
        if (typeof args.key !== 'string' || !args.key.trim() || typeof args.value !== 'string' || !args.value.trim()) throw new Error('Key and value are required.');
        const scope = args.scope === 'project' ? 'project' : 'global';
        const workspace = scope === 'project' ? (args.workspace || '') : '';
        const existing = store.state.memories.find(m => m.id === args.id || (m.key.toLowerCase() === args.key.trim().toLowerCase() && m.scope === scope && m.workspace === workspace));
        if (existing) {
          existing.key = args.key.trim().slice(0, 120);
          existing.value = args.value.trim().slice(0, 4000);
          existing.scope = scope;
          existing.workspace = workspace;
          existing.updatedAt = new Date().toISOString();
        } else {
          store.state.memories.push({
            id: crypto.randomUUID(),
            key: args.key.trim().slice(0, 120),
            value: args.value.trim().slice(0, 4000),
            scope,
            workspace,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
        runtime.changed(null);
        return store.state.memories;
      }
      case 'memoryDelete': {
        store.state.memories = (store.state.memories || []).filter(m => m.id !== args.id);
        runtime.changed(null);
        return store.state.memories;
      }
      case 'systemInfo': return inspectSystemEnvironment(args.workspace || process.cwd());
      case 'exportTaskMarkdown': {
        const task = store.task(args.id);
        const markdown = '# ' + task.title + '\n\n## Objective\n' + task.prompt + '\n\n## Continuity\n' + task.summary + '\n\n## Conversation\n' + task.conversation.map(m => '### ' + m.role + '\n' + (m.content || (m.reasoning ? ('(step ' + m.step + ' reasoning)\n' + m.reasoning) : ''))).join('\n\n') + '\n\n## Journal\n' + task.events.map(e => '### ' + e.at + ' · ' + e.kind + '\n\n' + JSON.stringify(e.detail, null, 2)).join('\n\n');
        if (args.filePath) {
          fs.writeFileSync(args.filePath, markdown, 'utf8');
          return { saved: true, path: args.filePath };
        }
        return { filename: 'nexus-' + task.id.slice(0, 8) + '.md', markdown };
      }
      default:
        throw new Error('Unknown operation: ' + method);
    }
  }

  const checkAuth = (req, url) => {
    if (!requireToken) return true;
    const header = req.headers['x-nexus-token'];
    const queryToken = url.searchParams.get('token');
    return safeTokenEqual(header, token) || safeTokenEqual(queryToken, token);
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const corsOrigin = allowedCorsOrigin(req);
      const corsHeaders = corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin, Vary: 'Origin' } : {};

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          ...corsHeaders,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Nexus-Token',
        });
        res.end();
        return;
      }

      if (url.pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ ok: true, version: APP_VERSION, pid: process.pid, nativeHost }));
        return;
      }

      if (url.pathname === '/api/events') {
        if (!checkAuth(req, url)) { res.writeHead(401); res.end('Unauthorized'); return; }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          ...corsHeaders,
        });
        res.write('event: ready\ndata: {}\n\n');
        sseClients.add(res);
        const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
        req.on('close', () => { clearInterval(keepAlive); sseClients.delete(res); });
        return;
      }

      if (url.pathname === '/api/invoke' && req.method === 'POST') {
        if (!checkAuth(req, url)) { res.writeHead(401, { 'Content-Type': 'application/json', ...corsHeaders }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
        try {
          const body = await readJsonBody(req);
          const result = await invoke(body.method, body.args || {});
          res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify({ ok: true, result }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }));
        }
        return;
      }

      // Serve built UI files cleanly
      if (req.method === 'GET') {
        let requested;
        try {
          requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Malformed URL path.');
          return;
        }
        const resolvedUi = path.resolve(uiDir);
        let filePath = path.resolve(resolvedUi, '.' + requested);
        const insideUi = filePath === resolvedUi || filePath.startsWith(resolvedUi + path.sep);
        if (!insideUi || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(resolvedUi, 'index.html');
        }
        if (!fs.existsSync(filePath)) {
          res.writeHead(503, { 'Content-Type': 'text/plain' });
          res.end('NEXUS UI not built yet. Run "npm run build" in desktop/.');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad request: ' + (err?.message || 'invalid request'));
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const baseUrl = `http://${host}:${actualPort}`;

  const close = async () => {
    clearTimeout(broadcastTimer);
    clearTimeout(deltaTimer);
    for (const res of sseClients) { try { res.end(); } catch {} }
    sseClients.clear();
    automations.stop();
    terminals.closeAll();
    await tor.stop().catch(() => {});
    configFile.close();
    runtime.shutdown();
    await mcp.close().catch(() => {});
    store.close();
    await new Promise(resolve => server.close(() => resolve()));
  };

  return { server, port: actualPort, url: baseUrl, token, dataDir, runtime, store, mcp, vault, configFile, automations, terminals, tor, invoke, close };
}

// Direct CLI execution entrypoint (used by native NEXUS.exe host or standalone headless mode)
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const appendCoreLog = (label, err) => {
    try {
      const logsDir = path.join(resolveDataDirectory(), 'logs');
      fs.mkdirSync(logsDir, { recursive: true });
      fs.appendFileSync(path.join(logsDir, 'core.log'), `[${new Date().toISOString()}] ${label}: ${err?.stack || err?.message || String(err)}\n`);
    } catch {}
  };
  process.on('uncaughtException', err => {
    appendCoreLog('uncaughtException', err);
    console.error('NEXUS core uncaughtException:', err?.message || err);
  });
  process.on('unhandledRejection', reason => {
    appendCoreLog('unhandledRejection', reason);
    console.error('NEXUS core unhandledRejection:', reason?.message || reason);
  });
  const args = process.argv.slice(2);
  const flagValue = name => {
    const idx = args.indexOf(name);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const port = Number(flagValue('--port') ?? process.env.NEXUS_PORT ?? (args.includes('--standalone') ? 4789 : 0));
  const nativeHost = args.includes('--native-host');
  const openBrowser = args.includes('--open');
  const noAuth = args.includes('--no-auth');
  const token = flagValue('--token') || process.env.NEXUS_TOKEN || (noAuth ? '' : crypto.randomBytes(24).toString('hex'));

  createNexusServer({ port, token, requireToken: !noAuth, nativeHost }).then(instance => {
    const readyPayload = {
      port: instance.port,
      url: instance.url,
      token: instance.token,
      dataDir: instance.dataDir,
      pid: process.pid,
    };
    process.stdout.write('NEXUS_SERVER_READY:' + JSON.stringify(readyPayload) + '\n');
    if (openBrowser) {
      openWithShell(`${instance.url}/${instance.token ? '?token=' + instance.token : ''}`);
    }
    const shutdown = () => { void instance.close().finally(() => process.exit(0)); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch(err => {
    process.stderr.write('NEXUS_SERVER_ERROR:' + (err?.stack || err?.message || String(err)) + '\n');
    process.exit(1);
  });
}
