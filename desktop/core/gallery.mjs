// Curated Cloud-Adapted Skills & Plugins Marketplace Catalog for NEXUS.
// Combines the highest-impact open-source agentic skills (adapted from obra/superpowers,
// anthropics/skills, vercel/web-design-guidelines, github/awesome-copilot) with
// Native Zero-Dependency NEXUS JS Plugins and 1-Click Official MCP Server Plugins.

export const CURATED_SKILLS = [
  {
    id: 'systematic-debugging',
    name: 'Systematic Debugging & Root Cause',
    category: 'Engineering',
    source: 'Adapted from obra/superpowers',
    tags: ['debugging', 'root-cause', 'reliability'],
    description: 'Evidence-first debugging protocol: reproduce before editing, trace exact root cause, write regression test, and verify clean pass.',
    instructions: `# Systematic Debugging Protocol
1. **Reproduce first**: Never guess a fix. Run the failing test, command, or scenario via \`run_command\` / \`shell_session\` / \`run_diagnostics\` to observe exact failure output.
2. **Isolate the boundary**: Use \`grep_search\`, \`code_outline\`, and \`batch_read_files\` to trace data flow from entry to failure point.
3. **Form a testable hypothesis**: State the exact root cause (file + line + broken invariant) before modifying code.
4. **Minimal surgical fix**: Apply the cleanest fix with \`multi_edit\` or \`apply_patch\`—avoid masking symptoms with broad try/catch blocks.
5. **Regression verification**: Add a focused test that fails before your fix and passes after, then re-run the relevant test suite.`,
  },
  {
    id: 'tdd-workflow',
    name: 'Test-Driven Development (Red-Green-Refactor)',
    category: 'Testing',
    source: 'Adapted from obra/superpowers & awesome-copilot',
    tags: ['tdd', 'testing', 'quality'],
    description: 'Strict Red → Green → Refactor engineering loop that prevents regressions and guarantees observable behavior.',
    instructions: `# TDD Red-Green-Refactor Workflow
1. **RED**: Write the smallest failing test describing the exact desired behavior or bug fix. Run it via \`run_command\` and confirm it fails for the right reason.
2. **GREEN**: Implement the minimal, clean code change needed to turn the failing test green.
3. **REFACTOR**: Clean up duplication, improve naming/types, and verify all affected tests remain green.
4. **Never delete or skip failing tests** to fake a pass.`,
  },
  {
    id: 'multi-session-orchestration',
    name: 'Multi-Session Orchestration & Fan-Out',
    category: 'Orchestration',
    source: 'NEXUS Native',
    tags: ['orchestration', 'nested-sessions', 'parallel'],
    description: 'Decompose large multi-module missions into parallel nested child sessions with inter-session messaging and worktree isolation.',
    instructions: `# Multi-Session Orchestration Guide
Use NEXUS's native nested session tools when a task has independent workstreams:
1. Plan the decomposition in \`todo_write\`.
2. For independent research or parallel modules, call \`spawn_session\` with a clear, self-contained objective and \`notifyParentOnIdle: true\`.
   - If multiple children will edit the same Git repo, create isolated worktrees with \`git_operation(worktree_add)\` and pass each worktree path as the child's \`workspace\`.
3. Coordinate or steer active children via \`send_session_message\`.
4. Gather results using \`read_session\` (with \`wait: true\` when awaiting completion) or \`list_sessions\`.
5. Synthesize child deliverables into one cohesive final report and run integration verification.`,
  },
  {
    id: 'frontend-design-craft',
    name: 'Frontend Craft & Design Systems',
    category: 'Design & UI',
    source: 'Adapted from anthropics/skills & impeccable',
    tags: ['frontend', 'ui', 'css', 'a11y'],
    description: 'Create intentional, non-generic product UIs with semantic design tokens, WCAG AA contrast, responsive layout, and purposeful motion.',
    instructions: `# Frontend Craft Guidelines
1. **Inspect incumbent visual tokens first** before editing CSS or JSX.
2. **Semantic tokens only**: Never hard-code light/dark hex colors inline; every surface, border, and state must work in Dark, Light, and Slate themes.
3. **Hierarchy & Restraint**: Prefer crisp typography, spacing, and subtle borders over decorative gradients, heavy glows, or card-inside-card nesting.
4. **Complete interactive states**: Design hover, focus-visible, active, disabled, loading, empty, and error states for every control.
5. **Purposeful motion**: 120–240ms cubic-bezier transitions for state changes; respect \`prefers-reduced-motion\`.
6. **Verify visually** across desktop and narrow viewports with zero horizontal overflow.`,
  },
  {
    id: 'architecture-planning',
    name: 'Architecture & Implementation Planning',
    category: 'Planning',
    source: 'Adapted from obra/superpowers',
    tags: ['architecture', 'planning', 'design'],
    description: 'Map repository structure quickly using dir_tree & code_outline and produce phased, concrete implementation plans with todo_write.',
    instructions: `# Architecture & Implementation Planning
1. Map the repository in 1 call with \`dir_tree\`, then inspect key entrypoints using \`code_outline\` and \`batch_read_files\`.
2. Identify existing patterns, invariants, data models, and test runners before proposing changes.
3. Write a concrete plan via \`todo_write\` listing exact target files, interfaces, edge cases, and verification commands.
4. Highlight trade-offs and risks concisely; execute phase-by-phase while updating checklist statuses.`,
  },
  {
    id: 'verification-before-completion',
    name: 'Verification Before Completion',
    category: 'Quality',
    source: 'Adapted from obra/superpowers',
    tags: ['verification', 'qa', 'evidence'],
    description: 'Strict empirical verification gate: never claim completion without running tests, diagnostics, and verifying real output.',
    instructions: `# Verification Before Completion
Before reporting a task complete:
1. Run \`run_diagnostics\` on modified files.
2. Run the project's real build and test commands via \`run_command\` and inspect full output.
3. Run \`git_operation(status)\` and \`git_operation(diff)\` to confirm no stray debug code, secrets, or unintended file edits remain.
4. Record key decisions, files changed, and verification output using \`document_progress\`.`,
  },
  {
    id: 'autonomous-self-evolution',
    name: 'Autonomous Self-Evolution & Tool Builder',
    category: 'Meta-Agent',
    source: 'NEXUS Native',
    tags: ['self-improve', 'plugins', 'mcp', 'tools'],
    description: 'Introspect NEXUS telemetry and autonomously author new live JS tools, MCP servers, REST connectors, or skills to extend NEXUS itself.',
    instructions: `# Autonomous Self-Evolution Protocol
When asked to extend NEXUS's own capabilities or resolve recurring workflow bottlenecks:
1. Run \`self_improve(action="analyze")\` and inspect installed skills/plugins/MCPs.
2. Choose the right extension layer:
   - **Repeatable workflow / rubric** → Save a Skill via \`save_capability(kind="skill")\`.
   - **Fast local JS capability** → Hot-register a live in-process tool via \`create_dynamic_tool\`.
   - **Standalone multi-tool stdio service** → Generate & hot-connect via \`scaffold_mcp_server\`.
   - **External HTTP API** → Register via \`create_connector\`.
   - **Recurring background mission** → Schedule via \`manage_automation\`.
3. Immediately test the newly created tool/MCP/connector empirically and confirm it works end-to-end.`,
  },
  {
    id: 'security-redteam-audit',
    name: 'Security & Red-Team Code Audit',
    category: 'Security',
    source: 'Adapted from awesome-copilot & OWASP',
    tags: ['security', 'redteam', 'audit', 'owasp'],
    description: 'Deep vulnerability hunting: auth bypass, injection, SSRF, path traversal, deserialization, race conditions, and concrete PoC + fixes.',
    instructions: `# Security & Red-Team Audit Methodology
1. Map attack surface: entrypoints, HTTP routes, IPC handlers, CLI parsers, auth middleware, file I/O, child_process spawns, and database queries.
2. Hunt systematically for: SQL/command/template injection, path traversal, SSRF, broken access control, prototype pollution, secret exposure, and race conditions.
3. For every finding provide: Severity (Critical/High/Medium/Low), exact \`file:line\`, concrete exploit path / PoC, and minimal hardened remediation.
4. Never fabricate theoretical issues—ground every finding in inspected source lines.`,
  },
  {
    id: 'deep-web-research',
    name: 'Deep Technical Research & Fact Verification',
    category: 'Research',
    source: 'NEXUS Native',
    tags: ['research', 'web', 'verification'],
    description: 'Multi-source web investigation using web_search, web_fetch, and browser_inspect with primary-source citations.',
    instructions: `# Deep Technical Research Protocol
1. Run targeted \`web_search\` queries (prefer official docs, GitHub repos, RFCs, changelogs).
2. Read primary sources directly via \`web_fetch\` or \`browser_inspect\`—never rely solely on search snippets.
3. Cross-check version numbers, release dates, and breaking changes across at least two sources when possible.
4. Present findings with clickable Markdown links and explicitly separate verified facts from inference.`,
  },
  {
    id: 'mcp-builder-pro',
    name: 'MCP Server Architect & Builder',
    category: 'Extensibility',
    source: 'Adapted from anthropics/skills',
    tags: ['mcp', 'tools', 'protocol'],
    description: 'Design, scaffold, and test clean Model Context Protocol servers with crisp JSON schemas, bounded outputs, and zero secret leaks.',
    instructions: `# MCP Server Builder Guide
1. Design focused, composable tools with clear \`inputSchema\` types, required fields, and concise descriptions.
2. Return structured JSON with bounded outputs (paginate large lists/blobs).
3. Use \`scaffold_mcp_server\` to generate, register, and hot-connect the local stdio server immediately.
4. Verify live via \`list_mcp_tools\` and \`invoke_mcp\` with realistic test inputs and error cases.`,
  },
  {
    id: 'code-review-rigor',
    name: 'High-Signal Code & PR Review',
    category: 'Engineering',
    source: 'Adapted from github/awesome-copilot',
    tags: ['review', 'git', 'quality'],
    description: 'Inspect git diff critically for logic bugs, regressions, edge cases, concurrency hazards, and missing tests without style nitpicks.',
    instructions: `# High-Signal Code Review
1. Run \`git_operation(status)\` and \`git_operation(diff)\` to read the complete net change.
2. Focus strictly on high-confidence issues: logic errors, null/undefined traps, resource leaks, race conditions, broken error handling, and missing edge-case tests.
3. Cite exact \`file:line\`, explain user/system impact, and propose a concrete fix.`,
  },
  {
    id: 'architecture-diagrams-docs',
    name: 'Technical Docs & Mermaid Diagrams',
    category: 'Documentation',
    source: 'Adapted from anthropics/skills',
    tags: ['docs', 'mermaid', 'diagrams'],
    description: 'Produce crisp developer documentation with live Mermaid architecture/sequence diagrams and KaTeX formulas.',
    instructions: `# Technical Documentation & Diagrams
1. Verify every command, file path, and API signature directly against the repository before writing.
2. Use fenced \`\`\`mermaid\`\`\` blocks (flowchart, sequenceDiagram, stateDiagram-v2) for architecture and lifecycle flows—NEXUS renders them natively as SVGs.
3. Keep prose direct, scannable, and organized by task rather than vague marketing copy.`,
  },
];

