// Provider-reported money and counters only. Unknown is not zero.
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export function normalizeUsage(usage, extra = {}) {
  return {at:new Date().toISOString(),...extra,input:number(usage?.prompt_tokens),output:number(usage?.completion_tokens),
    total:number(usage?.total_tokens),cached:number(usage?.prompt_tokens_details?.cached_tokens),
    cacheWrite:number(usage?.prompt_tokens_details?.cache_write_tokens),reasoning:number(usage?.completion_tokens_details?.reasoning_tokens),webSearchRequests:number(usage?.server_tool_use?.web_search_requests),cost:number(usage?.cost)};
}
export function aggregateUsage(calls = []) {
  const sum = field => {const known=calls.filter(c=>number(c[field])!==null);return known.length ? known.reduce((n,c)=>n+c[field],0) : null;};
  const comparable = calls.filter(c=>number(c.cached)!==null && number(c.input)!==null && c.cached<=c.input);
  const denominator = comparable.reduce((n,c)=>n+c.input,0);
  return {calls:calls.length,input:sum('input'),output:sum('output'),total:sum('total'),cost:sum('cost'),cached:sum('cached'),cacheWrite:sum('cacheWrite'),reasoning:sum('reasoning'),webSearchRequests:sum('webSearchRequests'),
    unknownCosts:calls.filter(c=>number(c.cost)===null).length,
    cacheCoverage:calls.length?comparable.length/calls.length:null,
    cacheHitRate:denominator ? comparable.reduce((n,c)=>n+c.cached,0)/denominator : null,
    latencyMs:sum('latencyMs')};
}
export async function readBalance(getSecret, request=fetch) {
  const result={at:new Date().toISOString(),remaining:null,keyRemaining:null,keyUnlimited:null,errors:[]};
  async function read(endpoint,key) {
    const r=await request('https://openrouter.ai/api/v1/'+endpoint,{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error(endpoint+': HTTP '+r.status);
    return (await r.json()).data;
  }
  const inference=getSecret('OPENROUTER_API_KEY'),management=getSecret('OPENROUTER_MANAGEMENT_KEY');
  await Promise.all([
    (async()=>{if(!inference)return;try{const d=await read('key',inference);result.keyRemaining=number(d.limit_remaining);result.keyUnlimited=d.limit===null;result.keyUsage=number(d.usage);}catch(e){result.errors.push(e.message);}})(),
    (async()=>{if(!management)return;try{const d=await read('credits',management);if(number(d.total_credits)!==null && number(d.total_usage)!==null)result.remaining=d.total_credits-d.total_usage;}catch(e){result.errors.push(e.message);}})()
  ]);
  return result;
}
