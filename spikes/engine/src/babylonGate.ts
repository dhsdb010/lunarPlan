// Babylon.js adapter for gate P1-0d. Ground-truth space = tile-local metres (Babylon world minus the
// tile offset, computed in doubles), with casters rebuilt from Babylon's own world-space triangles.
import * as THREE from 'three';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/2.0';
import { cameraRig, LM_SPAN_M, lmSite, loadTile, sunDir, type Tile, type View } from './shared';
import { GATE_SIZE, gtMesh, makeRocks, OFFSET, tick, type GateEngine, type ShadowCfg } from './gateCore';

const FOV = Math.PI / 3; // 60 deg vertical, same as three

function terrainMesh(t: Tile, scene: Scene): Mesh {
  const n = t.samples, pos: number[] = [], idx: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.push(i * t.spacingM, t.heights[j * n + i], j * t.spacingM);
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, b, c, b, d, c); // same b-c diagonal as three; clockwise-from-above for left-handed
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);
  const vd = new VertexData(); Object.assign(vd, { positions: pos, indices: idx, normals });
  const m = new Mesh('terrain', scene); vd.applyToMesh(m);
  const mat = new StandardMaterial('regolith', scene);
  mat.diffuseColor = new Color3(0.55, 0.55, 0.55); mat.specularColor = Color3.Black();
  m.material = mat; m.receiveShadows = true;
  return m;
}

function rockMesh(positions: Float32Array, scene: Scene): Mesh {
  const pos = Array.from(positions), idx: number[] = [];
  for (let i = 0; i < pos.length / 3; i += 3) idx.push(i, i + 2, i + 1); // flip CCW -> CW for left-handed
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);
  const vd = new VertexData(); Object.assign(vd, { positions: pos, indices: idx, normals });
  const m = new Mesh('rocks', scene); vd.applyToMesh(m);
  const mat = new StandardMaterial('rock', scene);
  mat.diffuseColor = new Color3(0.55, 0.55, 0.55); mat.specularColor = Color3.Black();
  m.material = mat; m.receiveShadows = true;
  return m;
}

/** World-space triangles of Babylon meshes, minus the tile offset (doubles), as a BVH mesh. */
function gtFromBabylon(meshes: Mesh[]): THREE.Object3D {
  const out: number[] = [];
  for (const m of meshes) {
    const p = m.getVerticesData(VertexBuffer.PositionKind), idx = m.getIndices();
    if (!p || !idx) continue;
    const w = m.computeWorldMatrix(true).asArray(); // column-major 4x4 (Float64 with high-precision matrices)
    const tr = (i: number) => {
      const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
      out.push(w[0] * x + w[4] * y + w[8] * z + w[12] - OFFSET, w[1] * x + w[5] * y + w[9] * z + w[13], w[2] * x + w[6] * y + w[10] * z + w[14]);
    };
    for (let k = 0; k < idx.length; k++) tr(idx[k]);
  }
  const g = new THREE.Group(); g.add(gtMesh(new Float32Array(out))); g.updateMatrixWorld(true);
  return g;
}

