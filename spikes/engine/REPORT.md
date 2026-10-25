# Engine spike report: Babylon.js vs Three.js (tasks P1-0, P1-0b)

**Date:** 2026-10-24 · **Decision:** [001](../../docs/decisions/001-engine.md) · **Verdict:** see §7 (council re-vote)

## Setup (identical for both engines)

| Item | Value |
|---|---|
| Terrain | Real LOLA 5 m/px DEM, Site04 **Shackleton rim**. A 2×2 km window (401² samples) chosen as the flattest by `tools/terrain/extract_tile.py`. 168 m relief, 5.6° mean slope |
| Model | NASA 3D Resources `Apollo Lunar Module.glb` (Draco, ~97k triangles), scaled to the verified 9.42 m footpad span |
| World offset | Tile placed **100 km** from the world origin. Stress case: 1,000 km |
| Sun | 10° elevation |
| Views | `pad` = 1 m above the +X footpad · `chase` = 45 m out, side-lit · `high` = 15 km up |
| Versions | `@babylonjs/core` 9.30.0, `three` 0.186.1 (WebGPURenderer), Vite 8.3.4 |
| Machine | This Mac, Chromium in the Claude browser pane. WebGPU unless noted |

**Tests**
- **Precision (static):** render the same frame with the tile at 0 km and at 100 km, over 24 sub-millimetre camera steps. Score = % of pixels differing by more than 8/255. A perfect large-world path scores 0.
- **Shimmer (motion):** fly the camera 5 cm per frame (≈ 3 m/s at 60 fps) for 48 frames. Measure the frame-to-frame change at 100 km divided by the same at 0 km. A ratio of ~1 means no shimmer.
- **Guard:** every run checks mean luma, so a blank frame can't fake a pass. Blank frames did fake passes early on.

## 1. Precision at 100 km (worst step, % pixels > 8/255)

| Config | Babylon | Three |
|---|---|---|
| Large-world **off**, no shadows (control) | **7.69 %** | **2.51 %** |
| Large-world **on**, no shadows | **0 %** ✅ | **0 %** ✅ (camera-relative re-basing, ~5 lines) |
| On + cascaded shadows, pad | 1.19 % | 0 % |
| On + cascaded shadows, chase | 1.65 % (1.29 % with `stabilizeCascades` off) | **0 %** |

Babylon's leftover is a *static* difference in where the shadow texels land. §2 shows it doesn't move.

## 2. Shimmer (P1-0b), ratio of frame-to-frame change at 100 km vs 0 km

| Config | Ratio |
|---|---|
| Babylon, chase, stabilised, WebGL2 | **0.94** |
| Babylon, chase, unstabilised | **1.00** |
| Babylon, chase, WebGPU | **0.94** |
| Babylon, pad, 0.37 mm steps | **0.91** |
| Babylon, chase, **1,000 km** | **0.94** |
| Babylon, no shadows | 1.00 |
| **Positive control:** Babylon with large-world **off**, chase / pad | **1.46× / 7.19×** ← the test detects shimmer |
| Three, cascaded shadows (example setup), chase | **1.00** |

**No shimmer in either engine, so P1-0b passes for Babylon.**

## 3. Low-sun shadows

| | Babylon | Three |
|---|---|---|
| Cascaded shadows | `CascadedShadowGenerator` works out of the box (4 cascades, PCF). The LM casts a ~40 m shadow | `CSMShadowNode` drew **no LM shadow** in my first setup. Copying the official example's shadow-camera bounds (±1000, near 1, far 2000) fixed it, and it holds at maxFar 20 km with log splits |
| Terrain acne | Heavy at the default bias. Removed with bias 0.004 / normalBias 0.02 | None seen |
| **Close-up contact shadows** (pad view, sun 10°, az 200°) | ❌ **No strut shadows** at that bias (peter-panning) | ✅ Crisp strut shadows on the ground and inside the footpad |

Babylon's contact shadows need per-cascade bias tuning, PCSS/contact-hardening, or a separate near cascade. That fix wasn't attempted in this spike.

