// Runs an opt-in live test with the account-local DPAPI vault (Zero Electron).
// The key never enters source control, command history, test output, or a child-process argument.
const path = require('node:path');
const { spawn } = require('node:child_process');
const { resolveDataDirectory } = require('../core/datadir.cjs');

async function runLiveFromVault({
  argv = process.argv.slice(2),
  env = process.env,
  execPath = process.execPath,
  spawnFn = spawn,
  loadVault = async dir => {
    const { SecretVault } = await import('../core/vault.mjs');
    return new SecretVault(dir);
  },
  logError = msg => console.error(msg),
} = {}) {
  const [script, scope] = argv;
  if (!script) {
    logError('Usage: node tests/run-live-from-vault.cjs <test.mjs> [scope]');
    return 2;
  }
  const dataDir = resolveDataDirectory({ env });
  const vault = await loadVault(dataDir);
  const key = vault.get('OPENROUTER_API_KEY');
  if (!key) {
    logError('The encrypted NEXUS vault has no OpenRouter key. Add OPENROUTER_API_KEY in NEXUS settings first.');
    return 1;
  }
  return new Promise(resolve => {
    const child = spawnFn(execPath, [path.resolve(script)], {
      stdio: 'inherit',
      windowsHide: true,
      env: { ...env, NEXUS_LIVE_OPENROUTER_KEY: key, ...(scope ? { NEXUS_LIVE_SCOPE: scope } : {}) },
    });
    let finished = false;
    const finish = (code, message) => {
      if (finished) return;
      finished = true;
      if (message) logError(message);
      resolve(code);
    };
    child.on('error', () => finish(1, 'Could not start the live test process.'));
    child.on('exit', (code, signal) => finish(
      Number.isInteger(code) ? code : 1,
      signal ? 'Live test interrupted by ' + signal : code === null ? 'Live test ended without an exit code.' : null
    ));
  });
}

module.exports = { runLiveFromVault };

if (require.main === module) {
  runLiveFromVault().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
