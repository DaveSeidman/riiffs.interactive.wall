import test from 'node:test';
import assert from 'node:assert/strict';
import { AstronautMotion, ASTRONAUT_HEIGHT } from '../src/experience/astronaut-motion.js';
import { DEFAULT_WALL, makePerson } from '../src/experience/body.js';
const wall={...DEFAULT_WALL};
const person=(id,x)=>makePerson(id,x,.7,0,wall);
function advance(m,people,seconds,dt=1/60) { for(let i=0;i<Math.round(seconds/dt);i++)m.update(people,wall,dt); }

test('corner pursuit takes at least fifteen seconds and approaches six-foot stature through depth',()=>{
 const m=new AstronautMotion(), people=[person(1,-3.6)];
 advance(m,people,10);
 assert.ok(m.x>-2.5,'must not rush across the wall');
 advance(m,people,5);
 assert.ok(m.x>-3.5,'not at the corner before fifteen seconds');
 advance(m,people,19);
 assert.ok(Math.abs(m.height-ASTRONAUT_HEIGHT)<.001);
 assert.ok(m.z>5 && m.z<6);
 assert.ok(m.x<-3.3);
});
test('target lock survives reordering and brief occlusion, then releases and retreats',()=>{
 const m=new AstronautMotion();advance(m,[person(1,-1)],5);
 advance(m,[person(2,0),person(1,-1)],2);assert.equal(m.targetId,1);
 advance(m,[],1);assert.equal(m.targetId,1);
 advance(m,[],3);assert.equal(m.targetId,null);assert.equal(m.target,null);
 advance(m,[],15);assert.ok(m.height<.56);
});
test('pause freezes motion and low-confidence detections are ignored',()=>{
 const m=new AstronautMotion();advance(m,[person(1,2)],3);
 const before=JSON.stringify(m);m.update([],wall,1,true);assert.equal(JSON.stringify(m),before);
 const bad=person(9,0);bad.joints.forEach(j=>j.vis=.1);
 const empty=new AstronautMotion();advance(empty,[bad],3);assert.equal(empty.targetId,null);
});
test('pursuit is consistent at 30 and 60 fps',()=>{
 const a=new AstronautMotion(),b=new AstronautMotion(),people=[person(1,-3)];
 advance(a,people,20,1/30);advance(b,people,20,1/60);
 assert.ok(Math.abs(a.x-b.x)<.01);assert.ok(Math.abs(a.height-b.height)<.005);
});

test('exported skin animates without invalid vertices and settles at six feet on screen',async()=>{
 const {readFileSync}=await import('node:fs');
 const THREE=await import('three');
 const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
 const {AstronautSwimmer}=await import('../src/experience/astronaut-rig.js');
 const bytes=readFileSync(new URL('../public/models/astronaut/astronaut-skinned.glb',import.meta.url));
 const {scene:model}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 model.updateMatrixWorld(true);
 const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
 model.scale.setScalar(1/size.y);model.position.copy(center).multiplyScalar(-1/size.y);
 const root=new THREE.Group();root.add(model);root.scale.setScalar(1.1);
 const swimmer=new AstronautSwimmer(model),m=new AstronautMotion();
 advance(m,[person(1,-1.8)],35);
 for(let i=0;i<360;i++) {
  const depth=m.depthScale*swimmer.depthCorrection;
  root.position.set(m.x*depth,m.y*depth,10-8*depth);
  root.rotation.set(.8,.2,.08,'YXZ');
  swimmer.update(root,{...m,depthScale:depth});
  swimmer.fitScreenHeight(root,m,1/30);
 }
 let low=Infinity,high=-Infinity,changed=0;
 const p=new THREE.Vector3();root.updateMatrixWorld(true,true);
 for(const mesh of swimmer.meshes) {
  mesh.skeleton.update();
  const positions=mesh.geometry.attributes.position;
  for(let i=0;i<positions.count;i++) {
   p.fromBufferAttribute(positions,i);const rest=p.clone();mesh.applyBoneTransform(i,p);
   if(p.distanceTo(rest)>.02)changed++;
   p.applyMatrix4(mesh.matrixWorld);
   assert.ok(Number.isFinite(p.x+p.y+p.z));
   const y=p.y*8/(10-p.z);low=Math.min(low,y);high=Math.max(high,y);
  }
 }
 assert.ok(changed>1000,'limbs must actually deform');
 assert.ok(Math.abs(high-low-ASTRONAUT_HEIGHT)<.04,`projected height ${high-low}`);
});

test('visitor lingers, retreats with thrust, rests, then can visit again',()=>{
 const m=new AstronautMotion(),people=[person(1,-1)];
 advance(m,people,34);assert.equal(m.phase,'linger');assert.ok(m.height>1.8);
 advance(m,people,6);assert.equal(m.phase,'retreat');assert.ok(m.thrust.z<0);
 assert.equal(m.targetId,null);assert.equal(m.target,null);
 advance(m,people,15);assert.equal(m.phase,'rest');assert.ok(m.height<.6);
 advance(m,people,8);assert.equal(m.phase,'approach');assert.equal(m.targetId,1);
});

test('astronaut stays back beyond two metres and retreats when the room moves out of range',()=>{
 const m=new AstronautMotion();
 const far=makePerson(1,0,2.01,0,wall,'walk');
 advance(m,[far],40);assert.equal(m.phase,'rest');assert.equal(m.targetId,null);assert.ok(m.height<=.55);
 const near=makePerson(1,0,1.99,0,wall,'walk');
 advance(m,[near],20);assert.equal(m.targetId,1);assert.ok(m.height>.8);
 const height=m.height;advance(m,[far],1);
 assert.equal(m.phase,'retreat');assert.equal(m.targetId,null);assert.ok(Math.abs(m.height-height)<.15);
 advance(m,[far],40);assert.equal(m.phase,'rest');assert.ok(m.height<.56);
});
