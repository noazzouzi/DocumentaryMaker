// SFX packs on disk: <home>/sfx/<pack>/<version>/manifest.json. The procedural pack is generated on demand; optional packs
// (remotion-sfx-cc0, hyperframes-pixabay, user) are imported from a directory (import.ts) and only read here.
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { DocmakerError, SfxManifest } from "@docmaker/core";
import type { RuntimeConfig, SfxEntry } from "@docmaker/core";
import type { AudioCtx } from "../util";
import { PROCEDURAL_PACK, ensureProceduralPack } from "./generate";

export type SfxPackId = "procedural" | "remotion-sfx-cc0" | "hyperframes-pixabay" | "user";
export const OPTIONAL_PACKS: readonly SfxPackId[] = ["remotion-sfx-cc0", "hyperframes-pixabay", "user"];

/** Natural order of version directory names ("v2" < "v10"). */
function versionKey(v: string): number[] {
  return (v.match(/\d+/g) ?? ["0"]).map(Number);
}
function cmpVersion(a: string, b: string): number {
  const x = versionKey(a), y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The newest installed manifest of a pack, or null (never generates anything). */
export async function readInstalledManifest(config: RuntimeConfig, pack: string): Promise<SfxManifest | null> {
  const root = path.join(config.paths.sfx, pack);
  let names: string[];
  try {
    names = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name);
  } catch {
    return null;
  }
  for (const v of names.sort(cmpVersion).reverse()) {
    const file = path.join(root, v, "manifest.json");
    if (!existsSync(file)) continue;
    try {
      return SfxManifest.parse(JSON.parse(await readFile(file, "utf8")));
    } catch {
      continue; // a corrupt manifest is skipped; an older version may still be valid
    }
  }
  return null;
}

/** Every installed entry of every pack (no generation), keyed by id — used by the mixer for sync offsets and direction. */
export async function installedEntriesById(config: RuntimeConfig): Promise<Map<string, SfxEntry>> {
  const out = new Map<string, SfxEntry>();
  let packs: string[] = [];
  try {
    packs = (await readdir(config.paths.sfx, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return out;
  }
  for (const p of packs) {
    const m = await readInstalledManifest(config, p);
    for (const e of m?.entries ?? []) out.set(e.id, e);
  }
  return out;
}

export async function ensureSfxPackImpl(pack: SfxPackId, ctx: AudioCtx): Promise<SfxManifest> {
  if (pack === PROCEDURAL_PACK) return ensureProceduralPack(ctx);
  const m = await readInstalledManifest(ctx.config, pack);
  if (m) return m;
  throw new DocmakerError("UPSTREAM_MISSING", `the SFX pack "${pack}" is not installed`, {
    hint: pack === "remotion-sfx-cc0" ? "run `docmaker setup --sfx remotion`" : `import it from a directory (docmaker setup --sfx ${pack} <dir>)`,
  });
}

/** Merged entries of the requested packs, sorted by id. Missing optional packs are skipped with a warning. */
export async function loadSfxEntriesImpl(packs: readonly string[], ctx: AudioCtx): Promise<SfxEntry[]> {
  const seen = new Map<string, SfxEntry>();
  for (const pack of [...new Set(packs)]) {
    let m: SfxManifest | null;
    if (pack === PROCEDURAL_PACK) m = await ensureProceduralPack(ctx);
    else m = await readInstalledManifest(ctx.config, pack);
    if (!m) {
      ctx.logger.warn("SFX pack not installed; skipped", { pack });
      continue;
    }
    for (const e of m.entries) {
      if (!existsSync(e.file)) {
        ctx.logger.warn("SFX file missing; entry skipped", { id: e.id, file: e.file });
        continue;
      }
      seen.set(e.id, e);
    }
  }
  return [...seen.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
