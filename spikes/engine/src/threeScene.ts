// Three.js scene for the spike, shared by the harness page (three.ts) and the gate (gate.ts).
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { CSMShadowNode } from 'three/examples/jsm/csm/CSMShadowNode.js';
import { cameraRig, LM_SPAN_M, lmSite, loadTile, sunDir, type Tile, type Vec3, type View } from './shared';

/**
 * Shadow-camera bounds from three's official webgpu_shadowmap_csm example. They set each
 * cascade's depth range, and shadow.bias is a fraction of that range (REPORT §8).
 * Regression-tested by the gate (gate.html).
 */
export const CSM_SHADOW_CAMERA = { near: 1, far: 2000, top: 1000, bottom: -1000, left: -1000, right: 1000 } as const;

export interface ThreeOpts {
  webgl?: boolean;
  shadows?: boolean;
  csm?: 'example' | 'legacy' | 'off';
  maxFar?: number;
  mode?: 'practical' | 'logarithmic' | 'uniform';
  largeWorld?: boolean;
  bias?: number;
  normalBias?: number;
  mapSize?: number;
  terrainCasts?: boolean;
  /** Fixed render size in px (gate runs), else the window size. */
  size?: [number, number];
}

function terrainMesh(t: Tile): THREE.Mesh {
  const n = t.samples;
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = (j * n + i) * 3;
    pos[k] = i * t.spacingM; pos[k + 1] = t.heights[j * n + i]; pos[k + 2] = j * t.spacingM;
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let p = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.set([a, c, b, b, c, d], p); p += 6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 1, metalness: 0 }));
  m.castShadow = m.receiveShadow = true;
  return m;
}

export async function buildThree(canvas: HTMLCanvasElement, o: ThreeOpts = {}) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: o.webgl });
  await renderer.init();
  if (o.size) { renderer.setPixelRatio(1); renderer.setSize(o.size[0], o.size[1]); }
  else { renderer.setPixelRatio(devicePixelRatio); renderer.setSize(innerWidth, innerHeight); }
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(60, o.size ? o.size[0] / o.size[1] : innerWidth / innerHeight, 0.05, 30_000);

  const tile = await loadTile();
  const terrain = terrainMesh(tile);
  terrain.castShadow = o.terrainCasts ?? true;
  scene.add(terrain);
  /** Objects authored in tile-local metres (e.g. rocks): placed with the terrain every frame. */
  const tileAnchored: THREE.Object3D[] = [];

  const lm = new THREE.Group();
  const draco = new DRACOLoader().setDecoderPath('draco/'); // NASA's glb is Draco-compressed
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync('models/apollo_lm.glb');
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  gltf.scene.position.y = -box.min.y;
  gltf.scene.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.castShadow = c.receiveShadow = true; });
  lm.add(gltf.scene);
  lm.scale.setScalar(LM_SPAN_M / Math.max(size.x, size.z));
  scene.add(lm);

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = o.shadows ?? true;
  sun.shadow.mapSize.set(o.mapSize ?? 2048, o.mapSize ?? 2048);
  // bias is a fraction of each cascade's depth range (~2 km with CSM_SHADOW_CAMERA): -0.0005 meant
  // ~1 m and erased the footpad's shadow. Keep depth bias tiny and let normalBias handle acne (gate P1-0c).
  sun.shadow.bias = o.bias ?? -0.00002;
  sun.shadow.normalBias = o.normalBias ?? 0.02;
  let csm: CSMShadowNode | null = null;
  const csmMode = o.csm ?? 'example';
  if (csmMode === 'example') {
    Object.assign(sun.shadow.camera, CSM_SHADOW_CAMERA);
    csm = new CSMShadowNode(sun, { cascades: 4, maxFar: o.maxFar ?? 20_000, mode: o.mode ?? 'logarithmic' });
  } else if (csmMode === 'legacy') {
    // first spike setup: no bounds, big light margin. Drops the LM shadow (kept for the record).
    Object.assign(sun.shadow.camera, { near: 1, far: 50_000 });
    csm = new CSMShadowNode(sun, { cascades: 4, maxFar: o.maxFar ?? 20_000, mode: o.mode ?? 'logarithmic', lightMargin: 500 });
  } else {
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 10_000 });
  }
  if (csm) sun.shadow.shadowNode = csm;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xffffff, 0x000000, 0.02));

  let dir = sunDir(10, 135);
  let sunEl = 10, sunAz = 135;
  const setSun = (el: number, az: number) => { sunEl = el; sunAz = az; dir = sunDir(el, az); };

  /** Shadow strength as a uniform, so toggling it needs no shader recompile. Cascades hold their own copies. */
  const setShadowIntensity = (v: number) => {
    sun.shadow.intensity = v;
    for (const l of (csm as unknown as { lights?: THREE.DirectionalLight[] })?.lights ?? []) l.shadow.intensity = v;
  };

  // Three has no built-in large-world mode: keep world positions as JS doubles and
  // re-base everything on the camera eye each frame so the GPU only sees small numbers.
  const place = (obj: THREE.Object3D, w: Vec3, origin: Vec3) => obj.position.set(w[0] - origin[0], w[1] - origin[1], w[2] - origin[2]);

  /** Lay out the scene for a view and render one frame. Returns the render-space origin used. */
  const frame = (view: View, offsetM: number, step = 0) => {
    const site = lmSite(tile, offsetM);
    const rig = cameraRig(view, site, step, sunEl, sunAz);
    const origin: Vec3 = (o.largeWorld ?? true) ? rig.eye : [0, 0, 0];
    place(terrain, [offsetM, 0, 0], origin);
    for (const a of tileAnchored) place(a, [offsetM, 0, 0], origin);
    place(lm, site, origin);
    place(camera, rig.eye, origin);
    camera.near = rig.near; camera.far = rig.far; camera.updateProjectionMatrix();
    camera.lookAt(rig.target[0] - origin[0], rig.target[1] - origin[1], rig.target[2] - origin[2]);
    place(sun.target, site, origin);
    place(sun, [site[0] - dir[0] * 5000, site[1] - dir[1] * 5000, site[2] - dir[2] * 5000], origin);
    // CSM fits cascades to camera.matrixWorld before the render updates it: refresh first,
    // or the first frame after a camera jump uses the previous pose (spike finding)
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    // Shadow maps re-render once per (camera, frameId), and frameId only advances in three's
    // animation loop. The harness renders several frames per task, so advance it by hand.
    (renderer as unknown as { _nodes: { nodeFrame: { update(): void } } })._nodes.nodeFrame.update();
    renderer.render(scene, camera);
    return { origin, site, rig };
  };

  if (!o.size) addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
  return { renderer, scene, camera, terrain, lm, sun, csm, tile, tileAnchored, setSun, setShadowIntensity, frame, sunDirNow: () => dir };
}
