#!/usr/bin/env python3
# Usage (from the repo root): python3 packages/llm/scripts/gen-fixtures/tulip.py fixtures/tulip-mania
# Generates fixtures/tulip-mania/** (wire JSON) from one authored source. Beat texts are joined into segment texts,
# so EN beats and FR slices reconstruct their segments exactly by construction.
import json, os, sys

OUT = sys.argv[1]
N = " "  # narrow no-break space (FR typography)
os.makedirs(os.path.join(OUT, "llm"), exist_ok=True)

def dump(rel, obj):
    p = os.path.join(OUT, rel)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")

AS_OF = "2026-10-02"
W = "https://en.wikipedia.org/wiki/Tulip_mania"
G = "https://books.google.com/books?id=gViwLbCJ7X0C"
M = "https://www.gutenberg.org/ebooks/24518"

dump("fixture.json", {
    "schemaVersion": 1, "id": "tulip-mania", "title": "Tulip Mania",
    "idea": "Tulip mania: how a flower became the first famous bubble in history, and why the legend is bigger than the crash",
    "languages": ["en", "fr"], "primaryLang": "en", "targetMinutes": 1.5, "styleId": "drama-commentary",
    "asOf": AS_OF, "seed": 1637, "autoApproveGates": True,
})

# ------------------------------------------------------------------ research
dump("llm/research.json", {
    "dossier_markdown": "\n".join([
        "# Tulip mania (Dutch Republic, 1634–1637) — research notes",
        "- Contract prices for rare tulip bulbs rose sharply from 1634 and collapsed in February 1637 [" + W + "]",
        "- 1593: Carolus Clusius planted his tulip collection in the new Hortus Botanicus of Leiden [" + W + "]",
        "- By 1634 speculators entered the market; by November 1636 even common bulbs rose [" + W + "]",
        "- Traders met in 'colleges' in taverns; some contracts changed hands five times; no bulbs were delivered [" + W + "]",
        "- At its height a Semper Augustus bulb sold for 10,000 guilders; a skilled artisan earned about 300 guilders a year [" + W + "]",
        "- 3 February 1637, Haarlem: according to a contemporary satire, an auctioneer found no buyers despite lowering the price several times; the actual circumstances are unknown [" + W + "]",
        "- 5 February 1637: last date of the bubble, 98 sales recorded [" + W + "]",
        "- 24 February 1637: the florists' guild turned contracts written after 30 November 1636 into option contracts [" + W + "]",
        "- The satire 'Dialogues between Waermondt and Gaergoedt' is the main source of price data [" + W + "]",
        "- 1841: Charles Mackay popularised the story (investors ruined, sailor who ate a bulb) [" + M + "]",
        "- 2007: Anne Goldgar's archival study: traders were mostly wealthy merchants and craftsmen; Mackay's account is contested [" + G + "] [" + W + "]",
    ]),
    "registry": [
        {"url": W, "title": "Tulip mania", "page_age": None, "fetched": True, "cited": 9,
         "snippets": ["A contemporary satire suggests that the crisis started to unravel at February 3 in Haarlem, where an auctioneer failed to find willing buyers, despite lowering the asking price several times.",
                      "The Semper Augustus was the most expensive tulip during the mania, at its height this tulip was even sold for ƒ10,000"]},
        {"url": G, "title": "Tulipmania: Money, Honor, and Knowledge in the Dutch Golden Age", "page_age": None, "fetched": True, "cited": 1,
         "snippets": ["Tulipmania: Money, Honor, and Knowledge in the Dutch Golden Age, Anne Goldgar, University of Chicago Press, 2007"]},
        {"url": M, "title": "Memoirs of Extraordinary Popular Delusions and the Madness of Crowds by Charles Mackay", "page_age": None, "fetched": True, "cited": 1,
         "snippets": ["Nobles, citizens, farmers, mechanics, sea-men, footmen, maid-servants, even chimney-sweeps and old clothes-women, dabbled in tulips."]},
    ],
    "searches_used": 6, "fetches_used": 3,
})

