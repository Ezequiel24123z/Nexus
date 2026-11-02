import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {readArtifact} from './artifacts.mjs';
import {catalogPage,functionTargets} from './capabilities.mjs';

export async function workspacePath(root, requested = '.', allowMissing = false) {
  const realRoot = await fs.realpath(root);
  const candidate = path.resolve(realRoot, requested);
  const within = value => value === realRoot || (!path.relative(realRoot, value).startsWith('..') && !path.isAbsolute(path.relative(realRoot, value)));
  if (!within(candidate)) throw new Error('Ruta fuera de la carpeta del proyecto.');
  let resolved;
  try { resolved = await fs.realpath(candidate); }
  catch (error) {
    if (!allowMissing || error.code !== 'ENOENT') throw error;
    let ancestor = path.dirname(candidate);
    while (true) {
      try { resolved = await fs.realpath(ancestor); break; }
      catch (e) { if (e.code !== 'ENOENT' || ancestor === path.dirname(ancestor)) throw e; ancestor = path.dirname(ancestor); }
    }
  }
  if (!within(resolved)) throw new Error('El enlace sale de la carpeta del proyecto.');
  return candidate;
}

export function command(executable, args, { cwd, signal, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelado'));
    const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', stopped = false;
    const stop = () => {
      stopped = true;
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    };
    const timer = timeout > 0 ? setTimeout(stop, timeout) : null;
    signal?.addEventListener('abort', stop, { once: true });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
    child.stdout.on('data', data => { output = (output + data).slice(-48000); });
    child.stderr.on('data', data => { output = (output + data).slice(-48000); });
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => { cleanup(); if (stopped) reject(new Error('Comando detenido o tiempo agotado.')); else resolve({ exitCode: code, output }); });
  });
}

