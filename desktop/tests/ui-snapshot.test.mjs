import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {Runtime} from '../core/runtime.mjs';

function fixture(count=3,messages=140){
 const tasks=Array.from({length:count},(_,i)=>({id:'task-'+i,title:'Chat '+i,prompt:'Prompt '+i,status:i===0?'running':'paused',workspace:'folder-'+i,dependsOn:[],messages:[],conversation:Array.from({length:messages},(_,j)=>({id:i+'-'+j,role:'assistant',content:'Texto sintético '.repeat(50)})),events:[{id:'event-'+i,kind:'test',detail:{}}],effects:[],calls:[],contextTokens:3500,telemetry:{cost:0}}));
 return new Runtime({directory:'synthetic-unused-no-io',state:{tasks,settings:{contextWindow:50000,compressionPercent:95},projects:[],connectors:[],mcpServers:[]}}, {getSecret:()=>null});
}
test('UI snapshots contain paged details only for the subscribed chat; navigation remains available',()=>{
 const runtime=fixture();const view=runtime.snapshot('task-1');
 assert.equal(view.tasks[1].conversation.length,120);assert.equal(view.tasks[1].conversationStart,20);assert.equal(view.tasks[1].telemetry.cost,0);
 for(const i of [0,2]){const background=view.tasks[i];assert.equal(background.summaryOnly,true);assert.equal(background.id,'task-'+i);assert.equal(background.title,'Chat '+i);assert.deepEqual(background.dependsOn,[]);for(const key of ['conversation','events','calls','effects','liveText','telemetry','messages'])assert.equal(key in background,false);}
 assert.equal(runtime.snapshot().tasks[0].conversation.length,120);assert.equal(runtime.snapshot(null).tasks.every(task=>task.summaryOnly),true);
});
test('background histories are never accessed to build focused snapshots',()=>{
 const runtime=fixture();for(const key of ['conversation','events','calls','effects','messages'])Object.defineProperty(runtime.store.state.tasks[2],key,{get(){throw new Error('Background history read');}});
 assert.doesNotThrow(()=>runtime.snapshot('task-0'));assert.doesNotThrow(()=>runtime.snapshot(null));
});
test('switching subscriptions recovers the new current history and updates background statuses',()=>{
 const runtime=fixture();runtime.snapshot('task-0');runtime.store.state.tasks[1].conversation.push({id:'fresh',role:'assistant',content:'New result'});runtime.store.state.tasks[0].status='complete';
 const view=runtime.snapshot('task-1');assert.equal(view.tasks[1].conversation.at(-1).id,'fresh');assert.equal(view.tasks[0].status,'complete');assert.equal(view.tasks[0].summaryOnly,true);
});
test('approval details only travel for the visible chat, while status remains in navigation',()=>{
 const runtime=fixture();runtime.approvals.set('a',{taskId:'task-0',name:'tool',args:{private:'a'}});runtime.approvals.set('b',{taskId:'task-1',name:'tool',args:{private:'b'}});
 assert.deepEqual(runtime.snapshot('task-0').approvals.map(item=>item.id),['a']);assert.equal(runtime.snapshot(null).approvals.length,0);assert.equal(runtime.snapshot().approvals.length,2);
});
test('focused snapshot benchmark reduces synthetic serialized payload with 100 chats',t=>{
 const runtime=fixture(100,140);const measure=id=>{const start=performance.now();const output=JSON.stringify(runtime.snapshot(id));return {bytes:Buffer.byteLength(output),milliseconds:performance.now()-start};};
 const full=measure(undefined),focused=measure('task-0'),idle=measure(null);
 assert.ok(focused.bytes<full.bytes*.03);assert.ok(idle.bytes<full.bytes*.01);
 t.diagnostic(JSON.stringify({fixture:'100 chats, 140 messages each, 120 paged per chat',full,focused,idle,reductionPercent:100*(1-focused.bytes/full.bytes)}));
});
