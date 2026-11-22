import "./style.css";
import { fitWall, guidedCalibration } from "./guided-calibration.js";
import { ZedCamera } from "./camera.js";
import { WorldTracker } from "./tracking.js";
import { parseConf } from "./calib.js";
import {
  DEFAULT_EXTRINSICS,
  apply,
  fuse,
  solveYawTranslation,
} from "./fusion.js";
import { drawTop } from "./draw.js";
import { mountControls, DEFAULTS } from "./controls.js";
import { CHANNEL } from "./experience/engine.js";
import { StereoRecorder, StereoReplay, readStereoSession } from "./session.js";

const $ = (id) => document.getElementById(id);

const settings = { ...DEFAULTS }; // shared, live settings read by every camera
const cameras = [];
const calibration = guidedCalibration($("guidedCalibration"), cameras);
$("runCalibration").onclick = () => {
  if (sourceBusy || stereoReplay || stereoRecorder || !settings.poseOn ||
      !cameras[0]?.stream?.active || !cameras[1]?.stream?.active ||
      cameras[0].deviceId === cameras[1].deviceId) {
    setStatus("Connect two distinct live cameras and enable pose tracking before calibration.", true);
    return;
  }
  align = null;
  calibration.start();
};
let devices = []; // [{ id, label }]
let catalog = []; // calibration files from public/calibration/index.json
let worldTracks = [];
let align = null; // { i, pairs, until, lastMsg }
let pendingCalibCam = 0;
let stereoRecorder = null;
let stereoReplay = null;
let sourceBusy = false;
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(CHANNEL)
    : null;
let lastBroadcast = 0;
const embedded = window.parent !== window;
function reportTracker(error = "") {
  if (!embedded) return;
  window.parent.postMessage(
    {
      type: "lunar-tracker-status",
      busy: sourceBusy,
      error,
      cameras: cameras
        .filter((c) => c.stream?.active || c.playback)
        .map((c) => ({
          label: c.label,
          fps: c.fps,
          poseReady: !!c.landmarker,
        })),
      devices: devices.map((d) => d.label),
      replay: !!stereoReplay,
    },
    location.origin,
  );
}

const world = new WorldTracker();
Object.assign(world.params, { minCutoff: settings.mc3, beta: settings.beta });

// ---------------------------------------------------------------- status

let statusTimer = null;
function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = msg ? (isError ? "error" : "info") : "";
  clearTimeout(statusTimer);
  if (msg) statusTimer = setTimeout(() => setStatus(""), isError ? 8000 : 4000);
  if (msg && isError) reportTracker(msg);
}

const hooks = {
  catalog: () => catalog,
  status: setStatus,
  onFrame: () => {},
};

// ---------------------------------------------------------------- controls

const STEREO_KEYS = new Set([
  "mode",
  "window",
  "maxD",
  "minConf",
  "median",
  "yOffset",
  "near",
  "far",
]);
const POSE_KEYS = new Set(["poseOn", "poseModel", "numPoses", "poseConf"]);
let poseTimer = null;

function onControl(key, v, ctx) {
  if (ctx?.initial || !(key in settings)) return;
  if (settings[key] === v) return;
  settings[key] = v;

  if (STEREO_KEYS.has(key)) {
    for (const c of cameras) if (c.stereo) c.stereo.params[key] = v;
  } else if (POSE_KEYS.has(key)) {
    clearTimeout(poseTimer); // sliders fire continuously while dragging
    poseTimer = setTimeout(() => cameras.forEach((c) => c.ensurePose()), 300);
  } else if (key === "res") {
    if (!stereoReplay) restartAll();
  } else if (key === "procW") {
    cameras.forEach((c) => c.reconfigure());
  } else if (key === "mc2" || key === "mc3" || key === "beta") {
    for (const c of cameras) {
      Object.assign(c.tracker.params, {
        minCutoff2D: settings.mc2,
        minCutoff3D: settings.mc3,
        beta: settings.beta,
      });
    }
    Object.assign(world.params, {
      minCutoff: settings.mc3,
      beta: settings.beta,
    });
  }
  // boostB/boostC/showRaw/showSmooth/fuseDist are read live from `settings`
}

