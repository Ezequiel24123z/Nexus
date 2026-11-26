import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../core/store.mjs';
import { Runtime, assessActionRisk, reasoningToText } from '../core/runtime.mjs';
import { completionRequest, resolveCopilotAuth, clearCopilotTokenCache } from '../core/providers.mjs';
import { readCompletionStream, readAnthropicStream } from '../core/stream.mjs';
import { executeTool } from '../core/tools.mjs';
import { ConfigFileManager } from '../core/config-file.mjs';
import { createNexusServer } from '../core/server.mjs';
import { materializeToolResult, readArtifact } from '../core/artifacts.mjs';
import { AutomationsManager, matchesCron, isAutomationDue, validateAutomation } from '../core/automations.mjs';
import { SecretVault } from '../core/vault.mjs';
import { InteractiveTerminalManager } from '../core/pty-shell.mjs';
import { resolveEffectiveProxyUrl, proxiedFetch } from '../core/privacy-proxy.mjs';
import { TorManager } from '../core/tor-manager.mjs';
import net from 'node:net';
import http from 'node:http';
import { classifyModel } from '../src/lib/model-catalog.mjs';
import { parseSkillMarkdown, normalizeGithubRawUrl, discoverWorkspaceSkills, searchGithubSkills } from '../core/plugins.mjs';
import { CURATED_NATIVE_PLUGINS } from '../core/gallery.mjs';
import { requestTools } from '../core/model-request.mjs';
import { StatefulShellManager, searchWebDuckDuckGo, scaffoldMcpServer, executeGitOperation, runCodeDiagnostics } from '../core/coding-engine.mjs';
import { advanceProgressiveStream } from '../src/stream-display.mjs';

async function setup(t, request) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-nextgen-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(path.join(dir, 'data'));
  const workspace = path.join(dir, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  const secrets = {
    ANTHROPIC_API_KEY: 'sk-ant-test-key',
    OPENAI_API_KEY: 'sk-oa-test-key',
    OPENROUTER_API_KEY: 'sk-or-test-key',
    GITHUB_COPILOT_TOKEN: 'gho_test_oauth_token',
    PROVIDER_MYVLLM_KEY: 'vllm-secret',
  };
  const runtime = new Runtime(store, {
    getSecret: name => secrets[name] || null,
    request: request || (async () => Response.json({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })),
  });
  runtime.closed = true;
  t.after(() => { runtime.shutdown(); store.close(); });
  return { dir, store, runtime, workspace, secrets };
}

test('Anthropic Direct uses native /v1/messages, x-api-key, system blocks, tool_use/tool_result, and SSE streaming', async t => {
  const seen = [];
  const { store, runtime, workspace } = await setup(t, async (url, opts) => {
    const body = JSON.parse(opts.body);
    seen.push({ url, headers: opts.headers, body });
    if (seen.length === 1) {
      const events = [
        { type: 'message_start', message: { id: 'msg_1', model: 'claude-sonnet-4-5', usage: { input_tokens: 120, cache_read_input_tokens: 40 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Checking workspace files.' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'list_files' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"."}' } },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 25 } },
        { type: 'message_stop' },
      ];
      const streamText = events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
      return new Response(streamText, { headers: { 'content-type': 'text/event-stream' } });
    }
    return Response.json({
      id: 'msg_2',
      model: 'claude-sonnet-4-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Anthropic native round-trip succeeded.' }],
      usage: { input_tokens: 150, output_tokens: 18 },
    });
  });

  await fs.writeFile(path.join(workspace, 'hello.txt'), 'world', 'utf8');
  store.state.settings.model = 'anthropic/claude-sonnet-4-5';
  store.state.settings.reasoningEffort = 'low';
  const id = runtime.create({ prompt: 'Inspect directory', workspace });
  const task = store.task(id);
  await runtime.run(task, new AbortController().signal);

  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen[0].headers['x-api-key'], 'sk-ant-test-key');
  assert.equal(seen[0].headers['Authorization'], undefined);
  assert.equal(seen[0].headers['anthropic-version'], '2023-06-01');
  assert.ok(Array.isArray(seen[0].body.system) && seen[0].body.system[0].cache_control?.type === 'ephemeral');
  assert.ok(seen[0].body.thinking?.type === 'enabled');
  assert.ok(seen[0].body.tools.some(tool => tool.name === 'list_files' && tool.input_schema));
  assert.equal(seen[1].body.messages.at(-1).content[0].type, 'tool_result');
  assert.equal(task.status, 'complete');
  assert.match(task.result, /Anthropic native round-trip succeeded/);
  assert.equal(task.calls[0].cached, 40);
  // First assistant message kept structured toolRuns for inline UI cards
  assert.ok(task.conversation.some(m => Array.isArray(m.toolRuns) && m.toolRuns[0].name === 'list_files' && m.toolRuns[0].status === 'done'));
});

test('GitHub Copilot exchanges OAuth token and caches short-lived session token', async () => {
  clearCopilotTokenCache();
  let calls = 0;
  const mockFetch = async (url, opts) => {
    calls++;
    assert.equal(url, 'https://api.github.com/copilot_internal/v2/token');
    assert.equal(opts.headers.Authorization, 'token gho_abc123');
    return Response.json({
      token: 'tid=session123;exp=9999999999',
      expires_at: Math.floor(Date.now() / 1000) + 1800,
      endpoints: { api: 'https://api.individual.githubcopilot.com' },
    });
  };
  const first = await resolveCopilotAuth('gho_abc123', { request: mockFetch });
  const second = await resolveCopilotAuth('gho_abc123', { request: mockFetch });
  assert.equal(calls, 1);
  assert.equal(first.token, 'tid=session123;exp=9999999999');
  assert.equal(first.base, 'https://api.individual.githubcopilot.com');
  assert.deepEqual(first, second);
  clearCopilotTokenCache();
});

