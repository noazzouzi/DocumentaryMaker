// Optional SFX packs (§11.2, M2), imported from a local directory the engine prepared:
// - remotion-sfx-cc0: the CC0 subset of @remotion/sfx (downloaded by `docmaker setup --sfx remotion`; meme sounds excluded);
// - hyperframes-pixabay: a user-supplied copy of the HyperFrames starter pack with its manifest.json (never redistributed);
// - user: the user's own sounds, `<category>/<name>.<ext>` or `<category>-<n>.<ext>`, with a declared licence.
// Every file is decoded to 48 kHz stereo, normalised like the procedural pack and analysed (sync point, peak, loudness,
// baked pan direction) into <home>/sfx/<pack>/v1/manifest.json.
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DocmakerError, LicenseInfo, SfxCategory, SfxManifest, stableStringify } from "@docmaker/core";
import type { SfxEntry } from "@docmaker/core";
import { measureEbur128, readWav, sha256File, withFileLock, writeWav } from "@docmaker/core/node";
import { SR, checkAbort, loadAudio48k, samplePeak, toDb } from "../util";
import type { AudioCtx } from "../util";
import { applyGain, categoryEnergy, categoryMidPeakDb, syncPointMs, trimTrailingSilence } from "./analyze";
import { SFX_RECIPES } from "./recipes";

export type ImportablePack = "remotion-sfx-cc0" | "hyperframes-pixabay" | "user";
const AUDIO_EXT = [".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac"];
const LOOPABLE = new Set<SfxCategory>(["drone", "keys", "heartbeat", "ambience.room", "ambience.crowd"]);
const VERSION = "v1";

/** @remotion/sfx constants that are CC0 (the only ones imported). */
export const REMOTION_CC0_CATEGORY: Readonly<Record<string, SfxCategory>> = {
  whoosh: "whoosh.light", whip: "whoosh.whip", pageTurn: "paper", shutterOld: "shutter", shutterModern: "shutter", mouseClick: "click", ding: "ding",
};

/** HyperFrames starter-pack keys → categories (unknown keys are skipped with a warning). */
export const HYPERFRAMES_CATEGORY: Readonly<Record<string, SfxCategory>> = {
  chime: "ding", ping: "ding", sparkle: "ding", "click-soft": "click", click: "click", "key-press": "click", error: "glitch",
  "glitch-1": "glitch", "glitch-2": "glitch", "glitch-3": "glitch", "impact-bass-1": "impact", "impact-bass-2": "boom.low",
  notification: "notification", pop: "pop", riser: "riser", typing: "keys", "whoosh-cinematic": "whoosh.heavy", "whoosh-short": "whoosh.whip", whoosh: "whoosh.light",
};

export const PACK_LICENSES: Readonly<Record<"remotion-sfx-cc0" | "hyperframes-pixabay", LicenseInfo>> = {
  "remotion-sfx-cc0": {
    code: "CC0", version: "1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/", commercialOk: true, derivativesOk: true,
    attributionRequired: false, attributionText: null, restrictions: [],
  },
  "hyperframes-pixabay": {
    code: "PIXABAY", version: null, url: "https://pixabay.com/service/license-summary/", commercialOk: true, derivativesOk: true,
    attributionRequired: false, attributionText: "Sound effects from Pixabay (Pixabay Content License)", restrictions: ["no-redistribution"],
  },
};

/** Sync point of a category: the procedural recipe's when there is one, else onset. */
export function categorySyncPoint(c: SfxCategory): "peak" | "onset" | "end" {
  return SFX_RECIPES.find((r) => r.category === c)?.syncPoint ?? "onset";
}

