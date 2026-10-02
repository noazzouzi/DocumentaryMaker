// Safe-messaging end cards (§6.3 riskFlags: suicide_self_harm). Shown as a KineticText card over the last 5 s.
import type { Lang } from "@docmaker/core";

/** Lines of ≤ 48 chars (KineticTextProps), at most 4. */
export const SAFE_MESSAGING_CARD: Readonly<Record<Lang, readonly string[]>> = {
  en: [
    "If you are struggling, you can call",
    "or text 988 (US) or find a local",
    "helpline at findahelpline.com",
  ],
  fr: [
    "Si vous traversez une période difficile,",
    "appelez le 3114 (France) ou trouvez",
    "une ligne d'écoute sur findahelpline.com",
  ],
};

/** Full sentences (for markers / accessibility). */
export const SAFE_MESSAGING_TEXT: Readonly<Record<Lang, string>> = {
  en: "If you are struggling, you can call or text 988 (US) or find a local helpline at findahelpline.com",
  fr: "Si vous traversez une période difficile, appelez le 3114 (France) ou trouvez une ligne d'écoute sur findahelpline.com",
};

/** Localised SourceLabel texts (kinds → visible chip text). */
export const LABEL_TEXT: Readonly<Record<Lang, Readonly<Record<
  "illustration" | "reconstruction" | "synthetic-voice" | "scratch-voice" | "pickup-tts" | "translated", string>>>> = {
  en: {
    illustration: "Illustration (AI-generated)",
    reconstruction: "Reconstruction",
    "synthetic-voice": "AI-generated voice",
    "scratch-voice": "Scratch voice (draft)",
    "pickup-tts": "Pickup: synthetic voice",
    translated: "Translated",
  },
  fr: {
    illustration: "Illustration (générée par IA)",
    reconstruction: "Reconstitution",
    "synthetic-voice": "Voix générée par IA",
    "scratch-voice": "Voix provisoire (brouillon)",
    "pickup-tts": "Raccord : voix de synthèse",
    translated: "Traduction",
  },
};

export const CHAPTER_KICKER: Readonly<Record<Lang, string>> = { en: "CHAPTER", fr: "CHAPITRE" };
export const AD_BREAK_NAME: Readonly<Record<Lang, string>> = { en: "Ad break", fr: "Pause publicitaire" };
