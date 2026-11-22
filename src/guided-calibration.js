import { toWorld } from "./fusion.js";
import { Vector3 } from "three";

export const stops = ["Center near the wall", "Left corner near the wall",
  "Right corner near the wall"];

export function inTPose(joints, aspect) {
  const [ls, rs, le, re, lw, rw, lh, rh] = [11,12,13,14,15,16,23,24].map(i => joints[i]);
  if (![ls,rs,le,re,lw,rw,lh,rh].every(j => j && j.vis >= 0.6)) return false;
  const torso = (lh.y + rh.y - ls.y - rs.y) / 2;
  if (torso <= 0) return false;
  return [[ls,le,lw,rs],[rs,re,rw,ls]].every(([s,e,w,other]) => {
    const dir = Math.sign(s.x - other.x);
    return dir * (e.x-s.x) > 0 && dir * (w.x-e.x) > 0 &&
      dir * (w.x-s.x) * aspect > torso * 0.58 &&
      Math.max(Math.abs(e.y-s.y), Math.abs(w.y-s.y)) < torso * 0.42;
  });
}

const vector = p => new Vector3(p.x,p.y,p.z);
function observeCamera(camera, now) {
  if (!camera.latest || now - camera.latest.t > 500) return {status:"waiting for frame"};
  // Use this camera's current detections before track confirmation and fusion.
  // The held pose and the sequence of stable stereo samples confirm the subject.
  const people = camera.people;
  if (!people.length) return {status:"no skeleton"};
  if (people.length !== 1) return {status:"multiple skeletons"};
  const [person] = people;
  const posed = inTPose(person.joints, camera.eyeW / camera.eyeH);
  if (!person.centerCam || !person.center) return {posed,status:"no torso depth"};
  return {person, posed, status:posed ? "T-pose" : "torso found · arms unconfirmed"};
}
const storageKey = "lunar:wall-captures-v1";

// Old captures only stored world coordinates. Anchor them to the loaded placement
// once, so both old and new measurements follow subsequent placement edits.
function anchor(point, cam) {
  if (point.local || !cam?.worldPose || !cam.deviceId || !cam.calib) return false;
  const { R, t } = cam.worldPose;
  const { x, y, z } = vector(point.world).sub(t);
  point.local = { x:R[0]*x+R[3]*y+R[6]*z, y:R[1]*x+R[4]*y+R[7]*z, z:R[2]*x+R[5]*y+R[8]*z };
  point.device = cam.deviceId;
  return true;
}

export function fitWall(points) {
  if (points.length !== 4) return null;
  const cx = points.reduce((sum,p)=>sum+p.world.x,0)/4;
  const cz = points.reduce((sum,p)=>sum+p.world.z,0)/4;
  let xx=0, xz=0, zz=0;
  for (const {world} of points) {
    const dx=world.x-cx, dz=world.z-cz;
    xx+=dx*dx; xz+=dx*dz; zz+=dz*dz;
  }
  const left=points.find(p=>p.stop===1), right=points.find(p=>p.stop===2);
  if (!left || !right || Math.hypot(left.world.x-right.world.x,left.world.z-right.world.z)<0.75) return null;
  const angle=Math.atan2(2*xz,xx-zz)/2;
  const dx=Math.cos(angle), dz=Math.sin(angle);
  return [left,right].map(({world})=>{
    const along=(world.x-cx)*dx+(world.z-cz)*dz;
    return [cx+along*dx,cz+along*dz];
  });
}

function stableHold(rows) {
  if (!rows.length) return {progress:0};
  const median = axis => rows.map(r=>r.world[axis]).sort((a,b)=>a-b)[rows.length >> 1];
  const middle = new Vector3(median("x"),median("y"),median("z"));
  const stable = rows.filter(r=>r.world.distanceTo(middle)<0.55);
  if (stable.length < rows.length*0.6) return {progress:0};
  const start=stable[0].t, end=stable.at(-1).t;
  const world=stable.reduce((sum,r)=>sum.add(r.world),new Vector3()).divideScalar(stable.length);
  return {start,end,world,progress:Math.min(1,stable.length/5,(end-start)/750)};
}