## 4. Bundle (gzip, production build)

| Babylon | Three |
|---|---|
| **420 KB** entry (deep imports; the barrel import was 1,240 KB), plus ~530 KB of lazy shader chunks | **264 KB** |

## 5. Frame time

Both engines run at ~16.6–17.7 ms, capped by vsync. That doesn't separate them, because this scene is too light. Babylon had one cold-start hitch from shader compilation.

## 6. Code and gotchas

| | Babylon | Three |
|---|---|---|
| Engine-specific lines (non-blank, non-comment) | 101 | 93 (**0.92×**) |
| Gotchas | WebGPU needs `beginFrame`/`endFrame` outside `runRenderLoop`. Async shader compile (`whenReadyAsync`). `readPixels` and the screenshot helpers fail under a manual loop. Draco decoder is fetched from Babylon's CDN by default. Triangle winding is left-handed | Draco needs an explicit `DRACOLoader`. CSM needs the shadow-camera bounds from the official example (not documented). No built-in large-world mode, so you write the re-basing yourself |

## 7. Verdict: council re-vote (2026-10-24)

**Status: PROPOSED. It needs the user's approval, because changing the engine counts as an important change.**

Extra data used in the vote: a quick Babylon bias retry. At bias 0.0005 with normalBias 0.05, or 0.0005/0.02 with `autoCalcDepthBounds`, the contact shadows came back but the heavy terrain acne returned. At bias 0.004 the acne is gone but so are the contact shadows. PCSS and a dedicated LM shadow generator were not tried.

| Role | Position | Confidence |
|---|---|---|
| Babylon advocate | Keep Babylon. Concedes the reversal condition is met. Argues its built-in particles, GUI, audio, Inspector and Node Material Editor, plus API stability, outweigh one scene. Asks for a 1-day Babylon contact-shadow spike | 4/10 that Babylon should stay |
| Three advocate | Switch. Honour the condition we set in advance; contact shadows are the main realism cue. Concedes that Three's acne wasn't measured with a sweep, its CSM bounds are undocumented, and its TSL API keeps changing | 6/10 for switching |
| **Judge** | **Switch to Three.js, behind a 1-day confirmation gate.** The condition was set in advance and has been met. Ignoring it after the fact would make it worthless. The gate checks only what Three wasn't measured on | — |

### Confirmation gate (1 day, in this harness)

| Check | How it's measured | Pass |
|---|---|---|
| Terrain acne | LM hidden. Sun at 1/3/5/10° elevation × 0/90/200/270° azimuth × `pad` and `chase` views. Compare shadows on vs off. Count only sunlit pixels (N·L > 0.1) that a CPU horizon ray-march over the DEM says are unoccluded | **≤ 0.5 %** of those pixels darkened by > 8/255, in every configuration |
| Contact shadows | `pad` view, same sun grid. Project the strut and pad geometry along the sun on the CPU to get the expected shadow footprint within 1 m of the pad. Compare LM on vs off | **≥ 70 %** of footprint pixels darkened by > 20/255 |
| CSM robustness | LM shadow at maxFar 2 km and 20 km | Present in every case |

**If the gate fails:** go back to Babylon. Apply the PCSS fix plus a dedicated LM shadow generator, and keep fixing until it passes the same metrics.

### Mitigations if Three wins

- Pin `three@0.186.1` exactly. Upgrade only on purpose, and rerun the metric suite after every upgrade.
- Put the engine behind a ~100-line adapter. The renderer only reads the WASM state.
- Do camera-relative re-basing in one world-anchor node, so particles, decals and the plume inherit it for free.
- Keep the CSM bounds as named constants, covered by a regression test.
- Run the precision, shimmer, acne and contact tests in CI (Playwright).
- Prefer stable APIs over changing TSL APIs, and keep a WebGL2 fallback.

## Not tested

- Safari WebGPU
- A mid-range Windows laptop
- The 15 km `high` view (it needs the global 64 ppd mesh)
- A heavy GPU load, to separate the engines on frame time

