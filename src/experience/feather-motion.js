import { smoothMotion } from './smooth-motion.js';
const fract=x=>x-Math.floor(x);
export class FeatherMotion {
  constructor(count=64) {
    this.time=0;
    this.feathers=Array.from({length:count},(_,i)=>({
      u:fract((i+.5)*.61803398875),v:fract((i+.5)*.41421356237),
      z:-12+fract(i*.7320508)*20+.35*Math.sin(i*2.39996),baseZ:-12+fract(i*.7320508)*20,phase:i*2.39996,
      size:.30+fract(i*.3247)*.13,vx:0,vy:0,
      pitch:.3*Math.sin(i),yaw:.6*Math.sin(i*1.3),roll:Math.sin(i*1.8)*1.2,
    }));
  }
  update(wall,delta,paused,wind) {
    if(paused)return;
    const dt=Math.min(delta,.05);this.time+=dt;
    for(const p of this.feathers) {
      const air=wind(p.u,p.v).map(v=>Math.max(-.6,Math.min(.6,v))),t=this.time;
      p.z=p.baseZ+.35*Math.sin(t*.17+p.phase);
      // Velocity is spring-driven: gusts accelerate feathers rather than kicking them.
      smoothMotion(p,'vx',Math.max(-wall.width*.16,Math.min(wall.width*.16,air[0]*wall.width*1.25))+Math.sin(t*.32+p.phase)*.025,dt,3.6);
      smoothMotion(p,'vy',Math.max(-wall.height*.4,Math.min(wall.height*.4,air[1]*wall.height*1.25))-.025+Math.sin(t*.43+p.phase)*.015,dt,3.6);
      p.u+=p.vx*dt/wall.width;p.v+=p.vy*dt/wall.height;
      // Recycling occurs well outside the visible frame, including the feather's extent.
      if(p.u<-.12)p.u=1.12;
      if(p.u>1.12)p.u=-.12;
      if(p.v<-.18){p.v=1.18;p.u=fract(p.u+.381966);}
      if(p.v>1.2)p.v=-.18;
      smoothMotion(p,'pitch',.35*Math.sin(t*.9+p.phase)+p.vy*1.2,dt,3);
      smoothMotion(p,'yaw',.35*Math.sin(t*.48+p.phase*.7)+Math.atan2(p.vx,.3)*.65,dt,3);
      smoothMotion(p,'roll',Math.sin(t*.67+p.phase)*.8-p.vx*2,dt,2.4);
    }
  }
}
