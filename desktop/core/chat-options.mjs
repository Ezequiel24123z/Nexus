export const efforts=['auto','none','minimal','low','medium','high','xhigh','max'];
export const routes=['auto','price','throughput','latency'];
export function validateChatOptions(input){
 const out={};
 if(input.model!==undefined){if(typeof input.model!=='string'||!input.model.trim()||input.model.length>180)throw new Error('Modelo no válido.');out.model=input.model.trim();}
 for(const [key,allowed] of [['reasoningEffort',efforts],['providerRouting',routes]])if(input[key]!==undefined){if(input[key]!==null&&!allowed.includes(input[key]))throw new Error('Ajuste no válido: '+key);out[key]=input[key];}
 return out;
}
export function validateModelCapabilities(options,model){
 if(!model)return; // Manual ids remain available when catalog is absent.
 if(Array.isArray(model.supported_parameters)&&!model.supported_parameters.includes('tools'))throw new Error('Este modelo no declara herramientas; elige uno compatible con tareas de agente.');
 const level=options.reasoningEffort,available=model.reasoning?.supported_efforts;
 if(level&&level!=='auto'&&Array.isArray(available)&&!available.includes(level))throw new Error('El modelo no admite el nivel de thinking elegido.');
 if(level==='none'&&model.reasoning?.mandatory)throw new Error('Este modelo requiere razonamiento.');
}
