// Side-by-side nadir panel: the raw down-looking camera on the left, Depth Anything V2's depth on the right.
type Scene = { nadirFrame: () => Promise<Uint8ClampedArray<ArrayBuffer>>; NADIR: number };

export function depthPanel(view: Scene) {
  const $ = (id: string) => document.getElementById(id)!;
  const panel = $('depthPanel'), status = $('depthStatus');
  const raw = ($('nadirRaw') as HTMLCanvasElement).getContext('2d')!, dep = ($('nadirDepth') as HTMLCanvasElement).getContext('2d')!;
  const N = view.NADIR;
  let worker: Worker | null = null, busy = false, on = false, frames = 0;

  const startWorker = () => {
    worker = new Worker(new URL('./depthWorker.ts', import.meta.url), { type: 'module' });
    status.textContent = 'loading Depth Anything V2 (small)…';
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') status.textContent = `downloading model… ${m.pct.toFixed(0)}%`;
      else if (m.type === 'ready') status.textContent = `model ready · ${m.backend}`;
      else if (m.type === 'error') { status.textContent = `depth error: ${m.msg}`; busy = false; }
      else if (m.type === 'depth') {
        dep.putImageData(new ImageData(m.px, m.w, m.h), 0, 0);
        frames++; busy = false;
        status.textContent = `${m.ms.toFixed(0)} ms / frame · ${frames} frames`;
        (window as unknown as { __depth?: unknown }).__depth = { frames, ms: m.ms };
      }
    };
  };

  // one inference in flight; the raw feed updates every grab
  const tick = async () => {
    if (!on) return;
    const px = await view.nadirFrame();
    raw.putImageData(new ImageData(px, N, N), 0, 0);
    if (!busy && worker) { busy = true; worker.postMessage({ px, w: N, h: N }); }
    setTimeout(tick, 100);
  };

  const toggle = () => {
    on = !on;
    panel.classList.toggle('show', on);
    if (on) { if (!worker) startWorker(); void tick(); }
    return on;
  };
  return { toggle };
}
