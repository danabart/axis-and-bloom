# Find My Flavor — Part 3: confirm Part 2 status, fix stale-profile compatibility badge, diagnose missing bag

**Component reuse — same hard requirement as Part 2, still applies.** Nothing in this part should reimplement dial, card, reveal, or cart logic locally. Every fix below is either "make sure the existing `ArchetypeSection`/shared-component wiring actually landed" or "fix a data-freshness bug in how this page feeds those existing components" — not new UI.

## Task 0 — Confirm whether Part 2 actually shipped, before doing anything else

Dana ran through the quiz again on 2026-07-17 expecting Part 2's fixes (`CLAUDE_CODE_PROMPT_FIND_MY_FLAVOR_PART2_RESULTS_SCREEN_REVEAL_AND_CTAS.md`, same folder) to be live. A fresh read of `frontend/src/app/components/FlavorQuiz.tsx` pulled directly from the project folder that day showed the just-finished-quiz results screen (the `isComplete` state — base layer, curtain layer, and the `archetypeKey === 'chocolate'` special-cased `BloomDial` mock) as **byte-for-byte identical** to the pre-Part-2 version: no `backgroundColor` fallback on the non-chocolate curtain, no `ArchetypeSection` embedded, no wallpaper preload. Dana separately reported the curtain-timing symptom seemed fixed — that's most likely her browser having the wallpaper image cached from repeated testing, not an actual code fix, since the race-condition code is still there as written.

