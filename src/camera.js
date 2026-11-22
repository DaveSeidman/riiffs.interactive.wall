// One ZED camera: capture, stereo depth, pose, per-camera tracking, calibration + placement.
// Each camera runs on its own video frame callback; main.js fuses their latest results.

import { StereoDepth } from "./stereo.js";
import {
  parseConf,
  buildCalib,
  modeForWidth,
  modelFromLabel,
  rawToRect,
} from "./calib.js";
import { createPose } from "./pose.js";
import { PoseTracker } from "./tracking.js";
import {
  DEFAULT_EXTRINSICS,
  extrinsicsToPose,
  toWorld,
  torsoCenter,
} from "./fusion.js";
import { MIN_VIS, colorForId, drawLabel, drawSkeleton } from "./draw.js";
import { mergeDuplicates, bodySizeM } from "./filters.js";
import {
  sensorImagePoint,
  uprightCameraPoint,
  drawPoseFrame,
} from "./orientation.js";

const LIMB_REACH_M = 1.0; // joints further than this from torso depth are treated as depth outliers
const TORSO = [11, 12, 23, 24];
const storeKey = (deviceId) => `zed-testing:cam:${deviceId}`;

function html(str) {
  const t = document.createElement("template");
  t.innerHTML = str.trim();
  return t.content.firstElementChild;
}

export class ZedCamera {
  /**
   * @param settings shared, live settings object (resolution, depth, pose, smoothing…)
   * @param hooks { catalog(): calibration entries, status(msg, isError), onFrame(cam) }
   */
  constructor(index, settings, hooks) {
    Object.assign(this, { index, settings, hooks });
    this.deviceId = "";
    this.label = "";
    this.model = "ZED 2";
    this.calibChoice = "auto";
    this.custom = null; // { name, text } of an uploaded .conf
    // Installation defaults for the two upright, lower-mounted cameras.
    // Positive pitch follows the fusion convention and tilts the optical axis down.
    const installed = index < 2;
    const installExtrinsics = installed
      ? { x: index === 0 ? -2.8 : 2.8, yaw: 0, pitch: 2 }
      : { x: -4.3, yaw: 30, pitch: 10 };
    this.defaults = {
      upsideDown: !installed,
      extr: { ...DEFAULT_EXTRINSICS, ...installExtrinsics },
      imageBrightness: [1, 1.8][index] ?? 2.5,
      imageContrast: [0.8, 0.9][index] ?? 0.7,
    };
    this.upsideDown = this.defaults.upsideDown;
    this.extr = { ...this.defaults.extr };
    this.imageBrightness = this.defaults.imageBrightness;
    this.imageContrast = this.defaults.imageContrast;
    this.worldPose = extrinsicsToPose(this.extr);
    this.rev = 0; // bumped on programmatic changes so the Leva panel re-syncs

    this.stream = null;
    this.playback = false;
    this.playbackUrl = null;
    this.playbackConf = null;
    this.generation = 0;
    this.track = null;
    this.rvfc = null;
    this.capW = this.capH = this.eyeW = this.eyeH = 0;
    this.calib = null;
    this.calibSource = "";

    this.landmarker = null;
    this.poseKey = "";
    this.poseLoading = false;
    this.poseMs = 0;
    this.lastTs = 0;

    this.frames = 0;
    this.fps = 0;
    this.seq = 0;
    this.fusedSeq = -1;
    this.people = [];
    this.tracks = [];
    this.ignoredTracks = [];
    this.mergedCount = 0; // duplicates merged since the last stats tick
    this.latest = null;
    this.tracker = new PoseTracker();
    Object.assign(this.tracker.params, {
      minCutoff2D: settings.mc2,
      minCutoff3D: settings.mc3,
      beta: settings.beta,
    });
    this.globalIds = new Map(); // per-camera track id -> fused world id

    this.posePanel = html(`
      <section class="panel pose-panel">
        <h2>Camera ${index + 1} <span class="cam-label">–</span></h2>
        <div class="stack"><canvas class="pose"></canvas><canvas class="overlay"></canvas>
          <span class="pose-check" role="img" hidden></span>
        </div>
        <video playsinline muted hidden></video>
      </section>`);
    document.getElementById("poseGrid").append(this.posePanel);
    this.depthPanel = html(`<section class="panel depth-panel">
      <h2>Camera ${index + 1} depth</h2>
      <canvas class="depth" aria-label="Camera ${index + 1} depth preview"></canvas>
    </section>`);
    document.getElementById("depthGrid").append(this.depthPanel);

    this.video = this.posePanel.querySelector("video");
    this.depthCanvas = this.depthPanel.querySelector(".depth");
    this.poseCheck = this.posePanel.querySelector(".pose-check");
    this.poseCanvas = this.posePanel.querySelector("canvas.pose");
    this.poseCtx = this.poseCanvas.getContext("2d");
    this.overlay = this.posePanel.querySelector("canvas.overlay");
    this.ovCtx = this.overlay.getContext("2d");

    this.stereo = null;
    try {
      this.stereo = new StereoDepth(this.depthCanvas);
      for (const k of Object.keys(this.stereo.params))
        if (k in settings) this.stereo.params[k] = settings[k];
    } catch (e) {
      hooks.status(`Camera ${index + 1}: depth disabled – ${e.message}`, true);
    }

    this._onFrame = this._onFrame.bind(this);
    this.video.addEventListener("resize", () => {
      if (
        this.video.videoWidth !== this.capW ||
        this.video.videoHeight !== this.capH
      )
        this.reconfigure();
    });
  }

