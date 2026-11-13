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
- [ ] **Tax switch off**: no Stripe Tax call, order taxes 0 (`tax_collection_enabled` = 0 since 2026-10-31: the Stripe session and renewal invoice show automatic tax disabled, `"order".taxes_collected` = 0).
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

## Commerce — admin and self-service (Commerce 3, 2026-11-01)

Test mode until Commerce brief 4. Full record: `backend/src/features/commerce/CLOSING_REPORT_3.md`.

- [ ] **Customer skip/pause/cancel** (Profile → subscription panel): change frequency 2→4 weeks → next date unchanged, `frequency_changed` event, one email. Skip → `skip_requested`, Profile shows the cycle after; a second skip answers "already skipped"; on the skipped date the daily job records `renewal_skipped_skip`, charges nothing, advances the date. Pause (date within `subscription_pause_max_weeks`) → `paused`, Profile shows the resume date; Resume → `resumed`, next date rescheduled if it fell inside the pause; a pause whose date passed is resumed by the daily job (`source = cron`). Cancel → `canceled`, open renewal invoice voided, Liam access gone, one email.
- [ ] **Update card**: on a past_due subscription, "Update your card" (Profile, or the payment-trouble email link) → setup-mode Checkout → `payment_method_updated`; the open invoice is paid with the new card, `invoice.paid` writes one renewal order, status back to `active`. A card that declines after saving (`4000 0000 0000 0341`) leaves it past_due with the card saved.
- [ ] **Refund partial/full** (`/admin/orders` drawer): a partial refund → Stripe refund, then `refund_partial` with the reason and the cents on `v_order_status`, fulfillment unchanged. A full refund on an `awaiting_manual` order → `refund_full` + `canceled` (source webhook), never on the click; a full refund on a shipped order does not cancel.
- [ ] **Mark shipped email**: carrier + tracking number → one `roastery_shipment_details` row, a `shipped` event, one customer email with a working tracking link; submitting the same number again changes nothing; Profile → Orders shows "On its way" and the link. No roaster name in the email or on Profile.
- [ ] **Retry fulfillment** on a `needs_attention` order → `fulfillment_dispatched` (source admin), status `awaiting_manual`; the admin new-order email is not sent twice.
- [ ] **Admin new-order email** shows the customer's name, email and a link that opens `/admin/orders/<id>`.
- [ ] Nothing but `shipmentService` writes `roastery_shipment_details` (`npm run lint:lineage`).
## Website chrome — header, Menu overlay, footer (Website 1, 2026-11-04)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_1.md`. Unit cases: `frontend/src/app/components/chrome/chrome.test.tsx` (`cd frontend && npm test`).

- [ ] **Auth state in the header:** signed out (incl. anonymous guest) → `Sign in`; signed in → `Profile · Sign out`; Sign out lands on `/`. Below 480px the same links sit in the Menu overlay's foot row.
- [ ] **Admin:** `Admin` shows for admins only, never while gated.
- [ ] **Live cart count:** `Cart (n)` = sum of quantities in the cart, updates on add/remove, opens the drawer (until `CART_PAGE_ROUTE_EXISTS` is flipped by Website 8, then links to `/cart` with a glyph button for the drawer).
- [ ] **Gated set:** with `VITE_PRELAUNCH_MODE` on and no `?preview=true`, the menu lists only Find my flavor; no cart in header, overlay or footer; footer site links only Find My Flavor; `/` still shows only the curtain.
- [ ] **Overlay a11y:** Menu has `aria-expanded`/`aria-controls="siteMenu"`; open → focus inside, Tab/Shift+Tab wrap, body scroll locked, Escape or outside click or Close closes, focus returns to Menu, route change closes. The closed overlay is not in the tab order.
- [ ] **Footer newsletter:** posts `source: 'footer'`, shows "You're on the list.", inline error on failure; `newsletter_subscriber.source_id` = the `footer` row.
- [ ] **Footer links:** Liam only with `hasLiamAccess`; Terms/Privacy are real routes; Instagram opens the profile (not `/ig`, which carries campaign attribution); year is the current year.
- [ ] **Home `[data-hero]`:** the header floats over the hero in paper; Liam's chat sits below the header (`--ab-header-h`), The Bloom jump-nav sticks at the top edge.

