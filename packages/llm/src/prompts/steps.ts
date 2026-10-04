// Step prompts. The first eight templates are ported verbatim from $SP/script-pipeline/prompts.ts; the rest are the §6.5
// additions. Convention: SYSTEM (role + rules + style guide + fact sheet [+ outline]) is the cached stable prefix;
// everything step-specific goes into the user turn.
import type { Lang } from "@docmaker/core";

const langName = (lang: Lang) => (lang === "fr" ? "French" : "English");

// ---------------------------------------------------------------- step 1a: research dossier (server tools)
export const RESEARCH_USER = (topic: string, lang: Lang, minutes: number): string => `<topic>${topic}</topic>
Build a research dossier for a ${minutes}-minute YouTube documentary in ${lang === "fr" ? "French" : "English"} (drama/commentary genre).
Search in English AND in ${lang === "fr" ? "French" : "the subject's local language"}; prefer primary sources (court judgments/filings,
official statements, the person's own interviews/posts) and established outlets; use tabloids/forums only as leads, labelled as such.
Fetch the primary documents behind the biggest claims (judgments are often PDFs).
Cover, with dates and sources: 1) chronological timeline from origins to today, 2) key people and their roles, 3) verbatim quotes that exist
ON VIDEO (interviews, testimony, news clips) with where to find them, 4) numbers (money, ratings, sales, sentences, followers) with "as of" dates,
5) every controversy/legal matter with its CURRENT status, who decided it, and the subject's response, 6) the strongest dramatic turning points,
ironies and reversals, 7) what remains unverified or disputed.
Write the dossier as dense notes, one claim per line, each cited. Flag contradictions between sources explicitly.`;

/** Claude Code research (no API citations): the URL markers the registry is rebuilt from, and the tool budget. */
export const RESEARCH_CLAUDE_CODE = (maxSearches: number, maxFetches: number): string => `
Tools: at most ${maxSearches} web searches and ${maxFetches} page fetches. When you fetch a page, ask for the passages, dates, numbers and
verbatim quotes you need from it.
Citations: right after each claim, put the exact URL of the source that supports it in square brackets, e.g. "… in 2016. [https://example.org/page]".
Cite only URLs that appeared in your search results or that you fetched; never cite from memory.
When you are done, reply with the complete dossier as your final message: no preamble, no closing remarks.`;

// ---------------------------------------------------------------- step 1b: dossier -> FactSheet (structured output, no tools)
export const FACTSHEET_USER = (dossier: string, sourceList: string, asOf: string): string => `<dossier>${dossier}</dossier>
<source_list>${sourceList}</source_list>
Convert the dossier into the fact sheet schema. Use ONLY source ids from <source_list> (built from the citations of the research turn);
an item with no supporting source id must go to "gaps" instead. Keep quotes verbatim in their original language.
Set claim status precisely (allegation vs judicial finding vs conviction vs settlement) and record the subject's response.
as_of = ${asOf}. Rate drama_value honestly: reversals, ironies and stakes score high; routine events score low.`;

// ---------------------------------------------------------------- step 2: style suggestion
export const STYLE_USER = (topic: string, registry: string): string => `<style_registry>${registry}</style_registry>
<topic>${topic}</topic>
Classify the topic, rank every style in the registry for it (score 0-1, one-sentence reason), recommend one style and a runtime,
propose 5 titles in the project language (curiosity gap, <= 60 chars, no claim the fact sheet cannot support) and 5 thumbnail texts (<= 4 words).
List risk flags honestly; they change how the script is written, not whether the video gets made.`;

// ---------------------------------------------------------------- step 3: outline
export const OUTLINE_USER = (budgetJson: string, lang: Lang): string => `<budget>${budgetJson}</budget>
Design the outline of the video in ${lang === "fr" ? "French" : "English"} using the story shape in <style_guide> and the word budget per act in <budget>.
- Cold open: start at the most dramatic present-day fact (rock bottom or the central irony), contrast it with the peak, list 3-6 escalating
  teasers that the body will pay off, and end on a one-sentence promise of what the video explains. No channel intro, no CTA.
- Each chapter is one escalation step with its own mini-arc (setup -> complication -> exit hook) and causal links between beats
  (BUT / THEREFORE, never AND THEN).
- Open the central question early and close it in act 3. Every teaser and loop gets a planned payoff chapter.
- Plan a false-hope / redemption beat before the final collapse if the facts support one (never invent one).
- Mark ad_break_after on the first chapter that ends on a strong cliffhanger after ~3-5 minutes, then every ~8-10 minutes.
- Act 3 returns to the cold-open moment (full circle), states the CURRENT status precisely, delivers the thesis, and bridges to a related video.
Return the outline schema.`;

