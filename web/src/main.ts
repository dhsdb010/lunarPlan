// lunarPlan: P66 Final Approach on the real Shackleton rim. Game loop, HUD, menus, leaderboard.
// ?autopilot=1 flies a scripted landing through the same input path (used for the test video);
// &record=1 records the canvas + HUD and saves it via the dev server.
import { BITS, DT, FlightCore, REASONS, S, TIERS, dailySeed, type Flight } from './flight';
import { ASSET, VIEWS, buildScene } from './scene';
import { connect } from './net';
import { drawInstruments, resetHistory } from './instruments';
import { depthPanel } from './depth';

const q = new URLSearchParams(location.search);
const $ = (id: string) => document.getElementById(id)!;
const FT = 0.3048;

async function loadTile() {
  const [meta, buf] = await Promise.all([
    fetch(ASSET('terrain/shackleton_rim_2km.json')).then((r) => r.json()),
    fetch(ASSET('terrain/shackleton_rim_2km.f32')).then((r) => r.arrayBuffer()),
  ]);
  return { samples: meta.samples as number, spacing: meta.spacing_m as number, heights: new Float32Array(buf) };
}

// ---------- input ----------
const keys = new Set<string>();
const held = new Set<string>(); // on-screen buttons
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.code));
document.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach((b) => {
  const k = b.dataset.hold!;
  b.addEventListener('pointerdown', (e) => { held.add(k); b.setPointerCapture(e.pointerId); });
  b.addEventListener('pointerup', () => held.delete(k));
  b.addEventListener('pointercancel', () => held.delete(k));
});
/**
 * Keyboard layout copied from the SpaceX ISS docking sim, mapped onto the LM crew station:
 * translation W/S up/down (the LM's vertical axis is the rate-of-descent switch), A/D left/right,
 * Q/E back/forward (RCS, TTCA); rotation arrows pitch/yaw and , . roll (RHC); Space = ENGINE STOP.
 */
const CONTROLS: [number, string[], string][] = [
  [BITS.ROD_UP, ['KeyW'], 'up'], [BITS.ROD_DN, ['KeyS'], 'dn'],
  [BITS.TR_LEFT, ['KeyA'], 'tl'], [BITS.TR_RIGHT, ['KeyD'], 'tr'],
  [BITS.TR_AFT, ['KeyQ'], 'ta'], [BITS.TR_FWD, ['KeyE'], 'tf'],
  [BITS.PITCH_UP, ['ArrowUp'], 'pu'], [BITS.PITCH_DN, ['ArrowDown'], 'pd'],
  [BITS.YAW_L, ['ArrowLeft'], 'yl'], [BITS.YAW_R, ['ArrowRight'], 'yr'],
  [BITS.ROLL_L, ['Comma'], 'rl'], [BITS.ROLL_R, ['Period'], 'rr'],
  [BITS.ENGINE_STOP, ['Space'], 'stop'],
];
function pilotBits() {
  let b = 0;
  for (const [bit, codes, btn] of CONTROLS) if (held.has(btn) || codes.some((c) => keys.has(c))) b |= bit;
  return b;
}

