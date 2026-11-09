// 2D (XZ) helpers for simple obstacle avoidance. Forward = (sin(h), cos(h)).

export function forwardVec(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

export function rightVec(heading) {
  return { x: Math.cos(heading), z: -Math.sin(heading) };
}

// Distance from ray origin (ox,oz) along dir (dx,dz, normalized) to circle (cx,cz,r).
// Returns t (distance along ray) or Infinity if no hit within maxT.
export function rayCircle(ox, oz, dx, dz, cx, cz, r, maxT) {
  const fx = ox - cx, fz = oz - cz;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - r * r;
  let disc = b * b - 4 * c;
  if (disc < 0) return Infinity;
  disc = Math.sqrt(disc);
  let t = (-b - disc) / 2;
  if (t < 0) t = (-b + disc) / 2;
  if (t < 0 || t > maxT) return Infinity;
  return t;
}

export function senseWhiskers({ x, z, heading, obstacles = [], carRadius = 1.0, lengths = [5.5, 4.0, 4.0, 2.8, 2.8], angles = [0, 0.45, -0.45, 0.85, -0.85] }) {
  return angles.map((a, i) => {
    const h = heading + a;
    const dx = Math.sin(h), dz = Math.cos(h);
    const maxT = lengths[i] ?? lengths[0];
    let best = maxT;
    let hit = null;
    for (const o of obstacles) {
      const t = rayCircle(x, z, dx, dz, o.x, o.z, (o.r || 1) + carRadius, maxT);
      if (t < best) { best = t; hit = o; }
    }
    return { angle: a, dir: { x: dx, z: dz }, maxT, t: best, hit: !!hit, obstacle: hit };
  });
}

// Returns steering bias (+right/-left in our sim convention?) and throttle scale based on whiskers.
export function avoidanceFromWhiskers(whiskers) {
  // whiskers order assumed: [center, left-ish? depends]. With our angles [0, +0.45, -0.45, ...]
  // angle > 0 => heading + angle. Positive heading delta turns right in our sim? (heading += steer...)
  // So angle +0.45 is a feeler to the right of forward.
  let steerBias = 0;
  let urgency = 0;
  for (const w of whiskers) {
    if (!Number.isFinite(w.t)) continue;
    const closeness = 1 - w.t / w.maxT; // 1 = very close
    if (closeness <= 0) continue;
    urgency = Math.max(urgency, closeness);
    // If obstacle detected on a feeler angled to the right (+angle), steer left (-), and vice versa.
    const side = w.angle === 0 ? 0 : (w.angle > 0 ? -1 : 1);
    const centerWeight = w.angle === 0 ? 1.2 : 1.0;
    steerBias += side * closeness * centerWeight;
  }
  // If center is blocked, pick a side based on accumulated bias, default left.
  const center = whiskers[0];
  if (center && center.hit && Math.abs(steerBias) < 0.15) steerBias = -0.8;
  return {
    steer: Math.max(-1, Math.min(1, steerBias)),
    throttleScale: urgency > 0.85 ? 0.15 : urgency > 0.55 ? 0.45 : urgency > 0.25 ? 0.75 : 1,
    urgency,
  };
}
