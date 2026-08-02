# Profile Part 7 — Flavor Memory as an activity log (quiz · ordered · saved · Liam recipes)

**Date:** 2026-08-02
**Prerequisites:** Profile Parts 1–6 executed (Flavor Memory tab, `GET /api/users/flavor-memory`, feedback V2). The Bloom Part 12 executed (explicit-save restored on the Bloom Dial, `DialArchetypeSection.tsx`). Liam Action Links executed (`<<action:...>>` marker mechanism in the Sommelier chat contract). Verify all three before starting.

**Scope:** `backend/src/routes/users.ts` (flavor-memory + dial-position routes), one new route file or additions for save-removal and Liam saves, `frontend/src/app/components/bloom/DialArchetypeSection.tsx`, `frontend/src/app/components/profile/PalateTimeline.tsx` (superseded — see Task 4), `frontend/src/app/components/Profile.tsx`, `frontend/src/app/lib/api.ts`, Sommelier chat backend (`sommelier.ts` route / prompt assembly) and `Sommelier.tsx` (Tasks 5–6 only). Liam's system remains walled off beyond what this spec names; `SOMMELIER_TASK_6_VOICE.md` stays binding for any prompt copy.

---

## Why (decision context)

"Save to my flavor memory" currently writes to a place the user never sees: the event lands in Firestore `users/{uid}/dial_events`, but nothing on /profile surfaces it. A save button with no visible destination reads as broken even when it works. Meanwhile the Flavor Memory tab's "Palate over time" column shows only quiz results.

**Dana's decision:** the palate timeline becomes an **activity log of explicit, 100%-confidence moments only**. The editorial rule, stated once and enforced everywhere: *every entry in the flavor memory is something the user deliberately did.*