test('OpenAI-compatible stream parses plain delta.reasoning_content for DeepSeek R1 / local reasoning models', async () => {
  const frames = [
    { choices: [{ delta: { reasoning_content: 'Step 1: check config. ' } }] },
    { choices: [{ delta: { reasoning_content: 'Step 2: answer.' } }] },
    { choices: [{ delta: { content: 'Final answer.' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ];
  const sse = frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n';
  let observedReasoning = '';
  const result = await readCompletionStream(new Response(sse, { headers: { 'content-type': 'text/event-stream' } }), {
    onReasoning: text => { observedReasoning = text; },
  });
  assert.equal(observedReasoning, 'Step 1: check config. Step 2: answer.');
  assert.equal(result.choices[0].message.content, 'Final answer.');
});

test('custom provider profiles, custom parameters, and extraBody/extraHeaders merge cleanly into payloads', () => {
  const settings = {
    streaming: true,
    temperature: 0.35,
    topP: 0.9,
    seed: 42,
    extraBody: { min_p: 0.05 },
    extraHeaders: { 'X-Lab-Mode': 'full' },
    customProviders: [
      { id: 'myvllm', name: 'My vLLM', baseUrl: 'http://127.0.0.1:8000/v1', apiFormat: 'openai', keyName: 'PROVIDER_MYVLLM_KEY', optionalKey: true },
    ],
  };
  const spec = completionRequest({ model: 'myvllm/qwen3-coder', messages: [{ role: 'user', content: 'Hi' }], settings, apiKey: 'vllm-secret' });
  assert.equal(spec.url, 'http://127.0.0.1:8000/v1/chat/completions');
  assert.equal(spec.body.model, 'qwen3-coder');
  assert.equal(spec.body.temperature, 0.35);
  assert.equal(spec.body.top_p, 0.9);
  assert.equal(spec.body.seed, 42);
  assert.equal(spec.body.min_p, 0.05);
  assert.equal(spec.headers['X-Lab-Mode'], 'full');
  assert.equal(spec.headers.Authorization, 'Bearer vllm-secret');
});

test('resume() expands built-in and custom slash commands, and unrestricted tools work without a bound workspace', async t => {
  const { store, runtime } = await setup(t);
  runtime.settings({
    customCommands: [{ command: '/ship', description: 'Ship release', template: 'Prepare release notes for {{args}}', mode: 'agent' }],
  });
  const id = runtime.create({ prompt: 'Initial chat' });
  const task = store.task(id);
  task.status = 'complete';
  runtime.resume(id, '/ship v1.0.0');
  assert.match(task.messages.at(-1).content, /Prepare release notes for v1\.0\.0/);

  // Unrestricted tool execution without workspace folder
  const listRes = await executeTool(runtime, task, 'list_files', { path: '.' }, new AbortController().signal);
  assert.ok(Array.isArray(listRes));
});

test('apply_patch creates new files from unified diff and revertFileChange rolls back edits cleanly', async t => {
  const { store, runtime, workspace } = await setup(t);
  const id = runtime.create({ prompt: 'Patch & revert', workspace });
  const task = store.task(id);
  const signal = new AbortController().signal;

  // Create new file via unified diff
  await executeTool(runtime, task, 'apply_patch', {
    path: 'brand-new.txt',
    patch: '@@ -0,0 +1,2 @@\n+line one\n+line two',
    reason: 'Create new file',
  }, signal);
  assert.equal(await fs.readFile(path.join(workspace, 'brand-new.txt'), 'utf8'), 'line one\nline two');

  // Edit existing file then revert using automatic backup
  await executeTool(runtime, task, 'write_file', {
    path: 'brand-new.txt',
    content: 'modified content',
    reason: 'Overwrite test',
  }, signal);
  assert.equal(await fs.readFile(path.join(workspace, 'brand-new.txt'), 'utf8'), 'modified content');
  const changeEvent = task.events.findLast(e => e.kind === 'file_change');
  const reverted = await runtime.revertFileChange(id, changeEvent.id);
  assert.equal(reverted.reverted, true);
  assert.equal(await fs.readFile(path.join(workspace, 'brand-new.txt'), 'utf8'), 'line one\nline two');
});

test('parallel read-only tools execute concurrently and sub-agents do not corrupt parent liveText', async t => {
  let step = 0;
  const { store, runtime, workspace } = await setup(t, async () => {
    step++;
    if (step === 1) {
      return Response.json({
        choices: [{
          message: {
            content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
              { id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.txt"}' } },
            ],
          },
        }],
      });
    }
    return Response.json({ choices: [{ message: { content: 'Read both files cleanly.' } }] });
  });
  await fs.writeFile(path.join(workspace, 'a.txt'), 'AAA', 'utf8');
  await fs.writeFile(path.join(workspace, 'b.txt'), 'BBB', 'utf8');
  const id = runtime.create({ prompt: 'Read a and b', workspace });
  const task = store.task(id);
  await runtime.run(task, new AbortController().signal);
  assert.equal(task.status, 'complete');
  assert.equal(task.messages.filter(m => m.role === 'tool').length, 2);

  // Sub-agent isolation check
  task.liveText = 'PARENT_LIVE_TEXT';
  const beforeConv = task.conversation.length;
  runtime.request = async () => Response.json({ choices: [{ message: { content: 'Sub-agent summary.' } }] });
  const sub = await runtime.runSubagent(task, { objective: 'Check something', mode: 'explore' }, new AbortController().signal);
  assert.equal(sub.report, 'Sub-agent summary.');
  assert.equal(task.liveText, 'PARENT_LIVE_TEXT');
  assert.equal(task.conversation.length, beforeConv);
});

test('chat lifecycle: forkTask, editMessageAndResend, regenerate, deleteTask, and nexus.config.json', async t => {
  const { dir, store, runtime } = await setup(t);
  const cfg = new ConfigFileManager(path.join(dir, 'data'), runtime);
  t.after(() => cfg.close());
  cfg.applyRawJson(JSON.stringify({ temperature: 0.7, disabledTools: ['desktop_action'], customCss: '.test{}' }));
  assert.equal(store.state.settings.temperature, 0.7);
  assert.deepEqual(store.state.settings.disabledTools, ['desktop_action']);

  const id = runtime.create({ prompt: 'Hello world' });
  const task = store.task(id);
  await runtime.run(task, new AbortController().signal);
  assert.equal(task.conversation.length, 2);

  const forkedId = runtime.forkTask(id, task.conversation[0].id);
  assert.equal(store.task(forkedId).conversation.length, 1);

  runtime.editMessageAndResend(id, task.conversation[0].id, 'Edited prompt');
  assert.equal(task.conversation[0].content, 'Edited prompt');
  assert.equal(task.status, 'queued');

  task.status = 'complete';
  task.conversation.push({ id: 'a1', role: 'assistant', content: 'Old answer' });
  task.messages.push({ role: 'assistant', content: 'Old answer' });
  runtime.regenerate(id);
  assert.equal(task.conversation.at(-1).role, 'user');

  const del = runtime.deleteTask(forkedId);
  assert.equal(del.deleted, true);
  assert.throws(() => store.task(forkedId), /Task not found/);
});

test('standalone HTTP/SSE core server handles invoke, Arena workspace, direct file save, and auth token', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-http-'));
  const ws = path.join(dir, 'ws');
  await fs.mkdir(ws, { recursive: true });
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const srv = await createNexusServer({ dataDir: dir, port: 0, token: 'test-token-123' });
  t.after(() => srv.close());

  // Health check works without token
  const health = await fetch(srv.url + '/api/health').then(r => r.json());
  assert.equal(health.ok, true);

  // Missing token rejected
  const unauth = await fetch(srv.url + '/api/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'snapshot' }),
  });
  assert.equal(unauth.status, 401);

  // Valid invoke works
  const inv = (method, args = {}) => fetch(srv.url + '/api/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Nexus-Token': 'test-token-123' },
    body: JSON.stringify({ method, args }),
  }).then(r => r.json());

  const writeRes = await inv('writeFileDirect', { workspace: ws, path: 'demo.js', content: 'export const ok = true;\n' });
  assert.equal(writeRes.ok, true);
  const readRes = await inv('readFile', { workspace: ws, path: 'demo.js' });
  assert.equal(readRes.result, 'export const ok = true;\n');

  // Arena passes workspace cleanly
  const arena = await inv('createArena', { prompt: 'Compare two models', models: ['openai/gpt-5', 'anthropic/claude-sonnet-4-5'], workspace: ws });
  assert.equal(arena.ok, true);
  assert.equal(arena.result.ids.length, 2);
  assert.equal(srv.store.task(arena.result.ids[0]).workspace, ws);
});

test('autonomy levels (interactive, semi-autopilot, autopilot, unrestricted) enforce risk-aware approvals', async t => {
  const { store, runtime, workspace } = await setup(t);

  // Interactive prompts on normal writes, not on reads
  const intTask = store.task(runtime.create({ prompt: 'Interactive', workspace, agentMode: 'interactive' }));
  assert.equal(runtime.needsApproval('read_file', intTask, { path: 'a.txt' }), false);
  assert.equal(runtime.needsApproval('write_file', intTask, { path: 'a.txt' }), true);

  // Semi-autopilot allows normal workspace edits & safe commands, flags destructive/external actions
  const semiTask = store.task(runtime.create({ prompt: 'Semi', workspace, agentMode: 'semi-autopilot' }));
  assert.equal(runtime.needsApproval('write_file', semiTask, { path: 'src/app.js' }), false);
  assert.equal(runtime.needsApproval('run_command', semiTask, { command: 'npm test' }), false);
  assert.equal(runtime.needsApproval('run_command', semiTask, { command: 'Remove-Item -Recurse -Force .' }), true);
  assert.equal(runtime.needsApproval('delete_file', semiTask, { path: 'src/app.js' }), true);
  assert.equal(runtime.needsApproval('git_operation', semiTask, { operation: 'push' }), true);
  assert.equal(runtime.needsApproval('git_operation', semiTask, { operation: 'status' }), false);
  assert.equal(assessActionRisk('write_file', { path: 'C:\\Windows\\outside.txt' }, semiTask).risky, true);

  // Autopilot & Unrestricted run without prompts
  const autoTask = store.task(runtime.create({ prompt: 'Auto', workspace, agentMode: 'autopilot' }));
  assert.equal(runtime.needsApproval('run_command', autoTask, { command: 'Remove-Item x' }), false);
  const unrTask = store.task(runtime.create({ prompt: 'Unrestricted', workspace, agentMode: 'unrestricted' }));
  assert.equal(runtime.needsApproval('desktop_action', unrTask, { action: 'click', x: 1, y: 1 }), false);
});

