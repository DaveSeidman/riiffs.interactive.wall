import * as THREE from 'three';
import {Pass,FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
const vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
const material=(uniforms,fragmentShader)=>new THREE.ShaderMaterial({uniforms,vertexShader,fragmentShader,depthTest:false,depthWrite:false,toneMapped:false});

// Never blend into the source framebuffer: keep HDR extraction, blur and composition
// in distinct targets, including when the composer changes ping-pong parity for DOF.
export class StableBloomPass extends Pass {
 constructor(strength=.65,threshold=1.15){
  super();this.strength=strength;
  this.targets=[0,1].map(()=>new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false}));
  this.extract=material({source:{value:null},threshold:{value:threshold},sourceTexel:{value:new THREE.Vector2()}},`
   uniform sampler2D source;uniform float threshold;uniform vec2 sourceTexel;varying vec2 vUv;
   vec3 highlight(vec2 uv){
    vec3 c=texture2D(source,uv).rgb;
    if(any(notEqual(c,c)))return vec3(0.);
    c=clamp(c,0.,32.);float peak=max(c.r,max(c.g,c.b));
    float knee=threshold*.75;
    float soft=clamp(peak-threshold+knee,0.,2.*knee);
    soft=soft*soft/(4.*knee+.00001);
    float contribution=max(peak-threshold,soft)/max(peak,.00001);
    // Compress isolated HDR spikes in bloom only; retain the original image.
    return c*contribution/(1.+peak/6.);
   }
   void main(){
    vec3 glow=vec3(0.);
    // Cover all sixteen source pixels instead of skipping moving specular points
    // between quarter-resolution samples. Threshold before averaging.
    for(int y=0;y<4;y++)for(int x=0;x<4;x++)
      glow+=highlight(vUv+(vec2(float(x),float(y))-1.5)*sourceTexel);
    gl_FragColor=vec4(glow/16.,1.);}`);
  this.blur=material({source:{value:null},stepUv:{value:new THREE.Vector2()}},`
   uniform sampler2D source;uniform vec2 stepUv;varying vec2 vUv;
   void main(){vec3 c=texture2D(source,vUv).rgb*.227027;
    c+=(texture2D(source,vUv+stepUv*1.384615).rgb+texture2D(source,vUv-stepUv*1.384615).rgb)*.316216;
    c+=(texture2D(source,vUv+stepUv*3.230769).rgb+texture2D(source,vUv-stepUv*3.230769).rgb)*.070270;
    gl_FragColor=vec4(c,1.);}`);
  this.combine=material({source:{value:null},glow:{value:null},strength:{value:strength}},`
   uniform sampler2D source,glow;uniform float strength;varying vec2 vUv;
   void main(){vec4 c=texture2D(source,vUv);gl_FragColor=vec4(c.rgb+texture2D(glow,vUv).rgb*strength,c.a);}`);
  this.quad=new FullScreenQuad(this.extract);
 }
 setSize(width,height){this.extract.uniforms.sourceTexel.value.set(1/width,1/height);this.width=Math.max(1,Math.ceil(width/4));this.height=Math.max(1,Math.ceil(height/4));this.targets.forEach(t=>t.setSize(this.width,this.height));}
 render(renderer,writeBuffer,readBuffer){
  const draw=(m,target)=>{this.quad.material=m;renderer.setRenderTarget(target);this.quad.render(renderer);};
  this.extract.uniforms.source.value=readBuffer.texture;draw(this.extract,this.targets[0]);
  for(const radius of [1,2]){
   this.blur.uniforms.source.value=this.targets[0].texture;this.blur.uniforms.stepUv.value.set(radius/this.width,0);draw(this.blur,this.targets[1]);
   this.blur.uniforms.source.value=this.targets[1].texture;this.blur.uniforms.stepUv.value.set(0,radius/this.height);draw(this.blur,this.targets[0]);
  }
  this.combine.uniforms.source.value=readBuffer.texture;this.combine.uniforms.glow.value=this.targets[0].texture;this.combine.uniforms.strength.value=this.strength;
  draw(this.combine,this.renderToScreen?null:writeBuffer);
 }
 dispose(){this.targets.forEach(t=>t.dispose());this.extract.dispose();this.blur.dispose();this.combine.dispose();this.quad.dispose();}
}
