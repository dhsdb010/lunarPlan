// lunarPlan leaderboard module (SpacetimeDB Maincloud). Clients submit input logs; only the
// verifier (the publishing identity) can turn a run into a score, after replaying it with the
// deterministic flight core (crates/flight-core). See PLAN.md §4.
import { schema, table, t, SenderError } from 'spacetimedb/server';

const spacetimedb = schema({
  config: table(
    {},
    {
      id: t.u32().primaryKey(),
      verifier: t.identity(),
    }
  ),
  player: table(
    { public: true },
    {
      identity: t.identity().primaryKey(),
      name: t.string(),
    }
  ),
  run: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      owner: t.identity().index('btree'),
      seed: t.u32(),
      mode: t.string(),
      inputLog: t.array(t.u8()),
      claimedTier: t.u8(),
      claimedMarginDs: t.i32(), // deciseconds of hover margin
      status: t.string(), // pending | verified | rejected
      submittedAt: t.timestamp(),
    }
  ),
  score: table(
    { public: true },
    {
      runId: t.u64().primaryKey(),
      owner: t.identity(),
      name: t.string(),
      seed: t.u32().index('btree'),
      tier: t.u8(), // 0 NO-GO, 1 GO, 2 EAGLE (decision 002)
      marginDs: t.i32(),
      distDm: t.i32(), // decimetres to target
      verifiedAt: t.timestamp(),
    }
  ),
});
export default spacetimedb;

export const init = spacetimedb.init((ctx) => {
  // The publisher's identity is the verifier (the worker runs with the publisher's token).
  ctx.db.config.insert({ id: 0, verifier: ctx.sender });
});

const MAX_LOG = 64 * 1024; // a 5-minute flight logs a few KB

export const setName = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const clean = name.trim().slice(0, 20);
  if (!/^[\w .-]{2,20}$/.test(clean)) throw new SenderError('name: 2-20 letters, digits, space, . _ -');
  const row = ctx.db.player.identity.find(ctx.sender);
  if (row) ctx.db.player.identity.update({ ...row, name: clean });
  else ctx.db.player.insert({ identity: ctx.sender, name: clean });
});

export const submitRun = spacetimedb.reducer(
  { seed: t.u32(), mode: t.string(), inputLog: t.array(t.u8()), claimedTier: t.u8(), claimedMarginDs: t.i32() },
  (ctx, a) => {
    if (a.inputLog.length > MAX_LOG || a.inputLog.length % 4 !== 0) throw new SenderError('bad input log'); // (u16 wait, u16 bits)
    if (a.mode !== 'final-approach-v2') throw new SenderError('unknown mode (reload the game)');
    ctx.db.run.insert({ id: 0n, owner: ctx.sender, ...a, status: 'pending', submittedAt: ctx.timestamp });
  }
);

export const verifyRun = spacetimedb.reducer(
  { runId: t.u64(), ok: t.bool(), tier: t.u8(), marginDs: t.i32(), distDm: t.i32() },
  (ctx, a) => {
    const cfg = ctx.db.config.id.find(0);
    if (!cfg || !cfg.verifier.equals(ctx.sender)) throw new SenderError('verifier only');
    const run = ctx.db.run.id.find(a.runId);
    if (!run || run.status !== 'pending') throw new SenderError('no pending run');
    ctx.db.run.id.update({ ...run, status: a.ok ? 'verified' : 'rejected' });
    if (!a.ok) return;
    const name = ctx.db.player.identity.find(run.owner)?.name ?? 'anonymous';
    ctx.db.score.insert({
      runId: run.id, owner: run.owner, name, seed: run.seed,
      tier: a.tier, marginDs: a.marginDs, distDm: a.distDm, verifiedAt: ctx.timestamp,
    });
  }
);
