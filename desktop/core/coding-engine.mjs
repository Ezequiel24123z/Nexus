import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function globToRegExp(globPattern = '*') {
  const normalized = String(globPattern || '*').replace(/\\/g, '/').trim();
  let regex = '^';
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        if (normalized[i + 2] === '/') {
          regex += '(?:.*/)?';
          i += 2;
        } else {
          regex += '.*';
          i += 1;
        }
      } else {
        regex += '[^/]*';
      }
    } else if (ch === '?') {
      regex += '[^/]';
    } else if (ch === '{') {
      const close = normalized.indexOf('}', i);
      if (close > i) {
        const parts = normalized.slice(i + 1, close).split(',').map(p => p.replace(/[.+^$()|[\]\\]/g, '\\$&'));
        regex += '(?:' + parts.join('|') + ')';
        i = close;
      } else {
        regex += '\\{';
      }
    } else if ('.+^$()|[]\\'.includes(ch)) {
      regex += '\\' + ch;
    } else {
      regex += ch;
    }
  }
  regex += '$';
  return new RegExp(regex, 'i');
}

export async function readFileWithRanges(target, requestedPath, { startLine, endLine } = {}) {
  const stat = await fs.stat(target);
  const hasRange = Number.isInteger(startLine) || Number.isInteger(endLine);
  if (!hasRange && stat.size > 100000) {
    throw new Error('File exceeds 100 KB. Provide startLine and endLine (or use grep_search) to read a specific section.');
  }
  if (stat.size > 10 * 1024 * 1024) {
    throw new Error('File exceeds 10 MB.');
  }
  const raw = await fs.readFile(target, 'utf8');
  if (!hasRange) {
    return { path: requestedPath, content: raw, totalLines: raw.split(/\r?\n/).length, bytes: stat.size };
  }
  const lines = raw.split(/\r?\n/);
  const start = Math.max(1, Number.isInteger(startLine) ? startLine : 1);
  const end = Math.min(lines.length, Number.isInteger(endLine) && endLine >= start ? endLine : Math.min(lines.length, start + 250));
  const slice = lines.slice(start - 1, end).map((line, idx) => `${start + idx}: ${line}`).join('\n');
  return {
    path: requestedPath,
    startLine: start,
    endLine: end,
    totalLines: lines.length,
    bytes: stat.size,
    content: slice,
    hasMore: end < lines.length,
  };
}

export async function multiEditFile(store, task, target, requestedPath, edits = [], reason = 'Multi-edit update') {
  if (!Array.isArray(edits) || !edits.length || edits.length > 50) {
    throw new Error('Provide between 1 and 50 edit operations.');
  }
  const previous = await fs.readFile(target, 'utf8').catch(error => {
    if (error.code === 'ENOENT') throw new Error('Target file does not exist: ' + requestedPath);
    throw error;
  });
  let content = previous;
  const applied = [];
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    if (!edit || typeof edit.oldText !== 'string' || !edit.oldText || typeof edit.newText !== 'string') {
      throw new Error(`Invalid edit at index ${i}: oldText and newText are required.`);
    }
    const parts = content.split(edit.oldText);
    if (parts.length !== 2) {
      throw new Error(`Edit #${i + 1} failed: oldText must match exactly once (found ${parts.length - 1} matches).`);
    }
    content = content.replace(edit.oldText, () => edit.newText);
    applied.push({ index: i + 1, removedChars: edit.oldText.length, addedChars: edit.newText.length });
  }
  if (Buffer.byteLength(content, 'utf8') > 500000) {
    throw new Error('Resulting file content exceeds 500 KB limit.');
  }
  const backup = path.join(store.directoryFor(task.id), 'backup-' + crypto.randomUUID() + '.txt');
  await fs.writeFile(backup, previous, 'utf8');
  store.journal(task, 'write_intent', { path: target, reason, backup, existed: true, edits: applied.length });
  await fs.writeFile(target, content, 'utf8');
  store.journal(task, 'file_change', { path: target, reason, backup, bytes: Buffer.byteLength(content, 'utf8'), edits: applied.length });
  return { written: requestedPath, backup, bytes: Buffer.byteLength(content, 'utf8'), editsApplied: applied.length, details: applied };
}

export async function applyPatchToFile(store, task, target, requestedPath, patchText, reason = 'Apply patch') {
  if (typeof patchText !== 'string' || !patchText.trim()) {
    throw new Error('Provide a non-empty patch string.');
  }
  // Support SEARCH/REPLACE blocks (Aider / Cline / Claude Code format) or unified diff hunks
  const searchReplaceRegex = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;
  const blocks = [...patchText.matchAll(searchReplaceRegex)];
  if (blocks.length > 0) {
    const edits = blocks.map(match => ({ oldText: match[1], newText: match[2] }));
    return multiEditFile(store, task, target, requestedPath, edits, reason);
  }
  const previous = await fs.readFile(target, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const lines = previous ? previous.split(/\r?\n/) : [];
  const patchLines = patchText.split(/\r?\n/);
  const hunks = [];
  let current = null;
  for (const line of patchLines) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header) {
      if (current) hunks.push(current);
      current = { oldStart: Number(header[1]), lines: [] };
      continue;
    }
    if (current && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-'))) {
      current.lines.push(line);
    }
  }
  if (current) hunks.push(current);
  if (!hunks.length) {
    throw new Error('Patch must contain either <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE blocks or unified @@ -l,s +l,s @@ hunks.');
  }
  const edits = hunks.map(hunk => {
    const oldText = hunk.lines.filter(l => !l.startsWith('+')).map(l => l.slice(1)).join('\n');
    const newText = hunk.lines.filter(l => !l.startsWith('-')).map(l => l.slice(1)).join('\n');
    return { oldText, newText };
  });
  return multiEditFile(store, task, target, requestedPath, edits, reason);
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'release', '.next', '.turbo', 'coverage', 'build', '.cache']);

