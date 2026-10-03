// GET → HomeConfig · PATCH patch (the Remotion licence choice is timestamped server-side)
import { handle, json, readJsonObject } from "@/server/http";
import { getEngine } from "@/server/runtime";
import { homePatchFrom } from "@/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => json(await (await getEngine()).homeConfig()));

export const PATCH = handle(async (req: Request) => {
  const patch = homePatchFrom(await readJsonObject(req));
  return json(await (await getEngine()).setHomeConfig(patch));
});
