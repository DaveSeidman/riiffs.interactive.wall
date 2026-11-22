import { smoothMotion } from './smooth-motion.js';
import { projectJoint, bodyWallDistance } from "./body.js";
import { skyView } from "./sky.js";
import { INTERACTION_Z, screenToWorld, MOON_SIZE_MULTIPLIER } from "./scene-space.js";
import { RETREAT_GRACE, retreatPose } from "./bottle-flight.js";

export const SCENES = [
  {
    id: "lunar",
    name: "Lunar encounter",
    description:
      "A drifting lunar sky. Reach toward a bottle to draw it to your hand.",
  },
  {
    id: "moon",
    name: "Moon study",
    description:
      "A lit 3D moon crossing the sky in a gentle right-to-left arc.",
  },
  {
    id: "perfume",
    name: "Wrist ritual",
    description:
      "Hold a wrist above your shoulder. A bottle descends, spritzes, and floats away.",
  },
  {
    id: "starfield",
    name: "Original starfield",
    description: "The original body-distorted particle field.",
  },
];
export const moonVisible = (scene) => scene === "lunar" || scene === "moon";
export const productsVisible = (scene) =>
  scene === "lunar" || scene === "perfume";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const distance3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Pose only establishes an offered wrist; it cannot establish palm orientation. */
export function raisedHands(people, wall) {
  const hands = [];
  for (const person of people)
    for (const [side, shoulder, wrist] of [
      ["left", 11, 15],
      ["right", 12, 16],
    ]) {
      const a = person.joints[shoulder],
        b = person.joints[wrist];
      if (!a?.p3 || !b?.p3 || a.vis < 0.55 || b.vis < 0.55) continue;
      const point = projectJoint(b.p3, wall);
      if (b.p3.y > a.p3.y - 0.1 || point.distance > Math.min(wall.far, 2.5))
        continue;
      if (
        Math.abs(point.x) > wall.width * 0.5 - 0.1 ||
        Math.abs(point.y) > wall.height * 0.5 - 0.08
      )
        continue;
      hands.push({
        key: `${person.id}:${side}`,
        id: person.id,
        side,
        point,
        world: b.p3,
      });
    }
  return hands;
}

export function nearbyHands(people, wall) {
  const hands = [];
  for (const person of people)
    for (const [side, index] of [
      ["left", 15],
      ["right", 16],
    ]) {
      const j = person.joints[index];
      if (!j?.p3 || j.vis < 0.55) continue;
      const point = projectJoint(j.p3, wall);
      if (
        point.distance > Math.min(wall.far, 2.2) ||
        Math.abs(point.x) > wall.width * 0.5 - 0.1 ||
        Math.abs(point.y) > wall.height * 0.5 - 0.08
      )
        continue;
      hands.push({ key: `${person.id}:${side}`, id: person.id, side, point });
    }
  return hands;
}
const available = (b) => b.phase === "ambient" || b.phase === "attract";

export class WristGestures {
  constructor() {
    this.records = new Map();
    this.cooldowns = new Map();
  }
  update(dt, time, people, wall, dwell = 0.65) {
    const signals = raisedHands(people, wall),
      seen = new Set();
    for (const hand of signals) {
      seen.add(hand.key);
      let record = this.records.get(hand.key);
      if (!record) {
        record = {
          ...hand,
          held: 0,
          used: false,
          absent: 0,
          last: time,
          ready: false,
        };
        this.records.set(hand.key, record);
      }
      const speed =
        record.world && dt > 0 ? distance3(record.world, hand.world) / dt : 0;
      record.held = speed < 1.6 ? record.held + dt : 0;
      Object.assign(record, hand, { absent: 0, last: time });
      record.progress = clamp(record.held / dwell, 0, 1);
      record.ready =
        record.held >= dwell &&
        !record.used &&
        (this.cooldowns.get(hand.id) ?? 0) <= time;
    }
    for (const [key, record] of this.records) {
      if (!seen.has(key)) {
        record.absent += dt;
        record.ready = false;
        record.progress = 0;
        record.held = 0;
        if (record.absent > 0.25) record.used = false;
        if (record.absent > 1) this.records.delete(key);
      }
    }
    for (const [id, until] of this.cooldowns)
      if (until < time - 30) this.cooldowns.delete(id);
    return [...this.records.values()].filter((r) => r.absent === 0);
  }
  consume(record, time, cooldown) {
    record.used = true;
    record.ready = false;
    this.cooldowns.set(record.id, time + cooldown);
  }
}

