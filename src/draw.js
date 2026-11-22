import { POSE_CONNECTIONS } from './pose.js';
import { apply } from './fusion.js';

export const PERSON_COLORS = ['#4fc3f7', '#ffb74d', '#ba68c8', '#81c784', '#f06292', '#fff176', '#4db6ac', '#ff8a65'];
export const CAM_COLORS = ['#cfd8dc', '#ffe082', '#80cbc4', '#ce93d8'];
export const MIN_VIS = 0.5;

export const colorForId = (id) => (id == null ? '#9e9e9e' : PERSON_COLORS[(id - 1) % PERSON_COLORS.length]);
export const usable = (j) => j.p3 && !j.rejected;

export function turboCss(x) {
  x = Math.min(1, Math.max(0, x));
  const x2 = x * x, x3 = x2 * x, x4 = x2 * x2, x5 = x4 * x;
  const r = 0.13572138 + 4.6153926 * x - 42.66032258 * x2 + 132.13108234 * x3 - 152.94239396 * x4 + 59.28637943 * x5;
  const g = 0.09140261 + 2.19418839 * x + 4.84296658 * x2 - 14.18503333 * x3 + 4.27729857 * x4 + 2.82956604 * x5;
  const b = 0.1066733 + 12.64194608 * x - 60.58204836 * x2 + 110.36276771 * x3 - 89.90310912 * x4 + 27.34824973 * x5;
  const c = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

export const depthColor = (z, near, far) => turboCss(1 - (z - near) / Math.max(0.1, far - near));

/** 2D skeleton on an image overlay. joints: [{ x, y (normalised), vis, p3? }] */
export function drawSkeleton(ctx, joints, w, h, color, { lineWidth = 3, alpha = 1, dots = true, near = 0.4, far = 6, dash = null } = {}) {
  ctx.globalAlpha = alpha;
  ctx.setLineDash(dash || []);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  for (const { start, end } of POSE_CONNECTIONS) {
    const a = joints[start];
    const b = joints[end];
    if (a.vis < MIN_VIS || b.vis < MIN_VIS) continue;
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.stroke();
  }
  if (dots) {
    for (const j of joints) {
      if (j.vis < MIN_VIS) continue;
      ctx.beginPath();
      ctx.arc(j.x * w, j.y * h, lineWidth + 1, 0, Math.PI * 2);
      ctx.fillStyle = usable(j) ? depthColor(j.p3.z, near, far) : '#777';
      ctx.fill();
    }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

export function drawLabel(ctx, joints, text, color, w, h) {
  const head = joints[0];
  ctx.font = '600 13px system-ui, sans-serif';
  const tw = ctx.measureText(text).width;
  const lx = Math.min(w - tw - 10, Math.max(2, head.x * w - tw / 2 - 4));
  const ly = Math.max(2, head.y * h - 34);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(lx, ly, tw + 8, 20);
  ctx.fillStyle = color;
  ctx.fillText(text, lx + 4, ly + 14);
}

/**
 * Top-down world map, rotated for the operator. Fits the room and camera cones.
 * cams: [{ index, pose, halfFov }]   tracks: world tracks ({ id, joints[].p3, cams })
 */
export function drawTop(ctx, W, H, { cams, tracks, far, markers = [], wall, bounds }) {
  // Installation reference: X=0 is the assumed wall midpoint, Z=0 the camera line.
  const ft = 0.3048, halfWidth = 43 * ft / 2, front = 20 * ft, back = -1.5 * ft;
  const pts = [[-halfWidth, back], [halfWidth, front]];
  for (const p of markers) pts.push([p.world.x,p.world.z]);
  for (const c of cams) {
    pts.push([c.pose.t.x, c.pose.t.z]);
    for (let k = -4; k <= 4; k++) {
      const a = (k / 4) * c.halfFov;
      const d = apply(c.pose.R, { x: Math.sin(a) * far, y: 0, z: Math.cos(a) * far });
      pts.push([c.pose.t.x + d.x, c.pose.t.z + d.z]);
    }
  }
  let [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, z] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  minX -= 0.5;
  maxX += 0.5;
  minZ -= 0.5;
  maxZ += 0.3;
  if (bounds) [minX,maxX,minZ,maxZ] = bounds;
  const s = Math.min(W / (maxX - minX), H / (maxZ - minZ));
  const offX = (W - (maxX - minX) * s) / 2;
  const offY = (H - (maxZ - minZ) * s) / 2;
  // The physical room is viewed from the opposite side of the canvas. Rotate
  // the top-down map 180° (both axes) while leaving labels/text upright.
  const P = (x, z) => [offX + (maxX - x) * s, offY + (z - minZ) * s];

  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, W, H);

  // 1 m grid, brighter every 5 m
  ctx.lineWidth = 1;
  ctx.font = '10px system-ui, sans-serif';
  for (let x = Math.ceil(minX); x <= maxX; x++) {
    ctx.strokeStyle = x % 5 === 0 ? '#26313c' : '#151b22';
    const [px] = P(x, 0);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
    ctx.stroke();
  }
  for (let z = Math.ceil(minZ); z <= maxZ; z++) {
    ctx.strokeStyle = z % 5 === 0 ? '#26313c' : '#151b22';
    const [, py] = P(0, z);
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(W, py);
    ctx.stroke();
    if (z > 0) {
      ctx.fillStyle = '#4a5662';
      ctx.fillText(`${z} m`, 4, py - 3);
    }
  }

  const [left, rearY] = P(halfWidth, back);
  const [right, wallY] = P(-halfWidth, front);
  ctx.strokeStyle = '#465164';
  ctx.strokeRect(left, rearY, right - left, wallY - rearY);
  ctx.strokeStyle = '#dfb7ff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(left, wallY);
  ctx.lineTo(right, wallY);
  ctx.stroke();
  ctx.fillStyle = '#dfb7ff';
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillText('Projection wall · 43 ft', left + 5, wallY - 6);
  ctx.lineWidth = 1;

  // camera cones
  for (const c of cams) {
    const color = CAM_COLORS[c.index % CAM_COLORS.length];
    const o = P(c.pose.t.x, c.pose.t.z);
    ctx.beginPath();
    ctx.moveTo(...o);
    for (let k = -8; k <= 8; k++) {
      const a = (k / 8) * c.halfFov;
      const d = apply(c.pose.R, { x: Math.sin(a) * far, y: 0, z: Math.cos(a) * far });
      ctx.lineTo(...P(c.pose.t.x + d.x, c.pose.t.z + d.z));
    }
    ctx.closePath();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(o[0], o[1], 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(`cam ${c.index + 1}`, o[0] + 8, o[1] - 4);
  }

  if (wall) {
    const [a,b]=wall.map(([x,z])=>P(x,z));
    ctx.strokeStyle="#87edc8";
    ctx.lineWidth=2;
    ctx.setLineDash([6,4]);
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle="#87edc8";
    ctx.fillText("Estimated wall",(a[0]+b[0])/2,(a[1]+b[1])/2+28);
  }

  // people
  for (const p of markers) {
    const [x,y]=P(p.world.x,p.world.z);
    const label=["Center","Left","Right"][p.stop]+" · cam "+(p.camera+1);
    ctx.fillStyle=CAM_COLORS[p.camera];
    ctx.fillRect(x-3,y-3,6,6);
    ctx.font="600 12px system-ui, sans-serif";
    const tx=Math.max(2,Math.min(x+6,W-ctx.measureText(label).width-2));
    const ty=Math.max(13,Math.min(H-2,y+(p.camera===0 ? -8 : 16)));
    ctx.strokeStyle="#0b0d10"; ctx.lineWidth=3;
    ctx.strokeText(label,tx,ty); ctx.fillText(label,tx,ty);
  }
  const pt = (j) => P(j.p3.x, j.p3.z);
  for (const t of tracks) {
    const color = colorForId(t.id);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (const { start, end } of POSE_CONNECTIONS) {
      const a = t.joints[start];
      const b = t.joints[end];
      if (!a.p3 || !b.p3) continue;
      ctx.beginPath();
      ctx.moveTo(...pt(a));
      ctx.lineTo(...pt(b));
      ctx.stroke();
    }
    if (t.center) {
      const [x, y] = P(t.center.x, t.center.z);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText(`#${t.id}  cam ${t.cams.map((i) => i + 1).join('+')}`, x + 9, y + 4);
    }
  }
  return {scale:s, bounds:[minX,maxX,minZ,maxZ], handles:cams.map(c=>({
    index:c.index, xy:P(c.pose.t.x,c.pose.t.z)
  }))};
}
