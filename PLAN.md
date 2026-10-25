# lunarPlan — Master Plan

A browser-native, realistic 3D Apollo Lunar Module landing simulator in the spirit of
[SpaceX ISS Docking Sim](https://iss-sim.spacex.com/), flown by the rules of the real
Apollo LM procedures, on real NASA Moon terrain, with a global leaderboard on SpacetimeDB.

> Status: **PLANNING — nothing gets built until this document is approved.**
> Values marked ⚠︎verify are from secondary memory and must be checked against the primary
> NASA source in Phase 0 before they go into code.

---

## 0. Build order (what you asked for)

| # | Phase | Output | Exit gate |
|---|-------|--------|-----------|
| 0 | Research & spec lock | `docs/spec/*.md` with every number sourced | You approve the spec |
| 1 | **Game that functions** (flight model + terrain + scoring) | Playable grey-box in the browser | Lands/crashes correctly against the spec tests |
| 2 | **UI with you** (HUD, menus, leaderboard screen) | Figma/HTML mockups → implemented UI | You sign off each screen |
| 3 | **Realism pass** (lighting, materials, dust, sound, LM model) | Visual/audio polish | Side-by-side vs Apollo 16mm footage |
| 4 | **Online** (SpacetimeDB identity, usernames, leaderboard, replays) | Live leaderboard | Server re-verifies a run |
| 5 | Ship | Deployed site | Load < 10 s on mid laptop |

SpacetimeDB is designed in from day 1 (determinism, run format) but wired up in Phase 4.

---

## 1. The game — what the player does

Like the ISS sim: one craft, one goal, honest physics, HUD numbers that must reach a
target window. Unlike a toy lander: you fly the actual Apollo descent sequence.

### 1.1 Mission flow (from Apollo procedures)

| Phase | Apollo program | Starts | Player role | Game mode availability |
|-------|----------------|--------|-------------|------------------------|
| Powered Descent Initiation | P63 Braking | ~15 km alt, ~1,690 m/s ⚠︎verify | Monitor, can manage throttle/attitude in "Commander" mode | Full Mission only |
| Approach | P64 | High Gate ~2,300 m ⚠︎verify (7,300 ft) | Redesignate landing point with LPD | Full Mission, Approach |
| Landing | P66 (Rate of Descent) / P67 (manual) | Low Gate ~150 m (500 ft) | Fly it: attitude via RHC, ROD switch ±1 ft/s per click | All modes |
| Touchdown | Contact light (1.7 m probes) → engine stop | — | Hit "ENGINE STOP" on contact light | All modes |

Game modes:
1. **Final Approach** (tutorial / quick): start at Low Gate, P66. 2–3 minutes.
2. **Approach** ★ **main leaderboard mode**: start at High Gate in P64, with LPD redesignation, ~5 min.
3. **Full Descent**: from PDI, ~12 minutes, real program alarms (1201/1202) possible.
4. **Free flight / training**: no scoring.

### 1.2 Vehicle model (LM, Apollo 11–14 class). Verified in Phase 0, details in [docs/spec/01-lm-vehicle.md](docs/spec/01-lm-vehicle.md)

| Item | Value |
|------|-------|
| Lunar gravity | 1.62 m/s² |
| LM mass at PDI | ≈ 15,000 kg (15,102 kg at docking, Apollo 11) |
| Descent propellant | 8,248 kg loaded on Apollo 11 (Aerozine 50 / N₂O₄) |
| DPS thrust | 46.71 kN rated. Operational max = FTP 92.5 % = 43.20 kN |
| DPS throttle | 10 %–65 % throttleable. 65–92.5 % is a non-operating region |
| DPS Isp | 305 s |
| Gimbal (trim) | ±6° |
| RCS | 16 × 445 N (100 lbf), secondary sources only |
| Contact probes | 1.73 m (68 in), 3 legs |
| Touchdown limits | 10-7-4 envelope: Vv ≤ 10 ft/s; Vh ≤ 4 ft/s up to Vv 7, then falling to 0 at Vv 10. Attitude ≈ 6°. Surface slope ≤ 12° |

Simulated: 6-DoF rigid body, mass decreasing with burn, CG shift, thrust lag, RCS pulse
mode, DPS gimbal trim, landing-radar dropouts over slopes, low-level fuel light
(~2 min remaining), "60/30 seconds" bingo calls, dust obscuration below ~30 m.

Primary sources to read in Phase 0:
- Apollo Operations Handbook, LM (LMA790-3-LM) — via ALSJ
- Apollo 11 Mission Report & Press Kit
- [Eyles: LGC astronaut interfaces during landing (Luminary 1D)](https://ibiblio.org/apollo/Documents/Eyles-LgcAstronautInterfacesDuringLandingLuminary1D_text.pdf)
- [R-695 Apollo Descent Guidance](https://www.nasa.gov/wp-content/uploads/static/history/alsj/ApolloDescentGuidnce.pdf)
- [MIT OCW — Lunar landing lecture](https://ocw.mit.edu/courses/sts-471j-engineering-apollo-the-moon-project-as-a-complex-system-spring-2007/0028108a6ba8ed1910de0b0940194f7f_4_2_lunr_landing.pdf)

### 1.3 Controls (ISS-sim style on-screen buttons + keyboard + gamepad)

| Control | LM equivalent | Keys (draft) |
|---------|---------------|--------------|
| Pitch / roll / yaw | Rotational Hand Controller | W/S, A/D, Q/E |
| Rate of descent | ROD switch (±1 ft/s per click) | R / F |
| Translation | Thrust/Translation Controller (RCS) | I/J/K/L |
| Throttle (P67 only) | TTCA throttle | Shift / Ctrl |
| Engine stop | ENGINE STOP button | Space |
| Abort | ABORT / ABORT STAGE | Backspace (confirm) |
| LPD redesignation | RHC clicks in P64 | Arrow keys |

### 1.4 Scoring (council #002, accepted 2026-10-24). Full rules in [docs/decisions/002-scoring-rules.md](docs/decisions/002-scoring-rules.md)

The weighted sum was rejected: weights become the meta, and retunes would break the boards. The proposal is tiers, then a single physical number:
- **NO-GO** (not ranked): outside the 10-7-4 envelope, attitude > 6°, slope > 12°, topple or hop, fuel out, Bingo, or more than 150 m from target.
- **GO**: survived, within 150 m.
- **EAGLE**: within 30 m, slope ≤ 6°, Vh ≤ 2 ft/s, attitude ≤ 3°, ≤ 3 ft/s at the contact light, and ENGINE STOP within 1 s of the contact light (probe mode).
- Rank by tier, then **seconds of hover margin** (fuel left ÷ 4.05 kg/s), then distance. Apollo 11 itself would rank as GO with about 45–50 s.

Leaderboards: per **seed** (daily/weekly site), per mode, and all-time.

---

## 2. The map — real Moon, seeded like Minecraft

You want two things that look opposed: "random every time like Minecraft" and "the actual
Moon so players can compete". We get both:

**The seed doesn't generate terrain. It picks a real place on the real Moon.**

```
seed (u64)  ──►  deterministic PRNG  ──►  landing site (lat, lon) from the real LOLA DEM
                                       ├─ target point inside a "flat & safe" region
                                       ├─ approach azimuth, sun elevation (5–20°, Apollo-like)
                                       └─ small-scale detail (rocks < 5 m) via seeded noise
```

**Decided: every site is at the lunar South Pole, in the Artemis landing regions.** Everyone flies the
same real environment. The seed picks a site, a target, an approach azimuth and the sun azimuth.
Because these are real 5 m/px LOLA DEMs, there is no fake terrain at landing scale. Sun elevation at
the pole is only about 0–3°, so the landings have extreme long shadows and permanently shadowed
craters. That makes the landing hard and fair. The spike showed shadow maps alone can't handle
this sun: they alias at 1–3° and miss ridge shadows several km long. So terrain self-shadowing
uses a precomputed horizon map (§3).
The scenario is the Apollo LM flown into an Artemis site; Artemis lander physics can be a later mode.

- **Large/medium terrain**: real NASA data.
  - Global: [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) LOLA displacement 64 ppd (~474 m/px) + LROC color.
  - Local high-res: [LOLA 5 m/px DEMs](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/) (south pole sites — Artemis!), and USGS LMMP 3–5 m DTMs for Apollo sites.
  - Optionally LROC NAC DTMs (~2 m) for curated sites.
- **Fine detail** (boulders, small craters < DEM resolution): seeded procedural, so it is
  identical for every player on the same seed.
- **Site pool**: offline pipeline builds a catalog of candidate sites (slope < 12° in a
  ~200 m patch, radar-visible approach), tiles them, and stores them on a CDN.
- **Fair competition**: everyone on "Daily Seed 2026-10-24" flies identical terrain, sun,
  and target. "Random" button = new seed for practice; also curated **Apollo 11 / 15 / 17 /
  Artemis III candidate** sites as fixed challenges.

Data pipeline (offline, Python + GDAL): DEM GeoTIFF → reproject to local tangent plane →
cut into quadtree height tiles (e.g. 257×257 float16 / quantized-mesh) + normal maps →
upload to CDN. The game streams tiles by LOD around the LM.

---

## 3. Tech stack

See §7 for the council history.

**Renderer: Babylon.js stays the baseline. P1-0d (2026-10-25): neither engine passed, so Babylon stays per the rule, and LM shadowing is escalated and re-gated (P1-0f). Three.js came much closer ([REPORT §12](spikes/engine/REPORT.md#12-p1-0d-result-2026-10-25)). Originally UNDECIDED until the two-engine gate
P1-0d ([spike REPORT §9](spikes/engine/REPORT.md#9-council-003-gate-amendment-and-pre-registered-gate-p1-0d-2026-10-24))
runs. Three.js is the candidate.** Either way, the renderer sits behind an adapter of about
100 lines that only reads WASM state, so the choice doesn't touch physics, terrain data or the server.

**Lighting architecture (adopted, engine-neutral, council #003):**
- **Terrain → terrain and terrain → LM:** a precomputed **horizon map** from the DEM. For each
  sample it stores the horizon elevation over N azimuths, built offline. At runtime the sun's
  elevation is compared with the interpolated horizon at the sun's azimuth. Terrain shadowing the
  LM is computed in WASM, so it is deterministic.
- **LM / rocks / dust → anything:** cascaded shadow maps, with terrain only receiving.
  The two shadow terms combine with `min()`.

```
┌──────────── Browser ─────────────┐        ┌──────── SpacetimeDB ────────┐
│ Renderer (adapter; Babylon base) │        │ module (Rust)               │
│ UI / HUD (TypeScript + Vite)     │◄──ws──►│ tables: player, run, score  │
│ Flight core (Rust → WASM) ───────┼─same──►│ flight core (Rust) replays  │
│ Terrain streamer ◄── CDN tiles   │  code  │ input log → verifies score  │
└──────────────────────────────────┘        └─────────────────────────────┘
```

Key rule: **the physics is a deterministic fixed-step (e.g. 120 Hz) simulation, separate from
rendering**. Same seed + same input log ⇒ bit-identical result on client and server.
That is what makes the leaderboard cheat-resistant.

---

## 4. SpacetimeDB design (Phase 4, designed now)

- **Identity**: SpacetimeDB issues each client an `Identity` + token automatically (anonymous
  play works instantly). Player then sets a username via reducer. Optional OIDC login later
  (SpacetimeAuth / Google / GitHub) to keep the same identity across devices.
- **Tables** (draft):
  - `player { identity PK, username unique, created_at, country? }`
  - `seed { id PK, kind: daily|weekly|curated|random, site_id, sun_el, sun_az, valid_from, valid_to }`
  - `run { id PK auto, identity, seed_id, mode, input_log bytes, client_score, status: pending|verified|rejected, submitted_at }`
  - `score { run_id PK, identity, seed_id, mode, score, fuel_left, dist_m, v_vert, v_horiz, verified_at }` — indexed by (seed_id, mode, score)
- **Reducers**: `set_username`, `submit_run(seed_id, mode, input_log)` → re-simulate in the
  module → write `score` only if it matches; `create_daily_seed` (scheduled reducer).
- **Client**: subscribes to top-N of the current seed → live leaderboard updates like a chat app.
- Input log ≈ 120 Hz × few channels, delta + RLE encoded → a few KB per run.

---

## 5. Repo layout (proposed)

```
lunarPlan/
  PLAN.md
  docs/spec/            # sourced numbers, procedures, scoring
  docs/decisions/       # council records (ADR per decision)
  crates/flight-core/   # Rust: deterministic LM sim (no_std-friendly)
  crates/flight-wasm/   # wasm-bindgen wrapper for the browser
  server/               # SpacetimeDB module (Rust), depends on flight-core
  web/                  # Vite + TS game & UI (renderer behind an adapter; engine per gate P1-0d)
  spikes/engine/        # engine spike + gate harness (Babylon vs Three), REPORT.md
  tools/terrain/        # Python/GDAL DEM → tile pipeline
  .claude/tasks.json    # agent-team task state
```

---

## 6. Council process (your rule: subagents debate before important changes)

Any change in these categories triggers a council **before** code is written:
game rules & scoring, physics constants, colors / visual style, HUD layout & shapes,
controls, engine/library choice, data schema, map/seed rules.

1. **Advocate** argues for the proposal (with sources).
2. **Skeptic** argues the strongest alternative / attacks it.
3. **Judge** weighs both against this plan's goals (realism > fairness > fun > speed).
4. Result is written to `docs/decisions/NNN-title.md` and **shown to you**; you have final say.
5. Implementation then follows the agent-team rules: tasks in `.claude/tasks.json`, file locks
   in `.claude/locks/`, teammate-scout must "pass" schemas, lead reviews diffs + runs tests
   before merge.

Small things (bug fixes, refactors, tuning inside an approved range) skip the council.

---

## 7. Council #001 — Engine choice

**Agreed by all three:** the flight dynamics live in a deterministic **Rust core → WASM**, reused
unchanged in the **SpacetimeDB Rust module** for server replay. We build our own DEM tile pipeline,
and the renderer and the physics read the same height tiles. Unity, Godot, Bevy and CesiumJS are
rejected: duplicated physics, 10–40 MB runtimes, unstable APIs, or no close-range LM view.

| | Advocate A: Three.js WebGPU (7/10) | Advocate B: Babylon.js 8 WebGPU (6/10) |
|---|---|---|
| Low-sun long shadows | CSMShadowNode addon, do-it-yourself | Built-in cascaded + PCSS shadows, stabilized |
| Planet-scale precision | Hand-made camera-relative rendering | `useLargeWorldRendering` (64-bit CPU matrices) |
| API stability | WebGPU/TSL changes between releases | Backwards-compatibility policy |
| Bundle | ~170 KB gz | ~1–2 MB (DEM tiles dominate anyway) |
| Ecosystem | Largest, incl. NASA-AMMOS 3DTilesRendererJS | Smaller; ships inspector, GUI, audio, Node Material editor |

**Judge's verdict: Babylon.js 8+ on WebGPU, confidence 6.5/10, with conditions.**
1. Write the terrain as a hand-written WGSL ShaderMaterial. Keep the camera unparented, and avoid Node Render Graph, which is still alpha. These steer around known floating-origin bugs.
2. Run the LM in its own origin-centred local frame regardless of the engine.
3. Use tree-shaken `@babylonjs/core` imports and enforce a bundle-size budget in CI.
4. Keep the tile format independent of the engine so that switching stays cheap.

**Spike (2 days, Phase 1 week 1):** Build both engines side by side. Load a 2×2 km LOLA tile placed
100 km from the origin, with the sun at 10°. Put the camera first 1 m off a footpad, then at 15 km.
Measure vertex/shadow jitter (must be 0 px), shadow acne, cascade seams, frame time in Chrome and
Safari, and the amount of code each needs.
**What reverses the verdict:** Babylon's large-world mode breaks custom WGSL terrain or shadows, or
Three.js matches the quality with ≤ 1.3× the code. Either result switches the pick to Three.js.

**What happened next (2026-10-24, full detail in [spikes/engine/REPORT.md](spikes/engine/REPORT.md)):**
1. **Spike:** both engines are jitter-free at 100 km, and neither shimmers, even at 1,000 km.
2. **Re-vote (council #001b):** with a fair setup, Three met the reversal condition: better
   contact shadows and 0.92× the code. The user approved a switch, conditional on a gate.
3. **Gate P1-0c (Three):** contact shadows ✅, CSM range ✅. Acne ❌ in 3 views at 1–3° sun, caused by
   shadow-map projective aliasing. That limit isn't Three-specific.
4. **Council #003:** the horizon map is adopted for terrain shadows. The engine choice goes to a
   **pre-registered two-engine gate P1-0d** with equal tuning, which also adds LM self-acne and
   rock acne at 1–3°. If neither engine passes, Babylon stays and LM shadowing gets escalated.

Other stack choices: TypeScript + Vite for UI and HUD, Python + GDAL for the terrain pipeline,
Rust for the core and server, fixed 120 Hz sim step. Floating-point rules: scalar f64 only, no
relaxed-SIMD, software `libm`, and any NaN means the run fails.

Known risks: replay verification proves the physics, not the human (a perfect-input bot still
passes), so we add plausibility heuristics later. SpacetimeDB reducer time limits need a benchmark
for replaying a 12-minute Full Descent, which is about 86k steps.

---

## 8. Open questions for you

Answered (2026-10-24):
- Main leaderboard mode: **Approach** (P64 from High Gate).
- Map: **lunar South Pole, Artemis regions**, using LOLA 5 m/px DEMs (87–90°S mosaic + site DEMs).
- Identity: **anonymous SpacetimeDB identity + username**, with OAuth later.
- Views: **all three**. Commander window (LPD grid on glass), chase cam, and an instrument panel (DSKY, FDAI, cross-pointer, tapes).

Still open (next round, each one goes through the council):
- Scoring weights (§1.4)
- HUD visual style: ISS-sim minimal vs. Apollo panel skeuomorphic (Phase 2, with you)
- Sound: real Apollo 11 loop audio (public domain) as ambience?
- Daily-seed rollover time zone (UTC?)
