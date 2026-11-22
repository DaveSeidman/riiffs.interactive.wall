import React,{Suspense,useMemo,useRef} from 'react';
import {useFrame,useLoader,useThree} from '@react-three/fiber';
import * as THREE from 'three';
import {QuietBranding} from './quiet-branding.js';
import {projectJoint} from './body.js';
import {depthScale} from './scene-space.js';

function Branding({engine,mode}){
 const {scene}=useThree(),root=useRef(),logo=useRef(),lunar=useRef();
 const image=useLoader(THREE.TextureLoader,`${import.meta.env.BASE_URL}branding/riiffs-logo.png`);
 const state=useMemo(()=>new QuietBranding(),[]);
 const temp=useMemo(()=>({p:new THREE.Vector3(),s:new THREE.Vector3(),obstacles:[],age:1}),[]);
 const wordmark=useLoader(THREE.TextureLoader,`${import.meta.env.BASE_URL}branding/lunar-${mode}${mode==='blush'?'-white':''}.svg`);
 wordmark.colorSpace=THREE.SRGBColorSpace;
 useFrame((_,delta)=>{
  const dt=engine.paused?0:Math.min(delta,.05);temp.age+=dt;
  if(temp.age>.15){
   const obstacles=[];
   for(const person of engine.people){
    const points=person.joints.filter(j=>j?.p3&&j.vis>.4).map(j=>projectJoint(j.p3,engine.wall));
    if(points.length){const xs=points.map(p=>p.x),ys=points.map(p=>p.y),left=Math.min(...xs),right=Math.max(...xs),bottom=Math.min(...ys),top=Math.max(...ys);
     obstacles.push({x:(left+right)/2,y:(bottom+top)/2,hw:(right-left)/2+.1,hh:(top-bottom)/2+.1});}
   }
   scene.traverse(o=>{
    if(!o.visible)return;
    let parent=o;while(parent){if((parent.name==='PulseScene'&&mode!=='pulse')||(parent.name==='BlushScene'&&mode!=='blush'))return;parent=parent.parent;}
    if(o.name==='HeroProduct' && o.userData.slot){obstacles.push(o.userData.slot);
    }else if(o.name==='RosePetals'){
     for(const p of o.userData.feathers??[]){const size=p.size/depthScale(p.z);if(size<.28)continue;obstacles.push({x:(p.u-.5)*engine.wall.width,y:(p.v-.5)*engine.wall.height,hw:size*.4,hh:size*.5});}
    }else if(['SwimmingAstronaut','lunar-moon','CrustedGasPlanet','EclipseSilhouette','perfume-1','perfume-2'].includes(o.name)){
     o.getWorldPosition(temp.p);o.getWorldScale(temp.s);const depth=depthScale(temp.p.z);
     if(depth<=0)return;
     let hw=temp.s.x/depth,hh=temp.s.y/depth;
     if(o.name==='SwimmingAstronaut'){hh=(o.userData.astronaut?.apparentHeight??.55)*.6;hw=hh*.75;}
     else if(o.name.startsWith('perfume-')){hw*=.4;hh*=.65;}
     obstacles.push({x:temp.p.x/depth,y:temp.p.y/depth,hw,hh});
    }
   });
   temp.obstacles=obstacles;temp.age=0;
  }
  const hero=root.current.parent.getObjectByName("HeroProduct");
  const side=hero?.userData.side ?? (mode==="pulse"?1:-1);
  const m=state.update(temp.obstacles,engine.wall,dt,engine.paused,-side);
  root.current.visible=Boolean(m.slot)&&m.alpha>0;
  root.current.userData.slot=m.slot;
  if(m.slot){const depth=depthScale(7);root.current.position.set(m.slot.x*depth,m.slot.y*depth,7);root.current.scale.setScalar(depth*(m.slot.hw/.48));}
  const opacity=(m.opacity??0)*(mode==='blush'?.45:.16);
  logo.current.material.uniforms.opacity.value=opacity;
  lunar.current.material.opacity=(m.opacity??0)*(mode==='blush'?.65:.22);
 });
 return <group ref={root} name="QuietBranding" visible={false}>
  <mesh ref={logo} position={[0,.07,0]} renderOrder={1000}>
   <planeGeometry args={[.86,.195]}/>
   <shaderMaterial transparent depthTest={false} depthWrite={false} toneMapped={false}
    uniforms={{map:{value:image},opacity:{value:0},inkColor:{value:new THREE.Color(mode==='blush'?'#ffffff':'#f0f5ff')}}}
    vertexShader="varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}" 
    fragmentShader="uniform sampler2D map;uniform float opacity;uniform vec3 inkColor;varying vec2 vUv;void main(){vec4 ink=texture2D(map,vUv);float a=ink.a*(1.-dot(ink.rgb,vec3(.299,.587,.114)));gl_FragColor=vec4(inkColor,a*opacity);}"/>
  </mesh>
  <mesh ref={lunar} position={[0,-.16,0]} renderOrder={1000}>
   <planeGeometry args={[.86,mode==='blush'?.0844:.0864]}/>
   <meshBasicMaterial map={wordmark} transparent opacity={0} depthTest={false} depthWrite={false} toneMapped={false}/>
  </mesh>
 </group>;
}
export default function QuietBrandingOverlay(props){return <Suspense fallback={null}><Branding {...props}/></Suspense>;}
