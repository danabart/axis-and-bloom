# Claude Code Prompt Pack — Security Hardening (full specs)
*Each prompt is a complete, standalone brief. Paste one at a time into Claude Code. See `SECURITY_FINDINGS.md` for the finding each closes.*

## How to run these (read first)
- **Branch + one prompt at a time.** `git checkout -b security/<short-name>` per prompt (or per small group). Never run several and review at the end.
- **After each:** review `git diff`, run `tsc --noEmit` on the backend, build both apps, run existing tests, then commit. Only then move on.
- **Verify the fix, don't assume it.** Where a prompt gives an acceptance test, actually run it (e.g. reproduce the IDOR before and confirm it's blocked after).
- **Don't auto-deploy.** These touch auth, billing, and CI — deploy deliberately, ideally after a prod spot-check per your house convention.
- **Dependency order:** do C1 → C2 → C3 first (fast, high value), then the two abuse bugs C4 + C5, then the front-door set C6/C7/C8, then hygiene C9–C16. C6/C10/C14 have console prerequisites called out in each.
- **Console tasks that block nothing but should happen today:** set an **Anthropic monthly spend cap** on Liam's API key, and a **GCP billing budget + alert** on `axis-and-bloom-prod`.

---

## C1 — Remove the schema-leaking diagnostic routes
**Goal:** stop leaking the DB schema to anyone.
**Why:** `GET /health/db` returns every table name; `GET /health/session-cols` returns column types — both unauthenticated. Free reconnaissance for an attacker.
**Files:** `backend/src/index.ts`.
**Steps:**
1. Delete the `app.get('/health/db', …)` and `app.get('/health/session-cols', …)` handlers.
2. Leave `app.get('/health', …)` exactly as-is — it must still return `{ status: 'ok' }` with no auth (uptime/Cloud Run checks depend on it and it exposes nothing).
**Acceptance:** `GET /health` → 200 `{status:'ok'}`; `GET /health/db` and `/health/session-cols` → 404.
**Guardrails:** touch no other route; no behavior change to `/api/*`.

---

## C2 — Global aggregate kill-switch for ALL Claude spend + fix model-tier escalation
**Goal:** a hard ceiling on total daily Anthropic calls across every user and endpoint, plus close the user-controllable jump to the expensive model.
**Why:** per-account caps exist, but nothing bounds *aggregate* spend — mass accounts or a runaway loop have no backstop (finding H1). Separately, a user can pin `claude-sonnet-4-6` just by writing ≥20 words or a trigger word (finding M4).
**Files:** `backend/src/services/sommelierGuards.ts`, `backend/src/services/sommelierConfig.ts`, `backend/src/routes/sommelier.ts`, `backend/src/routes/coffees.ts`, `backend/src/services/claude.ts`.
**Steps:**
1. In `sommelierGuards.ts` add exported `checkGlobalDailyCeiling()` counting **all** `token_events` with `reason IN ('sommelier_turn','usage_log')` since `date_trunc('day', NOW())` (no uid filter — mirror the unfiltered count already in `checkAggregateAnomaly()`). Ceiling from `getSommelierConfig()?.guards?.globalDailyTurnCeiling`, fallback `5000`. Return `{ hit, count, ceiling }`.
2. In `sommelierConfig.ts` add `guards.globalDailyTurnCeiling: number` to the config type, same shape/comment style as `guards.dailyTurnCap` (live-tunable via the config doc, no deploy).
3. In `sommelier.ts`, in **both** `POST /start` and `POST /:sessionId/message`, call `checkGlobalDailyCeiling()` right next to `checkDailyCap()`, **before any model call**. On hit, respond exactly like the existing daily cap (reuse `DAILY_CAP_CLOSE_MESSAGE` / session-close shape — no new customer copy) and `console.warn` an operator line naming count + ceiling.
4. In `coffees.ts`, have `generateAndStoreAllContent()` / `generateAndStoreSummary()` check the same global ceiling before calling Claude; when hit, skip generation and return cached-or-null.
5. In `claude.ts`, change the Sonnet-vs-Haiku decision so it does **not** depend on raw user message length/keywords the user controls — gate the expensive model behind a server-derived signal (session intent / topic-router confidence) OR add a per-user daily Sonnet budget. Haiku stays the default.
**Acceptance:** with the ceiling config set to a tiny number in a dev/staging config, the next Liam turn and the next coffee-content request both short-circuit with **no** `messages.create` call (add a temporary log or assert). A 25-word user message no longer forces Sonnet.
**Guardrails:** no new DB table; reuse the `token_events` counting + config-fallback patterns already in the file. `tsc --noEmit` clean.

