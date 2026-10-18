# Closing report: drift audit 1 (production, read-only)

> Brief: `CLAUDE_CODE_PROMPT_DRIFT_AUDIT_1.md` · Queries: `drift_audit_2026-10-18.sql` (run unedited; no column name needed fixing, no block errored) · Run 2026-10-18 through the Cloud SQL Auth Proxy with the same `DATABASE_URL` as `npm run catalog:md -- --expect-db axisandbloom`, in a session with `default_transaction_read_only = on`, one statement at a time, from a throwaway runner outside the repo.

Firestore is out of scope: the `users/{uid}` mirror (including `tokenBalance`) and `sommelierCentroids` cannot be compared from SQL.

## D0: guard

| database | role | ran_at |
|---|---|---|
| axisandbloom | axisbloom | 2026-10-18 11:49:04Z |

## D1: newsletter_subscriber.archetype / confidence (copy) vs the customer's current quiz result (fact).

| subscribers_with_quiz | archetype_mismatch | confidence_mismatch | legacy_spelling_rows |
|---|---|---|---|
| 68 | 1 | 48 | 0 |


| email | subscriber_copy | current_quiz | copy_conf | current_conf | completed_at |
|---|---|---|---|---|---|
| danabar.mail+unstest@gmail.com | Balanced | Balanced | medium | high | 2026-10-06 19:38:10Z |
| danabar.mail@gmail.com | Chocolate & Nutty | Chocolate & Nutty | medium | high | 2026-10-06 19:36:25Z |
| danabar.mail+quizresyncsmoke2026@gmail.com | Balanced | Balanced | medium | high | 2026-10-05 02:29:01Z |
| malteselillian@gmail.com | Balanced | Balanced | low | high | 2026-09-27 18:35:50Z |
| ronakh130@gmail.com | Balanced | Balanced | low | high | 2026-09-21 22:59:15Z |
| rebeccagleeson01@gmail.com | Balanced | Balanced | low | high | 2026-09-21 19:53:39Z |
| jess.militello@gmail.com | Balanced | Balanced | medium | high | 2026-09-21 19:15:49Z |
| mquinn2004@gmail.com | Balanced | Balanced | low | high | 2026-09-20 19:36:09Z |
| meganlynnlevy@gmail.com | Balanced | Balanced | low | high | 2026-09-20 19:12:17Z |
| migesser@gmail.com | Chocolate & Nutty | Chocolate & Nutty | medium | high | 2026-09-20 19:09:31Z |
| superwawa729@hotmail.com | Fruity | Fruity | medium | high | 2026-09-20 19:09:28Z |
| rocker2277@gmail.com | Balanced | Balanced | medium | high | 2026-09-20 19:09:08Z |
| hannahnyrie@yahoo.com | Chocolate & Nutty | Chocolate & Nutty | medium | high | 2026-09-20 18:34:29Z |
| naomiidawolff@gmail.com | Chocolate & Nutty | Chocolate & Nutty | medium | high | 2026-09-20 18:09:02Z |
| katiesmith2020@icloud.com | Balanced | Balanced | medium | high | 2026-09-20 17:59:44Z |
| oliviacb098@yahoo.com | Balanced | Balanced | medium | high | 2026-09-20 17:59:26Z |
| galiatira@gmail.com | Balanced | Balanced | medium | high | 2026-09-20 17:58:23Z |
| testinglilyhornberger@gmail.com | Balanced | Balanced | medium | high | 2026-09-20 17:51:46Z |
| mikkijchristie@gmail.com | Balanced | Balanced | low | high | 2026-09-20 17:44:33Z |
| katelyn.chen@yahoo.com | Earthy | Earthy | low | high | 2026-09-20 16:18:55Z |

_Query is capped at LIMIT 20; 20 rows shown._

## D1b: subscribers with a quiz copy but no quiz session we can find (copy without a fact).

| copy_without_fact |
|---|
| 31 |

## D2: archetype stored as display-name text in quiz_session_interpretation; values that no longer match coffee_archetype.name.

