// Conform for NLE (§13.2): every file the export timeline references is placed in export/<lang>/media/ (stems in
// export/<lang>/stems/) under a unique ASCII-safe name, converted when needed:
//   stills  → exactly 1920×1080 PNG/JPG, cover-cropped from VisualSource.crop (else around focal) — the SAME geometry
//             as the Remotion StillLayer (coverRect), so render framing and NLE framing match; blur-pad for contain-blur
//   video   → hardlinked when already 1920×1080 at the timeline fps without a crop, else CFR H.264 re-framed
//   audio   → 48 kHz PCM WAV, one stream (VO mono; music, SFX and clip audio stereo); RL pan sweeps → mirrored copy
// Reads ONLY the Timeline (never picks.json). Results are cached in media/.conform.json (input signature per output).
import { link, mkdir, readdir, readFile, rename, rm, stat, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DocmakerError, type Timeline, type TimelineAsset } from "@docmaker/core";
import { ffmpeg, ffprobeJson, readWavHeader } from "@docmaker/core/node";
import { conformName } from "./paths";
import {
  type ConformMap, type ConformedMedia, type ExportCtx, type PictureFit, STEM_NAMES, clipWavKey, fitOf, framingOf,
  mirroredSfxKey, overlayKey, pictureKey, stemKey,
} from "./types";

export interface ConformInput { projectDir: string; exportDir: string; generatedStills: Record<string, string>; overlays: Record<string, string> | null; stems: Record<string, string> }

const W = 1920;
const H = 1080;
const MANIFEST = ".conform.json";
const MANIFEST_VERSION = 2;

type Recipe =
  | { op: "still"; src: string; crop: { x: number; y: number; w: number; h: number } | null; focal: { x: number; y: number }; fit: PictureFit }
  | { op: "video"; src: string; crop: { x: number; y: number; w: number; h: number } | null; focal: { x: number; y: number }; fps: number }
  | { op: "gen-copy"; src: string }
  | { op: "solid"; color: string }
  | { op: "gradient"; colors: string[] }
  | { op: "wav"; src: string; channels: 1 | 2; mirror: boolean }
  | { op: "link"; src: string };

interface Job {
  key: string;
  aliases: string[];
  label: string;
  idSrc: string;
  ext: string;
  kind: ConformedMedia["kind"];
  assetId: string | null;
  alpha: boolean;
  recipe: Recipe;
  /** Fixed output path (stems); otherwise media/<NNN_…> */
  fixedPath?: string;
}

interface ManifestEntry { sig: string; meta: Omit<ConformedMedia, "localPath" | "name"> }
interface Manifest { version: number; entries: Record<string, ManifestEntry> }

/** Placement of a w×h source covering W×H (identical to remotion lib/geometry coverRect). */
export function coverRect(w: number, h: number, crop: { x: number; y: number; w: number; h: number } | null, focal: { x: number; y: number }, BW = W, BH = H) {
  let k: number;
  let cx: number;
  let cy: number;
  if (crop && crop.w > 0 && crop.h > 0) {
    k = Math.max(BW / (crop.w * w), BH / (crop.h * h));
    cx = (crop.x + crop.w / 2) * w;
    cy = (crop.y + crop.h / 2) * h;
  } else {
    k = Math.max(BW / w, BH / h);
    cx = focal.x * w;
    cy = focal.y * h;
  }
  const width = w * k;
  const height = h * k;
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  return { left: clamp(BW / 2 - cx * k, BW - width, 0), top: clamp(BH / 2 - cy * k, BH - height, 0), width, height };
}

/** ffmpeg filter that reproduces coverRect: uniform scale then a 1920×1080 window. */
export function coverFilter(w: number, h: number, crop: { x: number; y: number; w: number; h: number } | null, focal: { x: number; y: number }): string {
  const r = coverRect(w, h, crop, focal);
  const sw = Math.max(W, Math.round(r.width));
  const sh = Math.max(H, Math.round(r.height));
  const x = Math.min(sw - W, Math.max(0, Math.round(-r.left)));
  const y = Math.min(sh - H, Math.max(0, Math.round(-r.top)));
  return `scale=${sw}:${sh}:flags=lanczos,crop=${W}:${H}:${x}:${y},setsar=1`;
}

/** Blur-pad (contain-blur layout): the source contained over a blurred, darkened cover of itself. */
export function blurPadFilter(w: number, h: number, crop: { x: number; y: number; w: number; h: number } | null): string {
  const pre = crop ? `crop=${Math.max(2, Math.round(crop.w * w))}:${Math.max(2, Math.round(crop.h * h))}:${Math.round(crop.x * w)}:${Math.round(crop.y * h)},` : "";
  return `${pre}split=2[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:4,eq=brightness=-0.3[bg];`
    + `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1`;
}

