# Closing report: Liam sees everything (Rev 2)

**2026-10-24. Done on prod.** Brief commit `5bda7e4`, eval fixes `0402fba` and `2feffb5`, docs in the closing commit. Deploys green: `40154840342` (rev `00779-jqj`), `40155979099` (`00782-kwb`), `40156429306`. Full record: `WHAT_WE_BUILT.md` #237, `SOMMELIER_BUILT.md` S117, `WHAT_WE_BUILT_DB.md`, `OPEN_TASKS.md` OT-37 to OT-41.

## Prerequisites (checked before any code)
| Check | Result |
| --- | --- |
| `sommelier_answer` has rows | yes, 6 current (ids 1–6, seed) |
| The answers block is in the assembled prompt | yes (live config + live rows) |
| No counter in the UI | yes (verified in Brief 1) |
| `maxTurns` 16 | **no, 8 everywhere.** Applied the eight paths (global + 7 intents) on Dana's go, same dot-path update + audit as the admin Apply button (uid `claude-session`); OT-27 rows untouched |

## Task 0
The table, with tags (**prefix-answer** / **lookup-row**) and "written by" from `lineage.json`, is in [`TASK0_INVENTORY.md`](TASK0_INVENTORY.md) beside this file. In short:
- **Already in the prompt:** brand answers, the 6-coffee slice (anchor price only), the quiz match, the palate lines, the brew profile, and the current session's history.
- **Added by Part A** (catalog block): every visible dial coffee, every category coffee (decaf / half-caf / flavored / experimental), every size and price, the tasting note, key flavors, and the story.
- **Added by Part B** (customer block): name / member since / household size, quiz history, feedback in their words, orders (what and when), saved coffees, brew cards, subscription status, ships-to city and state, and earlier Liam sessions (from the L3 facts).
- **Excluded, with the reason:**
  - roaster identity (partner privacy);
  - street, postal code and payment (a customer would not expect them said back);
  - household member names;
  - `fulfillment_status`, tracking, `roastery_shipment_details`, `next_delivery_date` / `frequency_days` (**nothing writes them**, verified by grep of every UPDATE).
- **Found, not anticipated by the brief:**
  - the Profile page shows the never-updated `pending` status and a never-written next delivery date (OT-39);
  - lifecycle stage, recent dial activity (dropped in L1) and sent beats / arrival notes are not in Liam's prompt (stated, not added);
  - a 1-hour cache write is priced 2× input, not the 5-minute 1.25× (fixed in `computeCostMicros`).

## Where the blocks sit, and their sizes (tokens, measured on prod)
| Tier | Content | Size |
| --- | --- | --- |
| shared, 1-hour cache | `LIAM_BASE_PROMPT`, brand facts + all rules, catalog block (9 coffees) | ≈ 5,433 (base ≈ 3,423; catalog ≈ 1,970) |
| session, 5-minute cache | story (coffee-specific expertise turns), ABOUT THIS CUSTOMER, FIT block | ≈ 84 for the test customer |
| turn, uncached | current coffee, intent addendum + goal, opening context, setup, nudge, expertise contract, history | 129 → 895 over 16 turns |

