import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runLiveFromVault } = require('./run-live-from-vault.cjs');

function harness() {
  const child = new EventEmitter();
  const errors = [];
  let spawnArgs;
  const pending = runLiveFromVault({
    argv: ['test.mjs'],
    env: {},
    execPath: process.execPath,
    loadVault: async () => ({ get: name => (name === 'OPENROUTER_API_KEY' ? 'fake-test-key' : null) }),
    spawnFn: (...args) => { spawnArgs = args; return child; },
    logError: msg => errors.push(msg),
  });
  return { child, errors, pending, get spawnArgs() { return spawnArgs; } };
}

test('live runner does not report interrupted or failed child startup as success', async () => {
  for (const event of ['signal', 'error']) {
    const result = harness();
    await new Promise(resolve => setImmediate(resolve));
    if (event === 'signal') result.child.emit('exit', null, 'SIGTERM');
    else result.child.emit('error', new Error('Synthetic startup error'));
    result.child.emit('exit', 0, null);
    const code = await result.pending;
    assert.equal(code, 1);
    assert.equal(result.errors.length, 1);
  }
});

test('live runner keeps secrets out of arguments and passes successful child status', async () => {
  const result = harness();
  await new Promise(resolve => setImmediate(resolve));
  result.child.emit('exit', 0, null);
  const code = await result.pending;
  assert.equal(code, 0);
  assert.equal(result.spawnArgs[2].windowsHide, true);
  assert.ok(!JSON.stringify(result.spawnArgs.slice(0, 2)).includes('fake-test-key'));
  assert.equal(result.spawnArgs[2].env.NEXUS_LIVE_OPENROUTER_KEY, 'fake-test-key');
  assert.deepEqual(result.errors, []);
});
