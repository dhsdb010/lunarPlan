// Three.js confirmation gate (task P1-0c, REPORT §7). Each metric is checked against CPU ground
// truth: a heightfield ray-march for the terrain and three's Raycaster for the LM.
import * as THREE from 'three/webgpu';
import { grab, type Tile, type View } from './shared';
import { buildThree } from './threeScene';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';

// BVH only for the CPU ground-truth raycasts; rendering is untouched.
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: unknown }).computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const q = new URLSearchParams(location.search);
const OFFSET = Number(q.get('offset') ?? 100_000);
const MAX_FAR = Number(q.get('maxfar') ?? 20_000);
const STRIDE = Number(q.get('stride') ?? 4);
const ELS = (q.get('els') ?? '1,3,5,10').split(',').map(Number);
const AZS = (q.get('azs') ?? '0,90,200,270').split(',').map(Number);
const TESTS = (q.get('tests') ?? 'acne,contact,csm').split(',');

const PAD_RADIUS_M = 0.455;   // 0.91 m footpad (spec 01 §5)
const CONTACT_RING_M = 1.0;   // "within 1 m of each footpad"
const CLEARANCE_M = 0.5;      // sun ray must clear terrain by this much to count as unoccluded
const CLEARANCE_RAD = Number(q.get('clr') ?? 0.02); // ...or by this angle (0.02 rad = 1.15 deg) close to the point
const MIN_SAMPLES = 30;       // below this a config is reported n/a, not pass
const VIEW_STEP = Number(q.get('vstep') ?? 0.002); // camera-ray march step as a fraction of distance
const TOL_PX = Number(q.get('tol') ?? 2); // shadow-map filtering shifts thin strut shadows by ~1-2 px

type T = Awaited<ReturnType<typeof buildThree>>;

/**
 * Height exactly as the GPU mesh draws it: each grid cell is split into triangles (a,c,b) and
 * (b,c,d) along the b-c diagonal (threeScene terrainMesh). Bilinear differs by tens of cm on
 * this terrain, which moves grazing-sun shadow edges by metres.
 */
