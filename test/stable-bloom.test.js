import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {StableBloomPass} from '../src/experience/StableBloomPass.js';

test('bloom never samples its destination across alternating composer buffers',()=>{
 const bloom=new StableBloomPass();bloom.setSize(3840,1080);
 const a=new THREE.WebGLRenderTarget(4,4),b=a.clone();let target,draws=0;
 const renderer={setRenderTarget(t){target=t;},render(mesh){
  for(const uniform of Object.values(mesh.material.uniforms))assert.notEqual(uniform.value,target.texture);
  assert.equal(mesh.material.depthTest,false);assert.equal(mesh.material.depthWrite,false);draws++;
 }};
 for(let i=0;i<12;i++)bloom.render(renderer,i%2?a:b,i%2?b:a);
 assert.equal(draws,72);assert.equal(bloom.targets[0].width,960);
 bloom.dispose();a.dispose();b.dispose();
});
