# Image asset registry — rules for this folder

This folder contains `assets.ts`, the single source of truth mapping semantic asset keys to URLs in the `gs://axis-bloom-assets` Cloud Storage bucket. Read this before adding, changing, or removing anything here. Full background: `backend/src/features/image_pipeline/IMAGE_ASSET_INVENTORY_AND_PLAN.md`.

## The pattern

- `optimized(path)` — for photos and PNGs that should be auto-compressed to WebP by the bucket's Cloud Function. Resolves to `optimized/<path>.webp` + `optimized/<path>-mobile.webp`. The Cloud Function generates these automatically from whatever's uploaded to the matching `raw/<path>` — never write directly into `optimized/`.
- `raw(path)` — for SVGs and video, served as-is from `raw/<path>`, no processing. Also used for anything that shouldn't be touched by the optimizer.

## Naming convention

`category.subject.variant`, lowercase, kebab-case — e.g. `archetypeAssets.floral.hero`. Archetype slugs are fixed in `ARCHETYPE_SLUGS`; use those exactly, don't invent alternate spellings or casing.

## Hard rules

- **Never touch `Shop.tsx`.** It's being retired once The Bloom absorbs it — permanently out of scope for this registry until Dana says otherwise.
- **Never rename or remove an existing key without explicit confirmation.** Live pages import these keys directly — a silent rename breaks them.
- **When adding a new key, always report back the exact `raw/...` bucket path** the human needs to upload the source file to. The code change alone does nothing until a file exists at that path — this is the other half of the task, not optional.
- **Bucket objects use a short cache (`max-age=300`), not the `immutable` long-cache convention used for hashed JS/CSS bundles.** This is intentional, not a bug to "fix" — stable filenames + short cache is what makes swap-in-place replacements actually show up promptly. Don't change it to match the JS/CSS convention.

## Who's asking

Both Dana and Camila may hand you tasks touching this folder. Camila typically needs a new key added for a new image and the upload path reported back — she'll handle the actual file upload herself via the Cloud Console. Don't assume either of them wants the change deployed silently; say what you changed plainly.

## Other docs in this area

- `backend/src/features/image_pipeline/IMAGE_ASSET_INVENTORY_AND_PLAN.md` — full asset inventory, key table, governance model
- `backend/src/features/image_pipeline/CLAUDE_CODE_PROMPT_IMAGE_PIPELINE.md` — the original bucket + registry migration build
- `backend/src/features/image_pipeline/CAMILA_ASSET_GUIDE.md` — the non-technical guide Camila works from day to day
