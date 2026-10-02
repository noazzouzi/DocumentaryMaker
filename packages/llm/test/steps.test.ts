// Step functions against a scripted LLM: outline repair, revise, transcreate, reranker, passage pick, prompts.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DocmakerError, type Candidate } from "@docmaker/core";
import { TEST_STYLE, makeFactSheet, makeScript } from "@docmaker/core/testing";
import {
  buildSystem, makeReranker, motionFormats, pickPassage, planBudget, readFixtureFile, reviseChapter, segmentSkeleton, suggestStyle, transcreateSegment,
  writeOutline, buildOutlineWire, type LlmClient, type StructuredRequest,
} from "../src/index";
import { TEST_PLUGIN, fixtureDir, makeCtx } from "./helpers";


class ScriptedLlm implements LlmClient {
  readonly kind = "anthropic" as const;
  calls: StructuredRequest<z.ZodType>[] = [];
  constructor(private readonly responses: Record<string, unknown>) {}
  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
    this.calls.push(req);
    const k = `${req.step}.${req.key}`;
    if (!(k in this.responses)) throw new DocmakerError("FIXTURE_MISSING", k);
    return req.schema.parse(this.responses[k]);
  }
  async research(): Promise<never> {
    throw new DocmakerError("FIXTURE_MISSING", "research");
  }
}

const FS = makeFactSheet();
const acts = TEST_STYLE.scriptProfile.storyShapes[0]!.acts.map((a) => a.id);
const tulipOutline = readFixtureFile(fixtureDir("tulip-mania"), "outline", "", buildOutlineWire(acts));

describe("writeOutline", () => {
  const budget = planBudget(1.5, "en", TEST_STYLE.scriptProfile, "rise-fall");
  it("puts the budget and shape in the user turn and the cached fact sheet in the system prompt", async () => {
    const llm = new ScriptedLlm({ "outline.": tulipOutline });
    const o = await writeOutline(makeCtx(llm), { factSheet: FS, style: TEST_PLUGIN, budget, budgets: { en: budget }, shapeId: "rise-fall", lang: "en", riskFlags: [] });
    expect(o.chapters).toHaveLength(3);
    const req = llm.calls[0]!;
    expect([req.effort, req.maxTokens, req.stage]).toEqual(["high", 16000, "outline"]);
    expect(req.user).toContain('"words":218');
    expect(req.system.map((b) => b.cache)).toEqual([false, true]);
    expect(req.system[1]!.text.startsWith("<fact_sheet>")).toBe(true);
    expect(req.system[0]!.text).toContain("<editorial_rules>");
    expect(req.system[0]!.text).toContain("Dry, precise, ironic.");
  });
  it("one repair round when validation fails; the better outline wins", async () => {
    const bad = { ...tulipOutline, chapters: tulipOutline.chapters.map((c) => ({ ...c, target_words: c.target_words * 3 })) };
    const llm = new ScriptedLlm({ "outline.": bad, "outline.repair": tulipOutline });
    const o = await writeOutline(makeCtx(llm), { factSheet: FS, style: TEST_PLUGIN, budget, budgets: { en: budget }, shapeId: "rise-fall", lang: "en", riskFlags: [] });
    expect(llm.calls.map((c) => c.key)).toEqual(["", "repair"]);
    expect(o.chapters.reduce((a, c) => a + c.targetWords, 0)).toBe(218);
    expect(llm.calls[1]!.user).toContain("outline-words");
  });
});

