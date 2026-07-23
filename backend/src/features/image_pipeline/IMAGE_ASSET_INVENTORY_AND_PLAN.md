# Image asset inventory + registry/governance plan

Cross-cutting, not page-specific — supersedes `the_bloom_page/IMAGE_PERFORMANCE_FINDINGS.md`'s deferred recommendation now that the fix is being built (GCS bucket + semantic asset registry + optimization Cloud Function). Written from an actual scan of `frontend/src/design/IMAGES/` (2026-07-12) — Dana doesn't have local access to the images, so this is the authoritative inventory for planning the migration.

**Do not build code from this document yet.** This is the inventory + naming plan Dana asked for before a Claude Code prompt gets written. Confirm the key table and governance approach with Dana first.

---

## 1. Headline numbers

- `design/IMAGES/` is **1.1 GB across 131 files**.
- Only **~29 unique files are actually imported anywhere in the app** (checked every `.tsx`/`.ts` under `frontend/src`, plus `.css` for `url()` references — none found outside JS/TS imports; `frontend/public/` is empty, so there's no second static-asset path to worry about).
- That means roughly **100 files (~900 MB+) are sitting in the repo unused** — old photoshoot exports, superseded bag renders, and a couple of very large one-off hero photos that were tried and then reverted. None of this bloats the live site (Vite only bundles what's imported), but it bloats every clone/checkout of the repo, and it's exactly the kind of clutter a real asset registry should leave behind rather than carry into the bucket.

---

## 2. What's actually in use, with proposed semantic keys

Proposed registry keys use `category.subject.variant` — this is what Phase 2 (the code migration) will read from, not raw filenames. Archetype slugs match the existing `ARCHETYPE_NAME_TO_KEY` convention already used in code: `floral`, `fruity`, `balanced-sweet`, `chocolate-nutty`, `spicy-earthy`, `experimental`.

### Archetype bag art — used in 4 places today (`bloomVisuals.ts`, `FlavorQuiz.tsx`, `Home.tsx`, `Shop.tsx`) via 4 separate imports of the *same* 6 files. This is the clearest existing case of the duplication problem — one registry entry per archetype fixes all 4 at once.

| Proposed key | Current file |
|---|---|
| `archetypes.floral.bag` | `bags/new bags mock up/FLORAL transp.png` |
| `archetypes.fruity.bag` | `bags/new bags mock up/FRUITY transp.png` |
| `archetypes.balanced-sweet.bag` | `bags/new bags mock up/BALANCED & SWEET transp.png` |
| `archetypes.chocolate-nutty.bag` | `bags/new bags mock up/CHOCOLATE & NUTTY transp.png` |
| `archetypes.spicy-earthy.bag` | `bags/new bags mock up/SPICY & EARTHY transp.png` |
| `archetypes.experimental.bag` | `bags/new bags mock up/EXPERIMENTAL transp.png` |

### Archetype hero/sm1/sm2 — used identically in `bloomVisuals.ts` and `Shop.tsx` (Shop's copy can be dropped once Shop retires; Bloom keeps using the registry key)

| Proposed key | Current file |
|---|---|
| `archetypes.floral.hero` / `.sm1` / `.sm2` | `photos/june2026/WEBCUTFloralJun01/08/14.png` |
| `archetypes.fruity.hero` / `.sm1` / `.sm2` | `WEBCUTFruityJun01/05/06.png` |
| `archetypes.balanced-sweet.hero` / `.sm1` / `.sm2` | `WEBCUTBalanced&SweetJun02/04/09.png` |
| `archetypes.chocolate-nutty.hero` / `.sm1` / `.sm2` | `WEBCUTChocolate&NuttyJun02/08/10.png` |
| `archetypes.spicy-earthy.hero` / `.sm1` / `.sm2` | `WEBCUTSpicy&EarthyJun04/07/11.png` |
| `archetypes.experimental.hero` / `.sm1` / `.sm2` | `WEBCUTExperimentalJun2/7/10.png` |

### Archetype photo used on Home — **resolved: consolidate, don't keep distinct.** `Home.tsx` currently uses a *different* photo per archetype than the hero above (e.g. Floral's Home photo is `Jun20`, not `Jun01`) purely as an artifact of separate per-page imports — not a deliberate design choice. Dana's call: all pages, including Home, should reuse the same shared components/assets rather than carrying page-specific copies. `Home.tsx` will be migrated to read `archetypes.X.hero` (the same key Bloom and Shop use), and the six now-unneeded Home-only photos (`WEBCUTFloralJun20.png`, `WEBCUTFruityJun03.png`, `WEBCUTBalanced&SweetJun07.png`, `WEBCUTChocolate&NuttyJun05.png`, `WEBCUTSpicy&EarthyJun05.png`, `WEBCUTExperimentalJun5.png`) move to the "not migrated" list in section 3 — they stay in git, just outside the registry, same as the rest of the unused shoot exports.

### Archetype quiz-result wallpapers (`FlavorQuiz.tsx` only)

| Proposed key | Current file |
|---|---|
| `archetypes.floral.wallpaper` | `archetypes/Floral.jpg` |
| `archetypes.fruity.wallpaper` | `archetypes/Fruity.jpg` |
| `archetypes.balanced-sweet.wallpaper` | `archetypes/Balanced-&-Sweet.jpg` |
| `archetypes.chocolate-nutty.wallpaper` | `archetypes/WEBChocolate&Nutty.png` (inconsistent format vs. the others — worth converting to jpg/webp in the optimization pass) |
| `archetypes.spicy-earthy.wallpaper` | `archetypes/Spicy-&-Earthy.jpg` |
| `archetypes.experimental.wallpaper` | `archetypes/Experimental.jpg` |

### Lifestyle / brand photography

| Proposed key | Current file | Used in |
|---|---|---|
| `lifestyle.family` | `lifestyle/FamilyEdit.jpg` | About |
| `lifestyle.coffee-15` | `lifestyle/CoffeePic15.jpg` | About |
| `lifestyle.coffee-15-vertical` | `lifestyle/CoffeePic15Vertical.jpg` | NewsletterModal **and** PreLaunch — already an organic example of reuse, registry just makes it explicit |
| `lifestyle.coffee-13` | `lifestyle/CoffeePic13.png` | TasteFinderSection |

### Misc / UI

| Proposed key | Current file | Used in |
|---|---|---|
| `ui.taste-finder-bag` | `bags/TransparentBag03.png` | TasteFinderSection |

### Brand (not under `IMAGES/`, but same reuse logic applies — currently in `design/LOGO/`, 32 KB total, all SVG, small enough that bundling isn't a real problem, but including for completeness since these are also referenced from multiple pages)

`LogoCircle.svg`, `LogoLines.svg`, `LogoQuarter1–4.svg` — used in Home, Navigation, Footer, About. Proposed keys: `brand.logo-circle`, `brand.logo-lines`, `brand.logo-quarter-1..4`. Low priority to migrate — small files, no performance cost — but worth including in the same registry for consistency rather than leaving them as a separate exception.

### Video

| Proposed key | Current file | Used in |
|---|---|---|
| `video.about-hero` | `videos/PlaceHolder09.mp4` | About |
| `video.about-secondary` | `videos/PlaceHolder08.mp4` | About |
| `video.home-placeholder` | `videos/PlaceHolder01.mp4` | Home |
| `video.home-hero` | `videos/PlaceHolder10.mp4` | Home |

Note: `OPEN_TASKS.md` OT-10 already flags these as placeholders pending real brand video — worth migrating them into the bucket now under stable keys so the eventual swap-in of real video is also a no-deploy replacement, not a second migration.

### Bloom Dial icon — doesn't exist as an image yet

Checked: there's no dial/wheel SVG or PNG anywhere in `design/`. The rotating dial graphic is drawn in code (`BloomDialWidget.tsx`), not an image asset. Dana's example (dial icon reusable across archetypes/pages) is the right *pattern* to design the registry for, but there's nothing to migrate for it today — noting so the registry's key structure (e.g. reserving `brand.dial-icon` or similar) anticipates it if/when Camila designs a graphic version, rather than treating this as a current migration item.

---

## 3. Confirmed orphaned — resolved: stays in git, not migrated, not deleted

**Decision:** nothing gets deleted. Camila may want some of these later, and moving ~900 MB into cloud storage costs money to store indefinitely for files nothing currently uses — git is already free and already has them, so they simply stay in the repo, outside the registry/bucket. Not part of the migration scope. Revisit only if Camila specifically wants to pull one of these back into active use, at which point it gets a proper registry key like anything else.

- `A_B03.png`, `A_B06.png` (61 MB combined) — old hero photos, explicitly kept "for future use" per commit history (`CAMILAS_UPDATES.md` #12–14) after being removed from `Home.tsx`.
- `bags/TransparentBag01.png`, `TransparentBag02.png` — superseded by the "new bags mock up" set (only `TransparentBag03.png` is still used, in TasteFinderSection).
- `archetypes/Chocolate&NUTTY.svg` — superseded by `WEBChocolate&Nutty.png`.
- `lifestyle/CoffeePic01–12.png`, `CoffeePic16.jpg`, `CoffeePic17.jpg`, `ARCHETYPE_Balanced_Sweet01.png`, `ARCHETYPE_Floral01.png`, `ARCHETYPE_Fruity01.png`, `ARCHETYPE_Spicy_Earthy01.png` — the largest chunk of the orphaned total (roughly 300+ MB), 11–56 MB each, no current references found.
- `photos/june2026/` — of 89 `WEBCUT*` files in this folder, only 24 are actually used (the hero/sm1/sm2 selections above, now that Home consolidates onto the same hero). The other ~65 are unselected shots from the same shoot.
- The six `WEBCUT*` files `Home.tsx` used before consolidation (`FloralJun20`, `FruityJun03`, `Balanced&SweetJun07`, `Chocolate&NuttyJun05`, `Spicy&EarthyJun05`, `ExperimentalJun5`) — folded into the same unused set now that Home reuses `.hero`.
- `elements/*.svg`, `patterns/*.svg` — no import or CSS `url()` reference found by this scan. Worth a manual double-check before assuming dead, in case they're referenced somewhere this scan didn't cover.
- `references/colorpalette.png` — a design reference file, not a site asset. Shouldn't migrate regardless of usage status.

---

## 4. Governance — how the repository and naming convention stay controlled going forward

Two mechanisms, working together, not one:

**A manifest file, version-controlled in the code repo (not in the bucket).** A single config (e.g. `frontend/src/design/assets.ts` or `.json`) is the only place semantic keys get defined — it maps every key above to its bucket path. Nobody free-types a bucket URL in a component; every page imports from this manifest. This is what makes the naming convention enforceable rather than just documented: a typo'd or inconsistent path would be a code-review-visible diff, not a silent drift.
- **Replacing** an existing image (Camila swaps in a new `hero.jpg` for Floral) touches *only* the bucket — no manifest change, no code change, no deploy.
- **Adding** a new key (a new archetype, a new page section) *does* require a manifest update — a small Claude Code change, not a full migration.

**Bucket folder structure that mirrors the manifest categories**, with Camila's upload access scoped to just those prefixes (`archetypes/*`, `lifestyle/*`, `ui/*` — not the whole bucket). This keeps the convention physically enforced, not just relied-upon.

**Additional safety net:** turn on GCS Object Versioning on the bucket. If Camila overwrites `archetypes/floral/hero.jpg` with the wrong crop, the previous version is recoverable without anyone needing to dig up the original file from a design tool or ask Claude Code to restore it.

**Naming rules for the bucket paths themselves:** lowercase, kebab-case, no dates or version numbers baked into filenames (`hero.jpg`, not `WEBCUTFloralJun01.png`) — stability of the name is the entire point, since the manifest key never changes even when the file behind it does.

---

## 5. Decisions (resolved 2026-07-12)

1. **All pages, including Home, reuse the same shared registry keys** — no page-specific asset copies. Home consolidates onto `archetypes.X.hero` rather than keeping a distinct `.home` variant. This is the general rule for the registry going forward, not a one-off exception for Home.
2. **Orphaned files (~900 MB) stay in git, untouched.** Not migrated to the bucket, not deleted, not moved to a separate cloud archive (storing unused files in the cloud costs money on an ongoing basis; git storage is already sunk cost). Revisit individually if Camila wants to bring one back into active use.
3. **Bucket name/region confirmed:** `axis-and-bloom-prod` project, `us-central1`, matching existing Cloud Run/Cloud SQL infra.

Registry now fully resolved — ready for the Claude Code prompt (Phase 1 GCP setup, Phase 2 code migration, Phase 3 optimization Cloud Function).

---

## 6. Registry drift — noted 2026-07-23

This document describes the registry as it stood at the original migration (2026-07-12). `frontend/src/design/assets.ts` has since grown new sections not reflected above. Recorded here so anyone working from this doc — including a fresh Claude Code session with no memory of prior conversations — starts from what's actually in the codebase, not just the original plan.

| Export | What it's for | Bucket path pattern | Status |
|---|---|---|---|
| `quizAssets` | FlavorQuiz question photography (6 pics) + one large lifestyle shot | `quiz/pic-1..6`, `quiz/coffee-large` | Upload status unverified — check the bucket before assuming these are live |
| `cardAssets` | Per-archetype card images (the "WEB*" set), used in the quiz wrap reveal | `archetypes/web-<slug>.png` (e.g. `archetypes/web-floral.png`) | Not yet uploaded as of 2026-07-23. **This is the slot for Camila's 6 new WEB*.png files** (currently sitting in `frontend/src/design/IMAGES/archetypes/`) — flat naming, hyphenated slug, not a nested per-archetype subfolder. |
| `patternAssets` | Small per-archetype background patterns, shared by FlavorQuiz and TasteFinderSection | `patterns/<slug>` | Upload status unverified |
| `homeAssets.scan` | Home's own per-archetype photo, described in-code as the "2026-07 scan shoot" | `home/scan-<slug>.jpg` | Uploaded 2026-07-23 (6 files: `EDITScanFloral.jpg` etc. from `frontend/src/design/IMAGES/photos/scan/`). **Flag: this conflicts with the decision in Section 5.1 above** — that Home should reuse `archetypeAssets[x].hero` rather than carry its own per-archetype photo. Not yet confirmed with Dana whether this supersedes that decision or was an unintended upload. Do not build further on this assumption until resolved. |
| `homeAssets.photoEssay1/2/3` | Undocumented — no source or purpose note found anywhere prior to this entry | `home/photo-essay-1..3` | Needs a note next time someone touches this file |
| `brandAssets` | Reduced to 2 logos (`logo-quarter-1`, `logo-lines`) from the original 6 listed in Section 2 | `brand/*.svg` | Presumably the other 4 have no current import — unconfirmed |
| `videoAssets` | Now includes poster-frame images for the two Home videos | `video/*-poster` | — |