**Before starting Tasks 1-3 below: check git history / your own prior session logs for whether Part 2 was actually run.**
- If it was run but something caused it not to land (bad merge, uncommitted, reverted, etc.) — figure out why and land it properly.
- If it was never run — **implement Part 2 in full now**, exactly as specified in that file, as a prerequisite for the rest of this part (Task 2 below touches the same returning-user data-fetching code Part 2's results-screen work is adjacent to, so do this first to avoid conflicting edits).

Don't skip this check and assume Part 2 is done because Dana initially thought the timing bug was fixed — verify against the actual current code, the same way you'd verify any other "is this already done" question on this project.

## Task 1 — [background, already fixed once relevant] curtain-covers-late bug

Covered by Part 2 (Task 0 above should have brought this in). No new work here beyond what Part 2 already specifies — just confirming it's actually applied as part of Task 0.

## Task 2 — Compatibility badge shows "Worth exploring" on the user's own exact match (returning-user screen)

**This bug is on the *returning-user* screen (State 1, shipped in Part 1 — `if (!isPreview && user && !hasStarted && (profileLoading || userProfile?.archetype))`), not the results screen.** That screen already embeds the real `ArchetypeSection`/`PositionCard`/`RevealedPanel` stack (Part 1), which is why the compatibility badge (`CompatibilityBadge`, `useCompatibility.tsx`) shows up there at all.

**Reported:** Dana retook the quiz and matched **Balanced & Sweet**. Landing back on the returning-user screen, the archetype section shown is correctly labeled Balanced & Sweet — but its own compatibility badge read **"Worth exploring"** instead of **"In your wheelhouse."** Since this section is rendering the user's own matched archetype against itself, it should always read "In your wheelhouse."

**Root cause, found in code:**

`FlavorQuiz.tsx` fetches the signed-in user's profile in a `useEffect` keyed only on `[user]` (~line 557-571):
```tsx
useEffect(() => {
  if (!user) return;
  setProfileLoading(true);
  getUserProfile()
    .then(p => { setUserProfile(p); ... })
    ...
}, [user]);
```
`matchedArchetypeId` (~line 582) is derived from this `userProfile` state, and gets passed to `ArchetypeSection` as `userArchetype={matchedArchetypeId}` (~line 892), which flows into `useCompatibility(coffeeArchetype, userArchetype, ...)`.

This effect only re-runs when the `user` object reference changes (sign-in/out), **never after a same-session quiz retake**. `handleNext`/`handleBranchContinue`'s `saveQuizResult(...)` call (~line 705, 726) is fire-and-forget (`.catch(console.error)`, no follow-up refetch). So after Dana retook the quiz, `userProfile`/`matchedArchetypeId` in this component's state kept whatever archetype was fetched *before* the retake (in her case, Floral — her previous match) — while the returning-user screen itself re-renders showing the *new* archetype (Balanced & Sweet) because `matchedData` is derived from `archetypesList` + `matchedArchetypeId`... 

**wait — trace this carefully, don't assume**: if `matchedArchetypeId` is genuinely stale, `matchedData` (~line 583-585, `archetypesList.find(a => a.archetype === matchedArchetypeId)`) would resolve to the *stale* archetype's data too, meaning the whole section should have shown Floral, not Balanced & Sweet. Since Dana saw the section correctly labeled Balanced & Sweet, either (a) something else refreshes `userProfile`/`matchedArchetypeId` correctly for the *section's own* data but a *different* stale value specifically leaks into the `userArchetype` prop passed for compatibility purposes, or (b) the profile fetch did complete with the fresh archetype, and the actual bug is upstream of this component — e.g. `GET /api/users/profile` itself returning a stale/cached archetype server-side, or a caching layer, or a genuine race between `saveQuizResult`'s write and this screen's read. **Confirm which of these it actually is by reproducing in a real browser with logging/breakpoints before fixing** — don't patch based on the theory alone. (The theory is well-supported circumstantially — the one authored archetype-adjacency pair in the whole system is `balanced_sweet ↔ floral`, exactly the pair Dana's stale-vs-fresh archetypes would produce, per `WHAT_WE_BUILT.md` — but "well-supported circumstantially" still needs a real repro before you change code.)

**Fix, once root cause is confirmed:** ensure the returning-user screen's profile data (and specifically whatever value feeds `userArchetype`) reflects the just-saved quiz result, not a fetch from before it. The simplest correct fix is likely to refetch `userProfile` (or otherwise refresh `matchedArchetypeId`) right after `saveQuizResult()` resolves successfully, not just once per `user`. Don't work around this by passing `archetypeKey`/`score.archetype` directly as a shortcut on this specific screen — the returning-user screen is reachable independently of a same-session quiz completion (e.g. a user signing in fresh with an already-existing profile), so it must keep sourcing from the real profile fetch; it just needs that fetch to be fresh.

## Task 3 — Missing bag image, same returning-user screen, Balanced & Sweet

**Reported:** on the same returning-user screen/session as Task 2, the bag image was missing (blank space where it should render).

**Do not assume this needs a code fix yet.** The bag-rendering code (`ArchetypeSection`'s `<img src={visual.bag}>`, unconditional on `showPhoto`) and its data source (`bloomVisuals.ts`'s `ARCHETYPE_VISUALS.balanced_sweet.bag` → `bagBalanced` → `design/IMAGES/bags/new bags mock up/BALANCED & SWEET transp.png`) are unchanged from when this same archetype presumably rendered correctly elsewhere (e.g. on `/bloom`), and the asset file exists on disk at a normal size (~1.2MB, not zero/corrupted).

**Reproduce first:**
1. Load `/bloom` and confirm the Balanced & Sweet bag renders correctly there (isolates whether this is archetype-specific-asset vs. page-specific).
2. Load the returning-user screen at `/find-my-flavor` with a Balanced & Sweet profile and check the browser Network tab for that specific image request — 404, slow load, CORS, or client-side error swallowed silently?
3. Check the Console for any error tied to this render.

If it reproduces as a genuine bug, fix it and document the actual cause (don't guess a fix for a problem you haven't isolated). If it does *not* reproduce (e.g. it was a one-off slow load), say so explicitly rather than silently closing it — Dana should know whether this needs continued attention or was transient.

## Explicitly out of scope for this part

- Same exclusions as Parts 1 and 2: `RevealedPanel.tsx`, `PositionCard.tsx`, `BloomDialWidget.tsx`, `CompareOverlay.tsx`, `usePositionCardData.ts`, `ArchetypeSection.tsx`, `useCompatibility.tsx`, `archetypeAdjacency.ts` themselves — read them all you need to for diagnosis, but changes to them are out of scope unless the repro work in Task 2/3 proves the bug is actually inside one of them (in which case, stop and flag it rather than editing silently, since that would be a first for this convention on this project).
- Populating more `dial_coffee_relationships` bridge hops so more archetype pairs have real adjacency data — that's a content/admin task (already logged in `WHAT_WE_BUILT.md`'s follow-ups list), not a code fix.

## Testing task

1. **Task 0**: confirm Part 2's actual state in the deployed/current code before starting; land it if missing.
2. **Task 2 repro**: sign in as a test user with an existing archetype, retake the quiz to a *different* archetype (ideally Balanced & Sweet ↔ Floral specifically, to match Dana's exact repro), return to the returning-user screen, confirm the compatibility badge reads "In your wheelhouse" for the freshly-matched archetype's own section.
3. **Task 2 regression check**: confirm a genuinely adjacent-but-different archetype still correctly shows "Worth exploring" elsewhere (e.g. on `/bloom`, viewing Floral while your matched archetype is Balanced & Sweet) — don't fix Task 2 by breaking real adjacency detection.
4. **Task 3**: follow the reproduction steps above; report findings either way (fixed, or confirmed non-issue).

## Summary checklist

- [ ] Confirmed (not assumed) whether Part 2 shipped; landed it if not
- [ ] Root cause of the stale compatibility badge confirmed via real repro, not just theory
- [ ] Profile/archetype data feeding the returning-user screen refreshes after a same-session quiz save
- [ ] Regression-checked that real adjacency ("Worth exploring" for an actually-adjacent archetype) still works
- [ ] Missing bag image reproduced and either fixed (with real cause documented) or confirmed non-reproducible
- [ ] `WHAT_WE_BUILT.md` entry added covering what was actually found/changed in this part
