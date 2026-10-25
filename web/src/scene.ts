// Babylon.js scene (renderer baseline per decision 001): real LOLA Shackleton-rim tile, NASA LM,
// low South Pole sun with cascaded shadows. The renderer only reads flight-core state.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import '@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput';
import '@babylonjs/core/Cameras/Inputs/arcRotateCameraMouseWheelInput';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/2.0';
import { BITS, S, type Tile } from './flight';

export const ASSET = (p: string) => `${import.meta.env.VITE_ASSET_BASE ?? ''}${p}`;
const LM_SPAN_M = 2 * 4.256 + 0.91;
/** Camera views. orbit = mouse-driven 3D view around the LM. */
export const VIEWS = ['orbit', 'chase', 'window', 'overhead'] as const;
export type View = (typeof VIEWS)[number];
/** Commander's eye relative to the footpad plane, in the LM body frame (m): up, forward, left. */
const CDR_EYE = { up: 4.7, fwd: 2.6, left: 0.6 };

function terrainMesh(t: Tile, scene: Scene): Mesh {
  const n = t.samples, pos: number[] = [], idx: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.push(i * t.spacing, t.heights[j * n + i], j * t.spacing);
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, b, c, b, d, c); // same b-c diagonal as flight-core's height(); left-handed winding
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);
  const vd = new VertexData(); Object.assign(vd, { positions: pos, indices: idx, normals });
  const m = new Mesh('terrain', scene); vd.applyToMesh(m);
  const mat = new StandardMaterial('regolith', scene);
  mat.diffuseColor = new Color3(0.6, 0.6, 0.6); mat.specularColor = Color3.Black();
  m.material = mat; m.receiveShadows = true;
  return m;
}

