import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {previewOpenApi,importOpenApi,openApiRequest} from '../core/openapi.mjs';
import {Store} from '../core/store.mjs';
import {Runtime} from '../core/runtime.mjs';
import {executeTool} from '../core/tools.mjs';

function spec(){return {openapi:'3.1.0',info:{title:'Prueba local'},servers:[{url:'https://example.test/v1'}],paths:{'/items/{id}':{parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}],get:{operationId:'readItem',parameters:[{name:'limit',in:'query',schema:{type:'integer'}}]},patch:{operationId:'editItem',requestBody:{required:true,content:{'application/json':{schema:{type:'object',properties:{name:{type:'string'},tags:{type:'array',items:{type:'string'}}},required:['name'],additionalProperties:false}}}}}}}};}
const args=document=>({source:JSON.stringify(document),prefix:'Test'});
const connectors=document=>previewOpenApi(args(document)).entries.map(entry=>{assert.equal(entry.issue,null);return entry.connector;});
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-openapi-'));t.after(()=>{assert.ok(directory.startsWith(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});const store=new Store(directory);let calls=0;const runtime=new Runtime(store,{getSecret:()=>{throw new Error('No secret access during import');},request:async()=>{calls++;throw new Error('No network during import');}});return {store,runtime,calls:()=>calls,directory};}

