import React, { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { petalGeometry, petalMaterial } from './petal-geometry.js';
import { FeatherMotion } from './feather-motion.js';
import { depthScale } from './scene-space.js';
import { fluidVertex } from './fluid-shaders.js';

class FeatherField {
  constructor() {
    this.motion=new FeatherMotion();
    this.geometry=petalGeometry();
    this.material=petalMaterial();
    this.mesh=new THREE.InstancedMesh(this.geometry,this.material,this.motion.feathers.length);
    this.mesh.layers.set(1);this.mesh.name='RosePetals';this.mesh.userData.feathers=this.motion.feathers;this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.mesh.frustumCulled=false;
    this.dummy=new THREE.Object3D();this.air=new Float32Array(64*18*4);this.sampleAge=1;
    this.target=new THREE.WebGLRenderTarget(64,18,{type:THREE.FloatType,depthBuffer:false});
    this.airMaterial=new THREE.ShaderMaterial({vertexShader:fluidVertex,
      fragmentShader:'varying vec2 vUv; uniform sampler2D velocity; void main(){gl_FragColor=texture2D(velocity,vUv);}',
      uniforms:{velocity:{value:null}},depthTest:false,depthWrite:false});
    this.airScene=new THREE.Scene();this.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.airMaterial);
    this.airScene.add(this.quad);this.camera=new THREE.Camera();this.viewport=new THREE.Vector4();this.scissor=new THREE.Vector4();
  }
  sample(gl,field) {
    const target=gl.getRenderTarget(),test=gl.getScissorTest(),clear=gl.autoClear;
    gl.getViewport(this.viewport);gl.getScissor(this.scissor);
    try {
      gl.autoClear=true;gl.setScissorTest(false);
      this.airMaterial.uniforms.velocity.value=field.velocity.read.texture;
      gl.setRenderTarget(this.target);gl.render(this.airScene,this.camera);
      gl.readRenderTargetPixels(this.target,0,0,64,18,this.air);
    } finally {gl.setRenderTarget(target);gl.setViewport(this.viewport);gl.setScissor(this.scissor);gl.setScissorTest(test);gl.autoClear=clear;}
  }
  wind(u,v) {
    // Bilinear sampling avoids cell-boundary kicks as the feather moves through a wake.
    const x=THREE.MathUtils.clamp(u*64-.5,0,63),y=THREE.MathUtils.clamp(v*18-.5,0,17);
    const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
    const sample=(ix,iy,c)=>this.air[(Math.min(iy,17)*64+Math.min(ix,63))*4+c];
    const component=c=>THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(sample(x0,y0,c),sample(x0+1,y0,c),fx),
      THREE.MathUtils.lerp(sample(x0,y0+1,c),sample(x0+1,y0+1,c),fx),fy);
    return [THREE.MathUtils.clamp(component(0)/768,-.6,.6),THREE.MathUtils.clamp(component(1)/216,-.6,.6)];
  }
  tick(gl,field,engine,delta) {
    const dt=engine.paused?0:Math.min(delta,.05);this.sampleAge+=dt;
    if(this.sampleAge>1/15){this.sample(gl,field);this.sampleAge=0;}
    this.motion.update(engine.wall,dt,engine.paused,(u,v)=>this.wind(u,v));
    this.motion.feathers.forEach((p,i)=>{
      const depth=depthScale(p.z),d=this.dummy;
      d.position.set((p.u-.5)*engine.wall.width*depth,(p.v-.5)*engine.wall.height*depth,p.z);
      d.rotation.set(p.pitch,p.yaw,p.roll);d.scale.setScalar(p.size);
      d.updateMatrix();this.mesh.setMatrixAt(i,d.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate=true;
  }
  dispose(){this.mesh.dispose();this.geometry.dispose();this.material.dispose();this.target.dispose();this.airMaterial.dispose();this.quad.geometry.dispose();}
}
export default function Feathers({field,engine}) {
  const {gl}=useThree(),feathers=useMemo(()=>new FeatherField(),[]);
  useEffect(()=>()=>feathers.dispose(),[feathers]);
  useFrame((_,dt)=>feathers.tick(gl,field,engine,dt),-1.7);
  return <group name="FloatingRosePetals">
    <primitive object={feathers.mesh}/>
    <hemisphereLight onUpdate={light=>light.layers.enable(1)} args={['#ffffff','#64506e',.65]}/>
    <directionalLight onUpdate={light=>light.layers.enable(1)} position={[-3,4,6]} intensity={1.45} color="#fff7ff"/>
    <directionalLight onUpdate={light=>light.layers.enable(1)} position={[3,0,-2]} intensity={.45} color="#e8eeff"/>
  </group>;
}
