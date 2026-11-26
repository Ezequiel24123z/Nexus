// Opt-in provider regression probe (Zero Electron): no desktop, user-chat changes, or tool execution.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const directory = require('../core/datadir.cjs').resolveDataDirectory();
const report = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'nexus-arli-transport.jsonl'));
const log = value => fs.appendFileSync(report, JSON.stringify(value) + '\n');

(async () => {
  try {
    const { SecretVault } = await import('../core/vault.mjs');
    const key = new SecretVault(directory).get('ARLIAI_API_KEY');
    if (!key) throw new Error('No saved Arli key');
    const { completionRequest, providerCatalog } = await import('../core/providers.mjs');
    const { requestTools } = await import('../core/model-request.mjs');
    const { readCompletionStream } = await import('../core/stream.mjs');
    const catalog = await providerCatalog('arliai');
    log({ kind: 'availability', models: catalog.filter(m => /DeepSeek-V4.1-Flash-1017|GLM-4.6-Derestricted-v5/.test(m.id)).map(m => ({ id: m.id, available: m.available })) });
    const response = await fetch('https://api.arliai.com/v1/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) });
    const models = await response.json();
    log({ kind: 'account', http: response.status, models: (models.data || []).filter(m => /GLM-4.6-Derestricted-v5|DeepSeek-V4.1-Flash-1017/.test(m.id)).map(m => ({ id: m.id, context: m.context_length || m.max_context || m.context_window })) });
    const probes = [
      ['GLM-4.6-Derestricted-v5', false, false, 'none'],
      ['DeepSeek-V4.1-Flash-1017', false, false, 'none'],
      ['GLM-4.6-Derestricted-v5', true, true, 'xhigh'],
    ];
    for (const [model, withTools, streaming, reasoningEffort] of (process.argv.includes('--stream-only') ? probes.slice(-1) : probes)) {
      const settings = { model: 'arliai/' + model, streaming, reasoningEffort, providerRouting: 'auto', webSearchEnabled: false, desktopEnabled: true };
      const spec = completionRequest({ model: settings.model, messages: [{ role: 'user', content: 'Reply only NEXUS_OK. Do not use any tools.' }], settings, tools: withTools ? requestTools(settings) : undefined, outputLimit: 8192 });
      const start = Date.now();
      try {
        const r = await fetch(spec.connection.base + '/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, ...spec.headers }, body: JSON.stringify(spec.body), signal: AbortSignal.timeout(60000) });
        if (!r.ok) { const d = await r.json().catch(() => ({})); const message = String(d.error?.message || d.message || d.detail || '').replaceAll(key, '[redacted]').slice(0, 400); log({ model, withTools, streaming, http: r.status, error: message }); continue; }
        const d = r.headers.get('content-type')?.includes('text/event-stream') ? await readCompletionStream(r) : await r.json();
        log({ model, withTools, streaming, http: r.status, elapsedMs: Date.now() - start, hasReply: Boolean(d.choices?.[0]?.message?.content), toolCalls: d.choices?.[0]?.message?.tool_calls?.length || 0, messageKeys: Object.keys(d.choices?.[0]?.message || {}), usage: d.usage, finish: d.choices?.[0]?.finish_reason });
      } catch (e) { log({ model, withTools, streaming, elapsedMs: Date.now() - start, error: e.message, code: e.cause?.code, cause: e.cause?.message, errors: e.cause?.errors?.map(err => ({ code: err.code, message: err.message })) }); }
    }
  } catch (e) { log({ fatal: e.message }); process.exitCode = 1; }
})();