function onCamControl(i, key, v, ctx) {
  const cam = cameras[i];
  if (ctx?.initial || !cam) return;
  if (key === "device") {
    if (stereoReplay || stereoRecorder) {
      setStatus("Use Connect cameras to leave the stereo session first.", true);
      pushControls();
      return;
    }
    if (v === cam.deviceId) return;
    const other = cameras.find(
      (c) => c !== cam && c.deviceId && c.deviceId === v,
    );
    if (other)
      setStatus(`That device is already camera ${other.index + 1}`, true);
    const label = devices.find((d) => d.id === v)?.label ?? "";
    cam
      .start(v, label)
      .catch((e) => setStatus(`Camera ${i + 1}: ${e.message}`, true))
      .finally(pushControls);
  } else if (key === "upsideDown") {
    if (cam.upsideDown === v) return;
    if (stereoRecorder) {
      setStatus(
        "Stop the stereo recording before changing camera orientation.",
        true,
      );
      cam.rev++;
    } else {
      cam.setUpsideDown(v);
      align = null;
      resetWorld();
    }
    pushControls();
  } else if (key === "brightness") {
    cam.setImageAdjustments({ brightness: v });
    pushControls();
  } else if (key === "contrast") {
    cam.setImageAdjustments({ contrast: v });
    pushControls();
  } else if (key === "calib") {
    if (v === cam.calibChoice) return;
    cam.setCalibChoice(v);
    pushControls();
  } else if (key in cam.extr) {
    if (cam.extr[key] !== v) cam.setExtrinsics({ [key]: v });
  }
}

const controls = mountControls($("leva"), {
  emit: onControl,
  emitCam: onCamControl,
  actions: {
    restartAll: () => restartAll(),
    rescan: () => discover().catch(sessionError),
    loadCalib: (i) => {
      pendingCalibCam = i;
      $("calibFile").click();
    },
    align: (i) => startAlign(i),
    resetPlacement: (i) => {
      const cam = cameras[i];
      if (cam) cam.setExtrinsics({ ...cam.defaults.extr }, true);
      pushControls();
    },
    applyCamControl: (key, v) =>
      cameras.forEach((c) => c.track && applyControl(c.track, key, v)),
    stats: (i) => ({
      fps: cameras[i]?.fps ?? 0,
      poseMs: cameras[i]?.poseMs ?? 0,
    }),
  },
});

let capsCache = { track: null, caps: null };
function pushControls() {
  const t = cameras.find((c) => c.track)?.track ?? null;
  if (t !== capsCache.track)
    capsCache = { track: t, caps: t ? readCameraCaps(t) : null };
  controls.update({
    devices,
    catalog: catalog.map(({ file, serial, model }) => ({
      file,
      serial,
      model,
    })),
    camCaps: capsCache.caps,
    cameras: cameras.map((c) => ({
      deviceId: c.deviceId,
      calibChoice: c.calibChoice,
      customName: c.custom?.name ?? "",
      upsideDown: c.upsideDown,
      imageBrightness: c.imageBrightness,
      imageContrast: c.imageContrast,
      calibText: c.calibText(),
      extr: { ...c.extr },
      rev: c.rev,
    })),
  });
}

// ---------------------------------------------------------------- camera controls (exposure etc.)

const CONTROL_KEYS = [
  "exposureMode",
  "exposureTime",
  "exposureCompensation",
  "brightness",
  "contrast",
  "saturation",
  "sharpness",
  "whiteBalanceMode",
  "colorTemperature",
  "focusMode",
  "focusDistance",
];

function readCameraCaps(track) {
  const caps = track.getCapabilities?.() ?? {};
  const st = track.getSettings();
  const out = [];
  for (const key of CONTROL_KEYS) {
    const cap = caps[key];
    if (cap == null) continue;
    if (Array.isArray(cap)) {
      if (cap.length >= 2)
        out.push({ key, value: st[key] ?? cap[0], options: cap });
    } else if (typeof cap === "object" && cap.max > cap.min) {
      const value = Math.min(cap.max, Math.max(cap.min, st[key] ?? cap.min));
      out.push({
        key,
        value,
        min: cap.min,
        max: cap.max,
        step: cap.step || (cap.max - cap.min) / 100,
      });
    }
  }
  return out;
}

async function applyControl(track, key, value) {
  const c = { [key]: value };
  if (key === "exposureTime") c.exposureMode = "manual";
  if (key === "colorTemperature") c.whiteBalanceMode = "manual";
  try {
    await track.applyConstraints({ advanced: [c] });
  } catch (e) {
    setStatus(`${key}: ${e.message}`, true);
  }
}