// ---------- control feedback: light the matching on-screen button, name the active inputs ----------
const NAMES: Record<number, string> = {
  [BITS.PITCH_UP]: 'PITCH FWD', [BITS.PITCH_DN]: 'PITCH BACK', [BITS.ROLL_L]: 'ROLL LEFT', [BITS.ROLL_R]: 'ROLL RIGHT',
  [BITS.YAW_L]: 'YAW LEFT', [BITS.YAW_R]: 'YAW RIGHT', [BITS.TR_FWD]: 'RCS FWD', [BITS.TR_AFT]: 'RCS BACK',
  [BITS.TR_LEFT]: 'RCS LEFT', [BITS.TR_RIGHT]: 'RCS RIGHT', [BITS.ROD_UP]: 'UP (ROD +1)', [BITS.ROD_DN]: 'DOWN (ROD −1)', [BITS.ENGINE_STOP]: 'ENGINE STOP',
};
let toastTimer = 0;
function showFeedback(bits: number, rodDelta: number) {
  for (const [bit, , btn] of CONTROLS) document.querySelector(`[data-hold="${btn}"]`)?.classList.toggle('on', !!(bits & bit));
  const active = Object.entries(NAMES).filter(([b]) => bits & Number(b)).map(([, n]) => n);
  $('inputs').textContent = active.length ? active.join('  ·  ') : 'no input';
  $('inputs').classList.toggle('live', active.length > 0);
  if (rodDelta) {
    $('toast').textContent = `ROD ${rodDelta > 0 ? '+1' : '−1'} ft/s → sink ${(-$num('rodcmd')).toFixed(0)} ft/s`;
    $('toast').classList.add('show'); clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => $('toast').classList.remove('show'), 900);
  }
}
/** Green target marker over the landing site (like the ISS sim's docking target); edge arrow when off-screen. */
function placeMarker(p: { x: number; y: number; behind: boolean }, dist: number) {
  const m = $('marker'), W = innerWidth, H = innerHeight, pad = 40;
  let { x, y } = p;
  const off = p.behind || x < pad || y < pad || x > W - pad || y > H - pad;
  if (p.behind) { x = W - x; y = H - y; } // mirror so the arrow points the right way
  if (off) {
    const cx = W / 2, cy = H / 2, dx = x - cx, dy = y - cy;
    const k = Math.min((W / 2 - pad) / Math.abs(dx || 1e-6), (H / 2 - pad) / Math.abs(dy || 1e-6));
    x = cx + dx * k; y = cy + dy * k;
    m.style.setProperty('--rot', `${Math.atan2(dy, dx)}rad`);
  }
  m.classList.toggle('off', off);
  m.style.transform = `translate(${x}px, ${y}px)`;
  $('markerDist').textContent = `${dist.toFixed(0)} m`;
}
const nums: Record<string, number> = {};
const $num = (k: string) => nums[k] ?? 0;

/** Scripted pilot: null drift toward the target with attitude, click ROD down to 3 ft/s, stop on contact. */
function autopilotBits(s: Float64Array, step: number) {
  let b = 0;
  if (s[S.contact]) return BITS.ENGINE_STOP;
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  const dx = s[S.targetX] - s[S.x], dz = s[S.targetZ] - s[S.z];
  const vdx = clamp(dx * 0.06, 3), vdz = clamp(dz * 0.06, 3);
  const wantRoll = clamp((vdx - s[S.vx]) * 0.12, 0.2), wantPitch = clamp((vdz - s[S.vz]) * 0.12, 0.2);
  if (s[S.roll] < wantRoll - 0.01) b |= BITS.ROLL_R; else if (s[S.roll] > wantRoll + 0.01) b |= BITS.ROLL_L;
  if (s[S.pitch] < wantPitch - 0.01) b |= BITS.PITCH_UP; else if (s[S.pitch] > wantPitch + 0.01) b |= BITS.PITCH_DN;
  const wantVz = s[S.agl] > 40 ? -10 * FT : -2.5 * FT;
  if ((step >> 4) % 2 === 0 && s[S.vzCmd] < wantVz - 0.1) b |= BITS.ROD_UP;
  return b;
}

// ---------- HUD ----------
function hudLines(s: Float64Array) {
  const f = (v: number, d = 1) => v.toFixed(d);
  return {
    left: [
      ['ALT', `${f(s[S.agl] / FT, 0)} ft`], ['H-DOT', `${f(s[S.vy] / FT)} ft/s`], ['ROD CMD', `${f(s[S.vzCmd] / FT)} ft/s`],
      ['FWD (Z)', `${f(s[S.vz] / FT)} ft/s`], ['LAT (X)', `${f(s[S.vx] / FT)} ft/s`],
      ['TARGET', `${f(Math.hypot(s[S.targetX] - s[S.x], s[S.targetZ] - s[S.z]), 0)} m`],
    ],
    right: [
      ['PITCH', `${f((s[S.pitch] * 180) / Math.PI)}°`], ['ROLL', `${f((s[S.roll] * 180) / Math.PI)}°`],
      ['YAW', `${f(((((s[S.yaw] * 180) / Math.PI) % 360) + 360) % 360, 0)}°`],
      ['THROTTLE', `${f(s[S.throttle] * 100, 0)} %`], ['FUEL', `${f(s[S.prop], 0)} kg`], ['MARGIN', `${f(s[S.prop] / 4.05)} s`],
      ['BINGO', s[S.bingo] >= 0 ? `${f(Math.max(0, s[S.bingo]), 0)} s` : '—'],
    ],
  };
}
function renderHud(s: Float64Array) {
  const h = hudLines(s);
  const row = ([k, v]: string[]) => `<div class="r"><span>${k}</span><b>${v}</b></div>`;
  $('hudL').innerHTML = h.left.map(row).join('');
  $('hudR').innerHTML = h.right.map(row).join('');
  $('lContact').classList.toggle('on', !!s[S.contact]);
  $('lLow').classList.toggle('on', !!s[S.lowLevel]);
  $('lEngine').classList.toggle('on', !s[S.engineOn]);
}

