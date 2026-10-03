// GET ?provider=&lang= → VoiceInfo[]. The Engine contract has no voice listing (docs/ISSUES.md): an engine exposing the
// additive `listVoices(provider, lang)` is used; otherwise an empty list with `X-Docmaker-Degraded` (the UI then takes
// a free-text voice id).
import { handle, json, optionalLang } from "@/server/http";
import { getEngine } from "@/server/runtime";
import { enumOf } from "@/server/validate";
import { VoiceProviderId, type Lang, type VoiceInfo, type VoiceProviderId as ProviderT } from "@docmaker/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WithVoices = { listVoices?: (provider: ProviderT, lang: Lang | null) => Promise<VoiceInfo[]> };

export const GET = handle(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const provider = enumOf(VoiceProviderId, q.get("provider") ?? "synthetic", "provider");
  const lang = optionalLang(q.get("lang"));
  const engine = (await getEngine()) as unknown as WithVoices;
  if (typeof engine.listVoices !== "function") return json([], { headers: { "X-Docmaker-Degraded": "voices-unavailable" } });
  return json(await engine.listVoices(provider, lang));
});
