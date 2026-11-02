import {createParser} from 'eventsource-parser';

// Sólo se expone el resumen explícito del proveedor. El razonamiento literal o cifrado
// puede ser interno, variar entre proveedores y no es una explicación fiable para el usuario.
const joinReasoning = reasoning => [...reasoning.values()].map(item => item.summary || '').filter(Boolean).join('\n\n');

// Providers do not all expose citations in exactly the same streaming frame.  Reduce them
// to a safe, small UI shape so sources survive even if the prose omitted a Markdown link.
export const citationsFromAnnotations = (annotations = []) => {
 const seen=new Set(),sources=[];
 for(const annotation of Array.isArray(annotations)?annotations:[]){
  const citation=annotation?.url_citation || annotation?.citation || annotation;
  const url=citation?.url || annotation?.url;
  let parsed;
  try { parsed=new URL(url); } catch { continue; }
  if(!['http:','https:'].includes(parsed.protocol)||seen.has(parsed.href))continue;
  seen.add(parsed.href);
  const title=typeof citation?.title==='string'&&citation.title.trim()?citation.title.trim().slice(0,240):parsed.hostname;
  sources.push({url:parsed.href,title, ...(Number.isInteger(citation?.start_index)?{startIndex:citation.start_index}:{}), ...(Number.isInteger(citation?.end_index)?{endIndex:citation.end_index}:{})});
 }
 return sources;
};

export async function readCompletionStream(response,{onText=()=>{},onReasoning=()=>{},onUsage=()=>{},onActivity=()=>{},onOutput=()=>{},onMetadata=()=>{}}={}){
 const result={id:null,model:null,choices:[{message:{role:'assistant',content:''}}]};
 const message=result.choices[0].message,calls=new Map(),reasoning=new Map(),annotations=[];let done=false,finished=false;
 const parser=createParser({onEvent(event){
  if(event.data==='[DONE]'){done=true;return;}
  const chunk=JSON.parse(event.data);
  if(chunk.error){const detail=chunk.error?.message?(' Detail: '+String(chunk.error.message).slice(0,300)):'';throw new Error('The provider interrupted generation.'+detail+' You can resume the task.');}
  const changedMetadata=(chunk.id&&chunk.id!==result.id)||(chunk.model&&chunk.model!==result.model);
  result.id=chunk.id||result.id;result.model=chunk.model||result.model;
  if(changedMetadata)onMetadata({id:result.id,model:result.model});
  if(chunk.usage){result.usage={...result.usage,...chunk.usage};onOutput();onUsage(chunk.usage);}
  if(chunk.openrouter_metadata)result.openrouter_metadata=chunk.openrouter_metadata;
  const choice=chunk.choices?.[0];if(!choice)return;
  if(choice.finish_reason==='error')throw new Error('Generation terminated with a provider error.');
  if(choice.finish_reason){finished=true;result.choices[0].finish_reason=choice.finish_reason;}
  const delta=choice.delta||{};
  if(delta.content || delta.tool_calls?.length || delta.reasoning_details?.length || delta.reasoning || delta.annotations?.length)onOutput();
  if(delta.content){message.content+=delta.content;onText(message.content);}
  if(Array.isArray(delta.annotations))annotations.push(...delta.annotations);
  for(const call of delta.tool_calls||[]){
   const index=call.index??0,current=calls.get(index)||{id:'',type:'function',function:{name:'',arguments:''}};
   if(call.id)current.id=call.id;
   if(call.function?.name)current.function.name+=call.function.name;
   if(call.function?.arguments)current.function.arguments+=call.function.arguments;
   calls.set(index,current);
  }
  for(const detail of delta.reasoning_details||[]){
   const index=detail.index??reasoning.size,prior=reasoning.get(index);
   if(!prior)reasoning.set(index,{...detail});else for(const [key,value] of Object.entries(detail))prior[key]=['text','summary','data'].includes(key)?(prior[key]||'')+value:value;
  }
  if((delta.reasoning_details||[]).length)onReasoning(joinReasoning(reasoning));
 }});
 const reader=response.body.getReader(),decoder=new TextDecoder();
 try{while(!done){const {value,done:eof}=await reader.read();if(eof){parser.feed(decoder.decode());break;}onActivity();parser.feed(decoder.decode(value,{stream:true}));}}finally{await reader.cancel().catch(()=>{});}
 if(!done&&!finished)throw new Error('Stream interrupted before completing the response. No partial tool calls were executed.');
 if(calls.size){message.tool_calls=[...calls.entries()].sort((a,b)=>a[0]-b[0]).map(([,call])=>call);for(const call of message.tool_calls)if(!call.id||!call.function.name)throw new Error('Incomplete tool call in stream');}
 if(reasoning.size)message.reasoning_details=[...reasoning.values()];
 if(annotations.length)message.annotations=annotations;
 return result;
}
