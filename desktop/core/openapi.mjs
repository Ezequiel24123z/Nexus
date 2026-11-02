import {createHash} from 'node:crypto';

const methods = ['get','post','put','patch','delete'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value,key) => Object.hasOwn(value,key);
const fail = message => { throw new Error(message); };
const short = value => String(value || '').slice(0,600);
const safeKey = key => !['__proto__','prototype','constructor'].includes(key);
function https(value) {
  const url = new URL(value);
  if(url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /[{}\\]/.test(value)) fail('Server URL must be HTTPS without credentials, variables, query parameters, or fragments.');
  return url.href.replace(/\/$/,'');
}
function resolver(document) {
  return function resolve(value,seen=new Set()) {
    if(!object(value)) fail('Incomplete definition: expected an object.');
    if(!value.$ref) return value;
    const ref=value.$ref;
    if(typeof ref!=='string'||!ref.startsWith('#/')) fail('External references are not imported or downloaded.');
    if(seen.has(ref)||seen.size>=12) fail('Circular or overly deep reference.');
    let target=document;
    for(const part of decodeURIComponent(ref.slice(2)).split('/')) {
      if(/~(?![01])/.test(part))fail('Invalid local reference escape.');
      const key=part.replaceAll('~1','/').replaceAll('~0','~');
      if(!object(target)||!own(target,key)||!safeKey(key)) fail('Local reference not found.');
      target=target[key];
    }
    if(Object.keys(value).some(key=>!['$ref','description','summary'].includes(key))) fail('Reference with additional sibling fields is not supported.');
    return resolve(target,new Set([...seen,ref]));
  };
}
function schemaCopy(raw,resolve,depth=0,budget={left:300}) {
  if(depth>12||--budget.left<0) fail('Schema is too complex for this importer.');
  const schema=resolve(raw);
  const allowed=new Set(['type','properties','required','items','additionalProperties','enum','description','title','nullable','format','example','examples','default','deprecated']);
  for(const key of Object.keys(schema)) if(!allowed.has(key)&&!key.startsWith('x-')) fail('Unsupported schema keyword: '+key);
  if(!['object','array','string','number','integer','boolean'].includes(schema.type)) fail('Every schema must declare a supported primitive or container type.');
  const out={type:schema.type};
  if(schema.description) out.description=short(schema.description);
  if(schema.nullable===true)out.nullable=true;
  if(schema.format)out.format=short(schema.format);
  if(schema.enum) {
    if(!Array.isArray(schema.enum)||schema.enum.length>100||schema.enum.some(value=>object(value)||Array.isArray(value)))fail('Unsupported enum definition.');
    out.enum=schema.enum;
  }
  if(schema.type==='object') {
    out.properties={};
    if(schema.properties!==undefined&&!object(schema.properties))fail('Invalid schema properties.');
    for(const [key,value] of Object.entries(schema.properties||{})) {
      if(!safeKey(key))fail('Unsupported property name.');
      out.properties[key]=schemaCopy(value,resolve,depth+1,budget);
    }
    if(schema.required!==undefined&&(!Array.isArray(schema.required)||schema.required.some(key=>typeof key!=='string'||!safeKey(key))))fail('Invalid required properties.');
    out.required=schema.required||[];
    if(schema.additionalProperties!==undefined&&typeof schema.additionalProperties!=='boolean')fail('additionalProperties with a sub-schema is not supported.');
    out.additionalProperties=schema.additionalProperties!==false;
  }
  if(schema.type==='array')out.items=schemaCopy(schema.items,resolve,depth+1,budget);
  return out;
}
function authentication(document,operation,resolve,secretRef) {
  const requirements=operation.security??document.security??[];
  if(!Array.isArray(requirements)||requirements.some(item=>!object(item)))fail('Invalid authentication declaration.');
  if(!requirements.length||requirements.some(item=>!Object.keys(item).length))return '';
  const compatible=requirements.some(item=>{
    const names=Object.keys(item);
    if(names.length!==1||!Array.isArray(item[names[0]])||item[names[0]].length)return false;
    try {const scheme=resolve(document.components?.securitySchemes?.[names[0]]);return scheme.type==='http'&&String(scheme.scheme).toLowerCase()==='bearer';}catch{return false;}
  });
  if(!compatible)fail('Unsupported authentication scheme: currently public access or HTTP Bearer is supported.');
  if(!/^CONNECTOR_[A-Z0-9_]+$/.test(secretRef||''))fail('Esta operación necesita una referencia Bearer CONNECTOR_ configurada.');
  return secretRef;
}

