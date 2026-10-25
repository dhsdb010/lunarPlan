// SpacetimeDB Maincloud client: anonymous identity (token kept in localStorage), username,
// run submission and the live leaderboard for today's seed (PLAN §4, decision 002).
import { DbConnection } from './module_bindings';

export const DB_URI = import.meta.env.VITE_STDB_URI ?? 'wss://maincloud.spacetimedb.com';
export const DB_NAME = import.meta.env.VITE_STDB_DB ?? 'lunarplan-dhsdb010';
const TOKEN_KEY = 'lunarplan.token';

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) ?? undefined; } catch { return undefined; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: anonymous each visit */ } },
};

export interface Board { name: string; tier: number; marginDs: number; distDm: number; mine: boolean }

export function connect(onChange: () => void) {
  let me = '';
  const conn = DbConnection.builder()
    .withUri(DB_URI)
    .withDatabaseName(DB_NAME)
    .withToken(store.get(TOKEN_KEY))
    .onConnect((c, identity, token) => {
      store.set(TOKEN_KEY, token);
      me = identity.toHexString();
      c.subscriptionBuilder().onApplied(onChange).subscribe(['SELECT * FROM score', 'SELECT * FROM player', 'SELECT * FROM run']);
    })
    .onConnectError((_c, e) => console.warn('SpacetimeDB connect error', e))
    .build();
  conn.db.score.onInsert(onChange);
  conn.db.run.onUpdate(onChange);
  conn.db.run.onInsert(onChange);
  conn.db.player.onInsert(onChange);
  conn.db.player.onUpdate(onChange);

  return {
    get ready() { return me !== ''; },
    myName: () => [...conn.db.player.iter()].find((p) => p.identity.toHexString() === me)?.name,
    setName: (name: string) => conn.reducers.setName({ name }),
    submit: (seed: number, log: Uint8Array, tier: number, marginS: number) =>
      conn.reducers.submitRun({ seed, mode: 'final-approach-v2', inputLog: log, claimedTier: tier, claimedMarginDs: Math.round(marginS * 10) }),
    myLatestRun: () => [...conn.db.run.iter()].filter((r) => r.owner.toHexString() === me).sort((a, b) => Number(b.id - a.id))[0],
    board: (seed: number): Board[] => [...conn.db.score.iter()]
      .filter((s) => s.seed === seed)
      .sort((a, b) => b.tier - a.tier || b.marginDs - a.marginDs || a.distDm - b.distDm)
      .slice(0, 20)
      .map((s) => ({ name: s.name, tier: s.tier, marginDs: s.marginDs, distDm: s.distDm, mine: s.owner.toHexString() === me })),
  };
}