// ---------------------------------------------------------------- step 4: chapter writer
export const CHAPTER_USER = (p: { chapterJson: string; previousTail: string; storySoFar: string; openLoops: string; targetWords: number; lang: Lang }): string => `
<chapter_plan>${p.chapterJson}</chapter_plan>
<story_so_far>${p.storySoFar}</story_so_far>
<previous_chapter_last_lines>${p.previousTail}</previous_chapter_last_lines>
<open_loops>${p.openLoops}</open_loops>
Write this chapter as voice-over for a ${p.lang === "fr" ? "French" : "English"} narrator, ${p.targetWords} words (+/-8%) of narration, continuing
seamlessly from the previous lines (no recap, no "welcome back").
Voice: spoken, punchy, varied rhythm - mostly 8-18-word sentences with regular 2-5-word punches; concrete numbers and names;
the narrator reacts after clips with a short opinionated line. Something must shift at least every 60-90 seconds of narration
(new fact, reversal, question, clip, reveal). End on the planned exit hook.
Use "clip" segments for quotes in the plan (text = the verbatim quote, quote_id set) and set them up in the preceding narration.
Tag segments with the device they perform and the fact ids they rely on. Write every figure (amount, count, date, multiple)
in digits - "5,500 guilders", "1637", "10 times" - never spelled out: the voice step speaks them, and digits are checked against the fact sheet.`;

// ---------------------------------------------------------------- step 5: beat director
export const BEATS_USER = (p: { chapterScriptJson: string; visualGrammar: string; isHook: boolean }): string => `
<chapter_script>${p.chapterScriptJson}</chapter_script>
<visual_grammar>${p.visualGrammar}</visual_grammar>
Split every narration segment into beats: one beat = one visual idea, ${p.isHook ? "1-2.5 s (hook pace)" : "2-6 s, ~3 s average"}.
Beat texts must be exact consecutive slices of the narration (their concatenation must reproduce the segment exactly).
For each beat choose the most specific visual available: the real archival photo/footage of the named person or event first,
then a YouTube clip (give the verbatim words to find), then a motion graphic for numbers/timelines/documents/posts
(fill motion_data_json from fact-sheet values only), then literal stock b-roll (concrete nouns, English query).
Never request an AI image of a real person. Emphasis words = the 1-3 words a viewer must catch (numbers, names, verbs of action).
Sound design is punctuation, not wallpaper: whoosh on transitions, impact/sub-boom on reveals and numbers, riser into cliffhangers,
silence_drop or music drop_out right before the biggest reveal of the chapter, record_scratch for comedic reversals.
Change music mood only at act or tone shifts.`;

// ---------------------------------------------------------------- step 6: fact-check / lawyer pass
export const FACTCHECK_USER = (scriptJson: string, title: string, thumbText: string): string => `<script>${scriptJson}</script>
<title>${title}</title><thumbnail_text>${thumbText}</thumbnail_text>
Audit the script against <fact_sheet> as two people: a fact-checker and the subject's defamation lawyer.
For every sentence that asserts a fact, quotes, gives a number, or characterises a person's conduct or health: check support in the fact sheet,
check the wording matches the claim status and date, check denials/outcomes are present, check opinions are signposted and fact-based,
check quotes match verbatim. Also audit the title and thumbnail text (they are publications too).
Only list problems (supported sentences can be omitted). For each, give a minimal rewrite that keeps the energy of the line.
Put search queries that could resolve unsupported items in needs_more_research.`;

// ================================================================ §6.5 additions
export const SYSTEM_ROLE = (styleName: string, lang: Lang, persona: string): string =>
  `You are the head writer of a ${styleName} YouTube documentary channel (${lang}). ${persona}`.trim();

export const RESEARCH_ROLE = "You are the lead researcher of a documentary YouTube channel.";

export const CHAPTER_SECONDARY = (skeletonJson: string, lang: Lang): string => `
<segment_skeleton>${skeletonJson}</segment_skeleton>
Write natively in ${langName(lang)} (transcreation, not translation). Keep EXACTLY these segment ids, types, quote ids and order;
you may change sentence count inside a segment. Clip segments: keep the verbatim quote in its original language and
put a natural ${langName(lang)} subtitle in subtitle_translation (empty if same language). Return the chapter title in ${langName(lang)}.`;

export const CHAPTER_FIRST = (lang: Lang): string => `
This is the first chapter: also return the video title in ${langName(lang)} in video_title (curiosity gap, <= 60 chars, supported by the fact sheet).`;

export const REVISE_USER = (chapterJson: string, issuesJson: string): string => `<chapter_script>${chapterJson}</chapter_script><lint_issues>${issuesJson}</lint_issues>
Fix every error-level issue with the smallest change that keeps the voice and energy; keep segment ids; return the full chapter.`;

