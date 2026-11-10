// The vehicle model: tunables + the control law that turns a DriveIntent into
// motion.
//
// It lives in its own module because the app (src/drive/vehicle.js, driving
// real Jolt rigid bodies) and the headless harnesses (test/*) must agree on it
// exactly. The harnesses compare the rigid-body model against the old
// kinematic one, so the numbers must not drift apart between the two.
//
// Convention: cars drive on the XZ plane, forward = (sin h, cos h), heading is
// the yaw about +Y, and speed is the signed forward speed.

import { MathUtils } from "three";

export const VEHICLE_DEFAULTS = {
  maxSpeed: 7,
  reverseMax: 7 * 0.45,
  accelRate: 9, // m/s^2 at full throttle
  brakeRate: 14, // m/s^2 at full brake
  friction: 4.5, // m/s^2 of coasting drag
  maxSteer: 1.0, // rad
  steerResponse: 7, // 1/s: how fast the wheels reach the requested angle
  turnFactor: 2.0, // scales the yaw rate the steering angle produces
  wheelRadius: 0.35,
  mass: 1200, // kg
  grip: 16, // 1/s: how hard sideways slip is cancelled
  maxLatAccel: 16, // m/s^2: cap on the grip force
  yawGain: 10, // 1/s: how hard the yaw rate is driven towards its target
};

export function vehicleConfig(overrides = {}) {
  return { ...VEHICLE_DEFAULTS, ...overrides };
}

// The forward speed the intent asks for, starting from the current speed.
// Mirrors the old kinematic model exactly (same acceleration, braking and
// coasting rates, same speed envelope).
export function stepSpeed(speed, intent, dt, cfg) {
  let v = speed;
  if (Math.abs(intent.throttle) > 1e-3) v += intent.throttle * cfg.accelRate * dt;
  if (intent.brake > 1e-3) {
    const sign = Math.sign(v) || 0;
    v -= sign * Math.min(Math.abs(v), cfg.brakeRate * intent.brake * dt);
  }
  if (Math.abs(intent.throttle) < 1e-3 && intent.brake < 1e-3) {
    const sign = Math.sign(v) || 0;
    v -= sign * Math.min(Math.abs(v), cfg.friction * dt);
  }
  return MathUtils.clamp(v, -cfg.reverseMax, cfg.maxSpeed);
}

// Damped steering angle, in rad.
export function stepSteer(steer, intent, dt, cfg) {
  return MathUtils.damp(steer, intent.steer * cfg.maxSteer, cfg.steerResponse, dt);
}

// Yaw rate (rad/s) the current steering angle asks for.
export function yawRateTarget(speed, steer, cfg) {
  return (speed / cfg.maxSpeed) * steer * cfg.turnFactor;
}

// The turn radius the car can hold at full lock.
//
// NOTE: because the yaw rate scales with the speed, the turn radius
// (v / yawRate) is the same at every speed: maxSpeed / (maxSteer * turnFactor)
// -- about 5.8 units with the defaults. That is still a wide turning circle,
// and it is the reason the path follower has to cut corners (see
// pathTracker.js) and the planner has to leave room for the cut.
export function minTurnRadius(cfg) {
  return cfg.maxSpeed / Math.max(1e-6, cfg.maxSteer * cfg.turnFactor);
}

// Lateral acceleration (m/s^2) that cancels the sideways slip.
export function lateralAccel(vLat, cfg) {
  return MathUtils.clamp(-vLat * cfg.grip, -cfg.maxLatAccel, cfg.maxLatAccel);
}
