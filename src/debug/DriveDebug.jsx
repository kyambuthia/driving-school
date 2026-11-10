import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";

function Marker({ position, color = "#22c55e", size = 0.32 }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[size, 14, 14]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} transparent opacity={0.9} />
    </mesh>
  );
}

function predictArc({ x, z, heading, speed = 0, steer = 0 }, { steps = 70, dt = 0.085, maxSpeed = 7, turnFactor = 1.6 } = {}) {
  const pts = [[x, 0.13, z]];
  let h = heading, px = x, pz = z;
  const sp = Math.max(Math.abs(speed), 1.5) * Math.sign(speed || 1); // show intent even when slow
  for (let i = 0; i < steps; i++) {
    h += (sp / maxSpeed) * steer * turnFactor * dt;
    px += Math.sin(h) * Math.abs(sp) * dt;
    pz += Math.cos(h) * Math.abs(sp) * dt;
    pts.push([px, 0.13, pz]);
  }
  return pts;
}

export default function DriveDebug({ drivers = [], obstacles = [] }) {
  const [snap, setSnap] = useState(0);
  const acc = useRef(0);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current > 0.08) { acc.current = 0; setSnap((n) => n + 1); }
  });

  return (
    <group>
      {obstacles.map((o, i) => (
        <group key={`o-${i}`} position={[o.x, 0.05, o.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[(o.r || 1) - 0.05, (o.r || 1) + 0.05, 32]} />
            <meshBasicMaterial color="#f87171" transparent opacity={0.7} side={2} />
          </mesh>
        </group>
      ))}

      {drivers.map((d, i) => {
        const dbg = d?.debug;
        if (!dbg) return null;
        const y = 0.12 + i * 0.015;
        const color = i === 0 ? "#38bdf8" : "#fb923c";
        const items = [];

        if (Array.isArray(dbg.waypoints) && dbg.waypoints.length > 1) {
          const pts = dbg.waypoints.map(([wx, wz]) => [wx, y, wz]);
          pts.push([dbg.waypoints[0][0], y, dbg.waypoints[0][1]]);
          items.push(<Line key={`${d.id}-wp`} points={pts} color={color} lineWidth={1} transparent opacity={0.35} dashed dashSize={0.4} gapSize={0.25} />);
        }
        if (Array.isArray(dbg.plan) && dbg.plan.length > 1 && dbg.obs) {
          const pts = [[dbg.obs.x, y + 0.02, dbg.obs.z], ...dbg.plan.map((p) => [p.x, y + 0.02, p.z])];
          items.push(<Line key={`${d.id}-plan`} points={pts} color="#22d3ee" lineWidth={2} transparent opacity={0.8} />);
        }
        if (dbg.target) {
          const tcolor = dbg.recovering ? "#f59e0b" : "#22c55e";
          items.push(<Marker key={`${d.id}-tgt`} position={[dbg.target.x, 0.35, dbg.target.z]} color={tcolor} size={0.3} />);
        }
        if (dbg.obs) {
          const steer = dbg.intent?.steer ?? 0;
          const speed = dbg.obs.speed ?? 0;
          const arc = predictArc({ x: dbg.obs.x, z: dbg.obs.z, heading: dbg.obs.heading, speed, steer: steer * 0.5 });
          const acolor = dbg.recovering ? "#f59e0b" : "#22c55e";
          items.push(<Line key={`${d.id}-arc`} points={arc} color={acolor} lineWidth={2.5} transparent opacity={0.85} />);
          if (dbg.target) {
            items.push(<Line key={`${d.id}-intend`} points={[[dbg.obs.x, y, dbg.obs.z], [dbg.target.x, y, dbg.target.z]]} color={acolor} lineWidth={1} transparent opacity={0.2} dashed dashSize={0.2} gapSize={0.15} />);
          }
        }
        if (Array.isArray(dbg.whiskers) && dbg.obs) {
          dbg.whiskers.forEach((w, wi) => {
            const endT = w.t;
            items.push(<Line key={`${d.id}-w-${wi}`} points={[[dbg.obs.x, y, dbg.obs.z], [dbg.obs.x + w.dir.x * endT, y, dbg.obs.z + w.dir.z * endT]]} color={w.hit ? "#ef4444" : "#a3e635"} lineWidth={w.hit ? 2 : 1} transparent opacity={w.hit ? 0.9 : 0.4} />);
          });
        }
        return <group key={d.id || i}>{items}</group>;
      })}
      <group visible={false}>{snap}</group>
    </group>
  );
}
