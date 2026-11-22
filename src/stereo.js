// Real-time stereo depth on the GPU (WebGL2).
//
// Pipeline (all render targets are stored top-down: texel row 0 = image row 0):
//   1. rectify  : side-by-side video -> undistorted, downsampled grayscale (R = left, G = right)
//   2. census   : 7x7 sparse census transform (24 bits) per eye -> RG32UI
//   3. match    : per pixel, scan disparities, aggregate Hamming cost over a window,
//                 winner-takes-all + sub-pixel parabola fit + uniqueness confidence -> RGBA32F
//   4. filter   : confidence threshold + optional 3x3 median -> RGBA32F (r = disparity px, g = confidence)
//   5. display  : turbo-coloured depth / disparity / confidence / anaglyph to the canvas
// The filtered disparity is read back asynchronously (PBO + fence) for 3D joint lookup.

const MAX_D = 128;

const VS = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const RECTIFY_FS = `#version 300 es
precision highp float;
uniform sampler2D uVideo;
uniform vec2 uCapSize;
uniform vec2 uEyeSize;
uniform vec2 uProcSize;
uniform vec3 uRect;          // f, cx, cy of the shared rectified camera (eye px)
uniform vec4 uKL, uKR;       // fx, fy, cx, cy
uniform vec4 uDL, uDR;       // k1, k2, p1, p2
uniform vec2 uK3;            // k3 left, k3 right
uniform float uYOffset;      // manual vertical nudge of the right eye (eye px)
out vec4 o;

vec2 toRaw(vec2 p, vec4 K, vec4 D, float k3) {
  vec2 n = (p - uRect.yz) / uRect.x;
  float r2 = dot(n, n);
  float rad = 1.0 + D.x * r2 + D.y * r2 * r2 + k3 * r2 * r2 * r2;
  vec2 d = n * rad + vec2(2.0 * D.z * n.x * n.y + D.w * (r2 + 2.0 * n.x * n.x),
                          D.z * (r2 + 2.0 * n.y * n.y) + 2.0 * D.w * n.x * n.y);
  return d * K.xy + K.zw;
}

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float sampleEye(vec2 raw, float xOff) {
  raw.x = clamp(raw.x, 0.0, uEyeSize.x - 1.0); // never bleed into the other eye
  vec2 uv = vec2((raw.x + 0.5 + xOff) / uCapSize.x, (raw.y + 0.5) / uCapSize.y);
  return lum(texture(uVideo, uv).rgb);
}

void main() {
  vec2 scale = uEyeSize / uProcSize;
  vec2 base = gl_FragCoord.xy * scale - 0.5;
  vec2 q = 0.25 * scale;
  float gL = 0.0, gR = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 p = base + vec2((i & 1) == 0 ? -q.x : q.x, i < 2 ? -q.y : q.y);
    gL += sampleEye(toRaw(p, uKL, uDL, uK3.x), 0.0);
    gR += sampleEye(toRaw(p, uKR, uDR, uK3.y) + vec2(0.0, uYOffset), uEyeSize.x);
  }
  o = vec4(gL * 0.25, gR * 0.25, 0.0, 1.0);
}`;

const CENSUS_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uGray;
layout(location = 0) out uvec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 mx = textureSize(uGray, 0) - 1;
  vec2 c = texelFetch(uGray, p, 0).rg;
  uint bl = 0u, br = 0u, bit = 0u;
  for (int dy = -3; dy <= 3; dy++) {
    for (int dx = -3; dx <= 3; dx++) {
      if (((dx + dy) & 1) != 0 || (dx == 0 && dy == 0)) continue;
      vec2 n = texelFetch(uGray, clamp(p + ivec2(dx, dy), ivec2(0), mx), 0).rg;
      if (n.r < c.r) bl |= (1u << bit);
      if (n.g < c.g) br |= (1u << bit);
      bit++;
    }
  }
  o = uvec4(bl, br, 0u, 0u);
}`;

function matchFS(offsets) {
  const N = offsets.length;
  const loadL = offsets
    .map(([x, y], i) => `  cl[${i}] = texelFetch(uCensus, clamp(p + ivec2(${x}, ${y}), ivec2(0), mx), 0).r;`)
    .join('\n');
  const cost = offsets
    .map(([x, y], i) => `    s += popc(cl[${i}] ^ texelFetch(uCensus, ivec2(clamp(xr + ${x}, 0, mx.x), clamp(p.y + ${y}, 0, mx.y)), 0).g);`)
    .join('\n');
  return `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uCensus;
