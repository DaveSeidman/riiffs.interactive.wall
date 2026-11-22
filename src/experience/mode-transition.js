export const MODE_INTERVAL = 120;
export const TRANSITION_DURATION = 2.6;
export const SWITCH_TIME = 1.05;

export function transitionFrame(elapsed, spin = false) {
  return {
    switchMode: elapsed >= (spin ? TRANSITION_DURATION / 2 : SWITCH_TIME),
    finished: elapsed >= TRANSITION_DURATION,
    phase: Math.min(1, Math.max(0, elapsed / TRANSITION_DURATION)),
  };
}

// One complete orbit with zero angular velocity and acceleration at both ends.
export function orbitCamera(phase) {
  const t=Math.min(1,Math.max(0,phase));
  const eased=t*t*t*(t*(t*6-15)+10),angle=eased*Math.PI*2;
  return {x:10*Math.sin(angle),y:0,z:10*Math.cos(angle)};
}

// A 1.04-second dissolve centered on the far side of the 2.6-second orbit.
export function orbitCrossfade(phase) {
  const t=Math.min(1,Math.max(0,(phase-.3)/.4));
  return Math.min(1,Math.max(0,t*t*t*(t*(t*6-15)+10)));
}

// Normalized angular-speed envelope of the camera's quintic orbit.
export function orbitTwist(phase) {
 const t=Math.max(0,Math.min(1,phase));
 return 16*t*t*(1-t)*(1-t);
}
