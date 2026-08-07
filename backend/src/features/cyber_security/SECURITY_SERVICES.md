# Security services & broader posture — what to buy, register, and do
*Beyond the code fixes. For a small, pre-launch startup on GCP + Firebase. Recommendations lean toward free/low-cost tiers that fit your stage; verify current pricing/tiers at signup — they change.*

---

## The one move with the highest payoff: put an edge in front of the site

Right now traffic hits Firebase Hosting + Cloud Run directly. The single biggest upgrade is to route it through a security edge (a "reverse proxy" that filters before requests reach you). That one step gives you a WAF, DDoS absorption, bot filtering, global rate limiting, and a CAPTCHA — the exact defenses that are awkward to build in app code.

**Recommended: Cloudflare.** You move your DNS to Cloudflare (this is the "register the site there and get services" step you asked about), turn on proxying, and you get, largely on the **free plan**: always-on DDoS mitigation, a managed WAF ruleset, IP/geo/rate-limiting rules, and **Turnstile** (a privacy-friendly CAPTCHA you can drop on signup/quiz to stop bots — pairs perfectly with Firebase App Check). Paid **Pro** (~low tens of $/mo) adds the full OWASP managed ruleset and more WAF rules. This protects the *whole* site, not just `/api`, and it's the real-world version of "GCP protects me" that you asked about earlier.

**GCP-native alternative: Cloud Armor.** Since you're already on Google Cloud, Cloud Armor is the same category (WAF + DDoS + rate limiting) but requires standing up an external HTTPS Load Balancer in front of Cloud Run and costs per-policy/per-request. Comparable protection, more setup, more cost — Cloudflare is the lower-friction path for your stage. **Fastly** and **AWS WAF** are the other big names if you ever want to compare.

Do **not** run both a full Cloudflare WAF and Cloud Armor at once — pick one edge.

---

## The rest of the stack, by job

| Job | Recommended (start here) | Notes / alternatives |
|---|---|---|
| **Edge WAF / DDoS / bot / CAPTCHA** | **Cloudflare** (free → Pro) + **Turnstile** | GCP **Cloud Armor**, **Fastly**, **AWS WAF** |
| **App-origin bot attestation** | **Firebase App Check** + **reCAPTCHA Enterprise** (already in your plan as C6) | This is the in-app half; Turnstile is the edge half |
| **Dependency / code scanning (SCA + SAST)** | **GitHub Dependabot + CodeQL** (native, free on your repo; part of GitHub Advanced Security) — wired up in prompt C11 | **Snyk** (generous free dev tier, great DX), **Socket.dev** (supply-chain/malicious-package focus) |
| **Secret scanning** | **GitHub secret scanning + push protection** (blocks committing a key) | **GitGuardian** (free tier, catches leaked secrets in history) |
| **Dynamic scanning (DAST — test the running site)** | **OWASP ZAP** (free, run it yourself or in CI) | **Intruder.io**, **Detectify**, **Probely**, **StackHawk** — managed, recurring external scans (paid) |
| **Error & security monitoring** | **Sentry** (free tier; catch errors + suspicious spikes) + **GCP Cloud Logging alerts** | **Datadog** if you outgrow it |
| **Uptime / availability** | **UptimeRobot** or **Better Stack** (free tiers) | Not security per se, but tells you when an attack takes you down |
| **Pentest / bug bounty (later, at scale)** | A one-off pentest firm, or **HackerOne / Bugcrowd / Intigriti / Cobalt** | Overkill pre-launch; revisit once you have real traffic/revenue |
| **Compliance posture (only if enterprise B2B demands it)** | **Vanta** or **Drata** | Your B2B company-gifts feature *might* eventually trigger a customer SOC 2 request — park this until asked |

---

## A pragmatic order for *you*, specifically
1. **Now, free:** Anthropic spend cap + GCP billing budget (from the prompt pack P0). Move DNS to **Cloudflare**, enable proxy + managed WAF + a signup/quiz **Turnstile** widget. Turn on **GitHub Dependabot, CodeQL, secret scanning + push protection** on the repo.
2. **This month:** ship the code fixes (C1–C6, C16) and add **Sentry** for error/anomaly visibility.
3. **Before/at launch:** one **OWASP ZAP** (or a trial of a managed DAST like Intruder/Detectify) pass against the live site; set up **UptimeRobot**.
4. **At scale / on request:** managed recurring DAST, and a pentest or bug-bounty program.

---

## Beyond tools — the security hygiene that isn't a product
These cost nothing but time and close the failure modes tools don't:

- **MFA everywhere that matters.** Turn on MFA for your Firebase/Google Cloud console accounts and GitHub — a compromised admin login bypasses every control above. Your app's admin role is a DB flag; the *account* that holds it needs MFA.
- **Least privilege.** The CI service accounts and any human IAM should have the minimum roles (this is also prompt C14). Avoid `Owner` on anything automated.
- **Backups & recovery.** Confirm Cloud SQL **automated backups + point-in-time recovery** are on, and that you've actually tested a restore once. Firestore: schedule exports. A ransomware/oops-delete is recoverable only if this exists *before* it happens.
- **Secret rotation + a manager.** Keep secrets in **GCP Secret Manager** (you already do for most), rotate the ones that ever touched a file (the SA keys), and never commit real secrets — the secret-scanning tools above enforce this.
- **Monitoring that pages you.** A couple of Cloud Logging alert policies (spend-ceiling warning fired, error-rate spike, the aggregate-anomaly flag from C2) turn "I found out from the bill" into "I got paged."
- **An incident checklist.** One page: how to rotate keys, disable a compromised account, flip `gatingEnabled` / the kill-switch, and who to call. You don't need a SOC — you need the steps written down before you're panicking.
- **A `security.txt`.** Publish `/.well-known/security.txt` with a contact email so a friendly researcher who finds a bug can tell *you* instead of disclosing it publicly.
- **Keep quiz/funnel analytics honest.** Bot traffic skews the very metrics you're using for launch decisions — Cloudflare + App Check + C16's rate limits protect your data quality, not just your servers.

Sources: [Cloudflare WAF alternatives comparison (Indusface)](https://www.indusface.com/blog/cloudflare-waf-alternatives/), [Best WAF solutions 2025–2026 (Fastly)](https://www.fastly.com/blog/best-waf-solutions-2025-2026), [Top WAFs 2026 (CyberSecurityNews)](https://cybersecuritynews.com/best-web-application-firewall-waf/), [Snyk vs GitHub Advanced Security 2026 (DEV)](https://dev.to/rahulxsingh/snyk-vs-github-advanced-security-third-party-platform-vs-native-github-security-2026-p59), [Best Snyk alternatives 2026 (DEV)](https://dev.to/rahulxsingh/8-best-snyk-alternatives-for-developer-security-in-2026-326k).