  // ------------------------------------------------------------------ persistence (per device)

  _load() {
    let s = null;
    try {
      s = JSON.parse(localStorage.getItem(storeKey(this.deviceId)) || "null");
    } catch {
      /* storage unavailable */
    }
    const installationCalib = this.index < 2 && this.model === "ZED 2i"
      ? "SN34308790.conf" : "auto";
    this.calibChoice = s?.calibChoice ?? installationCalib;
    this.custom = s?.custom ?? null;
    this.upsideDown =
      typeof s?.upsideDown === "boolean"
        ? s.upsideDown
        : this.defaults.upsideDown;
    this.updateOrientationPreview();
    this.extr = { ...this.defaults.extr, ...(s?.extr ?? {}) };
    // Older profiles saved the former level-mount default along with every slider edit.
    const migratePitch = s?.placementVersion == null && s?.extr?.pitch === 0
      && this.index < 2 && /zed/i.test(this.label);
    if (migratePitch) this.extr.pitch = this.defaults.extr.pitch;
    this.imageBrightness = Number.isFinite(s?.imageBrightness)
      ? s.imageBrightness
      : this.defaults.imageBrightness;
    this.imageContrast = Number.isFinite(s?.imageContrast)
      ? s.imageContrast
      : this.defaults.imageContrast;
    this.worldPose = extrinsicsToPose(this.extr);
    this.updateImageAdjustments();
    if (migratePitch) this._save();
  }

  _save() {
    if (!this.deviceId) return;
    try {
      localStorage.setItem(
        storeKey(this.deviceId),
        JSON.stringify({
          calibChoice: this.calibChoice,
          custom: this.custom,
          upsideDown: this.upsideDown,
          placementVersion: 1,
          extr: this.extr,
          imageBrightness: this.imageBrightness,
          imageContrast: this.imageContrast,
        }),
      );
    } catch {
      /* storage unavailable */
    }
  }

  // ------------------------------------------------------------------ lifecycle