| col | value | is_current | rows |
|---|---|---|---|
| explore_archetype | Chocolate & Nutty / Fruity | true | 1 |
| explore_archetype | Chocolate & Nutty / Fruity | false | 1 |
| secondary_archetype | Balanced & Sweet | false | 14 |

## D2b: same test on the other name-text copies.

| col | value | count |
|---|---|---|
| quiz_funnel_event.archetype | Balanced & Sweet | 122 |

## D3: what the quiz email said vs the customer's current result (legitimate log, but the size of the gap is the exposure for "they are owed an explanation").

| quiz_emails_matched_to_a_customer | email_differs_from_current_shown | email_differs_from_current_match |
|---|---|---|
| 13 | 0 | 2 |

## D4: coffee_sku.roaster_id (copy) vs coffees.roaster_id (fact). index.ts already warns at boot; this is the count.

| skus | roaster_mismatch |
|---|---|
| 56 | 0 |


_0 rows._ (columns: `sku_id`, `blend_name`, `coffee`, `sku_roaster`, `coffee_roaster`)

## D5: coffees.flavor_descriptors_roaster (array, legacy) vs roastery_coffee_descriptors (table, accepted). Words differ by design

| id | name | is_active | n_array | n_table_active |
|---|---|---|---|---|
| 7 | Colombia | false | 0 | 3 |
| 10 | Vantablack Ultra-Dark | false | 0 | 2 |
| 11 | Honduras | false | 0 | 3 |
| 12 | Sleepwalker Half-Caf | false | 0 | 3 |
| 13 | Decaf | false | 0 | 2 |
| 14 | Vanilla | false | 0 | 1 |
| 15 | Hazelnut | false | 0 | 1 |
| 16 | Chocolate | false | 0 | 1 |
| 18 | Blonde Blend | false | 0 | 1 |
| 19 | Guatemala | false | 0 | 3 |
| 20 | Colombia | false | 0 | 2 |
| 21 | Brazil Santos | false | 0 | 2 |
| 24 | Sumatra | false | 0 | 3 |
| 25 | Bali Blue | false | 0 | 4 |
| 26 | Uganda | false | 0 | 1 |
| 27 | Papua New Guinea | false | 0 | 3 |
| 28 | Ethiopia Natural | false | 0 | 4 |
| 29 | Costa Rica | false | 0 | 4 |
| 30 | Tanzania | false | 0 | 2 |
| 31 | Kenya | false | 0 | 3 |

_21 rows returned; first 20 shown._

## D6: token balance in three places (Firestore mirror not reachable from SQL): user_tokens.balance vs the ledger.

| users_in_either | ledger_without_balance_row | balance_row_without_ledger | balance_ne_sum_of_deltas | balance_ne_last_balance_after |
|---|---|---|---|---|
| 76 | 58 | 0 | 58 | 58 |


