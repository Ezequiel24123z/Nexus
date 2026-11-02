const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, desktopCapturer, screen, protocol, net, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const os = require('node:os');
const execFileAsync = require('node:util').promisify(execFile);
const bridgeIndex = process.argv.indexOf('--vault-bridge');
const bridgeRequest = bridgeIndex > -1 ? { dir: process.argv[bridgeIndex + 1] } : null;
// Smoke runs always use a fresh store, even if launched without the test environment flag.
if (process.argv.includes('--smoke-test')) process.env.NEXUS_TEST_DATA = fs.mkdtempSync(path.join(os.tmpdir(),'nexus-smoke-'));

protocol.registerSchemesAsPrivileged([{ scheme:'nexus', privileges:{ standard:true, secure:true, supportFetchAPI:true } }]);
app.setName('NEXUS');
const { resolveDataDirectory } = require('./core/datadir.cjs');
// Carpeta de datos canónica: estable aunque el lanzador redirija %APPDATA% (p. ej. LocalCache de paquetes MSIX).
app.setPath('userData',resolveDataDirectory({ fallbackAppData: app.getPath('appData') }));
let win, runtime, store, mcp, drafts;
let secrets = {};
const modelCatalog=new Map();
// Nombre con marca de tiempo para conservar el vault anterior antes de sobrescribirlo.
function vaultStamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
const allowedWorkspaces = new Set();
const userDirectory = () => resolveDataDirectory({ fallbackAppData: app.getPath('appData') });
function saveSecrets() {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado de Windows no está disponible.');
  const target = path.join(userDirectory(),'vault.bin');
  // Copia del vault anterior: nunca se pierden claves por escribir un estado en memoria incompleto.
  if (fs.existsSync(target)) { try { fs.copyFileSync(target, path.join(userDirectory(),'vault-backup-' + vaultStamp() + '.bin')); } catch (error) { console.error('NEXUS: no se pudo copiar el vault antes de guardar', error); } }
  // Escritura atómica: un corte de luz a mitad no deja un vault truncado.
  const temp = target + '.tmp';
  fs.writeFileSync(temp, safeStorage.encryptString(JSON.stringify(secrets)));
  fs.renameSync(temp, target);
}
function runBridge() {
  app.setPath('userData', bridgeRequest.dir);
  app.whenReady().then(() => {
    try {
      const data = JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(bridgeRequest.dir, 'vault.bin'))));
      process.stdout.write('NEXUS_VAULT_JSON:' + JSON.stringify(data) + '\n');
      app.exit(0);
    } catch (error) {
      process.stderr.write('NEXUS_VAULT_ERROR:' + String((error && error.message) || error) + '\n');
      app.exit(1);
    }
  });
}
async function readLegacyVault(directory) {
  const args = app.isPackaged ? ['--vault-bridge', directory] : [__dirname, '--vault-bridge', directory];
  const { stdout } = await execFileAsync(process.execPath, args, { timeout: 30000, windowsHide: true, maxBuffer: 1048576 });
  const marker = 'NEXUS_VAULT_JSON:';
  const index = stdout.lastIndexOf(marker);
  if (index < 0) throw new Error('El proceso auxiliar no devolvió datos.');
  return JSON.parse(stdout.slice(index + marker.length).split('\n')[0]);
}

