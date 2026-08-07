# Cloudflare setup runbook — move DNS + turn on the free protections
*Goal: put Cloudflare's free edge in front of the site so traffic is filtered (WAF, DDoS, bot, HSTS, Turnstile) before it reaches Firebase Hosting / Cloud Run. Start on the Free plan, evaluate Pro later.*

## Two steps only you can do (I can't, by design)
1. **Create the Cloudflare account** — I can't create accounts or enter credentials. Sign up at cloudflare.com (free).
2. **Change the nameservers at your registrar** — that's a login to wherever you bought the domain. Everything between these two I've laid out below.

## Progress (2026-08-05) — zone created, records verified, awaiting nameserver switch
- Cloudflare account: `Danabar.mail@gmail...`. Zone `axisandbloomcoffee.com` added on the **Free** plan.
- **All 14 DNS records imported and verified** — including every email record: Namecheap Private Email (`mx1`/`mx2.privateemail.com`), Resend (`send` MX + `resend._domainkey` + `send` SPF), **Mailchimp** DKIM (`k2`/`k3._domainkey` → mcsv.net), apex SPF, `default._domainkey` DKIM, `_dmarc`, Firebase `hosting-site` + Facebook verification. Nothing missing.
- **A (root) and `www` set to DNS-only (grey)** for a safe cutover — traffic keeps going straight to Firebase during the switch; flip to Proxied only after confirming the site resolves through Cloudflare.
- **Assigned Cloudflare nameservers (set these at Namecheap):**
  - `dahlia.ns.cloudflare.com`
  - `tony.ns.cloudflare.com`
  - Remove: `dns1.registrar-servers.com`, `dns2.registrar-servers.com`
- **Before switching:** make sure DNSSEC is OFF at Namecheap (re-enable later via Cloudflare). **Next after activation:** flip A+www to Proxied, set SSL/TLS = Full (strict), enable HSTS/DNSSEC/WAF/Bot Fight/Turnstile/rate-limit, then run prompt **C17**.

### DONE — nameserver switch committed at Namecheap (2026-08-05)
- Verified DNSSEC was **OFF** at Namecheap before switching (no DS mismatch risk).
- Changed Namecheap nameservers to **Custom DNS → `dahlia.ns.cloudflare.com` + `tony.ns.cloudflare.com`** (removed `dns1/dns2.registrar-servers.com`). Namecheap confirmed the save.
- Cloudflare is now **"Waiting for registrar to propagate"** (typically 1–2h, up to 24–48h). All records still DNS-only, so the live site + email are unaffected during propagation.
### DONE — cutover complete & verified live (2026-08-05)
- Zone **Active** on Cloudflare. **SSL/TLS = Full (strict)** ✓. **A + www flipped to Proxied** ✓.
- Verified `https://axisandbloomcoffee.com` loads through Cloudflare: `200`, `server: cloudflare`, `cf-ray` present, HSTS on. Homepage renders correctly, no redirect loop / cert error. Email records stayed DNS-only and intact.
- **2FA turned ON at Namecheap** ✓ (done by Dana).

### DONE — protections turned on & verified (2026-08-05)
- **Bot Fight Mode: ON** (Security → Settings → Bot fight mode). Verified the app's own `/api` calls still return `200` JSON through Cloudflare, so it's not interfering with the SPA. ⚠️ **Before webhooks/cron/SMS go live pointed at the custom domain, add a WAF Skip rule for `/api/webhooks/*` and `/api/cron/*`** so Bot Fight Mode doesn't challenge legitimate server-to-server calls.
- **Edge security headers: LIVE** (Rules → Transform Rules → "Security headers", all incoming requests): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. Verified live on `https://axisandbloomcoffee.com` (HSTS was already present). **Finding M5 closed at the edge.** Still ship prompt **C12** to also cover the `*.web.app` origin.
- **DNSSEC: ENABLED on Cloudflare (pending DS at Namecheap).** Safe/no breakage while pending. Values seen: Algorithm 13, Digest Type 2 (SHA-256), Key Tag 2371, Flags 257 (KSK).

