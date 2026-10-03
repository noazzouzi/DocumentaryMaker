import { describe, expect, it } from "vitest";
import { LicensePolicy } from "@docmaker/core";
import type { AssetPick, BeatPlan, FrozenAsset, LicenseCode, Project } from "@docmaker/core";
import { makeBeats, makeFactSheet, makeFrozen, makeScript } from "@docmaker/core/testing";
import {
  buildAiDenylist, checkFalPrompt, declarationLicense, falAllowedForBeat, falPrompt, licenseInfo, LicensePolicyEngine, parseCcLicense, validatePick,
} from "../src/index";

const POLICY = LicensePolicy.parse({});
const EDITORIAL: Project["editorial"] = { asOf: "2026-10-02", monetized: true, fairUseAcknowledged: false };

describe("parseCcLicense", () => {
  it.each([
    ["by", "2.0", "CC-BY", "2.0"], ["by-sa", "4.0", "CC-BY-SA", "4.0"], ["cc0", null, "CC0", "1.0"], ["pdm", null, "PDM", null],
    ["by-nc-nd", "3.0", "CC-BY-NC-ND", "3.0"], ["CC BY-SA 3.0", null, "CC-BY-SA", "3.0"], ["Public domain", null, "PDM", null],
    ["CC0", null, "CC0", "1.0"], ["https://creativecommons.org/licenses/by-nc/2.0/", null, "CC-BY-NC", "2.0"],
    ["http://creativecommons.org/publicdomain/mark/1.0/", null, "PDM", "1.0"], ["http://creativecommons.org/licenses/publicdomain/", null, "PDM", null],
    ["https://creativecommons.org/publicdomain/zero/1.0/", null, "CC0", "1.0"], ["CC BY 4.0", null, "CC-BY", "4.0"], ["by-nc-sa", "2.5", "CC-BY-NC-SA", "2.5"],
    ["CC-BY-SA-3.0", null, "CC-BY-SA", "3.0"], ["CC BY-SA 3.0 DE", null, "CC-BY-SA", "3.0"], ["cc_by_nc_4.0", null, "CC-BY-NC", "4.0"],
  ])("%s → %s", (raw, v, code, version) => {
    expect(parseCcLicense(raw, v)).toEqual({ code, version });
  });
  it("returns null for unknown strings", () => {
    expect(parseCcLicense("GFDL")).toBeNull();
    expect(parseCcLicense("")).toBeNull();
    expect(parseCcLicense("All rights reserved")).toBeNull();
  });
  it("free text starting with \"by\" is not a CC licence", () => {
    for (const raw of ["by permission of the author", "byline", "bysa", "By courtesy of the museum", "by-sa-x", "cc by sa permission"]) expect(parseCcLicense(raw)).toBeNull();
  });
  it("derives flags", () => {
    const nc = licenseInfo("CC-BY-NC-SA", { version: "4.0" });
    expect(nc).toMatchObject({ commercialOk: false, derivativesOk: true, attributionRequired: true });
    expect(nc.restrictions).toEqual(expect.arrayContaining(["nc", "sa"]));
    expect(nc.url).toBe("https://creativecommons.org/licenses/by-nc-sa/4.0/");
    expect(licenseInfo("PEXELS").restrictions).toEqual(expect.arrayContaining(["no-bad-light", "trademark", "no-redistribution"]));
    expect(licenseInfo("UNKNOWN").restrictions).toEqual(expect.arrayContaining(["unknown-rights", "editorial-only"]));
  });
});

