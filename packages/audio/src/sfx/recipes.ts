// Procedural SFX recipes (§11.2): ffmpeg lavfi argument builders, ported from $SP/sfx/make_sfx.sh (verified on ffmpeg 6.1).
// Gotcha: inside afftfilt, `pts` is in SAMPLES (time = pts/sr); bin b is at b·sr/win_size Hz.
// Each builder returns every ffmpeg argument except the output: lavfi inputs + a filter graph ending in the `[out]` label.
// Loudness normalisation is NOT part of the recipes (the analyser applies a linear gain in Node, see analyze.ts).
import type { SfxCategory } from "@docmaker/core";

export interface SfxRecipe {
  category: SfxCategory; variants: { variant: number; durationSec: number; seed: number }[];
  syncPoint: "peak" | "onset" | "end"; loopable: boolean;
  args(o: { durationSec: number; seed: number; sampleRate: 48000 }): string[]; // ffmpeg lavfi argument builder (port of make_sfx.sh)
  /** Milestone of the category (§11.2 table). */
  milestone?: "M1" | "M2";
  /** Baked pan sweep of the rendered file (procedural whooshes sweep L→R). */
  direction?: "LR" | "RL" | "none";
  /** 1–5, used by the director's variant/energy heuristics. */
  energy?: number;
  /** Loudness normalisation: "auto" = peak-normalise sounds < 400 ms to the category mid, else −20 LUFS (peak-checked). */
  norm?: "auto" | { peakDbfs: number };
  /** Seamless loop: render durationSec + xfadeSec, then fold the tail onto the head (linear for periodic, power for noise). */
  loop?: { xfadeSec: number; law: "linear" | "power" } | { periodic: true };
  /** Analytic sync point (ms from file start) used by tests and as a sanity check of the analyser. */
  analyticPeakMs?(durationSec: number): number;
  tags?: string[];
}