test('read_artifact is never re-wrapped into nested artifacts and new tools (dir_tree, batch_read_files, delete_file, move_file, web_search) work end-to-end', async t => {
  const { store, runtime, workspace } = await setup(t);
  const signal = new AbortController().signal;
  const id = runtime.create({ prompt: 'Tools v1.1', workspace });
  const task = store.task(id);

  // 1. read_artifact never re-materializes even if > 12KB
  const bigSlice = { id: '11111111-1111-4111-8111-111111111111', content: 'A'.repeat(18000) };
  const mat = await materializeToolResult(store, task, 'read_artifact', bigSlice);
  assert.equal(mat.artifact, null);
  assert.ok(mat.model.includes('A'.repeat(1000)));

  // 2. dir_tree & batch_read_files
  await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'src', 'one.js'), 'line1\nline2\n', 'utf8');
  await fs.writeFile(path.join(workspace, 'src', 'two.js'), 'alpha\nbeta\n', 'utf8');
  const tree = await executeTool(runtime, task, 'dir_tree', { path: '.', maxDepth: 3 }, signal);
  assert.match(tree.tree, /src\//);
  assert.match(tree.tree, /one\.js/);

  const batch = await executeTool(runtime, task, 'batch_read_files', {
    files: [{ path: 'src/one.js', startLine: 1, endLine: 2 }, { path: 'src/two.js' }],
  }, signal);
  assert.equal(batch.count, 2);
  assert.match(batch.files[0].content, /1: line1/);
  assert.match(batch.files[1].content, /alpha/);

  // 3. write_file returns inline unified diff, move_file renames, delete_file deletes with backup & revert restores it
  const writeRes = await executeTool(runtime, task, 'write_file', { path: 'src/one.js', content: 'line1\nline2-edited\n', reason: 'Update line2' }, signal);
  assert.equal(writeRes.addedLines, 1);
  assert.equal(writeRes.removedLines, 1);
  assert.match(writeRes.diff, /\+line2-edited/);

  const moveRes = await executeTool(runtime, task, 'move_file', { from: 'src/two.js', to: 'src/two-renamed.js', reason: 'Rename' }, signal);
  assert.equal(moveRes.moved, true);
  assert.equal(await fs.readFile(path.join(workspace, 'src', 'two-renamed.js'), 'utf8'), 'alpha\nbeta\n');

  const delRes = await executeTool(runtime, task, 'delete_file', { path: 'src/two-renamed.js', reason: 'Remove temp' }, signal);
  assert.equal(delRes.deleted, 'src/two-renamed.js');
  await assert.rejects(fs.stat(path.join(workspace, 'src', 'two-renamed.js')));
  const delEvent = task.events.findLast(e => e.kind === 'file_change');
  await runtime.revertFileChange(id, delEvent.id);
  assert.equal(await fs.readFile(path.join(workspace, 'src', 'two-renamed.js'), 'utf8'), 'alpha\nbeta\n');

  // 4. Provider-agnostic web_search parses HTML search results cleanly
  runtime.request = async () => new Response(
    '<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fguide">NEXUS Guide</a><a class="result__snippet">Complete standalone docs</a>',
    { status: 200, headers: { 'content-type': 'text/html' } }
  );
  const search = await executeTool(runtime, task, 'web_search', { query: 'nexus guide', maxResults: 5 }, signal);
  assert.equal(search.count, 1);
  assert.equal(search.results[0].url, 'https://example.org/guide');
  assert.equal(search.results[0].title, 'NEXUS Guide');
});

test('AutomationsManager cron matcher, interval scheduling, manage_automation tool, and per-chat contextWindow/providerOrder work', async t => {
  const { store, runtime, workspace } = await setup(t);
  const automations = new AutomationsManager(store, runtime);
  runtime.automations = automations;

  // Cron matching
  const monday930 = new Date(2026, 10, 23, 9, 30, 0); // Monday Nov 23 2026 09:30
  assert.equal(matchesCron('30 9 * * 1-5', monday930), true);
  assert.equal(matchesCron('0 9 * * 1-5', monday930), false);
  assert.equal(matchesCron('*/15 9-17 * * *', monday930), true);

  // Create & run via manage_automation tool
  const taskId = runtime.create({ prompt: 'Setup automation', workspace });
  const created = await executeTool(runtime, store.task(taskId), 'manage_automation', {
    action: 'create',
    name: 'Hourly Health Check',
    prompt: 'Check status',
    scheduleType: 'interval',
    everyMinutes: 60,
  }, new AbortController().signal);
  assert.equal(created.name, 'Hourly Health Check');
  assert.equal(isAutomationDue(created, new Date()), true);

  const triggered = automations.runNow(created.id);
  assert.ok(triggered.taskId);
  assert.equal(created.runCount, 1);

  // Per-chat contextWindow & OpenRouter providerOrder
  runtime.updateChat({ id: taskId, contextWindow: 128000, providerOrder: ['DeepInfra', 'Together'] });
  const eff = runtime.effectiveSettings(store.task(taskId));
  assert.equal(eff.contextWindow, 128000);
  assert.deepEqual(eff.providerOrder, ['DeepInfra', 'Together']);
  const spec = completionRequest({ model: 'deepseek/deepseek-v4.1-flash', messages: [{ role: 'user', content: 'Hi' }], settings: eff });
  assert.deepEqual(spec.body.provider.order, ['DeepInfra', 'Together']);
});

