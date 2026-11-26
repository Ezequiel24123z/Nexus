import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// Parse open-standard SKILL.md (YAML frontmatter + Markdown instructions)
export function parseSkillMarkdown(raw = '', fallbackName = 'Imported Skill') {
  const text = String(raw || '').replace(/^\uFEFF/, '');
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const meta = {};
  let body = text.trim();

  if (fmMatch) {
    const lines = fmMatch[1].split(/\r?\n/);
    for (const line of lines) {
      const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      meta[m[1].toLowerCase()] = val;
    }
    body = fmMatch[2].trim();
  }

  let tags = [];
  if (meta.tags) {
    tags = meta.tags.replace(/^\[|\]$/g, '').split(',').map(t => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  const headingMatch = /^#\s+(.+)$/m.exec(body);
  const name = (meta.name || headingMatch?.[1] || fallbackName).trim().slice(0, 100);
  const description = (meta.description || body.split(/\r?\n/).find(l => l.trim() && !l.startsWith('#')) || name).trim().slice(0, 600);
  return { name, description, tags, instructions: body.slice(0, 60000), meta };
}

export function normalizeGithubRawUrl(input = '') {
  const trimmed = String(input || '').trim();
  if (!trimmed) throw new Error('Provide a SKILL.md URL or GitHub path.');
  let url = trimmed;
  // Convert github.com/owner/repo/blob/branch/path -> raw.githubusercontent.com/owner/repo/branch/path
  const blobMatch = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i.exec(url);
  if (blobMatch) {
    url = `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}`;
  }
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  return parsed.href;
}

// Discover SKILL.md files inside a project root (.nexus/skills, .github/skills, .claude/skills)
export function discoverWorkspaceSkills(workspace) {
  if (!workspace || typeof workspace !== 'string') return [];
  const roots = [
    path.join(workspace, '.nexus', 'skills'),
    path.join(workspace, '.github', 'skills'),
    path.join(workspace, '.claude', 'skills'),
  ];
  const found = [];
  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (found.length >= 40) break;
      const skillFile = entry.isDirectory()
        ? path.join(dir, entry.name, 'SKILL.md')
        : (entry.name.toLowerCase().endsWith('.md') ? path.join(dir, entry.name) : null);
      if (!skillFile || !fs.existsSync(skillFile)) continue;
      try {
        const raw = fs.readFileSync(skillFile, 'utf8');
        const parsed = parseSkillMarkdown(raw, entry.name.replace(/\.md$/i, ''));
        found.push({
          ...parsed,
          slug: entry.name.replace(/\.md$/i, ''),
          sourcePath: path.relative(workspace, skillFile),
          scope: 'project',
        });
      } catch {}
    }
  }
  return found;
}

// Dynamic Plugin Manager: installs, hot-loads, and executes custom JS tools & bundles without restart.
export class PluginManager {
  constructor(directory) {
    this.directory = path.join(directory, 'plugins');
    this.skillsDir = path.join(directory, 'skills');
    fs.mkdirSync(this.directory, { recursive: true });
    fs.mkdirSync(this.skillsDir, { recursive: true });
    this.plugins = new Map(); // id -> { manifest, tools: Map<name, { schema, handler }> }
    this.ready = this.loadAll();
  }

  async loadAll() {
    this.plugins.clear();
    let entries = [];
    try { entries = fs.readdirSync(this.directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(this.directory, entry.name, 'plugin.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        await this.loadPluginDir(path.join(this.directory, entry.name));
      } catch (err) {
        console.error('NEXUS plugin load failed:', entry.name, err.message);
      }
    }
  }

  async loadPluginDir(dir) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    if (!manifest?.id) throw new Error('Plugin manifest missing id.');
    const toolsMap = new Map();
    const toolsFile = path.join(dir, 'tools.mjs');
    if (manifest.enabled !== false && fs.existsSync(toolsFile)) {
      const mod = await import(pathToFileURL(toolsFile).href + '?v=' + Date.now());
      const defs = Array.isArray(mod.tools) ? mod.tools : (Array.isArray(mod.default) ? mod.default : []);
      for (const item of defs) {
        if (!item?.name || typeof item.handler !== 'function') continue;
        toolsMap.set(item.name, {
          name: item.name,
          description: String(item.description || item.name),
          readOnly: Boolean(item.readOnly),
          parameters: item.parameters || { type: 'object', properties: {}, additionalProperties: true },
          handler: item.handler,
        });
      }
    }
    this.plugins.set(manifest.id, { dir, manifest, tools: toolsMap });
    return manifest;
  }

  list() {
    return [...this.plugins.values()].map(({ manifest, tools }) => ({
      ...manifest,
      toolNames: [...tools.keys()],
    }));
  }

