// ZED calibration helpers.
//
// Every ZED ships with a factory calibration file, downloadable from
//   https://calib.stereolabs.com/?SN=<serial number>
// It's an INI file with per-resolution intrinsics for each eye plus stereo extrinsics.
// Without it we fall back to approximate ZED 2 intrinsics and no undistortion.

// Full side-by-side capture width -> ZED resolution key used in the .conf file
const MODE_BY_WIDTH = { 4416: '2K', 3840: 'FHD', 2560: 'HD', 1344: 'VGA' };

// Approximate per-model intrinsics, used only when no .conf is loaded.
// ZED 2 / 2i (2.1 mm lens): wide ~100° H at HD. ZED Mini and original ZED: ~85° H.
// A ZED 2i with the optional 4 mm lens can't be told apart by USB name – load its .conf.
const WIDE_FX = { '2K': 1060, FHD: 1060, HD: 530, VGA: 265 };
const STD_FX = { '2K': 1400, FHD: 1400, HD: 700, VGA: 350 };
const MODELS = {
  'ZED 2i': { baseline: 0.12, fx: WIDE_FX },
  'ZED 2': { baseline: 0.12, fx: WIDE_FX },
  'ZED Mini': { baseline: 0.063, fx: STD_FX },
  ZED: { baseline: 0.12, fx: STD_FX },
};

/** Best guess at the ZED model from the browser's device label (e.g. "ZED 2", "ZED 2i", "ZED-M"). */
export function modelFromLabel(label = '') {
  if (/zed[\s-]?2i/i.test(label)) return 'ZED 2i';
  if (/zed[\s-]?2/i.test(label)) return 'ZED 2';
  if (/zed[\s-]?(m\b|mini)/i.test(label)) return 'ZED Mini';
  if (/zed/i.test(label)) return 'ZED';
  return 'ZED 2'; // unknown camera – assume the most common model
}

export function modeForWidth(capW) {
  return MODE_BY_WIDTH[capW] ?? null;
}

export function parseConf(text) {
  const out = {};
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      section = sec[1].trim();
      out[section] = {};
      continue;
    }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (kv && section) out[section][kv[1].trim()] = parseFloat(kv[2]);
  }
  return out;
}

function eyeFromConf(c) {
  return {
    fx: c.fx, fy: c.fy, cx: c.cx, cy: c.cy,
    k1: c.k1 ?? 0, k2: c.k2 ?? 0, p1: c.p1 ?? 0, p2: c.p2 ?? 0, k3: c.k3 ?? 0,
  };
}

/**
 * Build the calibration used by the stereo pipeline.
 * Both eyes are undistorted into one shared pinhole camera (`rect`), so rows line up
 * and disparity = left.x - right.x directly. Small inter-eye rotations are ignored.
 */
export function buildCalib(conf, mode, eyeW, eyeH, model = 'ZED 2') {
  const left = conf?.[`LEFT_CAM_${mode}`];
  const right = conf?.[`RIGHT_CAM_${mode}`];
  const stereo = conf?.STEREO;

  if (left && right && stereo?.Baseline) {
    const L = eyeFromConf(left);
    const R = eyeFromConf(right);
    return {
      approx: false,
      model, mode, eyeW, eyeH,
      baseline: stereo.Baseline / 1000, // mm -> m
      left: L,
      right: R,
      rect: {
        f: (L.fx + L.fy + R.fx + R.fy) / 4,
        cx: (L.cx + R.cx) / 2,
        cy: (L.cy + R.cy) / 2,
      },
    };
  }

  const profile = MODELS[model] ?? MODELS['ZED 2'];
  const fx = profile.fx[mode] ?? (profile.fx.HD * eyeW) / 1280;
  const eye = { fx, fy: fx, cx: (eyeW - 1) / 2, cy: (eyeH - 1) / 2, k1: 0, k2: 0, p1: 0, p2: 0, k3: 0 };
  return {
    approx: true,
    model,
    missingMode: !!conf, // a .conf was loaded but has no section for this mode
    mode, eyeW, eyeH,
    baseline: profile.baseline,
    left: { ...eye },
    right: { ...eye },
    rect: { f: fx, cx: eye.cx, cy: eye.cy },
  };
}

/** Raw (distorted) eye pixel -> rectified eye pixel. Inverse of the shader's mapping. */
export function rawToRect(cal, eyeName, u, v) {
  const c = cal[eyeName];
  const xd = (u - c.cx) / c.fx;
  const yd = (v - c.cy) / c.fy;
  let x = xd;
  let y = yd;
  for (let i = 0; i < 8; i++) {
    const r2 = x * x + y * y;
    const rad = 1 + c.k1 * r2 + c.k2 * r2 * r2 + c.k3 * r2 * r2 * r2;
    const dx = 2 * c.p1 * x * y + c.p2 * (r2 + 2 * x * x);
    const dy = c.p1 * (r2 + 2 * y * y) + 2 * c.p2 * x * y;
    x = (xd - dx) / rad;
    y = (yd - dy) / rad;
  }
  return [cal.rect.f * x + cal.rect.cx, cal.rect.f * y + cal.rect.cy];
}
