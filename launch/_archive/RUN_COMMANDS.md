# Run Commands — copy-paste sequence

Open a terminal in `C:\Users\DanaB\axis-and-bloom`, run `claude`, set the model (`/model`), paste the command. **One step per session** (start a fresh session for each). After each deploy: run that step's checklist in `VERIFICATION.md` + the standing regression trio. Don't start a step until the previous one passed.

---

**STEP 01** — model: Sonnet
```
Read backend/src/features/marketing/README.md for context and rules, then execute the prompt in backend/src/features/marketing/01_A1_archetype_canon.md exactly as written. Do only this step — do not start any other numbered step. When done, show me how each ACCEPTANCE criterion is met.
```

⏸ **MANUAL before Step 02:** ✅ DONE 2026-07-17 (all IDs in `MANUAL_SETUP_IDS.md`). Remaining loose ends, none blocking Steps 02–07: Meta domain verify (TXT in Namecheap + Verify click) · ad-account payment method · Facebook Page + Instagram connect (Camila, after accepting admin invite) — all needed before ad warm-up ~Aug 3.

**STEP 02** — model: Sonnet
```
Read backend/src/features/marketing/README.md for context and rules, then execute the prompt in backend/src/features/marketing/02_B1_analytics_funnel_events.md exactly as written. Do only this step. When done, show me how each ACCEPTANCE criterion is met. My GA4 id is G-GYC50VYRYN and my Meta Pixel id is 945138695260153 — wire them into the deployment env config.
```

**STEP 03** — model: Sonnet
```
Read backend/src/features/marketing/README.md for context and rules, then execute the prompt in backend/src/features/marketing/03_B2_compliance_pack.md exactly as written. Do only this step. When done, show me how each ACCEPTANCE criterion is met.
```

**STEP 04** — model: **Opus or Fable**
```
Read backend/src/features/marketing/README.md for context and rules, then execute the prompt in backend/src/features/marketing/04_A2_quiz_soft_gate_lifecycle.md exactly as written. Do only this step. Before writing code, locate and explain the existing lifecycle mechanism you will reuse. When done, show me how each ACCEPTANCE criterion is met, including the homepage widgets still being intact.
```

**STEP 05** — model: Sonnet
```
Read backend/src/features/marketing/README.md for context and rules, then execute the prompt in backend/src/features/marketing/05_C1_mailchimp_sync_upgrade.md exactly as written. Do only this step. When done, show me how each ACCEPTANCE criterion is met, and give me the exact command to run the backfill dry-run.
```

⏸ **MANUAL after Step 05:** draft the five welcome emails (with Claude in Cowork; Camila edits) → build the Mailchimp Customer Journey (trigger: tag `quiz-completed`; instant / day 2 / 5 / 9 / 14) → run one live quiz end-to-end → **Email #1 arrives = July pipeline done.** Then run the backfill for real.

**STEP 06** — model: **Opus or Fable**
```
Read backend/src/features/marketing/README.md for context and rules, then execute the prompt in backend/src/features/marketing/06_B3_reporting_views_admin_links.md exactly as written. Do only this step. When done, show me how each ACCEPTANCE criterion is met, and print the manual GCP steps I must do to connect Looker Studio.
```

⏸ **MANUAL after Step 06:** create the Ad Spend Google Sheet · assemble the Looker Studio report (Cloud SQL views + GA4 + sheet) · share with Camila · paste report URL into admin config. **Dashboard must be live before the first real ad dollar (Aug 3–9).** Aug 8: pricing workshop → set final price in the admin slot-price matrix.

**STEP 07** — model: Sonnet — *early September*
```
Read backend/src/features/marketing/README.md for context and rules, then execute the prompt in backend/src/features/marketing/07_A3_share_your_match.md exactly as written. Do only this step. When done, show me how each ACCEPTANCE criterion is met.
```

⏸ **MANUAL before Step 08:** roastery account activated (Aug 17–23) + Dana's roastery answers in hand (order API/flow, label handoff, PATH consolidation). Then FIRST finalize the placeholder:

**STEP 08a (finalize the prompt)** — model: Fable, dedicated session
```
Read backend/src/features/marketing/08_D4_shopify_integration_PLACEHOLDER.md and backend/marketing/MARKETING_DEV_PLAN.md. Here are the roastery answers: <PASTE ANSWERS: order flow, label handoff, consolidation, SLAs>. Rewrite 08 as a complete, executable prompt covering every item in its Scope section. Do not write any application code yet — only produce the finalized prompt file.
```

**STEP 08b (execute)** — model: Fable, fresh dedicated session
```
Read backend/src/features/marketing/README.md for context and rules, then execute the finalized prompt in backend/src/features/marketing/08_D4_shopify_integration_PLACEHOLDER.md exactly as written. Do only this step. This touches payments: never lose a paid order. Test in staging only — do not enable production ordering until I confirm. When done, walk me through every failure path and how each ACCEPTANCE criterion is met.
```

⏸ **MANUAL after Step 08:** staging test order → then the paid dry run (Sep 14–20): real order, real money, photograph the arriving bag.

**STEP 09** — model: Opus/Fable — *October, after launch stabilizes* (finalize placeholder first, same two-phase pattern as 08)
```
Read backend/src/features/marketing/09_D6_gift_the_quiz_PLACEHOLDER.md. Scope is confirmed. Rewrite it as a complete executable prompt (no code yet), then wait for my go-ahead to execute in a fresh session.
```

**STEP 10** — model: Opus — *ONLY if Sept cost-per-subscriber > $4; otherwise never*
```
Read backend/src/features/marketing/README.md for context and rules, then execute the prompt in backend/src/features/marketing/10_E6_leadad_webhook_OPTIONAL.md. Do only this step. When done, show me how each ACCEPTANCE criterion is met using Meta's webhook test tool.
```
