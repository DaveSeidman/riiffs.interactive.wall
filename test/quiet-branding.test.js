import test from 'node:test';
import assert from 'node:assert/strict';
import {QuietBranding} from '../src/experience/quiet-branding.js';
const wall={width:8,height:2.25};
const advance=(m,obstacles,seconds)=>{for(let i=0;i<seconds*60;i++)m.update(obstacles,wall,1/60);};
test('branding waits for clear space, then fades away before relocating when occupied',()=>{
 const m=new QuietBranding();advance(m,[],1);assert.equal(m.alpha,0);
 advance(m,[],9);assert.ok(m.alpha>.99);const original=m.slot;
 const block={...original};m.update([block],wall,1/60);
 assert.equal(m.slot,original);assert.ok(m.alpha<1&&m.alpha>.9);
 advance(m,[block],1);assert.notEqual(m.slot,original);assert.ok(m.alpha<.001);
});
test('crowded scenes remain unbranded and pause preserves the fade',()=>{
 const m=new QuietBranding();advance(m,[{x:0,y:0,hw:10,hh:10}],20);
 assert.equal(m.slot,null);assert.equal(m.alpha,0);
 advance(m,[],10);const before=JSON.stringify(m);m.update([],wall,1,true);assert.equal(JSON.stringify(m),before);
});
