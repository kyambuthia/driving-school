// Physics fidelity: the new rigid-body model vs the old kinematic model.
//
// Both are driven by the same scripted intent sequence, and both use the
// shared control law from src/drive/vehicleModel.js, so any difference in the
// trajectories is a difference in the physics, not in the controller.
//
// Run: node test/fidelity.mjs
import { makeWorld, makeCar, createKinematicCar, stepWorld, readCar, checker, DT } from "./harness.mjs";
import { vehicleConfig } from "../src/drive/vehicleModel.js";

const cfg = vehicleConfig();

// Scripted intent sequences: each gets a fresh car.
const SEQUENCES = {
  "straight full throttle": () => ({ throttle: 1, steer: 0, brake: 0 }),
  "gentle right": () => ({ throttle: 1, steer: 0.35, brake: 0 }),
  "hard right": () => ({ throttle: 1, steer: 1, brake: 0 }),
  "hard left": () => ({ throttle: 1, steer: -1, brake: 0 }),
  "throttle then brake": (t) => (t < 2 ? { throttle: 1, steer: 0, brake: 0 } : { throttle: 0, steer: 0, brake: 1 }),
  "reverse": () => ({ throttle: -1, steer: 0, brake: 0 }),
  "s-curve": (t) => ({ throttle: 1, steer: Math.sin(t * 2) * 0.8, brake: 0 }),
  "stop and go": (t) => (Math.floor(t * 2) % 2 === 0 ? { throttle: 1, steer: 0.2, brake: 0 } : { throttle: 0, steer: 0, brake: 1 }),
};

const SECONDS = 6;
const FRAMES = Math.round(SECONDS / DT);
const { check, finish } = checker();

const api = await makeWorld({ obstacles: [] });

console.log(`physics fidelity: kinematic vs rigid body, ${SECONDS}s per sequence\n`);

for (const [name, script] of Object.entries(SEQUENCES)) {
  // --- old kinematic model ---
  const kin = createKinematicCar({ x: 0, z: 0, heading: Math.PI });
  for (let f = 0; f < FRAMES; f++) kin.step(script(f * DT), DT);

  // --- new rigid-body model ---
  const { body, vehicle } = makeCar(api, { x: 0, z: 0, heading: Math.PI });
  for (let f = 0; f < FRAMES; f++) {
    vehicle.applyIntent(script(f * DT), DT);
    stepWorld(api, DT);
  }
  const rb = readCar(api, body);

  const o = kin.state;
  const dPos = Math.hypot(o.x - rb.x, o.z - rb.z);
  const dSpd = Math.abs(o.speed - rb.speed);
  const dHead = Math.abs(Math.atan2(Math.sin(o.heading - rb.heading), Math.cos(o.heading - rb.heading)));

  console.log(`${name}:`);
  console.log(`  old end: pos=(${o.x.toFixed(2)},${o.z.toFixed(2)}) heading=${o.heading.toFixed(2)} speed=${o.speed.toFixed(2)}`);
  console.log(`  new end: pos=(${rb.x.toFixed(2)},${rb.z.toFixed(2)}) heading=${rb.heading.toFixed(2)} speed=${rb.speed.toFixed(2)}`);
  console.log(`  delta:  pos=${dPos.toFixed(2)} units, heading=${dHead.toFixed(3)} rad, speed=${dSpd.toFixed(2)}`);

  // Tolerance scales with how far the car travelled: a car driving a long way
  // accumulates a little more drift, and a small absolute error on a short
  // run is meaningless.
  const travelled = Math.hypot(o.x, o.z);
  const tol = Math.max(2.5, travelled * 0.18);
  check("final position within tolerance", dPos < tol, `${dPos.toFixed(2)} < ${tol.toFixed(2)}`);
  check("final speed within tolerance", dSpd < 1.2, `${dSpd.toFixed(2)}`);
  check("heading within tolerance", dHead < 0.5, `${dHead.toFixed(3)}`);
}

finish();
