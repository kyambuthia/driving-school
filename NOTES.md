# driving-school — working notes

Machine layout:
- **ukandi** (Debian 13, has the browser/GPU) = where the app actually runs.
  - Repo: `/home/mbuthi/Projects/driving-school`, branch `trunk`, origin = GitHub.
  - `pnpm dev` → **http://127.0.0.1:5174/** (5173 is taken by the older `ndoto` vite).
- **rainbo** (this box, text terminal) = where editing happens.

## How we work

1. **Edit** through the SSHFS mount: `/home/blue/Projects/driving-school` → ukandi's repo.
   Writes land on ukandi instantly and Vite HMR picks them up in the browser.
2. **Verify** with `ds-shot` — renders the page headlessly on ukandi (swiftshader),
   copies the PNG back to `/tmp/opencode/`. I can read the image; you can watch the
   real browser on ukandi.
3. **Commit** from either side; GitHub `origin` is the shared source of truth.

### Useful commands
```bash
ds-shot                      # screenshot the running app -> /tmp/opencode/ds.png
ds-shot --list               # which dev ports are live
ssh ukandi 'cd ~/Projects/driving-school && pnpm lint'
ssh ukandi 'cd ~/Projects/driving-school && git status'
```

### Gotchas
- `grim`/GNOME screenshot on ukandi is blocked (no wlr-screencopy, D-Bus AccessDenied).
  Headless Chrome is the way in.
- Two vite servers were running; the old one on 5173 (pid 321978) is stale — it serves
  a dead `ndoto` project. The live driving-school one is 5174.
- The `ukandi` helper script injects input into the GUI session (ydotool/xdotool),
  useful for driving the browser on ukandi when a click is needed.

## Project notes

Vite + React 19 + React Three Fiber + drei + Jolt Physics (wasm-compat).

Architecture: a shared `DriveIntent` (`{throttle, steer, brake}` in [-1..1]) decouples
*who decides* from *how the car moves*. Three drivers implement `getIntent(obs, ctx)`:
- human — WASD/arrows, Space = brake (`createKeyboardController`)
- waypoint AI — seek + whisker avoidance + A* replan + stuck recovery (`createWaypointAgent`)
- remote agent — WebSocket bridge, accepts either raw intents or high-level goals
  (`createRemoteAgentBridge`, dev bridge lives in `vite.config.js` at `/__ndoto_agent`)

Vehicles are still kinematic (`stepVehicle` in `src/drive/sim.js`): position is
integrated in 2D and collisions are resolved by pushing the car out of the obstacle
(`resolveCollisions`). Jolt currently only owns *static* colliders (ground + obstacle
cylinders) — the car-body helpers in `src/physics/joltWorld.js` exist but are unused.

### Open work (from README "Status")
- Full Jolt **dynamic car bodies** with rigid-body collision response.
- Predictive car-car avoidance (partially there via whisker prediction).
- Goal-based high-level agent commands (partially there via `goal` WS message).
- Smarter planning/control.
