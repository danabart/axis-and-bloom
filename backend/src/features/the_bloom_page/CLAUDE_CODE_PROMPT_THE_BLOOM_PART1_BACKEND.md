# The Bloom — Part 1 of 2: Backend (schema + roaster-blind endpoints)

This build is split into two Claude Code sessions, run in order: **this file (backend)**, then `CLAUDE_CODE_PROMPT_THE_BLOOM_PART2_FRONTEND.md` in this same folder. Part 2 depends on every endpoint in this file being live and tested — don't start Part 2 until Part 1's testing task below is complete. Splitting it this way lets the backend be verified against real data (the same way this team already verifies DB changes — see Testing task) before any frontend code depends on it.

## Context

Dana's target IA for customer-facing coffee pages: **The Axis** (`/the-axis`, already built, not touched by this project) and **The Bloom** (`/bloom`, new — this two-part build). Per Dana: *"bloom page should have the coffee information and option to shop."* The Bloom is a genuine merge of two existing pages' responsibilities:

- **`/coffees` (`CoffeesPage.tsx`)** — today's per-coffee flavor-intelligence page. Live DB data: flat, unsorted sidebar of every coffee, AI editorial content (surprise note, three-voice story, AI summary), dimension bars, bubble cloud, compare mode, compatibility badge for logged-in users. **Leaks `roaster` and raw coffee names** in places (see Phase 1c below).
- **`/shop` (`Shop.tsx`)** — Camila's archetype-grouped editorial shell. Beautiful, already organized by archetype (hero photo, bag art, color per archetype), but **`ARCHETYPES` is a hardcoded array** — one fake coffee per archetype, fake price, no DB connection, no cart/checkout at all.

**Do not remove or modify `/coffees` or `/shop`.** Neither is being retired. `/coffees` stays permanently as a secondary flavor-intelligence destination (see Decision #9). `/shop` stays because **Camila is actively working on it right now** — this backend-only part doesn't touch frontend files at all, so this mostly doesn't apply here, but keep it in mind if any endpoint work tempts you to peek at `Shop.tsx` for reference.

This is a drop-ship model: **customers must never see roaster identity or raw internal coffee names anywhere on The Bloom** — only archetype + Bloom Dial position + the customer-facing alias (`coffee_alias.platform_name`). Confirmed explicitly with Dana: fully hidden, not just de-emphasized. Every endpoint below exists to enforce that.

The backend groundwork for slot-based ordering already exists (`resolveBlendForSlot`, `POST /api/orders` slot-item support, `GET /api/shop/resolve-blend`) — see entry #77 in `WHAT_WE_BUILT.md`. This part wires the remaining public, roaster-blind surface on top of it.

---

## Data model recap (for reference, no changes needed to understand this)

- `archetype_assignments` — current archetype per coffee (`superseded_at IS NULL` = current)
- `dial_archetype_positions` + `dial_position_vocabulary` — a coffee's position within its archetype (e.g. sort_order 1/2/3 = "← Lighter / ◉ Classic / → Richer" for the 5 real archetypes; `experimental` uses a different 4-label vocabulary on a different dimension — don't hardcode "always 3 positions")
- `coffee_alias` — `platform_name` (the customer-facing "Slot Name"), `archetype`, `dial_sort_order`, `coffee_id`, `priority` (1 = preferred fulfillment, 2+ = fallback), `is_active`. **The live source of truth for a slot's archetype/position is `dial_archetype_positions`/`archetype_assignments`, not the stored columns on `coffee_alias`** — always derive with `COALESCE(aa.archetype, ca.archetype)` / `COALESCE(dpv.sort_order, ca.dial_sort_order)`, the same pattern `GET /api/admin/coffee-alias` already uses. `platform_name` is shared across every `coffee_alias` row in the same slot — always write it via the slot-scoped update, never per-row (see the Phase 2 correction in `WHAT_WE_BUILT.md` entry #76 — this drift bug already happened once).
- `roaster_blend` — the sellable variant (weight, SKU, Shopify variant ID, `quantity_available`, `is_active`). **No customer-facing price field exists anywhere in the schema today** — Phase 0 adds one, on a new `dial_slot_price` table (archetype + dial_sort_order + weight_oz), not on this table or on `coffee_alias`. Named to group with the existing `dial_*` family (`dial_archetype_positions`, `dial_position_vocabulary`, etc.) since a "slot" is exactly the archetype+position concept those tables already define.
- `resolveBlendForSlot(archetype, dialSortOrder, weightOz)` in `backend/src/services/blendResolver.ts` — priority-ordered fallback resolver for a slot. **Returns `coffee_name` and `roaster` in its result** — fine for its existing internal/diagnostic use, but this must never reach the customer (see Phase 1b).

