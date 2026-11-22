import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { moonVisible, productsVisible } from "./interactions.js";
import { depthScale, screenToWorld, verticalFov, MOON_Z } from "./scene-space.js";
import { smoothMotion } from "./smooth-motion.js";
import { prepareBottleMaterials } from "./bottle-materials.js";

export function SceneCamera({ engine }) {
  const { camera, gl, scene } = useThree();
  useFrame(() => {
    camera.fov = verticalFov(engine.wall.height);
    camera.aspect = engine.wall.width / engine.wall.height;
    // Manual camera options set the frustum properties before the first frame; build its
    // projection explicitly as well, including after a resize or hot module replacement.
    camera.updateProjectionMatrix();
  }, -1.8);
  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl),
      room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.04);
    const previous = scene.environment;
    scene.environment = target.texture;
    room.dispose();
    generator.dispose();
    return () => {
      scene.environment = previous;
      target.dispose();
    };
  }, [gl, scene]);
  return (
    <>
      <hemisphereLight args={["#c9c3ff", "#101024", 0.08]} />
      <directionalLight position={[-4, 3, 1.5]} intensity={2} color="#d5dfff" />
      <pointLight
        position={[-3, 1, -1.5]}
        intensity={4}
        distance={12}
        color="#536dff"
      />
      <pointLight
        position={[3, 0, -1.5]}
        intensity={5}
        distance={12}
        color="#ed739e"
      />
    </>
  );
}

function Moon({ engine }) {
  const motion=useRef(null);
  const group = useRef(),
    surface = useRef();
  const [color, height] = useLoader(THREE.TextureLoader, [
    `${import.meta.env.BASE_URL}textures/moon-color.jpg`,
    `${import.meta.env.BASE_URL}textures/moon-height.jpg`,
  ]);
  color.colorSpace = THREE.SRGBColorSpace;
  const illumination = useMemo(
    () => ({
      sun: { value: new THREE.Vector3() },
      blue: { value: new THREE.Vector3() },
      rose: { value: new THREE.Vector3() },
      axis: new THREE.Vector3(0, 0, 1),
    }),
    [],
  );
  const lightMoon = useMemo(
    () => (shader) => {
      shader.uniforms.uLunarSun = illumination.sun;
      shader.uniforms.uLunarBlue = illumination.blue;
      shader.uniforms.uLunarRose = illumination.rose;
      shader.fragmentShader =
        "uniform vec3 uLunarSun,uLunarBlue,uLunarRose;\n" +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `
      float sunlight=max(dot(normal,uLunarSun),0.);
      float blueRim=max(dot(normal,uLunarBlue),0.);
      float roseRim=max(dot(normal,uLunarRose),0.);
      // Lunar diffuse illumination is independent of the bottles' bright studio environment.
      outgoingLight=diffuseColor.rgb*(vec3(.028,.025,.042)+vec3(2.1,2.2,2.5)*sunlight
        +vec3(.12,.28,1.)*blueRim*.85+vec3(.95,.18,.4)*roseRim*.8);
      #include <opaque_fragment>`,
      );
    },
    [illumination],
  );
  useFrame((_,delta) => {
    const dt=engine.paused?0:Math.min(delta,.05);
    const m = engine.interactions.moon;
    const position = screenToWorld(engine.skyView, MOON_Z);
    motion.current ??= {x:position.x,y:position.y,radius:m.radius};
    const state=motion.current;
    // Sky wrapping happens off screen; do not interpolate across the whole wall.
    if(Math.abs(position.x-state.x)>engine.wall.width*.7){state.x=position.x;state.xVelocity=0;}
    smoothMotion(state,'x',position.x,dt,3);
    smoothMotion(state,'y',position.y,dt,3);
    smoothMotion(state,'radius',m.radius,dt,3);
    group.current.position.set(state.x,state.y,position.z);
    group.current.scale.setScalar(state.radius * depthScale(MOON_Z));
    group.current.rotation.z = engine.skyAngle;
    surface.current.rotation.y = Math.PI * 0.5;
    illumination.sun.value
      .set(-0.8, 0.35, 0.25)
      .normalize()
      .applyAxisAngle(illumination.axis, engine.skyAngle);
    illumination.blue.value
      .set(-0.85, 0.1, -0.5)
      .normalize()
      .applyAxisAngle(illumination.axis, engine.skyAngle);
    illumination.rose.value
      .set(0.85, 0.05, -0.5)
      .normalize()
      .applyAxisAngle(illumination.axis, engine.skyAngle);
  });
  return (
    <group ref={group} name="lunar-moon">
      <mesh ref={surface}>
        <sphereGeometry args={[1, 160, 120]} />
        <meshStandardMaterial
          map={color}
          bumpMap={height}
          bumpScale={0.02}
          displacementMap={height}
          displacementScale={0.025}
          displacementBias={-0.0125}
          color="#8c879e"
          roughness={0.96}
          metalness={0.02}
          envMapIntensity={0}
          onBeforeCompile={lightMoon}
        />
      </mesh>
    </group>
  );
}

