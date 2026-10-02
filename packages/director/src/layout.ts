// layoutProgram (§9.2): the audio clock. Pure; identical inputs → identical output.
import {
  DocmakerError, beatWordRanges, chapterCardReadMs, chapterOfSegment, frameToMs, msToFrame, normWord, spokenText, tokenizeDisplay,
  type BeatLang, type BeatPlan, type ClipResolution, type LayoutBeat, type LayoutSegment, type LayoutSegmentMode, type LayoutWord,
  type MacroAct, type ProgramLayout, type ScriptProfile, type ScriptSegment, type SegmentTake, type StoryShape,
} from "@docmaker/core";
import type { LayoutInput } from "./types";

/** Story shape of the project (falls back to the profile default, then the first shape). */
export function resolveShape(profile: ScriptProfile, storyShapeId: string): StoryShape {
  return (
    profile.storyShapes.find((s) => s.id === storyShapeId)
    ?? profile.storyShapes.find((s) => s.id === profile.defaultShape)
    ?? profile.storyShapes[0]!
  );
}

/** Macro act of an act id: the project's shape first, then any shape of the profile, else by position. */
export function macroOf(profile: ScriptProfile, shape: StoryShape, act: string, ci: number, n: number): MacroAct {
  const hit = shape.acts.find((a) => a.id === act) ?? profile.storyShapes.flatMap((s) => s.acts).find((a) => a.id === act);
  if (hit) return hit.macro;
  return ci === 0 ? "setup" : ci === n - 1 ? "resolution" : "confrontation";
}

export function layoutMode(
  seg: ScriptSegment, clip: ClipResolution | undefined, take: SegmentTake | undefined, i: Pick<LayoutInput, "clipFallback" | "frozen">,
): LayoutSegmentMode | "sponsor" {
  switch (seg.type) {
    case "narration": return "vo";
    case "music_breath": return "breath";
    case "sponsor_slot": return "sponsor";
    case "clip": {
      const usable = clip !== undefined && (clip.status === "found" || clip.status === "manual") && clip.assetId !== null
        && clip.passageInMs !== null && clip.passageOutMs !== null && clip.passageOutMs > clip.passageInMs
        && (Object.keys(i.frozen).length === 0 || clip.assetId in i.frozen);
      if (usable) return "clip";
      return i.clipFallback === "narrated" && take !== undefined ? "clip-narrated" : "clip-card";
    }
  }
}

const isSynthetic = (beatId: string) => beatId.endsWith("-CLIP") || beatId.endsWith("-BR");
const GAP_DEVICES = new Set(["cliffhanger", "reveal", "rhetorical_question"]);
const TITLE_STING_GAP_MS = 3500;
const CHAPTER_CARD_ENTER30 = 12;

interface RawWord { id: string; segmentId: string; idx: number; text: string; norm: string; startMs: number; endMs: number }

/** Take words ordered by display index (word ids carry the index; positional fallback). */
function takeWords(seg: SegmentTake): { idx: number; text: string; startMs: number; endMs: number }[] {
  const out = seg.words.map((w, pos) => {
    const m = /^(CH\d{1,2}-S\d{2,3}):(\d{1,4})$/.exec(w.wordId);
    const idx = m && m[1] === seg.segmentId ? Number(m[2]) : pos;
    return { idx, text: w.text, startMs: w.startMs, endMs: Math.max(w.startMs, w.endMs) };
  });
  out.sort((a, b) => a.idx - b.idx);
  return out;
}

/** Word ranges of a segment's narration beats (display-word indices within the segment). */
function segmentBeatRanges(seg: ScriptSegment, plans: BeatPlan[], textOf: Map<string, BeatLang>): Map<string, { wordStart: number; wordEnd: number }> {
  const narr = plans.filter((p) => !isSynthetic(p.id));
  const out = new Map<string, { wordStart: number; wordEnd: number }>();
  if (narr.length === 0) return out;
  const texts = narr.map((p) => {
    const t = textOf.get(p.id);
    if (!t) throw new DocmakerError("VALIDATION", `beat ${p.id} has no text in this language`, { hint: "re-run the beatslice stage" });
    return t.text;
  });
  let ranges: { wordStart: number; wordEnd: number }[];
  try {
    ranges = beatWordRanges(spokenText(seg, "vo"), texts);
  } catch (e) {
    throw new DocmakerError("VALIDATION", `beat texts of ${seg.id} do not reconstruct the segment`, { cause: e, hint: "re-run the beatslice stage" });
  }
  narr.forEach((p, k) => out.set(p.id, ranges[k]!));
  return out;
}

