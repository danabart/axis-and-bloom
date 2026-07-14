# The Bloom — Part 10: make `ArchetypeSection` and the cart reusable outside `/bloom`

**Prerequisite context — read `CLAUDE_CODE_PROMPT_THE_BLOOM_PART5_REUSE_ON_QUIZ.md` in this same folder first.** Part 5 was written and confirmed with Dana but **never executed** — the codebase today still has `ArchetypeSection` defined locally/unexported inside `BloomPage.tsx`, and cart state is still page-local (no `CartContext`). (Numbering note: this is Part 10, not a continuation of Part 5's own number — Parts 6–9 already exist in this folder for unrelated row-layout/bag-position fixes, executed between Parts 5 and now.)

**Scope note:** this file only covers the two pieces of Part 5 that are genuinely about *The Bloom's own code* — extracting its per-archetype block into a reusable component, and lifting its cart out of page-local state. Everything about *using* that reusable component on Find My Flavor (embedding it, the returning-user screen's layout, nav changes, the household party link) lives in a separate feature folder: `backend/src/features/find_my_flavor_page/CLAUDE_CODE_PROMPT_FIND_MY_FLAVOR_PART1_RETURNING_USER_REDESIGN.md`. That file has this one as its prerequisite — do this one first.

Do not do Part 5's Phase C2 (curtain/reveal screen) or Phase E (feedback prompt) as part of this task — Dana hasn't asked for those yet, and if/when she does, they belong in `find_my_flavor_page/` too (they're changes to `FlavorQuiz.tsx`, not to `BloomPage.tsx`), not as further parts of this file. Leave `CLAUDE_CODE_PROMPT_THE_BLOOM_PART5_REUSE_ON_QUIZ.md`'s checklist as-is; this file's own checklist at the bottom is what tracks this part.

---

## Phase A — Extract `ArchetypeSection` into a shared component (Part 5, Phase A)

`BloomPage.tsx` currently defines the per-archetype block (archetype header row + three-column photo/dial/card row + full-width `RevealedPanel` beneath) as a local, unexported `ArchetypeSection` function, plus a `computeDefaultSortOrder` helper. Note Parts 6–9 already made layout adjustments inside this block (row-height balancing, bag repositioning) — the extraction must carry those changes over, not the older shape described back in Part 5 itself.

Move both into a new file `frontend/src/app/components/bloom/ArchetypeSection.tsx`, exported. Keep the implementation behavior-identical to what's live today — pure extraction. Add the one new prop Part 5 specifies:

- **`showPhoto?: boolean` (default `true`)** — when `false`, omit the photo column and redistribute the row's flex proportions instead of leaving a gap (use today's live basis values as the starting point, not Part 5's original numbers, since Parts 6–9 already changed them).

`BloomPage.tsx` imports `ArchetypeSection`/`computeDefaultSortOrder` from the new file instead of defining them locally, and keeps passing `showPhoto` unset (defaults to `true` — no visual change on `/bloom`).

**Note for whoever builds `find_my_flavor_page`'s Part 1:** that page's returning-user screen embeds this component with `showPhoto` at its default (`true`) — Dana's reference screenshot for that task shows the photo column present in the reused section, unlike a future curtain-screen use case (out of scope everywhere right now) where a bag image already exists elsewhere on that screen and the photo would be redundant.

## Phase B — Shared `CartContext` (Part 5, Phase B)

Cart state (`CartItem[]`, add/remove/checkout) is currently local to `BloomPage.tsx`. Any other page that embeds `ArchetypeSection` needs to add to the same cart as `/bloom`.

- Create `frontend/src/app/context/CartContext.tsx` — same in-memory shape already used (`{ archetype, dialSortOrder, weightOz, platformName, retailPriceCents, qty }[]`, no `localStorage`/`sessionStorage`), relocating `BloomPage.tsx`'s existing add/remove/checkout logic into a provider rather than writing new cart logic.
- Wrap `CartProvider` around at least `/bloom` and `/find-my-flavor` — simplest correct option is wrapping the whole router tree in `App.tsx`.
- `BloomPage.tsx` consumes `useCart()` instead of owning cart state directly.
- Promote `FloatingCart` to a layout-level element (e.g. rendered once in `PublicLayout.tsx`) instead of once per page, so any page wrapped in `CartProvider` gets a consistent, shared cart UI automatically.

## Explicitly out of scope for this part

- Part 5 Phase C2 — replacing the curtain/reveal screen's hardcoded `BloomDial` with `ArchetypeSection`.
- Part 5 Phase E — the order-scoped feedback prompt.
- Embedding `ArchetypeSection` anywhere on `/find-my-flavor`, or any change to `FlavorQuiz.tsx` — that's `find_my_flavor_page`'s Part 1.
- Any change to `RevealedPanel.tsx`, `PositionCard.tsx`, `BloomDialWidget.tsx`, `CompareOverlay.tsx`, or `usePositionCardData.ts` beyond what Phase A's extraction requires (no behavior changes to any of them).

## Testing task

1. **Extraction regression**: `/bloom` renders and behaves identically to before — same photo/dial/card layout (including the Part 6–9 fixes), same reveal-panel behavior, checkout still works.
2. **Cart relocation regression**: on `/bloom`, add an item, confirm it appears in the (now layout-level) `FloatingCart`, remove it, checkout — all identical to pre-refactor behavior. (Testing the *shared*, cross-page part of the cart — i.e. adding on `/find-my-flavor` and seeing it on `/bloom` — belongs to `find_my_flavor_page`'s Part 1 testing task, since that's the first place a second consumer of `CartContext` exists.)

## Summary checklist

- [ ] `ArchetypeSection.tsx` extracted to `frontend/src/app/components/bloom/`, with `showPhoto` prop (default `true`); `/bloom` behavior unchanged, including Part 6–9 layout fixes
- [ ] `CartContext` created and wrapped around at least `/bloom` and `/find-my-flavor`; `FloatingCart` promoted to a layout-level element
- [ ] Testing task completed
