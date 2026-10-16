# CLAUDE.md

House rules for Claude Code in this repo.

## Data catalog (data catalog brief 2, Dana, 2026-10-16)

- **Before proposing any new table or view**, read `CATALOG.md` (repo root) and state in the brief why no existing object fits. Dana, 2026-10-13: "before proposing any new table, check what already exists and say why it doesn't fit."
- **Any brief that creates, alters or drops a table, view or column** also adds or updates its `COMMENT ON` lines in `backend/src/db/comments.sql` (format in that file's header), then ends by running `npm run catalog:md` (in `backend/`, through the Cloud SQL proxy: `npm run catalog:md -- --expect-db axisandbloom`) and committing the regenerated `CATALOG.md`.
- `CATALOG.md` is generated. Never edit it by hand, and never move comment text back into `WHAT_WE_BUILT_DB.md`.
- The boot check (`backend/src/services/dataCatalogIntegrity.ts`) reports, and never blocks: an uncommented object, an `UNVERIFIED` comment, a malformed comment or a stale `CATALOG.md` shows up in the boot log (`[data-catalog]`) and on the admin System Health card.
- **One writer per table (data catalog brief 3).** Each table's `Writer:` field in `comments.sql` lists every module that writes it: `module.function` entries separated by commas, groups by semicolons (`Writer: catalogService.createCoffee, catalogService.updateCoffee; seed; backfill:migrateSavedItems`). `npm run lint:lineage` (in CI before every deploy) fails when code writes a table from a module the field does not name. Adding a writer means declaring it in the same change. A grant probe that only looks like a write (`UPDATE t SET id = id WHERE false`) gets `// lineage: probe, not a write` on its line or the line above; every use is listed in `lineage.json`.
