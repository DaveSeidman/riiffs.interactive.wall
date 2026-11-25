import React, { useMemo, useRef, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { StableBloomPass } from "./StableBloomPass.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FeatherDepthOfField } from "./FeatherDepthOfField.js";
import { sceneBlendFragment } from "./ModeTransition.js";
import { MODE_INTERVAL, TRANSITION_DURATION, transitionFrame, orbitCamera, orbitCrossfade, orbitTwist } from "./mode-transition.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { BONES, MAX_PEOPLE, projectJoint, proximity } from "./body.js";
import { getPalette } from "./palette.js";
import InteractionScene, {SceneCamera} from "./InteractionScene.jsx";
import ModeProducts from "./ModeProducts.jsx";
import Magnolias from "./Magnolias.jsx";
import Blush from "./Blush.jsx";
import QuietBrandingOverlay from "./QuietBranding.jsx";
import { Astronaut, BlushObjects, Eclipse } from "./CelestialGuests.jsx";
import { moonVisible, productsVisible } from "./interactions.js";
import { StellarOrbits } from "./stellar-orbits.js";
import {
  CAMERA_Z,
  CAMERA_NEAR,
  CAMERA_FAR,
  INTERACTION_Z,
  verticalFov,
  clipDepth,
  worldToScreen,
  depthScale,
} from "./scene-space.js";

const MAX_SEGMENTS = BONES.length * MAX_PEOPLE;
const CAMERA_OPTIONS = {
  position: [0, 0, CAMERA_Z],
  near: CAMERA_NEAR,
  far: CAMERA_FAR,
  zoom: 1,
  manual: true,
  fov: verticalFov(2.25),
  aspect: 32 / 9,
};
const vertexShader = `
  attribute vec3 aSeed;
  attribute vec3 aOrbit;
  uniform float uSkyAngle, uStrength, uRadius;
  uniform vec2 uWall,uSkyPole,uSkyOffset;
  uniform float uSkyTile;
  uniform float uOrbitDepth;
  uniform int uCount;
  uniform vec4 uA[${MAX_SEGMENTS}], uB[${MAX_SEGMENTS}];
  varying float vEnergy, vSeed, vDepth, vAngle, vAcross;
  varying vec2 vWall;
  varying float vOrbit;
  void main() {
    // One rigid rotation, in physical wall units: no per-star drift or brightness pulse.
    float angle = uSkyAngle;
    vec2 pole = uSkyPole;
    float coverage = length(uWall*.5+abs(pole))+.4;
    vec2 p = position.xy * coverage + pole;
    vAcross = clamp(p.x / uWall.x + .5, 0., 1.);
    float c=cos(angle),s=sin(angle);
    p = mat2(c,s,-s,c)*(p-pole)+pole;
    p += uSkyOffset;
    p = mod(p+uSkyTile*.5,uSkyTile)-uSkyTile*.5;
    vec2 delta = vec2(0.);
    float energy = 0.;
    for (int i=0; i<${MAX_SEGMENTS}; i++) {
      if (i >= uCount) break;
      vec2 a = uA[i].xy, b = uB[i].xy, ab = b-a;
      float h = clamp(dot(p-a,ab)/max(dot(ab,ab),.00001),0.,1.);
      vec2 d = p - (a + ab*h);
      float dist = length(d);
      float close = mix(uA[i].w,uB[i].w,h);
      float radius = uRadius * (.65 + close*.65);
      float influence = exp(-dist*dist/(radius*radius)) * close;
      // Nearest influential limb wins: adding every bone overweights the torso.
      if (influence > energy) {
        energy = influence;
        vec2 n = d/max(dist,.025);
        vec2 tangent = vec2(-n.y,n.x);
        delta = (n*.42 + tangent*.24) * influence;
      }
    }
    p += delta * uStrength * (.7 + aSeed.z*.5);
    vOrbit=smoothstep(0.,1.,aOrbit.z);
    p=mix(p,aOrbit.xy,vOrbit);
    energy*=1.-vOrbit*.8;
    vWall=p;
    vEnergy = energy * min(uStrength,1.5); vSeed = aSeed.x; vDepth = aSeed.z;
    vAngle = atan(delta.y+.001,delta.x+.001);
    float z=mix(-78.+aSeed.z*22.,2.15,vOrbit);
    vec3 world=vec3(p*(10.-z)/8.,z);
    gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);
    float bokeh = step(.975,aSeed.y)*2.8;
    gl_PointSize = 1.5 + pow(aSeed.x,6.)*4.5 + bokeh + energy*3.8;
  }
`;
const fragmentShader = `
  uniform vec3 uCold, uMid, uHot;
  uniform float uExposure;
  uniform vec4 uMoon,uBottles[2];
  varying float vEnergy, vSeed, vDepth, vAngle, vAcross;
  varying vec2 vWall;
  varying float vOrbit;
  void main() {
    vec2 uv = gl_PointCoord - .5;
    float c=cos(vAngle), s=sin(vAngle);
    uv = mat2(c,-s,s,c)*uv;
    uv.y *= 1. + vEnergy*1.5;
    float r = length(uv)*2.;
    if (r>1.) discard;
    float core = exp(-r*r*24.);
    float halo = exp(-r*r*5.)*.22;
    float light = (core+halo) * (.3+pow(vSeed,3.)*1.6) * (.45+vDepth*.55);
    vec3 base = mix(uCold,uMid,smoothstep(.05,.6,vAcross));
    base = mix(base,uHot,smoothstep(.45,1.,vAcross));
    vec3 energized = mix(uMid,uHot,smoothstep(.15,.85,vAcross));
    vec3 color = mix(base,energized,smoothstep(.1,.8,vEnergy)*.75);
    color = mix(color,vec3(.88,.84,1.),pow(vSeed,12.)*.4);
    float mask=1.;
    if(uMoon.z>0.)mask=smoothstep(.99,1.035,length((vWall-uMoon.xy)/uMoon.zw));
    mask=mix(mask,1.,vOrbit);
    for(int i=0;i<2;i++)if(uBottles[i].z>0.){vec2 q=(vWall-uBottles[i].xy)/uBottles[i].zw;mask*=1.-exp(-dot(q,q)*2.);}
    gl_FragColor = vec4(color * light * (1.+vEnergy*1.7) * uExposure * mask,1.);
  }
`;

function seededRandom(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function Stars({ engine, settings }) {
  const points = useRef();
  const geometry = useMemo(() => {
    const count = settings.particles;
    const p = new Float32Array(count * 3),
      seeds = new Float32Array(count * 3);
    const random = seededRandom(711);
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2,
        radius = Math.sqrt(random());
      p[i * 3] = Math.cos(angle) * radius;
      p[i * 3 + 1] = Math.sin(angle) * radius;
      seeds[i * 3] = random();
      seeds[i * 3 + 1] = random();
      seeds[i * 3 + 2] = random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute(
      "aOrbit",
      new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    return geo;
  }, [settings.particles]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const orbits = useMemo(
    () =>
      new StellarOrbits(
        geometry.attributes.position.array,
        geometry.attributes.aSeed.array,
        geometry.attributes.aOrbit.array,
      ),
    [geometry],
  );
  const uniforms = useMemo(
    () => ({
      uSkyAngle: { value: 0 },
      uSkyPole: { value: new THREE.Vector2() },
      uSkyOffset: { value: new THREE.Vector2() },
      uSkyTile: { value: 10 },
      uOrbitDepth: { value: clipDepth(INTERACTION_Z + 0.15) },
      uStrength: { value: 1 },
      uRadius: { value: 0.5 },
      uExposure: { value: 1 },
      uWall: { value: new THREE.Vector2(8, 2.25) },
      uCount: { value: 0 },
      uMoon: { value: new THREE.Vector4() },
      uBottles: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uA: {
        value: Array.from({ length: MAX_SEGMENTS }, () => new THREE.Vector4()),
      },
      uB: {
        value: Array.from({ length: MAX_SEGMENTS }, () => new THREE.Vector4()),
      },
      uCold: { value: new THREE.Color(getPalette(settings.palette).cold) },
      uMid: { value: new THREE.Color(getPalette(settings.palette).mid) },
      uHot: { value: new THREE.Color(getPalette(settings.palette).hot) },
    }),
    [],
  );
  useFrame((_, dt) => {
    const u = points.current.material.uniforms;
    u.uSkyAngle.value = engine.skyAngle;
    u.uWall.value.set(engine.wall.width, engine.wall.height);
    u.uStrength.value = settings.strength;
    u.uRadius.value = settings.radius;
    u.uExposure.value = settings.exposure;
    const system = engine.interactions,
      m = system.moon;
    const links = system.bottles.map((b,i) =>
      i===0 && productsVisible(system.config.scene) && b.linkTarget && b.hand
        ? {
            key: `${engine.source}:${system.config.scene}:${b.hand}`,
            strength: b.attraction,
            hand: b.linkTarget,
            bottle: { x: b.x, y: b.y },
          }
        : null,
    );
    if (
      orbits.update(engine.paused ? 0 : dt, links, {
        angle: engine.skyAngle,
        pole: m,
        offset: { x: engine.skyView.offsetX, y: engine.skyView.offsetY },
        tile: engine.skyView.tile,
        width: engine.wall.width,
        height: engine.wall.height,
        moon: moonVisible(system.config.scene)
          ? { x: engine.skyView.x, y: engine.skyView.y, radius: m.radius }
          : null,
      })
    )
      geometry.attributes.aOrbit.needsUpdate = true;
    u.uSkyPole.value.set(m.x, m.y);
    u.uSkyOffset.value.set(engine.skyView.offsetX, engine.skyView.offsetY);
    u.uSkyTile.value = engine.skyView.tile;
    u.uMoon.value.set(
      engine.skyView.x,
      engine.skyView.y,
      moonVisible(system.config.scene) ? m.radius : 0,
      m.radius,
    );
    for (let i = 0; i < 2; i++) {
      const b = system.bottles[i];
      const screen = worldToScreen(b),
        perspective = 1 / depthScale(b.z);
      u.uBottles.value[i].set(
        screen.x,
        screen.y,
        i===0 && productsVisible(system.config.scene) && b.phase !== "hidden"
          ? 0.125 * b.scale * perspective
          : 0,
        0.2 * b.scale * perspective,
      );
    }
    const palette = getPalette(settings.palette);
    u.uCold.value.set(palette.cold);
    u.uMid.value.set(palette.mid);
    u.uHot.value.set(palette.hot);
    let n = 0;
    for (const person of engine.people)
      for (const [ai, bi] of BONES) {
        const a = person.joints[ai],
          b = person.joints[bi];
        if (!a?.p3 || !b?.p3 || a.vis < 0.4 || b.vis < 0.4) continue;
        const pa = projectJoint(a.p3, engine.wall),
          pb = projectJoint(b.p3, engine.wall);
        u.uA.value[n].set(pa.x, pa.y, 0, proximity(pa.distance, engine.wall));
        u.uB.value[n].set(pb.x, pb.y, 0, proximity(pb.distance, engine.wall));
        n++;
        if (n === MAX_SEGMENTS) break;
      }
    u.uCount.value = n;
  }, -2);
  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        depthTest={true}
      />
    </points>
  );
}

function Skeletons({ engine, visible }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(MAX_SEGMENTS * 6), 3),
    );
    return geo;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(() => {
    const p = geometry.attributes.position.array;
    let n = 0;
    if (visible)
      for (const person of engine.people)
        for (const [a, b] of BONES) {
          const ja = person.joints[a],
            jb = person.joints[b];
          if (!ja?.p3 || !jb?.p3 || ja.vis < 0.4 || jb.vis < 0.4) continue;
          for (const j of [ja, jb]) {
            const q = projectJoint(j.p3, engine.wall);
            p[n++] = q.x / (engine.wall.width * 0.5);
            p[n++] = q.y / (engine.wall.height * 0.5);
            p[n++] = 0;
          }
        }
    geometry.setDrawRange(0, n / 3);
    geometry.attributes.position.needsUpdate = true;
  }, -1);
  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        vertexShader="void main(){gl_Position=vec4(position,1.);}"
        fragmentShader="void main(){gl_FragColor=vec4(.70,.65,1.,.65);}"
        transparent
        depthTest={false}
      />
    </lineSegments>
  );
}

