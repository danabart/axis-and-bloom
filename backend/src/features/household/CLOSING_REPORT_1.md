# Closing report — Household 1: Foundation and join links

Brief: `CLAUDE_CODE_PROMPT_HOUSEHOLD_1_FOUNDATION_AND_JOIN_LINKS.md` · Design: `DESIGN_HOUSEHOLD.md` · Test mode · Started 2026-11-07.

Status: Task 0 done and accepted (Dana, 2026-11-07). Parts A–D built, tested locally, committed and deployed; **STOP 2: the A4 migration has not run against production** (waiting for Dana's go). Task 0's production reads ran inside `BEGIN READ ONLY … ROLLBACK` (`backend/tmp/household1_task0.ts`, gitignored, application_name `script:household1_task0`).

---

## Task 0 — findings

### 1. Readers of `user_profile.household_id` / `is_household_admin`

| File:line | What it does | Plan |
|---|---|---|
| `routes/household.ts` (12–295, all eight handlers) | SQL in the route; four handlers write the two columns; `DELETE FROM household` in `/leave` (line 170) | Rewritten (B4) |
| `services/checkoutService.ts:73-84` `resolveIntendedFor`; `:156-171` reads `profile.household_id` | membership check | → `v_household_member` (B5) |
| `services/customerReads.ts:405-406` | Liam household member count | → `v_household_member` (B5) |
| `services/liamAccess.ts:42` | `s.household_id = up.household_id` | → EXISTS on `v_household_member` (B5) |
| `db/schema.sql:6115-6116` `v_customer_bag_attribution` | claim join `claimant.household_id = o.household_id` | → EXISTS on `v_household_member` (A5) |
| **`routes/users.ts:404`** (not in the brief) | `/homepage-state` next delivery date: `up.id = s.user_id OR up.household_id = s.household_id` | → `v_household_member` (B5, added) |
| **`services/userSignals.ts:246`** (not in the brief) | `hasActiveSubscription` via the same OR join | → `v_household_member` (B5, added) |
| **`services/userSignals.ts:282-299`** (not in the brief) | `household_size` count → `householdType = 'family'` | → `v_household_member` (B5, added) |
| `frontend/.../FamilyTab.tsx:11,199,205` | renders `is_household_admin` | Rewritten (C3) |
| `liamProfile.test.ts`, `palateReads.test.ts`, `liamAccess.test.ts` | fixtures set `user_profile.household_id` to exercise the attribution claim join / Liam access | Fixtures gain `household_member` rows (Part D) |
| `liamProfile.ts` (service) | no hit | nothing to move |
| Firestore `users/{uid}` mirror | no `householdId` anywhere in backend/src | nothing to move |
| Admin pages | no hit | nothing to move |

`subscription.household_id` and `"order".household_id` are not retired; they stay (brief 3 writes them).

### 2. Today's household code

- `routes/household.ts`: eight handlers as listed in the brief, confirmed. `/invite` (91-148) calls `resend.emails.send` at line 136 and never reads the result, as the design says.
- **Contradiction:** "no other code imports it" is not true of the Resend SDK in general: `routes/auth.ts:2,11,135` (password reset) and `routes/cron.ts:2,21,204,360,539,568` construct their own `new Resend(...)` too. Neither is household code; both are out of scope for this brief. Removing the household one leaves those two untouched. (Listed for `OPEN_TASKS.md` as shared-sender bypasses, unless you say otherwise.)
- `JoinHousehold.tsx` lives in `components/`, not `pages/`; it compares `user.email` to `invitedEmail`, says "Family Bundle Invitation". Mounted at `App.tsx:236` **inside `<PrelaunchGate>`**.
- `FamilyTab.tsx` (285 lines) mounts in `Profile.tsx:767-771`; `/profile?tab=family` already deep-links (`VALID_TABS`, line 64). Tab label "Family" is typed in at `Profile.tsx:437`.
- `lib/prelaunch.ts`: `PRELAUNCH_OPEN_ROUTES` is documentation; enforcement is "is the route wrapped in `<PrelaunchGate>`". `/sign-in`, `/profile`, `/find-my-flavor` are already open.

### 3. Production, read-only (2026-11-07)

| | count |
|---|---|
| `household` | 1 (`22cbcdf2…` "Bars-checout1-test", created 2026-11-06, `primary_billing_user_id` = Dana-Admin `5d005443…`) |
| `user_profile WHERE household_id IS NOT NULL` | 1 (Dana-Admin, user_type `admin`) |
| … `AND is_household_admin` | 1 |
| `household_invitation` by status | `pending` 1 (`8aa38c6a…`, has an `invited_email`, expires 2026-11-13) |
| households with 0 admins / >1 admin | 0 / 0 |
| members whose household row is missing | 0 |
| `"order"` / `subscription` with `household_id` | 0 / 0 |
| `customer_identity_link` rows | 0 |
| existing `household_*` objects | `household`, `household_invitation` only |
| `user_type` | `admin`, `customer` |

A4 expectation: after the migration, 1 active `household_member` with roles admin + household, 1 `household_event` `created`, the one invitation `status_id = legacy`, `member_id NULL`.

### 4. Managed profiles, auth, cleanup, identity link

- `middleware/auth.requireAuth` never reads `user_profile`; it only verifies a Firebase ID token. A `managed:<uuid>` uid can only appear in a verified token if our own Admin SDK mints one. The refusal is therefore cheap to add as a uid-prefix check (no DB round trip on every request); a `user_type` lookup on every authenticated request would add one query per request. **Plan: prefix check in `requireAuth`/`optionalAuth`/`requireAdmin`, prefix exported from `householdService` (one place).**
- **`staleGuestCleanup` would delete a managed profile.** The "empty guest" query (no quiz, no order, no verified email, >7 days) matches a managed member; `admin.auth().getUser('managed:…')` returns `auth/user-not-found`, which the loop treats as "already gone, safe to clean up", and then runs `DELETE FROM user_profile` (or fails on the new `household_member` FK and logs an error every day). The exclusion in B5 is a real fix, not belt and braces. Both candidate queries get `user_type ≠ household_managed`.
- `customerFacts.identityLink({ userId, fromUserId, toUserId, how, source, sourceId })`; `how ∈ email_match | household_claim | admin` (DB CHECK already allows `household_claim`); idempotent on `UNIQUE (source, source_id)`, returns `inserted:false` on a repeat.
- **Contradiction:** the brief passes `source: 'household_invitation'`. `source` is typed `FactSource = 'onsite' | 'liam' | 'sms' | 'shopify' | 'qr' | 'backfill' | 'backfill_detected'` (a channel, not a table); the column itself is free TEXT. The one existing caller (`auth.ts:81`) uses `source: 'onsite'`, `sourceId: '<from>:<to>'`. **Plan: `source: 'onsite'`, `sourceId: 'household_invitation:<invitationId>'`** (same idempotency, no widening of the channel type). Say if you would rather widen `FactSource`.
- `auth.POST /sync` upserts `user_profile` on `firebase_uid`; a managed profile is never touched by it.

### 5. Patterns to copy (confirmed present)

`commerce_parameter` (schema.sql 8997-9029: `SERIAL id`, `key`, `value_numeric`/`value_text` XOR check, `since`, `superseded_at`, `note` with "Range:"/"Format:", current-row partial unique) + `commerceParameters.ts` (60 s cache, `setParameterInTx` supersede); `subscription_event_kind` (9286, `SERIAL id, code UNIQUE, label`); `order_refund_reason` (9393, with `customer_label`); `routes/commerceAdmin.ts`; `AdminCommerce.tsx` + `AdminLayout.tsx` sidebar (line 46-50). Grants: the prefix-driven loops at the end of schema.sql give `household_*` the operating grant (full DML) and `customer_identity_unlink` the fact grant (SELECT, INSERT) automatically. I will add `REVOKE UPDATE, DELETE` on `household_event` and `household_parameter` (+ `UPDATE (superseded_at)`), matching `order_event` / `commerce_parameter`.

Partial unique on "active": Postgres refuses a subquery in an index predicate, so I will create both partial indexes (`household_member (user_id) WHERE status_id = <active id>`, `household_invitation (member_id) WHERE status_id = <open id>`) in a `DO $$` block that resolves the id from the lookup and `EXECUTE`s `CREATE UNIQUE INDEX IF NOT EXISTS` (the brief's second option).

Placement: `customer_identity_unlink` must exist before `v_customer_identity` (5880); `v_household_member` must come after `v_customer_quiz_current` (~5948) and before `v_customer_bag_attribution` (6090), because the `DROP VIEW v_customer_identity CASCADE` at 5880 drops every dependant and the file must recreate them in the same pass.

### 6. Share API

`navigator.share` with clipboard fallback exists once, in `ShareMatchRow.tsx` (local `copied` state, no shared toast). Copy-with-feedback elsewhere is per-component (`AdminQrDoor`, `AdminRoasteryPortal`). No shared toast/copy helper exists. **Plan: extract a small `lib/share.ts` (`shareOrCopy(url, title, text)`) and have both `ShareMatchRow` and `FamilyTab` call it** (reuse, do not fork).

### 7. Privacy page

`components/Privacy.tsx` (114 lines): sections are `<h2 style={h2}>` + paragraphs, in this order: quiz answers, account and order data, newsletter, analytics, cookies, deleting your data. The Family Household section goes after "Account and order data".

---

## Contradictions and decisions needed before Part A

1. **T13 token pass-through (C1).** The brief says to set the gate's existing session bypass when `/join-household` loads with a token. That bypass is the team's `abPreview` flag: it unlocks **every** route (`/shop`, `/cart`, `/checkout`, `/bloom`…) for the rest of the browser session, which is far wider than T13's "sign-up, profile, quiz result". Those three are already open routes today. **Recommendation:** unwrap `/join-household` from `<PrelaunchGate>`, add it to `PRELAUNCH_OPEN_ROUTES`, and set no bypass flag. Nothing else is needed for sign-up → join → `/profile?tab=family`. Go with the recommendation, or set the full bypass as written?
2. **Identity-link `source`** (item 4): `'onsite'` + `sourceId 'household_invitation:<id>'` instead of `'household_invitation'`. (My default unless you say otherwise.)
3. **Legacy invitation holds an email.** The one production invitation stores `invited_email` (a third party's address, against D31's "the only third-party data we hold is a first name"). The brief keeps it as `legacy`; G2.10 forbids deleting raw data. I will leave it and list it in `OPEN_TASKS.md` unless you want it blanked by the A4 script.
4. **Readers the brief did not list:** `routes/users.ts:404` and `userSignals.ts:246, 282` move to `v_household_member` in B5 along with the listed ones.
5. **Accept edge cases the brief leaves open** (my defaults): the acceptor is already an active member of the *same* household (e.g. the admin opens their own link) → 409 `already_member`, nothing changes. The acceptor is the sole admin of another household that still has other members → D23's leave is refused with `transfer_first`, so the accept fails with that 409 and the API's message.
6. **Model tier:** the brief says Sonnet; this session runs on Opus 5.5. No effect on the work.

### Dana's answers (2026-11-07)

1. Open only `/join-household` in `PRELAUNCH_OPEN_ROUTES`, no session bypass. **T13 is dropped.**
2. Identity link `source: 'onsite'`, `sourceId: 'household_invitation:<id>'`.
3. Keep the legacy `invited_email` (G2.10); OT-101.
4. Same household → "already a member", nothing changes; sole admin of another household with members → refused with the leave copy ("transfer first").

Also agreed: the three extra readers move; the guest-cleanup exclusion is a real fix; the other two Resend callers are OT-102; `managed:` uids are refused by prefix in the auth middleware.

---

## What was built

### Part A — schema (`schema.sql`, `comments.sql`, migration)

CATALOG.md checked (G2.4): no existing table holds a membership as a row with roles, a household history or household parameters; `commerce_parameter` belongs to the commerce domain; `customer_identity_link` is insert-only and cannot record an undo, hence `customer_identity_unlink` (design §5).

- Lookups (SERIAL id, `code` UNIQUE, `label`, `customer_label` where customers see it, `ON CONFLICT DO NOTHING` seeds): `household_role` (the six capability columns + `sort_order`, seeded exactly as design §4), `household_member_status`, `household_invitation_status`, `household_event_kind` (18), `household_event_source`.
- Tables: `household_member` (UUID), `household_member_role` (partial unique `(member_id, role_id) WHERE revoked_at IS NULL`), `household_event` (insert-only), `household_parameter` (`commerce_parameter` shape, five seeds with `Range:` notes).
- **Partial uniques on a lookup id** (the brief's second option): a `DO $$` block resolves the `active` / `open` id and `EXECUTE`s `CREATE UNIQUE INDEX IF NOT EXISTS household_member_one_active … WHERE status_id = <id>` and `household_invitation_one_open`. Idempotent by name.
- **`customer_identity_unlink`, deviation from the brief's column list.** The brief listed `id, link_id, actor_user_id, reason, created_at`. Every `customer_*` table is a fact table under the contract `customerIntegrity` checks 4 and 5 enforce (`occurred_at`, `recorded_at`, `source`, `source_id`, `UNIQUE (source, source_id)`, the `(user_id, occurred_at)` index). With `created_at` only, check 5 threw `column "occurred_at" does not exist`: caught by the full suite, and it would have been an ERROR in the boot log. Built in the fact shape: `user_id` (= the link's `from_user_id`), `occurred_at`, `recorded_at`, `source`, `source_id`, `catalog_version`, `link_id`, `actor_user_id`, `reason`. Brief 2's `customerFacts.identityUnlink` inserts it like every other fact. `v_customer_identity`'s walk skips a link that has an unlink row.
- Alters: `household_invitation` + `status_id`, `member_id`, `declined_at`, `revoked_at`, `accepted_by_user_id`; `invited_email` and `status` drop NOT NULL; `status` and `expires_at` drop their defaults (a new row carries no `pending` and no 7-day expiry); `household.dissolved_at`; `user_type` `household_managed`.
- Views: `v_household_member` (the identity walk and quiz read are **scalar subqueries**, so readers that only need membership — `liamAccess`, `userSignals`, the checkout recipient check — never walk `v_customer_identity` for every profile), `v_household`, `v_household_invitation`, `v_household_event`; `v_customer_bag_attribution`'s claim join is an EXISTS on `v_household_member` (CASE order unchanged).
- Grants: `household_event` and `household_parameter` lose UPDATE/DELETE (`UPDATE (superseded_at)` back on the parameter table); the request pool has no DELETE on `household`, `household_member`, `household_member_role`, `household_invitation` (T5 in the database, not only in code).
- `comments.sql`: every new object and column; the two retired `user_profile` columns and three retired invitation columns are `Class: deprecated`. The migration is declared `manual:migrations/household_2026_11_07.sql` in `Writer:` (the lineage lint reports `backfill:` as a dead door for a file it does not scan).
- Migration `backend/src/db/migrations/household_2026_11_07.sql`, as the brief, plus two guards found while testing: the `created` event and the "no admin → billing user becomes admin" step touch only 2026-05 households (some profile still carries their id), so a household created by the new code between deploy and the run is never stamped "migrated"; a profile already active in a new household is skipped (it shows as `legacy_members > members` in the report) instead of failing the unique index.

### Part B — backend

- `services/householdParameters.ts` (copy of `commerceParameters`, numeric keys).
- `services/householdService.ts`, the one writer: `create`, `addMember`, `createLink`, `revokeLink`, `accept`, `decline`, `grantRole`, `revokeRole`, `transferAdmin`, `leave`, `removeMember`, `dissolve`, `recordEvent`. One transaction each; the household row is locked first; rights are read from `v_household_member` inside the transaction; a unique-index race answers 409 `conflict`. Judgment calls inside the brief's rules: the last member to leave closes the household (`dissolved` event); an admin who leaves while another admin stays hands `primary_billing_user_id` to that admin; an admin-only actor who transfers keeps `household`, so every member keeps a role; `createLink` refuses a member who already signs in (`member_has_login`).
- `services/householdReads.ts`: `mine` (join tokens only for a member who administers; first name + archetype for everyone, D10), `peekLink` (with the D23 "you will leave" name), `roles`, `listHouseholds`, `household`, `profileIdForUid`.
- `services/householdManaged.ts`: `MANAGED_UID_PREFIX`, in its own module so the auth middleware imports nothing else.
- `routes/household.ts` rewritten (zod, no SQL, no Resend, no email). Five 2026-05 paths answer 410; `DELETE /members/:userId` is now the new remove route (OT-105). `routes/householdAdmin.ts` at `/api/admin/household`.
- Readers moved (Task 0 file:line): `checkoutService.ts:73-84` `resolveIntendedFor` (both active in the same household via `v_household_member`; `household_id` no longer selected at `:156`; exported for its test); `customerReads.ts:405`; `liamAccess.ts:42`; `routes/users.ts:404`; `userSignals.ts:246` and `:282`.
- `staleGuestCleanup.ts`: both candidate queries skip `household_managed`. **A real fix**: without it a managed member matched the empty-guest rule, `getUser` answered user-not-found, and the loop deleted the profile.
- `middleware/auth.ts`: `requireAuth` and `requireAdmin` answer 403 for a `managed:` uid; `optionalAuth` treats it as signed out.

### Part C — frontend

- `/join-household` unwrapped from `<PrelaunchGate>` and listed in `PRELAUNCH_OPEN_ROUTES`; **no session bypass (T13 dropped)**.
- `JoinHousehold.tsx`: peek, Join / Decline, the "Joining moves you out of <name>" line, the closed-link state label from the API. Signed out it links to `/sign-in?redirect=…` (the existing sign-in page) rather than an inline form (OT-106).
- `FamilyTab.tsx` on the handoff tokens: create; who pays; member cards (role labels from `GET /roles`, account-state badge, archetype or "No quiz yet"); Share / Copy / Revoke link; New join link; Make admin (transfer, members with a login only); Remove; My plan (roles the member may set on themselves); Add a member (first name, `max_members` from the API); activity; Leave / Close household. Profile tab label "Family Household".
- `lib/share.ts` (`shareOrCopy`, `copyLink`); `ShareMatchRow` now calls it (reuse, not a second copy).
- `admin/AdminHouseholds.tsx` + sidebar "Family Households": table, drawer (members, links, events), the parameters card (`EvidenceParametersCard`, as Commerce).
- `Privacy.tsx`: the design §11 paragraph after "Account and order data".

### Part D — tests

- `services/householdService.test.ts` (19 tests): seeds; parameters read and supersede (in a rolled-back transaction); create twice → 409; addMember (managed profile and type, household role, open link with no email / no expiry / no text status, events, `link_open`, `max_members`); a non-admin is refused; accept twice → one claim, one `household_claim` link (`onsite`, `household_invitation:<id>`), member moved, roles unchanged, canonical id = the account; D23 leave-then-join (the last member out closes the old household); sole admin with members → `transfer_first`, nothing changes; same household → `already_member`; revoked → 410, a new link, decline twice → one event, member active; `v_customer_identity` honours an unlink row; last admin / last role / self-set rules; transfer moves the role and the pay pointer only, and back; leave / remove (link revoked) / dissolve; an active house subscription blocks leave and dissolve; `resolveIntendedFor` and `liamAccess` follow an active membership and drop a left one; `mine` hides tokens from non-admins; migration fixture (two households, one without an admin flag) run twice → identical, the legacy invitation keeps its email.
- `staleGuestCleanup.test.ts` +1 (managed profile untouched, no `deleteUser`); fixtures in `liamAccess`, `liamProfile`, `palateReads` tests now insert `household_member` rows.
- **Full suite** (test DB refreshed from prod 2026-11-07, `schema.sql` applied twice clean): 16 failed / 1185 on the first run. One was mine (`customerIntegrity`, the unlink shape above): fixed, and the four affected files then passed 116/116. The other 15: the known baseline (6 `quizScoring`, OT-73 `catalog_blueprint`) and 8 data collisions with the fresh prod clone (`evidenceViews` ×2, `evidenceAdmin`, `catalogService` slot priority, `sommelierAnswer`, `sommelierEval` ×2, `sommelierRag`), none touching household code: OT-107 (G1.12).
- Backend tsc clean; frontend adds no new errors (7 pre-existing); `vite build` clean; all six CI lints clean.

## Acceptance — local, test mode (axisandbloom_test, backend :4917)

`backend/tmp/hh1_accept.mts` over HTTP with two Firebase users on Dana's plus-addresses (`danabar.mail+hh1admin@`, `danabar.mail+tom@`), signed in with custom tokens, **both deleted from Firebase Auth afterwards**:
- Household "Acceptance House" `85384209-29f7-4d9a-8179-e0c1531d3aba`; Tom added (member `d882dd7a…`, invitation `b64a8869…`).
- Signed-out peek: `{householdName: "Acceptance House", memberFirstName: "Tom", statusLabel: "Ready to share", open: true}`.
- Tom accepts; accepting again returns the identical result. Tom's badge is `login` on both sides; one `member_claimed` event; `v_customer_identity` maps the managed profile `76a63e91…` to Tom's account `7a1f12e1…`.
- Ella added, her link revoked, the old token answers **410**; a new link created; declined signed out; Ella stays active with `household` and no open link.
- Transfer to Tom (`paysFirstName: "Tom"`) and back (`"Dana"`).
- Admin API lists the household. Events: created, member_added, link_created, member_claimed, link_accepted, member_added, link_created, link_revoked, link_created, link_declined, admin_transferred ×2. Links: Tom accepted, Ella revoked, Ella declined. Parameters as seeded. Retired `POST /invite` → 410.
- UI (`backend/tmp/hh1_ui.mjs`, Vite with `VITE_PRELAUNCH_MODE=true`, headless at 390 and 1280): `/join-household?token=…` renders "Ella, join Acceptance House." signed out, with "Sign in or create your account to join" and Decline, no sideways scroll; `/shop` afterwards still lands on the curtain (`/`, no bypass set); `/privacy` shows the Family Household paragraph.

## Deviations from the brief (and why)

- T13 dropped (Dana): no session bypass.
- Identity link `source 'onsite'` / `sourceId 'household_invitation:<id>'` (Dana).
- `customer_identity_unlink` in the `customer_*` fact shape, not `created_at` (integrity contract, above).
- Migration declared `manual:` in `Writer:`, not `backfill:` (lineage lint semantics).
- Extra readers moved: `users.ts:404`, `userSignals.ts:246, :282` (Dana).
- Ownership is checked inside `householdService`'s transaction with the household row locked, not in the route through `householdReads`: the same check, free of races. Routes stay SQL-free.
- The join page signs in through the existing `/sign-in` page with a redirect (OT-106).
- Badge words and button copy are typed in the tab; role names and states come from the lookups (OT-104).
- `pays` in `v_household` is the admin pointer; brief 3 should read the house subscription (OT-103).

## Open tasks added

OT-101 (legacy invitation email), OT-102 (two other direct Resend callers), OT-103 (who pays, brief 3), OT-104 (badge words), OT-105 (410 stubs, shared remove path), OT-106 (inline sign-in), OT-107 (test-DB data collisions).

## Not committed on purpose

`DEVELOPMENT_GUARDRAILS.md` (the G2.19 revision), `backend/src/features/commerce/README.md` and the deleted Genova fonts were already modified in the working tree before this run. They are not this brief's and stay out of its commits.