export async function globWorkspaceFiles(root, pattern = '**/*', { resolvePath, maxResults = 250, signal } = {}) {
  const matcher = globToRegExp(pattern);
  const basenameMatcher = !pattern.includes('/') && !pattern.includes('\\') ? globToRegExp(pattern) : null;
  const matches = [];
  let visited = 0;
  const walk = async directory => {
    signal?.throwIfAborted();
    if (matches.length >= maxResults || visited >= 6000) return;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (matches.length >= maxResults || visited >= 6000) return;
      if (entry.isSymbolicLink() || IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      const rel = path.relative(root, fullPath).replace(/\\/g, '/');
      if (resolvePath) {
        try { await resolvePath(root, path.relative(root, fullPath)); } catch { continue; }
      }
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        visited++;
        if (matcher.test(rel) || (basenameMatcher && basenameMatcher.test(entry.name))) {
          matches.push(rel);
        }
      }
    }
  };
  await walk(root);
  return { pattern, matches, count: matches.length, visited, bounded: matches.length >= maxResults || visited >= 6000 };
}

export async function grepWorkspaceFiles(root, { query, isRegex = false, caseSensitive = false, glob = '', contextLines = 0, maxMatches = 100, resolvePath, signal } = {}) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('Provide a non-empty search query or regex pattern.');
  const flags = caseSensitive ? '' : 'i';
  let regex;
  try {
    regex = isRegex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  } catch (error) {
    throw new Error('Invalid regular expression: ' + error.message);
  }
  const fileMatcher = glob ? globToRegExp(glob) : null;
  const fileBaseMatcher = glob && !glob.includes('/') && !glob.includes('\\') ? globToRegExp(glob) : null;
  const ctx = Math.max(0, Math.min(Number.isInteger(contextLines) ? contextLines : 0, 5));
  const matches = [];
  let visited = 0;

  const walk = async directory => {
    signal?.throwIfAborted();
    if (matches.length >= maxMatches || visited >= 3000) return;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (matches.length >= maxMatches || visited >= 3000) return;
      if (entry.isSymbolicLink() || IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      const rel = path.relative(root, fullPath);
      const relPosix = rel.replace(/\\/g, '/');
      if (resolvePath) {
        try { await resolvePath(root, rel); } catch { continue; }
      }
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (fileMatcher && !fileMatcher.test(relPosix) && !(fileBaseMatcher && fileBaseMatcher.test(entry.name))) continue;
      visited++;
      let stat;
      try { stat = await fs.stat(fullPath); } catch { continue; }
      if (stat.size > 300000) continue;
      let text;
      try { text = await fs.readFile(fullPath, 'utf8'); } catch { continue; }
      if (text.includes('\u0000')) continue;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= maxMatches) break;
        if (regex.test(lines[i])) {
          const item = { path: rel, line: i + 1, text: lines[i].slice(0, 400) };
          if (ctx > 0) {
            const start = Math.max(0, i - ctx);
            const end = Math.min(lines.length - 1, i + ctx);
            item.context = lines.slice(start, end + 1).map((l, idx) => `${start + idx + 1}: ${l.slice(0, 300)}`);
          }
          matches.push(item);
        }
      }
    }
  };
  await walk(root);
  return { matches, visited, bounded: visited >= 3000 || matches.length >= maxMatches };
}

export async function runGit(cwd, args, { signal, timeout = 30000 } = {}) {
  if (!cwd) throw new Error('Select a workspace folder to run Git operations.');
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    const child = spawn('git', ['--no-pager', ...args], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    let stdout = '', stderr = '', stopped = false;
    const stop = () => {
      stopped = true;
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    };
    const timer = timeout > 0 ? setTimeout(stop, timeout) : null;
    signal?.addEventListener('abort', stop, { once: true });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
    child.stdout.on('data', d => { stdout = (stdout + d).slice(-64000); });
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-32000); });
    child.on('error', err => { cleanup(); reject(err); });
    child.on('close', code => {
      cleanup();
      if (stopped) reject(new Error('Git operation timed out or was cancelled.'));
      else resolve({ exitCode: code, stdout: stdout.trimEnd(), stderr: stderr.trimEnd() });
    });
  });
}

