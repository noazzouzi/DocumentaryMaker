// The voiced segments of a script, in script order, with their tts text and display mapping.
import type { Lang, LexiconEntry, Script, ScriptSegment } from "@docmaker/core";
import { spokenText, tokenizeDisplay, type DisplayWord } from "@docmaker/core";
import { mapDisplayToTts } from "./align/map";
import { buildTtsText, type TtsTextOptions } from "./text/tts-text";

export interface VoicedItem {
  seg: ScriptSegment;
  chapterId: string;
  mode: "narration" | "clip-narrated";
  spoken: string;
  display: DisplayWord[];
  ttsText: string;
  ttsWords: string[];
  displayToTts: [number, number][];
}

export const ttsTokens = (s: string) => s.split(/\s+/u).filter(Boolean);

/**
 * Narration segments (seg.ttsText, filled by the engine; rebuilt from displayText when empty) and the clip
 * segments narrated as a fallback (built from subtitleTranslation || displayText). Empty texts are skipped.
 */
export function voicedItems(script: Script, o: { lang: Lang; clipNarrated: readonly string[]; textOptions: TtsTextOptions }): VoicedItem[] {
  const clip = new Set(o.clipNarrated);
  const out: VoicedItem[] = [];
  for (const ch of script.chapters) {
    for (const seg of ch.segments) {
      let mode: VoicedItem["mode"];
      if (seg.type === "narration") mode = "narration";
      else if (seg.type === "clip" && clip.has(seg.id)) mode = "clip-narrated";
      else continue;
      const spoken = spokenText(seg, mode === "narration" ? "vo" : "clip-narrated");
      if (!spoken.trim()) continue;
      const ttsText = mode === "narration" && seg.ttsText.trim() ? seg.ttsText : buildTtsText(spoken, o.lang, o.textOptions).ttsText;
      const ttsWords = ttsTokens(ttsText);
      if (ttsWords.length === 0) continue;
      out.push({
        seg, chapterId: ch.chapterId, mode, spoken, display: tokenizeDisplay(spoken), ttsText: ttsWords.join(" "), ttsWords,
        displayToTts: mapDisplayToTts(spoken, ttsText, o.lang, o.textOptions.lexicon as LexiconEntry[]),
      });
    }
  }
  return out;
}
