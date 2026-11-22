import { smoothMotion } from './smooth-motion.js';
const TAU = Math.PI * 2;
const wrap = (v, period) =>
  ((((v + period * 0.5) % period) + period) % period) - period * 0.5;

// Each star has its own closed, irregular figure eight. Both lobes cross at the centre;
// lane width, inclination, phase and speed vary, so a swarm never forms a drawn ribbon.
export function crossingOrbit(hand, bottle, phase, seed, out = {}) {
  const dx = bottle.x - hand.x,
    dy = bottle.y - hand.y;
  const distance = Math.hypot(dx, dy),
    length = Math.max(0.05, distance);
  const ux = distance > 0.001 ? dx / distance : 1;
  const uy = distance > 0.001 ? dy / distance : 0;
  const s = Math.sin(phase);
  const along =
    (length * 0.5 + 0.12 + seed[2] * 0.15) * s +
    Math.sin(phase * 3 + seed[0] * TAU) * 0.035 * s;
  const across =
    (0.14 + Math.min(length, 1.2) * 0.18) *
      (0.55 + seed[1] * 0.8) *
      Math.sin(phase * 2) +
    Math.sin(phase * 5 + seed[1] * TAU) * 0.035 * s;
  const tilt = (seed[2] - 0.5) * 0.45,
    c = Math.cos(tilt),
    t = Math.sin(tilt);
  const a = along * c - across * t,
    b = along * t + across * c;
  out.x = (hand.x + bottle.x) * 0.5 + ux * a - uy * b;
  out.y = (hand.y + bottle.y) * 0.5 + uy * a + ux * b;
  return out;
}

export class StellarOrbits {
  constructor(positions, seeds, attribute) {
    this.positions = positions;
    this.seeds = seeds;
    this.attribute = attribute;
    this.slots = Array.from({ length: 2 }, () => ({
      key: null,
      nextRecruit: 0,
      members: [],
      hand: { x: 0, y: 0 },
      bottle: { x: 0, y: 0 },
    }));
    this.time = 0;
    this.temp = {};
  }
  recruit(slot, link, sky, occupied) {
    slot.nextRecruit = this.time + 0.6;
    const candidates = [],
      count = this.positions.length / 3;
    const c = Math.cos(sky.angle),
      s = Math.sin(sky.angle);
    const coverage =
      Math.hypot(
        sky.width * 0.5 + Math.abs(sky.pole.x),
        sky.height * 0.5 + Math.abs(sky.pole.y),
      ) + 0.4;
    const radius = Math.min(
      1.6,
      0.75 +
        Math.hypot(link.hand.x - link.bottle.x, link.hand.y - link.bottle.y) *
          0.4,
    );
    const dx = link.bottle.x - link.hand.x,
      dy = link.bottle.y - link.hand.y,
      dd = Math.max(0.001, dx * dx + dy * dy);
    for (let id = 0; id < count; id++) {
      if (occupied.has(id)) continue;
      const px = this.positions[id * 3] * coverage,
        py = this.positions[id * 3 + 1] * coverage;
      const x = wrap(c * px - s * py + sky.pole.x + sky.offset.x, sky.tile);
      const y = wrap(s * px + c * py + sky.pole.y + sky.offset.y, sky.tile);
      if (Math.abs(x) > sky.width * 0.5 || Math.abs(y) > sky.height * 0.5)
        continue;
      if (
        sky.moon &&
        Math.hypot(x - sky.moon.x, y - sky.moon.y) < sky.moon.radius
      )
        continue;
      const h = Math.max(
        0,
        Math.min(1, ((x - link.hand.x) * dx + (y - link.hand.y) * dy) / dd),
      );
      const distance = Math.hypot(
        x - link.hand.x - h * dx,
        y - link.hand.y - h * dy,
      );
      if (distance > radius) continue;
      const choice =
        (this.seeds[id * 3] * 13.37 + this.seeds[id * 3 + 1] * 7.91) % 1;
      candidates.push({ id, score: (distance / radius) * 0.4 + choice * 0.9 });
    }
    candidates.sort((a, b) => a.score - b.score);
    const targetCount = Math.min(110, Math.floor(count * 0.004));
    slot.key = link.key;
    Object.assign(slot.hand, link.hand);
    Object.assign(slot.bottle, link.bottle);
    slot.members = candidates.slice(0, targetCount).map(({ id }) => {
      occupied.add(id);
      return {
        id,
        blend: 0,
        phase: this.seeds[id * 3] * TAU,
        speed: 0.48 + this.seeds[id * 3 + 1] * 0.48,
        seed: [
          this.seeds[id * 3],
          this.seeds[id * 3 + 1],
          this.seeds[id * 3 + 2],
        ],
      };
    });
  }
  update(dt, links, sky) {
    dt = Math.max(0, Math.min(0.1, dt));
    this.time += dt;
    if (!dt) return false;
    const occupied = new Set(
      this.slots.flatMap((slot) => slot.members.map((m) => m.id)),
    );
    let dirty = false;
    for (let i = 0; i < 2; i++) {
      const slot = this.slots[i],
        link = links[i];
      if (
        !slot.members.length &&
        link?.strength > 0.025 &&
        this.time >= slot.nextRecruit
      )
        this.recruit(slot, link, sky, occupied);
      const engaged = !!link && link.key === slot.key && link.strength > 0.01;
      if (engaged) {
        for (const axis of ["x", "y"]) {
          smoothMotion(slot.hand,axis,link.hand[axis],dt,12);
          smoothMotion(slot.bottle,axis,link.bottle[axis],dt,12);
        }
      }
      const keep = [];
      for (const member of slot.members) {
        const target = engaged ? link.strength : 0;
        smoothMotion(member,'blend',target,dt,engaged ? 2.6+member.seed[1]*2.4 : 6);
        member.phase =
          (member.phase +
            dt *
              member.speed *
              (1 + 0.08 * Math.sin(this.time * 0.23 + member.seed[2] * TAU))) %
          TAU;
        const p = crossingOrbit(
            slot.hand,
            slot.bottle,
            member.phase,
            member.seed,
            this.temp,
          ),
          at = member.id * 3;
        this.attribute[at] = p.x;
        this.attribute[at + 1] = p.y;
        this.attribute[at + 2] = member.blend;
        dirty = true;
        if (!engaged && member.blend < 0.003) {
          this.attribute[at + 2] = 0;
          occupied.delete(member.id);
        } else keep.push(member);
      }
      slot.members = keep;
      if (!keep.length) slot.key = null;
    }
    return dirty;
  }
}
