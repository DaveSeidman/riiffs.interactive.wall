// All sources use the existing WorldTracker convention: metres, X right, Y down, Z forward.
export const BONES = [
  [0, 11],
  [0, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];
export const MAX_PEOPLE = 6;
export const DEFAULT_WALL = {
  x: 0,
  y: 0,
  z: 4,
  yaw: 0,
  width: 8,
  height: 2.25,
  near: 0.15,
  far: 2.8,
};

export function projectJoint(p, wall) {
  const a = (wall.yaw * Math.PI) / 180;
  const dx = p.x - wall.x,
    dz = p.z - wall.z;
  return {
    x: Math.cos(a) * dx - Math.sin(a) * dz,
    y: wall.y - p.y,
    distance: Math.abs(Math.sin(a) * dx + Math.cos(a) * dz),
  };
}

export function proximity(distance, wall) {
  const t = Math.max(
    0,
    Math.min(1, (wall.far - distance) / Math.max(0.01, wall.far - wall.near)),
  );
  return t * t * (3 - 2 * t);
}

export function makePerson(id, x, distance, t, wall, gesture = "walk") {
  // Different statures, with a common floor: the smaller figures also sit lower in the field.
  const stature = [0.88, 0.8, 0.96, 0.84, 0.91, 0.86][(id - 1) % MAX_PEOPLE];
  const floor = 1.0;
  const step = Math.sin(t * 2.2 + id * 1.7);
  const sway = Math.sin(t * 0.85 + id) * 0.07;
  const wave = gesture === "reach" ? 0.8 + Math.sin(t * 1.6) * 0.2 : 0;
  const joints = Array.from({ length: 33 }, () => ({ p3: null, vis: 0 }));
  const positions = {
    0: [sway, -0.82, 0],
    11: [-0.22 + sway, -0.56, 0],
    12: [0.22 + sway, -0.56, 0],
    13: [-0.34 - wave * 0.25, -0.24 - wave * 0.65, step * 0.12],
    14: [0.36 + Math.sin(t + id) * 0.13, -0.25 - wave * 0.5, -step * 0.12],
    15: [-0.32 - wave * 0.4, 0.04 - wave * 1.1, step * 0.24 - wave * 0.3],
    16: [
      0.4 + Math.sin(t * 1.3 + id) * 0.22,
      -0.02 - wave * 1.05,
      -step * 0.24 - wave * 0.3,
    ],
    23: [-0.13, 0.03, 0],
    24: [0.13, 0.03, 0],
    25: [-0.15, 0.43, step * 0.13],
    26: [0.15, 0.43, -step * 0.13],
    27: [-0.2, 0.86, step * 0.25],
    28: [0.2, 0.86, -step * 0.25],
  };
  if (gesture === "offer") {
    positions[14] = [0.34, -0.48, -0.08];
    positions[16] = [0.48, -0.81, -0.12];
  }
  const a = (wall.yaw * Math.PI) / 180;
  for (const [i, [px, py, pz]] of Object.entries(positions)) {
    const localX = x + px * stature,
      localZ = -distance + pz * stature;
    joints[i] = {
      vis: 1,
      p3: {
        x: wall.x + Math.cos(a) * localX + Math.sin(a) * localZ,
        y: wall.y + (py - 0.86) * stature + floor,
        z: wall.z - Math.sin(a) * localX + Math.cos(a) * localZ,
      },
    };
  }
  return { id, joints, center: joints[23].p3, cams: [] };
}

export function cleanPeople(people) {
  if (!Array.isArray(people) || people.length > MAX_PEOPLE)
    throw new Error("Expected up to six people.");
  return people.map((p) => {
    if (
      !Number.isSafeInteger(p.id) ||
      !Array.isArray(p.joints) ||
      p.joints.length !== 33
    )
      throw new Error("Invalid skeleton frame.");
    const joints = p.joints.map((j) => {
      if (!j || !Number.isFinite(j.vis))
        throw new Error("Invalid joint confidence.");
      if (
        j.p3 &&
        !["x", "y", "z"].every(
          (k) => Number.isFinite(j.p3[k]) && Math.abs(j.p3[k]) < 1000,
        )
      )
        throw new Error("Invalid joint position.");
      return {
        vis: Math.max(0, Math.min(1, j.vis)),
        p3: j.p3 ? { x: j.p3.x, y: j.p3.y, z: j.p3.z } : null,
      };
    });
    return {
      id: p.id,
      joints,
      center: joints[23].p3,
      cams: Array.isArray(p.cams) ? p.cams.slice(0, 6) : [],
    };
  });
}

// Torso depth measures the person, rather than a hand briefly reaching forward.
export function bodyWallDistance(person, wall) {
  const points=[11,12,23,24].map(i=>person.joints[i])
    .filter(j=>j?.p3 && j.vis>=.4).map(j=>projectJoint(j.p3,wall));
  return points.length>=2 ? points.reduce((sum,p)=>sum+p.distance,0)/points.length : Infinity;
}
