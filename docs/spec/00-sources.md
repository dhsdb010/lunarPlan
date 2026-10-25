# Spec 00 — Sources

Primary NASA documents were read in Phase 0 (2026-10-24). The scanned PDFs were OCR'd locally (macOS PDFKit render → tesseract), and figures were checked by eye.

| ID | Document | Used for |
|---|---|---|
| S1 | *Apollo 11 Mission Report*, MSC-00171, Nov 1969 — [nasa.gov PDF](https://www.nasa.gov/wp-content/uploads/static/apollo50th/pdf/A11_MissionReport.pdf) (NTRS 19700008096) | Descent timeline, P64–P66 behaviour, masses, propellant, touchdown |
| S2 | Hammock, Currie, Fisher, *Apollo Experience Report — Descent Propulsion System*, NASA TN D-7143, 1973 — [NTRS 19730011150](https://ntrs.nasa.gov/citations/19730011150) | DPS thrust, throttle, FTP, Isp, gimbal, low-level sensor, Apollo 11 margins |
| S3 | *Apollo Lunar Module Landing Gear*, NTRS 19730010151, 1972 — [nasa.gov PDF](https://www.nasa.gov/wp-content/uploads/static/history/alsj/LM_Landing%20Gear1973010151.pdf) | Probe, footpad, stability, probe/pad mode |
| S4 | W. F. Rogers, *Apollo Experience Report — LM Landing Gear Subsystem*, NASA TN D-6850, 1972 — [NTRS 19720018253](https://ntrs.nasa.gov/citations/19720018253) | 10-7-4 touchdown envelope, slopes, attitude/rate limits, Apollo 11 touchdown |
| S5 | Klumpp, *Apollo Lunar Descent Guidance* (R-695) — [nasa.gov PDF](https://www.nasa.gov/wp-content/uploads/static/history/alsj/ApolloDescentGuidnce.pdf) (URL now 404s) | P63/P64 targets (summary only so far) |
| S6 | NASA SVS *CGI Moon Kit* — [svs.gsfc.nasa.gov/4720](https://svs.gsfc.nasa.gov/4720) | Lunar reference radius 1737.4 km, global LOLA |
| S7 | Eyles, *LGC Astronaut Interfaces During Landing (Luminary 1D)* — [ibiblio PDF](https://ibiblio.org/apollo/Documents/Eyles-LgcAstronautInterfacesDuringLandingLuminary1D_text.pdf) | P66 ROD 1 ft/s per click, P66 one-way, P65/P67 |
| S8 | *U.S. Manned Rocket Propulsion Evolution* — [enginehistory.org](https://enginehistory.org/Rockets/RPE09.45/RPE09.45.shtml) (secondary) | RCS 16 × 100 lbf |
| S9 | Space1 artifacts, *Apollo SM & LM RCS Thruster* — [space1.com](https://space1.com/Artifacts/Apollo_Artifacts/SM_RCS_Thruster/sm_rcs_thruster.html) (secondary) | RCS thrust |
| S10 | LOLA 5 m/px South Pole DEMs — [pgda.gsfc.nasa.gov/data/LOLA_5mpp](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/). Cite Barker et al. 2021, PSS 203, 105119 | Terrain |
| S11 | NASA 3D Resources — [github.com/nasa/NASA-3D-Resources](https://github.com/nasa/NASA-3D-Resources) | LM 3D model |

| S12 | Grumman, *Apollo Operations Handbook — Lunar Module, Vol. I Subsystems Data*, LMA790-3-LM (Sep 1969 rev.) — [archive.org](https://archive.org/details/apollo-operations-handbook-lunar-module-vol-1-sep-69) (OCR text) | RCS thrust, pulse mode, ACA, AGS rate limits, P63–P66 program definitions |
| S13 | Apollo 11 LM flight software *Luminary099*, `LUNAR_LANDING_GUIDANCE_EQUATIONS.agc` — [github.com/chrislgarry/Apollo-11](https://github.com/chrislgarry/Apollo-11/blob/master/Luminary099/LUNAR_LANDING_GUIDANCE_EQUATIONS.agc) | LPD redesignation increments |

Still wanted: the full text of R-695, the Luminary099 DAP constants (ACA scaling, minimum impulse), and the NSSDC Moon fact sheet (it timed out during Phase 0).