function heightAt(t: Tile, x: number, z: number): number {
  const fx = Math.min(Math.max(x / t.spacingM, 0), t.samples - 1.000001);
  const fz = Math.min(Math.max(z / t.spacingM, 0), t.samples - 1.000001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const n = t.samples, h = t.heights;
  const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

const luma = (p: Uint8ClampedArray, i: number) => (p[i] + p[i + 1] + p[i + 2]) / 3;

/** Terrain hit along a render-space ray, via the tile-local heightfield. */
function marchTerrain(t: T, o: THREE.Vector3, d: THREE.Vector3, origin: number[], far: number) {
  const tile = t.tile;
  // render space -> tile-local: + origin - tile position (offset, 0, 0)
  const ox = o.x + origin[0] - OFFSET, oy = o.y + origin[1], oz = o.z + origin[2];
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x <= tile.sizeM && z <= tile.sizeM;
  const f = (s: number) => {
    const x = ox + d.x * s, z = oz + d.z * s;
    return inside(x, z) ? oy + d.y * s - heightAt(tile, x, z) : Infinity;
  };
  let s0 = 0.05, f0 = f(s0);
  while (s0 < far) {
    const s1 = s0 + Math.max(0.01, s0 * VIEW_STEP), f1 = f(s1);
    if (f0 > 0 && f1 <= 0 && f1 !== Infinity) {
      let a = s0, b = s1;
      for (let k = 0; k < 14; k++) { const m = (a + b) / 2; if (f(m) > 0) a = m; else b = m; }
      const s = (a + b) / 2;
      return { s, local: [ox + d.x * s, oy + d.y * s, oz + d.z * s] };
    }
    s0 = s1; f0 = f1;
  }
  return null;
}

function terrainNormal(t: T, x: number, z: number) {
  const e = t.tile.spacingM / 2;
  const dx = (heightAt(t.tile, x + e, z) - heightAt(t.tile, x - e, z)) / (2 * e);
  const dz = (heightAt(t.tile, x, z + e) - heightAt(t.tile, x, z - e)) / (2 * e);
  const n = new THREE.Vector3(-dx, 1, -dz);
  return n.normalize();
}

/**
 * True if the sun ray from a tile-local point clears all terrain. Marches from 5 cm out (grazing
 * suns are shadowed by small bumps a metre away) and requires an angular margin of
 * CLEARANCE_RAD, capped at CLEARANCE_M, so terminator-grazing pixels count as ambiguous.
 */
function sunClear(t: T, p: number[], L: THREE.Vector3) {
  const top = (t.tile.meta.relief_m as number) + 5;
  for (let s = 0.05; s < 6000; s += Math.max(0.05, s * 0.02)) {
    const x = p[0] + L.x * s, y = p[1] + L.y * s, z = p[2] + L.z * s;
    if (x < 0 || z < 0 || x > t.tile.sizeM || z > t.tile.sizeM || y > top) return true;
    if (y - heightAt(t.tile, x, z) < Math.min(CLEARANCE_M, CLEARANCE_RAD * s)) return false;
  }
  return true;
}

/** Deep shadow: the sun ray passes at least 2 m under the terrain (unambiguous, for the control). */
function sunClearLoose(t: T, p: number[], L: THREE.Vector3) {
  const top = (t.tile.meta.relief_m as number) + 5;
  for (let s = 5; s < 6000; s += Math.max(2.5, s * 0.02)) {
    const x = p[0] + L.x * s, y = p[1] + L.y * s, z = p[2] + L.z * s;
    if (x < 0 || z < 0 || x > t.tile.sizeM || z > t.tile.sizeM || y > top) return true;
    if (heightAt(t.tile, x, z) - y > 2) return false;
  }
  return true;
}

/** Footpad centres (render space): lowest LM vertices clustered into the 4 legs by angle. */
function footpads(t: T) {
  t.lm.updateMatrixWorld(true);
  const pts: THREE.Vector3[] = [];
  let minY = Infinity;
  t.lm.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      pts.push(v); minY = Math.min(minY, v.y);
    }
  });
  const low = pts.filter((v) => v.y < minY + 0.25);
  const c = low.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(low.length);
  const ang = low.map((v) => ({ v, a: Math.atan2(v.z - c.z, v.x - c.x) })).sort((a, b) => a.a - b.a);
  // split at the 4 largest angular gaps
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

function rays(t: T) {
  const W = t.renderer.domElement.width, H = t.renderer.domElement.height;
  t.camera.updateMatrixWorld(true);
  const out: { px: number; o: THREE.Vector3; d: THREE.Vector3 }[] = [];
  for (let y = STRIDE >> 1; y < H; y += STRIDE) for (let x = STRIDE >> 1; x < W; x += STRIDE) {
    const v = new THREE.Vector3(((x + 0.5) / W) * 2 - 1, 1 - ((y + 0.5) / H) * 2, 0.5).unproject(t.camera);
    out.push({ px: (y * W + x) * 4, o: t.camera.position.clone(), d: v.sub(t.camera.position).normalize() });
  }
  return out;
}

const lmRaycaster = new THREE.Raycaster();
const lmBox = new THREE.Box3();
const hitPt = new THREE.Vector3();
/** Call after the LM is placed for the frame: cheap box test before per-triangle raycasts. */
function updateLMBox(t: T) { t.lm.updateMatrixWorld(true); lmBox.setFromObject(t.lm).expandByScalar(0.05); }
function hitsLM(t: T, o: THREE.Vector3, d: THREE.Vector3, maxDist = Infinity) {
  lmRaycaster.set(o, d); lmRaycaster.far = maxDist;
  const b = lmRaycaster.ray.intersectBox(lmBox, hitPt);
  if (!b || (lmBox.containsPoint(o) ? false : o.distanceTo(hitPt) > maxDist)) return false;
  return lmRaycaster.intersectObject(t.lm, true).length > 0;
}
// MessageChannel yields aren't throttled in background tabs (setTimeout is clamped to >= 1 s there)
const ch = new MessageChannel();
const waiters: (() => void)[] = [];
ch.port1.onmessage = () => waiters.shift()?.();
const tick = () => new Promise<void>((r) => { waiters.push(r); ch.port2.postMessage(0); });