// ---------------------------------------------------------------- calibration files

async function loadCatalog() {
  try {
    const res = await fetch("/calibration/index.json");
    if (!res.ok) return;
    const index = await res.json();
    catalog = await Promise.all(
      index.map(async (e) => ({
        ...e,
        conf: parseConf(await (await fetch(`/calibration/${e.file}`)).text()),
      })),
    );
  } catch {
    catalog = [];
  }
}

$("calibFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  const cam = cameras[pendingCalibCam];
  if (!file || !cam) return;
  const text = await file.text();
  if (!parseConf(text).STEREO) {
    setStatus(
      `${file.name} has no [STEREO] section – is it a ZED calibration file?`,
      true,
    );
    return;
  }
  cam.setCustomConf(file.name, text);
  pushControls();
  setStatus(`Camera ${cam.index + 1}: loaded ${file.name}`);
});

// ---------------------------------------------------------------- devices

async function discover() {
  if (stereoReplay || stereoRecorder) {
    setStatus("Use Connect cameras to leave the stereo session first.", true);
    return;
  }
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch (e) {
    const reason =
      e.name === "NotReadableError"
        ? "Camera is unavailable. Close other camera apps or tracking-bench tabs, then rescan."
        : e.name === "NotFoundError"
          ? "No camera found. Reconnect the ZED and rescan."
          : e.name === "NotAllowedError"
            ? "Camera access was denied. Allow camera access for this page and rescan."
            : `Cannot access camera: ${e.message}`;
    setStatus(reason, true);
    throw new Error(reason);
  }
  devices = (await navigator.mediaDevices.enumerateDevices())
    .filter((d) => d.kind === "videoinput")
    .map((d) => ({ id: d.deviceId, label: d.label }));
  const zeds = devices.filter((d) => /zed/i.test(d.label));

  const wanted = Math.max(1, zeds.length, cameras.length); // never removes slots
  while (cameras.length < wanted)
    cameras.push(new ZedCamera(cameras.length, settings, hooks));
  $("poseGrid").dataset.count = String(cameras.length);

  const used = new Set(cameras.map((c) => c.deviceId).filter(Boolean));
  for (const cam of cameras) {
    if (cam.deviceId) continue;
    const next = zeds.find((z) => !used.has(z.id));
    if (!next) continue;
    used.add(next.id);
    try {
      await cam.start(next.id, next.label);
    } catch (e) {
      cam.deviceId = "";
      setStatus(`Camera ${cam.index + 1}: ${e.message}`, true);
    }
  }
  pushControls();
  if (!zeds.length)
    setStatus(
      "No ZED in the camera list – pick a device under Camera 1.",
      true,
    );
}

// ---------------------------------------------------------------- stereo sessions

function resetWorld() {
  world.tracks = [];
  worldTracks = [];
  lastFuse = 0;
}

function sessionError(error) {
  setStatus(error.message, true);
}

async function stopRecording() {
  const recording = stereoRecorder;
  if (!recording) return;
  stereoRecorder = null;
  $("recordStereo").textContent = "Saving stereo session…";
  $("recordStereo").disabled = true;
  try {
    await recording.stop();
    $("sessionInfo").textContent =
      "Stereo session saved. Load it here to loop through depth + pose.";
  } catch (e) {
    sessionError(e);
  } finally {
    $("recordStereo").textContent = "Record stereo session";
    $("recordStereo").disabled = false;
  }
}

$("recordStereo").addEventListener("click", () => {
  if (stereoRecorder) {
    stopRecording();
    return;
  }
  try {
    stereoRecorder = new StereoRecorder(cameras, settings, () =>
      stopRecording(),
    );
    $("recordStereo").textContent = "Stop & save stereo";
    $("sessionInfo").textContent =
      "Recording all live cameras · 2 minute limit · software start timing";
  } catch (e) {
    sessionError(e);
  }
});

async function connectCameras() {
  if (sourceBusy) return;
  sourceBusy = true;
  try {
    await startupReady;
    await stopRecording();
    stereoReplay?.dispose();
    stereoReplay = null;
    for (const c of cameras) {
      c.stop();
      c.deviceId = "";
    }
    resetWorld();
    $("toggleStereo").hidden = true;
    $("seekLabel").hidden = true;
    await discover();
    $("sessionInfo").textContent =
      "Live camera joints → starfield. Set the effect input to ZED / stereo session.";
  } catch (e) {
    sessionError(e);
  } finally {
    sourceBusy = false;
    reportTracker();
  }
}
$("connectCameras").addEventListener("click", connectCameras);

