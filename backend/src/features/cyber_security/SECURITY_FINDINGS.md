# Security Findings Register — Axis & Bloom
*Last updated 2026-08-05. Sources: manual review + three parallel audit passes (backend authz/injection, LLM+frontend, deps/infra). Severity is impact × exploitability at this site's stage. "Prompt" = the Claude Code prompt in `CLAUDE_CODE_PROMPTS.md` that closes it.*

## Legend
Status: `OPEN` · `IN PROGRESS` · `DONE` · `ACCEPTED` (consciously not fixing)

---

## HIGH

| # | Finding | Location | Concrete attack | Prompt | Status |
|---|---------|----------|-----------------|--------|--------|
| H1 | **Anthropic bill is unbounded — no global ceiling.** Liam + the public coffee AI endpoints call Claude; per-account caps exist but nothing caps *total* daily spend. | `sommelier.ts`, `coffees.ts`, Anthropic account | Mass accounts (or one bad loop) drive aggregate spend with no backstop. | Console P0 + C2 | OPEN |
| H2 | **Mass account creation is free/unverified.** Firebase email/pw signup via the public key, no App Check, no email-verify gate, no signup rate limit. | `middleware/auth.ts`, `auth.ts`, Firebase | Script thousands of real accounts, each gets up to 60 Liam turns/day. | C6, C7, C8 | OPEN |
| H3 | **Beats dial-in respond is an unauth IDOR over a sequential id.** `GET /api/beats/dial-in/:beatEventId/respond` has no auth; `beat_event.id` is SERIAL; no ownership check. | `beats.ts:16`, `beatEngine.ts respondToDialInBeat`, `schema.sql` (beat_event SERIAL) | Loop integers → mark any customer's beat responded and shift *their* next brew-card grind in an attacker-chosen direction. Cross-user data tampering, no login. | C4 | OPEN |
| H4 | **Order-bonus tokens are mintable without payment.** `POST /api/orders` creates an *unpaid* Shopify draft and grants 10 tokens per call, no idempotency, no payment check. | `orders.ts:180-198` (grant), `shopify.ts` (draft) | An account loops order creation to mint unlimited tokens (free AI credit — live the moment `gatingEnabled` flips on). | C5 | OPEN |
| H5 | **Backend ships a Critical + several High CVEs via outdated `firebase-admin@12` (3 majors behind).** `protobufjs` DoS (reachable via Firestore gRPC), `form-data` CRLF, `websocket-driver`. | `backend/package.json` | Server-side DoS / request smuggling through transitive deps in the running service. | C11 | OPEN |
| H6 | **CI authenticates with a long-lived exported SA key though OIDC is already wired.** Same static `GCP_SA_KEY` deploys both Cloud Run and Firebase Hosting. | `.github/workflows/deploy.yml` L26-29,68-71,110 | A leaked key = non-expiring prod access across both services. | C14 | OPEN |

## MEDIUM

