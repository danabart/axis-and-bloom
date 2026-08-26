# Claude Code Prompt — Roastery soft-deactivation (cascade, preview, reactivation)

**Goal:** Let Dana deactivate a partner roastery from the admin portal (`/admin/roasters`) in one deliberate action that (a) marks the roastery and every one of its coffees, blends/SKUs and slot aliases inactive, (b) makes every browse / recommend / resolve surface — the public Bloom Dial, Liam, hops, Flavor Intelligence, and the admin Coffees / Blends & SKUs / Bloom Dial pages — stop retrieving them, and (c) can be reversed with a matching Reactivate action. **Nothing is ever deleted.** First real use: Temecula Coffee Roasters, which we may work with again later.

**Why this needs a build (context, not instructions):** `roaster.is_active` already exists and the Roasteries page already toggles it (the green "Active" pill is a button → `PATCH /api/admin/roasters/:id/toggle`), but **no query anywhere reads `roaster.is_active`** — flipping it today is cosmetic. The public dial goes through `resolveBlendForSlot()` (`services/blendResolver.ts`), which gates on `coffee_alias.is_active` + `roaster_blend.is_active` only. Everything else — Liam's catalog context (`services/sommelierRag.ts`), hops (`dial_coffee_relationships`), Flavor Intelligence, dial suggestions, content-generation cron, the admin Coffees / Bloom Dial pages — reads `coffees` directly, and `coffees` has **no active column** at all. `coffees.roaster` is free text (seed files contain both "Temecula Coffee Roasters" and "TEMECULA COFFEE ROASTERS"), so there is no FK from a coffee to its roastery; the only reliable link is `roaster_blend.roaster_id`. `qrDoor.ts`'s `isCoffeeRetired()` documents this gap explicitly ("Retired/inactive has no dedicated column on coffees").

**Decisions already made (Dana, 2026-08-25) — implement as stated, don't re-open:**

1. **Soft delete only.** No `DELETE` of any row. `dial_archetype_positions` (including `is_default`), `dial_coffee_relationships`, cupping history, orders, stories, `qr_universal_token`, `coffees.qr_token` all stay exactly as they are.
2. **Coffee-level truth + one cascade.** The active flag lives on the coffee (and blend, and alias), not derived at read time from the roaster. The roastery action cascades in one transaction and stamps *why* each row went inactive, so reactivation restores exactly what the cascade touched and nothing that was manually retired earlier.
3. **Dial positions untouched, filtered at read time.** The cascade never clears `is_default`; reads simply ignore inactive coffees. Reactivation restores the prior layout automatically. The preview warns which archetypes lose their default so Dana can promote a Path coffee on the Coffees page.
4. **Admin: hidden by default, "Show inactive" toggle.** Coffees, Blends & SKUs, Bloom Dial, and every coffee picker show active rows only; a small toggle reveals inactive rows greyed out for inspection or reactivation. The Roasteries page always lists every roastery with a clear Inactive state.
5. **Owned bags keep working.** Id-addressed public reads a customer can only reach from their own history — QR resolve, `/coffee/:id/story`, brew cards, order history, Liam turns about a coffee they already received — keep rendering for an inactive coffee. Only browse / recommend / resolve surfaces drop it. Positive register everywhere (see `WHAT_WE_BUILT.md` house rules): no "discontinued / removed / no longer available" copy.

---

## Task 0 — Verify current state (confirm, don't assume)

Record findings in your writeup before changing anything:

1. Confirm `coffees` has no `is_active` / `roaster_id` column (`backend/src/db/schema.sql` ~L1059 and the `ALTER TABLE coffees ADD COLUMN` block).
2. Confirm `roaster.is_active` has zero readers in `backend/src` outside `GET/PATCH /api/admin/roasters*` (`grep -rn "is_active" backend/src | grep -i roaster`).
3. In prod (Cloud SQL Auth Proxy, **read-only**):
   - `SELECT id, name, is_active FROM roaster;` — note the exact Temecula `id` and `name`.
   - `SELECT DISTINCT roaster FROM coffees;` — list every distinct spelling; any casing/whitespace variants of the two roastery names must be reported (these are what the `roaster_id` backfill in Part A has to absorb).
   - `SELECT c.id, c.name, c.roaster, COUNT(DISTINCT rb.roaster_id) AS roaster_ids FROM coffees c LEFT JOIN roaster_blend rb ON rb.coffee_id = c.id GROUP BY c.id, c.name, c.roaster HAVING COUNT(DISTINCT rb.roaster_id) <> 1;` — coffees with zero or more than one linked roastery. Zero-blend coffees fall back to name match; multi-roaster coffees are a data problem to surface to Dana, not silently resolve.
   - Row counts: `coffees`, `roaster_blend` (by `is_active`), `coffee_alias` (by `is_active`), `dial_archetype_positions`, `dial_coffee_relationships`.
