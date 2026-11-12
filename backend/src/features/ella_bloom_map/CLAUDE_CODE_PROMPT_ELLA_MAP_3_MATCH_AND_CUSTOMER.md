# Claude Code brief — Ella's Bloom Map 3: Match service and customer surfaces, beside the old dial

Workstream: ella_bloom_map (`README.md`; design `misc/palate_model/BLOOM_DIAL_HUB_MODEL_REV3_2026-11-09.md`, read sections 4, 5, 7 and 8 first; `CLOSING_REPORT_1.md` and `CLOSING_REPORT_2.md` for the API, views and `EllaMapFace` as built) · Written 2026-11-12 by the CTO session, to run after version 1 of the map is active · Model: Sonnet · Dana runs it; push = deploy · **Test mode.** No money. One email template gains buttons but sends nothing new. No customer surface switches: every `dial_surface` row stays on `lane`.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (parameters `evidence_parameter` `dial_*`; vocabularies `dial_move`, `dial_surface`, `dial_model`, `dial_hop_phrase`, `dial_delta_phrase`) · G2.2 surrogate id PK · G2.3 prefixes `dial_` and `customer_` · G2.4 CATALOG.md checked (why nothing fits: `customer_dial_event` and `user_bloom_dial_current_position` are keyed on slots and written by the old dial door; `customer_liam_recommendation` is Liam's own log; no table records a match decision with its candidates) · G2.5 one writer (`matchService.decide` for `customer_match_decision` and `customer_match_candidate`; `dialPlacementService.setSurfaceModel` for `dial_surface`), reads via `v_customer_match_current`, `v_customer_match_trail`, `v_dial_surface`, `dialReads` · G2.6 one door for a decision · G2.12 insert-only · G2.13 the decision log is the history; no current-state table (position is derived) · G2.19 proxy until self-service (the dial is open: a household member may decide for another, recorded with the actor) · G3.1 routes call services · G3.3 idempotent on (source, source_id) · G3.6 ownership on every customer read · G3.9 reuse (`EllaMapFace`, `dialReads`, `v_dial_hop`, `householdService.assertMayTurnDialFor`, `v_customer_identity`, the beats engine, the quiz results door) · G4.1 reuse shared components · G4.2 nothing typed in · G4.4 positive copy · G4.6 the new route sits behind the pre-launch gate · G5.1 vitest · G1.6 push is deploy, one closing report.
STOP points: after Task 0; and Task 0 STOPS for good if production has no active map version (the gate is not passed).

**Goal.** The customer side of the map exists beside the old dial and nobody but admins sees it. One writer turns a quiz result, a button tap or Liam's accepted pick into a logged match decision with its candidates; position and trail derive from that log; a customer API serves the face, her position, her four moves with their cards and the decide door; the page at `/map` shows it; the quiz result, the profile and the first-brew dial-in email get their map pieces, each rendered only when its `dial_surface` row says `map`, which none does yet. Brief 4 flips the rows.

**Decisions already made (do not re-open).** Rev 3 R3.1 to R3.10 (Dana 2026-11-10); briefs 1 and 2 as built and deployed; **version 1 of the map as Dana cut it** (Task 0 item 1 reads it from production and records its cuts, lean decisions and parameter snapshot in `CLOSING_REPORT_3.md`; those numbers are decisions, not inputs to tune). Carried: the map, the match and the hops never read a slot or `coffee_hop`; tap only; the old dial door (`/api/users/dial-position`, `customer_dial_event`, `user_bloom_dial_current_position`) is untouched by this brief.
CTO calls for this brief, reversible, flag if the code disagrees:
1. **The switch is data.** Lookup `dial_model` (lane, map) and lookup `dial_surface` (customer_face, quiz_result, profile_trail, reorder_email, liam_context, qr_door, axis_stats) with `model_id` FK; every row seeded `lane`. Each surface this brief touches renders its map piece only when `v_dial_surface` says `map` for it. `/map` itself is wrapped in `AdminRoute` for this brief; brief 4 moves it under the `customer_face` row.
2. **One decision table, insert-only**, `customer_match_decision`: `id UUID, user_id UUID` (profile, never firebase uid), `actor_user_id UUID NULL` (a household member deciding for this user, G2.19), `occurred_at, version_id INT REFERENCES dial_map_version, move_id INT REFERENCES dial_move, from_coffee_id INT NULL, picked_coffee_id INT NOT NULL, source TEXT, source_id TEXT, inputs JSONB` (the customer-context capture: quiz archetype, secondary, lean, decaf flag, filters applied, candidate count), `created_at`; UNIQUE (source, source_id). `customer_match_candidate`: `id SERIAL, decision_id UUID, coffee_id, move_id, rank SMALLINT, distance NUMERIC NULL`; UNIQUE (decision_id, coffee_id, move_id). No verdict column, ever; the verdict is a join to feedback and orders (Rev 3 section 5).
3. **Position = latest decision** for the canonical user (`v_customer_identity` folds profiles as the household views do); **trail = all decisions in order**, drawn on the active version (R3.9). If the position coffee has no placement in the active version, the moves are computed from its most recent placement in any version and the card says the API's "no longer available" sentence with the nearest sibling as substitute (R3.7).
4. **First match rule**: quiz `match_archetype` + `intensity_lean` → (archetype_code, lane): `delicate` → the Fruity wedge's side toward Floral; otherwise the family's `side_a` for the center and Fruity (the chocolate side), `middle` for the rest; then the current `dial_first_match` row for that pair; when none exists, the derivable fallback (a placed, sellable, in-stock coffee of that family at the lowest ring with grade rank ≥ `dial_min_grade_rank_first_match`, most hops first), and when that is empty too, the center's first match. Which rule fired goes into `inputs`.
5. **Filters** applied by `matchService` on top of `v_dial_hop`, never inside the view: out of stock and not sellable drop out; a customer whose quiz says decaf sees decaf-tagged targets only, everyone else never sees them (R3.6); the cap `dial_cap_different` applies after the filters (that is why the view keeps every ranked target). From the center, the quiz's `secondary_archetype` wedge takes `adjacency_rank` 0 (R3.8); nothing else is personal.
6. **Moves door**: `POST /api/map/decide { move, coffeeId, forMemberId? }` is the only customer write. `stay` picks the current position coffee again; `bolder`, `gentler`, `different` must name a coffee that is in the caller's current move set for that move (server-verified from the same read, never trusted from the client). `forMemberId` goes through `householdService.assertMayTurnDialFor` and records `actor_user_id`; a member's own later decision stands on its own (no undo needed: a decision is never deleted, the next one is the position).
7. **Quiz result calls the door.** `POST /api/quiz/results` ends with `matchService.decide({ trigger: quiz_result, source: 'quiz', source_id: quiz_session_id })`, idempotent, after `saveQuizSession`; a failure there is logged and never fails the quiz. Proxy quizzes (brief Household 2) pass the actor. Historical quiz rows get no backfill in this brief.
8. **Liam**: `liamWriteBack.recordTurn` keeps writing `customer_liam_recommendation` in this brief. The `liam` move exists in the lookup and `matchService.decide` accepts it; wiring Liam's accepted pick to the door and freezing the old log is brief 4.
9. **The dial-in beat email** (first-brew beat, `beatEngine`, `routes/beats.ts /dial-in/:token/respond`) is the "after a bag" surface. When `reorder_email` is `map`, the template gains the four buttons as respond links (one token, the move as a query value); the respond route calls the door. With the row on `lane`, the template is unchanged.

---

## Task 0 — Verify (write into `CLOSING_REPORT_3.md` before changing anything; STOP after)

1. **The gate.** Production, read-only: the active `dial_map_version` (label, cut_at, parameters snapshot), its `dial_ring_cut` and `dial_size_cut` rows, every current `coffee_lean_assignment` (coffee, lane, basis), `dial_first_match` rows, `v_dial_placement` for the version (coffee, cell, grade, sellable), `dialReads.graphCheck('active')`. Write all of it into the report under "Decisions already made: version 1". **If there is no active version, STOP and say so; nothing else in this brief runs.**
2. **Quiz door.** `routes/quiz.ts POST /results`: the point after `saveQuizSession` where a decision can be written; how `profileId` and `forMemberId` resolve (Household 2 as built); the `decaf` flag and where it is stored; `quiz_session_interpretation.match_archetype` and `intensity_lean` on the row the door just wrote; `secondary_archetype` spelling (archetype name text, not code: map it through `coffee_archetype`).
3. **Identity.** `v_customer_identity` canonical id walk; how `v_customer_dial_current` and `v_household_member` fold profiles (copy the pattern); `householdService.assertMayTurnDialFor` signature.
4. **Brief 1 and 2 reads as built.** `v_dial_hop` columns (`relation`, `rank`, `in_hop_set`, `within_cap`, `distance`, deltas, composed move line), `v_dial_placement`, `v_dial_face`, `dialReads` functions, `GET /api/admin/map/vocabulary` shape, `EllaMapFace` props (`placements`, `wedges`, `seams`, `highlightCoffeeId`, `hops`, `size`, `labelMode`, `onTapCoffee`), where `dial_hop_phrase` is resolved per family.
5. **Beats.** `beatEngine` dial-in selection and template, `beat_event` columns, the respond token and `routes/beats.ts /dial-in/:token/respond` (what it records today), the shared email sender. Which template file carries the dial-in email.
6. **Profile.** `Profile.tsx` and `components/profile/*`: where the palate-over-time or activity timeline renders (`ActivityTimeline.tsx`, `v_customer_timeline`), its data endpoint, and where a "trail" section fits without re-implementing the timeline.
7. **Quiz result screen.** `FlavorQuiz.tsx` result scene: where the matched archetype and the dial widget render (`BloomDialWidget`, `matchArchetypeId` ~1268 and ~1636), what the results payload carries, and where one sentence and a thumb face fit.
8. **Routing.** `App.tsx`: `PrelaunchGate`, `AdminRoute`, `PRELAUNCH_OPEN_ROUTES`; the `/bloom` route; where `/map` goes (gated and admin-only, CTO call 1).
9. **Readers of `customer_liam_recommendation`** (`v_customer_timeline`, `v_palate_evidence`, `v_palate_recommendation_outcome`, `v_customer_calibration`): list them for brief 4; nothing changes here.
10. **Production, read-only:** quiz sessions with a current v2.2 interpretation, decisions (expect 0), household members with `may_turn_dials`.

## Task 0.5 — Dana's manual steps
None.

---

## Part A — Schema (additive, idempotent; `comments.sql`; `catalog:md`)

- Lookups `dial_model` (lane, map) and `dial_surface` (the seven codes, `label`, `model_id`, `updated_at`), seeded all `lane`. `v_dial_surface`: code, model code, label.
- `customer_match_decision` and `customer_match_candidate` per CTO call 2, with FKs to `user_profile`, `dial_map_version`, `dial_move`, `coffees`. Insert-only: a guard trigger raises on UPDATE and DELETE, like `cupping_scores`.
- `v_customer_match_current`: per canonical user id, the latest decision (occurred_at, then created_at) with its coffee, move, version, actor, and the coffee's placement in the active version or, when absent, its most recent placement with that version id and `is_in_active_version = false`.
- `v_customer_match_trail`: every decision per canonical user in order, with the coffee, the move, the version, and the coffee's cell in the active version (NULL when not placed there).
- No column is added to any existing table.

---

## Part B — Backend

B1 **`matchService`** (new module, the one writer): `decide({ userId, actorUserId?, trigger, move, pickedCoffeeId?, fromCoffeeId?, source, sourceId, inputs })`: resolves the version (active), validates the move against the caller's current move set for hop triggers (CTO call 6), resolves the first match for `quiz_result` (CTO call 4), writes the decision and its candidates in one transaction, `ON CONFLICT (source, source_id) DO NOTHING` then re-select; returns the decision and the new position. `moves(userId)`: position from `v_customer_match_current`; for each customer move the candidates from `v_dial_hop` after the filters of CTO call 5, capped, each with its composed move line and the coffee's existing presentation fields (notes line, compatibility sentence from the readers that exist); edge state when a move has no candidate (the family's edge phrase); the four button labels from `dial_hop_phrase` resolved for the position coffee's family; `stay` always present. `firstMatchFor(quizContext)` used by `decide`.

B2 **Customer routes** `routes/map.ts` mounted at `/api/map`, `requireAuth`, ownership on every read: `GET /face` (active version, sellable and in-stock coffees only, wedges and seams, no grade, no roaster name, category tags on the card payload only), `GET /me` (position, trail from `v_customer_match_trail`, version label, the "no longer available" state), `GET /moves`, `POST /decide`. `forMemberId` on `/moves` and `/decide` per CTO call 6.

B3 **Quiz door**: per CTO call 7.

B4 **Beats**: per CTO call 9, behind the `reorder_email` surface row; the respond route calls `matchService.decide` with `trigger hop`, `source beat`, `source_id <beat_event id>:<move>`.

B5 **Admin**: `PATCH /api/admin/map/surfaces/:code { model }` → `dialPlacementService.setSurfaceModel` (admin page gets the table in C4). `GET /api/admin/map/decisions?userId=` for the workbench (recent decisions with candidates).

B6 **Integrity (report only):** a decision whose version is not the active one and whose coffee has no active placement (counts); a surface row whose model is `map` while no version is active.

---

## Part C — Frontend

C1 **`/map` page** (`components/bloom/map/MapPage.tsx`, gated, `AdminRoute` for now): one coffee big (the position's card: name, notes line, compatibility sentence, price, add to cart through the existing cart components), the thumb `EllaMapFace` above it with her dot highlighted and "See the whole map" opening the full face in a sheet (tap only); under the card the four buttons with labels from the API; tapping Bolder / Gentler / Something different reveals its cards (one, one, up to cap), move line leading each card; "Go" calls `/decide` and the page re-reads `/moves`; Same again is the primary button and calls `/decide` with `stay`; an edge state renders the button quiet with its phrase. All copy from the API. Nothing on the page names a ring, lane, cell, seam, grade or version.

C2 **Quiz result**: when `quiz_result` is `map`, one sentence from the API (Balanced: the "You start at the base" sentence; others: "You start here: <coffee>") and the thumb face with her dot, beside the existing archetype result; the old dial widget stays as is when the row is `lane`.

C3 **Profile**: when `profile_trail` is `map`, a "Your trail" section (the trail as a story: coffee → coffee with the move word, and the active-version face with the dots joined), reusing the timeline's container; otherwise nothing changes.

C4 **Workbench** (`AdminEllaMap.tsx`): a Surfaces card listing the seven rows with their model and a switch each (confirmation names the surface), and a Decisions card (recent decisions with their candidates). These are the only admin changes.

---

## Part D — Tests (vitest, test DB)

1. `decide` for `quiz_result`: cozy → Benchmark; a delicate Fruity result → the Fruity row on the Floral side; a missing `dial_first_match` row → the derivable fallback; the same `source_id` twice → one row.
2. `decide` for a hop: a coffee not in the caller's move set is refused; `stay` re-picks the position; `forMemberId` without permission is refused; with permission the actor is recorded.
3. `moves`: decaf customer sees decaf targets only and nobody else sees them; out-of-stock target disappears; the cap applies after filters; the center's `different` ranks the quiz secondary's wedge first; an edge state is returned when nothing is in a direction.
4. Position and trail: latest decision wins; a position whose coffee is not in the active version returns `is_in_active_version = false` and a substitute.
5. Surfaces: every row `lane` by seed; `setSurfaceModel` flips one row; the quiz door writes the decision whatever the `quiz_result` row says (the row gates rendering only).
6. The insert-only guard raises on UPDATE and DELETE of a decision.

---

## Acceptance (test mode, local backend, test DB, signed in as a test admin)
- A test user's quiz result writes one decision; `/api/map/me` shows the position on the first-match coffee; `/map` renders the card, the thumb and the four buttons with per-family labels; tapping Bolder shows one card with a composed move line; Go writes the decision and the page moves; Same again writes `stay`.
- A second quiz submit for the same session writes nothing new.
- A decaf test user's moves show only decaf targets (or edge states if none are sellable).
- All seven `dial_surface` rows are `lane` on production after deploy (checked read-only); the quiz result screen, the profile and the dial-in email are unchanged for customers.
- Screenshots: `/map` at phone width (position card, buttons, one revealed card, edge state), the full face sheet, the quiz result and profile pieces rendered with the row forced to `map` on the test DB only.

## Docs and closing (G6)
`WHAT_WE_BUILT.md`; `WHAT_WE_BUILT_DB.md`; `comments.sql` → `catalog:md`; `REGRESSION.md`: decisions are insert-only, position is derived, every surface row is `lane` until brief 4, the quiz door never fails on a decision error, `/map` is admin-only until brief 4; `OPEN_TASKS.md`: historical quiz rows without a decision (backfill decision for brief 4 or later); `CLOSING_REPORT_3.md` with the version 1 record from Task 0, screenshots, deviations, and what brief 4 needs (every reader of slots and hops it must repoint, from brief 1's Task 0 item 9 and `README.md`). README brief plan line for brief 3.

## Do not
- Do not flip any `dial_surface` row on production; do not change `/bloom`, `BloomDial.tsx`, `BloomDialWidget.tsx`, `/api/users/dial-position`, `customer_dial_event`, `user_bloom_dial_current_position`, `customer_liam_recommendation` or its readers, Liam's catalog block, `qrDoor` or `axisStatsReads`.
- Do not read a slot or `coffee_hop` anywhere in the new code; prices for the card come from the existing price readers as they are today.
- Do not add a current-position table or a verdict column; do not update or delete a decision.
- Do not type a label, phrase, threshold or coffee name into the frontend or the service.
- Do not send any new email; the dial-in template changes only under a row that stays `lane`.
- Do not open a PR or hand Dana manual steps.
