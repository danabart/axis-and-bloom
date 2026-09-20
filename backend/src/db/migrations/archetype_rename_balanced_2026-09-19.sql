-- Archetype rename: 'Balanced & Sweet' -> 'Balanced' (2026-09-19)
--
-- STATUS: not a separate prod step. Every statement below is also in
-- schema.sql (immediately before the coffee_archetype seed INSERT), which runs
-- on every backend boot, so the deploy itself performs the rename. This file is
-- the standalone record of the same statements, for a manual run against a
-- database the app does not boot against. Idempotent: safe to run repeatedly.
--
-- Display name only. Unchanged: coffee_archetype.id (UUID), code
-- 'balanced_sweet' / archetype_enum, the /match/balanced-sweet URL, colour,
-- description text, scoring and adjacency.
--
-- Order matters at boot: the rename must run BEFORE the seed INSERT. With
-- coffee_archetype.code NOT NULL, a WHERE NOT EXISTS miss on the old name
-- would try to insert a code-less row and fail 23502.
--
-- Columns swept (B3 discovery, see CLOSING_REPORT.md): newsletter_subscriber.archetype
-- is the only column holding the display name as a key. quiz_funnel_event.archetype
-- (event history), free-text copy/notes and jsonb snapshots are deliberately left.
-- Old names keep resolving anyway: catalogReads.archetypeCode() maps the retired
-- labels to the code.

BEGIN;

UPDATE coffee_archetype SET name = 'Balanced', updated_at = NOW() WHERE name = 'Balanced & Sweet';

UPDATE newsletter_subscriber SET archetype = 'Balanced'
 WHERE archetype IN ('Balanced & Sweet', 'Balanced and Sweet');

COMMIT;