4. Confirm which admin pages call `GET /api/admin/coffees` (expected: `AdminCoffees.tsx`, `AdminDial.tsx`, `AdminFlavorWheel.tsx`, `AdminSessions.tsx`) and which call `GET /api/admin/inventory` / `/inventory/coffees-lookup` (`AdminInventory.tsx`).
5. Confirm the slot-instance strategy doc (`backend/src/features/slot_instance_model/SLOT_INSTANCE_STRATEGY_V1.md`) Tasks A–D are still unexecuted (no `dial_slot_spec` table, no `userId` parameter on `resolveBlendForSlot`). If any of it shipped, keep its "not orderable = `is_active`" definition and make sure this task's predicate is the one it uses.

Do not run any write DDL/DML against prod without Dana's go-ahead in the session; `schema.sql` is applied on deploy.

---

## Part A — Schema (`backend/src/db/schema.sql`, idempotent, additive only)

```sql
-- Roastery lifecycle (2026-08-25): soft-deactivation with a stamped reason so
-- reactivation restores exactly what the cascade touched.
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS roaster_id UUID REFERENCES roaster(id);
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE coffees ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;   -- 'roaster' | 'manual' | NULL

ALTER TABLE roaster_blend ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE roaster_blend ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;
ALTER TABLE coffee_alias  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE coffee_alias  ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;

ALTER TABLE roaster ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE roaster ADD COLUMN IF NOT EXISTS deactivation_note TEXT;     -- free text Dana types in the confirm dialog

CREATE INDEX IF NOT EXISTS coffees_roaster_id_idx ON coffees(roaster_id);
CREATE INDEX IF NOT EXISTS coffees_is_active_idx  ON coffees(is_active);
```

Add CHECK constraints (in the same `DO $$ ... EXCEPTION WHEN duplicate_object` pattern the file already uses) so `deactivation_reason IN ('roaster','manual')` when not null.

**Backfill `coffees.roaster_id`** (runs on every deploy, only touches NULL rows — same pattern as the existing `roaster_blend.coffee_id` name-match backfill directly above `roastery_blend_vector`):

1. From `roaster_blend`: `UPDATE coffees c SET roaster_id = sub.roaster_id FROM (SELECT coffee_id, MIN(roaster_id::text)::uuid AS roaster_id FROM roaster_blend WHERE roaster_id IS NOT NULL GROUP BY coffee_id HAVING COUNT(DISTINCT roaster_id) = 1) sub WHERE c.id = sub.coffee_id AND c.roaster_id IS NULL;`
2. Then by name, case/whitespace-insensitive: `... WHERE c.roaster_id IS NULL AND lower(trim(c.roaster)) = lower(trim(r.name))`.
3. Log (server `console.warn` at startup, same style as the `[bloom/archetypes]` warnings) any coffee still `roaster_id IS NULL` after both passes — surface them, never guess.

`coffees.roaster` (text) stays as-is; it is still read by content generation and the story specificity check. Do not remove or rewrite it.

**Views:** `v_dial_positions` (schema.sql ~L2838) gains `coffee_is_active` (from `coffees.is_active`). Any other view that lists coffees for browsing (check `v_dial_navigation` and the Flavor Intelligence views) gains the same column; do **not** filter inside the views — filtering is the query's job so admin "Show inactive" can still read them.

Document every column in `WHAT_WE_BUILT_DB.md` under `coffees`, `roaster_blend`, `coffee_alias`, `roaster`, and update the "Retired has no dedicated column" note under the QR Door section — it now does.

---

## Part B — One predicate, one cascade (backend)

### B1. The shared predicate

Create `backend/src/services/activeCatalog.ts`:

