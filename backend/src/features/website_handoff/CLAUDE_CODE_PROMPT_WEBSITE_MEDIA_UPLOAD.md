# Brief: Website media upload — handoff photos and video into the asset bucket

**Workstream:** website_handoff · **Date:** 2026-11-05 · **Model tier:** cheaper/faster · **Mode:** writes to the production asset bucket `gs://axis-bloom-assets` (no database, no deploy) · **Depends on:** briefs 3, 4, 6 (their registry keys are live and point at the targets below). Re-run after 7A adds the quiz rows.

Read first: `README.md` (D11), `frontend/src/design/CLAUDE.md`, `backend/src/features/image_pipeline/` (how `raw/<path>` becomes `optimized/<path>.webp` + `-mobile.webp` through the Cloud Function; the bucket's `max-age=300` cache), `MEDIA_MAP.json` in this folder (the rows to upload).

## Goal

Every row of `MEDIA_MAP.json` exists in the bucket at its `target`, the optimizer has produced the WebP pair for each image, and the live pages show Camila's photos instead of the fallbacks. Dana and Camila do nothing by hand (G1.10).

**Decisions already made:** targets are the ones the page briefs registered; a target is never renamed · an existing object is never overwritten unless its content differs and `--replace` is passed · the MP4 and the poster are served raw (no optimizer) · credentials: the gitignored `serviceAccountKey.json` (Firebase Admin SDK) at the repo root, through `firebase-admin`'s storage client already in `backend/`; never `github-actions-sa-key.json`, never a key in the repo or in logs.

**Guardrails.** G1.10 no manual ops for Dana · G3.6 secrets stay out of the repo and logs · G3.7 scripts under `backend/scripts` run as `script:upload-handoff-media`; this one writes no database row · G1.7 does not apply (this is an ops brief that commits the script and the map only) · G1.6 push after commit. STOP points: the first bucket write (confirm the dry-run table with Dana in the session before `--write`).

## Task 0 — verify first

1. Read `MEDIA_MAP.json`; confirm every `source` file exists and every `target` matches the key the page's `assets.ts` entry resolves to (`optimized('home/family-floral')` ↔ `raw/home/family-floral.jpg`, `raw('video/home-loop.mp4')` ↔ `raw/video/home-loop.mp4`). Report any mismatch and STOP.
2. Confirm `serviceAccountKey.json` is gitignored and which bucket roles its account holds (a read of `gs://axis-bloom-assets/raw/` through the client is the test; if it cannot write, STOP and report the role needed).
3. Read the optimizer function (`cloud-functions/image-optimizer/`): trigger, output names, accepted content types.

## Part A — the script

`backend/scripts/upload-handoff-media.ts` (run with `npx tsx`):
- `--map <path>` (default this folder's `MEDIA_MAP.json`), `--dry-run` (default) prints a table: source, size, md5, target, bucket state (`missing` / `same` / `different`), action.
- `--write`: uploads `missing` rows with the right `contentType` and `cacheControl: public, max-age=300` (the registry's convention); skips `same`; refuses `different` unless `--replace`.
- `--verify`: for each image row, polls (up to 3 minutes) until `optimized/<path>.webp` and `-mobile.webp` exist; for raw rows, checks the object; then fetches each public URL and reports HTTP status. Prints one table; exit code non-zero if anything is missing.
- Logs never print credentials or the key path's contents.

## Task 0.5 — Dana in the session

Run `--dry-run`, show the table, wait for her "go", then `--write` and `--verify`.

## Acceptance

The verify table all green; the three pages checked live (`/`, `/shop`, `/the-axis`, `?preview=true`) showing the new photos (the Axis "Start here" shows the glass mug on the crosswalk, Home's five family panels show Camila's five photos, the film section plays `home-loop.mp4`). Screenshots at 1280.

## Docs and closing

`WHAT_WE_BUILT.md` one entry; `OPEN_TASKS.md`: per-coffee photos (OT-77) use the same script with new rows; `CLOSING_REPORT_MEDIA_UPLOAD.md` with the verify table. Commit the script and the map; push.

## Do not

- Do not rename or move an existing bucket object; do not delete anything in the bucket.
- Do not commit a key or print one; do not use the GitHub Actions key.
- Do not upload the quiz photos until brief 7A has added their rows to `MEDIA_MAP.json`.
