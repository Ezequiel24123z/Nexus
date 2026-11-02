import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeById} from '../src/chat-state.mjs';
import {externalWebUrl} from '../core/web-links.mjs';

test('live snapshot changes replace cached messages without losing older pages or ordering',()=>{
 const old=[{id:'1',content:'older'},{id:'2',pinned:false},{id:'3',content:'partial'}];
 const fresh=[{id:'2',pinned:true},{id:'3',content:'final'},{id:'4',content:'new'}];
 const result=mergeById(old,fresh);
 assert.deepEqual(result.map(m=>m.id),['1','2','3','4']);
 assert.equal(result[1].pinned,true);assert.equal(result[2].content,'final');
 assert.equal(old[1].pinned,false);
});
test('clickable chat links allow web destinations without allowing local programs or credentials',()=>{
 assert.equal(externalWebUrl('https://example.com/docs?q=hola'),'https://example.com/docs?q=hola');
 for(const url of ['file:///C:/Windows/System32/cmd.exe','javascript:alert(1)','ms-settings:','https://user:secret@example.com','invalid',null])assert.throws(()=>externalWebUrl(url));
});
