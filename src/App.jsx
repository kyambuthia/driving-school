import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, Environment } from "@react-three/drei";
import Car from "./Car";
import DriveDebug from "./debug/DriveDebug";
import { createKeyboardController, createWaypointAgent, createRemoteAgentBridge } from "./drive/controllers";
import { initPhysics, stepPhysics, createGround, createObstacleBody } from "./physics/joltWorld";

const STATIC_OBSTACLES = [
  { x: 8, z: -18, r: 1.3 }, { x: -8, z: -20, r: 1.1 }, { x: 4, z: -28, r: 1.4 },
  { x: -2, z: -10, r: 1.0 }, { x: 0, z: -2, r: 0.9 }, { x: 12, z: -12, r: 1.2 },
  { x: -12, z: -14, r: 1.25 }, { x: 10, z: -24, r: 1.0 }, { x: -10, z: -26, r: 1.15 },
  { x: 2, z: -22, r: 0.85 }, { x: -4, z: -6, r: 1.05 }, { x: 6, z: -34, r: 1.3 },
  { x: -6, z: -34, r: 1.3 },
];

function ObstacleMeshes({ obstacles }) {
  return obstacles.map((o, i) => (
    <mesh key={i} position={[o.x, 0.75, o.z]} castShadow receiveShadow>
      <cylinderGeometry args={[o.r, o.r, 1.5, 20]} />
      <meshStandardMaterial color="#991b1b" roughness={0.6} metalness={0.1} />
    </mesh>
  ));
}

function PhysicsStep({ api }) {
  useFrame((_, dt) => { if (api) stepPhysics(api, dt); });
  return null;
}

