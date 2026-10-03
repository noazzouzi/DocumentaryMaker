// Query planning (§7.3 table) and shot counts.
import type { AssetProviderId, AssetQuery, BeatPlan, EntitiesDoc, FactSheet, Person, StyleData, VisualKind } from "@docmaker/core";
import { falAllowedForBeat } from "./denylist";
import { isBlockedPerson, nameStripper } from "./privacy";
import { clamp } from "./util";

export const GRAPHIC_KINDS: readonly VisualKind[] = ["motion_graphic", "text_card", "social_post", "document_screenshot", "map"];

/** Graphics beats with a template (except photo_burst) only need an optional background slot. */
export function isGraphicsBeat(plan: Pick<BeatPlan, "visualKind" | "motionTemplate">): boolean {
  return GRAPHIC_KINDS.includes(plan.visualKind) && plan.motionTemplate !== "none" && plan.motionTemplate !== "photo_burst";
}
export function isClipBeat(plan: Pick<BeatPlan, "visualKind" | "origin" | "id">): boolean {
  return plan.visualKind === "youtube_clip" || plan.origin === "clip" || plan.id.endsWith("-CLIP");
}
export function isBreathBeat(plan: Pick<BeatPlan, "origin" | "id">): boolean {
  return plan.origin === "breath" || plan.id.endsWith("-BR");
}

/** Persons of the beat whose identity may be searched: never minors/private victims; non-public only after person-ack. */
export function searchablePersons(plan: Pick<BeatPlan, "personIds">, facts: FactSheet, personAcks: readonly string[]): { allowed: Person[]; blocked: Person[] } {
  const allowed: Person[] = [];
  const blocked: Person[] = [];
  for (const id of plan.personIds) {
    const p = facts.people.find((x) => x.id === id);
    if (!p) continue;
    if (isBlockedPerson(p, personAcks)) blocked.push(p);
    else allowed.push(p);
  }
  return { allowed, blocked };
}

/** Removes the names of `blocked` persons from a query (the LLM may have written them into visualQuery). */
export function stripNames(text: string, blocked: readonly Person[]): string {
  return nameStripper({ people: [] }, [], blocked).strip(text);
}

/** Provider order per visual kind (§7.3). Stock is excluded for people beats. */
export function providerOrder(plan: Pick<BeatPlan, "visualKind" | "personIds" | "cueTags">, kind: AssetQuery["kind"]): AssetProviderId[] {
  const people = plan.personIds.length > 0;
  switch (plan.visualKind) {
    case "archival_photo":
      return people ? ["local", "wikimedia", "loc", "openverse"] : ["local", "wikimedia", "loc", "openverse", "internet-archive", "nasa"];
    case "news_footage":
      return people ? ["local", "internet-archive"] : ["local", "internet-archive", "pexels", "pixabay"];
    case "stock_broll":
      if (kind === "image") return people ? ["local", "openverse", "wikimedia"] : ["local", "openverse", "wikimedia", "pexels", "pixabay"];
      return people ? ["local", "internet-archive", "nasa"] : ["local", "pexels", "pixabay", "internet-archive", "nasa"];
    case "ai_illustration":
      return falAllowedForBeat(plan) ? ["local", "fal"] : ["local"];
    case "youtube_clip":
      return [];
    default: // graphics backgrounds and documents
      return plan.visualKind === "document_screenshot" ? ["local", "wikimedia", "loc", "internet-archive"] : ["local"];
  }
}

const BASE = (plan: BeatPlan, kind: AssetQuery["kind"], role: AssetQuery["role"], text: string, limit: number): AssetQuery => ({
  beatId: plan.id, kind, role, text, localText: null, entityQid: null, personIds: [], orientation: "landscape",
  minWidth: kind === "video" ? 1280 : 960, durationSec: kind === "video" ? [Math.max(2, Math.round(plan.estSeconds + 2)), 600] : null, limit, lang: null,
});

