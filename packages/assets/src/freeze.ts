// freezeFile: conform result → cache blob → media/<id>.<ext> link → FrozenAsset (§7.5).
import { FrozenAsset } from "@docmaker/core";
import type { AssetKind, Candidate, MediaRole, UploadDeclaration } from "@docmaker/core";
import { sha256File } from "@docmaker/core/node";
import type { ConformResult } from "./conform";
import type { AssetsCtx } from "./types";
import { mimeOfExt, nowIso } from "./util";

export async function freezeFile(
  i: { file: string; kind: AssetKind; role: MediaRole; candidate: Candidate | null; declaration: UploadDeclaration | null; conform: ConformResult; projectDir: string; yearHint?: number | null },
  ctx: Pick<AssetsCtx, "cache" | "logger">,
): Promise<FrozenAsset> {
  const c = i.conform;
  const originalSha256 = await sha256File(i.file);
  const put = await ctx.cache.put(c.file, c.ext);
  const projectRel = await ctx.cache.linkIntoProject(put.sha256, c.ext, i.projectDir);
  const year = i.yearHint ?? c.analysis.year;
  return FrozenAsset.parse({
    id: put.sha256,
    originalSha256,
    kind: i.kind,
    role: i.role,
    mime: mimeOfExt(c.ext),
    ext: c.ext,
    bytes: put.bytes,
    width: c.width,
    height: c.height,
    durationMs: c.durationMs,
    fps: c.fps,
    hasAudio: c.hasAudio,
    lufs: c.lufs,
    cacheRel: put.cacheRel,
    projectRel,
    candidate: i.candidate,
    declaration: i.declaration,
    conform: { recipe: c.recipe, sourceInMs: c.sourceInMs, sourceOutMs: c.sourceOutMs, handleHeadMs: c.handleHeadMs, handleTailMs: c.handleTailMs },
    analysis: { ...c.analysis, year: year ?? null },
    frozenAt: nowIso(),
  });
}
