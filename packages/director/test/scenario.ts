// A realistic synthetic programme for policy tests: ~10 minutes, 5 chapters spanning the story shape, every cue type at a
// realistic density (~1 cue per 3 beats), templates filled from the FactSheet, 40 distinct stills + videos, a found clip,
// a music breath, 3 SFX variants per category and three music tracks. Deterministic.
import {
  FrozenAsset, P, Script, SfxCategory, docHash, rngFor, sha256Hex, tokenizeDisplay,
  type AssetPick, type BeatLang, type BeatPlan, type CueTag, type CueType, type FactSheet, type Fps, type MotionTemplate, type PicksDoc,
} from "@docmaker/core";
import {
  TEST_NOW, TEST_STYLE, makeBeats, makeFactSheet, makeMusicTrack, makeScript, makeSfxEntry, makeTake, planKeyOf,
} from "@docmaker/core/testing";
import { buildInputs, foundClip, makeOutline, type Built } from "./fixtures";

const sha = (s: string) => sha256Hex(`director-scenario:${s}`);

function frozenAsset(id: string, kind: "image" | "video", w: number, h: number, extra: Partial<FrozenAsset> = {}): FrozenAsset {
  const ext = kind === "image" ? "jpg" : "mp4";
  return FrozenAsset.parse({
    id, originalSha256: sha(`orig:${id}`), kind, role: "broll", mime: kind === "image" ? "image/jpeg" : "video/mp4", ext, bytes: 100_000,
    width: w, height: h, durationMs: kind === "video" ? 30_000 : null, fps: kind === "video" ? 30 : null, hasAudio: kind === "video", lufs: kind === "video" ? -23 : null,
    cacheRel: `blobs/${id.slice(0, 2)}/${id}.${ext}`, projectRel: P.media(id, ext), candidate: null, declaration: null,
    conform: { recipe: kind === "image" ? "image-v1" : "video-cfr-v1", sourceInMs: null, sourceOutMs: null, handleHeadMs: 1000, handleTailMs: 1000 },
    analysis: { grayscale: false, meanLuma: 0.4, year: null, lowRes: w < 1280 }, frozenAt: TEST_NOW, ...extra,
  });
}

export interface PolicyScenario extends Built { clipSegment: string | null }

const ALL_CUES: CueType[] = [
  "HOOK", "EMPHASIS", "REVEAL", "SHOCK", "TENSION_BUILD", "NUMBER", "PERSON_INTRO", "PLACE", "TIME_JUMP", "QUOTE", "DOCUMENT", "ARTICLE",
  "TWEET", "LIST", "COMPARISON", "IRONY", "FLASHBACK", "CHAPTER", "SENSITIVE", "MONTAGE", "EMPHASIS", "EMPHASIS", "NUMBER",
];

