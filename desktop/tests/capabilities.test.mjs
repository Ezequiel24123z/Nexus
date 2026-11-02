import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {CapabilityLibrary,catalogPage} from '../core/capabilities.mjs';
import {Store} from '../core/store.mjs';
import {Runtime} from '../core/runtime.mjs';
import {executeTool,baseTools} from '../core/tools.mjs';
import {McpManager} from '../core/mcp.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-library-'));t.after(()=>{assert.ok(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});return root;}
const skill=(name='Revisar')=>({kind:'skill',name,description:'Pruebas de calidad',instructions:'Leer, comprobar y documentar.',tags:['calidad']});
test('skills persist independently, revisions preserve history and stale edits are rejected',t=>{
 const root=fixture(t),library=new CapabilityLibrary(root),first=library.save(skill());
 const next=library.save({...first,instructions:'Segundo procedimiento'});
 assert.equal(next.revision,2);assert.throws(()=>library.save({...first,name:'Stale'}),/cambió/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'capabilities','history',first.id,'1.json'))).instructions,first.instructions);
 assert.equal(new CapabilityLibrary(root).get(first.id).instructions,'Segundo procedimiento');
 assert.equal(library.summary().total,1);
});
test('disabled entries remain editable but are absent from discovery and cannot execute',t=>{
 const library=new CapabilityLibrary(fixture(t)),fn=library.save({kind:'function',name:'Leer',tool:'read_file',defaults:{path:'a.txt'}});
 library.save({...fn,enabled:false});assert.equal(library.list().total,0);assert.equal(library.list({includeDisabled:true}).total,1);
 assert.throws(()=>library.resolve(fn.id),/desactivada/);assert.equal(library.get(fn.id,{includeDisabled:true}).enabled,false);
});
test('function defaults merge without mutation and nested or unknown tools cannot be registered',t=>{
 const library=new CapabilityLibrary(fixture(t)),fn=library.save({kind:'function',name:'Leer',tool:'read_file',defaults:{path:'a.txt'}});
 assert.equal(library.resolve(fn.id,{path:'b.txt'}).args.path,'b.txt');assert.equal(library.get(fn.id).defaults.path,'a.txt');
 for(const tool of ['invoke_function','save_capability','desktop_action','eval'])assert.throws(()=>library.save({kind:'function',name:tool,tool,defaults:{}}),/herramienta/);
 assert.throws(()=>library.get('../outside'));assert.throws(()=>library.resolve(fn.id,[]));
});
test('malformed files are preserved and reported without losing valid definitions',t=>{
 const root=fixture(t),library=new CapabilityLibrary(root);library.save(skill());const filename=path.join(root,'capabilities',crypto.randomUUID()+'.json');fs.writeFileSync(filename,'broken');
 const restored=new CapabilityLibrary(root);assert.equal(restored.summary().damaged,1);assert.equal(restored.summary().total,1);assert.equal(fs.readFileSync(filename,'utf8'),'broken');
});
test('invalid and oversized definitions never publish a broken catalog entry',t=>{
 const root=fixture(t),library=new CapabilityLibrary(root);
 assert.throws(()=>library.save({...skill(),instructions:'漢'.repeat(59000)}),/160 KB/);
 assert.throws(()=>library.save({...skill(),tags:{bad:true}}));assert.equal(library.summary().total,0);
 assert.equal(fs.readdirSync(path.join(root,'capabilities')).filter(name=>name.endsWith('.json')).length,0);
});
test('10,000 metadata entries remain paged and discovery never loads instruction bodies',t=>{
 const library=new CapabilityLibrary(fixture(t));for(let i=0;i<10000;i++)library.index.set('entry-'+i,{id:'entry-'+i,kind:'skill',name:'Procedimiento '+i,description:'quality procedure',tags:['calidad'],enabled:true,revision:1});
 t.mock.method(library,'read',()=>{throw new Error('Loaded instructions during search');});
 const start=performance.now(),page=library.list({query:'quality',limit:20});const milliseconds=performance.now()-start;
 assert.equal(page.total,10000);assert.equal(page.items.length,20);assert.equal(page.next,20);assert.ok(Buffer.byteLength(JSON.stringify(page))<12000);
 assert.equal(library.list({query:'Procedimiento 9999'}).items[0].name,'Procedimiento 9999');
 t.diagnostic(JSON.stringify({entries:10000,returned:page.items.length,payloadBytes:Buffer.byteLength(JSON.stringify(page)),milliseconds,note:'Búsqueda lineal local; no mide arranque, RAM o rendimiento general'}));
});
test('MCP discovery loads schemas only for a named tool and REST catalogs paginate',async t=>{
 const root=fixture(t),store=new Store(root),runtime=new Runtime(store,{getSecret:()=>null,mcp:{list:async()=>Array.from({length:1000},(_,i)=>({name:'tool-'+i,description:'Searchable',inputSchema:{type:'object',description:'Large schema '.repeat(500)}}))}});
 const signal=new AbortController().signal;
 const page=await executeTool(runtime,{},'list_mcp_tools',{server:'fixture'},signal);assert.equal(page.total,1000);assert.equal(page.items.length,20);assert.equal(page.items[0].inputSchema,undefined);
 const tool=await executeTool(runtime,{},'list_mcp_tools',{server:'fixture',tool:'tool-900'},signal);assert.ok(tool.inputSchema);
 store.state.connectors=Array.from({length:1000},(_,i)=>({name:'connector-'+i,description:'REST',url:'https://example.test',method:'GET'}));
 const connectors=await executeTool(runtime,{},'list_connectors',{offset:980},signal);assert.equal(connectors.items.length,20);assert.equal(connectors.next,null);
 assert.throws(()=>catalogPage([],{offset:-1}));
});
test('library bodies and names do not inflate the stable model prefix or UI snapshots',t=>{
 const root=fixture(t),store=new Store(root),runtime=new Runtime(store,{getSecret:()=>null});runtime.closed=true;
 const task=store.task(runtime.create({prompt:'Fixture'})),before=JSON.stringify(runtime.buildContext(task));
 runtime.capabilities.save({...skill('PRIVATE SKILL NAME'),instructions:'PRIVATE BODY '.repeat(3000)});
 assert.equal(JSON.stringify(runtime.buildContext(task)),before);const snapshot=JSON.stringify(runtime.snapshot(null));assert.equal(snapshot.includes('PRIVATE BODY'),false);assert.equal(snapshot.includes('PRIVATE SKILL NAME'),false);assert.equal(runtime.snapshot(null).capabilities.total,1);
 assert.equal(baseTools.filter(tool=>tool.function.name==='invoke_function').length,1);
});
test('agent-created function resolves through actual tool approval and records its real effect',async t=>{
 const root=fixture(t),store=new Store(root);store.state.settings.streaming=false;store.state.settings.autonomous=false;store.state.settings.autoWorkspaceWrites=false;
 let step=0,functionId,observedApproval;
 const runtime=new Runtime(store,{getSecret:()=> 'test-only',request:async()=>{
   const message=step++===0?{tool_calls:[{id:'fn-call',type:'function',function:{name:'invoke_function',arguments:JSON.stringify({id:functionId,input:{content:'Resultado'}})}}]}:{content:'Terminado'};
   return new Response(JSON.stringify({choices:[{message}],usage:{prompt_tokens:10,completion_tokens:10}}),{headers:{'Content-Type':'application/json'}});
 }});runtime.closed=true;
 const task=store.task(runtime.create({prompt:'Ejecutar función',workspace:root}));
 const saved=await executeTool(runtime,task,'save_capability',{kind:'function',name:'Escribir resultado',tool:'write_file',defaults:{path:'result.txt',content:'Default',reason:'Test'}},new AbortController().signal);functionId=saved.id;
 assert.equal(fs.existsSync(path.join(root,'result.txt')),false);
 runtime.approval=async(_,name,args)=>{observedApproval={name,args};return true;};
 await runtime.run(task,new AbortController().signal);assert.equal(task.status,'complete');assert.equal(fs.readFileSync(path.join(root,'result.txt'),'utf8'),'Resultado');
 assert.equal(observedApproval.name,'write_file');assert.equal(observedApproval.args.content,'Resultado');assert.equal(task.effects[0].tool,'write_file');assert.equal(task.effects[0].status,'observed');
 assert.ok(task.events.some(event=>event.kind==='function_resolved'&&event.detail.id===functionId));
});

