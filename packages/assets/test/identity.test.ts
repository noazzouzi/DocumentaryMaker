// Portrait identity: graves, statues, plaques, houses, signatures and coats of arms are never a person's likeness.
import { describe, expect, it } from "vitest";
import type { Candidate, FrozenAsset } from "@docmaker/core";
import { FrozenAsset as FrozenAssetSchema } from "@docmaker/core";
import { makeFactSheet, makeProject } from "@docmaker/core/testing";
import { candidateNamesPerson, licenseInfo, nonLikenessSubject, validatePick } from "../src/index";
import { likenessEvidence } from "../src/identity";

const c = (title: string, tags: string[] = [], description = "") => ({ title, tags, description });

describe("nonLikenessSubject (EN/FR/DE/NL titles and Commons categories)", () => {
  it("names what the picture shows instead of the person", () => {
    expect(nonLikenessSubject(c("Grave of Charles Mackay, Kensal Green Cemetery, February 2024"))).toBe("grave");
    expect(nonLikenessSubject(c("Grab Charles Mackay"))).toBe("grave");
    expect(nonLikenessSubject(c("Pierre tombale de Charles de l'Écluse"))).toBe("grave");
    expect(nonLikenessSubject(c("Grafsteen van Carolus Clusius, Pieterskerk Leiden"))).toBe("grave");
    expect(nonLikenessSubject(c("Statue of Carolus Clusius in Keukenhof, Lisse (2019) 04"))).toBe("statue");
    expect(nonLikenessSubject(c("Borstbeeld Carolus Clusius"))).toBe("statue");
    expect(nonLikenessSubject(c("Buste de Clusius"))).toBe("statue");
    expect(nonLikenessSubject(c("Clusius-Denkmal in Wien"))).toBe("statue");
    expect(nonLikenessSubject(c("Blue plaque for Charles Mackay"))).toBe("plaque");
    expect(nonLikenessSubject(c("Gedenkplaat Clusius, Rapenburg"))).toBe("plaque");
    expect(nonLikenessSubject(c("Geburtshaus von Clusius in Arras"))).toBe("house");
    expect(nonLikenessSubject(c("Maison natale de Clusius"))).toBe("house");
    expect(nonLikenessSubject(c("Charles Mackay signature"))).toBe("signature");
    expect(nonLikenessSubject(c("Handtekening Carolus Clusius"))).toBe("signature");
    expect(nonLikenessSubject(c("Wappen der Familie de l'Écluse"))).toBe("coat of arms");
    expect(nonLikenessSubject(c("Armoiries de la famille de l'Écluse"))).toBe("coat of arms");
    // A book page, a letter or a stamp named after the person is not their likeness either (unless the title says portrait).
    expect(nonLikenessSubject(c("The Collected Songs of Charles Mackay 006", ["The Collected Songs of Charles Mackay"]))).toBe("document");
    expect(nonLikenessSubject(c("Brief van Carolus Clusius aan Joachim Camerarius"))).toBe("document");
    expect(nonLikenessSubject(c("Charles Mackay, frontispiece portrait from his Collected Songs"))).toBeNull();
  });
  it("uses Commons categories and funerary words in the description when the title is neutral", () => {
    expect(nonLikenessSubject(c("Charles Mackay 2024 01", ["Graves of Charles Mackay", "Kensal Green Cemetery"]))).toBe("grave");
    expect(nonLikenessSubject(c("IMG 2231", ["Statues of Carolus Clusius"]))).toBe("statue");
    expect(nonLikenessSubject(c("Carolus Clusius", ["Coats of arms of families of the Netherlands"]))).toBe("coat of arms");
    expect(nonLikenessSubject(c("Charles Mackay DSC 0042", [], "The headstone in Kensal Green, London"))).toBe("grave");
  });
  it("leaves real likenesses alone (bust-length portraits, signed paintings, counts named Graf)", () => {
    expect(nonLikenessSubject(c("Carolus Clusius by Martin Rota"))).toBeNull();
    expect(nonLikenessSubject(c("Charles Mackay (8738982379)"))).toBeNull();
    expect(nonLikenessSubject(c("Bust-length portrait of Carolus Clusius", [], "Oil on panel, signed lower right; signature and date"))).toBeNull();
    expect(nonLikenessSubject(c("Graf Johann von Nassau, portrait"))).toBeNull();
    // A title that announces a likeness ignores loose category words (paintings are often categorised with arms or houses) …
    expect(nonLikenessSubject(c("Portrait of Carolus Clusius", ["Coats of arms in portraits", "House of Habsburg"]))).toBeNull();
    // … but never a funerary category.
    expect(nonLikenessSubject(c("Photo of Charles Mackay", ["Graves in Kensal Green Cemetery"]))).toBe("grave");
  });
});

