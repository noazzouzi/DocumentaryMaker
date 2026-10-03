// GET ?name= → {ok, tier, message} (cheap authenticated call; ElevenLabs reports the tier)
import { handle, json } from "@/server/http";
import { getEngine } from "@/server/runtime";
import { secretNameParam } from "@/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const name = secretNameParam(new URL(req.url).searchParams.get("name"));
  return json(await (await getEngine()).testKey(name));
});