## How to rerun

```bash
npm --prefix spikes/engine install
```
```bash
npm --prefix spikes/engine run dev
```

Pages:
- `/babylon.html?auto=1&webgl=1`
- `/three.html?auto=1&csmex=1`
- Add `&test=shimmer&step=50` to either for the shimmer test.

Other params: `lw`, `shadows`, `csm`, `stab`, `view`, `sun`, `az`, `offset`. Results land in `window.__spike`.

## 8. Three.js confirmation gate (P1-0c, 2026-10-24)

**Result: 2 of 3 criteria pass. Acne fails in 3 low-sun views because of shadow-map resolution aliasing. `PLAN.md` was not switched.**

Harness: `gate.html` with `src/gate.ts`. Each pixel is checked against CPU ground truth:
- a heightfield ray-march that interpolates exactly like the GPU's triangle mesh
- three-mesh-bvh raycasts for the LM

Settings: 4 sun elevations × 4 azimuths, `pad` and `chase` views, offset 100 km, stride 4 px. Results are in `results/gate-maxfar20000.json`.

### Shipping shadow settings (found by the gate)

| Setting | Value | Why |
|---|---|---|
| CSM | 4 cascades, logarithmic, `CSM_SHADOW_CAMERA` bounds (±1000, near 1, far 2000), maxFar 20 km | — |
| `shadow.bias` | **−0.00002** | Bias is a fraction of each cascade's ~2 km depth range. The old −0.0005 was ~1 m and erased the footpad's shadow (11.6 % contact) |
| `shadow.normalBias` | **0.02** | The sweep gave 0.05 → 73 % contact and 0.1 → 29 %, so 0.02 is best |
| Map size | 2048 | — |

### Results

| Criterion | Threshold | Result | Verdict |
|---|---|---|---|
| **Contact shadows** (≤ 1 m from footpads) | ≥ 70 % | 20 km: **87.0–100 %**. 2 km: **83.0–100 %**, over 7 measurable sun positions (el ≥ 3°) | ✅ PASS |
| **CSM robustness**: LM shadow in the chase view | present | 20 km: **86–99 %**. 2 km: **97.6–100 %**, in every measurable config | ✅ PASS |
| **Acne** (sunlit, terrain-unoccluded pixels darkened > 8/255) | ≤ 0.5 % in every config | **≤ 0.15 % in 22 of 25 measurable views**. **Fails in 3:** 3°/90° pad 6.8 % (485 samples), 3°/90° chase 3.2 % (2,512), 1°/270° chase 1.8 % (663) | ❌ FAIL (strict) |
| Not measurable | — | Sun at 1° is almost entirely n/a: hardly any visible ground faces the sun at N·L > 0.1. Contact shadows are only measurable where the pad shadow is in view | reported, not passed |

### Metric validation (each metric was shown to detect a failure)

| Control | Expected | Got |
|---|---|---|
| Acne metric, terrain forced to cast from front faces, bias 0 | high | **97.0 % / 98.5 %** ✅ |
| Contact metric, old setup (light margin 500, far 50 km, bias −0.0005) | low | **11.6 %** vs 92.4 % tuned ✅ |
| Shimmer, large-world off (rerun with live shadows) | > 1 | **12.1×** ✅ (on: 1.00) |
| Precision with live cascaded shadows (rerun) | 0 | **0 %** in pad and chase ✅ |

### What the acne failures are

They're **not bias acne**:
- They don't change with bias anywhere from 0 to −0.001.
- They don't change with a wider clearance margin, a finer view-ray step, or triangle-exact terrain.

They **do** scale with shadow-map resolution:

| Map size | 3°/90° chase | 1°/270° chase |
|---|---|---|
| 1024 | 5.65 % | 4.07 % |
| 2048 | 3.18 % | 1.81 % |
| 4096 | 2.63 % | 0.90 % |

That is projective aliasing. At a 1–3° sun, each shadow-map texel stretches 19–57× along the ground. **This is a limit of the shadow-map technique itself, so Babylon's CascadedShadowGenerator should hit it too.** That hasn't been measured; the gate is Three-only.

