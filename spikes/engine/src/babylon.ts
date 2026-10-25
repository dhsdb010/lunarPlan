// Deep imports keep the bundle tree-shaken (decision 001, condition 3).
import { Engine } from '@babylonjs/core/Engines/engine';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/2.0';
import { cameraRig, LM_SPAN_M, lmSite, loadTile, params, runHarness, sunDir, type SpikeEngine, type Tile } from './shared';

function terrainMesh(t: Tile, scene: Scene): Mesh {
  const n = t.samples, pos: number[] = [], idx: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.push(i * t.spacingM, t.heights[j * n + i], j * t.spacingM);
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, b, c, b, d, c); // Babylon is left-handed: clockwise from above is front-facing

  }
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);
  const vd = new VertexData();
  Object.assign(vd, { positions: pos, indices: idx, normals });
  const m = new Mesh('terrain', scene);
  vd.applyToMesh(m);
  const mat = new StandardMaterial('regolith', scene);
  mat.diffuseColor = new Color3(0.55, 0.55, 0.55);
  mat.specularColor = Color3.Black();
  m.material = mat;
  m.receiveShadows = true;
  return m;
}

async function main() {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const opts = { antialias: true, useLargeWorldRendering: params.largeWorld, preserveDrawingBuffer: true };
  let engine: Engine | WebGPUEngine;
  if (!params.webgl && (await WebGPUEngine.IsSupportedAsync)) {
    engine = new WebGPUEngine(canvas, opts);
    await (engine as WebGPUEngine).initAsync();
  } else {
    engine = new Engine(canvas, true, opts);
  }
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 1);

  const tile = await loadTile();
  const terrain = terrainMesh(tile, scene);

  const lm = new TransformNode('lm', scene);
  const res = await ImportMeshAsync('models/apollo_lm.glb', scene);
  res.meshes[0].parent = lm;
  const { min, max } = res.meshes[0].getHierarchyBoundingVectors(true);
  const s = LM_SPAN_M / Math.max(max.x - min.x, max.z - min.z);
  lm.scaling.setAll(s);
  res.meshes[0].position.y = -min.y; // footpads on y = 0

  const [dx, dy, dz] = sunDir(params.sunElDeg, params.sunAzDeg);
  const sun = new DirectionalLight('sun', new Vector3(dx, dy, dz), scene);
  sun.intensity = 3;
  const earthshine = new HemisphericLight('earthshine', new Vector3(0, 1, 0), scene);
  earthshine.intensity = 0.02;

  const camera = new FreeCamera('cam', Vector3.Zero(), scene);
  camera.minZ = 0.05;

  const csm = new CascadedShadowGenerator(2048, sun);
  csm.numCascades = 4;
  csm.stabilizeCascades = params.stab;
  csm.lambda = 0.9;
  csm.shadowMaxZ = 20_000;
  csm.usePercentageCloserFiltering = true;
  csm.filteringQuality = CascadedShadowGenerator.QUALITY_HIGH;
  const q = new URLSearchParams(location.search);
  csm.bias = Number(q.get('bias') ?? 0.004);
  csm.normalBias = Number(q.get('nbias') ?? 0.02);
  csm.depthClamp = true;
  csm.autoCalcDepthBounds = q.get('adb') === '1'; // tighter per-cascade depth range -> less acne at low bias
  csm.addShadowCaster(terrain);
  for (const m of res.meshes) { csm.addShadowCaster(m); m.receiveShadows = true; }
  sun.shadowEnabled = params.shadows;

  const spike: SpikeEngine = {
    name: 'babylon', backend: engine instanceof WebGPUEngine ? 'webgpu' : 'webgl2', canvas,
    async renderAt(offsetM, step) {
      terrain.position.set(offsetM, 0, 0);
      const site = lmSite(tile, offsetM);
      lm.position.set(...site);
      const rig = cameraRig(params.view, site, step);
      camera.position.set(...rig.eye);
      camera.setTarget(new Vector3(...rig.target));
      camera.minZ = rig.near; camera.maxZ = rig.far;
      sun.position = new Vector3(...site).subtract(new Vector3(dx, dy, dz).scale(5000));
      // We drive frames ourselves (no runRenderLoop), so open/close the frame explicitly:
      // WebGPU only submits the command buffer in endFrame().
      engine.beginFrame();
      scene.render();
      engine.endFrame();
    },
    ready: () => scene.whenReadyAsync(),
  };
  Object.assign(window, { __scene: scene, __engine: engine, __e: spike });
  window.addEventListener('resize', () => engine.resize());
  await runHarness(spike);
}

main();
