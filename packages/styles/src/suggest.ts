// Free, offline, deterministic style suggestion at idea time (§6.3 step 2; refined later by llm.suggestStyle).
import {
  DOC_VERSIONS, DocmakerError, StyleSuggestion, TopicType,
  type RiskFlag, type StyleManifest,
} from "@docmaker/core";
import { findKeyword, foldKeyword, foldTokens } from "./text";
import type { StyleRegistry } from "./types";

type Lex = readonly (readonly [keyword: string, weight: number])[];

/** EN + FR topic lexicon (accent-folded; multi-word entries match contiguous tokens; inflections tolerated). */
export const TOPIC_LEXICON: Readonly<Record<Exclude<TopicType, "other">, Lex>> = {
  person_downfall: [
    ["downfall", 2], ["fall", 1.5], ["fell", 1], ["fallen", 1], ["fall from grace", 3], ["rise and fall", 2.5], ["ruin", 1.5],
    ["demise", 1.5], ["disgrace", 1.5], ["cancelled", 1], ["canceled", 1], ["comeback", 1], ["destroyed", 1], ["catastrophic", 0.75],
    ["self destruction", 2], ["breakdown", 1], ["breakup", 1], ["divorce", 1],
    ["chute", 2], ["dechu", 1.5], ["decheance", 2], ["descente aux enfers", 3], ["ascension et chute", 2.5], ["rupture", 1.5],
    ["catastrophique", 0.75], ["retour", 0.5], ["ruine", 1.5], ["chute libre", 2],
  ],
  company_collapse: [
    ["bankrupt", 2], ["bankruptcy", 2], ["collapse", 2], ["company", 1], ["startup", 1.5], ["brand", 0.75], ["corporation", 1],
    ["went bust", 2], ["implosion", 1.5], ["crash", 1], ["shutdown", 1], ["exchange", 0.75], ["empire", 0.75], ["insolvency", 2],
    ["faillite", 2], ["effondrement", 2], ["entreprise", 1], ["societe", 0.75], ["marque", 0.75], ["liquidation", 2], ["krach", 1],
    ["fermeture", 1], ["banqueroute", 2],
  ],
  scandal_expose: [
    ["scandal", 2], ["exposed", 1.5], ["expose", 1.5], ["cover up", 2], ["coverup", 2], ["leak", 1], ["leaked", 1], ["corruption", 1.5],
    ["fraud", 1.5], ["scam", 1.5], ["ponzi", 2], ["lies", 1], ["lie", 0.75], ["truth", 0.5], ["affair", 1], ["whistleblower", 1.5],
    ["scandale", 2], ["affaire", 1.5], ["fraude", 1.5], ["escroquerie", 1.5], ["arnaque", 1.5], ["mensonge", 1], ["revelations", 1.5],
    ["magouille", 1.5], ["detournement", 1.5], ["trial", 1], ["lawsuit", 1.5], ["allegations", 1.5], ["accusations", 1.5],
    ["proces", 1], ["agression", 1], ["plainte", 1],
  ],
  rise_story: [
    ["rise", 1.5], ["success", 1], ["built", 1], ["billionaire", 1], ["millionaire", 1], ["rags to riches", 3], ["self made", 2],
    ["how he became", 2], ["how she became", 2], ["became", 0.5], ["origin", 1], ["genius", 0.75],
    ["ascension", 1.5], ["succes", 1], ["milliardaire", 1], ["millionnaire", 1], ["fortune", 1], ["devenu", 0.75], ["devenue", 0.75],
    ["empire", 0.5], ["reussite", 1.5],
  ],
  true_crime: [
    ["murder", 2.5], ["killer", 2.5], ["serial", 1], ["crime", 2], ["criminal", 1.5], ["kidnapping", 2], ["disappearance", 2],
    ["missing", 1.5], ["homicide", 2.5], ["cold case", 3], ["heist", 2], ["robbery", 1.5], ["investigation", 1], ["unsolved", 2],
    ["cult", 1.5], ["prison", 1], ["manhunt", 2],
    ["meurtre", 2.5], ["tueur", 2.5], ["criminel", 1.5], ["enlevement", 2], ["disparition", 2], ["assassinat", 2.5], ["enquete", 1],
    ["fait divers", 2.5], ["braquage", 2], ["secte", 1.5], ["non elucide", 2], ["affaire criminelle", 3],
  ],
  history: [
    ["history", 2], ["historical", 1.5], ["war", 1.5], ["ancient", 1.5], ["medieval", 1.5], ["century", 1.5], ["revolution", 1.5],
    ["empire", 0.75], ["mania", 1.5], ["bubble", 1], ["dynasty", 1.5], ["kingdom", 1], ["golden age", 2], ["colonial", 1],
    ["histoire", 2], ["historique", 1.5], ["guerre", 1.5], ["antique", 1], ["moyen age", 2], ["siecle", 1.5], ["royaume", 1],
    ["dynastie", 1.5], ["epoque", 1], ["bulle", 1],
  ],
  explainer: [
    ["how", 0.75], ["why", 1], ["what", 0.5], ["explained", 2.5], ["explainer", 2.5], ["works", 1], ["guide", 1], ["science", 1.5],
    ["understanding", 1.5], ["economics", 1], ["inside", 0.5],
    ["pourquoi", 1], ["comment", 0.75], ["explique", 2], ["expliquee", 2], ["fonctionne", 1], ["comprendre", 1.5],
  ],
  internet_drama: [
    ["youtuber", 2.5], ["youtube", 1.5], ["influencer", 2.5], ["streamer", 2.5], ["twitch", 2], ["tiktok", 2], ["tiktoker", 2.5],
    ["instagram", 1.5], ["twitter", 1.5], ["internet", 1.5], ["viral", 1], ["drama", 1.5], ["beef", 1.5], ["feud", 1.5],
    ["cancel culture", 2], ["controversy", 1], ["exposed", 0.5], ["podcast", 1], ["reality tv", 1.5],
    ["influenceur", 2.5], ["influenceuse", 2.5], ["polemique", 1], ["clash", 1.5], ["reseaux sociaux", 2], ["tele realite", 1.5],
  ],
  conspiracy_debunk: [
    ["conspiracy", 3], ["hoax", 2.5], ["debunk", 3], ["debunked", 3], ["myth", 2], ["flat earth", 3], ["truth about", 1.5],
    ["fake", 1], ["cover up", 1], ["illuminati", 3], ["theory", 1],
    ["complot", 3], ["complotiste", 3], ["conspiration", 3], ["canular", 2.5], ["mythe", 2], ["theorie", 1], ["verite sur", 1.5],
    ["intox", 2],
  ],
};
/** Tie-break order when two topics score the same (more specific first). */
export const TOPIC_PRIORITY: readonly TopicType[] = [
  "true_crime", "conspiracy_debunk", "company_collapse", "scandal_expose", "person_downfall", "internet_drama",
  "rise_story", "history", "explainer", "other",
];

