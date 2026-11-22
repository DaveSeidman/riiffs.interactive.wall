// Accelerated sidereal-style motion: 0.24 degrees/sec at the default 0.8 speed.
// A shared angle keeps lunar surface, star positions and background haze registered.
export const SKY_RADIANS_PER_SECOND = Math.PI / 600;

export function advanceSkyAngle(angle, seconds, speed) {
  return (angle + seconds * speed * SKY_RADIANS_PER_SECOND) % (Math.PI * 2);
}

export function skyView(travel, wall, moon) {
  const half = wall.width * 0.5 + moon.radius + 0.35;
  const period = half * 2;
  const x = ((((moon.x - travel + half) % period) + period) % period) - half;
  const arc = Math.min(
    0.18,
    Math.max(0, wall.height * 0.5 - moon.radius - 0.02 - moon.y) / 2,
  );
  const y =
    moon.y +
    arc *
      (Math.cos((x / half) * Math.PI) - Math.cos((moon.x / half) * Math.PI));
  return { x, y, offsetX: x - moon.x, offsetY: y - moon.y, tile: period };
}