```ts
// The single definition of "this coffee is part of the live catalogue".
// Every browse / recommend / resolve read composes this; nothing re-derives it.
export const ACTIVE_COFFEE_SQL = (alias = 'c') => `${alias}.is_active = true`;
export async function isCoffeeActive(coffeeId: number): Promise<boolean>;
export async function getActiveCoffeeIds(): Promise<Set<number>>;   // for the few in-memory filters (RAG, door map)
```

Keep it this small. Roaster-level state is **not** consulted at read time anywhere (Decision 2) — the cascade is what keeps `coffees.is_active` truthful. If you find yourself writing `JOIN roaster r ... r.is_active` in a read path, stop: that's the wrong layer.

### B2. Deactivate / reactivate / preview endpoints (`routes/admin.ts`, behind the existing `router.use(requireAdmin)`)

**`GET /api/admin/roasters/:id/deactivation-preview`** — read-only, no side effects. Returns what *would* happen:

```jsonc
{
  "roaster": { "id": "...", "name": "Temecula Coffee Roasters", "isActive": true },
  "coffees":  [ { "id": 31, "name": "Kopi Safari", "isActive": true, "homeArchetype": "experimental", "isDefault": true, "guestPositions": 0 }, ... ],
  "blends":   { "total": 32, "active": 32 },
  "aliases":  { "total": 16, "active": 16 },
  "slotsGoingEmpty": [ { "archetype": "experimental", "dialSortOrder": 2, "platformName": "The Unexpected" }, ... ],
      // slots where, after removing this roastery's coffees, resolveBlendForSlot() would return null at 12oz
  "archetypesLosingDefault": [ "experimental", "balanced_sweet", ... ],
      // archetypes whose current is_default (non-guest) coffee belongs to this roastery and no other active default remains
  "hopsGoingDark": 23,  // dial_coffee_relationships rows with from_ or to_coffee_id in this roastery's coffees
  "openOrderLines": 0,  // order_line_item → roaster_blend for this roastery on orders not yet fulfilled (use the real order status column — check orders.ts)
  "activeSubscribersOnTheseSlots": 4,  // subscribers whose current slot resolves to one of this roastery's coffees today (reuse users.ts's subscription/last-order queries; approximate is fine, say so in the response)
  "alreadyManuallyInactive": { "coffees": 0, "blends": 0, "aliases": 0 }  // rows this cascade will NOT touch (reason='manual' or already inactive)
}
```

Compute `slotsGoingEmpty` by actually calling `resolveBlendForSlot` with an **exclusion set** — add an optional `{ excludeCoffeeIds?: number[] }` parameter to it (default empty, zero behavior change for every existing caller) rather than reimplementing the resolver's candidate logic. Iterate `dial_position_vocabulary` for `is_archetype = true` archetypes plus `experimental` (same set `GET /api/coffees/archetypes` + `/experimental` present).

**`POST /api/admin/roasters/:id/deactivate`** — body `{ note?: string }`. One transaction (`const client = await db.connect(); BEGIN … COMMIT`, the pattern in `companyGiftsAdmin.ts`), in this order:

1. `UPDATE roaster SET is_active = false, deactivated_at = now(), deactivation_note = $note, updated_at = now() WHERE id = $1 AND is_active = true` — 409 if already inactive.
2. `UPDATE coffees SET is_active = false, deactivated_at = now(), deactivation_reason = 'roaster' WHERE roaster_id = $1 AND is_active = true`.
3. `UPDATE roaster_blend SET is_active = false, deactivated_at = now(), deactivation_reason = 'roaster', updated_at = now() WHERE roaster_id = $1 AND is_active = true`.
4. `UPDATE coffee_alias SET is_active = false, deactivated_at = now(), deactivation_reason = 'roaster' WHERE coffee_id IN (SELECT id FROM coffees WHERE roaster_id = $1) AND is_active = true`.
5. Rows already `is_active = false` are **skipped** (the `AND is_active = true` guard) so their existing reason is preserved — that is the whole point of the stamp.
6. Return the same shape as the preview plus `{ applied: { coffees: n, blends: n, aliases: n } }`.

The request itself is already captured by `middleware/apiEventLog.ts`; additionally emit a single `console.info('[admin/roasters deactivate]', …)` with roaster id, counts, and the admin uid from `AuthRequest`.