const hex = (c: string) => `0x${c.replace(/^#/, "").slice(0, 6).padEnd(6, "0")}`;

async function exists(p: string): Promise<boolean> {
  return stat(p).then(() => true, () => false);
}

async function linkOrCopy(src: string, dst: string): Promise<void> {
  await rm(dst, { force: true });
  try {
    await link(src, dst);
  } catch {
    await copyFile(src, dst);
  }
}

async function srcSig(p: string): Promise<string> {
  const s = await stat(p);
  return `${p}|${s.size}|${Math.round(s.mtimeMs)}`;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (i < items.length) {
      const x = items[i++]!;
      await fn(x);
    }
  });
  await Promise.all(workers);
}

/** Builds the deterministic list of conform jobs from the Timeline alone. */
export function planConform(t: Timeline, i: ConformInput): Job[] {
  const jobs: Job[] = [];
  const byKey = new Map<string, Job>();
  const assetPath = (a: TimelineAsset) => path.resolve(i.projectDir, a.projectRel);
  const add = (j: Job) => {
    const hit = byKey.get(j.key);
    if (hit) return hit;
    jobs.push(j);
    byKey.set(j.key, j);
    return j;
  };
  const aliased = new Set<string>();

  // V1 pictures
  for (const clip of t.video) {
    const s = clip.source;
    if (s.kind === "image" || s.kind === "video") {
      const a = t.assets[s.assetId];
      if (!a) continue;
      const fit = fitOf(clip);
      const key = pictureKey(clip);
      const j = add(s.kind === "image"
        ? { key, aliases: [], label: clip.name || a.id, idSrc: `${a.id}:${framingOf(s, fit)}`, ext: a.ext === "png" ? "png" : "jpg", kind: "image", assetId: a.id, alpha: false, recipe: { op: "still", src: assetPath(a), crop: s.crop, focal: s.focal, fit } }
        : { key, aliases: [], label: clip.name || a.id, idSrc: `${a.id}:${framingOf(s, fit)}`, ext: "mp4", kind: "video", assetId: a.id, alpha: false, recipe: { op: "video", src: assetPath(a), crop: s.crop, focal: s.focal, fps: t.fps } });
      if (!aliased.has(a.id)) {
        aliased.add(a.id);
        j.aliases.push(a.id);
      }
    } else {
      const still = i.generatedStills[clip.id];
      const recipe: Recipe = still ? { op: "gen-copy", src: still } : s.kind === "solid" ? { op: "solid", color: s.color } : { op: "gradient", colors: s.palette };
      add({ key: `gen:${clip.id}`, aliases: [], label: clip.name || (s.kind === "generated" ? s.recipe : "solid"), idSrc: clip.id, ext: "png", kind: "image", assetId: null, alpha: false, recipe });
    }
  }
  // overlays (M3 renders)
  for (const it of t.overlays) {
    const p = i.overlays?.[it.id];
    if (p) add({ key: overlayKey(it.id), aliases: [], label: it.component, idSrc: it.id, ext: path.extname(p).slice(1) || "mov", kind: "video", assetId: null, alpha: true, recipe: { op: "link", src: p } });
  }
  const audioJob = (a: TimelineAsset | undefined, channels: 1 | 2, label: string, mirror = false, key?: string) => {
    if (!a) return;
    add({ key: key ?? a.id, aliases: [], label, idSrc: mirror ? `${a.id}:rl` : a.id, ext: "wav", kind: "audio", assetId: a.id, alpha: false, recipe: { op: "wav", src: assetPath(a), channels, mirror } });
  };
  if (t.audio.vo.length) for (const v of t.audio.vo) audioJob(t.assets[v.assetId], 1, `vo-${v.segmentId}`);
  else audioJob(t.assets[t.audio.voProgram.assetId], 1, "vo-program");
  for (const m of t.audio.music) audioJob(t.assets[m.assetId], 2, `music-${m.mood}`);
  for (const c of t.audio.sfx) {
    if (c.panSweep === "RL") audioJob(t.assets[c.assetId], 2, `sfx-${c.category}-rl`, true, mirroredSfxKey(c.assetId));
    else audioJob(t.assets[c.assetId], 2, `sfx-${c.category}`);
  }
  for (const c of t.audio.clip) {
    const a = t.assets[c.assetId];
    if (a) add({ key: clipWavKey(a.id), aliases: [], label: `clip-audio-${c.segmentId}`, idSrc: `${a.id}:wav`, ext: "wav", kind: "audio", assetId: a.id, alpha: false, recipe: { op: "wav", src: assetPath(a), channels: 2, mirror: false } });
  }
  for (const s of STEM_NAMES) {
    const p = i.stems[s];
    if (p) add({ key: stemKey(s), aliases: [], label: `stem-${s}`, idSrc: s, ext: "wav", kind: "audio", assetId: null, alpha: false, recipe: { op: "wav", src: p, channels: 2, mirror: false }, fixedPath: path.join(i.exportDir, "stems", `${s}.wav`) });
  }
  return jobs;
}

