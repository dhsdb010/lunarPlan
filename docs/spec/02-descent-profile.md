# Spec 02 — Powered descent profile & crew procedures

Sources: [00-sources.md](00-sources.md). Status key as in [01-lm-vehicle.md](01-lm-vehicle.md).

## 1. Phases

| Phase / program | Start | End | Status | Source |
|---|---|---|---|---|
| Descent orbit | 60 nmi × **50,000 ft** ellipse (DOI Hohmann transfer) | PDI at pericynthion | ✅ | [S2] p.7 |
| **P63 Braking** | PDI at ~50,000 ft (15.2 km). Apollo 11 best estimate 49,376 ft, PGNCS 49,955 ft | High Gate | ✅ | [S1] table 5-III |
| P63 initial velocity | ~5,560 ft/s (1,695 m/s) | → ~450 ft/s at High Gate | 🟡 | [S5] summary text, full PDF not read |
| **High Gate → P64 Approach** | Nominal ~7,300 ft. **Apollo 11 actual 7,129 ft (2,173 m), descending at 125 ft/s (38 m/s)** | ~100–150 ft above the target | ✅ (A11 actual) | [S1] §5.2 |
| P64 behaviour | Pitchover, LPD shows the landing point on the commander's window. The crew can redesignate with RHC clicks | — | ✅ | [S1] §5.2; [S7] |
| **P65 Auto landing** | Entered automatically when time-to-go = 12 s at **~150 ft (46 m)** | Touchdown | ✅ | [S1] §5.1 |
| P65 behaviour | Nulls horizontal velocity and holds a **3 ft/s** descent | — | ✅ | [S1] §5.1 |
| **P66 Rate of Descent** | Crew moves the guidance mode switch to Attitude Hold, then clicks the ROD switch. Can be entered any time before P64 ends | Touchdown | ✅ | [S1] §5.1 |
| P66 behaviour | Crew flies **attitude** (RHC) → horizontal velocity. Computer flies the **throttle**. Each ROD click = **±1 ft/s** of sink rate | — | ✅ | [S1] §5.1; [S7] |
| P66 is one-way | You can't go back to P65 after selecting P66 | — | ✅ | [S7] |
| P67 | Fully manual (crew throttle) | — | ✅ | [S7] |
| **Low Gate** | Defined as "completion of approach phase aim conditions", which ends P64 and auto-selects P65 | — | ✅ | [S12] table 2.2-7 |
| Low Gate altitude | **~150 ft (46 m)** on Apollo 11 (P65 at TGO = 12 s). Luminary 1D (Apollo 15–17) went to **P66 automatically at 100 ft** | — | ✅ | [S1] §5.1; [S7] |
| LPD redesignation step | **2° azimuth, 0.5° elevation per click**. Counted when the stick returns to detent | — | ✅ | [S13] `AZEACH DEC .03491 # 2 DEGREES`, `ELEACH DEC .00873 # 1/2 DEGREE`; [S7] |
| Bingo | Land-or-abort call **96 s after the low-level light** (20 s of firing left) | — | ✅ | [S1] §9.13 |

**Software version we model:** Luminary 1A (Apollo 11, `Luminary099`). Later versions differ: Luminary 1D removed P67 and added the N92 throttle-command display.

**"Low Gate ≈ 500 ft" is wrong**, since real Low Gate is ~150 ft. So the Final Approach mode's start altitude is a **game choice**, not a NASA gate. The proposal is to start at **500 ft (152 m)**, which gives ~1–1.5 min of P66 flying. That needs a council decision before Phase 1 locks it.

## 2. Apollo 11 timeline (validation run for the sim)

| Event | GET / offset | Status |
|---|---|---|
| DPS ignition (PDI) | 102:33:05 | ✅ [S1] |
| Advance to FTP | ignition + 26 s | ✅ [S1] |
| Face-up yaw | ~45,900 ft, ~4 min after ignition | ✅ [S1] |
| Landing radar lock | During the yaw. Radar showed a **2,800 ft** disagreement with the computer's altitude, which converged within 30 s of enabling updates | ✅ [S1] |
| First 1202 alarm | ignition + 5 min 16 s | ✅ [S1] |
| Throttle recovery | ignition + 386 s | ✅ [S1] |
| P64 at High Gate | 7,129 ft, −125 ft/s | ✅ [S1] |
| Landing radar low scale | < 2,500 ft | ✅ [S1] table 5-I |
| Low-level light | 102:44:30.4 (~116 s of firing left) | ✅ [S1] |
| Touchdown | **102:45:39.9** → powered descent lasted **12 min 34.9 s** | ✅ [S1] |

## 3. What the player controls (by mode)

| Mode | Player inputs | Computer does |
|---|---|---|
| Approach (★ main leaderboard) | LPD redesignation (P64), then takeover to P66: RHC attitude + ROD clicks, ENGINE STOP on contact light | Throttle (always in P64/P66), guidance in P64 |
| Final Approach | P66 only: RHC attitude + ROD clicks + ENGINE STOP | Throttle |
| Full Descent | Everything above, plus monitoring the P63 alarms (1201/1202 go/no-go) | P63 guidance |
| Manual (expert, P67) | Throttle + attitude + RCS translation | Nothing |

## 4. Open items for Phase 0 round 2

Round 2 (2026-10-24) closed these items: RCS thrust, pulse mode, ACA ranges, LPD step, Low Gate, and Bingo.

Still open (none of them block Phase 1, since the 🟡 values are used as placeholders):
- PGNS ACA max rate (20 °/s normal / 4 °/s fine) and the RCS minimum impulse (14 ms). Check against the Luminary DAP source (`Luminary099` DAP files).
- The full **R-695** text, to verify the P63 initial velocity (~5,560 ft/s) and the nominal High Gate (~7,300 ft). The nasa.gov URL now returns 404.
- Gravity from the NSSDC fact sheet (the site timed out twice). It is derived from GM for now.
