import { MAX_PEOPLE, projectJoint, proximity } from "./body.js";

// Wrists lead; elbows, head and hips pull a broader, gentler wake.
export const FLOW_JOINTS = [
  [15, 1],
  [16, 1],
  [13, 0.6],
  [14, 0.6],
  [0, 0.35],
  [23, 0.35],
  [24, 0.35],
];
export const MAX_FLOW_POINTS = MAX_PEOPLE * FLOW_JOINTS.length;

export class SkeletonFlow {
  constructor() {
    this.reset();
  }
  reset() {
    this.previous = new Map();
    this.time = null;
    this.key = null;
  }
  sample(people, wall, time, source) {
    const key = `${source}:${Object.values(wall).join(":")}`;
    // Live poses arrive slower than render frames. Consume each observation once.
    if (key === this.key && time === this.time) return [];
    const dt = this.time === null ? 0 : time - this.time;
    const continuous = key === this.key && dt > 0 && dt <= 0.2;
    const next = new Map(),
      impulses = [];
    for (const person of people.slice(0, MAX_PEOPLE)) {
      for (const [index, weight] of FLOW_JOINTS) {
        const joint = person.joints[index];
        if (!joint?.p3 || joint.vis < 0.55) continue;
        const q = projectJoint(joint.p3, wall);
        if (![q.x, q.y, q.distance].every(Number.isFinite)) continue;
        const u = q.x / wall.width + 0.5,
          v = q.y / wall.height + 0.5;
        const close = proximity(q.distance, wall);
        if (u < 0 || u > 1 || v < 0 || v > 1 || close < 0.01) continue;
        const id = `${person.id}:${index}`,
          last = this.previous.get(id);
        next.set(id, q);
        if (!continuous || !last) continue;
        const dx = q.x - last.x,
          dy = q.y - last.y;
        const speed = Math.hypot(dx, dy) / dt;
        // Ignore inference jitter and discontinuities (seeks, identity jumps, reacquisition).
        if (speed < 0.015 || speed > 6 || Math.hypot(dx, dy) > 0.45) continue;
        const limit = Math.min(1, 2.5 / speed);
        impulses.push({
          u,
          v,
          fromU: last.x / wall.width + 0.5,
          fromV: last.y / wall.height + 0.5,
          dx: (dx / wall.height) * limit * close * weight,
          dy: (dy / wall.height) * limit * close * weight,
          weight: close * weight,
          pigment: index % 2 ? 0.72 : 0.3,
        });
      }
    }
    this.previous = next;
    this.time = time;
    this.key = key;
    return impulses;
  }
}