window.addEventListener("message", (event) => {
  if (
    !embedded ||
    event.origin !== location.origin ||
    event.source !== window.parent ||
    event.data?.type !== "lunar-tracker-command"
  )
    return;
  if (event.data.command === "rescan") connectCameras();
  if (event.data.command === "stop") {
    stereoReplay?.dispose();
    stereoReplay = null;
    for (const c of cameras) {
      c.stop();
      c.deviceId = "";
    }
    resetWorld();
    reportTracker();
  }
});

$("loadStereo").addEventListener("click", () => $("sessionFile").click());
$("sessionFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || sourceBusy) return;
  sourceBusy = true;
  $("sessionInfo").textContent = "Loading stereo session…";
  try {
    const { manifest, blobs } = await readStereoSession(file);
    await stopRecording();
    stereoReplay?.dispose();
    stereoReplay = null;
    for (const c of cameras) {
      c.stop();
      c.deviceId = "";
    }
    resetWorld();
    // Restore processing parameters as well as camera calibration and placements.
    for (const [key, value] of Object.entries(manifest.settings ?? {})) {
      if (
        Object.hasOwn(DEFAULTS, key) &&
        typeof value === typeof DEFAULTS[key] &&
        (typeof value !== "number" || Number.isFinite(value))
      )
        onControl(key, value);
    }
    controls.syncSettings(settings);
    while (cameras.length < blobs.length)
      cameras.push(new ZedCamera(cameras.length, settings, hooks));
    $("poseGrid").dataset.count = String(cameras.length);
    const replayCameras = cameras.slice(0, blobs.length);
    await Promise.all(
      replayCameras.map((c, i) =>
        c.startPlayback(blobs[i], manifest.cameras[i]),
      ),
    );
    stereoReplay = new StereoReplay(
      replayCameras,
      manifest.cameras,
      resetWorld,
      sessionError,
    );
    await stereoReplay.play();
    $("toggleStereo").hidden = false;
    $("seekLabel").hidden = false;
    $("toggleStereo").textContent = "Pause replay";
    $("seekStereo").max = stereoReplay.duration;
    $("sessionInfo").textContent =
      `${file.name} · ${blobs.length} cameras · ${stereoReplay.duration.toFixed(1)} s loop`;
    pushControls();
  } catch (e) {
    stereoReplay?.dispose();
    stereoReplay = null;
    for (const c of cameras)
      if (c.playback) {
        c.stop();
        c.deviceId = "";
      }
    $("toggleStereo").hidden = true;
    $("seekLabel").hidden = true;
    $("sessionInfo").textContent = "Session could not be loaded.";
    sessionError(e);
  } finally {
    sourceBusy = false;
  }
});

$("toggleStereo").addEventListener("click", async () => {
  if (!stereoReplay) return;
  try {
    if (stereoReplay.paused) await stereoReplay.play();
    else stereoReplay.pause();
    $("toggleStereo").textContent = stereoReplay.paused
      ? "Play replay"
      : "Pause replay";
  } catch (e) {
    sessionError(e);
  }
});

const toggleCameraFocus = $("toggleCameraFocus");
toggleCameraFocus.addEventListener("click", () => {
  const focused = document.documentElement.classList.toggle("camera-focus");
  toggleCameraFocus.setAttribute("aria-pressed", String(focused));
  toggleCameraFocus.textContent = focused
    ? "Show right panels"
    : "Collapse right panels";
});

$("seekStereo").addEventListener("input", () => {
  if (stereoReplay)
    stereoReplay.seek(Number($("seekStereo").value)).catch(sessionError);
});

async function restartAll() {
  if (stereoReplay || stereoRecorder) return;
  for (const cam of cameras) {
    if (!cam.deviceId) continue;
    try {
      await cam.start(cam.deviceId, cam.label);
    } catch (e) {
      setStatus(`Camera ${cam.index + 1}: ${e.message}`, true);
    }
  }
  pushControls();
}

// ---------------------------------------------------------------- auto-align

