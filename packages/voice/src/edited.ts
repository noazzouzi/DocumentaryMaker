// editedAfterTake (§8.6): segments whose current tts text no longer matches the take (computed, never stored).
import type { Script, VoiceTrack } from "@docmaker/core";
import { hashJson, spokenText } from "@docmaker/core";
import { ttsTokens } from "./segments";
import { buildTtsText } from "./text/tts-text";

const norm = (s: string) => ttsTokens(s).join(" ");

/**
 * Segment ids whose current ttsText hash differs from the take's ttsTextHash, plus narration segments the
 * take does not cover yet (and that are not already listed as missing). Clip-narrated segments compare their
 * spoken translation through buildTtsText (both number modes) against the take's text.
 */
export function editedAfterTake(script: Script, take: VoiceTrack): string[] {
  const bySeg = new Map(take.segments.map((s) => [s.segmentId, s]));
  const missing = new Set(take.missingSegmentIds);
  const out: string[] = [];
  for (const ch of script.chapters) {
    for (const seg of ch.segments) {
      const t = bySeg.get(seg.id);
      if (seg.type === "narration") {
        const spoken = spokenText(seg, "vo");
        if (!spoken.trim()) continue;
        const current = norm(seg.ttsText.trim() ? seg.ttsText : spoken);
        if (!t) {
          if (!missing.has(seg.id)) out.push(seg.id);
          continue;
        }
        if (hashJson(current) === t.ttsTextHash) continue;
        // ttsText empty in the script: the take was built from displayText with some option set
        if (!seg.ttsText.trim() && [true, false].some((x) => hashJson(buildTtsText(spoken, script.lang, { lexicon: [], expandNumbers: x, stripTags: true }).ttsText) === t.ttsTextHash)) continue;
        out.push(seg.id);
      } else if (seg.type === "clip" && t && t.mode === "clip-narrated") {
        const spoken = spokenText(seg, "clip-narrated");
        const same = norm(spoken) === norm(t.ttsText)
          || [true, false].some((x) => buildTtsText(spoken, script.lang, { lexicon: [], expandNumbers: x, stripTags: true }).ttsText === norm(t.ttsText));
        if (!same) out.push(seg.id);
      }
    }
  }
  return out;
}
