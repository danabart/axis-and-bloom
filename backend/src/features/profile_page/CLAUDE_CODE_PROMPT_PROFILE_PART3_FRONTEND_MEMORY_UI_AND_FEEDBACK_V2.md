# Profile Part 3 — Frontend: memory layer UI (journal + journey + adjacents) + feedback form v2

**Date:** 2026-07-18
**Prerequisites:** Profile Part 1 (full-width shell + ArchetypeSection + lifecycle skeleton) and Profile Part 2 (backend `flavor-memory` endpoint + feedback v2 write path) must both be executed first. Verify both in the actual code before starting; stop if either is missing.

**Scope:** `frontend/src/app/components/Profile.tsx`, `OrderFeedbackForm.tsx` (shared — upgraded in place), and small additive touches where those are consumed. All other shared components are consumed, never edited.

---

## Design concept (agreed with Dana, mockup-confirmed)

Flavor Memory is the one page that is *about the user*, structured in three layers that **grow with the customer — never showing empty scaffolding**:

- **Identity** — who your palate is: the ArchetypeSection (Part 1, already live).
- **Memory** — what you've tasted and said: tasting journal + archetype journey ("Palate over time").
- **Horizon** — worth-exploring adjacent archetypes.

The lifecycle stage decides which sections appear and how (Part 1's stage skeleton extends, not changes). The Talk-to-Liam block stays generic across stages (explicit decision — stage-aware Liam entries were considered and passed on).

## 1. Worth exploring (directly under the ArchetypeSection)

Small chip row: the 1–2 archetypes adjacent to the user's match, from the existing adjacency source (`useArchetypeAdjacency` — same hook FI uses; adjacency currently has authored data for only some pairs, so handle 0 adjacents by hiding the row entirely). Each chip: archetype color dot + label, linking to `/flavor-intelligence?archetype={id}&slot={defaultSlot}` (resolve the default slot from the already-fetched archetypes list via `computeDefaultSortOrder`; if unresolvable, link with archetype param only). No compatibility badges here — the chip itself already means "worth exploring."

## 2. Tasting journal (Memory layer, main column)

Data: `GET /api/users/flavor-memory` (Part 2). Render `journal[]` newest-first as a timeline list. Per entry: blend name, month+year, star rating when present, the note as a quoted line when present. Entries with `hasFeedback: false` show "No note yet — add one" which expands the (v2) `OrderFeedbackForm` inline for that order — the same component, not a variant. On submit, refresh the flavor-memory data so the entry fills in.

Below the list, when `contributionCount > 0`: one quiet line — "Your notes are part of these coffees' community records — {n} contributed." (This is true: chips/descriptors feed the Collaborative Flavor Wheel's client source.)

The UC3 feedback nudge from Part 1's stage map stays where Part 1 put it, but its click now expands the pending order's form *here in the journal* instead of switching to the Past Orders tab — the journal supersedes that detour. Keep the Past Orders tab's own feedback flow working unchanged.

## 3. Palate over time (Memory layer, side column)

Render `journey[]` oldest-first as a compact vertical timeline: archetype color dot, label, date, and a short trigger word (first quiz / retake). One entry is fine and expected for most users — it still reads as the start of a story, not an error. The Part 1 "Retake the quiz" link relocates to sit under this timeline (it's the natural "next chapter" action); keep the `QUIZ_STALE_NO_ORDER` stage-copy variant from Part 1.

Desktop: journal ~60% / journey ~40% two-column under the ArchetypeSection; stack on mobile (journal first).

## 4. Per-stage behavior (extends Part 1's stage map)

| Stage | Memory + Horizon behavior |
|---|---|
| `NEW_NO_QUIZ` | Nothing from this part renders — Part 1's invitation state stands alone. No empty journals, no adjacents. |
| Quiz taken, no orders (`QUIZ_TAKEN_FRESH/SETTLED_NO_ORDER`, `QUIZ_STALE_NO_ORDER`) | Adjacents row: yes. Journal: collapses to a single seed line — "Your journal starts with your first bag." (no empty-list chrome). Journey: renders with its ≥1 entry. |
| `FIRST_ORDER_FEEDBACK_PENDING` | Full layout; nudge wired to the journal as described in §2. |
| `ACTIVE_REPEAT_USER` / `SUBSCRIBER` / `REORDER_DUE` / `LAPSED_SINGLE_ORDER` | Full layout. Still no shop/reorder nudges (homepage owns those — standing rule). |

## 5. Feedback form v2 — upgrade `OrderFeedbackForm.tsx` in place

One shared component, upgraded once, so every surface that renders it (Profile orders tab, the journal, FI's UC3 nudge, the homepage nudge) gets v2 simultaneously — do not fork a journal-specific variant. New layout, keeping the existing visual language (brick/pink palette, uppercase micro-labels):

1. **Stars 1–5** — unchanged, still the only required field.
2. **Closed dial question** — "Compared to what you expected, was it —" with three inline choices: *Lighter · As expected · Bolder* → `expectation`. Optional; unanswered sends nothing.
3. **Tasted-notes chips** — "What did you taste?" — the coffee's own note vocabulary (from the wheel data source Part 2 confirmed/extended), rendered as toggle chips, multi-select → `tastedNoteIds`. Cap the visible set (~8, expandable) if a coffee has many notes. Requires knowing the order's coffee — Part 2's journal payload / existing props should provide what's needed; if a surface can't resolve the coffee (e.g. legacy blend with no mapping), the chips section simply doesn't render — the form must degrade, not break.
4. **Free-text note** — unchanged, optional.

Submit posts the extended body (Part 2's contract; all new fields optional). The thank-you line stays. Keep the component's existing props contract as a superset — current call sites must keep compiling with at most additive prop changes.

## Reuse rules (standing)

Consume `useArchetypeAdjacency`, `computeDefaultSortOrder`, the archetypes fetch already in Profile from Part 1, and the existing wheel-data source for chips. No local reimplementations of adjacency, slot resolution, or wheel data. `Profile.tsx` gets the layout; logic that other pages will want later (journal entry, timeline) may be extracted into small components under `frontend/src/app/components/profile/` — new files are fine, parallel versions of existing shared components are not.

## Testing checklist (browser, real backend)

1. `vite build` clean.
2. Repeat customer with mixed feedback: journal renders SMS + on-site entries identically; "add one" on an old order submits v2 and the entry updates in place; contribution line shows the right count.
3. v2 form on every surface: journal, Past Orders tab, FI nudge, homepage nudge — all render v2; chips show that coffee's real notes; a stars-only submission still works.
4. Dial loop end-to-end: submit "Bolder" → confirm (via DB or admin consensus endpoint) a new `onsite_feedback` row in `dial_position_signal` for the right coffee/archetype/dimension.
5. Stage degradations: quiz-no-order account shows adjacents + seed line + 1-entry journey, no empty-journal chrome; `NEW_NO_QUIZ` shows none of this part.
6. Adjacents: chips link into FI with archetype+slot params and FI lands correctly; archetype with no authored adjacency shows no row.
7. Mobile 390px: journal/journey stack, chips wrap, no horizontal scroll.
8. Regression: Part 1 behaviors (dial persistence, cart, compare, retake link, `?tab=` links) all intact.
