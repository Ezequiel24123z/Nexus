// Resolve the canonical NEXUS data directory.
// Goal: a single stable store even when a launcher redirects %APPDATA% (e.g., MSIX LocalCache).
const path = require('node:path');

function resolveDataDirectory({ platform = process.platform, env = process.env, fallbackAppData } = {}) {
  if (env.NEXUS_TEST_DATA) return env.NEXUS_TEST_DATA;
  if (env.NEXUS_DATA_DIR) return env.NEXUS_DATA_DIR;
  if (platform === 'win32' && env.USERPROFILE) return path.join(env.USERPROFILE, 'AppData', 'Roaming', 'NEXUS');
  return path.join(fallbackAppData || env.APPDATA || '.', 'NEXUS');
}

module.exports = { resolveDataDirectory };
