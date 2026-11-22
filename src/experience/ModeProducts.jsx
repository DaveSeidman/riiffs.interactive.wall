import React,{Suspense,useMemo,useRef,useEffect} from 'react';
import {useLoader,useFrame,useThree} from '@react-three/fiber';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ProductBottle} from './InteractionScene.jsx';
import {prepareBottleMaterials} from './bottle-materials.js';
import {QuietBranding} from './quiet-branding.js';
import {depthScale,screenToWorld} from './scene-space.js';
import {projectJoint} from './body.js';

function Hero({engine,mode}){
 const {scene}=useThree(),root=useRef(),pose=useRef(),title=useRef();
 const gltf=useLoader(GLTFLoader,`${import.meta.env.BASE_URL}models/products/product-0${mode==='pulse'?1:2}.glb`);
 const model=useMemo(()=>{
  const clone=gltf.scene.clone(true);
  clone.traverse(o=>{if(o.isMesh)o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();});
  prepareBottleMaterials(clone);
  const box=new THREE.Box3().setFromObject(clone),center=box.getCenter(new THREE.Vector3());
  const scale=.88/box.getSize(new THREE.Vector3()).y;
  clone.scale.setScalar(scale);clone.position.copy(center).multiplyScalar(-scale);
  clone.traverse(o=>{if(o.isMesh)for(const m of [o.material].flat()){
   m.userData.heroOpacity=m.opacity;m.userData.heroDepthWrite=m.depthWrite;m.transparent=true;
  }});
  return clone;
 },[gltf]);
 const label=useMemo(()=>{
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=180;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.textAlign='center';
  ctx.font='500 54px Arial';ctx.fillText(`LUNAR ${mode.toUpperCase()}`,512,77);
  ctx.font='23px Arial';ctx.fillText('EXTRAIT DE PARFUM',512,131);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
 },[mode]);
 useEffect(()=>()=>{label.dispose();model.traverse(o=>{if(o.isMesh)for(const m of [o.material].flat())m.dispose();});},[label,model]);
 const state=useMemo(()=>new QuietBranding({hw:.54,hh:.64,alternate:true}),[]);
 const temp=useMemo(()=>({p:new THREE.Vector3(),s:new THREE.Vector3(),age:0,hold:0,last:null,side:mode==="pulse"?1:-1}),[]);
 useFrame((_,delta)=>{
  const dt=engine.paused?0:Math.min(delta,.05);temp.age+=dt;
  const obstacles=[];
  for(const person of engine.people){
   const points=person.joints.filter(j=>j?.p3&&j.vis>.4).map(j=>projectJoint(j.p3,engine.wall));
   if(points.length){const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
    obstacles.push({x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2,hw:(Math.max(...xs)-Math.min(...xs))/2,hh:(Math.max(...ys)-Math.min(...ys))/2});}
  }
  scene.traverse(o=>{
   let parent=o;while(parent){if((parent.name==='PulseScene'&&mode!=='pulse')||(parent.name==='BlushScene'&&mode!=='blush'))return;parent=parent.parent;}
   if(o.name==='QuietBranding'&&o.userData.slot){obstacles.push(o.userData.slot);return;}

   if(!o.visible||!['SwimmingAstronaut','lunar-moon','CrustedGasPlanet','EclipseSilhouette','perfume-1'].includes(o.name))return;
   o.getWorldPosition(temp.p);o.getWorldScale(temp.s);const d=depthScale(temp.p.z);if(d<=0)return;
   let hw=temp.s.x/d,hh=temp.s.y/d;
   if(o.name==='SwimmingAstronaut'){hh=(o.userData.astronaut?.apparentHeight??.55)*.6;hw=hh*.75;}
   if(o.name==='perfume-1'){hw*=.4;hh*=.65;}
   obstacles.push({x:temp.p.x/d,y:temp.p.y/d,hw,hh});
  });
  if(state.opacity>.95)temp.hold+=dt;
  // Retire a hero after a short hold, and reserve the old position until it has
  // faded completely. A new placement is chosen only while invisible.
  if(temp.hold>10 && !temp.last && state.slot){temp.last={...state.slot};temp.side*=-1;}
  root.current.userData.side=temp.side;
  if(temp.last)obstacles.push(temp.last);
  const previous=state.slot;
  const m=state.update(obstacles,engine.wall,dt,engine.paused,temp.side);
  if(m.slot!==previous){temp.hold=0;temp.last=null;}
  root.current.visible=!!m.slot&&m.opacity>0;
  root.current.userData.slot=m.slot;
  if(m.slot){
   // Keep the entire bottle and lockup inside the wall.
   const y=THREE.MathUtils.clamp(m.slot.y,-engine.wall.height/2+.66,engine.wall.height/2-.66);
   m.slot.y=y;
   screenToWorld({x:m.slot.x,y:y+.09},3,root.current.position);
   root.current.scale.setScalar(depthScale(3)*(.97+.03*(m.opacity??0)));
  }
  pose.current.rotation.set(-.12+Math.sin(temp.age*.17)*.025,-.32+temp.age*Math.PI/24,-.16+Math.sin(temp.age*.11)*.025);
  model.traverse(o=>{if(o.isMesh)for(const mat of [o.material].flat()){
   mat.opacity=mat.userData.heroOpacity*(m.opacity??0);
   mat.depthWrite=mat.userData.heroDepthWrite&&(m.opacity??0)>.99;
  }});
  title.current.material.opacity=(m.opacity??0)*.85;
 },-.25);
 return <group ref={root} name="HeroProduct" visible={false}>
  <group ref={pose}><primitive object={model}/></group>
  <mesh ref={title} position={[0,-.60,.18]}><planeGeometry args={[.93,.164]}/>
   <meshBasicMaterial map={label} transparent opacity={0} depthWrite={false} toneMapped={false}/>
  </mesh>
 </group>;
}
export default function ModeProducts({engine,mode}){
 const index=mode==='pulse'?0:1;
 return <>
  <ProductBottle engine={engine} index={0} modelIndex={index} name={`Lunar ${mode==='pulse'?'Pulse':'Blush'}`} color={index?'#e879b4':'#8f7afa'}/>
  <Suspense fallback={null}><Hero engine={engine} mode={mode}/></Suspense>
 </>;
}
