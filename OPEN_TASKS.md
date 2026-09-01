# Axis & Bloom — Open Tasks

Last updated: 2026-07-13. All 5 Liam Sommelier tasks are code-complete and deployed. The Company Gift Subscriptions feature (sponsored 3-month coffee perk companies buy for employees) is also code-complete and deployed as of 2026-07-13 — see `backend/src/features/b2b_company_subscriptions/CLAUDE_CODE_PROMPT_B2B_COMPANY_SUBSCRIPTIONS.md` for the full spec and decisions log. These are the remaining items that require manual setup, provider wiring, or future development work.

---

## 🔴 Blocking (required before SMS feedback loop can function)

### ✅ OT-1: Create CRON_SECRET in GCP Secret Manager
Done 2026-06-26. Secret created in GCP Secret Manager, wired into Cloud Run via `deploy.yml --set-secrets`. Value stored securely — use it as the `x-cron-secret` header value when creating the Cloud Scheduler job (OT-2).

---

### OT-2: Create Cloud Scheduler job
Once CRON_SECRET is in Cloud Run (after OT-1 + a deploy), create the daily job:

- **URL**: `https://axis-bloom-backend-oiub7eumya-uc.a.run.app/api/cron/liam-sms-send`
- **Method**: GET
- **Schedule**: `0 9 * * *` (daily 9:00 AM UTC)
- **Header**: `x-cron-secret: [the value you set in OT-1]`

Create via GCP Console → Cloud Scheduler → Create job, or via CLI:
```
gcloud scheduler jobs create http liam-sms-send \
  --schedule="0 9 * * *" \
  --uri="https://axis-bloom-backend-oiub7eumya-uc.a.run.app/api/cron/liam-sms-send" \
  --http-method=GET \
  --headers="x-cron-secret=YOUR_SECRET" \
  --time-zone="UTC" \
  --project=axis-and-bloom-prod \
  --location=us-central1
```

---

### OT-3: Add phone number UI to Profile
The SMS opt-in toggle in Profile Settings is disabled if the user has no phone number on file. There is currently no UI to add a phone number. Without this, no user can ever opt in to SMS.

**What to build:**
- A "Phone Number" field in the Settings tab (similar to the existing address form)
- `POST /api/users/phone` backend endpoint — inserts into `user_phone` with `is_primary = true`
- `user_phone` already exists in Cloud SQL with `phone_number`, `is_primary`, `is_verified` columns

---

### OT-4: Wire SMS provider (Twilio or similar)
`backend/src/services/smsProvider.ts` currently logs a warning and returns `{ success: false, error: 'SMS_PROVIDER_NOT_CONFIGURED' }`. No SMS is actually sent until this is replaced.

**When Twilio account is ready:**
1. Add `SMS_PROVIDER_ACCOUNT_SID`, `SMS_PROVIDER_AUTH_TOKEN`, `SMS_FROM_NUMBER` to GCP Secret Manager
2. Add them to `--set-secrets` in `.github/workflows/deploy.yml`
3. Replace the stub in `smsProvider.ts`:
   ```typescript
   import twilio from 'twilio';
   const client = twilio(process.env.SMS_PROVIDER_ACCOUNT_SID, process.env.SMS_PROVIDER_AUTH_TOKEN);
   const msg = await client.messages.create({
     from: process.env.SMS_FROM_NUMBER,
     to: message.to,
     body: message.body
   });
   return { success: true, providerMessageId: msg.sid };
   ```
4. Wire Twilio inbound webhook URL to `POST https://[backend-url]/api/webhooks/sms/inbound`
5. Add Twilio signature validation to the webhook handler (TODO comment is in `cron.ts`)

---

## 🟡 Important (not blocking, but needed for production)

### OT-5: Firestore security rule for `config/*`
Without this, any authenticated user can read `config/sommelier` directly from the client (via Firebase SDK). The backend Admin SDK bypasses rules, so the app works — but it's a security gap.

Add in **Firebase Console → Firestore → Rules**, inside the `match /databases/{database}/documents` block:
```javascript
match /config/{doc} {
  allow read: if request.auth != null && request.auth.token.admin == true;
  allow write: if false;
}
```

---

### Firestore composite indexes — now declared as code

Added 2026-08-04, from HOME Task 9b (S89). `firestore.indexes.json` (repo root) declares every composite index the `axis-bloom-fs` database currently needs — before this, every one had been created ad hoc via `gcloud`/the console link a failing query prints, undeclared anywhere, which is exactly how `RECOMMENDATION_MISS` silently went dead for two months (S88).

