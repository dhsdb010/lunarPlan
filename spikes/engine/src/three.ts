import { params, runHarness, type SpikeEngine } from './shared';
import { buildThree } from './threeScene';

async function main() {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const q = new URLSearchParams(location.search);
  const t = await buildThree(canvas, {
    webgl: params.webgl,
    shadows: params.shadows,
    csm: !params.csm ? 'off' : q.get('csmex') === '0' ? 'legacy' : 'example',
    maxFar: Number(q.get('maxfar') ?? 20_000),
    mode: (q.get('mode') ?? 'logarithmic') as 'logarithmic',
    largeWorld: params.largeWorld,
  });
  t.setSun(params.sunElDeg, params.sunAzDeg);
  const spike: SpikeEngine = {
    name: 'three', backend: (t.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2', canvas,
    async renderAt(offsetM, step) { t.frame(params.view, offsetM, step); },
  };
  await runHarness(spike);
}

main();
