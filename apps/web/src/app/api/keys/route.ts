// POST {name, value, consent:true} → 204: writes <home>/.env (0600) only after explicit consent. Values never echo back.
import { HttpError, handle, noContent, readJsonObject } from "@/server/http";
import { getEngine } from "@/server/runtime";
import { secretNameParam, secretValue } from "@/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  const body = await readJsonObject(req, 16 * 1024);
  if (body.consent !== true) throw new HttpError(400, "CONSENT_REQUIRED", "explicit consent is required to write ~/.documentarymaker/.env");
  await (await getEngine()).setSecret(secretNameParam(body.name), secretValue(body.value));
  return noContent();
});
