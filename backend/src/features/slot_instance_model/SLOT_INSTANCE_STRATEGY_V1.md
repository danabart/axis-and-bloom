# Slot–Instance Strategy V1 — "House Style"

**Date:** 2026-08-03 · **Status:** Strategy agreed with Dana; nothing built. Tasks A–D below are each one Claude Code session, per house process.
**Companion docs:** `LIAM_STRATEGY_V3.2_FINAL.md` (design rule: slot = promise, coffee = instance), `SOMMELIER_BUILT.md` (S79/S80 brew cards), `WHAT_WE_BUILT_DB.md` (all tables named here).

---

## 1. The gap

A Bloom Dial slot (e.g. "Classic Chocolate") is deliberately fulfillable by more than one physical coffee from more than one roastery — chosen for production resilience: no single-roastery dependency per slot. Today: Classic Chocolate = **Noam Blend** (Path, `coffee_alias.priority=1`) and **Guatemala SO** (Temecula, `priority=2`).

The customer knows the slot. But everything that gives the product depth binds to the physical coffee: the QR token (Task 7), the published story, the cupping data, the brew card recipe. Two coffees certified into the same slot share its character but can differ in recipe parameters, origin, and detail — so three questions were open:

1. **What does the slot promise**, exactly, if two different coffees carry it?
2. **What carries over** for a returning customer whose next bag is a different instance?
3. **Which entity learns** from customer feedback — the coffee or the slot?

## 2. Decisions (made 2026-08-03)

| # | Decision | Chosen | Rejected |
|---|----------|--------|----------|
| D1 | What a slot *is* | **A house style, held by our cupping table** (NV Champagne / blended-whisky model). Coffees are *certified into* a slot against a written spec, not merely placed. | Slot as an incidental shelf position |
| D2 | Customer-facing posture | **Acknowledged lots** — slot identity primary; each bag is a "lot"/"expression" Liam and the arrival note speak to in positive register. Never a substitution story, never a roaster leak. | Silent house style; celebrated rotation |
| D3 | Allocation | **Instance affinity + pluggable ranking.** Affinity always wins: a returning customer keeps their instance while it's stocked. Everyone else (new customers, forced switches) is routed by a ranking function. | Global priority chain alone; scheduled rotation |
| D4 | Ranking v1 → v2 | **v1 = margin** (price is slot-level via `dial_slot_price`, so ROI ranking = lowest `roaster_blend.cost_to_us`). **v2 = customer favor**, flipped by config once instance-tagged feedback is sufficient. Only the ranking function ever changes; the affinity rule never does. | — |

Known risk, accepted: margin-ranking + affinity locks early customers to whatever was cheapest when they joined. If the high-margin instance turns out to be the less-loved one, the promise-drift metric (§6) will show it — that's the cue to flip to v2, not a flaw in the model.

## 3. The three-layer model

Every piece of data belongs to exactly one layer. Most gap questions dissolve into "which layer owns this datum."

| Layer | Owns | Lives in (today) | Stability |
|-------|------|------------------|-----------|
| **Slot** — the promise | name, style story, flavor-family expectations, price, **spec (new)** | `dial_slot_alias`, `dial_slot_price`, → new `dial_slot_spec` | Stable, forever |
| **Instance** — the expression | recipe base params, origin region bucket, cupping specifics, published story, QR token target | `coffees`, `coffee_dimensions`, Firestore story content, Task 7 tokens | Swaps when fulfillment swaps |
| **Customer** — the relationship | technique, equipment, taste adjustments, palate memory | `user_brew_card` (partly), Liam memory | Travels across instances *within a slot* |

The brew card splits along this line: the **recipe base** is instance-layer (S79's `computeRecipe()` already derives it from the coffee's own cupping `dimensionAverages`); the **customer's adjustments** on top of that base are customer-layer and must carry across a lot change (§5). Remember-never-reset holds.

## 4. Slot specs & certification (Task A)