| uid | balance | sum_delta | last_balance_after |
|---|---|---|---|
| 0aKqMT9fO3YnMZs1Hy7tKFhdpSd2 | NULL | 20 | 20 |
| 0BeUD1zIdCTyO4v78kofJVkFtfo1 | NULL | 0 | 0 |
| 2bRZQ8OytgTT219ecQZMs9NyDIH3 | NULL | 20 | 20 |
| 2wHjau3zmfgo7kDoG8o6nEJINXd2 | NULL | 20 | 20 |
| 3br9EDwJAqPPSUSHvSoFT2bjq7k2 | NULL | 20 | 20 |
| 3razQ2RT3cbZw7jkKIM3a4ULLJC2 | NULL | 20 | 20 |
| 4p0NfUpgpoSimbtQGO6kJPECOsc2 | NULL | 20 | 20 |
| 56xCAZqR3IeFTEzr30ziGwpPM3i2 | NULL | 20 | 20 |
| 7VecxXJP9Qe5vVwGFoSVI8WCdji1 | NULL | 20 | 20 |
| 864GoB0fXGfvoQ49CnuUjSYLjWY2 | NULL | 20 | 20 |
| 8GOTRd9my2ROZUwYv13OJgOwRim2 | NULL | 20 | 20 |
| 9VcjlKkHXbg4sQHdlG76SL9TnjZ2 | NULL | 20 | 20 |
| 9vxQBWbzqNg3wJeb9XmdFyXfNPf2 | NULL | 20 | 20 |
| 9WJeu76DRCZYZqvWQLtctg1caAJ3 | NULL | 20 | 20 |
| AeTbB7YeHuMfK8gQgpZVtCcfSw12 | NULL | 20 | 20 |
| BKC3zzWUm0MJTzDJLvMvCv4ANin1 | NULL | 20 | 20 |
| bPFEK2F4FtaEDCvo8hhjCd3OvBS2 | NULL | 20 | 20 |
| btVpMNiGHWRZWWpFWP82QfSPMrC3 | NULL | 20 | 20 |
| c7GTOa50SPUCcaiIVOzI9ZJ4abn2 | NULL | 20 | 20 |
| cINcDvze01YGfuJfKunQznkqIR12 | NULL | 20 | 20 |

_Query is capped at LIMIT 20; 20 rows shown._

## D7: dial save written three times. (a) customer_dial_event.archetype_code (copy) vs coffee_dial_slot.archetype via slot_id.

| dial_events | events_without_slot | archetype_copy_mismatch |
|---|---|---|
| 31 | 0 | 0 |

## D7b: saved state (user_saved_item kind dial_slot, incl. removed) vs saved facts (customer_dial_event explicit_save), per user.

| users_with_either | state_more_than_facts | facts_more_than_state | total_saved_items | total_save_events |
|---|---|---|---|---|
| 4 | 0 | 0 | 13 | 13 |

## D7c: user_saved_item payload carries a display-name snapshot; how many no longer match the slot's current name.

| dial_saved_items | title_ne_current_slot_name |
|---|---|
| 13 | 9 |

## D8: match archetype vs placement archetype (catalogIntegrity check 7, listed here so the audit is complete).

_0 rows._ (columns: `coffee_name`, `match_archetype`, `placement_archetype`, `slot_name`, `priority`, `placement_note`)

## D9: dial_position_signal (stored, derived from cupping) vs the home slot actually assigned. Advisory table; this is how far it is from the catalog.

| current_cupping_signals | without_suggested_slot | differ_from_home_slot |
|---|---|---|
| 1 | 0 | 1 |

## D10: archetype_vector is joined to coffee_dimensions by md5(name). Dimensions with no vector row are silently dropped from the views.

| id | name | is_numeric | vector_rows |
|---|---|---|---|
| 1 | Fragrance | false | 0 |
| 2 | Aroma | false | 0 |
| 3 | Flavor | false | 0 |
| 4 | Sweetness | true | 5 |
| 5 | Acidity | true | 5 |
| 6 | Bitterness | true | 5 |
| 7 | Body | true | 5 |
| 8 | Texture | true | 5 |
| 9 | Savory / Depth | true | 5 |
| 10 | Finish Length | true | 5 |
| 11 | Finish Character | false | 0 |
| 12 | Mouthfeel | false | 0 |


| vector_rows_matching_no_dimension |
|---|
| 0 |

## D11: coffee_dial_slot.spec_band (the data-driven home for the same ranges) is still empty?

| slots | slots_without_band | slots_with_own_families |
|---|---|---|
| 24 | 24 | 0 |

## D12: descriptor_families are text arrays of cupping_note.wheel_category; any value that no longer exists as a category.

_0 rows._ (columns: `tbl`, `key`, `family`)

## D13: user_lifecycle_state (current) vs the last user_lifecycle_event (history nobody reads).

| state_rows | state_without_any_event | state_ne_last_event |
|---|---|---|
| 96 | 0 | 0 |

## D14: Liam's frozen per-session archetype snapshot vs the customer's current result (legitimate "as briefed", size of gap).

