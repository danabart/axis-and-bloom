# Claude Code brief — Household 1: Foundation and join links

Workstream: household (`README.md`, `DESIGN_HOUSEHOLD.md` here; read the design first, it is the spec) · Written 2026-11-07 by the CTO session · Model: Sonnet · Dana runs it; push = deploy · **Test mode.** No money in this brief.

**Guardrails (DEVELOPMENT_GUARDRAILS.md).** Read it before Task 0. This brief touches:
G2.1 nothing hard-coded (parameters: `household_parameter`; vocabularies: `household_role`, `household_member_status`, `household_invitation_status`, `household_event_kind`, `household_event_source`) · G2.2 surrogate id PK · G2.3 prefix `household_` · G2.4 CATALOG.md checked (why nothing fits: no existing table holds a membership as a row with roles, a household history or household parameters; design §5) · G2.5 one writer (`householdService` for every `household_*` table; `customerFacts.identityLink` stays the identity-link writer), reads via `v_household_*` · G2.6 one door · G2.7 lookups · G2.8 idempotent schema, dated migration script · G2.11 retire `user_profile.household_id` / `is_household_admin`, never drop · G2.13 `household_event` · G2.14 membership lives in `household_member` only · G2.17 comments.sql → catalog:md · G3.1 routes call services · G3.3 idempotent accept · G3.6 ownership on every customer route · G3.9 reuse, do not fork · G4.2 nothing typed in · G4.6 `/join-household` outside the curtain · G5.1 vitest · G1.6 push is deploy, one closing report.
STOP points: after Task 0 (findings, contradictions), and before the production migration script in Part A4 runs (it writes production rows).

**Goal.** Replace the 2026-05 household code with the Family Household foundation: membership as rows with roles, an insert-only history, parameters in a table, one service, views as the read path. The admin adds members by first name and gets a join link per member to share themselves (Axis & Bloom sends no invitation email). The join page works signed-out, signed-in and for a new sign-up, outside the pre-launch curtain. The two reported symptoms (invite never arrived, invited account saw nothing) disappear because the paths that produced them are gone.

**Decisions already made (Dana 2026-11-07, `DESIGN_HOUSEHOLD.md` §3; do not re-open).** This brief implements D1, D2, D5, D6, D8, D10, D11, D14, D15, D17, D21, D23, D25 (table only; the unlink action is brief 2), D28, D31, D33, D34, and technical calls T1, T5, T9, T10, T12, T13, T14. Quiz and dial by proxy are brief 2; ordering, subscriptions, the cancel-on-leave and handover are brief 3. Where this brief and the design disagree, the design wins; say so in the closing report.

---

## Task 0 — Verify (write findings into `CLOSING_REPORT_1.md` before changing anything; STOP after)

1. **Readers of the retired columns.** `grep -rn "household_id\|is_household_admin" backend/src frontend/src`. Expected at least: `routes/household.ts`, `checkoutService.resolveIntendedFor`, `customerReads` (member count, ~line 400), `liamAccess` (`s.household_id = up.household_id`, ~line 42), `v_customer_bag_attribution` (claim join `claimant.household_id = o.household_id`, schema.sql ~6116), `liamProfile`, the Firestore `users/{uid}` mirror if it carries `householdId`, any admin page. List every hit with file and line; each one is moved in Part B or named as out of scope with the reason.
2. **Today's household code.** `routes/household.ts` handlers (`/create`, `/mine`, `/invite`, `/leave`, `/members/:userId`, `/invite/:token`, `/join/:token`, `/invitations/:invitationId`), `FamilyTab.tsx`, `JoinHousehold.tsx`, `Profile.tsx` (where the tab mounts), `App.tsx` routing and `lib/prelaunch.ts` `PRELAUNCH_OPEN_ROUTES`. Confirm the direct Resend SDK call in the invite handler and that no other code imports it.
3. **Production, read-only** (Cloud SQL proxy, `script:household1_task0`): counts of `household`, `user_profile WHERE household_id IS NOT NULL`, `… AND is_household_admin`, `household_invitation` by `status`; households with zero or more than one admin; members whose household row is missing. Record the numbers: Part A4 is checked against them.
4. **Managed profiles.** How `middleware/auth` resolves a uid (confirm a `managed:<uuid>` uid can never authenticate: it is not a Firebase uid and `user_type` `household_managed` is refused explicitly). `staleGuestCleanup.purgeStaleAnonymousGuests` selection criteria: confirm it would or would not catch a profile with no Firebase record, and add the `user_type` exclusion in Part B regardless. `auth.POST /sync` and `customerFacts.identityLink`: signature, `how` values, idempotency key (`source`, `source_id`).
5. **Patterns to copy.** `commerce_parameter` DDL + `commerceParameters.ts` (reader shape, current-row index) and the admin parameter editor if one exists (`routes/commerceAdmin.ts`); `subscription_event` / `subscription_event_kind` for the event table; `order_refund_reason` for a lookup with `customer_label`; `v_subscription_status` for a status view; `routes/subscriptions.ts` for the zod + ownership route shape; `admin/AdminCommerce.tsx` + `AdminLayout.tsx` for the admin page and sidebar.
6. **Share API.** Whether the frontend already uses `navigator.share` anywhere (reuse), and the toast/copy helper used by the bag QR or checkout pages.
7. **Privacy page.** `Privacy.tsx` structure: where a new section fits and how sections are styled.

