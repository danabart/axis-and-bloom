# Task: Company Gift Subscriptions — sponsored 3-month coffee perk for employees

## Overview

A company buys a batch of seats as a gift for its employees: each seat is a 3-month Axis & Bloom subscription, fully prepaid by the employer. Employees redeem a code, register, take the quiz, and get coffee — the company is the payer, never the drinker. Target launch: **2026-10-01** (biggest shopping/gifting month in the US).

Internally this is called a **"company gift"** rather than just "company" — each `company_gift` record represents one purchased gift batch (a specific purchase event: N seats, a specific payment), not the business itself. **Revised 2026-07-13:** a separate `company` table does exist (added in Phase 7) as the stable identity for the business — if the same employer buys again later, that's a second `company_gift` row linked back to the *same* `company_id`, so Dana can actually see it's a repeat customer rather than two unrelated-looking rows. `company_gift.company_name`/contact fields remain a per-purchase snapshot, not a live reference to `company` — see the Phase 1 note and Phase 7 for the reasoning and the exact migration.

This is explicitly modeled as a sibling of the existing household feature (`household` / `household_invitation`, see `backend/src/routes/household.ts`), not a variant of it — read that file first, it's the closest existing pattern (token-based single-use redemption, admin/member split, Resend email), but several structural differences mean this needs its own tables rather than reusing `household_id`:

- The payer (a company's HR/finance contact) is never a `user_profile` — no login, no quiz, nothing.
- Household invites are one-at-a-time by email; this needs a seat pool redeemed via bulk-generated codes.
- Household subscriptions are open-ended; a company gift is a fixed-length (default 3 months), fully prepaid grant.
- Household members can see each other; employees redeeming the same company gift must **never** have visibility into each other's flavor profiles, orders, or even the fact that they're both sponsored by the same employer. This is a billing-pool relationship only.

## Decisions log (resolved with Dana — build against these, don't re-litigate)

1. **Redemption codes are unique and single-use, not one shared code per company gift.** A shared code has a race problem: if it leaks, it's first-come-first-served against the seat cap with no way to tell a real employee from an outsider. Generate exactly `seat_count` codes per `company_gift` at creation time; each is redeemable exactly once.
2. **Codes are anonymous — not locked to a specific employee email.** No roster is collected from the company. "Email-locking" (pre-assigning code → specific employee email, checked at redemption) was considered and explicitly rejected for v1: it only pays off if *we* send personalized invite emails, which we don't (see #3), and it would require the company to hand over a roster before launch — more integration and more sensitive data than this needs. Leave the door open for this as a future enterprise option; don't build it now.
3. **Distribution is the company's job, not ours.** Axis & Bloom does not email employees on the company's behalf. The company (HR/whoever) distributes codes themselves via their own channels. We help by giving them a CSV export of the codes and a copy-paste-ready email template (placeholders for company name / code) — see "Admin section" below — but they do their own send and their own mail-merge.
4. **Company gift purchases are admin-created, not self-serve checkout.** No Stripe/payment integration exists anywhere in this codebase yet — the site's real checkout is Shopify-based and isn't even live yet (every checkout attempt currently fails before reaching the `"order"` table, per `WHAT_WE_BUILT.md`). Building self-serve card payment for this is real new infrastructure not justified for an initial motion that's a handful of hand-sold pilot companies, not volume self-signup. Instead: Dana/team negotiates the deal and payment terms with each company directly (due on signing, Net 30, Net 90 — whatever's agreed; that's a per-deal business decision, not something this system enforces). **Revised: the `company_gift` record and its codes can be created as soon as the deal is set up — codes don't have to wait for payment — but the record carries a `payment_confirmed_at` field (NULL until payment clears) and no code can actually be redeemed while that field is NULL.** This lets Dana set up and preview a company gift (generate codes, review the CSV/email template) while an invoice is still outstanding, without any risk of a code being usable before money is actually in hand. See the `payment_confirmed_at` field in Phase 1 and the redemption-gating note in Phase 2. **Reconsidered on 2026-07-13 and reaffirmed as-is** — a self-serve company onboarding page (company fills out its own form, maybe even pays online, no admin involved) was floated again and deliberately deferred, not overlooked: same reasoning as above still holds (no payment infra, early-stage hand-sold motion), and there's no new pressure changing that call. Worth revisiting once there's real repeat/self-signup demand, not before.
5. **Each employee's 3-month clock is rolling, from their own redemption date** — not a fixed company-wide window. `redeemed_at + sponsorship_months` per employee. Fair to late redeemers, simplest to store. The company can still put an outer deadline on the *code batch* itself (`company_gift.code_redeem_by`) without tying every employee's personal 3 months to one shared end date.
6. **The gift is fully decoupled from employment status.** Once the company pays, the gift is given, full stop. Whether the employee later leaves the company is irrelevant — the seat was already paid for and belongs to whoever holds a valid unredeemed code. **Do not build any "revoke on termination" mechanism or any employment-status check anywhere in this flow.**
7. **No auto-renewal.** Each purchase is a discrete one-time gift batch — closer to corporate gifting (a purchase tied to an occasion) than to an ongoing SaaS seat contract, and it sidesteps FTC rules requiring affirmative consent for auto-renewal (which apply in B2B too). When a batch nears its end, an admin can manually reach out to suggest another purchase — no automated re-billing.
8. **At the 3-month mark, the employee is prompted to convert to an individual paid subscription** — not silently auto-cancelled. This reuses the existing `user_lifecycle_stage` / `user_lifecycle_event` system rather than inventing new expiry machinery (see Phase 3).
9. **Admin gets a basic redemption dashboard** — which codes are used and when, aggregate counts — with zero employee identity exposed beyond "code #14 redeemed on this date." This lives entirely in Dana's internal `/admin` section — there is no company-facing view of any kind (consistent with decision #4: admin-created, no self-serve, no company-facing page). If a company contact ever needs their own view, that's a future enterprise addition, not part of this task.
10. **Handoff of the CSV/template to the company is manual, not automated.** Nothing in this system emails `admin_contact_email` automatically. Dana reviews the generated codes/CSV/template in the admin section and sends them to the company's HR contact herself (email, however the deal was arranged). Don't build an auto-send-on-creation email — that would undercut decision #3 (distribution is the company's job) and decision #4 (codes shouldn't be usable, let alone distributed, before payment is confirmed).
11. **Unredeemed seats past `code_redeem_by` are simply forfeited — no refund, no credit.** This matches near-universal industry norm for corporate perk/gift programs (unredeemed value is standardly treated as "breakage," retained by the vendor, not owed back) — a "no refunds for unused reward value" policy is the default across perk platforms, not the exception. The alternative some vendors offer (returning balance or issuing credit toward a future purchase) is a differentiator, not a norm, and would need real credit-tracking machinery not worth building for v1. **No refund/credit logic should be built.** State this plainly as a contract-terms line item with each company (in `payment_notes` or the sales conversation) rather than a system feature. One caveat worth knowing but not acting on at this scale: true cash-value gift cards are subject to state unclaimed-property (escheatment) laws after long dormancy (3–5+ years) — this program's redemption windows are weeks/months, not years, so this is very unlikely to be practically relevant; revisit only if redemption windows or product form ever change dramatically.

## Phase 1 — Schema

Follow existing conventions in `backend/src/db/schema.sql` (UUID PKs via `gen_random_uuid()`, `TIMESTAMPTZ DEFAULT timezone('utc', now())`, `CREATE TABLE IF NOT EXISTS`, idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

**Note on `company` vs. `company_gift` identity (this distinction matters, don't collapse it):** `company_gift.id` identifies one purchase batch, not the business that bought it. Without a separate stable identity, a repeat customer (same employer buying a second batch later) would have no link back to their first purchase — just two rows that happen to share a text `company_name`. `company` below is that stable identity; `company_gift.company_id` links to it. `company_gift.company_name`/`admin_contact_name`/`admin_contact_email` remain on the gift row as a **snapshot** of what was true at purchase time — same reasoning as `"order"`'s shipping-address snapshot elsewhere in this schema (a later edit to the canonical `company` record shouldn't silently rewrite what a past purchase actually said).

**Why `company` is its own table and not a flagged row on `user_profile`:** considered and rejected. `user_profile.firebase_uid` is `TEXT UNIQUE NOT NULL` — every row there corresponds to someone who authenticates via Firebase. A company doesn't log in, take the quiz, or have a household; there's no Firebase identity to put there, so folding it in would mean weakening that constraint for real users just to accommodate an entity that isn't a person. This also matches the decision made earlier in this doc that the payer/HR contact is never a `user_profile`, and this codebase has already explicitly settled on "user," not "customer," as its one schema term for people (see the terminology note in `backend/src/features/customer_life_cycle/1_CLAUDE_CODE_PROMPT_CUSTOMER_STATE.md`) — introducing a generic "customer" concept now to house something that isn't a person would cut against that.

```sql
CREATE TABLE IF NOT EXISTS company (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name          TEXT NOT NULL,
  primary_contact_name  TEXT,
  primary_contact_email TEXT,
  notes                 TEXT,              -- relationship notes spanning all purchases (renewal history, preferences, etc.), separate from any single gift's payment_notes
  created_at            TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS company_gift (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID REFERENCES company(id),   -- stable link across repeat purchases by the same employer; see note above
  company_name         TEXT NOT NULL,   -- snapshot at purchase time, not live-referenced
  seat_count           INTEGER NOT NULL CHECK (seat_count > 0),
  sponsorship_months   INTEGER NOT NULL DEFAULT 3,
  admin_contact_name   TEXT,
  admin_contact_email  TEXT NOT NULL,
  code_redeem_by       DATE,              -- optional outer deadline to redeem a code at all; NULL = no deadline
  payment_notes        TEXT,              -- internal only: terms, invoice #, wire ref, etc. Never surfaced to employees.
  payment_confirmed_at TIMESTAMPTZ,       -- NULL = payment not yet confirmed. Codes exist and can be previewed/exported, but are inert (not redeemable) until this is set. Admin action ("Mark as Paid") sets this to now().
  total_amount_cents   INTEGER,           -- what was actually charged for this batch, for internal revenue reporting only (never surfaced to employees). Nullable — a deal negotiated a bespoke total, not necessarily seat_count × a per-seat rate, so store the agreed total directly rather than assuming linear per-seat pricing.
  created_by_admin_id  UUID REFERENCES user_profile(id),
  created_at           TIMESTAMPTZ DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS company_gift_code (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_gift_id      UUID REFERENCES company_gift(id) ON DELETE CASCADE,
  code                 TEXT UNIQUE NOT NULL,   -- e.g. 8-char human-friendly token, uppercase, no ambiguous chars (0/O, 1/I)
  status               TEXT NOT NULL DEFAULT 'unredeemed',  -- 'unredeemed' | 'redeemed' | 'expired'
  redeemed_by_user_id  UUID REFERENCES user_profile(id),
  redeemed_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_company_gift_code_gift   ON company_gift_code(company_gift_id);
CREATE INDEX IF NOT EXISTS idx_company_gift_code_status ON company_gift_code(company_gift_id, status);

-- Nullable additions to existing tables, same pattern as household_id on subscription/order today
ALTER TABLE subscription  ADD COLUMN IF NOT EXISTS company_gift_id UUID REFERENCES company_gift(id);
ALTER TABLE subscription  ADD COLUMN IF NOT EXISTS sponsored_expires_at TIMESTAMPTZ;  -- NULL for normal (non-sponsored) subscriptions
ALTER TABLE user_profile  ADD COLUMN IF NOT EXISTS company_gift_id UUID REFERENCES company_gift(id);  -- quiet internal marker only, never surfaced to other employees or shown as a persistent badge

-- IMPORTANT: company_gift already exists live (this feature is already implemented — see Phase 7 below).
-- The `CREATE TABLE company_gift` block above is documentation of the target shape; it will NOT retroactively
-- add company_id to the real table, since CREATE TABLE IF NOT EXISTS is a no-op once the table exists.
-- The actual mechanism for adding company_id to the live table is this ALTER, same as any other retrofit column:
ALTER TABLE company_gift ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES company(id);
```

`user_profile.company_gift_id` is intentionally not exposed anywhere in the UI beyond the employee's own one-time redemption confirmation screen — it exists purely to drive the lifecycle nudge in Phase 3. A user can have both a `household_id` and a `company_gift_id` at once (e.g., in a family household and separately redeeming a work perk) — these are independent, not mutually exclusive.

Code generation: use a short, human-typeable format (e.g. `AXBL-XXXXXX`, uppercase alphanumeric minus ambiguous characters), not a 32-byte hex token like `household_invitation` — those codes are only ever clicked from a link, these are typed in by hand, so they need to be short and unambiguous.

## Phase 2 — Backend routes

New file `backend/src/routes/companyGifts.ts` (or split admin vs. redemption into two files if that reads cleaner — match whatever convention `backend/src/index.ts` already expects for router registration, see line ~77 `app.use('/api/household', householdRouter)`).

**Admin-only routes** (`requireAdmin`, see `backend/src/middleware/auth.ts`):

- `POST /api/admin/company-gifts` — create a company gift (`company_name`, `seat_count`, `sponsorship_months` default 3, `admin_contact_name`, `admin_contact_email`, `code_redeem_by` optional, `payment_notes` optional, `total_amount_cents` optional). Immediately generates `seat_count` unique codes in `company_gift_code`. `payment_confirmed_at` starts NULL unless the admin form has a "payment already received" checkbox that sets it immediately — support both (set up now / activate later). Returns the company gift + full code list.
- `GET /api/admin/company-gifts` — list all company gifts with redemption summary (seats total, redeemed count, remaining count) and payment status (pending/confirmed) — the dashboard list view.
- `GET /api/admin/company-gifts/:id` — single company gift detail: full code list with status/redeemed_at, for the dashboard.
- `POST /api/admin/company-gifts/:id/confirm-payment` — sets `payment_confirmed_at = now()`. This is the action that actually activates every code under this gift for redemption. Idempotent (calling it again if already confirmed is a no-op, not an error).
- `GET /api/admin/company-gifts/:id/codes.csv` — CSV export of codes (code, status, redeemed_at) for the admin to hand to the company. Available whether or not payment is confirmed yet, so Dana can review/prep before activating.
- `GET /api/admin/company-gifts/:id/email-template` — returns the copy-paste email template (see Phase 5) with `{{COMPANY_NAME}}` filled in and a `{{CODE}}` placeholder for HR's own mail-merge.

**Public/employee routes:**

- `GET /api/company-gift-redemption/:code` — public, no auth. Look up a code, return `{ valid: boolean, companyName, sponsorshipMonths }` or a distinct error for each failure case: `not found`, `already redeemed`, `payment not yet confirmed` (code exists and is unredeemed, but its parent `company_gift.payment_confirmed_at IS NULL`), and **`redemption window closed`** (`company_gift.code_redeem_by` is set and has passed) — mirrors `GET /api/household/invite/:token` but keyed on a typed code instead of a URL token. Returning the *company name* here is fine (the employee already knows who gave them this gift — the privacy concern is about other employees seeing it, not the recipient themselves).
- `POST /api/company-gift-redemption/:code/redeem` — `requireAuth`. Validates, in order: the code is `unredeemed`; its parent `company_gift.payment_confirmed_at IS NOT NULL` (reject with "payment not yet confirmed" if not — this is the actual enforcement point for decision #4, not just a UI-level check); `company_gift.code_redeem_by` is NULL or still in the future (reject with "redemption window closed" if it's passed — this is the actual enforcement point for the deadline field, which otherwise exists but does nothing); and that the profile doesn't already have a **currently active** sponsored subscription (`subscription.status = 'active' AND company_gift_id IS NOT NULL`) — a *lapsed* sponsored subscription from an earlier gift must **not** block a new redemption (e.g. a different employer's gift, or a renewed batch from the same employer months later; only one *active* sponsored subscription at a time, not a lifetime cap). If all checks pass, in one transaction: mark the code `redeemed` (`redeemed_by_user_id`, `redeemed_at = now()`), set `user_profile.company_gift_id`, and insert a `subscription` row (`user_id`, `company_gift_id`, `status = 'active'`, `sponsored_expires_at = now() + sponsorship_months`, `frequency_days` per whatever the normal default cadence is elsewhere in the codebase — check `subscription` usage in `orders.ts`/`shop.ts` for the existing convention before inventing a new default). Use `SELECT ... FOR UPDATE` on the code row (joined to its parent `company_gift` for the payment/deadline checks) the same way `household/join/:token` does on `household_invitation`, to avoid a race if two redemption attempts hit the same code simultaneously.
- **Rate limiting:** the site-wide limiter in `backend/src/index.ts` (`rateLimit({ windowMs: 15 * 60 * 1000, max: 200 })`) applies to all `/api` routes already, but these two routes are a guessable-secret lookup by design — codes are short and human-typeable (unlike `household_invitation`'s 32-byte hex token), which trades away brute-force resistance for usability. Add a tighter, IP-scoped limiter specifically on `GET/POST /api/company-gift-redemption/*` (e.g. a much lower `max` on a short window) using the same `express-rate-limit` package already in use, rather than relying on the global default.
- A daily cron sweep (can live alongside the Phase 3 lifecycle cron job) flips any `company_gift_code` still `unredeemed` past its parent's `code_redeem_by` to `status = 'expired'` — purely for reporting clarity on the admin dashboard; the redemption endpoint's own deadline check above is what actually prevents late redemption, this sweep just keeps the code list from looking misleadingly "still available."

Reuse the exact profile-lookup helper pattern from `household.ts` (`getProfile(uid)`) rather than re-querying `user_profile`/`user_email` inline.

## Phase 3 — Lifecycle integration (3-month conversion nudge)

Read `backend/src/services/userLifecycle.ts` and `2_CLAUDE_CODE_PROMPT_LIFECYCLE_FEEDBACK_FIX.md` / `1_CLAUDE_CODE_PROMPT_CUSTOMER_STATE.md` in `backend/src/features/customer_life_cycle/` before touching this — there's already a flat, current-facts-re-evaluated classification system here (`user_lifecycle_stage` / `user_lifecycle_state` / `user_lifecycle_event`), don't build a parallel one.

1. Add two new `user_lifecycle_stage` rows (same seeding pattern as the existing 9): `SPONSORED_TRIAL_ENDING` (homepage_enabled = true — within e.g. 14 days of `sponsored_expires_at`, still `status = 'active'`) and `SPONSORED_LAPSED_NO_PAYMENT` (homepage_enabled = true — `sponsored_expires_at` has passed, subscription flipped to `'lapsed'`, no payment method on file).
2. Extend `getUserSignals()` (`backend/src/services/userSignals.ts`) to include the sponsored-subscription fields it doesn't already carry: `sponsoredExpiresAt`, `hasActiveSponsoredSubscription`. An employee whose sponsorship is active and not yet near expiry should still just classify as the existing `SUBSCRIBER` stage — only the ending-soon and lapsed states need the two new stages above.
3. A daily cron job (new route under the existing `backend/src/routes/cron.ts`, same `requireCronSecret` pattern, same Cloud Scheduler approach documented at the top of that file) finds `subscription` rows where `company_gift_id IS NOT NULL AND status = 'active' AND sponsored_expires_at < now()`, flips `status` to `'lapsed'`, and calls `refreshLifecycleState(uid)` for the affected user so they land on `SPONSORED_LAPSED_NO_PAYMENT`. A second check (or the same job) flags anyone within the 14-day warning window for `SPONSORED_TRIAL_ENDING` without changing `subscription.status` yet.
4. Send an email at the `SPONSORED_TRIAL_ENDING` transition and again at `SPONSORED_LAPSED_NO_PAYMENT` — reuse Resend + a template in the same visual style as `buildInviteEmail()` in `household.ts` — inviting them to add a payment method and continue individually. **The actual "add a payment method / continue as a paid subscriber" checkout flow is presumably being built elsewhere as the site's normal individual-subscription purchase path (Shopify-based) — this task should hook into whatever that flow ends up being, not build a second parallel checkout. Flag this dependency explicitly in the PR if that flow isn't ready yet, rather than stubbing something bespoke.**

## Phase 4 — Frontend

**No dedicated redemption page — this doesn't need one.** `JoinHousehold.tsx` earns its own split-screen page because it has a token in the URL and has to show pre-auth context (inviter's name, household name) to someone arriving cold from an email link. Company gift codes are anonymous and typed in by hand, not delivered via a personalized link — there's no pre-auth content to show, so a whole page would be pure overhead. Instead:

**"Redeem a Coupon Code" widget, directly on the homepage** (`frontend/src/app/components/Home.tsx`). A small, simple component — text input + submit button, no new route, no new page:
- Visible on the homepage regardless of lifecycle stage (anyone might have a code, not just new visitors) — a compact, low-key section, not a hero moment.
- If the visitor isn't signed in (`!user` from `AuthContext`, the same inline check `Home.tsx` already uses elsewhere per the lifecycle work — no need for a `RequireAuth`-wrapped route), the field still accepts the code but on submit shows a lightweight "sign in or create an account to redeem this" prompt (reuse the existing sign-in flow with a `redirect=/` — no token to round-trip, the code can just be re-entered after landing back on the homepage, or held in local state through the redirect if that's easy given how `AuthContext` already preserves redirect targets).
- If signed in, submit calls `GET /api/company-gift-redemption/:code` to validate, then `POST /api/company-gift-redemption/:code/redeem` directly — no intermediate confirmation screen needed, this is a one-step "enter code → redeemed" action, not a multi-step invite-acceptance flow like household's.
- Error states, shown inline next to the input, not as a separate page: not found, already redeemed, "payment not yet confirmed" (worded plainly, e.g. "this code isn't active yet — check with your company"), "redemption window closed."
- On success, the homepage should simply re-fetch `GET /api/users/homepage-state` (same call it already makes) so the lifecycle system naturally shows the right next CTA (quiz, if they haven't taken it) — no bespoke redirect logic needed, this is exactly what the existing homepage-state system is for.

**Admin section** — new `frontend/src/app/components/admin/AdminCompanyGifts.tsx`, route `/admin/company-gifts`, added to the `AdminLayout.tsx` nav (`NAV_SECTIONS`, its own section e.g. `{ label: 'Company Gifts', items: [{ to: '/admin/company-gifts', label: 'Company Gifts' }] }`) and to `App.tsx`'s admin `<Route>` block (same pattern as `AdminCoffees`/`AdminDial`). Two views:
- List view: all company gifts, seats redeemed/total, created date, **payment status (Pending / Confirmed, clearly visible per row)**, a "New Company Gift" form (company name, seat count, sponsorship months default 3, contact name/email, optional redeem-by date, optional payment notes, optional "payment already received" checkbox) that on submit shows the generated code list immediately.
- Detail view: full code list with status, a prominent "Mark as Paid" button when `payment_confirmed_at` is still NULL (calls the confirm-payment route — this is the moment codes actually go live), a CSV download button, and a "copy email template" button that fills in the company name and shows the template text (see below) ready to paste. Make the pending-payment state visually obvious (e.g. a banner: "Codes generated but not yet active — confirm payment to activate") so it's never ambiguous whether a batch is safe to hand to a company.

## Phase 5 — Email template copy (decision #3 — CSV + template, no sending)

**Revised copy (2026-07-13) — replace whatever's currently in `buildEmailTemplate()` in `backend/src/routes/companyGiftsAdmin.ts` with this.** The original draft was functional but generic — it skipped the thing that actually makes Axis & Bloom distinct (coffee matched to *your* palate, not a one-size-fits-all gift). This version reuses language already established elsewhere on the site ("find your flavor," "matched to your palate" — see the homepage CTA and archetype/quiz system) so the email reads consistently with the rest of the brand voice rather than like a bolt-on corporate template:

```
Subject: {{COMPANY_NAME}} is treating you to 3 months of coffee, matched to you ☕

Hi team,

This season, {{COMPANY_NAME}} wanted to give something better than a generic gift — so everyone's getting 3 months of Axis & Bloom, on the house.

Here's how it works: take a 2-minute quiz to find your flavor — floral, fruity, chocolate & nutty, whatever fits your palate — and we'll match you with coffee built around it. Nobody on your team has to get the same bag.

Your code: {{CODE}}

Head to axisandbloomcoffee.com, enter your code in the "Have a code?" box on the homepage, take the quiz, and your first bag ships free.

Enjoy — from all of us at Axis & Bloom.
```

This becomes the new default returned by `GET /api/admin/company-gifts/:id/email-template` (with `{{COMPANY_NAME}}` interpolated the same way the current implementation already does, and `{{CODE}}` left literal for HR's own per-employee mail-merge — see Phase 6, don't substitute a real code into this response). This is now the fallback text when no per-gift override exists (Phase 6).

## Phase 6 — Follow-up: admin-editable template (added 2026-07-13, post-initial-build)

The base feature is already implemented (`companyGiftsAdmin.ts`, `companyGiftRedemption.ts`, `AdminCompanyGifts.tsx` all exist) — this is an incremental patch, not a rebuild. Currently the template is a hardcoded string in `buildEmailTemplate()`; Dana wants to be able to tweak wording per company gift from the admin UI without a redeploy.

1. **Schema**: `ALTER TABLE company_gift ADD COLUMN IF NOT EXISTS email_template_override TEXT;` — nullable. `NULL` means "use the default template" (Phase 5's copy); a non-null value is this specific company gift's custom wording.
2. **Backend**: update `GET /api/admin/company-gifts/:id/email-template` to return `email_template_override` if set, else fall back to `buildEmailTemplate(companyName)` as today. Add `PATCH /api/admin/company-gifts/:id/email-template` — body `{ template: string | null }`. Passing a string sets the override (validate it contains the literal substring `{{CODE}}` — reject with a clear error if not, since HR relies on that placeholder for their own mail-merge and a saved template missing it would quietly break every future redemption email); passing `null` clears the override back to default (a "reset to default" action, not a delete-the-record action).
3. **Frontend** (`AdminCompanyGifts.tsx`): replace the read-only `<pre>` block showing the template with an editable `<textarea>`, prefilled from the current effective template (override or default). Add "Save" (calls the new `PATCH`) and "Reset to default" (calls `PATCH` with `template: null`) buttons alongside the existing "Copy to clipboard" button. Show a small inline note distinguishing "using default" vs. "custom for this company" so it's never ambiguous which is active — consistent with how the payment-status banner already makes gift state visually unambiguous.
4. **Test additions**: saving a template without `{{CODE}}` is rejected; saving a valid custom template persists and is returned by the `GET`; resetting clears `email_template_override` back to `NULL` and `GET` reverts to the Phase 5 default text.

## Phase 7 — Follow-up: separate stable `company` identity from `company_gift` batches (added 2026-07-13, post-initial-build)

Dana noticed while inspecting the live DB that `company_gift.id` is the only identifier in play, and it identifies a *purchase batch*, not the business that made it — there's no way to tell that two `company_gift` rows both belong to the same repeat customer beyond eyeballing the `company_name` text, which isn't reliable ("Acme Corp" vs. "Acme Corporation" would look unrelated). This retrofits a real `company` entity without disturbing anything already built.

1. **Schema**: add the new `company` table and the `company_gift.company_id` column exactly as specified in Phase 1 above (both statements were added there rather than duplicated here — the `company` table is a fresh `CREATE TABLE IF NOT EXISTS`, but `company_gift.company_id` **must** go through the explicit `ALTER TABLE company_gift ADD COLUMN IF NOT EXISTS company_id ...` since `company_gift` already exists live). Existing `company_gift` rows will have `company_id = NULL` after this migration — that's expected and fine, don't backfill by fuzzy-matching `company_name` text; if Dana wants historical rows linked, that's a manual one-time cleanup she can do herself in Cloud SQL Studio once she sees which names actually refer to the same business, not something to automate.
2. **Backend — creating a company gift now needs a company-selection step**: extend `POST /api/admin/company-gifts` to accept either an existing `companyId` (reuse that company's canonical name/contact as the snapshot going onto the new `company_gift` row, unless the admin overrides them in the form) or a `companyName`/`primaryContactName`/`primaryContactEmail` set with no `companyId` (creates a brand-new `company` row first, then the `company_gift` linked to it). Add `GET /api/admin/companies?search=` (admin-only) — simple `ILIKE '%...%'` search on `company_name`, returns `{ id, companyName }` matches, for the admin UI's autocomplete. A full `company` CRUD/detail page is not needed for this patch — the search endpoint plus creation-on-the-fly from the gift form is enough.
3. **Frontend** (`AdminCompanyGifts.tsx`, the "New Company Gift" form): replace the plain company-name text field with a searchable combobox — type to search existing companies via the new endpoint, select one to reuse it, or keep typing a name that doesn't match anything to fall through to "create new company" (same UX pattern as a typeahead-with-create-option, nothing exotic). Also worth adding to the list view: group or at least visually indicate when multiple `company_gift` rows share the same `company_id`, so Dana can see repeat-customer history at a glance without a dedicated company detail page.
4. **Test additions**: creating a company gift with a new company name creates exactly one `company` row and links it; creating a second gift with the same `companyId` reuses the existing `company` row rather than creating a duplicate; the search endpoint returns matches case-insensitively; existing pre-migration `company_gift` rows continue to work normally with `company_id = NULL` (nothing about redemption, payment confirmation, or the lifecycle cron depends on `company_id` being set — it's purely for Dana's own relationship tracking, not a functional dependency anywhere else in the flow).

## Test matrix

- Create a company gift with 3 seats, `payment_confirmed_at` left NULL → exactly 3 unique `company_gift_code` rows generated, all `unredeemed`, but redemption attempts on any of them are rejected with "payment not yet confirmed" (verify this is enforced server-side, not just hidden in the UI).
- Call `confirm-payment` → `payment_confirmed_at` set, the same codes now redeem successfully.
- Redeem one code as a brand-new signed-up user via the homepage widget (on an already-payment-confirmed gift) → code flips to `redeemed`, `user_profile.company_gift_id` set, `subscription` row created with correct `sponsored_expires_at` (redeemed_at + sponsorship_months), homepage state refetches and correctly shows the quiz CTA (no dedicated redirect — this is the lifecycle system doing its normal job, not bespoke redemption logic).
- Attempt to redeem the same code twice → second attempt fails with a clear error, no double-subscription created (verify the `FOR UPDATE` row lock actually prevents a race — test with two concurrent requests, not just sequential).
- Two employees who redeemed the same company gift should have zero visibility into each other — verify no API response anywhere leaks `company_gift_id`, other employees' emails, or redemption info to a non-admin user.
- Cron job: seed a sponsored subscription with `sponsored_expires_at` in the past → job flips it to `lapsed` and the user's `user_lifecycle_state` updates to `SPONSORED_LAPSED_NO_PAYMENT`; seed one within the 14-day window → lands on `SPONSORED_TRIAL_ENDING` without flipping `status`.
- Admin dashboard: redemption counts match actual `company_gift_code` rows; CSV export opens cleanly; email template fills in company name correctly.
- Employee who leaves their company mid-sponsorship (simulate by just not touching anything company-status-related — there's nothing to check) continues to have their subscription work exactly as normal until `sponsored_expires_at` — confirms decision #6 isn't accidentally half-implemented via some employment check that doesn't actually exist elsewhere in the codebase.
- Set `code_redeem_by` in the past on a company gift → redemption is rejected with "redemption window closed" even though the code is `unredeemed` and payment is confirmed; the daily sweep flips it to `status = 'expired'`.
- A user whose sponsored subscription already lapsed (`status = 'lapsed'`) can successfully redeem a brand-new code from a different (or the same, renewed) company gift — confirms the "active only" block doesn't over-reach into a lifetime cap.
- Hit `GET /api/company-gift-redemption/:code` well past the tighter rate limit from a single IP → requests get throttled distinctly from the site-wide 200/15min default (i.e. verify the stricter limiter is actually wired to this route, not just relying on the global one).

## Explicitly out of scope for this task (deferred, not forgotten)

- Roster-based email-locking of codes (decision #2) — future enterprise option only.
- Self-serve checkout / Stripe integration (decision #4) — admin-created only for now.
- Auto-renewal or automated re-billing (decision #7) — manual outreach only.
- Any employer-side "revoke seat" or employment-status integration (decision #6) — explicitly not building this, don't add hooks for it "just in case."
