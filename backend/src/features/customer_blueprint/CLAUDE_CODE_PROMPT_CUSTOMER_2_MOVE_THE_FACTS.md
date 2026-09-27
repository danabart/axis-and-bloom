# Claude Code Prompt — Customer Blueprint, Brief C2: move the facts

**Series:** Customer Blueprint (see `README.md` in this folder). Brief 2 of 3. C1 is live (commits 0647da2, 09fcc95, 14f8fd1, b86d2c6; request pool runs as `ab_app`, schema applied as `axisbloom`, 9/9 integrity checks green). C3 (views and retirements) follows.

**Goal:** Every customer fact that today lands only in Firestore, or in a mutable SQL table, also lands as an append-only row through `customerFacts.record.*()`, from the moment it happens. Existing history is backfilled once, under the owner role, with proof. Nothing old is removed: this brief is **dual-write**. A daily comparison reports where the two disagree; C3 retires the old writers after the comparison has been clean for the agreed period. After this brief: feedback, brew profile changes, dial events, bag claims and identity links are facts; `intended_for_user_id` and `order_kind` are written at checkout; routes call the door instead of fanning out one more copy.

**Why this needs a build (context, not instructions):** C1 made the fact tables immutable and gave them a door, but they are empty and nothing writes them. Today feedback is written twice (Firestore `feedback_events` with sentiment, SQL `user_flavor_feedback` with descriptors, the latter rewritten by DELETE + INSERT on revision), brew profile is a Firestore doc written from three sites, dial events are a Firestore subcollection, `order_line_item.intended_for_user_id` exists and is never written, and sign-up creates a synthetic `quiz_session` from the `newsletter_subscriber` copy instead of linking the two profiles. Prod has 0 `order_line_item` rows (Shopify still stubbed), so there is no order backfill; the order-side work is writers only.

**Decisions already made (Liam Recommendation Map D1–D21; Dana 2026-09-26/27) — implement as stated, don't re-open:**

