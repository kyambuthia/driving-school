import { clampIntent } from "./sim";
import { senseWhiskers, avoidanceFromWhiskers } from "./avoidance";

export function createKeyboardController(target = window) {
  const keys = {};
  const down = (e) => {
    keys[e.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  };
  const up = (e) => { keys[e.code] = false; };
  target.addEventListener("keydown", down, { passive: false });
  target.addEventListener("keyup", up);
  return {
    id: "human-keyboard",
    kind: "human",
    debug: { type: "human" },
    getIntent() {
      const throttle = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
      const steer = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
      const brake = keys.Space ? 1 : 0;
      return clampIntent({ throttle, steer, brake });
    },
    dispose() {
      target.removeEventListener("keydown", down);
      target.removeEventListener("keyup", up);
    },
  };
}

function normAngle(err) {
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;
  return err;
}

// Tier-A AI: waypoint seeking (with path lookahead) + predictive obstacle avoidance
// (including moving cars) + speed planning + stuck recovery (reverse).
export function createWaypointAgent({
  waypoints = [],
  loop = true,
  arrive = 1.6,
  id = ai-waypoint,
  getObstacles = null,
} = {}) {
  let idx = 0;
  let lastX = null, lastZ = null, progressT = 0, stuckT = 0, recoverT = 0, recoverSteer = 1;
  const debug = { type: ai-waypoint, id, idx: 0, target: null, aim: null, whiskers: [], avoid: null, intent: null, recovering: false };

  function lookaheadPoint(ox, oz, fromIdx) {
    // Aim at a point ~L units ahead along the waypoint polyline for smoother tracking.
    const L = 4.5;
    let i = fromIdx, rem = L, ax = ox, az = oz, guard = 0;
    while (rem > 0 && guard++ < 20) {
      const [wx, wz] = waypoints[i];
      const dx = wx - ax, dz = wz - az, d = Math.hypot(dx, dz) || 1e-6;
      if (d >= rem) return { x: ax + (dx / d) * rem, z: az + (dz / d) * rem, idx: i };
      rem -= d; ax = wx; az = wz;
      const ni = loop ? (i + 1) % waypoints.length : Math.min(i + 1, waypoints.length - 1);
      if (ni === i) return { x: wx, z: wz, idx: i };
      i = ni;
    }
    const [wx, wz] = waypoints[i];
    return { x: wx, z: wz, idx: i };
  }

  return {
    id,
    kind: ai,
    debug,
    getIntent(obs, ctx) {
      const dtObs = Math.min(ctx?.dt || 1 / 60, 0.05);
      if (!waypoints.length) {
        debug.intent = { throttle: 0, steer: 0 };
        return clampIntent(debug.intent);
      }
      let [tx, tz] = waypoints[idx];
      let dx = tx - obs.x, dz = tz - obs.z;
      let dist = Math.hypot(dx, dz);
      if (dist < arrive) {
        idx = loop ? (idx + 1) % waypoints.length : Math.min(idx + 1, waypoints.length - 1);
        [tx, tz] = waypoints[idx]; dx = tx - obs.x; dz = tz - obs.z; dist = Math.hypot(dx, dz);
        stuckT = 0; recoverT = 0;
      }

      // Path lookahead target for smoother, anticipatory steering
      const aim = lookaheadPoint(obs.x, obs.z, idx);
      const ax = aim.x - obs.x, az = aim.z - obs.z;
      const targetAngle = Math.atan2(ax, az);
      const err = normAngle(targetAngle - obs.heading);
      const seekSteer = Math.max(-1, Math.min(1, err * 1.45));

      const obstacles = (typeof getObstacles === function ? getObstacles() : ctx?.obstacles) || [];
      const whiskers = senseWhiskers({ x: obs.x, z: obs.z, heading: obs.heading, speed: obs.speed || 0, obstacles, carRadius: 0.95 });
      const avoid = avoidanceFromWhiskers(whiskers);

      // Speed planning: slow for curvature + limited clearance + proximity to waypoint, accelerate when clear
      const curvatureSlow = Math.max(0.3, 1 - Math.abs(seekSteer) * 0.5);
      const clearanceSlow = avoid.clearAhead ? 1 : Math.max(0.2, 0.45 + (1 - avoid.urgency) * 0.55);
      const approachSlow = dist < arrive * 2 ? 0.35 : dist < arrive * 4 ? 0.6 : 1;
      let seekThrottle = 0.9 * curvatureSlow * clearanceSlow * approachSlow;
      if (dist < arrive * 1.2) seekThrottle = Math.min(seekThrottle, 0.25);

      let steer = seekSteer;
      let throttle = seekThrottle;
      if (avoid.urgency > 0.06) {
        const w = Math.min(1, avoid.urgency * 1.25);
        steer = seekSteer * (1 - w) + avoid.steer * w;
        throttle = Math.min(throttle, seekThrottle * avoid.throttleScale);
        if (avoid.urgency > 0.9 && avoid.minClearance < 1.2) throttle = Math.min(throttle, -0.2);
      }

      // Stuck detection & recovery
      const moved = lastX == null ? 1 : Math.hypot(obs.x - lastX, obs.z - lastZ);
      lastX = obs.x; lastZ = obs.z;
      if (moved > 0.003) progressT = 0; else progressT += dtObs;
      const wantsMove = Math.abs(seekThrottle) > 0.15 || Math.abs(throttle) > 0.15;
      const blocked = avoid.urgency > 0.35 || Math.abs(obs.speed) < 0.35;
      if (wantsMove && blocked && (progressT > 0.55 || Math.abs(obs.speed) < 0.12)) stuckT += dtObs;
      else stuckT = Math.max(0, stuckT - dtObs * 2);

      if (recoverT <= 0 && stuckT > 0.7) {
        recoverT = 0.95 + Math.random() * 0.55;
        recoverSteer = avoid.steer !== 0 ? Math.sign(avoid.steer) : (err >= 0 ? -1 : 1);
        stuckT = 0;
      }

      let recovering = false;
      if (recoverT > 0) {
        recoverT -= dtObs;
        recovering = true;
        throttle = -0.85;
        steer = recoverSteer * 0.95;
      }

      const intent = clampIntent({ throttle, steer, brake: 0 });
      Object.assign(debug, { idx, target: { x: tx, z: tz, dist: +dist.toFixed(2) }, aim, waypoints, whiskers, avoid, seek: { steer: +seekSteer.toFixed(2), err: +err.toFixed(2) }, intent, obs: { x: obs.x, z: obs.z, heading: obs.heading, speed: obs.speed }, recovering, stuckT: +stuckT.toFixed(2) });
      return intent;
    },
    reset() { idx = 0; lastX = lastZ = null; progressT = stuckT = recoverT = 0; },
  };
}

// Browser side of the remote-agent WebSocket bridge.
// Supports direct intents and high-level goals (goal -> local seek+avoidance controller).
export function createRemoteAgentBridge({ url } = {}) {
  let ws = null;
  let status = "disconnected";
  let controlMode = "intent"; // "intent" | "goal"
  let lastIntent = clampIntent({ throttle: 0, steer: 0 });
  let goal = null; // {x,z,arrive}
  let listeners = new Set();
  const debug = { type: "remote", controlMode, lastIntent, goal: null, intent: lastIntent, whiskers: [], avoid: null, target: null };

  const notify = () => listeners.forEach((fn) => fn(status));
  const send = (obj) => { if (ws?.readyState === 1) ws.send(JSON.stringify(obj)); };

  const connect = () => {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(url || `${proto}//${location.host}/__ndoto_agent`);
    status = "connecting"; notify();
    ws.addEventListener("open", () => { status = "connected"; notify(); send({ type: "hello", from: "browser" }); });
    ws.addEventListener("close", () => { status = "disconnected"; notify(); });
    ws.addEventListener("error", () => { status = "error"; notify(); });
    ws.addEventListener("message", (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "intent") {
          controlMode = "intent";
          lastIntent = clampIntent(msg);
          debug.controlMode = controlMode; debug.lastIntent = lastIntent;
        } else if (msg.type === "goal") {
          if (msg.stop || (msg.x == null && msg.z == null)) goal = null;
          else goal = { x: Number(msg.x) || 0, z: Number(msg.z) || 0, arrive: Math.max(0.5, Number(msg.arrive) || 1.8) };
          controlMode = "goal";
          debug.controlMode = controlMode; debug.goal = goal; debug.target = goal ? { x: goal.x, z: goal.z } : null;
        } else if (msg.type === "mode") {
          if (msg.mode === "intent" || msg.mode === "goal") { controlMode = msg.mode; debug.controlMode = controlMode; }
        }
      } catch {}
    });
  };

  function goalIntent(obs, ctx) {
    if (!goal) {
      const intent = clampIntent({ throttle: 0, steer: 0, brake: 1 });
      Object.assign(debug, { intent, whiskers: [], avoid: null, target: null, obs: { x: obs.x, z: obs.z, heading: obs.heading, speed: obs.speed } });
      return intent;
    }
    const dx = goal.x - obs.x, dz = goal.z - obs.z;
    const dist = Math.hypot(dx, dz);
    if (dist < goal.arrive) {
      const intent = clampIntent({ throttle: 0, steer: 0, brake: 1 });
      send({ type: "goal_reached", goal, x: obs.x, z: obs.z });
      Object.assign(debug, { intent, whiskers: [], avoid: null, target: { x: goal.x, z: goal.z, dist: +dist.toFixed(2), reached: true }, obs: { x: obs.x, z: obs.z, heading: obs.heading, speed: obs.speed } });
      return intent;
    }
    const targetAngle = Math.atan2(dx, dz);
    const err = normAngle(targetAngle - obs.heading);
    const seekSteer = Math.max(-1, Math.min(1, err * 1.5));
    const obstacles = (ctx && Array.isArray(ctx.obstacles)) ? ctx.obstacles : [];
    const whiskers = senseWhiskers({ x: obs.x, z: obs.z, heading: obs.heading, speed: obs.speed || 0, obstacles, carRadius: 0.95 });
    const avoid = avoidanceFromWhiskers(whiskers);
    const curvatureSlow = Math.max(0.3, 1 - Math.abs(seekSteer) * 0.5);
    const clearanceSlow = avoid.clearAhead ? 1 : Math.max(0.2, 0.45 + (1 - avoid.urgency) * 0.55);
    let seekThrottle = dist < goal.arrive * 2 ? 0.25 : 0.9 * curvatureSlow * clearanceSlow;
    let steer = seekSteer, throttle = seekThrottle;
    if (avoid.urgency > 0.06) {
      const w = Math.min(1, avoid.urgency * 1.25);
      steer = seekSteer * (1 - w) + avoid.steer * w;
      throttle = Math.min(throttle, seekThrottle * avoid.throttleScale);
      if (avoid.urgency > 0.9 && avoid.minClearance < 1.2) throttle = Math.min(throttle, -0.2);
    }
    if (Math.abs(obs.speed) < 0.1 && avoid.urgency > 0.4 && dist > goal.arrive) {
      throttle = -0.7; steer = avoid.steer !== 0 ? avoid.steer : (err >= 0 ? -1 : 1);
    }
    const intent = clampIntent({ throttle, steer, brake: 0 });
    Object.assign(debug, { intent, whiskers, avoid, target: { x: goal.x, z: goal.z, dist: +dist.toFixed(2) }, aim: { x: goal.x, z: goal.z }, obs: { x: obs.x, z: obs.z, heading: obs.heading, speed: obs.speed }, seek: { steer: +seekSteer.toFixed(2), err: +err.toFixed(2) } });
    return intent;
  }

  return {
    id: "remote-agent", kind: "remote", debug,
    connect, disconnect() { try { ws?.close(); } catch {} },
    sendObs(obs) { send(obs); },
    getIntent(obs, ctx) {
      if (controlMode === "goal") return goalIntent(obs || {}, ctx || {});
      debug.intent = lastIntent; debug.whiskers = []; debug.avoid = null; debug.target = null;
      return lastIntent;
    },
    getStatus() { return status; },
    getMode() { return controlMode; },
    getGoal() { return goal; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { listeners.clear(); this.disconnect(); },
  };
}