### New finding: distant-ridge shadows are missing

The terrain control measures how much sun-facing ground that a ridge should deep-shadow actually renders dark. In the pad view at 1–5° sun only **1–67 %** does. Cascades only include casters about 200 m toward the sun (`lightMargin`), but at a 1° sun a 168 m ridge casts a shadow ~9.6 km long.

**Architectural implication (engine-neutral):** terrain-on-terrain shadows should come from a **precomputed horizon map** built from the same DEM. It's exact, and it fixes both the grazing-sun aliasing and the missing long shadows. Cascaded shadow maps would then only handle the LM, rocks and dust.

### Corrections to earlier sections

- §3 "Three's CSMShadowNode drew no LM shadow" and "needs undocumented bounds" were **wrong**. The cause was a harness bug: three re-renders shadow maps once per `(camera, frameId)`, and `frameId` only advances in its animation loop. My harness rendered several frames per task, so it read stale shadow maps. With `frameId` advanced, the old setup also shows the LM shadow (99 % in the chase view). The game renders once per frame, so gameplay is unaffected.
- The Three precision and shimmer numbers in §1–2 still hold after rerunning with live shadows (above).
- Fairness note: Babylon's missing contact shadows (§3) may come from the same relative-depth bias effect. Babylon never got this level of tuning.

### Other three gotchas found

- WebGPU compiles shadow-pass pipelines asynchronously. Frames rendered before that finishes have no LM in the shadow map, so the game needs a `compileAsync` warm-up behind a loading screen.
- `CSMShadowNode` fits cascades to `camera.matrixWorld`. Update it before `render()` after moving the camera.

## 9. Council #003: gate amendment and pre-registered gate P1-0d (2026-10-24)

**Ruling: modified amendment. The switch to Three.js is not approved yet.** Written down before any new run.

| Role | Position | Confidence |
|---|---|---|
| Advocate | Amend. The fix follows from the diagnosis, and the Babylon fallback would hit the same aliasing. Listed 6 evidence requirements | 7/10 amend |
| Skeptic | Reject as written. Changing the criterion after seeing the result is goalpost-moving. Taking terrain out of the casters removes the failing criterion for **both** engines, and Babylon never got the relative-bias tuning. Wants a symmetric re-gate | 7/10 reject |
| **Judge** | **Skeptic's structure plus the Advocate's checks.** Horizon map adopted now, whatever the engine. Engine choice decided by a two-engine gate with equal tuning | — |

**Adopted now (engine-neutral):** terrain self-shadowing comes from a **precomputed horizon map** built from the DEM and computed in WASM, so terrain shadowing the LM is deterministic. Cascaded shadow maps handle only the LM, rocks and dust.

**Disclosure:** the lead's LM-self-acne smoke test was seen **before** this gate was written: 9.4 % in the pad view and 81 % in the chase view at 10°/200°, single config, metric not validated. Those numbers may not be used to set thresholds.

### Gate P1-0d

**Common setup**
- Same harness, sun grid (1/3/5/10° × 0/90/200/270°), `pad` and `chase` views, 100 km offset, stride 4.
- Applied to **both** Babylon and Three.
- Each engine gets a **1-day tuning budget** over the same sweep: bias, normalBias, and map size 2048/4096. A dedicated LM shadow generator is allowed in both.

**Criteria**

| ID | Criterion | Threshold |
|---|---|---|
| **M0** | LM-self-acne metric validity: no-acne reference (an offline BVH-shaded LM) vs positive control | ≤ 0.5 % on the reference, ≥ 90 % on the control. If it fails, fix and re-validate. Never waived |
| **H1** | Horizon map vs the CPU ray-march, at every elevation | ≥ 98 % pixel agreement. ≥ 95 % of shadows from ridges ≥ 5 km away caught. Cost and memory reported for 5 m tiles |
| **A1** | Terrain acne, terrain receive-only | ≤ 0.5 % in every config |
| **A2** | LM self-acne and rock-caster acne at 1–3° | ≤ 1.0 % in every config with ≥ 100 samples |
| **C1** | Contact shadows | ≥ 70 % |
| **R1** | CSM robustness | LM shadow present at 2 km and at 20 km maxFar |
| — | All existing controls | Repeated, and each must still detect its failure |