- D6: `occurred_at` from the database clock on live writes; on backfill, the source's own timestamp via the owner-gated `.backfill()` variant, with `recorded_at` = now and `source = 'backfill'`.
- D7: an order line is a palate row for `intended_for_user_id` when set; else for the buyer when the order is neither household nor company-sponsored; else unattributed until a bag claim names the drinker. Bag claims are facts. (The rule itself is applied by C3's views; C2 records the inputs.)
- D15: facts key on `user_profile.id`. Two profiles that are one person are joined by `customer_identity_link`, never by re-keying. No PII in fact rows.
- D17: `UNIQUE (source, source_id)`; duplicates are no-ops, logged.
- D18: `order_kind` ∈ manual, subscription_renewal, gift_redemption, liam_followed.
- Coexistence, not clean cut: old stores keep being written until C3; the comparison period is **14 days clean** (Dana may shorten it).
- CTO-pattern rules: Task 0 verify-first; explicit file list, never `git add -A`; push is deploy; backfills by Claude Code under the owner role, `--dry-run` default, STOP before `--apply`; one closing report.

## Task 0 — Verify current state (confirm, don't assume)

Read and confirm before touching anything. Stop and report if any of these is not what the file says.

- `services/customerFacts.ts` (C1): `record.feedback`, `record.feedbackDescriptor`, `record.brewProfileChange`, `record.dialEvent`, `record.bagClaim`, `record.identityLink`, each with a `.backfill()` variant gated on `whoAmI() !== 'ab_app'`. `FactSource` union. Confirm the exact input types; this brief's calls must match them, and if a field this brief needs is missing (e.g. `sessionId` on brew profile change, `replyMessageId`), add it to the type and the INSERT in the same commit.
- `services/customerReads.ts` (C1): empty. Lint rule 4 makes it the only file that may SELECT from a `customer_*` table; this brief adds its first two reads (Part A1).
- Feedback, onsite: `routes/orders.ts` POST feedback (~L400–520): resolves `coffeeId` from the order's blend, validates `tastedNoteIds` against `v_collaborative_flavor_wheel`, finds the active Firestore `feedback_events` doc for `orderId` and marks it `supersededAt` on revision, `add()`s the new doc (fields: orderId, blendId, signalType, rating, sValue, confidence, source, sentiment, rawText, expectation, descriptors, tastedNoteIds, createdAt), writes `confidence_profile`, then `DELETE FROM user_flavor_feedback … ; INSERT …` per note id, then `dial_position_signal`, then `computeBehavioralConfidence` + lifecycle fire-and-forget. Confirm the `add()` result's doc id is available in scope (it is the natural `source_id`).
- Feedback, SMS: `services/liamSmsFeedback.ts` ~L237–262 writes `feedback_events` (Firestore only) with `expectation`; ~L301 flags `confidence_profile` on negative. Confirm what identifies the inbound SMS (provider message sid or the `sommelier_sms_feedback` row id) for `source_id`.
- Brew profile writers (three sites, no service function): `routes/users.ts` PATCH `/brew-profile` (~L958: one field, `set(..., {merge:true})` with `{value, source:'profile_page', capturedAt}`), DELETE `/brew-profile` (~L1026: `FieldValue.delete()` on a field), `routes/sommelier.ts` `resolveRemember()` (~L384: per op, array fields append with a max length, scalar fields set; `source:'conversation'`). `services/brewProfile.ts` exports validation/format helpers only.
- Dial events: `routes/users.ts` PATCH `/dial-position` (~L526): resolves `(archetype, dialSortOrder)` to `coffee_dial_slot.id`, upserts `user_bloom_dial_current_position` (operating table, stays), and writes `users/{uid}/dial_events` (confirm the exact fields: eventType explicit_save | add_to_cart, archetype, slotId/coffeeId, trigger, source, platformName).
- Orders: `routes/orders.ts` ~L153 `INSERT INTO "order"` and ~L184 `INSERT INTO order_line_item (order_id, blend_id, quantity, unit_price_charged, discount_amount)`. Confirm whether `companyGiftRedemption.ts` or any other path creates orders (grep found none besides orders.ts). Confirm the request body shape at checkout and whether the buyer's `household_id` is available in scope.
- QR door: `routes/qr.ts` `logScanEvent(token, coffeeId, authState, destination, userId, tokenType, source)` inserts `qr_scan_event` (SERIAL id; confirm `RETURNING id` is available or add it). `authState` ∈ owner | signed_out | non_owner | unresolved | no_orders; `owner` is decided by `hasAnyOrderOrSponsorship(profileId)` (~L159) and the owner query in `services/qrDoor.ts` ~L205 (`o.user_id = $1 OR li.intended_for_user_id = $1`).
- Sign-up claim: `routes/auth.ts` ~L55–85: when the new account has an email and no `quiz_session`, looks up `newsletter_subscriber` by email and calls `saveQuizSession(profileId, …, {claimedFrom:'newsletter_subscriber'})`. `newsletter_subscriber.user_id` is nullable and, when set, is the profile that took the quiz (often a guest profile that survived sign-up under a *different* Firebase account, i.e. a second device).
- Firestore volumes for backfill sizing, counted through the admin SDK (read-only): total `feedback_events` docs across users, `brew_profile` docs, `dial_events` docs, and how many `feedback_events` docs have `supersededAt`. Report the four numbers.
- `api_event` middleware: confirm whether the request's `api_event` id is exposed on `res.locals` (or similar). If yes, it is the `source_id` for onsite brew-profile and dial writes; if not, Part A2 says what to use instead.
- Lint allow-lists in `backend/scripts/lint-customer.mjs` rule 3 (Firestore writes): the entries for feedback, brew profile, dial and confidence are marked `until C2`. **They stay in C2** (dual-write); this brief changes their note to `until C3` and adds nothing new. Any new Firestore write is still a violation.
- Repo on `main`, level with `origin/main` at `b86d2c6` (or later if Dana has merged since; report the hash).

## Part A — Writers (dual-write; every existing write stays exactly where it is)

General rules for every site below: the `record.*()` call goes **after** the existing writes succeed and **before** the response is sent, wrapped in its own try/catch that logs `[customerFacts:<site>]` on error and never fails the request; `source_id` is deterministic and derived from the existing write's own id wherever one exists; `catalog_version` is left to the door's default (`getCatalogVersion()`).

### A1. Feedback

`customerReads.ts` gains two reads: `latestFeedbackEventForOrder(userId, orderId)` (the most recent `customer_feedback_event` row for that order line, by `occurred_at`, ignoring nothing: supersede chains are resolved by C3's view) and `orderLineForOrder(orderId)` (the line item id when the order has exactly one line, else null).

- `routes/orders.ts` POST feedback: after the Firestore `add()`: `record.feedback({ userId: profileId, source:'onsite', sourceId: <firestore doc id>, orderLineItemId: <from orderLineForOrder>, coffeeId, rating, expectation, rawText: note, channel:'onsite', supersedesId: <id of latestFeedbackEventForOrder when isRevision, else null> })`, then one `record.feedbackDescriptor` per `noteId` (`sourceId = <feedback event id>:<noteId>`). When the order has more than one line, `orderLineItemId` is null, `coffeeId` is still set, and a `console.warn('[customerFacts:feedback] multi-line order, line unattributed')` is logged; C3 decides the rule.
- `services/liamSmsFeedback.ts`: same call with `source:'sms'`, `channel:'sms'`, `sourceId = <provider message sid, else the sommelier_sms_feedback row id>`; no descriptors (SMS has none). `supersedesId` via the same read.
- The existing `DELETE FROM user_flavor_feedback` stays (lint rule 2 does not match it: not a fact table by name). Add the comment `// C3 removes this store` above it.

### A2. Brew profile changes

`source_id` rule: `<api_event id>` when Task 0 found it on `res.locals`; otherwise `<uid>:<field>:<op>:<sha1 of value>:<floor(epoch seconds / 60)>` (one minute of idempotency for a double submit, documented as such).

- `routes/users.ts` PATCH: one `record.brewProfileChange({ userId: profileId, source:'onsite', field, op:'set', value: JSON.stringify(validatedValue) })` per request. DELETE: `op:'clear'`, `value:null`.
- `routes/sommelier.ts` `resolveRemember()`: one row per accepted op: `op:'add'` for array fields (value = the single validated item), `op:'set'` for scalars; `source:'liam'`, `sessionId`, `sourceId = <sessionId>:<turn>:<field>:<validated value>`. Ops dropped by validation are not recorded (they never became a fact). Confirm `sessionId` and `turn` are reachable from `resolveRemember`'s call site; pass them in.

### A3. Dial events

`routes/users.ts` PATCH `/dial-position`: `record.dialEvent({ userId: profileId, source:'onsite', sourceId: <firestore dial_events doc id>, eventType, slotId, coffeeId: coffeeId ?? null, archetypeCode: archetype })`. Only the two event types the Firestore write already logs.

### A4. Orders: `intended_for_user_id` and `order_kind`

`routes/orders.ts` order creation:
- Accept `intendedForUserId` per line from the request body. Validate: it must be the buyer's own `user_profile.id` or a member of the buyer's household (`user_profile.household_id` equal); anything else → 400. When absent: set it to the buyer's profile id **only when** the order has no `household_id` and no company-gift context; otherwise leave NULL (unattributed, per D7).
- `order_kind`: `'gift_redemption'` when the order is created through the company-gift path (Task 0 says whether one exists; if none, only `'manual'` is reachable and this brief records that in the report); `'manual'` otherwise. `'subscription_renewal'` and `'liam_followed'` have no writer yet (renewals wait for Shopify; `liam_followed` is L3's job, derived from `customer_liam_recommendation` at read time, not written at checkout). Keep the C1 column default.
- Frontend: no change in this brief unless the checkout already carries a "who is this for" field; if it does, wire it; if not, note it for the household/B2B workstream.

### A5. Bag claims

`routes/qr.ts`: make `logScanEvent` return the new `qr_scan_event.id`. When `authState === 'owner'` and `profileId` is set: `record.bagClaim({ userId: profileId, source:'qr', sourceId: String(<scan event id>), qrScanEventId, coffeeId, orderLineItemId: <the single matching line from the owner query when exactly one, else null> })`. Non-owner, signed-out, unresolved and no_orders scans are not claims. A second scan of the same bag by the same person is a new scan event and a new claim row (different `source_id`); C3's attribution read takes the earliest.

### A6. Identity links at sign-up

`routes/auth.ts` claim block: before the existing `saveQuizSession(… claimedFrom …)`, when the subscriber row has `user_id` set and `user_id <> profileId`: `record.identityLink({ userId: subscriber.user_id, fromUserId: subscriber.user_id, toUserId: profileId, how:'email_match', source:'onsite', sourceId: <subscriber.user_id>:<profileId> })`. The synthetic `saveQuizSession` call **stays** in this brief (readers still depend on the new profile having a session); C3 removes it when `v_customer_quiz_current` resolves through links. Add the comment `// C3 removes this synthetic session once reads resolve identity links`.

Household claims (`how:'household_claim'`) and admin links have no UI yet; `record.identityLink` supports them, nothing calls them. Say so in the report.

## Part B — Backfills (owner role only; `--dry-run` default; STOP before `--apply`)

One script, `backend/scripts/backfillCustomerFacts.ts`, with subcommands `feedback`, `brew-profile`, `dial-events`, each `--dry-run` by default and `--apply` explicit; refuses to run as `ab_app` (`whoAmI()` guard from C1); reads Firestore through the admin SDK; writes only through `record.*.backfill()` with `source:'backfill'`, `occurredAt` = the source doc's timestamp, `recordedAt` = now.

- **feedback**: for every `users/{uid}/feedback_events` doc, resolve `uid` → `user_profile.id` (skip and count docs whose uid has no profile), `orderId` → line item (single-line rule from A1), `blendId`/`orderId` → `coffee_id` the same way the route does; `sourceId = <firestore doc id>`; `supersedesId` = the doc this one superseded (reconstruct chains per orderId by `createdAt` order: each doc with a later sibling is superseded by that sibling); `channel` from `source` (`onsite` | `sms`); descriptors from `tastedNoteIds` (Firestore) unioned with `user_flavor_feedback` rows for the same `(user_id, order_id)` (dedupe by `cupping_note_id`). Rows in `user_flavor_feedback` with no matching Firestore doc (should be none; count them) get a feedback event row with `source_id = 'uff:<order_id>'` and `rating` null.
- **brew-profile**: for every `users/{uid}/metadata/brew_profile` doc, one `customer_brew_profile_change` row per field present: `op:'set'`, `value` = the field's current value (JSON), `occurredAt` = the field's `capturedAt` (else the doc's `updatedAt`, else now with a count of how many fell through), `source` = `'backfill'` with the original `source` (`profile_page` | `conversation`) recorded in a `note` column if C1 created one, else in `source_id` as `<uid>:<field>:<profile_page|conversation>:<capturedAt epoch>`.
- **dial-events**: one `customer_dial_event` per `users/{uid}/dial_events` doc, `sourceId = <doc id>`.

Dry-run output, per subcommand: docs read, rows that would insert, rows that would collide (already present), docs skipped (no profile, unresolvable coffee, unknown field) with the first five ids of each skip class. `--apply` output: the same plus inserted / collided counts, and `SELECT source, COUNT(*) FROM <table> GROUP BY source` after. Proof, before and after each `--apply`: row count + md5 of `quiz_session`, `newsletter_subscriber`, `user_flavor_feedback` (must be unchanged; the backfill reads them and never writes them), and the Firestore doc counts from Task 0 (unchanged).

## Part C — Coexistence comparison (boot + daily)

`customerIntegrity.ts` gains three **informational** checks (10–12), each listing up to ten disagreeing users in `details`:

10. Feedback parity: per profile, count of non-superseded Firestore `feedback_events` docs vs count of `customer_feedback_event` rows that are not superseded (a row is superseded when another row's `supersedes_id` points at it). Disagreement = counts differ.
11. Brew profile parity: per profile, for each field in the Firestore doc, the latest `customer_brew_profile_change` row's value (by `occurred_at`) equals the doc's value; a field present in the doc with no change row, or vice versa, is a disagreement.
12. Dial parity: per profile, Firestore `dial_events` count = `customer_dial_event` count.

Run at boot with the other checks and from the existing daily cron (`routes/cron.ts`, same guard pattern as the other jobs) with the result written to the log as `[customer-parity] day N clean` / `[customer-parity] disagreements: <n users>`. The admin panel from C1 shows checks 10–12 with their details. The "clean days" counter is derived (count of consecutive daily runs with zero disagreements, from `api_event` or the cron's own log rows); do not add a table for it.

## Part D — Lint and docs

- `lint-customer.mjs` rule 3: change every `until C2` note to `until C3`; add no entries. Rule 4: `customerReads.ts` now has real reads; nothing else changes.
- `WHAT_WE_BUILT.md`: new entry "Customer Blueprint C2 — move the facts": writers wired (site by site), backfill readings (dry-run and apply numbers), parity check results on day 0, Task 0 deviations.
- `WHAT_WE_BUILT_DB.md` customer ownership table: writer column filled for the five facts; `order_line_item` gains `intended_for_user_id` and `order_kind` writers; a line under `newsletter_subscriber` that the sign-up claim now also writes `customer_identity_link`.
- `README.md` in this folder: C2 status cell.
- `OPEN_TASKS.md`: "C3 retires: Firestore feedback_events / brew_profile / dial_events writers, user_flavor_feedback DELETE+INSERT, synthetic sign-up quiz_session; earliest 14 clean parity days after <apply date>"; the checkout "who is this for" field if not wired; `subscription_renewal` writer waits for Shopify.

## Part E — Definition of done (one closing report)

1. `npm run lint:catalog && npm run lint:customer && npm test` green locally (OT-19's 12 pre-existing failures excepted, unchanged in count).
2. Commit by explicit file list; show `git diff --cached --stat` before committing. Message: `customer: blueprint C2 - facts written live from feedback, brew profile, dial, checkout, QR and sign-up; backfill script; parity checks`.
3. Push → deploy green → boot log: `[customer-integrity]` 1–9 green, 10–12 present (informational) and, before the backfill, showing disagreements equal to the Firestore volumes from Task 0 (that is the expected day-0 state).
4. Backfill: `feedback --dry-run`, report, **STOP**; `--apply` on go; same for `brew-profile` and `dial-events`. After all three, checks 10–12 must report zero disagreements; if any remain, list them and STOP (do not patch data by hand; the backfill script is fixed and re-run, collisions are no-ops).
5. Smoke on prod with the test user (`quiz-scenario-test@axisandbloom.test`, uid `0BeUD1zIdCTyO4v78kofJVkFtfo1`, exclude from analysis): PATCH brew-profile → one `customer_brew_profile_change` row with `source='onsite'`; one Liam turn that states a brew method → one row with `source='liam'` and the session id; PATCH dial-position → one `customer_dial_event`; POST feedback on an order **only if** the test user has one (prod has 0 lines; otherwise prove the path in the test DB and say so); a QR scan as owner only if a test token and an owned bag exist (else test DB); sign-up path: prove in the test DB with two profiles sharing an email that a `customer_identity_link` row lands and the synthetic session still does. Parity checks green after the smoke (the new rows exist in both stores).
6. One closing report: writers wired, backfill numbers, parity state, every Task 0 deviation, what waits for Shopify or a UI.

**Guardrails:** dual-write only: no existing write is removed or reordered; a `record.*()` failure never fails a customer request; backfill runs only under the owner role, dry-run first, STOP before apply, never patches rows by hand; no schema change except additive columns the door needs (state them); do not touch `quizScoring.ts`, the calibration fixture, or the Liam prompt; never `git add -A`.
