# Family Household: design

Workstream: `household` · Written 2026-11-07 (CTO session) · Status: design closed 2026-11-07 after three CTO gap rounds (D1 to D20, D21 to D30, D31 to D34); brief 1 written the same day.
Customer-facing name (Dana, 2026-11-07): **Family Household**. The code and the DB say `household`. "Family Bundle" and "household party" are retired from copy.

## 1. Why this exists

Mission: understand each customer's palate and track it over time. Business goal: more than one bag per order. A Family Household is **several palates, one box, one card**: every member keeps their own profile, quiz and dial position; one person pays; the bags ship together; every bag is attributed to its drinker. The head of the household orders for the family whether or not the members ever sign in. The Customer Blueprint already prepared the attribution side (`intended_for_user_id`, `v_customer_bag_attribution`, `customer_identity_link.how = 'household_claim'`, `order.household_id`, `subscription.household_id`); nothing in the product connects to it yet.

## 2. Survey findings (2026-11-07, read-only)

What exists: `household`, `household_invitation`, `user_profile.household_id` + `is_household_admin`, `routes/household.ts` (2026-05, SQL in the route, eight handlers, four of them writing `user_profile`), `FamilyTab.tsx`, `JoinHousehold.tsx` (`/join-household?token=`, behind the pre-launch gate), the quiz name screen copy "profiling yourself or someone in your household", `checkoutService.resolveIntendedFor` (validates `intendedForUserId` against the buyer's household but demands one recipient for the whole order; the frontend never sends it), `subscriptionShipment.resolveItem(item, sub.user_id, …)` (every renewal follows the subscriber's dial), `customerReads` household member count for Liam, `liamAccess` (`s.household_id = up.household_id`).

Why the invite never arrived: `routes/household.ts` is the one email path that bypasses the shared sender. It calls the Resend SDK directly; the result is never read; the route answers 200 and the tab says "Invitation sent" regardless. Under D31 this path is removed rather than fixed: we no longer send invitations.

Why the invited account saw nothing: acceptance is link-only and `GET /api/household/mine` returns `null` for an invitee. Under D31 the link is the only door by design, and it works signed-out, signed-in and for a new sign-up.

Other gaps against the guardrails: free-text invitation status (G2.7), expiry hard-coded in the DDL (G2.1), removals erase history (G2.13), membership facts as two columns written by four route handlers (G2.5, G3.1), three customer-facing names.

Readers of the two retired `user_profile` columns found so far (brief 1 Task 0 completes the list): `routes/household.ts`, `checkoutService.resolveIntendedFor`, `customerReads` (member count), `liamAccess`, `v_customer_bag_attribution` (claim join).

## 3. Decisions (Dana, 2026-11-07; do not re-open)

### 3a. First round (D1 to D20)

- D1 Membership is a **member table** (one row per person per household) with a classification; customers can change their own classification.
- D2 A person holds **several roles at once**: a set of roles per member, not one type. Account state (has a login, or a profile the admin set up) is derived from the profile, never a role.
- D3 Customers can take the quiz for other household members. Having a quiz is never a condition of any role.
- D4 *Superseded by D31.* (Was: a managed member with an email gets an email when a quiz is taken for them.)
- D5 Parameters live in `household_parameter`, same shape as `commerce_parameter`.
- D6 Customer-facing name: Family Household.
- D7 Design first, then briefs.
- D8 Non-admin members edit only what is theirs: their own roles where the role allows, their quiz and dial, their email notices. Box settings (bags per member, frequency, card) are the admin's.
- D9 **Proxy until self-service** (guardrail G2.19): a member may act for another member to get bags moving; once that member has done the thing themselves, nobody overrides their data. Palate data, not transactions. A self-taken quiz beats a proxy quiz whatever the dates. (Dial: see D27.)
- D10 Members see each other's first name and archetype name, nothing deeper.
- D11 Both sides may end a membership: the member leaves, or the admin removes. Leaving takes the person out of the box; a renewal item pointed at them goes unresolved and the admin is notified; ordering for them again means adding them again. Ordering itself is never blocked: an unnamed bag in a household order stays unattributed until a bag-claim scan attributes it.
- D12 Subscription items are editable by the admin (add a bag for a member, drop one): brief 3.
- D13 No per-person bag stickers. Every member in the box **who has signed up themselves** gets an email when an order is placed for the household (their coffee named) and when it ships (scope narrowed by D31).
- D14 The join link is the authority: whoever holds the token may accept. (In-app email-match banner dropped by D31: there is no stored email to match.)
- D15 `/join-household` sits outside the pre-launch curtain.
- D16 Liam access for every member attached to an active household subscription (members in the box, with an account).
- D17 Admin portal gets a Households page: households, members, join links and their state.
- D18 *Superseded by D31.* (Was: per-admin daily invite cap.) Replaced by `max_members` as the only cap.
- D19 One admin card for the numbers: households, members per household, proxy quizzes, claim rate, bags per house order.
- D20 *Superseded by D31.* (Was: "This isn't me" from the invite email.) Replaced by Decline on the join page.

