import * as THREE from 'three';

// A broad rose petal: narrow pale attachment, rounded heart-shaped rim and a curled cup.
export function petalGeometry(){
 const positions=[],uvs=[],colors=[],indices=[],rows=48,columns=40;
 const pink=new THREE.Color('#cf559e'),cream=new THREE.Color('#f8d6ec');
 for(let j=0;j<=rows;j++)for(let i=0;i<=columns;i++){
  const t=j/rows,u=i/columns*2-1;
  const width=.39*Math.pow(Math.sin(Math.PI*t*.96),.58)*(.65+.5*t)+.008;
  const x=u*width,y=t-.5-.055*Math.exp(-u*u*30)*Math.pow(t,9);
  const z=.19*u*u*Math.sin(Math.PI*t)+.14*t*t+.025*Math.sin(u*8+t*9)*u*u*t;
  positions.push(x,y,z);uvs.push(i/columns,t);
  const color=cream.clone().lerp(pink,THREE.MathUtils.smoothstep(t,0,.45));
  color.multiplyScalar(.94+.06*Math.sin(i*.9+j*.35));colors.push(color.r,color.g,color.b);
  if(j<rows&&i<columns){const a=j*(columns+1)+i,b=a+columns+1;indices.push(a,b,a+1,b,b+1,a+1);}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g;
}

export function petalMaterial(){
 const material=new THREE.MeshPhysicalMaterial({color:'white',vertexColors:true,roughness:.65,
  metalness:0,envMapIntensity:0,sheen:.5,sheenColor:new THREE.Color('#f7d5ff'),sheenRoughness:.7,
  side:THREE.DoubleSide,transparent:true,opacity:.48,blending:THREE.AdditiveBlending,forceSinglePass:true,depthWrite:false,depthTest:false});
 material.onBeforeCompile=shader=>{
  shader.vertexShader='varying vec2 vPetalUv;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPetalUv=uv;');
  shader.fragmentShader='varying vec2 vPetalUv;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float x=(vPetalUv.x-.5)*2., y=vPetalUv.y;
   vec2 edgeWidth=max(fwidth(vPetalUv)*1.5,vec2(.006));
   vec2 edgeDistance=min(vPetalUv,1.-vPetalUv);
   vec2 edgeFade=smoothstep(vec2(0.),edgeWidth,edgeDistance);
   diffuseColor.a*=edgeFade.x*edgeFade.y;
   float branch=sin((x/(.22+y*.8)+.08*sin(y*19.))*95.);
   float veins=pow(abs(branch),18.)*.13;
   diffuseColor.rgb*=1.-veins;
   diffuseColor.rgb+=vec3(.025,.014,.029)*pow(1.-abs(x),30.);
  `);
 };
 material.customProgramCacheKey=()=> 'rose-petal-additive-v2';return material;
}