---

## C3 — Stop public coffee AI endpoints from generating on demand
**Goal:** make the public AI-content reads free of any Claude call.
**Why:** `GET /api/coffees/:id/content` and `/:id/ai-summary` are unauthenticated and call Claude on a cache miss; coffees with permanently-null content re-generate on **every** request — a second unbounded Anthropic-cost surface behind only the loose global limiter (finding M2).
**Files:** `backend/src/routes/coffees.ts`.
**Steps:**
1. Change both public GET routes to **read-only**: return the cached `ai_summary` / content, or `null` / a neutral placeholder when absent. Never call `generateAndStoreAllContent()`/`generateAndStoreSummary()` from a public GET.
2. Leave generation reachable only from the admin refresh endpoints (already `requireAdmin`) and any cron path — do not change those.
**Acceptance:** requesting a coffee id whose `ai_summary` is `NULL` produces **zero** Anthropic calls and returns 200 with a null/empty summary (not a 500, not a generated value).
**Guardrails:** don't alter the admin/cron generation paths or the response shape fields other than allowing null. `tsc` clean.

---

## C4 — Fix the beats dial-in IDOR (unauth cross-user write) — HIGH
**Goal:** make the dial-in response link a real capability, not a guessable id.
**Why:** `GET /api/beats/dial-in/:beatEventId/respond` is unauthenticated and resolves the beat by its **SERIAL** id with no ownership check — an attacker enumerates integers and shifts any customer's next brew-card grind (finding H3). The existing "idempotent" note only prevents double-adjust, not first-time forgery.
**Files:** `backend/src/routes/beats.ts`, `backend/src/services/beatEngine.ts`, `backend/src/routes/cron.ts`, `backend/src/db/schema.sql`.
**Steps:**
1. Add a `response_token` column to `beat_event` in `schema.sql` (unguessable, ≥128-bit, e.g. `encode(gen_random_bytes(32),'hex')` or set from `crypto.randomBytes(32).toString('hex')` in code). Include a migration that **backfills a token for every existing pending dial_in beat**.
2. Where dial_in `beat_event` rows are created (find the insert in `beatEngine.ts` / `cron.ts`), set `response_token`.
3. Where the emailed link is built (the `/api/beats/dial-in/.../respond` URL), append `?t=<response_token>` (keep the existing `expectation` param).
4. In `beats.ts`, resolve the beat by **both** `id` AND `response_token = req.query.t` — if the token is missing or doesn't match, return the existing "that link looks incomplete" page, do nothing. Keep the `responded_at` idempotency.
**Acceptance:** the old attack — `GET /api/beats/dial-in/1/respond?expectation=bolder` with no/ wrong `t` — no longer mutates anything (verify `beat_event` and the brew card are unchanged); the correct token still works exactly once.
**Guardrails:** don't change what a *valid* response does; no auth session added (the token is the capability). `tsc` clean; note the schema migration.

---

## C5 — Order-bonus abuse + client-controlled price — HIGH
**Goal:** stop free token minting and server-trust the price.
**Why:** `POST /api/orders` grants 10 tokens per call against an **unpaid Shopify draft**, no idempotency, no payment check (finding H4); and it records the **client-supplied** `priceCents` as amount paid (finding M3).
**Files:** `backend/src/routes/orders.ts`, `backend/src/services/shopify.ts`, `backend/src/db/schema.sql`.
**Steps:**
1. **Decouple the grant from order creation.** Remove the fire-and-forget order-bonus grant from `POST /` and instead grant it only on **confirmed payment**:
   - Preferred: add a verified Shopify **order-paid webhook** endpoint (validate the `X-Shopify-Hmac-Sha256` signature against the app secret) that grants the bonus keyed to the external order id.
   - Add a **uniqueness guard** so a given external order id can grant `order_bonus` at most once (unique index on `token_events(reason, reference_id)` for `reason='order_bonus'`, or an explicit existence check inside the transaction).
   - If the webhook is too big for this pass, at minimum: gate the grant on a real *paid* order status (not draft creation) and enforce the once-per-order uniqueness guard.
