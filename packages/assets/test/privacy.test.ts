// Person privacy for outgoing searches (§4.3/§6/§7.3): blocked persons of the WHOLE fact sheet never reach a provider,
// whether or not a beat lists them in personIds (planQueries, resolveAssets, liveSearch).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { P } from "@docmaker/core";
import type { AssetQuery, BeatPlan, FactSheet, Project } from "@docmaker/core";
import { makeBeats, makeFactSheet, makeProject, makeScript, TEST_STYLE } from "@docmaker/core/testing";
import { createHttpClient, liveSearch, planQueries, resolveAssets } from "../src/index";
import { sanitizeLiveQuery } from "../src/live";
import { nameStripper } from "../src/privacy";
import { cleanup, fakeFetch, makeConfig, makeCtx, publicLookup, quietLogger, tmpDir } from "./helpers";

function privacyFacts(): FactSheet {
  const facts = makeFactSheet();
  facts.people.push(
    { id: "P4", name: "Jane Minorly", roleInStory: "a child witness", publicFigure: false, isMinorOrPrivateVictim: true, imageQueries: ["Jane Minorly"], wikidataQid: "Q999001", aliases: ["Janie M."] },
    { id: "P5", name: "Hendrik Quietsma", roleInStory: "a private neighbour", publicFigure: false, isMinorOrPrivateVictim: false, imageQueries: ["Hendrik Quietsma"], wikidataQid: null, aliases: [] },
    // Shares the surname "Pauw" with the public figure P2: the full name goes, the public surname alone stays.
    { id: "P6", name: "Lotte Pauw", roleInStory: "Pauw's young daughter", publicFigure: false, isMinorOrPrivateVictim: true, imageQueries: ["Lotte Pauw"], wikidataQid: null, aliases: [] },
  );
  return facts;
}
const LEAK = /jane|minorly|janie|hendrik|quietsma|lotte/i;
const decoded = (u: string) => decodeURIComponent(u.replace(/\+/g, " "));

describe("nameStripper", () => {
  const facts = privacyFacts();
  it("removes full names, aliases, possessives and lone tokens of blocked persons", () => {
    const s = nameStripper(facts, []);
    expect(s.strip("Jane Minorly crying outside the school")).toBe("crying outside the school");
    expect(s.strip("Minorly's bicycle near Janie M. house")).toBe("bicycle near house");
    expect(s.strip("Hendrik Quietsma garden")).toBe("garden");
    expect(s.strip("Lotte Pauw with Adriaen Pauw")).toBe("with Adriaen Pauw");
    expect(s.mentions("tulip market")).toBe(false);
    expect(s.mentions("the jane street riot")).toBe(true);
  });
  it("names glued to other text by punctuation are removed too", () => {
    const s = nameStripper(facts, []);
    expect(s.strip("Lotte-Pauw portrait")).toBe("portrait");
    expect(s.strip("Lotte/Adriaen")).toBe("Adriaen");
    expect(s.strip("photo of Lotte&Adriaen")).toBe("photo of Adriaen");
    expect(s.mentions("Jane–Minorly")).toBe(true);
    const hy = nameStripper({ people: [{ ...facts.people[0]!, id: "PX", name: "Jean-Pierre Dubois", aliases: [], publicFigure: false, isMinorOrPrivateVictim: false }] }, []);
    expect(hy.strip("Jean Pierre Dubois at home")).toBe("at home");
    expect(hy.strip("Jean-Pierre Dubois at home")).toBe("at home");
  });
  it("a person-ack unblocks a non-public adult, never a minor", () => {
    const s = nameStripper(facts, ["P5", "P4"]);
    expect(s.strip("Hendrik Quietsma and Jane Minorly")).toBe("Hendrik Quietsma and");
  });
});

describe("planQueries strips blocked names from every query, personIds or not", () => {
  const facts = privacyFacts();
  const base = makeBeats(makeScript({ chapters: 1, segmentsPerChapter: 2 })).plans.plans[0]!;
  const kinds: Partial<BeatPlan>[] = [
    { visualKind: "archival_photo" }, { visualKind: "news_footage" }, { visualKind: "stock_broll" }, { visualKind: "document_screenshot" },
    { visualKind: "ai_illustration" }, { visualKind: "map", motionTemplate: "map_route" as BeatPlan["motionTemplate"] },
  ];
  it.each(kinds)("%o", (k) => {
    const plan = { ...base, ...k, personIds: [], visualQuery: "Jane Minorly crying outside the school with Hendrik Quietsma" } as BeatPlan;
    const qs = planQueries({ plan, facts, entities: { schemaVersion: 1, entities: [] }, style: TEST_STYLE, personAcks: [] });
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) {
      expect(q.text).not.toMatch(LEAK);
      expect(q.localText ?? "").not.toMatch(LEAK);
      expect(q.personIds).toEqual([]);
      expect(q.entityQid).toBeNull();
    }
  });
  it("an allowed person's imageQueries are cleaned of blocked names too", () => {
    const f = privacyFacts();
    f.people[0] = { ...f.people[0]!, imageQueries: ["Carolus Clusius", "Clusius with Jane Minorly"] };
    const plan = { ...base, visualKind: "archival_photo", personIds: ["P1", "P4"], visualQuery: "Clusius and Jane Minorly" } as BeatPlan;
    const qs = planQueries({ plan, facts: f, entities: { schemaVersion: 1, entities: [] }, style: TEST_STYLE, personAcks: [] });
    expect(qs.map((q) => [q.text, q.localText])).toEqual([["Carolus Clusius", "Clusius with"], ["Clusius and", null]]);
  });
});

