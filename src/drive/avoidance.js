// 2D (XZ) helpers for obstacle avoidance. Forward = (sin(h), cos(h)).

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

function obstacleAtTime(o, t) {
  if (!o.dynamic) return { x: o.x, z: o.z, r: o.r || 1 };
  const vx = o.vx || 0, vz = o.vz || 0;
  // slight radius inflation for moving targets (uncertainty/margin)
  return { x: o.x + vx * t, z: o.z + vz * t, r: (o.r || 1) + Math.min(0.35, Math.hypot(vx, vz) * 0.05) };
}

// Predictive whiskers: for dynamic obstacles, sample predicted positions over lookahead.
export function senseWhiskers({ x, z, heading, obstacles = [], carRadius = 1.0, lengths = [6.5, 4.8, 4.8, 3.2, 3.2], angles = [0, 0.45, -0.45, 0.85, -0.85], speed = 0 } = {}) {
  const lookahead = Math.max(0.4, Math.min(1.6, 0.5 + Math.abs(speed) * 0.12));
  const samples = [0, lookahead * 0.35, lookahead * 0.7, lookahead];
  return angles.map((a, i) => {
    const h = heading + a;
    const dx = Math.sin(h), dz = Math.cos(h);
    const maxT = lengths[i] ?? lengths[0];
    let best = maxT;
    let hit = null;
    let hitDynamic = false;
    for (const o of obstacles) {
      if (o.dynamic) {
        for (const st of samples) {
          const p = obstacleAtTime(o, st);
          // approximate: distance along ray vs time-to-reach — be conservative by checking predicted circle
          const t = rayCircle(x, z, dx, dz, p.x, p.z, p.r + carRadius, maxT);
          if (t < best) { best = t; hit = o; hitDynamic = true; }
        }
      } else {
        const t = rayCircle(x, z, dx, dz, o.x, o.z, (o.r || 1) + carRadius, maxT);
        if (t < best) { best = t; hit = o; hitDynamic = false; }
      }
    }
    return { angle: a, dir: { x: dx, z: dz }, maxT, t: best, hit: !!hit, obstacle: hit, hitDynamic };
  });
}

// Returns steering bias, throttle scale, and urgency based on whiskers.
// Considers clearance and (predictive) closeness for speed planning.
export function avoidanceFromWhiskers(whiskers) {
  let steerBias = 0;
  let urgency = 0;
  let minT = Infinity;
  for (const w of whiskers) {
    if (!Number.isFinite(w.t)) continue;
    minT = Math.min(minT, w.t);
    const closeness = 1 - w.t / w.maxT;
    if (closeness <= 0) continue;
    // weight dynamic/predictive hits slightly higher to encourage earlier yielding
    const dynW = w.hitDynamic ? 1.15 : 1.0;
    urgency = Math.max(urgency, closeness * dynW);
    const side = w.angle === 0 ? 0 : (w.angle > 0 ? -1 : 1);
    const centerWeight = w.angle === 0 ? 1.25 : 1.0;
    steerBias += side * closeness * centerWeight * dynW;
  }
  const center = whiskers[0];
  if (center && center.hit && Math.abs(steerBias) < 0.15) steerBias = -0.8;

  // Traffic spacing: detect leading dynamic vehicle ahead (center-ish whiskers)
  let lead = null;
  for (let i = 0; i < Math.min(3, whiskers.length); i++) {
    const w = whiskers[i];
    if (w && w.hit && w.hitDynamic && w.obstacle) {
      const o = w.obstacle;
      if (!lead || w.t < lead.dist) {
        const ovx = o.vx || 0, ovz = o.vz || 0;
        // speed of lead along its forward (approx via velocity magnitude toward/away isn't perfect, but ok)
        lead = { dist: w.t, vx: ovx, vz: ovz, speed: Math.hypot(ovx, ovz), id: o.id };
      }
    }
  }

  // Speed planning from clearance: smoother, more anticipatory
  let throttleScale = 1;
  if (urgency > 0.9 || (center && center.hit && center.t < center.maxT * 0.25)) throttleScale = 0.1;
  else if (urgency > 0.7) throttleScale = 0.3;
  else if (urgency > 0.45) throttleScale = 0.55;
  else if (urgency > 0.25) throttleScale = 0.75;
  else if (urgency > 0.12) throttleScale = 0.9;

  // if following a lead car, target a time gap (slow down / match speed)
  if (lead) {
    const desiredGap = 2.8; // units
    if (lead.dist < desiredGap) throttleScale = Math.min(throttleScale, 0.08);
    else if (lead.dist < desiredGap * 1.6) throttleScale = Math.min(throttleScale, 0.35);
    else if (lead.dist < desiredGap * 2.4) throttleScale = Math.min(throttleScale, 0.6);
  }

  const clearAhead = !center?.hit && minT > 4.5 && !lead;
  return {
    steer: Math.max(-1, Math.min(1, steerBias)),
    throttleScale,
    urgency: Math.min(1, urgency),
    minClearance: Number.isFinite(minT) ? minT : Infinity,
    clearAhead,
    lead,
  };
}
