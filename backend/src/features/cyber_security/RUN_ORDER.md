# Run order — the execution checklist
*Tick these top to bottom. "Console" = you, in a dashboard. "Cloudflare" = `CLOUDFLARE_SETUP.md`. "C#" = the prompt in `CLAUDE_CODE_PROMPTS.md` (run in Claude Code, one at a time: branch → diff → tsc/build/test → verify → commit).*

## Phase 0 — today, no code (caps the worst case)
- [ ] **Console — STILL TODO, most important AI-bill cap:** set an **Anthropic monthly spend cap** on Liam's API key (Anthropic console, not GCP — I can't reach it from the GCP/Cloudflare session). This is the real hard cap on the Liam/AI bill.
- [x] **Console — DONE 2026-08-05:** GCP billing budget "Axis & Bloom monthly budget" on `axis-and-bloom-prod` — **$100/mo**, email alerts to billing admins at **50% / 90% / 100% / 1,000%** ($50/$90/$100/$1,000). Alerts only (GCP budgets email; they do NOT stop services).
- [x] **DONE 2026-08-05:** Turnstile **Secret key** stored in **GCP Secret Manager** as `TURNSTILE_SECRET_KEY` (referenced by the backend once C6/Turnstile integration deploys).
- [ ] **Deploy-dependent follow-up — true "$1000 → shut it off" auto-stop (Dana wants this):** a GCP budget can't stop services by itself. The real auto-shutoff = budget → **Pub/Sub topic** → **Cloud Function** that calls `projects.updateBillingInfo` to **disable billing** on the project at the $1000 threshold. Caveats: (a) needs a **Cloud Function deploy** (blocked by the current Git outage), and (b) it's **nuclear** — disabling billing takes down the whole project (Cloud Run API, Cloud SQL, Firestore, site) until billing is manually re-enabled, i.e. "shut off, investigate, turn back on." Wire this once Git/deploys are back. (More surgical AI-only stops that don't nuke GCP: the Anthropic spend cap above + the C2 kill-switch.)
- [ ] **Console:** turn on GitHub **Dependabot**, **CodeQL**, and **secret scanning + push protection** on the repo (the native half of C11).

## Phase 1 — stand up the edge (biggest risk-reduction per hour)
- [ ] **Cloudflare:** confirm the production custom domain + current DNS host.
- [ ] **Cloudflare:** steps 1–11 in `CLOUDFLARE_SETUP.md` (DNS move, Full-strict SSL, HSTS, DNSSEC, WAF, Bot Fight, Managed Challenge, edge headers, Turnstile, one rate-limit rule) — **carry over email/MX/SPF/DKIM records exactly.**
- [ ] **Cloudflare + registrar:** MFA on both accounts, registrar lock, least-privilege collaborator accounts (runbook step 11).
- [x] **C17 — DONE 2026-08-07:** read the real client IP behind Cloudflare, so per-IP rate limiting keeps working. `backend/src/middleware/clientIp.ts` (`d294cc4`); root cause + fix confirmed empirically via a temp diagnostic route hit through every real request path before writing the fix. Full writeup in `WHAT_WE_BUILT_SECURITY.md`.
- [x] **NOT VIABLE — confirmed 2026-08-06, do not attempt:** restricting Cloud Run ingress to close the direct-`*.run.app` bypass. The API is served via a Firebase Hosting rewrite (`/api/**` → Cloud Run in `firebase.json`), and Firebase Hosting rewrites require Cloud Run ingress = "All" — confirmed live in the GCP console. Restricting ingress breaks the entire API, not just the bypass. The C17 residual gap this was meant to close is instead closed by **C6** (Firebase App Check) below: once enforced, a direct-to-origin request without a valid App Check token is rejected before it reaches the rate limiter, so the *.run.app bypass is unreachable without ever touching Cloud Run's ingress setting.
- [ ] **Console:** confirm PostgreSQL / Cloud SQL is **not** publicly reachable (only via the proxy/connector) and the app DB user is minimally privileged.
- [ ] Note: Cloudflare does **not** cover Firebase signup/login (those go straight to Google) — that's App Check's job in Phase 3.

## Phase 2 — high-value code (run in this order)
- [x] **C1 — DONE 2026-08-07:** removed `/health/db` + `/health/session-cols` (`backend/src/index.ts`, `a0fa591`). `GET /health` untouched. Verified live: `/health` 200, both removed routes 404 at the Cloud Run origin. Full writeup in `WHAT_WE_BUILT_SECURITY.md`.
- [x] **C2 — DONE 2026-08-07:** global aggregate Claude kill-switch (`CLAUDE_ENABLED`/`CLAUDE_GLOBAL_DAILY_USD`, `backend/src/services/anthropicGuard.ts`) + M4's content-based model escalation removed entirely from `claude.ts`. Wired into all 9 real Claude call sites app-wide. Full writeup in `WHAT_WE_BUILT_SECURITY.md`. **C3 can now build on this ceiling.**
- [ ] **C3** — stop public coffee AI endpoints from generating on demand.
- [ ] **C4** — beats dial-in IDOR → capability token. *(schema migration)*
- [ ] **C5** — order-bonus abuse + server-side pricing. *(may need a Shopify paid-webhook; can split)*

## Phase 3 — close the front door
- [ ] **C6** — Firebase App Check enforced on backend + frontend. *(Console: register reCAPTCHA Enterprise key, enable App Check; keep `APP_CHECK_ENFORCED=false` until real traffic passes, then flip on)* **Must exempt the `requireCronSecret` routes** (`/api/cron/*`, `/api/webhooks/*`) from App Check enforcement — Cloud Scheduler and inbound webhooks call the `*.run.app` URL directly with the cron secret, not through the browser/App Check flow, and would otherwise be locked out. This also closes C17's residual direct-origin-spoofing gap for every *other* rate-limited route — see the Phase 1 note above.
- [ ] **C16** — throttle anonymous-identity abuse on guest-write endpoints. *(depends on C6's App Check)*
- [ ] **C8** — rate-limit account creation + password reset.
- [ ] **C7** — email-verified gate on Liam. **DECISION** — only if you accept the small extra step for real users; skip otherwise.

## Phase 4 — hygiene & hardening
- [ ] **C11** — dependency upgrades (firebase-admin 12→14, react-router, vite, express) + npm-audit CI gate. *(isolate — majors can break the build)*
- [ ] **C12** — security headers in `firebase.json` + CORS hardening. *(edge headers from Phase 1 already cover the live domain; this covers the `*.web.app` origin too)*
- [ ] **C10** — Firestore rules as code. *(Console: `firebase deploy --only firestore:rules`)*
- [ ] **C9** — Twilio inbound-webhook signature. *(low urgency — SMS gate is off)*
- [ ] **C13** — non-root containers + pinned bases.
- [ ] **C14** — keyless CI (Workload Identity Federation). *(Console: create WIF pool/provider, then delete + rotate `GCP_SA_KEY`)*
- [ ] **C15** — low-severity bundle (SQL interval param, hash invite tokens, admin error-detail, newsletter double-opt-in, gift-code entropy). *(some data migrations)*

## As you go
- Update the **Status** column in `SECURITY_FINDINGS.md` (OPEN → DONE) so the register stays truthful.
- Re-run the live header check after Cloudflare + after C12 to confirm the site is actually serving the headers.
