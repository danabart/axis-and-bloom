# Handoff: consolidate multi-writer tables (one door per table)

> For a NEW Cowork session acting as CTO (survey → options → Dana's decisions → Claude Code briefs → review). Written 2026-10-16 by the data-catalog session. Do not start until data-catalog brief 3 is EXECUTED (check its Status line); the scanner and `lineage.json` it produces are the ground truth this work reads.

## Kickoff prompt (Dana pastes this into the new session)

```
You are the CTO for the Axis & Bloom repo (C:\Users\DanaB\axis-and-bloom). Read backend/src/features/data_catalog/WRITER_CONSOLIDATION_HANDOFF.md, then backend/src/features/data_catalog/README.md, CLOSING_REPORT_3.md and backend/lineage.json. Goal: every table has exactly one writer module, the way the coffee catalog already does (catalogService) and the customer facts do (customerFacts). Survey first, then give me a short ranked list of the multi-writer tables with, for each, the recommended single door and the effort. I decide the order. Then write Claude Code briefs, one table or one small group per brief, in backend/src/features/writer_consolidation/. I run them myself. No PRs, I merge to main. Don't add process or extra tasks beyond this.
```

## Context in one paragraph

The data-catalog workstream (briefs 1 to 3, same folder) gave every table a comment with a declared `Writer:` field, a generated `CATALOG.md`, and a CI lint (`npm run lint:lineage`) that fails a push when a table gains a writer not in its declared list. Brief 3 froze the current state as "declared" so drift cannot grow. It did NOT reduce writers. This handoff is the reduction.

## The 16 tables (brief 3 Task 0, 2026-10-16, app modules only; seed/backfill in brackets)

| Table | Writers found | Note |
|---|---|---|
| `user_profile` | 7: admin, auth, companyGiftRedemption, household, quiz, users, staleGuestCleanup [seed] | worst case; start here |
| `coffees` | 4: admin, coffees, catalogService, qr | should already be catalogService only (Catalog Blueprint rule); the other three are leaks |
| `token_events`, `user_tokens` | 4 each: auth, orders, tokenService, db | tokenService is the obvious door |
| `dial_position_signal` | 3: orders, dialPositionSignal, dialSuggestion [seed] | |
| `company_gift_code` | 3: companyGiftRedemption, companyGiftsAdmin, cron | |
| `sommelier_evaluation` | 3: sommelier, outcomeTracker, sommelierEvaluator | known since Customer Blueprint C3 |
| `newsletter_subscriber` | 2: newsletter, features/marketing/unsubscribe [2 backfills] | known since the subscriber audit |
| `beat_event` | 2: beatEngine, cron [backfill] | |
| `roaster` | 2: admin, catalogService | catalogService is the door |
| `sommelier_sms_feedback` | 2: cron, liamSmsFeedback | |
| `subscription` | 2: companyGiftRedemption, cron | |
| `transactional_email_log` | 2: newsletter, roasteryPortalNotify | |
| `user_brew_card` | 2: brewCard, cron | |
| `user_email` | 2: auth, users | |
| `quiz_session` | false positive (integrity probe), already excluded by the scanner | ignore |

Another 17 tables have one app writer plus the `schema.sql` seed; that is allowed and declared (`; seed`). Not in scope.

## Rules already decided by Dana (do not re-open)

- One write service per table, every endpoint calls it ("one door, not one page", 2026-08-27). Views are the read path.
- Writes go through the app, but direct DB writes will keep happening, so integrity that matters is enforced in the DB (triggers), not only in code.
- Derive, don't copy ("everything should be derived so we won't have data drifts", 2026-10-09); SCD/supersede history on mutable tables that could drift.
- Nothing is deleted from the DB. Nothing is dropped in this work.
- Each brief ends by updating the table's `Writer:` field in `backend/src/db/comments.sql` to the single door, running `npm run lint:lineage` (must pass) and `npm run catalog:md`, and committing `CATALOG.md`.
- A cron that must write (e.g. `beat_event`, `user_brew_card`) calls the service; it does not get its own SQL.

## What "done" looks like

`lineage.json` shows one app module per table for all 15 (plus `; seed` where applicable), the Data catalog card on System Health shows zero "more than one writer", and the `Writer:` fields in `comments.sql` each name one module.

## Suggested order (the new session may propose a different one)

1. `coffees` and `roaster` (small; closes leaks in a door that already exists).
2. `token_events` + `user_tokens` (one brief, tokenService).
3. `user_profile` (biggest; may need its own survey first).
4. The cron pairs: `beat_event`, `user_brew_card`, `subscription`, `company_gift_code`, `sommelier_sms_feedback`.
5. The rest.
