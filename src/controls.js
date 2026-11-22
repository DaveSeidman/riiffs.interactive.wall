// Leva control panel, mounted as a small React island. The rest of the app is vanilla JS:
// shared controls go to `emit(key, value, ctx)`, per-camera controls to
// `emitCam(index, key, value, ctx)`, and main.js pushes runtime data back via `update()`.

import { createElement as h, Fragment, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  Leva,
  useControls,
  button,
  buttonGroup,
  monitor,
  levaStore,
} from "leva";

export const DEFAULTS = {
  // Start both ZEDs in the bandwidth-friendly mode so their calibrated FOVs
  // match reliably over the current USB setup.
  res: "1344x376@100",
  mode: 0,
  procW: 480,
  window: "5x5",
  maxD: 64,
  minConf: 0.08,
  median: true,
  yOffset: 0,
  near: 0.4,
  far: 6,
  poseOn: true,
  poseModel: "full",
  numPoses: 4,
  poseConf: 0.5,
  // Per-camera image compensation lives in each Camera folder.
  boostB: 1,
  boostC: 1,
  showRaw: true,
  showSmooth: true,
  mc2: 1.5,
  mc3: 0.6,
  beta: 0.5,
  fuseDist: 2,
  mergeDupes: true,
  sizeFilter: true,
  minBody: 0.15,
  maxBody: 0.9,
};

const RES_OPTIONS = {
  "HD 2560×720 @ 30": "2560x720@30",
  "HD 2560×720 @ 60": "2560x720@60",
  "FHD 3840×1080 @ 30": "3840x1080@30",
  "VGA 1344×376 @ 100": "1344x376@100",
  "2K 4416×1242 @ 15": "4416x1242@15",
};
const VIEW_OPTIONS = {
  "Depth (m)": 0,
  Disparity: 1,
  Confidence: 2,
  "Anaglyph (row alignment)": 3,
};
const WINDOW_OPTIONS = {
  "3×3 (9 taps)": "3x3",
  "5×5 sparse (9 taps)": "5x5s",
  "5×5 (25 taps)": "5x5",
  "9×9 sparse (25 taps)": "9x9s",
};
const MODEL_OPTIONS = {
  "Lite (fastest)": "lite",
  Full: "full",
  "Heavy (most accurate)": "heavy",
};

function deviceOptions(devices) {
  const out = { "(off)": "" };
  devices.forEach((d, i) => {
    let label = d.label || `Camera ${i + 1}`;
    if (label in out) label = `${label} (${i + 1})`; // e.g. two "ZED 2"s
    out[label] = d.id;
  });
  return out;
}

function capsSchema(caps, actions) {
  if (caps == null)
    return { info: { value: "Start a camera first", editable: false } };
  if (!caps.length)
    return {
      info: {
        value: "This browser exposes no controls for this camera",
        editable: false,
      },
    };
  const s = {};
  for (const c of caps) {
    const onChange = (v, _p, ctx) => {
      if (!ctx.initial) actions.applyCamControl(c.key, v);
    };
    s[`cam_${c.key}`] = c.options
      ? { label: c.key, value: c.value, options: c.options, onChange }
      : {
          label: c.key,
          value: c.value,
          min: c.min,
          max: c.max,
          step: c.step,
          onChange,
        };
  }
  return s;
}

