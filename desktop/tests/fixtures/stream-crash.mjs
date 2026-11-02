// Local provider simulator for a real process-termination test. No network/key required.
import {Store} from '../../core/store.mjs';
import {Runtime} from '../../core/runtime.mjs';
const store=new Store(process.argv[2]);
const payload={id:'gen-synthetic-crash-917',model:'test/model',usage:{prompt_tokens:100,completion_tokens:5,cost:.001},choices:[{delta:{content:'Texto recuperable: español y emoji 🧪.',tool_calls:[{index:0,id:'unfinished',function:{name:'write_file',arguments:'{"path":'}}]}}]};
const runtime=new Runtime(store,{getSecret:()=> 'synthetic',request:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(payload)+'\n\n'));}}),{headers:{'Content-Type':'text/event-stream'}})});
let ready=false;runtime.on('change',()=>{if(!ready&&store.state.tasks.some(task=>task.liveText?.includes('🧪'))){ready=true;console.log('READY');}});
runtime.create({prompt:'Ensayo de caída de proceso',model:'test/model'});
setInterval(()=>{},5000);
