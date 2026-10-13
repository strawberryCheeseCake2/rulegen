# Server checks (backup)

Removed on 2026-10-13: the studio now relies on the prompts alone. These files are kept to restore the checks if needed. `backup/` is excluded from typecheck and tests.

What they did after an AI extraction / compose / revision / transform:

| Check | Module | Flagged | On violation |
|---|---|---|---|
| Repeated elements | `procedural.ts` (`repeatedSiblings`) | ≥3 structurally identical siblings, or 2 differing only by numbering | one AI rewrite; then merged into one node with a `repeat-layout` "Repetition" transformation (`collapseRepeats`) |
| Split objects | `granularity.ts` (`splitObjects`) | touching/overlapping sibling objects with the same primitive | one AI rewrite, then accepted |
| Flat lists | `granularity.ts` | ≥6 sibling objects and no collections | one AI rewrite, then accepted |
| Effect buckets | `granularity.ts` (`GENERIC_TRANSFORMATION`) | transformations named "Spatial", "Style", "Temporal" … or unnamed | one AI rewrite, then accepted |
| Overloaded transformation | `granularity.ts` | ≥5 properties in one transformation | one AI rewrite, then accepted |

## Restore

1. Move `granularity.ts` and `procedural.ts` back to `app/lib/scene/`.
2. Paste the code in `review-hooks.ts.txt` into `app/server/intents.server.ts` and `app/server/ai.server.ts` (the repair round).
3. Optionally re-add the "… are rejected" sentences to `prompts/contracts/scene-model.md`.
4. Append `tests/*.checks.ts.txt` to `tests/scene-model.test.ts` / `tests/scene-ai.test.ts` (they need `updateNode`, `convertScene`, `AlgorithmCall` imports).
5. `npm run typecheck && npm test`.
