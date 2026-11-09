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

// Tier-A AI: waypoint seeking + local whisker obstacle avoidance + stuck recovery (reverse).
export function createWaypointAgent({
  waypoints = [],
  loop = true,
  arrive = 1.6,
  id = "ai-waypoint",
  getObstacles = null,
} = {}) {
  let idx = 0;
  let lastX = null, lastZ = null, progressT = 0, stuckT = 0, recoverT = 0, recoverSteer = 1;
  const debug = { type: "ai-waypoint", id, idx: 0, target: null, whiskers: [], avoid: null, intent: null, recovering: false };

  return {
    id,
    kind: "ai",
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
        stuckT = 0; recoverT = 0; // new target, reset recovery
      }

      const targetAngle = Math.atan2(dx, dz);
      const err = normAngle(targetAngle - obs.heading);
      const seekSteer = Math.max(-1, Math.min(1, err * 1.5));
      const seekThrottle = dist < arrive * 1.2 ? 0.2 : 0.85 * Math.max(0.25, 1 - Math.abs(seekSteer) * 0.55);

      const obstacles = (typeof getObstacles === "function" ? getObstacles() : ctx?.obstacles) || [];
      const whiskers = senseWhiskers({ x: obs.x, z: obs.z, heading: obs.heading, obstacles, carRadius: 0.95 });
      const avoid = avoidanceFromWhiskers(whiskers);

      let steer = seekSteer;
      let throttle = seekThrottle;
      if (avoid.urgency > 0.08) {
        const w = Math.min(1, avoid.urgency * 1.35);
        steer = seekSteer * (1 - w) + avoid.steer * w;
        throttle = Math.min(throttle, seekThrottle * avoid.throttleScale);
        if (avoid.urgency > 0.9) throttle = Math.min(throttle, -0.2);
      }

      // Stuck detection: wants to move but making little progress / very slow while blocked
      const moved = lastX == null ? 1 : Math.hypot(obs.x - lastX, obs.z - lastZ);
      lastX = obs.x; lastZ = obs.z;
      if (moved > 0.003) progressT = 0; else progressT += dtObs;
      const wantsMove = Math.abs(seekThrottle) > 0.15 || Math.abs(throttle) > 0.15;
      const blocked = avoid.urgency > 0.35 || Math.abs(obs.speed) < 0.35;
      if (wantsMove && blocked && (progressT > 0.55 || Math.abs(obs.speed) < 0.12)) stuckT += dtObs;
      else stuckT = Math.max(0, stuckT - dtObs * 2);

      if (recoverT <= 0 && stuckT > 0.7) {
        recoverT = 0.95 + Math.random() * 0.55; // reverse maneuver duration
        // pick steer away from dominant whisker hit / avoidance bias
        recoverSteer = avoid.steer !== 0 ? Math.sign(avoid.steer) : (err >= 0 ? -1 : 1);
        stuckT = 0;
      }

      let recovering = false;
      if (recoverT > 0) {
        recoverT -= dtObs;
        recovering = true;
        throttle = -0.85; // reverse
        steer = recoverSteer * 0.95; // turn while reversing to get unstuck
        // if clear behind-ish? keep it simple; timed recovery
      }

      const intent = clampIntent({ throttle, steer, brake: 0 });
      Object.assign(debug, { idx, target: { x: tx, z: tz, dist: +dist.toFixed(2) }, waypoints, whiskers, avoid, seek: { steer: +seekSteer.toFixed(2), err: +err.toFixed(2) }, intent, obs: { x: obs.x, z: obs.z, heading: obs.heading, speed: obs.speed }, recovering, stuckT: +stuckT.toFixed(2) });
      return intent;
    },
    reset() { idx = 0; lastX = lastZ = null; progressT = stuckT = recoverT = 0; },
  };
}

// Browser side of the remote-agent WebSocket bridge.
export function createRemoteAgentBridge({ url } = {}) {
  let ws = null;
  let status = "disconnected";
  let lastIntent = clampIntent({ throttle: 0, steer: 0 });
  let listeners = new Set();
  const debug = { type: "remote", lastIntent };
  const notify = () => listeners.forEach((fn) => fn(status));
  const connect = () => {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(url || `${proto}//${location.host}/__ndoto_agent`);
    status = "connecting"; notify();
    ws.addEventListener("open", () => { status = "connected"; notify(); });
    ws.addEventListener("close", () => { status = "disconnected"; notify(); });
    ws.addEventListener("error", () => { status = "error"; notify(); });
    ws.addEventListener("message", (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "intent") { lastIntent = clampIntent(msg); debug.lastIntent = lastIntent; }
      } catch {}
    });
  };
  return {
    id: "remote-agent", kind: "remote", debug,
    connect, disconnect() { try { ws?.close(); } catch {} },
    sendObs(obs) { if (ws?.readyState === 1) ws.send(JSON.stringify(obs)); },
    getIntent() { return lastIntent; },
    getStatus() { return status; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { listeners.clear(); this.disconnect(); },
  };
}