/** Conservative idea-stage risk lexicon (the research-stage LLM suggestion refines it; flags only add safety). */
export const RISK_LEXICON: Readonly<Record<Exclude<RiskFlag, "none">, Lex>> = {
  real_person_allegations: [
    ["allegation", 1], ["alleged", 1], ["accused", 1], ["accusation", 1], ["abuse", 1], ["assault", 1], ["harassment", 1],
    ["domestic violence", 1], ["lawsuit", 1], ["defamation", 1], ["fraud", 1], ["scam", 1], ["ponzi", 1],
    ["accuse", 1], ["accusations", 1], ["violences conjugales", 1], ["harcelement", 1], ["agression", 1], ["diffamation", 1],
    ["plainte", 1], ["fraude", 1], ["escroquerie", 1], ["arnaque", 1], ["abus", 1],
  ],
  minors: [
    ["child", 1], ["children", 1], ["kid", 1], ["kids", 1], ["minor", 1], ["teen", 1], ["teenager", 1], ["underage", 1], ["baby", 1],
    ["enfant", 1], ["enfants", 1], ["mineur", 1], ["mineure", 1], ["ado", 1], ["adolescent", 1], ["adolescente", 1], ["bebe", 1],
  ],
  sexual_violence: [
    ["rape", 1], ["raped", 1], ["sexual assault", 1], ["sexual abuse", 1], ["sexual misconduct", 1], ["sex trafficking", 1],
    ["metoo", 1], ["viol", 1], ["agression sexuelle", 1], ["abus sexuel", 1], ["harcelement sexuel", 1], ["pedophile", 1], ["pedocriminel", 1],
    ["inceste", 1], ["incest", 1],
  ],
  suicide_self_harm: [
    ["suicide", 1], ["suicidal", 1], ["self harm", 1], ["overdose", 1], ["killed himself", 1], ["killed herself", 1],
    ["suicidaire", 1], ["automutilation", 1], ["s est suicide", 1], ["mis fin a ses jours", 1], ["surdose", 1],
  ],
  ongoing_trial: [
    ["trial", 1], ["on trial", 1], ["charged", 1], ["indicted", 1], ["indictment", 1], ["court case", 1], ["appeal", 1], ["verdict", 1],
    ["proces", 1], ["mis en examen", 1], ["inculpe", 1], ["garde a vue", 1], ["tribunal", 1], ["appel", 1], ["justice", 1],
  ],
  health_speculation: [
    ["mental illness", 1], ["mental health", 1], ["diagnosis", 1], ["disease", 1], ["addiction", 1], ["rehab", 1], ["dementia", 1],
    ["sante mentale", 1], ["maladie", 1], ["depression", 1], ["bipolaire", 1], ["bipolar", 1], ["schizophrenia", 1],
  ],
  graphic_violence: [
    ["murder", 1], ["massacre", 1], ["shooting", 1], ["killing", 1], ["torture", 1], ["beheading", 1], ["mass shooting", 1],
    ["meurtre", 1], ["tuerie", 1], ["fusillade", 1], ["assassinat", 1], ["attentat", 1],
  ],
};

