import test from 'node:test';
import assert from 'node:assert/strict';
import {transitionFrame,TRANSITION_DURATION,SWITCH_TIME,orbitCamera,orbitCrossfade} from '../src/experience/mode-transition.js';
test('orbit switches scenes at the far side',()=>{
 assert.equal(transitionFrame(SWITCH_TIME,true).switchMode,false);
 const middle=transitionFrame(TRANSITION_DURATION/2,true);
 assert.equal(middle.switchMode,true);assert.equal(middle.phase,.5);
 assert.equal(transitionFrame(TRANSITION_DURATION,true).finished,true);
 assert.equal(transitionFrame(SWITCH_TIME).switchMode,true);
});

test('camera completes a real orbit with smooth departure and arrival',()=>{
  for(let i=0;i<=100;i++){
    const p=orbitCamera(i/100);
    assert.ok(Math.abs(Math.hypot(p.x,p.z)-10)<1e-9);
  }
  assert.ok(orbitCamera(.5).z < -9.99);
  assert.ok(orbitCamera(.25).x > 1);
  assert.ok(Math.abs(orbitCamera(1).x)<1e-9);
  assert.equal(orbitCamera(1).z,10);
  assert.ok(Math.abs(orbitCamera(.001).x)<.000001);
  assert.ok(Math.abs(orbitCamera(.999).x)<.000001);
});

test('live scene crossfade is centered and eases into and out of the overlap',()=>{
  assert.equal(orbitCrossfade(0),0);assert.equal(orbitCrossfade(.3),0);
  assert.ok(Math.abs(orbitCrossfade(.5)-.5)<1e-12);
  assert.ok(Math.abs(orbitCrossfade(.7)-1)<1e-12);assert.equal(orbitCrossfade(1),1);
  let last=0;
  for(let i=0;i<=100;i++){const amount=orbitCrossfade(i/100);assert.ok(amount>=last);last=amount;}
  assert.ok(orbitCrossfade(.301)<.000001);
  assert.ok(1-orbitCrossfade(.699)<.000001);
});
