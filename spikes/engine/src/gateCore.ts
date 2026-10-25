// Gate P1-0d core (REPORT §9, protocol §11): engine-agnostic metrics A1, A2, C1, R1 with CPU ground truth.
// Each engine adapter supplies rays, frames and its own world-space caster triangles, all in a
// "ground-truth space" related to the tile by a pure translation (toLocal).
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import type { Tile, View } from './shared';

(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: unknown }).computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const q = new URLSearchParams(location.search);
export const OFFSET = Number(q.get('offset') ?? 100_000);
/** Fixed render size for both engines: same pixel count, and independent of the pane being visible. */
export const GATE_SIZE: [number, number] = [1110, 622];
const STRIDE = Number(q.get('stride') ?? 4);
const PAD_RADIUS_M = 0.455, CONTACT_RING_M = 1.0, TOL_PX = 2;
const CLEARANCE_M = 0.5, CLEARANCE_RAD = 0.02;
const SUB = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]] as const;

export interface GateEngine {
  name: string;
  backend: string;
  tile: Tile;
  setSun(el: number, az: number): void;
  /** Unit vector toward the sun, in ground-truth space. */
  sunL(): THREE.Vector3;
  setShadowIntensity(v: 0 | 1): void;
  setCasterVisible(lm: boolean, rocks: boolean): void;
  /** Lay out the view, render one frame (shadow maps current), return the view's far plane. */
  frame(view: View): number;
  /** RGBA of the frame just rendered (same task). */
  grab(): Uint8ClampedArray;
  width(): number;
  height(): number;
  /** Ray through sub-pixel (x + jx, y + jy) in ground-truth space. */
  ray(x: number, y: number, jx: number, jy: number): { o: THREE.Vector3; d: THREE.Vector3 };
  /** Ground-truth space -> tile-local metres (pure translation). */
  toLocal(v: THREE.Vector3): [number, number, number];
  /** World-space caster triangles for CPU raycasts (BVH built), refreshed after frame(). */
  casters(): { lm: THREE.Object3D; rocks: THREE.Object3D };
  dispose(): void;
}

// ---------- terrain ground truth (triangle-exact, same split as both engines' meshes) ----------

