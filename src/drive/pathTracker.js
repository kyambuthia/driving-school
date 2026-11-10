// Tracks a car's progress along a polyline of waypoints.
//
// The important detail is the arrival test. A waypoint counts as reached when
// the car gets close to it *or* when the car drives past it. The second test
// matters because the cars have a minimum turning radius of ~8.75 units (see
// vehicleModel.js): they physically cannot drive through a sharp corner, they
// have to cut it, and they end up a couple of units to the side of the
// waypoint. A pure distance test would never fire there, so the car would
// circle the waypoint forever without ever making progress.

import { angleBetween, clamp, normAngle, walkPath } from "./pursuit.js";

export function createPathTracker({
  waypoints = [],
  loop = true,
  arrive = 1.8,
  passTolerance = 6, // how far off the path a "driven past" may still count
} = {}) {
  const n = waypoints.length;
  let idx = 0;
  let origin = null; // where the path starts, for open (non-looping) paths

  const wp = (i) => (loop ? waypoints[((i % n) + n) % n] : waypoints[clamp(i, 0, n - 1)]);

  // The segment the car is driving along: from the previous waypoint to the
  // current target.
  function segment(i = idx) {
    const a = loop ? wp(i - 1) : i === 0 ? origin || waypoints[0] : waypoints[i - 1];
    const b = wp(i);
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1e-6;
    return { ax: a[0], az: a[1], bx: b[0], bz: b[1], dx: dx / len, dz: dz / len, len };
  }

  // Where the car sits relative to the current target, measured along the
  // path: `along` is the distance past the target (positive once the car has
  // crossed the plane through it), `lateral` is the distance from the path.
  function measure(obs, seg) {
    const relx = obs.x - seg.bx;
    const relz = obs.z - seg.bz;
    return {
      dist: Math.hypot(relx, relz),
      along: relx * seg.dx + relz * seg.dz,
      lateral: Math.abs(relx * seg.dz - relz * seg.dx),
    };
  }

  // Has the car reached the target waypoint?
  //
  // The test is not "is the car close" but "has the car driven past": the
  // waypoint counts as reached once the car crosses the plane through it
  // (perpendicular to the path). Getting close while still pointing along
  // the previous leg is not enough -- the car would then have to swing wide
  // of the corner when it turns onto the next leg.
  //
  // The car cannot drive exactly through a sharp corner either: its minimum
  // turning radius makes it cut the corner, so it is allowed to be a couple
  // of units to the side (see passTolerance).
  function reached(obs, seg, m) {
    if (m.along > 0 && m.lateral < passTolerance && m.dist < arrive * 4) return true;
    // Safety net: right on top of the waypoint, count it anyway.
    return m.dist < arrive * 0.5;
  }

  // Advance the tracker to the car's position. Returns the new state.
  function update(obs) {
    if (!n) return null;
    if (!origin) origin = [obs.x, obs.z];

    let seg = segment();
    let m = measure(obs, seg);
    const passed = m.along > 0 && m.lateral < passTolerance && m.dist < arrive * 4;
    const advanced = reached(obs, seg, m);

    if (advanced) {
      const next = loop ? (idx + 1) % n : Math.min(idx + 1, n - 1);
      if (next !== idx) {
        idx = next;
        seg = segment();
        m = measure(obs, seg);
      }
    }

    return {
      idx,
      target: { x: seg.bx, z: seg.bz },
      dist: m.dist,
      along: m.along,
      lateral: m.lateral,
      advanced,
      passed,
    };
  }

  // The points of the path ahead of the car, starting at the car's own
  // projection onto it. Exposed so the driver can check the road ahead (for
  // obstacles) and walk along it.
  function nodes(obs) {
    const seg = segment();
    const t = (obs.x - seg.ax) * seg.dx + (obs.z - seg.az) * seg.dz;
    const out = [];
    if (t < 0) {
      // The car is behind the start of the segment (it has not reached the
      // previous waypoint yet): drive to that waypoint first.
      out.push({ x: obs.x, z: obs.z }, { x: seg.ax, z: seg.az });
    } else {
      const tc = Math.min(t, seg.len);
      out.push({ x: seg.ax + seg.dx * tc, z: seg.az + seg.dz * tc });
    }
    out.push({ x: seg.bx, z: seg.bz });
    for (let k = 1; k <= 3; k++) {
      const w = wp(idx + k);
      out.push({ x: w[0], z: w[1] });
    }
    return out;
  }

  // The point to steer at: `lookahead` units ahead of the car, measured along
  // the path. The car is projected onto the path first, so it always aims at
  // the road rather than at whatever is directly in front of it.
  function aim(obs, lookahead) {
    return walkPath(nodes(obs), lookahead);
  }

  // How sharp the turn is at the current target, in radians (0 = straight).
  function cornerAngle() {
    if (n < 2) return 0;
    if (!loop && idx === n - 1) return 0;
    const inSeg = segment();
    const outSeg = segment(idx + 1);
    return angleBetween(inSeg.dx, inSeg.dz, outSeg.dx, outSeg.dz);
  }

  // The waypoint after the current target. Used to plan the next leg of the
  // route before the car gets there.
  function nextTarget() {
    const w = wp(idx + 1);
    return { x: w[0], z: w[1] };
  }

  return {
    update,
    aim,
    nodes,
    cornerAngle,
    nextTarget,
    get index() {
      return idx;
    },
    reset() {
      idx = 0;
      origin = null;
    },
  };
}
