# Quiz interpretation v2.1 — decisions and rationale

## Status

**SHIPPED 2026-09-25.** Briefs 1–3 are built, deployed and verified on prod:

| brief | what | `WHAT_WE_BUILT.md` | commit |
|---|---|---|---|
| 1 | `interpret()` rules, `/score` fields, calibration fixture (37/37) | #192 | `8edcac0` |
| 2 | `quiz_session_interpretation` (SCD Type 2), live path, backfill script, read paths | #193 | `80a9d7a` |
| 3 | `v_subscriber_quiz_results` reads the current interpretation; `v_quiz_session_interpretation_history` | #194 | `df5b30e` |

- **Prod backfill applied** (`--apply --expect-db axisandbloom`): **121 `v1` + 70 `v2.1`** rows inserted.
- **`v2.1` is current for every session with `answerIds`** (70 backfilled + new sessions, which are scored live). The 51 sessions without `answerIds` (cross-device match claims, pre-August rows) keep their `v1` row as current, because no `v2.1` can be computed for them. Every one of the 122 sessions has exactly one current row.
- Verified on prod, read-only: the 37 crawl rows match `hoboken-crawl-2026.calibration.json` both ways (current row = `expected_v2_1`, `_as_scored` = `stored_v1`); no `v2.1` row is `ai_agent`; `quiz_session` and `newsletter_subscriber` count + md5 unchanged through every step.
- **2026-10-09: superseded by v2.2** (see "v2.2 (2026-10-09)" below): the Balanced branch, the match layer, and
  confidence from scored answers and the branch answer only. v2.1 rows stay as history.
- Next: the caveat below stands. Treat v2.1 as a hypothesis and use `v_quiz_session_interpretation_history` and the next event's export (`backend/scripts/quizRecalibrate.ts`) to test it against what people order, save on the dial and say to Liam.

Decided by Dana, 2026-09-20 to 2026-09-25, from the Hoboken Crawl results review (37 real completions,
Flavor Finder v7; 34 in the first exports, 3 more linked by the 2026-09-25 subscriber repair). This file is the "why"; the three numbered `CLAUDE_CODE_PROMPT_*.md` files next to it are the
"what" (1 rules, 2 SCD Type 2 table, 3 view; run in that order). Mockups with every row and Dana's comments: `Claude outputs/crawl_quiz_rules_mockup.xlsx` (v1,
with comments) and `crawl_quiz_rules_mockup_v2.xlsx` (v2.1).

## What was wrong

1. The field shown as **confidence** was `foodSignalAlignment`: does the Q6 treat agree with the winner.
   Score margins played no part. A 9/9 Balanced result with a chocolate treat was `low`; a 2/5/2 result
   with a sweet treat was `high`. 11 of 37 crawl users landed in `ai_agent / low`, almost all of them
   with decisive scores.
2. The **secondary** on a runner-up tie (16% of all 243 answer combinations) was whichever row Postgres
   returned first: not deterministic.
3. `ai_agent` mode meant "the treat disagreed", not "the quiz could not decide".

## What is right and stays

- Scoring: 5 questions, one archetype per answer, weights 1/2/1/2/3 (totals always 9), winner by max
  with the Q5→Q4→Q2→Q1 cascade. Uniform random answering gives each of the three scoreable archetypes
  exactly one third of wins; the math is unbiased.
- Only Chocolate & Nutty, Balanced and Fruity are scored. Earthy and Floral are branch reclassifications
  (Chocolate & Nutty → Earthy, Fruity → Floral). Experimental is a gate on one Fruity answer (Q3c), a
  flag, not an outcome. Dana: this is by design; the differentiators live in the branch questions.