// ---------- recording (canvas + HUD composited) ----------
function recorder(gl: HTMLCanvasElement, getState: () => Float64Array | null) {
  const c = document.createElement('canvas'); c.width = gl.width; c.height = gl.height;
  const g = c.getContext('2d')!;
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 6e6 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  let on = true;
  const paint = () => {
    if (!on) return;
    g.drawImage(gl, 0, 0, c.width, c.height);
    const s = getState();
    if (s) {
      const h = hudLines(s);
      g.font = '600 18px ui-monospace, Menlo, monospace'; g.fillStyle = '#7CFFA0';
      h.left.forEach(([k, v], i) => g.fillText(`${k.padEnd(9)} ${v}`, 24, 60 + i * 26));
      h.right.forEach(([k, v], i) => g.fillText(`${k.padEnd(9)} ${v}`, c.width - 300, 60 + i * 26));
      g.fillStyle = s[S.contact] ? '#5cf' : '#234'; g.fillText('CONTACT LIGHT', 24, c.height - 30);
      g.fillStyle = s[S.lowLevel] ? '#fc4' : '#432'; g.fillText('LOW LEVEL', 220, c.height - 30);
      if (s[S.status]) { g.font = '700 44px ui-monospace, monospace'; g.fillStyle = s[S.tier] === 2 ? '#7CFFA0' : s[S.tier] === 1 ? '#cfe' : '#f66'; g.fillText(TIERS[s[S.tier]], c.width / 2 - 80, c.height / 2); }
    }
    requestAnimationFrame(paint);
  };
  rec.start(500); paint();
  return async (name: string) => {
    on = false; rec.stop();
    await new Promise((r) => (rec.onstop = r));
    await fetch(`/__save?name=${name}`, { method: 'POST', body: new Blob(chunks, { type: 'video/webm' }) });
  };
}

