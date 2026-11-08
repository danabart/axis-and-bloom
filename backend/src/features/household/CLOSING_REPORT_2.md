# Closing report — Household 2: Quiz and dial by proxy

Brief: `CLAUDE_CODE_PROMPT_HOUSEHOLD_2_QUIZ_AND_DIAL_BY_PROXY.md` · Design: `DESIGN_HOUSEHOLD.md` · Test mode · Started 2026-11-07.

Status: Task 0 accepted (Dana, 2026-11-07); Parts A–D built, tested, accepted locally, committed and deployed (sections below). Task 0's production reads ran inside `BEGIN READ ONLY … ROLLBACK` (`backend/tmp/household2_task0.ts`, gitignored).

---

## Task 0 — findings

### 1. Quiz door and its side effects (T6)

`routes/quiz.ts:156` `POST /results`: `requireAuth` only (anonymous guests are allowed today, no `blockAnonymousAuth`). `profileId` comes from `INSERT INTO user_profile (firebase_uid) … ON CONFLICT DO UPDATE … RETURNING id` on `req.uid`. `resolveBranchAnswer` → `saveQuizSession(profileId, archetype, ctx, branchId)` (one INSERT into `quiz_session`, no dedupe: every POST is a new session) → `recordScoredInterpretation` in a second best-effort transaction → `res.json({id})` → `refreshLifecycleState(req.uid)` fire-and-forget. `GET /results/latest` → `getLatestQuizResult(db, firebaseUid)`: latest session **of that one profile** by `completed_at`; it does not walk `v_customer_identity` and does not use `v_customer_quiz_current`.

