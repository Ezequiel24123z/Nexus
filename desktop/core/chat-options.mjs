export const efforts=['auto','none','minimal','low','medium','high','xhigh','max'];
export const routes=['auto','price','throughput','latency'];
export const agentModes=['agent','architect','explore','unrestricted'];
export function validateChatOptions(input){
 const out={};
 if(input.model!==undefined){if(typeof input.model!=='string'||!input.model.trim()||input.model.length>180)throw new Error('Invalid model identifier.');out.model=input.model.trim();}
 for(const [key,allowed] of [['reasoningEffort',efforts],['providerRouting',routes],['agentMode',agentModes]])if(input[key]!==undefined){if(input[key]!==null&&!allowed.includes(input[key]))throw new Error('Invalid option: '+key);out[key]=input[key];}
 return out;
}
export function validateModelCapabilities(options,model){
 if(!model)return; // Manual ids remain available when catalog is absent.
 if(Array.isArray(model.supported_parameters)&&!model.supported_parameters.includes('tools'))throw new Error('This model does not declare tool support; choose a model compatible with agent tasks.');
 const level=options.reasoningEffort,available=model.reasoning?.supported_efforts;
 if(level&&level!=='auto'&&Array.isArray(available)&&!available.includes(level))throw new Error('The selected model does not support the chosen thinking level.');
 if(level==='none'&&model.reasoning?.mandatory)throw new Error('This model requires reasoning to be enabled.');
}