export async function inspectGitWorkspace(cwd, { signal } = {}) {
  if (!cwd) return { isRepo: false, branch: null, files: [], clean: true };
  try {
    const statusRes = await runGit(cwd, ['status', '--porcelain=v1', '-b'], { signal, timeout: 10000 });
    if (statusRes.exitCode !== 0) return { isRepo: false, branch: null, files: [], clean: true, error: statusRes.stderr };
    const lines = statusRes.stdout.split(/\r?\n/).filter(Boolean);
    let branch = 'HEAD', ahead = 0, behind = 0;
    const files = [];
    for (const line of lines) {
      if (line.startsWith('## ')) {
        const header = line.slice(3);
        branch = header.split('...')[0].replace(/^No commits yet on /, '').trim();
        const aheadMatch = /ahead (\d+)/.exec(header);
        const behindMatch = /behind (\d+)/.exec(header);
        if (aheadMatch) ahead = Number(aheadMatch[1]);
        if (behindMatch) behind = Number(behindMatch[1]);
      } else if (line.length >= 3) {
        const indexStatus = line[0];
        const worktreeStatus = line[1];
        const filePath = line.slice(3).trim();
        files.push({
          path: filePath,
          index: indexStatus,
          workingTree: worktreeStatus,
          staged: indexStatus !== ' ' && indexStatus !== '?',
          untracked: indexStatus === '?' && worktreeStatus === '?',
        });
      }
    }
    const logRes = await runGit(cwd, ['log', '-n', '8', '--pretty=format:%h|%s|%an|%cr'], { signal, timeout: 10000 }).catch(() => ({ exitCode: 1, stdout: '' }));
    const commits = logRes.exitCode === 0 && logRes.stdout
      ? logRes.stdout.split(/\r?\n/).filter(Boolean).map(row => {
          const [hash, subject, author, relativeDate] = row.split('|');
          return { hash, subject, author, relativeDate };
        })
      : [];
    return { isRepo: true, branch, ahead, behind, clean: files.length === 0, files, commits };
  } catch (error) {
    return { isRepo: false, branch: null, files: [], clean: true, error: error.message };
  }
}

export async function executeGitOperation(cwd, args = {}, signal) {
  const op = args.operation || 'status';
  if (op === 'status') return inspectGitWorkspace(cwd, { signal });
  if (op === 'diff') {
    const flags = ['diff'];
    if (args.staged) flags.push('--staged');
    if (args.target) flags.push('--', args.target);
    const res = await runGit(cwd, flags, { signal });
    return { operation: 'diff', staged: Boolean(args.staged), target: args.target || null, diff: res.stdout || '(No diff)', exitCode: res.exitCode };
  }
  if (op === 'log') {
    const count = Math.max(1, Math.min(Number(args.limit) || 15, 50));
    const res = await runGit(cwd, ['log', `-n`, String(count), '--oneline', '--decorate'], { signal });
    return { operation: 'log', output: res.stdout, exitCode: res.exitCode };
  }
  if (op === 'branch') {
    const res = await runGit(cwd, ['branch', '-a'], { signal });
    return { operation: 'branch', output: res.stdout, exitCode: res.exitCode };
  }
  if (op === 'stage') {
    const paths = Array.isArray(args.paths) && args.paths.length ? args.paths : [args.target || '.'];
    const res = await runGit(cwd, ['add', '--', ...paths], { signal });
    if (res.exitCode !== 0) throw new Error(res.stderr || 'git add failed');
    return inspectGitWorkspace(cwd, { signal });
  }
  if (op === 'unstage') {
    const paths = Array.isArray(args.paths) && args.paths.length ? args.paths : [args.target || '.'];
    const res = await runGit(cwd, ['reset', 'HEAD', '--', ...paths], { signal });
    if (res.exitCode !== 0) throw new Error(res.stderr || 'git reset failed');
    return inspectGitWorkspace(cwd, { signal });
  }
  if (op === 'commit') {
    if (typeof args.message !== 'string' || !args.message.trim()) throw new Error('Provide a commit message.');
    if (args.stageAll) await runGit(cwd, ['add', '-A'], { signal });
    const res = await runGit(cwd, ['commit', '-m', args.message.trim()], { signal });
    if (res.exitCode !== 0) throw new Error(res.stderr || res.stdout || 'git commit failed');
    return { operation: 'commit', output: res.stdout, status: await inspectGitWorkspace(cwd, { signal }) };
  }
  if (op === 'worktree_list') {
    const res = await runGit(cwd, ['worktree', 'list', '--porcelain'], { signal });
    const worktrees = [];
    let current = null;
    for (const line of (res.stdout || '').split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        if (current) worktrees.push(current);
        current = { path: line.slice(9).trim(), head: '', branch: 'detached' };
      } else if (current && line.startsWith('HEAD ')) {
        current.head = line.slice(5).trim().slice(0, 8);
      } else if (current && line.startsWith('branch ')) {
        current.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
      }
    }
    if (current) worktrees.push(current);
    return { operation: 'worktree_list', worktrees, output: res.stdout, exitCode: res.exitCode };
  }
  if (op === 'worktree_add') {
    if (!args.path || !args.branch) throw new Error('worktree_add requires path and branch.');
    const res = await runGit(cwd, ['worktree', 'add', '-b', args.branch, args.path], { signal });
    if (res.exitCode !== 0) throw new Error(res.stderr || 'git worktree add failed');
    return { operation: 'worktree_add', path: args.path, branch: args.branch, output: res.stdout };
  }
  if (op === 'worktree_remove') {
    if (!args.path) throw new Error('worktree_remove requires path.');
    const res = await runGit(cwd, ['worktree', 'remove', '--force', args.path], { signal });
    if (res.exitCode !== 0) throw new Error(res.stderr || 'git worktree remove failed');
    return { operation: 'worktree_remove', path: args.path, output: res.stdout };
  }
  throw new Error('Unsupported git operation: ' + op);
}

