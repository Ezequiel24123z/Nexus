export const efforts=['auto','none','minimal','low','medium','high','xhigh','max'];
export const routes=['auto','price','throughput','latency'];
export const autonomyLevels=['interactive','semi-autopilot','autopilot','unrestricted'];
export const agentModes=['interactive','semi-autopilot','autopilot','unrestricted','agent','architect','explore'];
export function validateChatOptions(input){
 const out={};
 if(input.model!==undefined){if(typeof input.model!=='string'||!input.model.trim()||input.model.length>180)throw new Error('Invalid model identifier.');out.model=input.model.trim();}
 for(const [key,allowed] of [['reasoningEffort',efforts],['providerRouting',routes],['agentMode',agentModes]])if(input[key]!==undefined){if(input[key]!==null&&!allowed.includes(input[key]))throw new Error('Invalid option: '+key);out[key]=input[key];}
 if(input.contextWindow!==undefined){
   if(input.contextWindow!==null&&(!Number.isFinite(input.contextWindow)||input.contextWindow<8000||input.contextWindow>10000000))throw new Error('Context window must be between 8,000 and 10,000,000 tokens.');
   out.contextWindow=input.contextWindow===null?null:Math.round(input.contextWindow);
 }
 if(input.providerOrder!==undefined){
   if(input.providerOrder===null||input.providerOrder==='')out.providerOrder=null;
   else if(Array.isArray(input.providerOrder))out.providerOrder=input.providerOrder.map(s=>String(s).trim()).filter(Boolean).slice(0,12);
   else if(typeof input.providerOrder==='string')out.providerOrder=input.providerOrder.split(',').map(s=>s.trim()).filter(Boolean).slice(0,12);
   else throw new Error('Invalid provider order.');
 }
 if(input.temperature!==undefined){
   if(input.temperature!==null&&(typeof input.temperature!=='number'||!Number.isFinite(input.temperature)||input.temperature<0||input.temperature>2))throw new Error('Temperature must be between 0 and 2.');
   out.temperature=input.temperature;
 }
 if(input.systemPromptOverride!==undefined){
   if(input.systemPromptOverride!==null&&typeof input.systemPromptOverride!=='string')throw new Error('Invalid system prompt override.');
   out.systemPromptOverride=input.systemPromptOverride||'';
 }
 return out;
}
export function validateModelCapabilities(options,model){
 if(!model)return; // Manual ids remain available when catalog is absent.
 if(Array.isArray(model.supported_parameters)&&!model.supported_parameters.includes('tools'))throw new Error('This model does not declare tool support; choose a model compatible with agent tasks.');
 const level=options.reasoningEffort,available=model.reasoning?.supported_efforts;
 if(level&&level!=='auto'&&Array.isArray(available)&&!available.includes(level))throw new Error('The selected model does not support the chosen thinking level.');
 if(level==='none'&&model.reasoning?.mandatory)throw new Error('This model requires reasoning to be enabled.');
}
