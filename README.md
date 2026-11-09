# driving-school

A small procedural vehicle sandbox built with **Vite + React + React Three Fiber + drei**. It simulates simple cars (chassis + wheels) that can be driven by **humans**, **in-browser AI agents**, or **remote agents** over WebSocket, with waypoint seeking, obstacle avoidance, stuck recovery, debug intent visualization, and Jolt physics colliders.

## Features

- **Procedural vehicles**: box chassis/cabin + 4 cylinder wheels (wheels + chassis), rendered in R3F.
- **Shared control API (`DriveIntent`)**: `{ throttle, steer, brake }` in `[-1..1]` — decouples *who decides* from *how the car moves*.
  - `src/drive/sim.js` — vehicle state + `stepVehicle` + collision resolution.
  - `src/drive/controllers.js` — keyboard (human), waypoint AI (Tier-A), remote-agent bridge.
  - `src/drive/avoidance.js` — whisker sensing + avoidance steering.
- **Human + AI + remote drivers**:
  - **Human**: WASD / Arrow keys (Space = brake).
  - **AI (waypoint)**: seeks looping `[x,z]` waypoints, avoids static obstacles and other cars (slows/yields), reverses to recover when stuck.
  - **Remote agent (WebSocket)**: browser connects to `ws://<host>/__ndoto_agent` (dev bridge in `vite.config.js`) and accepts intents / publishes observations.
- **Debug view** (toggle): waypoint paths, current target, **curved predicted heading/intent arc**, and whiskers (green clear / red hit).
- **Physics**: geometric collision resolution for car↔obstacle/car↔car; **Jolt Physics** (`jolt-physics`, WASM compat) initialized with static colliders for ground + obstacles.

## Run

```bash
pnpm install
pnpm dev
```

Open the local Vite URL (e.g. `http://127.0.0.1:5173/`).

## Remote agent protocol (dev)

When the player car is in **Remote agent (WS)** mode, the browser bridges to `ws://<host>/__ndoto_agent`.

Send an intent:
```json
{"type":"intent","throttle":1,"steer":0.2,"brake":0}
```

Receive observations (~20Hz while in remote mode):
```json
{"type":"obs","id":"player","x":0.0,"z":-1.0,"heading":3.14,"speed":1.2,"steer":0.1}
```

## Project layout

- `src/Car.jsx` — procedural vehicle + wheel visuals + sim/collision step.
- `src/App.jsx` — scene, multiple cars (player + AI fleet), obstacles, HUD/mode switch.
- `src/drive/*` — simulation, controllers, avoidance.
- `src/debug/DriveDebug.jsx` — intent/waypoint/whisker visualization.
- `src/physics/joltWorld.js` — Jolt init + static colliders/stepping.
- `vite.config.js` — React + dev WebSocket agent bridge.

## Status

Experimental sandbox/prototype. Next steps include full Jolt dynamic car bodies & rigid-body collision response, predictive car-car avoidance, goal-based high-level agent commands, and smarter planning/control.
