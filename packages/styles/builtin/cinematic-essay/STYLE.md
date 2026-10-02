# Cinematic essay — style sheet

Patient, atmospheric long-form essays about history, mysteries, culture and big ideas. The film breathes: wide frames, long dissolves, a restrained narrator and a score that knows when to stop. Every number below is a default the engine reads from `style.json`.

## 1. Essence / not

- **Is:** a guided meditation on a question, built from real archival material in a 2.39 letterbox; it earns its conclusions slowly and lets images and silences carry weight.
- **Is:** precise. Dates, places and sources are on screen when they matter; the essay argues from evidence and says where the evidence ends.
- **Is not:** a hype edit (no flashes on every cut, no slams, no stamps), a lecture over stock footage, or a mystery that invents its answers.

## 2. Materials

- **First choice:** archival photographs, paintings, engravings, maps, newsreels and period documents of the actual subject.
- **Second:** documents and articles from the research ledger, shown as paper cards with a highlighted passage; maps and timelines for space and time.
- **Third:** short clips of interviews or footage, framed full screen (cover) and followed by reflection.
- **Last resort:** literal stock B-roll for textures (water, roads, rooms). Never stock for a named person; never an AI image of a real person.
- **Stills:** framed cards ~60 % (thin border, 0–1.5° tilt, soft shadow) on paper, dark noise or a blurred copy; covers ~40 % with slow drift.

## 3. Colour logic

| Token | Hex | Meaning |
|---|---|---|
| ink | `#0B0C10` | base, letterbox, chapter backdrops |
| paper | `#EDE6D6` | documents, cards, the default backdrop |
| text | `#F5F1E8` | titles and subtitles (warm white) |
| accent | `#C9A66B` | muted gold: the single emphasis colour |
| danger | `#B5473A` | loss, violence, decline (used sparingly) |
| money | `#6FA387` | money and growth |
| secondary | `#5B7DA6` | maps, data, cold counterpoint |
| muted | `#7D7A73` | sources, dates, labels |

- Grade: film-fade (lifted blacks 0.35, contrast −0.28, warm temperature +0.16), split tone slate shadows / warm highlights at 15 %, vignette 0.35, film grain 6–8 in the master.
- The depths act runs darker and less saturated; the coda desaturates further. Greyscale sources stay black and white; pre-1970 colour gets the archival treatment.

## 4. Type & subtitles

| Role | Family | Size (px) |
|---|---|---|
| Chapter titles, headlines, slams | Instrument Serif | chapter 132 (kicker 26), slam 160 |
| Body, lower thirds, subtitles | Inter | lower third 48 / 26, rail 40, card body 38 |
| Data, dates, sources | JetBrains Mono | labels 22, counters 140 |
| Documents | Courier Prime | per component |

- Subtitles default to **SRT only** (no burned captions). When burned, the variant is a thin rail: sentence case, Inter 40 px weight 600, one line inside the band x 360–1560, y 850–930 — above the letterbox bar and the YouTube controls.
- No keyword slams; lower thirds name people and places. Clip lines in Inter 42 px on 65 % black, held at least 2 s.

## 5. Motion quality

- Entries decelerate gently (`cubic-bezier(0.25, 1, 0.5, 1)`), ≤ 24 frames; nothing overshoots — no bounce anywhere.
- Ken Burns is slow and continuous: 1.5–2.5 % scale per second, 6–12 px/s drift, shallow ease with non-zero end slopes.
- Transitions are felt, not seen: dissolves 15–30 frames; a cut to black is a full stop.
- Stillness before a climax lasts 0.5–1.2 s.

## 6. Camera grammar table