# ------------------------------------------------------------------ fact sheet
Q1 = "Nobles, citizens, farmers, mechanics, sea-men, footmen, maid-servants, even chimney-sweeps and old clothes-women, dabbled in tulips."
Q2 = "eating a breakfast whose cost might have regaled a whole ship's crew for a twelvemonth"
Q3 = "are based on one or two contemporary pieces of propaganda and a prodigious amount of plagiarism"
dump("llm/factsheet.json", {
    "topic": "Tulip mania", "as_of": AS_OF,
    "one_line_premise": "In the winter of 1636–37 a flower briefly cost a fortune, then nothing; the legend that followed grew bigger than the crash.",
    "central_question": "How did a tulip bulb become worth a fortune, and did its collapse really ruin the Dutch?",
    "sources": [
        {"id": "S1", "url": W, "title": "Tulip mania", "publisher": "Wikipedia", "published_at": "", "source_type": "wikipedia", "reliability": "medium", "language": "en"},
        {"id": "S2", "url": G, "title": "Tulipmania: Money, Honor, and Knowledge in the Dutch Golden Age", "publisher": "University of Chicago Press", "published_at": "2007", "source_type": "book", "reliability": "high", "language": "en"},
        {"id": "S3", "url": M, "title": "Memoirs of Extraordinary Popular Delusions and the Madness of Crowds", "publisher": "Project Gutenberg", "published_at": "1841", "source_type": "book", "reliability": "low", "language": "en"},
    ],
    "people": [
        {"id": "P1", "name": "Carolus Clusius", "role_in_story": "Botanist who planted tulips in Leiden's Hortus Botanicus in 1593", "public_figure": True, "is_minor_or_private_victim": False, "image_queries": ["Carolus Clusius portrait", "Charles de l'Ecluse engraving"]},
        {"id": "P2", "name": "Charles Mackay", "role_in_story": "Scottish journalist whose 1841 book popularised the tulip mania story", "public_figure": True, "is_minor_or_private_victim": False, "image_queries": ["Charles Mackay author portrait"]},
        {"id": "P3", "name": "Anne Goldgar", "role_in_story": "Historian, author of Tulipmania (2007), an archival study of the trade", "public_figure": True, "is_minor_or_private_victim": False, "image_queries": ["Tulipmania Goldgar book cover"]},
    ],
    "timeline": [
        {"id": "E1", "date": "1593", "title": "Clusius plants tulips in Leiden", "what_happened": "Carolus Clusius plants his tulip collection in the new Hortus Botanicus of Leiden.", "person_ids": ["P1"], "status": "established_fact", "source_ids": ["S1"], "drama_value": 4},
        {"id": "E2", "date": "1634", "title": "Speculators enter the tulip market", "what_happened": "Partly driven by French demand, speculators begin to trade bulb contracts.", "person_ids": [], "status": "established_fact", "source_ids": ["S1"], "drama_value": 5},
        {"id": "E3", "date": "1636-11", "title": "Even common bulbs rise", "what_happened": "Contracts change hands in tavern 'colleges', some five times; even common bulbs rise in price.", "person_ids": [], "status": "established_fact", "source_ids": ["S1"], "drama_value": 6},
        {"id": "E4", "date": "1637-02-03", "title": "The Haarlem auction without buyers", "what_happened": "According to a contemporary satire, an auctioneer in Haarlem finds no buyers despite lowering his price several times.", "person_ids": [], "status": "disputed", "source_ids": ["S1"], "drama_value": 9},
        {"id": "E5", "date": "1637-02-05", "title": "Last day of the bubble", "what_happened": "98 sales are recorded at wildly varying prices; by the end of the first week of February prices have collapsed.", "person_ids": [], "status": "established_fact", "source_ids": ["S1"], "drama_value": 8},
        {"id": "E6", "date": "1637-02-24", "title": "The florists' guild converts contracts", "what_happened": "The guild of Dutch florists turns contracts written after 30 November 1636 into options buyers can cancel for a fee.", "person_ids": [], "status": "established_fact", "source_ids": ["S1"], "drama_value": 6},
        {"id": "E7", "date": "1841", "title": "Mackay publishes his account", "what_happened": "Charles Mackay's Extraordinary Popular Delusions popularises the tulip mania story.", "person_ids": ["P2"], "status": "established_fact", "source_ids": ["S3"], "drama_value": 5},
        {"id": "E8", "date": "2007", "title": "Goldgar publishes Tulipmania", "what_happened": "Anne Goldgar's archival study challenges the traditional account.", "person_ids": ["P3"], "status": "established_fact", "source_ids": ["S2"], "drama_value": 6},
    ],
    "quotes": [
        {"id": "Q1", "speaker_id": "P2", "verbatim": Q1, "language": "en", "date": "1841", "context": "Mackay describing who joined the tulip trade", "medium": "print", "source_id": "S3", "youtube_search_query": ""},
        {"id": "Q2", "speaker_id": "P2", "verbatim": Q2, "language": "en", "date": "1841", "context": "Mackay's anecdote of a sailor who ate a Semper Augustus bulb", "medium": "print", "source_id": "S3", "youtube_search_query": ""},
        {"id": "Q3", "speaker_id": "P3", "verbatim": Q3, "language": "en", "date": "2007", "context": "Goldgar on most accounts of the period (quoted on Wikipedia)", "medium": "print", "source_id": "S1", "youtube_search_query": ""},
    ],
    "figures": [
        {"id": "N1", "label": "Price of a Semper Augustus bulb at the height of the mania", "value": 10000, "unit": "guilders", "as_of": "1637", "source_ids": ["S1"], "chartable": True},
        {"id": "N2", "label": "Annual income of a skilled artisan", "value": 300, "unit": "guilders", "as_of": "1637", "source_ids": ["S1"], "chartable": True},
        {"id": "N3", "label": "Sales recorded on the last day of the bubble", "value": 98, "unit": "sales", "as_of": "1637-02-05", "source_ids": ["S1"], "chartable": False},
        {"id": "N4", "label": "Fee to cancel a contract in Haarlem", "value": 3.5, "unit": "%", "as_of": "1637-05", "source_ids": ["S1"], "chartable": False},
    ],
    "claims": [
        {"id": "C1", "summary": "Many investors were ruined by the crash and Dutch commerce suffered a severe shock", "made_by": "Charles Mackay (1841)", "against": "", "status": "disputed", "jurisdiction": "", "decision_date": "", "subject_response": "", "sensitivity": "low", "source_ids": ["S3", "S1"]},
        {"id": "C2", "summary": "Archived contracts show the trade was conducted mostly by wealthy merchants and skilled craftsmen, not by the whole population", "made_by": "Anne Goldgar (2007)", "against": "", "status": "established_fact", "jurisdiction": "", "decision_date": "", "subject_response": "", "sensitivity": "low", "source_ids": ["S2", "S1"]},
        {"id": "C3", "summary": "A sailor ate a Semper Augustus bulb, mistaking it for an onion", "made_by": "Charles Mackay (1841)", "against": "", "status": "disputed", "jurisdiction": "", "decision_date": "", "subject_response": "", "sensitivity": "low", "source_ids": ["S3"]},
    ],
    "angles": ["The first famous bubble was smaller than its legend", "A satire became the historical record"],
    "gaps": ["The actual circumstances of the February 1637 crash are unknown"],
})