/** Render the view twice (cascades lag one frame after init or a sun/visibility change), then grab. */
const WARM = Number(q.get('warm') ?? 2);
function shot(t: T, view: View) {
  for (let i = 1; i < WARM; i++) t.frame(view, OFFSET);
  const f = t.frame(view, OFFSET);
  return { ...f, px: grab(t.renderer.domElement) };
}

/** Acne: LM hidden, shadows on vs off, over terrain pixels the CPU says are sunlit. */
async function acne(t: T, view: View) {
  t.lm.visible = false;
  t.setShadowIntensity(1); const { origin, rig, px: on } = shot(t, view);
  t.setShadowIntensity(0); const { px: off } = shot(t, view);
  t.setShadowIntensity(1); t.lm.visible = true;
  const L = new THREE.Vector3(...t.sunDirNow()).negate();
  let n = 0, bad = 0, k = 0, shadowed = 0, caught = 0;
  const marks: [number, string][] = [];
  for (const r of rays(t)) {
    if (++k % 3000 === 0) await tick();
    const h = marchTerrain(t, r.o, r.d, origin, rig.far);
    if (!h) continue;
    if (terrainNormal(t, h.local[0], h.local[2]).dot(L) <= 0.1) continue;
    const darkened = luma(off, r.px) - luma(on, r.px) > 8;
    if (!sunClear(t, h.local, L)) {
      // positive control: sun-facing ground the CPU says terrain shadows must render darker
      if (!sunClearLoose(t, h.local, L)) { shadowed++; if (darkened) caught++; }
      continue;
    }
    n++;
    if (darkened) bad++;
    marks.push([r.px, darkened ? '#f00' : '#0f0']);
  }
  if (q.get('dbg') === 'acne-' + view) overlay(on, marks);
  return { samples: n, pct: n ? (100 * bad) / n : NaN, controlSamples: shadowed, controlCaughtPct: shadowed ? (100 * caught) / shadowed : NaN };
}

/** First LM hit along a render-space ray (BVH), with a world normal facing the ray origin. */
function lmHit(t: T, o: THREE.Vector3, d: THREE.Vector3, far: number) {
  lmRaycaster.set(o, d); lmRaycaster.far = far;
  if (!lmRaycaster.ray.intersectBox(lmBox, hitPt)) return null;
  const hit = lmRaycaster.intersectObject(t.lm, true)[0];
  if (!hit || !hit.face) return null;
  const N = hit.face.normal.clone().applyMatrix3(nmTmp.getNormalMatrix(hit.object.matrixWorld)).normalize();
  if (N.dot(d) > 0) N.negate(); // open shells / double-sided parts: use the side facing the camera
  return { hit, N };
}
const nmTmp = new THREE.Matrix3();

type LMSample = { px: number; eligible: boolean; selfShadowed: boolean };

/**
 * CPU ground truth for LM surfaces (P1-0d A2/M0). A pixel is eligible if its centre ray hits the
 * LM in front of terrain, faces the sun (N.L > 0.1) and is not terrain-shadowed (horizon map's job).
 */
