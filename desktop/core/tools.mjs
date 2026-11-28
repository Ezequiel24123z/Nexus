import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {readArtifact} from './artifacts.mjs';
import { createNexusFetcher } from './privacy-proxy.mjs';
import { executeWebSearch } from './search-engines.mjs';
import { runFastAgentBrowser, formatAgentSnapshotText } from './agent-browser.mjs';
import {catalogPage,functionTargets} from './capabilities.mjs';
import {
  MEMORY_CATEGORIES,
  MEMORY_PRIORITIES,
  upsertMemory,
  removeMemory,
  searchMemories,
  selectMemoriesForContext,
  formatMemoriesForPrompt,
  sortMemories,
  normalizeMemories,
} from './memory.mjs';
import {
  readFileWithRanges,
  multiEditFile,
  applyPatchToFile,
  globWorkspaceFiles,
  grepWorkspaceFiles,
  executeGitOperation,
  fetchWebResource,
  inspectSystemEnvironment,
  extractCodeOutline,
  scaffoldMcpServer,
  runSelfImprovement,
  executeHttpRequest,
  runCodeDiagnostics,
  inspectWebPage,
  wrapUtf8Ps,
  createUnifiedDiff,
  buildDirectoryTree,
  deleteFileWithBackup,
  moveFileWithBackup,
  searchWebDuckDuckGo,
  runElevatedCommand,
  buildChatMediaItem,
} from './coding-engine.mjs';

export const READ_ONLY_TOOL_NAMES = new Set([
  'load_toolset',
  'search_capabilities',
  'get_capability',
  'list_attachments',
  'read_attachment',
  'list_mcp_servers',
  'list_mcp_tools',
  'list_files',
  'dir_tree',
  'read_file',
  'batch_read_files',
  'search_files',
  'glob_files',
  'grep_search',
  'code_outline',
  'run_diagnostics',
  'browser_inspect',
  'list_effects',
  'search_journal',
  'search_history',
  'read_artifact',
  'read_checkpoint',
  'list_connectors',
  'get_connector',
  'todo_read',
  'web_search',
  'web_fetch',
  'system_info',
  'list_sessions',
  'read_session',
  'desktop_windows',
  'desktop_ui_tree',
  'present_media',
]);

export const CORE_TOOL_NAMES = new Set([
  'load_toolset',
  'list_files',
  'dir_tree',
  'read_file',
  'batch_read_files',
  'glob_files',
  'grep_search',
  'code_outline',
  'write_file',
  'replace_text',
  'multi_edit',
  'apply_patch',
  'run_command',
  'todo_write',
  'todo_read',
  'memory_store',
  'manage_session',
  'manage_project',
  'manage_privacy',
  'nexus_control',
  'present_media',
  'document_progress',
  'read_artifact',
  'read_checkpoint',
]);

export const TOOLSET_GROUPS = {
  git: ['git_operation', 'delete_file', 'move_file', 'run_diagnostics'],
  shell_processes: ['shell_session', 'manage_process', 'system_info'],
  web_browser: ['web_search', 'web_fetch', 'browser_inspect', 'http_request'],
  sessions: ['spawn_session', 'list_sessions', 'send_session_message', 'read_session', 'manage_session', 'manage_project', 'delegate_subagent'],
  capabilities_mcp: ['search_capabilities', 'get_capability', 'save_capability', 'invoke_function', 'list_mcp_servers', 'list_mcp_tools', 'invoke_mcp', 'scaffold_mcp_server'],
  connectors: ['list_connectors', 'get_connector', 'create_connector', 'invoke_connector', 'list_effects', 'reconcile_effect', 'verify_effect', 'retry_effect'],
  memory_history: ['memory_store', 'search_journal', 'search_history', 'list_attachments', 'read_attachment', 'search_files'],
  desktop: ['desktop_windows', 'desktop_ui_tree', 'desktop_screenshot', 'desktop_action'],
  automations_evolve: ['manage_automation', 'self_improve', 'create_dynamic_tool'],
  plugins: [],
};

export async function workspacePath(root, requested = '.', allowMissing = false) {
  const realRoot = await fs.realpath(root);
  const candidate = path.resolve(realRoot, requested);
  const within = value => value === realRoot || (!path.relative(realRoot, value).startsWith('..') && !path.isAbsolute(path.relative(realRoot, value)));
  if (!within(candidate)) throw new Error('Path is outside the project workspace folder.');
  let resolved;
  try { resolved = await fs.realpath(candidate); }
  catch (error) {
    if (!allowMissing || error.code !== 'ENOENT') throw error;
    let ancestor = path.dirname(candidate);
    while (true) {
      try { resolved = await fs.realpath(ancestor); break; }
      catch (e) { if (e.code !== 'ENOENT' || ancestor === path.dirname(ancestor)) throw e; ancestor = path.dirname(ancestor); }
    }
  }
  if (!within(resolved)) throw new Error('Symlink or junction points outside the project workspace folder.');
  return candidate;
}

export function command(executable, args, { cwd, signal, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', stopped = false;
    const stop = () => {
      stopped = true;
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    };
    const timer = timeout > 0 ? setTimeout(stop, timeout) : null;
    signal?.addEventListener('abort', stop, { once: true });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
    child.stdout.on('data', data => { output = (output + data).slice(-48000); });
    child.stderr.on('data', data => { output = (output + data).slice(-48000); });
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => { cleanup(); if (stopped) reject(new Error('Command stopped or timed out.')); else resolve({ exitCode: code, output }); });
  });
}