uniform int uMaxD;
layout(location = 0) out vec4 o;

uint popc(uint v) {
  v = v - ((v >> 1u) & 0x55555555u);
  v = (v & 0x33333333u) + ((v >> 2u) & 0x33333333u);
  return (((v + (v >> 4u)) & 0x0F0F0F0Fu) * 0x01010101u) >> 24u;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 mx = textureSize(uCensus, 0) - 1;
  uint cl[${N}];
${loadL}
  float best = 1e9, second = 1e9, prev = 1e9, cBefore = 1e9, cAfter = 1e9;
  int bestD = -1;
  bool wantAfter = false;
  for (int d = 0; d < ${MAX_D}; d++) {
    if (d >= uMaxD) break;
    int xr = p.x - d;
    if (xr < 0) break;
    uint s = 0u;
${cost}
    float c = float(s);
    if (wantAfter) { cAfter = c; wantAfter = false; }
    if (c < best) {
      if (d - bestD > 1) second = min(second, best);
      cBefore = prev; best = c; bestD = d; cAfter = 1e9; wantAfter = true;
    } else if (d - bestD > 1 && c < second) {
      second = c;
    }
    prev = c;
  }
  float disp = 0.0;
  if (bestD > 0) {
    disp = float(bestD);
    if (cBefore < 1e8 && cAfter < 1e8) {
      float denom = cBefore - 2.0 * best + cAfter;
      if (denom > 0.0) disp += clamp(0.5 * (cBefore - cAfter) / denom, -0.5, 0.5);
    }
  }
  float conf = second < 1e8 ? clamp((second - best) / max(second, 1.0), 0.0, 1.0) : 0.0;
  o = vec4(disp, conf, best / ${N * 24}.0, 1.0);
}`;
}

const FILTER_FS = `#version 300 es
precision highp float;
uniform sampler2D uDisp;
uniform float uMinConf;
uniform bool uMedian;
layout(location = 0) out vec4 o;
float val(ivec2 q, ivec2 mx) {
  vec4 t = texelFetch(uDisp, clamp(q, ivec2(0), mx), 0);
  return t.g >= uMinConf ? t.r : 0.0;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 mx = textureSize(uDisp, 0) - 1;
  vec4 c = texelFetch(uDisp, p, 0);
  float r = c.g >= uMinConf ? c.r : 0.0;
  if (uMedian && r > 0.0) {
    float v[9];
    int k = 0;
    for (int dy = -1; dy <= 1; dy++)
      for (int dx = -1; dx <= 1; dx++) v[k++] = val(p + ivec2(dx, dy), mx);
    for (int i = 0; i < 5; i++)
      for (int j = i + 1; j < 9; j++)
        if (v[j] < v[i]) { float t = v[i]; v[i] = v[j]; v[j] = t; }
    r = v[4];
  }
  o = vec4(r, c.g, c.b, 1.0);
}`;

const DISPLAY_FS = `#version 300 es
precision highp float;
uniform sampler2D uDisp;
uniform sampler2D uGray;
uniform int uMode;      // 0 depth, 1 disparity, 2 confidence, 3 anaglyph
uniform float uFB;      // focal (proc px) * baseline (m)
uniform vec2 uRange;    // near, far (m)
uniform float uMaxD;
in vec2 vUv;
out vec4 o;