const def = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
const str = description => ({ type: 'string', description });
export const baseTools = [
  def('search_capabilities','Busca skills o funciones reutilizables por nombre, descripción y etiquetas. Consulta primero el catálogo antes de recrear un procedimiento. Sólo devuelve metadatos paginados.',{query:str('Texto a buscar'),kind:{type:'string',enum:['all','skill','function']},offset:{type:'integer',minimum:0}}),
  def('get_capability','Carga bajo demanda las instrucciones de una skill o una función y su esquema de herramienta. No ejecuta la función.',{id:str('Identificador encontrado en search_capabilities')},['id']),
  def('save_capability','Crea o actualiza una skill o función reutilizable local. En actualizaciones usa id y revision obtenidos con get_capability. Las funciones son una herramienta existente con argumentos predeterminados, sin bucles anidados. Nunca guardes valores de secretos.',{id:str('ID sólo para actualizar'),revision:{type:'integer',minimum:1},kind:{type:'string',enum:['skill','function']},name:str('Nombre descriptivo'),description:str('Cuándo usarla'),tags:{type:'array',items:{type:'string'}},enabled:{type:'boolean'},instructions:str('Instrucciones de la skill'),tool:{type:'string',enum:functionTargets},defaults:{type:'object',additionalProperties:true}},['kind','name','description']),
  def('invoke_function','Ejecuta una función local descubierta. Los argumentos de input sustituyen los valores predeterminados. Se aplican las mismas aprobaciones, diario y permisos de su herramienta real.',{id:str('ID de función'),input:{type:'object',additionalProperties:true}},['id']),
  def('list_attachments','Lista los archivos adjuntos a este chat, también después de una compresión.',{}),
  def('read_attachment','Lee texto UTF-8 por partes o devuelve la ruta local del original para procesar otros formatos. Offset y length se expresan en bytes; usa next para continuar.',{id:str('ID del adjunto'),offset:{type:'integer',minimum:0},length:{type:'integer',minimum:1,maximum:24000}},['id']),
  def('list_mcp_servers','Busca servidores MCP configurados con metadatos paginados.',{query:str('Texto a buscar'),offset:{type:'integer',minimum:0}}),
  def('list_mcp_tools','Busca herramientas MCP con metadatos paginados. Indica tool para cargar solamente el esquema de la herramienta elegida.',{server:str('Nombre del servidor'),query:str('Búsqueda'),offset:{type:'integer',minimum:0},tool:str('Nombre exacto para obtener esquema completo')},['server']),
  def('invoke_mcp','Ejecuta una herramienta MCP usando exactamente su esquema descubierto.',{server:str('Servidor'),tool:str('Herramienta'),input:{type:'object',additionalProperties:true}},['server','tool']),
  def('list_files', 'Lista archivos. En modo autónomo admite rutas absolutas fuera del proyecto.', { path: str('Ruta relativa o absoluta') }),
  def('read_file', 'Lee un archivo UTF-8, hasta 100 KB.', { path: str('Ruta relativa') }, ['path']),
  def('search_files', 'Busca texto literal en archivos del proyecto, omitiendo dependencias y binarios. Devuelve rutas y números de línea.', { query:str('Texto literal'), path:str('Subcarpeta relativa opcional') }, ['query']),
  def('write_file', 'Crea o reemplaza un archivo. Conserva copia de seguridad automática. Documenta el motivo.', { path: str('Ruta relativa'), content: str('Contenido completo'), reason: str('Por qué cambia') }, ['path', 'content', 'reason']),
  def('replace_text', 'Reemplaza un fragmento exacto y único. Falla si no coincide. Genera backup.', { path: str('Ruta relativa'), oldText: str('Texto exacto'), newText: str('Reemplazo'), reason: str('Motivo') }, ['path', 'oldText', 'newText', 'reason']),
  def('run_command', 'Ejecuta PowerShell con los permisos de Windows del usuario. No está aislado. Sin caducidad automática; el usuario puede pausar.', { command: str('Comando PowerShell'), reason: str('Propósito') }, ['command', 'reason']),
  def('document_progress', 'Registra decisiones, archivos cambiados, pruebas, errores y próximos pasos. Obligatorio antes de terminar y antes de comprimir.', { decisions: str('Decisiones y motivos'), changes: str('Archivos y cambios'), verification: str('Pruebas y resultados'), next: str('Pendiente y riesgos') }, ['decisions', 'changes', 'verification', 'next']),
  def('list_effects', 'Lista efectos externos recientes y su estado recuperable: observado, incierto o pendiente de conciliación.', {}),
  def('reconcile_effect', 'Documenta el estado real de un efecto tras comprobarlo con evidencia. No confirmes ni repitas una acción sin verificar.', {id:str('Identificador de efecto'),status:{type:'string',enum:['confirmed','uncertain','not_found']},evidence:str('Prueba concreta: salida, recurso, consulta o archivo observado')}, ['id','status','evidence']),
  def('search_journal', 'Busca detalles originales en el diario persistente incluso tras comprimir contexto.', { query: str('Texto a buscar') }, ['query']),
  def('search_history', 'Busca literalmente en el historial original, incluidos mensajes previos a la compresión. Usa offset para paginar.', {query:str('Texto literal'),offset:{type:'integer',minimum:0}}, ['query']),
  def('read_artifact', 'Lee un fragmento acotado de un resultado grande guardado localmente.', {id:str('Identificador del artefacto'),offset:{type:'integer',minimum:0},length:{type:'integer',minimum:1,maximum:24000}}, ['id']),
  def('read_checkpoint', 'Sin argumentos lista los resúmenes que guardó cada compresión; con checkpoints:[N] lee un fragmento acotado de su resumen o de los mensajes originales.', { checkpoints:{type:'array',items:{type:'integer',minimum:1},description:'Números de checkpoint a leer; omítelo para listarlos.'}, section:{type:'string',enum:['summary','messages'],description:'Qué leer (por defecto summary).'}, offset:{type:'integer',minimum:0}, length:{type:'integer',minimum:1,maximum:20000} }),
  def('list_connectors', 'Busca metadatos REST por nombre y descripción; después usa get_connector para consultar parámetros de una operación.', {query:str('Búsqueda'),offset:{type:'integer',minimum:0}}),
  def('get_connector', 'Lee el contrato de un conector, sin ejecutarlo. Para OpenAPI usa input.path, input.query e input.body según su contrato.', {name:str('Nombre del conector')}, ['name']),
  def('create_connector', 'Crea una definición REST reutilizable. Usa un nombre de secreto en vez de incluir su valor.', { name: str('Nombre único'), url: str('URL HTTPS'), method: { type: 'string', enum: ['GET','POST','PUT','PATCH','DELETE'] }, description: str('Qué permite hacer'), secretRef: str('Nombre opcional de secreto, nunca el valor'), idempotencyHeader:{type:'boolean',description:'Sólo si la API acepta Idempotency-Key para reintentos seguros'}, reconciliationUrl:str('GET HTTPS opcional; puede usar {operationId} para comprobar un efecto') }, ['name','url','method','description']),
  def('invoke_connector', 'Llama a un conector configurado. La llamada queda documentada en el diario.', { name: str('Nombre del conector'), input: { type: 'object', additionalProperties: true } }, ['name']),
  def('verify_effect', 'Comprueba un efecto incierto con la URL de conciliación configurada para su conector.', {id:str('Identificador de efecto')}, ['id']),
  def('retry_effect', 'Reintenta un efecto incierto de conector sólo si éste declara soporte Idempotency-Key. Conserva la misma clave de operación.', {id:str('Identificador de efecto')}, ['id']),
  def('desktop_screenshot', 'Captura la pantalla principal y la entrega al modelo. Usa la escala indicada para coordenadas físicas.', {}),
  def('desktop_action', 'Controla ratón/teclado de Windows. Usa una captura reciente y verifica el resultado.', { action: { type:'string', enum:['click','double_click','type','key','scroll'] }, x:{type:'integer'}, y:{type:'integer'}, text:str('Texto literal o tecla: ENTER, TAB, ESC, CTRL+A, CTRL+C, CTRL+V, ALT+TAB'), amount:{type:'integer'} }, ['action']),
];

