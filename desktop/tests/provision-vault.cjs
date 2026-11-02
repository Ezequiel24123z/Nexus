// One-time local provisioning. Receives no key from source code: Electron encrypts it for this Windows account.
const {app,safeStorage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const value=process.env.NEXUS_BOOTSTRAP_OPENROUTER_KEY;
if(!value){console.error('NEXUS_BOOTSTRAP_OPENROUTER_KEY is required');process.exit(2);}
app.setName('NEXUS');
app.setPath('userData',path.join(app.getPath('appData'),'NEXUS'));
app.whenReady().then(()=>{
 try{
  if(!safeStorage.isEncryptionAvailable())throw new Error('Windows encryption unavailable');
  const directory=app.getPath('userData');fs.mkdirSync(directory,{recursive:true});
  const filename=path.join(directory,'vault.bin');let secrets={};
  if(fs.existsSync(filename))try{secrets=JSON.parse(safeStorage.decryptString(fs.readFileSync(filename)));}catch{}
  secrets.OPENROUTER_API_KEY=value.trim();
  fs.writeFileSync(filename,safeStorage.encryptString(JSON.stringify(secrets)));
  console.log('NEXUS OpenRouter key stored in the encrypted local vault.');
 }catch(error){console.error(error.message);process.exitCode=1;}finally{app.quit();}
});