vec3 turbo(float x) {
  const vec4 kR4 = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
  const vec4 kG4 = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
  const vec4 kB4 = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
  const vec2 kR2 = vec2(-152.94239396, 59.28637943);
  const vec2 kG2 = vec2(4.27729857, 2.82956604);
  const vec2 kB2 = vec2(-89.90310912, 27.34824973);
  x = clamp(x, 0.0, 1.0);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;
  return vec3(dot(v4, kR4) + dot(v2, kR2), dot(v4, kG4) + dot(v2, kG2), dot(v4, kB4) + dot(v2, kB2));
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  if (uMode == 3) {
    vec2 g = texture(uGray, uv).rg;
    o = vec4(g.r, g.g, g.g, 1.0);
    return;
  }
  vec4 d = texture(uDisp, uv);
  if (uMode == 2) { o = vec4(vec3(d.g), 1.0); return; }
  if (d.r <= 0.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  if (uMode == 1) { o = vec4(turbo(d.r / uMaxD), 1.0); return; }
  float z = uFB / d.r;
  float t = clamp((z - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
  o = vec4(turbo(1.0 - t), 1.0);
}`;

export const WINDOWS = {
  '3x3': dense(1),
  '5x5s': sparse([-2, 0, 2]),
  '5x5': dense(2),
  '9x9s': sparse([-4, -2, 0, 2, 4]),
};
function dense(r) {
  const o = [];
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) o.push([x, y]);
  return o;
}
function sparse(steps) {
  const o = [];
  for (const y of steps) for (const x of steps) o.push([x, y]);
  return o;
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader compile failed:\n${log}`);
  }
  return s;
}

