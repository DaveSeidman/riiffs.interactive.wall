import React, {useEffect,useMemo} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import * as THREE from 'three';
const COUNT=128;
export default function AstronautVapor({root,motion,engine}) {
 const {gl}=useThree();
 const vapor=useMemo(()=>{
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(COUNT*3),3));
  geometry.setAttribute('aLife',new THREE.BufferAttribute(new Float32Array(COUNT),1));
  return {geometry,particles:Array.from({length:COUNT},()=>({age:9,p:new THREE.Vector3(),v:new THREE.Vector3()})),cursor:0,clock:0,lastPhase:null,
   direction:new THREE.Vector3(),nozzle:new THREE.Vector3(),size:new THREE.Vector2(),uniforms:{uHeight:{value:1080}}};
 },[]);
 useEffect(()=>()=>vapor.geometry.dispose(),[vapor]);
 useFrame((_,delta)=>{
  if(!root.current||engine.paused)return;
  const dt=Math.min(delta,.05),m=motion;
  vapor.clock+=dt;
  vapor.direction.set(m.thrust.x*(m.depthScale??1),m.thrust.y*(m.depthScale??1),m.thrust.z);
  const moving=vapor.direction.length()>.015;
  if(m.presence>.1&&moving&&(vapor.clock>.85||vapor.lastPhase!==m.phase)){
   vapor.clock=0;vapor.lastPhase=m.phase;
   vapor.direction.normalize().multiplyScalar(-.28);
   root.current.updateMatrixWorld(true);
   for(const side of [-1,1])for(let j=0;j<5;j++){
    const p=vapor.particles[vapor.cursor++%COUNT],phase=vapor.cursor*2.39996;
    vapor.nozzle.set(side*.13,.04,-.14);root.current.localToWorld(vapor.nozzle);
    p.age=j*.025;p.p.copy(vapor.nozzle);
    p.v.copy(vapor.direction).add(new THREE.Vector3(Math.sin(phase)*.045,Math.cos(phase)*.045,Math.sin(phase*1.7)*.04));
   }
  }
  const position=vapor.geometry.attributes.position,life=vapor.geometry.attributes.aLife;
  vapor.particles.forEach((p,i)=>{p.age+=dt;p.p.addScaledVector(p.v,dt);p.v.multiplyScalar(Math.exp(-dt*.35));position.setXYZ(i,p.p.x,p.p.y,p.p.z);life.setX(i,p.age<3?p.age/3:1);});
  position.needsUpdate=true;life.needsUpdate=true;
  vapor.uniforms.uHeight.value=gl.getDrawingBufferSize(vapor.size).y;
 });
 return <points geometry={vapor.geometry} frustumCulled={false} name="AstronautThrusterVapor">
  <shaderMaterial transparent depthWrite={false} uniforms={vapor.uniforms} toneMapped={false}
   vertexShader={`attribute float aLife;uniform float uHeight;varying float life;void main(){life=aLife;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((.025+aLife*.16)*uHeight*projectionMatrix[1][1]/max(.1,-mv.z),1.,80.);}`}
   fragmentShader={`varying float life;void main(){float r=length(gl_PointCoord-.5)*2.;float soft=exp(-r*r*4.)*(1.-smoothstep(.65,1.,r));float alpha=soft*sin(life*3.14159)*(1.-life)*.22;if(alpha<.002)discard;gl_FragColor=vec4(.72,.83,.95,alpha);}`}/>
 </points>;
}
