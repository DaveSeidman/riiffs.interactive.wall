import test from "node:test";
import assert from "node:assert/strict";
import { WorldTracker } from "../src/tracking.js";

test("a local track retains its world ID across a depth jump beside a second person", () => {
  const tracker = new WorldTracker();
  const camera = { globalIds: new Map() };
  function detection(trackId, x, z) {
    return { center:{x,y:0,z}, joints:Array.from({length:33},()=>({w:null,vis:1})),
      cams:[0], members:[{camera,person:{trackId}}] };
  }
  const first = detection(1,0.24,2.52);
  tracker.update([first], 0);
  camera.globalIds.set(1,first.globalId);
  const jumped = detection(1,2.01,5.05);
  tracker.update([jumped], 33);
  assert.equal(tracker.tracks.length,1);
  assert.equal(jumped.globalId,first.globalId);
  const newcomer = detection(2,2.01,5.05);
  const returning = detection(1,0.24,2.52);
  tracker.update([newcomer,returning],66);
  assert.equal(returning.globalId,first.globalId);
  assert.notEqual(newcomer.globalId,first.globalId);
});