**`POST /api/admin/roasters/:id/reactivate`** — the exact inverse, restoring **only** rows with `deactivation_reason = 'roaster' AND deactivated_at >= roaster.deactivated_at` (so a coffee Dana manually retired *after* the roastery went inactive stays retired, and one retired *before* stays retired because its reason is `'manual'`). Clears `deactivated_at` / `deactivation_reason` on restored rows and on the roaster. 409 if already active.

**Retire the bare toggle for roasteries:** remove `PATCH /api/admin/roasters/:id/toggle` and its caller. A roaster flip without the cascade is the bug this task exists to close; don't leave the footgun in the API. (`coffee_alias` and `roaster_blend` keep their existing per-row toggles — those set `deactivation_reason = 'manual'` from now on; see B4.)

### B3. Apply the predicate to every browse / recommend / resolve read

Go through these in order; for each, add `AND c.is_active = true` (or the equivalent on the coffee join) and note it in the writeup. Where the query has no `coffees` join, add one — never gate on `roaster_blend`/`coffee_alias` alone as a proxy for coffee state.

**Public — `routes/coffees.ts`**
- `resolveBlendForSlot` and `resolveCoffeeBlend` / `computeCollectionOffer` (`services/blendResolver.ts`) — join is already there (`JOIN coffees c`), add the predicate. This alone covers `GET /archetypes`, `/experimental`, `buildSlotsForArchetype`, `/:coffeeId/hops` target resolution, and order-time verification in `orders.ts`.
- `GET /other-categories`, `/archetype-stats`, `/:id/legacy-slot` — filter. (`/archetype-order` reads `v_archetype_vectors` only — no coffee rows, leave it.)
- `GET /:coffeeId/hops` — additionally filter `dcr.to_coffee_id` targets to active coffees *before* the `hops.length >= 3` cap, so an inactive target doesn't consume one of the three slots.
- `computeDoorMap` — if it walks coffee-level hops anywhere, filter via `getActiveCoffeeIds()`.
- **Do NOT filter** `GET /:id/story`, `/:id/content`, `/:id/ai-summary`, `/:id/flavor-wheel`, `/:id/dimensions` (Decision 5). If any of these is reachable from a *browse* surface for an inactive coffee, the fix is on the browse surface, not here.

**Liam — `services/sommelierRag.ts`, `routes/sommelier.ts`**
- `BASE_COFFEE_SQL` and both archetype-picker queries (`WHERE aa.archetype = ANY(...)` / "3 most populated archetypes") — filter. Liam must never *recommend* an inactive coffee.
- Liam turns about a coffee the customer already has (`my_coffee`, `origins_process`, brew card, SMS feedback in `services/liamSmsFeedback.ts`, `services/brewCard.ts`) — keep reading by id; do not filter.
- `getAliases()` reads `coffee_alias ... is_active = true` — an inactive coffee's alias is now inactive too, so the fallback for owned-bag turns must resolve the *slot name* from `dial_slot_alias` via the coffee's `dial_archetype_positions` row (which still exists). Verify Liam can still name a customer's Temecula coffee by its house alias after deactivation; if `getAliases` returns nothing for it, extend it with that fallback rather than leaking `coffees.name` or the roaster name.

**QR Door — `services/qrDoor.ts`**
- `isCoffeeRetired(coffeeId)`: `coffees.is_active = false` **OR** no active `roaster_blend` (keep the old signal as a secondary). Update its comment — the dedicated column now exists. The existing "moved on — here's its closest relative" path must pick an *active* relative (filter the nearest-hop query).
- `UNIVERSAL_QR_SOURCES` stays `['path','temecula']` — printed bags exist; a Temecula universal token must keep resolving through order history (Decision 5). Add a test asserting that.

**Cron / content — `routes/cron.ts`, `generateAndStoreAllContent` callers**
- Any bulk loop over coffees (content backfill/regenerate, dial consensus recompute, beat engine catalogue scans in `services/beatEngine.ts`) — skip inactive coffees. Per-coffee admin `refresh-content` by id still works (an admin may want to prep a coffee before reactivating).

**Dial services — `services/dialSuggestion.ts`**
- `getDialSuggestion` and the hop-suggestion queries — exclude inactive coffees as "other coffee" candidates.

**Quiz / reveal / emails** — grep `routes/quiz.ts`, `features/post_quiz_welcome_email`, `features/pre_launch_reveal_in_inbox`, `features/marketing/templates` for any coffee lookup that isn't by an id the customer already owns; filter those.

