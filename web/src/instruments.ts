// LM-style instrument panel drawn on a 2D canvas each frame (renderer-independent, reads flight state):
// cross-pointer (horizontal velocity), attitude indicator, altitude / altitude-rate tapes,
// landing-site map, altitude + sink-rate strip chart, and a propellant gauge.
import { BITS, S } from './flight';

const FT = 0.3048;
const C = { g: '#7CFFA0', dim: '#3c6b4c', line: 'rgba(124,255,160,.25)', warn: '#ffcc44', bad: '#ff6666', cyan: '#55ccff', bg: 'rgba(6,12,9,.72)' };

type Sample = { t: number; altFt: number; hdot: number };
const history: Sample[] = [];
export function resetHistory() { history.length = 0; }

function frame(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string) {
  g.fillStyle = C.bg; g.strokeStyle = C.line; g.lineWidth = 1;
  g.beginPath(); g.roundRect(x, y, w, h, 6); g.fill(); g.stroke();
  g.fillStyle = C.dim; g.font = '10px ui-monospace, Menlo, monospace'; g.fillText(title, x + 8, y + 13);
}

/** Cross-pointer: forward/lateral velocity in the LM body frame, like the LM's X-pointer display. */
function crossPointer(g: CanvasRenderingContext2D, x: number, y: number, size: number, s: Float64Array, bits: number) {
  frame(g, x, y, size, size, 'X-POINTER  ft/s');
  const cx = x + size / 2, cy = y + size / 2 + 6, r = size / 2 - 18, full = 10; // ±10 ft/s full scale
  const yaw = s[S.yaw];
  const fwd = (s[S.vx] * Math.sin(yaw) + s[S.vz] * Math.cos(yaw)) / FT;
  const lat = (s[S.vx] * Math.cos(yaw) - s[S.vz] * Math.sin(yaw)) / FT;
  g.strokeStyle = C.line;
  for (const k of [0.4, 1]) { g.strokeRect(cx - r * k, cy - r * k, 2 * r * k, 2 * r * k); }
  g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
  const px = cx + Math.max(-1, Math.min(1, lat / full)) * r, py = cy - Math.max(-1, Math.min(1, fwd / full)) * r;
  const ok = Math.hypot(fwd, lat) <= 2;
  g.strokeStyle = ok ? C.g : Math.hypot(fwd, lat) <= 4 ? C.warn : C.bad; g.lineWidth = 2;
  g.beginPath(); g.moveTo(px, cy - r); g.lineTo(px, cy + r); g.moveTo(cx - r, py); g.lineTo(cx + r, py); g.stroke();
  // RCS translation command: cyan arrow in the push direction (the jets are weak: ~0.4 ft/s per second)
  const tf = bits & BITS.TR_FWD ? 1 : bits & BITS.TR_AFT ? -1 : 0, tl = bits & BITS.TR_RIGHT ? 1 : bits & BITS.TR_LEFT ? -1 : 0;
  if (tf || tl) {
    const l = Math.hypot(tf, tl), ex = cx + (tl / l) * r * 0.7, ey = cy - (tf / l) * r * 0.7, a = Math.atan2(ey - cy, ex - cx);
    g.strokeStyle = C.cyan; g.fillStyle = C.cyan; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(ex, ey); g.stroke();
    g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - 9 * Math.cos(a - 0.5), ey - 9 * Math.sin(a - 0.5)); g.lineTo(ex - 9 * Math.cos(a + 0.5), ey - 9 * Math.sin(a + 0.5)); g.fill();
    g.font = '9px ui-monospace, monospace'; g.fillText('RCS', ex + 4, ey - 4);
  }
  g.lineWidth = 1; g.fillStyle = C.dim; g.font = '10px ui-monospace, Menlo, monospace'; g.fillText('FWD', cx + 4, y + 26); g.fillText('LAT', x + size - 26, cy - 4);
  g.fillStyle = C.g; g.fillText(`${fwd.toFixed(1)} / ${lat.toFixed(1)}`, x + 8, y + size - 6);
}

