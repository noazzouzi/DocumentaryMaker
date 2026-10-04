// Beat relevance beyond word overlap (§7.6, keyless ranking): the beat's salient nouns, the story's era, places and
// currencies. Metadata-only ranking otherwise lets a Persian painting win a Dutch auction beat because its description says
// "17th century painting", or Danish coins illustrate guilders. A vision rerank score, when one exists, outranks all of this.
import type { BeatPlan, Candidate, FactSheet, Person } from "@docmaker/core";
import { candidateNamesPerson } from "./identity";
import { canonToken, matchQueryTokens, matchTokens, tokensOf } from "./util";

// ------------------------------------------------------------------------------------------------ vocabulary
/** Words that never make a query specific: media, framing, era words and generic document/scene nouns (EN/FR/DE/NL). */
const GENERIC = new Set([
  "painting", "painted", "watercolour", "watercolor", "illustration", "engraving", "etching", "drawing", "sketch", "photo", "photograph",
  "photography", "picture", "image", "close", "up", "closeup", "detail", "vintage", "archival", "archive", "archived", "old", "historic",
  "historical", "black", "white", "sepia", "footage", "shot", "view", "scene", "artwork", "art", "print", "lithograph", "woodcut", "portrait",
  "interior", "exterior", "background", "texture", "abstract", "document", "paper", "page", "record", "file", "century", "age", "era",
  "period", "aerial", "dark", "light", "single", "empty", "aquarelle", "peinture", "gravure", "dessin", "ancien", "ancienne", "vieux",
  "vieille", "tableau", "siecle", "epoque", "fond", "gemalde", "zeichnung", "stich", "foto", "bild", "alt", "alte", "jahrhundert", "schilderij",
  "tekening", "prent", "oud", "oude", "eeuw", "afbeelding",
].map(canonToken));
/** Words that name an era rather than a subject (a query's "seventeenth century" is handled by the era rule). */
const ERA_WORD = /^(?:\d+th|\d{3,4}s?|c\d{4})$/;

/** Place groups: names (countries, historic states, regions, major cities) are evidence of where a picture belongs;
 *  demonyms only say that a story or picture is connected to the place ("Chinese bowl" in a Dutch still life is no evidence). */
