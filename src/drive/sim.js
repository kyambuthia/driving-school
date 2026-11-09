import { MathUtils } from "three";

export function createVehicleState(overrides = {}) {
  return {
    x: 0,
    y: 0,
    z: 0,
    heading: Math.PI, // face -Z
    speed: 0,
    steer: 0,
    wheelSpin: 0,
    ...overrides,
  };
}

export function clampIntent(intent = {}) {
  return {
    throttle: MathUtils.clamp(Number(intent.throttle) || 0, -1, 1),
    steer: MathUtils.clamp(Number(intent.steer) || 0, -1, 1),
    brake: MathUtils.clamp(Number(intent.brake) || 0, 0, 1),
  };
}

// Advances vehicle state in-place (and returns it) for performance.
export function stepVehicle(state, intent, dt, cfg = {}) {
  const i = clampIntent(intent);
  const maxSpeed = cfg.maxSpeed ?? 7;
  const reverseMax = cfg.reverseMax ?? maxSpeed * 0.45;
  const accelRate = cfg.accelRate ?? 9;
  const brakeRate = cfg.brakeRate ?? 14;
  const friction = cfg.friction ?? 4.5;
  const maxSteer = cfg.maxSteer ?? 0.5;
  const steerResponse = cfg.steerResponse ?? 7;
  const turnFactor = cfg.turnFactor ?? 1.6;
  const wheelRadius = cfg.wheelRadius ?? 0.35;

  const targetAccel = i.throttle * accelRate;
  if (Math.abs(i.throttle) > 0.001) state.speed += targetAccel * dt;
  if (i.brake > 0.001) {
    const sign = Math.sign(state.speed) || 0;
    state.speed -= sign * Math.min(Math.abs(state.speed), brakeRate * i.brake * dt);
  }
  if (Math.abs(i.throttle) < 0.001 && i.brake < 0.001) {
    const sign = Math.sign(state.speed) || 0;
    state.speed -= sign * Math.min(Math.abs(state.speed), friction * dt);
  }
  state.speed = MathUtils.clamp(state.speed, -reverseMax, maxSpeed);

  state.steer = MathUtils.damp(state.steer, i.steer * maxSteer, steerResponse, dt);
  if (Math.abs(state.speed) > 0.02) {
    state.heading += (state.speed / maxSpeed) * state.steer * turnFactor * dt;
  }
  state.wheelSpin += (state.speed / Math.max(wheelRadius, 0.001)) * dt;

  state.x += Math.sin(state.heading) * state.speed * dt;
  state.z += Math.cos(state.heading) * state.speed * dt;
  return state;
}

export function observeVehicle(state, extra = {}) {
  return {
    type: "obs",
    x: +state.x.toFixed(3),
    z: +state.z.toFixed(3),
    heading: +state.heading.toFixed(3),
    speed: +state.speed.toFixed(3),
    steer: +state.steer.toFixed(3),
    ...extra,
  };
}


export function resolveCollisions(state, obstacles = [], selfRadius = 0.95) {
  if (!obstacles || !obstacles.length) return state;
  for (let iter = 0; iter < 2; iter++) {
    for (const o of obstacles) {
      const r = (o.r || 1) + selfRadius;
      const dx = state.x - o.x;
      const dz = state.z - o.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d, nz = dz / d;
      const push = (r - d) + 0.001;
      state.x += nx * push;
      state.z += nz * push;
      // damp velocity component into the obstacle
      const vInto = Math.sin(state.heading) * state.speed * nx + Math.cos(state.heading) * state.speed * nz;
      if (vInto < 0) state.speed *= 0.65;
    }
  }
  return state;
}