function GlobalControls({ props, emit, actions }) {
  const on = (key) => (v, _path, ctx) => emit(key, v, ctx);
  const num = (key, min, max, step, extra = {}) => ({
    value: DEFAULTS[key],
    min,
    max,
    step,
    onChange: on(key),
    ...extra,
  });

  useControls(
    "Cameras",
    {
      resolution: {
        value: DEFAULTS.res,
        options: RES_OPTIONS,
        onChange: on("res"),
      },
      "restart all": button(() => actions.restartAll()),
      "rescan devices": button(() => actions.rescan()),
    },
    { order: -3 },
  );

  useControls("Pose", {
    enabled: { value: DEFAULTS.poseOn, onChange: on("poseOn") },
    model: {
      value: DEFAULTS.poseModel,
      options: MODEL_OPTIONS,
      onChange: on("poseModel"),
    },
    "max people": num("numPoses", 1, 6, 1),
    "min detect conf": num("poseConf", 0.1, 0.9, 0.05),
  });

  useControls("Filtering", {
    "merge duplicates": {
      value: DEFAULTS.mergeDupes,
      onChange: on("mergeDupes"),
      hint: "Two skeletons that agree joint-by-joint are one person",
    },
    "ignore odd sizes": {
      value: DEFAULTS.sizeFilter,
      onChange: on("sizeFilter"),
      hint: "Hide skeletons whose torso (from depth) is consistently outside the range below – catches projected giants and tiny phantoms, not life-size projections",
    },
    "min torso (m)": num("minBody", 0.05, 0.5, 0.01),
    "max torso (m)": num("maxBody", 0.5, 2, 0.05),
  });

  useControls("Smoothing + fusion", {
    "raw skeleton": { value: DEFAULTS.showRaw, onChange: on("showRaw") },
    "smoothed skeleton": {
      value: DEFAULTS.showSmooth,
      onChange: on("showSmooth"),
    },
    "2D cutoff (Hz)": num("mc2", 0.1, 5, 0.1, {
      hint: "Lower = smoother but laggier",
    }),
    "3D cutoff (Hz)": num("mc3", 0.1, 5, 0.1, {
      hint: "Also used for the fused world skeletons",
    }),
    beta: num("beta", 0, 5, 0.05, { hint: "Higher = less lag on fast moves" }),
    "merge radius (m)": num("fuseDist", 0.2, 2, 0.05, {
      hint: "Detections from different cameras closer than this on the floor are the same person",
    }),
  });

  useControls("Depth", {
    view: { value: DEFAULTS.mode, options: VIEW_OPTIONS, onChange: on("mode") },
    "processing width": {
      value: DEFAULTS.procW,
      options: [320, 480, 640, 960],
      onChange: on("procW"),
    },
    "match window": {
      value: DEFAULTS.window,
      options: WINDOW_OPTIONS,
      onChange: on("window"),
    },
    "max disparity": num("maxD", 16, 128, 8),
    "min confidence": num("minConf", 0, 0.5, 0.01),
    "median filter": { value: DEFAULTS.median, onChange: on("median") },
    "right-eye Y offset": num("yOffset", -8, 8, 0.25, {
      hint: "Use the anaglyph view to line rows up",
    }),
    "near (m)": num("near", 0.2, 3, 0.1),
    "far (m)": num("far", 1, 20, 0.5),
  });

  return null;
}

function CameraFolder({ i, cam, devices, catalog, emitCam, actions }) {
  const k = (s) => `c${i}_${s}`;
  const on = (key) => (v, _p, ctx) => emitCam(i, key, v, ctx);
  const ex = (key, label, min, max, step) => ({
    label,
    value: cam.extr[key],
    min,
    max,
    step,
    onChange: on(key),
  });

  const calibOptions = {
    "auto (match model)": "auto",
    "none (approximate)": "none",
  };
  const options = deviceOptions(devices);
  if (cam.deviceId.startsWith("recording:"))
    options["recorded stereo"] = cam.deviceId;
  for (const e of catalog) calibOptions[`SN${e.serial} · ${e.model}`] = e.file;
  if (cam.customName) calibOptions[`upload: ${cam.customName}`] = "custom";

  const placeOpts = { reset: () => actions.resetPlacement(i) };
  if (i > 0) placeOpts["auto-align to cam 1"] = () => actions.align(i);

  const [, set] = useControls(
    `Camera ${i + 1}`,
    () => ({
      [k("device")]: {
        label: "device",
        value: cam.deviceId,
        options,
        onChange: on("device"),
      },
      [k("calib")]: {
        label: "calibration",
        value: cam.calibChoice,
        options: calibOptions,
        onChange: on("calib"),
      },
      [k("upsideDown")]: {
        label: "upside down (180°)",
        value: cam.upsideDown,
        onChange: on("upsideDown"),
        hint: "Upright pose input and camera axes; stereo calibration stays in sensor coordinates. Roll is residual tilt after this correction.",
      },
      [k("brightness")]: {
        label: "input brightness",
        value: cam.imageBrightness,
        min: 0.5,
        max: 10,
        step: 0.05,
        onChange: on("brightness"),
        hint: "Per-camera image and pose compensation",
      },
      [k("contrast")]: {
        label: "input contrast",
        value: cam.imageContrast,
        min: 0.5,
        max: 2.5,
        step: 0.05,
        onChange: on("contrast"),
        hint: "Per-camera image and pose compensation",
      },
      [k("calibInfo")]: {
        label: "calib status",
        value: cam.calibText,
        editable: false,
        rows: 2,
      },
      [k("calibBtns")]: buttonGroup({
        label: "custom .conf",
        opts: { "load…": () => actions.loadCalib(i) },
      }),
      [k("x")]: ex("x", "x (m) →", -20, 20, 0.01),
      [k("y")]: ex("y", "y (m) ↓", -5, 5, 0.01),
      [k("z")]: ex("z", "z (m) fwd", -20, 20, 0.01),
      [k("yaw")]: ex("yaw", "yaw (°)", -180, 180, 0.5),
      [k("pitch")]: ex("pitch", "pitch (°)", -60, 60, 0.5),
      [k("roll")]: ex("roll", "roll (°)", -30, 30, 0.5),
      [k("placeBtns")]: buttonGroup({ label: "placement", opts: placeOpts }),
      [`fps · cam ${i + 1}`]: monitor(() => actions.stats(i).fps, {
        graph: true,
        interval: 250,
      }),
      [`pose ms · cam ${i + 1}`]: monitor(() => actions.stats(i).poseMs, {
        graph: true,
        interval: 250,
      }),
    }),
    { order: -2 },
    [devices, catalog, cam.customName],
  );

  // re-sync when main.js changes things (device start, auto-align, calibration upload)
  useEffect(() => {
    // Leva briefly returns an unbound setter while a dynamic folder is being
    // replaced (for example when a camera device is connected). Do not let
    // that transient state tear down the entire controls island.
    if (typeof set !== "function") return;
    try {
      set({
        [k("device")]: cam.deviceId,
        [k("calib")]: cam.calibChoice,
        [k("upsideDown")]: cam.upsideDown,
        [k("brightness")]: cam.imageBrightness,
        [k("contrast")]: cam.imageContrast,
        [k("x")]: cam.extr.x,
        [k("y")]: cam.extr.y,
        [k("z")]: cam.extr.z,
        [k("yaw")]: cam.extr.yaw,
        [k("pitch")]: cam.extr.pitch,
        [k("roll")]: cam.extr.roll,
      });
    } catch {
      // The folder can be between registrations during a device reconnect.
    }
  }, [cam.rev, cam.calibChoice, cam.deviceId, set]);
  useEffect(() => {
    if (typeof set === "function") {
      try {
        set({ [k("calibInfo")]: cam.calibText });
      } catch {
        // Dynamic Leva folder is not registered yet.
      }
    }
  }, [cam.calibText, set]);

  return null;
}

