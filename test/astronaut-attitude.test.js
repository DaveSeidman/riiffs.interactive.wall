import test from 'node:test';
import assert from 'node:assert/strict';
import {angularSpring,AstronautAttitude} from '../src/experience/astronaut-attitude.js';
import {AstronautMotion} from '../src/experience/astronaut-motion.js';
import {DEFAULT_WALL} from '../src/experience/body.js';
test('angular spring eases into a turn, overshoots slightly, and settles',()=>{
 const state={yaw:0};let peak=0;
 angularSpring(state,'yaw',1,1/60);
 assert.ok(state.yaw<.001);
 for(let i=0;i<900;i++){angularSpring(state,'yaw',1,1/60);peak=Math.max(peak,state.yaw);}
 assert.ok(peak>1.01&&peak<1.06,`overshoot ${peak}`);
 assert.ok(Math.abs(state.yaw-1)<1e-5);
});
test('retreat turn changes pitch and banks without a sudden angular velocity',()=>{
 const m=new AstronautMotion(),pose=new AstronautAttitude();m.phase='linger';m.phaseTime=5;
 let minRoll=0,minPitch=.8,maxStep=0,previousYaw=0;
 for(let i=0;i<600;i++){
  m.update([],DEFAULT_WALL,1/60);pose.update(m,1/60);
  maxStep=Math.max(maxStep,Math.abs(pose.yaw-previousYaw));previousYaw=pose.yaw;
  minRoll=Math.min(minRoll,pose.roll);minPitch=Math.min(minPitch,pose.pitch);
  if(i===0)assert.ok(Math.abs(pose.yaw)<.00001);
 }
 assert.ok(minRoll<-.12,'visible banking through the turn');
 assert.ok(minPitch<.7,'pitch responds to the turn');
 assert.ok(maxStep<.025,'no frame jumps in heading');
 const frozen=JSON.stringify(pose);pose.update(m,1,true);assert.equal(JSON.stringify(pose),frozen);
});
test('angular spring has matching results at different frame rates',()=>{
 const a={roll:0},b={roll:0};
 for(let i=0;i<60;i++)angularSpring(a,'roll',.5,1/30);
 for(let i=0;i<120;i++)angularSpring(b,'roll',.5,1/60);
 assert.ok(Math.abs(a.roll-b.roll)<1e-10);
});
