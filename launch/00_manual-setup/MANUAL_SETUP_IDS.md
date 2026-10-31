# Marketing Manual Setup — IDs & Accounts (created 2026-07-17)

All created under danabar.mail@gmail.com. These are the values the numbered prompts (esp. Step 02) need.

## Analytics & Ads IDs

| What | Value |
|------|-------|
| **GA4 Measurement ID** | `G-GYC50VYRYN` |
| GA4 account / property | "Axis & Bloom" / "Axis & Bloom Website" (NY time, USD) |
| GA4 web stream | "Axis & Bloom Web", stream id `15277059820` |
| **Meta Pixel ID** | `945138695260153` (dataset "Axis and Bloom Pixel") |
| Meta business portfolio | "Axis and Bloom", business_id `1347053896963249` |
| Meta ad account | "Axis and Bloom Ads", id `2545676339186168` (NY, USD) |
| Meta domain asset | axisandbloomcoffee.com, asset id `2406778309814992` |

Neither the GA4 tag nor the Pixel base code is installed on the site — **Step 02 wires both in** via env config. Paste into the Step 02 command: GA4 id `G-GYC50VYRYN`, Pixel id `945138695260153`.

## Mailchimp

- Datacenter **us11**; audience **"Axis & Bloom"**, audience id `a5940f849b` (matches `MAILCHIMP_LIST_ID` in GCP Secret Manager, project axis-and-bloom-prod).
- Email domain `axisandbloomcoffee.com` verified (via hello@); DKIM authenticated (k2/k3 `_domainkey` CNAMEs → `dkim2/dkim3.mcsv.net`, added automatically by Entri into Namecheap).
- Default from: **Axis & Bloom <hello@axisandbloomcoffee.com>** (hello@ and dana@ forward to Dana's Gmail via Namecheap Private Email).
- Footer mailing address set (LLC address, Union City NJ) — CAN-SPAM requirement done.
- **Prod sync verified 2026-07-17** end-to-end: homepage newsletter signup → backend → Mailchimp audience (test contact `danabar.mail+mailchimptest@gmail.com`, safe to archive). `test-mailchimp.mjs` not needed.

## DNS (Namecheap BasicDNS — Advanced DNS tab)

- Pre-existing, do not touch: TXT `v=spf1 include:amazonses.com ~all` (Resend), TXT `hosting-site=axis-and-bloom-prod`.
- Added by Entri (Mailchimp DKIM): CNAMEs `k2._domainkey`, `k3._domainkey`.
- TXT at host `@`: `facebook-domain-verification=rs1ltv26wyfqr0nuhob59r7tpnxnsd` — added 2026-07-17, domain **Verified** in Meta.

## People & access

- Camila (camilamarchon@gmail.com) invited to the Meta portfolio as full-access admin — invite expires ~2026-08-16. After accepting she should create the **Facebook Page from inside Business settings** (portfolio-owned) and connect the Instagram account.
- GA4 access: only Dana so far (add Camila later if she'll read reports directly; Looker Studio dashboard is the plan of record).

## Stripe (Commerce 1, added 2026-10-31)

Brief: `backend/src/features/commerce/CLAUDE_CODE_PROMPT_COMMERCE_1_CHECKOUT.md` (Task 0.5). **Test mode only** through Commerce briefs 1–3; live keys only in brief 4, with Dana in the session. No `STRIPE_*` value is ever written into the repo, this file included. Record only that the value exists and where it lives.

| # | Step | Owner | Status |
|---|---|---|---|
| 1 | Stripe Dashboard, **test mode**: Developers → API keys → copy `pk_test_…` and `sk_test_…` | Dana | ⏳ |
| 2 | Developers → Webhooks: endpoint `https://axis-bloom-backend-oiub7eumya-uc.a.run.app/api/webhooks/stripe`, events `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `payment_intent.payment_failed`; copy `whsec_…`. Sandbox endpoint `we_1UWaPO0QYxZQN6jDi2Y9lp6q`, API version `2026-09-30.endive` | CTO session | ✅ 2026-10-31 |
| 3 | Settings → Tax: Stripe Tax enabled, origin Union City NJ, NJ registration; preset product category "Coffee Beans or Ground Coffee" (`txcd_41050006`). Head-office address waits for live activation | CTO session | ✅ 2026-10-31 (product category only) |
| 4 | Settings → Emails: Stripe successful-payment receipts **off** (ours go through Resend) | CTO session | ✅ 2026-10-31 |
| 4b | Settings → Public details: statement descriptor `AXIS & BLOOM COFFEE`, support email `dana@axisandbloomcoffee.com`, bank account | Dana | ⏸ live-account settings, deferred to brief 4 |
| 5 | Settings → Branding: brand colors from `misc/design_documents` (styles Embedded Checkout); no logo yet | CTO session | ✅ 2026-10-31 (colors only) |
| 6a | GCP Secret Manager (`axis-and-bloom-prod`): create `STRIPE_SECRET_KEY` (the `sk_test_…`) and `STRIPE_WEBHOOK_SECRET` (the `whsec_…`) | Dana | ⏳ (not present at 2026-10-31 07:35) |
| 6b | Add both to `deploy.yml --set-secrets` | Claude Code, Part F | ⏳ |
| 6c | Frontend build env `VITE_STRIPE_PUBLISHABLE_KEY` (the `pk_test_…`; publishable, safe in the build) | Dana gives the value; Claude Code wires it into `deploy.yml` | ⏳ |

Secret Manager (PowerShell, in your own terminal; you paste the value at the prompt, so it never sits in shell history). It writes through a temp file with no trailing newline, because piping a PowerShell 5.1 string adds a CRLF that would corrupt the key:
```
$f="$env:TEMP\s.txt"; [IO.File]::WriteAllText($f,(Read-Host "sk_test value")); gcloud secrets create STRIPE_SECRET_KEY --project axis-and-bloom-prod --data-file=$f; Remove-Item $f
$f="$env:TEMP\s.txt"; [IO.File]::WriteAllText($f,(Read-Host "whsec value"));   gcloud secrets create STRIPE_WEBHOOK_SECRET --project axis-and-bloom-prod --data-file=$f; Remove-Item $f
```
(Or create them in the Console: Secret Manager → Create secret.)
The Cloud Run runtime service account needs `roles/secretmanager.secretAccessor` on both. It already has it project-wide if the other secrets resolve; that gets checked before the deploy that adds them.

Mode (test/live) is derived from the key prefix at boot and logged once as `[stripe] mode=test|live|disabled`. Without `STRIPE_SECRET_KEY`, checkout answers 503 `checkout_unavailable` and the cart shows the "not live yet" copy.

## Open before ads warm-up (~Aug 3)

1. ~~Meta domain verification~~ ✅ done 2026-07-17.
2. Ad account payment method (Dana, in Billing & payments).
3. Facebook Page created + Instagram connected (Camila, post-invite).
