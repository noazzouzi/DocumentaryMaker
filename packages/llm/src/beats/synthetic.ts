// Plan keys, synthetic clip/breath beats and global beat ordering (§4.6).
import { hashJson, ids, sha16, tokenizeDisplay, type BeatLang, type BeatPlan, type Lang, type Script } from "@docmaker/core";

/** sha16(hashJson({visualKind, visualQuery, personIds, motionTemplate, quoteId})). */
export function computePlanKey(p: Pick<BeatPlan, "visualKind" | "visualQuery" | "personIds" | "motionTemplate" | "quoteId">): string {
  return sha16(hashJson({ visualKind: p.visualKind, visualQuery: p.visualQuery, personIds: p.personIds, motionTemplate: p.motionTemplate, quoteId: p.quoteId }));
}

const STOP = new Set(["the", "a", "an", "of", "and", "le", "la", "les", "de", "des", "du", "et", "l", "d", "un", "une"]);
function titleKeywords(title: string): string {
  const kw = tokenizeDisplay(title).map((w) => w.norm).filter((w) => w.length > 1 && !STOP.has(w));
  return kw.join(" ") || "documentary";
}

export function emptyBeatLang(beatId: string, lang: Lang, cueCount: number): BeatLang {
  return { beatId, lang, text: "", onScreenText: "", cueAnchorIdx: Array.from({ length: cueCount }, () => -1), emphasisIdx: [], motionData: {} };
}

/**
 * Synthetic beats added in code: one -CLIP beat per clip segment, one -BR beat per music_breath segment (no text).
 * `planned` (optional) = the chapter's planned narration beats: breath beats copy the previous narration beat's visual.
 */
export function syntheticBeats(script: Script, langs: Lang[], startOrder: number, planned?: readonly BeatPlan[]): { plans: BeatPlan[]; texts: BeatLang[] } {
  const plans: BeatPlan[] = [];
  const texts: BeatLang[] = [];
  let order = startOrder;
  const cps = 15; // clip speech estimate (third-party speakers)
  for (const ch of script.chapters) {
    let prev: BeatPlan | null = null;
    for (const seg of ch.segments) {
      if (seg.type === "narration") {
        const segBeats = (planned ?? []).filter((p) => p.segmentId === seg.id);
        if (segBeats.length > 0) prev = segBeats[segBeats.length - 1]!;
        continue;
      }
      let p: BeatPlan | null = null;
      if (seg.type === "clip") {
        const base = {
          visualKind: "youtube_clip" as const, visualQuery: "", personIds: [], motionTemplate: "none" as const, quoteId: seg.quoteId,
        };
        p = {
          id: ids.clipBeat(seg.id), chapterId: ch.chapterId, segmentId: seg.id, order: order++, origin: "clip", purpose: "context", energy: 3,
          estSeconds: Math.max(1, Math.round((seg.displayText.length / cps) * 10) / 10), ...base, youtubeQuoteToFind: seg.displayText,
          camera: "static", transitionIn: "cut", sfx: [], musicCue: "duck", musicMood: "none", factIds: seg.quoteId ? [seg.quoteId] : [],
          cueTags: [{ type: "CLIP_REF", value: seg.quoteId ?? "" }], planKey: computePlanKey(base),
        };
      } else if (seg.type === "music_breath") {
        const base = {
          visualKind: prev?.visualKind === "youtube_clip" || !prev ? ("stock_broll" as const) : prev.visualKind,
          visualQuery: prev && prev.visualKind !== "youtube_clip" ? prev.visualQuery : titleKeywords(ch.title),
          personIds: [], motionTemplate: "none" as const, quoteId: null,
        };
        p = {
          id: ids.breathBeat(seg.id), chapterId: ch.chapterId, segmentId: seg.id, order: order++, origin: "breath", purpose: "transition", energy: 4,
          estSeconds: Math.max(0.5, (seg.breathMs || 2000) / 1000), ...base, youtubeQuoteToFind: "", camera: "ken_burns", transitionIn: "cut",
          sfx: [], musicCue: "none", musicMood: prev?.musicMood ?? "tense", factIds: [], cueTags: [{ type: "MONTAGE", value: "" }], planKey: computePlanKey(base),
        };
      }
      if (!p) continue; // sponsor_slot: no beat
      plans.push(p);
      for (const lang of langs) texts.push(emptyBeatLang(p.id, lang, p.cueTags.length));
    }
  }
  return { plans, texts };
}

/**
 * Merges planned narration beats with synthetic beats and renumbers `order` by script position
 * (chapter order, then segment order, then the planned order inside a segment).
 */
export function assembleBeatPlans(script: Script, planned: readonly BeatPlan[], langs: Lang[]): { plans: BeatPlan[]; texts: BeatLang[] } {
  const synth = syntheticBeats(script, langs, 0, planned);
  const pos = new Map<string, number>();
  let k = 0;
  for (const ch of script.chapters) for (const s of ch.segments) pos.set(s.id, k++);
  const all = [...planned.filter((p) => p.origin !== "clip" && p.origin !== "breath"), ...synth.plans];
  const sorted = all
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (pos.get(a.p.segmentId) ?? 1e9) - (pos.get(b.p.segmentId) ?? 1e9) || a.p.order - b.p.order || a.i - b.i)
    .map(({ p }, order) => ({ ...p, order }));
  return { plans: sorted, texts: synth.texts };
}
