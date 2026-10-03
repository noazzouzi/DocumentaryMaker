# Developer and agent environment (P0)

This file is the operational companion of `docs/ARCHITECTURE.md` (the normative spec, a copy of SPEC v2). Read §0.4 there before touching anything.

## Shared Chrome Headless Shell (never re-downloaded)

The P0 foundation copied a verified Chrome Headless Shell into the repo's `node_modules`:

```sh
export DOCMAKER_BROWSER_EXECUTABLE=/home/user/DocumentaryMaker/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell
```

Every Remotion call (`bundle`/`selectComposition`/`renderMedia`/`renderStill`) passes it as `browserExecutable`. `loadRuntime()` reads it from `DOCMAKER_BROWSER_EXECUTABLE` (else `<home>/browser.json`). `pnpm smoke` falls back to this path when the variable is unset. If `node_modules` is wiped, restore it with:

```sh
cp -a $SP/rtest/node_modules/.remotion /home/user/DocumentaryMaker/node_modules/.remotion
```

## Per-agent homes, projects and ports

Each agent works with its own state directories (never the default `~/.documentarymaker`):

```sh
export DOCMAKER_HOME=/tmp/docmaker-home-<pkg>          # e.g. /tmp/docmaker-home-audio
export DOCMAKER_PROJECTS=/tmp/docmaker-projects-<pkg>
export DOCMAKER_BROWSER_EXECUTABLE=<path above>
```

| Who | Ports |
|---|---|
| asset servers in tests | port 0 (random) |
| W11 (web) | 3210–3219 |
| I (integration) | 3220–3229 |

## Machine resources and the render lock

- 4 vCPU, 16 GB RAM, no GPU. Only W7, W8, W10 and I run Chrome.
- Every render **or bundle** goes through `withFileLock(config.renderLockFile, owner, fn, { signal })` from `@docmaker/core/node` (default `/tmp/docmaker-render.lock`, override with `DOCMAKER_RENDER_LOCK`), with Remotion `concurrency ≤ 2` during P1.
- `pnpm test` never launches Chrome; Chrome tests live in `test-int/` (vitest project `render-int`, `pnpm test:render`).
- `chromiumOptions.gl = "swangle"` on this CPU-only machine.

## Git rules (SPEC §0.4, normative)

1. Write only inside your owned paths (§0.2). Never edit `packages/core/**`, any `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `eslint.config.js` or `turbo.json`. A blocking contract defect → an entry in `docs/ISSUES.md` plus a local adapter in your own package.
2. Never run `pnpm add`, `pnpm install`, `pnpm update` or `npm install`. A missing dependency is an `ISSUES.md` entry; I batches installs.
3. Stage only your own paths: `git add -- <owned paths>` then `git commit -m "<pkg>: <summary>"` with the session attribution trailer. If `.git/index.lock` exists, wait 2 s and retry (≤ 10 times). Never `git add -A`, `git stash`, `git reset`, `git checkout -- <others' files>`, rebase or force-push.
4. Tests must pass without network; tests that need network or keys are skipped unless `DOCMAKER_LIVE_TESTS=1`.
5. Repo files (fixtures, builtin styles, workers, DTDs) are located from `config.repoRoot`, never with `import.meta.resolve` or `__dirname` guesses.
6. No `Date.now()` / `Math.random()` in director, remotion or any hashed output: use `rngFor(seed, key)`.

## Commands

| Command | What |
|---|---|
| `pnpm install --frozen-lockfile` | install (F/I only change the lockfile) |
| `pnpm typecheck` | `tsc --noEmit` in every workspace (turbo) |
| `pnpm test` | unit tests of every workspace (no Chrome, no network) |
| `pnpm --filter @docmaker/<pkg> typecheck` / `test` | one package (P1 gate) |
| `pnpm test:render` | Chrome integration tests (`packages/{render,remotion}/test-int`) |
| `pnpm test:e2e` | `tests/e2e/*.e2e.test.ts` |
| `pnpm check:deps` | remotion pins, forbidden deps, §3.2 dependency graph + browser-safety walk |
| `pnpm smoke` | bundle + 3-chunk render + concat (150 frames) and `next build`, under the render lock |
| `pnpm lint` | ESLint (P3 gate, `--max-warnings=0`) |
| `pnpm docmaker …` | the CLI from source (also `node_modules/.bin/docmaker`) |