export function policyScenario(o: { seconds?: number; chapters?: number; fps?: Fps; seed?: number; merge?: boolean } = {}): PolicyScenario {
  // a short cold open (3 segments), then long chapters; ≈ o.minutes of narration
  const nCh = o.chapters ?? 5;
  const perCh = Math.max(4, Math.round(((o.seconds ?? 600) / 5.4 - 3) / Math.max(1, nCh - 1)));
  const full = makeScript({ chapters: nCh, segmentsPerChapter: perCh, withClip: true, withBreath: true });
  const script = Script.parse({ ...full, chapters: full.chapters.map((c, ci) => (ci === 0 ? { ...c, segments: [...c.segments.filter((x) => x.type === "narration").slice(0, 3), ...c.segments.filter((x) => x.type === "music_breath")] } : c)) });
  const beats = makeBeats(script, { cues: false });
  const base = { plans: beats.plans, slices: beats.slices, take: makeTake(script), layout: { plansHash: docHash(beats.plans) } };
  const facts: FactSheet = makeFactSheet({ people: 3, quotes: 3, figures: 2 });
  const R = (k: string) => rngFor(o.seed ?? 77, k);

  // ---- media: 40 stills of mixed sizes, 6 videos, 1 clip video, 2 portraits
  const frozen: Record<string, FrozenAsset> = {};
  const images: string[] = [];
  for (let i = 0; i < 40; i++) {
    const id = sha(`img:${i}`);
    const dims: [number, number] = i % 9 === 4 ? [1080, 1350] : i % 7 === 3 ? [1200, 800] : i % 5 === 1 ? [4000, 2667] : [1920, 1080];
    frozen[id] = frozenAsset(id, "image", dims[0], dims[1], i % 11 === 6 ? { analysis: { grayscale: true, meanLuma: 0.4, year: 1890, lowRes: false } } : {});
    images.push(id);
  }
  const videos: string[] = [];
  for (let i = 0; i < 6; i++) { const id = sha(`vid:${i}`); frozen[id] = frozenAsset(id, "video", 1920, 1080); videos.push(id); }
  const clipVid = sha("clip");
  frozen[clipVid] = frozenAsset(clipVid, "video", 1920, 1080, { role: "clip" });
  const portraits = [sha("portrait:P1"), sha("portrait:P2")];
  portraits.forEach((id) => (frozen[id] = frozenAsset(id, "image", 800, 1000, { role: "portrait" })));

  // ---- beats: realistic cue density, every cue type, templates, energies, music cues
  // realistic beat lengths (avg ≈ 3–5 s): merge the factory's sentence beats two by two within a segment
  const merged = o.merge === false ? { plans: base.plans.plans, texts: base.slices.texts } : mergeBeats(base.plans.plans, base.slices.texts);
  const textOf = new Map(merged.texts.map((t) => [t.beatId, t]));
  const plans: BeatPlan[] = [];
  const texts: BeatLang[] = [];
  let cueRot = 0, tplRot = 0, imgRot = 0, vidRot = 0;
  const picks: AssetPick[] = [];
  const TEMPLATES: { t: MotionTemplate; md: (txt: string) => Record<string, unknown>; facts: string[] }[] = [
    { t: "counter", md: () => ({ figure_id: "N1", value: 5500, from: 0, label: "guilders for one bulb", unit: "guilders", decimals: 0, format: "number" }), facts: ["N1"] },
    { t: "map_route", md: () => ({ places: [{ label: "Haarlem", lon: 4.6462, lat: 52.3874 }, { label: "Leiden", lon: 4.497, lat: 52.1601 }], route: true, region: "europe" }), facts: [] },
    { t: "kinetic_text", md: (txt) => ({ lines: [txt.split(/\s+/).slice(0, 4).join(" ")], emphasis: [] }), facts: [] },
    { t: "document_highlight", md: () => ({ source_id: "S1", kind: "pamphlet", title: "Samen-spraeck tusschen Waermondt ende Gaergoedt", paragraphs: ["A dialogue on the bulb trade, printed in Haarlem in 1637.", "The buyers paid with promises and the sellers with paper."], highlight: "", redact: ["paper"] }), facts: ["S1"] },
    { t: "headline_stack", md: () => ({ items: [{ source_id: "S2", outlet: "The Economist", headline: "Tulip mania source 2", date: "2020" }, { source_id: "S3", outlet: "Smithsonian Magazine", headline: "Tulip mania source 3", date: "2020" }] }), facts: ["S2", "S3"] },
    { t: "timeline", md: () => ({ events: [{ date: "1593", label: "Clusius plants tulips", event_id: "E1" }, { date: "1637-02-03", label: "The Haarlem auction fails", event_id: "E2" }], active_index: 1 }), facts: ["E1", "E2"] },
    { t: "quote_card", md: () => ({ quote_id: "Q1", text: "It is all a fever, and fevers break.", speaker: "Carolus Clusius", source: "Rijksmuseum", date: "1637-02" }), facts: ["Q1"] },
  ];
  const chapterMood = ["ominous", "tense", "tense", "sad", "ominous", "tense"] as const;
  for (const p0 of merged.plans) {
    const t0 = textOf.get(p0.id)!;
    const r = R(`beat:${p0.id}`);
    const ci = Number(p0.chapterId.slice(2)) - 1;
    const p: BeatPlan = { ...p0, energy: 1 + Math.min(4, Math.floor(r() * 5 * 0.999)), musicMood: chapterMood[ci % chapterMood.length]!, sfx: [] };
    const t: BeatLang = { ...t0, cueAnchorIdx: [], emphasisIdx: [], onScreenText: "", motionData: {} };
    const synthetic = p.id.endsWith("-CLIP") || p.id.endsWith("-BR");
    if (synthetic) {
      p.cueTags = p0.cueTags;
      t.cueAnchorIdx = p0.cueTags.map(() => -1);
      plans.push(p); texts.push(t); continue;
    }
    const words = tokenizeDisplay(t.text);
    p.energy = Math.max(1, Math.min(5, Math.round(2 + r() * 2.6)));
    p.camera = r() < 0.06 ? "zoom_out_reveal" : r() < 0.15 ? "slow_push_in" : "ken_burns";
    p.transitionIn = r() < 0.08 ? "whip" : r() < 0.05 ? "glitch" : "cut";
    p.musicCue = r() < 0.04 ? "build" : r() < 0.03 ? "hit" : r() < 0.03 ? "drop_out" : "none";
    p.motionTemplate = "none";
    p.personIds = [];
    p.quoteId = null;
    p.factIds = ["S1"];
    const cues: CueTag[] = [];
    const anchors: number[] = [];
    if (r() < 0.36 && words.length >= 2) {
      const type = ALL_CUES[cueRot++ % ALL_CUES.length]!;
      let k = Math.min(words.length - 1, Math.floor(r() * Math.min(4, words.length)));
      let value = words[k]!.norm;
      const numIdx = words.findIndex((w) => /\d/.test(w.norm));
      switch (type) {
        case "NUMBER":
          if (numIdx < 0) break;
          k = numIdx; value = words[numIdx]!.norm.replace(/[^\d]/g, "");
          if (value === "5500") p.factIds = ["S1", "N1"];
          cues.push({ type, value }); anchors.push(k); break;
        case "PERSON_INTRO": {
          const ci2 = words.findIndex((w) => w.norm === "clusius");
          if (ci2 < 0) break;
          p.personIds = ["P1"]; t.onScreenText = "Carolus Clusius — botanist, Leiden";
          cues.push({ type, value: "Carolus Clusius" }); anchors.push(Math.max(0, ci2 - 1)); break;
        }
        case "TIME_JUMP":
          if (numIdx < 0) break;
          cues.push({ type, value: words[numIdx]!.norm }); anchors.push(numIdx); break;
        case "SHOCK":
          p.energy = 5; t.onScreenText = "COLLAPSED";
          cues.push({ type, value: "collapsed" }); anchors.push(k); break;
        case "REVEAL":
          t.onScreenText = "BANKRUPT";
          cues.push({ type, value: "bankrupt" }); anchors.push(Math.max(1, k)); break;
        case "QUOTE": case "TWEET":
          p.quoteId = "Q2"; p.factIds = ["Q2"];
          cues.push({ type, value: "Q2" }); anchors.push(0); break;
        case "LIST": t.onScreenText = "Bulbs, paper, promises"; cues.push({ type, value: "" }); anchors.push(k); break;
        case "SENSITIVE": cues.push({ type, value: r() < 0.5 ? "bleep" : "face" }); anchors.push(k); break;
        case "MONTAGE": case "CHAPTER": case "HOOK": case "FLASHBACK":
          cues.push({ type, value: "" }); anchors.push(-1); break;
        default:
          cues.push({ type, value }); anchors.push(k);
      }
    }
    if (r() < 0.12 && cues.length === 0) {
      const tpl = TEMPLATES[tplRot++ % TEMPLATES.length]!;
      p.motionTemplate = tpl.t;
      p.factIds = ["S1", ...tpl.facts].filter((x, i, a) => a.indexOf(x) === i);
      if (tpl.t === "quote_card") p.quoteId = "Q1";
      t.motionData = tpl.md(t.text);
      if (tpl.t === "counter") { p.visualKind = "motion_graphic"; const ni = words.findIndex((w) => /\d/.test(w.norm)); if (ni >= 0) { cues.push({ type: "NUMBER", value: words[ni]!.norm.replace(/[^\d]/g, "") }); anchors.push(ni); } }
    }
    p.cueTags = cues;
    t.cueAnchorIdx = anchors;
    if (r() < 0.45 && words.length > 2) t.emphasisIdx = [1 + Math.floor(r() * (words.length - 2))];
    p.planKey = planKeyOf(p);
    plans.push(p);
    texts.push(t);
    // picks: 1–2 stills (or a video) per beat, rotating through 40 stills so reuse within 60 s is rare
    const nPicks = r() < 0.3 ? 2 : 1;
    for (let s = 0; s < nPicks; s++) {
      const useVideo = r() < 0.12;
      const assetId = useVideo ? videos[vidRot++ % videos.length]! : images[imgRot++ % images.length]!;
      picks.push({
        beatId: p.id, slot: s, assetId, role: s === 0 ? "primary" : "alt", focal: { x: 0.45 + 0.1 * r(), y: 0.4 + 0.1 * r() }, crop: null,
        sourceInMs: useVideo ? 2000 : null, sourceOutMs: useVideo ? 12000 : null,
        score: { metadata: 0.6, clip: null, vision: null, technical: null, watermark: null, nsfw: null, total: 0.6, focal: null, safeCrop: null, notes: "" },
        pickedBy: "auto", planKey: p.planKey,
      });
    }
  }
  const plansDoc = { ...base.plans, plans };
  const slicesDoc = { ...base.slices, texts };
  const clipSeg = script.chapters.flatMap((c) => c.segments).find((s) => s.type === "clip");
  const clips = clipSeg ? [foundClip(clipSeg.id, clipVid, 2000, 11500)] : [];
  const outline = makeOutline(script, TEST_STYLE, {
    acts: ["cold_open", "act1_rise", "act2a_cracks", "act2b_collapse", "act3_reckoning", "outro_rabbit_hole"].slice(0, script.chapters.length),
    adBreakAfter: script.chapters.length > 2 ? [script.chapters[1]!.chapterId] : [],
  });
  const sfx = SfxCategory.options.flatMap((category) => [0, 1, 2].map((variant) => makeSfxEntry({ category, variant })));
  const music = [makeMusicTrack({ bpm: 92, seconds: 150, mood: "tense" }), makeMusicTrack({ bpm: 70, seconds: 150, mood: "ominous" }), makeMusicTrack({ bpm: 72, seconds: 150, mood: "sad" })];
  const picksDoc: PicksDoc = {
    schemaVersion: 1, plansHash: base.layout.plansHash, picks, clips, portraits: [{ personId: "P1", assetId: portraits[0]! }, { personId: "P2", assetId: portraits[1]! }],
    orphans: [], updatedAt: TEST_NOW,
  };
  const clipWords = clipSeg ? { [clipSeg.id]: "It is all a fever , and fevers break . Nobody knew what a bulb was worth . Only what the next man would pay .".split(" ").filter((w) => w !== "," && w !== ".").map((w, k) => ({ text: k === 4 || k === 11 ? `${w}.` : w, startMs: 2100 + k * 420, endMs: 2100 + k * 420 + 360, confidence: 0.9 })) } : {};
  const built = buildInputs({
    script, plans: plansDoc, slices: slicesDoc, take: base.take, clips, frozen, fps: o.fps ?? 30, outline, facts,
    over: { sfx, music, clipWords },
  });
  built.input.picks = picksDoc;
  (built.input as typeof built.input & { outline?: unknown }).outline = outline;
  return { ...built, clipSegment: clipSeg?.id ?? null };
}

