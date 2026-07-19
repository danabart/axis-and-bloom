# Dial event log — explicit saves + add-to-cart into Firestore, feeding Liam and analytics

**Date:** 2026-07-18 (revised same day — supersedes the earlier version of this file that logged every dial turn. Dana's call: logging every turn would fill Firestore with exploration noise — "a pile of garbage." Only **deliberate** moments are logged.)

**Scope:** Phase A is outside the Sommelier wall (`ArchetypeSection.tsx` additively, `users.ts` route, cart add hook-in). Phase B touches Sommelier context assembly — `SOMMELIER_TASK_6_VOICE.md` and the walled-off-system convention are binding there.

---

## The two-layer model (decided 2026-07-18 — keep this straight)

- **`user_bloom_dial_position` (SQL)** stays exactly as it is: silently auto-updated on every signed-in dial turn, one row per user+archetype. It is *continuity state* — "where you left the dial" — not a record of intent. **No whisper, no narration, no behavior change.** (The whisper formerly spec'd in Profile Part 4 is dead — do not build it.)
- **`users/{uid}/dial_events` (Firestore, new)** records only *intentional* moments, of exactly two kinds:
  1. `explicit_save` — the user clicks a new "Save to my flavor memory" button by the dial
  2. `add_to_cart` — the user adds a coffee to cart from a position card (the position rides along with the strongest intent signal there is)

Exploration twiddling writes nothing to the log, ever. Consumers: Liam's conversation-scoping first (Phase B); analytics later reads the same events (Dana's explicit intent — keep the doc shape query-friendly, but build no analytics surface now).

## Phase A0 — rename the SQL table for clarity

Now that a history log exists, `user_bloom_dial_position` becomes ambiguous (is it the log or the setting?). Rename it to **`user_bloom_dial_current_position`** so the two-layer split is legible from the names alone. Mechanics: `ALTER TABLE ... RENAME` in `schema.sql` using the codebase's established idempotent-migration pattern (see the `client_flavor_feedback → user_flavor_feedback` rename precedent already in `schema.sql`), update the two queries in `users.ts` (`GET`/`PATCH /dial-position` — API paths and response shapes unchanged, this is internal naming only), and add a table comment stating the contract: "current dial setting per user+archetype, overwritten in place; movement history lives in Firestore users/{uid}/dial_events." Grep for any other references (indexes, seeds, docs) before assuming those two queries are all.

## Phase A — the two triggers

**Event doc shape:**

```jsonc
{
  "trigger": "explicit_save",     // 'explicit_save' | 'add_to_cart'
  "archetype": "chocolate_nutty",
  "dialSortOrder": 3,
  "source": "bloom",              // 'bloom' | 'find_my_flavor_returning' | 'find_my_flavor_results' | 'profile'
  "coffeeId": 17,                 // add_to_cart only; null on explicit_save
  "createdAt": serverTimestamp
}
```

**Transport:** extend `PATCH /api/users/dial-position` with optional `trigger` + `source` (+ `coffeeId` when trigger is `add_to_cart`). Requests **without** `trigger` behave exactly as today — SQL upsert only, no log (this is the auto-save path; old clients unaffected). Requests **with** a valid `trigger` do the SQL upsert *and* append the Firestore event, fire-and-forget — a log failure must never fail the request. Validate `trigger`/`source` against the known lists; unknown → 400 for `trigger` (it's the whole meaning of the call), null for `source`.

**1. The "Save to my flavor memory" button:** add it **once, in `ArchetypeSection.tsx`** (additively — it renders on all four dial surfaces: /bloom, both Find My Flavor screens, Profile; a single shared placement near the dial/card row is the point, no per-page copies). Signed-in users only — hidden for guests (nothing to save to). States: default → click → brief saved confirmation ("Saved ✓" in the section's muted style), resetting when the dial moves to a new position. Each surface passes its `source` value down (new optional prop; existing consumers compile unchanged — default the prop so surfaces that don't pass it yet still render, with `source: null`).
2. **Add-to-cart capture:** where the position card's add-to-cart fires (the `onAddToCart` flow in `ArchetypeSection`/`PositionCard` consumers), also fire the trigger call with the current archetype/position/coffeeId — signed-in only, and it must not delay or block the cart action. Bloom's "Other Categories" cards and FI's inline `OtherCategoryCard` have no dial position — they log nothing; do not invent a position for them.

## Phase B — Liam reads it

At session initialization, where the opening context is assembled (the same place `userArchetype`/`previousArchetype` are gathered in `sommelier.ts`), add a compact `recentDialActivity` summary derived from the last ~30 `dial_events` — e.g. per-archetype: saved-position count, latest saved position vs. default, whether recent events are cart-anchored or save-only, drift direction. **Summarize server-side into a few fields — never dump raw events into the prompt.** Include it for `EXPLORATION` and `PROFILE_AMBIGUOUS` at minimum; your judgment on the others, stated in the summary. Because only intentional events exist in the log, the summary can treat every event as meaningful — that's the payoff of the trigger design.

Addendum copy telling Liam he may reference this ("I see you saved a bolder spot recently…") is a voice question: propose wording in your summary for Dana's sign-off; remember live Firestore `config/sommelier` needs addendum changes applied via the admin portal separately.

## Explicitly out of scope

Logging plain dial turns (rejected — noise), any whisper/narration of the silent auto-save, SQL log mirror, GA4 events, retention/pruning, any analytics UI, changes to `user_bloom_dial_position` semantics.

## Testing

1. Builds clean. Signed-in: dial turn alone → SQL updated, **no** Firestore event; "Save to my flavor memory" → event with `trigger: 'explicit_save'` + right source, button shows saved state, resets on next turn; add-to-cart from a position card → event with `trigger: 'add_to_cart'` + coffeeId, cart unaffected in timing/behavior.
2. Signed-out: button hidden; add-to-cart logs nothing; cart still works.
3. Legacy PATCH body (no trigger) → today's exact behavior. Forced Firestore failure → request still succeeds.
4. Other-category cards (no dial) → no events.
5. Phase B: user with events starting an `EXPLORATION` session gets the summary; user with none gets no field and no error.

In your summary: the `recentDialActivity` shape, which intents receive it, proposed addendum copy, and where the button landed inside `ArchetypeSection`.
