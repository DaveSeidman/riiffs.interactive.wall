import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Uses the main render's depth buffer. Fluid and dust don't write depth, so they stay sharp.
export class SeedDepthOfField extends ShaderPass {
  constructor() {
    super({
      uniforms:{tDiffuse:{value:null},tDepth:{value:null}},
      vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`
        uniform sampler2D tDiffuse,tDepth; varying vec2 vUv;
        void main(){
          vec4 center=texture2D(tDiffuse,vUv);
          float depth=texture2D(tDepth,vUv).x;
          if(depth>.99999){gl_FragColor=center;return;}
          float distance=.1*100./(100.-depth*(100.-.1));
          float blur=min(8.,abs(distance-8.)*4.);
          if(blur<.3){gl_FragColor=center;return;}
          vec4 color=center;float weight=1.;
          for(int i=0;i<16;i++){
            float fi=float(i),angle=fi*2.399963;
            vec2 offset=vec2(cos(angle),sin(angle))*sqrt((fi+.5)/16.)*blur/vec2(3840.,1080.);
            color+=texture2D(tDiffuse,vUv+offset);weight+=1.;
          }
          gl_FragColor=color/weight;
        }`,
    });
  }
  render(renderer,writeBuffer,readBuffer,deltaTime,maskActive){
    this.uniforms.tDepth.value=readBuffer.depthTexture;
    super.render(renderer,writeBuffer,readBuffer,deltaTime,maskActive);
  }
}
