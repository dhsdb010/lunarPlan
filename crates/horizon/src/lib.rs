//! Engine-neutral terrain self-shadowing for lunarPlan (gate P1-0d, criterion H1).
//!
//! A seed fixes the sun (South Pole sun moves < 0.1 deg during a landing), so instead of storing
//! horizons for every azimuth we bake one *sun horizon map* per seed at load time: for each DEM
//! sample, the steepest terrain slope seen toward the sun. A sample is in terrain shadow when that
//! slope exceeds tan(sun elevation).
//!
//! Determinism: no transcendental functions. The caller passes the sun's horizontal unit vector
//! and tan(elevation) as stored in the seed record, so native, WASM and the SpacetimeDB module
//! agree bit-for-bit.
//!
//! Conventions match the renderer's terrain mesh (spikes/engine/src/threeScene.ts): heights are
//! row-major `h[row * n + col]`, x = col * spacing, z = row * spacing, and each cell is split into
//! triangles (a, c, b) and (b, c, d) along the b-c diagonal.

pub struct Dem<'a> {
    pub h: &'a [f32],
    pub n: usize,
    pub spacing: f32,
}

impl<'a> Dem<'a> {
    pub fn new(h: &'a [f32], n: usize, spacing: f32) -> Self {
        assert_eq!(h.len(), n * n);
        Dem { h, n, spacing }
    }

    /// Height at tile-local metres, interpolated exactly like the GPU mesh. None outside the DEM.
    #[inline]
    pub fn height(&self, x: f32, z: f32) -> Option<f32> {
        let fx = x / self.spacing;
        let fz = z / self.spacing;
        let max = (self.n - 1) as f32;
        if !(fx >= 0.0 && fz >= 0.0 && fx <= max && fz <= max) {
            return None;
        }
        let i = (fx as usize).min(self.n - 2);
        let j = (fz as usize).min(self.n - 2);
        let u = fx - i as f32;
        let v = fz - j as f32;
        let n = self.n;
        let a = self.h[j * n + i];
        let b = self.h[j * n + i + 1];
        let c = self.h[(j + 1) * n + i];
        let d = self.h[(j + 1) * n + i + 1];
        Some(if u + v <= 1.0 {
            a + (b - a) * u + (c - a) * v
        } else {
            d + (c - d) * (1.0 - u) + (b - d) * (1.0 - v)
        })
    }
}

/// Sun direction for one seed: horizontal unit vector toward the sun and tan(elevation).
#[derive(Clone, Copy)]
pub struct Sun {
    pub ux: f32,
    pub uz: f32,
    pub tan_el: f32,
}

/// Region of DEM samples to bake (col, row, width, height).
#[derive(Clone, Copy)]
pub struct Roi {
    pub x0: usize,
    pub y0: usize,
    pub w: usize,
    pub h: usize,
}

/// Steepest slope toward the sun from sample (col,row) and the distance where it occurs.
/// March with geometric steps: ds = max(min_step, s * growth). Marches at most `max_dist` metres.
#[inline]
pub fn horizon_at(dem: &Dem, col: usize, row: usize, sun: Sun, max_dist: f32, min_step: f32, growth: f32) -> (f32, f32) {
    let x0 = col as f32 * dem.spacing;
    let z0 = row as f32 * dem.spacing;
    let h0 = dem.h[row * dem.n + col];
    let mut best = f32::NEG_INFINITY;
    let mut best_s = 0.0f32;
    let mut s = min_step;
    while s <= max_dist {
        match dem.height(x0 + sun.ux * s, z0 + sun.uz * s) {
            Some(h) => {
                let slope = (h - h0) / s;
                if slope > best {
                    best = slope;
                    best_s = s;
                }
            }
            None => break, // left the DEM: no more occluders
        }
        let ds = s * growth;
        s += if ds > min_step { ds } else { min_step };
    }
    (best, best_s)
}

/// Bake the sun horizon slope for every sample in `roi` (row-major in the ROI).
pub fn bake(dem: &Dem, roi: Roi, sun: Sun, max_dist: f32, min_step: f32, growth: f32, out_slope: &mut [f32]) {
    assert_eq!(out_slope.len(), roi.w * roi.h);
    for r in 0..roi.h {
        for c in 0..roi.w {
            out_slope[r * roi.w + c] = horizon_at(dem, roi.x0 + c, roi.y0 + r, sun, max_dist, min_step, growth).0;
        }
    }
}

/// Shadow factor in [0,1] with a soft edge over the solar disc (0.53 deg): `pen` is the slope
/// width of the penumbra (~tan(0.265 deg) * 2 near the horizon). 1 = fully lit.
#[inline]
pub fn lit(slope: f32, tan_el: f32, pen: f32) -> f32 {
    let t = (tan_el - slope) / pen + 0.5;
    if t <= 0.0 { 0.0 } else if t >= 1.0 { 1.0 } else { t }
}

// ---- WASM ABI (no wasm-bindgen: plain exports over linear memory) ----

#[no_mangle]
pub extern "C" fn hz_alloc_f32(len: usize) -> *mut f32 {
    let mut v = vec![0.0f32; len];
    let p = v.as_mut_ptr();
    core::mem::forget(v);
    p
}

/// # Safety
/// `h` must point to n*n f32s and `out` to w*h f32s, both allocated with `hz_alloc_f32`.
#[no_mangle]
pub unsafe extern "C" fn hz_bake(
    h: *const f32, n: usize, spacing: f32,
    ux: f32, uz: f32, tan_el: f32,
    x0: usize, y0: usize, w: usize, hh: usize,
    max_dist: f32, min_step: f32, growth: f32,
    out: *mut f32,
) {
    let dem = Dem::new(core::slice::from_raw_parts(h, n * n), n, spacing);
    let out = core::slice::from_raw_parts_mut(out, w * hh);
    bake(&dem, Roi { x0, y0, w, h: hh }, Sun { ux, uz, tan_el }, max_dist, min_step, growth, out);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_ground_is_lit_and_a_wall_casts_a_shadow() {
        let n = 64;
        let mut h = vec![0.0f32; n * n];
        for r in 0..n { for c in 40..n { h[r * n + c] = 50.0; } } // 50 m cliff to the +x side
        let dem = Dem::new(&h, n, 5.0);
        let sun = Sun { ux: 1.0, uz: 0.0, tan_el: 0.176 }; // sun toward +x at 10 deg
        // 10 cells (50 m) from the cliff: cliff subtends atan(50/50) = 45 deg > 10 deg -> shadow
        let (s, d) = horizon_at(&dem, 30, 10, sun, 1e5, 2.5, 0.015);
        assert!(s > sun.tan_el && d > 40.0 && d < 60.0);
        // on top of the cliff, nothing higher toward the sun -> lit
        let (s, _) = horizon_at(&dem, 50, 10, sun, 1e5, 2.5, 0.015);
        assert!(s <= sun.tan_el);
    }

    #[test]
    fn mesh_interpolation_matches_vertices() {
        let n = 3;
        let h = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
        let dem = Dem::new(&h, n, 5.0);
        assert_eq!(dem.height(5.0, 5.0), Some(4.0));
        assert_eq!(dem.height(10.0, 10.0), Some(8.0));
        assert_eq!(dem.height(-0.1, 0.0), None);
    }
}
