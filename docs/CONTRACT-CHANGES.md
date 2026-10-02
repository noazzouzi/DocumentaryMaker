# Contract changes

Owned by the integration agent (I). Every change to `packages/core/**`, a `package.json`, the lockfile or a root config after P0 is recorded here: date, origin (`docs/ISSUES.md` entry), the change, `DOC_VERSIONS` bumps and the migration registered (if a persisted shape changed).

| Date | Origin | Change | DOC_VERSIONS / migration |
|---|---|---|---|
| 2026-10-02 | P0 (F) | `@docmaker/engine` gets `zod@4.6.5` in `dependencies` (its §4.19 API uses `z.ZodType`; pnpm does not hoist zod). | — |
