// packages/core/src/util/project-defaults.ts — defaultProject (§4.2 table, normative) and slugify. Isomorphic.
import type { Lang } from "../schema/common";
import {
  ExportFormat, LicensePolicy, NewProjectInput, Project, VoiceSettings, type AssetProviderId,
} from "../schema/project";
import { fnv1a32 } from "./rng";

/** NFKD, ascii, lowercase, [a-z0-9-], ≤ 48 chars. */
export function slugify(s: string): string {
  const ascii = s
    .replace(/œ/g, "oe").replace(/Œ/g, "OE").replace(/æ/g, "ae").replace(/Æ/g, "AE").replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii.slice(0, 48).replace(/-+$/g, "");
}

const DEFAULT_PROVIDERS: AssetProviderId[] = [
  "local", "wikimedia", "openverse", "internet-archive", "nasa", "loc", "pexels", "pixabay", "youtube", "brave", "fal", "procedural",
];
const DEFAULT_FORMATS: ExportFormat[] = [
  "fcpxml", "xmeml-premiere", "otio", "markers-edl", "srt", "stems", "publish-kit", "editorial-report", "reference-mp4",
];

function voiceFor(lang: Lang, d: { hasElevenLabs: boolean; kokoro: boolean; piper: boolean }): VoiceSettings {
  if (d.hasElevenLabs) return VoiceSettings.parse({ provider: "elevenlabs", voiceId: "auto", modelId: "eleven_multilingual_v2" });
  if (d.kokoro) return VoiceSettings.parse({ provider: "kokoro", voiceId: lang === "fr" ? "30" : "16" });
  if (d.piper) return VoiceSettings.parse({ provider: "piper", voiceId: lang === "fr" ? "fr_FR-gilles-low" : "en_US-john-medium" });
  return VoiceSettings.parse({ provider: "synthetic", voiceId: "synthetic-m1" });
}

function envAutoApprove(): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const raw = env?.DOCMAKER_AUTO_APPROVE_USD;
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function defaultProject(
  input: NewProjectInput, now: Date,
  detected: { hasElevenLabs: boolean; kokoro: boolean; piper: boolean; homeDefaults: { languages: Lang[]; targetMinutes: number } | null },
): Project {
  const parsed = NewProjectInput.parse(input);
  const languages: Lang[] = input.languages !== undefined ? parsed.languages : detected.homeDefaults?.languages ?? ["en"];
  const targetMinutes = input.targetMinutes !== undefined ? parsed.targetMinutes : detected.homeDefaults?.targetMinutes ?? 20;
  const slug = parsed.slug ?? (slugify(parsed.idea) || "project");
  const iso = now.toISOString();
  const voice: Partial<Record<Lang, VoiceSettings>> = {};
  for (const l of languages) voice[l] = voiceFor(l, detected);
  return Project.parse({
    schemaVersion: 1,
    formatVersion: 1,
    slug,
    title: [...parsed.idea].slice(0, 80).join(""),
    idea: parsed.idea,
    createdAt: iso,
    updatedAt: iso,
    languages,
    primaryLang: parsed.primaryLang ?? languages[0],
    targetMinutes,
    styleId: parsed.styleId,
    styleConfirmed: parsed.styleId !== null,
    themeOverride: null,
    seed: parsed.seed ?? fnv1a32(slug),
    video: { fps: 30, width: 1920, height: 1080 },
    llm: { provider: parsed.llm, model: "claude-opus-5-5", fixtureId: parsed.fixtureId, refusalFallback: true, useBatchForRerank: false },
    voice,
    assets: {
      providers: DEFAULT_PROVIDERS, offline: false, licensePolicy: LicensePolicy.parse({}), maxCandidatesPerBeat: 24, useClip: false,
      visionRerank: "selective", maxClipSeconds: 20, clipFallback: "narrated", keepSourceDownloads: false,
    },
    audio: { music: "procedural", musicLibraryDir: null, sfxPacks: ["procedural"], targetLufs: -14, truePeakTarget: -1.5, truePeakGate: -1.0 },
    captions: "burn", // drama-commentary captionDNA.defaultMode; the engine may re-apply the chosen style's default
    captionsVariant: null,
    render: { defaultPreset: "draft", gl: "auto", concurrency: null, chunkSeconds: 60 },
    export: { formats: DEFAULT_FORMATS, fcpxmlVersion: "1.10", exportRoot: null, overlays: false },
    editorial: { asOf: iso.slice(0, 10), monetized: true, fairUseAcknowledged: false },
    publish: {},
    budget: { maxUsdPerStage: 25, maxUsdTotal: 40, autoApproveUnderUsd: envAutoApprove() },
  });
}
