# Drama / commentary — style sheet

Long-form narrated documentaries about downfalls, scandals, company collapses and internet drama, cut like a thriller. The narrator is the guide; the edit is punctuation. Every number below is a default the engine reads from `style.json`.

## 1. Essence / not

- **Is:** a story of rise, cracks and collapse told by one confident narrator over real material — archival photos, news footage, short clips, documents, posts and numbers — with a punchy but budgeted edit. Every shot proves or sharpens the sentence it sits under.
- **Is:** escalating. Each chapter raises the stakes; reveals are set up, held back, then landed with silence, a flash and a stamp.
- **Is not:** a news bulletin (no neutral recitation), a reaction video (no long clips without commentary), a tabloid (no invented posts, headlines or quotes, no accusations in the narrator's voice), a listicle, or a meme compilation (no comedic SFX pack).

## 2. Materials

- **First choice:** real archival photos and footage of the named people, places and events; documents, filings and articles that exist in the research ledger; real posts and headlines tied to a fact reference.
- **Second:** short YouTube clips (a quote found in a transcript), always introduced by the narration and followed by commentary.
- **Third:** motion graphics built from the fact sheet — counters, timelines, charts, maps, quote cards, document highlights, evidence boards.
- **Last resort:** literal stock B-roll (concrete nouns only). Never stock for a named person. Never an AI image of a real person; AI illustration only for abstract or historical scenes, stylised, never photorealistic.
- **Stills** are shown full-bleed (cover, ~60 %) or as framed photo cards (~40 %; portraits, squares and small images always become cards) on a moving backdrop: dark gradient with a grid, paper, or a blurred copy of the image. Cards: 70–85 % of frame height, 10–14 px white border, 1–3° tilt, deep soft shadow.

## 3. Colour logic

| Token | Hex | Meaning |
|---|---|---|
| ink | `#0E0F0E` | base, backdrops, slams on black |
| paper | `#F1EEE6` | documents, letters, court papers |
| text | `#FFFFFF` | captions, titles |
| accent | `#FFD400` | **the** emphasis colour: keywords, highlights, stamps. One accent per frame |
| danger | `#E8412F` | losses, legal trouble, deleted, verdicts |
| money | `#3DDC84` | money gained, valuations |
| secondary | `#2F3CFF` | data series, maps, neutral counterpoint |
| muted | `#8A8A8A` | context labels, dates, sources |

- Grade: teal-orange look (contrast ×1.08, split tone teal shadows / amber highlights at 18 %), vignette 0.3, light film grain added in the master only.
- The collapse act runs darker and less saturated (vignette 0.38); the reckoning settles back.
- Greyscale sources get the black-and-white treatment; pre-1970 colour sources get the archival treatment (light sepia). Never colour text on a background of the same hue.
- A project may theme the edit to its subject (accent colour, backdrop) through a theme override; meanings stay the same.

## 4. Type & subtitles

| Role | Family | Size (px) |
|---|---|---|
| Chapter titles, headlines | Anton | 120 (kicker 28) |
| Slams, captions | Archivo Black | slam 220, captions 78, keyword captions 96 |
| Body, lower-third roles, clip subtitles | Inter | lower third 54 / 30, card body 40, clip lines 44 |
| Data, labels, dates | JetBrains Mono | labels 24, counters 160 |
| Quotes | Instrument Serif | per component |
| Documents | Courier Prime | per component |

- **Captions are selective** (variant `keywords`): ALL CAPS, weight 900, 9 px black stroke, one line, 2–4 words, at least 6–10 s apart; keyword yellow, money green, danger red; each word pops 1.18 → 1.0 over 3 frames. Full SRT subtitles are exported separately.
- Captions live in the caption band (x 210–1710, y 760–900) and never enter the bottom 130 px (YouTube controls). They hide under full-frame text components (quote, document, headline, post, timeline, chart, map, slam, chapter card) and under any overlay carrying 8 words or more.
- Clip lines (what a person says in a clip) use Inter 44 px on 70 % black, held at least 1.8 s, so they never look like narration captions.

## 5. Motion quality

- Entries decelerate with a long tail (`cubic-bezier(0.16, 1, 0.3, 1)`), finish within 24 frames (800 ms); total stagger ≤ 15 frames. Exits accelerate out (`0.7, 0, 0.84, 0`).
- No bounce, no elastic — except the Stamp, the only impact component allowed to overshoot. Never overshoot in camera moves or transitions.
- Ken Burns never stops: shallow ease with non-zero end slopes, matched speed across cuts (2.5–4 % scale per second, 10–20 px/s drift), so a cut between two moving stills feels continuous.
- Cut at peak velocity; directional moves keep their direction across the cut.
- Stillness before a climax: 0.3–0.75 s of quiet picture and sound, then the hit.

## 6. Camera grammar table

| Move | Trigger | Parameters (30 fps) |
|---|---|---|
| Shot length | every shot | ASL 2–4 s (target 3), hook ×0.6, max static hold 3 s, min 24 frames; cut 2 frames before the word that brings the new idea |
| Ken Burns | every still held ≥ 2 s | start scale 1.00–1.04, +2.5–4 %/s, drift 10–20 px/s; video creep 1.00–1.04 |
| Punch-in (zoom cut) | emphasis, a name, a punchline | 1.12–1.25 in 0–3 frames toward the focal point, held to the end of the shot; 6–10 per minute, ≥ 90 frames apart, at least one per chapter |
| Reframe | reusing an asset within 60 s | tight 1.25–1.45 toward the focal point, or wide 1.00–1.04; never the same framing twice |
| Impact plate | SHOCK, hero word | zoom +5 % decaying (9/s), shake 8 × 5 px at 12 Hz over 0.6 s, anchored 45 ms after the word onset |
| Impact shake | slams, chapter hits | 8–15 frames, 10–25 px, 0.5–1°, overscan 1.03 |
| Creep | TENSION_BUILD | 1.00 → 1.06 over 120–240 frames |
| Pull-back | scale reveal | 1.25 → 1.00 in 15 frames, blur 10 → 0 px |
| Cut accent | ~15 % of hard cuts | +5 % pulse over 8 frames or a 0.45 flash over 6 frames |
| Montage | MONTAGE, music breaths | ASL 0.6–1.2 s, cuts snapped to beats (±3 frames), beat punch +5.5 % over 8 frames |
| Clip | CLIP_REF | picture-in-picture over a blurred copy, creep 1.00–1.05, layout switch after 8 s, +15 % punch on the key line |

Transitions: about 85 % of shot boundaries are plain cuts. Of the rest, the flash is primary (60–70 %; routine 0.2–0.45, never above 0.5, 2–4 frames), with whip, zoom-through, glitch, push-cut and paper rip as accents — at most 5 kinds per film, 2 accent kinds per act, never 3 alike in a row, at least 1 s apart. Chapter boundaries: hard cut + impact. The two or three macro-act boundaries: dip to black. Durations by energy: calm 15–24, medium 9–15, high 5–9 frames.

## 7. Sound palette

- **Palette:** light, heavy, whip and upward whooshes; risers; impacts, soft impacts, sub booms and low booms; thuds; pops, clicks, ticks, dings; camera shutter; paper; keys; glitch; notification; drones; heartbeat; room ambience. No comedic pack (no record scratch, no meme booms).
- **Density:** 8–15 SFX per minute, 1–3 impacts per minute; about half of the cuts carry no transition sound; never the same file twice in a row; the peak of every sound lands on its event frame.
- **Levels (peak dBFS):** whooshes −24 to −18, impacts −12 to −6, sub booms −12 to −6, UI sounds −28 to −16, drones −30 to −24, ambience −38 to −32; profanity in quoted clips gets a −18 dBFS bleep.
- **Music:** sections of 2–4 minutes on downbeats, ducked −12 dB under the voice (−4 dB for SFX), music drops 0.5–0.75 s before a reveal and 1–1.5 s on irony; at least 2 real silences every 5 minutes (12–24 frames), and the first sound after a silence is a key one; at least one J/L cut every 5 minutes.

## 8. Native moves

- **Rock-bottom cold open** → title sting with an impact at the end of the hook.
- **The receipt:** a document or article card, camera moves to the sentence, highlighter sweep synced to the narrator, paper + marker sounds.
- **Freeze + label:** the picture freezes on a person, darkens and desaturates, the name slams in (shutter + impact).
- **The stamp verdict:** BANKRUPT, CANCELLED, SETTLED, DISMISSED… dropped on the image with a thud; status words such as CONVICTED or LIABLE only with a cited ruling.
- **Number counter** that rolls up and lands with a ding or impact; money in green, losses in red.
- **Evidence board / photo burst:** several pieces of evidence pinned and linked, or 5–8 photos fired in an accelerating burst over a riser.
- **PiP clip + reaction:** a short clip framed over its blurred self with a source label, then the narrator's one-line reaction.
- **Reveal sequence:** tension creep, music drops, half a second of silence, flash, the reveal line, the stamp.
- **Keyword slam:** one word on black, 12–20 frames, sub boom — at most once a minute.

## 9. Pitfalls

- Effects on every cut. Respect the salience budget (≤ 3 accents in any 3 s window) and leave a clean stretch of at least 6 s (Ken Burns and captions only) every minute.
- Full white flashes: they read as dropped frames. Routine flashes stay ≤ 0.45, explicit ones ≤ 1 per minute.
- Captioning every word, or putting the narration on screen. Captions are punctuation.
- Text in the bottom 12 % of the frame, or two things to read at once.
- A reused photo with the same framing within 60 s; more than two framed cards in a row; a still held without motion.
- Stock footage for a named person; an AI image of a real person.
- A clip with no setup or no reaction; two clips back to back.
- Loud SFX on every cut; the same whoosh twice in a row; heavy whooshes on small moves.
- "Allegedly" in front of an accusation the narrator asserts: wording must match the claim status, with attribution and the subject's response.

## 10. Engine

- The writer controls the script, the beat slices, cue tags, visual kinds and queries, motion templates with their data, emphasis words and music moods. It never sets frames, durations, transitions or levels.
- The director reads this style's data: pacing and quotas (`cameraPolicy`, `transitionPolicy`, `sfxPolicy`, `musicPolicy`, `budgets`, `techniqueFloor`), cue → component triggers (`components`), caption DNA, layout zones and keep-outs, grade by act, and the story-shape acts.
- Cue triggers: PERSON_INTRO → lower third or freeze label; QUOTE → quote card; TWEET → post card; REVEAL → stamp; SHOCK → keyword slam; NUMBER → counter; TIME_JUMP → date stamp; COMPARISON → split screen; SENSITIVE → censor bar; DOCUMENT/EMPHASIS → spotlight; LIST → kinetic text, photo burst or evidence board; MONTAGE → photo burst; CLIP_REF → source label. Template-only components (article, document, headlines, map, timeline, chart, comment pile) appear only from a motion template.
- Components that are not implemented yet render a fallback card; deferred transitions are mapped (paper rip → flash). Nothing crashes on missing pieces.

## 11. Variation space

- **Story shape:** rise → fall (default), fall → comeback, spiral → twist; act shares are fixed per shape.
- **Theme:** accent colour, backdrop recipe, texture (paper, film, scanlines, halftone) and headline font can follow the subject (crypto, fashion, sport, tech) through the project theme override; colour meanings stay.
- **Captions:** keywords (default), full pop captions, or burned-in off with SRT only.
- **Energy:** acts scale punch, SFX and transition intensity (cold open ×1.15, collapse ×1.2, false hope ×0.9, reckoning ×0.7, outro ×0.6).
- **Fixed:** safety rules, keep-out zones, flash caps, the cut share, and the technique floors (a punch per chapter, silences and J/L cuts every five minutes).