test('denied function approval never executes its underlying write',async t=>{
 const root=fixture(t),store=new Store(root);store.state.settings.streaming=false;store.state.settings.autonomous=false;store.state.settings.autoWorkspaceWrites=false;let step=0,id;
 const runtime=new Runtime(store,{getSecret:()=> 'test-only',request:async()=>new Response(JSON.stringify({choices:[{message:step++===0?{tool_calls:[{id:'denied',type:'function',function:{name:'invoke_function',arguments:JSON.stringify({id})}}]}:{content:'No ejecutado'}}]}))});runtime.closed=true;
 id=runtime.capabilities.save({kind:'function',name:'No escribir',tool:'write_file',defaults:{path:'denied.txt',content:'not allowed',reason:'test'}}).id;
 const task=store.task(runtime.create({prompt:'Fixture',workspace:root}));runtime.approval=async()=>false;
 await runtime.run(task,new AbortController().signal);assert.equal(fs.existsSync(path.join(root,'denied.txt')),false);assert.equal(task.effects.length,0);assert.ok(task.messages.some(message=>message.role==='tool'&&message.content.includes('denied')));
});

test('UI snapshots do not serialize REST catalogs and MCP statuses expose a bounded preview',t=>{
 const root=fixture(t),store=new Store(root),runtime=new Runtime(store,{getSecret:()=>null});
 store.state.connectors=Array.from({length:10000},(_,i)=>({name:'item-'+i,url:'https://example.test',description:'description '.repeat(30),method:'GET'}));
 const snapshot=runtime.snapshot(null);assert.equal(snapshot.connectors.length,0);assert.equal(snapshot.connectorCount,10000);assert.ok(JSON.stringify(snapshot).length<12000);assert.equal(runtime.snapshot().connectors.length,10000);
 const mcp=new McpManager(store,()=>null);mcp.mark('fixture',{status:'connected',tools:Array.from({length:1000},(_,i)=>({name:'tool-'+i,description:'x'.repeat(2000)}))});
 assert.equal(mcp.status({compact:true}).fixture.tools.length,20);assert.equal(mcp.status({compact:true}).fixture.toolCount,1000);assert.equal(mcp.status({compact:true}).fixture.tools[0].description.length,600);assert.equal(mcp.status().fixture.tools.length,1000);
});

test('failed capability publication keeps the prior revision and index usable',t=>{
 const library=new CapabilityLibrary(fixture(t)),prior=library.save(skill());
 t.mock.method(fs,'renameSync',()=>{throw new Error('synthetic disk failure');});
 assert.throws(()=>library.save({...prior,instructions:'Never committed'}),/disk failure/);
 assert.equal(library.get(prior.id).revision,1);assert.equal(library.get(prior.id).instructions,prior.instructions);assert.equal(library.list().items[0].revision,1);
});