dump("llm/style.json", {
    "topic_type": "history",
    "ranked": [
        {"style_id": "drama-commentary", "score": 0.82, "why": "A rise-and-fall story with a twist suits the punchy commentary edit."},
    ],
    "recommended_style_id": "drama-commentary", "recommended_minutes": 12,
    "title_options": ["The Flower That Cost a Fortune", "Tulip Mania Was a Lie (Mostly)", "10,000 Guilders for a Tulip", "The First Bubble Never Burst Like You Think", "How a Flower Fooled History"],
    "thumbnail_text_options": ["10,000 GUILDERS?", "THE TULIP LIE", "NOBODY BOUGHT", "IT NEVER HAPPENED?", "FLOWER BUBBLE"],
    "risk_flags": ["none"],
    "theme_override": {"accent": "#E8412F", "backdrop_recipe": "paper", "texture": "paper"},
})

# ------------------------------------------------------------------ outline (rise-fall shape; 218 words = planBudget(1.5, en))
dump("llm/outline.json", {
    "language": "en", "story_shape": "rise-fall",
    "title": "Tulip Mania: The Flower That Fooled History",
    "thesis": "Tulip mania was real for a few traders; the ruin of a nation is a legend built on a satire and a Victorian bestseller.",
    "hook_teasers": [
        {"id": "T1", "teaser": "A single bulb for 10,000 guilders", "paid_off_in": "CH2"},
        {"id": "T2", "teaser": "The auction where nobody bought", "paid_off_in": "CH3"},
    ],
    "loops": [{"id": "L1", "question": "How did a flower become a fortune, then nothing?", "opened_in": "CH1", "closed_in": "CH3"}],
    "chapters": [
        {"id": "CH1", "act": "cold_open", "title": "The Auction", "target_words": 50, "purpose": "Open on the Haarlem auction without buyers; contrast with the 10,000-guilder peak; open the central loop.",
         "event_ids": ["E4"], "claim_ids": [], "quote_ids": [], "opens_loops": ["L1"], "closes_loops": [], "exit_hook": "How does a flower become a fortune, then nothing at all?", "ad_break_after": False},
        {"id": "CH2", "act": "act1_rise", "title": "The Rise", "target_words": 88, "purpose": "From Clusius's garden to tavern contracts; Mackay's picture of a whole nation trading.",
         "event_ids": ["E1", "E2", "E3", "E7"], "claim_ids": ["C1"], "quote_ids": [], "opens_loops": [], "closes_loops": [], "exit_hook": "Everyone, it seemed, was about to get rich.", "ad_break_after": False},
        {"id": "CH3", "act": "act3_reckoning", "title": "The Reckoning", "target_words": 80, "purpose": "The collapse, the guild ruling, and the twist: the ruin Mackay described is contested by Goldgar's archival study.",
         "event_ids": ["E5", "E6", "E8"], "claim_ids": ["C1", "C2"], "quote_ids": [], "opens_loops": [], "closes_loops": ["L1"], "exit_hook": "The bubble was real for a few; the legend was written for everyone else.", "ad_break_after": False},
    ],
    "callback_plan": ["The auction without buyers (CH1) returns as the collapse in CH3"],
    "next_video_bridge": "The South Sea Bubble: when a whole kingdom really did go broke.",
})