function roundedBottleGeometry() {
  const s = new THREE.Shape(),
    w = 0.34,
    h = 0.39,
    r = 0.065;
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const geometry = new THREE.ExtrudeGeometry(s, {
    depth: 0.13,
    bevelEnabled: true,
    bevelSize: 0.018,
    bevelThickness: 0.018,
    bevelSegments: 3,
    steps: 1,
    curveSegments: 10,
  });
  geometry.translate(0, -0.025, -0.065);
  return geometry;
}
function labelTexture(name, index) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111327";
  ctx.fillRect(0, 0, 768, 512);
  ctx.strokeStyle = index ? "#e6a2c1" : "#9aa9f3";
  ctx.lineWidth = 3;
  ctx.strokeRect(20, 20, 728, 472);
  ctx.fillStyle = "#f2eaff";
  ctx.textAlign = "center";
  ctx.font = "24px Arial";
  ctx.fillText("L U N A R", 384, 100);
  ctx.font = `${Math.min(72, (600 / Math.max(1, name.length)) * 1.5)}px Arial`;
  ctx.fillText(name, 384, 250, 650);
  ctx.font = "20px Arial";
  ctx.fillStyle = "#c5badb";
  ctx.fillText("EAU DE PARFUM", 384, 355);
  ctx.fillText(`CONCEPT  /  0${index + 1}`, 384, 414);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function ProductBottle({ engine, index, modelIndex=index, name, color }) {
  const group = useRef(),
    cap = useRef();
  const motion=useRef(null);
  const [asset, setAsset] = useState(null);
  const assetNozzle = useMemo(
    () => asset?.getObjectByName("SprayOrigin"),
    [asset],
  );
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false,
      loaded = null;
    const loader = new GLTFLoader();
    fetch(`${import.meta.env.BASE_URL}models/products/product-0${modelIndex + 1}.glb`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((buffer) => {
        if (
          !buffer ||
          buffer.byteLength < 12 ||
          new DataView(buffer).getUint32(0, true) !== 0x46546c67
        )
          return;
        return new Promise((resolve, reject) =>
          loader.parse(buffer, "", resolve, reject),
        );
      })
      .then((gltf) => {
        if (!gltf) return;
        loaded = prepareBottleMaterials(gltf.scene);
        const box = new THREE.Box3().setFromObject(loaded),
          size = box.getSize(new THREE.Vector3()),
          center = box.getCenter(new THREE.Vector3());
        if (size.y <= 0) return;
        const scale = 0.6 / size.y;
        loaded.scale.setScalar(scale);
        loaded.position.copy(center).multiplyScalar(-scale);
        loaded.position.y += 0.05;
        if (!disposed) {
          engine.interactions.products[index].asset = "glb";
          setAsset(loaded);
        }
      })
      .catch((error) => {
        if (error.name !== "AbortError")
          console.warn(
            `Product ${index + 1} GLB could not load; using concept bottle.`,
            error.message,
          );
      });
    return () => {
      disposed = true;
      controller.abort();
      loaded?.traverse((object) => {
        object.geometry?.dispose();
        for (const material of [object.material].flat().filter(Boolean)) {
          for (const value of Object.values(material))
            if (value?.isTexture) value.dispose();
          material.dispose();
        }
      });
    };
  }, [index, modelIndex]);
  const geometry = useMemo(
    () =>
      index
        ? roundedBottleGeometry()
        : new THREE.LatheGeometry(
            [
              new THREE.Vector2(0.1, -0.23),
              new THREE.Vector2(0.16, -0.22),
              new THREE.Vector2(0.18, -0.17),
              new THREE.Vector2(0.18, 0.1),
              new THREE.Vector2(0.16, 0.16),
              new THREE.Vector2(0.08, 0.21),
              new THREE.Vector2(0.07, 0.23),
            ],
            64,
          ),
    [index],
  );
  const label = useMemo(() => labelTexture(name, index), [name, index]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => label.dispose(), [label]);
  useFrame((_,delta) => {
    const dt=engine.paused?0:Math.min(delta,.05);
    const system = engine.interactions,
      b = system.bottles[index],
      t = system.time;
    motion.current ??= {x:b.x,y:b.y,z:b.z,rx:0,ry:0,rz:0,scale:b.scale,capY:.32,capZ:0};
    const state=motion.current;
    for(const axis of ['x','y','z'])smoothMotion(state,axis,b[axis],dt,8);
    group.current.position.set(state.x,state.y,state.z);
    const ritual = ["arrive", "settle", "spritz"].includes(b.phase);
    const flight = ["retreat", "hidden", "emerge"].includes(b.phase);
    const rotations={rx:Math.sin(t*.5+index)*.055,
      ry:flight?b.flightYaw:Math.sin(t*.27+index)*.28,
      rz:flight?b.flightRoll:ritual?(index ? .13:-.13):Math.sin(t*.6+index*2)*.07};
    for(const axis of ['rx','ry','rz']) {
      const nearest=state[axis]+Math.atan2(Math.sin(rotations[axis]-state[axis]),Math.cos(rotations[axis]-state[axis]));
      smoothMotion(state,axis,nearest,dt,4);
    }
    group.current.rotation.set(state.rx,state.ry,state.rz);
    smoothMotion(state,'scale',b.scale,dt,6);
    group.current.scale.setScalar(state.scale*.56*(.96+.08*THREE.MathUtils.clamp((state.z+4)/7,0,1)));
    if(cap.current){
      smoothMotion(state,'capY',.32+(ritual ? .13:0),dt,6);
      smoothMotion(state,'capZ',ritual?(index ? .18:-.18):0,dt,6);
      cap.current.position.y=state.capY;cap.current.rotation.z=state.capZ;
    }
    // Transform the nozzle with the bottle so the mist always starts at the atomizer.
    group.current.updateMatrixWorld(true);
    b.sprayOrigin ??= new THREE.Vector3();
    if (assetNozzle) assetNozzle.getWorldPosition(b.sprayOrigin);
    else
      b.sprayOrigin
        .set(0.055, 0.25, 0.13)
        .applyMatrix4(group.current.matrixWorld);
  }, -0.5);
  return (
    <group ref={group} name={`perfume-${index + 1}`}>
      {asset ? (
        <primitive object={asset} />
      ) : (
        <>
          <mesh geometry={geometry}>
            <meshPhysicalMaterial
              color={color}
              roughness={0.12}
              metalness={0.18}
              transparent
              opacity={0.62}
              clearcoat={1}
              clearcoatRoughness={0.08}
              side={THREE.DoubleSide}
              depthWrite={false}
              envMapIntensity={0.6}
            />
          </mesh>
          <mesh
            position={[0, -0.045, 0]}
            scale={index ? [0.78, 0.76, 0.8] : [1, 1, 1]}
          >
            {index ? (
              <boxGeometry args={[0.31, 0.33, 0.11]} />
            ) : (
              <cylinderGeometry args={[0.15, 0.155, 0.32, 48]} />
            )}
            <meshPhysicalMaterial
              color={color}
              roughness={0.24}
              metalness={0.12}
              transparent
              opacity={0.8}
              clearcoat={1}
              envMapIntensity={0.5}
            />
          </mesh>
          <mesh position={[0, -0.025, index ? 0.091 : 0.183]}>
            <planeGeometry args={[index ? 0.26 : 0.24, 0.17]} />
            <meshBasicMaterial map={label} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.22, 0]}>
            <cylinderGeometry args={[0.07, 0.08, 0.065, 32]} />
            <meshStandardMaterial
              color="#a8a2bc"
              metalness={0.85}
              roughness={0.2}
            />
          </mesh>
          <mesh position={[0, 0.265, 0]}>
            <cylinderGeometry args={[0.052, 0.052, 0.04, 32]} />
            <meshStandardMaterial
              color="#d6cde3"
              metalness={0.75}
              roughness={0.16}
            />
          </mesh>
          <mesh position={[0.053, 0.255, 0.04]}>
            <sphereGeometry args={[0.014, 12, 8]} />
            <meshBasicMaterial color="#e7e0ff" />
          </mesh>
          <group ref={cap} position={[0, 0.32, 0]}>
            <mesh>
              <cylinderGeometry args={[0.09, 0.09, 0.11, 32]} />
              <meshPhysicalMaterial
                color="#222039"
                roughness={0.16}
                metalness={0.8}
                clearcoat={1}
              />
            </mesh>
            <mesh position={[0, -0.044, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.09, 0.004, 8, 40]} />
              <meshBasicMaterial color={color} />
            </mesh>
          </group>
        </>
      )}
    </group>
  );
}

