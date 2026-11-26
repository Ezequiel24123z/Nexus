import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, '..');
const nativeExe = path.join(desktopDir, 'release', 'NEXUS', 'NEXUS.exe');
const uiIndex = path.join(desktopDir, 'ui', 'index.html');

if (!fs.existsSync(uiIndex)) {
  console.log('NEXUS: building UI bundle…');
  execSync('npm run build:ui', { cwd: desktopDir, stdio: 'inherit' });
}

if (process.platform === 'win32') {
  if (!fs.existsSync(nativeExe)) {
    console.log('NEXUS: building native Windows executable…');
    execSync('npm run build:native', { cwd: desktopDir, stdio: 'inherit' });
  }
  const child = spawn(nativeExe, process.argv.slice(2), {
    cwd: desktopDir,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
} else {
  const child = spawn(process.execPath, [path.join(desktopDir, 'core', 'server.mjs'), '--standalone', '--open', ...process.argv.slice(2)], {
    cwd: desktopDir,
    stdio: 'inherit',
  });
  child.on('exit', code => process.exit(code ?? 0));
}
