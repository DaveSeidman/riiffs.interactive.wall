import * as THREE from 'three';
const fract=x=>x-Math.floor(x);
const hash=(x,y,z)=>[fract(Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453),fract(Math.sin(x*269.5+y*183.3+z*246.1)*43758.5453),fract(Math.sin(x*113.5+y*271.9+z*124.6)*43758.5453)];
export function lavaPlanetGeometry(){
 const g=new THREE.SphereGeometry(1,192,128),p=g.attributes.position;
 const edges=[],rocks=[];
 for(let i=0;i<p.count;i++){
  const n=new THREE.Vector3().fromBufferAttribute(p,i).normalize(),q=n.clone().multiplyScalar(4.4);
  const cx=Math.floor(q.x),cy=Math.floor(q.y),cz=Math.floor(q.z);let first=100,second=100,rock=0;
  for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
   const h=hash(cx+x,cy+y,cz+z),d=(cx+x+h[0]-q.x)**2+(cy+y+h[1]-q.y)**2+(cz+z+h[2]-q.z)**2;
   if(d<first){second=first;first=d;rock=h[0];}else if(d<second)second=d;
  }
  const edge=Math.sqrt(second)-Math.sqrt(first),plate=THREE.MathUtils.smoothstep(edge,.025,.12);
  const height=1+plate*(.035+rock*.045);
  p.setXYZ(i,n.x*height,n.y*height,n.z*height);edges.push(edge);rocks.push(rock);
 }
 g.setAttribute('aEdge',new THREE.Float32BufferAttribute(edges,1));g.setAttribute('aRock',new THREE.Float32BufferAttribute(rocks,1));
 g.computeVertexNormals();g.computeBoundingSphere();return g;
}