## Website presentation data (Website 2, 2026-11-04)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_2.md`. Tests: `backend/src/services/websitePresentation.test.ts`.

- [ ] **`GET /api/coffees/cards`:** five families in `sort_order`, each with `customerWords` and four slot cards; `other` holds the category coffees. A card with no hint / milk / brew / origin / photo has no such key (never a placeholder).
- [ ] **No roaster or award text in any card:** `hasAward` is a boolean; no `tags`, no award remark, no roaster name, no raw coffee name (an unslotted category coffee has `platformName: null`).
- [ ] **Collection price:** `collectionOffer.discountedCents = round(sumCents × (1 − collection_discount_pct / 100))`, null below `collection_min_members`.
- [ ] **Milk and leads in cup:** our choice first, else the roaster's submitted answer; leads falls back to the highest pooled midpoint among the portal's active dimensions.
- [ ] **`GET /api/home/content`:** facts are counted (main-quiz questions, cupped numeric dimensions, families), quotes are the active `marketing_home_quote` rows in order, featured is the `home_featured_slot` slot with its anchor price; no timing or freshness text.
- [ ] **`GET /api/coffees/archetypes`:** every family carries `customerWords` (three words), experimental null.
- [ ] **Admin:** Coffees → Edit shows "Customer card"; saving writes one `coffee_presentation` row and a `catalog_change` row; saving again unchanged writes nothing.

## Homepage (Website 3, 2026-11-05)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_3.md`. Tests: `frontend/src/app/components/home/home.test.tsx`.

- [ ] **Lifecycle CTA:** a signed-in customer (or a guest with a stage) sees, in section 03, their stage's headline and link (shop matches / subscription / reorder / what's new / welcome back). `NEW_NO_QUIZ` and signed-out visitors see the quiz invite.
- [ ] **Feedback nudge:** with a pending order feedback, `OrderFeedbackForm` shows above the 03 headline; "Not now" hides it for 14 days.
- [ ] **Gift widget:** `CompanyGiftRedemption` sits directly under section 03; redeeming a code refreshes the stage.
- [ ] **Name prefill:** typing a first name in 03, then opening Find my flavor (by any link), starts the quiz with that name.
- [ ] **Data, not copy:** facts, "Take the {n}-question quiz", "Answer {n} questions", "{n} dimensions · {min}–{max}", family numbers and words, quotes and the "This week" coffee and price all come from the API. No "seven" anywhere.
- [ ] **Prelaunch:** `/` is the curtain while gated; Home's gated branch hides the featured cart, Liam and Shop links, and family panels lead to the quiz.
- [ ] **390px:** no horizontal scroll; family panels scroll sideways; the menu row stacks.

## Shop all (Website 4, 2026-11-05)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_4.md`. Tests: `frontend/src/app/components/shop/shop.test.tsx`, `backend/src/services/websiteShop.test.ts`.

