import * as THREE from 'three';
import { smoothMotion } from './smooth-motion.js';

// Bone aiming preserves the imported rest-frame twist. glTF sanitizes .L/.R to L/R.
export class AstronautSwimmer {
  constructor(model) {
    this.bones = new Map();
    this.meshes=[]; model.traverse(o=>{if(o.isSkinnedMesh)this.meshes.push(o);});
    this.fitAge=1; this.depthCorrection=1; this.desiredCorrection=1;
    this.sample=new THREE.Vector3();
    model.traverse(b => { if (b.isBone) this.bones.set(b.name, { bone:b, rest:b.quaternion.clone() }); });
    this.q = new THREE.Quaternion(); this.parentQ = new THREE.Quaternion();
    this.swing = new THREE.Quaternion(); this.direction = new THREE.Vector3();
    this.position = new THREE.Vector3(); this.target = new THREE.Vector3();
    this.up = new THREE.Vector3(0,1,0);
  }
  aim(name, direction, amount=1) {
    const entry=this.bones.get(name); if (!entry) return;
    const b=entry.bone;
    b.getWorldQuaternion(this.q);
    this.direction.copy(this.up).applyQuaternion(this.q);
    this.swing.setFromUnitVectors(this.direction, direction.clone().normalize());
    this.q.premultiply(this.swing);
    b.parent.getWorldQuaternion(this.parentQ).invert();
    this.q.premultiply(this.parentQ);
    b.quaternion.slerp(this.q, amount);
    b.updateWorldMatrix(false,true);
  }
  fitScreenHeight(root, motion, dt) {
    this.fitAge+=dt;
    if(this.fitAge>=.2) {
      root.updateMatrixWorld(true);
      let low=Infinity,high=-Infinity;
      for(const mesh of this.meshes) {
        mesh.skeleton.update();
        const positions=mesh.geometry.attributes.position;
        // Sample the deformed silhouette at 5 Hz, including perspective foreshortening.
        for(let i=0;i<positions.count;i+=8) {
          this.sample.fromBufferAttribute(positions,i);
          mesh.applyBoneTransform(i,this.sample).applyMatrix4(mesh.matrixWorld);
          const y=this.sample.y*8/(10-this.sample.z);
          low=Math.min(low,y); high=Math.max(high,y);
        }
      }
      this.desiredCorrection=this.depthCorrection*(high-low)/motion.height;
      this.fitAge=0;
    }
    smoothMotion(this,'depthCorrection',this.desiredCorrection,dt,3);
  }
  update(root, motion) {
    const t=motion.time, cycle=t*Math.PI*2/9;
    for (const {bone,rest} of this.bones.values()) bone.quaternion.copy(rest);
    root.updateMatrixWorld(true);
    const orientation=root.getWorldQuaternion(new THREE.Quaternion());
    const world=(x,y,z)=>new THREE.Vector3(x,y,z).normalize().applyQuaternion(orientation);
    for (const [side,sign] of [['L',1],['R',-1]]) {
      const stroke=Math.sin(cycle+(sign<0?Math.PI:0));
      this.aim('upper_arm'+side,world(sign*(.38+.14*stroke),.65+.12*stroke,.72));
      this.aim('forearm'+side,world(sign*.16,.78,.52+.16*stroke));
      const reach=side==='L'?motion.leftReach:motion.rightReach;
      if (reach>.0001) {
        const hand={x:motion.handX,y:motion.handY};
        this.target.set(hand.x*motion.depthScale,hand.y*motion.depthScale,root.position.z+.8);
        for (const name of ['upper_arm'+side,'forearm'+side]) {
          this.bones.get(name).bone.getWorldPosition(this.position);
          this.aim(name,this.target.clone().sub(this.position),reach*.72);
        }
      }
      this.aim('thigh'+side,world(sign*.12,-.92,-.26+.08*Math.sin(cycle*1.05+sign)));
      this.aim('shin'+side,world(sign*.09,-.78,-.62+.10*Math.sin(cycle*1.05+sign+.7)));
    }
    // Raise the helmet slightly against the body pitch, keeping the visor visible.
    this.aim('head',world(.04*Math.sin(cycle*.5),1,-.25),.65);
  }
}
