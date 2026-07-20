# Image pipeline — GCS bucket & technical reference

Live reference for the infrastructure built by `CLAUDE_CODE_PROMPT_IMAGE_PIPELINE.md`
(executed 2026-07-19/20, see `SESSION_HISTORY.md` in this folder for the full narrative).
Keep this file in sync if the bucket, function, or registry structure ever changes.

---

## GCP project

- **Project ID**: `axis-and-bloom-prod`
- **Region**: `us-central1` (matches Cloud Run / Cloud SQL)

## Bucket

- **Name**: `gs://axis-bloom-assets`
- **Storage class**: Standard, uniform bucket-level access
- **Object Versioning**: **on** — a bad overwrite is recoverable without needing the
  original file from a design tool
- **Public read**: `allUsers` → `roles/storage.objectViewer`
- **CORS**: `GET`/`HEAD`, any origin, `Content-Type` exposed, 1hr max-age
- **Cache-Control**: `public, max-age=300` (5 minutes) set on every object at upload
  time — deliberately short, not the JS/CSS `immutable` convention, because filenames
  here are stable on purpose (that's what makes a same-path replacement work); a long
  cache would mean a real replacement doesn't show up for anyone with a cached copy.

### IAM

| Member | Role | Why |
|---|---|---|
| `camilamarchon@gmail.com` | `roles/storage.objectAdmin` (whole bucket) | Dana's explicit decision, recorded in the original spec — lets Camila upload/replace/delete any object without a deploy |
| `allUsers` | `roles/storage.objectViewer` | Public read — the frontend serves objects directly, no signed URLs |
| `service-892123729036@gs-project-accounts.iam.gserviceaccount.com` (GCS service agent) | `roles/pubsub.publisher` (project-level) | Required for GCS to deliver object-finalize events to Eventarc. Had to be force-provisioned (`gcloud storage service-agent --project=axis-and-bloom-prod`) — it didn't exist yet in this project before this migration. |

## Cloud Function — `optimize-bloom-image`

- **Type**: gen2, Node.js 20, region `us-central1`
- **Source**: `cloud-functions/image-optimizer/` (`index.js` + `package.json`)
- **Entry point**: `optimizeImage`
- **Trigger**: `google.cloud.storage.object.v1.finalized` on `gs://axis-bloom-assets`
- **Memory / timeout**: **2048Mi / 120s** — not the spec's original 512Mi/60s. Several
  real source photos (the July 2026 scan shoot in particular) exceeded both 512Mi and
  1024Mi during processing; 2048Mi is what actually clears them. If a future upload
  hits `Memory limit exceeded` in the function logs, that's the first thing to bump.
- **Behavior**: for every object landing under `raw/<path>.<ext>`:
  - `.svg` and `.mp4` are skipped entirely — no `optimized/` copy, frontend reads
    `raw/` directly for those.
  - Everything else gets two WebP outputs written back to the bucket:
    `optimized/<path>.webp` (quality 85, full size) and
    `optimized/<path>-mobile.webp` (resized to 800px max width, quality 85).
- **Redeploy command** (from repo root):
  ```
  gcloud functions deploy optimize-bloom-image --gen2 --runtime=nodejs20 \
    --region=us-central1 --source=cloud-functions/image-optimizer \
    --entry-point=optimizeImage --memory=2048Mi --timeout=120s \
    --trigger-event-filters="type=google.cloud.storage.object.v1.finalized" \
    --trigger-event-filters="bucket=axis-bloom-assets"
  ```
- **Logs**: `gcloud functions logs read optimize-bloom-image --region=us-central1`

## Bucket path convention

Lowercase, kebab-case, **no dates or version numbers baked into filenames** — the
whole point is the path never changes even when the file behind it does.

```
raw/archetypes/<slug>/hero.png        →  optimized/archetypes/<slug>/hero.webp (+ -mobile.webp)
raw/archetypes/<slug>/sm1.png         →  optimized/archetypes/<slug>/sm1.webp  (+ -mobile.webp)
raw/archetypes/<slug>/sm2.png         →  optimized/archetypes/<slug>/sm2.webp  (+ -mobile.webp)
raw/archetypes/<slug>/bag.png         →  optimized/archetypes/<slug>/bag.webp  (+ -mobile.webp)
raw/archetypes/<slug>/wallpaper.jpg   →  optimized/archetypes/<slug>/wallpaper.webp (+ -mobile.webp)
raw/home/scan-<slug>.jpg              →  optimized/home/scan-<slug>.webp (+ -mobile.webp)
raw/home/photo-essay-{1,2,3}.png      →  optimized/home/photo-essay-{1,2,3}.webp (+ -mobile.webp)
raw/quiz/pic-{1..6}.png               →  optimized/quiz/pic-{1..6}.webp (+ -mobile.webp)
raw/quiz/coffee-large.png             →  optimized/quiz/coffee-large.webp (+ -mobile.webp)
raw/patterns/<slug>.jpg               →  optimized/patterns/<slug>.webp (+ -mobile.webp)
raw/lifestyle/<name>.jpg              →  optimized/lifestyle/<name>.webp (+ -mobile.webp)
raw/brand/<name>.svg                  →  (skipped — no optimized/ copy)
raw/video/<name>.mp4                  →  (skipped — no optimized/ copy)
```

`<slug>` is one of: `floral`, `fruity`, `balanced-sweet`, `chocolate-nutty`,
`spicy-earthy`, `experimental`.

## Frontend registry

**`frontend/src/design/assets.ts`** is the single source of truth. Every component
imports from here — nobody free-types a bucket URL. Sections:

- `archetypeAssets` — `{ hero, sm1, sm2, bag, wallpaper }` per archetype slug
- `homeAssets` — `scan.<slug>` (Home's own per-archetype photo, deliberately
  distinct from `archetypeAssets[x].hero`) + `photoEssay1/2/3`
- `quizAssets` — `pic1..pic6` + `coffeeLarge`
- `patternAssets` — small per-archetype background patterns, shared by
  `FlavorQuiz.tsx` and `TasteFinderSection.tsx`
- `lifestyleAssets` — `family`, `coffee15`, `coffee15Vertical`
- `brandAssets` — `logoQuarter1`, `logoLines` (only the 2 logo files with any
  current import anywhere — others are unmigrated, same as any unused asset)
- `videoAssets` — `aboutHero`, `aboutSecondary`, `homePlaceholder`, `homeHero`

Each `optimized()`-backed entry returns `{ src, mobileSrc }`. Only `.src` is wired up
in components today (behavior-equivalent to the old bundled imports) — `.mobileSrc`
is there and ready for FIX-02 (queued next in the site-readiness workstream) to wire
up responsive `srcSet`/lazy-loading without another migration pass.

## Replacing an image (Camila's workflow)

1. Overwrite the object at its existing `raw/<path>` in the bucket (Cloud Console,
   `gsutil`, or any tool authenticated as her Google account — she has
   `objectAdmin` on the whole bucket).
2. `optimize-bloom-image` fires automatically and regenerates both `optimized/`
   variants within a few minutes.
3. Live on the site within the 5-minute cache window. No code change, no deploy.

Adding a **new** key (a new archetype, a new page section) is different — that
needs a small edit to `assets.ts` plus a code change, since a manifest key has to
exist before anything can reference it.

## Known rough edges / notes for next time

- **`&` in filenames breaks `gsutil.cmd` uploads from PowerShell.** `gsutil.cmd` is a
  batch wrapper reprocessed by `cmd.exe`, which treats bare `&` as a command
  separator — PowerShell's own quoting doesn't protect against that second layer.
  Workaround used throughout: copy the file to a temp path with `&` replaced (e.g.
  `and`) before calling `gsutil cp`; the bucket destination path is unaffected.
- **Node 20 is flagged deprecated** by `gcloud functions deploy` (community support
  ended 2026-04-30). Function still deploys and runs fine — just a warning, not
  blocking. Worth bumping the Cloud Function's runtime the next time this folder is
  touched.
- **`package-lock.json` is missing** from `cloud-functions/image-optimizer/` — the
  deploy warns about it every time ("improve build performance by generating and
  committing package-lock.json"). Harmless, but a `npm install` + commit there would
  quiet it and pin dependency versions.
