// resolveAssets offline on a factory beat set (§16.1): procedural fallback, user pick wins, orphans, never writes user-picks.
import { existsSync, readdirSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CandidatesDoc, FrozenDoc, Ledger, P, PicksDoc } from "@docmaker/core";
import type { AssetPick, FrozenAsset, Project, UserPicksDoc } from "@docmaker/core";
import { makeBeats, makeFactSheet, makeFrozen, makeProject, makeScript, TEST_STYLE } from "@docmaker/core/testing";
import { buildCredits, resolveAssets, type AssetsStageInput, type AssetsStageOutput } from "../src/index";
import { cleanup, makeCtx, tmpDir } from "./helpers";

const ctx = makeCtx();
const projectDir = tmpDir("stage");
const script = makeScript({ chapters: 1, segmentsPerChapter: 2, withClip: true });
const { plans, slices } = makeBeats(script);
const facts = makeFactSheet();
const project: Project = makeProject();
project.assets = { ...project.assets, offline: true };
const emptyUser: UserPicksDoc = { schemaVersion: 1, picks: [], portraits: [], clips: [] };
const input = (o?: Partial<AssetsStageInput>): AssetsStageInput => ({
  project, plans, facts, entities: { schemaVersion: 1, entities: [] }, style: TEST_STYLE, primaryScript: script, userPicks: emptyUser,
  previous: { picks: null, frozen: null, ledger: null }, projectDir, reranker: null, personAcks: [], ...o,
});

let first: AssetsStageOutput;
beforeAll(async () => {
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(projectDir, P.project), JSON.stringify(project));
  first = await resolveAssets(input(), ctx);
}, 300_000);
afterAll(() => cleanup(projectDir, ctx.config.paths.home));

