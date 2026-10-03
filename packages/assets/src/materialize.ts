// Candidate → original bytes → conform → frozen asset (shared by the stage, scene-board freeze and live search).
import { DocmakerError } from "@docmaker/core";
import type { AssetProvider, Candidate, FrozenAsset, MediaRole, ProviderContext, UploadDeclaration } from "@docmaker/core";
import { ffprobeJson } from "@docmaker/core/node";
import { conformImageWith, conformVideoWith, DEFAULT_HANDLE_MS } from "./conform";
import { freezeFile } from "./freeze";
import type { AssetsCtx } from "./types";
import { makeTmpDir, rmrf } from "./util";

/** Year carried by provider raw payloads ({year} is set by every provider parser). */
export function yearOfRaw(raw: unknown): number | null {
  const y = (raw as { year?: unknown } | null)?.year;
  return typeof y === "number" && Number.isInteger(y) && y > 1000 && y < 2200 ? y : null;
}

/** Wanted range inside a source video for a beat of `beatMs`: skip the first second (fades, logos), keep ≤ 30 s. */
export function videoWindow(durationMs: number, beatMs: number, procedural: boolean): { inMs: number; outMs: number } {
  const d = Math.max(0, durationMs);
  if (procedural) return { inMs: Math.min(DEFAULT_HANDLE_MS, d / 4), outMs: Math.max(d / 2, d - DEFAULT_HANDLE_MS) };
  const lead = Math.min(DEFAULT_HANDLE_MS, d * 0.1);
  const want = Math.min(30_000, Math.max(beatMs * 1.5, 6000));
  const outMs = Math.min(d - lead, lead + want);
  return { inMs: lead, outMs: Math.max(lead, outMs) };
}

export function providerContext(ctx: AssetsCtx): ProviderContext {
  return { secrets: ctx.secrets, config: ctx.config, logger: ctx.logger, http: ctx.http, signal: ctx.signal };
}

export async function materializeCandidate(
  i: { provider: AssetProvider; candidate: Candidate; raw: unknown; role: MediaRole; projectDir: string; fps: number; beatSec: number; declaration: UploadDeclaration | null },
  ctx: AssetsCtx,
): Promise<FrozenAsset> {
  const c = i.candidate;
  if (c.kind === "audio") throw new DocmakerError("VALIDATION", "audio candidates are frozen through the music/SFX paths");
  const tmp = await makeTmpDir("freeze");
  try {
    const orig = await i.provider.fetchOriginal(c, tmp, providerContext(ctx));
    const procedural = c.provider === "procedural";
    let conform;
    if (c.kind === "image") {
      conform = await conformImageWith(orig.path, tmp, ctx, { recipe: procedural ? "proc-image-v1" : "image-v1" });
    } else {
      const probe = await ffprobeJson(orig.path, { config: ctx.config, signal: ctx.signal });
      const w = videoWindow(probe.durationSec * 1000, i.beatSec * 1000, procedural);
      conform = await conformVideoWith(orig.path, tmp, { fps: i.fps, inMs: Math.round(w.inMs), outMs: Math.round(w.outMs), handleMs: DEFAULT_HANDLE_MS, recipe: procedural ? "proc-video-v1" : "video-cfr-v1" }, ctx);
    }
    return await freezeFile({
      file: orig.path, kind: c.kind, role: procedural ? "generated" : i.role, candidate: c, declaration: i.declaration, conform,
      projectDir: i.projectDir, yearHint: yearOfRaw(i.raw),
    }, ctx);
  } finally {
    await rmrf(tmp);
  }
}