/** Merges consecutive narration beats of a segment pairwise (exact contiguous slices stay exact). Ids are renumbered per chapter. */
function mergeBeats(plans: BeatPlan[], texts: BeatLang[]): { plans: BeatPlan[]; texts: BeatLang[] } {
  const textOf = new Map(texts.map((t) => [t.beatId, t]));
  const outP: BeatPlan[] = [];
  const outT: BeatLang[] = [];
  const seq = new Map<string, number>();
  let order = 0;
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i]!;
    const t = textOf.get(p.id)!;
    if (p.id.endsWith("-CLIP") || p.id.endsWith("-BR")) { outP.push({ ...p, order: order++ }); outT.push(t); continue; }
    const q = plans[i + 1];
    const canMerge = q && !q.id.endsWith("-CLIP") && !q.id.endsWith("-BR") && q.segmentId === p.segmentId;
    const n = (seq.get(p.chapterId) ?? 0) + 1;
    seq.set(p.chapterId, n);
    const id = `${p.chapterId}-B${String(n).padStart(3, "0")}`;
    const text = canMerge ? `${t.text} ${textOf.get(q!.id)!.text}` : t.text;
    outP.push({ ...p, id, order: order++, cueTags: [], estSeconds: p.estSeconds + (canMerge ? q!.estSeconds : 0) });
    outT.push({ ...t, beatId: id, text, cueAnchorIdx: [], emphasisIdx: [] });
    if (canMerge) i++;
  }
  return { plans: outP, texts: outT };
}
