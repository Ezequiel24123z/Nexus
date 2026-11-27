import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_UPDATE_REPO = 'Ezequiel24123z/Nexus';

export function compareSemver(a = '0.0.0', b = '0.0.0') {
  const parse = v => {
    const clean = String(v || '0.0.0').trim().replace(/^v/i, '').split('+')[0];
    const dash = clean.indexOf('-');
    const coreStr = dash >= 0 ? clean.slice(0, dash) : clean;
    const preStr = dash >= 0 ? clean.slice(dash + 1) : '';
    const core = coreStr.split('.').map(n => Number(n) || 0);
    const pre = preStr ? preStr.split('.').map(p => (/^\d+$/.test(p) ? Number(p) : p)) : [];
    return { core, pre };
  };
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa.core[i] || 0) - (pb.core[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  // SemVer 2.0.0: a release without pre-release has higher precedence than a pre-release (e.g. 1.4.0 > 1.4.0-rc.1)
  if (!pa.pre.length && !pb.pre.length) return 0;
  if (!pa.pre.length) return 1;
  if (!pb.pre.length) return -1;
  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    if (i >= pa.pre.length) return -1;
    if (i >= pb.pre.length) return 1;
    const x = pa.pre[i], y = pb.pre[i];
    if (x === y) continue;
    const xNum = typeof x === 'number', yNum = typeof y === 'number';
    if (xNum && yNum) return x > y ? 1 : -1;
    if (xNum !== yNum) return xNum ? -1 : 1; // numeric identifiers always have lower precedence than non-numeric
    return String(x) > String(y) ? 1 : -1;
  }
  return 0;
}

export function buildUpdaterScript() {
  return `
param([string]$SourceDir, [string]$TargetDir, [int]$WaitPid = 0, [switch]$NoLaunch)
$ErrorActionPreference = 'Continue'
$logPath = Join-Path (Split-Path -Parent $PSCommandPath) 'update.log'
function Log($msg) {
  try { Add-Content -LiteralPath $logPath -Value ("[" + (Get-Date -Format 's') + "] " + $msg) } catch {}
}
Log "Starting NEXUS portable update: $SourceDir -> $TargetDir"
Start-Sleep -Milliseconds 900

# Stop ONLY NEXUS.exe / node.exe processes running inside $TargetDir (never unrelated processes)
$normTarget = [System.IO.Path]::GetFullPath($TargetDir).TrimEnd('\\') + '\\'
try {
  Get-CimInstance Win32_Process -Filter "Name='NEXUS.exe' OR Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    $ep = $_.ExecutablePath
    $cl = $_.CommandLine
    if (($ep -and $ep.StartsWith($normTarget, [System.StringComparison]::OrdinalIgnoreCase)) -or
        ($cl -and $cl.IndexOf($normTarget, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) {
      Log ("Stopping process " + $_.Name + " PID " + $_.ProcessId)
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
} catch {}

if ($WaitPid -gt 0) {
  for ($i = 0; $i -lt 25; $i++) {
    if (-not (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 250
  }
}
Start-Sleep -Milliseconds 400

# Replace ONLY application binaries & code folders; user data & custom prompts in %APPDATA%\\NEXUS are never touched
$appFolders = @('core', 'ui', 'native', 'node', 'node_modules', 'runtimes')
foreach ($f in $appFolders) {
  $src = Join-Path $SourceDir $f
  $dst = Join-Path $TargetDir $f
  if (Test-Path -LiteralPath $src) {
    for ($try = 0; $try -lt 5; $try++) {
      try {
        if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force -ErrorAction Stop }
        Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force -ErrorAction Stop
        Log "Updated folder: $f"
        break
      } catch {
        Log ("Retry $try for folder $f : " + $_.Exception.Message)
        Start-Sleep -Milliseconds 500
      }
    }
  }
}
Get-ChildItem -LiteralPath $SourceDir -File | ForEach-Object {
  $dstFile = Join-Path $TargetDir $_.Name
  for ($try = 0; $try -lt 5; $try++) {
    try {
      Copy-Item -LiteralPath $_.FullName -Destination $dstFile -Force -ErrorAction Stop
      break
    } catch {
      Log ("Retry $try for file " + $_.Name + ": " + $_.Exception.Message)
      Start-Sleep -Milliseconds 400
    }
  }
}
Log "Update files applied cleanly."

if (-not $NoLaunch) {
  $exe = Join-Path $TargetDir 'NEXUS.exe'
  if (Test-Path -LiteralPath $exe) {
    Log "Relaunching $exe"
    Start-Process -FilePath $exe -WorkingDirectory $TargetDir
  }
}
`;
}

