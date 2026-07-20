# Gifting (workstream: gifting)

Consumer "Gift the Quiz" — digital-only (e-card by email, schedulable delivery; no box,
no printed product). Live Nov 1, aimed squarely at the Dec 19–24 "too late to ship, right
on time to match" window. Reuses ~60% of the Company Gift (B2B) infrastructure — codes,
redemption widget, APIs. **Gift the Quiz ≠ Company Gift**: B2B stays its own feature.

## Tasks

| # | Task | Owner | When | Status |
|---|---|---|---|---|
| M8 | Scoping pass against the existing Company Gift system → finalize the placeholder prompt | Dana + Claude | Aug 10–16 | ⬜ |
| 10 | `10_D6_gift_the_quiz_PLACEHOLDER.md` — purchase flow (gift SKUs), e-card email, redemption → quiz → recipient address → order | Claude Code (Opus/Fable) | build Oct, live Nov 1 | ⚠ placeholder |
| M-prices | Gift SKU tiers (single / trio / 3-month) priced at the Aug 8 workshop | Dana + Camila | Aug 8 | ⬜ |

Gift recipients enter the feedback loop (Step 09) like any customer, and become
subscribers (source: gift) via the existing Mailchimp sync. Brand stance: gift-led,
never discount-led (BFCM).

## Run commands (two-phase, like Step 08)

**Finalize** — model: Opus/Fable — after the Aug 10–16 scoping pass
```
Read launch/80_gifting/10_D6_gift_the_quiz_PLACEHOLDER.md and the launch plan context in launch/README.md. Scope is confirmed. Rewrite it as a complete executable prompt covering every item in its Scope section (no code yet), then wait for my go-ahead to execute in a fresh session.
```

**Execute** — model: Opus/Fable, fresh session — October
```
Read launch/README.md for context and rules, then execute the finalized prompt in launch/80_gifting/10_D6_gift_the_quiz_PLACEHOLDER.md exactly as written. Do only this step. When done, show me how each ACCEPTANCE criterion is met.
```

## Verification (after build)

- [ ] Staging gift purchase → recipient e-card email arrives, honors a scheduled delivery date
- [ ] Code redeems → quiz → recipient address → order created
- [ ] Recipient appears as subscriber (source: gift) with archetype tags
- [ ] gift_purchased / gift_redeemed events logged
- [ ] One real end-to-end gift between your own two emails before Nov 1
- [ ] Standing trio (`../REGRESSION.md`)
