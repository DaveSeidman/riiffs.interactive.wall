import { projectJoint, bodyWallDistance } from './body.js';
import { smoothMotion } from './smooth-motion.js';
import { depthScale } from './scene-space.js';

export const ASTRONAUT_HEIGHT = 1.8288; // Six feet on the calibrated projection wall.
export const ASTRONAUT_NEAR_DISTANCE = 2;
export const SWIM_CROSSING_SECONDS = 15;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth = x => x * x * x * (x * (x * 6 - 15) + 10);

export function astronautTargets(people, wall) {
  return people.flatMap(person => {
    if(bodyWallDistance(person,wall)>ASTRONAUT_NEAR_DISTANCE)return [];
    const points = [11, 12, 23, 24].map(i => person.joints[i])
      .filter(j => j?.p3 && j.vis >= .4).map(j => projectJoint(j.p3, wall));
    if (points.length < 2) return [];
    const x = points.reduce((s, p) => s + p.x, 0) / points.length;
    const y = points.reduce((s, p) => s + p.y, 0) / points.length;
    if (Math.abs(x) > wall.width * .6 || Math.abs(y) > wall.height * .7) return [];
    const hand = [15, 16].map(i => person.joints[i]).find(j => j?.p3 && j.vis >= .4);
    return [{ id: person.id, x, y, hand: hand ? projectJoint(hand.p3, wall) : { x, y: y + .2 } }];
  });
}

export class AstronautMotion {
  constructor() {
    this.time = 0; this.x = 0; this.y = .2; this.z = 10 - 8 * 1.1 / .55;
    this.targetId = null; this.target = null; this.missing = 0;
    this.attention = 0; this.height = .55; this.heading = 0;
    this.vx=0; this.vy=0; this.handX=0; this.handY=0; this.leftReach=0; this.rightReach=0;
    this.reach = 0; this.departure = 0; this.phase = "rest"; this.phaseTime = 0;
    this.presence=0; this.absentTime=0; this.retreatX = 0; this.retreatHeight = .55; this.thrust = {x:0,y:0,z:0};
  }
  update(people, wall, delta, paused = false) {
    if (paused) return this;
    const dt = clamp(delta, 0, .05);
    this.time += dt;
    const previousX=this.x, previousY=this.y, previousZ=this.z;
    this.phaseTime+=dt;
    const nearTargets=astronautTargets(people,wall);
    this.absentTime=nearTargets.length?0:this.absentTime+dt;
    if((this.phase==='linger' && this.phaseTime>=5) ||
       (['approach','linger'].includes(this.phase) && this.absentTime>(people.length?.75:2))) {
      this.phase='retreat'; this.phaseTime=0; this.retreatHeight=this.height;
      this.retreatX=clamp(this.x+(this.x>0?-1:1)*wall.width*.24,-wall.width*.35,wall.width*.35);
      this.target=null; this.targetId=null; this.attention=0;
    }
    if(this.phase==='retreat' && this.phaseTime>=14) {this.phase='rest';this.phaseTime=0;}
    if(this.phase==='rest' && nearTargets.length && (this.phaseTime>=7 || this.time<7)) {this.phase='approach';this.phaseTime=0;}
    smoothMotion(this,'presence',nearTargets.length || this.phase!=='rest' ? 1 : 0,dt,1.2);
    smoothMotion(this,'departure',this.phase==='retreat'||this.phase==='rest'?1:0,dt,.8);
    const visiting=this.phase==='approach'||this.phase==='linger';
    const targets = visiting ? nearTargets : [];
    let target = targets.find(p => p.id === this.targetId);
    if (target) this.missing = 0;
    else this.missing += dt;
    // Keep one person through brief occlusion; do not flicker between nearby bodies.
    if (!target && (this.targetId === null || this.missing > 2)) {
      target = targets.sort((a, b) => Math.hypot(a.x-this.x,a.y-this.y)-Math.hypot(b.x-this.x,b.y-this.y))[0];
      this.targetId = target?.id ?? null;
      this.attention = 0;
    }
    if (target) {
      this.target = target;
      this.attention = Math.min(30, this.attention + dt);
    } else if (this.missing > 2) {
      this.target = null;
      this.attention = Math.max(0, this.attention - dt * 2);
    }
    const desiredHeight = this.phase==='retreat'
      ? this.retreatHeight+(.55-this.retreatHeight)*smooth(Math.min(1,this.phaseTime/12))
      : this.target ? .55 + (ASTRONAUT_HEIGHT-.55)*smooth(this.attention/30) : .55;
    if(this.phase==='approach' && this.target && this.attention>=30 && this.height>ASTRONAUT_HEIGHT-.003) {
      this.phase='linger';this.phaseTime=0;
    }
    smoothMotion(this,'height',desiredHeight,dt,1.4);
    const margin = this.height * .28;
    const tx = clamp(this.phase==='retreat' || this.phase==='rest' ? this.retreatX : (this.target?.x ?? Math.sin(this.time*.055)*wall.width*.28), -wall.width/2+margin, wall.width/2-margin);
    const ty = clamp(this.target?.y ?? Math.sin(this.time*.09)*wall.height*.14, -wall.height*.12, wall.height*.12);
    const dx = tx-this.x, dy=ty-this.y, distance=Math.hypot(dx,dy);
    // A centre-to-edge crossing takes at least 15 seconds, with gentle arrival.
    const speed = Math.min(wall.width*.45/SWIM_CROSSING_SECONDS, distance*.8);
    smoothMotion(this,'vx',distance>1e-5?dx/distance*speed:0,dt,1.8);
    smoothMotion(this,'vy',distance>1e-5?dy/distance*speed:0,dt,1.8);
    this.x+=this.vx*dt; this.y+=this.vy*dt;
    smoothMotion(this,'heading',clamp(dx*.45,-.7,.7),dt,1.1);
    smoothMotion(this,'reach',target?1:0,dt,1.6);
    if(target) {
      smoothMotion(this,'handX',target.hand.x,dt,2);
      smoothMotion(this,'handY',target.hand.y,dt,2);
    }
    const left=target && this.handX>=this.x;
    smoothMotion(this,'leftReach',target&&left?1:0,dt,1.6);
    smoothMotion(this,'rightReach',target&&!left?1:0,dt,1.6);
    // Fixed physical model size; approach is actual camera depth, not just scaling.
    this.z = 10 - 8 * 1.1 / this.height;
    this.depthScale = depthScale(this.z);
    if(dt>0) this.thrust={x:(this.x-previousX)/dt,y:(this.y-previousY)/dt,z:(this.z-previousZ)/dt};
    return this;
  }
}