### B4. Admin reads (`routes/admin.ts`) — `?include_inactive=true` opt-in

Every admin list below defaults to active only and accepts `include_inactive=true`; when included, rows carry `is_active`, `deactivated_at`, `deactivation_reason` so the UI can grey them.

- `GET /coffees` — add `c.is_active, c.deactivated_at, c.deactivation_reason, c.roaster_id, r.name AS roaster_name` (LEFT JOIN roaster). Default `WHERE c.is_active = true`.
- `GET /inventory`, `GET /inventory/coffees-lookup` — default to `rb.is_active = true AND c.is_active = true`; the lookup (used to assign an unmatched blend to a coffee) lists active coffees only.
- `GET /coffee-alias`, `GET /dial/positions`, `GET /dial/graph` (`positions`, `unplaced`, and `relationships` whose either end is inactive), `GET /dial/hop-suggestions`, `GET /dial/navigation`, `GET /sessions/:id/coffees` picker source, `GET /flavor-wheel/:coffeeId` list callers, `GET /coffee-prices`, `GET /dial/consensus/:coffeeId` — same rule. For `/dial/graph`, inactive positions/relationships are **omitted** by default and returned with `isActive:false` when included (Map renders them dashed/grey — see Part C).
- `PATCH /coffee-alias/:id` and `PATCH /inventory/:id` (the existing per-row active toggles) — when they set `is_active=false`, stamp `deactivation_reason='manual', deactivated_at=now()`; when `true`, clear both.
- `PATCH /dial/positions/:id`, `POST /dial/positions`, `POST /dial/positions/guest`, `POST /coffees/:id/archetype`, `POST /dial/relationships` — reject (409, positive message: "This coffee is currently inactive — reactivate its roastery on the Roasteries page first") when the target coffee is inactive. Never let an inactive coffee be promoted to default.
- `GET /roasters` — unchanged list (always every roastery), add `deactivated_at`, `deactivation_note`, and per-roaster counts `{ coffees, activeCoffees, blends, activeBlends }`.
- `DELETE /coffees/:id` — leave as-is (pre-existing hard delete; out of scope), but add a one-line comment pointing at the soft path.

---

## Part C — Admin UI (frontend)

Reuse existing components/hooks; do not reimplement fetch wrappers, error surfaces (`reportError`), or the greyed-row treatment if one exists (check `AdminInventory.tsx` for how inactive blends render today and match it).

### C1. `AdminRoasters.tsx`
- Replace the "Active/Inactive" pill-button with a **status badge** (not clickable) plus, per row:
  - Active roastery → `Deactivate…` button (secondary style).
  - Inactive roastery → `Reactivate` button + the badge shows `Inactive since {date}` and the note on hover/expand.
- `Deactivate…` opens a confirm dialog that first fetches `deactivation-preview` and renders it as plain statements, e.g. "16 coffees, 32 blends and 16 slot aliases will be marked inactive. 6 dial slots will have no coffee until another roastery fills them: Experimental · The Unexpected, …. 3 archetypes will need a new default: Experimental, Floral, Fruity. 23 hops will pause. 4 subscribers currently receive a coffee from this roastery." Then an optional note field and a confirm button labelled `Deactivate {roaster name}`. Keep the whole dialog in positive/neutral register; it's admin-facing, but the copy still lives in the repo.
- On success, reload the list and show a one-line summary with a link to `/admin/coffees` ("Review defaults on the Coffees page →") when `archetypesLosingDefault` is non-empty.
- `Reactivate` uses the same dialog pattern (preview endpoint accepts `?direction=reactivate` and reports what would be restored) — small addition to B2, do it.

### C2. `AdminCoffees.tsx`, `AdminInventory.tsx`, `AdminDial.tsx`, `AdminFlavorWheel.tsx`, `AdminSessions.tsx` (and `AdminCupping.tsx` if it has a coffee picker)
- Add one shared `ShowInactiveToggle` (small checkbox/switch, "Show inactive", right-aligned in the page header; persist the choice in component state only — no storage). When on, the page refetches with `include_inactive=true`.
- Inactive rows: greyed text, an `Inactive · {roaster name}` chip, edit controls disabled except a `Reactivate roastery →` link to `/admin/roasters`. On the Bloom Dial Map/Journey, inactive coffees render as dashed, desaturated nodes and their hops as dashed edges; in Journey mode they never appear as moves.
- Coffees page: the roaster column reads from `roaster_name` (FK) with `coffees.roaster` text as fallback, and shows a subtle warning glyph when `roaster_id` is null ("No roastery linked") so the Task 0 leftovers are visible in the UI, not just server logs.
- Blends & SKUs: default view hides inactive blends; with the toggle on, rows from an inactive roastery show the chip and the per-row toggle is disabled (they come back only via Reactivate).

