# Claude Code brief — Household 2: Quiz and dial by proxy

Workstream: household (`README.md`, `DESIGN_HOUSEHOLD.md` here; the design is the spec, read §3 D3, D9, D10, D25, D27, D34 and §3d T3, T4, T6 first) · Written 2026-11-07 by the CTO session after Household 1 shipped (`CLOSING_REPORT_1.md`) · Model: Sonnet · Dana runs it; push = deploy · **Test mode.** No money, no email in this brief.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (parameters: `household_parameter.quiz_for_member_enabled`; vocabularies: `household_account_state`, `household_quiz_state`) · G2.2 surrogate id PK · G2.3 prefixes `household_`, `customer_`, `quiz_` · G2.4 CATALOG.md checked (why nothing fits: no column records who answered a quiz or who turned a dial; no view resolves a dial across linked profiles) · G2.5 one writer (`quizSession.saveQuizSession` for `quiz_session`; `customerFacts.dialEvent` for `customer_dial_event`; `customerFacts.identityUnlink` for `customer_identity_unlink`; `householdService` for `household_*`), reads via `v_household_*`, `v_customer_quiz_current`, `v_customer_dial_current` · G2.6 one door · G2.7 lookups · G2.12 who answered and who turned is provenance, insert-only · G2.13 events · G2.19 as revised 2026-11-07 (quiz strict, dial open) · G3.1 routes call services · G3.3 idempotent · G3.6 ownership · G3.9 reuse, do not fork · G4.1 reuse `BloomDialWidget`, the quiz scenes, the result screen · G4.2 nothing typed in · G5.1 vitest · G1.6 push is deploy, one closing report.
STOP point: after Task 0 only. Nothing in this brief writes production data outside normal use.

**Goal.** The head of the household can take the quiz for a member and turn a member's dial, so a member with no login has an archetype and a dial position and can be in the house box (brief 3). The quiz is strict: once the member has taken their own quiz, nobody retakes it for them. The dial is open: any member whose role allows it may turn another member's dial, the move is recorded with its actor, shown in the member's log, and the member can undo it. A wrongly claimed profile can be unlinked. Badge words move out of the frontend (OT-104).

**Decisions already made (Dana 2026-11-07, design §3; do not re-open).** D3, D9, D10, D25, D27, D28, D31 (the result screen offers Share of the join link, no email), D34; technical calls T3, T4, T6. CTO calls for this brief, reversible, flag if the code disagrees:
1. Undo of a proxy dial move = a new move by the member back to the position before it (read from the member's own previous `customer_dial_event`; none → the current position row's `slot_id` is set NULL). Never a delete.
2. Badge words (account state, quiz state) come from two lookups with `customer_label`; button verbs stay UI chrome like the rest of the site. Role names already come from `household_role`.
3. A proxy quiz goes through the same `POST /api/quiz/results` door with `forMemberId`, not a parallel route.
4. The proxy quiz fires none of the taker-side side effects (welcome email, email gate, lifecycle refresh for the actor); the member's lifecycle refresh runs only if `refreshLifecycleState` accepts a `managed:` uid without touching Firestore Auth; otherwise skip and say so.

---

## Task 0 — Verify (write into `CLOSING_REPORT_2.md` before changing anything; STOP after)

