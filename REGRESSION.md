# Regression Checklist

Living checklist of behaviors that must keep working across future changes. Created by HOME Task 9 (2026-08-04) — see `SOMMELIER_BUILT.md`'s HOME Task 9 (S88) entry for the full verification report this checklist summarizes.

## home_v3 — Liam launch machinery

### Six-intent evaluator
- [ ] `DISCOVERY_SEEKER` fires on `experimental: true` (latest quiz).
- [ ] `PROFILE_AMBIGUOUS` fires on `quizTie: true`, `recommendationMode === 'ai_agent'`, or `foodSignalAlignment === 'low'`.
- [ ] `TASTE_EVOLUTION` fires when archetype changed across the last two quizzes.
- [ ] `RECOMMENDATION_MISS` fires on a real, non-superseded negative `feedback_events` doc within the lookback window. **Requires the `feedback_events` (`sentiment` ASC + `createdAt` ASC) Firestore composite index — confirm it still exists (`gcloud firestore indexes composite list --project=axis-and-bloom-prod --database=axis-bloom-fs`) before trusting this row; it silently returned `false` for the entire life of this intent until HOME Task 9 found and fixed it.**
- [ ] `CONVERSION` fires on `behavioralLevel !== 'low' && totalOrders === 0`.
- [ ] `EXPLORATION` fires on `userInitiated`/`browsingSignal` when no higher-priority intent also matches — note `CONVERSION` sits above it in `evaluatorRulePriority`, so a fresh zero-order test account will hit `CONVERSION` first; isolate with a real order when testing `EXPLORATION` specifically.
- [ ] `evaluatorRulePriority` order matches `SOMMELIER_BUILT.md`'s own documented table.

### RAG (`fetchSommelierCoffees`)
- [ ] All six focus types (`archetype_range`, `alternatives`, `evolution_bridge`, `discovery`, `exact_match`, `curated_mix`) return a non-empty catalog against realistic inputs. Standing pre-launch check per S84/7d — run before every launch-adjacent change to `sommelierRag.ts`, the RAG-focus config, or `archetype_assignments`.
- [ ] `catalogText` content is sane, not just non-empty — spot-check for cached AI refusals or stale-name leaks in `ai_summary`/`surprise_note` (the coffee-32/18/22 class of bug HOME Task 9 found; there is no automated check for this yet).
- [ ] `alternatives`/`archetype_range` correctly widen beyond the primary archetype when `archetype_relationship` has real adjacency data — **currently flagged empty in production (0 rows)**, silently degrading both to single-archetype-only; not yet fixed.

### Mode-aware system-prompt assembly (`assembleSystemPrompt`)
- [ ] Matching mode's `LIAM_BASE_PROMPT` core (Tone, Opening-turn, model routing, `200`-token default) stays byte-for-byte identical to the pre-home_v3 baseline (commit `d4e9911`) plus only the documented deliberate additions (Guardrails, Remembering-facts, Brew cards sections).
- [ ] Expertise mode: catalog omitted (or story injected in its place on `my_coffee`/`origins_process` topics), numbers carve-out present, banned technical vocabulary (`percolation`, `extraction yield`, `TDS`) absent.
- [ ] Topic stickiness carries a detected topic forward for `stickyDecayTurns` turns (seed 2), including across a session **resume** boundary, not just within one continuous session.
- [ ] `brewProfileContext`/`currentCoffeeContext`/`storyContext` are all absent-by-default (undefined params produce zero prompt difference) and only appear when their respective conditions are met.

### Beats (`beatEngine.ts`)
- [ ] `dispatchOrderPlacedBeat()` + `dispatchDelayedBeats()` are idempotent per `(user_id, order_id, beat_type)` — re-firing for the same order is a no-op, never a duplicate.
- [ ] Repeat-coffee orders correctly skip `dial_in` (`skip_reason: 'repeat_coffee'`) while `arrival_note` stays active.
- [ ] Degrade-on-silence drops `dial_in` after a low trailing response rate, never drops `arrival_note`.
- [ ] No legacy `sommelier_sms_feedback` row is ever scheduled alongside the beat engine (the supersede cutover) for any post-HOME_TASK_8 order.
- [ ] `beats.smsEnabled` stays `false` until Dana explicitly flips it (OT-17) — confirm live before and after any pass that touches config.

