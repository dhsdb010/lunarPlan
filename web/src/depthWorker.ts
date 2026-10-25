// Depth Anything V2 (Small, Apache-2.0) via transformers.js, off the main thread.
// In: RGBA frame. Out: colormapped relative depth (near = warm, far = dark), same size.
import { pipeline, RawImage, env } from '@huggingface/transformers';

type Est = (img: RawImage) => Promise<{ depth: RawImage }>;
const MODEL = 'onnx-community/depth-anything-v2-small';
env.allowLocalModels = false;
// model files are mirrored on our R2 bucket (Apache-2.0), so the game doesn't depend on the HF hub at runtime
if (import.meta.env.VITE_ASSET_BASE) env.remoteHost = `${import.meta.env.VITE_ASSET_BASE}hf/`;
// the ONNX runtime wasm (~26 MB) is over the Workers asset limit: load it from the CDN
env.backends.onnx.wasm!.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/';
let est: Est | null = null;

async function load(): Promise<string> {
  const progress = (p: { status: string; progress?: number }) => {
    if (p.status === 'progress' && p.progress != null) postMessage({ type: 'progress', pct: p.progress });
  };
  if ((navigator as unknown as { gpu?: unknown }).gpu) {
    try {
      est = (await pipeline('depth-estimation', MODEL, { device: 'webgpu', dtype: 'fp16', progress_callback: progress })) as unknown as Est;
      return 'WebGPU fp16';
    } catch { /* fall through to CPU */ }
  }
  est = (await pipeline('depth-estimation', MODEL, { device: 'wasm', dtype: 'q8', progress_callback: progress })) as unknown as Est;
  return 'WASM q8';
}

// "inferno"-like ramp, 5 stops
const STOPS = [[0, 0, 4], [87, 16, 110], [188, 55, 84], [249, 142, 9], [252, 255, 164]];
const ramp = (t: number, o: Uint8ClampedArray, i: number) => {
  const f = Math.min(0.9999, Math.max(0, t)) * (STOPS.length - 1), k = Math.floor(f), u = f - k, a = STOPS[k], b = STOPS[k + 1];
  o[i] = a[0] + (b[0] - a[0]) * u; o[i + 1] = a[1] + (b[1] - a[1]) * u; o[i + 2] = a[2] + (b[2] - a[2]) * u; o[i + 3] = 255;
};

let ready: Promise<string> | null = null;
onmessage = async (e: MessageEvent<{ px: Uint8ClampedArray; w: number; h: number }>) => {
  try {
    ready ??= load().then((backend) => { postMessage({ type: 'ready', backend }); return backend; });
    await ready;
    const { px, w, h } = e.data, t0 = performance.now();
    // the regolith is dark and low-contrast: stretch levels so the model sees texture
    let mn = 255, mx = 0;
    for (let i = 0; i < px.length; i += 4) { const v = px[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const k = 255 / Math.max(1, mx - mn), inp = new Uint8ClampedArray(px.length);
    for (let i = 0; i < px.length; i++) inp[i] = (i & 3) === 3 ? 255 : (px[i] - mn) * k;
    const { depth } = await est!(new RawImage(inp, w, h, 4));
    const d = depth.width === w && depth.height === h ? depth : await depth.resize(w, h);
    const src = d.data as Uint8Array, out = new Uint8ClampedArray(w * h * 4);
    let lo = 255, hi = 0;
    for (let i = 0; i < w * h; i++) { const v = src[i * d.channels]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < w * h; i++) ramp((src[i * d.channels] - lo) / span, out, i * 4);
    postMessage({ type: 'depth', px: out, w, h, ms: performance.now() - t0 }, { transfer: [out.buffer] });
  } catch (err) {
    postMessage({ type: 'error', msg: String((err as Error)?.message ?? err) });
  }
};