export async function babylonGate(canvas: HTMLCanvasElement, cfg: ShadowCfg): Promise<GateEngine> {
  // WebGL2 + preserveDrawingBuffer: Babylon's WebGPU swapchain can't be read back from a manual loop (§1)
  canvas.style.width = GATE_SIZE[0] + 'px'; canvas.style.height = GATE_SIZE[1] + 'px';
  const engine = new Engine(canvas, true, { useLargeWorldRendering: true, preserveDrawingBuffer: true });
  engine.setSize(GATE_SIZE[0], GATE_SIZE[1]);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 1);
  const tile = await loadTile();
  const terrain = terrainMesh(tile, scene); // receive-only: never added as a shadow caster (§11)

  const lm = new TransformNode('lm', scene);
  const res = await ImportMeshAsync('models/apollo_lm.glb', scene);
  res.meshes[0].parent = lm;
  const { min, max } = res.meshes[0].getHierarchyBoundingVectors(true);
  lm.scaling.setAll(LM_SPAN_M / Math.max(max.x - min.x, max.z - min.z));
  res.meshes[0].position.y = -min.y;

  const site = lmSite(tile, OFFSET);
  const rockPos = makeRocks(tile, [site[0] - OFFSET, site[2]]);
  const rocks = rockMesh(rockPos, scene);

  const sun = new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
  sun.intensity = 3;
  new HemisphericLight('earthshine', new Vector3(0, 1, 0), scene).intensity = 0.02;
  const camera = new FreeCamera('cam', Vector3.Zero(), scene);
  camera.fov = FOV;

  const csm = new CascadedShadowGenerator(cfg.msize, sun);
  csm.numCascades = 4;
  csm.stabilizeCascades = true;
  csm.lambda = 0.9;
  csm.shadowMaxZ = cfg.maxFar;
  csm.usePercentageCloserFiltering = true;
  csm.filteringQuality = CascadedShadowGenerator.QUALITY_HIGH;
  csm.bias = cfg.bias;
  csm.normalBias = cfg.nbias;
  csm.depthClamp = true;
  const lmMeshes = res.meshes.filter((m) => m.getTotalVertices() > 0) as Mesh[];
  for (const m of res.meshes) { csm.addShadowCaster(m); m.receiveShadows = true; }
  csm.addShadowCaster(rocks);

  let el = 10, az = 135;
  let gt: { lm: THREE.Object3D; rocks: THREE.Object3D } | null = null;
  const rayCam = new THREE.PerspectiveCamera(60, 1, 0.05, 30_000);

  const e: GateEngine = {
    name: 'babylon', backend: 'webgl2', tile,
    setSun(e1, a1) { el = e1; az = a1; },
    sunL: () => new THREE.Vector3(...sunDir(el, az)).negate(),
    setShadowIntensity(v) { csm.darkness = v ? 0 : 1; }, // darkness 0 = full shadow, 1 = none
    setCasterVisible(l, r) { lm.setEnabled(l); rocks.setEnabled(r); },
    frame(view: View) {
      terrain.position.set(OFFSET, 0, 0);
      rocks.position.set(OFFSET, 0, 0);
      lm.position.set(...site);
      const rig = cameraRig(view, site, 0, el, az);
      camera.position.set(...rig.eye);
      camera.setTarget(new Vector3(...rig.target));
      camera.minZ = rig.near; camera.maxZ = rig.far;
      sun.direction = new Vector3(...sunDir(el, az));
      sun.position = new Vector3(...site).subtract(sun.direction.scale(5000));
      engine.beginFrame(); scene.render(); engine.endFrame();
      // ray camera in tile-local space (pure translation of Babylon world)
      rayCam.aspect = canvas.width / canvas.height; rayCam.near = rig.near; rayCam.far = rig.far;
      rayCam.position.set(rig.eye[0] - OFFSET, rig.eye[1], rig.eye[2]);
      rayCam.up.set(0, 1, 0);
      rayCam.lookAt(rig.target[0] - OFFSET, rig.target[1], rig.target[2]);
      rayCam.updateProjectionMatrix(); rayCam.updateMatrixWorld(true);
      return rig.far;
    },
    grab() {
      const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
      const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(canvas, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    },
    width: () => canvas.width,
    height: () => canvas.height,
    ray(x, y, jx, jy) {
      const W = canvas.width, H = canvas.height;
      // Babylon is left-handed: the same eye/target/up image is mirrored left-right vs three
      const v = new THREE.Vector3(1 - ((x + jx) / W) * 2, 1 - ((y + jy) / H) * 2, 0.5).unproject(rayCam);
      return { o: rayCam.position.clone(), d: v.sub(rayCam.position).normalize() };
    },
    toLocal: (v) => [v.x, v.y, v.z],
    casters() {
      if (!gt) {
        const rg = new THREE.Group(); rg.add(gtMeshFromLocal(rockPos)); rg.updateMatrixWorld(true);
        gt = { lm: gtFromBabylon(lmMeshes), rocks: rg };
      }
      return gt;
    },
    dispose() { engine.dispose(); canvas.remove(); },
  };

  e.frame('pad');
  await scene.whenReadyAsync();
  for (let i = 0; i < 12; i++) { e.setCasterVisible(i % 2 === 0, i % 3 !== 0); e.frame((['pad', 'chase'] as const)[(i >> 1) % 2]); await tick(); }
  e.setCasterVisible(true, true);
  return e;
}

function gtMeshFromLocal(p: Float32Array) { return gtMesh(new Float32Array(p)); }
