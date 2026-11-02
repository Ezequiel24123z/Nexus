import test from 'node:test';
import assert from 'node:assert/strict';
import {nextStreamText} from '../src/stream-display.mjs';

test('stream display catches up in a bounded number of frames without changing provider text',()=>{
 const target='Texto de prueba con saltos.\n\n'+('Más contenido. '.repeat(20));let shown='',frames=0;
 while(shown!==target&&frames<20){const next=nextStreamText(shown,target);assert.ok(target.startsWith(next));assert.ok(next.length>shown.length);shown=next;frames++;}
 assert.equal(shown,target);assert.ok(frames<=10);
});
test('long bursts, changed prefixes and reduced-motion preference are shown without replay delays',()=>{
 assert.equal(nextStreamText('','x'.repeat(1000)),'x'.repeat(1000));
 assert.equal(nextStreamText('Previous task','New task'),'New task');
 assert.equal(nextStreamText('','Read immediately',true),'Read immediately');
 assert.equal(nextStreamText('Done','Done'),'Done');
});
test('stream reveal never cuts a surrogate pair in half',()=>{
 const target='🧪'.repeat(90);let shown='';
 while(shown!==target){shown=nextStreamText(shown,target);assert.ok(!/[\uD800-\uDBFF]$/.test(shown));assert.equal(Buffer.from(shown).toString('utf8'),shown);}
});