test('InteractiveTerminalManager runs live PowerShell stdin/stdout and privacy/model classification work cleanly', async t => {
  const terms = new InteractiveTerminalManager();
  t.after(() => terms.closeAll());
  const session = terms.create({ cwd: process.cwd() });
  assert.equal(session.status, 'running');
  let output = '';
  terms.on('data', evt => { if (evt.id === session.id) output += evt.chunk; });
  terms.write(session.id, 'Write-Output "NEXUS_TERM_ALIVE_42"\r\n');
  for (let i = 0; i < 40 && !output.includes('NEXUS_TERM_ALIVE_42'); i++) {
    await new Promise(r => setTimeout(r, 150));
  }
  assert.match(output, /NEXUS_TERM_ALIVE_42/);
  terms.close(session.id);

  // Privacy proxy resolution
  assert.equal(resolveEffectiveProxyUrl({ browserProxyMode: 'direct' }), '');
  assert.equal(resolveEffectiveProxyUrl({ browserProxyMode: 'tor' }), 'socks5://127.0.0.1:9050');
  assert.equal(resolveEffectiveProxyUrl({ browserProxyMode: 'socks5', browserProxyUrl: 'socks5://127.0.0.1:1080' }), 'socks5://127.0.0.1:1080');

  // Model freedom & capability classification
  const ds = classifyModel({ id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', context: 128000, pricing: { prompt: '0.0000002' } });
  const glm = classifyModel({ id: 'z-ai/glm-4.6', name: 'GLM 4.6', context: 202752 });
  const arli = classifyModel({ id: 'arliai/GLM-4.6-Derestricted-v5', name: 'Arli GLM', context: 202752 });
  const claude = classifyModel({ id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', context: 200000 });
  assert.equal(arli.freedom, 'unrestricted');
  assert.equal(ds.freedom, 'minimal');
  assert.equal(glm.freedom, 'low');
  assert.equal(claude.freedom, 'standard');
  assert.ok(arli.freedomRank < ds.freedomRank && ds.freedomRank < glm.freedomRank && glm.freedomRank < claude.freedomRank);
  assert.ok(ds.caps.has('coding') && ds.caps.has('budget'));
});

test('Wave 3: Nested sessions orchestration, inter-session messaging, auto-handoff, dynamic JS plugins, and SKILL.md discovery/gallery', async t => {
  const { store, runtime, workspace } = await setup(t);
  await runtime.plugins.ready;
  const signal = new AbortController().signal;

  // 1. Open-standard SKILL.md parser & GitHub URL normalization & workspace discovery
  const parsed = parseSkillMarkdown(`---\nname: turbo-debug\ndescription: Fast triage\ntags: [debug, perf]\n---\n# Turbo Debug\nAlways bisect first.`);
  assert.equal(parsed.name, 'turbo-debug');
  assert.equal(parsed.description, 'Fast triage');
  assert.deepEqual(parsed.tags, ['debug', 'perf']);
  assert.match(parsed.instructions, /Always bisect first/);
  assert.equal(
    normalizeGithubRawUrl('https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md'),
    'https://raw.githubusercontent.com/obra/superpowers/main/skills/systematic-debugging/SKILL.md'
  );
  const skillDir = path.join(workspace, '.nexus', 'skills', 'repo-local-skill');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: repo-local-skill\ndescription: Local repo instructions\n---\nFollow local conventions.', 'utf8');
  const discovered = discoverWorkspaceSkills(workspace);
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].name, 'repo-local-skill');

  // 2. Dynamic hot-loaded JS tool creation (self-evolution) & native plugin execution
  const parentId = runtime.create({ prompt: 'Orchestrate work', workspace });
  const parent = store.task(parentId);
  const builtCtx = runtime.buildContext(parent, { hydrate: false, inspect: true });
  assert.ok(builtCtx.sections.some(s => s.id === 'project-skills'));

  const createdTool = await executeTool(runtime, parent, 'create_dynamic_tool', {
    name: 'reverse_upper',
    description: 'Reverse and uppercase text',
    readOnly: true,
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    handlerCode: 'return { out: String(args.text).split("").reverse().join("").toUpperCase() };',
  }, signal);
  assert.equal(createdTool.created, true);
  const dynRes = await executeTool(runtime, parent, 'reverse_upper', { text: 'nexus' }, signal);
  assert.equal(dynRes.out, 'SUXEN');

  // Install & run curated native Dev Swiss Army plugin
  const cryptoSpec = CURATED_NATIVE_PLUGINS.find(p => p.id === 'nexus-dev-swiss-army');
  await runtime.plugins.installPlugin({ ...cryptoSpec });
  const hashRes = await executeTool(runtime, parent, 'dev_hash', { text: 'hello', algorithm: 'sha256' }, signal);
  assert.equal(hashRes.hex, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');

  // 3. Nested sessions: spawn_session, list_sessions, send_session_message, read_session
  const spawned = await executeTool(runtime, parent, 'spawn_session', {
    title: 'Child Audit Worker',
    prompt: 'Audit module A',
    notifyParentOnIdle: true,
  }, signal);
  assert.ok(spawned.sessionId);
  const child = store.task(spawned.sessionId);
  assert.equal(child.parentTaskId, parent.id);
  assert.equal(child.workspace, workspace);

  const tree = await executeTool(runtime, parent, 'list_sessions', { scope: 'tree' }, signal);
  assert.ok(tree.sessions.some(s => s.id === child.id && s.relation === 'child'));

  const sent = await executeTool(runtime, parent, 'send_session_message', {
    sessionId: child.id,
    message: 'Focus specifically on streaming edge cases.',
  }, signal);
  assert.equal(sent.delivered, true);
  assert.ok(child.conversation.some(m => m.content.includes('Focus specifically on streaming edge cases.')));

  const readRes = await executeTool(runtime, parent, 'read_session', { sessionId: child.id, wait: false }, signal);
  assert.equal(readRes.sessionId, child.id);
  assert.equal(readRes.parentTaskId, parent.id);

  // 4. Gallery HTTP RPCs
  const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-gallery-'));
  t.after(() => fs.rm(dir2, { recursive: true, force: true }));
  const srv = await createNexusServer({ dataDir: dir2, port: 0, token: 'gal-tok' });
  t.after(() => srv.close());
  const inv = (method, args = {}) => fetch(srv.url + '/api/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Nexus-Token': 'gal-tok' },
    body: JSON.stringify({ method, args }),
  }).then(r => r.json());

  const cat = await inv('galleryCatalog');
  assert.equal(cat.ok, true);
  assert.ok(cat.result.skills.length >= 12);
  assert.ok(cat.result.nativePlugins.length >= 4);
  assert.ok(cat.result.mcpPlugins.length >= 9);

  const instSkill = await inv('galleryInstallSkill', { id: 'systematic-debugging' });
  assert.equal(instSkill.ok, true);
  assert.equal(instSkill.result.installed, true);

  const instPlugin = await inv('galleryInstallPlugin', { id: 'nexus-dev-swiss-army' });
  assert.equal(instPlugin.ok, true);
  assert.equal(instPlugin.result.kind, 'native');
  assert.ok(instPlugin.result.plugin.toolNames.includes('dev_jwt_decode'));
});

test('nested child session executes concurrently in the same workspace as an active waiting parent (no deadlock)', async t => {
  const { store, runtime, workspace } = await setup(t);
  await runtime.plugins.ready;
  store.state.settings.concurrency = 1; // Stress-test lowest concurrency setting!
  let childResolved = false;
  runtime.request = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const sys = body.messages?.[0]?.content || '';
    if (sys.includes('CHILD_WORKER_MARKER')) {
      childResolved = true;
      return Response.json({ choices: [{ message: { content: 'CHILD_RESULT_42' } }] });
    }
    return Response.json({ choices: [{ message: { content: 'PARENT_OK' } }] });
  };
  const parentId = runtime.create({ prompt: 'Parent task', workspace });
  const parent = store.task(parentId);
  // Simulate parent actively running and occupying the workspace + concurrency slot
  const fakeParentCtrl = new AbortController();
  runtime.active.set(parentId, fakeParentCtrl);
  parent.status = 'running';
  runtime.closed = false;
  t.after(() => { runtime.active.delete(parentId); runtime.closed = true; });

  const spawned = runtime.spawnChildSession(parent, { title: 'Child', prompt: 'CHILD_WORKER_MARKER run now', notifyParentOnIdle: false });
  const result = await runtime.readSession({ sessionId: spawned.sessionId, wait: true, timeoutSeconds: 5 }, fakeParentCtrl.signal);
  assert.equal(childResolved, true);
  assert.equal(result.status, 'complete');
  assert.equal(result.result, 'CHILD_RESULT_42');
});

test('Wave 4: Lazy toolset loading (load_toolset) cuts tool schema tokens by >50% and activates groups on demand', async t => {
  const { store, runtime, workspace } = await setup(t);
  await runtime.plugins.ready;
  const cryptoSpec = CURATED_NATIVE_PLUGINS.find(p => p.id === 'nexus-dev-swiss-army');
  await runtime.plugins.installPlugin({ ...cryptoSpec });

  const fullTools = requestTools({ ...store.state.settings, lazyToolLoading: false }, runtime.plugins, []);
  const lazyTools = requestTools({ ...store.state.settings, lazyToolLoading: true }, runtime.plugins, []);
  assert.ok(lazyTools.some(x => x.function.name === 'load_toolset'));
  assert.ok(!fullTools.some(x => x.function.name === 'load_toolset'));
  assert.ok(lazyTools.length < fullTools.length * 0.5, `Expected <50% tool count in lazy mode, got ${lazyTools.length}/${fullTools.length}`);
  const fullBytes = JSON.stringify(fullTools).length;
  const lazyBytes = JSON.stringify(lazyTools).length;
  assert.ok(lazyBytes < fullBytes * 0.55, `Expected >45% schema byte savings, got ${lazyBytes}/${fullBytes}`);

  const id = runtime.create({ prompt: 'Lazy test', workspace });
  const task = store.task(id);
  const res = await executeTool(runtime, task, 'load_toolset', { toolsets: ['git', 'plugins'] }, new AbortController().signal);
  assert.ok(res.activatedTools.includes('git_operation'));
  assert.ok(res.activatedTools.includes('dev_hash'));
  const expanded = requestTools({ ...store.state.settings, lazyToolLoading: true }, runtime.plugins, task.loadedToolsets);
  assert.ok(expanded.some(x => x.function.name === 'git_operation'));
  assert.ok(expanded.some(x => x.function.name === 'dev_hash'));
});

test('Wave 4: Explicit prompt caching breakpoints for Anthropic Direct, OpenRouter Claude/Gemini, and OpenAI cache key', () => {
  const msgs = [
    { role: 'system', content: 'S'.repeat(400) },
    { role: 'user', content: 'First prompt ' + 'A'.repeat(300) },
    { role: 'assistant', content: 'First answer' },
    { role: 'user', content: 'Second prompt ' + 'B'.repeat(300) },
  ];
  const tools = requestTools({ model: 'anthropic/claude-sonnet-4-5', lazyToolLoading: true });
  // Anthropic Direct: system + last tool + penultimate turn all have ephemeral cache_control
  const ant = completionRequest({ model: 'anthropic/claude-sonnet-4-5', messages: msgs, settings: { promptCaching: true, streaming: true }, tools });
  assert.equal(ant.body.system.at(-1).cache_control?.type, 'ephemeral');
  assert.equal(ant.body.tools.at(-1).cache_control?.type, 'ephemeral');
  assert.equal(ant.body.messages.at(-2).content.at(-1).cache_control?.type, 'ephemeral');

  // OpenRouter Claude: system & penultimate message get cache_control
  const orClaude = completionRequest({ model: 'openrouter/anthropic/claude-sonnet-4-5', messages: msgs, settings: { promptCaching: true, streaming: true }, sessionId: 'sess-1' });
  assert.equal(orClaude.body.messages[0].content[0].cache_control?.type, 'ephemeral');
  assert.equal(orClaude.body.session_id, 'sess-1');

  // OpenAI Direct: prompt_cache_key sent when sessionId provided
  const oa = completionRequest({ model: 'openai/gpt-5', messages: msgs, settings: { promptCaching: true, streaming: true }, sessionId: 'oa-key-1' });
  assert.equal(oa.body.prompt_cache_key, 'oa-key-1');
});