**When to run it**: after adding or changing a Firestore query that combines an equality filter with a range filter or an `orderBy` on a different field (the exact shape that needs a composite index) — add the index to `firestore.indexes.json` first, deploy it, *then* ship the query. Deploy command (not wired into CI — run by hand):
```
firebase deploy --only firestore:indexes --project axis-and-bloom-prod
```
`firebase.json`'s `firestore` entry targets the named `axis-bloom-fs` database explicitly (this project has no `(default)` Firestore database in use). No `firestore.rules` file exists yet — see OT-5 above; that's a separate, still-open gap, not something this entry's `indexes`-only deploy target touches.

---

### OT-6: Shopify ordering
The order route (`POST /api/orders`) calls `createOrder()` from `backend/src/services/shopify.ts` which is stubbed. Orders cannot actually be placed until the roastery Shopify account is set up.

**When ready:**
- Set up roastery Shopify account
- Get `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`, `SHOPIFY_ADMIN_TOKEN` values (secrets already exist in Secret Manager with placeholder values)
- Replace stub logic in `shopify.ts`

---

### OT-13: Create Cloud Scheduler jobs for Company Gift crons
Two new cron endpoints exist and are verified working (`GET`, `requireCronSecret`, same pattern as `liam-sms-send`), but neither has a Cloud Scheduler job yet. Redemption itself works fully without these — codes can be created, paid, and redeemed right now — but until these run daily, sponsored subscriptions never auto-lapse, the trial-ending/lapsed nudge emails never fire, and stale codes never flip to `expired` on the admin dashboard.

Reuses the existing `CRON_SECRET` from OT-1 — no new secret needed.

```
gcloud scheduler jobs create http sponsored-subscription-check \
  --schedule="0 9 * * *" \
  --uri="https://axis-bloom-backend-oiub7eumya-uc.a.run.app/api/cron/sponsored-subscription-check" \
  --http-method=GET \
  --headers="x-cron-secret=YOUR_SECRET" \
  --time-zone="UTC" \
  --project=axis-and-bloom-prod \
  --location=us-central1

gcloud scheduler jobs create http expire-company-gift-codes \
  --schedule="0 9 * * *" \
  --uri="https://axis-bloom-backend-oiub7eumya-uc.a.run.app/api/cron/expire-company-gift-codes" \
  --http-method=GET \
  --headers="x-cron-secret=YOUR_SECRET" \
  --time-zone="UTC" \
  --project=axis-and-bloom-prod \
  --location=us-central1
```

---