export function guidedCalibration(dialog, cameras) {
  const title=dialog.querySelector("h1"), hint=dialog.querySelector("p");
  let completed=[];
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved) && saved.length===4 && saved.every(p=>Number.isFinite(p.world?.x) && Number.isFinite(p.world?.z) && [0,1,2].includes(p.stop) && [0,1].includes(p.camera))) completed=saved;
  } catch { /* Storage is optional. */ }
  let step=0, points=[], buffers, seq, devices, generations, preferred;
  const pair=()=>cameras.slice(0,2);
  function announce(message) {
    title.textContent=message;
    if (window.speechSynthesis) {
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(message));
    }
  }
  function visual(cam, dim) {
    cam.posePanel?.classList.toggle("calibration-dim",dim);
    cam.depthPanel?.classList.toggle("calibration-dim",dim);
  }
  function clear() {
    pair().forEach(cam=>{visual(cam,false);cam.poseCheck.hidden=true;});
  }
  function prompt() {
    buffers=[[],[]]; seq=[-1,-1];
    // Either camera may capture the left corner. Reserve the other for the right.
    const left=cameras[0].extr?.x > cameras[1].extr?.x ? 1 : 0;
    preferred=step===2 ? 1-points.find(p=>p.stop===1).camera : left;
    pair().forEach((cam,i)=>{
      const dim=step>0 && i!==preferred;
      visual(cam,dim);
      cam.poseCheck.hidden=dim;
      cam.poseCheck.dataset.state="waiting";
      cam.poseCheck.textContent="";
    });
    announce(stops[step]+". Hold a T-pose.");
    hint.textContent="";
  }
  dialog.querySelector("[data-close]").onclick=()=>dialog.close();
  dialog.onclose=()=>{clear();window.speechSynthesis?.cancel();};
  return {
    get capturing() { return dialog.open && step<3; },
    get markers() {
      const source=this.capturing ? points : completed;
      let changed=false;
      const markers=source.map(p=>{
        const cam=cameras[p.camera];
        if (anchor(p,cam)) changed=true;
        return p.local && cam?.deviceId===p.device
          ? {...p,world:toWorld(cam.worldPose,p.local)} : p;
      });
      if (changed && source===completed) {
        try {localStorage.setItem(storageKey,JSON.stringify(completed));} catch {}
      }
      return markers;
    },
    alignCenters() {
      if (this.capturing) return false;
      const markers=this.markers;
      if (!fitWall(markers) || !markers.every(p=>p.local && p.device===cameras[p.camera]?.deviceId)) return false;
      const [a,b]=[0,1].map(i=>markers.find(p=>p.stop===0 && p.camera===i)?.world);
      if (!a || !b) return false;
      const dx=(b.x-a.x)/2, dz=(b.z-a.z)/2;
      pair().forEach((cam,i)=>{
        const sign=i===0 ? 1 : -1;
        cam.setExtrinsics({x:cam.extr.x+sign*dx,z:cam.extr.z+sign*dz},true);
      });
      return true;
    },
    start() {
      if (dialog.open) return;
      points=[];step=0;
      devices=pair().map(c=>c.deviceId);generations=pair().map(c=>c.generation);
      dialog.show();prompt();
    },
    tick(now) {
      if (!dialog.open || step===3) return;
      const cams=pair();
      if (!devices.every((id,i)=>cams[i]?.deviceId===id && cams[i].generation===generations[i] && cams[i].stream?.active)) {
        clear();title.textContent="Camera connection changed";hint.textContent="Close and restart calibration.";return;
      }
      const views=cams.map(c=>observeCamera(c,now));
      const atNewSpot=(world,i)=>points.every(p=>p.camera!==i || Math.hypot(p.world.x-world.x,p.world.z-world.z)>=0.75);
      const eligible=views.map((v,i)=>v.person && v.posed && atNewSpot(v.person.center,i));
      if (step===1 && !eligible[preferred] && eligible[1-preferred]) preferred=1-preferred;
      const used=step ? [preferred] : [0,1];
      cams.forEach((cam,i)=>{
        const v=views[i], active=used.includes(i);
        visual(cam,!active);
        const badge=cam.poseCheck;
        badge.hidden=!active;
        badge.dataset.state=v.posed ? (v.person ? "ready":"missing-depth"):"waiting";
        badge.textContent=v.posed?"✓":"";
        badge.title=v.status;
        badge.setAttribute("aria-label","Camera "+(i+1)+": "+v.status);
        buffers[i]=buffers[i].filter(r=>now-r.t<=1800);
        if (!active || v.status==="multiple skeletons" || (buffers[i].length && now-buffers[i].at(-1).t>550)) buffers[i]=[];
        if (!active || !v.person || !views.some((view,j)=>used.includes(j)&&view.posed) || !atNewSpot(v.person.center,i) || seq[i]===cam.seq) return;
        seq[i]=cam.seq;
        buffers[i].push({world:vector(v.person.center),t:cam.latest.t});
      });
      const holds=used.map(i=>stableHold(buffers[i]));
      let progress=Math.min(...holds.map(h=>h.progress));
      if (progress && !step) progress=Math.min(progress,Math.max(0,(Math.min(...holds.map(h=>h.end))-Math.max(...holds.map(h=>h.start)))/750));
      if (!used.every(i=>views[i].person) || !used.some(i=>views[i].posed)) {
        hint.textContent=used.map(i=>"Cam "+(i+1)+" · "+views[i].status).join(" / ");return;
      }
      hint.textContent=used.some(i=>!atNewSpot(views[i].person.center,i)) ? "Move to the next corner." : "Hold still · "+Math.round(progress*100)+"%";
      if (progress<1 || used.some(i=>!atNewSpot(views[i].person.center,i))) return;
      used.forEach((camera,j)=>points.push({stop:step,camera,world:holds[j].world}));
      step++;
      if (step<3) {prompt();return;}
      clear();completed=points;
      announce("Wall captures complete");
      hint.textContent="Results on top-down view.";
      try {localStorage.setItem(storageKey,JSON.stringify(completed));}
      catch {hint.textContent+=" Available for this session only.";}
    }
  };
}
