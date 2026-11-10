import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { createVehicle } from "./drive/vehicle";

// Procedural car (wheels + chassis). Driver-agnostic: consumes DriveIntent.
//
// The car is a real Jolt rigid body. The physics world steps itself once per
// frame, and this component plugs into that step through the fleet: it turns
// the body's state into an observation for the driver, and applies the
// resulting intent as forces.
export default function Car({
  id = "car",
  driver, // { getIntent(obs, ctx), kind, id, debug? }
  remoteBridge,
  obstacles = null, // array or (selfId) => array
  reportPose = null, // (id, pose) => void
  initial = {},
  chassis = [1.1, 0.45, 2.2], // [width X, height Y, length Z]
  cabin = [0.95, 0.4, 1.05],
  wheelRadius = 0.35,
  wheelWidth = 0.24,
  color = "#2563eb",
  cabinColor = "#60a5fa",
  followCamera = false,
  api = null, // Jolt api
  fleet = null, // fleet coordinator
}) {
  const car = useRef();
  const vehicle = useRef(null);
  const { camera, controls } = useThree();
  const cam = useRef({ pos: new Vector3(4, 3.5, 5), look: new Vector3(0, 0.6, 0) });
  const obsAcc = useRef(0);

  const [cw, ch, cl] = chassis;
  const wheelbase = cl * 0.58;
  const track = cw / 2 + wheelWidth / 2 + 0.03;
  const axleY = wheelRadius;
  const chassisY = axleY + ch * 0.35;

  const mounts = useMemo(
    () => [
      { key: "fl", pos: [track, axleY, wheelbase / 2], front: true },
      { key: "fr", pos: [-track, axleY, wheelbase / 2], front: true },
      { key: "rl", pos: [track, axleY, -wheelbase / 2], front: false },
      { key: "rr", pos: [-track, axleY, -wheelbase / 2], front: false },
    ],
    [track, axleY, wheelbase]
  );

  // Register with the fleet so this car takes part in the world's step.
  // The car keeps its own kinematic state in sync with the rigid body, and the
  // driver only ever sees a plain observation.
  useEffect(() => {
    if (!api || !fleet) return;
    const v = createVehicle({
      id,
      api,
      body: api.createCarBody({
        x: initial.x ?? 0,
        z: initial.z ?? 0,
        heading: initial.heading ?? Math.PI,
        w: cw,
        h: ch,
        l: cl,
      }),
      cfg: { wheelRadius },
    });
    vehicle.current = v;

    fleet.register(id, {
      // Runs before the physics step: ask the driver for an intent and apply
      // it to the body as forces.
      beforeStep(dt) {
        const obsObstacles = typeof obstacles === "function" ? obstacles(id) : obstacles;
        const ctx = { obstacles: obsObstacles || [], dt };
        const obs = v.observe({ id, driver: driver?.kind || "none" });
        const intent = driver?.getIntent ? driver.getIntent(obs, ctx) : { throttle: 0, steer: 0 };
        v.applyIntent(intent, dt);
      },
      // Runs after the physics step: read the new transform back and sync the
      // scene and the pose other cars see.
      afterStep(dt) {
        const s = v.readState(dt);
        if (!car.current) return;
        car.current.position.set(s.x, 0, s.z);
        car.current.rotation.y = s.heading;
        car.current.userData.steer = s.steer;
        car.current.userData.spin = s.wheelSpin;
        car.current.userData.state = s;
        reportPose?.(id, { x: s.x, z: s.z, heading: s.heading, speed: s.speed, r: 0.95 });

        if (remoteBridge && driver?.kind === "remote") {
          obsAcc.current += dt;
          if (obsAcc.current > 0.05) {
            obsAcc.current = 0;
            remoteBridge.sendObs({ type: "obs", id, x: +s.x.toFixed(3), z: +s.z.toFixed(3), heading: +s.heading.toFixed(3), speed: +s.speed.toFixed(3), steer: +s.steer.toFixed(3) });
          }
        }

        if (followCamera) {
          const behind = new Vector3(-Math.sin(s.heading), 0, -Math.cos(s.heading)).multiplyScalar(6.5);
          behind.y = 3.3;
          const desiredPos = new Vector3(s.x + behind.x, behind.y, s.z + behind.z);
          const desiredLook = new Vector3(s.x, 0.7, s.z);
          cam.current.pos.lerp(desiredPos, 1 - Math.exp(-4 * dt));
          cam.current.look.lerp(desiredLook, 1 - Math.exp(-6 * dt));
          camera.position.copy(cam.current.pos);
          if (controls?.target) {
            controls.target.copy(cam.current.look);
            controls.update();
          } else camera.lookAt(cam.current.look);
        }
      },
    });

    return () => {
      fleet.unregister(id);
      api.removeCarBody(v.body);
      vehicle.current = null;
    };
  }, [api, fleet, id, cw, ch, cl, wheelRadius]);

  // Place the car at its spawn point until the body takes over.
  useEffect(() => {
    if (!car.current) return;
    car.current.position.set(initial.x ?? 0, 0, initial.z ?? 0);
    car.current.rotation.y = initial.heading ?? Math.PI;
  }, [initial.x, initial.z, initial.heading]);

  return (
    <group ref={car}>
      <mesh position={[0, chassisY, 0]} castShadow receiveShadow>
        <boxGeometry args={[cw, ch, cl]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.2} />
      </mesh>
      <mesh position={[0, chassisY + ch / 2 + cabin[1] / 2, -cl * 0.08]} castShadow receiveShadow>
        <boxGeometry args={cabin} />
        <meshStandardMaterial color={cabinColor} roughness={0.3} metalness={0.15} />
      </mesh>
      <mesh position={[0, chassisY, cl / 2 + 0.01]} castShadow>
        <boxGeometry args={[cw * 0.7, ch * 0.25, 0.02]} />
        <meshStandardMaterial color="#e2e8f0" emissive={cabinColor} emissiveIntensity={0.15} />
      </mesh>
      <Wheels carRef={car} mounts={mounts} radius={wheelRadius} width={wheelWidth} />
    </group>
  );
}

function Wheels({ carRef, mounts, radius, width }) {
  const refs = useRef([]);
  useFrame(() => {
    const steer = carRef.current?.userData.steer || 0;
    const spin = carRef.current?.userData.spin || 0;
    mounts.forEach((m, i) => {
      const g = refs.current[i];
      if (!g) return;
      g.rotation.y = m.front ? steer : 0;
      const axle = g.children[0];
      if (axle) axle.children.forEach((c) => (c.rotation.y = spin));
    });
  });
  return (
    <>
      {mounts.map((m, i) => (
        <group key={m.key} ref={(el) => (refs.current[i] = el)} position={m.pos}>
          <group rotation={[0, 0, Math.PI / 2]}>
            <mesh castShadow receiveShadow>
              <cylinderGeometry args={[radius, radius, width, 28]} />
              <meshStandardMaterial color="#111827" roughness={0.9} metalness={0.05} />
            </mesh>
            <mesh position={[0, width / 2 + 0.002, 0]} castShadow>
              <cylinderGeometry args={[radius * 0.28, radius * 0.28, 0.02, 16]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.4} roughness={0.3} />
            </mesh>
            <mesh position={[0, -width / 2 - 0.002, 0]} castShadow>
              <cylinderGeometry args={[radius * 0.28, radius * 0.28, 0.02, 16]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.4} roughness={0.3} />
            </mesh>
          </group>
        </group>
      ))}
    </>
  );
}