  getToolSchemas(disabledTools = new Set()) {
    const out = [];
    for (const { manifest, tools } of this.plugins.values()) {
      if (manifest.enabled === false) continue;
      for (const tool of tools.values()) {
        if (disabledTools.has(tool.name)) continue;
        out.push({
          type: 'function',
          function: {
            name: tool.name,
            description: `[Plugin: ${manifest.name}] ${tool.description}`,
            parameters: tool.parameters,
          },
        });
      }
    }
    return out;
  }

  findTool(name) {
    for (const { manifest, tools } of this.plugins.values()) {
      if (manifest.enabled === false) continue;
      if (tools.has(name)) return { plugin: manifest, tool: tools.get(name) };
    }
    return null;
  }

  async executeTool(name, args = {}, context = {}) {
    const found = this.findTool(name);
    if (!found) return null;
    const hybridFs = Object.assign({}, fsp, {
      existsSync: fs.existsSync,
      readFileSync: fs.readFileSync,
      writeFileSync: fs.writeFileSync,
      appendFileSync: fs.appendFileSync,
      mkdirSync: fs.mkdirSync,
      readdirSync: fs.readdirSync,
      statSync: fs.statSync,
      rmSync: fs.rmSync,
      unlinkSync: fs.unlinkSync,
      copyFileSync: fs.copyFileSync,
      promises: fsp,
    });
    const helpers = {
      fs: hybridFs,
      fsSync: fs,
      path,
      os,
      net,
      dns,
      crypto,
      execFileAsync,
      require,
      fetch,
      workspace: context.workspace || process.cwd(),
    };
    return found.tool.handler(args, helpers, context);
  }

