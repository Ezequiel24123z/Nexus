import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/store.mjs';

test('migration sets the DS4.1 Flash 50k operating defaults once',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-store-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 await fs.writeFile(path.join(directory,'workspace.json'),JSON.stringify({tasks:[],connectors:[],settings:{model:'',contextWindow:128000,compressionPercent:70},schemaVersion:2}));
 const store=new Store(directory);assert.equal(store.state.settings.model,'deepseek/deepseek-v4.1-flash');assert.equal(store.state.settings.contextWindow,50000);assert.equal(store.state.settings.compressionPercent,95);assert.equal(store.state.settings.maxOutput,0);assert.equal(store.state.schemaVersion,4);
 store.state.settings.contextWindow=73000;store.save();assert.equal(new Store(directory).state.settings.contextWindow,73000);
});

test('missing primary recovers the atomic temporary file instead of creating an empty workspace',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-recovery-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 await fs.writeFile(path.join(directory,'workspace.json.tmp'),JSON.stringify({tasks:[],projects:[{id:'kept',name:'Mi proyecto'}],settings:{}}));
 const store=new Store(directory);assert.equal(store.state.projects[0].name,'Mi proyecto');
 assert.equal(JSON.parse(await fs.readFile(store.filename,'utf8')).projects[0].id,'kept');
});
test('valid JSON with invalid workspace structure falls back to a usable backup',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-recovery-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 await fs.writeFile(path.join(directory,'workspace.json'),'null');
 await fs.writeFile(path.join(directory,'workspace.auto-test.json'),JSON.stringify({tasks:[],projects:[{id:'recovered'}]}));
 const store=new Store(directory);assert.equal(store.state.projects[0].id,'recovered');
 assert.ok((await fs.readdir(directory)).some(name=>name.startsWith('workspace-corrupt-')));
});