A slot spec is the acceptance test a coffee must pass to carry the slot's name:

- **Position band**: the slot's `(archetype, dial_sort_order)` ± tolerance on the dominant dimension (from `dial_archetype_config`), checked against the coffee's `coffee_dimensions` / `v_dial_position_consensus`.
- **Descriptor requirement**: required flavor family presence (e.g. Classic Chocolate ⇒ cocoa/chocolate family dominant in cupping descriptors).
- **Certification record**: `certified_at` / `certified_by` / `certification_note` on the `coffee_alias` row — the coffee↔slot mapping *is* the certification, so no new join table. Existing rows get backfilled as grandfathered certifications.

New table `dial_slot_spec` (`archetype`, `dial_sort_order`, spec fields, versioned), admin CRUD on the Coffees admin page next to Slot Name / prices. Exact tolerance values are a **cupping-table decision for Dana**, not a dev decision — the build ships the structure with the current occupants passing by construction.

This is also the roastery-onboarding play: hand roastery #3 the spec sheet (roaster-safe: it describes our target profile, not other roasters' coffees), cup their candidates via the existing `POST /api/admin/scores` flow, certify or decline. Multi-roastery sourcing becomes a certification program, not an exception.

## 5. Allocation & handover (Tasks B + C)

### B — affinity-aware resolver

`resolveBlendForSlot(archetype, sortOrder, weightOz)` in `blendResolver.ts` gains an optional `userId` and becomes a two-part rule:

1. **Affinity (fixed part):** find the user's most recent `order_line_item → roaster_blend → coffee_id` for this slot (same join path `getBagNumberForCoffee()` already uses). If that coffee is still active in the slot and its `roaster_blend` for this weight is orderable → pick it. Done.
2. **Ranking (pluggable part):** otherwise rank the slot's active, certified candidates by the configured ranking function — config key `allocation.ranking`, values `'margin'` (v1: ascending `cost_to_us` for the weight; `priority` column demoted to tiebreak) or `'customer_favor'` (v2: promise-drift score, §6). First orderable candidate wins.

**Switch detection:** when step 1 found an affinity coffee but couldn't honor it, or the user's affinity coffee differs from what ships, stamp the order line (e.g. `order_line_item.instance_switched_from_coffee_id`). This single stamp is what Task C and the analytics both key off. What counts as "not orderable" (manual `coffee_alias.is_active` flip vs. `roaster_blend.inventory_status`) is an **open ops decision** — v1 recommendation: manual admin toggle only, no automation, so a switch is always a deliberate act.

`resolveCoffeeBlend()` (Decaf/Half-Caf/Flavored) is untouched — one coffee, no chain, no gap.

### C — the handover moment

A switched order lands on a coffee the customer has no `(user, coffee, method)` card for — so **S79's arrival note fires naturally; no new trigger needed**. Two additions:

