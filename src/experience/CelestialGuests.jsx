import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { verticalFov, depthScale, screenToWorld, ASTRONAUT_BACK_Z } from './scene-space.js';
import { AstronautMotion } from './astronaut-motion.js';
import { AstronautSwimmer } from './astronaut-rig.js';
import { AstronautAttitude } from './astronaut-attitude.js';
import { prepareAstronautMaterial } from './astronaut-materials.js';
import AstronautVapor from './AstronautVapor.jsx';
import { lavaPlanetGeometry } from './lava-planet-geometry.js';
import { EclipseMotion, ECLIPSE_RADIUS_FRACTION } from './eclipse-motion.js';

function AstronautModel({ engine }) {
  const gltf=useLoader(GLTFLoader,`${import.meta.env.BASE_URL}models/astronaut/astronaut-skinned.glb`);
  const root=useRef();
  const motion=useMemo(()=>new AstronautMotion(),[]);
  const attitude=useMemo(()=>new AstronautAttitude(),[]);
  const model=useMemo(()=>{
    const scene=clone(gltf.scene);
    scene.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(scene), size=box.getSize(new THREE.Vector3());
    const center=box.getCenter(new THREE.Vector3());
    const scale=1/Math.max(size.y,.001);
    scene.scale.multiplyScalar(scale);
    scene.position.copy(center).multiplyScalar(-scale);
    scene.traverse(object=>{
      if(!object.isMesh)return;
      object.layers.set(2);
      object.material=Array.isArray(object.material)
        ? object.material.map(prepareAstronautMaterial)
        : prepareAstronautMaterial(object.material);
    });
    return scene;
  },[gltf]);
  useEffect(()=>()=>model.traverse(o=>{if(o.isMesh)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}),[model]);
  const suitMaterials=useMemo(()=>{const materials=new Set();model.traverse(o=>{if(o.isMesh)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));});return [...materials];},[model]);
  const swimmer=useMemo(()=>new AstronautSwimmer(model),[model]);
  useFrame((_,dt)=>{
    const m=motion.update(engine.people,engine.wall,dt,engine.paused);
    const near=THREE.MathUtils.clamp((m.height-.55)/(1.8288-.55),0,1);
    const illumination=.22+.78*near*near*(3-2*near);
    root.current.visible=true;
    suitMaterials.forEach(material=>{material.userData.depthLight.value=illumination;});
    const t=m.time, depth=Math.min((m.depthScale ?? 2)*swimmer.depthCorrection,depthScale(ASTRONAUT_BACK_Z));
    const z=10-8*depth;
    root.current.position.set(
      (m.x+Math.sin(t*.55)*.035)*depth,
      (m.y+Math.sin(t*.43)*.025)*depth,z);
    const pose=attitude.update(m,dt,engine.paused);
    root.current.rotation.set(pose.pitch,pose.yaw,pose.roll,'YXZ');
    root.current.scale.setScalar(1.1);
    swimmer.update(root.current,{...m,depthScale:depth});
    swimmer.fitScreenHeight(root.current,m,engine.paused?0:Math.min(dt,.05));
    root.current.userData.focusTarget=swimmer.bones.get("head")?.bone;
    root.current.userData.focusNear=near;
    root.current.userData.astronaut={targetId:m.targetId,trackingSeconds:m.attention,apparentHeight:m.height,phase:m.phase};
  });
  return <><group ref={root} name="SwimmingAstronaut"><primitive object={model}/></group><AstronautVapor root={root} motion={motion} engine={engine}/></>;
}
export function Astronaut({engine}) {
  return <Suspense fallback={null}><AstronautModel engine={engine}/></Suspense>;
}

