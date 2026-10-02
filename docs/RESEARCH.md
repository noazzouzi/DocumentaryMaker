# DocumentaryMaker: Consolidated Research Brief

**Date:** 2026-10-02. **Audience:** system architect.

**Sources:** 12 research reports: 6 reference repos, Remotion, editing techniques, asset sourcing, TTS/alignment, timeline export and script writing. I also checked the Claude API facts against the bundled `claude-api` skill (cached 2026-09-25).

**Conventions**
- `$SP` = `/tmp/claude-0/-home-user-DocumentaryMaker/9b2bcdc3-66da-5e55-a3e5-b80d3978051f/scratchpad`; `$REFS` = `$SP/refs`.
- Frame counts assume 30 fps unless stated.
- **"Verified"** means it was executed in the research container (4 vCPU with AVX-512, no GPU, Node 22.22, Python 3.11, ffmpeg 6.1.1, egress through a TLS-intercepting proxy).
- **[Conflict]** marks a disagreement between reports. A resolution follows each one.

---

## 1. Executive summary: recommended decisions

1. **Build the timeline first, and have the LLM fill in parameters. The LLM does not write the video.**
   - Every reference repo has the LLM hand-write the scene code (p5/Canvas/GSAP). That approach does not scale:
     - kinetic-reel: 84 s took 1,147 lines.
     - P(doom): 156.6 s took about 6,600–7,800 lines (about 42 lines per second of video), which extrapolates to 40k–75k lines for 15–30 min.
     - lemo-opuscar: 30–60 min of agent time per 30–60 s film.
     - The awesome-opus corpus: 475 pieces, none longer than about 3 min, costing $50–400 and 20 min to 8 h each.
   - **Decision:**
     - Claude emits a zod-validated **Timeline/EDL JSON** that names components, transitions, motions, camera moves and SFX from **closed vocabularies**.
     - A deterministic compiler maps it to Remotion.
     - LLM-written TSX is limited to about 35–50 "hero" motion graphics per episode: a high-effort planner, a medium-effort builder, one high-effort judge pass, with lint and `renderStill` gates and capped retries.
