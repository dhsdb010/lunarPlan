// H1 in the browser: run crates/horizon (WASM) on the full Site04 DEM, check it is bit-identical to
// the native build (h1dump), time it, and draw the sun-shadow mask of the gameplay tile.

const N = 3200, SPACING = 5;
const f32 = (hex: string) => new Float32Array(new Uint32Array([parseInt(hex, 16)]).buffer)[0];
// sun at 200 deg azimuth, 3 deg elevation: f32 bits printed by the native side (see REPORT §10)
const SUN = { ux: f32('beaf1d44'), uz: f32('bf708fb2'), tanEl: f32('3d56a98a') };
const NATIVE_FNV = '384f4e95';

type Exports = {
  memory: WebAssembly.Memory;
  hz_alloc_f32(len: number): number;
  hz_bake(h: number, n: number, spacing: number, ux: number, uz: number, tanEl: number,
    x0: number, y0: number, w: number, hh: number, maxDist: number, minStep: number, growth: number, out: number): void;
};

function fnv1a(bytes: Uint8Array) {
  let h = 0x811c9dc5;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

async function main() {
  const hud = document.getElementById('hud')!;
  const [wasm, dem] = await Promise.all([
    WebAssembly.instantiateStreaming(fetch('wasm/horizon.wasm')),
    fetch('terrain/Site04_surf_3200.f32').then((r) => r.arrayBuffer()),
  ]);
  const x = wasm.instance.exports as unknown as Exports;
  const hp = x.hz_alloc_f32(N * N);
  new Float32Array(x.memory.buffer, hp, N * N).set(new Float32Array(dem));

  const runs: Record<string, unknown>[] = [];
  let mask: Float32Array | null = null;
  for (const [name, x0, y0, w] of [['tile2km', 0, 900, 401], ['center4km', 1200, 1200, 801]] as const) {
    const out = x.hz_alloc_f32(w * w);
    const t0 = performance.now();
    x.hz_bake(hp, N, SPACING, SUN.ux, SUN.uz, SUN.tanEl, x0, y0, w, w, N * SPACING * 1.5, SPACING * 0.5, 0.015, out);
    const ms = performance.now() - t0;
    const slopes = new Float32Array(x.memory.buffer, out, w * w);
    const row: Record<string, unknown> = { roi: name, samples: w * w, wasmMs: Math.round(ms) };
    if (name === 'tile2km') {
      row.fnv1a = fnv1a(new Uint8Array(x.memory.buffer, out, w * w * 4));
      row.bitIdenticalToNative = row.fnv1a === NATIVE_FNV;
      mask = slopes.slice();
    }
    runs.push(row);
  }
  (window as unknown as { __h1: unknown }).__h1 = { runs, done: true };
  hud.textContent = JSON.stringify(runs, null, 1);

  // draw the tile's terrain-shadow mask (white = lit by the 3 deg sun)
  const c = document.getElementById('c') as HTMLCanvasElement;
  c.width = c.height = 401;
  const g = c.getContext('2d')!, img = g.createImageData(401, 401);
  for (let i = 0; i < 401 * 401; i++) {
    const v = mask![i] > SUN.tanEl ? 25 : 230;
    img.data.set([v, v, v, 255], i * 4);
  }
  g.putImageData(img, 0, 0);
}

main();