---

## Phase 0 — Schema: retail pricing, per slot per weight

There is currently no retail price anywhere in the DB (`roaster_blend.cost_to_us` is what we pay the roaster, not what we charge). Price is **per slot per weight** — confirmed with Dana: 12oz and 5lb of the same slot (e.g. "Chocolate & Nutty — Classic") are two different prices, not one price applied to both. It doesn't belong on `coffee_alias` (that's one row per slot, no weight dimension) or on `roaster_blend` (that would let two different roasters fulfilling the same slot show two different prices for the same weight, which breaks the "customer buys a slot, not a roaster's coffee" abstraction). It needs its own table, keyed by slot + weight:

```sql
CREATE TABLE IF NOT EXISTS dial_slot_price (
  id                  SERIAL PRIMARY KEY,
  archetype           archetype_enum NOT NULL,
  dial_sort_order     INT NOT NULL,
  weight_oz           NUMERIC NOT NULL,
  retail_price_cents  INTEGER NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (archetype, dial_sort_order, weight_oz)
);
```

- `CREATE TABLE IF NOT EXISTS` — idempotent, follow the existing pattern in `schema.sql`.
- New admin endpoints in `backend/src/routes/admin.ts`: `GET /api/admin/slot-prices` (all rows) and `PATCH /api/admin/slot-prices` accepting `{ archetype, dialSortOrder, weightOz, retailPriceCents }`, upserting on the `(archetype, dial_sort_order, weight_oz)` unique constraint. This is a separate concept from `coffee_alias`/`platform_name` — don't route it through the existing `/coffee-alias/slot` endpoint, keep it its own thing.
- `AdminCoffees.tsx`'s slot edit control gets **two** price fields (12oz and 5lb), not one, next to the existing "Slot Name" editor. (This one line touches a frontend admin file — the only frontend touch in this backend-focused part, since the admin UI and its API are naturally built together.)
- **Defaults, confirmed with Dana:** 12oz defaults to **$38.00 (3800 cents)** when unset. 5lb defaults to **$199.00 (19900 cents)** when unset — Dana asked for a recommendation here: 12oz at $38 works out to about $3.17/oz; 5lb (80oz) at pure proportional pricing would be $253, so $199 reflects roughly a 21% per-ounce bulk discount, which is a fairly typical bulk-pricing pattern for specialty coffee. **Treat this as a proposed number, not a locked one** — easy to change, it's just a `COALESCE` default. Apply both as `COALESCE(retail_price_cents, 3800)` / `COALESCE(retail_price_cents, 19900)` at the query level (in the Phase 1a endpoint, keyed by which `weight_oz` is being read), not as a frontend fallback, so admin and public reads agree.

---

## Phase 1 — Backend: public, roaster-blind endpoints

### 1a. New: `GET /api/coffees/archetypes` (public, no auth)