function startAlign(i) {
  if (!cameras[0]?.latest || !cameras[i]?.latest) {
    setStatus(
      "Both cameras need to be running (with pose enabled) to align.",
      true,
    );
    return;
  }
  align = { i, pairs: [], until: performance.now() + 10000, lastMsg: 0 };
  setStatus(
    `Aligning camera ${i + 1} to camera 1 – have ONE person walk around where both cameras see them…`,
  );
}

function collectAlign(now) {
  const ref = cameras[0];
  const tgt = cameras[align.i];
  const fresh = (c) => c.latest && now - c.latest.t < 100;
  if (fresh(ref) && fresh(tgt)) {
    const a = ref.latest.people.filter((p) => p.center);
    const b = tgt.latest.people.filter((p) => p.centerCam);
    if (a.length === 1 && b.length === 1) {
      align.pairs.push({
        a: a[0].center,
        b: apply(tgt.worldPose.level, b[0].centerCam),
      });
    }
  }
  if (now < align.until) {
    if (now - align.lastMsg > 1000) {
      align.lastMsg = now;
      const left = Math.ceil((align.until - now) / 1000);
      setStatus(
        `Aligning camera ${align.i + 1}: ${align.pairs.length} samples… ${left}s (one person, keep walking)`,
      );
    }
    return;
  }

  const { i, pairs } = align;
  align = null;
  if (pairs.length < 30) {
    setStatus(
      `Alignment failed: only ${pairs.length} samples where exactly one person had depth in both cameras.`,
      true,
    );
    return;
  }
  const r = solveYawTranslation(pairs);
  if (r.spread < 0.3) {
    setStatus(
      `Alignment failed: the person barely moved (${r.spread.toFixed(2)} m spread) – walk around more.`,
      true,
    );
    return;
  }
  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
  cameras[i].setExtrinsics(
    {
      x: round(r.x, 2),
      y: round(r.y, 2),
      z: round(r.z, 2),
      yaw: round(r.yaw, 1),
    },
    true,
  );
  pushControls();
  setStatus(
    `Camera ${i + 1} aligned from ${pairs.length} samples: yaw ${r.yaw.toFixed(1)}°, offset x ${r.x.toFixed(2)} z ${r.z.toFixed(2)} m, fit error ${(r.rms * 100).toFixed(0)} cm`,
  );
}

// ---------------------------------------------------------------- fusion loop

const topCanvas = $("top");
const topCtx = topCanvas.getContext("2d");
let mapView, drag;
function applyCenterAlignment() {
  if (calibration.alignCenters()) {
    pushControls();
    setStatus("Centers aligned. The dashed line estimates the wall.");
  } else setStatus("Connect the cameras that captured these wall positions.",true);
}
$("alignCenters").onclick=applyCenterAlignment;
topCanvas.style.touchAction="none";
topCanvas.onpointerdown=e=>{
  if (drag || !mapView || calibration.capturing || e.button!==0) return;
  const rect=topCanvas.getBoundingClientRect();
  const handles=mapView.handles.map(({index,xy})=>({
    cam:cameras[index], distance:Math.hypot(
      e.clientX-rect.left-xy[0]*rect.width/topCanvas.width,
      e.clientY-rect.top-xy[1]*rect.height/topCanvas.height)
  })).sort((a,b)=>a.distance-b.distance);
  if (!handles.length || handles[0].distance>16) return;
  const cam=handles[0].cam;
  drag={cam,id:e.pointerId,startX:e.clientX,startY:e.clientY,x:cam.extr.x,z:cam.extr.z,
    metersPerPixel:topCanvas.width/rect.width/mapView.scale,bounds:mapView.bounds};
  topCanvas.setPointerCapture(e.pointerId);
};
topCanvas.onpointermove=e=>{
  if (drag?.id!==e.pointerId) return;
  const limit=v=>Math.max(-20,Math.min(20,Math.round(v*100)/100));
  drag.cam.setExtrinsics({
    x:limit(drag.x-(e.clientX-drag.startX)*drag.metersPerPixel),
    z:limit(drag.z+(e.clientY-drag.startY)*drag.metersPerPixel)
  });
};
topCanvas.onlostpointercapture=()=>{
  if (!drag) return;
  drag.cam.rev++;
  drag=null;
  pushControls();
};
new ResizeObserver(() => {
  const dpr = window.devicePixelRatio || 1;
  topCanvas.width = Math.round(topCanvas.clientWidth * dpr);
  topCanvas.height = Math.round(topCanvas.clientHeight * dpr);
}).observe(topCanvas);