### 3b. Second round (D21 to D30)

- D21 **Admin transfer moves the role only.** The house subscription and the card stay with the subscriber until they cancel; the tab names who pays.
- D22 **Admin leaves or dissolves while holding the house subscription: the subscription is cancelled as part of the action** (confirmation first). Every other member with an account gets a handover email offering to start the house subscription on their side, with an extra discount inside a window: `household_handover_discount_pct` 5 and `household_handover_window_days` 7 in `household_parameter`, applied at subscription checkout on top of the existing tiers (brief 3). The window counts from the cancellation event.
- D23 **One household per person.** Accepting a join link while in another household leaves that household first (D11 consequences there), then joins. The join page says so before the click.
- D24 **A bag-claim scan beats the order line's recipient** for palate attribution when the claimant is a member of the order's household (self-done beats declared). `v_customer_bag_attribution` CASE order: claim by a household member, then `intended_for_user_id`, then buyer.
- D25 **Flexible, never strict: a claim can be undone.** Admin or member may unlink a wrongly claimed profile, revoke a join link, remove a member. Nothing is hard-deleted: an unlink is an insert-only `customer_identity_unlink` row, `v_customer_identity` skips unlinked links, `household_event` keeps the record.
- D26 *Superseded by D31.* (Was: `household_email_optout`.) Members who signed up have their own notification toggles (D8); nobody else is ever emailed.
- D27 **The quiz is strict, the dial is open** (G2.19 revised, dated in the guardrails file). A member may turn another member's dial at any time; the move is recorded with its actor (`customer_dial_event.actor_user_id`, NULL = self), shows in the member's own log ("Tom turned the wheel for you and saved this coffee") and the member can undo it with a move back, never a delete. Who may turn is a role column, `may_turn_dials`. Quiz by proxy keeps the D9 door.
- D28 **Children: nothing enforced, nothing asked.** No age or birthdate anywhere. A member without a login is the child's path.
- D29 Account deletion while in a household goes to `OPEN_TASKS.md` (Dana adds it).
- D30 A member holding `household` and `own_plan` shows their own plan beside their house line in Build the house box; nothing is blocked.

### 3c. Third round (D31 to D34)

- D31 **Link-first: we never hold a third party's contact data.** Adding a member takes a first name only; there is no email field. The admin gets a join link per member and shares it themselves (phone share sheet or Copy). Axis & Bloom sends no invitation email. Whoever opens the link signs up with their own email, by their own hand, and claims the profile; from then on they are a customer who gave us their address, with their own notification toggles. "Quiz taken for you" becomes a Share button on the result screen. "This isn't me" becomes Decline on the join page. The only third-party data we hold is a first name.
- D32 **All three briefs now**, while Stripe is still in sandbox. Every rule gets vitest coverage and the acceptance walks the full test-mode Stripe flow: house subscription, cancellation on leave, handover discount.
- D33 **Privacy page gains a Family Household paragraph** (text in §11), inserted by brief 1. Nothing for Camila.
- D34 **The head of the household orders for the family regardless of sign-up.** A member with no login can be quizzed by proxy, have their dial turned, be in the house order and the house subscription. The join link only adds a login on top; the admin keeps ordering for them afterwards (D9: transactions are never blocked).

### 3d. CTO technical calls (Dana: "your best judgment"; flag in the closing report if the code disagrees)

