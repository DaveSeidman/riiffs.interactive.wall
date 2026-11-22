// Analytic underdamped angular spring. Velocity is retained across target changes;
// damping .72 permits a small settling overshoot instead of a mechanical stop.
export function angularSpring(state, axis, target, dt, omega=1.3, damping=.72) {
  if(dt<=0)return;
  const key=`${axis}Velocity`,v=state[key]??0,x=state[axis]-target;
  const decay=omega*damping,frequency=omega*Math.sqrt(1-damping*damping);
  const a=x,b=(v+decay*x)/frequency,c=Math.cos(frequency*dt),s=Math.sin(frequency*dt),e=Math.exp(-decay*dt);
  const offset=e*(a*c+b*s);
  state[axis]=target+offset;
  state[key]=e*((-a*frequency*s+b*frequency*c)-decay*(a*c+b*s));
}
export class AstronautAttitude {
  constructor(){this.pitch=.8;this.yaw=0;this.roll=0;this.yawVelocity=0;}
  update(m,delta,paused=false){
    if(paused)return this;
    const dt=Math.min(delta,.05),t=m.time;
    angularSpring(this,'yaw',m.heading+m.departure*Math.PI+Math.sin(t*.33)*.12,dt,1.5);
    // Bank into angular momentum, then recover with a small counter-bank.
    const turn=Math.max(-1,Math.min(1,this.yawVelocity));
    const acceleration=Math.max(-.3,Math.min(.3,m.vxVelocity??0));
    angularSpring(this,'roll',-turn*.55-acceleration*.7+Math.sin(t*.47)*.16,dt,1.7,.68);
    angularSpring(this,'pitch',.8+Math.sin(t*.31)*.14+Math.sin(t*.61)*.055-Math.abs(turn)*.4+Math.sin(t*.23)*m.departure*.10,dt,1.5,.72);
    return this;
  }
}
