# Standing Regression Trio — run after EVERY deploy, no exceptions

These three checks exist because each has silently broken before. Run them on the live site
after every deploy of any step, in addition to the step's own verification checklist
(found in its workstream README).

1. **Guest quiz end-to-end** — start → answers → reveal renders correctly.
2. **Homepage widgets present** — the lifecycle-aware signed-in sections AND the Company
   Gift redemption widget (`CompanyGiftRedemption.tsx`) are still on the homepage. These
   have been silently dropped twice (2026-07-07 #73/#74, and again by the 2026-07-14/15
   home-v3 rebuild; restored via the homepage_v3_fixes prompt). Standing warning at the
   top of `CAMILAS_UPDATES.md`.
3. **Newsletter signup reaches Mailchimp** — live homepage signup → contact appears in the
   Mailchimp audience (us11, audience `a5940f849b`).

If any check fails: roll back or fix-forward the same day. Never stack the next step on a
broken one.

**Baseline note (2026-07-18):** before running Step 01, run the trio once to establish that
today's deployed site passes — especially check #2, since the home-v3 fixes were recent.
