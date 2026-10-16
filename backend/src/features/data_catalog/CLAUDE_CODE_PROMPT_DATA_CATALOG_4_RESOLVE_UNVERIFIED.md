# Data catalog, brief 4: resolve the 84 UNVERIFIED comments

> Folder: `backend/src/features/data_catalog/` · Decided: 2026-10-16 (Dana, CTO session) · Model: Sonnet is fine
> Status: EXECUTED 2026-10-16 (committed, not pushed; Dana deploys; see CLOSING_REPORT_4.md) · Depends on briefs 1, 2 and 3 (all executed 2026-10-16)
> Read `README.md` in this folder first, then `UNVERIFIED_RESOLUTION_HANDOFF.md` for the background.

## What this is

Brief 1 left 84 comments (10 tables, 74 columns) in `backend/src/db/comments.sql` that start with `UNVERIFIED:`. Dana has now decided every one of them. This brief rewrites those 84 statements with the decided text, adjusts the two tests that encode the old state, regenerates `CATALOG.md`, and leaves System Health check #2 ("No comment is UNVERIFIED") at 0.

This is a text change to `comments.sql` plus two test edits. No DDL, no data change, nothing dropped, nothing added to `schema.sql`.

## Decisions already made (Dana, 2026-10-16). Do not re-open.

