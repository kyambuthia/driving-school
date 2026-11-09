import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { createVehicleState, stepVehicle, observeVehicle, resolveCollisions } from "./drive/sim";

// Procedural car (wheels + chassis). Driver-agnostic: consumes DriveIntent.
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
}) {
  const car = useRef();
  const state = useRef(createVehicleState(initial));
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

  useFrame((_, dt) => {
    const s = state.current;
    const obs = observeVehicle(s, { id, driver: driver?.kind || "none" });
    const obsObstacles = typeof obstacles === "function" ? obstacles(id) : obstacles;
    const ctx = { obstacles: obsObstacles || [], dt };
    const intent = driver?.getIntent ? driver.getIntent(obs, ctx) : { throttle: 0, steer: 0 };
    stepVehicle(s, intent, dt, { wheelRadius, maxSpeed: 7 });
    resolveCollisions(s, ctx.obstacles, 0.95);

    if (!car.current) return;
    car.current.position.set(s.x, 0, s.z);
    car.current.rotation.y = s.heading;
    car.current.userData.steer = s.steer;
    car.current.userData.spin = s.wheelSpin;
    car.current.userData.state = s; // for debug views
    reportPose?.(id, { x: s.x, z: s.z, heading: s.heading, speed: s.speed, r: 0.95 });

    if (remoteBridge && driver?.kind === "remote") {
      obsAcc.current += dt;
      if (obsAcc.current > 0.05) {
        obsAcc.current = 0;
        remoteBridge.sendObs(observeVehicle(s, { id }));
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
      if (controls?.target) { controls.target.copy(cam.current.look); controls.update(); }
      else camera.lookAt(cam.current.look);
    }
  });

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
