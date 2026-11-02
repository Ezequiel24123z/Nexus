const { contextBridge, ipcRenderer } = require('electron');
const methods = ['checkArli','checkProvider','importCopilotToken','getDrafts','saveDraft','clearDraft','snapshot','inspectContext','contextSection','inspectCosts','checkpointPreview','storageInfo','migrateStorage','exportStorage','inspectRecovery','restoreRecovery','capabilitiesPage','getCapability','saveCapability','mcpToolsPage','previewOpenApi','importOpenApi','connectorsPage','getConnector','updateConnector','testConnector','watchChat','taskPage','searchChat','messageWindow','taskResults','previewResult','chooseWorkspace','chooseAttachments','previewAttachment','openExternal','createTask','pause','resume','compact','approve','settings','saveKey','models','addConnector','removeConnector','files','readFile','openProject','openJournal','exportTask','balance','saveProject','removeProject','pinMessage','updateChat','saveMcp','scaffoldMcp','connectMcp','disconnectMcp','removeMcp','gitStatus','gitDiff','gitAction','terminalExec','processesList','processStart','processOutput','processStop','memoriesList','memorySave','memoryDelete','systemInfo','selfImprove'];
contextBridge.exposeInMainWorld('nexus', {
  beforeClose: callback => {
    const handler=()=>{Promise.resolve().then(callback).then(ok=>ipcRenderer.send('nexus:drafts:closed',ok===true),()=>ipcRenderer.send('nexus:drafts:closed',false));};
    ipcRenderer.on('nexus:before-close',handler);ipcRenderer.send('nexus:drafts:ready');
    return ()=>ipcRenderer.removeListener('nexus:before-close',handler);
  },
  invoke: (method,args) => {
    if(!methods.includes(method)) return Promise.reject(new Error('Operation not permitted'));
    return ipcRenderer.invoke('nexus:invoke',method,args);
  },
  subscribe: callback => {
    const handler = (_,state) => callback(state);
    ipcRenderer.on('nexus:change',handler);
    return () => ipcRenderer.removeListener('nexus:change',handler);
  }
});
