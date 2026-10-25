//! Determinism check: bake one ROI natively and print an FNV-1a hash of the f32 output bytes, so
//! the browser's WASM bake (spikes/engine/horizon.html) can be compared bit-for-bit.
//!
//! usage: h1dump <dem.f32> <n> <spacing> <ux_bits> <uz_bits> <tan_el_bits> <x0> <y0> <w> <h>
use horizon::{bake, Dem, Roi, Sun};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let p = |i: usize| a[i].parse::<usize>().unwrap();
    let bits = |i: usize| f32::from_bits(u32::from_str_radix(&a[i], 16).unwrap());
    let n = p(2);
    let spacing: f32 = a[3].parse().unwrap();
    let bytes = std::fs::read(&a[1]).unwrap();
    let h: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let dem = Dem::new(&h, n, spacing);
    let roi = Roi { x0: p(7), y0: p(8), w: p(9), h: p(10) };
    let mut out = vec![0.0f32; roi.w * roi.h];
    bake(&dem, roi, Sun { ux: bits(4), uz: bits(5), tan_el: bits(6) }, n as f32 * spacing * 1.5, spacing * 0.5, 0.015, &mut out);
    let mut hash: u32 = 0x811c9dc5;
    for v in &out {
        for b in v.to_le_bytes() {
            hash ^= b as u32;
            hash = hash.wrapping_mul(0x01000193);
        }
    }
    println!("{{\"fnv1a\":\"{hash:08x}\",\"samples\":{}}}", out.len());
}
