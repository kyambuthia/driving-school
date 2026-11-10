// App probe: drives the REAL running app in a real browser over the Chrome
// DevTools Protocol, and reports what the AI drivers actually do.
//
// The headless harnesses re-implement parts of the drive loop; this one
// exercises the shipped app end to end (React + R3F + fleet + Jolt + drivers).
//
// The app is copied to a scratch directory and served from there, so that
// edits to the working tree (and the HMR reloads they cause) cannot disturb
// the run. The software renderer is also far slower than real time, so the
// probe uses the dev-only window.__ndoto.advance() helper to step the
// simulation deterministically instead of waiting for frames.
//
// Run: node test/app-probe.mjs [simSeconds]
import { WebSocket } from "ws";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { cpSync, rmSync, existsSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
// The scratch copy lives outside the repo, and its node_modules is a symlink
// to the repo's -- a `pnpm install` inside it would rewrite the repo's own
// node_modules links and break the toolchain.
const SCRATCH = "/tmp/ndoto-probe-app";
const PORT = 5199;
const CDP_PORT = 9333;

const SIM_SECONDS = Number(process.argv[2] ?? 60);

// --- snapshot the app so the run is not disturbed by concurrent edits ---
rmSync(SCRATCH, { recursive: true, force: true });
cpSync(REPO, SCRATCH, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(REPO.length);
    return !rel.includes("node_modules") && !rel.includes("/.git") && !rel.includes("/dist") && !rel.includes("/.scratch");
  },
});
if (!existsSync(`${SCRATCH}/node_modules`)) {
  symlinkSync(`${REPO}/node_modules`, `${SCRATCH}/node_modules`);
}
// The dev server must not write into the shared node_modules.
writeFileSync(`${SCRATCH}/.npmrc`, "node-linker=hoisted\n");

const dev = spawn("pnpm", ["dev", "--host", "127.0.0.1", "--port", String(PORT)], {
  cwd: SCRATCH,
  stdio: ["ignore", "pipe", "pipe"],
});
let devLog = "";
dev.stdout.on("data", (d) => { devLog += d.toString(); });
dev.stderr.on("data", (d) => { devLog += d.toString(); });

const cleanup = () => {
  try { dev.kill("SIGTERM"); } catch {}
  try { chrome.kill("SIGTERM"); } catch {}
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

// wait for the dev server
let serverUp = false;
for (let i = 0; i < 80; i++) {
  await sleep(500);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/`);
    if (res.ok) { serverUp = true; break; }
  } catch {}
}
if (!serverUp) {
  console.log("dev server did not start:\n" + devLog.slice(-2000));
  cleanup();
  process.exit(1);
}

const chrome = spawn("google-chrome", [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--use-gl=swiftshader",
  "--enable-unsafe-swiftshader",
  "--window-size=320,240",
  `--remote-debugging-port=${CDP_PORT}`,
  "--user-data-dir=/tmp/ndoto-probe-profile",
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let stderr = "";
chrome.stderr.on("data", (d) => { stderr += d.toString(); });

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      const j = await res.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("chrome devtools did not come up:\n" + stderr.slice(-2000));
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 120000);
    });
  }
}

const wsUrl = await getWsUrl();
const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
const cdp = new CDP(ws);

const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

const evaluate = async (expr) => {
  const r = await cdp.send(
    "Runtime.evaluate",
    { expression: expr, returnByValue: true, awaitPromise: true },
    sessionId
  );
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
  return r.result.value;
};

await cdp.send("Page.enable", {}, sessionId);
await cdp.send("Runtime.enable", {}, sessionId);
await cdp.send("Log.enable", {}, sessionId);
const pageErrors = [];
cdp.ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.method === "Runtime.exceptionThrown") {
    pageErrors.push(msg.params?.exceptionDetails?.exception?.description || "exception");
  }
  if (msg.method === "Log.entryAdded" && msg.params?.entry?.level === "error") {
    pageErrors.push(msg.params.entry.text);
  }
});

await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` }, sessionId);