async function probeImage(file: string, ctx: ExportCtx): Promise<{ w: number; h: number }> {
  const p = await ffprobeJson(file, { config: ctx.config, signal: ctx.signal });
  const v = p.streams.find((s) => s.codecType === "video");
  if (!v?.width || !v.height) throw new DocmakerError("EXPORT_FAILED", `cannot read the picture size of ${path.basename(file)}`);
  return { w: v.width, h: v.height };
}

async function runRecipe(j: Job, out: string, ctx: ExportCtx): Promise<void> {
  const r = j.recipe;
  const tmp = `${out}.tmp${path.extname(out)}`;
  const enc = (ext: string) => (ext === "jpg" ? ["-q:v", "2"] : []);
  const ff = (args: string[]) => ffmpeg(args, { config: ctx.config, signal: ctx.signal });
  try {
    switch (r.op) {
      case "still": {
        const { w, h } = await probeImage(r.src, ctx);
        if (r.fit === "blurpad") await ff(["-i", r.src, "-filter_complex", blurPadFilter(w, h, r.crop), "-frames:v", "1", "-update", "1", ...enc(j.ext), tmp]);
        else await ff(["-i", r.src, "-vf", coverFilter(w, h, r.crop, r.focal), "-frames:v", "1", "-update", "1", ...enc(j.ext), tmp]);
        break;
      }
      case "video": {
        const p = await ffprobeJson(r.src, { config: ctx.config, signal: ctx.signal });
        const v = p.streams.find((s) => s.codecType === "video");
        if (!v?.width || !v.height) throw new DocmakerError("EXPORT_FAILED", `no video stream in ${path.basename(r.src)}`);
        const sameFps = v.fps !== null && Math.abs(v.fps - r.fps) < 0.01;
        if (v.width === W && v.height === H && !r.crop && sameFps) {
          await linkOrCopy(r.src, out);
          return;
        }
        await ff(["-i", r.src, "-map", "0:v:0", "-map", "0:a:0?", "-vf", `${coverFilter(v.width, v.height, r.crop, r.focal)},fps=${r.fps}`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-g", String(r.fps), "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
          "-movflags", "+faststart", tmp]);
        break;
      }
      case "gen-copy": {
        const { w, h } = await probeImage(r.src, ctx);
        if (w === W && h === H && path.extname(r.src).toLowerCase() === ".png") {
          await linkOrCopy(r.src, out);
          return;
        }
        await ff(["-i", r.src, "-vf", coverFilter(w, h, null, { x: 0.5, y: 0.5 }), "-frames:v", "1", "-update", "1", tmp]);
        break;
      }
      case "solid":
        await ff(["-f", "lavfi", "-i", `color=c=${hex(r.color)}:s=${W}x${H}:d=1`, "-frames:v", "1", "-update", "1", tmp]);
        break;
      case "gradient": {
        const cs = r.colors.slice(0, 2).map(hex);
        const src = `gradients=s=${W}x${H}:c0=${cs[0]}:c1=${cs[1] ?? cs[0]}:x0=0:y0=0:x1=${W - 1}:y1=${H - 1}:nb_colors=2:speed=0.00001:d=1`;
        try {
          await ff(["-f", "lavfi", "-i", src, "-frames:v", "1", "-update", "1", tmp]);
        } catch (e) {
          if ((e as DocmakerError).code === "CANCELED") throw e;
          await ff(["-f", "lavfi", "-i", `color=c=${cs[0]}:s=${W}x${H}:d=1`, "-frames:v", "1", "-update", "1", tmp]);
        }
        break;
      }
      case "wav": {
        if (!r.mirror && path.extname(r.src).toLowerCase() === ".wav") {
          const hd = await readWavHeader(r.src).catch(() => null);
          if (hd && hd.sampleRate === 48000 && hd.format === "pcm" && hd.bitsPerSample === 16 && hd.channels === r.channels) {
            await linkOrCopy(r.src, out);
            return;
          }
        }
        const af = r.mirror ? ["-af", "pan=stereo|c0=c1|c1=c0"] : [];
        await ff(["-i", r.src, "-map", "0:a:0", "-vn", "-ac", String(r.channels), "-ar", "48000", ...af, "-c:a", "pcm_s16le", tmp]);
        break;
      }
      case "link":
        await linkOrCopy(r.src, out);
        return;
    }
    await rename(tmp, out);
  } finally {
    await rm(tmp, { force: true });
  }
}

