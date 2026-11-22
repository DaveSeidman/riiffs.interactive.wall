// Browser-native, side-by-side stereo sessions. This deliberately does not claim SVO support.
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { downloadBlob } from "./experience/engine.js";

const FORMAT = "lunar-stereo-v1";
export function validateSession(manifest) {
  if (
    manifest?.format !== FORMAT ||
    !Array.isArray(manifest.cameras) ||
    !manifest.cameras.length ||
    manifest.cameras.length > 6
  )
    throw new Error("Not a Lunar stereo session.");
  const names = new Set();
  for (const cam of manifest.cameras) {
    if (
      typeof cam.file !== "string" ||
      !/^camera-\d+\.(webm|mp4)$/.test(cam.file)
    )
      throw new Error("Invalid camera file in session.");
    if (names.has(cam.file))
      throw new Error("Camera recordings must be distinct.");
    names.add(cam.file);
    if (cam.upsideDown != null && typeof cam.upsideDown !== "boolean")
      throw new Error("Invalid camera orientation in session.");
    if (
      !Number.isFinite(cam.offset) ||
      cam.offset < 0 ||
      cam.offset > 10 ||
      !Number.isFinite(cam.duration) ||
      cam.duration <= 0 ||
      cam.duration > 180
    )
      throw new Error("Invalid camera timing in session.");
    if (
      !cam.extr ||
      !["x", "y", "z", "yaw", "pitch", "roll"].every((k) =>
        Number.isFinite(cam.extr[k]),
      )
    )
      throw new Error("Invalid camera placement.");
  }
  return manifest;
}

export class StereoRecorder {
  constructor(cameras, settings, onLimit) {
    if (!globalThis.MediaRecorder)
      throw new Error(
        "This browser does not support MediaRecorder. Use Chrome.",
      );
    const running = cameras.filter((c) => c.stream?.active);
    if (!running.length)
      throw new Error("Connect at least one live camera before recording.");
    const mimeType = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/mp4",
    ].find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw new Error("No supported video recording codec.");
    this.started = performance.now();
    this.settings = { ...settings };
    this.entries = running.map((cam, i) => {
      const recorder = new MediaRecorder(cam.stream, {
        mimeType,
        videoBitsPerSecond: 20000000,
      });
      const entry = {
        recorder,
        chunks: [],
        offset: 0,
        duration: 0,
        error: null,
        metadata: {
          file: `camera-${i}.${mimeType.startsWith("video/mp4") ? "mp4" : "webm"}`,
          label: cam.label,
          model: cam.model,
          upsideDown: cam.upsideDown === true,
          imageBrightness: cam.imageBrightness,
          imageContrast: cam.imageContrast,
          extr: { ...cam.extr },
          calibration: cam.resolveConf()?.conf ?? null,
          mimeType,
          width: cam.capW,
          height: cam.capH,
        },
      };
      entry.done = new Promise((resolve) => {
        recorder.onstop = () => {
          entry.duration =
            (performance.now() - this.started) / 1000 - entry.offset;
          resolve();
        };
      });
      recorder.onstart = () => {
        entry.offset = (performance.now() - this.started) / 1000;
      };
      recorder.ondataavailable = ({ data }) => {
        if (data.size) entry.chunks.push(data);
      };
      recorder.onerror = ({ error }) => {
        entry.error = error || new Error("Stereo encoder failed.");
      };
      return entry;
    });
    try {
      for (const e of this.entries) e.recorder.start(1000);
    } catch (error) {
      for (const e of this.entries)
        if (e.recorder.state !== "inactive") e.recorder.stop();
      throw error;
    }
    this.limitTimer = setTimeout(onLimit, 120000);
  }
  async stop() {
    clearTimeout(this.limitTimer);
    for (const e of this.entries)
      if (e.recorder.state !== "inactive") e.recorder.stop();
    await Promise.all(this.entries.map((e) => e.done));
    const archive = {};
    for (const e of this.entries) {
      if (e.error) throw e.error;
      if (!e.chunks.length) throw new Error("No stereo frames were recorded.");
      archive[e.metadata.file] = new Uint8Array(
        await new Blob(e.chunks).arrayBuffer(),
      );
    }
    const manifest = {
      format: FORMAT,
      created: new Date().toISOString(),
      settings: this.settings,
      cameras: this.entries.map((e) => ({
        ...e.metadata,
        offset: e.offset,
        duration: e.duration,
      })),
    };
    archive["session.json"] = strToU8(JSON.stringify(manifest, null, 2));
    downloadBlob(
      new Blob([zipSync(archive, { level: 0 })], { type: "application/zip" }),
      `lunar-stereo-${Date.now()}.zip`,
    );
    return manifest;
  }
}