const def = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
const str = description => ({ type: 'string', description });
export const baseTools = [
  def('load_toolset', 'Dynamically activate optional tool groups on demand to save context tokens. Available groups: git (git/delete/move/diagnostics), shell_processes (stateful shell/background processes/system_info), web_browser (web_search/web_fetch/browser_inspect/http_request), sessions (spawn_session/inter-session messaging/subagents), capabilities_mcp (skills/functions/MCP), connectors (REST connectors/effects), memory_history (memories/attachments/history search), desktop (Windows screen/mouse/keyboard), automations_evolve (cron automations/self_improve/create_dynamic_tool), plugins (installed JS plugins), or "all".', { toolsets: { type: 'array', items: { type: 'string', enum: ['git', 'shell_processes', 'web_browser', 'sessions', 'capabilities_mcp', 'connectors', 'memory_history', 'desktop', 'automations_evolve', 'plugins', 'all'] } } }, ['toolsets']),
  def('search_capabilities','Search reusable local skills or functions by name, description, and tags. Query the catalog first before recreating a procedure. Returns paged metadata only.',{query:str('Search text'),kind:{type:'string',enum:['all','skill','function']},offset:{type:'integer',minimum:0}}),
  def('get_capability','Load on demand the full instructions of a skill or a function and its tool schema. Does not execute the function.',{id:str('Identifier found in search_capabilities')},['id']),
  def('save_capability','Create or update a reusable local skill or function. For updates pass id and revision from get_capability. Functions wrap an existing tool with default arguments. Never store raw secret values.',{id:str('ID only when updating'),revision:{type:'integer',minimum:1},kind:{type:'string',enum:['skill','function']},name:str('Descriptive name'),description:str('When to use it'),tags:{type:'array',items:{type:'string'}},enabled:{type:'boolean'},instructions:str('Skill instructions'),tool:{type:'string',enum:functionTargets},defaults:{type:'object',additionalProperties:true}},['kind','name','description']),
  def('invoke_function','Execute a discovered local function. Properties in input override its default arguments. Inherits approvals, journal logging, and permissions of the underlying tool.',{id:str('Function ID'),input:{type:'object',additionalProperties:true}},['id']),
  def('list_attachments','List files attached to this chat, including after context compaction.',{}),
  def('read_attachment','Read UTF-8 text in bounded byte chunks or return the local file path to process other formats. Offset and length are in bytes; use next to continue.',{id:str('Attachment ID'),offset:{type:'integer',minimum:0},length:{type:'integer',minimum:1,maximum:24000}},['id']),
  def('list_mcp_servers','Search configured MCP servers with paged metadata.',{query:str('Search text'),offset:{type:'integer',minimum:0}}),
  def('list_mcp_tools','Search MCP tools with paged metadata. Pass tool to load the full input schema of a single selected tool.',{server:str('Server name'),query:str('Search query'),offset:{type:'integer',minimum:0},tool:str('Exact tool name to retrieve full schema')},['server']),
  def('invoke_mcp','Execute an MCP tool using its discovered input schema.',{server:str('Server name'),tool:str('Tool name'),input:{type:'object',additionalProperties:true}},['server','tool']),
  def('list_files', 'List directory entries. In autonomous or unrestricted mode supports absolute paths outside the project.', { path: str('Relative or absolute directory path') }),
  def('dir_tree', 'Return a compact indented directory tree (skipping node_modules/.git) up to maxDepth levels for rapid repo orientation.', { path: str('Optional relative or absolute directory (default ".")'), maxDepth: { type: 'integer', minimum: 1, maximum: 8 }, maxEntries: { type: 'integer', minimum: 10, maximum: 800 } }),
  def('read_file', 'Read a UTF-8 file (up to 100 KB whole, or pass startLine and endLine to inspect line ranges of files up to 10 MB with line numbers).', { path: str('Relative or absolute path'), startLine: { type: 'integer', minimum: 1, description: 'Optional 1-based start line' }, endLine: { type: 'integer', minimum: 1, description: 'Optional 1-based inclusive end line' } }, ['path']),
  def('batch_read_files', 'Read up to 10 files (or line ranges) in one call to cut exploration round-trips.', { files: { type: 'array', items: { type: 'object', properties: { path: str('File path'), startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false } } }, ['files']),
  def('search_files', 'Search literal text across project files, skipping dependencies and binaries. Returns file paths and line numbers.', { query:str('Literal text'), path:str('Optional relative subfolder') }, ['query']),
  def('glob_files', 'Fast file discovery by glob pattern (e.g. "**/*.ts", "src/**/*.{jsx,css}", "*.json").', { pattern: str('Glob pattern to match'), path: str('Optional relative subdirectory') }, ['pattern']),
  def('grep_search', 'Ripgrep-style code search supporting regular expressions, case sensitivity, file glob filtering, and surrounding context lines.', { query: str('Search string or regular expression'), path: str('Optional relative subdirectory'), glob: str('Optional file glob filter, e.g. "*.mjs" or "src/**/*.jsx"'), isRegex: { type: 'boolean', description: 'Treat query as a regular expression' }, caseSensitive: { type: 'boolean', description: 'Case-sensitive matching' }, contextLines: { type: 'integer', minimum: 0, maximum: 5, description: 'Number of context lines before and after each match' } }, ['query']),
  def('code_outline', 'Extract a structural symbol map (exports, classes, functions, methods, signatures with line numbers) of a file or directory without reading entire file bodies.', { path: str('Relative file or directory path (default ".")') }),
  def('scaffold_mcp_server', 'Autonomously create, register, and hot-connect a new local stdio MCP server with custom tools written in JavaScript.', { name: str('Unique MCP server name'), description: str('What this MCP server provides'), tools: { type: 'array', items: { type: 'object', properties: { name: str('Tool identifier'), description: str('What the tool does'), inputSchema: { type: 'object', additionalProperties: true }, handlerCode: str('Async JS function body using (args, { fs, path, os, crypto, execFileAsync }) that returns a result') }, required: ['name', 'description', 'handlerCode'], additionalProperties: false } } }, ['name', 'tools']),
  def('self_improve', 'Analyze workspace telemetry, recurring tool errors, and capability coverage, or synthesize new reusable skills to evolve the agent.', { action: { type: 'string', enum: ['analyze', 'synthesize_skill'] }, name: str('Skill name when action is synthesize_skill'), description: str('Skill description'), instructions: str('Detailed reusable instructions when action is synthesize_skill'), tags: { type: 'array', items: { type: 'string' } } }, ['action']),
  def('write_file', 'Create or overwrite a file. Automatically preserves a backup copy and records the change in the journal.', { path: str('File path'), content: str('Complete file content'), reason: str('Why this change is being made') }, ['path', 'content', 'reason']),
  def('replace_text', 'Replace an exact, unique text block in a file. Fails if oldText does not match exactly once. Creates an automatic backup.', { path: str('File path'), oldText: str('Exact text to replace'), newText: str('Replacement text'), reason: str('Reason for change') }, ['path', 'oldText', 'newText', 'reason']),
  def('multi_edit', 'Apply multiple sequential exact text replacements to a single file atomically in one operation. Creates a backup before modifying.', { path: str('File path'), edits: { type: 'array', items: { type: 'object', properties: { oldText: str('Exact text to find'), newText: str('Replacement text') }, required: ['oldText', 'newText'], additionalProperties: false } }, reason: str('Reason for changes') }, ['path', 'edits', 'reason']),
  def('apply_patch', 'Apply a patch to a file using either <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE blocks or unified diff @@ hunks.', { path: str('File path'), patch: str('Patch content'), reason: str('Reason for patch') }, ['path', 'patch', 'reason']),
  def('delete_file', 'Delete a file while saving an automatic backup copy so the user can revert in 1 click.', { path: str('File path to delete'), reason: str('Reason for deletion') }, ['path', 'reason']),
  def('move_file', 'Rename or move a file with automatic backup and journal tracking.', { from: str('Source file path'), to: str('Destination file path'), reason: str('Reason for move') }, ['from', 'to', 'reason']),
  def('git_operation', 'Execute structured Git operations in the workspace (or custom cwd in autonomous/unrestricted mode): status, diff, log, branch, checkout, checkout_new (creates a new branch via git checkout -b), discard, stash, pull, push, stage, unstage, commit, worktree_list, worktree_add, or worktree_remove.', { operation: { type: 'string', enum: ['status', 'diff', 'log', 'branch', 'checkout', 'checkout_new', 'discard', 'stash', 'pull', 'push', 'stage', 'unstage', 'commit', 'worktree_list', 'worktree_add', 'worktree_remove'] }, cwd: str('Optional repository directory path (in autonomous/unrestricted mode)'), staged: { type: 'boolean', description: 'For diff: inspect staged changes' }, target: str('Optional file path for diff/stage/unstage/discard'), paths: { type: 'array', items: { type: 'string' }, description: 'File paths for stage/unstage' }, message: str('Commit or stash message'), stageAll: { type: 'boolean', description: 'Stage all changes before commit' }, create: { type: 'boolean', description: 'Create new branch on checkout (or use operation: checkout_new)' }, createBranch: { type: 'boolean', description: 'Alias for create on checkout' }, pop: { type: 'boolean', description: 'Pop latest stash' }, limit: { type: 'integer', minimum: 1, maximum: 50 }, path: str('Target directory for worktree_add or worktree_remove'), branch: str('Branch name for checkout, checkout_new, or worktree_add') }, ['operation']),
  def('run_command', 'Execute a PowerShell command with Windows permissions. Set elevated=true (or enable Admin Rights on the session) to run as Windows Administrator (VPN adapters, services, firewall, system tasks). Unsandboxed; no automatic timeout.', { command: str('PowerShell command'), reason: str('Purpose of command'), elevated: { type: 'boolean', description: 'Run with Windows Administrator privileges (uses process admin or triggers UAC RunAs)' } }, ['command', 'reason']),
  def('shell_session', 'Execute a command in a persistent stateful shell session for this task that preserves working directory (cd) and environment variables across calls. Pass elevated=true to execute an elevated Windows Administrator command.', { command: str('Command to run in the persistent session'), env: { type: 'object', additionalProperties: true, description: 'Optional environment variables to set or persist' }, elevated: { type: 'boolean', description: 'Run this command with Windows Administrator privileges' }, reason: str('Purpose of command') }, ['command']),
  def('run_diagnostics', 'Run fast syntax and type diagnostics (node --check, JSON validation) across a file or workspace directory.', { path: str('Optional relative file or directory path (default ".")') }),
  def('http_request', 'Send a direct, unrestricted HTTP or HTTPS request (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) to any local, LAN, or external endpoint with custom headers and body.', { url: str('HTTP or HTTPS URL'), method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] }, headers: { type: 'object', additionalProperties: true }, body: { type: ['string', 'object'], additionalProperties: true } }, ['url']),
  def('browser_inspect', 'Specialized dual-mode Agent & Standard Browser. Use engine="agent-fast" (zero-bloat Markdown + @e1..@eN interactive refs, works over Tor/.onion) or engine="agent-js" / renderJs=true (native Edge WebView2 with JS rendering, resource blocking, live @e1..@eN accessibility refs, and DOM actions targeting ref or selector).', { url: str('HTTP or HTTPS URL (supports .onion when Tor is active)'), engine: { type: 'string', enum: ['auto', 'agent-fast', 'agent-js', 'standard'], description: 'agent-fast = ultra-fast zero-bloat ref snapshot; agent-js = WebView2 JS + @eN refs + resource blocking; standard = full WebView2 render' }, renderJs: { type: 'boolean', description: 'Execute JavaScript in headless native Edge WebView2 (recommended for SPAs and dynamic pages)' }, waitMs: { type: 'integer', minimum: 0, maximum: 15000, description: 'Milliseconds to wait after page load for JS rendering (default 1200)' }, waitForSelector: str('Optional CSS selector to wait for before extracting content'), actions: { type: 'array', description: 'Optional sequential DOM actions to execute before extraction (target by ref like "@e3" or CSS selector)', items: { type: 'object', properties: { type: { type: 'string', enum: ['click', 'type', 'select', 'press_key', 'scroll', 'wait', 'eval'] }, ref: str('Compact element ref from snapshot (e.g. "@e4")'), selector: str('CSS selector for click/type/select/wait'), text: str('Text to type or key name for press_key (e.g. Enter, Tab, Escape)'), value: str('Option value for select'), y: { type: 'integer', description: 'Vertical pixels for scroll' }, ms: { type: 'integer', minimum: 50, maximum: 12000 }, script: str('JS function body for eval') }, required: ['type'], additionalProperties: false } }, useAccountSession: { type: 'boolean', description: 'Reuse NEXUS Account Mode browser profile cookies instead of ephemeral InPrivate' }, captureScreenshot: { type: 'boolean', description: 'Also capture and attach a PNG screenshot of the rendered page' }, extractLinks: { type: 'boolean' }, extractForms: { type: 'boolean' } }, ['url']),
  def('manage_process', 'Start, inspect, read output from, list, or stop long-running background processes (dev servers, watchers, builds).', { action: { type: 'string', enum: ['start', 'status', 'output', 'stop', 'list'] }, id: str('Process ID for status/output/stop'), command: str('Shell command when action is start'), label: str('Short label for the background process') }, ['action']),
  def('todo_write', 'Create or update the structured task checklist (plan) for this session to track multi-step engineering progress.', { todos: { type: 'array', items: { type: 'object', properties: { id: str('Short kebab-case ID'), title: str('Actionable task description'), status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked'] }, priority: { type: 'string', enum: ['low', 'medium', 'high'] } }, required: ['id', 'title', 'status'], additionalProperties: false } } }, ['todos']),
  def('todo_read', 'Read the current structured task checklist for this session.', {}),
  def('memory_store', 'Manage persistent structured user & project memories across sessions: user priorities, preferences, working style, hard constraints, workflows, personal profile, and project facts.', { action: { type: 'string', enum: ['list', 'search', 'remember', 'update', 'forget', 'profile'] }, id: str('Memory ID for update/forget'), key: str('Short descriptive topic/key'), value: str('Detailed preference, priority, constraint, workflow, or fact to remember'), category: { type: 'string', enum: MEMORY_CATEGORIES, description: 'priority | preference | constraint | workflow | profile | fact' }, priority: { type: 'string', enum: MEMORY_PRIORITIES, description: 'critical | high | normal | low' }, scope: { type: 'string', enum: ['project', 'global'], description: 'Scope (global for user-wide preferences/priorities, project for workspace-specific rules)' }, tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for fast recall' }, pinned: { type: 'boolean', description: 'Pin to always inject verbatim into context' }, query: str('Search query for action="search"') }, ['action']),
  def('web_search', 'Search the live web or Tor .onion hidden services using privacy-ranked engines: auto (privacy-first cascade), searxng (self-hosted zero-log), duckduckgo, mojeek, brave (ZDR API), kagi, langsearch, tavily, exa, ahmia (.onion), torch (.onion via Tor), onion (ahmia+torch via Tor), or bing-rss.', { query: str('Search query'), provider: { type: 'string', enum: ['auto', 'searxng', 'duckduckgo', 'mojeek', 'brave', 'kagi', 'langsearch', 'tavily', 'exa', 'ahmia', 'torch', 'onion', 'bing-rss'], description: 'Optional provider override (defaults to Settings searchProvider)' }, maxResults: { type: 'integer', minimum: 1, maximum: 15 } }, ['query']),
  def('web_fetch', 'Fetch an HTTP/HTTPS URL and extract clean readable text/markdown or JSON content with pagination.', { url: str('HTTP or HTTPS URL'), extractText: { type: 'boolean', description: 'Convert HTML to clean readable text (default true)' }, offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 100, maximum: 24000 } }, ['url']),
  def('manage_automation', 'Create, list, toggle, trigger, or delete local scheduled/cron automations that run autonomously in NEXUS.', { action: { type: 'string', enum: ['list', 'create', 'toggle', 'run', 'delete'] }, id: str('Automation ID (required for toggle, run, delete)'), name: str('Automation name (required for create)'), prompt: str('Task prompt to execute (required for create)'), workspace: str('Optional workspace directory for the automation'), scheduleType: { type: 'string', enum: ['interval', 'daily', 'weekly', 'cron', 'once'] }, everyMinutes: { type: 'integer', minimum: 1 }, hour: { type: 'integer', minimum: 0, maximum: 23 }, minute: { type: 'integer', minimum: 0, maximum: 59 }, weekday: { type: 'integer', minimum: 0, maximum: 6 }, cronExpression: str('5-field cron expression'), runAt: str('ISO timestamp for once'), enabled: { type: 'boolean' }, model: str('Optional model ID'), agentMode: { type: 'string', enum: ['interactive', 'semi-autopilot', 'autopilot', 'unrestricted', 'agent', 'architect', 'explore'] } }, ['action']),
  def('delegate_subagent', 'Spawn an isolated sub-agent with its own clean context window to research a question, review code, or execute a bounded sub-task, returning a concise report.', { objective: str('Clear, self-contained task or research question for the sub-agent'), mode: { type: 'string', enum: ['explore', 'architect', 'agent'], description: 'Operating mode for the sub-agent (default explore)' }, maxSteps: { type: 'integer', minimum: 1, maximum: 12, description: 'Maximum tool steps for the sub-agent (default 6)' } }, ['objective']),
  def('spawn_session', 'Spawn a nested child session under the current session. Runs independently (and in parallel across separate folders/worktrees) and can exchange messages with parent/peer sessions. Set ephemeral=true for RAM-Only zero-disk-trace sessions (sensitive/high-risk tasks) or ephemeral=false for regular persistent sessions.', { title: str('Short title for the child session'), prompt: str('Complete self-contained kickoff objective for the child session'), workspace: str('Optional workspace or git worktree path (defaults to current session workspace)'), model: str('Optional model ID override'), agentMode: { type: 'string', enum: ['interactive', 'semi-autopilot', 'autopilot', 'unrestricted'] }, ephemeral: { type: 'boolean', description: 'RAM-Only zero-disk-trace session (defaults to inheriting parent ephemeral mode)' }, adminMode: { type: 'boolean', description: 'Grant per-session Windows Administrator rights (default false)' }, notifyParentOnIdle: { type: 'boolean', description: 'Automatically notify this parent session when the child completes (default true)' } }, ['prompt']),
  def('list_sessions', 'List the parent session, nested child sessions, and peer workspace sessions with their IDs, titles, statuses, storage mode (RAM-Only vs Regular), and latest output previews.', { scope: { type: 'string', enum: ['tree', 'all'], description: 'tree = parent/children/siblings (default), all = all sessions' } }),
  def('send_session_message', 'Send a message directly to another NEXUS session (child, parent, or peer) to delegate follow-ups, steer active work, or report results. Wakes the target session automatically.', { sessionId: str('Target session ID from spawn_session or list_sessions'), message: str('Message content to deliver to the target session') }, ['sessionId', 'message']),
  def('read_session', 'Read status, recent messages, todos, and result of a nested child or peer session. Set wait: true to wait for the session to finish.', { sessionId: str('Target session ID'), wait: { type: 'boolean', description: 'Wait until the target session finishes or errors (default false)' }, timeoutSeconds: { type: 'integer', minimum: 1, maximum: 300, description: 'Max seconds to wait when wait is true (default 60)' } }, ['sessionId']),
  def('manage_project', 'List, create, update, or delete rooted NEXUS Projects so sessions can be organized by root folder and shared project instructions.', { action: { type: 'string', enum: ['list', 'create', 'update', 'delete'] }, id: str('Project ID for update/delete'), projectId: str('Alias for id'), name: str('Project name'), newName: str('New name when updating'), workspace: str('Root workspace folder path for the project'), instructions: str('Project-specific system instructions'), assignCurrentSession: { type: 'boolean', description: 'When creating, immediately assign the current session to this new project' } }, ['action']),
  def('manage_session', 'Inspect, organize, or migrate the current session (or another sessionId): PROACTIVELY call action="rename" on turn 1 to replace raw prompt titles with a crisp 3-6 word title and again whenever the conversation topic or main objective shifts; also assign/unassign a Project, link a root workspace folder, pin/unpin, or live-migrate storage between RAM-Only (ephemeral=true, immediately purges disk traces) and Regular persistent storage (ephemeral=false).', { action: { type: 'string', enum: ['info', 'rename', 'assign_project', 'set_workspace', 'pin', 'set_ephemeral'] }, sessionId: str('Optional target session ID (defaults to current session)'), title: str('New concise session title for action="rename"'), projectId: str('Target project ID for action="assign_project" (empty string to unassign)'), projectName: str('Target project name for action="assign_project"'), unassign: { type: 'boolean', description: 'Detach session from its current project' }, adoptWorkspace: { type: 'boolean', description: 'Also adopt the project root folder as session workspace (default true)' }, workspace: str('Workspace folder path for action="set_workspace"'), pinned: { type: 'boolean', description: 'Pin state for action="pin"' }, ephemeral: { type: 'boolean', description: 'For action="set_ephemeral": true migrates to RAM-Only and purges disk traces; false migrates to Regular persistent storage' }, reason: str('Optional reason explaining why the session storage mode was migrated') }, ['action']),
  def('present_media', 'Display local documents (Markdown, PDF, JSON, CSV, code, text), images (PNG/JPG/WebP/GIF/SVG), videos (MP4/WebM/MOV/MKV with streaming player), or audio directly inline inside the chat for the user to inspect, play, or open.', { path: str('Local file path (relative to workspace or absolute) to display inline'), title: str('Optional display title'), caption: str('Optional caption shown beneath the media card'), kind: { type: 'string', enum: ['auto', 'image', 'video', 'audio', 'pdf', 'document'], description: 'Media type (default auto-detected from file extension)' }, items: { type: 'array', description: 'Optional list of multiple files to present together as a media gallery', items: { type: 'object', properties: { path: str('File path'), title: str('Title'), caption: str('Caption'), kind: { type: 'string', enum: ['auto', 'image', 'video', 'audio', 'pdf', 'document'] } }, required: ['path'], additionalProperties: false } } }),
  def('manage_privacy', 'Full control over NEXUS privacy, live network/IP verification, 1-step privacy presets, OPSEC scorecard, WireGuard VPN (.conf import/select/remove/install/connect/disconnect), Tor (install/start/stop/new identity), Double-Hop WireGuard->Tor, 1-Click Stealth Mode (preserves prompt caching), Reversible PII Scrubber, private/.onion search engines, and InPrivate/tracker browser settings whenever the user asks.', { action: { type: 'string', enum: ['status', 'explain', 'verify', 'apply_preset', 'set_routing', 'stealth', 'set_search', 'set_pii', 'set_browser', 'set_wireguard_binary', 'wireguard_import', 'wireguard_select', 'wireguard_remove', 'wireguard_install', 'wireguard_connect', 'wireguard_disconnect', 'tor_install', 'tor_start', 'tor_stop', 'tor_new_identity', 'wipe_browser'] }, preset: { type: 'string', enum: ['maximum', 'wireguard-tor', 'wireguard', 'tor', 'balanced', 'off', 'direct'], description: '1-step privacy preset for action="apply_preset"' }, startDaemons: { type: 'boolean', description: 'For apply_preset: automatically start Tor/WireGuard daemons (default true)' }, stopDaemons: { type: 'boolean', description: 'For apply_preset("off"): stop running Tor/WireGuard daemons (default true)' }, sessionEphemeral: { type: 'boolean', description: 'For apply_preset: also migrate current session to RAM-Only zero-disk-trace storage' }, pii: { type: 'boolean', description: 'For apply_preset: enable/disable PII Scrubber' }, disablePii: { type: 'boolean', description: 'For apply_preset("off"): also disable PII Scrubber' }, mode: { type: 'string', enum: ['direct', 'wireguard', 'wireguard-tor', 'managed-tor', 'tor', 'socks5', 'http'], description: 'Routing mode for action="set_routing"' }, proxyUrl: str('Custom SOCKS5/HTTP proxy URL'), routeAllTraffic: { type: 'boolean', description: 'Encrypt ALL NEXUS outbound traffic (LLMs, search, browser, updates)' }, routeAgentTraffic: { type: 'boolean', description: 'Route AI web tools through proxy' }, killSwitch: { type: 'boolean', description: 'Fail-closed kill-switch blocking direct clearnet leaks' }, enabled: { type: 'boolean', description: 'Enable/disable flag for stealth or set_pii' }, provider: { type: 'string', enum: ['auto', 'searxng', 'duckduckgo', 'mojeek', 'brave', 'kagi', 'langsearch', 'tavily', 'exa', 'ahmia', 'torch', 'onion', 'bing-rss'] }, strictZeroTrack: { type: 'boolean' }, searxUrl: str('Custom SearXNG instance URL'), torchOnionUrl: str('Custom Torch .onion URL'), rules: { type: 'array', items: { type: 'string' }, description: 'Replace full custom PII redaction rule list' }, addRules: { type: 'array', items: { type: 'string' }, description: 'Append custom PII redaction rules (e.g. "secret@corp.com" or "Codename => [PROJ]")' }, removeRules: { type: 'array', items: { type: 'string' } }, persistentProfile: { type: 'boolean', description: 'false = InPrivate zero-trace, true = Account Mode' }, blockTrackers: { type: 'boolean' }, antiFingerprint: { type: 'boolean' }, engineMode: { type: 'string', enum: ['dual', 'agent-fast', 'agent-js', 'standard'] }, filePath: str('Local path to a WireGuard .conf file for wireguard_import or binaryPath'), binaryPath: str('Custom wireproxy.exe path for set_wireguard_binary'), configText: str('Raw WireGuard .conf text for wireguard_import'), name: str('Friendly label for imported/selected WireGuard profile'), profileId: str('WireGuard profile ID for wireguard_select/remove/connect'), activate: { type: 'boolean', description: 'Set imported WireGuard profile as active (default true)' }, force: { type: 'boolean', description: 'Force reinstall for wireguard_install/tor_install' }, chainTor: { type: 'boolean', description: 'When true on wireguard_connect, activates Double-Hop WireGuard -> Tor' }, autoInstall: { type: 'boolean', description: 'Auto-install wireproxy/Tor binaries if missing (default true)' } }, ['action']),
  def('nexus_control', 'Inspect NEXUS capabilities, live configuration, providers, models, sessions, projects, tools, MCP, plugins, automations, and privacy WITHOUT reading NEXUS source code — and live-configure settings, autonomy/session modes, providers, enabled models, tools, and custom slash commands safely.', { action: { type: 'string', enum: ['guide', 'inspect', 'update_settings', 'update_session', 'manage_provider', 'manage_tools'] }, topic: { type: 'string', enum: ['all', 'overview', 'providers', 'models', 'autonomy', 'privacy', 'sessions', 'projects', 'memory', 'browser', 'search', 'tools', 'automations', 'media', 'appearance', 'updates'], description: 'Feature guide topic for action="guide"' }, section: { type: 'string', enum: ['summary', 'all', 'host', 'settings', 'providers', 'models', 'privacy', 'session', 'sessions', 'projects', 'tools', 'mcp', 'plugins', 'automations', 'memories', 'storage'], description: 'Live state section for action="inspect"' }, settings: { type: 'object', additionalProperties: true, description: 'Settings patch object for action="update_settings" (e.g. agentMode, model, reasoningEffort, contextWindow, enabledModels, lazyToolLoading, silentToolSteps, promptCaching, cacheAffinity, accentColor, customCss, customSystemPrompt, etc.)' }, confirmReplaceGlobalInstructions: { type: 'boolean', description: 'Must be true only if user explicitly asked to replace globalInstructions' }, sessionId: str('Target session ID for update_session (defaults to current session)'), session: { type: 'object', additionalProperties: true, description: 'Session state patch for update_session (title, agentMode, model, reasoningEffort, contextWindow, providerRouting, workspace, projectId, pinned, ephemeral, adminMode)' }, providerAction: { type: 'string', enum: ['list', 'add_custom', 'update_custom', 'remove_custom', 'set_enabled_models', 'enable_model', 'disable_model', 'clear_enabled_models', 'list_models', 'check_connection'], description: 'Sub-action for action="manage_provider"' }, providerId: str('Provider ID (e.g. yeta, openrouter, openai, custom, or custom id)'), provider: str('Alias for providerId'), providerConfig: { type: 'object', additionalProperties: true, description: 'Custom provider fields for add_custom/update_custom (id, name, baseUrl, apiFormat, defaultModel, optionalKey, headers)' }, models: { type: 'array', items: { type: 'string' }, description: 'Enabled model IDs array for set_enabled_models' }, modelId: str('Single model ID for enable_model/disable_model'), toolAction: { type: 'string', enum: ['list', 'enable', 'disable', 'enable_all', 'add_command', 'remove_command'], description: 'Sub-action for action="manage_tools"' }, toolName: str('Tool name for manage_tools enable/disable'), tools: { type: 'array', items: { type: 'string' }, description: 'Tool names for manage_tools enable/disable' }, command: str('Slash command name for add_command/remove_command'), description: str('Slash command description for add_command'), template: str('Slash command prompt template for add_command'), mode: str('Optional autonomy mode for add_command') }, ['action']),
  def('create_dynamic_tool', 'Self-evolution tool: author and hot-register a brand-new JavaScript tool directly inside NEXUS so you and future sessions can call it immediately without restarting.', { name: str('Lowercase snake_case tool name (e.g. parse_log_errors)'), description: str('What this tool does'), readOnly: { type: 'boolean', description: 'True if tool does not mutate files or external systems' }, parameters: { type: 'object', description: 'JSON Schema object for tool parameters', additionalProperties: true }, handlerCode: str('Async JS function body using (args, { fs, fsSync, path, os, net, dns, crypto, execFileAsync, require, fetch, workspace }) where fs supports both async promises (await fs.readFile) and common sync helpers (fs.existsSync, fs.statSync, fs.readFileSync); returns a JSON-serializable result') }, ['name', 'description', 'handlerCode']),
  def('system_info', 'Inspect the host operating system, hardware resources, working directory, and installed developer runtimes (node, git, python, gh).', {}),
  def('document_progress', 'Record architectural decisions, modified files, test verification results, and next steps. Call after major milestones and before finishing.', { decisions: str('Decisions and rationale'), changes: str('Modified files and summary'), verification: str('Tests executed and results'), next: str('Remaining work and risks') }, ['decisions', 'changes', 'verification', 'next']),
  def('list_effects', 'List recent external side effects and their recoverable state: observed, uncertain, or pending reconciliation.', {}),
  def('reconcile_effect', 'Document the verified real-world status of an uncertain effect with concrete evidence. Never repeat an uncertain action without checking first.', {id:str('Effect ID'),status:{type:'string',enum:['confirmed','uncertain','not_found']},evidence:str('Concrete proof: output, resource state, query, or file observed')}, ['id','status','evidence']),
  def('search_journal', 'Search original details in the persistent task journal, including after context compaction.', { query: str('Search text') }, ['query']),
  def('search_history', 'Search literally across the original transcript history, including pre-compaction messages. Use offset to paginate.', {query:str('Literal text'),offset:{type:'integer',minimum:0}}, ['query']),
  def('read_artifact', 'Read a bounded slice of a large tool output saved as a local artifact.', {id:str('Artifact ID'),offset:{type:'integer',minimum:0},length:{type:'integer',minimum:1,maximum:24000}}, ['id']),
  def('read_checkpoint', 'Without arguments, lists summaries saved by each compaction; with checkpoints:[N], reads a bounded slice of its summary or original messages.', { checkpoints:{type:'array',items:{type:'integer',minimum:1},description:'Checkpoint numbers to read; omit to list available checkpoints.'}, section:{type:'string',enum:['summary','messages'],description:'Section to read (default summary).'}, offset:{type:'integer',minimum:0}, length:{type:'integer',minimum:1,maximum:20000} }),
  def('list_connectors', 'Search configured REST connectors by name and description; then call get_connector to inspect an operation contract.', {query:str('Search query'),offset:{type:'integer',minimum:0}}),
  def('get_connector', 'Read the contract of a REST connector without executing it. For OpenAPI connectors use input.path, input.query, and input.body.', {name:str('Connector name')}, ['name']),
  def('create_connector', 'Create a reusable REST connector definition. Reference a secret name (CONNECTOR_*) rather than embedding credentials.', { name: str('Unique name'), url: str('HTTPS URL'), method: { type: 'string', enum: ['GET','POST','PUT','PATCH','DELETE'] }, description: str('What this connector does'), secretRef: str('Optional secret reference name, never the raw value'), idempotencyHeader:{type:'boolean',description:'Only if the API accepts Idempotency-Key for safe retries'}, reconciliationUrl:str('Optional HTTPS GET URL; may use {operationId} to verify an effect') }, ['name','url','method','description']),
  def('invoke_connector', 'Call a configured REST connector. The call is recorded in the effect ledger and journal.', { name: str('Connector name'), input: { type: 'object', additionalProperties: true } }, ['name']),
  def('verify_effect', 'Verify an uncertain connector effect using its configured reconciliation URL.', {id:str('Effect ID')}, ['id']),
  def('retry_effect', 'Retry an uncertain connector effect only if the connector declares Idempotency-Key support, preserving the original operation key.', {id:str('Effect ID')}, ['id']),
  def('desktop_windows', 'List connected monitors and visible Windows desktop windows (hwnd, title, processName, bounds, active) before inspecting or capturing a specific window privately.', {}),
  def('desktop_ui_tree', 'Inspect the Windows UI Automation accessibility tree of a specific window (or foreground window) to discover real buttons, inputs, tabs, text values, and exact clickable center (x, y) coordinates without capturing a screenshot.', { windowTitle: str('Optional window title or process name substring'), hwnd: { type: 'integer', description: 'Optional native window handle (hwnd) from desktop_windows' }, query: str('Optional filter matching element name, automationId, type, or value'), interactiveOnly: { type: 'boolean', description: 'Return interactive/labeled controls only (default true)' }, maxDepth: { type: 'integer', minimum: 1, maximum: 24 }, maxElements: { type: 'integer', minimum: 10, maximum: 300 } }),
  def('desktop_screenshot', 'Capture a specific window (recommended for privacy so unrelated apps are excluded), a specific monitor, a region, or the primary screen. Returns origin and scaleFactor for accurate click coordinates.', { windowTitle: str('Capture ONLY the window matching this title or process name (privacy-safe)'), hwnd: { type: 'integer', description: 'Capture ONLY this native window handle from desktop_windows' }, monitor: { type: ['integer', 'string'], description: 'Monitor index (0, 1, ...) or "all" for full virtual desktop' }, region: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer', minimum: 16 }, height: { type: 'integer', minimum: 16 } }, required: ['x', 'y', 'width', 'height'], additionalProperties: false } }),
  def('desktop_action', 'Control Windows mouse, keyboard, and window focus. Prefer desktop_ui_tree or window-scoped desktop_screenshot first to get accurate coordinates.', { action: { type:'string', enum:['focus_window','click','double_click','right_click','move','drag','type','key','scroll'] }, windowTitle: str('Target window title/process for focus_window'), hwnd: { type: 'integer', description: 'Target window handle for focus_window' }, x:{type:'integer'}, y:{type:'integer'}, toX:{type:'integer', description:'Destination X for drag'}, toY:{type:'integer', description:'Destination Y for drag'}, text:str('Literal text or key chord: ENTER, TAB, ESC, CTRL+A, CTRL+C, CTRL+V, ALT+TAB'), amount:{type:'integer'} }, ['action']),
];

const checkpointName = /^checkpoint-(\d+)\.json$/;
async function readCheckpoint(store, task, args = {}) {
  const requested = args.checkpoints === undefined ? null : args.checkpoints;
  if (requested !== null && (!Array.isArray(requested) || !requested.length || requested.some(n => !Number.isInteger(n) || n < 1))) throw new Error('Invalid checkpoint list: use positive integers.');
  const numbers = requested === null ? null : [...new Set(requested)].sort((a, b) => a - b);
  const section = args.section === undefined ? 'summary' : args.section;
  if (!['summary','messages'].includes(section)) throw new Error('Invalid section: use summary or messages.');
  const offset = args.offset === undefined ? 0 : args.offset;
  const length = args.length === undefined ? 8000 : Math.min(args.length, 20000);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 1) throw new Error('Invalid range: offset >= 0 and length between 1 and 20000.');
  if (task?.ephemeral) {
    const ramList = Array.isArray(task.ramCheckpoints) ? task.ramCheckpoints : [];
    const available = ramList.map((_, i) => i + 1);
    if (numbers === null) {
      return {
        available,
        checkpoints: ramList.map((data, i) => ({
          checkpoint: i + 1,
          at: data.at,
          summaryChars: String(data.summary || '').length,
          messageCount: (data.messages || []).length,
          messagesBytes: Buffer.byteLength(JSON.stringify(data.messages || []), 'utf8'),
        })),
        hint: 'Use checkpoints:[N] with section, offset, and length to read exact pre-compaction details.',
      };
    }
    const results = numbers.map(n => {
      const data = ramList[n - 1];
      if (!data) throw new Error('Checkpoint ' + n + ' not found in this RAM-only session.');
      const summary = typeof data.summary === 'string' ? data.summary : '';
      const serialized = JSON.stringify(data.messages || []);
      const content = section === 'summary' ? summary : serialized;
      return { checkpoint: n, file: `ram-checkpoint-${n}`, at: data.at, section, offset, length: Math.max(0, Math.min(length, content.length - offset)), totalChars: content.length, messageCount: (data.messages || []).length, summaryChars: summary.length, content: content.slice(offset, offset + length), next: offset + length < content.length ? offset + length : null };
    });
    return results.length === 1 ? results[0] : { checkpoints: results };
  }
  const directory = store.directoryFor(task.id);
  const available = (await fs.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; }))
    .filter(name => checkpointName.test(name))
    .map(name => Number(checkpointName.exec(name)[1]))
    .sort((a, b) => a - b);
  if (numbers === null) {
    const checkpoints = [];
    for (const n of available) {
      const data = JSON.parse(await fs.readFile(path.join(directory, 'checkpoint-' + n + '.json'), 'utf8'));
      const summary = typeof data.summary === 'string' ? data.summary : '';
      const serialized = JSON.stringify(data.messages || []);
      checkpoints.push({ checkpoint:n, at:data.at, summaryChars:summary.length, messageCount:(data.messages || []).length, messagesBytes:Buffer.byteLength(serialized,'utf8') });
    }
    return { available, checkpoints, hint:'Use checkpoints:[N] with section, offset, and length to read exact pre-compaction details.' };
  }
  const results = [];
  for (const n of numbers) {
    const file = 'checkpoint-' + n + '.json';
    const raw = await fs.readFile(path.join(directory, file), 'utf8').catch(() => null);
    if (raw === null) throw new Error('Checkpoint ' + n + ' not found in this task. Available: ' + (available.join(', ') || 'none') + '.');
    const data = JSON.parse(raw);
    const summary = typeof data.summary === 'string' ? data.summary : '';
    const serialized = JSON.stringify(data.messages || []);
    const content = section === 'summary' ? summary : serialized;
    results.push({ checkpoint:n, file, at:data.at, section, offset, length:Math.max(0, Math.min(length, content.length - offset)), totalChars:content.length, messageCount:(data.messages || []).length, summaryChars:summary.length, content:content.slice(offset, offset + length), next:offset + length < content.length ? offset + length : null });
  }
  return results.length === 1 ? results[0] : { checkpoints: results };
}

export async function executeTool(runtime, task, name, args, signal, effect) {
  const store = runtime.store;
  if (name === 'load_toolset') {
    const requested = Array.isArray(args.toolsets) ? args.toolsets.filter(Boolean) : [];
    task.loadedToolsets = [...new Set([...(task.loadedToolsets || []), ...requested])];
    const activated = [];
    for (const grp of requested) {
      if (grp === 'all') {
        for (const t of baseTools) activated.push(t.function.name);
        if (runtime.plugins) for (const p of runtime.plugins.list()) activated.push(...(p.toolNames || []));
      } else if (grp === 'plugins') {
        if (runtime.plugins) for (const p of runtime.plugins.list()) activated.push(...(p.toolNames || []));
      } else if (TOOLSET_GROUPS[grp]) {
        activated.push(...TOOLSET_GROUPS[grp]);
      }
    }
    runtime.changed(task);
    const uniqueActivated = [...new Set(activated)];
    const installedPluginCount = runtime.plugins ? runtime.plugins.list().length : 0;
    const emptyPluginsOnly = requested.length === 1 && requested[0] === 'plugins' && uniqueActivated.length === 0;
    return {
      loaded: requested,
      activeToolsets: task.loadedToolsets,
      activatedTools: uniqueActivated,
      installedPluginsCount: installedPluginCount,
      note: emptyPluginsOnly
        ? 'No custom JS plugins are currently installed (0 plugin tools activated). Install plugins from the Skills & Plugins Gallery or author one with create_dynamic_tool.'
        : 'These tools are now active and callable on your next step.',
    };
  }
  if(name==='search_capabilities')return runtime.capabilities.list({query:args.query,kind:args.kind,offset:args.offset,limit:20});
  if(name==='get_capability'){const entry=runtime.capabilities.get(args.id);return {...entry,...(entry.kind==='function'?{schema:baseTools.find(tool=>tool.function.name===entry.tool)?.function.parameters}:{})};}
  if(name==='save_capability'){const entry=runtime.capabilities.save(args);runtime.emit('change');return {saved:true,id:entry.id,revision:entry.revision};}
  if(name==='list_attachments')return task.attachments||[];
  if(name==='read_attachment'){
    const result=await runtime.attachments.read(task,args.id,{offset:args.offset??0,length:args.length??8000});
    if(result.attachment.kind==='image')return {...result,image:'data:'+result.attachment.mime+';base64,'+(await fs.readFile(result.path)).toString('base64'),name:result.attachment.name};
    return result;
  }
  if(name==='list_effects')return task.effects.slice(-60);
  if(name==='reconcile_effect')return store.updateEffect(task,args.id,args.status,{evidence:args.evidence,reconciledAt:new Date().toISOString()});
  if(name==='verify_effect')return runtime.verifyEffect(task,args.id,signal);
  if(name==='retry_effect')return runtime.retryEffect(task,args.id,signal);
  if(name==='list_mcp_servers')return catalogPage(store.state.mcpServers.map(s=>({name:s.name,transport:s.transport})),{query:args.query,offset:args.offset,limit:20});
  if(name==='list_mcp_tools'){
    const tools=await runtime.mcp.list(args.server);
    if(args.tool){const tool=tools.find(item=>item.name===args.tool);if(!tool)throw new Error('MCP tool not found.');return tool;}
    return catalogPage(tools.map(tool=>({name:tool.name,description:(tool.description||'').slice(0,600)})),{query:args.query,offset:args.offset,limit:20});
  }
  if(name==='invoke_mcp')return runtime.mcp.call(args.server,args.tool,args.input,signal);
  if(name==='search_history'){
    if(typeof args.query!=='string')throw new Error('Invalid search query');
    const qLower = args.query.toLowerCase();
    const offset=Number.isInteger(args.offset)&&args.offset>=0?args.offset:0;
    if (task?.ephemeral) {
      const matches = (task.messages || []).filter(m => JSON.stringify(m).toLowerCase().includes(qLower)).map(message => ({ at: task.createdAt, message }));
      return { total: matches.length, offset, entries: matches.slice(offset, offset + 10), next: offset + 10 < matches.length ? offset + 10 : null };
    }
    const data=await fs.readFile(path.join(store.directoryFor(task.id),'transcript.jsonl'),'utf8').catch(()=> '');
    const matches=data.split('\n').filter(line=>line && line.toLowerCase().includes(qLower));
    return {total:matches.length,offset,entries:matches.slice(offset,offset+10).map(line=>JSON.parse(line)),next:offset+10<matches.length?offset+10:null};
  }
  if(name==='read_artifact')return readArtifact(store,task,args.id,args.offset || 0,args.length || 8000);
  if(name==='read_checkpoint')return readCheckpoint(store,task,args);
  if(name==='todo_read')return { todos: task.todos || [] };
  if(name==='todo_write'){
    if(!Array.isArray(args.todos))throw new Error('Provide a valid todos array.');
    task.todos = args.todos.slice(0, 100).map(item => ({
      id: String(item.id || crypto.randomUUID().slice(0, 8)),
      title: String(item.title || '').trim(),
      status: ['pending', 'in_progress', 'completed', 'blocked'].includes(item.status) ? item.status : 'pending',
      priority: ['low', 'medium', 'high'].includes(item.priority) ? item.priority : 'medium',
      updatedAt: new Date().toISOString(),
    }));
    store.journal(task, 'todo_updated', { count: task.todos.length, completed: task.todos.filter(t => t.status === 'completed').length });
    runtime.changed(task);
    return { updated: true, todos: task.todos };
  }
  if(name==='memory_store'){
    store.state.memories = normalizeMemories(store.state.memories || []);
    const defaultScope = ['priority', 'preference', 'constraint', 'profile'].includes(args.category) ? 'global' : (task.workspace ? 'project' : 'global');
    if(args.action === 'list'){
      const items = searchMemories(store.state.memories, {
        category: args.category || 'all',
        priority: args.priority || 'all',
        scope: args.scope || 'all',
        workspace: task.workspace || '',
      });
      return { count: items.length, memories: items };
    }
    if(args.action === 'search'){
      const items = searchMemories(store.state.memories, {
        query: args.query || args.key || '',
        category: args.category || 'all',
        priority: args.priority || 'all',
        scope: args.scope || 'all',
        workspace: task.workspace || '',
      });
      return { count: items.length, memories: items };
    }
    if(args.action === 'profile'){
      const selected = selectMemoriesForContext(store.state.memories, { workspace: task.workspace || '' });
      return {
        count: selected.length,
        formattedProfile: formatMemoriesForPrompt(selected) || '(No user memories stored yet.)',
        memories: selected,
      };
    }
    if(args.action === 'remember' || args.action === 'update'){
      const res = upsertMemory(store.state.memories, {
        id: args.id,
        key: args.key,
        value: args.value,
        category: args.category,
        priority: args.priority,
        scope: args.scope,
        tags: args.tags,
        pinned: args.pinned,
        source: 'agent',
      }, { defaultScope, defaultWorkspace: task.workspace || '', defaultSource: 'agent' });
      runtime.changed(null);
      return { saved: true, updated: res.updated, memory: res.memory, key: res.memory.key, scope: res.memory.scope, category: res.memory.category, priority: res.memory.priority };
    }
    if(args.action === 'forget'){
      const res = removeMemory(store.state.memories, { id: args.id, key: args.key, workspace: task.workspace || '' });
      store.state.memories = res.memories;
      runtime.changed(null);
      return { removed: res.removed };
    }
    throw new Error('Unsupported memory_store action.');
  }
  const toolFetch = createNexusFetcher(() => store.state.settings, runtime.tor, { baseFetch: runtime.request, scope: 'agent', wgManager: runtime.wireguard || null });
  const webUa = store.state.settings.webUserAgent || '';
  if(name==='web_search')return executeWebSearch(args.query, {
    provider: args.provider || '',
    maxResults: args.maxResults,
    settings: store.state.settings,
    getSecret: k => runtime.getSecret?.(k) || null,
    torRunning: Boolean(runtime.tor?.isRunning?.()),
    request: toolFetch,
    signal,
  });
  if(name==='web_fetch')return fetchWebResource(args.url, { extractText: args.extractText !== false, offset: args.offset, length: args.length, userAgent: webUa, request: toolFetch, signal });
  if(name==='http_request')return executeHttpRequest(args, { request: toolFetch, signal });
  if(name==='browser_inspect'){
    const prefEngine = args.engine && args.engine !== 'auto' ? args.engine : (store.state.settings.browserEngineMode || 'dual');
    const wantsJs = Boolean(args.renderJs || args.waitForSelector || (Array.isArray(args.actions) && args.actions.length) || args.captureScreenshot || args.useAccountSession || prefEngine === 'agent-js' || prefEngine === 'standard');
    if (prefEngine === 'agent-fast' && !args.renderJs && !args.actions?.length && !args.captureScreenshot && !args.waitForSelector) {
      return runFastAgentBrowser(args.url, { request: toolFetch, userAgent: webUa, signal });
    }
    if (!wantsJs && prefEngine === 'dual') {
      return runFastAgentBrowser(args.url, { request: toolFetch, userAgent: webUa, signal });
    }
    return inspectWebPage(args.url, {
      extractLinks: args.extractLinks !== false,
      extractForms: args.extractForms !== false,
      renderJs: wantsJs,
      agentMode: prefEngine !== 'standard',
      waitMs: args.waitMs,
      waitForSelector: args.waitForSelector || '',
      actions: args.actions || null,
      useAccountSession: Boolean(args.useAccountSession),
      captureScreenshot: Boolean(args.captureScreenshot),
      userAgent: webUa,
      browserInspect: runtime.browserInspect,
      request: toolFetch,
      signal,
    });
  }
  if(name==='manage_project')return runtime.manageProject(task, args);
  if(name==='manage_session')return runtime.manageSession(task, args);
  if(name==='manage_privacy')return runtime.managePrivacy(task, args);
  if(name==='nexus_control')return runtime.nexusControl(task, args);
  if(name==='manage_automation'){
    if(!runtime.automations)throw new Error('Automations scheduler is not attached to this runtime.');
    if(args.action==='list')return { automations: runtime.automations.list() };
    if(args.action==='create')return runtime.automations.save({ ...args, workspace: args.workspace || task.workspace || '' });
    if(['toggle','run','delete'].includes(args.action) && !args.id) throw new Error(`manage_automation action "${args.action}" requires the automation "id" returned by action "list" or "create".`);
    if(args.action==='toggle')return runtime.automations.toggle(args.id, args.enabled);
    if(args.action==='run')return runtime.automations.runNow(args.id);
    if(args.action==='delete')return runtime.automations.remove(args.id);
    throw new Error('Unsupported manage_automation action.');
  }
  if(name==='system_info')return inspectSystemEnvironment(task.workspace);
  if(name==='delegate_subagent')return runtime.runSubagent(task, args, signal);
  if(name==='spawn_session')return runtime.spawnChildSession(task, args);
  if(name==='list_sessions')return runtime.listSessionsFor(task, args);
  if(name==='send_session_message')return runtime.sendSessionMessage(task, args);
  if(name==='read_session')return runtime.readSession(args, signal);
  if(name==='create_dynamic_tool'){
    const plugin = await runtime.plugins.createSingleTool(args);
    store.journal(task, 'dynamic_tool_created', { tool: args.name, pluginId: plugin?.id });
    runtime.changed(task);
    return { created: true, tool: args.name, pluginId: plugin?.id, availableImmediately: true };
  }
  // Check hot-loaded dynamic plugin tools
  if(runtime.plugins?.findTool(name)){
    return runtime.plugins.executeTool(name, args, { task, workspace: task.workspace || process.cwd(), store, runtime });
  }
  if(name==='scaffold_mcp_server'){
    const res = await scaffoldMcpServer(store, runtime.mcp, args);
    store.journal(task, 'mcp_scaffolded', { server: res.server, tools: res.tools });
    runtime.changed(task);
    return res;
  }
  if(name==='self_improve')return runSelfImprovement(runtime, task, args);
  if(name==='manage_process'){
    const act = args.action || 'list';
    if(act === 'list') return { processes: runtime.processes.list() };
    if(act === 'start') return runtime.processes.start({ command: args.command, cwd: task.workspace || process.cwd(), label: args.label });
    if(act === 'status') return runtime.processes.get(args.id);
    if(act === 'output') return runtime.processes.get(args.id);
    if(act === 'stop') return runtime.processes.stop(args.id);
    throw new Error('Unsupported manage_process action.');
  }
  if (name === 'document_progress') {
    task.lastProgressStep=task.steps;
    task.progressDue=false;
    const entry = store.journal(task, 'progress', args);
    return { saved: true, entry: entry.id };
  }
  if (name === 'search_journal') {
    const qLower = String(args.query).toLowerCase();
    if (task?.ephemeral) {
      return { entries: (task.events || []).filter(e => JSON.stringify(e).toLowerCase().includes(qLower)).slice(-30) };
    }
    const data = await fs.readFile(path.join(store.directoryFor(task.id), 'journal.jsonl'), 'utf8').catch(() => '');
    return { entries: data.split('\n').filter(line => line.toLowerCase().includes(qLower)).slice(-30).map(line => JSON.parse(line)) };
  }
  if (name === 'list_connectors') return catalogPage(store.state.connectors.map(item=>({name:item.name,method:item.method,description:String(item.description||'').slice(0,600),imported:!!item.openapi})),{query:args.query,offset:args.offset,limit:20});
  if (name === 'get_connector') {const connector=store.state.connectors.find(item=>item.name===args.name);if(!connector)throw new Error('Connector not found.');return connector;}
  if (name === 'create_connector') {
    runtime.validateConnector(args);
    if (store.state.connectors.some(c => c.name === args.name)) throw new Error('A connector with that name already exists.');
    store.state.connectors.push(args); store.save();
    return { saved: true, name: args.name };
  }
  if (name === 'invoke_connector') return runtime.invokeConnector(args, signal, effect);
  if (name.startsWith('desktop_')) {
    if (!store.state.settings.desktopEnabled) throw new Error('Desktop control is disabled in Settings.');
    return runtime.desktop(name, args, signal);
  }
  const effectiveMode = task.agentMode || store.state.settings.agentMode || 'autopilot';
  const unrestricted = effectiveMode === 'unrestricted' || store.state.settings.autonomous;
  const toolsAppRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const cwdIsAppRoot = (() => {
    const a = process.platform === 'win32' ? toolsAppRoot.toLowerCase() : toolsAppRoot;
    const b = process.platform === 'win32' ? path.resolve(process.cwd()).toLowerCase() : path.resolve(process.cwd());
    if (a === b) return true;
    const rel = path.relative(a, b);
    return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
  })();
  const fallbackSafeCwd = cwdIsAppRoot ? os.homedir() : process.cwd();
  const effectiveWorkspace = task.workspace || (unrestricted ? fallbackSafeCwd : '');
  if (name === 'present_media') {
    const rawItems = Array.isArray(args.items) && args.items.length
      ? args.items.slice(0, 12)
      : (args.path ? [{ path: args.path, title: args.title, caption: args.caption, kind: args.kind }] : []);
    if (!rawItems.length) throw new Error('present_media requires "path" or a non-empty "items" array.');
    const mediaResolve = unrestricted
      ? async (reqPath) => path.resolve(effectiveWorkspace || fallbackSafeCwd, reqPath)
      : async (reqPath) => {
          if (!effectiveWorkspace) throw new Error('Select a workspace folder to present relative files.');
          return workspacePath(effectiveWorkspace, reqPath, false);
        };
    const presented = [];
    for (const spec of rawItems) {
      const resolved = await mediaResolve(spec.path);
      const item = await buildChatMediaItem(resolved, {
        title: spec.title || '',
        caption: spec.caption || '',
        kind: spec.kind || 'auto',
        registerMedia: runtime.registerMedia,
      });
      presented.push(item);
    }
    return { presented: true, count: presented.length, chatMedia: presented };
  }
  if (!effectiveWorkspace) throw new Error('Select a project workspace folder to use file, Git, or terminal tools.');
  const wantsElevated = args.elevated === true || (Boolean(task.adminMode) && args.elevated !== false);
  if (name === 'run_command') {
    if (wantsElevated) {
      return runElevatedCommand(args.command, { cwd: effectiveWorkspace, signal, timeout: 0, broker: runtime.adminBroker });
    }
    return command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', wrapUtf8Ps(args.command)], { cwd: effectiveWorkspace, signal, timeout:0 });
  }
  if (name === 'shell_session') {
    return runtime.shells.exec(task.id, args.command, {
      defaultCwd: effectiveWorkspace,
      envOverrides: args.env,
      signal,
      timeout: wantsElevated ? 90000 : 60000,
      elevated: wantsElevated,
      adminBroker: runtime.adminBroker,
    });
  }
  if (name === 'git_operation') {
    const mutatingGitOps = new Set(['commit', 'checkout', 'checkout_new', 'discard', 'stash', 'pull', 'push', 'stage', 'unstage', 'worktree_add', 'worktree_remove']);
    if (!task.workspace && mutatingGitOps.has(args.operation) && !args.cwd) {
      throw new Error(`Mutating git_operation "${args.operation}" requires an explicit "cwd" path when the chat has no linked project workspace (prevents accidentally mutating the default host repo).`);
    }
    const gitCwd = (unrestricted && args.cwd) ? path.resolve(effectiveWorkspace, args.cwd) : effectiveWorkspace;
    return executeGitOperation(gitCwd, args, signal);
  }
  const resolvePath = unrestricted ? async(root,requested='.')=>path.resolve(root,requested) : workspacePath;
  if (name === 'dir_tree') {
    return buildDirectoryTree(effectiveWorkspace, args.path || '.', { maxDepth: args.maxDepth, maxEntries: args.maxEntries, resolvePath: unrestricted ? null : workspacePath, signal });
  }
  if (name === 'batch_read_files') {
    if (!Array.isArray(args.files) || !args.files.length) throw new Error('Provide a non-empty files array.');
    const items = await Promise.all(args.files.slice(0, 10).map(async spec => {
      try {
        const resolved = await resolvePath(effectiveWorkspace, spec.path, false);
        return await readFileWithRanges(resolved, spec.path, { startLine: spec.startLine, endLine: spec.endLine });
      } catch (err) {
        return { path: spec.path, error: err.message };
      }
    }));
    return { count: items.length, files: items };
  }
  if (name === 'move_file') {
    const src = await resolvePath(effectiveWorkspace, args.from, false);
    const dst = await resolvePath(effectiveWorkspace, args.to, true);
    return moveFileWithBackup(store, task, src, dst, args.from, args.to, args.reason);
  }
  if (name === 'delete_file') {
    const delTarget = await resolvePath(effectiveWorkspace, args.path, false);
    return deleteFileWithBackup(store, task, delTarget, args.path, args.reason);
  }
  if (name === 'run_diagnostics') {
    return runCodeDiagnostics(effectiveWorkspace, args.path || '.', { resolvePath: unrestricted ? null : workspacePath, signal });
  }
  if (name === 'glob_files') {
    const searchRoot = args.path ? await resolvePath(effectiveWorkspace, args.path, false) : effectiveWorkspace;
    return globWorkspaceFiles(searchRoot, args.pattern, { resolvePath: unrestricted ? null : workspacePath, signal });
  }
  if (name === 'code_outline') {
    return extractCodeOutline(effectiveWorkspace, args.path || '.', { resolvePath: unrestricted ? null : workspacePath });
  }
  if (name === 'grep_search') {
    const searchRoot = args.path ? await resolvePath(effectiveWorkspace, args.path, false) : effectiveWorkspace;
    return grepWorkspaceFiles(searchRoot, {
      query: args.query,
      isRegex: Boolean(args.isRegex),
      caseSensitive: Boolean(args.caseSensitive),
      glob: args.glob || '',
      contextLines: args.contextLines || 0,
      resolvePath: unrestricted ? null : workspacePath,
      signal,
    });
  }
  const target = await resolvePath(effectiveWorkspace, args.path, name === 'write_file' || name === 'apply_patch');
  if (name === 'list_files') {
    return (await fs.readdir(target, { withFileTypes: true })).slice(0, 500).map(entry => ({ name: entry.name, directory: entry.isDirectory(), link: entry.isSymbolicLink() }));
  }
  if (name === 'search_files') {
    if(typeof args.query !== 'string' || !args.query.trim()) throw new Error('Provide text to search for.');
    const matches = []; let visited = 0;
    const relToRoot = path.relative(effectiveWorkspace, target);
    const displayBase = (!relToRoot || (!relToRoot.startsWith('..') && !path.isAbsolute(relToRoot))) ? effectiveWorkspace : target;
    const scanFile = async filename => {
      signal?.throwIfAborted();
      visited++;
      if ((await fs.stat(filename)).size > 200000) return;
      const text = await fs.readFile(filename, 'utf8');
      if (text.includes('\u0000')) return;
      const dispPath = path.relative(displayBase, filename).replace(/\\/g, '/') || path.basename(filename);
      text.split(/\r?\n/).forEach((line, index) => {
        if (matches.length < 100 && line.toLowerCase().includes(args.query.toLowerCase())) {
          matches.push({ path: dispPath, line: index + 1, text: line.slice(0, 400) });
        }
      });
    };
    if ((await fs.stat(target)).isFile()) {
      await scanFile(target);
      return { matches, visited, bounded: matches.length >= 100 };
    }
    const walk = async directory => {
      for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
        signal?.throwIfAborted();
        if(matches.length>=100 || visited>=2000)return;
        if(entry.isSymbolicLink() || ['node_modules','.git','dist','release','.next'].includes(entry.name))continue;
        const filename = await resolvePath(effectiveWorkspace,path.relative(effectiveWorkspace,path.join(directory,entry.name)));
        if(entry.isDirectory()){await walk(filename);continue;}
        await scanFile(filename);
      }
    };
    await walk(target);return {matches,visited,bounded:visited>=2000||matches.length>=100};
  }
  if (name === 'read_file') {
    return readFileWithRanges(target, args.path, { startLine: args.startLine, endLine: args.endLine });
  }
  if (name === 'multi_edit') {
    return multiEditFile(store, task, target, args.path, args.edits, args.reason);
  }
  if (name === 'apply_patch') {
    return applyPatchToFile(store, task, target, args.path, args.patch, args.reason);
  }
  if (['write_file','replace_text'].includes(name)) {
    const previous = await fs.readFile(target, 'utf8').catch(error => { if(error.code === 'ENOENT') return null; throw error; });
    let content = args.content;
    if (name === 'replace_text') {
      if (!args.oldText || previous === null || previous.split(args.oldText).length !== 2) throw new Error('oldText must match exactly once in the target file.');
      content = previous.replace(args.oldText, () => args.newText);
    }
    const maxWriteBytes = unrestricted ? 5 * 1024 * 1024 : 500000;
    if (typeof content !== 'string' || Buffer.byteLength(content) > maxWriteBytes) throw new Error(`Invalid content or file size exceeds ${Math.round(maxWriteBytes / 1000)} KB.`);
    let backup = null;
    if (previous !== null) {
      backup = path.join(store.directoryFor(task.id), 'backup-' + crypto.randomUUID() + '.txt');
      await fs.writeFile(backup, previous);
    }
    const diffInfo = createUnifiedDiff(previous ?? '', content, args.path);
    store.journal(task, 'write_intent', { path: target, reason: args.reason, backup, existed: previous !== null });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
    store.journal(task, 'file_change', { path: target, reason: args.reason, backup, bytes: Buffer.byteLength(content), addedLines: diffInfo.addedLines, removedLines: diffInfo.removedLines });
    return { written: args.path, backup, bytes: Buffer.byteLength(content), ...diffInfo };
  }
  throw new Error('Unknown tool: ' + name);
}
