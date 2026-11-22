import { smoothMotion } from './smooth-motion.js';
import { projectJoint } from './body.js';
export const ECLIPSE_RADIUS_FRACTION = .11;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function point(person, index, wall) {
 const j=person?.joints[index];
 return j?.p3&&j.vis>=.4 ? projectJoint(j.p3,wall) : null;
}
export class EclipseMotion {
 constructor(){this.time=0;this.sun={x:-1.6,y:.2};this.moon={x:-.9,y:.2};this.height={y:.2};this.ids=[];this.controlled=false;}
 update(people,wall,delta,paused=false){
  if(paused)return this;
  const dt=Math.min(delta,.05);this.time+=dt;
  const valid=people.filter(p=>[11,12,23,24].some(i=>point(p,i,wall)));
  const ordered=[...this.ids.map(id=>valid.find(p=>p.id===id)).filter(Boolean),...valid.filter(p=>!this.ids.includes(p.id))];
  this.ids=ordered.slice(0,2).map(p=>p.id);
  const torso=p=>{
   const a=point(p,11,wall),b=point(p,12,wall);
   return a&&b?{x:(a.x+b.x)/2,y:(a.y+b.y)/2}:point(p,23,wall);
  };
  let sun,moon;
  if(ordered.length>=2){sun=torso(ordered[0]);moon=torso(ordered[1]);}
  else if(ordered.length===1){sun=point(ordered[0],15,wall);moon=point(ordered[0],16,wall);}
  this.controlled=Boolean(sun||moon);
  if(!ordered.length){
   sun={x:-wall.width*.20,y:wall.height*.09};
   const offset=wall.height*.43*Math.sin(this.time*.045+.38);
   moon={x:sun.x+offset,y:sun.y};
  }
  const radius=wall.height*ECLIPSE_RADIUS_FRACTION;
  for(const [body,target] of [[this.sun,sun],[this.moon,moon]])if(target){
   smoothMotion(body,'x',clamp(target.x,-wall.width/2+radius,wall.width/2-radius),dt,2.4);

  }
  // One shared vertical spring keeps their projected centres level, even
  // when wrists or guests are at different heights or a target disappears.
  const heights=[sun,moon].filter(Boolean).map(target=>target.y);
  if(heights.length)smoothMotion(this.height,'y',clamp(heights.reduce((a,b)=>a+b,0)/heights.length,-wall.height/2+radius,wall.height/2-radius),dt,2.4);
  this.sun.y=this.moon.y=this.height.y;
  this.alignment=1-Math.min(1,Math.hypot(this.sun.x-this.moon.x,this.sun.y-this.moon.y)/(radius*.8));
  return this;
 }
}
