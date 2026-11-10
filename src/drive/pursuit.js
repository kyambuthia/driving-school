// Small geometry helpers shared by the path-following controllers.
//
// Forward = (sin h, cos h); heading is the yaw about +Y.

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Wrap an angle difference into (-PI, PI].
export function normAngle(err) {
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;
  return err;
}

// Angle between two directions, in [0, PI].
export function angleBetween(dx1, dz1, dx2, dz2) {
  const dot = dx1 * dx2 + dz1 * dz2;
  const cross = dx1 * dz2 - dz1 * dx2;
  return Math.abs(Math.atan2(cross, dot));
}

// Walk `length` units along a polyline of {x,z} nodes and return the point
// where the walk stops (the last node, if the polyline is shorter).
export function walkPath(nodes, length) {
  let rem = length;
  for (let i = 0; i < nodes.length - 1; i++) {
    const dx = nodes[i + 1].x - nodes[i].x;
    const dz = nodes[i + 1].z - nodes[i].z;
    const d = Math.hypot(dx, dz);
    if (d >= rem) {
      const u = rem / (d || 1e-6);
      return { x: nodes[i].x + dx * u, z: nodes[i].z + dz * u };
    }
    rem -= d;
  }
  const last = nodes[nodes.length - 1];
  return { x: last.x, z: last.z };
}

// How far ahead to look when steering, in units. Longer at speed, so the car
// does not weave, but never so long that it cuts the corner wide.
export function lookaheadFor(speed) {
  return clamp(1.8 + 0.55 * Math.abs(speed || 0), 2.5, 9);
}

// Speed factor for a corner of `angle` radians: 1 for a straight road, less
// for a sharp turn.
export function cornerSpeedFactor(angle) {
  return clamp(1 - angle / 2.4, 0.35, 1);
}

// Turn a speed error into throttle/brake.
//
// The gains are scaled by the vehicle's own acceleration and braking rates so
// the controller asks for exactly the force it needs instead of slamming the
// pedal and overshooting.
export function speedIntent(speed, targetSpeed, { accelRate = 9, brakeRate = 14 } = {}) {
  const dv = targetSpeed - speed;
  if (dv > 0) return { throttle: clamp((dv / accelRate) * 2, 0, 1), brake: 0 };
  return { throttle: 0, brake: clamp((-dv / brakeRate) * 2, 0, 1) };
}