  async start(deviceId, label = "") {
    this.stop();
    this.deviceId = deviceId || "";
    this.label = label;
    this.model = modelFromLabel(label);
    this._load();
    this.rev++;
    this.posePanel.querySelector(".cam-label").textContent = this.deviceId
      ? `${label}`
      : "off";
    if (!this.deviceId) {
      this.ovCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
      this.poseCtx.clearRect(
        0,
        0,
        this.poseCanvas.width,
        this.poseCanvas.height,
      );
      return;
    }

    const [size, fps] = this.settings.res.split("@");
    const [w, h] = size.split("x").map(Number);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: { exact: this.deviceId },
          width: { exact: w },
          height: { exact: h },
          frameRate: { ideal: Number(fps) },
        },
      });
    } catch (e) {
      this.hooks.status(
        `Camera ${this.index + 1}: couldn't open ${w}×${h} exactly (${e.name}) – using the closest mode.`,
        true,
      );
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: { exact: this.deviceId },
          width: { ideal: w },
          height: { ideal: h },
        },
      });
    }
    this.stream = stream;
    this.track = stream.getVideoTracks()[0];
    this.video.srcObject = stream;
    await this.video.play();
    if (!this.video.videoWidth)
      await new Promise((r) =>
        this.video.addEventListener("loadedmetadata", r, { once: true }),
      );

    this.reconfigure();
    this.rvfc = this.video.requestVideoFrameCallback(this._onFrame);
    this.ensurePose();
  }

  stop() {
    this.generation++;
    if (this.rvfc != null) this.video.cancelVideoFrameCallback(this.rvfc);
    this.rvfc = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.video.pause();
    this.video.srcObject = null;
    this.video.removeAttribute("src");
    if (this.playbackUrl) URL.revokeObjectURL(this.playbackUrl);
    this.playbackUrl = null;
    this.playback = false;
    this.playbackConf = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.poseKey = "";
    this.latest = null;
    this.people = [];
    this.tracks = [];
    this.tracker = new PoseTracker();
    Object.assign(this.tracker.params, {
      minCutoff2D: this.settings.mc2,
      minCutoff3D: this.settings.mc3,
      beta: this.settings.beta,
    });
    this.globalIds.clear();
  }

  async startPlayback(blob, metadata) {
    this.stop();
    this.playback = true;
    this.deviceId = `recording:${this.index}`;
    this.label = metadata.label || `Recorded camera ${this.index + 1}`;
    this.model = metadata.model || "ZED 2";
    this.upsideDown = metadata.upsideDown === true;
    this.imageBrightness = Number.isFinite(metadata.imageBrightness)
      ? metadata.imageBrightness
      : this.defaults.imageBrightness;
    this.imageContrast = Number.isFinite(metadata.imageContrast)
      ? metadata.imageContrast
      : this.defaults.imageContrast;
    this.updateImageAdjustments();
    this.updateOrientationPreview();
    this.extr = { ...DEFAULT_EXTRINSICS, ...metadata.extr };
    this.worldPose = extrinsicsToPose(this.extr);
    this.playbackConf = metadata.calibration
      ? { name: "Recorded calibration", conf: metadata.calibration }
      : null;
    this.rev++;
    this.posePanel.querySelector(".cam-label").textContent =
      `${this.label} (replay)`;
    this.playbackUrl = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.video.removeEventListener("loadedmetadata", loaded);
        this.video.removeEventListener("error", failed);
      };
      const loaded = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(
          new Error(`Cannot decode ${this.label}. Try recording with Chrome.`),
        );
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Video metadata timed out."));
      }, 15000);
      this.video.addEventListener("loadedmetadata", loaded);
      this.video.addEventListener("error", failed);
      this.video.src = this.playbackUrl;
      this.video.load();
    });
    this.reconfigure();
    this.rvfc = this.video.requestVideoFrameCallback(this._onFrame);
    this.ensurePose();
  }

  // ------------------------------------------------------------------ calibration + placement

  resolveConf() {
    if (this.playback) return this.playbackConf;
    const cat = this.hooks.catalog();
    switch (this.calibChoice) {
      case "none":
        return null;
      case "custom":
        return this.custom
          ? { name: this.custom.name, conf: parseConf(this.custom.text) }
          : null;
      case "auto": {
        const m = cat.filter((e) => e.model === this.model);
        return m.length === 1 ? { name: m[0].file, conf: m[0].conf } : null;
      }
      default: {
        const e = cat.find((x) => x.file === this.calibChoice);
        return e ? { name: e.file, conf: e.conf } : null;
      }
    }
  }

  reconfigure() {
    const capW = this.video.videoWidth;
    const capH = this.video.videoHeight;
    if (!capW || !capH) return;
    Object.assign(this, { capW, capH, eyeW: capW / 2, eyeH: capH });

    const src = this.resolveConf();
    this.calibSource = src?.name ?? "";
    this.calib = buildCalib(
      src?.conf ?? null,
      modeForWidth(capW),
      this.eyeW,
      this.eyeH,
      this.model,
    );

    const procW = Math.min(this.settings.procW, this.eyeW);
    const procH = Math.round((procW * this.eyeH) / this.eyeW);
    this.stereo?.configure({ capW, capH, procW, procH, calib: this.calib });
    this.depthCanvas.title = `Camera ${this.index + 1} · depth ${procW}×${procH}`;

    const pw = Math.min(960, this.eyeW);
    const ph = Math.round((pw * this.eyeH) / this.eyeW);
    this.poseCanvas.width = this.overlay.width = pw;
    this.poseCanvas.height = this.overlay.height = ph;
  }

  setCalibChoice(choice) {
    this.calibChoice = choice;
    this._save();
    this.reconfigure();
  }

  updateOrientationPreview() {
    // These transforms affect display only. Raw video capture, calibration and
    // disparity lookup retain their original sensor coordinates and eye order.
    const transform = this.upsideDown ? "rotate(180deg)" : "";
    this.video.style.transform = transform;
    this.depthCanvas.style.transform = transform;
  }

  updateImageAdjustments() {
    const filter = `brightness(${this.imageBrightness}) contrast(${this.imageContrast})`;
    this.video.style.filter = filter;
  }

  setImageAdjustments(patch) {
    if (Number.isFinite(patch.brightness)) this.imageBrightness = patch.brightness;
    if (Number.isFinite(patch.contrast)) this.imageContrast = patch.contrast;
    this.updateImageAdjustments();
    if (!this.playback) this._save();
  }

  setUpsideDown(value) {
    if (this.upsideDown === !!value) return;
    this.upsideDown = !!value;
    this.updateOrientationPreview();
    if (!this.playback) this._save();
    this.latest = null;
    this.people = [];
    this.tracks = [];
    this.ignoredTracks = [];
    this.tracker = new PoseTracker();
    Object.assign(this.tracker.params, {
      minCutoff2D: this.settings.mc2,
      minCutoff3D: this.settings.mc3,
      beta: this.settings.beta,
    });
    this.globalIds.clear();
    this.ovCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.rev++;
  }

  setCustomConf(name, text) {
    this.custom = { name, text };
    this.calibChoice = "custom";
    this._save();
    this.reconfigure();
  }

  setExtrinsics(patch, programmatic = false) {
    Object.assign(this.extr, patch);
    this.worldPose = extrinsicsToPose(this.extr);
    this._save();
    if (programmatic) this.rev++;
  }

  calibText() {
    const c = this.calib;
    if (!this.deviceId) return "Camera off";
    if (!c) return "Starting…";
    if (!c.approx) {
      const fov = (2 * Math.atan(this.eyeW / 2 / c.rect.f) * 180) / Math.PI;
      const [requestedSize] = this.settings.res.split("@");
      const requestedMode = modeForWidth(Number(requestedSize.split("x")[0]));
      const modeNote = requestedMode && requestedMode !== c.mode
        ? ` · requested ${requestedMode}`
        : "";
      return `✓ ${this.calibSource} · ${c.mode} · f ${c.rect.f.toFixed(0)} px (${fov.toFixed(0)}° H) · baseline ${(c.baseline * 1000).toFixed(1)} mm${modeNote}`;
    }
    if (c.missingMode)
      return `⚠ ${this.calibSource} has no ${c.mode} section – approximate`;
    if (this.calibChoice === "auto") {
      const n = this.hooks
        .catalog()
        .filter((e) => e.model === this.model).length;
      if (n > 1)
        return `⚠ ${n} ${this.model} calibrations available – pick one`;
    }
    return `⚠ Approximate ${c.model} intrinsics (f ≈ ${Math.round(c.rect.f)} px), no undistortion`;
  }

  get halfFov() {
    return this.calib ? Math.atan(this.eyeW / 2 / this.calib.rect.f) : 0.87;
  }

  // ------------------------------------------------------------------ pose

  async ensurePose() {
    const s = this.settings;
    if (!s.poseOn || this.poseLoading || !this.deviceId) return;
    const opts = {
      model: s.poseModel,
      numPoses: s.numPoses,
      minConf: s.poseConf,
    };
    const key = JSON.stringify(opts);
    if (key === this.poseKey) return;
    this.poseLoading = true;
    const generation = this.generation;
    this.poseKey = key; // set up front so a failure doesn't retry in a loop
    try {
      const lm = await createPose(opts);
      if (generation !== this.generation) {
        lm.close();
        return;
      }
      this.landmarker?.close();
      this.landmarker = lm;
    } catch (e) {
      this.hooks.status(
        `Camera ${this.index + 1}: pose model failed to load – ${e.message}`,
        true,
      );
    } finally {
      this.poseLoading = false;
    }
    this.ensurePose(); // pick up option changes made while loading
  }

  /** 2D landmarks -> joints with camera-space (p3) and world-space (w) positions. */
  lift(landmarks) {
    const { calib, eyeW, eyeH, stereo } = this;
    const toRect = (point) => {
      const raw = sensorImagePoint(point, this.upsideDown);
      return rawToRect(calib, "left", raw.x * eyeW - 0.5, raw.y * eyeH - 0.5);
    };
    const joints = landmarks.map((lm) => {
      const j = {
        x: lm.x,
        y: lm.y,
        vis: lm.visibility ?? 1,
        p3: null,
        w: null,
        rejected: false,
      };
      if (!stereo || !calib || j.vis < MIN_VIS) return j;
      const [ru, rv] = toRect(lm);
      const s = stereo.procW / eyeW;
      const d = stereo.sampleDisparity(
        (ru + 0.5) * s - 0.5,
        (rv + 0.5) * s - 0.5,
      );
      if (!d) return j;
      const z = (stereo.focalProc * calib.baseline) / d;
      j.p3 = uprightCameraPoint(
        {
          x: ((ru - calib.rect.cx) / calib.rect.f) * z,
          y: ((rv - calib.rect.cy) / calib.rect.f) * z,
          z,
        },
        this.upsideDown,
      );
      return j;
    });

    const torso = TORSO.map((i) => joints[i].p3?.z)
      .filter((z) => z != null)
      .sort((a, b) => a - b);
    const dist = torso.length ? torso[torso.length >> 1] : null;
    for (const j of joints) {
      if (!j.p3) continue;
      if (dist != null && Math.abs(j.p3.z - dist) > LIMB_REACH_M)
        j.rejected = true;
      else j.w = toWorld(this.worldPose, j.p3);
    }
    return {
      cam: this.index,
      joints,
      dist,
      size: calib ? bodySizeM(joints, dist, calib.rect.f, toRect) : null,
      centerCam: torsoCenter(joints, "p3"),
      center: torsoCenter(joints, "w"),
    };
  }

  // ------------------------------------------------------------------ frame loop

  _onFrame(now) {
    this.rvfc = this.video.requestVideoFrameCallback(this._onFrame);
    this.frames++;
    const s = this.settings;
    try {
      if (this.stereo && this.calib) {
        this.stereo.pollReadback();
        this.stereo.process(this.video);
        if (s.poseOn) this.stereo.startReadback();
      }

      const ctx = this.poseCtx;
      const brightness = this.imageBrightness;
      const contrast = this.imageContrast;
      ctx.filter =
        brightness !== 1 || contrast !== 1
          ? `brightness(${brightness}) contrast(${contrast})`
          : "none";
      drawPoseFrame(
        ctx,
        this.video,
        this.eyeW,
        this.eyeH,
        this.poseCanvas.width,
        this.poseCanvas.height,
        this.upsideDown,
      );
      ctx.filter = "none";

      let people = [];
      if (s.poseOn && this.landmarker) {
        const ts = Math.max(now, this.lastTs + 1);
        this.lastTs = ts;
        const t0 = performance.now();
        const res = this.landmarker.detectForVideo(this.poseCanvas, ts);
        this.poseMs = this.poseMs * 0.9 + (performance.now() - t0) * 0.1;
        people = res.landmarks.map((lm) => this.lift(lm));
      }
      if (s.mergeDupes && people.length > 1) {
        const r = mergeDuplicates(people, this.eyeW / this.eyeH);
        people = r.people;
        this.mergedCount += r.merged;
      }
      for (const p of people)
        p.oddSize =
          p.size == null ? null : p.size < s.minBody || p.size > s.maxBody;
      this.people = people;

      const tracks = this.tracker.update(people, now);
      const byId = new Map(tracks.map((t) => [t.id, t]));
      const sizeHidden = (t) => s.sizeFilter && t.hidden;
      for (const p of people) {
        const t = byId.get(p.trackId);
        p.ignored = !t.confirmed ? "new" : sizeHidden(t) ? "size" : null;
      }
      // tracks coast through brief detection misses; hide them once a miss lasts > ~150 ms
      const recent = tracks.filter(
        (t) => now - t.lastSeen <= 150 && t.confirmed,
      );
      this.tracks = recent.filter((t) => !sizeHidden(t));
      this.ignoredTracks = recent.filter(sizeHidden);
      for (const id of this.globalIds.keys())
        if (!byId.has(id)) this.globalIds.delete(id);

      // only confirmed, plausible people go on to fusion
      this.latest = { t: now, people: people.filter((p) => !p.ignored) };
      this.seq++;
      this.drawOverlay();
      this.hooks.onFrame(this);
    } catch (e) {
      console.error(e);
      this.hooks.status(`Camera ${this.index + 1}: ${e.message}`, true);
    }
  }

  drawOverlay() {
    const { overlay: o, ovCtx: ctx, settings: s } = this;
    const w = o.width;
    const h = o.height;
    ctx.clearRect(0, 0, w, h);
    const style = { near: s.near, far: s.far };
    const both = s.showRaw && s.showSmooth;
    const gid = (trackId) => this.globalIds.get(trackId);

    const IGNORED = "#8a939c";
    if (s.showRaw) {
      for (const p of this.people) {
        const opts = both
          ? { ...style, lineWidth: 1.5, alpha: 0.45, dots: false }
          : style;
        if (p.ignored === "size")
          drawSkeleton(ctx, p.joints, w, h, IGNORED, {
            ...opts,
            alpha: 0.6,
            dash: [6, 5],
          });
        else
          drawSkeleton(ctx, p.joints, w, h, colorForId(gid(p.trackId)), opts);
      }
    }
    if (s.showSmooth) {
      for (const t of this.tracks)
        drawSkeleton(ctx, t.joints, w, h, colorForId(gid(t.id)), {
          ...style,
          lineWidth: 3.5,
        });
    }
    const labelled = s.showSmooth
      ? this.tracks.map((t) => ({ joints: t.joints, id: t.id, dist: t.dist }))
      : s.showRaw
        ? this.people.map((p) => ({
            joints: p.joints,
            id: p.trackId,
            dist: p.dist,
          }))
        : [];
    for (const item of labelled) {
      const g = gid(item.id);
      const text = `${g != null ? `#${g}` : "no depth"}${item.dist != null ? `  ${item.dist.toFixed(2)} m` : ""}`;
      drawLabel(ctx, item.joints, text, colorForId(g), w, h);
    }
    // say why a skeleton is being ignored, so the size limits can be tuned by eye
    const ignored = s.showSmooth
      ? this.ignoredTracks
      : s.showRaw
        ? this.people.filter((p) => p.ignored === "size")
        : [];
    for (const item of ignored) {
      const size = item.size != null ? `  torso ${item.size.toFixed(2)} m` : "";
      drawLabel(ctx, item.joints, `ignored${size}`, IGNORED, w, h);
    }
  }
}
