import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WALL,
  cleanPeople,
  makePerson,
  projectJoint,
  proximity,
} from "../src/experience/body.js";
import {
  ExperienceEngine,
  POSE_FORMAT,
  sampleClip,
  validateClip,
} from "../src/experience/engine.js";
import { StereoReplay, validateSession } from "../src/session.js";

const almost = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);
const clip = () => ({
  format: POSE_FORMAT,
  frames: [
    { time: 500, people: [makePerson(1, 0, 0.5, 0, DEFAULT_WALL)] },
    { time: 700, people: [makePerson(1, 2, 0.5, 0, DEFAULT_WALL)] },
  ],
});

test("wall projection uses metres and perpendicular distance, including a rotated wall", () => {
  const q = projectJoint({ x: 2, y: -1, z: 3 }, DEFAULT_WALL);
  assert.deepEqual(q, { x: 2, y: 1, distance: 1 });
  const rotated = { ...DEFAULT_WALL, yaw: 90 };
  const p = projectJoint({ x: 2, y: 0, z: 3 }, rotated);
  almost(p.x, 1);
  almost(p.distance, 2);
});
test("influence grows smoothly toward the wall and disappears beyond cutoff", () => {
  almost(proximity(0, DEFAULT_WALL), 1);
  almost(proximity(10, DEFAULT_WALL), 0);
  let previous = 1;
  for (let d = 0; d < 4; d += 0.01) {
    const value = proximity(d, DEFAULT_WALL);
    assert.ok(value <= previous + 1e-9);
    previous = value;
  }
});
test("simulated skeletons have varied smaller statures and a shared lower floor", () => {
  const people = Array.from({ length: 6 }, (_, i) =>
    makePerson(i + 1, 0, 0.5, 0, DEFAULT_WALL),
  );
  const heights = people.map((p) => p.joints[27].p3.y - p.joints[0].p3.y);
  assert.equal(new Set(heights).size, 6);
  for (const p of people) {
    almost(p.joints[27].p3.y, 1);
    assert.equal(p.joints.length, 33);
  }
  for (const h of heights) assert.ok(h < 1.68 && h > 1.3);
});
test("simulation position and wall distance stay correct when the wall rotates", () => {
  const wall = { ...DEFAULT_WALL, x: 1, y: 0.5, z: 7, yaw: 48 };
  const p = makePerson(1, 2, 0.7, 0, wall);
  const left = projectJoint(p.joints[11].p3, wall),
    right = projectJoint(p.joints[12].p3, wall);
  almost((left.x + right.x) / 2, 2 + Math.sin(1) * 0.07 * 0.88);
  almost(left.distance, 0.7);
  almost(right.distance, 0.7);
});
test("pose imports reject malformed joints and nonfinite coordinates", () => {
  assert.throws(() => cleanPeople([{ id: 1, joints: [] }]), /skeleton/);
  const person = makePerson(1, 0, 0.5, 0, DEFAULT_WALL);
  person.joints[0].p3.z = NaN;
  assert.throws(() => cleanPeople([person]), /position/);
  assert.throws(() => cleanPeople(Array(7).fill(person)), /six/);
});
test("pose clips normalize timestamps and interpolate persistent IDs", () => {
  const value = validateClip(clip());
  assert.equal(value.frames[0].time, 0);
  assert.equal(value.duration, 200);
  const people = sampleClip(value, 100);
  almost(
    people[0].joints[23].p3.x,
    value.frames[0].people[0].joints[23].p3.x + 1,
  );
});
test("pose clips reject nonmonotonic time, wrong units, and invalid wall calibration", () => {
  const bad = clip();
  bad.frames[1].time = bad.frames[0].time;
  assert.throws(() => validateClip(bad), /timestamps/);
  assert.throws(
    () => validateClip({ ...clip(), units: "millimetres" }),
    /metres/,
  );
  assert.throws(
    () => validateClip({ ...clip(), wall: { ...DEFAULT_WALL, width: -1 } }),
    /dimensions/,
  );
});
test("playback loops, pause freezes time, and changing sources clears the old frame", () => {
  const engine = new ExperienceEngine();
  engine.loadClip(clip());
  engine.time = 0.19;
  engine.step(0.05, 100);
  almost(engine.time, 0.04);
  engine.paused = true;
  const position = engine.people[0].joints[23].p3.x;
  engine.step(0.05, 200);
  almost(engine.time, 0.04);
  almost(engine.people[0].joints[23].p3.x, position);
  engine.setSource("live");
  assert.deepEqual(engine.people, []);
  assert.equal(engine.paused, false);
});
test("live input drops stale people and pausing freezes the current pose", () => {
  const engine = new ExperienceEngine();
  engine.setSource("live");
  engine.livePeople = [makePerson(1, 0, 0.5, 0, DEFAULT_WALL)];
  engine.liveAt = 100;
  engine.step(0.016, 200);
  assert.equal(engine.people.length, 1);
  engine.paused = true;
  engine.step(0.016, 1000);
  assert.equal(engine.people.length, 1);
  engine.paused = false;
  engine.step(0.016, 1016);
  assert.equal(engine.people.length, 0);
});
test("pose capture stores independent snapshots instead of mutable joint references", () => {
  const engine = new ExperienceEngine();
  engine.beginRecording();
  engine.step(0.016, engine.captureStart + 40);
  const capture = engine.recording.frames[0].people[0].joints[23].p3.x;
  engine.people[0].joints[23].p3.x = 100;
  assert.equal(engine.recording.frames[0].people[0].joints[23].p3.x, capture);
  const recording = engine.endRecording();
  assert.equal(recording.format, POSE_FORMAT);
  assert.equal(engine.recording, null);
});

const metadata = () => [
  {
    file: "camera-0.webm",
    offset: 0.1,
    duration: 4,
    extr: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 },
  },
  {
    file: "camera-1.webm",
    offset: 0.3,
    duration: 3.8,
    extr: { x: 2, y: 0, z: 0, yaw: 10, pitch: 0, roll: 0 },
  },
];
test("stereo sessions validate independent recordings and timing", () => {
  assert.equal(
    validateSession({ format: "lunar-stereo-v1", cameras: metadata() }).cameras
      .length,
    2,
  );
  const bad = metadata();
  bad[1].file = bad[0].file;
  assert.throws(
    () => validateSession({ format: "lunar-stereo-v1", cameras: bad }),
    /distinct/,
  );
});
class FakeVideo extends EventTarget {
  _time = 0;
  paused = true;
  playbackRate = 1;
  set currentTime(value) {
    this._time = value;
    queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
  }
  get currentTime() {
    return this._time;
  }
  pause() {
    this.paused = true;
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
}
test("stereo replay seeks both videos to the common clock and pauses together", async () => {
  const cameras = [0, 1].map(() => ({
    video: new FakeVideo(),
    latest: {},
    tracks: [],
    tracker: { tracks: [] },
    globalIds: new Map(),
  }));
  let resets = 0;
  const replay = new StereoReplay(
    cameras,
    metadata(),
    () => resets++,
    (error) => {
      throw error;
    },
  );
  try {
    almost(replay.duration, 3.8);
    await replay.seek(1);
    almost(cameras[0].video.currentTime, 1.2);
    almost(cameras[1].video.currentTime, 1);
    assert.equal(resets, 1);
    assert.ok(cameras.every((c) => c.latest === null));
    await replay.play();
    assert.ok(cameras.every((c) => !c.video.paused));
    replay.pause();
    assert.ok(cameras.every((c) => c.video.paused));
  } finally {
    replay.dispose();
  }
});