describe("chapters", () => {
  it("reviseChapter keeps segment ids, userEdited/locked flags and sends only error issues", async () => {
    const script = makeScript({ chapters: 1, segmentsPerChapter: 2 });
    const ch = { ...script.chapters[0]!, userEdited: true };
    const wire = { chapter_id: "CH1", title: "T", video_title: "", loops_opened: [], loops_closed: [], summary_for_next: "",
      segments: ch.segments.map((s, k) => ({ id: `x${k}`, type: s.type, text: `${s.displayText} Fixed.`, quote_id: "", fact_ids: s.factIds, device: s.device, subtitle_translation: "" })) };
    const llm = new ScriptedLlm({ "revise.en.CH1": wire });
    const outline = { ...(await writeOutline(makeCtx(new ScriptedLlm({ "outline.": tulipOutline })), { factSheet: FS, style: TEST_PLUGIN, budget: planBudget(1.5, "en", TEST_STYLE.scriptProfile, "rise-fall"), budgets: {}, shapeId: "rise-fall", lang: "en", riskFlags: [] })) };
    const out = await reviseChapter(makeCtx(llm), {
      lang: "en", primaryLang: "en", outline, plan: outline.chapters[0]!, factSheet: FS, style: TEST_PLUGIN, storySoFar: [], previousTail: [], skeleton: null,
      targetWords: 50, riskFlags: [], chapter: ch, issues: [{ level: "error", rule: "number-without-fact", where: "CH1-S01", msg: "m" }, { level: "warn", rule: "sentence-length", where: "CH1", msg: "w" }],
    });
    expect(out.segments.map((s) => s.id)).toEqual(ch.segments.map((s) => s.id));
    expect(out.userEdited).toBe(true);
    expect(llm.calls[0]!.user).toContain("number-without-fact");
    expect(llm.calls[0]!.user).not.toContain("sentence-length");
  });
  it("segmentSkeleton carries primaryHash for the secondary language", () => {
    const sk = segmentSkeleton(makeScript({ chapters: 1 }).chapters[0]!);
    expect(sk[0]).toMatchObject({ id: "CH1-S01", type: "narration" });
    expect(sk[0]!.primaryHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("transcreateSegment: FR typography on narration; clips keep the verbatim", async () => {
    const script = makeScript({ chapters: 2, withClip: true });
    const narr = script.chapters[0]!.segments[0]!;
    const clip = script.chapters[1]!.segments.find((s) => s.type === "clip")!;
    const llm = new ScriptedLlm({
      [`transcreate.fr.${narr.id}`]: { display_text: "Il l'a dit : stop", subtitle_translation: "ignored" },
      [`transcreate.fr.${clip.id}`]: { display_text: "Une paraphrase", subtitle_translation: "« C’est une fièvre. »" },
    });
    const a = await transcreateSegment(makeCtx(llm), { primary: narr, current: narr, lang: "fr", style: TEST_PLUGIN, factSheet: FS });
    expect(a).toEqual({ displayText: "Il l’a dit : stop", subtitleTranslation: "" });
    const b = await transcreateSegment(makeCtx(llm), { primary: clip, current: clip, lang: "fr", style: TEST_PLUGIN, factSheet: FS });
    expect(b).toEqual({ displayText: clip.displayText, subtitleTranslation: "« C’est une fièvre. »" });
    expect(llm.calls[0]!.effort).toBe("low");
  });
});

describe("style suggestion", () => {
  it("idea stage: low effort, 2000 tokens, source llm", async () => {
    const llm = new ScriptedLlm({ "style.": readFixtureFile(fixtureDir("tulip-mania"), "style", "", z.unknown()) });
    const s = await suggestStyle(makeCtx(llm), { idea: "tulips", styles: [{ id: "drama-commentary", names: { en: "D", fr: "D" }, description: { en: "", fr: "" }, bestFor: [] }], factSummary: null, stage: "idea" });
    expect([s.stage, s.source]).toEqual(["idea", "llm"]);
    expect([llm.calls[0]!.effort, llm.calls[0]!.maxTokens]).toEqual(["low", 2000]);
  });
});

describe("reranker and passage", () => {
  const dir = mkdtempSync(join(tmpdir(), "llm-thumbs-"));
  const thumbs = Array.from({ length: 11 }, (_, i) => {
    const p = join(dir, `t${i}.jpg`);
    writeFileSync(p, Buffer.from([0xff, 0xd8, 0xff, i]));
    return p;
  });
  const cand = (i: number) => ({ providerAssetId: `id${i}` }) as unknown as Candidate;
  it("batches ≤ 9 images labelled 'Image N:', maps scores back to candidate order, skips missing thumbnails", async () => {
    const img = (index: number, relevance: number) => ({ index, relevance, technical_quality: 7, has_watermark_or_burned_text: false, nsfw: false, focal_x: 0.5, focal_y: 0.4, crop_x: 0, crop_y: 0, crop_w: 1, crop_h: 0.9, notes: "" });
    const llm = new ScriptedLlm({
      "rerank.CH1-B001.0": { images: Array.from({ length: 9 }, (_, k) => img(k + 1, k)) },
      "rerank.CH1-B001.1": { images: [img(1, 10)] },
    });
    const { signal, costs, logger, newRequest } = makeCtx(llm);
    const rr = makeReranker({ llm, signal, costs, logger, newRequest });
    const paths = [...thumbs.slice(0, 10), "/nope/missing.webp", thumbs[10]!.replace(".jpg", ".bmp")];
    const out = await rr.rerank({ beatId: "CH1-B001", visualQuery: "tulip", narration: "x", visualKind: "archival_photo", identityHint: "" }, paths.map((_, i) => cand(i)), paths, signal);
    expect(out.scores).toHaveLength(12);
    expect(out.scores[3]!.vision).toBeCloseTo(0.3);
    expect(out.scores[9]!.vision).toBe(1);
    expect(out.scores[10]!.notes).toBe("thumbnail unreadable");
    expect(out.scores[11]!.notes).toBe("no thumbnail");
    const first = llm.calls[0]!.user as { type: string; text?: string }[];
    expect(first.filter((b) => b.type === "image")).toHaveLength(9);
    expect(first[0]).toEqual({ type: "text", text: "Image 1:" });
    expect(String(first.at(-1)!.text)).toContain("Do NOT identify people");
  });
  it("pickPassage: trivial cases need no call; otherwise maps the chosen window", async () => {
    const llm = new ScriptedLlm({});
    const ctx = makeCtx(llm);
    expect(await pickPassage(ctx, { verbatim: "q", windows: [] })).toEqual({ bestIndex: -1, confidence: 0 });
    expect(await pickPassage(ctx, { verbatim: "q", windows: [{ index: 4, text: "q", startMs: 0, endMs: 1 }] })).toEqual({ bestIndex: 4, confidence: 0.5 });
    expect(llm.calls).toHaveLength(0);
  });
});

describe("prompts", () => {
  it("system prompt: safe-messaging addendum under suicide_self_harm; the last block is cached", () => {
    const s = buildSystem({ style: TEST_PLUGIN, lang: "fr", asOf: "2026-10-02", riskFlags: ["suicide_self_harm"], factSheet: FS });
    expect(s[0]!.text).toContain("<safe_messaging>");
    expect(s[0]!.text).toContain("conditionnel journalistique");
    expect(s.at(-1)!.cache).toBe(true);
    expect(buildSystem({ style: TEST_PLUGIN, lang: "en", asOf: "2026-10-02", riskFlags: [] })[0]!.text).not.toContain("<safe_messaging>");
  });
  it("motion formats list every template with its fields", () => {
    const f = motionFormats();
    expect(f).toContain("money_counter {figure_id:string, value:number, from?:number");
    expect(f.split("\n")).toHaveLength(16);
  });
});
