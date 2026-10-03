// scanMusicLibrary (§11.3, M2): a user music folder → normalised tracks with moods, licence and (when the Python sidecar
// is installed) a beat grid. Licences are never defaulted: an undeclared file comes back as UNKNOWN/unknown-rights and the
// UI asks for an UploadDeclaration before it can be used.
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { DocmakerError, LicenseInfo, MusicMood, sha16 } from "@docmaker/core";
import { readWavHeader, runSidecar, sha256File, twoPassLoudnorm } from "@docmaker/core/node";
import { checkAbort, writeAtomically } from "../util";
import type { AudioCtx } from "../util";

export const AUDIO_NORM_RECIPE = "audio-norm-v1";
export const LIBRARY_EXTENSIONS = [".wav", ".mp3", ".flac", ".m4a"] as const;
/** Measured bias of the comb beat tracker (it reports beats ≈ 10 ms early on a synthetic kick track; §11.3 "≈ 16 ms early"). */
export const BEATS_LATENCY_MS = 10;

export const UNDECLARED_LICENSE: LicenseInfo = {
  code: "UNKNOWN", version: null, url: null, commercialOk: false, derivativesOk: false, attributionRequired: false,
  attributionText: null, restrictions: ["unknown-rights"],
};

export interface LibraryTrack {
  file: string; title: string; moods: MusicMood[]; license: LicenseInfo; bpm: number | null; beatsMs: number[]; downbeatsMs: number[]; durationMs: number;
  /** The original file (the normalised copy above is what the mix plays). */
  sourceFile: string;
  sourceSha256: string;
  licenseDeclared: boolean;
}

interface BeatsOut { duration: number; bpm: number; period: number; phase: number; beats: { t: number; n: number; bar_pos: number }[] }

