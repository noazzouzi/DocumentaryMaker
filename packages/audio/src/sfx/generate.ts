// ensureSfxPack("procedural"): renders every recipe variant once into <home>/sfx/procedural/v1 under a machine lock.
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DocmakerError, SfxManifest, sha256Hex, stableStringify } from "@docmaker/core";
import type { LicenseInfo, SfxEntry } from "@docmaker/core";
import { ffmpeg, measureEbur128, readWav, sha256File, withFileLock, writeWav } from "@docmaker/core/node";
import { SR, checkAbort, samplePeak, toDb } from "../util";
import type { AudioCtx } from "../util";
import { applyGain, categoryEnergy, categoryMidPeakDb, foldLoop, syncPointMs, trimTrailingSilence } from "./analyze";
import { SFX_RECIPES, renderedDurationSec } from "./recipes";
import type { SfxRecipe } from "./recipes";

export const PROCEDURAL_PACK = "procedural";
export const PROCEDURAL_VERSION = "v1";
/** Bump when the generator (not the recipes) changes in a way that alters the files. */
const GENERATOR_REVISION = 1;
const LONG_MS = 400;
const LONG_TARGET_LUFS = -20;
const LONG_PEAK_CEILING_DBFS = -1;

export const PROCEDURAL_LICENSE: LicenseInfo = {
  code: "PROCEDURAL", version: null, url: null, commercialOk: true, derivativesOk: true, attributionRequired: false,
  attributionText: null, restrictions: [],
};

export function proceduralDir(ctx: Pick<AudioCtx, "config">): string {
  return path.join(ctx.config.paths.sfx, PROCEDURAL_PACK, PROCEDURAL_VERSION);
}

/** Hash of everything that determines the rendered files (recipe arguments, generator revision). */
export function recipesStamp(recipes: readonly SfxRecipe[] = SFX_RECIPES): string {
  const parts = recipes.flatMap((r) => r.variants.map((v) => ({
    c: r.category, v: v.variant, d: v.durationSec, s: v.seed, sync: r.syncPoint, loop: r.loop ?? null, norm: r.norm ?? "auto",
    args: r.args({ durationSec: renderDurationSec(r, v.durationSec), seed: v.seed, sampleRate: SR }),
  })));
  return sha256Hex(stableStringify({ rev: GENERATOR_REVISION, parts }, 0));
}

function renderDurationSec(r: SfxRecipe, durationSec: number): number {
  return r.loop && "xfadeSec" in r.loop ? durationSec + r.loop.xfadeSec : durationSec;
}

