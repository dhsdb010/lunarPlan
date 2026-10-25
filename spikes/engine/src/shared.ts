// Engine-independent parts of the spike: params, terrain tile, LM placement,
// camera rigs and the measurement harness. Each engine implements SpikeEngine.

export const params = (() => {
  const q = new URLSearchParams(location.search);
  return {
    offsetM: Number(q.get('offset') ?? 100_000), // world X offset of the tile
    largeWorld: q.get('lw') !== '0',              // engine's precision mode on/off
    sunElDeg: Number(q.get('sun') ?? 10),
    sunAzDeg: Number(q.get('az') ?? 135),
    view: (q.get('view') ?? 'pad') as View,
    auto: q.get('auto') === '1',
    webgl: q.get('webgl') === '1',                // force WebGL2 backend
    csm: q.get('csm') !== '0',                    // cascaded shadows (else one plain shadow map)
    shadows: q.get('shadows') !== '0',
    test: (q.get('test') ?? 'precision') as 'precision' | 'shimmer',
    stepMm: Number(q.get('step') ?? 0.37),         // camera drift per step (mm)
    stab: q.get('stab') !== '0',                  // Babylon stabilizeCascades
  };
})();

export type View = 'pad' | 'chase' | 'high';
export type Vec3 = [number, number, number];

export interface Tile {
  samples: number;
  spacingM: number;
  sizeM: number;
  heights: Float32Array;
  meta: Record<string, unknown>;
}

export async function loadTile(name = 'shackleton_rim_2km'): Promise<Tile> {
  const [meta, buf] = await Promise.all([
    fetch(`terrain/${name}.json`).then((r) => r.json()),
    fetch(`terrain/${name}.f32`).then((r) => r.arrayBuffer()),
  ]);
  return { samples: meta.samples, spacingM: meta.spacing_m, sizeM: meta.size_m, heights: new Float32Array(buf), meta };
}

/** Bilinear height at tile-local (x, z) metres, origin at tile corner. */
export function heightAt(t: Tile, x: number, z: number): number {
  const fx = Math.min(Math.max(x / t.spacingM, 0), t.samples - 1.001);
  const fz = Math.min(Math.max(z / t.spacingM, 0), t.samples - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const h = (a: number, b: number) => t.heights[b * t.samples + a];
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}

/** Real LM: footpad centres 4.256 m from X-axis, pad 0.91 m -> outer span ~9.42 m. */
export const LM_SPAN_M = 2 * 4.256 + 0.91;

export function lmSite(t: Tile, offsetM: number): Vec3 {
  const x = t.sizeM / 2, z = t.sizeM / 2;
  return [offsetM + x, heightAt(t, x, z), z];
}

/** Sun direction (pointing from sun toward scene), y-up. */
export function sunDir(elDeg: number, azDeg: number): Vec3 {
  const el = (elDeg * Math.PI) / 180, az = (azDeg * Math.PI) / 180;
  return [-Math.cos(el) * Math.sin(az), -Math.sin(el), -Math.cos(el) * Math.cos(az)];
}

/** Camera eye/target for each view, relative to the LM site. `t` adds sub-mm motion for jitter tests. */
export function cameraRig(view: View, site: Vec3, t = 0, sunEl = params.sunElDeg, sunAz = params.sunAzDeg): { eye: Vec3; target: Vec3; near: number; far: number } {
  const [x, y, z] = site;
  // default 0.37 mm per step: well below a float32 ulp at 100 km (7.8 mm)
  const drift = t * params.stepMm / 1000;
  if (view === 'pad') {
    // 1 m above the +X footpad, looking at the pad and strut
    const padX = x + 4.256, padY = y;
    return { eye: [padX + 1.6 + drift, padY + 1.0, z + 1.2], target: [padX, padY + 0.4, z], near: 0.05, far: 30_000 };
  }
  if (view === 'chase') {
    // 45 m out, 90° off the sun line, so the LM's long low-sun shadow runs across the frame
    const [sx, , sz] = sunDir(sunEl, sunAz);
    const h = Math.hypot(sx, sz), ux = sx / h, uz = sz / h; // shadow direction on the ground
    const tx = x + ux * 18, tz = z + uz * 18;                // aim mid-shadow
    return { eye: [tx - uz * 45 + drift, y + 10, tz + ux * 45], target: [tx, y, tz], near: 0.1, far: 30_000 };
  }
  return { eye: [x + drift, y + 15_000, z + 2_000], target: [x, y, z], near: 10, far: 60_000 };
}

export interface SpikeEngine {
  name: string;
  backend: string;
  /** Re-place everything for a given world offset and camera step, then render one frame. */
  renderAt(offsetM: number, step: number): Promise<void>;
  canvas: HTMLCanvasElement;
  /** Pixels of the last renderAt, for engines whose canvas can't be drawImage'd (Babylon WebGPU). */
  lastPixels?: () => Promise<Uint8ClampedArray>;
  /** Resolves once shaders/materials are compiled (Babylon compiles asynchronously). */
  ready?: () => Promise<void>;
}

const capture = (e: SpikeEngine) => (e.lastPixels ? e.lastPixels() : Promise.resolve(grab(e.canvas)));

/** Copy the just-rendered frame into RGBA bytes (must be called in the same task as the render). */
export function grab(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(canvas, 0, 0);
  return g.getImageData(0, 0, c.width, c.height).data;
}

function diff(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let sum = 0, bad = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    sum += d;
    if (d > 8) bad++;
  }
  const n = a.length / 4;
  return { meanAbs: sum / n, pctOver8: (100 * bad) / n };
}

