# Closing report: data catalog brief 4 (resolve the 84 UNVERIFIED comments)

> Brief: `CLAUDE_CODE_PROMPT_DATA_CATALOG_4_RESOLVE_UNVERIFIED.md` · Executed 2026-10-16 · Committed on main, not pushed (Dana deploys)

## What changed

- **`backend/src/db/comments.sql`:** exactly 84 statements rewritten, applied by a script that took the text verbatim from the brief and asserted each target existed once and was `UNVERIFIED` before replacing it.
  - 10 table statements (A1);
  - 41 column statements (A2);
  - 33 prod-only columns with the `UNVERIFIED: not in schema.sql | ` prefix removed (A3).

  `COMMENT ON` count is unchanged at 1,203, and no statement was added, removed or moved.
- **`comments.format.test.ts`:** the test is renamed to `every table comment for an object not created in schema.sql says so and is deprecated or snapshot`. For every table or view statement not created in `schema.sql`, it now requires all three of:
  - the text does not start with `UNVERIFIED`;
  - the text starts with `Purpose: Not in schema.sql.`;
  - `Class` is `deprecated` or `snapshot`.

  The `created` set computation is unchanged.
- **`dataCatalogIntegrity.test.ts`:** `toBe(84)` became `toBe(0)`.
- **`CATALOG.md`:** regenerated.
- **Docs:** the brief 4 row in `README.md`, `WHAT_WE_BUILT.md` #223 and an "As of" line in `WHAT_WE_BUILT_DB.md`.

## The six numbers (Part C)

| # | Check | Result |
|---|---|---|
| 1 | `npx vitest run src/db/comments.format.test.ts` | 9/9 passed |
| 2 | `npm run lint:lineage` | exit 0 (0 undeclared writers) |
| 3 | `npm run lint:catalog` | exit 0 |
| 4 | `npx vitest run src/db/comments.db.test.ts src/services/dataCatalogIntegrity.test.ts` (test DB) | 4/4 passed; check #2 reports 0 UNVERIFIED |
| 5 | `CATALOG.md` header | `… 1035 table columns · 0 UNVERIFIED · …`, no `**UNVERIFIED:**` line, catalog-hash `6493f8131b12…` |
| 6 | `grep -c UNVERIFIED backend/src/db/comments.sql` | 1 (the header rule line) |

No test other than the two named in Part B needed a change, and nothing failed.

## Noticed, not fixed (decision 8)

1. **The brief says the two prod-only tables are skipped on the test DB. They are not.** The test DB is a full clone of production, so `liam_sms_feedback` and `newsletter_subscriber_backup_20260925` exist there. That means:
   - `applyCommentsSql` skipped nothing;
   - the `toBe(0)` assertion actually ran rather than being guarded out;
   - a direct query of `v_data_catalog` on the test DB shows 0 `is_unverified` and 0 uncommented.
2. **`user_vector_state.declared_score` and `.behavior_score` still say "presumably 0-15 scale".** They were not among the 84, because they never carried the prefix. Under decision 3 they would read "scale undefined, table unused", the same as `quiz_vector.score` and `roastery_blend_vector.score` now do.
3. **`CATALOG.md` lost its production Activity section.** The brief's `npm run catalog:md` reads the test DB, and Activity renders only from production, so the section is back to its placeholder. Production can't be the source yet because it only gets the new comments at boot after Dana's deploy. After that deploy, `npm run catalog:md -- --expect-db axisandbloom` should keep catalog-hash `6493f813…` and restore Activity, in a small follow-up commit.
4. **The A2 text for `cupping_note.intensity_score` names `cupping_score_descriptors.intensity (0-15)`.** I used it verbatim and did not re-verify the 0-15 range.

## Done when

Dana deploys. Then:
- the boot log shows `[db-comments] applied N statements`;
- the `[data-catalog]` line no longer reports check #2;
- System Health → Data catalog → check #2 reads 0.