# ------------------------------------------------------------------ script + beats (authored together)
def beat(en, fr, **a):
    return {"en": en, "fr": fr, **a}

def plan(vk, q, tmpl="none", md=None, md_fr=None, energy=3, purpose="context", camera="ken_burns", tr="cut", sfx=None,
         mc="none", mood="tense", people=None, facts=None, cues=None, cues_fr=None, emph=None, emph_fr=None, ost="", ost_fr="", yt=""):
    return dict(vk=vk, q=q, tmpl=tmpl, md=md, md_fr=md_fr, energy=energy, purpose=purpose, camera=camera, tr=tr, sfx=sfx or [], mc=mc,
                mood=mood, people=people or [], facts=facts or [], cues=cues or [], cues_fr=cues_fr, emph=emph or [], emph_fr=emph_fr or [],
                ost=ost, ost_fr=ost_fr, yt=yt)

HAARLEM = {"places": [{"label": "Haarlem", "lon": 4.6462, "lat": 52.3874}], "route": False, "region": "europe"}
PAMPHLET = {"source_id": "S1", "quote_id": "", "kind": "pamphlet", "outlet": "Anonymous satire", "title": "Dialogues between Waermondt and Gaergoedt",
            "date": "1637", "paragraphs": ["An anonymous satire, written just after the bubble"], "highlight": "", "redact": []}
PAMPHLET_FR = {**PAMPHLET, "outlet": "Satire anonyme", "title": "Dialogues entre Waermondt et Gaergoedt", "paragraphs": ["Une satire anonyme, écrite juste après la bulle"]}
COUNTER = {"figure_id": "N1", "value": 10000, "from": 0, "currency": "NLG", "label": "one Semper Augustus bulb", "compact": False}
COUNTER_FR = {**COUNTER, "label": "un bulbe de Semper Augustus"}
QCARD = {"quote_id": "Q1", "text": Q1, "speaker": "Charles Mackay", "source": "Extraordinary Popular Delusions", "date": "1841"}
QCARD_FR = {**QCARD, "text": "Nobles, bourgeois, paysans, artisans, marins, valets, servantes, et jusqu’aux ramoneurs et aux fripières, spéculaient sur les tulipes.", "source": "Extraordinaires délires populaires", "translated": True}
QCARD3 = {"quote_id": "Q3", "text": Q3, "speaker": "Anne Goldgar", "source": "Tulipmania", "date": "2007"}
QCARD3_FR = {**QCARD3, "text": "reposent sur un ou deux pamphlets de propagande contemporains et sur une quantité prodigieuse de plagiat", "translated": True}
TIMELINE = {"events": [{"date": "1637-02-05", "label": "Last recorded sales", "event_id": "E5"}, {"date": "1637-02-24", "label": "Contracts become options", "event_id": "E6"}], "active_index": 1}
TIMELINE_FR = {"events": [{"date": "1637-02-05", "label": "Dernières ventes", "event_id": "E5"}, {"date": "1637-02-24", "label": "Les contrats deviennent des options", "event_id": "E6"}], "active_index": 1}

