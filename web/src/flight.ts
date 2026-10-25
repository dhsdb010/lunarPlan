// Thin wrapper over crates/flight-core (WASM). Used by the game and by the verifier worker, so a
// run replays identically in both. State indices mirror Sim::state in flight-core/src/lib.rs.

export const S = {
  t: 0, x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6, pitch: 7, roll: 8, throttle: 9, prop: 10, vzCmd: 11, agl: 12,
  contact: 13, lowLevel: 14, engineOn: 15, status: 16, tier: 17, margin: 18, dist: 19, vv: 20, vh: 21, att: 22,
  slope: 23, vvCl: 24, probeStop: 25, reason: 26, targetX: 27, targetZ: 28, sunAz: 29, sunEl: 30, bingo: 31, yaw: 32,
} as const;
const N_STATE = 33;

// RHC (rotation), ROD switch, ENGINE STOP, TTCA (RCS translation): flight-core input bits (u16)
export const BITS = {
  PITCH_UP: 1, PITCH_DN: 2, ROLL_L: 4, ROLL_R: 8, ROD_UP: 16, ROD_DN: 32, ENGINE_STOP: 64,
  YAW_L: 128, YAW_R: 256, TR_FWD: 512, TR_AFT: 1024, TR_LEFT: 2048, TR_RIGHT: 4096,
} as const;
export const DT = 1 / 120;
export const TIERS = ['NO-GO', 'GO', 'EAGLE'] as const;
export const REASONS = ['', 'vertical speed over 10 ft/s', 'horizontal speed over the 10-7-4 envelope', 'attitude over 6°', 'rates',
  'slope over 12°', 'boulder/depression over 0.61 m', 'propellant depleted', 'Bingo: no contact light in time', 'more than 150 m from target'];

type Exports = {
  memory: WebAssembly.Memory;
  fc_alloc(n: number): number;
  fc_new(seed: number, h: number, n: number, spacing: number): number;
  fc_step(sim: number, bits: number): number;
  fc_state(sim: number): number;
  fc_free(sim: number): void;
  fc_replay(seed: number, h: number, n: number, spacing: number, log: number, len: number): number;
};

export interface Tile { samples: number; spacing: number; heights: Float32Array }

export class FlightCore {
  private x: Exports;
  private hPtr: number;
  constructor(instance: WebAssembly.Instance, readonly tile: Tile) {
    this.x = instance.exports as unknown as Exports;
    this.hPtr = this.x.fc_alloc(tile.heights.byteLength);
    new Float32Array(this.x.memory.buffer, this.hPtr, tile.heights.length).set(tile.heights);
  }
  static async load(wasm: BufferSource, tile: Tile) {
    const { instance } = await WebAssembly.instantiate(wasm);
    return new FlightCore(instance, tile);
  }
  newFlight(seed: number) { return new Flight(this.x, this.x.fc_new(seed >>> 0, this.hPtr, this.tile.samples, this.tile.spacing)); }
  replay(seed: number, log: Uint8Array) {
    const p = this.x.fc_alloc(Math.max(1, log.length));
    new Uint8Array(this.x.memory.buffer, p, log.length).set(log);
    const s = this.x.fc_replay(seed >>> 0, this.hPtr, this.tile.samples, this.tile.spacing, p, log.length);
    return Float64Array.from(new Float64Array(this.x.memory.buffer, s, N_STATE));
  }
}

/** One flight: steps the sim and records the input log (u16 LE steps-since-change, u16 LE bits). */
export class Flight {
  private log: number[] = [];
  private since = 0;
  private bits = 0;
  constructor(private x: Exports, private sim: number) {}
  step(bits: number) {
    if (bits !== this.bits) {
      this.log.push(this.since & 0xff, this.since >> 8, bits & 0xff, bits >> 8);
      this.bits = bits; this.since = 0;
    }
    const st = this.x.fc_step(this.sim, bits);
    this.since++;
    if (this.since === 0xffff) { this.log.push(0xff, 0xff, bits & 0xff, bits >> 8); this.since = 0; }
    return st;
  }
  state() { return Float64Array.from(new Float64Array(this.x.memory.buffer, this.x.fc_state(this.sim), N_STATE)); }
  inputLog() { return Uint8Array.from(this.log); }
  free() { this.x.fc_free(this.sim); }
}

export const dailySeed = (d = new Date()) => Math.floor(d.getTime() / 86_400_000);
