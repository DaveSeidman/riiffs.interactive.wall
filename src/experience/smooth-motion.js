// Exact critically damped spring: position AND velocity stay continuous when a target changes.
// omega is response speed in radians/second; callers retain the velocity between frames.
export function smoothMotion(state, key, target, dt, omega = 2) {
  if (dt <= 0) return state[key];
  const velocityKey = `${key}Velocity`;
  const velocity = state[velocityKey] ?? 0;
  const offset = state[key] - target;
  const impulse = velocity + omega * offset;
  const decay = Math.exp(-omega * dt);
  state[key] = target + (offset + impulse * dt) * decay;
  state[velocityKey] = (velocity - omega * impulse * dt) * decay;
  return state[key];
}

// Integral of the same spring, used when smoothing a speed that drives travel.
export function integrateSmoothMotion(state, key, target, dt, omega = 2) {
  if (dt <= 0) return 0;
  const offset=state[key]-target;
  const impulse=(state[`${key}Velocity`]??0)+omega*offset;
  const decay=Math.exp(-omega*dt);
  const integral=target*dt+offset*(1-decay)/omega+impulse*(1-decay*(1+omega*dt))/(omega*omega);
  smoothMotion(state,key,target,dt,omega);
  return integral;
}
