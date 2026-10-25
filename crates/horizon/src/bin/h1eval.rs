//! H1 evaluation (gate P1-0d): baked sun horizon vs a fine fixed-step ray-march over the full DEM.
//!
//! usage: h1eval <dem.f32> <n> <spacing_m> [growth] [min_step_m]
//! Prints one JSON line per (roi, elevation, azimuth).
use horizon::{bake, horizon_at, Dem, Roi, Sun};
use std::time::Instant;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let n: usize = a[2].parse().unwrap();
    let spacing: f32 = a[3].parse().unwrap();
    let growth: f32 = a.get(4).map(|s| s.parse().unwrap()).unwrap_or(0.015);
    let min_step: f32 = a.get(5).map(|s| s.parse().unwrap()).unwrap_or(spacing * 0.5);
    let bytes = std::fs::read(&a[1]).unwrap();
    let h: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let dem = Dem::new(&h, n, spacing);
    let max_dist = n as f32 * spacing * 1.5;

    // gameplay tile (spikes/engine/public/terrain/shackleton_rim_2km.json window) and a central 4 km block
    let rois = [("tile2km", Roi { x0: 0, y0: 900, w: 401, h: 401 }), ("center4km", Roi { x0: 1200, y0: 1200, w: 801, h: 801 })];
    let stride = 4;
    for (name, roi) in rois {
        for el_deg in [1.0f64, 3.0, 5.0, 10.0] {
            for az_deg in [0.0f64, 90.0, 200.0, 270.0] {
                let (az, el) = (az_deg.to_radians(), el_deg.to_radians());
                let sun = Sun { ux: az.sin() as f32, uz: az.cos() as f32, tan_el: el.tan() as f32 };

                // cost: full-resolution bake of the ROI
                let mut out = vec![0.0f32; roi.w * roi.h];
                let t0 = Instant::now();
                bake(&dem, roi, sun, max_dist, min_step, growth, &mut out);
                let bake_ms = t0.elapsed().as_secs_f64() * 1e3;

                // accuracy on a strided subset vs a fine reference (step = spacing / 2, no growth)
                let (mut n_all, mut agree_all, mut n_face, mut agree_face, mut far_n, mut far_caught) = (0u32, 0u32, 0u32, 0u32, 0u32, 0u32);
                for r in (0..roi.h).step_by(stride) {
                    for c in (0..roi.w).step_by(stride) {
                        let (col, row) = (roi.x0 + c, roi.y0 + r);
                        let (ref_slope, ref_d) = horizon_at(&dem, col, row, sun, max_dist, spacing * 0.5, 0.0);
                        let ref_shadow = ref_slope > sun.tan_el;
                        let got_shadow = out[r * roi.w + c] > sun.tan_el;
                        n_all += 1;
                        agree_all += (ref_shadow == got_shadow) as u32;
                        // sun-facing samples (local slope toward the sun below the sun line)
                        let x = col as f32 * spacing;
                        let z = row as f32 * spacing;
                        if let (Some(hp), Some(hm)) = (dem.height(x + sun.ux * spacing, z + sun.uz * spacing), dem.height(x - sun.ux * spacing, z - sun.uz * spacing)) {
                            if (hp - hm) / (2.0 * spacing) < sun.tan_el {
                                n_face += 1;
                                agree_face += (ref_shadow == got_shadow) as u32;
                            }
                        }
                        if ref_shadow && ref_d >= 5000.0 {
                            far_n += 1;
                            far_caught += got_shadow as u32;
                        }
                    }
                }
                let pct = |a: u32, b: u32| if b == 0 { -1.0 } else { 100.0 * a as f64 / b as f64 };
                println!(
                    "{{\"roi\":\"{name}\",\"el\":{el_deg},\"az\":{az_deg},\"samples\":{n_all},\"agreePct\":{:.3},\"sunFacing\":{n_face},\"agreeSunFacingPct\":{:.3},\"farRidge\":{far_n},\"farCaughtPct\":{:.2},\"bakeMs\":{:.1},\"bakeSamples\":{}}}",
                    pct(agree_all, n_all), pct(agree_face, n_face), pct(far_caught, far_n), bake_ms, roi.w * roi.h
                );
            }
        }
    }
}