export async function readStereoSession(file) {
  if (file.size > 1024 * 1024 * 1024)
    throw new Error("Use a stereo session smaller than 1 GB.");
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (entry) =>
      entry.originalSize < 800 * 1024 * 1024 &&
      /^(session\.json|camera-\d+\.(webm|mp4))$/.test(entry.name),
  });
  if (!files["session.json"] || files["session.json"].length > 1000000)
    throw new Error("Session metadata is missing or too large.");
  const manifest = validateSession(
    JSON.parse(strFromU8(files["session.json"])),
  );
  return {
    manifest,
    blobs: manifest.cameras.map((c) => {
      if (!files[c.file]) throw new Error(`Missing ${c.file}.`);
      return new Blob([files[c.file]], {
        type: c.file.endsWith(".mp4") ? "video/mp4" : "video/webm",
      });
    }),
  };
}

// One wall clock, common overlap, drift correction, and a coordinated loop for every camera.
// Browser encoders are not hardware synchronized; offsets preserve software start timing.
export class StereoReplay {
  constructor(cameras, metadata, onSeek, onError) {
    this.cameras = cameras;
    this.metadata = metadata;
    this.onSeek = onSeek;
    this.onError = onError;
    this.start = Math.max(...metadata.map((m) => m.offset));
    this.duration =
      Math.min(...metadata.map((m) => m.offset + m.duration)) - this.start;
    if (this.duration < 0.2)
      throw new Error("Camera recordings have no usable overlapping interval.");
    this.time = 0;
    this.paused = true;
    this.busy = false;
    this.disposed = false;
    this.timer = setInterval(() => this.tick(), 100);
  }
  async seek(time) {
    if (this.busy || this.disposed) return;
    this.busy = true;
    this.time = Math.max(0, Math.min(this.duration - 0.01, time));
    try {
      for (const c of this.cameras) {
        c.video.pause();
        c.latest = null;
        c.tracks = [];
        c.tracker.tracks = [];
        c.globalIds.clear();
      }
      this.onSeek();
      await Promise.all(
        this.cameras.map(
          (c, i) =>
            new Promise((resolve, reject) => {
              const target = this.time + this.start - this.metadata[i].offset;
              if (Math.abs(c.video.currentTime - target) < 0.02) {
                resolve();
                return;
              }
              const done = () => {
                clearTimeout(timer);
                c.video.removeEventListener("seeked", done);
                resolve();
              };
              const timer = setTimeout(() => {
                c.video.removeEventListener("seeked", done);
                reject(new Error("Stereo seek timed out."));
              }, 5000);
              c.video.addEventListener("seeked", done);
              c.video.currentTime = target;
            }),
        ),
      );
      this.clock = performance.now() - this.time * 1000;
      if (!this.paused && !this.disposed)
        await Promise.all(this.cameras.map((c) => c.video.play()));
    } finally {
      this.busy = false;
    }
  }
  async play() {
    this.paused = false;
    await this.seek(this.time);
  }
  pause() {
    this.paused = true;
    for (const c of this.cameras) c.video.pause();
  }
  tick() {
    if (this.paused || this.busy || this.disposed) return;
    this.time = (performance.now() - this.clock) / 1000;
    const fail = (error) => {
      this.pause();
      this.onError(error);
    };
    if (this.time >= this.duration - 0.1) {
      this.seek(0).catch(fail);
      return;
    }
    for (let i = 0; i < this.cameras.length; i++) {
      const video = this.cameras[i].video;
      const error =
        video.currentTime - (this.time + this.start - this.metadata[i].offset);
      // Gentle clock correction avoids repeated seeks and discontinuities in pose detection.
      video.playbackRate =
        Math.abs(error) < 0.025 ? 1 : error > 0 ? 0.97 : 1.03;
      if (Math.abs(error) > 0.3) {
        this.seek(this.time).catch(fail);
        break;
      }
    }
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    this.pause();
  }
}