/** Pure local planning. No fetch, credential lookup, or mutation. */
export function previewOpenApi({source,prefix='API',baseUrl='',secretRef=''},existing=[]) {
  if(typeof source!=='string'||Buffer.byteLength(source,'utf8')>2*1024*1024)fail('Use a JSON document of up to 2 MB.');
  let document;try{document=JSON.parse(source);}catch{fail('Not valid JSON. YAML is not supported in this importer.');}
  if(!object(document)||!/^3\.(0|1)\.\d+$/.test(document.openapi||''))fail('OpenAPI 3.0 and 3.1 in JSON format are supported.');
  if(!/^[\w -]{1,32}$/.test(prefix))fail('Prefix must be 1–32 ASCII letters, digits, spaces, underscores, or hyphens.');
  if(baseUrl)https(baseUrl);
  if(!object(document.paths))fail('Document does not contain paths.');
  const resolve=resolver(document),names=new Set(existing.map(item=>item.name)),entries=[];
  for(const [path,rawPath] of Object.entries(document.paths)) {
    if(path.startsWith('x-'))continue;
    if(entries.length>=500)fail('This importer supports up to 500 operations per document.');
    let pathItem;try{pathItem=resolve(rawPath);}catch(error){entries.push({id:'path:'+path,path,method:'—',name:'',issue:error.message});continue;}
    for(const method of [...methods,'head','options','trace']) {
      if(!own(pathItem,method))continue;
      if(entries.length>=500)fail('This importer supports up to 500 operations per document. Split the specification; the library itself has no such limit.');
      const id=method.toUpperCase()+' '+path,entry={id,path,method:method.toUpperCase(),name:'',description:'',issue:null};
      try {
        if(!methods.includes(method))fail('Unsupported HTTP method: '+method.toUpperCase());
        const operation=resolve(pathItem[method]);
        if(!path.startsWith('/')||path.startsWith('//')||/[?#\\\s]/.test(path)||path.split('/').some(part=>['.','..'].includes(part)||/%2e/i.test(part)))fail('Unsupported route path.');
        const server=operation.servers??pathItem.servers??document.servers;
        let serverUrl=baseUrl||server?.[0]?.url;
        if(!baseUrl&&server?.[0]?.variables)serverUrl=String(serverUrl).replace(/\{([^}]+)\}/g,(_,key)=>server[0].variables[key]?.default??'{'+key+'}');
        const root=https(serverUrl),parameters=new Map();
        for(const list of [pathItem.parameters||[],operation.parameters||[]]) {
          if(!Array.isArray(list))fail('Invalid parameters list.');
          const duplicate=new Set();
          for(const raw of list) {
            const parameter=resolve(raw),key=parameter.in+':'+parameter.name;
            if(duplicate.has(key))fail('Duplicate parameter: '+parameter.name);duplicate.add(key);parameters.set(key,parameter);
          }
        }
        const params=[...parameters.values()].map(parameter=>{
          if(!['path','query'].includes(parameter.in))fail('Parameter location '+parameter.in+' is not supported.');
          if(typeof parameter.name!=='string'||!parameter.name||!safeKey(parameter.name))fail('Invalid parameter name.');
          if(parameter.style&&parameter.style!==(parameter.in==='path'?'simple':'form')||parameter.allowReserved)fail('Unsupported parameter serialization style.');
          if(parameter.in==='path'&&parameter.required!==true)fail('Path parameters must be required.');
          const schema=schemaCopy(parameter.schema,resolve);
          if(['object','array'].includes(schema.type)||schema.nullable)fail('Path and query parameters must be non-null primitive values.');
          return {name:parameter.name,in:parameter.in,required:parameter.required===true,schema};
        });
        const placeholders=[...path.matchAll(/\{([^{}]+)\}/g)].map(match=>match[1]);
        if(/[{}]/.test(path.replace(/\{[^{}]+\}/g,''))||placeholders.some(key=>!params.some(p=>p.in==='path'&&p.name===key))||params.some(p=>p.in==='path'&&!placeholders.includes(p.name)))fail('Parameters do not match the route path template.');
        let body=null;
        if(operation.requestBody) {
          if(method==='get')fail('GET with request body is not supported.');
          const request=resolve(operation.requestBody),json=request.content?.['application/json'];
          if(!json)fail('Only application/json request bodies are supported.');
          body={required:request.required===true,schema:schemaCopy(json.schema,resolve)};
        }
        const bearer=authentication(document,operation,resolve,secretRef);
        const slug=String(operation.operationId||method+'_'+path).replace(/[^\w -]+/g,'_').slice(0,36);
        entry.name=(prefix+'_'+slug+'_'+createHash('sha256').update(id).digest('hex').slice(0,8)).slice(0,80);
        entry.description=short(operation.summary||operation.description||id);
        entry.connector={name:entry.name,description:entry.description,url:root+path,method:entry.method,secretRef:bearer,openapi:{version:1,baseUrl:root,path,method:entry.method,authenticationRequired:!!bearer,parameters:params,body}};
        if(Buffer.byteLength(JSON.stringify(entry.connector))>48000)fail('Operation definition is too large.');
        if(names.has(entry.name))fail('Already exists with this name. Change the prefix or keep the existing connector.');
        names.add(entry.name);
        entry.origin=new URL(root).origin;entry.endpoint=root+path;entry.authentication=bearer?'Bearer · '+bearer:'Sin credenciales';
      } catch(error) {entry.issue=error.message;delete entry.connector;}
      entries.push(entry);
    }
  }
  if(!entries.length)fail('No operations found.');
  return {title:short(document.info?.title)||'Untitled API',entries,compatible:entries.filter(item=>!item.issue).length};
}

export function importOpenApi(runtime,args) {
  const plan=previewOpenApi(args,runtime.store.state.connectors);
  if(!Array.isArray(args.selected)||!args.selected.length||new Set(args.selected).size!==args.selected.length)fail('Select operations without duplicates.');
  const additions=args.selected.map(id=>{const entry=plan.entries.find(item=>item.id===id);if(!entry?.connector||entry.issue)fail('Selection changed or contains incompatible operations. Review again.');runtime.validateConnector(entry.connector);return entry.connector;});
  const previous=runtime.store.state.connectors;
  runtime.store.state.connectors=[...previous,...additions];
  try{runtime.store.save(null);}catch(error){runtime.store.state.connectors=previous;throw error;}
  runtime.emit('change');
  return {imported:additions.length,names:additions.map(item=>item.name)};
}

export function validateOpenApiConnector(connector) {
  const config=connector.openapi;
  if(!object(config)||config.version!==1||!Array.isArray(config.parameters)||typeof config.path!=='string')fail('Invalid OpenAPI contract.');
  if(connector.url!==https(config.baseUrl)+config.path)fail('URL does not match the imported contract. Re-import to change the endpoint.');
  if(connector.method!==config.method)fail('Method does not match the imported contract.');
  if(config.authenticationRequired&&!connector.secretRef)fail('This operation requires a Bearer secret reference.');
}
function validateValue(value,schema,label,depth=0) {
  if(depth>12)fail('Input is nested too deeply.');
  if(value===null&&schema.nullable){if(schema.enum&&!schema.enum.includes(null))fail(label+': value outside enum.');return;}
  const valid=schema.type==='object'?object(value):schema.type==='array'?Array.isArray(value):schema.type==='integer'?Number.isSafeInteger(value):schema.type==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===schema.type;
  if(!valid)fail(label+': expected '+schema.type+'.');
  if(schema.enum&&!schema.enum.includes(value))fail(label+': value outside enum.');
  if(schema.type==='object') {
    for(const key of schema.required||[])if(!own(value,key))fail(label+': missing '+key+'.');
    for(const [key,item] of Object.entries(value)) {
      if(!safeKey(key))fail('Unsupported property.');
      if(own(schema.properties,key))validateValue(item,schema.properties[key],label+'.'+key,depth+1);
      else if(schema.additionalProperties===false)fail(label+': unknown property '+key+'.');
    }
  }
  if(schema.type==='array')for(const item of value)validateValue(item,schema.items,label+'[]',depth+1);
}
export function openApiRequest(connector,input={}) {
  validateOpenApiConnector(connector);
  if(!object(input)||Object.keys(input).some(key=>!['path','query','body'].includes(key)))fail('Use input.path, input.query, and input.body for this connector.');
  const config=connector.openapi,groups={path:input.path??{},query:input.query??{}};
  for(const [group,values] of Object.entries(groups)) {
    if(!object(values))fail(group+' must be an object.');
    for(const key of Object.keys(values))if(!config.parameters.some(p=>p.in===group&&p.name===key))fail('Unknown parameter: '+group+'.'+key);
  }
  let path=config.path;const query=new URLSearchParams();
  for(const parameter of config.parameters) {
    const values=groups[parameter.in],label=parameter.in+'.'+parameter.name;
    if(!own(values,parameter.name)){if(parameter.required)fail('Missing '+label);continue;}
    const value=values[parameter.name];validateValue(value,parameter.schema,label);
    if(parameter.in==='query')query.set(parameter.name,String(value));
    else {
      if(['.','..',''].includes(String(value)))fail('Empty or relative path parameter value is not allowed.');
      path=path.replaceAll('{'+parameter.name+'}',encodeURIComponent(String(value)));
    }
  }
  let body;
  if(own(input,'body')){if(!config.body)fail('This operation does not define a request body.');validateValue(input.body,config.body.schema,'body');body=JSON.stringify(input.body);}
  else if(config.body?.required)fail('Missing body.');
  const url=new URL(config.baseUrl+path);url.search=query.toString();
  return {url,body};
}
