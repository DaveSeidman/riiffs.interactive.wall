import test from "node:test";
import assert from "node:assert/strict";
import { ZedCamera } from "../src/camera.js";
import { buildCalib } from "../src/calib.js";
import { DEFAULT_EXTRINSICS, extrinsicsToPose } from "../src/fusion.js";
import {
  sensorImagePoint,
  uprightCameraPoint,
  drawPoseFrame,
} from "../src/orientation.js";
import { StereoRecorder, validateSession } from "../src/session.js";

const almost = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("a 180-degree input correction maps normalized landmarks to the original sensor pixels", () => {
  const p = { x: 0.2, y: 0.3 };
  assert.deepEqual(sensorImagePoint(p, false), p);
  assert.deepEqual(sensorImagePoint(p, true), { x: 0.8, y: 0.7 });
  for (const [x, y] of [
    [0, 0],
    [1, 1],
    [0.123, 0.987],
  ]) {
    const raw = sensorImagePoint({ x, y }, true);
    almost(raw.x * 1280 - 0.5, 1279 - (x * 1280 - 0.5));
    almost(raw.y * 720 - 0.5, 719 - (y * 720 - 0.5));
  }
  assert.deepEqual(uprightCameraPoint({ x: 1, y: -2, z: 3 }, true), {
    x: -1,
    y: 2,
    z: 3,
  });
});

test("inverted-camera lifting looks up raw disparity but keeps upright overlays and world axes", () => {
  const calib = buildCalib(null, "HD", 1280, 720);
  // Deliberately off-centre principal point: flipping the pixels alone is not enough.
  calib.rect.cx = 620;
  calib.rect.cy = 352;
  for (const eye of [calib.left, calib.right]) {
    eye.cx = 620;
    eye.cy = 352;
  }
  const samples = [];
  const camera = {
    calib,
    eyeW: 1280,
    eyeH: 720,
    upsideDown: true,
    worldPose: extrinsicsToPose({ ...DEFAULT_EXTRINSICS, x: 2, y: 1 }),
    stereo: {
      procW: 320,
      focalProc: 150,
      sampleDisparity(x, y) {
        samples.push([x, y]);
        return 6;
      },
    },
  };
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.2,
    y: 0.3,
    visibility: 1,
  }));
  const person = ZedCamera.prototype.lift.call(camera, landmarks);
  const z = (150 * calib.baseline) / 6,
    joint = person.joints[0];
  almost(samples[0][0], 0.8 * 320 - 0.5);
  almost(samples[0][1], 0.7 * 180 - 0.5);
  almost(joint.p3.x, (-(1023.5 - 620) / calib.rect.f) * z);
  almost(joint.p3.y, (-(503.5 - 352) / calib.rect.f) * z);
  almost(joint.p3.z, z);
  almost(joint.w.x, joint.p3.x + 2);
  almost(joint.w.y, joint.p3.y + 1);
  assert.equal(joint.x, 0.2);
  assert.equal(joint.y, 0.3);
  assert.equal(joint.rejected, false);
});

test("pose correction rotates only the calibrated left-eye crop and restores the canvas", () => {
  const calls = [],
    video = {};
  const ctx = Object.fromEntries(
    ["save", "translate", "rotate", "drawImage", "restore"].map((k) => [
      k,
      (...args) => calls.push([k, ...args]),
    ]),
  );
  drawPoseFrame(ctx, video, 1280, 720, 960, 540, true);
  assert.deepEqual(calls, [
    ["save"],
    ["translate", 960, 540],
    ["rotate", Math.PI],
    ["drawImage", video, 0, 0, 1280, 720, 0, 0, 960, 540],
    ["restore"],
  ]);
});

test("orientation changes clear stale tracks and persist per device without changing placement", () => {
  const cam = Object.create(ZedCamera.prototype);
  Object.assign(cam, {
    upsideDown: false,
    playback: false,
    rev: 0,
    latest: {},
    people: [{}],
    tracks: [{}],
    ignoredTracks: [{}],
    globalIds: new Map([[1, 1]]),
    settings: { mc2: 1.5, mc3: 0.6, beta: 0.5 },
    extr: { ...DEFAULT_EXTRINSICS },
    overlay: { width: 960, height: 540 },
    ovCtx: { clearRect() {} },
    updateOrientationPreview() {},
    _save() {
      this.saved = true;
    },
  });
  cam.setUpsideDown(true);
  assert.equal(cam.saved, true);
  assert.equal(cam.latest, null);
  assert.equal(cam.tracks.length, 0);
  assert.equal(cam.globalIds.size, 0);
  assert.equal(cam.tracker.params.beta, 0.5);
  assert.deepEqual(cam.extr, DEFAULT_EXTRINSICS);
  assert.equal(cam.rev, 1);
});

test("stereo recordings keep raw streams and store orientation, with backwards-compatible replay metadata", () => {
  const previous = globalThis.MediaRecorder;
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    constructor(stream) {
      this.stream = stream;
      this.state = "inactive";
    }
    start() {
      this.state = "recording";
      this.onstart?.();
    }
    stop() {
      this.state = "inactive";
      this.onstop?.();
    }
  }
  globalThis.MediaRecorder = Recorder;
  let recording;
  try {
    const stream = { active: true };
    recording = new StereoRecorder(
      [
        {
          stream,
          upsideDown: true,
          label: "Camera 2",
          model: "ZED 2",
          extr: { ...DEFAULT_EXTRINSICS },
          resolveConf: () => null,
          capW: 2560,
          capH: 720,
        },
      ],
      {},
      () => {},
    );
    assert.equal(recording.entries[0].recorder.stream, stream);
    const camera = { ...recording.entries[0].metadata, offset: 0, duration: 1 };
    assert.equal(camera.upsideDown, true);
    const session = { format: "lunar-stereo-v1", cameras: [camera] };
    assert.equal(validateSession(session).cameras[0].upsideDown, true);
    assert.throws(
      () =>
        validateSession({
          ...session,
          cameras: [{ ...camera, upsideDown: "true" }],
        }),
      /orientation/,
    );
    delete camera.upsideDown;
    assert.doesNotThrow(() => validateSession(session));
  } finally {
    clearTimeout(recording?.limitTimer);
    recording?.entries.forEach((e) => e.recorder.stop());
    globalThis.MediaRecorder = previous;
  }
});