function lmGroundTruth(t: T, origin: number[], far: number, L: THREE.Vector3) {
  const W = t.renderer.domElement.width, H = t.renderer.domElement.height;
  const out: LMSample[] = [];
  for (const r of rays(t)) {
    const p = r.px / 4, x = p % W, y = Math.floor(p / W);
    // Unambiguous pixels only: the centre and four sub-pixel rays must all hit the LM in front of
    // terrain, face the sun, be terrain-unshadowed and agree on LM self-shadowing. Otherwise the
    // pixel's colour blends surfaces or a shadow edge and can't be judged (M0 finding).
    let state: boolean | null = null, ok = true;
    for (const [jx, jy] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) {
      const d = new THREE.Vector3(((x + jx) / W) * 2 - 1, 1 - ((y + jy) / H) * 2, 0.5).unproject(t.camera).sub(t.camera.position).normalize();
      const h = lmHit(t, t.camera.position, d, far);
      if (!h) { ok = false; break; }
      const g = marchTerrain(t, t.camera.position, d, origin, h.hit.distance);
      if ((g && g.s < h.hit.distance) || h.N.dot(L) <= 0.1) { ok = false; break; }
      const P = h.hit.point.clone().addScaledVector(h.N, 0.005);
      if (!sunClear(t, [P.x + origin[0] - OFFSET, P.y + origin[1], P.z + origin[2]], L)) { ok = false; break; }
      const ss = hitsLM(t, P, L);
      if (state === null) state = ss; else if (state !== ss) { ok = false; break; }
    }
    if (ok && state !== null) out.push({ px: r.px, eligible: true, selfShadowed: state });
  }
  return out;
}

/** Score a pair of frames against the ground truth: false darkening on lit LM pixels, and the control. */
function scoreLM(samples: LMSample[], on: Uint8ClampedArray, off: Uint8ClampedArray, marks?: [number, string][]) {
  let n = 0, bad = 0, ss = 0, caught = 0;
  for (const s of samples) {
    if (luma(off, s.px) < 30) continue; // too dark to judge an 8/255 drop
    const darkened = luma(off, s.px) - luma(on, s.px) > 8;
    if (s.selfShadowed) { ss++; if (darkened) caught++; continue; }
    n++;
    if (darkened) bad++;
    marks?.push([s.px, darkened ? '#f00' : '#0f0']);
  }
  return { samples: n, pct: n ? (100 * bad) / n : NaN, controlSamples: ss, controlCaughtPct: ss ? (100 * caught) / ss : NaN };
}

/**
 * M0 reference: the same view shaded on the CPU with exact BVH shadows, 2x2 jittered sub-rays per
 * sampled pixel (so silhouettes blend like MSAA). By construction it has no acne: the metric must
 * read <= 0.5 % on it and still catch its self-shadowed pixels.
 */
