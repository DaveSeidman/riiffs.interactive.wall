// Persistent person IDs + One Euro smoothing of 2D and 3D joints.
//
// MediaPipe returns people in arbitrary order each frame, so we match detections to existing
// tracks by torso position, then run a One Euro filter per joint per axis on each track.
// Each track keeps a velocity, and matching compares new detections against where the track is
// predicted to be now (last position + velocity × elapsed time), not where it was last seen.
// New tracks must be seen a few times before they count ("confirmed"), and tracks whose body
// size is consistently implausible are hidden (see filters.js).
// One Euro (Casiez et al. 2012): a low-pass filter whose cutoff rises with speed, so slow
// motion is heavily smoothed (no jitter) while fast motion stays responsive (little lag).

const N_JOINTS = 33;
const TORSO = [11, 12, 23, 24];
const MIN_VIS = 0.5;

const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

export class OneEuro {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }

  filter(v, dt, minCutoff, beta, dCutoff = 1) {
    if (this.x == null) {
      this.x = v;
      this.dx = 0;
      return v;
    }
    const d = (v - this.x) / dt;
    this.dx += alpha(dCutoff, dt) * (d - this.dx);
    const cutoff = minCutoff + beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

function center2D(joints) {
  let pts = TORSO.map((i) => joints[i]).filter((j) => j.vis >= MIN_VIS);
  if (!pts.length) pts = joints.filter((j) => j.vis >= MIN_VIS);
  if (!pts.length) return null;
  return {
    x: pts.reduce((s, j) => s + j.x, 0) / pts.length,
    y: pts.reduce((s, j) => s + j.y, 0) / pts.length,
  };
}

const PREDICT_MAX_S = 0.3; // never extrapolate further than this

/** Constant-velocity motion model for a track centre (any 2 axes). */
class Motion {
  constructor(ax, ay) {
    Object.assign(this, { ax, ay, pos: null, vel: { x: 0, y: 0 }, t: 0 });
  }

  observe(c, t) {
    const { ax, ay } = this;
    if (this.pos) {
      const dt = (t - this.t) / 1000;
      if (dt > 0 && dt < 0.25) {
        this.vel.x = this.vel.x * 0.5 + ((c[ax] - this.pos.x) / dt) * 0.5;
        this.vel.y = this.vel.y * 0.5 + ((c[ay] - this.pos.y) / dt) * 0.5;
      } else {
        this.vel = { x: 0, y: 0 };
      }
    }
    this.pos = { x: c[ax], y: c[ay] };
    this.t = t;
  }

  predict(t) {
    if (!this.pos) return null;
    const dt = Math.min(PREDICT_MAX_S, Math.max(0, (t - this.t) / 1000));
    return { x: this.pos.x + this.vel.x * dt, y: this.pos.y + this.vel.y * dt };
  }
}

class Track {
  constructor(id) {
    this.id = id;
    this.lastSeen = -Infinity;
    this.motion = new Motion('x', 'y');
    this.hits = 0;
    this.oddSize = 0; // 0..1, recent fraction of frames with an implausible body size
    this.hidden = false;
    this.size = null;
    this.last2D = null;
    this.center = null;
    this.dist = null;
    this.f2 = Array.from({ length: N_JOINTS }, () => [new OneEuro(), new OneEuro()]);
    this.f3 = Array.from({ length: N_JOINTS }, () => [new OneEuro(), new OneEuro(), new OneEuro()]);
    this.seen3 = new Array(N_JOINTS).fill(-Infinity);
    this.joints = Array.from({ length: N_JOINTS }, () => ({ x: 0, y: 0, vis: 0, p3: null }));
  }

  update(person, t, p) {
    const dt = this.last2D == null ? 1 / 30 : Math.max(1e-3, (t - this.last2D) / 1000);
    const first = this.last2D == null;
    this.last2D = t;
    this.lastSeen = t;
    this.hits++;
    const c = center2D(person.joints);
    if (c) this.motion.observe(c, t);
    if (person.size != null) this.size = person.size;
    if (person.oddSize != null) {
      // start part-way so a projection hides within a few frames, but one bad depth reading
      // on a real person never does; hysteresis stops it flickering at the threshold
      const v = person.oddSize ? 1 : 0;
      this.oddSize = first ? v * 0.5 : this.oddSize * 0.85 + v * 0.15;
      if (this.oddSize > 0.6) this.hidden = true;
      else if (this.oddSize < 0.3) this.hidden = false;
    }

    person.joints.forEach((j, i) => {
      const s = this.joints[i];
      s.x = this.f2[i][0].filter(j.x, dt, p.minCutoff2D, p.beta);
      s.y = this.f2[i][1].filter(j.y, dt, p.minCutoff2D, p.beta);
      s.vis = first ? j.vis : s.vis * 0.6 + j.vis * 0.4;

      if (j.p3 && !j.rejected) {
        const gap = t - this.seen3[i];
        if (gap > p.hold3DMs) this.f3[i].forEach((f) => f.reset());
        const dt3 = gap > p.hold3DMs ? 1 / 30 : Math.max(1e-3, gap / 1000);
        s.p3 = {
          x: this.f3[i][0].filter(j.p3.x, dt3, p.minCutoff3D, p.beta),
          y: this.f3[i][1].filter(j.p3.y, dt3, p.minCutoff3D, p.beta),
          z: this.f3[i][2].filter(j.p3.z, dt3, p.minCutoff3D, p.beta),
        };
        this.seen3[i] = t;
      } else if (t - this.seen3[i] > p.hold3DMs) {
        s.p3 = null; // hold the last 3D position briefly through dropouts, then let go
      }
    });

    this.center = center2D(this.joints);
    this.confirmed ||= this.hits >= p.minHits;
    const torsoZ = TORSO.map((i) => this.joints[i].p3?.z).filter((z) => z != null).sort((a, b) => a - b);
    this.dist = torsoZ.length ? torsoZ[torsoZ.length >> 1] : null;
  }
}

export class PoseTracker {
  constructor() {
    this.tracks = [];
    this.nextId = 1;
    this.params = {
      minCutoff2D: 1.5, // Hz
      minCutoff3D: 0.6, // Hz – depth is noisier than 2D, so smooth harder by default
      beta: 0.5,
      maxJump: 0.2, // max torso movement (normalised image units) to still count as the same person
      maxAgeMs: 400, // drop a track after this long without a detection
      hold3DMs: 300,
      minHits: 3, // detections before a new track is shown / fused (filters one-frame ghosts)
    };
  }

  /** Match detections to tracks, update filters, and tag each detection with `trackId`. */
  update(people, t) {
    const p = this.params;
    const dets = people.map((person) => ({ person, c: center2D(person.joints) })).filter((d) => d.c);

    const pairs = [];
    for (const track of this.tracks) {
      const at = track.motion.predict(t);
      if (!at) continue;
      for (const det of dets) {
        const dist = Math.hypot(det.c.x - at.x, det.c.y - at.y);
        if (dist < p.maxJump) pairs.push({ track, det, dist });
      }
    }
    pairs.sort((a, b) => a.dist - b.dist);

    const usedTracks = new Set();
    const usedDets = new Set();
    for (const { track, det } of pairs) {
      if (usedTracks.has(track) || usedDets.has(det)) continue;
      usedTracks.add(track);
      usedDets.add(det);
      track.update(det.person, t, p);
      det.person.trackId = track.id;
    }
    for (const det of dets) {
      if (usedDets.has(det)) continue;
      const track = new Track(this.nextId++);
      track.update(det.person, t, p);
      det.person.trackId = track.id;
      this.tracks.push(track);
    }

    this.tracks = this.tracks.filter((tr) => t - tr.lastSeen <= p.maxAgeMs);
    return this.tracks;
  }
}

// ------------------------------------------------------------------------------------------
// World-space tracker for fused multi-camera people. Identity comes from where a person is
// standing (X/Z on the floor), not from which camera saw them, so IDs survive hand-offs.

class WorldTrack {
  constructor(id) {
    this.id = id;
    this.lastSeen = -Infinity;
    this.center = null;
    this.cams = [];
    this.motion = new Motion('x', 'z');
    this.f = Array.from({ length: N_JOINTS }, () => [new OneEuro(), new OneEuro(), new OneEuro()]);
    this.seen = new Array(N_JOINTS).fill(-Infinity);
    this.joints = Array.from({ length: N_JOINTS }, () => ({ p3: null, vis: 0 }));
  }

  update(person, t, p) {
    const first = this.lastSeen === -Infinity;
    this.lastSeen = t;
    this.cams = person.cams;
    this.motion.observe(person.center, t);
    person.joints.forEach((j, i) => {
      const s = this.joints[i];
      s.vis = first ? j.vis : s.vis * 0.6 + j.vis * 0.4;
      if (j.w) {
        const gap = t - this.seen[i];
        if (gap > p.hold3DMs) this.f[i].forEach((f) => f.reset());
        const dt = gap > p.hold3DMs ? 1 / 30 : Math.max(1e-3, gap / 1000);
        s.p3 = {
          x: this.f[i][0].filter(j.w.x, dt, p.minCutoff, p.beta),
          y: this.f[i][1].filter(j.w.y, dt, p.minCutoff, p.beta),
          z: this.f[i][2].filter(j.w.z, dt, p.minCutoff, p.beta),
        };
        this.seen[i] = t;
      } else if (t - this.seen[i] > p.hold3DMs) {
        s.p3 = null;
      }
    });
    const torso = TORSO.map((i) => this.joints[i].p3).filter(Boolean);
    this.center = torso.length
      ? {
          x: torso.reduce((a, q) => a + q.x, 0) / torso.length,
          y: torso.reduce((a, q) => a + q.y, 0) / torso.length,
          z: torso.reduce((a, q) => a + q.z, 0) / torso.length,
        }
      : person.center;
  }
}

export class WorldTracker {
  constructor() {
    this.tracks = [];
    this.nextId = 1;
    this.params = {
      minCutoff: 0.6, // Hz
      beta: 0.5,
      maxJump: 0.8, // m on the floor between updates to still count as the same person
      maxAgeMs: 700, // keep a lost track this long (bridges gaps during camera hand-off)
      hold3DMs: 300,
    };
  }

  /** people: fused people with `.center` (world). Tags each with `globalId`. */
  update(people, t) {
    const p = this.params;
    const pairs = [];
    for (const track of this.tracks) {
      if (t - track.lastSeen > p.maxAgeMs) continue;
      const at = track.motion.predict(t);
      for (const person of people) {
        const d = Math.hypot(person.center.x - at.x, person.center.z - at.y);
        // A confirmed image-space track survives stereo depth jumps that
        // would otherwise spawn a second world ID for the same skeleton.
        const continuity = person.members?.some(({ camera, person: detection }) =>
          camera?.globalIds?.get(detection.trackId) === track.id
        ) ?? false;
        if (continuity || d < p.maxJump) pairs.push({ track, person, d, continuity });
      }
    }
    pairs.sort((a, b) => Number(b.continuity) - Number(a.continuity) || a.d - b.d);
    const usedT = new Set();
    const usedP = new Set();
    for (const { track, person } of pairs) {
      if (usedT.has(track) || usedP.has(person)) continue;
      usedT.add(track);
      usedP.add(person);
      track.update(person, t, p);
      person.globalId = track.id;
    }
    for (const person of people) {
      if (usedP.has(person)) continue;
      const track = new WorldTrack(this.nextId++);
      track.update(person, t, p);
      person.globalId = track.id;
      this.tracks.push(track);
    }
    this.tracks = this.tracks.filter((tr) => t - tr.lastSeen <= p.maxAgeMs);
    return this.tracks;
  }
}
