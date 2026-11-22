import test from 'node:test';
import assert from 'node:assert/strict';
import {featherGeometry} from '../src/experience/feather-geometry.js';
import {FeatherMotion} from '../src/experience/feather-motion.js';
const wall={width:8,height:2.25};
test('feathers have finite volumetric barbs and normals',()=>{
 const g=featherGeometry(),box=g.boundingBox;
 assert.ok(box.max.z-box.min.z>.1);assert.ok(g.index.count>10000);
 assert.equal(g.attributes.normal.count,g.attributes.position.count);
 for(const a of [g.attributes.position.array,g.attributes.normal.array])assert.ok(a.every(Number.isFinite));
 g.dispose();
});
test('feathers accelerate into wind, flutter, and freeze on pause',()=>{
 const a=new FeatherMotion(8),b=new FeatherMotion(8);
 for(let i=0;i<180;i++){a.update(wall,1/60,false,()=>[.2,.1]);b.update(wall,1/60,false,()=>[0,0]);}
 assert.ok(a.feathers[0].u>b.feathers[0].u);assert.ok(a.feathers[0].v>b.feathers[0].v);
 assert.ok(a.feathers.some(p=>Math.abs(p.pitch)>.01));
 const before=JSON.stringify(a);a.update(wall,1,true,()=>[.25,.25]);assert.equal(JSON.stringify(a),before);
});

test('feathers occupy a broad physical depth range and drift continuously in depth',()=>{
 const motion=new FeatherMotion();
 const depths=motion.feathers.map(p=>10-p.z);
 assert.ok(Math.max(...depths)/Math.min(...depths)>8);
 const before=motion.feathers.map(p=>p.z);
 motion.update(wall,1/60,false,()=>[0,0]);
 assert.ok(motion.feathers.some((p,i)=>p.z!==before[i]));
 assert.ok(motion.feathers.every(p=>p.z<8.4));
});

test('flow drives translation and turning smoothly, with bounded strong-gust speed',()=>{
 const moving=new FeatherMotion(1),still=new FeatherMotion(1);
 moving.update(wall,1/60,false,()=>[.2,.2]);
 assert.ok(Math.abs(moving.feathers[0].vx)<.01);
 for(let i=0;i<90;i++){moving.update(wall,1/60,false,()=>[.2,.2]);still.update(wall,1/60,false,()=>[0,0]);}
 assert.ok(moving.feathers[0].vx>1);assert.ok(moving.feathers[0].vy>.4);
 assert.ok(Math.abs(moving.feathers[0].yaw-still.feathers[0].yaw)>.25);
 for(let i=0;i<120;i++)moving.update(wall,1/60,false,()=>[100,100]);
 assert.ok(moving.feathers[0].vx<wall.width*.17);
});

test('feather render isolates and restores the studio environment across a crossfade',async()=>{
 const THREE=await import('three');
 const {FeatherDepthOfField}=await import('../src/experience/FeatherDepthOfField.js');
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
 const studio=new THREE.Texture();scene.environment=studio;
 const pass=new FeatherDepthOfField(scene,camera),observed=[];
 const renderer={autoClear:true,getClearAlpha:()=>1,getClearColor:c=>c.set('black'),
  setClearColor(){},setRenderTarget(){},clear(){},render(s){if(s===scene)observed.push(s.environment);}};
 pass.render(renderer,{}, {texture:new THREE.Texture()});
 assert.deepEqual(observed,[null,null]);assert.equal(scene.environment,studio);assert.equal(camera.layers.mask,1);
 pass.dispose();studio.dispose();
});

test('astronaut DOF keeps character lighting and uses scene depth for occlusion',async()=>{
 const THREE=await import('three');
 const {FeatherDepthOfField}=await import('../src/experience/FeatherDepthOfField.js');
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),studio=new THREE.Texture();scene.environment=studio;
 const pass=new FeatherDepthOfField(scene,camera,{layer:2,isolateEnvironment:false,focus:6,aperture:10,maxBlur:12,occlude:true});
 const depth=new THREE.DepthTexture(1,1),seen=[];
 const renderer={autoClear:true,getClearAlpha:()=>1,getClearColor:c=>c.set('black'),setClearColor(){},setRenderTarget(){},clear(){},render(s){if(s===scene)seen.push([camera.layers.mask,s.environment]);}};
 pass.render(renderer,{}, {texture:new THREE.Texture(),depthTexture:depth});
 assert.deepEqual(seen,[[4,studio],[4,studio]]);assert.equal(camera.layers.mask,1);
 assert.equal(pass.material.uniforms.tSceneDepth.value,depth);assert.equal(pass.material.uniforms.occlude.value,true);
 pass.dispose();studio.dispose();depth.dispose();
});
