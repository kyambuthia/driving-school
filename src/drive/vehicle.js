import { readBodyState, addForce, addTorque, yawInertia } from "../physics/joltWorld.js";
import { clampIntent, observeVehicle } from "./sim.js";
import {
  vehicleConfig, stepSpeed, stepSteer, yawRateTarget, lateralAccel,
} from "./vehicleModel.js";

// A vehicle is a real Jolt rigid body plus the little per-car state the
// control law needs (the damped steering angle and the wheel spin).
//
// Position, heading and speed always come back from the physics engine, so
// collisions genuinely move and rotate the car. Drivers only ever supply a
// DriveIntent -- they never touch the body.
export function createVehicle({ id = "car", api, body, cfg = {} }) {
  const c = vehicleConfig(cfg);
  let steer = 0; // damped steering angle, in [-maxSteer, maxSteer]
  let wheelSpin = 0;

  // Translate a DriveIntent into forces on the rigid body.
  //
  // The longitudinal part mirrors the old kinematic model in src/drive/sim.js
  // exactly -- same acceleration, braking and friction rates, same speed
  // envelope -- but expresses the result as a force instead of a position
  // update. Jolt then gets the final say on how the car actually moves, so
  // collisions deflect it instead of being pushed out of the way.
  //
  // The constants live in src/drive/vehicleModel.js so the app and the
  // headless harnesses always agree on them.
  function applyIntent(intent, dt) {
    const i = clampIntent(intent);

    // Damped steering, exactly as the kinematic model did it.
    steer = stepSteer(steer, i, dt, c);

    const st = readBodyState(api, body);
    const sinH = Math.sin(st.heading);
    const cosH = Math.cos(st.heading);

    // --- longitudinal: work out the speed change the intent asks for ---
    const vTarget = stepSpeed(st.speed, i, dt, c);
    const dv = vTarget - st.speed;

    // --- lateral grip: cancel sideways slip so the car tracks its nose ---
    const aLat = lateralAccel(st.vLat, c);

    // --- yaw: drive the actual yaw rate towards the target ---
    const yawTarget = yawRateTarget(st.speed, steer, c);
    const torque = (yawTarget - st.yawRate) * yawInertia(api, body) * c.yawGain;

    const fLong = (dv / dt) * c.mass;
    const fLat = aLat * c.mass;
    addForce(api, body, sinH * fLong + cosH * fLat, cosH * fLong - sinH * fLat);
    addTorque(api, body, torque);
  }

  // Observation handed to drivers. Same shape as the old kinematic model, so
  // the human, waypoint-AI and remote-agent drivers need no changes.
  function observe(extra = {}) {
    const st = readBodyState(api, body);
    return observeVehicle({ ...st, steer }, extra);
  }

  function readState(dt = 0) {
    const st = readBodyState(api, body);
    wheelSpin += (st.speed / c.wheelRadius) * dt;
    return { ...st, steer, wheelSpin };
  }

  return {
    id,
    api,
    body,
    cfg: c,
    applyIntent,
    observe,
    readState,
    get steer() {
      return steer;
    },
  };
}
