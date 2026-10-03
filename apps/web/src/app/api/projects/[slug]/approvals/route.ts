// POST {gate, stage, lang, planHash, note, items, itemNotes} → 204. `by` is always "web" (set here, never by the client);
// the engine validates per gate (factcheck-ack items ⊇ blocking items with notes ≥ 10 chars; editorial gates refuse flags).
import { handle, noContent, readJsonObject } from "@/server/http";
import { projectCtx, type SlugCtx } from "@/server/context";
import { approvalFrom } from "@/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request, ctx: SlugCtx) => {
  const { engine, slug } = await projectCtx(ctx.params);
  const { gate, a } = approvalFrom(await readJsonObject(req));
  await engine.approve(slug, gate, a);
  return noContent();
});
