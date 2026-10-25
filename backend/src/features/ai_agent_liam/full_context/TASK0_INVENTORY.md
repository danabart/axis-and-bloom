# Task 0 — customer-facing fact sources (Liam sees everything, Rev 2)

2026-10-24. Report, no code. Sources: `CATALOG.md`, the frontend's data calls (`frontend/src/app/**`: `/api/coffees*`, `/api/users/profile`, `/api/users/addresses`, `/api/users/flavor-memory*`, `/api/household/*`, `/api/sommelier/*`, `/api/qr*`, `/api/shop/slot-availability`), and `backend/lineage.json` for "written by". Column-level checks (grep of every `UPDATE`) for the three fields the brief calls out as never written.

**Tags:** **prefix-answer** = a brand answer row (`sommelier_answer`, rendered into the cached prefix). **lookup-row** = a view or read the gate (Brief 3) will answer from.

| # | Source | In Liam's prompt before this brief | This brief | Tag | Written by (`lineage.json`) |
| --- | --- | --- | --- | --- | --- |
| 1 | `sommelier_answer` (brand facts) | yes (Brief 1, shared tier) | unchanged; B1's four rules join `brandFacts.rules` | prefix-answer | `sommelierAnswerService` (setAnswerInTx, retireAnswerInTx); seed |
| 2 | Dial coffees: `v_coffee_sellable_slot` / winner side of `v_coffee_visibility` | partly: a 6-coffee slice, anchor size only | **A** catalog block: every visible dial coffee, alias, archetype, dial position, every active size + price | lookup-row | `catalogService` (coffee_slot_assignment, coffee_slot_price, coffee_sku); seed |
| 3 | Category coffees: `coffee_category_assignment` + `coffee_retail_price` (decaf, half_caf, flavored, experimental) | **no** (`v_coffee_sellable_slot` excludes them) | **A** catalog block: category labels, priced active sizes, else "not yet available" (the site shows unpriced ones as "Unpriced") | lookup-row | `catalogService.applyCategoryCodes`, `catalogService.setCoffeeRetailPrice`; seed |
| 4 | `coffees.three_voice_story` (the one description) | yes, slice only | **A** `Tasting note:` for every coffee | lookup-row | `coffees` route (`generateAndStoreAllContent`) |
| 5 | `coffees.story` (published story) | only on my_coffee/origins turns, slice only | **A** `Story:` first N sentences (`catalogBlock.storySentences`, 2) for every coffee | lookup-row | `admin` PATCH /coffees/:id/story, `coffees` (story layer) |
| 6 | Roaster voice signature notes (`roasterVoiceReads`) | yes, slice only | **A** `Key flavors:` for every coffee | lookup-row | roastery portal / cupping evidence services |
| 7 | Roaster identity (`roaster.name`, `coffees.roaster_id`, SKU, internal name) | no | **excluded: partner roastery identity.** Never selected into a catalog row; an alias or story text naming a roaster is redacted; tested on a 3-roastery fixture | — | `admin` roasters routes, `catalogService` |
| 8 | First name, member since (`user_profile` via `v_customer_identity`) | no | **B** `Name:` line (first name + member since). `v_customer_identity` carries ids only, so the name comes from `user_profile` of the canonical profile | lookup-row | `auth` (sync), `users` (PATCH /profile), `quiz` |
| 9 | Household (`user_profile.household_id`, `household`) | no | **B** on the Name line, only when others share it ("shares a household account with n others"); member names excluded (not the customer's to hear back) | lookup-row | `household` routes |
| 10 | Generation (`user_profile.date_of_birth` → register sentence) | yes (opening context) | unchanged, one source (the register sentence) | — | `users` PATCH /profile |
| 11 | `v_customer_quiz_current` | yes (Match line) | unchanged | lookup-row | `quizSession.saveQuizSession` / interpretation |
| 12 | Quiz history (`quiz_session` + `coffee_archetype`) | no (previous archetype only, for TASTE_EVOLUTION RAG) | **B** `Quiz:` current + "before that" up to `customerBlock.quizHistoryCount` (3) | lookup-row | `quizSession.saveQuizSession` |
| 13 | `v_customer_bag_attribution` / `v_customer_timeline` order lines | yes (Had before, Bags) | unchanged | lookup-row | `orders` POST /api/orders, `customerFacts.bagClaim` |
| 14 | `order` + `order_line_item` (what and when) | no | **B** `Orders:` last `customerBlock.ordersFullCount` (5) as date: alias size ×qty; older as one count line. Read by new `customerReads.getRecentOrders` | lookup-row | `orders` POST /api/orders (INSERT); seed (order_line_item UPDATE) |
| 15 | `order.fulfillment_status` | no | **excluded: nothing updates it.** Written `'pending'` at checkout, no UPDATE anywhere (grep) | — | `orders` INSERT only (`'pending'`) — no updater |
| 16 | Tracking / shipment (`roastery_shipment_details`) | no | **excluded: no column, table has 0 rows and no writer** | — | none |
| 17 | `subscription.status`, sponsored (`company_gift_id` / `sponsored_expires_at`) | no | **B** `Subscription:` status (+ sponsored). Read by new `customerReads.getSubscriptionCurrent` | lookup-row | `companyGiftRedemption` (INSERT), `cron` (UPDATE status = 'lapsed') |
| 18 | `subscription.next_delivery_date`, `frequency_days` | no | **excluded: never written** (NULL on every row) | — | none |
| 19 | `address` city, state | no | **B** `Ships to:` city, state | lookup-row | `users` /addresses routes |
| 20 | `address` street, postal code | no | **excluded: a customer would not expect Liam to say it back** | — | `users` /addresses routes |
| 21 | Payment (`user_payment_detail`, `stripe_customer_id`) | no | **excluded: payment details** (and no writer) | — | none |
| 22 | `v_customer_feedback_current` / `customer_feedback_event` | partly (Disliked line, ratings in Had before) | **B** `Feedback:` per coffee, sentiment + the customer's own words, newest first, up to `customerBlock.feedbackCount` (8) | lookup-row | `customerFacts.feedback` |
| 23 | `v_customer_brew_profile` | yes (Setup line) | unchanged; `decaf_constraint` now also drives the FIT block (A3) | lookup-row | `customerFacts.brewProfileChange` |
| 24 | Brew cards (`user_brew_card`) | only on entry=bag/card sessions | **B** `Brew cards:` alias on method: ratio, grind, temp | lookup-row | `brewCard` (generateCard, createArrivalCard, adjustCard), `cron` |
| 25 | Saved coffees / flavor memory (`user_saved_item`, kind `dial_slot`; Firestore `liam_saves` is retired) | no | **B** `Saved to their profile:` aliases | lookup-row | `users` (dial-position, flavor-memory saves); backfill:migrateSavedItems |
| 26 | Earlier Liam sessions: L3 write-back (`customer_liam_recommendation` / `_question` / `_reply` / `_action`) | partly (open thread) | **B** `With Liam before:` last `customerBlock.sessionsCount` (3) sessions: date, recommended aliases, the customer's recorded replies. No transcript summarisation, no model call | lookup-row | `customerFacts.liam*` (via `liamWriteBack`) |
| 27 | Firestore `users/{uid}/sommelier_sessions/{id}/messages` | current session only (history) | unchanged; earlier sessions reach Liam through row 26, not transcripts | — | `routes/sommelier` |
| 28 | `v_palate_*` (shared traits, dominant dimensions, slot candidates, threads) | yes | unchanged | lookup-row | views over the customer facts |

**Sources Task 0 found that the brief did not anticipate (stated, not added):**
- **The site already shows a status nothing writes.** The Profile page renders each order's `fulfillment_status ?? 'pending'` (`backend/src/routes/users.ts:202`), and `GET /api/users/profile` returns `subscription.next_delivery_date` (`users.ts:385`). Both are always pending / NULL. Liam will not say them; the profile page does. Worth a look outside this brief.
- **Lifecycle stage** (`user_lifecycle_state`, the stage that drives the homepage CTA) is customer-facing in effect but not in the brief's list. Not added.
- **Recent dial activity** (`customer_dial_event`) was deliberately dropped from Liam's context in L1 (S100). Not re-added.
- **Arrival notes / beats sent** (`notification_log`, beat engine) — a customer may ask "did you email me?". No reader added.
- **Household member names** — excluded deliberately (row 9).
