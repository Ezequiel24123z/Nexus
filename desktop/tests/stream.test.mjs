import test from 'node:test';
import assert from 'node:assert/strict';
import {citationsFromAnnotations,readCompletionStream} from '../core/stream.mjs';
const chunk=delta=>`data: ${JSON.stringify(delta)}\r\n\r\n`;
function response(text){const bytes=new TextEncoder().encode(text);return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close();}}));}
test('stream handles fragmented Unicode, keepalives, terminal usage and text',async()=>{
 let live='',usage;
 const r=await readCompletionStream(response(': heartbeat\n\n'+chunk({id:'gen-1',choices:[{delta:{content:'¡Sí, español!'}}]})+chunk({choices:[{delta:{},finish_reason:'stop'}],usage:{cost:.01,total_tokens:10}})+'data: [DONE]\n\n'),{onText:text=>live=text,onUsage:u=>usage=u});
 assert.equal(live,'¡Sí, español!');assert.equal(r.usage.cost,.01);assert.equal(usage.total_tokens,10);
});
test('stream retains OpenRouter routing metadata from the terminal frame',async()=>{
 const r=await readCompletionStream(response(chunk({choices:[{delta:{content:'ok'},finish_reason:'stop'}],openrouter_metadata:{provider:'test-provider',route:'test'}})+'data: [DONE]\n\n'));
 assert.equal(r.openrouter_metadata.provider,'test-provider');
});
test('stream reconstructs fragmented tool arguments before execution',async()=>{
 const r=await readCompletionStream(response(chunk({choices:[{delta:{tool_calls:[{index:0,id:'call-1',function:{name:'read_file',arguments:'{"path":'}}]}}]})+chunk({choices:[{delta:{tool_calls:[{index:0,function:{arguments:'"test.txt"}'}}]},finish_reason:'tool_calls'}]})+'data: [DONE]\n\n'));
 assert.deepEqual(JSON.parse(r.choices[0].message.tool_calls[0].function.arguments),{path:'test.txt'});
});
test('stream errors and prematurely closed connections never masquerade as success',async()=>{
 await assert.rejects(readCompletionStream(response(chunk({error:{message:'failure'}}))));
 await assert.rejects(readCompletionStream(response(chunk({choices:[{delta:{content:'unfinished'}}]}))));
});
test('stream exposes readable reasoning and keeps encrypted details out of the text',async()=>{
 let reasoning='',live='';
 const r=await readCompletionStream(response(
  chunk({choices:[{delta:{reasoning_details:[{index:0,type:'reasoning.summary',summary:'Analizo '}]}}]})+
  chunk({choices:[{delta:{reasoning_details:[{index:0,type:'reasoning.summary',summary:'la tarea.'}]}}]})+
  chunk({choices:[{delta:{reasoning_details:[{index:1,type:'reasoning.encrypted',data:'c2VjcmV0'}]}}]})+
  chunk({choices:[{delta:{content:'Hecho'},finish_reason:'stop'}]})+'data: [DONE]\n\n'),{onText:text=>live=text,onReasoning:text=>reasoning=text});
 assert.equal(reasoning,'Analizo la tarea.');
 assert.equal(live,'Hecho');
 assert.equal(r.choices[0].message.reasoning_details.length,2);
});

test('stream keeps structured URL annotations while rejecting unsafe source links',async()=>{
 const r=await readCompletionStream(response(chunk({choices:[{delta:{content:'Respuesta',annotations:[{type:'url_citation',url_citation:{url:'https://docs.example.test/page',title:'Fuente oficial'}},{url:'javascript:alert(1)',title:'unsafe'}]},finish_reason:'stop'}]})+'data: [DONE]\n\n'));
 assert.equal(r.choices[0].message.annotations.length,2);
 assert.deepEqual(citationsFromAnnotations(r.choices[0].message.annotations),[{url:'https://docs.example.test/page',title:'Fuente oficial'}]);
});

test('heartbeat bytes signal activity without pretending the provider has generated output',async()=>{
 let activity=0,output=0;
 await readCompletionStream(response(': keepalive\n\n'+'data: [DONE]\n\n'),{onActivity:()=>activity++,onOutput:()=>output++});
 assert.ok(activity>0);assert.equal(output,0);
 await readCompletionStream(response(chunk({choices:[{delta:{reasoning_details:[{type:'reasoning.encrypted',data:'opaque'}]},finish_reason:'stop'}]})+'data: [DONE]\n\n'),{onOutput:()=>output++});
 assert.equal(output,1);
});