2. **Server-side pricing.** Derive unit price from the resolved `roaster_blend` / slot price tables (check `schema.sql` for the live source, e.g. `dial_slot_price` / `coffee_retail_price`); ignore any client `priceCents` entirely. Write the server-derived price to `subtotal` / `total_amount_paid` / `unit_price_charged`.
**Acceptance:** calling `POST /api/orders` repeatedly no longer increases the caller's token balance; a replayed paid-order webhook grants the bonus only once; an order's recorded total matches the server price table regardless of any `priceCents` in the body.
**Guardrails:** don't break the existing draft-order creation flow for legitimate checkout; keep inventory decrement behavior. `tsc` clean; note migrations.

---

## C6 — Firebase App Check enforced on the backend — HIGH leverage
**Goal:** reject API calls that don't originate from the real web app (covers mass-account AND anonymous-identity abuse).
**Why:** signup and API access are unattested today; App Check is the single structural throttle on scripted abuse (findings H2, M10).
**Files:** `backend/src/middleware/auth.ts`, `backend/src/routes/sommelier.ts`, `backend/src/routes/auth.ts`, `frontend/src/app/lib/firebase.ts`, `frontend/src/app/lib/api.ts`.
**Steps:**
1. Backend: add `requireAppCheck` middleware verifying the `X-Firebase-AppCheck` header via `admin.appCheck().verifyToken()`; on missing/invalid → 401 `{ error: 'app_check_failed' }`. Gate enforcement behind `APP_CHECK_ENFORCED` (env, default `false`) so we deploy code, wire the client, confirm real traffic passes, **then** flip on — never a hard cutover.
2. Apply `requireAppCheck` (chained before `requireAuth`) to all of `sommelier.ts`, `POST /api/auth/sync`, `POST /api/auth/reset-password`, and the guest-write endpoints listed in C16.
3. Frontend: initialize App Check with `ReCaptchaEnterpriseProvider`, `isTokenAutoRefreshEnabled: true`, site key from `VITE_APPCHECK_SITE_KEY`. Ensure requests carry the token (SDK auto once initialized; if `api.ts` sets headers manually, add `X-Firebase-AppCheck` from `getToken()`).
**Acceptance:** with `APP_CHECK_ENFORCED=true`, a curl to a protected route with no App Check header → 401; the real app (with the SDK) → 200.
**Console steps to WRITE OUT for Dana (do not attempt):** register a reCAPTCHA Enterprise key + enable App Check for the web app in the Firebase console; set `VITE_APPCHECK_SITE_KEY`; rebuild frontend; keep `APP_CHECK_ENFORCED=false` until real traffic is confirmed passing, then set `true`.
**Guardrails:** fail-open until the flag is set; don't lock out real users on deploy. `tsc` clean.

---

## C7 — Require a verified email before Liam — DECISION
**Decide before running.** Stops throwaway/unverified signups from reaching Liam (kills cheap mass-account abuse) but adds one step for real users (confirm email before first Liam chat). The quiz stays fully open to guests — this gates only Liam. Skip if you'd rather not add friction; C6 + C8 already cover most of the risk.
**Files:** `backend/src/middleware/auth.ts`, `backend/src/routes/sommelier.ts`.
**Steps:**
1. Add `requireVerifiedEmail` middleware checking the decoded token's `email_verified` claim; if not true → 403 `{ error: 'email_not_verified', message: 'Please confirm your email to chat with Liam.' }` (match `blockAnonymousAuth` style).
2. Apply to `POST /start` and `POST /:sessionId/message`, chained after `requireAuth` + `blockAnonymousAuth`. Do **not** apply to quiz/profile/guest routes.
**Acceptance:** an unverified real account hitting Liam → 403 with that code; a verified account → normal flow.
**Guardrails:** Liam only; nothing guest-facing changes. `tsc` clean.

