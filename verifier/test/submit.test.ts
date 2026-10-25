// End-to-end check of the deployed verifier: fly a landing with the browser's recorder, submit it
// to Maincloud as a fresh anonymous player, and wait for the run to be verified by the worker.
import { readFileSync } from 'node:fs';
import { BITS, FlightCore, S, dailySeed } from '../../web/src/flight';
import { DbConnection } from '../../web/src/module_bindings';

const dir = new URL('../assets/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('shackleton_rim_2km.json', dir), 'utf8'));
const heights = new Float32Array(readFileSync(new URL('shackleton_rim_2km.f32', dir)).buffer.slice(0));
const core = await FlightCore.load(readFileSync(new URL('flight_core.wasm', dir)), { samples: meta.samples, spacing: meta.spacing_m, heights });

const seed = dailySeed();
const f = core.newFlight(seed);
let s = f.state(), step = 0;
while (!s[S.status]) {
  let b = 0;
  if (s[S.contact]) b = BITS.ENGINE_STOP;
  else {
    const c = (v: number, m: number) => Math.max(-m, Math.min(m, v));
    const wr = c((c((s[S.targetX] - s[S.x]) * 0.06, 3) - s[S.vx]) * 0.12, 0.2), wp = c((c((s[S.targetZ] - s[S.z]) * 0.06, 3) - s[S.vz]) * 0.12, 0.2);
    if (s[S.roll] < wr - 0.01) b |= BITS.ROLL_R; else if (s[S.roll] > wr + 0.01) b |= BITS.ROLL_L;
    if (s[S.pitch] < wp - 0.01) b |= BITS.PITCH_UP; else if (s[S.pitch] > wp + 0.01) b |= BITS.PITCH_DN;
    if ((step >> 4) % 2 === 0 && s[S.vzCmd] < (s[S.agl] > 40 ? -10 : -2.5) * 0.3048 - 0.1) b |= BITS.ROD_UP;
  }
  f.step(b); s = f.state(); step++;
}
console.log(`flew seed ${seed}: tier ${s[S.tier]} margin ${s[S.margin]} s dist ${s[S.dist]} m`);

let runId: bigint | null = null;
const t0 = Date.now();
const conn = DbConnection.builder()
  .withUri('wss://maincloud.spacetimedb.com').withDatabaseName('lunarplan-dhsdb010')
  .onConnect((c, id) => {
    c.subscriptionBuilder().onApplied(() => {
      c.reducers.setName({ name: 'FLY-CHECK' });
      c.reducers.submitRun({ seed, mode: 'final-approach-v2', inputLog: f.inputLog(), claimedTier: s[S.tier], claimedMarginDs: Math.round(s[S.margin] * 10) });
    }).subscribe([`SELECT * FROM run WHERE owner = '0x${id.toHexString()}'`]);
  })
  .build();
conn.db.run.onInsert((_c, r) => { runId = r.id; console.log(`submitted run ${r.id} (status ${r.status})`); });
conn.db.run.onUpdate((_c, _old, r) => {
  if (r.id !== runId) return;
  console.log(`run ${r.id} -> ${r.status.toUpperCase()} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(r.status === 'verified' ? 0 : 1);
});
setTimeout(() => { console.error('timed out waiting for the verifier'); process.exit(2); }, 60_000);
