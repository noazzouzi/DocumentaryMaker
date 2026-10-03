// Shared editorial rules (accuracy / defamation), ported verbatim from $SP/script-pipeline/prompts.ts, + safe messaging.
import type { Lang, RiskFlag } from "@docmaker/core";

export const L = (lang: Lang, en: string, fr: string): string => (lang === "fr" ? fr : en);

export const EDITORIAL_RULES = (lang: Lang, asOf: string): string => `<editorial_rules>
These videos are about REAL people. A single unsupported sentence can be defamatory, can get the video demonetised
or removed, and destroys viewer trust. The channel's edge is being savage about DOCUMENTED conduct, never inventing it.
1. Every factual statement must be traceable to ids in <fact_sheet> (S/E/N/C/Q). If it is not there, do not state it:
   cut it, or turn it into an explicitly labelled question or opinion.
2. Match wording to the legal/epistemic status of each claim (status as of ${asOf}):
   ${L(lang,
   `allegation -> "X alleged / accused ... (Y has denied this)"; charged -> "was charged with"; convicted -> "was convicted of ... by <court>, <year>";
   civil finding -> "<court> found, on the balance of probabilities, that ..."; settled -> "settled without admitting liability";
   dismissed / acquitted / appeal pending -> say it explicitly. Never turn an allegation into narrator fact ("he beat her").`,
   `allégation -> "X accuse Y de ... / Y aurait ..." (conditionnel journalistique) + "ce que Y conteste / a toujours nié";
   mise en examen / inculpation -> "a été mis en examen pour" (présumé innocent); condamnation -> "a été condamné par <juridiction> en <année>";
   décision civile -> "la justice <pays> a estimé que ..."; accord -> "un accord a été trouvé, sans reconnaissance de responsabilité";
   relaxe / acquittement / non-lieu / appel en cours -> le dire explicitement. Jamais d'allégation au présent de l'indicatif dans la bouche du narrateur.`)}
3. When a claim has a response or denial in the fact sheet, include it in the same passage. When sources conflict, give both and the outcome.
4. Opinion, sarcasm and jokes are welcome but must (a) be signposted as opinion, (b) rest on facts already stated, (c) target conduct,
   not identity, health, family or protected characteristics. No insults that imply undisclosed facts.
5. Never diagnose (addiction, mental illness, CTE...) unless the person disclosed it; expert speculation must be attributed and caveated.
6. Never name or describe private individuals, minors or alleged victims of sexual offences beyond what the fact sheet marks as public.
7. Quotes: verbatim from <fact_sheet> only, with quote_id. ${L(lang, "", "Une citation traduite de l'anglais est signalée comme traduction (sous-titres).")}
8. Numbers, dates, amounts: only from the fact sheet; give the "as of" date for anything that can change (net worth, trials, follower counts).
</editorial_rules>`;

/** Appended to EDITORIAL_RULES when riskFlags include suicide_self_harm (WHO/Samaritans safe-messaging guidance). */
export const SAFE_MESSAGING = (lang: Lang): string => `<safe_messaging>
${L(lang,
`This story involves suicide or self-harm. Never describe methods, locations or means; never present suicide as a solution,
an inevitable outcome or the result of a single cause; avoid sensational words ("epidemic", "successful attempt", "committed").
Prefer "died by suicide". Focus on the person's life and on help, recovery and warning signs. The video ends with a helpline card.`,
`Ce récit touche au suicide ou à l'automutilation. Ne jamais décrire de moyen, de lieu ni de méthode ; ne jamais présenter le suicide
comme une solution, une issue inévitable ou la conséquence d'une cause unique ; éviter le vocabulaire sensationnel (« épidémie »,
« a réussi », « s'est donné la mort » répété). Préférer « s'est suicidé » sobrement, ou « est mort par suicide ». Mettre l'accent sur la vie de
la personne, l'aide et les signes d'alerte. La vidéo se termine par une carte d'aide (numéro d'écoute).`)}
</safe_messaging>`;

/** EDITORIAL_RULES + the safe-messaging addendum when the project carries suicide_self_harm (§6.3/§14). */
export const editorialRules = (lang: Lang, asOf: string, riskFlags: readonly RiskFlag[] = []): string =>
  EDITORIAL_RULES(lang, asOf) + (riskFlags.includes("suicide_self_harm") ? `\n${SAFE_MESSAGING(lang)}` : "");

/** Fact-check addendum: audit narration and on-screen text against the safe-messaging rules. */
export const SAFE_MESSAGING_AUDIT = `
Also audit every narration sentence, on-screen text, stamp and translated subtitle against <safe_messaging>: any method, means,
location or step-by-step detail of suicide or self-harm, or wording that presents suicide as a solution, is an item
(risk "high", problem starting with "safe messaging:") with a rewrite that removes it.`;
