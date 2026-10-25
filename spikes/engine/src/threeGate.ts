// Three.js adapter for gate P1-0d. Ground-truth space = three's render space (re-based on the
// camera eye each frame), so caster raycasts use the very objects being rendered.
import * as THREE from 'three/webgpu';
import { lmSite, sunDir, type View } from './shared';
import { buildThree } from './threeScene';
import { GATE_SIZE, makeRocks, OFFSET, tick, type GateEngine, type ShadowCfg } from './gateCore';

export async function threeGate(canvas: HTMLCanvasElement, cfg: ShadowCfg): Promise<GateEngine> {
  const t = await buildThree(canvas, {
    maxFar: cfg.maxFar, mode: 'logarithmic', terrainCasts: false, size: GATE_SIZE,
    bias: cfg.bias, normalBias: cfg.nbias, mapSize: cfg.msize,
  });
  const site = lmSite(t.tile, OFFSET);
  const rockPos = makeRocks(t.tile, [site[0] - OFFSET, site[2]]);
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(rockPos, 3));
  rg.computeVertexNormals();
  const rocks = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 1, metalness: 0 }));
  rocks.castShadow = rocks.receiveShadow = true;
  t.scene.add(rocks);
  t.tileAnchored.push(rocks);

  // BVH on the rendered geometry (raycasts only; drawing is unaffected)
  for (const root of [t.lm, rocks]) root.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) (m.geometry as unknown as { computeBoundsTree(): void }).computeBoundsTree();
  });

  let origin: number[] = [0, 0, 0], el = 10, az = 135;
  const e: GateEngine = {
    name: 'three',
    backend: (t.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2',
    tile: t.tile,
    setSun(e1, a1) { el = e1; az = a1; t.setSun(e1, a1); },
    sunL: () => new THREE.Vector3(...sunDir(el, az)).negate(),
    setShadowIntensity: (v) => t.setShadowIntensity(v),
    setCasterVisible(lm, r) { t.lm.visible = lm; rocks.visible = r; },
    frame(view: View) { const f = t.frame(view, OFFSET); origin = f.origin; t.lm.updateMatrixWorld(true); rocks.updateMatrixWorld(true); return f.rig.far; },
    grab() {
      const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
      const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(canvas, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    },
    width: () => canvas.width,
    height: () => canvas.height,
    ray(x, y, jx, jy) {
      const W = canvas.width, H = canvas.height;
      const v = new THREE.Vector3(((x + jx) / W) * 2 - 1, 1 - ((y + jy) / H) * 2, 0.5).unproject(t.camera);
      return { o: t.camera.position.clone(), d: v.sub(t.camera.position).normalize() };
    },
    toLocal: (v) => [v.x + origin[0] - OFFSET, v.y + origin[1], v.z + origin[2]],
    casters: () => ({ lm: t.lm, rocks }),
    dispose() { t.renderer.dispose(); canvas.remove(); },
  };

  // WebGPU compiles shadow pipelines asynchronously: warm every view/visibility combo (REPORT §8)
  await t.renderer.compileAsync(t.scene, t.camera);
  for (let i = 0; i < 24; i++) {
    e.setCasterVisible(i % 2 === 0, i % 3 !== 0);
    e.frame((['pad', 'chase'] as const)[(i >> 1) % 2]);
    // bounded wait: in a hidden tab the GPU queue may not report completion promptly
    const done = (t.renderer.backend as unknown as { device?: GPUDevice }).device?.queue.onSubmittedWorkDone();
    await Promise.race([done, new Promise((r) => setTimeout(r, 250))]);
    await tick();
  }
  e.setCasterVisible(true, true);
  return e;
}
