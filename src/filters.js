// Per-frame detection clean-up, run on each camera's detections before tracking.
//
// - Duplicates: MediaPipe sometimes returns two skeletons for one person. They agree joint by
//   joint, which two different (even overlapping) people almost never do.
// - Body size: shoulder-to-hip length in metres, from the 2D skeleton scaled by its depth. Only
//   flags bodies far outside human range (projected giants, tiny phantoms) – it deliberately does
//   not test "flatness" against the wall, since our depth is too coarse to separate a person
//   standing close to the wall from the wall itself.

import { MIN_VIS } from './draw.js';

const L_SH = 11;
const R_SH = 12;
const L_HIP = 23;
const R_HIP = 24;

const seen = (j) => j && j.vis >= MIN_VIS;
const mid = (a, b) => (seen(a) && seen(b) ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : seen(a) ? a : seen(b) ? b : null);

/** Skeleton scale in pixels (aspect-corrected): torso length, or shoulder width × 1.3. */
function scalePx(joints, aspect) {
  const len = (a, b) => (a && b ? Math.hypot((a.x - b.x) * aspect, a.y - b.y) : 0);
  const torso = len(mid(joints[L_SH], joints[R_SH]), mid(joints[L_HIP], joints[R_HIP]));
  const shoulders = seen(joints[L_SH]) && seen(joints[R_SH]) ? len(joints[L_SH], joints[R_SH]) * 1.3 : 0;
  return Math.max(torso, shoulders);
}

function isDuplicate(a, b, aspect) {
  if (a.dist != null && b.dist != null && Math.abs(a.dist - b.dist) > 0.75) return false; // one behind the other
  let n = 0;
  let sum = 0;
  for (let i = 0; i < a.joints.length; i++) {
    const p = a.joints[i];
    const q = b.joints[i];
    if (!seen(p) || !seen(q)) continue;
    n++;
    sum += Math.hypot((p.x - q.x) * aspect, p.y - q.y);
  }
  if (n < 6) return false;
  const s = Math.max(scalePx(a.joints, aspect), scalePx(b.joints, aspect));
  return s > 0 && sum / n < 0.35 * s;
}

const meanVis = (p) => p.joints.reduce((s, j) => s + j.vis, 0) / p.joints.length;

/** Drop duplicate skeletons, keeping the more confident one. Returns { people, merged }. */
export function mergeDuplicates(people, aspect) {
  const sorted = [...people].sort((a, b) => meanVis(b) - meanVis(a));
  const kept = [];
  for (const p of sorted) if (!kept.some((k) => isDuplicate(k, p, aspect))) kept.push(p);
  return { people: kept, merged: people.length - kept.length };
}

/**
 * Body size in metres from rectified pixel positions (`toRect(joint) -> [u, v]`), focal length
 * `f` (rectified px) and torso depth `dist`. Uses the larger of torso length and shoulder width
 * × 1.3, so a torso foreshortened by a steep camera angle doesn't read as "too small".
 */
export function bodySizeM(joints, dist, f, toRect) {
  if (dist == null) return null;
  const px = (j) => (seen(j) ? toRect(j) : null);
  const [ls, rs, lh, rh] = [L_SH, R_SH, L_HIP, R_HIP].map((i) => px(joints[i]));
  const avg = (a, b) => (a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a || b);
  const len = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0);
  const torso = len(avg(ls, rs), avg(lh, rh));
  const shoulders = ls && rs ? len(ls, rs) * 1.3 : 0;
  const s = Math.max(torso, shoulders);
  return s > 0 ? (s / f) * dist : null;
}
