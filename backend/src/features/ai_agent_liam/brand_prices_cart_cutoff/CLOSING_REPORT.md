# Closing report: Liam brand answers, prices, quiet cutoff (Rev 3)

**2026-10-24. Done on prod.** Code `7f2943c`, Actions run `40145979252` green (backend + frontend), revision `axis-bloom-backend-00777-w4x`. Docs and `CATALOG.md` from prod in the follow-up commit. Full record: `WHAT_WE_BUILT.md` #235, `SOMMELIER_BUILT.md` S115, `WHAT_WE_BUILT_DB.md`, `OPEN_TASKS.md` OT-37 / OT-38.

## Prerequisites (checked before any code)
- Liam L1–L3 live (S100–S102).
- Catalog Blueprint 1–5b live (#178–#183); prod has `v_coffee_sellable_slot` (6 sellable rows, all priced), `coffee_slot_price`, `coffee_size`.
- Data catalog 1–3 live (#220–#222): `comments.sql`, `lineage.json`, `lint:lineage`.
- `sommelier_answer` absent; no Rev 2 code anywhere.

## Where the answers block sits
Right after `LIAM_BASE_PROMPT`, in the `shared` cache tier (the first `cache_control` block, before the catalog block). It contains one line per current prefix/both row in `sort_order`, then `Rules:` and `brandFacts.rules`. If `brandFacts` is disabled, the table is empty, or the live doc lacks `brandFacts`, the prompt is byte-identical to before.

## Seeded rows (Dana's copy, verbatim, `created_by = seed`)
| order | key | kind | delivery |
| --- | --- | --- | --- |
| 1 | what_we_are | brand | prefix |
| 2 | how_we_match | brand | prefix |
| 3 | sourcing | brand | both |
| 4 | partner_privacy | deflection | both |
| 5 | what_you_get | brand | both |
| 6 | ordering | brand | prefix |

`what_you_get` ("Coffee comes as 12 oz whole bean…") breaks integrity check 3 (no price, size or count). It is reported at boot and on System Health, not blocked. The admin card would refuse the same text, so the fix is an edit there (OT-37).

## Keys `applyMissingKeys` added to live `config/sommelier`
Read from the first boot's log line and the `config/sommelier/audit` entry (uid `deploy`):
`brandFacts.enabled`, `brandFacts.cacheSeconds`, `brandFacts.rules`, `sessionLimits.warnAtTurnsRemaining`, `sessionLimits.closingTurns`, `sessionLimits.nudges.closing`, `sessionLimits.nudges.last`, `sessionLimits.customerCopy.limitNotice`, `sessionLimits.customerCopy.closedNotice`. Nothing that already existed was touched; the second instance added nothing.

## Dana's admin-portal edit: `maxTurns` 8 → 16
These keys are 8 live, and each intent's value overrides the global one: `sessionLimits.maxTurns`, `intents.PROFILE_AMBIGUOUS.maxTurns`, `intents.MATCHED.maxTurns`, `intents.RECOMMENDATION_MISS.maxTurns`, `intents.TASTE_EVOLUTION.maxTurns`, `intents.DISCOVERY_SEEKER.maxTurns`, `intents.CONVERSION.maxTurns`, `intents.EXPLORATION.maxTurns`. All eight show as drift rows under Configuration → Config Source of Truth. Untick the four OT-27 rows before Apply.

## `CATALOG.md` entry
`sommelier_answer` is under Sommelier, Class `master`. Writer: `sommelierAnswerService.setAnswerInTx, sommelierAnswerService.retireAnswerInTx; seed`. Readers: `sommelierReads`. It is regenerated from prod with hash `85ad1351d6bf`.

## Live smoke (marked test admin, demoted and disabled after)
- **Brand:** Liam stated the partner model, kept partners private, and would not confirm "Joe Coffee".
- **Price:** after his pick, he quoted "$32 for 12 oz whole bean" for Coado and "$29" for Clean Fruit, both matching the catalog.
- **Cutoff at the live 8:** the copy and threshold arrived on `/start`. Reply 8 closed in voice with no question (`turn_limit`), and the next message got a 409.
- **Memory:** the next session opened from the V60 / black facts saved in the closed one.
- **Admin:** a roaster-name write and a `$` write were both refused, naming the rule, and nothing was written.

## Deviations and fixes on the way
- **Version key:** `getAnswersVersion` is `MAX(id)` plus `MAX(superseded_at)`, because a retire adds no row.
- **Lock:** the supersede locks the current row through `UPDATE … RETURNING`, not a separate `SELECT … FOR UPDATE`. That keeps every SELECT in `sommelierReads`.
- **Retire record:** the retire's note and who goes to the log line, since only `superseded_at` may be updated.
- **Table placement:** the table sits after `lookup_value` in `schema.sql`, because its FKs need it.
- **Grants:** the database grant also enforces supersede-only.
- **Scope additions:** `index.ts` (seed + integrity at boot), `AdminSystemHealth.tsx`, and the new `LiamAnswersCard.tsx`.
- **Literal:** "whole bean" in the price line is the one literal; the catalog does not model the bag's form.
- **Closed label:** `closedNotice` shows only for a turn-limit close. A daily-cap close and any other close keep "Conversation ended".
- **Fixed:** the Intent Editor could not save `MATCHED` (the PATCH validated against a hard-coded list missing it).
- **Deploy gate:** two new high advisories had appeared. body-parser got a patch bump, and zod (unused) moved to `^4.6.7`.

## Watch / open
- Under the closing nudge, reply 7 still asked a question.
- OT-38: on a brand-new account Liam invented a "last order" in his opening. This predates the brief, and the brief allows no prompt fix for it.