/** Attitude indicator: horizon line from pitch and roll (body frame). */
function attitude(g: CanvasRenderingContext2D, x: number, y: number, size: number, s: Float64Array) {
  frame(g, x, y, size, size, 'ATTITUDE');
  const cx = x + size / 2, cy = y + size / 2 + 6, r = size / 2 - 18;
  const pitchDeg = (s[S.pitch] * 180) / Math.PI, roll = s[S.roll];
  g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  g.translate(cx, cy); g.rotate(-roll); g.translate(0, pitchDeg * (r / 25));
  g.fillStyle = '#1b2a22'; g.fillRect(-2 * r, -2 * r, 4 * r, 2 * r); // sky (black-green)
  g.fillStyle = '#3a3a3a'; g.fillRect(-2 * r, 0, 4 * r, 2 * r);       // surface
  g.strokeStyle = C.g; g.beginPath(); g.moveTo(-2 * r, 0); g.lineTo(2 * r, 0); g.stroke();
  g.fillStyle = C.dim; g.font = '9px ui-monospace, monospace';
  for (const d of [-20, -10, 10, 20]) { const yy = -d * (r / 25); g.fillRect(-12, yy, 24, 1); g.fillText(`${d}`, 15, yy + 3); }
  g.restore();
  const tilt = Math.max(Math.abs(pitchDeg), Math.abs((roll * 180) / Math.PI));
  g.strokeStyle = tilt <= 3 ? C.g : tilt <= 6 ? C.warn : C.bad; g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx - 22, cy); g.lineTo(cx - 8, cy); g.lineTo(cx, cy + 6); g.lineTo(cx + 8, cy); g.lineTo(cx + 22, cy); g.stroke();
  g.lineWidth = 1; g.fillStyle = C.g; g.font = '10px ui-monospace, Menlo, monospace';
  g.fillText(`P ${pitchDeg.toFixed(1)}°  R ${((roll * 180) / Math.PI).toFixed(1)}°`, x + 8, y + size - 6);
}

/** Vertical tape with a pointer (value) and optional command bug. */
function tape(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, title: string, v: number, lo: number, hi: number, fmt: (v: number) => string, color: string, bug?: number) {
  frame(g, x, y, w, h, title);
  const top = y + 22, bot = y + h - 22, ry = (val: number) => bot - ((Math.max(lo, Math.min(hi, val)) - lo) / (hi - lo)) * (bot - top);
  g.fillStyle = 'rgba(124,255,160,.08)'; g.fillRect(x + w / 2 - 6, top, 12, bot - top);
  g.fillStyle = color; g.fillRect(x + w / 2 - 6, Math.min(ry(v), ry(Math.max(lo, 0))), 12, Math.abs(ry(v) - ry(Math.max(lo, 0))) || 2);
  if (bug !== undefined) { g.fillStyle = C.cyan; g.fillRect(x + w / 2 - 12, ry(bug) - 1, 24, 3); }
  g.fillStyle = C.g; g.font = '11px ui-monospace, Menlo, monospace'; g.fillText(fmt(v), x + 6, y + h - 6);
}

/** Landing-site map: LM and target ring from above, LM nose up. */
function siteMap(g: CanvasRenderingContext2D, x: number, y: number, size: number, s: Float64Array) {
  frame(g, x, y, size, size, 'SITE  60 m');
  const cx = x + size / 2, cy = y + size / 2 + 6, r = size / 2 - 16, range = 60;
  const yaw = s[S.yaw], dx = s[S.targetX] - s[S.x], dz = s[S.targetZ] - s[S.z];
  const fwd = dx * Math.sin(yaw) + dz * Math.cos(yaw), lat = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const d = Math.hypot(fwd, lat), k = d > range ? range / d : 1;
  g.strokeStyle = C.line; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.arc(cx, cy, r * 30 / range, 0, Math.PI * 2); g.stroke();
  const tx = cx + (lat * k / range) * r, ty = cy - (fwd * k / range) * r;
  g.strokeStyle = d <= 30 ? C.g : C.warn; g.lineWidth = 2; g.beginPath(); g.arc(tx, ty, Math.max(3, (6 / range) * r), 0, Math.PI * 2); g.stroke();
  g.lineWidth = 1; g.fillStyle = C.g; g.beginPath(); g.moveTo(cx, cy - 7); g.lineTo(cx - 5, cy + 5); g.lineTo(cx + 5, cy + 5); g.fill();
  g.font = '10px ui-monospace, Menlo, monospace'; g.fillText(`${d.toFixed(0)} m`, x + 8, y + size - 6);
}