## Task 0.5 — Dana's manual steps
None expected. If `lib/prelaunch.ts` turns out to need an env change for the token pass-through, STOP and say which.

---

## Part A — Schema (`schema.sql` additive and idempotent, `comments.sql`, `catalog:md`)

A1 **Lookups** (each: `id SERIAL PK`, `code TEXT UNIQUE`, `label`, `customer_label` where customers see it; seeds `ON CONFLICT DO NOTHING`):
- `household_role` with the capability columns `can_administer`, `in_house_box`, `self_manages_cycle`, `may_turn_dials`, `admin_may_set`, `member_may_self_set` (all BOOLEAN NOT NULL), `sort_order`. Seed the three rows exactly as the design §4 table.
- `household_member_status`: active, left, removed.
- `household_invitation_status`: open, accepted, declined, revoked, legacy.
- `household_event_kind`: the list in design §5.
- `household_event_source`: customer, admin, system, cron.

A2 **Tables**:
- `household_member`: `id UUID PK`, `household_id FK household`, `user_id FK user_profile`, `status_id FK household_member_status`, `joined_at TIMESTAMPTZ`, `ended_at TIMESTAMPTZ NULL`, `created_at`, `updated_at`. Partial unique index on `(user_id) WHERE status_id = <active>` (use a stable expression: a `status_code` generated column or a function-based index on the FK with the active id resolved at index creation; pick the one Postgres accepts in the idempotent script and say which).
- `household_member_role`: `id UUID PK`, `member_id FK`, `role_id FK`, `granted_at`, `revoked_at NULL`, `granted_by_user_id FK user_profile NULL`. Partial unique `(member_id, role_id) WHERE revoked_at IS NULL`.
- `household_event`: `id UUID PK`, `household_id FK`, `member_id FK NULL`, `kind_id FK`, `source_id FK`, `actor_user_id FK NULL`, `detail JSONB NOT NULL DEFAULT '{}'`, `created_at`. Insert-only; index `(household_id, created_at)`.
- `household_parameter`: copy `commerce_parameter`'s shape exactly (key, value_numeric, value_text, since, superseded_at, note, current-row unique index). Seed: `max_members` 6, `quiz_for_member_enabled` 1, `house_box_bags_per_member` 1, `household_handover_discount_pct` 5, `household_handover_window_days` 7. Range notes in `note`.
- `customer_identity_unlink`: `id UUID PK`, `link_id FK customer_identity_link`, `actor_user_id FK NULL`, `reason TEXT`, `created_at`. Created now so the view can honour it; written only in brief 2. `v_customer_identity` gains `AND NOT EXISTS (SELECT 1 FROM customer_identity_unlink u WHERE u.link_id = cil.id)` in its walk join.

A3 **Alters**:
- `household_invitation`: add `status_id FK household_invitation_status`, `member_id FK household_member NULL`, `declined_at`, `revoked_at`, `accepted_by_user_id FK user_profile NULL`. `status` (text) stays, no longer written; comment says retired. `invited_email` becomes nullable; `invited_by_id` stays. Drop the DDL default on `expires_at` for new rows (keep the column). Partial unique `(member_id) WHERE status_id = <open>`.
- `household`: add `dissolved_at TIMESTAMPTZ NULL`; `updated_at` maintained by the service.
- `user_profile.household_id`, `user_profile.is_household_admin`: no DDL change; comments rewritten: "Retired 2026-11-07 (household 1). Never written. Membership lives in household_member; read v_household_member."
- `user_type`: seed `('household_managed', 'Profile set up by a household admin; cannot sign in')`.