1. **Quiz door.** `routes/quiz.ts` `POST /results` (~156–232): how `profileId` is resolved from `req.uid` (the `INSERT … ON CONFLICT (firebase_uid)` upsert), what `saveQuizSession(profileId, archetype, ctx)` writes, `recordScoredInterpretation`, `refreshLifecycleState(req.uid)`. `GET /results/latest` and `getLatestQuizResult(client, firebaseUid)`: by Firebase uid, not profile id (a managed member has `managed:<uuid>`). List every side effect of a completed quiz (T6): `refreshLifecycleState` (what it writes; does it tolerate a non-Firebase uid), `PostQuizEmailGate.tsx` (when it shows), the post-quiz welcome email path (`post_quiz_welcome_email` feature: trigger and key), `quiz_funnel_event` writes, anything in `auth.POST /sync` keyed on "has quiz". For each: fire for the member / suppress / redirect. The Firestore `users/{uid}` writes are retired (Customer Blueprint C3): confirm.
2. **`v_customer_quiz_current`** (schema.sql ~5917): how the current session is chosen per canonical user (ORDER BY), where `taken_by_user_id` must enter the ranking (self-taken first, then recency). Readers of the view that would break on a changed column list.
3. **Dial door.** `routes/users.ts` `GET /dial-position` (~527) and `PATCH /dial-position` (~564): the upsert into `user_bloom_dial_current_position` and the `customerFacts.dialEvent` call; `customer_dial_event` columns (`source`, `source_id`, `event_type`, `slot_id`, `coffee_id`, `archetype_code`; UNIQUE on source/source_id). `BloomDialWidget.tsx` and `DialArchetypeSection.tsx`: how they load and save a position (which endpoint, which props), whether they can take a target user id. `customerReads.getRecentDialActivity`: shape of the log the profile shows today.
4. **Identity.** `customerFacts.identityLink` signature and the `household_claim` row brief 1 writes; `customer_identity_unlink` as built (fact shape); `v_customer_identity` walk and its unlink exclusion; `householdService.accept` where `household_member.user_id` moves.
5. **Household 1 surfaces to extend.** `householdService`, `householdReads.mine`, `v_household_member` (`quiz_state` currently none/own), `FamilyTab.tsx` member card actions, `routes/household.ts` routes, `AdminHouseholds.tsx`. Where OT-104's typed badge words live.
6. **Production, read-only:** quiz_session count, dial event count, `household_member` rows (expect 2 after Dana's test: Dana-Admin and camila), identity links with `how = household_claim` (expect 0).

## Task 0.5 — Dana's manual steps
None.

---

## Part A — Schema (additive, idempotent; `comments.sql`; `catalog:md`)

- `quiz_session.taken_by_user_id UUID NULL REFERENCES user_profile(id)`: NULL = answered by the profile's own person. Comment: provenance, G2.12.
- `customer_dial_event.actor_user_id UUID NULL REFERENCES user_profile(id)`: NULL = self. Keep the fact shape; the integrity contract check from brief 1 must still pass.
- Lookups `household_account_state` (login, managed) and `household_quiz_state` (none, by_admin, own), `id SERIAL PK, code UNIQUE, label, customer_label`. Seeds: customer labels as they read on the tab today ("Has their own sign-in", "Set up by the admin"; "No quiz yet", "Quiz taken by <admin first name>" with a `{actor}` placeholder, "Took their own quiz").
- `v_customer_quiz_current`: ranking becomes self-taken first (`taken_by_user_id IS NULL DESC`), then recency; add `taken_by_user_id` and `taken_by_first_name` to the output.
- `v_customer_dial_current` (new, T3): per canonical user id and archetype, the latest `user_bloom_dial_current_position` across the profiles that `v_customer_identity` folds into that canonical id (`updated_at` decides); columns `canonical_user_id, archetype, slot_id, updated_at, set_by_user_id` (the profile row it came from). Readers: `householdReads`, and brief 3's `resolveItem`.
- `v_household_member`: `quiz_state` becomes a code from `household_quiz_state` resolved from `v_customer_quiz_current.taken_by_user_id` (none / by_admin / own) plus `quiz_taken_by_first_name`; `account_state` becomes a code from `household_account_state`; add `dial_slot_id` from `v_customer_dial_current` for the member's current archetype; add `claim_link_id` (the `customer_identity_link` row with `how = household_claim` that moved this member, NULL when none).
- `household_event_kind` seeds exist from brief 1 (`quiz_taken_for_member`, `dial_turned_for_member`, `identity_unlinked`); confirm, seed if missing. Add `dial_turn_undone`.

---

## Part B — Backend

B1 **Proxy quiz.** `POST /api/quiz/results` accepts optional `forMemberId`. When present: `householdService.assertMayQuizFor(actorProfileId, memberId)` (same household, actor holds `can_administer`, `quiz_for_member_enabled` is 1, member has no `quiz_session` with `taken_by_user_id IS NULL`; otherwise 409 `member_took_own_quiz` with the customer label from `household_quiz_state`). Then `saveQuizSession(memberUserId, archetype, ctx, { takenByUserId: actorProfileId })` and `recordScoredInterpretation` for the member's session. Side effects per Task 0 item 1 and CTO call 4. `householdService.recordEvent(quiz_taken_for_member, { member, actor, quiz_session_id })`. The response carries the member's first name and the member's open join link token (for Share), from `householdReads`. Idempotent on the same session payload as today's door is.

B2 **Dial for a member.** `PATCH /api/users/dial-position` accepts optional `forMemberId`. When present: `householdService.assertMayTurnDialFor(actorProfileId, memberId)` (same household, actor's roles OR to `may_turn_dials`). The upsert targets the member's `user_id`; `customerFacts.dialEvent` gets `actorUserId`. Event `dial_turned_for_member` with `{ member, actor, slot_id, archetype, previous_slot_id }`. `GET /api/users/dial-position?forMemberId=` returns the member's current position through `v_customer_dial_current`. Extract the handler's SQL into a service function if it is still inline (G3.1); declare writers in `comments.sql` if the module changes.

B3 **Member log and Undo.** `GET /api/household/me/log`: this member's `customer_dial_event` rows with a non-NULL `actor_user_id` (actor first name, slot, coffee, time) and whether each is still the current position. `POST /api/household/me/log/:dialEventId/undo` → `householdService.undoDialTurn`: the member only; a new move through the dial door to the member's own previous position (CTO call 1), `customerFacts.dialEvent` with `actor_user_id NULL`, event `dial_turn_undone`. Idempotent: undoing twice returns the first result.

B4 **Unlink (D25).** `customerFacts.identityUnlink(linkId, actorUserId, reason)` writes `customer_identity_unlink` (idempotent on `link_id`). `householdService.unlinkMember(memberId, actor)`: actor is the member themselves or an administrator; finds `claim_link_id`; writes the unlink; moves `household_member.user_id` back to the managed profile (`from_user_id` of the link); the account's own person is no longer a member; event `identity_unlinked`. The member's open join link, if any, stays; a new one can be created. `v_customer_identity` already skips unlinked links (brief 1).

B5 **Reads.** `householdReads.mine` adds per member: `quiz_state` code + label (with `{actor}` filled), `account_state` code + label, `dial_slot_id`, `may_quiz_for` (actor-specific boolean), `may_turn_dial_for`, `claim_link_id`; `householdReads.myLog`. `GET /api/household/lookups` returns the three lookups (`household_role`, `household_account_state`, `household_quiz_state`) with labels, replacing `GET /roles`. Admin: `GET /api/admin/households` gains `proxy_quizzes` (count of `quiz_session` with `taken_by_user_id` not NULL) per household and in the totals.

---

## Part C — Frontend

C1 **Quiz `?for=<memberId>`.** `FlavorQuiz.tsx`: when `for` is present and the signed-in user may quiz for that member (from `mine`), the name screen is prefilled with the member's first name and the header line reads "Profiling <name>" (copy from the API payload); the submit sends `forMemberId`; `PostQuizEmailGate` is skipped; the result screen names the member and shows **Share** (Web Share API, else Copy) with the member's join link and a sentence from the API ("Send <name> the link so they can see their result and take over their profile"). The admin's own quiz result is untouched. A `for` the user may not act on redirects to the tab with the API's reason.

C2 **Dial for a member.** On the member card, "Open their dial" (when `may_turn_dial_for`) opens the existing dial UI (`DialArchetypeSection` / `BloomDialWidget`, reused with a `forMemberId` prop, not a copy) for the member's current archetype; a save sends `forMemberId`. The card shows the member's current slot name.

C3 **Member card.** "Take the quiz for <name>" when `may_quiz_for` (`?for=` link); the `quiz_state` label (e.g. "Quiz taken by Dana", "Took their own quiz"); "Unlink" when `claim_link_id` is set (confirmation copy from the API). Badge words from the lookups (OT-104 closed); role names already are.

C4 **My log.** Under My plan: the member's log of dial turns by others ("<actor> turned the wheel for you and saved <coffee or slot>", time) with **Undo** on the one that is still current. Empty state from the API.

C5 **Admin** `AdminHouseholds.tsx`: proxy quiz count per household and in the header numbers.

---

## Part D — Tests (vitest, test DB)

- `assertMayQuizFor`: allowed for admin on a member with no quiz; refused after the member has a self-taken quiz; refused when `quiz_for_member_enabled` is 0; refused across households.
- `saveQuizSession` with `takenByUserId` writes it; `v_customer_quiz_current` ranks a self-taken session above a newer proxy session and a newer proxy above an older proxy.
- `v_household_member.quiz_state`: none → by_admin → own as sessions are added; `account_state` codes.
- Dial for a member: refused without `may_turn_dials` (set the flag to false on a role in the test, confirm, set back); allowed otherwise; `customer_dial_event.actor_user_id` set; `v_customer_dial_current` resolves the latest across two linked profiles.
- Undo: restores the previous slot, writes a self event, second undo is a no-op; undo with no previous position sets `slot_id` NULL.
- Unlink: link then unlink → canonical id reverts, `household_member.user_id` points at the managed profile, event written; unlink twice → one row.
- Proxy quiz route: taker-side side effects do not fire (assert on the welcome-email claim and the actor's lifecycle call per Task 0 findings).

## Part E — Acceptance (local backend, test DB; then prod with Dana)

Local: as the admin, take the quiz for camila (the member from Dana's prod test exists only on prod; create "Tom" locally); result names Tom, Share copies the join link; the tab shows "Quiz taken by Dana" and Tom's archetype; open Tom's dial, move it, the card shows the new slot; sign in as Tom in a private window (`danabar.mail+tom@gmail.com`), open his join link, Join; Tom's My log shows the turn with Undo; Undo restores; Tom retakes the quiz himself; the admin's "Take the quiz for Tom" is gone and the label reads "Took his own quiz"; admin page shows 1 proxy quiz. Unlink Tom from the admin side: Tom's account is out, the managed profile is back with its proxy quiz. Delete the temporary Firebase user afterwards.

Prod (Dana): take the quiz for camila on prod, open camila's dial, check the tab and the admin numbers.

## Docs and closing

`CLOSING_REPORT_2.md`, `WHAT_WE_BUILT.md`, `WHAT_WE_BUILT_DB.md`, `CATALOG.md` regenerated and committed, `README.md` here marked ran. **Also commit `DEVELOPMENT_GUARDRAILS.md`** (the dated G2.19 revision already in the working tree; it is this workstream's) in the docs commit. Leave `backend/src/features/commerce/README.md` and the Genova font deletions out, as brief 1 did. Mark OT-104 done in `OPEN_TASKS.md`.

## Do not

- Do not send any email and do not add an email field (D31).
- Do not let anyone retake a quiz for a member who has a self-taken quiz (D9); do not block a dial turn on that ground (D27).
- Do not copy a quiz result or a dial position onto another table; reads go through the views.
- Do not fork the quiz route, the dial route, `BloomDialWidget` or the result screen; add `forMemberId` to the existing doors.
- Do not DELETE a dial event, a quiz session, a link or any household row; undo and unlink are new rows.
- Do not hard-code badge words, button labels for states, or the member limit; lookups and `household_parameter`.
- Do not touch `checkoutService`, `subscription_item`, `subscriptionShipment` or `v_customer_bag_attribution` (brief 3).
