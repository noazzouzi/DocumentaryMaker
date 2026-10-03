# DocumentaryMaker — Architecture Specification v2 (final)

| | |
|---|---|
| Status | **v2, normative, final.** Supersedes `SPEC.v1.md`. Agents implement exactly what is written here. The core contract (§4) is frozen during P1; contract defects go to `docs/ISSUES.md` and are applied by the integration agent (§0.4). |
| Date | 2026-10-02 |
| Author | Lead architect |
| Inputs | `$SP/brief.md` (consolidated research), `$SP/report-*.md`, the verified prototypes (Appendix C), the v1 draft and four critic reviews (feasibility, editing quality, data model, product/safety) — every issue is resolved in Appendix E |
| Audience | One foundation agent (F), 11 work-package agents (W1–W11) working in parallel, one integration agent (I) |
| Target repo | `/home/user/DocumentaryMaker` (empty except `.git`; paths below are relative to its root) |
| Verified contract | The §4 code blocks are byte-identical to `$SP/design/core-v2/src/**` and the §4.19 API stubs to `$SP/design/core-v2/stubs/**`. Both were type-checked with `tsc 5.9.3 --strict` against `zod@4.6.5` (0 errors) and runtime-parsed (`$SP/design/core-v2/check.ts`, all checks pass). **F copies those files instead of re-transcribing this document.** |

**Keywords.** MUST / MUST NOT / SHOULD / MAY are normative. "Verified" means the research container actually ran it (4 vCPU, 16 GB RAM, no GPU, Node 22.22.0, pnpm 10.28.0, Python 3.11, ffmpeg 6.1.1). `$SP` is `/tmp/claude-0/-home-user-DocumentaryMaker/9b2bcdc3-66da-5e55-a3e5-b80d3978051f/scratchpad`. Frame numbers are at 30 fps unless stated otherwise; `F30(n)` = `framesAt(fps, n)`, `S(sec)` = `secToFrames(sec, fps)`. Milestone tags: **M1** = demo-critical slice, **M2** = v1 completion, **M3** = v1 stretch (may slip to roadmap without failing acceptance), **R** = roadmap.

**Guiding principles (from brief §1).**
1. **The engine owns the timeline; the LLM only fills in parameters.** Claude writes research, script and beats into zod-validated JSON drawn from **closed vocabularies**. A deterministic, seeded **director** compiles it into a `Timeline`; a fixed component library renders the `Timeline` with Remotion. In v1 the LLM does not write TSX (R1).
2. **Audio is the clock.** Every timed item is anchored to a script word, segment, beat or chapter id. When the VO changes (scratch take, paid TTS take, another provider, the user's own recording), the pipeline re-lays out the program and re-runs the director.
3. **One timeline drives everything.** The same `Timeline` feeds the Remotion render, the Player preview, the offline mixer, the SRT files, all NLE exporters and the QA linters. No consumer reads upstream documents (picks, beats) to make framing decisions.
4. **Offline-first.** With no API keys and no network, `docmaker demo --offline` produces a real MP4 and a full export bundle from fixture LLM outputs, procedural assets, synthetic VO, a procedural music bed and a procedural SFX pack.
5. **Editorial safety is part of the product.** Claim status, jurisdiction and `as_of`; a research ledger of API-returned URLs only; fact refs on every on-screen quote, headline and number; a fact-check that covers narration AND on-screen text; human acknowledgement gates that cannot be bypassed by edits, flags or manual picks; no photorealistic AI images of real people; no naming or showing of private persons without approval.
6. **User work is never silently lost.** User-authored inputs live in their own files, stage outputs never overwrite them, ids are content-stable or fingerprinted, and every user-editable document keeps a history.

---

## Contents

- 0. Build plan, milestones and operating rules
- 1. Scope
- 2. Toolchain (exact pins)
- 3. Repository layout, entry points and ownership
- 4. The core contract (`packages/core`)
- 5. Pipeline, persistence, idempotence, gates, jobs
- 6. LLM pipeline (`@docmaker/llm`, W2)
- 7. Asset system (`@docmaker/assets`, W3)
- 8. Voice (`@docmaker/voice`, W4) and the Python sidecar
- 9. Layout and director (`@docmaker/director`, W6)
- 10. Remotion package (`@docmaker/remotion`, W7)
- 11. Audio (`@docmaker/audio`, W5)
- 12. Render (`@docmaker/render`, W8)
- 13. Export (`@docmaker/export`, W9)
- 14. Web app (`apps/web`, W11) — Next.js 16 App Router
- 15. CLI and job worker (`apps/cli`, W10) — `docmaker`
- 16. Testing strategy
- 17. Security, legal, operations
- Appendix A — `drama-commentary` style data
- Appendix B — Open items to verify during implementation
- Appendix C — Prototype → destination map
- Appendix D — Engine stage wiring
- Appendix E — Decisions log (every critic issue and its resolution)

---

## 0. Build plan, milestones and operating rules

### 0.1 Phases

| Phase | Who | What | Exit criterion (commands must pass) |
|---|---|---|---|
| **P0 Foundation** (≈ 3 h) | F (one agent) | 1. Root configs (§2.4), every `package.json` with its exact dependencies (§2.3 table), `pnpm install` once.<br>2. **Copy** `$SP/design/core-v2/src/**` into `packages/core/src/` (schemas, interfaces, fonts, ids, paths) and **implement** every utility of §4.18 for real (json, sha256 pure-JS, rng, time, tokenize, anchors, gain, integrity, migrate, errors, project-defaults; `./node`: store, env, home, logger, proc, hash, wav, loudness, locks; `./testing`: factories) with the §16.1 core tests.<br>3. **API stubs**: copy `$SP/design/core-v2/stubs/<pkg>/index.ts` into each package's `src/index.ts`, turning every `declare function f(...): R` into `export function f(...): R { throw notImplemented("f") }` (and `declare class` into a class whose methods throw), so `pnpm typecheck` passes workspace-wide on day one.<br>4. Skeletons: a placeholder Remotion entry (`entry.ts`, `Root.tsx`, a `Documentary` that paints `palette.ink`, chapter titles and a frame counter from a `Timeline`, every `COMPOSITION_ID` registered) so W8 can bundle and render immediately; `apps/cli/src/{main.ts (prints the version), worker.ts (stub)}` + `bin/docmaker.js`; `apps/web` with `next.config.ts` (§14.1), `src/app/layout.tsx` (imports `@docmaker/remotion/fonts`) and `src/app/page.tsx` + a client component importing `@docmaker/remotion` and `@docmaker/remotion/compute`.<br>5. Chrome Headless Shell: `cp -a $SP/rtest/node_modules/.remotion <repo>/node_modules/.remotion`, write `docs/DEV.md` with the absolute executable path for `DOCMAKER_BROWSER_EXECUTABLE`.<br>6. Smoke tests (`pnpm smoke`, §2.4): (a) `bundle()` of `@docmaker/remotion/entry` + render of a 3-chunk `makeTimeline({seconds:5})` concatenated to 150 frames; (b) `next build` of the skeleton web app whose page imports `@docmaker/remotion`, `@docmaker/remotion/compute` and `@docmaker/core`.<br>7. `scripts/check-*.mjs`, `docs/{CONTRACT-CHANGES,ISSUES,DEV,EXTENDING}.md`, initial git commit. | `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm check:deps && pnpm smoke` |
| **P1 Packages** (parallel) | W1–W11 | Each agent delivers its **M1 slice first** (§0.3), then M2. Agents work only inside their owned paths (§0.2) and test against `@docmaker/core/testing` factories and other packages' stubs/fakes. W10 keeps a **walking-skeleton e2e** (`tests/e2e/skeleton.e2e.test.ts`) green from hour 1: stages call package APIs through thin adapters with in-test fakes; real implementations replace fakes as each M1 lands. | per package: `pnpm --filter @docmaker/<pkg> typecheck && pnpm --filter @docmaker/<pkg> test` (W7, W8 add `pnpm --filter @docmaker/<pkg> test:render`) |
| **P2 Integration** | I (+ W10) | Real packages end to end: the offline demo e2e (§16.4) green; apply queued contract changes from `docs/ISSUES.md`; fix cross-package defects (owners fix their packages). | `pnpm typecheck && pnpm test && pnpm test:render && pnpm test:e2e` |
| **P3 Hardening** | all | M2/M3 breadth, `pnpm lint --max-warnings=0`, web flows, Playwright smoke, docs, doctor/setup polish | everything in §1.3 |

### 0.2 Work packages and ownership

| Id | Owns (exclusive write access) | Depends on (public API only) |
|---|---|---|
| F | root configs, `scripts/`, `docs/` (initial), `packages/core/**`, every `package.json`, `pnpm-lock.yaml`, the P0 skeleton files of every package | — |
| W1 | `packages/styles/**` (incl. `builtin/*/style.json`, STYLE.md, GUIDE.md, prompts.json) | core |
| W2 | `packages/llm/**`, `fixtures/**` | core, styles (types only) |
| W3 | `packages/assets/**`, `python/docmaker_sidecar/cmd_cuts.py` | core |
| W4 | `packages/voice/**`, `python/pyproject.toml`, `python/uv.lock`, `python/docmaker_sidecar/{__init__,__main__,cmd_asr,cmd_piper_align}.py` | core |
| W5 | `packages/audio/**`, `python/docmaker_sidecar/{cmd_beats,cmd_energy}.py` | core |
| W6 | `packages/director/**` | core (styles as devDependency for tests) |
| W7 | `packages/remotion/**` (replaces the P0 placeholder) | core |
| W8 | `packages/render/**` | core, remotion (`./entry`, `./compute`) |
| W9 | `packages/export/**` | core |
| W10 | `packages/engine/**`, `apps/cli/**`, `tests/e2e/**` | everything above (stubs until each M1 lands) |
| W11 | `apps/web/**` (replaces the P0 skeleton) | core, styles, engine, remotion |
| I | anything, after P1; owns `docs/CONTRACT-CHANGES.md` and applies `docs/ISSUES.md` | — |

### 0.3 Milestones and cut list

M1 is what the offline demo needs; every agent delivers its M1 before starting M2. Components or features not yet implemented MUST degrade as stated, never crash.

| Package | M1 (demo-critical) | M2 (v1 completion) | M3 (stretch) / R |
|---|---|---|---|
| core (F) | everything in §4 | — | — |
| styles (W1) | drama-commentary `style.json`/MD/prompts, `discoverStyles`, `loadStyleDir`, `validateStyleData`, `suggestStyleOffline` | user style dirs (`<home>/styles`), `scaffoldStyle`, style fonts (M2) | `cinematic-essay`, `true-crime-dossier` presets (M3) |
| llm (W2) | `FixtureLlm`, wire schemas + mappers + coercions, `planBudget`, `lintScript`, `validateBeats` (incl. fact refs), `splitBeatsFallback`, `syntheticBeats`, `deterministicFactChecks`, `computePlanKey`, the tulip-mania fixture (EN+FR) | live Anthropic client (structured, streaming, refusal fallback, research harness with resume), every step function, reranker, passage pick, recheck, cost estimates | — |
| assets (W3) | `HttpClient` (offline refusal), procedural + local providers, conform image/video, `FrozenCache`, `LicensePolicyEngine`, `validatePick`, ledger, `resolveAssets` (offline path), `buildCredits` | keyless online providers (Openverse, Wikimedia+Wikidata, IA, NASA, LOC), Pexels, Pixabay, live search/freeze/upload, manual clips, YouTube json3 + passage finder + error mapping (unit-tested), `verifyQuotes`, `resolveEntity` | yt-dlp download path (needs a residential machine to validate, Appendix B), Brave, fal, CLIP (installed into `<home>/ml` by `setup --clip`), vision rerank tuning (M3) |
| voice (W4) | `buildTtsText`, `numberToWords`, synthetic provider, estimated aligner, post chain, `synthesizeTrack` (scratch + final), deterministic take ids, `voiceLicense` | ElevenLabs (with-timestamps, stitching), Kokoro/Piper via sherpa (createRequire), faster-whisper sidecar, NW aligner, recording import (global + per-segment), pickup TTS, calibrate, teleprompter HTML | whisper.cpp fallback (M3) |
| audio (W5) | procedural SFX subset used by the director (whoosh.light/whip/up, riser, impact, boom.sub/low, thud, pop, click, tick, ding, shutter, paper, keys, glitch, bleep, drone, ambience.room), manifest analysis, procedural music, `assembleVoProgram`, `mixTimeline`, two-pass loudness | the full procedural pack, library scan (+ beats sidecar), optional packs | — |
| director (W6) | the full algorithm of §9 (layout + direct + lint + overrides) | — | — |
| remotion (W7) | Still/Video/Generated layers, `card` layout, camera rig, cut accents (pulse/flash/velocity whip/zoomThrough/pushCut), covers flash/dip/glitch, overlap dissolve, components LowerThird, ChapterCard, TitleSting, NumberCounter, DateStamp, MapPin, DocumentCard, KineticText, KeywordSlam, Stamp, SourceLabel (+ `FallbackCard` for the rest), keyword + pop captions, grade/treatments/vignette, fonts, `computeTimeline`, `planChunks`, `sliceHash` | every other component (QuoteCard, SocialPost, ArticleHighlight, HeadlineStack, TimelineGraphic, BarChart, SplitScreen, CensorBar, Spotlight, Letterbox, FreezeLabel, PhotoBurst, EvidenceBoard, CommentPile), PiP frame styling, contain-blur, split, covers lightLeak, karaoke/rail captions, `StyleSpecimen` | filmBurn, paperRip, dotWipe, iris, whipStreaks covers (until then the director maps them, `DEFERRED_TRANSITIONS`), push/wipe/blurDissolve overlaps (M3) |
| render (W8) | bundle cache, browser executable, chunked muted h264-ts renders, concat, mux, post-AAC loudness gate, stills + contact sheets, generated stills, GL probe | master post (grain + `lut3d`), progress/cancel polish | ProRes 4444 overlay renders (M3) |
| export (W9) | every writer (prototyped), conform for NLE, bundle README, SRT | publish kit, editorial report | — |
| engine + cli (W10) | stages, store integration, hashing/staleness, gates (fixture auto-approve), job runner (in-process), `runDemo`, CLI `demo/doctor/run/status/setup --browser` | forked job worker, every CLI command, crash reconciliation, coalescing, resume, impact, pipeline estimates, keys | — |
| web (W11) | — (M1 has no web dependency) | overview, new (offline suggestion + style confirm), outline, script (+ fact-check panel), scenes, voice, preview, render/export, credits, settings/setup, styles gallery, jobs/SSE, host guard, licence card, EN/FR UI | Playwright smoke (M3), in-browser teleprompter recorder (M3), publish page (M2) |

### 0.4 Parallel-agent operating rules (normative)

1. **Ownership.** Write only inside your owned paths (§0.2). Never edit `packages/core/**`, any `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `eslint.config.js` or `turbo.json`. A blocking contract defect → an entry in `docs/ISSUES.md` (`## <date> <pkg> → <target>` + problem + proposed diff) and a local adapter inside your own package; I applies contract changes after P1 and logs them in `docs/CONTRACT-CHANGES.md`.
2. **Dependencies.** Never run `pnpm add`, `pnpm install`, `pnpm update` or `npm install`. Every dependency of §2.3 is installed in P0. A missing dependency is an `ISSUES.md` entry; I batches installs.
3. **Git.** Stage only your own paths: `git add -- <owned paths>` then `git commit -m "<pkg>: <summary>"`. If `.git/index.lock` exists, wait 2 s and retry (≤ 10 times). Never `git add -A`, `git stash`, `git reset`, `git checkout -- <others' files>`, rebase or force-push. Commit trailer per the session attribution rules.
4. **Machine resources (4 vCPU, 16 GB).** Only W7, W8, W10 and I run Chrome. Every render or bundle MUST go through `withFileLock(config.renderLockFile)` (default `/tmp/docmaker-render.lock`) with `concurrency ≤ 2` during P1. Unit tests (`pnpm test`) never launch Chrome; render tests live in the `render-int` vitest project (`test:render`).
5. **Homes and ports.** Each agent exports `DOCMAKER_HOME=/tmp/docmaker-home-<pkg>` and `DOCMAKER_PROJECTS=/tmp/docmaker-projects-<pkg>`, plus `DOCMAKER_BROWSER_EXECUTABLE=<path from docs/DEV.md>` (shared Chrome, never re-downloaded). Asset servers bind port 0. W11 uses ports 3210–3219, I uses 3220–3229.
6. **Network.** Tests MUST pass without network. Tests that need network or keys are skipped unless `DOCMAKER_LIVE_TESTS=1`.
7. **Repo files** (fixtures, builtin styles, workers, DTDs, calibration text) are located from `config.repoRoot` (§4.17), **never** through `import.meta.resolve` (fails in Turbopack server bundles) or relative `__dirname` guesses.
8. **Determinism.** No `Date.now()`/`Math.random()` in director, remotion or any hashed output; use `rngFor(seed, key)`.

### 0.5 Phase gates (commands)

| Gate | Command |
|---|---|
| P0 exit | `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm check:deps && pnpm smoke` |
| P1 per package | `pnpm --filter @docmaker/<pkg> typecheck && pnpm --filter @docmaker/<pkg> test` (+ `test:render` for remotion/render) |
| P2 exit | `pnpm typecheck && pnpm test && pnpm test:render && pnpm test:e2e` |
| P3 exit | P2 + `pnpm lint` (`--max-warnings=0`) + `pnpm --filter @docmaker/web build` + (M3) `pnpm --filter @docmaker/web test:ui` |

---

## 1. Scope

### 1.1 v1 deliverable

v1 is a pnpm monorepo with a TypeScript engine and two front ends: a CLI (`docmaker …`) and a Next.js 16 web app. Given an idea such as « La rupture catastrophique de Johnny Depp » and a target length (15–30+ min), it produces the following.

1. **Research** (Claude with `web_search_20260209` + `web_fetch_20260209`, resumable `pause_turn` harness): a cited dossier, a source registry built **only** from URLs the API returned, and a structured `FactSheet` (sources, people, events, quotes, figures, claims with status, jurisdiction and `as_of`). Quotes are verified in code against the fetched pages; Wikidata ids are resolved in code.
2. **Style suggestion and confirmation**: a free offline ranking at idea time (`suggestStyleOffline`), optionally refined by one cheap Claude call after research; the user confirms the style before the outline (gate `style-confirm`). Styles are **data-only directories** discovered at runtime (built-in + `<home>/styles`). v1 ships **`drama-commentary`** (complete) plus `cinematic-essay` and `true-crime-dossier` (data presets, M3).
3. **Outline** from a budget computed in code (`planBudget`, per language). Approval is a **human gate** that requires the user to confirm the thesis.
4. **Script**, written natively per project language (FR and/or EN), chapter by chapter with prompt caching; segments `narration | clip | sponsor_slot | music_breath`; `displayText` ≠ `ttsText`; deterministic lint + ≤ 2 LLM revision rounds; FR/EN segment-skeleton parity is a hard invariant.
5. **Beats**: one beat = one visual idea = an exact slice of the narration. A language-neutral `BeatPlan` (ids assigned in code, `planKey` fingerprint) plus per-language `BeatLang` slices. Every on-screen quote, headline and number carries a fact reference that is checked against the FactSheet.
6. **Fact-check / lawyer pass** over narration **and on-screen text** and the title/thumbnail, with deterministic rules; acknowledging every high-risk item is a **human gate** that blocks paid/real voice takes, render and export, and is re-armed whenever the script or on-screen text changes.
7. **Assets**: provider registry, licence policy (server-side re-checked on every pick, override and upload), content-addressed frozen cache, ledger and credits. Keyless: Openverse, Wikimedia Commons (+ Wikidata P180), Internet Archive, NASA, LOC. Free key: Pexels, Pixabay. Paid when a key is set: Brave, fal FLUX (never for real people). Plus local import with a licence declaration, a deterministic `procedural` provider, and **YouTube via local yt-dlp** (search, json3 transcripts, passage finding, cut with handles, CFR transcode) with manual URL/file fallbacks.
8. **Voice**: a free **scratch take** (synthetic provider, exact timings) for previewing before paying; ElevenLabs `/with-timestamps` with stitching; local sherpa-onnx Kokoro/Piper; the user's own recording (faster-whisper sidecar or whisper.cpp, Needleman–Wunsch alignment, per-segment re-recording, pickup TTS for missing segments); voice licences in the credits.
9. **Layout → Director → Timeline**: the program clock from VO and clip durations (chapter-tiled beats, REVEAL pre-pauses); a deterministic seeded director with energy-modulated pacing, still layouts (cover/card), Ken Burns at matched speed, punch-ins with floors and focal origins, three transition classes with a quota, salience arbitration, genre components (evidence cards with VO-synced sub-beats, title sting, photo burst, freeze-label, evidence board, comment pile), selective keyword captions, SFX by peak with floors and budgets, reveal sequences, music sections on downbeats, montage mode and J/L cuts. Output: a word-anchored `Timeline` in integer frames.
10. **Remotion 4.0.532 rendering** in-process (CLI) or in a forked job worker (web): bundle once per code hash, chapter-aligned muted chunks cached by a chunk-relative slice hash, concat, one master-audio mux, post-AAC true-peak gate; presets `draft` and `master` (grain + LUT via ffmpeg post).
11. **Offline audio mixer** in Node, driven by the same gain tables as the Player preview: VO program (gain baked), ducking, SFX by peak (loops, fades, pan sweeps), music sections, silences (incl. bleeps), two-pass loudness to −14 LUFS, true-peak gate ≤ −1.0 dBTP after AAC, four stems.
12. **Exports** (decoupled from the render): FCPXML 1.10, xmeml v4 (`premiere`, `resolve`), OTIO JSON, Resolve marker EDL, SRT per language, stems, README, publish kit and editorial report; reference MP4 only when an up-to-date render exists.
13. **QA**: timeline lint, readability, density floors and caps, visual-change checks, ffprobe, blackdetect/freezedetect, ebur128, contact sheets.
14. **Web app**: setup/onboarding → new project (instant style suggestion) → research and outline approval → script editor with fact-check panel → scene board with asset picker → voice → Player preview synced with the script → render and exports → credits → publish → settings/keys. Engine reads in-process; jobs run in a forked worker; progress over SSE.
15. **CLI**: `docmaker new|status|research|style|outline|script|beats|factcheck|approve|persons|assets|voice|layout|direct|mix|preview|render|export|qa|run|jobs|cost|credits|keys|demo|doctor|setup|cache` (§15).

### 1.2 Out of scope for v1 (roadmap, "R")

| ID | Roadmap item | Notes |
|---|---|---|
| R1 | LLM-authored "hero" motion graphics (TSX) | planner (xhigh) → builder (medium) → judge (high), lint, `renderStill` probes, render-twice-diff. v1 ships the determinism lint and import whitelist. |
| R2 | Claude-vision visual QA loop | v1 generates the contact sheets only |
| R3 | `vox-collage` style | 12 fps stepped elements, paper, technique floors |
| R4 | 2.5D parallax and person cut-outs (`cutout` layout) | rembg, Depth-Anything-V2-Small; MediaPipe face boxes as punch origin |
| R5 | MapLibre real-map fly-throughs | v1 has an offline d3-geo `MapPin` |
| R6 | Speed ramps | ffmpeg `setpts` + `atempo` pre-renders. (Freeze-frame + label and photo burst moved INTO v1.) |
| R7 | Music jump-cut retimer for library tracks | beat-synced chroma + MFCC |
| R8 | Paid generation beyond images | ElevenLabs Music/SFX, Stable Audio, image-to-video |
| R9 | Recording post | filler/silence jump-cuts, pause tightening |
| R10 | `.otioz`, DNxHR/ProRes mezzanine conform, kinetic captions as one ProRes track | |
| R11 | Batch API for reranks | −50 %; the server-side fallback is rejected on Batches |
| R12 | Multi-user auth, remote/GPU render farm, Lambda | |
| R13 | 9:16 cuts, YouTube upload | (description chapters ship in the v1 publish kit) |
| R14 | Frequency-band sidechain carve on the music bed | |
| R15 | HyperFrames-rendered alpha inserts | ideas may be ported; the CLI is never used |
| R16 | Pacing calibration from reference videos | `scdet` → shot-length distribution stored in the style |
| R17 | Emoji captions (brief: drama only, ≤ 1 per 20–30 s) | needs an emoji font and a curated mapping |
| R18 | Shader (HtmlInCanvas) transitions, `@remotion/effects` LUT in-browser | v1 is CSS/SVG only; LUT via ffmpeg |
| R19 | Native Windows | WSL2 only in v1 (§1.4) |
| R20 | Unsplash, Freesound, Flickr, Jamendo providers | documented in `docs/EXTENDING.md` |
| R21 | Style-private React components | v1 styles are data-only |

### 1.3 v1 acceptance criteria

1. On a clean checkout (Linux x64 or macOS) with Node 22.12+, pnpm 10 and ffmpeg ≥ 6.1: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm test:render` pass.
2. With **zero API keys, Python not set up, no TTS model, and `HTTP_PROXY`/`HTTPS_PROXY` pointed at a dead port** (Chrome pre-provisioned), `pnpm test:e2e` runs `runDemo({fixture:"tulip-mania", langs:["en"], offline:true, tts:"synthetic", preset:"draft", onlyChapters:["CH1","CH2"]})` and produces:
   - an H.264/AAC MP4 whose duration is within ±1 frame of the timeline;
   - integrated loudness −14 ± 1 LUFS and true peak ≤ −1.0 dBTP measured on the AAC output;
   - an export bundle (FCPXML, xmeml premiere, OTIO, marker EDL, SRT, stems, README, credits); XML validates against the vendored DTDs when `xmllint` is present;
   - no network access at all (any stray request fails fast through the dead proxy and fails the test).
3. The same demo with `langs:["fr"]` renders the French script on the same visual plan; `["en","fr"]` renders both.
4. `direct` twice on identical inputs → byte-identical `timeline/<lang>.json`; a forced no-op re-run of any stage leaves every file byte-identical and marks nothing downstream stale (docHash rule, §5.3).
5. With `ANTHROPIC_API_KEY` set, `docmaker run <slug> --to render` (after the style, outline and fact-check gates) produces a 15–30 min documentary without code changes (manual check, not CI).
6. In the web app: create a project, see an instant style suggestion and confirm it, run stages with live progress, edit/approve the outline, edit the script, acknowledge fact-check items, swap an asset, preview with a scratch take and seek from a script word, render, export timeline-only, download.
7. The safety suite passes (§16.6): editorial gates cannot be satisfied by `--yes`; editing the script after acknowledgement re-arms the gate; AI-generated or unknown-licence assets cannot be placed on person beats via picks PUT, overrides or uploads; private persons are never named on screen or searched without `person-ack`; the User-Agent carries no contact outside the allowlist.

### 1.4 Supported platforms

| Platform | v1 status |
|---|---|
| Linux x64 (glibc) | supported; reference platform (CI) |
| macOS arm64 / x64 | supported (CI: unit tests + draft e2e) |
| Windows | **WSL2 only**; `doctor` detects native Windows and prints the WSL2 instructions |

Rules that follow: paths via `node:path` (never string concatenation); process-group cancel uses POSIX `kill(-pid)` (§4.18 `killTree`); the venv binary is `<pyVenv>/bin/python`; hardlinks fall back to copies; `tar -xjf` is replaced by Node streaming bz2 extraction only if `tar` is missing (doctor checks `tar`).

---

## 2. Toolchain (exact pins)

Every version below was re-checked on the npm registry on 2026-10-02 (`npm view <pkg>@<version> version`, all resolve).

### 2.1 Runtime and tooling

| Tool | Version | Notes |
|---|---|---|
| Node.js | **22.22.x** | `engines.node: ">=22.12.0 <23"`, `.nvmrc` = `22`. Required by vitest 5 (`^22.12.0`); fine for Next 16 (`>=20.9`). Processes that make HTTP requests are started with `NODE_USE_ENV_PROXY=1` when a proxy variable is set (built-in `EnvHttpProxyAgent`, verified on 22.22.0); TLS verification is never disabled. |
| pnpm | **10.28.0** | `packageManager: "pnpm@10.28.0"`, workspaces |
| TypeScript | **5.9.3** (exact) | §2.2 |
| tsx | 4.23.15 | runs the CLI, the job worker and scripts from source |
| vitest | 5.0.3 (+ `vite` 8.3.2 explicit, a vitest 5 peer) | project negation (`--project '!e2e'`) verified |
| turbo | 2.11.6 | `typecheck`, `build` caching |
| eslint | 10.11.0 + `typescript-eslint` 8.71.0 + `eslint-plugin-react-hooks` 7.1.1 + `@next/eslint-plugin-next` 16.3.8 + `@remotion/eslint-plugin` 4.0.532 | flat config |
| prettier | 3.9.9 | formatting only; not a gate |
| Playwright | `@playwright/test` 1.63.0 | web smoke (M3); browsers installed by `pnpm --filter @docmaker/web exec playwright install chromium` only on demand |
| Python | 3.11 via **uv** | optional sidecar (§8.8); never required by the offline demo |
| ffmpeg / ffprobe | system, **≥ 6.1** | required filters: `afftfilt aevalsrc anoisesrc gradients life drawgrid noise colorchannelmixer vignette loudnorm ebur128 silencedetect silenceremove acrossover blackdetect freezedetect scdet tile lut3d` + `libx264` + `aac`; `doctor` checks them |
| xmllint | system (optional) | DTD tests skip when absent |

### 2.2 TypeScript version decision: pin **5.9.3**

`latest` on npm is 7.0.2 (native Go compiler, different programmatic API); 6.0.x is transitional. We pin **5.9.3** because:
1. every research prototype and this spec's contract were type-checked with 5.9.3 (`$SP/design/core-v2`, `$SP/script-pipeline`, `$SP/tts/node`);
2. `typescript-eslint@8.71.0` declares `typescript >=4.8.4 <6.1.0` (7.x unsupported);
3. Next 16's build-time type-check and the Remotion/React type packages are exercised against the 5.x compiler API;
4. 6.0 changes defaults and gives no feature we need.

Upgrade path: after v1, try 6.0.x on a branch; re-evaluate 7.x when typescript-eslint and Next declare support.

### 2.3 Dependencies per package (exact pins; `save-exact=true`). F installs all of them in P0.

| Package | `dependencies` | `devDependencies` / `optionalDependencies` |
|---|---|---|
| root | — | `typescript@5.9.3`, `tsx@4.23.15`, `vitest@5.0.3`, `vite@8.3.2`, `turbo@2.11.6`, `eslint@10.11.0`, `typescript-eslint@8.71.0`, `eslint-plugin-react-hooks@7.1.1`, `@next/eslint-plugin-next@16.3.8`, `@remotion/eslint-plugin@4.0.532`, `prettier@3.9.9`, `@types/node@22.20.5`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, and `workspace:*` on `@docmaker/core`, `@docmaker/engine`, `@docmaker/render`, `@docmaker/remotion`, `@docmaker/cli` (the root e2e tests and `eslint.config.js` import them; pnpm does not hoist workspace packages) |
| `@docmaker/core` | `zod@4.6.5` | — |
| `@docmaker/styles` | `@docmaker/core` | — |
| `@docmaker/llm` | `@docmaker/core`, `@docmaker/styles` (types), `@anthropic-ai/sdk@0.131.0`, `zod@4.6.5` | — |
| `@docmaker/assets` | `@docmaker/core`, `p-limit@7.3.3`, `p-retry@8.0.1`, `sharp@0.35.5`, `@mozilla/readability@0.6.0`, `linkedom@0.18.13` | — (CLIP's `@huggingface/transformers` is **not** a workspace dependency: `docmaker setup --clip` installs it into `<home>/ml`, M3) |
| `@docmaker/voice` | `@docmaker/core`, `@elevenlabs/elevenlabs-js@2.70.0`, `@remotion/install-whisper-cpp@4.0.532` | optional: `sherpa-onnx-node@1.13.8` (loaded with `createRequire(import.meta.url)("sherpa-onnx-node")`, never on the demo path) |
| `@docmaker/audio` | `@docmaker/core` | — |
| `@docmaker/director` | `@docmaker/core` | dev: `@docmaker/styles` |
| `@docmaker/remotion` | `@docmaker/core`, `remotion@4.0.532`, `@remotion/media@4.0.532`, `@remotion/transitions@4.0.532`, `@remotion/paths@4.0.532`, `@remotion/noise@4.0.532`, `@remotion/layout-utils@4.0.532`, `@remotion/fonts@4.0.532`, `react@19.3.0`, `react-dom@19.3.0`, `d3-geo@3.1.1`, `topojson-client@3.1.0`, `world-atlas@2.0.2`, `@fontsource/{anton,archivo-black,inter,jetbrains-mono,instrument-serif,courier-prime,special-elite}@5.3.0` | dev: `@types/d3-geo@3.1.1`, `@types/topojson-client@3.1.5` |
| `@docmaker/render` | `@docmaker/core`, `@docmaker/remotion`, `remotion@4.0.532`, `@remotion/bundler@4.0.532`, `@remotion/renderer@4.0.532`, `sharp@0.35.5` | — |
| `@docmaker/export` | `@docmaker/core`, `xmlbuilder2@4.0.3` | dev: `fast-xml-parser@5.11.2` |
| `@docmaker/engine` | `@docmaker/{core,styles,llm,assets,voice,audio,director,export}` | dev: `@docmaker/remotion` (types in tests only) |
| `@docmaker/cli` | `@docmaker/{core,engine,render,styles}`, `commander@15.0.0` | — |
| `@docmaker/web` | `@docmaker/{core,engine,styles,remotion}`, `@remotion/player@4.0.532`, `remotion@4.0.532`, `next@16.3.8`, `react@19.3.0`, `react-dom@19.3.0`, `tailwindcss@4.3.3`, `@tailwindcss/postcss@4.3.3`, `server-only@0.0.1` | dev: `@playwright/test@1.63.0` |

`scripts/check-remotion-versions.mjs` fails when any `remotion`/`@remotion/*` version differs from 4.0.532. `scripts/check-deps-graph.mjs` fails when a package imports a workspace package outside its §3.2 edges or core/remotion code reachable from a browser entry imports `node:*`.

**Forbidden dependencies** (`scripts/check-forbidden-deps.mjs`): `gsap`, `@remotion/gsap` (licence clause), `p5` (LGPL), `@remotion/google-fonts` (proxy failures; we self-host), `@remotion/light-leaks` (dropped in 5.0), `kokoro-js` (FR truncation bug), `youtubei.js` (transcripts 400), `@imgly/background-removal` (AGPL), the `pexels` npm package (stale), `elevenlabs` (legacy SDK), `dotenv` (core parses env files), `mediabunny` (ffprobe suffices), `@huggingface/transformers` and `onnxruntime-node` **as workspace deps** (300 MB + GPU postinstall), WhisperX, the HyperFrames CLI and skills, any PDoomVideo code.

### 2.4 Root files

`pnpm-workspace.yaml`
```yaml
packages:
  - "packages/*"
  - "apps/*"
onlyBuiltDependencies:
  - esbuild
  - sharp
  - sherpa-onnx-node
```

`.npmrc`
```
save-exact=true
auto-install-peers=true
strict-peer-dependencies=false
engine-strict=true
```

`package.json` (root)
```json
{
  "name": "documentarymaker",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.28.0",
  "engines": { "node": ">=22.12.0 <23" },
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "eslint . --max-warnings=0",
    "test": "vitest run --project '!e2e' --project '!render-int'",
    "test:render": "vitest run --project render-int",
    "test:e2e": "vitest run --project e2e",
    "test:watch": "vitest --project '!e2e' --project '!render-int'",
    "smoke": "tsx scripts/smoke.ts",
    "docmaker": "tsx apps/cli/src/main.ts",
    "demo": "tsx apps/cli/src/main.ts demo --offline",
    "dev:web": "pnpm --filter @docmaker/web dev",
    "setup": "tsx apps/cli/src/main.ts setup",
    "doctor": "tsx apps/cli/src/main.ts doctor",
    "check:deps": "node scripts/check-remotion-versions.mjs && node scripts/check-forbidden-deps.mjs && node scripts/check-deps-graph.mjs"
  },
  "devDependencies": {
    "@docmaker/cli": "workspace:*",
    "@docmaker/core": "workspace:*",
    "@docmaker/engine": "workspace:*",
    "@docmaker/remotion": "workspace:*",
    "@docmaker/render": "workspace:*",
    "@next/eslint-plugin-next": "16.3.8",
    "@remotion/eslint-plugin": "4.0.532",
    "@types/node": "22.20.5",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "eslint": "10.11.0",
    "eslint-plugin-react-hooks": "7.1.1",
    "prettier": "3.9.9",
    "tsx": "4.23.15",
    "turbo": "2.11.6",
    "typescript": "5.9.3",
    "typescript-eslint": "8.71.0",
    "vite": "8.3.2",
    "vitest": "5.0.3"
  }
}
```

`turbo.json`
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "typecheck": { "outputs": [] },
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "!.next/cache/**"] }
  }
}
```
Every package defines `"typecheck": "tsc -p tsconfig.json --noEmit"` and `"test": "vitest run"`. Only `apps/web` defines `build` (`next build`). Library packages are **source-only**: their `exports` point at `src/*.ts`; tsx, vitest, Next (`transpilePackages`) and Remotion's webpack (its `.tsx?` rule has no `node_modules` exclusion) consume TS directly.

`tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["node"]
  }
}
```
Each package: `tsconfig.json` = `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`. **No `paths` aliases** (an unprefixed alias can shadow `remotion`); cross-package imports use workspace names. Relative imports are extensionless.

`vitest.config.ts` (root)
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/cli",
      "apps/web",
      { test: { name: "render-int", include: ["packages/{render,remotion}/test-int/**/*.test.ts?(x)"], testTimeout: 600_000, hookTimeout: 600_000, pool: "forks", maxWorkers: 1 } },
      { test: { name: "e2e", include: ["tests/e2e/**/*.e2e.test.ts"], testTimeout: 1_800_000, hookTimeout: 900_000, pool: "forks", maxWorkers: 1 } },
    ],
  },
});
```
Each package's `vitest.config.ts`: `defineProject({ test: { name: "<pkg>", include: ["test/**/*.test.ts?(x)"], environment: "node", passWithNoTests: true } })`. Render integration tests (Chrome) live in `test-int/` and run only in `render-int`.

`eslint.config.js` (root, flat): typescript-eslint `recommended` plus:
- `ignores`: `**/node_modules/**`, `**/.next/**`, `projects/**`, `python/**`, `fixtures/**`, `**/dist/**`, `.turbo/**`.
- `packages/remotion/src/**`: the determinism rules, imported by **relative path** `./packages/remotion/eslint.determinism.js` (§10.9), and `@remotion/eslint-plugin`.
- `packages/core/src/**` except `packages/core/src/node/**`, and `packages/remotion/src/**`, `apps/web/src/components/**` (all client components live there; server code lives in `apps/web/src/server/**` and `apps/web/src/app/api/**`): `no-restricted-imports` bans `node:*` and the bare Node built-ins (`fs`, `path`, `child_process`, `crypto`, `os`) — browser-reachable code (verified: one stray `node:crypto` breaks Remotion's `bundle()` with `UnhandledSchemeError`, and Turbopack panics on `node:fs` in client components).
- `packages/core/src/**`: `no-restricted-imports` allows only `zod`, relative paths and (in `src/node/**`) `node:*`.
- `apps/web/**`: `@next/eslint-plugin-next`, `react-hooks`; bans `@docmaker/render`, `@remotion/bundler`, `@remotion/renderer`, `@docmaker/core/node` in client components.

`apps/web/next.config.ts` sets `typescript.ignoreBuildErrors: true` (`pnpm typecheck` covers types; this keeps one agent's work-in-progress from breaking the web build).

`scripts/smoke.ts` (F, P0): (1) `bundle()` `@docmaker/remotion/entry` into a temp dir with `enableCaching:false`; render `makeTimeline({seconds:5})` as 3 muted `h264-ts` chunks, concat with the demuxer, assert 150 frames via `ffprobe -count_frames`; (2) `pnpm --filter @docmaker/web build`. Both run under the render lock.

`.gitignore`: `node_modules/`, `.env*` (except `.env.example`), `projects/`, `.turbo/`, `.next/`, `out/`, `*.log`, `python/.venv/`, `.documentarymaker/`, `test-results/`.

`.env.example` lists every `ENV_KEYS` and `ENV_SETTINGS` variable (§4.2) with empty values and comments; the canonical secrets file is `<home>/.env` (§17.1).

---

## 3. Repository layout, entry points and ownership

### 3.1 Tree

```
DocumentaryMaker/
├─ package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json  vitest.config.ts  eslint.config.js
├─ .npmrc  .nvmrc  .gitignore  .env.example  LICENSE  NOTICE.md  README.md
├─ docs/        CONTRACT-CHANGES.md  ISSUES.md  DEV.md (agent env, Chrome path)  EXTENDING.md (providers, styles)  LEGAL.md  ARCHITECTURE.md (copy of this spec)  NLE-SMOKE.md
├─ scripts/     check-remotion-versions.mjs  check-forbidden-deps.mjs  check-deps-graph.mjs  smoke.ts
├─ packages/
│  ├─ core/      @docmaker/core      "." schemas, interfaces, fonts, ids, paths+doc registry, isomorphic utils | "./node" store, env, home, logger,
│  │                                  proc, hash, wav, loudness, locks | "./testing" factories
│  ├─ styles/    @docmaker/styles    loader/discovery/validation/offline suggestion; builtin/<id>/{style.json,STYLE.md,GUIDE.md,prompts.json}
│  ├─ llm/       @docmaker/llm       Claude client, wire schemas + mappers, prompts, steps, lint/budget, beats validation, fact-check rules, FixtureLlm
│  ├─ assets/    @docmaker/assets    HttpClient, providers, licence policy + validatePick, frozen cache, conform, ranking, picking, YouTube, verifyQuotes, credits
│  ├─ voice/     @docmaker/voice     tts text, providers (synthetic, elevenlabs, kokoro, piper, recording), aligners, takes, recording import, post chain, models
│  ├─ audio/     @docmaker/audio     procedural SFX pack + manifest, procedural music, library scan, VO program assembly, mixer, density report
│  ├─ director/  @docmaker/director  layoutProgram, direct (shots, camera, transitions, fx, overlays, captions, SFX, music, ducking), lint, overrides
│  ├─ remotion/  @docmaker/remotion  "." Documentary + components | "./compute" | "./entry" | "./fonts" | "./lint"
│  ├─ render/    @docmaker/render    RenderService, InProcessRenderClient, asset server, bundle cache, chunks, concat, mux, gate, stills, GL probe, LUT
│  ├─ export/    @docmaker/export    ExportTimeline, FCPXML, xmeml, OTIO, EDL, SRT, NLE conform, bundle, publish kit, editorial report
│  └─ engine/    @docmaker/engine    stages, hashing/staleness, gates, costs, jobs (in-process + forked worker host), demo, doctor, impact
├─ apps/
│  ├─ cli/       @docmaker/cli       commander CLI (bin docmaker) + src/worker.ts (job worker forked by the web app)
│  └─ web/       @docmaker/web       Next.js 16 app router UI + route handlers (src/app, src/components = client, src/server = server-only)
├─ python/                            uv project: pyproject.toml, uv.lock, docmaker_sidecar/{__init__,__main__,cmd_asr,cmd_piper_align,cmd_beats,cmd_energy,cmd_cuts}.py
├─ fixtures/
│  └─ tulip-mania/                    fixture.json + llm/*.json (wire format) (§6.9)
├─ assets/README.md                   nothing heavy is committed; SFX/music/models are generated or downloaded into DOCMAKER_HOME
├─ tests/e2e/                         skeleton.e2e.test.ts (W10, P1) · demo.e2e.test.ts (§16.4) · safety.e2e.test.ts (§16.6)
└─ projects/                          default DOCMAKER_PROJECTS (gitignored)
```

### 3.2 Dependency graph (acyclic; `scripts/check-deps-graph.mjs`)

```
core ← styles
core, styles(types) ← llm
core ← assets           (Reranker interface from core; the engine injects llm.makeReranker())
core ← voice            (WAV + loudness from @docmaker/core/node)
core ← audio            (WAV + loudness from @docmaker/core/node)
core ← director         (styles only as a devDependency for tests)
core ← remotion         ("." and "./compute" are browser-safe: no node:* reachable)
core, remotion(./entry, ./compute) ← render
core ← export
core, styles, llm, assets, voice, audio, director, export ← engine   (engine never imports render; RenderClient by DI)
core, engine, render, styles ← cli   (cli/src/worker.ts = job worker with an InProcessRenderClient)
core, engine, styles, remotion(".", "./compute", "./fonts") ← web     (web never imports render, @remotion/bundler, @remotion/renderer)
```

Ownership resolutions (v1 had double ownership): **music preparation** (`prepareMusic`) lives in the engine (`engine/src/stages/assets.ts`): it calls `audio.generateMusic` / `audio.scanMusicLibrary` then `assets.freezeFile`. There is no `assets/music.ts`. **WAV I/O and two-pass loudness** live only in `@docmaker/core/node` (`readWav`, `writeWav`, `createWavWriter`, `measureEbur128`, `twoPassLoudnorm`). The **post-AAC true-peak gate** lives only in render (`loudnessGate`). **Only the engine calls `voice.buildTtsText`** (when the script stage writes or when the user edits `displayText`).

### 3.3 Entry points (`exports` maps) and public surface

| Package | `exports` | Public surface | Must not |
|---|---|---|---|
| core | `".": "./src/index.ts"`, `"./node": "./src/node/index.ts"`, `"./testing": "./src/testing/index.ts"` | §4 + §4.18 | import anything but `zod` (and `node:*` under `src/node/`) |
| styles | `".": "./src/index.ts"` | §4.19 styles stub | contain React/remotion imports |
| llm | `".": "./src/index.ts"` | §4.19 llm stub | write project files (returns values) |
| assets | `".": "./src/index.ts"` | §4.19 assets stub | call Claude directly (uses the injected `Reranker`) |
| voice | `".": "./src/index.ts"` | §4.19 voice stub | — |
| audio | `".": "./src/index.ts"` | §4.19 audio stub | — |
| director | `".": "./src/index.ts"` | §4.19 director stub | do I/O |
| remotion | `".": "./src/index.ts"`, `"./compute": "./src/compute/index.ts"`, `"./entry": "./src/entry.ts"`, `"./fonts": "./src/fonts/fonts.css.ts"`, `"./lint": "./eslint.determinism.js"` | §4.19 remotion stubs | import `node:*` or `@docmaker/core/node`; do I/O except `useTimeline`/`calculateMetadata` fetches |
| render | `".": "./src/index.ts"` | §4.19 render stub | be imported by `apps/web` |
| export | `".": "./src/index.ts"` | §4.19 export stub | read anything but the Timeline + conform map to decide framing |
| engine | `".": "./src/index.ts"` | §4.19 engine stub | import `@docmaker/render` |
| cli | `"./worker": "./src/worker.ts"`; bin `docmaker` → `bin/docmaker.js` (`#!/usr/bin/env -S node --import tsx`) | §15 | — |
| web | — | §14 | — |

`packages/remotion` and `packages/render` additionally have `vitest.int.config.ts` (`include: ["test-int/**/*.test.ts?(x)"]`, `pool: "forks"`, `maxWorkers: 1`, timeouts 600 s) and the script `"test:render": "vitest run -c vitest.int.config.ts"`; the root `render-int` project includes the same files.

Package template (F writes one per package, then never again touched by agents):
```json
{
  "name": "@docmaker/<pkg>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json --noEmit", "test": "vitest run" },
  "dependencies": {},
  "devDependencies": {}
}
```

---

## 4. The core contract (`packages/core`)

**F copies, never re-types.** `$SP/design/core-v2/src/schema/*.ts`, `src/interfaces.ts`, `src/fonts.ts`, `src/util/ids.ts` and `src/util/paths.ts` are copied verbatim (they are the code blocks below). `src/util/signatures.ts`, `src/node/signatures.ts` and `src/testing/signatures.ts` are **signature sheets**: F implements each declared function in the file named in its header comment and re-exports it from the same barrel, so every import path stays identical.

Conventions:
- **camelCase** for every persisted document. LLM wire formats are snake_case, live in `@docmaker/llm/src/wire/` and map onto these types (§6.4).
- Each schema constant and its inferred type share a name (`export const X = z.object(…); export type X = z.infer<typeof X>`).
- **Per-document versions.** Every persisted document has `schemaVersion: docVersion("<kind>")` (`DOC_VERSIONS`, §4.1). `ProjectStore.readJson` runs the registered migration chain before parsing (§4.18). `project.json` also carries `formatVersion` for whole-project layout changes.
- **Integer frames everywhere in timelines.** Milliseconds appear only in voice and layout documents and are converted with `msToFrame`.
- Language-neutral documents: research, outline, beat plans, user picks, picks, frozen assets, ledger, music. Per-language: script, beat slices, fact-check, takes, layout, timeline, overrides, usage, mix, render, export, QA.
- **Browser safety.** Nothing reachable from `@docmaker/core` (".") or `@docmaker/core/testing` imports `node:*`; Node-only code lives under `src/node/` and is exported as `@docmaker/core/node`. SHA-256 is implemented in pure JS (`util/sha256.ts`) so `hashJson`, `docHash` and `sliceHash` run in the browser and in Remotion bundles.
- **Ids are assigned in code** (`util/ids.ts`); LLM-written ids are normalised or replaced by the wire mappers.
- **Superseded by v2:** `LintIssue` moved to `common.ts`; `LicenseInfo` to `license.ts`; `beats.json` split into `beats/plans.json` + `beats/<lang>.json`; `picks.json` split into user input `user-picks.json` and output `picks.json`; `LedgerEntry.usedIn` replaced by `timeline/<lang>.usage.json`.

### 4.1 `schema/common.ts`

```ts
// $SP/design/core-v2/src/schema/common.ts
import { z } from "zod";

/**
 * Per-document format versions. Each persisted document kind has its own version.
 * To change a persisted shape: bump ONE entry here and register a migration (util/migrate.ts).
 */
export const DOC_VERSIONS = {
  project: 1, dossier: 1, registry: 1, factsheet: 1, verification: 1, styleSuggestion: 1, outline: 1,
  script: 1, factcheck: 1, beatPlans: 1, beatSlices: 1, userPicks: 1, picks: 1, frozen: 1, candidates: 1,
  clipWords: 1, entities: 1, localIndex: 1, ledger: 1, music: 1, sfxManifest: 1, voiceTrack: 1, activeTake: 1,
  layout: 1, timeline: 1, overrides: 1, usage: 1, timelineLint: 1, loudness: 1, render: 1, qa: 1, state: 1,
  approvals: 1, jobsIndex: 1, estimate: 1, fixture: 1, cacheIndex: 1, homeConfig: 1, glProbe: 1, browser: 1,
} as const;
export type DocKind = keyof typeof DOC_VERSIONS;
export const docVersion = <K extends DocKind>(k: K) => z.literal(DOC_VERSIONS[k]);

export const Lang = z.enum(["en", "fr"]);
export type Lang = z.infer<typeof Lang>;
export const LANGS = Lang.options;

export const Slug = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const Sha16 = z.string().regex(/^[a-f0-9]{16}$/); // first 16 hex chars of a sha256 (plan keys)
export const IsoDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/); // YYYY | YYYY-MM | YYYY-MM-DD
export const IsoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T/); // Date#toISOString()
export const Frame = z.number().int().nonnegative();
export const PosFrames = z.number().int().positive();
export const FrameDelta = z.number().int();
export const Ms = z.number().int().nonnegative();
export const Unit = z.number().min(0).max(1);
export const Color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
export const Fps = z.union([z.literal(24), z.literal(25), z.literal(30)]);
export type Fps = z.infer<typeof Fps>;
export const Range2 = z.tuple([z.number(), z.number()]); // [min, max]
export type Range2 = z.infer<typeof Range2>;

// ---- id grammars. Ids are assigned IN CODE (never trusted from the LLM; the wire mappers normalise them).
export const ChapterId = z.string().regex(/^CH\d{1,2}$/); // CH1 is the cold open
export type ChapterId = z.infer<typeof ChapterId>;
export const SegmentId = z.string().regex(/^CH\d{1,2}-S\d{2,3}$/); // CH3-S07
export type SegmentId = z.infer<typeof SegmentId>;
/** CH3-B014 (planned beat) | CH3-S07-CLIP (synthetic clip beat) | CH3-S09-BR (synthetic music_breath montage beat) */
export const BeatId = z.string().regex(/^CH\d{1,2}-(B\d{3}|S\d{2,3}-(CLIP|BR))$/);
export type BeatId = z.infer<typeof BeatId>;
export const WordId = z.string().regex(/^CH\d{1,2}-S\d{2,3}:\d{1,4}$/); // `${segmentId}:${wordIndex}` (per language)
export type WordId = z.infer<typeof WordId>;
export const ClipWordId = z.string().regex(/^clip:CH\d{1,2}-S\d{2,3}:\d{1,4}$/); // clip transcript word
export const TranslationWordId = z.string().regex(/^tr:CH\d{1,2}-S\d{2,3}:\d{1,3}:\d{1,3}$/); // tr:<segmentId>:<page>:<n>
export const AnyWordId = z.union([WordId, ClipWordId, TranslationWordId]);
export const AssetId = Sha256; // sha256 of the CONFORMED file
export const TakeId = z.string().regex(/^(take|scratch)-[a-f0-9]{12}$/); // deterministic (§8.9)
export type TakeId = z.infer<typeof TakeId>;
export const ActId = z.string().regex(/^[a-z0-9_]+$/); // validated against the style's story-shape acts
export const SourceId = z.string().regex(/^S\d{1,4}$/);
export const PersonId = z.string().regex(/^P\d{1,4}$/);
export const EventId = z.string().regex(/^E\d{1,4}$/);
export const FigureId = z.string().regex(/^N\d{1,4}$/);
export const ClaimId = z.string().regex(/^C\d{1,4}$/);
export const QuoteId = z.string().regex(/^Q\d{1,4}$/);
export const FactRef = z.string().regex(/^[SPENCQ]\d{1,4}$/); // Source Person Event figure(N) Claim Quote
export const FactCheckId = z.string().regex(/^FC-[a-f0-9]{8}$/); // FC-<sha8(where|norm(sentence)|claimKind|origin)>

export const NormPoint = z.object({ x: Unit, y: Unit });
export type NormPoint = z.infer<typeof NormPoint>;
export const NormRect = z.object({ x: Unit, y: Unit, w: Unit, h: Unit });
export type NormRect = z.infer<typeof NormRect>;
export const PxRect = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});
export type PxRect = z.infer<typeof PxRect>;

/** Deterministic lint/validation issue, shared by every linter (script, beats, timeline, styles, integrity). */
export const LintIssue = z.object({
  level: z.enum(["error", "warn"]),
  rule: z.string(), // stable code, e.g. "accusatory-unattributed", "V_CONTIGUOUS", "NO_VISUAL_CHANGE"
  where: z.string(), // segment/chapter/beat/item id or "global"
  msg: z.string(),
});
export type LintIssue = z.infer<typeof LintIssue>;

// ---- inferred types (one per schema constant)
export type Slug = z.infer<typeof Slug>;
export type Sha256 = z.infer<typeof Sha256>;
export type Sha16 = z.infer<typeof Sha16>;
export type IsoDate = z.infer<typeof IsoDate>;
export type IsoDateTime = z.infer<typeof IsoDateTime>;
export type Frame = z.infer<typeof Frame>;
export type PosFrames = z.infer<typeof PosFrames>;
export type FrameDelta = z.infer<typeof FrameDelta>;
export type Ms = z.infer<typeof Ms>;
export type Unit = z.infer<typeof Unit>;
export type Color = z.infer<typeof Color>;
export type ClipWordId = z.infer<typeof ClipWordId>;
export type TranslationWordId = z.infer<typeof TranslationWordId>;
export type AnyWordId = z.infer<typeof AnyWordId>;
export type AssetId = z.infer<typeof AssetId>;
export type ActId = z.infer<typeof ActId>;
export type SourceId = z.infer<typeof SourceId>;
export type PersonId = z.infer<typeof PersonId>;
export type EventId = z.infer<typeof EventId>;
export type FigureId = z.infer<typeof FigureId>;
export type ClaimId = z.infer<typeof ClaimId>;
export type QuoteId = z.infer<typeof QuoteId>;
export type FactRef = z.infer<typeof FactRef>;
export type FactCheckId = z.infer<typeof FactCheckId>;
```

### 4.2 `schema/project.ts`

```ts
// $SP/design/core-v2/src/schema/project.ts
import { z } from "zod";
import { ChapterId, Color, Fps, IsoDate, IsoDateTime, Lang, Slug, docVersion } from "./common";

export const VoiceProviderId = z.enum(["elevenlabs", "kokoro", "piper", "synthetic", "recording"]);
export type VoiceProviderId = z.infer<typeof VoiceProviderId>;

export const LexiconEntry = z.object({
  match: z.string().min(1), // whole-word match in displayText
  say: z.string().min(1), // spoken replacement written into ttsText (may be several words)
  caseSensitive: z.boolean().default(false),
});
export type LexiconEntry = z.infer<typeof LexiconEntry>;

export const VoiceSettings = z.object({
  provider: VoiceProviderId,
  voiceId: z.string().min(1), // "auto" | ElevenLabs voice id | kokoro speaker id ("16") | piper voice ("fr_FR-gilles-low") | "synthetic-m1"
  modelId: z.string().nullable().default(null), // "eleven_multilingual_v2" (default for elevenlabs) | null
  speed: z.number().min(0.7).max(1.2).default(1.0),
  stability: z.number().min(0).max(1).default(0.45),
  similarityBoost: z.number().min(0).max(1).default(0.8),
  style: z.number().min(0).max(1).default(0.15),
  charsPerSec: z.number().positive().nullable().default(null), // calibrated; null → style.scriptProfile.charsPerSec[lang]
  lexicon: z.array(LexiconEntry).default([]),
  /** Required before a CLONED ElevenLabs voice can be used (§8.3). Never a clone of a FactSheet person. */
  cloneConsent: z.object({ declaredAt: IsoDateTime, statement: z.string().min(20) }).nullable().default(null),
  /** Recording takes only: fill segments missing from the recording with this TTS provider ("PICKUP TTS" marker). */
  pickupProvider: VoiceProviderId.nullable().default(null),
});
export type VoiceSettings = z.infer<typeof VoiceSettings>;

export const AssetProviderId = z.enum([
  "openverse", "wikimedia", "internet-archive", "nasa", "loc",
  "pexels", "pixabay", "youtube", "brave", "fal", "local", "procedural",
]);
export type AssetProviderId = z.infer<typeof AssetProviderId>;

export const LicensePolicy = z.object({
  mode: z.enum(["monetized", "personal"]).default("monetized"),
  allowNonCommercial: z.boolean().default(false),
  allowNoDerivatives: z.boolean().default(false),
  allowShareAlike: z.boolean().default(true),
  allowUnknownEditorial: z.boolean().default(false), // web image search results (Brave), undeclared imports
  allowYoutubeFairUse: z.boolean().default(true), // only effective after editorial.fairUseAcknowledged
  allowAiGenerated: z.boolean().default(true), // never for beats with people (enforced by validatePick)
});
export type LicensePolicy = z.infer<typeof LicensePolicy>;

export const RenderPresetId = z.enum(["draft", "master"]);
export type RenderPresetId = z.infer<typeof RenderPresetId>;
export const GlMode = z.enum(["auto", "swangle", "angle", "angle-egl"]);
export type GlMode = z.infer<typeof GlMode>;
export const ExportFormat = z.enum([
  "fcpxml", "xmeml-premiere", "xmeml-resolve", "otio", "markers-edl", "srt", "stems", "reference-mp4",
  "publish-kit", "editorial-report",
]);
export type ExportFormat = z.infer<typeof ExportFormat>;
export const CaptionsMode = z.enum(["burn", "srt-only", "off"]);
export type CaptionsMode = z.infer<typeof CaptionsMode>;
/** keywords = selective on-screen phrases (drama default); pop = full word-by-word burn-in (Shorts idiom, opt-in). */
export const CaptionVariant = z.enum(["keywords", "pop", "karaoke", "rail"]);
export type CaptionVariant = z.infer<typeof CaptionVariant>;
export const SfxPackId = z.enum(["procedural", "remotion-sfx-cc0", "hyperframes-pixabay", "user"]);
export const LlmProviderId = z.enum(["anthropic", "fixture"]);
export const VisionRerankMode = z.enum(["off", "selective", "all"]);

/** "Theme the edit to the topic": produced by the style-suggestion call (or the user), merged into render tokens. */
export const ThemeOverride = z.object({
  accent: Color.nullable(),
  backdropRecipe: z.enum(["gradientGrid", "paper", "darkNoise", "blurSelf"]).nullable(),
  texture: z.enum(["none", "paper", "film", "scanlines", "halftone"]).nullable(),
  fontHeadline: z.string().nullable(), // must exist in the style's font set
});
export type ThemeOverride = z.infer<typeof ThemeOverride>;

export const PublishInfo = z.object({
  title: z.string().max(100),
  thumbnailText: z.string().max(40),
  description: z.string().max(5000),
});
export type PublishInfo = z.infer<typeof PublishInfo>;

export const Project = z.object({
  schemaVersion: docVersion("project"),
  formatVersion: z.literal(1),
  slug: Slug,
  title: z.string(),
  idea: z.string().min(3).max(500),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  languages: z.array(Lang).min(1).max(2),
  primaryLang: Lang,
  targetMinutes: z.number().min(1).max(60),
  styleId: z.string().nullable(), // null until suggested/chosen
  styleConfirmed: z.boolean(), // gate "style-confirm": outline is blocked until true
  themeOverride: ThemeOverride.nullable(),
  seed: z.number().int().min(0).max(0xffffffff),
  video: z.object({ fps: Fps, width: z.literal(1920), height: z.literal(1080) }),
  llm: z.object({
    provider: LlmProviderId,
    model: z.literal("claude-opus-5-5"),
    fixtureId: z.string().nullable(),
    refusalFallback: z.boolean(), // betas ["server-side-fallback-2026-07-01"] + fallbacks:"default"
    useBatchForRerank: z.boolean(), // R11
  }),
  voice: z.partialRecord(Lang, VoiceSettings),
  assets: z.object({
    providers: z.array(AssetProviderId), // enabled, in priority order
    offline: z.boolean(), // true → only local + procedural; HttpClient refuses every request
    licensePolicy: LicensePolicy,
    maxCandidatesPerBeat: z.number().int().min(4).max(60),
    useClip: z.boolean(), // M3: needs `docmaker setup --clip`
    visionRerank: VisionRerankMode, // "selective" = person/archival/news beats + close metadata ties only
    maxClipSeconds: z.number().min(3).max(60),
    clipFallback: z.enum(["narrated", "card"]), // when a YouTube clip is not found
    keepSourceDownloads: z.boolean(), // false → full-source yt-dlp downloads are deleted after conform
  }),
  audio: z.object({
    music: z.enum(["procedural", "library", "none"]),
    musicLibraryDir: z.string().nullable(),
    sfxPacks: z.array(SfxPackId),
    targetLufs: z.number(), // -14
    truePeakTarget: z.number(), // -1.5 (loudnorm TP)
    truePeakGate: z.number(), // -1.0 (measured after AAC)
  }),
  captions: CaptionsMode,
  captionsVariant: CaptionVariant.nullable(), // null → style.captionDNA.variant
  render: z.object({
    defaultPreset: RenderPresetId,
    gl: GlMode,
    concurrency: z.number().int().positive().nullable(), // null → min(os.availableParallelism(), 4)
    chunkSeconds: z.number().int().min(10).max(600),
  }),
  export: z.object({
    formats: z.array(ExportFormat),
    fcpxmlVersion: z.enum(["1.10", "1.11", "1.13"]),
    exportRoot: z.string().nullable(), // path prefix on the editing machine (path remap)
    overlays: z.boolean(), // ProRes 4444 per graphics item (M3)
  }),
  editorial: z.object({
    asOf: IsoDate,
    monetized: z.boolean(),
    fairUseAcknowledged: z.boolean(),
  }),
  publish: z.partialRecord(Lang, PublishInfo),
  budget: z.object({
    maxUsdPerStage: z.number().nonnegative(), // hard stop (25)
    maxUsdTotal: z.number().nonnegative(), // project cap (40)
    autoApproveUnderUsd: z.number().nonnegative(), // cost-gate auto-approval threshold (0 = always ask)
  }),
});
export type Project = z.infer<typeof Project>;

/** Fields that cannot change once any stage has produced output (PATCH rejects them with VALIDATION). */
export const LOCKED_AFTER_START = ["languages", "primaryLang", "video", "seed", "slug"] as const;

export const NewProjectInput = z.object({
  idea: z.string().min(3).max(500),
  slug: Slug.optional(),
  languages: z.array(Lang).min(1).max(2).default(["en"]),
  primaryLang: Lang.optional(), // default languages[0]
  targetMinutes: z.number().min(1).max(60).default(20),
  styleId: z.string().nullable().default(null), // a value here also sets styleConfirmed=true
  llm: LlmProviderId.default("anthropic"),
  fixtureId: z.string().nullable().default(null),
  seed: z.number().int().min(0).max(0xffffffff).optional(), // default fnv1a32(slug)
});
export type NewProjectInput = z.input<typeof NewProjectInput>;

/** Options a job may carry. Every key a stage reads MUST be part of that stage's inputs hash (§5.3). */
export const JobOptions = z.object({
  onlyChapters: z.array(ChapterId).nullable().optional(), // demo / chapter-range work; hashed by layout, direct, mix, render
  frameRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable().optional(),
  newRequest: z.boolean().optional(), // bypass paid receipts (one call)
  forceOverwriteEdits: z.boolean().optional(), // allow regenerating user-edited/locked chapters
  replanChapters: z.array(ChapterId).optional(), // beats: LLM re-plan of these chapters
  chapters: z.array(ChapterId).optional(), // script: (re)write only these chapters
  segments: z.array(z.string()).optional(), // voice: re-synthesise only these segments
  retryBad: z.boolean().optional(),
  allowPaid: z.boolean().optional(), // live asset search may use paid providers (after an inline confirm)
  timelineOnly: z.boolean().optional(), // export without reference mp4
  overlays: z.boolean().optional(),
  takeKind: z.enum(["scratch", "final"]).optional(),
  pickupTts: z.boolean().optional(),
});
export type JobOptions = z.infer<typeof JobOptions>;

// ---- environment / secrets (never persisted, never logged)
export const ENV_KEYS = {
  anthropic: "ANTHROPIC_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  pexels: "PEXELS_API_KEY",
  pixabay: "PIXABAY_API_KEY",
  fal: "FAL_KEY",
  brave: "BRAVE_API_KEY",
  openverseClientId: "OPENVERSE_CLIENT_ID",
  openverseClientSecret: "OPENVERSE_CLIENT_SECRET",
  youtubeDataApi: "YOUTUBE_API_KEY",
  remotionLicense: "REMOTION_LICENSE_KEY",
} as const;
export type SecretName = keyof typeof ENV_KEYS;
export type Secrets = Readonly<Partial<Record<SecretName, string>>>;

export const ENV_SETTINGS = {
  home: "DOCMAKER_HOME", // default ~/.documentarymaker
  projects: "DOCMAKER_PROJECTS", // default <repoRoot>/projects
  repoRoot: "DOCMAKER_REPO_ROOT", // default: nearest ancestor of cwd containing pnpm-workspace.yaml
  contact: "DOCMAKER_CONTACT", // Wikimedia UA contact (URL or email); set by the user, never auto-filled
  logLevel: "DOCMAKER_LOG_LEVEL",
  ffmpeg: "DOCMAKER_FFMPEG", // default "ffmpeg"
  ffprobe: "DOCMAKER_FFPROBE",
  offline: "DOCMAKER_OFFLINE", // "1" forces offline everywhere
  autoApproveUsd: "DOCMAKER_AUTO_APPROVE_USD",
  cacheMaxGb: "DOCMAKER_CACHE_MAX_GB",
  ytPotUrl: "DOCMAKER_YT_POT_URL",
  ytCookiesBrowser: "DOCMAKER_YT_COOKIES_BROWSER",
  renderLock: "DOCMAKER_RENDER_LOCK", // default /tmp/docmaker-render.lock (machine-wide)
  browserExecutable: "DOCMAKER_BROWSER_EXECUTABLE", // overrides <home>/browser.json (shared Chrome Headless Shell)
  liveTests: "DOCMAKER_LIVE_TESTS", // "1" enables network/paid tests (never in CI)
} as const;

// ---- inferred types (one per schema constant)
export type SfxPackId = z.infer<typeof SfxPackId>;
export type LlmProviderId = z.infer<typeof LlmProviderId>;
export type VisionRerankMode = z.infer<typeof VisionRerankMode>;
```

**`defaultProject(input, now, detected)`** fills these values (normative):

| Field | Default |
|---|---|
| `formatVersion` | 1 |
| `title` | the idea, truncated to 80 characters |
| `styleId` / `styleConfirmed` | `input.styleId` / `input.styleId !== null` |
| `themeOverride`, `captionsVariant` | `null`, `null` |
| `video` | `{fps:30, width:1920, height:1080}` |
| `llm` | `{provider: input.llm, model:"claude-opus-5-5", fixtureId, refusalFallback:true, useBatchForRerank:false}` |
| `voice[lang]` | resolved at creation: `ELEVENLABS_API_KEY` set → `elevenlabs`/`"auto"`/`"eleven_multilingual_v2"`; else Kokoro model present → `kokoro` (`en:"16"` am_michael, `fr:"30"` ff_siwis); else Piper present → `piper` (`en_US-john-medium`, `fr_FR-gilles-low`); else `synthetic`/`"synthetic-m1"`. Scratch takes always use `synthetic` regardless (§8.9). |
| `assets.providers` | `["local","wikimedia","openverse","internet-archive","nasa","loc","pexels","pixabay","youtube","brave","fal","procedural"]` (unconfigured providers are skipped at runtime) |
| `assets` (other) | `offline:false, maxCandidatesPerBeat:24, useClip:false, visionRerank:"selective", maxClipSeconds:20, clipFallback:"narrated", keepSourceDownloads:false` |
| `audio` | `{music:"procedural", musicLibraryDir:null, sfxPacks:["procedural"], targetLufs:-14, truePeakTarget:-1.5, truePeakGate:-1.0}` |
| `captions` | the style's `captionDNA.defaultMode` (`"burn"` for drama-commentary; its variant is `keywords`) |
| `render` | `{defaultPreset:"draft", gl:"auto", concurrency:null, chunkSeconds:60}` |
| `export` | `{formats:["fcpxml","xmeml-premiere","otio","markers-edl","srt","stems","publish-kit","editorial-report","reference-mp4"], fcpxmlVersion:"1.10", exportRoot:null, overlays:false}` (`reference-mp4` is skipped with a README note when no up-to-date render exists) |
| `editorial` | `{asOf: today, monetized:true, fairUseAcknowledged:false}` |
| `publish` | `{}` |
| `budget` | `{maxUsdPerStage:25, maxUsdTotal:40, autoApproveUnderUsd: env DOCMAKER_AUTO_APPROVE_USD ?? 0}` |
| `languages` / `targetMinutes` | input, else `HomeConfig.defaults`, else `["en"]` / 20 |

### 4.3 `schema/license.ts` and `schema/research.ts`

```ts
// $SP/design/core-v2/src/schema/license.ts
import { z } from "zod";

export const LicenseCode = z.enum([
  "CC0", "PDM", "CC-BY", "CC-BY-SA", "CC-BY-NC", "CC-BY-ND", "CC-BY-NC-SA", "CC-BY-NC-ND",
  "PEXELS", "PIXABAY", "UNSPLASH", "AI-GENERATED", "YOUTUBE-FAIR-USE", "PROCEDURAL", "USER-OWNED", "UNKNOWN",
  "PROVIDER-TERMS", // TTS voices under a provider's terms (ElevenLabs) — see attributionText/restrictions
]);
export type LicenseCode = z.infer<typeof LicenseCode>;
export const LicenseRestriction = z.enum([
  "personality", "no-bad-light", "trademark", "no-redistribution", "editorial-only", "no-endorsement",
  "nc", "sa", "nd", "unknown-rights", "fair-use-user-risk", "synthetic", "may-be-manipulated",
]);
export type LicenseRestriction = z.infer<typeof LicenseRestriction>;
export const LicenseInfo = z.object({
  code: LicenseCode,
  version: z.string().nullable(),
  url: z.string().nullable(),
  commercialOk: z.boolean(),
  derivativesOk: z.boolean(),
  attributionRequired: z.boolean(),
  attributionText: z.string().nullable(), // ready-to-print credit line
  restrictions: z.array(LicenseRestriction),
});
export type LicenseInfo = z.infer<typeof LicenseInfo>;

/** Required for every user upload / local import. Imports are NEVER defaulted to USER-OWNED. */
export const UploadDeclaration = z.object({
  kind: z.enum(["own-work", "licensed", "third-party-quotation", "ai-generated"]),
  license: LicenseCode.nullable(), // "licensed": the licence code
  author: z.string(),
  url: z.string(), // "licensed"/"third-party-quotation": where it comes from
  note: z.string(),
});
export type UploadDeclaration = z.infer<typeof UploadDeclaration>;
```

```ts
// $SP/design/core-v2/src/schema/research.ts
import { z } from "zod";
import {
  ClaimId, EventId, FigureId, IsoDate, IsoDateTime, PersonId, QuoteId, SourceId, Unit, docVersion,
} from "./common";
import { ThemeOverride } from "./project";

export const SourceType = z.enum([
  "court_document", "official_statement", "regulatory_filing", "major_news", "trade_press",
  "primary_interview", "primary_social_post", "book", "wikipedia", "tabloid", "blog_or_forum", "other",
]);
export const ClaimStatus = z.enum([
  "established_fact", "judicial_finding_civil", "criminal_conviction", "acquitted", "charged_pending",
  "under_investigation", "civil_claim_pending", "settled_no_admission", "dismissed", "appeal_pending",
  "allegation", "denied_allegation", "disputed", "rumor_unverified", "retracted",
]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;
/** Statuses that may change over time: render/export require a recheck or an acknowledgement when asOf is > 30 days old. */
export const PENDING_STATUSES: readonly ClaimStatus[] = [
  "charged_pending", "under_investigation", "civil_claim_pending", "appeal_pending",
];
/** Statuses under which accusatory on-screen wording is allowed (deterministic fact-check rule f). */
export const ESTABLISHED_STATUSES: readonly ClaimStatus[] = ["established_fact", "criminal_conviction", "judicial_finding_civil"];
export const Reliability = z.enum(["high", "medium", "low"]);
export const Sensitivity = z.enum(["low", "medium", "high"]); // high = crime, sexual misconduct, abuse, health, minors, fraud
export const QuoteMedium = z.enum([
  "video_interview", "tv_news", "court_testimony", "podcast", "social_post", "print", "statement",
]);
export const TopicType = z.enum([
  "person_downfall", "company_collapse", "scandal_expose", "rise_story", "true_crime",
  "history", "explainer", "internet_drama", "conspiracy_debunk", "other",
]);
export type TopicType = z.infer<typeof TopicType>;
export const RiskFlag = z.enum([
  "real_person_allegations", "minors", "sexual_violence", "suicide_self_harm", "ongoing_trial",
  "health_speculation", "graphic_violence", "none",
]);
export type RiskFlag = z.infer<typeof RiskFlag>;

export const Source = z.object({
  id: SourceId,
  url: z.string().min(1), // ONLY URLs returned by web_search/web_fetch results (registry rule §6.3)
  title: z.string(),
  publisher: z.string(),
  publishedAt: z.string(), // ISO date or ""
  sourceType: SourceType,
  reliability: Reliability,
  language: z.string(), // BCP-47 of the source ("en", "fr", …) or ""
  fetched: z.boolean(),
  cited: z.number().int().nonnegative(),
  snippets: z.array(z.string()).max(5),
});
export type Source = z.infer<typeof Source>;

export const Person = z.object({
  id: PersonId,
  name: z.string(),
  roleInStory: z.string(),
  publicFigure: z.boolean(), // false → identity search, portraits and lower thirds need gate "person-ack"
  isMinorOrPrivateVictim: z.boolean(), // true → never named on screen, never searched, never shown
  imageQueries: z.array(z.string()),
  wikidataQid: z.string().regex(/^Q\d+$/).nullable(), // resolved IN CODE (wbsearchentities), never by the LLM or by vision
  aliases: z.array(z.string()), // Wikidata aliases + name tokens; feeds the AI-image denylist (§7.4)
});
export type Person = z.infer<typeof Person>;

export const TimelineEvent = z.object({
  id: EventId,
  date: z.string(), // YYYY | YYYY-MM | YYYY-MM-DD
  title: z.string(),
  whatHappened: z.string(),
  personIds: z.array(PersonId),
  status: ClaimStatus,
  sourceIds: z.array(SourceId),
  dramaValue: z.number().min(0).max(10),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const QuoteVerification = z.enum(["unchecked", "verbatim", "fuzzy", "not-found", "fetch-failed"]);
export type QuoteVerification = z.infer<typeof QuoteVerification>;
export const Quote = z.object({
  id: QuoteId,
  speakerId: PersonId,
  verbatim: z.string(), // exact words, original language, never paraphrased
  language: z.string(),
  date: z.string(),
  context: z.string(),
  medium: QuoteMedium,
  sourceId: SourceId,
  youtubeSearchQuery: z.string(), // "" if not on video
  verification: QuoteVerification,
  verifiedBy: z.enum(["none", "page", "video"]), // "video" = YouTube passage match ≥ 0.8 (§7.7)
});
export type Quote = z.infer<typeof Quote>;

export const Figure = z.object({
  id: FigureId,
  label: z.string(),
  value: z.number(),
  unit: z.string(),
  asOf: z.string(),
  sourceIds: z.array(SourceId),
  chartable: z.boolean(),
});
export type Figure = z.infer<typeof Figure>;

export const Claim = z.object({
  id: ClaimId,
  summary: z.string(),
  madeBy: z.string(),
  against: z.string(),
  status: ClaimStatus,
  jurisdiction: z.string(), // "UK High Court", "Fairfax County VA jury", "" if none
  decisionDate: z.string(),
  subjectResponse: z.string(), // denial/statement of the accused, "" if none found
  asOf: z.string(), // date the status was last verified (defaults to FactSheet.asOf; refreshed by recheck)
  sensitivity: Sensitivity,
  sourceIds: z.array(SourceId),
});
export type Claim = z.infer<typeof Claim>;

const uniqueIds = (label: string) => (arr: { id: string }[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  for (const x of arr) {
    if (seen.has(x.id)) ctx.addIssue({ code: "custom", message: `duplicate ${label} id ${x.id}` });
    seen.add(x.id);
  }
};

export const FactSheet = z.object({
  schemaVersion: docVersion("factsheet"),
  topic: z.string(),
  asOf: IsoDate,
  oneLinePremise: z.string(),
  centralQuestion: z.string(),
  sources: z.array(Source).superRefine(uniqueIds("source")),
  people: z.array(Person).superRefine(uniqueIds("person")),
  timeline: z.array(TimelineEvent).superRefine(uniqueIds("event")),
  quotes: z.array(Quote).superRefine(uniqueIds("quote")),
  figures: z.array(Figure).superRefine(uniqueIds("figure")),
  claims: z.array(Claim).superRefine(uniqueIds("claim")),
  angles: z.array(z.string()),
  gaps: z.array(z.string()), // unverified: never asserted in the script
});
export type FactSheet = z.infer<typeof FactSheet>;

export const ResearchDossier = z.object({
  schemaVersion: docVersion("dossier"),
  topic: z.string(),
  asOf: IsoDate,
  searchLanguages: z.array(z.string()),
  markdown: z.string(), // citations rewritten to [S#]
  searchesUsed: z.number().int().nonnegative(),
  fetchesUsed: z.number().int().nonnegative(),
  turns: z.number().int().nonnegative(), // pause_turn continuations (each saved to research/raw/turn-<n>.json)
  rawFiles: z.array(z.string()),
  generatedBy: z.enum(["llm", "fixture"]),
});
export type ResearchDossier = z.infer<typeof ResearchDossier>;

export const RegistryEntry = z.object({
  id: SourceId,
  url: z.string(),
  title: z.string(),
  pageAge: z.string().nullable(),
  fetched: z.boolean(),
  cited: z.number().int().nonnegative(),
  snippets: z.array(z.string()).max(5),
});
export type RegistryEntry = z.infer<typeof RegistryEntry>;
export const RegistryDoc = z.object({ schemaVersion: docVersion("registry"), entries: z.array(RegistryEntry) });
export type RegistryDoc = z.infer<typeof RegistryDoc>;

export const VerificationItem = z.object({
  ref: z.string(),
  check: z.enum(["source-ref", "quote-verbatim", "url-reachable", "figure-source"]),
  ok: z.boolean(),
  detail: z.string(), // "skipped-offline" when offline/fixture (§6.3)
});
export const Verification = z.object({
  schemaVersion: docVersion("verification"),
  checkedAt: IsoDateTime,
  items: z.array(VerificationItem),
  invalidRefs: z.array(z.string()), // items whose sourceIds are not in the registry → moved to gaps
});
export type Verification = z.infer<typeof Verification>;

export const StyleSuggestion = z.object({
  schemaVersion: docVersion("styleSuggestion"),
  topicType: TopicType,
  ranked: z.array(z.object({ styleId: z.string(), score: Unit, why: z.string() })),
  recommendedStyleId: z.string(),
  recommendedMinutes: z.number(),
  titleOptions: z.array(z.string()),
  thumbnailTextOptions: z.array(z.string()),
  riskFlags: z.array(RiskFlag),
  themeOverride: ThemeOverride.nullable(),
  source: z.enum(["llm", "offline", "fixture"]),
  stage: z.enum(["idea", "research"]), // idea = cheap pre-research ranking at /new; research = refined
});
export type StyleSuggestion = z.infer<typeof StyleSuggestion>;

// ---- inferred types (one per schema constant)
export type SourceType = z.infer<typeof SourceType>;
export type Reliability = z.infer<typeof Reliability>;
export type Sensitivity = z.infer<typeof Sensitivity>;
export type QuoteMedium = z.infer<typeof QuoteMedium>;
export type VerificationItem = z.infer<typeof VerificationItem>;
```

### 4.4 `schema/outline.ts`

```ts
// $SP/design/core-v2/src/schema/outline.ts
import { z } from "zod";
import { ActId, ChapterId, ClaimId, EventId, IsoDateTime, Lang, QuoteId, docVersion } from "./common";

export const Budget = z.object({
  lang: Lang,
  minutes: z.number(),
  storyShape: z.string(),
  charsPerSec: z.number(),
  runtimeSec: z.number().int(),
  narrationSec: z.number().int(),
  chars: z.number().int(),
  words: z.number().int(),
  chapters: z.number().int().positive(),
  perAct: z.record(ActId, z.number().int().nonnegative()), // words per act
  beatsApprox: z.number().int(),
});
export type Budget = z.infer<typeof Budget>;

export const ChapterPlan = z.object({
  id: ChapterId,
  act: ActId,
  title: z.string(), // primary-language working title
  targetSec: z.number().positive(), // LANGUAGE-NEUTRAL length target (narration seconds)
  targetWords: z.number().int().positive(), // primary language only (= targetSec·cps/avgCharsPerWord)
  purpose: z.string(),
  eventIds: z.array(EventId),
  claimIds: z.array(ClaimId),
  quoteIds: z.array(QuoteId), // clips to play in this chapter
  opensLoops: z.array(z.string()),
  closesLoops: z.array(z.string()),
  exitHook: z.string(),
  adBreakAfter: z.boolean(),
});
export type ChapterPlan = z.infer<typeof ChapterPlan>;

export const Outline = z.object({
  schemaVersion: docVersion("outline"),
  lang: Lang, // authoring language (= project.primaryLang); other languages transcreate per chapter
  title: z.string(),
  thesis: z.string(),
  thesisConfirmed: z.boolean(), // the user edited or explicitly confirmed the thesis (outline-approval requires it)
  storyShape: z.string(),
  hookTeasers: z.array(z.object({ id: z.string(), teaser: z.string(), paidOffIn: ChapterId })),
  loops: z.array(
    z.object({ id: z.string().regex(/^L\d+$/), question: z.string(), openedIn: ChapterId, closedIn: ChapterId }),
  ),
  chapters: z.array(ChapterPlan).min(1),
  callbackPlan: z.array(z.string()),
  nextVideoBridge: z.string(),
  budget: Budget, // primary language
  budgets: z.partialRecord(Lang, Budget), // every project language (each with its own cps)
  generatedBy: z.enum(["llm", "fixture", "user"]),
  updatedAt: IsoDateTime,
});
export type Outline = z.infer<typeof Outline>;
```

`targetSec` is the language-neutral target; `lintScript` checks each language's chapter length against `targetSec · cps[lang] / avgCharsPerWord[lang]` (± 12 %), never against primary-language word counts.

### 4.5 `schema/script.ts`

```ts
// $SP/design/core-v2/src/schema/script.ts
import { z } from "zod";
import {
  ChapterId, FactCheckId, FactRef, IsoDateTime, Lang, LintIssue, Ms, QuoteId, SegmentId, Sha256, docVersion,
} from "./common";

export const SegmentType = z.enum(["narration", "clip", "sponsor_slot", "music_breath"]);
export type SegmentType = z.infer<typeof SegmentType>;
export const Device = z.enum([
  "none", "open_loop", "re_hook", "pattern_interrupt", "callback", "cliffhanger",
  "punchline", "rhetorical_question", "reveal", "payoff",
]);
export type Device = z.infer<typeof Device>;

export const ScriptSegment = z.object({
  id: SegmentId, // the chapter is the id prefix (chapterOfSegment); no redundant chapterId field
  type: SegmentType,
  displayText: z.string(), // shown + captioned. clip: the verbatim quote (original language). "" for sponsor/breath
  ttsText: z.string(), // spoken text; filled by the ENGINE via voice.buildTtsText unless ttsTextEdited. "" for sponsor/breath/clip
  ttsTextEdited: z.boolean(),
  quoteId: QuoteId.nullable(),
  subtitleTranslation: z.string(), // clip whose quote language ≠ script language: natural translation; else ""
  factIds: z.array(FactRef),
  device: Device,
  breathMs: Ms, // music_breath duration (default 2000), else 0
  /** Secondary languages only: hashJson(primary segment displayText) at transcreation time; mismatch → "out of sync". */
  primaryHash: Sha256.nullable(),
});
export type ScriptSegment = z.infer<typeof ScriptSegment>;

export const ChapterScript = z.object({
  chapterId: ChapterId,
  title: z.string(), // chapter card title in THIS language
  segments: z.array(ScriptSegment),
  loopsOpened: z.array(z.string()),
  loopsClosed: z.array(z.string()),
  summaryForNext: z.string(),
  userEdited: z.boolean(), // set by writeDoc when a user PUT changed this chapter
  locked: z.boolean(), // user toggle; regeneration of userEdited|locked chapters needs forceOverwriteEdits
});
export type ChapterScript = z.infer<typeof ChapterScript>;

/** script/<lang>/script.json is the ONLY source of truth for a language's script. */
export const Script = z
  .object({
    schemaVersion: docVersion("script"),
    lang: Lang,
    outlineHash: Sha256, // docHash(outline) the chapters were written from
    title: z.string(), // video title in this language
    chapters: z.array(ChapterScript),
    lint: z.array(LintIssue),
    generatedBy: z.enum(["llm", "fixture", "user"]),
    updatedAt: IsoDateTime,
  })
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    for (const ch of s.chapters) {
      if (seen.has(ch.chapterId)) ctx.addIssue({ code: "custom", message: `duplicate chapter ${ch.chapterId}` });
      seen.add(ch.chapterId);
      for (const seg of ch.segments) {
        if (seen.has(seg.id)) ctx.addIssue({ code: "custom", message: `duplicate segment ${seg.id}` });
        seen.add(seg.id);
        if (!seg.id.startsWith(ch.chapterId + "-")) {
          ctx.addIssue({ code: "custom", message: `segment ${seg.id} is not in chapter ${ch.chapterId}` });
        }
      }
    }
  });
export type Script = z.infer<typeof Script>;

// ---- fact-check (per language): narration + on-screen text + title/thumbnail/description
export const FactCheckVerdict = z.enum([
  "supported", "partially_supported", "unsupported", "contradicted", "needs_attribution",
  "status_missing_or_outdated", "opinion_ok", "opinion_presented_as_fact", "quote_mismatch",
  "unverified_quote", "private_person_named",
]);
export const FactCheckSurface = z.enum(["narration", "clip-quote", "on-screen", "title", "thumbnail", "description"]);
export const FactCheckItem = z.object({
  id: FactCheckId, // stable across re-runs (resolution and note carry over when the id matches)
  where: z.string(), // segment id | beat id | "title" | "thumbnail" | "description"
  surface: FactCheckSurface,
  sentence: z.string(),
  claimKind: z.enum(["fact", "allegation", "judicial_finding", "opinion", "quote", "number", "speculation"]),
  verdict: FactCheckVerdict,
  risk: z.enum(["none", "low", "medium", "high"]),
  factIds: z.array(z.string()),
  problem: z.string(),
  suggestedRewrite: z.string(),
  origin: z.enum(["llm", "deterministic"]),
  rule: z.string().nullable(), // deterministic rule id ("a".."g") or null
  /** quote_mismatch (deterministic) can never be acknowledged or dismissed — only fixed. */
  resolution: z.enum(["open", "rewritten", "acknowledged", "dismissed"]),
  note: z.string(), // required (≥ 10 chars) for acknowledged/dismissed high items
});
export type FactCheckItem = z.infer<typeof FactCheckItem>;
export const FactCheck = z.object({
  schemaVersion: docVersion("factcheck"),
  lang: Lang,
  scriptHash: Sha256, // docHash(script/<lang>/script.json) checked
  slicesHash: Sha256, // docHash(beats/<lang>.json) checked (on-screen text)
  publishHash: Sha256, // hashJson(project.publish[lang] ?? null)
  items: z.array(FactCheckItem),
  needsMoreResearch: z.array(z.string()),
  titleThumbnailIssues: z.array(z.string()),
  createdAt: IsoDateTime,
});
export type FactCheck = z.infer<typeof FactCheck>;

// ---- inferred types (one per schema constant)
export type FactCheckVerdict = z.infer<typeof FactCheckVerdict>;
export type FactCheckSurface = z.infer<typeof FactCheckSurface>;
```

**Tokenisation rule (normative, `TOKENIZER_VERSION = 1`, `util/tokenize.ts`).**
1. Split the text on `/\s+/u`. JS `\s` includes U+00A0 and U+202F, so `« Bonjour` yields two raw tokens.
2. `norm(tok)`, in this order: NFKD; strip combining marks `\p{M}`; lowercase; map `’ ‘` to `'`; keep only `[\p{L}\p{N}'%€$£.,-]`; trim leading/trailing `'.,-`.
3. A raw token whose `norm` is empty (pure punctuation `« » — … :`) is **merged**: opening marks `« ( [ “ ‘ ¿ ¡` into the next token; every other mark into the previous token; at the start of the text everything merges into the next token.
4. The resulting tokens are the **display words**. `idx` counts from 0 within the segment; `wordId = ${segmentId}:${idx}`; `text` keeps its punctuation; `start`/`end` are character offsets.
5. **What is tokenised is `spokenText(seg, mode)`** (§4.18): narration in `vo` mode → `displayText`; a clip segment in `clip-narrated` mode → `subtitleTranslation || displayText`; every other mode → no words. Voice, layout and director all call `spokenText`, so word ids always index the text that is spoken and captioned.

**Script source of truth.** `script/<lang>/script.json` is the only input any stage reads. Per-chapter LLM outputs are a cache under `script/<lang>/.cache/<CHn>.json`. `editedAfterRecording` is not stored: `voice.editedAfterTake(script, take)` computes it (segment `ttsText` hash ≠ the take's `ttsTextHash`).

### 4.6 `schema/beats.ts`

```ts
// $SP/design/core-v2/src/schema/beats.ts
import { z } from "zod";
import {
  BeatId, ChapterId, FactRef, IsoDateTime, Lang, LintIssue, PersonId, QuoteId, SegmentId, Sha16, Sha256, docVersion,
} from "./common";

export const CueType = z.enum([
  "HOOK", "EMPHASIS", "REVEAL", "SHOCK", "TENSION_BUILD", "NUMBER", "PERSON_INTRO", "PLACE", "TIME_JUMP",
  "QUOTE", "DOCUMENT", "ARTICLE", "TWEET", "CLIP_REF", "LIST", "COMPARISON", "IRONY", "FLASHBACK",
  "CHAPTER", "SENSITIVE", "MONTAGE",
]);
export type CueType = z.infer<typeof CueType>;
export const BeatPurpose = z.enum([
  "hook", "context", "escalation", "reveal", "punchline", "transition", "cliffhanger", "payoff", "callback", "cta",
]);
export const VisualKind = z.enum([
  "stock_broll", "archival_photo", "news_footage", "youtube_clip", "motion_graphic",
  "document_screenshot", "social_post", "map", "text_card", "ai_illustration",
]);
export type VisualKind = z.infer<typeof VisualKind>;
export const MotionTemplate = z.enum([
  "none", "kinetic_text", "counter", "money_counter", "timeline", "bar_chart", "line_chart", "map_route",
  "quote_card", "tweet_card", "headline_stack", "document_highlight", "split_compare", "org_chart",
  "photo_burst", "evidence_board", "comment_pile",
]);
export type MotionTemplate = z.infer<typeof MotionTemplate>;
export const CameraIntent = z.enum(["static", "slow_push_in", "punch_in", "ken_burns", "whip_pan", "shake", "zoom_out_reveal"]);
export const TransitionIntent = z.enum(["cut", "whip", "flash", "glitch", "zoom_through", "crossfade", "dip_to_black"]);
export type TransitionIntent = z.infer<typeof TransitionIntent>;
export const SfxIntent = z.enum([
  "whoosh", "impact", "riser", "sub_boom", "record_scratch", "camera_shutter", "typing", "cash_register",
  "notification", "heartbeat", "glitch", "text_pop", "silence_drop",
]);
export const MusicCue = z.enum(["none", "start", "change_mood", "build", "drop_out", "hit", "duck"]);
export const MusicMood = z.enum(["none", "ominous", "tense", "sad", "uplifting", "comedic", "mysterious", "epic", "chill"]);
export type MusicMood = z.infer<typeof MusicMood>;

/** value: number for NUMBER, name for PERSON_INTRO, date for TIME_JUMP, "bleep" for a SENSITIVE word to bleep, … */
export const CueTag = z.object({ type: CueType, value: z.string() });
export type CueTag = z.infer<typeof CueTag>;

/** Language-neutral visual plan of one beat. Shared by all languages. Ids are assigned in code: `${chapterId}-B${seq3}`. */
export const BeatPlan = z.object({
  id: BeatId,
  chapterId: ChapterId,
  segmentId: SegmentId,
  order: z.number().int().nonnegative(), // global order
  origin: z.enum(["llm", "fallback", "clip", "breath", "user"]),
  purpose: BeatPurpose,
  energy: z.number().int().min(1).max(5),
  estSeconds: z.number().positive(),
  visualKind: VisualKind,
  visualQuery: z.string(), // ENGLISH, literal nouns
  personIds: z.array(PersonId),
  quoteId: QuoteId.nullable(),
  youtubeQuoteToFind: z.string(),
  motionTemplate: MotionTemplate,
  camera: CameraIntent,
  transitionIn: TransitionIntent,
  sfx: z.array(SfxIntent),
  musicCue: MusicCue,
  musicMood: MusicMood,
  factIds: z.array(FactRef),
  cueTags: z.array(CueTag),
  /** sha16(hashJson({visualKind, visualQuery, personIds, motionTemplate, quoteId})). Picks/overrides store it; mismatch → orphaned. */
  planKey: Sha16,
});
export type BeatPlan = z.infer<typeof BeatPlan>;

/**
 * Per-language text of a beat. text is an EXACT contiguous slice of the segment's displayText.
 * Clip beats (-CLIP) and breath beats (-BR) carry NO text: text "", cueAnchorIdx [-1…], emphasisIdx [].
 */
export const BeatLang = z.object({
  beatId: BeatId,
  lang: Lang,
  text: z.string(),
  onScreenText: z.string(),
  /** Parallel to BeatPlan.cueTags: display-word index WITHIN the beat text the cue lands on; -1 = beat start. */
  cueAnchorIdx: z.array(z.number().int().min(-1)),
  emphasisIdx: z.array(z.number().int().nonnegative()), // 0–3 display-word indexes within the beat text
  /** Parsed motion_data_json. Keys are WIRE keys (snake_case), validated by MotionData[template] (§4.11). */
  motionData: z.record(z.string(), z.unknown()),
});
export type BeatLang = z.infer<typeof BeatLang>;

/** beats/plans.json — written by stage `beats` (language-neutral). */
export const BeatPlansDoc = z
  .object({
    schemaVersion: docVersion("beatPlans"),
    primaryLang: Lang,
    chapters: z.array(
      z.object({
        chapterId: ChapterId,
        skeletonHash: Sha256, // hashJson([{id,type,quoteId}]) of the primary chapter when planned
        textHash: Sha256, // hashJson(segment displayTexts) of the primary chapter when planned
        method: z.enum(["llm", "fallback", "fixture", "user"]),
      }),
    ),
    plans: z.array(BeatPlan),
    primary: z.array(BeatLang), // the primary-language slices produced at planning time
    generatedBy: z.enum(["llm", "fixture", "fallback-splitter", "user"]),
    updatedAt: IsoDateTime,
  })
  .superRefine((d, ctx) => {
    const ids = new Set<string>();
    for (const p of d.plans) {
      if (ids.has(p.id)) ctx.addIssue({ code: "custom", message: `duplicate beat ${p.id}` });
      ids.add(p.id);
      if (!p.id.startsWith(p.chapterId + "-") || !p.segmentId.startsWith(p.chapterId + "-")) {
        ctx.addIssue({ code: "custom", message: `beat ${p.id} chapter/segment prefix mismatch` });
      }
    }
  });
export type BeatPlansDoc = z.infer<typeof BeatPlansDoc>;

/** beats/<lang>.json — written by stage `beatslice[lang]`. */
export const BeatSlicesDoc = z.object({
  schemaVersion: docVersion("beatSlices"),
  lang: Lang,
  plansHash: Sha256, // docHash(beats/plans.json)
  scriptHash: Sha256, // docHash(script/<lang>/script.json)
  texts: z.array(BeatLang),
  chapters: z.array(
    z.object({ chapterId: ChapterId, method: z.enum(["planned", "llm", "fallback"]) }),
  ),
  validation: z.array(LintIssue),
  updatedAt: IsoDateTime,
});
export type BeatSlicesDoc = z.infer<typeof BeatSlicesDoc>;

// ---- inferred types (one per schema constant)
export type BeatPurpose = z.infer<typeof BeatPurpose>;
export type CameraIntent = z.infer<typeof CameraIntent>;
export type SfxIntent = z.infer<typeof SfxIntent>;
export type MusicCue = z.infer<typeof MusicCue>;
```

**Beat ids and plan keys.** The LLM returns beats in order; the code validates them and assigns ids `${chapterId}-B${seq3}` (seq per chapter, starting at 1) and `planKey = sha16(hashJson({visualKind, visualQuery, personIds, motionTemplate, quoteId}))`. User picks and overrides store the `planKey` they were made against; a mismatch marks them **orphaned** (shown in the UI, never applied).

**Synthetic beats** (added in code by `llm.syntheticBeats`, never by the LLM):
- **Clip beats**, one per `clip` segment: `id "<segmentId>-CLIP"`, `origin:"clip"`, `visualKind:"youtube_clip"`, `quoteId: segment.quoteId`, `youtubeQuoteToFind: quote.verbatim`, `cueTags:[{type:"CLIP_REF", value: quoteId}]`, `energy 3`, `camera "static"`, `transitionIn "cut"`, `sfx []`, `musicCue "duck"`, `musicMood "none"`, `factIds:[quoteId]`.
- **Breath beats**, one per `music_breath` segment: `id "<segmentId>-BR"`, `origin:"breath"`, `visualKind` and `visualQuery` copied from the previous narration beat of the chapter (else `stock_broll` + the chapter title keywords), `cueTags:[{type:"MONTAGE", value:""}]`, `energy 4`, `musicCue "none"`, `motionTemplate "none"`.
- Their `BeatLang` in **every** language is `{text:"", onScreenText:"", cueAnchorIdx:[-1…], emphasisIdx:[], motionData:{}}`. `beatWordRanges` is never called for clip or breath segments; in layout, a clip beat's word range is its segment's (all words of `spokenText` in `clip-narrated` mode, none otherwise).
- `sponsor_slot` segments get **no** beat and no layout segment (only a marker).

**Anchor indexes.** `cueAnchorIdx[k]` is the display-word index within the beat text that `cueTags[k]` lands on (`-1` = beat start); `emphasisIdx` lists 0–3 word indexes. The wire format carries words; the mapper resolves them to the first occurrence at or after the previous anchor, and a word not found becomes `-1` with a validation warning.

### 4.7 `schema/assets.ts`

```ts
// $SP/design/core-v2/src/schema/assets.ts
import { z } from "zod";
import {
  AssetId, BeatId, IsoDateTime, Lang, Ms, NormPoint, NormRect, PersonId, QuoteId, SegmentId, Sha16, Sha256, Unit,
  docVersion,
} from "./common";
import { AssetProviderId } from "./project";
import { LicenseInfo, UploadDeclaration } from "./license";
import { WordTiming } from "./voice";

export const AssetKind = z.enum(["image", "video", "audio"]);
export type AssetKind = z.infer<typeof AssetKind>;
export const MediaRole = z.enum([
  "broll", "archival", "clip", "portrait", "document", "music", "sfx", "vo", "generated", "user",
]);
export type MediaRole = z.infer<typeof MediaRole>;

export const AssetQuery = z.object({
  beatId: BeatId.nullable(),
  kind: AssetKind,
  role: MediaRole,
  text: z.string(), // English (most APIs)
  localText: z.string().nullable(), // optional query in the subject's language (Commons/LOC)
  entityQid: z.string().regex(/^Q\d+$/).nullable(), // Wikidata P180 depicts
  personIds: z.array(PersonId),
  orientation: z.enum(["landscape", "portrait", "any"]),
  minWidth: z.number().int().nonnegative(),
  durationSec: z.tuple([z.number(), z.number()]).nullable(),
  limit: z.number().int().positive(),
  lang: Lang.nullable(),
});
export type AssetQuery = z.infer<typeof AssetQuery>;

export const YoutubeRef = z.object({
  videoId: z.string(),
  channel: z.string(),
  channelVerified: z.boolean(),
  publishedAt: z.string(),
  url: z.string(),
  startMs: Ms.nullable(), // passage in the SOURCE video (null until found)
  endMs: Ms.nullable(),
  transcriptLang: z.string().nullable(),
  transcriptKind: z.enum(["manual", "asr-orig", "asr", "translated", "local-asr", "none", "user"]),
  matchScore: z.number().min(0).max(1).nullable(),
  matchedText: z.string(),
});
export type YoutubeRef = z.infer<typeof YoutubeRef>;

/** Search result. The provider payload is kept only in assets/candidates/<beatId>.json (CandidateRecord.raw). */
export const Candidate = z.object({
  provider: AssetProviderId,
  providerAssetId: z.string(),
  kind: AssetKind,
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  previewUrl: z.string(), // thumbnail ≤ 768 px (for rerank)
  downloadUrl: z.string(), // "" for youtube (yt-dlp) and procedural
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationSec: z.number().nullable(),
  license: LicenseInfo,
  author: z.object({ name: z.string(), url: z.string().nullable() }).nullable(),
  sourcePageUrl: z.string(),
  retrievedAt: IsoDateTime,
  youtube: YoutubeRef.nullable(),
});
export type Candidate = z.infer<typeof Candidate>;

export const CandidateScore = z.object({
  metadata: Unit,
  clip: Unit.nullable(),
  vision: Unit.nullable(), // Claude rerank relevance/10
  technical: Unit.nullable(),
  watermark: z.boolean().nullable(),
  nsfw: z.boolean().nullable(),
  total: Unit,
  focal: NormPoint.nullable(), // Ken Burns / punch focal point
  safeCrop: NormRect.nullable(), // 16:9 safe crop
  notes: z.string(),
});
export type CandidateScore = z.infer<typeof CandidateScore>;

export const CandidateRecord = z.object({ candidate: Candidate, score: CandidateScore.nullable(), raw: z.unknown() });
export const CandidatesDoc = z.object({
  schemaVersion: docVersion("candidates"),
  beatId: BeatId,
  queries: z.array(AssetQuery),
  records: z.array(CandidateRecord),
});
export type CandidatesDoc = z.infer<typeof CandidatesDoc>;

export const FrozenAsset = z.object({
  id: AssetId, // sha256 of conformed bytes
  originalSha256: Sha256,
  kind: AssetKind,
  role: MediaRole,
  mime: z.string(),
  ext: z.enum(["jpg", "png", "mp4", "wav"]),
  bytes: z.number().int().positive(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationMs: Ms.nullable(),
  fps: z.number().nullable(),
  hasAudio: z.boolean(),
  lufs: z.number().nullable(), // audio-bearing assets after normalisation
  cacheRel: z.string(), // blobs/ab/<sha256>.<ext> relative to DOCMAKER_HOME/cache
  projectRel: z.string(), // media/<id>.<ext> relative to the project dir (hardlink or copy)
  candidate: Candidate.nullable(), // null for procedural/user/generated-in-pipeline assets
  declaration: UploadDeclaration.nullable(), // uploads and local imports
  conform: z.object({
    recipe: z.string(), // "image-v1" | "video-cfr-v1" | "audio-norm-v1" | "clip-v1" | "proc-*-v1" | …
    sourceInMs: Ms.nullable(), // trimmed range in the ORIGINAL media (handles included)
    sourceOutMs: Ms.nullable(),
    handleHeadMs: Ms, // clips/b-roll: media kept BEFORE the wanted range (default 1000)
    handleTailMs: Ms, // media kept AFTER the wanted range (default 1000)
  }),
  analysis: z.object({
    grayscale: z.boolean().nullable(), // mean channel spread < 6/255 (sharp stats) → treatment "bw"
    meanLuma: z.number().nullable(),
    year: z.number().int().nullable(), // EXIF DateTimeOriginal / provider date → treatment "archival" if < 1970
    lowRes: z.boolean(), // image width < 1280
  }),
  frozenAt: IsoDateTime,
});
export type FrozenAsset = z.infer<typeof FrozenAsset>;
export const FrozenDoc = z.object({ schemaVersion: docVersion("frozen"), assets: z.record(AssetId, FrozenAsset) });
export type FrozenDoc = z.infer<typeof FrozenDoc>;

export const AssetPick = z.object({
  beatId: BeatId,
  slot: z.number().int().nonnegative(), // 0 = primary shot, 1.. = additional shots of this beat
  assetId: AssetId,
  role: z.enum(["primary", "alt"]),
  focal: NormPoint, // default {x:.5,y:.45}
  crop: NormRect.nullable(),
  sourceInMs: Ms.nullable(), // video in-point (relative to the conformed file)
  sourceOutMs: Ms.nullable(),
  score: CandidateScore,
  pickedBy: z.enum(["auto", "user"]),
  planKey: Sha16, // BeatPlan.planKey at pick time; mismatch → orphaned (shown, never applied)
});
export type AssetPick = z.infer<typeof AssetPick>;

export const ClipResolution = z.object({
  segmentId: SegmentId,
  quoteId: QuoteId,
  assetId: AssetId.nullable(), // conformed passage WITH handles (video+audio)
  status: z.enum(["found", "manual", "not-found", "skipped-offline", "skipped-policy", "failed"]),
  source: z.enum(["auto", "manual-url", "manual-file"]),
  youtube: YoutubeRef.nullable(),
  /** The quoted passage inside the CONFORMED file (handles excluded): layout uses passageOutMs - passageInMs. */
  passageInMs: Ms.nullable(),
  passageOutMs: Ms.nullable(),
  reason: z.string(),
});
export type ClipResolution = z.infer<typeof ClipResolution>;

/** assets/user-picks.json — USER input (scene board / CLI). Read-only for the assets stage; validated by validatePick on write. */
export const UserPicksDoc = z.object({
  schemaVersion: docVersion("userPicks"),
  picks: z.array(AssetPick),
  portraits: z.array(z.object({ personId: PersonId, assetId: AssetId })),
  clips: z.array(ClipResolution), // manual clip resolutions (URL/file + timecodes)
});
export type UserPicksDoc = z.infer<typeof UserPicksDoc>;


/** assets/picks.json — OUTPUT of the assets stage: auto picks merged with user picks (user wins per (beatId, slot)). */
export const PicksDoc = z.object({
  schemaVersion: docVersion("picks"),
  plansHash: Sha256,
  picks: z.array(AssetPick),
  clips: z.array(ClipResolution),
  portraits: z.array(z.object({ personId: PersonId, assetId: AssetId })),
  orphans: z.array(AssetPick), // user picks whose planKey no longer matches their beat
  updatedAt: IsoDateTime,
});
export type PicksDoc = z.infer<typeof PicksDoc>;

/** assets/clips/<segmentId>.json — transcript words, ms relative to the CONFORMED clip file start. */
export const ClipWordsDoc = z.object({
  schemaVersion: docVersion("clipWords"),
  segmentId: SegmentId,
  assetId: AssetId,
  words: z.array(WordTiming),
});
export type ClipWordsDoc = z.infer<typeof ClipWordsDoc>;

export const EntitiesDoc = z.object({
  schemaVersion: docVersion("entities"),
  entities: z.array(
    z.object({
      personId: PersonId,
      qid: z.string().regex(/^Q\d+$/).nullable(),
      label: z.string(),
      aliases: z.array(z.string()),
      resolvedBy: z.enum(["wbsearchentities", "user", "none"]),
    }),
  ),
});
export type EntitiesDoc = z.infer<typeof EntitiesDoc>;

export const LocalIndexDoc = z.object({
  schemaVersion: docVersion("localIndex"),
  files: z.array(
    z.object({
      path: z.string(), // absolute path at import time
      sha256: Sha256,
      kind: AssetKind,
      tokens: z.array(z.string()),
      tags: z.array(z.string()),
      declaration: UploadDeclaration,
    }),
  ),
});
export type LocalIndexDoc = z.infer<typeof LocalIndexDoc>;

export const LedgerEntry = z.object({
  assetId: AssetId,
  provider: z.union([AssetProviderId, z.literal("voice")]),
  title: z.string(),
  sourcePageUrl: z.string(),
  fileUrl: z.string(),
  author: z.string().nullable(),
  license: LicenseInfo,
  attributionText: z.string(), // always filled (generated from the licence when the provider gives none)
  retrievedAt: IsoDateTime,
  youtube: YoutubeRef.nullable(),
  declaration: UploadDeclaration.nullable(),
  transformations: z.array(z.string()), // "trim 00:01:10–00:01:25", "transcode h264 cfr 30", "exif-rotate", …
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;
/** assets/ledger.json — written ONLY by the assets stage. Per-language usage lives in timeline/<lang>.usage.json. */
export const Ledger = z.object({ schemaVersion: docVersion("ledger"), entries: z.array(LedgerEntry) });
export type Ledger = z.infer<typeof Ledger>;

// ---- inferred types (one per schema constant)
export type CandidateRecord = z.infer<typeof CandidateRecord>;
```

### 4.8 `schema/media.ts` (SFX and music libraries)

```ts
// $SP/design/core-v2/src/schema/media.ts
import { z } from "zod";
import { AssetId, IsoDateTime, Ms, docVersion } from "./common";
import { MusicMood } from "./beats";
import { LicenseInfo } from "./license";

export const SfxCategory = z.enum([
  "whoosh.heavy", "whoosh.light", "whoosh.whip", "whoosh.up", "swell.reverse", "riser",
  "impact", "impact.soft", "boom.sub", "boom.low", "thud",
  "pop", "click", "tick", "ding", "shutter", "glitch", "paper", "marker", "keys", "notification",
  "tape.stop", "bleep", "drone", "heartbeat", "cash", "scratch", "ambience.room", "ambience.crowd",
]);
export type SfxCategory = z.infer<typeof SfxCategory>;
export const SfxSyncPoint = z.enum(["peak", "onset", "end"]);

export const SfxEntry = z.object({
  id: z.string().regex(/^[a-z0-9-]+:[a-z.]+\/\d+$/), // `${pack}:${category}/${variant}` e.g. "procedural:impact/2"
  category: SfxCategory,
  variant: z.number().int().nonnegative(),
  pack: z.string().regex(/^[a-z0-9-]+$/), // "procedural" | "remotion-sfx-cc0" | "hyperframes-pixabay" | "user"
  file: z.string(), // absolute path under DOCMAKER_HOME/sfx/<pack>/<version>/
  assetId: AssetId,
  durationMs: Ms,
  syncPoint: SfxSyncPoint,
  peakOffsetMs: Ms, // position of the sync point from file start (peak | onset | end-30ms)
  peakDbfs: z.number(),
  lufs: z.number().nullable(), // null when < 400 ms (loudnorm can't measure)
  energy: z.number().int().min(1).max(5),
  loopable: z.boolean(), // drones, ambience, keys: may be looped by SfxCue.loop
  direction: z.enum(["LR", "RL", "none"]), // baked pan sweep of the file (procedural whooshes are LR)
  tags: z.array(z.string()),
  license: LicenseInfo,
});
export type SfxEntry = z.infer<typeof SfxEntry>;
export const SfxManifest = z.object({
  schemaVersion: docVersion("sfxManifest"),
  pack: z.string(),
  version: z.string(),
  generatedAt: IsoDateTime,
  entries: z.array(SfxEntry),
});
export type SfxManifest = z.infer<typeof SfxManifest>;

export const MusicTrack = z.object({
  assetId: AssetId, // path = frozen[assetId].projectRel (single source of truth)
  title: z.string(),
  source: z.enum(["procedural", "library", "openverse", "ccmixter", "user"]),
  moods: z.array(MusicMood),
  energy: z.enum(["low", "mid", "high"]),
  bpm: z.number().nullable(),
  beatsMs: z.array(Ms), // beat grid (procedural: exact; library: beats.py when the sidecar is available, else [])
  downbeatsMs: z.array(Ms),
  durationMs: Ms,
  lufs: z.number(), // after normalisation (target -18 LUFS integrated)
  loopable: z.boolean(),
  license: LicenseInfo,
});
export type MusicTrack = z.infer<typeof MusicTrack>;
export const MusicDoc = z.object({ schemaVersion: docVersion("music"), tracks: z.array(MusicTrack) });
export type MusicDoc = z.infer<typeof MusicDoc>;

// ---- inferred types (one per schema constant)
export type SfxSyncPoint = z.infer<typeof SfxSyncPoint>;
```

### 4.9 `schema/voice.ts`

```ts
// $SP/design/core-v2/src/schema/voice.ts
import { z } from "zod";
import { IsoDateTime, Lang, Ms, SegmentId, Sha256, TakeId, WordId, docVersion } from "./common";
import { VoiceProviderId } from "./project";
import { LicenseInfo } from "./license";

/** Provider/ASR-level timing, before mapping to script word ids. */
export const WordTiming = z.object({
  text: z.string(),
  startMs: Ms,
  endMs: Ms,
  confidence: z.number().min(0).max(1).nullable(),
});
export type WordTiming = z.infer<typeof WordTiming>;

export const TimingSource = z.enum(["provider", "aligned", "interpolated", "estimated", "synthetic"]);
export type TimingSource = z.infer<typeof TimingSource>;

/** Timing of one DISPLAY word (script word id), relative to its segment file start. Shifted times are clamped ≥ 0. */
export const TimedWord = z.object({
  wordId: WordId,
  text: z.string(),
  startMs: Ms,
  endMs: Ms,
  confidence: z.number().min(0).max(1).nullable(),
  source: TimingSource,
});
export type TimedWord = z.infer<typeof TimedWord>;

export const SegmentTake = z.object({
  segmentId: SegmentId,
  mode: z.enum(["narration", "clip-narrated"]),
  file: z.string(), // project-relative: voice/<lang>/<takeId>/seg/<segmentId>.wav (48 kHz mono s16, post-chain)
  sha256: Sha256,
  durationMs: Ms,
  ttsText: z.string(),
  ttsTextHash: Sha256, // hashJson(ttsText)
  cacheKey: Sha256, // §8.4 segment cache key (provider|voice|settings|ttsTextHash|context|POST_CHAIN_VERSION)
  leadTrimMs: Ms, // leading silence removed (words already shifted)
  words: z.array(TimedWord),
  providerRequestId: z.string().nullable(),
  asrWer: z.number().min(0).nullable(), // round-trip QA when an ASR is available
  pickup: z.boolean(), // recording take: segment synthesised by pickupProvider ("PICKUP TTS" marker)
});
export type SegmentTake = z.infer<typeof SegmentTake>;

export const VoiceTrack = z.object({
  schemaVersion: docVersion("voiceTrack"),
  id: TakeId, // deterministic: (take|scratch)-<sha12(provider|voiceId|settingsHash|sorted segment cacheKeys)>
  kind: z.enum(["scratch", "final"]), // scratch = free synthetic/estimated take used for preview before the paid take
  lang: Lang,
  provider: VoiceProviderId,
  voiceId: z.string(),
  modelId: z.string().nullable(),
  settingsHash: Sha256,
  license: LicenseInfo, // voice licence (Piper CC-BY → attribution; ElevenLabs tier) → credits "Voice" group
  createdAt: IsoDateTime,
  segments: z.array(SegmentTake),
  missingSegmentIds: z.array(SegmentId), // e.g. the user recording did not cover them
  charsBilled: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  timing: z.object({ source: TimingSource, meanConfidence: z.number().nullable() }),
  notes: z.array(z.string()),
});
export type VoiceTrack = z.infer<typeof VoiceTrack>;

export const ActiveTake = z.object({
  schemaVersion: docVersion("activeTake"),
  lang: Lang,
  takeId: TakeId,
  setAt: IsoDateTime,
});
export type ActiveTake = z.infer<typeof ActiveTake>;
```

### 4.10 `schema/layout.ts` (the program clock)

```ts
// $SP/design/core-v2/src/schema/layout.ts
import { z } from "zod";
import {
  ActId, AssetId, BeatId, ChapterId, Fps, Frame, Lang, Ms, PosFrames, SegmentId, Sha256, TakeId, WordId, docVersion,
} from "./common";

export const Pauses = z.object({
  headMs: Ms, // silence before the first word of the program
  segmentGapMs: Ms, // between consecutive narration segments
  deviceGapMs: Ms, // after a segment whose device is cliffhanger|reveal|rhetorical_question
  chapterGapMs: Ms, // minimum gap before each chapter except the first (chapter card / title sting breathe here)
  preRevealMs: Ms, // silence inserted before the chapter's REVEAL anchor word (VO split at a word boundary)
  clipLeadMs: Ms, // before a clip segment
  clipTailMs: Ms, // after a clip segment
  tailMs: Ms, // after the last word (outro music)
});
export type Pauses = z.infer<typeof Pauses>;

/** sponsor_slot segments produce NO layout segment (only a marker). */
export const LayoutSegmentMode = z.enum(["vo", "clip", "clip-narrated", "clip-card", "breath"]);
export type LayoutSegmentMode = z.infer<typeof LayoutSegmentMode>;

export const LayoutWord = z.object({
  id: WordId,
  segmentId: SegmentId,
  idx: z.number().int().nonnegative(),
  text: z.string(),
  norm: z.string(),
  from: Frame,
  dur: PosFrames, // end = max(from+1, min(msToFrame(endMs), nextWord.from))
  startMs: Ms, // absolute program time
  endMs: Ms,
});
export type LayoutWord = z.infer<typeof LayoutWord>;

export const LayoutSegment = z.object({
  segmentId: SegmentId,
  chapterId: ChapterId,
  mode: LayoutSegmentMode,
  from: Frame,
  dur: PosFrames,
  startMs: Ms, // frame-quantised: startMs = frameToMs(msToFrame(raw))
  endMs: Ms,
  voFile: z.string().nullable(), // segment wav (project-relative) for vo | clip-narrated
  voAssetId: z.string().nullable(), // sha256 of the segment wav
  clipAssetId: AssetId.nullable(),
  clipPassageInMs: Ms.nullable(), // clip: passage start inside the conformed clip file
  /** Silence inserted INSIDE the segment audio (REVEAL pre-pause): samples after splitAtMs move later by ms. ≤ 1 in v1. */
  insertions: z.array(z.object({ afterWordIdx: z.number().int().nonnegative(), splitAtMs: Ms, ms: Ms })),
  wordStart: z.number().int().nonnegative(), // index into ProgramLayout.words
  wordEnd: z.number().int().nonnegative(), // exclusive
});
export type LayoutSegment = z.infer<typeof LayoutSegment>;

/** Beats tile their CHAPTER: first beat starts at chapter.from, last ends at chapter end. */
export const LayoutBeat = z.object({
  beatId: BeatId,
  segmentId: SegmentId,
  chapterId: ChapterId,
  from: Frame,
  dur: PosFrames,
  onsetFrame: Frame, // first word onset (= from for clip/breath/first-of-chapter beats without words)
  wordStart: z.number().int().nonnegative(),
  wordEnd: z.number().int().nonnegative(),
});
export type LayoutBeat = z.infer<typeof LayoutBeat>;

export const ProgramLayout = z.object({
  schemaVersion: docVersion("layout"),
  lang: Lang,
  fps: Fps,
  takeId: TakeId,
  takeKind: z.enum(["scratch", "final"]),
  scriptHash: Sha256,
  plansHash: Sha256,
  slicesHash: Sha256,
  onlyChapters: z.array(ChapterId).nullable(),
  pauses: Pauses,
  durationInFrames: PosFrames,
  durationMs: Ms,
  chapters: z.array(
    z.object({
      chapterId: ChapterId, title: z.string(), act: ActId, macroAct: z.enum(["setup", "confrontation", "resolution"]),
      from: Frame, dur: PosFrames, firstWordFrame: Frame.nullable(),
    }),
  ),
  segments: z.array(LayoutSegment),
  beats: z.array(LayoutBeat),
  words: z.array(LayoutWord),
  sponsorMarkers: z.array(z.object({ segmentId: SegmentId, frame: Frame })),
  voProgram: z.object({
    assetId: AssetId, // program/<lang>/vo_program.wav, 48 kHz mono, normalised to -16 LUFS (gain BAKED IN)
    projectRel: z.string(),
    bakedGainDb: z.number(), // informational: gain baked into vo_program.wav; NLE VoClips apply it to segment files
    durationMs: Ms,
  }),
});
export type ProgramLayout = z.infer<typeof ProgramLayout>;
```

### 4.11 `schema/components.ts` (the closed overlay vocabulary)

```ts
// $SP/design/core-v2/src/schema/components.ts
import { z } from "zod";
import { AssetId, Color, NormRect, Unit } from "./common";
import { SfxCategory } from "./media";
import type { CueType, MotionTemplate } from "./beats";

export const OverlayComponentId = z.enum([
  "LowerThird", "ChapterCard", "TitleSting", "QuoteCard", "SocialPost", "ArticleHighlight", "DocumentCard",
  "HeadlineStack", "Stamp", "KeywordSlam", "NumberCounter", "DateStamp", "MapPin", "TimelineGraphic",
  "BarChart", "SplitScreen", "CensorBar", "Spotlight", "KineticText", "SourceLabel", "Letterbox",
  "FreezeLabel", "PhotoBurst", "EvidenceBoard", "CommentPile",
]);
export type OverlayComponentId = z.infer<typeof OverlayComponentId>;
export const OverlayBand = z.enum(["picture", "graphics", "hud"]); // picture = inside camera rig & grade
export type OverlayBand = z.infer<typeof OverlayBand>;
export const ZoneName = z.enum(["center", "lowerThird", "topLeft", "topRight", "full", "captionBand"]);
export type ZoneName = z.infer<typeof ZoneName>;
/** card = contain-fit framed photo (border, tilt, shadow) over a drifting style backdrop (Moon/SunnyV2 look). */
export const ClipLayout = z.enum(["cover", "contain-blur", "card", "pip", "split-left", "split-right"]);
export type ClipLayout = z.infer<typeof ClipLayout>;

const int = z.number().int();
const at = int.nonnegative(); // frame offset RELATIVE TO THE ITEM'S `from` (VO-synced sub-beats; derived, §4.13)

export const LowerThirdProps = z.object({ name: z.string().min(1).max(48), role: z.string().max(72), align: z.enum(["left", "right"]) });
export const ChapterCardProps = z.object({
  index: int.positive(), total: int.positive(), title: z.string().min(1).max(60),
  kicker: z.string().max(40), // "CHAPTER 3" | "CHAPITRE 3"
  letterbox: z.boolean(),
  backdrop: z.enum(["gradientGrid", "paper", "darkNoise"]), // never flat ink (QA blackdetect)
});
export const TitleStingProps = z.object({
  title: z.string().min(1).max(80), // the video title (Script.title)
  kicker: z.string().max(60), // "CHAPTER 1 · <chapter title>" | ""
  mode: z.enum(["slam", "type"]),
  backdrop: z.enum(["gradientGrid", "paper", "darkNoise"]),
});
export const QuoteCardProps = z.object({
  text: z.string().min(1).max(400), speaker: z.string().max(60), sourceLabel: z.string().max(80),
  portraitAssetId: AssetId.nullable(), translated: z.boolean(),
  words: z.array(z.object({ text: z.string(), at, emphasis: z.boolean() })), // [] → static text
});
export const SocialPostProps = z.object({
  variant: z.enum(["post", "comment", "forum"]), displayName: z.string().max(50), handle: z.string().max(40),
  body: z.string().max(400), timestampLabel: z.string().max(40),
  likes: z.number().nullable(), reposts: z.number().nullable(), replies: z.number().nullable(),
  avatarAssetId: AssetId.nullable(), imageAssetId: AssetId.nullable(), verified: z.boolean(), // generic card, NO platform logos
  theme: z.enum(["light", "dark"]),
  revealAt: at, // counters start running / body highlight when the VO reaches the quoted body
});
export const ArticleHighlightProps = z.object({
  outlet: z.string().max(60), headline: z.string().max(160), dateLabel: z.string().max(40),
  paragraphs: z.array(z.string().max(600)).min(1).max(6),
  highlight: z.object({ paragraph: int.nonnegative(), start: int.nonnegative(), end: int.positive() }).nullable(),
  highlightAt: at, // highlighter sweep starts when the VO reaches the highlighted passage
  screenshotAssetId: AssetId.nullable(),
});
export const DocumentCardProps = z.object({
  docType: z.enum(["court", "letter", "report", "contract", "pamphlet"]), title: z.string().max(120),
  lines: z.array(z.string().max(120)).min(1).max(14),
  redactions: z.array(z.object({ line: int.nonnegative(), start: int.nonnegative(), end: int.positive() })),
  stamp: z.string().max(24).nullable(), sourceLabel: z.string().max(80),
  stampAt: at, redactAt: at,
});
export const HeadlineStackProps = z.object({
  items: z.array(z.object({
    outlet: z.string().max(40), headline: z.string().max(140), dateLabel: z.string().max(30),
    at, tiltDeg: z.number().min(-4).max(4),
  })).min(1).max(5),
});
export const StampProps = z.object({ text: z.string().min(1).max(24), color: Color, rotationDeg: z.number().min(-15).max(15), x: Unit, y: Unit, scale: z.number().min(0.5).max(2) });
export const KeywordSlamProps = z.object({ text: z.string().min(1).max(28), color: Color, background: z.enum(["black", "transparent", "blur"]) });
export const NumberCounterProps = z.object({
  value: z.number(), from: z.number(), format: z.enum(["number", "currency", "percent", "compact"]),
  currency: z.enum(["USD", "EUR", "GBP", "NLG"]).nullable(), decimals: int.min(0).max(3), label: z.string().max(60),
  locale: z.enum(["en-US", "fr-FR"]), color: Color,
});
export const DateStampProps = z.object({ text: z.string().min(1).max(48), zone: z.enum(["topLeft", "topRight"]) });
export const MapPinProps = z.object({
  places: z.array(z.object({ label: z.string().max(40), lon: z.number().min(-180).max(180), lat: z.number().min(-90).max(90), at })).min(1).max(6),
  route: z.boolean(), region: z.enum(["world", "europe", "north-america", "auto"]), look: z.enum(["paper", "dark"]),
});
export const TimelineGraphicProps = z.object({
  events: z.array(z.object({ dateLabel: z.string().max(24), label: z.string().max(60), at })).min(2).max(8),
  activeIndex: int.min(-1),
});
export const BarChartProps = z.object({
  title: z.string().max(80), unit: z.string().max(16), sourceLabel: z.string().max(80),
  bars: z.array(z.object({ label: z.string().max(30), value: z.number(), highlight: z.boolean() })).min(2).max(8),
});
export const SplitScreenProps = z.object({
  left: z.object({ assetId: AssetId.nullable(), label: z.string().max(40) }),
  right: z.object({ assetId: AssetId.nullable(), label: z.string().max(40) }),
  dividerColor: Color,
});
export const CensorBarProps = z.object({ rect: NormRect, mode: z.enum(["bar", "pixelate", "blur"]), label: z.string().max(24).nullable() });
export const SpotlightProps = z.object({ cx: Unit, cy: Unit, rx: Unit, ry: Unit, dim: Unit, drawCircle: z.boolean(), color: Color });
export const KineticTextProps = z.object({ lines: z.array(z.string().max(48)).min(1).max(4), emphasis: z.array(z.string()), align: z.enum(["left", "center"]) });
export const SourceLabelProps = z.object({
  text: z.string().min(1).max(80),
  kind: z.enum(["source", "illustration", "reconstruction", "translated", "synthetic-voice", "archive", "scratch-voice", "pickup-tts"]),
  zone: z.enum(["topLeft", "topRight"]),
});
export const LetterboxProps = z.object({ ratio: z.number().min(1.85).max(2.76) });
/** Freeze-frame + name slam on a VIDEO shot: the item renders the frozen source frame itself (self-contained). */
export const FreezeLabelProps = z.object({
  assetId: AssetId, sourceFrame: int.nonnegative(), // media frame to freeze (the underlying shot's source frame at item.from)
  name: z.string().min(1).max(48), role: z.string().max(72),
  desaturate: Unit, darken: Unit, // over 3 f: desaturate .8, darken .25
});
export const PhotoBurstProps = z.object({
  items: z.array(z.object({ assetId: AssetId, at, tiltDeg: z.number().min(-6).max(6), x: Unit, y: Unit })).min(3).max(8),
  scaleFrom: z.number().min(0.9).max(1.2), scaleTo: z.number().min(0.9).max(1.3),
  caption: z.string().max(60),
});
export const EvidenceBoardProps = z.object({
  items: z.array(z.object({
    assetId: AssetId.nullable(), label: z.string().max(40),
    x: z.number().min(0).max(3840), y: z.number().min(0).max(2160), w: z.number().min(200).max(1600), rotDeg: z.number().min(-6).max(6),
    at,
  })).min(2).max(6),
  moves: z.array(z.object({ at, focus: int.min(-1), frames: int.min(12).max(40) })), // focus -1 = overview
  links: z.array(z.tuple([int.nonnegative(), int.nonnegative()])),
  backdrop: z.enum(["cork", "paper", "dark"]),
});
export const CommentPileProps = z.object({
  items: z.array(z.object({
    displayName: z.string().max(40), handle: z.string().max(40), body: z.string().max(160),
    at, x: Unit, y: Unit, rotDeg: z.number().min(-5).max(5),
  })).min(3).max(10),
  dim: Unit, theme: z.enum(["light", "dark"]),
});

export const OVERLAY_PROPS = {
  LowerThird: LowerThirdProps, ChapterCard: ChapterCardProps, TitleSting: TitleStingProps, QuoteCard: QuoteCardProps,
  SocialPost: SocialPostProps, ArticleHighlight: ArticleHighlightProps, DocumentCard: DocumentCardProps,
  HeadlineStack: HeadlineStackProps, Stamp: StampProps, KeywordSlam: KeywordSlamProps, NumberCounter: NumberCounterProps,
  DateStamp: DateStampProps, MapPin: MapPinProps, TimelineGraphic: TimelineGraphicProps, BarChart: BarChartProps,
  SplitScreen: SplitScreenProps, CensorBar: CensorBarProps, Spotlight: SpotlightProps, KineticText: KineticTextProps,
  SourceLabel: SourceLabelProps, Letterbox: LetterboxProps, FreezeLabel: FreezeLabelProps, PhotoBurst: PhotoBurstProps,
  EvidenceBoard: EvidenceBoardProps, CommentPile: CommentPileProps,
} as const satisfies Record<OverlayComponentId, z.ZodType>;

/**
 * How long a component must stay readable (§9.5):
 *  formula  — readHold = enter + S(max(1.5, chars/15 + 1.5))          (chars over textFields; CJK chars/4.5)
 *  glance   — readHold = enter + S(0.4)   (DateStamp: enter + typeFrames + F30(30))
 *  title    — readHold = enter + S(max(1.2, chars/20 + 0.8))          (big single-line titles)
 *  narrated — readHold = (last narrated word end − item.from) + S(0.6) when VO-synced, else formula
 *  none     — no text to read
 * dur = clamp(readHold, minHold, maxHold); readHold > maxHold → text truncated (formula) or a READABILITY warning — never an error.
 */
export interface ReadPolicy { mode: "formula" | "glance" | "title" | "narrated" | "none"; textFields: readonly string[] }
export interface ComponentMeta {
  band: OverlayBand;
  defaultZone: ZoneName;
  nle: "overlay" | "marker"; // overlay = ProRes 4444 item render when --overlays (M3), else marker
  overshootAllowed: boolean; // whitelisted impact components only
  minHold30: number; // frames @30fps (scale with framesAt())
  maxHold30: number;
  enter30: number;
  exit30: number;
  fullFrame: boolean; // occludes picture/captions
  defaultSfx: SfxCategory[];
  priority: number; // conflict resolution (higher wins)
  read: ReadPolicy;
  followsCamera: boolean; // punch/zoom fx (not shake) also apply to this graphics item ("zoom on the tweet")
  continuousMotion: boolean; // the component itself keeps moving over its hold (push 1.0→1.05 + backdrop drift)
  milestone: "M1" | "M2"; // implementation priority; unimplemented components render FallbackCard (KineticText look)
}
const M = (m: ComponentMeta) => m;
export const COMPONENT_META: Record<OverlayComponentId, ComponentMeta> = {
  LowerThird:       M({ band: "graphics", defaultZone: "lowerThird", nle: "overlay", overshootAllowed: false, minHold30: 90, maxHold30: 150, enter30: 10, exit30: 8, fullFrame: false, defaultSfx: ["pop"], priority: 5, read: { mode: "formula", textFields: ["name", "role"] }, followsCamera: false, continuousMotion: true, milestone: "M1" }),
  ChapterCard:      M({ band: "graphics", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 72, maxHold30: 150, enter30: 12, exit30: 10, fullFrame: true, defaultSfx: ["impact"], priority: 10, read: { mode: "title", textFields: ["title"] }, followsCamera: false, continuousMotion: true, milestone: "M1" }),
  TitleSting:       M({ band: "graphics", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 90, maxHold30: 120, enter30: 8, exit30: 10, fullFrame: true, defaultSfx: ["impact"], priority: 10, read: { mode: "title", textFields: ["title"] }, followsCamera: false, continuousMotion: true, milestone: "M1" }),
  QuoteCard:        M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 75, maxHold30: 600, enter30: 10, exit30: 8, fullFrame: true, defaultSfx: ["paper"], priority: 9, read: { mode: "narrated", textFields: ["text"] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
  SocialPost:       M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 75, maxHold30: 300, enter30: 12, exit30: 8, fullFrame: false, defaultSfx: ["notification"], priority: 7, read: { mode: "narrated", textFields: ["displayName", "body"] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
  ArticleHighlight: M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 90, maxHold30: 300, enter30: 12, exit30: 8, fullFrame: true, defaultSfx: ["paper", "marker"], priority: 7, read: { mode: "narrated", textFields: ["headline"] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
  DocumentCard:     M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 90, maxHold30: 300, enter30: 12, exit30: 8, fullFrame: true, defaultSfx: ["paper", "thud"], priority: 7, read: { mode: "narrated", textFields: ["title"] }, followsCamera: true, continuousMotion: true, milestone: "M1" }),
  HeadlineStack:    M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 75, maxHold30: 240, enter30: 15, exit30: 8, fullFrame: true, defaultSfx: ["paper"], priority: 7, read: { mode: "narrated", textFields: ["items.headline"] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
  Stamp:            M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: true, minHold30: 45, maxHold30: 120, enter30: 3, exit30: 6, fullFrame: false, defaultSfx: ["thud", "click"], priority: 6, read: { mode: "glance", textFields: ["text"] }, followsCamera: false, continuousMotion: false, milestone: "M1" }),
  KeywordSlam:      M({ band: "graphics", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 12, maxHold30: 20, enter30: 6, exit30: 0, fullFrame: true, defaultSfx: ["boom.sub"], priority: 8, read: { mode: "glance", textFields: ["text"] }, followsCamera: false, continuousMotion: false, milestone: "M1" }),
  NumberCounter:    M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 45, maxHold30: 150, enter30: 8, exit30: 8, fullFrame: false, defaultSfx: ["tick", "ding"], priority: 8, read: { mode: "formula", textFields: ["label"] }, followsCamera: false, continuousMotion: true, milestone: "M1" }),
  DateStamp:        M({ band: "graphics", defaultZone: "topLeft", nle: "overlay", overshootAllowed: false, minHold30: 45, maxHold30: 120, enter30: 0, exit30: 6, fullFrame: false, defaultSfx: ["keys"], priority: 4, read: { mode: "glance", textFields: ["text"] }, followsCamera: false, continuousMotion: false, milestone: "M1" }),
  MapPin:           M({ band: "graphics", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 75, maxHold30: 240, enter30: 10, exit30: 8, fullFrame: true, defaultSfx: ["whoosh.light", "pop"], priority: 7, read: { mode: "glance", textFields: ["places.label"] }, followsCamera: false, continuousMotion: true, milestone: "M1" }),
  TimelineGraphic:  M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 75, maxHold30: 240, enter30: 10, exit30: 8, fullFrame: true, defaultSfx: ["tick"], priority: 7, read: { mode: "glance", textFields: ["events.label"] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
  BarChart:         M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 75, maxHold30: 240, enter30: 10, exit30: 8, fullFrame: true, defaultSfx: ["tick"], priority: 7, read: { mode: "formula", textFields: ["title"] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
  SplitScreen:      M({ band: "picture", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 60, maxHold30: 240, enter30: 10, exit30: 0, fullFrame: true, defaultSfx: ["whoosh.light"], priority: 6, read: { mode: "glance", textFields: ["left.label", "right.label"] }, followsCamera: false, continuousMotion: true, milestone: "M2" }),
  CensorBar:        M({ band: "picture", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 6, maxHold30: 9000, enter30: 0, exit30: 0, fullFrame: false, defaultSfx: [], priority: 10, read: { mode: "none", textFields: [] }, followsCamera: false, continuousMotion: false, milestone: "M2" }),
  Spotlight:        M({ band: "picture", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 30, maxHold30: 180, enter30: 9, exit30: 6, fullFrame: false, defaultSfx: ["marker"], priority: 5, read: { mode: "none", textFields: [] }, followsCamera: false, continuousMotion: false, milestone: "M2" }),
  KineticText:      M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 45, maxHold30: 180, enter30: 8, exit30: 6, fullFrame: false, defaultSfx: ["pop"], priority: 6, read: { mode: "formula", textFields: ["lines"] }, followsCamera: false, continuousMotion: true, milestone: "M1" }),
  SourceLabel:      M({ band: "hud", defaultZone: "topLeft", nle: "marker", overshootAllowed: false, minHold30: 45, maxHold30: 9000, enter30: 6, exit30: 6, fullFrame: false, defaultSfx: [], priority: 3, read: { mode: "none", textFields: [] }, followsCamera: false, continuousMotion: false, milestone: "M1" }),
  Letterbox:        M({ band: "hud", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 20, maxHold30: 9000, enter30: 20, exit30: 20, fullFrame: false, defaultSfx: [], priority: 2, read: { mode: "none", textFields: [] }, followsCamera: false, continuousMotion: false, milestone: "M2" }),
  FreezeLabel:      M({ band: "picture", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 45, maxHold30: 120, enter30: 3, exit30: 8, fullFrame: true, defaultSfx: ["shutter", "impact"], priority: 8, read: { mode: "formula", textFields: ["name"] }, followsCamera: false, continuousMotion: true, milestone: "M2" }),
  PhotoBurst:       M({ band: "graphics", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 60, maxHold30: 240, enter30: 0, exit30: 8, fullFrame: true, defaultSfx: ["shutter", "riser", "impact"], priority: 8, read: { mode: "none", textFields: [] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
  EvidenceBoard:    M({ band: "graphics", defaultZone: "full", nle: "overlay", overshootAllowed: false, minHold30: 90, maxHold30: 450, enter30: 12, exit30: 10, fullFrame: true, defaultSfx: ["whoosh.heavy", "click"], priority: 7, read: { mode: "glance", textFields: ["items.label"] }, followsCamera: false, continuousMotion: true, milestone: "M2" }),
  CommentPile:      M({ band: "graphics", defaultZone: "center", nle: "overlay", overshootAllowed: false, minHold30: 60, maxHold30: 240, enter30: 0, exit30: 8, fullFrame: true, defaultSfx: ["pop"], priority: 6, read: { mode: "narrated", textFields: ["items.body"] }, followsCamera: true, continuousMotion: true, milestone: "M2" }),
};

/**
 * Lenient schemas for the LLM's motion_data_json (snake_case wire keys, kept as-is in BeatLang.motionData).
 * Fact refs are REQUIRED for every string that would put words in a real person's/outlet's mouth or show a number:
 * validateBeats (§6.3) checks them against the FactSheet; a failed check downgrades the beat to kinetic_text +
 * SourceLabel{reconstruction}. Numeric fields of secondary languages are copied from the primary language.
 */
const s = z.string();
export const MotionData = {
  kinetic_text: z.object({ lines: z.array(s).min(1).max(4), emphasis: z.array(s).default([]) }),
  counter: z.object({ figure_id: s, value: z.number(), from: z.number().default(0), label: s.default(""), unit: s.default(""), decimals: int.min(0).max(3).default(0), format: z.enum(["number", "percent", "compact"]).default("number") }),
  money_counter: z.object({ figure_id: s, value: z.number(), from: z.number().default(0), currency: z.enum(["USD", "EUR", "GBP", "NLG"]).default("USD"), label: s.default(""), compact: z.boolean().default(true) }),
  timeline: z.object({ events: z.array(z.object({ date: s, label: s, event_id: s.default("") })).min(2).max(8), active_index: int.default(-1) }),
  bar_chart: z.object({ title: s.default(""), unit: s.default(""), source_id: s.default(""), bars: z.array(z.object({ label: s, value: z.number(), figure_id: s, highlight: z.boolean().default(false) })).min(2).max(8) }),
  line_chart: z.object({ title: s.default(""), unit: s.default(""), source_id: s.default(""), bars: z.array(z.object({ label: s, value: z.number(), figure_id: s, highlight: z.boolean().default(false) })).min(2).max(8) }), // rendered as BarChart in v1
  map_route: z.object({ places: z.array(z.object({ label: s, lon: z.number(), lat: z.number() })).min(1).max(6), route: z.boolean().default(false), region: z.enum(["world", "europe", "north-america", "auto"]).default("auto") }),
  quote_card: z.object({ quote_id: s, text: s, speaker: s, source: s.default(""), date: s.default("") }),
  tweet_card: z.object({ quote_id: s, display_name: s, handle: s.default(""), body: s, date: s.default(""), likes: z.number().nullable().default(null), reposts: z.number().nullable().default(null), replies: z.number().nullable().default(null), variant: z.enum(["post", "comment", "forum"]).default("post") }),
  headline_stack: z.object({ items: z.array(z.object({ source_id: s, outlet: s, headline: s, date: s.default("") })).min(1).max(5) }),
  document_highlight: z.object({ source_id: s, quote_id: s.default(""), kind: z.enum(["article", "court", "letter", "report", "pamphlet"]).default("article"), outlet: s.default(""), title: s, date: s.default(""), paragraphs: z.array(s).min(1).max(6), highlight: s.default(""), redact: z.array(s).default([]) }),
  split_compare: z.object({ left_label: s, right_label: s, left_query: s.default(""), right_query: s.default("") }),
  org_chart: z.object({ nodes: z.array(z.object({ label: s, role: s.default("") })).min(1).max(8) }), // rendered as KineticText in v1
  photo_burst: z.object({ count: int.min(3).max(8).default(5), caption: s.default("") }), // images = beat picks slots 0..count-1
  evidence_board: z.object({ items: z.array(z.object({ label: s, person_id: s.default(""), source_id: s.default("") })).min(2).max(6), links: z.array(z.tuple([int, int])).default([]) }),
  comment_pile: z.object({ items: z.array(z.object({ quote_id: s })).min(3).max(10) }), // bodies = Quote.verbatim; names from speakers
} as const;
export type MotionDataKey = keyof typeof MotionData;

/** Motion template → overlay component (§4.11 table). */
export const TEMPLATE_COMPONENT: Readonly<Record<Exclude<MotionTemplate, "none">, OverlayComponentId>> = {
  kinetic_text: "KineticText", counter: "NumberCounter", money_counter: "NumberCounter", timeline: "TimelineGraphic",
  bar_chart: "BarChart", line_chart: "BarChart", map_route: "MapPin", quote_card: "QuoteCard", tweet_card: "SocialPost",
  headline_stack: "HeadlineStack", document_highlight: "DocumentCard", // kind "article" → ArticleHighlight
  split_compare: "SplitScreen", org_chart: "KineticText", photo_burst: "PhotoBurst", evidence_board: "EvidenceBoard",
  comment_pile: "CommentPile",
};
/**
 * Cue types for which the director has a DERIVATION rule (§9.3 step 7g) per component. A style trigger outside this
 * table is a style lint error (validateStyleData). Structural components (ChapterCard, TitleSting) and template-only
 * components have [] here.
 */
export const DERIVABLE_TRIGGERS: Readonly<Record<OverlayComponentId, readonly CueType[]>> = {
  LowerThird: ["PERSON_INTRO"], ChapterCard: [], TitleSting: [], QuoteCard: ["QUOTE"], SocialPost: ["TWEET"],
  ArticleHighlight: [], DocumentCard: [], HeadlineStack: [], Stamp: ["REVEAL"], KeywordSlam: ["SHOCK"],
  NumberCounter: ["NUMBER"], DateStamp: ["TIME_JUMP"], MapPin: [], TimelineGraphic: [], BarChart: [],
  SplitScreen: ["COMPARISON"], CensorBar: ["SENSITIVE"], Spotlight: ["DOCUMENT", "EMPHASIS"], KineticText: ["LIST", "EMPHASIS"],
  SourceLabel: ["CLIP_REF"], Letterbox: [], FreezeLabel: ["PERSON_INTRO"], PhotoBurst: ["LIST", "MONTAGE"],
  EvidenceBoard: ["LIST"], CommentPile: [],
};
/** Words a Stamp may show (REVEAL). Status-gated words need a cited claim with that status on the beat. */
export const STAMP_LEXICON = {
  en: ["BANKRUPT", "CANCELLED", "FIRED", "DELISTED", "SOLD", "SETTLED", "DISMISSED", "ACQUITTED", "OVERTURNED", "CLOSED", "DEBUNKED", "CONFIRMED", "DENIED", "OVER", "COLLAPSED", "RECALLED"],
  fr: ["FAILLITE", "ANNULÉ", "LICENCIÉ", "RADIÉ", "VENDU", "RÉGLÉ", "REJETÉ", "ACQUITTÉ", "INFIRMÉ", "FERMÉ", "DÉMENTI", "CONFIRMÉ", "NIÉ", "TERMINÉ", "EFFONDRÉ", "RAPPELÉ"],
  statusGated: { CONVICTED: "criminal_conviction", GUILTY: "criminal_conviction", "CONDAMNÉ": "criminal_conviction", "COUPABLE": "criminal_conviction", LIABLE: "judicial_finding_civil", "RESPONSABLE": "judicial_finding_civil" },
} as const;

// ---- inferred types (one per schema constant)
export type LowerThirdProps = z.infer<typeof LowerThirdProps>;
export type ChapterCardProps = z.infer<typeof ChapterCardProps>;
export type TitleStingProps = z.infer<typeof TitleStingProps>;
export type QuoteCardProps = z.infer<typeof QuoteCardProps>;
export type SocialPostProps = z.infer<typeof SocialPostProps>;
export type ArticleHighlightProps = z.infer<typeof ArticleHighlightProps>;
export type DocumentCardProps = z.infer<typeof DocumentCardProps>;
export type HeadlineStackProps = z.infer<typeof HeadlineStackProps>;
export type StampProps = z.infer<typeof StampProps>;
export type KeywordSlamProps = z.infer<typeof KeywordSlamProps>;
export type NumberCounterProps = z.infer<typeof NumberCounterProps>;
export type DateStampProps = z.infer<typeof DateStampProps>;
export type MapPinProps = z.infer<typeof MapPinProps>;
export type TimelineGraphicProps = z.infer<typeof TimelineGraphicProps>;
export type BarChartProps = z.infer<typeof BarChartProps>;
export type SplitScreenProps = z.infer<typeof SplitScreenProps>;
export type CensorBarProps = z.infer<typeof CensorBarProps>;
export type SpotlightProps = z.infer<typeof SpotlightProps>;
export type KineticTextProps = z.infer<typeof KineticTextProps>;
export type SourceLabelProps = z.infer<typeof SourceLabelProps>;
export type LetterboxProps = z.infer<typeof LetterboxProps>;
export type FreezeLabelProps = z.infer<typeof FreezeLabelProps>;
export type PhotoBurstProps = z.infer<typeof PhotoBurstProps>;
export type EvidenceBoardProps = z.infer<typeof EvidenceBoardProps>;
export type CommentPileProps = z.infer<typeof CommentPileProps>;
```

**Motion template → overlay mapping** (`TEMPLATE_COMPONENT`, implemented in `director/src/overlays/fromMotion.ts`). Every text that quotes someone, names an outlet or shows a number is **filled from the FactSheet**, not from the LLM's string (the LLM string is only compared for validation, §6.3).

| `motionTemplate` | Component | Filled from |
|---|---|---|
| kinetic_text | KineticText | `lines` (free text; ACCUSATORY check applies) |
| counter / money_counter | NumberCounter | `Figure[figure_id].value` (+ unit/currency); `locale` per language; money → `format:"currency"` |
| timeline | TimelineGraphic | events; `date` must equal `TimelineEvent[event_id].date` when `event_id` is set; `at` = word onsets of the dates when spoken |
| bar_chart / line_chart | BarChart | bars' `value` = `Figure[figure_id].value`; `sourceLabel` = `Source[source_id].publisher` |
| map_route | MapPin | places (lon/lat); `look` from the style; `at` per place |
| quote_card | QuoteCard | `text = Quote[quote_id].verbatim` (or the transcreated translation with `translated:true`); speaker = `Person[speakerId].name`; source = `Source.publisher` + `Quote.date` |
| tweet_card | SocialPost | `body = Quote[quote_id].verbatim` (medium `social_post`); `displayName` = speaker name; `handle` only if present in the source text; `revealAt` synced to the VO |
| headline_stack | HeadlineStack | `outlet = Source[source_id].publisher`, `headline = Source.title` (LLM headline must match ≥ 0.9 normalised similarity); `items[].at` = cue anchors or sentence onsets |
| document_highlight | `kind:"article"` → ArticleHighlight (`highlightAt` synced to the VO), otherwise → DocumentCard (`redact` strings → redaction ranges; `stampAt`, `redactAt`) | `outlet/title` from `Source[source_id]`; highlighted passage must be `Quote[quote_id].verbatim` when given |
| split_compare | SplitScreen | picks slots 0 and 1 |
| org_chart | KineticText | node labels (R: a real org chart) |
| photo_burst | PhotoBurst | picks slots `0..count−1` (images); `at` accelerating 8→5 f per image |
| evidence_board | EvidenceBoard | items' assets = portraits of `person_id` or picks; labels from `Person.name`/`Source.publisher` |
| comment_pile | CommentPile | bodies = `Quote[quote_id].verbatim` (medium `social_post`); names = speaker names; private persons → `"@user"` |

### 4.12 `schema/style.ts` (the StylePlugin)

```ts
// $SP/design/core-v2/src/schema/style.ts
import { z } from "zod";
import { ActId, Color, Lang, PxRect, Range2, Unit } from "./common";
import { CueType, MusicMood, TransitionIntent, VisualKind } from "./beats";
import { Device } from "./script";
import { TopicType } from "./research";
import { ClipLayout, OverlayComponentId } from "./components";
import { SfxCategory } from "./media";
import { Pauses } from "./layout";
import { CaptionVariant, ThemeOverride } from "./project";

export const TransitionKey = z.enum([
  "cut", "pulse", "flash", "whip", "zoomThrough", "zoomThroughInverse", "cutTheCurve", "pushCut",
  "dipToBlack", "dipToWhite", "lightLeak", "filmBurn", "glitch", "paperRip", "dotWipe", "iris", "whipStreaks",
  "dissolve", "blurDissolve", "push", "wipe",
]);
export type TransitionKey = z.infer<typeof TransitionKey>;
/** Covers a renderer may not implement yet (the director applies the chain). Empty since P2: every §10.5 cover is implemented (P1 value: filmBurn|paperRip|whipStreaks → flash, dotWipe|iris → dipToBlack). */
export const DEFERRED_TRANSITIONS: Partial<Record<TransitionKey, TransitionKey>> = {};

export const MacroAct = z.enum(["setup", "confrontation", "resolution"]);
export type MacroAct = z.infer<typeof MacroAct>;
export const StoryShape = z.object({
  id: z.string(), // "rise-fall" | "fall-comeback" | "spiral-twist" | "investigation" | "essay-arc"
  label: z.string(),
  acts: z.array(z.object({ id: ActId, share: Unit, purpose: z.string(), macro: MacroAct })).min(2),
});
export type StoryShape = z.infer<typeof StoryShape>;
export const ScriptProfile = z.object({
  id: z.string(),
  storyShapes: z.array(StoryShape).min(1),
  defaultShape: z.string(),
  charsPerSec: z.object({ en: z.number().positive(), fr: z.number().positive() }),
  avgCharsPerWord: z.object({ en: z.number().positive(), fr: z.number().positive() }),
  narrationShare: Unit,
  hookMaxSec: z.number().positive(),
  chapterSec: Range2,
  maxGapNoDeviceSec: z.number().positive(),
  sentenceWords: Range2,
  beatSec: z.object({ hook: Range2, body: Range2, avgBody: z.number().positive() }),
  devices: z.array(Device),
  bannedPhrases: z.object({ en: z.array(z.string()), fr: z.array(z.string()) }),
  adBreaks: z.object({ firstAfterSec: Range2, everySec: Range2 }),
  revisionRounds: z.number().int().min(0).max(3),
  maxClipShare: z.object({ warn: Unit, error: Unit }), // share of runtime that is third-party clips (0.10 / 0.15)
});
export type ScriptProfile = z.infer<typeof ScriptProfile>;

export const ZoneRects = z.object({
  center: PxRect, lowerThird: PxRect, topLeft: PxRect, topRight: PxRect, full: PxRect, captionBand: PxRect,
});
export const StyleTokens = z.object({
  palette: z.object({
    ink: Color, paper: Color, text: Color, accent: Color, danger: Color, money: Color, secondary: Color, muted: Color,
  }),
  fonts: z.object({ // family names; MUST exist in BUILTIN_FONTS (core) or in the style's own fonts/ (M2)
    headline: z.string(), slam: z.string(), body: z.string(), mono: z.string(),
    serif: z.string(), caption: z.string(), document: z.string(),
  }),
  typeRamp: z.object({
    caption: z.number(), keywordCaption: z.number(), lowerThirdName: z.number(), lowerThirdRole: z.number(),
    chapterTitle: z.number(), chapterKicker: z.number(), slam: z.number(), counter: z.number(), cardBody: z.number(), label: z.number(),
  }),
  layout: z.object({ safe: PxRect, zones: ZoneRects, keepOut: z.array(PxRect.extend({ reason: z.string() })) }),
  backdrop: z.enum(["gradientGrid", "paper", "darkNoise", "blurSelf"]), // default card/chapter backdrop recipe
});
export type StyleTokens = z.infer<typeof StyleTokens>;

const Bezier = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export const MotionTokens = z.object({
  entryEase: Bezier, // expo.out ≈ [0.16, 1, 0.3, 1]
  exitEase: Bezier,
  kbEase: Bezier, // shallow ease with NON-ZERO end slopes (≥ 0.5 × mean): [0.2, 0.12, 0.8, 0.88]
  cameraEase: Bezier,
  entryMaxFrames: z.number().int(), // ≤ 800 ms
  staggerMaxFrames: z.number().int(), // ≤ 500 ms total
  overshootAllowedIn: z.array(OverlayComponentId),
  stepFps: z.number().nullable(), // 12 → stepped element motion (vox, R3); null = smooth
});
export type MotionTokens = z.infer<typeof MotionTokens>;

export const TransitionPolicy = z.object({
  cutShare: Unit, // TARGET share of shot boundaries that stay plain cuts (drama 0.85); the quota fill aims at 1-cutShare ± tolerance
  quota: z.object({ minEnergy: z.number().int().min(1).max(5), tolerance: Unit, window: z.number().int().positive() }),
  primary: TransitionKey,
  primaryShare: Range2, // share of non-cut transitions that are `primary` (0.6–0.7) — lint warning outside
  accents: z.array(TransitionKey),
  maxKindsPerFilm: z.number().int().positive(),
  accentKindsPerAct: z.number().int().nonnegative(),
  noRepeatRun: z.number().int().min(2), // 3 → never 3 alike in a row
  minGapFrames: z.number().int().nonnegative(), // no two non-cut transitions closer than this (30 = 1 s)
  chapterBoundary: z.enum(["cut+impact", "dipToBlack", "flash"]),
  actBoundary: TransitionKey, // MACRO-act boundaries only (≤ 2–3 per film); micro-act boundaries use chapterBoundary
  energyFrames: z.object({ calm: Range2, medium: Range2, high: Range2 }), // at 30 fps
  cueMap: z.partialRecord(CueType, TransitionKey),
  intentMap: z.partialRecord(TransitionIntent, TransitionKey),
  flash: z.object({ routine: Range2, cap: z.number(), explicitMax: z.number(), explicitPerMin: z.number(), frames: Range2 }),
  weights: z.partialRecord(TransitionKey, z.number()),
  montage: z.object({ primary: TransitionKey, flashPeak: Unit }), // montage cuts: pushCut + flash .2
});
export type TransitionPolicy = z.infer<typeof TransitionPolicy>;

const EnergyMul = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]); // energy 1..5
export const CameraPolicy = z.object({
  shots: z.object({
    aslSec: Range2, targetAslSec: z.number(), aslMaxSec: z.number(), hookAslFactor: z.number(), maxStaticHoldSec: z.number(),
    minShotFrames: z.number().int(), cutLeadFrames: z.number().int(), visualChangeSec: Range2,
    aslMul: z.object({ byEnergy: EnergyMul, byCue: z.partialRecord(CueType, z.number()), byAct: z.record(z.string(), z.number()) }),
  }),
  kenBurns: z.object({
    minShotSec: z.number(), scaleStart: Range2,
    scaleRatePerSec: Range2, // e.g. 0.025–0.04 (= 2.5–4 %/s) — matched speed across cuts
    driftPxPerSec: Range2, // e.g. 10–20 px/s (full value for up/down too)
    videoCreep: Range2,
  }),
  reframe: z.object({ scale: Range2, wideScale: Range2 }), // tight = 1.25–1.45 toward focal; wide = 1.00–1.04
  maxUpscale: z.number(), // effective source-pixel upscale cap (1.6) for cover/punch/reframe
  punch: z.object({
    perMin: Range2, scale: Range2, inFrames: Range2, minGapFrames: z.number().int(), holdToShotEnd: z.boolean(),
    minTailFrames: z.number().int(), exclusionFrames: z.number().int(), fillToMin: z.boolean(), whooshMinGapSec: z.number(),
  }),
  cutAccent: z.object({ share: Unit, pulseAmt: z.number(), pulseFrames: z.number().int(), flashPeak: z.number(), flashFrames: z.number().int() }),
  plate: z.object({ punch: z.number(), decay: z.number(), shakeX: z.number(), shakeY: z.number(), hz: z.number(), windowSec: z.number(), anchorOffsetMs: z.number() }),
  impactShake: z.object({ frames: Range2, ampPx: Range2, rotDeg: Range2, overscan: z.number() }), // slam entries + chapter hits
  creep: z.object({ scale: Range2, frames: Range2 }),
  pullBack: z.object({ from: z.number(), frames: z.number().int(), blurPx: z.number() }),
  handheld: z.object({ ampPx: z.number(), fps: z.number() }).nullable(),
  quietBeforeClimaxSec: Range2,
  montage: z.object({ aslSec: Range2, snapFrames: z.number().int(), beatPunch: z.object({ amt: z.number(), frames: z.number().int(), curve: z.number() }) }),
  clip: z.object({ creep: Range2, switchLayoutAfterSec: z.number(), keyLinePunch: z.number() }),
});
export type CameraPolicy = z.infer<typeof CameraPolicy>;

export const StillPolicy = z.object({
  layoutWeights: z.object({ cover: z.number(), card: z.number() }), // drama 0.6 / 0.4
  cardIfAspectBelow: z.number(), // 1.25 (portraits, squares)
  cardIfWidthBelow: z.number().int(), // 1400 px
  maxCardRun: z.number().int().positive(), // never more than 2 card shots in a row
  card: z.object({
    heightFrac: Range2, borderPx: Range2, tiltDeg: Range2,
    shadow: z.object({ offsetY: z.number(), blurPx: z.number(), opacity: Unit }),
    backdrops: z.array(z.enum(["gradientGrid", "paper", "blurSelf", "darkNoise"])).min(1),
  }),
  assetReuseMinGapSec: z.number(), // a reuse inside this gap MUST change layout or framing
});
export type StillPolicy = z.infer<typeof StillPolicy>;

export const CaptionDNA = z.object({
  defaultMode: z.enum(["burn", "srt-only", "off"]),
  variant: CaptionVariant, // drama: "keywords"
  font: z.string(), sizePx: z.number().int(), weight: z.number().int(), uppercase: z.boolean(), letterSpacingEm: z.number(),
  strokePx: z.number(), strokeColor: Color, color: Color, keywordColor: Color, moneyColor: Color, dangerColor: Color,
  popFrom: z.number(), popFrames: z.number().int(),
  oneLine: z.boolean(),
  grouping: z.object({ // burned groups (pop/karaoke/rail)
    maxWords: z.number().int(), maxSec: z.number(), minWords: z.number().int(), minSec: z.number(),
    pauseBreakMs: z.number().int(), commaPauseMs: z.number().int(), leadMs: z.number().int(),
    tailMs: z.number().int(), gapMs: z.number().int(), maxChars: z.number().int(),
  }),
  srtGrouping: z.object({ maxChars: z.number().int(), maxLines: z.number().int(), maxSec: z.number(), minSec: z.number() }),
  keywords: z.object({ minGapSec: Range2, maxWords: z.number().int(), sizePx: z.number().int(), holdMinSec: z.number() }),
  heroScale: z.number(), heroWordMinGapSec: z.number(),
  suppressUnder: z.array(OverlayComponentId),
  suppressMinWords: z.number().int(), // also suppress under ANY overlay carrying ≥ this many words of text
  clipStyle: z.object({ font: z.string(), sizePx: z.number().int(), color: Color, background: Color, minHoldSec: z.number() }),
});
export type CaptionDNA = z.infer<typeof CaptionDNA>;

export const SfxPolicy = z.object({
  perMin: Range2, // [floor, cap] — the fill pass raises sparse minutes to the floor
  impactsPerMin: Range2,
  silentCutShare: Unit, // ≈ half of cuts carry no transition SFX
  minGapFrames: z.number().int(),
  noRepeat: z.boolean(),
  allowComedic: z.boolean(), // record scratch, vine boom … (licence-flagged pack)
  peakDb: z.partialRecord(SfxCategory, Range2), // target peak dBFS ranges
  silencesPerFiveMin: z.number(), // floor, counted over the whole film (acts < 90 s are exempt)
  silenceFrames: Range2,
  firstAfterSilenceMinPriority: z.number().int(),
  heavyWhooshMinMovePx: z.number(),
  fillToMin: z.boolean(),
});
export type SfxPolicy = z.infer<typeof SfxPolicy>;

export const MusicPolicy = z.object({
  sectionSec: Range2, // energy cycles 2–4 min
  dropBeforeRevealSec: Range2, // RevealSequence silence length (≤ the layout preRevealMs gap)
  dropOutSec: Range2, // musicCue drop_out
  ironyDropSec: Range2, // IRONY cue
  duckDb: z.number(), // default -12
  duckRangeDb: Range2, // allowed [-15,-8]
  sfxDuckDb: z.number(), // -4
  clipDuckDb: z.number(), // VO over clip audio
  jCutFrames: z.number().int(),
  crossfadeFrames: z.number().int(),
  fadeInFrames: z.number().int(),
  fadeOutFrames: z.number().int(),
  moodBpm: z.partialRecord(MusicMood, z.number()),
  noVoGainDb: z.number(), // music level when no VO (relative to the -18 LUFS stem): 0..+2 (montages rise via ducking release)
});
export type MusicPolicy = z.infer<typeof MusicPolicy>;

export const LutParams = z.object({
  contrast: z.number(), saturation: z.number(), vibrance: z.number(),
  shadows: z.tuple([z.number(), z.number(), z.number()]), highlights: z.tuple([z.number(), z.number(), z.number()]),
  blacks: z.number(), whites: z.number(), temp: z.number(), intensity: Unit,
});
const GradeCss = z.object({ contrast: z.number(), saturate: z.number(), brightness: z.number(), sepia: Unit, hueRotateDeg: z.number() });
export const Grade = z.object({
  look: z.enum(["none", "tealOrange", "bleachBypass", "filmFade", "desatCool", "warmPaper"]),
  css: GradeCss,
  splitTone: z.object({ shadows: Color, highlights: Color, amount: Unit }), // skipped for treatment "bw"
  vignette: z.object({ amount: Unit, radius: Unit, feather: Unit }),
  grainFfmpeg: z.number().min(0).max(16), // ffmpeg `noise=alls=N:allf=t` in master post; never in-browser
  letterbox: z.number().nullable(), // 2.39 → bars
  lut: LutParams.nullable(), // procedural .cube applied by ffmpeg lut3d in master post (§12.3); never in-browser
  byAct: z.record(z.string(), z.object({ css: GradeCss.partial(), vignetteAmount: Unit.nullable() })), // e.g. collapse act darker
  treatments: z.object({
    bw: GradeCss, // applied to the clip only (grayscale sources)
    archival: GradeCss, // pre-1970 colour sources: sepia + contrast
    duotone: z.object({ shadows: Color, highlights: Color }),
  }),
});
export type Grade = z.infer<typeof Grade>;

export const Budgets = z.object({
  keywordSlamPerMin: z.number(),
  lowerThirdMinGapSec: z.number(),
  overlayMaxConcurrent: z.number().int(),
  explicitFlashPerMin: z.number(),
  jlCutsPerFiveMin: z.number(),
  chapterCardFrames: Range2,
  salience: z.object({
    windowSec: z.number(), maxAccents: z.number(), minGapFrames: z.number().int(),
    weights: z.object({ transitionNonCut: z.number(), punch: z.number(), slam: z.number(), impactSfx: z.number(), overlayEntry: z.number(), flash: z.number() }),
  }),
  componentCooldownSec: z.partialRecord(OverlayComponentId, z.number()),
  cleanStretch: z.object({ everySec: z.number(), minSec: z.number() }), // ≥ 1 accent-free stretch (KB + captions only) per window
  actIntensity: z.record(z.string(), z.number()), // scales punch/SFX/non-cut probabilities & caps per act (default 1)
  titleSting: z.boolean(), // title sting at the end of the cold open
});
export type Budgets = z.infer<typeof Budgets>;
export const TechniqueFloor = z.object({
  perChapter: z.record(z.string(), z.number().int()), // e.g. { punch: 1 }
  perFiveMin: z.record(z.string(), z.number()), // e.g. { silence: 1, jlCut: 1 } (film-level, duration-scaled)
  exemptActsShorterThanSec: z.number(), // 90
});
/** triggers are READ by the director's cue→component pass (§9.3 step 7g). A trigger without a derivation rule is a style lint error. */
export const ComponentPolicy = z.object({ id: OverlayComponentId, enabled: z.boolean(), weight: z.number(), triggers: z.array(CueType) });

export const StyleManifest = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), // descriptive; NEVER a channel name
  version: z.string(),
  names: z.object({ en: z.string(), fr: z.string() }),
  description: z.object({ en: z.string(), fr: z.string() }),
  category: z.enum(["commentary", "essay", "explainer", "true-crime"]),
  uses: z.array(z.string()), // ACCENT-FOLDED lowercase EN + FR keywords for suggestStyleOffline
  moods: z.array(z.string()),
  bestFor: z.array(TopicType),
  referencesDescription: z.string(), // prose only; no logos/trademarks in ids
  previewColor: Color,
});
export type StyleManifest = z.infer<typeof StyleManifest>;

/** The content of <styleDir>/style.json. */
export const StyleData = z.object({
  manifest: StyleManifest,
  scriptProfile: ScriptProfile,
  tokens: StyleTokens,
  motion: MotionTokens,
  transitionPolicy: TransitionPolicy,
  cameraPolicy: CameraPolicy,
  stills: StillPolicy,
  captionDNA: CaptionDNA,
  sfxPolicy: SfxPolicy,
  musicPolicy: MusicPolicy,
  grade: Grade,
  budgets: Budgets,
  techniqueFloor: TechniqueFloor,
  components: z.array(ComponentPolicy),
  clipLayout: ClipLayout,
  pauses: Pauses,
  visualPriority: z.array(VisualKind), // archival > clip > motion graphic > stock
});
export type StyleData = z.infer<typeof StyleData>;

/** <styleDir>/prompts.json */
export const StylePrompts = z.object({
  qualityDirective: z.string(), // fixed paragraph pasted into every generation prompt
  visualGrammar: z.string(), // beats prompt: visual priorities + motion_data_json formats per template
  narratorPersona: z.object({ en: z.string(), fr: z.string() }),
});
export type StylePrompts = z.infer<typeof StylePrompts>;
/** <styleDir>/fonts/font.json (M2): OFL fonts shipped with a user style. */
export const StyleFont = z.object({ family: z.string(), weight: z.number().int(), style: z.enum(["normal", "italic"]), file: z.string(), license: z.literal("OFL-1.1") });
export type StyleFont = z.infer<typeof StyleFont>;

export interface PromptPack extends StylePrompts {
  styleMd: string; // STYLE.md: 11 fixed sections (Essence/not, Materials, Colour logic, Type & subtitles, Motion quality,
  // Camera grammar table, Sound palette, Native moves, Pitfalls, Engine, Variation space)
  guideMd: string; // GUIDE.md: goals, numbered rules, reads-timing, Common failures, worked example, Banned list
}
export interface StylePlugin {
  readonly data: StyleData;
  readonly promptPack: PromptPack;
  readonly dir: string; // absolute style directory (builtin or <home>/styles/<id>)
  readonly source: "builtin" | "user";
  readonly fonts: readonly StyleFont[];
  readonly dataHash: string; // hashJson({data, promptPack, fonts}) — participates in stage input hashes
}

/** Subset of style data shipped inside each Timeline so @docmaker/remotion never imports @docmaker/styles. */
export const StyleRenderTokens = z.object({
  styleId: z.string(),
  tokens: StyleTokens, // already merged with Project.themeOverride
  motion: MotionTokens,
  captionDNA: CaptionDNA, // variant already resolved (project.captionsVariant ?? style)
  stills: StillPolicy.shape.card,
  theme: ThemeOverride.nullable(),
  fonts: z.array(z.object({ family: z.string(), weight: z.number().int(), style: z.enum(["normal", "italic"]), url: z.string() })), // M2 style fonts via asset server
});
export type StyleRenderTokens = z.infer<typeof StyleRenderTokens>;

// ---- inferred types (one per schema constant)
export type ZoneRects = z.infer<typeof ZoneRects>;
export type LutParams = z.infer<typeof LutParams>;
export type TechniqueFloor = z.infer<typeof TechniqueFloor>;
export type ComponentPolicy = z.infer<typeof ComponentPolicy>;
```

**Component registry and styles.**
- Three layers so agents never disagree: (1) `OverlayComponentId`, `OVERLAY_PROPS`, `COMPONENT_META`, `TEMPLATE_COMPONENT`, `DERIVABLE_TRIGGERS` in core form the closed vocabulary; (2) each style's `components[]` enables components and sets weights and cue triggers, which the director's cue→component pass **reads** (§9.3 step 7g); (3) `packages/remotion/src/components/registry.ts` maps every id to its React implementation (unimplemented → `FallbackCard`).
- **A style is a data-only directory**: `style.json` (`StyleData`), `STYLE.md`, `GUIDE.md`, `prompts.json` (`StylePrompts`), optional `fonts/` (`font.json` + OFL woff2, M2). `discoverStyles` loads built-ins from `<repoRoot>/packages/styles/builtin/*` and user styles from `<home>/styles/*` at runtime — no registration, no rebuild. `docmaker style new|validate|preview` scaffold, lint (`validateStyleData`) and render a `StyleSpecimen` contact sheet. User style fonts are served by the asset server and loaded with `@remotion/fonts` `loadFont` from `StyleRenderTokens.fonts`; `codeHash` does not change.
- A **new component id** is a contract change. Style-private React components are R21.

### 4.13 `schema/timeline.ts` (the EDL)

```ts
// $SP/design/core-v2/src/schema/timeline.ts
import { z } from "zod";
import {
  ActId, AnyWordId, AssetId, BeatId, ChapterId, Color, Fps, Frame, FrameDelta, IsoDateTime, Lang, NormPoint, NormRect,
  PosFrames, SegmentId, Sha16, Sha256, Slug, TakeId, Unit, WordId, docVersion,
} from "./common";
import { MusicMood } from "./beats";
import { SfxCategory } from "./media";
import { AssetKind } from "./assets";
import { CaptionsMode } from "./project";
import { Grade, StyleRenderTokens } from "./style";
import {
  ArticleHighlightProps, BarChartProps, CensorBarProps, ChapterCardProps, ClipLayout, CommentPileProps, DateStampProps,
  DocumentCardProps, EvidenceBoardProps, FreezeLabelProps, HeadlineStackProps, KeywordSlamProps, KineticTextProps,
  LetterboxProps, LowerThirdProps, MapPinProps, NumberCounterProps, OverlayBand, type OverlayComponentId,
  PhotoBurstProps, QuoteCardProps, SocialPostProps, SourceLabelProps, SplitScreenProps, SpotlightProps, StampProps,
  TimelineGraphicProps, TitleStingProps, ZoneName,
} from "./components";

// ---------------------------------------------------------------- anchors (audio is the clock)
export const Edge = z.enum(["start", "end"]);
export const Anchor = z.discriminatedUnion("ref", [
  // expectNorm: normWord of the anchored word when the anchor was made; overrides re-match by NW on mismatch, else reject
  z.object({ ref: z.literal("word"), wordId: WordId, edge: Edge, offset: FrameDelta, expectNorm: z.string().nullable() }),
  z.object({ ref: z.literal("segment"), segmentId: SegmentId, edge: Edge, offset: FrameDelta }),
  z.object({ ref: z.literal("beat"), beatId: BeatId, edge: Edge, offset: FrameDelta }),
  z.object({ ref: z.literal("chapter"), chapterId: ChapterId, edge: Edge, offset: FrameDelta }),
  z.object({ ref: z.literal("program"), edge: Edge, offset: FrameDelta }), // absolute: {program,start,offset:f}
]);
export type Anchor = z.infer<typeof Anchor>;

/**
 * Every timed item carries anchors + resolved integer frames. The director writes both. resolveTimeline() is valid
 * ONLY against the layout whose hash equals Timeline.layoutHash (it re-resolves override items and is checked for
 * idempotence by lint RESOLVE_MISMATCH). Any layout change → full re-direct. Derived fields: see §4.13 table.
 */
const timed = { start: Anchor, end: Anchor, from: Frame, dur: PosFrames };

// ---------------------------------------------------------------- picture track (V1, contiguous)
export const VisualSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), assetId: AssetId, crop: NormRect.nullable(), focal: NormPoint }),
  z.object({ kind: z.literal("video"), assetId: AssetId, sourceInFrames: Frame, crop: NormRect.nullable(), focal: NormPoint }), // muted; audio via audio.clip
  z.object({
    kind: z.literal("generated"),
    recipe: z.enum(["gradientGrid", "paper", "darkNoise", "keywordCard"]),
    text: z.string(),
    palette: z.array(Color).min(2).max(4),
    seed: z.number().int(),
  }),
  z.object({ kind: z.literal("solid"), color: Color }),
]);
export type VisualSource = z.infer<typeof VisualSource>;

export const CameraKey = z.object({
  f: Frame, // local frame, 0 = clip `from` (the cut frame, NOT including overlap handles)
  scale: z.number().positive(),
  x: z.number(), // px at 1920×1080, +x right
  y: z.number(), // px, +y down
  rot: z.number(), // deg, clockwise
});
export const CameraMove = z.object({
  kind: z.enum(["static", "kenBurns", "creep", "pullBack", "reframe", "handheld"]),
  keys: z.array(CameraKey).min(1),
  ease: z.enum(["linear", "kb", "expoOut", "inOutCubic", "monotone"]), // kb = MotionTokens.kbEase
  origin: z.object({ x: Unit, y: Unit }), // transform-origin (focal point)
  blurFromPx: z.number().min(0), // pullBack entry blur → 0 over the first keys segment; 0 = none
  handheld: z.object({ ampPx: z.number(), fps: z.number() }).nullable(),
  direction: z.enum(["in", "out", "left", "right", "up", "down", "none"]), // Ken Burns direction ledger (no repeats/reversals)
});
export type CameraMove = z.infer<typeof CameraMove>;

export const Direction = z.enum(["left", "right", "up", "down"]);
export const CutAccent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("pulse"), amt: z.number().min(0).max(0.1), frames: PosFrames }), // +5 % decaying .25 s
  z.object({ type: z.literal("flash"), peak: z.number().min(0).max(0.9), frames: z.number().int().min(1).max(6), color: Color }),
  z.object({
    type: z.literal("velocity"), // hard cut with exit anim on A + entry anim on B (no dual render)
    preset: z.enum(["zoomThrough", "zoomThroughInverse", "whip", "cutTheCurve", "pushCut"]),
    direction: Direction,
    exitFrames: z.number().int().min(0).max(20),
    entryFrames: z.number().int().min(0).max(30),
    flash: z.number().min(0).max(0.5),
  }),
]);
export type CutAccent = z.infer<typeof CutAccent>;
export const CoverPresentation = z.enum([
  "flash", "dipToBlack", "dipToWhite", "lightLeak", "filmBurn", "whipStreaks", "glitch", "paperRip", "dotWipe", "iris",
]);
export const OverlapPresentation = z.enum(["dissolve", "blurDissolve", "push", "wipe"]);
export const Transition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cut"), accent: CutAccent }),
  z.object({ // class 2: overlay covers the cut, centred on it; no timeline shortening, no dual render
    kind: z.literal("cover"), presentation: CoverPresentation, durationFrames: z.number().int().min(2).max(40),
    direction: Direction, color: Color, peak: z.number().min(0).max(1),
  }),
  z.object({ // class 3: TransitionSeries.Transition centred on the cut; clips extended by d/2 handles. d is EVEN.
    kind: z.literal("overlap"), presentation: OverlapPresentation, durationFrames: z.number().int().min(4).max(30).multipleOf(2),
    direction: Direction,
  }),
]);
export type Transition = z.infer<typeof Transition>;

export const LayoutParams = z.object({ // card / pip styling (null for cover/contain-blur/split)
  backdrop: z.enum(["gradientGrid", "paper", "blurSelf", "darkNoise"]),
  heightFrac: z.number().min(0.4).max(1), // card: image height / 1080; pip: frame width / 1920
  borderPx: z.number().min(0).max(24),
  tiltDeg: z.number().min(-4).max(4),
  shadow: z.boolean(),
  stroke: Color.nullable(), // pip stroke (accent or white)
  entry: z.enum(["none", "scale", "tvOn", "slide"]),
  backdropSeed: z.number().int(),
});
export type LayoutParams = z.infer<typeof LayoutParams>;

export const VisualClip = z.object({
  id: z.string(), // "v:<beatId>:<shotIndex>" (positional within the beat; overrides are fingerprinted)
  ...timed,
  chapterId: ChapterId,
  beatId: BeatId.nullable(),
  source: VisualSource,
  layout: ClipLayout,
  layoutParams: LayoutParams.nullable(),
  camera: CameraMove,
  treatment: z.enum(["none", "bw", "archival", "duotone"]),
  transitionIn: Transition, // transition at this clip's `from` (first clip of the program: cut/none)
  sourceLabel: z.string().nullable(), // e.g. "Source: <channel>, 2016" (pip/clip)
  name: z.string(), // NLE clip name
});
export type VisualClip = z.infer<typeof VisualClip>;

// ---------------------------------------------------------------- overlays (closed vocabulary)
const overlayBase = {
  id: z.string(), // "ov:<beatId|chapterId>:<component>:<n>"
  ...timed,
  beatId: BeatId.nullable(),
  band: OverlayBand,
  z: z.number().int(),
  zone: ZoneName,
  enterFrames: Frame,
  exitFrames: Frame,
  followsCamera: z.boolean(), // = COMPONENT_META.followsCamera (copied so remotion needs no lookup)
};
const ov = <C extends OverlayComponentId, P extends z.ZodType>(component: C, props: P) =>
  z.object({ ...overlayBase, component: z.literal(component), props });
export const OverlayItem = z.discriminatedUnion("component", [
  ov("LowerThird", LowerThirdProps), ov("ChapterCard", ChapterCardProps), ov("TitleSting", TitleStingProps),
  ov("QuoteCard", QuoteCardProps), ov("SocialPost", SocialPostProps), ov("ArticleHighlight", ArticleHighlightProps),
  ov("DocumentCard", DocumentCardProps), ov("HeadlineStack", HeadlineStackProps), ov("Stamp", StampProps),
  ov("KeywordSlam", KeywordSlamProps), ov("NumberCounter", NumberCounterProps), ov("DateStamp", DateStampProps),
  ov("MapPin", MapPinProps), ov("TimelineGraphic", TimelineGraphicProps), ov("BarChart", BarChartProps),
  ov("SplitScreen", SplitScreenProps), ov("CensorBar", CensorBarProps), ov("Spotlight", SpotlightProps),
  ov("KineticText", KineticTextProps), ov("SourceLabel", SourceLabelProps), ov("Letterbox", LetterboxProps),
  ov("FreezeLabel", FreezeLabelProps), ov("PhotoBurst", PhotoBurstProps), ov("EvidenceBoard", EvidenceBoardProps),
  ov("CommentPile", CommentPileProps),
]);
export type OverlayItem = z.infer<typeof OverlayItem>;

// ---------------------------------------------------------------- captions
export const CaptionTone = z.enum(["normal", "keyword", "money", "danger"]);
export const CaptionWord = z.object({
  wordId: AnyWordId, // WordId | clip:<segmentId>:<n> | tr:<segmentId>:<page>:<n>
  text: z.string(),
  from: Frame,
  dur: PosFrames,
  tone: CaptionTone,
  hero: z.boolean(), // scale captionDNA.heroScale + keyword colour; ≥ heroWordMinGapSec apart
});
export const CaptionGroup = z.object({
  id: z.string(), // "cap:<segmentId>:<n>" | "kw:<segmentId>:<n>" (keyword captions) | "capt:<segmentId>:<page>" (translation)
  ...timed,
  segmentId: SegmentId,
  variant: z.enum(["keywords", "pop", "karaoke", "rail", "clip", "translation", "srt"]), // srt = never burned (subtitle file only)
  burn: z.boolean(), // false → SRT only (variant srt, suppressed groups, captionsMode != "burn")
  words: z.array(CaptionWord).min(1),
});
export type CaptionGroup = z.infer<typeof CaptionGroup>;

// ---------------------------------------------------------------- fx cues (envelope model)
export const FxKind = z.enum(["punch", "zoom", "shake", "flash", "dark", "rgb", "glitch", "blur"]);
export type FxKind = z.infer<typeof FxKind>;
export const FxCue = z.object({
  id: z.string(), // "fx:<sourceId>:<kind>"
  ...timed, // from = hit frame f, dur = frames after f
  fx: FxKind,
  shape: z.enum(["hit", "span"]),
  pre: Frame, // ramp-in frames before f (q² curve)
  curve: z.number().positive(), // hit = (1 - t/dur)^curve
  fade: Frame, // span fade in/out frames
  amt: z.number(), // punch: +scale; shake: px; flash: 0..1; dark: 0..1; rgb: px; blur: px; zoom: +scale
  decay: z.number().nullable(), // plate punch exp decay (e.g. 9) — overrides `hit` curve when set
  hz: z.number().nullable(), // plate shake frequency (12) — sin/cos(1.31×) model when set, else seeded noise
  ampY: z.number().nullable(),
  rotDeg: z.number().nullable(), // impact shake rotation amplitude
  x: Unit.nullable(), // effect origin (punch/zoom: the focal point)
  y: Unit.nullable(),
  color: Color.nullable(),
  seed: z.number().int(),
  target: z.enum(["picture", "picture+followers", "all"]), // followers = graphics items with followsCamera (punch/zoom); all = whole frame (impact shake on slams)
});
export type FxCue = z.infer<typeof FxCue>;

// ---------------------------------------------------------------- audio (rendered offline; previewed with the same gain tables)
/** Per-segment VO clip for NLE export. gainDb is APPLIED to the (un-normalised) segment file = voProgram.bakedGainDb. */
export const VoClip = z.object({
  id: z.string(), // "vo:<segmentId>" | "vo:<segmentId>:b" (part after a REVEAL insertion)
  ...timed, segmentId: SegmentId, assetId: AssetId, sourceInFrames: Frame, gainDb: z.number(),
});
export const MusicSection = z.object({
  id: z.string(), // "mus:<chapterId>" | "mus:<chapterId>:r<n>" (restart after a reveal/drop)
  ...timed, assetId: AssetId, sourceInFrames: Frame, loop: z.boolean(), gainDb: z.number(),
  fadeInFrames: Frame, fadeOutFrames: Frame, endMode: z.enum(["fade", "hardStop", "crossfade"]),
  alignDownbeatAt: Frame.nullable(), // program frame where a track downbeat lands (sourceInFrames chosen for it)
  mood: MusicMood, energy: z.enum(["low", "mid", "high"]), bpm: z.number().nullable(),
});
export type MusicSection = z.infer<typeof MusicSection>;
export const SfxCue = z.object({
  id: z.string(), // "sfx:<sourceItemId>:<category>" (+ ":<n>" for repeated ticks/pops of one item)
  ...timed, // from = eventFrame - peakOffsetFrames (start of file); dur = played length (loop/clamp)
  sfxId: z.string(), // manifest entry id "procedural:impact/2"
  assetId: AssetId,
  category: SfxCategory,
  eventFrame: Frame,
  peakOffsetFrames: Frame,
  gainDb: z.number(),
  pan: z.number().min(-1).max(1),
  panSweep: z.enum(["LR", "RL"]).nullable(), // follow the whip direction (mixer mirrors channels for RL on an LR file)
  loop: z.boolean(), // drones/ambience/keys
  fadeInFrames: Frame,
  fadeOutFrames: Frame,
  priority: z.number().int().min(1).max(5),
  combo: z.enum(["reveal", "riser-impact", "click-whoosh"]).nullable(),
  reason: z.string(),
  sourceItemId: z.string().nullable(),
});
export type SfxCue = z.infer<typeof SfxCue>;
export const ClipAudio = z.object({
  id: z.string(), // "ca:<segmentId>"
  ...timed, segmentId: SegmentId, assetId: AssetId,
  sourceInFrames: Frame, // = picture sourceInFrames − (picture.from − from): J/L cuts stay lip-synced
  gainDb: z.number(), duckUnderVo: z.boolean(),
});
export const SilenceMark = z.object({
  id: z.string(), // "sil:<reason>:<beatId|chapterId|wordId>"
  ...timed,
  reason: z.enum(["reveal", "chapter", "drop_out", "irony", "bleep", "user"]),
  affects: z.array(z.enum(["music", "sfx", "clip", "vo"])).min(1), // "vo" only for bleeps
});
export const DuckingSpec = z.object({
  musicDuckDb: z.number().max(0), // -12
  sfxDuckDb: z.number().max(0), // -4
  clipDuckDb: z.number().max(0), // -10 (VO over clip audio, L-cuts)
  musicUnderClipDb: z.number().max(0), // -12
  attackMs: z.number().int().positive(), // 150
  releaseMs: z.number().int().positive(), // 400
  bridgeMs: z.number().int().nonnegative(), // 600: gaps shorter than this stay ducked
  padBeforeMs: z.number().int().nonnegative(), // 80
  padAfterMs: z.number().int().nonnegative(), // 120
});
export type DuckingSpec = z.infer<typeof DuckingSpec>;
export const AudioTimeline = z.object({
  /** vo_program.wav is ALREADY normalised: preview and mixer apply 0 dB to it. bakedGainDb is informational. */
  voProgram: z.object({ assetId: AssetId, bakedGainDb: z.number() }),
  voSpans: z.array(z.tuple([Frame, Frame])), // merged speech spans [from, to) (bridged < bridgeMs), drives ducking
  vo: z.array(VoClip), // per-segment clips (NLE export only)
  music: z.array(MusicSection),
  sfx: z.array(SfxCue),
  clip: z.array(ClipAudio),
  silences: z.array(SilenceMark),
  ducking: DuckingSpec,
});
export type AudioTimeline = z.infer<typeof AudioTimeline>;

// ---------------------------------------------------------------- markers, assets table, the Timeline
export const MarkerColor = z.enum(["red", "blue", "green", "yellow", "purple", "cyan", "orange"]);
export const Marker = z.object({
  id: z.string(), frame: Frame, dur: Frame, name: z.string(), note: z.string(), color: MarkerColor,
  kind: z.enum(["chapter", "ad-break", "sponsor", "factcheck", "source", "nle-note", "qa", "pickup"]),
});
export type Marker = z.infer<typeof Marker>;

export const TimelineAsset = z.object({
  id: AssetId,
  kind: AssetKind,
  ext: z.enum(["jpg", "png", "mp4", "wav"]),
  mime: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationFrames: Frame.nullable(),
  hasAudio: z.boolean(),
  projectRel: z.string(), // media/<id>.<ext> | program/<lang>/vo_program.wav | voice/…/seg.wav (the ONLY path field)
});
export type TimelineAsset = z.infer<typeof TimelineAsset>;

export const Timeline = z.object({
  schemaVersion: docVersion("timeline"),
  projectSlug: Slug,
  lang: Lang,
  title: z.string(),
  styleId: z.string(),
  seed: z.number().int(),
  fps: Fps,
  width: z.literal(1920),
  height: z.literal(1080),
  durationInFrames: PosFrames,
  layoutHash: Sha256,
  takeId: TakeId,
  takeKind: z.enum(["scratch", "final"]),
  onlyChapters: z.array(ChapterId).nullable(),
  directorVersion: z.string(),
  captionsMode: CaptionsMode,
  chapters: z.array(z.object({ id: ChapterId, title: z.string(), act: ActId, from: Frame, dur: PosFrames })),
  video: z.array(VisualClip), // contiguous, sorted, covers [0, durationInFrames)
  overlays: z.array(OverlayItem),
  captions: z.array(CaptionGroup),
  fx: z.array(FxCue),
  audio: AudioTimeline,
  grade: Grade,
  markers: z.array(Marker),
  assets: z.record(AssetId, TimelineAsset),
  render: StyleRenderTokens,
});
export type Timeline = z.infer<typeof Timeline>;

// ---------------------------------------------------------------- user overrides (survive re-direct; fingerprinted)
export const TimelineOverride = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replaceSource"), clipId: z.string(), source: VisualSource }), // validatePick runs on the asset
  z.object({ op: z.literal("setTransition"), clipId: z.string(), transition: Transition }),
  z.object({ op: z.literal("setCamera"), clipId: z.string(), camera: CameraMove }),
  z.object({ op: z.literal("setLayout"), clipId: z.string(), layout: ClipLayout }),
  z.object({ op: z.literal("removeItem"), itemId: z.string() }), // overlay | caption | fx | sfx | music | silence id; never vo:*
  z.object({ op: z.literal("addOverlay"), item: OverlayItem }), // anchored; validated like director items
  z.object({ op: z.literal("patchOverlayProps"), itemId: z.string(), props: z.record(z.string(), z.unknown()) }), // merged → OVERLAY_PROPS[component]
  z.object({ op: z.literal("setSfxGain"), itemId: z.string(), gainDb: z.number().min(-30).max(6) }),
]);
export type TimelineOverride = z.infer<typeof TimelineOverride>;
/** Fingerprint: the override applies only while its target still matches (else → rejected, surfaced in the UI). */
export const OverrideTarget = z.object({
  itemId: z.string(),
  component: z.string().nullable(), // overlay component at creation
  beatId: BeatId.nullable(),
  planKey: Sha16.nullable(), // beat planKey at creation
  assetId: AssetId.nullable(), // clip source at creation (replaceSource/setCamera/setLayout)
  wordNorm: z.string().nullable(), // first anchored word's norm at creation
});
export const OverridesDoc = z.object({
  schemaVersion: docVersion("overrides"),
  lang: Lang,
  overrides: z.array(z.object({ id: z.string(), createdAt: IsoDateTime, target: OverrideTarget, override: TimelineOverride })),
});
export type OverridesDoc = z.infer<typeof OverridesDoc>;

/** timeline/<lang>.usage.json — written by `direct`; joined with the ledger by credits/export. */
export const UsageDoc = z.object({
  schemaVersion: docVersion("usage"),
  lang: Lang,
  usage: z.array(z.object({ assetId: AssetId, itemIds: z.array(z.string()) })),
});
export type UsageDoc = z.infer<typeof UsageDoc>;

// ---- inferred types (one per schema constant)
export type Edge = z.infer<typeof Edge>;
export type CameraKey = z.infer<typeof CameraKey>;
export type Direction = z.infer<typeof Direction>;
export type CoverPresentation = z.infer<typeof CoverPresentation>;
export type OverlapPresentation = z.infer<typeof OverlapPresentation>;
export type CaptionTone = z.infer<typeof CaptionTone>;
export type CaptionWord = z.infer<typeof CaptionWord>;
export type VoClip = z.infer<typeof VoClip>;
export type ClipAudio = z.infer<typeof ClipAudio>;
export type SilenceMark = z.infer<typeof SilenceMark>;
export type MarkerColor = z.infer<typeof MarkerColor>;
export type OverrideTarget = z.infer<typeof OverrideTarget>;
```

**Anchored vs derived fields (normative; resolves v1's "anchors are the truth" ambiguity).** Every timed item's `from`/`dur` is resolved from its `start`/`end` anchors. Every other frame-valued field is **derived** by the director from the layout and is valid only for `Timeline.layoutHash`:
`CameraKey.f`; `CaptionWord.from/dur`; overlay `at`/`*At` props (QuoteCard `words[].at`, SocialPost `revealAt`, ArticleHighlight `highlightAt`, DocumentCard `stampAt/redactAt`, HeadlineStack/MapPin/TimelineGraphic/PhotoBurst/EvidenceBoard/CommentPile `at`); `SfxCue.eventFrame/peakOffsetFrames`; `AudioTimeline.voSpans`; `MusicSection.sourceInFrames/alignDownbeatAt`; `ClipAudio.sourceInFrames`; span `FxCue.dur` ("hold to the cut"); transition validity; marker frames.
Consequences: (1) **any layout change triggers a full re-direct** (the layout hash is a `direct` input); (2) `resolveTimeline` is used only to resolve override items (`addOverlay`) against the same layout and by lint `RESOLVE_MISMATCH` (`resolveTimeline(t, ix).timeline` must deep-equal `t`); (3) it throws when `ix.layoutHash !== t.layoutHash`.

**Item id grammar** (`util/ids.ts`): `v:<beatId>:<shot>` · `ov:<beatId|chapterId>:<component>:<n>` · `cap:<segmentId>:<n>` · `kw:<segmentId>:<n>` · `capt:<segmentId>:<page>` · `fx:<sourceId>:<kind>` · `sfx:<sourceItemId>:<category>[:<n>]` · `mus:<chapterId>[:r<n>]` · `sil:<reason>:<ref>` · `vo:<segmentId>[:b]` · `ca:<segmentId>` · `mk:<kind>:<ref>`. Positional parts (`<shot>`, `<n>`) are protected by override fingerprints (`OverrideTarget`), never trusted blindly.

**Override application** (`applyOverrides`, §9.3 step 13). Each override is validated in isolation and applied only if its `target` fingerprint still matches (same component, beatId, planKey, assetId, first-word norm); word anchors with `expectNorm` are re-matched by NW within the beat, else rejected. Merged props must parse with `OVERLAY_PROPS[component]`; transitions must satisfy invariants against neighbours and media handles; zones must avoid keepOut; `replaceSource` assets go through `validateAsset` (licence/AI/person); `removeItem` on `vo:*` is rejected. Rejected overrides are listed in `timeline/<lang>.lint.json` and the UI; they are never applied and never throw.

**`lintTimeline` rules** (`LINT_RULES` in director). Errors fail `direct` unless `--force`; warnings are reported in stats and the UI.

| Rule | Level | Check |
|---|---|---|
| `V_CONTIGUOUS` | error | `video` sorted and contiguous over `[0, durationInFrames)` |
| `V_BOUNDS` | error | every `from + dur ≤ durationInFrames` |
| `IDS_UNIQUE` | error | all item ids unique (`timelineItemIds`) |
| `ASSET_MISSING` | error | every id from `collectAssetIds` has a `TimelineAsset` |
| `RESOLVE_MISMATCH` | error | `resolveTimeline` is idempotent on the director output |
| `T_OVERLAP` | error | overlap never on a chapter's first clip; `d` even, `d ≤ min(prev.dur, cur.dur) − 2`; handles exist on both sides |
| `MEDIA_RANGE` | error | every `video` source and `ClipAudio`: `sourceInFrames ≥ headNeed` and `sourceInFrames + dur + tailNeed ≤ asset.durationFrames` (head/tail needs = overlap half-durations, J/L offsets) |
| `ZONE_KEEPOUT` | error | no overlay inside a keepOut rect; burned captions inside `zones.captionBand` |
| `OVERSHOOT` | error | overshoot only for `motion.overshootAllowedIn` |
| `FLASH_CAP` | error | routine flash peak ≤ `flash.cap`; explicit ≤ `explicitMax` and ≤ `explicitPerMin` per 60 s |
| `TRANSITION_RUN` | error | never 3 identical non-cut transitions in a row; kinds ≤ `maxKindsPerFilm` |
| `POLICY` | error | `validateAsset` errors for any on-screen asset (licence, AI + people, private persons) |
| `AI_DISCLOSURE` | error | every on-screen AI asset (`isAiAsset`) is covered by `SourceLabel{kind:"illustration"}`, and no illustration label sits over non-AI picture; the director re-derives the labels from the final picture track after overrides |
| `PRIVATE_PERSON` | error | overlay text/props name a person with `isMinorOrPrivateVictim`, or a non-public figure without `person-ack` |
| `CLIP_SHARE` | error / warn | clip seconds > `maxClipShare.error` × runtime (error), > `warn` (warning); any clip > `maxClipSeconds` (error) |
| `DENSITY_MAX` | warn | per 60 s: SFX ≤ `perMin[1]`, impacts ≤ `impactsPerMin[1]`, punches ≤ `punch.perMin[1]`, slams ≤ `keywordSlamPerMin` |
| `DENSITY_MIN` | warn | per 60 s (acts ≥ 90 s only): SFX ≥ `perMin[0]`, punches ≥ `punch.perMin[0]` after the fill passes |
| `TEXT_COLLISION` | warn | a generated `keywordCard` headline overlaps a centred non-full-frame text graphic (KineticText…); the director gives such shots the textless `darkNoise` base (step 7) |
| `STATIC_HOLD` | warn | no picture or full-frame graphics hold > `maxStaticHoldSec` without camera motion, video motion or `continuousMotion` |
| `NO_VISUAL_CHANGE` | warn | no window > `visualChangeSec[1] + 1 s` without a cut, punch, overlay entry or sub-beat (`stats.maxNoChangeSec`) |
| `READABILITY` | warn | an overlay below its `ReadPolicy` hold (§4.11); caption groups < 0.5 s |
| `PRIMARY_SHARE` | warn | primary share of non-cut transitions outside `primaryShare` |
| `SILENT_CUT_SHARE` | warn | share of cuts without SFX outside `silentCutShare ± 0.1` |
| `SFX_REPEAT` | warn | the same SFX file (by `assetId`) twice in a row |
| `TECHNIQUE_FLOOR` | warn | `perChapter` and `perFiveMin` floors unmet |
| `UPSCALE` | warn | effective source upscale > `maxUpscale` after mitigation |
| `ASSET_REUSE` | warn | an asset reused within `assetReuseMinGapSec` with the same layout and framing |

### 4.14 `schema/export-timeline.ts` (NLE-agnostic, integer frames)

```ts
// $SP/design/core-v2/src/schema/export-timeline.ts
import { z } from "zod";
import { AssetId, Frame, Lang, PosFrames } from "./common";
import { MarkerColor } from "./timeline";

export const Keyframe = z.object({ frame: Frame, value: z.number(), interp: z.enum(["linear", "hold"]) }); // frame is CLIP-LOCAL
export const Keyframe2 = z.object({ frame: Frame, x: z.number(), y: z.number(), interp: z.enum(["linear", "hold"]) });
export const ExportMarker = z.object({ frame: Frame, duration: Frame, name: z.string(), note: z.string(), color: MarkerColor });
export const ExportMedia = z.object({
  id: z.string(), // "m001"
  assetId: AssetId.nullable(),
  localPath: z.string(), // absolute path on the machine that ran the export (conformed copy in export/<lang>/media/)
  writtenPath: z.string(), // path written into XML/OTIO after exportRoot remap
  name: z.string(), // unique ASCII-safe file name "012_tulip-auction_ab12cd34.jpg"
  kind: z.enum(["video", "image", "audio"]),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationFrames: Frame.nullable(), // null for stills
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  audioChannels: z.number().int().nullable(),
  alpha: z.boolean(), // ProRes 4444 overlays
});
export const ExportClip = z.object({
  id: z.string(),
  name: z.string(),
  mediaId: z.string(),
  start: Frame, // timeline frame (cut frame, no handles)
  duration: PosFrames,
  sourceIn: Frame, // media frame
  enabled: z.boolean(),
  scale: z.array(Keyframe), // [] = 1.0 (multiplier of conformed 1920×1080 media)
  position: z.array(Keyframe2), // px offset of centre, +y down; [] = (0,0)
  rotation: z.array(Keyframe), // deg, CSS clockwise
  opacity: z.array(Keyframe), // 0..1
  blend: z.enum(["normal", "screen", "add", "multiply", "overlay"]),
  markers: z.array(ExportMarker),
});
/** duration is EVEN (Timeline overlap durations are even), so cutFrame ± duration/2 are integer frames in every writer. */
export const ExportTransition = z.object({ cutFrame: Frame, duration: PosFrames.multipleOf(2), kind: z.enum(["dissolve", "dipToBlack"]) });
export const ExportVideoTrack = z.object({ name: z.string(), enabled: z.boolean(), clips: z.array(ExportClip), transitions: z.array(ExportTransition) });
export const ExportAudioClip = z.object({
  id: z.string(), name: z.string(), mediaId: z.string(), start: Frame, duration: PosFrames, sourceIn: Frame,
  gainDb: z.array(Keyframe), // dB; a single keyframe = constant level
  enabled: z.boolean(),
});
export const ExportAudioTrack = z.object({
  name: z.string(),
  role: z.enum(["dialogue", "music", "effects", "clip", "stem"]),
  channels: z.union([z.literal(1), z.literal(2)]),
  enabled: z.boolean(),
  clips: z.array(ExportAudioClip),
});
export const ExportTimeline = z.object({
  name: z.string(),
  lang: Lang,
  fps: z.object({ num: z.number().int().positive(), den: z.number().int().positive() }), // 30/1; 29.97 = 30000/1001
  ntsc: z.boolean(),
  width: z.number().int(),
  height: z.number().int(),
  durationFrames: PosFrames,
  sampleRate: z.literal(48000),
  tcStartFrames: z.literal(0), // 00:00:00:00 NDF everywhere (XML, OTIO, marker EDL)
  media: z.array(ExportMedia),
  video: z.array(ExportVideoTrack), // [0] = V1 spine (contiguous), [1..] = overlays (alpha)
  audio: z.array(ExportAudioTrack), // A1 VO, A2 music, A3 SFX, A4 clip audio, A5–A8 baked stems (disabled)
  markers: z.array(ExportMarker),
});
export type ExportTimeline = z.infer<typeof ExportTimeline>;

// ---- inferred types (one per schema constant)
export type Keyframe = z.infer<typeof Keyframe>;
export type Keyframe2 = z.infer<typeof Keyframe2>;
export type ExportMarker = z.infer<typeof ExportMarker>;
export type ExportMedia = z.infer<typeof ExportMedia>;
export type ExportClip = z.infer<typeof ExportClip>;
export type ExportTransition = z.infer<typeof ExportTransition>;
export type ExportVideoTrack = z.infer<typeof ExportVideoTrack>;
export type ExportAudioClip = z.infer<typeof ExportAudioClip>;
export type ExportAudioTrack = z.infer<typeof ExportAudioTrack>;
```

### 4.15 `schema/ops.ts` (stages, gates, jobs, cost, QA, render, misc documents)

```ts
// $SP/design/core-v2/src/schema/ops.ts
// packages/core/src/schema/ops.ts — `// ----` lines are section markers inside ONE file
import { z } from "zod";
import { ChapterId, IsoDateTime, Lang, LintIssue, Sha256, Slug, docVersion } from "./common";
import { JobOptions, RenderPresetId } from "./project";

export const StageId = z.enum([
  "research", "style", "outline", "script", "beats", "beatslice", "factcheck", "assets", "voice",
  "layout", "direct", "mix", "render", "export", "qa",
]);
export type StageId = z.infer<typeof StageId>;
export const PER_LANG_STAGES: readonly StageId[] = [
  "script", "beatslice", "factcheck", "voice", "layout", "direct", "mix", "render", "export", "qa",
];
/** Stages whose state is additionally keyed by a variant (the render preset). */
export const VARIANT_STAGES: readonly StageId[] = ["render", "qa"];
export const GateId = z.enum([
  "style-confirm", "outline-approval", "factcheck-ack", "person-ack", "recheck", "cost", "fair-use",
]);
export type GateId = z.infer<typeof GateId>;
/** Editorial gates are NEVER satisfied by --yes / --max-cost / auto-threshold (only fixtures auto-approve them). */
export const EDITORIAL_GATES: readonly GateId[] = ["outline-approval", "factcheck-ack", "person-ack", "recheck", "fair-use"];
export const JobStatus = z.enum(["queued", "running", "waiting-approval", "succeeded", "failed", "canceled"]);
export type JobStatus = z.infer<typeof JobStatus>;
export const ErrorCode = z.enum([
  "CONFIG_MISSING_KEY", "FIXTURE_MISSING", "LLM_REFUSAL", "LLM_SCHEMA", "LLM_API", "GATE_REQUIRED",
  "BUDGET_EXCEEDED", "PROVIDER_RATE_LIMIT", "PROVIDER_ERROR", "OFFLINE", "YT_BOT_CHECK", "YT_FORBIDDEN", "YT_UNAVAILABLE",
  "YT_RATE_LIMIT", "TOOL_MISSING", "MODEL_MISSING", "ANCHOR_MISSING", "VALIDATION", "LANG_PARITY", "POLICY_DENIED",
  "TIMELINE_LINT", "RENDER_FAILED", "MIX_FAILED", "LOUDNESS_GATE", "EXPORT_FAILED", "CANCELED", "LOCKED", "CONFLICT",
  "UPSTREAM_MISSING", "MIGRATION_FAILED", "INTERRUPTED", "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const JobRequest = z.object({
  slug: Slug,
  kind: z.enum(["stage", "pipeline", "demo", "setup"]),
  stage: StageId.nullable(),
  from: StageId.nullable(),
  to: StageId.nullable(),
  langs: z.array(Lang), // [] = project languages
  force: z.boolean(),
  options: JobOptions,
  preset: RenderPresetId.nullable(),
});
export type JobRequest = z.infer<typeof JobRequest>;

export const JobRecord = z.object({
  id: z.string(), // "job-<yyyymmdd-hhmmss>-<rand6>"
  request: JobRequest,
  status: JobStatus,
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.nullable(),
  endedAt: IsoDateTime.nullable(),
  error: z.object({ code: ErrorCode, message: z.string() }).nullable(),
  coalescedInto: z.string().nullable(), // identical queued request merged into this job id
  resumeOf: z.string().nullable(), // "approve & continue" / run --resume
});
export type JobRecord = z.infer<typeof JobRecord>;
/** projects/<slug>/jobs/index.json — persisted queue + history (last 200). */
export const JobsIndex = z.object({ schemaVersion: docVersion("jobsIndex"), jobs: z.array(JobRecord) });
export type JobsIndex = z.infer<typeof JobsIndex>;

// ---- cost
export const CostUnit = z.enum([
  "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "web_searches",
  "characters", "seconds", "images", "megapixels", "requests",
]);
export const CostLine = z.object({
  label: z.string(), provider: z.string(), unit: CostUnit, quantity: z.number().nonnegative(),
  unitPriceUsd: z.number().nonnegative(), totalUsd: z.number().nonnegative(),
});
export const CostEstimate = z.object({
  schemaVersion: docVersion("estimate"),
  id: z.string(),
  stage: StageId,
  lang: Lang.nullable(),
  lines: z.array(CostLine),
  totalUsd: z.number().nonnegative(),
  confidence: z.enum(["exact", "estimate", "rough"]),
  planHash: Sha256, // hash of (stage inputs + lines) → approval binds to it
  createdAt: IsoDateTime,
});
export type CostEstimate = z.infer<typeof CostEstimate>;
/** One approval may cover a whole pipeline run: Approval.planHash = PipelineEstimate.planHash, items = stage planHashes. */
export const PipelineEstimate = z.object({
  stages: z.array(CostEstimate),
  totalUsd: z.number().nonnegative(),
  planHash: Sha256, // hashJson(sorted stage planHashes)
});
export type PipelineEstimate = z.infer<typeof PipelineEstimate>;
export const Receipt = z.object({
  fingerprint: Sha256, // sha256(provider|endpoint|canonicalJson(request minus secrets)) — same paid call never made twice
  provider: z.string(),
  endpoint: z.string(),
  model: z.string().nullable(),
  stage: StageId,
  lang: Lang.nullable(),
  createdAt: IsoDateTime,
  usage: z.record(z.string(), z.number()),
  costUsd: z.number().nonnegative(),
  outputRef: z.string().nullable(), // project-relative path of the stored response/output
  jobId: z.string().nullable(),
});
export type Receipt = z.infer<typeof Receipt>;
export const Approval = z.object({
  gate: GateId,
  stage: StageId,
  lang: Lang.nullable(),
  planHash: Sha256,
  approvedAt: IsoDateTime,
  by: z.enum(["web", "cli", "flag", "fixture", "auto-threshold"]),
  note: z.string(),
  items: z.array(z.string()), // acknowledged FactCheckItem ids | personIds | stage planHashes
  itemNotes: z.record(z.string(), z.string()), // per-item notes (factcheck-ack, person-ack)
});
export type Approval = z.infer<typeof Approval>;
export const ApprovalsDoc = z.object({ schemaVersion: docVersion("approvals"), approvals: z.array(Approval) });
export type ApprovalsDoc = z.infer<typeof ApprovalsDoc>;

/** USD; volatile — single source for estimates. Update with care. */
export const PRICES = {
  claude: { "claude-opus-5-5": { inputPerMTok: 4.0, outputPerMTok: 20.0, cacheReadPerMTok: 0.2, cacheWrite5mPerMTok: 5.0 } },
  webSearchPer1k: 10.0, // web_fetch costs tokens only
  elevenlabsPer1kChars: { eleven_multilingual_v2: 0.08, eleven_v3: 0.08, eleven_v4: 0.08, eleven_flash_v2_5: 0.04 },
  bravePer1k: 5.0,
  fal: { "fal-ai/flux/schnell": { perMegapixel: 0.003 }, "fal-ai/flux-2-pro": { firstMp: 0.03, extraMp: 0.015 } },
} as const;

const ev = { jobId: z.string(), seq: z.number().int().nonnegative(), at: IsoDateTime };
export const JobEvent = z.discriminatedUnion("type", [
  z.object({ ...ev, type: z.literal("job-start"), request: JobRequest }),
  z.object({ ...ev, type: z.literal("stage-start"), stage: StageId, lang: Lang.nullable() }),
  z.object({ ...ev, type: z.literal("progress"), stage: StageId, lang: Lang.nullable(), pct: z.number().min(0).max(1), message: z.string(), detail: z.record(z.string(), z.unknown()) }),
  z.object({ ...ev, type: z.literal("log"), level: z.enum(["debug", "info", "warn", "error"]), message: z.string(), stage: StageId.nullable() }),
  z.object({ ...ev, type: z.literal("estimate"), estimate: CostEstimate }),
  z.object({ ...ev, type: z.literal("cost"), receipt: Receipt }),
  z.object({ ...ev, type: z.literal("needs-approval"), gate: GateId, stage: StageId, lang: Lang.nullable(), planHash: Sha256, reason: z.enum(["unmet", "stale"]), summary: z.string() }),
  z.object({ ...ev, type: z.literal("artifact"), stage: StageId, lang: Lang.nullable(), path: z.string(), kind: z.string() }),
  z.object({ ...ev, type: z.literal("stage-skip"), stage: StageId, lang: Lang.nullable(), reason: z.enum(["up-to-date", "not-applicable"]) }),
  z.object({ ...ev, type: z.literal("stage-done"), stage: StageId, lang: Lang.nullable(), durationMs: z.number().int(), outputsHash: Sha256 }),
  z.object({ ...ev, type: z.literal("error"), stage: StageId.nullable(), code: ErrorCode, message: z.string(), retryable: z.boolean(), hint: z.string().nullable() }),
  z.object({ ...ev, type: z.literal("job-end"), status: JobStatus }),
]);
export type JobEvent = z.infer<typeof JobEvent>;
export type JobEventInput = JobEvent extends infer E ? (E extends unknown ? Omit<E, "jobId" | "seq" | "at"> : never) : never;

export const StageState = z.object({
  stage: StageId,
  lang: Lang.nullable(),
  variant: z.string().nullable(), // render/qa: the preset ("draft" | "master"); else null
  status: z.enum(["idle", "running", "done", "failed", "blocked"]), // "stale" is COMPUTED (inputsHash mismatch), never stored
  stageVersion: z.number().int(),
  inputsHash: Sha256.nullable(),
  outputsHash: Sha256.nullable(),
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
  error: z.string().nullable(),
  costUsd: z.number().nonnegative(),
  artifacts: z.array(z.string()),
});
export type StageState = z.infer<typeof StageState>;
export const ProjectState = z.object({ schemaVersion: docVersion("state"), stages: z.array(StageState) });
export type ProjectState = z.infer<typeof ProjectState>;

// ---- qa
export const QaCheck = z.object({
  id: z.string(), level: z.enum(["error", "warn", "info"]), ok: z.boolean(), message: z.string(),
  value: z.number().nullable(), threshold: z.number().nullable(), frame: z.number().int().nullable(),
});
export const QaReport = z.object({
  schemaVersion: docVersion("qa"),
  lang: Lang,
  preset: RenderPresetId,
  createdAt: IsoDateTime,
  checks: z.array(QaCheck),
  probe: z.object({
    durationSec: z.number(), frames: z.number().int(), width: z.number().int(), height: z.number().int(), fps: z.number(),
    vcodec: z.string(), pixFmt: z.string(), acodec: z.string(), sampleRate: z.number().int(), channels: z.number().int(),
  }).nullable(),
  loudness: z.object({ integratedLufs: z.number(), truePeakDbtp: z.number(), lra: z.number() }).nullable(),
  contactSheets: z.array(z.string()),
  audioNotListenedNotice: z.literal("The mix was checked by meters only; nobody listened to it."),
});
export type QaReport = z.infer<typeof QaReport>;

// ---- render
export const RenderRequest = z.object({
  slug: Slug,
  lang: Lang,
  preset: RenderPresetId,
  projectDir: z.string(), // absolute
  timelineRel: z.string(), // snapshot copy: render/<lang>/<preset>/snapshot/timeline.json (project lock released after snapshot)
  mixRel: z.string().nullable(), // snapshot copy of the mix (null → silent track)
  outRel: z.string(), // render/<lang>/<preset>/final.mp4
  frameRange: z.tuple([z.number().int(), z.number().int()]).nullable(),
  chunkSeconds: z.number().int(),
  gl: z.enum(["auto", "swangle", "angle", "angle-egl"]),
  concurrency: z.number().int().positive().nullable(),
  grain: z.number().min(0).max(16),
  lutCube: z.string().nullable(), // absolute .cube path → ffmpeg lut3d in master post
});
export type RenderRequest = z.infer<typeof RenderRequest>;
export const RenderChunk = z.object({
  index: z.number().int(), from: z.number().int(), to: z.number().int(), // inclusive
  file: z.string(), hash: Sha256, cached: z.boolean(), ms: z.number(),
});
export const RenderResult = z.object({
  outFile: z.string(), durationInFrames: z.number().int(), frames: z.number().int(),
  chunks: z.array(RenderChunk), renderMs: z.number(), gl: z.string(), codeHash: Sha256,
  loudness: z.object({ integratedLufs: z.number(), truePeakDbtp: z.number(), gateAttempts: z.number().int() }).nullable(),
});
export type RenderResult = z.infer<typeof RenderResult>;
/** render/<lang>/<preset>/render.json */
export const RenderDoc = RenderResult.extend({
  schemaVersion: docVersion("render"), lang: Lang, preset: RenderPresetId, timelineHash: Sha256, mixHash: Sha256.nullable(),
  onlyChapters: z.array(ChapterId).nullable(), createdAt: IsoDateTime,
});
export type RenderDoc = z.infer<typeof RenderDoc>;
export const GlProbe = z.object({
  schemaVersion: docVersion("glProbe"),
  chosen: z.enum(["swangle", "angle", "angle-egl"]),
  results: z.array(z.object({ gl: z.string(), ok: z.boolean(), ms: z.number(), renderer: z.string() })),
  gpu: z.boolean(),
  probedAt: IsoDateTime,
});
export type GlProbe = z.infer<typeof GlProbe>;
export const StillsRequest = z.object({
  projectDir: z.string(), timelineRel: z.string(), frames: z.array(z.number().int()), outDir: z.string(),
  scale: z.number().positive(), sheet: z.object({ cols: z.number().int(), width: z.number().int(), label: z.boolean() }).nullable(),
});
export type StillsRequest = z.infer<typeof StillsRequest>;
export const OverlayRenderRequest = z.object({
  projectDir: z.string(), timelineRel: z.string(), itemIds: z.array(z.string()), outDir: z.string(), // ProRes 4444 per item (M3)
});
export type OverlayRenderRequest = z.infer<typeof OverlayRenderRequest>;
export const GeneratedStillsRequest = z.object({
  projectDir: z.string(), timelineRel: z.string(), clipIds: z.array(z.string()), outDir: z.string(),
});
export type GeneratedStillsRequest = z.infer<typeof GeneratedStillsRequest>;

// ---- misc persisted docs
/** timeline/<lang>.lint.json */
export const TimelineLintDoc = z.object({
  schemaVersion: docVersion("timelineLint"),
  lang: Lang,
  issues: z.array(LintIssue),
  stats: z.record(z.string(), z.unknown()), // DirectorStats
  rejectedOverrides: z.array(z.object({ id: z.string(), reason: z.string() })),
});
export type TimelineLintDoc = z.infer<typeof TimelineLintDoc>;
/** audio/<lang>/loudness.json */
export const LoudnessDoc = z.object({
  schemaVersion: docVersion("loudness"),
  lang: Lang,
  integratedLufs: z.number(), truePeakDbtp: z.number(), lra: z.number(),
  gainDb: z.number(), limiterMaxGrDb: z.number(), // stems sum to the master except for limiter gain reduction
  stems: z.array(z.enum(["vo", "music", "sfx", "clip"])),
});
export type LoudnessDoc = z.infer<typeof LoudnessDoc>;
/** fixtures/<id>/fixture.json */
export const FixtureManifest = z.object({
  schemaVersion: docVersion("fixture"),
  id: z.string(), title: z.string(), idea: z.string(), languages: z.array(Lang).min(1), primaryLang: Lang,
  targetMinutes: z.number(), styleId: z.string(), asOf: z.string(), seed: z.number().int(),
  autoApproveGates: z.boolean(), // tulip-mania: true (demo); gate-test: false (safety suite exercises every gate)
});
export type FixtureManifest = z.infer<typeof FixtureManifest>;
/** <home>/cache/index.json */
export const CacheIndex = z.object({
  schemaVersion: docVersion("cacheIndex"),
  blobs: z.array(z.object({ sha256: Sha256, ext: z.string(), bytes: z.number().int(), lastUsed: IsoDateTime })),
});
export type CacheIndex = z.infer<typeof CacheIndex>;
/** <home>/config.json — non-secret preferences (secrets live ONLY in <home>/.env, mode 0600). */
export const HomeConfig = z.object({
  schemaVersion: docVersion("homeConfig"),
  remotionLicense: z.object({ status: z.enum(["individual-or-small-org", "company-license"]), acknowledgedAt: IsoDateTime }).nullable(),
  contact: z.string().nullable(), // Wikimedia/Wikidata contact (overridden by DOCMAKER_CONTACT)
  uiLang: z.enum(["auto", "en", "fr"]),
  defaults: z.object({ languages: z.array(Lang), targetMinutes: z.number(), styleId: z.string().nullable() }),
  onboardingDone: z.boolean(),
});
export type HomeConfig = z.infer<typeof HomeConfig>;
/** <home>/browser.json — written by `setup --browser`; passed as browserExecutable to every Remotion call. */
export const BrowserDoc = z.object({ schemaVersion: docVersion("browser"), executable: z.string(), version: z.string(), installedAt: IsoDateTime });
export type BrowserDoc = z.infer<typeof BrowserDoc>;

// ---- inferred types (one per schema constant)
export type CostUnit = z.infer<typeof CostUnit>;
export type CostLine = z.infer<typeof CostLine>;
export type QaCheck = z.infer<typeof QaCheck>;
export type RenderChunk = z.infer<typeof RenderChunk>;
```

### 4.16 `fonts.ts`, `util/ids.ts`, `util/paths.ts` (path table and document registry)

```ts
// $SP/design/core-v2/src/fonts.ts
// packages/core/src/fonts.ts — the built-in font families (OFL, self-hosted via @fontsource/*@5.3.0).
// @docmaker/remotion FONT_REGISTRY MUST cover exactly these (test); styles may reference only these (or their own fonts/, M2).
export interface BuiltinFont { family: string; fontsource: string; weights: readonly number[]; italic: boolean }
export const BUILTIN_FONTS: readonly BuiltinFont[] = [
  { family: "Anton", fontsource: "@fontsource/anton", weights: [400], italic: false },
  { family: "Archivo Black", fontsource: "@fontsource/archivo-black", weights: [400], italic: false },
  { family: "Inter", fontsource: "@fontsource/inter", weights: [400, 600, 800, 900], italic: false },
  { family: "JetBrains Mono", fontsource: "@fontsource/jetbrains-mono", weights: [400, 700], italic: false },
  { family: "Instrument Serif", fontsource: "@fontsource/instrument-serif", weights: [400], italic: true },
  { family: "Courier Prime", fontsource: "@fontsource/courier-prime", weights: [400, 700], italic: false },
  { family: "Special Elite", fontsource: "@fontsource/special-elite", weights: [400], italic: false },
];
export const BUILTIN_FONT_FAMILIES: readonly string[] = BUILTIN_FONTS.map((f) => f.family);
/** FR glyph test string used by FontGate and the FontSpecimen composition. */
export const FONT_TEST_STRING = "ÀÂÇÉÈÊËÎÏÔŒÙÛÜ « » œ 1 200 € Aa1";
```

```ts
// $SP/design/core-v2/src/util/ids.ts
// packages/core/src/util/ids.ts — the ONE place item ids are built (content-stable where possible). Normative.
import type { SfxCategory } from "../schema/media";
import type { OverlayComponentId } from "../schema/components";
import type { FxKind } from "../schema/timeline";

const pad = (n: number, w: number) => String(n).padStart(w, "0");
export const ids = {
  chapter: (n: number) => `CH${n}`,
  segment: (chapterId: string, n: number) => `${chapterId}-S${pad(n, 2)}`,
  beat: (chapterId: string, seq: number) => `${chapterId}-B${pad(seq, 3)}`, // assigned in code after validation
  clipBeat: (segmentId: string) => `${segmentId}-CLIP`,
  breathBeat: (segmentId: string) => `${segmentId}-BR`,
  word: (segmentId: string, idx: number) => `${segmentId}:${idx}`,
  clipWord: (segmentId: string, n: number) => `clip:${segmentId}:${n}`,
  trWord: (segmentId: string, page: number, n: number) => `tr:${segmentId}:${page}:${n}`,
  // timeline items
  shot: (beatId: string, shot: number) => `v:${beatId}:${shot}`, // positional within a beat (overrides are fingerprinted)
  overlay: (ref: string, component: OverlayComponentId, n: number) => `ov:${ref}:${component}:${n}`,
  caption: (segmentId: string, n: number) => `cap:${segmentId}:${n}`,
  keywordCaption: (segmentId: string, n: number) => `kw:${segmentId}:${n}`,
  translationCaption: (segmentId: string, page: number) => `capt:${segmentId}:${page}`,
  fx: (sourceId: string, kind: FxKind) => `fx:${sourceId}:${kind}`,
  sfx: (sourceItemId: string, category: SfxCategory, n?: number) => (n === undefined ? `sfx:${sourceItemId}:${category}` : `sfx:${sourceItemId}:${category}:${n}`),
  music: (chapterId: string, restart?: number) => (restart === undefined ? `mus:${chapterId}` : `mus:${chapterId}:r${restart}`),
  silence: (reason: "reveal" | "chapter" | "drop_out" | "irony" | "bleep" | "user", ref: string) => `sil:${reason}:${ref}`,
  vo: (segmentId: string, part?: "b") => (part ? `vo:${segmentId}:${part}` : `vo:${segmentId}`),
  clipAudio: (segmentId: string) => `ca:${segmentId}`,
  marker: (kind: string, ref: string) => `mk:${kind}:${ref}`,
} as const;
```

```ts
// $SP/design/core-v2/src/util/paths.ts
// packages/core/src/util/paths.ts — project path table (§5.2) + document registry. Pure (no node:*). Normative.
import type { z } from "zod";
import type { DocKind, Lang } from "../schema/common";
import type { StageId } from "../schema/ops";
import { Project } from "../schema/project";
import { FactSheet, RegistryDoc, ResearchDossier, StyleSuggestion, Verification } from "../schema/research";
import { Outline } from "../schema/outline";
import { FactCheck, Script } from "../schema/script";
import { BeatPlansDoc, BeatSlicesDoc } from "../schema/beats";
import {
  CandidatesDoc, ClipWordsDoc, EntitiesDoc, FrozenDoc, Ledger, LocalIndexDoc, PicksDoc, UserPicksDoc,
} from "../schema/assets";
import { MusicDoc } from "../schema/media";
import { ActiveTake, VoiceTrack } from "../schema/voice";
import { ProgramLayout } from "../schema/layout";
import { OverridesDoc, Timeline, UsageDoc } from "../schema/timeline";
import {
  ApprovalsDoc, CostEstimate, JobsIndex, LoudnessDoc, ProjectState, QaReport, RenderDoc, TimelineLintDoc,
} from "../schema/ops";

export const P = {
  project: "project.json",
  state: "state.json",
  approvals: "approvals.json",
  lock: ".lock", // job lock (one running job per project)
  jobsIndex: "jobs/index.json",
  jobEvents: (jobId: string) => `jobs/${jobId}.ndjson`,
  receipts: "costs/receipts.ndjson",
  estimate: (stage: StageId, lang: Lang | null) => `costs/estimates/${stage}${lang ? "." + lang : ""}.json`,
  llmRaw: (fingerprint: string) => `costs/llm/${fingerprint}.json`,
  dossier: "research/dossier.json",
  dossierMd: "research/dossier.md",
  registry: "research/registry.json",
  factsheet: "research/factsheet.json",
  verification: "research/verification.json",
  researchTurn: (n: number) => `research/raw/turn-${n}.json`,
  styleSuggestion: "style/suggestion.json",
  outline: "outline/outline.json",
  script: (lang: Lang) => `script/${lang}/script.json`, // the ONLY script source of truth
  chapterCache: (lang: Lang, chapterId: string) => `script/${lang}/.cache/${chapterId}.json`, // LLM output cache, never an input
  factcheck: (lang: Lang) => `script/${lang}/factcheck.json`,
  teleprompter: (lang: Lang) => `voice/${lang}/teleprompter.html`,
  beatPlans: "beats/plans.json",
  beatSlices: (lang: Lang) => `beats/${lang}.json`,
  candidates: (beatId: string) => `assets/candidates/${beatId}.json`,
  userPicks: "assets/user-picks.json", // user input; never written by a stage
  picks: "assets/picks.json",
  frozen: "assets/frozen.json",
  ledger: "assets/ledger.json",
  music: "assets/music.json",
  entities: "research/entities.json", // personId → QID + aliases (resolved by the research stage)
  localIndex: "assets/local-index.json",
  clipWords: (segmentId: string) => `assets/clips/${segmentId}.json`,
  credits: (lang: Lang) => `assets/credits.${lang}.md`,
  media: (assetId: string, ext: string) => `media/${assetId}.${ext}`,
  uploads: "uploads/", // staging for web uploads (declaration required before import)
  activeTake: (lang: Lang) => `voice/${lang}/active.json`,
  take: (lang: Lang, takeId: string) => `voice/${lang}/${takeId}/take.json`,
  takeSegment: (lang: Lang, takeId: string, segmentId: string) => `voice/${lang}/${takeId}/seg/${segmentId}.wav`,
  segmentCache: (lang: Lang, cacheKey: string) => `voice/${lang}/.segcache/${cacheKey}.wav`,
  recordings: (lang: Lang) => `voice/${lang}/recordings/`,
  layout: (lang: Lang) => `layout/${lang}.json`,
  voProgram: (lang: Lang) => `program/${lang}/vo_program.wav`,
  timeline: (lang: Lang) => `timeline/${lang}.json`,
  overrides: (lang: Lang) => `timeline/${lang}.overrides.json`,
  timelineLint: (lang: Lang) => `timeline/${lang}.lint.json`,
  usage: (lang: Lang) => `timeline/${lang}.usage.json`,
  mix: (lang: Lang) => `audio/${lang}/mix.wav`,
  stem: (lang: Lang, stem: "vo" | "music" | "sfx" | "clip") => `audio/${lang}/stems/${stem}.wav`,
  loudness: (lang: Lang) => `audio/${lang}/loudness.json`,
  renderDir: (lang: Lang, preset: string) => `render/${lang}/${preset}/`,
  renderSnapshot: (lang: Lang, preset: string) => `render/${lang}/${preset}/snapshot/`,
  renderChunk: (lang: Lang, preset: string, hash: string) => `render/${lang}/${preset}/chunks/${hash}.ts`,
  renderFinal: (lang: Lang, preset: string) => `render/${lang}/${preset}/final.mp4`,
  renderDoc: (lang: Lang, preset: string) => `render/${lang}/${preset}/render.json`,
  exportDir: (lang: Lang) => `export/${lang}/`,
  qaReport: (lang: Lang, preset: string) => `qa/${lang}/${preset}/report.json`,
  qaSheets: (lang: Lang, preset: string) => `qa/${lang}/${preset}/sheets/`,
  history: (rel: string) => `.history/${rel}/`, // last 20 versions of user-editable docs
} as const;
export type ProjectPaths = typeof P;

export type DocOwner = StageId | "user" | "engine";
export interface DocRegistryEntry {
  pattern: RegExp;
  kind: DocKind;
  schema: z.ZodType;
  owner: DocOwner; // the ONLY writer (besides migrations). "user" docs are written via writeDoc only.
  userEditable: boolean; // PUT allowed through engine.writeDoc (keeps .history)
  compact: boolean; // stableStringify indent 0 (large generated docs)
}
/** writeJson/readDoc consult this table: validation, migration, ownership, history, compaction. */
export const DOC_REGISTRY: readonly DocRegistryEntry[] = [
  { pattern: /^project\.json$/, kind: "project", schema: Project, owner: "engine", userEditable: true, compact: false },
  { pattern: /^state\.json$/, kind: "state", schema: ProjectState, owner: "engine", userEditable: false, compact: false },
  { pattern: /^approvals\.json$/, kind: "approvals", schema: ApprovalsDoc, owner: "engine", userEditable: false, compact: false },
  { pattern: /^jobs\/index\.json$/, kind: "jobsIndex", schema: JobsIndex, owner: "engine", userEditable: false, compact: false },
  { pattern: /^costs\/estimates\/[a-z]+(\.(en|fr))?\.json$/, kind: "estimate", schema: CostEstimate, owner: "engine", userEditable: false, compact: false },
  { pattern: /^research\/dossier\.json$/, kind: "dossier", schema: ResearchDossier, owner: "research", userEditable: false, compact: false },
  { pattern: /^research\/registry\.json$/, kind: "registry", schema: RegistryDoc, owner: "research", userEditable: false, compact: false },
  { pattern: /^research\/factsheet\.json$/, kind: "factsheet", schema: FactSheet, owner: "research", userEditable: true, compact: false },
  { pattern: /^research\/verification\.json$/, kind: "verification", schema: Verification, owner: "research", userEditable: false, compact: false },
  { pattern: /^style\/suggestion\.json$/, kind: "styleSuggestion", schema: StyleSuggestion, owner: "style", userEditable: false, compact: false },
  { pattern: /^outline\/outline\.json$/, kind: "outline", schema: Outline, owner: "outline", userEditable: true, compact: false },
  { pattern: /^script\/(en|fr)\/script\.json$/, kind: "script", schema: Script, owner: "script", userEditable: true, compact: false },
  { pattern: /^script\/(en|fr)\/factcheck\.json$/, kind: "factcheck", schema: FactCheck, owner: "factcheck", userEditable: true, compact: false },
  { pattern: /^beats\/plans\.json$/, kind: "beatPlans", schema: BeatPlansDoc, owner: "beats", userEditable: true, compact: false },
  { pattern: /^beats\/(en|fr)\.json$/, kind: "beatSlices", schema: BeatSlicesDoc, owner: "beatslice", userEditable: true, compact: false },
  { pattern: /^assets\/candidates\/[A-Z0-9-]+\.json$/, kind: "candidates", schema: CandidatesDoc, owner: "assets", userEditable: false, compact: true },
  { pattern: /^assets\/user-picks\.json$/, kind: "userPicks", schema: UserPicksDoc, owner: "user", userEditable: true, compact: false },
  { pattern: /^assets\/picks\.json$/, kind: "picks", schema: PicksDoc, owner: "assets", userEditable: false, compact: false },
  { pattern: /^assets\/frozen\.json$/, kind: "frozen", schema: FrozenDoc, owner: "assets", userEditable: false, compact: true },
  { pattern: /^assets\/ledger\.json$/, kind: "ledger", schema: Ledger, owner: "assets", userEditable: false, compact: false },
  { pattern: /^assets\/music\.json$/, kind: "music", schema: MusicDoc, owner: "assets", userEditable: false, compact: false },
  { pattern: /^research\/entities\.json$/, kind: "entities", schema: EntitiesDoc, owner: "research", userEditable: true, compact: false },
  { pattern: /^assets\/local-index\.json$/, kind: "localIndex", schema: LocalIndexDoc, owner: "user", userEditable: false, compact: false },
  { pattern: /^assets\/clips\/[A-Z0-9-]+\.json$/, kind: "clipWords", schema: ClipWordsDoc, owner: "assets", userEditable: false, compact: true },
  { pattern: /^voice\/(en|fr)\/active\.json$/, kind: "activeTake", schema: ActiveTake, owner: "voice", userEditable: true, compact: false },
  { pattern: /^voice\/(en|fr)\/(take|scratch)-[a-f0-9]{12}\/take\.json$/, kind: "voiceTrack", schema: VoiceTrack, owner: "voice", userEditable: false, compact: true },
  { pattern: /^layout\/(en|fr)\.json$/, kind: "layout", schema: ProgramLayout, owner: "layout", userEditable: false, compact: true },
  { pattern: /^timeline\/(en|fr)\.json$/, kind: "timeline", schema: Timeline, owner: "direct", userEditable: false, compact: true },
  { pattern: /^timeline\/(en|fr)\.overrides\.json$/, kind: "overrides", schema: OverridesDoc, owner: "user", userEditable: true, compact: false },
  { pattern: /^timeline\/(en|fr)\.lint\.json$/, kind: "timelineLint", schema: TimelineLintDoc, owner: "direct", userEditable: false, compact: false },
  { pattern: /^timeline\/(en|fr)\.usage\.json$/, kind: "usage", schema: UsageDoc, owner: "direct", userEditable: false, compact: false },
  { pattern: /^audio\/(en|fr)\/loudness\.json$/, kind: "loudness", schema: LoudnessDoc, owner: "mix", userEditable: false, compact: false },
  { pattern: /^render\/(en|fr)\/(draft|master)\/render\.json$/, kind: "render", schema: RenderDoc, owner: "render", userEditable: false, compact: false },
  { pattern: /^qa\/(en|fr)\/(draft|master)\/report\.json$/, kind: "qa", schema: QaReport, owner: "qa", userEditable: false, compact: false },
];
export declare function docEntryFor(rel: string): DocRegistryEntry | null; // first matching pattern
```

`DOC_REGISTRY` drives four behaviours of `ProjectStore`: schema validation on write, migration on read, **ownership** (a stage may write only documents whose `owner` is its own id; `user` documents are written only through `engine.writeDoc`; violation → `VALIDATION "stage X may not write Y"`), and `.history/` for `userEditable` documents. **Rule: no stage writes a file owned by another stage**, and no stage output is also its own input.

### 4.17 `interfaces.ts` (cross-package TS interfaces; not persisted)

```ts
// $SP/design/core-v2/src/interfaces.ts
// packages/core/src/interfaces.ts — cross-package TS interfaces (not persisted). Browser-safe (types only).
import type { Lang, LintIssue } from "./schema/common";
import type { AssetProviderId, Secrets, VoiceProviderId, VoiceSettings } from "./schema/project";
import type { AssetKind, AssetQuery, Candidate, CandidateScore } from "./schema/assets";
import type { LicenseInfo } from "./schema/license";
import type { TimingSource, WordTiming } from "./schema/voice";
import type {
  CostEstimate, GeneratedStillsRequest, GlProbe, JobEventInput, OverlayRenderRequest, Receipt, RenderRequest,
  RenderResult, StageId, StillsRequest,
} from "./schema/ops";

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface HomePaths {
  home: string; // DOCMAKER_HOME (~/.documentarymaker)
  cache: string; // <home>/cache
  blobs: string; // <home>/cache/blobs
  httpCache: string; // <home>/cache/http
  models: string; // <home>/models/{kokoro,piper,whisper}
  ml: string; // <home>/ml (CLIP runtime installed by `setup --clip`, loaded with createRequire; M3)
  sfx: string; // <home>/sfx/<pack>/<version>/
  music: string; // <home>/music/procedural/
  styles: string; // <home>/styles/<id>/ (user style directories, auto-discovered)
  bundles: string; // <home>/bundles/<codeHash>/
  bin: string; // <home>/bin (yt-dlp standalone if no venv)
  pyVenv: string; // <home>/py/.venv
  locks: string; // <home>/locks
  logs: string; // <home>/logs
  envFile: string; // <home>/.env (secrets, 0600)
  configFile: string; // <home>/config.json (HomeConfig)
  browserFile: string; // <home>/browser.json (BrowserDoc)
  glProbe: string; // <home>/gl-probe.json
}

export interface RuntimeConfig {
  repoRoot: string; // absolute; repo files (fixtures, workers, DTDs, builtin styles) are ALWAYS located from here
  paths: HomePaths;
  projectsDir: string;
  contact: string | null; // DOCMAKER_CONTACT ?? HomeConfig.contact — sent ONLY to CONTACT_UA_HOSTS
  userAgentBase: string; // `DocumentaryMaker/<version>` (+ ` (+<homepage>)` when package.json has one)
  ffmpeg: string;
  ffprobe: string;
  offline: boolean; // true → HttpClient throws OFFLINE before opening any socket
  logLevel: "debug" | "info" | "warn" | "error";
  autoApproveUsd: number;
  browserExecutable: string | null; // from <home>/browser.json
  renderLockFile: string; // machine-wide render lock (DOCMAKER_RENDER_LOCK ?? /tmp/docmaker-render.lock)
}
/** Hosts that receive `contact: …` in the User-Agent. Everything else gets userAgentBase only. */
export const CONTACT_UA_HOSTS: readonly string[] = ["commons.wikimedia.org", "upload.wikimedia.org", "www.wikidata.org", "wikidata.org", "api.openverse.org"];

export type Progress = (pct: number, message: string, detail?: Record<string, unknown>) => void;

// ---------------------------------------------------------------- media probing / paths
export interface FfprobeStream {
  index: number; codecType: "video" | "audio" | "subtitle" | "data"; codecName: string;
  width: number | null; height: number | null; pixFmt: string | null; fps: number | null; // r_frame_rate as a number
  sampleRate: number | null; channels: number | null; durationSec: number | null; nbFrames: number | null;
}
export interface FfprobeResult { formatName: string; durationSec: number; bitRate: number | null; streams: FfprobeStream[] }

// ---------------------------------------------------------------- HTTP (assets, research verification)
export interface HttpGetOptions {
  headers?: Record<string, string>;
  timeoutMs?: number; // header timeout default 10 000
  cacheTtlSec?: number; // provider response cache (Pixabay 86 400)
  maxBytes?: number; // default 256 MiB (images/audio), video 2 GiB
  signal: AbortSignal;
}
export interface HttpClient {
  getJson<T>(url: string, opts: HttpGetOptions): Promise<T>;
  getText(url: string, opts: HttpGetOptions): Promise<string>;
  postForm<T>(url: string, form: Record<string, string>, opts: HttpGetOptions): Promise<T>;
  postJson<T>(url: string, body: unknown, opts: HttpGetOptions): Promise<T>;
  download(url: string, destPath: string, opts: HttpGetOptions): Promise<{ bytes: number; mime: string; finalUrl: string }>;
}

// ---------------------------------------------------------------- assets
export interface ProviderLimits { perMin?: number; perHour?: number; perDay?: number; concurrency: number }
export interface ProviderContext { secrets: Secrets; config: RuntimeConfig; logger: Logger; http: HttpClient; signal: AbortSignal }
export interface AssetProvider {
  readonly id: AssetProviderId;
  readonly kinds: readonly AssetKind[];
  readonly needsKey: boolean;
  readonly paid: boolean; // true → cost gate; excluded from live search unless allowPaid
  readonly costPerCallUsd: number;
  readonly limits: ProviderLimits;
  isConfigured(secrets: Secrets, config: RuntimeConfig): boolean;
  search(q: AssetQuery, ctx: ProviderContext): Promise<{ candidate: Candidate; raw: unknown }[]>;
  /** Fetch ORIGINAL bytes to destDir (yt-dlp, http, generator…). Conform + freeze happen in the registry. */
  fetchOriginal(c: Candidate, destDir: string, ctx: ProviderContext): Promise<{ path: string; mime: string }>;
}
export interface RerankInput {
  beatId: string;
  visualQuery: string;
  narration: string; // beat text (primary lang)
  visualKind: string;
  identityHint: string; // provenance-only identity (e.g. "Commons P180=Q37175"); vision never identifies people
}
export interface Reranker {
  rerank(
    input: RerankInput,
    candidates: Candidate[],
    thumbPaths: string[], // local JPEG thumbnails ≤ 768 px, same order
    signal: AbortSignal,
  ): Promise<{
    scores: Pick<CandidateScore, "vision" | "technical" | "watermark" | "nsfw" | "focal" | "safeCrop" | "notes">[];
    receipt: Receipt | null;
  }>;
}

// ---------------------------------------------------------------- voice
export interface VoiceInfo {
  id: string; name: string; lang: Lang; gender: "male" | "female" | "unknown"; provider: VoiceProviderId;
  license: LicenseInfo; // Piper CC-BY → attribution; ElevenLabs → PROVIDER-TERMS (+ free-tier attribution/nc)
  cloned: boolean; // ElevenLabs cloned/professional voices → VoiceSettings.cloneConsent required
}
export interface TtsCapabilities {
  languages: Lang[];
  nativeWordTimestamps: boolean;
  stitching: boolean;
  maxCharsPerRequest: number;
  voiceCloning: boolean;
  normalizesNumbers: boolean; // false → buildTtsText expands numbers
  costPer1kCharsUsd: number;
  tier: string | null; // ElevenLabs subscription tier ("free" → non-commercial + attribution warning)
}
export interface TtsRequest {
  segmentId: string;
  text: string; // ttsText
  ttsWords: string[]; // tokens of ttsText (alignment targets)
  lang: Lang;
  voice: VoiceSettings;
  previousText?: string;
  nextText?: string;
  previousRequestIds?: string[]; // ElevenLabs, ≤3 (slice(-3)), < 2 h old
  seed?: number;
}
export interface TtsResult {
  segmentId: string;
  audioPath: string; // raw provider output (any rate/format); the post chain converts to 48 kHz mono
  durationMs: number;
  words: WordTiming[] | null; // one per ttsWord, relative to audio start; null → run an Aligner
  timingSource: TimingSource;
  providerRequestId: string | null;
  charsBilled: number;
}
export interface TtsProvider {
  readonly id: VoiceProviderId;
  isAvailable(): Promise<{ ok: boolean; hint: string | null }>;
  capabilities(): Promise<TtsCapabilities>;
  listVoices(lang?: Lang): Promise<VoiceInfo[]>;
  synthesize(req: TtsRequest, outPath: string, signal: AbortSignal): Promise<TtsResult>;
}
export interface Aligner {
  readonly id: "estimated" | "faster-whisper" | "whisper-cpp" | "elevenlabs-forced";
  isAvailable(): Promise<{ ok: boolean; hint: string | null }>;
  /** Free transcription (recordings, YouTube fallback). */
  transcribe(audioPath: string, lang: Lang, namesPrompt: string, signal: AbortSignal): Promise<WordTiming[]>;
  /** Script-guided: returns exactly ttsWords.length timings (NW + interpolation). */
  align(audioPath: string, ttsWords: string[], lang: Lang, signal: AbortSignal): Promise<WordTiming[]>;
}

// ---------------------------------------------------------------- render (the engine never imports @docmaker/render; DI)
export interface RenderHandlers { onEvent(e: JobEventInput): void; signal: AbortSignal }
export interface RenderClient {
  render(req: RenderRequest, h: RenderHandlers): Promise<RenderResult>;
  renderStills(req: StillsRequest, h: RenderHandlers): Promise<string[]>;
  renderOverlays(req: OverlayRenderRequest, h: RenderHandlers): Promise<{ itemId: string; file: string }[]>; // M3
  renderGeneratedStills(req: GeneratedStillsRequest, h: RenderHandlers): Promise<{ clipId: string; file: string }[]>; // PNG for NLE export
  probeGl(force?: boolean): Promise<GlProbe>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------- costs
export interface CostTracker {
  /** Persist an estimate; returns it with planHash. */
  estimate(e: Omit<CostEstimate, "schemaVersion" | "id" | "createdAt" | "planHash">, inputsHash: string): Promise<CostEstimate>;
  /** Idempotence for paid calls: same fingerprint → reuse stored output, never pay twice. */
  findReceipt(fingerprint: string): Promise<Receipt | null>;
  record(r: Omit<Receipt, "createdAt" | "jobId">): Promise<Receipt>;
  spentUsd(stage: StageId, lang: Lang | null): number; // in the current job
  spentTotalUsd(): number; // whole project (receipts.ndjson)
  /** Throws BUDGET_EXCEEDED when spend > max(1.5 × approved estimate, estimate + $1), > maxUsdPerStage, or > maxUsdTotal. */
  assertWithinBudget(stage: StageId, lang: Lang | null): void;
}

// ---------------------------------------------------------------- linters
export type Linter<T> = (value: T) => LintIssue[];
```

### 4.18 Core utilities (signatures and algorithms)

**Isomorphic utilities** (`@docmaker/core`):

```ts
// $SP/design/core-v2/src/util/signatures.ts
// Normative signatures of the ISOMORPHIC utilities exported by "@docmaker/core" (".").
// Files: packages/core/src/util/{json,sha256,rng,time,tokenize,anchors,gain,integrity,migrate,errors,project-defaults}.ts
// RULE: nothing reachable from "." may import `node:*` (lint-enforced). Node-only helpers live in "./node".
import type { DocKind, Lang, LintIssue } from "../schema/common";
import type { NewProjectInput, Project } from "../schema/project";
import type { ErrorCode } from "../schema/ops";
import type { Anchor, Timeline } from "../schema/timeline";
import type { ProgramLayout } from "../schema/layout";
import type { Script, ScriptSegment } from "../schema/script";
import type { FactSheet } from "../schema/research";
import type { Outline } from "../schema/outline";
import type { BeatPlansDoc, BeatSlicesDoc } from "../schema/beats";
import type { FrozenDoc, PicksDoc, UserPicksDoc } from "../schema/assets";
import type { OverridesDoc } from "../schema/timeline";

// ---- json.ts
/** Keys sorted recursively (UTF-16 code unit order); undefined props dropped; -0 → 0; NaN/±Infinity → throw VALIDATION. */
export declare function canonicalJson(v: unknown): string;
/** Canonical key order; indent 2 for human-edited docs, 0 (compact) for timeline/layout. Trailing "\n". */
export declare function stableStringify(v: unknown, indent?: number): string;

// ---- sha256.ts — PURE-JS SHA-256 (FIPS 180-4) so hashing works in the browser, Remotion bundles and Node alike.
export declare function sha256Hex(data: string | Uint8Array): string; // strings are UTF-8 encoded
export declare function hashJson(v: unknown): string; // sha256Hex(canonicalJson(v))
export declare function sha16(s: string): string; // sha256Hex(s).slice(0, 16)
export declare function sha12(s: string): string;
export declare function sha8(s: string): string;
/** Wall-clock fields excluded from content hashes (docHash). */
export const VOLATILE_KEYS = ["updatedAt", "createdAt", "checkedAt", "frozenAt", "retrievedAt", "setAt", "generatedAt", "approvedAt", "probedAt", "installedAt"] as const;
export declare function omitVolatile<T>(v: T): T; // deep copy without VOLATILE_KEYS (at any depth)
/** Content hash used in EVERY stage inputs hash: hashJson(omitVolatile(doc)). Byte etags are only for optimistic concurrency. */
export declare function docHash(v: unknown): string;

// ---- rng.ts
export declare function fnv1a32(s: string): number; // FNV-1a over UTF-8 bytes
export declare function mulberry32(seed: number): () => number; // identical to $SP/mgtest/motion.ts rng()
export declare function rngFor(seed: number, key: string): () => number; // mulberry32(fnv1a32(`${seed}|${key}`))
export declare function lerp(r: readonly [number, number], t: number): number; // r[0] + (r[1]-r[0])·t
export declare function weightedPick<K extends string>(weights: Partial<Record<K, number>>, r: () => number): K | null; // keys sorted, zero weights skipped

// ---- time.ts
export const msToFrame = (ms: number, fps: number): number => Math.round((ms * fps) / 1000);
export const frameToMs = (f: number, fps: number): number => Math.round((f * 1000) / fps);
export const secToFrames = (s: number, fps: number): number => Math.round(s * fps);
export const framesAt = (fps: number, frames30: number): number => Math.round((frames30 * fps) / 30);
/** Sample index of a frame at 48 kHz: exact integer for 24, 25 and 30 fps. */
export const frameToSample48k = (f: number, fps: number): number => (f * 48000) / fps;
export declare function timecode(frame: number, fps: number): string; // "HH:MM:SS:FF" NDF
export declare function srtTime(frame: number, fps: number): string; // "HH:MM:SS,mmm"

// ---- tokenize.ts (rule in §4.5)
export const TOKENIZER_VERSION = 1;
export interface DisplayWord { idx: number; text: string; norm: string; start: number; end: number }
export declare function normWord(s: string): string;
export declare function tokenizeDisplay(text: string): DisplayWord[];
export declare function wordId(segmentId: string, idx: number): string;
export declare function parseWordId(id: string): { segmentId: string; idx: number };
export declare function chapterOfSegment(segmentId: string): string; // "CH3-S07" → "CH3"
export declare function chapterOfBeat(beatId: string): string;
/** The ONE definition of the text spoken (and tokenised) for a segment in a layout mode (voice, layout, director share it). */
export declare function spokenText(
  seg: Pick<ScriptSegment, "type" | "displayText" | "subtitleTranslation">,
  mode: "vo" | "clip-narrated" | "none",
): string; // vo → displayText; clip-narrated → subtitleTranslation || displayText; none → ""
/** Maps beat texts (exact slices) onto display-word ranges; throws VALIDATION if slices do not reconstruct the segment.
 *  Clip and breath segments are never passed here (their beats carry no text). */
export declare function beatWordRanges(segmentText: string, beatTexts: string[]): { wordStart: number; wordEnd: number }[];
/** Time a chapter card / title sting needs before the narrator resumes (layout gap = max(pauses.chapterGapMs, this)). */
export declare function chapterCardReadMs(title: string, enterFrames30: number): number; // 1000·(enter/30 + max(1.2, chars/20 + 0.8)) − 200

// ---- anchors.ts
export interface AnchorIndex {
  words: Map<string, { from: number; end: number; norm: string }>; // end = from + dur
  segments: Map<string, { from: number; end: number }>;
  beats: Map<string, { from: number; end: number }>;
  chapters: Map<string, { from: number; end: number }>;
  programEnd: number;
  layoutHash: string;
}
export declare function buildAnchorIndex(layout: ProgramLayout, layoutHash: string): AnchorIndex;
/** start edge → from, end edge → end; + offset; clamped to [0, programEnd]. Unknown id → DocmakerError("ANCHOR_MISSING"). */
export declare function resolveAnchor(a: Anchor, ix: AnchorIndex): number;
/**
 * Re-resolves every timed item's from/dur from its anchors and keeps video contiguous. VALID ONLY when
 * ix.layoutHash === t.layoutHash (else throws VALIDATION "re-direct required"). Used by direct() for override items
 * and by lint RESOLVE_MISMATCH (resolveTimeline(t).timeline must deep-equal t). Pure.
 */
export declare function resolveTimeline(t: Timeline, ix: AnchorIndex): { timeline: Timeline; dropped: string[] };

// ---- gain.ts — shared by the Remotion preview and the offline mixer (preview parity)
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-9));
export interface GainTables { fps: number; length: number; music: Float32Array; sfx: Float32Array; clip: Float32Array; vo: Float32Array }
export declare function computeGainTables(t: Timeline): GainTables;
/** Per-item envelope (fades) as linear gain for an item-local frame. Loops do not reset the envelope. */
export declare function itemEnvelope(item: { dur: number; fadeInFrames?: number; fadeOutFrames?: number }, localFrame: number): number;

// ---- integrity.ts — cross-document reference checks, run at every stage boundary and on every writeDoc
export interface DocSet {
  project?: Project; factSheet?: FactSheet; outline?: Outline; scripts?: Partial<Record<Lang, Script>>;
  plans?: BeatPlansDoc; slices?: Partial<Record<Lang, BeatSlicesDoc>>; userPicks?: UserPicksDoc; picks?: PicksDoc;
  frozen?: FrozenDoc; timeline?: Timeline; overrides?: OverridesDoc;
}
export declare function checkRefs(d: DocSet): LintIssue[]; // rule codes REF_* (§4.18 table); level error unless noted
export declare function collectAssetIds(t: Timeline): string[]; // every assetId in sources, overlay props, audio (sorted, unique)
export declare function timelineItemIds(t: Timeline): string[]; // all item ids (uniqueness check IDS_UNIQUE)
/** Hard invariant: identical ordered (segmentId, type, quoteId) per chapter. Non-empty result → LANG_PARITY. */
export declare function validateLangParity(primary: Script, other: Script): LintIssue[];

// ---- migrate.ts
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
export declare function registerMigration(kind: DocKind, from: number, fn: Migration): void; // from → from+1
/** Runs the chain from raw.schemaVersion up to DOC_VERSIONS[kind]. Never writes back. Missing step → MIGRATION_FAILED. */
export declare function migrateDoc(kind: DocKind, raw: unknown): { value: unknown; migratedFrom: number | null };

// ---- errors.ts
export declare class DocmakerError extends Error {
  constructor(code: ErrorCode, message: string, opts?: { retryable?: boolean; hint?: string; cause?: unknown; details?: unknown });
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly hint: string | null;
  readonly details: unknown;
}
export declare function isDocmakerError(e: unknown): e is DocmakerError;

// ---- project-defaults.ts
export declare function defaultProject(
  input: NewProjectInput, now: Date,
  detected: { hasElevenLabs: boolean; kokoro: boolean; piper: boolean; homeDefaults: { languages: Lang[]; targetMinutes: number } | null },
): Project;
export declare function slugify(s: string): string; // NFKD, ascii, lowercase, [a-z0-9-], ≤ 48 chars
```

**Node utilities** (`@docmaker/core/node`):

```ts
// $SP/design/core-v2/src/node/signatures.ts
// Normative signatures of "@docmaker/core/node" (Node-only: node:fs, node:child_process, node:crypto…).
// Files: packages/core/src/node/{store,env,logger,proc,hash,wav,loudness,locks,home}.ts, re-exported by src/node/index.ts.
import type { z } from "zod";
import type { Lang } from "../schema/common";
import type { Secrets } from "../schema/project";
import type { BrowserDoc, HomeConfig } from "../schema/ops";
import type { FfprobeResult, Logger, RuntimeConfig } from "../interfaces";

// ---- store.ts
export interface StoreWriteOptions {
  ifMatch?: string | null; // optimistic concurrency on BYTE etags → CONFLICT on mismatch (null = must not exist)
  writer: "stage" | "user" | "engine"; // ownership check against DOC_REGISTRY.owner (stages may only write their own docs)
  stage?: string; // the writing stage id when writer = "stage"
}
export declare class ProjectStore {
  static create(projectsDir: string, project: unknown): Promise<ProjectStore>;
  static open(projectsDir: string, slug: string): Promise<ProjectStore>;
  readonly dir: string;
  readonly slug: string;
  abs(rel: string): string; // path.resolve + traversal guard (must stay inside dir)
  exists(rel: string): Promise<boolean>;
  /** Reads, runs migrateDoc(kind) when DOC_REGISTRY knows the path, then schema.parse. Never writes back implicitly. */
  readJson<S extends z.ZodType>(rel: string, schema: S): Promise<z.infer<S>>;
  readJsonOrNull<S extends z.ZodType>(rel: string, schema: S): Promise<z.infer<S> | null>;
  /**
   * validate → stableStringify(indent: entry.compact ? 0 : 2) → tmp + rename. SKIPS the write when docHash(new) === docHash(old)
   * (returns changed:false), so no-op re-runs never cascade. userEditable docs keep the previous version in .history/ (last 20).
   */
  writeJson<S extends z.ZodType>(rel: string, schema: S, value: z.input<S>, opts: StoreWriteOptions): Promise<{ etag: string; docHash: string; changed: boolean }>;
  etag(rel: string): Promise<string | null>; // sha256 of the bytes (concurrency only)
  docHashOf(rel: string): Promise<string | null>; // docHash of the parsed doc (inputs hashing)
  history(rel: string): Promise<{ file: string; at: string; etag: string }[]>;
  revert(rel: string, historyFile: string): Promise<{ etag: string }>;
  appendNdjson(rel: string, obj: unknown): Promise<void>;
  linkOrCopy(srcAbs: string, rel: string): Promise<void>; // hardlink, fallback copy
  /** Job lock: .lock {pid, owner, jobId, at} via O_EXCL; stale pid → take over; live → DocmakerError("LOCKED"). */
  lock(owner: string, jobId: string): Promise<() => Promise<void>>;
}

// ---- env.ts
/** Nearest ancestor of `from` containing pnpm-workspace.yaml (or DOCMAKER_REPO_ROOT). Throws CONFIG if none. */
export declare function findRepoRoot(from: string): string;
/** Precedence: process.env > <home>/.env > <repoRoot>/.env.local (tiny built-in parser; no dotenv). Called per job (no restart needed). */
export declare function loadRuntime(opts?: { cwd?: string; env?: NodeJS.ProcessEnv }): { secrets: Secrets; config: RuntimeConfig };
export declare function maskSecret(s: string | undefined): string; // "sk-a…9f3c" | "(unset)"
/** `docmaker keys set` / web key form: writes <home>/.env (mode 0600), never a project file. */
export declare function writeSecret(home: string, envName: string, value: string): Promise<void>;
/** User-Agent for a URL: userAgentBase + `; contact: <contact>` ONLY for CONTACT_UA_HOSTS. Never reads git/OS user/hostname. */
export declare function userAgentFor(url: string, config: RuntimeConfig): string;

// ---- home.ts
export declare function ensureHome(config: RuntimeConfig): Promise<void>; // creates every HomePaths dir
export declare function readHomeConfig(config: RuntimeConfig): Promise<HomeConfig>; // defaults when missing
export declare function writeHomeConfig(config: RuntimeConfig, patch: Partial<Omit<HomeConfig, "schemaVersion">>): Promise<HomeConfig>;
export declare function readBrowserDoc(config: RuntimeConfig): Promise<BrowserDoc | null>;
export declare function freeDiskBytes(dir: string): Promise<number>; // statfs
export declare function cacheCapBytes(config: RuntimeConfig): Promise<number>; // min(DOCMAKER_CACHE_MAX_GB ?? 20 GiB, 50 % of free disk)

// ---- logger.ts
export declare function createLogger(opts: { level: RuntimeConfig["logLevel"]; sink?: (line: string) => void; secrets?: Secrets; file?: string }): Logger;
// redacts every secret value and any value under keys matching /(api[-_]?key|token|secret|authorization|cookie)/i

// ---- proc.ts — every child runs in its OWN process group (detached: true) so cancel kills the whole tree
export interface RunOptions {
  signal: AbortSignal; cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number;
  onStderrLine?: (l: string) => void; onStdoutLine?: (l: string) => void; input?: string;
}
export declare function run(cmd: string, args: string[], opts: RunOptions): Promise<{ code: number; stdout: string; stderr: string }>;
/** Abort → SIGTERM to -pid (group), SIGKILL after 3 s. */
export declare function killTree(pid: number): Promise<void>;
export declare function ffmpeg(args: string[], opts: { config: RuntimeConfig; signal: AbortSignal; onProgress?: (outTimeMs: number) => void }): Promise<void>; // adds -hide_banner -nostdin -y -progress pipe:2
export declare function ffprobeJson(path: string, opts: { config: RuntimeConfig; signal: AbortSignal; countFrames?: boolean }): Promise<FfprobeResult>;
/** <pyVenv>/bin/python (Scripts\\python.exe never: Windows is WSL2-only) -m docmaker_sidecar <cmd> --in <tmp> --out <tmp>; missing venv → TOOL_MISSING. */
export declare function runSidecar<T>(cmd: "asr" | "piper-align" | "beats" | "energy" | "cuts", input: unknown, opts: { config: RuntimeConfig; signal: AbortSignal; timeoutMs?: number; onProgress?: (pct: number, msg: string) => void }): Promise<T>;

// ---- hash.ts
export declare function sha256File(path: string): Promise<string>; // streaming node:crypto; equals sha256Hex(bytes)

// ---- wav.ts — the ONE WAV implementation (voice, audio, assets, render use it)
export interface WavData { sampleRate: number; channels: number; data: Float32Array[] } // planar, [-1, 1]
export declare function readWavHeader(path: string): Promise<{ sampleRate: number; channels: number; bitsPerSample: number; format: "pcm" | "float"; frames: number; durationMs: number; dataOffset: number }>;
export declare function readWav(path: string): Promise<WavData>; // s16 / s24 / f32
export declare function writeWav(path: string, wav: WavData, format: "s16" | "s24" | "f32"): Promise<void>;
/** Streaming writer for long programs (mixer, VO program): append planar blocks, header patched on close. */
export declare function createWavWriter(path: string, o: { sampleRate: number; channels: number; format: "s16" | "s24" | "f32" }): Promise<{ write(block: Float32Array[]): Promise<void>; close(): Promise<void> }>;

// ---- loudness.ts — the ONE loudness implementation (assets conform, voice, audio mixer, render gate use it)
export interface Ebur128 { integratedLufs: number; truePeakDbtp: number; lra: number; samplePeakDbfs: number }
export declare function measureEbur128(path: string, opts: { config: RuntimeConfig; signal: AbortSignal; stream?: "a:0" }): Promise<Ebur128>; // ffmpeg ebur128=peak=true:framelog=quiet
/** Two-pass loudnorm (pass 2 linear=true; asserts normalization_type == "linear", else retries with dynamic and reports it). */
export declare function twoPassLoudnorm(input: string, output: string, opts: {
  I: number; TP: number; LRA: number; sampleRate: 48000; channels: 1 | 2; codec: "pcm_s16le" | "pcm_s24le" | "aac";
  config: RuntimeConfig; signal: AbortSignal; extraInputArgs?: string[];
}): Promise<{ measured: Ebur128; normalizationType: "linear" | "dynamic" }>;

// ---- locks.ts — machine-wide advisory locks (render slot, bundle build, model downloads)
export declare function withFileLock<T>(lockPath: string, owner: string, fn: () => Promise<T>, opts: { signal: AbortSignal; pollMs?: number; onWait?: () => void }): Promise<T>;

// ---- per-language helpers kept here because they touch the filesystem
export declare function listLangFiles(dir: string, lang: Lang): Promise<string[]>;
```

**Test factories** (`@docmaker/core/testing`):

```ts
// $SP/design/core-v2/src/testing/signatures.ts
// "@docmaker/core/testing" — deterministic factories every package tests against from day one (implemented in P0).
// File: packages/core/src/testing/factories.ts. Browser-safe (no node:*).
import type { Lang } from "../schema/common";
import type { Project } from "../schema/project";
import type { FactSheet } from "../schema/research";
import type { Script } from "../schema/script";
import type { BeatPlansDoc, BeatSlicesDoc } from "../schema/beats";
import type { ProgramLayout } from "../schema/layout";
import type { Timeline } from "../schema/timeline";
import type { SfxEntry, SfxManifest, MusicTrack } from "../schema/media";
import type { FrozenAsset, PicksDoc } from "../schema/assets";
import type { StyleData } from "../schema/style";
import type { VoiceTrack } from "../schema/voice";

/** A full, valid StyleData (copy of Appendix A at P0). Test data only — the real style lives in @docmaker/styles. */
export declare const TEST_STYLE: StyleData;
export declare function makeProject(over?: Partial<Project>): Project;
export declare function makeFactSheet(o?: { people?: number; quotes?: number; figures?: number }): FactSheet;
/** chapters × segments of narration (+ optional clip and music_breath segments); EN or FR filler text with digits and « ». */
export declare function makeScript(o?: { lang?: Lang; chapters?: number; segmentsPerChapter?: number; withClip?: boolean; withBreath?: boolean }): Script;
export declare function makeBeats(script: Script, o?: { cues?: boolean }): { plans: BeatPlansDoc; slices: BeatSlicesDoc };
/** Synthetic take with estimated word timings (cps 16.5) — no audio files. */
export declare function makeTake(script: Script, o?: { cps?: number }): VoiceTrack;
export declare function makeLayout(o?: { seconds?: number; chapters?: number; fps?: 24 | 25 | 30; withClip?: boolean; withBreath?: boolean; withReveal?: boolean }): ProgramLayout;
export declare function makeFrozen(o?: { images?: number; videos?: number; portrait?: boolean }): Record<string, FrozenAsset>;
export declare function makePicks(plans: BeatPlansDoc, frozen: Record<string, FrozenAsset>): PicksDoc;
export declare function makeSfxManifest(): SfxManifest; // one entry per category, analytic peak offsets
export declare function makeSfxEntry(over?: Partial<SfxEntry>): SfxEntry;
export declare function makeMusicTrack(o?: { bpm?: number; seconds?: number; mood?: MusicTrack["moods"][number] }): MusicTrack;
/** Valid Timeline: contiguous video (stills/video/generated), overlays of every M1 component, captions, fx, full audio. */
export declare function makeTimeline(o?: { seconds?: number; overlays?: boolean; audio?: boolean; transitions?: boolean; fps?: 24 | 25 | 30 }): Timeline;
```

**Algorithms (normative).**

*`docHash` and idempotence.* `docHash(doc) = hashJson(omitVolatile(doc))`. `inputsHash` uses `docHash` of upstream documents (never byte etags), so a forced no-op re-run that rewrites `updatedAt` changes nothing downstream. `ProjectStore.writeJson` compares `docHash(new)` with `docHash(old)` and skips the write (returns `changed:false`) when equal.

*SHA-256.* Pure-JS FIPS 180-4 over UTF-8 bytes; test vectors (`""`, `"abc"`, 1 MB of `a`) and a property test against `node:crypto` (in `test/`, not in `src/`).

*`computeGainTables(t)`.* Let `N = t.durationInFrames`, `fps = t.fps`, `d = t.audio.ducking`, `F(ms) = ms·fps/1000`. Tables are evaluated at integer frames.
1. `envVo[k] = max over voSpans [a,b) of trap(k)`: 0 outside `[s−F(attackMs), e+F(releaseMs))`, linear 0→1 across the attack, 1 on `[s, e)`, linear 1→0 across the release, with `s = a − F(padBeforeMs)`, `e = b + F(padAfterMs)`.
2. `envClip[k]`: the same over `clip` items' `[from, from+dur)`, without pads.
3. `music[k] = dbToGain(min(d.musicDuckDb·envVo[k], d.musicUnderClipDb·envClip[k]))`; `sfx[k] = dbToGain(d.sfxDuckDb·envVo[k])`; `clip[k] = dbToGain(d.clipDuckDb·envVo[k])` (applied only to items with `duckUnderVo`); `vo[k] = 1`.
4. For every `SilenceMark`, each affected table (`music | sfx | clip | vo`) is 0 on `[from, from+dur)` (`vo` only for bleeps).
5. **Gain semantics:** the mixer and the Player apply **0 dB** to `voProgram` (its loudness gain is baked) times `G.vo`; NLE exporters apply `VoClip.gainDb` (= `bakedGainDb`) to the un-normalised segment files. The mixer interpolates per sample between frames and applies a 5 ms one-pole smoother; the Player uses `volume={(f) => table[min(N−1, item.from + f)] · dbToGain(item.gainDb) · itemEnvelope(item, f)}` (voProgram: `gainDb` treated as 0).

*`voSpans`.* Layout words of `vo` and `clip-narrated` segments, merged while the gap is `< bridgeMs`, converted to frames.

*Integrity (`checkRefs`, rule codes).* `REF_PROJECT` (primaryLang ∈ languages, keys(voice) ⊆ languages, unique languages) · `REF_SEGMENT` (prefix = chapter, unique; also enforced by `Script` superRefine) · `REF_BEAT_SEGMENT` (every plan's segment exists in the primary script; no beats for `sponsor_slot`; `-CLIP` only for clip segments, `-BR` only for `music_breath`) · `REF_BEAT_FACTS` (personIds, factIds, quoteId exist in the FactSheet) · `REF_SLICE_PLAN` (slices cover exactly the narration plans; clip/breath texts empty) · `REF_PICK` (picks' beatId ∈ plans, assetId ∈ frozen) · `REF_CLIP` (ClipResolution.segmentId is a clip segment) · `REF_QUOTE` (speakerId ∈ people, sourceId ∈ sources) · `REF_TIMELINE_ASSETS` (= `ASSET_MISSING`) · `REF_OVERRIDE_TARGET` (warn: target missing → rejected at apply) · `LANG_PARITY` (`validateLangParity`). The engine runs `checkRefs` at every stage boundary and on every `writeDoc`; errors fail the stage or reject the write with the issue list.

*Migrations.* `registerMigration(kind, from, fn)` adds one step `from → from+1`. `readJson` determines the kind from `DOC_REGISTRY`, runs `migrateDoc`, then parses; it never writes back. A migrated document's `docHash` is computed on the migrated value, so a pure version bump does not make downstream stages stale unless the content changed. `formatVersion` bumps are handled by `ProjectStore.open` (a whole-project migration that writes a backup to `.history/format-<n>/`).

*`ProjectStore` writes.* Atomic (`tmp` + `rename`), `stableStringify(indent: compact ? 0 : 2)`, docHash skip, ownership check, history (`.history/<rel>/<iso>-<etag8>.json`, last 20) for `userEditable` documents written with `writer:"user"`. Stages capture the etags of user-editable inputs at start and write user-editable outputs with `ifMatch`; a `CONFLICT` fails the stage with the hint "a user edit happened during the job; re-run". The web UI makes documents read-only while a job that writes them is running.

*`loadRuntime`.* `repoRoot` = `DOCMAKER_REPO_ROOT` or the nearest ancestor of `cwd` containing `pnpm-workspace.yaml`; secrets precedence `process.env` > `<home>/.env` > `<repoRoot>/.env.local`; `contact` = `DOCMAKER_CONTACT` ?? `HomeConfig.contact`; `browserExecutable` = `DOCMAKER_BROWSER_EXECUTABLE` ?? `<home>/browser.json`; `userAgentBase = DocumentaryMaker/<version>` plus ` (+<homepage>)` only if the root `package.json` has a `homepage`. `userAgentFor(url)` appends `; contact: <contact>` only for `CONTACT_UA_HOSTS`. Nothing is ever read from git config, the OS user, email or hostname. `loadRuntime` is called per job, so key changes need no restart.

*`chapterCardReadMs(title, enter30)`* `= round(1000·(enter30/30 + max(1.2, chars/20 + 0.8))) − 200`, where `chars` counts the title's characters. The layout uses `max(pauses.chapterGapMs, chapterCardReadMs(title))` as the gap before each chapter (TitleSting chapters: `max(chapterGapMs, 3500)`), so the card always finishes ≤ 6 frames after the narrator resumes.

### 4.19 Package API stubs (P0: copied into each `src/index.ts`; every function throws `not implemented` until its owner lands it)

The stubs are the public API contract between parallel agents. A package may add exports; it may not change these signatures without a `docs/ISSUES.md` entry processed by I.

**`@docmaker/styles`**

```ts
// $SP/design/core-v2/stubs/styles/index.ts
// @docmaker/styles — public API (packages/styles/src/index.ts). Data-only style directories, auto-discovered.
import type { CueType, LintIssue, StyleFont, StylePlugin, StyleSuggestion, TopicType } from "@docmaker/core";

export interface StyleSummary {
  id: string; version: string; names: { en: string; fr: string }; description: { en: string; fr: string };
  category: "commentary" | "essay" | "explainer" | "true-crime"; previewColor: string; bestFor: TopicType[];
  source: "builtin" | "user"; dir: string;
}
export interface StyleRegistry {
  readonly hash: string; // hashJson of sorted (id, dataHash) — participates in the style stage inputs
  get(id: string): StylePlugin; // unknown id → DocmakerError("VALIDATION")
  has(id: string): boolean;
  list(): StyleSummary[]; // sorted by id
}
/** <repoRoot>/packages/styles/builtin — never located through import.meta.resolve. */
export declare function builtinStylesDir(repoRoot: string): string;
/** Reads style.json (StyleData), STYLE.md, GUIDE.md, prompts.json (StylePrompts), optional fonts/font.json; validates. */
export declare function loadStyleDir(dir: string, source: "builtin" | "user"): Promise<StylePlugin>;
/** builtin dirs + <home>/styles/* (user dirs shadow nothing: a duplicate id is a VALIDATION error). */
export declare function discoverStyles(o: { repoRoot: string; userStylesDir: string | null }): Promise<StyleRegistry>;
/** Schema, act shares (Σ = 1 ± 1e-6), macro acts present, fonts ∈ BUILTIN_FONT_FAMILIES ∪ style fonts, zones inside the
 *  frame, captionBand ∩ keepOut = ∅, triggers ⊆ DERIVABLE_TRIGGERS, transition keys valid, weights ≥ 0. */
export declare function validateStyleData(data: unknown, o: { fontFamilies: readonly string[]; styleFonts?: readonly StyleFont[] }): LintIssue[];
/** Deterministic keyword classifier: normWord tokens of the idea × manifest.uses (accent-folded) and bestFor. Free, offline. */
export declare function suggestStyleOffline(idea: string, registry: StyleRegistry): StyleSuggestion;
export declare function classifyTopicOffline(idea: string): TopicType;
/** `docmaker style new <id> --from <base>`: copies the base dir to <home>/styles/<id>, rewrites manifest.id/names. */
export declare function scaffoldStyle(o: { registry: StyleRegistry; fromId: string; newId: string; destDir: string }): Promise<string>;
export type { CueType };
```

**`@docmaker/llm`**

```ts
// $SP/design/core-v2/stubs/llm/index.ts
// @docmaker/llm — public API (packages/llm/src/index.ts). Never writes project files: returns values to the engine.
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type {
  BeatLang, BeatPlan, BeatPlansDoc, BeatSlicesDoc, Budget, ChapterPlan, ChapterScript, CostLine, CostTracker, Device, FactCheck,
  FactCheckItem, FactSheet, Lang, LintIssue, Logger, Outline, Progress, PublishInfo, RegistryDoc, RegistryEntry, Reranker,
  ResearchDossier, RiskFlag, Script, ScriptProfile, SegmentType, StageId, StyleData, StylePlugin, StyleSuggestion, TopicType,
} from "@docmaker/core";

export type LlmStep =
  | "research" | "factsheet" | "style" | "outline" | "chapter" | "revise" | "beats" | "beatslice"
  | "factcheck" | "recheck" | "rerank" | "passage";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export interface SystemBlock { text: string; cache: boolean }
export interface StructuredRequest<S extends z.ZodType> {
  step: LlmStep;
  key: string; // fixture/receipt key: "", "en.CH3", "CH2", …
  schema: S; // WIRE schema
  system: SystemBlock[];
  user: string | Anthropic.Beta.BetaContentBlockParam[]; // images allowed (rerank)
  effort: Effort;
  maxTokens: number;
  stage: StageId;
  lang: Lang | null;
}
export interface ResearchRequest {
  topic: string; langs: Lang[]; minutes: number; asOf: string; maxSearches: number; maxFetches: number;
  system: SystemBlock[]; user: string;
  resumeTurns: unknown[]; // saved research/raw/turn-*.json messages (resume after cancel/crash)
  onTurn: (n: number, message: unknown) => Promise<void>; // engine persists research/raw/turn-<n>.json
}
export interface ResearchResult { dossierMarkdown: string; registry: RegistryEntry[]; searchesUsed: number; fetchesUsed: number; turns: number }
export interface LlmCallCtx { signal: AbortSignal; costs: CostTracker; newRequest: boolean }
export interface LlmClient {
  readonly kind: "anthropic" | "fixture";
  structured<S extends z.ZodType>(req: StructuredRequest<S>, h: LlmCallCtx): Promise<z.infer<S>>;
  research(req: ResearchRequest, h: LlmCallCtx & { progress: Progress }): Promise<ResearchResult>;
}
/** rawDir = <projectDir>/costs/llm (raw responses by fingerprint). Fixture: <repoRoot>/fixtures/<fixtureId>/llm. */
export declare function createLlmClient(cfg: { provider: "anthropic" | "fixture"; fixtureDir: string | null; rawDir: string; refusalFallback: boolean; logger: Logger; apiKey: string | null }): LlmClient;
export declare class FixtureLlm implements LlmClient {
  constructor(fixtureDir: string);
  readonly kind: "fixture";
  structured<S extends z.ZodType>(req: StructuredRequest<S>, h: LlmCallCtx): Promise<z.infer<S>>;
  research(req: ResearchRequest, h: LlmCallCtx & { progress: Progress }): Promise<ResearchResult>;
}
export interface StepCtx { llm: LlmClient; signal: AbortSignal; costs: CostTracker; logger: Logger; progress: Progress; newRequest: boolean }

// ---- steps (§6.2 call table)
export declare function runResearch(ctx: StepCtx, i: { topic: string; langs: Lang[]; minutes: number; asOf: string; resumeTurns: unknown[]; onTurn: ResearchRequest["onTurn"] }): Promise<ResearchResult>;
export declare function buildFactSheet(ctx: StepCtx, i: { dossier: ResearchDossier; registry: RegistryDoc; asOf: string; topic: string }): Promise<{ factSheet: FactSheet; invalidRefs: string[] }>;
export interface StyleCatalogEntry { id: string; names: { en: string; fr: string }; description: { en: string; fr: string }; bestFor: TopicType[] }
export declare function suggestStyle(ctx: StepCtx, i: { idea: string; styles: StyleCatalogEntry[]; factSummary: string | null; stage: "idea" | "research" }): Promise<StyleSuggestion>;
/** runtimeSec = minutes·60; narrationSec = runtimeSec·narrationShare; chars = narrationSec·cps; words = chars/avgCharsPerWord. */
export declare function planBudget(minutes: number, lang: Lang, profile: ScriptProfile, shapeId: string, voiceCps?: number): Budget;
export declare function writeOutline(ctx: StepCtx, i: { factSheet: FactSheet; style: StylePlugin; budget: Budget; budgets: Partial<Record<Lang, Budget>>; shapeId: string; lang: Lang; riskFlags: RiskFlag[] }): Promise<Outline>;
export declare function validateOutline(o: Outline, style: StyleData): LintIssue[];
export interface SegmentSkeleton { id: string; type: SegmentType; device: Device; quoteId: string | null; factIds: string[]; approxChars: number }
export interface ChapterInput {
  lang: Lang; primaryLang: Lang; outline: Outline; plan: ChapterPlan; factSheet: FactSheet; style: StylePlugin;
  storySoFar: string[]; previousTail: string[]; skeleton: SegmentSkeleton[] | null; // skeleton = primary chapter (secondary langs)
  targetWords: number; riskFlags: RiskFlag[];
}
export declare function writeChapter(ctx: StepCtx, i: ChapterInput): Promise<ChapterScript>;
export declare function reviseChapter(ctx: StepCtx, i: ChapterInput & { chapter: ChapterScript; issues: LintIssue[] }): Promise<ChapterScript>;
export declare function lintScript(i: { lang: Lang; profile: ScriptProfile; outline: Outline; chapters: ChapterScript[]; facts: FactSheet; cps?: number }): LintIssue[];
export declare function applyFrTypography(text: string): string; // « » + U+202F, ;:!? spacing, ’ (displayText only)
export declare function planBeats(ctx: StepCtx, i: { chapter: ChapterScript; factSheet: FactSheet; style: StylePlugin; isHook: boolean; lang: Lang; startOrder: number }): Promise<{ plans: BeatPlan[]; texts: BeatLang[]; issues: LintIssue[]; method: "llm" | "fallback" }>;
/** Secondary language (LLM, validator, fallback) — or the primary language after a text edit (deterministic re-slice, no LLM). */
export declare function sliceBeats(ctx: StepCtx | null, i: { plans: BeatPlan[]; primaryTexts: BeatLang[]; chapter: ChapterScript; lang: Lang; factSheet: FactSheet; mode: "llm" | "deterministic" }): Promise<{ texts: BeatLang[]; issues: LintIssue[]; method: "llm" | "fallback" }>;
/** Exact reconstruction, durations, AI+person rewrite, motion data refs (quote/source/figure) vs FactSheet → downgrades, cue anchors. */
export declare function validateBeats(i: { plans: BeatPlan[]; texts: BeatLang[]; chapter: ChapterScript; factSheet: FactSheet; style: StyleData; lang: Lang; primary: boolean }): { issues: LintIssue[]; plans: BeatPlan[]; texts: BeatLang[] };
export declare function splitBeatsFallback(segmentText: string, charShares: number[]): string[];
/** Synthetic beats added in code: one -CLIP beat per clip segment, one -BR beat per music_breath segment (no text). */
export declare function syntheticBeats(script: Script, langs: Lang[], startOrder: number): { plans: BeatPlan[]; texts: BeatLang[] };
export declare function computePlanKey(p: Pick<BeatPlan, "visualKind" | "visualQuery" | "personIds" | "motionTemplate" | "quoteId">): string;
export declare function factCheck(ctx: StepCtx, i: {
  script: Script; slices: BeatSlicesDoc; plans: BeatPlansDoc; factSheet: FactSheet; publish: PublishInfo | null;
  previous: FactCheck | null; riskFlags: RiskFlag[]; scriptHash: string; slicesHash: string;
}): Promise<FactCheck>;
export declare function deterministicFactChecks(i: { script: Script; slices: BeatSlicesDoc; plans: BeatPlansDoc; factSheet: FactSheet; publish: PublishInfo | null; riskFlags: RiskFlag[] }): FactCheckItem[];
export declare function factCheckId(where: string, sentence: string, claimKind: string, origin: "llm" | "deterministic"): string;
/** Out-of-sync secondary segment (primaryHash mismatch): cheap, cost-gated transcreation of ONE segment. */
export declare function transcreateSegment(ctx: StepCtx, i: { primary: Script["chapters"][number]["segments"][number]; current: Script["chapters"][number]["segments"][number]; lang: Lang; style: StylePlugin; factSheet: FactSheet }): Promise<{ displayText: string; subtitleTranslation: string }>;
export declare function recheck(ctx: StepCtx, i: { factSheet: FactSheet; claimIds: string[]; asOf: string }): Promise<{ factSheet: FactSheet; changed: string[] }>;
export declare function makeReranker(ctx: Omit<StepCtx, "progress">): Reranker;
export declare function pickPassage(ctx: StepCtx, i: { verbatim: string; windows: { index: number; text: string; startMs: number; endMs: number }[] }): Promise<{ bestIndex: number; confidence: number }>;
export declare function estimateStepCost(step: LlmStep, i: { inputChars: number; outputChars: number; cachedChars: number; webSearches?: number; lang: Lang | null }): CostLine[];
export declare const ACCUSATORY: Readonly<Record<Lang, RegExp>>;
export declare const ATTRIBUTION: Readonly<Record<Lang, RegExp>>;
export declare const BANNED_OPENERS: Readonly<Record<Lang, RegExp>>;
```

**`@docmaker/assets`**

```ts
// $SP/design/core-v2/stubs/assets/index.ts
// @docmaker/assets — public API (packages/assets/src/index.ts). Owns all network I/O (HttpClient), licences, frozen cache.
import type {
  AssetKind, AssetPick, AssetProvider, AssetProviderId, AssetQuery, BeatPlan, BeatPlansDoc, Candidate, CandidateRecord,
  CandidatesDoc, CandidateScore, ClipResolution, ClipWordsDoc, CostTracker, CueType, EntitiesDoc, FactSheet, FrozenAsset,
  FrozenDoc, HttpClient, Lang, Ledger, LicenseInfo, LicensePolicy, LintIssue, LocalIndexDoc, Logger, MediaRole, MusicDoc,
  PicksDoc, Progress, Project, Reranker, RuntimeConfig, Script, Secrets, SfxEntry, StyleData, UploadDeclaration, UsageDoc,
  UserPicksDoc, VerificationItem, VoiceTrack, WordTiming,
} from "@docmaker/core";

export interface AssetsCtx { config: RuntimeConfig; secrets: Secrets; logger: Logger; http: HttpClient; signal: AbortSignal; progress: Progress; costs: CostTracker; cache: FrozenCache }

// ---- http (offline → throws OFFLINE before any socket; SSRF guard; per-host UA; TTL cache; size caps)
export declare function createHttpClient(o: { config: RuntimeConfig; logger: Logger }): HttpClient;

// ---- providers & licences
export declare function allProviders(): AssetProvider[]; // the 12 providers of §7.2, in default priority order
export declare function providerById(id: AssetProviderId): AssetProvider;
export interface PolicyVerdict { allowed: boolean; reasons: string[]; flags: string[] }
export declare class LicensePolicyEngine {
  constructor(policy: LicensePolicy, ctx: { monetized: boolean; fairUseAcknowledged: boolean });
  evaluate(license: LicenseInfo, beat: { personIds: string[]; cueTypes: CueType[] } | null): PolicyVerdict;
}
/** Server-side re-check of ANY pick (auto, user PUT, replaceSource override, upload): licence policy, AI-GENERATED + people,
 *  stock look-alikes on person/negative beats, minors/private persons without person-ack. Errors = POLICY_DENIED. */
export declare function validatePick(i: {
  pick: AssetPick; plan: BeatPlan | null; asset: FrozenAsset; policy: LicensePolicy; editorial: Project["editorial"];
  facts: FactSheet; personAcks: readonly string[];
}): LintIssue[];
export declare function buildAiDenylist(facts: FactSheet, entities: EntitiesDoc): Set<string>; // normWord tokens ≥ 3 chars of names, aliases, speakers
export declare function checkFalPrompt(prompt: string, denylist: ReadonlySet<string>): { ok: boolean; reason: string | null };

// ---- frozen cache & conform
export declare class FrozenCache {
  constructor(o: { config: RuntimeConfig; logger: Logger });
  put(file: string, ext: string): Promise<{ sha256: string; cacheRel: string; bytes: number }>;
  has(sha256: string): Promise<boolean>;
  linkIntoProject(sha256: string, ext: string, projectDir: string): Promise<string>; // → media/<id>.<ext>
  gc(o: { referenced: ReadonlySet<string>; capBytes: number }): Promise<{ freedBytes: number; removed: number }>;
}
export interface ConformResult {
  file: string; ext: "jpg" | "png" | "mp4" | "wav"; width: number | null; height: number | null; durationMs: number | null; fps: number | null;
  hasAudio: boolean; lufs: number | null; recipe: string; sourceInMs: number | null; sourceOutMs: number | null;
  handleHeadMs: number; handleTailMs: number; analysis: FrozenAsset["analysis"];
}
export declare function conformImage(src: string, outDir: string, ctx: AssetsCtx): Promise<ConformResult>;
export declare function conformVideo(src: string, outDir: string, o: { fps: number; inMs: number | null; outMs: number | null; handleMs: number }, ctx: AssetsCtx): Promise<ConformResult>;
export declare function conformClip(src: string, outDir: string, o: { fps: number; passageInMs: number; passageOutMs: number; handleMs: number }, ctx: AssetsCtx): Promise<ConformResult & { passageInMs: number; passageOutMs: number }>;
export declare function conformAudio(src: string, outDir: string, o: { targetLufs: number }, ctx: AssetsCtx): Promise<ConformResult>;
/** conform → cache.put → link → FrozenAsset (used by the stage, the music step in the engine, uploads, manual clips). */
export declare function freezeFile(i: { file: string; kind: AssetKind; role: MediaRole; candidate: Candidate | null; declaration: UploadDeclaration | null; conform: ConformResult; projectDir: string }, ctx: AssetsCtx): Promise<FrozenAsset>;

// ---- planning, ranking, picking
export declare function planQueries(i: { plan: BeatPlan; facts: FactSheet; entities: EntitiesDoc; style: StyleData; personAcks: readonly string[] }): AssetQuery[];
export declare function shotsNeeded(plan: BeatPlan, style: StyleData): number; // clamp(round(est/(asl·mul)),1,4); photo_burst → count; montage → 4
export declare function metadataScore(c: Candidate, plan: BeatPlan, all: readonly Candidate[]): number;
export declare function rankCandidates(i: { plan: BeatPlan; records: CandidateRecord[]; reranked: Map<number, Partial<CandidateScore>> | null }): { record: CandidateRecord; score: CandidateScore }[];
export declare function pickAssets(i: { plan: BeatPlan; ranked: { record: CandidateRecord; score: CandidateScore }[]; shots: number; recentUse: ReadonlyMap<string, number> }): { candidate: Candidate; score: CandidateScore; slot: number }[];
export declare function needsVisionRerank(plan: BeatPlan, top: readonly CandidateScore[], mode: "off" | "selective" | "all"): boolean;

// ---- the assets stage (minus SFX pack and music, which the engine prepares through @docmaker/audio)
export interface AssetsStageInput {
  project: Project; plans: BeatPlansDoc; facts: FactSheet; entities: EntitiesDoc; style: StyleData; primaryScript: Script;
  userPicks: UserPicksDoc; previous: { picks: PicksDoc | null; frozen: FrozenDoc | null; ledger: Ledger | null };
  projectDir: string; reranker: Reranker | null; personAcks: readonly string[];
}
export interface AssetsStageOutput { picks: PicksDoc; frozen: FrozenDoc; ledger: Ledger; candidates: CandidatesDoc[]; clipWords: ClipWordsDoc[] }
export declare function resolveAssets(i: AssetsStageInput, ctx: AssetsCtx): Promise<AssetsStageOutput>;

// ---- interactive (web scene board / CLI)
export declare function liveSearch(i: { query: AssetQuery; providers: AssetProviderId[]; allowPaid: boolean; policy: LicensePolicy; editorial: Project["editorial"]; projectDir: string }, ctx: AssetsCtx): Promise<CandidateRecord[]>; // records are cached server-side for freeze
/** The server re-derives the Candidate from assets/candidates/<beatId>.json or the live-search cache; client licence data is ignored. */
export declare function freezeCandidate(i: { projectDir: string; beatId: string; provider: AssetProviderId; providerAssetId: string }, ctx: AssetsCtx): Promise<FrozenAsset>;
export declare function importUpload(i: { file: string; declaration: UploadDeclaration; projectDir: string }, ctx: AssetsCtx): Promise<FrozenAsset>;
export declare function importLocalDir(i: { dir: string; declaration: UploadDeclaration; tags: string[]; projectDir: string; previous: LocalIndexDoc | null }, ctx: AssetsCtx): Promise<LocalIndexDoc>;
export declare function resolveManualClip(i: { projectDir: string; segmentId: string; quoteId: string; url: string | null; file: string | null; startMs: number; endMs: number; channel: string; title: string; fps: number }, ctx: AssetsCtx): Promise<{ clip: ClipResolution; frozen: FrozenAsset; words: ClipWordsDoc | null }>;

// ---- research helpers (network lives here)
export declare function resolveEntity(name: string, lang: Lang, ctx: { http: HttpClient; signal: AbortSignal }): Promise<{ qid: string; label: string; aliases: string[] } | null>;
/** Offline/fixture → every quote stays "unchecked" with items {check:"quote-verbatim", ok:false, detail:"skipped-offline"}. */
export declare function verifyQuotes(fs: FactSheet, ctx: { http: HttpClient | null; offline: boolean; signal: AbortSignal }): Promise<{ factSheet: FactSheet; items: VerificationItem[] }>;

// ---- credits
export declare function buildCredits(i: { ledger: Ledger; usage: UsageDoc; lang: Lang; voice: VoiceTrack | null; music: MusicDoc; sfx: readonly SfxEntry[] }): string;

// ---- procedural provider (offline, deterministic) — every recipe is executed by a unit test (ffmpeg 6.1)
export declare const PROCEDURAL_RECIPES: readonly { id: string; kind: "image" | "video"; args: (o: { seed: number; palette: string[]; fps: number; seconds: number }) => string[] }[];
export declare function proceduralAsset(i: { recipe: string; seed: number; palette: string[]; fps: number; seconds: number; outDir: string }, ctx: AssetsCtx): Promise<string>;

// ---- YouTube (local yt-dlp)
export declare function ytSearch(q: string, ctx: AssetsCtx): Promise<{ id: string; title: string; durationSec: number; channel: string; channelVerified: boolean; views: number }[]>;
export declare function ytFetchTranscript(videoId: string, lang: string, ctx: AssetsCtx): Promise<{ words: WordTiming[]; kind: "manual" | "asr-orig" | "asr" | "translated" | "local-asr" | "none"; lang: string | null }>;
export declare function ytDownload(videoId: string, o: { sectionMs: [number, number] | null; outDir: string }, ctx: AssetsCtx): Promise<string>;
export declare function parseJson3(json: unknown): WordTiming[];
export declare function findPassage(quote: string, words: readonly WordTiming[], o: { maxClipMs: number }): { score: number; startMs: number; endMs: number; matchedText: string } | null;
export declare function mapYtError(stderr: string): "YT_RATE_LIMIT" | "YT_BOT_CHECK" | "YT_FORBIDDEN" | "YT_UNAVAILABLE" | null;
export declare function ytProbe(ctx: AssetsCtx): Promise<"ok" | "bot-check" | "403" | "missing" | "offline">; // doctor
```

**`@docmaker/voice`**

```ts
// $SP/design/core-v2/stubs/voice/index.ts
// @docmaker/voice — public API (packages/voice/src/index.ts). Writes WAVs only under the projectDir it is given.
import type {
  Aligner, CostLine, CostTracker, Lang, LexiconEntry, LicenseInfo, Logger, Progress, RuntimeConfig, Script, Secrets,
  TtsProvider, VoiceProviderId, VoiceSettings, VoiceTrack, WordTiming,
} from "@docmaker/core";

export interface VoiceCtx { config: RuntimeConfig; secrets: Secrets; logger: Logger; signal: AbortSignal; progress: Progress; costs: CostTracker }

// ---- text (§8.2) — ONLY the engine calls buildTtsText (script stage fills ttsText unless ttsTextEdited)
export interface TtsTextResult { ttsText: string; ttsWords: string[]; displayToTts: [number, number][] }
export declare function buildTtsText(spoken: string, lang: Lang, opts: { lexicon: LexiconEntry[]; expandNumbers: boolean; stripTags: boolean }): TtsTextResult;
export declare function numberToWords(n: number, lang: Lang, kind: "cardinal" | "year" | "ordinal" | "decimal"): string;

// ---- providers & aligners
export declare function createTtsProvider(id: VoiceProviderId, cfg: { config: RuntimeConfig; secrets: Secrets; logger: Logger }): TtsProvider;
export declare function createAligner(id: Aligner["id"], cfg: { config: RuntimeConfig; secrets: Secrets; logger: Logger }): Aligner;
export declare function charAlignmentToWords(text: string, chars: string[], startsSec: number[], endsSec: number[]): WordTiming[];
/** Needleman–Wunsch (match +2, mismatch −1, gap −1, normWord) + interpolation; returns exactly scriptWords.length timings. */
export declare function alignScriptToTranscript(scriptWords: string[], asr: readonly WordTiming[]): (WordTiming & { matched: boolean })[];

// ---- takes
export interface SynthesizeTrackInput {
  lang: Lang; script: Script; voice: VoiceSettings; kind: "scratch" | "final";
  clipNarrated: string[]; // clip segment ids narrated as fallback (spokenText(seg, "clip-narrated"))
  segments: string[] | null; // null = all; else re-synthesise only these (others reused from `previous`)
  previous: VoiceTrack | null; projectDir: string; styleCps: number; retryBad: boolean;
}
/** Segment cache (§8.4), stitching order (sequential per chapter), post chain, aligner fallback, deterministic takeId. */
export declare function synthesizeTrack(i: SynthesizeTrackInput, ctx: VoiceCtx): Promise<VoiceTrack>;
export declare function estimateTtsCost(i: { script: Script; voice: VoiceSettings; segments: string[] | null; previous: VoiceTrack | null }): CostLine[];
export interface ImportRecordingInput {
  lang: Lang; script: Script; files: string[]; mode: "global" | "per-segment"; // per-segment: files named <segmentId>.* (or uploaded per segment)
  aligner: "faster-whisper" | "whisper-cpp" | "auto"; previous: VoiceTrack | null; projectDir: string;
  pickup: { provider: VoiceProviderId; voice: VoiceSettings } | null; // fill missing segments ("PICKUP TTS")
}
export declare function importRecording(i: ImportRecordingInput, ctx: VoiceCtx): Promise<VoiceTrack>;
export declare function voPostChain(input: string, output: string, o: { kind: "tts" | "recording"; rawFormat: { sampleRate: number; pcm: boolean } | null }, ctx: VoiceCtx): Promise<{ leadTrimMs: number; durationMs: number }>;
export declare function calibrateVoice(i: { lang: Lang; voice: VoiceSettings; projectDir: string }, ctx: VoiceCtx): Promise<{ charsPerSec: number }>;
export declare function teleprompterHtml(script: Script, o: { cps: number; mirror: boolean; lang: Lang }): string;
export declare function voiceLicense(provider: VoiceProviderId, voiceId: string, tier: string | null): LicenseInfo;
export declare function voiceSettingsHash(v: VoiceSettings): string;
export declare function takeIdFor(kind: "scratch" | "final", provider: VoiceProviderId, voiceId: string, settingsHash: string, segmentCacheKeys: string[]): string;
/** True when the active take's segment ttsTextHash ≠ hashJson(current ttsText) (computed, never stored). */
export declare function editedAfterTake(script: Script, take: VoiceTrack): string[];

// ---- models (setup)
export declare const MODEL_MANIFEST: readonly { id: string; url: string; approxBytes: number; sha256: string | null; extractTo: string }[];
export declare function ensureModel(id: string, ctx: VoiceCtx): Promise<string>; // Range resume + size verification
```

**`@docmaker/audio`**

```ts
// $SP/design/core-v2/stubs/audio/index.ts
// @docmaker/audio — public API (packages/audio/src/index.ts). WAV I/O and loudness come from @docmaker/core/node.
import type { LicenseInfo, LoudnessDoc, Logger, MusicMood, Progress, ProgramLayout, RuntimeConfig, SfxCategory, SfxEntry, SfxManifest, Timeline } from "@docmaker/core";

export interface AudioCtx { config: RuntimeConfig; logger: Logger; signal: AbortSignal; progress: Progress }

export interface SfxRecipe {
  category: SfxCategory; variants: { variant: number; durationSec: number; seed: number }[];
  syncPoint: "peak" | "onset" | "end"; loopable: boolean;
  args(o: { durationSec: number; seed: number; sampleRate: 48000 }): string[]; // ffmpeg lavfi argument builder (port of make_sfx.sh)
}
export declare const SFX_RECIPES: readonly SfxRecipe[];
/** Generates <home>/sfx/<pack>/<version>/ once (machine lock), analyses peaks, writes manifest.json. */
export declare function ensureSfxPack(pack: "procedural" | "remotion-sfx-cc0" | "hyperframes-pixabay" | "user", ctx: AudioCtx): Promise<SfxManifest>;
export declare function loadSfxEntries(packs: readonly string[], ctx: AudioCtx): Promise<SfxEntry[]>; // merged, sorted by id

export interface MusicGenOptions { mood: MusicMood; bpm: number; bars: number; seed: number; key: "A minor" | "D minor" | "E minor" | "C major"; energy: "low" | "mid" | "high" }
/** Deterministic Node synth → <home>/music/procedural/<hash>.wav at -18 LUFS with an exact beat grid. */
export declare function generateMusic(o: MusicGenOptions, ctx: AudioCtx): Promise<{ wavPath: string; beatsMs: number[]; downbeatsMs: number[]; durationMs: number; bpm: number }>;
export declare function scanMusicLibrary(dir: string, ctx: AudioCtx): Promise<{ file: string; title: string; moods: MusicMood[]; license: LicenseInfo; bpm: number | null; beatsMs: number[]; downbeatsMs: number[]; durationMs: number }[]>;

/** Places segment WAVs at frameToSample48k(segment.from) (+ REVEAL insertions), digital silence elsewhere, then bakes −16 LUFS. */
export declare function assembleVoProgram(i: { layout: Omit<ProgramLayout, "voProgram">; projectDir: string; outRel: string }, ctx: AudioCtx): Promise<{ sha256: string; bakedGainDb: number; durationMs: number }>;
/** Node mixer driven by core computeGainTables (preview parity) → mix.wav (s24 stereo 48 kHz) + 4 stems + loudness. */
export declare function mixTimeline(t: Timeline, i: { projectDir: string; outMixRel: string; stemRels: Record<"vo" | "music" | "sfx" | "clip", string>; targetLufs: number; truePeakTarget: number }, ctx: AudioCtx): Promise<Omit<LoudnessDoc, "schemaVersion" | "lang">>;
export declare function densityReport(t: Timeline): { sfxPerMin: number[]; impactsPerMin: number[]; silentCutShare: number; chapterRmsDb: Record<string, number> };
```

**`@docmaker/director`**

```ts
// $SP/design/core-v2/stubs/director/index.ts
// @docmaker/director — public API (packages/director/src/index.ts). PURE: no I/O, no Date, no Math.random.
import type {
  AnchorIndex, BeatLang, BeatPlan, CaptionDNA, ChapterId, ClipResolution, Fps, FactCheck, FactSheet, FrozenAsset, Lang, LayoutWord,
  LintIssue, MusicTrack, Outline, OverridesDoc, PicksDoc, ProgramLayout, Project, RiskFlag, Script, SfxEntry, StyleData,
  StyleRenderTokens, Timeline, VoiceProviderId, VoiceTrack, WordTiming,
} from "@docmaker/core";

export declare const DIRECTOR_VERSION: string; // "2.0.0"; part of the direct inputs hash

export interface LayoutInput {
  lang: Lang; fps: Fps; script: Script; // chapters ALREADY filtered by onlyChapters (engine)
  plans: BeatPlan[]; texts: BeatLang[]; // texts for `lang`
  take: VoiceTrack; // active take or the scratch take
  clips: ClipResolution[]; frozen: Record<string, FrozenAsset>; pauses: Pauses2; clipFallback: "narrated" | "card";
  outline: Outline; style: Pick<StyleData, "scriptProfile" | "budgets">; storyShapeId: string;
  scriptHash: string; plansHash: string; slicesHash: string; onlyChapters: ChapterId[] | null;
}
type Pauses2 = StyleData["pauses"];
/** The audio clock (§9.2). The engine then runs audio.assembleVoProgram and fills voProgram. */
export declare function layoutProgram(i: LayoutInput): Omit<ProgramLayout, "voProgram">;

export interface DirectorInput {
  project: Pick<Project, "slug" | "seed" | "captions" | "captionsVariant" | "video" | "themeOverride"> & Partial<Pick<Project, "assets">>; // assets.maxClipSeconds → CLIP_SHARE
  outline?: Outline | null; // story shape, chapter plan, ad breaks; null → style.scriptProfile by act names
  lang: Lang;
  style: StyleData;
  renderTokens: StyleRenderTokens; // tokens merged with themeOverride, captionDNA variant resolved (engine builds it)
  layout: ProgramLayout;
  layoutHash: string;
  script: Script;
  plans: BeatPlan[]; texts: BeatLang[]; // texts for `lang`
  facts: FactSheet;
  picks: PicksDoc;
  frozen: Record<string, FrozenAsset>;
  clipWords: Record<string, WordTiming[]>; // segmentId → transcript words (ms, relative to the conformed clip file)
  sfx: SfxEntry[]; // merged manifests of enabled packs
  music: MusicTrack[];
  voiceProvider: VoiceProviderId;
  takeKind: "scratch" | "final";
  pickupSegments: readonly string[]; // recording takes: segments synthesised by the pickup provider
  personAcks: readonly string[]; // personIds acknowledged via gate person-ack
  riskFlags: readonly RiskFlag[]; // from style/suggestion.json (safe-messaging end card, minors)
  factCheck: FactCheck | null; // markers for items not "rewritten"
  overrides: OverridesDoc | null;
  /** Licence/AI/person re-check for replaceSource overrides (engine passes assets.validatePick bound to the project). */
  validateAsset: (assetId: string, beatId: string | null) => LintIssue[];
}
export interface DirectorStats {
  durationSec: number; shots: number; aslSec: number; nonCutShare: number; primaryShare: number; transitionsByKind: Record<string, number>;
  punchPerMin: number; sfxPerMin: number; impactsPerMin: number; overlaysByKind: Record<string, number>; silences: number; jlCuts: number;
  maxStaticHoldSec: number; maxNoChangeSec: number; eventsPer10s: number; captionGroups: number; keywordCaptions: number;
  salienceDrops: number; cleanStretches: number; cardShare: number; maxUpscale: number;
}
export interface DirectorOutput {
  timeline: Timeline; lint: LintIssue[]; stats: DirectorStats;
  usage: { assetId: string; itemIds: string[] }[]; // → timeline/<lang>.usage.json (the engine writes it)
  rejectedOverrides: { id: string; reason: string }[];
}
export declare function direct(i: DirectorInput): DirectorOutput;
export declare function groupCaptions(words: readonly LayoutWord[], g: CaptionDNA["grouping"], fps: number): { words: LayoutWord[]; from: number; dur: number }[];
export declare function lintTimeline(t: Timeline, style: StyleData, ctx: { layout: ProgramLayout; layoutHash: string; frozen: Record<string, FrozenAsset> }): LintIssue[];
export declare function applyOverrides(t: Timeline, o: OverridesDoc, ix: AnchorIndex, ctx: { style: StyleData; validateAsset: DirectorInput["validateAsset"]; plans: BeatPlan[] }): { timeline: Timeline; rejected: { id: string; reason: string }[] };
/** Lint severities (§4.13 table): exported so the web app can render rule help. */
export declare const LINT_RULES: Readonly<Record<string, { level: "error" | "warn"; help: string }>>;
```

**`@docmaker/remotion`** and **`@docmaker/remotion/compute`**

```ts
// $SP/design/core-v2/stubs/remotion/index.ts
// @docmaker/remotion "." — public API (packages/remotion/src/index.ts). Browser-safe: no node:* (lint-enforced).
import type React from "react";
import type { Timeline } from "@docmaker/core";

export interface DocProps {
  timeline: Timeline | null; // Player: inline
  timelineUrl: string | null; // render worker: served by the asset server → inputProps stay tiny and identical across chunks
  assetBaseUrl: string; // render: "http://127.0.0.1:<port>/p"; Player: "/api/projects/<slug>/media"
  mode: "render" | "preview";
  layers: { picture: boolean; graphics: boolean; captions: boolean; hud: boolean; covers: boolean; audio: boolean };
  itemId: string | null;
  scratchBanner: boolean; // preview: "SCRATCH VO" banner when the timeline was built from a scratch take
}
export declare const Documentary: React.FC<DocProps>;
export declare const COMPOSITION_IDS: {
  readonly doc: "Documentary"; readonly overlay: "DocumentaryOverlay"; readonly item: "OverlayItem";
  readonly still: "GeneratedStill"; readonly gl: "GlProbe"; readonly fonts: "FontSpecimen"; readonly specimen: "StyleSpecimen";
};
/** Must equal core BUILTIN_FONTS (test). */
export declare const FONT_REGISTRY: readonly { family: string; weights: readonly number[]; italic: boolean }[];
export declare function useTimeline(p: DocProps): Timeline | null;
/** Components implemented so far (M1/M2); others render FallbackCard. */
export declare const IMPLEMENTED_COMPONENTS: ReadonlySet<string>;
```

```ts
// $SP/design/core-v2/stubs/remotion/compute.ts
// @docmaker/remotion/compute — PURE, no React, no node:* (used by calculateMetadata, the Player, render chunk planning, tests).
import type { CaptionGroup, FxCue, OverlayItem, Timeline, VisualClip } from "@docmaker/core";

export interface SeriesSeq { type: "seq"; clip: VisualClip; durationInFrames: number; headHandle: number; tailHandle: number; trimBefore: number }
export interface SeriesTrans { type: "trans"; clipId: string; presentation: "dissolve" | "blurDissolve" | "push" | "wipe"; durationInFrames: number; direction: "left" | "right" | "up" | "down" }
export interface ComputedChapter { id: string; from: number; dur: number; series: (SeriesSeq | SeriesTrans)[] }
export interface CoverWindow { id: string; clipId: string; cut: number; from: number; dur: number; presentation: string; color: string; peak: number; direction: string }
export interface VelocityEdge { preset: string; direction: string; frames: number; flash: number } // exit on A / entry on B
export interface ComputedTimeline {
  fps: number; width: number; height: number; durationInFrames: number;
  chapters: ComputedChapter[];
  covers: CoverWindow[];
  exits: Record<string, VelocityEdge>; // by outgoing clip id
  entries: Record<string, VelocityEdge>; // by incoming clip id
  cutFlashes: { from: number; dur: number; peak: number; color: string }[];
  pulses: { from: number; dur: number; amt: number }[];
  overlays: { picture: OverlayItem[]; graphics: OverlayItem[]; hud: OverlayItem[] }; // sorted by (z, from, id)
  captions: CaptionGroup[]; // burn === true only
  fx: FxCue[]; // + derived fx from covers (glitch → glitch+rgb)
  warnings: string[];
}
export declare function computeTimeline(t: Timeline): ComputedTimeline;
/** Chapter-aligned chunks; chapters longer than chunkFrames are split evenly. */
export declare function planChunks(ct: ComputedTimeline, chunkFrames: number): { index: number; from: number; to: number }[];
/** sha256 (core pure-JS) of {ctx, fps, size, grade, render tokens, items intersecting [from−premount, to+premount] with frames
 *  NORMALISED to chunk-relative (f − from), their asset ids}. Lengthening CH1 does not invalidate unchanged later chunks. */
export declare function sliceHash(t: Timeline, from: number, to: number, ctx: { codeHash: string; preset: string; premount: number }): string;
```

**`@docmaker/render`**

```ts
// $SP/design/core-v2/stubs/render/index.ts
// @docmaker/render — public API (packages/render/src/index.ts). Node only; never imported by apps/web.
import type {
  GeneratedStillsRequest, GlProbe, Logger, LutParams, OverlayRenderRequest, RenderClient, RenderHandlers, RenderRequest, RenderResult,
  RuntimeConfig, StillsRequest,
} from "@docmaker/core";

export interface RenderServiceOptions { config: RuntimeConfig; logger: Logger; enableBundleCache?: boolean /* tests: false */ }
export declare class RenderService {
  constructor(o: RenderServiceOptions);
  /** codeHash = sha256(sorted path+sha of packages/remotion/src/**, packages/core/src/** + pinned remotion/@fontsource versions). */
  ensureBundle(signal: AbortSignal): Promise<{ serveUrl: string; codeHash: string }>;
  render(req: RenderRequest, h: RenderHandlers): Promise<RenderResult>;
  renderStills(req: StillsRequest, h: RenderHandlers): Promise<string[]>;
  renderOverlays(req: OverlayRenderRequest, h: RenderHandlers): Promise<{ itemId: string; file: string }[]>;
  renderGeneratedStills(req: GeneratedStillsRequest, h: RenderHandlers): Promise<{ clipId: string; file: string }[]>;
  probeGl(force?: boolean): Promise<GlProbe>;
  close(): Promise<void>;
}
/** Same semantics as RenderService; used by the CLI, the job worker and tests. */
export declare class InProcessRenderClient implements RenderClient {
  constructor(o: RenderServiceOptions);
  render(req: RenderRequest, h: RenderHandlers): Promise<RenderResult>;
  renderStills(req: StillsRequest, h: RenderHandlers): Promise<string[]>;
  renderOverlays(req: OverlayRenderRequest, h: RenderHandlers): Promise<{ itemId: string; file: string }[]>;
  renderGeneratedStills(req: GeneratedStillsRequest, h: RenderHandlers): Promise<{ clipId: string; file: string }[]>;
  probeGl(force?: boolean): Promise<GlProbe>;
  close(): Promise<void>;
}
/** Read-only CORS + Range static server bound to 127.0.0.1:<random>; allowlisted path prefixes; `?v=` query ignored. */
export declare function createAssetServer(o: { root: string; allow: readonly RegExp[]; mounts?: Record<string, string> }): Promise<{ url: string; close(): Promise<void> }>;
export declare function computeCodeHash(repoRoot: string): Promise<string>;
/** <home>/browser.json → executable; else copy/download Chrome Headless Shell (only when download=true). */
export declare function ensureBrowserExecutable(config: RuntimeConfig, o: { download: boolean; signal: AbortSignal }): Promise<string>;
/** 33³ .cube from LutParams (HyperFrames luts spec) for ffmpeg lut3d in master post. */
export declare function generateLutCube(p: LutParams, outPath: string): Promise<void>;
/** Post-AAC true-peak gate: re-mux with volume=(gate − TP − 0.3) dB, ≤ 2 attempts. */
export declare function loudnessGate(mp4: string, o: { gateDbtp: number; targetLufs: number; config: RuntimeConfig; signal: AbortSignal }): Promise<{ integratedLufs: number; truePeakDbtp: number; attempts: number; ok: boolean }>;
```

**`@docmaker/export`**

```ts
// $SP/design/core-v2/stubs/export/index.ts
// @docmaker/export — public API (packages/export/src/index.ts).
import type {
  ExportFormat, ExportTimeline, FactCheck, FactSheet, Lang, Ledger, Logger, PublishInfo, RuntimeConfig, Timeline, UsageDoc, VoiceTrack,
} from "@docmaker/core";

export interface ConformedMedia { assetId: string | null; localPath: string; name: string; kind: "video" | "image" | "audio"; width: number | null; height: number | null; durationFrames: number | null; hasVideo: boolean; hasAudio: boolean; audioChannels: number | null; alpha: boolean }
export type ConformMap = Record<string, ConformedMedia>; // key: assetId | "gen:<clipId>" | "ovl:<itemId>" | "stem:<name>" | "vo:<segmentId>"
export interface ExportCtx { config: RuntimeConfig; logger: Logger; signal: AbortSignal }

/** Copies/hardlinks + converts media into export/<lang>/media/ (stills cover-cropped to 1920×1080 from VisualSource crop/focal). */
export declare function conformForNle(t: Timeline, i: { projectDir: string; exportDir: string; generatedStills: Record<string, string>; overlays: Record<string, string> | null; stems: Record<string, string> }, ctx: ExportCtx): Promise<ConformMap>;
/** Reads ONLY the Timeline (+ the conform map) — never picks.json. */
export declare function toExportTimeline(t: Timeline, ctx: { exportDir: string; exportRoot: string | null; conformed: ConformMap }): ExportTimeline;
export declare function writeFcpxml(et: ExportTimeline, o: { version: "1.10" | "1.11" | "1.13" }): string;
export declare function writeXmeml(et: ExportTimeline, o: { flavour: "premiere" | "resolve" }): string;
export declare function writeOtio(et: ExportTimeline, o: { premiereMetadata: boolean }): string;
export declare function writeMarkersEdl(et: ExportTimeline): string;
export declare function writeSrt(t: Timeline): string; // non-burned "srt"/"clip"/"translation" groups only (never "keywords")
export declare function writePublishKit(i: { t: Timeline; publish: PublishInfo | null; credits: string; lang: Lang }): string; // publish.<lang>.md
export declare function writeEditorialReport(i: { t: Timeline; facts: FactSheet; factCheck: FactCheck; ledger: Ledger; usage: UsageDoc; voice: VoiceTrack | null; lang: Lang }): string;
export declare function exportReadme(i: { t: Timeline; formats: ExportFormat[]; exportRoot: string | null; asOf: string; hasReference: boolean; lang: Lang }): string;
export declare function writeExportBundle(i: {
  t: Timeline; projectDir: string; exportDir: string; formats: ExportFormat[]; exportRoot: string | null; fcpxmlVersion: "1.10" | "1.11" | "1.13";
  conformed: ConformMap; referenceMp4: string | null; credits: string; publishKit: string | null; editorialReport: string | null; readme: string;
}, ctx: ExportCtx): Promise<{ dir: string; files: string[] }>;
```

**`@docmaker/engine`**

```ts
// $SP/design/core-v2/stubs/engine/index.ts
// @docmaker/engine — public API (packages/engine/src/index.ts). Never imports @docmaker/render (RenderClient by DI).
import type { z } from "zod";
import type {
  Approval, AssetProviderId, AssetQuery, CandidateRecord, CostEstimate, CostTracker, FrozenAsset, GateId, HomeConfig, JobEvent,
  JobEventInput, JobRecord, JobRequest, Lang, LintIssue, Logger, NewProjectInput, PipelineEstimate, Progress, Project, ProjectState,
  RenderClient, RenderPresetId, RuntimeConfig, Secrets, StageId, StageState, StylePlugin, StyleSuggestion, UploadDeclaration,
} from "@docmaker/core";
import type { ProjectStore } from "@docmaker/core/node";
import type { LlmClient } from "@docmaker/llm";
import type { StyleSummary } from "@docmaker/styles";

export type JobRunnerMode =
  | { kind: "in-process" } // CLI, tests
  | { kind: "worker"; workerPath: string }; // web: jobs run in a forked worker (<repoRoot>/apps/cli/src/worker.ts)
export interface EngineOptions {
  cwd?: string; // repoRoot is found from here (or DOCMAKER_REPO_ROOT)
  env?: NodeJS.ProcessEnv;
  renderClient: RenderClient | null; // null in "worker" mode (the worker owns rendering)
  runner?: JobRunnerMode; // default in-process
  llmOverride?: LlmClient; // tests
  logger?: Logger;
}
export interface StageStatus extends StageState { stale: boolean; blockedBy: GateId | null; blockedReason: "unmet" | "stale" | null }
export interface DemoOptions {
  fixture: string; // "tulip-mania"
  langs: Lang[]; // default ["en"]
  offline: boolean; // default true → providers: local + procedural only; HttpClient refuses all requests
  tts: "auto" | "synthetic" | "kokoro" | "piper"; // auto → kokoro/piper if a model is present, else synthetic
  preset: RenderPresetId; // default "draft"
  onlyChapters: string[] | null; // e.g. ["CH1","CH2"] → JobOptions.onlyChapters (hashed)
  slug?: string;
}
export interface ImpactReport { staleStages: { stage: StageId; lang: Lang | null }[]; estimatedRerunUsd: number; lostUserEdits: string[] }

export interface Engine {
  readonly config: RuntimeConfig;
  // projects
  createProject(input: NewProjectInput): Promise<Project>;
  listProjects(): Promise<{ slug: string; title: string; updatedAt: string; languages: Lang[]; activeJobId: string | null }[]>;
  getProject(slug: string): Promise<Project>;
  /** Validated; LOCKED_AFTER_START fields rejected once any stage produced output. */
  updateProject(slug: string, patch: Partial<Project>): Promise<Project>;
  impact(slug: string, patch: Partial<Project> | { doc: string }): Promise<ImpactReport>; // shown before style/minutes/language/outline edits
  status(slug: string): Promise<{ stages: StageStatus[]; costUsd: number; activeJobId: string | null; queued: string[] }>;
  // costs & gates
  estimate(slug: string, stage: StageId, lang: Lang | null): Promise<CostEstimate | null>;
  estimatePipeline(slug: string, o: { from: StageId; to: StageId; langs: Lang[] }): Promise<PipelineEstimate>;
  /** Per-gate validation (§5.4): factcheck-ack needs items ⊇ open high items, each with a note ≥ 10 chars; editorial gates refuse by:"flag"/"auto-threshold". */
  approve(slug: string, gate: GateId, a: Omit<Approval, "gate" | "approvedAt">): Promise<void>;
  // jobs (persisted in jobs/index.json; crash-reconciled at start; identical queued requests coalesce)
  submit(req: JobRequest): Promise<{ jobId: string; coalesced: boolean }>;
  resume(jobId: string): Promise<{ jobId: string }>; // "approve & continue" / `docmaker run --resume`
  cancel(jobId: string): Promise<void>; // aborts SDK streams, kills process groups, deletes partial chunk .tmp files
  listJobs(slug: string): Promise<JobRecord[]>;
  getJob(jobId: string): Promise<JobRecord | null>;
  events(jobId: string, afterSeq?: number): AsyncIterable<JobEvent>; // replays jobs/<id>.ndjson then live
  // documents (user edits). PUT of a script runs lintScript + deterministic fact-checks and returns the issues.
  readDoc<S extends z.ZodType>(slug: string, rel: string, schema: S): Promise<{ value: z.infer<S>; etag: string | null }>;
  writeDoc<S extends z.ZodType>(slug: string, rel: string, schema: S, value: z.input<S>, etag: string | null): Promise<{ etag: string; issues: LintIssue[] }>;
  history(slug: string, rel: string): Promise<{ file: string; at: string; etag: string }[]>;
  revert(slug: string, rel: string, historyFile: string): Promise<{ etag: string }>;
  // styles
  listStyles(): Promise<StyleSummary[]>;
  suggestStyleForIdea(idea: string, o: { useLlm: boolean }): Promise<StyleSuggestion>; // offline always; LLM only when asked + key
  getStyle(id: string): Promise<StylePlugin>;
  // assets (interactive; short, run in the calling process)
  liveSearch(slug: string, i: { beatId: string; query: Partial<AssetQuery> & { text: string }; providers: AssetProviderId[]; allowPaid: boolean }): Promise<CandidateRecord[]>;
  freeze(slug: string, i: { beatId: string; slot: number; provider: AssetProviderId; providerAssetId: string }): Promise<{ asset: FrozenAsset; issues: LintIssue[] }>;
  upload(slug: string, i: { tmpPath: string; kind: "asset" | "recording"; lang: Lang | null; declaration: UploadDeclaration | null; segmentId: string | null }): Promise<{ rel: string; asset: FrozenAsset | null }>;
  resolveClip(slug: string, i: { segmentId: string; url: string | null; uploadRel: string | null; startMs: number; endMs: number; channel: string; title: string }): Promise<{ issues: LintIssue[] }>;
  // environment
  doctor(): Promise<DoctorReport>;
  homeConfig(): Promise<HomeConfig>;
  setHomeConfig(patch: Partial<Omit<HomeConfig, "schemaVersion">>): Promise<HomeConfig>;
  setSecret(name: string, value: string): Promise<void>; // writes <home>/.env (0600) after explicit consent
  testKey(name: string): Promise<{ ok: boolean; tier: string | null; message: string }>;
  runDemo(opts: DemoOptions): Promise<{ slug: string; jobId: string; mp4: string; exportDir: string }>;
  close(): Promise<void>;
}
export interface DoctorCheck { id: string; ok: boolean; level: "error" | "warn" | "info"; value: string; hint: string | null }
export interface DoctorReport { checks: DoctorCheck[]; blocking: boolean }
export declare function createEngine(opts: EngineOptions): Promise<Engine>;

export interface StageCtx {
  project: Project; lang: Lang | null; variant: string | null; store: ProjectStore; config: RuntimeConfig; secrets: Secrets; logger: Logger;
  signal: AbortSignal; emit(e: JobEventInput): void; progress: Progress; costs: CostTracker; llm: LlmClient;
  style: StylePlugin; render: RenderClient; options: JobRequest["options"]; jobId: string;
}
export interface StageDef {
  id: StageId;
  perLang: boolean;
  version: number;
  optionKeys: readonly (keyof JobRequest["options"])[]; // options that affect output → hashed into inputs
  inputs(ctx: StageCtx): Promise<unknown>; // hashed with docHash rules (§5.3)
  estimate?(ctx: StageCtx): Promise<Omit<CostEstimate, "schemaVersion" | "id" | "createdAt" | "planHash"> | null>;
  gatesBefore?(ctx: StageCtx): Promise<{ gate: GateId; reason: "unmet" | "stale"; planHash: string; summary: string }[]>;
  outputs(ctx: StageCtx): string[]; // project-relative artifacts (existence checked for "done")
  run(ctx: StageCtx): Promise<{ artifacts: string[] }>;
}
export declare const STAGES: readonly StageDef[];
/** Job-worker main loop (stdin IPC, §14.5). apps/cli/src/worker.ts calls it with an InProcessRenderClient. */
export declare function runJobWorker(o: { renderClient: RenderClient; cwd: string }): Promise<void>;
export type { ProjectState };
```

> **Verification note.** Every code block in §4 and §4.19 was type-checked with `tsc 5.9.3 --strict` against `zod@4.6.5` (and `@anthropic-ai/sdk@0.131.0`, `@types/react@19.3.0` for the stubs) with 0 errors, and `$SP/design/core-v2/check.ts` parses the drama style, anchors, overlays, transitions (odd overlap durations rejected), the script prefix refinement, fact-sheet id uniqueness and job events at runtime. Re-run: `cd $SP/design/core-v2 && ./node_modules/.bin/tsc -p tsconfig.json && ./node_modules/.bin/tsx check.ts && (cd stubs && ../node_modules/.bin/tsc -p tsconfig.json)`.

---

## 5. Pipeline, persistence, idempotence, gates, jobs

### 5.1 Stage graph

```
research ─► style ═(style-confirm)═► outline ═(outline-approval)═► script[lang] ─► beats ─► beatslice[lang] ─► factcheck[lang]
                                                                                    │                              ║ (factcheck-ack, person-ack, recheck)
                                                                                    └─► assets ──┐                 ║
                                                                                                 ▼                 ▼
                                                     voice[lang]  (scratch take: free, ungated · final take: gated) ─► layout[lang] ─► direct[lang] ─► mix[lang]
                                                                                                                                         │              │
                                                                                     export[lang] ◄═(editorial gates)═══════════════════┴──────────────┤
                                                                                     render[lang, preset] ◄═(editorial gates)══════════════════════════┘ ─► qa[lang, preset]
```

- `script[fr]` (secondary) runs after `script[en]` (primary) because it receives the primary chapter's segment skeleton.
- `beats` plans from the **primary** script's **segment skeletons**; `beatslice[lang]` cuts each language's text into the plan's beats (the primary language reuses the planned slices or re-slices deterministically after an edit).
- `factcheck[lang]` runs after `beatslice[lang]` so it covers narration **and** on-screen text in one pass.
- When `voice/<lang>/active.json` is missing, the pipeline runner first runs `voice[lang]` with `options.takeKind:"scratch"` (synthetic provider, free, ungated) and activates it, so layout, director, preview and draft renders work before any paid take. Final takes (ElevenLabs, Kokoro, Piper, recording) are gated.
- `export` depends on `direct` + `mix` only (timeline-only export works without a render); the reference MP4 is added when an up-to-date render of any preset exists (master preferred).

| Stage | Per lang | Ver. | Inputs hashed (docHash of documents; besides stageVersion) | Option keys hashed | Outputs (§5.2) | Gates | Paid |
|---|---|---|---|---|---|---|---|
| research | no | 1 | idea, languages, targetMinutes, editorial.asOf, llm.provider/fixtureId, offline | — | dossier, dossier.md, registry, factsheet, verification, entities, raw turns | cost | yes |
| style | no | 1 | idea, factsheet, style registry hash | — | style/suggestion.json (`stage:"research"`); sets `project.styleId` only when it is null; never touches `styleConfirmed` | cost (tiny) | tiny |
| outline | no | 1 | factsheet, styleId, style.dataHash, targetMinutes, languages, primaryLang, cps per language, riskFlags | — | outline/outline.json | **style-confirm**, cost; **outline-approval** after | yes |
| script | yes | 1 | outline + approval planHash, factsheet, style.dataHash, lang, cps[lang], (secondary) primary skeleton hash | `chapters`, `forceOverwriteEdits` | script/<lang>/script.json (+ `.cache/`) | outline-approval, cost | yes |
| beats | no | 1 | per-chapter primary **skeleton** hashes, factsheet, style.dataHash | `replanChapters` | beats/plans.json | cost | yes |
| beatslice | yes | 1 | plans, script[lang], factsheet | — | beats/<lang>.json | cost (secondary only) | low |
| factcheck | yes | 1 | script[lang], slices[lang], plans, factsheet, publish[lang], riskFlags | — | script/<lang>/factcheck.json | cost; **factcheck-ack** after | yes |
| assets | no | 1 | plans, user-picks, entities, primary clip segments + quotes, providers, licensePolicy, offline, fairUseAcknowledged, visionRerank, maxCandidatesPerBeat, maxClipSeconds, audio.music/musicLibraryDir/sfxPacks, person-ack items | `allowPaid` | assets/{picks,frozen,ledger,music}.json, candidates/*, clips/*, media/* | cost (paid providers, rerank), **fair-use** before the first YouTube download | optional |
| voice | yes | 1 | per segment: ttsText hash + settingsHash + context; clip resolutions (narrated fallbacks) | `takeKind`, `segments`, `retryBad`, `pickupTts` | voice/<lang>/<takeId>/…, active.json | final takes only: **factcheck-ack**, **person-ack**, cost | ElevenLabs |
| layout | yes | 1 | active take, script[lang], plans, slices[lang], outline (acts), picks.clips + clip asset durations, style.pauses, clipFallback, fps, TOKENIZER_VERSION | `onlyChapters` | layout/<lang>.json, program/<lang>/vo_program.wav | — | no |
| direct | yes | 1 | layout, plans, slices[lang], picks, frozen, clip-words, factsheet, factcheck[lang], riskFlags, active take pickups, style.dataHash, seed, captions, captionsVariant, video, themeOverride, overrides, SFX manifests, music, person-ack items, DIRECTOR_VERSION, TOKENIZER_VERSION, DOC_VERSIONS.timeline | `onlyChapters` | timeline/<lang>.json, .lint.json, .usage.json | — | no |
| mix | yes | 1 | `hashJson(timeline.audio)`, referenced asset ids, durationInFrames, fps, project.audio | — | audio/<lang>/mix.wav, stems/*, loudness.json | — | no |
| render | yes (+preset) | 1 | timeline, mix (byte etag), remotion codeHash, preset, gl, grain, LUT | `frameRange`, `onlyChapters` | render/<lang>/<preset>/{final.mp4, render.json, snapshot/} | **factcheck-ack**, **person-ack**, **recheck** | no |
| export | yes | 1 | timeline, mix (byte etag), formats, exportRoot, fcpxmlVersion, overlays, ledger, usage, factcheck, publish[lang], reference-render presence | `timelineOnly`, `overlays` | export/<lang>/… | **factcheck-ack**, **person-ack**, **recheck** | no |
| qa | yes (+preset) | 1 | render doc, timeline | — | qa/<lang>/<preset>/report.json, sheets | — | no |

**Rule:** every `JobOptions` key a stage reads is listed in its `optionKeys` and hashed into its inputs. `StageState` is keyed by `(stage, lang, variant)`; `variant` is the preset for render and qa, `null` otherwise.

### 5.2 Persistence layout

Everything for a project lives under `projects/<slug>/`; the path functions are `P` (§4.16).

```
projects/<slug>/
  project.json  state.json  approvals.json  .lock
  jobs/index.json  jobs/<jobId>.ndjson
  costs/receipts.ndjson  costs/estimates/<stage>[.<lang>].json  costs/llm/<fingerprint>.json
  research/dossier.json  dossier.md  registry.json  factsheet.json  verification.json  entities.json  raw/turn-<n>.json
  style/suggestion.json
  outline/outline.json
  script/<lang>/script.json  script/<lang>/factcheck.json  script/<lang>/.cache/<CHn>.json
  beats/plans.json  beats/<lang>.json
  assets/user-picks.json (USER)  assets/picks.json  assets/frozen.json  assets/ledger.json  assets/music.json  assets/local-index.json
  assets/candidates/<beatId>.json  assets/clips/<segmentId>.json  assets/credits.<lang>.md
  media/<assetId>.<ext>                    (hardlinks into <home>/cache/blobs, else copies)
  uploads/<tmp>                            (web uploads waiting for a licence declaration)
  voice/<lang>/active.json  voice/<lang>/<takeId>/take.json  voice/<lang>/<takeId>/seg/<segmentId>.wav  voice/<lang>/.segcache/<key>.wav
  voice/<lang>/recordings/<segmentId>-<n>.<ext> | <file>   voice/<lang>/teleprompter.html
  layout/<lang>.json  program/<lang>/vo_program.wav
  timeline/<lang>.json  timeline/<lang>.overrides.json (USER)  timeline/<lang>.lint.json  timeline/<lang>.usage.json
  audio/<lang>/mix.wav  audio/<lang>/stems/{vo,music,sfx,clip}.wav  audio/<lang>/loudness.json
  render/<lang>/<preset>/{snapshot/, chunks/<hash>.ts, video.mp4, final.mp4, render.json}
  export/<lang>/…                          (§13.5)
  qa/<lang>/<preset>/report.json  qa/<lang>/<preset>/sheets/*.png
  .history/<rel>/<iso>-<etag8>.json        (last 20 versions of every user-editable document)
```

`DOCMAKER_HOME` (default `~/.documentarymaker/`) is shared across projects:
```
.env (secrets, 0600)  config.json (HomeConfig)  browser.json  gl-probe.json  locks/  logs/docmaker-<date>.log
cache/blobs/<aa>/<sha256>.<ext>  cache/index.json (LRU, cap = min(20 GiB, 50 % of free disk))  cache/http/<sha1(url)>.json  cache/http/quota.json
models/{kokoro,piper,whisper}/…  ml/ (CLIP, M3)  styles/<id>/ (user styles)
sfx/<pack>/<version>/{*.wav, manifest.json}  music/procedural/<hash>.wav  bundles/<codeHash>/  py/.venv/  bin/yt-dlp
```

### 5.3 Idempotence, invalidation and preservation of user work

- `inputsHash(stage, lang, variant) = hashJson({stage, stageVersion, lang, variant, inputs, options: pick(options, optionKeys)})`, where documents enter as **`docHash`** (volatile timestamps excluded). Secrets never enter it. A no-op re-run therefore writes identical bytes (the store skips the write) and stales nothing downstream.
- A stage is **done** when `state.inputsHash === inputsHash(now)` and every output exists; **stale** when they differ (computed, never stored); **blocked** when a gate is unmet. `runStage` emits `stage-skip:"up-to-date"` unless `force`.
- Fine-grained caches below stage level (each re-run pays only for what changed):
  - script: per chapter, `hashJson({chapterPlan, storySoFar, previousTail, factsheet, style, lang, skeleton})` → `.cache/`;
  - beats: per chapter, `hashJson({skeleton, chapter displayTexts, factsheet, style})` (LLM receipt);
  - beatslice: per chapter and language;
  - factcheck: per chapter (receipt fingerprint over the chapter's segments, on-screen strings and cited facts);
  - voice: per segment cache key (§8.4); render: per chunk `sliceHash` (chunk-relative, §10.3); assets: candidates by query hash, blobs by sha256.
- **Paid-call idempotence:** every LLM, TTS or fal request has `Receipt.fingerprint = sha256(provider|endpoint|canonicalJson(request))`; a receipt with an `outputRef` is reused; `--new-request` / "Regenerate" forces one new call.
- **Deterministic take ids:** `takeIdFor(kind, provider, voiceId, settingsHash, sortedSegmentCacheKeys)`; a re-run whose segments all hit the cache reproduces the same take id, so layout and NLE paths do not change.

**What an edit re-runs** (normative):

| Edit | Effect |
|---|---|
| Primary `displayText` inside existing segments | `ttsText` rebuilt by the engine (unless `ttsTextEdited`); `beatslice[primary]` re-slices deterministically keeping plans, ids and picks; `factcheck` re-checks changed chapters (gate re-armed if stale or new high items); layout → direct → mix re-run (free). |
| Primary segment structure (add/remove/retype segments, change clip quote) | that chapter's beats are re-planned by the LLM (cost gate); picks whose `planKey` no longer matches become orphans; other chapters keep their plans. |
| Secondary script | only that language's beatslice/factcheck/voice/layout/direct/…; secondary segments whose `primaryHash` ≠ `hashJson(primary displayText)` show "out of sync" with a per-segment *transcreate* action (cheap LLM call, cost-gated). |
| `user-picks.json` / overrides | assets (picks merge) / direct only. |
| Style, targetMinutes, languages, outline | `engine.impact()` lists stale stages, an estimated re-run cost and user edits that would need `forceOverwriteEdits` **before** the change is saved. |
| New voice take | layout → direct → mix (free); render chunks re-render only where the chunk-relative slice hash changed. The web app runs `runPipeline({from:"layout", to:"mix"})` automatically after a voice job and leaves render to the user. |

**User-work rules.** User-authored inputs live in their own files (`user-picks.json`, `*.overrides.json`, fact-check resolutions inside `factcheck.json` carried over by stable FC ids, approvals). Script chapters edited by the user (`userEdited`) or `locked` are never regenerated without `forceOverwriteEdits` (CLI `--force-overwrite-edits`, UI confirm listing the chapters). Every user-editable document keeps 20 versions in `.history/` with a revert action. Stage writes to documents a user can also edit use `ifMatch` (§4.18).

### 5.4 Gates

| Gate | When it blocks | Satisfied by | Recorded as |
|---|---|---|---|
| `style-confirm` | before `outline` while `project.styleConfirmed` is false | UI "Use this style", `docmaker new --style <id>`, `docmaker style <slug> --pick <id>` or `--confirm`; `--yes` also confirms the current suggestion (not an editorial gate) | `project.styleConfirmed = true` + Approval |
| `outline-approval` | before `script` | UI "Approve outline", `docmaker outline --approve`; requires `outline.thesisConfirmed` (the user edited or explicitly confirmed the thesis) | `Approval{planHash: docHash(outline)}` — any later outline edit invalidates it |
| `factcheck-ack` | before final `voice` takes, `voice import`, `render`, `export` of that language, when (a) the fact-check is missing or **stale** (`FactCheck.scriptHash ≠ docHash(script)`, `slicesHash ≠ docHash(slices)` or `publishHash` mismatch) or (b) any `high` item is open or (c) `riskFlags ∩ {real_person_allegations, sexual_violence, ongoing_trial} ≠ ∅` and any `medium` item is open | each blocking item is `rewritten` (fixed in the script/on-screen text and re-checked), `acknowledged` or `dismissed` with a note ≥ 10 characters (notes may not be identical across items unless explicitly confirmed). `quote_mismatch` and `unverified_quote` with verification `not-found` can **only** be fixed. | `Approval{items: FC ids, itemNotes, planHash: hashJson(sorted blocking items {id, verdict, resolution, note})}` |
| `person-ack` | identity searches, portraits, lower thirds or on-screen naming of a person with `publicFigure:false` | per-person approval with a note | `Approval{items: personIds, itemNotes}`. Persons with `isMinorOrPrivateVictim:true` are **never** searched, named on screen or shown, whatever the approvals. |
| `recheck` | `render`/`export` when a claim cited in the script has a `PENDING_STATUSES` status and `asOf` older than 30 days | `docmaker factcheck --recheck` (refreshes `asOf`), or acknowledgement per claim with a note | `Approval{items: claimIds}` |
| `cost` | before a paid stage (or a whole pipeline) whose estimate > `autoApproveUnderUsd` | UI confirm, `--yes`, `--max-cost <usd>` (approves when estimate ≤ max) | `Approval{planHash: estimate.planHash | pipeline planHash, items: stage planHashes}` |
| `fair-use` | before the first YouTube download in a project | the user ticks the notice (§17.3) | `editorial.fairUseAcknowledged = true` + Approval |

- **Editorial gates** (`EDITORIAL_GATES`: outline-approval, factcheck-ack, person-ack, recheck, fair-use) are **never** satisfied by `--yes`, `--max-cost` or the auto-approve threshold. Only fixture projects whose `fixture.json` has `autoApproveGates:true` (tulip-mania) auto-approve them, with `by:"fixture"` and the note `"demo fixture"`; the `gate-test` fixture sets it to `false` so the safety suite exercises every gate.
- `engine.approve` validates per gate: `factcheck-ack` requires `items ⊇` every blocking item; `--ack all` on the CLI is allowed only on an interactive TTY (prints each item, asks y/N per item); non-interactive use requires `--ack-file <json>` with per-item notes.
- **Budget overrun:** a stage stops with `BUDGET_EXCEEDED` when its spend exceeds `max(1.5 × approved estimate, estimate + $1)`, `maxUsdPerStage`, or the project's total exceeds `maxUsdTotal`; resuming needs a new approval showing the spend so far.
- An unmet gate emits `needs-approval{gate, reason:"unmet"|"stale"}`; the job ends `waiting-approval` (CLI exit code 3). **"Approve & continue"** = `engine.approve(...)` then `engine.resume(jobId)`, which resubmits the original request (`JobRecord.resumeOf`); CLI: `docmaker run --resume <jobId>`.

### 5.5 Engine (`@docmaker/engine`, API in §4.19)

- Stage implementations live in `packages/engine/src/stages/<id>.ts` and are registered in `STAGES`; `optionKeys` declares hashed options; `outputs()` lists artifacts.
- **Runner modes.** `in-process` (CLI, tests): jobs run in the calling process with the injected `RenderClient`. `worker` (web): the engine instance in the Next server handles reads, writes, approvals, estimates, styles, live search, freeze and upload, while `submit`/`resume`/`cancel` are forwarded over IPC to **one forked job worker** (`<repoRoot>/apps/cli/src/worker.ts`, which calls `runJobWorker({renderClient: new InProcessRenderClient(...)})`). CPU-bound work (sherpa synthesis, the mixer, synthetic VO, ffmpeg orchestration, renders) therefore never blocks the Next event loop.
- **Forking rules** (verified failure modes): resolve the worker path from `config.repoRoot` (never `import.meta.resolve`, which throws `r.resolve is not a function` in Turbopack server bundles); `child_process.fork(workerPath, [], { cwd: repoRoot, execArgv: ["--import", <repoRoot>/node_modules/tsx/dist/esm/index.mjs], env: minimalEnv + NODE_USE_ENV_PROXY })`. `cwd: repoRoot` makes Remotion find Chrome in `<repoRoot>/node_modules/.remotion` (and `browserExecutable` is passed explicitly anyway).
- **IPC protocol** (worker ↔ host), JSON messages: `{id, method:"submit"|"resume"|"cancel"|"ping", params}` → `{id, type:"result"|"error", …}` plus pushed `{type:"event", event: JobEvent}`. The host also tails `jobs/<id>.ndjson`, so a host restart loses nothing.

### 5.6 Job lifecycle

- **Queue.** Per project FIFO; one running job per project (`.lock` with `{pid, owner, jobId, at}`); renders additionally take the machine-wide render lock (progress detail `{waiting:"render-slot"}` while waiting).
- **Persistence.** `jobs/index.json` (`JobsIndex`, last 200) is updated at queue, start and end; every event is appended to `jobs/<id>.ndjson` before it is emitted, so SSE clients replay with `afterSeq`.
- **Coalescing.** A submitted request whose canonical JSON (kind, stage, from, to, langs, options, preset, force) equals a queued one is merged (`coalesced:true`, `coalescedInto`). The scene board's repeated pick changes therefore queue at most one `direct` per language.
- **Crash reconciliation.** At engine or worker start, every job `queued|running` whose owner pid is gone is marked `failed` with `{code:"INTERRUPTED"}`; an `error` and a `job-end` event are appended; stale locks are taken over.
- **Render snapshot.** The render stage copies `timeline/<lang>.json` and hardlinks the mix into `render/<lang>/<preset>/snapshot/`, records their hashes in `render.json`, then **releases the project job lock** (`ctx.releaseProjectLock()`) and keeps only the render slot. Other jobs of the project (e.g. scene-board `direct` runs) proceed during a 1.5–2 h master render.
- **Cancel.** `AbortController` per job: SDK streams are aborted, child processes are killed by process group (`killTree`), the in-progress chunk's `.tmp` is deleted; partial caches (chapters, segments, chunks, research turns) are kept so a resume pays only for what is missing. Research saves every `pause_turn` message to `research/raw/turn-<n>.json` and resumes from them.
- **Discovery.** `engine.listJobs(slug)` / `GET /api/projects/[slug]/jobs` return active, queued and recent jobs; `status()` includes `activeJobId`, so a reloaded page reattaches to the live job.

---

## 6. LLM pipeline (`@docmaker/llm`, W2)

### 6.1 Client rules (normative)

- Model **`claude-opus-5-5`** everywhere, `@anthropic-ai/sdk@0.131.0`, `new Anthropic({ apiKey })` (key from `loadRuntime` secrets; the SDK's profile auth also works).
- **Thinking is always on.** Never send `thinking` with `disabled` or a `budget_tokens` value (400). **Always set `output_config.effort` explicitly** (the default is `medium`).
- **Never** use forced `tool_choice` (400). Structured output: `client.beta.messages.parse({…, output_config:{effort, format: betaZodOutputFormat(WireSchema)}})` from `@anthropic-ai/sdk/helpers/beta/zod`, because refusal fallback needs `betas:["server-side-fallback-2026-07-01"]` + `fallbacks:"default"` (on when `project.llm.refusalFallback`, the default). With fallback disabled: `client.messages.parse` + `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`. Batches (R11) never carry fallbacks.
- Non-streaming `parse` passes `{ timeout: 30 * 60_000 }`. When `max_tokens > 32000`, use `client.beta.messages.stream({...same params...}).finalMessage()`, concatenate text blocks, then `WireSchema.parse(JSON.parse(text))`. Research always streams.
- **Citations and `output_config.format` in one call → 400.** Research (citations) and structuring are separate calls.
- **No assistant prefill; append-only harness.** `pause_turn` continuations append `msg.content` unchanged (including `encrypted_content` and thinking blocks); every turn is handed to `onTurn` and persisted (`research/raw/turn-<n>.json`) so a canceled or crashed research resumes from `resumeTurns`.
- After every call check `stop_reason`: `refusal` (after fallback) → `LLM_REFUSAL` with the hint "the topic triggered a safety classifier; reframe the idea or write this step manually"; `max_tokens` → retry once with `max_tokens·1.5` (cap 64000); `parsed_output === null` → retry the identical request once (internal new-request), then `LLM_SCHEMA`.
- Server-tool errors arrive as HTTP 200 with an error object in `content` (for web search the content is an object, not a list): count, log, never index.
- Prompt caching: system = text blocks `[ROLE+EDITORIAL_RULES+STYLE_GUIDE, FACT_SHEET json, OUTLINE json?]`; `cache_control:{type:"ephemeral"}` on the **last stable block**; everything volatile in the user turn; no timestamps or unsorted JSON in system text (`stableStringify`); ≤ 4 breakpoints.
- **Wire schemas** obey structured-output limits: all fields required, unions only as enums, no `min/max/maxItems` server-side, no recursion, ≤ 24 optional and ≤ 16 union-typed parameters. Range and id checks happen in the mappers (§6.4).
- Usage → `Receipt`; cost = `input·4 + output·20 + cache_read·0.20 + cache_write·5` per MTok + `web_search_requests·$0.01`; raw responses at `costs/llm/<fingerprint>.json`.
- Interfaces (`LlmClient`, `StructuredRequest`, `ResearchRequest`, `StepCtx`, step signatures): §4.19 llm stub.

### 6.2 Call table

| # | Step fn | SDK call | effort | max_tokens | Wire schema | Notes |
|---|---|---|---|---|---|---|
| 1a | `runResearch` | `beta.messages.stream().finalMessage()`, `pause_turn` loop ≤ 8, resumable | high | 64000 | — (cited text) | `web_search_20260209` (`max_uses:25`); `web_fetch_20260209` (`max_uses:30, citations:{enabled:true}, max_content_tokens:20000`); no `code_execution`; search EN + subject language; prefer primary documents |
| 1b | `buildFactSheet` | `beta.messages.parse` | high | 32000 | `FactSheetWire` (prototype `FactSheet`; no `wikidata_qid`) | system cached; source list built **in code** |
| 2i | `suggestStyle(stage:"idea")` | parse | low | 2000 | `StyleSuggestionWire` | optional at `/new` (user asks); offline `suggestStyleOffline` is shown first and is free |
| 2r | `suggestStyle(stage:"research")` | parse | low | 4000 | `StyleSuggestionWire` (+ `theme_override`) | refines ranking, titles, thumbnail texts, risk flags; never overwrites a confirmed style |
| 3 | `writeOutline` | parse | high | 16000 | `buildOutlineWire(actIds)` | cached prefix: rules + style guide + fact sheet |
| 4 | `writeChapter`, sequential per language | parse | high | 16000 | `ChapterScriptWire` | volatile: chapter plan, story so far, previous tail, open loops, target words ± 8 %, (secondary) skeleton |
| 4r | `reviseChapter` | parse | high | 16000 | `ChapterScriptWire` | ≤ `revisionRounds` (2), only with lint errors; also used for parity repair |
| 5 | `planBeats`, ∥ ≤ 4 chapters | parse | medium | 16000 | `ChapterBeatsWire` | cached prefix: rules + visual grammar + fact sheet (for refs) |
| 5s | `sliceBeats(mode:"llm")` per chapter × secondary language | parse | low | 8000 | `BeatSliceWire` | validator; failure → `splitBeatsFallback` |
| 6a | `factCheck` per chapter | parse | high | 16000 | `FactCheckWire` (+ `where`, `surface`) | input: narration segments, on-screen strings (onScreenText, motion data strings, lower-third roles, card texts) and (once) title/thumbnail/description; cached fact sheet |
| 6b | `recheck` (cost-gated) | stream | high | 32000 | — | `web_search` `max_uses:10`; delta merge into the fact sheet; refreshes `asOf` |
| 6t | `transcreateSegment` (out-of-sync secondary segment) | parse | low | 2000 | `{ display_text, subtitle_translation }` | cost-gated, per segment |
| 7 | `makeReranker().rerank()` | parse | low | 2000 | `RerankWire` | ≤ 9 thumbnails ≤ 768 px, each preceded by "Image N:"; identity only from provenance text; "do not identify people" |
| 8 | `pickPassage` (optional) | parse | low | 1000 | `PassageWire` | only when the top 2 deterministic windows are within 0.05 |
| R1 | hero planner / builder / judge | — | xhigh / medium / high | — | — | roadmap |

**Expected cost for 30 minutes** (one language): research ≈ $1–2; chapters ≈ $1; beats ≈ $2–3; fact-check ≈ $0.5; vision rerank in `selective` mode ≈ 150 of ≈ 460 beats × $0.02 ≈ $3 (`all` mode ≈ $9). Total ≈ **$8–10** (`selective`), ≈ $14 (`all`). A second language adds ≈ chapters + slices + fact-check (≈ $2). `engine.estimatePipeline` computes the real figure from `estimateStepCost` before the run.

### 6.3 Step behaviour (beyond the prototypes)

**1a Research** (port `$SP/script-pipeline/research.ts`): collect `web_search_tool_result` and `web_fetch_tool_result` URLs; map citations (`web_search_result_location.url`; `char_location` through `fetchedDocs[document_index]`); **registry = only URLs the API returned that were cited or fetched**, ids `S1..n` in first-seen order; rewrite `[url]` to `[S#]`; persist each raw turn.

**1b FactSheet + verification** (research stage, engine):
- Deterministic checks after parsing: every `source_ids` entry must exist in the registry, else the item's summary moves to `gaps` and into `verification.invalidRefs`; `Source` url/fetched/cited/snippets come from the registry, only publisher/source_type/reliability/language/published_at from the LLM.
- **Quote verification** (`assets.verifyQuotes`): fetch the source page via `HttpClient`, extract text with `@mozilla/readability` + `linkedom`, normalise with `normWord`; LCS / quote length ≥ 0.92 → `verbatim`, ≥ 0.75 → `fuzzy`, else `not-found`; network failure → `fetch-failed`; `verifiedBy:"page"`. **Offline or fixture** (`config.offline || llm.provider === "fixture"`): no request at all; quotes stay `unchecked` and verification items read `{check:"quote-verbatim", ok:false, detail:"skipped-offline"}`.
- **Entities** (`assets.resolveEntity`, keyless `wbsearchentities`): QID + label + aliases per public person → `research/entities.json` and `Person.wikidataQid/aliases`. Offline → `null`/`[]`. Persons with `isMinorOrPrivateVictim` are never resolved; `publicFigure:false` persons only after `person-ack`.
- A YouTube passage match with `matchScore ≥ 0.8` (assets stage) upgrades the quote to `verification:"verbatim", verifiedBy:"video"` (the assets stage records the upgrade in `picks.clips`; the factcheck stage reads it — it does not rewrite the fact sheet).

**2 Style:** `suggestStyleOffline` (styles) at `/new` and `new --style auto`; `suggestStyle(stage:"research")` after research when a key is set. The engine sets `project.styleId` only when null and leaves `styleConfirmed` to the user. `riskFlags` drive: `real_person_allegations|sexual_violence|ongoing_trial` → medium fact-check items also gate and `recheck` is mandatory before render; `minors` → no portrait/identity search for any person flagged minor, and the director never shows portraits of them; `suicide_self_harm` → a safe-messaging addendum is appended to `EDITORIAL_RULES` and the director adds an end card (KineticText, last 5 s) with the localised resource text from `packages/director/src/resources.ts` (EN: "If you are struggling, you can call or text 988 (US) or find a local helpline at findahelpline.com"; FR: « Si vous traversez une période difficile, appelez le 3114 (France) ou trouvez une ligne d'écoute sur findahelpline.com »).

**3 Outline:** compute `planBudget()` per language **in code first** and pass the primary budget as JSON; validate (`validateOutline`): act ids belong to the shape; Σ chapter `target_words` within ± 5 % of `budget.words`; `targetSec` derived (`targetWords·avgCharsPerWord/cps`); every teaser has an existing payoff chapter; loops close after they open; the first `ad_break_after` falls in `adBreaks.firstAfterSec`, later ones every `everySec`. One repair round. `thesisConfirmed` starts `false`.

**4 Chapters:**
- Sequential per language; story so far = previous `summary_for_next`; previous tail = last 2 narration segments verbatim.
- **Secondary languages** are written natively and receive the primary chapter's **segment skeleton** `[{id, type, device, quote_id, fact_ids, approx_chars}]`. **Parity is a hard invariant**: `validateLangParity(primary, other)` must return no issue (identical ordered `(segmentId, type, quoteId)` per chapter). On failure: one repair round (`reviseChapter` with the diff); still failing → the chapter fails with `LANG_PARITY` (the diff in the error details). There is no proportional fallback.
- Ids: the mapper normalises segment ids (`CH3-S7` → `CH3-S07`; missing → assigned in order); `primaryHash` is set for secondary segments.
- After each chapter: `lintScript`; errors → revise rounds. Then the **engine** fills `ttsText = voice.buildTtsText(spokenText(seg,"vo"))` for narration segments without `ttsTextEdited`.
- Regenerating a `userEdited` or `locked` chapter requires `forceOverwriteEdits`.

**5 Beats** (`planBeats`, then `validateBeats`):
- Exact reconstruction of each narration segment by its beat texts (whitespace-normalised); duration bounds (hook 1–3 s, body 1.5–6.5 s); no 4+ consecutive beats with the same visual; every `cue_tags[].word` exists in the beat text.
- `ai_illustration` with `person_ids` → **error**; the beat is rewritten to `motion_graphic`/`text_card`.
- `motion_data_json` parses and passes `MotionData[template]`; then the **fact refs** are checked: `quote_card`/`tweet_card`/`comment_pile` → `quote_id` exists and `text`/`body` equals `Quote.verbatim` after `normWord` normalisation (secondary language: equal to the verbatim, or flagged `translated` when it transcreates it); `headline_stack` items → `source_id` exists, outlet = `Source.publisher` and headline ≥ 0.9 similar to `Source.title`; `document_highlight` → `source_id` exists, highlighted passage = `Quote[quote_id].verbatim` when given; `counter`/`money_counter`/`bar_chart` → `figure_id` exists and `value` equals `Figure.value` (bars per figure); `timeline` events with `event_id` → date equals. **Any failure downgrades the beat** to `kinetic_text` (lines from `onScreenText`) plus a validation warning; the director adds `SourceLabel{kind:"reconstruction"}` on downgraded beats that still reference people.
- `SENSITIVE` cues with value `"bleep"` must anchor a word inside a quoted passage (never the narrator's own claim).
- Ids and plan keys assigned in code (§4.6); `syntheticBeats` appends clip and breath beats.
- Exact reconstruction failing after one repair → `splitBeatsFallback` (sentence ends, then `, ; : —`, packed to `beatSec.avgBody`) with the LLM's annotations re-attached by index.

**5s Beat slicing** (`sliceBeats`): `mode:"llm"` for secondary languages (input: beat ids in order with primary texts per segment + the segment texts; output `{id, text, on_screen_text, emphasis_words, cue_anchor_words, motion_data_json}` with exactly the same ids); `mode:"deterministic"` for the primary language after an edit: `splitBeatsFallback(newText, previous char shares)`, annotations kept. Validation failure → fallback; `onScreenText` and motion data are then copied from the primary; numeric motion fields (`value`, `from`, `lon`, `lat`, `bars[].value`) of secondary languages are **always** copied from the primary; only display strings are translated.

**6 Fact-check** (`factCheck`, per chapter, cached by receipt fingerprint):
- LLM items → `FactCheckItem{origin:"llm"}`; the LLM sees narration, clip quotes, on-screen strings (`surface:"on-screen"`, `where` = beat id) and title/thumbnail/description.
- **Deterministic items** (`deterministicFactChecks`, `origin:"deterministic"`, `rule`):
  - (a) clip `displayText` ≠ quote verbatim → `quote_mismatch`, high (fix only);
  - (b) a number in narration or on-screen text not equal to any figure value among the cited fact ids (normalising 1.2M / 1,2 million / « 1 200 000 ») → `unsupported`, medium;
  - (c) a segment citing a `sensitivity:"high"` claim without status vocabulary (ATTRIBUTION) → `needs_attribution`, high;
  - (d) a cited claim with a `subjectResponse` not mentioned in the same or next segment → `needs_attribution`, medium;
  - (e) title, thumbnail text or description with ACCUSATORY vocabulary → high;
  - (f) on-screen text (onScreenText, motion data strings, LowerThird role, Stamp text, KeywordSlam text) with ACCUSATORY vocabulary on a beat whose `personIds` are non-empty and whose cited claims are not all in `ESTABLISHED_STATUSES` → high;
  - (g) a segment or overlay using a quote with `verification:"not-found"` → `unverified_quote`, high (fix only: replace with an attributed paraphrase); `fetch-failed`/`unchecked` → medium (gating only under the risk flags of §5.4);
  - (h) a person with `isMinorOrPrivateVictim` named in narration or on-screen text, or a `publicFigure:false` person named without `person-ack` → `private_person_named`, high.
- **Stable ids** `factCheckId(where, sentence, claimKind, origin)` = `FC-<sha8(where|normWord(sentence)|claimKind|origin)>`; a re-run carries over `resolution` and `note` from the previous fact-check for matching ids.
- `dismiss` on a high item requires a note and counts as acknowledgement; `rewritten` is set by "Apply rewrite" (which edits the script or on-screen text through `writeDoc` and triggers an incremental re-check).
- `engine.writeDoc` on a script or slices document runs `lintScript` + `deterministicFactChecks` synchronously (free) and returns the issues to the editor.

### 6.4 Wire schemas and mappers (`packages/llm/src/wire/`)

Port `$SP/script-pipeline/schemas.ts` (use `import { z } from "zod"`) with these changes:
- `StyleSuggestionWire.topic_type`: the enum value is **ASCII `"scandal_expose"`** (the prototype's `"scandal_exposé"` would fail the core enum); add `theme_override: { accent: string, backdrop_recipe: enum|"" , texture: enum|"" }`.
- `FactSheetWire`: the prototype `FactSheet`; **no `wikidata_qid`** (resolved in code only).
- `OutlineWire = buildOutlineWire(acts)`: prototype `Outline` with `act: z.enum(acts)` + `story_shape`.
- `ChapterScriptWire`: prototype `ChapterScript` + `title`, `video_title` (first chapter only), segment `subtitle_translation`.
- `ChapterBeatsWire`: prototype `Beat` + `cue_tags: [{type: CueType, word, value}]`; `motion_data_json` stays a string (parsed client-side with `MotionData`, which now requires the fact ref fields).
- `BeatSliceWire = z.object({ chapter_id: z.string(), beats: z.array(z.object({ id: z.string(), text: z.string(), on_screen_text: z.string(), emphasis_words: z.array(z.string()), cue_anchor_words: z.array(z.string()), motion_data_json: z.string() })) })`
- `RerankWire = z.object({ images: z.array(z.object({ index: z.number(), relevance: z.number(), technical_quality: z.number(), has_watermark_or_burned_text: z.boolean(), nsfw: z.boolean(), focal_x: z.number(), focal_y: z.number(), crop_x: z.number(), crop_y: z.number(), crop_w: z.number(), crop_h: z.number(), notes: z.string() })) })` (scores 0–10, coordinates 0–1)
- `PassageWire = z.object({ best_index: z.number(), confidence: z.number(), reason: z.string() })`
- `FactCheckWire`: the prototype `FactCheck`, each item gaining `where: z.string()` and `surface: z.enum(["narration","clip-quote","on-screen","title","thumbnail","description"])`.
- `TranscreateWire = z.object({ display_text: z.string(), subtitle_translation: z.string() })`.
- The prototype `Lang` enum (`fr en es de it pt`) stays in the wire layer for source/quote languages.

**Mapper coercions (normative, `wire/map.ts`):**

| Field | Coercion |
|---|---|
| snake_case keys | → camelCase (except `motionData`, which keeps wire keys) |
| `""` | → `null` where the core field is nullable |
| `energy` | `round`, clamp 1..5 |
| `drama_value` | clamp 0..10 |
| `score` (style ranking) | `v > 1 ? v/10 : v`, clamp 0..1 |
| rerank `relevance`, `technical_quality` | clamp 0..10 → `/10` |
| focal / crop coordinates | clamp 0..1; crop `w,h ≥ 0.05` |
| `est_seconds` | `max(0.5, v)` |
| ids (`S`, `P`, `E`, `N`, `C`, `Q`, segment ids) | trim, uppercase prefix, zero-pad segment numbers; unknown → `LLM_SCHEMA` with the path |
| beat ids | ignored; assigned in code |
| `Claim.asOf` | fact-sheet `as_of` |
| `Quote.verification` / `verifiedBy` | `"unchecked"` / `"none"` |
| cue anchor and emphasis words | → `cueAnchorIdx` / `emphasisIdx` (§4.6) |

Only unrecoverable mismatches (unknown enum values, missing ids) raise `LLM_SCHEMA`; trivially fixable values never cost a paid retry.

### 6.5 Prompt skeletons (`packages/llm/src/prompts/*.ts`)

Port `$SP/script-pipeline/prompts.ts` (`EDITORIAL_RULES`, `RESEARCH_USER`, `FACTSHEET_USER`, `STYLE_USER`, `OUTLINE_USER`, `CHAPTER_USER`, `BEATS_USER`, `FACTCHECK_USER`) verbatim and add:

```text
[SYSTEM, cached, per language]
  You are the head writer of a {style.names[lang]} YouTube documentary channel ({lang}). {promptPack.narratorPersona[lang]}
  EDITORIAL_RULES(lang, asOf)  (+ SAFE_MESSAGING(lang) when riskFlags include suicide_self_harm)
  <style_guide>{promptPack.styleMd}\n{promptPack.guideMd}\n{qualityDirective}</style_guide>
  <fact_sheet>{stableStringify(factSheetWire)}</fact_sheet>
  <outline>{stableStringify(outlineWire)}</outline>          ← cache_control on this last stable block

[USER, chapter, secondary language]  (CHAPTER_USER +)
  <segment_skeleton>{json}</segment_skeleton>
  Write natively in {lang} (transcreation, not translation). Keep EXACTLY these segment ids, types, quote ids and order;
  you may change sentence count inside a segment. Clip segments: keep the verbatim quote in its original language and
  put a natural {lang} subtitle in subtitle_translation (empty if same language). Return the chapter title in {lang}.

[USER, revise]
  <chapter_script>{json}</chapter_script><lint_issues>{issues}</lint_issues>
  Fix every error-level issue with the smallest change that keeps the voice and energy; keep segment ids; return the full chapter.

[USER, beats]  (BEATS_USER +)
  Tag cue_tags from this closed list: HOOK, EMPHASIS, REVEAL, SHOCK, TENSION_BUILD, NUMBER(value), PERSON_INTRO(name),
  PLACE(name), TIME_JUMP(date), QUOTE(source), DOCUMENT, ARTICLE, TWEET, CLIP_REF, LIST, COMPARISON, IRONY, FLASHBACK,
  CHAPTER, SENSITIVE (value "bleep" only for a profanity INSIDE a quoted passage), MONTAGE. `word` = the exact word of the
  beat text it lands on ("" = beat start). REVEAL and SHOCK ≤ 1 per chapter each; EMPHASIS on ≤ 1 beat in 3.
  Every motion graphic that quotes someone, shows a headline or shows a number MUST reference the fact sheet:
  quote_card/tweet_card/comment_pile → quote_id (text = the verbatim quote), headline_stack → source_id per item,
  document_highlight → source_id (+ quote_id for the highlighted passage), counter/money_counter/bar_chart → figure_id.
  Never invent tweets, headlines, document lines or numbers. motion_data_json formats: {visualGrammar.formats}.

[USER, beatslice]
  <beats>[{id, primary_text}]</beats> <segments_{lang}>{id: text}</segments_{lang}>
  Cut each {lang} segment into exactly the same beat ids, in order, as exact contiguous slices that reconstruct the segment.
  Translate on_screen_text and motion_data_json display strings only (never numbers or ids); give emphasis and cue anchor words in {lang}.

[USER, factcheck]  (FACTCHECK_USER +)
  <narration>[{where, sentence}]</narration> <on_screen>[{where (beat id), text}]</on_screen> <publish>{title, thumbnail, description}</publish>
  Check on-screen text with the same rigour as narration: a card, stamp or lower third is a publication.

[USER, rerank]  ("Image 1:", <img>, … then text)
  Beat narration: "{text}". Wanted visual: "{visualQuery}" ({visualKind}). Provenance identity hint: {identityHint}.
  Do NOT identify people from their faces; judge only relevance to the wanted visual and technical quality.
  Score each image: relevance 0-10, technical quality 0-10, watermark/burned-in text, NSFW, best 16:9 crop and focal point (normalised).

[USER, passage]
  Quote to find: "{verbatim}". Candidate transcript windows: [{index, text, startMs, endMs}]. Pick the window that
  contains the quote as spoken (wording may differ slightly in ASR).
```

### 6.6 Script budget and lint (deterministic; port `$SP/script-pipeline/budget-and-lint.ts`)

```
planBudget(minutes, lang, profile, shapeId, voiceCps?)
  runtimeSec = minutes·60; narrationSec = runtimeSec·narrationShare; cps = voiceCps ?? profile.charsPerSec[lang]
  chars = round(narrationSec·cps); words = round(chars / avgCharsPerWord[lang])   (en 5.6, fr 5.7)
  chapters = minutes < 5 ? max(2, round(runtimeSec/30)) : max(5, round(runtimeSec / mean(chapterSec)))   (demo 1.5 min → 3)
  perAct[act] = round(words · act.share); beatsApprox = round(narrationSec / 3.2)
  DRAMA EN golden: 15 min → 2,174 words / ≈231 beats; 20 → 2,899 / ≈307; 30 → 4,349 / ≈461
```

`lintScript` rules (prototype rules + new):

| rule id | level | check |
|---|---|---|
| banned-opener | error | BANNED_OPENERS[lang] in the first 60 s |
| and-then-chain | warn | ≥ 2 consecutive sentences starting with "and then / then / et puis / ensuite…" |
| accusatory-unattributed | error | ACCUSATORY[lang] without ATTRIBUTION[lang] in the same sentence |
| number-without-fact | error | a digit in narration with empty `factIds` |
| device-gap | warn | more than `maxGapNoDeviceSec` without a device or clip |
| hook-too-long | warn | cold-open chapter longer than `hookMaxSec` |
| length-off-target | warn | chapter chars outside ± 12 % of `targetSec·cps[lang]` |
| sentence-length | warn | chapter mean sentence length outside `sentenceWords` |
| adbreak-no-cliffhanger | error | an `adBreakAfter` chapter does not end on cliffhanger, open_loop or re_hook |
| loop-unpaid / loop-order / teaser-unpaid | error / warn / error | loops and teasers |
| clip-quote | error | clip `quoteId` unknown, or `displayText` ≠ verbatim (whitespace-normalised) |
| clip-translation | error | quote language ≠ script language and `subtitleTranslation` empty |
| clip-commentary-follows | error | a clip segment not followed by a narration segment in the same chapter |
| clip-share | warn / error | estimated clip seconds > 10 % / 15 % of the runtime |
| banned-phrase | warn | `scriptProfile.bannedPhrases[lang]` |
| fr-typography (autofix) | — | « » with U+202F inside; `:;!?` preceded by U+202F (FR); apostrophes → ’ in displayText only |
| status-wording | error | a cited claim with status ∈ {allegation, denied_allegation, charged_pending, under_investigation, civil_claim_pending, appeal_pending, rumor_unverified} and no ATTRIBUTION vocabulary |
| private-person | error | a person with `isMinorOrPrivateVictim` named in narration |
| lang-parity | error | `validateLangParity` (secondary languages) |

### 6.7 Multi-language (FR + EN)

- One outline in `primaryLang` with language-neutral ids; per-language budgets (`Outline.budgets`). Scripts are written natively per language with identical segment skeletons. Clip quotes keep their original-language audio, with `subtitleTranslation` burned in and labelled `TRADUCTION`/`TRANSLATED`.
- `displayText` ≠ `ttsText` (§8.2); a per-project lexicon handles foreign names.
- The visual plan is shared; beat texts are per language; assets are shared (keyed by beat id); timelines, mixes, renders and exports are per language.

### 6.8 Defamation and accuracy safeguards (where each is enforced)

| Safeguard | Where |
|---|---|
| Registry contains only URLs the API returned | `runResearch` |
| Items citing unknown sources go to gaps | `buildFactSheet` checks |
| Quote verification against the fetched page or a YouTube passage | research stage; assets stage (video) |
| Claim status, jurisdiction, `as_of`, subject response | FactSheet schema |
| EDITORIAL_RULES in every writing prompt (FR conditionnel journalistique, « mis en examen » ≠ « condamné », UK repetition rule, loi 1881 bonne foi, art. 9-1 C. civ.) | prompts |
| Unattributed accusations, status wording, private persons | `lintScript` errors; free re-lint on every script PUT |
| **On-screen quotes, headlines, numbers bound to Q/S/N refs**, filled from the FactSheet | `validateBeats` + `fromMotion` |
| Fact-check over narration, on-screen text, title/thumbnail/description, deterministic rules a–h | factcheck stage |
| **Human acknowledgement**, re-armed when the script or on-screen text changes (staleness) | gate `factcheck-ack` before final voice, recording import, render, export |
| `--yes` never satisfies editorial gates | `engine.approve` |
| No photorealistic AI images of real people | `validateBeats`; fal prompt denylist + photoreal-word ban + non-photoreal suffix; `validatePick` on every pick/override/upload; `SourceLabel{illustration}` on every AI image |
| Minors and private persons never named or shown; non-public persons only after `person-ack` | lint, fact-check rule h, `planQueries`, director, `validatePick` |
| Freshness of pending statuses | gate `recheck` |
| Inauthentic-content protection | thesis confirmation; commentary-follows-clip lint; user-voice option; synthetic-voice label |

### 6.9 Fixtures (`fixtures/tulip-mania/`, W2) and `FixtureLlm`

- `FixtureLlm.structured(req)` reads `fixtures/<id>/llm/<step>[.<key>].json` and validates it with `req.schema`; missing → `FIXTURE_MISSING`. `FixtureLlm.research()` reads `llm/research.json` = `{dossier_markdown, registry:[{url,title,page_age,fetched,cited,snippets}], searches_used, fetches_used}`. Receipts are `null` (cost 0). The fixture directory is `<repoRoot>/fixtures/<id>` (never `import.meta.resolve`).

```
fixtures/tulip-mania/fixture.json              FixtureManifest {id, title, idea, languages:["en","fr"], primaryLang:"en", targetMinutes:1.5,
                                               styleId:"drama-commentary", asOf:"2026-10-02", seed:1637, autoApproveGates:true}
fixtures/tulip-mania/llm/research.json
fixtures/tulip-mania/llm/factsheet.json         (FactSheetWire)
fixtures/tulip-mania/llm/style.json             (StyleSuggestionWire)
fixtures/tulip-mania/llm/outline.json           (OutlineWire)
fixtures/tulip-mania/llm/chapter.en.CH1.json  chapter.en.CH2.json  chapter.en.CH3.json   (ChapterScriptWire)
fixtures/tulip-mania/llm/chapter.fr.CH1.json  chapter.fr.CH2.json  chapter.fr.CH3.json
fixtures/tulip-mania/llm/beats.CH1.json  beats.CH2.json  beats.CH3.json                   (ChapterBeatsWire, EN)
fixtures/tulip-mania/llm/beatslice.fr.CH1.json  …CH2  …CH3                                (BeatSliceWire)
fixtures/tulip-mania/llm/factcheck.en.CH1.json …CH3, factcheck.fr.CH1.json …CH3           (FactCheckWire; no high items)
fixtures/gate-test/…                            (W2) a fictional-person fixture (no real names) whose factcheck has 2 high
                                                items + 1 quote_mismatch, a non-public person and a pending claim — used by the safety suite
```

**Content requirements (tulip-mania).** Dutch tulip mania (1634–1637), historical, no living people. ≈ 85 s: CH1 cold open (≈ 20 s; act `cold_open`) starting at the crash (Haarlem auction, 3 February 1637); CH2 the rise (≈ 35 s); CH3 collapse and reckoning (≈ 30 s), including the historiography nuance (Anne Goldgar's *Tulipmania* (2007) vs Charles Mackay's 1841 account; Mackay's anecdotes carry `status:"disputed"`). At least one each of: `NUMBER` (a `money_counter` in guilders `NLG` with `figure_id` → a figure with `as_of` and a source), `PERSON_INTRO` (Carolus Clusius), `PLACE` (Haarlem `map_route` with lon/lat), `TIME_JUMP` ("February 1637"), `DOCUMENT` (`document_highlight` kind `pamphlet` with `source_id`, the 1637 Waermondt–Gaergoedt dialogue), `REVEAL`, `SHOCK` (energy 5, 1–3-word onScreenText), `EMPHASIS`, a `music_breath` segment (2000 ms), and a chapter with `ad_break_after:false`. **No clip segments** (clip paths are covered by director/layout unit fixtures). Sources are real public pages (Wikipedia "Tulip mania", the Goldgar book page, Mackay 1841 on Project Gutenberg). EN and FR written natively with identical skeletons.

Golden test (`pnpm --filter @docmaker/llm test`): every fixture file parses with its wire schema and mapper; `lintScript` 0 errors; `validateBeats` 0 errors and no downgrades; FR/EN parity; `deterministicFactChecks` yields no high item for tulip-mania and the expected items for gate-test.

---

## 7. Asset system (`@docmaker/assets`, W3)

### 7.1 Package layout

```
packages/assets/src/
  index.ts
  http.ts            HttpClient: offline refusal (OFFLINE before any socket), per-host UA (userAgentFor), header timeout 10 s,
                     p-retry (3, honours Retry-After), response cache (TTL), SSRF guard, streaming size caps
  quota.ts           token buckets per provider (per-min/hour/day) persisted in <home>/cache/http/quota.json
  license.ts         LicensePolicyEngine + per-provider licence mappers + attributionText builder
  validate.ts        validatePick (licence, AI + people, stock look-alikes, private persons) — the ONE server-side pick check
  denylist.ts        buildAiDenylist, checkFalPrompt
  cache.ts           FrozenCache: blobs, index.json LRU, linkIntoProject, gc
  conform.ts         conformImage / conformVideo / conformClip / conformAudio (+ analysis: grayscale, luma, year, lowRes)
  freeze.ts          freezeFile
  providers/{openverse,wikimedia,internet-archive,nasa,loc,pexels,pixabay,brave,fal,local,procedural}.ts
  youtube/{ytdlp.ts, json3.ts, passage.ts, clips.ts, manual.ts, probe.ts}
  entities.ts        resolveEntity (wbsearchentities, keyless)
  verify.ts          verifyQuotes (readability + linkedom)
  plan.ts            planQueries, shotsNeeded
  rank.ts            metadataScore, dHash dedupe, optional CLIP (M3), fuse with Reranker scores, needsVisionRerank
  pick.ts            pickAssets (shots needed, reuse penalty)
  stage.ts           resolveAssets (the assets stage minus SFX and music)
  live.ts            liveSearch (server-side record cache for freeze), freezeCandidate
  upload.ts          importUpload, importLocalDir (declaration required)
  ledger.ts          ledger upsert, buildCredits (joins usage), YouTube-description block
```

### 7.2 Providers (v1)

All implement `AssetProvider` (§4.17). Limits are what we enforce, at or below the published limits.

| id | M | Kinds | Key (env) | Search | Limits | Licence mapping |
|---|---|---|---|---|---|---|
| `procedural` | M1 | image, video | none | always available; deterministic lavfi recipes (§7.9) seeded by `fnv1a32(beatId+":"+slot)`, palette from style tokens | — | `PROCEDURAL` |
| `local` | M1 | image, video, audio | none | `docmaker assets import <slug> <dir> --declare …` builds `assets/local-index.json` (path, sha256, kind, filename tokens, tags, **declaration**); search = token match | — | from the `UploadDeclaration`: own-work → `USER-OWNED`; licensed → the declared code; third-party-quotation → `UNKNOWN` + `editorial-only` + `fair-use-user-risk`; ai-generated → `AI-GENERATED` + `synthetic`. **Never defaulted.** |
| `openverse` | M2 | image (audio for music) | none (optional `OPENVERSE_CLIENT_ID/SECRET` → token via `POST /v1/auth_tokens/token/`, form-encoded) | `GET https://api.openverse.org/v1/images/?q=&license_type=commercial,modification&aspect_ratio=wide&size=large&mature=false&page_size=20`; person beats query the name | anonymous 20/min, **200/day** (persisted) | `license`+`license_version` → CC codes; `attribution` → `attributionText`; `foreign_landing_url` → `sourcePageUrl` |
| `wikimedia` | M2 | image | none (contact UA, §17.2) | identity: `haswbstatement:P180=<QID>` via `generator=search&gsrsearch=…&gsrnamespace=6`; generic: `gsrsearch=<q> filetype:bitmap`; both with `prop=imageinfo&iiprop=url\|size\|mime\|extmetadata&iiurlwidth=768&iiextmetadatafilter=LicenseShortName\|UsageTerms\|AttributionRequired\|Artist\|Credit\|LicenseUrl\|DateTimeOriginal\|ImageDescription\|Restrictions`; originals > 3840 px → `thumburl` at `iiurlwidth=3840` | 200/min, concurrency ≤ 3, `Retry-After`; 20 s back-off on 429 | `LicenseShortName` parse; `Artist` HTML stripped; `Restrictions: personality` → `personality`; `DateTimeOriginal` → `analysis.year` |
| `internet-archive` | M2 | video, image | none | `advancedsearch.php?q=(<terms>) AND mediatype:(movies OR image)&fl[]=identifier&fl[]=title&fl[]=licenseurl&fl[]=collection&rows=50&output=json` → `metadata/<id>`; `.mp4` (h.264) ≤ 1080p or `.jpg` | 30/min | publicdomain → PDM; CC → mapped; missing → `UNKNOWN` + `unknown-rights` |
| `nasa` | M2 | image, video | none | `images-api.nasa.gov/search?q=&media_type=image,video` → asset manifest (`~orig.jpg`, `~orig.mp4`/`~mobile.mp4`) | 60/min | PDM + `no-endorsement` |
| `loc` | M2 | image | none | `www.loc.gov/photos/?q=&fo=json&c=25`; largest `image_url[]` ≤ 3840 | **15/min** (LOC blocks 1 h above 20/min) | "No known restrictions…" → PDM; else `UNKNOWN` |
| `pexels` | M2 | image, video | `PEXELS_API_KEY` | `api.pexels.com/v1/search?query=&orientation=landscape&size=large&per_page=20`; `/v1/videos/search` (`hd`, width ≤ 1920, fps ≤ 30); header `Authorization` | 200/h, 20k/month | `PEXELS`; `no-bad-light`, `trademark`, `no-redistribution` |
| `pixabay` | M2 | image, video | `PIXABAY_API_KEY` | `pixabay.com/api/?key=&q=&image_type=photo&orientation=horizontal&safesearch=true&per_page=30`, `/api/videos/` (`medium` = 1080p); `largeImageURL` | 100/60 s; **24 h response cache**; download, never hotlink | `PIXABAY`; `no-bad-light`, `no-redistribution`; reject "Content ID registered" music |
| `youtube` | M2 (download M3) | video (clips) | none (local) | §7.7 | `-t sleep` | `YOUTUBE-FAIR-USE` + `fair-use-user-risk`; commercialOk=false (allowed by `allowYoutubeFairUse` + acknowledgement) |
| `brave` (paid) | M3 | image | `BRAVE_API_KEY` | `api.search.brave.com/res/v1/images/search?q=&count=50&safesearch=strict`, `X-Subscription-Token` | 1 req/s; cost gate ($5/1k); excluded from live search unless `allowPaid` | `UNKNOWN` + `unknown-rights`, `editorial-only`; on beats with `personIds` also `may-be-manipulated` (UI warning "may be manipulated — verify the source"); needs `allowUnknownEditorial` |
| `fal` (paid) | M3 | image | `FAL_KEY` | `POST queue.fal.run/fal-ai/flux/schnell` `{prompt, image_size:"landscape_16_9", num_inference_steps:4, seed, enable_safety_checker:true}` → poll `status_url` → `response_url` (plain fetch) | cost gate; receipts | `AI-GENERATED` + `synthetic`. Refuses (§7.4): beats with `personIds` or `PERSON_INTRO`/`SENSITIVE` cues; prompts matching the denylist or photoreal vocabulary. |

Out of v1 (R20): Unsplash, Freesound, Flickr, Jamendo — `docs/EXTENDING.md` lists the contract-change steps for a new provider (enum value, `PROVIDER_PRIOR`, `planQueries` row, licence mapper, ledger group).

### 7.3 The assets stage (`resolveAssets`; the engine prepares SFX and music first)

```
engine assets stage:
  sfx   = audio.ensureSfxPack(each project.audio.sfxPacks)                         // global cache, once, machine lock
  music = prepareMusic(project, plans)                                            // ENGINE: per used mood → audio.generateMusic | audio.scanMusicLibrary
                                                                                  //   → assets.freezeFile → assets/music.json (MusicTrack, exact grids)
  out   = assets.resolveAssets({ plans, facts, entities, style, primaryScript, userPicks, previous, reranker, personAcks }, ctx)

resolveAssets:
  for beat in plans (order), skipping CLIP beats:
     if visualKind ∈ {motion_graphic, text_card, social_post, document_screenshot, map} and template ≠ none (except photo_burst):
          needs = one optional background slot (generic texture query, may be satisfied by a `generated` source)
     queries = planQueries(beat, facts, entities, style, personAcks)                 // table below
     records = ⋃ provider.search(q) over enabled+configured providers in priority order until ≥ maxCandidatesPerBeat
               (offline → local + procedural only; token buckets; failures logged, not fatal)
     records = dedupe (same providerAssetId; dHash 64-bit 9×8 grey, Hamming ≤ 6)
     records = filter(policy.evaluate(license, beat).allowed) and peopleRule(beat)
     scored  = rankCandidates(metadata [+ CLIP M3] [+ vision when needsVisionRerank(beat, top, project.assets.visionRerank)])
     picks   = pickAssets(scored, shotsNeeded(beat), recentUse)
     freeze each pick (fetchOriginal → conform → cache → media/) — failure ⇒ next candidate; `validatePick` must return no error
     none left ⇒ procedural (always succeeds)
  clips = resolveClips(primary clip segments, facts.quotes) ⊕ userPicks.clips (manual resolutions win)   // §7.7
  merge: for each (beatId, slot) a user pick wins if its planKey matches the beat's; else it goes to `orphans`
  write (stage-owned only): candidates/<beatId>.json, picks.json, frozen.json, ledger.json, clips/<segmentId>.json
```
The stage never writes `user-picks.json` (user input) and never writes usage (that is `direct`'s `timeline/<lang>.usage.json`).

**Query planning (`planQueries`).** Persons with `isMinorOrPrivateVictim` are never queried by name or QID; persons with `publicFigure:false` only after `person-ack`; under `riskFlags ∋ minors` identity searches are skipped for persons flagged minor.

| visualKind | Provider order | Query |
|---|---|---|
| archival_photo with personIds | wikimedia (P180 QID) → loc → openverse | the person's name (+ `localText`); **stock excluded** |
| archival_photo without people | wikimedia → loc → openverse → internet-archive → nasa | visualQuery |
| news_footage | internet-archive → pexels(video) → pixabay(video) | visualQuery (YouTube only via clips) |
| stock_broll | pexels(video) → pixabay(video) → internet-archive → nasa → openverse(image) | visualQuery |
| youtube_clip | `resolveClips` | the quote |
| ai_illustration (no personIds, no PERSON_INTRO/SENSITIVE cue) | fal → procedural | visualQuery + the fixed non-photoreal suffix (§7.4) |
| others (graphics) | procedural / generated background | — |

`shotsNeeded(beat) = clamp(round(estSeconds / (targetAslSec · aslMul(beat))), 1, 4)` where `aslMul` applies `hookAslFactor`, `aslMul.byEnergy[energy−1]` and the cue multipliers (§9.3); `photo_burst` → `count` image slots; breath beats and beats with a `MONTAGE` cue → 4; `split_compare` → 2.

### 7.4 Licence policy, people rules, AI denylist, `validatePick`

`LicensePolicyEngine.evaluate(license, beat) → {allowed, reasons, flags}`:

| Licence or restriction | Monetized | Personal |
|---|---|---|
| CC0, PDM, PROCEDURAL, USER-OWNED (declared) | allow | allow |
| CC-BY | allow (attribution → ledger) | allow |
| CC-BY-SA | allow if `allowShareAlike`; flag `sa` | allow |
| any NC | **deny** unless `allowNonCommercial` | allow |
| any ND | deny unless `allowNoDerivatives` (we crop and zoom) | deny unless allowed |
| PEXELS / PIXABAY | allow; flag `no-bad-light` | allow |
| UNKNOWN | deny unless `allowUnknownEditorial`; flag `editorial-only` | same |
| YOUTUBE-FAIR-USE | allow only if `allowYoutubeFairUse && fairUseAcknowledged`; flag `fair-use-user-risk` | same |
| AI-GENERATED | allow if `allowAiGenerated` **and the beat has no personIds** | same |
| restriction `personality` | allowed; flagged in UI and credits | |

**People / bad-light rule:** PEXELS/PIXABAY/UNKNOWN candidates whose tags or title match `/\b(man|woman|men|women|person|people|portrait|boy|girl|face|crowd|couple)\b/i` are excluded for beats with `personIds` and for beats whose cues include `SHOCK`, `SENSITIVE` or `REVEAL` (stock look-alikes never stand in for real people in a negative context).

**`validatePick` (the ONE server-side check).** Called by the assets stage for every auto pick, by `engine.writeDoc` for `user-picks.json` (each new or changed pick), by `engine.freeze`/`engine.upload`, and by the director (through `validateAsset`) for every on-screen asset including `replaceSource` overrides — where errors are lint errors (`POLICY`), never silent drops. Errors: the licence verdict is deny; `AI-GENERATED` on a beat with `personIds` or a PERSON_INTRO/SENSITIVE cue; a stock look-alike on a person/negative beat; any asset on a beat that names a `isMinorOrPrivateVictim` person in a portrait slot; a `publicFigure:false` person's portrait without `person-ack`. The client never supplies licence data: the freeze route takes `{beatId, slot, provider, providerAssetId}` and the server re-derives the `Candidate` from `assets/candidates/<beatId>.json` or the live-search record cache.

**AI-image denylist (fal).** `buildAiDenylist(facts, entities)` = `normWord` tokens (≥ 3 chars) of every person's full name, each name token, Wikidata aliases and quote speakers. `checkFalPrompt` rejects a prompt that contains any denylisted token or any of `photo, photograph, photorealistic, realistic, portrait, celebrity, actor, actress, real person`. Accepted prompts get the fixed suffix `", flat editorial illustration, painterly, graphic shapes, no real people, no faces"` and the negative prompt `"photo, photorealistic, face, celebrity, text, watermark"`. fal is disabled for beats with `PERSON_INTRO` or `SENSITIVE` cues. Every AI image on screen gets `SourceLabel{kind:"illustration"}`.

### 7.5 HTTP, SSRF, frozen cache, conform recipes

**HTTP (`http.ts`).**
- `config.offline` → every method throws `DocmakerError("OFFLINE")` **before** resolving DNS or opening a socket.
- Only `https:` (plus `http:` for `ccmixter.org`); DNS-resolve and reject loopback, private, link-local, CGNAT and multicast (v4 and v6); re-check every redirect (≤ 5); header timeout 10 s; streaming body caps 256 MiB (images/audio), 2 GiB (video).
- `User-Agent: userAgentFor(url, config)` — the contact only for `CONTACT_UA_HOSTS`.
- Proxies: processes are started with `NODE_USE_ENV_PROXY=1` when a proxy variable is set; TLS verification is never disabled.

**FrozenCache.** `put(file) → sha256`; blob at `<home>/cache/blobs/<aa>/<sha256>.<ext>`; `index.json` (`CacheIndex`) keeps `{sha256, bytes, lastUsed}`; LRU eviction above `cacheCapBytes()` = `min(DOCMAKER_CACHE_MAX_GB ?? 20 GiB, 50 % of free disk)`; blobs referenced by any project's `frozen.json` are never evicted; `linkIntoProject` hardlinks `media/<id>.<ext>` (copy fallback).

**Conform recipes** (the recipe version is part of the asset id, which hashes the conformed output). Every recipe also computes `analysis` (sharp `stats()`: `grayscale` when the mean channel spread < 6/255; `meanLuma`; `year` from EXIF/provider date; `lowRes` when width < 1280).

| Recipe | Command | Output |
|---|---|---|
| `image-v1` | sharp `.rotate()` (EXIF) → long edge ≤ 2880 (no upscaling) → JPEG q90 (PNG with alpha) | `.jpg`/`.png` |
| `video-cfr-v1` | `ffmpeg -ss <in − handleHead> -to <out + handleTail> -i src -vf "fps=<fps>,scale='min(1920,iw)':-2:flags=lanczos,format=yuv420p" -c:v libx264 -preset veryfast -crf 18 -g <fps> -keyint_min <fps> -sc_threshold 0 -movflags +faststart -an`; handles default 1000 ms each side (clamped to the source); `sourceInMs/sourceOutMs` record the trimmed range in the original | `.mp4` (muted b-roll) |
| `clip-v1` | as `video-cfr-v1` with `-c:a aac -b:a 192k -ar 48000 -ac 2` and **two-pass loudnorm to −18 LUFS** (`twoPassLoudnorm`, linear); trimmed to the passage **plus 1000 ms handles**; `ClipResolution.passageInMs/passageOutMs` = the passage inside the conformed file | `.mp4` with audio |
| `audio-norm-v1` | `-ar 48000 -ac 2 -c:a pcm_s16le` + two-pass loudnorm −18 LUFS, TP −1.5 | `.wav` |
| `proc-image-v1` / `proc-video-v1` | §7.9 output through the normal conform path | `.jpg` / `.mp4` |

Every clip and b-roll is transcoded to CFR H.264 (yt-dlp and IA return AV1/VP9/VFR; AV1/H.265 silently fall back to OffthreadVideo). `keepSourceDownloads:false` deletes full-source YouTube downloads after conform.

### 7.6 Ranking and picking

```
textMatch  = weighted token overlap(visualQuery tokens, title×2 + tags×1.5 + description×1), normalised by the beat's max
resolution = image: clamp01((min(w,3840) − 960) / 960); video: w ≥ 1920 → 1, ≥ 1280 → 0.6, else 0.2
aspect     = 1 − min(1, |ln((w/h)/(16/9))| / ln 2)       (portraits are fine for the `card` layout: aspect weight halves when the
                                                        style's card share > 0)
durFit     = video: dur ≥ beatDur + 2 s (handles) → 1; ≥ 0.5·beatDur → 0.6; else 0.2. image: 1
prior      = PROVIDER_PRIOR[visualKind][provider] ∈ [0,1]  (rank.ts table; archival_photo: wikimedia 1, loc .9, openverse .7, ia .6, pexels .2)
metadata   = .45·textMatch + .20·resolution + .10·aspect + .10·durFit + .15·prior
with CLIP  : replace .45·textMatch by .20·textMatch + .25·clipSim01  (M3)
with vision: total = .60·(relevance/10)·(watermark ? .5 : 1)·(nsfw ? 0 : 1) + .25·metadata + .15·(technical/10); else total = metadata
reuse      : total −= .30 per use of the same asset within the last 6 beats; identity-specific beats are exempt
```
- `needsVisionRerank(beat, top, mode)`: `all` → always (with a key); `selective` → beats with `personIds`, `archival_photo`/`news_footage` beats, or when the top-2 metadata scores are within 0.05; `off` → never. Rerank focal and safe crop are stored in `AssetPick`; identity never comes from vision.
- **CLIP (M3)** runs only after `docmaker setup --clip` installed `@huggingface/transformers@4.3.0` into `<home>/ml` (with `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`), loaded with `createRequire(<home>/ml/package.json)`; never a workspace dependency.

### 7.7 YouTube (local yt-dlp) — `youtube/*`

**Binary:** `<home>/py/.venv/bin/yt-dlp` (pinned `yt-dlp[default,curl-cffi]==2026.08.19`), else `<home>/bin/yt-dlp`, else `TOOL_MISSING` (hint `docmaker setup --yt-dlp`). Flags always: `-t sleep --no-warnings --newline`; no Deno on PATH → `--js-runtimes node`; `DOCMAKER_YT_POT_URL` → `--extractor-args "youtube:player_client=mweb" --extractor-args "youtubepot-bgutilhttp:base_url=$DOCMAKER_YT_POT_URL"`; cookies only via `DOCMAKER_YT_COOKIES_BROWSER` (ban-risk warning).

| Operation | Command |
|---|---|
| search | `yt-dlp "ytsearch10:<q>" --flat-playlist -J` (id, title, duration, channel, channel_is_verified, view_count) |
| info | `yt-dlp -J --skip-download <url>` → subtitle track: manual `<lang>` > `<lang>-orig` > `<lang>-<lang>` ASR > translated |
| subs | `yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs "<track>" --sub-format "json3/vtt" -o "<tmp>/%(id)s.%(ext)s" <url>` |
| download (M3) | ≤ 15 min → whole video once, cached by videoId: `-f "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]" -t mp4`; else `--download-sections "*<s−handle>-<e+handle>" --force-keyframes-at-cuts`; progress `--progress-template "download:%(progress._percent_str)s"` |
| probe (doctor) | `yt-dlp -J --skip-download <known public video>` → `ok | bot-check | 403 | missing | offline` |

**Errors** (stderr → code, all non-fatal for the stage; the clip falls back to `clip-narrated`/`clip-card`): `HTTP Error 429` → `YT_RATE_LIMIT` (retry after 60 s, ≤ 2); `Sign in to confirm` → `YT_BOT_CHECK` (hint: residential network, PO token, cookies, or manual import); `HTTP Error 403` → `YT_FORBIDDEN` (datacenter IP; run locally or import manually); `Video unavailable`/`Private video` → `YT_UNAVAILABLE`.

**json3 → words:** events with `segs`: `start = tStartMs + (seg.tOffsetMs ?? 0)`, `end` = next seg start or `tStartMs + dDurationMs`; manual subtitles without offsets split the event duration by characters; drop empty and `"\n"` segs. No transcript but the sidecar exists → `bestaudio` + `asr` (`transcriptKind:"local-asr"`).

**Passage finder:** `normWord` tokens; Smith–Waterman (match +2 if equal or Levenshtein ratio ≥ 0.8 for tokens ≥ 5 chars, mismatch −1, gap −1); `score = matchedQuoteTokens / quoteTokens`; **accept ≥ 0.6**; window = first match − 300 ms to last match + 300 ms, end extended to the next pause ≥ 400 ms within +1.5 s, clamped to `maxClipSeconds` centred on the match. Across the top 5 results (verified channel, views, duration ≤ 30 min preferred) the first ≥ 0.6 wins; top-two within 0.05 → `pickPassage`. Shot-boundary snap ±0.5 s via `cuts.py` or `scdet` when available. `matchScore ≥ 0.8` upgrades the quote's verification (§6.3).

**Manual clips (M2).** `engine.resolveClip` / `POST /api/projects/[slug]/clips/resolve` / `docmaker assets clip <slug> <segmentId> (--url U | --file F) --from mm:ss --to mm:ss [--channel C --title T]` → `resolveManualClip` downloads (URL, yt-dlp) or takes the local file, conforms with handles (`clip-v1`), writes the `ClipResolution{status:"manual", source:"manual-url"|"manual-file"}` into **`user-picks.json`** (user input), plus a ledger entry on the next assets run. The fair-use gate applies. This is the path when yt-dlp is blocked.

Every clip records URL, channel, timecodes and transcript kind in the ledger; the director shows `Source: <channel>, <year>`; the fair-use gate precedes the first download.

### 7.8 Ledger and credits

- `assets/ledger.json` (written only by the assets stage): one entry per frozen asset (provider, licence, author, attribution, YouTube ref, declaration, transformations). Voice licences are added by the engine to the credits (not the ledger) from the active `VoiceTrack.license`.
- `buildCredits({ledger, usage, lang, voice, music, sfx})` → `assets/credits.<lang>.md` (written by the export stage into the bundle and by `docmaker credits`): only assets in the language's `timeline/<lang>.usage.json`; groups Archival (Commons/LOC/IA/NASA) → Stock (Pexels/Pixabay) → Clips (title, channel, URL, timecodes) → Music → SFX → **Voice** (provider, voice, licence; Piper `CC-BY`/`CC-BY-SA` attribution lines; ElevenLabs free tier → "non-commercial, attribution required" warning) → AI-generated (labelled) → Fonts (OFL). Line format `"<title>" by <author> — <licence + version> — <sourcePageUrl>`. Ends with a YouTube-description block and an "altered or synthetic content" reminder when AI images or a synthetic voice were used.

### 7.9 Procedural provider (offline, deterministic)

Seed `fnv1a32(beatId + ":" + slot)`; palette `style.tokens.palette` (+ theme accent). **Every recipe is executed by a unit test on the installed ffmpeg** (6.1 verified).

| Recipe | Kind | ffmpeg lavfi |
|---|---|---|
| `gradient-grid` (Moon look) | image | `gradients=s=1920x1080:c0=<ink>:c1=<accent>:x0=0:y0=0:x1=1920:y1=1080:nb_colors=2:seed=<seed>:speed=0.00001, drawgrid=w=150:h=150:t=2:c=white@0.10, noise=alls=6:allf=u` → `-frames:v 1` (**`speed=0` is rejected by ffmpeg 6.1: range [1e-05, 1]**; verified) |
| `archive-still` | image | `color=c=0x6b5b45:s=1920x1080, noise=alls=28:allf=u, colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131, vignette=PI/4` |
| `drift-gradient` | video 8 s | `gradients=s=1920x1080:c0=..:c1=..:c2=..:nb_colors=3:seed=<seed>:speed=0.015:r=<fps>` |
| `life-texture` | video 8 s | `life=s=480x270:mold=10:r=<fps>:ratio=0.08:seed=<seed>:life_color=<accent>:death_color=<ink>, scale=1920:1080:flags=neighbor` |
| `scanline-news` | video 8 s | `gradients…speed=0.01, drawgrid=w=1920:h=4:t=1:c=black@0.25` |

Outputs go through conform → freeze (licence `PROCEDURAL`), so the demo exercises the real still and video paths (video recipes get 1 s handles like any b-roll). When the director needs a background that does not exist as an asset, the Remotion `GeneratedBackdrop` renders it (`generated` source).

---

## 8. Voice (`@docmaker/voice`, W4) and the Python sidecar

### 8.1 Package layout

```
packages/voice/src/
  index.ts
  text/{tts-text.ts, numbers-en.ts, numbers-fr.ts, sentences.ts, calibration.ts}
  providers/{synthetic.ts, elevenlabs.ts, sherpa.ts (kokoro + piper, createRequire), recording.ts, registry.ts}
  align/{estimated.ts, nw.ts, faster-whisper.ts, whisper-cpp.ts (M3), map.ts}
  post/chain.ts           ffmpeg post chain + lead/tail trim + resample 48 kHz mono (WAV I/O from @docmaker/core/node)
  track.ts                synthesizeTrack(): segments → SegmentTake[] (cache, stitching order, cost, take id)
  recording.ts            importRecording(): global (ASR + retakes + NW) | per-segment; pickup TTS
  license.ts              voiceLicense(), tier detection
  calibrate.ts  teleprompter.ts  models.ts
```

### 8.2 Text: spoken text → `ttsText` (+ word mapping)

`buildTtsText(spoken, lang, {lexicon, expandNumbers, stripTags})` (signature in §4.19). **Only the engine calls it**, with `spoken = spokenText(seg, mode)` (§4.18): `displayText` for narration, `subtitleTranslation || displayText` for a narrated clip fallback (an FR narrator reads the French translation of an English quote).
1. Tokenise with `tokenizeDisplay` (§4.5).
2. For each display word, in order: **lexicon** (whole word, case-insensitive unless `caseSensitive`, punctuation preserved → `say`, may be several words); **numbers** when `expandNumbers` (the provider does not normalise; **sherpa Kokoro/Piper: false** — espeak normalises digits; synthetic: true for realistic timing): years 1000–2099 in a year context (after "in/en/since/depuis/de" or standalone) → `year`; `1er/1st/2e/2nd` → ordinal; `12,5`/`12.5` → decimal (FR comma); `1 200 000`/`1,200,000` → cardinal; `€ $ £ ƒ` prefixes or suffixes → "euros/dollars/livres|pounds/florins|guilders"; `%` → "pour cent|percent"; `[tags]` removed when `stripTags` (ElevenLabs v3/v4 tags go only in ttsText, never in captions).
3. `ttsWords` = whitespace tokens of the result, `displayToTts` records each display word's span (empty spans allowed; interpolated timing).

Word timings are produced per tts word and mapped to display words (`start = min`, `end = max` of its tts words; empty spans interpolated, `source:"interpolated"`). Shifted times are clamped to ≥ 0.

### 8.3 Providers

| id | M | Availability | Timing | Notes |
|---|---|---|---|---|
| `synthetic` | M1 | always | `synthetic` (exact) | deterministic formant "speech-like" audio (below); labels the video "SYNTHETIC VOICE"; licence `PROCEDURAL`; the scratch-take provider |
| `elevenlabs` | M2 | `ELEVENLABS_API_KEY` | `provider` | `client.textToSpeech.convertWithTimestamps(voiceId, body).withRawResponse()` (SDK 2.70.0). Body `{text, modelId (default "eleven_multilingual_v2"), languageCode (omitted for multilingual_v2), outputFormat, voiceSettings{stability, similarityBoost, style, useSpeakerBoost:true, speed ∈ [0.7,1.2]}, previousRequestIds: ids.slice(-3), previousText (only without ids), nextText, seed, applyTextNormalization:"auto"}`. One request per narration segment (split at sentence ends above `maxCharsPerRequest`); **sequential within a chapter** for stitching (ids < 2 h old). `outputFormat` `pcm_44100` (Pro tier), on a tier 4xx fall back to `mp3_44100_128` + ffmpeg decode, shifting words by the MP3 priming offset when the onset differs from the first alignment char by 15–60 ms. Words from `alignment` (not `normalized_alignment`) via `charAlignmentToWords()` (port `$SP/tts/node/voice.ts`); request id from the `request-id` header. `voiceId:"auto"` → `client.voices.search({pageSize:100})` → first premade voice whose `labels.language` matches, else the first labelled `narration`. **Tier** from the user/subscription endpoint → `TtsCapabilities.tier`; free tier + `licensePolicy.mode:"monetized"` → warning + attribution line. **Cloned voices** (`category` cloned/professional) require `VoiceSettings.cloneConsent`; a voice whose name matches a FactSheet person (denylist tokens) is refused. eleven_v3 has no stitching. |
| `kokoro` | M2 | `sherpa-onnx-node` + `<home>/models/kokoro/kokoro-multi-lang-v1_0/` | `estimated` (or `aligned`) | loaded with `createRequire(import.meta.url)("sherpa-onnx-node")` (re-verified under pnpm by W4, off the demo path). Port `$SP/tts/node/sherpa_kokoro.js`: `OfflineTts({model:{kokoro:{model, voices, tokens, dataDir:espeak-ng-data, lexicon: en ? lexicon-us-en.txt (gb for b* voices) : "", lang: en ? "" : "fr"}, numThreads: 4, provider:"cpu"}, maxNumSentences:1})`; one sentence at a time, trim each sentence's silence (< −45 dBFS RMS, 10 ms windows, keep 30 ms), concatenate, record sentence boundaries. EN `16` am_michael (default), `3` af_heart, `26` bm_george; FR **only `30` ff_siwis**. RTF ≈ 0.21; 24 kHz. Licence Apache-2.0 model, voices as published (recorded in `VoiceInfo.license`). Runs only in the job worker (sync CPU work). |
| `piper` | M2 | sherpa + `<home>/models/piper/<voice>/` | `estimated` / `aligned` | `{vits:{model, tokens, dataDir}}`. FR `fr_FR-gilles-low` (CC0, default), `fr_FR-siwis-medium` (**CC-BY** → attribution), `fr_FR-upmc-medium` (**CC-BY-SA**); EN `en_US-john-medium` (PD, default), `en_US-joe-medium` (CC0), `en_GB-cori-high` (PD). **Never offered:** `en_US-ryan-*`, `hfc_*`, l2arctic, semaine, lessac (NC/research); `fr_FR-tom` flagged (AGPL dataset). 22.05 kHz. |
| `recording` | M2 | user files | `aligned` | §8.6; licence `USER-OWNED` (the user's own voice) |

**Synthetic VO** (`synthetic.ts`; deterministic; what lets the demo run with nothing installed). Voices `synthetic-m1` (f0 110 Hz) and `synthetic-f1` (f0 190 Hz).
```
t = 120 ms
for each tts word w (index i), sentence index s:
  dur  = clamp(1000·(chars(w)+1)/cps, 140, 900) ms           // cps = voice.charsPerSec ?? style cps (16.5 en / 16.0 fr)
  syl  = max(1, count of [aeiouyàâäéèêëîïôöùûüœ] groups in w)
  for each syllable j (equal split of dur):
     (F1,F2) = VOWELS[rngFor(seed, w+i+j) → index], VOWELS = [(730,1090),(270,2290),(300,870),(530,1840),(570,840),(440,1020)]
     src  = Σ_{h=1}^{⌊4000/f0⌋} sin(2π·h·f0·(1+0.04·sin(2π·5t))·declination(s,t))/h       // band-limited saw, 5 Hz vibrato
     out  = 0.6·biquadBandpass(src, F1, Q=8) + 0.4·biquadBandpass(src, F2, Q=10) + 0.02·white
     env  = attack 15 ms, release 40 ms, 30 % dip between syllables
  words[i] = {startMs: t, endMs: t + dur}; t += dur + 60 ms + pause(punct)  // ",;:" +180 ms, ".!?…" +380 ms
write 48 kHz mono s16 (core writeWav); normalise RMS to −20 dBFS (the layout stage brings the program to −16 LUFS)
```
Synthesis runs in a `worker_threads` worker when called from the job worker (it yields the event loop every segment otherwise).

### 8.4 Post chain (`post/chain.ts`)

Filters validated in `$SP/tts/audiopost.sh`:
1. Decode/resample to **48 kHz mono s16**. Raw ElevenLabs PCM is `-f s16le -ar 44100 -ac 1`.
2. **Lead trim**: `silencedetect=n=-50dB:d=0.05` on the head; cut keeping a 30 ms pad; set `leadTrimMs`; shift every word by −leadTrimMs (clamped ≥ 0). Tail trimmed likewise. **Internal pauses are never compressed** (timings would break).
3. Filters — TTS: `highpass=f=80, deesser, acompressor=threshold=-18dB:ratio=3:attack=5:release=60, equalizer=f=250:t=q:w=1:g=-3, equalizer=f=3000:t=q:w=1:g=2.5`; recordings: the same with `afftdn` after the highpass.
4. No per-segment loudness normalisation (the program is normalised once, §11.4).

Segment cache key: `sha256(provider|voiceId|modelId|settingsHash|ttsTextHash|prevIdsKey|POST_CHAIN_VERSION)` (`SegmentTake.cacheKey`), files in `voice/<lang>/.segcache/`. The **take id** is `takeIdFor(kind, provider, voiceId, settingsHash, sorted cacheKeys)` = `<kind>-<sha12(…)>`, so an all-cache-hit re-run reproduces the same take.

### 8.5 Aligners

| id | M | Requires | Method |
|---|---|---|---|
| `estimated` | M1 | nothing | within each known sentence span (sherpa boundaries) or the whole segment, word times ∝ `chars+1` (+0.5 for a trailing comma) |
| `faster-whisper` (default ASR) | M2 | sidecar venv | `runSidecar("asr", {audio, lang, model:"large-v3-turbo", initialPrompt: names, vad:true, beamSize:5, computeType:"int8", threads:4, modelsDir})` → words → `alignScriptToTranscript` (Needleman–Wunsch: match +2, mismatch −1, gap −1, accent-insensitive `normWord`; interpolation for unmatched). Measured RTF 0.21; word MAE ≈ 77–87 ms. |
| `whisper-cpp` (no-Python fallback) | M3 | `@remotion/install-whisper-cpp@4.0.532` → `installWhisperCpp({to:<home>/models/whisper/cpp, version:"1.8.2"})`, `downloadWhisperModel({model:"small"})` | `transcribe({inputPath: ABS 16 kHz mono s16 wav, model:"small", tokenLevelTimestamps:true, additionalArgs:["-nfa"], language})`; **always `-nfa`**; **never `splitOnWord:true`**; word start = first-token `t_dtw − 120 ms`, end = last-token `t_dtw`; then NW. Never `.en` models for FR. |
| `elevenlabs-forced` (optional, paid) | M3 | key | `client.forcedAlignment.create({file, text})` (≈ $0.22/h) |

**Track QA:** with an ASR available, WER per segment (EN word-exact after number normalisation; FR similarity ≥ 0.92); failures listed in `VoiceTrack.notes`; `--retry-bad` re-synthesises them once with a different seed.

### 8.6 User recording import (`docmaker voice import`, web upload) — M2

Two modes (`ImportRecordingInput.mode`):
- **`global`** (one or more long files): files → `voice/<lang>/recordings/`; 48 kHz mono + recording post chain; ASR (faster-whisper, else whisper-cpp, else `TOOL_MISSING` with hint `docmaker setup --python`); **retake detection** (word 4-grams repeated within 30 s → keep the last occurrence); NW of all tts words of the language (narration + clip-narrated, script order) against all ASR words (files in name order); confidence ≥ 0.5 anchors sentences; segment boundaries at the midpoint of the silence between the last word of segment *k* and the first of *k+1* (`silencedetect`); segments with < 50 % matched words → `missingSegmentIds`.
- **`per-segment`** (re-recording or the M3 teleprompter recorder): files named `<segmentId>.<ext>` or uploaded per segment (`voice/<lang>/recordings/<segmentId>-<n>.<ext>`) map directly to their segment (no global NW; ASR + NW within the segment only). The new take = the previous take with these segments replaced (new deterministic take id).
- **Missing segments:** if `missingSegmentIds` is non-empty, layout fails with `ANCHOR_MISSING` listing them — unless `VoiceSettings.pickupProvider` is set (or the job option `pickupTts`), in which case those segments are synthesised with that provider (`SegmentTake.pickup:true`), a `pickup` marker is added and the director shows `SourceLabel{kind:"pickup-tts"}` over them.
- **Edited after recording:** `editedAfterTake(script, take)` lists segments whose current `ttsText` hash differs from the take's; for a `recording` take, render and export are blocked (`GATE_REQUIRED`, reason "re-record N edited segments") unless the user re-records them, enables pickup TTS for them, or forces with an explicit acknowledgement.
- Ad-libs not in the script stay in their segment's audio; their words are not captioned (R9).
- Recording takes are **final** takes: gated by `factcheck-ack` (not stale) and `person-ack`.

### 8.7 Calibration, teleprompter, models

- `calibrateVoice(lang, voice)` synthesises a fixed ≈ 600-character paragraph per language (`text/calibration.ts`), measures speech-only duration (pauses ≥ 250 ms excluded) and stores `charsPerSec` in `project.voice[lang]`; outline budgets then use it.
- `teleprompterHtml(script, {cps, mirror, lang})` → `voice/<lang>/teleprompter.html`: large type, segment ids as anchors, `ttsText`, devices as stage directions, auto-scroll at the calibrated cps, mirror toggle, out-of-date segments flagged. The in-browser per-segment recorder (MediaRecorder, retake button) is M3 (§14.2).
- `MODEL_MANIFEST` (setup: HTTP Range resume, **size verification** against `content-length`/`x-linked-size`, sha256 when known, `tar -xjf`): `kokoro` → `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2` (≈ 350 MB); `piper:<voice>` → `…/tts-models/vits-piper-<voice>.tar.bz2` (≈ 60–120 MB). faster-whisper models download into `<home>/models/whisper/fw`. Downloads through proxies were truncated twice in research: always verify size.

### 8.8 Python sidecar (`python/`; W4 owns pyproject, dispatcher, `cmd_asr.py`, `cmd_piper_align.py`; W3 adds `cmd_cuts.py`; W5 adds `cmd_beats.py`, `cmd_energy.py`)

```toml
# python/pyproject.toml
[project]
name = "docmaker-sidecar"
version = "0.1.0"
requires-python = ">=3.11,<3.13"
dependencies = ["faster-whisper==1.2.1", "yt-dlp[default,curl-cffi]==2026.08.19", "numpy>=1.26,<3"]
[project.optional-dependencies]
piper = ["piper-tts==1.8.0", "onnx"]   # GPL-3.0 — subprocess only, never imported by our TS
[tool.uv]
package = true
```
- **Protocol:** `python -m docmaker_sidecar <cmd> --in <in.json> --out <out.json>`; the dispatcher imports `docmaker_sidecar.cmd_<cmd>` (dashes → underscores) and calls `run(input) → output`; exit 0 on success; on failure the output is `{"error": code, "message": str}` with exit 1; progress lines on stderr `PROGRESS <0..1> <msg>`.
- **Setup:** `docmaker setup --python` runs `uv sync --project python --frozen` with `UV_PROJECT_ENVIRONMENT=<home>/py/.venv`.

| cmd | in | out |
|---|---|---|
| `asr` | `{audio, lang, model, initialPrompt, vad, beamSize, computeType, threads, modelsDir}` | `{words:[{text,startMs,endMs,p}], durationSec, rtf}` |
| `piper-align` | `{model, text, outWav}` (port `$SP/tts/piper_align.py`) | `{sampleRate, words:[{ph,startMs,endMs}]}` |
| `beats` | `{wav (16-bit), fps}` (copy beats.py, MIT, attribution) | `{duration,bpm,period,phase,beats:[{t,f,n,bar_pos,strength,low}],onsets:[],loudness:[{t,db}]}` |
| `energy` | `{wav, windowSec}` | `{windows:[{t, rms_db, vocal_ratio}], silence_tail_s}` |
| `cuts` | `{video}` (copy cuts.py, MIT) | `{cuts:[{t,f,score}]}` |

### 8.9 Scratch takes, final takes, licences

- **Scratch take** (`kind:"scratch"`, M1): the synthetic provider with the project's language and the style cps, run by the pipeline when no active take exists (and on demand: "Regenerate scratch"). Free, deterministic, ungated, id `scratch-<sha12>`. The Player shows a "SCRATCH VO" banner; renders carry `SourceLabel{kind:"synthetic-voice"}`.
- **Final take** (`kind:"final"`): any provider including `synthetic` when the user explicitly chooses it (the demo does). Final takes with `elevenlabs|kokoro|piper|recording` require `factcheck-ack` (not stale), `person-ack` and the cost gate. Activating a take writes `active.json` and triggers layout → direct → mix.
- **Voice licence:** `VoiceTrack.license = voiceLicense(provider, voiceId, tier)`; the credits "Voice" group lists it (§7.8).

---

## 9. Layout and director (`@docmaker/director`, W6)

The package is **pure TypeScript with no I/O**; identical inputs give byte-identical outputs.
- Never `Date`, `Math.random`, or iteration over unsorted `Map`/`Set` contents.
- Randomness only from `rngFor(project.seed, key)`, the key naming the decision (`asl:CH3-B014`, `cam:v:CH3-B014:1`, `trq:<clipId>`, `cmp:<beatId>:<k>`, `sfxv:<id>`…), so changing one beat does not reshuffle the others.
- Ids from `util/ids.ts` (§4.13 grammar). All `framesAt`/`secToFrames` conversions use the layout fps.

```
packages/director/src/
  index.ts  version.ts (DIRECTOR_VERSION = "2.0.0")  resources.ts (safe-messaging end cards EN/FR)
  layout.ts         layoutProgram (§9.2)
  direct.ts         orchestration (§9.3)
  music.ts shots.ts montage.ts stills.ts camera.ts transitions.ts fx.ts reveal.ts punch.ts
  overlays/{fromMotion.ts, cues.ts, derive.ts, hold.ts, sync.ts, conflicts.ts}
  visual-change.ts arbitration.ts captions.ts sfx.ts silences.ts ducking.ts jl.ts markers.ts
  overrides.ts lint.ts stats.ts
```

### 9.1 API

Signatures: §4.19 director stub (`layoutProgram`, `direct`, `groupCaptions`, `lintTimeline`, `applyOverrides`, `LINT_RULES`, `DIRECTOR_VERSION`). The engine filters `script`, `plans` and `texts` by `onlyChapters` **before** calling `layoutProgram` (the program then starts at the first kept chapter) and passes the same filtered inputs to `direct`; `onlyChapters` is hashed by layout, direct, mix and render.

### 9.2 `layoutProgram` (the audio clock)

```
mode(seg) = narration    → "vo"
            clip         → clips[seg].status ∈ {found, manual} ? "clip"
                           : (clipFallback == "narrated" && take has seg) ? "clip-narrated" : "clip-card"
            music_breath → "breath"
            sponsor_slot → (no layout segment) sponsorMarkers += {segmentId, frame: msToFrame(t)}
revealAnchor(chapter) = the chapter's FIRST REVEAL cue: (segmentId, k = segment-relative display-word index of its anchor in THIS language)
isTitleStingChapter(ci) = ci == 1 && style.budgets.titleSting && chapter[0].act is the shape's first act

t = pauses.headMs
for chapter c at index ci:
  if ci > 0: chapterStart = t; t += max(pauses.chapterGapMs, isTitleStingChapter(ci) ? 3500 : chapterCardReadMs(c.title, 12))
  else:      chapterStart = 0
  for seg in c.segments (skipping sponsor slots):
    if mode ∈ {clip, clip-narrated, clip-card}: t += pauses.clipLeadMs
    if seg holds revealAnchor(c) at word k:
        k == 0 → t += pauses.preRevealMs
        k > 0  → insertions = [{afterWordIdx: k−1, splitAtMs: (w[k−1].endMs + w[k].startMs)/2, ms: pauses.preRevealMs}]
    start = frameToMs(msToFrame(t))                                            // frame-quantised segment start
    durMs = vo | clip-narrated : take.seg.durationMs + Σ insertions.ms
            clip       : clip.passageOutMs − clip.passageInMs                  // handles excluded
            clip-card  : max(3000, 1000·(chars(spokenText(seg,"clip-narrated"))/15) + 1500)
            breath     : seg.breathMs || 2000
    words (vo | clip-narrated): abs.startMs = start + w.startMs (+ ms for words after the insertion); clamp ≥ 0
    t = start + durMs
    t += clip-modes ? pauses.clipTailMs
       : mode == "vo" && seg.device ∈ {cliffhanger, reveal, rhetorical_question} ? pauses.deviceGapMs
       : mode == "vo" ? pauses.segmentGapMs : 0
t += pauses.tailMs; durationMs = frameToMs(msToFrame(t)); durationInFrames = msToFrame(t)
segments: from = msToFrame(startMs); dur = max(1, msToFrame(endMs) − from)
words:    from = msToFrame(startMs); end = max(from + 1, min(msToFrame(endMs), nextWord.from)); dur = end − from
beats (TILE THEIR CHAPTER):
   narration beats: beatWordRanges(spokenText(seg,"vo"), texts in order) → global ranges; onsetFrame = words[wordStart].from
   clip / breath beats: their segment's word range (clip-narrated) or empty; onsetFrame = segment.from
   from = (first beat of its chapter) ? chapter.from : onsetFrame
   end  = next beat's from within the chapter; the chapter's last beat ends at chapter end
chapters: from = msToFrame(chapterStart) (0 for the first kept chapter); end = next chapter's from | durationInFrames;
          firstWordFrame = first word of the chapter; act/macroAct from the outline and style shape
```
Invariants (tested): `chapter.from ≤ beat.from < beat.end ≤ chapter.end` with matching `chapterId`; beats tile each chapter; words strictly increasing; the sum of insertions equals the extra duration. The engine then calls `audio.assembleVoProgram` (§11.4) and fills `voProgram {assetId, projectRel, bakedGainDb, durationMs}`.

### 9.3 Director algorithm (normative pseudo-code)

```
direct(I):
  ── 0. SETUP
  fps, N = layout.fps, layout.durationInFrames;  R(key) = rngFor(project.seed, key);  F30(f) = framesAt(fps, f);  S(s) = secToFrames(s, fps)
  ix = buildAnchorIndex(layout, layoutHash);  P = cameraPolicy;  T = transitionPolicy;  St = stills;  M = musicPolicy;  X = sfxPolicy;  Bu = budgets
  tok = I.renderTokens (palette/fonts merged with the theme, caption variant resolved)
  B = layout.beats ⋈ plans[beatId] ⋈ texts[beatId] (ordered);  act(b), macro(b) from layout chapters;  intensity(b) = Bu.actIntensity[act(b)] ?? 1
  hook(b) = act(b) is the shape's first act;  cueFrame(b,k) = cueAnchorIdx[k] == −1 ? b.onsetFrame : layout.words[b.wordStart + cueAnchorIdx[k]].from
  cutLead = P.shots.cutLeadFrames (2);  ledger = ordered accent events {frame, kind, weight, priorityClass, itemId}

  ── 1. MUSIC PLAN (before shots, so montage cuts can snap to beats)
  sections: new section at a chapter start when any beat of the chapter has musicCue ∈ {start, change_mood} or the act changes;
            merge adjacent chapters while a section < M.sectionSec[0]; split sections > M.sectionSec[1] at the boundary nearest the middle
  mood   = most frequent non-none musicMood in the section; equal to the previous section's → second most frequent or another track of that mood
  energy = "high" after a `build` cue in the previous section, else from the mean beat energy (≤ 2 low, 3 mid, ≥ 4 high)
  track  = music tracks matching (mood, energy) → (mood) → any, chosen by R(`mus:${chapterId}`); no tracks → no music
  boundary recipe per chapter start c (decided with the silence budget in step 11a, computed here first):
     "silence-hit": previous section endMode "hardStop" at c.from − silenceLen; new section mus:<chapterId> starts AT c.from,
                    alignDownbeatAt = c.from, sourceInFrames = msToFrame(track.downbeatsMs[j]) with j = first downbeat ≥ 2 bars in
     "jcut":        new section starts at c.from − M.jCutFrames and crossfades M.crossfadeFrames with the previous one (endMode "crossfade")
  loop = track shorter than the section; gainDb = M.noVoGainDb; fadeIn M.fadeInFrames (first section), fadeOut M.fadeOutFrames at program end
  beatGrid(f) = the active section's beatsMs/downbeatsMs mapped to program frames (from, sourceIn, loop)

  ── 2. SHOTS (V1)
  for b in B:
    if b is a clip beat in mode "clip":
       src = {video, clipAssetId, sourceInFrames: msToFrame(clip.passageInMs), crop: null, focal: {.5,.45}}
       shot spans [segment.from, b.end); the media covers passage + 1000 ms tail handle; if the span still exceeds it, the excess becomes a
       hold shot (generated backdrop, tok.backdrop, quote text) — never frozen or black frames
       clip > P.clip.switchLayoutAfterSec: split at the clip-word sentence boundary nearest the middle (word ending . ? ! or followed by ≥ 300 ms);
       shot 0 layout style.clipLayout ("pip"), shot 1 "cover"; camera creep 1.0 → lerp(P.clip.creep, R) per shot; sourceLabel "Source: <channel>, <year>"
       continue
    if b is a breath beat or has a MONTAGE cue: montageShots(b) (2b); continue
    asl = P.shots.targetAslSec · (hook(b) ? P.shots.hookAslFactor : 1) · P.shots.aslMul.byEnergy[energy−1]
          · Π_{cue types c in b} (P.shots.aslMul.byCue[c] ?? 1) · (P.shots.aslMul.byAct[act(b)] ?? 1) · (0.8 + 0.4·R(`asl:${b.id}`)())
    asl = clamp(asl, P.shots.aslSec[0]·0.5, P.shots.aslMaxSec)
    srcs = picks of b by slot whose planKey == plan.planKey → {image | video(sourceInFrames = msToFrame(pick.sourceInMs ?? handleHead))} with pick.crop/focal
           empty → [generated{recipe by visualKind, text: onScreenText || keywords(visualQuery), palette: tok.palette, seed: fnv1a32(b.id)}]
    n = max(1, round(b.dur / S(asl)))                                           // no cap by the number of sources
    cuts: for k in 1..n−1: ideal = b.from + k·b.dur/n; the word w of b minimising |(w.from − cutLead) − ideal| within S(0.6) → w.from − cutLead,
          else round(ideal); drop cuts leaving a shot < P.shots.minShotFrames
    shot k: source srcs[k % len]; k ≥ len → CAMERA-CHANGE shot of that source (reframe, step 4; or a cover↔card flip for stills)
    video: a shot longer than (asset frames − sourceIn − tail need) is split; the remainder takes the next source or a reframe of the same video
           restarting at its head handle
  beat starts: every beat with a word onset starts its first shot at max(prevShot.from + minShotFrames, onsetFrame − cutLead);
               the first beat of a chapter starts at chapter.from (the chapter card covers until the first word)
  make contiguous (shot[i].end = shot[i+1].from; first.from = 0; last.end = N); merge shots < minShotFrames into the longer neighbour;
  shots never straddle a chapter start (split at chapter.from)

  ── 2b. MONTAGE (breath beats, MONTAGE cues)
  ASL = lerp(P.montage.aslSec, R); cuts snapped to beatGrid within ±P.montage.snapFrames (every 4th cut on a downbeat when one is in range);
  sources = the beat's picks (4 slots) then picks of neighbouring beats of the chapter (as reframes); transitions T.montage.primary (pushCut) with
  flash T.montage.flashPeak on downbeat cuts; beat punch fx {zoom hit, amt P.montage.beatPunch.amt, dur F30(P.montage.beatPunch.frames),
  curve P.montage.beatPunch.curve} on every snapped cut. No VO plays, so the ducking release lifts the music (no extra gain automation).

  ── 3. STILL LAYOUT, TREATMENT, UPSCALE GUARD
  for each image shot (asset a, w×h): aspect = w/h; coverFactor = max(1920/w, 1080/h)
    forced card: aspect < St.cardIfAspectBelow or w < St.cardIfWidthBelow or visualKind ∈ {document_screenshot, social_post}
    else layout = weightedPick(St.layoutWeights, R(`lay:${shot.id}`)), never more than St.maxCardRun cards in a row;
         a camera-change shot of a still flips cover ↔ card relative to the previous shot of the same asset when the reframe would exceed the guard
    card: heightFrac = lerp(St.card.heightFrac, r) capped so that heightFrac·1080/h ≤ P.maxUpscale (min .5); borderPx = lerp(St.card.borderPx);
          tiltDeg = ±lerp(St.card.tiltDeg) (sign alternates card to card); shadow true; backdrop = theme.backdropRecipe ?? St.card.backdrops[R];
          backdropSeed = fnv1a32(shot.id)  → layoutParams
    cover: maxCamScale = P.maxUpscale / coverFactor; maxCamScale < 1.0 → card
  video shots: cover (clip beats per step 2); maxCamScale from the video size
  treatment = a.analysis.grayscale ? "bw" : (a.analysis.year < 1970 ? "archival" : "none")     ("bw" skips split-tone in the grade)
  asset reuse within St.assetReuseMinGapSec → must change layout or framing (flip layout or force a reframe), else ASSET_REUSE warning

  ── 4. CAMERA
  for shot s (index i), plan p, r = R(`cam:${s.id}`):
    video (non-clip): (s.dur ≥ S(4) and p.camera ∈ {slow_push_in, ken_burns}) or TENSION_BUILD → creep 1.0 → lerp(P.kenBurns.videoCreep, r()), linear; else static 1.0
    image | generated | card:
      p.camera == zoom_out_reveal and first shot of the beat → pullBack: keys [{f:0, scale:P.pullBack.from}, {f:P.pullBack.frames, scale:1}], ease expoOut, blurFromPx P.pullBack.blurPx
      camera-change shot → kind "reframe": TIGHT = lerp(P.reframe.scale, r()) toward focal (origin = focal) when the previous shot of the asset was wide,
                           else WIDE = lerp(P.reframe.wideScale, r()); plus the Ken Burns motion below at the same rate
      s.dur ≥ S(P.kenBurns.minShotSec) → kenBurns (RATE-based, matched speed across cuts):
          rate = lerp(P.kenBurns.scaleRatePerSec, r())·intensity; drift = lerp(P.kenBurns.driftPxPerSec, r()); durSec = s.dur/fps
          dir ∈ {in, out, left, right, up, down} \ {prevDir, opposite(prevDir)} chosen by r; an outgoing shot before a velocity whip prefers
              the whip's direction (seam-direction ledger)
          s0 = lerp(P.kenBurns.scaleStart, r()); s1 = s0 + rate·durSec
          in: s0→s1 · out: s1→s0 · left/right/up/down: s0→s1 plus a translation of drift·durSec in that direction (full drift for up/down too)
          upscale guard: max key scale × (1 + planned punch amt) ≤ maxCamScale → reduce rate, then drift
          ease "kb" (MotionTokens.kbEase = [0.2, 0.12, 0.8, 0.88]: end slopes 0.6 × mean → never stalls at a cut); origin = focal
      else → static(1.04) (overscan so shakes never show edges)
    TENSION_BUILD beats: creep lerp(P.creep.scale) across the beat's shots (linear, continuous); with aslMul ×1.6 it reads
    P.handheld ≠ null → camera.handheld = P.handheld
    camera.direction = the Ken Burns direction (ledger)

  ── 5. TRANSITIONS
  pass 1 structural:  B starts a MACRO act (setup→confrontation→resolution) → T.actBoundary (dipToBlack; ≤ 2–3 per film)
                      B starts a chapter → T.chapterBoundary ("cut+impact": a cut; impact SFX + slam shake added later)
                      A and B in the same beat → cut (a reframe of the same asset reads as a zoom cut)
  pass 2 proposals:   montage → T.montage.primary; else T.cueMap[first cue of B] ?? T.intentMap[B.plan.transitionIn] ?? "cut"
  pass 3 quota fill:  rolling window of the last T.quota.window boundaries; at beat boundaries with B.energy ≥ T.quota.minEnergy whose proposal is
                      "cut", while rolling nonCutShare < (1 − T.cutShare) − T.quota.tolerance and R(`trq:${B.id}`)() < intensity(B):
                      propose weightedPick(T.weights ∩ ({primary} ∪ accents), R)
  pass 4 constraints (every non-cut proposal, in order; re-checked after each substitution; failure → "cut", never an unconstrained pick):
      DEFERRED_TRANSITIONS maps keys not yet implemented (filmBurn|paperRip|whipStreaks → flash, dotWipe|iris → dipToBlack)
      rolling nonCutShare would exceed (1 − cutShare) + tolerance → cut
      film kinds would exceed maxKindsPerFilm → primary
      key ≠ primary and the act's accent kinds would exceed accentKindsPerAct → primary
      the last (noRepeatRun − 1) non-cut keys all == key → the allowed kind with the highest weight passing every check, else cut
      previous non-cut transition closer than T.minGapFrames → cut (structural transitions win)
      overlap: same chapter, both shots ≥ d + 2, d even, media handles on both sides → else cut
  duration: band = energy ≤ 2 calm | 3 medium | ≥ 4 high; d = framesAt(fps, round(lerp(T.energyFrames[band], R(`trd:${B.id}`)()))); overlaps → even d
  build(key, d):
      cut          → {cut, accent: hook && R() < P.cutAccent.share ? {pulse, amt P.cutAccent.pulseAmt, frames F30(8)} : {none}}
      pulse        → {cut, pulse}
      flash        → {cover, flash, durationFrames clamp(d,2,4), peak lerp(T.flash.routine) (≤ .45), #FFFFFF}; explicit (REVEAL, FLASHBACK): peak ≤ explicitMax, ≤ explicitPerMin
      whip         → {cut, velocity whip, exit F30(8), entry F30(8), direction from the seam ledger (alternates per act)}
      zoomThrough / zoomThroughInverse → exit F30(6), entry F30(15);  cutTheCurve → exit F30(10), entry F30(9);  pushCut → exit F30(5), entry F30(6), flash .2
      dipToBlack/White → {cover, F30(30..40)};  lightLeak | filmBurn → {cover, F30(15..30)};  glitch → {cover, F30(4..8)};  paperRip → F30(10..15);
      dotWipe → F30(13);  iris → F30(12);  whipStreaks → F30(8)
      dissolve | blurDissolve | push | wipe → {overlap, d (even)}
  stats.primaryShare = #primary / #non-cut (lint PRIMARY_SHARE outside T.primaryShare)

  ── 6. REVEALS, SHOCKS, FX, PUNCHES
  quiet(F) = [F − S(lerp(P.quietBeforeClimaxSec, .5)), F)
  RevealSequence (per chapter: its first REVEAL cue; a = the reveal word's frame; layout inserted pauses.preRevealMs of VO silence before it):
      silenceLen = min(S(lerp(M.dropBeforeRevealSec, R)), a − (last word end before a) − F30(2));  S0 = a − silenceLen
      riser SFX: sync point "end" at S0, combo "reveal" (exempt from the silence rule)
      SilenceMark sil:reveal:<beatId> on [S0, a) affects [music, sfx]   → music, SFX and VO are all silent
      at a: impact SFX (priority 5, combo "reveal"; the first sound after the silence); music restart mus:<chapterId>:r1 at a (alignDownbeatAt = a);
            explicit flash: if a shot cut lies within ±F30(6) of a it moves onto a and gets a cover flash, else fx flash {amt .8, dur F30(3)};
            Stamp candidate for step 7g at a + F30(4)
  SHOCK at a: a' = a + round(P.plate.anchorOffsetMs·fps/1000): fx punch {amt P.plate.punch, decay P.plate.decay, dur S(P.plate.windowSec)}
              + fx shake {amt P.plate.shakeX, ampY P.plate.shakeY, hz P.plate.hz, decay 9, dur S(.6)}
  impactShake (P.impactShake): at every KeywordSlam / FreezeLabel / HeadlineStack item slam / ChapterCard / TitleSting entry:
              fx shake {amt lerp(ampPx), rotDeg lerp(rotDeg), dur lerp(frames), hz null (seeded noise), target "all"}
  IRONY: music drop_out lerp(M.ironyDropSec) at the anchor (11a) + creep on the beat's shots; `scratch` SFX only if X.allowComedic
  punch candidates, by priority: EMPHASIS cue > emphasisIdx words > first word of an energy ≥ 4 beat > clip key line (clip > 6 s: first word of its last sentence, amt P.clip.keyLinePunch)
  accept a punch at a when: a ∉ any quiet(); ≥ P.punch.minGapFrames since the last punch; trailing-60 s punches < P.punch.perMin[1]·intensity;
      the shot is image | video | card, or a followsCamera overlay is on screen; shot.end − a ≥ P.punch.minTailFrames;
      no transition, cover or overlay entry within ±P.punch.exclusionFrames; upscale headroom allows amt ≥ 0.08 (else reduce; < 0.08 → drop)
      → fx zoom {span, amt lerp(P.punch.scale, energy/5) − 1 (guarded), fade P.punch.inFrames[1], dur shot.end − a, x,y = shot focal, target "picture+followers"}
  punch fill (P.punch.fillToMin): per 60 s window (10 s steps; acts ≥ techniqueFloor.exemptActsShorterThanSec) below P.punch.perMin[0]·intensity:
      first turn intra-beat cuts between shots of the same asset into zoom cuts (the next shot becomes the TIGHT reframe), then accept the
      strongest remaining candidates ignoring only the priority order (all other constraints hold); then perChapter.punch ≥ 1

  ── 7. OVERLAYS
  hold(item) per COMPONENT_META.read (§4.11): formula | glance | title | narrated | none; dur = clamp(readHold, minHold, maxHold);
     readHold > maxHold → formula: truncate on a word boundary with "…" + READABILITY warning; narrated: dur = maxHold + warning. Never an error.
  (a) motion templates → TEMPLATE_COMPONENT, props filled from the FactSheet (§4.11 table); from = b.from + F30(2) (or the template's cue anchor);
      dur = hold(); longer than the beat and the next beat has a same-zone overlay → shorten; below readHold → drop (warning)
      VO-synced sub-beats (sync.ts): NW-match the item's spoken text (quote verbatim, highlighted passage, headlines, dates, labels, names) to the
      layout words of this and the next beat → `at`/`*At` = word.from − item.from; unmatched → evenly spaced after the entry
  (b) PERSON_INTRO / first mention in this language of a person who is publicFigure (or person-ack'd) and not isMinorOrPrivateVictim:
      shot under the anchor is a video, FreezeLabel enabled and R(`frz:${b.id}`)() < its weight → FreezeLabel {assetId, sourceFrame = shot.sourceIn + (a − shot.from), name, role, desaturate .8, darken .25}
      else LowerThird at the anchor; name/role from onScreenText "Name — role" (split " — " | " - " | ": "), fallback name = person.name, role "";
      ≥ Bu.lowerThirdMinGapSec since the previous lower third
  (c) TIME_JUMP → DateStamp (text = onScreenText if it has a digit, else cue.value; upper case); dur = enter + 2 f/char + F30(30)
  (d) SHOCK with energy 5 and 1 ≤ words(onScreenText) ≤ 3 → KeywordSlam at the anchor (glance hold 12–20 f, impactShake); ≤ Bu.keywordSlamPerMin
  (e) clips: SourceLabel("Source: <channel>, <year>") over the clip; "clip-card" → static QuoteCard for the segment;
      "clip-narrated" → QuoteCard with text = spokenText(seg, "clip-narrated"), words synced (at = word.from − item.from), translated = subtitleTranslation ≠ ""
  (f) labels: AI asset on screen → SourceLabel{illustration}; synthetic voice → SourceLabel{synthetic-voice} topRight for the whole program;
      scratch take → also {scratch-voice} (preview/draft only); pickup segments → {pickup-tts}; downgraded reconstruction beats with people → {reconstruction}
  (g) cue→component pass — for each cue (b, k) not already served by (a)–(f): candidates = components with style.components[].enabled, cue type ∈
      triggers ∩ DERIVABLE_TRIGGERS[component], derivation succeeds, not in cooldown (Bu.componentCooldownSec), within budgets;
      weighted pick by weight with R(`cmp:${b.id}:${k}`):
        Stamp ← REVEAL         text = a word of onScreenText/cue.value ∈ STAMP_LEXICON[lang]; status-gated words only if a cited claim of the beat has
                               that status; nothing eligible → no stamp. color danger, rotation ±lerp([4,10]), at the reveal + F30(4)
        KeywordSlam ← SHOCK    as (d)
        NumberCounter ← NUMBER cue.value parses to a number equal to a Figure among the beat's factIds → value/unit/currency from the Figure
        LowerThird | FreezeLabel ← PERSON_INTRO  as (b)
        QuoteCard ← QUOTE      plan.quoteId → verbatim, speaker, source
        SocialPost ← TWEET     plan.quoteId with medium social_post
        SplitScreen ← COMPARISON  ≥ 2 image picks on the beat
        CensorBar ← SENSITIVE (value ≠ "bleep")  mode blur on pick.safeCrop ?? full frame, over the shots under the anchor
        bleep ← SENSITIVE (value "bleep")  SFX bleep on [word.from, word.from + word.dur) + SilenceMark sil:bleep:<wordId> affects [vo]
        Spotlight ← DOCUMENT | EMPHASIS  image shot with a pick focal: cx,cy = focal, rx .18, ry .24, dim .4, drawCircle true
        KineticText ← LIST | EMPHASIS    onScreenText non-empty → ≤ 4 lines of ≤ 48 chars, emphasis = emphasisIdx words
        PhotoBurst ← LIST | MONTAGE      ≥ 3 image picks: items at accelerating 8→5 f, tilt ±2–6°, scale 1.0→1.1, last image held ≈ 90 f
        EvidenceBoard ← LIST             ≥ 2 people with portraits (picks.portraits) or ≥ 2 picks: items on the 3840×2160 board, moves 20–30 f eased, dwells 45–90 f, items pop when named
        SourceLabel ← CLIP_REF           as (e)
  (h) chapter cards: every chapter index ≥ 1 except the title-sting chapter → ChapterCard at chapter.from; dur = clamp(hold(title), Bu.chapterCardFrames)
      and end ≤ firstWordFrame + F30(6) (the layout gap guarantees the hold); letterbox true; backdrop tok.backdrop (never flat ink);
      kicker `CHAPTER n` / `CHAPITRE n` (n = index among the post-cold-open chapters)
  (i) title sting (Bu.titleSting): at the first chapter after the cold open, TitleSting {title: Script.title, kicker: `CHAPTER 1 · <chapter title>`,
      mode slam, backdrop tok.backdrop}, 90–120 f, with impact SFX and the music section start at its entry
  (j) riskFlags ∋ suicide_self_harm → KineticText resource card (resources.ts) over the last 5 s
  grade.letterbox ≠ null → Letterbox (hud)
  conflicts: graphics-band concurrency ≤ Bu.overlayMaxConcurrent; full-frame items never overlap; the lower COMPONENT_META.priority is shortened or
  dropped; every overlay clamped into its zone, never in keepOut. z: picture 10–49, graphics 100–199 (ChapterCard/TitleSting 190, KeywordSlam 180), hud 300+.
  followsCamera copied from COMPONENT_META; every graphics card has continuousMotion (push 1.0→1.05 + backdrop drift inside the component).

  ── 8. VISUAL CHANGE
  events = cuts ∪ punches ∪ overlay entries ∪ overlay sub-beats (`at`/`*At`) ∪ non-cut transitions
  every gap between consecutive events > P.shots.visualChangeSec[1]:
     picture visible → split the shot at the word onset nearest the gap middle (− cutLead); the second part is a camera-change shot (reframe/flip)
     under a full-frame card → a card punch fx zoom {amt .04, target "picture+followers"} at the nearest word onset (followsCamera cards)
  stats.maxNoChangeSec, stats.eventsPer10s

  ── 9. ARBITRATION (fatigue control)
  accents (weights Bu.salience.weights): non-cut transitions, punches, slams (KeywordSlam, Stamp, FreezeLabel entries), impact SFX events,
      other overlay entries, flashes
  priority classes: structural (chapter card, title sting, RevealSequence, SHOCK plate) > template overlays > cue components > cue transitions >
      quota transitions > punch fill
  sliding Bu.salience.windowSec window: Σ weights ≤ Bu.salience.maxAccents·intensity and accents ≥ Bu.salience.minGapFrames apart (designed combos
      exempt: reveal flash + impact + stamp) → resolve the lowest priority first: delay ≤ F30(6) to the next word onset, else drop (transition → cut,
      punch removed, overlay dropped)
  cooldowns re-checked after delays (Bu.componentCooldownSec)
  clean stretch: every Bu.cleanStretch.everySec window contains ≥ Bu.cleanStretch.minSec with no accent (Ken Burns + captions only); if not, take the
      lowest-accent window (prefer energy ≤ 2 narration, never across a structural accent) and remove its non-structural accents
  stats.salienceDrops, stats.cleanStretches

  ── 10. CAPTIONS
  SRT groups (always): per vo / clip-narrated segment, group with captionDNA.srtGrouping (≤ 42 chars × 2 lines, 1–6 s) → variant "srt", burn false
  burned groups when captionsMode == "burn", by variant:
    keywords (drama default): candidates = EMPHASIS anchors, emphasisIdx words, NUMBER anchors, money/danger tone words; phrase = the anchor word +
       ≤ (keywords.maxWords − 1) following words of the same sentence while gaps < 250 ms; spacing ≥ lerp(keywords.minGapSec, R) between phrases;
       none while a suppressing overlay is on screen or within ±1 s of a KeywordSlam; hold = max(keywords.holdMinSec, speech + 0.4 s);
       hero = the anchor word (scale heroScale, keyword colour); ids kw:<segmentId>:<n>
    pop | karaoke | rail: groupCaptions(words, captionDNA.grouping) per segment (§9.4); one line (oneLine); hero words: at most one per beat
       (an emphasis word), ≥ heroWordMinGapSec apart
  tone(word): emphasis → keyword; NUMBER anchor or digits with a currency → money; SHOCK/SENSITIVE anchors or the danger lexicon → danger
  burn = captionsMode == "burn" && no intersecting overlay whose component ∈ suppressUnder or whose text has ≥ suppressMinWords words
  clips: clip words inside the clip span → "clip" groups (sentence case); quote language ≠ lang → "translation" groups per ≤ 42-char page of
     subtitleTranslation, time-proportional over the clip; both with min hold max(clipStyle.minHoldSec, speech + 0.6 s)

  ── 11. AUDIO
  11a silences: target = round(X.silencesPerFiveMin · runtimeSec/300) counted over acts ≥ exemptActsShorterThanSec; filled in this order:
        RevealSequence silences (step 6)
        → chapter-boundary "silence-hit" recipes (largest act/macro changes first): previous section hardStop at c.from − silenceLen,
          SilenceMark sil:chapter:<chapterId> on [c.from − silenceLen, c.from) affects [music, sfx]; impact + new section AT c.from on a downbeat
        → musicCue drop_out: SilenceMark sil:drop_out:<beatId>, music only, lerp(M.dropOutSec) from the anchor (the VO continues)
        → IRONY drops: sil:irony:<beatId>, music only, lerp(M.ironyDropSec)
      silenceLen = lerp(X.silenceFrames); chapter boundaries without a silence keep the "jcut" recipe (step 1)
  11b musicCue: build → riser ending at the beat end + the next section energy "high"; hit → move the nearest beat cut within ±F30(3) onto the
      closest downbeat (if every shot constraint still holds) + impact; duck → nothing (ducking is automatic)
  11c SFX: candidates (§9.5) → selection (§9.5) → fill to X.perMin[0]
  11d J/L cuts (clips): J — ClipAudio ca:<segmentId> starts F30(12) before the picture when the previous VO word ends ≥ that early:
        ca.from = picture.from − 12, ca.sourceInFrames = picture.sourceInFrames − 12 (lip sync kept; head handle ≥ 12 f guaranteed by clip-v1);
      L — extends F30(9) past the picture when the next VO word starts ≥ 9 f later (ducked by clipDuckDb, tail handle);
      stats.jlCuts; floor techniqueFloor.perFiveMin.jlCut (warning only)
  11e ducking (DuckingSpec from musicPolicy: musicDuckDb −12, sfxDuckDb −4, clipDuckDb −10, musicUnderClipDb −12, attack 150, release 400,
      bridge 600, pads 80/120) and voSpans (§4.18); voProgram {assetId, bakedGainDb}; VoClips vo:<segmentId> (+ vo:<segmentId>:b after an
      insertion) with gainDb = bakedGainDb

  ── 12. MARKERS, ASSETS, USAGE
  markers: chapter starts (blue, title), adBreakAfter → chapter end (red "Ad break"), sponsor slots (purple, from layout.sponsorMarkers),
     fact-check items not "rewritten" (yellow, at segment.from), clip sources (green), pickup segments (orange)
  assets = collectAssetIds → TimelineAsset (frozen; VO segment wavs; vo_program); usage = assetId → item ids (UsageDoc, written by the engine)

  ── 13. OVERRIDES   applyOverrides (fingerprints, isolated validation, rejected list; §4.13)
  ── 14. CHECK       resolveTimeline idempotence (RESOLVE_MISMATCH) → lintTimeline (§4.13 table; errors fail unless --force) → stats
```

### 9.4 Caption grouping (port of HyperFrames `caption-grouping.md`; normative)

```
groupCaptions(words, g, fps):   // words of ONE segment, in order (ms + frames)
  groups = []; cur = []
  for w in words:
    if cur ≠ [] and ( gap(prev,w) ≥ g.pauseBreakMs (500)
                   or endsSentence(prev.text)                         // . ? ! … (incl. closing » ")
                   or (endsComma(prev.text) and gap ≥ g.commaPauseMs (250))
                   or cur.length ≥ g.maxWords (drama pop: 4)
                   or w.endMs − cur[0].startMs > g.maxSec·1000 (2.0 s)
                   or chars(cur ∪ w) > g.maxChars (22) ):  groups.push(cur); cur = []
    cur.push(w)
  push cur
  merge: a group with < g.minWords (2) words or < g.minSec (0.5 s) merges into the neighbour with the smaller gap
         (1-word groups only if the word ends with ! or ?)
  timing: inMs = first.startMs − g.leadMs (80); outMs = min(nextIn − g.gapMs (50), last.endMs + g.tailMs (600))
  frames via msToFrame; word frames from the layout words
  floor: end ≥ last.from + min(last.dur, F30(6)) (contiguous TTS timings put nextIn − gapMs inside the last word),
         end ≤ next.first.from; the next group then starts at min(next.first.from, max(its inMs frame, end + gap))
```
Geometry (drama pop): 22 chars of 78 px Archivo Black caps ≈ 22 × 0.72 em × 78 px ≈ 1240 px — one line inside the 1500 × 140 px caption band; `fitText` shrinks within 70–90 px.

### 9.5 SFX auto-attach and selection

**Candidates** (event frame, category, base priority 1–5; all frames come from the final, arbitrated events):

| Event | Category (sync point on the event) | Priority |
|---|---|---|
| velocity whip cut | whoosh.whip (peak at cut; `panSweep` = the whip direction: LR for right, RL for left) | 3 |
| velocity zoomThrough / inverse | whoosh.up (peak at cut) | 3 |
| velocity cutTheCurve / pushCut | whoosh.light | 2 |
| cover glitch | glitch (onset at cover start) | 3 |
| cover flash, explicit | shutter | 3 |
| cover flash, routine | — | — |
| cover dipToBlack (macro act) | boom.low (at black start) | 4 |
| cover lightLeak / filmBurn | swell.reverse (end at cut) | 3 |
| cover paperRip | paper | 3 |
| plain cut into an energy ≥ 4 beat (different beat) | whoosh.light | 1 |
| punch zoom cut with amt ≥ 0.2 | whoosh.light, only if ≥ `P.punch.whooshMinGapSec` since the last punch whoosh | 2 |
| SHOCK plate punch | impact | 5 |
| RevealSequence | riser (end at S0, combo "reveal") + impact at a (combo "reveal") | 4 + 5 |
| TENSION_BUILD (beat ≥ 6 s) | riser ending at the beat end / next climax; else drone (loop, fadeIn F30(15), fadeOut F30(20)) | 3 / 2 |
| chapter boundary "cut+impact" / ChapterCard entry / TitleSting entry | impact | 5 |
| montage downbeat cuts | whoosh.light on every 2nd cut, impact.soft on the last | 2 |
| overlay entry and VO-synced sub-beats | `COMPONENT_META.defaultSfx` at the entry or sub-beat frame: LowerThird pop; SocialPost notification (at `revealAt`); ArticleHighlight paper (entry) + marker (at `highlightAt`); DocumentCard paper + thud (at `stampAt`); HeadlineStack paper per item `at` (+ impact on the last); Stamp thud + click; KeywordSlam boom.sub; MapPin whoosh.light + pop per place `at`; DateStamp keys (loop for the typing length); QuoteCard paper; FreezeLabel shutter + impact; PhotoBurst shutter per item + riser under + impact on the last; EvidenceBoard whoosh.heavy per move + click per item; CommentPile pop per item (≤ 6) | 2 (ChapterCard/TitleSting 5, KeywordSlam 5, Stamp 4, FreezeLabel 4) |
| NumberCounter | tick every 3 f during the count (≤ 12) at −6 dB, then ding at landing | 1 / 3 |
| SENSITIVE "bleep" | bleep spanning exactly the word, with the VO silence | 5 |
| quiet narration (energy ≤ 2 beats ≥ 8 s, optional) | ambience.room (loop, fades F30(30)) | 1 |
| beat `sfx` intents (LLM) | whoosh→whoosh.light, impact→impact, riser→riser, sub_boom→boom.sub, record_scratch→scratch (**only** if `allowComedic`), camera_shutter→shutter, typing→keys, cash_register→cash, notification→notification, heartbeat→heartbeat, glitch→glitch, text_pop→pop, silence_drop→drop_out silence | +1 to a matching candidate in the beat; else a new candidate at the beat start, priority 2 |

**Selection (deterministic):**
1. Sort by `(−priority, rank, frame, id)`; `rank` orders priority-5 items bleep > reveal impact > SHOCK plate > other (chapter boundary, slam boom).
2. Drop a candidate whose **audible span** `[from, from + dur)` intersects a SilenceMark affecting `sfx`, except `combo:"reveal"` items and a candidate starting exactly at the silence end with priority ≥ `firstAfterSilenceMinPriority` (4).
3. Transition-type candidates may cover at most `(1 − silentCutShare)` of shot boundaries; excess dropped lowest priority first (ties `R("sfxdrop:"+id)`).
4. Greedy accept when: trailing-60 s SFX < `perMin[1]·intensity` and impacts (impact, boom.*, thud) < `impactsPerMin[1]·intensity` — for every priority, priority 5 included (only a bleep is exempt; a reveal riser is dropped when its reveal impact was not accepted); no accepted SFX within `minGapFrames` (6) unless a designed combo (riser→impact, click+whoosh, reveal); heavy whooshes need camera or element travel ≥ `heavyWhooshMinMovePx`.
5. Variant: entries of the category sorted by id; `idx = (useCount[category] + ⌊R("sfxv:"+id)·len⌋) % len`; the same file (by `assetId`) never twice in a row (take `idx+1`).
6. Placement: `from = event − round(peakOffsetMs·fps/1000)` (below 0 → shift the event later or drop); `dur = ceil(durationMs·fps/1000)` clamped to the program end, or the loop length for `loop` items (loopable entries only) with their fades; `gainDb = mid(peakDb[category]) − entry.peakDbfs + (R()·3 − 1.5)`; `pan = clamp((screenX − 960)/1400, −0.7, 0.7)` (overlay zone centre, else 960); `panSweep` for whooshes from the whip direction (the mixer mirrors channels for RL on an LR file).
7. **Fill** (`fillToMin`): per 60 s window (acts ≥ 90 s) below `perMin[0]·intensity`, add texture candidates in this order — whoosh.light on energy ≥ 3 cuts, pops on overlay entries that have none, ticks under counters — still within `silentCutShare`, `minGapFrames` and the caps.
8. Stats: SFX/min, impacts/min, silent-cut share (lint warnings outside the policy).

### 9.6 Music, silences, ducking, J/L cuts — summary of the normative numbers

| Item | Value (drama) |
|---|---|
| Sections | 120–240 s, new at chapter starts with `start`/`change_mood` or an act change |
| Chapter boundary with silence ("silence-hit") | silence 12–24 f before the cut (music + SFX); previous section hard stop; impact + new section at the cut on a downbeat |
| Chapter boundary without silence ("jcut") | new section 12 f before the cut, 15 f crossfade |
| RevealSequence | VO pre-pause 750 ms (layout); music+SFX silence 0.5–0.75 s; riser ends at the silence start; impact + music restart at the reveal word |
| drop_out / IRONY | music-only silence 1–3 s / 1–1.5 s; VO continues |
| Silences floor | 2 per 5 min (acts ≥ 90 s) |
| Ducking | music −12 dB under VO (range −15…−8), SFX −4 dB, clip audio −10 dB under VO, music −12 dB under clips; attack 150 ms, release 400 ms, bridge 600 ms, pads 80/120 ms |
| J/L cuts | J 12 f, L 9 f; floor 1 per 5 min (warning) |

### 9.7 Director tests (W6)

- **Determinism:** `direct(fixture)` twice → byte-equal `stableStringify`; changing one beat's pick changes only items whose ids contain that beat plus SFX/music items whose windows overlap it (id diff).
- **Layout:** golden with clip, clip-narrated, clip-card, breath, sponsor and a mid-segment REVEAL insertion; chapter-tiling invariant; frame quantisation (`segment.startMs = frameToMs(msToFrame(·))`); word ends never overlap the next word.
- **Anchors:** `resolveTimeline` on the director output is the identity (RESOLVE_MISMATCH); a different layout hash throws; a removed word → `ANCHOR_MISSING`.
- **Reveal:** `riser.from + riserEnd == silence.from`, `impact.from + peakOffset == silence.end == a`, and no VO word overlaps `[S0, a)`.
- **Ken Burns:** for every kenBurns camera, `d(scale)/df` at `f = 0` and `f = dur − 1` is ≥ 50 % of the mean slope; consecutive shots never repeat or reverse a direction.
- **Policies** over a synthetic 10-minute input with every cue type (`makeLayout`, `makeBeats`): no 3 identical non-cut transitions; non-cut share within `1 − cutShare ± tolerance`; primary share in 0.6–0.7; punch, SFX and impact per-minute within [floor, cap] in acts ≥ 90 s; ≈ 50 % silent cuts (± 10 %); flash peaks ≤ 0.5 except explicit; `maxNoChangeSec ≤ 6`; one clean stretch per minute; salience window respected; ≤ 3 dips to black.
- **Readability:** every overlay meets its `ReadPolicy` hold or carries a READABILITY warning; the tulip-mania fixture produces **no** lint error.
- **Stills:** a 900 × 1200 portrait becomes a card; a 600 × 400 image becomes a card with `heightFrac ≤ 1.6·400/1080 ≈ 0.59`; no shot's effective upscale exceeds `maxUpscale` after camera, reframe and punch; never 3 cards in a row.
- **Montage:** snapped cuts are within ±3 f of a beat; beat punches on snapped cuts.
- **Captions:** keyword phrases ≥ 6 s apart and ≤ 4 words; SRT groups cover every spoken word; suppression under text cards.
- **Clips:** `MEDIA_RANGE` holds for J/L cuts and overlaps; a clip longer than 8 s switches pip → cover at a sentence boundary.
- **Overrides:** a fingerprint mismatch (planKey changed) rejects the override; `removeItem` on `vo:*` is rejected; invalid merged props are rejected.

---

## 10. Remotion package (`@docmaker/remotion`, W7)

### 10.1 Layout

```
packages/remotion/
  package.json            exports: ".", "./compute", "./entry", "./fonts", "./lint" (§3.3)
  eslint.determinism.js   vitest.config.ts  vitest.int.config.ts
  src/entry.ts            registerRoot(Root)          ← @remotion/bundler entryPoint (render resolves it from repoRoot)
  src/Root.tsx            compositions (§10.2)
  src/index.ts            Documentary, DocProps, COMPOSITION_IDS, FONT_REGISTRY, useTimeline, IMPLEMENTED_COMPONENTS
  src/compute/            computeTimeline.ts planChunks.ts sliceHash.ts velocity.ts covers.ts index.ts   (PURE — no React, no node:*)
  src/Documentary.tsx     layer tree (§10.4)
  src/layers/             PictureLayer CameraRig ChapterSeries VisualClipView CoverLayer FxLightLayer GraphicsLayer CaptionLayer HudLayer AudioLayer GradeLayer
  src/media/              StillLayer VideoLayer (@remotion/media <Video>) GeneratedBackdrop CardFrame PipFrame ContainBlur SplitLayout Treatment
  src/transitions/        velocity.ts cover/{Flash,Dip,LightLeak,Glitch,FilmBurn,WhipStreaks,PaperRip,DotWipe,Iris}.tsx overlap.ts
  src/components/         one file per OverlayComponentId + FallbackCard.tsx + registry.ts (typed by OVERLAY_PROPS)
  src/captions/           KeywordCaptions.tsx KineticCaptions.tsx ClipSubtitles.tsx
  src/fx/                 envelope.ts cameraState.ts (port $SP/mgtest/motion.ts, keep attribution)
  src/looks/              Grade.tsx Vignette.tsx Letterbox.tsx Treatment.tsx
  src/fonts/              registry.ts fonts.css.ts (fontsource CSS imports) FontGate.tsx styleFonts.ts (@remotion/fonts loadFont, M2)
  src/lib/                motion.ts (port, MIT attribution) monotone.ts easing.ts random.ts assetUrl.ts text.ts
  test/                   compute.test.ts lint.test.ts envelope.test.ts registry.test.ts (unit, no Chrome)
  test-int/               fonts, determinism (render twice), component stills (Chrome; `test:render`)
```
**Browser safety:** nothing under `src/` imports `node:*` or `@docmaker/core/node` (lint + `check-deps-graph`); hashing uses core's pure-JS SHA-256.

### 10.2 Compositions and props

| id | Purpose | Props |
|---|---|---|
| `Documentary` | full picture, muted in render; audio in preview | `DocProps` |
| `DocumentaryOverlay` | graphics + captions + covers on transparent (`layers.picture=false`) | `DocProps` |
| `OverlayItem` | one overlay item in its own window (ProRes 4444 export, M3) | `DocProps` with `itemId` |
| `GeneratedStill` | one `generated` VisualSource as a still (NLE export) | `{source, tokens}` |
| `GlProbe` | WebGL2 context + tiny shader (render GL probe) | — |
| `FontSpecimen` | every registered font with `FONT_TEST_STRING` | — |
| `StyleSpecimen` | every enabled component of a style with sample props (contact sheet for `docmaker style preview`) | `{render: StyleRenderTokens}` |

`DocProps` is defined in the §4.19 remotion stub (`timeline | timelineUrl`, `assetBaseUrl`, `mode`, `layers`, `itemId`, `scratchBanner`).
- `calculateMetadata` (async, `abortSignal`): with `timelineUrl` it fetches the timeline only to compute `durationInFrames`/`fps` and **does not** return it in props; returns `{durationInFrames, fps, width:1920, height:1080, defaultCodec:"h264"}`; `OverlayItem` returns the item's `dur + enter + exit`.
- `useTimeline(props)`: `props.timeline` if set; else a module-level promise cache keyed by URL (`delayRender("timeline")` → fetch → `continueRender`), so each render tab fetches once. Parsing is memoised; the timeline is compact JSON (≤ 5 MB for 30 min, tested).
- `calculateMetadata` does not run in `<Player>`; the web app calls `computeTimeline(timeline)` (§14.4).

### 10.3 `computeTimeline` (pure; shared by `calculateMetadata`, the Player, chunk planning and tests)

Types and signatures: §4.19 compute stub.

**Overlap handles** (every cut midpoint stays on its anchored frame). For the clips `c₀…cₙ` of a chapter, `dᵢ` = clip i's overlap duration (even, 0 if none):
- `headᵢ = (i > 0 && cᵢ.transitionIn.kind == "overlap") ? dᵢ/2 : 0`; `tailᵢ = (i < n && cᵢ₊₁.transitionIn.kind == "overlap") ? dᵢ₊₁/2 : 0`
- `seq.durationInFrames = cᵢ.dur + headᵢ + tailᵢ`; `trimBefore = sourceInFrames − headᵢ` (≥ 0 is guaranteed by lint `MEDIA_RANGE`; clamped with a warning otherwise)
- Σ seq − Σ d = Σ dur, so the `TransitionSeries` total equals the chapter duration and every transition is centred on its cut.
- Inside a sequence the camera uses `localFrame = useCurrentFrame() − headHandle`, so camera keys stay relative to the cut.

**`planChunks`**: chapter-aligned chunks; chapters longer than `chunkFrames` are split evenly.
**`sliceHash`**: SHA-256 (core pure-JS) of `{ctx, fps, size, grade, render tokens, items intersecting [from − premount, to + premount] with every frame field normalised to chunk-relative (f − from), their asset ids}`. Lengthening CH1 does not invalidate later chunks whose content is unchanged relative to their start. Components MUST use only `Sequence`-relative `useCurrentFrame()`, never absolute program frames (a compute test asserts that shifting a chunk's items by a constant leaves its slice hash unchanged).

### 10.4 Composition tree

```tsx
<Documentary {...props}>                                   // AbsoluteFill bg = tokens.palette.ink
  <FontGate>                                               // delayRender until all fonts load (FONT_TEST_STRING)
    {layers.picture && (
      <GradeLayer grade={t.grade} chapters={t.chapters}>   // CSS filter + split-tone soft-light layers + grade.byAct per chapter act
        <CameraRig fx={ct.fx} pulses={ct.pulses}>          // fx with target "picture" | "picture+followers" | "all" (order: camera → blur)
          {ct.chapters.map(ch => (
            <Sequence from={ch.from} durationInFrames={ch.dur} premountFor={fps} key={ch.id}>
              <TransitionSeries>                           // seq: <TransitionSeries.Sequence durationInFrames premountFor={fps}><VisualClipView/>
                {/* VisualClipView = source (StillLayer | VideoLayer | GeneratedBackdrop) × layout (cover | contain-blur | card | pip | split)
                    × treatment (none | bw | archival | duotone) × camera (keys, kb/monotone ease, origin, blurFromPx, handheld)
                    × velocity exit/entry transforms */}
              </TransitionSeries>
            </Sequence>))}
          <OverlayBand items={ct.overlays.picture} />      // SplitScreen, Spotlight, CensorBar, FreezeLabel (inside camera & grade)
        </CameraRig>
        <Vignette /> <FxLightLayer fx={ct.fx} flashes={ct.cutFlashes} />   // light → signal damage (rgb/glitch) → dark
      </GradeLayer>)}
    {layers.covers && <CoverLayer covers={ct.covers} />}
    {layers.graphics && <GraphicsLayer items={ct.overlays.graphics} fx={ct.fx} />}   // NOT shaken by the camera, except: followsCamera items get
                                                                                     // punch/zoom fx; "all" shakes apply to the whole layer
    {layers.captions && t.captionsMode === "burn" && <CaptionLayer groups={ct.captions} dna={t.render.captionDNA} zones=… />}
    {layers.hud && <HudLayer items={ct.overlays.hud} />}   // SourceLabel, Letterbox (never moved by fx)
    {mode === "preview" && props.scratchBanner && <ScratchBanner />}
    {layers.audio && mode === "preview" && <AudioLayer audio={t.audio} gains={computeGainTables(t)} />}
  </FontGate>
</Documentary>
```
- Every timed element is wrapped in `<Sequence from durationInFrames premountFor={fps} layout="none">`; components read only their props and Sequence-relative frames, never anchors.
- `AudioLayer` (preview only), `@remotion/media` `<Audio>`: `voProgram` at **0 dB** × `G.vo`; music sections (`loop`, `trimBefore`); SFX (`loop`, fades; RL pan sweeps approximated by `pan` only in preview); clip audio; `volume={(f) => table[min(N−1, item.from + f)] · dbToGain(item.gainDb) · itemEnvelope(item, f)}`. Clip video is always muted; its audio comes from `ClipAudio`.

### 10.5 Transitions (three classes)

| Class | Preset | M | Numbers (30 fps) | Implementation |
|---|---|---|---|---|
| **cut** + accent | none | M1 | — | hard cut on the anchored frame |
| | pulse | M1 | +5 % decaying over 0.25 s (8 f), `scale = 1 + amt·(1 − t/8)²` | CameraRig pulse |
| | flash | M1 | 2–4 f, peak ≤ 0.45 routine, cap 0.5, explicit ≤ 0.9; screen blend; `#FFFFFF` (pushCut `#f5f2ed`) | FxLightLayer `cutFlashes` |
| | velocity **zoomThrough** | M1 | exit 6 f power3.in: scale 1→1.2, blur 0→10 px (20 full-frame), opacity → 0.15; entry 15 f expo.out: 0.75→1, blur 10→0, opacity 0.15→1 | VisualClipView transforms |
| | velocity **zoomThroughInverse** | M2 | exit 1→0.8; entry 1.25→1 | |
| | velocity **whip** | M1 | 16–17 f (8 + 8), power3.inOut; one frame width of travel split across the cut (A: 0→−W/2, B: +W/2→0); directional blur ≤ 16 px (CSS blur + scaleX 1→1.06) | |
| | velocity **cutTheCurve** | M2 | exit 9–10 f power4.in ±230 px, opacity 0 by 30 % of travel; entry 9 f power4.out | |
| | velocity **pushCut** | M1 | 11 f, cut at 5/11: A 1→1.04, B 1.04→1.07; flash `#f5f2ed` 0.2 for 2 f | |
| **cover** (centred on the cut) | flash | M1 | `peak·max(0, 1 − |f − c|/(d/2))`, screen | CoverLayer |
| | dipToBlack / dipToWhite | M1 | out ≈ 0.4·d (12–20 f), hold ≈ 0.2·d (6–12 f), in = rest (≈ 12 f); switch mid-hold | |
| | glitch | M1 | 4–8 f noise bars **plus** derived fx `glitch` (6 slices ±20 px, 30 % near-clean frames by `hash(f)`) and `rgb` (8–20 px) | CoverLayer + FxLightLayer |
| | lightLeak | M2 | 15–30 f warm radial gradients, screen/add, intensity `sin(πp)` | CSS gradients |
| | filmBurn, whipStreaks, paperRip, dotWipe, iris | M3 | filmBurn 15–30 f orange→white radial + static feTurbulence mask (colour-dodge); whipStreaks 8 f, 15 blurred bars; paperRip 10–15 f torn-edge SVG mask; dotWipe 80 px grid, 13 f; iris 12 f circle close/open + ring | until implemented the director maps them (`DEFERRED_TRANSITIONS`) |
| **overlap** (`TransitionSeries.Transition`, `linearTiming({durationInFrames: d})`, d even) | dissolve | M1 | `fade()` | `@remotion/transitions/fade` |
| | push / wipe / blurDissolve | M3 | `slide({direction})`, `wipe()`, opacity + blur 0→8→0 px (calm 15–24 f) | `@remotion/transitions`, custom CSS presentation |

No HtmlInCanvas or shader transitions (R18): all CSS/SVG, so preview = render. CSS blur only inside transition windows ≤ 15 frames (expensive under swangle).

### 10.6 Fx envelopes and the camera rig (port `$SP/mgtest/motion.ts` `cueEnv`/`cameraState`)

```
t = f − cue.from
env(cue, f):
  f < cue.from − cue.pre                 → 0
  f < cue.from                           → q², q = (f − (cue.from − pre) + 1)/(pre + 1)
  t ≥ cue.dur                            → 0
  shape "hit":  cue.decay != null ? exp(−decay · t/fps) : (1 − t/max(dur,1))^curve
  shape "span": fx == "zoom" ? min(1, easeOutExpo((t+1)/max(fade,1)))           // zoom cut: snap in, hold, no fade-out
                             : min(1, (t+1)/max(fade,1), (dur − t)/max(fade,1))
CameraRig (one transform on the picture subtree; origin per cue = (x, y) when set, else the clip camera origin):
  scale  *= Π_punch (1 + amt·e) · Π_zoom (1 + amt·e) · Π_pulse (1 + amt·(1 − t/frames)²)
  shake  : hz != null ? x += amt·e·sin(2π·hz·t/fps), y += (ampY ?? .6·amt)·e·cos(2π·1.31·hz·t/fps)
                      : x,y += noise2D(seed+"x"/"y", t·0.9, 0)·amt·e; rot += noise2D(seed+"r", t·0.9, 0)·(rotDeg ?? 0.6)·e
           overscan: scale *= 1 + 2·|shake amt|·e/1080
  blur   : px = Σ blur.amt·e + Σ_punch 2·e³ (only when e > 0.05)
GraphicsLayer: items with followsCamera receive the punch/zoom part (not shake) of cues with target "picture+followers";
               cues with target "all" (impact shakes on slams) shake the picture AND the graphics layer (HUD never moves)
FxLightLayer: flash (screen, colour, opacity min(cap, Σ amt·e)) → rgb (2 tinted copies ±Σ amt·e px, only ≥ .5 px) → glitch (slices) → dark
Rules: start a glow after a flash, never with it; never double grain; quiet frames untouched; a timeline without fx renders like a plain render.
```

### 10.7 Component library (drama-commentary v1)

Props: §4.11. All motion is a function of `useCurrentFrame()` relative to the item's `from`; default ease expo.out `Easing.bezier(0.16,1,0.3,1)`; overshoot only where `COMPONENT_META.overshootAllowed`. Components with `continuousMotion` keep moving for their whole hold (card push 1.0→1.05 + an independent seeded backdrop drift). Unimplemented ids render **`FallbackCard`** — the item's main text in the KineticText look if it has text, else its first referenced asset as a framed card, else nothing — and are listed outside `IMPLEMENTED_COMPONENTS`.

| Component | M | Visual spec (brief §4.3 D/E + v2 additions) |
|---|---|---|
| `StillLayer` / cover | M1 | `<Img>` cover-fit on the source `crop` rect (`object-fit`/`object-position` from crop, else focal); camera keys (kb/monotone ease) |
| `CardFrame` (layout `card`) | M1 | contain-fit image at `heightFrac`·1080 px height, `borderPx` white border, `tiltDeg`, shadow (offsetY 35, blur 60, opacity .9) over `GeneratedBackdrop(backdrop, backdropSeed)` that drifts on its own (≈ 8 px/s + 1 %/10 s scale) — parallax for free; the camera keys move the card |
| `ContainBlur` | M2 | the same image at 1.2× scale, `blur(30px)`, `brightness(.4)` behind a contain-fit copy |
| `VideoLayer` | M1 | `@remotion/media` `<Video muted trimBefore>`; `disallowFallbackToOffthreadVideo` in tests |
| `PipFrame` (commentary frame) | M2 | clip at `heightFrac` (of the width) 76 %, radius 24 px, `stroke` (4 px accent or white), glow + shadow, `tiltDeg` ±2; entry `scale` (0.9→1, 10 f) / `tvOn` / `slide`; backdrop `blurSelf` (same clip ×1.2, blur 30, brightness .4) / `gradientGrid` / `paper`; `sourceLabel` chip bottom-left |
| `Treatment` | M1 | `bw`: grade.treatments.bw CSS (grayscale) and no split-tone; `archival`: sepia/contrast CSS + subtle gate weave (±1 px seeded); `duotone`: two-colour gradient map via SVG `feComponentTransfer` |
| `GeneratedBackdrop` | M1 | `gradientGrid` (dark pink→orange gradient + 150 px grid, 2.5 px lines, 5–9 % dark overlay), `paper`, `darkNoise`, `keywordCard` (big Anton text); seeded drift; theme texture overlay |
| `LowerThird` | M1 | 10 f mask reveal; name (Inter 800) > role (Inter 600); accent bar; slow 1.02 drift during the hold; exit 8 f |
| `ChapterCard` | M1 | textured backdrop (never flat ink), letterbox in over 20 f; kicker mono; title Anton, typed or mask reveal; entry slam (3 f) |
| `TitleSting` | M1 | video title slam (1.4→1.0 over 8 f expo.out) or typewriter; kicker; backdrop drift; 90–120 f |
| `QuoteCard` | M2 | B&W portrait (if any); serif italic; words appear at `words[].at`; highlight sweep (`backgroundSize` 0→100 %) on emphasis words; "TRANSLATED/TRADUCTION" chip; card push 1.0→1.05 |
| `SocialPost` | M2 | generic card (no platform logo), light/dark theme; slides up 12 f; counters and body highlight start at `revealAt`; optional image |
| `ArticleHighlight` | M2 | page racks in with an 8–12° rotateX tilt; camera moves to the target sentence over 20–30 f; the rest dims to 0.4 with 2 px blur; highlighter sweep 12–18 f starting at `highlightAt` |
| `DocumentCard` | M1 | paper texture, Courier Prime; redaction bars wipe in over 6 f at `redactAt`; stamp over 4 f with shake at `stampAt`; slow line-by-line camera drift |
| `HeadlineStack` | M2 | each item tilts in (`tiltDeg`) at its `at` with a 3 f slam, stacked with offsets; impact on the last |
| `Stamp` (**overshoot**) | M1 | 2.6×→1× over 0.09 s ease-in; bounce `1 + .05·sin(30t)·e^(−9t)`; ±10°; opacity .93; 3 f shake |
| `KeywordSlam` | M1 | 12–20 f on black/blur; 1.6→1.0 in 6 f expo.out; 3 f shake ±0.55 % width; ALL CAPS Anton |
| `NumberCounter` | M1 | 45–90 f expo.out roll; `Intl.NumberFormat(locale, currency incl. NLG)`; font grows with value; background blur 0→3 px; odometer digits; jitter on change |
| `DateStamp` | M1 | typewriter 2 f/char, mono, top-left |
| `MapPin` (offline) | M1 | d3-geo `geoMercator`/`geoNaturalEarth1` + `world-atlas/countries-110m.json` (topojson-client); paper or dark; camera fit to the places' bbox over 45–90 f; route `evolvePath` 30–60 f; pin pop at each `at`; scribble circle + label + red wash on the first place |
| `TimelineGraphic` | M2 | line draws on (`evolvePath`); dates pop at `at`; active index highlighted; camera tracks |
| `BarChart` | M2 | bars grow, stagger ≤ 15 f; highlighted bar in accent; source label |
| `SplitScreen` | M2 | divider wipe 10 f; two `StillLayer`s |
| `CensorBar` | M2 | black bar / pixelate (`image-rendering: pixelated` on a 1/16-scale copy) / blur on a normalised rect |
| `Spotlight` | M2 | dim outside a feathered ellipse to 40 %; circle drawn with `evolvePath` 8–10 f |
| `KineticText` | M1 | lines with per-word mask slide-up, stagger ≤ 15 f; 1.02 drift |
| `SourceLabel` | M1 | small mono chip (kinds → EN/FR labels) |
| `Letterbox` | M2 | bars for the ratio (2.39 → 132 px), 20 f in |
| `FreezeLabel` | M2 | `<Freeze frame={sourceFrame}>` of the asset video (cover); over 3 f desaturate (`desaturate`) and darken (`darken`); optional white-outline; name slams with spring (damping 14, stiffness 220), role below; held 45–90 f |
| `PhotoBurst` | M2 | images (as framed cards) at `items[].at` (accelerating 8→5 f), tilt per item; group scale `scaleFrom→scaleTo` (1.0→1.1); last image held ≈ 90 f; optional caption |
| `EvidenceBoard` | M2 | a 3840 × 2160 world (cork/paper/dark) with photo cards and labels; the virtual camera moves (`moves[]`, 20–30 f ease-in-out, dwell 45–90 f) between overview (−1) and items; items pop at `at`; optional red-string `links` drawn with `evolvePath` |
| `CommentPile` | M2 | 3–10 short comment cards popping at `at` (4–8 f apart) with ±5° jitter over a blur-dim (`dim`) of the picture; light/dark theme |

### 10.8 Captions

- **`KeywordCaptions`** (variant `keywords`, drama default, M1): groups `kw:*` render large (`keywords.sizePx` 96) in the caption band, pop 1.18→1.0 over 3 f, keyword colour on the hero word (scale `heroScale` 1.35), ALL CAPS, stroke 9 px `paint-order: stroke fill`.
- **`KineticCaptions`** (variant `pop`, M1; opt-in): one line in `zones.captionBand` (y 760–900); Archivo Black 78 px (70–90 via `fitText` after FontGate), weight 900, uppercase, `-webkit-text-stroke: 9px #000`; each word pops `popFrom` 1.18 → 1.0 over 3 f at `word.from`; tones keyword `#FFD400`, money green, danger red; hero words scaled.
- `karaoke` (M2): done/active/todo colours, active word heavier, underline grows with outCubic. `rail` (M2): 30 px / weight 600 at y ≈ 980 (minimal styles; true-crime preset uses mono).
- `ClipSubtitles` (M2): sentence case, `clipStyle` (smaller, boxed); `translation` groups carry a "TRANSLATED/TRADUCTION" chip.
- `srt` groups are never rendered.

### 10.9 Determinism rules and lint (`eslint.determinism.js`)

```js
export default [{
  files: ["packages/remotion/src/**/*.{ts,tsx}", "packages/remotion/hero/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-properties": ["error",
      { object: "Math", property: "random", message: "Use random(seed) from 'remotion' or rngFor()." },
      { object: "Date", property: "now", message: "No wall clock in frames." },
      { object: "performance", property: "now", message: "No wall clock in frames." }],
    "no-restricted-globals": ["error", "setTimeout", "setInterval", "requestAnimationFrame", "localStorage",
      "sessionStorage", "XMLHttpRequest", "WebSocket"],
    "no-restricted-syntax": ["error",
      { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "No wall clock." },
      { selector: "Property[key.name=/^(transition|transitionDuration|animation|animationName|animationDuration|willChange)$/]",
        message: "No CSS transitions/animations/will-change: derive every value from useCurrentFrame()." },
      { selector: "CallExpression[callee.name='fetch']", message: "No render-time network (only useTimeline/calculateMetadata)." },
      { selector: "CallExpression[callee.name='useState']", message: "Frames are pure functions of the frame." }],
    "no-restricted-imports": ["error", { paths: ["gsap", "p5", "three", "@remotion/gsap", "@remotion/google-fonts", "@docmaker/core/node"],
      patterns: ["node:*"] }],
  },
}, { files: ["packages/remotion/src/data/useTimeline.ts", "packages/remotion/src/Root.tsx", "packages/remotion/src/fonts/FontGate.tsx", "packages/remotion/src/fonts/styleFonts.ts"],
     rules: { "no-restricted-syntax": "off" } }];
```
Also: animate only `transform`, `opacity`, `filter`; no `preserve-3d` with opacity/filter; clamp local time ≥ 0 before `pow()`; guard NaN and negative radii; no `getBoundingClientRect` during animation. **R1 hero TSX** may import only `react`, `remotion`, `@remotion/paths`, `@remotion/noise`, `@remotion/shapes`, `@docmaker/remotion/lib/*`. The render package runs render-twice-and-diff (§16.2).

### 10.10 Fonts (self-hosted; no Google Fonts)

- `FONT_REGISTRY` = core `BUILTIN_FONTS` (Anton 400; Archivo Black 400; Inter 400/600/800/900; JetBrains Mono 400/700; Instrument Serif 400 + italic; Courier Prime 400/700; Special Elite 400), all `@fontsource/*@5.3.0` (OFL). A unit test asserts equality with `BUILTIN_FONTS`.
- `fonts.css.ts` statically imports `@fontsource/<f>/<w>.css` (latin + latin-ext with `unicode-range`: É À Ç in caps, œ/Œ, « », U+202F, €). Exported as `@docmaker/remotion/fonts`; the web root layout imports it (verified: Next 16.3.8 Turbopack builds fontsource CSS through such an export).
- `FontGate`: `delayRender("fonts")` until `document.fonts.load('<w> 64px "<family>"', FONT_TEST_STRING)` resolves for every family×weight; `measureText`/`fitText` never run before.
- **Style fonts (M2):** `StyleRenderTokens.fonts` URLs (served by the asset server from `<home>/styles/<id>/fonts/`) are loaded with `@remotion/fonts` `loadFont({family, url, weight, style})` inside FontGate; they do not change `codeHash`.

### 10.11 Media URLs

- `assetUrl(t, assetId, base) = ${base}/${t.assets[assetId].projectRel}?v=${assetId.slice(0,12)}` — the `?v=` query busts browser caches when a path is reused (e.g. `program/<lang>/vo_program.wav` after a new take); servers ignore it. No absolute filesystem paths; nothing from `public/`; footage is never bundled.
- **Render:** the render asset server serves the project dir read-only under an allowlist (`media/`, `program/`, `voice/`, `render/<lang>/<preset>/snapshot/`) plus the mount `styles/` → `<home>/styles` (M2), with CORS `*` and Range.
- **Player:** `/api/projects/<slug>/media/[...path]` with the same allowlist and Range (§14.3).

### 10.12 Looks

- **Grade:** CSS `filter: contrast() saturate() brightness() sepia() hue-rotate()` on the picture subtree, overridden per chapter by `grade.byAct[act]` (e.g. the collapse act darker); split-tone = two full-frame colour layers (shadows `mix-blend-mode: soft-light` at `amount·0.5`; highlights `overlay` at `amount·0.35`), **skipped on `bw` clips**; vignette = `radial-gradient(ellipse, transparent radius·100 %, rgba(0,0,0,amount) 100 %)` with feather (byAct `vignetteAmount`).
- **Grain and LUT are never rendered in the browser.** Master post (§12.3) applies `lut3d=<cube>` (33³ `.cube` from `LutParams`, generated by render) and `noise=alls=<grain>:allf=t`. The preview approximates the LUT with the CSS grade only.

### 10.13 Preview vs render

- Intended differences only: (1) grain and LUT absent in preview; (2) preview audio unmastered (no loudness normalisation or limiter); (3) fonts loaded in both; (4) the "SCRATCH VO" banner in preview.
- In the Player: `acknowledgeRemotionLicense` is passed **only when** `HomeConfig.remotionLicense` is set (§17.4; otherwise the web shows the licence card and does not mount the Player); `inFrame`/`outFrame` for chapter previews; keep the Player out of components that re-render on `timeupdate`; read `PlayerRef.getCurrentFrame()` via a throttled (10 Hz) `frameupdate` listener.

---

## 11. Audio (`@docmaker/audio`, W5)

```
packages/audio/src/
  index.ts
  sfx/{recipes.ts, generate.ts, analyze.ts, manifest.ts, packs.ts}
  music/{synth.ts, instruments.ts, moods.ts, generate.ts, library.ts}
  vo/assemble.ts            assembleVoProgram()
  mix/{mixer.ts, limiter.ts, pan.ts, stems.ts, worker.ts (worker_threads block renderer)}
  qa/{density.ts}
```
WAV I/O (`readWav`, `writeWav`, `createWavWriter`) and loudness (`measureEbur128`, `twoPassLoudnorm`) come from `@docmaker/core/node`; this package has no copy of them.

### 11.1 Mix targets (normative; brief §4.6 with conflicts resolved)

| Element | Target |
|---|---|
| Master | **−14 LUFS integrated**; loudnorm TP target −1.5; **gate: true peak ≤ −1.0 dBTP measured after the AAC encode** (render `loudnessGate`); LRA 11 (8 optional) |
| VO program | −16 LUFS (short-term −16 to −14), baked into `vo_program.wav`; voice ≈ 10 dB above music by RMS |
| Music, unducked | stem normalised to −18 LUFS, played at `noVoGainDb` (0 → −18…−20 LUFS) |
| Music under VO | ducked −12 dB (−26…−30 LUFS), 12–18 dB below VO |
| Whooshes | −24 to −18 dBFS peak |
| Impacts / booms | −12 to −6 dBFS peak |
| Pops, clicks, ticks | −22 to −16 dBFS peak |
| Ambience room tone | −38 to −32 dBFS peak |
| SFX duck under VO | −4 dB |
| Clip audio | −18 LUFS at conform, 0 dB; −10 dB under VO (L-cuts) |
| Ducking envelope | VO span −80 ms / +120 ms; attack 150 ms; release 400 ms; gaps < 0.6 s bridged; style range 8–15 dB |

### 11.2 Procedural SFX pack (`ensureSfxPack("procedural")`)

Port `$SP/sfx/make_sfx.sh` (verified on ffmpeg 6.1) to argument builders in `sfx/recipes.ts`; generate once into `<home>/sfx/procedural/v1/` at 48 kHz stereo under a machine lock (the 11 base sounds took 1.4 s in research). **Gotcha:** in `afftfilt`, `pts` is in samples (time = `pts/sr`). Entry ids are `procedural:<category>/<variant>`.

| Category | M | Recipe (ffmpeg) | Variants (duration × seed) | Sync | Loopable |
|---|---|---|---|---|---|
| whoosh.light | M1 | pink noise → time-varying Gaussian band-pass (`afftfilt`, centre `300+3200·ENV`, width `250+700·ENV`, ENV peak at P=0.65), **L→R pan** (`direction:"LR"`), `aecho` | 0.6 s × {3,7,11} | peak (≈ 0.65·D) | no |
| whoosh.heavy | M2 | same, D 1.2–1.6, centre `200+2400·ENV`, lowshelf +4 dB | 1.2, 1.6 × {5,9} | peak | no |
| whoosh.whip | M1 | D 0.35–0.45, P 0.5, narrow band | 0.4 × {2,4,6} | peak | no |
| whoosh.up | M1 | upward sweep (ENV rising to P 0.85) | 0.8 × {1,8} | peak | no |
| swell.reverse | M2 | pink noise band-pass 3 kHz, exp decay, echoes, `areverse` | 1.6 × {9,13} | end | no |
| riser | M1 | 3 detuned saws, chirp phase `110·D·(8^(t/D)−1)/ln 8` × `(t/D)^1.5`, accelerating tremolo + rising high-passed noise, 30 ms hard stop | 2, 4 s | end (−30 ms) | no |
| impact | M1 | sine 110→38 Hz `exp(−t/0.45)` + brown noise `lowpass=2500` × `exp(−t/0.035)`, `asoftclip`, `lowshelf=60:+4`, `aecho` | 2.0 s × {3,5,7} | onset (peak) | no |
| impact.soft | M2 | impact −8 dB, lowpass 1200 | 1.2 s | onset | no |
| boom.sub | M1 | sub drop 70→28 Hz, decay 0.9 s | 2.5 s × 2 | onset | no |
| boom.low | M1 | sub drop 55→35 Hz + filtered noise tail 1.5 s | 3.0 s | onset | no |
| thud | M1 | impact 0.4 s, lowpass 400 | × 3 | onset | no |
| pop | M1 | sine 900→420 Hz, 70 ms | × 3 (pitch ±8 %) | onset | no |
| click | M1 | 6 ms HP noise burst | × 3 | onset | no |
| tick | M1 | 3 ms click, HP 4 kHz | × 2 | onset | no |
| shutter | M1 | click + 40 ms band-passed noise + second click at +60 ms | × 2 | onset | no |
| ding | M1 | partials 1318/2637/3954 Hz, `exp(−t/0.35)` | × 2 | onset | no |
| notification | M2 | ding at 1568 then 2093 Hz (+120 ms) | × 2 | onset | no |
| glitch | M1 | gated square + bit-crushed noise (`acrusher`) | 0.6 s × {1,2,3} | onset | no |
| paper | M1 | pink noise 1–6 kHz with flutter (`tremolo=18:0.7`), 0.5 s | × 2 | onset | no |
| marker | M2 | band-passed noise scribble 2–5 kHz with 9 Hz AM, 0.6 s | × 2 | onset | no |
| keys | M1 | click train 9–14 Hz with jitter, 1.5 s | × 1 | onset | **yes** |
| tape.stop | M2 | falling saw (`220·(t−t²/1.6)`) + lowpass | 0.8 s | onset | no |
| drone | M1 | 55 + 82.4 Hz sines with 0.3 Hz beating, lowpass 400, 8 s, seamless loop (crossfaded ends) | × 2 | onset | **yes** |
| heartbeat | M2 | 2 low thumps 60 ms apart, 0.8 s period, 4 s | × 1 | onset | **yes** |
| bleep | M1 | 1 kHz sine at −18 dBFS, 1 s (trimmed to the word) | × 1 | onset | no |
| ambience.room | M1 | brown noise lowpass 300 Hz + pink noise band 200–800 Hz at −12 dB, slow 0.1 Hz AM, 10 s seamless loop | × 2 | onset | **yes** |
| ambience.crowd, cash, scratch | — | **not procedural**: only from opt-in packs (`allowComedic` for scratch) | — | — | — |

**Manifest build** (`analyze.ts`): decode each WAV (`readWav`); `peakOffsetMs` = index of max |sample| for `peak`/`onset` sounds (first sample above −30 dBFS when the attack is not the maximum), `duration − 30 ms` for `end`; `peakDbfs` = sample peak; `lufs` from `measureEbur128` for sounds ≥ 400 ms, else `null`; short sounds peak-normalised to the middle of their category range, longer ones loudnorm −20 LUFS then peak-checked; `loopable` and `direction` from the recipe; licence `PROCEDURAL`; `assetId` = sha256 of the file.

**Optional packs (M2):** `remotion-sfx-cc0` (`docmaker setup --sfx remotion`: only the CC0 subset of `@remotion/sfx` URLs — whoosh, whip, pageTurn, shutterOld, shutterModern, mouseClick, ding — via the proxy-aware HttpClient; meme sounds excluded); `hyperframes-pixabay` (imported from a user-supplied directory with its `manifest.json`; never redistributed); `user`. The director's variant selection prefers CC0 samples for signature hits when a pack provides them.

### 11.3 Procedural music (offline bed with an exact beat grid)

`generateMusic(o)` (signature §4.19): deterministic Node synth (Float32 → WAV, no dependencies; instrument ideas ported from kinetic-reel `score.mjs`, MIT, attribution).
- Instruments: **pad** (3 detuned saws, one-pole low-pass 1.2 kHz, attack 1.5 s); **bass pulse** (sine + sub on beats 1 and 3); **kick** (120→45 Hz sine, 180 ms; tense/epic/high energy); **hat** (30 ms high-passed noise on off-beats, tense); **pluck arp** (minor pentatonic, mysterious); **drone** (55 Hz with beating, ominous).
- Chord loops: i–VI–III–VII (tense/ominous), i–iv–VI–V (sad), I–V–vi–IV (uplifting), i–VII–VI–VII (epic).
- Tempo per mood (`musicPolicy.moodBpm`): ominous 70, tense 95, sad 72, uplifting 110, mysterious 80, epic 90, chill 85, comedic 115. Energy `low|mid|high` sets the instrument set.
- Length `bars` (default 64), loopable at the bar boundary; normalised to **−18 LUFS** (`twoPassLoudnorm`); `beatsMs`/`downbeatsMs` exact.
- **Music preparation lives in the engine** (§3.2): one track per (mood, energy) used by the beats, seed `project.seed ⊕ fnv1a32(mood + energy)`, cached in `<home>/music/procedural/<hash>.wav`, frozen via `assets.freezeFile`, listed in `assets/music.json`.
- `scanMusicLibrary(dir)` (M2): wav/mp3/flac/m4a, normalised with `audio-norm-v1`; moods from a sibling `moods.json` (`{file: [moods]}`) or the folder name, else `[]`; beat grid from `runSidecar("beats")` when available (comb search 80–180 BPM, ≈ 16 ms early, steady 4/4), else `[]`; licence from `license.json`, else the user must declare it (UploadDeclaration); never defaulted to USER-OWNED.

### 11.4 `assembleVoProgram({layout, projectDir, outRel})`

1. Stream-write a 48 kHz mono WAV (`createWavWriter`) of exactly `frameToSample48k(durationInFrames, fps)` samples. Each segment's samples are copied starting at `frameToSample48k(segment.from, fps)` (an exact integer for 24/25/30 fps, so the mix, the captions and the NLE clips share one clock). A segment with an `insertion` is copied in two parts: samples `[0, splitAt)` at the segment start, samples `[splitAt, end)` after `insertion.ms` of digital silence. Everything else is digital zero.
2. Measure integrated loudness (`measureEbur128`); apply `bakedGainDb = −16 − I` in Node with a sample-peak guard at −1.5 dBFS; return `{sha256, bakedGainDb, durationMs}`.
3. The engine records `voProgram.bakedGainDb`; NLE VO clips apply the same gain to the segment files.

### 11.5 Mixer (`mixTimeline(timeline, i)`)

```
sr = 48000; L = frameToSample48k(durationInFrames, fps); block = 10 s (rendered in a worker_threads worker, or yielding with setImmediate per block)
decode once to float32 48 kHz: voProgram (mono → L/R), music track files (stereo), clip audio (clip mp4 → wav), SFX files (preloaded)
G = computeGainTables(timeline)                    // the SAME function as the Player preview
for each block:
  zero buffers vo, music, sfx, clip (stereo)
  vo     += voProgram · G.vo                       // 0 dB: the program's gain is baked in; G.vo is 0 only inside bleep silences
  music  += Σ sections: src[(sourceIn + loop-wrapped offset)] · dbToGain(gainDb) · itemEnvelope · G.music   (crossfades = overlapping envelopes)
  sfx    += Σ cues: file (looped for `loop` cues, with fadeIn/fadeOut) · dbToGain(gainDb) · equal-power pan(pan)
            · (panSweep == "RL" && entry.direction == "LR" ? channel-mirrored : as-is) · G.sfx
  clip   += Σ items: file · dbToGain(gainDb) · (duckUnderVo ? G.clip : 1)
  table values interpolated per sample between frames, then a 5 ms one-pole smoother (no zipper)
  master = vo + music + sfx + clip; write raw f32 blocks for master + 4 stems
pass 1: measureEbur128(master_raw) → I, TP, LRA
gainDb = targetLufs (−14) − I
if TP + gainDb > truePeakTarget (−1.5): Node look-ahead limiter on master_raw (2.5 ms look-ahead, 80 ms release,
   ceiling = truePeakTarget − gainDb − 0.3 dBFS, 4× oversampled peak estimate) — sfx_mix.py semantics
apply gainDb to master and every stem (stems sum to the master except for limiter gain reduction, reported)
write mix.wav (s24 stereo 48 kHz) + stems/{vo,music,sfx,clip}.wav; re-measure → LoudnessDoc {integratedLufs, truePeakDbtp, lra, gainDb, limiterMaxGrDb, stems}
```
- `alimiter` is not true-peak (it measured 0.0 dBFS in research): the Node limiter plus the post-AAC gate are used instead.
- **Post-AAC gate** (render `loudnessGate`, §12.3): measure `ebur128=peak=true` on the final MP4 audio; TP > `truePeakGate` (−1.0) → re-mux with `volume=(gate − TP − 0.3)dB`, ≤ 2 attempts; still failing → `LOUDNESS_GATE` warning in QA; integrated loudness must stay within −14 ± 1 LUFS.
- `densityReport(t)` (qa stage): per-chapter RMS (a serious chapter ≈ 5 dB lower), clipping count, SFX/impacts per minute, silent-cut share; QA states "the mix was checked by meters only".

---

## 12. Render (`@docmaker/render`, W8)

```
packages/render/src/
  index.ts          RenderService, InProcessRenderClient, createAssetServer, computeCodeHash, ensureBrowserExecutable, generateLutCube, loudnessGate
  bundle.ts         codeHash + bundle cache (machine lock)
  browser.ts        browserExecutable resolution (env → <home>/browser.json → <repoRoot>/node_modules/.remotion → download only in setup)
  assetServer.ts    CORS + Range static server (port of $SP/rtest/render.mjs server)
  chunks.ts concat.ts post.ts mux.ts loudnessGate.ts stills.ts sheets.ts overlays.ts gl.ts presets.ts lut.ts
```
There is **no** web-facing render client: the web never renders in its own process; renders run inside the job worker (`apps/cli/src/worker.ts`) through `InProcessRenderClient`, exactly like the CLI.

### 12.1 Bundle once per code hash

- `codeHash = computeCodeHash(repoRoot)` = sha256 of sorted `[relative path + sha256(content)]` of `packages/remotion/src/**` and `packages/core/src/**` (excluding `src/node/**`) + the exact versions of `remotion`, `@remotion/*`, `@fontsource/*`.
- If `<home>/bundles/<codeHash>/index.html` is missing: take the machine lock `<home>/locks/bundle.lock`, then `bundle({ entryPoint: <repoRoot>/packages/remotion/src/entry.ts, outDir: <home>/bundles/<codeHash>, enableCaching: o.enableBundleCache ?? true, publicDir: <empty tmp dir>, onProgress })` (options object, 5.0 convention). The entry path comes from `config.repoRoot` (never `import.meta.resolve`). Tests pass `enableBundleCache:false` (concurrent webpack caches under one `node_modules/.cache` corrupt each other).
- `serveUrl` = that directory. Never bundle per render; never put footage in `public/`.

### 12.2 Presets

| Preset | Settings |
|---|---|
| `draft` | `scale: 0.5` (960×540), `x264Preset:"veryfast"`, `crf: 23`, `imageFormat:"jpeg"`, `jpegQuality: 80`, no grain, no LUT |
| `master` | `scale: 1`, `x264Preset:"medium"`, `crf: 18`, `imageFormat:"jpeg"`, `jpegQuality: 92`; post: `lut3d` (when `grade.lut`) + grain `grade.grainFfmpeg`; GPU host: `hardwareAcceleration:"if-possible"`, `videoBitrate:"10M"` |
| `overlay` (export, M3) | `codec:"prores"`, `proResProfile:"4444"`, `pixelFormat:"yuva444p10le"`, `imageFormat:"png"`, muted |

Every call passes `browserExecutable: config.browserExecutable`, `chromiumOptions: { gl }`, `timeoutInMilliseconds: 120000`, `logLevel: "warn"`, `concurrency: req.concurrency ?? min(os.availableParallelism(), 4)` (≤ 2 during P1 development, §0.4). Fallback/CORS/media warnings from `onBrowserLog` become `log` events. Tests set `disallowFallbackToOffthreadVideo`. `licenseKey: REMOTION_LICENSE_KEY` when set.

### 12.3 Render flow

```
render(req, h):
  withFileLock(config.renderLockFile)                     // one render per machine; progress detail {waiting:"render-slot"} while waiting;
                                                          // also waits while os.freemem()/os.totalmem() < 0.15
  gl = req.gl == "auto" ? (await probeGl()).chosen : req.gl
  { serveUrl, codeHash } = await ensureBundle(h.signal)
  browser = await openBrowser("chrome", { browserExecutable, chromiumOptions: { gl } })      // reused for every chunk (puppeteerInstance)
  server = await createAssetServer({ root: req.projectDir, allow: [/^media\//, /^program\//, /^voice\//, /^render\/[a-z]+\/[a-z]+\/snapshot\//], mounts: { styles: paths.styles } })
  inputProps = { timeline: null, timelineUrl: `${server.url}/${req.timelineRel}`, assetBaseUrl: server.url, mode: "render",
                 layers: all true except audio, itemId: null, scratchBanner: false }
  composition = await selectComposition({ serveUrl, id: "Documentary", inputProps, browserExecutable, chromiumOptions: { gl }, puppeteerInstance: browser })
  timeline = read(req.timelineRel)        // the SNAPSHOT copy (engine render stage: snapshot → release the project lock → render)
  ct = computeTimeline(timeline); chunks = planChunks(ct, req.chunkSeconds·fps) ∩ req.frameRange
  for chunk: hash = sliceHash(timeline, from, to, { codeHash, preset, premount: fps })   // chunk-relative
             file = render/<lang>/<preset>/chunks/<hash>.ts; exists → cached
             else renderMedia({ composition, serveUrl, inputProps, codec: "h264-ts", muted: true, frameRange: [from, to],
                    outputLocation: file + ".tmp", …preset, puppeteerInstance: browser, cancelSignal, onProgress }) → rename
  video.mp4 = ffmpeg -f concat -safe 0 -i list.txt -c copy -movflags +faststart     // VERIFIED frame-exact (3 chunks 40+40+35 → 115 frames, 3.8333 s)
  verify: ffprobe -count_frames == total frames, else re-encode concat (combineChunks fallback dropped)
  post (master): ffmpeg -i video.mp4 -vf "lut3d=<cube>,noise=alls=<grain>:allf=t" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart
  mux: ffmpeg -i video.mp4 -i <snapshot mix.wav | anullsrc> -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 256k -ar 48000 -t <exact seconds> -movflags +faststart final.mp4
  loudnessGate(final.mp4)                                   // §11.5
  write render.json (RenderDoc); browser.close(); server.close(); release the lock
```
Muting chunks and muxing one master track avoids the one-frame-per-join AAC drift measured in the motion-graphics repo.

**Throughput** (brief §3.9, 4 vCPU, 720p simple scenes): 24.4 frames/s at concurrency 4 → 30 min ≈ 37 min at 720p, 1.5–2 h at 1080p. Log `slowestFrames` per chunk.

### 12.4 Progress and cancel

- Weights: bundle 5 %, chunks 85 % (Σ(rendered + encoded frames) / (2 × total)), concat 3 %, post 5 % (renormalised when skipped), mux + gate 2 %; emitted as `progress{stage:"render", pct, message:"chunk i/n", detail:{renderedFrames, encodedFrames, fps, etaSec, chunk}}` at ≤ 4 Hz.
- Cancel: `makeCancelSignal()` per `renderMedia`, wired to `h.signal`; the in-progress chunk's `.tmp` is deleted; finished chunks stay cached; ffmpeg children are killed by process group.

### 12.5 GL probe

Render the `GlProbe` still with `gl ∈ ["angle-egl", "angle", "swangle"]` (30 s timeout each); the composition logs `UNMASKED_RENDERER_WEBGL`; `gpu = ok && !/SwiftShader|llvmpipe/i.test(renderer)`; first GPU-backed wins, else `swangle` (verified). Cached in `<home>/gl-probe.json` (`GlProbe`); `doctor` shows it.

### 12.6 Stills, contact sheets, generated stills, overlays

- `renderStills`: `renderStill` (jpeg) per frame; with `sheet`, tiles via **sharp** (`cols`, width 640, SVG label with frame/timecode). Default QA sheet: first/middle/last frame of each shot (≤ 60 tiles per sheet), one strip per transition type (c−3…c+3), one sheet per chapter.
- `renderGeneratedStills`: `renderStill` of `GeneratedStill` → PNG 1920×1080 (NLE export of `generated`/`solid` sources).
- `renderOverlays` (M3): `renderMedia` of `OverlayItem` with the `overlay` preset → `export/<lang>/overlays/<itemId>.mov`.
- `docmaker style preview <id>` renders `StyleSpecimen` stills into a contact sheet.
- `generateLutCube(LutParams)` → 33³ `.cube` (HyperFrames `luts/index.json` spec) cached in `<home>/cache/luts/<hash>.cube`.

### 12.7 Browser provisioning

`ensureBrowserExecutable(config, {download})`: `DOCMAKER_BROWSER_EXECUTABLE` → `<home>/browser.json` → `<repoRoot>/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell` (P0 copies `$SP/rtest/node_modules/.remotion` there) → only when `download` (i.e. `docmaker setup --browser`): Remotion `ensureBrowser()` with `cwd = repoRoot`, then write `<home>/browser.json`. Renders and tests never download implicitly: a missing browser is `TOOL_MISSING` with the hint `docmaker setup --browser`.

---

## 13. Export (`@docmaker/export`, W9)

```
packages/export/src/
  index.ts  toExportTimeline.ts  conform.ts  paths.ts  fcpxml.ts  xmeml.ts  otio.ts  edl.ts  srt.ts  readme.ts  bundle.ts  keyframes.ts  publish.ts  report.ts
packages/export/test/
  golden/{demo.fcpxml, demo_premiere.xml, demo_resolve.xml, demo.otio, demo_markers_resolve.edl, demo.srt}   (from $SP/tl/examples + new)
  dtd/{fcpxml-1.10.dtd, xmeml_dtd_4.dtd, xmeml_dtd_4_premiere.dtd, ATTRIBUTION.md}   (Apple © — test fixtures only, with attribution)
  scenario.ts   (the 12 s scenario of brief §8.6 as an ExportTimeline)
```
**One timeline drives everything:** the exporters read only the `Timeline` and the conform map — never `picks.json`, beats or layout — so render framing and NLE framing come from the same `VisualSource.crop/focal` and camera keys. Export depends on `direct` + `mix` only; it never waits for a render.

### 13.1 `toExportTimeline(timeline, ctx) → ExportTimeline`

- **V1 (spine)**, one `ExportClip` per `VisualClip`:
  - Media: image → the NLE-conformed still (cover-cropped to exactly 1920×1080 using `source.crop` when set, else around `source.focal`; PNG/JPG, EXIF baked); layout `card` → the still composited as a card is not portable: the plain cover still + a marker "card layout not portable"; video → the conformed MP4; `generated`/`solid` → the PNG from `renderGeneratedStills` (solid via ffmpeg `color`).
  - Camera → keyframes: `kenBurns`/`creep`/`reframe` with linear or `kb` ease and 2 keys → **2 keyframes** (scale and position); `expoOut`/`monotone`/pullBack → dense per-frame keys, capped at 60 per clip (evenly subsampled).
  - Punch and zoom fx overlapping the clip are **multiplied into** the scale keys (dense inside the fx window).
  - Shake, rgb, glitch, flash, dark, treatments (bw/archival/duotone) are not portable → clip marker `nle-note` "<fx> not portable".
  - Layouts `pip`/`contain-blur`/`split` → the source at scale 0.76 (pip) or 1.0 plus a marker "layout not portable".
- **Transitions:** `overlap` dissolve/blurDissolve → `ExportTransition{dissolve}` centred on the cut (`duration` even, so `cut ± d/2` are integer frames in every writer); cover `dipToBlack` → `ExportTransition{dipToBlack}`; every other cover and velocity accent → hard cut (+ an overlay clip with `--overlays` (M3), else a marker).
- **V2+:** with `--overlays` (M3), each overlay item becomes a ProRes 4444 clip (alpha) on V2 (graphics) or V3 (hud); without it, each item becomes a marker (name = component, note = key props). Captions go to SRT only.
- **Audio:**
  - A1: VO segment clips (`VoClip`, `gainDb` = `VoClip.gainDb` = the baked program gain, constant; parts `:b` after a REVEAL insertion are separate clips).
  - A2: music sections; gain keyframes sampled from `computeGainTables(t).music × dbToGain(section.gainDb) × envelope` at change points (|Δ| ≥ 0.5 dB, ≥ 3 frames apart) plus fades.
  - A3: SFX at constant gain (loops expanded into repeated clips; RL pan sweeps exported as the mirrored file conformed by `conformForNle`).
  - A4: clip audio (`ClipAudio`, WAV extracted from the clip MP4, `sourceIn` = `ClipAudio.sourceInFrames`) with gain keys from the clip table.
  - A5–A8: baked stems (vo, music, sfx, clip), full length, `enabled:false` (Resolve's gain-keyframe import is unverified).
  - Bleep silences (VO muted) are not portable on A1 → marker + the baked VO stem carries them.
- **Markers:** `timeline.markers` (chapters blue, ad breaks red, sponsor purple, fact-check yellow, sources green, pickup orange).

### 13.2 Conform for NLE (`conformForNle`)

- Every media file is copied or hardlinked into `export/<lang>/media/` with a unique ASCII-safe name `NNN_<slugified-name>_<id8>.<ext>`.
- Stills: PNG/JPG at exactly the sequence size (cover crop from `crop`/`focal`, or blur-pad for portraits); WebP/AVIF/GIF/SVG converted. **100 % scale means the same in every NLE** (Premiere scales native pixels; FCP and Resolve start from a fitted frame).
- Audio: 48 kHz WAV, one stream per file; VO segments are 48 kHz mono; music, SFX and clip audio extracted to stereo WAV; MP3 avoided (≈ 25 ms priming offset).
- Video: CFR H.264 as conformed (DNxHR/ProRes mezzanine for Resolve-free on Linux is R10).
- `paths.ts`: `writtenPath = exportRoot ? posixJoin(exportRoot, relative(exportDir, localPath)) : localPath`; FCPXML and OTIO use `pathToFileURL(writtenPath).href` (`é` → `%C3%A9`); xmeml uses the same URL with `file://` → `file://localhost`; names XML-escaped.

### 13.3 Writers (rules are normative; the validated examples are in brief §8.6)

**FCPXML 1.10** (`writeFcpxml(et, {version:"1.10"|"1.11"|"1.13"})`, xmlbuilder2: `create({version:"1.0",encoding:"UTF-8"}).dtd({name:"fcpxml"})`):
- Structure: `fcpxml > resources(format, asset>media-rep, effect) > library > event(name "DocumentaryMaker") > project(name) > sequence(format, duration, tcStart="0s", tcFormat="NDF", audioLayout="stereo", audioRate="48k") > spine`.
- **Time** is rational and frame-quantised: `t(f) = f === 0 ? "0s" : \`${f*den}/${num}s\``. At 30 fps that is `"195/30s"`; 29.97 uses `1001/30000s`.
- Formats: `r1 FFVideoFormat1080p30 frameDuration="1/30s" width=1920 height=1080 colorSpace="1-1-1 (Rec. 709)"`. **Stills** use a format with no frameDuration (`FFVideoFormatRateUndefined`, `colorSpace="1-13-1"`); the asset has `start="0s" duration="0s"` and is placed with `<video ref>`. When a still is the incoming clip of a dissolve, use `start="3600s"` so head handles exist.
- **Spine** = V1, as `asset-clip`/`video` items with `offset`, `start` = sourceIn and `duration`.
- **Connected clips** (lanes) are anchored inside a spine item. `lane="1".."n"` holds video above; `lane="-1".."-n"` holds audio. **The anchor `offset` is in the parent's local time: `parent.start + (timelineFrame − parent.offset)`.** Long audio is anchored to the first spine item and may extend past its parent.
- **No sequence-level markers.** `marker` goes inside spine items, at local time.
- `adjust-transform` uses `param name="scale|position|rotation"` with `keyframeAnimation/keyframe(time = clip.start + local frame, value)`:
  - `scale "s s"`;
  - **`position` = "dx/H·100 −dy/H·100"** (percent of frame height, +y up);
  - **`rotation = −deg`** (counter-clockwise positive).
- `adjust-blend amount mode` (10 Screen, 8 Add, 4 Multiply, 14 Overlay).
- `adjust-volume amount="xdB"` with `param name="amount"` keyframes.
- `audioRole` is `dialogue|music|effects`.
- Transition: `<transition name="Cross Dissolve" offset=t(cut − d/2) duration=t(d)><filter-video ref=rX name="Cross Dissolve"/></transition>` with effect `uid="FxPlug:4731E73A-8DAC-4113-9A30-AE85B1761265"` (d is even, so every value is an integer frame). Clips stay abutted; handles come from the media.
- `media-rep src` is an absolute `file:///` URL.
- Default version `1.10` (safe for Resolve 18+); configurable to 1.11 or 1.13.

**xmeml v4** (`writeXmeml(et, {flavour:"premiere"|"resolve"})`):
- `xmeml version="4" > sequence(id, [explodedTracks="true" premiere]) > name, duration, rate{timebase,ntsc}, timecode(00:00:00:00, NDF), media{video{format, track*}, audio{numOutputChannels 2, format, track*}}, marker*`.
- **All values are integer frames.** Clipitem `start`/`end` are sequence frames (end exclusive). `in`/`out` use the clipitem `<rate>`, which is always the sequence rate.
- `<file id>` is fully defined once, then referenced as `<file id="file-N"/>`.
- **Centred transition:** `transitionitem start=cut−d/2 end=cut+d/2 alignment=center`. The outgoing clip gets `end=-1` with `out` extended by d/2; the incoming clip gets `start=-1` with `in` pulled back by d/2.
- **Keyframe `when` = source frames** (`in + local`).
- Basic Motion (`effectid basic`): `scale` = 100·s (percent of native pixels; safe because media is conformed); `rotation` deg; **`center{horiz=dx/W, vert=dy/H}`** (empirical; verify).
- Opacity: `effectid opacity`, 0..100. `compositemode` normal/screen/add/multiply/overlay. Stills use `alphatype none`; overlays use `straight`.
- Audio Levels: `effectid audiolevels`, `parameterid level`, **linear `10^(dB/20)`, max 3.98109**.
- **Flavours:**

| | premiere | resolve |
|---|---|---|
| Sequence | `explodedTracks="true"` | plain |
| Stereo | 2 exploded tracks (`currentExplodedTrackIndex` 0/1, `totalExplodedTrackCount=2`, `premiereTrackType="Stereo"`, sourcetrack 1/2, linked) | one track per stem |
| Mono | `premiereTrackType="Mono"`, `premiereChannelType="mono"` | one track |
| Still `file/duration` | the frame count (otherwise Premiere assumes ≈ 12 h) | empty `<duration/>` |

**OTIO JSON** (`writeOtio(et, {premiereMetadata: true})`):
- `Timeline.1 > Stack.1 > Track.1(kind Video|Audio) > Clip.2 | Gap.1 | Transition.1(SMPTE_Dissolve, in_offset/out_offset = d/2)`, plus `Marker.2(color)`.
- `media_references.DEFAULT_MEDIA = ExternalReference.1{target_url, available_range}` and `active_media_reference_key:"DEFAULT_MEDIA"`. **A still's `available_range` must cover the clip's source range.**
- With Premiere metadata: `metadata.PremierePro_OTIO` on the timeline (`MetadataVersion`), on the stack (`VideoFrameRate`, `VideoResolution`, `AudioFrameRate`, `PixelAspectRatio`), and on clips (`Effect.1` entries):
  - `AE.ADBE Motion` — Position(1) `{X:0.5+dx/W, Y:0.5+dy/H}`, Scale(2) `100·s`, Rotation(5);
  - `AE.ADBE Opacity` — Opacity(1) %;
  - constant values use `StartValue{Position: RationalTime(-10800000)}`; animated values use `Keyframes[{Position: RationalTime(source frame), Value}]`.
- **Never add a no-op `LinearTimeWarp`.** Premiere then drops Motion and Opacity.
- Volume metadata is omitted (its units are unverified).
- `global_start_time` = `RationalTime(0, fps)`.

**Resolve marker EDL** (`writeMarkersEdl`):
- `TITLE: <name>\r\nFCM: NON-DROP FRAME\r\n\r\n`.
- One event per marker: `NNN  001      V     C        <tc> <tc+1f> <tc> <tc+1f>  \r\n |C:ResolveColor<Color> |M:<name> |D:<frames>\r\n\r\n`.
- CRLF line endings. Colours map red, blue, green, yellow, purple, cyan, orange → `ResolveColorRed`… Import it through Media Pool > Timelines > Import > Timeline Markers from EDL.

**SRT** (`writeSrt(timeline)`):
- Built from the `srt` groups (full grouping, §9.3 step 10) plus `clip` and `translation` groups; `keywords`/`pop` burned groups are never written (they are selective on-screen text).
- `HH:MM:SS,mmm` from frames. Lines are ≤ 42 chars, at most 2 lines. Text is in sentence case (captions are rendered uppercase only on screen). UTF-8.
- One file per language: `<slug>.<lang>.srt`.


### 13.4 Property mapping (dx/dy in px, y down; media conformed to 1920×1080)

| Property | FCPXML | xmeml | Premiere OTIO |
|---|---|---|---|
| Scale s | `"s s"` | `100·s` | `100·s` |
| Position | `"dx/H·100 −dy/H·100"` | `horiz=dx/W`, `vert=dy/H` (verify) | `X=0.5+dx/W`, `Y=0.5+dy/H` |
| Rotation (CSS clockwise) | `−deg` | `deg` (verify sign) | `deg` |
| Opacity | `amount 0..1` | `0..100` | `0..100` |
| Gain | `"xdB"` | `10^(x/20)` (≤ 3.98109) | n/a |
| Keyframe time | `clip.start + local frame` | `in + local frame` | `source_range.start + local frame` |


### 13.5 Bundle (`writeExportBundle`) — `export/<lang>/`

```
<slug>.<lang>.fcpxml   <slug>.<lang>.premiere.xml   [<slug>.<lang>.resolve.xml]   <slug>.<lang>.otio
<slug>.<lang>.markers.edl   <slug>.<lang>.srt   credits.md   publish.<lang>.md   editorial-report.<lang>.md   README.md
media/…   stems/{vo,music,sfx,clip}.wav   [reference.mp4 (hardlink of an up-to-date render, master preferred)]   [overlays/*.mov (M3)]
```
- `reference.mp4` is included only when a render of this timeline hash and mix hash exists; otherwise the README says "no reference render yet".
- **`README.md`** (EN with FR sections): Resolve — new project at 1920×1080 and the right fps → File > Import > Timeline → tick **"Use sizing information"** → then import the marker EDL (Media Pool > Timelines > Import > Timeline Markers from EDL); Resolve free on Linux cannot decode H.264/AAC (R10). Premiere — File > Import the `.premiere.xml`, or the `.otio` on 25.6.1+. FCP — File > Import > XML. Path remap (`exportRoot`) and relinking; what is baked vs native; the list of non-portable effects (markers); stems; the fair-use and credits reminder; the AI/synthetic disclosure checklist; the fact-check `asOf`; "users are responsible for their Remotion licence" (§17.4).
- **`publish.<lang>.md`** (`writePublishKit`, M2): title, thumbnail text, description (from `Project.publish[lang]`, else the style suggestion's first options marked "unreviewed"), chapter timestamps from the chapter markers (`00:00 Title` lines), credits block, disclosure checklist.
- **`editorial-report.<lang>.md`** (`writeEditorialReport`, M2): claims used (status, jurisdiction, `asOf`, source URLs); fact-check items with resolutions and notes; clips (URL, timecodes, cumulative seconds and share of runtime); AI images; voice provider and licence; person acknowledgements; a "not legal advice" footer.
- `credits.md` = `buildCredits(...)` for this language (§7.8).

### 13.6 Tests (W9)

- **Golden tests:** build `ExportTimeline` for the brief's 12 s scenario (photo 0–6 s zooming 100→120 %, 1 s centred dissolve, b-roll 6–12 s from source 10 s, alpha lower third 7–10 s, narration, music at −6 dB then −18 dB from 1–11 s then a fade, markers). Run every writer and compare with the goldens after normalising whitespace and ids.
- **DTD:** `xmllint --noout --dtdvalid test/dtd/fcpxml-1.10.dtd` and the xmeml v4 + Premiere ATTLIST DTD. These tests are skipped when `xmllint` is missing.
- **Round-trip (optional CI job):** Python `opentimelineio==0.18.1` + `otio-fcp-adapter` reads the xmeml back (dissolve centred at frame 180, 15/15) and the `.otio` (360 frames, 4 tracks).
- **Paths:** spaces, `é`, `exportRoot` remap, and `file://localhost` for xmeml.
- **Single source of truth:** a Timeline whose image source has a `crop` produces a conformed still cropped to that rect (pixel check), and the exporter never opens `picks.json` (fs spy).
- **Even transitions:** an `ExportTransition` with an odd duration is rejected by the schema.
- **SRT:** keyword groups are excluded; every spoken word appears exactly once.
- **Manual NLE smoke checklist** (`docs/NLE-SMOKE.md`):
  - xmeml centre units and sign;
  - FCPXML still start of 3600 s;
  - Resolve gain keyframes, and markers from xmeml and OTIO;
  - Resolve 20 acceptance of 1.11.

---


---

## 14. Web app (`apps/web`, W11) — Next.js 16 App Router

### 14.1 Stack, configuration, runtime

- Next **16.3.8** (Turbopack), React **19.3.0**, Tailwind **4.3.3** (`@tailwindcss/postcss`), `@remotion/player@4.0.532`. No UI framework beyond React + Tailwind and small local components.
- `next dev -H 127.0.0.1 -p 3210` / `next start -H 127.0.0.1 -p 3210`: a **local, single-user tool** (auth is R12).
- Source layout: `src/app/**` (routes and pages), `src/components/**` (**all client components**; lint bans `node:*` and `@docmaker/core/node` there), `src/server/**` (`import "server-only"`; engine host, guards), `src/i18n/{en,fr}.ts` (UI strings; language from `HomeConfig.uiLang` → `Accept-Language`, with a toggle).

```ts
// apps/web/next.config.ts
import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: [
    "@docmaker/core", "@docmaker/styles", "@docmaker/remotion", "@docmaker/engine", "@docmaker/llm", "@docmaker/assets",
    "@docmaker/voice", "@docmaker/audio", "@docmaker/director", "@docmaker/export",
  ],
  serverExternalPackages: ["sharp", "sherpa-onnx-node", "@remotion/install-whisper-cpp", "linkedom"],
  typescript: { ignoreBuildErrors: true }, // `pnpm typecheck` is the type gate
};
export default config;
```

**Engine host** (`src/server/runtime.ts`, `import "server-only"`):
```ts
const g = globalThis as unknown as { __docmaker?: Promise<Engine> };
export const getEngine = () => (g.__docmaker ??= (async () => {
  const repoRoot = process.env.DOCMAKER_REPO_ROOT ?? findRepoRoot(process.cwd()); // next runs with cwd = apps/web
  return createEngine({
    cwd: repoRoot, renderClient: null,
    runner: { kind: "worker", workerPath: path.join(repoRoot, "apps/cli/src/worker.ts") }, // never import.meta.resolve
  });
})());
```
The Next process only does cheap work (reads, writes, approvals, estimates, styles, live search, freeze, upload, SSE relay). **Every job runs in the forked job worker** (§5.5), which renders through `InProcessRenderClient`; sherpa synthesis, the mixer and ffmpeg orchestration therefore never block SSE pings, media Range requests or other routes. The web app never imports `@docmaker/render`, `@remotion/bundler` or `@remotion/renderer`. Route handlers declare `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`.

### 14.2 Pages and flows

| Route | M | Purpose and main UI |
|---|---|---|
| `/setup` | M2 | First-run onboarding (redirected to when `doctor` reports a blocking failure or `HomeConfig.remotionLicense` is unset): steps Chrome Headless Shell → optional Kokoro/Piper → optional Python sidecar → keys (optional, explicit consent to write `<home>/.env`) → Wikimedia contact (optional) → **Remotion licence** (choice "individual or ≤ 3-person company" / "company licence", terms summary + link) → "Run demo". |
| `/` | M2 | Project list (title, languages, last updated, next action, active job), "New project", "Run demo" (fixture, offline) |
| `/new` | M2 | Idea textarea; languages (EN/FR) + primary; target minutes (5–60, default from HomeConfig); **instant offline style suggestion** (`engine.suggestStyleForIdea(idea, {useLlm:false})` on debounce) with ranked cards, plus an optional "Ask Claude" button (cheap, cost shown); the user picks/confirms the style (sets `styleConfirmed`); LLM mode (Anthropic needs a key; Fixture); a **whole-pipeline estimate** (`estimatePipeline`) before submitting. Submit → `POST /api/projects` then a pipeline job `research → outline` (stops at the outline gate) and redirects. |
| `/p/[slug]` | M2 | **Overview**: stages done/stale/blocked/running/failed with `blockedBy` + reason badges (unmet / stale); gate banners (approve outline, acknowledge N items, confirm cost $X, fair-use notice, person approvals, recheck); Run next / Run to … / Force; **Approve & continue** on waiting jobs; cost so far vs `maxUsdTotal`; the live job log (SSE) with per-stage progress (incl. "waiting for render slot"); reattaches to `activeJobId` after reload. |
| `/p/[slug]/research` | M2 | Dossier; fact-sheet tabs (sources, people + QID + **person approvals** for non-public persons, timeline, claims with status/jurisdiction/decision/subject response/`asOf`, quotes with verification badge, figures, gaps); style card (refined ranking, titles, thumbnail texts, risk flags, theme override editor); "Use this style" (shows `engine.impact` first when it changes anything). |
| `/p/[slug]/outline` | M2 | Editor: title, **thesis** (must be edited or explicitly confirmed → `thesisConfirmed`), chapters (title, act, target seconds, purpose, exit hook, ad break), teasers and loops, per-language budget panel; **Approve outline**. Impact dialog before edits that stale downstream work. |
| `/p/[slug]/script/[lang]` | M2 | Chapter tabs; segment rows (type, `displayText`, spoken-text toggle → `ttsTextEdited`, fact chips, device); lint issues returned by every save (`writeDoc` re-lints and runs deterministic fact-checks for free); "out of sync" badge + **Transcreate** on secondary segments; chapter **lock** toggle; history/revert. **Fact-check panel**: verdict, risk, surface (narration / on-screen / title…), problem, suggested rewrite → *Apply rewrite* / *Acknowledge* (note ≥ 10 chars) / *Dismiss* (note); fix-only items have no ack button; "stale" banner when the script or on-screen text changed since the check, with *Re-check changed chapters*. Teleprompter download. |
| `/p/[slug]/scenes` | M2 | **Scene board**: chapters → beat cards (beat text in the chosen language, visual kind, cue tags, motion template + JSON editor validated live against `MotionData` incl. fact refs, picks per slot with licence badges; **orphaned** picks shown separately with "re-apply"/"discard"). *Change* opens the **asset picker**: stored candidates; live search (paid providers hidden unless the user confirms the price → `allowPaid`); upload with the **licence declaration form** (own work / licensed (code, author, URL) / third-party quotation / AI-generated); "use as slot N" → `POST …/assets/freeze` (server re-derives the candidate) → `user-picks.json` → a coalesced `direct` job per language. Manual clip resolution for clip segments (URL or file + in/out). Documents written by a running job are read-only. |
| `/p/[slug]/voice/[lang]` | M2 | Active take (scratch / final, provider, licence); provider + voice (`/api/voices`, cloned voices require the consent statement), speed and settings, lexicon editor, **cost estimate**, Generate (final take; gated); takes list (activate → layout → direct → mix cascade); segment table (duration, timing source, WER, play, "edited after take"); **Upload recordings** (global or per segment); pickup-TTS toggle; Calibrate. M3: in-browser teleprompter recorder (MediaRecorder per segment, large text, auto-scroll at the calibrated cps, mirror toggle, retake) uploading to `voice/<lang>/recordings/<segmentId>-<n>.webm`. |
| `/p/[slug]/preview/[lang]` | M2 | **Player** synced with the script (§14.4), "SCRATCH VO" banner and "N segments changed since the active take" banner; chapter selector (`inFrame`/`outFrame`); chapter strip with markers and SFX ticks; overlay list with actions (remove, change transition, change layout) → `overrides.json` (fingerprinted) → `direct`; rejected overrides listed. |
| `/p/[slug]/render` | M2 | Per language: preset, GL probe result, Render whole film or **chapter range** (`frameRange` from the chapter strip; draft), progress per chunk, ETA, cancel; output player + download; QA report; **Export timeline only** (no render needed) with format checkboxes, overlays toggle (M3), `exportRoot`; file links. Blocked states explain the gate (e.g. "fact-check stale: re-check 2 chapters"). |
| `/p/[slug]/publish/[lang]` | M2 | Title, thumbnail text, description chosen from the suggestions or edited freely → `Project.publish[lang]`; ACCUSATORY check on every change; re-runs the fact-check on title/thumbnail/description only (cheap); previews the publish kit. |
| `/p/[slug]/credits` | M2 | Ledger table joined with usage (asset, provider, licence, author, used in), voice licence, `credits.<lang>.md` preview with copy, warnings (BY-SA, personality, fair use, AI-generated, synthetic voice, unknown rights). |
| `/styles` | M2 | Style gallery: built-in and user styles (`StyleSummary`), specimen contact sheet, "New style from…" (scaffold into `<home>/styles`), validation issues. |
| `/settings` | M2 | Keys: masked status per key; **set/replace** (explicit consent "write to ~/.documentarymaker/.env", 0600) and **Test** (`/api/keys/test`: cheap authenticated call, returns ok + ElevenLabs tier); contact string; default languages/minutes/style; UI language; Remotion licence status; paths; **Doctor** report; setup actions as jobs (browser, SFX pack, Kokoro/Piper, Python sidecar, yt-dlp, CLIP). Secrets never enter project files. |

### 14.3 Route handlers (`src/app/api/**/route.ts`)

| Method | Path | Body / query → response |
|---|---|---|
| GET / POST | `/api/projects` | → list / `NewProjectInput` → `Project` |
| GET / PATCH | `/api/projects/[slug]` | → `Project` / partial patch (zod-validated; `LOCKED_AFTER_START` rejected) |
| POST | `/api/projects/[slug]/impact` | `Partial<Project> \| {doc}` → `ImpactReport` |
| GET | `/api/projects/[slug]/status` | → `{stages, costUsd, activeJobId, queued}` |
| GET / PUT | `/api/projects/[slug]/docs/[...rel]` | allowlist = `DOC_REGISTRY` entries with `userEditable` (outline, script, factcheck, plans, slices, user-picks, overrides, factsheet, entities, active take); GET returns `ETag`; PUT requires `If-Match` (412 on mismatch), validates, runs `checkRefs`/`validatePick`/re-lint and returns `{etag, issues}` |
| GET / POST | `/api/projects/[slug]/history/[...rel]` | → versions / `{file}` revert |
| GET | `/api/projects/[slug]/timeline/[lang]` | → `Timeline` (+ `ETag`); `?layout=1` → layout |
| GET / POST | `/api/projects/[slug]/jobs` | → active + queued + recent `JobRecord`s / `JobRequest` → `{jobId, coalesced}` |
| POST | `/api/jobs/[id]/resume`, `/api/jobs/[id]/cancel` | → `{jobId}` / 204 |
| GET | `/api/jobs/[id]/events` | **SSE** (§14.5) |
| GET | `/api/projects/[slug]/estimate?stage=&lang=` · `/api/projects/[slug]/estimate-pipeline?from=&to=&langs=` | → `CostEstimate \| null` · `PipelineEstimate` |
| POST | `/api/projects/[slug]/approvals` | `{gate, stage, lang, planHash, note, items, itemNotes}` → 204 (per-gate validation; editorial gates refuse `by:"flag"`) |
| GET | `/api/projects/[slug]/assets/search?beat=&q=&kind=&providers=&allowPaid=` | → `CandidateRecord[]` (records cached server-side) |
| POST | `/api/projects/[slug]/assets/freeze` | `{beatId, slot, provider, providerAssetId}` → `{asset, issues}` (the client never sends licence data) |
| POST | `/api/projects/[slug]/upload?kind=asset\|recording&lang=&segmentId=` | multipart (≤ 2 GiB, streamed) + `declaration` (required for assets) → `{rel, asset}` |
| POST | `/api/projects/[slug]/clips/resolve` | `{segmentId, url?, uploadRel?, startMs, endMs, channel, title}` → `{issues}` |
| GET | `/api/projects/[slug]/media/[...path]` | static with **Range** (206); allowlist `media/`, `program/`, `voice/`, `render/`, `export/`, `qa/`; traversal guard; `?v=` ignored |
| GET / POST | `/api/styles` · `/api/styles/suggest` | → `StyleSummary[]` · `{idea, useLlm}` → `StyleSuggestion` |
| GET | `/api/voices?provider=&lang=` | → `VoiceInfo[]` |
| GET / PATCH | `/api/home` | → `HomeConfig` / patch |
| POST | `/api/keys` · GET `/api/keys/test?name=` | `{name, value, consent:true}` → 204 · → `{ok, tier, message}` |
| GET | `/api/doctor` | → `DoctorReport` |

**Guards (`src/proxy.ts`; Next 16 renamed `middleware` to `proxy`):** reject any request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` (403; DNS-rebinding protection); mutations require an `Origin` matching the host; GETs of `docs`, `media`, `timeline`, `history` require `Sec-Fetch-Site ∈ {same-origin, none}` when the header is present; bodies > 5 MB rejected except uploads. The proxy buffers bodies, so `/api/projects/[slug]/upload` is excluded from its matcher and runs the same `checkRequest` (`src/server/guards.ts`) itself.

### 14.4 Player integration (client component, `src/components/PreviewPlayer.tsx`)

```tsx
"use client";
import { Player, type PlayerRef } from "@remotion/player";
import { Documentary, type DocProps } from "@docmaker/remotion";
import { computeTimeline } from "@docmaker/remotion/compute";
import type { Timeline } from "@docmaker/core";

export function PreviewPlayer(p: { slug: string; timeline: Timeline; range: [number, number] | null; licenseAcknowledged: boolean;
  onFrame: (f: number) => void; playerRef: React.RefObject<PlayerRef | null> }) {
  const ct = useMemo(() => computeTimeline(p.timeline), [p.timeline]); // calculateMetadata does not run in <Player>
  const inputProps = useMemo<DocProps>(() => ({
    timeline: p.timeline, timelineUrl: null, assetBaseUrl: `/api/projects/${p.slug}/media`, mode: "preview",
    layers: { picture: true, graphics: true, captions: true, hud: true, covers: true, audio: true }, itemId: null,
    scratchBanner: p.timeline.takeKind === "scratch",
  }), [p.timeline, p.slug]);
  useEffect(() => { /* addEventListener("frameupdate") throttled to 10 Hz → p.onFrame(frame) */ }, []);
  if (!p.licenseAcknowledged) return <RemotionLicenseCard />; // §17.4 — never acknowledge on the user's behalf
  return <Player ref={p.playerRef} component={Documentary} inputProps={inputProps} durationInFrames={ct.durationInFrames}
    fps={ct.fps} compositionWidth={1920} compositionHeight={1080} controls acknowledgeRemotionLicense
    inFrame={p.range?.[0]} outFrame={p.range?.[1]} style={{ width: "100%", aspectRatio: "16/9" }} />;
}
```
- The **script panel** reads `layout/<lang>.json` words; clicking a word calls `playerRef.current.seekTo(word.from)`; the active word is found by binary search on `onFrame` and the panel auto-scrolls without re-rendering the Player.
- `app/layout.tsx` imports `@docmaker/remotion/fonts`.

### 14.5 Jobs and SSE

- `GET /api/jobs/[id]/events` returns `new Response(ReadableStream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } })`; each event is `id: <seq>\nevent: <type>\ndata: <JSON>\n\n`; the handler replays `jobs/<id>.ndjson` after `Last-Event-ID`, then streams live events (pushed by the job worker over IPC and confirmed by tailing the file), sends `: ping` every 15 s and closes after `job-end`.
- The client uses `EventSource` and a reducer keyed by stage for progress bars; after `job-end` it refetches status and documents; on reload it reattaches through `status.activeJobId`.

### 14.6 Web tests (W11)

- Route handlers through `next/server` request objects (M2): docs ETag 412; media Range 206 and traversal 403; Host-header 403; Origin check; SSE framing and replay after `Last-Event-ID`; freeze ignores client licence fields; upload without a declaration → 400.
- **Playwright smoke** (M3, `pnpm --filter @docmaker/web test:ui`, nightly) on the `gate-test` fixture with editorial gates NOT auto-approved: approve the outline (thesis confirm) → acknowledge a high item → edit the script → verify render is blocked as stale → re-check → swap an asset → preview seek from a word → draft render CH1 → export timeline-only → download.

---

## 15. CLI and job worker (`apps/cli`, W10) — `docmaker`

`commander@15`. Entry `apps/cli/src/main.ts` run through tsx (`pnpm docmaker …` or `bin/docmaker.js` = `#!/usr/bin/env -S node --import tsx`; when a proxy variable is set the shim re-execs with `NODE_USE_ENV_PROXY=1`). Configuration comes from `loadRuntime({cwd})` (repoRoot discovery; `<home>/.env` and `<repoRoot>/.env.local`; no dotenv). The CLI runs the engine **in-process** with an `InProcessRenderClient`. `apps/cli/src/worker.ts` is the **job worker** the web app forks: `runJobWorker({ renderClient: new InProcessRenderClient({config, logger}), cwd: repoRoot })`.

**Global options:** `--projects-dir <dir>`, `--home <dir>`, `--log-level <lvl>`, `--json` (NDJSON `JobEvent`s), `-y, --yes` (approves **cost** and style-confirm gates only — never editorial gates), `--max-cost <usd>` (cost gate only), `--force`, `--new-request` (bypass paid receipts once), `--force-overwrite-edits`.

**Exit codes:** 0 ok · 1 error · 2 usage · 3 waiting for approval (gate) · 4 canceled.

### 15.1 Commands

| Command | Flags | Action |
|---|---|---|
| `new "<idea>"` | `--slug`, `--lang en,fr`, `--primary <lang>`, `--minutes <n>`, `--style auto\|<id>` (`<id>` confirms; `auto` shows the offline ranking and asks), `--llm anthropic\|fixture`, `--fixture <id>`, `--seed <n>` | create a project; prints the slug and the pipeline estimate |
| `status [slug]` | | stage table (stale/blocked reasons), costs, active job |
| `research <slug>` | `--resume` | research stage (cost gate) |
| `style <slug>` | `--pick <id>`, `--confirm`, `--llm` | suggest (offline; `--llm` refines), pick and/or confirm |
| `style new <id>` / `style validate <dir>` / `style preview <id>` | `--from <baseId>` | scaffold into `<home>/styles/<id>`; lint a style dir; render a `StyleSpecimen` contact sheet |
| `outline <slug>` | `--approve`, `--confirm-thesis`, `--note` | outline; `--approve` requires a confirmed thesis |
| `script <slug>` | `--lang <l>`, `--chapter <CHn>`, `--force-overwrite-edits` | write or rewrite chapters |
| `beats <slug>` | `--replan CH3,CH4` | beat plans (+ slices for every language) |
| `factcheck <slug>` | `--lang`, `--ack FC-…,FC-…` (TTY: asks per item), `--ack-file <json>` (non-interactive: `{id: note}`), `--dismiss FC-…`, `--note "<text>"`, `--recheck` | audit; acknowledge; recheck pending statuses |
| `approve <slug> <gate>` | `--stage`, `--lang`, `--items`, `--item-notes <json>`, `--note` | generic approval with per-gate validation |
| `persons <slug>` | `--ack P3 --note "<text>"` | person-ack for non-public persons |
| `assets <slug>` | `--offline`, `--providers a,b`, `--beat <id>`, `--no-youtube`, `--allow-paid` | resolve assets |
| `assets import <slug> <dir>` | `--declare own-work\|licensed:<CODE>:<author>:<url>\|third-party:<url>\|ai-generated` (**required**), `--tags a,b` | local import with a licence declaration |
| `assets clip <slug> <segmentId>` | `--url U \| --file F`, `--from mm:ss`, `--to mm:ss`, `--channel`, `--title` | manual clip resolution |
| `voice <slug>` | `--lang`, `--scratch`, `--provider elevenlabs\|kokoro\|piper\|synthetic`, `--voice <id>`, `--model <id>`, `--speed <x>`, `--segments ids`, `--retry-bad`, `--consent "<statement>"` (cloned voices) | TTS take (final unless `--scratch`) |
| `voice import <slug> <files…>` | `--lang`, `--per-segment`, `--aligner faster-whisper\|whisper-cpp\|auto`, `--pickup-tts <provider>` | user recording |
| `voice calibrate <slug>` / `voice teleprompter <slug>` | `--lang`, `--out <file>`, `--mirror` | chars/sec; HTML teleprompter |
| `layout` / `direct` / `mix <slug>` | `--lang`, `--chapters CH1,CH2` (→ `onlyChapters`) | |
| `preview <slug>` | `--lang`, `--sheet`, `--frames 0,120,300`, `--studio` (Remotion Studio with the timeline), `--web` | stills and contact sheet |
| `render <slug>` | `--lang`, `--preset draft\|master`, `--gl auto\|swangle\|angle\|angle-egl`, `--concurrency <n>`, `--chunk-seconds <n>`, `--range a:b`, `--chapters CH2` | render (editorial gates) |
| `export <slug>` | `--lang`, `--formats …`, `--overlays` (M3), `--export-root <path>`, `--fcpxml-version 1.10\|1.11\|1.13` | timeline export (no render needed) |
| `qa <slug>` | `--lang`, `--preset` | QA report |
| `run <slug>` | `--from <stage>`, `--to <stage>`, `--lang`, `--resume <jobId>` | pipeline (one pipeline estimate + approval); resume after a gate |
| `jobs <slug>` | `--cancel <jobId>` | list / cancel jobs |
| `cost <slug>` | | estimates, receipts, total vs cap |
| `credits <slug>` | `--lang` | print credits |
| `keys set <name>` / `keys test <name>` / `keys list` | (hidden prompt) | write `<home>/.env` (0600) / test / masked status |
| `demo` | `--fixture tulip-mania`, `--lang en\|fr\|all` (default en), `--offline` (default) / `--online`, `--tts auto\|synthetic\|kokoro\|piper` (default auto → synthetic without a model), `--preset draft\|master` (draft), `--only-chapters CH1,CH2`, `--slug`, `--keep` | full offline pipeline → prints MP4, export dir, QA summary |
| `doctor` | `--json` | environment report (§15.3) |
| `setup` | `--all`, `--browser`, `--sfx [procedural\|remotion]`, `--tts kokoro\|piper:<voice>`, `--python`, `--yt-dlp`, `--whisper faster-whisper\|whisper-cpp`, `--clip` | download, install, verify (idempotent) |
| `cache gc` | `--dry-run` | evict unreferenced blobs above the cap |

### 15.2 `demo` (engine `runDemo`)

1. Create `demo-<fixture>-<yyyymmdd-hhmmss>` (or `--slug`) from `fixtures/<id>/fixture.json`: `llm.provider:"fixture"`, `styleId` + `styleConfirmed:true`, languages, `assets.offline = !--online`, voice provider from `--tts`, `captions:"burn"`.
2. Submit a pipeline job `research → qa` for the languages with `options.onlyChapters`; gates auto-approve with `by:"fixture"` (tulip-mania has `autoApproveGates:true`). With `--tts synthetic` the final take is synthetic (ungated).
3. Print `final.mp4`, the export directory and the QA summary; exit 0.

### 15.3 `doctor` checks

| Check | Pass condition | Hint |
|---|---|---|
| Platform | Linux x64 / macOS; native Windows → error | "use WSL2" |
| Node / pnpm | ≥ 22.12 < 23 / 10.x | |
| `NODE_USE_ENV_PROXY` | set when a proxy variable is set | the bin shim sets it |
| ffmpeg / ffprobe | ≥ 6.1 with the required filters (§2.1), libx264, aac | |
| tar | present (model extraction) | |
| Chrome Headless Shell | `browserExecutable` resolves | `docmaker setup --browser` |
| GL probe | result shown | |
| Fonts | `FontSpecimen` renders without fallback warnings | |
| Remotion licence | `HomeConfig.remotionLicense` set; `company-license` without `REMOTION_LICENSE_KEY` → warning | `/setup` |
| xmllint | present (optional) | |
| Python sidecar | venv + faster-whisper + yt-dlp (optional) | `docmaker setup --python` |
| yt-dlp | version, JS runtime, **reachability probe** (`ok \| bot-check \| 403 \| offline`) | degraded mode: manual clip import |
| TTS models / whisper.cpp / CLIP | present (optional) | |
| API keys | presence, masked | `docmaker keys set` |
| Contact | set (warn when unset; Wikimedia etiquette) | |
| Disk | free space for home and projects; cache size vs cap | `docmaker cache gc` |
| HyperFrames residue | `~/.claude/skills/hyperframes*`, `~/.agents/skills/*`, `~/.hyperframes/config.json` | remove by hand (brief §9.3) |

---

## 16. Testing strategy

### 16.1 Unit tests (each agent in its own package; `vitest run`; no Chrome, no network)

| Package | Must-have tests |
|---|---|
| core (F) | every schema parses a valid sample and rejects 2 invalid ones (incl. odd overlap durations, segment prefix mismatch, duplicate fact ids); `canonicalJson`/`stableStringify` stability; **pure-JS SHA-256** vectors + property test vs `node:crypto`; `docHash` ignores `VOLATILE_KEYS` at any depth; `tokenizeDisplay` FR cases (« », U+202F, apostrophes, `l’Écluse`, `1 637`); `spokenText` per mode; `beatWordRanges` (exact, failing); `resolveAnchor` (all refs, clamp, missing → `ANCHOR_MISSING`); `resolveTimeline` (identity on a director-like timeline, throws on another layout hash); `computeGainTables` golden (spans, bridge, silences incl. `vo`); `checkRefs` codes; `validateLangParity`; `migrateDoc` chain + `MIGRATION_FAILED`; `ProjectStore` atomic write, docHash skip, ownership refusal, history (20), etag conflict, lock (stale pid takeover); `loadRuntime` precedence, `userAgentFor` (contact only for allowlisted hosts; nothing from git/OS/hostname); `readWav`/`writeWav` round trip; `twoPassLoudnorm` on a synthetic tone (−18 ± 0.5 LUFS); `chapterCardReadMs`; **testing factories** produce schema-valid documents (`makeTimeline({seconds:1800})` compact JSON ≤ 5 MB). A lint test fails if anything under `src/` (except `src/node/`) imports `node:*`. |
| styles (W1) | drama `style.json` parses and `validateStyleData` returns 0 errors; act shares Σ = 1 ± 1e-6 and every shape has setup/confrontation/resolution acts; fonts ⊆ `BUILTIN_FONT_FAMILIES`; zones inside the frame, captionBand ∩ keepOut = ∅; triggers ⊆ `DERIVABLE_TRIGGERS`; discovery of builtin + a temp user dir (duplicate id → error); `suggestStyleOffline` ranks drama first for « La rupture catastrophique de Johnny Depp » and "The fall of FTX" (accent-folded matching); `scaffoldStyle` round trip |
| llm (W2) | wire→core mappers on every fixture file, coercion table cases, `scandal_expose`; `planBudget` golden (EN 15/20/30 min → 2,174/2,899/4,349 words; ≈ 231/307/461 beats); `lintScript` (flags « En 2016, il a battu sa femme », accepts « Selon Amber Heard, il l'aurait frappée…, ce que l'acteur a toujours nié »; clip-commentary-follows; private-person); `validateBeats` incl. fact-ref downgrades (fake tweet, invented headline, wrong counter value); `splitBeatsFallback` exact reconstruction; `syntheticBeats`; `computePlanKey`; `deterministicFactChecks` rules a–h (stable ids, carry-over of resolutions); `FixtureLlm` resolution; research registry building from recorded responses (`test/data/research-turn-*.json`) incl. resume from saved turns; the structured-call wrapper against a mocked SDK (refusal, max_tokens retry, null parse, fallback betas present) |
| assets (W3) | provider parsers on recorded JSON (`$SP/api/*.json`); licence mapping; policy matrix; **`validatePick`** (AI + person, NC under monetized, unknown rights, stock look-alike on SHOCK, private person portrait); denylist + `checkFalPrompt` (surname, alias, "photorealistic"); dHash dedupe; ranking formula; `needsVisionRerank` modes; json3 parser and passage finder (exact, ASR-noisy, below threshold); yt-dlp stderr mapping; **offline HttpClient throws `OFFLINE` without any socket** (net spy); SSRF guard (private IPs, redirects); per-host UA; **every procedural recipe executes on ffmpeg** (incl. `gradients speed=0.00001`); conform recipes (CFR, `-g`, handles) checked with ffprobe; `verifyQuotes` offline → `skipped-offline`; `resolveAssets` offline on a factory beat set (user pick wins, orphan on planKey mismatch, never writes user-picks) |
| voice (W4) | `buildTtsText` (lexicon, EN/FR numbers, years, currencies incl. guilders, %); `numberToWords` goldens; `charAlignmentToWords`; NW alignment (port `align_test`); estimated aligner; synthetic provider (word timings ↔ audio onsets within 10 ms via `silencedetect`); post chain lead-trim shifts words (clamped ≥ 0); deterministic take ids (all cache hits → same id); `editedAfterTake`; per-segment recording import with a synthetic "recording"; pickup flagging; ElevenLabs against a mocked SDK (stitching `slice(-3)`, pcm→mp3 fallback, tier → licence warning, cloned voice without consent → refused) |
| audio (W5) | SFX manifest (peak offsets of whoosh/riser/impact within ±10 ms of the analytic peak; loopable drone loops seamlessly); procedural music beat grid matches synthesis; `assembleVoProgram` sample-exact placement at `frameToSample48k` incl. an insertion; mixer: SFX peak on the event frame (±1 ms), ducking depth (−12 ± 0.5 dB RMS under VO), silences digital zero (incl. a `vo` bleep span), RL pan sweep mirrors channels, loops + fades, stems sum to master (limiter idle); two-pass loudness reaches −14 ± 0.5 LUFS |
| director (W6) | §9.7 |
| remotion (W7) | `computeTimeline` handles (Σ = chapter duration; transitions centred; even d); `planChunks`; `sliceHash` stability, sensitivity and **chunk-relative invariance**; envelope and camera-state math (port the 5 `$SP/mgtest/motion.test.ts` tests); kb ease end slopes; `FONT_REGISTRY` = `BUILTIN_FONTS`; registry maps every `OverlayComponentId` (FallbackCard for unimplemented); the ESLint determinism config flags a bad fixture file and passes the sources; no `node:*` reachable from `src/entry.ts` (import-graph walk) |
| render (W8) | asset server (Range 206 + `Content-Range`, CORS, `../` → 403, `?v=` ignored); preset mapping; `computeCodeHash` stability; LUT cube generation (33³, identity params → identity cube); `loudnessGate` math on a synthetic AAC file |
| export (W9) | §13.6 |
| engine (W10) | stage hashing (docHash: a forced no-op re-run stales nothing; an upstream edit stales the right stages); option keys hashed (`onlyChapters` stales layout/direct/mix/render); variant states (draft vs master); ownership refusal; gates incl. staleness re-arming, `--yes` refused for editorial gates, per-gate approval validation; pipeline estimate + overrun stop; NDJSON replay with `afterSeq`; job coalescing; crash reconciliation (`INTERRUPTED`); resume after approval; render snapshot releases the project lock; the new-take cascade with fake stages; `writeDoc` returns lint + deterministic fact-check issues; walking-skeleton e2e (P1) |
| cli (W10) | command parsing, exit codes, `--ack all` refused without a TTY, `--ack-file` (mocked engine) |
| web (W11) | §14.6 |

### 16.2 Render integration tests (`test:render`; W7, W8; need the shared Chrome; run under the render lock, concurrency ≤ 2)

1. **Bundle:** `ensureBundle()` builds once (`enableBundleCache:false` in tests) and a second call reuses `<home>/bundles/<codeHash>`.
2. **Chunk concat is frame-exact:** a 5 s `makeTimeline` in 3 chunks (h264-ts, muted) → concat → `ffprobe -count_frames` = 150, duration matches.
3. **Determinism:** `renderStill` frames [0, 37, 74, 120] twice (concurrency 1 and 2) → identical PNG sha256.
4. **Fonts:** `FontSpecimen` renders; no font fallback warnings in `onBrowserLog`.
5. **Components (W7):** one still per M1 component and the `card` layout from `makeTimeline({overlays:true})`; no exceptions; non-empty pixels in the item's zone.
6. **GL probe** returns `swangle` on CPU CI.

### 16.3 Golden-file tests for exporters

§13.6; DTDs in `packages/export/test/dtd`; skipped when `xmllint` is unavailable.

### 16.4 E2E offline demo (`tests/e2e/demo.e2e.test.ts`; owned by W10, made green by I)

```ts
// env: every ENV_KEYS variable deleted; DOCMAKER_HOME=tmp; DOCMAKER_PROJECTS=tmp; DOCMAKER_OFFLINE=1;
//      HTTP_PROXY=HTTPS_PROXY=http://127.0.0.1:9 (dead) + NODE_USE_ENV_PROXY=1 → any stray request fails fast;
//      DOCMAKER_BROWSER_EXECUTABLE = shared Chrome (pre-provisioned; never downloaded here)
const engine = await createEngine({ cwd: repoRoot, renderClient: new InProcessRenderClient({ config, logger }) });
const r = await engine.runDemo({ fixture: "tulip-mania", langs: ["en"], offline: true, tts: "synthetic", preset: "draft", onlyChapters: ["CH1", "CH2"] });
```
Assertions:
1. `r.mp4` exists; `ffprobe -show_streams -count_frames`: exactly 1 video stream (h264, yuv420p, 960×540, 30 fps) and 1 audio stream (aac, 48000 Hz, 2 ch).
2. Video frame count = `timeline.durationInFrames`; container duration within ±1 frame.
3. `ebur128=peak=true`: I ∈ [−15, −13] LUFS, true peak ≤ −1.0 dBTP.
4. `blackdetect=d=1:pix_th=0.03:pic_th=0.99` finds no black run > 1 s except one dip to black ≤ 1.4 s (chapter cards use a textured backdrop, never flat ink).
5. `freezedetect=n=0.003:d=3.5` → warning only (procedural b-roll may be slow).
6. Export dir: `.fcpxml`, `.premiere.xml`, `.otio`, `.markers.edl`, `.srt` (≥ 1 cue), `stems/*.wav` (4), `README.md`, `credits.md`; XML passes `xmllint --dtdvalid` when available; OTIO parses with `OTIO_SCHEMA:"Timeline.1"`; `reference.mp4` present (a render exists).
7. QA report has no `error` checks; `timeline/en.lint.json` has no errors.
8. Re-running `direct` → byte-identical timeline; a forced re-run of `beatslice` changes no file and stales nothing; re-running `render` reuses every chunk (`cached:true`).
9. No request reached the network (the dead proxy saw nothing; HttpClient offline counter = 0).

Runtime ≈ 2–5 min on 4 vCPU (draft). CI: `main` + nightly; `--lang fr` and `--lang all` variants nightly.

### 16.5 Walking skeleton (`tests/e2e/skeleton.e2e.test.ts`, W10, P1)

Green from hour 1: the engine runs every stage of the demo against **fakes** for packages whose M1 has not landed (fakes live in `packages/engine/test/fakes/`, implementing the §4.19 signatures with minimal valid outputs from `@docmaker/core/testing`), with rendering faked by writing a 1-frame MP4 via ffmpeg. Each fake is deleted when the real M1 lands; the skeleton test then equals the demo test minus rendering.

### 16.6 Safety suite (`tests/e2e/safety.e2e.test.ts` + engine unit tests; I + W10)

On the `gate-test` fixture (`autoApproveGates:false`): `--yes`/`--max-cost` never satisfy outline-approval, factcheck-ack, person-ack, recheck, fair-use; `outline-approval` requires a confirmed thesis; acknowledging high items then editing the script → render blocked with reason `stale`; `quote_mismatch` cannot be acknowledged; `PUT user-picks.json` with an AI-generated asset on a person beat → `POLICY_DENIED`; a `replaceSource` override with an NC asset under `monetized` → rejected + lint `POLICY`; an upload without a declaration → 400; fal prompt with a surname or alias → refused; a private person is never searched (provider spy), never in a lower third, and named on screen → fact-check rule h high item; a pending claim older than 30 days blocks render until recheck/ack; the User-Agent for a non-allowlisted host has no contact; the freeze route ignores client licence fields.

### 16.7 Workspace gates (CI)

`pnpm install --frozen-lockfile` → `pnpm check:deps` → `pnpm typecheck` → `pnpm lint` → `pnpm test` → `pnpm test:render` → `pnpm test:e2e` (main + nightly). Matrix: ubuntu-latest (all) and macos-latest (unit + draft e2e). The workflow installs ffmpeg and `libxml2-utils`, caches `node_modules/.remotion` and `~/.documentarymaker/sfx`.

---

## 17. Security, legal, operations

### 17.1 Secrets

- Secrets come **only** from the environment chain: `process.env` > `<home>/.env` (canonical file, mode 0600) > `<repoRoot>/.env.local` (developer convenience). The CLI and the web app resolve the same files because both use `repoRoot` (never the process cwd).
- `docmaker keys set <name>` (hidden prompt) and the settings form (explicit consent "write to ~/.documentarymaker/.env") are the only writers; `loadRuntime` runs per job, so no restart is needed. `GET /api/keys/test` performs a cheap authenticated call (ElevenLabs returns the tier).
- `.env*` is gitignored except `.env.example`.
- Secrets are **never** written to any project file, receipt (request canonicalisation drops headers and auth), job event, log line (the logger redacts secret values and secret-like keys), error message, or the UI (masked display only).
- Child processes (job worker, sidecar, yt-dlp, ffmpeg) receive a minimal env: PATH, HOME, proxy variables, `NODE_USE_ENV_PROXY`, and only the keys they need; renders receive none except `REMOTION_LICENSE_KEY`.

### 17.2 Network and privacy

- **User-Agent:** `userAgentBase` = `DocumentaryMaker/<version>` (+ ` (+<homepage>)` only when the root `package.json` declares a real `homepage`; no placeholder URLs). The contact (`DOCMAKER_CONTACT` ?? `HomeConfig.contact`) is appended **only** for `CONTACT_UA_HOSTS` (commons.wikimedia.org, www.wikidata.org, wikidata.org, api.openverse.org). Nothing is ever read from git config, the OS user, email or hostname (unit-tested). `doctor` warns when the contact is unset (Wikimedia etiquette).
- SSRF guard and size caps on every asset fetch (§7.5); offline mode refuses before any socket.
- Proxies via env (`NODE_USE_ENV_PROXY=1`); **TLS verification is never disabled**; `ignoreCertificateErrors` is never set in Chromium.
- The web app binds to 127.0.0.1; the request proxy (`src/proxy.ts`) rejects foreign `Host` headers (DNS rebinding), checks `Origin` on mutations and `Sec-Fetch-Site` on document/media reads; media paths are allowlisted.
- No telemetry anywhere. The HyperFrames CLI is not used; anyone experimenting must set `HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_SKIP_SKILLS=1 DO_NOT_TRACK=1` and use an isolated `HOME`.

### 17.3 Fair-use notice (shown before the first YouTube download; acknowledgement stored)

> **EN.**
> Downloading YouTube videos may breach YouTube's Terms of Service, and using third-party footage relies on fair use / fair dealing / the right of quotation, which depends on your jurisdiction. In France, the *droit de citation* is narrower than US fair use.
> DocumentaryMaker runs yt-dlp **on your machine at your request**. Keep clips short and directly commented on, and credit the source. A "Source:" label is not a legal shield. You are responsible for the use you make of the clips.
>
> **FR.**
> Télécharger des vidéos YouTube peut enfreindre les conditions d'utilisation de YouTube, et l'usage d'extraits relève du droit de citation, plus étroit en France que le *fair use* américain.
> DocumentaryMaker exécute yt-dlp **sur votre machine, à votre demande**. Gardez les extraits courts et commentés, et citez la source. La mention « Source : » ne constitue pas une protection juridique. Vous êtes responsable de l'usage des extraits.

Every clip logs its URL, channel, timecodes and transcript kind in the ledger and the credits. `maxClipSeconds` defaults to 20 s. Cookies are opt-in only, and come with a warning about the risk of an account ban.


### 17.4 Licences and attributions (`NOTICE.md`, F)

- **Remotion License**:
  - Free for individuals, for-profit organisations of ≤ 3 people (contractors count from 5.0), and non-profits.
  - Otherwise a Company License is required ("Creators" or "Automators"). `<Player>`, `renderMedia` and `renderMediaOnWeb` count as automation APIs.
  - `REMOTION_LICENSE_KEY` is passed as `licenseKey` when set. `@remotion/transitions` shows "UNLICENSED" on npm, meaning it is covered by the Remotion License.
  - **The user decides, the tool never decides for them:** first-run onboarding (`/setup`, or the CLI's first `render`/`preview`) asks the user to choose "individual / ≤ 3-person organisation / non-profit" or "company licence" and stores `HomeConfig.remotionLicense {status, acknowledgedAt}`. The Player passes `acknowledgeRemotionLicense` only when a status is stored; otherwise the web shows a blocking licence card (terms summary + link) instead of mounting the Player. `doctor` warns on `company-license` without `REMOTION_LICENSE_KEY`. The export README and `NOTICE.md` state that the user is responsible for Remotion licensing.
- Ported ideas and small code, each with its licence notice:

| Source | Licence | What we port |
|---|---|---|
| ClaudeAnimationBase | MIT © 2026 John Heibel | motion math: `backOut`, `spring`, `pulse`, `shakeXY`, `kf`, `ring`, `onTwos`, boilSeed |
| lemo-opuscar | MIT © 2026 LemoLab | mux / two-pass loudnorm flow, readcheck formula, monotone keyframes, mixer and SFX recipes, ASR QA, style package format |
| motion-graphics-music-video-skill | MIT © 2026 makevoid | `beats.py`, `cuts.py`, `audio_energy.py` (copied, with headers), cue-envelope model, motion helpers (`$SP/mgtest/motion.ts`), plan-hash gate and receipts patterns |
| opus-video-skills | MIT | kinetic-reel transition catalogue, sound rules, synth instrument ideas |
| HyperFrames | Apache-2.0 | numeric constants and algorithms (caption grouping, cut catalog, ducking defaults, LUT params, transition selection); no files copied wholesale. NOTICE kept. |
| auto-editor | Unlicense | xmeml/FCPXML/OTIO quirks |

- Fonts are OFL. `world-atlas` is ISC, and Natural Earth is public domain.
- Voices: Piper `fr_FR-siwis-medium` (CC-BY) and `fr_FR-upmc-medium` (CC-BY-SA) need attribution (credits "Voice" group); ElevenLabs output follows the user's plan terms (free tier: non-commercial + attribution).
- **Not shipped:** GSAP, p5, PDoomVideo code or song, "Clawd", Pixabay SFX as a library, `@remotion/sfx` meme sounds, NC or research-only voices (ryan, hfc_*, l2arctic, semaine, lessac), `fr_FR-tom` (flagged AGPL dataset), the MMS aligner (CC-BY-NC), Depth-Anything Base/Large (CC-BY-NC), `@imgly/background-removal` (AGPL).
- **GPL tools stay separate processes, never imported:** piper-tts and bgutil.
- Apple DTDs and the Resolve manual are test fixtures only, with attribution.
- Prompt corpora and TubeLab transcripts are not shipped; they were used for internal calibration only.


### 17.5 Editorial safety (summary)

§6.8 lists every safeguard and §5.4 every gate. Product-level rules:
1. **No photorealistic AI images of real people**: blocked at `validateBeats`, at the fal provider (denylist, photoreal vocabulary, non-photoreal suffix), and at `validatePick` for every pick, override and upload; every AI image carries an on-frame `ILLUSTRATION` label.
2. **On-screen text is publication**: quotes, headlines and numbers on screen are bound to FactSheet refs and fact-checked like narration.
3. **Gates cannot be bypassed**: editorial gates ignore `--yes`/`--max-cost`; editing the script or on-screen text re-arms the fact-check gate (staleness); recording imports and final takes are gated; manual picks are re-checked server-side.
4. **Private persons and minors** are never named on screen, searched or shown; non-public persons need a per-person approval.
5. Claim status wording is linted; pending statuses older than 30 days need a recheck before render/export.
6. The `asOf` date appears in the UI, the README and the editorial report; the publish kit and README carry the YouTube "altered or synthetic content" checklist whenever AI images or a synthetic voice were used; synthetic and pickup voices are labelled on screen.
7. The tool states plainly that these safeguards **reduce** risk and are **not legal advice** (README, editorial report footer, UI).

### 17.6 Cost control

- Every paid stage shows a `CostEstimate` before it runs (tokens ≈ chars/3.5 EN, chars/3.2 FR, priced with `PRICES`; ElevenLabs chars × rate; Brave/fal per call; vision rerank per selected beat). `engine.estimatePipeline` totals a whole run; **one approval covers the run** (`Approval.items` = stage planHashes).
- Estimates above `autoApproveUnderUsd` need approval (UI confirm, `--yes`, `--max-cost`).
- **Overrun stop:** a stage stops with `BUDGET_EXCEEDED` when its spend exceeds `max(1.5 × approved estimate, estimate + $1)` or `maxUsdPerStage` ($25); the project stops at `maxUsdTotal` ($40). Resuming needs a new approval showing the spend so far.
- Receipts with fingerprints: an identical paid call is never repeated (`--new-request` forces one).
- Live asset search never calls paid providers unless the request carries `allowPaid` after an inline price confirm; the receipt is recorded.
- The overview shows spend so far vs the cap.

### 17.7 Operations

- `docmaker setup --all` provisions Chrome Headless Shell (`ensureBrowserExecutable({download:true})` → `<home>/browser.json`), the procedural SFX pack, the Kokoro model (≈ 350 MB, size-verified, resumable), Piper `fr_FR-gilles-low` + `en_US-john-medium`, the uv Python sidecar (faster-whisper + yt-dlp), and (M3) CLIP into `<home>/ml` with `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`. Each step is idempotent and size/sha verified.
- Disk: the blob cache cap is `min(20 GiB, 50 % of free disk)` (this container has ≈ 17 GB free); `docmaker cache gc` and project deletion are explicit user actions; the engine never deletes media referenced by a project; full-source YouTube downloads are deleted after conform unless `keepSourceDownloads`.
- Logs: job NDJSON per project, `<home>/logs/docmaker-<date>.log` (redacted).
- Concurrency: one job per project (job lock), one render per machine (render lock; renders hold only the slot after their snapshot), parallel LLM beat calls ≤ 4, per-provider token buckets, `concurrency ≤ min(cores, 4)`.
- Environment note (brief §9.3): `npx hyperframes init` installed global skill folders into `/root/.claude/skills/` and `/root/.agents/skills/` plus `/root/.hyperframes/config.json` with telemetry on during research; the user should delete them by hand; `doctor` reports them.

---

## Appendix A — `drama-commentary` style data (normative values)

Persisted as `packages/styles/builtin/drama-commentary/style.json` (W1 serialises this object with `stableStringify`; `validateStyleData` must return 0 errors). The TypeScript literal below is `$SP/design/core-v2/drama.ts`, type-checked against `StyleData` and runtime-parsed.

```ts
// $SP/design/core-v2/drama.ts
// Appendix A — drama-commentary (normative values). Persisted as packages/styles/builtin/drama-commentary/style.json.
import type { StyleData } from "./src/schema/style";
type Macro = "setup" | "confrontation" | "resolution";
const acts = (xs: [string, number, Macro, string][]) => xs.map(([id, share, macro, purpose]) => ({ id, share, macro, purpose }));
export const dramaCommentaryData: StyleData = {
  manifest: {
    id: "drama-commentary", version: "2.0.0",
    names: { en: "Drama / commentary", fr: "Drama / commentaire" },
    description: {
      en: "Punchy downfall & scandal storytelling: rock-bottom cold open, escalating chapters, punch-ins, evidence cards, selective kinetic captions, budgeted heavy sound design.",
      fr: "Récit de chute et de scandale, rythmé : cold open au plus bas, chapitres en escalade, punch-ins, cartes de preuves, sous-titres cinétiques sélectifs, sound design dosé.",
    },
    category: "commentary",
    uses: [
      "downfall", "scandal", "celebrity", "internet drama", "company collapse", "controversy", "lawsuit", "trial", "fraud",
      "rise and fall", "feud", "drama", "cancelled", "bankrupt", "breakup",
      "rupture", "chute", "scandale", "proces", "affaire", "clash", "faillite", "escroquerie", "polemique", "descente aux enfers", "divorce",
    ],
    moods: ["tense", "ominous", "ironic", "epic"],
    bestFor: ["person_downfall", "company_collapse", "scandal_expose", "internet_drama", "rise_story"],
    referencesDescription: "Long-form narrated YouTube commentary documentaries about business downfalls and celebrity drama: archival-heavy, punchy edit, framed photo cards on moving backdrops, selective kinetic text.",
    previewColor: "#FFD400",
  },
  scriptProfile: {
    id: "drama-commentary/downfall",
    storyShapes: [
      { id: "rise-fall", label: "Rise → fall", acts: acts([
        ["cold_open", 0.04, "setup", "rock-bottom present, peak contrast, 3–6 escalating teasers, one-sentence promise"],
        ["act1_rise", 0.15, "setup", "origins and rise; why we cared"], ["inciting_turn", 0.06, "setup", "the first crack"],
        ["act2a_cracks", 0.24, "confrontation", "escalation with BUT/THEREFORE causality"], ["midpoint_false_hope", 0.10, "confrontation", "false redemption at ~60–70 %"],
        ["act2b_collapse", 0.25, "confrontation", "collapse and the biggest reveal"], ["act3_reckoning", 0.145, "resolution", "full circle, current status, thesis"],
        ["outro_rabbit_hole", 0.015, "resolution", "bridge to the next video"]]) },
      { id: "fall-comeback", label: "Fall → comeback", acts: acts([
        ["cold_open", 0.05, "setup", "lowest point"], ["act1_peak", 0.15, "setup", "the peak"], ["the_fall", 0.25, "confrontation", "how it fell apart"],
        ["rock_bottom", 0.15, "confrontation", "consequences"], ["comeback", 0.25, "confrontation", "the attempt to return"], ["act3_reckoning", 0.13, "resolution", "verdict and status"],
        ["outro_rabbit_hole", 0.02, "resolution", "bridge"]]) },
      { id: "spiral-twist", label: "Spiral → twist", acts: acts([
        ["cold_open", 0.05, "setup", "the strangest detail"], ["act1_setup", 0.15, "setup", "normal world"], ["spiral", 0.30, "confrontation", "escalating spiral"],
        ["twist", 0.15, "confrontation", "the reversal"], ["aftermath", 0.20, "resolution", "fallout"], ["act3_reckoning", 0.13, "resolution", "what it means"],
        ["outro_rabbit_hole", 0.02, "resolution", "bridge"]]) },
    ],
    defaultShape: "rise-fall",
    charsPerSec: { en: 16.5, fr: 16.0 }, avgCharsPerWord: { en: 5.6, fr: 5.7 },
    narrationShare: 0.82, hookMaxSec: 60, chapterSec: [120, 270], maxGapNoDeviceSec: 120, sentenceWords: [11, 18],
    beatSec: { hook: [1.0, 3.0], body: [1.5, 6.5], avgBody: 3.2 },
    devices: ["open_loop", "re_hook", "pattern_interrupt", "callback", "cliffhanger", "punchline", "rhetorical_question", "reveal", "payoff"],
    bannedPhrases: {
      en: ["in this video", "today we're going to", "before we start", "without further ado", "smash that", "don't forget to like", "here's the thing", "let's dive in"],
      fr: ["dans cette vidéo", "aujourd'hui on va", "avant de commencer", "sans plus attendre", "n'oubliez pas de liker", "abonnez-vous", "on va plonger"],
    },
    adBreaks: { firstAfterSec: [180, 300], everySec: [480, 600] },
    revisionRounds: 2,
    maxClipShare: { warn: 0.10, error: 0.15 },
  },
  tokens: {
    palette: { ink: "#0E0F0E", paper: "#F1EEE6", text: "#FFFFFF", accent: "#FFD400", danger: "#E8412F", money: "#3DDC84", secondary: "#2F3CFF", muted: "#8A8A8A" },
    fonts: { headline: "Anton", slam: "Archivo Black", body: "Inter", mono: "JetBrains Mono", serif: "Instrument Serif", caption: "Archivo Black", document: "Courier Prime" },
    typeRamp: { caption: 78, keywordCaption: 96, lowerThirdName: 54, lowerThirdRole: 30, chapterTitle: 120, chapterKicker: 28, slam: 220, counter: 160, cardBody: 40, label: 24 },
    layout: {
      safe: { x: 96, y: 54, w: 1728, h: 972 },
      zones: {
        center: { x: 240, y: 140, w: 1440, h: 600 }, lowerThird: { x: 96, y: 560, w: 900, h: 160 },
        topLeft: { x: 96, y: 64, w: 700, h: 80 }, topRight: { x: 1124, y: 64, w: 700, h: 80 },
        full: { x: 0, y: 0, w: 1920, h: 1080 }, captionBand: { x: 210, y: 760, w: 1500, h: 140 },
      },
      keepOut: [{ x: 0, y: 950, w: 1920, h: 130, reason: "YouTube player controls (bottom 12 %): no text" }],
    },
    backdrop: "gradientGrid",
  },
  motion: {
    entryEase: [0.16, 1, 0.3, 1], exitEase: [0.7, 0, 0.84, 0], kbEase: [0.2, 0.12, 0.8, 0.88], cameraEase: [0.65, 0, 0.35, 1],
    entryMaxFrames: 24, staggerMaxFrames: 15, overshootAllowedIn: ["Stamp"], stepFps: null,
  },
  transitionPolicy: {
    cutShare: 0.85, quota: { minEnergy: 3, tolerance: 0.05, window: 20 },
    primary: "flash", primaryShare: [0.6, 0.7], accents: ["whip", "zoomThrough", "glitch", "pushCut", "paperRip"],
    maxKindsPerFilm: 5, accentKindsPerAct: 2, noRepeatRun: 3, minGapFrames: 30, chapterBoundary: "cut+impact", actBoundary: "dipToBlack",
    energyFrames: { calm: [15, 24], medium: [9, 15], high: [5, 9] },
    cueMap: { TIME_JUMP: "whip", FLASHBACK: "lightLeak", REVEAL: "flash", ARTICLE: "zoomThrough", DOCUMENT: "zoomThrough", IRONY: "pushCut", MONTAGE: "pushCut" },
    intentMap: { cut: "cut", whip: "whip", flash: "flash", glitch: "glitch", zoom_through: "zoomThrough", crossfade: "dissolve", dip_to_black: "dipToBlack" },
    flash: { routine: [0.2, 0.45], cap: 0.5, explicitMax: 0.9, explicitPerMin: 1, frames: [2, 4] },
    weights: { flash: 0.62, whip: 0.1, zoomThrough: 0.1, glitch: 0.06, pushCut: 0.08, paperRip: 0.04 },
    montage: { primary: "pushCut", flashPeak: 0.2 },
  },
  cameraPolicy: {
    shots: {
      aslSec: [2, 4], targetAslSec: 3.0, aslMaxSec: 6, hookAslFactor: 0.6, maxStaticHoldSec: 3, minShotFrames: 24, cutLeadFrames: 2, visualChangeSec: [3, 5],
      aslMul: {
        byEnergy: [1.4, 1.2, 1.0, 0.85, 0.7],
        byCue: { TENSION_BUILD: 1.6, SHOCK: 0.6, REVEAL: 0.8, HOOK: 0.8, LIST: 0.8 },
        byAct: { act2b_collapse: 0.85, the_fall: 0.85, spiral: 0.85, act3_reckoning: 1.2, outro_rabbit_hole: 1.2 },
      },
    },
    kenBurns: { minShotSec: 2, scaleStart: [1.0, 1.04], scaleRatePerSec: [0.025, 0.04], driftPxPerSec: [10, 20], videoCreep: [1.0, 1.04] },
    reframe: { scale: [1.25, 1.45], wideScale: [1.0, 1.04] },
    maxUpscale: 1.6,
    punch: { perMin: [6, 10], scale: [1.12, 1.25], inFrames: [0, 3], minGapFrames: 90, holdToShotEnd: true, minTailFrames: 20, exclusionFrames: 6, fillToMin: true, whooshMinGapSec: 10 },
    cutAccent: { share: 0.15, pulseAmt: 0.05, pulseFrames: 8, flashPeak: 0.45, flashFrames: 6 },
    plate: { punch: 0.05, decay: 9, shakeX: 8, shakeY: 5, hz: 12, windowSec: 0.6, anchorOffsetMs: 45 },
    impactShake: { frames: [8, 15], ampPx: [10, 25], rotDeg: [0.5, 1], overscan: 1.03 },
    creep: { scale: [1.0, 1.06], frames: [120, 240] },
    pullBack: { from: 1.25, frames: 15, blurPx: 10 },
    handheld: null,
    quietBeforeClimaxSec: [0.3, 0.75],
    montage: { aslSec: [0.6, 1.2], snapFrames: 3, beatPunch: { amt: 0.055, frames: 8, curve: 2.5 } },
    clip: { creep: [1.0, 1.05], switchLayoutAfterSec: 8, keyLinePunch: 0.15 },
  },
  stills: {
    layoutWeights: { cover: 0.6, card: 0.4 }, cardIfAspectBelow: 1.25, cardIfWidthBelow: 1400, maxCardRun: 2,
    card: {
      heightFrac: [0.7, 0.85], borderPx: [10, 14], tiltDeg: [1, 3],
      shadow: { offsetY: 35, blurPx: 60, opacity: 0.9 },
      backdrops: ["gradientGrid", "paper", "blurSelf"],
    },
    assetReuseMinGapSec: 60,
  },
  captionDNA: {
    defaultMode: "burn", variant: "keywords", font: "Archivo Black", sizePx: 78, weight: 900, uppercase: true, letterSpacingEm: -0.02,
    strokePx: 9, strokeColor: "#000000", color: "#FFFFFF", keywordColor: "#FFD400", moneyColor: "#3DDC84", dangerColor: "#FF3B30",
    popFrom: 1.18, popFrames: 3, oneLine: true,
    grouping: { maxWords: 4, maxSec: 2.0, minWords: 2, minSec: 0.5, pauseBreakMs: 500, commaPauseMs: 250, leadMs: 80, tailMs: 600, gapMs: 50, maxChars: 22 },
    srtGrouping: { maxChars: 42, maxLines: 2, maxSec: 6, minSec: 1 },
    keywords: { minGapSec: [6, 10], maxWords: 4, sizePx: 96, holdMinSec: 1.0 },
    heroScale: 1.35, heroWordMinGapSec: 0.6,
    suppressUnder: ["KeywordSlam", "QuoteCard", "ChapterCard", "TitleSting", "ArticleHighlight", "DocumentCard", "HeadlineStack", "SocialPost", "KineticText", "TimelineGraphic", "BarChart", "MapPin", "CommentPile", "EvidenceBoard", "FreezeLabel"],
    suppressMinWords: 8,
    clipStyle: { font: "Inter", sizePx: 44, color: "#FFFFFF", background: "#000000B3", minHoldSec: 1.8 },
  },
  sfxPolicy: {
    perMin: [8, 15], impactsPerMin: [1, 3], silentCutShare: 0.5, minGapFrames: 6, noRepeat: true, allowComedic: false,
    peakDb: {
      "whoosh.light": [-24, -18], "whoosh.heavy": [-22, -18], "whoosh.whip": [-22, -18], "whoosh.up": [-22, -18], "swell.reverse": [-22, -16],
      riser: [-20, -14], impact: [-12, -6], "impact.soft": [-16, -10], "boom.sub": [-12, -6], "boom.low": [-14, -8], thud: [-16, -10],
      pop: [-22, -16], click: [-24, -18], tick: [-28, -22], ding: [-22, -16], shutter: [-20, -14], glitch: [-20, -14], paper: [-24, -18],
      marker: [-26, -20], keys: [-28, -22], notification: [-20, -14], drone: [-30, -24], heartbeat: [-22, -16], bleep: [-18, -18],
      "ambience.room": [-38, -32], "ambience.crowd": [-34, -28],
    },
    silencesPerFiveMin: 2, silenceFrames: [12, 24], firstAfterSilenceMinPriority: 4, heavyWhooshMinMovePx: 400, fillToMin: true,
  },
  musicPolicy: {
    sectionSec: [120, 240], dropBeforeRevealSec: [0.5, 0.75], dropOutSec: [1, 3], ironyDropSec: [1, 1.5],
    duckDb: -12, duckRangeDb: [-15, -8], sfxDuckDb: -4, clipDuckDb: -10,
    jCutFrames: 12, crossfadeFrames: 15, fadeInFrames: 30, fadeOutFrames: 30,
    moodBpm: { ominous: 70, tense: 95, sad: 72, uplifting: 110, mysterious: 80, epic: 90, chill: 85, comedic: 115 },
    noVoGainDb: 0,
  },
  grade: {
    look: "tealOrange",
    css: { contrast: 1.08, saturate: 1.06, brightness: 1.0, sepia: 0, hueRotateDeg: 0 },
    splitTone: { shadows: "#1F4E5F", highlights: "#F2A65A", amount: 0.18 },
    vignette: { amount: 0.3, radius: 0.7, feather: 0.45 },
    grainFfmpeg: 4, letterbox: null,
    lut: { contrast: 0.18, saturation: 0.08, vibrance: 0.12, shadows: [-0.04, 0.05, 0.09], highlights: [0.1, 0.04, -0.03], blacks: 0, whites: 0, temp: 0, intensity: 0.62 },
    byAct: {
      act2b_collapse: { css: { saturate: 0.92, brightness: 0.96 }, vignetteAmount: 0.38 },
      act3_reckoning: { css: { saturate: 0.95 }, vignetteAmount: null },
    },
    treatments: {
      bw: { contrast: 1.12, saturate: 0, brightness: 1.0, sepia: 0, hueRotateDeg: 0 },
      archival: { contrast: 1.05, saturate: 0.85, brightness: 1.0, sepia: 0.25, hueRotateDeg: 0 },
      duotone: { shadows: "#1F2A44", highlights: "#FFD400" },
    },
  },
  budgets: {
    keywordSlamPerMin: 1, lowerThirdMinGapSec: 20, overlayMaxConcurrent: 2, explicitFlashPerMin: 1, jlCutsPerFiveMin: 1, chapterCardFrames: [72, 150],
    salience: { windowSec: 3, maxAccents: 3, minGapFrames: 6, weights: { transitionNonCut: 1, punch: 1, slam: 2, impactSfx: 1, overlayEntry: 1, flash: 1 } },
    componentCooldownSec: { SocialPost: 20, Stamp: 45, KeywordSlam: 60, LowerThird: 20, FreezeLabel: 60, PhotoBurst: 90, EvidenceBoard: 120, CommentPile: 120 },
    cleanStretch: { everySec: 60, minSec: 6 },
    actIntensity: { cold_open: 1.15, act2b_collapse: 1.2, midpoint_false_hope: 0.9, act3_reckoning: 0.7, outro_rabbit_hole: 0.6 },
    titleSting: true,
  },
  techniqueFloor: { perChapter: { punch: 1 }, perFiveMin: { silence: 2, jlCut: 1 }, exemptActsShorterThanSec: 90 },
  components: [
    { id: "LowerThird", enabled: true, weight: 1, triggers: ["PERSON_INTRO"] },
    { id: "ChapterCard", enabled: true, weight: 1, triggers: [] }, // structural
    { id: "TitleSting", enabled: true, weight: 1, triggers: [] }, // structural
    { id: "QuoteCard", enabled: true, weight: 1, triggers: ["QUOTE"] },
    { id: "SocialPost", enabled: true, weight: 1, triggers: ["TWEET"] },
    { id: "ArticleHighlight", enabled: true, weight: 1, triggers: [] }, // template only
    { id: "DocumentCard", enabled: true, weight: 1, triggers: [] }, // template only
    { id: "HeadlineStack", enabled: true, weight: 0.8, triggers: [] }, // template only
    { id: "Stamp", enabled: true, weight: 0.6, triggers: ["REVEAL"] },
    { id: "KeywordSlam", enabled: true, weight: 0.5, triggers: ["SHOCK"] },
    { id: "NumberCounter", enabled: true, weight: 1, triggers: ["NUMBER"] },
    { id: "DateStamp", enabled: true, weight: 1, triggers: ["TIME_JUMP"] },
    { id: "MapPin", enabled: true, weight: 1, triggers: [] }, // template only (needs lon/lat)
    { id: "TimelineGraphic", enabled: true, weight: 0.8, triggers: [] }, // template only
    { id: "BarChart", enabled: true, weight: 0.8, triggers: [] }, // template only
    { id: "SplitScreen", enabled: true, weight: 0.8, triggers: ["COMPARISON"] },
    { id: "CensorBar", enabled: true, weight: 1, triggers: ["SENSITIVE"] },
    { id: "Spotlight", enabled: true, weight: 0.6, triggers: ["DOCUMENT", "EMPHASIS"] },
    { id: "KineticText", enabled: true, weight: 0.7, triggers: ["LIST", "EMPHASIS"] },
    { id: "SourceLabel", enabled: true, weight: 1, triggers: ["CLIP_REF"] },
    { id: "Letterbox", enabled: false, weight: 0, triggers: [] },
    { id: "FreezeLabel", enabled: true, weight: 0.5, triggers: ["PERSON_INTRO"] },
    { id: "PhotoBurst", enabled: true, weight: 0.6, triggers: ["LIST", "MONTAGE"] },
    { id: "EvidenceBoard", enabled: true, weight: 0.4, triggers: ["LIST"] },
    { id: "CommentPile", enabled: true, weight: 1, triggers: [] }, // template only
  ],
  clipLayout: "pip",
  pauses: { headMs: 300, segmentGapMs: 250, deviceGapMs: 450, chapterGapMs: 2500, preRevealMs: 750, clipLeadMs: 300, clipTailMs: 400, tailMs: 2000 },
  visualPriority: ["archival_photo", "news_footage", "youtube_clip", "motion_graphic", "document_screenshot", "social_post", "map", "text_card", "stock_broll", "ai_illustration"],
};
```

**Other v1 presets (M3)** reuse every drama component and change only data:

| Field | `cinematic-essay` | `true-crime-dossier` |
|---|---|---|
| Story shapes | `essay-arc` (setup / confrontation / resolution acts) | `investigation` (open/unresolved; same macro acts) |
| `charsPerSec` | en 15.0 / fr 14.5 | en 15.5 / fr 15.0 |
| ASL / max hold | 4–8 s / 8 s | 4–10 s / 10 s |
| Ken Burns rate | 1.5–2.5 %/s, drift 6–12 px/s | creep 1.00→1.06 + handheld `{ampPx:1, fps:3}` |
| Punches per minute | 0–2 (fill off) | 0–1 (fill off) |
| `cutShare` / primary | 0.75 / `dissolve` (15–30 f); accents `zoomThrough`, `lightLeak`, `dipToBlack` | 0.9 / `dipToBlack`; accents `flash` (evidence), `glitch` (VHS) |
| Stills | card 0.6 / cover 0.4, backdrop `paper` | card 0.5, backdrop `darkNoise` |
| Captions | `srt-only` (keywords off; lower thirds only) | `rail`, mono |
| Grade | `filmFade` (blacks .35, contrast −.28, temp .16), grain 6–8, vignette .35, letterbox 2.39 | `desatCool`, vignette .45, grain 8–10 |
| SFX per minute / impacts | 2–5 / ≤ 1 | 2–4 (+ drones, ambience.room) / ≤ 1 |
| Music | swelling, long silences | drones, pulses, heartbeat |
| `overshootAllowedIn` / title sting | [] / false | [] / true |
| `clipLayout` | `cover` | `cover` |

Every pacing number is an estimate from tutorial transcripts; calibration against reference videos is R16.

**Prompt pack** (`builtin/drama-commentary/{STYLE.md, GUIDE.md, prompts.json}`, W1): STYLE.md has 11 sections (Essence / not, Materials, Colour logic, Type & subtitles, Motion quality, Camera grammar table, Sound palette, Native moves, Pitfalls, Engine, Variation space). GUIDE.md: goals; numbered rules (hook in 5 s; BUT/THEREFORE; a device at least every 120 s; commentary after every clip; one read at a time; selective on-screen text; no channel names); reads-timing; common failures; a worked example; a **Banned** list (generic intros, "here's the thing", narrator-as-fact accusations, invented tweets/headlines, AI images of real people). `prompts.json` holds `qualityDirective`, `visualGrammar` (visual priority + the `motion_data_json` format per template including the fact-ref fields of §4.11) and `narratorPersona` (EN, FR).

---

## Appendix B — Open items to verify during implementation (owner)

1. **(W4)** Live ElevenLabs test: with-timestamps alignment quality, stitching, PCM tier, v4 behaviour, speed range, MP3 priming offset, tier endpoint.
2. **(W9, manual)** NLE smoke (`docs/NLE-SMOKE.md`): xmeml centre units and sign, rotation sign, FCPXML still `start=3600s`, Resolve gain keyframes and markers from xmeml/OTIO, Resolve 20 with FCPXML 1.11.
3. **(W3, residential machine)** The yt-dlp download path with bgutil (`--js-runtimes node`, mweb). Datacenter IPs get 403/429; manual clip import is the fallback.
4. **(W4)** Human listening pass on Kokoro `ff_siwis` and Piper FR voices; whisper word timing on real French speech vs the 80 ms caption tolerance; calibrate the `t_dtw` offset. Re-verify sherpa-onnx-node under pnpm with `createRequire`.
5. **(W5)** Inventory of the HyperFrames SFX pack (19 or 21 files) if the `hyperframes-pixabay` importer is used.
6. **(I)** Remotion 5.0 release timing and licence changes before any commercial or SaaS use (code already follows the 5.0 conventions: options-object `bundle()`, explicit `inputProps`, explicit `gl`).
7. **(W2)** SDK behaviour of `client.beta.messages.parse` with `fallbacks:"default"` (type-checked, not run); whether `stream()` with `output_config.format` is needed above 32k tokens.
8. **(W11)** Turbopack bundling of the engine's server dependency graph (sharp, linkedom, the ElevenLabs SDK) in route handlers; fall back to `serverExternalPackages` entries as needed.

Closed by the critics' verification (no longer open): h264-ts concat is frame-exact (115/115 frames); Next 16.3.8 Turbopack builds fontsource CSS through a package export; `createRequire(import.meta.url).resolve` works in a Turbopack route while `import.meta.resolve` does not; `gradients … speed=0` fails on ffmpeg 6.1 and `speed=0.00001` works; vitest 5.0.3 project negation works; `NODE_USE_ENV_PROXY=1` works on Node 22.22.0.

---

## Appendix C — Prototype → destination map

| Prototype (`$SP/…`) | Status | Destination (owner) |
|---|---|---|
| `design/core-v2/src/**` (this spec's §4) | type-checked + runtime-parsed | `packages/core/src/**` (F, copied) |
| `design/core-v2/stubs/**` (§4.19) | type-checked | each package's `src/index.ts` (F, as throwing stubs) |
| `design/core-v2/drama.ts` (Appendix A) | type-checked + parsed | `packages/styles/builtin/drama-commentary/style.json` (W1); `@docmaker/core/testing` `TEST_STYLE` (F) |
| `rtest/render.mjs` (bundle, selectComposition, chunked renderMedia, CORS+Range server) | verified | `packages/render/src/{bundle,chunks,assetServer}.ts` (W8) |
| `rtest/bench.mjs` | verified (18 / 24.4 fps) | `packages/render/test-int/bench.ts` (optional) |
| `rtest/fx.mjs`, `rtest/src/Fx.tsx` | verified | GL probe (W8) |
| `rtest/src/Doc.tsx` (data-driven TransitionSeries, Ken Burns, ducking) | verified | `packages/remotion/src/layers/ChapterSeries.tsx` (W7) |
| `rtest/node_modules/.remotion` (Chrome Headless Shell) | verified | copied to `<repo>/node_modules/.remotion` in P0 (F) |
| `tsc-check/fx.tsx` (KenBurns, usePunchIn, useImpactShake, FlashFrame, MarkerHighlight, DrawOn, FreezeAndLabel, WhipCut, GradedClip, KineticCaptions) | type-checked | component library (W7); `FreezeAndLabel` → `FreezeLabel`; `duckedVolume` superseded by core `computeGainTables` |
| `mgtest/motion.ts` + `motion.test.ts` | bun-tested (5 pass) | `packages/remotion/src/lib/motion.ts` + `fx/*` (W7); `snapCut` → director (W6) |
| `tts/node/voice.ts` (`charAlignmentToWords`, ElevenLabsProvider, `alignScriptToTranscript`) | type-checked | `packages/voice/src/{providers/elevenlabs,align/nw}.ts` (W4) |
| `tts/node/duck.tsx` | type-checked | superseded by core `computeGainTables` (F) |
| `tts/node/sherpa_kokoro.js` | verified (RTF 0.21) | `packages/voice/src/providers/sherpa.ts` (W4) |
| `tts/audiopost.sh` | verified (−13.9 LUFS / −1.9 dBTP) | `packages/voice/src/post/chain.ts` (W4); loudness helpers → `@docmaker/core/node` (F) |
| `tts/piper_align.py`, `tts/fw_test.py` | verified | `python/docmaker_sidecar/{cmd_piper_align,cmd_asr}.py` (W4) |
| `script-pipeline/{schemas,prompts,budget-and-lint,research}.ts` | type-checked | `packages/llm/src/{wire,prompts,lint,budget,steps/research}.ts` (W2) (`scandal_exposé` → ASCII) |
| `tl/examples/*` | DTD-validated / OTIO round-trip | `packages/export/test/golden/` (W9) |
| `tl/fcpxml-1.10.dtd`, `tl/xmeml_dtd_4*.dtd` | — | `packages/export/test/dtd/` (W9, attribution) |
| `npmtest/gen.mjs` (xmlbuilder2 FCPXML, rational time, `pathToFileURL`) | verified | `packages/export/src/fcpxml.ts` (W9) |
| `sfx/make_sfx.sh` | verified (11 sounds in 1.4 s) | `packages/audio/src/sfx/recipes.ts` (W5) |
| `api/*.json` (Openverse, Commons, IA, LOC responses) | recorded | `packages/assets/test/data/` (W3) |

---

## Appendix D — Engine stage wiring (W10)

| Stage | Calls |
|---|---|
| research | `llm.runResearch()` (resumable; turns persisted) → `llm.buildFactSheet()` → `assets.resolveEntity()` per public person (online; private persons only after person-ack; never minors) → `assets.verifyQuotes()` (skipped offline/fixture) → write dossier, registry, factsheet, verification, entities |
| style | `styles.suggestStyleOffline()` always; `llm.suggestStyle({stage:"research"})` with a key → write suggestion; set `styleId` only if null |
| outline | gate style-confirm → `llm.planBudget()` per language → `llm.writeOutline()` → `llm.validateOutline()` (1 repair) → write → gate outline-approval |
| script | per chapter (skipping userEdited/locked unless forceOverwriteEdits): `llm.writeChapter()` → `voice.buildTtsText()` (engine) → `llm.lintScript()` → `llm.reviseChapter()` ≤ 2 → secondary: `validateLangParity` (1 repair, else `LANG_PARITY`) → write `script.json` (+ `.cache/`) |
| beats | per primary chapter whose skeleton changed (or `replanChapters`): `llm.planBeats()` ∥ 4 → `llm.validateBeats()` → fallback splitter; ids + plan keys in code; `llm.syntheticBeats()` → write `beats/plans.json` |
| beatslice | primary: copy planned slices or `llm.sliceBeats({mode:"deterministic"})`; secondary: `llm.sliceBeats({mode:"llm"})` (fallback) → `validateBeats` → write `beats/<lang>.json` |
| factcheck | `llm.factCheck()` per changed chapter (+ deterministic rules, carry-over of resolutions) → write → gate factcheck-ack |
| assets | `audio.ensureSfxPack()`; **prepareMusic** (engine: `audio.generateMusic` / `audio.scanMusicLibrary` → `assets.freezeFile` → `assets/music.json`); `assets.resolveAssets()` with `llm.makeReranker()` when a key is set and `visionRerank ≠ off` → write picks, frozen, ledger, candidates, clips |
| voice | scratch: `voice.synthesizeTrack({kind:"scratch", provider synthetic})`; final: gates → `voice.synthesizeTrack()` or `voice.importRecording()` → write take + `active.json` |
| layout | filter by `onlyChapters` → `director.layoutProgram()` → `audio.assembleVoProgram()` → write layout (compact) |
| direct | build `StyleRenderTokens` (theme merge, caption variant) → `director.direct()` (with `validateAsset` = `assets.validatePick` bound to the project) → write timeline (compact), lint, usage |
| mix | `audio.mixTimeline()` (in the job worker) → write mix, stems, loudness |
| render | gates → snapshot (timeline + mix) → release the project lock → `renderClient.render(RenderRequest)` → write `render.json` |
| export | gates → `renderClient.renderGeneratedStills()` (+ `renderOverlays`, M3) → `export.conformForNle()` → `toExportTimeline()` → writers → `assets.buildCredits()` → `writePublishKit()` / `writeEditorialReport()` → `writeExportBundle()` (reference MP4 if an up-to-date render exists) |
| qa | ffprobe, `measureEbur128`, blackdetect (`pix_th=0.03`, `pic_th=0.99`), freezedetect, `renderClient.renderStills({sheet})`, `audio.densityReport()`, director stats → `QaReport` |

---

## Appendix E — Decisions log

Every issue raised by the four critics, with its resolution. "Accepted" means the critic's fix is in this spec as proposed; "Accepted (adapted)" or "Rejected" give the reason. Section references point to where the decision is implemented.

### E.1 Feasibility and build plan

| # | Sev. | Issue | Resolution | Where |
|---|---|---|---|---|
| F1 | blocker | Core barrel re-exports `node:` utilities; Remotion `bundle()` and Turbopack break | **Accepted.** Three entry points: `@docmaker/core` (isomorphic), `@docmaker/core/node`, `@docmaker/core/testing`. SHA-256 is pure JS so `hashJson`/`docHash`/`sliceHash` stay isomorphic and `sliceHash` stays in `remotion/compute`. ESLint bans `node:*` in browser-reachable code; `check-deps-graph` walks imports; P0 smoke runs `bundle()` and `next build`. | §2.4, §3.3, §4, §4.18, §0.1 |
| F2 | major | `import.meta.resolve` fails in Turbopack; worker cwd finds the wrong Chrome | **Accepted, extended.** `RuntimeConfig.repoRoot`; repo files are located from it (rule §0.4.7); forks use `cwd: repoRoot` and an absolute tsx `--import`. The web no longer forks a render worker at all: it forks one **job worker** (`apps/cli/src/worker.ts`) that renders in-process; `WorkerRenderClient` is removed. | §0.4, §4.17, §5.5, §12, §14.1 |
| F3 | major | No package API signatures; agents cannot work in parallel | **Accepted.** §4.19 gives every cross-package signature as compiled TS stubs (verified with tsc); P0 installs them as throwing stubs so the workspace type-checks on day one; changes go through `docs/ISSUES.md`. | §4.19, §0.1 |
| F4 | major | Undeclared/double-owned edges (music, WAV, loudnorm, TP gate, buildTtsText) | **Accepted.** `prepareMusic` in the engine; no `assets/music.ts`; WAV + loudness only in `core/node`; the post-AAC gate only in render; only the engine calls `buildTtsText`; `check-deps-graph.mjs` in `check:deps`. | §3.2, §11, §12.3 |
| F5 | major | No per-package deps; install/git/CPU races between agents | **Accepted.** Per-package dependency table installed once by F; agents never run pnpm add/install; git staging rules with index.lock retry; machine-wide render lock, concurrency ≤ 2 in P1; per-agent `DOCMAKER_HOME`, shared Chrome, port ranges. | §2.3, §0.4 |
| F6 | major | Root e2e/eslint imports unresolvable; missing `@types/react` | **Accepted.** Root `devDependencies` on the workspace packages used at root + `@types/react(-dom)`; eslint imports the determinism config by relative path. | §2.3, §2.4 |
| F7 | major | ≈ 40k LOC in one session; nothing demoable until the end | **Accepted (adapted).** M1 demo slice per package, M2 completion, M3 stretch, R roadmap (§0.3). Deferred to M3: whisper.cpp, CLIP (outside the workspace), Brave, fal, yt-dlp download path, ProRes overlays, filmBurn/paperRip/dotWipe/iris/whipStreaks (mapped to flash/dip), push/wipe/blurDissolve, the two extra style presets, teleprompter recorder, Playwright. **Not deferred:** recording import and calibration stay M2 because the user's fixed decisions require the own-voice path; credits/settings pages stay M2 (acceptance #6). | §0.3, §1.2 |
| F8 | major | P0 exit too thin; downstream tests meaningless; no walking skeleton | **Accepted.** P0 copies the verified schema files, implements every core util for real with tests, installs stubs and all deps, ships a placeholder Remotion entry and a skeleton web app, and passes a smoke test; W10 keeps a walking-skeleton e2e from hour 1. | §0.1, §16.5 |
| F9 | major | Engine jobs block the Next event loop | **Accepted.** Jobs run in a forked job worker (IPC + NDJSON replay); sherpa synthesis and the mixer also use `worker_threads`/yields. | §5.5, §8.3, §11.5, §14.1 |
| F10 | major | Offline research still fetches pages | **Accepted.** Offline/fixture → no quote verification (`skipped-offline`); `HttpClient` throws `OFFLINE` before any socket; the e2e runs behind a dead proxy and asserts zero requests. | §6.3, §7.5, §16.4 |
| F11 | major | transformers/onnxruntime install weight; sherpa unverified under pnpm | **Accepted.** Removed from the workspace (`setup --clip` installs into `<home>/ml`, M3); `onlyBuiltDependencies` trimmed; sherpa loaded with `createRequire` and re-verified by W4 off the demo path. | §2.3, §7.6, §8.3 |
| F12 | minor | `gradients speed=0` invalid on ffmpeg 6.1 | **Accepted.** `speed=0.00001`; a unit test executes every procedural recipe. | §7.9, §16.1 |
| F13 | minor | Missing export-map entries | **Accepted.** `@docmaker/remotion/fonts`, `@docmaker/core/{node,testing}`. | §3.3 |
| F14 | minor | Chrome re-downloaded per cwd | **Accepted.** P0 copies the research Chrome into `<repo>/node_modules/.remotion`; `browserExecutable` from `DOCMAKER_BROWSER_EXECUTABLE` / `<home>/browser.json` passed to every call; no implicit downloads. | §12.7, §0.1 |
| F15 | minor | h264-ts concat already verified | **Accepted.** Concat is normative; the `combineChunks` fallback is dropped (re-encode concat remains as the last resort). | §12.3 |
| F16 | minor | Render tests in `pnpm test`; empty packages fail; unrealistic P1 lint gate | **Accepted.** `render-int` vitest project + `test:render`; `passWithNoTests`; per-phase gates; `ignoreBuildErrors` in Next; eslint ignores. | §2.4, §0.5 |
| F17 | minor | Concurrent webpack caches | **Accepted (adapted).** Tests bundle with `enableCaching:false`; production bundles take a machine lock; a per-home `rootDir` is unnecessary with the lock. | §12.1 |
| F18 | minor | blackdetect threshold vs dark ink cards | **Accepted (both).** `pix_th=0.03:pic_th=0.99`, and chapter cards always use a textured backdrop. | §16.4, §4.11 |
| F19 | minor | `onlyChapters` not hashed | **Accepted.** `JobOptions.onlyChapters`, hashed by layout/direct/mix/render; the engine filters script and beats before layout. | §5.1, §9.1 |
| F20 | minor | interfaces path; undefined `FfprobeResult`/`ProjectPaths`; cache cap > free disk | **Accepted.** `src/interfaces.ts`; both types defined; cap = min(20 GiB, 50 % free). | §4.16–§4.18 |

### E.2 Editing quality (drama-commentary fidelity)

| # | Sev. | Issue | Resolution | Where |
|---|---|---|---|---|
| E1 | blocker | Readability lint contradicts component holds | **Accepted (adapted).** `ReadPolicy` modes formula/glance/title/narrated/none; `dur = clamp(readHold, min, max)`; overflow truncates or warns, never errors; LowerThird max 150 f counting name+role; DateStamp = type time + 30 f; lint severities tabled. ChapterCard uses a `title` read mode with `chapterCardFrames` [72, 150] and the **layout widens the chapter gap** (`chapterCardReadMs`) so the card ends ≤ first word + 6 f — a fixed 90 f minimum would have collided with the narrator (E23). | §4.11, §4.13, §9.3 step 7 |
| E2 | major | REVEAL silence kills its own riser; VO keeps talking | **Accepted.** `RevealSequence` (riser ends at S0, silence [S0, a), impact + music restart at a), `Pauses.preRevealMs` with a mid-segment VO split, audible-span rule with `combo:"reveal"` exemption, a director test. | §4.10, §9.2, §9.3 step 6, §9.5 |
| E3 | major | `kbEase` stalls at both ends | **Accepted (adapted).** Rate-based Ken Burns (`scaleRatePerSec`, `driftPxPerSec`) and `kbEase = [0.2, 0.12, 0.8, 0.88]` (end slopes 0.6 × mean). The suggested `[0.25, 0.1, 0.75, 0.9]` has end slopes 0.4 and would fail the critic's own ≥ 50 % test. | App. A, §9.3 step 4, §9.7 |
| E4 | major | Metronome cutting; visualChangeSec unused | **Accepted.** `aslMul` by energy/cue/act, `aslMaxSec`, camera-change shots without the 2×-sources cap, a visual-change pass, `NO_VISUAL_CHANGE`, `maxNoChangeSec`. | §4.12, §9.3 steps 2, 8 |
| E5 | major | Undefined reframe; no upscale guard | **Accepted.** Tight 1.25–1.45 toward focal / wide 1.00–1.04 alternation; `maxUpscale` 1.6 enforced on cover, reframe and punch, with card fallback. | §4.12, §9.3 steps 3–4 |
| E6 | major | No still layout choice; no framed-card look | **Accepted.** `ClipLayout "card"`, `LayoutParams`, `StillPolicy` (60/40 cover/card, aspect/width rules, ≤ 2 in a row), drifting backdrops. | §4.11–§4.13, §9.3 step 3, §10.7 |
| E7 | major | Component triggers/weights never read; no bleep | **Accepted (adapted).** Cue→component pass (step 7g) with a derivation table (`DERIVABLE_TRIGGERS`, `STAMP_LEXICON` with status-gated verdicts); style lint rejects triggers without a derivation. Bleeps apply only to `SENSITIVE` cues valued `"bleep"` inside **quoted** passages (bleeping the narrator's own words would be incoherent), with a VO silence. | §4.11, §9.3 step 7g |
| E8 | major | Transition mix depends on the LLM; fallback breaks constraints | **Accepted.** Four passes: structural → proposals → seeded quota fill → constraint re-check after every substitution, falling back to cut; `primaryShare` stat + lint. | §9.3 step 5 |
| E9 | major | No punch floor; centre-origin punches; flicker; impactShake unused | **Accepted.** Punch fill pass, focal origin, `minTailFrames`, ±6 f exclusion, upscale guard, `impactShake` wired (fx target `"all"`) to slams and chapter/title cards, punch-whoosh min gap. | §9.3 step 6 |
| E10 | major | No fatigue control | **Accepted.** Salience window, component cooldowns, asset-reuse gap, clean stretches, per-act intensity; arbitration step. | §4.12, §9.3 step 9 |
| E11 | major | Per-act floors on 18–72 s micro-acts; 7 dips to black | **Accepted.** `macro` acts; `actBoundary` only at macro boundaries (≤ 2–3 dips); floors per five minutes; acts < 90 s exempt. | §4.12, §9.3 steps 5, 11 |
| E12 | major | Chapter-boundary silence vs music J-cut undefined | **Accepted.** Two recipes: "silence-hit" (hard stop, silence, impact + section on a downbeat at the cut, `alignDownbeatAt`) and "jcut" (no silence). | §9.3 steps 1, 11a, §9.6 |
| E13 | major | build/drop_out/hit ignored; no montage | **Accepted (adapted).** Cue mapping implemented; `MONTAGE` cue and synthetic breath beats get montage mode (beat-snapped cuts ±3 f, pushCut + flash 0.2, beat punch). A montage gain boost is **not** added: the music already rises through the ducking release, and a gain step on a continuing track would click. | §4.6, §9.3 steps 1, 2b, 11b |
| E14 | major | Full burn-in captions are a Shorts idiom; geometry overflow | **Accepted.** `keywords` variant is the drama default (full captions go to SRT); pop variant fixed to 22 chars / 4 words / one line; `CaptionWord.hero`; `suppressMinWords`; clip/translation minimum hold. Emoji captions → R17 (explicitly deferred). | §4.12, §9.3 step 10, §10.8 |
| E15 | major | Static evidence cards pass lint; cannot be punched | **Accepted.** `continuousMotion`, `followsCamera`, STATIC_HOLD extended to graphics, card punches in the visual-change pass. | §4.11, §9.3 step 8, §10.6 |
| E16 | major | Evidence mockups not VO-synced | **Accepted.** `highlightAt`, `items[].at`, `revealAt`, `stampAt`, `redactAt` (+ `at` on MapPin, TimelineGraphic, PhotoBurst, EvidenceBoard, CommentPile) resolved by NW against the narration; SFX use those frames. | §4.11, §9.3 step 7a, §9.5 |
| E17 | major | Genre signatures missing | **Accepted.** FreezeLabel, PhotoBurst, EvidenceBoard, CommentPile, TitleSting are in the v1 contract with templates; TitleSting is M1, the others M2 (FallbackCard until then). | §4.11, §9.3 step 7, §10.7 |
| E18 | minor | Cut lead only on segment-first beats | **Accepted.** Every word-onset beat start cuts 2 f early (bounded by min shot length). | §9.3 step 2 |
| E19 | minor | Ken Burns direction repeats/reverses; tiny vertical drift | **Accepted.** Direction excludes the previous and its opposite; full drift vertically; seam-direction ledger. | §9.3 step 4 |
| E20 | minor | Static clip beats; plain PiP | **Accepted.** Clip creep, pip→cover switch after 8 s at a sentence boundary, key-line punch; PiP stroke/shadow/tilt/backdrop/entry via `LayoutParams`. | §9.3 steps 2, 6, §10.7 |
| E21 | minor | Single global grade; no topic theming | **Accepted.** `VisualClip.treatment`, `Grade.treatments`, `Grade.byAct`, `ThemeOverride` (suggestion + user). | §4.2, §4.12, §10.12 |
| E22 | minor | Drones cut off; no ambience; whoosh direction baked | **Accepted (adapted).** `SfxCue.loop/fades/panSweep`, `SfxEntry.loopable/direction`, `ambience.room` (procedural) and `ambience.crowd` (packs). Ambience mixes into the SFX stem — a fifth stem adds NLE complexity for little gain. | §4.8, §4.13, §11 |
| E23 | minor | Chapter card does not breathe | **Accepted.** `chapterGapMs` 2500 ms plus the per-title adaptive gap; the card ends ≤ first word + 6 f. | §9.2, App. A |
| E24 | minor | SFX floors unenforced; IRONY too thin | **Accepted.** SFX fill pass; IRONY = music drop 1–1.5 s + creep (+ scratch only with comedic packs). | §9.3 step 6, §9.5 |

### E.3 Data model coherence

| # | Sev. | Issue | Resolution | Where |
|---|---|---|---|---|
| D1 | blocker | Clip beat text fixed before its mode is known; spoken text mismatch | **Accepted.** Clip (and breath) beats carry no text; `spokenText(seg, mode)` is the single definition; QuoteCard uses it. | §4.5, §4.6, §9.2 |
| D2 | blocker | `picks.json` is both input and output; direct mutates the ledger | **Accepted.** `user-picks.json` (user input) vs `picks.json` (output); `usedIn` replaced by `timeline/<lang>.usage.json`; ownership enforced by `DOC_REGISTRY`. | §4.7, §4.16, §5 |
| D3 | blocker | Secondary-language segment mismatch unrepresentable | **Accepted.** Hard invariant `validateLangParity`; one repair round, then `LANG_PARITY`; no proportional fallback. | §4.18, §6.3 |
| D4 | blocker | Clips run past their media; J-cuts desync | **Accepted.** Conform handles, `passageInMs/OutMs`, picture `sourceIn` from the passage, `ClipAudio.sourceInFrames` offset by the J length, `MEDIA_RANGE` lint, hold shots instead of frozen frames. | §4.7, §4.13, §7.5, §9.3 |
| D5 | major | `resolveTimeline` cannot re-derive many fields | **Accepted, option A.** Valid only for the same layout hash; derived-field table; `RESOLVE_MISMATCH` idempotence lint; layout changes re-direct. | §4.13, §4.18 |
| D6 | major | Positional ids break overrides | **Accepted.** Content-stable ids (mus/sil/sfx/vo/ca/tr); override fingerprints (component, beat, planKey, asset, word norm); `expectNorm` on word anchors; shots stay positional but fingerprinted. | §4.13, §4.16 |
| D7 | major | Timestamps cascade invalidation; random take ids | **Accepted.** `docHash` without `VOLATILE_KEYS` in every inputs hash; no-op writes skipped; deterministic take ids. | §4.18, §5.3, §8.4 |
| D8 | major | Beats re-run on any language edit; LLM-chosen ids | **Accepted.** `beats` (plans from primary skeletons) + `beatslice[lang]`; deterministic re-slice after text edits; ids and `planKey` in code; picks store `planKey` (orphans on mismatch). | §4.6, §5.1, §6.3 |
| D9 | major | Missing stage inputs; per-preset state | **Accepted.** Completed hash tables, the option-key rule, `StageState.variant`. | §5.1 |
| D10 | major | No versioning or migration | **Accepted.** `DOC_VERSIONS`, `migrateDoc`, `formatVersion`, schemas for every persisted file, `DOC_REGISTRY`. | §4.1, §4.15, §4.16, §4.18 |
| D11 | major | Gain applied twice in preview | **Accepted.** `bakedGainDb` (never applied); `VoClip.gainDb` applied to segment files; duplicated `file` fields removed. | §4.10, §4.13, §4.18 |
| D12 | major | Crop/focal never reach the Timeline | **Accepted.** `VisualSource.crop/focal`; exporters read only the Timeline; per-language video ranges linted. | §4.13, §13.1 |
| D13 | major | Chapter gap belongs to the previous chapter | **Accepted.** Beats tile their chapter (invariant tested). | §4.10, §9.2 |
| D14 | major | No reference integrity | **Accepted.** `checkRefs` codes, `collectAssetIds`, superRefine uniqueness/prefix checks, typed ids. | §4.1–§4.6, §4.18 |
| D15 | major | Fact-check ids reset acknowledgements | **Accepted.** Stable `FC-<sha8>` ids, carry-over, planHash from blocking items. | §4.5, §5.4, §6.3 |
| D16 | major | Wire/core range mismatches; `scandal_exposé`; LLM QIDs | **Accepted.** Coercion table; ASCII enum; `wikidata_qid` removed from the wire. | §6.4 |
| D17 | minor | Odd overlap durations | **Accepted.** `multipleOf(2)` in Timeline and ExportTransition. | §4.13, §4.14 |
| D18 | minor | ms↔frame clocks drift | **Accepted.** Frame-quantised segment starts, `frameToSample48k`, clamps, word-end rule. | §9.2, §11.4 |
| D19 | minor | String anchors ambiguous; numbers drift across languages | **Accepted.** `cueAnchorIdx`/`emphasisIdx`; numeric motion fields copied from the primary; wire keys documented. | §4.6, §6.3 |
| D20 | minor | Primary-word budgets used for FR | **Accepted.** `targetSec` + `Outline.budgets`. | §4.4, §6.6 |
| D21 | minor | Sponsor/breath modes unrepresentable | **Accepted (adapted).** Sponsor slots produce no segment and no beat (marker only). Breath segments **do** get a synthetic `-BR` montage beat (required by E13); the integrity rules cover both. | §4.6, §4.10, §9.2 |
| D22 | minor | SFX ids collide across packs | **Accepted.** `<pack>:<category>/<variant>`; repeats compared by `assetId`. | §4.8, §9.5 |
| D23 | minor | Overrides can break invariants | **Accepted.** Isolated validation; `removeItem` on `vo:*` rejected. | §4.13 |
| D24 | minor | Script stored twice; stale derived flag | **Accepted.** `script.json` only truth; LLM cache in `.cache/`; `userEdited`/`locked`; `editedAfterTake` computed. | §4.5, §5.3, §8.6 |
| D25 | minor | Stale media URLs; absolute-frame slice hashes | **Accepted.** `?v=` on asset URLs; chunk-relative `sliceHash`. | §10.3, §10.11 |
| D26 | minor | Provider payloads in frozen.json; timeline size | **Accepted.** `raw` only in candidates; compact JSON for generated docs; ≤ 5 MB budget test. | §4.7, §4.16, §16.1 |

### E.4 Product, UX, extensibility, safety

| # | Sev. | Issue | Resolution | Where |
|---|---|---|---|---|
| P1 | blocker | On-screen text bypasses the fact-check | **Accepted.** Fact refs in `MotionData`; texts filled from the FactSheet; failed refs downgrade to KineticText + reconstruction label; fact-check moved after `beatslice` and covers on-screen strings; rule f. | §4.11, §5.1, §6.3 |
| P2 | blocker | Edits after acknowledgement bypass the gate | **Accepted.** Staleness re-arms `factcheck-ack` before final voice, recording import, render and export; free re-lint on every script PUT; incremental per-chapter re-check; fix-only items; dismiss semantics; `--yes` never satisfies editorial gates. | §5.4, §6.3 |
| P3 | blocker | Manual picks bypass licence and AI rules | **Accepted.** Freeze re-derives candidates server-side; `validatePick` on every pick, override and upload (lint errors in direct); upload declaration; never defaulted to USER-OWNED. | §7.4, §14.3 |
| P4 | major | Regeneration loses user work | **Accepted (adapted).** Per-chapter beat planning from skeletons; `planKey` fingerprints on picks and overrides (instead of a text hash, so edits that do not change the visual plan keep picks); script SSOT with `userEdited`/`locked`; etag-checked stage writes and read-only UI during jobs; `primaryHash` + transcreate; 20-version history. | §4.5, §4.6, §5.3 |
| P5 | major | Job orchestration gaps | **Accepted.** Render snapshot releases the project lock; persisted jobs index; crash reconciliation; jobs route + `activeJobId`; coalescing; approve & continue / `run --resume`; process-group cancel; research resume; render-slot waiting state. | §5.5, §5.6 |
| P6 | major | Style set before the user confirms | **Accepted.** Offline suggestion at `/new`; `styleConfirmed` gate before the outline; `engine.impact`; risk flags wired (medium gating, no portrait search for minors, safe-messaging card). | §5.4, §6.3, §14.2 |
| P7 | major | Styles not really pluggable | **Accepted.** Data-only style directories with discovery (builtin + `<home>/styles`), validation, scaffold, preview, gallery; style fonts via `loadFont` (M2). | §4.12, §15.1, §14.2 |
| P8 | major | Export waits for a 2 h render | **Accepted.** Export depends on direct + mix; reference MP4 optional; timeline-only export and chapter-range draft renders in the UI. | §5.1, §13.5, §14.2 |
| P9 | major | Nothing to preview before paying for voice | **Accepted.** Free scratch takes; gates apply to final takes, render and export only. | §5.1, §8.9 |
| P10 | major | Recording flow holes | **Accepted.** Missing segments → `ANCHOR_MISSING` or pickup TTS; per-segment import; `editedAfterTake` enforced; teleprompter recorder (M3). | §8.6, §14.2 |
| P11 | major | Voice licences and consent missing | **Accepted.** `VoiceInfo/VoiceTrack.license`, credits Voice group, ElevenLabs tier, clone consent, no clones of FactSheet persons. | §4.9, §7.8, §8.3 |
| P12 | major | Contact string sent to every host | **Accepted.** Allowlist (`CONTACT_UA_HOSTS`), `userAgentBase`, no placeholder URL, unit test. | §4.17, §17.2 |
| P13 | major | Cost UX | **Accepted.** `estimatePipeline` + one approval; `maxUsdTotal`; overrun stop; paid live search behind `allowPaid`; selective rerank; corrected cost figure. | §5.4, §6.2, §17.6 |
| P14 | major | YouTube local constraints | **Accepted.** Manual clip resolution (URL or file + timecodes); doctor reachability probe; clip-share and commentary-follows lints; `keepSourceDownloads:false`. | §7.7, §6.6, §15.3 |
| P15 | major | AI-image ban gaps | **Accepted.** Alias/token denylist, photoreal vocabulary ban, non-photoreal suffix + negative prompt, fal disabled on PERSON_INTRO/SENSITIVE, Brave `may-be-manipulated` warning, safety tests. | §7.4, §16.6 |
| P16 | major | Private persons and minors | **Accepted (stricter).** Identity searches skipped; director never shows/names them; fact-check rule h; `person-ack` gate for non-public persons. Minors and private victims are hard-blocked — an approval cannot unlock them. | §5.4, §7.3, §9.3 |
| P17 | major | Title/thumbnail never checked | **Accepted.** `Project.publish`, publish page, checks feeding the fact-check, publish kit. | §4.2, §13.5, §14.2 |
| P18 | major | Unverified quotes usable | **Accepted.** Rule g (not-found → fix-only high; unchecked/fetch-failed → medium); video-match upgrade. | §6.3 |
| P19 | major | Remotion licence acknowledged for the user | **Accepted.** Onboarding stores the user's choice; the Player acknowledges only then; doctor warning; README/NOTICE. | §10.13, §14.2, §17.4 |
| P20 | major | Platforms unstated | **Accepted.** Linux + macOS; Windows via WSL2; CI matrix. | §1.4, §16.7 |
| P21 | minor | Keys UX | **Accepted.** `<home>/.env` canonical, `keys set/test`, consented web form, per-job runtime load, `HomeConfig`. | §17.1, §14.3 |
| P22 | minor | Blanket CLI acknowledgements | **Accepted.** Per-item notes; TTY-only `--ack all`; `--ack-file` otherwise. | §5.4, §15.1 |
| P23 | minor | Freshness; lawyer-facing report | **Accepted.** `recheck` gate for pending statuses > 30 days; editorial report export. | §5.4, §13.5 |
| P24 | minor | DNS rebinding | **Accepted.** Host-header guard + `Sec-Fetch-Site`. | §14.3 |
| P25 | minor | Gate flows untested | **Accepted.** `gate-test` fixture, safety suite (M2), Playwright smoke (M3). | §6.9, §14.6, §16.6 |
| P26 | minor | UI language; onboarding | **Accepted.** EN/FR dictionaries; `/setup`. | §14.1, §14.2 |
| P27 | minor | Provider ids are closed enums | **Accepted (keep enums).** Documented contract-change steps in `docs/EXTENDING.md`; registry-validated string ids are not worth the persisted-data risk in v1. | §7.2 |

### E.5 "Missing" lists — crosswalk

All items in the critics' "Missing" lists are covered by the rows above: split entry points (F1), API stubs (F3), dependency table and agent rules (F5), M1 slice and cut list (F7), walking skeleton (F8), offline semantics (F10), repoRoot rule (F2), Chrome provisioning (F14), root devDependencies (F6), export maps (F13), off-loop jobs (F9), per-phase gates (F16), ownership fixes (F4), recipe test (F12); visual-change checks (E4), ASL modulation (E4), montage (E13), beat grids (E12/E13), musicCue (E13), RevealSequence (E2), still layouts (E6), reframe (E5), punches (E9), cue→component and bleeps (E7), fatigue budgets (E10), macro acts (E11), read policies (E1), keyword captions (E14), VO-sync fields (E16), continuous motion (E15), genre components (E17), PiP styling (E20), treatments/theme (E21), SFX loops (E22), SFX floors and IRONY (E24), Ken Burns rate (E3); document schemas and migrations (D10), derived fields (D5), stable ids and fingerprints (D6), integrity (D14), clip handles (D4), user-input separation (D2), per-language staleness (D8, D9), docHash (D7), coercions (D16), crop/focal (D12), gain semantics (D11); every product item P1–P27.

---