// Native Zero-Dependency NEXUS JS Plugins (instant in-process hot-load on Node 24!)
export const CURATED_NATIVE_PLUGINS = [
  {
    id: 'nexus-sqlite-explorer',
    kind: 'native',
    name: 'SQLite Database Explorer',
    category: 'Data & SQL',
    author: 'NEXUS Official',
    description: 'Inspect schemas, tables, and execute read/write SQL queries on any local .sqlite / .db file using Node 24 native node:sqlite.',
    tools: ['sqlite_inspect_schema', 'sqlite_query'],
    toolsCode: `export const tools = [
  {
    name: 'sqlite_inspect_schema',
    description: 'List all tables, columns, and row counts of a local SQLite database file.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: { dbPath: { type: 'string', description: 'Path to .sqlite or .db file' } },
      required: ['dbPath'],
      additionalProperties: false,
    },
    async handler(args, { path, require, workspace }) {
      const { DatabaseSync } = require('node:sqlite');
      const full = path.resolve(workspace, args.dbPath);
      const db = new DatabaseSync(full, { readOnly: true });
      try {
        const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
        return {
          database: full,
          tables: tables.map(t => ({
            name: t.name,
            sql: t.sql,
            rowCount: db.prepare('SELECT COUNT(*) AS c FROM "' + t.name.replace(/"/g, '""') + '"').get().c,
          })),
        };
      } finally { db.close(); }
    },
  },
  {
    name: 'sqlite_query',
    description: 'Execute a SQL query on a local SQLite database (defaults to read-only; set writable: true for mutations).',
    readOnly: false,
    parameters: {
      type: 'object',
      properties: {
        dbPath: { type: 'string', description: 'Path to .sqlite or .db file' },
        sql: { type: 'string', description: 'SQL query to execute' },
        writable: { type: 'boolean', description: 'Allow INSERT/UPDATE/DELETE/DDL (default false)' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      required: ['dbPath', 'sql'],
      additionalProperties: false,
    },
    async handler(args, { path, require, workspace }) {
      const { DatabaseSync } = require('node:sqlite');
      const full = path.resolve(workspace, args.dbPath);
      const db = new DatabaseSync(full, { readOnly: !args.writable });
      try {
        const stmt = db.prepare(args.sql);
        if (/^\\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(args.sql)) {
          const rows = stmt.all().slice(0, args.limit || 200);
          return { rowCount: rows.length, rows };
        }
        const info = stmt.run();
        return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
      } finally { db.close(); }
    },
  },
];`,
  },
  {
    id: 'nexus-net-diagnostics',
    kind: 'native',
    name: 'Network & Port Diagnostics',
    category: 'Networking',
    author: 'NEXUS Official',
    description: 'Fast TCP port scanner, DNS resolver (A/AAAA/MX/TXT/CNAME), and local listening port/process inspector.',
    tools: ['net_port_probe', 'net_dns_lookup'],
    toolsCode: `export const tools = [
  {
    name: 'net_port_probe',
    description: 'Probe one or more TCP ports on a host (localhost, LAN, or remote) to check reachability and latency.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Hostname or IP (default 127.0.0.1)' },
        ports: { type: 'array', items: { type: 'integer' }, description: 'List of TCP ports to probe (max 30)' },
        timeoutMs: { type: 'integer', minimum: 100, maximum: 5000 },
      },
      required: ['ports'],
      additionalProperties: false,
    },
    async handler(args, { net }) {
      const host = args.host || '127.0.0.1';
      const timeout = args.timeoutMs || 800;
      const probe = port => new Promise(resolve => {
        const started = Date.now();
        const sock = net.connect({ host, port });
        let done = false;
        const finish = open => { if (!done) { done = true; try { sock.destroy(); } catch {} resolve({ port, open, latencyMs: Date.now() - started }); } };
        sock.setTimeout(timeout);
        sock.once('connect', () => finish(true));
        sock.once('timeout', () => finish(false));
        sock.once('error', () => finish(false));
      });
      const results = await Promise.all(args.ports.slice(0, 30).map(probe));
      return { host, openPorts: results.filter(r => r.open).map(r => r.port), results };
    },
  },
  {
    name: 'net_dns_lookup',
    description: 'Resolve DNS records (A, AAAA, MX, TXT, NS, CNAME) for a domain.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        recordType: { type: 'string', enum: ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME'] },
      },
      required: ['domain'],
      additionalProperties: false,
    },
    async handler(args, { dns }) {
      const type = args.recordType || 'A';
      const records = await dns.resolve(args.domain, type);
      return { domain: args.domain, type, records };
    },
  },
];`,
  },
  {
    id: 'nexus-dev-swiss-army',
    kind: 'native',
    name: 'Dev Crypto, JWT & Encoding Pack',
    category: 'Developer Tools',
    author: 'NEXUS Official',
    description: 'Compute SHA-256/SHA-512/HMAC digests, decode JWT headers & payloads offline, and encode/decode Base64/Hex/URL.',
    tools: ['dev_hash', 'dev_jwt_decode'],
    toolsCode: `export const tools = [
  {
    name: 'dev_hash',
    description: 'Compute cryptographic hashes (sha256, sha512, md5) of text or a local file.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        algorithm: { type: 'string', enum: ['sha256', 'sha512', 'md5'] },
        text: { type: 'string' },
        filePath: { type: 'string' },
      },
      additionalProperties: false,
    },
    async handler(args, { crypto, fs, path, workspace }) {
      const algo = args.algorithm || 'sha256';
      const data = args.filePath ? await fs.readFile(path.resolve(workspace, args.filePath)) : Buffer.from(String(args.text || ''), 'utf8');
      return { algorithm: algo, hex: crypto.createHash(algo).update(data).digest('hex'), bytes: data.length };
    },
  },
  {
    name: 'dev_jwt_decode',
    description: 'Decode a JWT header, payload, and expiration status locally without verifying signature.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: { token: { type: 'string' } },
      required: ['token'],
      additionalProperties: false,
    },
    async handler(args) {
      const parts = String(args.token || '').trim().split('.');
      if (parts.length < 2) throw new Error('Invalid JWT format.');
      const decode = seg => JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      const header = decode(parts[0]);
      const payload = decode(parts[1]);
      return {
        header,
        payload,
        expired: typeof payload.exp === 'number' ? payload.exp * 1000 < Date.now() : null,
        expiresAt: typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null,
      };
    },
  },
];`,
  },
  {
    id: 'nexus-archive-pack',
    kind: 'native',
    name: 'Workspace Zip & Archive Toolkit',
    category: 'Utilities',
    author: 'NEXUS Official',
    description: 'Create and extract .zip archives directly inside Windows workspaces via native PowerShell Compress-Archive / Expand-Archive.',
    tools: ['zip_archive'],
    toolsCode: `export const tools = [
  {
    name: 'zip_archive',
    description: 'Create or extract a .zip archive in the workspace.',
    readOnly: false,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['compress', 'extract'] },
        source: { type: 'string', description: 'Source file/folder (compress) or .zip path (extract)' },
        destination: { type: 'string', description: 'Output .zip path (compress) or destination folder (extract)' },
      },
      required: ['action', 'source', 'destination'],
      additionalProperties: false,
    },
    async handler(args, { execFileAsync, path, workspace }) {
      const src = path.resolve(workspace, args.source);
      const dst = path.resolve(workspace, args.destination);
      const cmd = args.action === 'compress'
        ? \`Compress-Archive -Path '\${src.replace(/'/g, "''")}' -DestinationPath '\${dst.replace(/'/g, "''")}' -Force\`
        : \`Expand-Archive -Path '\${src.replace(/'/g, "''")}' -DestinationPath '\${dst.replace(/'/g, "''")}' -Force\`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { timeout: 60000, windowsHide: true });
      return { ok: true, action: args.action, source: src, destination: dst };
    },
  },
];`,
  },
];

