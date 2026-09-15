# Retired seeds — history only, never run again

Moved here by Catalog Blueprint brief 2 (2026-09-14, `backend/src/features/
catalog_blueprint/CLAUDE_CODE_PROMPT_CATALOG_2_SERVICE_ROUTES_IMPORT.md`,
Part D). These nine files are the 2026-06/2026-08 Path Coffee Roasters +
Temecula Coffee Roasters catalog seed — the original manual bootstrap of
`coffees`, `dial_archetype_positions`, `coffee_alias`, `dial_coffee_relationships`,
`archetype_assignments`, and `roaster_blend` for those two roasteries:

- `coffees_path_tcr.sql`
- `dial_positions_base.sql`
- `dial_positions_path_tcr.sql`
- `dial_seam_positions.sql`
- `coffee_alias_path_tcr.sql`
- `dial_relationships_base.sql`
- `archetype_assignments_base.sql`
- `archetype_assignments_path_tcr.sql`
- `roaster_blend_both.sql`

**Do not run these again.** Both roasteries were later soft-deactivated
(`WHAT_WE_BUILT.md` #170) and the catalog is now empty by design (Catalog
Blueprint's decisions N1/N3 — see the series `README.md`). From brief 2
onward, catalog data enters through exactly one path: `catalogImport.ts` /
`npm run catalog:import` (dry-run by default), which validates a manifest,
writes through `catalogService.ts`'s verbs in one transaction, and produces
an integrity report — not a hand-written SQL seed file.

Kept here rather than deleted, per this codebase's dormant-data discipline
(same convention as retiring `archetype_relationship`, `#141`): the rows
these scripts once produced are still live history (inactive `coffees` rows,
their cupping sessions, stories, etc.), and the scripts themselves are a
record of exactly how that history was built, even though re-running them
would be wrong (duplicate inserts, `dial_archetype_positions`/`coffee_alias`
writes to tables the new model treats as legacy-only, no `roaster_id`/
`archetype.code` awareness).

**Catalog Blueprint brief 5a (2026-09-15):** the tables these seeded no
longer exist — `dial_archetype_positions` and `coffee_alias` were dropped
outright (along with `dial_slot_alias` and `dial_position_vocabulary`, seeded
elsewhere in `schema.sql`, not by these files). These scripts could never be
re-run even in principle now; they stay here as history only.
