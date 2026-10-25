# Deploy runbook (2026-10-25)

| Piece | Where | Status |
|---|---|---|
| Game (static) | Cloudflare Pages (served on Workers static assets): **https://lunarplan.dhsdb010.workers.dev** | live |
| Game assets (LM glb, DEM tile, WASM) | **R2** bucket `lunarplan-assets`, public at https://pub-19155aba39634845bfc943d38ed09633.r2.dev (CORS GET *) | live |
| Database / leaderboard | SpacetimeDB Maincloud, database `lunarplan-dhsdb010` (https://spacetimedb.com/lunarplan-dhsdb010) | live |
| Verifier worker | Fly.io app `lunarplan-verifier` (nrt, shared-cpu-1x, 256 MB, no public ports) | live (card added 2026-10-25). End-to-end check: `cd verifier && npx esbuild test/submit.test.ts --bundle --platform=node --format=esm --outfile=dist/submit.test.mjs && node dist/submit.test.mjs` |

## Input log format (v2, 2026-10-25)
4-byte entries: u16 LE steps-since-last-change, then u16 LE control bits (RHC pitch/roll/yaw, TTCA translation, ROD ±, ENGINE STOP). Runs are submitted as mode `final-approach-v2`. `verifier/test/replay.test.ts` checks that record → replay is bit-identical.

## How the pieces fit
1. The browser runs `crates/flight-core` (WASM) at a fixed 120 Hz step and records the input log.
2. On a ranked landing it calls `submitRun(seed, inputLog, claimedTier, claimedMargin)` on Maincloud.
3. The verifier subscribes to `run WHERE status='pending'`, replays the log with the **same WASM**, and calls `verifyRun`. Only the publisher identity may call it; the worker runs with that token.
4. The verified row lands in `score`, and every client's leaderboard updates live.

## Commands

Module (SpacetimeDB Maincloud):
```bash
cd server && spacetime publish lunarplan-dhsdb010 --yes
```
```bash
spacetime generate --lang typescript --out-dir web/src/module_bindings --module-path server/spacetimedb
```

Flight core (rebuild the WASM, then copy it to `web/public/wasm` and `verifier/assets`):
```bash
cargo build --release --target wasm32-unknown-unknown --lib --manifest-path crates/flight-core/Cargo.toml
```

Game (Cloudflare). The project lives on Workers static assets, so use `wrangler deploy`; `web/wrangler.jsonc` points it at `dist`:
```bash
cd web && npx vite build && npx wrangler deploy
```

Verifier (Fly.io):
```bash
cd verifier && npm run build && fly deploy --remote-only --ha=false
```
```bash
fly logs -a lunarplan-verifier
```

## Assets on R2
`web/.env.production` sets `VITE_ASSET_BASE` to the bucket's public URL. `npm run build` leaves the assets out of `dist`.
```bash
cd web && npm run assets
```
That re-uploads the LM model, DEM tile and WASM after changing them. Then redeploy the site:
```bash
cd web && npm run deploy
```

## Rotating the verifier token
The verifier uses the publisher's SpacetimeDB token (Fly secret `SPACETIME_TOKEN`). If it leaks, log in again (`spacetime login`) and run:
```bash
fly secrets set SPACETIME_TOKEN=<new token> -a lunarplan-verifier
```