// Wait until the app is up *and* the cars have registered with the fleet.
// Without the second condition, advancing the simulation would silently do
// nothing (the fleet steps nothing when it holds no vehicles).
async function waitForApp() {
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    try {
      const ready = await evaluate(
        `!!(window.__ndoto && window.__ndoto.physics?.status === "ready" && window.__ndoto.fleet?.size > 0)`
      );
      if (ready) return true;
    } catch {}
  }
  return false;
}

if (!(await waitForApp())) {
  console.log("app never became ready");
  cleanup();
  process.exit(1);
}
console.log("app booted (physics ready, cars registered)");

// Per-car AI state straight from the live drivers.
const SNAPSHOT = `(() => {
  const n = window.__ndoto;
  if (!n || !n.agents) return null;
  const out = { mode: n.mode, cars: {} };
  for (const [id, ag] of Object.entries(n.agents.npcs)) {
    const d = ag.debug || {};
    out.cars[id] = {
      idx: d.idx ?? null,
      dist: d.target?.dist ?? null,
      stuckT: d.stuckT ?? 0,
      recovering: !!d.recovering,
      x: d.obs?.x ?? null,
      z: d.obs?.z ?? null,
      speed: d.obs?.speed ?? null,
    };
  }
  return out;
})()`;

const first = await evaluate(SNAPSHOT);
const startIdx = {};
for (const [id, c] of Object.entries(first.cars)) startIdx[id] = c.idx ?? 0;

// Advance the simulation in chunks, sampling as we go.
let maxStuck = 0;
let laps = {};
const CHUNK = 5;
let advanced = 0;
while (advanced < SIM_SECONDS) {
  const chunk = Math.min(CHUNK, SIM_SECONDS - advanced);
  const res = await evaluate(`window.__ndoto?.advance ? window.__ndoto.advance(${chunk}) : 0`);
  if (!res) {
    await waitForApp();
    continue;
  }
  advanced += chunk;
  const snap = await evaluate(SNAPSHOT);
  if (!snap) continue;
  for (const [id, c] of Object.entries(snap.cars)) {
    if (c.idx == null) continue;
    const prev = laps[id] ?? startIdx[id];
    if (c.idx !== prev) {
      if (c.idx < prev) laps[id] = (laps[id] ?? 0) + 1;
      laps[id] = c.idx;
    }
    maxStuck = Math.max(maxStuck, c.stuckT || 0);
  }
}

const final = await evaluate(SNAPSHOT);
const stats = await evaluate(`(() => { const s = window.__ndoto?.fleet?.stats; return s ? {frames: s.frames, simTime: s.simTime} : null; })()`);

console.log(`advanced ${SIM_SECONDS}s of simulated time in the real app (mode=${final.mode})`);
console.log(`  fleet frames=${stats?.frames} simTime=${stats?.simTime?.toFixed(1)}s\n`);

let movedCount = 0;
for (const [id, c] of Object.entries(final.cars)) {
  const moved = Math.hypot((c.x ?? 0) - (first.cars[id].x ?? 0), (c.z ?? 0) - (first.cars[id].z ?? 0));
  if (moved > 3) movedCount++;
  console.log(
    `  ${id}: idx=${c.idx} pos=(${c.x?.toFixed(1)},${c.z?.toFixed(1)}) speed=${c.speed?.toFixed(2)} ` +
    `dist=${c.dist?.toFixed(1)} stuckT=${c.stuckT?.toFixed(2)} recovering=${c.recovering} moved=${moved.toFixed(1)}`
  );
}
console.log(`\nworst stuckT=${maxStuck.toFixed(2)}`);
console.log(`cars that moved >3 units: ${movedCount}/${Object.keys(final.cars).length}`);
if (pageErrors.length) {
  console.log(`page errors (${pageErrors.length}):`);
  pageErrors.slice(0, 5).forEach((e) => console.log("  " + e));
} else {
  console.log("page errors: none");
}

const total = Object.keys(final.cars).length;
ws.close();
cleanup();
rmSync(SCRATCH, { recursive: true, force: true });
process.exit(movedCount === total && pageErrors.length === 0 ? 0 : 1);