export default function App() {
  const [mode, setMode] = useState("human");
  const [remoteStatus, setRemoteStatus] = useState("disconnected");
  const [showDebug, setShowDebug] = useState(true);
  const [physics, setPhysics] = useState({ status: "loading", api: null, error: null });

  const vehiclesRef = useRef({});

  const keyboard = useMemo(() => createKeyboardController(window), []);
  const remote = useMemo(() => createRemoteAgentBridge(), []);

  const npcDefs = useMemo(() => ([
    { id: "npc-1", color: "#ea580c", cabin: "#fdba74", initial: { x: 0, z: -4, heading: Math.PI }, wp: [[8,-12],[8,-32],[-8,-32],[-8,-12],[0,-4]] },
    { id: "npc-2", color: "#16a34a", cabin: "#86efac", initial: { x: 3, z: -8, heading: Math.PI }, wp: [[10,-10],[-10,-10],[-10,-30],[10,-30],[3,-8]] },
    { id: "npc-3", color: "#9333ea", cabin: "#d8b4fe", initial: { x: -3, z: -6, heading: Math.PI }, wp: [[-6,-14],[-6,-26],[6,-26],[6,-14],[-3,-6]] },
    { id: "npc-4", color: "#0891b2", cabin: "#67e8f9", initial: { x: 6, z: -16, heading: 2.6 }, wp: [[12,-16],[12,-22],[-12,-22],[-12,-16],[6,-16]] },
    { id: "npc-5", color: "#ca8a04", cabin: "#fde047", initial: { x: -5, z: -18, heading: 3.6 }, wp: [[0,-6],[7,-20],[0,-34],[-7,-20],[-5,-18]] },
  ]), []);

  useEffect(() => {
    let dead = false;
    initPhysics().then((api) => {
      if (dead) return;
      createGround(api);
      for (const o of STATIC_OBSTACLES) createObstacleBody(api, o);
      setPhysics({ status: "ready", api, error: null });
    }).catch((e) => { if (!dead) setPhysics({ status: "error", api: null, error: String(e?.message || e) }); });
    return () => { dead = true; };
  }, []);

  const agents = useMemo(() => {
    const getDynamic = (selfId) => {
      const out = [];
      for (const [vid, v] of Object.entries(vehiclesRef.current)) if (vid !== selfId && v) out.push({ x: v.x, z: v.z, r: (v.r || 0.95) + 0.45 });
      return out;
    };
    const make = (id, wp) => createWaypointAgent({ id, loop: true, arrive: 1.8, waypoints: wp, getObstacles: () => getDynamic(id).concat(STATIC_OBSTACLES) });
    return { playerAI: make("player-ai", [[8,-8],[8,-28],[-8,-28],[-8,-8],[0,0]]), npcs: Object.fromEntries(npcDefs.map((d) => [d.id, make(d.id, d.wp)])) };
  }, [npcDefs]);

  useEffect(() => remote.subscribe(setRemoteStatus), [remote]);
  useEffect(() => { if (mode === "remote") remote.connect(); else remote.disconnect(); }, [mode, remote]);
  useEffect(() => () => { keyboard.dispose(); remote.dispose(); }, [keyboard, remote]);

  const reportPose = (id, pose) => { vehiclesRef.current[id] = pose; };
  const getObstaclesFor = (id) => {
    const dyn = [];
    for (const [vid, v] of Object.entries(vehiclesRef.current)) if (vid !== id && v) dyn.push({ x: v.x, z: v.z, r: (v.r || 0.95) + 0.45 });
    return dyn.concat(STATIC_OBSTACLES);
  };

  const playerDriver = mode === "human" ? keyboard : mode === "ai" ? agents.playerAI : remote;
  const modeLabel = mode === "remote" ? `remote (${remoteStatus})` : mode;
  const debugDrivers = showDebug ? [playerDriver, ...Object.values(agents.npcs)].filter((d) => d && d.debug) : [];

  return (
    <>
      <div className="hud">
        <div><strong>ndoto</strong> — vehicles + Jolt colliders (static) · curved intent debug</div>
        <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", pointerEvents: "auto" }}>
          {[["human","Human (WASD)"],["ai","AI driver"],["remote","Remote agent (WS)"]].map(([m,label]) => (
            <button key={m} type="button" onClick={() => setMode(m)} style={{ cursor: "pointer", borderRadius: 6, border: "1px solid rgba(148,163,184,.35)", padding: "4px 8px", fontSize: 12, color: mode===m?"#0b1020":"#e5e7eb", background: mode===m?"#93c5fd":"rgba(15,23,42,.5)" }}>{label}</button>
          ))}
          <button type="button" onClick={() => setShowDebug(v=>!v)} style={{ cursor: "pointer", borderRadius: 6, border: "1px solid rgba(148,163,184,.35)", padding: "4px 8px", fontSize: 12, color: showDebug?"#052e16":"#e5e7eb", background: showDebug?"#86efac":"rgba(15,23,42,.5)" }}>Debug: {showDebug?"ON":"OFF"}</button>
        </div>
        <div style={{ opacity: 0.85, marginTop: 6, fontSize: 12 }}>
          Player: <strong>{modeLabel}</strong> · {npcDefs.length} AI cars avoid obstacles+each other · Jolt: <strong>{physics.status}</strong>{physics.error ? ` (${physics.error})` : ""}
        </div>
        {showDebug && <div style={{ opacity: 0.8, marginTop: 4, fontSize: 11 }}>Debug: dashed=waypoints, green curve=predicted heading/intent, green sphere=target, whiskers green/red=clear/hit</div>}
      </div>
      <Canvas shadows camera={{ position: [4, 3.5, 5], fov: 50 }}>
        <color attach="background" args={["#0b1020"]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[6, 10, 6]} intensity={1.5} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-far={60} shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={20} shadow-camera-bottom={-20} />
        <PhysicsStep api={physics.api} />

        <Car id="player" driver={playerDriver} remoteBridge={remote} obstacles={getObstaclesFor} reportPose={reportPose} followCamera initial={{ x: 0, z: 0, heading: Math.PI }} color="#2563eb" cabinColor="#60a5fa" />
        {npcDefs.map((d) => <Car key={d.id} id={d.id} driver={agents.npcs[d.id]} obstacles={getObstaclesFor} reportPose={reportPose} initial={d.initial} color={d.color} cabinColor={d.cabin} />)}
        <ObstacleMeshes obstacles={STATIC_OBSTACLES} />
        <DriveDebug drivers={debugDrivers} obstacles={STATIC_OBSTACLES} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[240, 240]} />
          <meshStandardMaterial color="#111827" roughness={1} metalness={0} />
        </mesh>
        <Grid args={[240, 240]} position={[0, 0.01, 0]} cellSize={0.5} cellThickness={0.5} sectionSize={2} sectionThickness={1} fadeDistance={50} fadeStrength={1} infiniteGrid />
        <Environment preset="city" />
        <OrbitControls makeDefault enableDamping />
      </Canvas>
    </>
  );
}
