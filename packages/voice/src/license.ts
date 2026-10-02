// Voice licences (§8.9) and the curated local voice catalogues (§8.3: never ryan/hfc/l2arctic/semaine/lessac).
import type { Lang, LicenseInfo, VoiceProviderId } from "@docmaker/core";
import { SYNTHETIC_LICENSE } from "./providers/synthetic";

const lic = (o: Partial<LicenseInfo> & Pick<LicenseInfo, "code">): LicenseInfo => ({
  version: null, url: null, commercialOk: true, derivativesOk: true, attributionRequired: false, attributionText: null, restrictions: [], ...o,
});

export const USER_OWNED_VOICE: LicenseInfo = lic({ code: "USER-OWNED", attributionText: null });

const APACHE_KOKORO = (name: string) => lic({
  code: "PROVIDER-TERMS", version: "Apache-2.0", url: "https://huggingface.co/hexgrad/Kokoro-82M",
  attributionText: `Voice: Kokoro-82M ${name} (Apache-2.0)`, restrictions: ["synthetic"],
});

export interface CatalogVoice {
  id: string; name: string; lang: Lang; gender: "male" | "female"; license: LicenseInfo; isDefault: boolean;
  /** kokoro: speaker id; piper: speaker id inside a multi-speaker model */
  sid: number;
}

export const KOKORO_VOICES: readonly CatalogVoice[] = [
  { id: "16", name: "am_michael", lang: "en", gender: "male", license: APACHE_KOKORO("am_michael"), isDefault: true, sid: 16 },
  { id: "3", name: "af_heart", lang: "en", gender: "female", license: APACHE_KOKORO("af_heart"), isDefault: false, sid: 3 },
  { id: "26", name: "bm_george", lang: "en", gender: "male", license: APACHE_KOKORO("bm_george"), isDefault: false, sid: 26 },
  // ff_siwis was trained on the SIWIS database (CC BY 4.0): credited conservatively
  {
    id: "30", name: "ff_siwis", lang: "fr", gender: "female", isDefault: true, sid: 30,
    license: lic({
      code: "CC-BY", version: "4.0", url: "https://creativecommons.org/licenses/by/4.0/", attributionRequired: true,
      attributionText: "Voice: Kokoro-82M ff_siwis (Apache-2.0), trained on the SIWIS French Speech Synthesis Database (CC BY 4.0)",
      restrictions: ["synthetic"],
    }),
  },
];

const piperLic = (voice: string, code: LicenseInfo["code"], dataset: string): LicenseInfo => {
  const by = code === "CC-BY" || code === "CC-BY-SA";
  return lic({
    code, version: by ? "4.0" : null,
    url: code === "CC-BY" ? "https://creativecommons.org/licenses/by/4.0/" : code === "CC-BY-SA" ? "https://creativecommons.org/licenses/by-sa/4.0/" : code === "CC0" ? "https://creativecommons.org/publicdomain/zero/1.0/" : null,
    attributionRequired: by,
    attributionText: by ? `Voice: Piper ${voice} — ${dataset} (${code === "CC-BY" ? "CC BY 4.0" : "CC BY-SA 4.0"})` : null,
    restrictions: code === "CC-BY-SA" ? ["sa", "synthetic"] : ["synthetic"],
  });
};

export const PIPER_VOICES: readonly CatalogVoice[] = [
  { id: "fr_FR-gilles-low", name: "Gilles", lang: "fr", gender: "male", license: piperLic("fr_FR-gilles-low", "CC0", "Gilles"), isDefault: true, sid: 0 },
  { id: "fr_FR-siwis-medium", name: "SIWIS", lang: "fr", gender: "female", license: piperLic("fr_FR-siwis-medium", "CC-BY", "SIWIS French Speech Synthesis Database"), isDefault: false, sid: 0 },
  { id: "fr_FR-upmc-medium", name: "UPMC (Pierre)", lang: "fr", gender: "male", license: piperLic("fr_FR-upmc-medium", "CC-BY-SA", "UPMC corpus"), isDefault: false, sid: 1 },
  { id: "en_US-john-medium", name: "John", lang: "en", gender: "male", license: piperLic("en_US-john-medium", "PDM", "public domain"), isDefault: true, sid: 0 },
  { id: "en_US-joe-medium", name: "Joe", lang: "en", gender: "male", license: piperLic("en_US-joe-medium", "CC0", "Joe"), isDefault: false, sid: 0 },
  { id: "en_GB-cori-high", name: "Cori", lang: "en", gender: "female", license: piperLic("en_GB-cori-high", "PDM", "public domain"), isDefault: false, sid: 0 },
];

/** Non-commercial / research-only datasets: never offered, refused when requested. */
export const PIPER_DENYLIST = /(^en_US-ryan-|hfc_|l2arctic|semaine|lessac)/i;
/** Offered only with a warning (dataset licence incompatible with closed redistribution). */
export const PIPER_FLAGGED = /^fr_FR-tom-/i;

export const ELEVENLABS_TERMS_URL = "https://elevenlabs.io/terms-of-use";

/** Licence of a voice; tier = ElevenLabs subscription tier ("free" → non-commercial + attribution). */
export function voiceLicense(provider: VoiceProviderId, voiceId: string, tier: string | null): LicenseInfo {
  switch (provider) {
    case "synthetic":
      return SYNTHETIC_LICENSE;
    case "recording":
      return USER_OWNED_VOICE;
    case "kokoro":
      return KOKORO_VOICES.find((v) => v.id === voiceId || v.name === voiceId)?.license ?? APACHE_KOKORO(`speaker ${voiceId}`);
    case "piper": {
      const v = PIPER_VOICES.find((x) => x.id === voiceId);
      if (v) return v.license;
      if (PIPER_DENYLIST.test(voiceId)) {
        return lic({ code: "CC-BY-NC-SA", version: "4.0", commercialOk: false, attributionRequired: true, attributionText: `Voice: Piper ${voiceId} (non-commercial dataset)`, restrictions: ["nc", "sa", "synthetic"] });
      }
      return lic({ code: "UNKNOWN", commercialOk: false, attributionRequired: true, attributionText: `Voice: Piper ${voiceId}`, restrictions: ["unknown-rights", "synthetic"] });
    }
    case "elevenlabs": {
      const free = (tier ?? "").toLowerCase() === "free";
      return lic({
        code: "PROVIDER-TERMS", url: ELEVENLABS_TERMS_URL, commercialOk: !free, attributionRequired: free,
        attributionText: free ? "Voice generated with ElevenLabs (elevenlabs.io) — free plan, non-commercial use" : null,
        restrictions: free ? ["nc", "synthetic"] : ["synthetic"],
      });
    }
  }
}