// Cada compresión guarda su resumen y los mensajes originales en checkpoint-N.json dentro
// del directorio de datos de la tarea, no en la carpeta del proyecto: por eso esta rama vive
// antes de la comprobación de task.workspace. Así el detalle exacto sigue siendo recuperable
// sin volver a inflar el contexto.
const checkpointName = /^checkpoint-(\d+)\.json$/;
async function readCheckpoint(store, task, args = {}) {
  const directory = store.directoryFor(task.id);
  const requested = args.checkpoints === undefined ? null : args.checkpoints;
  if (requested !== null && (!Array.isArray(requested) || !requested.length || requested.some(n => !Number.isInteger(n) || n < 1))) throw new Error('Lista de checkpoints no válida: usa enteros positivos.');
  const numbers = requested === null ? null : [...new Set(requested)].sort((a, b) => a - b);
  const section = args.section === undefined ? 'summary' : args.section;
  if (!['summary','messages'].includes(section)) throw new Error('Sección no válida: usa summary o messages.');
  const offset = args.offset === undefined ? 0 : args.offset;
  const length = args.length === undefined ? 8000 : Math.min(args.length, 20000);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 1) throw new Error('Rango no válido: offset >= 0 y length entre 1 y 20000.');
  const available = (await fs.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; }))
    .filter(name => checkpointName.test(name))
    .map(name => Number(checkpointName.exec(name)[1]))
    .sort((a, b) => a - b);
  if (numbers === null) {
    const checkpoints = [];
    for (const n of available) {
      const data = JSON.parse(await fs.readFile(path.join(directory, 'checkpoint-' + n + '.json'), 'utf8'));
      const summary = typeof data.summary === 'string' ? data.summary : '';
      const serialized = JSON.stringify(data.messages || []);
      checkpoints.push({ checkpoint:n, at:data.at, summaryChars:summary.length, messageCount:(data.messages || []).length, messagesBytes:Buffer.byteLength(serialized,'utf8') });
    }
    return { available, checkpoints, hint:'Usa checkpoints:[N] con section, offset y length para leer el detalle exacto guardado antes de comprimir.' };
  }
  const results = [];
  for (const n of numbers) {
    const file = 'checkpoint-' + n + '.json';
    const raw = await fs.readFile(path.join(directory, file), 'utf8').catch(() => null);
    if (raw === null) throw new Error('Checkpoint ' + n + ' no encontrado en esta tarea. Disponibles: ' + (available.join(', ') || 'ninguno') + '.');
    const data = JSON.parse(raw);
    const summary = typeof data.summary === 'string' ? data.summary : '';
    const serialized = JSON.stringify(data.messages || []);
    const content = section === 'summary' ? summary : serialized;
    results.push({ checkpoint:n, file, at:data.at, section, offset, length:Math.max(0, Math.min(length, content.length - offset)), totalChars:content.length, messageCount:(data.messages || []).length, summaryChars:summary.length, content:content.slice(offset, offset + length), next:offset + length < content.length ? offset + length : null });
  }
  return results.length === 1 ? results[0] : { checkpoints: results };
}