| liam_sessions_with_archetype | snapshot_differs_from_current |
|---|---|
| 27 | 21 |

## D15: raw quiz result (quiz_session.context_data, as scored) vs the current computed interpretation. Expected to differ after v2.2;

| sessions_with_current_interp | secondary_differs | mode_differs | confidence_differs |
|---|---|---|---|
| 141 | 23 | 51 | 75 |

## D15b: sessions with no current interpretation at all (readers fall back to raw context_data).

| sessions_without_current_interpretation |
|---|
| 0 |

## D16: retired store still read for counts (/flavor-memory, admin stats, axis): user_flavor_feedback vs its replacement.

| retired_user_flavor_feedback_rows | customer_feedback_descriptor_rows | customer_feedback_event_rows | last_retired_write |
|---|---|---|---|
| 0 | 0 | 0 | NULL |

## D17: quiz_funnel_event.archetype (copy at quiz_complete) vs the subscriber copy for the same session key (two copies of one result).

| funnel_completes_with_subscriber | copies_disagree |
|---|---|
| 67 | 9 |

## D18: roastery_portal_coffee prefill vs catalog (lineup table kept separate by decision; this is the size of the gap on linked rows).

| linked_lineup_rows | origin_differs | roast_level_differs | name_differs |
|---|---|---|---|
| 1 | 1 | 1 | 0 |

## D19: cupping tables before v3: merged rows vs cupper rows per session coffee (the "no merge step" edge; v3 changes this).

| session_coffees | with_merged_row | cupper_rows_but_no_merged |
|---|---|---|
| 9 | 3 | 6 |

## D20: the rename patch itself. quiz_archetype_canonical() hard-codes four old display names in a SQL function; how often it still fires.

| col | rows_relying_on_canonical |
|---|---|
| quiz_funnel_event | 122 |
| quiz_session.context_data.secondary | 14 |
| interpretation.secondary | 14 |

## Blocks with a non-zero mismatch

| Block | Mismatch column | Value |
|---|---|---|
| D1 | `archetype_mismatch` (of 68 subscribers with a quiz) | 1 |
| D1 | `confidence_mismatch` | 48 |
| D1b | `copy_without_fact` | 31 |
| D2 | `secondary_archetype` = `Balanced & Sweet`, not current | 14 |
| D2 | `explore_archetype` = `Chocolate & Nutty / Fruity` (current 1, not current 1) | 2 |
| D2b | `quiz_funnel_event.archetype` = `Balanced & Sweet` | 122 |
| D3 | `email_differs_from_current_match` (of 13) | 2 |
| D5 | coffees with one descriptor home filled and the other empty (all inactive) | 21 |
| D6 | `ledger_without_balance_row` (of 76) | 58 |
| D6 | `balance_ne_sum_of_deltas` | 58 |
| D6 | `balance_ne_last_balance_after` | 58 |
| D7c | `title_ne_current_slot_name` (of 13) | 9 |
| D9 | `differ_from_home_slot` (of 1) | 1 |
| D10 | dimensions with `vector_rows` = 0 (Fragrance, Aroma, Flavor, Finish Character, Mouthfeel) | 5 |
| D11 | `slots_without_band` (of 24) | 24 |
| D14 | `snapshot_differs_from_current` (of 27) | 21 |
| D15 | `secondary_differs` (of 141) | 23 |
| D15 | `mode_differs` | 51 |
| D15 | `confidence_differs` | 75 |
| D17 | `copies_disagree` (of 67) | 9 |
| D18 | `origin_differs` (of 1) | 1 |
| D18 | `roast_level_differs` (of 1) | 1 |
| D19 | `cupper_rows_but_no_merged` (of 9) | 6 |
| D20 | `quiz_funnel_event` rows relying on `quiz_archetype_canonical` | 122 |
| D20 | `quiz_session.context_data.secondary` | 14 |
| D20 | `interpretation.secondary` | 14 |

Zero in every mismatch column: D4, D7, D7b, D8, D12, D13, D15b, D16.