  async installPlugin({ id, name, description = '', version = '1.0.0', category = 'custom', author = 'NEXUS', toolsCode = '', enabled = true }) {
    const slug = String(id || name || 'plugin').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    if (!slug) throw new Error('Invalid plugin id.');
    const dir = path.join(this.directory, slug);
    await fsp.mkdir(dir, { recursive: true });
    const manifest = {
      id: slug,
      name: String(name || slug).slice(0, 80),
      description: String(description || '').slice(0, 400),
      version: String(version || '1.0.0'),
      category: String(category || 'custom'),
      author: String(author || 'NEXUS'),
      enabled: Boolean(enabled),
      installedAt: new Date().toISOString(),
    };
    await fsp.writeFile(path.join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');
    if (toolsCode && String(toolsCode).trim()) {
      await fsp.writeFile(path.join(dir, 'tools.mjs'), String(toolsCode), 'utf8');
    }
    await this.loadPluginDir(dir);
    return this.list().find(p => p.id === slug);
  }

  async createSingleTool({ name, description, parameters, handlerCode, readOnly = false, pluginId = 'nexus-self-tools' }) {
    if (!/^[a-z][a-z0-9_]{1,48}$/.test(name || '')) {
      throw new Error('Tool name must be lowercase snake_case (2–49 chars, e.g. parse_csv_stats).');
    }
    const dir = path.join(this.directory, pluginId);
    await fsp.mkdir(dir, { recursive: true });
    const registryFile = path.join(dir, 'registry.json');
    let registry = [];
    if (fs.existsSync(registryFile)) {
      try { registry = JSON.parse(fs.readFileSync(registryFile, 'utf8')); } catch {}
    }
    registry = registry.filter(t => t.name !== name);
    registry.push({
      name,
      description: String(description || name).slice(0, 400),
      readOnly: Boolean(readOnly),
      parameters: parameters && typeof parameters === 'object' ? parameters : { type: 'object', properties: {}, additionalProperties: true },
      handlerCode: String(handlerCode || 'return { ok: true, args };'),
    });
    await fsp.writeFile(registryFile, JSON.stringify(registry, null, 2), 'utf8');

    const toolsCode = `// Auto-generated NEXUS Self-Evolved Tools\nexport const tools = [\n${registry.map(t => `  {\n    name: ${JSON.stringify(t.name)},\n    description: ${JSON.stringify(t.description)},\n    readOnly: ${Boolean(t.readOnly)},\n    parameters: ${JSON.stringify(t.parameters)},\n    async handler(args, helpers, context) {\n      const { fs, fsSync, path, os, net, dns, crypto, execFileAsync, require, fetch, workspace } = helpers;\n      ${t.handlerCode}\n    }\n  }`).join(',\n')}\n];\n`;

    return this.installPlugin({
      id: pluginId,
      name: 'Self-Evolved Dynamic Tools',
      description: 'Live JavaScript tools authored autonomously by NEXUS or the user.',
      category: 'self-evolved',
      toolsCode,
      enabled: true,
    });
  }

  async togglePlugin(id, enabled) {
    const entry = this.plugins.get(id);
    if (!entry) throw new Error('Plugin not found: ' + id);
    entry.manifest.enabled = Boolean(enabled);
    await fsp.writeFile(path.join(entry.dir, 'plugin.json'), JSON.stringify(entry.manifest, null, 2), 'utf8');
    await this.loadPluginDir(entry.dir);
    return this.list().find(p => p.id === id);
  }

  async uninstallPlugin(id) {
    const entry = this.plugins.get(id);
    if (!entry) return { removed: false, id };
    this.plugins.delete(id);
    await fsp.rm(entry.dir, { recursive: true, force: true });
    return { removed: true, id };
  }

  async importSkillFromUrl(urlInput, capabilities, { request = fetch } = {}) {
    const rawUrl = normalizeGithubRawUrl(urlInput);
    const res = await request(rawUrl, {
      headers: { 'User-Agent': 'NEXUS-Gallery/1.1' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Failed to fetch SKILL.md (HTTP ${res.status}).`);
    const markdown = await res.text();
    const fallback = path.basename(new URL(rawUrl).pathname).replace(/\.md$/i, '') || 'Cloud Skill';
    const parsed = parseSkillMarkdown(markdown, fallback);
    const slug = parsed.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 60) || 'skill';
    const targetDir = path.join(this.skillsDir, slug);
    await fsp.mkdir(targetDir, { recursive: true });
    await fsp.writeFile(path.join(targetDir, 'SKILL.md'), markdown, 'utf8');

    const existing = [...capabilities.index.values()].find(i => i.kind === 'skill' && i.name.toLowerCase() === parsed.name.toLowerCase());
    const saved = capabilities.save({
      ...(existing ? { id: existing.id, revision: existing.revision } : {}),
      kind: 'skill',
      name: parsed.name,
      description: parsed.description,
      tags: [...new Set(['cloud-skill', ...parsed.tags])].slice(0, 10),
      enabled: true,
      instructions: parsed.instructions,
    });
    return { imported: true, source: rawUrl, skill: saved };
  }
}

const KNOWN_SKILL_REPOS = [
  { repo: 'obra/superpowers', branch: 'main' },
  { repo: 'anthropics/skills', branch: 'main' },
  { repo: 'github/awesome-copilot', branch: 'main' },
];

export async function searchGithubSkills(query = '', { request = fetch } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const results = [];
  const seen = new Set();

  // 1. Scan top known open-standard SKILL.md repositories via GitHub Git Trees API (public, no auth needed)
  await Promise.allSettled(KNOWN_SKILL_REPOS.map(async ({ repo, branch }) => {
    const res = await request(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`, {
      headers: { 'User-Agent': 'NEXUS-Gallery/1.1', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return;
    const data = await res.json();
    for (const item of data.tree || []) {
      if (item.type !== 'blob' || !/(^|\/)SKILL\.md$/i.test(item.path)) continue;
      const folderName = item.path.split('/').slice(-2, -1)[0] || repo.split('/')[1];
      const hay = `${repo} ${item.path} ${folderName}`.toLowerCase();
      if (q && !q.split(/\s+/).every(tok => hay.includes(tok))) continue;
      const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${item.path}`;
      if (seen.has(rawUrl)) continue;
      seen.add(rawUrl);
      results.push({
        name: folderName.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        repo,
        path: item.path,
        url: `https://github.com/${repo}/blob/${branch}/${item.path}`,
        rawUrl,
        source: 'known-repo',
      });
    }
  }));

  // 2. If user typed a search query, also discover public GitHub skill repositories matching the query
  if (q) {
    try {
      const searchRes = await request(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(`${q} SKILL.md OR agent-skills`)}&sort=stars&per_page=6`,
        { headers: { 'User-Agent': 'NEXUS-Gallery/1.1', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) }
      );
      if (searchRes.ok) {
        const payload = await searchRes.json();
        await Promise.allSettled((payload.items || []).slice(0, 4).map(async repoObj => {
          const full = repoObj.full_name;
          const branch = repoObj.default_branch || 'main';
          const treeRes = await request(`https://api.github.com/repos/${full}/git/trees/${branch}?recursive=1`, {
            headers: { 'User-Agent': 'NEXUS-Gallery/1.1', Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(7000),
          });
          if (!treeRes.ok) return;
          const tree = await treeRes.json();
          for (const item of (tree.tree || []).filter(i => i.type === 'blob' && /(^|\/)SKILL\.md$/i.test(i.path)).slice(0, 6)) {
            const rawUrl = `https://raw.githubusercontent.com/${full}/${branch}/${item.path}`;
            if (seen.has(rawUrl)) continue;
            seen.add(rawUrl);
            const folderName = item.path.split('/').slice(-2, -1)[0] || repoObj.name;
            results.push({
              name: folderName.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
              repo: full,
              path: item.path,
              description: repoObj.description || '',
              stars: repoObj.stargazers_count || 0,
              url: `https://github.com/${full}/blob/${branch}/${item.path}`,
              rawUrl,
              source: 'github-search',
            });
          }
        }));
      }
    } catch { /* best-effort live cloud search */ }
  }

  return results.slice(0, 40);
}

