# Profile Page Part 1 — Full-width layout redesign + real ArchetypeSection in Flavor Memory

**Date:** 2026-07-17
**Scope:** `frontend/src/app/components/Profile.tsx`, plus one small, precisely-bounded addition to `frontend/src/app/components/FlavorQuiz.tsx` (the `?retake=1` param, below). All shared components are **consumed, never edited**.

---

## Why this exists

The Profile page (`/profile`) has two problems Dana wants fixed in one pass:

1. **The Flavor Memory tab doesn't show "the archetype box."** Today it renders only a text heading ("Your Archetype: {name}"), a plain feature list, and a Talk-to-Liam link. Every other surface where a user meets their match — `/bloom`, the Find My Flavor returning-user screen, and the just-finished-quiz results screen (Find My Flavor Part 2, executed 2026-07-16) — renders the full shared `ArchetypeSection` (archetype photos, Bloom Dial, bag, position card with add-to-cart, expandable RevealedPanel). Profile is now the only signed-in surface that still shows the old text-only presentation.

2. **The page layout wastes half the screen.** The whole page is a 50/50 split: the left half is a static stock photo (a generic Unsplash URL, not a brand asset), and all four tabs squeeze into a `max-w-[480px]` column on the right, inside an `h-screen overflow-hidden` shell with its own internal scroll. The 480px column physically cannot host `ArchetypeSection` (a three-column row + full-width reveal panel), so the layout change is a prerequisite for the component change, not a separate nicety.

---

## Hard requirement: reuse, don't reimplement

This build **must consume the existing shared components** — the exact same stack `/bloom` (`BloomPage.tsx`) and `/find-my-flavor` (`FlavorQuiz.tsx`, both its screens) already use:

- `ArchetypeSection` + `computeDefaultSortOrder` from `frontend/src/app/components/bloom/ArchetypeSection.tsx`
- `CompareOverlay` from `frontend/src/app/components/bloom/CompareOverlay.tsx`
- `useCart` from `frontend/src/app/context/CartContext.tsx`
- Types (`ArchetypeData`, `Slot`, `slotKey`) from `frontend/src/app/components/bloom/types.ts`
- `BloomDialHandle` type from `frontend/src/app/components/BloomDialWidget.tsx`

Do **not** build any local dial, card, reveal panel, or cart UI in `Profile.tsx`. Do **not** edit `ArchetypeSection.tsx`, `PositionCard.tsx`, `RevealedPanel.tsx`, `BloomDialWidget.tsx`, `CompareOverlay.tsx`, or `CartContext.tsx`. (This codebase already had this go wrong once — `FlavorQuiz.tsx` used to carry a local `BloomDial` mock, retired in Find My Flavor Part 2.) If `ArchetypeSection` doesn't quite fit the Profile context somewhere, adapt how Profile uses it (wrapper layout, props) or stop and flag the mismatch — do not fork it.

**The reference implementation to copy is `FlavorQuiz.tsx`'s returning-user screen wiring** (its "Matched" state cluster, roughly lines 270–402 as of this writing). It demonstrates the complete pattern:

