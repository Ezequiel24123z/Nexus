// Diagnostic tool: prints ONLY key names and lengths from the local NEXUS DPAPI vault (never secret values).
// Usage: node tools/vault-inspect.cjs [dataDir]
const path = require('node:path');
const { resolveDataDirectory } = require('../core/datadir.cjs');

(async () => {
  try {
    const dataDir = process.argv[2] ? path.resolve(process.argv[2]) : resolveDataDirectory();
    const { SecretVault } = await import('../core/vault.mjs');
    const vault = new SecretVault(dataDir);
    const names = vault.listNames();
    console.log('OK dir=' + dataDir + ' keys=' + names.length + ' [' + names.join(', ') + ']');
    for (const name of names) {
      console.log('- ' + name + ' length=' + String(vault.secrets[name] ?? '').length);
    }
  } catch (error) {
    console.error('FAIL: ' + (error && error.message));
    process.exitCode = 1;
  }
})();