### DONE — DNSSEC completed end-to-end (2026-08-05)
- Enabled on Cloudflare + **DS record added at Namecheap** (Advanced DNS → DNSSEC): Key Tag `2371`, Algorithm `13 ECDSA/SHA-256`, Digest Type `2 SHA-256`, Digest `CC7542AC0FF9FF26DB3F0ABB4B70E6616690F42E77F5134E8B703A3227202C88` (digest verified char-for-char against Cloudflare before saving). Cloudflare "Confirm" clicked; now pending the `.com` registry publishing the DS (auto-activates, ~10 min–1 hr). Site verified still resolving `200` through Cloudflare after the change.

### DONE — Turnstile widget created (2026-08-05, dashboard only, no code yet)
- Widget **"Axis & Bloom signup + quiz"**, Mode **Managed**, Hostnames: `axisandbloomcoffee.com`, `axis-and-bloom-prod.web.app`.
- **Site key (public, goes in the frontend):** `0x4AAAAAAAEI0hqB9cD8oXWGy`
- **Secret key:** NOT recorded here on purpose — it's a credential. Retrieve it from Cloudflare → Turnstile → this widget when wiring the backend, and put it in **GCP Secret Manager** (never commit it). Both keys are re-viewable in the dashboard anytime.
- Code integration was deliberately deferred (deploys were blocked by a Git outage; avoiding queuing changes) — see the integration prompt below, run it once deploys are back.

### REMAINING (code — run once Git/deploys are back)
- **Prompt C17** — read the real client IP (`CF-Connecting-IP`) so per-IP rate limiting works now that traffic is proxied. **Highest priority** — the in-app limiters currently see Cloudflare's IPs. (Claude Code — in `CLAUDE_CODE_PROMPTS.md`)
- **Turnstile integration** (Claude Code):
  1. Frontend: render the Turnstile widget (`@marsidev/react-turnstile` or the vanilla `https://challenges.cloudflare.com/turnstile/v0/api.js` script) on the **signup** and **quiz-start** forms, using site key `0x4AAAAAAAEI0hqB9cD8oXWGy` (from `VITE_TURNSTILE_SITE_KEY`). On submit, send the returned `cf-turnstile-response` token to the backend.
  2. Backend: add a `TURNSTILE_SECRET_KEY` env var (from GCP Secret Manager) and verify the token server-side via `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` (params: `secret`, `response`, optional `remoteip` = the real client IP from C17). Reject the request if `success !== true`. Apply on `POST /api/auth/sync` (or the signup path) and `POST /api/quiz/results`/`score`.
  3. Add `VITE_TURNSTILE_SITE_KEY` to the frontend build env and `TURNSTILE_SECRET_KEY` to `--set-secrets` in `deploy.yml`.
- **Optional, recommended before launch:** one Cloudflare rate-limiting rule (e.g. `/api/auth/*`); the Bot Fight Mode Skip rule for `/api/webhooks/*` + `/api/cron/*` (see OPEN_TASKS.md OT-17); 2FA on the Cloudflare account (Namecheap 2FA already on).

## Confirmed current state — `axisandbloomcoffee.com` (checked 2026-08-05)
- **DNS is at Namecheap.** Nameservers are `dns1.registrar-servers.com` / `dns2.registrar-servers.com` (Namecheap BasicDNS).
- **The domain already points at Firebase Hosting** (A record `199.36.158.100`), so the custom-domain + cert step is effectively done — this de-risks the move. (The old Wix parking issue is resolved.)
- **You run email on this domain** — Namecheap **Private Email** (`mx1.privateemail.com`, `mx2.privateemail.com`, priority 10). This is the highest-risk thing to carry over.

### Records that MUST be recreated in Cloudflare (miss one → something breaks)
| Type | Name | Value | Proxy? |
|---|---|---|---|
| A | `@` (root) | `199.36.158.100` (Firebase) — **plus any second Firebase A record** Namecheap shows | grey (DNS-only) at first → orange after cert confirmed |
| MX | `@` | `mx1.privateemail.com` (10), `mx2.privateemail.com` (10) | **grey / DNS-only — never proxy mail** |
| TXT | `@` | `v=spf1 include:amazonses.com ~all` (SPF) | n/a |
| TXT | `@` | `hosting-site=axis-and-bloom-prod` (Firebase verify — keep it) | n/a |
| TXT | `@` | `facebook-domain-verification=rs1ltv26wyfqr0nuhob59r7tpnxnsd` | n/a |
| CNAME/A | `www` | whatever Namecheap currently has for `www` | match Firebase setup |

