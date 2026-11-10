// Shared rig for the headless tests.
//
// Everything here is the *real* app code: the Jolt world from
// src/physics/joltWorld.js, the vehicle wrapper from src/drive/vehicle.js and
// the tunables from src/drive/vehicleModel.js. The tests used to copy the
// control law into each file, which meant they could silently drift away
// from what the browser actually runs.
//
// The one thing kept here that the app no longer has is the old kinematic
// model: it is the reference the rigid-body model is compared against.

import {
  initPhysics, clearBodies, createGround, createObstacleBody, createCarBody, stepPhysics, readBodyState,
} from "../src/physics/joltWorld.js";
import { createVehicle } from "../src/drive/vehicle.js";
import { vehicleConfig, stepSpeed, stepSteer } from "../src/drive/vehicleModel.js";

export const DT = 1 / 60;

// A Jolt world with a ground plane and the arena's obstacles.
//
// Every scenario starts from a clean world: the bodies of the previous
// scenario are removed, so the cars of one scenario can never bump into the
// cars of another. The world itself is a singleton (the WASM heap is too
// small to host several of them).
export async function makeWorld({ obstacles = [], ground = true } = {}) {
  const api = await initPhysics();
  clearBodies(api);
  if (ground) createGround(api);
  for (const o of obstacles) createObstacleBody(api, o);
  return api;
}

// A car body plus its vehicle wrapper (the thing a driver talks to).
export function makeCar(api, { x = 0, z = 0, heading = Math.PI, w = 1.1, h = 0.45, l = 2.2, cfg = {} } = {}) {
  const body = createCarBody(api, { x, z, heading, w, h, l });
  const vehicle = createVehicle({ id: "car", api, body, cfg });
  return { body, vehicle };
}

export function readCar(api, body) {
  return readBodyState(api, body);
}

export function stepWorld(api, dt = DT) {
  stepPhysics(api, dt);
}

// The old kinematic model, verbatim from the pre-rigid-body src/drive/sim.js.
// It is the reference the rigid-body model has to match.
export function createKinematicCar(initial = {}) {
  const cfg = vehicleConfig();
  const state = { x: 0, z: 0, heading: Math.PI, speed: 0, steer: 0, ...initial };
  return {
    cfg,
    state,
    step(intent, dt) {
      const i = {
        throttle: Number(intent.throttle) || 0,
        steer: Number(intent.steer) || 0,
        brake: Number(intent.brake) || 0,
      };
      state.speed = stepSpeed(state.speed, i, dt, cfg);
      state.steer = stepSteer(state.steer, i, dt, cfg);
      if (Math.abs(state.speed) > 0.02) {
        state.heading += (state.speed / cfg.maxSpeed) * state.steer * cfg.turnFactor * dt;
      }
      state.x += Math.sin(state.heading) * state.speed * dt;
      state.z += Math.cos(state.heading) * state.speed * dt;
      return state;
    },
    observe(id) {
      return {
        type: "obs", x: state.x, z: state.z, heading: state.heading,
        speed: state.speed, steer: state.steer, id,
      };
    },
  };
}

// The old push-out-of-obstacles collision resolver, verbatim from the
// pre-rigid-body src/drive/sim.js.
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
      const vInto = Math.sin(state.heading) * state.speed * nx + Math.cos(state.heading) * state.speed * nz;
      if (vInto < 0) state.speed *= 0.65;
    }
  }
  return state;
}

// Tiny assertion helper so every test prints the same way.
export function checker() {
  let failures = 0;
  return {
    check(name, cond, detail = "") {
      console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
      if (!cond) failures++;
      return cond;
    },
    get failures() {
      return failures;
    },
    finish() {
      console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
      process.exit(failures === 0 ? 0 : 1);
    },
  };
}
