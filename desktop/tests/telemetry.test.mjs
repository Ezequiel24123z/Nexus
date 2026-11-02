import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUsage,aggregateUsage,readBalance} from '../core/telemetry.mjs';

test('unknown telemetry stays null; reported free cost stays zero',()=>{
 const unknown=normalizeUsage(undefined),free=normalizeUsage({cost:0,prompt_tokens:12});
 assert.equal(unknown.cost,null);assert.equal(free.cost,0);
 assert.equal(aggregateUsage([]).cost,null);
 assert.equal(aggregateUsage([unknown,free]).unknownCosts,1);
});
test('cache rate is token weighted, not a mean of request percentages',()=>{
 const calls=[normalizeUsage({prompt_tokens:100,prompt_tokens_details:{cached_tokens:100},cost:.1}),normalizeUsage({prompt_tokens:900,prompt_tokens_details:{cached_tokens:0},cost:.2}),normalizeUsage({prompt_tokens:100})];
 const stats=aggregateUsage(calls);
 assert.equal(stats.cacheHitRate,.1);assert.equal(stats.cacheCoverage,2/3);assert.equal(stats.input,1100);assert.equal(stats.unknownCosts,1);
 assert.ok(Math.abs(stats.cost-.3)<1e-9);
});
test('balance uses separate keys and never substitutes key allowance for account credits',async()=>{
 const seen=[];
 const result=await readBalance(n=>n==='OPENROUTER_API_KEY'?'inference':'management',async(url,options)=>{
  seen.push({url,key:options.headers.Authorization});
  return new Response(JSON.stringify({data:url.endsWith('/key')?{limit:10,limit_remaining:7}:{total_credits:120,total_usage:20}}));
 });
 assert.equal(result.remaining,100);assert.equal(result.keyRemaining,7);
 assert.equal(seen.find(x=>x.url.endsWith('/credits')).key,'Bearer management');
});
test('missing management key and HTTP failures show unknown balance',async()=>{
 const missing=await readBalance(n=>n==='OPENROUTER_API_KEY'?'key':null,async()=>new Response(JSON.stringify({data:{limit:null,limit_remaining:null}})));
 assert.equal(missing.remaining,null);assert.equal(missing.keyUnlimited,true);
 const failure=await readBalance(()=> 'key',async()=>new Response('',{status:403}));
 assert.equal(failure.remaining,null);assert.equal(failure.errors.length,2);
});