Returns every archetype with **every position in its dial vocabulary** — not just the ones currently occupied — so the frontend can render a "temporarily unavailable" card for a position that exists but has nothing active in it right now (see Decision #3). Never `roaster`.

```
[
  {
    archetype: "chocolate_nutty",
    archetypeLabel: "Chocolate & Nutty",
    slots: [
      {
        dialSortOrder: 2,
        positionLabel: "◉ Classic",
        isActive: true,
        platformName: "Classic Chocolate",
        prices: [
          { weightOz: 12, retailPriceCents: 3800 },
          { weightOz: 80, retailPriceCents: 19900 }
        ],
        coffeeId: 14   // needed client-side only to call the per-coffee content/dimensions/hops endpoints below — never rendered
      },
      {
        dialSortOrder: 3,
        positionLabel: "→ Richer",
        isActive: false,
        platformName: null,
        prices: [],
        coffeeId: null
      },
      ...
    ]
  },
  ...
]
```

Start from `dial_position_vocabulary` (`LEFT JOIN` outward from there, per archetype) so every defined position is present in the response even with nothing active in it — don't start from `coffee_alias` and only include rows that exist, that's what silently drops empty positions.

**Prices**: for each active position, `LEFT JOIN dial_slot_price` on `(archetype, dial_sort_order)` for both `weight_oz IN (12, 80)`, applying the Phase 0 `COALESCE` defaults ($38 / $199) per weight independently — a slot can have an explicit 12oz price and no 5lb price set yet, in which case 5lb still gets its own default rather than inheriting 12oz's value. For an `isActive: false` position, `prices` is an empty array — there's nothing to price.

**`coffeeId` must be the coffee that will actually fulfill an order for this slot right now — not just the priority-1 alias row.** Cupping notes, dimension scores, and AI-generated content are specific to one real coffee cupped from one real roastery; showing notes for a coffee that isn't the one shipping is a real correctness bug, not a cosmetic one — confirmed explicitly with Dana. For each position, call the existing `resolveBlendForSlot(archetype, dialSortOrder, weightOz)` (`backend/src/services/blendResolver.ts`) server-side — the same priority-1-else-priority-2-else-nothing logic that already governs real fulfillment — and use its `coffee_id` for `coffeeId`. Never expose `resolveBlendForSlot`'s `roaster`/`coffee_name` fields in this response, only the numeric `coffee_id`.
- If it resolves to a coffee: `isActive: true`, `coffeeId` = the resolved `coffee_id`, `platformName` from that slot's `coffee_alias` row (same value regardless of which roaster fulfills, per the slot-scoped write in `WHAT_WE_BUILT.md` #76), `prices` from `dial_slot_price` per Phase 0 (independent of which roaster fulfills — price is a property of the slot, not the roaster).
- If it resolves to `null` (nothing currently fulfillable): `isActive: false` — same "Temporarily unavailable" state as a position with no alias at all. Stock-awareness lives here, not only in Phase 1b.
- **`weightOz` for this resolution**: use a canonical default weight (12oz) to decide which coffee's notes/dimensions to show, even though the actual weight selector (Phase 1b) checks each weight independently. Edge case, flagged rather than silently glossed over: if 12oz has fallen back to the priority-2 roaster but 5lb still has priority-1 in stock, the notes shown will reflect priority-2 while a 5lb buyer actually receives priority-1. Accept this for now — solving it exactly would mean re-resolving notes per weight selection, which is more complexity than the actual risk (both roasters' stock diverging on the same slot at the same time) currently justifies. Revisit if it becomes a real mismatch in practice.

### 1b. New: `GET /api/shop/slot-availability?archetype=&dialSortOrder=&weightOz=` (public, no auth)

Thin, customer-safe wrapper around `resolveBlendForSlot`. **Do not expose `resolveBlendForSlot`'s raw result to any public route.** Response:

```
{ available: true, weightOz: 12 }
```

or `{ available: false }` if `resolveBlendForSlot` returns `null`. Strip `coffee_name`, `roaster`, `blend_id`, `skipped`, everything else. Leave `GET /api/shop/resolve-blend` exactly as it is — it's an existing internal diagnostic tool, keep it working for that.

### 1c. Sanitize the three per-coffee endpoints The Bloom will call (`backend/src/routes/coffees.ts`)

**The Bloom will not call `GET /api/coffees` (the flat list) at all** — Phase 1a replaces it for Bloom's purposes. The three endpoints Bloom will call, using `coffeeId` from Phase 1a, are `/:id/content`, `/:id/dimensions`, and `/:id/flavor-wheel`. Check each for anything roaster/coffee-name identifying and strip it from what these return:

- `/:id/content` — returns `aiSummary`/`surpriseNote`/`threeVoiceNarrative`/`generatedAt`. Check it doesn't echo back a coffee name anywhere in the payload.
- `/:id/dimensions` — dimension values + notes. Same check.
- `/:id/flavor-wheel` — **this one currently does leak**: its query selects `coffee_name` directly from `v_collaborative_flavor_wheel` (`backend/src/routes/coffees.ts` line ~199). The bubble cloud only needs `wheel_category`/`wheel_subcategory`/`descriptor`/`source`/`mentions`/`avg_intensity` — `coffee_name` isn't used by the UI at all, drop it from what's returned to public callers.

**Leave `GET /api/coffees` (the list endpoint) exactly as it is** — it's only consumed by the still-live, untouched `CoffeesPage.tsx`, and per Decision #2, fixing that leak is explicitly out of scope for this build.

### 1d. Order confirmation — don't leak on receipts either

`POST /api/orders`'s response includes `resolvedCoffeeName`/`resolvedRoaster` per line item (needed internally for fulfillment). This is fine as-is on the backend — it's Part 2's job to make sure the frontend never renders those two fields. No backend change needed here, just documenting why they exist and that they're intentional.