function App({ props, emit, emitCam, actions }) {
  return h(
    Fragment,
    null,
    h(Leva, {
      fill: true,
      flat: true,
      titleBar: { title: "Tracking controls", drag: false, filter: true },
      hideCopyButton: true,
      theme: {
        sizes: { rootWidth: "360px", controlWidth: "60%" },
        colors: {
          elevation1: "#101328",
          elevation2: "#171b32",
          elevation3: "#252a46",
          accent1: "#433764",
          accent2: "#7f65bc",
          accent3: "#ad8de7",
          highlight1: "#716a87",
          highlight2: "#bdb4d0",
          highlight3: "#e2d9f2",
        },
      },
    }),
    h(GlobalControls, { props, emit, actions }),
    ...props.cameras.map((cam, i) =>
      h(CameraFolder, {
        key: i,
        i,
        cam,
        devices: props.devices,
        catalog: props.catalog,
        emitCam,
        actions,
      }),
    ),
  );
}

export function mountControls(el, { emit, emitCam, actions }) {
  const root = createRoot(el);
  let props = { devices: [], catalog: [], cameras: [], camCaps: null };
  const render = () => root.render(h(App, { props, emit, emitCam, actions }));
  render();
  return {
    syncSettings(settings) {
      const paths = {
        res: "Cameras.resolution",
        poseOn: "Pose.enabled",
        poseModel: "Pose.model",
        numPoses: "Pose.max people",
        poseConf: "Pose.min detect conf",
        boostB: "Pose.input brightness",
        boostC: "Pose.input contrast",
        mergeDupes: "Filtering.merge duplicates",
        sizeFilter: "Filtering.ignore odd sizes",
        minBody: "Filtering.min torso (m)",
        maxBody: "Filtering.max torso (m)",
        showRaw: "Smoothing + fusion.raw skeleton",
        showSmooth: "Smoothing + fusion.smoothed skeleton",
        mc2: "Smoothing + fusion.2D cutoff (Hz)",
        mc3: "Smoothing + fusion.3D cutoff (Hz)",
        beta: "Smoothing + fusion.beta",
        fuseDist: "Smoothing + fusion.merge radius (m)",
        mode: "Depth.view",
        procW: "Depth.processing width",
        window: "Depth.match window",
        maxD: "Depth.max disparity",
        minConf: "Depth.min confidence",
        median: "Depth.median filter",
        yOffset: "Depth.right-eye Y offset",
        near: "Depth.near (m)",
        far: "Depth.far (m)",
      };
      for (const [key, path] of Object.entries(paths))
        if (levaStore.getData()[path])
          levaStore.setValueAtPath(path, settings[key], false);
    },
    update(patch) {
      props = { ...props, ...patch };
      render();
    },
  };
}
