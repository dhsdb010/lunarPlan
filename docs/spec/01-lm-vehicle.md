# Spec 01 — LM vehicle & touchdown numbers

Every constant the flight core uses comes from this file. Status key:
- ✅ **verified**: read directly in a primary NASA document (OCR'd or text), with page/section cited
- 🟡 **secondary**: several non-NASA sources agree, but no primary source has been read yet
- 🔶 **derived**: calculated from verified values (the formula is shown)

Source IDs ([S1]…) are listed in [00-sources.md](00-sources.md).

## 1. Environment

| Constant | Value | Status | Source / note |
|---|---|---|---|
| Lunar reference radius | 1,737.4 km | ✅ | [S6] reference radius used by the CGI Moon Kit / LOLA DEMs |
| Surface gravity g☾ | 1.62 m/s² | 🔶 | g = GM/R² = 4902.8 km³/s² ÷ 1737.4² km² = 1.624 m/s². The NSSDC fact sheet could not be reached, so re-check it. |
| Atmosphere | none (no drag, no plume expansion limit) | ✅ | — |

## 2. Descent Propulsion System (DPS)

| Constant | Value | Status | Source |
|---|---|---|---|
| Maximum rated thrust (100 %) | 10,500 lbf = **46.71 kN** | ✅ | [S2] p.12, design requirement 2 |
| Fixed Throttle Position (FTP) | **92.5 %** of rated = 9,712 lbf = 43.20 kN | ✅ | [S2] p.12 "FTP was optimized at 92.5 percent of maximum-rated thrust" |
| Minimum throttle | **10 %** (4.67 kN) | ✅ | [S2] p.14 "minimum-throttle point was 10 percent" |
| Throttleable range | 10 %–65 % | ✅ | [S2] p.14 |
| Non-operating region | **65 %–92.5 %**. The engine can physically go there, but it is not an operating region | ✅ | [S2] p.14. FTP was chosen because of "mixture-ratio control and throat erosion" problems near max thrust |
| Throttling ratio | 10:1 | ✅ | [S2] p.12 |
| Gimbal | **±6°** in Y and Z | ✅ | [S2] p.12 |
| Specific impulse | **305 s** (end of duty cycle, design requirement) | ✅ | [S2] p.12. The "311 s" figure seen online is 🟡 and is **not used** |
| Duty-cycle life | 1,000 s | ✅ | [S2] p.12 |
| Propellants | N₂O₄ / Aerozine-50 (50 % UDMH + 50 % N₂H₄) | ✅ | [S2] p.12 |
| Ignition sequence | Ignite at minimum thrust, auto-advance to FTP after **26 s** | ✅ | [S1] §4.10.3 |
| Throttle recovery (FTP → throttleable) | **386 s** after ignition on Apollo 11 (384 s predicted) | ✅ | [S1] §5 |
| Low-level sensor | Trips at **5.6 %** in any tank | ✅ | [S2] p.11 |
| Apollo 11 low-level light | On at 102:44:30.4, with ~**116 s** of firing time left | ✅ | [S1] §9.13 |
| Apollo 11 margin at landing | **63.5 s** of hover time remaining, "minimum-usable quantities based on oxidizer tank 2" | ✅ | [S2] Apollo 11 section |
| Apollo 11 margin, mission report | **45 s** to depletion indicated at engine cutoff. 50 s postflight-calculated to oxidizer tank 2 depletion | ✅ | [S1] §9.13. **The two sources disagree** (different definitions of "usable"). The game uses [S1]'s 45–50 s as the Apollo 11 reference |
| Low-level → Bingo timeline | Light at 116 s of firing left → **landing go/no-go (Bingo) at 20 s left**, i.e. **96 s after the light** → depletion at 0 | ✅ | [S1] §9.13 figure p.9-24 |
| Apollo 11 hover throttle | ~26 % ±7.5 % oscillation in the last 140 s | ✅ | [S2] Apollo 11 section, fig. 18 |

## 3. Masses (Apollo 11, LM-5)

| Constant | Value | Status | Source |
|---|---|---|---|
| LM total mass (post-docking, pre-separation) | 33,294.5 lb = **15,102 kg** | ✅ | [S1] App. A.6 mass properties |
| DPS propellant loaded | **18,184 lb = 8,248 kg** (fuel 6,975 lb + oxidizer 11,209 lb) | ✅ | [S1] §9.13.1 table |
| DPS propellant consumed | ~17,414 lb (OCR garbled, re-check) | 🟡 | [S1] §9.13.1 table |
| RCS propellant used in powered descent | 95 lb (40 lb predicted) | ✅ | [S1] §5 |
| LM mass at PDI | ≈ 15,000 kg | 🔶 | 15,102 kg minus DOI burn and RCS use. A fine-tuning constant |
| Landing mass check | ≈ 7,500 kg | 🔶 | 26 % × 46.71 kN ÷ 1.62 m/s² = 7,497 kg, which matches the hover throttle. **Flight-core regression test** |

## 4. Reaction Control System (RCS)

| Constant | Value | Status | Source |
|---|---|---|---|
| Thrusters | 16 (4 quads of 4 on outriggers), 2 independent systems A/B of 8 | 🟡 | [S8] [S9] (Marquardt R-4D) |
| Thrust per thruster | **100 lbf = 445 N** | ✅ | [S12] RCS thrust chamber assembly table "Engine thrust 100 pounds" |
| RCS chamber pressure / mixture | 96 psia, O/F 2.05 | ✅ | [S12] |
| Valve response time | 0.25 s at 250 psi inlet | ✅ | [S12] |
| Pulse mode (V76, minimum impulse) | One minimum-impulse burn per ACA movement **> 2.5°** out of detent. The ACA must return to detent between pulses. Max **≈ 5 pulses/s** | ✅ | [S12] §2.2 PGNS pulse mode |
| Minimum impulse duration | ~14 ms commonly cited | 🟡 | Not found in the AOH vol. 1 text. Use 14 ms until verified |

## 4b. Attitude Controller Assembly (ACA, "RHC")

| Constant | Value | Status | Source |
|---|---|---|---|
| Out-of-detent | **1.25°** stick deflection | ✅ | [S12] §2.2.4.6.1 |
| Proportional range | **2°–10°** of deflection (0.35 V/deg) | ✅ | [S12] §2.2.4.6.1 |
| Hardover | Beyond the proportional range: 4-jet direct to the secondary coils | ✅ | [S12] |
| Mode in attitude hold | **Proportional rate command**. On release, the LGC holds the new attitude | ✅ | [S12] |
| AGS rate limits (min deadband, descent) | **10 °/s pitch, 5 °/s roll & yaw** | ✅ | [S12] |
| PGNS max commanded rate | 20 °/s normal / 4 °/s fine commonly cited | 🟡 | Not found in the AOH text. Use 20 °/s until verified |
| Game mapping (decision 002 input cap) | 9 levels per axis on a 10 Hz frame → detent, ±4 proportional steps across 2°–10° | 🔶 | — |

## 5. Landing gear & touchdown limits (pass/fail rule)

| Constant | Value | Status | Source |
|---|---|---|---|
| Lunar-surface-sensing probe length | **1.73 m (68 in)** on 3 of 4 legs (not the forward/ladder leg) | ✅ | [S3] p.2; [S4] |
| Footpad diameter | 0.91 m (~37 in) | ✅ | [S3] p.2 |
| Footpad center from X-axis | 167.57 in = 4.256 m (tread radius) | ✅ | [S4] |
| Vertical velocity limit | **≤ 10 ft/s (3.05 m/s)** | ✅ | [S3] fig. 6; [S4] "10-7-4 envelope" |
| Horizontal velocity limit | **≤ 4 ft/s (1.22 m/s)** while Vv ≤ 7 ft/s; then the limit falls linearly to 0 at Vv = 10 ft/s | ✅ | [S4] p.10, fig. 10/12. The linear shape is read from the figure because the OCR'd formula is garbled |
| Surface slope | design mean slope **≤ 6°**, effective slope **≤ 12°** (incl. depressions/protuberances) | ✅ | [S4] p.10 |
| Toppling stability | P(stable) = 0.998 on slopes ≤ 12°, 0.967 overall | ✅ | [S3] fig. 6 |
| Touchdown attitude (3σ design) | pitch **5.69°**, roll **5.72°**, yaw random | ✅ | [S4] fig. 12 |
| Touchdown angular rates (3σ design) | pitch 6.0, roll 6.0, yaw 1.5 °/s | ✅ | [S4] fig. 12 |
| Max protuberance/depression in footprint | 24 in (0.61 m) | ✅ | [S4] p.10 |
| Sliding friction coefficient | 0.4–1.0 (0.4 confirmed realistic postflight) | ✅ | [S4] p.10 |
| Shutdown modes | **Probe mode** (primary): engine off after contact light, before pads touch. **Pad mode** (backup): engine off after footpad contact | ✅ | [S3] |
| Apollo 11 actual touchdown | ~1.7 ft/s vertical, ~2.1 ft/s lateral (left), negligible forward, landed in pad mode | ✅ | [S1] §5.4. [S4] fig. 12 gives Vx −1.8, Vy −2.2 ft/s |

### Game rule derived from this (proposal; the scoring council decides)

```
Vv_lim(ft/s) = 10
Vh_lim(Vv)   = 4                       if Vv ≤ 7
             = 4 * (10 − Vv) / 3       if 7 < Vv ≤ 10
FAIL if Vv > 10 or Vh > Vh_lim(Vv) or |pitch|,|roll| > ~6° or local slope > 12° or toppled
```

## 6. Corrections vs. PLAN.md v1

| Item | PLAN v1 said | Verified |
|---|---|---|
| Probe length | 1.73 m (67.2 in) | **1.73 m (68 in)** |
| DPS max thrust | ~45 kN (10,125 lbf) | **46.71 kN rated (10,500 lbf), operational max at FTP 43.20 kN** |
| Isp | ~311 s | **305 s** (design requirement) |
| Horizontal limit | flat 1.2 m/s | **10-7-4 envelope** (falls off above 7 ft/s vertical) |
| Tilt limit | ≤ 12° tilt | **12° is the surface slope**. Vehicle attitude limit ≈ **6°** |
