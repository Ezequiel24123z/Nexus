// Importación de datos de instalaciones/contextos anteriores de NEXUS.
// No borra nada: copia un respaldo antes de actuar y conserva el origen intacto.
// Las claves cifradas (vault.bin) NO se descifran aquí: en Windows dependen del
// par Local State + vault.bin de cada carpeta, así que main.cjs usa un proceso
// puente que arranca con la carpeta heredada (ver readLegacyVault).
import fs from 'node:fs';
import path from 'node:path';
import { normalizeTask } from './store.mjs';

export function candidateLegacyDirs(localAppData) {
  const found = [];
  if (!localAppData) return found;
  const packages = path.join(localAppData, 'Packages');
  let entries = [];
  try { entries = fs.readdirSync(packages, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(packages, entry.name, 'LocalCache', 'Roaming', 'NEXUS');
    try { if (fs.existsSync(path.join(dir, 'workspace.json'))) found.push(dir); } catch {}
  }
  return found;
}

export function planMerge(currentState, legacyState) {
  const taskIds = new Set((currentState.tasks || []).map(task => task.id));
  const projectIds = new Set((currentState.projects || []).map(project => project.id));
  return {
    tasks: (legacyState.tasks || []).filter(task => task && task.id && !taskIds.has(task.id)),
    projects: (legacyState.projects || []).filter(project => project && project.id && !projectIds.has(project.id)),
  };
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

export function mergeLegacyData({ store, dataDir, localAppData, now = () => new Date().toISOString() }) {
  const state = store.state;
  state.recoveredFrom ||= [];
  const seen = new Set(state.recoveredFrom.map(item => item.dir));
  const sources = candidateLegacyDirs(localAppData).filter(dir => {
    if(seen.has(dir) || path.resolve(dir) === path.resolve(dataDir))return false;
    // Its JSON is frozen at migration, not current. Skip before making backups.
    if(fs.existsSync(path.join(dir,'storage-engine.json'))){console.warn('NEXUS: origen SQLite omitido de la importación JSON; requiere exportación compatible.');return false;}
    return true;
  });
  const result = { dirs: [], backup: null };
  if (!sources.length) return result;
  const backup = path.join(dataDir, 'backup-legacy-' + now().replace(/[:.]/g, '-'));
  fs.mkdirSync(backup, { recursive: true });
  result.backup = backup;
  // Back up the authoritative state, including work committed after SQLite activation.
  if(store.backend)store.exportState(path.join(backup,'actual-workspace.json'));
  for (const name of (store.backend?['vault.bin']:['workspace.json', 'vault.bin'])) {
    const from = path.join(dataDir, name);
    if (fs.existsSync(from)) { try { copyFile(from, path.join(backup, 'actual-' + name)); } catch {} }
  }
  for (const [index, dir] of sources.entries()) {
    let legacy;
    try { legacy = JSON.parse(fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8')); } catch { continue; }
    const plan = planMerge(state, legacy);
    const tag = 'origen-' + (index + 1);
    for (const name of ['workspace.json', 'vault.bin']) {
      const from = path.join(dir, name);
      if (fs.existsSync(from)) { try { copyFile(from, path.join(backup, tag + '-' + name)); } catch {} }
    }
    let copied = 0;
    for (const task of plan.tasks) {
      const from = path.join(dir, 'tasks', task.id), to = path.join(dataDir, 'tasks', task.id);
      try { if (fs.existsSync(from) && !fs.existsSync(to)) { fs.cpSync(from, to, { recursive: true }); copied += 1; } } catch {}
    }
    for (const task of plan.tasks) { normalizeTask(task); state.tasks.push(task); }
    for (const project of plan.projects) state.projects.push(project);
    const vaultNote = fs.existsSync(path.join(dir, 'vault.bin')) ? 'pendiente' : 'ausente';
    state.recoveredFrom.push({ dir, at: now(), tasks: plan.tasks.map(task => task.id), projects: plan.projects.map(project => project.id), vault: vaultNote });
    result.dirs.push({ dir, tasks: plan.tasks.map(task => ({ id: task.id, title: task.title })), projects: plan.projects.length, copied, vault: vaultNote });
  }
  store.save();
  return result;
}
