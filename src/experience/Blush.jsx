import React, { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import Feathers from "./Feathers.jsx";
import { SkeletonFlow, MAX_FLOW_POINTS } from "./fluid-motion.js";
import {
  fluidVertex,
  fluidShaders,
  blushDisplay,
  dustVertex,
  dustFragment,
} from "./fluid-shaders.js";

export const BLUSH_DEFAULTS = {
  fluidForce: 9,
  fluidRadius: 0.22,
  fluidCurl: 22,
  fluidDrag: 0.035,
  fluidContrast: 1.75,
  fluidDust: 1,
};

// The solver runs below output resolution; ink retains much finer detail than velocity.
const SIM_WIDTH = 768,
  SIM_HEIGHT = 216;
const DYE_WIDTH = 2048,
  DYE_HEIGHT = 576;
const DUST_SIZE = 128;

class FluidField {
  constructor(renderer) {
    if (!renderer.extensions.has("EXT_color_buffer_float"))
      throw new Error("Blush requires floating-point WebGL2 render targets.");
    this.renderer = renderer;
    this.initialized = false;
    this.motion = new SkeletonFlow();
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(this.geometry);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.targets = [];
    // 16-bit ink slowly loses contrast under thousands of tiny advection steps.
    // Use 32-bit storage where linear float filtering is available; the seed source
    // also keeps the half-float fallback richly textured throughout a long session.
    const inkType = renderer.extensions.has("OES_texture_float_linear")
      ? THREE.FloatType
      : THREE.HalfFloatType;
    const target = (w, h, type = THREE.HalfFloatType) => {
      const rt = new THREE.WebGLRenderTarget(w, h, {
        type,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
      this.targets.push(rt);
      return rt;
    };
    const pair = (w, h, type) => ({
      read: target(w, h, type),
      write: target(w, h, type),
      swap() {
        [this.read, this.write] = [this.write, this.read];
      },
    });
    this.velocity = pair(SIM_WIDTH, SIM_HEIGHT);
    this.pressure = pair(SIM_WIDTH, SIM_HEIGHT);
    this.dye = pair(DYE_WIDTH, DYE_HEIGHT, inkType);
    // Particle positions need full precision even when float linear filtering is absent.
    this.dust = pair(DUST_SIZE, DUST_SIZE, THREE.FloatType);
    for (const rt of [this.dust.read, this.dust.write]) {
      rt.texture.minFilter = THREE.NearestFilter;
      rt.texture.magFilter = THREE.NearestFilter;
    }
    this.forward = target(DYE_WIDTH, DYE_HEIGHT, inkType);
    this.backward = target(DYE_WIDTH, DYE_HEIGHT, inkType);
    this.seed = target(DYE_WIDTH, DYE_HEIGHT, inkType);
    this.curl = target(SIM_WIDTH, SIM_HEIGHT);
    this.divergence = target(SIM_WIDTH, SIM_HEIGHT);
    this.uniforms = {
      uSource: { value: null },
      uVelocity: { value: null },
      uPressure: { value: null },
      uDivergence: { value: this.divergence.texture },
      uCurl: { value: this.curl.texture },
      uTexel: { value: new THREE.Vector2(1 / SIM_WIDTH, 1 / SIM_HEIGHT) },
      uDyeTexel: { value: new THREE.Vector2(1 / DYE_WIDTH, 1 / DYE_HEIGHT) },
      uDt: { value: 0 },
      uDrag: { value: 0 },
      uVorticity: { value: 22 },
      uTransitionTwist: { value: 0 },
      uForward: { value: this.forward.texture },
      uBackward: { value: this.backward.texture },
      uSeed: { value: this.seed.texture },
      uCount: { value: 0 },
      uRadius: { value: 0 },
      uForce: { value: 9 },
      uPoints: {
        value: Array.from(
          { length: MAX_FLOW_POINTS },
          () => new THREE.Vector4(),
        ),
      },
      uMoves: {
        value: Array.from(
          { length: MAX_FLOW_POINTS },
          () => new THREE.Vector4(),
        ),
      },
    };
    this.materials = Object.fromEntries(
      Object.entries(fluidShaders).map(([name, fragmentShader]) => [
        name,
        new THREE.ShaderMaterial({
          vertexShader: fluidVertex,
          fragmentShader,
          uniforms: this.uniforms,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      ]),
    );
    this.display = new THREE.ShaderMaterial({
      vertexShader: fluidVertex,
      fragmentShader: blushDisplay,
      uniforms: {
        uDye: { value: null },
        uContrast: { value: BLUSH_DEFAULTS.fluidContrast },
        uMagenta: { value: new THREE.Color("#b34b97") },
        uPink: { value: new THREE.Color("#d59cbe") },
        uShadow: { value: new THREE.Color("#a43d87") },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.dustGeometry = new THREE.BufferGeometry();
    const count = DUST_SIZE * DUST_SIZE,
      lookup = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      lookup[i * 2] = ((i % DUST_SIZE) + 0.5) / DUST_SIZE;
      lookup[i * 2 + 1] = (Math.floor(i / DUST_SIZE) + 0.5) / DUST_SIZE;
    }
    this.dustGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(count * 3), 3),
    );
    this.dustGeometry.setAttribute(
      "aLookup",
      new THREE.BufferAttribute(lookup, 2),
    );
    this.dustMaterial = new THREE.ShaderMaterial({
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
      uniforms: {
        uPositions: { value: null },
        uVelocity: { value: null },
        uAmount: { value: BLUSH_DEFAULTS.fluidDust },
        uColor: { value: new THREE.Color("#fff3f8") },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.viewport = new THREE.Vector4();
    this.scissor = new THREE.Vector4();
  }
  draw(name, target) {
    this.quad.material = this.materials[name];
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }
  tick(dt, engine, settings) {
    this.impulses = [];
    const gl = this.renderer,
      u = this.uniforms;
    const previousTarget = gl.getRenderTarget();
    const previousScissorTest = gl.getScissorTest();
    const previousAutoClear = gl.autoClear;
    gl.getViewport(this.viewport);
    gl.getScissor(this.scissor);
    try {
      gl.setScissorTest(false);
      gl.autoClear = true;
      if (!this.initialized) {
        this.draw("seedVelocity", this.velocity.read);
        this.draw("seedDye", this.dye.read);
        this.draw("seedDye", this.seed);
        this.draw("seedDust", this.dust.read);
        this.initialized = true;
      }
      if (engine.paused) {
        this.motion.reset();
      } else {
        const sampleTime =
          engine.source === "live" ? engine.liveAt / 1000 : engine.time;
        const impulses = this.motion.sample(
          engine.people,
          engine.wall,
          sampleTime,
          engine.source,
        );
        this.impulses = impulses;
        u.uRadius.value = settings.fluidRadius / engine.wall.height;
        u.uForce.value = settings.fluidForce;
        u.uVorticity.value = settings.fluidCurl;
        u.uTransitionTwist.value=engine.transitionTwist??0;
        if (impulses.length) {
          u.uCount.value = impulses.length;
          impulses.forEach((p, i) => {
            u.uPoints.value[i].set(p.u, p.v, p.dx, p.dy);
            u.uMoves.value[i].set(p.fromU, p.fromV, 0, p.pigment);
          });
          u.uSource.value = this.velocity.read.texture;
          this.draw("splatVelocity", this.velocity.write);
          this.velocity.swap();
        }
        // Bounded substeps keep a stalled tab from exploding the fluid on return.
        const elapsed = Math.min(Math.max(0, dt), 1 / 30);
        const steps = Math.max(1, Math.ceil(elapsed * 60));
        for (let i = 0; i < steps; i++)
          this.step(elapsed / steps, settings.fluidDrag);
      }
      this.display.uniforms.uDye.value = this.dye.read.texture;
      this.display.uniforms.uContrast.value = settings.fluidContrast;
      this.dustMaterial.uniforms.uPositions.value = this.dust.read.texture;
      this.dustMaterial.uniforms.uVelocity.value = this.velocity.read.texture;
      this.dustMaterial.uniforms.uAmount.value = settings.fluidDust;
    } finally {
      gl.setRenderTarget(previousTarget);
      gl.setViewport(this.viewport);
      gl.setScissor(this.scissor);
      gl.setScissorTest(previousScissorTest);
      gl.autoClear = previousAutoClear;
    }
  }
  step(dt, drag) {
    const u = this.uniforms;
    u.uDt.value = dt;
    u.uDrag.value = drag;
    u.uSource.value = u.uVelocity.value = this.velocity.read.texture;
    this.draw("advect", this.velocity.write);
    this.velocity.swap();
    u.uVelocity.value = this.velocity.read.texture;
    this.draw("curl", this.curl);
    this.draw("confine", this.velocity.write);
    this.velocity.swap();
    u.uVelocity.value = this.velocity.read.texture;
    this.draw("divergence", this.divergence);
    this.draw("zero", this.pressure.read);
    for (let i = 0; i < 20; i++) {
      u.uPressure.value = this.pressure.read.texture;
      this.draw("pressure", this.pressure.write);
      this.pressure.swap();
    }
    u.uPressure.value = this.pressure.read.texture;
    this.draw("project", this.velocity.write);
    this.velocity.swap();
    if(u.uTransitionTwist.value>0){
      u.uVelocity.value=this.velocity.read.texture;
      this.draw("transitionTwist",this.velocity.write);this.velocity.swap();
    }
    u.uVelocity.value = this.velocity.read.texture;
    u.uSource.value = this.dye.read.texture;
    u.uDrag.value = 0; // Ink does not fade to black or settle under gravity.
    this.draw("advect", this.forward);
    u.uDt.value = -dt;
    u.uSource.value = this.forward.texture;
    this.draw("advect", this.backward);
    u.uDt.value = dt;
    u.uSource.value = this.dye.read.texture;
    this.draw("correctDye", this.dye.write);
    this.dye.swap();
    if (u.uCount.value > 0) {
      u.uSource.value = this.dye.read.texture;
      this.draw("splatDye", this.dye.write);
      this.dye.swap();
      // Each input observation supplies pigment only once, including substeps.
      u.uCount.value = 0;
    }
    u.uSource.value = this.dust.read.texture;
    this.draw("advectDust", this.dust.write);
    this.dust.swap();
  }
  dispose() {
    this.targets.forEach((rt) => rt.dispose());
    Object.values(this.materials).forEach((material) => material.dispose());
    this.display.dispose();
    this.dustMaterial.dispose();
    this.dustGeometry.dispose();
    this.geometry.dispose();
  }
}

export default function Blush({ engine, settings }) {
  const { gl } = useThree();
  const field = useMemo(() => new FluidField(gl), [gl]);
  useEffect(() => {
    if (import.meta.env.DEV && window.__LUNAR__) window.__LUNAR__.fluid = field;
    return () => {
      if (import.meta.env.DEV && window.__LUNAR__?.fluid === field)
        delete window.__LUNAR__.fluid;
      field.dispose();
    };
  }, [field]);
  useFrame((_, dt) => field.tick(dt, engine, settings), -1.9);
  return (
    <>
      <mesh
        geometry={field.geometry}
        material={field.display}
        frustumCulled={false}
        renderOrder={-1}
      />
      <Feathers field={field} engine={engine} />
      <points
        geometry={field.dustGeometry}
        material={field.dustMaterial}
        frustumCulled={false}
      />
    </>
  );
}