A4 **Migration script** `backend/src/db/migrations/household_2026_11_07.sql` (run once against production after STOP; idempotent, `ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`):
- Every `user_profile` with `household_id` → one active `household_member` (`joined_at = COALESCE(household.created_at, now())`).
- `is_household_admin = true` → roles admin + household; others → household. A household with no admin gets `primary_billing_user_id`'s member as admin; a household with none at all is listed in the report, not fixed.
- Every existing `household_invitation` → `status_id` from the text (`pending` → `legacy`, `accepted` → `accepted`, `cancelled` → `revoked`), `member_id NULL`.
- One `household_event` `created` per migrated household with `source = system`, `detail = {"migrated_from": "user_profile", "script": "household_2026_11_07"}`.
- Report counts before and after against Task 0 item 3.

A5 **Views** (all `DROP VIEW IF EXISTS … CASCADE; CREATE VIEW`, comments in `comments.sql`):
- `v_household`: household id, name, admin user id (the active member with the admin role), `pays_user_id` (= `primary_billing_user_id`), active member count, `dissolved_at`, created_at.
- `v_household_member`: member id, household id, user id, first name (`user_profile.first_name`), status code, roles as an array of codes plus the six capability flags OR-ed across the member's roles, `account_state` (`login` when `user_type` ≠ `household_managed`, else `managed`), current archetype name from `v_customer_quiz_current` (through `v_customer_identity` canonical id), `quiz_state` (`none` / `own` for now; `by_admin` arrives with brief 2's `taken_by_user_id`), the open join link's invitation id and token (NULL when none), `joined_at`, `ended_at`.
- `v_household_invitation`: invitation id, household id, member id, member first name, status code and customer_label, token, created_at, accepted_by_user_id, declined_at, revoked_at.
- `v_household_event`: event with kind and source codes and labels, actor first name, member first name.
- `v_customer_bag_attribution`: the claim join moves from `claimant.household_id = o.household_id` to an EXISTS on `v_household_member` (active member of `o.household_id`). CASE order unchanged in this brief (D24 is brief 3).

`comments.sql`: every new object and column; `Writer: householdService.<function>` per table (`seed` and `backfill:household_2026_11_07` where applicable), `Readers:` the views and `householdReads`. Then `npm run catalog:md -- --expect-db axisandbloom` and commit `CATALOG.md`.

---

## Part B — Backend

B1 **`services/householdParameters.ts`**: copy `commerceParameters.ts` for `household_parameter` (numeric, text, `setParameter` that supersedes the current row). It is the table's only reader and writer besides the seed.

