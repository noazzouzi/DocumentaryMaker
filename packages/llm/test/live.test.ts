// Live Anthropic smoke test (paid, network): skipped unless DOCMAKER_LIVE_TESTS=1 and ANTHROPIC_API_KEY are set.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLlmClient, suggestStyle } from "../src/index";
import { makeCtx, silentLogger } from "./helpers";

const live = process.env.DOCMAKER_LIVE_TESTS === "1" && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!live)("live Claude call", () => {
  it("suggestStyle (idea stage, low effort) returns a valid suggestion and records a receipt", async () => {
    const llm = createLlmClient({ provider: "anthropic", fixtureDir: null, rawDir: mkdtempSync(join(tmpdir(), "llm-live-")), refusalFallback: true, logger: silentLogger, apiKey: process.env.ANTHROPIC_API_KEY ?? null });
    const ctx = makeCtx(llm);
    const s = await suggestStyle(ctx, {
      idea: "Tulip mania: how a flower became the first famous bubble", factSummary: null, stage: "idea",
      styles: [{ id: "drama-commentary", names: { en: "Drama / commentary", fr: "Drama / commentaire" }, description: { en: "Punchy downfall storytelling", fr: "" }, bestFor: ["history", "company_collapse"] }],
    });
    expect(s.recommendedStyleId).toBe("drama-commentary");
    expect(ctx.costs.receipts).toHaveLength(1);
    expect(ctx.costs.receipts[0]!.costUsd).toBeGreaterThan(0);
  }, 120_000);
});
