# Handoff: resolve the 84 UNVERIFIED catalog comments

> For a NEW Cowork session acting as CTO (survey → decisions → Claude Code briefs → review). Written 2026-10-16 by the data-catalog session. Independent of the writer-consolidation handoff; either can go first.

## Kickoff prompt (Dana pastes this into the new session)

```
You are the CTO for the Axis & Bloom repo (C:\Users\DanaB\axis-and-bloom). Read backend/src/features/data_catalog/UNVERIFIED_RESOLUTION_HANDOFF.md, then the "Every UNVERIFIED comment" section of CLOSING_REPORT_1.md in the same folder, and the UNVERIFIED rows in CATALOG.md at the repo root. Goal: zero UNVERIFIED comments. Most of these are decisions, not code: for each object tell me what it is, what the evidence says, and recommend one of keep / deprecate / drop-later / define. Group them so I decide in batches, not one by one. Then write one Claude Code brief in backend/src/features/data_catalog/ that applies my decisions to backend/src/db/comments.sql (and schema.sql only where a decision adds a CHECK or a unit). I run it myself, merge to main, no PRs. Nothing is dropped from the database in this work; a "drop-later" decision is recorded in the comment, not executed. Don't add process or extra tasks beyond this.
```

## Context in one paragraph

Data-catalog brief 1 (2026-10-16) wrote a `COMMENT ON` for every table, view and column in production. 84 of them (10 tables, 74 columns) start with `UNVERIFIED` because neither the code nor the docs settled what the object is for. They show on the System Health "Data catalog" card (check #2) and in `CATALOG.md`. They are harmless until resolved; nothing fails because of them. Resolving them is how the catalog becomes trustworthy.

## The 84, grouped (full list in CLOSING_REPORT_1.md)

| Group | Objects | Likely outcome |
|---|---|---|
| Dead tables from the original Supabase-era design, 0 rows, no code | `user_vector_state`, `user_coffee_profile`, `roastery_blend_vector`, `quiz_vector`, `user_roaster_link`, `cupping_brew_params`, `cupping_note_dimension_weight` (+ their columns) | `deprecated` (the abandoned customer-vector / coffee-vector distance model, 2026-09-26) or drop-later |
| Commerce placeholders, 0 rows or never written | `user_payment_detail`, `roastery_shipment_details`; columns on `"order"`, `order_line_item`, `subscription`, `user_profile.stripe_customer_id`, `.accepts_marketing` | keep with "reserved for Stripe/fulfillment, not written yet" or deprecate; check the Stripe brief under `features/commerce/` |
| Real columns with no stated unit or vocabulary | `coffee_sku.cost_to_us` (dollars or cents?), `coffees.roast_shade` (free text), `cupping_note_dimension_weight.weight` (scale), `roastery_shipment_details.postage_cost` | define: state the unit in the comment, add a CHECK where cheap |
| Legacy quiz fields superseded by branch quizzes | `quiz_answer.next_question_id`, `.vector_impact` | deprecate |
| Prod-only tables not in `schema.sql` | `liam_sms_feedback` (0 rows, rename leftover), `newsletter_subscriber_backup_20260925` (8 rows, deliberate backup from the quiz resync fix) | drop-later, recorded in the comment |
| Odd ones | `coffee_archetype.is_active`, `cupping_note.intensity_score`, `.ai_metadata`, `sommelier_messages.model_used`, `user_phone.sms_beats_opt_in` (read by cron, never written: the A2P consent UI isn't built) | one decision each |

## Rules already decided by Dana (do not re-open)

- Nothing is deleted or dropped from the database. "Drop-later" is a comment, not an action.
- Do not develop on conceptual theories or assumed weights; where a scale or unit is undefined and no data exists, say "undefined, table unused" rather than inventing one.
- Comment format is fixed (brief 1, decisions 2 and 3): `Purpose | Class | Writer | Readers | Since`; `Class: deprecated` for retired objects. Resolving an object means removing the `UNVERIFIED:` prefix and writing the real fields.
- Every brief ends with `npm run lint:lineage`, `npm run catalog:md`, and committing `CATALOG.md`. Check #2 on System Health should then show fewer than 84, and finally 0.

## What "done" looks like

System Health "Data catalog" check #2 reads 0 UNVERIFIED; `CATALOG.md` has no `UNVERIFIED` rows; every dead or placeholder object says so in its own comment, so no future session proposes a replacement for it without seeing that it already exists.
