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

Vehicles are **real Jolt rigid bodies**: dynamic box bodies locked to the XZ plane
(`TranslationX|TranslationZ|RotationY`) — they drive on the ground without tipping or
sinking, and collide with obstacles and with each other for real.

Note that Jolt's `EAllowedDOFs_Plane2D` is the **Z-up** plane and is wrong for this
Y-up world, so the mask is built explicitly. `Quat.sRotation` lives on the *prototype*
in the embind bindings, not on the class.

The drive law lives in `src/drive/vehicleModel.js` so the app and the headless tests
always agree on it. `src/drive/fleet.js` owns the per-frame order — every car applies
its forces, then the world is stepped, then every car reads its transform back.
Spreading that over separate `useFrame` callbacks would make the order depend on
component mount order, which is fragile.

### Gotchas found the hard way

- **Jolt's angular damping fights a yaw-rate controller.** With `angularDamping: 0.4` the
  steady-state yaw rate was 3.9% low (wider turns than the old model). Set it to 0 and
  let the controller's own error term provide the damping: the yaw rate then matches to
  0.1%.
- **`Runtime.evaluate` starves under swiftshader.** The headless browser renders at
  ~0.2 fps, so wall-clock waiting is useless; the app probe steps the simulation
  deterministically instead (see `window.__ndoto.advance`).
- **`fleet.step()` no-ops when it holds no vehicles.** After a page reload the cars
  re-register a moment later, so a test that advances the simulation must wait for
  `fleet.size > 0` first.
- The `node_modules` symlinks are fragile: a `pnpm install` inside a scratch copy of the
  repo can repoint the repo's own links. Check `node -e "require.resolve('ws')"` if
  something suddenly cannot find a package.
- `controllers.js` called `astar()` without importing it — a latent bug that only
  threw when a car got stuck and needed to replan.

### Open work (from README "Status")
- Predictive car-car avoidance (partially there via whisker prediction).
- Goal-based high-level agent commands (partially there via `goal` WS message).
- Smarter planning/control.

## Tests

```bash
pnpm test        # fidelity + physics, headless
pnpm test:app    # the real app in a real browser, over the DevTools Protocol
```

- `test/fidelity.mjs` — rigid body vs the old kinematic model, same scripted inputs.
- `test/physics.mjs` — accelerating, braking, coasting, steering, reversing, colliding.
- `test/app-probe.mjs` — drives the shipped app end to end in Chrome.
