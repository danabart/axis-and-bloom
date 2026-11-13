# Axis & Bloom — Open Tasks

Last updated: 2026-08-05 (added Cloudflare Bot Fight Mode note to OT-17/OT-4 after the DNS→Cloudflare migration). All 5 Liam Sommelier tasks are code-complete and deployed. The Company Gift Subscriptions feature (sponsored 3-month coffee perk companies buy for employees) is also code-complete and deployed as of 2026-07-13 — see `backend/src/features/b2b_company_subscriptions/CLAUDE_CODE_PROMPT_B2B_COMPANY_SUBSCRIPTIONS.md` for the full spec and decisions log. These are the remaining items that require manual setup, provider wiring, or future development work.

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
4. Wire Twilio inbound webhook URL to `POST https://[backend-url]/api/webhooks/sms/inbound` — **⚠️ mind Cloudflare Bot Fight Mode: see the note under OT-17 before choosing the `[backend-url]` (custom domain needs a WAF Skip rule; the `*.run.app` URL bypasses Cloudflare)**
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

### OT-6: Shopify ordering → Stripe checkout (test mode)
**Superseded 2026-10-31 by Commerce 1 (WHAT_WE_BUILT #246):** checkout is live in Stripe **test mode** through `/checkout` (Stripe Embedded Checkout); `POST /api/orders` answers 410 `use_checkout`; an order is written only by the Stripe webhook; fulfillment is manual (an email per paid order to `admin_alert_email`) until a roaster adapter exists (OT-58). Live keys: Commerce brief 4. `services/shopify.ts` and the `SHOPIFY_*` secrets stay until brief 4 drops them.

Original note: the order route (`POST /api/orders`) calls `createOrder()` from `backend/src/services/shopify.ts` which is stubbed. Orders cannot actually be placed until the roastery Shopify account is set up.

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

**⚠️ Cloudflare Bot Fight Mode — add a WAF Skip rule before the Twilio inbound webhook goes live (added 2026-08-05).** As of the DNS migration to Cloudflare, the site sits behind Cloudflare with **Bot Fight Mode ON**, which challenges non-browser (bot-like) traffic. The Twilio inbound-SMS webhook (`POST /api/webhooks/sms/inbound`, OT-4 step 4) is exactly that kind of legitimate server-to-server call. Two safe options:
- **If the webhook points at the custom domain** `axisandbloomcoffee.com`: first add a Cloudflare **WAF → Skip** rule for `/api/webhooks/*` (and `/api/cron/*` only if any cron is ever pointed at the custom domain — today they use the `*.run.app` URL and bypass Cloudflare, so they're unaffected), so Bot Fight Mode / the WAF don't challenge and drop those requests.
- **Or point the webhook at the Cloud Run `*.run.app` URL directly** (the same base URL the cron jobs already use, e.g. `https://axis-bloom-backend-oiub7eumya-uc.a.run.app/api/webhooks/sms/inbound`), which bypasses Cloudflare entirely — no challenge, but also no WAF in front of it.

Same consideration applies to any **Shopify order webhook** (OT-6) whenever that's wired up. Full context and the current Cloudflare config: `backend/src/features/cyber_security/CLOUDFLARE_SETUP.md`.

---

### OT-18: Camila's review — Arial → Lato font-metrics cosmetic list (2026-09-01)
Every open page site-wide (previously silently rendering in Arial — see OT-11) now renders in the real Lato weight files. Visual pass at 390px/1280px over `/`, `/find-my-flavor` (entry/question/sealed/confirmation), `/sign-in`, `/privacy`, `/terms`, and (`?preview=true`) `/bloom`, `/flavor-intelligence`, `/how-it-works`. No overflow or clipping caused by the font swap — only cosmetic metric differences, listed here for Camila to judge, not changed:

- **`/find-my-flavor` entry screen** — "Whose palate are we profiling today?" now wraps to 3 lines at 390px (`Whose palate are` / `we` / `profiling today?`), leaving "we" alone on its own line. Same fixed max-width container as before; Lato's slightly wider average character width pushed the break point. Not clipped, just a less even wrap than Arial gave it.
- General note: Lato reads narrower/more compact than Arial at the same tracked letter-spacing values across headers and kickers site-wide — nothing broke, but any tracked headline Camila wants re-tuned for Lato's specific metrics (vs. the generic Arial fallback everything was actually designed against for the last two months) is a legitimate follow-up, not a bug.
- **Unrelated, found during this pass, not fixed here (out of scope for a font migration):** `/bloom`'s dial (`.bd-dial-wrap`, `BloomDial.tsx`) is a fixed 400×400px element inside 40px of padding — inherently wider than a 390px mobile viewport regardless of font. Confirmed via the CSS itself (fixed pixel dimensions, not text-driven) that this is pre-existing and font-independent, not a regression from this task.

---

### OT-24: `sommelier_messages` (SQL) has 9 rows not fully mirrored in Firestore — reconcile before any drop (found 2026-09-27, Customer Blueprint C3)

Customer Blueprint C3 dropped 3 of the 4 dead-table candidates (`user_recommendation_log`, `user_feedback_event`, `chat_message` — all confirmed empty in prod). `sommelier_messages` was **not** dropped: it has 9 real rows in production, all belonging to a single session (`session_id = 2`, one user), dated **2026-06-28** (three months before this pre-Firestore-migration table was superseded), `is_closed = true` — 5 assistant + 4 user turns.

Firestore has a transcript at the same path (`users/{uid}/sommelier_sessions/2/messages`) for the same session, but with only **6 docs**, not 9 — a partial overlap, not a clean duplicate. The SQL rows are therefore not safely redundant as-is: before this table can be dropped, someone needs to reconcile which of the 9 SQL rows are genuinely missing from the Firestore transcript (the likely candidates are the earliest turns, from before the mid-session cutover to Firestore-based storage) and decide whether those need to be preserved some other way. `customerIntegrity.ts` check 7 (informational) will keep reporting this table non-empty until that reconciliation happens. Not fixed here — out of scope for C3, which only drops tables it can prove empty.

### OT-25: Customer Blueprint C3 follow-ups (found 2026-09-27)

Five small items C3's Part F named explicitly rather than leaving implicit:

- **`user_flavor_feedback` drop**: no writer as of C3 (`routes/orders.ts` now calls `customerFacts.record.feedbackDescriptor()`; `v_collaborative_flavor_wheel` repointed to `customer_feedback_descriptor`/`customer_feedback_event`). The table itself still holds historical rows and 3 pre-existing `COUNT(*)` reads (allow-listed under `lint-customer.mjs` Rule 6) — drop it once no view names it any more.
- **`newsletter_subscriber.archetype` rename**: no code change needed (#191 already stopped the resync that used to keep it live-updated); its real semantics are "archetype at signup," documented as such in `WHAT_WE_BUILT_DB.md`. The column rename itself is deferred — Mailchimp sync and reporting views still name it `archetype`.
- **Check 15 removal date**: `customerIntegrity.ts`'s check 15 (`checkNoNewFirestoreWritesToRetiredStores`) is informational and time-boxed — remove the check entirely after **2026-10-27** (`C3_CUTOVER_REMOVE_AFTER`), once 30 days of clean post-cutover data confirms nothing new is writing to a retired Firestore collection.
- **Cupping Blueprint dependency**: `v_coffee_dimension_range`/`v_coffee_descriptor` currently read cupping data directly (merged `cupping_scores` rows, falling back to unmerged) and `v_palate_dominant_dimensions` takes a plain mean over as-cupped midpoints with no weighting. The Cupping Blueprint may change how cupping data rolls up (e.g. per-batch/roast-date specificity) — when it does, these two `v_coffee_*` views are the only place that needs to change; every `v_palate_*` view reads through them, never the cupping tables directly.
- **`order_kind` filtering in reads v2**: `read_version = 'v1'` deliberately does not filter or weight by `order_line_item.order_kind` (manual vs. subscription-renewal vs. gift-redemption vs. liam-followed) — Dana's decision, since v1 defines the baseline read, not a revision. The first v2 read should decide whether/how `order_kind` should change attribution or trait weighting.

### OT-26: Liam L1 follow-ups (found 2026-09-28)

- ~~**The Stage 2 Haiku call could be removed entirely**~~ — **done, Liam L2** (`SOMMELIER_BUILT.md` S101): Stage 2 is now a plain `register.generation`/`register.household` config lookup, no model call. One Anthropic call removed per session start.
- **"Recent dial activity" no longer reaches Liam** (final, not revisited by L2 or L3): previously folded into `openingContext` for EXPLORATION/PROFILE_AMBIGUOUS intents (`getRecentDialActivitySummary()`, deleted at L1); the profile line's target shape has no line for it, and L2 confirmed this is staying that way for the rest of the series. If this signal is wanted back, it should be a structured profile-line addition (a real read via `customerReads.getRecentDialActivity`), not prose folded into `openingContext` again — not planned, no brief currently scoped for it.

### OT-27: `config/sommelier` — 4 pre-existing drift paths, unrelated to Liam L1/L2, found while reading the drift diff for L2's Part F apply (2026-09-28)

Found running `GET /api/admin/sommelier/config-drift` before L2's own 19-path apply — these 4 were already differing between seed and live, predate this brief, and were deliberately excluded from the apply (still differing after it, confirmed by re-running drift). Needs a decision on which side is right, not a mechanical apply:

- **`modelRouting.sonnetKeywords`, `modelRouting.sonnetMinMessageWords`** — live-only: the seed has neither key at all (not even in the current `SommelierConfig` TS type), but the live doc carries a real keyword list (`"compare"`, `"difference"`, `"explain"`, `"why"`, `"confused"`, `"not sure"`, `"don't understand"`, `"what do you mean"`, `"which is better"`, `"how does"`) and `sonnetMinMessageWords: 100`. Either this was a deliberate admin-console addition that never made it back into the seed/type (seed is stale), or it's leftover from an abandoned experiment (live should be cleared). Whoever built the Sonnet-vs-something model-routing keyword logic this powers would know which.
- **`aiControls.features.quiz_recommendation.dailyUsd`, `aiControls.features.coffee_content.dailyUsd`** — seed says `null` (no per-feature cap), live says `0` (fully capped — effectively disabled if anything reads this as a spend ceiling rather than "uncapped"). Worth checking which one actually reflects the intended AI Operations admin-page state before touching either side.

### OT-28: "leaned in / declined" thread classification — first item of the next calibration round (Liam L3, 2026-09-28)

L3's `customer_liam_reply` stores the customer's verbatim reply only — no model judgment is ever stored as a fact (D-series decision, unchanged). `v_palate_threads` exposes `reply`/`status`, but nothing classifies a reply as "leaned in" vs. "declined" yet; that's explicitly a **read**, not a write, per the brief's own guardrail. Not built this brief, not scoped anywhere yet — flagged here as the natural first thing to add once real thread-reply data exists to calibrate against.

### OT-29: `infra/deploy.sh` doesn't match `.github/workflows/deploy.yml` (found 2026-09-28, verifying the L3 backfill deploy)

`deploy.yml` (GitHub Actions, auto-triggered on every push to `main`) is confirmed as the actual production deploy path — it has deployed every commit this whole engagement, `9fb52a3`/`110d885` included (`gh run list`: both `completed success`, ~3m40s each). `infra/deploy.sh` is a separate, manually-run local script nobody had kept in sync; its `--set-secrets` fix this session (commit `110d885`) brings its secret→env mapping to the same 16 entries `deploy.yml` already declares, but two gaps remain: `deploy.sh` has no `--set-env-vars` (`FRONTEND_URL`, `BACKEND_URL`, `GLOBAL_RATE_LIMIT_MAX`, `CLAUDE_GLOBAL_DAILY_USD`, `CLAUDE_ENABLED`, `APP_CHECK_ENFORCED` — it silently relies on Cloud Run carrying these forward from whatever revision happens to be live) and no `--add-cloudsql-instances` flag. Worth deciding whether `deploy.sh` should be brought fully in line with `deploy.yml` (single source of truth) or retired/documented as "CI only, this script is for local emergency use" so the next person doesn't assume it's equivalent.

### OT-30: drop the frozen `claude_daily_spend.cents` column (Liam access & cost, 2026-10-01)

Since 2026-10-01 spend is recorded in `claude_daily_spend.usd_micros` (micro-dollars) and nothing reads or writes `cents` any more (`anthropicGuard.ts` and `GET /api/admin/ai-ops` are the only readers/writers, both moved). `cents` was kept, frozen, with a column comment, so the pre-change history stays inspectable side by side with its backfilled `usd_micros` value (`cents * 10000`). Drop it once nobody needs that comparison: `ALTER TABLE claude_daily_spend DROP COLUMN IF EXISTS cents;` plus deleting the backfill `UPDATE` and `COMMENT` lines next to it in `schema.sql` (the `UPDATE` references the column, so it must go in the same change). No app code change needed.

### OT-31: Liam prompt — cache the intent addendum and goal too (follow-up, Liam access & cost Part C1, 2026-10-01)

Prompt caching shipped with two breakpoints that respect today's assembly order (`claude.ts` `assembleSystemPromptBlocks`): after `LIAM_BASE_PROMPT` (shared by everyone), and after the catalog/story block (frozen per session). Everything after that is uncached on every turn, because the very next part, the profile line, is rebuilt each turn and changes mid-session (thread asked/answered, a new brew fact). The intent addendum and conversation goal are byte-identical for the whole session but sit after the profile line, so they're re-sent uncached on every turn. Moving them up, to just after the catalog (before the profile line), would put them inside breakpoint 2. That's a prompt **reorder**, which the brief ruled out, and it needs a look at whether Liam reads the addendum differently when it comes before the facts about the customer. Also worth weighing in the same pass: a third breakpoint on the conversation history (messages), which today sits after a system prompt that changes every turn and so can't be cached at all without the reorder.

### OT-32: `[quiz-integrity]` check #10 fails on every boot — one test-account subscriber row (found 2026-10-01, Liam access & cost deploy)

`quizIntegrity.ts` check #10 ("No newsletter_subscriber (with a linked quiz_session) disagrees with their latest scored archetype") has logged `failed — 1 mismatch(es)` on every backend boot since at least 2026-09-29 (revisions 00709 → 00717). Warn-only, so it never blocked a deploy, but it's noise in every boot log. Exactly 1 of 59 linked subscribers mismatches:

- `newsletter_subscriber` row for **`danabar.mail+dana-try-3@gmail.com`** (Dana's own test account; `user_id 8e009055-82a6-419a-830a-01c3e6ba3490`, Firebase uid `wuzT9S17HLPhjLanKFJzmOdQ7UK2`, no user_type): `archetype = 'Balanced'`, `campaign = 'hoboken-crawl-2026'`, `created_at 2026-08-26 20:49:24Z`, `campaign_attributed_at 2026-09-01 02:43:52Z`, `quiz_session_key 3e12b16f-b2a4-43e9-9549-478c59cc4bda`.
- That user's quiz sessions: `be5506ec…` **Earthy** (2026-08-26 20:48:56Z, 28 s before the subscribe) and `fd469c67…` **Chocolate & Nutty** (2026-09-01 02:44:09Z, the latest). So "Balanced" matches **neither** session; it isn't a retake.
- The row's `quiz_session_key` appears nowhere else (no `quiz_funnel_event`, absent from `newsletter_subscriber_backup_20260925`), and its only `transactional_email_log` row (`quiz_complete_v2`, same second as the subscribe) has `archetype = NULL`, i.e. pre-B2 (2026-09-25) logging. Most likely written by the pre-#191 resync-era path from a different, never-linked guest session. Not confirmed; a hypothesis from the evidence.

Decide one of: (a) correct the row (`archetype = 'Chocolate & Nutty'`, the latest), (b) delete this test subscriber, or (c) revisit check #10 itself: OT-25 documents `newsletter_subscriber.archetype` as "archetype at signup" since #191 stopped the resync, so a real customer who retakes will legitimately trip this check. Either the check should compare against the session *linked at signup*, or it should be retired. Nothing changed here; read-only diagnosis only.

### OT-33: production catalog — nothing is visible to customers, so Liam has nothing to recommend (found 2026-10-01, Liam smoke)

During the Liam access & cost smoke, Liam answered "I don't have any coffees available in the catalog right now." Read-only check against prod: `v_coffee_sellable_slot` has **0 rows at any size**; `v_coffee_visibility_summary`: 32 coffees not placed, 1 placed but not visible (reason at 12 oz: `no_slot_price`); `coffee_sku`: 12 oz 1 active / 28 paused, 2 lb 1 active, 5 lb 26 paused; `coffee_slot_price`: 4 rows at 12 oz, 16 at 5 lb. Liam's pool (`sommelierRag.getCandidatePool`) is "sellable at the anchor size (12 oz)", so it's empty, and so is every Bloom/Flavor Intelligence slot. Catalog data, not code: the admin Coffees list's "Visible to customers" column shows the per-placement fix links (#201). Flagged because the site's "doors open October 1."

### ✅ OT-34: frontend `firestore` export is unused — remove it and re-check bundle size (found 2026-10-04, Firebase 12 upgrade)

`frontend/src/app/lib/firebase.ts` exports `firestore = getFirestore(app, 'axis-bloom-fs')`, but nothing imports it (the only importer of `lib/firebase` is `AuthContext.tsx`, which takes `auth` and `getAppCheckTokenSafe`). The frontend never reads Firestore; the other "Firestore" hits in `frontend/src` are comments about the backend. With firebase 12.19.0 the unused import is NOT tree-shaken (the `getFirestore()` call is kept as a side effect) and costs a lot: main bundle 1,490,320 B (403.22 kB gzip) with it vs **1,156,960 B (310.66 kB gzip) without it** in a throwaway build, which is also smaller than the pre-upgrade bundle on main (1,231,488 B / 335.21 kB gzip). Remove the export and the `firebase/firestore` import, rebuild, re-check size, and re-test sign-in. **Done 2026-10-04** in the same PR (#5), as a follow-up commit: the export and the `firebase/firestore` import are removed from `firebase.ts` (nothing imported it); rebuilt, main bundle now 1,156,960 B (310.66 kB gzip), 74,528 B raw / 24.55 kB gzip smaller than before the upgrade. The `@grpc/grpc-js` override is still needed (the lockfile still carries `@firebase/firestore` as a dependency of `firebase`; audit is clean with the override). Side effect to check at the same time: once nothing in the frontend imports `firebase/firestore`, the `@grpc/grpc-js` override in `frontend/package.json` may still be needed for `npm audit` (it is Firestore's own pin, ~1.9.0, in the lockfile regardless of use).

### ✅ OT-35: Unsubscribe sync — manual steps after the code lands (2026-10-05, `WHAT_WE_BUILT.md` #211)

**Done 2026-10-06.**
1. ✅ `MAILCHIMP_WEBHOOK_KEY` created in Secret Manager, and `MAILCHIMP_WEBHOOK_KEY=MAILCHIMP_WEBHOOK_KEY:latest` added to `--set-secrets` in `.github/workflows/deploy.yml`. Version 1 contained an `&`, which breaks a `?key=` query value, so Dana added version 2 (64 letters and digits) and disabled version 1. Backend redeployed (same image) as revision `axis-bloom-backend-00736-9sr`; the webhook validation GET answers 200 with the v2 key and 403 without one.
2. ✅ Push → deploy (`2693abf`, `7e9c287`). Migration step 1 ran on boot from `schema.sql`.
3. ✅ Token backfill against prod: dry run found 95 rows without a token, `--apply` backfilled 95, "Rows still NULL after this run: 0". Migration step 3 (`SET NOT NULL`) applied; `is_nullable = NO`; verify: 95 rows, 95 with a token, 95 distinct, 0 NULL.
4. ✅ Mailchimp webhook registered by Dana in the Mailchimp UI (`…/api/webhooks/mailchimp?key=<v2>`, Unsubscribes + Cleaned, by a subscriber + by an admin).
5. ✅ `newsletter:reconcile -- --apply`: 0 unsubscribed/cleaned in Mailchimp, 0 flipped, 0 already in sync, 0 not in DB, 0 mismatch_outward.
6. ✅ `newsletter:unsubscribe -- nrmisyak@gmail.com`: DB `subscribed=true` → `false` (`unsubscribed_at 2026-10-06T16:16:24.510Z`, source `admin`); Mailchimp `subscribed` → `unsubscribed`.
7. No Cloudflare WAF skip rule needed: the webhook targets the `*.run.app` URL, not the Cloudflare-fronted site, same reasoning as the SMS webhook.

Still open, not part of this task: (a) optional weekly Cloud Scheduler job → `GET /api/cron/newsletter-reconcile` with the `x-cron-secret` header (applies by default; `?dryRun=1` reports only); (b) spot-check with a real quiz email: the body link opens the confirm page on the www host, and Gmail shows its own "Unsubscribe" next to the sender.

### OT-36: stale `dist/` test copies fail under `npm test` — 3 files besides the known quizScoring baseline (found 2026-10-06, roastery portal part 5)

Found running the full suite for part 5. Vitest's default include also picks up the compiled `backend/dist/**/*.test.js` (44 files, build output from 2026-10-04; `dist/` is gitignored, 0 tracked files), so every `src` test runs twice. Checked one file at a time (no file parallelism, memory was short): **all 47 `src` test files pass except `quizScoring.test.ts`** (the known OT-19 baseline; its `dist` copy fails identically). The only other failures are in the stale `dist` copies and have nothing to do with any brief:
- `dist/services/liamProfile.test.js` and `dist/services/palateReads.test.js`: suite-level `ENOENT ... dist/fixtures/palate/timelines.json` (the build never copied the fixture; the `src` copies pass).
- `dist/scripts/lintCatalog.test.js`: "rule 6 flags a planted reference to a deprecated stock column" resolves instead of rejecting (a stale compiled lint/test pair; the `src` copy passes).
- Verdict: not caused by part 5. A clean `origin/main` worktree has no `dist/` at all, so these files do not exist there. Likely fix: add `exclude: ['dist/**']` to `backend/vitest.config.ts` (halves the suite time, ~16 min to ~8). Not done here, out of scope.
- Also seen: an earlier run hit the machine's memory limit and was stopped by Claude Code; unrelated to the tests.

### OT-37: Liam brand answers — two admin edits for Dana (2026-10-24, `WHAT_WE_BUILT.md` #235)

1. ✅ **Done 2026-10-24 on Dana's go** (applied by the Liam sees everything session, audited uid `claude-session`, before that brief's prerequisites). **`maxTurns` 8 → 16.** An existing live key, so the seed does not change it. Configuration → Config Source of Truth: tick only these eight rows (seed 16, live 8) and Apply: `sessionLimits.maxTurns`, `intents.PROFILE_AMBIGUOUS.maxTurns`, `intents.MATCHED.maxTurns`, `intents.RECOMMENDATION_MISS.maxTurns`, `intents.TASTE_EVOLUTION.maxTurns`, `intents.DISCOVERY_SEEKER.maxTurns`, `intents.CONVERSION.maxTurns`, `intents.EXPLORATION.maxTurns`; leave the four OT-27 rows unticked (the panel ticks every row by default). Until then the cutoff runs at 8: the notice from 3 replies left, the closing nudge on reply 7, the last nudge on reply 8.
2. **`what_you_get` says "12 oz"**, which `sommelierIntegrity` check 3 reports (a size in an answer drifts from the catalog). Seeded verbatim as Dana's copy; the Liam answers card will refuse the same text on save. Suggested edit: "Coffee comes whole bean in Axis & Bloom bags, roasted to order. The size and price of each coffee are in your catalog." Until then `[sommelier-integrity] check #3` shows on every boot and on System Health.

### ✅ OT-38: Liam invents a "last order" on the opening turn for a customer with none (found 2026-10-24, Liam brand answers smoke)

**Resolved by `WHAT_WE_BUILT.md` #237 (Liam sees everything):** the ABOUT THIS CUSTOMER block now states "no quiz on file" and carries the real "With Liam before" history, so a brand-new account opens "No quiz on file yet, so I don't have a flavor match for you…" and a returning one opens from its actual earlier picks (both seen live on rev 00782). Original note below.

A brand-new account (0 rows in `"order"`, no quiz) got "Last order was the Coado — chocolate and almond, a little cherry underneath." as Liam's opening. The session context carried no order (`openingContext` was only the register sentence). Likely cause: `LIAM_BASE_PROMPT`'s Opening turn section ("State where they are now (archetype or last order)", template "[What you know about them]…") with nothing known. Not fixed: the brand-answers brief allowed one base-prompt line only. Suggested fix: an opening rule for a customer with no quiz and no order (say what Liam does and ask one direction question, never assert a history), plus an eval case.

### OT-39: the Profile page shows an order status nothing writes (found 2026-10-24, Liam sees everything Task 0)

`GET /api/users/profile` returns each order's `fulfillment_status ?? 'pending'` (`backend/src/routes/users.ts:202`) and the subscription's `next_delivery_date` (`users.ts:385`). `fulfillment_status` is INSERTed `'pending'` at checkout and never updated, and `next_delivery_date` is never written, so the site shows every order as pending forever and no delivery date. Liam was kept from saying either (#237); the profile page still does. Decide whether to hide them until a writer exists.

### OT-40: Liam declines to recommend at all without a quiz (found 2026-10-24, Liam sees everything eval)

The B1 rule "If there is no quiz on file, say so in one sentence and offer the quiz; do not guess an archetype" now works (#237), but asked "just pick something for me", Liam refused to recommend ("Without the quiz I'd just be guessing"). The rule forbids guessing an *archetype*, not recommending from what the customer says they like. Dana to decide whether to add "you may still recommend from what they tell you" to the rule (config `brandFacts.rules`, admin page).

### OT-41: retire `context_data.topicLog` and `token_events` `usage_log` once their readers move to the turn ledger (Liam sees everything, C3)

`sommelier_turn` (#237) now holds one row per reply with topic, mode, model, tokens and cost. `context_data.topicLog` (read by `engagementMetrics`) and `token_events` rows with `reason = 'usage_log'` (read by `sommelierGuards`) are retire candidates once those two readers read `sommelier_turn` instead. Nothing removed yet.

### OT-42: move `topics[].keywords` from config to tables (Liam answer layer, decided out of scope 2026-10-25)

The gate's keywords are rows (`sommelier_gate_rule`, with history and tests); the topic router's are still `config/sommelier.topics[].keywords`. Dana (2026-10-16): mappings and stop lists belong in tables. Moving them is its own decision and brief; integrity check 9 already compares the two lists.

### OT-43: gate rule editing in admin (Liam answer layer, 2026-10-25)

The "Liam Gate Rules" card is read-only. Until a brief adds editing, rules change through the seed or `npm run gate:rules:apply -- <rules.json> --expect-db axisandbloom` (through `sommelierGateRuleService`, so the rule tests still run and a failing example rolls the file back).

### OT-44: the `order_status` rule becomes a customer resolver once something writes `fulfillment_status` (Liam answer layer, 2026-10-25)

Today it says the `order_status_unavailable` deflection verbatim, because nothing writes `order.fulfillment_status` past checkout's `'pending'` (OT-39). The day a writer exists, `sommelierIntegrity` check 10 reports it (any `order` writer in `lineage.json` besides the checkout INSERT), and the rule gets a customer resolver in its own brief.

### ✅ OT-45: the gate's confirmation labels one compound order question as order status (found 2026-10-25, first nightly replay)

**Resolved by `WHAT_WE_BUILT.md` #239 (2026-10-25):** `gate.confirmPrompt` checks for a multi-part message before any label; the three compound examples (order_status #26, price #49, do_you_roast #50) return `judgment` 15/15 against the real Haiku and went to Sonnet in the live smoke. The two other replay disagreements below are unchanged (both end at Sonnet or are borderline).

`replay_agreement=43/46`. The disagreement that matters: "When will it arrive, and should I rest it before brewing?" (a must_not_match example, expected judgment) came back `order_status_unavailable`; with the gate on, that customer would get the deflection verbatim and lose the resting question. The other two are safe or borderline ("How much is the decaf?" → catalog_category, which is not the price rule's label, so Sonnet; "is it utopian?" → judgment, which it confirmed live at 0.95). Before turning the gate on, Dana's call: watch the replay number for a few nights, raise `gate.confirmThreshold`, or tighten the confirmation prompt's compound sentence (config, no deploy).

### OT-46: half-caf and "caffeine free" asks always fall through to Sonnet (found 2026-10-25, gate smoke)

The decaf rule's `catalog_category` resolver lists the coffees in the category the message names. No catalog coffee carries `half_caf` today, so "Do you have half caf?" is confirmed and then sent to Sonnet (who answered well), and "caffeine free" names no category code or label. Harmless (each costs one Haiku confirmation, ~$0.0006); either drop those keywords from the rule or map them when half-caf coffees exist.

### OT-47: a `liam_eval` AI feature bucket, if eval spend ever needs its own cap (Liam answer evals, 2026-10-25)

Eval replies, gate calls and judge calls go through the spend guard as `liam_chat` (the brief's choice), so a run's cost counts against Liam's daily cap. A separate `AiFeature` (with its own toggle and daily dollars on the AI Operations page) is the fix if that ever matters; the run row already records each run's cost.

### OT-48: the eval judge's output cap cuts some verdicts off (found 2026-10-25, first eval run)

**Done 2026-10-25 (#241):** `evals.judgeMaxTokens` 160; the three graded on rerun.

3 of the first run's 18 failures are `unparseable`: the judge's one-line reason ran past `evals.judgeMaxTokens` (seed 60, the brief's value) and the JSON was cut. A parse failure is a fail by design, so these are harness failures, not Liam's. Raising `evals.judgeMaxTokens` (config, no deploy), or asking for a shorter reason in `evals.judgePrompt`, is Dana's call; not changed.

### OT-49: no-quiz customers get a preference question instead of the quiz offer (found 2026-10-25, first eval run)

**Done 2026-10-25 (#241), by Dana's call:** a concrete question about what they drink counts as well as the quiz offer (judge question and a `brandFacts.rules` line); 5/5 in run 5.

`no_quiz_recommend`: 4 of 5 replies say "No quiz on file" and then ask what the customer likes ("bright and fruity, or chocolatey?"); the judge question asks for the quiz to be offered instead of guessing. The B1 rule says "say so in one sentence and offer the quiz". Related to OT-40 (Liam declines to recommend at all without a quiz). Wording is Dana's.

### OT-50: order-status replies do not say what was ordered and when (found 2026-10-25, first eval run)

**Done 2026-10-26 (#242), except one typo phrasing:** Sonnet's rules say what and when, never a status (and a `Shipping status` line in the customer block gives the sentence); five shipping phrases are global `banned_claim` checks in production; `what_did_i_order` gate rule and three more `order_status` keywords. Run 7: order_status 7/7, what_did_i_order 4/5 ("wat did i get last time": no keyword, Sonnet named one order). Earlier: **Gate half done 2026-10-25 (#241):** `order_status` is resolver `customer_orders` (what and when, then the deflection verbatim). **Still open:** messages without a gate keyword go to Sonnet, which points to a person without naming the order (run 5: "wheres my cofee", "It's been a few days since I ordered. Any news?"), once guessed a status ("You've got the Coado on its way", `must_not_contain`), and what_did_i_order lists coffees without both orders and dates (2 of 5). More keywords (or the customer block rules) are the levers; Dana's call.

`order_status`: 4 of 5 point to a person for shipping status but do not name the order; the gate's verbatim `order_status_unavailable` answer cannot. `customerBlock.rules` says Liam "can see what was ordered and when". Either the case's judge question asks for more than Dana wants, or the deflection (an answer row) and the rule should name the order; Dana's call. `what_did_i_order`: 3 of 5 name the coffees but not the two orders with their dates.

### OT-51: the gate lists decafs as available that the catalog cannot sell yet (found 2026-10-25, first eval run)

**2026-10-26 (#242):** the judge question is reworded to "every coffee the reply names ... whether or not a price is listed"; decaf 5/6 in run 7. Still open: the gate's `catalog_category` reply for "Any decaf options?" said both unpriced decafs are "in stock and ready to brew", and the judge still failed it on price.

"do you have any decaf?" (gate_haiku): "we have two decaf options: Nightcap Decaf and Decaf Mexico Veracruz"; both are "not yet available" in the catalog block (no active priced size). `catalog_category` lists every coffee in the category; it could skip, or say, the unpriced ones (a code change to the resolver). The judge also misread the decaf question once ("not every coffee in the catalog carries the Decaf label"); the question could be reworded to "every coffee the reply names".

### OT-52: Liam names the support contact "Dana" (found 2026-10-24 smoke, confirmed 2026-10-25 eval run)

With `brandFacts.supportContact` = `dana@axisandbloomcoffee.com`, Sonnet writes "Dana can check that for you". If a person's name should not appear, a neutral contact address or a rule ("say 'a person on our team'") is the fix; config, Dana's call.

### OT-53: run the evals on a config change once a dev environment exists (Liam answer evals, 2026-10-25)

Not on deploy and not on config change today: both would spend money unattended on production. The config page shows the last run beside the prompt fields so a run follows an edit by hand. With a dev environment, a config change there could trigger a run before the change reaches production.

### OT-54: "surprise me" gets a question instead of a pick (found 2026-10-25, eval run 5)

**Wider in run 7 (2026-10-26, #242):** 4 of 5 `recommend_me` phrasings asked "same direction, or ready to try something new?" instead of picking (runs 5 and 6: 1 of 5). Run 7 was the first with the strengthened orders rule in the prompt; one run cannot separate that from variance. Watch the nightly runs.

`recommend_me` "Mara here, surprise me." (Sonnet): "You loved the Clean Fruit — same bright, juicy lane or ready to step somewhere new?" The judge wants a pick that is Fruity or a deliberate move from it. Passed in run 1, so it may be variance; watch the nightly runs before changing anything.

### OT-55: price_named grades a copied "How much is the Coado?" against Clean Fruit's price (found 2026-10-26, follow-up 3)

**Done 2026-10-26 (#244):** phrasings carry the coffee their turn resolved (`sommelier_eval_phrasing.coffee_id`). Left: "How much is it?" is graded on Coado (its turn's coffee) while the eval context makes "it" Clean Fruit; retire it or accept it as context-bound. **That too, 2026-10-27 (#245):** copied phrasings keep the assistant message they answered (`turn_context`); "How much is it?" passes (run 11, price_named 8/8).

The nightly copies gated price turns into `price_named` (its `rule_key` is `price`), whose only check is `must_contain_price_of Clean Fruit`. The reply ($32.00, Coado's real price) fails on $29.00. Options: a coffee per phrasing for price checks, a case per coffee, or the copy skipping price turns that name another coffee. No price is wrong (#243).

### OT-56: the gate's two-order sentence comes out oldest first (found 2026-10-26, follow-up 3)

**Done 2026-10-26 (#244):** the order sentences are built in code from `customerBlock.orderLineTemplate`, newest first; Haiku no longer phrases them. Run 9: 8 of 8 newest first.

The `customer_orders` facts list the orders newest first and, since #243, say to keep that order. Haiku reversed 5 of 8 two-order replies in run 8 (1 of 6 in run 7), sometimes with "and before that" on the newer one. The judge does not catch it. Building the order sentence in code from the lines would make it exact. Gate is off in production.

### OT-57: shipping time and cost questions do not mention US only (found 2026-10-26, follow-up 3)

**Done 2026-10-26 (#244), by Dana's call:** time and cost are not decided; a `brandFacts.rules` line and a `shipping_terms` case (US only, no time or cost, point to a person). Run 9: 3/4; "If I order today, when would it get to me?" left out US only, and the judge passed "is shipping free?" without it.

The `shipping` case checks `must_contain_answer shipping` on all five phrasings; four ask about time, cost or free shipping, and Sonnet points to Dana without the US-only line (1/5 in run 8). Either those phrasings get their own check ("points to a person for time and cost") or a brand rule asks for the US-only line with any shipping question; Dana's call.

### OT-58: ShipStation roaster adapter (Commerce 1, 2026-10-31)

Every paid order goes to the manual adapter (`services/fulfillment/manual.ts`: an email to `admin_alert_email`), including orders whose `"order".fulfillment_roaster_id` is set: `fulfillment/index.ts` `adapterFor` has the `// seam: roaster adapters` comment where a roaster's adapter plugs in. Build the ShipStation adapter (a separate thread, per the commerce README) behind the same `FulfillmentAdapter.placeOrder` contract; it records `fulfillment_placed` through `checkoutService.recordOrderEvent`.

**ShipStation adapter: tracking webhooks call `shipmentService.markShipped`** (Commerce 3, 2026-11-01). Since #250 a shipment is recorded only by `markShipped(orderId, { carrier, trackingNumber, roasterId, shippedAt })` (today from `/admin/orders`): the shipment row, the `shipped` event and the customer's tracking email once, idempotent per tracking number. ShipStation's ship-notify webhook maps its carrier code to a `shipping_carrier` row and calls the same function; nothing else writes `roastery_shipment_details`. `delivered` / `returned` (`shipping_status`) have no writer yet.

### OT-64: Commerce 4, live cutover (Commerce 3, 2026-11-01)

Brief 4 of the commerce README: live keys with Dana. Needs at least:
- live secret and publishable keys, a live webhook endpoint with the 10 events (six checkout/charge plus four `invoice.*`) and its signing secret;
- the live payment-method configuration and the setup-mode card update checked once;
- `stripeMode()` reporting `live` in the boot log, and Dashboard links in `/admin/orders` pointing at live;
- `admin_alert_email` and the sender domain checked;
- a decision on the test data already on prod (test-mode orders, subscriptions and events stay as history; nothing is deleted);
- OT-60 (test events reaching prod) closed by the cutover.

The full list is in `CLOSING_REPORT_3.md` → "What Commerce 4 needs".

### OT-59: mixed-roaster order split (Commerce 1, 2026-10-31)

One cart can resolve to SKUs from several roasteries (dial slots fall back across roasters). The order is one row with one `fulfillment_roaster_id` (NULL = manual), and the manual email lists each line's roaster. Before roaster adapters place orders automatically, decide how a multi-roaster order splits into shipments and what the customer sees. Since #250 `roastery_shipment_details` is written (`shipmentService.markShipped`, linked by `order_id`, one shipment per order assumed by `v_order_status`); `order_line_item.shipment_id` stays reserved (D11), so a per-line split needs either a link table or Dana reopening D11.

### OT-77 / OT-78: Shop all follow-ups (Website 4, 2026-11-05)

- **OT-77 Per-coffee photos.** Shop cards show their family photo (`shopAssets.family.*`) until a coffee has its own. Camila supplies one per coffee: upload it under `raw/shop/coffee/<name>.jpg`, then enter `shop/coffee/<name>` as the coffee's photo key (admin Coffees → Edit → Customer card). Since 2026-11-06 the upload is scripted: add a row to `backend/src/features/website_handoff/MEDIA_MAP.json` and run `npx tsx scripts/upload-handoff-media.ts` (dry run, then `--write`, then `--verify`); the same goes for the quiz photos once 7A adds their rows.
- **OT-78 `/flavor-intelligence` chrome.** The "Full profile ↗" target has only the new tokens and chrome; the page itself waits for a design (D1).

### OT-74 / OT-75 / OT-76: homepage follow-ups (Website 3, 2026-11-05)

- **OT-74 The real film.** 09 Film plays `videoAssets.homeLoop` (`raw/video/home-loop.mp4`, the handoff's placeholder loop), falling back to `home-hero.mp4` until it is uploaded. The final film replaces the bucket object; no deploy is needed.
- **OT-75 Home content that left with the redesign.** The pull quote ("The best gift is time"), the photo essay (its "See all photographs" link pointed at `/essays`, which is not a route) and the "months" film strip have no section in the handoff. They need a design if they return.
- **OT-76 The Liam example is typed in.** **Done 2026-11-05 (Website 4 B2):** the answer drops the comparison. The 08 exchange keeps the handoff's example. The family words come from the payload and the coffee is Fruity's gentle-end slot, but the sentences are copy in `Home.tsx`. They could move to a marketing table beside the quotes (with OT-69).

### OT-69 / OT-70 / OT-71 / OT-72: presentation data follow-ups (Website 2, 2026-11-04)

- **OT-69 Admin door for family words and Home quotes.** `coffee_archetype.customer_words` and `marketing_home_quote` are seed-only. Edit them with a `catalogService` verb (words) and a marketing writer (quotes), each declared in `comments.sql`.
- **OT-70 Category coffees without a customer name.** **Done 2026-11-05 (Website 4):** `coffee_category_assignment.customer_name`, written by `catalogService.setCategoryCustomerName`; no raw-name fallback. `GET /api/coffees/other-categories` falls back to the raw `coffees.name` when a category coffee has no home slot (prod: both decaf coffees, 2909 and 2930). The new card payload sends `platformName: null` instead. Brief 4 (Shop all, Other section) needs a name source for them.
- **OT-71 Origin regions unset.** `coffees.origin_region_id` is NULL on all 22 active prod coffees, so no card shows an Origin row. Content entry through the existing coffee edit (admin Coffees page).
- **OT-72 One portal version per card.** The brew tags read the portal's current response (an open draft wins, `getCurrentResponseForCoffee`); milk and leads-in-cup read the latest submitted one (`v_roastery_portal_coffee_hint`). Pick one rule for every customer-facing portal answer.
- **OT-73 Stale test assumption.** `schema.catalog_blueprint.test.ts` ("suggested_slot_id is populated for every pre-existing row that had a suggestion") counts `dial_position_signal` rows with `raw_value` and no `suggested_slot_id`; since coffee presentation brief 3 a cupping signal may legitimately carry a value and no suggestion ("no band" notes; test DB row 29, coffee 2916, 2026-10-25). The test needs the no-band case excluded. Test hygiene, not a gate (G1.12).

### OT-66 / OT-67 / OT-68: website chrome follow-ups (Website 1, 2026-11-04)

- **OT-66 FAQ page.** The handoff footer has an FAQ link; there is no `/faq` route or copy, so the link is omitted (no dead anchor). Needs a design and copy, then one line in `Footer.tsx`.
- **OT-67 Per-page palette swaps.** Website 1 changed the chrome and `theme.css` only. Pages still carry the old terracotta/beige as inline literals; each page brief (3–8) swaps its own. Pages outside the handoff (Profile, Liam, About, How it works, admin) need their own pass.
- **OT-68 Frontend tests in CI.** `frontend/` now has vitest + testing-library (`npm test`); `deploy.yml` builds the frontend but does not run them. Add a step before the build.

### OT-65: commerce cosmetic pass (Commerce 3 Part E, 2026-11-04)

Seen by Dana on prod during Commerce 3 Part E; deliberately left out of that brief:
- Profile → Past Orders order card: the total shows without "$", and the order number is the full UUID.
- `/admin/orders`: the customer name shows "—" when the profile has no first name (fall back to the email or last name).

Also from Part E, recorded only: the payment-trouble email's "Update your card" link once landed on the home page (11-03); not reproduced (`/profile` is open under the pre-launch gate). See `CLOSING_REPORT_3.md` → "Noticed during Part E".

### OT-60: test-mode Stripe events to the prod endpoint (Commerce 1, 2026-10-31)

The sandbox's one webhook endpoint (`we_1UWaPO0QYxZQN6jDi2Y9lp6q`) points at prod Cloud Run, so every test-mode event, including the local Part E acceptance runs against `axisandbloom_test`, is also delivered there. Before the Commerce 1 deploy prod answers 404 (Stripe retries for up to 3 days and emails about failures); after it, prod records an unknown session's event and answers 200 (`UnknownCheckoutSessionError`). Consider a second, local-only endpoint or the Stripe CLI for dev runs.

### OT-62: Commerce 3, subscription self-service and admin (Commerce 2, 2026-10-31) — ✅ Resolved 2026-11-01 (#250)

All five items built in Commerce 3 (`WHAT_WE_BUILT.md` #250, `CLOSING_REPORT_3.md`): Profile buttons with the card update through setup-mode Checkout, the update-card link in the payment-trouble email, `/admin/orders` (refunds, mark shipped, shipping email, retry) and `/admin/subscriptions`, the customer's name, email and drawer link on the admin new-order email, and Liam's status line from `customer_label`.

Commerce 2 built the data and the renewal engine only. Commerce 3 (`CLAUDE_CODE_PROMPT_COMMERCE_3_ADMIN_AND_SELF_SERVICE.md`) adds:
- **Profile buttons:** pause, skip, change frequency, update card (Stripe SetupIntent), and cancel. The columns already exist (`paused_until`, `skip_next_until`, `cancel_at`), as do the event kinds, `source = customer`, and the dial-aware `GET /api/subscriptions/mine`.
- **Update-card link in the payment-trouble email.** It says "reply to us" today.
- **`/admin/orders` and an admin subscriptions view** (`v_subscription_status`): refunds, mark shipped, and the shipping email.
- **The customer's email on the admin new-order email.**
- **Liam's status line:** the gate's `customer_subscription` resolver and the customer block print the raw status code (`sub.status`, so "past_due"). Switch both to `subscription_status.customer_label`.

### OT-63: Stripe's one-off invoice retry schedule (Commerce 2, 2026-10-31) — ✅ Resolved 2026-10-31

Dana, from the Dashboard (Billing → Manage failed payments → Card payments): Smart Retries, up to 8 times within 2 weeks; after all retries fail, the invoice is left past-due (not marked uncollectible). Stripe stops retrying by day 14, before our 21-day lapse, which lapses the subscription and voids the invoice. No code change.

Commerce 2 leaves a declined renewal invoice open with `auto_advance`, so Stripe retries it on the account's Automatic collection schedule. Our job lapses the subscription after `subscription_past_due_lapse_days` (21) and voids the invoice. Dana to record the Dashboard's exact schedule, and what happens after the last retry, in `MANUAL_SETUP_IDS.md` (Task 0.5, step 2a). If Stripe gives up before 21 days with "mark uncollectible", `invoice.marked_uncollectible` lapses the subscription earlier, which is also fine.

### OT-61: Liam's order_status could read v_order_status (Commerce 1, 2026-10-31)

`order_status` answers with `order_status_unavailable` because no fulfillment state was ever written. Commerce 1 writes real states as `order_event` rows (`v_order_status.customer_label`). Liam health check 10 now expects `checkoutService` as the checkout writer; wiring the gate's `customer_orders` resolver to say "Paid · being roasted" is a Liam brief, Dana's call.

### OT-19: `quizScoring.test.ts` — 12 pre-existing failures, not touched by Customer Blueprint C1 (found 2026-09-27)

Found running the full `npm test` suite as part of Customer Blueprint C1's Part I verification (`git status`/`git log` confirm `backend/src/services/quizScoring.ts` and its test have no uncommitted diff and were last touched by commit `8edcac0`, already on `main` — this session never opened either file). **Pre-existing on `main` at `6f34238`, not introduced or touched by C1.** Not fixed here — out of scope for this brief.

- **File**: `backend/src/services/quizScoring.test.ts` (and its compiled `dist/services/quizScoring.test.js` copy — same 6 failures counted twice, 12 total across both).
- **Count**: 12 of 497 total tests failed; all 12 are in the `findWinner` veto-cascade / `isSecondaryClose` describe blocks. Every other test in the repo (485), including everything this brief added or touched, is green.
- **Hypothesis**: every failure is an archetype-name mismatch (e.g. expected `Chocolate & Nutty` / `Fruity`, got `Balanced`, or the reverse) in the veto-cascade tie-break logic, not a crash or a type error. The most recent commit touching `quizScoring.ts` before this brief is `5028c7d` ("archetype: rename 'Balanced & Sweet' to 'Balanced' (display name only)") — the tie-break cascade (`findWinner`) or its test fixtures likely still reference the pre-rename archetype identity/ordering in a way the display-name-only rename didn't fully account for. Not confirmed by reading the function — a hypothesis from the failure shape, not a diagnosis.
- **Does not block deploys**: `.github/workflows/deploy.yml`'s backend job runs `npm audit`, `lint:catalog`, `lint:retention`, `lint:customer`, then the Docker build (`tsc`, not vitest) — no `npm test`/vitest step anywhere in the gate. Confirmed before pushing C1.

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
| 2026-10-31 | OT-6: Shopify ordering → Stripe one-time checkout, test mode (Commerce 1, #246) | ✅ Done in test mode (live keys: Commerce brief 4) |
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
| 2026-09-18 | OT-19: `[FlavorQuiz/dial-position-read]: Failed to fetch dial position` on `/find-my-flavor` — 34 client-error reports, 2026-08-17 → 2026-09-18, ongoing. Real, recurring; find why the dial-position read fails (see CLAUDE_CODE_PROMPT_CLIENT_ERRORS_UNFINISHED.md) | ⏳ Pending |
| 2026-09-18 | OT-20: Anonymous sign-in blocked by App Check (HTTP 403, a few 429) — 44 reports across `/`, `/crawl`, `/find-my-flavor`, `/bloom`, `/shop`, etc., 2026-08-26 → 2026-09-10; suspected in-app browsers (Instagram/Facebook webviews) failing App Check attestation. Confirm the UA mix and decide whether guests need a graceful fallback | ⏳ Pending |
| 2026-09-18 | OT-21: `e.find is not a function` ErrorBoundary crash on `/admin/flavor-wheel` — 6 reports, 2026-09-16 ~16:47Z (admin page, likely a response-shape change from the catalog repoint in `49c6671`) | ⏳ Pending |
| 2026-09-18 | OT-22: `ReferenceError: Can't find variable: _AutofillCallbackHandler` — 58 reports (mostly `/ig`, 2026-09-10 → 09-14). Instagram in-app browser noise, not our code; noted only so it isn't re-investigated. Consider filtering in the reporter | ℹ️ Noted |
| 2026-09-18 | OT-23: **App Check enforcement rolled back to monitoring (`APP_CHECK_ENFORCED=false`) for the Hoboken crawl 2026-09-20 / Oct 1 launch window.** Brief: `backend/src/features/hoboken_crawl/CLAUDE_CODE_PROMPT_APPCHECK_INAPP_BROWSER.md`; security findings H2/M10 (C6), C17. **Real finding (Cloud Run logs 2026-09-05 → 09-19, 1,133 401s from 550 IPs, 1,129 of them App Check blocks):** the no-token population is about a third of all traffic reaching the gate (1,129 no-token vs 2,318 verified, 0 invalid tokens) and is mostly *not* in-app browsers — 59% of the 401s hit non-app paths (`/api/.env`, `/api/keys`, ...: scanners), and on real-app routes only 73 of 461 are Instagram/Facebook in-app; the rest are ordinary browser UAs, bots and old/spoofed UAs (only ~9 in-app 401s on `/api/quiz/questions` in 14 days). The blank-quiz report from the Instagram link is real but a small slice. Firebase Auth and Firestore App Check enforcement in the console are both `UNENFORCED` (so Auth is not the blocker). **Tradeoff accepted for the launch window (Dana, 2026-09-18): C17 residual gap reopens** — with no enforcement, a direct-to-`*.run.app` request no longer needs a token, so the CF-Connecting-IP spoofing path (see `WHAT_WE_BUILT_SECURITY.md` entry 1) is reachable again; rate limiters, cron secret, admin DB-role gating and `blockAnonymousAuth` on Liam are unchanged. **Post-crawl fix: per-route enforcement on cost-bearing routes only** (Liam/Claude endpoints, token/order/write routes) rather than a global gate; leave public read routes (quiz questions, catalogue, client-errors, campaign landing) in monitoring. Re-enable only after the `[app-check] no token` rate for real (non-scanner) traffic is near zero, including in-app browsers; options to weigh: reCAPTCHA Enterprise, per-route exemption list, fallback attestation. Related: OT-20 (anonymous sign-in App Check reports). | ⏳ Pending (post-crawl) |
| 2026-10-05 | OT-35: Unsubscribe sync manual steps — `MAILCHIMP_WEBHOOK_KEY` secret + deploy.yml, token backfill + migration step 3, Mailchimp webhook registration, reconcile `--apply` once, unsubscribe nrmisyak@gmail.com; optional weekly reconcile job | ✅ Done 2026-10-06 (weekly job optional, not scheduled) |
| 2026-10-06 | OT-36: stale `dist/` test copies (liamProfile, palateReads, lintCatalog) fail under `npm test`, plus the OT-19 quizScoring baseline; suggest excluding `dist/**` in `vitest.config.ts` | Open |
| 2026-10-24 | OT-37: Liam brand answers — Dana sets `maxTurns` 16 (eight drift rows, not the OT-27 ones) and rewrites `what_you_get` without "12 oz" in the Liam answers card | Open |
| 2026-10-24 | OT-38: Liam invents a "last order" on the opening turn for a customer with no orders (opening template) | ✅ Resolved by #237 |
| 2026-10-24 | OT-39: the Profile page shows `fulfillment_status` (always pending) and `next_delivery_date` (never written) | Orders half done 2026-10-31 (Commerce 1: `customer_label` from `v_order_status`, total fixed); `next_delivery_date` open (Commerce brief 2) |
| 2026-10-24 | OT-40: Liam declines to recommend at all without a quiz; rule wording is Dana's call | Open |
| 2026-10-24 | OT-41: retire `topicLog` / `token_events usage_log` once `engagementMetrics` and `sommelierGuards` read `sommelier_turn` | Open |
| 2026-10-31 | OT-58: ShipStation roaster adapter (tracking webhooks call `shipmentService.markShipped`, #250) | Open |
| 2026-10-31 | OT-59: mixed-roaster order split | Open |
| 2026-10-31 | OT-60: test-mode Stripe events also reach the prod endpoint | Open |
| 2026-10-31 | OT-61: Liam order_status could read v_order_status | Open (Dana's call) |
| 2026-10-31 | OT-62: Commerce 3, subscription self-service and admin | ✅ Resolved 2026-11-01 (#250) |
| 2026-10-31 | OT-63: Stripe retry schedule for renewal invoices (Smart Retries, up to 8 within 2 weeks, then left past-due; our 21-day lapse voids it) | ✅ Resolved 2026-10-31 |
| 2026-11-01 | OT-64: Commerce 4, live cutover | Open |
| 2026-11-04 | OT-65: commerce cosmetic pass (Profile order total "$" and short order number; admin name fallback) | Open |
| 2026-11-04 | OT-66: FAQ page wanted (design + copy from Camila/Dana); footer FAQ link omitted until `/faq` exists (Website 1) | Open |
| 2026-11-04 | OT-67: per-page palette swaps (`#9a2918` / `#a33726` / `#f2f1ea` inline literals → `--ab-*` tokens) left to the website page briefs; file list in `website_handoff/CLOSING_REPORT_1.md` (Website 1) | Done 2026-11-06 (Website 9, #261: the five old literals → tokens on the listed pages, the drawer, gift redemption and Flavor Intelligence; neutral greys and family colours stay) |
| 2026-11-04 | OT-68: frontend `npm test` (vitest, added by Website 1) is not run in `deploy.yml` yet | Open |
| 2026-11-04 | OT-69: admin door for family words and Home quotes (Website 2) | Open |
| 2026-11-04 | OT-70: category coffees with no home slot have no customer name (Website 2) | Done 2026-11-05 (Website 4: `coffee_category_assignment.customer_name`, #254) |
| 2026-11-04 | OT-71: origin region unset on every active coffee (Website 2) | Open |
| 2026-11-04 | OT-72: brew tags read the portal draft, milk/leads the submitted version (Website 2) | Open |
| 2026-11-04 | OT-73: catalog_blueprint test counts legitimate no-band cupping signals as missing suggestions | Open |
| 2026-11-05 | OT-74: the real film for Home 09 (bucket object swap) | Open |
| 2026-11-05 | OT-75: Home pull quote / photo essay / months strip need a design to return | Open |
| 2026-11-05 | OT-76: Liam example on Home is copy in code | Done 2026-11-05 (Website 4 Part B2: comparison dropped, #254) |
| 2026-11-05 | OT-77: per-coffee Shop photos (Camila) | Open |
| 2026-11-05 | OT-78: /flavor-intelligence has tokens only until a design | Open |
| 2026-11-05 | OT-79: retire the per-archetype dial layout (`BloomDial.tsx`, `DialArchetypeSection` layout `dial`) once the quiz result (7B) and Profile move to the field (Website 5) | Open |
| 2026-11-05 | OT-80: per-user dimension profile and match % in The Bloom's comfort zone, when palate data exists (Website 5; not built by decision 2026-09-26) | Open |
| 2026-11-05 | OT-81: flower wheel accessibility audit (screen reader pass, Safari / iOS drag) (Website 5) | Open |
| 2026-11-05 | OT-82: `GET /api/coffees/other-categories` still names a category coffee by `coffees.name` as a fallback (read by Flavor Intelligence's `OtherCategoryCard`); The Bloom now reads `/cards` `other` instead (Website 5) | Done 2026-11-05 (Website 6: the reader already applied OT-70 since Website 4; only the route comment was stale and is corrected; pinned by `services/websiteShop.test.ts`) |
| 2026-11-05 | OT-83: comfort-zone pill words and the dial state words live in the component (as `BADGE_CONFIG` does); a lookup if Dana wants them editable (Website 5) | Open |
| 2026-11-05 | OT-84: `coffee_archetype.description` needs a rewrite before Website 7B reads it: Floral and Earthy are NULL, Fruity ("…not just the caffeine") and Balanced ("…never surprising") are off the copy rule (G4.4). The Axis shows the three words instead (Website 6, S1). Website 7B (2026-11-06) shipped the result hero without it, as decided; adding it back is a one-line follow-up once rewritten | Open |
| 2026-11-05 | OT-85: `backend/src/scripts/lintCustomer.test.ts` runs the lint under vitest's 5 s default timeout; the script takes about 6.7 s locally, so the wrapper times out though the lint passes (CI runs the lint directly) (Website 6) | Open |
| 2026-11-06 | OT-86: upload the 9 quiz scene photos (`MEDIA_MAP.json` rows brief 7A: raw/quiz/scene-entry, scene-q1…q6, scene-branch, scene-result) with `scripts/upload-handoff-media.ts` (dry run → go → --write → --verify); until then the quiz shows its current photo (Website 7A) | Open |
| 2026-11-06 | OT-87: the handoff's 7 question photos map by position onto the live quiz's 6 questions + the branch; Camila to confirm or swap per scene (same keys) (Website 7A) | Open |
| 2026-11-06 | OT-88: the quiz result's "Your match" header line (`bloom/matchCopy.ts` `FAMILY_LINES`) is copy in code; a column or the customer words if Dana wants it editable (Website 7B kept it as the brief listed the header unchanged) | Open |
| 2026-11-06 | OT-89: the result hero uses the per-family result photos (`quizResultAssets`); `quizSceneAssets.result` (`raw/quiz/scene-result.jpg`, the handoff's one Chocolate photo) is now only their fallback. Camila to say whether one photo for every family is wanted instead (Website 7B) | Open |
| 2026-11-06 | OT-90: a fresh guest run to the gate on prod (private window) and Dana's look at the result copy; the signed-in `?result=` previews were checked on prod in Dana's browser (Website 7B) | Open |
| 2026-11-06 | OT-91: the cart lives in memory only; a reload or a new tab empties it (`/cart` and the drawer alike). Persisting it (local storage or a server cart) is its own brief (Website 8, out of scope by decision) | Open |
| 2026-11-06 | OT-92: `/cart` lines show the family photo; a per-coffee photo needs the cart item to carry brief 2's `photo_asset_key` (and a position label / award flag for the handoff's "· 2 · Classic · Premium ★" meta), none of which cart items carry today (Website 8) | Open |
| 2026-11-06 | OT-93: the drawer's signed-out link is `/sign-in?redirect=/checkout` (opens on Create profile), while `/cart`'s is `?mode=signin&redirect=/checkout`; Dana to say whether the drawer should match (Website 8 left the drawer as is, D3) | Done 2026-11-06 (Website 9, #261: the drawer uses the `/cart` link) |
| 2026-11-06 | OT-94: `/checkout/return` still says "Your coffee is on its way to being roasted." / "Your first bag is on its way to being roasted." (Commerce 1/2 copy, not a timing promise but close to D14); Dana's look (Website 8 restyled the page only) | Done 2026-11-06 (Website 9, #261: "Your order is placed." / "Your subscription has started with this order.") |
| 2026-11-06 | OT-95: production families with fewer than `archetype_profile_min_coffees` cupped coffees and no bridge hops carry no relationship label (no word on their Bloom tab or Shop section). More cuppings or authored hops fill them in; nothing to code (Website 9, Dana's Q1 rule) | Open |
| 2026-11-06 | OT-96: `order_fulfillment_status.customer_label` still reads "Paid · being roasted" for `placed` / `awaiting_manual` / `needs_attention`, and the order-placed beat (Liam's line on `/checkout/return`) is generated text. D14 review of both is a data/prompt change outside Website 9 | Labels done 2026-11-07 (Website 10, #262: "Paid" / "Paid · sent to the roastery", seed upgrade in `schema.sql`); the generated beat moves to OT-99 |
| 2026-11-06 | OT-97: the compatibility badge and the comfort-zone family level no longer label Experimental or category coffees (not a family of taste, so no relationship); previously they always read "Outside your comfort zone". Dana to say whether those coffees need a word (Website 9) | Open |
| 2026-11-06 | OT-98: Profile still says "You haven't tried your match yet — it's below." and `routes/users.ts` still types each family's colour; the old grey literals (`#7b7f80`, `#45474a`) remain outside the handoff pages (Website 9 kept OT-67 to the five old palette literals) | Open |
| 2026-11-07 | OT-99: two order lines still lean on roasting (D14), copy/prompt for Dana: the paid-order email headline `orderEmails.ts` "…your coffee is on its way to being roasted." (typed, both HTML and text), and the generated order-placed beat (Liam's line) that leads `/checkout/return` when it exists (Website 10 left both: labels only) | Open |
| 2026-11-07 | OT-100: registry entries used only by the retired About / How it works pages, kept (no key removed without Dana's yes): `videoAssets.aboutHero` (`video/about-hero.mp4`), `videoAssets.aboutSecondary` (`video/about-secondary.mp4`), and `frontend/src/design/IMAGES/bags/bag-{balanced,chocolate,experimental,floral,fruity,spicy}.svg` (TasteFinderSection's bags) (Website 10) | Open |
| 2026-11-07 | OT-101: the one 2026-05 household invitation in production (`8aa38c6a…`, now `legacy`) still holds `invited_email`, a third party's address, against D31 ("the only third-party data we hold is a first name"). Kept under G2.10 (Dana, 2026-11-07); blanking it is Dana's call (Family Household 1) | Open |
| 2026-11-07 | OT-102: two email paths still call the Resend SDK directly instead of the shared sender (`transactionalEmail.sendOnce`): `routes/auth.ts` (password reset, line ~135) and `routes/cron.ts` (four sends). Out of scope for Family Household 1 (Dana, 2026-11-07) | Open |
| 2026-11-07 | OT-103: `v_household.pays_user_id` is `household.primary_billing_user_id`, which moves with the admin role (transfer, admin leave). D21 says the card stays with the house subscriber until they cancel: household brief 3 should name who pays from the house subscription, not this pointer (Family Household 1) | Done 2026-11-07 (Family Household 3, #265): `v_household.pays_user_id` reads the active house subscription |
| 2026-11-07 | OT-104: `FamilyTab.tsx` types its button copy and the two account-state badge words ("Has their own sign-in", "Set up by the admin"); role names and link/member states come from the lookups. A lookup for the badge words is Dana's call (G4.2) (Family Household 1) | Done 2026-11-07 (Family Household 2, #264): badge words from `household_account_state` / `household_quiz_state` |
| 2026-11-07 | OT-105: the retired `DELETE /api/household/members/:userId` shares its path with the new `DELETE /members/:memberId`, so a stale 2026-05 tab gets 404 there, not 410 (the other five old paths answer 410). Drop the 410 stubs one release after Family Household 1 | Open |
| 2026-11-07 | OT-106: the join page sends a signed-out visitor to `/sign-in?redirect=/join-household?token=…` (the existing sign-in page) rather than an inline sign-in form; it returns to the join page signed in (Family Household 1) | Accepted as built (Dana, 2026-11-07) |
| 2026-11-07 | OT-107: after `npm run test:db:refresh` on 2026-11-07 (prod clone), 8 backend tests fail on data collisions, none household code: `evidenceViews` (2), `evidenceAdmin` (1), `catalogService` placeCoffee (slot 23 priority 2 taken), `sommelierAnswer` seed (real `sommelier_turn` rows reference the answers), `sommelierEval` C5 (2, prod phrasings present), `sommelierRag` (no free chocolate_nutty slot). Known baseline stays 6 `quizScoring` + OT-73. Fixtures that assume an empty or fixed catalog need their own pass (G1.12) | Open |
| 2026-11-07 | OT-108: `v_household_member` resolves identity, quiz, dial and claim per row as scalar subqueries (each walks `v_customer_identity`): about 70 ms per member on a prod-sized database, so `GET /api/household/mine` is ~0.5 s for a six-member household. Fine at today's scale; a materialized canonical-id lookup or one lateral per row is the fix if households grow (Family Household 2) | Done 2026-11-07 (Family Household 3, #265): `v_household_membership` (lean) + identity, quiz and dial joined once in `v_household_member` |
| 2026-11-07 | OT-109: Liam's dial context (`customerReads.getRecentDialActivity`) now includes turns another member made for the person (`actor_user_id` set) without saying so; a Liam brief decides whether to show or weigh them differently (Family Household 2) | Open |
| 2026-11-07 | OT-110: boot integrity check 12 (catalogIntegrity, "no un-backfilled slot_id") counts a `user_bloom_dial_current_position` row whose `slot_id` is NULL as a migration gap; Family Household 2's Undo onto "no earlier position" leaves exactly that row (seen on the test DB after brief 2's acceptance). Report-only on prod the first time it happens; the check should exclude rows a dial_turn_undone produced, or Undo should keep a position (Family Household 3) | Open |
| 2026-11-07 | OT-111: decision 1 (the box ships what resolves) applies to drinker reasons only (no quiz, left the box). A subscriber's own bag that cannot be named (nothing sellable, a category coffee gone) still stops the whole renewal, as before; whether that should also skip-and-ship is Dana's call (Family Household 3) | Open |
| 2026-11-08 | OT-112: the cart is in memory only (`CartContext`): it empties on a page reload and on the pre-launch gate's bounce, so a built house box (or any cart) is lost before checkout. Persist it (per-browser storage, or server-side for a signed-in buyer) (Family Household 3, Part E) | Open |
| 2026-11-08 | OT-113: the order-confirmation headline (`v_order_status.order_placed_line`) is built from `order.lines[0]` (`orderFinalizer.ts:44`, `primaryCoffeeId`), so it leads with another household member's bag when that line comes first; it should lead with the buyer's own bag (or name the house order) (Family Household 3, Part E) | Open |
| 2026-11-08 | OT-114: the embedded Stripe Checkout (test mode) offers "Bank" (US bank account) beside card; decide the payment methods and pin them on the session or in the Stripe dashboard before the live cutover (OT-64) (Family Household 3, Part E) | Open |
| 2026-11-08 | OT-115: placement pass after Utopian's retirement (cupping evidence brief 8, Part C): balanced_sweet slot 3 "Bright & Balanced" is empty (was Union, 2934); fruity slot 4 "Jammy & Aromatic" lost its home placement (Flying Jewel, 2891; it had no 12 oz price, so it was not on sale). No archetype lost its default. Dana's placement, through the workbench | Open |
| 2026-11-09 | OT-116: cupping evidence brief 9 left two things as designed, to revisit if they bite. (1) A dispute is tied to one cupper row, so re-saving that row (a transcription correction) creates an undisputed successor, and the dispute stays on the superseded row; raise it again on the new row if it still applies. (2) The per-cupper cell of `v_evidence_dimension` and the call of `v_evidence_archetype_call` show the cupper's latest session; when that value is disputed it is excluded from the agreement and the call tally, and the same cupper's older session does not stand in. |
| 2026-11-09 | OT-117: 22 vitest failures at HEAD 7939920 on a freshly refreshed test DB (measured in cupping evidence brief 9, `CLOSING_REPORT_9.md`). Most follow from brief 8's prod data: Utopian inactive, Geometric's third session (s42), Tiger Stripe placed without basis. They are in evidenceViews (6) and evidenceAdmin (3). The rest are in sommelierEval, sommelierRag, sommelierAnswer, catalogService, schema.catalog_blueprint, lintCustomer and quizScoring (6), and qrDoor's cleanup FK. The tests pin facts that the data has since changed; re-pin them or re-scope them. Also: `npm run test:db:refresh` exits 0 when gcloud fails (it now needs `CLOUDSDK_PYTHON` = Python 3.10+). |
| 2026-11-10 | OT-118: the roaster portal stores whole word lists in one note (every Joe response has one note at rank 1 holding "Chocolate, Peanut Butter, Pear, …", with one wheel pick that is often not the first word). The writer keeps the order it gets (`roasteryPortalService.saveDraft`), so nothing is lost; the map reads the order by splitting the text (`v_dial_placement_input`, Dana 2026-11-10). The portal UI should invite one word per note, so each word gets its own rank and wheel pick (Ella map 1) | Open |
| 2026-11-10 | OT-119: the build parser. `roastery_portal_response.blend_components` is free text, so the lean suggestion is the mean of words and body only (Rev 2 section 4 build reading absent, CTO call 6); `dial_base_origin` was not created. Parse components into origin + share rows, then add the build reading to the chocolate seam (Ella map 1) | Open |
| 2026-11-10 | OT-120: subscriptions and shipments resolve what to ship by `coffee_dial_slot` (`subscriptionService` ~line 166, `subscriptionShipment`), and no active coffee has a `coffee_retail_price` row (every price is a slot price). Until a commerce brief moves both to coffee grain, the map's `is_sellable` reads the slot candidate view (`v_dial_coffee_availability`, Dana 2026-11-10 decision 3). Needs its own decision and brief (Ella map README finding 1) | Open |
| 2026-11-10 | OT-121: the test DB is behind prod: it has no `cupping_score_dispute` (brief 9), so Feminista's pooled Body is 6.77 there against 5.85 on prod. Ella map 1 acceptance ran on it as it is (Dana 2026-11-10). Refresh it (`npm run test:db:refresh`, with `CLOUDSDK_PYTHON` set) before brief 2 calibrates on the workbench, and re-measure OT-117 after the refresh (Ella map 1) | Closed 2026-11-10: refreshed before Ella map 2 (dispute 1 present, Feminista Body 5.85); OT-117 re-measured in `CLOSING_REPORT_2.md` |
| 2026-11-10 | OT-122: backend `vitest run` also collects the compiled copies under `backend/dist/*.test.js`, which doubles the suite and races two copies on one test DB (seen in Ella map 1). Exclude `dist/**` in `vitest.config.ts`; until then run `npx vitest run src` (Ella map 2) | Open |
| 2026-11-10 | OT-123: the lane labels from `dial_lane` ("Leans to the wedge on side A") are long for the workbench's lane buttons; the face also has no family-relative lane words. A `dial_lane` label edit (or a per-wedge lane word, "leans fruit") would read better; Dana's words (Ella map 2) | Closed 2026-11-10: `dial_lane.label` is a `{side}` template ("Leans {side}", "Middle") resolved per wedge by `dialReads.vocabulary` (`laneWords`), so the page reads "Leans Fruity" / "Middle" / "Leans Earthy" |
| 2026-11-12 | OT-124: historical quiz rows have no match decision: brief 3's quiz door writes one only for quizzes from the deploy on (97 current v2.2 interpretations, 80 users on prod, 2026-11-12). Decide a backfill through `customerFacts.record.matchDecision.backfill` (owner-only, `occurred_at` = the quiz's `completed_at`) for brief 4 or later (Ella map 3) | Open |
| 2026-11-12 | OT-125: prices for the map coffees: brief 4 moves them to coffee grain. A dated migration copies each active coffee's current 12 oz slot price into `coffee_retail_price` through `catalogService.setCoffeeRetailPrice`, with a STOP before it runs on production; then `/map` cards gain price and add-to-cart (Dana 2026-11-12, Ella map 3 decision 7; see OT-120) | Open |
| 2026-11-12 | OT-126: a decaf coffee can never be a map target or first match today: the map's sellable rule is `v_coffee_sellable_candidate`, which excludes decaf, half-caf and flavored coffees, so a decaf customer meets edge states everywhere and gets no first match on version 1. Resolved by the commerce move to coffee grain (OT-120, OT-125) (Ella map 3) | Open |
| 2026-11-12 | OT-127: coffee_feeling in the first match: a later map brief may read `v_customer_coffee_feeling.move_code` when placing a quiz result (Dana 2026-11-12, capture first); nothing reads it today (Usual Drink 1) | Open |
| 2026-11-12 | OT-128: usual_drink x roaster brew method: `roastery_portal_response_brew` holds the roaster's best method per coffee (vocabulary `lookup_value` roastery_portal_brew_method: v60, drip, espresso, french_press, aeropress, moka, cold_brew, other; coarser `brew_drink_base_method` needs a mapping); a later map brief may filter or order candidates by the customer's drinks (base_method); nothing reads it today. The table's PK is composite `(response_id, brew_method)`, a pre-existing G2.2 case for its own retrofit (Usual Drink 1) | Open |
| 2026-11-12 | OT-129: post-result card, next field: home ZIP (customer-context design); the card renders a field list in sort_order, so it is a row plus its writer (Usual Drink 1) | Open |
| 2026-11-12 | OT-130: cupboard_coffee: link partner brands to `roaster` rows by owner SQL (`brew_cupboard_brand.roaster_id`); add brands from the other + words list on the admin row (Usual Drink 1) | Open |
| 2026-11-12 | OT-131: usual_drink: pod drinkers (`base_method = pod`) are offered ground coffee as the closest fit (Dana 2026-10-24); nothing reads it yet (Usual Drink 1) | Open |
| 2026-11-12 | OT-132: usual_drink: buy_out drinkers, a later field 'what do you order' on the same card (Usual Drink 1) | Open |
| 2026-11-12 | OT-133: the Profile mirror's own chrome words (heading, empty-state sentence, Edit/Remove/Save/Cancel) and Liam's setup-line wording for the five original fields (`SUMMARY_LABELS`) are still typed in code; Usual Drink 1 moved every field, value, label and card word to data but kept these to leave existing screens and Liam's line byte-identical (Usual Drink 1) | Open |
