import test from 'node:test';
import assert from 'node:assert/strict';
import {smoothMotion,integrateSmoothMotion} from '../src/experience/smooth-motion.js';
import {AstronautMotion} from '../src/experience/astronaut-motion.js';
import {DEFAULT_WALL} from '../src/experience/body.js';
test('spring starts slowly, accelerates, then decelerates without overshooting',()=>{
 const s={x:0};smoothMotion(s,'x',1,1/60,2);const first=s.xVelocity;
 assert.ok(first>0&&first<.07);
 for(let i=0;i<29;i++)smoothMotion(s,'x',1,1/60,2);
 assert.ok(s.xVelocity>first*8);
 for(let i=0;i<600;i++)smoothMotion(s,'x',1,1/60,2);
 assert.ok(s.x<=1&&s.x>.999);assert.ok(s.xVelocity<.001);
});
test('speed integral and spring are frame-rate independent during a speed change',()=>{
 const a={v:1},b={v:1};let x=0,y=0;
 for(let i=0;i<100;i++)x+=integrateSmoothMotion(a,'v',0,.1,1.5);
 for(let i=0;i<600;i++)y+=integrateSmoothMotion(b,'v',0,1/60,1.5);
 assert.ok(Math.abs(x-y)<1e-10);assert.ok(Math.abs(a.v-b.v)<1e-10);
});
test('astronaut retreat turn and translation ramp up instead of kicking immediately',()=>{
 const m=new AstronautMotion();m.phase='linger';m.phaseTime=5;m.height=1.8288;
 m.update([],DEFAULT_WALL,1/60);
 assert.equal(m.phase,'retreat');assert.ok(m.departure*Math.PI<.001);
 assert.ok(Math.abs(m.vx)<.001);
 const first=m.departureVelocity;
 for(let i=0;i<59;i++)m.update([],DEFAULT_WALL,1/60);
 assert.ok(m.departureVelocity>first*10);
 assert.ok(m.departureVelocity*Math.PI<1);
});
