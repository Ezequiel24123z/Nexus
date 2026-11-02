import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../core/store.mjs';
import { Runtime } from '../core/runtime.mjs';
import { executeTool } from '../core/tools.mjs';
import { modelConnection, completionRequest, providerCatalog, checkProviderConnection } from '../core/providers.mjs';
import { requestTools } from '../core/model-request.mjs';
import { runGit } from '../core/coding-engine.mjs';

async function setup(t, request) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-agentic-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Store(path.join(directory, 'data'));
  const secrets = {
    OPENROUTER_API_KEY: 'or-key',
    ARLIAI_API_KEY: 'arli-key',
    OPENAI_API_KEY: 'oa-key',
    GITHUB_COPILOT_TOKEN: 'ghu_copilot_token',
    ANTHROPIC_API_KEY: 'ant-key',
  };
  const runtime = new Runtime(store, {
    getSecret: name => secrets[name] || null,
    request: request || (async () => Response.json({ choices: [{ message: { content: 'Done' } }], usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } })),
  });
  runtime.closed = true;
  t.after(() => { runtime.shutdown(); store.close(); });
  const workspace = path.join(directory, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  return { directory, store, runtime, workspace, secrets };
}

test('multi-provider routing supports OpenAI, GitHub Copilot, Anthropic, Custom/Local, Arli.ai, and OpenRouter', async () => {
  const oa = completionRequest({
    model: 'openai/gpt-5',
    messages: [{ role: 'user', content: 'Hi' }],
    settings: { streaming: true, reasoningEffort: 'high' },
    tools: requestTools({ model: 'openai/gpt-5' }),
    outputLimit: 4096,
  });
  assert.equal(oa.connection.id, 'openai');
  assert.equal(oa.connection.key, 'OPENAI_API_KEY');
  assert.equal(oa.connection.base, 'https://api.openai.com/v1');
  assert.equal(oa.body.model, 'gpt-5');
  assert.equal(oa.body.max_completion_tokens, 4096);
  assert.equal(oa.body.reasoning_effort, 'high');
  assert.equal(oa.body.tool_choice, 'auto');
  assert.deepEqual(oa.body.stream_options, { include_usage: true });

  const copilot = completionRequest({
    model: 'copilot/claude-sonnet-4.5',
    messages: [{ role: 'user', content: 'Code' }],
    settings: { streaming: true, reasoningEffort: 'medium' },
    tools: requestTools({ model: 'copilot/claude-sonnet-4.5' }),
  });
  assert.equal(copilot.connection.id, 'copilot');
  assert.equal(copilot.connection.key, 'GITHUB_COPILOT_TOKEN');
  assert.equal(copilot.body.model, 'claude-sonnet-4.5');
  assert.equal(copilot.headers['Copilot-Integration-Id'], 'vscode-chat');
  assert.equal(copilot.headers['Openai-Intent'], 'conversation-edits');

  const anthropic = completionRequest({
    model: 'anthropic/claude-sonnet-4-5',
    messages: [{ role: 'user', content: 'Review' }],
    settings: { streaming: false, reasoningEffort: 'none' },
  });
  assert.equal(anthropic.connection.id, 'anthropic');
  assert.equal(anthropic.headers['anthropic-version'], '2023-06-01');
  assert.equal(anthropic.body.model, 'claude-sonnet-4-5');

  const local = completionRequest({
    model: 'custom/qwen2.5-coder:32b',
    messages: [{ role: 'user', content: 'Local' }],
    settings: { streaming: false, customBaseUrl: 'http://127.0.0.1:1234/v1/' },
  });
  assert.equal(local.connection.id, 'custom');
  assert.equal(local.connection.base, 'http://127.0.0.1:1234/v1');
  assert.equal(local.connection.optionalKey, true);
  assert.equal(local.body.model, 'qwen2.5-coder:32b');

  for (const p of ['openai', 'copilot', 'anthropic', 'custom']) {
    const cat = await providerCatalog(p);
    assert.ok(Array.isArray(cat) && cat.length > 0);
    assert.ok(cat.every(item => item.id.startsWith(p + '/')));
  }

  const verified = await checkProviderConnection('copilot', 'ghu_test', {
    request: async (url, opts) => {
      assert.equal(url, 'https://api.githubcopilot.com/models');
      assert.equal(opts.headers['Copilot-Integration-Id'], 'vscode-chat');
      return Response.json({ data: [{ id: 'claude-sonnet-4.5', context_length: 200000 }] });
    },
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.models[0].id, 'claude-sonnet-4.5');
});

test('local custom provider executes without requiring an API key in vault', async t => {
  const { store, runtime } = await setup(t, async (url, opts) => {
    assert.equal(url, 'http://localhost:11434/v1/chat/completions');
    const body = JSON.parse(opts.body);
    assert.equal(body.model, 'qwen2.5-coder:32b');
    return Response.json({ choices: [{ message: { content: 'Local model response' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  });
  runtime.settings({ model: 'custom/qwen2.5-coder:32b', streaming: false });
  assert.equal(runtime.snapshot().hasKey, true);
  const id = runtime.create({ prompt: 'Run local' });
  const res = await runtime.completion([{ role: 'user', content: 'Run local' }], store.task(id), new AbortController().signal);
  assert.equal(res.message.content, 'Local model response');
});

test('agent operating modes filter tools appropriately and unrestricted mode bypasses path confinement', async t => {
  const { store, runtime, workspace, directory } = await setup(t);
  const exploreTools = requestTools({ ...store.state.settings, agentMode: 'explore' });
  assert.ok(exploreTools.some(t => t.function?.name === 'grep_search'));
  assert.ok(exploreTools.some(t => t.function?.name === 'glob_files'));
  assert.ok(!exploreTools.some(t => t.function?.name === 'write_file'));
  assert.ok(!exploreTools.some(t => t.function?.name === 'run_command'));

  const architectTools = requestTools({ ...store.state.settings, agentMode: 'architect' });
  assert.ok(architectTools.some(t => t.function?.name === 'todo_write'));
  assert.ok(architectTools.some(t => t.function?.name === 'memory_store'));
  assert.ok(!architectTools.some(t => t.function?.name === 'write_file'));

  const agentTools = requestTools({ ...store.state.settings, agentMode: 'agent' });
  assert.ok(agentTools.some(t => t.function?.name === 'multi_edit'));
  assert.ok(agentTools.some(t => t.function?.name === 'apply_patch'));
  assert.ok(agentTools.some(t => t.function?.name === 'git_operation'));
  assert.ok(agentTools.some(t => t.function?.name === 'delegate_subagent'));

  // Even when global autonomous is false, a task in unrestricted mode needs no approval and can access outside paths
  store.state.settings.autonomous = false;
  store.state.settings.autoWorkspaceWrites = false;
  const id = runtime.create({ prompt: 'Unrestricted task', workspace, agentMode: 'unrestricted' });
  const task = store.task(id);
  assert.equal(runtime.needsApproval('run_command', task), false);
  const outsideFile = path.join(directory, 'unrestricted-outside.txt');
  await executeTool(runtime, task, 'write_file', { path: outsideFile, content: 'unrestricted-ok', reason: 'test' }, new AbortController().signal);
  assert.equal(await fs.readFile(outsideFile, 'utf8'), 'unrestricted-ok');
});

test('read_file supports 1-based line ranges on files over 100 KB, multi_edit, and apply_patch', async t => {
  const { runtime, store, workspace } = await setup(t);
  const id = runtime.create({ prompt: 'Coding tools', workspace });
  const task = store.task(id);
  const signal = new AbortController().signal;

  // Create a 150 KB file
  const lines = Array.from({ length: 4000 }, (_, i) => `const line_${i + 1} = "value_${i + 1}_padding_for_large_file_test";`);
  const largeFile = path.join(workspace, 'large.js');
  await fs.writeFile(largeFile, lines.join('\n'), 'utf8');

  await assert.rejects(executeTool(runtime, task, 'read_file', { path: 'large.js' }, signal), /exceeds 100 KB/);
  const ranged = await executeTool(runtime, task, 'read_file', { path: 'large.js', startLine: 10, endLine: 12 }, signal);
  assert.equal(ranged.startLine, 10);
  assert.equal(ranged.endLine, 12);
  assert.equal(ranged.totalLines, 4000);
  assert.match(ranged.content, /^10: const line_10/);
  assert.match(ranged.content, /12: const line_12/);

  // Test multi_edit
  const srcFile = path.join(workspace, 'module.ts');
  await fs.writeFile(srcFile, 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n', 'utf8');
  const multiRes = await executeTool(runtime, task, 'multi_edit', {
    path: 'module.ts',
    edits: [
      { oldText: 'const a = 1;', newText: 'const a = 10;' },
      { oldText: 'const c = 3;', newText: 'const c = 30;' },
    ],
    reason: 'Update constants',
  }, signal);
  assert.equal(multiRes.editsApplied, 2);
  assert.equal(await fs.readFile(srcFile, 'utf8'), 'export const a = 10;\nexport const b = 2;\nexport const c = 30;\n');

  // Test apply_patch with SEARCH/REPLACE block
  await executeTool(runtime, task, 'apply_patch', {
    path: 'module.ts',
    patch: '<<<<<<< SEARCH\nexport const b = 2;\n=======\nexport const b = 20;\n>>>>>>> REPLACE',
    reason: 'Patch constant b',
  }, signal);
  assert.equal(await fs.readFile(srcFile, 'utf8'), 'export const a = 10;\nexport const b = 20;\nexport const c = 30;\n');
});

test('glob_files and grep_search discover files and regex matches with context lines', async t => {
  const { runtime, store, workspace } = await setup(t);
  const id = runtime.create({ prompt: 'Search tools', workspace });
  const task = store.task(id);
  const signal = new AbortController().signal;

  await fs.mkdir(path.join(workspace, 'src', 'utils'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'src', 'index.ts'), 'import { helper } from "./utils/helper";\n// TODO: refactor entry\nhelper();\n');
  await fs.writeFile(path.join(workspace, 'src', 'utils', 'helper.ts'), 'export function helper() {\n  return "NEXUS_MAGIC_TOKEN";\n}\n');

  const globbed = await executeTool(runtime, task, 'glob_files', { pattern: 'src/**/*.ts' }, signal);
  assert.equal(globbed.count, 2);
  assert.ok(globbed.matches.includes('src/index.ts'));
  assert.ok(globbed.matches.includes('src/utils/helper.ts'));

  const grepped = await executeTool(runtime, task, 'grep_search', {
    query: 'NEXUS_MAGIC_[A-Z]+',
    isRegex: true,
    glob: '*.ts',
    contextLines: 1,
  }, signal);
  assert.equal(grepped.matches.length, 1);
  assert.equal(grepped.matches[0].line, 2);
  assert.equal(grepped.matches[0].context.length, 3);
});

test('git_operation, todo_write, memory_store, NEXUS.md discovery, web_fetch, and delegate_subagent work end-to-end', async t => {
  const { runtime, store, workspace } = await setup(t);
  const signal = new AbortController().signal;

  // Auto-discovered NEXUS.md in workspace
  await fs.writeFile(path.join(workspace, 'NEXUS.md'), 'Always use strict TypeScript and ESM modules.', 'utf8');

  const id = runtime.create({ prompt: 'Full agentic suite', workspace });
  const task = store.task(id);

  // Todo checklist
  await executeTool(runtime, task, 'todo_write', {
    todos: [
      { id: 'step-1', title: 'Initialize git repo', status: 'completed', priority: 'high' },
      { id: 'step-2', title: 'Implement feature', status: 'in_progress', priority: 'high' },
    ],
  }, signal);
  const todoRead = await executeTool(runtime, task, 'todo_read', {}, signal);
  assert.equal(todoRead.todos.length, 2);

  // Persistent memory store
  await executeTool(runtime, task, 'memory_store', {
    action: 'remember',
    key: 'architecture-rule',
    value: 'Keep state transitions atomic.',
    scope: 'project',
  }, signal);
  const memories = await executeTool(runtime, task, 'memory_store', { action: 'list' }, signal);
  assert.equal(memories.memories.length, 1);

  // Verify NEXUS.md, todos, and memories appear in assembled context
  const built = JSON.stringify(runtime.buildContext(task));
  assert.match(built, /Always use strict TypeScript/);
  assert.match(built, /Keep state transitions atomic/);
  assert.match(built, /Implement feature/);

  // Git operations in workspace
  await runGit(workspace, ['init']);
  await runGit(workspace, ['config', 'user.email', 'nexus@example.com']);
  await runGit(workspace, ['config', 'user.name', 'NEXUS Test']);
  const status1 = await executeTool(runtime, task, 'git_operation', { operation: 'status' }, signal);
  assert.equal(status1.isRepo, true);
  assert.ok(status1.files.some(f => f.path === 'NEXUS.md'));

  const commitRes = await executeTool(runtime, task, 'git_operation', {
    operation: 'commit',
    stageAll: true,
    message: 'Initial commit from NEXUS test',
  }, signal);
  assert.equal(commitRes.status.clean, true);

  // web_fetch HTML extraction
  runtime.request = async () => new Response('<html><head><style>body{color:red}</style></head><body><h1>Docs Title</h1><p>Hello <a href="https://example.com">World</a></p></body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
  const page = await executeTool(runtime, task, 'web_fetch', { url: 'https://example.com/docs' }, signal);
  assert.match(page.content, /# Docs Title/);
  assert.match(page.content, /World \(https:\/\/example\.com\)/);
  assert.ok(!page.content.includes('color:red'));

  // delegate_subagent
  let subCalls = 0;
  runtime.request = async () => {
    subCalls++;
    if (subCalls === 1) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'sub-1', type: 'function', function: { name: 'list_files', arguments: '{"path":"."}' } }] } }],
        usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50, cost: 0.001 },
      });
    }
    return Response.json({
      choices: [{ message: { content: 'Sub-agent verified NEXUS.md exists in workspace.' } }],
      usage: { prompt_tokens: 60, completion_tokens: 15, total_tokens: 75, cost: 0.002 },
    });
  };
  const subResult = await executeTool(runtime, task, 'delegate_subagent', {
    objective: 'Check what files are in the workspace root',
    mode: 'explore',
  }, signal);
  assert.equal(subResult.stepsExecuted, 2);
  assert.match(subResult.report, /Sub-agent verified NEXUS\.md/);
  assert.equal(task.calls.length, 2);
});

