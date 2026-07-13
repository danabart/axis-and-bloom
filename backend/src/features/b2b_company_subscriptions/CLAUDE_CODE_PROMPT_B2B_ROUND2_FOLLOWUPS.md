# Task: Company Gift Subscriptions — Round 2 follow-ups

## Context

The base feature is already built and confirmed working (verified by direct code inspection on 2026-07-13, not just spec review): `backend/src/db/schema.sql` (`company_gift`, `company_gift_code` tables + `subscription`/`user_profile` FKs), `backend/src/routes/companyGiftsAdmin.ts`, `backend/src/routes/companyGiftRedemption.ts` (payment/deadline/active-subscription checks, rate limiting all correctly in place), and `backend/src/routes/cron.ts` / `backend/src/services/userSignals.ts` (the `SPONSORED_TRIAL_ENDING`/`SPONSORED_LAPSED_NO_PAYMENT` lifecycle stages). **Don't rebuild any of that.**

This doc covers three outstanding pieces only. Full background, the original decisions log, and the reasoning behind each of these is in the sibling doc `CLAUDE_CODE_PROMPT_B2B_COMPANY_SUBSCRIPTIONS.md` in this same folder (see its Phases 4–7) — read that if anything below needs more context, but everything needed to implement should be here.

---

## 1. Homepage redemption widget (not built yet)

There's currently no way for an employee to actually redeem a code — `frontend/src/app/components/Home.tsx` has no redemption UI at all. Add a small "Redeem a Coupon Code" widget directly on the homepage — not a dedicated page (there's no personalized-link context to show pre-auth here, unlike `/join-household`, so a whole page would be overhead).

- Simple component: text input + submit button, no new route.
- Visible regardless of lifecycle stage (anyone might have a code, not just new visitors) — compact, low-key, not a hero section.
- If not signed in (`!user` from `AuthContext`): field still accepts input, but submitting shows a "sign in or create an account to redeem this" prompt, reusing the existing sign-in flow.
- If signed in: submit calls `GET /api/company-gift-redemption/:code` to validate, then `POST /api/company-gift-redemption/:code/redeem` directly — one-step action, no intermediate confirmation screen.
- Error states shown inline next to the input (not a separate page): `not found`, `already redeemed`, `payment not yet confirmed` (word it plainly — "this code isn't active yet, check with your company"), `redemption window closed`.
- On success: re-fetch `GET /api/users/homepage-state` (the same call the homepage already makes) so the lifecycle system naturally surfaces the right next step (the quiz CTA, typically) — no bespoke redirect logic needed.

## 2. Revised email copy + admin-editable template

**2a. Replace the current copy.** `buildEmailTemplate()` in `backend/src/routes/companyGiftsAdmin.ts` currently returns generic copy that doesn't reflect the brand. Replace it with:

```
Subject: {{COMPANY_NAME}} is treating you to 3 months of coffee, matched to you ☕

Hi team,

This season, {{COMPANY_NAME}} wanted to give something better than a generic gift — so everyone's getting 3 months of Axis & Bloom, on the house.

Here's how it works: take a 2-minute quiz to find your flavor — floral, fruity, chocolate & nutty, whatever fits your palate — and we'll match you with coffee built around it. Nobody on your team has to get the same bag.

Your code: {{CODE}}

Head to axisandbloomcoffee.com, enter your code in the "Have a code?" box on the homepage, take the quiz, and your first bag ships free.

Enjoy — from all of us at Axis & Bloom.
```

Keep `{{COMPANY_NAME}}` interpolated the same way the current implementation already does it, and leave `{{CODE}}` as a literal placeholder — HR does their own per-employee mail-merge on that, never substitute a real code into the API response.

**2b. Make it admin-editable per company gift.** Currently there's no way to customize wording without a redeploy.

