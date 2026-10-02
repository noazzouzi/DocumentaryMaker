// Deterministic fact-check rules a–h (§6.3 step 6). Free, synchronous; also run by engine.writeDoc on every script edit.
import {
  ESTABLISHED_STATUSES, normWord, sha8, type BeatLang, type BeatPlan, type BeatPlansDoc, type BeatSlicesDoc, type FactCheck,
  type FactCheckItem, type FactSheet, type Lang, type Person, type PublishInfo, type RiskFlag, type Script,
} from "@docmaker/core";
import { ACCUSATORY, ATTRIBUTION, DENIAL, splitSentences } from "../lexicon";
import { mentionsPerson, motionStrings, normWs } from "../text";
import { extractNumbers, matchesAny, numbersIn } from "./numbers";

/** FC-<sha8(where|normWord(sentence)|claimKind|origin)> — stable across re-runs. */
export function factCheckId(where: string, sentence: string, claimKind: string, origin: "llm" | "deterministic"): string {
  return `FC-${sha8(`${where}|${normWord(sentence)}|${claimKind}|${origin}`)}`;
}

type Kind = FactCheckItem["claimKind"];
/**
 * Deterministic item. Several rules (or several entities) can flag the same sentence, so the hashed sentence is
 * qualified with `rule:qualifier` (stable: it depends only on the content that triggered the item).
 */
function item(
  rule: string, where: string, surface: FactCheckItem["surface"], sentence: string, claimKind: Kind, verdict: FactCheckItem["verdict"],
  risk: FactCheckItem["risk"], factIds: string[], problem: string, suggestedRewrite = "", qualifier = "",
): FactCheckItem {
  return {
    id: factCheckId(where, `${sentence} ${rule}:${qualifier}`, claimKind, "deterministic"), where, surface, sentence, claimKind, verdict, risk, factIds, problem,
    suggestedRewrite, origin: "deterministic", rule, resolution: "open", note: "",
  };
}

/** Numbers supported by the cited facts (figure values, and every number in cited dates, titles, summaries and quotes). */
function allowedNumbers(fs: FactSheet, factIds: readonly string[]): number[] {
  const set = new Set(factIds);
  const vals: number[] = [];
  const strings: string[] = [];
  for (const f of fs.figures) if (set.has(f.id)) { vals.push(f.value); strings.push(f.label, f.asOf); }
  for (const e of fs.timeline) if (set.has(e.id)) strings.push(e.date, e.title, e.whatHappened);
  for (const c of fs.claims) if (set.has(c.id)) strings.push(c.summary, c.decisionDate, c.jurisdiction);
  for (const q of fs.quotes) if (set.has(q.id)) strings.push(q.verbatim, q.date);
  for (const s of fs.sources) if (set.has(s.id)) strings.push(s.title, s.publishedAt);
  return [...vals, ...numbersIn(strings)];
}

/** On-screen strings of a beat: onScreenText, motion-data display strings, and cue-derived texts (stamp, slam, lower third). */
function onScreenStrings(plan: BeatPlan, text: BeatLang | undefined, people: Map<string, Person>): string[] {
  const out: string[] = [];
  if (text?.onScreenText.trim()) out.push(text.onScreenText.trim());
  if (text) out.push(...motionStrings(text.motionData));
  for (const c of plan.cueTags) {
    if ((c.type === "REVEAL" || c.type === "SHOCK") && c.value.trim() !== "" && !/^\d+([.,]\d+)?$/.test(c.value.trim())) out.push(c.value.trim());
    if (c.type === "PERSON_INTRO") {
      for (const pid of plan.personIds) {
        const p = people.get(pid);
        if (p?.roleInStory.trim()) out.push(p.roleInStory.trim());
      }
    }
  }
  return [...new Set(out)];
}