| # | Finding | Location | Concrete attack | Prompt | Status |
|---|---------|----------|-----------------|--------|--------|
| M1 | **Unauthenticated diagnostic endpoints leak the DB schema.** `/health/db` (all table names) and `/health/session-cols` (column types). | `index.ts:50-72` | Free data-model map for anyone probing. | C1 | OPEN |
| M2 | **Public coffee AI endpoints generate on cache-miss.** `/api/coffees/:id/content` and `/:id/ai-summary` call Claude when content is null; some coffees are permanently null (nulled refusals) → every request re-generates. | `coffees.ts:840,914` | Hammer a null-content id → repeated Claude calls, only the loose 200/15min-per-IP limiter in front. | C3 | OPEN |
| M3 | **Client-controlled order price recorded as amount paid.** `item.priceCents` from body → `order.total_amount_paid` / `unit_price_charged`, no server-side price lookup. | `orders.ts:85,99-126` | Record $0 / arbitrary orders; corrupts revenue/LTV/analytics. | C5 | OPEN |
| M4 | **User can pin the expensive Sonnet model via message content.** ≥20 words or a trigger word (`recommend`/`why`/`explain`/`compare`…) forces `claude-sonnet-4-6` for the turn. | `claude.ts:269-288` | Keyword-laden turns pin the priciest model every turn (bounded by daily/turn caps). | C2 (note) | OPEN |
| M5 | **No security response headers on the static site.** Helmet only wraps `/api`; Firebase Hosting sends only `Cache-Control` — no HSTS, `nosniff`, frame-ancestors, `Referrer-Policy`. | `firebase.json:24-33` | Clickjacking / MIME-sniffing on the user-facing app. | C12 | OPEN |
| M6 | **Containers run as root; base images unpinned.** No `USER` in either Dockerfile; floating `node:20-alpine` / `nginx:alpine` tags. | `backend/Dockerfile`, `frontend/Dockerfile` | A container escape / RCE runs as UID 0; base drift. | C13 | OPEN |
| M7 | **Gift-code redemption is enumerable.** Low-entropy human-friendly codes (AXBL-XXXXXX), stored plaintext, weak per-instance limiter. | `companyGiftRedemption.ts`, `schema.sql company_gift_code` | Distributed brute-force of valid codes → free sponsored subscriptions. | C15 | OPEN |
| M8 | **Firestore security rules not declared as code.** Correct per-user rules exist only in the console; no `firestore.rules` in repo, `firebase.json` references only indexes. | repo root / `firebase.json` | A data reset / fresh env silently drops rules → cross-user Firestore reads if any client-direct read is ever added. | C10 | OPEN |
| M9 | **Twilio inbound-SMS webhook has no signature verification.** `POST /api/webhooks/sms/inbound` trusts `From`/`Body` from the body. | `cron.ts:659` | Forge inbound "customer replies" (data integrity + cost once SMS launches). Low today — SMS master gate is off. | C9 | OPEN |
| M10 | **Anonymous-identity abuse → mass guest writes.** Every visitor auto-gets a free Firebase anon identity; creation is unlimited/unattested. Anon is blocked from Liam/orders/tokens, but CAN write to guest surfaces (quiz results/events, profile upsert, dial-position, flavor-memory, addresses, newsletter) + hit the public coffee AI endpoints. | `AuthContext.tsx` (signInAnonymously), guest routes in `quiz.ts`/`users.ts`/`newsletter.ts`, `auth.ts` sync | Script mints endless anon uids → bloats Postgres/Firestore (real per-op Firestore billing + later purge-delete cost) and poisons `quiz_funnel_event` analytics. Not an Anthropic-cost or cross-user-data threat (anon is Liam-blocked and uid-scoped). | C16 (+ C6, C3) | OPEN |

## LOW

| # | Finding | Location | Fix | Prompt | Status |
|---|---------|----------|-----|--------|--------|
| L1 | `INTERVAL '${resumeWindowHours} hours'` string-interpolated into SQL (config-sourced, not user input today — hardening only). | `sommelier.ts:456` | Bind as a `$n` param. | C15 | OPEN |
| L2 | Plaintext bearer tokens in DB (`household_invitation.token`, QR tokens). | `schema.sql` | Hash the invite token (has expiry already); QR opaque tokens can stay. | C15 | OPEN |
| L3 | Admin session-create echoes raw DB error text to the client (admin-only exposure). | `admin.ts:314` | Drop the `detail` field. | C15 | OPEN |
| L4 | Newsletter subscribe can re-subscribe / overwrite archetype for an arbitrary email. | `newsletter.ts:49-62` | Double opt-in before mutating an existing row. | C15 | OPEN |
| L5 | CORS allowlist falls back to `localhost:5173` if `FRONTEND_URL` unset; prod apex domain only present via env var. | `index.ts:36-41` | Drop the localhost fallback in prod; hardcode the prod domain. | C12 | OPEN |
| L6 | Shipped `react-router@7.13` has an open-redirect advisory (backslash in `<Link>`); non-major fix to 7.18.2. | `frontend/package.json` | Bump with the dep pass. | C11 | OPEN |
| L7 | Frontend deploy job has an unused `pull-requests: write` scope. | `deploy.yml` | Trim the scope. | C14 | OPEN |

---