- Branch rule of 2026-08-11: on a real switch the pre-branch winner becomes the secondary; mode and
  confidence are computed pre-branch and never recomputed. The branch answer is the only answer given
  after the person has seen their profile, so the branch archetype stays primary (Joe's case).
- Fruity won once in Hoboken (1 of 37; the odds of at most one under a fair third are ~1 in 10,000) because
  its Q4/Q5 answers describe a trained palate. Accepted. If more Fruity outcomes are ever wanted the lever
  is that copy, which is a v8 quiz version with Camila, not a rule change.

## The rules (v2.1)

**Secondary**, first rule that applies: branch → near-tie (runner-up within 1 point; treat then cascade
break ties) → gate-backed (experimental gate open and Fruity is the runner-up) → food-led (treat points
elsewhere) → runner-up with 2+ points → none.

Why this order: scores outrank the treat (five weighted answers vs one unweighted); the gate answer is
itself a Fruity answer, so gate + Fruity runner-up is two signals against one treat (Sebastian: Fruity;
Megan, same scores without the gate: Chocolate & Nutty from the treat; Hannah, gate open but Balanced
outranks Fruity: Balanced); a single weight-1 answer is not a secondary (Alex, Kaitlyn, Soli: none).

**Mode** follows from the path: near-tie and gate-backed → `primary_plus_active_secondary`; food-led →
`primary_plus_introduce_secondary` (gate open → active); runner-up → `note_secondary` if it scored on
Q4/Q5 else `primary_only`; gate open on runner-up/none → `primary_as_starting_point`. `ai_agent` is
never produced.

**Pair confidence** (customer-facing): how well every signal agrees with the pair {primary, secondary}.
Strays: treat outside the pair; gate open with Fruity ≥ 2 outside the pair; third archetype ≥ 3.
None → high, one → medium, two+ → low; a treat 2+ axis steps from the nearest pair member → low.
Axis (interim, hand-ordered by Dana from archetype families): Floral, Fruity, Balanced, Chocolate &
Nutty, Earthy. To be replaced by hop distance from the dial graph (Seam Board) when that is the source of
truth. The gate alone does not cost confidence (Dana, 2026-09-24: "confidence doesn't have to pay for
that"); Sebastian is medium, not low (Dana accepted 2026-09-24).

**Explore archetype** (Liam only, never in the reveal or email): the loose thread. Gate Fruity first,
then the treat, then a 3+ point third archetype, then a runner-up tie (decided 2026-09-25: the other tied
archetype when the secondary came from the tie, or `A / B` when the 2-point floor named none; a tie never
changes confidence). This replaces `ai_agent`: the recommendation is always deterministic; the
conversation gets the hint (Thyago, Hannah, Joe, Suzanna, Alex, Becca).

**Primary margin** is kept as an analytics field and does not drive the label.

## Result on the calibration set (37 rows)

Current: 11 `ai_agent`; confidence 7 high / 19 medium / 11 low.
v2.1: 0 `ai_agent`; pair confidence 29 high / 6 medium / 2 low (Joe, Marley: Earthy with a fruit treat);
11 explore hints (9 signal-based, 2 runner-up ties: Alex, Becca), every one a row Dana had flagged for
Liam or of the same shape. The set contains one
Fruity winner (Fruity 4 / Chocolate 3 / Balanced 2, fruit treat, gate open, stayed on the Floral branch):
near-tie, Chocolate & Nutty co-primary, high.

## Caveat, in Dana's words

This is the first data set we have to learn from. It is one Sunday in Hoboken, 60% Balanced, and the
rules were tuned until these 37 rows looked right. Treat v2.1 as a hypothesis: every new session stores
both the legacy label and the new one, the view shows them side by side, and the next event's export
becomes the next calibration file (`backend/scripts/quizRecalibrate.ts`). The test going forward is what
people order, save on the dial and say to Liam, not what looks reasonable in a spreadsheet.

## Related finding (separate brief)

`archetype_at_signup` differed from the session archetype for four crawl subscribers. Not a scoring or
retake issue: the recognized-guest resync effect fires on page load with the default `'balanced'` key
and overwrites `newsletter_subscriber.archetype` (and the Mailchimp tag). Confirmed in `api_event`.
See `CLAUDE_CODE_PROMPT_SUBSCRIBER_RESYNC_FIX.md`. **Parked by Dana on 2026-09-24**: to be handled
separately from the secondary-archetype work; the brief stays in the folder as the record.

## Storage: SCD Type 2 (Dana, 2026-09-25)

`quiz_session` is the immutable fact (answers, scores, treat, gate, branch, primary). Interpretations live in
`quiz_session_interpretation`, a Type 2 dimension: one row per session **per interpretation version** (never
per user), with `is_current` on exactly one row per session (partial unique index). `is_current` means "the
row produced by the latest deployed ruleset", for old and new sessions alike. Versions: `v1` = the ruleset
running before this work (retroactively named; seeded verbatim from `context_data`), `v2.1` = this ruleset
(backfilled for every existing session and current from the moment it is applied; scored live for every new
session). Later rulesets add rows and move the flag; nothing is ever removed. The primary archetype and
`branchedFrom` are never reinterpreted and stay on the fact. The live path recomputes the interpretation
server-side from `answerIds`, so the table never depends on the browser bundle. Read paths join the current
row and fall back to `context_data` only when a session has no rows. Interpretation version is independent
of quiz version (`v7`).

## Quiz content is SCD Type 2 (2026-10-08)

Brief: `CLAUDE_CODE_PROMPT_4A_QUIZ_CONTENT_SCD2.md` (run before 4B). Decided by Dana on 2026-10-08.

**The rule.** `quiz_question` and `quiz_answer` keep every version of their content. A change closes the
current row (`valid_to = now()`, `is_current = false`) and inserts a new row with a new id. Nothing is updated
in place and nothing is deleted: retire, never delete. Sessions store answer ids, so an old id must keep the
words the person saw and keep its score rows; before this, a copy edit made an old session look as if it had
picked the new wording. Quiz rows (`quiz`) are not versioned; a whole quiz still retires through `is_active`.

**Columns.** Both tables: `valid_from` (when the version went into service; existing rows dated from their
quiz's `created_at`), `valid_to` (NULL while current), `is_current`, with
`CHECK ((is_current AND valid_to IS NULL) OR (NOT is_current AND valid_to IS NOT NULL))`. `quiz_answer.sort_order`
is the display position inside the question; it replaced `ORDER BY a.id`, and its first values are exactly that
old order, so nothing moved on screen.

**Business keys.** Question: `(quiz_id, q_number)`, partial unique index `quiz_question_current_unique`
`WHERE is_current`. Answer: `answer_code`, `quiz_answer_code_current_unique` `WHERE answer_code IS NOT NULL AND
is_current` (replaces `quiz_answer_code_unique`).

**Question-to-answers rule.** A new question version re-versions every current answer of the old question onto
the new question row (same text, code, sort_order; score rows copied). So an old answer id always leads to the
stem the person actually saw, and a new session only ever picks answers hanging off the current stem.

**Scores.** Keyed by `answer_code`, resolved to the current answer row. A missing score row is inserted; a
different score is a new answer version carrying the new score row. Score rows are never updated or deleted, and
old answer versions keep theirs forever. The seed's two DELETEs of stray score rows are gone; a stray is reported
by the integrity checks (4 and 7) and left for a human.

**Only writer.** The V7 seed in `schema.sql` (`DO $v7$`), running as the owner, through four functions:
`quiz_assert_question`, `quiz_assert_answer`, `quiz_assert_answer_score` (none → insert, identical → nothing,
different → close + insert) and `quiz_answer_new_version`. A code that disappears from the list is not retired;
retiring is an explicit `quiz_retire_answer('<code>')` line (none so far). Triggers refuse `DELETE`, `TRUNCATE` and
any in-place `UPDATE` on `quiz_question`, `quiz_answer` and `quiz_answer_archetype_score`, for every role. The only
updates they let through: retiring a current row (`valid_to`, `is_current`), and filling `answer_code` or
`sort_order` where still NULL. A retired row never changes again. `ab_app` has SELECT only on the quiz content
tables and the snapshot tables.

**How to change quiz copy from now on.** Edit the value on that code's line in the seed lists and deploy. The next
boot creates the new version. "UPDATE in place by answer_code" (the 2026-08-11 drift-prevention rule) no longer
applies, and Cloud SQL Studio cannot edit quiz content at all.

**Snapshot.** The first boot with SCD2 copied the pre-SCD2 content, production-minted ids included, into
`quiz_backup_20261008_quiz`, `quiz_backup_20261008_quiz_question`, `quiz_backup_20261008_quiz_answer` and
`quiz_backup_20261008_quiz_answer_archetype_score`. They are never written again and never dropped.

**Known limit.** `v7_q3_a`, `v7_q3_b`, `v7_q6_b` and the Q3 stem were edited in place on 2026-08-15. Sessions
before that date saw the earlier wording; it survives only in the seed's adoption list (Change 2). No historical
rows were fabricated for it.

## v2.2 (2026-10-09)

Brief: `CLAUDE_CODE_PROMPT_4B_V2_2_BALANCED_BRANCH_AND_MATCH.md` (replaces the superseded brief 4, kept with a
`SUPERSEDED_` prefix). Decided by Dana 2026-10-06 to 2026-10-09. `WHAT_WE_BUILT.md` #219. The reasoning behind it,
still a hypothesis, is `misc/palate_model/PALATE_MODEL_HYPOTHESIS.md` (direction vs intensity); it is linked here,
not copied.

**Three layers, recorded separately.**
- **Shown**: what the screen and the email told the person. Already stored (`quiz_session.resulting_archetype_id`,
  `transactional_email_log.archetype`); unchanged. A Balanced winner is shown Balanced whatever they answer on the
  new Balanced branch.
- **Match**: where on the Bloom Dial we match them. `quiz_session_interpretation.match_archetype` (every v2.2 row;
  never null in the views, which fall back to the shown archetype) and `intensity_lean` (`delicate` or null = the
  archetype's default position; there is no `bold`, Dana 2026-10-08).
- **Why**: the raw branch answer, `quiz_session.branch_answer_id`, so a later explanation can quote what the person
  actually chose. Set only in the session INSERT; never updated, never backfilled.

**The branch answer (`quizScoring.ts`, `BRANCH_ANSWER_EFFECTS`; part of the ruleset, not stored on `quiz_answer`).**

| branch answer code | shown | matchArchetype | intensityLean | secondaryArchetype | path |
|---|---|---|---|---|---|
| `v7_branch_cn_earthy` | Earthy | Earthy | null | Chocolate & Nutty (branchedFrom, as before) | as before |
| `v7_branch_cn_stay` | Chocolate & Nutty | Chocolate & Nutty | null | rule secondary | as before |
| `v7_branch_fruity_floral` | Floral | Floral | `delicate` | Fruity (branchedFrom, as before) | as before |
| `v7_branch_fruity_stay` | Fruity | Fruity | null | rule secondary | as before |
| `v7_branch_bal_cozy` | Balanced | Balanced | null | **Chocolate & Nutty** | `branch-lean` |
| `v7_branch_bal_fruit` | Balanced | **Fruity** | `delicate` | **Balanced** | `branch-match` |
| `v7_branch_bal_floral` | Balanced | **Floral** | `delicate` | **Balanced** | `branch-match` |
| none | winner | = shown | null | rule secondary | as before |

`branch-lean` and `branch-match` override the rule secondary and set mode `primary_plus_active_secondary`. For the
two delicate answers the secondary is Balanced, not Fruity or Floral (Dana, 2026-10-09). The pair used by
confidence and explore is `{matchArchetype, secondaryArchetype}`. Sessions saved before 2026-10-09 have no
`branch_answer_id`; the backfill derives the code in memory from `branchedFrom` (Earthy → `v7_branch_cn_earthy`,
Floral → `v7_branch_fruity_floral`, else none) and never writes it.

**Confidence from scored answers and the branch answer only (Dana, 2026-10-06).** A stray is an archetype outside
the pair with 3+ scored points: none → `high`, any → `medium`; `low` only for a near-tie where two archetypes tie for
runner-up. The Q6 treat and the experimental gate never lower confidence; they feed Liam's explore list only
(gate Fruity, treat, a 3+ point third archetype, a runner-up tie, each against the pair; the treat reason no longer
counts axis steps). `ARCHETYPE_AXIS` / `axisDistance` were only used by the treat-distance rule and are removed.
After a real branch switch the origin stays the forced secondary.

**The Natalie case.** At the Joe Coffee cupping (2026-10-02) Natalie, 19 years at Joe, scored 8 of 9 Balanced, high
confidence, no secondary; in the cup she is a delicate fruity/floral drinker. The v7 main questions measure
intensity, not direction, so "Balanced" meant "gentle, direction unknown". The Balanced branch asks the direction
question (a feeling, a taste, a smell), and the match carries the answer while the shown result stays Balanced.

**Reversal of 2026-10-08 ("the peach answer flips the primary to Fruity").** Reversed the same day: the shown
archetype stays true to what was scored ("it is more true than fruity or floral"), and the match carries the
direction. "A match is a match to the Bloom Dial."

**The 2026-09-24 gate-backed case moves to high.** Sebastian's shape (gate open, Fruity runner-up, treat outside the
pair) was accepted as `medium` because the treat counted as a stray; with the treat and the gate out of
confidence, it is `high` (crawl case 36: Balanced 7 / Fruity 2, gate open, Chocolate & Nutty treat; Chocolate &
Nutty stays on the explore list). On the crawl set 5 of 37 rows change, all upward and all in confidence only
(secondary, mode, margin unchanged): the four Earthy rows (02 medium→high, 10 low→medium, 11 low→high, 17
medium→high) and case 36 (medium→high). Case 10 stays `medium` because Fruity scored 3 outside {Earthy, Chocolate
& Nutty}. See the fixture's `expected_v2_2`.

**Copy (new versions through the 4A seed functions).** Branch copy never names a flavor, never says "tea", no
milk/dark chocolate wording (Dana, 2026-10-06/07). Balanced branch question "One last thing. Your coffee is smooth
and gentle, just how you like it best. Which of these would you be sad to lose?" with cozy / peach / smell (sort 1–3).
Earthy stem "Your profile is rich and bold. Which one sounds more like you?" with "Coffee that feels like a reward.
Warm, rich, comforting." / "Coffee with a kick. Dark, strong, a bit smoky." Fruity answers "Bright and lively. Every
sip a little different." / "Light and delicate, and more about the smell than the taste."

**Storage of the flip.** A session whose current row is `v2.1` gets that row closed (`valid_to`, `is_current` only,
`quizSession.closeCurrentInterpretation`, the backfill's only UPDATE) and a `v2.2` row inserted as current, in one
transaction. `v1`-current sessions (no `answerIds`) are not re-interpreted. New sessions are scored `v2.2` live.

### Handoff to the recommendation layer (Part G; recorded, not built)

> **Match rule.** The first match comes from `match_archetype`. When `intensity_lean = 'delicate'` it is the lane's
> first dial position (`coffee_dial_slot.sort_order = 1`: Fruity "Clean Fruit", Floral "Light Floral Edge"), not the
> landing default. When null, today's behaviour. Read the two fields; never re-derive them.
>
> **Explanation owed.** A customer shown Balanced who is then recommended a delicate Fruity or Floral coffee must be
> told why, in words built from their stored branch answer (`branch_answer_code`).
>
> **Until both exist**, a branch-match customer is treated as Balanced everywhere a customer can see.

What 4B deliberately did not change: `v_palate_slot_candidates.in_pair` and `v_palate_evidence` still read the
shown archetype and secondary (changing them would change what is offered, which is Part G); Liam's prompts and
routing; the reveal and the email.

## Scope boundary (Dana, 2026-09-25)

The three briefs change how a scored quiz is interpreted (secondary, mode, pair confidence, explore hint,
version), add the one Type 2 table that holds those interpretations, and make the reporting views read it.
They do not touch the newsletter subscribe route, the email gate payload, Mailchimp sync, the resync
effects, or any existing table column, and they never modify an existing `quiz_session` row, subscriber
row or Firestore document. The event sessions of
2026-09-20 are the calibration record and stay byte-for-byte as captured; both briefs carry a count + md5
reading of `quiz_session` before and after as proof.