function Mist({ engine, index, color }) {
  const material = useRef();
  const geometry = useMemo(() => {
    const p = new Float32Array(600 * 3),
      seed = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      seed[i * 3] = (i * 0.61803398875) % 1;
      seed[i * 3 + 1] = (i * 0.4142135623) % 1;
      seed[i * 3 + 2] = (i * 0.7320508) % 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    return geo;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 2 },
      uOrigin: { value: new THREE.Vector3() },
      uTarget: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(color) },
    }),
    [],
  );
  useFrame(() => {
    const b = engine.interactions.bottles[index],
      u = material.current.uniforms;
    u.uTime.value = b.sprayTime;
    u.uColor.value.set(color);
    if (b.target && b.sprayOrigin) {
      u.uOrigin.value.copy(b.sprayOrigin);
      const target = screenToWorld(b.target, 2.1);
      u.uTarget.value.set(target.x, target.y, target.z);
    }
  }, -0.25);
  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={8}>
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        depthTest={false}
        vertexShader={`attribute vec3 aSeed;uniform float uTime;uniform vec3 uOrigin,uTarget;varying float vAlpha;void main(){float age=(uTime-aSeed.x*.38)/.95;float a=clamp(age,0.,1.);vec3 p=mix(uOrigin,uTarget,min(a*1.45,1.));float spread=sin(a*3.14159)*.12;p.x+=cos(aSeed.y*6.283)*spread*aSeed.z;p.y+=sin(aSeed.y*6.283)*spread*aSeed.z+max(a-.65,0.)*.28;p.z+=sin(aSeed.z*6.283)*spread;vAlpha=age<0.||age>1.?0.:sin(a*3.14159)*.55;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);gl_PointSize=3.+aSeed.z*7.;}`}
        fragmentShader={`uniform vec3 uColor;varying float vAlpha;void main(){float r=length(gl_PointCoord-.5)*2.;float glow=exp(-r*r*6.)*vAlpha;gl_FragColor=vec4(mix(uColor,vec3(.9,.84,1.),.5)*glow,glow);}`}
      />
    </points>
  );
}