let lastFuse = 0;
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  const wasCapturing=calibration.capturing;
  calibration.tick(now);
  if (wasCapturing && !calibration.capturing) applyCenterAlignment();
  const active = cameras.filter((c) => c.latest && now - c.latest.t < 250);
  if (now - lastBroadcast >= 1000 / 30) {
    const visible = worldTracks
      .filter((t) => now - t.lastSeen < 250)
      .slice(0, 6);
    channel?.postMessage({
      version: 1,
      type: "frame",
      cameraCount: active.length,
      time: now,
      people: visible.map((t) => ({
        id: t.id,
        joints: t.joints,
        cams: t.cams,
      })),
    });
    lastBroadcast = now;
    if (stereoReplay && document.activeElement !== $("seekStereo"))
      $("seekStereo").value = stereoReplay.time;
  }
  const fresh = active.filter((c) => c.seq !== c.fusedSeq);
  // fuse once every running camera has a new frame (or after 45 ms, so one slow camera can't stall it)
  const due =
    fresh.length > 0 && (fresh.length === active.length || now - lastFuse > 45);
  if (!due && now - lastFuse < 500) return;
  lastFuse = now;
  for (const c of active) c.fusedSeq = c.seq;

  const dets = [];
  for (const c of active)
    for (const p of c.latest.people)
      if (p.center) dets.push({ cam: c.index, camera: c, person: p });
  const merged = fuse(dets, settings.fuseDist);
  world.update(merged, now);
  for (const m of merged)
    for (const d of m.members)
      d.camera.globalIds.set(d.person.trackId, m.globalId);
  if (align) collectAlign(now);

  worldTracks = world.tracks.filter((t) => now - t.lastSeen <= 200);
  const markers=calibration.markers;
  const wall=fitWall(markers);
  $("alignCenters").hidden=!wall || calibration.capturing;
  mapView=drawTop(topCtx, topCanvas.width, topCanvas.height, {
    cams: cameras
      .filter((c) => c.deviceId && c.calib)
      .map((c) => ({ index: c.index, pose: c.worldPose, halfFov: c.halfFov })),
    tracks: worldTracks,
    markers, wall, bounds:drag?.bounds,
    far: settings.far,
  });
}

// ---------------------------------------------------------------- stats

setInterval(() => {
  reportTracker();
  const lines = [];
  for (const c of cameras) {
    c.fps = c.frames * 2;
    c.frames = 0;
    if (!c.deviceId) {
      lines.push(`cam ${c.index + 1}  off`);
      continue;
    }
    const pose = !settings.poseOn
      ? "off"
      : c.landmarker
        ? `${c.poseMs.toFixed(1)} ms`
        : "loading…";
    const shown = c.tracks.length;
    const extra = [
      c.ignoredTracks.length && `${c.ignoredTracks.length} ignored`,
      c.mergedCount && `${c.mergedCount * 2} dup/s`,
    ].filter(Boolean);
    c.mergedCount = 0;
    lines.push(
      `cam ${c.index + 1}  ${c.label}  ${c.capW}×${c.capH}  ${c.fps} fps  pose ${pose}  people ${shown}${extra.length ? ` (${extra.join(", ")})` : ""}`,
    );
    if (c.stereo?.calib) {
      const fb = c.stereo.focalProc * c.stereo.calib.baseline;
      const src = c.calib.approx ? "approx calib" : c.calibSource;
      lines.push(
        `       ${src} · min ${(fb / settings.maxD).toFixed(2)} m · ±${(16 / fb).toFixed(2)} m/px @ 4 m`,
      );
    }
  }
  lines.push(
    "",
    `world  ${worldTracks.length} ${worldTracks.length === 1 ? "person" : "people"}`,
  );
  for (const t of worldTracks) {
    const c = t.center;
    lines.push(
      `  #${t.id}  x ${c.x.toFixed(2)}  z ${c.z.toFixed(2)} m   cam ${t.cams.map((i) => i + 1).join("+")}`,
    );
  }
  $("stats").textContent = lines.join("\n");
}, 500);

// ---------------------------------------------------------------- go

const startupReady = loadCatalog();
(async () => {
  await startupReady;
  pushControls();
  requestAnimationFrame(tick);
})();

window.addEventListener("beforeunload", () => {
  stereoReplay?.dispose();
  for (const c of cameras) c.stop();
  channel?.close();
});
