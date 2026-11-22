import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Modelled rachis and individual tapered barbs: no feather textures or billboards.
export function featherGeometry() {
  const parts=[];
  const spine=t=>new THREE.Vector3(.045*Math.sin(t*2.7),t-.52,.13*t*t);
  const shaft=new THREE.CatmullRomCurve3(Array.from({length:18},(_,i)=>spine(i/17)));
  parts.push(new THREE.TubeGeometry(shaft,32,.0045,6,false));
  for(const side of [-1,1])for(let row=0;row<90;row++) {
    const t=.12+row/90*.84,base=spine(t);
    const width=Math.pow(Math.sin((t-.1)/.9*Math.PI),.72)*(side<0?.16:.205);
    const point=u=>base.clone().add(new THREE.Vector3(side*width*u,
      .10*Math.sin(Math.PI*t)*u+.025*u*u,
      -.055*Math.sin(Math.PI*u)*Math.sin(Math.PI*t)+.018*u*u*Math.sin(row*.7)));
    // Separate round fibers with air between them; no solid vane surfaces.
    const curve=new THREE.CatmullRomCurve3(Array.from({length:8},(_,j)=>point(j/7)));
    const hair=new THREE.TubeGeometry(curve,7,.0011,3,false);
    parts.push(hair);
    // Fine branching barbules catch highlights independently in the focus plane.
    for(let branch=1;branch<=6;branch++) {
      const u=branch/8,start=point(u),direction=branch%2?1:-1;
      const end=start.clone().add(new THREE.Vector3(side*.014,direction*.015,.007*Math.sin(row+branch)));
      const mid=start.clone().lerp(end,.5);mid.z+=.003;
      const strand=new THREE.CatmullRomCurve3([start,mid,end]);
      parts.push(new THREE.TubeGeometry(strand,2,.00045,3,false));
    }
  }
  // Loose down around the base breaks up the otherwise clean vane silhouette.
  for(let i=0;i<18;i++) {
    const side=i%2?1:-1,t=.10+(i/18)*.12,base=spine(t);
    const curve=new THREE.CatmullRomCurve3([base,
      base.clone().add(new THREE.Vector3(side*.035,.015,.014)),
      base.clone().add(new THREE.Vector3(side*(.07+.025*Math.sin(i)),.06,.025)),
      base.clone().add(new THREE.Vector3(side*.085,.11,.01))]);
    parts.push(new THREE.TubeGeometry(curve,6,.0013,3,false));
  }
  const geometry=mergeGeometries(parts);parts.forEach(p=>p.dispose());
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return geometry;
}
