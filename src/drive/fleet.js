import { stepPhysics } from "../physics/joltWorld.js";

// The fleet owns the per-frame order of the simulation.
//
// Rigid-body cars need a strict order every frame:
//   1. every car turns its observation into a DriveIntent and applies forces
//   2. the world is stepped (forces are consumed, collisions are resolved)
//   3. every car reads its new transform back and updates the scene
//
// Spreading that across independent useFrame callbacks would make the order
// depend on component mount order, so it is driven from one place instead.
export function createFleet() {
  const vehicles = new Map();
  // Useful when the sandbox is inspected from outside (console, test harness):
  // how much simulated time has actually elapsed, and over how many frames.
  const stats = { frames: 0, simTime: 0, lastDt: 0 };

  // The largest step the simulation will take. Physics and the control law
  // must agree on how much time passed, otherwise a long frame (a stall, a
  // background tab, a slow GPU) would make the drivers integrate a much
  // larger time slice than Jolt actually simulates.
  const MAX_DT = 1 / 30;

  return {
    stats,
    register(id, hooks) {
      vehicles.set(id, hooks);
    },

    unregister(id) {
      vehicles.delete(id);
    },

    get size() {
      return vehicles.size;
    },

    step(dt, api) {
      if (!api || !vehicles.size) return;
      const d = Math.min(dt, MAX_DT);
      stats.frames++;
      stats.lastDt = d;
      stats.simTime += d;
      for (const v of vehicles.values()) v.beforeStep?.(d, api);
      stepPhysics(api, d);
      for (const v of vehicles.values()) v.afterStep?.(d, api);
    },
  };
}
