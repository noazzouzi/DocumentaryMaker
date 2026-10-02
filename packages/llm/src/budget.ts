// Script duration budget (deterministic; ported from $SP/script-pipeline/budget-and-lint.ts, §6.6).
import { DocmakerError, type Budget, type Lang, type ScriptProfile, type StoryShape } from "@docmaker/core";

export function findShape(profile: ScriptProfile, shapeId: string): StoryShape {
  const shape = profile.storyShapes.find((s) => s.id === shapeId) ?? profile.storyShapes.find((s) => s.id === profile.defaultShape);
  if (!shape) throw new DocmakerError("VALIDATION", `unknown story shape "${shapeId}" (style profile ${profile.id})`);
  return shape;
}

/** runtimeSec = minutes·60; narrationSec = runtimeSec·narrationShare; chars = narrationSec·cps; words = chars/avgCharsPerWord. */
export function planBudget(minutes: number, lang: Lang, profile: ScriptProfile, shapeId: string, voiceCps?: number): Budget {
  if (!(minutes > 0)) throw new DocmakerError("VALIDATION", `planBudget: minutes must be > 0 (got ${minutes})`);
  const shape = findShape(profile, shapeId);
  const runtimeSec = minutes * 60;
  const narrationSec = runtimeSec * profile.narrationShare;
  const cps = voiceCps !== undefined && voiceCps > 0 ? voiceCps : profile.charsPerSec[lang];
  const chars = Math.round(narrationSec * cps);
  const words = Math.round(chars / profile.avgCharsPerWord[lang]);
  const meanChapterSec = (profile.chapterSec[0] + profile.chapterSec[1]) / 2;
  const chapters = minutes < 5 ? Math.max(2, Math.round(runtimeSec / 30)) : Math.max(5, Math.round(runtimeSec / meanChapterSec));
  const perAct: Record<string, number> = {};
  for (const a of shape.acts) perAct[a.id] = Math.round(words * a.share);
  return {
    lang, minutes, storyShape: shape.id, charsPerSec: cps, runtimeSec: Math.round(runtimeSec), narrationSec: Math.round(narrationSec),
    chars, words, chapters, perAct, beatsApprox: Math.round(narrationSec / 3.2),
  };
}