export function heightAt(t: Tile, x: number, z: number): number {
  const fx = Math.min(Math.max(x / t.spacingM, 0), t.samples - 1.000001);
  const fz = Math.min(Math.max(z / t.spacingM, 0), t.samples - 1.000001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const n = t.samples, h = t.heights;
  const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
const inside = (t: Tile, x: number, z: number) => x >= 0 && z >= 0 && x <= t.sizeM && z <= t.sizeM;

const slopeCache = new WeakMap<Tile, { smax: number; top: number }>();
/** Max |gradient| over the tile's triangles (Lipschitz bound for safe ray stepping) and max height. */
function tileBounds(t: Tile) {
  let b = slopeCache.get(t);
  if (!b) {
    const n = t.samples, h = t.heights; let smax = 0, top = -Infinity;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const v = h[j * n + i]; top = Math.max(top, v);
      if (i + 1 < n) smax = Math.max(smax, Math.abs(h[j * n + i + 1] - v) / t.spacingM);
      if (j + 1 < n) smax = Math.max(smax, Math.abs(h[(j + 1) * n + i] - v) / t.spacingM);
      if (i + 1 < n && j + 1 < n) smax = Math.max(smax, Math.abs(h[(j + 1) * n + i] - h[j * n + i + 1]) / t.spacingM);
    }
    b = { smax: smax * 1.5, top }; // 1.5x margin: triangle gradients combine edge slopes
    slopeCache.set(t, b);
  }
  return b;
}

/**
 * Exact heightfield hit along a ray (tile-local). Lipschitz-safe sphere tracing: with clearance c
 * above the terrain, the ray cannot reach it within c / (|dy| + Smax * |dxz|), so that step is safe.
 */
export function marchTerrain(t: Tile, o: number[], d: THREE.Vector3, far: number) {
  const { smax, top } = tileBounds(t);
  const hz = Math.hypot(d.x, d.z), rate = Math.abs(d.y) + smax * hz;
  let s = 0.02;
  for (let it = 0; it < 4000 && s < far; it++) {
    const x = o[0] + d.x * s, y = o[1] + d.y * s, z = o[2] + d.z * s;
    if (!inside(t, x, z)) return null; // cameras start inside the tile, so leaving it is final
    if (y > top + 1 && d.y >= 0) return null;
    const c = y - heightAt(t, x, z);
    if (c <= 0) {
      let a = Math.max(0, s - 0.05), b = s;
      const f = (u: number) => o[1] + d.y * u - heightAt(t, o[0] + d.x * u, o[2] + d.z * u);
      if (f(a) <= 0) a = 0;
      for (let k = 0; k < 24; k++) { const m = (a + b) / 2; if (f(m) > 0) a = m; else b = m; }
      const sh = (a + b) / 2;
      return { s: sh, local: [o[0] + d.x * sh, o[1] + d.y * sh, o[2] + d.z * sh] };
    }
    s += Math.max(0.002, c / rate);
  }
  return null;
}

function terrainNormal(t: Tile, x: number, z: number) {
  const e = t.spacingM / 2;
  const dx = (heightAt(t, x + e, z) - heightAt(t, x - e, z)) / (2 * e);
  const dz = (heightAt(t, x, z + e) - heightAt(t, x, z - e)) / (2 * e);
  return new THREE.Vector3(-dx, 1, -dz).normalize();
}

export function sunClear(t: Tile, p: number[], L: THREE.Vector3) {
  const top = (t.meta.relief_m as number) + 5;
  for (let s = 0.05; s < 6000; s += Math.max(0.05, s * 0.02)) {
    const x = p[0] + L.x * s, y = p[1] + L.y * s, z = p[2] + L.z * s;
    if (!inside(t, x, z) || y > top) return true;
    if (y - heightAt(t, x, z) < Math.min(CLEARANCE_M, CLEARANCE_RAD * s)) return false;
  }
  return true;
}

// ---------- caster ground truth (BVH) ----------

const rc = new THREE.Raycaster();
(rc as unknown as { firstHitOnly: boolean }).firstHitOnly = true;
const nm = new THREE.Matrix3();
export function castHit(objs: THREE.Object3D[], o: THREE.Vector3, d: THREE.Vector3, far = Infinity) {
  rc.set(o, d); rc.far = far;
  let best: THREE.Intersection | null = null;
  for (const ob of objs) { const h = rc.intersectObject(ob, true)[0]; if (h && (!best || h.distance < best.distance)) best = h; }
  return best;
}
function hitNormal(h: THREE.Intersection, d: THREE.Vector3) {
  const N = h.face!.normal.clone().applyMatrix3(nm.getNormalMatrix(h.object.matrixWorld)).normalize();
  if (N.dot(d) > 0) N.negate(); // open shells / double-sided parts: the side facing the camera
  return N;
}
const isIn = (o: THREE.Object3D, root: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true; return false; };

/** Footpad centres (ground-truth space): lowest LM vertices clustered into 4 legs by angle. */
function footpads(lm: THREE.Object3D) {
  lm.updateMatrixWorld(true);
  const pts: THREE.Vector3[] = []; let minY = Infinity;
  lm.traverse((c) => {
    const m = c as THREE.Mesh; if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) { const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); pts.push(v); minY = Math.min(minY, v.y); }
  });
  const low = pts.filter((v) => v.y < minY + 0.25);
  const c = low.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(low.length);
  const ang = low.map((v) => ({ v, a: Math.atan2(v.z - c.z, v.x - c.x) })).sort((a, b) => a.a - b.a);
  const gaps = ang.map((p, i) => ({ i, g: (i + 1 < ang.length ? ang[i + 1].a : ang[0].a + 2 * Math.PI) - p.a }));
  const cuts = gaps.sort((a, b) => b.g - a.g).slice(0, 4).map((g) => g.i).sort((a, b) => a - b);
  const pads: THREE.Vector3[] = [];
  for (let k = 0; k < 4; k++) {
    const from = cuts[k] + 1, to = cuts[(k + 1) % 4];
    const grp = from <= to ? ang.slice(from, to + 1) : [...ang.slice(from), ...ang.slice(0, to + 1)];
    pads.push(grp.reduce((a, p) => a.add(p.v), new THREE.Vector3()).divideScalar(grp.length));
  }
  return pads;
}