export async function executeTool(runtime, task, name, args, signal, effect) {
  const store = runtime.store;
  if(name==='search_capabilities')return runtime.capabilities.list({query:args.query,kind:args.kind,offset:args.offset,limit:20});
  if(name==='get_capability'){const entry=runtime.capabilities.get(args.id);return {...entry,...(entry.kind==='function'?{schema:baseTools.find(tool=>tool.function.name===entry.tool)?.function.parameters}:{})};}
  if(name==='save_capability'){const entry=runtime.capabilities.save(args);runtime.emit('change');return {saved:true,id:entry.id,revision:entry.revision};}
  if(name==='list_attachments')return task.attachments||[];
  if(name==='read_attachment'){
    const result=await runtime.attachments.read(task,args.id,{offset:args.offset??0,length:args.length??8000});
    if(result.attachment.kind==='image')return {...result,image:'data:'+result.attachment.mime+';base64,'+(await fs.readFile(result.path)).toString('base64'),name:result.attachment.name};
    return result;
  }
  if(name==='list_effects')return task.effects.slice(-60);
  if(name==='reconcile_effect')return store.updateEffect(task,args.id,args.status,{evidence:args.evidence,reconciledAt:new Date().toISOString()});
  if(name==='verify_effect')return runtime.verifyEffect(task,args.id,signal);
  if(name==='retry_effect')return runtime.retryEffect(task,args.id,signal);
  if(name==='list_mcp_servers')return catalogPage(store.state.mcpServers.map(s=>({name:s.name,transport:s.transport})),{query:args.query,offset:args.offset,limit:20});
  if(name==='list_mcp_tools'){
    const tools=await runtime.mcp.list(args.server);
    if(args.tool){const tool=tools.find(item=>item.name===args.tool);if(!tool)throw new Error('Herramienta MCP no encontrada.');return tool;}
    return catalogPage(tools.map(tool=>({name:tool.name,description:(tool.description||'').slice(0,600)})),{query:args.query,offset:args.offset,limit:20});
  }
  if(name==='invoke_mcp')return runtime.mcp.call(args.server,args.tool,args.input,signal);
  if(name==='search_history'){
    if(typeof args.query!=='string')throw new Error('Consulta no válida');
    const data=await fs.readFile(path.join(store.directoryFor(task.id),'transcript.jsonl'),'utf8').catch(()=> '');
    const matches=data.split('\n').filter(line=>line && line.toLowerCase().includes(args.query.toLowerCase()));
    const offset=Number.isInteger(args.offset)&&args.offset>=0?args.offset:0;
    return {total:matches.length,offset,entries:matches.slice(offset,offset+10).map(line=>JSON.parse(line)),next:offset+10<matches.length?offset+10:null};
  }
  if(name==='read_artifact')return readArtifact(store,task,args.id,args.offset || 0,args.length || 8000);
  if(name==='read_checkpoint')return readCheckpoint(store,task,args);
  if (name === 'document_progress') {
    task.lastProgressStep=task.steps;
    task.progressDue=false;
    const entry = store.journal(task, 'progress', args);
    return { saved: true, entry: entry.id };
  }
  if (name === 'search_journal') {
    const data = await fs.readFile(path.join(store.directoryFor(task.id), 'journal.jsonl'), 'utf8').catch(() => '');
    return { entries: data.split('\n').filter(line => line.toLowerCase().includes(String(args.query).toLowerCase())).slice(-30).map(line => JSON.parse(line)) };
  }
  if (name === 'list_connectors') return catalogPage(store.state.connectors.map(item=>({name:item.name,method:item.method,description:String(item.description||'').slice(0,600),imported:!!item.openapi})),{query:args.query,offset:args.offset,limit:20});
  if (name === 'get_connector') {const connector=store.state.connectors.find(item=>item.name===args.name);if(!connector)throw new Error('Conector no encontrado.');return connector;}
  if (name === 'create_connector') {
    runtime.validateConnector(args);
    if (store.state.connectors.some(c => c.name === args.name)) throw new Error('Ya existe un conector con ese nombre.');
    store.state.connectors.push(args); store.save();
    return { saved: true, name: args.name };
  }
  if (name === 'invoke_connector') return runtime.invokeConnector(args, signal, effect);
  if (name.startsWith('desktop_')) {
    if (!store.state.settings.desktopEnabled) throw new Error('Control de escritorio desactivado en ajustes.');
    return runtime.desktop(name, args, signal);
  }
  if (!task.workspace) throw new Error('Elige una carpeta de proyecto para usar archivos o terminal.');
  if (name === 'run_command') return command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', args.command], { cwd: task.workspace, signal, timeout:0 });
  const resolvePath = store.state.settings.autonomous ? async(root,requested='.')=>path.resolve(root,requested) : workspacePath;
  const target = await resolvePath(task.workspace, args.path, name === 'write_file');
  if (name === 'list_files') {
    return (await fs.readdir(target, { withFileTypes: true })).slice(0, 500).map(entry => ({ name: entry.name, directory: entry.isDirectory(), link: entry.isSymbolicLink() }));
  }
  if (name === 'search_files') {
    if(typeof args.query !== 'string' || !args.query.trim()) throw new Error('Indica el texto a buscar.');
    const matches = []; let visited = 0;
    const walk = async directory => {
      for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
        signal.throwIfAborted();
        if(matches.length>=100 || visited>=2000)return;
        if(entry.isSymbolicLink() || ['node_modules','.git','dist','release','.next'].includes(entry.name))continue;
        const filename = await resolvePath(task.workspace,path.relative(task.workspace,path.join(directory,entry.name)));
        if(entry.isDirectory()){await walk(filename);continue;}
        visited++;
        if((await fs.stat(filename)).size>200000)continue;
        const text=await fs.readFile(filename,'utf8');if(text.includes('\u0000'))continue;
        text.split(/\r?\n/).forEach((line,index)=>{if(matches.length<100 && line.toLowerCase().includes(args.query.toLowerCase()))matches.push({path:path.relative(task.workspace,filename),line:index+1,text:line.slice(0,400)});});
      }
    };
    await walk(target);return {matches,visited,bounded:visited>=2000||matches.length>=100};
  }
  if (name === 'read_file') {
    if ((await fs.stat(target)).size > 100000) throw new Error('Archivo mayor de 100 KB. Usa un comando acotado para leer el fragmento necesario.');
    return { path: args.path, content: await fs.readFile(target, 'utf8') };
  }
  if (['write_file','replace_text'].includes(name)) {
    const previous = await fs.readFile(target, 'utf8').catch(error => { if(error.code === 'ENOENT') return null; throw error; });
    let content = args.content;
    if (name === 'replace_text') {
      if (!args.oldText || previous === null || previous.split(args.oldText).length !== 2) throw new Error('El texto debe coincidir exactamente una vez.');
      content = previous.replace(args.oldText, () => args.newText);
    }
    if (typeof content !== 'string' || Buffer.byteLength(content) > 500000) throw new Error('Contenido no válido o mayor de 500 KB.');
    let backup = null;
    if (previous !== null) {
      backup = path.join(store.directoryFor(task.id), 'backup-' + crypto.randomUUID() + '.txt');
      await fs.writeFile(backup, previous);
    }
    store.journal(task, 'write_intent', { path: target, reason: args.reason, backup, existed: previous !== null });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
    store.journal(task, 'file_change', { path: target, reason: args.reason, backup, bytes: Buffer.byteLength(content) });
    return { written: args.path, backup, bytes: Buffer.byteLength(content) };
  }
  throw new Error('Herramienta desconocida: ' + name);
}