Deviation: A2/A3 put the fit labels and the decaf header on the catalog lines, but a block shared by every customer cannot carry per-customer text. They are a session-tier FIT block instead, same information. A2's `What's unexpected:` line is not seeded (`surprise_note` was retired from customer surfaces).

## Cost per reply, before and after (same 16 scripted messages, same marked test account)
| | Before (rev 00778, 6-coffee slice) | After (rev 00779, full catalog + customer) |
| --- | --- | --- |
| Total, 16 replies | $0.0586 | $0.0945, of which $0.0338 is one 1-hour shared write (reused by every customer for an hour) |
| Median per reply | $0.00353 | **$0.00452** (+28%) |
| Mean per reply excluding the shared write | $0.00366 | $0.00405 |
| Cached prefix | 4,158 | 5,517 |
| Cache hit, read / (read + input) | 0.862 (cache already warm) | 0.907 |

`guards.modelCostPerTurnUsd['claude-sonnet-4-6']`: **was 0.02, is 0.0045** (applied by `SEED_UPGRADES`; Haiku unchanged, not used by chat).

TTL, two sessions 20 minutes apart: **not completed.** Claude Code stopped the background run at about 03:22 UTC because the machine ran critically low on memory, before session B. One point measured: session A (03:02, '1h', 24 min after the after-run) read 5,637 cached tokens and wrote none ($0.0028). The 20-minute '1h' read and the '5m' miss were not measured; prod config was never changed (`promptCache.sharedTtl` still '1h'). Re-run `backend/tmp/fc_ttl.mts` (about 1h45m, no other Liam traffic) when wanted.

## Keys `applyMissingKeys` added or upgraded on prod
- **Rev 00779, 17 keys.**
  - Added: `brandFacts.supportContact`; `catalogBlock.header`, `.template`, `.sizesForm`, `.notYetAvailable`, `.storySentences`, `.maxTokens`, `.fitHeader`, `.decafHeader`; `customerBlock.quizHistoryCount`, `.ordersFullCount`, `.feedbackCount`, `.sessionsCount`, `.rules`; `promptCache.sharedTtl`.
  - Upgraded, because the live value was still the previous seed: `brandFacts.rules` (+4 B1 rules) and `contextAssembly.omitCatalogInExpertiseMode` (true → false).
- **Rev 00782:** `guards.modelCostPerTurnUsd`.

## `CATALOG.md`: `sommelier_turn`
Regenerated from prod (`npm run catalog:md -- --expect-db axisandbloom`). The entry:
- Class `fact`;
- Purpose: the Liam turn ledger, and why no existing object fits;
- Writer: `sommelierTurnService.recordTurn`;
- Readers: `sommelierReads` (getTurnStats, getTurnsForSession) and `sommelierIntegrity` (check 5);
- every one of the 24 columns commented.

## Testing (the brief's list)
| # | Result |
| --- | --- |
| 1 | Builds, `lint:customer` / `lineage` / `catalog` (+3 others) green; byte-identity tests pass; roaster redaction on a 3-roastery fixture with a coffee named after its roaster and stories naming roasters |
| 2 | Decaf: **failed first** (the marker carried a phrase, dropped); fixed (`2feffb5`). After: the fact lands, the strip is the two decafs, the pick only describes them ("not available yet", true: unpriced), half-caf only when asked, no caffeinated pick pushed. The "of that archetype" half could not run live (the decaf test account has no quiz); unit-tested |
| 3 | "Tell me about Bright & Balanced" (outside the old slice): answered from its catalog line (before: "I don't have that one in front of me") |
| 4 | Prompt-level by Dana's choice (no order created in prod): order lines tested on fixtures (no status, tracking, date or street). Live "Where is my coffee?" on an account with no orders: no status invented, support contact given |
| 5 | Name in 2 of 10 replies: early and at the close, not every turn. Not in the opening itself |
| 6 | "I'm Axis & Bloom's AI sommelier — but the recommendations are real." |
| 7 | No quiz: **failed first** ("You're Floral"); fixed (`0402fba`). After: one sentence + offer + retake link, no archetype guessed. Liam then declines to recommend at all (OT-40, wording is Dana's call) |
| 8 | 16-turn conversation: **16 rows (turns 0–15), not 17** (the opening is turn 0 and sets `turn_count` to 1; the brief's "+1" double-counts), all `model`, tokens and cost on each, `answers_version` 6 = `MAX(sommelier_answer.id)`, check 5 green. Guard row with zero tokens and a failed ledger write leaving the turn successful: unit-tested (the live daily cap stops `/start` before a session exists) |
| 9 | Per-turn tokens and cost before/after: done (above). TTL '5m' vs '1h': **incomplete**, stopped by host memory pressure after 1 of 4 points (above) |

## Cleanup
Both marked test admins were demoted to customer and disabled in Firebase Auth. Their sessions, two brew-profile facts and ledger rows stay as test data, as in earlier smokes. No order, subscription or real customer touched.