// ---------- helpers ----------

const luma = (p: Uint8ClampedArray, i: number) => (p[i] + p[i + 1] + p[i + 2]) / 3;
const ch = new MessageChannel(); const waiters: (() => void)[] = [];
ch.port1.onmessage = () => waiters.shift()?.();
export const tick = () => new Promise<void>((r) => { waiters.push(r); ch.port2.postMessage(0); });

function shot(e: GateEngine, view: View) { e.frame(view); const far = e.frame(view); return { far, px: e.grab() }; }

function* pixels(e: GateEngine) {
  const W = e.width(), H = e.height();
  for (let y = STRIDE >> 1; y < H; y += STRIDE) for (let x = STRIDE >> 1; x < W; x += STRIDE) yield { x, y, px: (y * W + x) * 4 };
}

function darkNear(a: Uint8ClampedArray, b: Uint8ClampedArray, i: number, W: number, thr: number) {
  const p = i / 4, x0 = p % W, y0 = Math.floor(p / W), H = a.length / 4 / W;
  for (let dy = -TOL_PX; dy <= TOL_PX; dy++) for (let dx = -TOL_PX; dx <= TOL_PX; dx++) {
    const x = x0 + dx, y = y0 + dy;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const j = (y * W + x) * 4;
    if (luma(a, j) - luma(b, j) > thr) return true;
  }
  return false;
}
const pct = (a: number, n: number) => (n ? (100 * a) / n : NaN);

// ---------- metrics: ground truth (CPU, once per sun/view) and scoring (per shadow config) ----------
// Ground truth depends only on geometry, camera and sun, so it is computed once and reused for every
// shadow configuration, each scored on a fresh engine instance (REPORT §11).

const sunOK = (e: GateEngine, local: number[], L: THREE.Vector3) => sunClear(e.tile, local, L);

/** Ray mapping check: pixels whose 5 sub-rays all hit the LM must change when it is hidden; caster-free pixels must not. */
export async function gtRay(e: GateEngine, view: View) {
  const far = e.frame(view); const { lm, rocks } = e.casters();
  const inPx: number[] = [], outPx: number[] = []; let k = 0;
  for (const p of pixels(e)) {
    if (++k % 1500 === 0) await tick();
    let all = 0, none = 0;
    for (const [jx, jy] of SUB) {
      const r = e.ray(p.x, p.y, jx, jy); const h = castHit([lm, rocks], r.o, r.d, far);
      // LM pixels count only with terrain behind them (dark LM panels against black sky can't show a change)
      if (h && isIn(h.object, lm) && marchTerrain(e.tile, e.toLocal(r.o), r.d, far)) all++; else if (!h) none++;
    }
    if (all === 5) inPx.push(p.px); else if (none === 5) outPx.push(p.px);
  }
  return { inPx, outPx };
}
export function scoreRay(e: GateEngine, view: View, gt: { inPx: number[]; outPx: number[] }) {
  e.setShadowIntensity(0);
  e.setCasterVisible(true, true); const { px: withLM } = shot(e, view);
  e.setCasterVisible(false, true); const { px: noLM } = shot(e, view);
  e.setCasterVisible(true, true); e.setShadowIntensity(1);
  const d = (i: number) => Math.abs(luma(withLM, i) - luma(noLM, i));
  return { lmPixels: gt.inPx.length, lmChangedPct: pct(gt.inPx.filter((i) => d(i) > 2).length, gt.inPx.length), otherPixels: gt.outPx.length, otherSamePct: pct(gt.outPx.filter((i) => d(i) <= 2).length, gt.outPx.length) };
}

