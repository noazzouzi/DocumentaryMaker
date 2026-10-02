# NOTICE — licences and attributions

DocumentaryMaker is released under the MIT licence (`LICENSE`). It depends on and was informed by the works below, which keep their own licences.

## Remotion (Remotion License)

- Free for individuals, for-profit organisations of up to 3 people (contractors count from Remotion 5.0) and non-profits. Other organisations need a **Company License** ("Creators" or "Automators"). `<Player>`, `renderMedia` and `renderMediaOnWeb` count as automation APIs.
- `REMOTION_LICENSE_KEY` is passed as `licenseKey` when set. `@remotion/transitions` shows "UNLICENSED" on npm: it is covered by the Remotion License.
- **You decide, the tool never decides for you.** First-run onboarding (`/setup` in the web app, or the CLI's first `render`/`preview`) asks you to choose "individual / ≤ 3-person organisation / non-profit" or "company licence" and stores your choice in `~/.documentarymaker/config.json`. The web Player passes `acknowledgeRemotionLicense` only after that choice; otherwise a licence card is shown instead. `docmaker doctor` warns about `company-license` without `REMOTION_LICENSE_KEY`.
- **You are responsible for your Remotion licensing.** The export README repeats this.

## Ported ideas and small code

| Source | Licence | What we port |
|---|---|---|
| ClaudeAnimationBase | MIT © 2026 John Heibel | motion math: `backOut`, `spring`, `pulse`, `shakeXY`, `kf`, `ring`, `onTwos`, boilSeed |
| lemo-opuscar | MIT © 2026 LemoLab | mux / two-pass loudnorm flow, readcheck formula, monotone keyframes, mixer and SFX recipes, ASR QA, style package format |
| motion-graphics-music-video-skill | MIT © 2026 makevoid | `beats.py`, `cuts.py`, `audio_energy.py` (copied, with headers), cue-envelope model, motion helpers, plan-hash gate and receipts patterns |
| opus-video-skills | MIT | kinetic-reel transition catalogue, sound rules, synth instrument ideas |
| HyperFrames | Apache-2.0 | numeric constants and algorithms (caption grouping, cut catalog, ducking defaults, LUT params, transition selection); no files copied wholesale. Its NOTICE is kept with any ported constant. |
| auto-editor | Unlicense | xmeml / FCPXML / OTIO quirks |

## Fonts and data

- Fonts (Anton, Archivo Black, Inter, JetBrains Mono, Instrument Serif, Courier Prime, Special Elite) are self-hosted from `@fontsource/*` under the SIL Open Font License 1.1.
- `world-atlas` is ISC; Natural Earth data is public domain.
- The mulberry32 PRNG and FNV-1a hash are public-domain algorithms; SHA-256 follows FIPS 180-4.

## Voices

- Piper `fr_FR-siwis-medium` (CC-BY) and `fr_FR-upmc-medium` (CC-BY-SA) need attribution: the credits list them in a "Voice" group.
- ElevenLabs output follows the terms of your ElevenLabs plan (free tier: non-commercial + attribution).

## Not shipped

GSAP, p5, PDoomVideo code or song, "Clawd", Pixabay SFX as a library, `@remotion/sfx` meme sounds, non-commercial or research-only voices (ryan, hfc_*, l2arctic, semaine, lessac), `fr_FR-tom` (flagged AGPL dataset), the MMS aligner (CC-BY-NC), Depth-Anything Base/Large (CC-BY-NC), `@imgly/background-removal` (AGPL), the HyperFrames CLI and skills.

## Separate processes

GPL tools are run as separate processes and never imported: piper-tts and bgutil. yt-dlp and ffmpeg are invoked as external programs installed by the user.

## Test fixtures

Apple's FCPXML DTD and the Final Cut Pro / Premiere xmeml DTDs, and excerpts of the DaVinci Resolve manual, are used as test fixtures only, with attribution. Prompt corpora and TubeLab transcripts used for internal calibration are not shipped.
