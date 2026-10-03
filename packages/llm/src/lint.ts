// Deterministic script lint (§6.6) and outline validation (§6.3). Ported from $SP/script-pipeline/budget-and-lint.ts.
import {
  validateLangParity, type ChapterScript, type FactSheet, type Lang, type LintIssue, type Outline, type Script,
  type ScriptProfile, type StyleData,
} from "@docmaker/core";
import {
  ACCUSATORY, AND_THEN, ATTRIBUTION, ATTRIBUTION_REQUIRED_STATUSES, BANNED_OPENERS, countWords, splitSentences,
} from "./lexicon";
import { mentionsPerson, normWs, sharedNameTokens } from "./text";

const issue = (level: LintIssue["level"], rule: string, where: string, msg: string): LintIssue => ({ level, rule, where, msg });
const clipSecOf = (text: string, cps: number) => Math.max(4, text.length / cps + 1);
const EXIT_DEVICES = new Set(["cliffhanger", "open_loop", "re_hook"]);
const normPhrase = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");

export interface LintScriptInput {
  lang: Lang;
  profile: ScriptProfile;
  outline: Outline;
  chapters: ChapterScript[];
  facts: FactSheet;
  cps?: number;
  /** Secondary languages: the primary-language chapters (enables the lang-parity rule). */
  primary?: ChapterScript[];
}

