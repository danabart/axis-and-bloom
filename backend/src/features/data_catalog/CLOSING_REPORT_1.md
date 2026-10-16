# Closing report: data catalog brief 1, the data dictionary

> Brief: `CLAUDE_CODE_PROMPT_DATA_CATALOG_1_DICTIONARY.md` · Executed 2026-10-16 · Not committed, not deployed (waiting for Dana's go-ahead)

## What was built

| File | Change |
|---|---|
| `backend/src/db/comments.sql` | **New.** 1,198 `COMMENT ON` statements (115 tables, 48 views, 1,035 table columns), one per line, dollar-quoted, in `schema.sql` order, each table headed `-- ── <table> ──`. The Firestore inventory sits as `-- firestore:` lines at the top. |
| `backend/src/db/schema.sql` | The 7 existing `COMMENT ON` statements were removed: 5 `coffee_sku` stock columns, `user_bloom_dial_current_position` (table) and `claude_daily_spend.cents`. Each was replaced by a one-line `--` pointer to `comments.sql`. No DDL, grant, seed or data changed. |
| `backend/src/db/commentsFile.ts` | **New.** `parseCommentsSql()` (strict: any non-blank, non-`--` line that is not a one-line `COMMENT ON` throws) and `applyCommentsSql()`. The apply step skips statements whose object does not exist in the connected database and reports them, then sends the rest as one multi-statement query, which is one implicit transaction (all or nothing). |
| `backend/src/index.ts` | Boot step inside the C1 Part B owner-pool block. It runs after `schema.sql` and the `[db-roles]` line and before `owner.end()` and every integrity check. It logs `[db-comments] applied N statements` plus a warning that lists any skipped objects. It has its own try/catch: a failure logs `[db-comments] comments.sql not applied (non-fatal)` and boot continues. |
| `backend/src/scripts/applyComments.ts` + `package.json` | `npm run db:comments`. It uses the same `--expect-db` guard as `backfillQuizInterpretation.ts`: the database name is checked from the URL and again from `current_database()`, and the default is `axisandbloom_test`. It runs on the owner pool and prints the remaining uncommented count. Production command: `npm run db:comments -- --expect-db axisandbloom`. |
| `backend/Dockerfile` | `cp src/db/comments.sql dist/db/comments.sql` was added next to the existing `schema.sql` copy. **Not in the brief, but required:** the container only received `schema.sql`, so without this line the boot step would read a missing file and only log a warning. |
| `backend/src/services/dataCatalogQueries.ts` | **New.** `UNCOMMENTED_OBJECTS_SQL` / `findUncommentedObjects()` returns every table, view and table column in `public` without a description. Brief 2 reuses it. |
| `backend/src/db/comments.format.test.ts` | **New.** 9 tests, no database query. The comments must parse; no object may be commented twice; table and view fields must be exactly `Purpose / Class / Writer / Readers / Since` with no empty field; `Class` must be in the allowed set and every view must be `Class: view`; a column comment must be one sentence with an optional `Class: deprecated \| ` prefix and an optional `\| Writer:` suffix; view columns must not be commented; every commented column's table must be commented; an object not created in `schema.sql` must start `UNVERIFIED: not in schema.sql`; `schema.sql` must hold no `COMMENT ON`; and no table comment may exceed 600 characters (hard stop, so runaway lines fail). |
| `backend/src/db/comments.db.test.ts` | **New.** Runs on `axisandbloom_test` only. It applies `schema.sql` then `comments.sql` and expects `findUncommentedObjects()` to return `[]`. A second test checks that a re-apply is a no-op. |

Format details settled while building (the brief left them open):
- **`UNVERIFIED`:** the text starts with `UNVERIFIED: <why> | ` and the normal fields follow.
- **Deprecated column:** `Class: deprecated | <sentence>`. The original wording is kept for `coffee_sku` (5 columns) and `claude_daily_spend.cents`.
- **Anonymous Express handlers:** the Writer is written as `<route file>.<METHOD> <path>`, for example `users.PATCH /api/users/dial-position`.

## Task 0 numbers, before and after

Production (`axisandbloom`, schema `public`):

| | Count | Commented before (2026-10-16) | Statements in `comments.sql` |
|---|---|---|---|
| Tables | **115** | 1 (`user_bloom_dial_current_position`) | 115 |
| Views | **48** | 0 | 48 |
| Table columns | **1,035** | 6 (5 stock columns + `claude_daily_spend.cents`) | 1,035 |
| **Total** | **1,198** | **7** | **1,198** (exact match to production; no missing, extra or duplicate object) |

View columns (626) are excluded by decision 4. The schema itself carries Postgres's default comment "standard public schema"; that is not in scope.

**After, measured on `axisandbloom_test`** (a prod clone; it lacks `newsletter_subscriber_backup_20260925`, so it has 114 tables and 1,021 columns): `applyCommentsSql` applied every statement except the 15 for the missing backup table (1 table + 14 columns), which it skipped and reported. `findUncommentedObjects()` returned **0**, so tables, views and table columns are 100 percent commented. `npm run db:comments` against the test DB shows the same: `applied 1183 statements`, `skipped 15` (the backup table), `still uncommented: 0`. Counted directly afterwards: **114 / 114 tables, 48 / 48 views, 1,021 / 1,021 table columns commented**.

**After, production: not yet.** `comments.sql` reaches production at the next deploy, through the boot step. It can also be applied by hand without a deploy (`npm run db:comments -- --expect-db axisandbloom`). I have done neither, since both write to production and wait on your go. The expected result is 1,198 / 1,198 with 0 skipped.

### One behaviour to know: `schema.sql` wipes view comments on every boot
`schema.sql` has 48 `DROP VIEW` statements. A dropped view loses its comment, and the recreated view starts with none. During this run, a full-suite `globalSetup` re-applied `schema.sql` on the test DB and left only 8 of 48 views commented. Boot applies `comments.sql` immediately after `schema.sql`, which is why the brief puts it there. The consequence: **if the `[db-comments]` step ever fails at boot, view comments are gone until the next successful apply.** Table and column comments survive, because `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN` do not touch them. Brief 2's lint will catch this state. Until then, watch for `[db-comments] comments.sql not applied` in the boot log.

## Tests

- `comments.format.test.ts`: 9 of 9 pass.
- `comments.db.test.ts`: 2 of 2 pass.
- `npx tsc --noEmit`: clean.
- `npm run lint:catalog`, `lint:customer`, `lint:retention`: exit 0.
- Full suite (`npx vitest run`, run twice): 95 files, 1,131 tests, 16 failed, **exactly the known baseline**. The `src/` failures are only the 6 pre-existing `quizScoring.test.ts` findWinner/isSecondaryClose tests (OT-19); the other 10 are stale compiled `dist/` copies (OT-36: `dist/services/quizScoring`, `quizResultsView`, `customerIntegrity`, `liamProfile`, `palateReads`, `dist/scripts/lintCatalog`). No new failure. Before this brief #219 had 93 files; the 2 new files account for the difference.

## Every UNVERIFIED comment (84: 10 tables, 74 columns)

### Grouped: where to look

| Object(s) | What is unclear | Where Dana should look |
|---|---|---|
| `liam_sms_feedback` (table + 19 columns) | Not in `schema.sql`. Columns are described from the original Task 5 DDL. Prod CHECKs and the `blend_id` FK target were not inspected. | **Drop candidate** (below). `backend/src/features/ai_agent_liam/SOMMELIER_TASK_5_FEEDBACK.md`; `\d liam_sms_feedback` in Cloud SQL Studio. |
| `newsletter_subscriber_backup_20260925` (table + 14 columns) | Not in `schema.sql`. Columns mirror `newsletter_subscriber` as of 2026-09-25, without the later unsubscribe columns. | **Drop candidate** (below). `backend/scripts/correct-subscriber-archetypes.ts`; `WHAT_WE_BUILT.md` ~line 4826; `backend/tmp/subscriber_backup_20260925.json`. |
| `user_payment_detail` (table + 5 columns) | No code reads or writes it. Columns are inferred from their names. **0 rows in prod.** | `backend/src/features/commerce/CLAUDE_CODE_PROMPT_STRIPE_PAYMENT_CAPTURE.md` (decide keep for Stripe, or deprecate). |
| `user_vector_state`, `user_coffee_profile` (+ `match_rank`, `match_confidence`), `roastery_blend_vector` (+ `dimension_id`, `score`), `user_roaster_link`, `quiz_vector` (+ `dimension_id`, `score`) | No code reads or writes any of them; the docs describe them as live. Score scales are undefined, and `dimension_id` has no FK. **All 0 rows in prod.** | `WHAT_WE_BUILT_DB.md` lines ~84-113 (table list). Candidates to mark `deprecated`. |
| `roastery_shipment_details` (table + `status`, `postage_cost`) | No code reads or writes it. Only the unbuilt Stripe brief proposes a writer. **0 rows.** | Stripe brief ~line 127. |
| `cupping_brew_params` (table + `ratio`) | No code, seed or script reads or writes it. Ratio direction (water:coffee or coffee:water) is undefined. **0 rows.** | Decide whether the cupping tool will ever fill it. |
| `cupping_note_dimension_weight.weight` | The scale is undefined. The table is empty by design and nothing reads it. **0 rows.** | `BLOOM_DIAL_ALLOCATION_SPEC.md` section 3, Stage 2. |
| `"order"`: `fulfillment_status`, `is_subscription`, `shipping_fee_charged`, `taxes_collected`, `transaction_fee`, `promo_code` | Written only as defaults at insert, never updated. `fulfillment_status` has no CHECK, yet `catalogService.ts:1318` treats `delivered`/`cancelled` as closed. | `routes/orders.ts:192-198`; Stripe brief. |
| `order_line_item`: `shipment_id`, `wholesale_cost`, `tax_amount_charged`, `vendor_payout_status` | Never written. `vendor_payout_status` has no CHECK. | `routes/orders.ts:228`; Stripe brief. |
| `subscription`: `household_id`, `frequency_days`, `next_delivery_date` | Never written. Only sponsored subscriptions are inserted. | `routes/companyGiftRedemption.ts:108`. |
| `coffee_sku.cost_to_us` | Unit (dollars or cents) is never stated, and no code reads it. | `services/catalogService.ts:870-906` and the admin UI that sends `costToUs`. |
| `coffee_sku.coffee_type` | Never read or written; only the default `'blend'` is set. | `schema.sql` ~line 419. |
| `quiz_answer.next_question_id`, `.vector_impact` | Never read. They look like legacy branching and impact fields, superseded by branch quizzes and `quiz_answer_archetype_score`. | `schema.sql` ~line 611. |
| `user_profile.stripe_customer_id`, `.accepts_marketing` | Never read or written. Marketing consent actually lives on `newsletter_subscriber`. | Stripe brief; prod value counts. |
| `user_phone.sms_beats_opt_in`, `.sms_beats_opt_in_at` | Read by `beatEngine.ts:78` and `cron.ts:119`, but nothing writes them (no UI toggle yet). | The A2P consent item on your calendar. |
| `coffee_archetype.is_active` | Never read or written; `v_coffee_archetype` omits it. | Probably inert. |
| `cupping_note.intensity_score`, `.ai_metadata` | Never read or written. `ai_metadata` is not mentioned in any doc. | `SELECT count(intensity_score), count(ai_metadata) FROM cupping_note`. |
| `coffees.roast_shade` | Free text with no vocabulary or CHECK. | `SELECT DISTINCT roast_shade FROM coffees`. |
| `sommelier_messages.model_used` | No code touches it (9 legacy rows, OT-24). | `SELECT DISTINCT model_used FROM sommelier_messages`. |

Production row counts (read-only, 2026-10-16) for every table no code reads or writes:
- **0 rows:** `user_payment_detail`, `user_vector_state`, `archetype_tunable_variable`, `user_archetype_tuning`, `user_coffee_profile`, `roastery_blend_vector`, `user_roaster_link`, `quiz_vector`, `roastery_shipment_details`, `cupping_brew_params`, `cupping_note_dimension_weight`, `user_flavor_feedback`, `archetype_relationship`, `liam_sms_feedback`.
- **Not empty:** `sommelier_messages` (9), `newsletter_subscriber_backup_20260925` (8).

### Full list

| Object | What was unclear |
|---|---|
| column `coffee_archetype.is_active` | no code or view reads or writes this flag |
| column `cupping_note.intensity_score` | no code reads or writes it; docs say it is NULL by default and assigned per cupping session |
| column `cupping_note.ai_metadata` | no code, doc or seed mentions this column |
| column `user_profile.stripe_customer_id` | no code reads or writes it; the Stripe payment-capture brief plans to use it |
| column `user_profile.accepts_marketing` | no code reads or writes it (newsletter consent lives on newsletter_subscriber) |
| column `user_phone.sms_beats_opt_in` | read by beatEngine and cron but no code writes it (docs: no UI toggle built yet) |
| column `user_phone.sms_beats_opt_in_at` | no code writes it |
| table `user_payment_detail` | no code reads or writes it, docs only say Stripe customer links and payment info |
| column `user_payment_detail.account_type` | never written or documented |
| column `user_payment_detail.provider` | never written or documented |
| column `user_payment_detail.payment_terms` | never written or documented |
| column `user_payment_detail.external_provider_id` | never written or documented |
| column `user_payment_detail.routing_info` | never written or documented |
| table `user_vector_state` | no code, view or seed reads or writes it |
| table `user_coffee_profile` | no reader or writer found in backend/src or backend/scripts, docs only call it "their ranked archetype matches" |
| column `user_coffee_profile.match_rank` | no code uses it |
| column `user_coffee_profile.match_confidence` | no code uses it, scale not defined |
| column `coffee_sku.cost_to_us` | unit not stated in code or docs |
| column `coffee_sku.coffee_type` | no code reads or writes it, only the schema default |
| table `roastery_blend_vector` | no reader or writer found in backend/src or backend/scripts, docs only say where each blend sits in flavor-dimension space |
| column `roastery_blend_vector.dimension_id` | no FK declared |
| column `roastery_blend_vector.score` | scale not stated |
| table `user_roaster_link` | no reader or writer found in backend/src or backend/scripts, docs only call it "roastery staff accounts" |
| column `quiz_answer.next_question_id` | no code reads it |
| column `quiz_answer.vector_impact` | no code reads or writes it |
| table `quiz_vector` | no reader or writer found in backend/src or backend/scripts, docs only say "dimension scores from a quiz session" |
| column `quiz_vector.dimension_id` | no FK declared |
| column `quiz_vector.score` | scale not stated |
| column `subscription.household_id` | no code writes it |
| column `subscription.frequency_days` | no code writes it |
| column `subscription.next_delivery_date` | no code writes it |
| column `"order".fulfillment_status` | no code updates it after insert and no CHECK exists |
| column `"order".is_subscription` | no code writes it |
| column `"order".shipping_fee_charged` | no code writes it, always the default |
| column `"order".taxes_collected` | no code writes it, always the default |
| column `"order".transaction_fee` | no code writes it, always the default |
| column `"order".promo_code` | no code writes it |
| table `roastery_shipment_details` | no reader or writer found in backend/src or backend/scripts, only a Stripe brief proposes an admin shipped endpoint that writes it |
| column `roastery_shipment_details.status` | no code writes it and no CHECK exists |
| column `roastery_shipment_details.postage_cost` | unit not stated |
| column `order_line_item.shipment_id` | no code writes it |
| column `order_line_item.wholesale_cost` | no code writes it |
| column `order_line_item.tax_amount_charged` | no code writes it, always the default |
| column `order_line_item.vendor_payout_status` | no code writes it and no CHECK exists |
| column `sommelier_messages.model_used` | no code writes or reads this column and its values in prod are unknown |
| column `coffees.roast_shade` | no vocabulary or CHECK defines the allowed values |
| table `cupping_brew_params` | no code, seed or script reads or writes this table, so it may be unused or hand-entered |
| column `cupping_brew_params.ratio` | the definition is not documented (water per coffee or coffee per water) |
| column `cupping_note_dimension_weight.weight` | no rows and no code, so the scale and range are not defined anywhere |
| table `liam_sms_feedback` | not in schema.sql |
| column `liam_sms_feedback.id` | not in schema.sql |
| column `liam_sms_feedback.user_id` | not in schema.sql |
| column `liam_sms_feedback.order_id` | not in schema.sql |
| column `liam_sms_feedback.blend_id` | not in schema.sql |
| column `liam_sms_feedback.phone_number` | not in schema.sql |
| column `liam_sms_feedback.direction` | not in schema.sql |
| column `liam_sms_feedback.body` | not in schema.sql |
| column `liam_sms_feedback.status` | not in schema.sql |
| column `liam_sms_feedback.scheduled_for` | not in schema.sql |
| column `liam_sms_feedback.sent_at` | not in schema.sql |
| column `liam_sms_feedback.provider_message_id` | not in schema.sql |
| column `liam_sms_feedback.reply_to_id` | not in schema.sql |
| column `liam_sms_feedback.haiku_parsed` | not in schema.sql |
| column `liam_sms_feedback.parsed_signal_type` | not in schema.sql |
| column `liam_sms_feedback.parsed_rating` | not in schema.sql |
| column `liam_sms_feedback.parsed_sentiment` | not in schema.sql |
| column `liam_sms_feedback.parsed_descriptors` | not in schema.sql |
| column `liam_sms_feedback.firestore_feedback_doc_id` | not in schema.sql |
| column `liam_sms_feedback.created_at` | not in schema.sql |
| table `newsletter_subscriber_backup_20260925` | not in schema.sql |
| column `newsletter_subscriber_backup_20260925.email` | not in schema.sql |
| column `newsletter_subscriber_backup_20260925.user_id` | not in schema.sql |
| column `newsletter_subscriber_backup_20260925.subscribed` | not in schema.sql |
| column `newsletter_subscriber_backup_20260925.created_at` | not in schema.sql |
| column `newsletter_subscriber_backup_20260925.source_id` | not in schema.sql |
| column `newsletter_subscriber_backup_20260925.first_name` | not in schema.sql |
| column `newsletter_subscriber_backup_20260925.archetype` | not in schema.sql |
| column `newsletter_subscriber_backup_20260925.experimental` | not in schema.sql |
| column `newsletter_subscriber_backup_20260925.confidence` | not in schema.sql |
| column `newsletter_subscriber_backup_20260925.quiz_session_key` | not in schema.sql |
| column `newsletter_subscriber_backup_20260925.campaign` | not in schema.sql |
| column `newsletter_subscriber_backup_20260925.campaign_vid` | not in schema.sql |
| column `newsletter_subscriber_backup_20260925.campaign_attributed_at` | not in schema.sql |
| column `newsletter_subscriber_backup_20260925.backed_up_at` | not in schema.sql |

## Drop candidates (for a later decision; nothing was dropped)

| Table | Rows | Why |
|---|---|---|
| `liam_sms_feedback` | 0 | Left over from the rename to `sommelier_sms_feedback` (commit `eff1d98`, created `78c62f4`). No `.ts` reference, not in `schema.sql`, `Class: deprecated`. `WHAT_WE_BUILT_DB.md:186` wrongly calls it a "legacy alias". |
| `newsletter_subscriber_backup_20260925` | 8 | Backup written by the 2026-09-25 subscriber-archetype correction. The brief at the time said "never dropped; it is part of the record", so dropping it needs you to reverse that decision. Not in `schema.sql`, `Class: snapshot`. It is also missing from the test DB clone. |

Others you may want on the same list later (not asked for, flagged only): the 0-row, no-code tables in the paragraph above. Of those, `archetype_relationship`, `user_flavor_feedback` and `sommelier_messages` already carry `Class: deprecated` from the docs.

## Where docs and code disagreed (decision 6: the comment follows the code)

| Object | Docs say | Code does | Evidence |
|---|---|---|---|
| `user_bloom_dial_current_position` | The old `schema.sql` comment and `WHAT_WE_BUILT_DB.md:171`: movement history lives in Firestore `users/{uid}/dial_events` | C3 Part C retired that write. History is Postgres `customer_dial_event` (`customerFacts.record.dialEvent`). The new comment says so. | `routes/users.ts:581-596`; `customerFacts.ts:164-178`. Stale route comments at `users.ts:505,540`. |
| `user_bloom_dial_current_position` | Keyed with `dial_sort_order` (`WHAT_WE_BUILT_DB.md:171`) | `dial_sort_order` was dropped in brief 5a; `slot_id` is the only position reference | `schema.sql` ~2672-2679 |
| `claude_daily_spend.cents` | "Not read or written by the app" | True for app TypeScript, but the boot backfill `UPDATE claude_daily_spend SET usd_micros = cents::BIGINT * 10000 WHERE usd_micros = 0 AND cents > 0` reads it on every boot. **For OT-30, remove that UPDATE before dropping the column.** | `schema.sql` ~4272 |
| `api_event` | Purged by age via `/api/cron/purge-api-events` (doc line 127 and the `schema.sql` comment above the table) | The purge route was retired 2026-09-25. The table is append-only, guarded by `lint-retention.mjs`. | `routes/cron.ts:590-599`; `scripts/lint-retention.mjs:86` |
| `user_type` | "subscriber, admin, roaster partner, etc." | Only `admin` and `customer` are seeded or checked | `schema.sql` ~1869; `routes/admin.ts:899,926` |
| `roaster.is_active` | "Read by nothing at request time" | Read at admin time by the roastery portal, `catalogService` and `catalogImport` | `roasteryPortalReads.ts:414,426,454`; `catalogService.ts:141,1234` |
| `token_events` / `user_tokens` | Reasons include `purchase` and admin grants via `tokenService.grantTokens()` | `grantTokens` has no callers. Admin grants exist only as the SQL function `grant_tokens`. `purchase` is never written. The order bonus is an inline copy of the SQL in `orders.ts`. | `tokenService.ts:65`; `routes/tokens.ts:25`; `routes/orders.ts:275-285` |
| `archetype_tunable_variable`, `user_archetype_tuning`, `user_vector_state` | Listed as live archetype-engine pieces (`WHAT_WE_BUILT_DB.md:84-88`) | No reader or writer. `schema.sql` calls the first two "reserved". | `schema.sql` ~354-380, 1654-1657 |
| `user_payment_detail` | "Stripe customer links and payment info" | Nothing reads or writes it, and no Stripe code exists | grep of `backend/src` and `backend/scripts` |
| `user_coffee_profile`, `roastery_blend_vector`, `user_roaster_link`, `quiz_vector`, `roastery_shipment_details` | Described as live tables | No code reads or writes any of them (all 0 rows) | `WHAT_WE_BUILT_DB.md:89,93,94,108,113` |
| `sommelier_sms_feedback` | Outbound rows track `delivery_status`; inbound rows store `firestore_feedback_doc_id` | The column is `status`. `firestore_feedback_doc_id` has not been written since C3. | `WHAT_WE_BUILT_DB.md:187`; `liamSmsFeedback.ts:240,266` |
| `sommelier_sms_feedback` | Legacy scheduling via `(user_id, blend_id)` is live | `schedulePostDeliveryMessage` has no live caller (retired by HOME_TASK_8). Live outbound rows come from the beat dial-in cron. | `routes/orders.ts:305-318`; `routes/cron.ts:149` |
| `notification_log` | "email/SMS notifications sent" | Only SMS is logged; email (Resend) is not; `order_id` is never set | `WHAT_WE_BUILT_DB.md:124`; `smsProvider.ts:60-85` |
| `user_lifecycle_stage` | Seeded with 9 rows | 11 rows are seeded (`SPONSORED_TRIAL_ENDING` and `SPONSORED_LAPSED_NO_PAYMENT` added) | `WHAT_WE_BUILT_DB.md:117`; `schema.sql` ~764-775 |
| `coffee_sku` | Writers `catalogService.upsertSku` / `.restockSku` | There is no `restockSku`. The real writers are `upsertSkuInTx`, `retireCoffee`, `restoreCoffee`, `deactivateRoastery` and `reactivateRoastery`. | `WHAT_WE_BUILT_DB.md:264`; `catalogService.ts:750,773,892,903,1414,1452` |
| `subscription` | "Recurring delivery schedules" | Only company-sponsored subscriptions are created and lapsed; no cadence is written | `companyGiftRedemption.ts:108`; `cron.ts:476-491` |
| `coffees.story_generated_at` | Stamps automated generation only, not admin edits | The admin story save also sets it | `routes/admin.ts:1008`; `routes/coffees.ts:354` |
| `dial_position_signal` | Only writer is `dialSuggestion.recordCuppingSignal` | Also `dialPositionSignal.writeDialPositionSignal`, from order feedback, `liamSmsFeedback` and `beatEngine.respondToDialInBeat`. Order-feedback revisions UPDATE `superseded_at`. | `dialPositionSignal.ts:12-40`; `routes/orders.ts:472-480` |
| `dial_position_signal` | `sms_feedback` source is still unpopulated; `onsite_feedback` rows are only appended | `sms_feedback` is written now; a revised onsite submission supersedes the prior row | `liamSmsFeedback.ts:243-262`; `routes/orders.ts:472-476` |
| `coffee_dial_slot.dimension_id` | Written by `catalogService.renameSlot` | `renameSlot` does not touch it; only the seed does | `catalogService.ts:1039-1042` |
| `lookup_value` | Seeds use `ON CONFLICT DO UPDATE` | Only the first seed block does; the origin_region and roastery_portal seeds use `DO NOTHING` | `schema.sql` ~1899 vs ~3670, 6086, 6116, 6260 |
| `coffee_slot_price` | `UNIQUE(archetype, dial_sort_order, weight_oz)` (history entry) | `UNIQUE(slot_id, weight_oz)`; those columns were dropped in brief 5a | `schema.sql` ~2648-2668 |
| `customer_liam_action` | Readers: "none yet" | `v_customer_timeline` reads it | `schema.sql` ~5384 |
| `customer_dial_event` | Read only by `customerReads.getRecentDialActivity` | Also read by `v_customer_timeline` and `customerReads.getFactsWatermark` | `schema.sql` ~5355; `customerReads.ts:304,344` |
| `customer_feedback_descriptor` | Read only by `v_collaborative_flavor_wheel` | Also read by `v_customer_feedback_current` | `schema.sql` ~5258 |
| `customer_liam_recommendation` | `v_palate_slot_candidates` reads it | It does not. The real view readers are `v_customer_timeline`, `v_palate_evidence`, `v_palate_recommendation_outcome` and `v_customer_calibration`. | `schema.sql` ~5769-5840 |
| `qr_scan_event` enums | `qr_auth_state_enum` / `qr_destination_enum` values as listed in the doc | The schema adds `no_orders` and `bag_picker`, `brand_landing`, `door_choice` | `schema.sql` ~4160-4182; `WHAT_WE_BUILT_DB.md:426-427` |
| `customer_order_kind` | Class "dimension, not a fact" | There is no `dimension` class in the vocabulary, so it is commented `master` (seeded reference list), not the `fact` default for `customer_*` | `WHAT_WE_BUILT_DB.md:329` |
| `quiz_session_interpretation` | Line 312 says fact; line 34 says "SCD Type 2 dimension" | The doc contradicts itself; it is commented `fact` per the ownership table | `WHAT_WE_BUILT_DB.md:34,312` |
| `v_subscriber_quiz_results` | Column `confidence_at_signup` | The column is `food_signal_alignment_at_signup` | `WHAT_WE_BUILT_DB.md:243` |
| `sommelier_evaluation` | Writers are `sommelierEvaluator` and `outcomeTracker` | `routes/sommelier.ts` POST `/start` also UPDATEs `session_started`, `started_at` and `updated_at`; `outcomeTracker` also reads it | `routes/sommelier.ts:789`; `outcomeTracker.ts:41,63` |
| `v_roastery_portal_dimension_match` | Takes "the active home placement's slot" | Takes the active home placement, else any active placement | `WHAT_WE_BUILT_DB.md:383`; `schema.sql` ~6521-6527 |
| `liam_sms_feedback` | "Legacy alias for `sommelier_sms_feedback`" | A separate empty table | `WHAT_WE_BUILT_DB.md:186` |
| `transactional_email_log` | One writer | A second writer, `roasteryPortalNotify.notifySubmission` | `services/roasteryPortalNotify.ts` |

For brief 3 (one-writer rule), worth knowing now: several tables already have more than one writer by design or by drift. Examples are `coffees` (8 or more writer functions, including the AI and story columns, which have no ownership-table row), `user_tokens`/`token_events`, `dial_position_signal`, `sommelier_evaluation` and `transactional_email_log`. The comments list them all as they are today.

## Firestore inventory (also at the top of `comments.sql`)

Only the backend uses Firestore, through `backend/src/services/firebase-admin.ts:25` (named database `axis-bloom-fs`). `frontend/src` does not import `firebase/firestore`, and `cloud-functions` uses only Storage. The repo has no `firestore.rules` file. `firestore.indexes.json` indexes only two retired collections.

| Collection | Purpose | Writer | Readers |
|---|---|---|---|
| `users/{uid}` | Mirror of name, email and token balance (Cloud SQL is the truth) | `routes/users.ts` (GET `/profile` sync, PATCH `/profile`), `tokenService.spendToken`/`grantTokens`, the `routes/orders.ts` token bonus; `staleGuestCleanup` deletes it with all subcollections | none |
| `users/{uid}/sommelier_sessions/{id}/messages` | Liam chat transcript | `routes/sommelier.ts` | `routes/sommelier.ts` |
| `config/sommelier` | Sommelier runtime config incl. `aiControls` | seed (only if absent), `routes/admin.ts` (3 routes) | `sommelierConfig` (live `onSnapshot`), `routes/admin.ts` |
| `config/sommelier/audit` | Admin config-change audit trail | `routes/admin.ts` | `routes/admin.ts` (GET `/ai-ops`) |
| `config/sommelierCentroids` | Per-intent feature centroids | seed (only if absent), `routes/admin.ts` recompute | none beyond the seed's existence check |
| `admin_stats/brew_profile` | Brew-profile write counters | `brewProfile` | `brewProfile.getBrewProfileCounters` |
| `admin_stats/liam_writeback` | Unresolved write-back counter | `liamWriteBack` | `liamWriteBack.getLiamWriteBackCounters` |
| `users/{uid}/feedback_events`, `/dial_events`, `/metadata/brew_profile`, `/metadata/taste_journey`, `/metadata/confidence_profile`, `/quiz_sessions`, `/liam_saves`, `/sommelier_evaluations` | **Retired** stores, replaced by Postgres facts in Customer Blueprint C2/C3. **They still hold data; nothing deletes it.** | none (retired, C2/C3) | `customerIntegrity` check 15 only (post-cutover write detector, due for removal after 2026-10-27); some `backend/scripts` backfills |

Not inventoried (outside the brief's `backend/src` scope): 6 one-off scripts in `backend/scripts` use Firestore (`backfillCustomerFacts.ts`, `backfillLiamRecommendations.ts`, `lint-customer.mjs`, `migrateSavedItems.ts`, `update-intent-addendums.mjs/.ts`).

## Judgment calls you may want to revisit

- **Class by the naming rule:** lookup and reference tables without a prefix (`user_type`, `quiz_type`, `cupping_note`, `lookup_value`, `coffee_size`, etc.) are `operating` by the rule, even though they behave like master data. `quiz_session`, `"order"` and `order_line_item` are `fact` because the Customer ownership table says so.
- **Length:** the brief's aim is under 300 characters per table comment. The median is about 386 characters (whole statement line); the Purpose field averages 140 characters and the Readers field 78. I kept accuracy over the aim and set a hard test limit of 600 (one comment was trimmed to meet it). Brief 3's lineage scan will generate readers automatically, so the Readers lists are the easy place to trim later.
- **Views with no code reader** carry `Readers: none (manual SQL)` or name `reporting_ro` / Looker Studio.

## For `WHAT_WE_BUILT.md` (#220)

**220. Data catalog, brief 1: every table, view and column describes itself (2026-10-16).** The new `backend/src/db/comments.sql` holds 1,198 `COMMENT ON` statements, one for each of production's 115 tables, 48 views and 1,035 table columns. Each table and view comment follows `Purpose | Class | Writer | Readers | Since`; 84 comments that code and docs could not settle start with `UNVERIFIED`. The Firestore collection inventory is a `-- firestore:` block at the top of the file. The file is applied at every boot right after `schema.sql` on the owner pool (`[db-comments] applied N statements`; non-fatal), and by hand with `npm run db:comments -- --expect-db <db>`. The seven comments that already lived in `schema.sql` moved into `comments.sql`. The Dockerfile now copies `comments.sql` into the image. The new `dataCatalogQueries.findUncommentedObjects()` is the query brief 2's lint will use. Tests: a format lint with no DB query, and a test-DB run that leaves zero uncommented objects. No DDL, grant, seed or data change. Closing report: `backend/src/features/data_catalog/CLOSING_REPORT_1.md`.

## For `WHAT_WE_BUILT_DB.md`

> **As of 2026-10-16 (data catalog brief 1, `WHAT_WE_BUILT.md` #220)**: every table, view and table column in `public` carries a description in the database itself (`COMMENT ON`, read by Dataplex / Knowledge Catalog once its Cloud SQL integration is enabled). The comments live only in `backend/src/db/comments.sql`, applied at every boot after `schema.sql`; `schema.sql` holds no `COMMENT ON`. The Firestore inventory is at the top of the same file. This doc keeps the history and the why; the comment file is the source for what each object is now.
