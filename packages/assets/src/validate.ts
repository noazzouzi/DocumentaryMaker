// validatePick — the ONE server-side check of any pick (auto, user PUT, replaceSource override, upload) (§7.4).
import type { AssetPick, BeatPlan, CueType, FactSheet, FrozenAsset, LicenseInfo, LicensePolicy, LintIssue, Person, Project } from "@docmaker/core";
import { declarationLicense, licenseInfo, LicensePolicyEngine } from "./license";

/** Stock look-alike vocabulary (§7.4 people / bad-light rule). */
export const PEOPLE_RE = /\b(man|woman|men|women|person|people|portrait|boy|girl|face|crowd|couple)\b/i;
/** Beats where stock look-alikes never stand in for real people. */
export const NEGATIVE_CUES: readonly CueType[] = ["SHOCK", "SENSITIVE", "REVEAL"];
const STOCK_LIKE = new Set(["PEXELS", "PIXABAY", "UNSPLASH", "UNKNOWN"]);
const PIPELINE_ROLES = new Set(["generated", "music", "sfx", "vo"]);

/** The licence of a frozen asset: candidate → declaration → pipeline-generated (procedural) → UNKNOWN. */
export function licenseOfAsset(a: FrozenAsset): LicenseInfo {
  if (a.candidate) return a.candidate.license;
  if (a.declaration) return declarationLicense(a.declaration);
  if (isPipelineGenerated(a)) return licenseInfo("PROCEDURAL");
  return licenseInfo("UNKNOWN");
}

export function isPipelineGenerated(a: FrozenAsset): boolean {
  if (a.candidate?.provider === "procedural") return true;
  return a.candidate === null && a.declaration === null && (a.conform.recipe.startsWith("proc-") || PIPELINE_ROLES.has(a.role));
}

/** true when a candidate's title/tags/description show people (used for the stock look-alike rule). */
export function looksLikePeople(c: { title: string; tags: string[]; description: string }): boolean {
  return PEOPLE_RE.test(c.title) || c.tags.some((t) => PEOPLE_RE.test(t)) || PEOPLE_RE.test(c.description);
}

/** People / bad-light rule for a candidate on a beat (pure; also used to filter search results). */
export function peopleRuleBlocks(license: LicenseInfo, c: { title: string; tags: string[]; description: string } | null, plan: Pick<BeatPlan, "personIds" | "cueTags"> | null): boolean {
  if (!plan || !c) return false;
  if (!STOCK_LIKE.has(license.code)) return false;
  const sensitive = plan.personIds.length > 0 || plan.cueTags.some((t) => NEGATIVE_CUES.includes(t.type));
  return sensitive && looksLikePeople(c);
}

/** Identity-bearing slot: a portrait, or an archival/news/clip beat about named people. */
function isPortraitSlot(asset: FrozenAsset, plan: BeatPlan | null): boolean {
  if (asset.role === "portrait") return true;
  if (!plan || plan.personIds.length === 0) return false;
  return ["archival_photo", "news_footage", "youtube_clip", "stock_broll"].includes(plan.visualKind) || plan.motionTemplate === "photo_burst";
}

export function validatePick(i: {
  pick: AssetPick; plan: BeatPlan | null; asset: FrozenAsset; policy: LicensePolicy; editorial: Project["editorial"];
  facts: FactSheet; personAcks: readonly string[];
}): LintIssue[] {
  const { pick, plan, asset } = i;
  const where = `${pick.beatId}#${pick.slot}`;
  const out: LintIssue[] = [];
  const err = (msg: string) => out.push({ level: "error", rule: "POLICY_DENIED", where, msg });
  const warn = (rule: string, msg: string) => out.push({ level: "warn", rule, where, msg });

  if (pick.assetId !== asset.id) err(`pick references asset ${pick.assetId.slice(0, 12)} but was validated against ${asset.id.slice(0, 12)}`);
  if (plan && plan.id !== pick.beatId) err(`pick for ${pick.beatId} validated against beat ${plan.id}`);

  const license = licenseOfAsset(asset);
  const cueTypes = plan ? plan.cueTags.map((t) => t.type) : [];
  const engine = new LicensePolicyEngine(i.policy, { monetized: i.editorial.monetized, fairUseAcknowledged: i.editorial.fairUseAcknowledged });
  const verdict = engine.evaluate(license, plan ? { personIds: plan.personIds, cueTypes } : null);
  if (!verdict.allowed) err(`licence ${license.code} denied: ${verdict.reasons.join("; ")}`);

  // AI-generated imagery never on people beats nor on PERSON_INTRO / SENSITIVE beats.
  if (license.code === "AI-GENERATED" && plan) {
    if (plan.personIds.length > 0 && verdict.allowed) err("AI-generated image on a beat about real people");
    const bad = cueTypes.filter((c) => c === "PERSON_INTRO" || c === "SENSITIVE");
    if (bad.length > 0) err(`AI-generated image on a ${bad.join("/")} beat`);
  }

  // Stock look-alikes never stand in for real people or appear in a negative context.
  if (peopleRuleBlocks(license, asset.candidate, plan)) {
    err(`stock look-alike (${license.code}) with people on a ${plan!.personIds.length > 0 ? "person" : "SHOCK/SENSITIVE/REVEAL"} beat`);
  }

  // Minors / private victims and non-public persons.
  if (plan && plan.personIds.length > 0 && !isPipelineGenerated(asset)) {
    const people = new Map<string, Person>(i.facts.people.map((p) => [p.id, p]));
    const portrait = isPortraitSlot(asset, plan);
    for (const pid of plan.personIds) {
      const person = people.get(pid);
      if (!person) {
        warn("UNKNOWN_PERSON", `beat references unknown person ${pid}`);
        continue;
      }
      if (!portrait) continue;
      if (person.isMinorOrPrivateVictim) err(`${pid} is a minor or private victim: never shown`);
      else if (!person.publicFigure && !i.personAcks.includes(pid)) err(`${pid} is not a public figure: showing them requires the person-ack gate`);
    }
  }

  // Non-blocking flags the UI and credits surface.
  if (verdict.allowed) {
    if (verdict.flags.includes("personality")) warn("PERSONALITY_RIGHTS", "personality rights restriction: check consent before commercial use");
    if (verdict.flags.includes("fair-use-user-risk")) warn("FAIR_USE", "fair use / quotation at your own risk: keep it short and commented");
    if (verdict.flags.includes("may-be-manipulated")) warn("MAY_BE_MANIPULATED", "web image: may be manipulated — verify the source");
    if (verdict.flags.includes("editorial-only")) warn("EDITORIAL_ONLY", "rights unknown: editorial use only");
  }
  return out;
}