const PLACES: Record<string, { names: string; demonyms: string }> = {
  "low-countries": {
    names: "netherlands|holland|nederland|pays-bas|pays bas|niederlande|flanders|vlaanderen|flandre|flandres|flandern|amsterdam|haarlem|leiden|leyden|rotterdam|utrecht|delft|the hague|den haag|la haye|antwerp|antwerpen|anvers|brabant|zeeland|friesland|alkmaar|hoorn|enkhuizen|gouda|dordrecht",
    demonyms: "dutch|netherlandish|hollandish|nederlandse|nederlandsche|hollandse|hollands|neerlandais|neerlandaise|hollandais|hollandaise|niederlandisch|niederlandische|niederlandischen|hollandisch|flemish|vlaams|vlaamse|flamand|flamande|flamisch|flamische|amsterdammer",
  },
  belgium: { names: "belgium|belgique|belgien|belgie|brussels|bruxelles|brussel", demonyms: "belgian|belge|belgisch|belgische" },
  france: { names: "france|frankreich|frankrijk|paris|lyon|marseille|versailles|bordeaux", demonyms: "french|francais|francaise|franzosisch|franzosische|frans|franse|parisian|parisien" },
  germany: { names: "germany|allemagne|deutschland|duitsland|prussia|prusse|preussen|bavaria|baviere|bayern|berlin|hamburg|munich|munchen|cologne|koln|saxony|saxe|sachsen|frankfurt", demonyms: "german|allemand|allemande|deutsche|duits|duitse|prussian|bavarian|saxon" },
  austria: { names: "austria|autriche|osterreich|oostenrijk|vienna|vienne|wien|salzburg", demonyms: "austrian|autrichien|osterreichisch|oostenrijks" },
  czech: { names: "bohemia|boheme|bohmen|czechia|czech republic|tchequie|tschechien|tsjechie|moravia|prague|praha|prag", demonyms: "bohemian|czech|tcheque|tschechisch|tsjechisch|bohmisch" },
  poland: { names: "poland|pologne|polen|warsaw|varsovie|warschau|krakow|cracow|cracovie|gdansk|danzig", demonyms: "polish|polonais|polonaise|polnisch|pools|poolse" },
  hungary: { names: "hungary|hongrie|ungarn|hongarije|budapest", demonyms: "hungarian|hongrois|ungarisch|hongaars" },
  switzerland: { names: "switzerland|suisse|schweiz|zwitserland|geneva|geneve|genf|zurich|bern|basel|bale", demonyms: "swiss|zwitsers" },
  spain: { names: "spain|espagne|spanien|spanje|madrid|castile|castille|kastilien|seville|sevilla|toledo|barcelona", demonyms: "spanish|espagnol|espagnole|spanisch|spaans|spaanse|castilian" },
  portugal: { names: "portugal|lisbon|lisboa|lisbonne|lissabon|porto", demonyms: "portuguese|portugais|portugaise|portugiesisch|portugees" },
  italy: { names: "italy|italie|italien|rome|roma|venice|venezia|venise|venedig|florence|firenze|florenz|milan|milano|mailand|naples|napoli|neapel|genoa|genova|tuscany|toscane|toskana", demonyms: "italian|italienne|italienisch|italiaans|italiaanse|venetian|venitien|florentine|roman|romain" },
  britain: { names: "england|britain|great britain|united kingdom|scotland|wales|ireland|angleterre|ecosse|royaume-uni|grande-bretagne|irlande|schottland|grossbritannien|irland|engeland|schotland|ierland|london|londres|londen|edinburgh|dublin|oxford|liverpool|manchester", demonyms: "british|scottish|scots|welsh|irish|anglais|anglaise|ecossais|ecossaise|irlandais|englisch|schottisch|britisch|engelse|schots|brits|iers|ierse|londoner" },
  scandinavia: { names: "denmark|danemark|danmark|denemarken|sweden|suede|schweden|zweden|sverige|norway|norvege|norwegen|noorwegen|norge|finland|finlande|finnland|iceland|islande|ijsland|copenhagen|copenhague|kopenhagen|kobenhavn|stockholm|oslo|scandinavia|scandinavie|skandinavien", demonyms: "danish|dane|danois|danoise|danisch|deens|deense|swedish|swede|suedois|suedoise|schwedisch|zweeds|zweedse|norwegian|norvegien|norwegisch|noors|noorse|finnish|icelandic|scandinavian|scandinave|skandinavisch" },
  russia: { names: "russia|russie|russland|rusland|muscovy|moscow|moscou|moskau|moskou|st petersburg|saint petersburg|saint-petersbourg|sankt petersburg", demonyms: "russian|russe|russisch|russische|muscovite" },
  ottoman: { names: "ottoman empire|turkey|turquie|turkei|turkije|anatolia|anatolie|istanbul|constantinople|konstantinopel", demonyms: "ottoman|ottomane|osmanisch|turkish|turc|turque|turkisch|turks" },
  persia: { names: "persia|perse|persien|perzie|iran|isfahan|ispahan|tehran|teheran|shiraz|tabriz", demonyms: "persian|persan|persane|persisch|perzisch|iranian|iranien|safavid|safavide|qajar" },
  india: { names: "mughal empire|delhi|bengal|bombay|mumbai|calcutta|kolkata|madras|rajasthan|agra", demonyms: "mughal|mogul|moghol|bengali" },
  china: { names: "china|chine|peking|beijing|pekin|nanjing|shanghai|guangzhou|hong kong", demonyms: "chinese|chinois|chinoise|chinesisch|chinees" },
  japan: { names: "japan|japon|tokyo|edo|kyoto|osaka|nagasaki", demonyms: "japanese|japonais|japonaise|japanisch|japans|japanse" },
  indonesia: { names: "indonesia|indonesie|indonesien|java|sumatra|bali|jakarta|batavia|moluccas|molukken", demonyms: "indonesian|javanese|javanais|balinese" },
  usa: { names: "united states|usa|u.s.a.|america|etats-unis|vereinigte staaten|verenigde staten|amerika|new york|washington|california|texas|chicago|boston|philadelphia|massachusetts", demonyms: "american|americain|americaine|amerikanisch|amerikaans|amerikaanse" },
  canada: { names: "canada|kanada|quebec|toronto|montreal", demonyms: "canadian|canadien|canadienne|kanadisch" },
  mexico: { names: "mexico|mexique|mexiko", demonyms: "mexican|mexicain|mexicaine|mexikanisch|mexicaans" },
  "south-america": { names: "brazil|bresil|brasilien|brazilie|argentina|argentine|argentinien|peru|perou|chile|colombia|colombie|bolivia|bolivie|venezuela|rio de janeiro|buenos aires", demonyms: "brazilian|bresilien|argentinian|argentine|peruvian|chilean" },
  egypt: { names: "egypt|egypte|agypten|egypte|cairo|le caire|kairo|alexandria", demonyms: "egyptian|egyptien|egyptienne|agyptisch|egyptisch" },
  greece: { names: "greece|grece|griechenland|griekenland|athens|athenes|athen", demonyms: "greek|grec|grecque|griechisch|grieks" },
  africa: { names: "south africa|afrique du sud|sudafrika|zuid-afrika|nigeria|kenya|ethiopia|ethiopie|morocco|maroc|marokko|algeria|algerie|tunisia|tunisie|congo|ghana", demonyms: "african|africain|afrikanisch|afrikaans|moroccan|marocain|algerian|algerien" },
  oceania: { names: "australia|australie|australien|new zealand|nouvelle-zelande|neuseeland|nieuw-zeeland|sydney|melbourne", demonyms: "australian|australien|australienne|australisch" },
  korea: { names: "korea|coree|seoul", demonyms: "korean|coreen|koreanisch|koreaans" },
  "middle-east": { names: "arabia|arabie|saudi arabia|syria|syrie|syrien|iraq|irak|lebanon|liban|israel|palestine|jerusalem|damascus|damas|baghdad|bagdad", demonyms: "arabian|syrian|iraqi|lebanese|israeli|palestinian" },
};
/** Currency groups (EN/FR/DE/NL, folded): a picture of a foreign currency never illustrates the story's money. */
const CURRENCIES: Record<string, RegExp> = {
  guilder: /\b(?:guilders?|gulden|florins?|stuivers?|rijksdaalders?)\b/,
  krone: /\b(?:krone|kroner|kronor|krona|kronur|kronen|\d+ ?kr)\b/,
  dollar: /\bdollars?\b|\$ ?\d/,
  euro: /\b(?:euros?|eurocents?)\b|€/,
  sterling: /\b(?:sterling|shillings?|pence|farthings?)\b|£ ?\d/,
  franc: /\b(?:francs?|centimes?)\b/,
  mark: /\b(?:reichsmarks?|deutsche marks?|deutschmarks?|pfennigs?|rentenmarks?|ostmarks?)\b/,
  yen: /\byen\b|¥ ?\d/,
  yuan: /\b(?:yuan|renminbi)\b/,
  rupee: /\b(?:rupees?|rupien|roupies?)\b/,
  peso: /\b(?:pesos?)\b/,
  lira: /\b(?:lira|lire)\b/,
  ruble: /\b(?:rubles?|roubles?|rubel|kopeks?|kopecks?)\b/,
  ducat: /\b(?:ducats?|dukaten|ducaten)\b/,
  thaler: /\b(?:thalers?|talers?|thaler)\b/,
  zloty: /\b(?:zloty|zlotys|zlotych)\b/,
  forint: /\b(?:forints?)\b/,
  escudo: /\b(?:escudos?)\b/,
  peseta: /\b(?:pesetas?)\b/,
  drachma: /\b(?:drachmas?|drachmae)\b/,
  dinar: /\b(?:dinars?)\b/,
  dirham: /\b(?:dirhams?)\b/,
  shekel: /\b(?:shekels?)\b/,
  roman: /\b(?:denarius|denarii|sestertius|sestertii|aureus|aurei)\b/,
};

