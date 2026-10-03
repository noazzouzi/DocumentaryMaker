// GET → CandidatesDoc of a beat (additive, read-only: the asset picker's "stored candidates"); 404 when none.
import { HttpError, handle, json } from "@/server/http";
import { projectCtx } from "@/server/context";
import { CandidatesDoc, P } from "@docmaker/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; beatId: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const p = await ctx.params;
  const { engine, slug } = await projectCtx(Promise.resolve(p));
  if (!/^CH\d{1,2}-(B\d{3}|S\d{2,3}-(CLIP|BR))$/.test(p.beatId)) throw new HttpError(400, "VALIDATION", "invalid beat id");
  const { value } = await engine.readDoc(slug, P.candidates(p.beatId), CandidatesDoc);
  // the provider payload (`raw`) stays server-side
  return json({ ...value, records: value.records.map((r) => ({ candidate: r.candidate, score: r.score })) });
});
