// Namespaced model IDs keep the provider attached to each chat, including after restart.
import {isNetworkFailure,networkFailure,providerHttpFailure} from './provider-errors.mjs';
export const arliModel = 'arliai/DeepSeek-V4.1-Flash-1017';
export function modelConnection(model='') {
  if(model.startsWith('arliai/'))return {id:'arliai',name:'Arli.ai',key:'ARLIAI_API_KEY',base:'https://api.arliai.com/v1',model:model.slice(7)};
  return {id:'openrouter',name:'OpenRouter',key:'OPENROUTER_API_KEY',base:'https://openrouter.ai/api/v1',model};
}

export function completionRequest({model,messages,settings,tools,outputLimit,effort,sessionId}) {
  const connection=modelConnection(model),arli=connection.id==='arliai';
  const level=effort||settings.reasoningEffort;
  const body={model:connection.model,messages,stream:Boolean(settings.streaming),
    ...(outputLimit>0?{[arli?'max_completion_tokens':'max_tokens']:outputLimit}:{}),
    ...(level!=='auto'?(arli?{reasoning_effort:level,include_reasoning:false}:{reasoning:{effort:level}}):{}),
    ...(tools?{tools,...(arli?{tool_choice:'auto'}:{provider:{require_parameters:true,...(settings.providerRouting!=='auto'?{sort:settings.providerRouting}:{})}})}:{}),
    ...(!arli&&sessionId?{session_id:sessionId}:{}),
    ...(arli&&settings.streaming?{stream_options:{include_usage:true}}:{})};
  return {connection,body,headers:{'Content-Type':'application/json',...(!arli?{'X-OpenRouter-Title':'NEXUS Desktop','X-OpenRouter-Metadata':'enabled'}:{})}};
}

export async function providerCatalog(provider,{sort='',request=fetch}={}) {
  const arli=provider==='arliai';
  const response=await request(arli?'https://api.arliai.com/model/all':'https://openrouter.ai/api/v1/models'+(sort?'?sort='+encodeURIComponent(sort):''),{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('Catálogo de '+(arli?'Arli.ai':'OpenRouter')+' no disponible ('+response.status+').');
  const data=await response.json();
  if(!arli)return data.data;
  if(!Array.isArray(data))throw new Error('Formato de catálogo Arli.ai no reconocido.');
  return data.filter(m=>m.status===true).map(m=>({
    id:'arliai/'+m.name,name:'Arli.ai · '+m.name,context_length:Number(m.contextSize),
    architecture:{input_modalities:m.vlm?['text','image']:['text']},
    ...(/^(DeepSeek|GLM|Qwen|MiMo)/.test(m.name)?{supported_parameters:['tools']}:{supported_parameters:[]}),
    reasoning:m.reasoning?{supported_efforts:m.name.startsWith('DeepSeek-V4')?['none','minimal','low','medium','high','xhigh','max']:['none','minimal','low','medium','high','xhigh']}:null,
    pricing:{},description:(m.modelRecommendation||'')+' · '+m.parameters+' · Contexto máximo del modelo; tu plan puede limitarlo.',
    provider:'arliai',available:true
  })).sort((a,b)=>Number(b.id===arliModel)-Number(a.id===arliModel));
}

export async function checkArliConnection(key,{request=fetch}={}) {
  if(!key)throw new Error('Guarda primero tu clave de Arli.ai.');
  let response;
  try{response=await request('https://api.arliai.com/v1/models',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(30000)});}catch(error){throw isNetworkFailure(error)?networkFailure(error,'Arli.ai'):error;}
  if(!response.ok)throw providerHttpFailure(response.status,'Arli.ai');
  const data=await response.json();
  const entries=Array.isArray(data)?data:data.data;
  if(!Array.isArray(entries))throw new Error('Arli.ai respondió, pero su catálogo de cuenta no tiene el formato esperado.');
  return {ok:true,models:entries.map(m=>({id:m.id||m.name,context:Number(m.context_length||m.max_context||m.context_window||m.contextSize)||null})),checkedAt:new Date().toISOString()};
}
