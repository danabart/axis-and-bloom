# Session history — Sensory Source Provenance (2026-07-14)

Summary of the Claude Code session that built the WCR Lexicon provenance feature, for continuity in future sessions.

## What was asked

Update the `cupping_note` and `coffee_dimensions` tables with WCR (World Coffee Research) data, with git and GCP connectivity confirmed first, and `WHAT_WE_BUILT.md`, `WHAT_WE_BUILT_DB.md`, and `SOMMELIER_BUILT.md` kept up to date.

## Starting state

- Git and GCP access confirmed at session start (repo 1 commit ahead of `origin/main`, gcloud authenticated as `danabar.mail@gmail.com` against `axis-and-bloom-prod`).
- Found an already-drafted, untracked spec in this folder: `CLAUDE_CODE_PROMPT.md` (+ `SOURCES.md`, `WCR_Sensory_Lexicon_2.0.url`) — fully specified, ready to execute.
- Other unrelated uncommitted/untracked work was already sitting in the tree (`users.ts`/`FlavorQuiz.tsx`/`Profile.tsx` modifications, `find_my_flavor_page/`, `Bloom_Dial_Base_Data.xlsx`, a Temecula insert `.xlsx`). Left entirely alone per Dana's instruction, both at commit time and again explicitly reconfirmed mid-session.

## Spec bugs found and fixed before writing any SQL

Checked the spec's assumptions against the live `schema.sql` rather than trusting them:
1. **`cupping_note.id` is `UUID`, not `INT`.** The spec's `cupping_note_id INT REFERENCES cupping_note(id)` FK type was wrong — corrected to `UUID` in the actual DDL.
2. **`cupping_note`'s wheel columns are `wheel_category`/`wheel_subcategory`, not `category`/`subcategory`.** The spec's own `verify.sql` checksum query used the wrong column names — corrected in the `verify.sql` actually written.

Also confirmed the `coffee_dimensions` id→name mapping the spec assumed (1=Fragrance … 12=Mouthfeel) matched the live seeded rows exactly, so Part 4's backfill table was trustworthy as-is.

## What was built

**`backend/src/db/schema.sql`** (idempotent DDL + backfills that only depend on `sensory_source`, safe on every boot):
- New `sensory_source` table + 4-row inline seed (`wcr_lexicon`, `sca_flavor_wheel`, `sca_cva`, `platform`).
- New `sensory_lexicon_attribute` reference table (structure only — bulk data lives in the seed file).
- `cupping_note`: added `descriptor_source_id`, `lexicon_section`; backfilled `descriptor_source_id = wcr_lexicon` for all rows.
- `coffee_dimensions`: added `source_id`, `sensory_lexicon_attribute_id`; backfilled `source_id` per dimension (`sca_cva`/`wcr_lexicon`/`platform`).

**`backend/src/db/seeds/sensory_lexicon_attributes_wcr.sql`** (bulk data, run manually — same convention as `archetype_vectors.sql`):
- 113 rows across all 17 WCR Lexicon sections (109 unique names; `Sweet`/`Sour`/`Bitter`/`Salty` intentionally cross-listed under both "Taste Basics" and their own section, per WCR's own structure), each with a best-effort `wheel_category`/`wheel_subcategory` mapped onto the same taxonomy `cupping_notes_sca_wheel.sql` already uses. Amplitude/Mouthfeel sections left wheel-unmapped (they're WCR/CVA-only, feeding `coffee_dimensions` instead).
- Explicit 84-row mapping (not a bare name join) linking every active `cupping_note` descriptor to its lexicon attribute — several WCR names are ambiguous across sections (`Bitter`/`Salty` in both Taste Basics and Chemical; `Sweet`/`Sour` in both Taste Basics and their own section) and three need an alias (`Overripe` → "Overripe / Near-fermented", `Brown` → "Brown-Roast", `Roast` → "Roasted").
- Backfills `cupping_note.lexicon_section` from that link, then `coffee_dimensions.sensory_lexicon_attribute_id` for the 7 numeric dims with one specific WCR attribute (Sweetness, Bitterness, Body, Texture, Savory/Depth, Finish Length, Mouthfeel). Acidity deliberately left unlinked — it aggregates the whole Sour/Acid section, not one attribute.