export const BEATS_EXTRA = (formats: string): string => `
Tag cue_tags from this closed list: HOOK, EMPHASIS, REVEAL, SHOCK, TENSION_BUILD, NUMBER(value), PERSON_INTRO(name),
PLACE(name), TIME_JUMP(date), QUOTE(source), DOCUMENT, ARTICLE, TWEET, CLIP_REF, LIST, COMPARISON, IRONY, FLASHBACK,
CHAPTER, SENSITIVE (value "bleep" only for a profanity INSIDE a quoted passage), MONTAGE. \`word\` = the exact word of the
beat text it lands on ("" = beat start). REVEAL and SHOCK <= 1 per chapter each; EMPHASIS on <= 1 beat in 3.
Every motion graphic that quotes someone, shows a headline or shows a number MUST reference the fact sheet:
quote_card/tweet_card/comment_pile -> quote_id (text = the verbatim quote), headline_stack -> source_id per item,
document_highlight -> source_id (+ quote_id for the highlighted passage), counter/money_counter/bar_chart -> figure_id.
Never invent tweets, headlines, document lines or numbers. motion_data_json formats: ${formats}`;

export const BEATS_REPAIR = (issuesJson: string): string => `
<validation_issues>${issuesJson}</validation_issues>
Your previous beats failed validation. Return all beats again; beat texts MUST be exact consecutive slices of each narration segment.`;

export const BEATSLICE_USER = (p: { beatsJson: string; segmentsJson: string; lang: Lang }): string => `<beats>${p.beatsJson}</beats> <segments_${p.lang}>${p.segmentsJson}</segments_${p.lang}>
Cut each ${langName(p.lang)} segment into exactly the same beat ids, in order, as exact contiguous slices that reconstruct the segment.
Translate on_screen_text and motion_data_json display strings only (never numbers or ids); give emphasis and cue anchor words in ${langName(p.lang)}.`;

export const FACTCHECK_EXTRA = (p: { narrationJson: string; onScreenJson: string; publishJson: string }): string => `
<narration>${p.narrationJson}</narration> <on_screen>${p.onScreenJson}</on_screen> <publish>${p.publishJson}</publish>
Check on-screen text with the same rigour as narration: a card, stamp or lower third is a publication.
For each item set where (segment id, beat id for on-screen text, or title/thumbnail/description) and surface.`;

export const TRANSCREATE_USER = (p: { primaryJson: string; currentJson: string; lang: Lang }): string => `<primary_segment>${p.primaryJson}</primary_segment>
<current_${p.lang}_segment>${p.currentJson}</current_${p.lang}_segment>
The primary-language segment changed. Rewrite the ${langName(p.lang)} segment natively (transcreation, not translation) so it says what the
primary segment now says, keeping the voice of the current version. Clip segments: display_text stays the verbatim quote; put a natural
${langName(p.lang)} subtitle in subtitle_translation (empty if the quote is already in ${langName(p.lang)}).`;

export const RECHECK_USER = (claimsJson: string, asOf: string): string => `<claims>${claimsJson}</claims>
Today is ${asOf}. For each claim, search for its CURRENT legal or factual status (new rulings, charges dropped, appeals, settlements,
statements by the people concerned). Prefer court records, official statements and established outlets. Write dense notes, one claim per
paragraph, each cited; say explicitly when nothing changed.`;

export const RECHECK_STRUCT_USER = (notes: string, claimsJson: string, sourceList: string): string => `<recheck_notes>${notes}</recheck_notes>
<claims>${claimsJson}</claims><source_list>${sourceList}</source_list>
Return one entry per claim id with its current status, jurisdiction, decision date and subject response. changed = true only when
the notes document a change. source_urls: ONLY URLs from <source_list> that support the current status.`;

export const RERANK_USER = (p: { text: string; visualQuery: string; visualKind: string; identityHint: string }): string => `Beat narration: "${p.text}". Wanted visual: "${p.visualQuery}" (${p.visualKind}). Provenance identity hint: ${p.identityHint || "none"}.
Do NOT identify people from their faces; judge only relevance to the wanted visual and technical quality.
Score each image: relevance 0-10, technical quality 0-10, watermark/burned-in text, NSFW, best 16:9 crop and focal point (normalised).
Use the image numbers given before each image as index.`;

export const PASSAGE_USER = (verbatim: string, windowsJson: string): string => `Quote to find: "${verbatim}". Candidate transcript windows: ${windowsJson}. Pick the window that
contains the quote as spoken (wording may differ slightly in ASR). best_index = the window's index; confidence 0-1.`;
