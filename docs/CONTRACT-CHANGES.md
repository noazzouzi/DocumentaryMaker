# Contract changes

Owned by the integration agent (I). Every change to `packages/core/**`, a `package.json`, the lockfile or a root config after P0 is recorded here: date, origin (`docs/ISSUES.md` entry), the change, `DOC_VERSIONS` bumps and the migration registered (if a persisted shape changed).

| Date | Origin | Change | DOC_VERSIONS / migration |
|---|---|---|---|
| 2026-10-02 | P0 (F) | `@docmaker/engine` gets `zod@4.6.5` in `dependencies` (its §4.19 API uses `z.ZodType`; pnpm does not hoist zod). | — |
| 2026-10-03 | P2 (I): root `pnpm test` | `packages/engine/vitest.config.ts`: `sequence.groupOrder: 1` (vitest 5 refuses projects with their own `maxWorkers` in the default group). | — |
| 2026-10-03 | ISSUES W4 voice item 1 + 8 | core `runSidecar`: a non-zero exit with `{"error": <ErrorCode>, "message"}` in `out.json` throws that code (hint for TOOL_MISSING/MODEL_MISSING) instead of INTERNAL; the sidecar runs with `PYTHONDONTWRITEBYTECODE=1`. | — |
| 2026-10-03 | ISSUES W3 assets P1 | `CONTACT_UA_HOSTS` += `upload.wikimedia.org` (core + §4.17 text). | — |
| 2026-10-03 | ISSUES W3 assets P2 | path table: `P.userFrozen(assetId)`, `P.liveCache(provider, sha16)` (package-private, unversioned; not DOC_REGISTRY rows). | — |
| 2026-10-03 | ISSUES W7 remotion | `DEFERRED_TRANSITIONS = {}` (every §10.5 cover is implemented; core + §4.12 text). Timelines may now contain filmBurn/paperRip/whipStreaks/dotWipe/iris covers; the Timeline schema already allowed them. | — (shape unchanged) |
| 2026-10-03 | ISSUES W6 director P1, P2 | `DirectorInput.outline?: Outline \| null`; `DirectorInput.project` gains an optional `assets` (`maxClipSeconds`) (§4.19 text). | — |
| 2026-10-03 | ISSUES W6 P4 / W1 | true-crime-dossier: `Stamp` disabled (its `overshootAllowedIn` stays `[]`, Appendix A); `validateStyleData` warns `STYLE_OVERSHOOT` for an enabled overshoot-only component missing from `overshootAllowedIn`. | — |
| 2026-10-03 | ISSUES W10 P2 / §16.6 | director: a replaceSource override refused by `validateAsset` → lint `POLICY` **error** in `timeline/<lang>.lint.json` (was `OVERRIDE_REJECTED` warn). | — |
| 2026-10-03 | ISSUES engine → render (yuvj420p) | render: h264 chunks with Remotion `colorSpace: "bt709"` (limited range, bt709 tags); post and concat-fallback re-encodes tag/convert limited-range BT.709; slice hash `preset` = `<preset>@enc2` (`CHUNK_ENCODING_VERSION`), so pre-P2 chunks re-render once. | — (`render.json` shape unchanged) |
| 2026-10-03 | P2 (I): fakes | engine: `withStubFallback`, `isNotImplemented` removed from the public API (P0 stub fallback); `packages/engine/test/fakes/{assets,audio,export}.ts` deleted (only `FakeRenderClient` remains for Chrome-free tests); `packages/audio/src/notImplemented.ts` deleted. | — |
| 2026-10-03 | ISSUES W11 P4a | `apps/web/package.json`: `"test:ui": "playwright test"` (no dependency change; lockfile unchanged). | — |
| 2026-10-03 | ISSUES W11 P3 | spec §14.3/§17.2 text: guards live in `src/proxy.ts` (Next 16), the upload route runs `checkRequest` itself. | — |
| 2026-10-03 | P2 (I): CLI from the repo | root `package.json`: `docmaker`/`demo`/`setup`/`doctor` scripts run `node apps/cli/bin/docmaker.js` (the bin shim: proxy re-exec with `NODE_USE_ENV_PROXY=1`, UNDICI-EHPA warning filtered) instead of `tsx apps/cli/src/main.ts`, which ignored a configured proxy for `fetch`. | — |
| 2026-10-03 | P2 (I): CLI chapter selection | `direct`/`mix`/`render` without `--chapters` use the chapter selection the existing layout was built with (one note on stderr); `layout` still defaults to all chapters. A demo project (`--only-chapters CH1,CH2`) no longer fails `docmaker direct <slug>` with UPSTREAM_MISSING. | — |
| 2026-10-03 | P2 (I): QA staleness | the QA stage hashes the render document without its run bookkeeping (`renderMs`, chunk `ms`/`cached`): a fully cached re-render no longer stales the QA report. Existing QA reports read as stale once. | — |