export class ProcessManager {
  constructor() {
    this.processes = new Map();
  }
  start({ command, cwd, label = '' }) {
    if (typeof command !== 'string' || !command.trim()) throw new Error('Provide a command to start.');
    const id = 'proc-' + crypto.randomUUID().slice(0, 8);
    const shellExe = process.platform === 'win32' ? 'powershell.exe' : 'sh';
    const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];
    const child = spawn(shellExe, shellArgs, {
      cwd: cwd || process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const entry = {
      id,
      pid: child.pid || null,
      command,
      label: label || command.slice(0, 60),
      cwd: cwd || process.cwd(),
      status: 'running',
      exitCode: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      output: '',
      child,
    };
    const append = chunk => {
      entry.output = (entry.output + chunk.toString('utf8')).slice(-64000);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', err => {
      entry.status = 'failed';
      entry.output = (entry.output + '\n[Process error: ' + err.message + ']').slice(-64000);
      entry.endedAt = new Date().toISOString();
    });
    child.on('close', code => {
      if (entry.status === 'running') entry.status = code === 0 ? 'completed' : 'exited';
      entry.exitCode = code;
      entry.endedAt = new Date().toISOString();
    });
    this.processes.set(id, entry);
    return this.serialize(entry);
  }
  get(id) {
    const entry = this.processes.get(id);
    if (!entry) throw new Error('Background process not found: ' + id);
    return this.serialize(entry, true);
  }
  list() {
    return [...this.processes.values()].map(entry => this.serialize(entry, false)).reverse();
  }
  stop(id) {
    const entry = this.processes.get(id);
    if (!entry) throw new Error('Background process not found: ' + id);
    if (entry.status === 'running' && entry.child) {
      entry.status = 'stopped';
      entry.endedAt = new Date().toISOString();
      if (process.platform === 'win32' && entry.pid) {
        spawn('taskkill', ['/PID', String(entry.pid), '/T', '/F'], { windowsHide: true });
      } else {
        try { entry.child.kill('SIGKILL'); } catch {}
      }
    }
    return this.serialize(entry, true);
  }
  stopAll() {
    for (const id of this.processes.keys()) {
      try { this.stop(id); } catch {}
    }
  }
  serialize(entry, includeOutput = false) {
    return {
      id: entry.id,
      pid: entry.pid,
      command: entry.command,
      label: entry.label,
      cwd: entry.cwd,
      status: entry.status,
      exitCode: entry.exitCode,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      outputPreview: entry.output.slice(-1200),
      ...(includeOutput ? { output: entry.output } : {}),
    };
  }
}

export function discoverWorkspaceInstructions(workspace) {
  if (!workspace || typeof workspace !== 'string') return '';
  const candidates = ['NEXUS.md', 'CLAUDE.md', 'AGENTS.md', '.cursorrules', path.join('.github', 'copilot-instructions.md')];
  const found = [];
  let totalChars = 0;
  for (const rel of candidates) {
    if (totalChars >= 12000) break;
    const full = path.join(workspace, rel);
    try {
      if (fsSync.existsSync(full) && fsSync.statSync(full).isFile()) {
        const text = fsSync.readFileSync(full, 'utf8').trim();
        if (text) {
          const budget = Math.min(6000, 12000 - totalChars);
          found.push(`[${rel}]\n${text.slice(0, budget)}`);
          totalChars += Math.min(text.length, budget);
        }
      }
    } catch {}
  }
  return found.join('\n\n');
}

