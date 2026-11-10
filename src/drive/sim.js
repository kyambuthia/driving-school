import { MathUtils } from "three";

export function clampIntent(intent = {}) {
  return {
    throttle: MathUtils.clamp(Number(intent.throttle) || 0, -1, 1),
    steer: MathUtils.clamp(Number(intent.steer) || 0, -1, 1),
    brake: MathUtils.clamp(Number(intent.brake) || 0, 0, 1),
  };
}

// Shape of the observation handed to drivers and published to remote agents.
// Vehicles are rigid bodies now (see src/drive/vehicle.js), but the
// observation stays the same so drivers did not have to change.
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
