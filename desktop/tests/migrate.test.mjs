import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../core/store.mjs';
import { candidateLegacyDirs, planMerge, mergeLegacyData } from '../core/migrate.mjs';
import { resolveDataDirectory } from '../core/datadir.cjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-migrate-'));

test('SQLite legacy sources are not imported as frozen JSON or backed up repeatedly', t => {
  const base=temp(),dataDir=path.join(base,'actual'),store=new Store(dataDir);
  t.after(()=>{store.close();fs.rmSync(base,{recursive:true,force:true});});
  const legacy=path.join(base,'Packages','Vendor.App_x','LocalCache','Roaming','NEXUS');
  fs.mkdirSync(legacy,{recursive:true});
  fs.writeFileSync(path.join(legacy,'workspace.json'),JSON.stringify({tasks:[{id:'stale-task'}]}));
  fs.writeFileSync(path.join(legacy,'storage-engine.json'),'{}');
  for(let i=0;i<2;i++)assert.deepEqual(mergeLegacyData({store,dataDir,localAppData:base}),{dirs:[],backup:null});
  assert.equal(store.state.tasks.length,0);
  assert.equal(fs.readdirSync(dataDir).some(name=>name.startsWith('backup-legacy-')),false);
});

test('import into SQLite backs up current state rather than the frozen pre-migration JSON', t => {
  const base=temp(),dataDir=path.join(base,'actual'),store=new Store(dataDir);
  t.after(()=>{store.close();fs.rmSync(base,{recursive:true,force:true});});
  store.migrateToSqlite();store.project({name:'Created after migration'});
  const legacy=path.join(base,'Packages','Vendor.App_x','LocalCache','Roaming','NEXUS');
  fs.mkdirSync(legacy,{recursive:true});
  fs.writeFileSync(path.join(legacy,'workspace.json'),JSON.stringify({tasks:[],projects:[{id:'legacy-project',name:'Old project'}]}));
  const result=mergeLegacyData({store,dataDir,localAppData:base});
  const backup=JSON.parse(fs.readFileSync(path.join(result.backup,'actual-workspace.json'),'utf8'));
  assert.deepEqual(backup.projects.map(project=>project.name),['Created after migration']);
  assert.deepEqual(store.backend.read().projects.map(project=>project.name),['Created after migration','Old project']);
  assert.equal(JSON.parse(fs.readFileSync(store.filename,'utf8')).projects.length,0);
});

test('resolveDataDirectory: canónica en Windows, overrides por entorno', () => {
  const base = { platform: 'win32', env: { USERPROFILE: 'C:\\Users\\Prueba' } };
  assert.equal(resolveDataDirectory(base), path.join('C:\\Users\\Prueba', 'AppData', 'Roaming', 'NEXUS'));
  assert.equal(resolveDataDirectory({ platform: 'win32', env: { USERPROFILE: 'C:\\U', NEXUS_DATA_DIR: 'D:\\datos' } }), 'D:\\datos');
  assert.equal(resolveDataDirectory({ platform: 'win32', env: { USERPROFILE: 'C:\\U', NEXUS_TEST_DATA: 'D:\\test' } }), 'D:\\test');
  assert.equal(resolveDataDirectory({ platform: 'win32', env: {}, fallbackAppData: 'C:\\Fallback' }), path.join('C:\\Fallback', 'NEXUS'));
});

test('candidateLegacyDirs encuentra almacenes bajo Packages', () => {
  const root = temp();
  const target = path.join(root, 'Packages', 'Vendor.App_x', 'LocalCache', 'Roaming', 'NEXUS');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'workspace.json'), '{}');
  assert.deepEqual(candidateLegacyDirs(root), [target]);
  assert.deepEqual(candidateLegacyDirs(path.join(root, 'no-existe')), []);
});

test('planMerge solo adopta elementos con id desconocido', () => {
  const plan = planMerge({ tasks: [{ id: 'a' }], projects: [{ id: 'p' }] }, { tasks: [{ id: 'a' }, { id: 'b' }], projects: [{ id: 'p' }, { id: 'q' }] });
  assert.deepEqual(plan.tasks.map(t => t.id), ['b']);
  assert.deepEqual(plan.projects.map(p => p.id), ['q']);
});

test('mergeLegacyData importa tareas, copia archivos, respalda y es idempotente', () => {
  const base = temp();
  const dataDir = path.join(base, 'actual');
  fs.mkdirSync(dataDir, { recursive: true });
  const store = new Store(dataDir);
  const legacy = path.join(base, 'Packages', 'Vendor.App_x', 'LocalCache', 'Roaming', 'NEXUS');
  fs.mkdirSync(path.join(legacy, 'tasks', 't1'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'tasks', 't1', 'transcript.jsonl'), '{"mensaje":true}\n');
  fs.writeFileSync(path.join(legacy, 'workspace.json'), JSON.stringify({
    tasks: [{ id: 't1', title: 'Hola antiguo', status: 'complete', conversation: [{ role: 'user', content: 'hola' }], events: [], calls: [] }],
    projects: [{ id: 'p1', name: 'Viejo', workspace: 'D:\\X' }],
  }));
  fs.writeFileSync(path.join(legacy, 'vault.bin'), Buffer.from('cifrado-simulado'));
  const result = mergeLegacyData({ store, dataDir, localAppData: base });
  assert.equal(result.dirs.length, 1);
  assert.equal(result.dirs[0].vault, 'pendiente');
  assert.equal(store.state.tasks.length, 1);
  assert.equal(store.state.tasks[0].title, 'Hola antiguo');
  assert.equal(store.state.tasks[0].engine, 'openrouter');
  assert.equal(store.state.projects.length, 1);
  assert.ok(fs.existsSync(path.join(dataDir, 'tasks', 't1', 'transcript.jsonl')));
  assert.ok(result.backup && fs.existsSync(result.backup));
  assert.ok(fs.existsSync(path.join(result.backup, 'origen-1-workspace.json')));
  assert.ok(fs.existsSync(path.join(result.backup, 'origen-1-vault.bin')));
  const second = mergeLegacyData({ store, dataDir, localAppData: base });
  assert.equal(second.dirs.length, 0);
  assert.equal(store.state.tasks.length, 1);
  assert.ok(Array.isArray(store.state.recoveredFrom) && store.state.recoveredFrom.length === 1);
});

test('mergeLegacyData no toca una carpeta ya importada aunque lleguen tareas nuevas', () => {
  const base = temp();
  const dataDir = path.join(base, 'actual');
  fs.mkdirSync(dataDir, { recursive: true });
  const store = new Store(dataDir);
  const legacy = path.join(base, 'Packages', 'Vendor.App_x', 'LocalCache', 'Roaming', 'NEXUS');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'workspace.json'), JSON.stringify({ tasks: [{ id: 't1', title: 'Uno', status: 'complete', conversation: [], events: [], calls: [] }] }));
  mergeLegacyData({ store, dataDir, localAppData: base });
  fs.writeFileSync(path.join(legacy, 'workspace.json'), JSON.stringify({ tasks: [{ id: 't1' }, { id: 't2', title: 'Dos', status: 'complete', conversation: [], events: [], calls: [] }] }));
  const again = mergeLegacyData({ store, dataDir, localAppData: base });
  assert.equal(again.dirs.length, 0);
  assert.equal(store.state.tasks.length, 1);
});