describe("resolveAssets (offline)", () => {
  it("returns schema-valid documents", () => {
    expect(() => PicksDoc.parse(first.picks)).not.toThrow();
    expect(() => FrozenDoc.parse(first.frozen)).not.toThrow();
    expect(() => Ledger.parse(first.ledger)).not.toThrow();
    for (const c of first.candidates) expect(() => CandidatesDoc.parse(c)).not.toThrow();
  });

  it("gives every photo/video beat procedural picks with media on disk; graphics and clip beats get none", () => {
    for (const plan of plans.plans) {
      const picks = first.picks.picks.filter((p) => p.beatId === plan.id);
      const graphics = ["motion_graphic", "text_card", "social_post", "document_screenshot", "map"].includes(plan.visualKind) && plan.motionTemplate !== "none";
      if (plan.visualKind === "youtube_clip" || graphics) {
        expect(picks, plan.id).toEqual([]);
        continue;
      }
      expect(picks.length, plan.id).toBeGreaterThan(0);
      expect(picks.map((p) => p.slot)).toEqual(picks.map((_, k) => k));
      for (const p of picks) {
        const a = first.frozen.assets[p.assetId]!;
        expect(a, p.assetId).toBeDefined();
        expect(a.candidate?.provider).toBe("procedural");
        expect(a.conform.recipe).toMatch(/^proc-(image|video)-v1$/);
        expect(existsSync(path.join(projectDir, a.projectRel))).toBe(true);
        expect(p.planKey).toBe(plan.planKey);
        expect(p.pickedBy).toBe("auto");
        if (a.kind === "video") {
          expect(p.sourceInMs).toBe(a.conform.handleHeadMs);
          expect(a.conform.handleHeadMs).toBeGreaterThan(0);
        }
      }
    }
    expect(first.candidates.map((c) => c.beatId).sort()).toEqual(plans.plans.filter((p) => p.visualKind !== "youtube_clip").map((p) => p.id).sort());
  });

  it("marks clips skipped-offline and writes no clip words", () => {
    const clipSegs = script.chapters.flatMap((c) => c.segments).filter((s) => s.type === "clip");
    expect(clipSegs.length).toBeGreaterThan(0);
    expect(first.picks.clips.map((c) => [c.segmentId, c.status])).toEqual(clipSegs.map((s) => [s.id, "skipped-offline"]));
    expect(first.clipWords).toEqual([]);
  });

  it("has a ledger entry per frozen asset (PROCEDURAL, provider procedural)", () => {
    expect(first.ledger.entries.map((e) => e.assetId).sort()).toEqual(Object.keys(first.frozen.assets).sort());
    for (const e of first.ledger.entries) {
      expect(e.provider).toBe("procedural");
      expect(e.license.code).toBe("PROCEDURAL");
      expect(e.attributionText).not.toBe("");
    }
  });

  it("never writes user-picks.json or usage", () => {
    expect(existsSync(path.join(projectDir, P.userPicks))).toBe(false);
    expect(existsSync(path.join(projectDir, "timeline"))).toBe(false);
    expect(readdirSync(projectDir).sort()).toEqual(["media", "project.json"]);
  });

  it("is idempotent: a re-run keeps the same picks without new work", async () => {
    const again = await resolveAssets(input({ previous: { picks: first.picks, frozen: first.frozen, ledger: first.ledger } }), ctx);
    expect(again.picks.picks).toEqual(first.picks.picks);
    expect(Object.keys(again.frozen.assets).sort()).toEqual(Object.keys(first.frozen.assets).sort());
  }, 120_000);

  it("is deterministic: a fresh run picks the same asset ids", async () => {
    const dir2 = tmpDir("stage2");
    const fresh = await resolveAssets(input({ projectDir: dir2 }), ctx);
    expect(fresh.picks.picks.map((p) => [p.beatId, p.slot, p.assetId])).toEqual(first.picks.picks.map((p) => [p.beatId, p.slot, p.assetId]));
    cleanup(dir2);
  }, 300_000);

  it("user picks win per (beatId, slot) when the planKey matches; mismatches and invalid picks become orphans", async () => {
    const photoBeats = plans.plans.filter((p) => first.picks.picks.some((x) => x.beatId === p.id));
    const target = photoBeats[0]!;
    const other = photoBeats[1]!;
    const otherAsset = first.picks.picks.find((p) => p.beatId === other.id)!.assetId;
    const base = first.picks.picks.find((p) => p.beatId === target.id && p.slot === 0)!;
    const win: AssetPick = { ...base, assetId: otherAsset, pickedBy: "user" };
    const stale: AssetPick = { ...base, slot: 1, pickedBy: "user", planKey: "0123456789abcdef" };
    const unknownAsset: AssetPick = { ...base, slot: 2, pickedBy: "user", assetId: "f".repeat(64) };
    const userPicks: UserPicksDoc = { schemaVersion: 1, picks: [win, stale, unknownAsset], portraits: [], clips: [] };
    const out = await resolveAssets(input({ userPicks, previous: { picks: first.picks, frozen: first.frozen, ledger: first.ledger } }), ctx);
    const slot0 = out.picks.picks.find((p) => p.beatId === target.id && p.slot === 0)!;
    expect(slot0.pickedBy).toBe("user");
    expect(slot0.assetId).toBe(otherAsset);
    expect(out.picks.orphans).toEqual([stale, unknownAsset]);
    expect(existsSync(path.join(projectDir, P.userPicks))).toBe(false);
  }, 120_000);

  it("user portraits go through validatePick as identity slots: an AI image never becomes a real person's portrait", async () => {
    const [aiBase, okBase] = Object.values(makeFrozen({ images: 2, videos: 0 }));
    const ai: FrozenAsset = { ...aiBase!, role: "user", declaration: { kind: "ai-generated", license: null, author: "me", url: "", note: "" } };
    const own: FrozenAsset = { ...okBase!, role: "user", declaration: { kind: "own-work", license: null, author: "me", url: "", note: "" } };
    const prevFrozen = { ...first.frozen, assets: { ...first.frozen.assets, [ai.id]: ai, [own.id]: own } };
    const userPicks: UserPicksDoc = { schemaVersion: 1, picks: [], portraits: [{ personId: "P1", assetId: ai.id }, { personId: "P2", assetId: own.id }], clips: [] };
    const out = await resolveAssets(input({ userPicks, previous: { picks: first.picks, frozen: prevFrozen, ledger: first.ledger } }), ctx);
    expect(out.picks.portraits.find((p) => p.personId === "P1")?.assetId).not.toBe(ai.id);
    expect(out.picks.portraits).toContainEqual({ personId: "P2", assetId: own.id });
  }, 120_000);

  it("builds credits joined with usage", () => {
    const used = first.picks.picks.slice(0, 2).map((p) => p.assetId);
    const md = buildCredits({ ledger: first.ledger, usage: { schemaVersion: 1, lang: "en", usage: used.map((assetId) => ({ assetId, itemIds: ["v1"] })) }, lang: "en", voice: null, music: { schemaVersion: 1, tracks: [] }, sfx: [] });
    expect(md).toMatch(/^# Credits/);
    expect(md).toContain("Procedural visuals");
    expect(md).toContain("YouTube description");
    expect(slices.texts.length).toBeGreaterThan(0);
  });
});