describe("LicensePolicyEngine (§7.4 matrix)", () => {
  const m = new LicensePolicyEngine(POLICY, { monetized: true, fairUseAcknowledged: false });
  const personal = new LicensePolicyEngine({ ...POLICY, mode: "personal" }, { monetized: false, fairUseAcknowledged: true });
  const ev = (e: LicensePolicyEngine, code: LicenseCode, people: string[] = []) => e.evaluate(licenseInfo(code), { personIds: people, cueTypes: [] });
  it.each<[LicenseCode, boolean, boolean]>([
    ["CC0", true, true], ["PDM", true, true], ["PROCEDURAL", true, true], ["USER-OWNED", true, true], ["CC-BY", true, true],
    ["CC-BY-SA", true, true], ["CC-BY-NC", false, true], ["CC-BY-ND", false, false], ["CC-BY-NC-ND", false, false], ["CC-BY-NC-SA", false, true],
    ["PEXELS", true, true], ["PIXABAY", true, true], ["UNKNOWN", false, false], ["YOUTUBE-FAIR-USE", false, true], ["AI-GENERATED", true, true],
  ])("%s → monetized %s, personal %s", (code, mon, pers) => {
    expect(ev(m, code).allowed).toBe(mon);
    expect(ev(personal, code).allowed).toBe(pers);
  });
  it("flags", () => {
    expect(ev(m, "PEXELS").flags).toContain("no-bad-light");
    expect(ev(m, "CC-BY-SA").flags).toContain("sa");
    expect(ev(m, "UNKNOWN").flags).toContain("editorial-only");
    expect(m.evaluate(licenseInfo("CC-BY-SA", { restrictions: ["personality"] }), null).flags).toContain("personality");
  });
  it("switches", () => {
    const loose = new LicensePolicyEngine({ ...POLICY, allowNonCommercial: true, allowNoDerivatives: true, allowUnknownEditorial: true, allowShareAlike: false }, { monetized: true, fairUseAcknowledged: true });
    expect(ev(loose, "CC-BY-NC").allowed).toBe(true);
    expect(ev(loose, "CC-BY-ND").allowed).toBe(true);
    expect(ev(loose, "UNKNOWN").allowed).toBe(true);
    expect(ev(loose, "CC-BY-SA").allowed).toBe(false);
    expect(ev(loose, "YOUTUBE-FAIR-USE").allowed).toBe(true);
    const noYt = new LicensePolicyEngine({ ...POLICY, allowYoutubeFairUse: false }, { monetized: false, fairUseAcknowledged: true });
    expect(ev(noYt, "YOUTUBE-FAIR-USE").allowed).toBe(false);
  });
  it("AI-generated is never allowed on beats with people", () => {
    expect(ev(m, "AI-GENERATED", ["P1"]).allowed).toBe(false);
    expect(ev(personal, "AI-GENERATED", ["P1"]).allowed).toBe(false);
    expect(new LicensePolicyEngine({ ...POLICY, allowAiGenerated: false }, { monetized: true, fairUseAcknowledged: false }).evaluate(licenseInfo("AI-GENERATED"), null).allowed).toBe(false);
  });
  it("is conservative when editorial and policy disagree", () => {
    const e = new LicensePolicyEngine({ ...POLICY, mode: "monetized" }, { monetized: false, fairUseAcknowledged: false });
    expect(ev(e, "CC-BY-NC").allowed).toBe(false);
  });
});

describe("declarations", () => {
  it("never defaults to USER-OWNED", () => {
    expect(declarationLicense({ kind: "own-work", license: null, author: "Me", url: "", note: "" }).code).toBe("USER-OWNED");
    expect(declarationLicense({ kind: "licensed", license: "CC-BY", author: "A", url: "https://x.org", note: "" }).code).toBe("CC-BY");
    expect(declarationLicense({ kind: "licensed", license: "USER-OWNED", author: "A", url: "", note: "" }).code).toBe("UNKNOWN");
    const q = declarationLicense({ kind: "third-party-quotation", license: null, author: "TV", url: "https://tv.example", note: "" });
    expect(q.code).toBe("UNKNOWN");
    expect(q.restrictions).toEqual(expect.arrayContaining(["editorial-only", "fair-use-user-risk"]));
    const ai = declarationLicense({ kind: "ai-generated", license: null, author: "", url: "", note: "" });
    expect(ai.code).toBe("AI-GENERATED");
    expect(ai.restrictions).toContain("synthetic");
  });
});

// ------------------------------------------------------------------------------------------------ validatePick
function fixture() {
  const facts = makeFactSheet({ people: 3 });
  facts.people[1] = { ...facts.people[1]!, isMinorOrPrivateVictim: true };
  facts.people[2] = { ...facts.people[2]!, publicFigure: false };
  const { plans } = makeBeats(makeScript({ chapters: 1, segmentsPerChapter: 2 }));
  const base = plans.plans.find((p) => p.origin === "llm")!;
  const asset = Object.values(makeFrozen({ images: 1, videos: 0 }))[0]!;
  return { facts, base, asset };
}
const pickOf = (plan: BeatPlan, asset: FrozenAsset): AssetPick => ({
  beatId: plan.id, slot: 0, assetId: asset.id, role: "primary", focal: { x: 0.5, y: 0.45 }, crop: null, sourceInMs: null, sourceOutMs: null,
  score: { metadata: 0.5, clip: null, vision: null, technical: null, watermark: null, nsfw: null, total: 0.5, focal: null, safeCrop: null, notes: "" },
  pickedBy: "user", planKey: plan.planKey,
});
const withCandidate = (a: FrozenAsset, code: LicenseCode, o?: { title?: string; tags?: string[]; provider?: "pexels" | "wikimedia" | "fal" | "brave" | "openverse" }): FrozenAsset => ({
  ...a, candidate: {
    provider: o?.provider ?? "wikimedia", providerAssetId: "x1", kind: "image", title: o?.title ?? "courthouse", description: "", tags: o?.tags ?? [], previewUrl: "",
    downloadUrl: "", width: 1920, height: 1080, durationSec: null, license: licenseInfo(code), author: null, sourcePageUrl: "", retrievedAt: "2026-10-02T00:00:00.000Z", youtube: null,
  },
});
const errors = <T extends { level: string }>(issues: T[]) => issues.filter((x) => x.level === "error");