function Atmosphere({ engine, settings }) {
  const material = useRef();
  const noise = useMemo(() => {
    const size = 256,
      data = new Uint8Array(size * size * 4);
    let state = 4127;
    for (let i = 0; i < data.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      data[i] = state >>> 24;
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }, []);
  useEffect(() => () => noise.dispose(), [noise]);
  const uniforms = useMemo(
    () => ({
      uSkyAngle: { value: 0 },
      uSkyPole: { value: new THREE.Vector2() },
      uSkyOffset: { value: new THREE.Vector2() },
      uSkyTile: { value: 10 },
      uWall: { value: new THREE.Vector2() },
      uCold: { value: new THREE.Color() },
      uMid: { value: new THREE.Color() },
      uHot: { value: new THREE.Color() },
      uNoise: { value: noise },
      uNebula: { value: 0.7 },
    }),
    [],
  );
  useFrame(() => {
    const u = material.current.uniforms;
    const palette = getPalette(settings.palette);
    u.uNebula.value = settings.nebula ?? 0.7;
    u.uSkyAngle.value = engine.skyAngle;
    u.uSkyOffset.value.set(engine.skyView.offsetX, engine.skyView.offsetY);
    u.uSkyTile.value = engine.skyView.tile;
    u.uSkyPole.value.set(
      engine.interactions.moon.x,
      engine.interactions.moon.y,
    );
    u.uWall.value.set(engine.wall.width, engine.wall.height);
    u.uCold.value.set(palette.cold);
    u.uMid.value.set(palette.mid);
    u.uHot.value.set(palette.hot);
  }, -1);
  return (
    <mesh frustumCulled={false} renderOrder={-1}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        depthWrite={false}
        depthTest={false}
        vertexShader={`varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`}
        fragmentShader={`
        uniform vec3 uCold,uMid,uHot;
        uniform float uSkyAngle;
        uniform vec2 uWall,uSkyPole,uSkyOffset;
        uniform float uSkyTile;
        uniform sampler2D uNoise;
        uniform float uNebula;
        varying vec2 vUv;
        vec2 gasNoise(vec2 p){
          vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          return texture2D(uNoise,(i+f+.5)/256.).rg;
        }
        float gasFbm(vec2 p){
          float sum=0.,weight=.53;
          mat2 turn=mat2(.8,.6,-.6,.8);
          for(int i=0;i<6;i++){sum+=gasNoise(p).r*weight;p=turn*p*2.03+vec2(17.3,9.2);weight*=.5;}
          return sum;
        }
        void main(){
          float c=cos(uSkyAngle),s=sin(uSkyAngle);
          vec2 q=mod((vUv-.5)*uWall-uSkyOffset+uSkyTile*.5,uSkyTile)-uSkyTile*.5-uSkyPole;
          vec2 sky=mat2(c,-s,s,c)*q+uSkyPole;
          vec2 p=sky/uWall+.5;
          float blue=exp(-dot((p-vec2(.12,.55))*vec2(1.5,1.1),(p-vec2(.12,.55))*vec2(1.5,1.1))*3.);
          float rose=exp(-dot((p-vec2(.95,.4))*vec2(1.8,1.2),(p-vec2(.95,.4))*vec2(1.8,1.2))*3.);
          float ribbon=exp(-pow((p.y-.46-sin(p.x*7.)*.18)*5.,2.));
          vec3 haze=(uCold*blue+uHot*rose)*.022+uMid*ribbon*.009;
          // All gas structure is stationary in sky coordinates. Only the shared sky
          // rotation and drift move it; there is no independent boiling or pulsing.
          vec2 n=sky*1.65+vec2(27.4,13.8);
          vec2 warp=(gasNoise(n*.65)-.5)*2.4;
          warp+=(gasNoise(n*1.2+warp+12.)-.5)*.9;
          float billows=gasFbm(n*1.9+warp);
          float dust=gasFbm(n*4.1+warp*1.5+31.);
          float fine=gasFbm(n*10.7-warp*1.8+57.);
          float ridges=pow(1.-abs(fine*2.-1.),3.);
          float axis=sky.y-.08-sin(sky.x*.67)*.28-(warp.y*.24);
          float envelope=exp(-axis*axis*1.6);
          float density=smoothstep(.37,.73,billows)*envelope;
          float darkLanes=smoothstep(.43,.64,dust+(fine-.5)*.22);
          float gas=pow(density,2.1)*(.24+ridges*.92)*(1.-darkLanes*.9);
          vec3 whiteGas=mix(vec3(.82,.86,.96),mix(uCold,uHot,clamp(p.x,0.,1.)),.14);
          vec3 nebula=whiteGas*gas*uNebula*.065;
          gl_FragColor=vec4(vec3(.001,.0015,.004)+haze+nebula,1.);
        }`}
      />
    </mesh>
  );
}

function FrameDriver({ engine, settings }) {
  useFrame((_, dt) => {
    engine.skySpeed = settings.drift;
    engine.step(dt);
  }, -3);
  return null;
}

function Post({ bloom, mode, onReady, engine, onModeChange, modeRequest, pulseRoot, blushRoot, setOverlap }) {
  const { gl, scene, camera } = useThree();
  const pipeline = useMemo(() => {
    const composer = new EffectComposer(gl);
    const render = new RenderPass(scene, camera);
    for(const target of [composer.renderTarget1,composer.renderTarget2]) {
      target.depthTexture=new THREE.DepthTexture(3840,1080,THREE.UnsignedIntType);
    }
    const dof=new FeatherDepthOfField(scene,camera,{additive:true,colorRetention:.4});
    const astronautDof=new FeatherDepthOfField(scene,camera,{layer:2,isolateEnvironment:false,focus:6,aperture:48,maxBlur:10,occlude:true,foregroundBlur:.08,focusRange:.12});
    const glow = new StableBloomPass(.65,1.15);
    const output = new OutputPass();
    // Full-screen image passes must ignore geometry depth left in ping-pong targets.
    output.material.depthTest=false;output.material.depthWrite=false;
    composer.addPass(render);
    composer.addPass(astronautDof);
    composer.addPass(dof);
    composer.addPass(glow);
    composer.addPass(output);

    composer.copyPass.material.depthTest=false;composer.copyPass.material.depthWrite=false;
    composer.renderToScreen=false;
    const pulseFrame=new THREE.WebGLRenderTarget(3840,1080,{type:THREE.HalfFloatType,depthBuffer:false});
    const blend=new THREE.ShaderMaterial({
      depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{outgoing:{value:null},incoming:{value:null},amount:{value:0},phase:{value:0},unzip:{value:false}},
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:sceneBlendFragment,
    });
    const blendQuad=new FullScreenQuad(blend);
    composer.setPixelRatio(1);
    composer.setSize(3840, 1080);
    return { composer, glow, render, output, dof, astronautDof, pulseFrame, blend, blendQuad, focusPoint:new THREE.Vector3() };
  }, [gl, scene, camera]);
  useEffect(() => {
    onReady?.();
    return () => {
      pipeline.composer.dispose();
      pipeline.glow.dispose();
      pipeline.dof.dispose();pipeline.astronautDof.dispose();
      pipeline.output.dispose();
      pipeline.pulseFrame.dispose();pipeline.blend.dispose();pipeline.blendQuad.dispose();
    };
  }, [pipeline, onReady]);
  const cycle = useRef({elapsed:0, transition:null, switched:false, target:mode, manual:false});
  useFrame((_, dt) => {
    const c = cycle.current;
    if (!engine.paused) c.elapsed += dt;
    if (c.transition === null) {
      const requested = modeRequest?.current;
      if (requested) {
        modeRequest.current = null;
        c.elapsed = 0;
      }
      const automatic = !engine.paused && c.elapsed >= MODE_INTERVAL;
      if ((requested && requested !== mode) || automatic) {
        c.target = requested || (mode === "blush" ? "pulse" : "blush");
        c.spin=mode==="pulse" && c.target==="blush";
        setOverlap(true);
        c.manual = Boolean(requested);
        c.transition = 0;
        c.elapsed = 0;
        c.switched = false;
      }
    }
    if (c.transition !== null && (!engine.paused || c.manual)) {
      c.transition += Math.min(dt, .1);
      const frame = transitionFrame(c.transition,c.spin);
      pipeline.blend.uniforms.phase.value = frame.phase;
      if (frame.finished && !c.switched) {
        c.switched = true;
        onModeChange(c.target);
      }
      if (frame.finished) {
        c.transition = null;
        setOverlap(false);
        if (c.manual) c.elapsed = 0;
      }
    }
    // Move the actual camera, so foreground and background separate with parallax.
    const orbit=orbitCamera(c.transition!==null && c.spin ? c.transition/TRANSITION_DURATION : 0);
    engine.transitionTwist=c.transition!==null && c.spin ? orbitTwist(c.transition/TRANSITION_DURATION) : 0;
    camera.position.set(orbit.x,orbit.y,orbit.z);
    camera.lookAt(0,0,0);
    camera.updateMatrixWorld(true);
    pipeline.blend.uniforms.unzip.value=c.transition!==null && !c.spin;
    const astronaut=scene.getObjectByName('SwimmingAstronaut');
    const focusTarget=astronaut?.userData.focusTarget;
    if(focusTarget){
      focusTarget.getWorldPosition(pipeline.focusPoint).applyMatrix4(camera.matrixWorldInverse);
      const near=astronaut.userData.focusNear ?? 0;
      const blend=near*near*(3-2*near);
      // Keep distant swims soft; at the screen follow the helmet, with the
      // reaching hands inside a generous foreground focus region.
      pipeline.astronautDof.material.uniforms.focus.value=THREE.MathUtils.lerp(6,Math.max(.2,-pipeline.focusPoint.z-.08),blend);
    }
    const renderMode=selected=>{
      if(pulseRoot.current)pulseRoot.current.visible=selected==='pulse';
      if(blushRoot.current)blushRoot.current.visible=selected==='blush';
      gl.toneMapping=selected==='blush'?THREE.NoToneMapping:THREE.ACESFilmicToneMapping;
      pipeline.dof.enabled=selected==='blush';
      pipeline.astronautDof.enabled=true;
      pipeline.glow.enabled=selected==='pulse';pipeline.glow.strength=bloom;
      pipeline.composer.render();
      return pipeline.composer.readBuffer.texture;
    };
    const composite=(outgoing,incoming,amount,target=null)=>{
      pipeline.blend.uniforms.outgoing.value=outgoing;
      pipeline.blend.uniforms.incoming.value=incoming;
      pipeline.blend.uniforms.amount.value=amount;
      const unzip=pipeline.blend.uniforms.unzip.value;
      if(target)pipeline.blend.uniforms.unzip.value=false;
      gl.setRenderTarget(target);pipeline.blendQuad.render(gl);
      pipeline.blend.uniforms.unzip.value=unzip;
    };
    const transitioning=c.transition!==null;
    const amount=transitioning && c.spin?orbitCrossfade(c.transition/TRANSITION_DURATION):0;
    if(transitioning && pulseRoot.current && blushRoot.current){
      const first=c.spin?'pulse':'blush',second=c.spin?'blush':'pulse';
      const outgoing=renderMode(first);composite(outgoing,outgoing,0,pipeline.pulseFrame);
      const incoming=renderMode(second);
      composite(pipeline.pulseFrame.texture,incoming,amount);
    }else{
      const texture=renderMode(c.switched?c.target:mode);composite(texture,texture,0);
    }
    // Keep both groups traversable between renders for occupancy and animation.
    if(pulseRoot.current)pulseRoot.current.visible=true;
    if(blushRoot.current)blushRoot.current.visible=true;
  }, 1);
  return null;
}

export default function Starfield({
  engine,
  settings,
  mode = "pulse",
  fluidVersion = 0,
  onModeChange,
  modeRequest,
  onReady,
}) {
  const [overlap,setOverlap]=useState(false);
  const pulseRoot=useRef(),blushRoot=useRef();
  // A fixed backing resolution is independent of CSS preview size and device pixel ratio.
  return (
    <Canvas
      dpr={1}
      resize={{ debounce: 0, offsetSize: true }}
      gl={{
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
      }}
      onCreated={({ gl, scene }) => {
        gl.setSize(3840, 1080, false);
        gl.setClearColor("#040616");
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        if (import.meta.env.DEV) window.__LUNAR__ = { engine, gl, scene };
      }}
      camera={CAMERA_OPTIONS}
    >
      <FrameDriver engine={engine} settings={settings} />
      <SceneCamera engine={engine}/>
      {(mode==='blush'||overlap) && <group ref={blushRoot} name="BlushScene">
        <Blush key={fluidVersion} engine={engine} settings={settings} />
        <BlushObjects engine={engine} />
        <ModeProducts engine={engine} mode="blush"/>
        <Magnolias engine={engine}/>
        <QuietBrandingOverlay engine={engine} mode="blush"/>
      </group>}
      {(mode==='pulse'||overlap) && <group ref={pulseRoot} name="PulseScene">
        <Stars engine={engine} settings={settings} />
        <Atmosphere engine={engine} settings={settings} />
        <InteractionScene engine={engine} />
        <ModeProducts engine={engine} mode="pulse"/>
        <Eclipse engine={engine} />
        <QuietBrandingOverlay engine={engine} mode="pulse"/>
      </group>}
      <Astronaut engine={engine}/>
      <Skeletons engine={engine} visible={settings.skeletons} />
      <Post pulseRoot={pulseRoot} blushRoot={blushRoot} setOverlap={setOverlap} bloom={settings.bloom} mode={mode} onReady={onReady} engine={engine} onModeChange={onModeChange} modeRequest={modeRequest} />
    </Canvas>
  );
}