/** Strip chart: altitude (ft) and sink rate (ft/s) over the last 60 s. */
function chart(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  frame(g, x, y, w, h, 'ALT ft (green) · H-DOT ft/s (cyan) · 60 s');
  const top = y + 20, bot = y + h - 8, left = x + 8, right = x + w - 8;
  if (history.length < 2) return;
  const tEnd = history[history.length - 1].t, tStart = tEnd - 60;
  const X = (t: number) => left + ((t - tStart) / 60) * (right - left);
  const plot = (f: (p: Sample) => number, lo: number, hi: number, color: string) => {
    g.strokeStyle = color; g.beginPath();
    history.forEach((p, i) => { const yy = bot - ((Math.max(lo, Math.min(hi, f(p))) - lo) / (hi - lo)) * (bot - top); if (i) g.lineTo(X(p.t), yy); else g.moveTo(X(p.t), yy); });
    g.stroke();
  };
  g.strokeStyle = C.line; const zero = bot - ((0 + 15) / 20) * (bot - top); g.beginPath(); g.moveTo(left, zero); g.lineTo(right, zero); g.stroke();
  plot((p) => p.altFt, 0, 520, C.g);
  plot((p) => p.hdot, -15, 5, C.cyan);
}

/** Propellant gauge with the low-level mark (5.6 %) and hover-margin seconds. */
function fuel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: Float64Array) {
  frame(g, x, y, w, h, 'DPS PROPELLANT');
  const kg = s[S.prop], frac = Math.max(0, Math.min(1, kg / 700)), low = 461.9 / 700;
  const bx = x + 8, by = y + 20, bw = w - 16, bh = 12;
  g.fillStyle = 'rgba(124,255,160,.08)'; g.fillRect(bx, by, bw, bh);
  g.fillStyle = kg <= 461.9 ? C.warn : C.g; g.fillRect(bx, by, bw * frac, bh);
  g.fillStyle = C.bad; g.fillRect(bx + bw * low, by - 3, 2, bh + 6);
  g.fillStyle = C.g; g.font = '11px ui-monospace, Menlo, monospace';
  g.fillText(`${kg.toFixed(0)} kg · ${(kg / 4.05).toFixed(1)} s hover`, x + 8, y + h - 6);
}

export function drawInstruments(cv: HTMLCanvasElement, s: Float64Array, bits = 0) {
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const t = s[S.t];
  if (!history.length || t - history[history.length - 1].t >= 0.25) {
    history.push({ t, altFt: s[S.agl] / FT, hdot: s[S.vy] / FT });
    while (history.length && t - history[0].t > 60) history.shift();
  }
  const narrow = W < 720, box = narrow ? 104 : 136, gap = 8, y = H - box - (narrow ? 178 : 150);
  // left cluster: cross-pointer + attitude; right cluster: tapes + map; chart + fuel above the right cluster
  crossPointer(g, gap + 8, y, box, s, bits);
  attitude(g, gap + 8 + box + gap, y, box, s);
  const rx = W - 8 - gap - box - 2 * (60 + gap);
  tape(g, rx, y, 60, box, 'ALT ft', s[S.agl] / FT, 0, 520, (v) => v.toFixed(0), C.g);
  tape(g, rx + 60 + gap, y, 60, box, 'H-DOT', s[S.vy] / FT, -15, 5, (v) => v.toFixed(1), Math.abs(s[S.vy] / FT) <= 3 ? C.g : Math.abs(s[S.vy] / FT) <= 10 ? C.warn : C.bad, s[S.vzCmd] / FT);
  siteMap(g, rx + 2 * (60 + gap), y, box, s);
  if (!narrow) {
    const cw = 2 * (60 + gap) + box;
    chart(g, rx, y - 96 - gap, cw, 96);
    fuel(g, gap + 8, y - 52 - gap, 2 * box + gap, 52, s);
  }
}