export function layoutProgram(i: LayoutInput): Omit<ProgramLayout, "voProgram"> {
  const { fps, pauses } = i;
  const profile = i.style.scriptProfile;
  const shape = resolveShape(profile, i.storyShapeId);
  const outlineCh = new Map(i.outline.chapters.map((c) => [c.id, c]));
  const takeSeg = new Map(i.take.segments.map((s) => [s.segmentId, s]));
  const clipBySeg = new Map(i.clips.map((c) => [c.segmentId, c]));
  const textOf = new Map(i.texts.map((t) => [t.beatId, t]));
  const plansBySeg = new Map<string, BeatPlan[]>();
  for (const p of [...i.plans].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))) {
    const arr = plansBySeg.get(p.segmentId) ?? [];
    arr.push(p);
    plansBySeg.set(p.segmentId, arr);
  }
  const chapters = i.script.chapters;
  if (chapters.length === 0) throw new DocmakerError("VALIDATION", "layout: the script has no chapter");
  const actOf = (ci: number): string => outlineCh.get(chapters[ci]!.chapterId)?.act ?? shape.acts[Math.min(ci, shape.acts.length - 1)]!.id;
  const firstActIsShapeFirst = actOf(0) === shape.acts[0]!.id;
  const isTitleStingChapter = (ci: number) => ci === 1 && i.style.budgets.titleSting && firstActIsShapeFirst;

  // ---- modes (validated up front so missing takes fail loudly)
  const modes = new Map<string, LayoutSegmentMode | "sponsor">();
  const missing: string[] = [];
  for (const ch of chapters) {
    for (const seg of ch.segments) {
      if (!seg.id.startsWith(ch.chapterId + "-")) throw new DocmakerError("VALIDATION", `segment ${seg.id} is not in ${ch.chapterId}`);
      const m = layoutMode(seg, clipBySeg.get(seg.id), takeSeg.get(seg.id), i);
      modes.set(seg.id, m);
      if (m === "vo" && !takeSeg.has(seg.id)) missing.push(seg.id);
    }
  }
  if (missing.length > 0) {
    throw new DocmakerError("ANCHOR_MISSING", `the voice take has no audio for ${missing.join(", ")}`, {
      details: { missingSegmentIds: missing }, hint: "record or synthesise the missing segments (or enable pickup TTS)",
    });
  }

  // ---- REVEAL anchor per chapter: its FIRST REVEAL cue (segment, segment-relative display word index)
  const revealAt = new Map<string, { segmentId: string; k: number }>();
  for (const ch of chapters) {
    outer: for (const seg of ch.segments) {
      if (modes.get(seg.id) !== "vo") continue;
      const segPlans = plansBySeg.get(seg.id) ?? [];
      if (!segPlans.some((p) => p.cueTags.some((c) => c.type === "REVEAL"))) continue;
      const ranges = segmentBeatRanges(seg, segPlans, textOf);
      for (const p of segPlans) {
        const r = ranges.get(p.id);
        if (!r) continue;
        const k = p.cueTags.findIndex((c) => c.type === "REVEAL");
        if (k < 0) continue;
        const anchor = textOf.get(p.id)?.cueAnchorIdx[k] ?? -1;
        const idx = Math.min(r.wordEnd - 1, r.wordStart + Math.max(0, anchor));
        revealAt.set(ch.chapterId, { segmentId: seg.id, k: idx });
        break outer;
      }
    }
  }

  // ---- walk the program (ms clock)
  const segRows: (Omit<LayoutSegment, "from" | "dur" | "wordStart" | "wordEnd"> & { words: RawWord[] })[] = [];
  const sponsorRaw: { segmentId: string; ms: number }[] = [];
  const chapterStartMs: number[] = [];
  let t = pauses.headMs;
  chapters.forEach((ch, ci) => {
    if (ci > 0) {
      chapterStartMs.push(t);
      const read = isTitleStingChapter(ci) ? TITLE_STING_GAP_MS : chapterCardReadMs(ch.title, CHAPTER_CARD_ENTER30);
      t += Math.max(pauses.chapterGapMs, read);
    } else chapterStartMs.push(0);
    const rv = revealAt.get(ch.chapterId);
    for (const seg of ch.segments) {
      const mode = modes.get(seg.id)!;
      if (mode === "sponsor") { sponsorRaw.push({ segmentId: seg.id, ms: t }); continue; }
      const isClipMode = mode === "clip" || mode === "clip-narrated" || mode === "clip-card";
      if (isClipMode) t += pauses.clipLeadMs;
      const tk = mode === "vo" || mode === "clip-narrated" ? takeSeg.get(seg.id) : undefined;
      const tw = tk ? takeWords(tk) : [];
      const insertions: LayoutSegment["insertions"] = [];
      if (rv && rv.segmentId === seg.id && mode === "vo") {
        if (rv.k === 0) t += pauses.preRevealMs;
        else {
          const a = tw.find((w) => w.idx === rv.k - 1);
          const b = tw.find((w) => w.idx === rv.k);
          if (a && b) insertions.push({ afterWordIdx: rv.k - 1, splitAtMs: Math.round((a.endMs + b.startMs) / 2), ms: pauses.preRevealMs });
          else t += pauses.preRevealMs; // timing gap in the take: pause before the segment instead
        }
      }
      const start = frameToMs(msToFrame(t, fps), fps); // frame-quantised segment start
      const extra = insertions.reduce((a, x) => a + x.ms, 0);
      let durMs: number;
      const clip = clipBySeg.get(seg.id);
      switch (mode) {
        case "vo": case "clip-narrated": durMs = tk!.durationMs + extra; break;
        case "clip": durMs = clip!.passageOutMs! - clip!.passageInMs!; break;
        case "clip-card": durMs = Math.max(3000, Math.round(1000 * ([...spokenText(seg, "clip-narrated")].length / 15) + 1500)); break;
        case "breath": durMs = seg.breathMs || 2000; break;
      }
      const words: RawWord[] = [];
      if (tk) {
        const tok = tokenizeDisplay(spokenText(seg, mode === "vo" ? "vo" : "clip-narrated"));
        for (const w of tw) {
          const shift = insertions.filter((x) => w.idx > x.afterWordIdx).reduce((a, x) => a + x.ms, 0);
          words.push({
            id: `${seg.id}:${w.idx}`, segmentId: seg.id, idx: w.idx, text: tok[w.idx]?.text ?? w.text,
            norm: tok[w.idx]?.norm ?? normWord(w.text),
            startMs: Math.max(0, start + w.startMs + shift), endMs: Math.max(0, start + w.endMs + shift),
          });
        }
      }
      segRows.push({
        segmentId: seg.id, chapterId: ch.chapterId, mode, startMs: start, endMs: start + durMs,
        voFile: tk ? tk.file : null, voAssetId: tk ? tk.sha256 : null,
        clipAssetId: mode === "clip" ? clip!.assetId : null, clipPassageInMs: mode === "clip" ? clip!.passageInMs : null,
        insertions, words,
      });
      t = start + durMs;
      t += isClipMode ? pauses.clipTailMs
        : mode === "vo" && GAP_DEVICES.has(seg.device) ? pauses.deviceGapMs
        : mode === "vo" ? pauses.segmentGapMs : 0;
    }
  });
  t += pauses.tailMs;
  const N = Math.max(1, msToFrame(t, fps));

  // ---- words (frames; strictly increasing onsets; end = max(from+1, min(endF, next.from)))
  const raw = segRows.flatMap((s) => s.words);
  const froms: number[] = [];
  for (const w of raw) froms.push(Math.max(msToFrame(w.startMs, fps), (froms[froms.length - 1] ?? -1) + 1));
  const words: LayoutWord[] = raw.map((w, k) => {
    const from = Math.min(froms[k]!, N - 1);
    const next = froms[k + 1] ?? Number.POSITIVE_INFINITY;
    const end = Math.min(N, Math.max(from + 1, Math.min(msToFrame(w.endMs, fps), next)));
    return { id: w.id, segmentId: w.segmentId, idx: w.idx, text: w.text, norm: w.norm, from, dur: Math.max(1, end - from), startMs: w.startMs, endMs: Math.max(w.startMs, w.endMs) };
  });

  // ---- segments
  const segments: LayoutSegment[] = [];
  const wordIndexOf = new Map<string, number>(); // word id → global index
  words.forEach((w, k) => wordIndexOf.set(w.id, k));
  let cursor = 0;
  for (const s of segRows) {
    const from = msToFrame(s.startMs, fps);
    const wordStart = cursor;
    cursor += s.words.length;
    segments.push({
      segmentId: s.segmentId, chapterId: s.chapterId, mode: s.mode as LayoutSegmentMode, from, dur: Math.max(1, msToFrame(s.endMs, fps) - from),
      startMs: s.startMs, endMs: s.endMs, voFile: s.voFile, voAssetId: s.voAssetId, clipAssetId: s.clipAssetId,
      clipPassageInMs: s.clipPassageInMs, insertions: s.insertions, wordStart, wordEnd: cursor,
    });
  }
  const segById = new Map(segments.map((s) => [s.segmentId, s]));

  // ---- chapters
  const chFrom = chapterStartMs.map((ms, ci) => (ci === 0 ? 0 : msToFrame(ms, fps)));
  const lchapters: ProgramLayout["chapters"] = chapters.map((ch, ci) => {
    const from = chFrom[ci]!;
    const end = ci + 1 < chapters.length ? chFrom[ci + 1]! : N;
    if (end - from < 1) throw new DocmakerError("VALIDATION", `chapter ${ch.chapterId} has no duration`);
    const fw = words.find((w) => chapterOfSegment(w.segmentId) === ch.chapterId);
    const act = actOf(ci);
    return {
      chapterId: ch.chapterId, title: ch.title, act, macroAct: macroOf(profile, shape, act, ci, chapters.length),
      from, dur: end - from, firstWordFrame: fw ? fw.from : null,
    };
  });

  // ---- beats tile their chapter
  const beats: LayoutBeat[] = [];
  chapters.forEach((ch, ci) => {
    const lc = lchapters[ci]!;
    const chEnd = lc.from + lc.dur;
    const rows: { beatId: string; segmentId: string; onset: number; wordStart: number; wordEnd: number }[] = [];
    for (const seg of ch.segments) {
      const ls = segById.get(seg.id);
      if (!ls) continue;
      const segPlans = plansBySeg.get(seg.id) ?? [];
      if (ls.mode === "vo") {
        const ranges = segmentBeatRanges(seg, segPlans, textOf);
        // display index → global word index for this segment
        const g = new Map<number, number>();
        for (let k = ls.wordStart; k < ls.wordEnd; k++) g.set(words[k]!.idx, k);
        for (const p of segPlans) {
          const r = ranges.get(p.id);
          if (!r) continue;
          const idxs: number[] = [];
          for (let d = r.wordStart; d < r.wordEnd; d++) { const k = g.get(d); if (k !== undefined) idxs.push(k); }
          const ws = idxs.length > 0 ? Math.min(...idxs) : ls.wordStart;
          const we = idxs.length > 0 ? Math.max(...idxs) + 1 : ls.wordStart;
          rows.push({ beatId: p.id, segmentId: seg.id, onset: idxs.length > 0 ? words[ws]!.from : ls.from, wordStart: ws, wordEnd: we });
        }
      } else {
        for (const p of segPlans) {
          if (!isSynthetic(p.id)) continue; // a narration plan on a non-narration segment carries no layout
          const withWords = ls.mode === "clip-narrated";
          rows.push({ beatId: p.id, segmentId: seg.id, onset: ls.from, wordStart: ls.wordStart, wordEnd: withWords ? ls.wordEnd : ls.wordStart });
        }
      }
    }
    const froms2: number[] = [];
    rows.forEach((r, k) => {
      const want = k === 0 ? lc.from : Math.max(lc.from, r.onset);
      froms2.push(k === 0 ? want : Math.max(want, froms2[k - 1]! + 1));
    });
    if (rows.length > 0 && froms2[froms2.length - 1]! >= chEnd) {
      throw new DocmakerError("VALIDATION", `chapter ${ch.chapterId} is too short for its ${rows.length} beats`);
    }
    rows.forEach((r, k) => {
      const from = froms2[k]!;
      const end = k + 1 < rows.length ? froms2[k + 1]! : chEnd;
      beats.push({
        beatId: r.beatId, segmentId: r.segmentId, chapterId: ch.chapterId, from, dur: end - from,
        onsetFrame: Math.min(end - 1, Math.max(from, r.onset)), wordStart: r.wordStart, wordEnd: r.wordEnd,
      });
    });
  });

  return {
    schemaVersion: 1,
    lang: i.lang,
    fps,
    takeId: i.take.id,
    takeKind: i.take.kind,
    scriptHash: i.scriptHash,
    plansHash: i.plansHash,
    slicesHash: i.slicesHash,
    onlyChapters: i.onlyChapters,
    pauses,
    durationInFrames: N,
    durationMs: frameToMs(N, fps),
    chapters: lchapters,
    segments,
    beats,
    words,
    sponsorMarkers: sponsorRaw.map((s) => ({ segmentId: s.segmentId, frame: Math.min(N - 1, msToFrame(s.ms, fps)) })),
  };
}