export function htmlToReadableText(html = '') {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<(?:p|div|section|article|tr|br)[^>]*>/gi, '\n')
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function fetchWebResource(urlInput, { extractText = true, offset = 0, length = 12000, request = fetch, signal } = {}) {
  let parsed;
  try { parsed = new URL(urlInput); } catch { throw new Error('Invalid URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  const response = await request(parsed.href, {
    headers: { 'User-Agent': 'NEXUS-Agent/0.3 (+https://github.com/Ezequiel24123z/Nexus)' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
  });
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  const processed = extractText && contentType.includes('text/html') ? htmlToReadableText(raw) : raw;
  const start = Math.max(0, Number.isInteger(offset) ? offset : 0);
  const limit = Math.max(100, Math.min(Number.isInteger(length) ? length : 12000, 24000));
  return {
    url: parsed.href,
    status: response.status,
    contentType,
    totalLength: processed.length,
    offset: start,
    content: processed.slice(start, start + limit),
    next: start + limit < processed.length ? start + limit : null,
  };
}

export async function inspectSystemEnvironment(cwd) {
  const tools = {};
  for (const [name, bin, arg] of [
    ['node', process.execPath, '--version'],
    ['git', 'git', '--version'],
    ['python', 'python', '--version'],
    ['gh', 'gh', '--version'],
  ]) {
    try {
      const { stdout } = await execFileAsync(bin, [arg], { timeout: 4000, windowsHide: true });
      tools[name] = stdout.split(/\r?\n/)[0].trim();
    } catch {
      tools[name] = null;
    }
  }
  return {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    totalMemoryGb: +(os.totalmem() / (1024 ** 3)).toFixed(2),
    freeMemoryGb: +(os.freemem() / (1024 ** 3)).toFixed(2),
    cwd: cwd || process.cwd(),
    tools,
  };
}

export async function detectLocalCopilotToken() {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 5000, windowsHide: true });
    const token = stdout.trim();
    if (token) return { source: 'GitHub CLI (gh auth token)', token };
  } catch {}
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  for (const file of ['hosts.json', 'apps.json']) {
    try {
      const target = path.join(localAppData, 'github-copilot', file);
      if (fsSync.existsSync(target)) {
        const data = JSON.parse(fsSync.readFileSync(target, 'utf8'));
        for (const entry of Object.values(data || {})) {
          if (entry?.oauth_token) return { source: `github-copilot/${file}`, token: entry.oauth_token };
        }
      }
    } catch {}
  }
  throw new Error('Could not find an active GitHub CLI (`gh auth login`) or local GitHub Copilot token. Paste your token manually below.');
}

export async function extractCodeOutline(root, requestedPath = '.', { resolvePath, maxFiles = 40 } = {}) {
  const target = resolvePath ? await resolvePath(root, requestedPath, false) : path.resolve(root, requestedPath);
  const stat = await fs.stat(target);
  const symbolPatterns = [
    { kind: 'export', regex: /^\s*export\s+(?:default\s+)?(?:async\s+)?(function|class|const|let|interface|type|enum)\s+([A-Za-z0-9_$]+)/ },
    { kind: 'function', regex: /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/ },
    { kind: 'class', regex: /^\s*class\s+([A-Za-z0-9_$]+)/ },
    { kind: 'def', regex: /^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(/ },
    { kind: 'struct/fn', regex: /^\s*(?:pub\s+)?(?:async\s+)?(?:fn|struct|enum|trait|func|type)\s+([A-Za-z0-9_]+)/ },
  ];
  const parseFile = async (filePath, relName) => {
    const fstat = await fs.stat(filePath);
    if (fstat.size > 500000) return { path: relName, skipped: 'File > 500 KB' };
    const text = await fs.readFile(filePath, 'utf8').catch(() => '');
    if (!text || text.includes('\u0000')) return null;
    const lines = text.split(/\r?\n/);
    const symbols = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pat of symbolPatterns) {
        const m = pat.regex.exec(line);
        if (m) {
          symbols.push({ line: i + 1, kind: m[2] ? m[1] : pat.kind, name: m[2] || m[1], signature: line.trim().slice(0, 140) });
          break;
        }
      }
      if (symbols.length >= 120) break;
    }
    return { path: relName, totalLines: lines.length, symbols };
  };

  if (stat.isFile()) {
    return await parseFile(target, requestedPath);
  }
  const files = [];
  const walk = async dir => {
    if (files.length >= maxFiles) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.isSymbolicLink() || IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (entry.isDirectory()) await walk(full);
      else if (/\.(mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|cs)$/i.test(entry.name)) {
        const parsed = await parseFile(full, rel);
        if (parsed && parsed.symbols?.length) files.push(parsed);
      }
    }
  };
  await walk(target);
  return { root: requestedPath, filesInspected: files.length, outlines: files };
}

