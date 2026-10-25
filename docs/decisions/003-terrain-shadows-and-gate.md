# Decision 003: terrain shadows via horizon map, and the two-engine gate

- **Date:** 2026-10-24
- **Status:** ACCEPTED (council #003, for the part the council adopted). The engine choice stays open; see [001](001-engine.md).
- **Council:** Advocate (amend, 7/10) · Skeptic (reject as written, 7/10) · Judge (modified amendment)

## Adopted

Terrain self-shadowing and terrain shadowing the LM use a **precomputed horizon map** built from the
same DEM. It is engine-neutral, and the LM lookup is computed in WASM so it's deterministic.
Cascaded shadow maps handle only the LM, rocks and dust. The two shadow terms are combined with `min()`.

**Why:** at the South Pole's 1–3° sun, shadow maps alias (a limit of the technique, measured in REPORT §8),
and they miss ridge shadows several km long (only 1–67 % of them caught).

## Not adopted

The user's request to "re-scope acne, then switch to Three.js if it passes" was not adopted as
proposed. Taking terrain out of the casters removes the failing criterion for **both** engines, so a
gate run only on Three would be goalpost-moving. Instead the engines are compared with the
pre-registered **gate P1-0d**, run on both with equal tuning: criteria M0, H1, A1, A2, C1, R1, plus
decision rules and tie-breakers. The full text is in
[spikes/engine/REPORT.md §9](../../spikes/engine/REPORT.md#9-council-003-gate-amendment-and-pre-registered-gate-p1-0d-2026-10-24).

## Disclosure

The LM-self-acne smoke data (9.4 % / 81 %, one config, metric not validated) was seen before the
gate was written. It may not be used to set thresholds.
