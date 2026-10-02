# Fixtures

Recorded LLM responses for the offline demo and the safety suite. `FixtureLlm` (`@docmaker/llm`) serves
`<fixture>/llm/<step>[.<key>].json` and validates each file with the step's wire schema; a missing file raises
`FIXTURE_MISSING`. The JSON files are generated from one authored source per fixture so that beat texts reconstruct
their segments exactly in every language:

```sh
python3 packages/llm/scripts/gen-fixtures/tulip.py fixtures/tulip-mania
python3 packages/llm/scripts/gen-fixtures/gate.py fixtures/gate-test
pnpm --filter @docmaker/llm test        # golden test: 0 lint errors, 0 beat errors, FR/EN parity, no high fact-check item
```

| Fixture | Use | Notes |
|---|---|---|
| `tulip-mania/` | `docmaker demo` (EN + FR, 1.5 min, `autoApproveGates: true`) | Historical topic, no living subject of any claim. Sources are real public pages: Wikipedia "Tulip mania" (text quoted under CC BY-SA 4.0), Anne Goldgar's *Tulipmania* (2007, Google Books page), Charles Mackay's *Extraordinary Popular Delusions* (1841, Project Gutenberg, public domain). Mackay's anecdotes carry `status: "disputed"`. |
| `gate-test/` | safety suite (EN, `autoApproveGates: false`) | Every person, company and source is **fictional** (`example.org`). Exercises: a clip that differs from its verbatim quote (rule a), an accusatory on-screen card on a person beat (rule f), a non-public person named in narration (rule h / `person-ack`), a `charged_pending` claim older than 30 days (`recheck` gate), 2 high LLM fact-check items + 1 `quote_mismatch`. |

File keys: `research.json`, `factsheet.json`, `style.json`, `outline.json`, `chapter.<lang>.<CHn>.json`,
`revise.<lang>.<CHn>.json`, `beats.<CHn>.json` (primary language), `beatslice.<lang>.<CHn>.json` (secondary
languages), `factcheck.<lang>.<CHn>.json`, `recheck.json`.