- Fetch `GET /api/coffees/archetypes` → `ArchetypeData[]` (and see the Experimental note below)
- Resolve the user's match: `profile?.archetype?.id` is the `archetype_enum` (Profile.tsx already loads this via `getUserProfile()` — same API `FlavorQuiz.tsx` uses for exactly this purpose, so the id is confirmed present)
- `matchedData = archetypesList.find(a => a.archetype === matchedArchetypeId) ?? null`
- Dial position persistence: on mount, `getDialPosition(archetype)` pre-sets the dial to the user's saved position; `onDialSelect` calls `setDialPosition(archetype, sortOrder)` (user is always signed in on this page — no guest gating needed here, unlike FlavorQuiz)
- `selectedSortOrder={savedSortOrder ?? computeDefaultSortOrder(matchedData)}`
- Local state: `sortOrder`, `revealedKeys: Set<string>`, a `dialRef` (`BloomDialHandle`), and `compareState` — mirror the FlavorQuiz shapes
- `onHopClick`: `dialRef.current?.rotateTo(dialSortOrder)` + add the hopped slot's key to `revealedKeys` (see `handleMatchedHopClick`)
- `onAddToCart={addToCart}` from `useCart()` — **no cart UI needed in Profile.tsx at all**: `CartProvider` wraps the whole app (`App.tsx`) and `FloatingCart` is already mounted in `PublicLayout.tsx`, which wraps `/profile`
- `userArchetype={matchedArchetypeId}` (feeds RevealedPanel's compatibility handling)
- `<CompareOverlay open={...} left={...} archetypes={archetypesList} />` after the section

**Experimental match:** the quiz can score a user into `experimental`, which `GET /api/coffees/archetypes` deliberately excludes (it's a category, not one of the 5 real archetypes). Mirror what FlavorQuiz's *results* screen does: also fetch `GET /api/coffees/experimental` and include it in the match lookup, so an experimental-matched user still gets their box. (Note: FlavorQuiz's returning-user screen does *not* do this — a pre-existing gap in that screen, out of scope here; do not "fix" FlavorQuiz in this task, but mention it in your summary so it's on record.)

---

## The redesigned page

### Shell

Replace the current `h-screen overflow-hidden` two-pane shell with a normal-flow, full-width page (the pattern `FlavorIntelligencePage.tsx` uses): `min-h-screen`, background `#f2f1ea`, top padding that clears the fixed nav (FI uses `pt-32`), content in a centered `max-w-[1400px]` container with `px-8 md:px-16`. The Unsplash photo pane is **removed entirely** — brand imagery returns via `ArchetypeSection`'s own photo column. Normal document flow also means the site footer (from `PublicLayout`) now appears after the page content, which the current `h-screen` shell suppresses — that's desired.

### Header

Keep the existing header content and typographic style, now full-width:
- Eyebrow: `Welcome back, {displayName}` (same uppercase-tracking treatment)
- H1: `Your flavor memory.` when matched / `Trust your taste.` when not — keep the existing brick color `#a33726` and scale

### Tabs

Keep the four tabs (Flavor Memory / Past Orders / Settings / Family), same visual language (uppercase micro-labels, `motion` `layoutId` underline indicator), now spanning under the full-width header. Preserve the existing `?tab=` deep-link initialization exactly (`memory | orders | settings | family`, fallback `memory`).

### Tab content widths

- **Flavor Memory:** full container width — it hosts `ArchetypeSection`.
- **Past Orders, Settings, Family:** these keep their current internals **functionally untouched** (forms, address CRUD, SMS toggle, feedback form, FamilyTab), but move out of the 480px cage into a comfortable reading column (`max-w-xl` or `max-w-2xl` — your judgment) inside the new shell. Do not restructure their logic; this is a container change.

### Flavor Memory tab — lifecycle-driven, not a binary archetype split

Dana's explicit direction (and the established rule from the Flavor Intelligence build): follow the customer lifecycle to decide what this tab shows — map every `user_lifecycle_stage` explicitly, don't collapse to "has archetype / doesn't." The canonical source is `backend/src/features/customer_life_cycle/1_CLAUDE_CODE_PROMPT_CUSTOMER_STATE.md` (§"Use cases") and its implementations: `Home.tsx`'s `renderStageCTA()` and `FlavorIntelligencePage.tsx`'s stage handling.

**Data:** reuse `GET /api/users/homepage-state` (`stageCode`, `archetype`, `pendingFeedback`) — the same endpoint Home and FI already consume. No new backend work. Keep the existing `getUserProfile()` fetch too (features list, other tabs). Do not use `usualBlend` for anything here (unconfirmed roaster-blind — standing caveat from the FI build).

**Stage map** (Profile is signed-in only, so UC0/guest never reaches this page — the `/sign-in` redirect covers it). Adapt copy freely to the page's voice; the *structural* decisions below are the spec:

| Stage | Flavor Memory shows |
|---|---|
| `NEW_NO_QUIZ` | Empty state (existing Heart + "You haven't discovered your flavor archetype yet" + Start the Quiz CTA). No archetype box. |
| `QUIZ_TAKEN_FRESH_NO_ORDER` / `QUIZ_TAKEN_SETTLED_NO_ORDER` | Full archetype layout (below). A single quiet secondary line acknowledging they haven't tried their match yet is fine; the ArchetypeSection's own add-to-cart *is* the shop path — no extra CTA button. |
| `QUIZ_STALE_NO_ORDER` | Full archetype layout. This is the stage the lifecycle doc marks retake-eligible — give the "Retake the quiz" link its stage-specific copy here ("Palates change — retake anytime"); other stages keep the plain, quieter retake link. |
| `FIRST_ORDER_FEEDBACK_PENDING` | Full archetype layout, plus a small feedback nudge above it ("How was {pendingFeedback.blendName}?") that switches to the Past Orders tab (`setActiveTab('orders')`), where the existing `OrderFeedbackForm` already lives — do not mount a second feedback form on this tab. Respect the same dismissal convention FI uses (`localStorage` suppress keyed by orderId). |
| `ACTIVE_REPEAT_USER` / `LAPSED_SINGLE_ORDER` | Full archetype layout, no nudge. Per the lifecycle doc, lapsed re-engagement copy belongs to the homepage — don't duplicate it on an account page. |
| `SUBSCRIBER` / `REORDER_DUE` | Full archetype layout, zero shop/reorder nudge — same deliberate restraint FI adopted (the homepage owns those nudges; duplicating them here is redundant). A one-line subscription status for `SUBSCRIBER` is optional, only if `homepage-state` already exposes what's needed — do not add backend fields for it. |

**Guard:** the archetype box renders off the archetype itself (`profile.archetype` / `homepage-state.archetype`), the stage only picks the accents around it. If a stage implies quiz-taken but archetype resolves null (data drift), fall back to the `NEW_NO_QUIZ` presentation rather than rendering a broken box.

### The full archetype layout (all quiz-taken stages)

Top-to-bottom:

1. **Compact intro block** — small eyebrow ("Your archetype") plus the existing feature list (the `archetype.features` lines with the thin pink tick marks), kept but condensed. Do **not** keep the old `Your Archetype: {name}` h2 — `ArchetypeSection` renders the archetype name as its own large heading and a duplicate directly above it would repeat the exact mistake FI Part 3 removed (double title).
2. **`ArchetypeSection`** — full width, `index={0}`, `showPhoto` left at default (true). While `archetypesList` (or the match within it) hasn't loaded, keep the intro block visible and let the section pop in when data arrives (FlavorQuiz renders it conditionally on `matchedData &&` — same approach is fine).
3. **Coffee Sommelier entry point** — keep the existing "Talk to Liam" link block (`/sommelier?entry=user_initiated`) below the section, same styling.
4. **Retake the quiz** — a quiet secondary link ("Retake the quiz →", same micro-label link styling as Talk to Liam, visually subordinate to it) pointing at `/find-my-flavor?retake=1`. This is deliberately low-emphasis: it's an escape hatch for someone whose taste has drifted, not a primary CTA competing with the archetype box.

**The `?retake=1` param (small `FlavorQuiz.tsx` addition):** today "retake" only exists as a nav item *inside* the returning-user screen — a Profile link to plain `/find-my-flavor` would strand a matched user on that screen needing a second click. Add a mount-time check in `FlavorQuiz.tsx`: when `retake=1` is present and the user is signed in with a saved archetype, perform **exactly the same action the returning-user screen's own "Retake the quiz" nav item performs** (it sets the user's name, `setHasStarted(true)`, and calls the existing `handleRetake()` — reuse that logic, don't reimplement a parallel reset), then strip the param from the URL (`replace: true`) so a refresh doesn't re-trigger it. Wait for the profile fetch to resolve before deciding (the name comes from it); for a guest or unmatched user the param is a no-op — they already land on the name screen/quiz naturally. Touch nothing else in `FlavorQuiz.tsx` — the retake flow itself was fixed in Find My Flavor Part 2's follow-up and works.

### Flavor Memory tab — `NEW_NO_QUIZ`

Keep the existing empty state (Heart icon, "You haven't discovered your flavor archetype yet", Start the Quiz → `/find-my-flavor`) — just living in the new full-width shell (constrain to a reading column so it doesn't sprawl). No retake link here (nothing to retake).

---

## Housekeeping while you're in the file

- **`font-light` cleanup:** per the standing convention (WHAT_WE_BUILT §"font-light cleanup" — Genova has no weight 300, so `font-light` falls back to Thin), remove/replace `font-light` instances in `Profile.tsx` as part of this redesign pass. Match the weight treatment the redesigned pages (FI, Bloom) use.
- Preserve the loading state (styled for the new shell) and the signed-out redirect to `/sign-in`.
- Don't rename the file or the route; no backend changes are expected in this task. If you find `getUserProfile()`'s `archetype` object is missing `id` in practice, stop and flag it rather than adding a new endpoint call.

---

## Testing checklist

Verify in the browser (Playwright or equivalent, real backend), not just by build:

1. `vite build` clean.
2. **Matched signed-in user:** Flavor Memory shows intro block + full `ArchetypeSection` — dial rotates and selection persists across a reload (`getDialPosition`/`setDialPosition` round-trip), position card updates per dial position, "Reveal the full profile" opens the RevealedPanel (cupping notes, dimensions, wheel), Add to Cart lands in the shared FloatingCart, Compare opens `CompareOverlay` pre-filled, hop links rotate the dial and auto-reveal.
3. **Lifecycle stages:** `NEW_NO_QUIZ` gets the empty state + quiz CTA; a quiz-taken-no-order stage shows the box with no extra CTA button; `QUIZ_STALE_NO_ORDER` shows the "Palates change" retake copy; `FIRST_ORDER_FEEDBACK_PENDING` shows the nudge, and clicking it lands on the Past Orders tab with the existing feedback form (and dismissal suppresses it); `SUBSCRIBER`/`REORDER_DUE` show no shop/reorder nudge. Exercise the stages the same way the Home/FI builds did (test accounts or temporarily adjusted signals) rather than skipping the ones that are awkward to reach.
4. **Signed out:** `/profile` still redirects to `/sign-in`.
5. **Deep links:** `/profile?tab=orders`, `?tab=settings`, `?tab=family` all open the right tab; invalid values fall back to `memory`.
5b. **Retake flow:** as a matched signed-in user, "Retake the quiz" on Flavor Memory lands directly on the quiz's first question (not the returning-user screen), the URL param is stripped after triggering, completing the retake saves a new result, and returning to `/profile` shows the (possibly new) archetype. Plain `/find-my-flavor` without the param still shows the returning-user screen unchanged; `?retake=1` as a guest is a harmless no-op.
6. **Other tabs regress-free:** place-order feedback form, address add/default/delete, SMS toggle, FamilyTab all render and function in the new column widths.
7. **Mobile (390px):** tabs usable, ArchetypeSection stacks correctly (it already handles its own responsive stacking — verify it inside this page's container), no horizontal scroll.
8. Footer now visible below content; page scrolls as one document (no nested scroll container).

In your summary, list anything you had to decide that this spec didn't cover, plus the FlavorQuiz returning-user experimental-match gap noted above.