B2 **`services/householdService.ts`** (the one writer of `household`, `household_member`, `household_member_role`, `household_invitation`, `household_event`; every function in a transaction; every state change writes an event):
- `create(actorUserId, name)` → household, member (admin + household), event `created`. Refuses when the actor is already an active member anywhere (409 `already_in_household`).
- `addMember(householdId, actorUserId, firstName)` → requires `can_administer`; enforces `max_members`; creates `user_profile` (`firebase_uid = 'managed:' || gen_random_uuid()`, `user_type` household_managed, `first_name`), the member with the `household` role, one open `household_invitation` (token = 32 random bytes hex, `invited_email NULL`, `expires_at NULL`, `member_id`), events `member_added`, `link_created`. Returns the member and the link.
- `revokeLink(invitationId, actor)` → status revoked, `revoked_at`, event `link_revoked`; `createLink(memberId, actor)` → a new open link when none is open.
- `peekLink(token)` (public read, through `householdReads`): household name, member first name, status, and whether the token is still open.
- `accept(token, acceptingUserId)` (idempotent: the same token and user twice returns the same result): refuses a non-open token (410). If the accepting user is an active member of another household → end that membership (`member_left`, status left) first (D23). If the invitation has a `member_id` (a managed profile): call `customerFacts.identityLink({ from: managedProfileId, to: acceptingUserId, how: 'household_claim', source: 'household_invitation', source_id: invitationId })`, then `UPDATE household_member SET user_id = acceptingUserId` on that member row, roles untouched, events `link_accepted` + `member_claimed`. If `member_id` is NULL (legacy invitation): create the member with the `household` role, event `link_accepted`. Status accepted, `accepted_by_user_id`.
- `decline(token)` (public, no auth: whoever holds the link may decline): status declined, `declined_at`, event `link_declined`. The member row stays active (the admin keeps ordering for them, D34).
- `grantRole(memberId, roleCode, actor)` / `revokeRole(...)`: `admin_may_set` when the actor administers, `member_may_self_set` when the actor is the member; refuse removing the last admin or the last role (409 with the lookup's label). Events `role_granted` / `role_revoked`.
- `transferAdmin(householdId, toMemberId, actor)`: grant admin to the target, revoke from the actor, `primary_billing_user_id` = target's user id, event `admin_transferred` (D21: nothing else moves; the response says who pays).
- `leave(householdId, actorUserId)`: an admin may leave only when another admin exists or no other active member exists (otherwise 409 `transfer_first`); status left, `ended_at`, event `member_left`. (Subscription cancel-on-leave is brief 3; until then the route refuses leave/dissolve when an active `subscription` with this `household_id` exists, 409 `subscription_active`, copy from the API.)
- `removeMember(memberId, actor)`: requires `can_administer`; status removed, event `member_removed`; open link revoked.
- `dissolve(householdId, actor)`: requires no other active member; `dissolved_at`, the admin's membership ends, event `dissolved`. Never DELETE.

B3 **`services/householdReads.ts`**: `mine(userId)` (the household the user is an active member of, with members, roles, flags, links, recent events, parameters the UI needs: `max_members`), `peekLink(token)`, admin reads (`listHouseholds`, `household(id)`), all from `v_household_*`.

B4 **`routes/household.ts`** rewritten (zod, `requireAuth` + `blockAnonymousAuth` except the two public link routes, ownership through `householdReads`, no SQL): `POST /` create · `GET /mine` · `POST /members {firstName}` · `POST /members/:memberId/link` · `DELETE /links/:invitationId` (revoke) · `GET /links/:token` (public peek) · `POST /links/:token/accept` (auth) · `POST /links/:token/decline` (public) · `POST /members/:memberId/roles {roleCode}` · `DELETE /members/:memberId/roles/:roleCode` · `POST /transfer {toMemberId}` · `POST /leave` · `DELETE /members/:memberId` · `POST /dissolve` · `GET /roles` (the role lookup with labels and flags, for the UI). Remove the Resend import and the old handlers; keep the old paths answering 410 for one release so a stale tab fails loudly, not silently.

B5 **Readers moved** (from Task 0 item 1): `checkoutService.resolveIntendedFor` membership check → `v_household_member` (keep today's one-recipient rule; brief 3 makes it per line); `customerReads` member count → `v_household_member`; `liamAccess` → `EXISTS` on `v_household_member` for the subscription's household; `liamProfile` and the mirror if they read it. `staleGuestCleanup`: exclude `user_type` household_managed explicitly. `middleware/auth`: refuse a profile whose `user_type` is household_managed (403) in case a token ever carried such a uid.

B6 **Admin**: `routes/householdAdmin.ts` (admin-gated like `commerceAdmin`): `GET /households`, `GET /households/:id`, `GET /parameters`, `PUT /parameters/:key` (through `householdParameters.setParameter`).

---

## Part C — Frontend

C1 **Pre-launch**: add `/join-household` to `PRELAUNCH_OPEN_ROUTES`. Token pass-through (T13): when the page loads with a token, set the same session bypass the gate already uses for a bypassed session, so sign-up, profile and the tab are reachable in that browser session.

C2 **`JoinHousehold.tsx`**: peek the token; show household name, member first name, Join, Decline. Signed-out: inline sign-in / sign-up (reuse the existing auth component), then accept. If `mine` says the visitor is in another household, show the API's "you will leave <name>" line before Join. Closed token: the API's state label. After Join: route to Profile with the Family Household tab open.

C3 **`FamilyTab.tsx`** on the handoff tokens: create form (name); household header (name, who pays); member cards (first name, role labels, account-state badge, archetype name or "No quiz yet", actions by flags: Share link / Copy link / Revoke link, Make admin, Remove; Leave on own card); Add a member (first name only, `max_members` from the API); My plan (role toggles the member may self-set); activity list; Leave / Dissolve with confirmation. Share uses `navigator.share` when available, else copy with the existing toast. Every label from `GET /roles` and the lookups' `customer_label`; nothing typed in (G4.2). Buttons for brief 2 and 3 (Take the quiz for, Open their dial, Build the house box) are not rendered yet.

C4 **Admin** `AdminHouseholds.tsx` + sidebar entry: table of households (name, admin, members, created), drawer with members, roles, links and their state, events; parameters card editing `household_parameter` rows.

C5 **`Privacy.tsx`**: insert the paragraph from design §11 under a "Family Household" heading, in the page's existing section style.

---

## Part D — Tests (vitest, test DB)

- Lookup seeds present; `household_parameter` seeds present; `householdParameters` reads and supersedes.
- `create` twice by the same user → one household (409 the second time).
- `addMember` → managed profile with `household_managed` type, member with `household` role, one open link; `max_members` enforced; the event rows exist.
- `accept` twice with the same token and user → one claim, one `customer_identity_link` row (`how = household_claim`), the member's `user_id` moved, roles unchanged. Accept from a user in another household → that membership `left`, then joined (D23). Accept a revoked token → 410. Decline → declined, member still active.
- `v_customer_identity` honours `customer_identity_unlink` (insert a link, then an unlink row directly in the test, canonical id reverts).
- Role rules: last admin cannot be revoked; last role cannot be revoked; `member_may_self_set` respected (own_plan self-toggle allowed, household self-toggle refused).
- `transferAdmin` moves admin role and `primary_billing_user_id` only.
- `leave` by the sole admin with other members → 409 `transfer_first`; `removeMember` revokes the open link; `dissolve` refuses with other active members.
- Migration script against a fixture: two households, one with two members and one admin, one with no admin and a `primary_billing_user_id`; run twice → same counts.
- `resolveIntendedFor` passes for an active member via the view and refuses a `left` member; `liamAccess` grants via the view.
- `staleGuestCleanup` leaves a `household_managed` profile alone.

## Part E — Acceptance (local backend, test DB, then prod with Dana)

Local, test mode: create a household as a signed-in test user; add "Tom"; copy the link; open it in a private window; sign up as `danabar.mail+tom@gmail.com`; Join; the tab on both sides shows Tom with the `login` badge; the admin's view shows one `member_claimed` event; `v_customer_identity` for Tom's managed id resolves to the new account. Add "Ella"; revoke her link; the old token answers 410; create a new link. Decline a link in a private window: member stays, link declined. Transfer admin to Tom and back. Admin Households page lists it with the events. Privacy page shows the paragraph. `/join-household?token=…` reachable with `VITE_PRELAUNCH_MODE` on.

Prod (with Dana in the session): after deploy and the Part A4 STOP, run the migration; compare counts to Task 0; Dana opens her Family Household tab and sees her existing household migrated (checkout1's legacy invitation shown as legacy); creates a member and shares a link to her phone.

## Docs and closing

`CLOSING_REPORT_1.md` (Task 0 findings, A4 counts before/after, every reader moved with file:line, test evidence, acceptance evidence), `WHAT_WE_BUILT.md` entry, `WHAT_WE_BUILT_DB.md` entry, `CATALOG.md` regenerated and committed, `README.md` here marked "ran <date>". One commit per part is fine; one push at the end; deploy green; startup log clean (`[data-catalog]`, integrity); one closing report.

## Do not

- Do not send any email from this brief: no invitation, no "quiz taken for you", nothing. Remove the Resend call from `routes/household.ts`.
- Do not add an email field anywhere in the household UI or API (D31). Do not store an age or birthdate (D28).
- Do not DELETE a `household`, `household_member`, `household_invitation` or `user_profile` row. Dissolve is `dissolved_at`; the invitation table's `ON DELETE CASCADE` must never fire.
- Do not drop or rewrite `user_profile.household_id` / `is_household_admin`; retire them (comments) and stop writing them.
- Do not write `customer_identity_link` from `householdService`; call `customerFacts.identityLink`.
- Do not touch `quiz_session`, `customer_dial_event`, `subscription_item`, `checkoutService` pricing or `subscriptionShipment` (briefs 2 and 3), beyond the `resolveIntendedFor` membership check in B5.
- Do not hard-code a role name, flag, label or limit in code or the frontend; everything comes from the lookups and `household_parameter`.
- Do not run the Part A4 migration against production before the STOP and Dana's go.