/** A1 ground truth: terrain pixels where all 5 sub-rays agree: sunlit (lit) or in a caster's shadow (cast, the control). */
export async function gtA1(e: GateEngine, view: View) {
  const far = e.frame(view), L = e.sunL(), cs = e.casters(), objs = [cs.lm, cs.rocks];
  const lit: number[] = [], cast: number[] = []; let k = 0;
  for (const p of pixels(e)) {
    if (++k % 1500 === 0) await tick();
    let state: 'lit' | 'cast' | null = null, ok = true;
    for (const [jx, jy] of SUB) {
      const r = e.ray(p.x, p.y, jx, jy);
      const h = marchTerrain(e.tile, e.toLocal(r.o), r.d, far);
      if (!h || terrainNormal(e.tile, h.local[0], h.local[2]).dot(L) <= 0.1) { ok = false; break; }
      if (castHit(objs, r.o, r.d, h.s) || !sunOK(e, h.local, L)) { ok = false; break; }
      const st = castHit(objs, r.o.clone().addScaledVector(r.d, h.s - 0.01), L) ? 'cast' : 'lit';
      if (state === null) state = st; else if (state !== st) { ok = false; break; } // shadow edge: ambiguous
    }
    if (ok && state) (state === 'lit' ? lit : cast).push(p.px);
  }
  return { lit, cast };
}
export function scoreA1(e: GateEngine, view: View, gt: { lit: number[]; cast: number[] }) {
  e.setCasterVisible(true, true);
  e.setShadowIntensity(1); const { px: on } = shot(e, view);
  e.setShadowIntensity(0); const { px: off } = shot(e, view);
  e.setShadowIntensity(1);
  const dk = (i: number) => luma(off, i) - luma(on, i) > 8;
  return { samples: gt.lit.length, pct: pct(gt.lit.filter(dk).length, gt.lit.length), controlSamples: gt.cast.length, controlCaughtPct: pct(gt.cast.filter(dk).length, gt.cast.length) };
}

