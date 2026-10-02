// Steps 7 (vision rerank) and 8 (passage pick) for @docmaker/assets (injected; assets never calls Claude directly).
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { sha8, type Candidate, type CandidateScore, type Receipt, type RerankInput, type Reranker } from "@docmaker/core";
import { PASSAGE_USER, RERANK_USER } from "../prompts/steps";
import { json } from "../prompts/system";
import type { StepCtx } from "../types";
import { passageFromWire, rerankFromWire } from "../wire/map";
import { PassageWire, RerankWire } from "../wire/schemas";
import { STEP_STAGE, call } from "./common";

type Score = Pick<CandidateScore, "vision" | "technical" | "watermark" | "nsfw" | "focal" | "safeCrop" | "notes">;
const EMPTY = (notes: string): Score => ({ vision: null, technical: null, watermark: null, nsfw: null, focal: null, safeCrop: null, notes });
const MEDIA: Record<string, "image/jpeg" | "image/png" | "image/webp" | "image/gif"> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
};
const BATCH = 9;

export function makeReranker(ctx: Omit<StepCtx, "progress">): Reranker {
  return {
    async rerank(input: RerankInput, candidates: Candidate[], thumbPaths: string[], signal: AbortSignal) {
      const scores: Score[] = candidates.map(() => EMPTY("not scored"));
      let receipt: Receipt | null = null;
      for (let start = 0; start < candidates.length; start += BATCH) {
        const slots: number[] = [];
        const content: Anthropic.Beta.BetaContentBlockParam[] = [];
        for (let k = start; k < Math.min(candidates.length, start + BATCH); k++) {
          const path = thumbPaths[k];
          const media = path ? MEDIA[extname(path).toLowerCase()] : undefined;
          if (!path || !media) {
            scores[k] = EMPTY("no thumbnail");
            continue;
          }
          let data: string;
          try {
            data = (await readFile(path)).toString("base64");
          } catch {
            scores[k] = EMPTY("thumbnail unreadable");
            continue;
          }
          slots.push(k);
          content.push({ type: "text", text: `Image ${slots.length}:` }, { type: "image", source: { type: "base64", media_type: media, data } });
        }
        if (slots.length === 0) continue;
        content.push({ type: "text", text: RERANK_USER({ text: input.narration, visualQuery: input.visualQuery, visualKind: input.visualKind, identityHint: input.identityHint }) });
        const wire = await ctx.llm.structured(
          {
            step: "rerank", key: `${input.beatId}.${start / BATCH}`, schema: RerankWire, effort: "low", maxTokens: 2000, stage: STEP_STAGE.rerank, lang: null,
            system: [{ text: "You are the photo editor of a documentary channel. You never identify people from their faces; you judge relevance to the wanted visual and technical quality only.", cache: true }],
            user: content,
          },
          { signal, costs: ctx.costs, newRequest: ctx.newRequest, onReceipt: (r) => { receipt = r; } },
        );
        rerankFromWire(wire, slots.length).forEach((s, j) => {
          const k = slots[j]!;
          scores[k] = s ? { vision: s.vision, technical: s.technical, watermark: s.watermark, nsfw: s.nsfw, focal: s.focal, safeCrop: s.safeCrop, notes: s.notes } : EMPTY("not returned by the model");
        });
      }
      return { scores, receipt };
    },
  };
}

/** Optional tie-break between the top deterministic transcript windows (assets only calls it when they are within 0.05). */
export async function pickPassage(ctx: StepCtx, i: { verbatim: string; windows: { index: number; text: string; startMs: number; endMs: number }[] }): Promise<{ bestIndex: number; confidence: number }> {
  if (i.windows.length === 0) return { bestIndex: -1, confidence: 0 };
  if (i.windows.length === 1) return { bestIndex: i.windows[0]!.index, confidence: 0.5 };
  const wire = await call(ctx, {
    step: "passage", key: sha8(`${i.verbatim}|${i.windows.map((w) => `${w.index}:${w.startMs}`).join(",")}`), schema: PassageWire, effort: "low", maxTokens: 1000, lang: null,
    system: [{ text: "You match quotes to speech-recognition transcripts of interviews and news clips.", cache: false }],
    user: PASSAGE_USER(i.verbatim, json(i.windows.map((w) => ({ index: w.index, text: w.text, start_ms: w.startMs, end_ms: w.endMs })))),
  });
  return passageFromWire(wire, i.windows.map((w) => w.index));
}
