// Format check for the 16-bit input log: fly with the browser's recorder (web/src/flight.ts),
// using every control family (RHC incl. yaw, TTCA translation, ROD, ENGINE STOP), then replay
// the log the way the verifier does and require a bit-identical end state.
import { readFileSync } from 'node:fs';
import { BITS, FlightCore, S } from '../../web/src/flight';

const dir = new URL('../assets/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('shackleton_rim_2km.json', dir), 'utf8'));
const heights = new Float32Array(readFileSync(new URL('shackleton_rim_2km.f32', dir)).buffer.slice(0));
const core = await FlightCore.load(readFileSync(new URL('flight_core.wasm', dir)), { samples: meta.samples, spacing: meta.spacing_m, heights });

const seed = 20751;
const f = core.newFlight(seed);
let s = f.state(), step = 0;
while (!s[S.status] && step < 120 * 300) {
  let b = 0;
  if (step < 240) b |= BITS.YAW_R;                       // yaw 10 deg
  if (step > 300 && step < 900) b |= BITS.TR_LEFT;        // RCS translate
  if (s[S.contact]) b = BITS.ENGINE_STOP;
  else {
    const vdx = Math.max(-3, Math.min(3, (s[S.targetX] - s[S.x]) * 0.06)), vdz = Math.max(-3, Math.min(3, (s[S.targetZ] - s[S.z]) * 0.06));
    // steer in the world frame, converted to body pitch/roll with the yaw
    const y = s[S.yaw], ax = (vdx - s[S.vx]) * 0.12, az = (vdz - s[S.vz]) * 0.12;
    const wantRoll = Math.max(-0.2, Math.min(0.2, ax * Math.cos(y) - az * Math.sin(y)));
    const wantPitch = Math.max(-0.2, Math.min(0.2, ax * Math.sin(y) + az * Math.cos(y)));
    if (s[S.roll] < wantRoll - 0.01) b |= BITS.ROLL_R; else if (s[S.roll] > wantRoll + 0.01) b |= BITS.ROLL_L;
    if (s[S.pitch] < wantPitch - 0.01) b |= BITS.PITCH_UP; else if (s[S.pitch] > wantPitch + 0.01) b |= BITS.PITCH_DN;
    const wantVz = s[S.agl] > 40 ? -10 * 0.3048 : -2.5 * 0.3048;
    if ((step >> 4) % 2 === 0 && s[S.vzCmd] < wantVz - 0.1) b |= BITS.ROD_UP;
  }
  f.step(b); s = f.state(); step++;
}
const log = f.inputLog();
const r = core.replay(seed, log);
const same = [S.tier, S.margin, S.dist, S.vv, S.vh, S.att, S.yaw, S.x, S.z].every((k) => Object.is(r[k], s[k]));
console.log(`log ${log.length} B (${log.length / 4} entries, %4=${log.length % 4}), flight tier ${s[S.tier]} margin ${s[S.margin]} dist ${s[S.dist]} yaw ${(s[S.yaw] * 180 / Math.PI).toFixed(1)}deg`);
console.log(`replay tier ${r[S.tier]} margin ${r[S.margin]} dist ${r[S.dist]} -> ${same ? 'BIT-IDENTICAL' : 'MISMATCH'}`);
if (!same || log.length % 4) process.exit(1);
