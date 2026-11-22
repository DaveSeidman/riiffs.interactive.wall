import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WALL, makePerson } from "../src/experience/body.js";
import {
  InteractionSystem,
  raisedHands,
} from "../src/experience/interactions.js";
import { ExperienceEngine } from "../src/experience/engine.js";

const person = (gesture = "offer", id = 1, x = -1.6) =>
  makePerson(id, x, 0.4, 0, DEFAULT_WALL, gesture);
const advance = (system, seconds, people) => {
  for (let t = 0; t < seconds; t += 1 / 60)
    system.step(1 / 60, people, DEFAULT_WALL);
};

test("a wrist must be visibly above the shoulder and close enough to the wall", () => {
  assert.equal(raisedHands([person()], DEFAULT_WALL).length, 1);
  assert.equal(raisedHands([person("walk")], DEFAULT_WALL).length, 0);
  const hidden = person();
  hidden.joints[16].vis = 0.2;
  assert.equal(raisedHands([hidden], DEFAULT_WALL).length, 0);
  assert.equal(
    raisedHands([makePerson(1, 0, 3, 0, DEFAULT_WALL, "offer")], DEFAULT_WALL)
      .length,
    0,
  );
});
test("a short wave attracts a bottle but does not start the spritz ritual", () => {
  const system = new InteractionSystem();
  advance(system, 0.3, [person()]);
  advance(system, 0.5, [person("walk")]);
  assert.ok(!system.events.some((e) => e.type === "invited"));
  assert.equal(system.spritzes, 0);
});
test("sustained offered wrist produces exactly one complete ritual until lowered", () => {
  const system = new InteractionSystem();
  advance(system, 0.8, [person()]);
  assert.equal(system.bottles.filter((b) => b.phase === "arrive").length, 1);
  advance(system, 7.5, [person()]);
  assert.equal(system.spritzes, 1);
  assert.ok(
    system.bottles.every((b) => ["ambient", "attract"].includes(b.phase)),
  );
  advance(system, 15, [person()]);
  assert.equal(system.spritzes, 1);
});
test("lowering and re-offering the wrist after cooldown alternates products", () => {
  const system = new InteractionSystem();
  advance(system, 6, [person()]);
  advance(system, 3, [person("walk")]);
  advance(system, 3.5, [person()]);
  assert.equal(system.spritzes, 2);
  const sprays = system.events.filter((e) => e.type === "spritz");
  assert.deepEqual(
    sprays.map((e) => e.product),
    [1, 0],
  );
});
test("losing the target before arrival cancels the spritz", () => {
  const system = new InteractionSystem();
  advance(system, 0.8, [person()]);
  advance(system, 4, []);
  assert.equal(system.spritzes, 0);
  assert.ok(system.bottles.every((b) => b.phase === "retreat"));
});
test("two people can receive different products at once", () => {
  const system = new InteractionSystem();
  advance(system, 3.5, [person("offer", 1, -1.5), person("offer", 2, 1.5)]);
  assert.equal(system.spritzes, 2);
  const sprays = system.events.filter((e) => e.type === "spritz");
  assert.equal(new Set(sprays.map((e) => e.person)).size, 2);
});
test("scene changes clear pending rituals and the original starfield dispatches none", () => {
  const system = new InteractionSystem();
  advance(system, 0.8, [person()]);
  system.setScene("starfield");
  advance(system, 4, [person()]);
  assert.equal(system.spritzes, 0);
  assert.ok(system.bottles.every((b) => b.phase === "ambient"));
});
test("the moon's sky anchor stays fixed despite nearby hands and elapsed time", () => {
  const system = new InteractionSystem();
  const initial = { ...system.moon };
  advance(system, 30, [person("offer", 1, -0.7)]);
  assert.deepEqual(system.moon, initial);
  system.config.moonX = 1.2;
  system.config.moonY = -0.1;
  advance(system, 0.1, []);
  assert.equal(system.moon.x, 1.2);
  assert.equal(system.moon.y, -0.1);
});
test("pausing freezes interaction time and sky rotation continues through source changes", () => {
  const engine = new ExperienceEngine();
  engine.step(0.05, 50);
  const time = engine.interactions.time,
    sky = engine.skyTime;
  engine.paused = true;
  engine.step(0.05, 100);
  assert.equal(engine.interactions.time, time);
  assert.equal(engine.skyTime, sky);
  engine.setSource("live");
  engine.step(0.05, 150);
  assert.ok(engine.skyTime > sky);
});
test("sky rotation is visible over thirty seconds and continues smoothly across speed changes", () => {
  const engine = new ExperienceEngine();
  engine.sim.count = 0;
  for (let i = 0; i < 300; i++) engine.step(0.1, i * 100);
  const degrees = (engine.skyAngle * 180) / Math.PI;
  assert.ok(degrees > 7 && degrees < 7.5);
  const angle = engine.skyAngle;
  engine.skySpeed = 0;
  engine.step(0.1, 30100);
  assert.ok(engine.skyAngle > angle, "sky decelerates rather than stopping abruptly");
  assert.ok(engine.actualSkySpeed < .8 && engine.actualSkySpeed > .7);
  engine.skySpeed = 1.6;
  engine.step(0.1, 30200);
  assert.ok(engine.skyAngle > angle && engine.skyAngle - angle < 0.001);
  const continued = engine.skyAngle;
  engine.setSource("live");
  assert.equal(engine.skyAngle, continued);
  engine.paused = true;
  engine.step(0.1, 30300);
  assert.equal(engine.skyAngle, continued);
});
test("sky rotation has the same speed at different frame rates", () => {
  const slow = new ExperienceEngine(),
    fast = new ExperienceEngine();
  slow.sim.count = fast.sim.count = 0;
  for (let i = 0; i < 100; i++) slow.step(0.1, i * 100);
  for (let i = 0; i < 600; i++) fast.step(1 / 60, (i * 1000) / 60);
  assert.ok(Math.abs(slow.skyAngle - fast.skyAngle) < 1e-10);
});
test("the moon shares a leftward drift and rises into a gentle arc", () => {
  const engine = new ExperienceEngine();
  engine.sim.count = 0;
  const initial = { ...engine.skyView };
  for (let i = 0; i < 300; i++) engine.step(0.1, i * 100);
  assert.ok(engine.skyView.x < initial.x - 0.4);
  assert.ok(engine.skyView.y > initial.y + 0.02);
  assert.ok(engine.skyView.x > 0);
  const position = { ...engine.skyView };
  engine.paused = true;
  engine.step(0.1, 30100);
  assert.deepEqual(engine.skyView, position);
});
test("a visible low hand attracts its bottle and a lost hand releases it", () => {
  const system = new InteractionSystem();
  const p = person("walk");
  advance(system, 0.15, [p]);
  const bottle = system.bottles.find((b) => b.phase === "attract");
  assert.ok(bottle);
  const initial = Math.hypot(
    bottle.x - bottle.linkTarget.x,
    bottle.y - bottle.linkTarget.y,
  );
  advance(system, 1, [p]);
  const closer = Math.hypot(
    bottle.x - bottle.linkTarget.x,
    bottle.y - bottle.linkTarget.y,
  );
  assert.ok(closer < initial);
  assert.ok(bottle.attraction > 0.9);
  assert.equal(system.spritzes, 0);
  advance(system, 0.4, []);
  assert.ok(bottle.attraction < 0.3);
  assert.equal(bottle.phase, "depart");
  advance(system, 2, []);
  assert.equal(bottle.phase, "retreat");
});
test("low-confidence wrists cannot attract bottles", () => {
  const system = new InteractionSystem(),
    p = person("walk");
  p.joints[15].vis = 0.1;
  p.joints[16].vis = 0.1;
  advance(system, 1, [p]);
  assert.ok(
    system.bottles.every((b) => b.phase === "ambient" && b.attraction === 0),
  );
});