**Before you flip nameservers, check Namecheap's Advanced DNS for records this apex-only scan can't see and add them to Cloudflare too:**
- **DKIM** (selector records like `default._domainkey`, `resend._domainkey`, or a Private Email/SES selector) — email will land in spam without it.
- **DMARC** (`_dmarc` TXT).
- **Private Email autodiscover** records (`autodiscover`/`autoconfig`/`mail` CNAMEs, any SRV) — needed for mail-client setup.
Cloudflare's import usually grabs all of these automatically; the job is to **eyeball the imported list against Namecheap's current list and confirm every mail record made it, as DNS-only,** before switching nameservers.

---

## Step-by-step

### 1. Make sure the custom domain is already working on Firebase Hosting
In the Firebase console → Hosting → add your custom domain if it isn't there, and complete Firebase's verification so it serves the site over HTTPS on that domain. Note the **A records** (and any TXT) Firebase gives you — you'll recreate them in Cloudflare. Do this *before* moving DNS so you're not debugging two things at once.

### 2. Add the site to Cloudflare (Free plan)
Cloudflare dashboard → **Add a site** → enter the domain → choose the **Free** plan. Cloudflare scans and imports your current DNS records. Review the imported list — make sure the Firebase A record(s), any mail (MX), and other records are all present. Missing records = broken email/subdomains after cutover.

### 3. Point the Firebase records, but start "DNS only"
For the record that points at Firebase Hosting, set it to **DNS only (grey cloud)** for now. Firebase provisions its *own* SSL cert and needs to see the raw record to validate it. Proxying (orange) too early can stall Firebase's cert issuance.

### 4. Change nameservers at Namecheap
Namecheap dashboard → **Domain List** → **Manage** on `axisandbloomcoffee.com` → the **Nameservers** dropdown → switch from "Namecheap BasicDNS" to **"Custom DNS"** → enter Cloudflare's **two nameservers** → click the green checkmark to save. Leave the domain's **Registrar Lock ON** (it blocks transfers, not nameserver changes). Activation is usually minutes, up to 24–48h; Cloudflare emails you when the zone is active. Namecheap's own DNS records stop being authoritative once this takes effect — which is exactly why every record above had to be recreated in Cloudflare first.

> Note: if you were using Namecheap's *free Email Forwarding* you'd lose it here — but you're on **Private Email** (a paid mailbox product that lives on `privateemail.com` servers), so as long as the `mx1/mx2.privateemail.com` MX records are in Cloudflare, your email keeps working after the switch.

### 5. After Firebase's cert is confirmed, turn on the proxy
Once the site loads fine over HTTPS on the custom domain, switch the Firebase record to **Proxied (orange cloud)**. Now traffic flows through Cloudflare's WAF/CDN.

### 6. SSL/TLS — set it correctly (avoids redirect loops)
SSL/TLS → Overview → set encryption mode to **Full (strict)**. **Do not use "Flexible"** — with Firebase's HTTPS origin it causes redirect loops. Turn on **Always Use HTTPS** and **Automatic HTTPS Rewrites**.

### 7. Turn on the free protections
- **HSTS** (SSL/TLS → Edge Certificates → Enable HSTS): `max-age` 6–12 months, includeSubDomains. This closes the missing-HSTS gap at the edge immediately — before C12 even ships.
- **DNSSEC** (DNS → Settings → Enable DNSSEC): turn it on in Cloudflare, then add the DS record it gives you at your registrar. Stops DNS-spoofing/cache-poisoning against your domain.
- **WAF Managed Ruleset** (Security → WAF): enable the free Cloudflare managed ruleset.
- **Bot Fight Mode** (Security → Bots): on. Basic automated-bot mitigation, free.
- **Prefer "Managed Challenge" over "Block"** on uncertain traffic (WAF/Bot actions): a real customer clears a silent challenge, a bot doesn't — far fewer false-positives than hard-blocking, which can lock out legitimate buyers.
- **Security Level**: Medium (default) or High if you see abuse.