2. **Audio is the clock.**
   - Every cut, caption, highlight, SFX and motion beat references a **script word or segment ID**, not absolute seconds.
   - Replacing the VO (new TTS take, another provider, or the user's own recording) triggers re-alignment and an automatic re-snap of the whole edit.
   - Montage sections additionally snap to a music beat grid.
3. **One timeline drives everything.** This is the cues.js / lemo "single source of truth" pattern. The same Timeline JSON feeds:
   - the Remotion composition
   - the offline audio mixer
   - captions/SRT
   - the FCPXML/xmeml/OTIO/EDL exporters
   - all QA linters
4. **Renderer: Remotion 4.0.532, every `remotion` and `@remotion/*` package pinned to exactly that version.**
   - Run a separate Node render worker; `@remotion/bundler` cannot run inside a Next.js route.
   - Bundle once per code hash.
   - Render in chapter-aligned, content-hash-cached chunks, then `combineChunks`.
   - Use `chromiumOptions.gl: 'swangle'` on CPU and `'angle'`/`'angle-egl'` on GPU.
   - Embed `@remotion/player` in the Next.js app in a `'use client'` component.
5. **The final audio is mixed offline**, by an ffmpeg/numpy sidecar reading the EDL: VO processing, ducking, SFX placed by their peak, two-pass loudnorm, stems.
   - The Player previews using the same per-frame gain table through `volume` callbacks.
   - The final master is muxed once onto the video, as one unbroken track (the motion-graphics repo measured a one-frame drift per AAC segment join).
6. **Python sidecar (uv-managed venv).** It is needed anyway for yt-dlp and holds: yt-dlp, faster-whisper, beats.py, audio_energy.py, cuts.py, sfx_mix.py, track_template.py, and optionally piper-tts (subprocess only, GPL), rembg and librosa.
7. **Voice:**
   - Paid default: ElevenLabs `eleven_multilingual_v2` through `/with-timestamps`, with request stitching.
   - Free default: `sherpa-onnx-node@1.13.8` with Kokoro (EN voices; FR has a single female voice, `ff_siwis`) or Piper voices.
   - User's own voice: faster-whisper large-v3-turbo int8, then Needleman-Wunsch alignment of the script words.
8. **Assets:**
   - One `AssetProvider` interface, a provider registry, a `LicensePolicy` engine and a content-addressed frozen cache.
   - Free by default: Pexels, Pixabay, Openverse, Wikimedia Commons (looked up through the Wikidata QID and P180), IA/Prelinger, NASA, LOC, procedural SFX.
   - Paid only when a key is configured: fal.ai, ElevenLabs, Brave.
   - **yt-dlp runs only on the user's machine**: YouTube blocks datacenter IPs, and this was verified.
9. **Each style plugin has three parts:**
   - a manifest (`style.json` with `uses[]` tags);
   - a prompt pack (`STYLE.md` with 11 fixed sections, plus a GUIDE with rules and common failures);
   - a TS module: components, transition policy, camera policy, caption DNA, SFX palette, budgets, LUT/grade params, and **story shape plus script profile**.
   - Ship **drama-commentary** first.
   - Style suggestion is one cheap Claude call that ranks registered styles from `uses[]` and mood tables.
10. **A deterministic "director" pass** maps the script's cue tags (EMPHASIS, REVEAL, NUMBER…) to effects and SFX under per-style density budgets, cooldowns and no-repeat rules.
11. **Automated QA gates before the expensive render:**
    - EDL lint
    - reading-time check
    - TSX determinism lint
    - contact sheets plus Claude vision review
    - layout audit
    - frame-diff dead-time and pop detection
    - blackdetect
    - ebur128 loudness and true peak
    - ASR round-trip and voice-band SNR
12. **Export from one integer-frame ExportTimeline:**
    - FCPXML 1.10 (Resolve and FCP)
    - xmeml v4, Premiere flavour
    - OTIO
    - Resolve marker EDL
    - SRT per language
    - baked WAV stems
    - ProRes 4444 alpha overlays for anything an NLE can't represent
13. **Editorial safeguards:**
    - a research ledger built only from URLs the API actually returned;
    - claim status, jurisdiction and `as_of` as first-class fields;
    - a lawyer/fact-check pass;
    - a human acknowledgement gate for high-risk claims;
    - **no photorealistic AI images of real people**.
14. **Cost gates:**
    - a sha256 plan-approval gate before any paid generation;
    - request-fingerprint receipts so the same paid call is never made twice;
    - estimated cost shown before TTS, generation or render.
15. **Licensing hygiene:**
    - The Remotion License is free for individuals and organisations of 3 or fewer people.
    - Do not ship GSAP (its licence clause on "visual animation builders").
    - Do not ship p5 (LGPL-2.1). Port the math instead.
    - Copy nothing from PDoomVideo (no licence).
    - Do not ship "Clawd" (Anthropic's mascot).

**Default stack at a glance**

| Concern | Default (free) | Optional (key or paid) |
|---|---|---|
| LLM | `claude-opus-5-5` via `@anthropic-ai/sdk@0.131.0` | Batch API (−50%) for non-interactive reranks |
| Render | Remotion 4.0.532 SSR worker, swangle on CPU | GPU host (`angle`), NVENC (`hardwareAcceleration:'if-possible'`) |
| TTS | sherpa-onnx-node with Kokoro or Piper | ElevenLabs `eleven_multilingual_v2` (v3/v4 opt-in) |
| Word timing | ElevenLabs alignment, Piper phoneme alignment, faster-whisper with NW alignment | ElevenLabs forced alignment (about $0.22/h) |
| Stock | Pexels, Pixabay, Openverse, Commons/Wikidata, IA, NASA, LOC | Brave image search ($5/1k), fal.ai generation |
| YouTube | yt-dlp locally with json3 transcripts, bgutil PO token, `-t sleep` | cookies (opt-in, ban risk) |
| SFX | procedural ffmpeg/numpy pack, `@remotion/sfx` CC0 subset, Openverse/Freesound CC0 | ElevenLabs SFX ($0.002/s via fal) |
| Music | user library, ccMixter CC-BY, Openverse non-NC, Incompetech manual import | ElevenLabs Music, Stable Audio 2.5, local ACE-Step 1.5 |
| Export | FCPXML 1.10, xmeml v4, OTIO, marker EDL, SRT, stems, ProRes 4444 overlays | `.otioz`, xmeml "resolve" flavour |

---

## 2. Lessons from the reference repos

### 2.1 Overview

| Repo (local path) | What it is | License | Verdict |
|---|---|---|---|
| `$REFS/opus-video-skills` (HEAD 59744a6, 2026-09-26) | Claude Code plugin with 2 skills: `painted-animation` (p5.brush) and `kinetic-reel` (Canvas2D, three.js 0.160.0, WebGL post pass). The LLM writes one JS function per shot; puppeteer renders `window.renderAt(t)`. | MIT (portions MIT © John Heibel). p5 is LGPL-2.1. | Borrow the cues.js timeline, transition catalogue, sound rules, motion vocabulary, GLSL and QA loop. |
| `$REFS/awesome-opus5-5-videos` (3d54892) | A dataset of 475 prompts. `data/videos.json` keys: slug, author, category, tech_tags, prompt, prompt_partial… | MIT for the compilation; prompts belong to their creators | Mine the prompt patterns. Do not ship prompts verbatim. `tech_tags` describe Skillry's remakes, not the original stacks. |
| `$REFS/PDoomVideo` | A 156.6 s p5 music video with per-chapter subagents | **No LICENSE** (`"ISC"` in package.json is the npm default). The bundled `pdoom.mp3` is a third-party song. | Ideas only. Copy no code. |
| `$REFS/ClaudeAnimationBase` (CAB) | Starter kit: `ANIMATION_GUIDE.md` (461 lines), `core.js` (a superset of PDoom's), `render.mjs` | MIT © 2026 John Heibel | Port the motion math and the guide structure. |
| `$REFS/lemo-opuscar` (f3c590d) | 43 film "styles", a `core/` toolkit, `AGENTS.md`, `DIRECTOR.md`, `TECHNIQUE.md` | MIT © 2026 LemoLab. Samples are CC0 except Salamander (CC BY 3.0) and MuldjordKit (CC BY 4.0). | Port mux.sh, readcheck, monotone keyframes, the mixer and SFX recipes, the ASR QA, the style package format, slot.mjs and halftone-dossier. |
| `$REFS/motion-graphics-music-video-skill` (deb6efd, v0.2.4) | Song to music video: fal MiniMax H3 characters on chroma green, p5 world, Python analysis, Swift VFX (macOS only), Ruby orchestration | MIT © 2026 makevoid | Copy beats.py, audio_energy.py, cuts.py, sfx_mix.py and track_template.py. Port the p5 helper math, the cue-envelope model, the plan-hash gate and fal receipts. |
| `$REFS/hyperframes` (c3b6e55, npm 0.8.106) | HTML+GSAP composition framework by HeyGen. Includes lint, check, a registry of 413 items, and skills. | Apache-2.0. GSAP uses the "no charge" Standard License. Bundled SFX use the Pixabay Content License. Parakeet is CC-BY-4.0. | Port the doctrine and parameters, the lint/check/seam-gate designs, the registry blocks, the caption rules and the audio helpers. Optional pre-rendered inserts only. |
| `heygen-com/hyperframes-community-skills` (copies in `$SP/hfcs/`) | The `vox-explainer`, `camera-3d-captions` and `p5-paint-animation` skills | Apache-2.0 | Port vox-explainer as a "vox-collage" style. Do not use Vox branding. |

The recurring finding: every repo has the LLM write the animation directly. The patterns worth reusing are the purity contract, the single timeline, the closed vocabularies, the QA loops and the parameter tables, not the per-film code.

### 2.2 Shared determinism contract (all repos)

- **Every frame is a pure function of t.** Frames render in parallel and out of order. Therefore:
  - No state between frames and no counters.
  - No `Math.random()`, `Date.now`, `performance.now` or zero-argument `new Date()`.
  - No physics integrated frame by frame.
  - Use `hash(i)`, `mulberry32` or Remotion `random(seed)` for randomness.
  - Use `boilSeed(key)` (FNV-1a of the key plus the boil frame) so moving elements don't re-jitter static ones. Boil runs at 12 fps (`BOIL=12`).
- **Pitfalls the repos document:**
  - `backOut` overshoot gives negative radii, and the canvas throws.
  - NaN in geometry.
  - `pow(-1e-16, 2.2)` gives NaN and silences the whole audio mix. kinetic-reel's `put()` clamps local time to ≥ 0 for this reason.
  - SVF filter instability near f=1.
  - `preserve-3d` combined with opacity or filter.
  - `will-change` on anything the camera scales.
  - `python http.server` cannot range-seek video.
- **HyperFrames rules** (`skills/hyperframes-core/SKILL.md`, `references/determinism-rules.md`):
  - one paused timeline;
  - `fromTo` only;
  - no `repeat:-1`;
  - no CSS `transition` or `@keyframes`;
  - animate only transforms and opacity, never width/height/top/left;
  - no render-time network;
  - no `getBoundingClientRect` at tween time;
  - local `@font-face`.
- **Map to Remotion:**
  - animate only from `useCurrentFrame()`;
  - an ESLint `no-restricted-properties`/`no-restricted-globals` rule on LLM-generated TSX;
  - a render-twice-and-diff test.

### 2.3 opus-video-skills / kinetic-reel: the most relevant skill

**Workflow** (`skills/kinetic-reel/SKILL.md`):
- **Decide emphasis and time budget first.** The lead chapter gets about 35–40%. v2 of the reel gave Microsoft about 60% and was fixed by *adding* runtime to the other chapters rather than cutting what people liked.
- `STORYBOARD.md` columns: `Time | Chapter/shot | Headline | Visual mechanism | Transition in | Sound`, plus a source of truth and a unifying device.
- **"Facts are sacred."** Only source figures appear on screen, each with its scope. Illustrative content is labelled `SCHEMATIC`.
- **"Every shot has a mechanism."** The headline names it and the visual proves it.
- **Review:** sheets, stills and transition strips cut from the encode: `ffmpeg -ss 16 -t .6 -i out/reel.mp4 -vf "fps=10,scale=320:-1,tile=6x1"`.
- **Audio:** `highpass=f=30,equalizer=f=250:t=q:w=1:g=-2,loudnorm=I=-14:TP=-1.2:LRA=8`, AAC 192k. Audio-only fixes are remuxed with `-c:v copy`. Because Claude can't hear, the audio is checked with `showspectrumpic` and per-section RMS, and the report says so.

**Single timeline shared by picture and sound** (`template/reel/cues.js`): this is the model for our Timeline.
```js
var KCUE = (() => { const B = n => +(n*0.5).toFixed(4);           // 120 BPM: beat .5 s, bar 2 s
  const S = { open:0, title:3, stat:6, flow:9, quote:12, end:14 };  // scene starts
  return { bpm:120, fps:30, dur:17, B, S,
    CH: [['OPEN',0,3],['01 TITLE',3,9],['02 SYSTEM',9,14],['END',14,17]],  // chapters → HUD progress bar
    hits: { dot:1, mark:2, title:3.1, chips:4.5, nodes:[9.1,9.35,9.6], hops:[10,10.5,11,11.5] } }; })();
if (typeof module !== 'undefined') module.exports = KCUE;   // the Node synth require()s the same file
```

**Compositor** (`frame(t)`):
- During a transition, the **outgoing scene is frozen on its last frame** (`s0 - 1/FPS`, with its FX dropped) and the incoming scene plays live.
- A hard cut without a transition gets a one-frame white flash of 0.08.
- Then the post pass runs.

**Transition catalogue** (`TR = { key: [dur, fn] }`, each 0.45–0.6 s, **never three of one kind in a row**):

| Transition | What it does | When to use it |
|---|---|---|
| `trZoom(rect)` | Zooms *through* the UI element the eye is on. Scenes register `RECT.name=[x,y,w,h]`. ioExpo easing, with RGB split at the midpoint. | Inside a chapter (shape continuity) |
| `trIris(cx,cy,ring)` | The next shot grows out of the thing that just lit up, with a stroked ring | Inside a chapter |
| `trPush(dx,dy)` | Push | Same-level topic change |
| `trWipe(col)` | Wipe with an 8 px coloured edge | Continuing a scan already moving across the screen |
| `trSlats(n)` | Slats | Rhythmic reveal on a bar |
| `trGrid(cols,rows,col)` | Diagonal pixel dissolve | — |

Rule: inside a chapter, prefer shape-continuity transitions. Chapter slams use a hard cut plus an impact.

**Motion and type vocabulary** (`template/reel/reel.js`):
- **Math:** `seg`, `ease/easeOut/easeIn/expoOut/backOut/ioExpo/easeInOut`, `hash`, `beatPulse(t,k)=exp(-((t/BEAT)%1)*k)`.
- **Type:** `dropWord` (per-letter fall with stagger), `letters`, `chip`, `stat`, `count` (expo roll), `odometer`, `tape`, `texWindow`, `redacted`, `thread`, `glitchIn`.
- **HUD:** 40 px corner brackets, mono micro-type, timecode, segmented chapter bar at y=1050, content kept above y=950.
- **Layout grid at 1920×1080:** left margin 140, right edge 1780, headline baselines y≈250–470, stats row y≈900, never two stats in the same 300 px band.
- **Palette:** ink `#0E0F0E`, cream `#F1EEE6`, lime `#DDF53D` as the single accent, blue `#2F3CFF` (one slam per reel), red `#E8412F` (danger only). Grounds rotate between shots.
- **Type roles:** Anton for headlines, Archivo Black for slams, Instrument Serif italic for the "voice" line, JetBrains Mono for labels.
- **GL layers:** `terrain`, `liquid` (domain-warped fbm marble, with `strips` as a slice-glitch exit), `knot` (matcap chrome), `cloud` (9k particles; `project(i,t)`).
- **Post shader:** `split`, `slice`, `grain` .05, `vign` .28, `flash`.

**Sound rules** (`references/sound.md`, `music/score.mjs`, an offline Node synth with no dependencies):
- **No noise whooshes on transitions.** v3 had 29 in 84 s: "cool at first, then annoying".
- In-key `swell()` (a reversed pad that stops dead on the cut) into chapters. `bloom` for irises, `glide` for zooms, `harp` for slats, `hatRoll` for wipes.
- Nothing on about half of the cuts.
- Never the same cue twice in a row.
- `impact()` for about 5 structural moments only.
- A serious chapter is half-time and about 5 dB lower in RMS.
- Drop the drums under a glitch exit.
- Tick per letter, blip per chip, `odo` under counters, stab when a number lands.
- **Synth instruments:** kick, clap, hat, tick, bass, pluck, pad, stab, blip, odo, glitch, impact (kick + low-passed noise tail + sub drop), softImpact, riser. Two buses with sidechain ducking, a Freeverb, tanh glue, and a WAV writer.

**Verified performance** (`--soft-gl`, Playwright chromium-1194):
- Contact-sheet frames take 5–118 ms.
- The liquid shader scene: 90 frames in 33 s with 4 workers (about 340 ms per frame effective), so **a 30 min video at 30 fps would take about 5 h on CPU**.
- Google Fonts **failed** in headless Chromium through the proxy (`ERR_CERT_AUTHORITY_INVALID`) and silently fell back to serif.
- `score.mjs` synthesised 18 s in 3.9 s at −14.3 LUFS before loudnorm.

**`render.mjs`** (157 lines, the same in both skills and CAB). Design to copy:

| Flag | Purpose |
|---|---|
| `--sheet=1,4,7 --cols=3 --w=640` | Contact sheet with labelled timestamps |
| `--strip=a:b` | Every frame in a range |
| `--crop=x,y,w,h` | Full-resolution detail |
| `--crop-at=worldX,worldY,w,h` | Crop that follows a world point through the camera |
| `--stills` | Full-resolution PNGs |
| `--clip` | MJPEG pipe into ffmpeg with `drain` backpressure |
| `--frames --workers=4` | Resumable: skips existing files over 1000 bytes; writes `.tmp` then renames |
| `--range=a:b` | Re-render part of the video |
| `--encode --audio=` | Encode with audio |

- **GPU flags:**
  - `--soft-gl` (`--use-angle=swiftshader --enable-unsafe-swiftshader`)
  - `--gpu-angle=vulkan|gl-egl` for headless NVIDIA
  - Platform defaults: Windows `d3d11`, macOS `metal`, Linux `--use-gl=angle --no-sandbox`
- `gpu_probe.mjs` prints which renderer each flag set actually gets.
- **Encode:** `ffmpeg -framerate 24 -i out/frames/f%05d.jpg [-i audio -map 0:v -map 1:a -c:a aac -b:a 192k -shortest] -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart`.

**painted-animation:**
- `ANIMATION_GUIDE.md` rules:
  - Rule 2 "No text" (a sign that repeats the story is the classic failure).
  - **Rule 4 "Timing: model the viewer".** Each shot has timed *reads* (things the viewer must understand), one read at a time; fast actions, held meanings. The demo ending was re-timed from 1.3 s to about 4 s.
  - Rule 6: a transition at every seam.
  - Rule 7: storyboard first; one world, a colour arc, an ending that rhymes with the opening.
- `scripts/beat_grid.py`: spectral-flux onset, autocorrelation tempo over 70–170 BPM, comb phase, LRC beat indices.
- `src/karaoke.js`: per-character fill clipped to sing progress, a two-row hold, and a pun strike-and-pop.
- `examples/xiaozhen/xz_set.js filmFX(t)`: sepia veil, flickering scratches and dust.
- **Long-form lessons** (`references/music-video.md`):
  - Lock the beat grid first.
  - One file per chapter as a private IIFE; shared files are read-only.
  - **Parallel subagents per chapter**, each with a `CHAPTER_BRIEF.md`. The orchestrator builds the first chapter and the shared files, then renders every seam.
  - A few big SFX across the whole video.

### 2.4 ClaudeAnimationBase and PDoomVideo

- **Copy from CAB, never from PDoom.** CAB's `src/core.js` is a strict superset of PDoom's (checked with `diff`). It adds `boilSeed`, `spring/ring/onTwos/arcPt/jump/take/stroll`, `glow`, `through/ribbon` and the `centred()` fix.
- **Motion port snippet** (from `ClaudeAnimationBase/src/core.js`, MIT; keep the attribution):
```ts
const backOut=(x:number)=>{x=clamp(x);const s=1.9;return 1+(s+1)*(x-1)**3+s*(x-1)**2};
const spring=(t:number,t0:number,k=6,w=18)=>t<t0?0:Math.exp(-k*(t-t0))*Math.sin(w*(t-t0));
const pulse=(t:number,bpm:number,off=0,k=6)=>Math.exp(-frac((t-off)*bpm/60)*k);
const shakeXY=(t:number,amt:number)=>{const f=Math.floor(t*24);return[(hash(f*1.7)-.5)*2*amt,(hash(f*2.3+9)-.5)*2*amt]};
```
- Also `kf(t,[[t0,v0],...],ease)` (array values allowed), `ring(t,[events])`, `jump()`, `take()`, `arcPt()`, `onTwos(t)` (12 drawings/s) and `camBegin/camEnd/toScreen`.
- **Guide structure to reuse per style** (`ANIMATION_GUIDE.md`):
  - Opening: "The person prompting you decides **what**… This guide decides **how**… If they ask for something the rules forbid, do what they ask."
  - Three goals; numbered rules; animation principles restated for code ("code moves every part at once, on the same curve", so offset parts and avoid twinning).
  - Workflow, API reference, a **Common failures** checklist and a worked timing example.
  - Effort observation: higher reasoning effort gives more extravagant results.
- **Storyboard template:**
  - `Logline / World (palette, colour arc) / Motif / arc / Shots: A start–end [transition in] what's seen · EVENT · reaction · camera / reads: start–end <understanding> / [transition out]`
  - "If a shot's reads don't fit its length, lengthen the shot or cut a read."
  - **Review budget:** at least one sheet per shot, a strip per key motion and transition, a crop per face that carries the story.
- **PDoom parallel production** (ideas only):
  - one chapter file per subagent;
  - "Only edit your own chapter file… If you find a real bug in a shared file, report it";
  - layout contracts ("karaoke covers y 975–1070, keep faces above ~960");
  - a `CAST` registry for cross-chapter characters;
  - `STORYBOARD.md` tables `Time | Lyric | Shot | Out` with a palette per chapter.
- **Cover-cut transitions** (`brushWipe(p)`): the end of shot A paints p 0→0.5 and the start of shot B paints 0.5→1. The cut happens under full cover, so the two scenes never have to be composited together.
  - Related: `iris/irisShape(pts)` (paints outside any star-shaped outline), `flash(k)`, `glow()` (additive), whip `streaks()` (a wash plus 15 paint streaks, easeIn camera X over 0.2–0.3 s), and the old-film c08 effect (sepia, flicker, scratches, dust, rounded gate, film burn through the gate).
- **Legacy cut accent** (PDoom `legacy/flash-version.html`): on every scene start, a 5% punch-in easing out over 0.25 s plus a 45% white flash fading over 0.2 s. This is the YouTube-editor "cut punch". A debug key **T** logs `audio.currentTime` (tap-to-time).
- **`sfx(txt,x,y,size,col,age)`**: comic impact word with a `backOut` pop, wobble `sin(age*20)*0.03*(1-age/life)`, life 0.6–1.4 s and an alpha fade over the last 0.25 s. Pair it with `shakeXY` using `exp(-7a)` decay.
- **Verified performance** (SwiftShader, 1080p):

| Content | Per frame |
|---|---|
| Wash plus ink line | 30–55 ms |
| 12 watercolour `fill` shapes | 20–27 s |
| Demo frames | 22–29 s |

  Watercolour fills cost about 1000× more on CPU. Only enable that look on a GPU, or replace it with SVG/roughjs (seeded and reseeded at 12 fps) plus perfect-freehand.
- **No audio engineering at all** in either repo: BPM and offset constants (`BPM=88, OFF=0.21`, `B(n)=OFF+n*BEAT`) and a heuristic karaoke `singDur=min(b-a-.1, .45+len*.075)`.

### 2.5 awesome-opus5-5-videos: prompt and workflow patterns

**Tool landscape** (mentions across 475 entries):
- **Renderers:** Remotion 62, HyperFrames 27, DIY seek(t) + Playwright + ffmpeg about 15–19.
- **Voice:** ElevenLabs 8, Gemini TTS 3.8, edge-tts, Kokoro via `npx hyperframes tts`.
- **Effort and cost data points:** wustep about 90 messages, 33 takes, about $400; kgonia7 about 3 h and $54; voxyz 5h28m and $90.

**Patterns to adopt**

| ID | Pattern | Source slugs / specifics |
|---|---|---|
| P1 | Structured brief: `<inputs>` / `<direction>` (+**Banned** list) / `<structure>` (beat grid) / `<build>` / `<gotchas>` / `<start>` ("show me the storyboard/beat map before you write any code") | twoclipping-402193/000267/496100, verbove-268381 |
| P2 | Purity: "Springs are closed-form step responses. A value that changes target many times is the sum of one spring per change" | 12 entries; daniel-haida-636937 |
| P3 | Audio is the clock | see below |
| P4 | Master −14 LUFS, −2 dBTP, re-measured after the AAC encode; music ducks under the voice; "CC0 or generated only; log sources" | ik-builds-585923, astrothewizard-618782 |
| P5 | Self-QA before the expensive render | see below |
| P6 | Multi-agent with a bounded judge | see below |
| P7 | Accuracy guardrails; source file with a confidence level per fact; "Real assets only… never recreate a photograph"; flag recreations on frame | howdevelop-733090, alexalbert-274839, vox-explainer |
| P8 | Cost gating: "List the generations + credit cost and wait for my OK"; "Ask before using any TTS or transcription API. State provider, data sent, credential, cost" | koldo2k-778767 |
| P9 | Restraint: "ONE SHOT = ONE IDEA"; object-driven transitions; banned "crossfade, random wipe, spin, glitch, whip-pan every two seconds, zoom-blur spam"; "3 extraordinary visual moments > 10 mediocre" | daniel-haida, aschapmann-724497 |
| P10 | Drama effects vocabulary | see below |
| P11 | Motion blur: 3–6 temporal subframes (ffmpeg `tmix`; twoclipping uses t−, t, t+1/240 s); real video via 30 fps JPEG sequences or all-intra re-encode (`-g 1`) + `seeked` | |
| P12 | One codebase, many cuts: each cut is a different scene list (30/15/6 s × 16:9/9:16); captions measured in the real font and shrunk to the 9:16 safe zone; a full pipeline through YouTube Data API upload | l3d1c-632524, signalz-jp-918002 |

P3 detail:
- "Place each sound effect so its measured **peak**, not its file start, lands on the event" (11 entries).
- TTS from a *pronunciation script*, then Whisper word times: "A replacement VO = a full retime."
- gdgtify-929495: phrase-based cue sheet and "at least one 400 ms moment of absolute stillness".

P5 detail:
- a contact sheet of about 20 stills before any video;
- one frame per beat;
- probe timestamps, then inspecting decoded MP4 frames;
- single-frame pop scan (frame-diff spikes 3× their neighbours);
- evenly spaced timestamps;
- a vision critique about 40×.

P6 detail (stokebuilder-356793, a podcast with 35–50 inserted animations):
- An extra-high-effort agent finds every timestamp where an animation could fill space and hook the viewer.
- A medium-effort agent builds each one; an extra-high-effort agent judges each once.
- Only egregiously bad cues go back. **No blanket redo loops.**
- A shared style bible and component kit come first.
- Talking-head rules: PiP bottom-right; each graphic inside one uncut stretch of audio; "Never invent facts".
- voxyz-ai-345550 variant: 3 rounds, 2 reviewers ranking P0/P1/P2, 1 fixer, backup and rollback.

P10 detail:
- **techhalla-498547:** per-glyph spring (y, opacity, blur) staggered by a 1/16 note at 120 BPM (125 ms); misregistration ±2–4 px on impact frames only; camera punch-in 1.0→1.08; smash-pans on beats; seeded Fisher–Yates letter scramble; mask wipe through the outgoing word.
- **pound75423-464968:** white flash per beat, strongest on the downbeat; tear plus RGB split on the beat; intensity per section intro 40% / verse 70% / chorus 100%.
- **alexwtlf-981005:** shake that settles within 0.5 s.
- **koldo2k-778767:** 2.5D parallax with 3 depth layers and inpainting, `layer scale = camera^Z`; exponential zoom with segment duration ∝ log(zoom); cutouts at 15 fps; green screen `#00B140`.

**vox-explainer** (HyperFrames community, Apache-2.0; copies in `$SP/hfcs/vox-*.md`). This is the most documentary-relevant artefact:
- **Spine:** FAMILIAR 15% → DIG (person + date) 5% → STORY 15% → ARTIFACT 10% → MECHANISM 20% → SECOND WIND 15% → THESIS 10% → CLOSE 10%.
- **Script:** about 150 words per 60 s; a deletion test on every line; banned tells ("Here's the thing").
- **Frame recipes:** evidence stack, zoom-isolation pair, two-panel compare, specimen grid, lower-third, newsprint layering, circle reveal.
- **Technique floor:** at least 1 zoom-isolation, at least 1 inverse zoom-through, at least 2 drive-pasts, at least 1 background-dropped cutout; static cards at most 1/3 of beats; no two consecutive beats share a recipe.
- **Motion:** elements step at 12 fps through `stepEase`; the camera stays smooth.
- **Velocity-matched transitions:** zoom-through exit scale 1→1.2 with blur 0→10 px over 0.2 s `power3.in`, entry 0.75→1 over 0.5 s `expo.out`; continuation cut about 12% of the frame (230 px), `power4` in/out mirrored; one dominant direction kept in a ledger.
- **Text:** highlight sweep (`backgroundSize` 0→100%); caption rail 30 px / weight 600 at y≈980, suppressed when on-screen text already carries the words.
- **Assets:** real only, via the Commons API and LOC IIIF.
- **QC gates:**
  - MAD dead-time sweep: no still run longer than 3 s, two metrics, at ≥640×360;
  - at most 3.0 s between authored events;
  - seam alignment within about 30 px and about 10%.
- **camera-3d-captions:** captions at depth around a talking head, hero words behind the speaker through a matte (`npx hyperframes@0.8.62 remove-background`, about 170 MB), 15 fps posterize with ghost blur.

### 2.6 lemo-opuscar

**Pipeline** (from `TECHNIQUE.md`):
```
timeline (single source of truth)
 ├─► picture: web page with render(t) ─► headless Chrome frame by frame ─► video.mp4
 ├─► voice: TTS per line ─► speech-to-text check ─► word timings
 ├─► music: score from the same timeline ─► stems
 ├─► sound: procedural foley at event times
 └─► subtitles: .srt + burned-in captions
mix (duck, compress, balance) ─► mux, two-pass loudnorm −14 LUFS ─► film.mp4
```
- **Agent workflow:** one round of brief questions, then never again. Then:
  1. `TREATMENT.md`: 3 candidate structures, logline, benchmark, shot list with reasons, second-by-second beat sheet, cue map, sound table, subtitle design.
  2. Style frames.
  3. Optional storyboard, then stop for approval.
  4. Produce: voice → ASR check → score → animation → mix → render.
  5. Self-check and deliver: mp4, poster, srt, TREATMENT, CREDITS, `build.sh`.
- **Example build** (`styles/dark-keynote/demo/build.sh`): `dump_timeline.mjs → core/tts/tts.py → asr_check.py → music/score.py → export.mjs → cuecheck.py → mix.py → srt.py → core/render/video.mjs → mux.sh → final_asr.py`. `styles/hologram-hud/demo/build.sh` re-flows the whole film from `content.json` (`CONTENT=content_alt.json NAME=kite`).

**Ports, by file:**

`core/render/mux.sh`:
- two-pass `loudnorm=I=-14:TP=-1.2:LRA=11` with `measured_*` and `linear=true`;
- `apad=whole_dur`;
- detection of truncated or damaged WAV files;
- optional grain `noise=c0s=N:allf=t`;
- `libx264 -preset slow -crf 19`, `aac 256k`, `+faststart`;
- re-measures `ebur128` and warns outside −14±1 LUFS or above −1 dBTP.

`core/render/readcheck.mjs`:
- each text must stay fully in frame for ≥ `max(1.5, CJK/4.5 + other/15 + 1.5)` s;
- the page exposes `window.TEXTS=(t)=>[{id,text,x0,y0,x1,y1}]`.

`core/render/slot.mjs`:
- machine-wide `RENDER_SLOTS`;
- queues while `MemAvailable < RENDER_MIN_FREE%` (default 30);
- mkdir mutexes and a 15 s heartbeat;
- per-output pid `.lock` (from `video.mjs`).

`core/render/video.mjs`: N Chromium workers piping `page.screenshot({type:'jpeg',quality:95})` into `ffmpeg -f image2pipe -c:v mjpeg -i - -c:v libx264 -crf 14`, followed by a lossless concat.

`core/lib.js`:
- `mulberry` seeded RNG;
- easings `ss/eio/eo/ei/back(t,1.8)/spring(t,k=7,z=.35)`, `seg`;
- **`monotone(keys)` / `track(keys)`**: Fritsch–Carlson monotone-cubic multi-key interpolation with no overshoot. This is ideal for camera and Ken Burns paths, which Remotion's `interpolate` does not provide.

**Adaptive camera motion blur** (`styles/whiteboard/demo/film.js` 380–397):
- `sp` = px per frame + `|ln(zoom ratio)|·900`;
- `N = sp>14 ? min(12, ceil(sp*.5/4)) : 1` sub-frames over half a frame (180° shutter), accumulated with `globalAlpha=1/(i+1)`;
- captions are drawn after the blur;
- hologram-hud uses 5 sub-frames, only inside 0.5 s whips.

**WebGL2 looks:**
- `core/post/crt.js` (VHS/CRT);
- `styles/backrooms/demo/vhs.js` + `osd.js` (5×7 REC/date OSD);
- `styles/silent-film/demo/engine/film.js` (FilmPost) and `redraw.js` (XDoG photo→ink, posterised wash, hatching);
- `core/three/post.js` (DoF/GTAO/bloom).

**Voice:**
- `core/tts/tts.py` (Kokoro): `lines.json=[{id,text,voice,speed,lang}]`, defaults `af_bella`/0.92/`en-us`; 24 kHz output trimmed at 2% of peak (30 ms pad before, 80 ms after); espeak path limit < 160 bytes.
- `core/tts/tts_zh.py` (edge-tts): cache key `sha1([voice,rate,pitch,say])`, `.part` then rename, 3 retries, and a **`say` field (spoken) kept separate from `text` (displayed)**.
- `core/tts/asr_check.py` (faster-whisper CPU int8): 0.6 s padding; EN must be word-exact after normalising 0–999; CJK must reach difflib ≥ 0.92; an `asr` override field; writes `words.json`.
- `styles/swiss-motion/demo/tools/words.py` aligns subtitle words to Whisper words for kinetic captions.
- `styles/dark-keynote/demo/tools/final_asr.py` re-transcribes the final mp4 per VO window and computes **voice SNR in 300–4000 Hz** by projection.
- `styles/scifi-toon/demo/asr.py`: the same round-trip pattern.

**Mix** (`styles/dark-keynote/demo/mix.py`):
- `for e in events: add(fol, sfx[e.type], e.t, gain, pan)`, with `pan=clamp((screenX-960)/1400,-.7,.7)`;
- voice normalised to 0.9 peak, `compress(.3, 3.0)`, gain 0.55, about 10 dB above music by RMS;
- **duck music −8 dB and foley −4 dB from VO start −80 ms to VO end +120 ms**, 120 ms `uniform_filter1d`;
- deliberate digital-zero silences, J-cuts 0.4 s early;
- per-channel limit at 0.95;
- `--stems`.
- **Synth recipes:** `whoosh(d,lo,hi,up)` (log band-pass sweep), `doom()` (55→40 Hz sub-drop + mallet), `glitch()`, `shimmer()`, `grains()`, `crt_off()`.
- `core/audio/sfx.py`: `click, clack, crash, whoosh, creak, thump, step, ding, pop, quindar, rumble, ignite, roar, heartbeat, radio()`, `compress`, look-ahead `limit`, `add(buf,x,at,gain,pan)` with equal-power pan.

**Music:**
- `core/audio/sampler.py`: 97 instruments; `S.render([(t,inst,pitch,dur,vel,pan)])`; `room()`; `credits()`. The documentary palette is in `INSTRUMENTS.md` §6.
- **Jump-cut retimer** (`styles/watercolor/demo/music/{analyze,jump,lag,edit}.py`, `styles/paper-popup/demo/music/jump2.py`):
  1. librosa beats;
  2. beat-synced chroma and MFCC self-similarity;
  3. bar-aligned cut pairs (`(b-a)%4==0`) that land in the target length;
  4. score by the 16-beat diagonal `chroma + 0.5·timbre`;
  5. **0.18 s equal-power crossfade starting 60 ms before the beat**, then write the remapped beat list.
- **Selection rubric** (`styles/paper-lantern/demo/music/MUSIC.md`):
  - loudness arc per 5 s, RMS dBFS, tempo, HPSS percussive ratio;
  - reject Pixabay "Content ID Registered" tracks, AI-generated uploaders, CC BY-NC/SA;
  - prefer Kevin MacLeod and Scott Buckley (CC BY 4.0).

**Style package format** (`styles/_template/`):
- `style.json`: `slug, num, en, cn, category_en, category_cn, film, line, line_cn, uses[], frame_sec, dur`.
- `STYLE.md` with 11 fixed sections:
  1. Essence / not
  2. Materials
  3. Colour logic
  4. Type & subtitles
  5. Motion quality
  6. Camera grammar table
  7. Sound palette
  8. Native moves ("fits content like…")
  9. Pitfalls
  10. Engine
  11. Variation space
- `DEMO.md`, kept separate so the agent doesn't clone the demo.
- `content.json` field tables with type, range ("label ≤ 24 chars, 2–5 callouts") and an overflow fallback.
- `styleboard/build.py` generates `catalog.json`.

**halftone-dossier** (`styles/halftone-dossier/demo/index.html`, about 65 KB, line map in `DEMO.md`). This is the drama/true-crime kit:

| Helper | Parameters |
|---|---|
| `halftone()` | Dot grid, step 20–26 px. Below 14 px it causes moiré after encoding. |
| `chars()`/`charsPop()` | Per-glyph drop of 30–100 px with squash, stagger 0.05–0.08 s |
| `caption()` | Navy pill, offset multiply shadow, keyword in the highlight ink |
| `stampEl/stampAnim` | 2.6×→1× over 0.09 s ease-in; bounce `1+.05·sin(30t)·e^(−9t)`; opacity .93; tilt ±10°; shake and stamp SFX on the same frame |
| Camera shake | Quadratic decay, 5–26 px |
| Flash | **Capped at 0.5**: a full white flash reads as a dropped frame |
| Dot-wipe transition | 80 px grid, 0.44 s |
| SVG filters | `boil` (feTurbulence, reseeded about 10×/s) and `stampInk` |

Native moves: accusation frame, numbered exhibits, stamp verdict, mugshot with height chart and flash, evidence board with string, redaction bars lifting, dot density as emotion.

Other recipes:
- `styles/dataviz/demo/engine.js`: chart camera `w2s/s2w`, axes that grow with the story, pinned annotations, encoding morph.
- `styles/whiteboard/demo/engine/wb.js`: `circle/arrow/underline/hatch`; `Timeline.draw(pen, shapes, t0, {by})` solves the pen speed to finish by a deadline; EMS single-line fonts (OFL).
- `living-screencast`: real UI redrawn in HTML.
- `swiss-motion` §5: every shot starts on a beat; snaps start one note value early; mask slide-ups, never fades.

**DIRECTOR.md rules:**
- hook within 3 s; the ending echoes the opening; one signature move at the peak;
- at least 4 camera moves; one acceleration and one "breath"; don't cut on every beat;
- subtitles held ≥ max(1.8 s, speech+0.6 s); title card ≥ 4 s;
- every visible action has a sound; three sound layers; at least 2 real silences; at least 2 sound transitions (J/L cuts);
- failure checklist: subject too small, colour on the same colour, subtitles over the subject, gags too fast, blank frames in transitions, effects not tracking the subject (use one world→screen function);
- §12 copyright red lines.

### 2.7 motion-graphics-music-video-skill

**`tools/python/beats.py`** (117 lines, numpy only, 16-bit WAV input):
- STFT with `N_FFT=2048`, `HOP=256`;
- log-compressed positive spectral flux (`log1p(100*mag)`) on the full band plus a kick band below 150 Hz, normalised (median, then the 95th percentile);
- **comb search**, not autocorrelation (autocorrelation was about 0.4% off, a beat and a half of drift over 140 s):
  - coarse: 80–180 BPM in 0.25 steps × 48 phases;
  - fine: ±0.3 BPM in 0.02 steps × 128 phases;
- each beat snapped to a peak within about ±40 ms;
- downbeat = the mod-4 phase with the most kick energy;
- onsets: `env ≥ 1.2`, at least 90 ms apart;
- RMS every 0.25 s;
- output: `{duration,fps,bpm,period,phase,beats:[{t,f,n,bar_pos,strength,low}],onsets:[...],loudness:[{t,db}]}`;
- **Verified:** a synthetic 128 BPM track gave 128.0 with the correct downbeat, about 16 ms early, about 1 s per 30 s of audio. It assumes steady 4/4.

Other scripts:
- **`audio_energy.py`**: per-window `rms_db`, `vocal_ratio` (300–3400 Hz) and `silence_tail_s`.
- **`cuts.py`**: mean absolute difference of 96×54 grey thumbnails; a cut needs ≥ 18 and ≥ 3× the median of its ±6 neighbours.
- **`track_template.py`**: FFT NCC at half resolution with 3-frame smoothing, giving per-frame `[x,y,score]`. Fall back to a static label when score < about 0.6.
- **`sfx_mix.py`** (verified on Linux):
  - trims leading silence at −40 dB so the transient lands on `at`;
  - `rate` resampling;
  - measures music loudness in the cue window (HP 150 Hz, floor −30 dB);
  - `rel_db` relative to the music, capped at **−6 dBFS peak and +18 dB gain**;
  - −1 dBFS look-ahead limiter (2.5 ms blocks, 80 ms release);
  - per-cue report.

  CLI: `python sfx_mix.py bed.wav cues.json out.wav --peak-db -6 --max-gain-db 18 --floor-db -30`.

**Timeline discipline:**
- integer frames at 24 fps;
- sections must be contiguous (`Operations#preview` raises "Noncontiguous song sections");
- pictures are joined **without audio** and one unbroken master track is muxed, because **concatenating AAC segments drifted by a frame per join**;
- `cue("word", nth)` **throws** if the word is missing.

**p5 helpers** (`tools/p5/lib/*.js`, about 440 lines). Already ported and bun-tested (5 pass, 23 expects) in `$SP/mgtest/motion.ts`:

| Helper | Defaults / behaviour |
|---|---|
| Eases | `outBack` c1=1.70158, `outExpo`, `outElastic` |
| Timing | `progress/tween/live/envelope/steps/sinceStep` |
| `slap` | 0.22 s, from 1.18, outBack, residual spin 0.08 rad |
| `pop` | 0.16 s, from 0.55, outBack |
| `slam` | 0.12 s, from 1.7, inCubic |
| `shake` | amplitude 14 px × (1−p)², 0.3 s |
| `trace(points,progress)` | Polyline drawn on by arc length, with vertex dots |
| `knockout` | Outline drawn under the fill, plus a misregistered ghost |
| `typedWords(t, parts)` | Min 0.12 s per word |
| `karaoke` | Active window `[s,e+0.15)`, underline grows with outCubic |
| `slipPath` | Torn paper |
| `misregister`, `grain` | Print effects |

Layer order: background → distant graphics → behind-character text → sprite → foreground.

**VFX cue model** (Swift `tools/vfx/Sources/mvfx/{Cues,Effects}.swift`, macOS only, so port the semantics):
- Fields: `{fx, f, dur, pre?, shape?, fade?, amt?, radius?, x?, y?, angle?, color?, hold?, seed?, grain?}`.
- Envelope: `pre` ramps as q²; `hit=(1−t/dur)^curve`; `span` fades in, holds, fades out.

| fx | Defaults |
|---|---|
| punch | curve 2.5; zoom 1+0.06·e; zoom-blur 2·e³; slight RGB |
| zoom | smoothstep to +8%, then a hard reset |
| shake | 14 px |
| whip | cubic slide, motion blur 70 |
| glow | bloom 1.0, radius 18, curve 1.6 |
| flash | +0.85 EV with a coloured veil, curve 2.8 |
| dark | 0.94 black, hold 2 |
| rgb, glitch | glitch has 30% near-clean frames |
| tv, grain | — |

Fixed order: camera → blurs → light → p5 light layer (screen) → lens/signal damage → dark.

Rules:
- start a glow *after* a flash;
- no double grain;
- keep quiet frames;
- a no-cue render must equal a clean re-encode.

**Workflow:**
- `docs/RESEARCH.md` holds sourced facts with a fictionalized flag and a callback structure.
- A fixed quality directive is pasted into every prompt.
- Typography never comes from image models.
- `plan:approve` stores the sha256 of PLAN.md; any edit invalidates it, and the fal client refuses to run without it.
- Waves of jobs: 2 → 3–4 → 4–8 → 6–10, with evidence-based acceptance ("Do not accept just because a model request succeeded").
- **fal client** (`scripts/lib/fal/client.rb`):
  - `POST https://queue.fal.run/{endpoint}` → poll `status_url?logs=1` → `GET response_url`;
  - receipts keyed by sha256(endpoint+input);
  - uploads cached by hash (`https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3`);
  - `NEW_REQUEST=1` is the only way to pay again;
  - re-fetches each endpoint's OpenAPI per project.
- `lib/media/ffmpeg.rb youtube_4k`: lanczos, accurate_rnd, `in_color_matrix=bt601:out_color_matrix=bt709`, h264_metadata bsf, closed 12-frame GOP, faststart.

### 2.8 HyperFrames (HeyGen)

**Composition model:**
- an HTML root with `data-composition-id/width/height/duration`;
- each timed child: `class="clip" data-start data-duration data-track-index`;
- one paused GSAP timeline at `window.__timelines[id]`;
- typed `data-composition-variables`, overridden with `render --variables`.

**Engine:** BeginFrame capture; formats mp4, **webm VP9 alpha**, **mov ProRes 4444**, png-seq, gif, hls.
- Programmatic API: `createRenderJob({inputPath, outputPath, width, height, fps, format})` + `executeRenderJob(job,onProgress)` from `@hyperframes/producer`.
- Verified: a 2 s 1080p30 alpha webm rendered in 11.3 s.

**Reliability machinery to copy as designs:**
- **Lint** (`packages/lint/src/rules/*.ts`, about 116 codes):
  - finding shape `{code, severity, message, line, column, selector, fixHint, snippet}`;
  - examples: `non_deterministic_code`, `gsap_infinite_repeat`, `media_missing_id`, `clip_ends_past_root_duration`, `font_family_without_font_face`;
  - **gotcha:** a lint error disables the later audits, and `check` then reports "0 samples", which looks like a pass.
- **Check** (`packages/cli/src/commands/check.ts`, `utils/checkPipeline.ts`):
  - 9 midpoints plus `--at-transitions`;
  - `layout-audit.browser.js` (2,126 lines): `text_box_overflow, clipped_text, canvas_overflow, canvas_content_at_edge, content_overlap, text_occluded, text_not_painted, container_overflow, escaped_container, connector_detached`;
  - `contrast-audit.browser.js` (459 lines, WCAG);
  - `--json`, `--strict`.
- **`animation-map.mjs`:** flags `degenerate/offscreen/invisible/paced-fast/paced-slow(>2 s)/collision` and dead zones.
- **`seam-gate.mjs`:** exit still moving at the cut, mid-flight entry, direction matches the ledger, speed match, zero overlap, Z-sign of scale velocity.
- **Closed vocabularies plus injectors:**
  - `TRANSITION-REGISTRY.md` and `skills/faceless-explainer/scripts/lib/transitions.json`, with GSAP templates and placeholders `__OLD__ __NEW__ __T__ __DUR__ __DX__`;
  - `transitions.mjs inject/verify`;
  - motion names must resolve to `rules/<id>.md` (45) or `blueprints/<id>.md` (22);
  - `frame-packets.mjs` inlines the cited recipes so "workers never name-guess".
- **Frame-worker contract** (`skills/hyperframes/references/frame-worker-core.md`):
  - writes one file;
  - does not decide duration (taken from real VO timing), narration, audio, transitions or tokens;
  - keeps content in the top 83%;
  - never renders the narration as text;
  - reveals through the back ~50%, timed to the VO;
  - no exits except in the final frame;
  - self-check keyed to lint codes; the orchestrator re-dispatches with findings.
- **SSIM port gate** (`skills/remotion-to-hyperframes/references/eval.md`): mean ≥ 0.95.

**Doctrine and parameters** (`faceless-explainer/references/{motion-language,cut-catalog}.md`, `transitions/overview.md`):
- **Motion doctrine:**
  - `power3`-style long-tail settle by default; no bounce or elastic;
  - no idle breathing loops, no back-half drifts ("No motion beats bad motion");
  - stillness before a climax of 0.3–0.75 s;
  - one dominant seam direction;
  - **2–3 inter-scene transition types per film**;
  - entries ≤ 800 ms; staggers ≤ 500 ms total.
- **Cut catalog:**
  - **Zoom-through:** exit scale 1→1.2, blur 0→10 px (18–20 px full-frame), opacity → 0.15, over 0.2 s `power3.in`; hard cut; entry at scale 0.75 / blur 10 / opacity 0.15 → 1 over 0.5 s `expo.out`.
  - **Inverse:** 1→0.8, incoming starts at 1.25.
  - **Cut-the-curve:** ±230 px, `power4.in`→`power4.out`.
  - **Waterfall:** 0.34 s per-word exit with 0.022 s stagger; entry gaps start at 0.05 s and shrink ×0.84.
- **Transition selection:**

| Energy | Choice |
|---|---|
| Calm | 0.5–0.8 s blur crossfade |
| Medium | 0.3–0.5 s push |
| High | 0.15–0.3 s zoom-through or glitch |

  - Blur by energy: 20–30 / 8–15 / 3–6 px.
  - Presets: snappy 0.2 s, smooth 0.4 s, dramatic 0.5 s, luxe 0.7 s.
  - The opener gets the most distinctive transition and the climax the boldest.
  - No exit animation before a transition.
- **14 GLSL transitions** (`packages/shader-transitions/src/shaders/registry.ts`, uniforms `u_from u_to u_progress u_accent*`): domain-warp, ridged-burn, whip-pan, sdf-iris, ripple-waves, gravitational-lens, cinematic-zoom, chromatic-split, glitch, swirl-vortex, thermal-distortion, flash-through-white, cross-warp-morph, light-leak.
- **Camera:**
  - `registry/components/yt-camera-move`: zoom +0.11 over 1.2 s `power2.inOut`, perspective 1200, edge-defocus pulse (backdrop blur 7 px, radial mask) 45% in / 55% out.
  - `camera-shake`: 9 seek-safe profiles, a closed-form noise sum; numbers from Unity Cinemachine presets (facts only).
  - **Plate punch** (`skills/embedded-captions/scripts/make-theme.cjs` ~L8577–8600; `themes/stomp.json`):
    - zoom `1+punch·e^(−decay·(t−a))`;
    - x `ampX·e^(−k(t−a))·sin(2π·hz·(t−a))`; y uses cos at 1.31×hz;
    - stomp: punch 0.05, decay 9, shake 8/5 px, 12 Hz, window 0.6 s, anchor at hero onset + 0.045 s, grain 7.
  - Ken Burns 1.05→1.2 with xPercent −12 linear, or 1→1.04.
- **Speed ramps** (`packages/core/src/speedRamp.ts`): `sourceTimeAt()` integrates a log-interpolated rate curve.
  - montage `[0,.9][.15,.3][.5,2.5][.85,.3][1,.9]`
  - bullet `[0,3][.4,3][.5,.15][.6,3][1,3]`
  - hero, jump-cut, flash-in, flash-out.
- **Captions** (`skills/embedded-captions/references/caption-grouping.md`):
  - break on a pause ≥ 500 ms, a sentence end, or a comma followed by ≥ 250 ms;
  - max 6 words or 2.5 s; min 2 words / 0.5 s;
  - in = first word − 0.08 s; out = min(next in − 0.05, last end + 0.6);
  - 25 JSON "theme DNA" files (paradigm × layer × hero setpiece × front FX × plate budget);
  - 16 `caption-*` registry styles (kinetic-slam, pill-karaoke, highlight, editorial-emphasis, glitch-rgb…).
- **Registry** (413 items: 171 blocks, 234 components, 8 examples; only 228 have typed variables). Commentary pieces:
  - `x-post`, `reddit-post`, `yt-comment-card`, `news-ticker`;
  - `headline-slam` (3-frame shake);
  - `yt-circle-pointer`, `yt-feather-highlight`, `hw-callout-circle`, `marker-highlight`, `vox-annotate`;
  - `freeze-frame-dressing`, `beat-freeze-cut`, `editorial-flash-overlay`, `camcorder-hud`, `yt-screen-warp`;
  - **`north-korea-locked-down`** (realistic map zoom, scribble circle, label, red wash: exactly the MagnatesMedia look);
  - `world-map/us-map` (D3), `bar-chart-race`, `count-up`, `split-flap-board`, `torn-paper-rip`, `grain-overlay`, `vignette`, `rack-focus`, `whip-pan-cut` (0.55 s `power3.inOut`, 16 px blur cap);
  - `lt-*` lower thirds;
  - avoid 3D blocks whose CREDITS say "origin to be confirmed".
- **Audio:**
  - `skills/media-use/audio/assets/sfx/manifest.json`, Pixabay licence, with placement hints (riser 10.03 s placed at climax − duration; impacts J-cut into the next shot).
  - SFX volume 0.35; BGM 0.12 under voice, 0.9 without.
  - `duck.mjs` / `audio-duck.mjs`: merge gap 0.6 s, duck ×0.25, attack 0.15 s, release 0.4 s.
  - `voice-clean`: HP 80 Hz → −3 dB @ 250 Hz → compressor → +2.5 dB @ 3 kHz → limiter.
  - Carve (`packages/core/src/audioCarve.ts`): dynamic cuts at 400 Hz / 1 kHz / 1.6 kHz on the bed.
  - `transcript-cut.mjs`: removes fillers and silences, 30 ms afade at every splice.
  - Provider readiness: `packages/cli/src/audio/providers.ts` uses a pure `decide()` and an impure `gather()`.
- **Narrative:** `story-spine.md` (outcome-language hook, value claim by beat 2); `narration.md` (2.5 words/s, numbers written as spoken); `visual-styles.md` (8 styles with motion tokens; "Shadow Cut" = exposé); 16 `frame-presets/*/FRAME.md`.
- **GSAP → math:** power1–4 = quad–quint (`Easing.poly(2..5)`), `expo.out` = 1−2^(−10t), `back.out(1.70158)`. GSAP is not needed.

**Embedding HyperFrames in Remotion:**
- **(A) Pre-render alpha webm/mov, then `<OffthreadVideo transparent>`.** Recommended for optional inserts: cache by hash(block, variables, version); it can be its own NLE track. About 5× slower than real time with software GL.
- **(B) Live iframe driven per frame.** Fragile; not for v1.
- **(C) Native ports with an SSIM gate.** Best for anything used often.
- **Run with** `HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_SKIP_SKILLS=1 DO_NOT_TRACK=1` and an isolated `HOME`.

---

## 3. Remotion technical foundation

### 3.1 Versions and packages

- `remotion@4.0.532`, published 2026-10-01. About 3 releases a week. `alpha: 4.1.0-alpha12`. **5.0 is unreleased.**
- **Pin every `remotion`/`@remotion/*` package to exactly the same version.** Mismatches cause runtime errors. Add packages with `npx remotion add <pkg>` and check the versions in CI.

| Group | Packages (all 4.0.532) | License |
|---|---|---|
| Core | `remotion`, `@remotion/bundler`, `@remotion/renderer`, `@remotion/player` | Remotion License |
| Editing | `@remotion/transitions`, `@remotion/media`, `@remotion/effects` | Remotion License (npm shows "UNLICENSED") |
| Audio and captions | `@remotion/sfx` (MIT; individual sounds vary), `@remotion/captions` (MIT), `@remotion/elevenlabs` (MIT), `@remotion/install-whisper-cpp` (Remotion License), `@remotion/openai-whisper`, `@remotion/whisper-webgpu`, `@remotion/media-utils` | mixed |
| Graphics | `@remotion/fonts`, `@remotion/google-fonts`, `@remotion/layout-utils`, `@remotion/paths`, `@remotion/shapes`, `@remotion/noise`, `@remotion/lottie`, `@remotion/motion-blur`, `@remotion/rough-notation`, `@remotion/three`, `@remotion/maptiler`, `@remotion/zod-types`, `@remotion/web-renderer` | mixed (noise/paths/captions/motion-blur/sfx are MIT) |
| Media metadata | `mediabunny@1.61.0` (+ `@mediabunny/server`) | MPL-2.0 |

**Code against the 5.0 conventions now** (`docs/5-0-migration.mdx`):
- `inputProps` required in `selectComposition`/`getCompositions`;
- `bundle()` takes an options object only;
- `gl` defaults to `angle`;
- `colorSpace` defaults to `bt709`;
- `@remotion/google-fonts` needs explicit weights and subsets;
- sequences are premounted automatically;
- `@remotion/light-leaks`, `@remotion/starburst`, `@remotion/media-parser` and `@remotion/webcodecs` are no longer published (use `@remotion/effects` and `mediabunny`);
- contractors count toward the licence headcount, and `licenseKey` is used.

### 3.2 Project layout and SSR flow

**Layout:**
- `packages/video/remotion/{index.ts (registerRoot), Root.tsx, compositions/*}`, shared by the Next.js app (Player) and a separate **render worker**.
- The worker is Express plus a queue, modelled on `remotion-dev/template-render-server`. For the Player page, see `template-next-app-dir-tailwind`: Next.js 16.3.3, React 19.2.3, `'use client'`.
- **Never import `@remotion/bundler` in a Next.js route.** It is Webpack-in-Webpack. If the renderer must be self-hosted in Next, use `serverExternalPackages:['@remotion/renderer']` (not officially supported).
- No unprefixed tsconfig `paths` alias: it can resolve `"remotion"` to your own folder.

**Verified SSR flow:**
```ts
import {bundle} from '@remotion/bundler';
import {ensureBrowser, selectComposition, renderMedia, makeCancelSignal, openBrowser} from '@remotion/renderer';
await ensureBrowser(); // Chrome Headless Shell into node_modules/.remotion/
const serveUrl = await bundle({entryPoint: path.resolve('remotion/index.ts'), enableCaching: true /*, rspack: true, outDir, publicDir */});
const composition = await selectComposition({serveUrl, id: 'Documentary', inputProps, chromiumOptions: {gl: 'swangle'}});
const {cancel, cancelSignal} = makeCancelSignal();
await renderMedia({composition, serveUrl, inputProps, codec: 'h264', outputLocation, cancelSignal,
  onProgress: ({progress, renderedFrames, encodedFrames, stitchStage, renderEstimatedTime}) => {...}});
```

**`bundle()` options:** `entryPoint`, `onProgress`, `webpackOverride`, `rspack` + `rspackOverride`/`bundlerOverride` (4.0.498), `outDir`, `enableCaching`, `publicPath` (default `./` from 4.0.497), `rootDir`, `publicDir`, `onPublicDirCopyProgress`.
- Bundle once per code hash, never once per render.
- `public/` is copied into the bundle, so **footage must not go there**.

**`renderMedia()` options:**
- **Required:** `composition`, `serveUrl`, `codec`.
- **Encoding:** `concurrency` (number, `'50%'` or null), `frameRange`, `everyNthFrame`, `crf`, `x264Preset`, `videoBitrate`, `audioBitrate`, `audioCodec`, `imageFormat` (jpeg is faster), `pixelFormat`, `proResProfile`, `scale`, `muted`, `enforceAudioTrack`, `separateAudioTo`, `forSeamlessAacConcatenation`, `compositionStart`, `hardwareAcceleration` (`'disabled'|'if-possible'|'required'`), `mediaCacheSizeInBytes`, `offthreadVideoCacheSizeInBytes`, `offthreadVideoThreads`.
- **Browser:** `chromiumOptions{gl, ignoreCertificateErrors, enableMultiProcessOnLinux}`, `chromeMode`, `puppeteerInstance` (reuse one `openBrowser()`), `timeoutInMilliseconds`, `cancelSignal`.
- **Callbacks:** `onBrowserLog`, `onStart`, `onArtifact`, `logLevel`.
- **Other:** `metadata`, `colorSpace`, `sampleRate` (4.0.448), `gopSize` (4.0.466), `licenseKey`.
- **Returns** `{buffer, slowestFrames, contentType}`.
- `remotion.config.ts` applies to the CLI only. With SSR, pass `gl` and similar settings on every call.

### 3.3 Data-driven timeline

**`calculateMetadata`:**
- Type: `CalculateMetadataFunction<P>`; receives `{props, defaultProps, abortSignal, compositionId, isRendering}`; returns `{durationInFrames, width, height, fps, props, defaultCodec, defaultOutName, defaultPixelFormat, defaultVideoImageFormat, defaultProResProfile, defaultSampleRate}`.
- **It does not run in `<Player>`.** Write a pure `computeTimeline(edl)` and call it from both places.
- Props must be JSON-serialisable and are serialised into every render tab, so keep the EDL compact: asset IDs and URLs, not inline data.

**Timing primitives:**
- `<Sequence from durationInFrames layout="none"|"absolute-fill" premountFor postmountFor name>` and `<Series>`.
- Timing props directly on `<Video>`/`<Audio>` (`@remotion/media`), `<Img>`, `<CanvasImage>`, `<Solid>` and `<HtmlInCanvas>`: `from`, `trimBefore`, `durationInFrames`, `playbackRate`, `loop`, `premountFor`.
  - Applied in order: from → trimBefore → durationInFrames → playbackRate → loop.
  - A child's frame is `trimBefore + (frame-from)*playbackRate`.
  - `trimAfter` is deprecated.
- **Use `premountFor={fps}`** on every timed item.

**Recommended structure:**
- The engine computes absolute frames.
- One `<TransitionSeries>` per chapter for the A/B-roll.
- Absolutely positioned `<Sequence>` layers for captions, lower thirds, motion graphics, SFX and music.
- `.map()` over EDL data is fine for us, because our app is the editor and Remotion Studio is not.

**Animation APIs:**
- `interpolate(input, inputRange, outputRange, opts)`:
  - multi-keyframe ranges with **one easing per segment** (`easing: Fn | Fn[]`);
  - string, boolean and tuple outputs;
  - `output:'perceptual-scale'` (zoom ramps feel linear);
  - `outputType`, `posterize`;
  - extrapolation `extend|identity|clamp|wrap`.
- `spring({frame,fps,config:{damping,mass,stiffness,overshootClamping},from,to,durationInFrames,delay,reverse})` and `measureSpring()`.
- `Easing`: linear, ease, quad, cubic, poly, sin, circle, exp, elastic, back, bounce, `bezier(x1,y1,x2,y2)`, `spring({...})`, in/out/inOut.
- Style advice: use the CSS `scale`/`translate`/`rotate` properties.
- Add our ported `monotone()/track()` (lemo) for overshoot-free multi-key camera paths.

**Graphics helpers:**
- `@remotion/noise`: `noise2D(seed,x,y)` for shake.
- `@remotion/paths`: `evolvePath`, `interpolatePath`, `getLength`.
- `@remotion/shapes`: `makeStar`, `makeArrow`, `makeCallout`, `makePie`.
- `@remotion/layout-utils`: `fitText`, `measureText`, `fitTextOnNLines`, only after fonts load.
- `@remotion/rough-notation`: `<Highlight> <Circle> <Underline> <StrikeThrough> <CrossedOff> <Box> <Bracket>`, each with a `progress` prop.
- `@remotion/lottie`: behind `delayRender`.

### 3.4 Transitions

**`<TransitionSeries>`** takes `.Sequence`, `.Transition{presentation,timing}` and `.Overlay{durationInFrames, offset}` (Overlay added in 4.0.415).
- **Transitions shorten the timeline** (total = Σ sequences − Σ transitions). **Overlays do not.**
- An Overlay cannot sit next to a Transition.
- Timings: `linearTiming({durationInFrames,easing})` and `springTiming({config,durationInFrames})`, with `.getDurationInFrames({fps})`.
- `useTransitionProgress()` lets a scene react to its own enter or exit.

**Presentations at 4.0.532** (20 subpaths):

| Kind | Presentations | Notes |
|---|---|---|
| CSS (preview everywhere) | `fade`, `slide({direction})`, `wipe`, `flip`, `clock-wipe`, `iris`, `none`, **`push-cut`** | push-cut (4.0.500) is a punch-in plus flash: 11f, cut at 5/11, outgoing 1→1.04, incoming 1.04→1.07, flash `#f5f2ed` at 0.2 for 2f |
| HTML-in-canvas WebGL (from gl-transitions, MIT) | `cross-zoom`, `zoom-blur`, `zoom-in-out`, `dreamy-zoom`, `film-burn`, `linear-blur`, `blur-slide`, `book-flip`, `crosswarp`, `dissolve`, `ripple`, `swap` | **Preview needs Chrome 149+ with `chrome://flags/#canvas-draw-element`.** Render works out of the box; `crossZoom` verified with swangle |

- Custom transitions: `TransitionPresentation{component, props}` (receives `presentationProgress`, `presentationDirection`, `passedProps`, `presentationDurationInFrames`), or `makeHtmlInCanvasPresentation(shader)`.
- `addSound(presentation, src)` adds a whoosh during the entering phase.
- `isHtmlInCanvasSupported()` gates the preview.

**Design note (resolves the kinetic "frozen A / live B" vs `TransitionSeries` overlap issue). Use three transition classes:**
1. **Hard cut**, optionally with an accent Overlay (flash or punch). The default; it keeps word-anchored cut frames exact.
2. **coverCut**: a `TransitionSeries.Overlay` (or our own overlay layer) that covers the cut. The outgoing side paints p 0→0.5 and the incoming side 0.5→1. Used for flash, brush/ink wipe, whip streaks, light leak, film burn, dot wipe and shape iris. No timeline shortening, no dual render.
3. **Overlap**: `TransitionSeries.Transition`, for dissolve, push, zoom-through and shader transitions. The engine must extend the outgoing and incoming clips by d/2 of source handles **so the cut midpoint stays on the anchored frame**, and must account for the shortened total in `computeTimeline`.
- Implement kinetic's "freeze the outgoing scene" behaviour as a presentation that renders the A side through `<Freeze frame={lastFrame}>`.

### 3.5 Effects (`@remotion/effects`, Remotion License)

- More than 70 subpaths, including: `zoom-blur`, `chromatic-aberration`, `light-leak`, `starburst`, `glow`, `vignette`, `scanlines`, `tv-signal-off`, `halftone`, `duotone`, `lut` (4.0.526; works in Chrome, Firefox, Safari, Player and render), `color-correction`, `levels`, `exposure`, `white-balance`, `noise`, `pixelate`, `region-blur`, `translate` (shake), `tear`, `wave`, `mirror`, `corner-pin`, `paper`.
- They go through the `effects={[...]}` prop on `<Video>` (`@remotion/media`), `<CanvasImage>`, `<Solid>` and `<HtmlInCanvas>`.
  - **[Conflict]** The motion-graphics and editing reports also list `<Img>`/`<AnimatedImage>`. **Resolution:** the Remotion report read the `.d.ts` files, so trust its list and use `<CanvasImage>` for stills. Verify `<Img>` support with tsc.
- Custom effects: `createEffect({type,label,backend:'2d'|'webgl2'|'webgpu',calculateKey,setup,apply,cleanup,schema,validateParams})`.
- Effects need WebGL2: `gl:'angle'` with a GPU or `'swangle'` without. Verified: `chromaticAberration()` and `vignette()` on `<Video>` under swangle.
- **Gotcha:** `<Solid>` is not absolutely positioned. An unwrapped full-frame light-leak `<Solid>` was hidden behind the TransitionSeries. Wrap it in `<AbsoluteFill>`.

### 3.6 Media and asset serving

- **`<Video>`/`<Audio>` from `@remotion/media`** (Mediabunny/WebCodecs) are recommended:
  - frame-perfect, partial downloads, fastest, `effects`/`crop*`;
  - **CORS required**;
  - codecs H.264, VP8, VP9, AAC, Opus, MP3, FLAC, Vorbis; **AV1 and H.265 fall back to `<OffthreadVideo>`** (logged as "falling back to <OffthreadVideo>"; use `disallowFallbackToOffthreadVideo` in CI);
  - **`playbackRate` changes pitch.**
- **`<OffthreadVideo>`** (Rust + ffmpeg): no CORS needed, more codecs, pitch preserved, but it downloads the whole file, which risks delayRender timeouts. `<Html5Video>` is not frame-perfect.
- **Assets:**
  - `staticFile()` for `public/`; remote URLs passed directly; no absolute filesystem paths.
  - **For gigabytes of footage, run a local HTTP server with CORS (`Access-Control-Allow-Origin: *`) and Range support.** Verified with a ~20-line Node server in `$SP/rtest/render.mjs`; `serve-handler` also works. Pass base URLs through `inputProps`.
  - Chrome rejected `https://remotion.media/whoosh.wav` behind the proxy and fell back to `<Html5Audio>`. **Localise every asset before rendering.**
- **Transcode every clip to CFR H.264 + AAC MP4 with a short GOP (`-g 30`).** yt-dlp often returns AV1 or VP9.
- Use `mediabunny` `Input.computeDuration()` (`FilePathSource` in Node), not the deprecated `getAudioDurationInSeconds`/`getVideoMetadata`.
- `getSilentParts({source, noiseThresholdInDecibels, minDurationInSeconds})` from `@remotion/renderer` finds silences in recorded voice.

### 3.7 Audio, captions and fonts in Remotion

- **Volume** is linear: a number, or `interpolate` at composition level. A `volume={(mediaFrame)=>...}` callback is relative to the media's own start.
- **No compressor or EQ in Remotion**, so mixing happens offline (§4.6). `toneFrequency` works in SSR only, not in the Player. `loop` + `loopVolumeCurveBehavior`.
- **Captions:**
  - Type: `Caption={text,startMs,endMs,timestampMs,confidence,pageBreakAfter?}`; each word's text starts with a space.
  - `createTikTokStyleCaptions({captions, combineTokensWithinMilliseconds})`, `parseSrt`, `serializeSrt({lines})`, `CaptionsInternals.ensureMaxCharactersPerLine`.
- **Fonts:**
  - **[Conflict]** The Remotion report suggests `@remotion/google-fonts` `loadFont('normal',{weights:['400','800'],subsets:['latin','latin-ext']})`. Three other reports saw Google Fonts fail in headless Chromium through the proxy (`ERR_CERT_AUTHORITY_INVALID`, silent fallback to serif).
  - **Resolution:** self-host. Use `@fontsource/*` (for example `@fontsource/anton@5.3.0`, OFL) or files loaded via `@remotion/fonts` `loadFont({family, url: staticFile(...)})`.
  - Include the glyph coverage needed for French: É À Ç in ALL CAPS, œ/Œ (latin-ext), « », and U+202F narrow no-break space.
  - Await font loading before `measureText`/`fitText`.
  - Never set `ignoreCertificateErrors` or otherwise disable TLS.

### 3.8 Player in Next.js

- Mark the page or component `'use client'`. Render `<Player component|lazyComponent durationInFrames fps compositionWidth compositionHeight inputProps controls acknowledgeRemotionLicense />`.
- `PlayerRef`: `seekTo`, `play`, `pause`, `getCurrentFrame`, and the `frameupdate` event, to sync the script, scene and timeline UI.
- Keep the Player out of components that re-render on every `timeupdate`.
- **`inFrame`/`outFrame`** preview a single scene of a 30-minute timeline.
- **Preview gaps:** shader transitions and HtmlInCanvas effects need a CSS fallback when `!isHtmlInCanvasSupported()`; `toneFrequency` doesn't preview.
- `@remotion/web-renderer` `renderMediaOnWeb` (stable since 4.0.491, WebCodecs, a CSS subset with no `perspective`) is for drafts only.
- `docs/ai/dynamic-compilation.mdx`: `@babel/standalone` + `new Function` with the Remotion APIs injected, for previewing LLM TSX in the browser. Use it for preview only.
- The paid `<Timeline>` component and the Editor Starter are optional.

### 3.9 Long-render strategy

**Measured** (4 vCPU, 720p, 8 shots with Ken Burns and transitions, x264 `veryfast`):

| Setting | Throughput |
|---|---|
| `concurrency=2` | 18.0 frames/s |
| `concurrency=4` | 24.4 frames/s |

- 54,000 frames (30 min at 30 fps) is therefore about **37 min at 720p**, and an estimated **1.5–2 h at 1080p with effects**.
- Shader-heavy scenes under SwiftShader measured about 340 ms per frame (opus-video-skills), which is about 5 h per 30 min.
- **[Not a conflict]** Cost is entirely content-dependent. Budget per scene type, avoid GPU-heavy CSS (blur, shadows, big gradients) on CPU hosts, and pre-render heavy inserts.
- Tune with `npx remotion benchmark`; check `slowestFrames`.

**Chunking** (verified, `docs/distributed-rendering.mdx`):
- every chunk except the last has the same frame count;
- per chunk: `codec:'h264-ts'`, `audioCodec:'aac'`, `forSeamlessAacConcatenation:true`, `enforceAudioTrack:true`, `compositionStart:0`, `separateAudioTo:'chunk-i.aac'`, identical options and `inputProps`;
- then `combineChunks({videoFiles, audioFiles, outputLocation, codec:'h264', fps, framesPerChunk, preferLossless:false, compositionDurationInFrames})`;
- **verified failure:** `pcm-16` with h264 gives "adts muxer supports only codec aac".

**Recommendation:**
- Chapter-aligned, equal-size chunks, cached by a hash of the EDL slice and asset hashes, so only changed chunks are re-rendered.
- Reuse one `openBrowser()` through `puppeteerInstance`.
- Splitting also avoids the known `angle` memory leaks.
- Aggregate `RenderMediaProgress {renderedFrames, encodedFrames, encodedDoneIn, renderedDoneIn, renderEstimatedTime, progress, stitchStage}` across chunks.
- Cancel with `makeCancelSignal`; surface `onBrowserLog` (fallback and CORS warnings).
- **[Conflict]** Remotion's seamless-AAC chunk audio vs the motion-graphics finding that AAC joins drift a frame. **Resolution:**
  - render the master video chunks with `muted:true`, combine the video only (`combineChunks` with no audio, or the ffmpeg concat demuxer `-c copy`; *verify which works*);
  - mux the **offline-mixed master WAV once**, then two-pass loudnorm to AAC;
  - Remotion's `<Audio>` is used only for preview and for the per-stem renders if they are needed.
- **Presets:**
  - **draft:** `scale:0.5`, `x264Preset:'veryfast'`, `imageFormat:'jpeg'`;
  - **master:** 1080p, `crf` about 18; on NVIDIA, `hardwareAcceleration:'if-possible'` (NVENC, 4.0.484+, H.264/H.265 only) with `videoBitrate:'8M'`–`'12M'`.
- **delayRender:** the default timeout is 30 s ("not cleared after 28000ms"). Raise it with `timeoutInMilliseconds` or per tag with `delayRenderTimeoutInMilliseconds`. `mediaCacheSizeInBytes` defaults to 50% of RAM (minimum 500 MB, maximum 20 GB).
- **GL:**
  - **[Conflict]** `'swiftshader'` (opus report) vs `'swangle'` (Remotion report, verified). **Resolution:** use `gl:'swangle'` on CPU hosts and `'angle'`/`'angle-egl'` on GPU hosts. Probe the host once (a gpu_probe equivalent) and store the result.
- **Render slots** (lemo `slot.mjs`): cap concurrent renders, queue while free memory is below a threshold, one pid lock per output path.

### 3.10 Licensing, AI documentation and skills

- **Remotion License:**
  - free for individuals, for-profit organisations of up to 3 people, and non-profits, including commercial use and SaaS;
  - otherwise a Company License: "Creators" $25 per month per seat; "Automators" $0.01 per render with a $100/month minimum;
  - `renderMedia`, `renderMediaOnWeb` and `<Player>` count as automation APIs;
  - 5.0 counts contractors and makes telemetry mandatory for Automators;
  - copying Remotion code to sell a derivative of Remotion is not allowed;
  - add a `licenseKey` config field.
- **Agent skills:**
  - `npx skills add remotion-dev/skills` (or `npx remotion skills add`): `/remotion-best-practices`, `-create`, `-markup` (about 40 rule files), `-studio`, `-render`, `-maps`, `-captions`, `-saas`, `-interactivity`, `-docs`, `-upgrade`, `-multimedia`.
  - Claude Code plugin: `claude plugin marketplace add remotion-dev/claude-code-plugin && claude plugin install remotion@remotion`.
  - The MCP server is deprecated.
  - `https://www.remotion.dev/llms.txt`; append `.md` to any doc URL (or send `Accept: text/markdown`) for raw markdown.
  - Local docs: `$SP/remotion-src/remotion/packages/{docs/docs,skills/skills}`.
- **Verified smoke tests to reuse:**
  - `$SP/rtest/{render.mjs,bench.mjs,fx.mjs,src/Doc.tsx,src/Fx.tsx}`: bundle, selectComposition, chunked renderMedia, combineChunks, the CORS/Range server, a data-driven TransitionSeries with Ken Burns and ducking, effects plus crossZoom under swangle.
  - `$SP/tsc-check/fx.tsx`: transitions, effects, noise, paths, captions, sfx, light-leaks and motion-blur, type-checked with `tsc --strict` and 0 errors.

---

## 4. Editing and sound-design catalog

### 4.1 Global rules (all styles)

- **Hook:**
  - the first shot matches the thumbnail and title within 5 s;
  - context, then stakes, then a curiosity gap, within about 20 s (MagnatesMedia);
  - the hook's average shot length about 40% shorter than the body.
- **Visual change** every 3–5 s in drama. When no new asset is available, change the camera instead. Backgrounds always move slowly (SunnyV2). Static holds only for deliberate tension. No still run longer than 3 s (vox MAD gate).
- **Energy cycles** of 2–4 min; a re-hook around the midpoint; a music change per cycle or act; music drops out 0.5–1 s before a reveal.
- **Motion doctrine:**
  - default ease is a long-tail decelerate (`Easing.bezier(0.16,1,0.3,1)`, roughly expo.out);
  - cut at peak velocity with matched direction and speed;
  - peak blur at the cut: 10 px for text, 16–20 px for the full frame;
  - stillness of 0.3–0.75 s before a climax.
  - **[Conflict]** "No bounce or elastic, the #1 amateur tell" (HF) vs the drama stamp bounce and outBack slap/pop. **Resolution:** overshoot is allowed only in whitelisted *impact components* (Stamp, SlapIn, PopWord, CharPop, ImpactWord) in drama-type styles. It is banned in camera moves, transitions and cinematic/explainer styles. The linter enforces this.
- **Sound fatigue:**
  - about 50% of cuts have no transition SFX;
  - never the same cue (or file) twice in a row; round-robin variants;
  - heavy impacts only for structural moments;
  - at least 2 real silences per act, and the first sound after a silence is a key one;
  - at least 2 J/L cuts per act.
- **Readability:**
  - on-screen text held ≥ `max(1.5, latin/15 + CJK/4.5 + 1.5)` s after its entrance completes;
  - subtitles held ≥ `max(1.8 s, speech + 0.6 s)`;
  - title card ≥ 4 s;
  - speed comes from fewer words per screen, not shorter holds;
  - never render the narration as on-screen text (except captions);
  - one read at a time.
- **Theme the edit to the topic**: transitions, textures, fonts and palette borrow from the subject (SunnyV2).
- **Layout contract per style:**
  - **[Conflict]** Several reports give different zones: captions out of the bottom 12% (YouTube controls, editing report), the vox caption rail at y≈980, HF content in the top 83%, kinetic content above y=950, PDoom karaoke at y 975–1070.
  - **Resolution:** each style declares a `captionBand` and a `keepOut`. Drama kinetic captions sit in a lower-centre band of about y 760–900 (above the bottom 12% ≈ y > 950). A thin subtitle rail at y 960–1000 is allowed only in minimal styles and is disabled when YouTube CC/SRT is used. Every component and hero graphic receives the keep-out zones in its brief, and the layout audit enforces them.

### 4.2 Cue tags (script → director)

The script/beats LLM tags spans with:
`HOOK, EMPHASIS(word), REVEAL, SHOCK, TENSION_BUILD, NUMBER(value), PERSON_INTRO(name), PLACE(name), TIME_JUMP(date), QUOTE(source), DOCUMENT, ARTICLE, TWEET, CLIP_REF(ytId,t0,t1), LIST(items), COMPARISON, IRONY/JOKE, FLASHBACK, CHAPTER, SENSITIVE`.

- Timing comes from word timestamps.
- **Cut 2 frames before the onset of the word that introduces the new idea.**
- Free B-roll cuts snap to music beats within ±3 frames, and only in montage segments. For beats.py, the snap tolerance is about ±120 ms, with downbeats (`bar_pos==0`) for montage cuts.

### 4.3 Technique catalog (30 fps, 1080p)

**A. Camera and frame**

| Technique | Trigger | Parameters | Remotion | SFX |
|---|---|---|---|---|
| Ken Burns | Every still or B-roll held ≥ 2 s | scale 1.00→1.08–1.15 (style-dependent); drift 20–60 px; near-linear `bezier(.33,0,.67,1)`; alternate direction; multi-key paths via monotone cubic | `interpolate`/`track()` on transform; `output:'perceptual-scale'` | none |
| Rack-in photo (Johnny Harris) | New photo or document | over 0→8f: translateY +40→0, scale 1.06→1.0, blur ~12→0 px, long ease-out tail | CSS `filter: blur()` + `interpolate` | old camera/projector click at about −16 dB |
| Punch-in, "zoom cut" | `EMPHASIS`, villain's name, punchline | scale 1.0→1.12–1.25 in 0–3f (0f = zoom cut); hold until the next cut; origin on the face or salient point (MediaPipe box) | `usePunchIn` | short whip whoosh on big ones only, ≤ 1 per 10 s |
| Cut accent pulse | Hard cuts in drama (optional) | +5% decaying over 0.25 s, plus flash ≤ 0.45 over 0.2 s (PDoom legacy) or pushCut flash 0.2 for 2f | Overlay + wrapper transform | none, or a click |
| Impact plate punch | `SHOCK`, hero word, impact SFX | zoom `1+0.05·e^(−9(t−a))`; shake x 8 px / y 5 px at 12 Hz (y cos at 1.31×); window 0.6 s; anchor at onset + 45 ms | `useImpact(anchorFrame,{punch:.05,decay:9,shakeAmpX:8,shakeAmpY:5,shakeHz:12,window:.6})` | impact on frame 0 |
| Beat punch | Strong low-band beat in a montage | +5–6%, 8 frames, `hit` curve 2.5 (mvfx `punch`) | cue envelope | per sound map |
| Camera move punch | Slow emphasis | +0.11 over 1.2 s `power2.inOut`, perspective 1200, edge-defocus pulse 45/55 | port `yt-camera-move` | none |
| Creep push | `TENSION_BUILD` | 1.0→1.06 over 120–240f, linear | `interpolate` | drone or riser |
| Pull-back / inverse zoom | Scale reveal | 1.25→1.0 over 15f, `expo.out`, blur 10→0 | `interpolate` | reverse whoosh into a boom |
| 2.5D parallax | Hero portrait or establishing shot ≥ 3 s | background 1.0→1.06; cut-out 1.0→1.12 moving opposite (−20 / +30 px); soft shadow; dust screen-blended; or 2–3 depth layers with `scale=camera^Z` | rembg cut-out or Depth-Anything-V2-Small layers | low air whoosh at −26 dB |
| Virtual camera over a collage (Moon, SunnyV2) | `LIST`, relationships | 3840×2160 world; 20–30f moves with ease-in-out; 45–90f dwell; items glitch or slide in when named | one transformed world wrapper | deep whoosh per move; pop or click per item |
| Whip pan | `TIME_JUMP`, topic switch | 16–17f total, `power3.inOut`, one frame width of travel, cut at the midpoint, 16 px directional blur | `slide()` + `linearTiming(8–12)` + blur, or a port of `whip-pan-cut` (0.55 s) | whip whoosh peaking on the cut |
| Impact shake | `SHOCK`, headline slam | 8–15f noise with exp decay, 10–25 px, ±0.5–1°, overscan 1.03. Headline slam: 3 frames of ±0.55% width. Stamp shake: quadratic decay 5–26 px | `useImpactShake` with `noise2D` | impact/boom on frame 0 |
| Handheld drift | True crime, archival | stepped at 3 fps, ±1 px (AE `posterizeTime(3); wiggle(22,1)`), scale 1.005, or the `handheld-tele-mild` profile | seeded noise | none |
| Motion blur | Only whips and fast zooms | adaptive: N = min(12, ceil(speed·0.5/4)) when speed > 14 px/frame, 180° shutter; captions excluded | `@remotion/motion-blur` (`CameraMotionBlur`/`Trail`; `HtmlInCanvasMotionBlur samples shutterAngle` 4.0.529) **gated to transition windows** | — |

**B. Transitions.** The hard cut is the default: 80–90% of cuts in drama, 90%+ in true crime.

| Technique | Trigger | Parameters | Remotion | SFX |
|---|---|---|---|---|
| Push-cut + flash | Montage on beats | 11f, cut at 5/11, 1→1.04 / 1.04→1.07, flash 0.2 for 2f | `pushCut()` | none, or a click |
| Flash frame | `REVEAL`, photo taken, flashback entry | 2–4f, screen blend, centred on the cut | `TransitionSeries.Overlay` | camera flash/shutter |
| Glitch / RGB split | Internet, "deleted", lies | 4–8f; channel offset 8–20 px; slice displacement; misregistration ±2–4 px on impact frames | `chromaticAberration()` or 3 offset copies | glitch, 0.3–0.6 s |
| Film burn / light leak | `FLASHBACK`, era change, chapter | 15–30f centred on the cut; add/screen blend; brightest frame on the cut | `lightLeak()` on `<Solid>` inside `<AbsoluteFill>`, or `filmBurn()` (HtmlInCanvas, render-only) | soft reverse swell or projector |
| Zoom-through | Chapter → content | exit 6f: scale 1→1.2, blur 0→10/20 px, `power3.in`; hard cut; entry 15f: 0.75→1.0, `expo.out`, opacity 0.15→1 | custom presentation | upward whoosh |
| Zoom-through-rect (kinetic) | Into the element the eye is on | ioExpo, RGB split at the midpoint; components expose `focusRect` | custom presentation | `glide` |
| Iris from a point | The next topic grows out of a highlight | ring stroke | `iris` + ring overlay | `bloom` |
| Cut-the-curve | Between related cards | 230 px of travel; exit 9–10f `power4.in`, fade done by 30% of travel; entry 9f `power4.out` | custom | about half the time none |
| Match cut on text (Johnny Harris) | Repeated keyword across sources | 6–12 documents with the keyword pinned to frame centre; 8f each, speeding up to 2–3f | `Series` | tick per cut |
| Dip to black | Act break, death | 12–20f out, 6–12f black, 12f in | `fade()` | music stops; silence or a low boom |
| Smash cut | After a riser | 0f cut to silence or a calm shot | hard cut | riser ends 1–2f before its peak |
| Paper rip | Tabloid drama | 10–15f | port `torn-paper-rip` | paper rip |
| Dot wipe | Dossier style | 80 px grid, 0.44 s | coverCut | — |
| Slats / grid dissolve | Rhythmic reveal on a bar | kinetic `trSlats`, `trGrid` | custom | `harp` / ticks |

Transition policy:
- **[Conflict]** HF says 2–3 inter-scene transition types per film; drama lists 5 or more accents; kinetic says vary them, never three alike in a row.
- **Resolution:** per-style `transitionPolicy` with a primary transition (60–70% of non-cut transitions) plus 1–2 accents per act. Drama may total about 5 kinds per film, never 3 alike in a row, and chapter slams are a hard cut plus impact.
- Durations by energy: calm 0.5–0.8 s, medium 0.3–0.5 s, high 0.15–0.3 s (kinetic: 0.45–0.6 s).

**C. Time**
- **Speed ramp:**
  - shape: 100%→30% over 6–10f at the hit, hold 15–30f, then ramp to 200–300%;
  - pre-render with ffmpeg `setpts` plus `atempo` segments so audio stays coherent;
  - or HF `sourceTimeAt()` with `<Freeze frame={sourceFrameAt(frame)}>` around OffthreadVideo (picture only);
  - avoid the O(frame) accumulate-`playbackRate` pattern;
  - presets: montage, hero, bullet, jump-cut, flash-in, flash-out;
  - SFX: a whoosh into the slow section plus a pitched-down boom.
- **Freeze frame + label:**
  - `<Freeze>` on the word onset;
  - over 3f, desaturate and darken 25%, with an optional white-outline cut-out;
  - the name slams in with a spring (damping 14, stiffness 220), held 45–90f;
  - SFX: record scratch (comedy) or shutter + impact (drama).
- **Photo burst:** 5–8f per image, accelerating; the group scales 1.0→1.1; hold the last image about 90f. SFX: a shutter per image, a riser under, an impact on the last.
- **Archival stutter:** posterize time to 12–15 fps.

**D. Text and graphics**
- **Kinetic captions:**
  - HF grouping rules (2–5 words per group; close at 6 words or 2.5 s; in −80 ms; out = min(next −50 ms, last end +600 ms)), within 80 ms of the transcript;
  - per-word pop 1.18→1.0 over 3f (or per-glyph spring y/opacity/blur with a 125 ms stagger);
  - ALL CAPS, 70–90 px, weight 900, 8–10 px black stroke (`knockout` style);
  - keyword colours: yellow `#FFD400` for emphasis, green for money, red for danger;
  - at most one full-screen hero word per beat, ≥ 0.6 s apart;
  - emoji in drama only, at most 1 per 20–30 s;
  - built on `createTikTokStyleCaptions` plus a custom renderer;
  - karaoke variant: done/active/todo colours, the active word heavier, an underline growing with outCubic.

| Technique | Trigger | Parameters | SFX |
|---|---|---|---|
| Keyword slam | One-word verdict | 12–20f on black; 1.6→1.0 in 6f `expo.out`; 3f shake (HF `headline-slam`) | sub boom; vine boom only for jokes |
| Number counter | `NUMBER` | 45–90f `expo.out`; `Intl.NumberFormat(locale)`; font grows with value; background blur 0→3 px; odometer per digit; jitter on change (`sinceStep()==0`) | ticks/odo, then cash or impact on landing |
| Lower third | First mention of a person | 90–120f; 10f mask reveal; name larger than role; port `lt-*` | soft pop |
| Chapter card | `CHAPTER` | 60–120f; mask or typed reveal; letterbox animates in; optional index card with each chapter's role and duration | impact + music change |
| Quote card | `QUOTE` (or a clip not found) | words synced to the VO; B&W speaker photo; highlight sweep (`backgroundSize` 0→100%) | paper, marker |
| Date/place stamp | `TIME_JUMP` | typewriter at 2f per character, monospace | keys |
| Map | `PLACE` | MapLibre (`demotiles`) or d3-geo + world-atlas; camera fly 45–90f; turf `lineSliceAlong` route over 30–60f; pin pop; paper texture; scribble circle + label + red wash (HF `north-korea-locked-down`). Render with `interactive:false, fadeDuration:0`, `jumpTo` per frame, `--gl=angle --concurrency=1` | whoosh + pop |
| Timeline | Chronology | line draws on (`evolvePath`/`trace`); dates pop as spoken; camera tracks | ticks |
| Split screen | `COMPARISON` | divider wipe over 10f | whoosh |
| PiP commentary frame | `CLIP_REF` | clip at 70–80% width, radius 24 px, 0.9→1 over 10f; background = same clip at 1.2 scale, blur 30 px, brightness 0.4; "Source:" label; the clip's own lines in a different caption style; each graphic inside one uncut audio stretch | clip audio ducked under the VO |
| Censor | `SENSITIVE` | black bar or `pixelate` keyed to the subject; bleep = 1 kHz sine at −18 dBFS over exactly the word | — |
| Spotlight / red circle | Detail in a screenshot | dim to 40% outside a feathered ellipse; circle via `evolvePath` over 8–10f (`yt-feather-highlight`, `rough-notation <Circle>`) | marker scribble |
| Tracked label | Person or object in YouTube footage | `track_template.py` [x,y,score]; static fallback when score < 0.6 | — |
| Stamp | Verdict | 2.6×→1× over 0.09 s; bounce `1+.05·sin(30t)·e^(−9t)`; ±10°; opacity .93; shake | stamp thud + paper |

**E. Document mockups**
- **Tweet/X card:** slides up over 12f, counters run; a generic layout without X's logo (port `x-post`). SFX: notification pop.
- **Article zoom-to-sentence:**
  - rack the page in with an 8–12° rotateX tilt;
  - camera moves to the target sentence over 20–30f;
  - the rest dims to 0.4 with a 2 px blur;
  - highlighter sweep over 12–18f synced to the VO.
  - SFX: paper slide + marker.
- **Newspaper headline:** tilts in from the bottom over 15f. The spinning newspaper is for comedy only.
- **Court document:**
  - paper texture with Courier Prime or Special Elite;
  - redaction bars wipe in over 6f;
  - "CONFIDENTIAL" stamp over 4f with shake;
  - SFX: stamp thud + paper.
- **DMs, Reddit, YouTube comments:** 6f bubble pops with a typing indicator (`reddit-post`, `yt-comment-card`, `message-thread-reveal`).

**F. Looks**
- **Procedural `.cube` LUTs** from parameters (HF `luts/index.json`), applied with `lut({content})`:

| Look | Parameters |
|---|---|
| teal-orange | contrast .18; sat .08; vibrance .12; split-tone shadows [−.04,.05,.09], highlights [.1,.04,−.03]; intensity .62 |
| bleach-bypass | contrast .55; sat −.72; whites .18 |
| film-fade | blacks .35; contrast −.28; temp .16 |

- **Vignette:** `vignette({amount:.25–.5, radius:.65–.75, feather:.35–.5})`.
- **Grain:** **in ffmpeg post** (`noise=alls=6:allf=t`, or lemo `noise=c0s=N:allf=t`), not in the page. In-browser grain makes frames incompressible and slow. Use the `noise()` effect only for preview.
- **Letterbox 2.39:1:** 132 px bars, 20f in.
- **Archival/VHS:**
  - blur ~1.5 px then sharpen, scanlines 10%, slight barrel distortion, chromatic aberration 1.5 px, ±2% flicker, 15 fps stepping, speckles at 5% screen blend;
  - or ports of lemo `crt.js`/`vhs.js`+`osd.js`/`film.js`, CAB/xiaozhen `filmFX`, PDoom c08 (ideas only).
- **Moon look:**
  - dark pink→orange gradient with a 150 px grid (2.5 px lines);
  - B&W cut-outs with a soft shadow (~35 px distance, ~60 px blur, 90%);
  - a 5–9% dark overlay.
- **Edge blur:** a 15 px blurred duplicate masked by an inverted radial gradient with a 250 px feather.
- **Photo → drawing:** lemo `redraw.js` (XDoG).

### 4.4 Effect registry design (implementation)

- **Each registry entry has:**
  - `id`, `category`, `triggers: CueType[]`
  - zod `params` and `defaults`
  - `component`
  - `sfx: {cue, offsetMs, gainDb}[]`
  - `budget: {perMin, minGapFrames, noRepeat}`
  - `styleWeights`
  - `previewFallback`
  - `nlePortability: 'native'|'overlay'|'precomp'`
- **Style plugin** = JSON preset (budgets, params, palette, OFL fonts, LUT params, SFX packs, transition weights) plus optional components.
- **The "director" pass is deterministic and seeded.** It maps cue tags to effects while enforcing budgets, cooldowns and the no-repeat rule.
- **The fx cue model** (from mvfx) lives in the EDL:
  - fx cues in integer frames: `{fx,f,dur,pre,shape:'hit'|'span',curve,fade,amt,x,y,seed}`;
  - envelopes `hit=(1−t/dur)^curve` and `pre` = q² ramp;
  - fixed filter order: camera → blur → light → light layer → signal damage → dark.

### 4.5 Sound-design palette and placement

**Palette:**
- **Whooshes:** heavy (big moves close to camera), light (fast/comedic), whip, wind.
- **Risers:** low rumble plus cymbal riser, peak 1–2f before the cut; reverse "suck" ending exactly on the cut.
- **Impacts:** sharp hits, trailer booms, sub-drops.
- **Clicks:** shutter, pen, mouse, one per item in quick sequences.
- **Texture:** marker/line draws, typing (intro only), UI notifications, camera shutter for screenshots, glitch, cash register, gears for counters.
- **Atmosphere:** drones, room tone, nature, crowd.
- **Time:** clock ticks, heartbeat, data blips under counters.
- **Comedic opt-in pack:** record scratch, vine boom, bass drop (licence-flagged).

**Combos:**
- riser → impact (reveal);
- rumble + cymbal riser → smash cut into silence;
- whoosh → impact (a cut that must stand out);
- click + whoosh (funny);
- in-key swell into a chapter (kinetic).

**Placement:**
- The SFX manifest stores `syncPoint`/`peakOffsetMs` per file (whoosh peak, riser end, impact onset), plus duration, LUFS or peak, energy, tags, variants and licence.
- **The peak lands on the event frame.** sfx_mix also trims leading silence at −40 dB.
- SFX are auto-attached to EDL events: transition → whoosh at its start or peak; punch-in → impact; text pop → pop/click; stamp → sub-drop + click; counter → odo ticks; riser at climax − riser duration.
- **[Conflict]** kinetic-reel says "no noise whooshes"; drama wants heavy whooshes. **Resolution:** drama allows whooshes under its budget: 8–15 SFX per minute and 1–3 impacts per minute, with transition SFX on ≤ about 50% of cuts, never the same file twice, round-robin seeds/variants, and heavy whooshes only on big moves. The QA cue-density report checks this.

### 4.6 Mix targets (offline mixer reading the EDL)

| Element | Target |
|---|---|
| Master | **−14 LUFS integrated**; run loudnorm at TP −1.5, then **gate on measured true peak ≤ −1.0 dBTP after the AAC encode**; LRA 11 (8 optional for punchy drama) |
| VO stem | −16 LUFS (short-term −16 to −14); voice about 10 dB above music by RMS |
| Music under VO | −26 to −30 LUFS (12–18 dB below the VO) |
| Music with no VO | −18 to −20 LUFS |
| Whooshes | −24 to −18 dBFS peak |
| Impacts | −12 to −6 dBFS peak |
| SFX relative mode (sfx_mix) | `rel_db` −4 to −8 vs the music+VO window; cue peak ≤ −6 dBFS; gain ≤ +18 dB; −1 dBFS limiter |

- **[Conflict]** True peak: −1.2 (kinetic, lemo) vs −1 (tts, editing) vs −2 dBTP (ik-builds, measured post-AAC). LRA: 8 (kinetic) vs 11 (lemo, tts). **Resolution:** as in the table: target −1.5, gate ≤ −1.0 post-AAC, LRA 11 by default.
- **Ducking:**
  - **[Conflict]** Reports give different values: −8 dB music / −4 dB foley with 120 ms smoothing (lemo); ×0.25 ≈ −12 dB, attack 0.15 s, release 0.4 s, bridge < 0.6 s (HF); bed 0.32 → 0.09, attack 180 ms, release 500 ms (tts `duck.tsx`); 10–15 dB (editing).
  - **Resolution:** default music duck −12 dB and SFX duck −4 dB; window = VO word span −80 ms / +120 ms; attack 150 ms, release 400 ms; gaps < 0.6 s are bridged; the style parameter ranges over 8–15 dB.
  - HF's linear BGM 0.12 / SFX 0.35 apply to un-normalised assets. We normalise stems first and use the LUFS targets.
- **Optional carve:** sidechain only the 250 Hz–4 kHz band of the bed: `acrossover=split=250 4000`, then `sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400:makeup=1` on the mid band, then `amix=normalize=0`, then a final loudnorm. **`alimiter` is not true-peak**: the test hit 0.0 dBFS.
- **Voice chain** (TTS and user voice): `highpass=f=80, afftdn, deesser, acompressor`, EQ −3 dB @ 250 Hz and +2.5 dB @ 3 kHz, `alimiter`, then two-pass loudnorm to −16 LUFS.
- **Structure:**
  - deliberate digital silences before key reveals;
  - J-cuts with the next scene's audio 0.3–0.5 s early;
  - SFX pan from on-screen x: `clamp((x−960)/1400, ±0.7)`;
  - per-channel limit at 0.95;
  - stems written: VO, music, SFX, ambience, clip audio.
- **Preview parity:** the engine builds a per-frame gain table from the VO word spans (`$SP/tts/node/duck.tsx`, type-checked) and passes it as `volume={(f)=>table[f]}` on `@remotion/media` `<Audio>`. The same table drives the offline mixer.
- **Audio QA** (LLMs can't hear, so say in the report that the mix was not listened to):
  - ebur128 with peak=true;
  - per-section RMS (a serious chapter about 5 dB lower);
  - clipping;
  - cue-density report;
  - `final_asr.py` voice-band SNR (300–4000 Hz) per VO line;
  - optional `showspectrumpic`.

### 4.7 Per-style presets

| | Drama / commentary (priority) | Cinematic essay | Explainer / vox-collage | True crime |
|---|---|---|---|---|
| References | MagnatesMedia, SunnyV2, Patrick Cc:, Moon, Internet Anarchist | LEMMiNO, Moon (serious) | Vox, Johnny Harris | Netflix, JCS |
| Average shot length / longest static hold | 2–4 s / 3 s | 4–8 s / 8 s | 3–6 s with constant in-frame animation | 4–10 s / 10 s |
| Ken Burns | 1.0→1.15 | 1.0→1.05 slow | rack-in + 1.0→1.08 | creep 1.0→1.06 + handheld jitter |
| Punch-ins per minute | 6–10 (+ optional cut accent) | 0–2 | 1–3 | 0–1 |
| Transitions | cuts; whip, zoom-through, glitch, flash, paper rip, push-cut | dissolves 15–30f, zoom-through, light leaks, dips to black | cut-the-curve, text match cuts, light leaks, velocity-matched (vox floor quotas) | cuts, dips to black, evidence flashes, VHS glitch |
| Captions | word pop, ALL CAPS, yellow keywords, occasional emoji, slams ≤ 1/min | sparse lower thirds, serif/sans | callouts + highlighter; caption rail | minimal mono or serif; typed date stamps |
| Signature overlays | cut-outs with shadow and glow outline, particles, gradient + grid, 3D-swivel card groups, tweets, PiP clips, stamps, evidence boards | 3D/collage camera, chapter cards, letterbox | maps, paper (multiply 20–40%), annotated documents, 12 fps stepEase elements | police and court documents, redaction, polaroids, censor blur |
| Grade | teal-orange or topic palette; vignette .3; light grain | film-fade/bleach; grain 6–8%; vignette .35 | warm film-fade; paper | desaturated, cool shadows; vignette .45; grain 8–10% |
| SFX per minute / impacts per minute | 8–15 / 1–3 | 2–5 / ≤ 1 | 4–8 (clicks, markers, paper) / ≤ 1 | 2–4 + drones / ≤ 1 low boom |
| Music | changes every 2–4 min, drops before reveals | swelling score, long silences | curious, light | drones, pulses, heartbeat/clock |
| Ease default | expo.out; overshoot only in impact components | power3/expo, no overshoot | stepped elements, smooth camera | linear/creep |
| Story shape (script) | rise-fall, fall-comeback, spiral-twist | essay arc | vox spine (15/5/15/10/20/15/10/10) | investigation, unresolved |

- **All pacing numbers are estimates** built from tutorial transcripts. YouTube blocked downloads, so nothing was measured.
- Calibrate per style on user-supplied reference files (verified on a synthetic clip):
  `ffmpeg -i ref.mp4 -vf "scdet=threshold=10,metadata=print:key=lavfi.scd.time:file=cuts.txt" -an -f null -`
  Store the shot-length distribution in the preset.

### 4.8 Style plugin interface (merged recommendation)

```ts
interface StylePlugin {
  manifest: { id; names: Record<Lang,string>; category; uses: string[]; moods: string[]; exampleChannels: string[]; version };
  promptPack: { styleMd /* 11 sections */; guideMd /* goals, rules, reads-timing, workflow, component API, Common failures, worked example, Banned */; qualityDirective };
  scriptProfile: { storyShapes: ('rise-fall'|'fall-comeback'|'spiral-twist'|'investigation')[]; actShares; charsPerSec: Record<Lang,number>;
    narrationShare; hookMaxS; chapterRangeS:[number,number]; maxGapWithoutDeviceS; sentenceMeanWords:[number,number]; bannedPhrases; devices };
  tokens: { palette; fonts /* self-hosted OFL */; typeRamp; layout: { captionBand; keepOut[]; safeArea } };
  motionTokens: { energy; entryEase; exitEase; durations; overshootAllowedIn: string[] };
  transitionPolicy: { primary; accents; energyTable; moodTable; seamDirection; noRepeatRun: 3; chapterSlam: 'cut+impact' };
  cameraPolicy: { kenBurns; punchInsPerMin; cutAccent?; shakeProfile };
  captionDNA: { paradigm; layer; heroSetpiece; fx; plate: { punch; decay; shakeAmp; shakeHz; window; grain } };
  sfxPolicy: { palette; perMin; impactsPerMin; silentCutShare: 0.5; noRepeat: true };
  musicPolicy; grade: { lut; vignette; grainFfmpeg };
  techniqueFloor; budgets; components: Record<string, React.FC>; transitions: Record<string, TransitionPresentation>;
}
```
- **Style suggestion:** one effort-`low` call over the registry (id, description, best_for topic types, shape, example channels, `uses[]`, plus the mood table from HF `visual-styles.md`). It returns topic type, ranked styles, recommended runtime, 5 titles, 5 thumbnail texts and risk flags.
- **Naming:** no channel logos or names in style IDs shipped to users. Use descriptive names ("drama-commentary", "vox-collage"), not "MagnatesMedia".

---

## 5. Script pipeline

### 5.1 Evidence (TubeLab transcripts, `$SP/tx/`)

| Video | Length | Pace | Hook | Midpoint | Ending |
|---|---|---|---|---|---|
| Patrick Cc: Antonio Brown (ted-b92oUtU) | 29:37 | 197 wpm, 18.3 chars/s | present ruin → peak contrast → 6 escalating teasers → promise (0:00–0:40) | 20:00 false redemption; sponsor 4:00–5:15 after an emotional peak | return to cold open, legal status, verdict, bridge to the next video |
| Moon: Shia LaBeouf (tXrbg6LQ37w) | 26:46 | 200 wpm, 18.0 chars/s | 0:00–2:20 montage → "So what actually happened?" | 20:30 "accountability… Except it wasn't", reveal 21:45 | thesis echoes the title |
| MagnatesMedia: Papa John's (lrmvbn_7Vsk) | 19:19 | 210 wpm | 3 odd specifics, each paid off (5:45, 15:00) | sponsor 8:15–10:00; 17:00 direct-address interrupt | rabbit-hole CTA |
| Sunny V2: Ronaldinho (IN8CN3Dywyc) | 10:51 | — | in medias res | — | open status |
| Gaspard G (FR): Omar (J4869KOzsng) | 24:35 | 183 wpm, 17.3 chars/s | archival TV → 3 questions → "aujourd'hui je vais vous raconter" → sting at 1:00 | 22:30 new DNA | precise legal status, echoes title |

- **Statistics** (Patrick Cc / Moon):
  - mean sentence length 17.0 / 13.5 words; sentences of ≤ 8 words 21% / 31%;
  - pivots 1.1 / 0.8 per minute; rhetorical questions 0.34 / 0.86 per minute; numerals 2.0 / 1.0 per minute;
  - escalation phrases every 58 s (median); longest gap about 4 min (covered by clips);
  - no description chapters in any of them.
- **Pace in characters per second is nearly identical in EN and FR (17.3–19.5 chars/s).** Budget in characters, calibrated per voice.
- **[Conflict]** HF/vox use 2.5 words/s (150 wpm); drama measures 183–210 wpm. **Resolution:** budget by `charsPerSec` per style and voice. 150 wpm is explainer pace.
- **MagnatesMedia's talk** (4KNtxkKzb8Y, about 17:30–25:00):
  - the hook gets straight in or previews the best moments;
  - no subscribe ask at the start;
  - open loops throughout;
  - end-screen rabbit hole;
  - one CTA at a high-engagement moment;
  - music matters.

### 5.2 Retention devices (a `device` enum in the schemas)

1. Rock-bottom cold open (≤ 60 s, no channel intro).
2. Incongruity hook: 3 bizarre specifics, each with a planned payoff.
3. Question triplet (FR investigative).
4. Escalation pivots and BUT/THEREFORE causality (if "and then" fits between two beats, the story is boring).
5. Explicit forward loop ("We still haven't reached his most polarizing stunt").
6. False redemption, then reversal, at about 60–70% of the runtime.
7. Narrator reaction after a clip.
8. Nuance aside for credibility.
9. Specific numbers.
10. Sponsor or mid-roll slot after a cliffhanger, before its payoff.
11. Full-circle ending plus a bridge to the next video.

### 5.3 DRAMA_DOWNFALL profile (`$SP/script-pipeline/budget-and-lint.ts`)

- **Speed:** 16.5 chars/s EN, 16.0 FR (slightly below the measured pace for TTS intelligibility).
- **Narration share:** 0.82.
- **Hook:** ≤ 60 s.
- **Chapters:** 120–270 s each (5–6 for 15 min, about 9 for 30 min).
- **Pacing limit:** ≤ 120 s without a device or a clip.
- **Sentence mean:** 11–18 words.
- **Act shares:** cold open 4%, rise 15%, inciting turn 6%, cracks 24%, false hope 10%, collapse 25%, reckoning 14.5%, outro 1.5%.
- **`planBudget()` (EN):**

| Runtime | Words | Beats |
|---|---|---|
| 15 min | 2,174 | about 231 |
| 20 min | 2,899 | about 307 |
| 30 min | 4,349 | about 461 |

- Formula: `chars = minutes·60·narrationShare·voiceCharsPerSec`.
- Calibrate `charsPerSec` once per TTS voice with a calibration paragraph and store it in the voice profile.

### 5.4 Claude API facts

Checked against the bundled `claude-api` skill on 2026-10-02.

- **Model:** `claude-opus-5-5`.
- **Pricing:** $4 input / $20 output per MTok, cache reads $0.20/MTok. 1M context, 128K output (requires streaming).
- **Batch API:** −50%.
- No Priority Tier.
- **Thinking cannot be disabled.** `{type:"disabled"}` and `budget_tokens` return 400. **The default effort is `medium`**, so set `output_config.effort` explicitly on every call.
- **Forced `tool_choice` (`any`/`tool`) returns 400.** Use structured outputs: `client.messages.parse()` + `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`, or the beta `client.beta.messages.parse` + `betaZodOutputFormat` from `@anthropic-ai/sdk/helpers/beta/zod`. `output_config.format` replaces the deprecated `output_format`.
- **Refusals:** `betas:["server-side-fallback-2026-07-01"]` + `fallbacks:"default"`. Always check `stop_reason` for `refusal` (`stop_details.category`) and `pause_turn`.
- **No assistant prefill.** **Preserved thinking:** the harness must be append-only and never edit earlier turns.
- **Server tools:** `web_search_20260209` / `web_fetch_20260209` (dynamic filtering). Do not also declare `code_execution`. Newer `_20260318` versions add `response_inclusion`.
  - Web search costs $10 per 1k searches; citations are always on; echo `encrypted_content` back unchanged.
  - Web fetch costs only tokens; it fetches only URLs already in the conversation; it does not run JavaScript; it reads PDFs; citations are optional `char_location` with `document_index`.
  - Server-tool errors arrive as HTTP 200 with an error object in `content`.
- **Citations + `output_config.format` returns 400, so research and structuring must be separate calls.**
- **Structured-output schema limits:** ≤ 24 optional params and ≤ 16 union-typed params per request; no `minLength`/`maximum`/`maxItems`; no recursion. The scripts' schemas have 0 optional fields and 0 unions (checked by converting with the SDK).
- **Vision:**
  - high-resolution tier: up to 2576 px on the long edge and up to 4,784 visual tokens per image (skill);
  - the assets report's estimate is ⌈w/28⌉×⌈h/28⌉ (a 768×432 thumbnail ≈ 448 tokens);
  - up to 600 images or 32 MB per request; above 20 images, each ≤ 2000 px;
  - **Claude will not identify people.**
- **Use per-step effort**, and use per-message effort (beta `mid-conversation-output-config-2026-07-01`) if needed without breaking the cache.

### 5.5 Pipeline steps

All steps use `@anthropic-ai/sdk@0.131.0` and zod v4. Code lives in `$SP/script-pipeline/{schemas,prompts,budget-and-lint,research}.ts` and type-checks; `research.ts` was not run because it costs API money.

| Step | Call | Effort | Output |
|---|---|---|---|
| 1a Research dossier | `client.beta.messages.stream` with web_search (≤ 25) + web_fetch (≤ 30, `citations.enabled`, `max_content_tokens:20000`); EN + target language; fetch primary documents (court PDFs); `pause_turn` loop re-sending the content unchanged | high | cited dossier; **the source registry is built in code only from returned `web_search_result.url`/`web_fetch_result.url` that were cited or fetched** |
| 1b FactSheet | `beta.messages.parse` + `betaZodOutputFormat(FactSheet)` | high | sources (type, reliability); people (`is_minor_or_private_victim`); timeline (`status`, `drama_value`); quotes (verbatim, original language, `youtube_search_query`); figures (`as_of`); claims (`status`, `jurisdiction`, `decision_date`, `subject_response`, `sensitivity`); angles; `central_question`; gaps |
| 1c Code checks | — | — | reject items whose `source_ids` are not in the registry; the app fetches pages itself (undici + Readability) and fuzzy-matches quotes; failures are marked unverified and never used as clips |
| 2 Style suggestion | parse | low | topic type, ranked styles plus story shape, runtime, 5 titles, 5 thumbnail texts, risk flags |
| 3 Outline | parse; **budget computed in code first** | high | hook teasers (each with the chapter that pays it off); open-loop ledger (opened/closed in); chapters (`act`, `target_words`, event/claim/quote IDs, `exit_hook`, `ad_break_after`); callback plan; next-video bridge. **The user edits it in the web app.** |
| 4 Chapters (sequential) | cached prefix = system + style guide + EDITORIAL_RULES + fact sheet + outline (`cache_control` on the last stable block); volatile = chapter plan, story-so-far summaries, last lines of the previous chapter verbatim, open loops, word target ±8% | high | `ChapterScript.segments[]` with `type` (narration, clip, sponsor_slot, music_breath), `text`, `quote_id`, `fact_ids`, `device`. Then `lintScript()` → at most 2 revision rounds |
| 5 Beats (parallel per chapter) | parse | medium | one beat = one visual idea (1–2.5 s in the hook, 2–6 s in the body): **exact contiguous narration slice**, purpose/energy, `visual_kind` (real archival > YouTube clip > motion graphic > literal stock), `visual_query` (**English**, for CLIP), `person_ids`, `youtube_quote_to_find`, `motion_template` + `motion_data_json` (string), `on_screen_text`, `emphasis_words`, `camera`, `transition_in`, `sfx[]`, `music_cue`, `music_mood`, `fact_ids`, cue tags |
| 5b `validateBeats()` | code | — | slices reconstruct the narration exactly; duration bounds; no `ai_illustration` with real `person_ids`; motion JSON parses; no 4+ beats in a row on the same visual. **Fallback:** a deterministic clause splitter, with the LLM annotating by index only |
| 6 Fact-check / lawyer | (a) no-tools audit incl. title and thumbnail → `FactCheck` (verdict, risk, problem, minimal rewrite keeping the energy, `needs_more_research`); (b) targeted re-research (web_search `max_uses` about 10); (c) deterministic checks: verbatim quotes, numbers equal the fact sheet, high-sensitivity claims carry status words, attribution and the subject's response; (d) **human acknowledgement of every `high` item** | high | gate before render |
| 7 Storyboard with reads (optional, hero chapters) | parse | high | per scene: start–end, transition in/out, what's seen, event, camera, timed reads. Validator: no overlapping important reads; read ≥ 0.6 s for an image + 0.25 s per caption word; every seam has a transition; every scene has visual change |
| 8 Hero motion graphics | planner (xhigh/high) finds 35–50 cues → builder (medium) per cue with a structured brief → judge (high) once; only egregious failures are rebuilt (cap 2) | as stated | TSX within the whitelisted API, linted, `renderStill` at 3–5 probe frames |
| 9 Visual QA | `renderStill` sheet (first/middle/last of each shot ±0.25 s around transitions, ffmpeg `tile=6x3` or sharp, labelled) → vision with a style checklist → P0/P1/P2 | high | fix list. Budget: one sheet per chapter, one strip per transition type, full review of hero shots |

**Cost and latency (30 min):**
- research about $1–2;
- chapters about $1 (cache reads);
- beats about $2–3;
- fact-check about $0.5;
- **total about $5–10 and 15–25 min**, mostly sequential chapter writing. Stream progress to the UI.
- Multi-language roughly doubles chapters and beats.
- Asset reranking adds about $0.02 per scene (about $2.5 for 120 scenes; −50% with Batch).

### 5.6 Prompt skeletons

Full FR/EN texts are in `prompts.ts`. These skeletons summarise them.

```text
[SYSTEM, cached]  You are the head writer of a {style.name} YouTube documentary channel ({lang}).
  EDITORIAL_RULES(lang, asOf): claim-status wording table; attribution + subject response for allegations;
  opinion signposted and grounded in stated facts; no diagnosing; never identify minors/private persons/
  alleged victims of sexual offences; FR: conditionnel journalistique, « mis en examen » ≠ « condamné », « » + U+202F;
  numbers only from FACT_SHEET with fact_ids; "never invent facts, numbers or quotes".
  STYLE_GUIDE: story shape + act shares, devices + cadence, banned openers/phrases, sentence length, narrator persona.
  FACT_SHEET (json) · OUTLINE (json)                                   ← cache_control here
[USER, research]  Topic: {idea}. Build a dossier for a {minutes}-min documentary. Search in EN and {lang}/local
  language; fetch primary sources (judgments, filings, official statements). For each claim note status,
  jurisdiction, date, the subject's response. List gaps. Cite everything.
[USER, outline]   Budget (computed): {chapters, per-act words, hook ≤60 s}. Produce Outline: teasers each with
  payoff chapter, open-loop ledger, chapters with act/target_words/ids/exit_hook/ad_break_after (first strong
  cliffhanger ≈3–5 min, then every 8–10 min), callbacks, next-video bridge.
[USER, chapter]   Chapter plan {…}; story so far {…}; previous chapter last lines "{…}"; open loops {…};
  target {N} words ±8%. Write segments (narration|clip|sponsor_slot|music_breath) with device + fact_ids;
  clip segments carry the verbatim quote; commentary line after each clip.
[USER, beats]     Split this chapter's narration into beats that are exact contiguous slices… (fields as §5.5);
  visual priority real archival > clip > motion graphic > stock; visual_query in English; no AI image of real persons.
[USER, factcheck] Act as fact-checker + defamation lawyer (UK Defamation Act 2013 s2–s4; FR loi 1881 bonne foi,
  art. 9-1 C. civ.). Audit script + title + thumbnail text against FACT_SHEET. Output FactCheck items with
  minimal rewrites that keep the line's energy.
[HERO BRIEF]      <inputs> scene text, word timings, assets, style tokens, keep-out zones </inputs>
  <direction> look + Banned list </direction> <structure> beats/word cues </structure>
  <build> useCurrentFrame/interpolate/spring only; random(seed); whitelisted imports; no CSS animation,
  no fetch, no Date; duration fixed by VO </build> <gotchas> fonts loaded before measure; premount </gotchas>
  <start> state the micro-storyboard first, then code </start>
[JUDGE]           Score against style bible + checklist (collisions, safe area, legibility at 640 px, empty
  frames on cut, transition starts on something, template/PowerPoint look) → P0/P1/P2; P0 only → rebuild.
```

### 5.7 Multi-language (FR + EN)

- **One outline** with language-neutral IDs.
- **Scripts are written natively per language** (transcreation per segment that keeps segment IDs and devices), never translated line by line.
- **The visual plan is anchored to segment IDs**, so assets are about 90% shared. Beats are re-cut and re-timed per language after TTS.
- **One export timeline per language**: VO length changes the cut.
- **Quotes** keep the original audio with translated burned-in subtitles, labelled as translated.
- **Keep `tts_text` (say) and `display_text` separate**:
  - per-language normalisation of numbers, currency and dates (spell them out for TTS, show digits on screen);
  - a per-project pronunciation lexicon for foreign names ("Depp", "Waldman" read by a FR voice): ElevenLabs PLS alias rules, or inline `/IPA/` on v4.
- **Teleprompter export** by segment ID for the user's own voice; flag script edits made after recording.

### 5.8 Accuracy and defamation safeguards

- **Claim status** is a first-class enum: allegation, denied, charged, convicted (court + year), civil finding, settled without admission, dismissed/acquitted, appeal pending. Each carries jurisdiction, decision date, subject response and `as_of`. Re-run a freshness search before publishing.
- **Legal grounding:**
  - UK repetition rule: attributing or saying "allegedly" is not a defence. Defamation Act 2013 defences: truth (s2), honest opinion (s3), public interest (s4).
  - France, loi du 29 juillet 1881: good faith rests on legitimate aim, no personal animosity, prudence and measure, and a serious investigation. Art. 9-1 Code civil protects the presumption of innocence.
- **Calibration example** (the user's Depp/Heard topic). Present both outcomes side by side with their jurisdictions:
  - **UK:** *Depp v NGN*, Nov 2020. Nicol J found 12 of 14 incidents proven on the civil standard; the Court of Appeal refused permission in March 2021.
  - **US:** Fairfax jury, 1 June 2022. Depp: $10M compensatory + $5M punitive, the punitive reduced to the $350k cap. Heard: $2M on one counterclaim. Settled Dec 2022 ($1M), appeals dropped.
  - The narrator may never say "he abused her" or "she lied" as fact.
- **The linter** flags "En 2016, il a battu sa femme" and accepts "Selon Amber Heard, il l'aurait frappée…, ce que l'acteur a toujours nié" (tested). The Moon transcript has an unattributed criminal characterisation at about 11:50, which is exactly what would be flagged.
- **No photorealistic AI images of real people** (enforced in `validateBeats`). Stylised illustrations are labelled on frame ("ILLUSTRATION"/"RECONSTITUTION"). Surface YouTube's altered/synthetic content disclosure in the export checklist.
- **Inauthentic-content protection** (July 2025 YouTube monetisation rule): require a thesis that the user chooses or edits, commentary after clips, varied story shapes, and the option of the user's own voice.
- **Monetisation markers:** `ad_break_after` exported as timeline markers. Description chapters are off by default for drama.

---

## 6. Asset sourcing

### 6.1 Test results (2026-10-01)

| Test | Result |
|---|---|
| `yt-dlp 2026.08.19` (`pip install "yt-dlp[default,curl-cffi]"`, which brings `yt-dlp-ejs 0.8.0` and `curl_cffi 0.16.3`) `"ytsearch5:…" --flat-playlist --dump-json` | **Works**, 1.4 s. Fields: id, title, duration, channel, channel_is_verified, view_count, thumbnails, url |
| CC-only search: `…/results?search_query=…&sp=EgIwAQ%253D%253D` | Works |
| Subtitles `--skip-download --write-subs --write-auto-subs --sub-format json3` | Worked for the first 2 videos; after about 10 requests in 5 min: **HTTP 429** and "Sign in to confirm you're not a bot" |
| Video download (137+140, `--download-sections`, full) | **HTTP 403 on googlevideo** for every client (default/visionos, tv, android_vr, web_safari, mweb), even with a bgutil 2.0.0 PO token attached (`&pot=`). Cause: the egress IP rotates (`…:c626` vs `ip=…:c6c1`) and googlevideo URLs are IP-bound. **Not verifiable from a datacenter.** |
| `youtubei.js@18.1.0` | Search works (20 results); `getTranscript()` returns **400** |
| Openverse anonymous | Works: 20 req/min burst, 200/day |
| Wikimedia Commons | Works with a descriptive User-Agent; 429 bursts on the shared IP, recovers after about 20 s |
| IA advancedsearch/metadata, NASA, LOC `fo=json`, ccMixter | Work without keys |
| Pexels/Pixabay/Unsplash/Freesound/Jamendo/Flickr without key | 401 / 400 / 401 / 401 / code 5 / code 100 (free keys needed) |
| fal OpenAPI `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>` | Works without a key |
| CLIP (`@huggingface/transformers@4.3.0`, `Xenova/clip-vit-base-patch32` q8) | 149 MB, 5 s load, about 0.5 s for 4 images + 4 texts (about 60 ms per item); top-1 correct 4/4. Needed `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` after an ECONNRESET at postinstall |
| Procedural SFX (ffmpeg 6.1) | 11 sounds in 1.4 s; sweeps checked numerically |

### 6.2 Providers

**Stock (free keys)**
- **Pexels:**
  - `GET https://api.pexels.com/v1/search`, `/v1/videos/search`, `/v1/videos/popular`; header `Authorization: <KEY>`;
  - 200 req/h and 20k/month (`X-Ratelimit-*` on 2xx only);
  - `video_files[]` {quality hd/sd/hls, width, height, fps, link, file_type}; photo `src.{original,large2x,landscape}`;
  - licence: free, no attribution required; **identifiable people may not appear in a bad light**; no trademark use; no resale;
  - the API asks for a Pexels link and credit "when possible";
  - npm `pexels@1.4.0` is stale; use fetch.
- **Pixabay:**
  - `GET https://pixabay.com/api/?key=&q=&image_type=photo&orientation=horizontal&safesearch=true` and `/api/videos/`;
  - 100 req/60 s; **cache responses 24 h**; no hotlinking; no mass downloads;
  - `largeImageURL` is 1280 px (`fullHDURL`/`imageURL` need approval);
  - videos `{large (4K), medium 1080, small 720, tiny 540}`;
  - **no music or SFX API**;
  - licence: no use of recognisable people "in an immoral or illegal way"; no standalone redistribution.
- **Unsplash:**
  - `GET https://api.unsplash.com/search/photos`, `Authorization: Client-ID`; 50 req/h demo, 1000 req/h production;
  - **requires hotlinking plus a `links.download_location` ping**, which conflicts with an offline render cache;
  - optional only (`unsplash-js@8.0.1`).
- **Openverse:**
  - `GET https://api.openverse.org/v1/images/` and `/v1/audio/`;
  - params `q, license (by,by-sa,cc0,pdm,by-nc…), license_type=commercial,modification, source, category, aspect_ratio=wide, size=large, page_size`;
  - returns `license, license_version, creator, foreign_landing_url` and a **ready-made `attribution` string**;
  - registration: `POST /v1/auth_tokens/register/`, then client credentials at `/v1/auth_tokens/token/` (form-encoded), then Bearer;
  - audio sources: jamendo 644k, wikimedia_audio 3.98M, freesound 591k.

**Archives and public figures**
- **Wikimedia Commons:**
```
https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&generator=search
 &gsrsearch=<q> filetype:bitmap&gsrnamespace=6&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1920
 &iiextmetadatafilter=LicenseShortName|UsageTerms|AttributionRequired|Artist|Credit|LicenseUrl|DateTimeOriginal|ImageDescription|Restrictions
```
  - The `Artist` field is HTML; strip the tags.
  - `Restrictions: personality` must be flagged.
  - **Identity-safe lookup:** Wikidata `wbsearchentities` gives the QID, then `srsearch=haswbstatement:P180=Q37175` (Johnny Depp: 60 files with structured "depicts" data). `https://en.wikipedia.org/api/rest_v1/page/summary/<title>` gives the lead image.
  - Limits: 200 req/min with a compliant UA (tool name plus a contact URL or email **from config**), concurrency ≤ 3, honour `Retry-After`.
- **Internet Archive / Prelinger:**
  - search: `https://archive.org/advancedsearch.php?q=collection:prelinger AND mediatype:movies AND (<terms>)&fl[]=identifier&fl[]=title&fl[]=licenseurl&rows=50&output=json`;
  - metadata: `https://archive.org/metadata/<id>`;
  - download: `/download/<id>/<file>` (302 to a node, range-capable);
  - Prelinger is mostly public domain.
- **NASA:** `https://images-api.nasa.gov/search?q=&media_type=image|video`. No key, generally PD, no implied endorsement.
- **LOC:** `https://www.loc.gov/photos/?q=&fo=json`. **20 req/min on the JSON API (1 h block)**, 150/min for images. Rights per item (`rights_advisory`). LOC IIIF.
- **Flickr Commons:** `flickr.photos.search&is_commons=true` (key needed); also reachable through Openverse.
- **ccMixter:** `http://ccmixter.org/api/query?f=json&tags=instrumental&lic=by&limit=N&dataview=files`.

**Web image search** (rights-unknown; tag `UNKNOWN_EDITORIAL` and require explicit opt-in)
- Bing Search API **retired 2025-08-11**. Google Custom Search is **closed to new customers and shuts down 2027-01-01**.
- **Brave:**
  - `GET https://api.search.brave.com/res/v1/images/search?q=&count=(≤200)&safesearch=strict|off&country=&search_lang=`, header `X-Subscription-Token`;
  - $5 per 1k requests with $5 of free monthly credit (the free tier ended Feb 2026, card required);
  - storing results requires a plan with storage rights.
- **Serper.dev:** 2,500 free, then $1.00 → $0.30 per 1k. **SerpAPI:** 250/month free; $75 for 5k.

### 6.3 YouTube

- **Search:** `yt-dlp "ytsearch20:<q>" --flat-playlist -J`. The YouTube Data API v3 is an optional fallback: 10k units/day, `search.list`=100 units, `videos.list`=1. `captions.download` works only for videos you own.
- **Transcripts:**
  1. Call `yt-dlp -J --skip-download <url>` once.
  2. **Choose the track by pattern**: manual subs > `<lang>-orig` / `<lang>-<lang>` ASR > translated. Keys look like `en`, `en-orig`, `en-en`, `en-uYU-mmqFLq8`; plain `en` sometimes offers only HLS vtt.
  3. Fetch:
```
yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs "en-orig,en.*,fr.*" --sub-format "json3/vtt" -t sleep -o "%(id)s.%(ext)s" URL
```
  - json3 shape: `events[]{tStartMs,dDurationMs,segs[]{utf8,tOffsetMs}}`. ASR segments carry word offsets, so clips can be cut on word boundaries.
  - Fallback: `bestaudio`, then local faster-whisper.
  - Claude picks the passage by matching the fact sheet's verbatim `youtube_quote_to_find`. If nothing is found, use a quote_card.
- **Download and cut:**
```
yt-dlp -f "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]" -t mp4 \
  --download-sections "*00:01:10-00:01:25" --force-keyframes-at-cuts -o "%(id)s_%(section_start)s.%(ext)s" URL
```
  - Sections go through ffmpeg over HTTP, so they are more 403-prone. For sources under about 15 min, download the whole video once (cached by ID) and cut locally with ffmpeg.
  - Then transcode to CFR H.264/AAC, `-g 30`.
  - Run `cuts.py` or `scdet` to find shot boundaries before choosing in/out points.
- **2026 bot-check stack:**
  1. a **JS runtime is mandatory** (Deno ≥ 2.3 by default; Node ≥ 22 needs `--js-runtimes node`);
  2. EJS via the `yt-dlp-ejs` extra or the standalone `yt-dlp_linux`;
  3. `curl_cffi` for impersonation;
  4. **bgutil-ytdlp-pot-provider** (pip 2.0.0, GPL-3.0-only, run as a separate process): Docker `docker run -d --init -p 127.0.0.1:4416:4416 brainicism/bgutil-ytdlp-pot-provider`, or script mode `--extractor-args "youtubepot-bgutilscript:server_home=<dir>"` after `npm ci && npx tsc` in `server/`; use `player_client=mweb`;
  5. `-t sleep` (= `--sleep-subtitles 5 --sleep-requests 0.75 --sleep-interval 10 --max-sleep-interval 20`);
  6. optional `--cookies-from-browser` from a throwaway account only.
- **Run locally on the user's machine.** HyperFrames deliberately excludes yt-dlp ("cloud IPs get blocked", `packages/cli/src/media-use/lib/freeze.mjs`).
  - Write a thin in-house `child_process` wrapper with a pinned binary (pip venv or standalone).
  - Parse `--progress-template` and `-J`.
  - Map errors to typed retries: 429, bot-check, 403, unavailable.
  - Add an "update yt-dlp" action (`yt-dlp -U` or pip upgrade).
  - Reference wrappers: `youtube-dl-exec@3.1.15`, `yt-dlp-wrap@2.3.12`, `ytdlp-nodejs@3.4.5`.
  - Degrade gracefully to manual clip import.
- **Log the source URL and timecodes for every clip.** Show a fair-use responsibility notice. FR "droit de citation" is narrower than US fair use, so keep clips short and commented.

### 6.4 Music

- **No API:** Pixabay music, YouTube Audio Library, Free Music Archive.
- **Incompetech** (manual import), attribution: "Music by Kevin MacLeod (incompetech.com) Licensed under CC BY 4.0".
- **Jamendo:**
  - `GET https://api.jamendo.com/v3.0/tracks/?client_id=&search=&fuzzytags=&vocalinstrumental=instrumental&speed=&durationbetween=60_600&include=licenses+musicinfo&audioformat=mp32`;
  - mostly NC: Openverse `source=jamendo&license_type=commercial` returned **0** results;
  - monetised use needs paid Jamendo Licensing.
- **ElevenLabs Music:**
  - `POST https://api.elevenlabs.io/v1/music` with `prompt` or `composition_plan`, `music_length_ms`, `model_id` music_v1/v2/v2_5, `force_instrumental`;
  - "cleared for nearly all commercial uses" (per-plan terms at elevenlabs.io/music-terms);
  - about $0.15/min direct, or `fal-ai/elevenlabs/music` at **$0.60 per output minute**.
  - **[Conflict]** Length 3,000–600,000 ms (API reports) vs "3 s to 5 min" (capabilities page). **Open:** verify. Assume ≤ 5 min per call and splice with the retimer.
- **Stable Audio 2.5:** `fal-ai/stable-audio-25/text-to-audio` (`seconds_total`), $0.20 per generation, ≤ 3 min at 44.1 kHz. Also `fal-ai/minimax-music/v2`.
- **Suno and Udio: no public API. Never integrate them.**
- **Local option:** ACE-Step 1.5 (Apache-2.0, < 4 GB VRAM).
- **Selection and fitting:** lemo rubric plus licence filters (§2.6); librosa loudness arc matched to the script's beats; jump-cut retimer to section lengths; beats.py grid for snapping.

### 6.5 SFX

- **Freesound API v2:**
  - `https://freesound.org/apiv2/search/text/?query=&filter=license:"Creative Commons 0" duration:[0.2 TO 4]&fields=id,name,license,username,duration,previews,tags&token=<KEY>`;
  - a token is enough for `previews.preview-hq-mp3`; originals need OAuth2;
  - limits 60/min and 2,000/day (downloads 30/min, 500/day); exclude BY-NC.
- **Without a key:** Openverse `/v1/audio/?q=cinematic impact&source=freesound&license=cc0&length=shortest` gives CC0 previews (`https://cdn.freesound.org/previews/...-hq.mp3`).
- **ElevenLabs SFX:**
  - `POST /v1/sound-generation` `{text, duration_seconds 0.5–30, prompt_influence, loop, model_id:"eleven_text_to_sound_v2"}`;
  - `fal-ai/elevenlabs/sound-effects/v2` at $0.002/s (≈ $0.12/min, matching direct pricing).
- **`@remotion/sfx`:** 32 constants (`whoosh`, `whip`, `vineBoom`, `recordScratch`, `dramaticBoomer`, `shutterOld`, `shutterModern`, `pageTurn`, `mouseClick`, `ding`…), normalised to −3 dB peak.
  - Freesound/Kenney sounds are CC0.
  - **Meme sounds are "not explicitly released under a free license"**: tag them `unlicensed – user risk`.
  - Download them locally (the remote fetch failed through the proxy).
- **HyperFrames pack:** `$REFS/hyperframes/skills/media-use/audio/assets/sfx/` (whoosh ×3, riser 10.03 s, impact-bass ×2, glitch ×3, typing, key-press, notification, pop, click…), Pixabay licence: use in rendered videos, **no redistribution as a library**. Re-download at setup and record provenance.
  - **[Conflict]** 21 files (HF and editing reports) vs 19 (assets report). **Open:** count at port time.
- **Procedural fallback library** (`$SP/sfx/make_sfx.sh`, 48 kHz stereo):
  - **Whoosh** (asymmetric, peak at P=0.65, L→R): pink noise → time-varying Gaussian band-pass. **In `afftfilt`, `pts` is in samples, so time = `(pts/sr)`.**
    - `G="exp(-pow(b*sr/2048-(300+3200*ENV),2)/(2*pow(250+700*ENV,2)))"`
    - `-af "afftfilt=win_size=2048:overlap=0.75:real='re*$G':imag='im*$G',aeval='val(0)*E|val(0)*E':c=stereo,aeval='val(0)*(1-0.7*t/D)|val(1)*(0.3+0.7*t/D)',aecho=0.8:0.5:35|60:0.22|0.12,loudnorm=I=-16:TP=-1.5"`
    - ENV/E = `if(x<P,(x/P)^2.2,((1-x)/(1-P))^1.3)`
    - Measured centroid 458 → 3091 → 1065 Hz.
  - **Impact:** `aevalsrc='0.9*sin(2*PI*(38*t+(110-38)*0.08*(1-exp(-t/0.08))))*exp(-t/0.45)'` (110→38 Hz) + brown noise `lowpass=2500` × `exp(-t/0.035)` → `amix` → `asoftclip=type=tanh:threshold=0.7,lowshelf=f=60:g=4,aecho=0.8:0.4:60|110:0.3|0.2`.
  - **Riser (4 s):** 3 detuned saws `2*(X-floor(X+0.5))` with chirp phase `110*D*(8^(t/D)-1)/log(8)` × `(t/D)^1.5`, accelerating tremolo, plus white noise through a rising high-pass, then a 30 ms hard stop. Fundamental 117 → about 773 Hz.
  - **Also:** sub-drop (70→28 Hz), pop (900→420 Hz, 70 ms), click (6 ms HP noise), reverse swell (`areverse`), glitch (`acrusher`), ding (1318/2637/3954 Hz), tape-stop (0.8 s).
  - **`loudnorm` can't measure clips under 400 ms** (reports −70 LUFS), so peak-normalise short sounds.
  - Render several seeds and durations per type at install time and write a manifest with `syncPoint`.
  - Also port lemo `sfx.py`/`mix.py` recipes and kinetic `score.mjs` (in-key swell/bloom/glide/impact/riser at exact timeline times).
- Procedural SFX sound synthetic, so layer them with CC0 samples for the drama style's signature hits.

### 6.6 AI generation (paid, key-gated)

- **fal.ai** (one key for image, video, music, SFX, background removal):
  - `POST https://queue.fal.run/{model_id}` with `Authorization: Key $FAL_KEY` → `GET …/requests/{id}/status` (IN_QUEUE/IN_PROGRESS/COMPLETED) → `GET …/requests/{id}`;
  - webhooks via `fal_webhook`; auto-retries up to 10× (`X-Fal-No-Retry` to opt out);
  - `@fal-ai/client@1.10.1` (MIT): `fal.subscribe` or `fal.queue.submit/status/result`;
  - pricing: `GET https://api.fal.ai/v1/models/pricing?endpoint_id=` (key required).

| Model | Endpoint ID | Price |
|---|---|---|
| FLUX.1 schnell | `fal-ai/flux/schnell` | ≈ $0.003/MP |
| FLUX.2 pro | `fal-ai/flux-2-pro` | $0.03 first MP + $0.015 per extra MP |
| Nano Banana 2 | `fal-ai/nano-banana-2` | $0.08 (1K) / $0.12 (2K) / $0.16 (4K) |
| Kling 3.0 Pro i2v | `fal-ai/kling-video/v3/pro/image-to-video` | $0.112/s, $0.168/s with audio, 3–15 s |
| Kling 2.5 turbo | `fal-ai/kling-video/v2.5-turbo/pro/image-to-video` | $0.35 per 5 s |
| Veo 3.1 fast | `fal-ai/veo3.1/fast/image-to-video` | $0.10/s, $0.15/s with audio, 1080p |
| LTX-2 | `fal-ai/ltx-2/image-to-video` | $0.06/s at 1080p |
| Wan 2.2 A14B | `fal-ai/wan/v2.2-a14b/image-to-video` | $0.04–0.08/s |
| Seedance v1 pro | `fal-ai/bytedance/seedance/v1/pro/image-to-video` | ≈ $0.62 per 1080p 5 s |
| Background removal | `fal-ai/bria/background/remove`, `fal-ai/imageutils/rembg` | — |

- **Replicate** (`replicate@1.4.0`, Apache-2.0), a secondary adapter:
  - `POST https://api.replicate.com/v1/models/{owner}/{name}/predictions`, `Authorization: Bearer`, `Prefer: wait[=N]` (sync, default 60 s), `webhook` + `webhook_events_filter`;
  - FLUX schnell $3 per 1k images; FLUX 1.1 pro $0.04; Ideogram v3-quality $0.09; Wan 2.1 $0.09–0.25/s; H100 $0.001525/s.
- **Policy:**
  - fingerprint receipts and OpenAPI input validation per endpoint;
  - never silently swap models;
  - a budget guard and the plan-hash approval gate;
  - 3 min of AI video costs about $20–35;
  - never generate realistic images of real people; text never comes from image models.
- **Local alternatives:**
  - rembg 2.0.85 (MIT; prefer u2net/BiRefNet; **avoid `@imgly/background-removal`, which is AGPL**);
  - Depth-Anything-V2-**Small** via `@huggingface/transformers` 4.3.0 + `onnx-community/depth-anything-v2-small` (Apache-2.0; Base and Large are **CC-BY-NC**);
  - MapLibre GL (BSD-3), turf (MIT), world-atlas/Natural Earth.

### 6.7 Relevance ranking

1. **Retrieve** 20–40 candidates per scene from metadata.
2. **Local CLIP pre-filter** against an **English** `visualQuery` (CLIP B/32 is English-only). Keep 6–8.
3. **Claude rerank** (`claude-opus-5-5`, structured output):
   - thumbnails ≤ 768 px, labelled "Image N:";
   - scores: relevance 0–10, technical quality, watermark or burned-in text, NSFW, a 16:9 safe crop, a Ken Burns focal point;
   - about $0.02 per scene;
   - alternative: a numbered 3×3 contact sheet (`tile=3x3`, about 1.7k tokens);
   - video: a contact sheet of 4–6 keyframes;
   - Batch API for non-interactive runs.
4. **Identity comes only from provenance** (Wikidata/Commons P180, captions, page titles), never from vision.

### 6.8 Provider abstraction

```ts
type Kind='image'|'video'|'music'|'sfx'|'youtube';
interface LicenseInfo{code:'CC0'|'PDM'|'CC-BY'|'CC-BY-SA'|'CC-BY-NC'|'PEXELS'|'PIXABAY'|'UNSPLASH'|'AI-GENERATED'|'YOUTUBE-FAIR-USE'|'UNKNOWN';version?:string;url?:string;
  commercialOk:boolean;derivativesOk:boolean;attributionRequired:boolean;attributionText?:string;restrictions:string[]; /* 'personality','no-bad-light','trademark' */}
interface AssetQuery{kind:Kind;text:string;entityQid?:string;orientation?:'landscape'|'portrait';minWidth?:number;durationSec?:[number,number];policy:LicensePolicy;limit?:number}
interface Candidate{provider:string;id:string;kind:Kind;title:string;tags:string[];previewUrl:string;width?:number;height?:number;durationSec?:number;
  license:LicenseInfo;author?:{name:string;url?:string};sourcePageUrl:string;fetch():Promise<FrozenAsset>;raw:unknown}
interface AssetProvider{id:string;kinds:Kind[];needsKey:boolean;isConfigured():boolean;limits:{perMin?:number;perHour?:number;perDay?:number};costPerCall?:number;
  search(q:AssetQuery,signal:AbortSignal):Promise<Candidate[]>}
interface FrozenAsset{sha256:string;path:string;mime:string;bytes:number;candidate:Candidate;licenseSnapshot:LicenseInfo;fetchedAt:string}
```
- **Registry:**
  - runs providers in parallel with a token bucket per provider (`p-limit@7.3.3`, `p-retry@8.0.1` honouring `Retry-After`);
  - de-duplicates by perceptual hash;
  - **LicensePolicy** (`monetized` excludes NC/ND/UNKNOWN unless the user opts in; flags BY-SA, personality restrictions and Pexels/Pixabay people rules);
  - then ranks.
- **Frozen cache:** content-addressed at `~/.documentarymaker/cache/<sha256>`, with a size cap and an SSRF host policy (HF `freeze.mjs`: 256 MB cap, 10 s header timeout).
- **Per-project ledger** (SQLite or JSON) feeds a credits block for the YouTube description and the export metadata.
- **Respect provider terms in code:** Pixabay's 24 h cache, Unsplash hotlinking, Wikimedia UA and ≤ 3 concurrent requests, LOC's 20/min, Openverse's 200/day.

**Default free stack:**

| Need | Sources |
|---|---|
| B-roll | Pexels and Pixabay videos → IA/Prelinger, NASA |
| Generic photos | Pexels, Pixabay, Openverse |
| People and events | Commons (P180/Wikidata) + Openverse (Flickr CC) + LOC |
| Editorial/news | Brave (optional) |
| YouTube | local yt-dlp + json3 + Claude passage picking |
| SFX | procedural pack + Openverse/Freesound CC0 + `@remotion/sfx` CC0 subset |
| Music | user library + ccMixter CC-BY + Openverse non-NC; optional ElevenLabs/Stable Audio |
| Ranking | local CLIP + Claude rerank |

---

## 7. Voice and alignment

### 7.1 ElevenLabs

**SDK:** `@elevenlabs/elevenlabs-js@2.70.0` (MIT, 2026-09-28). The legacy `elevenlabs` package 1.59.0 must not be used. Nothing was live-tested (no key); the code type-checks in `$SP/tts/node/voice.ts`.

| model_id | chars/request | FR | Stitching | Notes |
|---|---|---|---|---|
| `eleven_multilingual_v2` | 10,000 | yes (29 langs) | yes | API default, stable long-form; `language_code` is ignored |
| `eleven_v3` | 5,000 | yes (70+) | **no** | audio tags `[whispers] [sighs] [sarcastic]`; stability snaps to 0/0.5/1; no SSML `<break>` |
| `eleven_v4` | 10,000 | yes (90+) | yes | **launched 2026-09-28**; audio tags and inline `/IPA/`; positioned around Text-to-Dialogue |
| `eleven_v4_turbo` | ? | yes | n/a | realtime, about 100 ms |
| `eleven_flash_v2_5` | 40,000 | yes (32) | yes | about 75 ms, half price; for drafts |

- `eleven_turbo_v2*` is deprecated. Read capabilities at runtime with `client.models.list()` (`maximumTextLengthPerRequest`, `languages[].languageId`, `tokenCostFactor`, `canUseStyle`).
- **Endpoint:** `POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=…`, in the SDK `client.textToSpeech.convertWithTimestamps(voiceId, body).withRawResponse()`.
- **Request body:**
  - `text`, `model_id`, `language_code`;
  - `voice_settings{stability 0.5, similarity_boost 0.75, style 0, use_speaker_boost true, speed 1.0}`;
  - `pronunciation_dictionary_locators` (max 3), `seed`;
  - `previous_text/next_text`;
  - `previous_request_ids/next_request_ids` (max 3 each; ids under 2 h old; `previous_text` is ignored if ids are sent);
  - `apply_text_normalization` (auto/on/off).
- **Response:** `{audio_base64, alignment{characters[], character_start_times_seconds[], character_end_times_seconds[]}, normalized_alignment}`.
  - **Use `alignment`** (original text, so "2016" stays "2016"). Split on whitespace into words (`charAlignmentToWords()`).
  - Request id: `rawResponse.headers.get("request-id")`. **Pass `ids.slice(-3)`**: the cookbook appends all of them, but the API caps at 3.
  - `enable_logging=false` (zero retention) disables stitching.
- **[Conflict]** `voice_settings.speed`: 0.7–1.2 vs 0.25–4.0. **Resolution:** clamp to 0.7–1.2 per the TTS docs and verify.
- **Formats:** `pcm_44100`/`wav_44100` need the **Pro** tier; `mp3_44100_192` needs Creator. Otherwise use `mp3_44100_128` and decode with ffmpeg; check that MP3 encoder priming (about 25 ms) does not shift alignment. Resample everything to 48 kHz.
- **Prosody:**
  - v2 family: `<break time="1.2s"/>` (max 3 s);
  - v3/v4: punctuation, ellipses or tags; **strip `[tag]` characters from caption words**;
  - pronunciation dictionaries: alias rules work everywhere; phoneme rules only on `eleven_flash_v2`; inline IPA on v4.
- **Other endpoints:**
  - SFX `client.textToSoundEffects.convert` (about $0.12/min);
  - Music `client.music.compose` (about $0.15/min);
  - **Forced alignment** `POST /v1/forced-alignment` via `client.forcedAlignment.create({file,text})`, returning `{characters, words[{text,start,end,loss}], loss}`; 29 languages including FR; about $0.22/h;
  - STT `scribe_v2` via `client.speechToText.convert` (`timestamps_granularity: word|character`); `@remotion/elevenlabs` `elevenLabsTranscriptToCaptions()` handles Scribe output only.
- **Pricing** (volatile):
  - API: about $0.08 per 1K chars for v2/v3/v4, $0.04 for flash; v4 on a 72% promo ($0.022) until Oct 12;
  - plans: Free (10k credits, no commercial licence), Starter $6/30k, Creator about $22/121k, Pro $99/600k, Scale $299/1.8M;
  - FR runs about 6.1 chars/word at about 180 wpm, so **a 25-min FR documentary is about 25–28k chars, about $2 per full take**. Creator covers about 4 takes a month.
- **Defaults:**
  - `eleven_multilingual_v2`, chunked per paragraph (300–1,500 chars), sequential with `previous_request_ids`;
  - stability 0.4–0.5 and style 0–0.2 for narration;
  - v4/v3 opt-in as "expressive"; flash for drafts;
  - cache key = hash(text, voice, model, settings, prev/next ids); re-synthesise only changed segments;
  - show the cost before generating.

### 7.2 Local TTS: what ran

| Engine | FR | EN | Speed | License |
|---|---|---|---|---|
| **`sherpa-onnx-node@1.13.8` + Kokoro `kokoro-multi-lang-v1_0`** | `ff_siwis` (sid 30, `lang:'fr'`) | sid 16 `am_michael`, 3 `af_heart`, 26 `bm_george`… | FR 61.8 s in 12.9 s (RTF 0.21); EN RTF 0.23; load 1 s | Apache-2.0 code and weights; prebuilt for linux-x64/arm64, darwin, win |
| **sherpa-onnx + Piper `vits-piper-fr_FR-siwis-medium`** | yes | yes | 61.9 s in 1.89 s (RTF 0.03) | Apache-2.0 runtime; dataset licence per voice |
| piper-tts 1.8.0 (Python CLI) | yes | yes | 64.5 s in 3.2 s | **GPL-3.0** (OHF-Voice/piper1-gpl; rhasspy/piper archived 2025-10-06). Subprocess only |
| kokoro-js 1.2.1 | **EN only in the public API** | yes | fp32 RTF 0.21; **q8 is 3× slower on CPU** | Apache-2.0 |
| kokoro-onnx 0.6.1 (Python) | `fr-fr` | `en-us` | worked once the espeak path was short | MIT |
| kokoro 0.9.4 (torch) | `lang_code='f'` | `'a'`/`'b'` | not installed | Apache-2.0 |

- **Quality ranking:** ElevenLabs is far ahead of Kokoro, which is ahead of Piper (robotic).
- **FR Kokoro has a single female voice**, `ff_siwis` (grade B−, under 11 h of training data). Male FR comes from Piper (upmc "pierre", tom, gilles).
- ASR round-trip recovered every word for all voices; errors were name misrecognitions only. **Nobody listened to the audio.**
- **sherpa-onnx in Node** (`$SP/tts/node/sherpa_kokoro.js`):
```js
const sherpa=require('sherpa-onnx-node'); const d='kokoro-multi-lang-v1_0';
const tts=new sherpa.OfflineTts({model:{kokoro:{model:`${d}/model.onnx`,voices:`${d}/voices.bin`,tokens:`${d}/tokens.txt`,dataDir:`${d}/espeak-ng-data`,lexicon:'',lang:'fr'},numThreads:4,provider:'cpu'},maxNumSentences:1});
const a=tts.generate({text,sid:30,speed:1.0}); sherpa.writeWave('vo.wav',{samples:a.samples,sampleRate:a.sampleRate});
```
  - For EN: `lexicon:\`${d}/lexicon-us-en.txt\``, `lang:''` (use `lexicon-gb-en.txt` for `b*` voices).
  - Piper voices: `{vits:{model,tokens,dataDir}}`.
  - Models: `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2` (350 MB; int8 variant 132 MB) and `vits-piper-<voice>.tar.bz2`. Speaker IDs are in the metadata `speaker2id`.
- **Gotchas:**
  - **kokoro-js FR workaround:** phonemize with espeak-ng `fr` (piper's `espeakbridge`), strip `-`, then `const {input_ids}=tts.tokenizer(ph,{truncation:true}); tts.generate_from_ids(input_ids,{voice:"ff_siwis"})`. It **silently truncates at about 510 tokens**, so synthesise per sentence. Do not build on kokoro-js for FR.
  - **kokoro-onnx / espeakng-loader 0.2.x fail when the espeak-ng-data real path is ≥ 160 bytes**, with a misleading `/home/runner/work/espeakng-loader/...phontab` error. Use a short path and `EspeakConfig(data_path=...)`. lemo `core/tts/tts.py` documents the same limit.
  - **Downloads through the proxy were truncated twice** (`en_US-ryan-high.onnx` came out 119.9 MB vs 120.8 MB, giving `INVALID_PROTOBUF`). Check sizes against the HF `x-linked-size` header or a SHA, and resume with `curl -C -` or HTTP Range.
- **Piper:**
```bash
python3 -m venv .venv && .venv/bin/pip install piper-tts==1.8.0 onnx
.venv/bin/python -m piper.download_voices --data-dir voices fr_FR-siwis-medium
.venv/bin/piper -m voices/fr_FR-siwis-medium.onnx -f out.wav < fr.txt   # --length-scale, --sentence-silence
```
  - **Phoneme alignment:** `PiperVoice.load(m, include_alignments=True)`; `chunk.phoneme_alignments[].num_samples`; split on the space phoneme for exact word times (`$SP/tts/piper_align.py`).
  - Voice URL: `https://huggingface.co/rhasspy/piper-voices/resolve/main/{lang}/{lang_code}/{name}/{quality}/{file}` (177 voices).
- **Voice licences (curate by dataset):**
  - FR: `fr_FR-siwis-medium` (F, CC-BY 4.0), `fr_FR-upmc-medium` (2 speakers incl. male "pierre", CC-BY-SA 4.0), `fr_FR-gilles-low` (M, CC0), `fr_FR-mls-medium` (125 speakers, CC-BY 4.0), `fr_FR-tom-medium` (M, **AGPL dataset**, flag it).
  - EN commercial-safe: `en_US-john/norman/bryce-medium` (PD), `en_US-joe-medium` (CC0), `en_GB-cori-high` (PD, F), `en_US-libritts-high` (CC-BY).
  - **Exclude:** `en_US-ryan-*`, `hfc_*` (CC BY-NC-SA), l2arctic, semaine (NC), `lessac` (research licence).
- **Untested GPU engines:** Chatterbox Multilingual v3 (MIT, FR, cloning, Perth watermark on every output) and Kyutai `tts-1.6b-en_fr` (CC-BY 4.0).
- **[Conflict]** "Use `npx hyperframes tts` (bundled Kokoro)" (awesome report) vs the HF CLI's side effects (installs global skills, telemetry on). **Resolution:** use sherpa-onnx-node directly, not the HyperFrames CLI.

### 7.3 Word timestamps and alignment

**whisper.cpp via Remotion** (`@remotion/install-whisper-cpp@4.0.532`):
```ts
await installWhisperCpp({to, version:"1.8.2"});  // git clone + make, 103 s here
await downloadWhisperModel({model:"large-v3-turbo", folder:to});
const out = await transcribe({inputPath: ABS_16k_mono_wav, whisperPath:to, whisperCppVersion:"1.8.2",
  model:"small", language:"fr", tokenLevelTimestamps:true, additionalArgs:["-nfa"], printOutput:false});
const {captions} = toCaptions({whisperCppOutput: out}); // Caption{text,startMs,endMs,timestampMs,confidence}
```
- Input must be 16 kHz mono s16 WAV (`ffmpeg -i in -ar 16000 -ac 1 -c:a pcm_s16le x.wav`), with an **absolute** path.
- Model sizes: tiny 75 MB, base 142 MB, small 488 MB, medium 1.5 GB, large-v3 2.9 GB, large-v3-turbo 1.62 GB. Never use `.en` models for FR.
- **Traps:**
  - Flash attention is on by default in 1.8+ and silently disables DTW ("dtw_token_timestamps is not supported with flash_attn"), so `timestampMs` comes back `null`. **Always pass `-nfa`.**
  - **`splitOnWord:true` breaks whisper-cli 1.8** (it reads "true" as an input file). Leave it unset or pass `-sow` in `additionalArgs`.
    - **[Conflict]** with the Remotion report's API listing; **resolved** in favour of the verified failure.
  - Windows installer support goes up to 1.6.0 only.
  - Bias names with `additionalArgs:["--prompt","Johnny Depp, Amber Heard"]`.

**Accuracy** (32 FR words, Piper phoneme ground truth, `$SP/tts/eval_align.py`, `eval_fw.py`; one synthetic voice, so indicative only):

| Method | Word start | Word end |
|---|---|---|
| whisper.cpp `offsets.from` | MAE 169 ms (small) / 324 ms (turbo); unusable for word-pop captions | — |
| whisper.cpp first-token `t_dtw` | about +122 ms late, consistently | — |
| **whisper.cpp first-token `t_dtw − 120 ms`** | MAE 65 ms (small) / 73 ms (turbo) | — |
| whisper.cpp last-token `t_dtw` | — | MAE 55 ms |
| faster-whisper `word_timestamps` | MAE 77–83 ms (biased about −80 ms) | MAE 54 ms |
| Script-guided NW aligner (`alignScriptToTranscript()`) | MAE 87 ms over all 32 words | — |

**Speed** (258 s of FR, 4 threads):

| ASR | Time | RTF |
|---|---|---|
| whisper.cpp small, DTW + `-nfa` | 117.5 s | 0.46 |
| whisper.cpp small, flash attention on, no DTW | 103.9 s | — |
| whisper.cpp turbo, flash attention on | 323 s | 1.25 |
| whisper.cpp turbo, DTW + `-nfa` | 499 s (partly contended) | — |
| **faster-whisper 1.2.1 int8, small** | 59.9 s | 0.23 |
| **faster-whisper 1.2.1 int8, large-v3-turbo** | 54.0 s | **0.21** |

- Turbo got "Jack Sparrow" right; small heard "Jacques Parro".
- `WhisperModel("large-v3-turbo", device="cpu", compute_type="int8").transcribe(p, language="fr", word_timestamps=True, vad_filter=True, initial_prompt=names)`. A 25-min VO takes about 5 min.
- **[Conflict]** The Remotion report recommends whisper.cpp large-v3-turbo; the TTS report measured it 2–6× slower on CPU, with traps. **Resolution:** faster-whisper is the default (a Python sidecar exists anyway); whisper.cpp (DTW, `-nfa`, −120 ms start correction) is the no-Python fallback; `@remotion/whisper-webgpu` is an option on GPU or browser.
- **Avoid:**
  - WhisperX 3.8.6 (pulls in torch 2.8, pyannote 4, triton; FR aligner `VOXPOPULI_ASR_BASE_10K_FR`);
  - ctc-forced-aligner's default MMS model (**CC-BY-NC**).

**Strategy: we always know the text.**

| Source | Word timing method |
|---|---|
| ElevenLabs | native character alignment |
| Piper (Python) | phoneme alignment |
| Kokoro and the user's own recording | ASR → word-level Needleman-Wunsch of script words against ASR words (script-exact text with ASR times) → interpolate unmatched words |

- The same round-trip is **TTS QA**: regenerate segments whose WER against the script is above about 5%. Use lemo-style 0.6 s padding for short lines; EN must be word-exact after number normalisation; FR similarity must be ≥ 0.92.
- **Strict cue lookup** (motion-graphics `cue(word,nth)`): throw at build time if a referenced word is missing; normalise accents for FR; re-resolve cues on any voice change; **never time-stretch the VO to fit the visuals.**
- **User's own voice:**
  1. Clean: `highpass=f=80, afftdn, deesser, acompressor`, then loudnorm −16 LUFS.
  2. ASR plus script alignment.
  3. Move scene and sentence anchors to the real times.
  4. Detect retakes (repeated n-grams: keep the last take).
  5. Report missing sentences.
  6. Propose pause tightening from `silencedetect` or `getSilentParts`.
  7. Jump-cut fillers and silences with 30 ms afades at every splice (HF `transcript-cut.mjs`).
  - Whisper drops fillers ("euh"): use `--prompt` or Scribe if filler cuts matter.
  - Ad-libs not in the script need a "free speech" fallback span.
  - ElevenLabs forced alignment is the paid one-call path. An IVC/PVC clone of the user's voice can patch pickups.

### 7.4 Audio post chain (validated, `$SP/tts/audiopost.sh`)

1. **Silence trim** (head/tail, and internal pauses capped at 0.35 s):
   `silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=stop_periods=-1:stop_duration=0.35:stop_threshold=-45dB:stop_silence=0.35`
2. **Two-pass loudnorm:**
   - Pass 1: `loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -`, then parse `input_i, input_tp, input_lra, input_thresh, target_offset`.
   - Pass 2: `…:measured_I=..:measured_TP=..:measured_LRA=..:measured_thresh=..:offset=..:linear=true`.
   - **Always add `-ar 48000`** (loudnorm resamples to 192 kHz internally).
   - **Check `normalization_type`** in pass 2: it falls back to dynamic when TP can't be met linearly, which pumps the mix.
3. **Test result:** VO + ducked music came out at −13.9 LUFS and −1.9 dBTP; the whole chain took 5 s for 62 s of audio.
4. **Delivery:**
   - Remotion `renderMedia` supports audio-only `codec:'wav'|'mp3'|'aac'` and `audioCodec:'pcm-16'`.
   - Final step: `ffmpeg -i r.mp4 -af <loudnorm 2-pass linear> -c:v copy -c:a aac -b:a 320k final.mp4` (or mux the offline master per §3.9).
   - Stems (VO/music/SFX/clip audio) via `inputProps` muting or the offline mixer.

### 7.5 Interfaces (type-checked in `$SP/tts/node/voice.ts`)

```ts
interface TtsProvider { id; capabilities(): Promise<{languages, nativeWordTimestamps, stitching, maxCharsPerRequest, voiceCloning, costPer1kChars?}>;
  listVoices(lang?): Promise<VoiceInfo[]>; synthesize(req: TtsRequest, outPath, signal?): Promise<TtsResult> }
TtsRequest { segmentId, text, lang, voiceId, speed?, previousText?, nextText?, previousRequestIds?, seed? }
TtsResult  { segmentId, audioPath, durationMs, words: WordTiming[] | null /* null => run Aligner */, providerRequestId?, provider }
interface Aligner { align(audio, scriptWords, lang): Promise<WordTiming[]> }
// impls: ElevenLabsCharAlignment, PiperPhonemeAlignment, FasterWhisperAligner (Python sidecar),
//        WhisperCppAligner (no Python), ElevenLabsForcedAligner
```
- Use the pure `decide()` / impure `gather()` provider-readiness pattern (HF `packages/cli/src/audio/providers.ts`), with setup hints.
- Captions export as the Remotion `Caption[]` type everywhere, plus `serializeSrt` per language.

---

## 8. Timeline export

### 8.1 Recommendation

**Write all formats from one NLE-agnostic, integer-frame `ExportTimeline`** derived from the same EDL. Writers go in `packages/engine/src/export/`: `fcpxml.ts`, `xmeml.ts` (flavour `'premiere'|'resolve'`), `otio.ts`, `edl.ts`, `srt.ts`, `bundle.ts`.

| Target | Primary | Secondary | Why |
|---|---|---|---|
| Premiere Pro 25.x/26.x | **FCP7 XML (xmeml v4), "premiere" flavour** | `.otio` with `PremierePro_OTIO` metadata (25.6+) | Premiere cannot import FCPXML. xmeml carries Basic Motion/Opacity keyframes, Audio Levels, dissolves and markers |
| DaVinci Resolve 19/20 | **FCPXML 1.10, single `.fcpxml` file** | xmeml "resolve" flavour, `.otio`/`.otioz`, marker EDL | Most features in Resolve's import matrix |
| Final Cut Pro 10.6–12 | the same FCPXML 1.10 (optionally 1.13) | — | FCP imports older versions |
| Archive / anything else | `.otio` | CMX3600 (V1 only) | cut list only |

- **[Conflict]** The Remotion report suggests OTIO as the primary export (following the `remotion-opentimeline` skill: Resolve 18.5+ and Premiere 25.6+ import it; `otioconvert ... -O fcp_xml`). The timeline-export report shows standard OTIO carries **no transforms or opacity** (the ASWF spatial-transform schema is only on the 2026 roadmap) and Premiere's OTIO metadata is reverse-engineered.
- **Resolution:** FCPXML 1.10 and xmeml v4 are primary; OTIO is secondary and archival. Generate OTIO from the EDL, not from React (Remotion says React-to-OTIO can't be deterministic; ours can).

**Default bundle per project and language:**
- `<slug>.<lang>.premiere.xml`
- `<slug>.<lang>.fcpxml`
- `<slug>.<lang>.otio`
- `<slug>.<lang>.markers.edl`
- `<slug>.<lang>.srt`
- `reference.mp4`
- stems (48 kHz WAV)
- `overlays/*.mov` (ProRes 4444)
- `media/`
- `README` with import steps
- opt-in: xmeml resolve flavour, `.otioz`

**Native NLE parameters only:** cuts, stills, dissolves, scale/position/rotation, opacity, blend modes, linear speed, gain, markers. **Everything else becomes ProRes 4444 alpha overlays** (kinetic captions, glitch, RGB split, masks, custom or whip transitions, grain) or pre-comp segments with handles, with the raw layers kept on a disabled track:
`--codec=prores --prores-profile=4444 --pixel-format=yuva444p10le --image-format=png` (SSR: `codec:'prores', proResProfile:'4444', pixelFormat:'yuva444p10le', imageFormat:'png'`), placed with xmeml `alphatype straight`.

### 8.2 Version and support facts

- **FCPXML versions:** 1.10 = FCP 10.6 (introduced the `.fcpxmld` bundle); 1.12 = 10.8; 1.13 = 11.0 (11.1/11.2 still 1.13); 1.14 = 12.0 (2026-01-28).
- **Resolve:**
  - 18 added 1.10; 18.6.6 rejects 1.12 (CommandPost #3370); 19.1 imports 1.11; auto-editor writes 1.11 for Resolve; 21 beta 4 adds 1.14; **Resolve 20's ceiling is undocumented**.
  - **Default `version="1.10"`**, configurable, plain `.fcpxml`.
- **DTD:** `developer.apple.com/tutorials/data/documentation/professional-video-applications/document-type-definition.json`, saved to `$SP/tl/fcpxml-1.10.dtd`.
- **Resolve 20 Reference Manual** (ch. 55, pp. 1134–1138; text at `$SP/tl/resolve20.txt` around line 51627):

| Feature | EDL | FCP7 XML | FCPX XML |
|---|---|---|---|
| Multiple tracks | No | Yes | Yes |
| Video transitions | Yes | Yes | Yes |
| Audio transitions | No | No | No |
| Opacity | No | Yes | Yes |
| Position/Scale/Rotation keyframes | No | Yes | Yes |
| Composite modes | No | Yes | Yes |
| Linear speed | Yes | Yes | Yes |
| Variable speed | No | Yes | Yes |
| Still images | No | Yes | Yes |
| Nested sequences | No | Yes | Yes |
| Text generators (→ Basic text) | No | Yes | Yes |
| Color corrections | No | No | FCPX only |

  - Stills: TIF/JPG/PNG/DPX/TGA/DNG only, longer than one frame.
  - Ten transitions recognised (Cross Dissolve, Additive, Dip to Color, Edge/Center/Clock/Venetian wipes, Cross/Diamond/Oval iris).
  - Ten composite modes: Add, Subtract, Difference, Multiply, Screen, Overlay, Lighten, Hardlight, Softlight, Darken.
  - Alpha in ProRes 4444, DNxHR 444, QuickTime Animation, TIFF, EXR.
  - **Transforms import only if "Use sizing information" is ticked** (Load XML, ch. 58).
  - The timeline frame rate locks once the Media Pool has media, so import into a new project.
  - `.otio` and **`.otioz`** supported (ch. 61).
- **Premiere:**
  - exports `xmeml version="4"` with extensions (`explodedTracks`, `premiereTrackType`, `currentExplodedTrackIndex`, `authoringApp`, `pproTicksIn`);
  - no FCPXML import;
  - **OTIO GA from 25.6** (cut list, tracks, names, linear speed, coloured markers, frame size, sample rate);
  - **25.6.1 fixed a bug where Motion properties disappeared on XML import.**
- **OTIO:** Python `opentimelineio==0.18.1` (Apache-2.0); no transform effects in the standard schema; Avid MC 2025.6 and Kdenlive also support it.

### 8.3 What survives import

| Feature | xmeml → Premiere | xmeml → Resolve | FCPXML → Resolve | FCPXML → FCP | OTIO → Resolve | OTIO → Premiere 25.6+ | CMX3600 |
|---|---|---|---|---|---|---|---|
| Multi-track V/A | yes (stereo = 2 exploded tracks) | yes | yes (lanes) | yes | yes | yes | V1 only |
| Stills | yes (file `<duration>` ≥ `out`) | yes | yes (`<video>`) | yes | verify | yes (`available_range` must cover) | no |
| Scale/position/rotation keyframes | yes (Basic Motion) | yes (tick sizing) | yes (`adjust-transform`) | yes | no | yes (metadata) | no |
| Opacity + keyframes | yes | yes | yes (`adjust-blend`) | yes | no | yes | no |
| Blend modes | yes (`compositemode`) | yes | yes (`mode=int`) | yes | no | yes | no |
| Cross dissolve | yes | yes | yes | yes | likely | yes (`SMPTE_Dissolve`) | yes (D) |
| Audio volume keyframes | yes (linear gain) | verify | verify | yes | no | verify | no |
| Audio crossfade | yes ("Cross Fade (0dB)") | no | no | yes | ? | ? | no |
| Markers | yes (sequence + clip) | likely (else marker EDL) | clip-level only | yes | likely | yes | Resolve marker EDL |
| Titles/text | poor | Basic text | Basic text | yes | no | no | no |
| Linear speed | yes (`timeremap`) | yes | yes (`timeMap`) | yes | yes (`LinearTimeWarp`) | yes | yes (M2) |

### 8.4 Writer rules

**FCPXML 1.10**
- **Structure:** `fcpxml > resources(format|asset>media-rep|effect) > library > event > project > sequence(format, duration, tcStart, tcFormat="NDF", audioLayout="stereo", audioRate="48k") > spine`.
- **Time:** rational and frame-quantised, `frames*den/num+"s"` (30 fps: `"195/30s"`; 29.97: frameDuration `1001/30000s`, times `frames*1001/30000s`). Off-grid times make FCP insert gaps.
- **Spine and lanes:**
  - the spine is V1;
  - other layers are **connected clips** anchored inside a spine item: `lane="1".."n"` for video above, `lane="-1".."-n"` for audio;
  - **the anchor `offset` and marker `start` are in the parent's local time: `parent.start + (timelineFrame − parent.offset)`** (verified: local 330f in a clip with offset 180 and start 300 lands at 7.0 s);
  - anchored items may extend past their parent;
  - anchor long audio to the first spine item;
  - no sequence-level markers: attach them to spine items.
- **Stills:** asset `start="0s" duration="0s"` with a format that has no frameDuration (`FFVideoFormatRateUndefined`), placed via `<video ref>`. Use `start="3600s"` when a still is the incoming clip of a dissolve, so head handles exist (FCP itself uses about 1 h, e.g. `86399313/24000s`).
- **Clips:** `asset-clip(ref, offset, start=sourceIn, duration)`, `audioRole="dialogue|music|effects"`.
- **Transform:** `adjust-transform` with `param name="scale|position|rotation|anchor"` and `keyframeAnimation/keyframe(time, value, interp=linear|ease|easeIn|easeOut, curve=linear|smooth)`; keyframe time is local and start-based.
  - `scale="1.2 1.2"` is a multiplier of the fitted frame.
  - **`position` is a % of frame height, +y up.**
  - **`rotation` is in degrees, counter-clockwise positive.**
- **Blend:** `adjust-blend amount="0..1" mode=` 10 Screen, 8 Add, 4 Multiply, 14 Overlay.
- **Volume:** `adjust-volume amount="-6dB"`, keyframes in `param name="amount"` (`"-18dB"`).
- **Transition:** `<transition name="Cross Dissolve" offset=cut−d/2 duration=d><filter-video ref=rX/>`, with effect `uid="FxPlug:4731E73A-8DAC-4113-9A30-AE85B1761265"` (FCP matches by uid, Resolve by name). Clips stay abutted; handles come from the source media.
- **Titles (FCP only):** `.../Titles.localized/Basic Text.localized/Text.localized/Text.moti`.
- **media-rep `src`:** absolute, percent-encoded `file:///` (relative paths untested in Resolve).

**xmeml v4**
- **Structure:** `xmeml > sequence(name, duration, rate{timebase,ntsc}, timecode, media{video{format,track*},audio{format,track*}}, marker*)`.
- **All values are integer frames.** 29.97 = `30`+`ntsc TRUE`; 23.976 = `24/TRUE`.
- **Clipitem:** `start/end` are sequence frames (end exclusive); `in/out` use the clipitem `<rate>`, so always write the sequence rate there.
- **Files:** `<file id>` is defined fully once, then referenced as `<file id="file-5"/>`.
- **Paths:** `file://localhost/Users/...` or `file://localhost/C:/...`, percent-encoded.
- **Centred transition:** `transitionitem(start=cut−d/2, end=cut+d/2, alignment=center)`. The outgoing clip gets `end=-1` with `out` extended; the incoming clip gets `start=-1` with `in` pulled back by d/2.
- **Keyframe `when` = source frames** (Premiere stills sit at in=86313 with `when` 86313..86676).
- **Basic Motion** (`effectid basic`):
  - scale = % of the **source's native pixels**;
  - rotation in degrees;
  - `center{horiz,vert}`: empirical `horiz=dxPx/seqW`, `vert=dyPx/seqH`, +y down (**verify with a fixture**).
- **Opacity:** `effectid opacity`, 0..100.
- **Audio Levels:** `effectid audiolevels`, `parameterid level`, **linear `10^(dB/20)`, maximum 3.98109**.
- **Blend:** `<compositemode>screen</compositemode>`.
- **Two flavours** (auto-editor `src/exports/fcp7.nim`):

| | premiere | resolve |
|---|---|---|
| Sequence | `explodedTracks="true"` | plain |
| Stereo | 2 tracks (`currentExplodedTrackIndex` 0/1, `totalExplodedTrackCount=2`, `premiereTrackType="Stereo"`, sourcetrack 1/2) | one track per stem |
| Mono | 1 track, `premiereTrackType="Mono"` | one track per stem |
| Still `file/duration` | frame count (otherwise Premiere falls back to about 12 h) | empty `<duration/>` |
| Multi-stream audio files | n/a | **Resolve reads only the first audio stream**, so split stems into separate WAVs |

- **Validation:** the Apple DTD v4 (`$SP/tl/xmeml_dtd_4.dtd`) rejects only Premiere extensions; `xmeml_dtd_4_premiere.dtd` adds 6 ATTLISTs (`explodedTracks, premiereTrackType, currentExplodedTrackIndex, totalExplodedTrackCount, premiereChannelType, authoringApp`) plus `numOutputChannels`.

**OTIO**
- **Schema:** `Timeline.1 > Stack.1 > Track.1(kind)` containing `Clip.2` (`media_references.DEFAULT_MEDIA = ExternalReference.1{target_url, available_range}`, `active_media_reference_key`), `Gap.1`, `Transition.1 (SMPTE_Dissolve, in_offset/out_offset)`, `Marker.2 (color)`, `LinearTimeWarp.1`.
- **Time:** `RationalTime(value, rate)`. For older readers, `target_schema_versions={"Clip":1}` (tested).
- **Premiere metadata** (auto-editor `src/exports/otio.nim`, Unlicense): `metadata.PremierePro_OTIO` on the timeline, the stack (VideoFrameRate, VideoResolution, AudioFrameRate) and clips (LinkID), and `Effect.1` entries:
  - `AE.ADBE Motion`: Position(1) `{X,Y}` as a 0..1 centre with y down, Scale(2) %, Scale Width(3), uniform(4), Rotation(5), Anchor(6), Anti-flicker(7), Crop(8–11);
  - `AE.ADBE Opacity`: Opacity(1) %, Blend Mode(2,3);
  - `Internal Volume Stereo`: Mute(0), Level(1);
  - constant values use `StartValue{Position: RationalTime(-10800000)}`; animated values use `Keyframes[{Position: RationalTime(source frame), Value}]`.
- **Gotchas:**
  - **Never add a no-op LinearTimeWarp**: Premiere then drops the intrinsic Motion/Opacity.
  - A still's `available_range` must cover the clip's source range, or keyframes are rescaled.

**CMX3600 EDL**
- V1 only, 8-character reel names, C/D/W, M2 speed, no keyframes, no stills, conform by timecode (YouTube files have none).
- **Used only for:**
  - the **Resolve marker EDL**: `|C:ResolveColorBlue |M:name |D:frames`, imported via Media Pool > Timelines > Import > Timeline Markers from EDL;
  - an optional V1 EDL via `otio-cmx3600-adapter`.

### 8.5 Gotchas checklist

1. **Paths:**
   - absolute in practice; percent-encode UTF-8 (`é` → `%C3%A9`); XML-escape names;
   - `url.pathToFileURL()` for FCPXML/OTIO; replace `file://` with `file://localhost` for xmeml;
   - unique, slugified, ASCII-safe file names so Resolve folder relink and Premiere Link Media work;
   - an **"export root on editing machine"** remap setting (the server path differs from the user's machine).
2. **Frame rate:**
   - integer 30/25/24 by default, NTSC optional;
   - the Remotion fps equals the timeline fps;
   - transcode VFR to CFR;
   - NDF only, with the same start timecode (00:00:00:00) in XML, OTIO and the marker EDL (the Resolve default is 01:00:00:00 unless the file sets it).
3. **Stills:**
   - convert WebP/AVIF/SVG/GIF/HEIC to PNG or JPG;
   - bake EXIF orientation into the pixels;
   - **conform every still to the sequence size (cover or blur-pad)**, so that 100% scale means the same thing everywhere (Premiere scales native pixels; FCP and Resolve start from a fitted frame);
   - handles ≥ d/2.
4. **Audio:**
   - 48 kHz WAV only (ElevenLabs MP3 at 44.1 kHz, Kokoro at 24 kHz and Piper at 22.05 kHz all get resampled);
   - avoid MP3 (about 25 ms priming offset);
   - one stream per file;
   - **export baked stems** in addition to gain keyframes, because Resolve's handling of gain keyframes is unverified.
5. **Resolve:**
   - tick "Use sizing information" and import into a fresh project;
   - Resolve free on Linux cannot decode H.264/H.265/AAC (well known, not re-verified), so offer a DNxHR or ProRes mezzanine.
6. **Easing:** bake Remotion curves into dense linear keyframes, every frame for punch-ins and capped at about 60 per clip. Keep long Ken Burns moves to two keyframes.
7. **Languages:** one timeline per language, with SRT sidecars.

### 8.6 Minimal valid examples

All of these were produced and checked in the container. Scenario: 1920×1080, 30 fps, 48 kHz, 12 s:
- V1: photo 0–6 s zooming 100→120%, a 1 s centred dissolve, then broll 6–12 s (source in 10 s);
- V2: alpha lower third at 7–10 s;
- A1: narration;
- A2: music at −6 dB, then −18 dB from 1–11 s, then a fade;
- markers.

Files: `$SP/tl/examples/`.

**FCPXML 1.10** (passes `xmllint --dtdvalid fcpxml-1.10.dtd`; `demo.fcpxml`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="FFVideoFormat1080p30" frameDuration="1/30s" width="1920" height="1080" colorSpace="1-1-1 (Rec. 709)"/>
    <format id="r6" name="FFVideoFormatRateUndefined" width="1920" height="1080" colorSpace="1-13-1"/>
    <asset id="r2" name="photo" start="0s" duration="0s" hasVideo="1" format="r6" videoSources="1">
      <media-rep kind="original-media" src="file:///Users/me/DocumentaryMaker/projects/demo/media/photo.jpg"/></asset>
    <asset id="r3" name="broll" start="0s" duration="30s" hasVideo="1" format="r1" videoSources="1">
      <media-rep kind="original-media" src="file:///Users/me/DocumentaryMaker/projects/demo/media/broll.mp4"/></asset>
    <asset id="r4" name="lowerthird" start="0s" duration="3s" hasVideo="1" format="r1" videoSources="1">
      <media-rep kind="original-media" src="file:///Users/me/DocumentaryMaker/projects/demo/render/lowerthird.mov"/></asset>
    <asset id="r5" name="narration" start="0s" duration="12s" hasAudio="1" audioSources="1" audioChannels="1" audioRate="48000">
      <media-rep kind="original-media" src="file:///Users/me/DocumentaryMaker/projects/demo/audio/narration.wav"/></asset>
    <asset id="r7" name="music" start="0s" duration="120s" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000">
      <media-rep kind="original-media" src="file:///Users/me/DocumentaryMaker/projects/demo/audio/music.wav"/></asset>
    <effect id="r8" name="Cross Dissolve" uid="FxPlug:4731E73A-8DAC-4113-9A30-AE85B1761265"/>
  </resources>
  <library><event name="DocumentaryMaker"><project name="Demo">
    <sequence format="r1" duration="360/30s" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
      <spine>
        <video ref="r2" name="photo" offset="0s" start="0s" duration="180/30s">
          <adjust-transform><param name="scale"><keyframeAnimation>
            <keyframe time="0s" value="1 1"/><keyframe time="195/30s" value="1.2 1.2"/>
          </keyframeAnimation></param></adjust-transform>
          <asset-clip ref="r5" lane="-1" name="narration" offset="0s" start="0s" duration="360/30s" audioRole="dialogue"/>
          <asset-clip ref="r7" lane="-2" name="music" offset="0s" start="0s" duration="360/30s" audioRole="music">
            <adjust-volume amount="-6dB"><param name="amount"><keyframeAnimation>
              <keyframe time="0s" value="-6dB"/><keyframe time="30/30s" value="-18dB"/>
              <keyframe time="330/30s" value="-18dB"/><keyframe time="360/30s" value="-96dB"/>
            </keyframeAnimation></param></adjust-volume>
          </asset-clip>
          <marker start="0s" duration="1/30s" value="Hook" note="Cold open"/>
        </video>
        <transition name="Cross Dissolve" offset="165/30s" duration="30/30s"><filter-video ref="r8" name="Cross Dissolve"/></transition>
        <asset-clip ref="r3" name="broll" offset="180/30s" start="300/30s" duration="180/30s" tcFormat="NDF">
          <asset-clip ref="r4" lane="1" name="lowerthird" offset="330/30s" start="0s" duration="90/30s"/>
          <marker start="330/30s" duration="90/30s" value="Lower third: name + title"/>
        </asset-clip>
      </spine>
    </sequence>
  </project></event></library>
</fcpxml>
```

**xmeml v4, Premiere flavour.**
- Validates against the Apple v4 DTD plus the Premiere ATTLISTs.
- OTIO `fcp_xml` reads it back as: dissolve centred at frame 180 (15/15), broll at 180 with source 300, lower third at 210, markers at 0 and 210.
- Full version: `demo_premiere.xml`. Compact version (217 lines): `demo_premiere_compact.xml`.
```xml
<xmeml version="4"><sequence id="sequence-1" explodedTracks="true">
 <name>Demo</name><duration>360</duration><rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>
 <timecode><rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate><string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
 <media><video><format><samplecharacteristics><rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate><width>1920</width><height>1080</height></samplecharacteristics></format>
  <track>
   <clipitem id="clipitem-1"><name>photo.jpg</name><enabled>TRUE</enabled><duration>18000</duration><rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>
    <start>0</start><end>-1</end><in>0</in><out>195</out><alphatype>none</alphatype>
    <file id="file-1"><name>photo.jpg</name><pathurl>file://localhost/Users/me/DocumentaryMaker/projects/demo/media/photo.jpg</pathurl>
     <rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate><duration>18000</duration>
     <media><video><samplecharacteristics><rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate><width>1920</width><height>1080</height></samplecharacteristics></video></media></file>
    <compositemode>normal</compositemode>
    <filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>
     <parameter authoringApp="PremierePro"><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>1000</valuemax><value>100</value>
      <keyframe><when>0</when><value>100</value></keyframe><keyframe><when>195</when><value>120</value></keyframe></parameter>
     <parameter authoringApp="PremierePro"><parameterid>center</parameterid><name>Center</name><value><horiz>0</horiz><vert>0</vert></value></parameter>
    </effect></filter></clipitem>
   <transitionitem><rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate><start>165</start><end>195</end><alignment>center</alignment>
    <effect><name>Cross Dissolve</name><effectid>Cross Dissolve</effectid><effectcategory>Dissolve</effectcategory><effecttype>transition</effecttype><mediatype>video</mediatype><startratio>0</startratio><endratio>1</endratio><reverse>FALSE</reverse></effect></transitionitem>
   <clipitem id="clipitem-2"><name>broll.mp4</name>...<start>-1</start><end>360</end><in>285</in><out>480</out><file id="file-2">...</file>
    <marker><name>B-roll: court footage</name><comment/><in>300</in><out>-1</out></marker></clipitem>
  </track>
  <track><clipitem id="clipitem-3"><name>lowerthird.mov</name>...<start>210</start><end>300</end><in>0</in><out>90</out><alphatype>straight</alphatype>...
    <filter><effect><name>Opacity</name><effectid>opacity</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>
     <parameter authoringApp="PremierePro"><parameterid>opacity</parameterid><name>opacity</name><valuemin>0</valuemin><valuemax>100</valuemax>
      <keyframe><when>0</when><value>0</value></keyframe><keyframe><when>6</when><value>100</value></keyframe></parameter></effect></filter></clipitem></track>
 </video>
 <audio><numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>
  <track currentExplodedTrackIndex="0" totalExplodedTrackCount="1" premiereTrackType="Mono"><clipitem id="clipitem-4" premiereChannelType="mono">narration.wav 0-360 ...<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack></clipitem></track>
  <track currentExplodedTrackIndex="0" totalExplodedTrackCount="2" premiereTrackType="Stereo"><clipitem id="clipitem-5" premiereChannelType="stereo">music.wav 0-360 ... sourcetrack 1, links to clipitem-5/6 (groupindex 1)
    <filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype>
     <parameter authoringApp="PremierePro"><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>0.501187</value>
      <keyframe><when>0</when><value>0.501187</value></keyframe><keyframe><when>30</when><value>0.125893</value></keyframe>
      <keyframe><when>330</when><value>0.125893</value></keyframe><keyframe><when>359</when><value>0.000016</value></keyframe></parameter></effect></filter>
   </clipitem><outputchannelindex>1</outputchannelindex></track>
  <track currentExplodedTrackIndex="1" totalExplodedTrackCount="2" premiereTrackType="Stereo"> same clip, <file id="file-5"/>, sourcetrack 2, same Audio Levels, outputchannelindex 2</track>
 </audio></media>
 <marker><name>Hook</name><comment>Cold open</comment><in>0</in><out>-1</out></marker>
 <marker><name>Lower third</name><comment>name + title</comment><in>210</in><out>300</out></marker>
</sequence></xmeml>
```

**OTIO:** `demo.otio`, written with Python OTIO 0.18.1; reads back as 360 frames at 30 fps over 4 tracks. It includes Premiere Motion Scale keyframes. Volume metadata was left out because the units are unverified.

**Resolve marker EDL** (`demo_markers_resolve.edl`, CRLF line endings):
```
TITLE: Demo Markers
FCM: NON-DROP FRAME

001  001      V     C        00:00:00:00 00:00:00:01 00:00:00:00 00:00:00:01
 |C:ResolveColorRed |M:Hook |D:1
```
The V1 CMX3600 file is `demo_v1.edl`, with the dissolve written as `D 030`.

### 8.7 Property mapping (dx/dy in pixels, y down; media conformed)

| Property | FCPXML | xmeml | Premiere OTIO |
|---|---|---|---|
| Scale s | `"s s"` | `100*s` | `100*s` |
| Position | `"dx/H*100 -dy/H*100"` | `horiz=dx/W`, `vert=dy/H` (verify) | `X=0.5+dx/W`, `Y=0.5+dy/H` |
| Rotation (CSS clockwise) | `-deg` | `deg` (verify sign) | `deg` |
| Opacity | `amount 0..1` | `0..100` | `0..100` |
| Gain | `"xdB"` | `10^(x/20)` | n/a |
| Keyframe time | `clip.start + local frame` | `in + local frame` | `source_range.start + local frame` |

### 8.8 Libraries

| Library | Version | License | Use |
|---|---|---|---|
| `xmlbuilder2` | 4.0.3 | MIT | XML writer (prototype in `$SP/npmtest/gen.mjs`) |
| `fast-xml-parser` | 5.11.2 | MIT | tests and re-import |
| `@chatoctopus/timeline` | 0.3.0 | MIT | reference/re-import only: no keyframes, transforms or volume, drops lane transitions |
| `opentimelineio` (npm) | 0.1.0 | Apache-2.0 | immature; write OTIO JSON directly |
| `smpte-timecode` | 1.3.6 | MIT | timecode math |
| Python `opentimelineio` + `otio-fcp-adapter`, `otio-fcpx-xml-adapter`, `otio-cmx3600-adapter` | 0.18.1 / 1.0.0 | Apache-2.0 | CI round-trip validation. **The fcpx adapter can't parse FCP-style `<video>` stills**, so it is not a sole validator |
| auto-editor `src/exports/{fcp7,fcp11,otio}.nim` (`$SP/ext/auto-editor/`) | — | Unlicense | port the quirks: flavours, exploded stereo, still durations, `spanStart`, FxPlug uid, PremierePro_OTIO schema |
| `xmllint` (system) | — | — | DTD validation (`xmllint-wasm` has no DTD support) |

- **Fixture suite:** golden files validated with `xmllint --dtdvalid`, OTIO round-trips in CI, plus a manual NLE smoke checklist (Resolve 20, Premiere 25.6+/26, FCP 11/12) that verifies:
  - xmeml center units and sign;
  - the FCPXML still start;
  - Resolve volume keyframes;
  - Resolve markers from xmeml/OTIO.
- Premiere-exported reference XML: `OpenTimelineIO/otio-fcp-adapter/tests/sample_data/premiere_example.xml`.
- The Apple DTDs and the Resolve manual are copyrighted. Vendor them only as test fixtures with attribution, or download them in CI.

---

## 9. Risks and open issues

### 9.1 Legal and licensing

- **Defamation and privacy are the biggest product risks.** For real-person scandal topics (Depp/Heard):
  - legal status changes over time (appeals, settlements);
  - the UK repetition rule makes attribution alone insufficient;
  - French law protects the presumption of innocence;
  - titles and thumbnails are publications too.
  - Keep the claim-status model, the lawyer pass, `as_of` dates, the freshness re-check and the human acknowledgement gate. They reduce risk; they are not legal advice.
- **YouTube footage:**
  - downloading violates YouTube's ToS; fair use depends on jurisdiction (FR droit de citation is narrower);
  - cookies risk bans;
  - keep clips short and commented, log URL and timecodes, and show a responsibility notice;
  - a "Source:" label is not a legal shield.
- **YouTube policy:**
  - the July 2025 "inauthentic content" rule targets mass-produced AI-voice/stock videos;
  - the altered/synthetic disclosure applies to AI depictions;
  - profanity in titles and thumbnails limits ads.
- **Licences:**
  - **Remotion License:** a Company License is needed above 3 people (contractors count in v5); `<Player>` counts as an automation API; 5.0 changes the terms.
  - `@remotion/transitions` and `@remotion/effects` show "UNLICENSED" on npm, meaning they are under the Remotion License; confirm before commercial use.
  - **GSAP** licence clause on visual animation builders: don't ship it.
  - **p5** is LGPL-2.1: don't ship it.
  - **PDoomVideo** has no licence, and `pdoom.mp3` is a third-party song.
  - **Clawd** is Anthropic's mascot.
  - Apple DTDs and the Resolve manual are copyrighted.
- **Asset licences:**
  - Pexels "bad light" and Pixabay "immoral" rules forbid stock look-alikes standing in for real people in negative contexts (also a defamation risk).
  - Commons personality rights and BY-SA.
  - Pixabay SFX may not be redistributed as a library.
  - `@remotion/sfx` meme sounds are not under a free licence.
  - BBC Sound Effects (RemArc) are non-commercial only; Zapsplat's free tier requires attribution.
  - Jamendo is mostly NC. "Royalty-free" tracks can still trigger Content ID (reject Pixabay "Content ID Registered").
  - Salamander piano (CC BY 3.0) and MuldjordKit (CC BY 4.0) require attribution.
- **Voice and model licences:**
  - piper-tts 1.8 is GPL-3.0 (subprocess only); bgutil is GPL-3.0-only (separate process).
  - NC or research-only voices: ryan, hfc_*, l2arctic, semaine, lessac.
  - The fr_FR-tom dataset is AGPL.
  - The MMS aligner is CC-BY-NC.
  - Depth-Anything Base and Large are CC-BY-NC.
  - `@imgly/background-removal` is AGPL.
- **Prompt IP:** awesome-corpus prompts belong to their creators, and the TubeLab transcripts are copyrighted. Use them for internal analysis and short few-shot excerpts only.
- **Trademark:** no channel names or logos in style IDs; no X logo on tweet cards; no Vox branding.

### 9.2 Technical risks

- **YouTube** is the most fragile dependency:
  - 429 after about 10 caption requests; 403 on every download from a datacenter, even with a PO token (IP-bound URLs);
  - plan for local execution, frequent yt-dlp updates and manual-import fallback;
  - from this container, neither the pacing calibration nor clip downloads could be verified.
- **Render time:**
  - CPU-only swangle is about 24 fps at 720p for simple content, but shader or effect-heavy scenes can reach 340 ms per frame, and p5.brush watercolour 20–29 s per frame.
  - Mitigations: chunking, caching, draft presets, GPU/NVENC hosts, pre-rendered inserts.
  - The `angle` backend leaks memory on long renders.
  - delayRender timeouts at 30 s.
- **Preview/render parity:**
  - HtmlInCanvas shader transitions and effects need Chrome 149+ with a flag to preview; `toneFrequency` doesn't preview; `calculateMetadata` doesn't run in the Player.
  - Mitigations: CSS fallbacks gated by `isHtmlInCanvasSupported()`, a shared `computeTimeline`, the same gain table for preview and final.
- **Media codecs:** AV1/H.265 silently fall back to OffthreadVideo (full download, timeouts); `@remotion/media` `playbackRate` shifts pitch. Transcode to H.264 and use `disallowFallbackToOffthreadVideo` in CI.
- **Remote assets** fail behind proxies (`ERR_CERT_AUTHORITY_INVALID` for Google Fonts and remotion.media). Localise everything; never disable TLS.
- **Determinism** in LLM TSX (Math.random, CSS animation, state, unloaded fonts) shows up only in parallel renders. Lint, typecheck, `renderStill` probes, render-twice-and-diff.
- **Alignment:**
  - whisper.cpp ≥ 1.8 needs `-nfa`, `splitOnWord` breaks, DTW lags about 120 ms;
  - French accented speech may drift beyond the 80 ms caption tolerance, so validate;
  - ASR mishears names (use initial prompts plus script-guided alignment);
  - fillers are dropped.
- **Beat detection:** beats.py assumes steady 4/4 in 80–180 BPM, about 16 ms early. It mis-tracks rubato, tempo changes and ambient beds, so snap only when a strong beat is within tolerance (librosa/madmom optional).
- **Audio:**
  - loudnorm can fall back to dynamic mode (check `normalization_type`);
  - `alimiter` is not true-peak;
  - procedural SFX sound synthetic;
  - LLMs cannot hear, so automated QA is mandatory and the user is told the mix was not listened to.
- **ElevenLabs:**
  - nothing was live-tested;
  - v4 is 3 days old; v3 has no stitching;
  - v3/v4 ignore `<break>`; tags appear in the alignment;
  - pricing, tiers and formats change (PCM needs Pro);
  - the v4 promo ends Oct 12.
- **French local voice quality is thin** (one Kokoro FR voice; Piper is robotic). Set expectations, or offer GPU engines.
- **Model and binary downloads** get truncated through proxies (verify size or hash and resume). The espeak path must be under 160 bytes. onnxruntime postinstall needed `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`.
- **Export:**
  - Resolve 20's FCPXML ceiling is undocumented;
  - xmeml center units, sign and rotation sign are empirical;
  - Resolve gain keyframes and markers from xmeml/OTIO are unverified;
  - Premiere OTIO metadata is reverse-engineered;
  - absolute paths break across machines;
  - export folders are large (ProRes overlays);
  - non-portable effects become flattened renders;
  - Resolve free on Linux lacks H.264/AAC.
- **LLM (Opus 5.5):**
  - thinking can't be disabled; forced `tool_choice` returns 400; default effort is medium;
  - classifier refusals on crime/abuse topics (use `fallbacks:"default"`);
  - preserved thinking requires an append-only harness;
  - citations combined with structured output return 400;
  - `encrypted_content` must be echoed back;
  - web_fetch only fetches URLs already seen and has no JavaScript;
  - beat slicing may not reproduce the narration exactly (keep the validator and splitter fallback);
  - schema limits (24 optional, 16 unions).
- **Cost:**
  - about $5–10 per 30-min script, about $2 per ElevenLabs take, about $2.5 per rerank pass;
  - AI video about $0.06–0.17 per second;
  - visual QA loops can run away, so set budgets (sample scenes; full review only for transitions and hero shots).
- **Over-decoration fatigue:** without density budgets, cooldowns and calm stretches, the auto-editor will over-decorate. The motion-graphics skill's "purposeful chaos" default is wrong for 15–30 min.
- **Scale:** templates only partially cover a 30-min video. Hero codegen needs a hard cap (35–50 cues) and the bounded-judge pattern.
- **HyperFrames registry:** only 228 of 413 blocks have typed variables, so they need parameterising before ports. Some 3D textures have unconfirmed origin. The tool moves fast (pin versions; the FrameAdapter API is experimental v0).

### 9.3 Environment side effects found during research

These need user action.

- **`npx hyperframes init` (run in the scratchpad) silently installed 10 global skill folders** into `/root/.claude/skills/` and `/root/.agents/skills/` (hyperframes, -animation, -audio, -cli, -core, -creative, -keyframes, -registry, -studio, media-use). It also wrote `/root/.agents/.skill-lock.json` and `/root/.hyperframes/config.json` (`telemetryEnabled:true`, anonymousId).
  - The router skill calls itself the "mandatory entry point… default output framework" for any video request, which conflicts with the Remotion decision. These skills are visibly loaded in current sessions.
  - Cleanup was blocked by permissions. **The user should delete these paths manually.**
  - For any future HyperFrames tool use: `HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1` and an isolated `HOME`.
- **Privacy slip:** one Wikimedia test request sent a User-Agent containing the user's email address. The app must read its contact string from config or env and never embed personal data by default.
- `/home/user/DocumentaryMaker` was not modified by any report.

### 9.4 Contradictions ledger

| # | Topic | Reports disagree | Resolution |
|---|---|---|---|
| 1 | Flash intensity | 0.8–1.0 for 2–4f (editing) vs cap 0.5, "reads as a dropped frame" (lemo) vs 0.45/0.2 s (PDoom) vs 0.2/2f (pushCut) | Routine accents 0.2–0.45, hard cap 0.5. Up to 0.9 only for explicit camera flash, REVEAL or flashback entry, 2–4f, ≤ 1/min |
| 2 | Transition whooshes | "No noise whooshes" (kinetic) vs heavy whooshes in drama | Per-style budget: drama 8–15 SFX/min, ≤ 50% of cuts, no repeats, round-robin |
| 3 | Bounce/overshoot | Banned (HF) vs stamp/slap/pop (lemo, motion-graphics) | Whitelisted impact components only, drama-type styles only |
| 4 | Punch-in magnitudes | 5% / 6% / 8% / 11% / 12–25% | Distinct techniques (zoom cut, cut accent, plate punch, beat punch, camera move); see §4.3 |
| 5 | Ducking depth and timing | −8 dB (lemo) / −12 dB (HF) / 0.32→0.09 (tts) / 10–15 dB | −12 dB music, −4 dB SFX, −80/+120 ms window, 150/400 ms attack/release, bridge < 0.6 s; style range 8–15 dB |
| 6 | Master TP and LRA | −1.2 / −1 / −2 dBTP; LRA 8 vs 11 | Target −1.5, gate ≤ −1.0 post-AAC; LRA 11 (8 optional) |
| 7 | Speech pace | 150 wpm (HF/vox) vs 183–210 wpm (drama) | Character budget per style and voice (16–16.5 chars/s for drama TTS) |
| 8 | ASR engine | whisper.cpp turbo (Remotion) vs faster-whisper (TTS, measured) | faster-whisper default; whisper.cpp with `-nfa` as fallback |
| 9 | `splitOnWord` | In the API (Remotion) vs breaks whisper-cli 1.8 (verified) | Never pass `true`; use `-sow` |
| 10 | Fonts | `@remotion/google-fonts` vs self-host | Self-host (`@fontsource`, `@remotion/fonts`) |
| 11 | GL value | `'swiftshader'` vs `'swangle'` | `'swangle'` (verified) |
| 12 | Primary export | OTIO (Remotion) vs FCPXML + xmeml (timeline report) | FCPXML 1.10 + xmeml v4 primary; OTIO secondary |
| 13 | Chunk audio | Seamless AAC concat (Remotion) vs AAC joins drift (motion-graphics) | Muted video chunks + one offline master WAV muxed once (verify combineChunks without audio) |
| 14 | Transition types per film | 2–3 (HF) vs about 5 (drama) | Primary + 1–2 accents per act; drama ≤ about 5 per film; never 3 alike in a row |
| 15 | Caption zone | Bottom 12% kept free vs rail at y≈980 | Style `captionBand`/`keepOut`; drama band about y 760–900 |
| 16 | Effects host components | `<Img>`/`<AnimatedImage>` vs `<Video>/<CanvasImage>/<Solid>/<HtmlInCanvas>` | Trust the `.d.ts` list; use `<CanvasImage>` for stills; verify `<Img>` with tsc |
| 17 | Local TTS fallback | `npx hyperframes tts` vs direct engine | sherpa-onnx-node direct |
| 18 | ElevenLabs speed | 0.7–1.2 vs 0.25–4.0 | Clamp 0.7–1.2; verify |
| 19 | ElevenLabs Music length | up to 600,000 ms vs "3 s–5 min" | Open; assume ≤ 5 min per call |
| 20 | HF SFX pack size | 21 vs 19 files | Open; count at port |
| 21 | Light leaks | `@remotion/light-leaks` (type-checked) vs dropped in 5.0 | Use `@remotion/effects` `lightLeak` |
| 22 | Claude pricing | $4/$20 and cache $0.20 (both reports) | Consistent; confirmed by the skill |

### 9.5 Open items to verify before or during implementation

1. Live ElevenLabs test: with-timestamps alignment quality, stitching, PCM tiers, v4 behaviour, speed range, music length limit.
2. `combineChunks` with muted chunks, or the ffmpeg concat demuxer; frame-exact mux of the offline master.
3. Real NLE smoke tests: xmeml center/rotation sign; FCPXML still start (3600 s); Resolve gain keyframes and markers from xmeml/OTIO; Resolve 20 FCPXML 1.11 acceptance.
4. yt-dlp download path on a residential machine with bgutil, `--js-runtimes node`, mweb.
5. Pacing calibration (`scdet`) on user-supplied reference videos for each style preset.
6. `@remotion/effects` licence terms for commercial use; `effects` prop support on `<Img>`.
7. Kokoro FR (`ff_siwis`) and Piper FR voices: a human listening pass (nobody has listened to any audio).
8. Whisper word timing on real French speech against the 80 ms caption tolerance; calibrate the `t_dtw` offset per model.
9. HF SFX pack inventory and the Pixabay licence notes per file.
10. Remotion 5.0 release timing and licence changes before any commercial or SaaS launch.