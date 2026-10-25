//! lunarPlan flight core: deterministic Apollo LM P66 "Final Approach" landing sim.
//!
//! The browser (WASM) and the verifier worker run this exact code on the same input log, so a
//! score can be re-derived bit-for-bit. Determinism rules (PLAN §7): scalar f64 only, no
//! transcendental functions from the platform (our own polynomial `sin`), `sqrt` only (IEEE exact).
//!
//! Numbers come from docs/spec/01-lm-vehicle.md and 02-descent-profile.md; scoring from
//! docs/decisions/002-scoring-rules.md.

pub const DT: f64 = 1.0 / 120.0; // fixed 120 Hz step
pub const G_MOON: f64 = 1.62;
pub const T_RATED: f64 = 46_710.0; // DPS 10,500 lbf
pub const THR_MIN: f64 = 0.10;
pub const THR_MAX_OP: f64 = 0.65; // 65-92.5 % is a non-operating region
pub const ISP: f64 = 305.0;
pub const G0: f64 = 9.80665;
pub const DRY_MASS: f64 = 6_900.0; // LM minus remaining DPS propellant (hover ~26 % throttle, spec 01 §3)
pub const PROP0: f64 = 700.0;
pub const LOW_LEVEL_KG: f64 = 461.9; // 5.6 % of 8,248 kg
pub const HOVER_FLOW: f64 = 4.05; // kg/s, decision 002 §3
pub const PROBE_M: f64 = 1.73;
pub const PAD_R: f64 = 4.256;
pub const FT: f64 = 0.3048;
pub const ATT_RATE: f64 = 5.0 * PI / 180.0; // RHC rate command
pub const ATT_MAX: f64 = 20.0 * PI / 180.0;
pub const ROD_STEP: f64 = 1.0 * FT; // 1 ft/s per click
pub const ROD_MIN_STEPS: u32 = 30; // <= 4 clicks/s (decision 002 input cap)
pub const MAX_STEPS: u32 = 120 * 300;
const PI: f64 = 3.141592653589793;

/// RCS translation (TTCA): 2 x 100 lbf jets per axis direction (spec 01 §4).
pub const RCS_PAIR_N: f64 = 2.0 * 445.0;

// input bits (u16). RHC = rotation, TTCA = RCS translation, ROD switch, ENGINE STOP.
pub const PITCH_UP: u16 = 1;
pub const PITCH_DN: u16 = 2;
pub const ROLL_L: u16 = 4;
pub const ROLL_R: u16 = 8;
pub const ROD_UP: u16 = 16;
pub const ROD_DN: u16 = 32;
pub const ENGINE_STOP: u16 = 64;
pub const YAW_L: u16 = 128;
pub const YAW_R: u16 = 256;
pub const TR_FWD: u16 = 512;
pub const TR_AFT: u16 = 1024;
pub const TR_LEFT: u16 = 2048;
pub const TR_RIGHT: u16 = 4096;

/// Deterministic sine on [-pi/2, pi/2] (odd Taylor polynomial, |err| < 4e-6 at the ends).
fn sin_core(x: f64) -> f64 {
    let x2 = x * x;
    x * (1.0 - x2 / 6.0 * (1.0 - x2 / 20.0 * (1.0 - x2 / 42.0 * (1.0 - x2 / 72.0 * (1.0 - x2 / 110.0)))))
}
/// Deterministic sine for any angle: range-reduce with basic f64 ops only.
pub fn dsin(x: f64) -> f64 {
    let two_pi = 2.0 * PI;
    let mut a = x - two_pi * ((x / two_pi) + 0.5).floor(); // [-pi, pi)
    if a > PI / 2.0 { a = PI - a; } else if a < -PI / 2.0 { a = -PI - a; }
    sin_core(a)
}
pub fn dcos(x: f64) -> f64 { dsin(x + PI / 2.0) }

struct Rng(u32);
impl Rng {
    fn next(&mut self) -> f64 {
        // xorshift32, mapped to [0,1)
        let mut x = self.0;
        x ^= x << 13; x ^= x >> 17; x ^= x << 5;
        self.0 = x;
        x as f64 / 4_294_967_296.0
    }
}

