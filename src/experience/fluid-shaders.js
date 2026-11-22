// Pressure projection / curl confinement adapted from Pavel Dobryakov's MIT-licensed
// WebGL Fluid Simulation. Full notice: public/licenses/webgl-fluid-simulation.txt.
import { MAX_FLOW_POINTS } from "./fluid-motion.js";

export const fluidVertex = `
  varying vec2 vUv;
  void main() { vUv=uv; gl_Position=vec4(position.xy,0.,1.); }
`;
const header = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uSource, uVelocity, uPressure, uDivergence, uCurl;
  uniform vec2 uTexel;
  uniform float uDt, uDrag, uVorticity, uTransitionTwist;
`;
const noise = `
  float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p) {
    vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
  }
  float fbm(vec2 p) {
    float n=0., a=.53;
    for(int i=0;i<5;i++) { n+=a*noise(p); p=mat2(.8,.6,-.6,.8)*p*2.04+vec2(9.2,4.7); a*=.45; }
    return n;
  }
`;

export const fluidShaders = {
  transitionTwist: `${header}
    void main(){
      vec2 p=vUv;
      // Horizontal projected sweep of a Y turn, with a mild curved return wake.
      vec2 twist=vec2(-sin(p.x*3.14159)*cos((p.y-.5)*3.14159),
        .18*sin(p.x*6.28318)*sin(p.y*3.14159));
      vec2 velocity=texture2D(uVelocity,p).xy;
      velocity+=twist*uTransitionTwist*uDt*144.;
      gl_FragColor=vec4(velocity,0.,1.);
    }`,
  zero: `${header} void main(){gl_FragColor=vec4(0.);}`,
  seedVelocity: `${header}
    void main() {
      // Divergence-free initial eddies, with no gravity or directional wind.
      vec2 p=vUv*vec2(3.5555556,1.);
      vec2 v=vec2(13.*sin(p.x*5.4)*cos(p.y*5.4),-13.*cos(p.x*5.4)*sin(p.y*5.4));
      v+=vec2(5.*sin(p.x*12.1+.8)*cos(p.y*12.1),-5.*cos(p.x*12.1+.8)*sin(p.y*12.1));
      gl_FragColor=vec4(v,0.,1.);
    }
  `,
  seedDye: `${header} ${noise}
    void main() {
      vec2 p=vUv*vec2(3.5555556,1.)*1.5;
      vec2 warp=vec2(fbm(p+3.7),fbm(p-8.2));
      float cloud=fbm(p+warp*2.7);
      float grain=fbm(p*2.25+warp*3.);
      gl_FragColor=vec4(cloud,grain,noise(p*10.),1.);
    }
  `,
  seedDust: `${header} ${noise}
    void main() {
      vec2 id=vUv*vec2(128.,128.);
      gl_FragColor=vec4(hash(id+2.3),hash(id-9.7),hash(id+16.1),hash(id+41.8));
    }
  `,
  advectDust: `${header} ${noise}
    void main() {
      vec4 particle=texture2D(uSource,vUv);
      // Midpoint integration samples the same projected velocity used to carry the ink.
      vec2 velocity=texture2D(uVelocity,particle.xy).xy*uTexel;
      vec2 midpoint=clamp(particle.xy+velocity*uDt*.5,vec2(0.),vec2(1.));
      particle.xy+=texture2D(uVelocity,midpoint).xy*uTexel*uDt;
      particle.z+=uDt/(35.+particle.w*60.);
      if(particle.z>=1. || any(lessThan(particle.xy,vec2(0.))) || any(greaterThan(particle.xy,vec2(1.)))) {
        particle.w=fract(particle.w+.618033989);
        particle.xy=vec2(hash(vec2(particle.w,9.3)),hash(vec2(particle.w,5.7)));
        particle.z=0.;
      }
      gl_FragColor=particle;
    }
  `,
  advect: `${header}
    void main() {
      vec2 velocity=texture2D(uVelocity,vUv).xy;
      vec2 uv=clamp(vUv-uDt*velocity*uTexel,uTexel*.5,1.-uTexel*.5);
      gl_FragColor=texture2D(uSource,uv)*exp(-uDrag*abs(uDt));
    }
  `,
  splatVelocity: `${header}
    uniform int uCount;
    uniform vec4 uPoints[${MAX_FLOW_POINTS}], uMoves[${MAX_FLOW_POINTS}];
    uniform float uRadius, uForce;
    void main() {
      vec2 velocity=texture2D(uSource,vUv).xy;
      for(int i=0;i<${MAX_FLOW_POINTS};i++) {
        if(i>=uCount) break;
        vec2 p=(vUv-uMoves[i].xy)*vec2(3.5555556,1.);
        vec2 ab=(uPoints[i].xy-uMoves[i].xy)*vec2(3.5555556,1.);
        float t=clamp(dot(p,ab)/max(dot(ab,ab),.000001),0.,1.);
        vec2 d=p-ab*t;
        float wake=exp(-dot(d,d)/(uRadius*uRadius));
        velocity+=wake*uPoints[i].zw*uForce/uTexel.y;
      }
      gl_FragColor=vec4(clamp(velocity,vec2(-450.),vec2(450.)),0.,1.);
    }
  `,
  splatDye: `${header}
    uniform int uCount;
    uniform vec4 uPoints[${MAX_FLOW_POINTS}], uMoves[${MAX_FLOW_POINTS}];
    uniform float uRadius, uForce;
    void main() {
      vec3 ink=texture2D(uSource,vUv).rgb;
      for(int i=0;i<${MAX_FLOW_POINTS};i++) {
        if(i>=uCount) break;
        vec2 p=(vUv-uMoves[i].xy)*vec2(3.5555556,1.);
        vec2 ab=(uPoints[i].xy-uMoves[i].xy)*vec2(3.5555556,1.);
        float t=clamp(dot(p,ab)/max(dot(ab,ab),.000001),0.,1.);
        vec2 d=p-ab*t;
        float wake=exp(-dot(d,d)/(uRadius*uRadius*.55));
        float amount=min(.22,length(uPoints[i].zw)*uForce*8.);
        // Different joints stir pale and deep pigment into the same moving ink.
        float shade=uMoves[i].w;
        ink=mix(ink,vec3(shade,.51,.5),wake*amount);
      }
      gl_FragColor=vec4(ink,1.);
    }
  `,
  curl: `${header}
    void main() {
      float l=texture2D(uVelocity,vUv-vec2(uTexel.x,0.)).y;
      float r=texture2D(uVelocity,vUv+vec2(uTexel.x,0.)).y;
      float b=texture2D(uVelocity,vUv-vec2(0.,uTexel.y)).x;
      float t=texture2D(uVelocity,vUv+vec2(0.,uTexel.y)).x;
      gl_FragColor=vec4(.5*(r-l-t+b),0.,0.,1.);
    }
  `,
  confine: `${header}
    void main() {
      float l=texture2D(uCurl,vUv-vec2(uTexel.x,0.)).x;
      float r=texture2D(uCurl,vUv+vec2(uTexel.x,0.)).x;
      float b=texture2D(uCurl,vUv-vec2(0.,uTexel.y)).x;
      float t=texture2D(uCurl,vUv+vec2(0.,uTexel.y)).x;
      float c=texture2D(uCurl,vUv).x;
      vec2 force=.5*vec2(abs(t)-abs(b),abs(l)-abs(r));
      force=force/(length(force)+.0001)*uVorticity*c;
      vec2 v=texture2D(uVelocity,vUv).xy+force*uDt;
      // Slip boundaries keep ink in the frame without damping its tangential motion.
      if(vUv.x<uTexel.x || vUv.x>1.-uTexel.x) v.x=0.;
      if(vUv.y<uTexel.y || vUv.y>1.-uTexel.y) v.y=0.;
      gl_FragColor=vec4(clamp(v,vec2(-450.),vec2(450.)),0.,1.);
    }
  `,
  divergence: `${header}
    void main() {
      vec2 c=texture2D(uVelocity,vUv).xy;
      float l=vUv.x<uTexel.x ? -c.x : texture2D(uVelocity,vUv-vec2(uTexel.x,0.)).x;
      float r=vUv.x>1.-uTexel.x ? -c.x : texture2D(uVelocity,vUv+vec2(uTexel.x,0.)).x;
      float b=vUv.y<uTexel.y ? -c.y : texture2D(uVelocity,vUv-vec2(0.,uTexel.y)).y;
      float t=vUv.y>1.-uTexel.y ? -c.y : texture2D(uVelocity,vUv+vec2(0.,uTexel.y)).y;
      gl_FragColor=vec4(.5*(r-l+t-b),0.,0.,1.);
    }
  `,
  pressure: `${header}
    void main() {
      float l=texture2D(uPressure,vUv-vec2(uTexel.x,0.)).x;
      float r=texture2D(uPressure,vUv+vec2(uTexel.x,0.)).x;
      float b=texture2D(uPressure,vUv-vec2(0.,uTexel.y)).x;
      float t=texture2D(uPressure,vUv+vec2(0.,uTexel.y)).x;
      float div=texture2D(uDivergence,vUv).x;
      gl_FragColor=vec4((l+r+b+t-div)*.25,0.,0.,1.);
    }
  `,
  project: `${header}
    void main() {
      float l=texture2D(uPressure,vUv-vec2(uTexel.x,0.)).x;
      float r=texture2D(uPressure,vUv+vec2(uTexel.x,0.)).x;
      float b=texture2D(uPressure,vUv-vec2(0.,uTexel.y)).x;
      float t=texture2D(uPressure,vUv+vec2(0.,uTexel.y)).x;
      gl_FragColor=vec4(texture2D(uVelocity,vUv).xy-vec2(r-l,t-b),0.,1.);
    }
  `,
  // Bounded MacCormack correction preserves fine filaments during long, slow advection.
  correctDye: `${header}
    uniform sampler2D uForward, uBackward, uSeed;
    uniform vec2 uDyeTexel;
    void main() {
      vec2 uv=vUv-uDt*texture2D(uVelocity,vUv).xy*uTexel;
      vec2 cell=(floor(uv/uDyeTexel-.5)+.5)*uDyeTexel;
      vec3 a=texture2D(uSource,cell).rgb;
      vec3 b=texture2D(uSource,cell+vec2(uDyeTexel.x,0.)).rgb;
      vec3 c=texture2D(uSource,cell+vec2(0.,uDyeTexel.y)).rgb;
      vec3 d=texture2D(uSource,cell+uDyeTexel).rgb;
      vec3 corrected=texture2D(uForward,vUv).rgb+.5*(texture2D(uSource,vUv).rgb-texture2D(uBackward,vUv).rgb);
      vec3 ink=clamp(corrected,min(min(a,b),min(c,d)),max(max(a,b),max(c,d)));
      // A very slow ink source prevents numerical mixing from erasing an installation
      // over hours. It enters the simulation here and is advected on subsequent steps.
      ink=mix(ink,texture2D(uSeed,vUv).rgb,1.-exp(-uDt*.12));
      gl_FragColor=vec4(ink,1.);
    }
  `,
};

export const blushDisplay = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uDye;
  uniform vec3 uMagenta, uPink, uShadow;
  uniform float uContrast;
  void main() {
    vec3 ink=texture2D(uDye,vUv).rgb;
    float cloud=(ink.r-.46)*uContrast+0.5;
    float filaments=(ink.g-.46)*.32+(ink.b-.5)*.015;
    float tone=smoothstep(.1,.9,cloud+filaments);
    vec3 color=mix(uMagenta,uPink,tone);
    float seams=pow(1.-abs(ink.g*2.-1.),9.)*(1.-tone)*.1;
    color=mix(color,uShadow,seams);
    gl_FragColor=vec4(color,1.);
  }
`;

