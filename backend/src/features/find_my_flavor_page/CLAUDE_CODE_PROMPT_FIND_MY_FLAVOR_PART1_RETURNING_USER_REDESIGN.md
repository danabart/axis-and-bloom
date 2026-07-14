# Find My Flavor — Part 1: returning-user screen redesign

**Prerequisite: `backend/src/features/the_bloom_page/CLAUDE_CODE_PROMPT_THE_BLOOM_PART10_ARCHETYPE_SECTION_REUSE_PREP.md` must be done first.** That file extracts `ArchetypeSection` into `frontend/src/app/components/bloom/ArchetypeSection.tsx` (exported, with a `showPhoto` prop) and lifts the cart into a shared `CartContext` wrapping `/bloom` and `/find-my-flavor`. This file assumes both exist and consumes them — it does not re-derive or duplicate that work.

This is a new feature folder. The older `backend/src/features/the_bloom_page/CLAUDE_CODE_PROMPT_THE_BLOOM_PART5_REUSE_ON_QUIZ.md` originally scoped reuse-on-Find-My-Flavor work as part of The Bloom's own docs; going forward, anything that changes `FlavorQuiz.tsx` or otherwise touches the Find My Flavor page specifically (this returning-user screen, the just-finished-quiz curtain/reveal screen, any future feedback-prompt work) belongs here instead, not in `the_bloom_page/`.

## Scope of this part

Redesign only **State 1 ("Returning user")** of `frontend/src/app/components/FlavorQuiz.tsx` — the screen a signed-in user with an existing archetype sees at `/find-my-flavor` (roughly lines 708–808 today: `if (!isPreview && user && !hasStarted && (profileLoading || userProfile?.archetype))`). States 2–4 (no archetype yet / guest / quiz in progress) are untouched.

Today that screen is a fixed hero photo (`https://i.imgur.com/3NAnXgR.jpeg`) on the left with a dark overlay and a vertical nav list overlaid on it (Retake the quiz / Talk to our coffee sommelier / View my profile / Explore flavor intelligence), and plain cream background on the right showing "Your primary profile is {Archetype}" + description + last quiz date.

---

## Phase 1 — Embed `ArchetypeSection`, redesigned layout

**Remove the hero background photo entirely** (`https://i.imgur.com/3NAnXgR.jpeg` and its dark overlay div). Replace the current `flex-col lg:flex-row` "photo half / text half" structure with:

- **Left column** (top to bottom):
  1. The existing archetype-match content, unchanged: "Your coffee profile" label → "Your primary profile is" → archetype name (large, `archetypeColor`) → description → "Last quiz taken" + date.
  2. Directly beneath it, the embedded `<ArchetypeSection />` for the user's single matched archetype (default `showPhoto`, i.e. photo column present — see reasoning below) — fetch `GET /api/coffees/archetypes` (same call `BloomPage.tsx` makes) and pass only the entry where `archetype === existingArchetype.id`. Wire it with the same handler shapes `BloomPage.tsx` uses (`selectedSortOrder` for this one archetype, a `revealedKeys` set, dial ref, `handleDialSelect`, `toggleReveal`, `handleHopClick`, `openCompare`), and `useCart()` (from the prerequisite's `CartContext`) for add-to-cart — don't invent a second local cart.
- **Right column**: the nav list (see Phase 2 below). Because the left column is now much taller (it includes the full `ArchetypeSection`), do **not** vertically center the right column the way the old photo panel did — make it a top-aligned block, and on `lg+` give it `position: sticky` (offset below the site nav bar) so the options stay visible while the left column scrolls. Restyle the nav list from "white text over photo" to the page's normal dark-on-cream link styling (matches the right column's existing `font-light`, `#a33726`-family palette) since there's no photo behind it anymore; keep the `ArrowRight` hover-slide affordance.
- Keep the existing `motion.div` fade-in treatment for both columns.
- Render `CompareOverlay` (from `bloom/CompareOverlay.tsx`) on this screen too, since `ArchetypeSection`'s Compare button expects it — same usage pattern as `BloomPage.tsx`.

**Why `showPhoto` stays at its default (`true`) here, not `false`:** Dana's reference screenshot for this task shows the photo column present in the reused section. (This differs from the curtain/reveal screen mentioned below, which is out of scope for this part — that screen already shows a bag image elsewhere, so a future part embedding `ArchetypeSection` there would likely want `showPhoto={false}` to avoid redundancy. Not this one.)

## Phase 2 — Nav list: move to the right column, add "Create a household party"

Existing items, unchanged targets/behavior, just restyled and repositioned:
- Retake the quiz (action → pre-fills name, starts quiz)
- Talk to our coffee sommelier → `/sommelier?entry=user_initiated`
- View my profile → `/profile`
- Explore flavor intelligence → `/flavor-intelligence`

**New item to add:**
- **Create a household party** → `/profile?tab=family`

This should open the existing household-creation flow (`FamilyTab.tsx`, rendered by `Profile.tsx`'s `family` tab — backend already supports this via `/api/household/*`, see `WHAT_WE_BUILT.md`). Today `Profile.tsx` initializes `activeTab` with a bare `useState<Tab>('memory')` and ignores the URL, so `?tab=family` currently does nothing. Add `useSearchParams` (from `react-router`, already used elsewhere in this codebase) to `Profile.tsx` and initialize `activeTab` from the `tab` query param when it's a valid `Tab` value (`memory | orders | settings | family`), falling back to `'memory'` otherwise. Don't change any other tab behavior.

## Explicitly out of scope for this part

- The just-finished-quiz curtain/reveal screen (Part 5's old Phase C2) — its hardcoded `BloomDial`/`BODY_LEVELS` mock stays as-is. If/when Dana asks for that, it becomes Find My Flavor Part 2, in this same folder.
- Any order-scoped feedback prompt (Part 5's old Phase E).
- Any change to `RevealedPanel.tsx`, `PositionCard.tsx`, `BloomDialWidget.tsx`, `CompareOverlay.tsx`, `usePositionCardData.ts`, or `ArchetypeSection.tsx` itself — those are `the_bloom_page`'s territory; this page only consumes them.
- Quiz States 2–4 in `FlavorQuiz.tsx`.

## Testing task

1. **Shared cart, first real cross-page test**: add an item on `/find-my-flavor`, navigate to `/bloom`, confirm it's still in the cart and vice versa; floating cart count is consistent and updates live on both pages; checkout works from either page regardless of where items were added.
2. **Returning-user screen layout**: no photo panel; left column shows profile text then the embedded section (photo/dial/card/reveal all present and functional — dial selection, reveal toggle, add to cart, compare, hop links); right column nav is repositioned, restyled, top-aligned (sticky on `lg+`), and includes all five items.
3. **Household party link**: from `/find-my-flavor`, click "Create a household party" → lands on `/profile` with the Family tab already active. Confirm the other three `Profile.tsx` tabs still work normally when reached without a `tab` param (defaults to Memory) or via direct links elsewhere in the app.
4. **Explore-flavor-intelligence link**: confirm it's present and correctly targeted inside the embedded section (via `TastingNotes`' `exploreLink`), same as on `/bloom`.

## Summary checklist

- [ ] `the_bloom_page` Part 6 (extraction + `CartContext`) confirmed done before starting this
- [ ] Returning-user screen: hero photo removed; left column = profile text + embedded `ArchetypeSection`; right column = restyled, top-aligned/sticky nav list
- [ ] "Create a household party" added to the nav list → `/profile?tab=family`
- [ ] `Profile.tsx` reads `?tab=` to initialize `activeTab`
- [ ] Testing task completed
