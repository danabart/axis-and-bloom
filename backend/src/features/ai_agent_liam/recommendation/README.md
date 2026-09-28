# Liam recommendation — brief series (L1–L3)

Liam's recommendation logic rebuilt on the Customer Blueprint (C1–C3, complete 2026-09-28). Reference: the **Liam Recommendation Map** artifact (version 7, decisions D1–D21) and `features/customer_blueprint/README.md`. Decisions are settled; briefs implement them.

Situation: every customer fact is in SQL behind one door and read through `v_customer_*` / `v_palate_*` views; palate reads v1 carry Dana's four rules (disliked bags excluded and pushed down, already-bought flagged, crossover falls back to the pair, deterministic order) with an 86-assertion fixture. Liam still reads the customer once at `/start` into one string, his catalog slice ignores the secondary archetype, the thread and the palate, and nothing he says is recorded.

| # | Brief | Scope | Est. | Status |
|---|-------|-------|------|--------|
| L1 | `CLAUDE_CODE_PROMPT_LIAM_1_PROFILE_LINE_AND_RAG.md` | Structured profile line rebuilt every turn from the views; `RagParams` gains secondary, thread and palate slot candidates; every focus reserves labelled slices; disliked coffees excluded; slice re-run when the customer's facts move mid-session (facts watermark); Haiku briefing reduced to tone. | 1 d | **EXECUTED 2026-09-28** (`SOMMELIER_BUILT.md` S100, `WHAT_WE_BUILT.md` #198) — Parts A-D, 113 tests green, deployed |
| L2 | `CLAUDE_CODE_PROMPT_LIAM_2_ROUTER_AND_ADDENDA.md` | PROFILE_AMBIGUOUS above DISCOVERY_SEEKER; DISCOVERY only on a clean profile; MATCHED default for any quiz taker (confirm the pick, then one palate question); thread rule; quiz_tie folded into v2.1 near-tie; frontend redirect removed for quiz takers; live Firestore config with drift check. | ½ d | not written |
| L3 | `CLAUDE_CODE_PROMPT_LIAM_3_WRITE_BACK.md` | `<<recommend:alias>>` and `<<ask:kind>>` markers → `customer_liam_recommendation` / `customer_liam_question` (+ reply); alias detection logs a pick with no marker; `customer_liam_action` from action endpoints; thread stops re-firing once asked; calibration columns; transcript backfill with `source = backfill_detected`. | 1 d | not written |

House rules: Liam never sees a copy, only views; the profile line is facts, never the Haiku briefing; no weights or estimated values enter the prompt; Liam never says "confidence", "thread", "pair" or "explore" to the customer; every brief ends with the push-is-deploy sequence and one closing report.
