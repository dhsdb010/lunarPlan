// lunarPlan verifier worker: subscribes to pending runs on SpacetimeDB Maincloud, replays each
// input log with the same flight-core WASM the browser ran, and posts the verified result.
// Runs with the module publisher's token (the only identity verifyRun accepts).
import { readFileSync } from 'node:fs';
import { FlightCore, S } from '../../web/src/flight';
import { DbConnection } from '../../web/src/module_bindings';

const dir = new URL('../assets/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('shackleton_rim_2km.json', dir), 'utf8'));
const heights = new Float32Array(readFileSync(new URL('shackleton_rim_2km.f32', dir)).buffer.slice(0));
const core = await FlightCore.load(readFileSync(new URL('flight_core.wasm', dir)), { samples: meta.samples, spacing: meta.spacing_m, heights });

const token = process.env.SPACETIME_TOKEN;
if (!token) throw new Error('SPACETIME_TOKEN missing');
const done = new Set<bigint>();

const conn = DbConnection.builder()
  .withUri(process.env.STDB_URI ?? 'wss://maincloud.spacetimedb.com')
  .withDatabaseName(process.env.STDB_DB ?? 'lunarplan-dhsdb010')
  .withToken(token)
  .onConnect((c, id) => {
    console.log('verifier connected as', id.toHexString());
    c.subscriptionBuilder().onApplied(() => { for (const r of c.db.run.iter()) check(r); }).subscribe(["SELECT * FROM run WHERE status = 'pending'"]);
  })
  .onDisconnect(() => { console.error('disconnected; exiting so the platform restarts us'); process.exit(1); })
  .onConnectError((_c, e) => { console.error('connect error', e); process.exit(1); })
  .build();

type Run = { id: bigint; seed: number; status: string; inputLog: Uint8Array | number[]; claimedTier: number; claimedMarginDs: number };
function check(r: Run) {
  if (r.status !== 'pending' || done.has(r.id)) return;
  done.add(r.id);
  const s = core.replay(r.seed, Uint8Array.from(r.inputLog));
  const tier = s[S.tier], marginDs = Math.round(s[S.margin] * 10), distDm = Math.round(s[S.dist] * 10);
  const ok = s[S.status] === 1 && tier > 0 && tier === r.claimedTier && marginDs === r.claimedMarginDs;
  console.log(`run ${r.id} seed ${r.seed}: replay tier ${tier} margin ${marginDs / 10}s dist ${distDm / 10}m claimed ${r.claimedTier}/${r.claimedMarginDs / 10}s -> ${ok ? 'VERIFIED' : 'REJECTED'}`);
  conn.reducers.verifyRun({ runId: r.id, ok, tier, marginDs, distDm });
}
conn.db.run.onInsert((_ctx, r) => check(r));
