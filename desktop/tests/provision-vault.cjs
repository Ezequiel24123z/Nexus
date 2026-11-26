// One-time local provisioning. Receives no key from source code: stores it in the local Windows DPAPI vault.
const { resolveDataDirectory } = require('../core/datadir.cjs');
const value = process.env.NEXUS_BOOTSTRAP_OPENROUTER_KEY;
if (!value) {
  console.error('NEXUS_BOOTSTRAP_OPENROUTER_KEY is required');
  process.exit(2);
}
(async () => {
  try {
    const { SecretVault } = await import('../core/vault.mjs');
    const vault = new SecretVault(resolveDataDirectory());
    vault.set('OPENROUTER_API_KEY', value.trim());
    console.log('NEXUS OpenRouter key stored in the encrypted local DPAPI vault.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
})();
