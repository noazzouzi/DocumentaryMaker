// The procedural score (§11.3): pad, bass pulse, kick, hats, pluck arp and drone over a 4-chord loop, rendered as a
// seamless loop. Events are periodic with the loop length L: every event in the last `PREROLL` seconds is also rendered
// one loop earlier (negative time), filters and the reverb run from −PREROLL, and continuous oscillators use frequencies
// with a whole number of cycles per loop — so sample L−1 flows into sample 0.
import { rngFor } from "@docmaker/core";
import type { MusicMood } from "@docmaker/core";
import { instrumentsFor, loopForMood, midiToHz, pentatonic, tonicMidi } from "./moods";
import { Bus, TAU, blepSaw, onePoleHighpass, onePoleLowpass, schroeder } from "./synth";

export const SYNTH_VERSION = "score-v1";
const PREROLL_SEC = 6;

export interface ScoreOptions {
  mood: MusicMood; bpm: number; bars: number; seed: number;
  key: "A minor" | "D minor" | "E minor" | "C major"; energy: "low" | "mid" | "high";
  sampleRate: number;
}
export interface Score { L: Float32Array; R: Float32Array; beatSamples: number[]; loopSamples: number; instruments: string[] }

/** Beat i starts at the exact sample round(i · 60/bpm · sr). */
export function beatSample(i: number, bpm: number, sr: number): number {
  return Math.round((i * 60 * sr) / bpm);
}

