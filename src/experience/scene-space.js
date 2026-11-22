// Tracked wall coordinates lie on z=2. Perspective matches the old wall framing there.
export const CAMERA_Z = 10;
export const INTERACTION_Z = 2;
export const MOON_Z = -40;
export const ASTRONAUT_BACK_Z = -24;
export const MOON_SIZE_MULTIPLIER = 1.25;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 100;
export const interactionDistance = CAMERA_Z - INTERACTION_Z;

export function depthScale(z) {
  return (CAMERA_Z - z) / interactionDistance;
}
export function screenToWorld(point, z, out = {}) {
  const scale = depthScale(z);
  out.x = point.x * scale;
  out.y = point.y * scale;
  out.z = z;
  return out;
}
export function worldToScreen(point, out = {}) {
  const scale = depthScale(point.z);
  out.x = point.x / scale;
  out.y = point.y / scale;
  return out;
}
export function verticalFov(height) {
  return (2 * Math.atan(height / (2 * interactionDistance)) * 180) / Math.PI;
}
export function clipDepth(z) {
  return (
    (CAMERA_FAR + CAMERA_NEAR) / (CAMERA_FAR - CAMERA_NEAR) -
    (2 * CAMERA_FAR * CAMERA_NEAR) /
      ((CAMERA_FAR - CAMERA_NEAR) * (CAMERA_Z - z))
  );
}
