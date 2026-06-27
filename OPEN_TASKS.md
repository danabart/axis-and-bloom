# Axis & Bloom — Open Tasks

Last updated: 2026-06-26. All 5 Liam Sommelier tasks are code-complete and deployed. These are the remaining items that require manual setup, provider wiring, or future development work.

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

### OT-6: Shopify ordering
The order route (`POST /api/orders`) calls `createOrder()` from `backend/src/services/shopify.ts` which is stubbed. Orders cannot actually be placed until the roastery Shopify account is set up.

**When ready:**
- Set up roastery Shopify account
- Get `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`, `SHOPIFY_ADMIN_TOKEN` values (secrets already exist in Secret Manager with placeholder values)
- Replace stub logic in `shopify.ts`

---

### OT-7: Migrate order write path to normalized `"order"` table
`backend/src/routes/orders.ts` still writes to the old `orders` table (`uid TEXT`, `items JSONB`). The normalized `"order"` table in schema.sql has proper FKs (`user_id UUID`, `order_line_item` child rows). 

Until this migration happens:
- `liam_sms_feedback.order_id` is always null (FK points to `"order"`, not `orders`)
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

### OT-11: Font cleanup
`font-light` (weight 300) appears in ~40 places on unredesigned pages. The Genova font only has weights 100/400/900 — the browser silently falls back to Thin (100). Clean up per-page during redesign passes. Not a visible bug on most screens but technically incorrect.

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
| — | OT-11: Font-light cleanup | ⏳ Pending |