### 8. Add security response headers at the edge (interim win for finding M5)
Rules → **Transform Rules → Modify Response Header** → add, for all requests: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (a sensible default). This gives your *static site* real security headers today, even before the `firebase.json` change in prompt C12 lands. (Keep C12 anyway — defense in depth, and it protects the `*.web.app` origin too.)

### 9. Turnstile CAPTCHA for signup + quiz (pairs with App Check / C6)
Cloudflare dashboard → **Turnstile** → create a widget for your domain. Drop it on the account-creation and quiz-start flows in the frontend so bots can't script them. This is the edge half; Firebase App Check (prompt C6) is the app half — run both.

### 10. One free rate-limiting rule
Free includes one custom rate-limiting rule. Point it at your most abuse-prone path — e.g. `/api/auth/*` or `/api/sommelier/*` — e.g. "more than N requests/min per IP → block for 1 min." This is global (unlike your per-instance in-app limiters), so it's a real backstop.

### 11. Harden the Cloudflare + registrar accounts (do not skip)
The account that controls your DNS is now a top-tier target — a takeover there bypasses every protection below it.
- **MFA on the Cloudflare account** (My Profile → Authentication) — use an authenticator app, not SMS.
- **MFA + a registrar lock** on your domain-registrar account (the "transfer lock" / "domain lock" setting). This stops someone moving the domain out from under you.
- **Least privilege for collaborators:** if anyone else helps administer this, give them their own Cloudflare member account with a scoped role — never share your login/password.

---

## The important caveat — Cloudflare protects the *domain*, not the origin URLs
Your `*.web.app` (Firebase) and `*.run.app` (Cloud Run) origin URLs still exist and **bypass Cloudflare** — a determined attacker who finds them can hit your backend directly, skipping the WAF. You can't remove the Firebase default domain, but you can:
- **Restrict Cloud Run ingress** so the API isn't directly reachable except through the intended path (GCP → Cloud Run → the service → Networking → Ingress: "Internal + Cloud Load Balancing", or put it behind an LB you control).
- Ship **C1** so the schema-leak endpoints are gone from the Cloud Run origin regardless.
- Keep the **app-level** protections (App Check C6, rate limits, the C2 kill-switch) — Cloudflare is defense-in-depth on top of them, not a replacement. This is why the code prompts still matter after Cloudflare is up.

## Two more caveats that catch people out
- **Cloudflare CANNOT rate-limit your signup/login.** Firebase Auth runs in the browser and calls Google's `identitytoolkit.googleapis.com` servers **directly** — that traffic never touches your domain, so no Cloudflare rule sees it (confirmed in the live scan). The real levers for auth abuse are **Firebase App Check (C6)** and Firebase's own settings (authorized domains, email-enumeration protection), not a Cloudflare rule. Don't assume "signup is rate-limited" once Cloudflare is on — it isn't.
- **Your per-IP rate limiting will break unless you read the real client IP.** Once traffic is proxied, your backend sees Cloudflare's IPs, so `express-rate-limit` (and any IP logic) would treat everyone as one address. Your app already sets `trust proxy = 1` for Cloud Run's LB; adding Cloudflare inserts another hop. Fix this in code — see **prompt C17** — before or right after you flip the proxy on, or the sommelier/auth limiters silently stop working per-IP.

---

## Verify when done
- Site loads over HTTPS on the custom domain, no cert warnings, no redirect loop.
- Response headers on the custom domain now include HSTS + the Transform-Rule headers (re-run the header check).
- Email still delivers (MX records intact).
- A quick Turnstile challenge appears on signup/quiz.
- Nothing on `*.web.app` broke (it still works, just unproxied).

## Optional: the Cloudflare connector
There's an official **"Cloudflare Developer Platform"** MCP connector in the registry (not installed). It's oriented toward Workers/KV/AI rather than DNS/WAF zone config, so it won't do this DNS move for you — the dashboard is the right place for that — but if you later want me to help manage Workers or edge logic, you could connect it via claude.ai. Not needed for this setup.