- T1 `v_customer_bag_attribution` and `liamAccess` read `user_profile.household_id`; both move to `v_household_member` in brief 1.
- T2 A `subscription_item` with `intended_for_user_id` stores no archetype: at renewal `resolveItem` takes the member's current archetype from `v_customer_quiz_current`, then the dial / signup slot / landing default chain. The CHECK becomes `archetype IS NOT NULL OR signup_coffee_id IS NOT NULL OR intended_for_user_id IS NOT NULL`. A member with no current quiz resolves `unresolved` and the admin is emailed (D11 path). Items without a recipient are unchanged.
- T3 Dial reads go through `v_customer_dial_current`: the latest position across a person's linked profiles, walked by `v_customer_identity`. `resolveItem`, the tab and Liam read it; the claim moves nothing.
- T4 A join link opened by someone who already has an account (or a guest profile with a self-taken quiz) links that profile to the managed one through `customerFacts.identityLink (how = household_claim)`; the self-taken quiz outranks any proxy quiz (D9).
- T5 Never `DELETE` a household row; dissolve is `dissolved_at`. In every brief's Do-not block (`household_invitation` and `user_email` carry `ON DELETE CASCADE`).
- T6 Quiz-completion side effects for `?for=` (results email, Firestore `users/{uid}` mirror, `refreshLifecycleState`, funnel events) are listed one by one in brief 2 Task 0 with fire / suppress / redirect for each; the results email is suppressed for a proxy quiz (the member has no email). Proxy quizzes get their own count on the numbers card.
- T7 *Dropped with D31* (quiz-for-you email cap).
- T8 The buyer is skipped in the D13 member mails; the order confirmation already covers them.
- T9 A join link never expires on its own (there is no email to go stale); the admin revokes it and gets a new one. `household_invitation.expires_at` stays nullable and unused for new rows; `invite_expiry_days` is not seeded.
- T10 One open join link per member (`household_invitation.member_id`, partial unique on open status). Two members with the same first name are allowed; the tab shows the added date.
- T11 One frequency per house subscription (D8); a member who wants another cadence takes `own_plan`. Item add/drop applies from the next renewal invoice, no proration.
- T12 Removing an `own_plan` member ends the membership row only; their own subscription, orders and quiz are untouched.
- T13 The join token admits its holder past the pre-launch curtain for that browser session (sign-up, profile, quiz result), since `/join-household` already sits outside it (D15).
- T14 Migration of today's rows: `is_household_admin = true` gives admin + household roles, other `household_id` holders get household; existing `household_invitation` rows backfill `status_id` from the text column with `member_id` NULL and are shown as legacy, not re-sent. Brief 1 Task 0 checks the counts against production first.

## 4. Concepts

**Household.** One row, one admin, one shipping address at order time (the buyer's), one card (the admin's). A person is in at most one household at a time (D23).

**Roles** (`household_role`, seeded; every rule is a column). A member holds one or more roles, each a `household_member_role` row:

| code | customer_label | can_administer | in_house_box | self_manages_cycle | may_turn_dials | admin_may_set | member_may_self_set |
|---|---|---|---|---|---|---|---|
| admin | Household admin | yes | no | no | yes | yes (transfer) | no |
| household | In the household box | no | yes | no | yes | yes | no |
| own_plan | On their own plan | no | no | yes | yes | no | yes |