test('Wave 4: Compaction boundary safety, Stage 1 zero-cost micro-compaction, multimodal dedup, and Semi-Autopilot allow/deny rules', async t => {
  const { store, runtime, workspace } = await setup(t);
  const id = runtime.create({ prompt: 'Compaction audit', workspace });
  const task = store.task(id);

  // 1. compactionTail NEVER archives 0 messages when history starts with an assistant+tool group
  const tricky = [
    { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'tc1', content: 'X'.repeat(4000) },
  ];
  const split = runtime.compactionTail(task, tricky);
  assert.equal(split.archived.length, 2);
  assert.equal(split.tail.length, 0);

  // 2. Stage 1 zero-cost micro-compaction prunes old oversized tool outputs into lossless artifacts
  task.messages = [
    { role: 'user', content: 'Start' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'old-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"big.txt"}' } }] },
    { role: 'tool', tool_call_id: 'old-1', content: 'BIG_PAYLOAD_ORIGINAL_999 '.repeat(120) },
    { role: 'assistant', content: 'Step 1 done' },
    { role: 'user', content: 'Step 2' },
    { role: 'assistant', content: 'Step 2 done' },
    { role: 'user', content: 'Step 3' },
    { role: 'assistant', content: 'Step 3 done' },
    { role: 'user', content: 'Step 4' },
    { role: 'assistant', content: 'Recent' },
  ];
  const micro = await runtime.microCompactTask(task, { keepRecent: 6, minChars: 500 });
  assert.equal(micro.prunedCount, 1);
  assert.ok(micro.estimatedTokensFreed > 500);
  const prunedMsg = task.messages[2].content;
  assert.match(prunedMsg, /Micro-compacted earlier read_file output/);
  const artId = /artifact ([a-f0-9-]{36})/.exec(prunedMsg)?.[1];
  assert.ok(artId);
  const recovered = await readArtifact(store, task, artId, 0, 500);
  assert.match(recovered.content, /BIG_PAYLOAD_ORIGINAL_999/);

  // 3. Multimodal user turn is NOT duplicated after compaction
  task.summary = 'Compacted summary state';
  task.conversation.push({ id: 'u-att', role: 'user', content: 'Inspect image', attachments: [] });
  task.messages = [{ role: 'user', content: [{ type: 'text', text: 'Inspect image' }, { type: 'nexus_attachment', attachment: { id: '11111111-1111-4111-8111-111111111111', kind: 'image', mime: 'image/png', name: 'a.png' } }] }];
  const ctx = runtime.buildContext(task, { hydrate: false, inspect: true });
  assert.ok(!ctx.sections.some(s => s.id === 'latest'), 'Multimodal latest user message should not be duplicated');

  // 4. Semi-Autopilot granular allow/deny rules + precedence
  const customSettings = {
    semiAutoAllowRules: ['delete_file', 'run_command:Remove-Item temp'],
    semiAutoDenyRules: ['run_command:docker', '/prod-db/i'],
  };
  assert.equal(assessActionRisk('delete_file', { path: 'a.txt' }, task, customSettings).risky, false);
  assert.equal(assessActionRisk('run_command', { command: 'Remove-Item temp.log' }, task, customSettings).risky, false);
  assert.equal(assessActionRisk('run_command', { command: 'docker ps' }, task, customSettings).risky, true);
  assert.equal(assessActionRisk('delete_file', { path: 'prod-db.sqlite' }, task, customSettings).risky, true); // Deny beats Allow!

  // 5. GitHub SKILL.md live cloud search parser
  const skillsFound = await searchGithubSkills('debug', {
    request: async url => {
      if (url.includes('obra/superpowers')) {
        return Response.json({ tree: [{ type: 'blob', path: 'skills/systematic-debugging/SKILL.md' }, { type: 'blob', path: 'README.md' }] });
      }
      return Response.json({ tree: [], items: [] });
    },
  });
  assert.equal(skillsFound.length, 1);
  assert.equal(skillsFound[0].repo, 'obra/superpowers');
  assert.match(skillsFound[0].rawUrl, /raw\.githubusercontent\.com\/obra\/superpowers\/main\/skills\/systematic-debugging\/SKILL\.md/);
});

test('Wave 5: OpenRouter reasoning.text streams & persists to conversation while keeping encrypted reasoning hidden and outbound scrubbed', async t => {
  // 1. readCompletionStream emits reasoning.text live while excluding reasoning.encrypted
  let streamedReasoning = '';
  const frames = [
    { choices: [{ delta: { reasoning_details: [{ index: 0, type: 'reasoning.text', text: 'Step 1 thought: ' }] } }] },
    { choices: [{ delta: { reasoning_details: [{ index: 0, type: 'reasoning.text', text: 'check billing.mjs.' }] } }] },
    { choices: [{ delta: { reasoning_details: [{ index: 1, type: 'reasoning.encrypted', data: 'ENCRYPTED_BLOB_XYZ' }] } }] },
    { choices: [{ delta: { content: 'Visible answer.' }, finish_reason: 'stop' }] },
  ];
  const sse = frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n';
  const parsed = await readCompletionStream(new Response(sse, { headers: { 'content-type': 'text/event-stream' } }), {
    onReasoning: txt => { streamedReasoning = txt; },
  });
  assert.equal(streamedReasoning, 'Step 1 thought: check billing.mjs.');
  assert.ok(!streamedReasoning.includes('ENCRYPTED_BLOB_XYZ'));
  assert.equal(reasoningToText(parsed.choices[0].message.reasoning_details), 'Step 1 thought: check billing.mjs.');

  // 2. Runtime stores readable reasoning on conversation step, yet scrubMessages never resends reasoning_details to LLM
  const { store, runtime, workspace } = await setup(t, async () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }));
  const id = runtime.create({ prompt: 'Think out loud', workspace });
  const task = store.task(id);
  await runtime.run(task, new AbortController().signal);
  assert.equal(task.conversation.at(-1).reasoning, 'Step 1 thought: check billing.mjs.');
  assert.ok(!JSON.stringify(runtime.buildContext(task)).includes('Step 1 thought'));
});

test('Wave 5: Testbench fixes (shell_session env persistence, web_search Bing fallback, scaffold_mcp_server validation, git checkout_new, repeated-error breaker)', async t => {
  const { store, runtime, workspace } = await setup(t);
  const signal = new AbortController().signal;

  // 1. StatefulShellManager persists BOTH cwd and env vars mutated inside commands
  const shells = new StatefulShellManager();
  const cmd1 = process.platform === 'win32' ? '$env:NEXUS_PERSIST_TOKEN = "HELLO_987"' : 'export NEXUS_PERSIST_TOKEN="HELLO_987"';
  const cmd2 = process.platform === 'win32' ? 'Write-Output $env:NEXUS_PERSIST_TOKEN' : 'echo "$NEXUS_PERSIST_TOKEN"';
  await shells.exec('s1', cmd1, { defaultCwd: workspace });
  const r2 = await shells.exec('s1', cmd2, { defaultCwd: workspace });
  assert.match(r2.output, /HELLO_987/);

  // 2. web_search falls back cleanly to Bing RSS XML when DuckDuckGo returns HTTP 202 anti-bot
  const searchRes = await searchWebDuckDuckGo('nexus test', {
    request: async url => {
      if (url.includes('duckduckgo.com')) return new Response('<html>bot challenge</html>', { status: 202 });
      return new Response('<rss><channel><item><title>NEXUS Docs</title><link>https://example.org/nexus</link><description>Native Windows IDE</description></item></channel></rss>', { status: 200 });
    },
  });
  assert.equal(searchRes.engine, 'bing-rss');
  assert.equal(searchRes.count, 1);
  assert.equal(searchRes.results[0].url, 'https://example.org/nexus');

  // 3. scaffold_mcp_server rejects SyntaxError immediately instead of registering broken server
  await assert.rejects(
    scaffoldMcpServer(store, null, {
      name: 'broken-mcp',
      tools: [{ name: 'bad', description: 'bad syntax', handlerCode: 'const x = {{{;' }],
    }),
    /failed syntax check/
  );
  // Valid handler using sync fs.existsSync succeeds because hybrid fs exposes both promises & sync methods
  const okMcp = await scaffoldMcpServer(store, null, {
    name: 'good-mcp',
    tools: [{ name: 'check_dir', description: 'checks dir', handlerCode: 'return { exists: fs.existsSync(os.tmpdir()) };' }],
  });
  assert.equal(okMcp.created, true);

  // 4. git_operation checkout_new creates a new branch reliably
  const repoDir = path.join(workspace, 'git-test');
  await fs.mkdir(repoDir, { recursive: true });
  await shells.exec('g', 'git init; git config user.email "t@t.local"; git config user.name "Test"; Set-Content a.txt "hi"; git add .; git commit -m "init"', { defaultCwd: repoDir });
  const co = await executeGitOperation(repoDir, { operation: 'checkout_new', branch: 'feat-wave5' }, signal);
  assert.equal(co.created, true);
  assert.equal(co.status.branch, 'feat-wave5');

  // 5. Repeated identical tool error circuit breaker emits loopWarning on 3rd consecutive failure
  const taskId = runtime.create({ prompt: 'Breaker test', workspace });
  const task = store.task(taskId);
  const badCall = { id: 'c1', function: { name: 'read_file', arguments: JSON.stringify({ path: 'missing-never-exists.txt' }) } };
  const e1 = JSON.parse((await runtime.executeSingleToolCall(task, badCall, signal, { status: 'running' })).serialized);
  const e2 = JSON.parse((await runtime.executeSingleToolCall(task, badCall, signal, { status: 'running' })).serialized);
  const e3 = JSON.parse((await runtime.executeSingleToolCall(task, badCall, signal, { status: 'running' })).serialized);
  assert.equal(e1.loopWarning, undefined);
  assert.equal(e2.loopWarning, undefined);
  assert.match(e3.loopWarning, /3 times in a row/);
});