/** Topic → style category affinity (used when a style's bestFor does not list the topic, and as a soft prior). */
export const CATEGORY_AFFINITY: Readonly<Record<TopicType, Readonly<Record<StyleManifest["category"], number>>>> = {
  person_downfall: { commentary: 1, "true-crime": 0.3, essay: 0.35, explainer: 0.1 },
  company_collapse: { commentary: 1, "true-crime": 0.2, essay: 0.4, explainer: 0.4 },
  scandal_expose: { commentary: 1, "true-crime": 0.5, essay: 0.3, explainer: 0.2 },
  rise_story: { commentary: 0.8, "true-crime": 0.1, essay: 0.7, explainer: 0.3 },
  true_crime: { commentary: 0.4, "true-crime": 1, essay: 0.3, explainer: 0.1 },
  history: { commentary: 0.3, "true-crime": 0.3, essay: 1, explainer: 0.6 },
  explainer: { commentary: 0.2, "true-crime": 0.1, essay: 0.6, explainer: 1 },
  internet_drama: { commentary: 1, "true-crime": 0.1, essay: 0.2, explainer: 0.2 },
  conspiracy_debunk: { commentary: 0.5, "true-crime": 0.5, essay: 0.7, explainer: 0.8 },
  other: { commentary: 0.5, "true-crime": 0.2, essay: 0.5, explainer: 0.5 },
};
/** Idea-stage runtime recommendation per topic (minutes). */
export const RECOMMENDED_MINUTES: Readonly<Record<TopicType, number>> = {
  person_downfall: 20, company_collapse: 20, scandal_expose: 20, rise_story: 20, true_crime: 25,
  history: 25, explainer: 15, internet_drama: 15, conspiracy_debunk: 20, other: 20,
};

interface LexHit { keyword: string; weight: number; at: number; len: number }
function lexHits(tokens: readonly string[], lex: Lex): LexHit[] {
  const hits: LexHit[] = [];
  for (const [kw, weight] of lex) {
    const f = foldKeyword(kw);
    const len = f.split(" ").length;
    for (const at of findKeyword(tokens, f)) hits.push({ keyword: f, weight, at, len });
  }
  // a token run counts once: keep the heaviest/longest keyword covering it (e.g. "rise and fall" over "fall")
  hits.sort((a, b) => b.weight * b.len - a.weight * a.len || b.len - a.len || a.at - b.at || (a.keyword < b.keyword ? -1 : 1));
  const used = new Set<number>();
  const kept: LexHit[] = [];
  for (const h of hits) {
    const span = Array.from({ length: h.len }, (_, i) => h.at + i);
    if (span.some((i) => used.has(i))) continue;
    span.forEach((i) => used.add(i));
    kept.push(h);
  }
  return kept;
}

function topicScores(tokens: readonly string[]): { topic: TopicType; score: number }[] {
  return (Object.keys(TOPIC_LEXICON) as Exclude<TopicType, "other">[]).map((topic) => ({
    topic, score: lexHits(tokens, TOPIC_LEXICON[topic]).reduce((s, h) => s + h.weight, 0),
  }));
}

/** Deterministic keyword classifier of an idea into a TopicType ("other" when nothing matches). */
export function classifyTopicOffline(idea: string): TopicType {
  const tokens = foldTokens(idea);
  const scored = topicScores(tokens).filter((s) => s.score > 0);
  if (scored.length === 0) return "other";
  scored.sort((a, b) => b.score - a.score || TOPIC_PRIORITY.indexOf(a.topic) - TOPIC_PRIORITY.indexOf(b.topic));
  return scored[0]!.topic;
}