export async function scaffoldMcpServer(store, mcp, { name, description = '', tools = [] } = {}) {
  if (typeof name !== 'string' || !/^[\w -]{1,60}$/.test(name.trim())) {
    throw new Error('Provide a valid MCP server name (1-60 alphanumeric, space, underscore, or hyphen characters).');
  }
  if (!Array.isArray(tools) || !tools.length || tools.length > 30) {
    throw new Error('Provide between 1 and 30 tool definitions for the MCP server.');
  }
  const normalizedTools = tools.map(t => {
    if (!t || typeof t.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(t.name)) {
      throw new Error('Each MCP tool requires a valid alphanumeric name.');
    }
    return {
      name: t.name,
      description: String(t.description || t.name).slice(0, 500),
      inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {}, additionalProperties: true },
      handlerCode: String(t.handlerCode || 'return { result: args };'),
    };
  });

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const serverDir = path.join(store.directory, 'mcp-servers', slug);
  await fs.mkdir(serverDir, { recursive: true });
  const scriptPath = path.join(serverDir, 'server.mjs');

  const serverSource = `// Auto-generated NEXUS MCP Server: ${name.trim()}
import readline from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const TOOLS = ${JSON.stringify(normalizedTools.map(({ name: tName, description: tDesc, inputSchema }) => ({ name: tName, description: tDesc, inputSchema })), null, 2)};

const HANDLERS = {
${normalizedTools.map(t => `  ${JSON.stringify(t.name)}: async (args, context) => {\n    ${t.handlerCode}\n  }`).join(',\n')}
};

const rl = readline.createInterface({ input: process.stdin, terminal: false });
const send = msg => process.stdout.write(JSON.stringify(msg) + '\\n');

rl.on('line', async line => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  if (!req || req.id === undefined) return;
  try {
    if (req.method === 'initialize') {
      return send({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          protocolVersion: req.params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: ${JSON.stringify(name.trim())}, version: '1.0.0' }
        }
      });
    }
    if (req.method === 'tools/list') {
      return send({ jsonrpc: '2.0', id: req.id, result: { tools: TOOLS } });
    }
    if (req.method === 'tools/call') {
      const toolName = req.params?.name;
      const handler = HANDLERS[toolName];
      if (!handler) throw new Error('Unknown tool: ' + toolName);
      const output = await handler(req.params?.arguments || {}, { fs, path, os, crypto, execFileAsync });
      const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
      return send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text }] } });
    }
    send({ jsonrpc: '2.0', id: req.id, result: {} });
  } catch (error) {
    send({ jsonrpc: '2.0', id: req.id, error: { code: -32000, message: error.message || String(error) } });
  }
});
`;

  await fs.writeFile(scriptPath, serverSource, 'utf8');
  const serverConfig = {
    name: name.trim(),
    transport: 'stdio',
    command: process.execPath,
    args: [scriptPath],
    envSecrets: {},
    description: String(description || 'Autonomous local MCP server').slice(0, 300),
    autoCreated: true,
  };
  if (mcp) await mcp.disconnect(serverConfig.name).catch(() => {});
  const existingIdx = store.state.mcpServers.findIndex(s => s.name === serverConfig.name);
  if (existingIdx >= 0) store.state.mcpServers[existingIdx] = serverConfig;
  else store.state.mcpServers.push(serverConfig);
  store.save(null);
  let discoveredTools = normalizedTools.map(t => t.name);
  if (mcp) {
    try {
      const live = await mcp.list(serverConfig.name);
      discoveredTools = live.map(t => t.name);
    } catch {}
  }
  return {
    created: true,
    server: serverConfig.name,
    scriptPath,
    tools: discoveredTools,
  };
}

export function runSelfImprovement(runtime, task, args = {}) {
  const store = runtime.store;
  const action = args.action || 'analyze';
  if (action === 'analyze') {
    const tasks = store.state.tasks || [];
    const totalCalls = tasks.reduce((n, t) => n + (t.calls?.length || 0), 0);
    const toolErrors = tasks.flatMap(t => (t.events || []).filter(e => e.kind === 'tool_error').map(e => ({ task: t.title, tool: e.detail?.name, error: e.detail?.error }))).slice(-20);
    const fileChanges = tasks.flatMap(t => (t.events || []).filter(e => e.kind === 'file_change').map(e => e.detail?.path)).slice(-30);
    return {
      summary: {
        totalTasks: tasks.length,
        completedTasks: tasks.filter(t => t.status === 'complete').length,
        totalModelCalls: totalCalls,
        skillsCount: runtime.capabilities.summary().skills,
        functionsCount: runtime.capabilities.summary().functions,
        mcpServersCount: (store.state.mcpServers || []).length,
        connectorsCount: (store.state.connectors || []).length,
        memoriesCount: (store.state.memories || []).length,
      },
      recentToolErrors: toolErrors,
      recentModifiedFiles: [...new Set(fileChanges)],
      recommendations: [
        toolErrors.length > 0 ? 'Convert recurring tool error resolutions into a reusable Skill via save_capability or self_improve(action="synthesize_skill").' : 'Zero recent tool errors recorded.',
        (store.state.mcpServers || []).length === 0 ? 'Use scaffold_mcp_server to create domain-specific local MCP servers on the fly.' : 'Active MCP servers available.',
      ],
    };
  }
  if (action === 'synthesize_skill') {
    if (!args.name || !args.instructions) throw new Error('synthesize_skill requires name and instructions.');
    const saved = runtime.capabilities.save({
      kind: 'skill',
      name: args.name,
      description: args.description || 'Self-synthesized agentic skill',
      tags: Array.isArray(args.tags) ? args.tags : ['self-improved', 'automation'],
      enabled: true,
      instructions: args.instructions,
    });
    runtime.emit('change');
    return { synthesized: true, kind: 'skill', id: saved.id, name: saved.name, revision: saved.revision };
  }
  throw new Error('Unsupported self_improve action: ' + action);
}

