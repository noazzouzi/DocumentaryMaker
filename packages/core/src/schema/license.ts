import { z } from "zod";

export const LicenseCode = z.enum([
  "CC0", "PDM", "CC-BY", "CC-BY-SA", "CC-BY-NC", "CC-BY-ND", "CC-BY-NC-SA", "CC-BY-NC-ND",
  "PEXELS", "PIXABAY", "UNSPLASH", "AI-GENERATED", "YOUTUBE-FAIR-USE", "PROCEDURAL", "USER-OWNED", "UNKNOWN",
  "PROVIDER-TERMS", // TTS voices under a provider's terms (ElevenLabs) — see attributionText/restrictions
]);
export type LicenseCode = z.infer<typeof LicenseCode>;
export const LicenseRestriction = z.enum([
  "personality", "no-bad-light", "trademark", "no-redistribution", "editorial-only", "no-endorsement",
  "nc", "sa", "nd", "unknown-rights", "fair-use-user-risk", "synthetic", "may-be-manipulated",
]);
export type LicenseRestriction = z.infer<typeof LicenseRestriction>;
export const LicenseInfo = z.object({
  code: LicenseCode,
  version: z.string().nullable(),
  url: z.string().nullable(),
  commercialOk: z.boolean(),
  derivativesOk: z.boolean(),
  attributionRequired: z.boolean(),
  attributionText: z.string().nullable(), // ready-to-print credit line
  restrictions: z.array(LicenseRestriction),
});
export type LicenseInfo = z.infer<typeof LicenseInfo>;

/** Required for every user upload / local import. Imports are NEVER defaulted to USER-OWNED. */
export const UploadDeclaration = z.object({
  kind: z.enum(["own-work", "licensed", "third-party-quotation", "ai-generated"]),
  license: LicenseCode.nullable(), // "licensed": the licence code
  author: z.string(),
  url: z.string(), // "licensed"/"third-party-quotation": where it comes from
  note: z.string(),
});
export type UploadDeclaration = z.infer<typeof UploadDeclaration>;