/** Idea-stage risk flags (["none"] when nothing matches). */
export function riskFlagsOffline(idea: string): RiskFlag[] {
  const tokens = foldTokens(idea);
  const flags = (Object.keys(RISK_LEXICON) as Exclude<RiskFlag, "none">[]).filter((f) => lexHits(tokens, RISK_LEXICON[f]).length > 0);
  return flags.length ? flags : ["none"];
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Scores one style for an idea: manifest.uses keyword hits (0.5), topic ∈ bestFor (0.4), category affinity (0.1). */
export function scoreStyle(tokens: readonly string[], topic: TopicType, m: StyleManifest): { score: number; why: string; matched: string[] } {
  const lex: Lex = m.uses.map((u) => [u, foldKeyword(u).split(" ").length > 1 ? 1.5 : 1] as const);
  const hits = lexHits(tokens, lex);
  const kw = hits.reduce((s, h) => s + h.weight, 0);
  const kwPart = 1 - Math.exp(-kw / 1.5); // 1 hit ≈ .49, 2 ≈ .74, 3 ≈ .86
  const bestIdx = m.bestFor.indexOf(topic);
  const topicPart = topic === "other" ? 0 : bestIdx >= 0 ? 1 - 0.04 * bestIdx : 0;
  const aff = CATEGORY_AFFINITY[topic][m.category];
  const score = round4(clamp01(0.5 * kwPart + 0.4 * topicPart + 0.1 * aff));
  const matched = [...new Set(hits.sort((a, b) => a.at - b.at).map((h) => h.keyword))];
  const why: string[] = [];
  if (matched.length) why.push(`keywords: ${matched.join(", ")}`);
  why.push(bestIdx >= 0 ? `best for ${topic}` : `topic ${topic} not in bestFor`);
  why.push(`${m.category} style`);
  return { score, why: why.join("; "), matched };
}

/** The idea, whitespace-collapsed and trimmed, first letter upper-cased (offline title option). */
function cleanTitle(idea: string): string {
  const t = idea.replace(/\s+/g, " ").trim().replace(/^["«“'\s]+|["»”'\s]+$/g, "");
  return t ? t[0]!.toLocaleUpperCase() + t.slice(1) : t;
}

/** Original-case words of the idea for a folded token span (whitespace tokens that fold into the span). */
function originalSpan(idea: string, firstToken: number, len: number): string {
  const words: { raw: string; n: number }[] = idea.split(/\s+/u).filter((w) => w !== "").map((raw) => ({ raw, n: foldTokens(raw).length }));
  const out: string[] = [];
  let t = 0;
  for (const w of words) {
    const end = t + w.n;
    if (w.n > 0 && end > firstToken && t < firstToken + len) out.push(w.raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
    t = end;
  }
  return out.join(" ");
}

/** Deterministic keyword classifier: normWord tokens of the idea × manifest.uses (accent-folded) and bestFor. Free, offline. */
export function suggestStyleOffline(idea: string, registry: StyleRegistry): StyleSuggestion {
  const summaries = registry.list();
  if (summaries.length === 0) throw new DocmakerError("VALIDATION", "no styles available to suggest from");
  const tokens = foldTokens(idea);
  const topicType = classifyTopicOffline(idea);
  const ranked = summaries
    .map((s) => {
      const r = scoreStyle(tokens, topicType, registry.get(s.id).data.manifest);
      return { styleId: s.id, score: r.score, why: r.why };
    })
    .sort((a, b) => b.score - a.score || (a.styleId < b.styleId ? -1 : a.styleId > b.styleId ? 1 : 0));

  // thumbnail texts: the strongest topic keyword spans of the idea, in its own words, upper-cased (≤ 2)
  const topicHits = topicType === "other" ? [] : lexHits(tokens, TOPIC_LEXICON[topicType]).sort((a, b) => b.weight - a.weight || a.at - b.at);
  const thumbs = [...new Set(topicHits.map((h) => originalSpan(idea, h.at, h.len).toLocaleUpperCase()).filter((s) => s !== ""))].slice(0, 2);
  const title = cleanTitle(idea);

  return StyleSuggestion.parse({
    schemaVersion: DOC_VERSIONS.styleSuggestion,
    topicType,
    ranked,
    recommendedStyleId: ranked[0]!.styleId,
    recommendedMinutes: RECOMMENDED_MINUTES[topicType],
    titleOptions: title ? [title] : [],
    thumbnailTextOptions: thumbs,
    riskFlags: riskFlagsOffline(idea),
    themeOverride: null,
    source: "offline",
    stage: "idea",
  });
}
