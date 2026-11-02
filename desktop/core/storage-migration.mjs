import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {SqliteWorkspace,persistedState} from './sqlite-workspace.mjs';

const markerName='storage-engine.json';
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function durableFile(filename,content){const fd=fs.openSync(filename,'wx');try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function readStorageMarker(directory){
 const file=path.join(directory,markerName);if(!fs.existsSync(file))return null;
 const marker=JSON.parse(fs.readFileSync(file,'utf8'));
 if(marker.version!==1||marker.engine!=='sqlite'||!/^workspace-v1-[a-f0-9-]{36}\.sqlite$/.test(marker.file)||typeof marker.legacySha256!=='string')throw new Error('Marcador de almacenamiento no válido; no se han sustituido datos.');
 const legacy=path.join(directory,'workspace.json');
 if(!fs.existsSync(legacy)||digest(legacy)!==marker.legacySha256)throw new Error('El historial JSON anterior cambió después de migrar. Conserva ambos almacenes y revisa qué versión de NEXUS lo modificó antes de continuar.');
 return marker;
}
export function migrateStorage(directory,state){
 if(fs.existsSync(path.join(directory,markerName)))throw new Error('Ya existe una selección de almacenamiento.');
 const stamp=crypto.randomUUID(),file='workspace-v1-'+stamp+'.sqlite',backup='workspace.before-sqlite-'+stamp+'.json';
 const legacy=path.join(directory,'workspace.json');
 fs.copyFileSync(legacy,path.join(directory,backup),fs.constants.COPYFILE_EXCL);
 // Flush the backup before any activation. The legacy original also stays untouched.
 const fd=fs.openSync(path.join(directory,backup),'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 let candidate;
 try{
   candidate=new SqliteWorkspace(path.join(directory,file),{create:true});candidate.save(state);
   if(!isDeepStrictEqual(candidate.read(),persistedState(state)))throw new Error('La verificación de la migración no coincide con el original.');
   candidate.close();candidate=null;
   const marker={version:1,engine:'sqlite',file,backup,legacySha256:digest(legacy),at:new Date().toISOString()};
   const temp=path.join(directory,markerName+'.'+stamp+'.tmp');durableFile(temp,JSON.stringify(marker,null,2));
   // The marker is the commit point. Orphan candidates never become authoritative.
   fs.renameSync(temp,path.join(directory,markerName));return marker;
 }finally{candidate?.close();}
}
export function openSelectedStorage(directory){const marker=readStorageMarker(directory);return marker?{marker,backend:new SqliteWorkspace(path.join(directory,marker.file))}:null;}