CHAPTERS = [
    {"id": "CH1", "title": {"en": "The Auction", "fr": "La vente aux enchères"}, "video_title": {"en": "Tulip Mania: The Flower That Fooled History", "fr": "La tulipomanie : la fleur qui a dupé l’Histoire"},
     "summary": {"en": "Haarlem, February 1637: an auction finds no buyers, weeks after a Semper Augustus bulb sold for 10,000 guilders. Central question: how does a flower become a fortune, then nothing?",
                 "fr": "Haarlem, février 1637 : une vente ne trouve aucun acheteur, alors qu’un Semper Augustus valait 10 000 florins. Question centrale : comment une fleur devient une fortune, puis rien ?"},
     "loops_opened": ["L1"], "loops_closed": [],
     "segments": [
        {"type": "narration", "device": "none", "facts": ["E4", "S1"], "beats": [
            beat("Haarlem, February 1637.", f"Haarlem, février 1637.", **plan("map", "Haarlem old city map", "map_route", HAARLEM, HAARLEM, energy=3, purpose="hook", camera="slow_push_in",
                 sfx=["whoosh"], mc="start", mood="ominous", facts=["E4", "S1"],
                 cues=[{"type": "PLACE", "word": "Haarlem", "value": "Haarlem"}, {"type": "TIME_JUMP", "word": "February", "value": "February 1637"}],
                 cues_fr=["Haarlem", "février"], emph=["Haarlem"], emph_fr=["Haarlem"])),
            beat("According to a satire printed that year,", "D’après une satire imprimée cette année-là,", **plan("document_screenshot", "seventeenth century dutch pamphlet", "document_highlight", PAMPHLET, PAMPHLET_FR,
                 energy=3, purpose="hook", camera="slow_push_in", sfx=["typing"], mood="ominous", facts=["S1", "E4"],
                 cues=[{"type": "DOCUMENT", "word": "satire", "value": ""}], cues_fr=["satire"])),
            beat("an auctioneer kept lowering his price.", "un commissaire-priseur baisse son prix,", **plan("archival_photo", "seventeenth century dutch auction painting", energy=3, purpose="hook",
                 sfx=[], mood="ominous", facts=["E4"], emph=["lowering"], emph_fr=["baisse"])),
            beat("Again, and again, and again.", "encore et encore.", **plan("archival_photo", "dutch golden age tavern interior painting", energy=4, purpose="hook", camera="punch_in",
                 sfx=["riser"], mc="build", mood="ominous", facts=["E4"])),
        ]},
        {"type": "narration", "device": "reveal", "facts": ["E4", "N1", "S1"], "beats": [
            beat("Nobody bought a thing.", "Personne n’achète.", **plan("text_card", "empty auction room", "kinetic_text", {"lines": ["NOBODY BOUGHT"], "emphasis": ["NOBODY"]},
                 {"lines": ["PERSONNE N’ACHÈTE"], "emphasis": ["PERSONNE"]}, energy=5, purpose="reveal", camera="shake", tr="flash", sfx=["impact", "sub_boom"],
                 mc="hit", mood="ominous", facts=["E4"], cues=[{"type": "SHOCK", "word": "Nobody", "value": ""}], cues_fr=["Personne"], ost="NOBODY BOUGHT", ost_fr="PERSONNE N’ACHÈTE")),
            beat("At the height of the mania,", "Au sommet de la folie,", **plan("archival_photo", "semper augustus tulip watercolour", energy=3, purpose="context", mood="tense", facts=["N1", "S1"])),
            beat("one Semper Augustus bulb", "un seul bulbe de Semper Augustus", **plan("archival_photo", "semper augustus tulip bulb illustration", energy=3, purpose="escalation", camera="punch_in",
                 mood="tense", facts=["N1"], emph=["Semper"], emph_fr=["Semper"])),
            beat("had sold for 10,000 guilders.", f"s’était vendu 10{N}000 florins.", **plan("motion_graphic", "dutch guilder coins", "money_counter", COUNTER, COUNTER_FR, energy=4, purpose="escalation",
                 camera="static", sfx=["cash_register"], mood="tense", facts=["N1", "S1"], cues=[{"type": "NUMBER", "word": "10,000", "value": "10000"}], cues_fr=["10"])),
        ]},
        {"type": "narration", "device": "open_loop", "facts": ["S1"], "beats": [
            beat("So how does a flower become a fortune,", "Comment une fleur devient-elle une fortune,", **plan("stock_broll", "red tulip close up", energy=3, purpose="cliffhanger", camera="slow_push_in",
                 mood="mysterious", facts=["S1"], cues=[{"type": "EMPHASIS", "word": "fortune", "value": ""}], cues_fr=["fortune"], emph=["fortune"], emph_fr=["fortune"])),
            beat("then nothing at all?", f"puis plus rien du tout{N}?", **plan("stock_broll", "wilted tulip petals falling", energy=4, purpose="cliffhanger", camera="zoom_out_reveal",
                 sfx=["riser"], mc="drop_out", mood="mysterious", facts=["S1"])),
        ]},
        {"type": "music_breath", "device": "none", "facts": [], "beats": []},
     ]},
    {"id": "CH2", "title": {"en": "The Rise", "fr": "L’ascension"}, "video_title": {"en": "", "fr": ""},
     "summary": {"en": "From Clusius's Leiden garden (1593) to speculators (1634) and tavern contracts that changed hands five times; Mackay later claimed everyone traded.",
                 "fr": "Du jardin de Clusius à Leyde (1593) aux spéculateurs (1634) et aux contrats revendus cinq fois dans les tavernes ; Mackay prétendra que tout le monde spéculait."},
     "loops_opened": [], "loops_closed": [],
     "segments": [
        {"type": "narration", "device": "none", "facts": ["P1", "E1", "S1"], "beats": [
            beat("It all started with a botanist.", "Tout part d’un botaniste.", **plan("archival_photo", "carolus clusius portrait engraving", energy=2, purpose="context", mc="change_mood",
                 mood="mysterious", people=["P1"], facts=["P1", "S1"])),
            beat("In 1593, Carolus Clusius planted his tulips", "En 1593, Carolus Clusius plante ses tulipes", **plan("archival_photo", "carolus clusius portrait", energy=3, purpose="context",
                 people=["P1"], facts=["P1", "E1"], cues=[{"type": "PERSON_INTRO", "word": "Carolus", "value": "Carolus Clusius"}], cues_fr=["Carolus"], emph=["Clusius"], emph_fr=["Clusius"])),
            beat("in the new botanical garden of Leiden.", "dans le jardin botanique de Leyde.", **plan("archival_photo", "hortus botanicus leiden historic garden", energy=2, purpose="context",
                 facts=["E1", "S1"])),
        ]},
        {"type": "narration", "device": "none", "facts": ["E2", "S1"], "beats": [
            beat("Rare flowers, unpredictable colours,", f"Fleurs rares, couleurs imprévisibles{N}:", **plan("archival_photo", "flamed tulip watercolour seventeenth century", energy=3,
                 purpose="context", facts=["S1"])),
            beat("and by 1634, speculators had entered the market.", "dès 1634, les spéculateurs entrent sur le marché.", **plan("archival_photo", "dutch merchants seventeenth century painting", energy=3,
                 purpose="escalation", mc="build", facts=["E2", "S1"], cues=[{"type": "TENSION_BUILD", "word": "speculators", "value": ""}], cues_fr=["spéculateurs"])),
        ]},
        {"type": "narration", "device": "pattern_interrupt", "facts": ["E3", "S1"], "beats": [
            beat("Contracts changed hands in taverns, sometimes five times,", "Les contrats changent de main dans les tavernes, parfois cinq fois,", **plan("archival_photo", "dutch tavern interior painting seventeenth century",
                 energy=4, purpose="escalation", camera="punch_in", sfx=["whoosh"], facts=["E3", "S1"], emph=["five"], emph_fr=["cinq"])),
            beat("for bulbs still in the ground.", "pour des bulbes encore en terre.", **plan("stock_broll", "tulip bulbs in soil", energy=3, purpose="punchline", facts=["E3"],
                 cues=[{"type": "IRONY", "word": "ground", "value": ""}], cues_fr=["terre"])),
        ]},
        {"type": "narration", "device": "none", "facts": ["P2", "E7", "Q1", "S3"], "beats": [
            beat("In 1841, Charles Mackay wrote that everyone joined in,", "En 1841, Charles Mackay écrira que tout le monde s’y mettait,", **plan("motion_graphic", "old book pages", "quote_card", QCARD, QCARD_FR,
                 energy=3, purpose="context", camera="static", sfx=["text_pop"], people=["P2"], facts=["P2", "E7", "Q1", "S3"],
                 cues=[{"type": "QUOTE", "word": "wrote", "value": "Charles Mackay"}], cues_fr=["écrira"])),
            beat("down to chimney-sweeps and old clothes-women.", "jusqu’aux ramoneurs et aux fripières.", **plan("archival_photo", "seventeenth century dutch street scene painting", energy=3,
                 purpose="escalation", facts=["Q1", "S3"], cues=[{"type": "EMPHASIS", "word": "chimney-sweeps", "value": ""}], cues_fr=["ramoneurs"], emph=["chimney-sweeps"], emph_fr=["ramoneurs"])),
        ]},
        {"type": "narration", "device": "none", "facts": ["N1", "N2", "S1"], "beats": [
            beat("At the peak, a single bulb could cost more than ten times", "Au sommet, un bulbe pouvait coûter plus de dix fois", **plan("archival_photo", "tulip bulb still life painting", energy=4,
                 purpose="escalation", camera="punch_in", sfx=["whoosh"], facts=["N1", "N2", "S1"], emph=["ten"], emph_fr=["dix"])),
            beat("what a skilled craftsman earned in a year.", "le salaire annuel d’un artisan.", **plan("text_card", "craftsman wages", "kinetic_text", {"lines": ["TEN YEARS OF WAGES"], "emphasis": ["TEN"]},
                 {"lines": ["DIX ANS DE SALAIRE"], "emphasis": ["DIX"]}, energy=4, purpose="punchline", camera="static", sfx=["impact"], mc="hit", facts=["N2", "S1"],
                 ost="TEN YEARS OF WAGES", ost_fr="DIX ANS DE SALAIRE")),
        ]},
        {"type": "narration", "device": "cliffhanger", "facts": ["S1"], "beats": [
            beat("Everyone, it seemed, was about to get rich.", "Tout le monde, semblait-il, allait faire fortune.", **plan("stock_broll", "gold coins pile candlelight", energy=4, purpose="cliffhanger",
                 camera="slow_push_in", sfx=["riser"], mc="build", mood="tense", facts=["S1"])),
        ]},
     ]},
    {"id": "CH3", "title": {"en": "The Reckoning", "fr": "Le jugement"}, "video_title": {"en": "", "fr": ""},
     "summary": {"en": "Prices collapse in the first week of February 1637; the guild turns contracts into options; Goldgar's archives contest Mackay's ruin.",
                 "fr": "Les prix s’effondrent début février 1637 ; la guilde transforme les contrats en options ; les archives de Goldgar contredisent la ruine décrite par Mackay."},
     "loops_opened": [], "loops_closed": ["L1"],
     "segments": [
        {"type": "narration", "device": "none", "facts": ["E5", "S1"], "beats": [
            beat("Then, suddenly, the music stopped.", "Puis, soudain, tout s’arrête.", **plan("stock_broll", "candle blown out dark room", energy=4, purpose="transition", camera="static", tr="dip_to_black",
                 sfx=["silence_drop"], mc="drop_out", mood="ominous", facts=["S1"])),
            beat("In the first week of February 1637,", "Dès le début de février 1637,", **plan("motion_graphic", "calendar february 1637", "timeline", TIMELINE, TIMELINE_FR, energy=4,
                 purpose="escalation", camera="static", facts=["E5", "E6", "S1"])),
            beat("buyers stopped showing up, and prices collapsed.", "les acheteurs disparaissent, les prix s’effondrent.", **plan("archival_photo", "flora wagon of fools painting", energy=5,
                 purpose="escalation", camera="punch_in", sfx=["impact"], mc="hit", mood="ominous", facts=["E5", "S1"], emph=["collapsed"], emph_fr=["effondrent"])),
        ]},
        {"type": "narration", "device": "reveal", "facts": ["C1", "S1", "S3"], "beats": [
            beat("But here is the real twist:", f"Mais voici le retournement{N}:", **plan("text_card", "plot twist", "kinetic_text", {"lines": ["THE TWIST"], "emphasis": ["TWIST"]},
                 {"lines": ["LE RETOURNEMENT"], "emphasis": ["RETOURNEMENT"]}, energy=4, purpose="reveal", camera="static", tr="glitch", sfx=["glitch"], mood="mysterious",
                 facts=["S1"], ost="THE TWIST", ost_fr="LE RETOURNEMENT")),
            beat("the ruin Mackay described may never have happened.", "la ruine dont parle Mackay n’a peut-être jamais eu lieu.", **plan("archival_photo", "charles mackay book title page", energy=5, purpose="reveal",
                 camera="punch_in", sfx=["impact"], mc="hit", mood="mysterious", people=["P2"], facts=["C1", "S1", "S3"],
                 cues=[{"type": "REVEAL", "word": "never", "value": ""}], cues_fr=["jamais"], emph=["never"], emph_fr=["jamais"])),
        ]},
        {"type": "narration", "device": "payoff", "facts": ["P3", "C2", "E8", "S2", "S1"], "beats": [
            beat("Historian Anne Goldgar read the archived contracts:", f"L’historienne Anne Goldgar a lu les archives{N}:", **plan("archival_photo", "archive contract documents", energy=3,
                 purpose="payoff", people=["P3"], facts=["P3", "E8", "S2"])),
            beat("the traders were mostly wealthy merchants and craftsmen.", "les négociants étaient surtout de riches marchands et artisans.", **plan("archival_photo", "dutch merchants portrait painting", energy=3,
                 purpose="payoff", facts=["C2", "S1"])),
        ]},
        {"type": "narration", "device": "none", "facts": ["Q3", "P3", "S1"], "beats": [
            beat("She argues that most accounts", "Selon elle, la plupart des récits", **plan("motion_graphic", "old books stack", "quote_card", QCARD3, QCARD3_FR, energy=3,
                 purpose="payoff", camera="static", sfx=["text_pop"], people=["P3"], facts=["Q3", "P3", "S1"], cues=[{"type": "QUOTE", "word": "argues", "value": "Anne Goldgar"}], cues_fr=["Selon"])),
            beat("rest on a little propaganda and a prodigious amount of plagiarism.", "reposent sur un peu de propagande et beaucoup de plagiat.", **plan("archival_photo", "seventeenth century satirical print tulips", energy=4,
                 purpose="punchline", facts=["Q3", "S1"], cues=[{"type": "EMPHASIS", "word": "plagiarism", "value": ""}], cues_fr=["plagiat"], emph=["plagiarism"], emph_fr=["plagiat"])),
        ]},
        {"type": "narration", "device": "payoff", "facts": ["C2", "S1"], "beats": [
            beat("The bubble was real for a few.", "La bulle était réelle pour quelques-uns.", **plan("stock_broll", "single red tulip dark background", energy=3, purpose="payoff", camera="slow_push_in",
                 mc="change_mood", mood="sad", facts=["C2", "S1"])),
            beat("The legend was written for everyone else.", "La légende fut écrite pour tous les autres.", **plan("stock_broll", "tulip field netherlands aerial", energy=3, purpose="payoff",
                 camera="zoom_out_reveal", mc="build", mood="sad", facts=["S1"])),
        ]},
     ]},
]

