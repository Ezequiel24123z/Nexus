import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, '..');
const outDir = path.join(desktopDir, 'release', 'NEXUS-Portable');
const nativeDir = path.join(desktopDir, 'release', 'NEXUS');
const uiDir = path.join(desktopDir, 'ui');

if (!fs.existsSync(path.join(nativeDir, 'NEXUS.exe'))) {
  throw new Error('Build native host first: npm run build:native');
}
if (!fs.existsSync(path.join(uiDir, 'index.html'))) {
  throw new Error('Build UI first: npm run build:ui');
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const copyRecursive = (src, dest) => {
  fs.cpSync(src, dest, { recursive: true, force: true });
};

// 1. Native Windows host + WebView2 runtimes
copyRecursive(nativeDir, outDir);

// 2. Built React UI + Core ESM Engine + Native PowerShell helpers
copyRecursive(uiDir, path.join(outDir, 'ui'));
copyRecursive(path.join(desktopDir, 'core'), path.join(outDir, 'core'));
copyRecursive(path.join(desktopDir, 'native'), path.join(outDir, 'native'));
fs.copyFileSync(path.join(desktopDir, 'package.json'), path.join(outDir, 'package.json'));

// 3. Bundle Node 24 executable so the portable folder works even on PCs without Node installed
const nodeOut = path.join(outDir, 'node');
fs.mkdirSync(nodeOut, { recursive: true });
fs.copyFileSync(process.execPath, path.join(nodeOut, 'node.exe'));

// 4. Copy only runtime backend node_modules (@modelcontextprotocol/sdk + eventsource-parser + their deps)
const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
const needed = new Set(['@modelcontextprotocol/sdk', 'eventsource-parser']);
const nmSrc = path.join(desktopDir, 'node_modules');
const nmDest = path.join(outDir, 'node_modules');
const visited = new Set();

function collectDep(depName) {
  if (visited.has(depName)) return;
  const srcPath = path.join(nmSrc, depName);
  if (!fs.existsSync(srcPath)) return;
  visited.add(depName);
  copyRecursive(srcPath, path.join(nmDest, depName));
  const depPkgPath = path.join(srcPath, 'package.json');
  if (fs.existsSync(depPkgPath)) {
    try {
      const depPkg = JSON.parse(fs.readFileSync(depPkgPath, 'utf8'));
      for (const child of Object.keys(depPkg.dependencies || {})) collectDep(child);
    } catch {}
  }
}

for (const rootDep of needed) collectDep(rootDep);

// 5. Bundle portable Tor Expert Bundle if already downloaded in desktop/tor or %APPDATA%/NEXUS/tor
const torCandidates = [
  path.join(desktopDir, 'tor'),
  path.join(process.env.APPDATA || '', 'NEXUS', 'tor'),
];
const torSrc = torCandidates.find(p => fs.existsSync(path.join(p, 'tor', 'tor.exe')) || fs.existsSync(path.join(p, 'tor.exe')));
if (torSrc) {
  copyRecursive(torSrc, path.join(outDir, 'tor'));
}

console.log(`NEXUS Portable bundle created at: ${outDir}`);
console.log(`Includes NEXUS.exe, WebView2 loader, bundled Node ${process.version}, core/, ui/, ${torSrc ? 'bundled portable Tor, ' : ''}and ${visited.size} backend dependency packages.`);
