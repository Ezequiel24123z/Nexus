// Diagnóstico: muestra SOLO nombres de clave de un vault.bin (nunca los valores).
// Uso: electron tools/vault-inspect.cjs <ruta-vault.bin> [carpeta-userData]
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const args = process.argv.slice(2);
const file = args[0];
const userDataDir = args[1];
app.setPath('userData', userDataDir || path.join(os.tmpdir(), 'nexus-vault-inspect'));
app.whenReady().then(() => {
  try {
    const data = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    const names = Object.keys(data);
    console.log('OK keys=' + names.length + ' [' + names.join(', ') + ']');
    for (const name of names) console.log('- ' + name + ' length=' + String(data[name] ?? '').length);
  } catch (error) { console.log('FAIL: ' + (error && error.message)); }
  app.exit(0);
});