export function lintScript(i: LintScriptInput): LintIssue[] {
  const { lang, profile, outline, facts } = i;
  const cps = i.cps ?? profile.charsPerSec[lang];
  const out: LintIssue[] = [];
  const planById = new Map(outline.chapters.map((c) => [c.id, c]));
  const quotes = new Map(facts.quotes.map((q) => [q.id, q]));
  const claims = new Map(facts.claims.map((c) => [c.id, c]));
  const privatePeople = facts.people.filter((p) => p.isMinorOrPrivateVictim);
  const sharedTokens = sharedNameTokens(facts.people, privatePeople);
  const banned = profile.bannedPhrases[lang].map(normPhrase);
  const present = new Set(i.chapters.map((c) => c.chapterId));
  const complete = outline.chapters.every((c) => present.has(c.id));
  const firstAct = outline.chapters[0]?.act;

  // program time at the first linted chapter (outline targets of the chapters before it)
  const firstIdx = outline.chapters.findIndex((c) => c.id === i.chapters[0]?.chapterId);
  let t = firstIdx > 0 ? outline.chapters.slice(0, firstIdx).reduce((a, c) => a + c.targetSec, 0) : 0;
  let lastDevice = t;
  let clipSec = 0;
  const opened = new Map<string, number>();
  const closed = new Map<string, number>();

  i.chapters.forEach((ch, chIdx) => {
    const plan = planById.get(ch.chapterId);
    const chStart = t;
    let chars = 0;
    let andThenRun = 0;
    const sentLens: number[] = [];
    ch.segments.forEach((s, k) => {
      let dur = 0;
      if (s.type === "narration") {
        const text = s.displayText;
        dur = text.length / cps;
        chars += text.length + 1;
        for (const sen of splitSentences(text)) {
          sentLens.push(countWords(sen));
          andThenRun = AND_THEN[lang].test(sen) ? andThenRun + 1 : 0;
          if (andThenRun >= 2) out.push(issue("warn", "and-then-chain", s.id, `"and then" chain — use BUT/THEREFORE causality: "${sen.slice(0, 60)}"`));
          if (ACCUSATORY[lang].test(sen) && !ATTRIBUTION[lang].test(sen)) {
            out.push(issue("error", "accusatory-unattributed", s.id, `accusatory wording without attribution or legal status: "${sen.slice(0, 90)}"`));
          }
        }
        if (t < 60 && BANNED_OPENERS[lang].test(text)) out.push(issue("error", "banned-opener", s.id, "generic intro / CTA inside the first 60 s"));
        const low = normPhrase(text);
        for (const b of banned) if (b && low.includes(b)) out.push(issue("warn", "banned-phrase", s.id, `banned phrase "${b}"`));
        if (/\d/.test(text) && s.factIds.length === 0) out.push(issue("error", "number-without-fact", s.id, "a number in narration without fact ids"));
        for (const f of s.factIds) {
          const c = claims.get(f);
          if (c && (ATTRIBUTION_REQUIRED_STATUSES as readonly string[]).includes(c.status) && !ATTRIBUTION[lang].test(text)) {
            out.push(issue("error", "status-wording", s.id, `claim ${c.id} is "${c.status}" but the segment has no attribution or status wording`));
          }
        }
        for (const p of privatePeople) {
          if (mentionsPerson(text, p, { strict: true, ignoreTokens: sharedTokens })) out.push(issue("error", "private-person", s.id, `names ${p.id}, a minor or private victim`));
        }
      } else if (s.type === "clip") {
        const q = s.quoteId ? quotes.get(s.quoteId) : undefined;
        dur = clipSecOf(s.displayText, cps);
        clipSec += dur;
        if (!q) {
          out.push(issue("error", "clip-quote", s.id, `clip quote ${s.quoteId ?? "(none)"} is not in the fact sheet`));
        } else {
          if (normWs(s.displayText) !== normWs(q.verbatim)) out.push(issue("error", "clip-quote", s.id, `clip text differs from the verbatim of ${q.id}`));
          if (q.language !== lang && s.subtitleTranslation.trim() === "") {
            out.push(issue("error", "clip-translation", s.id, `quote ${q.id} is in "${q.language}": a ${lang} subtitle translation is required`));
          }
        }
        const next = ch.segments[k + 1];
        if (!next || next.type !== "narration") {
          out.push(issue("error", "clip-commentary-follows", s.id, "a clip must be followed by narrator commentary in the same chapter"));
        }
      } else if (s.type === "music_breath") {
        dur = s.breathMs / 1000;
      }
      if (s.device !== "none" || s.type === "clip") {
        if (t - lastDevice > profile.maxGapNoDeviceSec) {
          out.push(issue("warn", "device-gap", s.id, `${Math.round(t - lastDevice)} s without re-hook, loop, clip or reveal`));
        }
        lastDevice = t + dur;
      }
      t += dur;
    });
    const chDur = t - chStart;
    if ((plan?.act === firstAct && plan?.id === outline.chapters[0]?.id) || (chIdx === 0 && firstIdx === 0 && !plan)) {
      if (chDur > profile.hookMaxSec) out.push(issue("warn", "hook-too-long", ch.chapterId, `cold open ≈ ${Math.round(chDur)} s > ${profile.hookMaxSec} s`));
    }
    if (plan) {
      const target = plan.targetSec * cps;
      if (target > 0 && Math.abs(chars - target) / target > 0.12) {
        out.push(issue("warn", "length-off-target", ch.chapterId, `≈ ${Math.round(chars)} chars vs target ${Math.round(target)} (± 12 %)`));
      }
    }
    if (sentLens.length > 0) {
      const mean = sentLens.reduce((a, b) => a + b, 0) / sentLens.length;
      if (mean < profile.sentenceWords[0] || mean > profile.sentenceWords[1]) {
        out.push(issue("warn", "sentence-length", ch.chapterId, `mean sentence ${mean.toFixed(1)} words (target ${profile.sentenceWords[0]}–${profile.sentenceWords[1]})`));
      }
    }
    const last = [...ch.segments].reverse().find((s) => s.type === "narration" || s.type === "clip");
    if (plan?.adBreakAfter && (!last || !EXIT_DEVICES.has(last.device))) {
      out.push(issue("error", "adbreak-no-cliffhanger", ch.chapterId, "an ad break must follow a cliffhanger, open loop or re-hook"));
    }
    for (const l of ch.loopsOpened) if (!opened.has(l)) opened.set(l, chIdx);
    for (const l of ch.loopsClosed) {
      if (!opened.has(l) && !outline.loops.some((x) => x.id === l && present.has(x.openedIn) === false)) {
        out.push(issue("warn", "loop-order", ch.chapterId, `loop ${l} closed before it was opened`));
      }
      if (!closed.has(l)) closed.set(l, chIdx);
    }
  });

  for (const [l] of opened) {
    if (closed.has(l)) continue;
    const planned = outline.loops.find((x) => x.id === l)?.closedIn ?? outline.chapters[outline.chapters.length - 1]?.id;
    if (complete || (planned !== undefined && present.has(planned))) {
      out.push(issue("error", "loop-unpaid", "global", `open loop ${l} is never paid off`));
    }
  }
  const outlineIds = new Set(outline.chapters.map((c) => c.id));
  for (const h of outline.hookTeasers) {
    if (!outlineIds.has(h.paidOffIn) || (complete && !present.has(h.paidOffIn))) {
      out.push(issue("error", "teaser-unpaid", "global", `hook teaser ${h.id} is not paid off ("${h.teaser.slice(0, 60)}")`));
    }
  }
  const runtime = outline.budgets[lang]?.runtimeSec ?? outline.budget.runtimeSec;
  if (runtime > 0 && clipSec > 0) {
    const share = clipSec / runtime;
    if (share > profile.maxClipShare.error) out.push(issue("error", "clip-share", "global", `clips ≈ ${(share * 100).toFixed(0)} % of the runtime (max ${profile.maxClipShare.error * 100} %)`));
    else if (share > profile.maxClipShare.warn) out.push(issue("warn", "clip-share", "global", `clips ≈ ${(share * 100).toFixed(0)} % of the runtime (aim ≤ ${profile.maxClipShare.warn * 100} %)`));
  }
  if (i.primary) {
    const primChapters = i.primary.filter((c) => present.has(c.chapterId));
    const fake = (l: Lang, chapters: ChapterScript[]) => ({ lang: l, chapters }) as unknown as Script;
    const primLang: Lang = lang === "en" ? "fr" : "en";
    for (const p of validateLangParity(fake(primLang, primChapters), fake(lang, i.chapters))) out.push({ ...p, rule: "lang-parity", level: "error" });
  }
  return out;
}