- **Carryover seeding:** `computeRecipe()` is pure and deterministic, so the customer layer can be extracted with zero new storage: recompute the old card's original base, diff against its current params (their accumulated adjustments — grind index steps, temp, ratio), apply that diff to the new instance's computed base, clamp to `grindScale` ends. Their palate travels; the recipe stays honest to the new coffee.
- **Handover copy variant:** when the order line carries the switch stamp, the arrival note (and Liam's bag-anchored opening) uses the lot-handover framing — positive register, per the copy rules: lead with continuity and what's good *now* ("Your Classic Chocolate is here — this lot loves a slightly finer grind; your usual ratio carries over."). Never "we changed / substituted / replaced," never a roaster or raw name (S44-style grep applies to every new render path). Exact vocabulary ("lot" vs. "expression" vs. seasonal phrasing) is a **copy decision for Dana** before C ships.

Task 7's QR flow needs nothing: the token already binds to the physical coffee, so a scan always lands on the right instance's story and card. The QR is the disambiguator, not a gap.

## 6. Promise drift (Task D)

All post-delivery feedback is already instance-tagged (`user_flavor_feedback` links user+coffee+order; `dial_position_signal` `onsite_feedback` rows are per-coffee). What's missing is the slot-level rollup:

- New view `v_slot_promise_drift`: per (slot, coffee) — lighter/as-expected/bolder distribution, descriptor-vs-spec alignment, reorder rate. Cross-instance deltas within a slot = the certification running continuously on real customers.
- Admin surface on the Coffees page (roaster names fine there — admin-only).
- **This view is the v2 ranking function's input.** "Customer favor" = as-expected share + reorder rate per instance within the slot. Flipping `allocation.ranking` to `'customer_favor'` is a config change on data we started collecting at launch — a decision, not a build. Flip criterion (minimum n per instance) is an open decision; suggest revisiting once each instance in a contested slot has ~30+ feedback events.

Also earmarked as a chapter for The Axis page redesign: customer feedback as the instrument that keeps the house style honest.

## 7. What exists vs. what's new

**Already built and load-bearing:** slot-owned names (`dial_slot_alias`) and prices (`dial_slot_price`); fulfillment mapping with per-slot candidates (`coffee_alias` + `blendResolver.ts`, guest-blind); instance recorded on every order (`order_line_item → roaster_blend.coffee_id`); deterministic per-instance recipes (S79 `computeRecipe`); arrival note on new (user, coffee, method) (S79); per-coffee QR + bag-anchored Liam sessions (Task 6 contract, Task 7 in flight); instance-tagged feedback (`user_flavor_feedback`, `dial_position_signal`).

**New:** `dial_slot_spec` + certification columns (A); `userId`-aware resolver + ranking config + switch stamp (B); carryover seeding + handover copy variant (C); `v_slot_promise_drift` + admin panel (D). **No new customer-facing UI in v1** — the customer feels this only through allocation continuity and better arrival notes.

## 8. Sequencing vs. Liam v3.2 (Oct 1 launch)

Liam Tasks 8 (SMS/beats) and 9 (E2E rehearsal) proceed untouched — no shared files except C's arrival-note copy variant.

| Order | Task | Risk | When |
|-------|------|------|------|
| 1 | **A** — slot spec + certification | Data + admin only, zero customer-path risk | Anytime; good next-session candidate |
| 2 | **B** — affinity allocation | Touches order fulfillment; needs careful prod verification | Before launch — affinity should hold from the first real subscriber order |
| 3 | **C** — carryover + handover | Rides existing arrival-note machinery | After B; before the first deliberate switch can occur (a switch without C = silent instance flip, exactly what D2 rejects) |
| 4 | **D** — promise drift rollup | Read-only analytics | Post-launch fine; data accrues regardless |

If launch pressure forces a cut: A+B are the irreducible core (the promise and the continuity); C can trail *only if* no switch is performed before it ships; D trails safely.

## 9. Open decisions (Dana)

1. Spec tolerances per slot (cupping-table call) — Task A ships structure, Dana calibrates values.
2. "Not orderable" definition for switches — v1 recommendation: manual `is_active` toggle only. **Resolved as of 2026-08-25 (`WHAT_WE_BUILT.md` #170, roastery soft-deactivation):** `coffees.is_active` is now the coffee-level definition this doc anticipated — `resolveBlendForSlot`/`resolveCoffeeBlend` both require it. `deactivation_reason = 'manual'` (set via `PATCH /coffee-alias/:id` or `PATCH /inventory/:id`) is exactly the deliberate per-coffee switch called out here, distinct from `'roaster'` (the whole-roastery cascade). Still open: `resolveBlendForSlot`'s `userId` param and the rest of Tasks A–D below remain unshipped.
3. Customer-facing lot vocabulary for the handover copy (before C).
4. v2 flip criterion (suggested: ~30+ feedback events per contested instance).
5. Does affinity apply to 5lb / B2B-sponsored orders identically? (Suggest yes — same rule everywhere.)
