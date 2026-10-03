// GET ?beat=&q=&kind=&providers=&allowPaid= → CandidateRecord[] (records cached server-side for freeze)
import { handle, json } from "@/server/http";
import { projectCtx, type SlugCtx } from "@/server/context";
import { liveSearchFrom } from "@/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, ctx: SlugCtx) => {
  const { engine, slug } = await projectCtx(ctx.params);
  const s = liveSearchFrom(new URL(req.url).searchParams);
  const records = await engine.liveSearch(slug, { beatId: s.beatId, query: { text: s.text, kind: s.kind }, providers: s.providers, allowPaid: s.allowPaid });
  return json(records);
});