/** Baked stereo sweep: right/left energy ratio rising (LR) or falling (RL) by ≥ 3 dB between the first and last third. */
export function detectDirection(data: readonly Float32Array[]): "LR" | "RL" | "none" {
  if (data.length < 2) return "none";
  const [L, R] = data as [Float32Array, Float32Array];
  const N = L.length;
  if (N < 300) return "none";
  const ratio = (a: number, b: number) => {
    let l = 1e-12, r = 1e-12;
    for (let i = a; i < b; i++) { l += L[i]! * L[i]!; r += R[i]! * R[i]!; }
    return 10 * Math.log10(r / l);
  };
  const d = ratio(Math.floor((2 * N) / 3), N) - ratio(0, Math.floor(N / 3));
  return d >= 3 ? "LR" : d <= -3 ? "RL" : "none";
}

interface Source { key: string; file: string; category: SfxCategory }

async function listAudio(dir: string): Promise<string[]> {
  const out: string[] = [];
  const ents = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listAudio(p)));
    else if (AUDIO_EXT.includes(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

async function sourcesFor(pack: ImportablePack, srcDir: string, ctx: AudioCtx): Promise<Source[]> {
  const out: Source[] = [];
  if (pack === "hyperframes-pixabay") {
    const mf = path.join(srcDir, "manifest.json");
    if (!existsSync(mf)) throw new DocmakerError("VALIDATION", `${srcDir}: manifest.json missing (expected the HyperFrames SFX folder)`);
    const m = JSON.parse(await readFile(mf, "utf8")) as Record<string, { file?: string }>;
    for (const key of Object.keys(m).sort()) {
      const category = HYPERFRAMES_CATEGORY[key];
      const file = m[key]?.file ? path.resolve(srcDir, m[key]!.file!) : null;
      if (!category) { ctx.logger.warn("SFX pack: unmapped sound skipped", { pack, key }); continue; }
      const rel = file ? path.relative(path.resolve(srcDir), file) : "";
      if (file && (rel === "" || rel.startsWith("..") || path.isAbsolute(rel))) { ctx.logger.warn("SFX pack: file outside the pack folder skipped", { pack, key }); continue; }
      if (!file || !existsSync(file)) { ctx.logger.warn("SFX pack: file missing", { pack, key }); continue; }
      out.push({ key, file, category });
    }
  } else if (pack === "remotion-sfx-cc0") {
    for (const file of await listAudio(srcDir)) {
      const key = path.basename(file, path.extname(file));
      const category = REMOTION_CC0_CATEGORY[key];
      if (category) out.push({ key, file, category });
      else ctx.logger.info("SFX pack: non-CC0 or unknown @remotion/sfx sound ignored", { key });
    }
  } else {
    for (const file of await listAudio(srcDir)) {
      const rel = path.relative(srcDir, file);
      const folder = rel.includes(path.sep) ? rel.split(path.sep)[0]! : null;
      const base = path.basename(file, path.extname(file));
      const fromFolder = folder ? SfxCategory.safeParse(folder) : null;
      const fromName = SfxCategory.safeParse(base.replace(/[-_ ]\d+$/, ""));
      const category = fromFolder?.success ? fromFolder.data : fromName.success ? fromName.data : null;
      if (category) out.push({ key: rel, file, category });
      else ctx.logger.warn("SFX pack: cannot tell the category; use <category>/<file> or <category>-<n>", { file: rel });
    }
  }
  return out;
}

async function userLicense(srcDir: string, given?: LicenseInfo): Promise<LicenseInfo> {
  if (given) return LicenseInfo.parse(given);
  const f = path.join(srcDir, "license.json");
  if (existsSync(f)) {
    const r = LicenseInfo.safeParse(JSON.parse(await readFile(f, "utf8")));
    if (r.success) return r.data;
  }
  throw new DocmakerError("VALIDATION", "user SFX need a declared licence (license.json in the folder or the licence option)", { hint: "never assumed USER-OWNED" });
}

/** Imports a pack from `srcDir` into <home>/sfx/<pack>/v1 (replacing a previous import) and returns its manifest. */
export async function importSfxPack(pack: ImportablePack, srcDir: string, ctx: AudioCtx, o?: { license?: LicenseInfo }): Promise<SfxManifest> {
  if (!existsSync(srcDir)) throw new DocmakerError("VALIDATION", `SFX folder not found: ${srcDir}`);
  const license = pack === "user" ? await userLicense(srcDir, o?.license) : PACK_LICENSES[pack];
  const sources = await sourcesFor(pack, srcDir, ctx);
  if (!sources.length) throw new DocmakerError("VALIDATION", `no importable sounds found in ${srcDir} for the ${pack} pack`);
  const finalDir = path.join(ctx.config.paths.sfx, pack, VERSION);
  return withFileLock(path.join(ctx.config.paths.locks, `sfx-${pack}.lock`), `audio.importSfxPack(${pack})`, async () => {
    const build = path.join(ctx.config.paths.sfx, pack, `.${VERSION}-build-${process.pid}`);
    await rm(build, { recursive: true, force: true });
    await mkdir(build, { recursive: true });
    try {
      const variants = new Map<SfxCategory, number>();
      const entries: SfxEntry[] = [];
      for (const [k, s] of sources.entries()) {
        checkAbort(ctx.signal, "SFX pack import");
        ctx.progress(k / sources.length, `importing ${s.key}`);
        let data: Float32Array[] = (await loadAudio48k(s.file, 2, ctx)).data.map((c) => c.slice());
        const loopable = LOOPABLE.has(s.category);
        if (!loopable) data = trimTrailingSilence(data);
        const durationMs = Math.round(((data[0]?.length ?? 0) * 1000) / SR);
        const pk = toDb(samplePeak(data));
        if (pk <= -144) { ctx.logger.warn("SFX pack: silent file skipped", { key: s.key }); continue; }
        // variants are numbered after the silent-file check: no gaps (impact/0, impact/1, …)
        const variant = variants.get(s.category) ?? 0;
        variants.set(s.category, variant + 1);
        const base = `${s.category}-${variant}`;
        const out = path.join(build, `${base}.wav`);
        let gainDb = categoryMidPeakDb(s.category) - pk;
        if (durationMs >= 400) {
          await writeWav(out, { sampleRate: SR, channels: 2, data }, "f32");
          const m = await measureEbur128(out, { config: ctx.config, signal: ctx.signal });
          if (Number.isFinite(m.integratedLufs) && m.integratedLufs > -70) gainDb = Math.min(-20 - m.integratedLufs, -1 - pk);
        }
        applyGain(data, Math.pow(10, gainDb / 20));
        await writeWav(out, { sampleRate: SR, channels: 2, data }, "s24");
        const final = (await readWav(out)).data;
        let lufs: number | null = null;
        if (durationMs >= 400) {
          const m = await measureEbur128(out, { config: ctx.config, signal: ctx.signal });
          lufs = Number.isFinite(m.integratedLufs) && m.integratedLufs > -70 ? Math.round(m.integratedLufs * 100) / 100 : null;
        }
        const sync = categorySyncPoint(s.category);
        entries.push({
          id: `${pack}:${s.category}/${variant}`, category: s.category, variant, pack, file: path.join(finalDir, `${base}.wav`),
          assetId: await sha256File(out), durationMs, syncPoint: sync, peakOffsetMs: syncPointMs(final, sync),
          peakDbfs: Math.round(toDb(samplePeak(final)) * 100) / 100, lufs, energy: categoryEnergy(s.category), loopable,
          direction: detectDirection(final), tags: [s.category, pack, s.key], license,
        });
      }
      entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const manifest = SfxManifest.parse({ schemaVersion: 1, pack, version: VERSION, generatedAt: new Date().toISOString(), entries });
      await writeFile(path.join(build, "manifest.json"), stableStringify(manifest));
      await rm(finalDir, { recursive: true, force: true });
      await rename(build, finalDir);
      ctx.progress(1, `${pack}: ${entries.length} sound(s)`);
      return manifest;
    } catch (e) {
      await rm(build, { recursive: true, force: true });
      throw e;
    }
  }, { signal: ctx.signal });
}