// ---------------------------------------------------------------- outline validation
export function validateOutline(o: Outline, style: StyleData): LintIssue[] {
  const out: LintIssue[] = [];
  const p = style.scriptProfile;
  const shape = p.storyShapes.find((s) => s.id === o.storyShape);
  if (!shape) {
    out.push(issue("error", "outline-shape", "global", `story shape "${o.storyShape}" is not defined by style ${style.manifest.id}`));
  } else {
    const acts = new Set(shape.acts.map((a) => a.id));
    for (const c of o.chapters) if (!acts.has(c.act)) out.push(issue("error", "outline-act", c.id, `act "${c.act}" is not part of shape ${shape.id}`));
    if (o.chapters[0] && o.chapters[0].act !== shape.acts[0]!.id) {
      out.push(issue("warn", "outline-cold-open", o.chapters[0].id, `the first chapter should be the "${shape.acts[0]!.id}" act`));
    }
    const order = shape.acts.map((a) => a.id);
    for (let k = 1; k < o.chapters.length; k++) {
      if (order.indexOf(o.chapters[k]!.act) < order.indexOf(o.chapters[k - 1]!.act)) {
        out.push(issue("warn", "outline-act-order", o.chapters[k]!.id, `act "${o.chapters[k]!.act}" comes after "${o.chapters[k - 1]!.act}" in the shape`));
      }
    }
  }
  o.chapters.forEach((c, k) => {
    if (c.id !== `CH${k + 1}`) out.push(issue("error", "outline-ids", c.id, `chapter ${k + 1} must have id CH${k + 1}`));
  });
  const sum = o.chapters.reduce((a, c) => a + c.targetWords, 0);
  if (o.budget.words > 0 && Math.abs(sum - o.budget.words) / o.budget.words > 0.05) {
    out.push(issue("error", "outline-words", "global", `Σ chapter target_words = ${sum} vs budget ${o.budget.words} (± 5 %)`));
  }
  const acpw = p.avgCharsPerWord[o.lang];
  for (const c of o.chapters) {
    const expect = (c.targetWords * acpw) / o.budget.charsPerSec;
    if (Math.abs(expect - c.targetSec) > 0.5) out.push(issue("warn", "outline-target-sec", c.id, `targetSec ${c.targetSec} ≠ targetWords·avgCharsPerWord/cps ≈ ${expect.toFixed(1)}`));
  }
  const idx = new Map(o.chapters.map((c, k) => [c.id, k]));
  for (const h of o.hookTeasers) if (!idx.has(h.paidOffIn)) out.push(issue("error", "teaser-unpaid", "global", `teaser ${h.id} pays off in unknown chapter ${h.paidOffIn}`));
  for (const l of o.loops) {
    const a = idx.get(l.openedIn);
    const b = idx.get(l.closedIn);
    if (a === undefined || b === undefined) out.push(issue("error", "loop-unpaid", l.id, `loop ${l.id} references an unknown chapter`));
    else if (b < a) out.push(issue("error", "loop-order", l.id, `loop ${l.id} closes (${l.closedIn}) before it opens (${l.openedIn})`));
  }
  const loopIds = new Set(o.loops.map((l) => l.id));
  for (const c of o.chapters) {
    for (const l of [...c.opensLoops, ...c.closesLoops]) if (!loopIds.has(l)) out.push(issue("warn", "outline-loop-ref", c.id, `chapter references undeclared loop ${l}`));
  }
  // ad breaks on the runtime clock (narration seconds / narrationShare)
  let t = 0;
  let lastBreak: number | null = null;
  for (const c of o.chapters) {
    t += c.targetSec / Math.max(0.1, p.narrationShare);
    if (!c.adBreakAfter) continue;
    if (lastBreak === null) {
      if (t < p.adBreaks.firstAfterSec[0] || t > p.adBreaks.firstAfterSec[1]) {
        out.push(issue("warn", "outline-adbreak", c.id, `first ad break at ≈ ${Math.round(t)} s (aim ${p.adBreaks.firstAfterSec[0]}–${p.adBreaks.firstAfterSec[1]} s)`));
      }
    } else if (t - lastBreak < p.adBreaks.everySec[0] || t - lastBreak > p.adBreaks.everySec[1]) {
      out.push(issue("warn", "outline-adbreak", c.id, `ad break ${Math.round(t - lastBreak)} s after the previous one (aim ${p.adBreaks.everySec[0]}–${p.adBreaks.everySec[1]} s)`));
    }
    lastBreak = t;
  }
  if (lastBreak === null && o.budget.runtimeSec >= 480) {
    out.push(issue("warn", "outline-adbreak", "global", "no ad break planned in a video of 8 minutes or more"));
  }
  return out;
}