pub struct Terrain { h: Vec<f32>, n: usize, spacing: f64 }
impl Terrain {
    pub fn new(h: Vec<f32>, n: usize, spacing: f64) -> Self { Terrain { h, n, spacing } }
    /// Height exactly as the render mesh draws it (b-c diagonal split).
    pub fn height(&self, x: f64, z: f64) -> f64 {
        let max = (self.n - 1) as f64 - 1e-6;
        let fx = (x / self.spacing).max(0.0).min(max);
        let fz = (z / self.spacing).max(0.0).min(max);
        let i = fx as usize; let j = fz as usize;
        let u = fx - i as f64; let v = fz - j as f64;
        let n = self.n; let h = &self.h;
        let a = h[j * n + i] as f64; let b = h[j * n + i + 1] as f64;
        let c = h[(j + 1) * n + i] as f64; let d = h[(j + 1) * n + i + 1] as f64;
        if u + v <= 1.0 { a + (b - a) * u + (c - a) * v } else { d + (c - d) * (1.0 - u) + (b - d) * (1.0 - v) }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Status { Flying = 0, Landed = 1, Ended = 2 }

pub struct Sim {
    pub terrain: Terrain,
    pub step: u32,
    pub pos: [f64; 3], pub vel: [f64; 3],
    pub pitch: f64, pub roll: f64, pub yaw: f64, pub pitch_rate: f64, pub roll_rate: f64,
    pub throttle: f64, pub prop: f64, pub vz_cmd: f64,
    pub engine_on: bool, pub contact_light: bool, pub low_level_step: Option<u32>,
    pub contact_step: Option<u32>, pub stop_step: Option<u32>, pub vv_at_cl: f64,
    pub last_bits: u16, pub last_rod_step: u32,
    pub target: [f64; 2], pub sun_az_deg: f64, pub sun_el_deg: f64,
    pub status: Status, pub result: Option<Outcome>,
}

#[derive(Clone, Copy, Default)]
pub struct Outcome {
    pub tier: u8,          // 0 NO-GO, 1 GO, 2 EAGLE
    pub reason: u8,        // first failed rule (0 none)
    pub margin_s: f64,     // hover margin, s
    pub dist_m: f64,
    pub vv_fts: f64, pub vh_fts: f64, pub att_deg: f64, pub slope_grad: f64,
    pub vv_cl_fts: f64, pub probe_stop: bool,
}

impl Sim {
    pub fn new(seed: u32, terrain: Terrain) -> Sim {
        let mut r = Rng(seed.wrapping_mul(2_654_435_761).wrapping_add(0x9e37_79b9) | 1);
        let c = terrain.spacing * (terrain.n - 1) as f64 / 2.0;
        let target = [c + (r.next() - 0.5) * 200.0, c + (r.next() - 0.5) * 200.0];
        // start ~60-140 m from the target, drifting roughly toward it at 2-6 m/s
        let dist = 60.0 + r.next() * 80.0;
        // direction without trig: a unit vector from two normalised uniforms
        let (mut dx, mut dz) = (r.next() - 0.5, r.next() - 0.5);
        let l = (dx * dx + dz * dz).sqrt().max(1e-6); dx /= l; dz /= l;
        let start = [target[0] - dx * dist, target[1] - dz * dist];
        let speed = 2.0 + r.next() * 4.0;
        let lat = (r.next() - 0.5) * 2.0;
        let vel = [dx * speed - dz * lat, -1.0 * FT * 10.0, dz * speed + dx * lat];
        let ground = terrain.height(target[0], target[1]);
        let sun_az_deg = r.next() * 360.0;
        let sun_el_deg = 1.5 + r.next() * 4.5; // South Pole: 1.5-6 deg
        Sim {
            pos: [start[0], ground + 150.0, start[1]], vel,
            pitch: 0.0, roll: 0.0, yaw: 0.0, pitch_rate: 0.0, roll_rate: 0.0,
            throttle: 0.264, prop: PROP0, vz_cmd: vel[1],
            engine_on: true, contact_light: false, low_level_step: None,
            contact_step: None, stop_step: None, vv_at_cl: 0.0,
            last_bits: 0, last_rod_step: 0,
            target, sun_az_deg, sun_el_deg,
            status: Status::Flying, result: None, step: 0, terrain,
        }
    }

    fn pads(&self) -> [[f64; 2]; 4] {
        let [x, _, z] = self.pos;
        [[x + PAD_R, z], [x - PAD_R, z], [x, z + PAD_R], [x, z - PAD_R]]
    }

    /// Lowest pad clearance above terrain (m). pos[1] is the footpad plane.
    pub fn agl(&self) -> f64 {
        self.pads().iter().map(|p| self.pos[1] - self.terrain.height(p[0], p[1])).fold(f64::INFINITY, f64::min)
    }

    pub fn mass(&self) -> f64 { DRY_MASS + self.prop }

    pub fn step(&mut self, bits: u16) -> Status {
        if self.status != Status::Flying { return self.status; }
        let rising = bits & !self.last_bits;
        self.last_bits = bits;

        // pilot inputs: RHC rate command (attitude hold when released), ROD clicks, ENGINE STOP
        self.pitch_rate = if bits & PITCH_UP != 0 { ATT_RATE } else if bits & PITCH_DN != 0 { -ATT_RATE } else { 0.0 };
        self.roll_rate = if bits & ROLL_R != 0 { ATT_RATE } else if bits & ROLL_L != 0 { -ATT_RATE } else { 0.0 };
        if rising & (ROD_UP | ROD_DN) != 0 && self.step >= self.last_rod_step + ROD_MIN_STEPS {
            self.vz_cmd += if rising & ROD_UP != 0 { ROD_STEP } else { -ROD_STEP };
            self.last_rod_step = self.step;
        }
        if rising & ENGINE_STOP != 0 && self.engine_on { self.engine_on = false; self.stop_step = Some(self.step); }
        self.pitch = (self.pitch + self.pitch_rate * DT).max(-ATT_MAX).min(ATT_MAX);
        self.roll = (self.roll + self.roll_rate * DT).max(-ATT_MAX).min(ATT_MAX);
        let yaw_rate = if bits & YAW_R != 0 { ATT_RATE } else if bits & YAW_L != 0 { -ATT_RATE } else { 0.0 };
        self.yaw += yaw_rate * DT;

        // body axes on the ground plane: forward f = (sin yaw, cos yaw), right r = (cos yaw, -sin yaw)
        let (sy, cy) = (dsin(self.yaw), dcos(self.yaw));
        // thrust direction (body up): tilt toward body right by roll, body forward by pitch
        let tr = dsin(self.roll);
        let tf = dsin(self.pitch);
        let ux = tr * cy + tf * sy;
        let uz = -tr * sy + tf * cy;
        let uy = (1.0 - tr * tr - tf * tf).sqrt();

        // P66 auto-throttle holds the commanded rate of descent; first-order engine lag 0.2 s
        let m = self.mass();
        let mut thr_cmd = 0.0;
        if self.engine_on && self.prop > 0.0 {
            let a_req = (G_MOON + 1.0 * (self.vz_cmd - self.vel[1])) / uy;
            thr_cmd = (m * a_req / T_RATED).max(THR_MIN).min(THR_MAX_OP);
        }
        self.throttle += (thr_cmd - self.throttle) * (DT / 0.2);
        if !self.engine_on || self.prop <= 0.0 { self.throttle = 0.0; }
        let thrust = self.throttle * T_RATED;
        self.prop = (self.prop - thrust / (ISP * G0) * DT).max(0.0);

        // TTCA: RCS translation in the body frame (small: ~0.12 m/s^2 per axis)
        let fwd = if bits & TR_FWD != 0 { 1.0 } else if bits & TR_AFT != 0 { -1.0 } else { 0.0 };
        let rgt = if bits & TR_RIGHT != 0 { 1.0 } else if bits & TR_LEFT != 0 { -1.0 } else { 0.0 };
        let rcs = RCS_PAIR_N / m;
        let a = [thrust / m * ux + rcs * (rgt * cy + fwd * sy), thrust / m * uy - G_MOON, thrust / m * uz + rcs * (-rgt * sy + fwd * cy)];
        for k in 0..3 { self.vel[k] += a[k] * DT; self.pos[k] += self.vel[k] * DT; }
        self.step += 1;

        if self.low_level_step.is_none() && self.prop <= LOW_LEVEL_KG { self.low_level_step = Some(self.step); }
        let agl = self.agl();
        if !self.contact_light && agl <= PROBE_M {
            self.contact_light = true;
            self.contact_step = Some(self.step);
            self.vv_at_cl = -self.vel[1] / FT;
        }
        if agl <= 0.0 { self.touchdown(); return self.status; }
        // Bingo: no contact light by low-level light + 116 s (decision 002 §1)
        if let Some(ll) = self.low_level_step {
            if !self.contact_light && self.step >= ll + 116 * 120 { self.end(8); return self.status; }
        }
        if self.prop <= 0.0 && self.engine_on && !self.contact_light { self.end(7); return self.status; }
        if self.step >= MAX_STEPS { self.end(8); }
        self.status
    }

    fn end(&mut self, reason: u8) {
        self.status = Status::Ended;
        self.result = Some(Outcome { tier: 0, reason, ..Default::default() });
    }

    fn touchdown(&mut self) {
        let vv = -self.vel[1] / FT;
        let vh = (self.vel[0] * self.vel[0] + self.vel[2] * self.vel[2]).sqrt() / FT;
        let att = self.pitch.abs().max(self.roll.abs()) * 180.0 / PI;
        // plane fit through the 4 pad heights (pads on +-x and +-z axes)
        let p = self.pads();
        let h: Vec<f64> = p.iter().map(|q| self.terrain.height(q[0], q[1])).collect();
        let gx = (h[0] - h[1]) / (2.0 * PAD_R);
        let gz = (h[2] - h[3]) / (2.0 * PAD_R);
        let slope = (gx * gx + gz * gz).sqrt();
        let mean = (h[0] + h[1] + h[2] + h[3]) / 4.0;
        let bump = (h[0] - mean - gx * PAD_R).abs().max((h[1] - mean + gx * PAD_R).abs())
            .max((h[2] - mean - gz * PAD_R).abs()).max((h[3] - mean + gz * PAD_R).abs());
        let dx = self.pos[0] - self.target[0];
        let dz = self.pos[2] - self.target[1];
        let dist = (dx * dx + dz * dz).sqrt();
        let vh_lim = if vv <= 7.0 { 4.0 } else { 4.0 * (10.0 - vv) / 3.0 };
        const TAN12: f64 = 0.212_556_56; const TAN6: f64 = 0.105_104_24;
        let reason = if vv > 10.0 { 1 } else if vh > vh_lim { 2 } else if att > 6.0 { 3 }
            else if slope > TAN12 { 5 } else if bump > 0.61 { 6 } else if dist > 150.0 { 9 } else { 0 };
        let probe_stop = match (self.stop_step, self.contact_step) {
            (Some(s), Some(c)) => s >= c && s <= c + 120, // within 1.0 s of contact light, before pad contact
            _ => false,
        };
        let eagle = reason == 0 && dist <= 30.0 && slope <= TAN6 && vh <= 2.0 && att <= 3.0 && self.vv_at_cl <= 3.0 && probe_stop;
        let margin = ((self.prop / HOVER_FLOW) * 10.0) as i64 as f64 / 10.0; // floored to 0.1 s
        self.status = Status::Landed;
        self.result = Some(Outcome {
            tier: if reason != 0 { 0 } else if eagle { 2 } else { 1 },
            reason, margin_s: margin, dist_m: (dist * 10.0) as i64 as f64 / 10.0,
            vv_fts: vv, vh_fts: vh, att_deg: att, slope_grad: slope, vv_cl_fts: self.vv_at_cl, probe_stop,
        });
    }

    /// Flat state for the HUD (see STATE_* indices in web/src/flight.ts).
    pub fn state(&self, out: &mut [f64; 33]) {
        let r = self.result.unwrap_or_default();
        let bingo = match self.low_level_step { Some(ll) => (ll + 96 * 120) as f64 / 120.0 - self.step as f64 / 120.0, None => -1.0 };
        *out = [
            self.step as f64 * DT, self.pos[0], self.pos[1], self.pos[2], self.vel[0], self.vel[1], self.vel[2],
            self.pitch, self.roll, self.throttle, self.prop, self.vz_cmd, self.agl(),
            self.contact_light as u8 as f64, self.low_level_step.is_some() as u8 as f64, self.engine_on as u8 as f64,
            self.status as u8 as f64, r.tier as f64, r.margin_s, r.dist_m, r.vv_fts, r.vh_fts, r.att_deg, r.slope_grad,
            r.vv_cl_fts, r.probe_stop as u8 as f64, r.reason as f64, self.target[0], self.target[1],
            self.sun_az_deg, self.sun_el_deg, bingo, self.yaw,
        ];
    }
}

/// Input log: repeated (u16 LE steps-since-last-change, u16 LE bits). Replays to the end of the flight.
pub fn replay(seed: u32, terrain: Terrain, log: &[u8]) -> Sim {
    // each entry: run `wait` steps with the current bits, then switch to the entry's bits
    let mut sim = Sim::new(seed, terrain);
    let mut bits = 0u16;
    for e in log.chunks_exact(4) {
        let wait = u16::from_le_bytes([e[0], e[1]]);
        for _ in 0..wait { if sim.status != Status::Flying { return sim; } sim.step(bits); }
        bits = u16::from_le_bytes([e[2], e[3]]);
    }
    while sim.status == Status::Flying { sim.step(bits); }
    sim
}

// ---- WASM ABI (plain exports) ----

#[no_mangle] pub extern "C" fn fc_alloc(len: usize) -> *mut u8 { let mut v = vec![0u8; len]; let p = v.as_mut_ptr(); core::mem::forget(v); p }

/// # Safety
/// `h` points to n*n f32s.
#[no_mangle] pub unsafe extern "C" fn fc_new(seed: u32, h: *const f32, n: usize, spacing: f64) -> *mut Sim {
    let t = Terrain::new(core::slice::from_raw_parts(h, n * n).to_vec(), n, spacing);
    Box::into_raw(Box::new(Sim::new(seed, t)))
}
/// # Safety
/// `s` from fc_new.
#[no_mangle] pub unsafe extern "C" fn fc_step(s: *mut Sim, bits: u32) -> u32 { (*s).step(bits as u16) as u32 }
static mut STATE: [f64; 33] = [0.0; 33];
/// # Safety
/// `s` from fc_new. Returns a pointer to 33 f64 valid until the next call.
#[no_mangle] pub unsafe extern "C" fn fc_state(s: *const Sim) -> *const f64 {
    let p = core::ptr::addr_of_mut!(STATE);
    (*s).state(&mut *p);
    p as *const f64
}
/// # Safety
/// `s` from fc_new.
#[no_mangle] pub unsafe extern "C" fn fc_free(s: *mut Sim) { drop(Box::from_raw(s)); }
/// # Safety
/// `h` n*n f32s, `log` len bytes. Returns the final state (33 f64).
#[no_mangle] pub unsafe extern "C" fn fc_replay(seed: u32, h: *const f32, n: usize, spacing: f64, log: *const u8, len: usize) -> *const f64 {
    let t = Terrain::new(core::slice::from_raw_parts(h, n * n).to_vec(), n, spacing);
    let sim = replay(seed, t, core::slice::from_raw_parts(log, len));
    let p = core::ptr::addr_of_mut!(STATE);
    sim.state(&mut *p);
    p as *const f64
}