export function planQueries(i: { plan: BeatPlan; facts: FactSheet; entities: EntitiesDoc; style: StyleData; personAcks: readonly string[] }): AssetQuery[] {
  const { plan, facts, entities, personAcks } = i;
  if (isClipBeat(plan)) return []; // resolveClips handles YouTube quotes
  const { allowed, blocked } = searchablePersons(plan, facts, personAcks);
  // Blocked persons of the WHOLE fact sheet are stripped from every free-text query, listed in personIds or not.
  const names = nameStripper(facts, personAcks, blocked);
  const visual = names.strip(plan.visualQuery) || plan.visualKind.replace(/_/g, " ");
  const out: AssetQuery[] = [];
  if (isGraphicsBeat(plan)) {
    out.push({ ...BASE(plan, "image", "generated", `${visual} abstract background texture`, 4), orientation: "landscape" });
    return out;
  }
  switch (plan.visualKind) {
    case "archival_photo": {
      for (const p of allowed) {
        const ent = entities.entities.find((e) => e.personId === p.id);
        out.push({
          ...BASE(plan, "image", "portrait", p.name, 20), personIds: [p.id], orientation: "any", entityQid: ent?.qid ?? p.wikidataQid ?? null,
          localText: p.imageQueries.map((q) => names.strip(q)).find((q) => q !== "" && q !== p.name) ?? null,
        });
      }
      out.push({ ...BASE(plan, "image", "archival", visual, 20), orientation: allowed.length > 0 ? "any" : "landscape" });
      break;
    }
    case "news_footage":
      out.push(BASE(plan, "video", "archival", visual, 20));
      break;
    case "stock_broll":
      out.push(BASE(plan, "video", "broll", visual, 20));
      out.push(BASE(plan, "image", "broll", visual, 20));
      break;
    case "ai_illustration":
      // fal never runs for beats with people or PERSON_INTRO/SENSITIVE cues (§7.4); the procedural fallback covers them.
      out.push({ ...BASE(plan, "image", "generated", visual, 2) });
      break;
    case "document_screenshot":
      out.push({ ...BASE(plan, "image", "document", visual, 12), orientation: "any" });
      break;
    default:
      out.push({ ...BASE(plan, "image", "broll", visual, 12) });
      if (plan.motionTemplate === "photo_burst") out[0]!.role = "archival";
      break;
  }
  return out;
}

/** clamp(round(est/(asl·mul)),1,4); photo_burst → count (motionData.count, default 4); breath/MONTAGE → 4; split_compare → 2. */
export function shotsNeeded(plan: BeatPlan, style: StyleData, motionData?: Record<string, unknown> | null): number {
  if (plan.motionTemplate === "photo_burst") {
    const n = Number(motionData?.count ?? (Array.isArray(motionData?.items) ? (motionData!.items as unknown[]).length : NaN));
    return Number.isFinite(n) && n > 0 ? clamp(Math.round(n), 2, 8) : 4;
  }
  if (isBreathBeat(plan) || plan.cueTags.some((c) => c.type === "MONTAGE")) return 4;
  if (plan.motionTemplate === "split_compare") return 2;
  if (isGraphicsBeat(plan)) return 1;
  const s = style.cameraPolicy.shots;
  const hook = plan.purpose === "hook" || plan.chapterId === "CH1";
  let mul = (hook ? s.hookAslFactor : 1) * (s.aslMul.byEnergy[clamp(plan.energy, 1, 5) - 1] ?? 1);
  for (const c of plan.cueTags) mul *= s.aslMul.byCue[c.type] ?? 1;
  const asl = Math.max(0.5, s.targetAslSec * mul);
  return clamp(Math.round(plan.estSeconds / asl), 1, 4);
}

/** Medium/style words that over-constrain archive searches ("semper augustus tulip watercolour" → 0 hits). */
const STYLE_WORDS = new Set([
  "painting", "paintings", "painted", "watercolour", "watercolor", "watercolours", "watercolors", "illustration", "illustrations", "engraving",
  "engravings", "etching", "etchings", "drawing", "drawings", "sketch", "sketches", "photo", "photos", "photograph", "photographs", "photography",
  "picture", "pictures", "image", "images", "close", "up", "closeup", "close-up", "detail", "details", "vintage", "archival", "archive", "old",
  "historic", "historical", "black", "white", "sepia", "still", "footage", "shot", "view", "scene", "artwork", "print", "prints", "lithograph",
  "woodcut", "aquarelle", "peinture", "gravure", "dessin", "ancienne", "ancien", "vieille", "vieux", "tableau", "the", "a", "an", "of", "in", "on",
  "with", "and", "de", "la", "le", "les", "des", "du", "un", "une", "et",
]);

/**
 * Query relaxation ladder for archive/stock searches (§7.3): the full query → without medium/style words → its two-word core.
 * Returns the looser variants only (distinct, non-empty), in order.
 */
export function relaxQuery(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const core = words.filter((w) => !STYLE_WORDS.has(w.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "")));
  const out: string[] = [];
  const add = (t: string) => {
    const x = t.trim();
    if (x && x.toLowerCase() !== text.trim().toLowerCase() && !out.some((o) => o.toLowerCase() === x.toLowerCase())) out.push(x);
  };
  add(core.join(" "));
  if (core.length > 2) add(core.slice(0, 2).join(" "));
  return out;
}