export function expandSlashCommand(prompt = '') {
  const trimmed = String(prompt || '').trim();
  if (!trimmed.startsWith('/')) return { prompt, mode: undefined };
  const [cmd, ...rest] = trimmed.split(/\s+/);
  const argText = rest.join(' ').trim();
  switch (cmd.toLowerCase()) {
    case '/init':
      return {
        mode: 'agent',
        prompt: `Inspect this workspace using glob_files, read_file, and git_operation(status). Create or update a comprehensive NEXUS.md file in the workspace root documenting the project architecture, build/test commands, coding conventions, and key module paths.${argText ? ' Additional focus: ' + argText : ''}`,
      };
    case '/review':
      return {
        mode: 'explore',
        prompt: `Run git_operation(diff) and git_operation(status) to inspect current workspace changes, then perform a thorough code and security review with severity ratings, file/line citations, and concrete fix recommendations.${argText ? ' Focus on: ' + argText : ''}`,
      };
    case '/architect':
      return {
        mode: 'architect',
        prompt: `Analyze the codebase structure using glob_files, grep_search, and code_outline, then design a step-by-step architectural implementation plan and record the checklist with todo_write.${argText ? ' Objective: ' + argText : ''}`,
      };
    case '/mcp-create':
      return {
        mode: 'agent',
        prompt: `Design, scaffold, and register a new local MCP server using the scaffold_mcp_server tool, then verify its tools.${argText ? ' Specification: ' + argText : ''}`,
      };
    case '/self-improve':
      return {
        mode: 'agent',
        prompt: `Run self_improve(action="analyze") to introspect workspace telemetry, recent tool errors, and capability coverage. Propose and save a new reusable skill or MCP tool that improves future agentic coding efficiency.${argText ? ' Context: ' + argText : ''}`,
      };
    case '/diagnostics':
      return {
        mode: 'agent',
        prompt: `Run run_diagnostics on the workspace to check for syntax or type errors, then fix any reported issues.${argText ? ' Target: ' + argText : ''}`,
      };
    default:
      return { prompt, mode: undefined };
  }
}

