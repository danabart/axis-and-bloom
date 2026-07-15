# The Axis Page V2 — Session History

**Date:** 2026-07-14 to 2026-07-15
**Scope:** Full redesign of the public `/the-axis` page, six rounds of review-driven refinement, recovery of the original page for reference, and deployment to production.

This file is a chronological record of the session for anyone picking this work back up later. For the authoritative build log, see `WHAT_WE_BUILT.md` #59 (and its follow-ups) in the repo root. For the full spec each round executed against, see the individual `CLAUDE_CODE_PROMPT_THE_AXIS_V2*.md` files in this folder — each carries its own checklist and an "implemented and verified" note.

---

## 1. Kickoff and discovery

Dana asked for a redesign of The Axis page, with git and GCP connectivity confirmed first (branch `main`, gcloud project `axis-and-bloom-prod`). On inspection, the groundwork for the redesign already existed in this folder, fully spec'd and "decisions locked with Dana":

- `THE_AXIS_REDESIGN_STRATEGY.md` — the strategic shift from "Black Box Transparency" (asserting a finished matching engine) to "Watch the data work" (showing a living data system across five lifecycle stages), including the competitive-safety tiers that governed every round after this.
- `THE_AXIS_PAGE_COPY_V2.md` — the verbatim copy for the new page.
- `CLAUDE_CODE_PROMPT_THE_AXIS_V2.md` — the build spec.
- V1's docs (`THE_AXIS_PAGE_COPY.md`, `THE_AXIS_PAGE_PROMPT.md`) were marked retired in place.

Scope was explicitly narrowed to this folder's work only — other concurrent activity in the repo (a homepage rebuild, sommelier doc updates, misc uncommitted files) was left untouched throughout.

## 2. Base V2 build

Executed `CLAUDE_CODE_PROMPT_THE_AXIS_V2.md`:

- `frontend/src/app/components/TheAxis.tsx` — full rewrite, 7 sections (Hero, Capture, Structure, Connect, Consume, Refine, CTA), copy verbatim from the V2 doc.
- `frontend/src/app/components/axis/AxisMap.tsx` (new) — single scrollytelling SVG map, states 0–5.
- `backend/src/routes/axis.ts` — added `GET /stats` to the *existing* router (not a new file, to avoid a second router colliding on the same `/api/axis` mount — a deviation from the prompt's literal suggestion, done for a concrete technical reason).
- `frontend/src/styles/theme.css` — new archetype color tokens (provisional at this point).

Verified against real production Cloud SQL via the Auth Proxy — `/api/axis/stats` returned correct live aggregate data (29 coffees mapped, matching the known catalogue size). Frontend build clean. Competitive-safety grep clean. Not opened in an actual browser this session (no headless-browser tool available in this environment) — flagged to Dana explicitly, repeatedly, as the one verification gap throughout.

## 3. Six rounds of refinement

Each round was driven by a `CLAUDE_CODE_PROMPT_THE_AXIS_V2_REFINEMENTS[_Rn].md` file that Dana wrote after reviewing the live-in-browser result, which this session could not see directly.

- **Round 1** (`_REFINEMENTS.md`): archetype labels visible from the Hero (not just from Structure on); literal Capture streams (field stream with origin-vocabulary fragments, measurement stream with neutral ticks); dot-count clamping left unchanged (Dana's explicit decision, no code change); new map state 6 ("Handoff") wired to the CTA only, gated so its animation plays once, on arrival.
- **Round 2** (`_R2.md`): the big structural change — states 0–1 became **geography** (neutral dots grouped by world sourcing region, no archetypes yet) and state 2 became the **migration** into flavor space (the page's signature moment: "origin is where the data starts; flavor is where it lives"). Also fixed the Handoff's first composition (was overlapping a region label) and aligned archetype colors with `Home.tsx`.
- **Round 3** (`_R3.md`): replaced the geography circles with a hand-simplified world-map silhouette (new `worldOutline.ts` — seeded smooth blobs, explicitly *not* real coastline data, per the prompt's own "pattern, not an atlas" allowance); bolder Capture streams; bigger Handoff bag using the real `GENERIC_bag_front_v3_your_archetype.png` asset (the actual bag label box position was read by opening the image directly, not guessed).
- **Round 4** (`_R4.md`): two real rendering bugs Dana caught from the live page. (1) The Hero map sat too high/cramped — root cause was that *every* `AxisMap` instance always carried the tall handoff-band viewBox even when it never showed state 6; fixed to be stage-dependent. (2) The bag image was blurry — moved out of the SVG (`<image>`) into a plain HTML `<img>` overlay, percentage-positioned to track the map, since SVG-scaled raster images don't rasterize crisply.
- **Round 5** (`_R5.md`): removed the persistent round swatch on the bag (read as a stray dot overlapping the art) in favor of a thin archetype-colored underline that draws in beneath "Your Archetype." Also tried fully detaching the Capture words from the streams into 8 fixed "ambient" slots spread across the canvas.
- **Round 6** (`_R6.md`): reverted round 5's word placement — Dana found the fully-detached words read as unrelated to anything. Words went back onto the streams, anchored to the first ~40% of each path (never near the merge point), with a new cross-archetype vocabulary list (17 words spanning all five archetypes, flavor:process roughly 2:1). Both rounds 5 and 6 used the same technique to cap concurrent visible words deterministically: non-overlapping timing "waves," not just tuned/approximate stagger.

Every round: rebuilt, competitive-safety-grepped (no numbers, dimension names, table/column names, real coffee or roastery names — checked explicitly each time), dev server re-verified serving `/the-axis` and `/api/axis/stats`. None were opened in an actual browser by this session at any point — every round's "not verified" note said so plainly, and Dana's own screenshots/live review were what actually drove each subsequent round's fixes.

## 4. Recovering the original page

Before committing, Dana asked to recover the pre-V2 page from git history and keep it unrouted, so the original design stays browsable in the repo. `git show HEAD:frontend/src/app/components/TheAxis.tsx` (HEAD still had the original since nothing had been committed yet) was saved as `frontend/src/app/components/TheAxisV1.tsx`, with its internal function renamed `TheAxisV1` for clarity (default export, so nothing was broken — the file isn't imported or routed anywhere). Confirmed intact via a diff spot-check and structural markers (`MiniRadar`, `ConceptChart`, `SplitVisual`, `FeedbackLoop` all present).

## 5. Commit and push

Committed only the Axis-scoped files, explicitly excluding unrelated concurrent changes sitting in the working tree at the time (an unreviewed staged edit to `SOMMELIER_BUILT.md` from other work, plus a few untracked files unrelated to this task) — done via precise `git add`/`git commit` pathspecs rather than a blanket `-a` or `add -A`, and the unrelated staged file's index state was restored exactly as found afterward.

- `6a333ae` — base V2 build + all 6 refinement rounds + `TheAxisV1.tsx` recovery. Pushed to `origin/main`. GitHub Actions `Deploy` workflow succeeded; verified live via the deployed JS bundle (checked for round-specific strings like `AFRICA & ARABIA`, `honey process`, the bag asset filename) since the raw pre-render HTML can't show client-rendered content.
- A follow-up custom-domain issue was noted (`axisandbloom.com` 404ing site-wide, including root `/`) — flagged as pre-existing/unrelated infrastructure, not caused by this deploy; the Firebase default URL (`axis-and-bloom-prod.web.app`) was fully live and correct throughout.

## 6. Post-deploy fix: CTA microcopy

Dana asked to remove "Then come back and watch the map move" from the CTA. `THE_AXIS_PAGE_COPY_V2.md` already carried Dana's own rationale for this exact removal (added directly by her, found already in place: the line implied the quiz moves the map, which it doesn't) — the code just needed to catch up to the doc. Also backfilled a `WHAT_WE_BUILT.md` follow-up rolling up rounds 2–6 (which had been fully documented in their own files but not yet summarized in the main build log).

- `925f286` — the microcopy fix, rebased cleanly on top of four unrelated homepage-rebuild commits that had landed on `origin/main` in the meantime.
- **Deploy race condition**: pushing 925f286 triggered a Deploy run that *succeeded*, but a concurrent Deploy run for the older homepage commit finished ~24 seconds later and overwrote Firebase Hosting with a build that predated the microcopy fix — even though both GitHub Actions runs showed green. Caught by directly diffing the live JS bundle content (not just checking workflow status), confirmed via each run's `updated_at` timestamp, and fixed by re-running the 925f286 Deploy job via the GitHub API so it would be the one to land last. Re-verified against the live bundle afterward (new hash, old line gone, new microcopy present) — confirmed fixed.

## Key takeaway for next time

Two things worth remembering if this page gets touched again:
1. **No headless-browser tool was available in this environment for the entire session.** Every visual judgment call came from Dana's own screenshots/live review, not from this session seeing the page render. If that tooling becomes available, a real visual pass over `/the-axis` (especially the Capture word placement, Handoff sequence, and mobile layout) would be worth doing.
2. **Concurrent deploys can race on Firebase Hosting.** If another push lands around the same time as one from this page, don't trust a green GitHub Actions checkmark alone — diff the live JS bundle content directly, and re-run whichever deploy should legitimately be "last" if an older one wins the race.