const lavfi = (src: string): string[] => ["-f", "lavfi", "-i", src];
const graph = (g: string): string[] => ["-filter_complex", g];
const n = (x: number): string => {
  const s = x.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
};
/** Deterministic value in [0, 1) from a seed and a salt (recipe variation without Math.random). */
function hash01(seed: number, salt: number): number {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- whooshes (time-varying Gaussian band-pass on pink noise)
interface WhooshShape { P: number; rise: number; fall: number; fc: (env: string, x: string) => string; bw: (env: string) => string; shelf?: string; echo: string; amp?: number }
function whoosh(D: number, seed: number, s: WhooshShape, sr: number): string[] {
  const X = `min((pts/sr)/${n(D)},1)`;
  const ENV = `if(lt(${X},${n(s.P)}),pow(${X}/${n(s.P)},${n(s.rise)}),pow((1-${X})/(1-${n(s.P)}),${n(s.fall)}))`;
  const FC = `(${s.fc(ENV, X)})`;
  const BW = `(${s.bw(ENV)})`;
  const G = `exp(-pow(b*sr/2048-${FC},2)/(2*pow(${BW},2)))`;
  const E = `if(lt(t/${n(D)},${n(s.P)}),pow((t/${n(D)})/${n(s.P)},${n(s.rise)}),pow(max(0,1-t/${n(D)})/(1-${n(s.P)}),${n(s.fall)}))`;
  const chain = [
    `afftfilt=win_size=2048:overlap=0.75:real='re*${G}':imag='im*${G}'`,
    `aeval='val(0)*${E}|val(0)*${E}':c=stereo`,
    `aeval='val(0)*(1-0.7*t/${n(D)})|val(1)*(0.3+0.7*t/${n(D)})'`, // L→R pan sweep (direction "LR")
    s.echo,
    ...(s.shelf ? [s.shelf] : []),
  ];
  return [...lavfi(`anoisesrc=color=pink:duration=${n(D)}:sample_rate=${sr}:amplitude=${n(s.amp ?? 0.9)}:seed=${seed}`), ...graph(`[0:a]${chain.join(",")}[out]`)];
}
const WHOOSH_LIGHT: WhooshShape = { P: 0.65, rise: 2.2, fall: 1.3, fc: (e) => `300+3200*${e}`, bw: (e) => `250+700*${e}`, echo: "aecho=0.8:0.5:35|60:0.22|0.12" };
const WHOOSH_HEAVY: WhooshShape = { P: 0.62, rise: 2.0, fall: 1.4, fc: (e) => `200+2400*${e}`, bw: (e) => `300+800*${e}`, shelf: "lowshelf=f=150:g=4", echo: "aecho=0.8:0.6:45|90:0.3|0.18" };
const WHOOSH_WHIP: WhooshShape = { P: 0.5, rise: 2.4, fall: 1.6, fc: (e) => `500+4200*${e}`, bw: (e) => `120+380*${e}`, echo: "aecho=0.8:0.4:25|45:0.18|0.1" };
const WHOOSH_UP: WhooshShape = { P: 0.85, rise: 2.0, fall: 1.0, fc: (e, x) => `250+3600*pow(${x},1.6)+400*${e}`, bw: (e) => `200+600*${e}`, echo: "aecho=0.8:0.5:30|55:0.2|0.1" };

// ---------------------------------------------------------------- recipes
const saw = (ph: string) => `(2*((${ph})-floor((${ph})+0.5)))`;

export const SFX_RECIPES: readonly SfxRecipe[] = [
  {
    category: "whoosh.light", milestone: "M1", syncPoint: "peak", loopable: false, direction: "LR", energy: 2, tags: ["transition", "air"],
    variants: [{ variant: 0, durationSec: 0.6, seed: 3 }, { variant: 1, durationSec: 0.6, seed: 7 }, { variant: 2, durationSec: 0.6, seed: 11 }],
    args: ({ durationSec, seed, sampleRate }) => whoosh(durationSec, seed, WHOOSH_LIGHT, sampleRate),
    analyticPeakMs: (D) => 1000 * WHOOSH_LIGHT.P * D,
  },
  {
    category: "whoosh.heavy", milestone: "M2", syncPoint: "peak", loopable: false, direction: "LR", energy: 4, tags: ["transition", "air", "heavy"],
    variants: [{ variant: 0, durationSec: 1.2, seed: 5 }, { variant: 1, durationSec: 1.6, seed: 9 }],
    args: ({ durationSec, seed, sampleRate }) => whoosh(durationSec, seed, WHOOSH_HEAVY, sampleRate),
    analyticPeakMs: (D) => 1000 * WHOOSH_HEAVY.P * D,
  },
  {
    category: "whoosh.whip", milestone: "M1", syncPoint: "peak", loopable: false, direction: "LR", energy: 3, tags: ["transition", "whip"],
    variants: [{ variant: 0, durationSec: 0.4, seed: 2 }, { variant: 1, durationSec: 0.4, seed: 4 }, { variant: 2, durationSec: 0.4, seed: 6 }],
    args: ({ durationSec, seed, sampleRate }) => whoosh(durationSec, seed, WHOOSH_WHIP, sampleRate),
    analyticPeakMs: (D) => 1000 * WHOOSH_WHIP.P * D,
  },
  {
    category: "whoosh.up", milestone: "M1", syncPoint: "peak", loopable: false, direction: "LR", energy: 3, tags: ["transition", "zoom"],
    variants: [{ variant: 0, durationSec: 0.8, seed: 1 }, { variant: 1, durationSec: 0.8, seed: 8 }],
    args: ({ durationSec, seed, sampleRate }) => whoosh(durationSec, seed, WHOOSH_UP, sampleRate),
    analyticPeakMs: (D) => 1000 * WHOOSH_UP.P * D,
  },
  {
    category: "swell.reverse", milestone: "M2", syncPoint: "end", loopable: false, direction: "none", energy: 3, tags: ["transition", "reverse"],
    variants: [{ variant: 0, durationSec: 1.6, seed: 9 }, { variant: 1, durationSec: 1.6, seed: 13 }],
    // reversed decaying band-passed noise + echoes: grows into a hard stop at the cut
    args: ({ durationSec: D, seed, sampleRate }) => [
      ...lavfi(`anoisesrc=color=pink:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=0.9:seed=${seed}`),
      ...graph(`[0:a]bandpass=f=${n(2600 + 800 * hash01(seed, 1))}:width_type=o:w=2,aeval='val(0)*exp(-t/0.35)',aecho=0.8:0.7:120|240|360:0.5|0.35|0.2,atrim=duration=${n(D)},areverse,afade=t=out:st=${n(D - 0.012)}:d=0.012[out]`),
    ],
    analyticPeakMs: (D) => 1000 * D - 30,
  },
  {
    category: "riser", milestone: "M1", syncPoint: "end", loopable: false, direction: "none", energy: 4, tags: ["tension", "build"],
    variants: [{ variant: 0, durationSec: 2, seed: 11 }, { variant: 1, durationSec: 4, seed: 17 }],
    // 3 detuned saw chirps (exp sweep 110→880 Hz) × (t/D)^1.5 + accelerating tremolo + rising high-passed noise; 30 ms hard stop
    args: ({ durationSec: D, seed, sampleRate }) => {
      const K = 8;
      const PH = `(110*${n(D)}*(pow(${K},t/${n(D)})-1)/log(${K}))`;
      const s1 = saw(PH), s2 = saw(`${PH}*1.007`), s3 = saw(`${PH}*0.993`);
      const HP = `(200+6000*pow(min((pts/sr)/${n(D)},1),2))`;
      const G = `if(gt(b*sr/2048,${HP}),1,0.02)`;
      return [
        ...lavfi(`aevalsrc='0.25*(${s1}+${s2}+${s3})*pow(t/${n(D)},1.5)':s=${sampleRate}:d=${n(D)}`),
        ...lavfi(`anoisesrc=color=white:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=0.6:seed=${seed}`),
        ...graph(
          `[0:a]lowpass=f=3500,aeval='val(0)*(0.75+0.25*sin(2*PI*(2*t+1.5*t*t/${n(D)})))'[s];` +
          `[1:a]afftfilt=win_size=2048:overlap=0.75:real='re*${G}':imag='im*${G}',aeval='val(0)*pow(t/${n(D)},2.5)'[nz];` +
          `[s][nz]amix=inputs=2:weights='1 0.7':normalize=0,aecho=0.8:0.6:80|130:0.3|0.25,afade=t=out:st=${n(D - 0.03)}:d=0.03,pan=stereo|c0=c0|c1=c0[out]`,
        ),
      ];
    },
    analyticPeakMs: (D) => 1000 * D - 30,
  },
  {
    category: "impact", milestone: "M1", syncPoint: "onset", loopable: false, direction: "none", energy: 5, tags: ["hit", "reveal"],
    variants: [{ variant: 0, durationSec: 2.0, seed: 3 }, { variant: 1, durationSec: 2.0, seed: 5 }, { variant: 2, durationSec: 2.0, seed: 7 }],
    // pitch-dropping sine (≈110→38 Hz, exp(−t/0.45)) + saturated brown-noise transient (exp(−t/0.035)) + short room tail
    args: ({ durationSec: D, seed, sampleRate }) => {
      const f0 = 100 + 20 * hash01(seed, 2);
      return [
        ...lavfi(`aevalsrc='0.9*sin(2*PI*(38*t+(${n(f0)}-38)*0.08*(1-exp(-t/0.08))))*exp(-t/0.45)':s=${sampleRate}:d=${n(D)}`),
        ...lavfi(`anoisesrc=color=brown:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=1:seed=${seed}`),
        ...graph(`[1:a]lowpass=f=2500,aeval='val(0)*exp(-t/0.035)',volume=1.2[n];[0:a][n]amix=inputs=2:weights='1 0.8':normalize=0,asoftclip=type=tanh:threshold=0.7,lowshelf=f=60:g=4,aecho=0.8:0.4:60|110:0.3|0.2,pan=stereo|c0=c0|c1=c0[out]`),
      ];
    },
    analyticPeakMs: () => 2,
  },
  {
    category: "impact.soft", milestone: "M2", syncPoint: "onset", loopable: false, direction: "none", energy: 3, tags: ["hit", "soft"],
    variants: [{ variant: 0, durationSec: 1.2, seed: 4 }],
    // the impact, 8 dB down and low-passed at 1.2 kHz (normalisation keeps the relative softness out; the duller tone stays)
    args: ({ durationSec: D, seed, sampleRate }) => [
      ...lavfi(`aevalsrc='0.9*sin(2*PI*(40*t+(90-40)*0.08*(1-exp(-t/0.08))))*exp(-t/0.3)':s=${sampleRate}:d=${n(D)}`),
      ...lavfi(`anoisesrc=color=brown:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=1:seed=${seed}`),
      ...graph(`[1:a]lowpass=f=1200,aeval='val(0)*exp(-t/0.03)'[n];[0:a][n]amix=inputs=2:weights='1 0.6':normalize=0,lowpass=f=1200,volume=-8dB,aecho=0.8:0.4:60|110:0.25|0.15,pan=stereo|c0=c0|c1=c0[out]`),
    ],
    analyticPeakMs: () => 3,
  },
  {
    category: "boom.sub", milestone: "M1", syncPoint: "onset", loopable: false, direction: "none", energy: 5, tags: ["sub", "drop"],
    variants: [{ variant: 0, durationSec: 2.5, seed: 1 }, { variant: 1, durationSec: 2.5, seed: 2 }],
    // sub drop 70→28 Hz with a 0.9 s decay (variant 1 starts at 64 Hz)
    args: ({ durationSec: D, seed, sampleRate }) => {
      const f0 = seed % 2 === 1 ? 70 : 64;
      return [
        ...lavfi(`aevalsrc='sin(2*PI*(28*t+(${f0}-28)*0.4*(1-exp(-t/0.4))))*exp(-t/0.9)*min(t/0.005,1)':s=${sampleRate}:d=${n(D)}`),
        ...graph(`[0:a]asoftclip=type=tanh:threshold=0.8,afade=t=out:st=${n(D - 0.2)}:d=0.2,pan=stereo|c0=c0|c1=c0[out]`),
      ];
    },
    analyticPeakMs: () => 10,
  },
  {
    category: "boom.low", milestone: "M1", syncPoint: "onset", loopable: false, direction: "none", energy: 5, tags: ["sub", "dark"],
    variants: [{ variant: 0, durationSec: 3.0, seed: 6 }],
    // sub drop 55→35 Hz + a 1.5 s low-passed noise tail
    args: ({ durationSec: D, seed, sampleRate }) => [
      ...lavfi(`aevalsrc='sin(2*PI*(35*t+(55-35)*0.5*(1-exp(-t/0.5))))*exp(-t/1.1)*min(t/0.006,1)':s=${sampleRate}:d=${n(D)}`),
      ...lavfi(`anoisesrc=color=brown:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=1:seed=${seed}`),
      ...graph(`[1:a]lowpass=f=220,aeval='val(0)*min(t/0.01,1)*exp(-t/0.5)'[n];[0:a][n]amix=inputs=2:weights='1 0.7':normalize=0,asoftclip=type=tanh:threshold=0.85,afade=t=out:st=${n(D - 0.3)}:d=0.3,pan=stereo|c0=c0|c1=c0[out]`),
    ],
    analyticPeakMs: () => 12,
  },
  {
    category: "thud", milestone: "M1", syncPoint: "onset", loopable: false, direction: "none", energy: 4, tags: ["hit", "stamp"],
    variants: [{ variant: 0, durationSec: 0.4, seed: 21 }, { variant: 1, durationSec: 0.4, seed: 22 }, { variant: 2, durationSec: 0.4, seed: 23 }],
    // a short impact, low-passed at 400 Hz
    args: ({ durationSec: D, seed, sampleRate }) => {
      const f0 = 85 + 30 * hash01(seed, 3);
      return [
        ...lavfi(`aevalsrc='0.9*sin(2*PI*(45*t+(${n(f0)}-45)*0.03*(1-exp(-t/0.03))))*exp(-t/0.09)':s=${sampleRate}:d=${n(D)}`),
        ...lavfi(`anoisesrc=color=brown:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=1:seed=${seed}`),
        ...graph(`[1:a]aeval='val(0)*exp(-t/0.02)'[n];[0:a][n]amix=inputs=2:weights='1 0.9':normalize=0,lowpass=f=400,afade=t=out:st=${n(D - 0.05)}:d=0.05,pan=stereo|c0=c0|c1=c0[out]`),
      ];
    },
    analyticPeakMs: () => 4,
  },
  {
    category: "pop", milestone: "M1", syncPoint: "onset", loopable: false, direction: "none", energy: 2, tags: ["ui", "appear"],
    variants: [{ variant: 0, durationSec: 0.12, seed: 0 }, { variant: 1, durationSec: 0.12, seed: 1 }, { variant: 2, durationSec: 0.12, seed: 2 }],
    // sine 900→420 Hz, 70 ms (pitch ±8 % per variant)
    args: ({ durationSec: D, seed, sampleRate }) => {
      const k = [1, 1.08, 0.92][seed % 3]!;
      return [
        ...lavfi(`aevalsrc='sin(2*PI*(${n(420 * k)}*t+(${n(900 * k)}-${n(420 * k)})*0.012*(1-exp(-t/0.012))))*exp(-t/0.025)*min(t/0.002,1)':s=${sampleRate}:d=${n(D)}`),
        ...graph(`[0:a]highpass=f=150,pan=stereo|c0=c0|c1=c0[out]`),
      ];
    },
    analyticPeakMs: () => 5,
  },
  {
    category: "click", milestone: "M1", syncPoint: "onset", loopable: false, direction: "none", energy: 1, tags: ["ui", "mouse"],
    variants: [{ variant: 0, durationSec: 0.05, seed: 5 }, { variant: 1, durationSec: 0.05, seed: 6 }, { variant: 2, durationSec: 0.05, seed: 7 }],
    // 6 ms high-passed noise burst
    args: ({ durationSec: D, seed, sampleRate }) => [
      ...lavfi(`anoisesrc=color=white:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=1:seed=${seed}`),
      ...graph(`[0:a]highpass=f=${n(2000 + 1200 * hash01(seed, 4))},aeval='val(0)*exp(-t/0.004)',pan=stereo|c0=c0|c1=c0[out]`),
    ],
    analyticPeakMs: () => 0,
  },
  {
    category: "tick", milestone: "M1", syncPoint: "onset", loopable: false, direction: "none", energy: 1, tags: ["ui", "counter"],
    variants: [{ variant: 0, durationSec: 0.03, seed: 8 }, { variant: 1, durationSec: 0.03, seed: 9 }],
    // 3 ms click high-passed at 4 kHz (+ a faint 2.6 kHz ping)
    args: ({ durationSec: D, seed, sampleRate }) => [
      ...lavfi(`anoisesrc=color=white:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=1:seed=${seed}`),
      ...lavfi(`aevalsrc='0.25*sin(2*PI*${n(2400 + 400 * hash01(seed, 5))}*t)*exp(-t/0.006)':s=${sampleRate}:d=${n(D)}`),
      ...graph(`[0:a]highpass=f=4000,aeval='val(0)*exp(-t/0.002)'[c];[c][1:a]amix=inputs=2:weights='1 1':normalize=0,pan=stereo|c0=c0|c1=c0[out]`),
    ],
    analyticPeakMs: () => 0,
  },
  {
    category: "shutter", milestone: "M1", syncPoint: "onset", loopable: false, direction: "none", energy: 2, tags: ["camera", "photo"],
    variants: [{ variant: 0, durationSec: 0.2, seed: 12 }, { variant: 1, durationSec: 0.2, seed: 13 }],
    // click + 40 ms band-passed noise + a second click at +60 ms (the second click is a little softer)
    args: ({ durationSec: D, seed, sampleRate }) => {
      const gap = 0.055 + 0.01 * hash01(seed, 6);
      return [
        ...lavfi(`anoisesrc=color=white:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=1:seed=${seed}`),
        ...lavfi(`anoisesrc=color=white:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=1:seed=${seed + 100}`),
        ...graph(
          `[0:a]highpass=f=2500,aeval='val(0)*(exp(-t/0.003)+0.7*gte(t,${n(gap)})*exp(-(t-${n(gap)})/0.003))'[c];` +
          `[1:a]bandpass=f=1800:width_type=h:w=1600,aeval='val(0)*0.35*gte(t,0.004)*lt(t,0.044)*sin(PI*(t-0.004)/0.04)'[b];` +
          `[c][b]amix=inputs=2:weights='1 1':normalize=0,pan=stereo|c0=c0|c1=c0[out]`,
        ),
      ];
    },
    analyticPeakMs: () => 0,
  },
  {
    category: "ding", milestone: "M1", syncPoint: "onset", loopable: false, direction: "none", energy: 2, tags: ["fact", "stat", "bell"],
    variants: [{ variant: 0, durationSec: 1.2, seed: 0 }, { variant: 1, durationSec: 1.2, seed: 1 }],
    // inharmonic bell partials 1318/2637/3954 Hz, exp(−t/0.35) (variant 1 a whole tone lower)
    args: ({ durationSec: D, seed, sampleRate }) => {
      const f = seed % 2 === 0 ? 1318 : 1175;
      return [
        ...lavfi(`aevalsrc='(sin(2*PI*${f}*t)+0.5*sin(2*PI*${n(f * 2.0008)}*t)+0.25*sin(2*PI*${n(f * 3.006)}*t))*exp(-t/0.35)*min(t/0.003,1)':s=${sampleRate}:d=${n(D)}`),
        ...graph(`[0:a]aecho=0.8:0.4:50:0.2,afade=t=out:st=${n(D - 0.1)}:d=0.1,pan=stereo|c0=c0|c1=c0[out]`),
      ];
    },
    analyticPeakMs: () => 1,
  },
  {
    category: "notification", milestone: "M2", syncPoint: "onset", loopable: false, direction: "none", energy: 2, tags: ["social", "ui"],
    variants: [{ variant: 0, durationSec: 1.0, seed: 0 }, { variant: 1, durationSec: 1.0, seed: 1 }],
    // two-note chime: 1568 Hz then 2093 Hz at +120 ms (variant 1 a fourth lower)
    args: ({ durationSec: D, seed, sampleRate }) => {
      const k = seed % 2 === 0 ? 1 : 0.75;
      const a = 1568 * k, b = 2093 * k;
      const bell = (f: number, t0: number) => `gte(t,${n(t0)})*(sin(2*PI*${n(f)}*(t-${n(t0)}))+0.3*sin(2*PI*${n(f * 2.001)}*(t-${n(t0)})))*exp(-(t-${n(t0)})/0.18)*min((t-${n(t0)})/0.003,1)`;
      return [
        ...lavfi(`aevalsrc='0.6*(${bell(a, 0)})+0.6*(${bell(b, 0.12)})':s=${sampleRate}:d=${n(D)}`),
        ...graph(`[0:a]aecho=0.8:0.35:40:0.15,afade=t=out:st=${n(D - 0.1)}:d=0.1,pan=stereo|c0=c0|c1=c0[out]`),
      ];
    },
    analyticPeakMs: () => 1,
  },
  {
    category: "glitch", milestone: "M1", syncPoint: "onset", loopable: false, direction: "none", energy: 3, tags: ["digital", "error"],
    variants: [{ variant: 0, durationSec: 0.6, seed: 1 }, { variant: 1, durationSec: 0.6, seed: 2 }, { variant: 2, durationSec: 0.6, seed: 3 }],
    // gated square + bit-crushed noise bursts (gate rates vary per seed)
    args: ({ durationSec: D, seed, sampleRate }) => {
      const g1 = 19 + 8 * hash01(seed, 7), g2 = 5 + 4 * hash01(seed, 8), g3 = 9 + 5 * hash01(seed, 9);
      return [
        ...lavfi(`aevalsrc='(random(0)*2-1)*0.6*gt(sin(2*PI*${n(g1)}*t+0.3),0.2)+0.4*sgn(sin(2*PI*(180+400*gt(sin(2*PI*${n(g2)}*t),0))*t))*gt(sin(2*PI*${n(g3)}*t+1.2),-0.3)':s=${sampleRate}:d=${n(D)}`),
        ...graph(`[0:a]acrusher=bits=6:samples=8:mix=1,highpass=f=200,aeval='val(0)*min(1,t/0.002)*min(1,(${n(D)}-t)/0.05)',pan=stereo|c0=c0|c1=c0[out]`),
      ];
    },
  },
  {
    category: "paper", milestone: "M1", syncPoint: "onset", loopable: false, direction: "none", energy: 1, tags: ["document", "page"],
    variants: [{ variant: 0, durationSec: 0.5, seed: 2 }, { variant: 1, durationSec: 0.5, seed: 4 }],
    // pink noise 1–6 kHz with flutter (tremolo), fast attack, slide-out decay
    args: ({ durationSec: D, seed, sampleRate }) => [
      ...lavfi(`anoisesrc=color=pink:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=0.9:seed=${seed}`),
      ...graph(`[0:a]highpass=f=1000,lowpass=f=6000,tremolo=f=${n(14 + 6 * hash01(seed, 10))}:d=0.7,aeval='val(0)*min(t/0.015,1)*exp(-t/0.16)*min(1,(${n(D)}-t)/0.03)',pan=stereo|c0=c0|c1=c0[out]`),
    ],
  },
  {
    category: "marker", milestone: "M2", syncPoint: "onset", loopable: false, direction: "none", energy: 1, tags: ["highlight", "pen"],
    variants: [{ variant: 0, durationSec: 0.6, seed: 31 }, { variant: 1, durationSec: 0.6, seed: 32 }],
    // band-passed noise scribble 2–5 kHz with a 9 Hz AM
    args: ({ durationSec: D, seed, sampleRate }) => [
      ...lavfi(`anoisesrc=color=white:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=0.8:seed=${seed}`),
      ...graph(`[0:a]highpass=f=2000,lowpass=f=5000,aeval='val(0)*(0.55+0.45*sin(2*PI*${n(8 + 2 * hash01(seed, 11))}*t))*min(t/0.01,1)*min(1,(${n(D)}-t)/0.04)',pan=stereo|c0=c0|c1=c0[out]`),
    ],
  },
  {
    category: "keys", milestone: "M1", syncPoint: "onset", loopable: true, direction: "none", energy: 1, tags: ["typing", "keyboard"], loop: { periodic: true },
    variants: [{ variant: 0, durationSec: 1.5, seed: 41 }],
    // click train at 9–14 Hz with timing jitter and accents; the period divides the file so it loops seamlessly
    args: ({ durationSec, seed, sampleRate }) => {
      const R = keysRate(seed);
      const D = keysDuration(durationSec, seed);
      const slot = `floor(t*${n(R)})`;
      const jit = `(0.3/${n(R)})*(0.5+0.5*sin(${slot}*12.9898+${seed}))`;
      const local = `(t-${slot}/${n(R)}-${jit})`;
      const acc = `(0.6+0.4*abs(sin(${slot}*78.233+${seed})))`;
      return [
        ...lavfi(`anoisesrc=color=white:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=1:seed=${seed}`),
        ...lavfi(`aevalsrc='${acc}*gte(${local},0)*(exp(-${local}/0.004)+0.2*sin(2*PI*1700*${local})*exp(-${local}/0.012))':s=${sampleRate}:d=${n(D)}`),
        ...graph(`[0:a]highpass=f=1800[nz];[nz][1:a]amultiply,pan=stereo|c0=c0|c1=c0[out]`),
      ];
    },
  },
  {
    category: "tape.stop", milestone: "M2", syncPoint: "onset", loopable: false, direction: "none", energy: 3, tags: ["comedic", "stop"],
    variants: [{ variant: 0, durationSec: 0.8, seed: 0 }],
    // falling saw (phase 220·(t − t²/1.6)) + low-pass
    args: ({ durationSec: D, sampleRate }) => [
      ...lavfi(`aevalsrc='(0.5*${saw("220*(t-t*t/1.6)")}+0.3*sin(2*PI*110*(t-t*t/1.6)))*exp(-t/0.6)*min(t/0.003,1)':s=${sampleRate}:d=${n(D)}`),
      ...graph(`[0:a]lowpass=f=1800,afade=t=out:st=${n(D - 0.08)}:d=0.08,pan=stereo|c0=c0|c1=c0[out]`),
    ],
  },
  {
    category: "drone", milestone: "M1", syncPoint: "onset", loopable: true, direction: "none", energy: 2, tags: ["tension", "bed"], loop: { xfadeSec: 0.5, law: "linear" },
    variants: [{ variant: 0, durationSec: 8, seed: 0 }, { variant: 1, durationSec: 8, seed: 1 }],
    // 55 + 82.5 Hz sines with a 0.25 Hz beating partner, low-passed at 400 Hz. Frequencies have an integer number of cycles
    // in 8 s, so the crossfaded loop is exactly periodic. Variant 1 sits a tone lower (49 / 73.5 Hz).
    args: ({ durationSec: D, seed, sampleRate }) => {
      const f = seed % 2 === 0 ? 55 : 49;
      return [
        ...lavfi(`aevalsrc='0.45*sin(2*PI*${f}*t)+0.35*sin(2*PI*${n(f + 0.25)}*t+1)+0.3*sin(2*PI*${n(f * 1.5)}*t+2)+0.08*sin(2*PI*${n(f * 4)}*t)*(0.5+0.5*sin(2*PI*0.125*t))':s=${sampleRate}:d=${n(D)}`),
        ...graph(`[0:a]lowpass=f=400,aeval='val(0)|val(0)*0.98':c=stereo[out]`),
      ];
    },
  },
  {
    category: "heartbeat", milestone: "M2", syncPoint: "onset", loopable: true, direction: "none", energy: 3, tags: ["tension", "pulse"], loop: { periodic: true },
    variants: [{ variant: 0, durationSec: 4, seed: 0 }],
    // two low thumps 60 ms apart every 0.8 s (5 periods in 4 s: seamless)
    args: ({ durationSec: D, sampleRate }) => {
      const thump = (t0: number, a: number) => `${n(a)}*gte(mod(t,0.8),${n(t0)})*sin(2*PI*(42*(mod(t,0.8)-${n(t0)})+30*0.02*(1-exp(-(mod(t,0.8)-${n(t0)})/0.02))))*exp(-(mod(t,0.8)-${n(t0)})/0.05)*min((mod(t,0.8)-${n(t0)})/0.002,1)`;
      return [
        ...lavfi(`aevalsrc='${thump(0.01, 1)}+${thump(0.07, 0.75)}':s=${sampleRate}:d=${n(D)}`),
        ...graph(`[0:a]lowpass=f=300,pan=stereo|c0=c0|c1=c0[out]`),
      ];
    },
  },
  {
    category: "bleep", milestone: "M1", syncPoint: "onset", loopable: false, direction: "none", energy: 2, tags: ["censor"], norm: { peakDbfs: -18 },
    variants: [{ variant: 0, durationSec: 1, seed: 0 }],
    // 1 kHz sine at −18 dBFS with 2 ms ramps (the director trims it to the word)
    args: ({ durationSec: D, sampleRate }) => [
      ...lavfi(`aevalsrc='sin(2*PI*1000*t)*min(t/0.002,1)*min((${n(D)}-t)/0.002,1)':s=${sampleRate}:d=${n(D)}`),
      ...graph(`[0:a]pan=stereo|c0=c0|c1=c0[out]`),
    ],
    analyticPeakMs: () => 0,
  },
  {
    category: "ambience.room", milestone: "M1", syncPoint: "onset", loopable: true, direction: "none", energy: 1, tags: ["room tone", "bed"], loop: { xfadeSec: 1, law: "power" },
    variants: [{ variant: 0, durationSec: 10, seed: 51 }, { variant: 1, durationSec: 10, seed: 52 }],
    // brown noise low-passed at 300 Hz + pink noise band 200–800 Hz at −12 dB, slow 0.1 Hz AM (one cycle per loop)
    args: ({ durationSec: D, seed, sampleRate }) => [
      ...lavfi(`anoisesrc=color=brown:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=0.9:seed=${seed}`),
      ...lavfi(`anoisesrc=color=pink:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=0.9:seed=${seed + 1000}`),
      ...lavfi(`anoisesrc=color=brown:duration=${n(D)}:sample_rate=${sampleRate}:amplitude=0.9:seed=${seed + 2000}`),
      ...graph(
        `[0:a]lowpass=f=300[l];[2:a]lowpass=f=300[r];[1:a]highpass=f=200,lowpass=f=800,volume=-12dB,asplit=2[p1][p2];` +
        `[l][p1]amix=inputs=2:normalize=0[ml];[r][p2]amix=inputs=2:normalize=0[mr];[ml][mr]join=inputs=2:channel_layout=stereo,` +
        `aeval='val(0)*(1+0.25*sin(2*PI*0.1*t))|val(1)*(1+0.25*sin(2*PI*0.1*t))':c=stereo[out]`,
      ),
    ],
  },
];

/** Keys: deterministic rate in 9–14 Hz. */
function keysRate(seed: number): number {
  return 9 + 5 * hash01(seed, 12);
}
/** Keys: a whole number of click slots, so the file loops on the slot grid. */
function keysDuration(durationSec: number, seed: number): number {
  const R = keysRate(seed);
  return Math.max(1, Math.round(durationSec * R)) / R;
}

/** The actual rendered length of a recipe variant (keys snap to their slot grid). */
export function renderedDurationSec(r: SfxRecipe, v: { durationSec: number; seed: number }): number {
  if (r.category === "keys") return keysDuration(v.durationSec, v.seed);
  return v.durationSec;
}

/** Category peak targets (dBFS) used to peak-normalise short sounds (§11.1, drama `sfxPolicy.peakDb`). */
export const CATEGORY_PEAK_DBFS: Readonly<Partial<Record<SfxCategory, readonly [number, number]>>> = {
  "whoosh.light": [-24, -18], "whoosh.heavy": [-22, -18], "whoosh.whip": [-22, -18], "whoosh.up": [-22, -18], "swell.reverse": [-22, -16],
  riser: [-20, -14], impact: [-12, -6], "impact.soft": [-16, -10], "boom.sub": [-12, -6], "boom.low": [-14, -8], thud: [-16, -10],
  pop: [-22, -16], click: [-24, -18], tick: [-28, -22], ding: [-22, -16], shutter: [-20, -14], glitch: [-20, -14], paper: [-24, -18],
  marker: [-26, -20], keys: [-28, -22], notification: [-20, -14], drone: [-30, -24], heartbeat: [-22, -16], bleep: [-18, -18],
  "ambience.room": [-38, -32], "ambience.crowd": [-34, -28],
};

/** Categories that only come from opt-in packs (never procedural). */
export const NON_PROCEDURAL_CATEGORIES: readonly SfxCategory[] = ["ambience.crowd", "cash", "scratch"];

/** M1 subset used by the director (§0.3). */
export const M1_CATEGORIES: readonly SfxCategory[] = SFX_RECIPES.filter((r) => r.milestone === "M1").map((r) => r.category);