### 1e. New: `GET /api/coffees/:coffeeId/hops` (public, no auth) — Bloom Dial hop navigation

Customer-safe wrapper over `dial_coffee_relationships` / `v_dial_navigation`. `coffeeId` here is the internal id from Phase 1a (never rendered, and correctly the coffee actually resolved to fulfill that slot) — same pattern as `/:id/dimensions`, `/:id/content`.

For the given coffee, find its outgoing hops (`from_coffee = coffeeId`) and, for each, **derive the target's live slot** the same COALESCE way every other endpoint in this prompt does — don't join straight to `dial_coffee_relationships.to_coffee`'s stored data, the target coffee may have moved since the hop was recorded. Response:

```
[
  {
    dimensionName: "Acidity",
    direction: "more",
    hopType: "within_archetype",
    confidence: "high",
    target: {
      archetype: "chocolate_nutty",
      archetypeLabel: "Chocolate & Nutty",
      dialSortOrder: 1,
      positionLabel: "← Lighter",
      platformName: "Bright & Bold"
    }
  },
  ...
]
```

Never include `to_coffee`'s id, name, or roaster. Filters:
- `is_recommended = true` only (skip raw/unreviewed hop rows — that's what the `is_recommended` flag is for)
- Drop any hop whose derived target slot is not currently active (i.e. it wouldn't be `is_active` in the Phase 1a slot list) — a hop to a slot that isn't rendered anywhere on the page is a dead end, not a feature
- Order by `confidence` (high → medium → low), cap at the top 3 in the response — the frontend shouldn't need to do this filtering itself

---

## Testing task (do this before starting Part 2)

This team's established pattern (see `WHAT_WE_BUILT.md` entries #75–77) is verifying backend changes against real production Cloud SQL data via the Auth Proxy, using rolled-back transactions for anything mutating, rather than relying only on local/mocked data. Follow that pattern here:

1. **Schema**: confirm `dial_slot_price` creates cleanly on top of the current production schema; confirm the `UNIQUE (archetype, dial_sort_order, weight_oz)` constraint actually rejects a duplicate insert.
2. **`GET /api/coffees/archetypes`**: run against real data. Confirm every archetype appears with its full position vocabulary (including at least one currently-inactive position, if one exists in production, to verify the "temporarily unavailable" case actually surfaces). Confirm `prices` defaults apply correctly for a slot with no `dial_slot_price` row yet. Confirm no response anywhere contains `roaster` or a raw coffee name.
3. **Stock-aware `coffeeId` resolution** — this is the correctness fix from Decision #6, worth testing deliberately, mirroring how entry #77 tested the priority fallback: pick a real slot with both a priority-1 and priority-2 coffee, temporarily zero out priority-1's `quantity_available` (inside a transaction you roll back, or restore manually after, same caution as #77's verification), confirm `GET /api/coffees/archetypes` now returns priority-2's `coffee_id`, then restore and confirm it reverts to priority-1.
4. **`GET /api/shop/slot-availability`**: confirm `available: true`/`false` matches real stock for a couple of known slots+weights; confirm the response never includes `coffee_name`/`roaster`/`blend_id`.
5. **`/:id/flavor-wheel` leak fix**: confirm `coffee_name` is genuinely gone from the response for a coffee known to have flavor-wheel data.
6. **`GET /api/coffees/:coffeeId/hops`**: use a known real hop relationship if one exists (the Feather In Cap → Crosshatch example verified in `WHAT_WE_BUILT.md` #76 is a good candidate) and confirm the response resolves the target's live slot correctly, respects the `is_recommended`/active-target filters, and caps at 3.
7. **Regression check**: confirm `GET /api/coffees` (the untouched list endpoint) and everything `CoffeesPage.tsx`/`Shop.tsx`/existing admin pages depend on still behaves exactly as before — this build should be purely additive at the API layer.
8. If any pure logic got extracted into a standalone function (e.g. price-default resolution, hop filtering) in a way that's easy to unit test without a DB connection, consider adding tests following the existing `backend/src/services/quizScoring.test.ts` / Vitest pattern (`npm test` from `backend/`) — not required for every function, use judgment the way that file's 31 tests did for scoring logic specifically.

---

## Decisions Dana has confirmed (do not re-litigate these — full list, shared with Part 2)

1. **Pricing (Phase 0)** — price is per slot **per weight**, on a new `dial_slot_price` table (not `coffee_alias`, not `roaster_blend`) — named to group with the existing `dial_*` table family. Defaults where unset: **$38.00 for 12oz**, **$199.00 for 5lb** (the 5lb number is Claude's recommendation, given as requested — roughly a 21% per-ounce bulk discount off proportional pricing — treat it as adjustable, not locked in).
2. **`GET /api/coffees` roaster leak on the still-live `/coffees` page** — leave it untouched, not in scope here. `/coffees` won't be retired (see #9); it's expected to stay live long-term as its own destination, so this leak will need fixing at some point, just not in this build.
3. **Empty slots** — show a **"Temporarily unavailable"** state: the position card still renders (position label only, greyed out badge), but with no alias, no price/weight/cart controls, and no informational-layer reveal. Do not hide the position entirely.
4. **Axis → Bloom cross-link** — approved (implemented in Part 2).
5. **Bloom Dial hop navigation** — approved, in scope. Initially scoped out as "not a shop concept," then explicitly added back in by Dana: it's core to how The Bloom should let customers move between coffees.
6. **Notes must match the coffee that actually ships** — confirmed with Dana, and corrected in this build (Phase 1a). Cupping notes, dimension scores, and AI content are specific to one real coffee cupped from one real roastery. `coffeeId` for the informational layer is resolved via `resolveBlendForSlot`'s existing priority-1-else-priority-2-else-unavailable logic, not statically pinned to the priority-1 alias row.
7. **Collaborative Flavor Wheel prominence — superseded, see #9.** An earlier draft of this project proposed elevating the Collaborative Flavor Wheel to lead and dominate the revealed card. Dana reconsidered: Bloom's card (Part 2) keeps the Wheel exactly where and how `CoffeesPage.tsx` shows it today — no reorder, no resize. The prominence concern is instead addressed by giving flavor intelligence its own future page (#9) and linking to it.
8. **"Liam's intake" naming** (Part 2) — confirmed with Dana. The AI-generated tasting note (`ai_summary` field) is labeled "Liam's intake" in the UI instead of a generic "AI tasting note," tying it to the site's named AI sommelier.
9. **A dedicated "flavor intelligence" page is a future project, not part of this build.** Dana's direction: `/coffees` should eventually evolve into a richer, secondary destination — more statistics, more SCA (Specialty Coffee Association) descriptor detail — reachable only if customers want to go deeper. This build's only obligation toward that future page is a link (Part 2) pointing at the current `/coffees` route as it exists today. A short context note for Liam (AI sommelier) work has been left in `backend/src/features/ai_agent_liam/NOTE_FLAVOR_INTELLIGENCE_PAGE.md` — not implemented here.

---

## Out of scope for this build (full list, shared with Part 2)

- Any changes to `TheAxis.tsx`.
- Retiring `/coffees` or `/shop`.
- Wiring real Shopify credentials.
- Any admin-side changes to how hops are created, suggested, or validated (`AdminDial.tsx`, `dialSuggestion.ts`) — Phase 1e only adds a public *read* surface over hop data that already exists.
- Building the enhanced "flavor intelligence" version of `/coffees` — Decision #9.
- Any Liam (AI sommelier) changes — noted for later, not implemented here.
- The deferred image/photo performance work — see `IMAGE_PERFORMANCE_FINDINGS.md` in this same folder.

---

## Summary checklist (Part 1)

- [ ] New `dial_slot_price` table + admin endpoints (`GET`/`PATCH /api/admin/slot-prices`) + two-price admin edit control in `AdminCoffees.tsx` (Phase 0)
- [ ] `GET /api/coffees/archetypes` — full dial vocabulary per archetype, per-weight `prices` array, `coffeeId` resolved via `resolveBlendForSlot` (not static priority-1), no roaster (Phase 1a)
- [ ] `GET /api/shop/slot-availability` — roaster-blind wrapper over `resolveBlendForSlot` (Phase 1b)
- [ ] `/:id/flavor-wheel` stops leaking `coffee_name` to public callers (Phase 1c)
- [ ] `GET /api/coffees/:coffeeId/hops` — roaster-blind Bloom Dial hop navigation, live-derived targets, capped at 3 (Phase 1e)
- [ ] Testing task above completed against real Cloud SQL data, including the stock-fallback scenario
- [ ] Confirmed: nothing in `/coffees`, `/shop`, or existing admin pages regressed
