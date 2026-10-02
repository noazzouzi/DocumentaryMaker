// Silence analysis on float samples (mirrors ffmpeg silencedetect semantics: |x| below the threshold for ≥ d).

export const dbToAmp = (db: number) => Math.pow(10, db / 20);

/** Index of the first / last sample whose magnitude exceeds the threshold; null when everything is below. */
export function soundBounds(samples: Float32Array, thresholdDb: number): { first: number; last: number } | null {
  const thr = dbToAmp(thresholdDb);
  let first = -1, last = -1;
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]!) > thr) { first = i; break; }
  if (first < 0) return null;
  for (let i = samples.length - 1; i >= first; i--) if (Math.abs(samples[i]!) > thr) { last = i; break; }
  return { first, last };
}

export interface SilenceSpan { startMs: number; endMs: number }

/** Silent spans (≥ minMs, magnitude ≤ threshold) — like silencedetect=n=<db>dB:d=<minMs/1000>. */
export function detectSilences(samples: Float32Array, sampleRate: number, o: { thresholdDb: number; minMs: number }): SilenceSpan[] {
  const thr = dbToAmp(o.thresholdDb);
  const minLen = Math.round((o.minMs * sampleRate) / 1000);
  const out: SilenceSpan[] = [];
  let start = -1;
  const flush = (end: number) => {
    if (start >= 0 && end - start >= minLen) out.push({ startMs: (start * 1000) / sampleRate, endMs: (end * 1000) / sampleRate });
    start = -1;
  };
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]!) <= thr) { if (start < 0) start = i; }
    else flush(i);
  }
  flush(samples.length);
  return out;
}

/**
 * Windowed RMS silence (10 ms windows): spans whose window RMS stays below thresholdDb for ≥ minMs.
 * More robust than per-sample magnitude on noisy recordings.
 */
export function detectRmsSilences(samples: Float32Array, sampleRate: number, o: { thresholdDb: number; minMs: number; windowMs?: number }): SilenceSpan[] {
  const win = Math.max(1, Math.round(((o.windowMs ?? 10) * sampleRate) / 1000));
  const thr = dbToAmp(o.thresholdDb);
  const out: SilenceSpan[] = [];
  let start = -1;
  const nWin = Math.ceil(samples.length / win);
  const flush = (endWin: number) => {
    if (start >= 0) {
      const s = start * win, e = Math.min(samples.length, endWin * win);
      if (((e - s) * 1000) / sampleRate >= o.minMs) out.push({ startMs: (s * 1000) / sampleRate, endMs: (e * 1000) / sampleRate });
    }
    start = -1;
  };
  for (let w = 0; w < nWin; w++) {
    let sum = 0;
    const a = w * win, b = Math.min(samples.length, a + win);
    for (let i = a; i < b; i++) sum += samples[i]! * samples[i]!;
    const rms = Math.sqrt(sum / Math.max(1, b - a));
    if (rms < thr) { if (start < 0) start = w; }
    else flush(w);
  }
  flush(nWin);
  return out;
}

/** Trims leading/trailing windows below thresholdDb RMS, keeping keepMs of padding (sherpa sentences). */
export function trimSilenceRms(samples: Float32Array, sampleRate: number, o: { thresholdDb: number; keepMs: number }): Float32Array {
  const sil = detectRmsSilences(samples, sampleRate, { thresholdDb: o.thresholdDb, minMs: 0 });
  const durMs = (samples.length * 1000) / sampleRate;
  let a = 0, b = samples.length;
  const head = sil[0];
  if (head && head.startMs === 0) a = Math.max(0, Math.round(((head.endMs - o.keepMs) * sampleRate) / 1000));
  const tail = sil[sil.length - 1];
  if (tail && Math.abs(tail.endMs - durMs) < 1e-6 && tail.startMs > 0) b = Math.min(samples.length, Math.round(((tail.startMs + o.keepMs) * sampleRate) / 1000));
  if (b <= a) return samples.slice(0, 0);
  return samples.slice(a, b);
}