// The bodies are true opaque spheres. Only the surrounding corona uses a billboard.
const eclipseVertex = `varying vec2 vUv;
void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const planetVertex = `
attribute float aEdge,aRock;
varying vec3 vGlobe,vNormal,vView;varying float vEdge,vRock;
void main(){
 vGlobe=position;vNormal=normalize(normalMatrix*normal);vEdge=aEdge;vRock=aRock;
 vec4 mv=modelViewMatrix*vec4(position,1.);vView=-mv.xyz;gl_Position=projectionMatrix*mv;
}`;
const planetFragment = `
uniform float time;
varying vec3 vGlobe,vNormal,vView;varying float vEdge,vRock;
void main(){
 vec3 globe=normalize(vGlobe),normal=normalize(vNormal),view=normalize(vView);
 vec3 key=normalize(mat3(viewMatrix)*vec3(-.6,.85,.6));
 float diffuse=max(0.,dot(normal,key)),rim=pow(1.-max(0.,dot(normal,view)),3.);
 float aa=max(fwidth(vEdge),.004);
 float fissure=1.-smoothstep(.025-aa,.075+aa,vEdge);
 float bevelGlow=exp(-vEdge*24.);
 // Attenuate texture frequencies smaller than a screen pixel. Unfiltered grain
 // flickers as the raised plates rotate and bloom magnifies those highlights.
 vec3 grainPhase=globe*vec3(170.,193.,157.);
 vec3 footprint=fwidth(grainPhase);
 vec3 grainWave=sin(grainPhase)*exp(-.5*footprint*footprint);
 float grain=.5+.5*grainWave.x*grainWave.y*grainWave.z;
 vec3 crust=mix(vec3(.006,.008,.018),vec3(.045,.028,.085),vRock);
 crust*=.24+diffuse*1.5;crust+=vec3(.15,.11,.33)*pow(diffuse,5.)*.5;
 crust*=.85+grain*.15;
 float gradient=clamp(globe.x*.38+globe.y*.28+.5,0.,1.);
 vec3 lava=mix(vec3(.18,.06,1.),vec3(1.,.025,.3),smoothstep(0.,.55,gradient));
 lava=mix(lava,vec3(1.,.42,.025),smoothstep(.4,1.,gradient));
 float core=1.-smoothstep(.006,.028,vEdge);
 lava=mix(lava,lava+vec3(.8,.45,.15),core*.55);
 lava*=1.7; // Constant emission: rotation should not introduce rhythmic brightness pulses.
 vec3 color=mix(crust,lava,fissure)+lava*bevelGlow*.12;
 color+=vec3(.15,.17,.5)*rim*(.15+diffuse*.55);
 gl_FragColor=vec4(color,1.);
}`;
const eclipseFragment = `
uniform float time;
uniform vec2 uWall,uSun,uMoon;
uniform float uRadius;
varying vec2 vUv;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
void main(){
 vec2 p=((vUv-.5)*uWall-uSun)/uRadius*.83;
 float radius=.83;
 // Drift through both crescents, lingering around totality.
 vec2 center=(uMoon-uSun)/uRadius*.83;
 float offset=length(center);
 float r=length(p), m=length(p-center);
 float aa=max(fwidth(r),.001);
 float disc=1.-smoothstep(radius-aa,radius+aa,r);
 float mask=1.-smoothstep(.855-aa,.855+aa,m);
 float visible=disc*(1.-mask);
 if(r>radius+1.3 && m>.855+aa)discard;
 float alignment=1.-smoothstep(.03,.65,abs(offset));
 float angle=atan(p.y,p.x);
 vec3 blue=vec3(.12,.30,.95), red=vec3(.90,.045,.16);
 vec3 tint=mix(blue,red,smoothstep(-.8,.8,p.x));
 // Angular noise stretches the corona outward into soft, irregular streamers.
 float rays=noise(vec2(cos(angle)*8.,sin(angle)*8.)+time*.018);
 rays=.55*rays+.3*noise(vec2(angle*31.,r*2.-time*.03));
 float outside=max(0.,r-radius);
 float corona=exp(-outside*(7.+rays*9.))*(.18+rays*.65);
 corona*=smoothstep(radius-.008,radius+.014,r)*(1.-mask);
 float rim=exp(-abs(r-radius)*150.)*(1.-mask*.94);
 float beads=pow(.5+.5*sin(angle*47.+noise(p*35.)*3.),12.);
 float contact=exp(-abs(m-.855)*95.)*exp(-abs(r-radius)*80.);
 float diamond=contact*(1.-alignment)*2.;
 vec3 light=tint*corona*(.14+alignment*2.8);
 light+=mix(tint,vec3(.8,.85,1.),.6)*(rim*(.08+alignment*1.7)+diamond);
 light+=red*beads*rim*alignment*.38;
 vec3 color=light;
 // Opaque black silhouettes remove the stars behind both bodies, with a soft halo outside.
 float haloAlpha=clamp(max(light.r,max(light.g,light.b))*2.,0.,1.);
 float alpha=haloAlpha;
 
 if(alpha<.001)discard;
 gl_FragColor=vec4(color/max(alpha,.001),alpha);
}`;
export function Eclipse({ engine }) {
  const corona=useRef(),sun=useRef(),moon=useRef();
  const motion=useMemo(()=>new EclipseMotion(),[]);
  const uniforms=useMemo(()=>({time:{value:0},uWall:{value:new THREE.Vector2()},
    uSun:{value:new THREE.Vector2()},uMoon:{value:new THREE.Vector2()},uRadius:{value:1}}),[]);
  const planetGeometry=useMemo(()=>lavaPlanetGeometry(),[]);
  useEffect(()=>()=>planetGeometry.dispose(),[planetGeometry]);
  const planetUniforms=useMemo(()=>({time:{value:0}}),[]);
  useFrame((_,dt)=>{
    const m=motion.update(engine.people,engine.wall,dt,engine.paused);
    const radius=engine.wall.height*ECLIPSE_RADIUS_FRACTION;
    const liveUniforms=corona.current.material.uniforms;
    liveUniforms.time.value=m.time;
    liveUniforms.uWall.value.set(engine.wall.width,engine.wall.height);
    liveUniforms.uSun.value.set(m.sun.x,m.sun.y);liveUniforms.uMoon.value.set(m.moon.x,m.moon.y);
    // Match the raised crust, rather than the old unit-sphere silhouette.
    const outerRadius=radius*1.08;
    liveUniforms.uRadius.value=outerRadius;
    corona.current.scale.set(engine.wall.width*depthScale(-.5),engine.wall.height*depthScale(-.5),1);
    screenToWorld(m.sun,0,sun.current.position);
    screenToWorld(m.moon,.6,moon.current.position);
    sun.current.scale.setScalar(radius*depthScale(0));
    moon.current.scale.setScalar(outerRadius*(.855/.83)*depthScale(.6));
    // Angular velocity gently ramps up from rest; the material stays in object space.
    const spin=m.time-2*(1-Math.exp(-m.time/2));
    sun.current.rotation.set(.23,spin*.32,.38,'ZXY');
    moon.current.rotation.set(spin*.017,spin*.023,0);
    sun.current.material.uniforms.time.value=m.time;
    sun.current.userData.eclipse={controlled:m.controlled,alignment:m.alignment};
  });
  return <group name="PoseControlledEclipse">
    <mesh ref={sun} name="CrustedGasPlanet" geometry={planetGeometry}>
      <shaderMaterial vertexShader={planetVertex} fragmentShader={planetFragment}
        uniforms={planetUniforms} toneMapped={false}/>
    </mesh>
    <mesh ref={moon} name="EclipseSilhouette">
      <sphereGeometry args={[1,96,64]}/>
      <meshBasicMaterial color="#000000" toneMapped={false}/>
    </mesh>
    <mesh ref={corona} position={[0,0,-.5]} name="EclipseCorona">
      <planeGeometry args={[1,1]}/>
      <shaderMaterial vertexShader={eclipseVertex} fragmentShader={eclipseFragment}
        uniforms={uniforms} transparent depthWrite={false} toneMapped={false}/>
    </mesh>
  </group>;
}
export function BlushObjects({ engine }) {
  const { camera } = useThree();
  useFrame(() => {
    camera.fov = verticalFov(engine.wall.height);
    camera.aspect = engine.wall.width / engine.wall.height;
    camera.updateProjectionMatrix();
  }, -1.8);
  return null;
}