**Decision rules**
- Only one engine passes: that engine wins.
- Both pass: tie-breakers in this order:
  1. Worst-case contact, if the engines differ by > 10 points
  2. Bundle size (gzip)
  3. API stability (breaking changes over the last 12 months)
  4. Tooling
- **Neither passes:** stay on Babylon. Escalate LM shadowing (a dedicated high-resolution LM map, or ray-marched LM self-shadowing) and re-run the same gate. **Thresholds are not loosened.**

**PLAN.md can switch only when all of these hold:**
1. This gate is written down (done).
2. M0 passes.
3. Both engines have been run in full.
4. The decision rule picks a winner.
5. The user approves.
6. teammate-scout gives a "pass" on the results schema (global CLAUDE.md).

## 10. P1-0d prerequisites: M0 and H1 (2026-10-24)

### M0: LM-self-acne metric validity → **PASS**

Raw data: `results/m0-lm-acne-metric.txt`. Harness: `gate.html?tests=acnelm&tcast=0` (`acneLM`, `lmGroundTruth`, `referenceFrames` in `src/gate.ts`).

| Check | Threshold | Result |
|---|---|---|
| No-acne reference: CPU BVH-shaded LM, 2×2 jittered sub-rays | ≤ 0.5 % in every config with ≥ 100 samples | **0.00–0.02 %**, 7 configs, 447–4,992 samples ✅ |
| Positive control: LM surfaces the CPU says are self-shadowed must read dark | ≥ 90 % | **99–100 %** ✅ |
| Extra sensitivity check: forced acne (LM casts from lit faces, bias 0) | (none pre-registered) | **70–88 %** vs 0.02 % on the clean reference, so the metric is clearly sensitive |

**Fixed along the way (M0 did its job):** the first version judged each pixel by its centre ray alone and read 0.76 % / 8.1 % on the clean reference. Silhouette and shadow-edge pixels blend surfaces. Now a pixel counts only if its centre and 4 sub-pixel rays all agree on surface, sun-facing, terrain-unshadowed and self-shadow state.

**Limits:**
- The `chase` view never reaches 100 LM samples, so A2 is effectively measured in the `pad` view only.
- At 1–3° sun most configs have no eligible LM pixels.

**Preview, not the official A2 run.** Untuned Three (bias −0.00002 / normalBias 0.02) reads **3.5–10.2 %** LM self-acne in the pad view. That would fail A2's ≤ 1.0 %. Fixing it is the job of Three's 1-day tuning budget in P1-0d-THREE.

### H1: horizon map → **PASS** (with a cost caveat for full 5 m tiles)

Code: `crates/horizon` (Rust, no dependencies). It's a per-seed **sun horizon map**: for each DEM sample, the steepest slope toward the sun, from a geometric march (1.5 % step growth) over the triangle-exact mesh surface.
- No transcendental functions: the seed carries the sun vector and tan(elevation).
- Exports a plain WASM ABI (`hz_alloc_f32`, `hz_bake`).
- Unit tests pass.

Ground truth is a separate fine fixed-step march (2.5 m) over the **full 16 km Site04 DEM** (relief −2,848 to +1,805 m). Raw data: `results/h1-horizon-native-growth0.015.jsonl`.

| Check | Threshold | Result |
|---|---|---|
| Shadow agreement, all samples | ≥ 98 % at every elevation | **99.37–100 %** across 2 regions × 16 sun positions ✅ |
| Shadow agreement, sun-facing samples only (stricter) | (same) | **99.02–100 %** ✅ |
| Shadows from ridges ≥ 5 km away caught | ≥ 95 % | **96.04–100 %** (up to 14,940 such samples per config) ✅ |
| Deterministic in WASM | bit-identical to native | **FNV-1a `384f4e95` on both** (160,801 samples, 3°/200°) ✅ |