- **Schema**: `ALTER TABLE company_gift ADD COLUMN IF NOT EXISTS email_template_override TEXT;` — nullable. `NULL` = use the default template above; non-null = this specific gift's custom wording.
- **Backend**: update `GET /api/admin/company-gifts/:id/email-template` to return `email_template_override` if set, else fall back to the default `buildEmailTemplate(companyName)`. Add `PATCH /api/admin/company-gifts/:id/email-template` — body `{ template: string | null }`. A string sets the override, but **validate it contains the literal substring `{{CODE}}`** and reject with a clear error if not (a saved template missing this placeholder would quietly break every future redemption email, since that's what HR uses for their mail-merge). `null` clears the override back to default.
- **Frontend** (`AdminCompanyGifts.tsx`): replace the current read-only `<pre>` block showing the template with an editable `<textarea>`, prefilled with the current effective template. Add "Save" (calls the new `PATCH`) and "Reset to default" (calls `PATCH` with `template: null`) buttons next to the existing "Copy to clipboard" button. Show a small inline label distinguishing "using default" vs. "custom for this company."
- **Tests**: saving without `{{CODE}}` is rejected; saving a valid custom template persists and round-trips through `GET`; resetting clears the override and `GET` reverts to default text.

## 3. Stable `company` identity, separate from `company_gift` batches

`company_gift.id` currently identifies a purchase batch only — there's no way to tell that two `company_gift` rows (e.g. the same employer buying a second batch months later) belong to the same business, beyond eyeballing free-text `company_name` (which isn't reliable — "Acme Corp" vs. "Acme Corporation" would look unrelated). Add a real `company` entity.

- **Schema**:
  ```sql
  CREATE TABLE IF NOT EXISTS company (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name          TEXT NOT NULL,
    primary_contact_name  TEXT,
    primary_contact_email TEXT,
    notes                 TEXT,   -- relationship notes spanning all purchases, separate from any single gift's payment_notes
    created_at            TIMESTAMPTZ DEFAULT timezone('utc', now())
  );
  ```
  Then, **since `company_gift` already exists live, this must be an explicit `ALTER`, not folded into a `CREATE TABLE` block** (that would be a no-op against an existing table):
  ```sql
  ALTER TABLE company_gift ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES company(id);
  ```
  `company_gift.company_name`/`admin_contact_name`/`admin_contact_email` stay as-is — they're a **snapshot** of what was true at purchase time (same reasoning as `"order"`'s shipping-address snapshot elsewhere in this schema), not a live reference to `company`. Existing `company_gift` rows will have `company_id = NULL` after this migration — that's expected; don't backfill by fuzzy-matching names, that's a manual cleanup for Dana if she wants it later.

  **Why `company` is its own table, not a flagged row on `user_profile`:** considered and rejected — `user_profile.firebase_uid` is `TEXT UNIQUE NOT NULL`, every row there is someone who authenticates via Firebase, and a company doesn't log in, take the quiz, or have a household. This also matches the earlier decision that the company's HR contact is never a `user_profile`, and this codebase already settled on "user," not "customer," as its one schema term for people (see the terminology note in `backend/src/features/customer_life_cycle/1_CLAUDE_CODE_PROMPT_CUSTOMER_STATE.md`).

- **Backend**: extend `POST /api/admin/company-gifts` to accept either an existing `companyId` (reuse that company's canonical name/contact as the snapshot for the new gift, unless overridden in the form) or a `companyName`/`primaryContactName`/`primaryContactEmail` set with no `companyId` (creates a new `company` row first, then links the gift to it). Add `GET /api/admin/companies?search=` (admin-only) — simple `ILIKE '%...%'` search on `company_name`, returns `{ id, companyName }` matches for the admin UI's autocomplete. No full `company` CRUD/detail page needed — the search endpoint plus create-on-the-fly from the gift form is enough for this patch.
- **Frontend** (`AdminCompanyGifts.tsx`, "New Company Gift" form): replace the plain company-name text field with a searchable combobox — type to search existing companies, select one to reuse it, or keep typing a non-matching name to fall through to "create new company." Also worth a small visual indicator in the list view when multiple `company_gift` rows share a `company_id`, so repeat-customer history is visible at a glance.
- **Tests**: creating a gift with a new company name creates exactly one `company` row and links it; creating a second gift with the same `companyId` reuses the existing row rather than duplicating; the search endpoint matches case-insensitively; pre-migration `company_gift` rows continue working normally with `company_id = NULL` (nothing in redemption, payment confirmation, or the lifecycle cron depends on `company_id` being set — it's for relationship tracking only).
