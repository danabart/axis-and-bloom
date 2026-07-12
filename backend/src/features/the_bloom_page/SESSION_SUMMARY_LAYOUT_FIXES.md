# The Bloom — session summary: archetype row layout fixes (2026-07-12)

Handoff note for the next Claude Code session. This documents what happened in the conversation that produced commits `f88b407` → `bd494c1` (revert) → `f97c43f` on `main`, so a fresh session has the context without re-deriving it.

## What this session did, in order

1. **Two-row redesign (rejected, then reverted).** Dana asked for the three-column archetype row (photo | dial | card) to become two rows — identity row (photo/dial/heading) on top, full-width details row (card + reveal panel) below — to fix a perceived dead-space gap. This was implemented, tested (desktop, mobile, both flip orientations, reveal state), documented as `WHAT_WE_BUILT.md` #86, committed (`f88b407`) and pushed.
   - **Dana's verdict: "this looks very bad."** She asked to revert and said she'd hand it to her coworker instead.
   - Reverted cleanly with `git revert --no-edit f88b407` → commit `bd494c1`, pushed. This undid both the `BloomPage.tsx` change and the `WHAT_WE_BUILT.md` #86 entry, restoring the pre-existing three-column layout (the one from Part 4).
   - **Do not re-attempt the two-row restructure** unless explicitly asked again — it was tried and explicitly rejected on visual grounds.

2. **Part 6 — row balance fix (kept, current state).** The coworker (or Dana) dropped a new spec in this folder: `CLAUDE_CODE_PROMPT_THE_BLOOM_PART6_ROW_BALANCE.md`. This is a *different, narrower* fix than the rejected two-row redesign — it keeps the original three-column layout entirely intact and only fixes a height mismatch between the three columns.
   - **Diagnosis**: the photo column (hero photo + two small photos stacked) rendered taller than the dial and card columns, leaving them looking small/stranded, and — since `RevealedPanel` renders full-width *after* the row closes (a Part 4 change) — created a large empty gap before the reveal panel appeared.
   - **Fix applied** in `BloomPage.tsx`'s `ArchetypeSection` (photo column, currently around lines 94–116):
     - Narrowed the photo column: `md:basis-[34%]` → `md:basis-[27%]`.
     - Replaced `aspectRatio` + `maxHeight` sizing with **explicit `height`** on the hero (`height: 320`) and both small photos (`height: 155` each), still with `objectFit: 'cover'` so they crop rather than distort.
       - **Why explicit height, not `maxHeight`**: at this column's width, the aspect-ratio-derived natural height was already *below* the dial column's height, so a `maxHeight` cap never engaged (it only clamps if natural height would exceed it). The fix needed a floor/fixed value, not a ceiling.
       - The 320/155 split was reverse-engineered by measuring the dial column's actual rendered height (~482px, driven by Part 4's wheel `clamp(130px,14vw,190px)` + bag `maxHeight:160`) and sizing the photo column to match it — per the spec's explicit instruction to treat the dial column as the fixed target, not to touch the dial/card columns themselves.
     - Removed `md:sticky md:top-[100px]` from the photo column — confirmed with Dana it wasn't intentional or load-bearing.
   - **Verified** against production Cloud SQL: photo/dial column bottom edges now land within ~2px of each other, confirmed across both flip orientations (`fruity`, `balanced_sweet`) and 4 other archetypes (crop quality checked — no important content cut off); `RevealedPanel` now sits with exactly zero gap after the row; mobile (390px viewport) stacking confirmed unchanged, zero horizontal overflow, zero console errors.
   - Documented as `WHAT_WE_BUILT.md` **#86** (renumbered — the earlier #86 from the reverted redesign no longer exists). Committed as `f97c43f`, rebased past 4 of Camila's unrelated `Home.tsx`/`Navigation.tsx`/`TasteFinderSection.tsx` commits, pushed as `6abd66e`.

## Current state of `BloomPage.tsx`

Three-column row (`photo md:basis-[27%]` | `dial md:basis-[26%]` | `card md:flex-1`), heights balanced, no sticky. `PositionCard` (collapsed header + commerce) lives in the card column with the archetype `<h2>` heading above it; `RevealedPanel` (full profile: notes, Liam's intake, dimension bars, flavor wheel, hop links) renders as a full-width sibling directly after the row closes — this full-width-panel-after-the-row structure is a **Part 4** change and was not touched this session.

`ArchetypeSection` is a single reusable component defined once in `BloomPage.tsx`, rendered via one `.map()` over all 6 archetypes — there is no per-archetype duplication anywhere in this file.

## Standing rules for Bloom work (established across this and prior sessions)

- **Never commit or push** any `CLAUDE_CODE_PROMPT_THE_BLOOM*.md` file in this folder, or `Capture.JPG` — these are the coworker's in-progress planning docs. Always `git add` only the specific source/doc files actually changed, never a broad `git add .` in this repo.
- **Never touch `CAMILAS_UPDATES.md`.**
- **Always update `WHAT_WE_BUILT.md`** with a new numbered entry for any Bloom change (context / fix / verification, matching the existing entries' style). Update `WHAT_WE_BUILT_DB.md` too, but only if there's an actual schema change — pure layout/frontend fixes don't need it.
- **Git push workflow**: `git fetch origin` → `git log --oneline main..origin/main` to check for new commits → if there are any, `git diff <old>..<new> --stat` to confirm no file overlap with your own changes → if the coworker's Bloom docs are locally modified (not just untracked), `git stash push -- <path>` them before rebasing → `git rebase origin/main` → push → `git stash pop` to restore the coworker's uncommitted doc edits to the working directory (never commit them).
- **Part 5** (`CLAUDE_CODE_PROMPT_THE_BLOOM_PART5_REUSE_ON_QUIZ.md`, reusing the archetype section on Find My Flavor) is explicitly on hold — do not start it without Dana asking directly.
- Other untracked files may appear in this repo between sessions that aren't yours (e.g. `backend/src/features/bloom_dial/Capture2.JPG`, `backend/src/features/image_pipeline/` were seen this session, origin unknown) — leave them alone unless told otherwise.

## Local testing pattern (Cloud SQL + Playwright)

See memory `axis-and-bloom-local-cloudsql-testing` for the full Auth Proxy setup (service account key BOM-stripping, port 5433, etc.). Two things worth knowing fresh:
- The site shows a newsletter modal (`NewsletterModal.tsx`) after a 4-second delay, once per `sessionStorage` key `axisBloomNewsletterSeen`. In Playwright scripts, set it before navigating to avoid it blocking clicks/screenshots: `await page.addInitScript(() => sessionStorage.setItem('axisBloomNewsletterSeen', '1'))`.
- Always clean up afterward: stop the Auth Proxy, backend, and frontend dev server processes, delete the temp BOM-stripped service account key, delete scratch Playwright scripts.