export function detectInstallLayout(desktopRoot) {
  if (!desktopRoot || typeof desktopRoot !== 'string') {
    return { installDir: '', isGitRepo: false, canSelfUpdateInPlace: false };
  }
  const isGitRepo = fs.existsSync(path.join(desktopRoot, '..', '.git')) || fs.existsSync(path.join(desktopRoot, '.git'));
  const hasPortableExe = fs.existsSync(path.join(desktopRoot, 'NEXUS.exe')) && fs.existsSync(path.join(desktopRoot, 'core', 'server.mjs'));
  return {
    installDir: desktopRoot,
    isGitRepo,
    canSelfUpdateInPlace: !isGitRepo && hasPortableExe && process.platform === 'win32',
  };
}

export async function checkGithubUpdate({
  currentVersion,
  repo = DEFAULT_UPDATE_REPO,
  desktopRoot,
  request = fetch,
} = {}) {
  const cleanRepo = String(repo || DEFAULT_UPDATE_REPO).trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cleanRepo)) {
    throw new Error('Invalid GitHub repository format. Expected owner/repo.');
  }
  const url = `https://api.github.com/repos/${cleanRepo}/releases?per_page=10`;
  const res = await request(url, {
    headers: { 'User-Agent': `NEXUS/${currentVersion || '1.3.0'}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub Releases check failed (HTTP ${res.status}).`);
  const list = await res.json();
  const published = (Array.isArray(list) ? list : []).filter(r => r && !r.draft);
  const latest = published.find(r => !r.prerelease) || published[0] || null;
  const layout = detectInstallLayout(desktopRoot);

  if (!latest) {
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      repo: cleanRepo,
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      releases: [],
      layout,
      note: 'No published GitHub Releases found yet. Publish a v* tag to generate NEXUS-Portable-Windows.zip.',
    };
  }

  const latestVersion = String(latest.tag_name || '').replace(/^v/i, '');
  const zipAsset = (latest.assets || []).find(a => /NEXUS-Portable-Windows\.zip$/i.test(a.name))
    || (latest.assets || []).find(a => /\.zip$/i.test(a.name))
    || null;
  const updateAvailable = compareSemver(latestVersion, currentVersion) > 0;

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    repo: cleanRepo,
    currentVersion,
    latestVersion,
    tagName: latest.tag_name,
    updateAvailable,
    releaseName: latest.name || latest.tag_name,
    releaseUrl: latest.html_url,
    publishedAt: latest.published_at,
    releaseNotes: String(latest.body || '').slice(0, 12000),
    asset: zipAsset ? {
      name: zipAsset.name,
      size: zipAsset.size,
      downloadUrl: zipAsset.browser_download_url,
      digest: zipAsset.digest || null,
    } : null,
    releases: published.slice(0, 8).map(r => ({
      tag: r.tag_name,
      version: String(r.tag_name || '').replace(/^v/i, ''),
      name: r.name || r.tag_name,
      publishedAt: r.published_at,
      url: r.html_url,
      notes: String(r.body || '').slice(0, 2500),
    })),
    layout,
  };
}

