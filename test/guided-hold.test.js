import test from "node:test";
import assert from "node:assert/strict";
import { guidedCalibration, stops, fitWall } from "../src/guided-calibration.js";

test("a stationary hold advances despite intermittent stereo depth spikes, using distinct frames", t => {
  const original = globalThis.window;
  globalThis.window = {};
  t.after(() => { if (original === undefined) delete globalThis.window; else globalThis.window = original; });
  const fields = new Map();
  const dialog = {
    show() { this.open = true; },
    querySelector(key) {
      if (!fields.has(key)) fields.set(key, { animate() {} });
      return fields.get(key);
    },
  };
  const joints = Array.from({length:33},()=>({vis:1,x:0.5,y:0.7}));
  for (const [i,x] of [[11,.4],[12,.6],[13,.3],[14,.7],[15,.2],[16,.8]]) joints[i]={vis:1,x,y:.35};
  const cameras = [0,1].map(index => ({
    deviceId:String(index), stream:{active:true}, eyeW:672, eyeH:376, seq:0,
    posePanel:{classList:{toggle(_name,dim){this.dim=dim;}}},
    depthPanel:{classList:{toggle(_name,dim){this.dim=dim;}}},
    poseCheck:{dataset:{},setAttribute(){}}, latest:{t:0}, people:[{joints}]
  }));
  const guide=guidedCalibration(dialog,cameras,()=>assert.fail("unexpected apply"));
  guide.start();
  function frame(now, z1, z2=z1) {
    for (const [i,cam] of cameras.entries()) {
      cam.seq++; cam.latest.t=now;
      cam.people[0].center=cam.people[0].centerCam={x:0,y:1,z:i===0 ? z1 : z2};
    }
    guide.tick(now);
  }
  frame(0,4);
  for(let n=1;n<=20;n++) guide.tick(n*50);
  assert.ok(fields.get("h1").textContent.startsWith(stops[0]));
  // Each camera has 75% good depth, but just 50% of frames are good in both.
  for(let n=0;n<12;n++) frame(1100+n*100,n%4===0 ? 6 : 4,n%4===2 ? 6 : 4);
  assert.ok(fields.get("h1").textContent.startsWith(stops[1]));
  for (const [step,active,x] of [[1,1,-4],[2,0,4]]) {
    cameras[1-active].people=[];
    cameras[active].people=[{joints}];
    for (let n=0;n<14;n++) {
      const now=3000*step+n*100;
      const cam=cameras[active];
      cam.seq++;cam.latest.t=now;
      cam.people[0].center=cam.people[0].centerCam={x,y:1,z:4};
      guide.tick(now);
    }
    if (step===1) {
      assert.ok(fields.get("h1").textContent.startsWith(stops[2]));
      // Even a fresh T-pose seen only by the previous camera cannot take over.
      const previous=cameras[active];
      previous.people[0].center=previous.people[0].centerCam={x:2,y:1,z:4};
      for (let n=0;n<12;n++) {
        previous.seq++; previous.latest.t=4500+n*100;
        guide.tick(previous.latest.t);
        for (const cam of cameras) {
          assert.equal(cam.posePanel.classList.dim,cam===previous);
          assert.equal(cam.depthPanel.classList.dim,cam===previous);
          assert.equal(cam.poseCheck.hidden,cam===previous);
        }
      }
      assert.ok(fields.get("h1").textContent.startsWith(stops[2]));
    }
  }
  assert.equal(fields.get("h1").textContent,"Wall captures complete");
  assert.deepEqual(guide.markers.map(p=>[p.stop,p.camera]),[[0,0],[0,1],[1,1],[2,0]]);
});

test("saved world captures follow their cameras and center alignment is repeatable", t => {
  const captures = [[0,0,-1,5],[0,1,1,7],[1,0,-5,5],[2,1,5,7]]
    .map(([stop,camera,x,z])=>({stop,camera,world:{x,y:1,z}}));
  const prior=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  let saved=JSON.stringify(captures);
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{
    getItem:()=>saved,setItem:(_,value)=>{saved=value;}
  }});
  t.after(()=>prior ? Object.defineProperty(globalThis,"localStorage",prior) : delete globalThis.localStorage);
  const cams=[0,1].map(i=>({
    deviceId:String(i),calib:{},extr:{x:i,z:0},
    get worldPose(){return {R:[1,0,0,0,1,0,0,0,1],t:{...this.extr,y:0}};},
    setExtrinsics(delta){Object.assign(this.extr,delta);}
  }));
  const guide=guidedCalibration({querySelector:()=>({})},cams);
  assert.equal(guide.alignCenters(),true);
  assert.deepEqual(guide.markers.map(p=>[p.world.x,p.world.z]),[[0,6],[0,6],[-4,6],[4,6]]);
  assert.deepEqual(fitWall(guide.markers),[[-4,6],[4,6]]);
  guide.alignCenters();
  assert.deepEqual(cams.map(c=>c.extr),[{x:1,z:1},{x:0,z:-1}]);
});
