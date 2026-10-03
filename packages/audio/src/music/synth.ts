// Small deterministic DSP toolkit for the procedural score (pure functions over Float32Arrays; no dependencies).
// Instrument ideas adapted from kinetic-reel `score.mjs` (opus-video-skills, MIT, © 2026 tuzhechen2005).

export const TAU = Math.PI * 2;

/** Equal-power pan gains for pan ∈ [−1, 1]: (cos, sin) of (pan+1)·π/4. */
export function panGains(pan: number): [number, number] {
  const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

/** PolyBLEP band-limited sawtooth: phase in cycles [0, 1), dt = f/sr. */
export function blepSaw(phase: number, dt: number): number {
  let v = 2 * phase - 1;
  if (phase < dt) {
    const t = phase / dt;
    v -= t + t - t * t - 1;
  } else if (phase > 1 - dt) {
    const t = (phase - 1) / dt;
    v -= t * t + t + t + 1;
  }
  return v;
}

/** In-place one-pole low-pass (cutoff Hz). */
export function onePoleLowpass(x: Float32Array, cutoff: number, sr: number): void {
  const a = 1 - Math.exp((-TAU * cutoff) / sr);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += a * (x[i]! - y);
    x[i] = y;
  }
}

/** In-place one-pole high-pass (cutoff Hz). */
export function onePoleHighpass(x: Float32Array, cutoff: number, sr: number): void {
  const a = Math.exp((-TAU * cutoff) / sr);
  let yPrev = 0;
  let xPrev = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    const y = a * (yPrev + v - xPrev);
    xPrev = v;
    yPrev = y;
    x[i] = y;
  }
}

/**
 * Schroeder reverb (6 damped combs + 3 all-passes), as in score.mjs; delay lengths are scaled from 44.1 kHz.
 * Returns the wet signal of one channel; `spread` offsets the delays for the second channel.
 */
export function schroeder(input: Float32Array, sr: number, spread: number, feedback = 0.82, damp = 0.3): Float32Array {
  const k = sr / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491].map((d) => ({ b: new Float32Array(Math.round((d + spread) * k)), i: 0, s: 0 }));
  const aps = [556, 441, 341].map((d) => ({ b: new Float32Array(Math.round((d + spread) * k)), i: 0 }));
  const out = new Float32Array(input.length);
  for (let n = 0; n < input.length; n++) {
    const x = input[n]! * 0.02;
    let y = 0;
    for (const c of combs) {
      const v = c.b[c.i]!;
      c.s = v * (1 - damp) + c.s * damp;
      c.b[c.i] = x + c.s * feedback;
      c.i = (c.i + 1) % c.b.length;
      y += v;
    }
    for (const a of aps) {
      const v = a.b[a.i]!;
      a.b[a.i] = y + v * 0.5;
      a.i = (a.i + 1) % a.b.length;
      y = v - y;
    }
    out[n] = y;
  }
  return out;
}

/** A stereo bus with a reverb send; `t0` indexes are absolute buffer samples (the caller adds its pre-roll). */
export class Bus {
  readonly L: Float32Array;
  readonly R: Float32Array;
  readonly sendL: Float32Array;
  readonly sendR: Float32Array;
  constructor(readonly length: number) {
    this.L = new Float32Array(length);
    this.R = new Float32Array(length);
    this.sendL = new Float32Array(length);
    this.sendR = new Float32Array(length);
  }
  /** Adds gen(i) (i = local sample) for n samples at t0, panned, with a reverb send level. */
  put(t0: number, n: number, gen: (i: number) => number, o: { gain?: number; pan?: number; send?: number } = {}): void {
    const [gl, gr] = panGains(o.pan ?? 0);
    const g = o.gain ?? 1;
    const send = o.send ?? 0;
    const i0 = Math.max(0, -t0);
    const i1 = Math.min(n, this.length - t0);
    for (let i = i0; i < i1; i++) {
      const v = gen(i) * g;
      const k = t0 + i;
      this.L[k]! += v * gl;
      this.R[k]! += v * gr;
      if (send) {
        this.sendL[k]! += v * gl * send;
        this.sendR[k]! += v * gr * send;
      }
    }
  }
}
