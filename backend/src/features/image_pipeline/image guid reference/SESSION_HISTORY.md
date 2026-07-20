# Session history — 2026-07-19/20

Covers this session's full arc: FIX-01 (site-readiness workstream) followed by the
image pipeline migration (this folder's own spec). See
`GCS_BUCKET_AND_TECH_REFERENCE.md` in this folder for the resulting infrastructure's
live reference; see `WHAT_WE_BUILT.md` #105/#106 and `SOMMELIER_BUILT.md` S54/S55 for
the canonical build-log entries.

---

## Part 1 — FIX-01: mobile nav menu accessibility

Started in `launch/05_site-readiness/`, per that workstream's own run-command
convention (read `launch/README.md` for context/rules, execute the named prompt only).

**Finding**: the prompt (`FIX-01_mobile_nav_menu.md`) assumed the site had *no* mobile
navigation at all. That was stale — a full mobile hamburger menu (trigger, panel, full
link set, close-on-tap/route-change) had already shipped in the 2026-07-15 home-v3
session, three days before this prompt was written. Confirmed via `git log
-- Navigation.tsx` rather than trusting either the prompt or the file blindly.

**What was actually still missing**, checked line-by-line against the prompt's own
accessibility requirement: Escape-to-close, a focus trap inside the open panel, body
scroll lock while open, and returning focus to the trigger on close. Added all four to
`Navigation.tsx` via one `useEffect` keyed on the menu's open state, plus
`role="dialog"`/`aria-modal`/`aria-controls` wiring.

**Verification**: `vite build` clean. Functionally exercised via direct DOM/JS calls
against the running dev server (open/close, `aria-expanded`, scroll lock, Escape-close,
link-tap-navigate — all confirmed). **Not verified**: true mobile-width visual
rendering or the focus-trap/return-focus behavior in a real focused browser — this
session's browser automation had `document.hasFocus() === false` throughout (a sandbox
limitation, not a code issue), so `document.activeElement` never moved regardless of
what the code did. Flagged for Dana to spot-check on a real device.

Committed `ed68e65`, pushed, GitHub Actions Deploy #510 succeeded, live `/health`
reconfirmed. A concurrent push (`fix(quiz): wrap sequence never rendered`, commit
`6495d01`) landed on `origin/main` mid-session — rebased cleanly, zero file overlap.

Docs follow-up: added `WHAT_WE_BUILT.md` #105 and `SOMMELIER_BUILT.md` S54, updated
`launch/05_site-readiness/README.md`'s status row, and — since the whole `launch/`
folder had been sitting untracked since its 2026-07-18 reorg despite its own README
explicitly warning that the prior version of this folder was once wiped by a `git
clean` for exactly that reason — committed it to git for the first time. Second commit
`5ace1cd`, Deploy #511 succeeded.

---

## Part 2 — Image pipeline: GCS bucket + optimization function + registry

Moved to this folder (`backend/src/features/image_pipeline/`) per Dana's explicit
request to "perform the big image change." Read `CLAUDE_CODE_PROMPT_IMAGE_PIPELINE.md`
and its referenced `IMAGE_ASSET_INVENTORY_AND_PLAN.md` (dated 2026-07-12) before
starting.

### Scope confirmation before spending real GCP resources

This prompt creates billed infrastructure (a bucket + a Cloud Function) and grants a
third party (Camila's personal Google account) write access to it, plus — in its final
step — deletes original image files from the repo. Flagged this to Dana before running
anything and confirmed pace: run all 5 parts straight through rather than pausing after
each.

### Part 1 — GCP setup

Created `gs://axis-bloom-assets` (`axis-and-bloom-prod`, `us-central1`), enabled
versioning, public read, CORS, granted Camila `roles/storage.objectAdmin` on the whole
bucket per the spec's own recorded decision (not re-litigated, per the spec's explicit
instruction not to).

### Part 2 — Cloud Function

Deployed `optimize-bloom-image` (gen2, Node 20, triggered on object-finalize under
`raw/`). First deploy attempt failed — the GCS service agent didn't exist yet in this
project and had no `roles/pubsub.publisher`, which Eventarc needs to deliver storage
events. Force-provisioned it (`gcloud storage service-agent`) and granted the role;
redeploy succeeded.

