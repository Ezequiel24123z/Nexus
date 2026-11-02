import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {readArtifact} from './artifacts.mjs';
import {catalogPage,functionTargets} from './capabilities.mjs';
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
} from './coding-engine.mjs';

export const READ_ONLY_TOOL_NAMES = new Set([
  'search_capabilities',
  'get_capability',
  'list_attachments',
  'read_attachment',
  'list_mcp_servers',
  'list_mcp_tools',
  'list_files',
  'read_file',
  'search_files',
  'glob_files',
  'grep_search',
  'code_outline',
  'list_effects',
  'search_journal',
  'search_history',
  'read_artifact',
  'read_checkpoint',
  'list_connectors',
  'get_connector',
  'todo_read',
  'web_fetch',
  'system_info',
]);

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
  def('read_file', 'Read a UTF-8 file (up to 100 KB whole, or pass startLine and endLine to inspect line ranges of files up to 10 MB with line numbers).', { path: str('Relative or absolute path'), startLine: { type: 'integer', minimum: 1, description: 'Optional 1-based start line' }, endLine: { type: 'integer', minimum: 1, description: 'Optional 1-based inclusive end line' } }, ['path']),
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
  def('git_operation', 'Execute structured Git operations in the workspace: status, diff, log, branch, stage, unstage, commit, worktree_list, or worktree_add.', { operation: { type: 'string', enum: ['status', 'diff', 'log', 'branch', 'stage', 'unstage', 'commit', 'worktree_list', 'worktree_add'] }, staged: { type: 'boolean', description: 'For diff: inspect staged changes' }, target: str('Optional file path for diff/stage/unstage'), paths: { type: 'array', items: { type: 'string' }, description: 'File paths for stage/unstage' }, message: str('Commit message when operation is commit'), stageAll: { type: 'boolean', description: 'Stage all changes before commit' }, limit: { type: 'integer', minimum: 1, maximum: 50 }, path: str('Target directory for worktree_add'), branch: str('Branch name for worktree_add') }, ['operation']),
  def('run_command', 'Execute a PowerShell command with the user Windows permissions. Unsandboxed. No automatic timeout; user can pause.', { command: str('PowerShell command'), reason: str('Purpose of command') }, ['command', 'reason']),
  def('manage_process', 'Start, inspect, read output from, list, or stop long-running background processes (dev servers, watchers, builds).', { action: { type: 'string', enum: ['start', 'status', 'output', 'stop', 'list'] }, id: str('Process ID for status/output/stop'), command: str('Shell command when action is start'), label: str('Short label for the background process') }, ['action']),
  def('todo_write', 'Create or update the structured task checklist (plan) for this session to track multi-step engineering progress.', { todos: { type: 'array', items: { type: 'object', properties: { id: str('Short kebab-case ID'), title: str('Actionable task description'), status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked'] }, priority: { type: 'string', enum: ['low', 'medium', 'high'] } }, required: ['id', 'title', 'status'], additionalProperties: false } } }, ['todos']),
  def('todo_read', 'Read the current structured task checklist for this session.', {}),
  def('memory_store', 'Manage persistent agent memories across sessions (project conventions, architecture facts, user preferences).', { action: { type: 'string', enum: ['list', 'remember', 'forget'] }, key: str('Memory key or short topic'), value: str('Fact or convention to remember'), scope: { type: 'string', enum: ['project', 'global'], description: 'Scope of memory (defaults to project if in a workspace, else global)' } }, ['action']),
  def('web_fetch', 'Fetch an HTTP/HTTPS URL and extract clean readable text/markdown or JSON content with pagination.', { url: str('HTTP or HTTPS URL'), extractText: { type: 'boolean', description: 'Convert HTML to clean readable text (default true)' }, offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 100, maximum: 24000 } }, ['url']),
  def('delegate_subagent', 'Spawn an isolated sub-agent with its own clean context window to research a question, review code, or execute a bounded sub-task, returning a concise report.', { objective: str('Clear, self-contained task or research question for the sub-agent'), mode: { type: 'string', enum: ['explore', 'architect', 'agent'], description: 'Operating mode for the sub-agent (default explore)' }, maxSteps: { type: 'integer', minimum: 1, maximum: 12, description: 'Maximum tool steps for the sub-agent (default 6)' } }, ['objective']),
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
  def('desktop_screenshot', 'Capture the primary screen and deliver it to the model. Use the returned physical scale factor when computing click coordinates.', {}),
  def('desktop_action', 'Control Windows mouse and keyboard. Always inspect a recent screenshot first and verify the result.', { action: { type:'string', enum:['click','double_click','type','key','scroll'] }, x:{type:'integer'}, y:{type:'integer'}, text:str('Literal text or key chord: ENTER, TAB, ESC, CTRL+A, CTRL+C, CTRL+V, ALT+TAB'), amount:{type:'integer'} }, ['action']),
];

const checkpointName = /^checkpoint-(\d+)\.json$/;
async function readCheckpoint(store, task, args = {}) {
  const directory = store.directoryFor(task.id);
  const requested = args.checkpoints === undefined ? null : args.checkpoints;
  if (requested !== null && (!Array.isArray(requested) || !requested.length || requested.some(n => !Number.isInteger(n) || n < 1))) throw new Error('Invalid checkpoint list: use positive integers.');
  const numbers = requested === null ? null : [...new Set(requested)].sort((a, b) => a - b);
  const section = args.section === undefined ? 'summary' : args.section;
  if (!['summary','messages'].includes(section)) throw new Error('Invalid section: use summary or messages.');
  const offset = args.offset === undefined ? 0 : args.offset;
  const length = args.length === undefined ? 8000 : Math.min(args.length, 20000);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 1) throw new Error('Invalid range: offset >= 0 and length between 1 and 20000.');
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
    const data=await fs.readFile(path.join(store.directoryFor(task.id),'transcript.jsonl'),'utf8').catch(()=> '');
    const matches=data.split('\n').filter(line=>line && line.toLowerCase().includes(args.query.toLowerCase()));
    const offset=Number.isInteger(args.offset)&&args.offset>=0?args.offset:0;
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
    store.state.memories ||= [];
    const scope = args.scope || (task.workspace ? 'project' : 'global');
    const workspaceKey = scope === 'project' ? (task.workspace || '') : '';
    if(args.action === 'list'){
      return { memories: store.state.memories.filter(m => m.scope === 'global' || m.workspace === task.workspace) };
    }
    if(args.action === 'remember'){
      if(typeof args.key !== 'string' || !args.key.trim() || typeof args.value !== 'string' || !args.value.trim()){
        throw new Error('Provide both key and value to remember.');
      }
      const existing = store.state.memories.find(m => m.key.toLowerCase() === args.key.trim().toLowerCase() && m.scope === scope && m.workspace === workspaceKey);
      if(existing){
        existing.value = args.value.trim().slice(0, 4000);
        existing.updatedAt = new Date().toISOString();
      } else {
        store.state.memories.push({
          id: crypto.randomUUID(),
          key: args.key.trim().slice(0, 120),
          value: args.value.trim().slice(0, 4000),
          scope,
          workspace: workspaceKey,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      runtime.changed(null);
      return { saved: true, key: args.key.trim(), scope };
    }
    if(args.action === 'forget'){
      const before = store.state.memories.length;
      store.state.memories = store.state.memories.filter(m => !(m.key.toLowerCase() === String(args.key || '').trim().toLowerCase() && (m.scope === 'global' || m.workspace === task.workspace)));
      runtime.changed(null);
      return { removed: before - store.state.memories.length };
    }
    throw new Error('Unsupported memory_store action.');
  }
  if(name==='web_fetch')return fetchWebResource(args.url, { extractText: args.extractText !== false, offset: args.offset, length: args.length, request: runtime.request, signal });
  if(name==='system_info')return inspectSystemEnvironment(task.workspace);
  if(name==='delegate_subagent')return runtime.runSubagent(task, args, signal);
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
    const data = await fs.readFile(path.join(store.directoryFor(task.id), 'journal.jsonl'), 'utf8').catch(() => '');
    return { entries: data.split('\n').filter(line => line.toLowerCase().includes(String(args.query).toLowerCase())).slice(-30).map(line => JSON.parse(line)) };
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
  if (!task.workspace) throw new Error('Select a project workspace folder to use file, Git, or terminal tools.');
  if (name === 'run_command') return command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', args.command], { cwd: task.workspace, signal, timeout:0 });
  if (name === 'git_operation') return executeGitOperation(task.workspace, args, signal);
  const unrestricted = store.state.settings.autonomous || task.agentMode === 'unrestricted';
  const resolvePath = unrestricted ? async(root,requested='.')=>path.resolve(root,requested) : workspacePath;
  if (name === 'glob_files') {
    const searchRoot = args.path ? await resolvePath(task.workspace, args.path, false) : task.workspace;
    return globWorkspaceFiles(searchRoot, args.pattern, { resolvePath: unrestricted ? null : workspacePath, signal });
  }
  if (name === 'code_outline') {
    return extractCodeOutline(task.workspace, args.path || '.', { resolvePath: unrestricted ? null : workspacePath });
  }
  if (name === 'grep_search') {
    const searchRoot = args.path ? await resolvePath(task.workspace, args.path, false) : task.workspace;
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
  const target = await resolvePath(task.workspace, args.path, name === 'write_file' || name === 'apply_patch');
  if (name === 'list_files') {
    return (await fs.readdir(target, { withFileTypes: true })).slice(0, 500).map(entry => ({ name: entry.name, directory: entry.isDirectory(), link: entry.isSymbolicLink() }));
  }
  if (name === 'search_files') {
    if(typeof args.query !== 'string' || !args.query.trim()) throw new Error('Provide text to search for.');
    const matches = []; let visited = 0;
    const walk = async directory => {
      for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
        signal.throwIfAborted();
        if(matches.length>=100 || visited>=2000)return;
        if(entry.isSymbolicLink() || ['node_modules','.git','dist','release','.next'].includes(entry.name))continue;
        const filename = await resolvePath(task.workspace,path.relative(task.workspace,path.join(directory,entry.name)));
        if(entry.isDirectory()){await walk(filename);continue;}
        visited++;
        if((await fs.stat(filename)).size>200000)continue;
        const text=await fs.readFile(filename,'utf8');if(text.includes('\u0000'))continue;
        text.split(/\r?\n/).forEach((line,index)=>{if(matches.length<100 && line.toLowerCase().includes(args.query.toLowerCase()))matches.push({path:path.relative(task.workspace,filename),line:index+1,text:line.slice(0,400)});});
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
    if (typeof content !== 'string' || Buffer.byteLength(content) > 500000) throw new Error('Invalid content or file size exceeds 500 KB.');
    let backup = null;
    if (previous !== null) {
      backup = path.join(store.directoryFor(task.id), 'backup-' + crypto.randomUUID() + '.txt');
      await fs.writeFile(backup, previous);
    }
    store.journal(task, 'write_intent', { path: target, reason: args.reason, backup, existed: previous !== null });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
    store.journal(task, 'file_change', { path: target, reason: args.reason, backup, bytes: Buffer.byteLength(content) });
    return { written: args.path, backup, bytes: Buffer.byteLength(content) };
  }
  throw new Error('Unknown tool: ' + name);
}
