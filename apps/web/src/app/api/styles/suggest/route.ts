// POST {idea, useLlm} → StyleSuggestion (offline ranking always; the LLM only when asked and a key is set)
import { handle, json, readJsonObject } from "@/server/http";
import { getEngine } from "@/server/runtime";
import { str } from "@/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  const body = await readJsonObject(req);
  const idea = str(body.idea, "idea", { min: 3, max: 500 });
  return json(await (await getEngine()).suggestStyleForIdea(idea, { useLlm: body.useLlm === true }));
});