#[cfg(test)]
mod tests {
    use super::*;
    fn flat() -> Terrain { Terrain::new(vec![0.0; 401 * 401], 401, 5.0) }

    #[test]
    fn hover_throttle_matches_apollo_11() {
        let s = Sim::new(1, flat());
        let thr = s.mass() * G_MOON / T_RATED;
        assert!((thr - 0.264).abs() < 0.01, "hover throttle {thr}");
    }

    #[test]
    fn hands_off_descent_lands_soft_and_replay_is_deterministic() {
        // pilot: click ROD up to -3 ft/s below 30 m, ENGINE STOP on the contact light
        let mut s = Sim::new(7, flat());
        let mut log = vec![];
        let mut since = 0u16;
        let mut bits = 0u16;
        while s.status == Status::Flying {
            let click = s.agl() < 30.0 && s.vz_cmd < -3.0 * FT && (s.step / 15) % 2 == 0;
            let want = if s.contact_light { ENGINE_STOP } else if click { ROD_UP } else { 0 };
            if want != bits { log.extend_from_slice(&since.to_le_bytes()); log.extend_from_slice(&want.to_le_bytes()); bits = want; since = 0; }
            s.step(bits); since += 1;
        }
        let a = s.result.unwrap();
        let b = replay(7, flat(), &log).result.unwrap();
        assert_eq!(a.tier, b.tier);
        assert_eq!(a.margin_s.to_bits(), b.margin_s.to_bits());
        assert_eq!(a.dist_m.to_bits(), b.dist_m.to_bits());
        assert!(a.vv_fts < 10.0, "vv {}", a.vv_fts);
    }

    #[test]
    fn dsin_dcos_match_std_over_full_range() {
        let mut x = -20.0;
        while x < 20.0 {
            assert!((dsin(x) - x.sin()).abs() < 1e-5, "sin {x}");
            assert!((dcos(x) - x.cos()).abs() < 1e-5, "cos {x}");
            x += 0.0137;
        }
    }

    #[test]
    fn rcs_translation_moves_the_lm_without_tilting() {
        let mut a = Sim::new(3, flat());
        let mut b = Sim::new(3, flat());
        for _ in 0..600 { a.step(0); b.step(TR_RIGHT); }
        assert_eq!(b.roll, 0.0);
        let dvx = b.vel[0] - a.vel[0];
        assert!((dvx - RCS_PAIR_N / b.mass() * 5.0).abs() < 0.02, "dvx {dvx}"); // ~0.12 m/s^2 for 5 s
    }
}