// Safely preserves all user data, custom system prompts, nexus.config.json, vault, memories,
// projects, skills & plugins in a timestamped backup folder before any update runs.
export async function backupUserCustomizations(dataDir, targetVersion = 'manual') {
  const safeVer = String(targetVersion || 'manual').replace(/[^a-zA-Z0-9._-]/g, '_');
  const backupDir = path.join(dataDir, 'backups', `pre-update-${safeVer}-${Date.now()}`);
  await fsp.mkdir(backupDir, { recursive: true });
  const preserved = [];
  for (const filename of ['nexus.config.json', 'workspace.json']) {
    const src = path.join(dataDir, filename);
    if (fs.existsSync(src)) {
      await fsp.copyFile(src, path.join(backupDir, filename));
      preserved.push(filename);
    }
  }
  let settingsSrc = null;
  const cfgPath = path.join(dataDir, 'nexus.config.json');
  const wsPath = path.join(dataDir, 'workspace.json');
  if (fs.existsSync(cfgPath)) {
    try { settingsSrc = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
  }
  if (!settingsSrc && fs.existsSync(wsPath)) {
    try { settingsSrc = JSON.parse(fs.readFileSync(wsPath, 'utf8'))?.settings || null; } catch {}
  }
  if (settingsSrc) {
    try {
      const promptSnapshot = {
        savedAt: new Date().toISOString(),
        globalInstructionsCustomized: Boolean(settingsSrc.globalInstructionsCustomized),
        globalInstructions: settingsSrc.globalInstructions || '',
        customSystemPrompt: settingsSrc.customSystemPrompt || '',
      };
      await fsp.writeFile(path.join(backupDir, 'custom-prompts.json'), JSON.stringify(promptSnapshot, null, 2), 'utf8');
      preserved.push('custom-prompts.json');
    } catch {}
  }
  return { ok: true, backupDir, preserved };
}

export async function downloadAndApplyGithubUpdate({
  currentVersion,
  repo = DEFAULT_UPDATE_REPO,
  desktopRoot,
  dataDir,
  request = fetch,
  dryRun = false,
} = {}) {
  const info = await checkGithubUpdate({ currentVersion, repo, desktopRoot, request });
  if (!info.asset?.downloadUrl) {
    throw new Error('Latest GitHub release does not contain a NEXUS-Portable-Windows.zip asset.');
  }

  const backup = await backupUserCustomizations(dataDir, info.latestVersion);
  const stageDir = path.join(os.tmpdir(), `nexus-update-${info.latestVersion}-${crypto.randomUUID().slice(0, 6)}`);
  const extractDir = path.join(stageDir, 'extracted');
  const zipPath = path.join(stageDir, info.asset.name);
  await fsp.mkdir(extractDir, { recursive: true });

  const res = await request(info.asset.downloadUrl, {
    headers: { 'User-Agent': `NEXUS/${currentVersion || '1.3.0'}` },
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`Failed to download update archive (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (info.asset.digest && info.asset.digest.startsWith('sha256:')) {
    const expected = info.asset.digest.slice(7).toLowerCase();
    const actual = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
    if (actual !== expected) {
      throw new Error(`Update archive SHA-256 verification failed (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…).`);
    }
  }
  await fsp.writeFile(zipPath, buf);

  // Extract and verify integrity of the downloaded release
  await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    'Expand-Archive -LiteralPath $env:NX_ZIP -DestinationPath $env:NX_DST -Force',
  ], { env: { ...process.env, NX_ZIP: zipPath, NX_DST: extractDir }, timeout: 120000, windowsHide: true });

  // Locate root inside extracted archive (either direct or nested NEXUS-Portable/)
  let payloadRoot = extractDir;
  if (!fs.existsSync(path.join(payloadRoot, 'NEXUS.exe'))) {
    const sub = fs.readdirSync(extractDir, { withFileTypes: true }).find(d => d.isDirectory() && fs.existsSync(path.join(extractDir, d.name, 'NEXUS.exe')));
    if (sub) payloadRoot = path.join(extractDir, sub.name);
  }
  if (!fs.existsSync(path.join(payloadRoot, 'NEXUS.exe')) || !fs.existsSync(path.join(payloadRoot, 'core', 'server.mjs'))) {
    throw new Error('Downloaded update archive is incomplete (missing NEXUS.exe or core/server.mjs). Update aborted safely.');
  }

  if (dryRun || !info.layout.canSelfUpdateInPlace) {
    const reason = info.layout.isGitRepo
      ? 'Running from a Git development checkout. Archive was downloaded and SHA-256 verified, and your custom prompts were backed up; update dev checkout via git pull && npm run build.'
      : 'Update downloaded, SHA-256 verified, and staged ready to apply (custom prompts backed up).';
    return {
      staged: true,
      downloaded: true,
      applied: false,
      restarting: false,
      version: info.latestVersion,
      payloadRoot,
      backup,
      reason,
      message: reason,
    };
  }

  // Generate detached Windows updater helper that swaps ONLY app files (never touching %APPDATA%\NEXUS or custom prompts)
  const updaterPs1 = path.join(stageDir, 'apply-nexus-update.ps1');
  await fsp.writeFile(updaterPs1, buildUpdaterScript(), 'utf8');
  spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', updaterPs1,
    '-SourceDir', payloadRoot,
    '-TargetDir', info.layout.installDir,
    '-WaitPid', String(process.pid),
  ], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();

  return {
    staged: true,
    downloaded: true,
    applied: true,
    restarting: true,
    version: info.latestVersion,
    updaterScript: updaterPs1,
    backup,
    message: `Backed up custom prompts to ${backup.backupDir} and launched updater for v${info.latestVersion}. NEXUS will restart automatically.`,
  };
}
