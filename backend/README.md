# Axis & Bloom — Backend

Express + PostgreSQL API. See the repo root `WHAT_WE_BUILT.md` / `WHAT_WE_BUILT_DB.md` for the full project log and schema reference.

## Running tests

The test suite runs against a dedicated `axisandbloom_test` database — a full clone of prod, kept on the same Cloud SQL instance (`axis-bloom-db`) — never against prod itself. `npm test` refuses to run (before loading a single test file) against anything whose database name doesn't end in `_test`, or that matches `DATABASE_URL`.

**Personal data note**: the test database is a full prod copy, including `user_profile` and its emails/phone numbers. It lives on the same private Cloud SQL instance behind the same Auth Proxy and IAM as prod, so its steady-state exposure is unchanged — but don't export it anywhere else. The refresh below does briefly write a full dump to Cloud Storage in transit; see the bucket note below for why that's still safe.

1. Start the Cloud SQL Auth Proxy (same one used for `DATABASE_URL`).
2. Add `TEST_DATABASE_URL` to `.env` — same host/port/credentials as `DATABASE_URL`, database name `axisandbloom_test` (see `.env.example`).
3. Run `npm run test:db:refresh` whenever prod's schema or data has moved on. This clones `axisandbloom` into `axisandbloom_test` via Cloud SQL's own `gcloud sql export sql` / `gcloud sql import sql` (not `pg_dump`/`psql` — neither is installed locally, and the private instance already has export/import built in) — prints row counts for `coffees`, `coffee_slot_assignment`, and `user_profile` before and after. Requires the `gcloud` CLI, authenticated as (or impersonating) an identity with Cloud SQL admin access.
   - The dump transits through `gs://axis-bloom-db-transfers`, a **private** bucket created solely for this — uniform bucket-level access, public access prevention enforced, IAM limited to the Cloud SQL instance's own service account (`storage.objectAdmin`) and the project owner, plus a 1-day object-deletion lifecycle rule as a backstop. The script deletes the dump object itself immediately after import; the lifecycle rule only matters if a run is interrupted before that cleanup runs. **This bucket must never be made public or reused for anything else** — it exists only to hold `user_profile` data in transit for the seconds a refresh takes.
4. Run `npm test`. `globalSetup` applies `schema.sql` to the test database **twice** at the start of every run (proving the next deploy's boot will be a clean, idempotent no-op) before any test file executes, then prints a one-line catalog integrity summary (informational — a real, pre-existing data gap there doesn't fail the run).