## What P0 delivered (state of each package)

- `@docmaker/core` is complete: schemas (verbatim contract), interfaces, fonts, ids, paths + `DOC_REGISTRY`, every isomorphic utility (`json`, pure-JS `sha256`, `rng`, `time`, `tokenize`, `anchors`, `gain`, `integrity`, `migrate`, `errors`, `project-defaults`), `./node` (`ProjectStore`, env chain, home, logger, proc, hash, WAV, loudness, locks) and `./testing` factories.
- Every other package exposes its §4.19 API in `src/index.ts`; each function throws `DocmakerError("INTERNAL", "not implemented: <pkg>.<fn>")` (see `src/notImplemented.ts`). Replace the stubs, keep the signatures.
- `@docmaker/remotion` has a placeholder `Documentary` (ink background, chapter title, frame counter), a `Root` registering every `COMPOSITION_IDS` entry, `entry.ts`, `fonts/fonts.css.ts` and `eslint.determinism.js`.
- `apps/cli`: `bin/docmaker.js` + `src/main.ts` (prints the version) + `src/worker.ts` (stub). `apps/web`: `next.config.ts`, a layout importing `@docmaker/remotion/fonts`, a page with a client component importing `@docmaker/remotion` and `./compute`.

## State after P2 (integration)

- Every package is implemented; the P0 stubs and the engine's stub-fallback composition are gone. The walking-skeleton fakes for assets, audio and export were deleted: engine unit tests, CLI tests and `tests/e2e/{skeleton,safety}.e2e.test.ts` run the real packages. Only `packages/engine/test/fakes/render.ts` (`FakeRenderClient`, an ffmpeg-written MP4 with the timeline's frame count) remains, so `pnpm test` never launches Chrome.
- `pnpm test:e2e` = the offline demo (real Remotion render under the render lock, ≈ 20–25 min on 4 vCPU), the skeleton (≈ demo minus Remotion) and the safety suite. Set `DOCMAKER_KEEP_E2E=1` to keep their temp homes/projects for inspection.
- Draft and master MP4s are limited-range BT.709 `yuv420p` (Remotion `colorSpace: "bt709"`); chunks rendered before P2 (full-range `yuvj420p`) are never reused (slice-hash encoding version).
- The web app forks `apps/cli/src/worker.ts` from `config.repoRoot` with `--import <repoRoot>/node_modules/tsx/dist/esm/index.mjs`; jobs (incl. `POST /api/demo`) run and render in that worker and stream to `/api/jobs/<id>/events` (SSE).

## Test factories (`@docmaker/core/testing`)

`TEST_STYLE` (Appendix A), `makeProject`, `makeFactSheet`, `makeScript` (EN/FR, same skeleton), `makeBeats`, `makeTake`, `makeLayout`, `makeScenario` (the consistent script/beats/take/layout set behind `makeLayout`/`makeTimeline`), `makeFrozen`, `makePicks`, `makeSfxManifest`, `makeSfxEntry`, `makeMusicTrack`, `makeTimeline`. Properties: deterministic bytes; `makeTimeline({seconds})` has exactly `round(seconds·fps)` frames (for seconds ≥ 2), contiguous video, unique ids, every M1 overlay component when long enough, and `resolveTimeline(makeTimeline(o), buildAnchorIndex(makeLayout(o), docHash(makeLayout(o))))` is the identity.

## Environment notes

- A proxy is configured in this container (`HTTPS_PROXY`). Node processes that fetch need `NODE_USE_ENV_PROXY=1` (the CLI shim re-execs with it). TLS verification is never disabled.
- PID 1 of this container does not reap orphans: a killed grandchild may linger as a zombie (`/proc/<pid>/stat` state `Z`). Treat `Z` as dead in tests.
- ffmpeg `loudnorm` only uses linear mode when the measured LRA is non-zero: a pure sine always falls back to dynamic. Test signals need some level variation.
- Never run the HyperFrames CLI or its skills (telemetry, global skill installs). Next and turbo telemetry are disabled in the scripts.
