import React,{useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {projectJoint} from './body.js';
import {screenToWorld,depthScale} from './scene-space.js';

export default function Magnolias({engine}){
 const root=useRef();
 const flowers=useMemo(()=>Array.from({length:7},(_,i)=>({x:Math.sin(i*2.4)*3,y:Math.cos(i*1.7)*.7,vx:0,vy:0,z:-3+i*.65,angle:i*1.8,size:.16+(i%3)*.045})),[]);
 const petal=useMemo(()=>{
  const geometry=new THREE.SphereGeometry(1,20,14);
  const p=geometry.attributes.position;
  for(let i=0;i<p.count;i++){
   const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
   p.setXYZ(i,x*.38,(y+1)*.55,z*.10+Math.pow((y+1)*.5,2)*.25);
  }
  geometry.computeVertexNormals();return geometry;
 },[]);
 useFrame((_,delta)=>{
  const dt=engine.paused?0:Math.min(delta,.05);
  const hands=engine.people.flatMap(person=>[15,16].map(i=>person.joints[i]).filter(j=>j?.p3&&j.vis>.4).map(j=>projectJoint(j.p3,engine.wall)));
  flowers.forEach((f,i)=>{
   for(const h of hands){const dx=f.x-h.x,dy=f.y-h.y,d=Math.hypot(dx,dy);if(d<.65){const force=(1-d/.65)*.85;f.vx+=dx/Math.max(d,.08)*force*dt;f.vy+=dy/Math.max(d,.08)*force*dt;}}
   f.vx+=(Math.sin(engine.time*.19+i)*.015-f.vx*.55)*dt;
   f.vy+=(Math.cos(engine.time*.17+i)*.012-f.vy*.55)*dt;
   f.x+=f.vx*dt;f.y+=f.vy*dt;
   const xLimit=engine.wall.width/2-.3,yLimit=engine.wall.height/2-.28;
   if(Math.abs(f.x)>xLimit){f.x=Math.sign(f.x)*xLimit;f.vx*=-.6;}
   if(Math.abs(f.y)>yLimit){f.y=Math.sign(f.y)*yLimit;f.vy*=-.6;}
   f.angle+=dt*.12;
   const group=root.current.children[i];screenToWorld(f,f.z,group.position);
   group.scale.setScalar(f.size*depthScale(f.z));group.rotation.set(f.angle*.7,f.angle,i*.6+f.angle*.4);
  });
 });
 return <group ref={root} name="FloatingMagnolias">{flowers.map((f,i)=><group key={i}>
  {Array.from({length:9},(_,j)=><mesh key={j} geometry={petal} rotation={[.45+(j%3)*.18,0,j*Math.PI*2/9]} position={[0,0,.02*(j%3)]}>
   <meshStandardMaterial color={j%3===0?'#f3c4df':'#fff1f7'} roughness={.42} side={THREE.DoubleSide}/>
  </mesh>)}
  <mesh scale={[.17,.22,.17]}><sphereGeometry args={[1,16,12]}/><meshStandardMaterial color="#d9b887" roughness={.65}/></mesh>
 </group>)}</group>;
}