export const dustVertex = `
  attribute vec2 aLookup;
  uniform sampler2D uPositions,uVelocity;
  varying float vSeed,vFade,vSpeed;
  varying vec2 vDirection;
  void main() {
    vec4 particle=texture2D(uPositions,aLookup);
    vec2 velocity=texture2D(uVelocity,particle.xy).xy;
    vSeed=particle.w;
    vFade=smoothstep(0.,.07,particle.z)*(1.-smoothstep(.85,1.,particle.z));
    vSpeed=clamp(length(velocity)/80.,0.,1.);
    vDirection=normalize(velocity+vec2(.001,0.));
    gl_Position=vec4(particle.xy*2.-1.,0.,1.);
    gl_PointSize=(2.8+pow(particle.w,2.)*4.)*(1.+vSpeed*.4);
  }
`;

export const dustFragment = `
  uniform vec3 uColor;
  uniform float uAmount;
  varying float vSeed,vFade,vSpeed;
  varying vec2 vDirection;
  void main() {
    if(vSeed>uAmount) discard;
    vec2 p=gl_PointCoord-.5;
    p.y=-p.y;
    vec2 uv=vec2(dot(p,vDirection),dot(p,vec2(-vDirection.y,vDirection.x)));
    uv.y*=1.+vSpeed;
    float r=length(uv)*2.;
    float alpha=exp(-r*r*3.)*(1.-smoothstep(.7,1.,r));
    gl_FragColor=vec4(uColor,alpha*vFade*(.7+vSeed*.25));
  }
`;