// ---------- main ----------
async function main() {
  const [wasm, tile] = await Promise.all([fetch(ASSET('wasm/flight_core.wasm')).then((r) => r.arrayBuffer()), loadTile()]);
  const core = await FlightCore.load(wasm, tile);
  const view = await buildScene($('c') as HTMLCanvasElement, tile);
  if (q.get('debug') === '1') Object.assign(window, { __view: view });
  const net = connect(() => renderBoard());
  const today = dailySeed();
  $('seed').textContent = `Daily seed ${today} · Shackleton rim, lunar South Pole`;

  let flight: Flight | null = null, seed = today, state: Float64Array | null = null, ranked = true;
  let acc = 0, last = performance.now(), auto = q.get('autopilot') === '1';
  let stopRec: ((n: string) => Promise<void>) | null = null;

  function renderBoard() {
    const rows = net.board(today);
    $('board').innerHTML = rows.length
      ? rows.map((r, i) => `<li class="${r.mine ? 'me' : ''}"><span>${i + 1}</span><span>${r.name}</span><span class="t${r.tier}">${TIERS[r.tier]}</span><span>${(r.marginDs / 10).toFixed(1)} s</span><span>${(r.distDm / 10).toFixed(1)} m</span></li>`).join('')
      : '<li class="empty">No verified landings today yet</li>';
    const run = net.myLatestRun();
    if (run && $('result').classList.contains('show')) $('verify').textContent = run.status === 'pending' ? 'Verifier replaying your input log…' : run.status === 'verified' ? '✓ Verified by replay — on the leaderboard' : '✗ Rejected: replay did not match';
    const n = net.myName(); if (n && !(document.activeElement === $('name'))) ($('name') as HTMLInputElement).value = n;
  }

  function start(daily: boolean) {
    seed = daily ? today : (Math.random() * 2 ** 31) >>> 0;
    ranked = daily;
    const name = ($('name') as HTMLInputElement).value.trim();
    if (name && name !== net.myName()) net.setName(name);
    flight?.free();
    flight = core.newFlight(seed);
    state = flight.state();
    view.setSun(state[S.sunAz], state[S.sunEl]);
    view.setTarget(state[S.targetX], state[S.targetZ]);
    resetHistory();
    $('menu').classList.remove('show'); $('result').classList.remove('show');
    acc = 0; last = performance.now();
  }

  function finish(s: Float64Array) {
    const tier = s[S.tier];
    $('rTier').textContent = TIERS[tier]; $('rTier').className = `tier t${tier}`;
    $('rWhy').textContent = tier === 0 ? REASONS[s[S.reason]] : tier === 2 ? 'Probe-mode stop, on target, gentle and level.' : 'Safe landing. EAGLE needs ≤30 m, ≤2 ft/s drift, ≤3° tilt, engine stop on the contact light.';
    $('rStats').innerHTML = [
      ['Hover margin', `${s[S.margin].toFixed(1)} s`], ['Distance', `${s[S.dist].toFixed(1)} m`],
      ['Sink at pads', `${s[S.vv].toFixed(1)} ft/s`], ['Drift', `${s[S.vh].toFixed(1)} ft/s`],
      ['Tilt', `${s[S.att].toFixed(1)}°`], ['Sink at contact light', `${s[S.vvCl].toFixed(1)} ft/s`],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('verify').textContent = ranked ? (tier > 0 ? 'Submitting input log…' : 'NO-GO runs are not ranked') : 'Practice seed: not ranked';
    if (ranked && tier > 0) net.submit(seed, flight!.inputLog(), tier, s[S.margin]);
    $('result').classList.add('show');
  }

  const loop = (now: number) => {
    acc += Math.min(0.25, (now - last) / 1000); last = now;
    let shown = auto ? 0 : pilotBits(), rodDelta = 0;
    if (flight && state && !state[S.status]) {
      while (acc >= DT) {
        const bits = auto ? autopilotBits(state, Math.round(state[S.t] / DT)) : pilotBits();
        const before = state[S.vzCmd];
        const st = flight.step(bits); state = flight.state(); acc -= DT;
        shown = bits;
        if (state[S.vzCmd] !== before) rodDelta = state[S.vzCmd] > before ? 1 : -1;
        if (st) { finish(state); break; }
      }
    }
    if (state) {
      nums.rodcmd = state[S.vzCmd] / FT;
      view.draw(state, shown); renderHud(state); drawInstruments($('inst') as HTMLCanvasElement, state, shown);
      placeMarker(view.targetScreen(), Math.hypot(state[S.targetX] - state[S.x], state[S.targetZ] - state[S.z]));
      showFeedback(shown, rodDelta);
    }
    requestAnimationFrame(loop);
  };

  $('play').onclick = () => start(true);
  $('practice').onclick = () => start(false);
  $('again').onclick = () => { $('result').classList.remove('show'); $('menu').classList.add('show'); };
  const showView = (v: string) => { $('viewName').textContent = v; document.body.classList.toggle('window', v === 'window'); };
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyV') showView(view.toggleView());
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (n >= 0) showView(view.setView(VIEWS[n]));
  });
  $('viewBtn').onclick = () => showView(view.toggleView());
  const depth = depthPanel(view);
  const toggleDepth = () => $('depthBtn').classList.toggle('on', depth.toggle());
  $('depthBtn').onclick = toggleDepth;
  addEventListener('keydown', (e) => { if (e.code === 'KeyN') toggleDepth(); });
  if (q.get('depth') === '1') toggleDepth();
  showView('orbit');
  renderBoard();
  requestAnimationFrame(loop);

  if (auto) {
    ($('name') as HTMLInputElement).value = q.get('name') ?? 'AUTOPILOT';
    const waitReady = async () => { for (let i = 0; i < 100 && !net.ready; i++) await new Promise((r) => setTimeout(r, 100)); };
    await waitReady();
    if (q.get('record') === '1') stopRec = recorder(view.canvas, () => state);
    start(true);
    while (!state![S.status]) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 6000)); // show the result + verification on video
    await stopRec?.('test-landing.webm');
    (window as unknown as { __done: unknown }).__done = { state: Array.from(state!), verify: $('verify').textContent };
  }
}

main();
