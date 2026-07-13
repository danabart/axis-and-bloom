# Claude Code prompt — image pipeline: GCS bucket + shared asset registry + optimization

## Context

Axis & Bloom currently bundles all site images as direct file imports (`import photo from '../../design/IMAGES/...png'`) across 7 frontend files. This couples every image swap to a code change + deploy, and has led to real duplication (the same 6 archetype bag PNGs are imported separately in 4 different files instead of shared). Full background, the complete file inventory, the proposed semantic key table, and the governance model are written up in `backend/src/features/image_pipeline/IMAGE_ASSET_INVENTORY_AND_PLAN.md` — **read that file first**, it has the authoritative key→file mapping this prompt implements.

Decisions already made by Dana (don't re-litigate these):
- All pages, including Home, reuse shared registry keys — no page-specific asset copies. Home's archetype photo consolidates onto the same `.hero` key Bloom/Shop use.
- `Shop.tsx` is explicitly **out of scope** — it's being retired once The Bloom absorbs it. Do not touch `Shop.tsx`'s code. (Its image files still get migrated to the bucket since Bloom needs them — see the key table.)
- Orphaned/unused files in `design/IMAGES/` (see inventory doc section 3) are **not migrated and not deleted** — leave them exactly where they are in git.
- GCP project: `axis-and-bloom-prod`, region: `us-central1` (matches existing Cloud Run/Cloud SQL infra).
- Optimization (WebP conversion + a mobile-size variant) is in scope for this pass, not deferred.

## Execution order (do not reorder — later parts depend on earlier ones existing)

1. Part 1 — GCP bucket + IAM + versioning
2. Part 2 — Optimization Cloud Function (deployed *before* uploading originals, so uploads in Part 3 trigger it automatically)
3. Part 3 — Upload original assets to the bucket (triggers Part 2's function)
4. Part 4 — Frontend registry + migrate the 7 files
5. Part 5 — Cleanup + verification

---

## Part 1 — GCP bucket setup

```bash
gcloud config set project axis-and-bloom-prod

# Bucket name must be globally unique across all of GCS. If this name is taken, pick a variant like axis-and-bloom-prod-assets and use it consistently for the rest of this prompt.
# -c standard = Standard ("hot") storage class, explicitly set rather than relying on the default — correct for actively-served website images with frequent reads. Do not use Nearline/Coldline/Archive here, those are for infrequently-accessed data and carry retrieval fees that would apply on every page load.
gsutil mb -p axis-and-bloom-prod -l us-central1 -c standard -b on gs://axis-bloom-assets

# Public read — objects are served directly, no auth needed by the frontend
# If this fails with an "Public Access Prevention" or organization policy error: the project may have Public Access Prevention enabled at the org/project level, which blocks allUsers grants outright. Check Cloud Storage > Bucket > Protection tab if this happens, and disable Public Access Prevention on this specific bucket before retrying — don't disable it project-wide.
gsutil iam ch allUsers:objectViewer gs://axis-bloom-assets

# Versioning — safety net so a bad Camila overwrite is recoverable
gsutil versioning set on gs://axis-bloom-assets

# CORS — needed if any code ever fetch()'s an image (e.g. canvas manipulation) rather than just <img src>. Cheap to add now, avoids a second setup pass later.
cat > /tmp/cors.json << 'EOF'
[
  {
    "origin": ["*"],
    "method": ["GET", "HEAD"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
EOF
gsutil cors set /tmp/cors.json gs://axis-bloom-assets
```

**Cache-Control — important, do not copy the JS/CSS `immutable, max-age=31536000` convention here.** That convention works for hashed filenames (`app.a1b2c3.js`) where a content change always produces a new filename. Bucket assets use **stable filenames on purpose** (that's what makes Camila's swap-in-place workflow work) — an `immutable` 1-year cache would mean her replacement never actually shows up for anyone with a cached copy. Use a moderate cache instead, set per-object at upload time (Parts 2/3 below): `Cache-Control: public, max-age=300` (5 minutes). Short enough that a real replacement is visible almost immediately, long enough to absorb repeat page loads.

**IAM for Camila — confirmed by Dana: whole-bucket object admin.**

```bash
gcloud storage buckets add-iam-policy-binding gs://axis-bloom-assets \
  --member="user:camilamarchon@gmail.com" \
  --role="roles/storage.objectAdmin"
```

---

## Part 2 — Optimization Cloud Function

Deploy this **before** Part 3's upload, so every original triggers optimization automatically on arrival. Source layout: new directory `cloud-functions/image-optimizer/`.

**Design:** originals are uploaded to `raw/<path>` (e.g. `raw/archetypes/floral/hero.png`). A 2nd-gen Cloud Function triggers on object finalize under `raw/`, and writes a compressed WebP to the mirrored `optimized/<path-without-ext>.webp` path, plus a `-mobile` variant capped at 800px wide for responsive `srcset` use. SVGs and video pass through untouched (skip processing, frontend references `raw/` directly for `brand.*` and `video.*` keys — see Part 4).

`cloud-functions/image-optimizer/package.json`:
```json
{
  "name": "image-optimizer",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "@google-cloud/functions-framework": "^3.0.0",
    "@google-cloud/storage": "^7.0.0",
    "sharp": "^0.33.0"
  }
}
```

`cloud-functions/image-optimizer/index.js`:
```javascript
const functions = require('@google-cloud/functions-framework');
const { Storage } = require('@google-cloud/storage');
const sharp = require('sharp');
const path = require('path');

const storage = new Storage();
const SKIP_EXTENSIONS = ['.svg', '.mp4']; // pass through untouched — no optimized/ copy for these
const MOBILE_MAX_WIDTH = 800;
const CACHE_CONTROL = 'public, max-age=300';

functions.cloudEvent('optimizeImage', async (cloudEvent) => {
  const data = cloudEvent.data; // gen2 storage CloudEvents deliver the object metadata directly on .data — bucket, name, contentType, size
  const bucketName = data.bucket;
  const filePath = data.name; // e.g. raw/archetypes/floral/hero.png

  if (!filePath.startsWith('raw/')) return; // ignore anything not under raw/ (avoids reprocessing our own output — required, do not remove)

  const ext = path.extname(filePath).toLowerCase();
  if (SKIP_EXTENSIONS.includes(ext)) return; // svg/video skipped — bag PNGs and all photos DO get processed below

  const bucket = storage.bucket(bucketName);
  const relativePath = filePath.slice('raw/'.length); // archetypes/floral/hero.png
  const withoutExt = relativePath.slice(0, -ext.length); // archetypes/floral/hero

  const [buffer] = await bucket.file(filePath).download();

  // Full-size WebP
  const fullWebp = await sharp(buffer).webp({ quality: 85 }).toBuffer();
  await bucket.file(`optimized/${withoutExt}.webp`).save(fullWebp, {
    metadata: { contentType: 'image/webp', cacheControl: CACHE_CONTROL },
  });

  // Mobile-width WebP
  const mobileWebp = await sharp(buffer)
    .resize({ width: MOBILE_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  await bucket.file(`optimized/${withoutExt}-mobile.webp`).save(mobileWebp, {
    metadata: { contentType: 'image/webp', cacheControl: CACHE_CONTROL },
  });

  console.log(`Optimized ${filePath} -> optimized/${withoutExt}.webp (+ -mobile variant)`);
});
```

Note on quality: 85 is a reasonable default for both photos and the transparent bag PNGs (WebP preserves alpha transparency fine at lossy quality). If the bag renders show visible edge artifacts after conversion once live, that's a one-line bump to `lossless: true` for that asset category — not worth over-engineering into the function now.

Deploy — use `--trigger-event-filters`, not the older `--trigger-bucket`/`--trigger-location` shorthand (both exist, but the event-filters form is the current documented pattern and avoids ambiguity about which trigger style gets provisioned):
```bash
gcloud functions deploy optimize-bloom-image \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=cloud-functions/image-optimizer \
  --entry-point=optimizeImage \
  --trigger-event-filters="type=google.cloud.storage.object.v1.finalized" \
  --trigger-event-filters="bucket=axis-bloom-assets" \
  --memory=512Mi \
  --timeout=60s
```

Two things that can trip up this specific deploy, flagging so they don't look like failures:
- **First-time setup prompt:** if this is the first Eventarc/Storage trigger ever created in this project, `gcloud` will detect that the special GCS service agent needs `roles/pubsub.publisher` on the project to deliver storage events, and will prompt to grant it automatically. Say yes — Dana's Owner role covers approving this, it's a one-time grant, not a red flag.
- **Entry point must match:** `--entry-point=optimizeImage` must match the string passed to `functions.cloudEvent('optimizeImage', ...)` in `index.js` exactly — this is what the search-and-verify step in Part 3 catches if it's wrong (uploads succeed, but nothing shows up under `optimized/`).

---

## Part 3 — Upload original assets

Use the exact key→file mapping from `IMAGE_ASSET_INVENTORY_AND_PLAN.md` section 2. Upload every **used** file (skip everything listed as orphaned in section 3 — those stay in git only, don't touch the bucket).

Write a one-time migration script (`cloud-functions/image-optimizer/migrate-assets.sh` or similar, doesn't need to be permanent) that does, for every row in the key table:

```bash
gsutil -h "Cache-Control:public, max-age=300" cp \
  "frontend/src/design/IMAGES/photos/june2026/WEBCUTFloralJun01.png" \
  "gs://axis-bloom-assets/raw/archetypes/floral/hero.png"
```

...repeated for all ~29 used files (bags, hero/sm1/sm2 per archetype, wallpapers, lifestyle photos, the taste-finder bag, the 6 LOGO SVGs under `raw/brand/`, and the 4 video files under `raw/video/` — videos and SVGs still go through this same upload step, they just won't get an `optimized/` copy per Part 2's skip logic). Use the exact archetype slugs from the inventory doc (`floral`, `fruity`, `balanced-sweet`, `chocolate-nutty`, `spicy-earthy`, `experimental`).

**Set Content-Type explicitly for the SVG and video uploads** — `gsutil`'s auto-detection is reliable for `.png`/`.jpg`, but don't rely on it for `.svg`/`.mp4`, add the header explicitly for those two groups:
```bash
gsutil -h "Cache-Control:public, max-age=300" -h "Content-Type:image/svg+xml" cp \
  "frontend/src/design/LOGO/LogoCircle.svg" \
  "gs://axis-bloom-assets/raw/brand/logo-circle.svg"

gsutil -h "Cache-Control:public, max-age=300" -h "Content-Type:video/mp4" cp \
  "frontend/src/design/IMAGES/videos/PlaceHolder09.mp4" \
  "gs://axis-bloom-assets/raw/video/about-hero.mp4"
```

After running, verify the Cloud Function actually fired: check that `optimized/archetypes/floral/hero.webp` and `optimized/archetypes/floral/hero-mobile.webp` exist (`gsutil ls gs://axis-bloom-assets/optimized/archetypes/floral/`) before moving to Part 4. If they're missing, check Cloud Function logs (`gcloud functions logs read optimize-bloom-image --region=us-central1`) before proceeding — Part 4's registry will silently reference broken URLs otherwise.

---

## Part 4 — Frontend registry + code migration

Create `frontend/src/design/assets.ts` as the single source of truth. Every component imports from here — no raw file imports for anything covered by this registry.

```typescript
const BUCKET_BASE = 'https://storage.googleapis.com/axis-bloom-assets';

function optimized(path: string) {
  return {
    src: `${BUCKET_BASE}/optimized/${path}.webp`,
    mobileSrc: `${BUCKET_BASE}/optimized/${path}-mobile.webp`,
  };
}

function raw(path: string) {
  return `${BUCKET_BASE}/raw/${path}`;
}

export const ARCHETYPE_SLUGS = [
  'floral', 'fruity', 'balanced-sweet', 'chocolate-nutty', 'spicy-earthy', 'experimental',
] as const;
export type ArchetypeSlug = typeof ARCHETYPE_SLUGS[number];

export const archetypeAssets: Record<ArchetypeSlug, {
  hero: ReturnType<typeof optimized>;
  sm1: ReturnType<typeof optimized>;
  sm2: ReturnType<typeof optimized>;
  bag: ReturnType<typeof optimized>; // Part 2's function processes every raw/ upload except .svg/.mp4 — bag PNGs get optimized too (WebP preserves alpha transparency), so this must read from optimized/, not raw/, to match what actually gets generated
  wallpaper: ReturnType<typeof optimized>;
}> = {
  floral: {
    hero: optimized('archetypes/floral/hero'),
    sm1: optimized('archetypes/floral/sm1'),
    sm2: optimized('archetypes/floral/sm2'),
    bag: optimized('archetypes/floral/bag'),
    wallpaper: optimized('archetypes/floral/wallpaper'),
  },
  // ...repeat for fruity, balanced-sweet, chocolate-nutty, spicy-earthy, experimental,
  // using the exact source-file mapping in IMAGE_ASSET_INVENTORY_AND_PLAN.md section 2
};

export const lifestyleAssets = {
  family: optimized('lifestyle/family'),
  coffee15: optimized('lifestyle/coffee-15'),
  coffee15Vertical: optimized('lifestyle/coffee-15-vertical'),
  coffee13: optimized('lifestyle/coffee-13'),
};

export const uiAssets = {
  tasteFinderBag: raw('ui/taste-finder-bag.png'),
};

export const brandAssets = {
  logoCircle: raw('brand/logo-circle.svg'),
  logoLines: raw('brand/logo-lines.svg'),
  logoQuarter1: raw('brand/logo-quarter-1.svg'),
  logoQuarter2: raw('brand/logo-quarter-2.svg'),
  logoQuarter3: raw('brand/logo-quarter-3.svg'),
  logoQuarter4: raw('brand/logo-quarter-4.svg'),
};

export const videoAssets = {
  aboutHero: raw('video/about-hero.mp4'),
  aboutSecondary: raw('video/about-secondary.mp4'),
  homePlaceholder: raw('video/home-placeholder.mp4'),
  homeHero: raw('video/home-hero.mp4'),
};
```

Adjust the `optimized()` return shape / `<img srcSet>` wiring to whatever pattern fits how these are actually rendered in each component (some may just need `.src`, others may want a real `srcSet` string using `mobileSrc` at a breakpoint — check each usage site rather than assuming one pattern fits all six components).

**Migrate these 7 files to import from `assets.ts` instead of raw files** (do NOT touch `Shop.tsx`):

1. `About.tsx` — `lifestyleAssets.family`, `lifestyleAssets.coffee15`, `videoAssets.aboutHero`, `videoAssets.aboutSecondary`
2. `bloomVisuals.ts` — all 6 archetypes' `.bag`, `.hero`, `.sm1`, `.sm2` — this is where the 6 duplicated bag imports collapse into references to the one shared `archetypeAssets[slug].bag`
3. `FlavorQuiz.tsx` — all 6 archetypes' `.wallpaper` and `.bag`
4. `Home.tsx` — all 6 archetypes' `.bag`, and **`.hero`** (not a separate Home-only photo — this is the consolidation decision from section 5 of the inventory doc), `videoAssets.homePlaceholder`, `videoAssets.homeHero`
5. `NewsletterModal.tsx` — `lifestyleAssets.coffee15Vertical`
6. `PreLaunch.tsx` — `lifestyleAssets.coffee15Vertical` (same key as NewsletterModal — this was already organically shared via duplicate imports, now it's one registry entry)
7. `TasteFinderSection.tsx` — `lifestyleAssets.coffee13`, `uiAssets.tasteFinderBag`

Also migrate `Navigation.tsx`, `Footer.tsx`, and any other file importing from `design/LOGO/` to use `brandAssets` instead, for consistency (low priority, small files, but keeps the registry the single source of truth rather than a partial one).

---

## Part 5 — Cleanup + verification

- Delete only the ~29 files from `frontend/src/design/IMAGES/` and `frontend/src/design/LOGO/` that were actually migrated (the exact list is every file referenced in Part 3's upload script). **Do not touch anything else in `design/IMAGES/`** — the orphaned files (roughly 900 MB, listed in the inventory doc section 3) stay in git untouched, per Dana's explicit decision.
- Run the frontend build (`npm run build` in `frontend/`) and confirm it succeeds with no missing-import errors, and check the resulting `dist/` bundle size dropped meaningfully (no more large PNGs inlined into the JS bundle).
- Visually smoke-test each of the 7 migrated pages (or at minimum confirm no broken image icons / 404s in the network tab) — Home, About, FlavorQuiz result screen, NewsletterModal, PreLaunch, TasteFinderSection, and wherever `bloomVisuals.ts` is consumed (Bloom page).
- Confirm `Shop.tsx` still renders correctly and was not modified.
- Spot-check that a couple of `optimized/*.webp` files are meaningfully smaller than their `raw/` originals (should be roughly 5MB → a few hundred KB, per the original performance findings).
- Confirm Camila's IAM grant works: have her (or simulate via `gsutil -i` impersonation if not available yet) try replacing one file under `raw/archetypes/floral/` and verify the Cloud Function re-fires and `optimized/archetypes/floral/hero.webp` updates within a few minutes.