FACTCHECK = {
    ("en", "CH1"): [{"segment_id": "CH1-S02", "where": "CH1-S02", "surface": "narration", "sentence": "Nobody bought a thing.", "claim_kind": "fact",
                     "verdict": "partially_supported", "risk": "low", "fact_ids": ["E4"],
                     "problem": "Only a contemporary satire reports the failed Haarlem auction; the actual circumstances of the crash are unknown. The previous sentence attributes it to the satire.",
                     "suggested_rewrite": ""}],
    ("fr", "CH1"): [{"segment_id": "CH1-S02", "where": "CH1-S02", "surface": "narration", "sentence": "Personne n’achète.", "claim_kind": "fact",
                     "verdict": "partially_supported", "risk": "low", "fact_ids": ["E4"],
                     "problem": "Seule une satire de l’époque rapporte la vente ratée de Haarlem ; la phrase précédente l’attribue à cette satire.",
                     "suggested_rewrite": ""}],
    ("en", "CH3"): [{"segment_id": "CH3-S02", "where": "CH3-S02", "surface": "narration", "sentence": "But here is the real twist: the ruin Mackay described may never have happened.",
                     "claim_kind": "opinion", "verdict": "opinion_ok", "risk": "none", "fact_ids": ["C1", "C2"],
                     "problem": "Hedged ('may') and supported by Goldgar's archival study.", "suggested_rewrite": ""}],
    ("fr", "CH3"): [{"segment_id": "CH3-S02", "where": "CH3-S02", "surface": "narration", "sentence": f"Mais voici le retournement{N}: la ruine dont parle Mackay n’a peut-être jamais eu lieu.",
                     "claim_kind": "opinion", "verdict": "opinion_ok", "risk": "none", "fact_ids": ["C1", "C2"],
                     "problem": "Formulation prudente (« peut-être »), appuyée par l’étude d’archives de Goldgar.", "suggested_rewrite": ""}],
}