function makeProgram(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

export class StereoDepth {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is not supported');
    this.gl = gl;
    this.canvas = canvas;
    this.params = {
      maxD: 64,
      window: '5x5',
      minConf: 0.08,
      median: true,
      yOffset: 0,
      mode: 0,
      near: 0.4,
      far: 6,
    };

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.videoTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.progRectify = makeProgram(gl, RECTIFY_FS);
    this.progCensus = makeProgram(gl, CENSUS_FS);
    this.progFilter = makeProgram(gl, FILTER_FS);
    this.progDisplay = makeProgram(gl, DISPLAY_FS);
    this.matchPrograms = {};

    this.targets = [];
    this.pbo = gl.createBuffer();
    this.sync = null;
    this.dispData = null;
    this.dispValid = false;
  }

  _matchProgram() {
    const key = this.params.window;
    if (!this.matchPrograms[key]) this.matchPrograms[key] = makeProgram(this.gl, matchFS(WINDOWS[key]));
    return this.matchPrograms[key];
  }

  _target(format, w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Framebuffer incomplete (0x${status.toString(16)})`);
    const t = { tex, fb };
    this.targets.push(t);
    return t;
  }

  /** (Re)allocate GPU buffers for a capture size / processing size / calibration. */
  configure({ capW, capH, procW, procH, calib }) {
    const gl = this.gl;
    for (const t of this.targets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fb);
    }
    this.targets = [];
    if (this.sync) gl.deleteSync(this.sync);
    this.sync = null;

    Object.assign(this, { capW, capH, eyeW: capW / 2, eyeH: capH, procW, procH, calib });
    this.gray = this._target(gl.RGBA8, procW, procH);
    this.census = this._target(gl.RG32UI, procW, procH);
    this.dispRaw = this._target(gl.RGBA32F, procW, procH);
    this.disp = this._target(gl.RGBA32F, procW, procH);

    this.canvas.width = procW;
    this.canvas.height = procH;

    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, procW * procH * 16, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.dispData = new Float32Array(procW * procH * 4);
    this.dispValid = false;
  }

  /** Focal length in processing pixels. */
  get focalProc() {
    return (this.calib.rect.f * this.procW) / this.eyeW;
  }

  _bindTex(unit, tex, loc) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  _draw(fb, w, h) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  process(video) {
    const gl = this.gl;
    const { procW: w, procH: h, calib: c, params } = this;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    // 1. rectify + gray
    let P = this.progRectify;
    gl.useProgram(P.p);
    this._bindTex(0, this.videoTex, P.u.uVideo);
    gl.uniform2f(P.u.uCapSize, this.capW, this.capH);
    gl.uniform2f(P.u.uEyeSize, this.eyeW, this.eyeH);
    gl.uniform2f(P.u.uProcSize, w, h);
    gl.uniform3f(P.u.uRect, c.rect.f, c.rect.cx, c.rect.cy);
    gl.uniform4f(P.u.uKL, c.left.fx, c.left.fy, c.left.cx, c.left.cy);
    gl.uniform4f(P.u.uKR, c.right.fx, c.right.fy, c.right.cx, c.right.cy);
    gl.uniform4f(P.u.uDL, c.left.k1, c.left.k2, c.left.p1, c.left.p2);
    gl.uniform4f(P.u.uDR, c.right.k1, c.right.k2, c.right.p1, c.right.p2);
    gl.uniform2f(P.u.uK3, c.left.k3, c.right.k3);
    gl.uniform1f(P.u.uYOffset, params.yOffset);
    this._draw(this.gray.fb, w, h);

    // 2. census
    P = this.progCensus;
    gl.useProgram(P.p);
    this._bindTex(0, this.gray.tex, P.u.uGray);
    this._draw(this.census.fb, w, h);

    // 3. match
    P = this._matchProgram();
    gl.useProgram(P.p);
    this._bindTex(0, this.census.tex, P.u.uCensus);
    gl.uniform1i(P.u.uMaxD, Math.min(params.maxD, MAX_D));
    this._draw(this.dispRaw.fb, w, h);

    // 4. filter
    P = this.progFilter;
    gl.useProgram(P.p);
    this._bindTex(0, this.dispRaw.tex, P.u.uDisp);
    gl.uniform1f(P.u.uMinConf, params.minConf);
    gl.uniform1i(P.u.uMedian, params.median ? 1 : 0);
    this._draw(this.disp.fb, w, h);

    // 5. display
    P = this.progDisplay;
    gl.useProgram(P.p);
    this._bindTex(0, this.disp.tex, P.u.uDisp);
    this._bindTex(1, this.gray.tex, P.u.uGray);
    gl.uniform1i(P.u.uMode, params.mode);
    gl.uniform1f(P.u.uFB, this.focalProc * c.baseline);
    gl.uniform2f(P.u.uRange, params.near, params.far);
    gl.uniform1f(P.u.uMaxD, params.maxD);
    this._draw(null, w, h);
  }

  /** Kick off an async readback of the filtered disparity (no-op if one is in flight). */
  startReadback() {
    if (this.sync) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.disp.fb);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(0, 0, this.procW, this.procH, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }

  /** Collect a finished readback, if any. Call once per frame. */
  pollReadback() {
    if (!this.sync) return;
    const gl = this.gl;
    const status = gl.clientWaitSync(this.sync, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) return;
    gl.deleteSync(this.sync);
    this.sync = null;
    if (status === gl.WAIT_FAILED) return;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.dispData);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.dispValid = true;
  }

  /** Median valid disparity (proc px) around a processing-pixel location, or null. */
  sampleDisparity(px, py, radius = 2) {
    if (!this.dispValid) return null;
    const { procW: w, procH: h, dispData: d } = this;
    const cx = Math.round(px);
    const cy = Math.round(py);
    const vals = [];
    for (let y = cy - radius; y <= cy + radius; y++) {
      if (y < 0 || y >= h) continue;
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (x < 0 || x >= w) continue;
        const v = d[(y * w + x) * 4];
        if (v > 0) vals.push(v);
      }
    }
    if (vals.length < 3) return null;
    vals.sort((a, b) => a - b);
    return vals[vals.length >> 1];
  }
}
