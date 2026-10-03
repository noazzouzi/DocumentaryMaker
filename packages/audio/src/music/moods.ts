// Mood tables of the procedural score (§11.3): tempi, chord loops, instrument sets per energy.
import type { MusicMood } from "@docmaker/core";

/** Default tempo per mood (mirrors the drama style's musicPolicy.moodBpm). */
export const MOOD_BPM: Readonly<Record<MusicMood, number>> = {
  none: 80, ominous: 70, tense: 95, sad: 72, uplifting: 110, mysterious: 80, epic: 90, chill: 85, comedic: 115,
};

export interface ChordDegree { root: number; quality: "maj" | "min" } // root in semitones above the tonic
export interface ChordLoop { name: string; mode: "minor" | "major"; chords: readonly ChordDegree[] }

const m = (root: number): ChordDegree => ({ root, quality: "min" });
const M = (root: number): ChordDegree => ({ root, quality: "maj" });

export const CHORD_LOOPS = {
  /** i–VI–III–VII (tense / ominous / mysterious) */
  dark: { name: "i-VI-III-VII", mode: "minor", chords: [m(0), M(8), M(3), M(10)] },
  /** i–iv–VI–V (sad) */
  sad: { name: "i-iv-VI-V", mode: "minor", chords: [m(0), m(5), M(8), M(7)] },
  /** I–V–vi–IV (uplifting / chill / comedic) */
  bright: { name: "I-V-vi-IV", mode: "major", chords: [M(0), M(7), m(9), M(5)] },
  /** i–VII–VI–VII (epic) */
  epic: { name: "i-VII-VI-VII", mode: "minor", chords: [m(0), M(10), M(8), M(10)] },
} as const satisfies Record<string, ChordLoop>;

export function loopForMood(mood: MusicMood): ChordLoop {
  switch (mood) {
    case "sad": return CHORD_LOOPS.sad;
    case "uplifting": case "chill": case "comedic": case "none": return CHORD_LOOPS.bright;
    case "epic": return CHORD_LOOPS.epic;
    default: return CHORD_LOOPS.dark; // tense, ominous, mysterious
  }
}

export type Instrument = "pad" | "bass" | "kick" | "hat" | "arp" | "drone";

/** Instrument set for a mood and energy (§11.3): pad always; kick for tense/epic or high energy; hats for tense; arp for mysterious. */
export function instrumentsFor(mood: MusicMood, energy: "low" | "mid" | "high"): Set<Instrument> {
  const s = new Set<Instrument>(["pad"]);
  if (energy !== "low") s.add("bass");
  if (energy === "high" || (energy === "mid" && (mood === "tense" || mood === "epic"))) s.add("kick");
  if ((mood === "tense" && energy !== "low") || (energy === "high" && (mood === "uplifting" || mood === "comedic" || mood === "epic"))) s.add("hat");
  if (mood === "mysterious" || (energy !== "low" && (mood === "uplifting" || mood === "chill" || mood === "comedic"))) s.add("arp");
  if (mood === "ominous" || (mood === "mysterious" && energy === "low")) s.add("drone");
  return s;
}

const PITCH_CLASS = { A: 9, D: 2, E: 4, C: 0 } as const;

/**
 * Tonic MIDI note (octave 3) of the chord loop for the requested key: a major loop in a minor key uses the relative
 * major (A minor → C major) and a minor loop in C major uses the relative minor (A minor), so the score stays in key.
 */
export function tonicMidi(key: "A minor" | "D minor" | "E minor" | "C major", mode: "minor" | "major"): number {
  const [letter, kind] = key.split(" ") as [keyof typeof PITCH_CLASS, "minor" | "major"];
  let pc: number = PITCH_CLASS[letter];
  if (kind === "minor" && mode === "major") pc = (pc + 3) % 12;
  if (kind === "major" && mode === "minor") pc = (pc + 9) % 12;
  return 48 + pc; // C3..B3
}

export const midiToHz = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

/** Pentatonic scale degrees for the loop mode (minor: 0 3 5 7 10, major: 0 2 4 7 9). */
export function pentatonic(mode: "minor" | "major"): readonly number[] {
  return mode === "minor" ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
}