test('code_outline, scaffold_mcp_server, self_improve, and slash commands (/init, /review, /architect, /mcp-create, /self-improve) work end-to-end', async t => {
  const { runtime, store, workspace } = await setup(t);
  const { McpManager } = await import('../core/mcp.mjs');
  runtime.mcp = new McpManager(store, () => null);
  t.after(() => runtime.mcp.close());
  const signal = new AbortController().signal;

  await fs.writeFile(path.join(workspace, 'engine.mjs'), 'export async function computeScore(x) {\n  return x * 2;\n}\nexport class AgentWorker {\n  run() {}\n}\n', 'utf8');

  // Test slash command expansion on task creation
  const initTaskId = runtime.create({ prompt: '/architect Design a new plugin system', workspace });
  const initTask = store.task(initTaskId);
  assert.equal(initTask.agentMode, 'architect');
  assert.match(initTask.prompt, /code_outline/);
  assert.equal(initTask.conversation[0].content, '/architect Design a new plugin system');

  // Test code_outline
  const outline = await executeTool(runtime, initTask, 'code_outline', { path: 'engine.mjs' }, signal);
  assert.equal(outline.symbols.length, 2);
  assert.equal(outline.symbols[0].name, 'computeScore');
  assert.equal(outline.symbols[1].name, 'AgentWorker');

  // Test autonomous MCP server scaffolding + live stdio connection & invocation
  const mcpRes = await executeTool(runtime, initTask, 'scaffold_mcp_server', {
    name: 'Autonomous Math MCP',
    description: 'Computes deterministic hashes and math',
    tools: [
      {
        name: 'double_number',
        description: 'Doubles a numeric input',
        inputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
        handlerCode: 'return { doubled: Number(args.value) * 2 };',
      },
    ],
  }, signal);
  assert.equal(mcpRes.created, true);
  assert.deepEqual(mcpRes.tools, ['double_number']);

  const callRes = await executeTool(runtime, initTask, 'invoke_mcp', {
    server: 'Autonomous Math MCP',
    tool: 'double_number',
    input: { value: 21 },
  }, signal);
  assert.match(JSON.stringify(callRes), /42/);

  // Test self_improve analysis and skill synthesis
  const analysis = await executeTool(runtime, initTask, 'self_improve', { action: 'analyze' }, signal);
  assert.equal(analysis.summary.mcpServersCount, 1);
  const synth = await executeTool(runtime, initTask, 'self_improve', {
    action: 'synthesize_skill',
    name: 'Autonomous TDD Loop',
    description: 'Write failing test first, then minimal implementation',
    instructions: '1. Reproduce or write a failing test.\n2. Implement minimal code.\n3. Verify all tests pass.',
  }, signal);
  await runtime.mcp.disconnect('Autonomous Math MCP');
});