describe("request spies: blocked names never reach a provider", () => {
  const config = makeConfig({ offline: false });
  const net = fakeFetch(async () => new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } }));
  const http = createHttpClient({ config, logger: quietLogger(), fetchImpl: net.impl, lookup: publicLookup, retries: 0 });
  const ctx = { ...makeCtx({ config, http }), secrets: { pexels: "PEXELSKEY", pixabay: "PIXABAYKEY" } };
  const projectDir = tmpDir("privacy");
  afterAll(() => cleanup(projectDir, config.paths.home));

  it("resolveAssets: beats without personIds whose visualQuery names a minor (archival, news, stock)", async () => {
    const script = makeScript({ chapters: 1, segmentsPerChapter: 2 });
    const plans = makeBeats(script).plans;
    const kinds = ["archival_photo", "news_footage", "stock_broll", "archival_photo"] as const;
    plans.plans.forEach((p, k) => Object.assign(p, { visualKind: kinds[k % kinds.length], personIds: [], visualQuery: "Jane Minorly crying outside the school" }));
    const project: Project = makeProject();
    project.assets = { ...project.assets, offline: false };
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, P.project), JSON.stringify(project));
    const out = await resolveAssets({
      project, plans, facts: privacyFacts(), entities: { schemaVersion: 1, entities: [] }, style: TEST_STYLE, primaryScript: script,
      userPicks: { schemaVersion: 1, picks: [], portraits: [], clips: [] }, previous: { picks: null, frozen: null, ledger: null }, projectDir, reranker: null, personAcks: [],
    }, ctx);
    expect(out.picks.picks.length).toBeGreaterThan(0);
    const hosts = new Set(net.calls.map((c) => new URL(c.url).hostname));
    for (const h of ["commons.wikimedia.org", "www.loc.gov", "api.openverse.org", "archive.org", "api.pexels.com"]) expect(hosts).toContain(h);
    const leaked = net.calls.filter((c) => LEAK.test(decoded(c.url)));
    expect(leaked).toEqual([]);
    expect(net.calls.some((c) => /crying outside the school/.test(decoded(c.url)))).toBe(true);
  }, 120_000);

  it("liveSearch: name stripped, a blocked person's personIds and QID dropped", async () => {
    const facts = privacyFacts();
    await mkdir(path.dirname(path.join(projectDir, P.factsheet)), { recursive: true });
    await writeFile(path.join(projectDir, P.factsheet), JSON.stringify(facts));
    const n = net.calls.length;
    const query: AssetQuery = {
      beatId: null, kind: "image", role: "portrait", text: "Jane Minorly school photo", localText: "Janie M.", entityQid: "Q999001", personIds: ["P4"],
      orientation: "any", minWidth: 0, durationSec: null, limit: 5, lang: null,
    };
    const project = makeProject();
    await liveSearch({ query, providers: ["wikimedia", "openverse"], allowPaid: false, policy: project.assets.licensePolicy, editorial: project.editorial, projectDir }, ctx);
    const calls = net.calls.slice(n);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(decoded(c.url)).not.toMatch(LEAK);
      expect(decoded(c.url)).not.toContain("Q999001");
    }
  });

  it("sanitizeLiveQuery keeps public persons and acknowledged adults", () => {
    const facts = privacyFacts();
    facts.people[0] = { ...facts.people[0]!, wikidataQid: "Q312004" };
    const q: AssetQuery = { beatId: null, kind: "image", role: "portrait", text: "Carolus Clusius with Hendrik Quietsma", localText: null, entityQid: "Q312004", personIds: ["P1", "P5"], orientation: "any", minWidth: 0, durationSec: null, limit: 5, lang: null };
    expect(sanitizeLiveQuery(q, facts, [])).toMatchObject({ text: "Carolus Clusius with", entityQid: "Q312004", personIds: ["P1"] });
    expect(sanitizeLiveQuery(q, facts, ["P5"])).toMatchObject({ text: q.text, personIds: ["P1", "P5"] });
  });
});