**Disclosure:** agreement is measured per **DEM sample**, not per rendered pixel. The horizon map isn't wired into the renderer yet; that happens in the engine runs. The mask in `horizon.html` looks physically plausible: craters and depressions are shadowed.

**Cost and memory (5 m DEM, one sun per seed, single thread):**

| Region | Samples | Native | WASM (browser) | Slope map f32 | 8-bit lit mask |
|---|---|---|---|---|---|
| 2 km tile | 160,801 | 0.25–2.6 s | 0.75 s | 0.6 MB | 0.16 MB |
| 4 km block | 641,601 | 1.7–3.0 s | 1.8 s | 2.6 MB | 0.64 MB |
| 20 km tile (4096²), extrapolated | 16.8 M | ~45–80 s | ~50–90 s | 67 MB | 17 MB |

**Implication for the plan:**
- Bake the **landing region (4–8 km) at 5 m when the seed loads**, in a Web Worker: ~2–7 s, which hides behind the loading screen and shader warm-up.
- Bake distant terrain from the coarser global LOLA mesh.
- **Or** bake each daily seed once on the server and ship the 8-bit mask, which makes it identical for everyone by construction.

The full 4096² single-thread bake is too slow to do at load time.

## 11. P1-0d run protocol (pre-registered before any engine data, 2026-10-24)

These operational details fill in gate §9. They're fixed now, before either engine is measured.

**Harness:** `gate2.html?engine=three|babylon`. It shares one engine-agnostic core (`src/gateCore.ts`). Ground truth is CPU geometry in each engine's own world coordinates: the triangle-exact heightfield plus BVH raycasts against the engine's actual world-space LM and rock triangles.
- **Three:** WebGPU.
- **Babylon:** WebGL2 with `preserveDrawingBuffer`, because readback from its WebGPU swapchain failed under a manual frame loop (§1). The shadow algorithm is the same on both backends.
- **Both:** camera FOV 60° vertical; the same tile, LM, sun, rocks and views.

**Rock casters:** 40 seeded procedural boulders (`makeRocks`, seed 1969). Radius 0.2–1.5 m, 6–40 m from the LM, sunk 30 % into the terrain. Identical geometry in both engines.

**Shadow setup:** terrain is receive-only (the horizon map handles terrain shadows; H1). LM and rocks cast and receive. Cascades: 4 cascades, maxFar 20 km (R1 also at 2 km).

**Criteria as implemented**
| ID | Measured on | Rule |
|---|---|---|
| A1 | Sunlit terrain pixels. All 5 sub-rays agree: unshadowed by terrain (CPU march) and by LM/rocks (BVH) | ≤ 0.5 % darkened by > 8/255 (shadows on vs off), in every config with ≥ 30 samples |
| A2 | LM + rock surfaces, M0 method | ≤ 1.0 % in every config with ≥ 100 samples |
| C1 | Ground ≤ 1 m from footpads, in the LM's geometric shadow and not rock-shadowed (`pad` view) | ≥ 70 % darkened > 20/255 (±2 px) by the LM, in every config with ≥ 30 samples |
| R1 | Whole LM shadow, `chase` view, maxFar 2 km and 20 km | "present" means ≥ 50 % coverage in every config with ≥ 30 samples |

**Tuning budget (the same size for both engines):**
- 18 configurations: 3 bias × 3 normalBias × map size {2048, 4096}, each in that engine's own units.
  - Three: bias {−0.00002, −0.0001, −0.0005}, normalBias {0.01, 0.02, 0.05}
  - Babylon: bias {0.0002, 0.001, 0.004}, normalBias {0.005, 0.02, 0.05}
- Each configuration runs on the tuning subset of sun positions {3°/200°, 5°/90°, 10°/0°, 10°/200°} at 20 km.

**Selecting each engine's config:**
1. Take the configs that pass all four criteria on the subset.
2. If there are several, pick the one with the largest worst-case margin, normalised to the threshold.
3. If none pass, pick the one with the fewest failed criteria, then the smallest worst violation.