type A2S = { px: number; self: boolean; rock: boolean };
function scoreA2Images(gt: A2S[], on: Uint8ClampedArray, off: Uint8ClampedArray) {
  let n = 0, bad = 0, nR = 0, badR = 0, ss = 0, caught = 0;
  for (const s of gt) {
    if (luma(off, s.px) < 30) continue; // too dark to judge an 8/255 drop
    const dk = luma(off, s.px) - luma(on, s.px) > 8;
    if (s.self) { ss++; if (dk) caught++; continue; }
    n++; if (dk) bad++;
    if (s.rock) { nR++; if (dk) badR++; }
  }
  return { samples: n, pct: pct(bad, n), rockSamples: nR, rockPct: pct(badR, nR), controlSamples: ss, controlCaughtPct: pct(caught, ss) };
}
/** A2 ground truth (M0 method) plus the M0 no-acne reference, scored here once (it is config-independent). */
export async function gtA2(e: GateEngine, view: View) {
  const far = e.frame(view), L = e.sunL(), cs = e.casters(), objs = [cs.lm, cs.rocks];
  const gt: A2S[] = []; let k = 0;
  for (const p of pixels(e)) {
    if (++k % 800 === 0) await tick();
    let state: boolean | null = null, rock = false, ok = true;
    for (const [jx, jy] of SUB) {
      const r = e.ray(p.x, p.y, jx, jy);
      const h = castHit(objs, r.o, r.d, far);
      if (!h || !h.face) { ok = false; break; }
      const N = hitNormal(h, r.d);
      if (N.dot(L) <= 0.1) { ok = false; break; }
      const g = marchTerrain(e.tile, e.toLocal(r.o), r.d, h.distance);
      if (g && g.s < h.distance) { ok = false; break; }
      const P = h.point.clone().addScaledVector(N, 0.005);
      if (!sunOK(e, e.toLocal(P), L)) { ok = false; break; }
      const self = !!castHit(objs, P, L);
      if (state === null) { state = self; rock = isIn(h.object, cs.rocks); } else if (state !== self) { ok = false; break; }
    }
    if (ok && state !== null) gt.push({ px: p.px, self: state, rock });
  }
  // M0 reference in this engine's geometry: CPU-shaded, 2x2 jittered, no acne by construction.
  // Its "off" luma also gates samples, so score it with the real off-frame later; here use its own.
  const W = e.width(), H = e.height();
  const ron = new Uint8ClampedArray(W * H * 4), roff = new Uint8ClampedArray(W * H * 4);
  for (const s of gt) {
    const p = s.px / 4, x = p % W, y = Math.floor(p / W);
    let sOn = 0, sOff = 0;
    for (const [jx, jy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const r = e.ray(x, y, jx, jy); const h = castHit(objs, r.o, r.d, far);
      if (!h || !h.face) { sOn += 60; sOff += 60; continue; }
      const N = hitNormal(h, r.d), ndl = Math.max(0, N.dot(L));
      const vis = castHit(objs, h.point.clone().addScaledVector(N, 0.005), L) ? 0 : 1;
      sOff += 40 + 200 * ndl; sOn += 40 + 200 * ndl * vis;
    }
    ron.fill(sOn / 4, s.px, s.px + 3); roff.fill(sOff / 4, s.px, s.px + 3);
  }
  return { samples: gt, reference: scoreA2Images(gt, ron, roff) };
}
export function scoreA2(e: GateEngine, view: View, gt: { samples: A2S[]; reference: unknown }) {
  e.setCasterVisible(true, true);
  e.setShadowIntensity(1); const { px: on } = shot(e, view);
  e.setShadowIntensity(0); const { px: off } = shot(e, view);
  e.setShadowIntensity(1);
  return { ...scoreA2Images(gt.samples, on, off), reference: gt.reference };
}

/** C1 (pad, near footpads) / R1 (chase, whole shadow): ground pixels in the LM's geometric shadow only. */
export async function gtLMShadow(e: GateEngine, view: View, nearPadsOnly: boolean) {
  const far = e.frame(view), L = e.sunL(), cs = e.casters(), pads = footpads(cs.lm);
  const px: number[] = []; let k = 0;
  for (const p of pixels(e)) {
    if (++k % 1500 === 0) await tick();
    const r = e.ray(p.x, p.y, 0.5, 0.5);
    const h = marchTerrain(e.tile, e.toLocal(r.o), r.d, far);
    if (!h) continue;
    const P = r.o.clone().addScaledVector(r.d, h.s);
    if (nearPadsOnly && !pads.some((c) => Math.hypot(P.x - c.x, P.z - c.z) <= PAD_RADIUS_M + CONTACT_RING_M)) continue;
    if (terrainNormal(e.tile, h.local[0], h.local[2]).dot(L) <= 0.1) continue;
    const Pu = P.clone().addScaledVector(L, 0.02);
    if (!castHit([cs.lm], Pu, L) || castHit([cs.rocks], Pu, L)) continue;     // LM shadow only
    if (castHit([cs.lm, cs.rocks], r.o, r.d, h.s - 0.02)) continue;           // view blocked
    if (!sunOK(e, h.local, L)) continue;                                       // terrain's job (horizon map)
    px.push(p.px);
  }
  return { px };
}
export function scoreLMShadow(e: GateEngine, view: View, gt: { px: number[] }) {
  e.setShadowIntensity(1);
  e.setCasterVisible(true, true); const { px: withLM } = shot(e, view);
  e.setCasterVisible(false, true); const { px: noLM } = shot(e, view);
  e.setCasterVisible(true, true);
  return { samples: gt.px.length, pct: pct(gt.px.filter((i) => darkNear(noLM, withLM, i, e.width(), 20)).length, gt.px.length) };
}

// ---------- criteria (§9, as implemented in §11) ----------

type Row = Record<string, unknown> & { el: number; az: number };
type M = { samples: number; pct: number };
export function evaluate(rows: Row[], keys: { a1: string[]; a2: string[]; c1: string[]; r1: string[] }) {
  const crit = {
    A1: { min: 30, ok: (p: number) => p <= 0.5, margin: (p: number) => (0.5 - p) / 0.5 },
    A2: { min: 100, ok: (p: number) => p <= 1.0, margin: (p: number) => (1.0 - p) / 1.0 },
    C1: { min: 30, ok: (p: number) => p >= 70, margin: (p: number) => (p - 70) / 70 },
    R1: { min: 30, ok: (p: number) => p >= 50, margin: (p: number) => (p - 50) / 50 },
  } as const;
  const out: Record<string, { measured: number; failed: number; worst: number | null; margin: number | null; pass: boolean | null }> = {};
  for (const [name, ks] of [['A1', keys.a1], ['A2', keys.a2], ['C1', keys.c1], ['R1', keys.r1]] as const) {
    const c = crit[name];
    let measured = 0, failed = 0, margin = Infinity, worst: number | null = null;
    for (const r of rows) for (const k of ks) {
      const m = r[k] as M | undefined;
      if (!m || m.samples < c.min || !Number.isFinite(m.pct)) continue;
      measured++;
      if (!c.ok(m.pct)) failed++;
      const mg = c.margin(m.pct);
      if (mg < margin) { margin = mg; worst = m.pct; }
    }
    out[name] = { measured, failed, worst, margin: measured ? margin : null, pass: measured ? failed === 0 : null };
  }
  return out;
}

// ---------- shared procedural rocks (identical geometry in both engines) ----------

/** 40 seeded boulders around the LM, in tile-local metres. Returns non-indexed CCW triangles. */
export function makeRocks(t: Tile, siteLocal: [number, number], seed = 1969, count = 40): Float32Array {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
  const base = new THREE.IcosahedronGeometry(1, 1).getAttribute('position');
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    const r = 0.2 + rnd() * 1.3, dist = 6 + rnd() * 34, ang = rnd() * Math.PI * 2;
    const cx = siteLocal[0] + Math.cos(ang) * dist, cz = siteLocal[1] + Math.sin(ang) * dist;
    const cy = heightAt(t, cx, cz) + r * 0.4; // sunk 30-ish % into the ground
    const sx = 0.8 + rnd() * 0.6, sy = 0.5 + rnd() * 0.4, sz = 0.8 + rnd() * 0.6, rk = rnd() * 1000;
    for (let i = 0; i < base.count; i++) {
      const vx = base.getX(i), vy = base.getY(i), vz = base.getZ(i);
      // displacement depends only on direction, so shared vertices stay welded
      const n = 1 + 0.15 * Math.sin(vx * 7.1 + rk) * Math.cos(vy * 5.3 + rk) * Math.sin(vz * 6.7 + rk);
      out.push(cx + vx * r * sx * n, cy + vy * r * sy * n, cz + vz * r * sz * n);
    }
  }
  return new Float32Array(out);
}

