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
| 2026-09-18 | OT-19: `[FlavorQuiz/dial-position-read]: Failed to fetch dial position` on `/find-my-flavor` — 34 client-error reports, 2026-08-17 → 2026-09-18, ongoing. Real, recurring; find why the dial-position read fails (see CLAUDE_CODE_PROMPT_CLIENT_ERRORS_UNFINISHED.md) | ⏳ Pending |
| 2026-09-18 | OT-20: Anonymous sign-in blocked by App Check (HTTP 403, a few 429) — 44 reports across `/`, `/crawl`, `/find-my-flavor`, `/bloom`, `/shop`, etc., 2026-08-26 → 2026-09-10; suspected in-app browsers (Instagram/Facebook webviews) failing App Check attestation. Confirm the UA mix and decide whether guests need a graceful fallback | ⏳ Pending |
| 2026-09-18 | OT-21: `e.find is not a function` ErrorBoundary crash on `/admin/flavor-wheel` — 6 reports, 2026-09-16 ~16:47Z (admin page, likely a response-shape change from the catalog repoint in `49c6671`) | ⏳ Pending |
| 2026-09-18 | OT-22: `ReferenceError: Can't find variable: _AutofillCallbackHandler` — 58 reports (mostly `/ig`, 2026-09-10 → 09-14). Instagram in-app browser noise, not our code; noted only so it isn't re-investigated. Consider filtering in the reporter | ℹ️ Noted |
| 2026-09-18 | OT-23: **App Check enforcement rolled back to monitoring (`APP_CHECK_ENFORCED=false`) for the Hoboken crawl 2026-09-20 / Oct 1 launch window.** Brief: `backend/src/features/hoboken_crawl/CLAUDE_CODE_PROMPT_APPCHECK_INAPP_BROWSER.md`; security findings H2/M10 (C6), C17. **Real finding (Cloud Run logs 2026-09-05 → 09-19, 1,133 401s from 550 IPs, 1,129 of them App Check blocks):** the no-token population is about a third of all traffic reaching the gate (1,129 no-token vs 2,318 verified, 0 invalid tokens) and is mostly *not* in-app browsers — 59% of the 401s hit non-app paths (`/api/.env`, `/api/keys`, ...: scanners), and on real-app routes only 73 of 461 are Instagram/Facebook in-app; the rest are ordinary browser UAs, bots and old/spoofed UAs (only ~9 in-app 401s on `/api/quiz/questions` in 14 days). The blank-quiz report from the Instagram link is real but a small slice. Firebase Auth and Firestore App Check enforcement in the console are both `UNENFORCED` (so Auth is not the blocker). **Tradeoff accepted for the launch window (Dana, 2026-09-18): C17 residual gap reopens** — with no enforcement, a direct-to-`*.run.app` request no longer needs a token, so the CF-Connecting-IP spoofing path (see `WHAT_WE_BUILT_SECURITY.md` entry 1) is reachable again; rate limiters, cron secret, admin DB-role gating and `blockAnonymousAuth` on Liam are unchanged. **Post-crawl fix: per-route enforcement on cost-bearing routes only** (Liam/Claude endpoints, token/order/write routes) rather than a global gate; leave public read routes (quiz questions, catalogue, client-errors, campaign landing) in monitoring. Re-enable only after the `[app-check] no token` rate for real (non-scanner) traffic is near zero, including in-app browsers; options to weigh: reCAPTCHA Enterprise, per-route exemption list, fallback attestation. Related: OT-20 (anonymous sign-in App Check reports). | ⏳ Pending (post-crawl) |