describe("validatePick", () => {
  it("accepts a clean CC-BY pick", () => {
    const { facts, base, asset } = fixture();
    const a = withCandidate(asset, "CC-BY");
    expect(errors(validatePick({ pick: pickOf(base, a), plan: base, asset: a, policy: POLICY, editorial: EDITORIAL, facts, personAcks: [] }))).toEqual([]);
  });
  it("AI-generated on a person beat → POLICY_DENIED", () => {
    const { facts, base, asset } = fixture();
    const plan = { ...base, personIds: ["P1"] };
    const a = withCandidate(asset, "AI-GENERATED", { provider: "fal" });
    const e = errors(validatePick({ pick: pickOf(plan, a), plan, asset: a, policy: POLICY, editorial: EDITORIAL, facts, personAcks: [] }));
    expect(e.length).toBeGreaterThan(0);
    expect(e.every((x) => x.rule === "POLICY_DENIED")).toBe(true);
  });
  it("AI-generated on a PERSON_INTRO / SENSITIVE beat without people → denied", () => {
    const { facts, base, asset } = fixture();
    for (const type of ["PERSON_INTRO", "SENSITIVE"] as const) {
      const plan = { ...base, cueTags: [{ type, value: "x" }] };
      const a = withCandidate(asset, "AI-GENERATED", { provider: "fal" });
      expect(errors(validatePick({ pick: pickOf(plan, a), plan, asset: a, policy: POLICY, editorial: EDITORIAL, facts, personAcks: [] })).length).toBe(1);
    }
  });
  it("NC under monetized → denied; personal → allowed", () => {
    const { facts, base, asset } = fixture();
    const a = withCandidate(asset, "CC-BY-NC");
    expect(errors(validatePick({ pick: pickOf(base, a), plan: base, asset: a, policy: POLICY, editorial: EDITORIAL, facts, personAcks: [] }))[0]!.msg).toMatch(/non-commercial/);
    expect(errors(validatePick({ pick: pickOf(base, a), plan: base, asset: a, policy: { ...POLICY, mode: "personal" }, editorial: { ...EDITORIAL, monetized: false }, facts, personAcks: [] }))).toEqual([]);
  });
  it("unknown rights → denied unless allowUnknownEditorial (then warned)", () => {
    const { facts, base, asset } = fixture();
    const a = withCandidate(asset, "UNKNOWN", { provider: "brave" });
    expect(errors(validatePick({ pick: pickOf(base, a), plan: base, asset: a, policy: POLICY, editorial: EDITORIAL, facts, personAcks: [] })).length).toBe(1);
    const ok = validatePick({ pick: pickOf(base, a), plan: base, asset: a, policy: { ...POLICY, allowUnknownEditorial: true }, editorial: EDITORIAL, facts, personAcks: [] });
    expect(errors(ok)).toEqual([]);
    expect(ok.some((x) => x.rule === "EDITORIAL_ONLY")).toBe(true);
  });
  it("stock look-alike on a SHOCK beat → denied; landscape stock is fine", () => {
    const { facts, base, asset } = fixture();
    const plan = { ...base, cueTags: [{ type: "SHOCK" as const, value: "" }] };
    const people = withCandidate(asset, "PEXELS", { provider: "pexels", title: "Angry man shouting" });
    expect(errors(validatePick({ pick: pickOf(plan, people), plan, asset: people, policy: POLICY, editorial: EDITORIAL, facts, personAcks: [] })).length).toBe(1);
    const tags = withCandidate(asset, "PIXABAY", { provider: "pexels", title: "street", tags: ["crowd"] });
    expect(errors(validatePick({ pick: pickOf(plan, tags), plan, asset: tags, policy: POLICY, editorial: EDITORIAL, facts, personAcks: [] })).length).toBe(1);
    const field = withCandidate(asset, "PEXELS", { provider: "pexels", title: "Tulip field at dawn" });
    expect(errors(validatePick({ pick: pickOf(plan, field), plan, asset: field, policy: POLICY, editorial: EDITORIAL, facts, personAcks: [] }))).toEqual([]);
    // Archival CC images of people are not "stock look-alikes".
    const cc = withCandidate(asset, "CC-BY", { title: "Portrait of a man" });
    expect(errors(validatePick({ pick: pickOf(plan, cc), plan, asset: cc, policy: POLICY, editorial: EDITORIAL, facts, personAcks: [] }))).toEqual([]);
  });
  it("private person / minor in a portrait slot → denied, whatever the approvals", () => {
    const { facts, base, asset } = fixture();
    const plan = { ...base, visualKind: "archival_photo" as const, personIds: ["P2"] };
    const a = withCandidate(asset, "CC-BY", { title: "photo" });
    expect(errors(validatePick({ pick: pickOf(plan, a), plan, asset: a, policy: POLICY, editorial: EDITORIAL, facts, personAcks: ["P2"] }))[0]!.msg).toMatch(/minor or private/);
  });
  it("non-public person portrait needs person-ack", () => {
    const { facts, base, asset } = fixture();
    const plan = { ...base, visualKind: "archival_photo" as const, personIds: ["P3"] };
    const a = withCandidate(asset, "CC-BY", { title: "photo" });
    expect(errors(validatePick({ pick: pickOf(plan, a), plan, asset: a, policy: POLICY, editorial: EDITORIAL, facts, personAcks: [] }))[0]!.msg).toMatch(/person-ack/);
    expect(errors(validatePick({ pick: pickOf(plan, a), plan, asset: a, policy: POLICY, editorial: EDITORIAL, facts, personAcks: ["P3"] }))).toEqual([]);
  });
  it("procedural assets are always fine (no identity, no licence issue)", () => {
    const { facts, base, asset } = fixture();
    const plan = { ...base, visualKind: "archival_photo" as const, personIds: ["P2"] };
    const proc: FrozenAsset = { ...asset, candidate: null, declaration: null, role: "generated", conform: { ...asset.conform, recipe: "proc-image-v1" } };
    expect(errors(validatePick({ pick: pickOf(plan, proc), plan, asset: proc, policy: POLICY, editorial: EDITORIAL, facts, personAcks: [] }))).toEqual([]);
  });
  it("an undeclared, unsourced asset is UNKNOWN (never USER-OWNED)", () => {
    const { facts, base, asset } = fixture();
    expect(errors(validatePick({ pick: pickOf(base, asset), plan: base, asset, policy: POLICY, editorial: EDITORIAL, facts, personAcks: [] })).length).toBe(1);
  });
  it("replaceSource-style checks without a plan only apply the licence", () => {
    const { facts, base, asset } = fixture();
    const a = withCandidate(asset, "CC-BY-NC");
    expect(errors(validatePick({ pick: pickOf(base, a), plan: null, asset: a, policy: POLICY, editorial: EDITORIAL, facts, personAcks: [] })).length).toBe(1);
  });
});

