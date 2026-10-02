import { describe, expect, it } from "vitest";
import { StyleSuggestion, type StylePlugin } from "@docmaker/core";
import { TEST_STYLE } from "@docmaker/core/testing";
import { classifyTopicOffline, createRegistry, discoverStyles, foldTokens, riskFlagsOffline, suggestStyleOffline } from "../src/index";
import { REPO_ROOT } from "./helpers";

const registry = await discoverStyles({ repoRoot: REPO_ROOT, userStylesDir: null });

/** A registry with a synthetic competitor so ranking is exercised even with one built-in style. */
function withCompetitor(): ReturnType<typeof createRegistry> {
  const drama = registry.get("drama-commentary");
  const essay: StylePlugin = {
    ...drama,
    dir: "/virtual/quiet-essay",
    dataHash: "0".repeat(64),
    data: {
      ...TEST_STYLE,
      manifest: {
        ...TEST_STYLE.manifest, id: "quiet-essay", category: "essay",
        uses: ["history", "essay", "war", "empire", "histoire", "guerre", "philosophie"], bestFor: ["history", "explainer", "other"],
      },
    },
  };
  return createRegistry([drama, essay]);
}

describe("foldTokens", () => {
  it("accent-folds, lowercases and splits elisions/hyphens", () => {
    expect(foldTokens("« La Rupture catastrophique » de l'acteur — PROCÈS-éclair !")).toEqual(["la", "rupture", "catastrophique", "de", "l", "acteur", "proces", "eclair"]);
  });
});

describe("classifyTopicOffline", () => {
  const cases: [string, string][] = [
    ["La rupture catastrophique de Johnny Depp", "person_downfall"],
    ["The fall of FTX", "person_downfall"],
    ["The rise and fall of a tech empire", "person_downfall"],
    ["How a startup went bankrupt in 18 months", "company_collapse"],
    ["La faillite d'une entreprise culte", "company_collapse"],
    ["The unsolved murder that shocked a town", "true_crime"],
    ["L'affaire criminelle qui a divisé la France", "true_crime"],
    ["The biggest YouTuber feud of the year", "internet_drama"],
    ["Le clash entre deux influenceurs", "internet_drama"],
    ["The flat earth conspiracy, debunked", "conspiracy_debunk"],
    ["Tulip mania: the first speculative bubble in history", "history"],
    ["How does inflation work? Explained", "explainer"],
    ["Le scandale des comptes truqués", "scandal_expose"],
    ["Le procès pour agression sexuelle d'un animateur", "scandal_expose"],
    ["How she became a self-made billionaire", "rise_story"],
    ["Pizza recipes for beginners", "other"],
    ["", "other"],
  ];
  it.each(cases)("%s → %s", (idea, topic) => {
    expect(classifyTopicOffline(idea)).toBe(topic);
  });
  it("is accent- and case-insensitive", () => {
    expect(classifyTopicOffline("LA DÉCHÉANCE D'UNE STAR")).toBe(classifyTopicOffline("la decheance d'une star"));
    expect(classifyTopicOffline("la decheance d'une star")).toBe("person_downfall");
  });
});

describe("riskFlagsOffline", () => {
  it("flags sensitive ideas conservatively and returns ['none'] otherwise", () => {
    expect(riskFlagsOffline("The fall of FTX")).toEqual(["none"]);
    expect(riskFlagsOffline("Le procès pour agression sexuelle d'un animateur")).toEqual(expect.arrayContaining(["sexual_violence", "ongoing_trial", "real_person_allegations"]));
    expect(riskFlagsOffline("A child star's overdose")).toEqual(expect.arrayContaining(["minors", "suicide_self_harm"]));
    expect(riskFlagsOffline("The process of making cheese")).toEqual(["none"]); // "process" ≠ "procès"
  });
});

describe("suggestStyleOffline", () => {
  for (const idea of ["La rupture catastrophique de Johnny Depp", "The fall of FTX"]) {
    it(`ranks drama-commentary first for « ${idea} »`, () => {
      for (const reg of [registry, withCompetitor()]) {
        const s = suggestStyleOffline(idea, reg);
        expect(StyleSuggestion.safeParse(s).success).toBe(true);
        expect(s.recommendedStyleId).toBe("drama-commentary");
        expect(s.ranked[0]!.styleId).toBe("drama-commentary");
        expect(s).toMatchObject({ source: "offline", stage: "idea", schemaVersion: 1, themeOverride: null, topicType: "person_downfall" });
        expect(s.ranked).toHaveLength(reg.list().length);
      }
    });
  }

  it("matches manifest.uses with accents folded and explains why", () => {
    const s = suggestStyleOffline("Le PROCÈS et la polémique : une descente aux enfers", registry);
    const top = s.ranked[0]!;
    expect(top.styleId).toBe("drama-commentary");
    expect(top.why).toContain("proces");
    expect(top.why).toContain("polemique");
    expect(top.why).toContain("descente aux enfers");
    expect(top.score).toBeGreaterThan(suggestStyleOffline("The fall of FTX", registry).ranked[0]!.score);
  });

  it("prefers a better-fitting style when the idea points elsewhere", () => {
    const s = suggestStyleOffline("Une histoire de la guerre de Cent Ans", withCompetitor());
    expect(s.topicType).toBe("history");
    expect(s.recommendedStyleId).toBe("quiet-essay");
    expect(s.ranked.map((r) => r.styleId)).toEqual(["quiet-essay", "drama-commentary"]);
    for (const r of s.ranked) expect(r.score).toBeGreaterThanOrEqual(0), expect(r.score).toBeLessThanOrEqual(1);
  });

  it("is deterministic and fills offline title/thumbnail options from the idea", () => {
    const a = suggestStyleOffline("  la rupture catastrophique de Johnny Depp ", withCompetitor());
    const b = suggestStyleOffline("  la rupture catastrophique de Johnny Depp ", withCompetitor());
    expect(a).toEqual(b);
    expect(a.titleOptions).toEqual(["La rupture catastrophique de Johnny Depp"]);
    expect(a.thumbnailTextOptions).toEqual(["RUPTURE", "CATASTROPHIQUE"]);
    expect(a.recommendedMinutes).toBe(20);
  });

  it("handles an idea with no signal and an empty idea", () => {
    for (const idea of ["Pizza recipes for beginners", ""]) {
      const s = suggestStyleOffline(idea, registry);
      expect(s.topicType).toBe("other");
      expect(s.recommendedStyleId).toBe("drama-commentary");
      expect(s.riskFlags).toEqual(["none"]);
      expect(s.thumbnailTextOptions).toEqual([]);
    }
    expect(suggestStyleOffline("", registry).titleOptions).toEqual([]);
  });

  it("throws VALIDATION on an empty registry", () => {
    expect(() => suggestStyleOffline("x", createRegistry([]))).toThrowError(/no styles/);
  });
});
