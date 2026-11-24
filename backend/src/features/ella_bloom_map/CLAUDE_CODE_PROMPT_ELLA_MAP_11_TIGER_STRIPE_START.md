# Ella's Bloom Map, brief 11: Tiger Stripe becomes the first bag for Chocolate & Nutty leaning fruity. One start rule. Data only.

> Folder: `backend/src/features/ella_bloom_map/` · Written 2026-11-24 (CTO session; decision by Dana) · Model: Sonnet is fine (G1.13: no money, no irreversible data) · Mode: test first, then live on Dana's go
> Contract: brief 7 (`CLAUDE_CODE_PROMPT_ELLA_MAP_7_MATCH_RULE_AND_CUSTOMER_PAGE.md`: the first bag is a `dial_start_rule` row) and its seed `backend/src/scripts/ellaMapStartRules_2026_11_17.ts`, which is the template for the script here. Briefs 9 and 10 added the rule's coffee sentence and lead; Task 0 reads how they are stored today. No schema, no view, no new table, no code beyond one script.
> Status: **done on production 2026-11-24.** Rule #19 (Tiger Stripe) replaces #13 (Fabricator), which is superseded; a rerun writes nothing. `CLOSING_REPORT_11.md`.

**Guardrails (`DEVELOPMENT_GUARDRAILS.md`).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (the rule is a row, entered through the service; no coffee id or family code in the script beyond the data block resolved by name) · G2.4 no new table or view · G2.5 / G2.6 one writer, one door: `dialPlacementService.setStartRuleInTx` (and the existing writer of the rule's coffee sentence and lead, as Task 0 names it); reads through `v_dial_start_rule` and `v_dial_start`; no SQL writes in the script · G2.11 the old row is superseded by the service, never deleted · G2.20 quiz answers and the roaster's portal answers are read, never changed · G3.3 idempotent, a second run writes nothing · G3.7 prod only with `--expect-db axisandbloom` and after the STOP · G3.9 reuse, do not fork; Task 0 lists the functions called by name · G1.5 / G1.6 one run, one closing report · G1.14 nothing beyond this rule.
Mode: test, then live. One STOP: after the test run and the production dry-run, for Dana's go.

## Decision (Dana, 2026-11-24). Do not re-open.

"Tiger stays as the first bag" for Chocolate & Nutty leaning fruity. Fabricator House Roast is held for launch and stops being anyone's first bag. Evidence behind it:
- Joe Bean's portal answer for Tiger Stripe: shines as espresso, also good as cold brew, batch brew / drip and pour-over, works both ways with milk.
- The 2026-11-15 quiz pull: of the six real people in this group with stored answers, all six picked "It has no bitterness or intensity" as what would bother them. Fabricator is the lighter coffee with a citrus finish.
- The blind cupping of 2026-09-30: both cuppers put Fabricator on the fruit side and Tiger Stripe on the chocolate side.

1. **The rule that changes**: `chocolate_nutty`, priority 3, condition `fruity_gt_balanced`, no also-condition. Its first bag goes from **Fabricator House Roast** to **Tiger Stripe Espresso** (both Joe Bean Roasters; resolve by roaster and name, exactly one active row each or STOP). Family, priority, condition and admin label stay as they are.
2. **Its sentences** (CTO defaults; Dana edits them on `/admin/map`):
   - customer reason: `You asked for a stronger cup and picked one bright answer. This is chocolate first, with a little lift.`
   - coffee sentence: `This one is chocolate first with a little lift, and it holds up however you brew it.`
   - lead: **Geometric Filter Coffee**, lead sentence `More fruit, and sweeter.`
   Store each where the current row stores it. If a field no longer exists after brief 10, leave it out and say so.
3. **Not changed**: the espresso row (`chocolate_nutty` priority 2, already Tiger Stripe, with its own sentences and its lead The Waverly); every other start rule; every step row, including the steps to and from Fabricator; family, lean and ring of every coffee; prices, SKUs, active flags, slots, names; quiz content and scoring; any recorded `customer_match_decision`. Holding Fabricator, Brazil, Indonesia and D.R. Congo for launch is a separate decision and is not applied here.
4. **Publish**: only if Task 0 finds that a start rule change waits on a publish. Brief 7 made start rules unversioned, so the expectation is no publish. If one is needed, use the existing publish function with the label `'L<n> Tiger Stripe start (2026-11-24)'`.

## Task 0 (read-only, both databases; findings in the closing report)

- The nine current start rules as `v_dial_start_rule` gives them, with each row's reason, coffee sentence and lead, and where each of those is stored and written today (after briefs 9 and 10). Name the functions this brief will call (G3.9).
- Whether brief 10 is done on each database. If it is half applied on one, STOP and say so.
- Whether a start rule change needs a publish (decision 4).
- The count of current real quiz sessions per first bag from `v_dial_start`, before the change.
- Every recorded first-match decision whose coffee is Fabricator: how many, and what `/map` shows those people after the rule changes. Report only; nothing is rewritten.
- That Tiger Stripe passes whatever the start door checks today (active, anchor size, price), since its price differs from the $29 list.

If anything here contradicts the decision block, STOP and report (G1.4).

## Task

One script, `backend/src/scripts/ellaMapTigerStart_2026_11_24.ts`, the brief 7 seed's shape and safety (`--dry-run` default, `--apply`, `--expect-db`, one transaction, the same service functions). It carries only decisions 1 and 2 as data.

Order: test DB dry-run, apply, second run writes nothing. STOP with the production dry-run printed. After Dana's go: production apply, second run writes nothing.

## DONE =
The `chocolate_nutty` priority 3 rule gives Tiger Stripe Espresso with the three sentences and the lead above; the previous row is superseded, not deleted; the other eight rules are identical before and after; in `v_dial_start` the sessions that started on Fabricator now start on Tiger Stripe and no session starts on Fabricator; `/admin/map` table 1 shows the new row; `/map` for a Chocolate & Nutty customer with Fruity above Balanced and no espresso answer shows Tiger Stripe as the Founder's pick with Geometric as the lead step; lints and `tsc --noEmit` green; integrity checks the same before and after.

Closing report: Task 0 findings; the dry-run tables (test and prod); the rule row before and after; the per-coffee start counts before and after; the Fabricator first-match decisions found and how they read now; anything that looked off (a sentence that no longer fits, for example), listed and left alone. Commits straight to main: the script, this brief's status line, the README line, a `WHAT_WE_BUILT.md` entry, `CLOSING_REPORT_11.md`.