export async function buildScene(canvas: HTMLCanvasElement, tile: Tile) {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 1);
  terrainMesh(tile, scene);

  const lm = new TransformNode('lm', scene);
  const res = await ImportMeshAsync(ASSET('models/apollo_lm.glb'), scene);
  res.meshes[0].parent = lm;
  const { min, max } = res.meshes[0].getHierarchyBoundingVectors(true);
  lm.scaling.setAll(LM_SPAN_M / Math.max(max.x - min.x, max.z - min.z));
  res.meshes[0].position.y = -min.y; // footpads at the node origin (= flight-core pos.y)

  const target = MeshBuilder.CreateTorus('target', { diameter: 12, thickness: 0.5, tessellation: 48 }, scene);
  const tm = new StandardMaterial('targetMat', scene);
  tm.emissiveColor = new Color3(0.2, 1, 0.4); tm.disableLighting = true; target.material = tm;
  target.renderingGroupId = 1; // drawn over the terrain so slopes never hide the landing ring

  // RCS: 4 thruster quads on the ascent stage's diagonals (body frame: x right, y up, z forward).
  // Plumes are stylised (real RCS exhaust is nearly invisible in vacuum) so the pilot sees the jets fire.
  const rcs = new TransformNode('rcs', scene);
  const plumeMat = new StandardMaterial('plume', scene);
  plumeMat.emissiveColor = new Color3(0.85, 0.92, 1); plumeMat.disableLighting = true; plumeMat.alpha = 0.55;
  type Dir = 'fwd' | 'aft' | 'left' | 'right' | 'up' | 'down';
  const DIRS: Record<Dir, Vector3> = { fwd: new Vector3(0, 0, 1), aft: new Vector3(0, 0, -1), left: new Vector3(-1, 0, 0), right: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0), down: new Vector3(0, -1, 0) };
  const QUADS = [new Vector3(2.0, 4.6, 2.0), new Vector3(-2.0, 4.6, 2.0), new Vector3(-2.0, 4.6, -2.0), new Vector3(2.0, 4.6, -2.0)]; // FR, FL, AL, AR
  const plumes = QUADS.map((q, qi) => Object.fromEntries((Object.keys(DIRS) as Dir[]).map((d) => {
    const m = MeshBuilder.CreateCylinder(`rcs${qi}${d}`, { diameterTop: 0.08, diameterBottom: 0.55, height: 1.6, tessellation: 10 }, scene);
    m.material = plumeMat; m.parent = rcs; m.isPickable = false; m.setEnabled(false);
    const dir = DIRS[d];
    m.position.copyFrom(q.add(dir.scale(0.8 + 0.35))); // nozzle 0.35 m out from the quad, cone grows along the jet
    // the cylinder's +Y axis points along the exhaust
    const axis = Vector3.Cross(new Vector3(0, 1, 0), dir);
    if (axis.length() > 1e-6) m.rotationQuaternion = Quaternion.RotationAxis(axis.normalize(), Math.acos(Math.max(-1, Math.min(1, dir.y))));
    else if (dir.y < 0) m.rotationQuaternion = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI);
    return [d, m];
  })) as Record<Dir, Mesh>);
  /** Which quads fire which way for a command (exhaust points opposite to the push). */
  const firing = (bits: number) => {
    const on: [number, Dir][] = [];
    const all = (d: Dir) => [0, 1, 2, 3].forEach((q) => on.push([q, d]));
    if (bits & BITS.TR_FWD) all('aft');
    if (bits & BITS.TR_AFT) all('fwd');
    if (bits & BITS.TR_RIGHT) all('left');
    if (bits & BITS.TR_LEFT) all('right');
    // rotation: opposing up/down jets on the front/aft (pitch) or left/right (roll) quads; tangential for yaw
    if (bits & BITS.PITCH_UP) { on.push([2, 'down'], [3, 'down'], [0, 'up'], [1, 'up']); }
    if (bits & BITS.PITCH_DN) { on.push([0, 'down'], [1, 'down'], [2, 'up'], [3, 'up']); }
    if (bits & BITS.ROLL_R) { on.push([1, 'down'], [2, 'down'], [0, 'up'], [3, 'up']); }
    if (bits & BITS.ROLL_L) { on.push([0, 'down'], [3, 'down'], [1, 'up'], [2, 'up']); }
    if (bits & BITS.YAW_R) { on.push([0, 'left'], [2, 'right'], [1, 'fwd'], [3, 'aft']); }
    if (bits & BITS.YAW_L) { on.push([0, 'fwd'], [2, 'aft'], [1, 'right'], [3, 'left']); }
    return on;
  };

  const sun = new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
  sun.intensity = 3;
  new HemisphericLight('earthshine', new Vector3(0, 1, 0), scene).intensity = 0.03;
  const csm = new CascadedShadowGenerator(2048, sun);
  Object.assign(csm, { numCascades: 4, stabilizeCascades: true, lambda: 0.9, shadowMaxZ: 3000, bias: 0.004, normalBias: 0.05, depthClamp: true });
  csm.usePercentageCloserFiltering = true;
  for (const m of res.meshes) { csm.addShadowCaster(m); m.receiveShadows = true; }

  const camera = new FreeCamera('cam', new Vector3(0, 10, 0), scene);
  camera.fov = Math.PI / 3; camera.minZ = 0.05; camera.maxZ = 30_000;
  camera.inputs.clear(); // scripted views: positioned every frame
  const orbit = new ArcRotateCamera('orbit', -Math.PI / 2, 1.2, 40, Vector3.Zero(), scene);
  Object.assign(orbit, { lowerRadiusLimit: 12, upperRadiusLimit: 600, lowerBetaLimit: 0.15, upperBetaLimit: 1.55, wheelPrecision: 4, minZ: 0.1, maxZ: 30_000, fov: Math.PI / 3 });
  // mouse only: the arrow keys belong to the RHC (pitch/yaw), so drop the camera's keyboard input
  orbit.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
  orbit.attachControl(canvas, true);
  scene.activeCamera = orbit;

  // Nadir camera: just under the descent stage, looking straight down (LM forward at the top).
  // Renders into a small texture on demand; the depth panel reads it back for Depth Anything.
  const NADIR = 256;
  const nadirCam = new FreeCamera('nadir', new Vector3(0, 0, 0), scene);
  nadirCam.inputs.clear(); nadirCam.fov = (70 * Math.PI) / 180; nadirCam.minZ = 0.05; nadirCam.maxZ = 5000;
  const nadirRtt = new RenderTargetTexture('nadirRtt', NADIR, scene, false);
  nadirRtt.activeCamera = nadirCam; nadirRtt.renderList = null; nadirRtt.clearColor = new Color4(0, 0, 0, 1);
  nadirRtt.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  scene.customRenderTargets.push(nadirRtt);
  let nadirWant = null as ((px: Uint8ClampedArray<ArrayBuffer>) => void) | null;
  /** Grab one nadir frame (RGBA, top row first) at the next render. */
  const nadirFrame = () => new Promise<Uint8ClampedArray<ArrayBuffer>>((res) => { nadirWant = res; nadirRtt.resetRefreshCounter(); });

  let view: View = 'orbit';
  const setSun = (azDeg: number, elDeg: number) => {
    const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
    sun.direction = new Vector3(-Math.cos(el) * Math.sin(az), -Math.sin(el), -Math.cos(el) * Math.cos(az));
  };
  const groundAt = (x: number, z: number) => {
    const n = tile.samples, i = Math.max(0, Math.min(n - 1, Math.round(x / tile.spacing))), j = Math.max(0, Math.min(n - 1, Math.round(z / tile.spacing)));
    return tile.heights[j * n + i];
  };
  const setTarget = (x: number, z: number) => target.position.set(x, groundAt(x, z) + 0.3, z);

  // Guidance: a dotted line of glowing ground dots from under the LM to the target ring (follows the terrain).
  const dotMat = new StandardMaterial('dot', scene);
  dotMat.emissiveColor = new Color3(0.49, 1, 0.63); dotMat.disableLighting = true;
  const DOT_SPACING = 4, MAX_DOTS = 60;
  const dots = Array.from({ length: MAX_DOTS }, (_, i) => {
    const d = MeshBuilder.CreateSphere(`dot${i}`, { diameter: 0.9, segments: 6 }, scene);
    d.material = dotMat; d.isPickable = false; d.setEnabled(false); d.renderingGroupId = 1;
    return d;
  });
  const placeDots = () => {
    const a = lm.position, b = target.position, dist = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.min(MAX_DOTS, Math.floor(dist / DOT_SPACING));
    dots.forEach((d, i) => {
      if (i >= n) { d.setEnabled(false); return; }
      const f = (i + 0.5) / Math.max(1, n), x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
      d.position.set(x, groundAt(x, z) + 0.5, z); d.setEnabled(true);
    });
  };
  // and a dashed drop line from the LM straight down to the ground (height above the surface)
  let drop: LinesMesh = MeshBuilder.CreateDashedLines('drop', { points: [Vector3.Zero(), Vector3.Up()], dashNb: 20, dashSize: 2, gapSize: 2, updatable: true }, scene);
  drop.color = new Color3(0.33, 0.8, 1); drop.isPickable = false;
  drop.alwaysSelectAsActiveMesh = true; // its bounding box was built at the origin; never frustum-cull it

  /** Screen position of the target (CSS px), or an edge direction when it is off-screen/behind. */
  const targetScreen = () => {
    const cam = scene.activeCamera!;
    const w = engine.getRenderWidth(), h = engine.getRenderHeight();
    const p = Vector3.Project(target.position, Matrix.Identity(), scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
    const behind = Vector3.Dot(target.position.subtract(cam.globalPosition), cam.getDirection(Vector3.Forward())) < 0;
    const sx = canvas.clientWidth / w, sy = canvas.clientHeight / h;
    return { x: p.x * sx, y: p.y * sy, behind };
  };

  /** Pose the LM and camera from a flight-core state vector, then render. */
  const draw = (s: Float64Array, bits = 0) => {
    const yaw = s[S.yaw];
    lm.position.set(s[S.x], s[S.y], s[S.z]);
    // Babylon applies Y (yaw), then X (pitch), then Z (roll): body-frame attitude, like flight-core
    lm.rotation.set(s[S.pitch], yaw, -s[S.roll]);
    rcs.position.copyFrom(lm.position); rcs.rotation.copyFrom(lm.rotation);
    placeDots();
    drop = MeshBuilder.CreateDashedLines('drop', { points: [lm.position.clone(), new Vector3(lm.position.x, groundAt(lm.position.x, lm.position.z) + 0.2, lm.position.z)], instance: drop });
    for (const q of plumes) for (const m of Object.values(q)) m.setEnabled(false);
    if (!s[S.status]) for (const [q, d] of firing(bits)) {
      const m = plumes[q][d];
      m.setEnabled(true);
      m.scaling.setAll(0.75 + Math.random() * 0.45); // pulsed jets flicker
    }
    const p = lm.position;
    const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    if (view === 'chase' || view === 'window') camera.upVector = new Vector3(0, 1, 0);
    if (view === 'orbit') {
      orbit.target.copyFrom(p.add(new Vector3(0, 3, 0)));
    } else if (view === 'chase') {
      const vx = s[S.vx], vz = s[S.vz], l = Math.hypot(vx, vz);
      const dir = l > 0.3 ? new Vector3(vx / l, 0, vz / l) : fwd;
      camera.position.copyFrom(p.subtract(dir.scale(28)).add(new Vector3(0, 9, 0)));
      camera.setTarget(p.add(new Vector3(0, 2, 0)));
    } else if (view === 'window') {
      // Commander's left window: eye just outside the glass, looking forward and ~25 deg down,
      // tilting with the LM's attitude like the real cockpit did.
      lm.computeWorldMatrix(true);
      const m = lm.getWorldMatrix(), sc = lm.scaling.x;
      const local = new Vector3(-CDR_EYE.left, CDR_EYE.up, CDR_EYE.fwd).scale(1 / sc);
      camera.position.copyFrom(Vector3.TransformCoordinates(local, m));
      const look = Vector3.TransformNormal(new Vector3(0, -0.47, 1), m).normalize();
      camera.setTarget(camera.position.add(look));
    } else {
      // overhead: straight down, LM forward at the top of the screen
      camera.upVector = fwd;
      camera.position.copyFrom(p.add(new Vector3(0, 70, 0)));
      camera.setTarget(p);
    }
    nadirCam.upVector = fwd;
    nadirCam.position.set(p.x, p.y - 0.5, p.z);
    nadirCam.setTarget(new Vector3(p.x, p.y - 100, p.z));
    nadirCam.getViewMatrix(true);
    scene.render();
    if (nadirWant) {
      const done = nadirWant; nadirWant = null;
      void nadirRtt.readPixels()!.then((buf) => {
        // GL reads bottom row first: flip to top-down
        const src = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), out = new Uint8ClampedArray(NADIR * NADIR * 4), row = NADIR * 4;
        for (let y = 0; y < NADIR; y++) out.set(src.subarray((NADIR - 1 - y) * row, (NADIR - y) * row), y * row);
        done(out);
      });
    }
  };
  const setView = (v: View) => {
    view = v;
    scene.activeCamera = v === 'orbit' ? orbit : camera;
    return view;
  };
  const toggleView = () => setView(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]);
  addEventListener('resize', () => engine.resize());
  await scene.whenReadyAsync();
  return { engine, scene, draw, setSun, setTarget, toggleView, setView, targetScreen, canvas, nadirFrame, NADIR };
}
