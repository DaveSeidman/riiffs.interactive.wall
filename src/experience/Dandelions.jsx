import React, { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fluidVertex } from './fluid-shaders.js';

const HEADS=[[.10,.31],[.29,.73],[.43,.24],[.64,.65],[.87,.37],[.17,.68],[.59,.22],[.91,.77]];
const PER_HEAD=80, COUNT=HEADS.length*PER_HEAD;
const up=new THREE.Vector3(0,1,0);
function seedGeometry(){
 const parts=[];
 const tube=(points,radius)=>parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),5,radius,3,false));
 // Actual curved filaments and a hanging achene, not point sprites or line segments.
 for(let i=0;i<12;i++){
  const a=i/12*Math.PI*2,c=Math.cos(a),s=Math.sin(a);
  tube([[0,0,0],[c*.35,.3,s*.35],[c*.85,.45,s*.85],[c,.42,s]],.035);
 }
 tube([[0,-1.35,0],[.03,-.6,0],[0,0,0]],.025);
 const pod=new THREE.SphereGeometry(1,6,6);pod.scale(.10,.28,.10);pod.translate(0,-1.35,0);parts.push(pod);
 const result=mergeGeometries(parts);parts.forEach(p=>p.dispose());return result;
}
function distanceToSegment(p,a,b){const x=b.x-a.x,y=b.y-a.y,t=THREE.MathUtils.clamp(((p.x-a.x)*x+(p.y-a.y)*y)/(x*x+y*y||1),0,1);return Math.hypot(p.x-a.x-x*t,p.y-a.y-y*t);}
class DandelionGarden {
 constructor(){
  this.geometry=seedGeometry();this.material=new THREE.MeshStandardMaterial({color:'#f4e7cf',emissive:'#c9b18e',emissiveIntensity:.15,roughness:.85,metalness:0,side:THREE.DoubleSide});
  this.seeds=new THREE.InstancedMesh(this.geometry,this.material,COUNT);this.seeds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.seeds.frustumCulled=false;
  this.group=new THREE.Group();this.group.add(this.seeds,new THREE.HemisphereLight('#fff0df','#6a2448',2));
  this.stemMaterial=new THREE.MeshStandardMaterial({color:'#937157',roughness:.9});
  this.coreGeometry=new THREE.SphereGeometry(1,12,8);
  this.heads=HEADS.map(([u,v],i)=>{
   const stem=new THREE.Mesh(new THREE.CylinderGeometry(1,1,1,6,18),this.stemMaterial),core=new THREE.Mesh(this.coreGeometry,this.stemMaterial);
   stem.geometry.userData.original=stem.geometry.attributes.position.array.slice();this.group.add(stem,core);
   return {u,v,z:.7+(i%3)*.95,bend:0,velocity:0,release:-1,cooldown:0,stem,core,center:new THREE.Vector3()};
  });
  this.particles=Array.from({length:COUNT},(_,i)=>{
   const j=i%PER_HEAD,y=1-2*(j+.5)/PER_HEAD,a=j*2.399963,r=Math.sqrt(1-y*y);
   return {state:0,p:new THREE.Vector3(),v:new THREE.Vector3(),direction:new THREE.Vector3(Math.cos(a)*r,y,Math.sin(a)*r),phase:i*1.817,spin:i*.73};
  });
  this.flightRotation=new THREE.Quaternion();this.flightEuler=new THREE.Euler();this.targetVelocity=new THREE.Vector3();this.dummy=new THREE.Object3D();this.time=0;this.sampleAge=1;this.air=new Float32Array(32*9*4);
  this.target=new THREE.WebGLRenderTarget(32,9,{type:THREE.FloatType,depthBuffer:false});
  this.airMaterial=new THREE.ShaderMaterial({vertexShader:fluidVertex,fragmentShader:'varying vec2 vUv; uniform sampler2D velocity; void main(){gl_FragColor=texture2D(velocity,vUv);}',uniforms:{velocity:{value:null}},depthTest:false,depthWrite:false});
  this.airScene=new THREE.Scene();this.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.airMaterial);this.airScene.add(this.quad);this.camera=new THREE.Camera();this.viewport=new THREE.Vector4();this.scissor=new THREE.Vector4();
 }
 sample(gl,field){
  const target=gl.getRenderTarget(),test=gl.getScissorTest(),clear=gl.autoClear;gl.getViewport(this.viewport);gl.getScissor(this.scissor);
  try{gl.autoClear=true;gl.setScissorTest(false);this.airMaterial.uniforms.velocity.value=field.velocity.read.texture;gl.setRenderTarget(this.target);gl.render(this.airScene,this.camera);gl.readRenderTargetPixels(this.target,0,0,32,9,this.air);}
  finally{gl.setRenderTarget(target);gl.setViewport(this.viewport);gl.setScissor(this.scissor);gl.setScissorTest(test);gl.autoClear=clear;}
 }
 wind(u,v){const x=THREE.MathUtils.clamp(Math.floor(u*32),0,31),y=THREE.MathUtils.clamp(Math.floor(v*9),0,8),i=(y*32+x)*4;return [THREE.MathUtils.clamp(this.air[i]/768,-.25,.25),THREE.MathUtils.clamp(this.air[i+1]/216,-.25,.25)];}
 tick(gl,field,engine,delta){
  const dt=engine.paused?0:Math.min(delta,1/30),w=engine.wall.width,h=engine.wall.height;this.time+=dt;this.sampleAge+=dt;
  // Sample a tiny velocity grid at 5 Hz; never read the full simulation back to the CPU.
  if(this.sampleAge>.2){this.sample(gl,field);this.sampleAge=0;}
  this.heads.forEach((head,k)=>{
   const depth=(10-head.z)/8, radius=h*.06*depth;
   const [wind]=this.wind(head.u,head.v);
   const target=wind*1.3+Math.sin(this.time*.65+k*1.9)*.025;
   head.velocity+=(target-head.bend)*dt*3.5;head.velocity*=Math.exp(-dt*2.0);head.bend+=head.velocity*dt;
   const baseX=(head.u-.5)*w*depth,baseY=(head.v-.5)*h*depth-h*.24*depth;
   head.center.set(baseX+head.bend*h*depth,baseY+h*.24*depth,head.z);
   head.core.position.copy(head.center);head.core.scale.setScalar(radius*.13);
   const attr=head.stem.geometry.attributes.position,original=head.stem.geometry.userData.original;
   for(let j=0;j<attr.count;j++){
    const t=original[j*3+1]+.5;
    attr.setXYZ(j,baseX+original[j*3]*h*.0014+head.bend*h*depth*t*t,baseY+t*h*.24*depth,head.z+original[j*3+2]*h*.0014);
   }
   attr.needsUpdate=true;head.stem.geometry.computeVertexNormals();
   if(!engine.paused&&head.release<0&&head.cooldown<=0){
    const p={x:head.u*w+head.bend*h,y:head.v*h};
    for(const m of field.impulses||[]){
     if(distanceToSegment(p,{x:m.fromU*w,y:m.fromV*h},{x:m.u*w,y:m.v*h})<h*.12&&Math.hypot(m.dx,m.dy)>.0002){head.release=0;break;}
    }
   }
   if(head.release>=0)head.release+=dt;
   let gone=0;
   for(let j=0;j<PER_HEAD;j++){
    const index=k*PER_HEAD+j,p=this.particles[index],d=this.dummy;
    if(p.state===0){
     p.p.copy(head.center).addScaledVector(p.direction,radius);
     if(head.release>=0&&head.release>(j*37%PER_HEAD)/PER_HEAD*1.2){
      p.state=1;p.flyAge=0;p.v.set(0,0,0);
     }
    }
    if(p.state===1&&dt>0){
     p.flyAge+=dt;
     const perspective=(10-p.p.z)/8,u=p.p.x/(w*perspective)+.5,v=p.p.y/(h*perspective)+.5;
     const [airX,airY]=this.wind(u,v);
     // Airborne seeds retain momentum. Lift and low-frequency gusts dominate, not liquid advection.
     const vx=airX*h*.18+Math.sin(this.time*.47+p.phase)*.045;
     const vy=.12+Math.sin(this.time*.37+p.phase)*.035+Math.max(-.025,airY*h*.06);
     const vz=Math.sin(this.time*.23+p.phase)*.08;
     const drag=1-Math.exp(-dt*.65);
     p.v.lerp(this.targetVelocity.set(vx,vy,vz),drag);p.p.addScaledVector(p.v,dt);p.spin+=dt*(.22+p.v.x);
     if(u<-.12||u>1.12||v>1.15||v<-.15||p.p.z>6||p.p.z<-4)p.state=2;
    }
    d.position.copy(p.p);
    if(p.state===0)d.quaternion.setFromUnitVectors(up,p.direction);
    else {
     this.flightEuler.set(Math.sin(this.time*.8+p.phase)*.24,p.spin,-p.v.x*1.3);
     this.flightRotation.setFromEuler(this.flightEuler);
     const blend=THREE.MathUtils.smoothstep(p.flyAge??0,0,2);
     d.quaternion.setFromUnitVectors(up,p.direction).slerp(this.flightRotation,blend);
    }
    d.scale.setScalar(p.state===2?0:h*.014*depth);d.updateMatrix();this.seeds.setMatrixAt(index,d.matrix);
    if(p.state===2)gone++;
   }
   if(gone===PER_HEAD){
    head.cooldown+=dt;
    if(head.cooldown>1.5){for(let j=0;j<PER_HEAD;j++)this.particles[k*PER_HEAD+j].state=0;head.release=-1;head.cooldown=0;}
   }
  });
  this.seeds.instanceMatrix.needsUpdate=true;
 }
 dispose(){this.geometry.dispose();this.material.dispose();this.stemMaterial.dispose();this.coreGeometry.dispose();this.heads.forEach(h=>h.stem.geometry.dispose());this.target.dispose();this.airMaterial.dispose();this.quad.geometry.dispose();this.seeds.dispose();}
}
export default function Dandelions({field,engine}){
 const {gl}=useThree(),garden=useMemo(()=>new DandelionGarden(),[]);
 useEffect(()=>()=>garden.dispose(),[garden]);
 useFrame((_,dt)=>garden.tick(gl,field,engine,dt),-1.7);
 return <primitive object={garden.group}/>;
}
