// Multi-camera fusion: camera placement (extrinsics), cross-camera merging, auto-alignment.
//
// Coordinates follow the camera convention: X right, Y down, Z forward (metres).
// Camera 1 defines the world frame by default (all extrinsics 0).
// Extrinsics are applied as  world = Ry(yaw) · Rx(pitch) · Rz(roll) · p_cam + t
//   yaw   > 0 turns the camera to the right
//   pitch > 0 tilts the camera down
//   roll  > 0 rolls clockwise (as seen from behind the camera)

const D2R = Math.PI / 180;
const TORSO = [11, 12, 23, 24];

function mul(A, B) {
  const C = new Array(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return C;
}

export function apply(R, p) {
  return {
    x: R[0] * p.x + R[1] * p.y + R[2] * p.z,
    y: R[3] * p.x + R[4] * p.y + R[5] * p.z,
    z: R[6] * p.x + R[7] * p.y + R[8] * p.z,
  };
}

export const DEFAULT_EXTRINSICS = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };

export function extrinsicsToPose(ex) {
  const [cy, sy] = [Math.cos(ex.yaw * D2R), Math.sin(ex.yaw * D2R)];
  const [cp, sp] = [Math.cos(ex.pitch * D2R), Math.sin(ex.pitch * D2R)];
  const [cr, sr] = [Math.cos(ex.roll * D2R), Math.sin(ex.roll * D2R)];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rx = [1, 0, 0, 0, cp, sp, 0, -sp, cp];
  const Rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  const level = mul(Rx, Rz); // pitch + roll only
  return { R: mul(Ry, level), level, t: { x: ex.x, y: ex.y, z: ex.z } };
}

export function toWorld(pose, p) {
  const r = apply(pose.R, p);
  return { x: r.x + pose.t.x, y: r.y + pose.t.y, z: r.z + pose.t.z };
}

/** Mean of the usable torso joints' `key` positions ('p3' camera space, 'w' world), or null. */
export function torsoCenter(joints, key) {
  const pts = TORSO.map((i) => joints[i]).filter((j) => j[key] && !j.rejected).map((j) => j[key]);
  if (!pts.length) return null;
  const n = pts.length;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
    z: pts.reduce((s, p) => s + p.z, 0) / n,
  };
}

/** How much to trust a joint seen at normalised image x: 1 in the centre, ~0 at the edges. */
const edgeWeight = (x) => Math.max(0.05, 1 - (2 * Math.abs(x - 0.5)) ** 2);

/**
 * Merge per-camera detections that are the same person.
 * dets: [{ cam, person }] where person.center is the world torso centre.
 * Returns merged people: { joints: [{ w, vis }], center, cams: [camIndex], members: [det] }
 */
export function fuse(dets, maxDist) {
  const pairs = [];
  for (let i = 0; i < dets.length; i++) {
    for (let j = i + 1; j < dets.length; j++) {
      const a = dets[i];
      const b = dets[j];
      if (a.cam === b.cam) continue;
      const d = Math.hypot(a.person.center.x - b.person.center.x, a.person.center.z - b.person.center.z);
      if (d < maxDist) pairs.push({ a, b, d });
    }
  }
  pairs.sort((p, q) => p.d - q.d);

  const groupOf = new Map();
  const groups = [];
  for (const { a, b } of pairs) {
    const ga = groupOf.get(a);
    const gb = groupOf.get(b);
    if (!ga && !gb) {
      const g = [a, b];
      groups.push(g);
      groupOf.set(a, g).set(b, g);
    } else if (ga && !gb && !ga.some((m) => m.cam === b.cam)) {
      ga.push(b);
      groupOf.set(b, ga);
    } else if (gb && !ga && !gb.some((m) => m.cam === a.cam)) {
      gb.push(a);
      groupOf.set(a, gb);
    }
  }
  for (const d of dets) if (!groupOf.has(d)) groups.push([d]);

  return groups.map((members) => {
    const joints = Array.from({ length: 33 }, (_, i) => {
      let wsum = 0;
      let vis = 0;
      const acc = { x: 0, y: 0, z: 0 };
      for (const m of members) {
        const j = m.person.joints[i];
        vis = Math.max(vis, j.vis);
        if (!j.w) continue;
        const wt = j.vis * edgeWeight(j.x);
        acc.x += j.w.x * wt;
        acc.y += j.w.y * wt;
        acc.z += j.w.z * wt;
        wsum += wt;
      }
      return { vis, w: wsum > 0 ? { x: acc.x / wsum, y: acc.y / wsum, z: acc.z / wsum } : null };
    });
    const center = torsoCenter(joints, 'w') ?? members[0].person.center;
    return { joints, center, cams: members.map((m) => m.cam).sort(), members };
  });
}

/**
 * Solve yaw + translation that maps target-camera points onto reference world points.
 * pairs: [{ a: world point (from reference camera), b: target camera point with pitch/roll applied }]
 * Pitch/roll are kept as set by hand – one person walking around mostly constrains the floor plane.
 */
export function solveYawTranslation(pairs) {
  const n = pairs.length;
  const mean = (f) => pairs.reduce((s, p) => s + f(p), 0) / n;
  const a0 = { x: mean((p) => p.a.x), y: mean((p) => p.a.y), z: mean((p) => p.a.z) };
  const b0 = { x: mean((p) => p.b.x), y: mean((p) => p.b.y), z: mean((p) => p.b.z) };
  let sin = 0;
  let cos = 0;
  for (const { a, b } of pairs) {
    const ax = a.x - a0.x, az = a.z - a0.z, bx = b.x - b0.x, bz = b.z - b0.z;
    sin += ax * bz - az * bx;
    cos += ax * bx + az * bz;
  }
  const th = Math.atan2(sin, cos);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const t = { x: a0.x - (c * b0.x + s * b0.z), y: a0.y - b0.y, z: a0.z - (-s * b0.x + c * b0.z) };
  let err = 0;
  for (const { a, b } of pairs) {
    err += (c * b.x + s * b.z + t.x - a.x) ** 2 + (-s * b.x + c * b.z + t.z - a.z) ** 2;
  }
  const spread = Math.sqrt(mean((p) => (p.a.x - a0.x) ** 2 + (p.a.z - a0.z) ** 2));
  return { yaw: th / D2R, x: t.x, y: t.y, z: t.z, rms: Math.sqrt(err / n), spread };
}
