import test from "node:test";
import assert from "node:assert/strict";
import {
  crossingOrbit,
  StellarOrbits,
} from "../src/experience/stellar-orbits.js";

const hand = { x: -1.8, y: 0 },
  bottle = { x: -1.1, y: 0.3 };
const link = { key: "guest-1:left", strength: 1, hand, bottle };
const sky = {
  angle: 0,
  pole: { x: 0, y: 0.12 },
  offset: { x: 0, y: 0 },
  tile: 10,
  width: 8,
  height: 2.25,
  moon: null,
};
function fixture() {
  const count = 12000,
    p = new Float32Array(count * 3),
    seed = new Float32Array(count * 3),
    orbit = new Float32Array(count * 3);
  let state = 87;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const a = random() * Math.PI * 2,
      r = Math.sqrt(random());
    p[i * 3] = Math.cos(a) * r;
    p[i * 3 + 1] = Math.sin(a) * r;
    for (let k = 0; k < 3; k++) seed[i * 3 + k] = random();
  }
  return { p, seed, orbit, system: new StellarOrbits(p, seed, orbit) };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test("each orbit closes, crosses in the middle twice, and visits both lobes", () => {
  const seed = [0.2, 0.7, 0.6],
    centre = { x: (hand.x + bottle.x) / 2, y: (hand.y + bottle.y) / 2 };
  for (const phase of [0, Math.PI, 2 * Math.PI]) {
    const p = crossingOrbit(hand, bottle, phase, seed);
    close(p.x, centre.x);
    close(p.y, centre.y);
  }
  const a = crossingOrbit(hand, bottle, Math.PI / 2, seed),
    b = crossingOrbit(hand, bottle, Math.PI * 1.5, seed);
  assert.ok(a.x > centre.x && b.x < centre.x);
  const before = crossingOrbit(hand, bottle, Math.PI - 0.0001, seed),
    after = crossingOrbit(hand, bottle, Math.PI + 0.0001, seed);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 0.001);
});
test("different stars follow different lanes and coincident targets remain finite", () => {
  const a = crossingOrbit(hand, bottle, 0.7, [0.1, 0.1, 0.1]),
    b = crossingOrbit(hand, bottle, 0.7, [0.8, 0.9, 0.8]);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 0.04);
  const same = crossingOrbit(hand, hand, 1.4, [0.2, 0.5, 0.7]);
  assert.ok(Number.isFinite(same.x) && Number.isFinite(same.y));
});
test("recruitment reuses a small subset of the original stars without changing the sky buffer", () => {
  const { p, orbit, system } = fixture(),
    original = p.slice();
  system.update(0.05, [link, null], sky);
  assert.ok(
    system.slots[0].members.length > 10 &&
      system.slots[0].members.length <= 110,
  );
  assert.deepEqual(p, original);
  const members = new Set(system.slots[0].members.map((m) => m.id));
  for (let i = 0; i < orbit.length / 3; i++)
    if (!members.has(i)) assert.equal(orbit[i * 3 + 2], 0);
});
test("membership stays stable as the hand moves, then releases back into the field", () => {
  const { orbit, system } = fixture();
  system.update(0.05, [link, null], sky);
  const ids = system.slots[0].members.map((m) => m.id);
  const moved = { ...link, hand: { x: hand.x + 0.3, y: hand.y + 0.1 } };
  for (let i = 0; i < 90; i++) system.update(1 / 60, [moved, null], sky);
  assert.deepEqual(
    system.slots[0].members.map((m) => m.id),
    ids,
  );
  assert.ok(ids.every((id) => orbit[id * 3 + 2] > 0.7));
  for (let i = 0; i < 180; i++) system.update(1 / 60, [null, null], sky);
  assert.equal(system.slots[0].members.length, 0);
  assert.ok(ids.every((id) => orbit[id * 3 + 2] === 0));
});
test("two bottles never recruit the same star and pause freezes orbital motion", () => {
  const { system, orbit } = fixture();
  system.update(0.05, [link, { ...link, key: "guest-2:right" }], sky);
  const ids = system.slots.flatMap((s) => s.members.map((m) => m.id));
  assert.equal(new Set(ids).size, ids.length);
  const snapshot = orbit.slice();
  assert.equal(system.update(0, [link, null], sky), false);
  assert.deepEqual(orbit, snapshot);
});