1. Nothing is dropped, deleted or altered in the database. "drop-later" is a phrase in a comment, not an action.
2. No `schema.sql` change at all: no CHECK, no FK, no unit column. Units and vocabularies live in the comments only.
3. Where a scale, unit or direction has no data and no code behind it, the comment says "undefined, table unused" (or "undefined by design"). Do not invent one.
4. Comment format is unchanged: table/view `Purpose: … | Class: … | Writer: … | Readers: … | Since: …`; column `<one sentence>` optionally prefixed `Class: deprecated | `. The format lint in `comments.format.test.ts` stays the authority; one change to it is specified in Part B.
5. Deprecated columns use the existing house style: `Class: deprecated | DEPRECATED 2026-10-16: <why>.` (see `coffee_sku.inventory_status` for the precedent). Columns of a deprecated table that are not in the 84 keep their current sentence (precedent: `archetype_relationship`).
6. `newsletter_subscriber_backup_20260925` stays `Class: snapshot` and is never dropped (Dana's 2026-09-25 decision, reaffirmed today).
7. The commerce placeholder columns are kept and described as reserved for the Stripe payment-capture brief (`backend/src/features/commerce/CLAUDE_CODE_PROMPT_STRIPE_PAYMENT_CAPTURE.md`). Money columns are USD dollars, the unit `total_amount_paid` already uses (the reporting view computes `ROUND(SUM(total_amount_paid) * 100) AS revenue_cents`).
8. Scope is exactly the 84 statements listed below plus the two tests. Do not touch any other comment, even if you notice something wrong; report it in the closing report instead.

## Part A: rewrite the 84 statements in `backend/src/db/comments.sql`

Replace each statement's text with the text given here, verbatim. Keep every statement on its own line, in its current position, dollar-quoted `$c$…$c$`. Do not change the target (table or column name) of any statement. After this part, `grep -c 'UNVERIFIED' backend/src/db/comments.sql` must return exactly 1 (the rule line in the file header, which stays).

### A1. Tables (10)

```
COMMENT ON TABLE user_payment_detail IS $c$Purpose: Retired 2026-10-16: intended store of per-user payment accounts from the original 2026-05 design; never written (0 rows), no code, and the Stripe payment-capture brief does not use it (Stripe Checkout holds payment methods); drop-later | Class: deprecated | Writer: none | Readers: none | Since: 2026-05-22 (as payment_detail, renamed user_payment_detail)$c$;
COMMENT ON TABLE user_vector_state IS $c$Purpose: Retired 2026-10-16: per-user declared and behavioral score per flavor dimension from the original 2026-05 design; never written (0 rows), no code, and dimension_id is a UUID that cannot join coffee_dimensions (integer id); the live customer position is quiz_session_interpretation and user_bloom_dial_current_position; drop-later | Class: deprecated | Writer: none | Readers: none | Since: 2026-05-22$c$;
COMMENT ON TABLE user_coffee_profile IS $c$Purpose: Retired 2026-10-16: ranked coffee-archetype matches per user from the original 2026-05 design; never written (0 rows), no code; the live equivalent is quiz_session plus quiz_session_interpretation (primary, secondary, explore); drop-later | Class: deprecated | Writer: none | Readers: none | Since: 2026-05-22$c$;
COMMENT ON TABLE roastery_blend_vector IS $c$Purpose: Retired 2026-10-16: per-SKU score on each flavor dimension from the original 2026-05 design; never written (0 rows), no code, and dimension_id is a UUID that cannot join coffee_dimensions (integer id); the live model scores coffees, not SKUs, through the cupping tables and the Bloom Dial placement (coffee_dial_slot); drop-later | Class: deprecated | Writer: none | Readers: none | Since: 2026-05-22 (as blend_vector)$c$;
COMMENT ON TABLE user_roaster_link IS $c$Purpose: Retired 2026-10-16: link from a user account to the roastery they work at, from the original 2026-05 design; never written (0 rows), no code; roastery people reach us through roastery_portal_link tokens and roastery_portal_respondent, not accounts; drop-later | Class: deprecated | Writer: none | Readers: none | Since: 2026-05-22$c$;
COMMENT ON TABLE quiz_vector IS $c$Purpose: Retired 2026-10-16: per-dimension scores for a quiz session from the original 2026-05 design; never written (0 rows), no code, and dimension_id is a UUID that cannot join coffee_dimensions (integer id); quiz scoring is quiz_answer_archetype_score and the result lives in quiz_session.context_data and quiz_session_interpretation; drop-later | Class: deprecated | Writer: none | Readers: none | Since: 2026-05-22$c$;
COMMENT ON TABLE roastery_shipment_details IS $c$Purpose: Reserved for the Stripe payment-capture brief (features/commerce): tracking and postage details of a roastery shipment for an order, to be written by the admin shipped endpoint; not written yet (0 rows), no code today | Class: operating | Writer: none | Readers: none | Since: 2026-05-22 (as shipment)$c$;
COMMENT ON TABLE cupping_brew_params IS $c$Purpose: Reserved per-session-coffee brew parameters (dose, water, yield, temperature, grind, time, pressure, device) for the cupping tool; not written by any code, seed or script yet (0 rows), counted in the cupping-evidence design (DESIGN_CUPPING_EVIDENCE.md) | Class: operating | Writer: none | Readers: none | Since: 2026-05-25 (as brew_params)$c$;
COMMENT ON TABLE liam_sms_feedback IS $c$Purpose: Not in schema.sql. Retired: original Sommelier Task 5 table for one-row-per-SMS Liam feedback messages, renamed to sommelier_sms_feedback in code (eff1d98); this old empty table (0 rows) was never dropped; the SMS feedback feature is not live yet and will be built on sommelier_sms_feedback, never here; drop-later, decided 2026-10-16 | Class: deprecated | Writer: none | Readers: none | Since: 2026-06-26 (Sommelier Task 5, commit 78c62f4)$c$;
COMMENT ON TABLE newsletter_subscriber_backup_20260925 IS $c$Purpose: Not in schema.sql. Pre-correction copy of the 8 newsletter_subscriber rows whose archetype was fixed by the quiz resync correction on 2026-09-25, kept as the record of that fix and never dropped (decided 2026-09-25, reaffirmed 2026-10-16) | Class: snapshot | Writer: backfill:correct-subscriber-archetypes | Readers: none | Since: 2026-09-25 (quiz resync fix, WHAT_WE_BUILT.md)$c$;
```

### A2. Columns with new text (41)

```
COMMENT ON COLUMN coffee_archetype.is_active IS $c$Class: deprecated | DEPRECATED 2026-10-16: boolean default true that no code or view reads or writes; all six archetypes are live and retiring one is a code change, not a flag.$c$;
COMMENT ON COLUMN cupping_note.intensity_score IS $c$Class: deprecated | DEPRECATED 2026-10-16: never written; cupping_note is the descriptor vocabulary, and the intensity a descriptor showed in a cupping lives on cupping_score_descriptors.intensity (0-15).$c$;
COMMENT ON COLUMN cupping_note.ai_metadata IS $c$Class: deprecated | DEPRECATED 2026-10-16: JSONB never written, read or documented.$c$;
COMMENT ON COLUMN user_profile.stripe_customer_id IS $c$Stripe customer id for the user; reserved for the Stripe payment-capture brief (getOrCreateStripeCustomer reads and writes it), not written yet.$c$;
COMMENT ON COLUMN user_profile.accepts_marketing IS $c$Class: deprecated | DEPRECATED 2026-10-16: never read or written; marketing consent lives on newsletter_subscriber (subscribed, unsubscribed_at).$c$;
COMMENT ON COLUMN user_phone.sms_beats_opt_in IS $c$Extended consent for beat SMS, default false; read live by beatEngine and the beats cron, written by nothing until the A2P consent UI exists (HOME_TASK_8 scope note in schema.sql).$c$;
COMMENT ON COLUMN user_phone.sms_beats_opt_in_at IS $c$UTC timestamp when sms_beats_opt_in was granted; written by nothing until the A2P consent UI exists.$c$;
COMMENT ON COLUMN user_payment_detail.account_type IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: required free-text kind of payment account, never written.$c$;
COMMENT ON COLUMN user_payment_detail.provider IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: required payment provider name, never written.$c$;
COMMENT ON COLUMN user_payment_detail.payment_terms IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: free-text payment terms, never written.$c$;
COMMENT ON COLUMN user_payment_detail.external_provider_id IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: provider-side id of the account or customer, never written.$c$;
COMMENT ON COLUMN user_payment_detail.routing_info IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: JSONB provider routing details, never written.$c$;
COMMENT ON COLUMN user_coffee_profile.match_rank IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: rank of this archetype among the user's matches, never written.$c$;
COMMENT ON COLUMN user_coffee_profile.match_confidence IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: numeric confidence of the match; scale undefined, table unused.$c$;
COMMENT ON COLUMN coffee_sku.cost_to_us IS $c$Wholesale cost to Axis and Bloom for one bag of this SKU in USD dollars (admin field "Cost to us ($)", two decimals); written by catalogService.upsertSkuInTx from Admin Supply and Inventory and from catalog import, shown in Admin Supply and Inventory, read by no customer-facing path.$c$;
COMMENT ON COLUMN coffee_sku.coffee_type IS $c$Class: deprecated | DEPRECATED 2026-10-16: never read or written, always the default blend; the kind of coffee is coffees.blend_or_single.$c$;
COMMENT ON COLUMN roastery_blend_vector.dimension_id IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: UUID with no FK that cannot join coffee_dimensions (integer id); part of the primary key.$c$;
COMMENT ON COLUMN roastery_blend_vector.score IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: numeric score of the SKU on that dimension; scale undefined, table unused.$c$;
COMMENT ON COLUMN quiz_answer.next_question_id IS $c$Class: deprecated | DEPRECATED 2026-10-16: legacy branching pointer (FK to quiz_question) that no seed ever set and no code reads, always NULL; the SCD2 version function only copies it forward; branching is quiz.trigger_archetype_id and quiz.parent_quiz_id.$c$;
COMMENT ON COLUMN quiz_answer.vector_impact IS $c$Class: deprecated | DEPRECATED 2026-10-16: legacy JSONB per-dimension impact that no seed ever set and no code reads, always NULL; the SCD2 version function only copies it forward; scoring is quiz_answer_archetype_score.$c$;
COMMENT ON COLUMN quiz_vector.dimension_id IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: UUID with no FK that cannot join coffee_dimensions (integer id).$c$;
COMMENT ON COLUMN quiz_vector.score IS $c$Class: deprecated | DEPRECATED 2026-10-16 with its table: numeric score on that dimension; scale undefined, table unused.$c$;
COMMENT ON COLUMN subscription.household_id IS $c$FK to household(id), the household the subscription belongs to; reserved, not written yet (only company-sponsored subscriptions are inserted today, by companyGiftRedemption).$c$;
COMMENT ON COLUMN subscription.frequency_days IS $c$Days between deliveries, default 30; reserved for the Stripe subscription flow, not written yet (sponsored subscriptions keep the default).$c$;
COMMENT ON COLUMN subscription.next_delivery_date IS $c$Calendar date of the next scheduled delivery; reserved for the Stripe subscription flow, not written yet (NULL today).$c$;
COMMENT ON COLUMN "order".fulfillment_status IS $c$Fulfilment state as free text, written as pending at checkout and never updated today; catalogService (open orders per roaster) treats delivered and cancelled as closed, while the Stripe brief plans pending, awaiting_manual, placed, shipped, delivered, canceled, needs_attention; that brief must settle the canceled vs cancelled spelling before any CHECK is added.$c$;
COMMENT ON COLUMN "order".is_subscription IS $c$True if the order is a subscription renewal, default false; reserved for the Stripe brief (createSubscriptionOrder sets it), never written today.$c$;
COMMENT ON COLUMN "order".shipping_fee_charged IS $c$Shipping fee charged to the customer in USD dollars (same unit as total_amount_paid), default 0.00; reserved for the Stripe brief, never written today.$c$;
COMMENT ON COLUMN "order".taxes_collected IS $c$Sales tax collected in USD dollars (same unit as total_amount_paid), default 0.00; reserved for the Stripe brief (automatic tax), never written today.$c$;
COMMENT ON COLUMN "order".transaction_fee IS $c$Payment-processing fee in USD dollars (same unit as total_amount_paid), default 0.00; reserved for the Stripe brief (from the balance transaction), never written today.$c$;
COMMENT ON COLUMN "order".promo_code IS $c$Promo code applied to the order; reserved, never written today (NULL); the Stripe brief decides whether Stripe promotion codes are mirrored here.$c$;
COMMENT ON COLUMN roastery_shipment_details.status IS $c$Shipment state as free text, default label_created; reserved for the Stripe brief's admin shipped endpoint (sets shipped), no CHECK until that vocabulary is settled, never written today.$c$;
COMMENT ON COLUMN roastery_shipment_details.postage_cost IS $c$Postage cost in USD dollars (the unit every money column in this schema uses); reserved, never written today.$c$;
COMMENT ON COLUMN order_line_item.shipment_id IS $c$FK to roastery_shipment_details(id), the shipment carrying this line; reserved for the Stripe brief, never written today.$c$;
COMMENT ON COLUMN order_line_item.wholesale_cost IS $c$Wholesale cost of the line in USD dollars (same unit as coffee_sku.cost_to_us); reserved for roaster payout reconciliation, never written today.$c$;
COMMENT ON COLUMN order_line_item.tax_amount_charged IS $c$Sales tax charged on the line in USD dollars, default 0.00; reserved for the Stripe brief, never written today.$c$;
COMMENT ON COLUMN order_line_item.vendor_payout_status IS $c$Roastery payout state as free text, default pending_invoice; reserved for roaster payout reconciliation, no CHECK until that vocabulary exists, never written today.$c$;
COMMENT ON COLUMN sommelier_messages.model_used IS $c$Class: deprecated | DEPRECATED with its table (legacy pre-Firestore transcript): label of the model that produced an assistant turn in Liam v1, nine legacy rows, nothing writes it since the move to Firestore on 2026-06-27.$c$;
COMMENT ON COLUMN coffees.roast_shade IS $c$Roaster-supplied roast shade slug from the original catalog matrix, finer than roast_level (seed values light, light-medium, medium, medium-dark, dark, ultra-dark; NULL for flavored coffees); free text with no CHECK, carried through catalog import and the admin coffee save, not editable in the admin form, read by no customer-facing path.$c$;
COMMENT ON COLUMN cupping_brew_params.ratio IS $c$Brew ratio as a bare number; direction (water per coffee or coffee per water) undefined, table unused.$c$;
COMMENT ON COLUMN cupping_note_dimension_weight.weight IS $c$Strength of the descriptor-to-dimension association, default 0; scale and range undefined by design until Stage 2 of BLOOM_DIAL_ALLOCATION_SPEC (needs cupping volume), table empty on purpose.$c$;
```

### A3. Prod-only table columns: strip the prefix (33)

For every `COMMENT ON COLUMN liam_sms_feedback.*` (19 statements) and every `COMMENT ON COLUMN newsletter_subscriber_backup_20260925.*` (14 statements): delete the leading `UNVERIFIED: not in schema.sql | ` and keep the rest of the sentence exactly as it is. The sentences were written from the Task 5 DDL and the backfill script and are correct as descriptions; the only thing that was unverified about them was the table's absence from `schema.sql`, which the table comment now states in its Purpose.

Example, before and after:

```
COMMENT ON COLUMN liam_sms_feedback.direction IS $c$UNVERIFIED: not in schema.sql | Per the Task 5 DDL CHECK, one of: outbound, inbound.$c$;
COMMENT ON COLUMN liam_sms_feedback.direction IS $c$Per the Task 5 DDL CHECK, one of: outbound, inbound.$c$;
```

Count check after A1 to A3: 10 + 41 + 33 = 84 statements changed, no statement added or removed, `grep -c 'COMMENT ON' comments.sql` unchanged.

## Part B: the two tests that encode the old state

1. `backend/src/db/comments.format.test.ts`, the test `every table comment for an object not created in schema.sql starts UNVERIFIED: not in schema.sql`. Rename it to `every table comment for an object not created in schema.sql says so and is deprecated or snapshot` and change the rule to: for every non-column statement whose relation is not created in `schema.sql`, the text must not start with `UNVERIFIED`, its Purpose must start with `Purpose: Not in schema.sql.`, and its `Class` must be `deprecated` or `snapshot`. Keep the `created` set computation as it is.
2. `backend/src/services/dataCatalogIntegrity.test.ts`: the line `if (skipped.length === 0) expect(byId(2).details!.length).toBe(84);` becomes `toBe(0)`. The `expectedUnverified` derivation above it stays; it will now be an empty array, which is the point.

No other test changes. If any other test fails after Part A, stop and report; do not loosen a test to pass.

## Part C: verify, regenerate, commit

Run, in this order, all from `backend/`:

1. `npx vitest run src/db/comments.format.test.ts` (format lint, no DB).
2. `npm run lint:lineage` (declared `Writer:` fields were not changed in meaning; `none` stays `none`).
3. `npm run lint:catalog`.
4. The DB-backed tests against the test database the way briefs 1 to 3 ran them: `npx vitest run src/db/comments.db.test.ts src/services/dataCatalogIntegrity.test.ts`. The two prod-only tables are skipped on the test DB as before; check #2 must report `0 UNVERIFIED`.
5. `npm run catalog:md` and commit the regenerated `CATALOG.md` (repo root). Its header line must read `0 UNVERIFIED` and it must contain no `**UNVERIFIED:**` line.
6. `grep -c UNVERIFIED backend/src/db/comments.sql` returns 1 (the header rule line).

One commit on main, message `data catalog brief 4: resolve the 84 UNVERIFIED comments (0 left)`. Dana deploys; the comments apply at boot (`[db-comments] applied N statements`), and System Health → Data catalog → check #2 reads 0. That is "done".

## Closing report (`CLOSING_REPORT_4.md`, short)

- The six numbers from Part C (format test, lineage, catalog lint, DB tests, CATALOG.md header, grep count).
- Anything you noticed in a comment outside the 84 that looks wrong (decision 8: report, do not fix).
- Add one row for brief 4 to the table in `README.md` and a `### 223.` entry to `WHAT_WE_BUILT.md` in the style of #220 to #222, five lines at most: 84 resolved, how they split (12 deprecated tables and columns groups, commerce kept as reserved, units defined, 2 prod-only tables stated), nothing dropped, no schema change.

## Out of scope (do not do)

- Dropping, renaming or altering any table or column, including the drop-later ones.
- Adding CHECKs, FKs or units to `schema.sql`.
- Editing any comment not in the 84.
- Touching `WRITER_CONSOLIDATION_HANDOFF.md` or the Stripe brief.
