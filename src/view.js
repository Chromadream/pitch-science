// Parallel projection: t=0 is the release plane, t=1 is the plate plane.
// Height stays vertical; sideways movement follows the angled ground axis.
export function projectPitchPoint(point, t) {
  return {
    x: 0.8 * point.x - 52 + 340 * t,
    y: 0.22 * point.x + 0.85 * point.y - 110.8 + 53.5 * t,
  };
}

export function pitchPlaneTransform(t) {
  return `matrix(0.8 0.22 0 0.85 ${-52 + 340 * t} ${-110.8 + 53.5 * t})`;
}