test('Wave 6: Progressive 60fps streaming reveal, invokeConnector query expansion, BOM diagnostics, and desktop screenshot hydration cap', async t => {
  // 1. Progressive streaming never snaps short 20-char bursts in a single 16ms frame and never splits emoji
  const target = 'Streaming smoothly 🚀 across frames!';
  const carry = { current: 0 };
  let shown = '';
  let frames = 0;
  while (shown !== target && frames < 60) {
    shown = advanceProgressiveStream(shown, target, 16.67, false, carry);
    assert.ok(!/[\uD800-\uDBFF]$/.test(shown), 'Never split UTF-16 surrogate pair');
    frames++;
  }
  assert.equal(shown, target);
  assert.ok(frames >= 4, `Expected multi-frame progressive glide, got ${frames} frames`);
  assert.equal(advanceProgressiveStream('', target, 16.67, true), target);

  // 2. invokeConnector expands input.query object cleanly instead of ?query=[object Object]
  let capturedUrl = '';
  const { store, runtime, workspace } = await setup(t, async url => {
    capturedUrl = String(url);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  store.state.connectors.push({ name: 'test-get', url: 'https://example.org/api?base=1', method: 'GET', description: 'GET test' });
  await runtime.invokeConnector({ name: 'test-get', input: { query: { extra: 'hello', page: 2 }, tag: 'v6' } }, new AbortController().signal);
  assert.match(capturedUrl, /base=1/);
  assert.match(capturedUrl, /extra=hello/);
  assert.match(capturedUrl, /page=2/);
  assert.match(capturedUrl, /tag=v6/);
  assert.ok(!capturedUrl.includes('object+Object'));

  // 3. runCodeDiagnostics tolerates UTF-8 BOM on valid JSON with a warning (passed: true)
  await fs.writeFile(path.join(workspace, 'bom.json'), '\uFEFF{"ok": true}\n', 'utf8');
  const diag = await runCodeDiagnostics(workspace, 'bom.json');
  assert.equal(diag.passed, true);
  assert.equal(diag.diagnostics.length, 1);
  assert.equal(diag.diagnostics[0].severity, 'warning');
  assert.match(diag.diagnostics[0].message, /UTF-8 BOM/);

  // 4. Desktop screenshot hydration caps hydrated base64 images to latest 2 while keeping older ones as lightweight pointers
  const taskId = runtime.create({ prompt: 'Desktop multi-shot', workspace });
  const task = store.task(taskId);
  const attDir = path.join(store.directoryFor(taskId), 'attachments');
  await fs.mkdir(attDir, { recursive: true });
  for (let i = 1; i <= 4; i++) {
    const aid = `00000000-0000-4000-8000-00000000000${i}`;
    await fs.writeFile(path.join(attDir, `${aid}.jpg`), Buffer.from('FAKEJPG' + i));
    task.messages.push({
      role: 'user',
      content: [
        { type: 'text', text: `Shot ${i}` },
        { type: 'nexus_attachment', attachment: { id: aid, name: 'desktop-screenshot', kind: 'image', mime: 'image/jpeg' } },
      ],
    });
  }
  const built = runtime.buildContext(task, { hydrate: true });
  const hydratedImgs = built.flatMap(m => Array.isArray(m.content) ? m.content.filter(p => p.type === 'image_url') : []);
  const placeholderTexts = built.flatMap(m => Array.isArray(m.content) ? m.content.filter(p => p.type === 'text' && p.text.includes('Earlier desktop screenshot')) : []);
  assert.equal(hydratedImgs.length, 2);
  assert.equal(placeholderTexts.length, 2);
});

test('Wave 7: TorManager + app-scoped SOCKS5 proxy tunnel, silentToolSteps, git_operation guard, hybrid fs dynamic tools, manage_automation modes, search_files paths', async t => {
  const { dir, store, runtime, workspace } = await setup(t);
  await runtime.plugins.ready;
  const signal = new AbortController().signal;

  // 1. TorManager lifecycle & resolveEffectiveProxyUrl('managed-tor')
  const tor = new TorManager(path.join(dir, 'tor-home'));
  assert.equal(tor.status().installed, false);
  assert.equal(tor.status().socksPort, 9055);
  assert.equal(resolveEffectiveProxyUrl({ browserProxyMode: 'managed-tor' }, tor), 'socks5://127.0.0.1:9055');

  // 2. End-to-end RFC 1928 SOCKS5 proxy tunnel test against a local loopback target + mock SOCKS5 server (verifies app-scoped proxiedFetch without touching Windows proxy)
  const targetHttp = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url, via: 'loopback-target' }));
  });
  await new Promise(r => targetHttp.listen(0, '127.0.0.1', r));
  t.after(() => targetHttp.close());
  const targetPort = targetHttp.address().port;

  let socksConnections = 0;
  const mockSocks = net.createServer(client => {
    socksConnections++;
    let stage = 0;
    client.on('data', chunk => {
      if (stage === 0) {
        stage = 1;
        client.write(Buffer.from([0x05, 0x00]));
      } else if (stage === 1) {
        stage = 2;
        const atyp = chunk[3];
        let host = '127.0.0.1', portOffset = 8;
        if (atyp === 0x03) {
          const len = chunk[4];
          host = chunk.subarray(5, 5 + len).toString('utf8');
          portOffset = 5 + len;
        }
        const port = chunk.readUInt16BE(portOffset);
        const upstream = net.connect({ host, port }, () => {
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.on('error', () => client.destroy());
      }
    });
  });
  await new Promise(r => mockSocks.listen(0, '127.0.0.1', r));
  t.after(() => mockSocks.close());
  const socksPort = mockSocks.address().port;

  const proxiedRes = await proxiedFetch(`http://127.0.0.1:${targetPort}/nexus-proxy-check`, {}, `socks5://127.0.0.1:${socksPort}`);
  assert.equal(proxiedRes.status, 200);
  const proxiedJson = await proxiedRes.json();
  assert.equal(proxiedJson.ok, true);
  assert.equal(proxiedJson.path, '/nexus-proxy-check');
  assert.equal(socksConnections, 1);

  // 3. silentToolSteps setting injects silent chaining directive into system context
  runtime.settings({ silentToolSteps: true, browserPersistentProfile: true });
  assert.equal(store.state.settings.silentToolSteps, true);
  assert.equal(store.state.settings.browserPersistentProfile, true);
  const t1 = store.task(runtime.create({ prompt: 'Do work quietly', workspace }));
  const sysPrompt = runtime.buildContext(t1, { hydrate: false })[0].content;
  assert.match(sysPrompt, /SILENT TOOL CHAINING/);

  // 4. git_operation guard: mutating op WITHOUT task.workspace AND WITHOUT args.cwd is blocked
  const noWsTask = store.task(runtime.create({ prompt: 'No ws', workspace: '', agentMode: 'unrestricted' }));
  await assert.rejects(
    executeTool(runtime, noWsTask, 'git_operation', { operation: 'checkout_new', branch: 'accidental-branch' }, signal),
    /requires an explicit "cwd" path/
  );

  // 5. create_dynamic_tool hybrid fs supports fs.existsSync directly without throwing
  await executeTool(runtime, t1, 'create_dynamic_tool', {
    name: 'hybrid_fs_probe',
    description: 'Uses fs.existsSync directly',
    readOnly: true,
    parameters: { type: 'object', properties: { p: { type: 'string' } }, required: ['p'] },
    handlerCode: 'return { exists: fs.existsSync(args.p) };',
  }, signal);
  const probe = await executeTool(runtime, t1, 'hybrid_fs_probe', { p: workspace }, signal);
  assert.equal(probe.exists, true);

  // 6. manage_automation accepts unrestricted/autopilot/semi-autopilot + gives clear errors on missing fields
  const automations = new AutomationsManager(store, runtime);
  runtime.automations = automations;
  const createdAuto = await executeTool(runtime, t1, 'manage_automation', {
    action: 'create',
    name: 'Unrestricted Auto',
    prompt: 'Run check',
    scheduleType: 'once',
    runAt: '2027-12-31T23:59:00.000Z',
    agentMode: 'unrestricted',
    enabled: false,
  }, signal);
  assert.equal(createdAuto.agentMode, 'unrestricted');
  await assert.rejects(
    executeTool(runtime, t1, 'manage_automation', { action: 'toggle', enabled: true }, signal),
    /requires the automation "id"/
  );
  await assert.rejects(
    executeTool(runtime, t1, 'manage_automation', { action: 'create', agentMode: 'unrestricted' }, signal),
    /received keys: \[action, agentMode/
  );

  // 7. search_files returns clean relative paths (no ../../..) when searching an absolute folder outside workspace
  const externalDir = path.join(dir, 'external-search-root');
  await fs.mkdir(externalDir, { recursive: true });
  await fs.writeFile(path.join(externalDir, 'needle.txt'), 'FIND_ME_WAVE7\n', 'utf8');
  const sRes = await executeTool(runtime, t1, 'search_files', { query: 'FIND_ME_WAVE7', path: externalDir }, signal);
  assert.equal(sRes.matches.length, 1);
  assert.equal(sRes.matches[0].path, 'needle.txt');
});

test('Audit hardening: automations preserve midnight/Sunday zero values, Semi-Autopilot path risk, empty tool arguments, and pluginId sanitization', async t => {
  // 1. Midnight (hour: 0) and Sunday (weekday: 0) are preserved rather than coerced to defaults
  const dailyMidnight = validateAutomation({ name: 'Midnight Job', prompt: 'Check logs', scheduleType: 'daily', hour: 0, minute: 0 });
  assert.equal(dailyMidnight.hour, 0);
  assert.equal(dailyMidnight.minute, 0);
  const weeklySunday = validateAutomation({ name: 'Sunday Job', prompt: 'Weekly digest', scheduleType: 'weekly', weekday: 0, hour: 0, minute: 15 });
  assert.equal(weeklySunday.weekday, 0);
  assert.equal(weeklySunday.hour, 0);
  assert.equal(weeklySunday.minute, 15);

  // 2. Semi-Autopilot path containment catches nested traversal & forward-slash drive escapes while allowing in-workspace absolute paths
  const ws = path.resolve(os.tmpdir(), 'nexus-ws-check');
  assert.equal(assessActionRisk('write_file', { path: 'sub/../../outside.txt' }, { workspace: ws }).risky, true);
  assert.equal(assessActionRisk('write_file', { path: path.join(ws, 'nested', 'ok.js') }, { workspace: ws }).risky, false);
  assert.equal(assessActionRisk('write_file', { path: path.resolve(ws, '..', 'other', 'bad.js') }, { workspace: ws }).risky, true);

  // 3. Parameterless tool calls emitting empty arguments string ("") succeed without JSON.parse error
  let step = 0;
  const { store, runtime, workspace, dir } = await setup(t, async () => {
    if (step++ === 0) {
      return Response.json({
        choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'empty_args_1', type: 'function', function: { name: 'todo_read', arguments: '' } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    }
    return Response.json({
      choices: [{ message: { role: 'assistant', content: 'Handled empty arguments cleanly.' } }],
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
    });
  });
  const taskId = runtime.create({ prompt: 'Read todos', workspace });
  const task = store.task(taskId);
  await runtime.run(task, new AbortController().signal);
  assert.equal(task.status, 'complete');
  assert.equal(task.events.some(e => e.kind === 'tool_error'), false);

  // 4. PluginManager sanitizes traversal pluginId so files never escape plugins/
  const created = await runtime.plugins.createSingleTool({
    name: 'safe_audit_tool',
    description: 'Audit sanitization test',
    readOnly: true,
    pluginId: '../../escape-attempt',
    handlerCode: 'return { ok: true };',
  });
  assert.ok(created && !created.id.includes('..') && !created.id.includes('/') && !created.id.includes('\\'));
  assert.equal((await fs.readdir(dir)).includes('escape-attempt'), false);
});

test('Audit hardening: server version sync, loopback-only CORS, malformed URL handling, workspace delete guard, and DPAPI vault rotation', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-audit-srv-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, 'data');
  const wsDir = path.join(dir, 'ws');
  const uiDir = path.join(dir, 'ui');
  await fs.mkdir(wsDir, { recursive: true });
  await fs.mkdir(uiDir, { recursive: true });
  await fs.writeFile(path.join(uiDir, 'index.html'), '<html>ok</html>', 'utf8');
  await fs.writeFile(path.join(wsDir, 'keep.txt'), 'safe', 'utf8');

  // 1. Server health version matches package.json & hostInfo, CORS rejects untrusted origins, malformed URL returns 400
  const srv = await createNexusServer({ dataDir, uiDir, port: 0 });
  t.after(() => srv.close());
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));

  const healthRes = await fetch(`${srv.url}/api/health`, { headers: { Origin: 'https://evil.example' } });
  const health = await healthRes.json();
  assert.equal(health.version, pkg.version);
  assert.equal(healthRes.headers.get('access-control-allow-origin'), null);

  const localRes = await fetch(`${srv.url}/api/health`, { headers: { Origin: srv.url } });
  assert.equal(localRes.headers.get('access-control-allow-origin'), srv.url);

  const hostInfo = await srv.invoke('hostInfo');
  assert.equal(hostInfo.version, pkg.version);

  const badUrlRes = await fetch(`${srv.url}/%E0%A4%A`);
  assert.equal(badUrlRes.status, 400);

  // 2. deleteFileOrDir blocks workspace root deletion and traversal escapes
  await assert.rejects(() => srv.invoke('deleteFileOrDir', { workspace: wsDir, path: '.' }), /workspace root/i);
  await assert.rejects(() => srv.invoke('deleteFileOrDir', { workspace: wsDir, path: '../data' }), /outside/i);
  assert.equal(await fs.readFile(path.join(wsDir, 'keep.txt'), 'utf8'), 'safe');

  // 3. SecretVault round-trips via stdin DPAPI, rotates backups to max 5, and clears deleted keys from vault.plain.json
  const vaultDir = path.join(dir, 'vault-test');
  const vault = new SecretVault(vaultDir);
  for (let i = 0; i < 8; i++) vault.set('TEST_ROTATE_KEY', 'secret-val-' + i);
  const backups = (await fs.readdir(vaultDir)).filter(n => /^vault-backup-.*\.dpapi$/i.test(n));
  assert.ok(backups.length <= 5, `Expected at most 5 backups, found ${backups.length}`);
  const reloaded = new SecretVault(vaultDir);
  assert.equal(reloaded.get('TEST_ROTATE_KEY'), 'secret-val-7');
  // Even if vault.plain.json existed, clearing a key prevents resurrection on reload
  await fs.writeFile(path.join(vaultDir, 'vault.plain.json'), JSON.stringify({ TEST_ROTATE_KEY: 'stale-plain' }), 'utf8');
  reloaded.set('TEST_ROTATE_KEY', '');
  const reloadedAgain = new SecretVault(vaultDir);
  assert.equal(reloadedAgain.get('TEST_ROTATE_KEY'), null);
});