describe("AI denylist", () => {
  const facts = makeFactSheet({ people: 2, quotes: 1 });
  facts.people[0] = { ...facts.people[0]!, aliases: ["Charles de l'Écluse"] };
  const entities = { schemaVersion: 1 as const, entities: [{ personId: "P2", qid: "Q1" as string | null, label: "Adriaen Pauw", aliases: ["Pauw van Heemstede"], resolvedBy: "wbsearchentities" as const }] };
  const deny = buildAiDenylist(facts, entities);
  it("contains name tokens, aliases and phrases", () => {
    for (const t of ["carolus", "clusius", "carolus clusius", "ecluse", "pauw", "heemstede"]) expect(deny.has(t), t).toBe(true);
    expect(deny.has("de")).toBe(false); // < 3 chars
  });
  it("rejects surnames, aliases and photoreal vocabulary", () => {
    expect(checkFalPrompt("A painting of Clusius in his garden", deny)).toMatchObject({ ok: false });
    expect(checkFalPrompt("garden of l'Écluse at dusk", deny)).toMatchObject({ ok: false });
    expect(checkFalPrompt("photorealistic tulip market", deny)).toMatchObject({ ok: false, reason: expect.stringMatching(/photoreal/) });
    expect(checkFalPrompt("portraits of merchants", deny).ok).toBe(false);
    expect(checkFalPrompt("a real person trading bulbs", deny).ok).toBe(false);
    expect(checkFalPrompt("Dutch tulip market in 1637, crowded tavern, flat colours", deny)).toEqual({ ok: true, reason: null });
    expect(checkFalPrompt(falPrompt("a tulip bulb on a scale"), deny).ok).toBe(true);
  });
  it("disables fal on person and PERSON_INTRO/SENSITIVE beats", () => {
    expect(falAllowedForBeat({ personIds: [], cueTags: [] })).toBe(true);
    expect(falAllowedForBeat({ personIds: ["P1"], cueTags: [] })).toBe(false);
    expect(falAllowedForBeat({ personIds: [], cueTags: [{ type: "SENSITIVE", value: "" }] })).toBe(false);
    expect(falAllowedForBeat({ personIds: [], cueTags: [{ type: "PERSON_INTRO", value: "x" }] })).toBe(false);
  });
});