async function walk(dir: string, depth = 0): Promise<string[]> {
  if (depth > 6) return [];
  let ents;
  try {
    ents = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, depth + 1)));
    else if (e.isFile() && (LIBRARY_EXTENSIONS as readonly string[]).includes(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

async function readJson(file: string): Promise<unknown | undefined> {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

const moodOf = (s: string): MusicMood | null => {
  const r = MusicMood.safeParse(s.trim().toLowerCase());
  return r.success ? r.data : null;
};

/** moods.json next to the file (`{ "<file name>": ["tense", …] }`), else the folder name, else []. */
async function moodsFor(file: string, root: string): Promise<MusicMood[]> {
  const dir = path.dirname(file);
  const j = await readJson(path.join(dir, "moods.json"));
  if (j && typeof j === "object") {
    const v = (j as Record<string, unknown>)[path.basename(file)];
    if (Array.isArray(v)) return [...new Set(v.map((x) => (typeof x === "string" ? moodOf(x) : null)).filter((x): x is MusicMood => x !== null))];
  }
  if (path.resolve(dir) !== path.resolve(root)) {
    const m = moodOf(path.basename(dir));
    if (m) return [m];
  }
  return [];
}

/**
 * license.json in the file's folder or the nearest ancestor up to the library root. Accepted shapes: a LicenseInfo
 * (applies to every file below), or `{ "default"?: LicenseInfo, "files"?: { "<file name>": LicenseInfo } }`.
 */
async function licenseFor(file: string, root: string): Promise<LicenseInfo | null> {
  let dir = path.dirname(file);
  const top = path.resolve(root);
  for (;;) {
    const j = await readJson(path.join(dir, "license.json"));
    if (j && typeof j === "object") {
      const o = j as { files?: Record<string, unknown>; default?: unknown };
      const own = o.files?.[path.basename(file)] ?? o.files?.[path.relative(dir, file)];
      for (const cand of [own, o.default, j]) {
        const r = LicenseInfo.safeParse(cand);
        if (r.success) return r.data;
      }
    }
    if (path.resolve(dir) === top || path.dirname(dir) === dir) return null;
    dir = path.dirname(dir);
  }
}

const titleOf = (file: string) => path.basename(file, path.extname(file)).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

/** Steady 4/4 grid from the tracker's tempo and phase (latency-corrected), downbeats from its bar positions. */
export function gridFromBeats(b: BeatsOut, durationMs: number): { bpm: number; beatsMs: number[]; downbeatsMs: number[] } {
  const periodMs = b.period * 1000;
  if (!(periodMs > 0) || !b.beats.length) return { bpm: b.bpm, beatsMs: [], downbeatsMs: [] };
  const first = b.beats.find((x) => x.bar_pos === 0);
  const n0 = first ? ((first.n % 4) + 4) % 4 : 0;
  const start = b.phase * 1000 + BEATS_LATENCY_MS;
  const beatsMs: number[] = [];
  const downbeatsMs: number[] = [];
  for (let k = 0; ; k++) {
    const ms = Math.round(start + k * periodMs);
    if (ms >= durationMs) break;
    beatsMs.push(ms);
    if ((((k - n0) % 4) + 4) % 4 === 0) downbeatsMs.push(ms);
  }
  return { bpm: b.bpm, beatsMs, downbeatsMs };
}

export async function scanMusicLibraryImpl(dir: string, ctx: AudioCtx): Promise<LibraryTrack[]> {
  if (!existsSync(dir)) throw new DocmakerError("VALIDATION", `music library folder not found: ${dir}`);
  const files = await walk(dir);
  const normDir = path.join(ctx.config.paths.cache, "music-norm");
  await mkdir(normDir, { recursive: true });
  const out: LibraryTrack[] = [];
  let sidecar = true;
  for (const [k, file] of files.entries()) {
    checkAbort(ctx.signal, "music library scan");
    ctx.progress(k / Math.max(1, files.length), `music: ${path.basename(file)}`);
    const sourceSha256 = await sha256File(file);
    const norm = path.join(normDir, `${sha16(`${sourceSha256}:${AUDIO_NORM_RECIPE}`)}.wav`);
    if (!existsSync(norm)) {
      try {
        await writeAtomically(norm, (tmp) => twoPassLoudnorm(file, tmp, { I: -18, TP: -1.5, LRA: 11, sampleRate: 48000, channels: 2, codec: "pcm_s16le", config: ctx.config, signal: ctx.signal }).then(() => undefined));
      } catch (e) {
        if (e instanceof DocmakerError && e.code === "CANCELED") throw e;
        ctx.logger.warn("music file could not be decoded; skipped", { file, error: String(e) });
        continue;
      }
    }
    const h = await readWavHeader(norm);
    const durationMs = h.durationMs;
    let grid: { bpm: number | null; beatsMs: number[]; downbeatsMs: number[] } = { bpm: null, beatsMs: [], downbeatsMs: [] };
    if (sidecar) {
      try {
        const b = await runSidecar<BeatsOut>("beats", { wav: norm, fps: 30 }, { config: ctx.config, signal: ctx.signal, timeoutMs: 300_000 });
        grid = gridFromBeats(b, durationMs);
      } catch (e) {
        if (e instanceof DocmakerError && e.code === "CANCELED") throw e;
        if (e instanceof DocmakerError && e.code === "TOOL_MISSING") {
          sidecar = false; // no venv: no grids for this scan (music still usable, sections just don't snap to downbeats)
          ctx.logger.info("Python sidecar not installed: library tracks get no beat grid", { hint: "docmaker setup --python" });
        } else {
          ctx.logger.warn("beat tracking failed; track has no grid", { file, error: String(e) });
        }
      }
    }
    const declared = await licenseFor(file, dir);
    out.push({
      file: norm, title: titleOf(file), moods: await moodsFor(file, dir), license: declared ?? UNDECLARED_LICENSE,
      bpm: grid.bpm, beatsMs: grid.beatsMs, downbeatsMs: grid.downbeatsMs, durationMs,
      sourceFile: file, sourceSha256, licenseDeclared: declared !== null,
    });
  }
  ctx.progress(1, `music library: ${out.length} track(s)`);
  return out;
}