| Side effect of a completed quiz | Where | Proxy quiz |
|---|---|---|
| `quiz_session` INSERT | `saveQuizSession` | **redirect**: `user_id` = member, `taken_by_user_id` = actor |
| `quiz_session_interpretation` | `recordScoredInterpretation` | fire, for the member's session |
| `refreshLifecycleState(uid)` | `userLifecycle.ts:93` | Postgres only (`getUserSignals` reads by `firebase_uid`, no Firebase Auth or Firestore), so a `managed:` uid works. **Suppress for the actor, fire for the member** (CTO call 4 holds) |
| Firestore `users/{uid}` archetype / quiz copies / taste_journey | — | retired in Customer Blueprint C3 (comment in `quiz.ts` after the response); confirmed, nothing to do |
| Newsletter auto-subscribe, `source: post_quiz` (signed-in users, `FlavorQuiz.tsx:756-780`) | frontend → `routes/newsletter.ts` | **suppress.** It runs with the *signed-in person's* email and the *scored* archetype: on a proxy quiz it would overwrite the admin's `newsletter_subscriber.archetype` with the member's, and `newsletter.ts:201` then sends the **quiz-complete email** (`sendQuizCompleteEmailOnce`, the "results email" of T6) to the admin about the member's archetype |
| `PostQuizEmailGate` | `FlavorQuiz.tsx:1495, 1632` | shows only when the gate is locked (guest without a remembered email); a proxy quiz requires a signed-in admin, so it never shows; skipped explicitly anyway (C1) |
| Pixel `QuizStart`, `QuizComplete`, `EmailSubmitted`, `trackLead` | `FlavorQuiz.tsx:900, 1007, 720, 775` | **suppress all** (a proxy quiz is not an ad conversion or a lead) |
| `quiz_funnel_event` `quiz_start` / `quiz_complete` / `quiz_final` | `FlavorQuiz.tsx:902, 940, 1009, 1053, 1355` | fire (raw funnel rows, keyed by the browser's session key; the proxy count comes from `quiz_session.taken_by_user_id`) |
| `quiz_funnel_event` `email_submitted` | `FlavorQuiz.tsx:723, 777` | suppress (follows the subscribe) |
| Result-screen dial load / auto-save | `FlavorQuiz.tsx:602-611, 638-645` `getDialPosition` / `setDialPosition` | **redirect**: today it reads and writes the *signed-in person's* dial for the scored archetype; on a proxy quiz it must read the member's position and save with `forMemberId` |
| Name screen `sessionStorage axisBloomCustomerName` | `FlavorQuiz.tsx` | do not write the member's name over the admin's |
| `auth.POST /sync` match-claim ("has any `quiz_session`") | `routes/auth.ts:55` | keyed on the signing-in account's own profile; a proxy session sits on the managed profile, so nothing changes |

### 2. `v_customer_quiz_current` (schema.sql, Customer Blueprint C3 block)

`ranked` uses `ROW_NUMBER() OVER (PARTITION BY canonical_user_id ORDER BY completed_at DESC)`; the output is `rn_desc = 1`. `taken_by_user_id` enters there: `ORDER BY (taken_by_user_id IS NULL) DESC, completed_at DESC`. `prev_archetype_name` (LAG by `completed_at`) and the change counts stay chronological. Readers (columns added at the end are safe; the file uses `DROP VIEW … CASCADE; CREATE VIEW`): `customerReads.getQuizCurrent`, `routes/quiz.ts`, `routes/users.ts`, `routes/auth.ts`, `userSignals`, `sommelierRag`, views `v_palate_evidence`, `v_palate_slot_candidates`, `v_customer_calibration`, `v_household_member`.

### 3. Dial door

- `routes/users.ts:527` `GET /dial-position?archetype=` and `:564` `PATCH /dial-position`: SQL inline in the route. PATCH upserts `user_bloom_dial_current_position (user_id, archetype, slot_id)` on **every** call. **Only when `trigger` is `explicit_save` or `add_to_cart`** does it also call `customerFacts.dialEvent` (`source 'onsite'`, `sourceId randomUUID()`), and `explicit_save` additionally inserts `user_saved_item` (the profile's saved list). Plain turns (the auto-save on every wheel move) write **no event**.
- `customer_dial_event`: fact shape, `event_type TEXT CHECK (IN ('explicit_save','add_to_cart'))`, `slot_id`, `coffee_id`, `archetype_code archetype_enum`. Production: 44 events (explicit_save 14, add_to_cart 30), 41 positions, none with a NULL slot; `slot_id` is nullable.
- `user_bloom_dial_current_position` has a composite PK `(user_id, archetype)` (a G2.2 retrofit candidate; not touched here, its own brief).
- `coffee_archetype.code` is itself `archetype_enum`, so the dial position's `archetype` and `v_customer_quiz_current.archetype_code` join directly.
- Frontend: the dial UI is controlled by its parent (`selectedSortOrder` + `onDialSelect`; the parent auto-saves with `setDialPosition`). The explicit "Save" lives in `bloom/useDialSlot.ts:108` (`handleExplicitSave` → `setDialPosition(…, {trigger:'explicit_save'})`); add-to-cart in `bloom/cartItems.ts:65`. `lib/api.ts` `getDialPosition(archetype)` / `setDialPosition(archetype, sortOrder, event)` take no target. A `forMemberId` prop threads through `DialArchetypeSection` → `useDialSlot` → `api.ts` without a copy.
- `customerReads.getRecentDialActivity(uid)`: the canonical customer's `customer_dial_event` rows (archetype, event type, sort order), read by Liam; no actor, no time in the shape. Proxy events will reach the member's Liam context through it.

### 4. Identity

`customerFacts.identityLink({userId, fromUserId, toUserId, how, source, sourceId}, tx)`; brief 1's claim writes `how 'household_claim'`, `source 'onsite'`, `sourceId 'household_invitation:<id>'`. `customer_identity_unlink` is in the fact shape (`user_id`, `occurred_at`, `recorded_at`, `source`, `source_id`, `catalog_version`, `link_id`, `actor_user_id`, `reason`, `UNIQUE (source, source_id)`); `customerFacts` has no writer yet. `v_customer_identity`'s walk skips a link with an unlink row; `v_household_member` already reads the claimed first name through the same exclusion. `householdService.accept` moves `household_member.user_id` to the accepting account (roles untouched).

### 5. Household 1 surfaces

`householdService` (writer), `householdReads.mine` / `peekLink` / `roles`, `v_household_member` (`quiz_state` none/own, `account_state` login/managed as CASE text), `routes/household.ts` (`GET /roles`), `FamilyTab.tsx` (member card actions; OT-104's typed badge words at the `data-testid="account-state"` span and "No quiz yet"), `AdminHouseholds.tsx`. Admin API path is `/api/admin/household/households` (the brief writes `/api/admin/households`).

### 6. Production, read-only (2026-11-07)

`quiz_session` 147 · `customer_dial_event` 44 · dial positions 41 · `household_member` 2 (Dana-Admin: admin + household, login, own quiz, Earthy; camila: household, managed, no quiz, open link) · household 1, events created / member_added / link_created / role_granted / role_revoked · `customer_identity_link` with `household_claim` 0 · `customer_identity_unlink` 0. Matches the brief's expectation.

---

## Contradictions and decisions needed before Part A

1. **A proxy dial turn has no event today.** The dial auto-saves the position on every turn without an event; events exist only for explicit save and add-to-cart. If the admin's wheel auto-saved the member's position, the member's position would move with nothing in their log. **Recommendation:** in member mode the wheel does not auto-save; only the explicit Save writes, as one move (position + `explicit_save` event with `actor_user_id`), which is exactly D27's "turned the wheel for you and saved this coffee". Add-to-cart is hidden in member mode (ordering for the house is brief 3).
2. **The saved list.** `explicit_save` also adds the coffee to `user_saved_item`, the member's saved list. Write it for a proxy save too (the member sees "saved this coffee" in their list), or skip it (the saved list stays the member's own doing)? **Recommendation: skip**: the log entry carries the proxy save; the saved list stays self-made.
3. **Undo source (CTO call 1).** The brief reads the position before the turn from the member's previous `customer_dial_event`, but most earlier positions were plain turns with no event, so that would usually restore the wrong slot or none. **Recommendation:** read `previous_slot_id` from the `dial_turned_for_member` household event, which B2 already records at the turn (exact by construction); NULL → the position's `slot_id` set NULL. The undo is still a new move, never a delete.
4. **Undo's event type.** `customer_dial_event.event_type` is a CHECK list (`explicit_save`, `add_to_cart`); G2.7 forbids growing CHECK lists. **Recommendation:** the undo is the member's own `explicit_save` (`actor_user_id` NULL) of the previous slot, without a saved-list entry; the household event `dial_turn_undone` names it as an undo. No schema change to the CHECK.
5. **Unlinking an admin.** If the member being unlinked holds a role that administers (e.g. after a transfer), the member row would fall back to a managed profile that cannot sign in, leaving the household without a usable admin. **Recommendation:** refuse with 409 and the leave copy ("Hand the admin role to another member first").
6. **`GET /api/quiz/results/latest`** reads the latest session of the caller's own profile, not `v_customer_quiz_current`: after Tom claims his profile, his own `/results/latest` stays empty while the tab shows the proxy archetype. Out of this brief's scope (the admin's own result is untouched, as C1 requires). **Recommendation:** an open task, not changed here.
7. **Idempotency of the proxy quiz.** Today's door is not idempotent (every POST inserts a session). The brief says "idempotent as today's door is"; I keep today's behaviour (one session per completion) and say so.
8. **Anonymous actor.** `POST /results` accepts anonymous guests. With `forMemberId` an anonymous caller is refused (403), as every household route is.
9. **Copy.** The quiz-state label seeds use "Took their own quiz" (no pronoun; D28 stores nothing about gender); the brief's acceptance line "Took his own quiz" reads that way.
10. **Small path differences:** admin API is `/api/admin/household/households`; `GET /roles` is replaced by `GET /lookups` (the tab is updated in the same deploy). B2's extraction moves the dial upsert and the saved-item insert out of `routes/users.ts` into a service (`services/dialPositionService.ts`), with `Writer:` updated for `user_bloom_dial_current_position` and `user_saved_item`.

### Dana's answers (2026-11-07)

1–5 as recommended: member mode saves only on an explicit Save, one logged move with the actor; a proxy save skips the saved list; Undo restores `previous_slot_id` from the proxy turn (cleared when none); Undo is the member's own `explicit_save` plus the `dial_turn_undone` household event; unlinking an admin is refused with the transfer-first copy. 6: done in one function (below). 7–10 accepted as defaults.

---

## What was built

### Part A — schema

CATALOG.md checked (G2.4): no column records who answered a quiz or who turned a dial; no view resolves a dial position across linked profiles; the badge words had no table (OT-104).

- `quiz_session.taken_by_user_id`, `customer_dial_event.actor_user_id` (UUID FK `user_profile`, NULL = self; additive `ADD COLUMN IF NOT EXISTS`). `customer_dial_event` keeps its fact shape, so the integrity contract still holds (customerIntegrity passes in the suite and the boot reports nothing).
- Lookups `household_account_state` (login "Has their own sign-in", managed "Set up by the admin") and `household_quiz_state` (none "No quiz yet", by_admin "Quiz taken by {actor}", own "Took their own quiz").
- `v_customer_quiz_current`: `ROW_NUMBER() … ORDER BY (taken_by_user_id IS NULL) DESC, completed_at DESC`; adds `taken_by_user_id`, `taken_by_first_name` at the end (readers unaffected).
- `v_customer_dial_current` (new, T3): `DISTINCT ON (canonical_user_id, archetype)` over `user_bloom_dial_current_position` joined to `v_customer_identity`, latest `updated_at`; `set_by_user_id` = the profile row.
- `v_household_member`: `quiz_state` none / by_admin / own from the current quiz's `taken_by_user_id`, `quiz_taken_by_first_name`, `dial_slot_id` (the member's position for their current archetype), `claim_link_id` (the `household_claim` link tied to this member's own invitation, not undone). `account_state` stays a code; its words come from the lookup through `householdReads`. `v_household.proxy_quiz_count`.
- `household_event_kind` seed `dial_turn_undone` (the three others were seeded in brief 1).

### Part B — backend

- **B1, quiz door** (`routes/quiz.ts` `POST /results`, the same door): `forMemberId` → anonymous refused (403) → `householdService.assertMayQuizFor` (admin, same household, `quiz_for_member_enabled` = 1, member's quiz state not `own`; 409 `member_took_own_quiz` with the lookup's words) → `saveQuizSession(member, …, takenByUserId = admin)` → `recordScoredInterpretation` → `quiz_taken_for_member` event → `refreshLifecycleState(<member's managed uid>)`. Nothing for the admin's own profile; one session per completion as today.
- **Item 6**: `quizSession.getLatestQuizResult` selects the session `v_customer_quiz_current` names for the caller's canonical id (one function change, same return shape). A claimed member now sees the proxy result the tab shows, until they take their own.
- **B2, dial door** (`routes/users.ts`): the SQL moved to `services/dialPositionService.ts` (`resolveSlot`, `ownSortOrder`, `currentSlot`, `savePosition`), the one writer of `user_bloom_dial_current_position` and of dial `user_saved_item` rows. `forMemberId` on PATCH requires `trigger: explicit_save` (400 otherwise) and calls `householdService.turnDialFor` (role `may_turn_dials`, one transaction: position, `customer_dial_event` with `actor_user_id`, `dial_turned_for_member` with `previous_slot_id` and `dial_event_id`; no saved-list row). `GET ?forMemberId=` reads `v_customer_dial_current`. The customer's own dial behaves exactly as before (best-effort fact and saved item).
- **B3**: `householdReads.myLog` (from `customerReads.getDialTurnsByOthers`), `householdService.undoDialTurn` (the member only; only the turn that is still current, else 409 `turn_not_current`; restores `previous_slot_id` or NULL as the member's own `explicit_save`, no saved-list row; `dial_turn_undone`; a second call returns the first result).
- **B4**: `customerFacts.identityUnlink` (fact shape, `sourceId identity_unlink:<link id>`, with `.backfill` like every fact; the export-surface test updated). `householdService.unlinkMember`: the member or an administrator; finds the claim through `customerReads.getHouseholdClaimLink`; refuses an administering member (`transfer_first`); writes the unlink, moves `household_member.user_id` back to the managed profile, event `identity_unlinked`; a second call changes nothing.
- **B5**: `householdReads.mine` per member: `accountState` / `quizState` `{code, label}` (with `{actor}` filled), `archetypeCode`, `dial {slotId, sortOrder, name}`, `mayQuizFor`, `mayTurnDialFor`, `mayUnlink`, `unlinkConfirm`, and for the admin `proxyQuiz {header, shareLine, joinToken}`; `GET /api/household/lookups` (roles, account states, quiz states) replaces `/roles`; `GET /me/log`, `POST /me/log/:dialEventId/undo`, `POST /members/:memberId/unlink`; admin list carries `proxy_quiz_count`.
- lint:customer rule 4 keeps every read of a `customer_*` table in `customerReads.ts`: the log and the claim lookup live there (`getDialTurnsByOthers`, `getHouseholdClaimLink`).

### Part C — frontend

- **C1** `FlavorQuiz.tsx` `?for=<memberId>`: loads `mine`; a member the user may not quiz for → `/profile?tab=family` with the reason (shown on the tab). Name screen prefilled, header "Profiling <name>" from the API; the returning-user screen is skipped; the payload carries `forMemberId`. Suppressed: both newsletter subscribe effects (so no quiz-complete email and no change to the admin's subscriber row), the email gate, `QuizStart` / `QuizComplete` pixel events; funnel rows still fire. The result dial reads the member's position and saves only on Save (`forMemberId` through `DialArchetypeSection` → `useDialSlot` → `lib/api`; add-to-cart never moves anyone's dial in member mode); Worth Exploring is hidden. The result shows a Share block (the API's sentence, the member's join link; Share or Copy); with the curtain on, the sealed "on its way to <email>" screen is replaced by the member's result and the Share block. "Create a household party" on the returning screen now reads "Family Household" (D6).
- **C2** "Open their dial" on the member card: the existing `BloomDialWidget` with the family's slots from `/api/coffees/archetypes`, pre-set to the member's position, and a Save button (no copy of the widget). The card shows the slot name.
- **C3** Member card: badge and quiz words from the lookups (OT-104 closed), "Take the quiz for <name>", "Open their dial", "Unlink" with the API's confirmation sentence.
- **C4** My log: "<actor> turned the wheel for you and saved <slot>", Undo on the current one; empty-state sentence from the API (positive register).
- **C5** Admin Households: proxy quiz column and a totals line (open households, members, proxy quizzes).

### Part D — tests

- `services/householdProxy.test.ts` (10, real quiz and dial routers mounted with auth mocked and the lifecycle refresh spied): lookups and event kinds; `v_customer_quiz_current` ranking (self over a newer proxy, newer proxy over older); `assertMayQuizFor` allowed / switched off / across households / closed after a self-taken quiz, with `quiz_state` none → by_admin → own and `account_state` codes; the proxy route (session on the member, `taken_by_user_id` = admin, lifecycle called only with the member's uid, no `transactional_email_log` row, event written, the admin's own latest result still null, another household's admin refused, `proxy_quiz_count` 1); `getLatestQuizResult` follows the claim; dial refused with `may_turn_dials` false on the role (set back in `finally`), allowed otherwise, actor on the fact, no saved-list row, card slot set; PATCH needs `explicit_save` and leaves the admin's own dial alone; `v_customer_dial_current` across two linked profiles; undo restores, second undo is a no-op, the member's own event, cleared when there was no previous position; unlink (canonical reverts, member back on the managed profile, one unlink row on a second call, event, the account's `mine` is null) and an admin member refused; `mine` words and rights.
- Updated: `householdService.test.ts` (19 event kinds), `customerFacts.test.ts` (export surface).
- **Full backend suite**: 15 failed / 1,196, exactly the 15 of brief 1 (6 `quizScoring`, OT-73 `catalog_blueprint`, 8 OT-107 data collisions); none in household, customer, dial or quiz-session code. Frontend suite 145/145 (`bloom.test.tsx` caught a trailing `null` on the customer's own save call; the hook now passes `forMemberId` only when set). Backend tsc clean; frontend no new errors (7 pre-existing); `vite build` clean; all six CI lints clean.

## Acceptance — local, test mode (axisandbloom_test, backend :4917, Vite with the curtain on)

`backend/tmp/hh2_accept.mts` (phases) over HTTP with two Firebase users on Dana's plus-addresses (`danabar.mail+hh2admin@`, `danabar.mail+tom@`), custom-token sign-in, **both deleted from Firebase Auth at the end**; `backend/tmp/hh2_ui.mjs` signs a headless browser in with the same session for the screenshots.
- Admin "Dana" creates "Acceptance House 2", adds Tom, takes the quiz for Tom through the door: session on Tom, Tom's card "Quiz taken by Dana", Chocolate & Nutty; the admin's own `/quiz/results/latest` stays null. Admin turns Tom's dial (Save) to stop 3; the card shows "There's No Place Like Home"; `GET ?forMemberId=` → 3.
- Signed-in tab as the admin: Tom's card "SET UP BY THE ADMIN · In the household box · Chocolate & Nutty · There's No Place Like Home · Quiz taken by Dana", actions Take the quiz for Tom, Open their dial, Share / Copy / Revoke link, Remove; Open their dial shows the dial with Save. `/find-my-flavor?for=<Tom>` opens on "Profiling Tom" with "Tom" in the name field.
- Tom joins. His log: "Dana turned the wheel for you and saved There's No Place Like Home." with Undo; his `/quiz/results/latest` is the proxy session (item 6). Signed-in tab as Tom: his card shows Unlink; My log shows the entry with Undo.
- Tom undoes (restored NULL: Tom had no earlier position) and undoes again (`alreadyUndone: true`); his dial reads null; the log entry is undone. Tom takes his own quiz: the card reads "Took their own quiz", `mayQuizFor` false, and the admin's proxy attempt answers 409 "Tom: Took their own quiz.". Admin list: `proxy_quiz_count` 1.
- Admin unlinks Tom: Tom's `mine` is null; the card is back to "Set up by the admin", "Quiz taken by Dana", and Take the quiz for is offered again. Events: created, member_added, link_created, quiz_taken_for_member, dial_turned_for_member, link_accepted, member_claimed, dial_turn_undone, identity_unlinked.

## Deploy and smoke (production, 2026-11-07)

- Commit `5fec8d6` pushed; Deploy run `42437646594` green (backend + frontend); revision `axis-bloom-backend-00842-2bw`.
- Startup log: `DB schema verified`, `[db-comments] applied 1756 statements`, no ERROR line; the integrity findings are the same ones as before this deploy (quiz-integrity #10 = OT-33, sommelier-integrity #3, evidence-integrity #2 and #6, data-catalog #6); customer-integrity reports nothing. Data-catalog #4 reported `CATALOG.md` stale as expected; regenerated from prod (168 tables, 83 views, 1,505 columns, hash `2cfca3bd…`) and committed with this report.
- Production, read-only after the deploy: the two columns exist; the lookups read "Has their own sign-in" / "Set up by the admin" and "No quiz yet" / "Quiz taken by {actor}" / "Took their own quiz"; `v_household_member` for the household: Dana-Admin login, own quiz, Earthy, dial slot 15 (now resolved through `v_customer_dial_current`); camila managed, no quiz, no dial; `proxy_quiz_count` 0; `v_customer_dial_current` 41 rows (one per position, as before); no proxy sessions yet. The member view took 175 ms for the household (2 members).
- API signed out: `GET /api/household/lookups`, `/me/log`, `POST /me/log/:id/undo`, `POST /members/:id/unlink`, `GET` and `PATCH /api/users/dial-position` (with `forMemberId`), `POST /api/quiz/results` → 401; the retired `GET /api/household/roles` → 404.
- Frontend bundle `assets/index-hCISE2Ce.js` carries `/lookups`, `/me/log`, the proxy share block, "Profiling", "Open their dial", "Take the quiz for" and `forMemberId`.
- Not done by me: the signed-in check on production (Cloudflare challenges headless browsers on www). That is Dana's step by the brief: take the quiz for camila, open camila's dial, check the tab and the admin numbers.

## Deviations from the brief (and why)

- Undo source, undo event, member-mode saving, saved list, admin unlink: Dana's answers 1–5 (above).
- `getLatestQuizResult` reads `v_customer_quiz_current` (answer 6), so a claimed member and the tab agree.
- `account_state` / `quiz_state` stay codes in the view; the words are joined in `householdReads` from the lookups (a view body carries no words, G2.1).
- The household reads of `customer_*` facts sit in `customerReads.ts` (lint:customer rule 4), called from `householdReads` and `householdService`.
- The dial door's own SQL moved with the change (`dialPositionService`), and the two tables' `Writer:` fields moved with it.
- The admin API path is `/api/admin/household/households` (the brief wrote `/api/admin/households`).

## Open tasks

OT-104 done. Added: OT-108 (`v_household_member` costs ~70 ms per member on a prod-sized database; ~0.5 s for a six-member `mine`), OT-109 (Liam's dial context now includes turns made by another member, unmarked).
