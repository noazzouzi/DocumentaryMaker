// Live checks against the real keyless APIs. Skipped unless DOCMAKER_LIVE_TESTS=1 (tests must pass offline).
import { describe, expect, it } from "vitest";
import { isDocmakerError } from "@docmaker/core";
import type { AssetQuery, ProviderContext } from "@docmaker/core";
import { conformImage, createHttpClient, providerById, resolveEntity } from "../src/index";
import { cleanup, makeConfig, makeCtx, quietLogger, tmpDir } from "./helpers";

const live = process.env.DOCMAKER_LIVE_TESTS === "1";
const config = makeConfig({ offline: false, contact: process.env.DOCMAKER_CONTACT ?? null });
const http = createHttpClient({ config, logger: quietLogger() });
const ctx: ProviderContext = { http, config, secrets: {}, logger: quietLogger(), signal: AbortSignal.timeout(60_000) };
const q = (o: Partial<AssetQuery>): AssetQuery => ({
  beatId: null, kind: "image", role: "archival", text: "tulip", localText: null, entityQid: null, personIds: [], orientation: "landscape",
  minWidth: 960, durationSec: null, limit: 5, lang: null, ...o,
});

describe.skipIf(!live)("live keyless providers", () => {
  it("Wikidata resolves a public figure", async () => {
    const r = await resolveEntity("Carolus Clusius", "en", { http, signal: ctx.signal });
    expect(r?.qid).toMatch(/^Q\d+$/);
  }, 60_000);
  it.each(["wikimedia", "openverse", "loc", "nasa", "internet-archive"] as const)("%s returns licensed candidates", async (id) => {
    const rs = await providerById(id).search(q({ text: id === "nasa" ? "apollo 11" : "tulip field", kind: id === "internet-archive" ? "video" : "image" }), ctx);
    expect(rs.length).toBeGreaterThan(0);
    expect(rs[0]!.candidate.license.code).toBeTruthy();
  }, 120_000);
  it("downloads and conforms a real Commons original", async (t) => {
    const rs = await providerById("wikimedia").search(q({ text: "tulip field Netherlands" }), ctx);
    const dir = tmpDir("live");
    try {
      const orig = await providerById("wikimedia").fetchOriginal(rs[0]!.candidate, dir, ctx).catch((e: unknown) => {
        // Wikimedia throttles datacenter IPs hard (HTTP 429 with a long Retry-After): not a code defect.
        if (isDocmakerError(e) && e.code === "PROVIDER_RATE_LIMIT") t.skip();
        throw e;
      });
      const c = await conformImage(orig.path, dir, { ...makeCtx({ config, http }), signal: ctx.signal });
      expect(c.width).toBeLessThanOrEqual(2880);
      expect(c.analysis.meanLuma).not.toBeNull();
    } finally {
      cleanup(dir);
    }
  }, 180_000);
});