export function renderScore(o: ScoreOptions): Score {
  const sr = o.sampleRate;
  const beats = o.bars * 4;
  const loop = beatSample(beats, o.bpm, sr); // L
  const pre = Math.round(PREROLL_SEC * sr);
  const total = pre + loop;
  const loopSec = loop / sr;
  const periodic = (f: number) => Math.max(1, Math.round(f * loopSec)) / loopSec; // whole cycles per loop
  const cl = loopForMood(o.mood);
  const tonic = tonicMidi(o.key, cl.mode);
  const inst = instrumentsFor(o.mood, o.energy);
  const R = (k: string) => rngFor(o.seed, `${SYNTH_VERSION}:${o.mood}:${o.energy}:${k}`);
  const beatLen = (60 * sr) / o.bpm;
  const barLen = 4 * beatLen;

  const pad = new Bus(total);
  const dry = new Bus(total);
  const lvl = o.energy === "low" ? 0.8 : o.energy === "mid" ? 1 : 1.1;

  /** Schedules an event at loop sample s (and its copy one loop earlier when it falls in the pre-roll). */
  const at = (s: number, fn: (t0: number) => void) => {
    fn(pre + s);
    if (s - loop >= -pre) fn(pre + s - loop);
  };

  // ---- pad: 3 detuned PolyBLEP saws per chord tone, 1.5 s attack, 1.2 s release overlapping the next chord
  if (inst.has("pad")) {
    const attack = 1.5 * sr, release = 1.2 * sr;
    for (let bar = 0; bar < o.bars; bar++) {
      const ch = cl.chords[bar % cl.chords.length]!;
      const root = tonic + ch.root;
      const notes = [root, root + (ch.quality === "min" ? 3 : 4), root + 7, ...(o.energy === "low" ? [] : [root + 12])];
      const s0 = beatSample(bar * 4, o.bpm, sr);
      const hold = beatSample(bar * 4 + 4, o.bpm, sr) - s0;
      const n = hold + release;
      notes.forEach((m, k) => {
        const f = midiToHz(m);
        const detune = [1, 1.0041, 0.9959];
        const ph0 = R(`pad:${bar}:${k}`)();
        at(s0, (t0) => {
          const phases = detune.map((_, j) => (ph0 + j / 3) % 1);
          pad.put(t0, n, (i) => {
            let v = 0;
            for (let j = 0; j < 3; j++) {
              const dt = (f * detune[j]!) / sr;
              v += blepSaw(phases[j]!, dt);
              phases[j] = (phases[j]! + dt) % 1;
            }
            const env = (i < attack ? i / attack : 1) * (i < hold ? 1 : Math.max(0, 1 - (i - hold) / release));
            return v * env;
          }, { gain: (0.05 * lvl) / Math.sqrt(notes.length / 3), pan: (k - (notes.length - 1) / 2) * 0.35 });
        });
      });
    }
    const cutoff = o.energy === "low" ? 900 : o.energy === "mid" ? 1200 : 1500;
    onePoleLowpass(pad.L, cutoff, sr);
    onePoleLowpass(pad.R, cutoff, sr);
  }

  // ---- bass pulse: sine + sub on beats 1 and 3
  if (inst.has("bass")) {
    for (let bar = 0; bar < o.bars; bar++) {
      const ch = cl.chords[bar % cl.chords.length]!;
      const f = midiToHz(tonic + ch.root - 12);
      for (const b of [0, 2]) {
        const s0 = beatSample(bar * 4 + b, o.bpm, sr);
        const n = Math.round(2 * beatLen);
        at(s0, (t0) => dry.put(t0, n, (i) => {
          const t = i / sr;
          const env = Math.min(1, t / 0.006) * Math.exp(-t / 0.35) * Math.min(1, (n - i) / (0.02 * sr));
          return env * (Math.sin(TAU * f * t) + 0.6 * Math.sin(TAU * (f / 2) * t));
        }, { gain: 0.11 * lvl }));
      }
    }
  }

  // ---- kick: 120→45 Hz sine, 180 ms; every beat at high energy, beats 1 and 3 otherwise (dropped on the bar-8 fill)
  if (inst.has("kick")) {
    const n = Math.round(0.18 * sr);
    for (let b = 0; b < beats; b++) {
      const inBar = b % 4;
      const bar = Math.floor(b / 4);
      if (o.energy !== "high" && inBar % 2 === 1) continue;
      if (bar % 8 === 7 && inBar === 3) continue; // breath before the next phrase
      at(beatSample(b, o.bpm, sr), (t0) => dry.put(t0, n, (i) => {
        const t = i / sr;
        const ph = 45 * t + 75 * 0.04 * (1 - Math.exp(-t / 0.04));
        return Math.sin(TAU * ph) * Math.exp(-t / 0.15) * Math.min(1, t / 0.002) * Math.min(1, (n - i) / (0.01 * sr));
      }, { gain: (inBar === 0 ? 0.5 : 0.42) * lvl }));
    }
  }

  // ---- hats: 30 ms high-passed noise on the off-beats
  if (inst.has("hat")) {
    const n = Math.round(0.03 * sr);
    for (let b = 0; b < beats; b++) {
      const s0 = Math.round(((b + 0.5) * 60 * sr) / o.bpm);
      const rnd = R(`hat:${b}`);
      const v = 0.75 + 0.25 * rnd();
      let prev = 0;
      at(s0, (t0) => {
        const r2 = R(`hatnoise:${b}`);
        prev = 0;
        dry.put(t0, n, (i) => {
          const w = r2() * 2 - 1;
          const hp = w - prev; // first difference: a cheap high-pass
          prev = w;
          return hp * Math.exp(-i / (0.008 * sr));
        }, { gain: 0.05 * v * lvl, pan: 0.3, send: 0.15 });
      });
    }
  }

  // ---- pluck arp: pentatonic eighths (sixteenths at high energy) around the chord root, alternating pans
  if (inst.has("arp")) {
    const scale = pentatonic(cl.mode);
    const steps = o.energy === "high" ? 16 : 8;
    const n = Math.round(0.6 * sr);
    for (let bar = 0; bar < o.bars; bar++) {
      const ch = cl.chords[bar % cl.chords.length]!;
      const rnd = R(`arp:${Math.floor(bar / 4)}:${bar % 4}`);
      let deg = Math.floor(rnd() * scale.length);
      for (let s = 0; s < steps; s++) {
        if (o.energy === "low" && s % 2 === 1) continue;
        deg = Math.max(0, Math.min(scale.length * 2 - 1, deg + (rnd() < 0.5 ? -1 : 1) * (rnd() < 0.3 ? 2 : 1)));
        const midi = tonic + 12 + ((ch.root % 12) > 6 ? -5 : 0) + scale[deg % scale.length]! + 12 * Math.floor(deg / scale.length);
        const f = midiToHz(midi);
        const s0 = Math.round(((bar * 4 + (4 * s) / steps) * 60 * sr) / o.bpm);
        const accent = s % 4 === 0 ? 1 : 0.7;
        at(s0, (t0) => dry.put(t0, n, (i) => {
          const t = i / sr;
          return (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / 0.08)) * Math.exp(-t / 0.18) * Math.min(1, t / 0.002) * Math.min(1, (n - i) / (0.02 * sr));
        }, { gain: 0.07 * accent * lvl, pan: s % 2 ? 0.35 : -0.35, send: 0.35 }));
      }
    }
  }

  // ---- drone: tonic in octave 1 with a ≈0.3 Hz beating partner and a soft fifth (periodic over the loop)
  if (inst.has("drone")) {
    let fr = midiToHz(tonic - 24);
    while (fr > 75) fr /= 2;
    const f1 = periodic(fr), f2 = periodic(fr + 0.3), f3 = periodic(fr * 1.5), lfo = periodic(0.05);
    const ph = R("drone")() * TAU;
    for (let k = 0; k < total; k++) {
      const t = (k - pre) / sr;
      const v = 0.5 * Math.sin(TAU * f1 * t + ph) + 0.4 * Math.sin(TAU * f2 * t) + 0.15 * Math.sin(TAU * f3 * t + 1);
      const sw = 0.8 + 0.2 * Math.sin(TAU * lfo * t);
      dry.L[k]! += 0.12 * lvl * v * sw;
      dry.R[k]! += 0.12 * lvl * v * sw * 0.97;
    }
  }

  // ---- mix: pad + dry, reverb on the sends (pad sends 0.5), gentle high-pass at 30 Hz, soft saturation
  const sendL = new Float32Array(total), sendR = new Float32Array(total);
  for (let k = 0; k < total; k++) {
    sendL[k] = dry.sendL[k]! + pad.L[k]! * 0.5;
    sendR[k] = dry.sendR[k]! + pad.R[k]! * 0.5;
  }
  const wl = schroeder(sendL, sr, 0);
  const wr = schroeder(sendR, sr, 23);
  const outL = new Float32Array(total), outR = new Float32Array(total);
  for (let k = 0; k < total; k++) {
    outL[k] = pad.L[k]! + dry.L[k]! + wl[k]! * 3;
    outR[k] = pad.R[k]! + dry.R[k]! + wr[k]! * 3;
  }
  onePoleHighpass(outL, 30, sr);
  onePoleHighpass(outR, 30, sr);
  for (let k = 0; k < total; k++) {
    outL[k] = Math.tanh(outL[k]! * 1.1) / 1.1;
    outR[k] = Math.tanh(outR[k]! * 1.1) / 1.1;
  }
  const beatSamples: number[] = [];
  for (let b = 0; b < beats; b++) beatSamples.push(beatSample(b, o.bpm, sr));
  return { L: outL.slice(pre), R: outR.slice(pre), beatSamples, loopSamples: loop, instruments: [...inst].sort() };
}