### Brew cards
- [ ] `<<card:save>>`/`<<card:adjust=KEY>>` markers are stripped from every visible reply regardless of validity.
- [ ] An adjustment bumps `revision`, updates the relevant `params` field, and records `last_adjustment_reason` verbatim.
- [ ] `GET /api/users/flavor-memory` reflects a card update immediately (no caching lag).
- [ ] A brew-card render logs a `brew_card_view_event` row (new in HOME Task 9 — Task 6 never built this; confirm it doesn't get silently dropped in a future refactor of the flavor-memory endpoint).

### QR (`/b/:token` → `GET /api/qr/:token/resolve`)
- [ ] Universal token: signed-out → `sign_in`; signed-in customer (personal order or sponsorship) → `profile`; signed-in non-customer → `quiz`.
- [ ] Legacy per-coffee tokens keep resolving (never a 404) even though nothing prints or links them anymore.
- [ ] A retired coffee's legacy token resolves `status: retired` with a `displayName`; `nearestHopCoffeeId` is `null` for coffees with no real outgoing hop in the graph — that's a data fact, not a bug.
- [ ] `isRealSignIn = !!req.uid && !req.isAnonymous` — an anonymous Firebase session must never read as signed-in.
- [ ] Every resolve logs exactly one `qr_scan_event` row with the correct `token_type`/`source`/`auth_state`/`destination`.

### Guards (Task 3)
- [ ] `tokenEconomy.gatingEnabled: false` — a zero-balance account can still start and continue a session.
- [ ] `guards.dailyTurnCap` blocks a new `/start` once hit, with the exact fixed Liam-voiced close line (never a model call).
- [ ] The daily-cap query correctly excludes token_events from a prior day (the day-boundary test, re-verified HOME Task 9).

### Memory / brew profile (Task 4)
- [ ] `<<remember:field=value>>` only accepts the five whitelisted field names; an unknown/malformed field is dropped and counted in `admin_stats/brew_profile.failures`, never written.
- [ ] Up to `brewProfile.maxMarkersPerTurn` (seed 2) markers collected per turn; excess is dropped from collection but still stripped from the visible reply.
- [ ] A write is visible in the Firestore doc within the same turn (read-back test).

## Roastery lifecycle (2026-08-25) — see `WHAT_WE_BUILT.md` #170

- [ ] Deactivating a roastery (`POST /api/admin/roasters/:id/deactivate`) cascades `is_active=false` to exactly that roastery's `coffees`/`roaster_blend`/`coffee_alias` rows, stamps `deactivation_reason='roaster'`, and skips (never overwrites) any row already inactive with `reason='manual'`.
- [ ] After deactivation: the public dial (`GET /archetypes`, `/experimental`), Liam's RAG candidate pool, `GET /:coffeeId/hops` targets, and every admin list (`GET /coffees`, `/inventory`, `/coffee-alias`, `/dial/graph`, `/dial/positions`, `/dial/navigation`) drop the roastery's coffees by default — `?include_inactive=true` (admin only) brings them back greyed.
- [ ] Owned-bag surfaces keep working for an inactive coffee: `/coffee/:id/story`, QR resolve (per-coffee and the universal token) for a customer who already has that coffee, Liam turns about a coffee the customer already owns (`getAliases()`'s `dial_slot_alias` fallback must still resolve a name), order history, brew cards.
- [ ] Reactivating (`POST .../reactivate`) restores exactly the rows stamped `reason='roaster'` at/after the roastery's own `deactivated_at` — a coffee manually retired before or after stays retired, dial positions/defaults come back exactly as they were (the cascade never touches `is_default` or `dial_archetype_positions`).
- [ ] `PATCH /api/admin/roasters/:id/toggle` no longer exists (404) — the only way to change a roastery's active state is the deactivate/reactivate cascade.
- [ ] `coffees_active_natural_key` rejects two active coffees sharing the same `(roaster_id, lower(trim(name)))` — same name across two different roasters, or the same name with one side inactive, must both still succeed. The `roaster_blend.coffee_id` name-match backfill requires `rb.roaster_id = c.roaster_id`, never an unqualified name-only match.
- [ ] `GET /api/axis/stats` and `/adjacency` exclude an inactive coffee from every count/pair (`coffeesMapped`, per-archetype `coffeeCount`, `connectionCount`, `regionAdjacency`/`adjacency`) — confirm without assuming `v_archetype_adjacency` itself changed (it's deliberately still unfiltered for Liam's RAG and the Bloom Dial admin page).

## Known-fragile spots (regression-test these first after any related change)

- Any new Firestore query combining an equality filter with a range filter or an `orderBy` on a different field **will silently return nothing if its composite index doesn't exist** — the query throws, and every call site in this codebase catches broadly. Check `gcloud firestore indexes composite list` after adding one, don't assume it "just works" because `tsc` and a happy-path unit test pass.
- `getAdjacentArchetypes()` — an empty result set from `archetype_relationship` is treated identically to "no adjacency data," not as an error; it will never trigger the hardcoded fallback map.

## Commerce — Stripe one-time checkout (Commerce 1, 2026-10-31)

Test mode until Commerce brief 4. Stripe test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 0002` (decline), `4000 0025 0000 3155` (3D Secure). Full record: `backend/src/features/commerce/CLOSING_REPORT_1.md`.

- [ ] **Success**: cart → `/checkout` → pay with 4242 → exactly one `"order"` row, its lines, a `paid` + `finalized` `order_event`, one admin new-order email, one customer confirmation email; `/checkout/return` shows Liam's line (or the fallback) and the cart empties; Profile → Orders shows "Paid · being roasted" and the real total (dollars, not 1/100).
- [ ] **Decline**: 4000…0002 → Stripe shows the decline inline, no order, the session expires (`checkout_session.status = expired` after the expiry window).
- [ ] **Replay**: resend `checkout.session.completed` from the Dashboard → 200 `duplicate: true`, no second order, no second email (`stripe_event` ledger + `order_event_one_finalized`).
- [ ] **Shipping from data**: 1 bag → `shipping_fee_cents`; `free_shipping_min_bags` bags → free; change `shipping_fee_cents` on `/admin/commerce` → the next checkout charges it, no deploy.
- [ ] **No roaster name** on the Stripe form, the return page, the customer email or Profile (the admin email is the only place the roaster coffee appears).
- [ ] `POST /api/orders` answers 410 `use_checkout`; nothing but `checkoutService` writes `"order"` / `order_line_item` / `order_event` (`npm run lint:lineage`).
- [ ] Boot log shows `[stripe] mode=test` (never `live` before brief 4).
- [ ] **Header cart** (Checkout UX 1): the icon opens the drawer on every page with the nav, the badge matches the floating button, both are hidden while gated.
- [ ] **Return page**: `/checkout/return` with no `?preview=true` shows the confirmation signed in, and goes to `/sign-in` with `session_id` kept when signed out; never the curtain.
- [ ] **One host**: apex and `.web.app` addresses replace themselves with `www`, keeping path, query and hash; `/b/:token` and `/roastery/:token` still open.
- [ ] **Quiz name screen**: signed in shows "Signed in as …" and no sign-in link; a guest sees the link and no line.

## Commerce — subscriptions (Commerce 2, 2026-10-31)

Test mode until Commerce brief 4. Full record: `backend/src/features/commerce/CLOSING_REPORT_2.md`. Renewals are Stripe one-off invoices our daily job (`GET /api/cron/subscription-daily`, Cloud Scheduler `subscription-daily`) creates; the `invoice.paid` webhook writes the order.

- [ ] **Subscribe**: cart → "Make it a subscription" → frequency (2/4/6 weeks from `/api/checkout/rules`) → the cart and `/checkout` show the server-quoted price (5% one bag, 10% two or more; never the collection discount on top) → pay with 4242 → one order with `is_subscription`, a `subscription` `active` with `next_delivery_date` = today + N weeks, `started` event; the return page says "Next delivery <date>, every N weeks"; Profile → Orders shows "Your subscription".
- [ ] **Subscription renewal ships current dial position**: turn the Bloom Dial for the subscription's archetype → the next renewal order's line is that position's house name and price; with `subscription_ships_current_dial_position` = 0 it is the signup slot.
- [ ] **Renewal cron is idempotent**: run `subscription-daily` twice the same day → one Stripe invoice, one renewal order (`order_kind = subscription_renewal`), both emails once, `next_delivery_date` advanced by the webhook.
- [ ] **Declined renewal**: past_due, one "About your next delivery" email per Stripe attempt, no order, the invoice stays open for Stripe's retries; Liam access and the SUBSCRIBER stage stay (past_due counts); after `subscription_past_due_lapse_days` the job lapses it and voids the invoice.
- [ ] **Upcoming notice**: `subscription_upcoming_notice_days` before a delivery, one email with the coffee lined up; a second run sends none.
- [ ] **Company gift unchanged**: redeeming a code creates an `active` sponsored subscription (kind `sponsored`); the sponsored-subscription check lapses it at expiry with the same email.
- [ ] Nothing but `subscriptionService` writes `subscription` / `subscription_item` / `subscription_event` (`npm run lint:lineage`).