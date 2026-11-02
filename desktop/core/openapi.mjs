import {createHash} from 'node:crypto';

const methods = ['get','post','put','patch','delete'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value,key) => Object.hasOwn(value,key);
const fail = message => { throw new Error(message); };
const short = value => String(value || '').slice(0,600);
const safeKey = key => !['__proto__','prototype','constructor'].includes(key);
function https(value) {
  const url = new URL(value);
  if(url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /[{}\\]/.test(value)) fail('El servidor debe ser HTTPS, sin credenciales, variables, consulta ni fragmento.');
  return url.href.replace(/\/$/,'');
}
function resolver(document) {
  return function resolve(value,seen=new Set()) {
    if(!object(value)) fail('Definición incompleta: se esperaba un objeto.');
    if(!value.$ref) return value;
    const ref=value.$ref;
    if(typeof ref!=='string'||!ref.startsWith('#/')) fail('Las referencias externas no se importan ni se descargan.');
    if(seen.has(ref)||seen.size>=12) fail('Referencia circular o demasiado profunda.');
    let target=document;
    for(const part of decodeURIComponent(ref.slice(2)).split('/')) {
      if(/~(?![01])/.test(part))fail('Escape de referencia local no válido.');
      const key=part.replaceAll('~1','/').replaceAll('~0','~');
      if(!object(target)||!own(target,key)||!safeKey(key)) fail('Referencia local no encontrada.');
      target=target[key];
    }
    // Structural $ref siblings have version-dependent semantics: do not guess.
    if(Object.keys(value).some(key=>!['$ref','description','summary'].includes(key))) fail('Referencia con campos adicionales no compatible.');
    return resolve(target,new Set([...seen,ref]));
  };
}
function schemaCopy(raw,resolve,depth=0,budget={left:300}) {
  if(depth>12||--budget.left<0) fail('Esquema demasiado complejo para este importador.');
  const schema=resolve(raw);
  const allowed=new Set(['type','properties','required','items','additionalProperties','enum','description','title','nullable','format','example','examples','default','deprecated']);
  for(const key of Object.keys(schema)) if(!allowed.has(key)&&!key.startsWith('x-')) fail('Esquema todavía no compatible: '+key);
  if(!['object','array','string','number','integer','boolean'].includes(schema.type)) fail('Cada esquema debe declarar un tipo simple compatible.');
  const out={type:schema.type};
  if(schema.description) out.description=short(schema.description);
  if(schema.nullable===true)out.nullable=true;
  // Formats are annotations; validation is limited to type, enum and structure.
  if(schema.format)out.format=short(schema.format);
  if(schema.enum) {
    if(!Array.isArray(schema.enum)||schema.enum.length>100||schema.enum.some(value=>object(value)||Array.isArray(value)))fail('Enumeración no compatible.');
    out.enum=schema.enum;
  }
  if(schema.type==='object') {
    out.properties={};
    if(schema.properties!==undefined&&!object(schema.properties))fail('Propiedades no válidas.');
    for(const [key,value] of Object.entries(schema.properties||{})) {
      if(!safeKey(key))fail('Nombre de propiedad no compatible.');
      out.properties[key]=schemaCopy(value,resolve,depth+1,budget);
    }
    if(schema.required!==undefined&&(!Array.isArray(schema.required)||schema.required.some(key=>typeof key!=='string'||!safeKey(key))))fail('Propiedades requeridas no válidas.');
    out.required=schema.required||[];
    if(schema.additionalProperties!==undefined&&typeof schema.additionalProperties!=='boolean')fail('additionalProperties con esquema todavía no compatible.');
    out.additionalProperties=schema.additionalProperties!==false;
  }
  if(schema.type==='array')out.items=schemaCopy(schema.items,resolve,depth+1,budget);
  return out;
}
function authentication(document,operation,resolve,secretRef) {
  const requirements=operation.security??document.security??[];
  if(!Array.isArray(requirements)||requirements.some(item=>!object(item)))fail('Declaración de autenticación no válida.');
  if(!requirements.length||requirements.some(item=>!Object.keys(item).length))return '';
  const compatible=requirements.some(item=>{
    const names=Object.keys(item);
    if(names.length!==1||!Array.isArray(item[names[0]])||item[names[0]].length)return false;
    try {const scheme=resolve(document.components?.securitySchemes?.[names[0]]);return scheme.type==='http'&&String(scheme.scheme).toLowerCase()==='bearer';}catch{return false;}
  });
  if(!compatible)fail('Autenticación no compatible: por ahora se admite acceso público o Bearer.');
  if(!/^CONNECTOR_[A-Z0-9_]+$/.test(secretRef||''))fail('Esta operación necesita una referencia Bearer CONNECTOR_ configurada.');
  return secretRef;
}