export async function executeHttpRequest(args = {}, { request = fetch, signal } = {}) {
  let parsed;
  try { parsed = new URL(args.url); } catch { throw new Error('Invalid URL provided to http_request.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS protocols are supported.');
  const method = String(args.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) {
    throw new Error('Unsupported HTTP method: ' + method);
  }
  const headers = {};
  if (args.headers && typeof args.headers === 'object' && !Array.isArray(args.headers)) {
    for (const [k, v] of Object.entries(args.headers)) headers[String(k)] = String(v);
  }
  let body;
  if (args.body !== undefined && !['GET', 'HEAD'].includes(method)) {
    if (typeof args.body === 'string') body = args.body;
    else {
      body = JSON.stringify(args.body);
      if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
    }
  }
  const started = Date.now();
  const response = await request(parsed.href, {
    method,
    headers,
    body,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
  });
  const text = (await response.text()).slice(0, 32000);
  const responseHeaders = {};
  response.headers?.forEach?.((v, k) => { responseHeaders[k] = v; });
  return {
    url: parsed.href,
    method,
    status: response.status,
    ok: response.ok,
    latencyMs: Date.now() - started,
    headers: responseHeaders,
    body: text,
  };
}

export async function runCodeDiagnostics(workspace, targetPath = '.', { resolvePath, signal } = {}) {
  if (!workspace) throw new Error('Select a workspace folder to run diagnostics.');
  const target = resolvePath ? await resolvePath(workspace, targetPath, false) : path.resolve(workspace, targetPath);
  const stat = await fs.stat(target);
  const filesToCheck = [];
  if (stat.isFile()) {
    filesToCheck.push(target);
  } else {
    const walk = async dir => {
      if (filesToCheck.length >= 60) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (filesToCheck.length >= 60) break;
        if (entry.isSymbolicLink() || IGNORED_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (/\.(mjs|cjs|js|json)$/i.test(entry.name)) filesToCheck.push(full);
      }
    };
    await walk(target);
  }

  const diagnostics = [];
  for (const file of filesToCheck) {
    signal?.throwIfAborted();
    const rel = path.relative(workspace, file).replace(/\\/g, '/');
    if (file.endsWith('.json')) {
      try {
        JSON.parse(await fs.readFile(file, 'utf8'));
      } catch (err) {
        diagnostics.push({ file: rel, severity: 'error', tool: 'json', message: err.message });
      }
    } else if (/\.(mjs|cjs|js)$/i.test(file)) {
      try {
        await execFileAsync(process.execPath, ['--check', file], { timeout: 8000, windowsHide: true });
      } catch (err) {
        const stderr = String(err.stderr || err.message || '').trim();
        const lineMatch = /:(\d+)\r?\n/.exec(stderr);
        diagnostics.push({
          file: rel,
          line: lineMatch ? Number(lineMatch[1]) : null,
          severity: 'error',
          tool: 'node --check',
          message: stderr.split(/\r?\n/).slice(0, 6).join('\n'),
        });
      }
    }
  }
  return {
    workspace,
    target: targetPath,
    checkedFiles: filesToCheck.length,
    passed: diagnostics.length === 0,
    diagnostics,
  };
}

export class StatefulShellManager {
  constructor() {
    this.sessions = new Map();
  }
  getOrInit(taskId, defaultCwd) {
    if (!this.sessions.has(taskId)) {
      this.sessions.set(taskId, { cwd: defaultCwd || process.cwd(), env: {}, history: [] });
    }
    const session = this.sessions.get(taskId);
    if (!session.cwd && defaultCwd) session.cwd = defaultCwd;
    return session;
  }
  async exec(taskId, commandText, { defaultCwd, envOverrides, signal, timeout = 60000 } = {}) {
    if (typeof commandText !== 'string' || !commandText.trim()) throw new Error('Provide a shell command.');
    const session = this.getOrInit(taskId, defaultCwd);
    if (envOverrides && typeof envOverrides === 'object') {
      for (const [k, v] of Object.entries(envOverrides)) {
        if (v === null) delete session.env[k];
        else session.env[String(k)] = String(v);
      }
    }
    const marker = '__NEXUS_CWD_' + crypto.randomUUID().slice(0, 8) + '__';
    const isWin = process.platform === 'win32';
    const wrapped = isWin
      ? `${commandText}\n$__code = $LASTEXITCODE\nWrite-Output "${marker}:$((Get-Location).Path)"\nif ($__code -ne $null) { exit $__code }`
      : `${commandText}\n__code=$?\nprintf "\\n${marker}:%s\\n" "$(pwd)"\nexit $__code`;
    const exe = isWin ? 'powershell.exe' : 'sh';
    const args = isWin ? ['-NoProfile', '-NonInteractive', '-Command', wrapped] : ['-c', wrapped];

    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Cancelled'));
      const child = spawn(exe, args, {
        cwd: session.cwd,
        env: { ...process.env, ...session.env },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '', stopped = false;
      const stop = () => {
        stopped = true;
        if (isWin && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
        else child.kill('SIGKILL');
      };
      const timer = timeout > 0 ? setTimeout(stop, timeout) : null;
      signal?.addEventListener('abort', stop, { once: true });
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
      child.stdout.on('data', d => { stdout = (stdout + d).slice(-48000); });
      child.stderr.on('data', d => { stderr = (stderr + d).slice(-24000); });
      child.on('error', err => { cleanup(); reject(err); });
      child.on('close', code => {
        cleanup();
        if (stopped) return reject(new Error('Stateful shell command stopped or timed out.'));
        const markerRegex = new RegExp(`${marker}:([^\\r\\n]+)`);
        const match = markerRegex.exec(stdout);
        if (match && match[1]) {
          const nextCwd = match[1].trim();
          if (fsSync.existsSync(nextCwd)) session.cwd = nextCwd;
          stdout = stdout.replace(markerRegex, '').trimEnd();
        }
        const combined = (stdout + (stderr ? '\n' + stderr : '')).trim();
        session.history.push({ command: commandText, cwd: session.cwd, exitCode: code, at: new Date().toISOString() });
        if (session.history.length > 50) session.history.shift();
        resolve({ exitCode: code, cwd: session.cwd, envKeys: Object.keys(session.env), output: combined });
      });
    });
  }
}

export async function inspectWebPage(urlInput, { extractLinks = true, extractForms = true, renderJs = false, browserInspect, request = fetch, signal } = {}) {
  let parsed;
  try { parsed = new URL(urlInput); } catch { throw new Error('Invalid URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  if (renderJs && typeof browserInspect === 'function') {
    return browserInspect(parsed.href, { extractLinks, extractForms, signal });
  }
  const response = await request(parsed.href, {
    headers: { 'User-Agent': 'NEXUS-Agent/0.4 (+https://github.com/Ezequiel24123z/Nexus)' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
  });
  const html = await response.text();
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : parsed.hostname;
  const links = [];
  if (extractLinks) {
    for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      if (links.length >= 60) break;
      try {
        const href = new URL(m[1], parsed.href).href;
        const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (['http:', 'https:'].includes(new URL(href).protocol)) links.push({ text: text || href, url: href });
      } catch {}
    }
  }
  const forms = [];
  if (extractForms) {
    for (const m of html.matchAll(/<form([^>]*)>([\s\S]*?)<\/form>/gi)) {
      if (forms.length >= 20) break;
      const actionMatch = /action=["']([^"']+)["']/i.exec(m[1]);
      const methodMatch = /method=["']([^"']+)["']/i.exec(m[1]);
      const inputs = [...m[2].matchAll(/<(?:input|textarea|select)[^>]+name=["']([^"']+)["'][^>]*>/gi)].map(im => im[1]);
      forms.push({
        action: actionMatch ? actionMatch[1] : parsed.pathname,
        method: (methodMatch ? methodMatch[1] : 'GET').toUpperCase(),
        fields: inputs.slice(0, 30),
      });
    }
  }
  const text = htmlToReadableText(html).slice(0, 16000);
  return {
    url: parsed.href,
    status: response.status,
    title,
    text,
    links,
    forms,
  };
}