### OT-14: Company Gift "continue as paid subscriber" emails link to a placeholder
The `SPONSORED_TRIAL_ENDING` / `SPONSORED_LAPSED_NO_PAYMENT` transition emails (sent by the OT-13 cron) link to `/profile` as a stand-in "add a payment method" CTA. There is no live checkout flow to point to yet — Shopify ordering is still stubbed (see OT-6). Deliberate placeholder, not an oversight (see Phase 3 commit message and the task spec's Phase 3 §4). **Swap the link in `buildSponsoredTrialEndingEmail()` / `buildSponsoredLapsedEmail()` (`backend/src/routes/cron.ts`) for the real individual-subscription purchase flow once it exists** — don't build a second parallel checkout for this feature alone.

---

### OT-12: Cupping sessions aren't capturing descriptor intensity
Found 2026-07-13 while shipping the Flavor Intelligence page's descriptor-bar redesign (`CLAUDE_CODE_PROMPT_FLAVOR_INTELLIGENCE_PART4_TYPE_AND_NOTES.md`). `cupping_score_descriptors.intensity` — the field `GET /api/coffees/:id/flavor-wheel`'s `avg_intensity` is computed from — is `NULL` for all 47 existing rows in production. `AdminCupping.tsx` has always had an intensity input per descriptor (`setDescIntensity`); it's just never actually been filled in for any cupping session entered so far. `user_flavor_feedback.intensity` is also empty (0 rows — separate, dormant path, blocked on OT-6).

**Why this matters now**: originally, the Flavor Intelligence page's descriptor bars scaled *length* by `avgIntensity`, so every bar rendered at the same fixed "no data" floor width — see Part 4. **Updated by Part 6 (2026-07-13)**: bar length now comes from `totalMentions` instead (real data, works today — see `CLAUDE_CODE_PROMPT_FLAVOR_INTELLIGENCE_PART6_BAR_EMPHASIS.md`), and `avgIntensity` was demoted to bar *thickness* only. So this gap no longer blocks the primary "which note is dominant" signal — it only means every bar currently renders at the same neutral default thickness (`INTENSITY_DEFAULT_RATIO = 0.6`) instead of varying, a smaller cosmetic gap than before.

**What to do**: going forward, cuppers need to actually fill in the intensity slider/field per descriptor when entering a cupping session in `AdminCupping.tsx` — no code change needed, this is a data-entry habit gap, not a missing feature. Optionally, backfill intensity for the 47 existing rows if the original cupping notes/session records make that possible without re-tasting.

---

### OT-7: Migrate order write path to normalized `"order"` table
`backend/src/routes/orders.ts` still writes to the old `orders` table (`uid TEXT`, `items JSONB`). The normalized `"order"` table in schema.sql has proper FKs (`user_id UUID`, `order_line_item` child rows). 

Until this migration happens:
- `sommelier_sms_feedback.order_id` is always null (FK points to `"order"`, not `orders`)
- `notification_log.order_id` is also always null

This is not blocking anything right now because Shopify is stubbed, but should be done before Shopify goes live.

---

## 🟢 Setup / configuration

### OT-8: Apple Sign-In
Firebase Auth provider configured for Email/Password and Google but not Apple. Required for iOS App Store submissions.

---

### OT-9: Token purchase (Stripe)
`POST /api/tokens/purchase` returns 503 ("Stripe not yet configured"). Stripe account + payment intent flow needed when token purchasing is enabled.

---

## 🎨 Frontend polish

### OT-10: Video placeholders
The hero and cinematic sections use placeholder `<source src>` values. Swap when real brand videos are ready. Files: `Home.tsx` — look for `<source src` near video elements.

### OT-11: Font cleanup — ✅ Resolved 2026-09-01 (Hoboken Crawl Part 2, Task A)
`font-light` (weight 300) appears in ~40 places on unredesigned pages. Turned out to be one layer deeper than described here: the font actually rendering site-wide since 2026-07-05 was Arial, not Genova at all — `cab3716` switched every reference to `'Lato', Arial, ...`, but the referenced `Lato-Regular.ttf` was never committed, so the `@font-face` silently failed and every page fell through to Arial (see `backend/src/features/hoboken_crawl/CLAUDE_CODE_PROMPT_HOBOKEN_CRAWL_PART2_GENOVA_AND_PAGE.md`'s "Why two tasks in one brief" for the full history). Fixed by installing real Lato weight files (Light/Regular/Medium/Bold/Black, SIL OFL) with `font-weight` **ranges** in `fonts.css` (e.g. Light spans 100–300), so `font-light` now resolves to the real Light face instead of silently collapsing to a hairline weight or, before that, Arial's own default. `font-synthesis: none` added too, so no weight/style the browser can't find gets faked.

---

## ☕ Liam Home v3 — manual setup before arrival notes & beats go live

Added 2026-08-02, from HOME Task 6 (S79). Context: the arrival brew note is a **transactional email sent by our own backend via Resend** — it is NOT a Mailchimp email (Mailchimp = the marketing/welcome-journey emails only) and NOT an SMS (SMS = Twilio, still unwired per OT-4). Three channels, three systems: Resend (backend transactional), Mailchimp (marketing), Twilio (SMS, future).

### OT-15: Create Cloud Scheduler job for the arrival-note cron
Same pattern as OT-2 (which is also still open). Nothing calls `/api/cron/brew-card-arrival-send` until this exists — zero arrival notes go out, silently.

- **URL**: `https://axis-bloom-backend-oiub7eumya-uc.a.run.app/api/cron/brew-card-arrival-send`
- **Method**: GET · **Schedule**: `0 9 * * *` (daily 9:00 UTC, same as OT-2) · **Header**: `x-cron-secret` (same existing secret as OT-2)
- CLI: same `gcloud scheduler jobs create http` command as OT-2 with name `brew-card-arrival-send` and this URL.
- Do OT-2 and OT-15 in the same sitting — two jobs, one secret, five minutes total.

### OT-16: Verify real Resend delivery + add send error-checking
Task 6 verified everything up to the actual send (render, selection, scheduling) but could not prove a real email delivery — the dev environment has a placeholder `RESEND_API_KEY`, and the send call isn't error-checked (a Resend failure would still mark `arrival_email_sent_at`; same pre-existing pattern as the lapsed/trial-ending cron emails).

- **After deploy + OT-15**: trigger one real arrival note (backdate a test card's `arrival_email_scheduled_for`, run the cron) and confirm the email lands in a real inbox, renders correctly, and the talk-to-Liam link opens the right bag conversation.
- **Code follow-up** (small, fold into Task 9 or a spare session): check the Resend response before marking `arrival_email_sent_at`; on failure, leave the row schedulable and log it. Apply the same check to the two pre-existing cron sends while there.

### OT-17: SMS beats go-live checklist (when Twilio is set up)
Everything already tracked elsewhere, gathered here so SMS day is one checklist: OT-3 (phone UI) → A2P carrier registration (started August, lead time days–weeks) → OT-4 (wire Twilio in `smsProvider.ts`) → extend the SMS opt-in consent copy to cover outbound beats, not just the feedback question (HOME Task 8 requirement) → flip `config/sommelier.beats.smsEnabled` to `true` (stays `false` until every prior step is done).

---

### OT-18: Camila's review — Arial → Lato font-metrics cosmetic list (2026-09-01)
Every open page site-wide (previously silently rendering in Arial — see OT-11) now renders in the real Lato weight files. Visual pass at 390px/1280px over `/`, `/find-my-flavor` (entry/question/sealed/confirmation), `/sign-in`, `/privacy`, `/terms`, and (`?preview=true`) `/bloom`, `/flavor-intelligence`, `/how-it-works`. No overflow or clipping caused by the font swap — only cosmetic metric differences, listed here for Camila to judge, not changed:

- **`/find-my-flavor` entry screen** — "Whose palate are we profiling today?" now wraps to 3 lines at 390px (`Whose palate are` / `we` / `profiling today?`), leaving "we" alone on its own line. Same fixed max-width container as before; Lato's slightly wider average character width pushed the break point. Not clipped, just a less even wrap than Arial gave it.
- General note: Lato reads narrower/more compact than Arial at the same tracked letter-spacing values across headers and kickers site-wide — nothing broke, but any tracked headline Camila wants re-tuned for Lato's specific metrics (vs. the generic Arial fallback everything was actually designed against for the last two months) is a legitimate follow-up, not a bug.
- **Unrelated, found during this pass, not fixed here (out of scope for a font migration):** `/bloom`'s dial (`.bd-dial-wrap`, `BloomDial.tsx`) is a fixed 400×400px element inside 40px of padding — inherently wider than a 390px mobile viewport regardless of font. Confirmed via the CSS itself (fixed pixel dimensions, not text-driven) that this is pre-existing and font-independent, not a regression from this task.

---

## 📋 Log

| Date | Task | Status |
|---|---|---|
| 2026-06-23 | Sommelier Task 1 — Foundation (SQL tables, token economy, Firestore config) | ✅ Done |
| 2026-06-23 | Sommelier Task 2 — Evaluator + Session API | ✅ Done |
| 2026-06-23 | Sommelier Task 3 — Admin portal (config, intents, flow, Bloom Dial) | ✅ Done |
| 2026-06-23 | Sommelier Task 4 — Frontend chat UI + entry points | ✅ Done |
| 2026-06-23–24 | Schema bug fixes (5 sequential bugs blocking migration from line ~467 onward) | ✅ Done |
| 2026-06-26 | Sommelier Task 5 — SMS feedback loop (liamSmsFeedback, cron, webhook, profile toggle) | ✅ Done |
| 2026-06-26 | OT-1: CRON_SECRET in Secret Manager | ✅ Done |
| — | OT-2: Cloud Scheduler job | ⏳ Pending (needs OT-1) |
| — | OT-3: Phone number UI in Profile | ⏳ Pending |
| — | OT-4: Twilio wiring | ⏳ Pending (needs roastery account) |
| — | OT-5: Firestore security rule for config/* | ⏳ Pending |
| — | OT-6: Shopify ordering | ⏳ Pending (needs roastery account) |
| — | OT-7: Orders table migration (old → normalized) | ⏳ Pending |
| — | OT-8: Apple Sign-In | ⏳ Pending |
| — | OT-9: Token purchase (Stripe) | ⏳ Pending |
| — | OT-10: Video placeholders | ⏳ Pending (needs brand videos) |
| 2026-09-01 | OT-11: Font-light cleanup — real Lato weight files installed, `font-light` now resolves correctly | ✅ Done |
| 2026-07-13 | OT-12: Cupping sessions not capturing descriptor intensity | ⏳ Pending (data-entry habit, not code) |
| 2026-07-12 | Company Gift Subscriptions — spec committed + Phase 1 (schema: `company_gift`, `company_gift_code`) + Phase 2 (admin + redemption backend routes) | ✅ Done |
| 2026-07-13 | Company Gift Subscriptions — Phase 3 (lifecycle stages + cron + emails) + Phase 4/5 (homepage widget + admin dashboard + email template) + full test-matrix verification (incl. concurrent-redemption race, cross-employee visibility audit) | ✅ Done |
| — | OT-13: Cloud Scheduler jobs for Company Gift crons | ⏳ Pending (needs OT-1's secret, already done) |
| — | OT-14: Company Gift emails — swap `/profile` placeholder for real checkout | ⏳ Pending (needs OT-6) |
| 2026-09-01 | OT-18: Camila's review of the Arial → Lato cosmetic list | ⏳ Pending (Camila to review) |
