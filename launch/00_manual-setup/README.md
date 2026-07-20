# Manual Setup — accounts, IDs, DNS (workstream: manual-setup)

**Status: the pre-Step-02 block is DONE (2026-07-17).** Every ID, account, and DNS record
is recorded in `MANUAL_SETUP_IDS.md` in this folder — that file is the reference the
Claude Code steps (especially Step 02) read from. All accounts live under
danabar.mail@gmail.com.

## Done ✅

- GA4 property + web stream — Measurement ID `G-GYC50VYRYN`
- Meta business portfolio + ad account + Pixel dataset — Pixel `945138695260153`
- Meta domain verification for axisandbloomcoffee.com (DNS TXT via Namecheap) — Verified
- Mailchimp (us11, audience `a5940f849b`): domain verified, DKIM authenticated,
  default from `hello@axisandbloomcoffee.com`, CAN-SPAM footer address set
- Prod Mailchimp sync verified end-to-end via a live homepage signup
- Camila invited to the Meta portfolio as full admin (invite expires ~2026-08-16)

Note: neither the GA4 tag nor the Pixel is installed on the site yet — **Step 02 wires
both in** (IDs above are baked into its run command).

## Still open — needed before ad warm-up (~Aug 3), does NOT block Steps 01–07

| Task | Owner | Deadline |
|---|---|---|
| Ad-account payment method (Billing & payments) | Dana | before Aug 3 |
| Accept Meta admin invite (expires ~Aug 16) | Camila | ASAP |
| Create Facebook Page **inside Business settings** (portfolio-owned) + connect Instagram | Camila | before Aug 3 |
| Archive the Mailchimp test contact (`danabar.mail+mailchimptest@gmail.com`) | Dana | anytime |
| (Optional) grant Camila GA4 access — Looker dashboard is the plan of record, so only if she wants raw GA4 | Dana | optional |
