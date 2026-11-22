import test from 'node:test';
import assert from 'node:assert/strict';
import {EclipseMotion} from '../src/experience/eclipse-motion.js';
import {DEFAULT_WALL as wall,makePerson} from '../src/experience/body.js';
const advance=(m,p,n=240)=>{for(let i=0;i<n;i++)m.update(p,wall,1/60);};
test('one guest moves both eclipse bodies with their hands and can create totality',()=>{
 const p=makePerson(1,0,.7,0,wall),m=new EclipseMotion();
 p.joints[15].p3={x:-1,y:0,z:3};p.joints[16].p3={x:1,y:0,z:3};
 advance(m,[p]);assert.ok(m.sun.x<-.9&&m.moon.x>.9);assert.equal(m.controlled,true);
 p.joints[15].p3.x=0;p.joints[16].p3.x=0;advance(m,[p]);assert.ok(m.alignment>.95);
});
test('two guests each move one body and detection ordering does not swap ownership',()=>{
 const a=makePerson(1,-1,.7,0,wall),b=makePerson(2,1,.7,0,wall),m=new EclipseMotion();
 advance(m,[a,b]);advance(m,[b,a]);assert.deepEqual(m.ids,[1,2]);
 assert.ok(m.sun.x<-.8&&m.moon.x>.8);
 const before=JSON.stringify(m);m.update([],wall,1,true);assert.equal(JSON.stringify(m),before);
 advance(m,[]);assert.equal(m.controlled,false);assert.ok(Number.isFinite(m.moon.x));
});

test('eclipse centres stay level throughout pose changes and idle motion',()=>{
 const p=makePerson(1,0,.7,0,wall),m=new EclipseMotion();
 p.joints[15].p3={x:-1,y:-.8,z:3};p.joints[16].p3={x:1,y:.8,z:3};
 for(const people of [[p],[],[p]])for(let i=0;i<240;i++){
  m.update(people,wall,1/60);
  assert.equal(m.sun.y,m.moon.y);
 }
});
