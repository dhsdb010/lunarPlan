# Decision 002 — Scoring rules (Approach mode)

- **Date:** 2026-10-24
- **Status:** ACCEPTED by the user on 2026-10-24
- **Council:** Advocate (weighted sum), Skeptic (tiers + one metric), Judge
- **Ruleset version:** `1.0`

## Verdict

**Tiers, then hover margin.** There is no weighted sum. The Skeptic's design wins, with three changes from the Judge.

Why the weighted sum was rejected:
1. The weights become the meta. Every retune changes the optimal strategy and breaks the all-time boards.
2. Terms double-count each other (time ≈ fuel, attitude ≈ horizontal velocity).
3. A throttle-zone term would score the autopilot, because in P66 the computer flies the throttle.
4. Bounded terms saturate, so bots tie at max score and float noise ends up ordering the top of the board.

What was kept from the Advocate: sink rate is judged **at the contact light**, not at pad impact. A real probe-mode stop free-falls the last 1.73 m, so pad-impact softness would punish Apollo technique. Also kept: the hop and settle/topple checks, and the rule of no time term.

## 1. NO-GO (not ranked)

All checks are at the first pad contact unless noted. Limits come from [spec 01 §5](../spec/01-lm-vehicle.md).

| Check | Limit |
|---|---|
| Vertical velocity Vv | > 10 ft/s (3.05 m/s) |
| Horizontal velocity Vh | > 4 ft/s, or > 4·(10 − Vv)/3 when Vv > 7 ft/s (10-7-4 envelope) |
| Attitude | \|pitch\| or \|roll\| > 6° |
| Angular rates | pitch/roll > 6 °/s, yaw > 1.5 °/s |
| Footprint | plane fit to the 4 footpad DEM heights: slope > 12°, or any pad bump/hole > 0.61 m |
| Stability | topples in the 10 s post-contact settle sim, or hops > 0.3 m after first contact |
| Fuel | propellant depleted before engine stop |
| Bingo | no contact light by low-level light + **116 s**: the Bingo (land-or-abort) call comes at **+96 s**, then the 20 s that remain. Timing verified in [S1] §9.13 (round 2 correction: the Judge had +94 s / +114 s) |
| Other | player abort, or landing > 150 m from the seed target |

## 2. Tiers

| Tier | Conditions |
|---|---|
| **GO** | survived (no NO-GO) and D ≤ 150 m |
| **EAGLE** | GO **and all of these**: D ≤ 30 m · footprint slope ≤ 6° · Vh ≤ 2 ft/s at pad contact · \|pitch\|,\|roll\| ≤ 3° · Vv ≤ 3 ft/s at contact light · **ENGINE STOP ≤ 1.0 s after the contact light and before any pad touches** (probe mode) |

Every EAGLE ranks above every GO. A landing close to the target on an 11.9° slope can only ever be GO, which removes the incentive to snipe bad slopes.

## 3. Ranking within a tier

1. **Hover margin**, higher is better: usable propellant left at engine stop ÷ **4.05 kg/s**, floored to 0.1 s.
   - The 4.05 kg/s comes from spec: 26 % × 46.71 kN ÷ (305 s × 9.80665) = 4.06 kg/s, the hover flow at the Apollo 11 hover throttle.
   - Mission Control actually called out this number ("60 seconds"). The Apollo 11 reference is **45–50 s** per the mission report ([S1] §9.13). TN D-7143 gives 63.5 s under a different "usable" definition; see spec 01 §2.
2. Tie-break: distance D to the seed target, floored to 0.1 m, lower is better.
3. Tie-break: earliest submission.

## 4. Input caps (enforced by the sim, so replays verify them)

- ROD switch: ≤ 4 clicks/s, ±1 ft/s per click
- LPD redesignation: ≤ 4 clicks/s
- RHC: sampled on a 10 Hz control frame, 9 quantized levels per axis

These caps keep a bot's advantage small. They don't stop bots, and the board makes no claim that it does.

## 5. Leaderboard row

```
#3  ALDRIN_FAN  [EAGLE]  47.3 s  │ 12.4 m · CL V 2.6 / pad V 6.9 H 0.8 ft/s · 2.1° · slope 3.4° · PROBE │ seed 2026-10-24 · r1.0 · ▶ replay
```

Only the tier and the margin decide rank. Everything else is context, and the ▶ link opens a ghost replay.

## 6. Board stability

- Each run stores `ruleset = MAJOR.MINOR` and the sim build hash.
- Boards are keyed by **(seed, MAJOR)**. A change to physics, a limit, or the 4.05 constant bumps MAJOR and opens a new board. The old board is frozen as Legacy: still viewable, never re-ranked.
- MINOR covers display/UI changes only and never re-sorts a board.
- The server re-verifies each replay under the ruleset stored with it. Nothing is re-scored after the fact.

## 7. Game choices to playtest

These are design numbers, not NASA numbers: 150 m, 30 m, 3°, 2 ft/s, 3 ft/s, 6° EAGLE slope, the 1.0 s window, and the input caps.

How we test them:
- **Apollo 11 regression:** fly the Apollo 11 profile on every seed. It must come out GO, not EAGLE, because it landed in pad mode.
- **Bot check:** run a capped internal bot. Its margin edge over the top humans should be ≤ ~3 s.
- **Beta target:** about 15 % EAGLE rate among players with 10 or more runs.
- Change one number at a time, and only before launch.

## 8. Judge's open check, resolved

Probe-mode stops can meet Vh ≤ 2 ft/s:
- Free-fall adds no horizontal velocity.
- Engine tail-off at ≤ 3° tilt adds about 0.1 ft/s.
- Expected pad Vv is about 6–8 ft/s, which stays inside the 10-7-4 envelope.

The flight core must confirm this once tail-off is modelled (task P1-x).

## 9. Corrections to council input

The Judge quoted Apollo 11 Vh ≈ 2.8 ft/s. The primary sources give ~2.1–2.2 ft/s lateral with negligible forward velocity ([S1] §5.4, [S4] fig. 12). The result is unchanged: Apollo 11 = **GO**.