The selected config then runs the **full 16-position grid**: A1, A2, C1 and R1 at 20 km, plus R1 and C1 at 2 km. Only the full-grid result counts for the decision rule in §9.

## 12. P1-0d result (2026-10-25)

*Scout-verified 2026-10-25: criteria recomputed from the raw files.*

**Decision rule (§9): neither engine passes → Babylon stays the baseline. LM shadowing is escalated and the same gate re-run, with the same thresholds.**

| Criterion | Threshold | **Three.js** (bias −0.00002, nb 0.02, 4096) | **Babylon.js** (bias 0.004, nb 0.05, 4096) |
|---|---|---|---|
| A1 terrain false darkening | ≤ 0.5 % (≥ 30 samples) | ❌ 6 of 24 views fail, worst **3.71 %** | ❌ 13 of 24 fail, worst **48.2 %** |
| A2 LM + rock self-acne | ≤ 1.0 % (≥ 100 samples) | ❌ 16 of 16 fail, worst **13.75 %** | ❌ 16 of 16 fail, worst **57.5 %** |
| C1 footpad contact shadow @ 20 km | ≥ 70 % | ✅ 8 of 8, worst **82.5 %** | ❌ 2 of 8 fail, worst **54.1 %** |
| R1 LM shadow present, 20 km / 2 km | ≥ 50 % | ✅ worst 92.1 % / 98.7 % | ✅ worst 97.7 % / 98.1 % |
| C1 @ 2 km (reported, not a criterion) | — | worst 82.4 % | 1 of 8 below 70 %, worst 64.8 % |

Settings were chosen by the §11 rule from each engine's 18-config sweep: `results/p1-0d-three-sweep.txt` and `results/p1-0d-babylon-sweep.txt`. Full grids are in `results/p1-0d-three-full.txt` (table) and `results/p1-0d-babylon-full.json` (raw).

**Controls held in both engines:**
- **M0 reference:** 0.00–0.02 % (0.29 % in one config below 100 samples).
- **A2 self-shadow control:** 97–100 %.
- **A1 caster-shadow control:** 87–100 %.
- **Ray-mapping check:** 100 % of caster-free pixels unchanged.

Ground-truth sample counts match between the engines (e.g. 10°/200° A1 25,266 vs 25,243; C1 3,232 vs 3,236), which confirms Babylon's mirrored left-handed camera is mapped correctly.

### What the numbers say (observations; they don't change the rule's outcome)
1. **Three came much closer.** It passes C1 and R1, and its failures are 3.71 % (A1) and 13.75 % (A2) against Babylon's 48 % and 57.5 %. In Three, most A2 failures are **LM surfaces in the chase view**, where the LM is small and its cascade texels are coarse. Rock self-acne is mostly 0–4 %, except one 35-sample view (3°/270° chase) at 14.3 %.
2. **Babylon loses contact shadows at grazing sun over a 20 km cascade range.** At 3°/200° C1 reads 54 % at 20 km and 100 % at 2 km. Its front-face shadow casting produces heavy self-acne that no setting in the sweep removed.
3. **Neither engine's stock cascaded shadows can meet A2.** That's what the rule's escalation is for: a **dedicated high-resolution LM shadow map**, or ray-marched LM self-shadowing in a shader, applied in **both** engines before re-running P1-0d.
4. **Caveat for the next round:** the ground truth uses a point sun. The real 0.53° solar disc gives physical penumbras (~10 cm at the footpads at 10°), and some A1 "false darkening" next to shadow edges may be physically right. The thresholds stay as written. If this is to change, it needs its own council, written down before new data.

### Harness changes made during the run (before any engine data counted)
- Ground truth is computed once per sun/view, and every shadow config is scored on a fresh engine instance.
- Lipschitz-safe heightfield stepping.
- Fixed 1110×622 render size for both engines.
- Results are saved through a dev-server endpoint.

None of these changes a criterion or a threshold.
