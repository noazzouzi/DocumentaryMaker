// The "rich" layout scenario: every layout mode (clip found, clip-narrated, clip-card, breath, sponsor) and a mid-segment REVEAL.
import { Script, hashJson, ids, spokenText, tokenizeDisplay, type ScriptSegment, type VoiceTrack } from "@docmaker/core";
import { makeBeats, makeFrozen, makeScript, makeTake } from "@docmaker/core/testing";
import { foundClip, videoIds } from "./fixtures";

function seg(id: string, type: ScriptSegment["type"], displayText: string, extra: Partial<ScriptSegment> = {}): ScriptSegment {
  return {
    id, type, displayText, ttsText: "", ttsTextEdited: false, quoteId: null, subtitleTranslation: "", factIds: [], device: "none",
    breathMs: type === "music_breath" ? 2000 : 0, primaryHash: null, ...extra,
  };
}

/** Script with every layout mode: clip (found), clip-narrated, clip-card, breath, sponsor, and a mid-segment REVEAL. */
export function richScenario() {
  const base = makeScript({ chapters: 3, segmentsPerChapter: 3, withClip: true, withBreath: true });
  const ch2 = base.chapters[1]!;
  const quote = "It is all a fever, and fevers break.";
  ch2.segments.push(
    seg(ids.segment("CH2", ch2.segments.length + 1), "clip", quote, { quoteId: "Q1", factIds: ["Q1"] }),
    seg(ids.segment("CH2", ch2.segments.length + 2), "sponsor_slot", ""),
    seg(ids.segment("CH2", ch2.segments.length + 3), "clip", quote, { quoteId: "Q2", factIds: ["Q2"] }),
    seg(ids.segment("CH2", ch2.segments.length + 4), "narration", "Then came the panic. Nobody asked what a flower was actually worth.", { factIds: ["S1"] }),
  );
  const script = Script.parse(base);
  const narratedSeg = ch2.segments.find((s) => s.type === "clip" && s.quoteId === "Q1" && s.id !== ch2.segments.find((x) => x.type === "clip")!.id)!;
  const cardSeg = ch2.segments.filter((s) => s.type === "clip").at(-1)!;
  const foundSeg = ch2.segments.find((s) => s.type === "clip")!;
  const revealSeg = script.chapters[2]!.segments.find((s) => s.type === "narration" && tokenizeDisplay(s.displayText).length >= 5)!;
  const { plans, slices } = makeBeats(script, { cues: true, revealIn: { segmentId: revealSeg.id, wordIdx: 3 } });
  const take0 = makeTake(script);
  // clip-narrated take segment (synthetic timings)
  const words = tokenizeDisplay(spokenText(narratedSeg, "clip-narrated")).map((w, k) => ({
    wordId: ids.word(narratedSeg.id, k), text: w.text, startMs: 60 + k * 320, endMs: 60 + k * 320 + 260, confidence: null, source: "synthetic" as const,
  }));
  const take: VoiceTrack = {
    ...take0,
    segments: [...take0.segments, {
      ...take0.segments[0]!, segmentId: narratedSeg.id, mode: "clip-narrated", file: take0.segments[0]!.file.replace(/CH\d-S\d+/, narratedSeg.id),
      sha256: hashJson(narratedSeg.id), durationMs: words.at(-1)!.endMs + 120, words,
    }],
  };
  const frozen = makeFrozen({ images: 12, videos: 2 });
  const clips = [foundClip(foundSeg.id, videoIds(frozen)[0]!), { ...foundClip(narratedSeg.id, videoIds(frozen)[0]!), status: "not-found" as const, assetId: null, passageInMs: null, passageOutMs: null }];
  return { script, plans, slices, take, frozen, clips, foundSeg, narratedSeg, cardSeg, revealSeg };
}

