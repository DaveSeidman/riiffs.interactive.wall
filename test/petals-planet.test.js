import test from 'node:test';
import {AdditiveBlending} from 'three';
import assert from 'node:assert/strict';
import {petalGeometry,petalMaterial} from '../src/experience/petal-geometry.js';
import {lavaPlanetGeometry} from '../src/experience/lava-planet-geometry.js';
import {orbitTwist} from '../src/experience/mode-transition.js';
test('rose petals have a broad curved surface and cool pink color variation',()=>{
 const g=petalGeometry(),box=g.boundingBox;
 assert.ok(box.max.x-box.min.x>.5);assert.ok(box.max.z-box.min.z>.15);
 assert.equal(g.attributes.color.count,g.attributes.position.count);
 for(const key of ['position','normal','color'])assert.ok(g.attributes[key].array.every(Number.isFinite));
 const m=petalMaterial();assert.ok(m.opacity<1);assert.equal(m.envMapIntensity,0);assert.equal(m.blending,AdditiveBlending);assert.equal(m.forceSinglePass,true);
 for(let i=0;i<g.attributes.color.count;i++)assert.ok(g.attributes.color.getZ(i)>g.attributes.color.getY(i));g.dispose();m.dispose();
});
test('planet has physically raised plates above the lava floor',()=>{
 const g=lavaPlanetGeometry(),p=g.attributes.position;let min=10,max=0;
 for(let i=0;i<p.count;i++){const r=Math.hypot(p.getX(i),p.getY(i),p.getZ(i));min=Math.min(min,r);max=Math.max(max,r);}
 assert.ok(min<1.005);assert.ok(max>1.06);assert.ok(max<1.09);
 assert.ok(g.attributes.normal.array.every(Number.isFinite));g.dispose();
});
test('synthetic flow twist matches the orbit speed and gently vanishes at both ends',()=>{
 assert.equal(orbitTwist(0),0);assert.equal(orbitTwist(1),0);assert.equal(orbitTwist(.5),1);
 assert.ok(orbitTwist(.001)<.00002);assert.equal(orbitTwist(-1),0);
 assert.ok(Math.abs(orbitTwist(.25)-orbitTwist(.75))<1e-12);
});