const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/_+/g, " ");
const wordRe = (list: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${list.replace(/\./g, "\\.")})(?=$|[^\\p{L}\\p{N}])`, "u");
const PLACE_RES = Object.entries(PLACES).map(([group, p]) => ({ group, names: wordRe(p.names), demonyms: wordRe(p.demonyms) }));

/** Place groups a text names (`names` only) or mentions (names or demonyms). */
export function placesIn(text: string, o: { namesOnly?: boolean } = {}): Set<string> {
  const t = fold(text);
  const out = new Set<string>();
  for (const p of PLACE_RES) if (p.names.test(t) || (!o.namesOnly && p.demonyms.test(t))) out.add(p.group);
  return out;
}
/** A text without the institution that holds the work ("…, Ashmolean Museum, Oxford", "Paintings in the National Gallery,
 *  London", "Collections of the Danish National Archives"): where an object is kept says nothing about what it shows. */
export function withoutHolder(text: string): string {
  return text.split(/\b(?:[\p{Lu}][\p{L}'-]*\s+)*(?:Museum|Museo|Musée|Musee|Gallery|Galerie|Galleria|Library|Bibliothèque|Bibliotheque|Archives?|Archief|Rijksmuseum|Mauritshuis|Louvre)\b|\b(?:paintings|works|objects|photographs|files|media|collections?) (?:in|of|from) the\b|\bcollections? of\b/u)[0]!;
}

/** Currency groups a text mentions. */
export function currenciesIn(text: string): Set<string> {
  const t = fold(text);
  const out = new Set<string>();
  for (const [group, re] of Object.entries(CURRENCIES)) if (re.test(t)) out.add(group);
  return out;
}

// ------------------------------------------------------------------------------------------------ era
/** Year of a date-ish string or a 4-digit year in free text (not a museum number such as "1863,0613.754"). */
function yearsIn(text: string): number[] {
  // Era-marked years first ("40-350 CE", "200 BC", "AD 79"): ancient objects rarely carry four digits.
  const era = /(?<![\d.,/])(\d{1,4})(?:\s?[-–]\s?\d{1,4})?\s?(CE|BCE|BC|AD|av\.? J\.?-C\.?|v\.? Chr\.?|n\.? Chr\.?)(?![\p{L}])|(?<![\p{L}])AD\s?(\d{1,4})(?![\d])/gu;
  const marked: number[] = [];
  for (const m of text.matchAll(era)) {
    if (m[3] !== undefined) marked.push(Number(m[3]));
    else marked.push(/^(?:BCE|BC|av|v)/.test(m[2]!) ? -Number(m[1]) : Number(m[1]));
  }
  if (marked.length > 0) return marked;
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![\d.,/])(?:c\.?\s?|ca\.?\s?)?(1[0-9]\d{2}|20\d{2})(?![\d])(?![.,]\d)/g)) out.push(Number(m[1]));
  return out;
}
function centuryOf(tokens: readonly string[]): number | null {
  for (const t of tokens) {
    const m = /^(\d{1,2})th$/.exec(t);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 21) return Number(m[1]);
  }
  return null;
}

/** The story's core era: the largest cluster of fact-sheet timeline years (gaps over 60 years split clusters; the later
 *  telling of a story — a book published centuries afterwards — does not stretch it). null when undated. */
export function coreEra(facts: Pick<FactSheet, "timeline">): [number, number] | null {
  const years = facts.timeline.map((e) => /^(-?\d{1,4})/.exec(e.date)).filter((m): m is RegExpExecArray => m !== null).map((m) => Number(m[1])).sort((a, b) => a - b);
  if (years.length === 0) return null;
  let best: number[] = [];
  let cur: number[] = [];
  for (const y of years) {
    if (cur.length > 0 && y - cur[cur.length - 1]! > 60) cur = [];
    cur.push(y);
    if (cur.length > best.length) best = [...cur];
  }
  return [best[0]!, best[best.length - 1]!];
}

/** Era windows a beat's archival material should fall in: the era its visual query names ("seventeenth century", "1630s",
 *  "1637"), else the dates of the facts it cites plus the story's core era. null when nothing is dated. */
export function beatEraWindows(plan: Pick<BeatPlan, "visualQuery" | "factIds" | "cueTags">, facts: FactSheet): [number, number][] | null {
  const q = tokensOf(plan.visualQuery).map(canonToken);
  const c = centuryOf(q);
  if (c !== null) return [[(c - 1) * 100, (c - 1) * 100 + 99]];
  const dec = q.map((t) => /^(1\d|20)(\d)0s$/.exec(t)).find((m) => m);
  if (dec) {
    const y = Number(`${dec[1]}${dec[2]}0`);
    return [[y, y + 9]];
  }
  const qy = yearsIn(plan.visualQuery);
  if (qy.length > 0) return qy.map((y) => [y, y] as [number, number]);
  const windows: [number, number][] = [];
  const core = coreEra(facts);
  if (core) windows.push(core);
  const cited = new Set(plan.factIds);
  const dates = [
    ...facts.timeline.filter((e) => cited.has(e.id)).map((e) => e.date),
    ...facts.quotes.filter((x) => cited.has(x.id)).map((x) => x.date),
    ...facts.figures.filter((x) => cited.has(x.id)).map((x) => x.asOf),
    ...plan.cueTags.filter((t) => t.type === "TIME_JUMP").map((t) => t.value),
  ];
  for (const d of dates) for (const y of yearsIn(String(d ?? "")).slice(0, 1)) windows.push([y, y]);
  return windows.length > 0 ? windows : null;
}

/** The candidate's own date: a year or century its title states (the work: `stated`), else the provider's date (often when
 *  a photograph of the subject was taken). */
export function candidateYear(c: Pick<Candidate, "title">, rawYear: number | null): { year: number | null; stated: boolean } {
  const ty = yearsIn(c.title);
  if (ty.length > 0) return { year: ty[0]!, stated: true };
  const cent = centuryOf(tokensOf(c.title.replace(/-/g, " ")).map(canonToken));
  if (cent !== null) return { year: (cent - 1) * 100 + 50, stated: true };
  return { year: rawYear, stated: false };
}

/** Archival material dated more than this many years outside every era window is anachronistic. */
export const ERA_SLACK_YEARS = 50;
export function isAnachronistic(year: number | null, windows: readonly (readonly [number, number])[] | null): boolean {
  if (year === null || !windows || windows.length === 0) return false;
  return windows.every(([lo, hi]) => year < lo - ERA_SLACK_YEARS || year > hi + ERA_SLACK_YEARS);
}

// ------------------------------------------------------------------------------------------------ story + beat context
export interface StoryContext {
  /** Topic tokens and the story's people: a candidate that carries one is on the story's subject. */
  topic: string[];
  people: Pick<Person, "name" | "aliases">[];
  /** Place and currency groups the story mentions. */
  places: Set<string>;
  /** The places the story is mostly about (mentioned at least half as often as the most mentioned one). */
  primaryPlaces: Set<string>;
  currencies: Set<string>;
}

/** Place groups by number of mentions (one per sentence-like chunk) in a text. */
function placeCounts(chunks: readonly string[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const ch of chunks) for (const g of placesIn(ch)) n.set(g, (n.get(g) ?? 0) + 1);
  return n;
}

function storyChunks(facts: FactSheet): string[] {
  return [
    facts.topic, facts.oneLinePremise, facts.centralQuestion, ...facts.people.map((p) => p.roleInStory),
    ...facts.timeline.flatMap((e) => [e.title, e.whatHappened]), ...facts.figures.flatMap((f) => [f.label, f.unit]), ...facts.claims.map((c) => c.summary),
  ];
}

function storyText(facts: FactSheet): string {
  return storyChunks(facts).join(" \n ");
}

export function storyContext(facts: FactSheet): StoryContext {
  const text = storyText(facts);
  const topic = matchQueryTokens(facts.topic).filter((t) => !GENERIC.has(t) && !ERA_WORD.test(t) && t.length >= 3);
  const counts = placeCounts(storyChunks(facts));
  const top = Math.max(0, ...counts.values());
  const primaryPlaces = new Set([...counts].filter(([, n]) => n * 2 >= top).map(([g]) => g));
  return { topic, people: facts.people.map((p) => ({ name: p.name, aliases: p.aliases })), places: placesIn(text), primaryPlaces, currencies: currenciesIn(text) };
}

export interface BeatContext {
  story: StoryContext;
  /** Places/currencies of the story plus the beat itself (narration, visual query, cue values). */
  places: Set<string>;
  /** The story's primary places plus the beat's own: what a generic query's picture must be about. */
  corePlaces: Set<string>;
  currencies: Set<string>;
  windows: [number, number][] | null;
  /** Archival/news/document beats are held to the era; other beats (stock b-roll, backgrounds) only refuse a dated old work
   *  (a title stating a year before `modernSince`, e.g. a 1920 film poster for "gold coins pile") from another era. */
  periodKind: boolean;
  modernSince: number;
}

const PERIOD_KINDS = new Set(["archival_photo", "news_footage", "document_screenshot"]);

export function beatContext(plan: Pick<BeatPlan, "visualQuery" | "factIds" | "cueTags" | "visualKind">, facts: FactSheet, story: StoryContext, narration = ""): BeatContext {
  const text = [plan.visualQuery, narration, ...plan.cueTags.map((t) => t.value)].join(" \n ");
  const own = placesIn(text);
  return {
    story, places: new Set([...story.places, ...own]), corePlaces: new Set([...story.primaryPlaces, ...own]), currencies: new Set([...story.currencies, ...currenciesIn(text)]),
    windows: beatEraWindows(plan, facts), periodKind: PERIOD_KINDS.has(plan.visualKind),
    modernSince: (yearsIn(facts.asOf)[0] ?? 2020) - 30,
  };
}

// ------------------------------------------------------------------------------------------------ signals
export interface RelevanceSignals {
  /** Salient (non-generic, non-era) query tokens the candidate carries / the query has (best query). */
  salientHits: number;
  salientTotal: number;
  /** The candidate carries a story topic token or names one of the story's people. */
  onTopic: boolean;
  /** Its title/categories mention one of the story's places. */
  placeMatch: boolean;
  /** … one of the places the story (or this beat) is mainly about. */
  corePlaceMatch: boolean;
  year: number | null;
  /** The year is the one the title states (the work's date), not the provider's capture/upload date. */
  yearStated: boolean;
  anachronism: boolean;
  /** A place group its title/categories name while naming none of the story's places (null when none). */
  foreignPlace: string | null;
  /** Only a demonym of a place foreign to the story ("Indo-Greek coin", "Chinese bowl"): a weak signal, penalised only. */
  foreignDemonym: string | null;
  /** A currency it shows that the story never mentions (null when none). */
  foreignCurrency: string | null;
}

/** Salient tokens of a query: content tokens minus generic and era words. */
export function salientTokens(query: string): string[] {
  return matchQueryTokens(query).filter((t) => !GENERIC.has(t) && !ERA_WORD.test(t));
}

/**
 * Relevance signals of a candidate for a beat. `queries` are the texts the beat searched with (visual query + non-portrait
 * queries); a person's name tokens only count when the candidate names that person (`people` = the beat's people).
 */
export function relevanceSignals(c: Pick<Candidate, "title" | "tags" | "description">, rawYear: number | null, queries: readonly string[], ctx: BeatContext, people: readonly Pick<Person, "name" | "aliases">[] = []): RelevanceSignals {
  const have = new Set([...matchTokens(c.title), ...c.tags.flatMap((t) => matchTokens(t)), ...matchTokens(c.description)]);
  const unnamed = new Set(people.filter((p) => !candidateNamesPerson(c, p)).flatMap((p) => [p.name, ...p.aliases].flatMap((n) => matchQueryTokens(n))));
  let salientHits = 0;
  let salientTotal = 0;
  for (const q of queries) {
    const s = salientTokens(q).filter((t) => !unnamed.has(t));
    const hits = s.filter((t) => have.has(t)).length;
    if (s.length > 0 && (hits > salientHits || (hits === salientHits && s.length > salientTotal))) {
      salientHits = hits;
      salientTotal = s.length;
    }
  }
  const onTopic = ctx.story.topic.some((t) => have.has(t)) || ctx.story.people.some((p) => candidateNamesPerson(c, p));
  const head = [c.title, ...c.tags].map(withoutHolder).join(" \n ");
  const mentioned = placesIn(head);
  const placeMatch = [...mentioned].some((g) => ctx.places.has(g));
  const corePlaceMatch = [...mentioned].some((g) => ctx.corePlaces.has(g));
  const named = [...placesIn(head, { namesOnly: true })].filter((g) => !ctx.places.has(g));
  const foreignPlace = ctx.places.size > 0 && !placeMatch && named.length > 0 ? named[0]! : null;
  const others = [...mentioned].filter((g) => !ctx.places.has(g));
  const foreignDemonym = ctx.places.size > 0 && !placeMatch && foreignPlace === null && others.length > 0 ? others[0]! : null;
  const shown = [...currenciesIn(`${head} \n ${c.description}`)];
  const foreignCurrency = ctx.currencies.size > 0 && shown.length > 0 && !shown.some((g) => ctx.currencies.has(g)) ? shown[0]! : null;
  const { year, stated } = candidateYear(c, rawYear);
  const anachronism = ctx.periodKind ? isAnachronistic(year, ctx.windows)
    : stated && year !== null && year < ctx.modernSince && isAnachronistic(year, ctx.windows);
  return { salientHits, salientTotal, onTopic, placeMatch, corePlaceMatch, year, yearStated: stated, anachronism, foreignPlace, foreignDemonym, foreignCurrency };
}

/** Metadata penalty of the signals (subtracted from the metadata score). */
export function relevancePenalty(s: RelevanceSignals): number {
  // A provider date is often when a photograph of the subject was taken (a 2008 photo of a 1590 garden): a light penalty.
  return (s.anachronism ? (s.yearStated ? 0.15 : 0.05) : 0) + (s.foreignPlace ? 0.2 : s.foreignDemonym ? 0.1 : 0) + (s.foreignCurrency ? 0.2 : 0) + (s.salientTotal > 0 && s.salientHits === 0 ? 0.15 : 0);
}

/**
 * Hard relevance rules (the word-coverage floor is checked separately): the candidate must carry one of the beat's salient
 * nouns; a generic query (one salient noun, e.g. "archive contract documents") also needs the story's topic, people or
 * main places (a Scottish narrator does not make a Scottish contract part of a Dutch story); a foreign place or currency disqualifies unless the candidate is on the story's topic, and so does a date far
 * outside the era — when the title states it, or when the candidate matches the beat's nouns only in part (a modern
 * photograph of exactly the wanted place is fine). Returns the reason it fails, or null when it passes.
 */
export function relevanceFailure(s: RelevanceSignals): string | null {
  if (s.salientTotal > 0 && s.salientHits === 0) return "no salient noun of the beat";
  if (s.salientTotal === 1 && !s.onTopic && !s.corePlaceMatch) return "generic query and nothing of the story";
  if (s.onTopic) return null;
  if (s.foreignCurrency) return `foreign currency (${s.foreignCurrency})`;
  if (s.foreignPlace) return `foreign place (${s.foreignPlace})`;
  if (s.anachronism && (s.yearStated || s.salientHits < s.salientTotal)) return `dated ${s.year}, outside the story's era`;
  return null;
}

export function signalNotes(s: RelevanceSignals): string {
  const parts = [`salient ${s.salientHits}/${s.salientTotal}`];
  if (s.onTopic) parts.push("on-topic");
  if (s.anachronism) parts.push(`anachronism ${s.year}`);
  if (s.foreignPlace) parts.push(`foreign-place ${s.foreignPlace}`);
  if (s.foreignDemonym) parts.push(`foreign-demonym ${s.foreignDemonym}`);
  if (s.foreignCurrency) parts.push(`foreign-currency ${s.foreignCurrency}`);
  return parts.join(" ");
}
