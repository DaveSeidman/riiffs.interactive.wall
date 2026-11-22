import test from "node:test";
import assert from "node:assert/strict";
import {
  SkeletonFlow,
  MAX_FLOW_POINTS,
} from "../src/experience/fluid-motion.js";
import { DEFAULT_WALL, makePerson } from "../src/experience/body.js";

const person = (x = 0, distance = 0.5, id = 1) =>
  makePerson(id, x, distance, 0, DEFAULT_WALL);
const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("Blush converts tracked motion into bounded, depth-weighted wakes", () => {
  const near = new SkeletonFlow(),
    far = new SkeletonFlow();
  assert.deepEqual(near.sample([person()], DEFAULT_WALL, 0, "simulation"), []);
  far.sample([person(0, 2)], DEFAULT_WALL, 0, "simulation");
  const close = near.sample([person(0.02)], DEFAULT_WALL, 0.02, "simulation");
  const distant = far.sample(
    [person(0.02, 2)],
    DEFAULT_WALL,
    0.02,
    "simulation",
  );
  assert.equal(close.length, 7);
  assert.equal(distant.length, 7);
  assert.ok(
    close.every(
      (p) =>
        p.u >= 0 && p.u <= 1 && p.v >= 0 && p.v <= 1 && p.dx > 0 && p.dy === 0,
    ),
  );
  assert.ok(close[0].dx > distant[0].dx * 2);
  assert.ok(close[0].dx > close[4].dx); // wrist > head
});

test("stationary poses, inference jitter, missing or unconfident joints never inject force", () => {
  const flow = new SkeletonFlow();
  flow.sample([person()], DEFAULT_WALL, 0, "live");
  assert.deepEqual(flow.sample([person()], DEFAULT_WALL, 0.02, "live"), []);
  assert.deepEqual(
    flow.sample([person(0.0001)], DEFAULT_WALL, 0.04, "live"),
    [],
  );
  const low = person(0.02);
  low.joints.forEach((j) => {
    j.vis = 0.3;
  });
  assert.deepEqual(flow.sample([low], DEFAULT_WALL, 0.06, "live"), []);
  assert.deepEqual(flow.sample([person(0.04)], DEFAULT_WALL, 0.08, "live"), []);
  assert.deepEqual(flow.sample([], DEFAULT_WALL, 0.1, "live"), []);
  assert.deepEqual(flow.sample([person(0.06)], DEFAULT_WALL, 0.12, "live"), []);
});

test("live observations are consumed once and displacement is independent of input frame rate", () => {
  const slow = new SkeletonFlow(),
    fast = new SkeletonFlow();
  slow.sample([person()], DEFAULT_WALL, 0, "live");
  fast.sample([person()], DEFAULT_WALL, 0, "live");
  const a = slow.sample([person(0.04)], DEFAULT_WALL, 0.04, "live");
  assert.deepEqual(slow.sample([person(0.04)], DEFAULT_WALL, 0.04, "live"), []);
  const b = fast.sample([person(0.02)], DEFAULT_WALL, 0.02, "live");
  const c = fast.sample([person(0.04)], DEFAULT_WALL, 0.04, "live");
  a.forEach((p, i) => approx(p.dx, b[i].dx + c[i].dx));
});

test("loops, seeks, changed sources, gaps and calibration changes cannot fling the fluid", () => {
  const flow = new SkeletonFlow();
  flow.sample([person()], DEFAULT_WALL, 1, "poses");
  assert.deepEqual(flow.sample([person(1)], DEFAULT_WALL, 0, "poses"), []);
  assert.deepEqual(flow.sample([person(-1)], DEFAULT_WALL, 0.02, "poses"), []);
  assert.deepEqual(flow.sample([person(1)], DEFAULT_WALL, 0.04, "live"), []);
  assert.deepEqual(flow.sample([person(-1)], DEFAULT_WALL, 2, "live"), []);
  assert.deepEqual(
    flow.sample([person(1)], { ...DEFAULT_WALL, yaw: 10 }, 2.02, "live"),
    [],
  );
  flow.reset();
  assert.deepEqual(flow.sample([person()], DEFAULT_WALL, 2.04, "live"), []);
});

test("all six skeletons contribute without exceeding shader capacity, and identities stay independent", () => {
  const flow = new SkeletonFlow();
  const group = (offset) =>
    Array.from({ length: 6 }, (_, i) =>
      person(-2 + i * 0.7 + offset, 0.5, i + 1),
    );
  flow.sample(group(0), DEFAULT_WALL, 0, "simulation");
  const moved = flow.sample(
    group(0.02).reverse(),
    DEFAULT_WALL,
    0.02,
    "simulation",
  );
  assert.equal(moved.length, MAX_FLOW_POINTS);
  assert.ok(moved.every((p) => p.dx > 0 && Number.isFinite(p.dy)));
  assert.deepEqual(
    flow.sample([person(20)], DEFAULT_WALL, 0.04, "simulation"),
    [],
  );
});