async function metaOf(j: Job, out: string, fps: number, ctx: ExportCtx): Promise<ManifestEntry["meta"]> {
  const base = { assetId: j.assetId, kind: j.kind, alpha: j.alpha };
  if (j.kind === "audio") {
    const hd = await readWavHeader(out);
    return { ...base, width: null, height: null, durationFrames: Math.max(1, Math.round((hd.frames * fps) / hd.sampleRate)), hasVideo: false, hasAudio: true, audioChannels: hd.channels };
  }
  const p = await ffprobeJson(out, { config: ctx.config, signal: ctx.signal });
  const v = p.streams.find((s) => s.codecType === "video");
  const a = p.streams.find((s) => s.codecType === "audio");
  if (j.kind === "image") return { ...base, width: v?.width ?? W, height: v?.height ?? H, durationFrames: null, hasVideo: true, hasAudio: false, audioChannels: null };
  const dur = v?.durationSec ?? p.durationSec;
  return {
    ...base, width: v?.width ?? null, height: v?.height ?? null, durationFrames: dur ? Math.max(1, Math.floor(dur * fps + 1e-6)) : null,
    hasVideo: Boolean(v), hasAudio: Boolean(a), audioChannels: a?.channels ?? null,
  };
}

export async function conformForNle(t: Timeline, i: ConformInput, ctx: ExportCtx): Promise<ConformMap> {
  const mediaDir = path.join(i.exportDir, "media");
  await mkdir(mediaDir, { recursive: true });
  if (Object.keys(i.stems).length) await mkdir(path.join(i.exportDir, "stems"), { recursive: true });
  const manifestPath = path.join(mediaDir, MANIFEST);
  let manifest: Manifest = { version: MANIFEST_VERSION, entries: {} };
  try {
    const m = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
    if (m.version === MANIFEST_VERSION && m.entries) manifest = m;
  } catch { /* first export */ }

  const jobs = planConform(t, i);
  const outPath = (j: Job, n: number) => j.fixedPath ?? path.join(mediaDir, conformName(n, j.label, j.idSrc, j.ext));
  const planned = jobs.map((j, n) => ({ j, out: outPath(j, n + 1) }));
  const result: ConformMap = {};
  const next: Manifest = { version: MANIFEST_VERSION, entries: {} };

  await pool(planned, 2, async ({ j, out }) => {
    if (ctx.signal.aborted) throw new DocmakerError("CANCELED", "export canceled");
    try {
      const src = "src" in j.recipe ? j.recipe.src : null;
      if (src && !(await exists(src))) throw new DocmakerError("EXPORT_FAILED", `source file missing: ${src}`);
      const sig = JSON.stringify({ r: j.recipe, s: src ? await srcSig(src) : null });
      const name = path.basename(out);
      const cached = manifest.entries[path.relative(i.exportDir, out)];
      let meta: ManifestEntry["meta"];
      if (cached && cached.sig === sig && (await exists(out))) {
        meta = cached.meta;
      } else {
        await runRecipe(j, out, ctx);
        meta = await metaOf(j, out, t.fps, ctx);
      }
      next.entries[path.relative(i.exportDir, out)] = { sig, meta };
      const cm: ConformedMedia = { ...meta, localPath: out, name };
      result[j.key] = cm;
      for (const a of j.aliases) result[a] ??= cm;
    } catch (e) {
      if ((e as DocmakerError).code === "CANCELED" || ctx.signal.aborted) throw e;
      ctx.logger.warn(`export: could not conform ${j.key}: ${(e as Error).message}`, { key: j.key });
    }
  });

  // drop stale conformed files from earlier exports (only names this module writes)
  const keep = new Set(planned.map((p) => path.basename(p.out)));
  for (const f of await readdir(mediaDir).catch(() => [] as string[])) {
    if (keep.has(f) || f === MANIFEST) continue;
    if (/^\d{3,}_[a-z0-9-]+_[0-9a-f]{8}\.[a-z0-9]+$/.test(f) || /\.tmp\.[a-z0-9]+$/.test(f)) await rm(path.join(mediaDir, f), { force: true });
  }
  await writeFile(`${manifestPath}.tmp`, JSON.stringify(next, null, 1));
  await rename(`${manifestPath}.tmp`, manifestPath);
  return result;
}