test('preview is deterministic, creates no requests, and import persists only selected operations',t=>{
 const {store,runtime,calls,directory}=fixture(t),input=args(spec()),preview=previewOpenApi(input);
 assert.equal(preview.compatible,2);assert.deepEqual(previewOpenApi(input),preview);assert.equal(store.state.connectors.length,0);
 const selected=[preview.entries[0].id];assert.equal(importOpenApi(runtime,{...input,selected}).imported,1);
 assert.equal(calls(),0);assert.equal(new Store(directory).state.connectors.length,1);
 assert.match(previewOpenApi(input,store.state.connectors).entries[0].issue,/exists/);
 assert.throws(()=>importOpenApi(runtime,{...input,selected}),/Selection/);assert.equal(store.state.connectors.length,1);
});
test('batch import revalidates selections, duplicates and rolls memory back on disk error',t=>{
 const {store,runtime}=fixture(t),input=args(spec()),selected=previewOpenApi(input).entries.map(item=>item.id),before=store.state.connectors;
 assert.throws(()=>importOpenApi(runtime,{...input,selected:[selected[0],selected[0]]}),/duplicates/);
 assert.throws(()=>importOpenApi(runtime,{...input,selected:[selected[0],'unknown']}),/Selection/);
 let events=0;runtime.on('change',()=>events++);store.save=()=>{throw new Error('disk full');};
 assert.throws(()=>importOpenApi(runtime,{...input,selected}),/disk full/);assert.equal(store.state.connectors,before);assert.equal(events,0);
});
test('path and query values are encoded, typed and kept separate from JSON bodies',()=>{
 const [get,patch]=connectors(spec());
 const request=openApiRequest(get,{path:{id:'a/b?ñ#x'},query:{limit:0}});
 assert.equal(request.url.href,'https://example.test/v1/items/a%2Fb%3F%C3%B1%23x?limit=0');assert.equal(request.body,undefined);
 assert.equal(openApiRequest(patch,{path:{id:'abc'},body:{name:'Nuevo',tags:['ok']}}).body,'{"name":"Nuevo","tags":["ok"]}');
 for(const input of [{},{path:{id:'..'}},{path:{id:'ok'},query:{limit:'2'}},{path:{id:'ok'},query:{missing:1}},{id:'ok'},{path:{id:'ok'},body:{}}])assert.throws(()=>openApiRequest(get,input));
 assert.throws(()=>openApiRequest(patch,{path:{id:'ok'}}),/Missing body/);
 assert.throws(()=>openApiRequest(patch,{path:{id:'ok'},body:{tags:[]}}),/missing name/);
 assert.throws(()=>openApiRequest(patch,{path:{id:'ok'},body:{name:'ok',extra:1}}),/unknown property/);
 assert.throws(()=>openApiRequest(patch,{path:{id:'ok'},body:{name:'ok',tags:[2]}}),/string/);
});
test('parameter overrides and operation/path/root servers follow precedence',()=>{
 const doc=spec(),item=doc.paths['/items/{id}'];
 item.servers=[{url:'https://path.test'}];item.get.servers=[{url:'https://operation.test'}];
 item.get.parameters.push({name:'id',in:'path',required:true,schema:{type:'integer'}});
 let [get,patch]=connectors(doc);assert.equal(get.openapi.baseUrl,'https://operation.test');assert.equal(patch.openapi.baseUrl,'https://path.test');
 assert.equal(openApiRequest(get,{path:{id:2}}).url.href,'https://operation.test/items/2');
 assert.throws(()=>openApiRequest(get,{path:{id:'two'}}));
 assert.ok(previewOpenApi({...args(doc),baseUrl:'https://override.test/v2'}).entries.every(item=>item.connector.openapi.baseUrl==='https://override.test/v2'));
});
test('internal references resolve without external access; cycles and unsupported schema constructs are visible',()=>{
 const doc=spec(),item=doc.paths['/items/{id}'];doc.components={parameters:{'item/id':item.parameters[0]}};
 item.parameters=[{$ref:'#/components/parameters/item~1id'}];assert.equal(previewOpenApi(args(doc)).compatible,2);
 item.parameters=[{$ref:'https://example.test/parameters.json'}];assert.match(previewOpenApi(args(doc)).entries[0].issue,/External/);
 doc.components.parameters.loop={$ref:'#/components/parameters/loop'};item.parameters=[{$ref:'#/components/parameters/loop'}];assert.match(previewOpenApi(args(doc)).entries[0].issue,/Circular/i);
 const other=spec();other.paths['/items/{id}'].get.parameters[0].schema.minimum=0;assert.match(previewOpenApi(args(other)).entries[0].issue,/minimum/);
});
test('security OR, AND and public overrides never silently discard mandatory authentication',()=>{
 const doc=spec();doc.components={securitySchemes:{token:{type:'http',scheme:'bearer'},apiKey:{type:'apiKey',in:'header',name:'X-Key'}}};
 doc.security=[{token:[]}];assert.match(previewOpenApi(args(doc)).entries[0].issue,/CONNECTOR_/);
 let plan=previewOpenApi({...args(doc),secretRef:'CONNECTOR_TEST'});assert.equal(plan.entries[0].connector.secretRef,'CONNECTOR_TEST');
 doc.security=[{token:[],apiKey:[]}];assert.match(previewOpenApi({...args(doc),secretRef:'CONNECTOR_TEST'}).entries[0].issue,/authentication/i);
 doc.security=[{apiKey:[]},{token:[]}];assert.equal(previewOpenApi({...args(doc),secretRef:'CONNECTOR_TEST'}).compatible,2);
 doc.paths['/items/{id}'].get.security=[];plan=previewOpenApi(args(doc));assert.equal(plan.entries[0].connector.secretRef,'');assert.ok(plan.entries[1].issue);
 doc.security=[{}, {apiKey:[]}];assert.ok(previewOpenApi({...args(doc),secretRef:'CONNECTOR_TEST'}).entries.every(item=>item.connector.secretRef===''));
});
test('unsupported media, methods, parameter styles, endpoints, versions and large files fail explicitly',()=>{
 assert.throws(()=>previewOpenApi({source:'openapi: 3.1.0'}),/JSON/);
 assert.throws(()=>previewOpenApi(args({openapi:'2.0'})),/3.0/);
 assert.throws(()=>previewOpenApi({source:'x'.repeat(2*1024*1024+1)}),/2 MB/);
 for(const url of ['http://example.test','https://user:pass@example.test','https://example.test?key=secret','https://example.test/#x'])assert.throws(()=>previewOpenApi({...args(spec()),baseUrl:url}));
 const doc=spec(),item=doc.paths['/items/{id}'];item.head={};item.patch.requestBody.content={'multipart/form-data':{schema:{type:'object'}}};item.get.parameters[0].style='deepObject';
 const plan=previewOpenApi(args(doc));assert.equal(plan.compatible,0);assert.match(plan.entries[0].issue,/serialization/i);assert.match(plan.entries[1].issue,/application\/json/);assert.match(plan.entries[2].issue,/HEAD/);
});
test('import caps per-document work, not accumulated connector count',()=>{
 const doc=spec();doc.paths=Object.fromEntries(Array.from({length:501},(_,i)=>['/item'+i,{get:{}}]));assert.throws(()=>previewOpenApi(args(doc)),/500/);
 doc.paths={'/one':{get:{}}};assert.equal(previewOpenApi(args(doc),Array.from({length:10000},(_,i)=>({name:'existing'+i}))).compatible,1);
});
test('runtime uses imported contracts, Bearer references and original effect identity',async t=>{
 const {runtime,store}=fixture(t),doc=spec();doc.security=[{token:[]}];doc.components={securitySchemes:{token:{type:'http',scheme:'bearer'}}};
 const input={...args(doc),secretRef:'CONNECTOR_TEST'},plan=previewOpenApi(input);importOpenApi(runtime,{...input,selected:[plan.entries[1].id]});
 const connector=store.state.connectors[0];connector.idempotencyHeader=true;let request;
 runtime.getSecret=name=>{assert.equal(name,'CONNECTOR_TEST');return 'fixture-token';};runtime.request=async(url,options)=>{request={url,options};return new Response(null,{status:204});};
 const result=await runtime.invokeConnector({name:connector.name,input:{path:{id:'one'},body:{name:'Test'}}},new AbortController().signal,{id:'same-operation'});
 assert.equal(result.status,204);assert.equal(result.body,'');assert.equal(request.options.headers.Authorization,'Bearer fixture-token');assert.equal(request.options.headers['Idempotency-Key'],'same-operation');assert.equal(request.options.redirect,'error');assert.equal(request.url.pathname,'/v1/items/one');assert.equal(request.options.body,'{"name":"Test"}');
 assert.equal(result.status,204);assert.equal(result.body,'');assert.equal(request.options.headers['Idempotency-Key'],'same-operation');assert.equal(request.options.redirect,'error');assert.equal(request.url.pathname,'/v1/items/one');assert.equal(request.options.body,'{"name":"Test"}');
 connector.method='GET';assert.throws(()=>runtime.validateConnector(connector),/Method/i);
});
test('legacy flat connectors still work and split UTF-8 response characters are preserved',async t=>{
 const {runtime,store}=fixture(t);store.state.connectors.push({name:'legacy',url:'https://example.test',method:'GET'});let requested;
 runtime.request=async(url,options)=>{requested={url,options};const bytes=new TextEncoder().encode('niño 🌿');return new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}}));};
 const result=await runtime.invokeConnector({name:'legacy',input:{q:'hola mundo'}},new AbortController().signal);
 assert.equal(result.body,'niño 🌿');assert.equal(requested.url.searchParams.get('q'),'hola mundo');assert.equal(requested.options.body,undefined);
 store.state.connectors[0].method='POST';await runtime.invokeConnector({name:'legacy',input:{name:'ok'}},new AbortController().signal);assert.equal(requested.options.body,'{"name":"ok"}');
});
test('agent discovery returns metadata and retrieves only the selected connector contract',async t=>{
 const {runtime,store}=fixture(t);store.state.connectors=connectors(spec());store.state.settings.autonomous=false;
 const list=await executeTool(runtime,{},'list_connectors',{},new AbortController().signal);assert.equal(list.items.length,2);assert.ok(!JSON.stringify(list).includes('parameters'));
 const definition=await executeTool(runtime,{},'get_connector',{name:store.state.connectors[0].name},new AbortController().signal);assert.equal(definition.openapi.parameters[0].name,'id');assert.equal(runtime.needsApproval('get_connector'),false);
});
test('server defaults, escaped local pointers and missing path declarations are handled explicitly',()=>{
 const doc=spec();doc.servers=[{url:'https://{region}.example.test/{version}',variables:{region:{default:'eu'},version:{default:'v2'}}}];
 assert.equal(connectors(doc)[0].url,'https://eu.example.test/v2/items/{id}');
 delete doc.servers[0].variables.version.default;assert.ok(previewOpenApi(args(doc)).entries.every(item=>item.issue));
 const other=spec();other.paths['/items/{id}'].parameters=[];assert.match(previewOpenApi(args(other)).entries[0].issue,/template/);
 const ref=spec();ref.components={parameters:{'ítem~id':ref.paths['/items/{id}'].parameters[0]}};ref.paths['/items/{id}'].parameters=[{$ref:'#/components/parameters/%C3%ADtem~0id'}];assert.equal(previewOpenApi(args(ref)).compatible,2);
});
test('nullable enums still enforce allowed values, and malformed or circular body schemas do not import',()=>{
 const doc=spec(),schema=doc.paths['/items/{id}'].patch.requestBody.content['application/json'].schema;
 schema.properties.name={type:'string',nullable:true,enum:['ok']};
 assert.throws(()=>openApiRequest(connectors(doc)[1],{path:{id:'one'},body:{name:null}}),/enum/);
 schema.properties.name.enum.push(null);assert.equal(openApiRequest(connectors(doc)[1],{path:{id:'one'},body:{name:null}}).body,'{"name":null}');
 doc.components={schemas:{loop:{type:'object',properties:{next:{$ref:'#/components/schemas/loop'}}}}};
 schema.properties.name={$ref:'#/components/schemas/loop'};assert.match(previewOpenApi(args(doc)).entries[1].issue,/complex/);
});
test('invalid imported inputs fail before network dispatch or credential access',async t=>{
 const {runtime,store,calls}=fixture(t);store.state.connectors=connectors(spec());
 await assert.rejects(runtime.invokeConnector({name:store.state.connectors[0].name,input:{path:{id:'..'}}},new AbortController().signal),/relative/);
 assert.equal(calls(),0);
 store.state.connectors[0].url='https://changed.test/items/{id}';assert.throws(()=>runtime.validateConnector(store.state.connectors[0]),/does not match/);
});
