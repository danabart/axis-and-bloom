# Step 10 (D6) — Gift the Quiz, digital-only ⚠ PLACEHOLDER — scope mid-August, build October

> Global step 10 of 11 · Workstream: gifting · Model: **Opus/Fable** · Depends on: Step 08 (working checkout) · Live: Nov 1 · Decision: ALL gifting is digital (e-card by email; no printed/physical gift products).

## Why this is a placeholder

Requires working payments (Step 08) and a scoping pass (week of Aug 10–16) against the existing Company Gift system. Write the final prompt then.

## Scope the final prompt must cover

1. **Reuse the Company Gift (B2B) infrastructure** — code generation/validation (company_gift_code patterns), the redemption widget, lookup/redeem API patterns. Do NOT build a parallel code system; extend for consumer gifts.
2. Consumer purchase flow: gift SKUs in checkout (single bag / trio / 3-month tiers — prices from the Aug 8 workshop).
3. Gift e-card email to the recipient (designed, archetype-branded, via the existing email infrastructure) with **schedulable delivery** ("send it Dec 24 morning") — this enables the Dec 19–24 "too late to ship, right on time to match" window, the most margin-friendly week of Q4.
4. Redemption flow: code → quiz → recipient enters their own shipping address → matched order created for them. Greet gift recipients beautifully — their first experience IS the quiz.
5. Analytics: gift_purchased / gift_redeemed events; subscriber creation for the recipient (source: gift) feeding the existing Mailchimp sync.
6. Gift recipients enter the feedback loop (Step 09) like any customer — their taste memory starts on bag one.

## Standing constraints

Reuse redemption widget + code infra; digital only — no physical card branch; brand: gift-led, never discount-led (BFCM stance).
