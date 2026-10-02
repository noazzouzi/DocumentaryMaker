// Synthetic "speech-like" voice DSP (§8.3). SELF-CONTAINED: no imports, erasable TypeScript only, because the
// worker_threads path loads this file directly with Node's type stripping. Deterministic for a given plan.

export interface SynthSyllable { f1: number; f2: number }
export interface SynthWord { startMs: number; endMs: number; sentenceStartMs: number; sentenceEndMs: number; syllables: SynthSyllable[] }
export interface SynthPlan { sampleRate: number; f0: number; noiseSeed: number; totalMs: number; words: SynthWord[] }

const TWO_PI = Math.PI * 2;
const ATTACK_MS = 15;
const RELEASE_MS = 40;
const DIP = 0.3; // 30 % envelope dip between syllables
const DIP_HALF_MS = 20;
const TARGET_RMS = 0.1; // −20 dBFS over voiced samples
const PEAK_CEIL = 0.891; // −1 dBFS

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ band-pass (constant 0 dB peak gain), normalised by a0: [b0, b2, a1, a2] (b1 = 0). */
function bandpass(f: number, q: number, sr: number): [number, number, number, number] {
  const w0 = (TWO_PI * f) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return [alpha / a0, -alpha / a0, (-2 * Math.cos(w0)) / a0, (1 - alpha) / a0];
}

/** Renders the plan to mono float samples (silence outside words), RMS-normalised to −20 dBFS. */
export function renderSynth(plan: SynthPlan): Float32Array {
  const sr = plan.sampleRate;
  const total = Math.max(1, Math.round((plan.totalMs * sr) / 1000));
  const out = new Float32Array(total);
  const harmonics = Math.max(1, Math.floor(4000 / plan.f0));
  const noise = mulberry32(plan.noiseSeed);
  const attack = (ATTACK_MS * sr) / 1000, release = (RELEASE_MS * sr) / 1000, dipHalf = (DIP_HALF_MS * sr) / 1000;
  let phase = 0;
  let sumSq = 0, voiced = 0;
  for (const w of plan.words) {
    const s0 = Math.round((w.startMs * sr) / 1000);
    const s1 = Math.min(total, Math.round((w.endMs * sr) / 1000));
    const len = s1 - s0;
    if (len <= 0 || w.syllables.length === 0) continue;
    const nSyl = w.syllables.length;
    const sylLen = len / nSyl;
    const sentLen = Math.max(1, w.sentenceEndMs - w.sentenceStartMs);
    let x1a = 0, x2a = 0, y1a = 0, y2a = 0, x1b = 0, x2b = 0, y1b = 0, y2b = 0;
    let curSyl = -1;
    let ca: [number, number, number, number] = [0, 0, 0, 0], cb: [number, number, number, number] = [0, 0, 0, 0];
    for (let n = 0; n < len; n++) {
      const syl = Math.min(nSyl - 1, Math.floor(n / sylLen));
      if (syl !== curSyl) {
        curSyl = syl;
        ca = bandpass(w.syllables[syl]!.f1, 8, sr);
        cb = bandpass(w.syllables[syl]!.f2, 10, sr);
      }
      const i = s0 + n;
      const tSec = i / sr;
      const tMs = (i * 1000) / sr;
      const progress = Math.min(1, Math.max(0, (tMs - w.sentenceStartMs) / sentLen));
      const declination = 1.06 - 0.14 * progress;
      const f = plan.f0 * (1 + 0.04 * Math.sin(TWO_PI * 5 * tSec)) * declination;
      phase += (TWO_PI * f) / sr;
      if (phase > TWO_PI * 1e6) phase -= TWO_PI * 1e6;
      // band-limited sawtooth via the sin(hφ) recurrence
      const c2 = 2 * Math.cos(phase);
      let sPrev = 0, sCur = Math.sin(phase), src = sCur;
      for (let h = 2; h <= harmonics; h++) {
        const sNext = c2 * sCur - sPrev;
        sPrev = sCur;
        sCur = sNext;
        src += sCur / h;
      }
      const ya = ca[0] * src + ca[1] * x2a - ca[2] * y1a - ca[3] * y2a;
      x2a = x1a; x1a = src; y2a = y1a; y1a = ya;
      const yb = cb[0] * src + cb[1] * x2b - cb[2] * y1b - cb[3] * y2b;
      x2b = x1b; x1b = src; y2b = y1b; y1b = yb;
      const white = noise() * 2 - 1;
      let env = Math.min(1, n / attack, (len - n) / release);
      // 30 % dip centred on each internal syllable boundary
      for (let b = 1; b < nSyl; b++) {
        const d = Math.abs(n - b * sylLen);
        if (d < dipHalf) env *= 1 - DIP * 0.5 * (1 + Math.cos((Math.PI * d) / dipHalf));
      }
      const v = (0.6 * ya + 0.4 * yb + 0.02 * white) * Math.max(0, env);
      out[i] = v;
      if (env > 0) { sumSq += v * v; voiced++; }
    }
  }
  const rms = voiced > 0 ? Math.sqrt(sumSq / voiced) : 0;
  if (rms > 0) {
    let gain = TARGET_RMS / rms;
    let peak = 0;
    for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(out[i]!));
    if (peak * gain > PEAK_CEIL) gain = PEAK_CEIL / peak;
    for (let i = 0; i < total; i++) out[i]! *= gain;
  }
  return out;
}
