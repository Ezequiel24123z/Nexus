// Resolución de la carpeta de datos de NEXUS.
// Objetivo: un único almacén estable aunque el lanzador redirija %APPDATA% (p. ej. LocalCache de paquetes MSIX).
const path = require('node:path');

function resolveDataDirectory({ platform = process.platform, env = process.env, fallbackAppData } = {}) {
  if (env.NEXUS_TEST_DATA) return env.NEXUS_TEST_DATA;
  if (env.NEXUS_DATA_DIR) return env.NEXUS_DATA_DIR;
  if (platform === 'win32' && env.USERPROFILE) return path.join(env.USERPROFILE, 'AppData', 'Roaming', 'NEXUS');
  return path.join(fallbackAppData || env.APPDATA || '.', 'NEXUS');
}

module.exports = { resolveDataDirectory };