export interface DeterministicInput {
  script: Script; slices: BeatSlicesDoc; plans: BeatPlansDoc; factSheet: FactSheet; publish: PublishInfo | null; riskFlags: RiskFlag[];
  /** Person ids acknowledged through the person-ack gate (rule h for publicFigure:false persons). */
  personAcks?: readonly string[];
}

export function deterministicFactChecks(i: DeterministicInput): FactCheckItem[] {
  const { script, factSheet: fs } = i;
  const lang: Lang = script.lang;
  const out: FactCheckItem[] = [];
  const add = (it: FactCheckItem) => {
    if (!out.some((x) => x.id === it.id)) out.push(it);
  };
  const quotes = new Map(fs.quotes.map((q) => [q.id, q]));
  const claims = new Map(fs.claims.map((c) => [c.id, c]));
  const people = new Map(fs.people.map((p) => [p.id, p]));
  const acks = new Set(i.personAcks ?? []);
  const flaggedPeople = fs.people.filter((p) => p.isMinorOrPrivateVictim || (!p.publicFigure && !acks.has(p.id)));
  const quoteRisk = (qid: string, where: string, surface: FactCheckItem["surface"], sentence: string) => {
    const q = quotes.get(qid);
    if (!q) return;
    if (q.verification === "not-found") {
      add(item("g", where, surface, sentence, "quote", "unverified_quote", "high", [q.id],
        `quote ${q.id} was not found on its source page`, "replace the quote with an attributed paraphrase", q.id));
    } else if (q.verification === "fetch-failed" || q.verification === "unchecked") {
      add(item("g", where, surface, sentence, "quote", "unverified_quote", "medium", [q.id],
        `quote ${q.id} has not been verified against its source (${q.verification})`, "", q.id));
    }
  };
  const personRisk = (text: string, where: string, surface: FactCheckItem["surface"]) => {
    for (const p of flaggedPeople) {
      if (!mentionsPerson(text, p)) continue;
      const why = p.isMinorOrPrivateVictim ? "a minor or private victim" : "a non-public person (no person-ack)";
      add(item("h", where, surface, text, "fact", "private_person_named", "high", [p.id], `names ${p.id}, ${why}`, "remove the name or describe the role", p.id));
    }
  };
  const numberRisk = (text: string, factIds: readonly string[], where: string, surface: FactCheckItem["surface"]) => {
    const found = extractNumbers(text);
    if (found.length === 0) return;
    const allowed = allowedNumbers(fs, factIds);
    for (const n of found) {
      if (matchesAny(n, allowed)) continue;
      add(item("b", where, surface, text, "number", "unsupported", "medium", [...factIds],
        `"${n.raw.trim()}" matches no figure or date among the cited facts (${factIds.join(", ") || "none"})`, "", n.raw.trim()));
    }
  };

  // ---- narration and clips
  for (const ch of script.chapters) {
    ch.segments.forEach((seg, k) => {
      if (seg.type === "clip") {
        const q = seg.quoteId ? quotes.get(seg.quoteId) : undefined;
        if (!q || normWs(seg.displayText) !== normWs(q.verbatim)) {
          add(item("a", seg.id, "clip-quote", seg.displayText, "quote", "quote_mismatch", "high", seg.quoteId ? [seg.quoteId] : [],
            q ? `clip text differs from the verbatim of ${q.id}` : `clip quote ${seg.quoteId ?? "(none)"} is not in the fact sheet`,
            q ? q.verbatim : ""));
        }
        if (seg.quoteId) quoteRisk(seg.quoteId, seg.id, "clip-quote", seg.displayText);
        if (seg.subtitleTranslation.trim()) personRisk(seg.subtitleTranslation, seg.id, "clip-quote");
        return;
      }
      if (seg.type !== "narration") return;
      const text = seg.displayText;
      for (const sen of splitSentences(text)) numberRisk(sen, seg.factIds, seg.id, "narration");
      const next = ch.segments.slice(k + 1).find((s) => s.type === "narration");
      for (const f of seg.factIds) {
        const c = claims.get(f);
        if (!c) continue;
        if (c.sensitivity === "high" && !ATTRIBUTION[lang].test(text)) {
          add(item("c", seg.id, "narration", text, "allegation", "needs_attribution", "high", [c.id],
            `cites ${c.id} (high sensitivity, ${c.status}) without attribution or status wording`, "", c.id));
        }
        if (c.subjectResponse.trim() !== "") {
          const both = `${text} ${next?.displayText ?? ""}`;
          const words = c.subjectResponse.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 5);
          const overlap = words.length > 0 ? words.filter((w) => both.toLowerCase().includes(w)).length / words.length : 0;
          if (!DENIAL[lang].test(both) && overlap < 0.4) {
            add(item("d", seg.id, "narration", text, "allegation", "needs_attribution", "medium", [c.id],
              `${c.id} has a response from the subject that is not mentioned in this or the next segment`, "", c.id));
          }
        }
      }
      for (const f of seg.factIds) if (f.startsWith("Q")) quoteRisk(f, seg.id, "narration", text);
      personRisk(text, seg.id, "narration");
    });
  }

  // ---- on-screen text (beats of this language)
  const textOf = new Map(i.slices.texts.filter((t) => t.lang === lang).map((t) => [t.beatId, t]));
  for (const plan of i.plans.plans) {
    const t = textOf.get(plan.id);
    const strings = onScreenStrings(plan, t, people);
    const claimIds = plan.factIds.filter((f) => claims.has(f));
    const established = claimIds.length > 0 && claimIds.every((c) => (ESTABLISHED_STATUSES as readonly string[]).includes(claims.get(c)!.status));
    for (const s of strings) {
      numberRisk(s, plan.factIds, plan.id, "on-screen");
      if (plan.personIds.length > 0 && ACCUSATORY[lang].test(s) && !established) {
        add(item("f", plan.id, "on-screen", s, "allegation", "needs_attribution", "high", [...plan.personIds, ...claimIds],
          "accusatory on-screen text about a person without an established (convicted / judicially found) claim"));
      }
      personRisk(s, plan.id, "on-screen");
    }
    const md = t?.motionData ?? {};
    const qids = new Set<string>();
    if (plan.quoteId) qids.add(plan.quoteId);
    for (const [k, v] of Object.entries(md)) if (k === "quote_id" && typeof v === "string" && v) qids.add(v);
    if (Array.isArray(md.items)) for (const it of md.items as { quote_id?: unknown }[]) if (typeof it.quote_id === "string" && it.quote_id) qids.add(it.quote_id);
    for (const q of qids) quoteRisk(q, plan.id, "on-screen", strings[0] ?? t?.text ?? plan.id);
  }

  // ---- publish info
  if (i.publish) {
    const pubs: [FactCheckItem["surface"], string][] = [["title", i.publish.title], ["thumbnail", i.publish.thumbnailText], ["description", i.publish.description]];
    for (const [surface, text] of pubs) {
      if (!text.trim()) continue;
      const sentences = surface === "description" ? splitSentences(text) : [text.trim()];
      for (const s of sentences) {
        if (ACCUSATORY[lang].test(s) && (surface !== "description" || !ATTRIBUTION[lang].test(s))) {
          add(item("e", surface, surface, s, "allegation", "needs_attribution", "high", [], `accusatory wording in the ${surface}`));
        }
      }
      personRisk(text, surface, surface);
    }
  }
  return out;
}

/** Carries `resolution` and `note` over from a previous fact-check for matching ids. */
export function carryOverResolutions(items: FactCheckItem[], previous: FactCheck | null): FactCheckItem[] {
  if (!previous) return items;
  const prev = new Map(previous.items.map((x) => [x.id, x]));
  return items.map((x) => {
    const p = prev.get(x.id);
    return p ? { ...x, resolution: p.resolution, note: p.note } : x;
  });
}