### C3. Public frontend
No new UI. Verify by eye after deploy: The Bloom (each archetype dial + Experimental box), Flavor Intelligence, Find My Flavor result, Liam's opening suggestions. Empty slots must render whatever the existing empty-slot state already is (`isActive:false` from `/archetypes` → the existing "Unpriced"/unavailable treatment in `PositionCard.tsx`); do not invent a new empty-slot copy in this task. If the existing empty-slot copy names what's missing in a negative register, flag it in the writeup for Dana rather than rewriting it here.

---

## Part D — Tests

- `services/activeCatalog.test.ts` — predicate + `getActiveCoffeeIds`.
- `routes/admin.roasters.test.ts` — preview is side-effect free; deactivate cascades exactly the roastery's rows and skips already-inactive/manual rows; reactivate restores only `reason='roaster'` rows stamped at/after the roastery's `deactivated_at`; second deactivate → 409; `toggle` route is gone (404).
- `blendResolver` — with a coffee inactive, `resolveBlendForSlot` skips it even when its `roaster_blend` row is still active (the two flags are independent by design; the cascade keeps them in sync, the resolver trusts neither alone).
- `coffees.test.ts` — `/archetypes` omits inactive coffees; `/:id/story` still serves an inactive coffee; `/:coffeeId/hops` never returns an inactive target and still returns up to 3 active ones when available.
- `sommelierRag` — RAG candidate set excludes inactive coffees; `getAliases` still resolves a house name for an inactive coffee the customer owns.
- `qrDoor` — `isCoffeeRetired` true for `is_active=false`; Temecula universal token still resolves for a profile with a Temecula order line.

---

## Part E — Rollout for Temecula (do not execute without Dana in the session)

1. Deploy. On startup, confirm the `roaster_id` backfill warning list is empty (or hand Dana the exact coffee ids that need a manual link).
2. Open `/admin/roasters` → Temecula → `Deactivate…` and **paste the preview into the writeup** (slots going empty, archetypes losing default, hop count, subscriber count). Stop there.
3. Dana confirms in the UI herself. After that: `/admin/coffees` to set new defaults for the archetypes listed; check the five dials + Experimental on The Bloom; ask Liam for a recommendation in each archetype; scan a Temecula bag's universal QR against a test profile with a Temecula order to confirm it still resolves.
4. Verify reactivate on a staging/dev DB (not prod) restores the exact prior state — row-for-row diff of `coffees`, `roaster_blend`, `coffee_alias` before and after.

---

## Part F — Documentation

- `WHAT_WE_BUILT.md`: new numbered entry "Roastery soft-deactivation" — the why (nothing read `roaster.is_active`; `coffees` had no active column), the cascade order, the reason stamp, the preview, what stays reachable for owned bags, and the retirement of the bare toggle.
- `WHAT_WE_BUILT_DB.md`: columns in Part A; update the "Retired has no dedicated column" note under QR Door; add a line under `roaster` explaining that `roaster.is_active` is written only by deactivate/reactivate and read by nothing at request time (by design).
- `backend/src/features/slot_instance_model/SLOT_INSTANCE_STRATEGY_V1.md` §9 "not orderable" open decision: append a one-line note that `coffees.is_active` (this task) is now the coffee-level definition and `deactivation_reason='manual'` is the deliberate per-coffee switch the doc anticipated.
- `REGRESSION.md`: add the scenario "deactivate a roastery → dial, Liam, hops, admin lists drop its coffees; owned-bag QR/story still resolve; reactivate restores the prior layout".

**Writeup at the end:** Task 0 findings, every query you touched (file:line), the Temecula preview output, anything you found that reads coffees for browsing and is *not* on the B3 list, and any place where existing copy would name what's missing in a negative register.