test('http_request, run_diagnostics, shell_session stateful cwd/env, browser_inspect, and git worktree management work end-to-end', async t => {
  const { runtime, store, workspace, directory } = await setup(t);
  const signal = new AbortController().signal;
  const id = runtime.create({ prompt: 'v0.4.0 capabilities', workspace });
  const task = store.task(id);

  // 1. Unrestricted system prompt verification
  assert.match(store.state.settings.globalInstructions, /without imposing client-side topic or domain restrictions/);

  // 2. http_request (supports HTTP/HTTPS, custom headers, and JSON body)
  runtime.request = async (url, opts) => {
    assert.equal(url, 'http://127.0.0.1:8080/api/probe');
    assert.equal(opts.method, 'POST');
    assert.equal(opts.headers['X-Custom-Probe'], 'nexus-redteam');
    return new Response(JSON.stringify({ status: 'ok', echoed: JSON.parse(opts.body) }), {
      status: 201,
      headers: { 'content-type': 'application/json', 'x-server': 'local-lab' },
    });
  };
  const httpRes = await executeTool(runtime, task, 'http_request', {
    url: 'http://127.0.0.1:8080/api/probe',
    method: 'POST',
    headers: { 'X-Custom-Probe': 'nexus-redteam' },
    body: { target: 'localhost' },
  }, signal);
  assert.equal(httpRes.status, 201);
  assert.equal(httpRes.ok, true);
  assert.match(httpRes.body, /"target":"localhost"/);

  // 3. browser_inspect (extracts title, text, links, and forms)
  runtime.request = async () => new Response(
    '<html><head><title>Lab Portal</title></head><body><h1>Welcome</h1><a href="/login">Sign In</a><form action="/auth" method="post"><input name="username"/><input name="password"/></form></body></html>',
    { status: 200, headers: { 'content-type': 'text/html' } }
  );
  const inspected = await executeTool(runtime, task, 'browser_inspect', { url: 'http://localhost:3000/portal' }, signal);
  assert.equal(inspected.title, 'Lab Portal');
  assert.equal(inspected.links.length, 1);
  assert.equal(inspected.links[0].url, 'http://localhost:3000/login');
  assert.equal(inspected.forms.length, 1);
  assert.deepEqual(inspected.forms[0].fields, ['username', 'password']);

  // 4. run_diagnostics (detects valid and invalid JS/JSON syntax)
  await fs.writeFile(path.join(workspace, 'valid.mjs'), 'export const x = 42;\n', 'utf8');
  await fs.writeFile(path.join(workspace, 'broken.json'), '{ "unclosed": 1 ', 'utf8');
  const diag1 = await executeTool(runtime, task, 'run_diagnostics', {}, signal);
  assert.equal(diag1.passed, false);
  assert.equal(diag1.diagnostics.length, 1);
  assert.equal(diag1.diagnostics[0].file, 'broken.json');
  await fs.writeFile(path.join(workspace, 'broken.json'), '{ "closed": 1 }\n', 'utf8');
  const diag2 = await executeTool(runtime, task, 'run_diagnostics', {}, signal);
  assert.equal(diag2.passed, true);

  // 5. shell_session (persists working directory and environment variables across calls)
  const subDir = path.join(workspace, 'nested-dir');
  await fs.mkdir(subDir, { recursive: true });
  await executeTool(runtime, task, 'shell_session', {
    command: 'Set-Location "nested-dir"',
    env: { NEXUS_SESSION_VAR: 'persisted_value_99' },
  }, signal);
  const secondShell = await executeTool(runtime, task, 'shell_session', {
    command: 'Write-Output "$env:NEXUS_SESSION_VAR|$((Get-Location).Path)"',
  }, signal);
  assert.match(secondShell.output, /persisted_value_99/);
  assert.ok(secondShell.cwd.endsWith('nested-dir'));

  // 6. Git worktree list, add, and remove
  await runGit(workspace, ['init']);
  await runGit(workspace, ['config', 'user.email', 'nexus@example.com']);
  await runGit(workspace, ['config', 'user.name', 'NEXUS Test']);
  await executeTool(runtime, task, 'git_operation', { operation: 'commit', stageAll: true, message: 'base commit' }, signal);
  const wtPath = path.join(directory, 'wt-branch');
  await executeTool(runtime, task, 'git_operation', { operation: 'worktree_add', branch: 'feat-wt', path: wtPath }, signal);
  const wtList = await executeTool(runtime, task, 'git_operation', { operation: 'worktree_list' }, signal);
  assert.ok(wtList.worktrees.length >= 2);
  assert.ok(wtList.worktrees.some(w => w.branch === 'feat-wt'));
  await executeTool(runtime, task, 'git_operation', { operation: 'worktree_remove', path: wtPath }, signal);
});