| Move | Trigger | Parameters (30 fps) |
|---|---|---|
| Shot length | every shot | ASL 4–8 s (target 5.5), hook ×0.75, max static hold 8 s, min 45 frames; cut 2 frames before the word |
| Ken Burns | every still held ≥ 3 s | start scale 1.00–1.02, +1.5–2.5 %/s, drift 6–12 px/s; video creep 1.00–1.03 |
| Push-in | emphasis (rare) | 1.06–1.12 over 3–6 frames, 0–2 per minute, ≥ 10 s apart, no fill |
| Reframe | reuse within 90 s | tight 1.20–1.35 toward the focal point, or wide 1.00–1.03 |
| Creep | TENSION_BUILD | 1.00 → 1.05 over 150–300 frames |
| Pull-back | scale reveal | 1.20 → 1.00 over 30 frames, blur 6 → 0 px |
| Montage | MONTAGE, music breaths | ASL 1.2–2.4 s, dissolves, beat push +2 % |
| Clip | CLIP_REF | full frame (cover), creep 1.00–1.03, layout switch after 12 s |

Transitions: about 75 % plain cuts. Of the rest, dissolves are primary (60–70 %), with zoom-through, light leak and dip to black as accents — at most 4 kinds per film, never 3 alike in a row, at least 1.5 s apart. Chapter and act boundaries: dip to black. Durations: calm 24–30, medium 18–24, high 15–18 frames.

## 7. Sound palette

- **Palette:** soft and upward whooshes, reverse swells, risers, soft impacts and low booms, paper, clicks, ticks, typewriter keys, drones, heartbeat, room and crowd ambience. No hard impacts, no comedic sounds.
- **Density:** 2–5 SFX per minute, at most 1 impact per minute; 80 % of cuts are silent. Ambience carries the space.
- **Music:** a swelling score in 2.5–5 minute sections, ducked −12 dB under the voice; at least 3 real silences every 5 minutes (0.6–1.5 s) and 2 J/L cuts; the music drops 0.75–1.5 s before a reveal; long fades (2–3 s).

## 8. Native moves

- **The opening image:** a single archival frame held long, a question over it, then the title card in serif.
- **Chapter cards** in serif over paper, with a dip to black on either side.
- **Map and timeline passes:** the camera travels a map or a timeline as the narration moves through place and time.
- **The highlighted passage:** a document card, the camera settles on one sentence, a gold highlight sweeps it.
- **Letterboxed montage:** dissolves over a rising score, then silence.
- **The return:** the closing image echoes the opening one, wider.

## 9. Pitfalls

- Drama habits: flashes, slams, stamps, punch-ins on every name.
- Dead stills: every still keeps drifting; never hold a static frame longer than 8 s.
- Dissolves between two unrelated ideas (use a cut or a dip to black instead).
- Music under every second; an essay needs silence to land a thought.
- Text in the letterbox bars or the bottom 12 %.
- Presenting a theory as fact; mysteries keep their open questions open.

## 10. Engine

- The writer controls script, beat slices, cue tags, visual kinds and queries, motion templates and data, emphasis words and music moods; the director decides frames, transitions and levels from this style's data.
- Disabled here: keyword slams and stamps (REVEAL is handled by a dip to black and music). Captions default to SRT only; the letterbox comes from the grade (2.39).
- Cue triggers: PERSON_INTRO → lower third; QUOTE → quote card; TWEET → post card; NUMBER → counter; TIME_JUMP → date stamp; COMPARISON → split screen; SENSITIVE → censor bar; DOCUMENT/EMPHASIS → spotlight; LIST → kinetic text; MONTAGE → photo burst (rare); CLIP_REF → source label.
- Unimplemented components render a fallback card; deferred transitions are mapped by the director. Nothing crashes on missing pieces.

## 11. Variation space

- **Theme:** accent colour and backdrop may follow the subject (sea blue for a maritime story, ochre for the desert) through the project theme override.
- **Captions:** SRT only (default), or the burned rail.
- **Texture:** paper or film texture through the theme override; a serif headline font of the built-in set.
- **Letterbox:** 2.39 is part of this style's grade; for films built mostly on 4:3 archives, scaffold a variant style with `grade.letterbox: null`.
- **Fixed:** no overshoot, the cut share, keep-outs, silence floors, the safety rules.
