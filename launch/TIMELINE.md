# Launch Timeline & Dependency Map — Oct 1, 2026

The ordering authority. Steps NN = Claude Code prompts (run one per session, numeric order).
"Manual" = browser/GCP/Mailchimp work by Dana unless another owner is named.
Status as of 2026-07-18. ✅ done · ▶ next · ⬜ pending · ⚠ blocked/placeholder.

## July — the email pipeline

| # | When | Task | Where | Owner | Status |
|---|---|---|---|---|---|
| — | done 7/17 | GA4 + Meta + Mailchimp accounts, IDs, DKIM, domain verify | `00_manual-setup/` | Dana | ✅ |
| FIX-01 | any time, before Aug 3 | Mobile navigation menu | `05_site-readiness/` | Claude Code (Sonnet) | ▶ ready |
| IMG | after FIX-01, before Aug 3 | Site-wide image pipeline migration (bucket + registry + auto-optimization; Camila's no-deploy photo workflow) — prompt pre-exists at `backend/src/features/image_pipeline/` | `05_site-readiness/` | Claude Code | ⬜ written 7/12, not run |
| FIX-02 | after IMG, before Aug 3 | Homepage video compression + posters + lazy-loading (re-scoped: images belong to IMG) | `05_site-readiness/` | Claude Code (Sonnet) | ⬜ |
| 01 | now | Archetype canon (5 archetypes; Experimental = category) | `10_quiz-and-archetypes/` | Claude Code (Sonnet) | ▶ v2 ready, not run |
| 02 | after 01 | GA4 + Pixel wiring, funnel events, Oct 1 date | `20_analytics-and-tracking/` | Claude Code (Sonnet) | ⬜ |
| 03 | after 02 | Compliance pack (privacy/terms/consent) | `30_compliance/` | Claude Code (Sonnet) | ⬜ |
| 04 | after 02 | **Firm** email gate on quiz results (free reveal, no skip — revised 7/18), lifecycle-aware | `10_quiz-and-archetypes/` | Claude Code (Opus/Fable) | ⬜ |
| 05 | after 04 | Mailchimp sync upgrade (tags/merge fields/backfill) | `40_email-marketing/` | Claude Code (Sonnet) | ⬜ |
| M1 | after 05 | Draft 5 welcome emails (Dana+Claude → Camila edits) | `40_email-marketing/` | Dana → Camila | ⬜ |
| M2 | after M1 | Build Mailchimp Customer Journey (`quiz-completed` trigger) → live quiz → Email #1 arrives = **July pipeline done** | `40_email-marketing/` | Dana + Camila | ⬜ |

## August — ads prep, dashboard, pricing

| # | When | Task | Where | Owner | Status |
|---|---|---|---|---|---|
| 06 | early Aug | Reporting views + reporting_ro + admin links | `20_analytics-and-tracking/` | Claude Code (Opus/Fable) | ⬜ |
| M3 | after 06 | Ad Spend sheet + assemble Looker Studio report — **live before first ad dollar (Aug 3–9)** | `20_analytics-and-tracking/` | Dana (+share Camila) | ⬜ |
| M4 | before Aug 3 | Ad-account payment method | `00_manual-setup/` | Dana | ⬜ |
| M5 | before Aug 3 (invite expires ~Aug 16) | Camila accepts Meta invite → creates Facebook Page inside Business settings → connects Instagram | `50_ads-and-social/` | Camila | ⬜ |
| M6 | from ~Aug 3 | Warm-up ads $5/day, then $20–40/day two-angle A/B | `50_ads-and-social/` | Camila | ⬜ |
| M7 | ~~Aug 8 workshop~~ **PRICING DECIDED (Dana, 2026-07-24): $32 per 12oz bag.** 5lb bag priced proportionally minus a bulk discount (~15% recommended → ≈$179–185; Dana to confirm). Launch perk is ACCESS-LED, not discount-led: founding members get early Bloom Dial access + increased Liam token allotment (numbers TBD — feeds E5's founding-package placeholder). REMAINING TASK: update the admin slot-price matrix from $38 → $32 BEFORE ads start · fill Unit_Economics blue cells with $32 to sanity-check contribution | root | Dana | ⚠ price live on site still $38 |
| M8 | Aug 10–16 | Scope Gift the Quiz against Company Gift infra | `80_gifting/` | Dana | ⬜ |
| M9 | Aug 17–23 | Activate roastery Shopify account; get roastery answers (order API, label handoff, PATH consolidation, SLAs) | `60_commerce-and-fulfillment/` | Dana | ⬜ |
| 12 | Aug 17–30, before 08b | Payment capture — **Stripe on our site (decided 7/18)** — incl. OT-7 order-table migration + customer order/shipping emails; 12a finalization can run any time | `60_commerce-and-fulfillment/` | Claude Code (Fable, dedicated) | ⚠ ready to finalize |
| 08a/08b | Aug 24–Sep 6 | Finalize + execute Shopify integration — **launch blocker** | `60_commerce-and-fulfillment/` | Claude Code (Fable, dedicated) | ⚠ placeholder |
| M13 | Aug 24–30 | **Research checkpoint**: ≥300 real quiz completions vs the 35-person survey (completion rate, opt-in, archetype spread, CPS) — 3+ rows disagree → revise strategy in Sept (PLAYBOOK §4) | `_source-plans/MARKETING_PLAYBOOK.md` | Dana + Camila | ⬜ |

## September — proof and polish

| # | When | Task | Where | Owner | Status |
|---|---|---|---|---|---|
| 07 | early Sep | Share-your-match pages + OG images | `10_quiz-and-archetypes/` | Claude Code (Sonnet) | ⬜ |
| M10 | Sep | PR mailers: 20–30 seeding packages (designed bag + archetype card + note) | `50_ads-and-social/` | Camila | ⬜ |
| M11 | Sep 14–20 | Paid dry run: real order, real money, photograph the arriving bag | `60_commerce-and-fulfillment/` | Dana | ⬜ |
| 11 | ONLY if Sept cost/subscriber > $4 | Meta lead-ad mini-quiz webhook | `50_ads-and-social/` | Claude Code (Opus) | ⬜ optional |

## October — launch and learn

| # | When | Task | Where | Owner | Status |
|---|---|---|---|---|---|
| M12 | Oct 1 | Launch flip: remove `VITE_PRELAUNCH_MODE` in deploy.yml (see GAPS.md — needs a fuller launch-day checklist) | root | Dana | ⬜ |
| 09 | early Oct, after 08 stabilizes | Feedback loop Phase 1 (Liam's email ask + form + taste memory + Right Match Promise) | `70_feedback-loop/` | Claude Code (Opus/Fable) | ⬜ |
| 10 | Oct build, live Nov 1 | Gift the Quiz (digital-only) | `80_gifting/` | Claude Code (Opus/Fable) | ⚠ placeholder |

## Cross-workstream dependency chain (the short version)

```
manual-setup(done) → 02 → {03, 04} → 05 → welcome emails → journey     [July]
01 → 07 (share pages)   ·   01 → Camila's archetype-world content
FIX-01 + FIX-02 → site ready for mobile ad traffic (before Aug 3)
06 → Looker dashboard → first ad dollar (Aug 3–9)
rails decided (Stripe) → 12 (payment capture) → 08 → {09, 10, paid dry run}
Aug 8 pricing → price matrix + Right Match Promise wording + gift SKU prices
```

Two decisions gate content and code beyond their own folders: the **archetype canon (step 01)**
gates all archetype-world marketing content, and **pricing (Aug 8)** gates ads copy, gift SKUs,
and Promise wording.
