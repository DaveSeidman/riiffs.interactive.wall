const overlaps=(a,b,pad=0)=>Math.abs(a.x-b.x)<a.hw+b.hw+pad&&Math.abs(a.y-b.y)<a.hh+b.hh+pad;
export class QuietBranding {
 constructor({hw=.48,hh=.22,alternate=false}={}){this.hw=hw;this.hh=hh;this.alternate=alternate;this.lastSide=0;this.slot=null;this.alpha=0;this.clearTime=0;this.cooldown=2;}
 update(obstacles,wall,delta,paused=false,side=0){
  if(paused)return this;
  const dt=Math.min(delta,.1);this.cooldown=Math.max(0,this.cooldown-dt);
  const hw=Math.min(this.hw,wall.width*.1),hh=this.hh;
  const free=slot=>(!side || slot.x*side-slot.hw>=wall.width*.04) && !obstacles.some(o=>overlaps(slot,o,.20));
  if(this.slot&&!free(this.slot))this.clearTime=0;
  else if(this.slot)this.clearTime+=dt;
  const target=this.slot&&this.clearTime>2?1:0;
  // Smoothstep envelopes have zero initial and final fade velocity.
  if(target)this.alpha=Math.min(1,this.alpha+dt/3.5);
  else this.alpha=Math.max(0,this.alpha-dt/.85);
  if(this.alpha===0&&(!this.slot||!free(this.slot))&&this.cooldown===0){
   const candidates=[];
   for(const u of [.13,.30,.5,.70,.87])for(const v of [.23,.5,.77]){
    const slot={x:(u-.5)*wall.width,y:Math.max(-wall.height/2+hh,Math.min(wall.height/2-hh,(v-.5)*wall.height)),hw,hh};
    if(free(slot)){
     const clearance=Math.min(wall.width,...obstacles.map(o=>Math.hypot(o.x-slot.x,o.y-slot.y)-Math.hypot(o.hw,o.hh)));
     candidates.push({...slot,score:clearance});
    }
   }
   if(this.alternate){
    const sideCandidates=candidates.filter(c=>Math.sign(c.x)!==this.lastSide);
    this.slot=(sideCandidates.length?sideCandidates:candidates).sort((a,b)=>b.score-a.score)[0]??null;
    if(this.slot)this.lastSide=Math.sign(this.slot.x)||-this.lastSide;
   }else this.slot=candidates.sort((a,b)=>b.score-a.score)[0]??null;
   this.clearTime=0;this.cooldown=.5;
  }
  this.opacity=this.alpha*this.alpha*(3-2*this.alpha);
  return this;
 }
}
