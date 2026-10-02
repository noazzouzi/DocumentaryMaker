#!/usr/bin/env python3
# Usage (from the repo root): python3 packages/llm/scripts/gen-fixtures/gate.py fixtures/gate-test
# fixtures/gate-test/** — FICTIONAL people and company only (example.org sources). Exercises the safety gates:
# 2 high LLM fact-check items + 1 quote_mismatch, a non-public person, a pending claim (asOf > 30 days before the demo
# date), an accusatory on-screen text on a person beat, autoApproveGates:false.
import json, os, sys

OUT = sys.argv[1]
os.makedirs(os.path.join(OUT, "llm"), exist_ok=True)

def dump(rel, obj):
    with open(os.path.join(OUT, rel), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")

AS_OF = "2026-06-15"
S1 = "https://example.org/glimmerline/court-filing"
S2 = "https://example.org/glimmerline/founder-interview"
S3 = "https://example.org/glimmerline/settlement-notice"

dump("fixture.json", {
    "schemaVersion": 1, "id": "gate-test", "title": "Glimmerline (fictional gate test)",
    "idea": "The fall of Glimmerline, a fictional influencer agency (safety-gate test fixture; every person and company is invented)",
    "languages": ["en"], "primaryLang": "en", "targetMinutes": 1.5, "styleId": "drama-commentary",
    "asOf": AS_OF, "seed": 4242, "autoApproveGates": False,
})

dump("llm/research.json", {
    "dossier_markdown": "\n".join([
        "# Glimmerline (fictional) — research notes",
        "- March 2026: the influencer agency Glimmerline shuts down overnight [" + S1 + "]",
        "- June 2026: prosecutors charge founder Marlo Vance with misusing client funds; Vance denies the charges; no trial yet [" + S1 + "]",
        "- Interview: Vance says \"We never touched a cent that wasn't ours.\" [" + S2 + "]",
        "- Bookkeeper Dara Quill (not a public figure) left the company the same week [" + S1 + "]",
        "- A civil claim by clients was settled without admission of liability [" + S3 + "]",
    ]),
    "registry": [
        {"url": S1, "title": "Glimmerline court filing (fictional)", "page_age": None, "fetched": True, "cited": 3, "snippets": ["Prosecutors charged Marlo Vance with misusing client funds."]},
        {"url": S2, "title": "Interview with Marlo Vance (fictional)", "page_age": None, "fetched": True, "cited": 1, "snippets": ["We never touched a cent that wasn't ours."]},
        {"url": S3, "title": "Glimmerline settlement notice (fictional)", "page_age": None, "fetched": True, "cited": 1, "snippets": ["settled without admission of liability"]},
    ],
    "searches_used": 3, "fetches_used": 3,
})

Q1 = "We never touched a cent that wasn't ours."
dump("llm/factsheet.json", {
    "topic": "Glimmerline (fictional)", "as_of": AS_OF,
    "one_line_premise": "A fictional influencer agency vanished overnight, and its founder now faces charges he denies.",
    "central_question": "Where did the clients' money go?",
    "sources": [
        {"id": "S1", "url": S1, "title": "Glimmerline court filing (fictional)", "publisher": "Example County Court", "published_at": "2026-06-10", "source_type": "court_document", "reliability": "high", "language": "en"},
        {"id": "S2", "url": S2, "title": "Interview with Marlo Vance (fictional)", "publisher": "Example News", "published_at": "2026-04-02", "source_type": "primary_interview", "reliability": "medium", "language": "en"},
        {"id": "S3", "url": S3, "title": "Glimmerline settlement notice (fictional)", "publisher": "Example Daily", "published_at": "2026-05-20", "source_type": "major_news", "reliability": "high", "language": "en"},
    ],
    "people": [
        {"id": "P1", "name": "Marlo Vance", "role_in_story": "Founder of the influencer agency Glimmerline", "public_figure": True, "is_minor_or_private_victim": False, "image_queries": ["Marlo Vance"]},
        {"id": "P2", "name": "Dara Quill", "role_in_story": "Former bookkeeper of Glimmerline", "public_figure": False, "is_minor_or_private_victim": False, "image_queries": ["Dara Quill"]},
    ],
    "timeline": [
        {"id": "E1", "date": "2026-03", "title": "Glimmerline shuts down", "what_happened": "The agency goes dark overnight.", "person_ids": ["P1"], "status": "established_fact", "source_ids": ["S1"], "drama_value": 8},
        {"id": "E2", "date": "2026-06", "title": "Vance is charged", "what_happened": "Prosecutors charge Marlo Vance with misusing client funds; he denies the charges.", "person_ids": ["P1"], "status": "charged_pending", "source_ids": ["S1"], "drama_value": 9},
        {"id": "E3", "date": "2026-03", "title": "The bookkeeper leaves", "what_happened": "Dara Quill leaves the company the same week.", "person_ids": ["P2"], "status": "established_fact", "source_ids": ["S1"], "drama_value": 5},
    ],
    "quotes": [
        {"id": "Q1", "speaker_id": "P1", "verbatim": Q1, "language": "en", "date": "2026-04", "context": "Interview after the shutdown", "medium": "video_interview", "source_id": "S2", "youtube_search_query": ""},
    ],
    "figures": [],
    "claims": [
        {"id": "C1", "summary": "Marlo Vance misused client funds", "made_by": "Example County prosecutors", "against": "Marlo Vance", "status": "charged_pending", "jurisdiction": "Example County Court",
         "decision_date": "", "subject_response": "Vance denies the charges", "sensitivity": "high", "source_ids": ["S1"]},
        {"id": "C2", "summary": "Clients' civil claim against Glimmerline was settled", "made_by": "Glimmerline clients", "against": "Glimmerline", "status": "settled_no_admission",
         "jurisdiction": "Example County Court", "decision_date": "2026-05", "subject_response": "", "sensitivity": "medium", "source_ids": ["S3"]},
    ],
    "angles": ["An agency that sold fame and lost the money"],
    "gaps": [],
})

dump("llm/style.json", {
    "topic_type": "company_collapse",
    "ranked": [{"style_id": "drama-commentary", "score": 0.9, "why": "A company collapse with legal stakes."}],
    "recommended_style_id": "drama-commentary", "recommended_minutes": 15,
    "title_options": ["Glimmerline: Where Did the Money Go?"], "thumbnail_text_options": ["WHERE IS IT?"],
    "risk_flags": ["real_person_allegations", "ongoing_trial"],
    "theme_override": {"accent": "", "backdrop_recipe": "", "texture": ""},
})

dump("llm/outline.json", {
    "language": "en", "story_shape": "rise-fall", "title": "Glimmerline: Where Did the Money Go?",
    "thesis": "An agency that sold attention could not account for its clients' money; the courts have not ruled yet.",
    "hook_teasers": [{"id": "T1", "teaser": "The agency that vanished overnight", "paid_off_in": "CH2"}],
    "loops": [{"id": "L1", "question": "Where did the money go?", "opened_in": "CH1", "closed_in": "CH3"}],
    "chapters": [
        {"id": "CH1", "act": "cold_open", "title": "Gone Overnight", "target_words": 50, "purpose": "The shutdown.", "event_ids": ["E1"], "claim_ids": [], "quote_ids": [],
         "opens_loops": ["L1"], "closes_loops": [], "exit_hook": "Where did the money go?", "ad_break_after": False},
        {"id": "CH2", "act": "act2a_cracks", "title": "The Charges", "target_words": 90, "purpose": "Charges, denial, the bookkeeper.", "event_ids": ["E2", "E3"], "claim_ids": ["C1"], "quote_ids": ["Q1"],
         "opens_loops": [], "closes_loops": [], "exit_hook": "The bookkeeper left the same week.", "ad_break_after": False},
        {"id": "CH3", "act": "act3_reckoning", "title": "No Verdict Yet", "target_words": 78, "purpose": "Settlement; status pending.", "event_ids": [], "claim_ids": ["C2"], "quote_ids": [],
         "opens_loops": [], "closes_loops": ["L1"], "exit_hook": "The trail ends in a courtroom.", "ad_break_after": False},
    ],
    "callback_plan": [], "next_video_bridge": "",
})

def seg(id_, type_, text, facts, device="none", quote_id=""):
    return {"id": id_, "type": type_, "text": text, "quote_id": quote_id, "fact_ids": facts, "device": device, "subtitle_translation": ""}

CH = {
    "CH1": {"title": "Gone Overnight", "video_title": "Glimmerline: Where Did the Money Go?", "lo": ["L1"], "lc": [], "segs": [
        seg("CH1-S01", "narration", "In March 2026, the influencer agency Glimmerline went dark overnight.", ["E1", "S1"]),
        seg("CH1-S02", "narration", "Its founder, Marlo Vance, had promised his clients a fortune.", ["P1", "S1"]),
        seg("CH1-S03", "narration", "So where did the money go?", ["S1"], "open_loop"),
    ]},
    "CH2": {"title": "The Charges", "video_title": "", "lo": [], "lc": [], "segs": [
        seg("CH2-S01", "narration", "In June 2026, prosecutors charged Vance with misusing client funds. He denies the charges and has not been tried.", ["C1", "E2", "S1"]),
        # deliberately NOT the verbatim of Q1 (quote_mismatch, fact-check rule a)
        seg("CH2-S02", "clip", "We never touched a cent that was not ours.", ["Q1"], "none", "Q1"),
        seg("CH2-S03", "narration", "That same week, his bookkeeper Dara Quill walked out of the company.", ["P2", "E3", "S1"], "cliffhanger"),
    ]},
    "CH3": {"title": "No Verdict Yet", "video_title": "", "lo": [], "lc": ["L1"], "segs": [
        seg("CH3-S01", "narration", "A civil claim by the clients was settled without any admission of liability.", ["C2", "S3"]),
        seg("CH3-S02", "narration", "For now, the trail of the money ends in a courtroom, and the charges, which Vance denies, are still pending.", ["C1", "S1"], "payoff"),
    ]},
}
for cid, c in CH.items():
    chapter = {"chapter_id": cid, "title": c["title"], "video_title": c["video_title"], "segments": c["segs"], "loops_opened": c["lo"], "loops_closed": c["lc"],
               "summary_for_next": f"{c['title']}."}
    dump(f"llm/chapter.en.{cid}.json", chapter)
    if cid == "CH2":
        dump("llm/revise.en.CH2.json", chapter)  # the revision keeps the mismatch: only a human fix resolves it

def b(seg_id, text, vk, q, tmpl="none", md="", people=None, facts=None, cues=None, ost="", energy=3, purpose="context"):
    return {"id": "", "segment_id": seg_id, "text": text, "est_seconds": round(len(text) / 16.5, 1), "purpose": purpose, "energy": energy, "visual_kind": vk,
            "visual_query": q, "person_ids": people or [], "youtube_quote_to_find": "", "motion_template": tmpl, "motion_data_json": md,
            "on_screen_text": ost, "emphasis_words": [], "camera": "ken_burns", "transition_in": "cut", "sfx": [], "music_cue": "none", "music_mood": "tense",
            "fact_ids": facts or [], "cue_tags": cues or []}

BEATS = {
    "CH1": [
        b("CH1-S01", "In March 2026,", "text_card", "calendar march", facts=["E1"], purpose="hook"),
        b("CH1-S01", "the influencer agency Glimmerline", "stock_broll", "empty office at night", facts=["E1"], purpose="hook"),
        b("CH1-S01", "went dark overnight.", "stock_broll", "office lights switching off", facts=["E1"], purpose="hook"),
        b("CH1-S02", "Its founder, Marlo Vance,", "archival_photo", "Marlo Vance", people=["P1"], facts=["P1"], purpose="hook",
          cues=[{"type": "PERSON_INTRO", "word": "Marlo", "value": "Marlo Vance"}]),
        b("CH1-S02", "had promised his clients a fortune.", "stock_broll", "stacks of cash", facts=["P1"], purpose="hook"),
        b("CH1-S03", "So where did the money go?", "text_card", "question mark", "kinetic_text", json.dumps({"lines": ["WHERE DID IT GO?"]}), facts=["S1"],
          ost="WHERE DID IT GO?", purpose="cliffhanger"),
    ],
    "CH2": [
        b("CH2-S01", "In June 2026, prosecutors charged Vance with misusing client funds.", "archival_photo", "courthouse exterior", facts=["C1", "E2"]),
        # accusatory on-screen text on a person beat whose claim is only charged_pending (fact-check rule f)
        b("CH2-S01", "He denies the charges and has not been tried.", "text_card", "Marlo Vance", "kinetic_text", json.dumps({"lines": ["THIEF?"]}), people=["P1"],
          facts=["C1"], ost="THIEF?", energy=5, purpose="reveal", cues=[{"type": "SHOCK", "word": "denies", "value": ""}]),
        b("CH2-S03", "That same week, his bookkeeper Dara Quill", "archival_photo", "Dara Quill", people=["P2"], facts=["P2", "E3"],
          cues=[{"type": "PERSON_INTRO", "word": "Dara", "value": "Dara Quill"}]),
        b("CH2-S03", "walked out of the company.", "stock_broll", "person leaving office with box", facts=["E3"], purpose="cliffhanger"),
    ],
    "CH3": [
        b("CH3-S01", "A civil claim by the clients was settled", "document_screenshot", "settlement document", facts=["C2", "S3"]),
        b("CH3-S01", "without any admission of liability.", "stock_broll", "handshake lawyers", facts=["C2"]),
        b("CH3-S02", "For now, the trail of the money ends in a courtroom,", "archival_photo", "empty courtroom", facts=["C1"], purpose="payoff"),
        b("CH3-S02", "and the charges, which Vance denies, are still pending.", "text_card", "pending stamp", facts=["C1"], purpose="payoff"),
    ],
}
for cid, beats in BEATS.items():
    for k, x in enumerate(beats, 1):
        x["id"] = f"{cid}-B{k:03d}"
    dump(f"llm/beats.{cid}.json", {"chapter_id": cid, "beats": beats})

FC = {
    "CH1": [],
    "CH2": [
        {"segment_id": "CH2-S01", "where": "CH2-S01", "surface": "narration", "sentence": "In June 2026, prosecutors charged Vance with misusing client funds.", "claim_kind": "allegation",
         "verdict": "status_missing_or_outdated", "risk": "high", "fact_ids": ["C1"],
         "problem": "The charge is pending as of 2026-06-15; the status may have changed. Re-check before publishing.",
         "suggested_rewrite": "As of June 2026, prosecutors had charged Vance with misusing client funds; he denies the charges and has not been tried."},
        {"segment_id": "CH2-S03", "where": "CH2-S03", "surface": "narration", "sentence": "That same week, his bookkeeper Dara Quill walked out of the company.", "claim_kind": "fact",
         "verdict": "private_person_named", "risk": "high", "fact_ids": ["P2"],
         "problem": "Dara Quill is not a public figure; naming her needs an editorial decision (person-ack).", "suggested_rewrite": "That same week, the company's bookkeeper walked out."},
        {"segment_id": "CH2-S02", "where": "CH2-S02", "surface": "clip-quote", "sentence": "We never touched a cent that was not ours.", "claim_kind": "quote",
         "verdict": "quote_mismatch", "risk": "high", "fact_ids": ["Q1"],
         "problem": "The clip text differs from the verbatim quote (\"wasn't\" vs \"was not\").", "suggested_rewrite": Q1},
    ],
    "CH3": [],
}
for cid, items in FC.items():
    dump(f"llm/factcheck.en.{cid}.json", {"items": items, "needs_more_research": ["Marlo Vance charges status"] if cid == "CH2" else [], "title_thumbnail_issues": []})

dump("llm/recheck.json", {"claims": [
    {"id": "C1", "status": "charged_pending", "jurisdiction": "Example County Court", "decision_date": "", "subject_response": "Vance denies the charges",
     "changed": False, "note": "", "source_urls": [S1]},
]})
print("ok")