## Verified SAFE (checked because it looked risky — no action)
- **SQL injection:** none. Every query is `$n`-parameterized; the one dynamic `SET` clause joins only hardcoded column names.
- **IDOR:** users, orders (`WHERE o.id=$1 AND up.firebase_uid=$2`), addresses, households (invite needs a 32-byte token + email match), QR (16-byte token + ownership check) all scope to the caller.
- **Admin API:** `router.use(requireAdmin)` on every admin router, with a Postgres `user_type='admin'` check — server-enforced, not just hidden UI.
- **LLM markers:** `remember` / `card:adjust` / `open_dial` / `save_recipe` are all whitelist-verified server-side and scoped to the caller's own uid — a forged id can only touch the attacker's own data. No cross-user effect.
- **LLM output:** `max_tokens` bounded on all 6 model call sites; output stored and rendered as escaped React text; no `dangerouslySetInnerHTML` anywhere. No stored XSS.
- **Secrets/bundle:** no Anthropic/Shopify-admin/Resend/service-account/CRON secret in the frontend or any `VITE_` var (only the public Firebase web config); no `.js.map` shipped.
- **CI triggers:** `push: main` only — no `pull_request_target`, no untrusted-PR code running with secrets. Secrets injected via GCP Secret Manager `--set-secrets`, not baked into images. `.env` / key files gitignored. `reporting_ro` DB role is NOLOGIN, view-only.
- **Cron:** all jobs behind `requireCronSecret`, which fails closed if the secret is unset.
- **Password reset:** enumeration-safe (returns ok regardless of whether the email exists).

| M11 | **Per-IP rate limiting will break behind Cloudflare unless the real client IP is read.** Proxying makes the backend see Cloudflare IPs; `express-rate-limit` would treat all traffic as one address. Also: Cloudflare cannot rate-limit Firebase signup/login (those hit Google's `identitytoolkit` directly, not your domain). | `backend/src/index.ts` (`trust proxy`), all `express-rate-limit` sites | After the Cloudflare cutover, the sommelier/auth/guest limiters silently stop limiting per-user; auth abuse must be handled by App Check, not a Cloudflare rule. | C17 (+ C6) | **DONE 2026-08-07 (rate-limiting half only — the Cloudflare-can't-rate-limit-Firebase-auth half is still true, tracked separately under C6/C8)** |

## Live production scan — 2026-08-05 (axis-and-bloom-prod.web.app)
Confirmed against the running site (browser network trace + same-origin header probe):
- **M5 confirmed live.** The static site (Firebase Hosting) returns **zero** security headers — no HSTS, X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy, or Permissions-Policy. The pages your users load are unprotected. → C12.
- **API is well-defended (good).** `/api/*` (Cloud Run + helmet) returns HSTS, X-Content-Type-Options, X-Frame-Options, CSP, and Referrer-Policy; `x-powered-by` is hidden. Only `Permissions-Policy` is missing. So protection currently **stops at the API boundary** — the site itself is the gap.
- **M10 confirmed live.** An anonymous Firebase identity is minted on every page load (`identitytoolkit …/accounts:lookup` fires unauthenticated on first paint). → C6 + C16.
- **M2 confirmed live.** The coffees page calls the public `GET /api/coffees/:id/content` on load — the on-demand AI-generation path is a real, reachable surface. → C3.
- **No source maps** are loaded by the production bundle (consistent with the earlier static-bundle finding).
- **M1 nuance:** `/health/db` is mounted at the Cloud Run root, and Hosting only rewrites `/api/**`, so it is **not** reachable through the public `web.app` domain (that path serves the SPA). The schema leak is exposed only at the **direct Cloud Run origin** — still worth removing (C1), but lower real-world reach than if it were on the main domain.

## Fixes applied — 2026-08-07
- **M11 (rate limiting) closed.** Confirmed empirically (temp logging route, real Cloud Run log reads, not assumed) that X-Forwarded-For never carries the real visitor IP through Cloudflare -> Firebase Hosting -> Cloud Run — Firebase Hosting's rewrite replaces it with its own 2-entry chain. CF-Connecting-IP does carry the real IP but is spoofable on both the `*.web.app` and `*.run.app` direct-origin paths (also confirmed by direct test). New `backend/src/middleware/clientIp.ts` trusts CF-Connecting-IP only when X-Forwarded-For's second-to-last entry is a published Cloudflare IP; otherwise falls back to `req.ip` (trust proxy=1, non-spoofable). Wired into every `express-rate-limit` instance. Full detail: `WHAT_WE_BUILT_SECURITY.md` entry 1. One known residual gap documented in the code and there too — closing it needs the Cloud Run ingress restriction below (still open).

## Not fixed by choice (ACCEPTED)
- Per-instance (not global) in-memory rate limits on Cloud Run — accepted tolerance at current scale; revisit with a shared store (Memorystore) if you scale up.
- Secret-key JSON files present on disk but gitignored — per Dana, not urgent (still: confirm they were never in git history).