---

## C8 — Rate-limit account creation and password reset
**Goal:** slow scripted signups / reset spam.
**Why:** the app-wide 200/15min-per-IP limiter is too loose for auth endpoints (finding H2).
**Files:** `backend/src/routes/auth.ts`.
**Steps:** add an `express-rate-limit` limiter (reuse `sommelier.ts`'s `sommelierIpLimiter` pattern) and apply per-IP: `POST /api/auth/sync` → 10/min, `POST /api/auth/reset-password` → 5/min. Keep thresholds as named constants with a comment. Return standard 429.
**Acceptance:** the 11th sync / 6th reset from one IP within a minute → 429.
**Guardrails:** change no other route. `tsc` clean.

---

## C9 — Verify the Twilio inbound-SMS webhook signature
**Goal:** only accept genuine Twilio callbacks.
**Why:** `POST /api/webhooks/sms/inbound` trusts `From`/`Body` with no authenticity check (finding M9). Low today (SMS gate off) but a latent data-integrity/cost hole.
**Files:** `backend/src/routes/cron.ts`.
**Steps:** validate `X-Twilio-Signature` against the request URL + POST params using the Twilio auth token (`twilio.validateRequest`, token from env/Secret Manager) **before** any processing; reject invalid → 403. Ensure the body parser exposes the exact form params Twilio signs (urlencoded).
**Acceptance:** a forged POST without a valid signature → 403; a correctly-signed request → processed.
**Guardrails:** leave the handler's business logic unchanged. `tsc` clean.

---

## C10 — Declare Firestore security rules as code
**Goal:** version-control the rules so a reset/fresh env can't silently drop them.
**Why:** correct per-user rules live only in the console; no `firestore.rules` in the repo (finding M8) — same drift class GAPS.md flagged for indexes.
**Files:** new `firestore.rules` at repo root, `firebase.json`.
**Steps:**
1. Create `firestore.rules` with the rules documented in `WHAT_WE_BUILT.md`'s "Security rules" section (coffees: public read / backend-only write; `users/{userId}` and all subcollections: read/write only where `request.auth.uid == userId`).
2. Add `"rules": "firestore.rules"` to the existing `firestore` config block in `firebase.json` (currently declares only `database` + `indexes`).
**Acceptance:** `firebase deploy --only firestore:rules --dry-run` (or a deploy in a safe window) validates the file.
**Console step to WRITE OUT (don't run):** `firebase deploy --only firestore:rules`.
**Guardrails:** do not change the rules' logic — only move them into version control.

---

## C11 — Dependency upgrades + npm-audit CI gate
**Goal:** clear the known-CVE cluster and prevent regressions.
**Why:** `firebase-admin@12` is 3 majors behind and pulls a Critical + several Highs reachable in the running service (finding H5); shipped `react-router@7.13` has an open-redirect advisory (L6).
**Files:** `backend/package.json`, `frontend/package.json`, `.github/workflows/*`, new `.github/dependabot.yml`.
**Steps:**
1. Backend: bump `firebase-admin` ^12 → 14.2.0; `express` → 4.21.x; `helmet` as compatible. Run backend build + tests; fix any breakage from the `firebase-admin` major (auth/Firestore call sites).
2. Frontend: bump `react-router` → 7.18.2, `vite` → 6.4.3, `firebase` 10.x → latest 10.x. Rebuild; smoke-test routing + auth.
3. Add a CI step running `npm audit --audit-level=high` for both packages (fail the build on new High/Critical). Add `.github/dependabot.yml` for both npm ecosystems.
**Acceptance:** report before/after `npm audit` counts; Critical/High → 0 (or list any that can't be fixed without a breaking change, with the reason).
**Guardrails:** don't blind-bump anything that breaks the build — note it instead. Keep lockfiles committed.

---

## C12 — Security headers on the static site + CORS hardening
**Goal:** protect the user-facing app (Helmet only covers `/api`).
**Why:** Firebase Hosting sends only `Cache-Control` — no HSTS/nosniff/frame protection (finding M5); CORS falls back to `localhost` if `FRONTEND_URL` is unset (L5).
**Files:** `firebase.json`, `backend/src/index.ts`.
**Steps:**
1. Add a hosting `headers` entry for `source: "**"`: `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`, a reasonable `Permissions-Policy`. Keep the existing `Cache-Control` entries.
2. In `index.ts`, drop the `localhost:5173` fallback in production and add the prod apex/www domain to the **static** allowlist (don't rely only on `FRONTEND_URL`). Keep `credentials:true` with the explicit allowlist.
**Acceptance:** the deployed site responds with the new headers (verify after deploy); the API rejects a random cross-origin `Origin` and allows the prod domain.
**Guardrails:** don't set a full `Content-Security-Policy` script/style policy in this pass unless you verify it doesn't break the SPA — headers above are safe; a strict CSP needs its own testing pass. `tsc` clean.

---

## C13 — Harden the container images
**Goal:** don't run app processes as root; pin bases.
**Why:** neither Dockerfile sets `USER`; floating base tags (finding M6).
**Files:** `backend/Dockerfile`, `frontend/Dockerfile`.
**Steps:**
1. Backend: add `USER node` for the runtime stage; pin `node:20-alpine@sha256:…`.
2. Frontend: use an unprivileged nginx (e.g. `nginxinc/nginx-unprivileged`) or add a non-root user; pin the base by digest; replace `COPY . .` with copying only the built `dist` output so no local `.env`/`.git` is baked into a layer.
**Acceptance:** both images build and serve; `docker run … whoami` (or the effective UID) is non-root.
**Guardrails:** keep the multi-stage build and the existing `--set-secrets` deploy flow. Confirm nginx still binds its port as non-root (unprivileged image uses 8080).

---

## C14 — Keyless CI via Workload Identity Federation — HIGH
**Goal:** remove the long-lived exported service-account key.
**Why:** `deploy.yml` authenticates with a static `GCP_SA_KEY` even though both jobs already declare `id-token: write` (finding H6) — a leaked key = non-expiring prod access across Cloud Run + Hosting.
**Files:** `.github/workflows/deploy.yml`.
**Steps:**
1. Switch `google-github-actions/auth` to keyless: `workload_identity_provider` + `service_account` instead of `credentials_json`, for **both** the Cloud Run and Firebase Hosting steps. Ideally two separate least-privilege service accounts.
2. Trim the frontend job's unused `pull-requests: write` permission.
**Console steps to WRITE OUT for Dana (don't run):** create the Workload Identity Pool + provider, bind the GitHub repo, grant the SAs least-privilege roles; then **delete the `GCP_SA_KEY` secret and rotate that key**.
**Acceptance:** a CI run authenticates and deploys with no `credentials_json` / no static key present.
**Guardrails:** don't remove the old secret from GitHub until a keyless run succeeds.

---

## C15 — Low-severity hardening bundle
**Goal:** clear the small stuff in one pass.
**Files:** `backend/src/routes/sommelier.ts`, `schema.sql` + the household-invite verify path, `backend/src/routes/admin.ts`, `backend/src/routes/newsletter.ts`, the gift-code path.
**Steps:**
1. `sommelier.ts` (~L456): replace `INTERVAL '${resumeWindowHours} hours'` interpolation with a bound param: `NOW() - ($n || ' hours')::interval` (L1).
2. `household_invitation.token`: store a **hash** instead of the plaintext bearer token (expiry already exists); verify by hashing the presented token. Leave printed/opaque QR tokens as-is (L2).
3. `admin.ts` (~L314): drop the `detail: err.message` field from the 500 response — return a generic message like every other handler (L3).
4. `newsletter.ts` (~L49): require double opt-in (or ownership) before the `ON CONFLICT DO UPDATE` overwrites an existing subscriber's `archetype`/`subscribed` (L4).
5. `company_gift_code`: raise entropy (≥128-bit random, store a hash) and keep the tight per-IP/per-account redemption limiter (M7). Coordinate with any codes already printed/in the wild.
**Acceptance:** `tsc` clean; each item verified individually; note anything needing a data migration (invite-token hashing and gift-code changes both do).
**Guardrails:** these are independent — if one needs a migration you're not ready for, split it out rather than blocking the rest.

---

## C17 — Read the real client IP behind Cloudflare (so rate limiting keeps working)
**Goal:** make per-IP logic see the actual visitor, not Cloudflare.
**Why:** once traffic is proxied through Cloudflare, the backend sees Cloudflare's IPs. `express-rate-limit` keys on `req.ip`, so without this every request looks like one address — the sommelier/auth/guest limiters silently stop rate-limiting per user. Run this alongside the Cloudflare cutover (`CLOUDFLARE_SETUP.md`).
**Files:** `backend/src/index.ts`.
**Steps:**
1. The chain is now visitor → Cloudflare → Firebase Hosting → Cloud Run. Set Express to derive the client IP from the correct forwarded position. Prefer using Cloudflare's `CF-Connecting-IP` header as the source of truth for the client IP (it's the real visitor and is set by Cloudflare), OR configure `trust proxy` to the correct hop count for this chain and verify `req.ip` resolves to the visitor, not a Cloudflare/Google address.
2. If you rely on `X-Forwarded-For`, **only trust it when the request actually came through Cloudflare** — validate against Cloudflare's published IP ranges (or an `CF-Connecting-IP` presence check) so a direct hit to the origin can't spoof the header to dodge limits.
3. Confirm every `express-rate-limit` instance (global in `index.ts`, `sommelierIpLimiter`, the auth/guest limiters from C8/C16) now keys on the real client IP.
**Acceptance:** with the app behind Cloudflare, two requests from two different real IPs are counted separately by the limiter; a spoofed `X-Forwarded-For` on a direct-to-origin request does not change the keyed IP.
**Guardrails:** don't blindly `trust proxy = true` (that trusts any hop and lets anyone spoof their IP) — trust the specific known chain. `tsc` clean.

---

## C16 — Throttle anonymous-identity abuse on guest-write endpoints
**Goal:** stop unlimited anonymous identities from spamming the row-creating guest endpoints.
**Why:** every visitor auto-gets a free Firebase anon identity; anon is correctly blocked from Liam/orders/tokens but **can** write to guest surfaces — a script mints endless anon uids to bloat Postgres/Firestore (real per-op billing) and poison funnel analytics (finding M10).
**Files:** `backend/src/routes/quiz.ts`, `backend/src/routes/users.ts`, `backend/src/routes/newsletter.ts`, `backend/src/routes/auth.ts`; App Check from C6.
**Steps:**
1. Add per-IP `express-rate-limit` limiters (reuse `sommelier.ts`'s pattern) to the public/guest **write** endpoints: `POST /api/quiz/results`, `POST /api/quiz/event` (already ~30/min — verify), `POST /api/quiz/score`, `POST /api/newsletter`, and the guest-writable `users` routes (`PATCH /dial-position`, `POST /addresses`, flavor-memory writes). Sane per-IP/min thresholds; 429 on breach.
2. `POST /api/auth/sync`: add `blockAnonymousAuth` (or gate the 20-token signup bonus on a non-anonymous account) so an anonymous caller can't create a `user_tokens` row / claim the bonus by calling sync directly. (The frontend never calls sync for anon sessions, so this is safe.)
3. Ensure C6's `requireAppCheck` is applied to these guest endpoints too — App Check is the real structural throttle; rate limits are the backstop.
4. Verify the stale-anonymous-guest purge cron (`services/staleGuestCleanup.ts`) is actually scheduled in Cloud Scheduler — per GAPS.md only `purge-stale-anonymous-guests` exists; confirm it's live (it's the cleanup half).
**Acceptance:** hammering `POST /api/quiz/event` from one IP trips 429; an anonymous token calling `/api/auth/sync` no longer creates a `user_tokens` row.
**Guardrails:** don't block *legitimate* guest quiz/newsletter flows — thresholds should be generous for one real human, tight only against automation. `tsc` clean.
