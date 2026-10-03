// Streaming look-ahead true-peak limiter (§11.5; sfx_mix.py semantics): 2.5 ms look-ahead, 80 ms release, peak estimated
// on a 4× oversampled signal (windowed-sinc polyphase interpolator). Output is delayed by `delay` samples internally;
// `process` returns exactly as many samples as it receives once `flush` has been called at the end.

const HALF = 6; // FIR half length in input samples (12 taps per phase)
const PHASES = 4;

/** Polyphase coefficients for fractional positions p/4 (p = 1..3): y(n + p/4) = Σ_k x[n + k]·h[p][k + HALF − 1]. */
function makeInterpolator(): Float64Array[] {
  const out: Float64Array[] = [];
  for (let p = 1; p < PHASES; p++) {
    const h = new Float64Array(2 * HALF);
    let sum = 0;
    for (let k = -HALF + 1; k <= HALF; k++) {
      const t = p / PHASES - k; // distance from the sample to the interpolated point
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / HALF); // Hann window over ±HALF
      h[k + HALF - 1] = sinc * w;
      sum += sinc * w;
    }
    for (let i = 0; i < h.length; i++) h[i] = h[i]! / sum; // unity DC gain
    out.push(h);
  }
  return out;
}
const INTERP = makeInterpolator();

export class TruePeakLimiter {
  readonly lookahead: number;
  readonly delay: number;
  private readonly ceil: number;
  private readonly relCoef: number;
  private readonly size = 512;
  private readonly mask = 511;
  private readonly xl = new Float64Array(512);
  private readonly xr = new Float64Array(512);
  private readonly rr = new Float64Array(512); // required gain per sample
  private readonly mr = new Float64Array(512).fill(1); // sliding minima
  private readonly dq = new Int32Array(512); // monotonic deque of indices into rr
  private dqHead = 0;
  private dqTail = 0;
  private mSum: number;
  private w = 0; // samples pushed
  private gPrev = 1;
  private pending = 0; // samples still owed after flush
  /** Largest gain reduction applied (dB, ≥ 0). */
  maxGrDb = 0;

  constructor(o: { ceilingDbfs: number; sampleRate: number; lookaheadMs?: number; releaseMs?: number }) {
    this.ceil = Math.pow(10, o.ceilingDbfs / 20);
    this.lookahead = Math.max(1, Math.round(((o.lookaheadMs ?? 2.5) * o.sampleRate) / 1000));
    this.delay = this.lookahead + HALF;
    this.relCoef = 1 - Math.exp(-1 / (((o.releaseMs ?? 80) * o.sampleRate) / 1000));
    this.mSum = this.lookahead + 1; // virtual minima of 1 before the start
    if (this.delay + 2 * HALF + 2 >= this.size) throw new Error("limiter look-ahead too long for its ring buffers");
  }

  /** Peak estimate around sample j: max |x| over the sample and 3 interpolated points towards j+1, both channels. */
  private truePeak(j: number): number {
    const m = this.mask;
    let pk = 0;
    for (let c = 0; c < 2; c++) {
      const ch = c === 0 ? this.xl : this.xr;
      const a0 = Math.abs(ch[j & m]!);
      if (a0 > pk) pk = a0;
      for (let p = 0; p < INTERP.length; p++) {
        const h = INTERP[p]!;
        let y = 0;
        for (let k = 0; k < 2 * HALF; k++) {
          const i = j - HALF + 1 + k;
          if (i >= 0) y += ch[i & m]! * h[k]!;
        }
        const a = Math.abs(y);
        if (a > pk) pk = a;
      }
    }
    return pk;
  }

  /** Pushes one stereo sample; returns the gain-applied delayed sample, or null while the pipeline fills. */
  private step(l: number, r: number, outL: Float32Array, outR: Float32Array, at: number): boolean {
    const m = this.mask;
    this.xl[this.w & m] = l;
    this.xr[this.w & m] = r;
    this.w++;
    const j = this.w - 1 - HALF; // the newest sample whose interpolation window is complete
    if (j < 0) return false;
    const tp = this.truePeak(j);
    const need = tp > this.ceil ? this.ceil / tp : 1;
    this.rr[j & m] = need;
    while (this.dqTail > this.dqHead && this.rr[this.dq[(this.dqTail - 1) & m]! & m]! >= need) this.dqTail--;
    this.dq[this.dqTail++ & m] = j;
    while (this.dq[this.dqHead & m]! < j - this.lookahead) this.dqHead++;
    const mj = this.rr[this.dq[this.dqHead & m]! & m]!;
    const old = j - this.lookahead - 1 >= 0 ? this.mr[(j - this.lookahead - 1) & m]! : 1;
    this.mr[j & m] = mj;
    this.mSum += mj - old;
    const o = j - this.lookahead;
    if (o < 0) return false;
    const s = Math.min(1, this.mSum / (this.lookahead + 1));
    const g = s <= this.gPrev ? s : this.gPrev + (s - this.gPrev) * this.relCoef;
    this.gPrev = g;
    if (g < 1) {
      const gr = -20 * Math.log10(g);
      if (gr > this.maxGrDb) this.maxGrDb = gr;
    }
    outL[at] = this.xl[o & m]! * g;
    outR[at] = this.xr[o & m]! * g;
    return true;
  }

  /** Processes a block; returns the samples that left the pipeline (fewer than the input while it fills). */
  process(l: Float32Array, r: Float32Array): [Float32Array, Float32Array] {
    const outL = new Float32Array(l.length), outR = new Float32Array(l.length);
    let n = 0;
    for (let i = 0; i < l.length; i++) if (this.step(l[i]!, r[i]!, outL, outR, n)) n++;
    this.pending += l.length - n;
    return [outL.subarray(0, n), outR.subarray(0, n)];
  }

  /** Drains the pipeline (pads with silence): returns the remaining delayed samples. */
  flush(): [Float32Array, Float32Array] {
    const n = this.pending;
    const outL = new Float32Array(n), outR = new Float32Array(n);
    let k = 0;
    // a zero is pushed per owed sample; each push releases one delayed sample once the pipeline is full
    for (let guard = 0; k < n && guard < n + this.delay + 1; guard++) if (this.step(0, 0, outL, outR, k)) k++;
    this.pending = 0;
    return [outL.subarray(0, k), outR.subarray(0, k)];
  }
}