- [ ] **Anchors:** `/shop#floral`, `#fruity`, `#balanced_sweet`, `#chocolate_nutty`, `#earthy` (Home's family panels) land on that family; `/shop` links from Home's lifecycle CTAs, the menu, Profile and admin still open the page.
- [ ] **Your family first:** a customer with a known family sees it first, labelled "Your family", while the toggle is on (remembered per browser); off = `sort_order`. Anonymous visitors see "Find your family first →" to the quiz.
- [ ] **Card states:** a row with no value is absent. "Price coming" (unpriced) and "Coming soon" (no coffee, or no roaster can fill it now) cannot be added. Add to cart opens the drawer, and a signed-in add moves the dial (`trigger: add_to_cart`, source `shop`). "Add the collection ↗" adds the backend's collection offer.
- [ ] **No roaster or award names:** "Premium ★" is the only award sign; no roaster name, award name or raw `coffees.name` anywhere on the page.
- [ ] **OT-70:** a category coffee shows its category customer name (else its home slot name) on Shop all and The Bloom; with neither, it is not listed.
- [ ] **Prelaunch:** `/shop` stays behind the gate; the gated branch hides prices, cart links and the collection row.

## The Bloom (Website 5, 2026-11-05)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_5.md`. Tests: `frontend/src/app/components/bloom/bloom.test.tsx`, `backend/src/routes/users.dialPosition.test.ts`, `backend/src/db/coffeePresentation2.test.ts` (comfort zone).

- [ ] **Silent auto-save + pre-set:** a signed-in turn writes `user_bloom_dial_current_position` only (no trigger); the wheel reopens on the saved stop; a deep-linked slot wins over the saved one.
- [ ] **Save to flavor memory:** signed in, real slot: `explicit_save`, source `bloom`, then "View in flavor memory ↗" to `/profile?tab=memory`.
- [ ] **Add to cart:** the payload price, the drawer, `add_to_cart` source `bloom` (field button, lineup cards, classic quick pick).
- [ ] **States:** weight chips with more than one price; "Price coming", "Temporarily unavailable", "Coming soon" cannot be added; the shipping line comes from `GET /api/checkout/rules`.
- [ ] **Quick picks:** the classic and the Collection (the discount from the offer, never typed); hidden while gated.
- [ ] **Compare** opens from the reveal ("Compare with the neighbour").
- [ ] **Reveal:** roaster's words left, cupping bars with end words right, notes wheel collapsed; footer links; Liam only with access; Full breakdown and Ask Liam hidden while gated.
- [ ] **Comfort zone:** pill from the server `zone` (params `comfort_zone_edge_delta`, `dimension_delta_significant`), else the family level; sentence from the server; guests see "Find your flavor to see your match"; no percentage, no per-user value.
- [ ] **Tabs:** five, personalized order with YOUR / TO EXPLORE, sticky, `?archetype=` state, ←/→ between tabs.
- [ ] **Deep links:** `/bloom?archetype=fruity&slot=2` lands on the stop; Liam's and Flavor Intelligence's links still land; `?archetype=experimental&slot=n` scrolls to the Experimental group and marks the card.
- [ ] **Strip:** the 01/02/03 strip shows; the wheel's hint line hides after the first turn (`axisbloom.hasTurnedDial`) or for a customer with a saved position.
- [ ] **Other block:** Experimental cards first, then named category coffees only (OT-70).
- [ ] **Doors:** none while `DOORS_ENABLED` is false; switching it on shows "Turn the {neighbour} dial" under the Other block.
- [ ] **Wheel a11y:** keyboard-only turn (←/→/Home/End on the slider), `aria-valuetext` = the stop label, reduced motion paints without the spin.
- [ ] **Quiz result and Profile** still use the per-archetype dial (`layout` default) with their fold, ceremony and quick picks.

## The Axis (Website 6, 2026-11-05)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_6.md`. Tests: `frontend/src/app/components/axis/axis.test.tsx`, `backend/src/services/axisStats.test.ts`.

- [ ] **Live counts:** hero regions and dots = `originRegions` (sellable coffees per region; regions with none absent; none at all = the hero full width); 03 wheel segments = `archetypes[].coffeeCount`, hollow = `experimentalCount`; 04 ends on "{n} Bloom Notes this month · {n} positions refined this quarter"; "Map last tightened {date}" (UTC calendar date). On a stats error the live lines hide.
- [ ] **Focus param:** `/the-axis?archetype=floral` highlights Floral's band and list item and scrolls to 02 (profile links use it).
- [ ] **Families:** five bands and list items in `sort_order`, each with its three words; hovering or focusing a list item opens its band.
- [ ] **Liam copy:** "What Liam can and can't see" holds the live answer ("…he never invents a coffee. If he suggests a step, that step exists."), never a placeholder.
- [ ] **Competitive safety:** no scale, dimension name, formula, weight, coffee name or roaster on the page; `/api/axis/stats` carries aggregates only.
- [ ] **Accordions:** buttons (Enter/Space), `aria-expanded`, `aria-controls`.
- [ ] **Reduced motion:** dots and wheel segments shown without animation.
- [ ] **Prelaunch:** `/the-axis` stays behind the gate.
- [ ] **The Bloom opening stop (B2):** with no saved position or deep link a family opens on its classic when sellable, else the nearest sellable stop (lower on a tie).

## Find my flavor: entry and questions (Website 7A, 2026-11-06)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_7A.md`. Tests: `frontend/src/app/components/quiz/quiz.test.tsx`, `backend/src/db/quizSceneImage.test.ts`.

- [ ] **Funnel names and payloads:**
  - `QuizStart` + `quiz_start` once, on the first answer of question 1;
  - `QuizComplete` + `quiz_complete` with the pre-branch score;
  - `quiz_final` with the on-screen archetype (no branch / branch / tie);
  - `EmailSubmitted` + `email_submitted` from the gate;
  - each carries `{campaign, vid}` when a campaign is active; one session key per run, renewed on retake or exit.
- [ ] **Campaign fast-start:** `?campaign=instagram|facebook` skips the entry scene (a recognized returning user still sees Welcome back).
- [ ] **Retake:** `?retake=1` from Profile resets and lands on question 1; "Retake the quiz" on the returning-user scene does the same.
- [ ] **Returning user:** signed in with a match → Welcome back + the saved archetype + retake on the entry photo; the folded dial, Worth exploring and the link row below.
- [ ] **Sealed ending (prelaunch):** a finished quiz shows only the email card / "It's on its way to {email}"; the returning user sees "Your match is waiting".
- [ ] **Back / keyboard:** "← Back" from question 2 keeps the earlier answer; letter keys A… pick; ↑/↓ move between rows; Enter/Space pick; a keyboard-only run completes.
- [ ] **Counts are data:** "{N} questions" on the entry and "0n / 0N" plus N progress segments come from `GET /api/quiz/questions`; the branch reads "One more".
- [ ] **Exit ×:** with answers it asks in the design's dialog (Keep going / Leave); without answers it returns straight to the entry scene. Never `window.confirm`.
- [ ] **Photos:** each question's photo is `quiz_question.image_asset_key`; until uploaded, the current quiz photo shows.
- [ ] **Reduced motion:** the scene photo does not drift.

## Find my flavor: the result scene (Website 7B, 2026-11-06)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_7B.md`. Tests: `frontend/src/app/components/quiz/result.test.tsx`, `quiz.test.tsx`.

- [ ] **Hero from data:** "{Name}'s family of taste" (or "Your family of taste"), "{Family}.", the three customer words, "Your place on the dial: stop N — {label}" and "— next to {coffee}" only when that stop has a coffee. No percentage, description or why line anywhere on the result.
- [ ] **Turn the dial:** the button's href is `/bloom?archetype=<family>&slot=<stop>`; a click scrolls to the field (or the gate, before it unlocks) and the field opens on the hero's stop.
- [ ] **Ask Liam why:** hidden while gated; signed out → `/sign-in?redirect=/sommelier`; signed in with access → `/sommelier`; without access hidden.
- [ ] **Gate:** a first-time guest sees the email card under the share row and no dial; a recognized guest sees the masked-email note; a signed-in non-subscriber sees the consent note once; subscribe payloads carry the family name as before ("Balanced", "Chocolate & Nutty"…).
- [ ] **Share row:** shown for the five families, hidden for Experimental.
- [ ] **Action row:** signed in → "Your flavor profile →" and "Back to home →"; guests → "Back to home →" only. Privacy · Terms below.
- [ ] **Preview param:** `/find-my-flavor?result=floral|fruity|balanced|chocolate|earthy|experimental` (with `?preview=true` while gated) opens each result.
- [ ] **One score per run:** a key press while scoring or during the wrap ceremony does not score, save or log again; the screen's family equals the saved `quiz_session` and `quiz_final`.
- [ ] **No quiz link on the result:** the field's "Take the quiz" line is hidden here (`hideQuizLink`), still shown on /bloom.

## Sign in and the cart page (Website 8, 2026-11-06)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_8.md`. Tests: `frontend/src/app/components/signin.test.tsx`, `cart/cart.test.tsx`, `cart/cartContext.test.tsx`, `chrome/chrome.test.tsx`.

- [ ] **Sign-in tabs:** `/sign-in` opens on Create profile; `?mode=signin` opens on Sign in; first and last name only on create; "Forgot your password?" only on Sign in.
- [ ] **Providers:** "Continue with Google" and "Continue with Apple" both sign in and land on the redirect.
- [ ] **Redirect params:** `?redirect=` is honoured after email, Google and Apple (default `/profile`); `?quiz_id` shows "← Back to results" → `/find-my-flavor`.
- [ ] **Reset and errors:** reset needs the email first, then shows the sent line; Firebase errors read in the page's words (wrong password, no account, already in use, weak password).
- [ ] **QR doors:** `/b` "I have a profile" lands on `/sign-in?mode=signin&redirect=<the /b address>` with Sign in selected.
- [ ] **Side panel:** the question count comes from `facts.questions` (never typed); its Bloom link is hidden while gated.
- [ ] **Drawer + page:** add-to-cart opens the drawer everywhere; "Cart (n)" (header, menu, footer) links `/cart`; the icon beside it opens the drawer; arriving on `/cart` closes the drawer.
- [ ] **Stepper:** −/+ change the quantity through `CartContext.setQuantity`; − at 1 removes the line; adding the same thing again merges into its line.
- [ ] **Cart summary:** subtotal, shipping (from the checkout rules), the subscribe choice and the estimated total match `/checkout`; no roasting, delivery or "calculated at checkout" text.
- [ ] **Signed-out checkout:** a signed-out visitor or guest sees "Sign in to check out" → `/sign-in?mode=signin&redirect=/checkout`; signed in → `/checkout`.
- [ ] **Gated cart:** `/cart` is behind `PrelaunchGate` (redirects to the curtain while gated, unless `?preview=true`).
- [ ] **Checkout from `/cart`:** `/cart` → `/checkout` → `/checkout/return` completes in Stripe test mode; the return page clears the cart.

## Review fixes: relationships, the wheel, no scroll (Website 9, 2026-11-06)

Full record: `backend/src/features/website_handoff/CLOSING_REPORT_9.md`. Tests: `backend/src/db/archetypeRelationships.test.ts`, `frontend/src/app/components/website9.test.tsx`, `bloom/bloom.test.tsx`, `shop/shop.test.tsx`, `home/home.test.tsx`, `signin.test.tsx`.

- [ ] **Relationship words are data:** a signed-in customer with a family sees, beside every family (The Bloom tabs, the Shop sections), the `customer_label` of its relationship from `GET /api/coffees/archetype-order`; a family with no evidence and every guest see none. No YOUR / TO EXPLORE anywhere.
- [ ] **The relationship rule:** bridge hops make a family adjacent; else its cupped-coffee profile within `dimension_delta_significant` of hers is adjacent, further is distant; profiles come from `v_archetype_dimension_profile` only (never `archetype_vector`).
- [ ] **Pill and badge words:** the comfort-zone pill and the compatibility badge read their words from the same payload (`kinds`); no stretch apology line.
- [ ] **The wheel turns like the old dial:** drag anywhere outside the centre, mouse and touch; a turn past half a circle keeps going (never flips to the other end); the centre turns nothing; the tick row drags; snap on release; arrow keys, Home and End on the slider.
- [ ] **The wheel never moves:** stepping through a family's stops at desktop width moves the wheel 0 px.
- [ ] **No scroll on a turn (D18):** wheel, bar, keys and a lineup card change the stop in place (the lineup stays still on screen); a tab click scrolls only when the field is out of view; deep links and doors still scroll.
- [ ] **A new page opens at the top** (`ScrollToTopOnNavigate`): Full profile ↗ lands on Flavor Intelligence at its title; Back keeps the browser's position; `/shop#family` still lands on its section.
- [ ] **Home 03 figure:** a customer with a family sees that family's photo; the invite (guest, `NEW_NO_QUIZ`) sees the Balanced photo.
- [ ] **No save on an empty stop:** "Save to flavor memory" only on a stop with a live coffee.
- [ ] **Drawer and `/cart` share one sign-in link** (`?mode=signin&redirect=/checkout`).
- [ ] **`/sign-in` while signed in** goes straight to the redirect (default `/profile`); an anonymous guest still sees the form.
- [ ] **Profile features** are the family's `customer_words`.
- [ ] **Old card:** "Premium ★" for an award tag; the shipping line from the checkout rules.
- [ ] **No date, no typed count** on the curtain, the gate or Crawl; `/checkout/return` states order facts only.

## Close-out: order labels, retired pages (Website 10, 2026-11-07)

- [ ] **Order status words are facts only (D14):** Profile orders and `/checkout/return` show "Paid" / "Paid · sent to the roastery" / "On its way" / "Delivered" from `v_order_status.customer_label`; nothing about roasting, freshness or timing. A boot never overwrites a hand-edited label.
- [ ] **`/about` lands on Home and `/how-it-works` on The Axis**, query string kept (`?preview=true`).

## Family Household 1: foundation and join links (2026-11-07)

- [ ] **No household email:** adding a member asks for a first name only; nothing is sent; the admin gets Share / Copy for `/join-household?token=…`.
- [ ] **Join link works three ways:** signed out (sign in or sign up, back to the join page), signed in, new account; Join lands on `/profile?tab=family`; Decline closes the link and the member stays in the household.
- [ ] **`/join-household` is outside the curtain** with `VITE_PRELAUNCH_MODE` on, and sets no session bypass (`/shop` stays curtained).
- [ ] **A claim moves the member, not the roles:** the member's badge turns to "Has their own sign-in", `v_customer_identity` resolves the managed profile to the new account, one `member_claimed` event.
- [ ] **One household per person (D23):** joining another household leaves the current one first; a sole admin with other members is told to hand the admin role over first.
- [ ] **Never deleted:** leave / remove end the member row, dissolve sets `dissolved_at`, revoke closes the link; `household_event` is insert-only.
- [ ] **Managed profiles are safe:** the stale-guest purge never touches a `household_managed` profile; a `managed:` uid never authenticates.
- [ ] **Readers use `v_household_member`:** checkout recipient check, Liam access, homepage next delivery, user signals, Liam's member count. Nothing reads `user_profile.household_id`.
- [ ] **Privacy page** shows the Family Household paragraph.

## Family Household 2: quiz and dial by proxy (2026-11-07)

- [ ] **Quiz for a member:** `/find-my-flavor?for=<member>` names the member, saves the session on the member with the admin as `taken_by_user_id`; the admin's own result, newsletter row and inbox are untouched; no ad events fire.
- [ ] **The quiz is strict:** once the member has a self-taken quiz, Take the quiz for disappears and the door answers 409 with "Took their own quiz".
- [ ] **The dial is open:** Open their dial saves only on Save, as one move with the actor; the member's log shows it with Undo; Undo restores the slot the turn replaced; the saved list stays the member's own.
- [ ] **Unlink:** the member row returns to the managed profile with its proxy quiz; the account leaves the household; an admin member cannot be unlinked.
- [ ] **A claimed member sees the same quiz as the tab** (`/api/quiz/results/latest` reads `v_customer_quiz_current`).
- [ ] **Badge words** come from `household_account_state` / `household_quiz_state`.

## Family Household 3: order for the house (2026-11-07)

- [ ] **For whom per line:** a household member's cart shows "For" on each line (in-box members, the buyer first); the same coffee for two people is two lines; a line for someone outside the box is refused.
- [ ] **House orders carry the household;** a house subscription (a bag for someone else) carries it; a member's own plan does not and stays untouched by Leave.
- [ ] **Renewal per drinker:** each bag follows its drinker's current quiz and dial; the subscriber's dial never moves a member's bag; a member with no quiz or out of the box is skipped by name and the rest ships at its own tier; the payer gets one email per cycle.
- [ ] **Member mail:** members with a sign-in get "ordered" and "on its way" for their bag; managed members and the buyer get none.
- [ ] **Leave / Close with the house subscription:** the tab asks first (the API's sentence), then cancels it; members with a sign-in get the handover email and an offer; the first box they subscribe inside the window takes tier + the perk once; renewals at the tier.
- [ ] **The holder of the house subscription cannot be removed** by another admin.
- [ ] **Build the house box** adds one bag per in-box member with a quiz; others show Take the quiz for; own plans are marked.
- [ ] **Attribution:** a member's bag-claim scan beats the line's recipient (D24); the buyer's own bag reads `buyer`.

## Cupping evidence 9: disputes (2026-11-09)

- [ ] **An open dispute leaves the merge:** a disputed value (or whole cupper row) leaves the sample's merged row, so it also leaves the pooled range, the dial signal and the consensus; the merged row's `merge_note` names it.
- [ ] **A withdrawn dispute returns:** withdrawing re-merges, and the previous union comes back exactly (values, descriptors, calls).
- [ ] **The sheet row never changes:** `cupping_scores` / `cupping_score_values` are untouched by a raise or a withdraw. A dispute is never deleted, and its reason is never edited.
- [ ] **A manual merge is never re-merged by a dispute** (`manualMergeInPlace`).
- [ ] **The last undisputed cupper row cannot be disputed whole** (409 `LAST_CUPPER_ROW`); a merged row cannot be disputed at all.
- [ ] **Views show, they do not hide:** the readable and per-cupper views keep the disputed value with `is_disputed`; no view or code filters on a reason text.

## Ella's Bloom Map 1: schema, rules, preview (2026-11-10)

- [ ] **At most one active map version:** `dial_map_version_one_active` (activated and not retired); `activateVersion` retires the old one and activates a draft in one transaction, and refuses anything that is not a draft. Boot check #7 reports a drift.
- [ ] **Placement rows are never changed:** `dial_placement`, `dial_ring_cut` and `dial_size_cut` are written once, by `cutVersion`, while the version is a draft. The guard trigger refuses any later insert, update or delete, and a version row is never deleted.
- [ ] **The preview moves with the parameters, the active version does not:** changing a `dial_` parameter (`setParameterInTx`) changes `v_dial_placement_preview` and the preview edges; `v_dial_placement`, `v_dial_face` and `v_dial_edge` keep the cut's placements and the version's own parameter snapshot.
- [ ] **`cutVersion` is idempotent on its label:** a second call returns the same version and writes nothing.
- [ ] **Portal order is read by split:** each portal note's text is split on commas in the roaster's order; the stored response is never rewritten (G2.20).
- [ ] **No number in a view body:** every cut, weight, cap and grade threshold of the map is an `evidence_parameter` `dial_*` row (25 keys, boot check #10), every vocabulary a seeded lookup (boot check #9).
- [ ] **The map reads no slot ladder and no `coffee_hop`** for placement, edges or hops; the one slot read is `is_sellable`, through `v_coffee_sellable_candidate`, until the commerce move (OT-120).

## Ella's Bloom Map 2: the workbench (2026-11-10)

- [ ] **The page never writes a placement directly:** `/admin/map` writes only through `catalogService.setLean` (lean), `dialPlacementService` (cut, activate, first match, phrases) and `evidenceParameterService` (the `dial_` parameters). `dial_placement` is written only by `cutVersion`.
- [ ] **Parameters change the preview only:** a `dial_` parameter saved on the card moves the Preview (rings, edges, graph check); the Active version keeps its placements and its own snapshot.
- [ ] **Cut and Activate are the only two version actions**, and Activate asks for a confirmation that names the version it retires.
- [ ] **First match is refused under the grade floor at write (409 `BELOW_GRADE_FLOOR`), and the read still flags** a first match whose grade dropped later.
- [ ] **Nothing typed in:** lane, ring, size, grade, flag, move and status words, and the move-line delta phrases come from `GET /api/admin/map/vocabulary` and the phrase tables.
- [ ] **`EllaMapFace` is tap only:** no rotation, no drag; its layout is deterministic (`mapGeometry.test.ts`).

## Ella's Bloom Map 3: the match door and the customer map (2026-11-12)

- [ ] **Decisions are insert-only:** an UPDATE or DELETE on `customer_match_decision` or `customer_match_candidate` raises (guard trigger); a repeat `(source, source_id)` writes nothing.
- [ ] **Position is derived:** the latest decision per canonical user (`v_customer_match_current`); there is no current-position table, and the trail is every decision in order.
- [ ] **Every `dial_surface` row is `lane` until brief 4:** the quiz result, the profile and the dial-in email are unchanged for customers; `/map` is admin-only (`AdminRoute`) and `/api/map` answers 403 `map_not_open` to a customer.
- [ ] **The quiz door never fails on a decision error:** `POST /api/quiz/results` logs `[quiz/match-decision]` and answers as before (e.g. a decaf customer with no decaf first match on version 1).
- [ ] **A hop names a coffee in the caller's move set** (server-verified, 409 `NOT_IN_MOVE_SET`); `stay` re-picks the position; `forMemberId` goes through `assertMayTurnDialFor` and records the actor.
- [ ] **No slot and no `coffee_hop` in the map code** (`matchService`, `routes/map.ts`, the map pages); no price or add-to-cart on `/map` until prices move to `coffee_retail_price` (brief 4).
- [ ] **Nothing typed in:** button labels and edge phrases from `dial_hop_phrase`, sentences from `dial_customer_copy`; the customer page names no ring, lane, cell, seam, grade or version.

## Usual Drink 1: capture the daily cups, the kitchen and the feeling (2026-11-12)

- [ ] **Facts are insert-only:** every brew-profile write (card, Profile, Liam) goes through `customerFacts.record.brewProfileChange`; a changed answer is a new row and the fold's latest wins.
- [ ] **A declined question is a fact:** each card field shown and not answered is a `declined` row (value NULL, quiz session set); the fold, `captured_at`, `source` and `v_palate_evidence` ignore it.
- [ ] **No card after a proxy quiz:** the card is not rendered on `?for=`, and `POST /api/quiz/post-result` answers 409 on a session with `taken_by_user_id`; 403 on a session the caller does not own.
- [ ] **Pickers come from data:** the card, the Profile mirror and Liam's field list read `getBrewProfileFieldsConfig()` only; a field with `prompt` NULL or `is_active` false leaves the card on the next refresh; no component logic keys on a field code.
- [ ] **Over-cap is rejected:** an array over `max_items`, words on a value that does not take them, or words over `max_item_len` is refused and counted in `brew_profile.failures`, never truncated, never a 500.
- [ ] **The purge keeps guests with facts:** the empty-guest rule skips a guest with a `customer_brew_profile_change` row; the stale-quiz rule still deletes the Auth record only.
- [ ] **Unknown funnel events are dropped:** `POST /api/quiz/event` with a code not in `quiz_funnel_event_type` answers ok with `dropped`, writes nothing.
- [ ] **Nothing reads the three fields for matching:** the quiz result, the first match, the map, the dial and Liam's recommendation are unchanged.