function WristCues({ engine }) {
  const refs = useRef([]);
  useFrame(() => {
    for (let i = 0; i < 12; i++) {
      const mesh = refs.current[i],
        h = engine.interactions.hands[i];
      if (!mesh) continue;
      mesh.visible = !!h;
      if (!h) continue;
      const position = screenToWorld(h.point, 2.4);
      mesh.position.set(position.x, position.y, position.z);
      mesh.scale.setScalar(depthScale(2.4));
      mesh.material.uniforms.uProgress.value = h.used ? 1 : h.progress;
      mesh.material.uniforms.uUsed.value = h.used ? 1 : 0;
    }
  });
  return (
    <group name="wrist-cues">
      {Array.from({ length: 12 }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          visible={false}
          renderOrder={10}
        >
          <planeGeometry args={[0.18, 0.18]} />
          <shaderMaterial
            transparent
            depthWrite={false}
            depthTest={false}
            uniforms={{ uProgress: { value: 0 }, uUsed: { value: 0 } }}
            vertexShader="varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}"
            fragmentShader={`varying vec2 vUv;uniform float uProgress,uUsed;void main(){vec2 p=vUv-.5;float r=length(p);float ring=smoothstep(.43,.39,r)*smoothstep(.32,.36,r);float angle=(atan(p.x,p.y)+3.14159)/6.283;float lit=step(angle,uProgress);vec3 color=mix(vec3(.47,.53,1.),vec3(.96,.55,.76),uUsed);gl_FragColor=vec4(color,ring*(.15+lit*.7));}`}
          />
        </mesh>
      ))}
    </group>
  );
}

export default function InteractionScene({ engine }) {
  const system = engine.interactions,
    scene = system.config.scene;
  return (
    <>
      {moonVisible(scene) && (
        <Suspense fallback={null}>
          <Moon engine={engine} />
        </Suspense>
      )}

    </>
  );
}
