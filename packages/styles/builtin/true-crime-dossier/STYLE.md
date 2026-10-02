# True crime dossier — style sheet

Restrained investigative documentaries about crimes, disappearances, trials and unsolved cases, built like a case file. The tone is sober and precise; tension comes from evidence, time and silence, never from gore. Every number below is a default the engine reads from `style.json`.

## 1. Essence / not

- **Is:** a case reconstructed from the record — documents, photographs of places, maps, timelines, court outcomes — narrated with care for the people involved.
- **Is:** honest about uncertainty. What is proven, alleged, charged, convicted, acquitted or unknown is always explicit, with dates and jurisdictions.
- **Is not:** sensational (no gore, no "monster", no reconstructed violence), a podcast with stock footage, or an amateur investigation that accuses people the courts did not.

## 2. Materials

- **First choice:** archival photos of places and public figures, police and court documents, filings and press coverage from the research ledger, maps, timelines.
- **Second:** news footage and short interview clips, framed full screen and followed by commentary.
- **Third:** motion graphics: date stamps, timelines, evidence boards, maps with pins, document cards with redactions.
- **Last resort:** neutral stock textures (roads at night, rain, empty rooms). Never stock for a named person; never an AI image of a real person or a real scene.
- **Victims and private people** appear only with approval; minors never.
- **Stills:** cards (polaroid-like, 12–18 px border, 1–4° tilt) on dark noise or paper ~50 %, covers ~50 % with a creeping push.

## 3. Colour logic

| Token | Hex | Meaning |
|---|---|---|
| ink | `#0A0B0D` | base and backdrops |
| paper | `#E9E4D8` | case documents |
| text | `#F2F2F2` | titles and subtitles |
| accent | `#E3B23C` | evidence yellow: highlights, the single emphasis colour |
| danger | `#D7263D` | redactions, verdicts, warnings (sparingly) |
| money | `#7FB069` | money |
| secondary | `#4A6FA5` | maps, timelines |
| muted | `#8B8F94` | sources, dates, labels |

- Grade: desaturated cool (saturation ×0.75, cool temperature, slate shadows), vignette 0.45, heavier grain (8–10) in the master. The turn act runs darker; the unresolved act stays cold.
- Greyscale sources stay black and white; pre-1970 colour gets the archival treatment.

## 4. Type & subtitles

| Role | Family | Size (px) |
|---|---|---|
| Chapter titles, case headers | Special Elite | 110 (kicker 26) |
| Body, lower thirds | Inter | 50 / 28, card body 36 |
| Subtitles, dates, labels | JetBrains Mono | rail 30, labels 22, counters 140 |
| Documents | Courier Prime | per component |

- Captions are a **monospace rail**: sentence case, JetBrains Mono 30 px, one line in the band x 360–1560, y 880–944 (kept above the bottom 12 % for the YouTube controls). No keyword pops, no slams.
- Date and place stamps type on at two frames per character.
- Clip lines in JetBrains Mono 36 px on 70 % black, held at least 2 s.

## 5. Motion quality

- Near-linear, unhurried motion: entries ≤ 20 frames with a soft deceleration; nothing overshoots.
- The camera creeps (1.00 → 1.06 over 5–10 s) with a faint handheld drift (±1 px stepped at 3 fps).
- Ken Burns is slow (1–2 % per second, 3–8 px/s) and never stops.
- Stillness before a reveal lasts 0.6–1.5 s.

## 6. Camera grammar table

| Move | Trigger | Parameters (30 fps) |
|---|---|---|
| Shot length | every shot | ASL 4–10 s (target 6), hook ×0.7, max static hold 10 s, min 45 frames; cut 2 frames before the word |
| Ken Burns | every still held ≥ 3 s | start scale 1.00–1.02, +1–2 %/s, drift 3–8 px/s |
| Creep | TENSION_BUILD, documents | 1.00 → 1.06 over 150–300 frames |
| Handheld | all shots | ±1 px at 3 fps (stepped) |
| Push-in | a key name or line (rare) | 1.06–1.12 in 0–4 frames, at most 1 per minute, no fill |
| Reframe | reuse within 90 s | tight 1.20–1.40 toward the focal point, or wide 1.00–1.03 |
| Evidence flash | REVEAL, a photo being taken | 2–3 frames, 0.25–0.45 |
| Clip | CLIP_REF | full frame (cover), creep 1.00–1.03, layout switch after 12 s |

Transitions: about 90 % plain cuts. Of the rest, dip to black is primary (60–70 %), with evidence flashes and a VHS-style glitch (flashbacks, recordings) as accents — at most 3 kinds per film, one accent kind per act, at least 2 s apart. Chapter and act boundaries: dip to black.

## 7. Sound palette

- **Palette:** drones, pulses, heartbeat, clock ticks, typewriter keys, camera shutter, paper, soft impacts and low booms, glitch for recordings, room ambience. No whoosh-heavy design, no comedic sounds.
- **Density:** 2–4 SFX per minute plus drones and ambience, at most one low boom per minute; 85 % of cuts are silent.
- **Music:** drones and pulses in 2.5–5 minute sections, ducked −13 dB under the voice; at least 3 real silences every 5 minutes (0.6–1.5 s); the music drops 0.75–1.5 s before a reveal.

## 8. Native moves

- **The case header:** a typed title card (case name, place, date) with keys.
- **Date / place stamp:** typed at the corner on every time jump.
- **The redacted document:** a court or police document card, redaction bars wipe in, the camera settles on the line that matters.
- **Evidence board:** items pinned and linked as the narrator connects them.
- **The map pin:** where it happened, with distances and times.
- **The verdict:** status-true outcome on a document card, with court and date; a stamp only when the record supports it.
- **The open question:** the last chapter states what is still unknown, over a held image and a drone.

## 9. Pitfalls

- Gore, crime-scene reconstructions, re-enactments of violence, or music that treats suffering as entertainment.
- Naming suspects who were never charged as if guilty; skipping acquittals, appeals or the subject's denial.
- Showing victims' families or private people without approval; any image of a minor.
- Drama editing: whips, slams, punch-ins on every name, flashes on every cut.
- Text in the bottom 12 % (the rail stays above it).
- A tidy resolution the record does not support.

## 10. Engine

- The writer controls script, beat slices, cue tags, visual kinds and queries, motion templates and data, emphasis words and music moods; the director decides frames, transitions and levels from this style's data.
- Disabled here: keyword slams and the letterbox. Stamps are rare (REVEAL) and never bounce.
- Cue triggers: PERSON_INTRO → lower third or freeze label; QUOTE → quote card; TWEET → post card; REVEAL → stamp; NUMBER → counter; TIME_JUMP → date stamp; COMPARISON → split screen; SENSITIVE → censor bar or bleep; DOCUMENT/EMPHASIS → spotlight; LIST → evidence board or kinetic text; MONTAGE → photo burst; CLIP_REF → source label.
- Unimplemented components render a fallback card; deferred transitions are mapped by the director. Nothing crashes on missing pieces.

## 11. Variation space

- **Theme:** accent colour, backdrop (dark noise or paper), texture (film, scanlines for recordings) and headline font through the project theme override.
- **Captions:** the mono rail (default), or SRT only.
- **Structure:** solved cases end on the verdict and its aftermath; unsolved ones end on the open question.
- **Fixed:** sobriety (no gore, no sensational wording), the cut share, keep-outs, silence floors and every safety rule.