async function main() {
  let activeUiTask=null;
  let recoverySelection=null,recoveryBusy=false;
  const {recoveryJob}=await import('./core/recovery-jobs.mjs');
  const {functionTargets,catalogPage}=await import('./core/capabilities.mjs');
  const {previewOpenApi,importOpenApi}=await import('./core/openapi.mjs');
  const {inspectContext,contextSection,inspectCosts,previewCheckpoint}=await import('./core/context-inspector.mjs');
  const connectorRevision=value=>require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const {searchConversation,conversationWindow,taskResults,previewTaskResult}=await import('./core/chat-workspace.mjs');
  const {validateChatOptions,validateModelCapabilities}=await import('./core/chat-options.mjs');
  const {modelConnection,providerCatalog,checkArliConnection,checkProviderConnection,SECRET_KEYS,PROVIDERS}=await import('./core/providers.mjs');
  const {inspectGitWorkspace,executeGitOperation,inspectSystemEnvironment,detectLocalCopilotToken,scaffoldMcpServer,runSelfImprovement,runCodeDiagnostics}=await import('./core/coding-engine.mjs');
  const { assertImageCapability } = await import('./core/attachments.mjs');
  async function checkAttachmentModel(ids,model,task) {
    const files=runtime.attachments.resolve(ids||[]);
    const retained=(task?.messages||[]).flatMap(message=>Array.isArray(message.content)?message.content.filter(part=>part.type==='nexus_attachment').map(part=>part.attachment):[]);
    if(![...files,...retained].some(file=>file.kind==='image'))return;
    if(!modelCatalog.has(model)){
      const entries=await providerCatalog(modelConnection(model,store.state.settings).id,{settings:store.state.settings});
      for(const item of entries)modelCatalog.set(item.id,item);
    }
    assertImageCapability([...files,...retained],modelCatalog.get(model));
  }
  const { externalWebUrl } = await import('./core/web-links.mjs');
  const { Store } = await import('./core/store.mjs');
  const { DraftStore } = await import('./core/drafts.mjs');
  const { Runtime } = await import('./core/runtime.mjs');
  const { readBalance } = await import('./core/telemetry.mjs');
  const { McpManager,validateServer } = await import('./core/mcp.mjs');
  const { command, workspacePath } = await import('./core/tools.mjs');
  store = new Store(userDirectory());
  drafts=new DraftStore(userDirectory());
  for(const draft of drafts.items.values())if(draft.workspace)allowedWorkspaces.add(draft.workspace);
  for (const task of store.state.tasks) if (task.workspace) allowedWorkspaces.add(task.workspace);
  for (const project of store.state.projects) if (project.workspace) allowedWorkspaces.add(project.workspace);
  const vault = path.join(userDirectory(),'vault.bin');
  if (fs.existsSync(vault)) {
    try { secrets = JSON.parse(safeStorage.decryptString(fs.readFileSync(vault))); }
    catch (error) {
      // El vault no se pudo descifrar (otra cuenta de Windows, DPAPI cambiado o archivo dañado).
      // Se aparta en lugar de dejar un vault vacío que una escritura posterior destruiría.
      let rescue = '';
      try { rescue = path.join(userDirectory(),'vault-unreadable-' + vaultStamp() + '.bin'); fs.copyFileSync(vault, rescue); fs.renameSync(vault, vault + '.unreadable'); } catch (error2) { console.error('NEXUS: no se pudo apartar el vault ilegible', error2); }
      console.error('NEXUS: vault.bin ilegible, se conserva copia en ' + rescue, error);
      dialog.showErrorBox('NEXUS · Credenciales', 'No se pudo desbloquear la clave guardada. Se conservó una copia en ' + (rescue || 'la carpeta de datos') + ' y el archivo original como vault.bin.unreadable. Vuelve a añadir las claves en Ajustes.');
    }
  }
  if (!process.env.NEXUS_TEST_DATA) try {
    const { mergeLegacyData } = await import('./core/migrate.mjs');
    const migrated = mergeLegacyData({
      store,
      dataDir: userDirectory(),
      localAppData: path.join(process.env.USERPROFILE || app.getPath('home'), 'AppData', 'Local'),
    });
    for (const item of migrated.dirs) {
      if (item.vault !== 'pendiente') continue;
      try {
        const legacySecrets = await readLegacyVault(item.dir);
        let added = 0;
        for (const [name, value] of Object.entries(legacySecrets || {})) if (!(name in secrets)) { secrets[name] = value; added += 1; }
        if (added) saveSecrets();
        const entry = store.state.recoveredFrom.find(item2 => item2.dir === item.dir);
        if (entry) entry.vault = added ? 'importado' : 'sin novedades';
      } catch (error) {
        console.error('NEXUS: no se pudieron importar las claves heredadas de ' + item.dir, error);
        const entry = store.state.recoveredFrom.find(item2 => item2.dir === item.dir);
        if (entry) entry.vault = 'no se pudo descifrar (copia conservada)';
      }
    }
    store.save();
    for (const task of store.state.tasks) if (task.workspace) allowedWorkspaces.add(task.workspace);
    for (const project of store.state.projects) if (project.workspace) allowedWorkspaces.add(project.workspace);
    if (migrated.dirs.length) console.log('NEXUS: datos heredados importados de ' + migrated.dirs.length + ' ubicación(es).');
  } catch (error) { console.error('NEXUS: no se pudo completar la importación de datos heredados.', error); }
  mcp=new McpManager(store,name=>secrets[name]);
  runtime = new Runtime(store, {
    mcp,
    getSecret: name => secrets[name],
    desktop: async (name,args,signal) => {
      if (process.platform !== 'win32') throw new Error('Este controlador requiere Windows.');
      const wasVisible = win?.isVisible();
      if(wasVisible)win.minimize();
      await new Promise(resolve=>setTimeout(resolve,600));
      try {
      if (name === 'desktop_screenshot') {
        const display = screen.getPrimaryDisplay();
        const width = Math.round(display.size.width * display.scaleFactor), height = Math.round(display.size.height * display.scaleFactor);
        const sources = await desktopCapturer.getSources({ types:['screen'], thumbnailSize:{width:Math.min(width,1600),height:Math.min(height,1000)} });
        const source = sources.find(s => s.display_id === String(display.id)) || sources[0];
        if (!source) throw new Error('No se pudo capturar la pantalla.');
        return { image:source.thumbnail.toDataURL(), dimensions:{ physicalWidth:width,physicalHeight:height,image:source.thumbnail.getSize(),origin:display.bounds, note:'Convierte las coordenadas de la imagen a píxeles físicos antes de hacer clic.' } };
      }
      if (!['click','double_click','type','key','scroll'].includes(args.action)) throw new Error('Acción de escritorio no admitida');
      const encoded = Buffer.from(JSON.stringify(args),'utf8').toString('base64');
      let script = path.join(__dirname,'native','desktop.ps1');
      if (app.isPackaged) script = script.replace('app.asar','app.asar.unpacked');
      return await command('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Payload',encoded],{signal,timeout:15000});
      } finally { if(wasVisible && win && !win.isDestroyed())win.restore(); }
    }
  });
  void runtime.capabilities;
  protocol.handle('nexus', request => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Forbidden',{status:403});
    const file = path.resolve(__dirname,'ui','.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    const root = path.resolve(__dirname,'ui');
    if (!file.startsWith(root + path.sep)) return new Response('Forbidden',{status:403});
    return net.fetch(pathToFileURL(file).toString());
  });
  win = new BrowserWindow({ width:1500,height:950,minWidth:920,minHeight:680,backgroundColor:'#ffffff',title:'NEXUS',
    webPreferences:{ preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,offscreen:process.argv.includes('--smoke-test') },
    show:!process.argv.includes('--smoke-test')
  });
  win.removeMenu();
  let closing=false,closeApproved=false,draftsClientReady=false;
  ipcMain.on('nexus:drafts:ready',event=>{if(event.sender===win.webContents)draftsClientReady=true;});
  win.webContents.on('did-start-loading',()=>{draftsClientReady=false;});
  win.webContents.on('render-process-gone',()=>{draftsClientReady=false;if(closing){closing=false;win.close();}});
  win.on('close',event=>{
    if(closeApproved||!draftsClientReady||win.webContents.isDestroyed())return;
    event.preventDefault();
    if(!closing){closing=true;win.webContents.send('nexus:before-close');}
  });
  ipcMain.on('nexus:drafts:closed',(event,ok)=>{
    if(event.sender!==win.webContents||!closing)return;
    closing=false;if(ok===true){closeApproved=true;win.close();}
  });
  if(process.argv.includes('--smoke-test'))win.webContents.setBackgroundThrottling(false);
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.on('will-navigate',event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_,__,callback) => callback(false));
  runtime.on('change',() => { if(win && !win.isDestroyed()) win.webContents.send('nexus:change',runtime.snapshot(activeUiTask)); });
  mcp.on('change',()=>runtime.emit('change'));
  ipcMain.handle('nexus:invoke', async (event, method, args = {}) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !event.senderFrame.url.startsWith('nexus://app/')) throw new Error('Origin not permitted');
    switch(method) {
      case 'getDrafts': {
        const result=drafts.list();
        for(const draft of Object.values(result.items)){
          const attachments=draft.attachmentIds.map(id=>{try{return runtime.attachments.resolve([id])[0];}catch{return {id,name:'Unavailable attachment',kind:'file',bytes:0,missing:true};}});
          result.items[draft.key]={...draft,attachments};
        }
        return result;
      }
      case 'saveDraft':
        if(args.workspace&&!allowedWorkspaces.has(args.workspace))throw new Error('Select the draft folder first.');
        return drafts.save(args);
      case 'clearDraft': return drafts.clear(args.key,args.revision);
      case 'openExternal': return shell.openExternal(externalWebUrl(args.url));
      case 'snapshot': return runtime.snapshot(activeUiTask);
      case 'inspectContext': return inspectContext(runtime,store.task(args.id));
      case 'contextSection': return contextSection(runtime,store.task(args.id),args);
      case 'inspectCosts': return inspectCosts(store.task(args.id),args);
      case 'checkpointPreview': return previewCheckpoint(store,store.task(args.id),args);
      case 'storageInfo': return store.storageInfo();
      case 'capabilitiesPage': return {...runtime.capabilities.list({...args,includeDisabled:true}),summary:runtime.capabilities.summary(),functionTargets};
      case 'getCapability': return runtime.capabilities.get(args.id,{includeDisabled:true});
      case 'saveCapability': {const result=runtime.capabilities.save(args);runtime.emit('change');return result;}
      case 'connectorsPage': return catalogPage(store.state.connectors.map(item=>({name:item.name,description:String(item.description||'').slice(0,600),method:item.method})),args);
      case 'previewOpenApi': {
        const plan=previewOpenApi(args,store.state.connectors);
        return {...plan,entries:plan.entries.map(({connector,...metadata})=>metadata)};
      }
      case 'importOpenApi': return importOpenApi(runtime,args);
      case 'mcpToolsPage': return catalogPage((await mcp.list(args.server)).map(item=>({name:item.name,description:String(item.description||'').slice(0,600)})),{query:args.query,offset:args.offset,limit:20});
      case 'getConnector': {const definition=store.state.connectors.find(item=>item.name===args.name);if(!definition)throw new Error('Connector not found.');return {definition,revision:connectorRevision(definition)};}
      case 'updateConnector': {
        runtime.validateConnector(args.definition);
        const index=store.state.connectors.findIndex(item=>item.name===args.definition.name);
        if(index<0||connectorRevision(store.state.connectors[index])!==args.revision)throw new Error('The connector changed. Reopen it before saving.');
        store.state.connectors[index]=args.definition;runtime.changed(null);return true;
      }
      case 'inspectRecovery': {
        if(recoveryBusy)throw new Error('A backup check is already in progress.');
        recoveryBusy=true;recoverySelection=null;
        try{
          const choice=await dialog.showOpenDialog(win,{title:'Inspect NEXUS Backup',properties:['openFile'],filters:[{name:'NEXUS Backup',extensions:['json','sqlite']}]});
          if(choice.canceled)return null;
          const source=fs.realpathSync(choice.filePaths[0]);
          const preview=await recoveryJob({operation:'inspect',source});
          const token=require('node:crypto').randomUUID();recoverySelection={source,token,fingerprint:preview.fingerprint};
          return {...preview,token};
        }finally{recoveryBusy=false;}
      }
      case 'restoreRecovery': {
        if(recoveryBusy)throw new Error('A backup check is already in progress.');
        if(!recoverySelection||args.token!==recoverySelection.token)throw new Error('Select and review a backup before restoring it.');
        recoveryBusy=true;
        try{
          const choice=await dialog.showOpenDialog(win,{title:'Destination folder for isolated recovery (a new subfolder will be created)',properties:['openDirectory','createDirectory']});
          if(choice.canceled)return null;
          const result=await recoveryJob({operation:'restore',source:recoverySelection.source,expectedFingerprint:recoverySelection.fingerprint,parent:choice.filePaths[0],activeDirectory:store.directory});
          recoverySelection=null;return result;
        }finally{recoveryBusy=false;}
      }
      case 'migrateStorage': {
        if(runtime.active.size||runtime.compacting.size||store.state.tasks.some(task=>task.status==='queued'))throw new Error('Pause all tasks and wait for active calls to finish before migrating.');
        const info=store.migrateToSqlite();runtime.emit('change');return info;
      }
      case 'exportStorage': {
        if(runtime.active.size||runtime.compacting.size)throw new Error('Pause all tasks before exporting workspace state.');
        const result=await dialog.showSaveDialog(win,{defaultPath:'nexus-workspace-export.json',filters:[{name:'Compatible NEXUS State',extensions:['json']}]});
        if(result.canceled)return false;
        if(runtime.active.size||runtime.compacting.size)throw new Error('Execution state changed while choosing destination. Pause tasks and export again.');
        const relative=path.relative(store.directory,path.resolve(result.filePath));
        const inside=relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
        if(!relative||(inside&&relative.split(path.sep)[0].toLowerCase()!=='exports')||path.extname(result.filePath).toLowerCase()!=='.json')throw new Error('Choose a .json file outside the data directory, or inside its exports subfolder. Do not overwrite internal files.');
        store.exportState(result.filePath);return true;
      }
      case 'watchChat': {
        if(args.id!=null)store.task(args.id);
        activeUiTask=args.id??null;return runtime.snapshot(activeUiTask);
      }
      case 'taskPage': return runtime.page(args.id,args.collection,args.before,args.limit);
      case 'searchChat': return searchConversation(store.task(args.id),args.query,args);
      case 'messageWindow': return conversationWindow(store.task(args.id),args.messageId);
      case 'taskResults': return taskResults(store.task(args.id),args);
      case 'previewResult': return previewTaskResult(store,store.task(args.id),args.resultId);
      case 'chooseAttachments': {
        const result=await dialog.showOpenDialog(win,{properties:['openFile','multiSelections'],title:'Attach files to chat'});
        if(result.canceled)return {attachments:[],errors:[]};
        const attachments=[],errors=[];
        for(const filename of result.filePaths){try{attachments.push(await runtime.attachments.importFile(filename));}catch(error){errors.push(path.basename(filename)+': '+error.message);}}
        return {attachments,errors};
      }
      case 'previewAttachment': {
        const preview=await runtime.attachments.preview(args.id,{offset:args.offset??0,length:args.length??8000});
        if(preview.attachment.kind==='image'){
          const original=nativeImage.createFromBuffer(fs.readFileSync(runtime.attachments.filename(args.id)));
          if(original.isEmpty())throw new Error('Could not decode image.');
          preview.image=original.resize({width:Math.min(1000,original.getSize().width)}).toDataURL();
        }
        return preview;
      }
      case 'chooseWorkspace': {
        const result = await dialog.showOpenDialog(win,{properties:['openDirectory','createDirectory'],title:'Select Project Workspace Folder'});
        if(result.canceled) return null;
        const root = fs.realpathSync(result.filePaths[0]); allowedWorkspaces.add(root); return root;
      }
      case 'createTask': {
        if(args.workspace && !allowedWorkspaces.has(args.workspace)) throw new Error('Select the workspace folder in the dialog first.');
        await checkAttachmentModel(args.attachmentIds,args.model||store.state.settings.model);
        const id=runtime.create(args);if(store.task(id).workspace)allowedWorkspaces.add(store.task(id).workspace);return id;
      }
      case 'createArena': {
        if(args.workspace && !allowedWorkspaces.has(args.workspace)) throw new Error('Select the workspace folder in the dialog first.');
        if(!Array.isArray(args.models) || args.models.length < 2) throw new Error('Select at least two models for Arena comparison.');
        const ids = [];
        for (const m of args.models.slice(0, 4)) {
          const shortModel = String(m).split('/').pop();
          const id = runtime.create({
            prompt: args.prompt,
            title: `[Arena · ${shortModel}] ${String(args.prompt).slice(0, 50)}`,
            model: m,
            projectId: args.projectId || null,
            workspace: '',
          });
          ids.push(id);
        }
        return { ids };
      }
      case 'runDiagnostics': {
        if(!args.workspace || !allowedWorkspaces.has(args.workspace)) throw new Error('Select an authorized workspace folder first.');
        return runCodeDiagnostics(args.workspace, args.path || '.');
      }
      case 'pause': return runtime.pause(args.id);
      case 'compact': {
        const task=store.task(args.id);
        if(runtime.active.has(task.id)) throw new Error('Pause the task before compacting.');
        try{await runtime.compact(task, new AbortController().signal);}
        catch(error){if(error.name==='AbortError')return false;throw error;}
        runtime.changed(); return true;
      }
      case 'resume': {
        await checkAttachmentModel(args.attachmentIds,store.task(args.id).model,store.task(args.id));
        runtime.resume(args.id,args.instruction,args.attachmentIds);
        if(store.task(args.id).workspace)allowedWorkspaces.add(store.task(args.id).workspace);return true;
      }
      case 'approve': return runtime.approve(args.id,args.allowed);
      case 'settings': runtime.settings(args); return runtime.snapshot(activeUiTask);
      case 'balance': {
        const providerId = modelConnection(store.state.settings.model, store.state.settings).id;
        return providerId === 'openrouter' ? readBalance(name=>secrets[name]) : { subscription: true, provider: providerId, remaining: null, keyRemaining: null };
      }
      case 'checkArli': return checkArliConnection(secrets.ARLIAI_API_KEY);
      case 'checkProvider': {
        const providerId = args.provider || modelConnection(store.state.settings.model, store.state.settings).id;
        const provider = PROVIDERS.find(p => p.id === providerId) || PROVIDERS[0];
        return checkProviderConnection(provider.id, secrets[provider.key], { settings: store.state.settings });
      }
      case 'importCopilotToken': {
        const detected = await detectLocalCopilotToken();
        secrets.GITHUB_COPILOT_TOKEN = detected.token;
        saveSecrets();
        runtime.changed();
        return { ok: true, source: detected.source };
      }
      case 'saveMcp': {
        validateServer(args);await mcp.disconnect(args.name);
        const existing=store.state.mcpServers.findIndex(s=>s.name===args.name);
        if(existing>=0)store.state.mcpServers[existing]=args;else store.state.mcpServers.push(args);
        runtime.changed();return true;
      }
      case 'scaffoldMcp': {
        const res = await scaffoldMcpServer(store, mcp, args);
        runtime.changed();
        return res;
      }
      case 'testConnector': {
        const started = Date.now();
        const res = await runtime.invokeConnector({ name: args.name, input: args.input || {} }, new AbortController().signal);
        return { ...res, latencyMs: Date.now() - started };
      }
      case 'selfImprove': return runSelfImprovement(runtime, null, args);
      case 'connectMcp': await mcp.list(args.name);return true;
      case 'disconnectMcp': await mcp.disconnect(args.name);return true;
      case 'removeMcp': await mcp.disconnect(args.name);store.state.mcpServers=store.state.mcpServers.filter(s=>s.name!==args.name);runtime.changed();return true;
      case 'saveProject': {
        if(args.workspace && !allowedWorkspaces.has(args.workspace))throw new Error('Select the folder in the dialog first.');
        const id=store.project(args);runtime.changed();return id;
      }
      case 'removeProject': {
        store.state.projects=store.state.projects.filter(p=>p.id!==args.id);
        for(const task of store.state.tasks)if(task.projectId===args.id)task.projectId=null;
        runtime.changed();return true;
      }
      case 'pinMessage': {
        const task=store.task(args.id),message=task.conversation.find(m=>m.id===args.messageId);
        if(!message)throw new Error('Message not found');
        message.pinned=Boolean(args.pinned);runtime.changed();return true;
      }
      case 'updateChat': {
        const task=store.task(args.id);
        const options=validateChatOptions(args),model=options.model||task.model;
        if(Object.keys(options).some(key=>options[key]!==task[key])){
          validateModelCapabilities({...task,...options,reasoningEffort:options.reasoningEffort===null?store.state.settings.reasoningEffort:options.reasoningEffort??task.reasoningEffort??store.state.settings.reasoningEffort},modelCatalog.get(model));
          if(model!==task.model)await checkAttachmentModel([],model,task);
        }
        return runtime.updateChat(args);
      }
      case 'saveKey': {
        const name = args.name || 'OPENROUTER_API_KEY';
        if(!SECRET_KEYS.includes(name) && !/^CONNECTOR_[A-Z0-9_]+$/.test(name)) throw new Error('Invalid secret name.');
        if(typeof args.value !== 'string' || args.value.length > 10000) throw new Error('Invalid key value');
        if(args.value.trim()) secrets[name] = args.value.trim(); else delete secrets[name];
        saveSecrets(); runtime.changed(); return true;
      }
      case 'models': {
        const sorts=new Set(['pricing-low-to-high','context-high-to-low','throughput-high-to-low','latency-low-to-high','most-popular','newest','intelligence-high-to-low','design-arena-elo-high-to-low']);
        const results=await Promise.allSettled(['arliai','openrouter','openai','copilot','anthropic','custom'].map(provider=>providerCatalog(provider,{sort:sorts.has(args.sort)?args.sort:'',settings:store.state.settings})));
        const entries=results.flatMap(result=>result.status==='fulfilled'?result.value:[]);
        if(!entries.length)throw new Error('Model catalogs unavailable. You can keep your current model and retry.');
        for(const model of entries)modelCatalog.set(model.id,model);
        return entries.map(m => ({id:m.id,name:m.name,provider:m.provider||'openrouter',context:m.context_length,tools:m.supported_parameters?.includes('tools'),vision:m.architecture?.input_modalities?.includes('image'),reasoning:m.reasoning||null,pricing:m.pricing||{},topProvider:m.top_provider?{context:m.top_provider.context_length,maxOutput:m.top_provider.max_completion_tokens}:null,benchmarks:m.benchmarks||null,description:m.description||''}));
      }
      case 'addConnector':
        runtime.validateConnector(args);
        if(store.state.connectors.some(c => c.name === args.name)) throw new Error('A connector with that name already exists');
        store.state.connectors.push(args); runtime.changed(); return true;
      case 'removeConnector':
        store.state.connectors = store.state.connectors.filter(c => c.name !== args.name); runtime.changed(); return true;
      case 'files': {
        if(!allowedWorkspaces.has(args.workspace)) throw new Error('Unauthorized workspace folder');
        const target = await workspacePath(args.workspace,args.path || '.');
        return fs.readdirSync(target,{withFileTypes:true}).slice(0,500).map(f=>({name:f.name,directory:f.isDirectory()}));
      }
      case 'readFile': {
        if(!allowedWorkspaces.has(args.workspace)) throw new Error('Unauthorized workspace folder');
        const target = await workspacePath(args.workspace,args.path);
        if(fs.statSync(target).size > 100000) throw new Error('Preview supports files up to 100 KB');
        return fs.readFileSync(target,'utf8');
      }
      case 'gitStatus': {
        if(!args.workspace || !allowedWorkspaces.has(args.workspace)) throw new Error('Select an authorized workspace folder first.');
        return inspectGitWorkspace(args.workspace);
      }
      case 'gitDiff': {
        if(!args.workspace || !allowedWorkspaces.has(args.workspace)) throw new Error('Select an authorized workspace folder first.');
        return executeGitOperation(args.workspace, { operation: 'diff', target: args.target, staged: args.staged });
      }
      case 'gitAction': {
        if(!args.workspace || !allowedWorkspaces.has(args.workspace)) throw new Error('Select an authorized workspace folder first.');
        return executeGitOperation(args.workspace, args);
      }
      case 'terminalExec': {
        if(!args.workspace || !allowedWorkspaces.has(args.workspace)) throw new Error('Select an authorized workspace folder first.');
        if(typeof args.command !== 'string' || !args.command.trim()) throw new Error('Enter a command to execute.');
        return command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', args.command], { cwd: args.workspace, timeout: 60000 });
      }
      case 'processesList': return runtime.processes.list();
      case 'processStart': {
        if(args.workspace && !allowedWorkspaces.has(args.workspace)) throw new Error('Unauthorized workspace folder.');
        return runtime.processes.start({ command: args.command, cwd: args.workspace || process.cwd(), label: args.label });
      }
      case 'processOutput': return runtime.processes.get(args.id);
      case 'processStop': return runtime.processes.stop(args.id);
      case 'memoriesList': return store.state.memories || [];
      case 'memorySave': {
        store.state.memories ||= [];
        if(typeof args.key !== 'string' || !args.key.trim() || typeof args.value !== 'string' || !args.value.trim()) throw new Error('Key and value are required.');
        const scope = args.scope === 'project' ? 'project' : 'global';
        const workspace = scope === 'project' ? (args.workspace || '') : '';
        const existing = store.state.memories.find(m => m.id === args.id || (m.key.toLowerCase() === args.key.trim().toLowerCase() && m.scope === scope && m.workspace === workspace));
        if(existing){
          existing.key = args.key.trim().slice(0, 120);
          existing.value = args.value.trim().slice(0, 4000);
          existing.scope = scope;
          existing.workspace = workspace;
          existing.updatedAt = new Date().toISOString();
        } else {
          store.state.memories.push({
            id: require('node:crypto').randomUUID(),
            key: args.key.trim().slice(0, 120),
            value: args.value.trim().slice(0, 4000),
            scope,
            workspace,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
        runtime.changed(null);
        return store.state.memories;
      }
      case 'memoryDelete': {
        store.state.memories = (store.state.memories || []).filter(m => m.id !== args.id);
        runtime.changed(null);
        return store.state.memories;
      }
      case 'systemInfo': return inspectSystemEnvironment(args.workspace && allowedWorkspaces.has(args.workspace) ? args.workspace : process.cwd());
      case 'openProject':
        if(!allowedWorkspaces.has(args.workspace)) throw new Error('Unauthorized workspace folder');
        return shell.openPath(args.workspace);
      case 'openJournal': return shell.openPath(store.directoryFor(store.task(args.id).id));
      case 'exportTask': {
        const task = store.task(args.id);
        const result = await dialog.showSaveDialog(win,{defaultPath:'nexus-' + task.id.slice(0,8) + '.md',filters:[{name:'Markdown',extensions:['md']}]});
        if(result.canceled) return false;
        const text = '# ' + task.title + '\n\n## Objective\n' + task.prompt + '\n\n## Continuity\n' + task.summary + '\n\n## Conversation\n' + task.conversation.map(m=>'### ' + m.role + '\n' + (m.content||(m.reasoning?('(step '+m.step+' reasoning)\n'+m.reasoning):''))).join('\n\n') + '\n\n## Journal\n' + task.events.map(e=>'### ' + e.at + ' · ' + e.kind + '\n\n' + JSON.stringify(e.detail,null,2)).join('\n\n');
        fs.writeFileSync(result.filePath,text); return true;
      }
      default: throw new Error('Operation not permitted');
    }
  });
  await win.loadURL('nexus://app/');
  if(process.argv.includes('--smoke-test')) {
    await new Promise(resolve=>setTimeout(resolve,1500));
    const output = path.join(userDirectory(),'smoke');
    try {
      await (await import('./core/smoke.mjs')).smoke(win,output,runtime,dialog);
      console.log('NEXUS smoke: '+output);
      app.quit();
    } catch(error) {
      fs.mkdirSync(output,{recursive:true});
      fs.writeFileSync(path.join(output,'failure.txt'),error.stack || error.message);
      app.exit(1);
    }
  }
}
if (bridgeRequest) {
  runBridge();
} else {
  const locked = app.requestSingleInstanceLock();
  if(!locked) app.quit();
  else {
    app.on('second-instance',()=>{ win?.show();win?.focus(); });
    app.whenReady().then(main).catch(error=>{ console.error(error);if(!process.argv.includes('--smoke-test'))dialog.showErrorBox('NEXUS · No se pudo abrir el almacén',error.message+'\n\nNo borres las copias ni los archivos de datos. Revisa la recuperación antes de continuar.');app.quit(); });
    let cleaned=false;
    app.on('before-quit',event=>{runtime?.shutdown();if(!cleaned&&mcp){event.preventDefault();cleaned=true;void mcp.close().finally(()=>app.quit());}});
    app.on('window-all-closed',()=>app.quit());
    app.on('will-quit',()=>store?.close());
  }
}
