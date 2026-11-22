// The stereo matcher always receives the original calibrated sensor images, in their
// original left/right order. Only the pose image and its camera-space axes are rotated.
export function sensorImagePoint(point, upsideDown) {
  return upsideDown
    ? { x: 1 - point.x, y: 1 - point.y }
    : { x: point.x, y: point.y };
}

export function uprightCameraPoint(point, upsideDown) {
  return upsideDown ? { x: -point.x, y: -point.y, z: point.z } : point;
}

export function drawPoseFrame(
  ctx,
  video,
  eyeW,
  eyeH,
  width,
  height,
  upsideDown,
) {
  ctx.save();
  if (upsideDown) {
    ctx.translate(width, height);
    ctx.rotate(Math.PI);
  }
  ctx.drawImage(video, 0, 0, eyeW, eyeH, 0, 0, width, height);
  ctx.restore();
}
