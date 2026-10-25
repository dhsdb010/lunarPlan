# Decision 001 — Rendering engine

- **Date:** 2026-10-24
- **Status:** **Babylon.js remains the baseline (gate P1-0d, 2026-10-25: neither engine passed, so the §9 rule keeps the status quo).** Three.js came much closer: it fails A1 (3.7 %) and A2 (13.75 %) but passes C1 and R1. Babylon fails A1 (48 %), A2 (57.5 %) and C1 (54 %). Next per the rule: escalate LM shadowing (dedicated LM shadow map or ray-marched LM self-shadowing) in both engines and re-run the same gate. See [REPORT §12](../../spikes/engine/REPORT.md#12-p1-0d-result-2026-10-25).
- **Current verdict:** Babylon.js (pinned 9.30.0) baseline, behind a ~100-line renderer adapter. Candidate: three@0.186.1. Physics runs in a deterministic Rust core compiled to WASM and shared with the SpacetimeDB Rust module.

The full debate, the conditions and the spike criteria are in [PLAN.md §7](../../PLAN.md#7-council-001--engine-choice).