test('v1.2.0 User Memory & Preference Profile: categories, priorities, pinning, search, context injection, and export/import', async t => {
  const { store, runtime, workspace } = await setup(t);
  const signal = new AbortController().signal;
  const taskId = runtime.create({ prompt: 'Build a module', workspace });
  const task = store.task(taskId);

  // memory_store is always available in CORE_TOOL_NAMES even when lazyToolLoading is enabled
  const lazyTools = requestTools({ ...store.state.settings, lazyToolLoading: true });
  assert.ok(lazyTools.some(tool => tool.function?.name === 'memory_store'));

  // Store structured user priorities, preferences, constraints, and project facts
  await executeTool(runtime, task, 'memory_store', {
    action: 'remember',
    key: 'Primary Goal',
    value: 'Focus on security and native Windows reliability first.',
    category: 'priority',
    priority: 'critical',
    pinned: true,
    tags: ['roadmap', 'security'],
  }, signal);
  await executeTool(runtime, task, 'memory_store', {
    action: 'remember',
    key: 'Coding Style',
    value: 'Prefer concise ESM modules without unnecessary abstractions.',
    category: 'preference',
    priority: 'high',
    tags: ['style'],
  }, signal);
  await executeTool(runtime, task, 'memory_store', {
    action: 'remember',
    key: 'Never Push Main Directly',
    value: 'Always open a pull request instead of pushing straight to main.',
    category: 'constraint',
    priority: 'critical',
  }, signal);
  await executeTool(runtime, task, 'memory_store', {
    action: 'remember',
    key: 'Project Port',
    value: 'Dev server runs on port 5173.',
    category: 'fact',
    priority: 'normal',
    scope: 'project',
  }, signal);

  // Search filters by query & category
  const prefMatches = await executeTool(runtime, task, 'memory_store', { action: 'search', query: 'ESM', category: 'preference' }, signal);
  assert.equal(prefMatches.count, 1);
  assert.equal(prefMatches.memories[0].key, 'Coding Style');
  assert.equal(prefMatches.memories[0].scope, 'global'); // user preferences default to global

  // Profile summary groups constraints -> priorities -> preferences -> facts
  const profile = await executeTool(runtime, task, 'memory_store', { action: 'profile' }, signal);
  assert.equal(profile.count, 4);
  assert.match(profile.formattedProfile, /### Hard Constraints & Boundaries/);
  assert.match(profile.formattedProfile, /### Active User Priorities & Goals/);
  assert.match(profile.formattedProfile, /### User Preferences & Working Style/);
  assert.ok(profile.formattedProfile.indexOf('Never Push Main Directly') < profile.formattedProfile.indexOf('Coding Style'));

  // Injected into runtime.buildContext()
  const sysContext = JSON.stringify(runtime.buildContext(task, { hydrate: false }));
  assert.match(sysContext, /Focus on security and native Windows reliability/);
  assert.match(sysContext, /Never Push Main Directly/);

  // Server RPCs: memoriesPreview, memoriesExport, memoriesImport
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-mem-srv-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const srv = await createNexusServer({ dataDir: dir, port: 0 });
  t.after(() => srv.close());
  await srv.invoke('memorySave', { key: 'Tone', value: 'Direct and concise Spanish replies.', category: 'preference', priority: 'high', pinned: true, tags: ['language'] });
  const preview = await srv.invoke('memoriesPreview', { workspace: '' });
  assert.equal(preview.count, 1);
  assert.match(preview.markdown, /\[PINNED · HIGH\] \*\*Tone\*\*/);
  const exported = await srv.invoke('memoriesExport');
  assert.match(exported.markdown, /NEXUS User Memory & Preference Profile/);
  const imported = await srv.invoke('memoriesImport', {
    json: JSON.stringify([{ key: 'Editor', value: 'Uses VS Code and PowerShell', category: 'profile', priority: 'normal' }]),
  });
  assert.equal(imported.imported, 1);
  assert.equal(imported.total, 2);
});

test('v1.2.0 Native WebView2 browser_inspect, realistic browser HTTP headers, and desktop UI Automation/window capture tools', async t => {
  const { store, runtime, workspace } = await setup(t);
  const signal = new AbortController().signal;
  const taskId = runtime.create({ prompt: 'Inspect web and desktop', workspace, agentMode: 'semi-autopilot' });
  const task = store.task(taskId);

  // 1. Realistic browser headers on web_fetch & static browser_inspect (no NEXUS-Agent leak) + custom UA override
  const seenHeaders = [];
  runtime.request = async (url, opts) => {
    seenHeaders.push(opts.headers);
    return new Response('<html><head><title>Dynamic Test</title></head><body><h1>Quotes</h1></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  };
  await executeTool(runtime, task, 'web_fetch', { url: 'https://example.test/page' }, signal);
  assert.match(seenHeaders[0]['User-Agent'], /Mozilla\/5\.0.*Chrome\/134/);
  assert.ok(!seenHeaders[0]['User-Agent'].includes('NEXUS-Agent'));
  assert.ok(seenHeaders[0]['Sec-CH-UA']);

  runtime.settings({ webUserAgent: 'CustomBrowserUA/9.0' });
  const staticInspect = await executeTool(runtime, task, 'browser_inspect', { url: 'https://example.test/static', renderJs: true }, signal);
  assert.equal(seenHeaders[1]['User-Agent'], 'CustomBrowserUA/9.0');
  assert.equal(staticInspect.renderedJs, false);
  assert.equal(staticInspect.engine, 'http-fetch');
  assert.match(staticInspect.renderJsNote, /JavaScript did not execute/);

  // 2. When native browserInspect callback is wired, renderJs & actions execute and preserve both text AND screenshot attachment
  let capturedOpts = null;
  runtime.browserInspect = async (url, opts) => {
    capturedOpts = { url, ...opts };
    return {
      url,
      title: 'JS Quotes Rendered',
      renderedJs: true,
      engine: 'webview2',
      text: 'The world as we have created it is a process of our thinking.',
      interactiveElements: [{ tag: 'a', text: 'Next', selector: 'li.next > a' }],
      actionsLog: [{ type: 'click', selector: 'li.next > a', result: { ok: true } }],
      image: 'data:image/png;base64,' + Buffer.from('fake-png-bytes').toString('base64'),
      dimensions: { physicalWidth: 1280, physicalHeight: 900, image: { width: 1280, height: 900 }, scaleFactor: 1 },
    };
  };

  // Semi-Autopilot gates interactive actions/account session, while passive browser_inspect stays auto-allowed
  assert.equal(runtime.approvalCheck('browser_inspect', task, { url: 'https://quotes.toscrape.com/js', renderJs: true }).required, false);
  assert.equal(runtime.approvalCheck('browser_inspect', task, { url: 'https://quotes.toscrape.com/js', actions: [{ type: 'click', selector: 'li.next > a' }] }).required, true);
  assert.equal(runtime.approvalCheck('browser_inspect', task, { url: 'https://mail.example', useAccountSession: true }).required, true);

  const singleRes = await runtime.executeSingleToolCall(
    task,
    { id: 'bi-1', function: { name: 'browser_inspect', arguments: JSON.stringify({ url: 'https://quotes.toscrape.com/js', renderJs: true, waitForSelector: '.quote', captureScreenshot: true }) } },
    signal,
    { id: 'run-1', status: 'running' }
  );
  assert.equal(capturedOpts.waitForSelector, '.quote');
  assert.equal(capturedOpts.captureScreenshot, true);
  const parsedToolPayload = JSON.parse(singleRes.serialized);
  assert.equal(parsedToolPayload.renderedJs, true);
  assert.equal(parsedToolPayload.capturedScreenshot, true);
  assert.match(parsedToolPayload.text, /process of our thinking/);
  assert.equal(task.pendingImages.length, 1);

  // 3. Desktop windows enumeration, UI Automation tree, window-scoped screenshot, and focus_window/drag actions
  const desktopCalls = [];
  runtime.desktop = async (name, args) => {
    desktopCalls.push({ name, args });
    if (name === 'desktop_windows') return { monitors: [{ index: 0, primary: true }], windows: [{ hwnd: 42, title: 'Notepad', processName: 'notepad' }] };
    if (name === 'desktop_ui_tree') return { window: { hwnd: 42, title: 'Notepad' }, count: 1, elements: [{ name: 'Save', controlType: 'Button', center: { x: 100, y: 50 } }] };
    if (name === 'desktop_screenshot') return { image: 'data:image/jpeg;base64,' + Buffer.from('jpg').toString('base64'), dimensions: { scope: 'window', windowTitle: args.windowTitle } };
    return { ok: true };
  };
  assert.equal(runtime.approvalCheck('desktop_windows', task, {}).required, false);
  assert.equal(runtime.approvalCheck('desktop_ui_tree', task, { windowTitle: 'Notepad' }).required, false);
  const winList = await executeTool(runtime, task, 'desktop_windows', {}, signal);
  assert.equal(winList.windows[0].title, 'Notepad');
  const uiTree = await executeTool(runtime, task, 'desktop_ui_tree', { windowTitle: 'Notepad' }, signal);
  assert.equal(uiTree.elements[0].center.x, 100);
  const winShot = await executeTool(runtime, task, 'desktop_screenshot', { windowTitle: 'Notepad' }, signal);
  assert.equal(winShot.dimensions.scope, 'window');
  await executeTool(runtime, task, 'desktop_action', { action: 'focus_window', windowTitle: 'Notepad' }, signal);
  await executeTool(runtime, task, 'desktop_action', { action: 'drag', x: 10, y: 10, toX: 80, toY: 80 }, signal);
  assert.equal(desktopCalls.length, 5);

  // 4. Session can be renamed anytime, even while actively running or with null/empty unchanged optional fields
  runtime.active.set(task.id, new AbortController());
  try {
    runtime.updateChat({ id: task.id, title: 'Renamed While Active', temperature: null, systemPromptOverride: '' });
    assert.equal(task.title, 'Renamed While Active');
  } finally {
    runtime.active.delete(task.id);
  }
});


