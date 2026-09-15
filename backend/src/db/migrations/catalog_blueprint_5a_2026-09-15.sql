-- Catalog Blueprint · brief 5a — drop the legacy, tighten the constraints (2026-09-15)
--
-- STATUS: not run as a standalone step — every statement below is also in
-- schema.sql, which runs automatically on every backend startup. This file
-- exists only as the narrative record, same convention as catalog_blueprint_1/
-- 3/4's own migration files. Exact statements, in the order schema.sql applies
-- them (order matters: A1 re-keys dial_position_signal before A2 drops the
-- table it pointed at; A2's drops must land before A3's NOT NULLs, since the
-- NOT NULL preconditions were only verified true after the legacy tables —
-- which never wrote roaster_id/coffee_id/code — were out of the picture).
--
-- See backend/src/features/catalog_blueprint/README.md and this brief's own
-- CLAUDE_CODE_PROMPT_CATALOG_5_DROP_LEGACY.md for full context, including the
-- pg_depend dependents list and NULL-precondition counts verified against
-- prod before this ran (both in the closing report, not repeated here).
--
-- Two brief-1 boot-time seeds were rewritten as part of this (not a schema
-- change on their own, called out here since they're easy to miss): the
-- coffee_dial_slot backfill (was: JOIN dial_slot_alias + dial_position_vocabulary;
-- now: a static 24-row seed frozen from prod's actual current values, since 4
-- chocolate_nutty slots had since been renamed live via brief 4's admin page)
-- and the archetype dial-config copy (was: UPDATE ... FROM dial_archetype_config;
-- now: a static per-code UPDATE, self-limiting to run once via its own WHERE
-- guard). See schema.sql for both in full — reproduced here would just be a
-- second copy to keep in sync.

-- ── A1. Re-key the cupping signal before its vocabulary disappears ─────────
ALTER TABLE dial_position_signal ADD COLUMN IF NOT EXISTS suggested_slot_id INT REFERENCES coffee_dial_slot(id);
-- (backfill from dial_position_vocabulary + coffee_dial_slot — guarded on the
-- vocabulary table still existing; see schema.sql for the exact guarded form)
ALTER TABLE dial_position_signal DROP COLUMN IF EXISTS suggested_vocabulary_id;

-- ── A2. Drop the five legacy placement tables and two dependent views ──────
DROP VIEW IF EXISTS v_dial_positions;
DROP VIEW IF EXISTS v_dial_navigation;
DROP TABLE IF EXISTS dial_archetype_positions CASCADE;
DROP TABLE IF EXISTS coffee_alias CASCADE;
DROP TABLE IF EXISTS dial_slot_alias CASCADE;
DROP TABLE IF EXISTS dial_position_vocabulary CASCADE;
DROP TABLE IF EXISTS dial_archetype_config CASCADE;

-- v_dial_position_consensus rebuilt onto suggested_slot_id and renamed
-- v_coffee_dial_position_consensus (it is catalog-side) — see schema.sql.

-- ── A3. Dead columns dropped, NOT NULLs added ──────────────────────────────
ALTER TABLE roaster_blend DROP COLUMN IF EXISTS archetype_id;
-- CASCADE: v_coffee_hop (hop_type below) and v_coffee/v_cupping_scores_readable
-- (roaster below) each still depend on the column at this exact point in
-- schema.sql's linear execution — both unconditionally redefined later in the
-- same file without referencing the dropped column, so the cascade is safe;
-- caught live on the first deploy attempt (2BP01) — see the closing report.
ALTER TABLE dial_coffee_relationships DROP COLUMN IF EXISTS hop_type CASCADE;
DROP TYPE IF EXISTS hop_type_enum;
ALTER TABLE dial_slot_price DROP COLUMN IF EXISTS archetype;
ALTER TABLE dial_slot_price DROP COLUMN IF EXISTS dial_sort_order;
ALTER TABLE user_bloom_dial_current_position DROP COLUMN IF EXISTS dial_sort_order;
ALTER TABLE coffees DROP COLUMN IF EXISTS roaster CASCADE;

-- Each wrapped in its own DO/EXCEPTION in schema.sql so an unmet precondition
-- can't abort the rest of the apply (index.ts checks whether each took):
ALTER TABLE coffees ALTER COLUMN roaster_id SET NOT NULL;
ALTER TABLE roaster_blend ALTER COLUMN coffee_id SET NOT NULL;
ALTER TABLE archetype ALTER COLUMN code SET NOT NULL;
ALTER TABLE dial_slot_price ALTER COLUMN slot_id SET NOT NULL;
-- CREATE UNIQUE INDEX IF NOT EXISTS, not ALTER TABLE ADD CONSTRAINT ... UNIQUE
-- (a hotfix, see the closing report: a named UNIQUE constraint's backing index
-- collides with itself on a re-run, raising 42P07 rather than the 42710 an
-- EXCEPTION WHEN duplicate_object guard catches):
CREATE UNIQUE INDEX IF NOT EXISTS dial_slot_price_slot_weight_key ON dial_slot_price(slot_id, weight_oz);

-- v_coffee.roaster_name loses its coffees.roaster fallback and
-- roaster_name_is_fallback column; v_coffee_hop.hop_type_stored is gone,
-- hop_type_derived becomes plain TEXT (no more hop_type_enum cast);
-- v_cupping_scores_readable's `roaster` column now joins the real roaster
-- table instead of reading the dropped free-text column — see schema.sql for
-- all three view bodies in full.