/**
 * Precision test: render the same camera-relative scene at offset 0 and at params.offsetM.
 * A perfect large-world path gives identical images (diff ~0) at every sub-mm step.
 */
export async function precisionTest(e: SpikeEngine, steps = 24) {
  const per: { meanAbs: number; pctOver8: number }[] = [];
  for (let s = 0; s < steps; s++) {
    await e.renderAt(0, s);
    const a = await capture(e);
    await e.renderAt(params.offsetM, s);
    const b = await capture(e);
    per.push(diff(a, b));
  }
  const worst = per.reduce((m, p) => (p.pctOver8 > m.pctOver8 ? p : m));
  // sanity check that the grab saw a real frame (a blank grab would fake a perfect score)
  await e.renderAt(params.offsetM, 0);
  const g = await capture(e);
  let luma = 0;
  for (let i = 0; i < g.length; i += 4) luma += g[i];
  return { meanLuma: luma / (g.length / 4), steps, meanAbs: per.reduce((s, p) => s + p.meanAbs, 0) / steps, worstPctOver8: worst.pctOver8 };
}

/**
 * Shimmer test: fly the camera at a steady speed and measure frame-to-frame change.
 * Run at 0 km and at the test offset; shimmer shows up as extra change at the offset.
 */
export async function shimmerTest(e: SpikeEngine, steps = 48) {
  const run = async (offsetM: number) => {
    const d: { meanAbs: number; pctOver8: number }[] = [];
    await e.renderAt(offsetM, 0);
    let prev = await capture(e);
    for (let s = 1; s <= steps; s++) {
      await e.renderAt(offsetM, s);
      const cur = await capture(e);
      d.push(diff(prev, cur));
      prev = cur;
    }
    const m = d.map((x) => x.meanAbs).sort((a, b) => a - b);
    return {
      meanAbs: m.reduce((a, b) => a + b, 0) / steps,
      p95Abs: m[Math.floor(steps * 0.95)],
      worstPctOver8: Math.max(...d.map((x) => x.pctOver8)),
    };
  };
  const origin = await run(0);
  const far = await run(params.offsetM);
  return { steps, stepMm: params.stepMm, origin, far, ratio: far.meanAbs / Math.max(origin.meanAbs, 1e-9) };
}

export async function frameTimeTest(e: SpikeEngine, frames = 240) {
  const dts: number[] = [];
  let last = performance.now();
  for (let i = 0; i < frames; i++) {
    await e.renderAt(params.offsetM, i);
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    dts.push(now - last);
    last = now;
  }
  dts.sort((a, b) => a - b);
  return { frames, meanMs: dts.reduce((s, d) => s + d, 0) / frames, p95Ms: dts[Math.floor(frames * 0.95)] };
}

export async function runHarness(e: SpikeEngine) {
  const hud = document.getElementById('hud')!;
  hud.textContent = `${e.name} · ${e.backend} · offset ${params.offsetM} m · large-world ${params.largeWorld} · sun ${params.sunElDeg}° · view ${params.view}`;
  await e.renderAt(params.offsetM, 0);
  await e.ready?.();
  if (!params.auto) {
    const loop = async (i = 0) => { await e.renderAt(params.offsetM, i); requestAnimationFrame(() => loop(i + 1)); };
    loop();
    return;
  }
  const w = window as unknown as { __spike: Record<string, unknown> };
  if (params.test === 'shimmer') {
    w.__spike = { engine: e.name, backend: e.backend, ...params, shimmer: await shimmerTest(e) };
    hud.textContent += '\nshimmer: ' + JSON.stringify((w.__spike as { shimmer: unknown }).shimmer);
    return;
  }
  const precision = await precisionTest(e);
  w.__spike = { engine: e.name, backend: e.backend, ...params, precision }; // rAF stalls in a hidden tab
  const frame = await frameTimeTest(e);
  await e.renderAt(params.offsetM, 0);
  const result = { ...w.__spike, frame, hidden: document.hidden };
  w.__spike = result;
  hud.textContent += `\nprecision: mean|Δ| ${precision.meanAbs.toFixed(3)}, worst ${precision.worstPctOver8.toFixed(2)}% px >8/255\nframe: ${frame.meanMs.toFixed(2)} ms mean, ${frame.p95Ms.toFixed(2)} ms p95`;
  console.log('SPIKE_RESULT', JSON.stringify(result));
}