test('ambient bottles retain their sides and owners across time and detection reorder',()=>{
 const system=new InteractionSystem();system.config.scene='perfume';
 const a=person('walk',1,-2),b=person('walk',2,2);
 for(const p of [a,b]){p.joints[15].vis=0;p.joints[16].vis=0;}
 advance(system,1,[a,b]);const owners=system.bottles.map(b=>b.ambientOwner);
 let maxSpeed=0;
 for(let i=0;i<30*60;i++){
  const before=system.bottles.map(b=>b.x);system.step(1/60,i%2?[a,b]:[b,a],DEFAULT_WALL);
  system.bottles.forEach((b,j)=>{maxSpeed=Math.max(maxSpeed,Math.abs(b.x-before[j])*60);});
  assert.deepEqual(system.bottles.map(b=>b.ambientOwner),owners);
 }
 assert.ok(system.bottles[0].x<0&&system.bottles[1].x>0);
 assert.ok(maxSpeed<=.241);
});
test('distant detected bodies do not attract or repeatedly recall the bottles',()=>{
 const system=new InteractionSystem();
 const far=[makePerson(1,-2,3.5,0,DEFAULT_WALL),makePerson(2,2,3.5,0,DEFAULT_WALL)];
 advance(system,30,far);
 assert.ok(system.bottles.every(b=>b.phase==='hidden'&&b.owner===null));
 assert.equal(system.spritzes,0);
});
