const { contextBridge, ipcRenderer } = require('electron');
const methods = ['checkArli','getDrafts','saveDraft','clearDraft','snapshot','inspectContext','contextSection','inspectCosts','checkpointPreview','storageInfo','migrateStorage','exportStorage','inspectRecovery','restoreRecovery','capabilitiesPage','getCapability','saveCapability','mcpToolsPage','previewOpenApi','importOpenApi','connectorsPage','getConnector','updateConnector','watchChat','taskPage','searchChat','messageWindow','taskResults','previewResult','chooseWorkspace','chooseAttachments','previewAttachment','openExternal','createTask','pause','resume','compact','approve','settings','saveKey','models','addConnector','removeConnector','files','readFile','openProject','openJournal','exportTask','balance','saveProject','removeProject','pinMessage','updateChat','saveMcp','connectMcp','disconnectMcp','removeMcp'];
contextBridge.exposeInMainWorld('nexus', {
  beforeClose: callback => {
    const handler=()=>{Promise.resolve().then(callback).then(ok=>ipcRenderer.send('nexus:drafts:closed',ok===true),()=>ipcRenderer.send('nexus:drafts:closed',false));};
    ipcRenderer.on('nexus:before-close',handler);ipcRenderer.send('nexus:drafts:ready');
    return ()=>ipcRenderer.removeListener('nexus:before-close',handler);
  },
  invoke: (method,args) => {
    if(!methods.includes(method)) return Promise.reject(new Error('Operación no permitida'));
    return ipcRenderer.invoke('nexus:invoke',method,args);
  },
  subscribe: callback => {
    const handler = (_,state) => callback(state);
    ipcRenderer.on('nexus:change',handler);
    return () => ipcRenderer.removeListener('nexus:change',handler);
  }
});