**Memory sizing needed real iteration, not the spec's stated number.** Deployed at the
spec's 512Mi first — several real source photos exceeded it (`Memory limit of 512 MiB
exceeded with up to 523 MiB used`). Redeployed at 1024Mi — one specific file (a July
scan photo, 11.8MB source) *still* exceeded that (1041 MiB). Redeployed a third time at
2048Mi/120s, which cleared everything. This wasn't discovered by inspection — it was
discovered by uploading, checking `optimized/` for gaps, reading Cloud Function logs
when files were missing, and iterating until the gap count reached zero.

### Part 3 — Upload, after a scope correction

**Before uploading anything**, audited actual current imports across
`frontend/src` via `grep` rather than trusting the week-old inventory doc, and found
real drift:

- `Home.tsx` no longer used the per-archetype hero photos the doc's "consolidate onto
  `archetypeAssets[x].hero`" decision was based on — it now uses 6 new
  `july_scan1/EDITScan*.jpg` files (53MB) from a shoot the doc predates. Migrating per
  the doc literally would have **reverted Home's current, deliberately-chosen
  photography to outdated images** — not a simple path swap, a real content
  regression.
- `TasteFinderSection.tsx` had been completely redesigned since the doc was written —
  it no longer imports `TransparentBag03.png`/`CoffeePic13.png` (the doc's keys for it)
  at all; it now uses 6 inline `?raw`-loaded SVG bags and 6 small pattern JPGs the doc
  never mentions.
- `FlavorQuiz.tsx` had picked up two large undocumented assets: 6 new
  `QuizPic01–06.png` (25MB) and a single `CoffeePic10.png` — **26.6MB by itself**. This
  is the exact page paid mobile ads point at.

Roughly **117MB of currently-live, unoptimized weight** the spec didn't know about, on
top of the ~120MB homepage problem FIX-02 (queued next) already tracks. Surfaced this
to Dana with concrete file sizes before proceeding rather than either reverting real
content or silently expanding scope on my own judgment. Dana chose to expand scope to
match reality — keep current photos, migrate everything actually live.

Uploaded 61 files (vs. the spec's original ~29). 16 failed on the first pass — every
filename containing `&` — because `gsutil.cmd` is a batch wrapper reprocessed by
`cmd.exe`, which treats bare `&` as a command separator; PowerShell's own argument
quoting doesn't protect against that second layer. Fixed by copying each affected file
to a temp path with `&` replaced before upload. Verified all 110 expected
`optimized/*.webp` outputs existed (55 raw sources × 2 variants) before moving on,
iterating through the memory-limit issue above along the way.

### Part 4 — Registry + code migration

Built `frontend/src/design/assets.ts` reflecting the *actual* current asset set (not
the stale doc) — added `homeAssets` and `quizAssets` sections the original plan never
anticipated, on top of the doc's `archetypeAssets`/`lifestyleAssets`/`brandAssets`/
`videoAssets`. Migrated 10 files: `About.tsx`, `bloomVisuals.ts`, `FlavorQuiz.tsx`,
`Home.tsx`, `NewsletterModal.tsx`, `PreLaunch.tsx`, `TasteFinderSection.tsx` (patterns
only), `Navigation.tsx`, `Footer.tsx`, `BloomDialWidget.tsx`.

Two deliberate exceptions, both flagged rather than silently worked around:
- `Shop.tsx` — untouched, exactly as the spec required (it's being retired). Confirmed
  via `git diff --stat` showing zero changes to it after the whole migration.
- `TasteFinderSection.tsx`'s 6 bag SVGs — left as local `?raw` imports. They're
  inlined as markup strings, not fetched as a URL, so they don't fit the registry's
  `src`/`mobileSrc` shape, and they're tiny (~0.1MB total) — no performance case for
  moving them.

Kept the migration to a behavior-equivalent `.src` swap, not touching
`srcSet`/lazy-loading — that's explicitly FIX-02's job next in the workstream order
(FIX-01 → IMG → FIX-02, decided 2026-07-18). Every registry entry already exposes
`.mobileSrc` so FIX-02 can wire responsive loading without another migration.

### Part 5 — Cleanup + verification

Deleted only the 37 files with **zero remaining local imports** after migration,
confirmed via a fresh `grep`, not assumed from the spec's own file list (the spec's
~29-file estimate would have missed some of the newly-discovered assets and also
wrongly implied some hero/sm1/sm2/bag files could go — they can't, `Shop.tsx` still
needs them locally).

Compression spot-check: `CoffeePic10.png` 26.6MB → 2.1MB WebP (92% reduction) + 41KB
mobile variant; a July-scan photo 21.4MB → 6.2MB + 101KB mobile; an archetype bag PNG
1.07MB → 76KB.

**Live verification, not just `vite build`.** Started the backend against real
production Cloud SQL via the Auth Proxy (BOM-stripped service account key,
`cloud-sql-proxy` on port 5433, `DATABASE_URL`/`NODE_ENV` set before launch — same
playbook as every prior session that's needed this) so data-dependent pages
(`/bloom`, the quiz) would actually render instead of showing "Failed to load
coffees." Confirmed via real
browser automation: Home (16/16 images load, both videos 200 with correct
`video/mp4` content-type), About (images + TasteFinderSection's pattern backgrounds),
The Bloom (archetype images load against real fetched data), the quiz's opening
screen. `NewsletterModal.tsx`/`PreLaunch.tsx` were code-reviewed but not individually
browser-triggered locally — same proven single-image-swap pattern as everything else.

**Post-deploy, on the actual live production site** (`www.axisandbloomcoffee.com` —
corrected mid-session; prior memory had the wrong domain, `axisandbloom.com`, which
404s):
- Pre-launch page (what ad traffic hits pre-Sept-1): its one image loads from
  `optimized/lifestyle/coffee-15-vertical.webp`.
- Full site (via the `?preview=true` bypass): 17/17 images load, both hero/placeholder
  videos resolve from the bucket, zero broken.

Committed `6d83dc5`, pushed cleanly (no divergence from origin at push time). GitHub
Actions Deploy #512 succeeded (3m45s) — took unusually long to leave the "Queued"
state (~10+ minutes) compared to every other run this session, cause not
investigated (not blocking, resolved on its own).

Not migrated, deliberately: `AxisMap.tsx`'s `GENERIC_bag_front_v3_your_archetype.png`
import — small (0.08MB), no weight case, and not one of the spec's named files.

### Docs

`WHAT_WE_BUILT.md` #106, `SOMMELIER_BUILT.md` S55 (no Liam impact — none of the
touched files are on any Sommelier/Liam code path). No `WHAT_WE_BUILT_DB.md` update —
this migration touched zero SQL schema.
