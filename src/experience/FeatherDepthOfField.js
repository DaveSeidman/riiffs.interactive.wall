import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Isolate the translucent fibers so their bokeh spills over the background without
// blurring the fluid or letting a feather's depth mask hide other scene objects.
export class FeatherDepthOfField extends Pass {
  constructor(scene,camera,{layer=1,isolateEnvironment=true,focus=8,aperture=16,maxBlur=26,occlude=false,additive=false,colorRetention=0,foregroundBlur=1,focusRange=0}={}) {
    super();this.scene=scene;this.camera=camera;this.layer=layer;this.isolateEnvironment=isolateEnvironment;
    this.target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType});
    this.target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
    this.depthMaterial=new THREE.MeshDepthMaterial({side:THREE.DoubleSide,colorWrite:false});
    this.material=new THREE.ShaderMaterial({
      depthTest:false,depthWrite:false,
      uniforms:{foregroundBlur:{value:foregroundBlur},focusRange:{value:focusRange},colorRetention:{value:colorRetention},additive:{value:additive},focus:{value:focus},aperture:{value:aperture},maxBlur:{value:maxBlur},occlude:{value:occlude},tSceneDepth:{value:null},tDiffuse:{value:null},tFeather:{value:this.target.texture},tDepth:{value:this.target.depthTexture},resolution:{value:new THREE.Vector2(3840,1080)}},
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:`
        uniform sampler2D tDiffuse,tFeather,tDepth,tSceneDepth;
        uniform float focus,aperture,maxBlur,colorRetention,foregroundBlur,focusRange;uniform bool occlude,additive;
        uniform vec2 resolution;varying vec2 vUv;
        float coc(vec2 uv){
          float d=texture2D(tDepth,uv).r;
          if(d>.99999)return 0.;
          float distance=.1*100./(100.-d*(100.-.1));
          float defocus=max(0.,abs(distance-focus)-focusRange)/distance;
          return clamp(defocus*aperture*(distance<focus?foregroundBlur:1.),0.,maxBlur);
        }
        void main(){
          vec4 background=texture2D(tDiffuse,vUv);
          if(occlude && texture2D(tDepth,vUv).r>texture2D(tSceneDepth,vUv).r+.00001){gl_FragColor=background;return;}
          float radius=coc(vUv);
          // Search outside the silhouette too, so nearby hairs make soft bokeh.
          for(int j=0;j<12;j++){
            float a=float(j)*2.399963;
            vec2 offset=vec2(cos(a),sin(a))*sqrt((float(j)+.5)/12.)*maxBlur;
            float r=coc(vUv+offset/resolution);
            if(r>=length(offset))radius=max(radius,r);
          }
          vec4 fibers=texture2D(tFeather,vUv);
          if(radius>.7){
            fibers=vec4(0.);
            for(int i=0;i<48;i++){
              float fi=float(i),a=fi*2.399963;
              vec2 offset=vec2(cos(a),sin(a))*sqrt((fi+.5)/48.)*radius;
              vec2 uv=vUv+offset/resolution;
              float sourceRadius=coc(uv);
              float coverage=1.-smoothstep(sourceRadius,sourceRadius+1.,length(offset));
              fibers+=texture2D(tFeather,uv)*coverage;
            }
            fibers/=48.;
          }
          // Additive petals must not subtract background color using their alpha.
          float coverage=clamp(fibers.a,0.,1.);
          vec3 base=background.rgb*(1.-coverage*(additive?colorRetention:1.));
          gl_FragColor=vec4(base+fibers.rgb,background.a);
        }`,
    });
    this.quad=new FullScreenQuad(this.material);this.clearColor=new THREE.Color();
  }
  setSize(w,h){this.target.setSize(w,h);this.material.uniforms.resolution.value.set(w,h);}
  render(renderer,writeBuffer,readBuffer){
    const layers=this.camera.layers.mask,background=this.scene.background,override=this.scene.overrideMaterial,environment=this.scene.environment;
    const auto=renderer.autoClear,alpha=renderer.getClearAlpha();renderer.getClearColor(this.clearColor);
    try {
      this.camera.layers.set(this.layer);this.scene.background=null;if(this.isolateEnvironment)this.scene.environment=null;
      renderer.autoClear=false;renderer.setRenderTarget(this.target);renderer.setClearColor(0,0);renderer.clear();
      this.scene.overrideMaterial=this.depthMaterial;renderer.render(this.scene,this.camera);
      this.scene.overrideMaterial=null;renderer.render(this.scene,this.camera);
    } finally {
      this.camera.layers.mask=layers;this.scene.background=background;this.scene.overrideMaterial=override;this.scene.environment=environment;
      renderer.autoClear=auto;renderer.setClearColor(this.clearColor,alpha);
    }
    this.material.uniforms.tDiffuse.value=readBuffer.texture;
    this.material.uniforms.tSceneDepth.value=readBuffer.depthTexture;
    renderer.setRenderTarget(this.renderToScreen?null:writeBuffer);this.quad.render(renderer);
  }
  dispose(){this.target.dispose();this.depthMaterial.dispose();this.material.dispose();this.quad.dispose();}
}
