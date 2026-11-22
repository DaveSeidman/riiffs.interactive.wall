import { integrateSmoothMotion } from "./smooth-motion.js";
import { cleanPeople, DEFAULT_WALL, makePerson } from "./body.js";
import { InteractionSystem } from "./interactions.js";
import { advanceSkyAngle, skyView } from "./sky.js";

export const CHANNEL = "lunar-tracking:world:v1";
export const POSE_FORMAT = "lunar-poses-v1";

export function validateClip(clip) {
  if (clip?.units && clip.units !== "metres")
    throw new Error("Pose coordinates must be in metres.");
  if (clip?.coordinates && clip.coordinates !== "x-right,y-down,z-forward")
    throw new Error("Unsupported pose coordinate system.");
  if (
    clip?.format !== POSE_FORMAT ||
    !Array.isArray(clip.frames) ||
    clip.frames.length < 2 ||
    clip.frames.length > 18000
  )
    throw new Error("Choose a Lunar pose recording with 2–18,000 frames.");
  let last = -1;
  const frames = clip.frames.map((f) => {
    if (!Number.isFinite(f.time) || f.time < 0 || f.time <= last)
      throw new Error("Frame timestamps must increase.");
    last = f.time;
    return { time: f.time, people: cleanPeople(f.people) };
  });
  const offset = frames[0].time;
  for (const f of frames) f.time -= offset;
  if (last - offset <= 0 || last - offset > 600000)
    throw new Error("Recording must be shorter than ten minutes.");
  if (clip.wall) {
    for (const key of Object.keys(DEFAULT_WALL))
      if (!Number.isFinite(clip.wall[key]))
        throw new Error("Invalid wall calibration.");
    if (
      clip.wall.width <= 0 ||
      clip.wall.height <= 0 ||
      clip.wall.near < 0 ||
      clip.wall.far <= clip.wall.near
    )
      throw new Error("Invalid wall dimensions or influence range.");
  }
  return { ...clip, frames, duration: last - offset };
}

export function sampleClip(clip, time) {
  const frames = clip.frames;
  let lo = 0,
    hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  const a = frames[lo],
    b = frames[Math.min(lo + 1, frames.length - 1)];
  if (a === b || b.time - a.time > 250) return a.people;
  const mix = Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)));
  return a.people.map((p) => {
    const q = b.people.find((v) => v.id === p.id);
    if (!q) return p;
    return {
      ...p,
      joints: p.joints.map((j, i) => {
        const k = q.joints[i];
        if (!j.p3 || !k.p3) return j;
        return {
          vis: Math.min(j.vis, k.vis),
          p3: Object.fromEntries(
            ["x", "y", "z"].map((axis) => [
              axis,
              j.p3[axis] + (k.p3[axis] - j.p3[axis]) * mix,
            ]),
          ),
        };
      }),
    };
  });
}

export class ExperienceEngine {
  constructor() {
    this.wall = { ...DEFAULT_WALL };
    this.source = "simulation";
    this.people = [];
    this.paused = false;
    this.time = 0;
    this.skyTime = 0;
    this.skyAngle = 0;
    this.skySpeed = 0.8;
    this.actualSkySpeed = 0.8;
    this.skyTravel = 0;
    this.rate = 1;
    this.interactions = new InteractionSystem();
    this.skyView = skyView(0, this.wall, this.interactions.moon);
    this.sim = {
      count: 2,
      motion: "wander",
      distance: 0.65,
      selected: 1,
      raised: {},
      positions: [
        { x: -1.6, distance: 0.65 },
        { x: 1.65, distance: 1.05 },
        { x: 0, distance: 1.7 },
        { x: -2.8, distance: 1.4 },
        { x: 2.8, distance: 1.4 },
        { x: 0.7, distance: 2 },
      ].map((p, i) => ({ ...p, id: i + 1 })),
    };
    this.livePeople = [];
    this.liveAt = -Infinity;
    this.liveCameraCount = 0;
    this.recording = null;
    this.clip = null;
    this.frames = 0;
    this.fps = 0;
    this.fpsTime = 0;
    this.lastCapture = -Infinity;
  }
  connect() {
    if (typeof BroadcastChannel === "undefined") return () => {};
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = ({ data }) => {
      if (data?.version !== 1 || data.type !== "frame") return;
      try {
        this.livePeople = cleanPeople(data.people);
        this.liveCameraCount = Number.isSafeInteger(data.cameraCount)
          ? data.cameraCount
          : data.people.length
            ? 1
            : 0;
        this.liveAt = performance.now();
      } catch {
        /* ignore malformed publishers */
      }
    };
    return () => channel.close();
  }
  setSource(source) {
    this.source = source;
    this.time = 0;
    this.people = [];
    this.paused = false;
    this.interactions.reset();
  }
  loadClip(value) {
    this.clip = validateClip(value);
    if (this.clip.wall)
      for (const k of Object.keys(DEFAULT_WALL))
        this.wall[k] = this.clip.wall[k];
    this.setSource("poses");
  }
  beginRecording() {
    this.recording = {
      format: POSE_FORMAT,
      units: "metres",
      coordinates: "x-right,y-down,z-forward",
      wall: { ...this.wall },
      frames: [],
    };
    this.captureStart = performance.now();
    this.lastCapture = -Infinity;
  }
  endRecording() {
    const clip = this.recording;
    this.recording = null;
    return clip;
  }
  step(dt, now = performance.now()) {
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsTime);
      this.frames = 0;
      this.fpsTime = 0;
    }
    if (!this.paused) {
      this.time += Math.min(dt, 0.1) * this.rate;
      this.skyTime += Math.min(dt, 0.1);
      const skyStep=integrateSmoothMotion(this,"actualSkySpeed",this.skySpeed,Math.min(dt,.1),1.5);
      this.skyTravel += skyStep * 0.01875;
      this.skyAngle = advanceSkyAngle(
        this.skyAngle,
        skyStep,
        1,
      );
    }
    if (this.source === "simulation") {
      this.people = Array.from({ length: this.sim.count }, (_, i) => {
        const p = this.sim.positions[i];
        const wandering = this.sim.motion === "wander" && !p.placed;
        const x =
          p.x + (wandering ? Math.sin(this.time * 0.25 + (p.id-1) * 2) * 0.55 : 0);
        const distance = Math.max(
          0.05,
          p.distance +
            (wandering ? Math.sin(this.time * 0.48 + (p.id-1) * 2.4) * 0.48 : 0),
        );
        p.floorX = x;
        p.floorDistance = distance;
        return makePerson(
          p.id,
          x,
          distance,
          this.time,
          this.wall,
          this.sim.raised[p.id]
            ? "offer"
            : this.sim.motion === "reach"
              ? "reach"
              : "walk",
        );
      });
    } else if (this.source === "live") {
      if (!this.paused)
        this.people = now - this.liveAt < 500 ? this.livePeople : [];
    } else if (this.clip) {
      const ms = this.clip.duration;
      this.time = ((this.time * 1000) % ms) / 1000;
      this.people = sampleClip(this.clip, this.time * 1000);
    }
    this.interactions.step(
      this.paused ? 0 : dt,
      this.people,
      this.wall,
      this.skyTravel,
    );
    this.skyView = skyView(this.skyTravel, this.wall, this.interactions.moon);
    if (
      this.recording &&
      now - this.captureStart < 600000 &&
      now - this.lastCapture >= 1000 / 30 &&
      this.recording.frames.length < 18000
    ) {
      this.recording.frames.push({
        time: now - this.captureStart,
        people: cleanPeople(this.people),
      });
      this.lastCapture = now;
    }
  }
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