function referenceFrames(t: T, origin: number[], far: number, L: THREE.Vector3, samples: LMSample[]) {
  const W = t.renderer.domElement.width, H = t.renderer.domElement.height;
  const on = new Uint8ClampedArray(W * H * 4), off = new Uint8ClampedArray(W * H * 4);
  for (const s of samples) {
    const p = s.px / 4, x = p % W, y = Math.floor(p / W);
    let sOn = 0, sOff = 0;
    for (const [jx, jy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const v = new THREE.Vector3(((x + jx) / W) * 2 - 1, 1 - ((y + jy) / H) * 2, 0.5).unproject(t.camera);
      const d = v.sub(t.camera.position).normalize();
      const h = lmHit(t, t.camera.position, d, far);
      if (!h) { sOn += 60; sOff += 60; continue; } // terrain/sky behind a silhouette: unshadowed by the LM
      const ndl = Math.max(0, h.N.dot(L));
      const P = h.hit.point.clone().addScaledVector(h.N, 0.005);
      const vis = hitsLM(t, P, L) ? 0 : 1;
      sOff += 40 + 200 * ndl; sOn += 40 + 200 * ndl * vis;
    }
    on.fill(sOn / 4, s.px, s.px + 3); off.fill(sOff / 4, s.px, s.px + 3);
  }
  return { on, off };
}

/** A2: LM self-acne in the real render (terrain receive-only via tcast=0), plus the M0 reference score. */
async function acneLM(t: T, view: View) {
  t.lm.visible = true;
  t.setShadowIntensity(1); const { origin, rig, px: on } = shot(t, view);
  t.setShadowIntensity(0); const { px: off } = shot(t, view);
  t.setShadowIntensity(1); t.frame(view, OFFSET);
  updateLMBox(t);
  await tick();
  const L = new THREE.Vector3(...t.sunDirNow()).negate();
  const gt = lmGroundTruth(t, origin, rig.far, L);
  await tick();
  const marks: [number, string][] = [];
  const real = scoreLM(gt, on, off, marks);
  if (q.get('dbg') === 'lm-' + view) overlay(on, marks);
  const ref = referenceFrames(t, origin, rig.far, L, gt);
  return { ...real, reference: scoreLM(gt, ref.on, ref.off) };
}

/** Darkened by > 20/255 at this pixel or within TOL_PX of it. */
function darkNear(a: Uint8ClampedArray, b: Uint8ClampedArray, i: number, W: number) {
  const p = i / 4, x0 = p % W, y0 = Math.floor(p / W), H = a.length / 4 / W;
  for (let dy = -TOL_PX; dy <= TOL_PX; dy++) for (let dx = -TOL_PX; dx <= TOL_PX; dx++) {
    const x = x0 + dx, y = y0 + dy;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const j = (y * W + x) * 4;
    if (luma(a, j) - luma(b, j) > 20) return true;
  }
  return false;
}

/** LM shadow coverage: expected footprint (CPU) vs pixels darkened by the LM (LM on vs off). */
async function lmShadow(t: T, view: View, nearPadsOnly: boolean) {
  t.setShadowIntensity(1);
  t.lm.visible = true; const { origin, rig, px: withLM } = shot(t, view);
  const pads = footpads(t);
  t.lm.visible = false; const { px: noLM } = shot(t, view);
  t.lm.visible = true; t.frame(view, OFFSET); // restore matrices for raycasts
  updateLMBox(t);
  const L = new THREE.Vector3(...t.sunDirNow()).negate();
  let n = 0, dark = 0, k = 0, darkAll = 0, terrainHits = 0, geoShadow = 0;
  const marks: [number, string][] = [];
  for (const r of rays(t)) {
    if (++k % 1500 === 0) await tick();
    if (luma(noLM, r.px) - luma(withLM, r.px) > 20) darkAll++;
    const h = marchTerrain(t, r.o, r.d, origin, rig.far);
    if (!h) continue;
    terrainHits++;
    if (q.has('dbg') && hitsLM(t, new THREE.Vector3(h.local[0] + OFFSET - origin[0], h.local[1] - origin[1], h.local[2] - origin[2]).addScaledVector(L, 0.02), L)) geoShadow++;
    const P = new THREE.Vector3(h.local[0] + OFFSET - origin[0], h.local[1] - origin[1], h.local[2] - origin[2]); // render space
    if (nearPadsOnly && !pads.some((c) => Math.hypot(P.x - c.x, P.z - c.z) <= PAD_RADIUS_M + CONTACT_RING_M)) continue;
    if (terrainNormal(t, h.local[0], h.local[2]).dot(L) <= 0.1) continue;
    if (!hitsLM(t, P.clone().addScaledVector(L, 0.02), L)) continue;    // not in the LM's geometric shadow
    if (hitsLM(t, r.o, r.d, h.s - 0.02)) continue;                      // LM blocks the view of this ground point
    if (!sunClear(t, h.local, L)) continue;                             // terrain already shadows it
    n++;
    const ok = darkNear(noLM, withLM, r.px, t.renderer.domElement.width);
    if (ok) dark++;
    marks.push([r.px, ok ? '#0f0' : '#f00']);
  }
  if (q.get('dbg') === view) overlay(withLM, marks);
  return { samples: n, pct: n ? (100 * dark) / n : NaN, ...(q.has('dbg') ? { darkAll, terrainHits, geoShadow, pads: pads.map((p) => p.toArray().map((v) => +v.toFixed(2))), lmBox: [lmBox.min.toArray(), lmBox.max.toArray()].map((a) => a.map((v) => +v.toFixed(2))), L: L.toArray().map((v) => +v.toFixed(3)) } : {}) };
}

/** Debug: show a captured frame with marked sample pixels on top of the canvas. */
function overlay(px: Uint8ClampedArray, marks: [number, string][]) {
  const W = (document.getElementById('c') as HTMLCanvasElement).width, H = px.length / 4 / W;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:5';
  const g = c.getContext('2d')!;
  g.putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
  for (const [i, col] of marks) { const p = i / 4; g.fillStyle = col; g.fillRect((p % W) - 1, Math.floor(p / W) - 1, 3, 3); }
  document.body.appendChild(c);
}

async function main() {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  // controls: csm=legacy reproduces the broken first setup, bias=0 should produce acne
  const t = await buildThree(canvas, { maxFar: MAX_FAR, mode: 'logarithmic', csm: (q.get('csm') ?? 'example') as 'example' });
  if (!q.has('nobvh')) t.lm.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) (m.geometry as unknown as { computeBoundsTree(): void }).computeBoundsTree(); });
  lmRaycaster.firstHitOnly = true;
  if (q.get('tcast') === '0') t.terrain.castShadow = false; // amendment: terrain shadows come from a horizon map
  if (q.get('tshadowside') === 'front') (t.terrain.material as THREE.Material).shadowSide = THREE.FrontSide; // acne control
  if (q.get('shadowside') === 'front') { // M0 positive control: LM casts from its lit faces -> acne
    t.lm.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) for (const mat of [m.material].flat()) mat.shadowSide = THREE.FrontSide; });
  }
  if (q.get('shadowside') === 'double') {
    t.lm.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) for (const mat of [m.material].flat()) mat.shadowSide = THREE.DoubleSide; });
  }
  Object.assign(window, { __t: t, __grab: grab });
  if (q.has('msize')) t.sun.shadow.mapSize.setScalar(Number(q.get('msize')));
  if (q.has('bias')) t.sun.shadow.bias = Number(q.get('bias'));
  if (q.has('nbias')) t.sun.shadow.normalBias = Number(q.get('nbias'));
  // WebGPU compiles pipelines (incl. shadow passes) asynchronously: frames rendered before that
  // finishes draw shadow maps without the LM. Warm every view/visibility combo first.
  const warmStart = performance.now();
  await t.renderer.compileAsync(t.scene, t.camera);
  for (let i = 0; i < 20; i++) {
    t.lm.visible = i % 2 === 0;
    t.frame(i % 4 < 2 ? 'pad' : 'chase', OFFSET);
    await (t.renderer.backend as unknown as { device: GPUDevice }).device?.queue.onSubmittedWorkDone();
    await tick();
  }
  t.lm.visible = true;
  const warmMs = Math.round(performance.now() - warmStart);
  const results: Record<string, unknown>[] = [];
  (window as unknown as { __gate: unknown }).__gate = { maxFar: MAX_FAR, stride: STRIDE, warmMs, results, done: false };
  for (const el of ELS) for (const az of AZS) {
    t.setSun(el, az);
    const row: Record<string, unknown> = { el, az };
    if (TESTS.includes('acne')) { row.acnePad = await acne(t, 'pad'); row.acneChase = await acne(t, 'chase'); }
    if (TESTS.includes('acnelm')) { row.acneLMPad = await acneLM(t, 'pad'); row.acneLMChase = await acneLM(t, 'chase'); }
    if (TESTS.includes('contact')) row.contact = await lmShadow(t, 'pad', true);
    if (TESTS.includes('csm')) row.lmShadowChase = await lmShadow(t, 'chase', false);
    results.push(row);
    hud.textContent = `gate maxFar ${MAX_FAR} · ${results.length}/${ELS.length * AZS.length}\n${JSON.stringify(row)}`;
    await tick();
  }
  (window as unknown as { __gate: { done: boolean } }).__gate.done = true;
  console.log('GATE_RESULT', JSON.stringify((window as unknown as { __gate: unknown }).__gate));
}

main();