// Official Cloud MCP Server Plugins (1-click install via npx / stdio!)
export const CURATED_MCP_PLUGINS = [
  {
    id: 'mcp-playwright',
    kind: 'mcp',
    name: 'Playwright Browser Automation',
    category: 'Browser & QA',
    author: 'Microsoft',
    requiresKey: false,
    description: 'Full Chromium/Edge browser automation, accessibility snapshots, click/type interactions, and E2E visual testing.',
    serverConfig: { name: 'Playwright MCP', transport: 'stdio', command: 'npx.cmd', args: ['-y', '@playwright/mcp@latest', '--isolated'], envSecrets: {} },
  },
  {
    id: 'mcp-context7',
    kind: 'mcp',
    name: 'Context7 Live Library Docs',
    category: 'Documentation',
    author: 'Upstash',
    requiresKey: false,
    description: 'Pulls up-to-date, version-specific documentation and real code examples for any npm/PyPI/framework library.',
    serverConfig: { name: 'Context7 Docs', transport: 'stdio', command: 'npx.cmd', args: ['-y', '@upstash/context7-mcp@latest'], envSecrets: {} },
  },
  {
    id: 'mcp-chrome-devtools',
    kind: 'mcp',
    name: 'Chrome DevTools MCP',
    category: 'Browser & QA',
    author: 'Google Chrome Team',
    requiresKey: false,
    description: 'Inspect live DOM, network requests, console errors, and performance traces directly in Chrome/Edge.',
    serverConfig: { name: 'Chrome DevTools', transport: 'stdio', command: 'npx.cmd', args: ['-y', 'chrome-devtools-mcp@latest'], envSecrets: {} },
  },
  {
    id: 'mcp-sequential-thinking',
    kind: 'mcp',
    name: 'Sequential Thinking Engine',
    category: 'Reasoning',
    author: 'Model Context Protocol',
    requiresKey: false,
    description: 'Dynamic, reflective thought-branching and revision graph for solving multi-constraint architectural problems.',
    serverConfig: { name: 'Sequential Thinking', transport: 'stdio', command: 'npx.cmd', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], envSecrets: {} },
  },
  {
    id: 'mcp-memory-graph',
    kind: 'mcp',
    name: 'Knowledge Graph Memory',
    category: 'Memory',
    author: 'Model Context Protocol',
    requiresKey: false,
    description: 'Persistent local entity-relation knowledge graph for tracking complex systems, people, and project facts.',
    serverConfig: { name: 'Memory Graph', transport: 'stdio', command: 'npx.cmd', args: ['-y', '@modelcontextprotocol/server-memory'], envSecrets: {} },
  },
  {
    id: 'mcp-fetch',
    kind: 'mcp',
    name: 'MCP Web Fetch',
    category: 'Web & Research',
    author: 'Model Context Protocol',
    requiresKey: false,
    description: 'Dedicated Markdown extraction and paginated web content fetching server.',
    serverConfig: { name: 'MCP Fetch', transport: 'stdio', command: 'npx.cmd', args: ['-y', '@modelcontextprotocol/server-fetch'], envSecrets: {} },
  },
  {
    id: 'mcp-filesystem',
    kind: 'mcp',
    name: 'Extended Filesystem MCP',
    category: 'Files',
    author: 'Model Context Protocol',
    requiresKey: false,
    description: 'Official MCP filesystem server for mounting additional root directories across machines.',
    serverConfig: { name: 'Filesystem MCP', transport: 'stdio', command: 'npx.cmd', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'], envSecrets: {} },
  },
  {
    id: 'mcp-github',
    kind: 'mcp',
    name: 'GitHub MCP Server',
    category: 'Git & DevOps',
    author: 'GitHub',
    requiresKey: true,
    secretHint: 'CONNECTOR_GITHUB_TOKEN',
    description: 'Manage GitHub issues, PRs, code search, Actions workflows, and releases directly via MCP.',
    serverConfig: { name: 'GitHub MCP', transport: 'stdio', command: 'npx.cmd', args: ['-y', '@modelcontextprotocol/server-github'], envSecrets: { GITHUB_PERSONAL_ACCESS_TOKEN: 'CONNECTOR_GITHUB_TOKEN' } },
  },
  {
    id: 'mcp-firecrawl',
    kind: 'mcp',
    name: 'Firecrawl Deep Scraper',
    category: 'Web & Research',
    author: 'Firecrawl',
    requiresKey: true,
    secretHint: 'CONNECTOR_FIRECRAWL_KEY',
    description: 'JS-rendered website crawling, full-site mapping, and structured extraction to Markdown/JSON.',
    serverConfig: { name: 'Firecrawl MCP', transport: 'stdio', command: 'npx.cmd', args: ['-y', 'firecrawl-mcp'], envSecrets: { FIRECRAWL_API_KEY: 'CONNECTOR_FIRECRAWL_KEY' } },
  },
];

export const CLOUD_SKILL_SOURCES = [
  { name: 'Superpowers · Systematic Debugging', repo: 'obra/superpowers', url: 'https://raw.githubusercontent.com/obra/superpowers/main/skills/systematic-debugging/SKILL.md' },
  { name: 'Superpowers · Writing Plans', repo: 'obra/superpowers', url: 'https://raw.githubusercontent.com/obra/superpowers/main/skills/writing-plans/SKILL.md' },
  { name: 'Superpowers · Verification Before Completion', repo: 'obra/superpowers', url: 'https://raw.githubusercontent.com/obra/superpowers/main/skills/verification-before-completion/SKILL.md' },
  { name: 'Superpowers · Subagent-Driven Dev', repo: 'obra/superpowers', url: 'https://raw.githubusercontent.com/obra/superpowers/main/skills/subagent-driven-development/SKILL.md' },
  { name: 'Anthropic · Frontend Design', repo: 'anthropics/skills', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md' },
  { name: 'Anthropic · MCP Builder', repo: 'anthropics/skills', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/mcp-builder/SKILL.md' },
];
