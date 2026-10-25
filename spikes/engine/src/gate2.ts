// Gate P1-0d entry (REPORT §9, protocol §11): gate2.html?engine=three|babylon&mode=sweep|full[&bias=..&nbias=..&msize=..]
import { GATE_SIZE, q, runGate, type GateEngine, type ShadowCfg } from './gateCore';

const grid = (bias: number[], nbias: number[]) => [2048, 4096].flatMap((msize) => bias.flatMap((b) => nbias.map((nb) => ({ bias: b, nbias: nb, msize, maxFar: 20_000 }))));
// §11: same budget (18 configs) in each engine's own units
const SWEEP = {
  three: grid([-0.00002, -0.0001, -0.0005], [0.01, 0.02, 0.05]),
  babylon: grid([0.0002, 0.001, 0.004], [0.005, 0.02, 0.05]),
};
const DEFAULTS: Record<string, ShadowCfg> = {
  three: { bias: -0.00002, nbias: 0.02, msize: 2048, maxFar: 20_000 },
  babylon: { bias: 0.004, nbias: 0.02, msize: 2048, maxFar: 20_000 },
};

function freshCanvas() {
  const c = document.createElement('canvas');
  c.width = GATE_SIZE[0]; c.height = GATE_SIZE[1];
  document.body.prepend(c);
  return c;
}

async function main() {
  const name = q.get('engine') === 'babylon' ? 'babylon' : 'three';
  document.getElementById('c')?.remove();
  const factory = async (cfg: ShadowCfg): Promise<GateEngine> => name === 'babylon'
    ? (await import('./babylonGate')).babylonGate(freshCanvas(), cfg)
    : (await import('./threeGate')).threeGate(freshCanvas(), cfg);
  Object.assign(window, { __core: await import('./gateCore') });
  await runGate(name, factory, SWEEP[name], DEFAULTS[name]);
}
main();