- `can_administer`: add and remove members, grant and revoke roles, share and revoke join links, order the house box, pay.
- `in_house_box`: the admin can put bags for this member in the house order and subscription.
- `self_manages_cycle`: the member orders and subscribes for themselves (today's regular customer behaviour).
- `may_turn_dials`: may turn another member's dial (D27); recorded with the actor, undoable by the member.
- `admin_may_set` / `member_may_self_set`: who may grant or revoke the role. Constraints: at least one admin per household, at least one role per member.

Examples: the creator = admin + household; a spouse added by the admin, no login = household; the same spouse after opening the join link and buying their own bags sometimes = household + own_plan; a roommate who shares the household for visibility but pays for themselves = own_plan.

**Account state** (derived from `user_profile`, shown as a badge, never stored on the member): *has a login*, or *set up by the admin* (a non-signable uid `managed:<uuid>`, `user_type` `household_managed`). The quiz state (none, by the admin, own) is a derived column on `v_household_member`.

**Quiz by proxy** (D9). An actor with `can_administer` may take the quiz for a member as long as that member has no self-taken quiz (`quiz_session` rows for them with `taken_by_user_id IS NULL`); once they have one the door closes and the tab shows "Tom took his own quiz". `quiz_session.taken_by_user_id` records who answered. `v_customer_quiz_current` ranks a self-taken quiz above any proxy quiz, then by recency. A proxy quiz stays on the member's profile after the claim, until they take their own.

**Dial by a member** (D27). Any member whose role has `may_turn_dials` may turn another member's dial through the existing dial door (`users.PATCH /dial-position` → `customerFacts.dialEvent`) with `actor_user_id`. The member's log shows it with Undo.

**Managed member, join link and claim** (D31, D34). Adding a member creates the managed profile (first name) and the member row at once, plus one open `household_invitation` row holding the token; the tab shows Share and Copy for `/join-household?token=…`. The admin can order for the member from this moment. Opening the link: a visitor signs up (or signs in) and accepts; `householdService.accept` links the managed profile to the account through `customerFacts.identityLink (how = household_claim)`, moves the member row's `user_id` to the surviving profile and leaves roles unchanged (the badge changes by itself). Facts on the managed profile (quizzes, bags, dial) are walked at read time. Decline on the same page records `invite_declined`; the managed member stays in the household for the admin to order for, the link is closed. If the acceptor is in another household, the page says they will leave it, then D23 applies.

## 5. Data model

Prefix `household_` throughout (G2.3). Surrogate `id` on every table (G2.2). Writer: `services/householdService.ts` for every `household_*` table (G2.5, G2.6); identity facts stay with `customerFacts`. Reads: `services/householdReads.ts` over `v_household_*` views only.

New tables (CATALOG.md checked 2026-11-07; nothing fits because no existing table holds a membership as a row with roles, a household history, or household parameters):

- `household_member`: id, household_id FK, user_id FK user_profile, status_id FK `household_member_status` (active, left, removed), joined_at, ended_at; partial unique `(user_id) WHERE status = active`.
- `household_member_role`: id, member_id FK, role_id FK `household_role`, granted_at, revoked_at, granted_by_user_id; partial unique `(member_id, role_id) WHERE revoked_at IS NULL`. Current state; history in `household_event`.
- `household_role` (the capability columns in §4), `household_member_status`, `household_invitation_status` (open, accepted, declined, revoked, legacy), `household_event_kind` (created, member_added, link_created, link_revoked, link_accepted, link_declined, member_claimed, identity_unlinked, role_granted, role_revoked, admin_transferred, member_left, member_removed, dissolved, quiz_taken_for_member, dial_turned_for_member, subscription_cancelled_on_leave, handover_offered), `household_event_source` (customer, admin, system, cron): lookups per G2.7.
- `household_event`: id, household_id, member_id (nullable), kind_id, source_id, actor_user_id, detail JSONB, created_at. Insert-only (G2.13).
- `household_parameter`: shape of `commerce_parameter` (key, value_numeric/value_text, since, superseded_at, note, current-row unique index). Seed: `max_members` 6, `quiz_for_member_enabled` 1, `house_box_bags_per_member` 1, `household_handover_discount_pct` 5, `household_handover_window_days` 7.
- `customer_identity_unlink`: id, link_id FK `customer_identity_link`, actor_user_id, reason, created_at; insert-only (D25). `v_customer_identity` skips a link with an unlink row. Prefix `customer_` (identity fact); writer `customerFacts.identityUnlink`, called by `householdService`.

Altered:
- `household_invitation`: `status` becomes `status_id` FK (old column kept, no longer written, G2.11); add `member_id` FK household_member (the member the link claims), `declined_at`, `revoked_at`; `invited_email` stays nullable and is never written for new rows (D31); `expires_at` unused for new rows (T9).
- `household`: `primary_billing_user_id` stays as the admin pointer and moves on transfer (D21); `updated_at` maintained by the service; `dissolved_at`.
- `user_profile.household_id`, `is_household_admin`: retired. Kept, never written again, column comments say so; every reader moves to `v_household_member`.
- `quiz_session.taken_by_user_id` FK user_profile, NULL = self (brief 2).
- `customer_dial_event.actor_user_id` FK user_profile, NULL = self (brief 2). Writer stays `customerFacts.dialEvent`.
- `subscription_item.intended_for_user_id` FK user_profile, NULL = the subscriber; a recipient line stores no archetype (T2) (brief 3).
- `"order".household_id`: written by `checkoutService` when any line is for a member other than the buyer (brief 3).
- `user_type`: one row `household_managed` (`middleware/auth` never resolves such a uid; `staleGuestCleanup` skips it).

Views: `v_household` (household, admin, who pays, member count, bag count of the last house order), `v_household_member` (member, roles with flags, account state, first name, current archetype from `v_customer_quiz_current`, quiz state none / by the admin / own, open join link), `v_household_invitation` (join links with state), `v_household_event`, `v_customer_dial_current` (T3, brief 2).

## 6. Flows

1. **Create**: profile → Family Household tab → name → `householdService.create` (household + member with admin and household roles + event).
2. **Add a member**: first name → managed profile + member with the `household` role + open join link, in one transaction. Tab shows the member at once with Share / Copy link, "Take the quiz for", and the house-box line.
3. **Share the link**: the admin shares `/join-household?token=` through their own channel. Revoke closes the link and creates a new one on request.
4. **Open the link** (signed-out, signed-in, or new sign-up): the page shows the household name and the member's first name, Join and Decline. `householdService.accept` (claim or link, events, leaves another household first per D23) or `householdService.decline`.
5. **Quiz for a member**: `?for=<member id>`; allowed when the actor holds `can_administer` and the target has no self-taken quiz (D9); `quizSession.saveQuizSession` gets `userId = member`, `takenByUserId = actor`. The result screen names the member and offers Share ("Send Tom his result", the join link).
6. **Dial for a member**: the member's card on the tab opens their dial; a save goes through the dial door with `actor_user_id`; the member's log shows it with Undo.
7. **Order for the house**: every cart line carries "for whom" (members with `in_house_box`, the buyer first). `resolveIntendedFor` becomes per line. "Build the house box" adds `house_box_bags_per_member` bag(s) per in-box member at their current match (dial, else signup slot, else landing default). Members with no quiz show "Take the quiz for <name>" instead of a bag; a member on their own plan shows it beside their line (D30).
8. **Subscribe for the house**: `subscription_item.intended_for_user_id` per line; `resolveItem` follows that member's current quiz and dial (T2, T3). The admin adds and drops items from subscription self-service (D12; `subscriptionService` stays the one writer, `subscription_event` kinds `item_added` / `item_removed`). An item whose member is no longer in the box resolves `unresolved` and the admin is emailed (D11). Existing 2+ bag free shipping and the 10% tier apply.
9. **Order and shipping notices** (D13): each in-box member who has signed up, buyer excluded, gets their own email naming their coffee, through `sendOnce`, templates `household_bag_ordered:<order line id>` and `household_bag_shipped:<order line id>`.
10. **Roles, leave, transfer, remove, dissolve, unlink**: `householdService.grantRole` / `revokeRole` check `admin_may_set` / `member_may_self_set` and the two constraints; leave/remove end the member row and write the event; dissolve requires no other active member. Transfer moves the role and `primary_billing_user_id` (D21). An admin leaving or dissolving with the house subscription active cancels it through `subscriptionService` and sends the handover email with the D22 perk. Unlink writes `customer_identity_unlink` (D25).
11. **Liam**: `liamAccess` grants access to every member attached to an active household subscription (D16) via `v_household_member`; `customerReads` keeps the member count from the view; Liam knows members by first name and archetype only (D10); recommending for the house is a later Liam brief.
12. **Admin portal**: Households page (D17) and the numbers card (D19), read from `v_household_*`.

## 7. Email

Axis & Bloom emails only people who signed up themselves (D31). All household mail goes through `services/transactionalEmail.sendOnce` (template keys carry the row id), kind `transactional`, from `RESEND_FROM`. Templates: bag ordered (member, buyer skipped), bag shipped (member, buyer skipped), renewal item unresolved (admin), house subscription handover (D22). Copy in positive register (G4.4), no roaster names (G4.5). No invitation email, no quiz-for-you email, no cap, no opt-out table.

## 8. Frontend

- Family Household tab (`FamilyTab.tsx`, on the handoff tokens): household name, members with role labels, account-state badge, archetype name and quiz state, per-member actions by role flags (Take the quiz for, Open their dial, Share link, Copy link, Revoke link, Remove, Make admin), Add a member (first name), Build the house box, activity (from `v_household_event`), Leave / Dissolve. Member view: the household, members' first names and archetypes, My plan (toggle the roles the member may set on themselves), My log (dial turns by others, with Undo), Leave.
- `JoinHousehold.tsx`: works signed-out (sign-up or sign-in inline, then accept), outside the pre-launch curtain (D15, T13). Shows household name, member first name, Join, Decline, and the "you will leave <other household>" line when it applies.
- Quiz: `?for=` entry; name screen prefilled; result screen names the member and offers Share.
- Cart lines: "for whom" select from `v_household_member`; checkout passes `intendedForUserId` per line.
- Subscription self-service: shows whom each item is for; the admin adds and drops items (D12).
- Privacy page: the §11 paragraph.
- Every label, role name and option comes from the API (G4.2). Share uses the Web Share API where present, Copy otherwise.

## 9. Guardrails touched

G1.1 roles · G1.3 brief anatomy · G1.4 verify first · G1.6 push is deploy · G1.13 Sonnet, test mode · G2.1 `household_parameter` · G2.2 · G2.3 `household_` · G2.4 CATALOG.md checked (§5) · G2.5 one writer `householdService`, identity facts via `customerFacts`, reads via `v_household_*` · G2.6 one door · G2.7 lookups · G2.11 retire, never drop · G2.12 `taken_by_user_id`, `actor_user_id` · G2.13 `household_event` · G2.14 membership lives in `household_member` only · G2.17 comments.sql → catalog:md · G2.19 (revised 2026-11-07) · G3.1 thin routes · G3.3 idempotent accept/claim · G3.9 reuse `sendOnce`, `resolveIntendedFor`, `subscriptionShipment`, `customerFacts.identityLink`, `customerFacts.dialEvent` · G4.1 shared cart components · G4.4 copy · G4.6 curtain side stated · G5.1 vitest.

## 10. Brief plan

1. **HOUSEHOLD_1_FOUNDATION_AND_JOIN_LINKS**: Task 0 diagnosis and reader list; lookups, `household_member`, `household_member_role`, `household_event`, `household_parameter`, `householdService` + `householdReads` + views; migrate existing memberships; retire the two `user_profile` columns and move every reader (`resolveIntendedFor` membership check, `customerReads`, `liamAccess`, `v_customer_bag_attribution` join); managed profiles and `user_type` `household_managed`; add-member by first name with join link, Share / Copy / Revoke; join page signed-out and signed-in, Join / Decline, D23 leave-then-join, outside the curtain with token pass-through; roles grant/revoke, transfer (D21), leave, remove, dissolve (without the subscription cancel, which waits for brief 3); Family Household tab on the tokens; admin Households page; privacy paragraph; Resend call removed from the route.
2. **HOUSEHOLD_2_QUIZ_AND_DIAL_BY_PROXY**: `quiz_session.taken_by_user_id`, `?for=` quiz, proxy-until-self-service in `quizSession` and `v_customer_quiz_current`, result-screen Share; `customer_dial_event.actor_user_id`, dial for a member, My log with Undo; `v_customer_dial_current`; `customer_identity_unlink` and the unlink action (D25); quiz side effects (T6); proxy quiz count.
3. **HOUSEHOLD_3_ORDER_FOR_THE_HOUSE**: cart "for whom", per-line `resolveIntendedFor`, `order.household_id`, D24 attribution order, `subscription_item.intended_for_user_id` + T2 archetype at renewal + shipment per member, item add/drop, unresolved-item notice, Build the house box (D30), ordered and shipped emails to members, cancel-on-leave and handover email with the discount hook (D22), Liam access for members, the numbers card. Full Stripe test-mode acceptance (D32).

Later, separate workstreams: Liam for the house; the tab's visual pass in Camila's website series.

## 11. Privacy page paragraph (D33; brief 1 inserts it in `Privacy.tsx`)

**Family Household.** A customer can set up a Family Household and add the people they buy coffee for by first name, so each person's taste is matched on its own. We hold nothing else about a person added this way: no email, no age, nothing typed in by someone else. If the household's admin shares a join link with them and they open it, they create their own account with their own email, and from then on they control their profile, their notifications and their place in the household, including leaving it. Until then, the admin can order coffee for them and see only what they set up themselves.
