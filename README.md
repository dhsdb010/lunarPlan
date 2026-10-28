# lunarPlan

A realistic 3D Apollo Lunar Module landing sim that runs in the browser. You fly the final approach (P66, from 500 ft) onto real LOLA terrain at the lunar South Pole (Shackleton rim, an Artemis region). The rules come from NASA's LM procedures, the controls copy the SpaceX ISS docking sim, and there's a daily seeded leaderboard on SpacetimeDB. A verifier re-flies every ranked run from its input log.

> **Status: PAUSED (2026-10-28) for a redesign.** Everything works but is switched off. See "Coming back" below.

## Where things stand

| Piece | Where | State now |
|---|---|---|
| Game site | Cloudflare Workers static assets, project `lunarplan` (was https://lunarplan.dhsdb010.workers.dev) | **offline** (`"workers_dev": false` in `web/wrangler.jsonc`, so the URL returns 404) |
| Assets (LM model, DEM tile, WASM, Depth Anything model) | R2 bucket `lunarplan-assets` | up (free tier) |
| Leaderboard DB | SpacetimeDB Maincloud, database `lunarplan-dhsdb010` | up (free tier) |
| Verifier worker | Fly.io app `lunarplan-verifier`, machine `28744305c02e08` | **stopped** (no cost) |

Built and working:
- **Flight core:** deterministic 120 Hz flight core in Rust compiled to WASM. Physics numbers are checked against NASA sources in `docs/spec/`.
- **Scoring:** NO-GO / GO / EAGLE tiers, ranked by hover-fuel margin (decision 002).
- **Controls and views:** RHC rotation, TTCA translation, ROD switch, ENGINE STOP. Four views: orbit, chase, commander's window, overhead.
- **Instruments:** cross-pointer with an RCS arrow, attitude ball, altitude and descent-rate tapes, site map, strip chart, fuel gauge. Plus RCS plumes, the green landing ring and guide dots.
- **Nadir depth panel (N key):** a downward camera next to a Depth Anything V2 (small) depth map, run in a Web Worker with transformers.js.
- **Online:** leaderboard, plus server-side replay verification.

## Coming back (turn it all on again)

1. Site: in `web/wrangler.jsonc`, set `"workers_dev": true` (or delete the line), then run:
   ```bash
   cd web && npm run deploy
   ```
   `npm run deploy` rebuilds first. That matters, because wrangler deploys the copy of the config the build makes in `dist/`.
2. Verifier:
   ```bash
   fly machine start 28744305c02e08 -a lunarplan-verifier
   ```
3. Local dev:
   ```bash
   cd web && npm install && npx vite --port 5180
   ```
   Then open `http://localhost:5180/?debug=1`. Add `&depth=1` to open the depth panel, or `&autopilot=1` for a hands-off landing.

More commands are in [docs/DEPLOY.md](docs/DEPLOY.md): module publish, WASM rebuild, R2 upload, rotating the verifier token.

## Open items to pick up

- **Redesign:** the reason for the pause. Per the project rule, run the advocate / skeptic / judge council before changes to color, shape or game rules.
- **Depth panel quality:** Depth Anything V2 is weak on a top-down, low-contrast lunar view. It tends to produce a radial "bowl" instead of following the terrain. Options:
  - Add a ground-truth depth window from the render's z-buffer to compare against.
  - Feed the model an oblique view instead of straight down.
- **Depth panel on the live site:** never confirmed working. The model files are mirrored on R2 (`hf/onnx-community/depth-anything-v2-small/...`), and the ONNX runtime wasm comes from jsdelivr because it's over Cloudflare's 25 MiB file limit.
- **Test leaderboard entries:** AUTOPILOT, TEST-PILOT, V2-TEST and FLY-CHECK are still on the board. Clear them before a real launch.
- **Approach mode:** P64 from High Gate isn't built. Only Final Approach exists.
- **Rendering backlog:** P1-0f lander-shadow escalation, P1-0e Safari test, P1-1 glTF prep, and wiring the horizon map (`crates/horizon`) into rendering.

## Repo map

| Path | What |
|---|---|
| `PLAN.md` | master plan and phases |
| `docs/spec/` | NASA-sourced numbers (LM vehicle, descent profile, 3D asset) |
| `docs/decisions/` | council decisions (engine, scoring, terrain shadows) |
| `docs/DEPLOY.md` | deploy runbook |
| `docs/media/` | test landing video and snapshots |
| `crates/flight-core/` | deterministic flight model (Rust to WASM) |
| `crates/horizon/` | horizon-map terrain shadowing prototype |
| `web/` | the game (Vite + Babylon.js 9) |
| `server/spacetimedb/` | leaderboard module (TypeScript) |
| `verifier/` | Fly.io replay verifier (Node 22) |
| `spikes/engine/` | engine-choice gate harness and report |
| `tools/` | data-prep scripts |