describe("who a picture shows", () => {
  const mackay = { name: "Charles Mackay", aliases: [], roleInStory: "Scottish journalist whose 1841 book popularised the story" };
  it("the name must stand together in one field, not as scattered words", () => {
    expect(candidateNamesPerson(c("Mackay Island Wildlife Refuge 11 LR", ["Mackay Island National Wildlife Refuge"], "View from the Charles Kuralt Overlook on Mackay Island."), mackay)).toBe(false);
    expect(candidateNamesPerson(c("Portrait", [], "Engraving of Mackay, Charles, Scottish poet"), mackay)).toBe(true);
  });
  it("likeness evidence: a portraits category beats a bare name; a namesake's qualifier counts against it", () => {
    expect(likenessEvidence(c("Charles Mackay by Herbert Watkins", ["Works by Herbert Watkins", "Portraits of Charles Mackay"]), mackay)).toBe(2);
    expect(likenessEvidence(c("CMackay", [], "Depicted person: Charles Mackay – British writer (1814-1889)"), mackay)).toBe(2);
    expect(likenessEvidence(c("Charles Mackay, photograph"), mackay)).toBe(1);
    expect(likenessEvidence(c("File:Charles Mackay (8738982379).jpg"), mackay)).toBe(0);
    expect(likenessEvidence(c("Charles Mackay (8738982379)", ["Mug shots of people of New Zealand", "Charles Mackay (mayor)"]), mackay)).toBe(-2);
    expect(likenessEvidence(c("Charles Mackay as Bailie Nicol Jarvie", ["Charles Mackay (Scottish actor)"]), mackay)).toBe(-2);
    expect(likenessEvidence(c("Charles Mackay", ["Charles Mackay (journalist)"]), mackay)).toBe(0);
  });
});

describe("validatePick refuses a non-likeness as someone's portrait", () => {
  const facts = makeFactSheet();
  const pid = facts.people[0]!.id;
  const asset = (title: string): FrozenAsset => FrozenAssetSchema.parse({
    id: "a".repeat(64), originalSha256: "0".repeat(64), kind: "image", role: "archival", mime: "image/jpeg", ext: "jpg", bytes: 1, width: 1920, height: 1080,
    durationMs: null, fps: null, hasAudio: false, lufs: null, cacheRel: "blobs/x", projectRel: "media/x.jpg",
    candidate: {
      provider: "wikimedia", providerAssetId: "1", kind: "image", title, description: "", tags: [], previewUrl: "", downloadUrl: "", width: 1920, height: 1080,
      durationSec: null, license: licenseInfo("PDM"), author: null, sourcePageUrl: "", retrievedAt: "2026-10-01T00:00:00.000Z", youtube: null,
    } satisfies Candidate,
    declaration: null, conform: { recipe: "image-v1", sourceInMs: null, sourceOutMs: null, handleHeadMs: 0, handleTailMs: 0 },
    analysis: { grayscale: false, meanLuma: 0.4, year: null, lowRes: false }, frozenAt: "2026-10-01T00:00:00.000Z",
  });
  const project = makeProject();
  const check = (a: FrozenAsset, portraitOf: string | null) => validatePick({
    pick: { beatId: `portrait:${pid}`, slot: 0, assetId: a.id, role: "primary", focal: { x: 0.5, y: 0.5 }, crop: null, sourceInMs: null, sourceOutMs: null,
      score: { metadata: 0, clip: null, vision: null, technical: null, watermark: null, nsfw: null, total: 0, focal: null, safeCrop: null, notes: "" }, pickedBy: "user", planKey: "0000000000000000" },
    plan: null, asset: a, policy: project.assets.licensePolicy, editorial: project.editorial, facts, personAcks: [], portraitOf,
  });
  it("a grave as a portrait is an error; the same file as b-roll is fine; a real likeness passes", () => {
    const grave = asset(`Grave of ${facts.people[0]!.name}`);
    expect(check(grave, pid).filter((x) => x.level === "error").map((x) => x.rule)).toEqual(["NOT_A_PORTRAIT"]);
    expect(check(grave, null).filter((x) => x.level === "error")).toEqual([]);
    expect(check(asset(`${facts.people[0]!.name}, engraving`), pid).filter((x) => x.level === "error")).toEqual([]);
  });
});