/** Build a BVH-backed three mesh (ground truth) from world-space triangle positions. */
export function gtMesh(positions: Float32Array): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.computeVertexNormals();
  (g as unknown as { computeBoundsTree(): void }).computeBoundsTree();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  m.updateMatrixWorld(true);
  return m;
}

// ---------- runner ----------

export interface ShadowCfg { bias: number; nbias: number; msize: number; maxFar: number }
export type Factory = (cfg: ShadowCfg) => Promise<GateEngine>;

const SUNS_ALL = (q.get('els') ?? '1,3,5,10').split(',').flatMap((el) => (q.get('azs') ?? '0,90,200,270').split(',').map((az) => [+el, +az] as const));
const SUNS_TUNE = [[3, 200], [5, 90], [10, 0], [10, 200]] as const; // protocol §11

async function computeGT(e: GateEngine, suns: readonly (readonly [number, number])[], withRay: boolean, log: (s: string) => void) {
  const gts: Record<string, unknown>[] = [];
  for (const [el, az] of suns) {
    e.setSun(el, az);
    log(`ground truth ${el}/${az}`);
    gts.push({
      el, az,
      ...(withRay ? { rayPad: await gtRay(e, 'pad'), rayChase: await gtRay(e, 'chase') } : {}),
      a1Pad: await gtA1(e, 'pad'), a1Chase: await gtA1(e, 'chase'),
      a2Pad: await gtA2(e, 'pad'), a2Chase: await gtA2(e, 'chase'),
      c1: await gtLMShadow(e, 'pad', true), r1: await gtLMShadow(e, 'chase', false),
    });
  }
  return gts;
}

function scoreAll(e: GateEngine, gts: Record<string, any>[], only?: string[]) {
  return gts.map((g) => {
    e.setSun(g.el, g.az);
    const row: Row = { el: g.el, az: g.az };
    const want = (k: string) => !only || only.includes(k);
    if (g.rayPad && want('ray')) { row.rayPad = scoreRay(e, 'pad', g.rayPad); row.rayChase = scoreRay(e, 'chase', g.rayChase); }
    if (want('a1')) { row.a1Pad = scoreA1(e, 'pad', g.a1Pad); row.a1Chase = scoreA1(e, 'chase', g.a1Chase); }
    if (want('a2')) { row.a2Pad = scoreA2(e, 'pad', g.a2Pad); row.a2Chase = scoreA2(e, 'chase', g.a2Chase); }
    if (want('c1')) row.c1 = scoreLMShadow(e, 'pad', g.c1);
    if (want('r1')) row.r1 = scoreLMShadow(e, 'chase', g.r1);
    return row;
  });
}