def seg_id(ch, k):
    return f"{ch}-S{k:02d}"

for ch in CHAPTERS:
    cid = ch["id"]
    for lang in ("en", "fr"):
        segs = []
        for k, s in enumerate(ch["segments"], 1):
            text = " ".join(b[lang] for b in s["beats"])
            segs.append({"id": seg_id(cid, k), "type": s["type"], "text": text if s["type"] == "narration" else "", "quote_id": "",
                         "fact_ids": s["facts"], "device": s["device"], "subtitle_translation": ""})
        dump(f"llm/chapter.{lang}.{cid}.json", {
            "chapter_id": cid, "title": ch["title"][lang], "video_title": ch["video_title"][lang], "segments": segs,
            "loops_opened": ch["loops_opened"], "loops_closed": ch["loops_closed"], "summary_for_next": ch["summary"][lang],
        })
    # EN beats (ChapterBeatsWire)
    beats, slices, n = [], [], 0
    for k, s in enumerate(ch["segments"], 1):
        for b in s["beats"]:
            n += 1
            bid = f"{cid}-B{n:03d}"
            beats.append({
                "id": bid, "segment_id": seg_id(cid, k), "text": b["en"], "est_seconds": round(max(0.5, len(b["en"]) / 16.5), 1),
                "purpose": b["purpose"], "energy": b["energy"], "visual_kind": b["vk"], "visual_query": b["q"], "person_ids": b["people"],
                "youtube_quote_to_find": b["yt"], "motion_template": b["tmpl"], "motion_data_json": json.dumps(b["md"], ensure_ascii=False) if b["md"] else "",
                "on_screen_text": b["ost"], "emphasis_words": b["emph"], "camera": b["camera"], "transition_in": b["tr"], "sfx": b["sfx"],
                "music_cue": b["mc"], "music_mood": b["mood"], "fact_ids": b["facts"], "cue_tags": b["cues"],
            })
            slices.append({
                "id": bid, "text": b["fr"], "on_screen_text": b["ost_fr"], "emphasis_words": b["emph_fr"],
                "cue_anchor_words": b["cues_fr"] if b["cues_fr"] is not None else [c["word"] for c in b["cues"]],
                "motion_data_json": json.dumps(b["md_fr"], ensure_ascii=False) if b["md_fr"] else "",
            })
            assert len(slices[-1]["cue_anchor_words"]) == len(b["cues"]), bid
    dump(f"llm/beats.{cid}.json", {"chapter_id": cid, "beats": beats})
    dump(f"llm/beatslice.fr.{cid}.json", {"chapter_id": cid, "beats": slices})
    for lang in ("en", "fr"):
        dump(f"llm/factcheck.{lang}.{cid}.json", {"items": FACTCHECK.get((lang, cid), []), "needs_more_research": [], "title_thumbnail_issues": []})
print("ok")