export class InteractionSystem {
  constructor() {
    this.config = {
      scene: "lunar",
      moonX: 1.8,
      moonY: 0.08,
      moonRadius: 0.66,
      dwell: 0.65,
      cooldown: 8,
      ambient: true,
      attractionRadius: 1.5,
    };
    this.products = [
      { name: "LUNAR 01", color: "#718df4", shape: "round" },
      { name: "LUNAR 02", color: "#ea83af", shape: "square" },
    ];
    this.reset();
  }
  reset() {
    this.time = 0;
    this.gestures = new WristGestures();
    this.hands = [];
    this.nearbyHands = [];
    this.spritzes = 0;
    this.events = [];
    this.nextProduct = 0;
    this.emptyTime = 0;
    this.moon = {
      x: this.config.moonX,
      y: this.config.moonY,
      radius: this.config.moonRadius * MOON_SIZE_MULTIPLIER,
    };
    this.bottles = [0, 1].map((i) => ({
      product: i,
      phase: "ambient",
      phaseTime: 0,
      x: i ? 2.25 : -2.25,
      y: 0.12,
      z: 2,
      scale: 1,
      owner: null,
      ambientOwner:null,ambientVx:0,ambientVy:0,
      target: null,
      hand: null,
      from: null,
      sprayTime: 2,
      attraction: 0,
      linkTarget: null,
      vx: 0,
      vy: 0,
      flight: null,
      flightRoll: 0,
      flightYaw: 0,
    }));
  }
  setScene(scene) {
    if (this.config.scene !== scene) {
      this.config.scene = scene;
      this.reset();
    }
  }
  step(dt, people, wall, skyTravel = 0) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    people=people.filter(person=>bodyWallDistance(person,wall)<=Math.min(wall.far,2.2));
    this.emptyTime = people.length ? 0 : this.emptyTime + dt;
    this.hands = this.gestures.update(
      dt,
      this.time,
      people,
      wall,
      this.config.dwell,
    );
    this.nearbyHands = nearbyHands(people, wall);
    if (moonVisible(this.config.scene)) this.updateMoon(dt, people, wall);
    if (!productsVisible(this.config.scene)) return;
    const moonView = skyView(skyTravel, wall, this.moon);
    if (moonVisible(this.config.scene))
      for (const b of this.bottles) {
        if (!people.length && this.emptyTime >= RETREAT_GRACE) this.retreat(b);
        else if (people.length && ["retreat", "hidden"].includes(b.phase)) {
          if (b.phase === "hidden")
            b.flight.from = screenToWorld(
              this.ambientTarget(b.product, people, wall),
              INTERACTION_Z,
            );
          b.phase = "emerge";
          b.phaseTime = 0;
        }
      }
    const busyPeople = new Set(
      this.bottles.filter((b) => !available(b)).map((b) => b.owner),
    );
    const waiting = this.hands
      .filter((h) => h.ready && !busyPeople.has(h.id))
      .sort((a, b) => b.held - a.held);
    // Alternate which product gets first refusal so solo guests see both fragrances.
    for (const index of [this.nextProduct, 1 - this.nextProduct]) {
      const bottle = this.bottles[index];
      if (available(bottle) && waiting.length) {
        const hand = waiting.shift();
        if (busyPeople.has(hand.id)) continue;
        busyPeople.add(hand.id);
        this.gestures.consume(hand, this.time, this.config.cooldown);
        Object.assign(bottle, {
          phase: "arrive",
          phaseTime: 0,
          owner: hand.id,
          hand: hand.key,
          target: { ...hand.point },
          from: { x: bottle.x, y: bottle.y },
          sprayTime: 2,
        });
        this.nextProduct = 1 - index;
        this.events.unshift({
          type: "invited",
          product: index,
          person: hand.id,
          time: this.time,
        });
      }
    }
    const claimed = new Set(
      this.bottles.filter((b) => !available(b)).map((b) => b.owner),
    );
    for (const b of this.bottles) {
      if (!available(b)) continue;
      const radius = this.config.attractionRadius;
      const hand = this.nearbyHands
        .filter(
          (h) =>
            !claimed.has(h.id) &&
            Math.hypot(h.point.x - b.x, h.point.y - b.y) <
              (b.hand === h.key ? radius * 1.5 : radius),
        )
        .sort(
          (a, c) =>
            Math.hypot(a.point.x - b.x, a.point.y - b.y) -
            Math.hypot(c.point.x - b.x, c.point.y - b.y),
        )[0];
      if (hand) {
        if (b.phase !== "attract") {
          b.phase = "attract";
          b.phaseTime = 0;
          b.vx = 0;
          b.vy = 0;
        }
        b.owner = hand.id;
        b.hand = hand.key;
        b.target = { ...hand.point };
        claimed.add(hand.id);
      } else if (b.phase === "attract") this.leave(b);
    }
    for (const bottle of this.bottles)
      this.updateBottle(bottle, dt, people, wall, moonView);
    this.events.length = Math.min(this.events.length, 8);
  }
  ambientTarget(index, people, wall) {
    const side = index ? 1 : -1;
    let x = side * wall.width * 0.29,
      y = 0.06 + Math.sin(this.time * 0.65 + index * 2) * 0.1;
    if (people.length && this.config.ambient) {
      const bottle=this.bottles[index];
      const eligible=people.filter(p=>bodyWallDistance(p,wall)<=Math.min(wall.far,2.2));
      let person=eligible.find(p=>p.id===bottle.ambientOwner);
      if(!person){
        const other=this.bottles[1-index].ambientOwner;
        const unclaimed=eligible.filter(p=>p.id!==other);
        person=(unclaimed.length?unclaimed:eligible).slice().sort((a,b)=>{
          const ax=projectJoint([11,12,23,24].map(i=>a.joints[i]).find(j=>j?.p3&&j.vis>=.4).p3,wall).x;
          const bx=projectJoint([11,12,23,24].map(i=>b.joints[i]).find(j=>j?.p3&&j.vis>=.4).p3,wall).x;
          return Math.abs(ax-x)-Math.abs(bx-x);
        })[0];
        bottle.ambientOwner=person?.id??null;
      }
      const shoulder = person?.joints[index ? 12 : 11];
      if (shoulder?.p3) {
        const p = projectJoint(shoulder.p3, wall);
        x = p.x + side * 0.6;
        y = p.y + 0.13 + Math.sin(this.time * 0.7 + index) * 0.07;
      }
    }
    return {
      x: clamp(x, -wall.width * 0.5 + 0.4, wall.width * 0.5 - 0.4),
      y: clamp(y, -wall.height * 0.5 + 0.45, wall.height * 0.5 - 0.4),
    };
  }
  leave(bottle) {
    bottle.phase = "depart";
    bottle.phaseTime = 0;
    bottle.from = { x: bottle.x, y: bottle.y };
  }
  retreat(b) {
    if (b.phase === "retreat" || b.phase === "hidden") return;
    if (b.phase !== "emerge")
      b.flight = {
        from: { x: b.x, y: b.y, z: b.z },
        progress: 0,
        side: b.product ? 1 : -1,
        duration: 9.5 + b.product * 1.3,
      };
    Object.assign(b, {
      phase: "retreat",
      phaseTime: 0,
      owner: null,
      hand: null,
      target: null,
      linkTarget: null,
      sprayTime: 2,
    });
  }
  updateBottle(b, dt, people, wall, moonView) {
    b.phaseTime += dt;
    b.sprayTime += dt;
    if (["retreat", "hidden", "emerge"].includes(b.phase)) {
      b.attraction *= Math.exp(-dt * 6);
      const flight = b.flight;
      if (b.phase === "retreat")
        flight.progress = Math.min(1, flight.progress + dt / flight.duration);
      else if (b.phase === "emerge")
        flight.progress = Math.max(
          0,
          flight.progress - dt / (4.5 + b.product * 0.5),
        );
      const pose = retreatPose(
        flight,
        flight.progress,
        moonView,
        this.moon.radius,
      );
      b.x = pose.x;
      b.y = pose.y;
      b.z = pose.z;
      b.flightRoll = pose.roll;
      b.flightYaw = pose.yaw;
      if (b.phase === "retreat" && flight.progress >= 1) b.phase = "hidden";
      else if (b.phase === "emerge" && flight.progress <= 0)
        Object.assign(b, {
          phase: "ambient",
          phaseTime: 0,
          z: INTERACTION_Z,
          flight: null,
          flightRoll: 0,
          flightYaw: 0,
        });
      return;
    }
    const home = this.ambientTarget(b.product, people, wall);
    const hand = this.hands.find((h) => h.key === b.hand && h.absent === 0);
    const linked = this.nearbyHands.find((h) => h.key === b.hand);
    const linking =
      !!linked && ["attract", "arrive", "settle", "spritz"].includes(b.phase);
    b.attraction = mix(b.attraction, linking ? 1 : 0, 1 - Math.exp(-dt * 6));
    if (linked) b.linkTarget = { ...linked.point };
    if (
      (b.phase === "arrive" || b.phase === "settle" || b.phase === "spritz") &&
      !hand
    ) {
      this.leave(b);
    }
    if (hand && b.phase !== "depart") b.target = { ...hand.point };
    const target = b.target
      ? {
          x: clamp(
            b.target.x + (b.product ? 0.17 : -0.17),
            -wall.width * 0.5 + 0.35,
            wall.width * 0.5 - 0.35,
          ),
          y: Math.min(wall.height * 0.5 - 0.3, b.target.y + 0.3),
        }
      : home;
    if (b.phase === "ambient") {
      smoothMotion(b,'ambientVx',clamp((home.x-b.x)*.55,-.24,.24),dt,1.6);
      smoothMotion(b,'ambientVy',clamp((home.y-b.y)*.55,-.14,.14),dt,1.6);
      b.x+=b.ambientVx*dt;b.y+=b.ambientVy*dt;
      smoothMotion(b,'scale',1,dt,1.4);
    } else if (b.phase === "attract") {
      b.vx += ((target.x - b.x) * 12 - b.vx * 5.5) * dt;
      b.vy += ((target.y - b.y) * 12 - b.vy * 5.5) * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.scale = mix(b.scale, 0.86, 1 - Math.exp(-dt * 3));
    } else if (b.phase === "arrive") {
      const t = ease(b.phaseTime / 1.25);
      b.x = mix(b.from.x, target.x, t);
      b.y = mix(b.from.y, target.y, t) + Math.sin(t * Math.PI) * 0.25;
      b.scale = mix(1, 0.78, t);
      if (b.phaseTime >= 1.25) {
        b.phase = "settle";
        b.phaseTime = 0;
      }
    } else if (b.phase === "settle" || b.phase === "spritz") {
      const k = 1 - Math.exp(-dt * 8);
      b.x = mix(b.x, target.x, k);
      b.y = mix(b.y, target.y, k);
      if (b.phase === "settle" && b.phaseTime > 0.3) {
        b.phase = "spritz";
        b.phaseTime = 0;
        b.sprayTime = 0;
        this.spritzes++;
        this.events.unshift({
          type: "spritz",
          product: b.product,
          person: b.owner,
          time: this.time,
        });
      } else if (b.phase === "spritz" && b.phaseTime > 0.85) this.leave(b);
    } else if (b.phase === "depart") {
      const t = ease(b.phaseTime / 4.5);
      b.x = mix(b.from.x, home.x, t);
      b.y = mix(b.from.y, home.y, t) + Math.sin(t * Math.PI) * 0.45;
      b.scale = mix(0.78, 1, t);
      if (b.phaseTime >= 4.5)
        Object.assign(b, {
          phase: "ambient",
          phaseTime: 0,
          owner: null,
          hand: null,
          target: null,
        });
    }
  }
  updateMoon(dt, people, wall) {
    const m = this.moon;
    m.radius = Math.min(
      this.config.moonRadius * MOON_SIZE_MULTIPLIER,
      wall.height * 0.45,
      wall.width * 0.45,
    );
    const xLimit = Math.max(0, wall.width * 0.5 - m.radius - 0.02);
    const yLimit = Math.max(0, wall.height * 0.5 - m.radius - 0.02);
    m.x = clamp(this.config.moonX, -xLimit, xLimit);
    m.y = clamp(this.config.moonY, -yLimit, yLimit);
  }
}