const KEYS = { a1: ['a1Pad', 'a1Chase'], a2: ['a2Pad', 'a2Chase'], c1: ['c1'], r1: ['r1'] };

/** mode=sweep: protocol §11 tuning on the 4-sun subset. mode=full: one config on the full grid (+R1/C1 at 2 km). */
export async function runGate(name: string, factory: Factory, sweep: ShadowCfg[], defaults: ShadowCfg) {
  const hud = document.getElementById('hud')!;
  const log = (m: string) => { hud.textContent = `${name}: ${m}`; (state as { progress?: string }).progress = m; };
  const mode = q.get('mode') ?? 'full';
  const state: Record<string, unknown> = { engine: name, mode, done: false };
  (window as unknown as { __gate: unknown }).__gate = state;
  const cfgOf = (o: Partial<ShadowCfg>) => ({ ...defaults, ...o });
  const qcfg = cfgOf({
    ...(q.has('bias') ? { bias: +q.get('bias')! } : {}), ...(q.has('nbias') ? { nbias: +q.get('nbias')! } : {}),
    ...(q.has('msize') ? { msize: +q.get('msize')! } : {}),
  });

  log('building ground-truth instance');
  let e = await factory(qcfg);
  const suns = mode === 'sweep' ? SUNS_TUNE : SUNS_ALL;
  const t0 = performance.now();
  const gts = await computeGT(e, suns, mode !== 'sweep', log);
  state.gtSeconds = Math.round((performance.now() - t0) / 1000);

  if (mode === 'sweep') {
    const runs: Record<string, unknown>[] = [];
    state.runs = runs;
    for (const [i, cfg] of sweep.entries()) {
      e.dispose(); log(`sweep ${i + 1}/${sweep.length} ${JSON.stringify(cfg)}`);
      e = await factory(cfg);
      const rows = scoreAll(e, gts);
      runs.push({ cfg, rows, criteria: evaluate(rows, KEYS) });
      await tick();
    }
    // selection (§11): all pass -> largest worst-case margin; else fewest failed criteria, then smallest worst violation
    const rank = (r: any) => {
      const cs = Object.values(r.criteria as Record<string, { pass: boolean | null; margin: number | null }>);
      const failed = cs.filter((c) => c.pass === false).length;
      const worst = Math.min(...cs.map((c) => (c.margin ?? 0)));
      return { failed, worst };
    };
    const best = [...runs].sort((a, b) => { const A = rank(a), B = rank(b); return A.failed - B.failed || B.worst - A.worst; })[0];
    state.selected = { cfg: (best as any).cfg, ...rank(best) };
  } else {
    log(`scoring ${JSON.stringify(qcfg)} at 20 km`);
    const rows = scoreAll(e, gts);
    e.dispose();
    log('scoring C1/R1 at 2 km');
    e = await factory({ ...qcfg, maxFar: 2000 });
    const rows2k = scoreAll(e, gts, ['c1', 'r1']);
    state.cfg = qcfg; state.rows = rows; state.rows2k = rows2k;
    state.criteria = evaluate(rows, KEYS);
    state.criteria2k = evaluate(rows2k, { a1: [], a2: [], c1: ['c1'], r1: ['r1'] });
  }
  if (q.get('keep') === '1') Object.assign(window, { __e: e }); else e.dispose(); // keep=1: leave the last instance for inspection
  state.done = true;
  log('done');
  // persist raw results (dev server endpoint, vite.config.ts); finite numbers only
  const body = JSON.stringify(state, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v));
  await fetch(`/__save?name=p1-0d-${name}-${mode}.json`, { method: 'POST', body }).catch(() => log('done (save failed)'));
  console.log('GATE2_RESULT', JSON.stringify(state));
}