**`backend/src/features/sensory-source-provenance/verify.sql`** — the spec's original verification queries, corrected for the two bugs above.

## Testing / verification

- Set up the Cloud SQL Auth Proxy (per the `axis_and_bloom_local_cloudsql_testing` memory) on port 5433, service account key BOM-stripped to a temp copy.
- Ran a one-off Node script (`pg` client, copied temporarily into `backend/` so `node_modules` resolution worked, deleted after) directly against **production** Cloud SQL:
  - Captured md5 checksums of `cupping_note`'s descriptor/wheel_category/wheel_subcategory and `coffee_dimensions`'s name/scale_min/scale_max *before* any change.
  - Applied `schema.sql` then the seed file.
  - Recaptured both checksums — **matched exactly** (non-destructive, proven not assumed).
  - Ran all `verify.sql` queries: 4 sources present; 113/113 lexicon rows sourced to `wcr_lexicon`; all 84 `cupping_note` rows linked, 0 unmatched; all 12 `coffee_dimensions` sourced, the 7 expected numeric axes linked correctly.
  - Re-ran `schema.sql` + the seed a second time — identical counts (idempotency confirmed).
- Direct `.env` connection to Cloud SQL's public IP timed out (network/allowlist issue on this session, unrelated to the change) — fell back to the Auth Proxy for the backend boot test too. Booted `npm run dev` against the proxy, hit `/api/coffees`, `/api/coffees/archetype-stats?archetype=balanced_sweet`, and `/api/coffees/1/content` — all `200`, real data, no errors from the new columns.
- Stopped the dev server and the Auth Proxy, deleted the temp BOM-stripped key copy after.

## Documentation updated

- `WHAT_WE_BUILT.md` — new entry **#92**.
- `WHAT_WE_BUILT_DB.md` — table count 65→67; new "Sensory source provenance" subsection under the Cupping tool group; `cupping_note`/`coffee_dimensions` bullets annotated with the new columns.
- `SOMMELIER_BUILT.md` — new entry **S42**, following the established "flagged for continuity, not a Sommelier change" pattern (S37/S39/S40/S41): confirmed `sommelierRag.ts` selects specific columns (never `SELECT *`) from `cupping_note`/`coffee_dimensions`, so nothing it reads changed shape.

## Commit + deploy (pushed to `origin/main`)

Staged only this feature's files — explicitly confirmed with Dana first, and again confirmed not to touch the other unrelated uncommitted work (`bloom_dial_base_data/`, the Temecula `.xlsx`):
- `backend/src/db/schema.sql`, `backend/src/db/seeds/sensory_lexicon_attributes_wcr.sql`, `backend/src/features/sensory-source-provenance/` (the pre-existing spec files plus the new `verify.sql`), `WHAT_WE_BUILT.md`, `WHAT_WE_BUILT_DB.md`, `SOMMELIER_BUILT.md`.

Commit `2ef304e`, pushed to `main`. Confirmed via the GitHub API that the `Deploy` Action for that commit completed with `conclusion: success`, and confirmed the live `/health` endpoint responded afterward.

## Left untouched, deliberately

`backend/src/features/bloom_dial_base_data/` and `misc/roasteries/temecula_coffees_insert_v7.xlsx` — unrelated in-progress work found in the tree, explicitly confirmed with Dana not to touch.

## Not done (optional per the spec)

Part 5 — exposing `descriptor_source` on `v_collaborative_flavor_wheel` / the Flavor Intelligence descriptor query so the page can cite "Source: WCR Sensory Lexicon" in the UI. This session was data-layer only; no view or frontend changes were made.