async function readValidManifest(dir: string, stamp: string): Promise<SfxManifest | null> {
  try {
    const st = JSON.parse(await readFile(path.join(dir, "stamp.json"), "utf8")) as { stamp?: string };
    if (st.stamp !== stamp) return null;
    const m = SfxManifest.parse(JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")));
    if (!m.entries.every((e) => existsSync(e.file))) return null;
    return m;
  } catch {
    return null;
  }
}

/** Renders one variant into `outFile` (s24 stereo 48 kHz) and returns its manifest entry. */
async function renderVariant(r: SfxRecipe, v: SfxRecipe["variants"][number], buildDir: string, finalDir: string, ctx: AudioCtx): Promise<SfxEntry> {
  const base = `${r.category}-${v.variant}`;
  const raw = path.join(buildDir, `.${base}.raw.wav`);
  await ffmpeg([...r.args({ durationSec: renderDurationSec(r, v.durationSec), seed: v.seed, sampleRate: SR }), "-map", "[out]", "-ar", String(SR), "-ac", "2", "-c:a", "pcm_f32le", raw], { config: ctx.config, signal: ctx.signal });
  let data = (await readWav(raw)).data;
  if (data.length === 1) data = [data[0]!, data[0]!.slice()];
  if (r.loop && "xfadeSec" in r.loop) {
    data = foldLoop(data, Math.round(v.durationSec * SR), r.loop.law);
  } else if (r.loop) {
    const len = Math.round(renderedDurationSec(r, v) * SR);
    data = data.map((c) => (c.length > len ? c.slice(0, len) : c));
  } else {
    data = trimTrailingSilence(data);
  }
  const frames = data[0]!.length;
  if (frames === 0) throw new DocmakerError("INTERNAL", `procedural SFX ${base} rendered no audio`);
  const durationMs = Math.round((frames * 1000) / SR);
  const peakDb = toDb(samplePeak(data));

  // normalisation (linear gain, envelope untouched)
  let gainDb: number;
  if (r.norm && r.norm !== "auto") {
    gainDb = r.norm.peakDbfs - peakDb;
  } else if (durationMs >= LONG_MS) {
    await writeWav(raw, { sampleRate: SR, channels: 2, data }, "f32");
    const m = await measureEbur128(raw, { config: ctx.config, signal: ctx.signal });
    gainDb = Number.isFinite(m.integratedLufs) && m.integratedLufs > -70 ? LONG_TARGET_LUFS - m.integratedLufs : categoryMidPeakDb(r.category) - peakDb;
    gainDb = Math.min(gainDb, LONG_PEAK_CEILING_DBFS - peakDb);
  } else {
    gainDb = categoryMidPeakDb(r.category) - peakDb;
  }
  applyGain(data, Math.pow(10, gainDb / 20));
  const file = path.join(buildDir, `${base}.wav`);
  await writeWav(file, { sampleRate: SR, channels: 2, data }, "s24");
  await rm(raw, { force: true });

  const final = await readWav(file); // analyse what was written (s24-quantised)
  let lufs: number | null = null;
  if (durationMs >= LONG_MS) {
    const m = await measureEbur128(file, { config: ctx.config, signal: ctx.signal });
    lufs = Number.isFinite(m.integratedLufs) && m.integratedLufs > -70 ? round2(m.integratedLufs) : null;
  }
  // Swelling noise sweeps: the designed envelope peak is exact while any measurement of noise jitters by ~±10 ms, so the
  // analytic value is used once the analyser (two-slope fit) confirms it; a disagreement > 25 ms is a recipe bug.
  const measured = syncPointMs(final.data, r.syncPoint);
  let peakOffsetMs = measured;
  if (r.syncPoint === "peak" && r.analyticPeakMs) {
    const analytic = Math.round(r.analyticPeakMs(v.durationSec));
    if (Math.abs(analytic - measured) > 25) throw new DocmakerError("INTERNAL", `procedural SFX ${base}: measured peak ${measured} ms vs designed ${analytic} ms`);
    peakOffsetMs = analytic;
  }
  return {
    id: `${PROCEDURAL_PACK}:${r.category}/${v.variant}`, category: r.category, variant: v.variant, pack: PROCEDURAL_PACK,
    file: path.join(finalDir, `${base}.wav`), assetId: await sha256File(file), durationMs, syncPoint: r.syncPoint,
    peakOffsetMs, peakDbfs: round2(toDb(samplePeak(final.data))), lufs,
    energy: r.energy ?? categoryEnergy(r.category), loopable: r.loopable, direction: r.direction ?? "none",
    tags: [r.category, ...(r.tags ?? []), ...(r.loopable ? ["loop"] : [])], license: PROCEDURAL_LICENSE,
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Bounded-concurrency map preserving order. */
async function mapPool<T, R>(items: readonly T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Generates (once) and returns the procedural pack manifest. Concurrent callers wait on the machine lock. */
export async function ensureProceduralPack(ctx: AudioCtx, recipes: readonly SfxRecipe[] = SFX_RECIPES): Promise<SfxManifest> {
  const dir = proceduralDir(ctx);
  const stamp = recipesStamp(recipes);
  const ready = await readValidManifest(dir, stamp);
  if (ready) return ready;
  const lock = path.join(ctx.config.paths.locks, "sfx-procedural.lock");
  return withFileLock(lock, "audio.ensureSfxPack(procedural)", async () => {
    const again = await readValidManifest(dir, stamp);
    if (again) return again;
    const parent = path.dirname(dir);
    const build = path.join(parent, `.${PROCEDURAL_VERSION}-build-${process.pid}`);
    await rm(build, { recursive: true, force: true });
    await mkdir(build, { recursive: true });
    try {
      const jobs = recipes.flatMap((r) => r.variants.map((v) => ({ r, v })));
      let done = 0;
      ctx.progress(0, "generating the procedural SFX pack");
      const entries = await mapPool(jobs, 2, async ({ r, v }) => {
        checkAbort(ctx.signal, "SFX pack generation");
        const e = await renderVariant(r, v, build, dir, ctx);
        ctx.progress(++done / jobs.length, `SFX ${e.id}`);
        return e;
      });
      entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const manifest = SfxManifest.parse({ schemaVersion: 1, pack: PROCEDURAL_PACK, version: PROCEDURAL_VERSION, generatedAt: new Date().toISOString(), entries });
      await writeFile(path.join(build, "manifest.json"), stableStringify(manifest));
      await writeFile(path.join(build, "stamp.json"), stableStringify({ stamp, generator: GENERATOR_REVISION }));
      await rm(dir, { recursive: true, force: true });
      await rename(build, dir);
      ctx.logger.info("procedural SFX pack generated", { dir, entries: entries.length });
      return manifest;
    } catch (e) {
      await rm(build, { recursive: true, force: true });
      throw e;
    }
  }, { signal: ctx.signal, onWait: () => ctx.logger.info("waiting for another process generating the SFX pack") });
}
