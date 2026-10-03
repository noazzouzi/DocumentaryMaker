// runDemo (§15.2): fixture project (fixture LLM, confirmed style, offline assets, chosen TTS, burned captions) → one
// pipeline job research → qa with onlyChapters; fixture gates auto-approve (autoApproveGates) → final.mp4 + export dir.
import {
  DocmakerError, P, VoiceSettings, type Lang, type Project, type RenderPresetId,
} from "@docmaker/core";
import type { DemoOptions } from "./types";
import type { Runtime } from "./runtime";
import { createProjectIn, detectModels } from "./project";

const pad = (n: number) => String(n).padStart(2, "0");
export function demoSlug(fixture: string, d = new Date()): string {
  return `demo-${fixture}-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/** auto → kokoro / piper when a model is installed, else synthetic (free, no model). */
export function demoVoice(tts: DemoOptions["tts"], lang: Lang, modelsDir: string): VoiceSettings {
  const m = detectModels(modelsDir);
  const pick = tts === "auto" ? (m.kokoro ? "kokoro" : m.piper ? "piper" : "synthetic") : tts;
  if (pick === "kokoro") return VoiceSettings.parse({ provider: "kokoro", voiceId: lang === "fr" ? "30" : "16" });
  if (pick === "piper") return VoiceSettings.parse({ provider: "piper", voiceId: lang === "fr" ? "fr_FR-gilles-low" : "en_US-john-medium" });
  return VoiceSettings.parse({ provider: "synthetic", voiceId: "synthetic-m1" });
}

export interface DemoPlan { project: Project; langs: Lang[]; preset: RenderPresetId; onlyChapters: string[] | null }

export async function createDemoProject(rt: Runtime, o: DemoOptions): Promise<DemoPlan> {
  const fx = await rt.fixture(o.fixture);
  if (!fx) throw new DocmakerError("FIXTURE_MISSING", `fixture ${o.fixture} not found`, { hint: `available fixtures live in ${rt.config.repoRoot}/fixtures/` });
  const requested = o.langs.length ? o.langs : [fx.primaryLang];
  const unknown = requested.filter((l) => !fx.languages.includes(l));
  if (unknown.length) throw new DocmakerError("VALIDATION", `fixture ${fx.id} has no ${unknown.join(",")} version (languages: ${fx.languages.join(",")})`);
  // the primary language is always part of the project (secondary scripts are written from its skeleton)
  const languages = fx.languages.filter((l) => l === fx.primaryLang || requested.includes(l));
  const project = await createProjectIn(rt, {
    idea: fx.idea, slug: o.slug ?? demoSlug(fx.id), languages, primaryLang: fx.primaryLang, targetMinutes: fx.targetMinutes, styleId: fx.styleId,
    llm: "fixture", fixtureId: fx.id, seed: fx.seed,
  }, (p) => ({
    ...p,
    title: fx.title,
    assets: { ...p.assets, offline: o.offline },
    voice: Object.fromEntries(languages.map((l) => [l, demoVoice(o.tts, l, rt.config.paths.models)])),
    captions: "burn",
    editorial: { ...p.editorial, asOf: fx.asOf },
    render: { ...p.render, defaultPreset: o.preset, concurrency: o.concurrency ?? p.render.concurrency },
  }));
  return { project, langs: requested, preset: o.preset, onlyChapters: o.onlyChapters && o.onlyChapters.length ? o.onlyChapters : null };
}

export const demoOutputs = (projectDir: string, lang: Lang, preset: RenderPresetId) => ({
  mp4: `${projectDir}/${P.renderFinal(lang, preset)}`,
  exportDir: `${projectDir}/${P.exportDir(lang)}`.replace(/\/$/, ""),
});
