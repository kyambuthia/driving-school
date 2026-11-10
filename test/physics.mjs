// Physics behaviour: the rigid-body model must accelerate, brake, coast,
// steer, reverse and collide like a real car.
//
// Run: node test/physics.mjs
import { makeWorld, makeCar, stepWorld, readCar, checker, DT } from "./harness.mjs";

const { check, finish } = checker();
const api = await makeWorld({ obstacles: [] });

const drive = (body, vehicle, intent, frames) => {
  for (let i = 0; i < frames; i++) {
    vehicle.applyIntent(intent, DT);
    stepWorld(api, DT);
  }
  return readCar(api, body);
};

console.log("=== accelerates forward under throttle ===");
{
  const { body, vehicle } = makeCar(api, { x: 0, z: 0, heading: Math.PI });
  const s = drive(body, vehicle, { throttle: 1, steer: 0, brake: 0 }, 120);
  console.log(`  pos=(${s.x.toFixed(2)},${s.z.toFixed(2)}) speed=${s.speed.toFixed(2)}`);
  check("moves toward -Z (heading PI faces -Z)", s.z < -8, `z=${s.z.toFixed(2)}`);
  check("reaches the speed cap", Math.abs(s.speed - 7) < 0.35, `speed=${s.speed.toFixed(2)}`);
  check("does not drift sideways", Math.abs(s.vLat) < 0.15, `vLat=${s.vLat.toFixed(3)}`);
  check("stays on the ground plane", Math.abs(s.y - 0.575) < 1e-3, `y=${s.y.toFixed(3)}`);
}

console.log("=== brakes to a stop ===");
{
  const { body, vehicle } = makeCar(api, { x: 0, z: 0, heading: Math.PI });
  drive(body, vehicle, { throttle: 1, steer: 0, brake: 0 }, 120);
  const s = drive(body, vehicle, { throttle: 0, steer: 0, brake: 1 }, 120);
  console.log(`  speed=${s.speed.toFixed(3)}`);
  check("stops under braking", Math.abs(s.speed) < 0.5, `speed=${s.speed.toFixed(3)}`);
}

console.log("=== coasts to a stop on friction alone ===");
{
  const { body, vehicle } = makeCar(api, { x: 0, z: 0, heading: Math.PI });
  drive(body, vehicle, { throttle: 1, steer: 0, brake: 0 }, 120);
  const s = drive(body, vehicle, { throttle: 0, steer: 0, brake: 0 }, 300);
  console.log(`  speed=${s.speed.toFixed(3)}`);
  check("coasts down to a stop", Math.abs(s.speed) < 0.4, `speed=${s.speed.toFixed(3)}`);
}

console.log("=== steering turns the car ===");
{
  const { body, vehicle } = makeCar(api, { x: 0, z: 0, heading: Math.PI });
  const s = drive(body, vehicle, { throttle: 1, steer: 1, brake: 0 }, 180);
  const turned = Math.abs(s.heading - Math.PI);
  console.log(`  heading=${s.heading.toFixed(3)} (turned ${turned.toFixed(3)} rad) x=${s.x.toFixed(2)}`);
  check("yaw changes when steering", turned > 0.5, `turned=${turned.toFixed(3)}`);
}

console.log("=== reversing ===");
{
  const { body, vehicle } = makeCar(api, { x: 0, z: 0, heading: Math.PI });
  const s = drive(body, vehicle, { throttle: -1, steer: 0, brake: 0 }, 180);
  console.log(`  z=${s.z.toFixed(2)} speed=${s.speed.toFixed(2)}`);
  check("reverses backwards", s.z > 1, `z=${s.z.toFixed(2)}`);
  check("reverse speed is capped at 3.15", Math.abs(s.speed + 3.15) < 0.4, `speed=${s.speed.toFixed(2)}`);
}

console.log("=== a wall stops the car (real collision response) ===");
{
  const world = await makeWorld({ obstacles: [{ x: 0, z: -12, r: 1.3 }] });
  const { body, vehicle } = makeCar(world, { x: 0, z: 0, heading: Math.PI });
  const s = drive(body, vehicle, { throttle: 1, steer: 0, brake: 0 }, 300);
  console.log(`  z=${s.z.toFixed(2)} nose=${(s.z - 1.1).toFixed(2)} (cylinder face at -12.7)`);
  check("car stops at the cylinder", s.z > -11.9 && s.z < -9.0, `z=${s.z.toFixed(2)}`);
  check("car does not tunnel through", s.z > -12.7, `z=${s.z.toFixed(2)}`);
}

console.log("=== two cars collide ===");
{
  const world = await makeWorld({ obstacles: [] });
  const a = makeCar(world, { x: 0, z: 0, heading: Math.PI });
  const b = makeCar(world, { x: 0, z: -8, heading: Math.PI });
  for (let i = 0; i < 240; i++) {
    a.vehicle.applyIntent({ throttle: 1, steer: 0, brake: 0 }, DT);
    stepWorld(world, DT);
  }
  const sa = readCar(world, a.body);
  const sb = readCar(world, b.body);
  console.log(`  A z=${sa.z.toFixed(2)} speed=${sa.speed.toFixed(2)} | B z=${sb.z.toFixed(2)} speed=${sb.speed.toFixed(2)}`);
  check("A is blocked by B", sa.z > sb.z, `A=${sa.z.toFixed(2)} B=${sb.z.toFixed(2)}`);
  check("B was pushed forwards", sb.z < -8, `B=${sb.z.toFixed(2)}`);
  check("the two cars stay in contact, not overlapping", Math.abs((sa.z - sb.z)) < 2.4, `gap=${(sb.z - sa.z).toFixed(2)}`);
}

finish();
