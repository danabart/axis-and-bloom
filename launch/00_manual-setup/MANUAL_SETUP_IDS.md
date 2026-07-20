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

## Open before ads warm-up (~Aug 3)

1. ~~Meta domain verification~~ ✅ done 2026-07-17.
2. Ad account payment method (Dana, in Billing & payments).
3. Facebook Page created + Instagram connected (Camila, post-invite).
