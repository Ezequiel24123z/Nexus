import {EventEmitter} from 'node:events';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport,getDefaultEnvironment} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export function validateServer(server){
 if(!server || !/^[\w -]{1,80}$/.test(server.name))throw new Error('Nombre MCP no válido');
 if(!['stdio','http'].includes(server.transport))throw new Error('Transporte no válido');
 if(server.envSecrets && (typeof server.envSecrets!=='object'||Array.isArray(server.envSecrets)))throw new Error('Las variables deben ser un objeto JSON');
 if(server.transport==='stdio'){
  if(typeof server.command!=='string'||!server.command.trim())throw new Error('Falta el ejecutable MCP');
  if(!Array.isArray(server.args)||server.args.some(a=>typeof a!=='string'))throw new Error('Los argumentos deben ser una lista JSON de textos');
 }else{
  const url=new URL(server.url);
  if(url.username||url.password||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('MCP remoto requiere HTTPS; HTTP solo en localhost');
 }
 for(const reference of [...Object.values(server.envSecrets||{}),server.secretRef].filter(Boolean))if(typeof reference!=='string'||!/^CONNECTOR_[A-Z0-9_]+$/.test(reference))throw new Error('Utiliza referencias CONNECTOR_ para las credenciales');
}
export class McpManager extends EventEmitter{
 constructor(store,getSecret){super();this.store=store;this.getSecret=getSecret;this.sessions=new Map();this.pending=new Map();this.statuses=new Map();this.closed=false;}
 status({compact=false}={}){return Object.fromEntries([...this.statuses].map(([name,status])=>[name,compact?{...status,tools:(status.tools||[]).slice(0,20).map(tool=>({name:tool.name,description:String(tool.description||'').slice(0,600)})),toolCount:status.tools?.length||0}:status]));}
 mark(name,data){this.statuses.set(name,data);this.emit('change');}
 async connect(name){
  if(this.closed)throw new Error('MCP cerrado');
  if(this.sessions.has(name))return this.sessions.get(name);
  if(this.pending.has(name))return this.pending.get(name);
  const operation=this.open(name);this.pending.set(name,operation);
  try{return await operation;}finally{this.pending.delete(name);}
 }
 async open(name){
  const server=this.store.state.mcpServers.find(s=>s.name===name);if(!server)throw new Error('Servidor MCP no encontrado');validateServer(server);
  this.mark(name,{status:'connecting',tools:[]});
  const client=new Client({name:'nexus-desktop',version:'0.2.0'},{capabilities:{}});
  const secret=ref=>{const v=this.getSecret(ref);if(!v)throw new Error('Configura el secreto '+ref);return v;};
  try{
   let transport;
   if(server.transport==='stdio'){
    const env=getDefaultEnvironment();for(const [key,ref] of Object.entries(server.envSecrets||{}))env[key]=secret(ref);
    transport=new StdioClientTransport({command:server.command,args:server.args,cwd:server.cwd||undefined,env,stderr:'pipe'});
    transport.stderr?.on('data',()=>{}); // Do not persist server stderr: it may contain credentials.
   }else transport=new StreamableHTTPClientTransport(new URL(server.url),{requestInit:{redirect:'error',headers:server.secretRef?{Authorization:'Bearer '+secret(server.secretRef)}:{}}});
   await client.connect(transport,{timeout:30000});
   if(this.closed){await client.close();throw new Error('MCP cerrado');}
   const catalog=[];let cursor;const cursors=new Set();
   do{const result=await client.listTools(cursor?{cursor}:{},{timeout:30000});catalog.push(...result.tools);cursor=result.nextCursor;if(cursor&&cursors.has(cursor))throw new Error('Paginación MCP inválida');if(cursor)cursors.add(cursor);}while(cursor);
   const session={client,catalog};this.sessions.set(name,session);
   client.onclose=()=>{if(this.sessions.get(name)===session){this.sessions.delete(name);this.mark(name,{status:'disconnected',tools:[]});}};
   this.mark(name,{status:'connected',tools:catalog.map(t=>({name:t.name,description:t.description}))});return session;
  }catch(e){await client.close().catch(()=>{});this.mark(name,{status:'error',tools:[],error:'No se pudo conectar. Revisa ejecutable, argumentos, credenciales y disponibilidad.'});throw new Error('Conexión MCP fallida: '+name);}
 }
 async list(name){const session=await this.connect(name);return session.catalog;}
 async call(name,tool,args,signal){signal?.throwIfAborted();const session=await this.connect(name);signal?.throwIfAborted();if(!session.catalog.some(t=>t.name===tool))throw new Error('Herramienta no anunciada por el servidor');return session.client.callTool({name:tool,arguments:args||{}},undefined,{signal,timeout:300000});}
 async disconnect(name){
  // Await an in-flight handshake so removing a server cannot leave an orphan process.
  if(this.pending.has(name))await this.pending.get(name).catch(()=>{});
  const session=this.sessions.get(name);this.sessions.delete(name);if(session)await session.client.close();this.mark(name,{status:'disconnected',tools:[]});
 }
 async close(){this.closed=true;await Promise.allSettled([...new Set([...this.sessions.keys(),...this.pending.keys()])].map(name=>this.disconnect(name)));}
}