/** Pure local planning. No fetch, credential lookup, or mutation. */
export function previewOpenApi({source,prefix='API',baseUrl='',secretRef=''},existing=[]) {
  if(typeof source!=='string'||Buffer.byteLength(source,'utf8')>2*1024*1024)fail('Usa un documento JSON de hasta 2 MB.');
  let document;try{document=JSON.parse(source);}catch{fail('No es JSON válido. Esta versión no importa YAML.');}
  if(!object(document)||!/^3\.(0|1)\.\d+$/.test(document.openapi||''))fail('Se admite OpenAPI 3.0 y 3.1 en JSON.');
  if(!/^[\w -]{1,32}$/.test(prefix))fail('El prefijo debe tener entre 1 y 32 letras sin tildes, números, espacios o guiones.');
  if(baseUrl)https(baseUrl);
  if(!object(document.paths))fail('El documento no contiene paths.');
  const resolve=resolver(document),names=new Set(existing.map(item=>item.name)),entries=[];
  for(const [path,rawPath] of Object.entries(document.paths)) {
    if(path.startsWith('x-'))continue;
    if(entries.length>=500)fail('Este importador admite hasta 500 operaciones por documento.');
    let pathItem;try{pathItem=resolve(rawPath);}catch(error){entries.push({id:'path:'+path,path,method:'—',name:'',issue:error.message});continue;}
    for(const method of [...methods,'head','options','trace']) {
      if(!own(pathItem,method))continue;
      if(entries.length>=500)fail('Este importador admite hasta 500 operaciones por documento. Divide la definición; la biblioteca no tiene este límite.');
      const id=method.toUpperCase()+' '+path,entry={id,path,method:method.toUpperCase(),name:'',description:'',issue:null};
      try {
        if(!methods.includes(method))fail('Método todavía no compatible: '+method.toUpperCase());
        const operation=resolve(pathItem[method]);
        if(!path.startsWith('/')||path.startsWith('//')||/[?#\\\s]/.test(path)||path.split('/').some(part=>['.','..'].includes(part)||/%2e/i.test(part)))fail('Ruta no compatible.');
        const server=operation.servers??pathItem.servers??document.servers;
        let serverUrl=baseUrl||server?.[0]?.url;
        if(!baseUrl&&server?.[0]?.variables)serverUrl=String(serverUrl).replace(/\{([^}]+)\}/g,(_,key)=>server[0].variables[key]?.default??'{'+key+'}');
        const root=https(serverUrl),parameters=new Map();
        for(const list of [pathItem.parameters||[],operation.parameters||[]]) {
          if(!Array.isArray(list))fail('Parámetros no válidos.');
          const duplicate=new Set();
          for(const raw of list) {
            const parameter=resolve(raw),key=parameter.in+':'+parameter.name;
            if(duplicate.has(key))fail('Parámetro duplicado: '+parameter.name);duplicate.add(key);parameters.set(key,parameter);
          }
        }
        const params=[...parameters.values()].map(parameter=>{
          if(!['path','query'].includes(parameter.in))fail('Parámetro '+parameter.in+' todavía no compatible.');
          if(typeof parameter.name!=='string'||!parameter.name||!safeKey(parameter.name))fail('Nombre de parámetro no válido.');
          if(parameter.style&&parameter.style!==(parameter.in==='path'?'simple':'form')||parameter.allowReserved)fail('Serialización de parámetro todavía no compatible.');
          if(parameter.in==='path'&&parameter.required!==true)fail('Un parámetro de ruta debe ser obligatorio.');
          const schema=schemaCopy(parameter.schema,resolve);
          if(['object','array'].includes(schema.type)||schema.nullable)fail('Los parámetros de ruta y consulta deben ser valores simples no nulos.');
          return {name:parameter.name,in:parameter.in,required:parameter.required===true,schema};
        });
        const placeholders=[...path.matchAll(/\{([^{}]+)\}/g)].map(match=>match[1]);
        if(/[{}]/.test(path.replace(/\{[^{}]+\}/g,''))||placeholders.some(key=>!params.some(p=>p.in==='path'&&p.name===key))||params.some(p=>p.in==='path'&&!placeholders.includes(p.name)))fail('Los parámetros no coinciden con la plantilla de ruta.');
        let body=null;
        if(operation.requestBody) {
          if(method==='get')fail('GET con cuerpo no compatible.');
          const request=resolve(operation.requestBody),json=request.content?.['application/json'];
          if(!json)fail('Sólo se admiten cuerpos application/json.');
          body={required:request.required===true,schema:schemaCopy(json.schema,resolve)};
        }
        const bearer=authentication(document,operation,resolve,secretRef);
        const slug=String(operation.operationId||method+'_'+path).replace(/[^\w -]+/g,'_').slice(0,36);
        entry.name=(prefix+'_'+slug+'_'+createHash('sha256').update(id).digest('hex').slice(0,8)).slice(0,80);
        entry.description=short(operation.summary||operation.description||id);
        entry.connector={name:entry.name,description:entry.description,url:root+path,method:entry.method,secretRef:bearer,openapi:{version:1,baseUrl:root,path,method:entry.method,authenticationRequired:!!bearer,parameters:params,body}};
        if(Buffer.byteLength(JSON.stringify(entry.connector))>48000)fail('Definición de operación demasiado grande.');
        if(names.has(entry.name))fail('Ya existe este nombre. Cambia el prefijo o conserva el conector actual.');
        names.add(entry.name);
        entry.origin=new URL(root).origin;entry.endpoint=root+path;entry.authentication=bearer?'Bearer · '+bearer:'Sin credenciales';
      } catch(error) {entry.issue=error.message;delete entry.connector;}
      entries.push(entry);
    }
  }
  if(!entries.length)fail('No se encontraron operaciones.');
  return {title:short(document.info?.title)||'API sin título',entries,compatible:entries.filter(item=>!item.issue).length};
}

export function importOpenApi(runtime,args) {
  const plan=previewOpenApi(args,runtime.store.state.connectors);
  if(!Array.isArray(args.selected)||!args.selected.length||new Set(args.selected).size!==args.selected.length)fail('Selecciona operaciones sin duplicados.');
  const additions=args.selected.map(id=>{const entry=plan.entries.find(item=>item.id===id);if(!entry?.connector||entry.issue)fail('La selección cambió o contiene operaciones no compatibles. Vuelve a revisar.');runtime.validateConnector(entry.connector);return entry.connector;});
  const previous=runtime.store.state.connectors;
  runtime.store.state.connectors=[...previous,...additions];
  try{runtime.store.save(null);}catch(error){runtime.store.state.connectors=previous;throw error;}
  runtime.emit('change');
  return {imported:additions.length,names:additions.map(item=>item.name)};
}

export function validateOpenApiConnector(connector) {
  const config=connector.openapi;
  if(!object(config)||config.version!==1||!Array.isArray(config.parameters)||typeof config.path!=='string')fail('Contrato OpenAPI no válido.');
  if(connector.url!==https(config.baseUrl)+config.path)fail('La URL no coincide con el contrato importado. Reimporta para cambiar el endpoint.');
  if(connector.method!==config.method)fail('El método no coincide con el contrato importado.');
  if(config.authenticationRequired&&!connector.secretRef)fail('Esta operación requiere una referencia Bearer.');
}
function validateValue(value,schema,label,depth=0) {
  if(depth>12)fail('Entrada demasiado profunda.');
  if(value===null&&schema.nullable){if(schema.enum&&!schema.enum.includes(null))fail(label+': valor fuera de la enumeración.');return;}
  const valid=schema.type==='object'?object(value):schema.type==='array'?Array.isArray(value):schema.type==='integer'?Number.isSafeInteger(value):schema.type==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===schema.type;
  if(!valid)fail(label+': se esperaba '+schema.type+'.');
  if(schema.enum&&!schema.enum.includes(value))fail(label+': valor fuera de la enumeración.');
  if(schema.type==='object') {
    for(const key of schema.required||[])if(!own(value,key))fail(label+': falta '+key+'.');
    for(const [key,item] of Object.entries(value)) {
      if(!safeKey(key))fail('Propiedad no compatible.');
      if(own(schema.properties,key))validateValue(item,schema.properties[key],label+'.'+key,depth+1);
      else if(schema.additionalProperties===false)fail(label+': propiedad desconocida '+key+'.');
    }
  }
  if(schema.type==='array')for(const item of value)validateValue(item,schema.items,label+'[]',depth+1);
}
export function openApiRequest(connector,input={}) {
  validateOpenApiConnector(connector);
  if(!object(input)||Object.keys(input).some(key=>!['path','query','body'].includes(key)))fail('Usa input.path, input.query e input.body para este conector.');
  const config=connector.openapi,groups={path:input.path??{},query:input.query??{}};
  for(const [group,values] of Object.entries(groups)) {
    if(!object(values))fail(group+' debe ser un objeto.');
    for(const key of Object.keys(values))if(!config.parameters.some(p=>p.in===group&&p.name===key))fail('Parámetro desconocido: '+group+'.'+key);
  }
  let path=config.path;const query=new URLSearchParams();
  for(const parameter of config.parameters) {
    const values=groups[parameter.in],label=parameter.in+'.'+parameter.name;
    if(!own(values,parameter.name)){if(parameter.required)fail('Falta '+label);continue;}
    const value=values[parameter.name];validateValue(value,parameter.schema,label);
    if(parameter.in==='query')query.set(parameter.name,String(value));
    else {
      if(['.','..',''].includes(String(value)))fail('Valor de ruta vacío o relativo no permitido.');
      path=path.replaceAll('{'+parameter.name+'}',encodeURIComponent(String(value)));
    }
  }
  let body;
  if(own(input,'body')){if(!config.body)fail('Esta operación no define un cuerpo.');validateValue(input.body,config.body.schema,'body');body=JSON.stringify(input.body);}
  else if(config.body?.required)fail('Falta body.');
  const url=new URL(config.baseUrl+path);url.search=query.toString();
  return {url,body};
}
