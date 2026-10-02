import { z } from "zod";
import { AssetId, IsoDateTime, Ms, docVersion } from "./common";
import { MusicMood } from "./beats";
import { LicenseInfo } from "./license";

export const SfxCategory = z.enum([
  "whoosh.heavy", "whoosh.light", "whoosh.whip", "whoosh.up", "swell.reverse", "riser",
  "impact", "impact.soft", "boom.sub", "boom.low", "thud",
  "pop", "click", "tick", "ding", "shutter", "glitch", "paper", "marker", "keys", "notification",
  "tape.stop", "bleep", "drone", "heartbeat", "cash", "scratch", "ambience.room", "ambience.crowd",
]);
export type SfxCategory = z.infer<typeof SfxCategory>;
export const SfxSyncPoint = z.enum(["peak", "onset", "end"]);

export const SfxEntry = z.object({
  id: z.string().regex(/^[a-z0-9-]+:[a-z.]+\/\d+$/), // `${pack}:${category}/${variant}` e.g. "procedural:impact/2"
  category: SfxCategory,
  variant: z.number().int().nonnegative(),
  pack: z.string().regex(/^[a-z0-9-]+$/), // "procedural" | "remotion-sfx-cc0" | "hyperframes-pixabay" | "user"
  file: z.string(), // absolute path under DOCMAKER_HOME/sfx/<pack>/<version>/
  assetId: AssetId,
  durationMs: Ms,
  syncPoint: SfxSyncPoint,
  peakOffsetMs: Ms, // position of the sync point from file start (peak | onset | end-30ms)
  peakDbfs: z.number(),
  lufs: z.number().nullable(), // null when < 400 ms (loudnorm can't measure)
  energy: z.number().int().min(1).max(5),
  loopable: z.boolean(), // drones, ambience, keys: may be looped by SfxCue.loop
  direction: z.enum(["LR", "RL", "none"]), // baked pan sweep of the file (procedural whooshes are LR)
  tags: z.array(z.string()),
  license: LicenseInfo,
});
export type SfxEntry = z.infer<typeof SfxEntry>;
export const SfxManifest = z.object({
  schemaVersion: docVersion("sfxManifest"),
  pack: z.string(),
  version: z.string(),
  generatedAt: IsoDateTime,
  entries: z.array(SfxEntry),
});
export type SfxManifest = z.infer<typeof SfxManifest>;

export const MusicTrack = z.object({
  assetId: AssetId, // path = frozen[assetId].projectRel (single source of truth)
  title: z.string(),
  source: z.enum(["procedural", "library", "openverse", "ccmixter", "user"]),
  moods: z.array(MusicMood),
  energy: z.enum(["low", "mid", "high"]),
  bpm: z.number().nullable(),
  beatsMs: z.array(Ms), // beat grid (procedural: exact; library: beats.py when the sidecar is available, else [])
  downbeatsMs: z.array(Ms),
  durationMs: Ms,
  lufs: z.number(), // after normalisation (target -18 LUFS integrated)
  loopable: z.boolean(),
  license: LicenseInfo,
});
export type MusicTrack = z.infer<typeof MusicTrack>;
export const MusicDoc = z.object({ schemaVersion: docVersion("music"), tracks: z.array(MusicTrack) });
export type MusicDoc = z.infer<typeof MusicDoc>;

// ---- inferred types (one per schema constant)
export type SfxSyncPoint = z.infer<typeof SfxSyncPoint>;