- **In:** quiz completed, order completed, save-to-flavor-memory, Liam recipe saves (user-accepted, Task 5).
- **Out, permanently:** dial rotations (exploration noise — the event log already excludes them by design, see the `DIAL_EVENT_TRIGGERS` comment in `users.ts`), add-to-cart (recorded in `dial_events` for Liam's use, but ambiguous intent — never a journal entry), reveals, and anything inferred.
- **Removal:** only *saves* (dial saves and Liam saves) are user-removable — a quiz result and an order are facts, a save is an opinion. Removal is a tombstone (`removedAt`), never a hard delete: the Dial Event Log keeps full history for analytics.

## Data model (read before coding)

Verified 2026-08-02, current shapes:

- Firestore `users/{uid}/dial_events` — `{ trigger: 'explicit_save'|'add_to_cart', archetype, dialSortOrder, source, coffeeId (add_to_cart only, else null), createdAt }`. Written fire-and-forget by `PATCH /api/users/dial-position` (`users.ts` ~§506).
- Cloud SQL `user_bloom_dial_current_position` — the dial preload state. **Untouched by this brief**, including on save-removal: silent auto-save overwrites it constantly; the journal and the dial state are related but not the same thing.
- `GET /api/users/flavor-memory` already merges Cloud SQL orders + Firestore `feedback_events` + Firestore `taste_journey` (with the Part 2 quiz_session backfill fallback and Part 6's readFailed/docMissing distinction — do not weaken either).

## Task 1 — enrich `explicit_save` events at write time

`DialArchetypeSection.tsx` `handleExplicitSave` currently sends no coffee identity. Extend it to pass `coffeeId: currentSlot.coffeeId` and a new `platformName: currentSlot.platformName` field; extend the PATCH route to accept both for `explicit_save` (keep the existing `add_to_cart`-only coffeeId rule intact for that trigger, or unify — your call, but validate types either way) and store them on the event doc.

`platformName` is a **display-name snapshot at save time**. This matters twice: slot→coffee mappings drift as the catalog changes, and the roaster-blind rule (see the comment above `GET /flavor-memory`) means the journal must show the name the user saw on the dial, never a raw roaster/blend name resolved later. Old events without these fields still render (Task 3).

## Task 2 — save removal (tombstone)

New authenticated endpoint, e.g. `PATCH /api/users/flavor-memory/entries/:collection/:docId/remove` or two explicit routes — follow the codebase's existing route style. It sets `removedAt: FieldValue.serverTimestamp()` on the user's own doc in `dial_events` or `liam_saves` (Task 5). Validate the doc belongs to `req.uid` by construction (subcollection path), and that the target is actually a removable kind (`explicit_save` events and Liam saves only — reject attempts on anything else). No hard deletes anywhere in this brief.

## Task 3 — unified `activity` array in `GET /flavor-memory`

**Additive** response field (existing `journal` / `journey` / `contributionCount` consumers keep working — `journal` still powers the TastingJournal with its feedback machinery):

```
activity: Array<{
  id: string,                 // stable: order id, dial_events doc id, taste_journey index, liam_saves doc id
  type: 'quiz' | 'ordered' | 'saved' | 'recipe',
  at: string | null,          // ISO
  archetype?: string, archetypeLabel?: string,   // quiz + saved
  dialSortOrder?: number,                        // saved
  coffeeName?: string | null, // ordered: blend_name (own-order precedent); saved: platformName snapshot; recipe: optional
  title?: string,             // recipe only
  removable: boolean,         // true only for 'saved' and 'recipe'
}>
```

Sources: `taste_journey` history → `quiz` entries (reuse the existing journey read + backfill fallback, don't duplicate it); the orders query already in the route → `ordered`; one read of `dial_events` filtered to `trigger == 'explicit_save'` and no `removedAt` → `saved`; `liam_saves` (Task 5) minus tombstones → `recipe`. Merge, sort newest-first server-side. `add_to_cart` events are read for nothing here — excluded by the editorial rule.

Legacy `explicit_save` events (pre–Task 1, no coffeeId/platformName): render honestly as position-only — `coffeeName: null`, frontend shows "Position N on the {archetype} dial". Do **not** resolve a name at read time; drift + roaster-blind (Task 1).

This is the backfill for free: every explicit save since the Dial Event Log shipped appears in the journal the moment this route deploys.

## Task 4 — frontend: the activity log replaces PalateTimeline

In the Flavor Memory tab's side column, replace `PalateTimeline` with a new `ActivityTimeline` (new file next to it; delete PalateTimeline once nothing imports it). Keep its virtues: collapsed to the most recent handful with a "Show full history (N)" toggle, newest-first, archetype dot colors where an archetype is present, the "Retake the quiz" link staying at the bottom (it's still the natural next-chapter action).

Each entry is one compact line in the existing quiet register (10–11px uppercase metadata, `#a33726` ink): short date · **type badge** · substance. Badge copy: `Quiz` / `Ordered` / `Saved` / `Recipe`. Substance examples:

- Quiz — "Your palate read as {archetypeLabel}" (first quiz) / "{archetypeLabel}" with the existing First quiz/Retake distinction folded into the badge line
- Saved — "{platformName} · {archetypeLabel} dial" or the position-only fallback
- Ordered — "{blendName}" (one line, no feedback chrome — the TastingJournal in the main column keeps that job; don't duplicate its UI)
- Recipe — "{title}", expandable to the stored body inline (collapsed by default)

Removable entries get a small "remove" affordance (visible on hover on desktop, always on mobile) → Task 2 endpoint → optimistic removal from the list, no confirmation modal for v1 (it's a tombstone; nothing is destroyed).

**Close the loop on the dial:** in `DialArchetypeSection.tsx`, after a successful explicit save, "Saved ✓" gains a companion link in the same text style: "View in your flavor memory →" → `/profile?tab=memory` (the tab param already routes, see `VALID_TABS`).

## Task 5 — Liam recipe saves (opt-in, marker-mechanism reuse)

New Firestore subcollection `users/{uid}/liam_saves`: `{ kind: 'recipe', title, body, coffeeName: string|null, createdAt, removedAt? }`. `kind` is an enum of one today, on purpose — brew tips or pairing notes can join later without a schema change.

Mechanism reuses Action Links exactly, with one deliberate extension:

- **Prompt:** Liam appends `<<action:save_recipe>>` only when the reply he just wrote *is* a preparation recipe/brew guide the user asked for — never preemptively, never on general chat. Instruction copy in Liam's voice-doc register; base-prompt vs per-intent addendum decided the same way Action Links did. If seeded config changes, restate the known caveat: live Firestore config needs the same edit via the admin portal.
- **Backend:** strip the marker; return `actions: [{ type: 'save_recipe' }]`.
- **Frontend (`Sommelier.tsx`):** render a chip "Save to my flavor memory". Unlike the existing chips this one is an **action, not a link**: on tap, POST a new authenticated endpoint (e.g. `POST /api/users/flavor-memory/liam-saves`) with `{ title, body }` where `body` is that Liam message's already-rendered text and `title` is a short client-derived label (first line / "V60 recipe" style — keep derivation dumb and predictable; server just length-validates and stores). Chip flips to "Saved ✓" on success, then also offers "View in your flavor memory →".

**Guardrail reconciliation (state this in code comments and your summary):** Action Links' "no writes from chat" rule was about *identity and dial state*, and it still stands — nothing here writes archetype, dial position, or any state Liam's signal stack reads. This brief adds user-initiated *content* saves: Liam only marks that an offer is appropriate; the write happens because the signed-in user tapped, through a validated endpoint. The LLM never triggers a write and never supplies ids.

## Task 6 (optional — cut first if scope grows) — the derived reading line

One sentence above the activity log interpreting it, client-side and rule-based (no LLM, no new endpoint): compare the latest quiz archetype against the archetypes of the most recent few `saved`/`ordered` entries. Same archetype or too little data → render nothing (an absent line beats a hollow one). Diverging → e.g. "Your quiz read {A}, but lately you've been leaning {B}." Copy in the site's sommelier register, no exclamation marks. Keep the rule in one small pure function with unit tests.

## Guardrails (binding)

- The editorial rule is law: no `add_to_cart`, rotation, reveal, or inferred entries in `activity`, now or as a "quick addition".
- No hard deletes; tombstones only. `dial_events` history stays complete for Liam/analytics.
- `user_bloom_dial_current_position` untouched; save-removal never changes dial preload.
- Journal names: platformName snapshot or own-order blend_name only — never a read-time catalog/roaster resolution (roaster-blind).
- Existing `flavor-memory` response fields unchanged; `activity` is additive.
- Liam: no new intents, no routing/token/turn changes, prompt edits limited to the marker instruction, voice doc binding.

## Testing

1. Frontend + backend build clean.
2. Task 1: explicit save from /bloom writes coffeeId + platformName on the event doc; add-to-cart path unchanged.
3. Task 3: a user with quiz retakes, orders, old (pre-Task-1) saves, and new saves gets one correctly-ordered `activity` array; old saves render position-only; `add_to_cart` events never appear. Existing journal/journey consumers unaffected (Part 6 regression: readFailed still 500s, missing doc still backfills).
4. Task 2/4: removing a save tombstones the doc, drops it from the log optimistically and on refetch, leaves dial preload alone, and non-removable types reject server-side.
5. Task 5: a brew-guide conversation yields the chip; tapping stores and flips to Saved ✓; the recipe appears in the profile log, expands, and removes like any save. A greeting/general chat never yields the marker.
6. Task 6: diverging history renders the line; aligned or sparse history renders nothing.
7. Mobile 390px: log lines wrap cleanly, remove affordance reachable, chip wraps in the thread.

In your summary: where the marker instruction landed (base vs addendum) with exact copy for Dana's voice sign-off, whether live Firestore config needs the admin-portal edit, the removal endpoint shapes you chose, and confirmation that PalateTimeline is fully superseded with no orphaned imports.
