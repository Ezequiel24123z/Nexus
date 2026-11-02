// Runs an opt-in live test with the account-local encrypted vault. The key never
// enters source control, command history, test output, or a child-process argument.
const {app, safeStorage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const [script, scope]=process.argv.slice(2);
if(!script){console.error('Usage: electron tests/run-live-from-vault.cjs <test.mjs> [scope]');process.exit(2);}
app.setName('NEXUS');
app.setPath('userData',require('../core/datadir.cjs').resolveDataDirectory({fallbackAppData:app.getPath('appData')}));
app.whenReady().then(()=>{
  try{
    const filename=path.join(app.getPath('userData'),'vault.bin');
    if(!safeStorage.isEncryptionAvailable()||!fs.existsSync(filename))throw new Error('No local encrypted NEXUS vault is available. Add the OpenRouter key in NEXUS settings first.');
    const key=JSON.parse(safeStorage.decryptString(fs.readFileSync(filename))).OPENROUTER_API_KEY;
    if(!key)throw new Error('The encrypted NEXUS vault has no OpenRouter key.');
    const child=spawn(process.execPath,[path.resolve(script)],{stdio:'inherit',windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NEXUS_LIVE_OPENROUTER_KEY:key,...(scope?{NEXUS_LIVE_SCOPE:scope}:{})}});
    let finished=false;
    const finish=(code,message)=>{if(finished)return;finished=true;if(message)console.error(message);process.exitCode=code;app.quit();};
    child.on('error',()=>finish(1,'Could not start the live test process.'));
    child.on('exit',(code,signal)=>finish(Number.isInteger(code)?code:1,signal?'Live test interrupted by '+signal:code===null?'Live test ended without an exit code.':null));
  }catch(error){console.error(error.message);process.exitCode=1;app.quit();}
});
