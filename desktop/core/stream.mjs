import {createParser} from 'eventsource-parser';

// Expose explicit provider summaries and readable reasoning text to the user UI without resending hidden reasoning across turns.
const joinReasoning = reasoning => [...reasoning.values()]
  .filter(item => item && item.type !== 'reasoning.encrypted')
  .map(item => item.summary || item.text || item.plain || '')
  .filter(Boolean)
  .join('\n\n');

// Providers do not all expose citations in exactly the same streaming frame. Reduce them
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

export function normalizeAnthropicResponse(data = {}) {
  const blocks = Array.isArray(data.content) ? data.content : [];
  let text = '';
  const reasoning = [];
  const toolCalls = [];
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') text += block.text;
    else if (block?.type === 'thinking' && typeof block.thinking === 'string') reasoning.push({ type: 'thinking', summary: block.thinking });
    else if (block?.type === 'tool_use') {
      toolCalls.push({
        id: block.id || 'call_' + toolCalls.length,
        type: 'function',
        function: { name: block.name || '', arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }
  const usage = data.usage ? {
    prompt_tokens: (data.usage.input_tokens || 0) + (data.usage.cache_read_input_tokens || 0) + (data.usage.cache_creation_input_tokens || 0),
    completion_tokens: data.usage.output_tokens || 0,
    total_tokens: (data.usage.input_tokens || 0) + (data.usage.cache_read_input_tokens || 0) + (data.usage.cache_creation_input_tokens || 0) + (data.usage.output_tokens || 0),
    prompt_tokens_details: {
      cached_tokens: data.usage.cache_read_input_tokens ?? null,
      cache_write_tokens: data.usage.cache_creation_input_tokens ?? null,
    },
  } : undefined;
  const stopMap = { end_turn: 'stop', max_tokens: 'length', tool_use: 'tool_calls', stop_sequence: 'stop' };
  return {
    id: data.id || null,
    model: data.model || null,
    usage,
    choices: [{
      finish_reason: stopMap[data.stop_reason] || data.stop_reason || 'stop',
      message: {
        role: 'assistant',
        content: text || null,
        ...(reasoning.length ? { reasoning_details: reasoning } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
    }],
  };
}

export async function readAnthropicStream(response, { onText = () => {}, onReasoning = () => {}, onUsage = () => {}, onActivity = () => {}, onOutput = () => {}, onMetadata = () => {} } = {}) {
  const result = { id: null, model: null, choices: [{ message: { role: 'assistant', content: '' } }] };
  const message = result.choices[0].message;
  const blocks = new Map();
  let finished = false;
  let usageInput = 0, usageOutput = 0, cacheRead = null, cacheWrite = null;

  const emitUsage = () => {
    const promptTokens = usageInput + (cacheRead || 0) + (cacheWrite || 0);
    const normalized = {
      prompt_tokens: promptTokens,
      completion_tokens: usageOutput,
      total_tokens: promptTokens + usageOutput,
      prompt_tokens_details: {
        ...(cacheRead !== null ? { cached_tokens: cacheRead } : {}),
        ...(cacheWrite !== null ? { cache_write_tokens: cacheWrite } : {}),
      },
    };
    result.usage = normalized;
    onUsage(normalized);
  };

  const parser = createParser({
    onEvent(event) {
      if (!event.data || event.data === '[DONE]') return;
      const chunk = JSON.parse(event.data);
      if (chunk.type === 'error') {
        const detail = chunk.error?.message ? (' Detail: ' + String(chunk.error.message).slice(0, 300)) : '';
        throw new Error('The provider interrupted generation.' + detail + ' You can resume the task.');
      }
      if (chunk.type === 'message_start' && chunk.message) {
        result.id = chunk.message.id || result.id;
        result.model = chunk.message.model || result.model;
        onMetadata({ id: result.id, model: result.model });
        if (chunk.message.usage) {
          usageInput = chunk.message.usage.input_tokens || 0;
          if (typeof chunk.message.usage.cache_read_input_tokens === 'number') cacheRead = chunk.message.usage.cache_read_input_tokens;
          if (typeof chunk.message.usage.cache_creation_input_tokens === 'number') cacheWrite = chunk.message.usage.cache_creation_input_tokens;
          emitUsage();
        }
      } else if (chunk.type === 'content_block_start') {
        const b = chunk.content_block || {};
        blocks.set(chunk.index, {
          type: b.type,
          id: b.id || '',
          name: b.name || '',
          text: b.text || '',
          thinking: b.thinking || '',
          arguments: '',
        });
      } else if (chunk.type === 'content_block_delta') {
        const entry = blocks.get(chunk.index);
        const delta = chunk.delta || {};
        if (!entry) return;
        onOutput();
        if (delta.type === 'text_delta' && delta.text) {
          entry.text += delta.text;
          message.content += delta.text;
          onText(message.content);
        } else if (delta.type === 'thinking_delta' && delta.thinking) {
          entry.thinking += delta.thinking;
          const allThinking = [...blocks.values()].filter(b => b.type === 'thinking' && b.thinking).map(b => b.thinking).join('\n\n');
          if (allThinking) onReasoning(allThinking);
        } else if (delta.type === 'input_json_delta' && delta.partial_json) {
          entry.arguments += delta.partial_json;
        }
      } else if (chunk.type === 'message_delta') {
        if (chunk.delta?.stop_reason) {
          const stopMap = { end_turn: 'stop', max_tokens: 'length', tool_use: 'tool_calls', stop_sequence: 'stop' };
          result.choices[0].finish_reason = stopMap[chunk.delta.stop_reason] || chunk.delta.stop_reason;
          finished = true;
        }
        if (chunk.usage) {
          if (typeof chunk.usage.output_tokens === 'number') usageOutput = chunk.usage.output_tokens;
          emitUsage();
        }
      } else if (chunk.type === 'message_stop') {
        finished = true;
      }
    },
  });

  const reader = response.body.getReader(), decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done: eof } = await reader.read();
      if (eof) { parser.feed(decoder.decode()); break; }
      onActivity();
      parser.feed(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  if (!finished) throw new Error('Stream interrupted before completing the response. No partial tool calls were executed.');
  const ordered = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
  const toolCalls = ordered.filter(b => b.type === 'tool_use').map(b => ({
    id: b.id,
    type: 'function',
    function: { name: b.name, arguments: b.arguments || '{}' },
  }));
  if (toolCalls.length) {
    for (const call of toolCalls) if (!call.id || !call.function.name) throw new Error('Incomplete tool call in stream');
    message.tool_calls = toolCalls;
  }
  const thinkingBlocks = ordered.filter(b => b.type === 'thinking' && b.thinking).map(b => ({ type: 'thinking', summary: b.thinking }));
  if (thinkingBlocks.length) message.reasoning_details = thinkingBlocks;
  return result;
}

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
  if(chunk.provider)result.provider=chunk.provider;
  if(chunk.openrouter_metadata)result.openrouter_metadata=chunk.openrouter_metadata;
  const choice=chunk.choices?.[0];if(!choice)return;
  if(choice.finish_reason==='error')throw new Error('Generation terminated with a provider error.');
  if(choice.finish_reason){finished=true;result.choices[0].finish_reason=choice.finish_reason;}
  const delta=choice.delta||{};
  if(delta.content || delta.tool_calls?.length || delta.reasoning_details?.length || delta.reasoning || delta.reasoning_content || delta.annotations?.length)onOutput();
  if(delta.content){message.content+=delta.content;onText(message.content);}
  if(Array.isArray(delta.annotations))annotations.push(...delta.annotations);
  for(const call of delta.tool_calls||[]){
   const index=call.index??0,current=calls.get(index)||{id:'',type:'function',function:{name:'',arguments:''}};
   if(call.id)current.id=call.id;
   if(call.function?.name)current.function.name+=call.function.name;
   if(call.function?.arguments)current.function.arguments+=call.function.arguments;
   calls.set(index,current);
  }
  let reasoningUpdated = false;
  for(const detail of delta.reasoning_details||[]){
   const index=detail.index??reasoning.size,prior=reasoning.get(index);
   if(!prior)reasoning.set(index,{...detail});else for(const [key,value] of Object.entries(detail))prior[key]=['text','summary','data'].includes(key)?(prior[key]||'')+value:value;
   reasoningUpdated = true;
  }
  const plainReasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : (typeof delta.reasoning === 'string' ? delta.reasoning : '');
  if (plainReasoning && !(delta.reasoning_details?.length)) {
   const prior = reasoning.get('plain') || { type: 'reasoning', summary: '' };
   prior.summary = (prior.summary || '') + plainReasoning;
   reasoning.set('plain', prior);
   reasoningUpdated = true;
  }
  if(reasoningUpdated)onReasoning(joinReasoning(reasoning));
 }});
 const reader=response.body.getReader(),decoder=new TextDecoder();
 try{while(!done){const {value,done:eof}=await reader.read();if(eof){parser.feed(decoder.decode());break;}onActivity();parser.feed(decoder.decode(value,{stream:true}));}}finally{await reader.cancel().catch(()=>{});}
 if(!done&&!finished)throw new Error('Stream interrupted before completing the response. No partial tool calls were executed.');
 if(calls.size){message.tool_calls=[...calls.entries()].sort((a,b)=>a[0]-b[0]).map(([,call])=>call);for(const call of message.tool_calls)if(!call.id||!call.function.name)throw new Error('Incomplete tool call in stream');}
 if(reasoning.size)message.reasoning_details=[...reasoning.values()];
 if(annotations.length)message.annotations=annotations;
 return result;
}
