import { screenToWorld } from "./scene-space.js";

export const RETREAT_GRACE = 0.75;
export const HIDDEN_DEPTH = -55;
const clamp = (v) => Math.max(0, Math.min(1, v));
const ease = (v) => {
  v = clamp(v);
  return v * v * (3 - 2 * v);
};
const mix = (a, b, t) => a + (b - a) * t;

/** A front-side lower-horizon crossing followed by a three-quarter 3D orbit behind the moon. */
export function retreatPose(flight, progress, moon, radius, out = {}) {
  const t = clamp(progress),
    u = ease((t - 0.25) / 0.75),
    angle = u * Math.PI * 1.5;
  const side = flight.side;
  const sin = Math.sin(angle),
    back = ease((angle - Math.PI) / (Math.PI * 0.5));
  const depth = sin >= 0 ? 2.2 * sin : -HIDDEN_DEPTH * sin;
  const point = {
    x: moon.x + side * (radius * 1.42 + 0.08) * Math.cos(angle),
    y:
      moon.y - radius * 0.62 * (1 - back) + Math.sin(angle * 2) * radius * 0.08,
  };
  screenToWorld(point, depth, out);
  if (t < 0.25) {
    const approach = ease(t / 0.25),
      arch = Math.sin(approach * Math.PI) ** 2;
    out.x = mix(flight.from.x, out.x, approach) + side * arch * 0.1;
    out.y = mix(flight.from.y, out.y, approach) + arch * 0.2;
    out.z = mix(flight.from.z, out.z, approach);
  }
  out.roll = side * Math.sin(angle) * 0.18;
  out.yaw = side * Math.sin(angle * 0.7) * 0.3;
  return out;
}
