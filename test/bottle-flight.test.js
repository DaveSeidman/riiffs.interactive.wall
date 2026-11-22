import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DEFAULT_WALL, makePerson } from "../src/experience/body.js";
import { InteractionSystem } from "../src/experience/interactions.js";
import {
  retreatPose,
  RETREAT_GRACE,
  HIDDEN_DEPTH,
} from "../src/experience/bottle-flight.js";
import {
  CAMERA_Z,
  MOON_Z,
  ASTRONAUT_BACK_Z,
  CAMERA_NEAR,
  CAMERA_FAR,
  INTERACTION_Z,
  screenToWorld,
  worldToScreen,
  depthScale,
  verticalFov,
  clipDepth,
} from "../src/experience/scene-space.js";

const moon = { x: 1.8, y: 0.08 },
  radius = 0.66;
const flight = { from: { x: -1.8, y: 0.1, z: 2 }, side: -1 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function camera() {
  const c = new THREE.PerspectiveCamera(
    verticalFov(DEFAULT_WALL.height),
    DEFAULT_WALL.width / DEFAULT_WALL.height,
    CAMERA_NEAR,
    CAMERA_FAR,
  );
  c.position.z = CAMERA_Z;
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
  return c;
}
function projected(p, camera) {
  const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
  return {
    x: v.x * DEFAULT_WALL.width * 0.5,
    y: v.y * DEFAULT_WALL.height * 0.5,
    z: v.z,
  };
}
const person = () => makePerson(1, -1.6, 0.4, 0, DEFAULT_WALL, "offer");
const advance = (s, seconds, people) => {
  for (let t = 0; t < seconds; t += 1 / 60)
    s.step(1 / 60, people, DEFAULT_WALL);
};

test("perspective preserves tracking coordinates at every cue depth", () => {
  const c = camera(),
    screen = { x: 2.3, y: -0.45 };
  for (const z of [2, 2.1, 2.4, 0, HIDDEN_DEPTH]) {
    const p = screenToWorld(screen, z),
      view = projected(p, c);
    close(view.x, screen.x);
    close(view.y, screen.y);
    close(view.z, clipDepth(z));
    close(worldToScreen(p).x, screen.x);
  }
  const native = screenToWorld(screen, INTERACTION_Z);
  close(native.x, screen.x);
  close(native.y, screen.y);
});
test("each retreat crosses the lower visible face before moving behind the moon", () => {
  for (const side of [-1, 1]) {
    let crossed = false,
      front = false,
      back = false;
    for (let t = 0; t <= 1; t += 0.002) {
      const p = retreatPose({ ...flight, side }, t, moon, radius),
        s = worldToScreen(p);
      assert.ok([p.x, p.y, p.z].every(Number.isFinite));
      if (
        Math.abs(s.x - moon.x) < radius * 0.1 &&
        s.y < moon.y - radius * 0.4 &&
        s.y > moon.y - radius * 0.85 &&
        p.z > 1
      )
        crossed = true;
      front ||= p.z > 1;
      back ||= p.z < -1;
    }
    assert.ok(crossed && front && back);
  }
  const start = retreatPose(flight, 0, moon, radius);
  close(start.x, flight.from.x);
  close(start.y, flight.from.y);
  close(start.z, flight.from.z);
});
test("recession really shrinks an unchanged 3D bottle in the perspective camera", () => {
  const c = camera(),
    start = retreatPose(flight, 0, moon, radius),
    end = retreatPose(flight, 1, moon, radius);
  const height = (p) =>
    projected({ ...p, y: p.y + 0.2 }, c).y -
    projected({ ...p, y: p.y - 0.2 }, c).y;
  assert.ok(height(end) < height(start) * 0.65);
  close(end.z, HIDDEN_DEPTH);
});
test("the parked bottle is occluded by the actual 3D moon along all corner rays", () => {
  const c = camera(),
    centre = screenToWorld(moon, MOON_Z),
    sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius * depthScale(MOON_Z), 96, 64),
      new THREE.MeshBasicMaterial(),
    );
  sphere.position.set(centre.x, centre.y, centre.z);
  sphere.updateMatrixWorld();
  const end = retreatPose(flight, 1, moon, radius),
    ray = new THREE.Raycaster();
  try {
    for (const x of [-0.12, 0.12])
      for (const y of [-0.23, 0.23])
        for (const z of [-0.1, 0.1]) {
          const corner = new THREE.Vector3(end.x + x, end.y + y, end.z + z),
            ndc = corner.clone().project(c);
          ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), c);
          const hits = ray.intersectObject(sphere);
          assert.ok(
            hits.length && hits[0].distance < c.position.distanceTo(corner),
          );
        }
  } finally {
    sphere.geometry.dispose();
    sphere.material.dispose();
  }
});
test("short detection dropouts do not launch a retreat", () => {
  const s = new InteractionSystem();
  advance(s, 0.3, [person()]);
  advance(s, RETREAT_GRACE * 0.6, []);
  assert.ok(
    s.bottles.every((b) => b.phase !== "retreat" && b.phase !== "hidden"),
  );
});
test("an empty room launches, occludes and parks both bottles with constant world scale", () => {
  const s = new InteractionSystem();
  advance(s, 1, [person()]);
  advance(s, 1, []);
  assert.ok(s.bottles.every((b) => b.phase === "retreat"));
  const scales = s.bottles.map((b) => b.scale);
  advance(s, 12, []);
  assert.ok(
    s.bottles.every((b) => b.phase === "hidden" && b.z === HIDDEN_DEPTH),
  );
  for (let i = 0; i < 2; i++) close(s.bottles[i].scale, scales[i]);
  assert.equal(s.spritzes, 0);
});
test("a returning person recalls hidden bottles, and retreat reversals do not teleport", () => {
  const s = new InteractionSystem();
  advance(s, 1, [person()]);
  advance(s, 2, []);
  const before = s.bottles.map((b) => ({ x: b.x, y: b.y, z: b.z }));
  s.step(1 / 120, [person()], DEFAULT_WALL);
  for (let i = 0; i < 2; i++) {
    assert.equal(s.bottles[i].phase, "emerge");
    assert.ok(
      Math.hypot(
        s.bottles[i].x - before[i].x,
        s.bottles[i].y - before[i].y,
        s.bottles[i].z - before[i].z,
      ) < 0.1,
    );
  }
  advance(s, 14, []);
  assert.ok(s.bottles.every((b) => b.phase === "hidden"));
  advance(s, 6, [person()]);
  assert.ok(
    s.bottles.every((b) => !["hidden", "retreat", "emerge"].includes(b.phase)),
  );
});
test("hidden bottles stay aligned behind a moving moon", () => {
  const s = new InteractionSystem();
  advance(s, 14, []);
  for (const travel of [0, 0.5, 1.5]) {
    s.step(1 / 60, [], DEFAULT_WALL, travel);
    const b = worldToScreen(s.bottles[0]);
    const half = DEFAULT_WALL.width * 0.5 + s.moon.radius + 0.35,
      period = half * 2;
    const x =
      ((((s.moon.x - travel + half) % period) + period) % period) - half;
    close(b.x, x);
  }
});

test('the enlarged moon is entirely behind the astronaut swimming range',()=>{
 const system=new InteractionSystem();system.step(1/60,[],DEFAULT_WALL);
 const moonFront=MOON_Z+system.moon.radius*depthScale(MOON_Z);
 // Include two metres of clearance for the astronaut's limbs around its root.
 assert.ok(ASTRONAUT_BACK_Z-2>moonFront);
 assert.ok(system.moon.radius>.66);
 assert.ok(HIDDEN_DEPTH<MOON_Z-system.moon.radius*depthScale(MOON_Z));
});
