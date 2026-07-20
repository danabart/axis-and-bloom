# Feedback Loop (workstream: feedback-loop)

The post-purchase loop that makes the Right Match Promise real: Liam asks (email first,
SMS later), the customer answers, the taste memory learns, a wrong match triggers the
Promise. Brand RTB #2 — "Personal Taste Memory & Feedback Loop".

## Tasks

| # | Task | Owner | When | Status |
|---|---|---|---|---|
| 09 (Phase 1) | `09_F1_feedback_loop.md` — email ask + tokenized form + taste memory + Promise flow + `v_feedback_weekly` | Claude Code (Opus/Fable) | early Oct, after 08 stabilizes | ⬜ |
| 09 (Phase 2) | SMS from Liam | Claude Code | after Twilio infra (OT-2/3/4) + TCPA checkout consent | ⬜ blocked |
| M-promise | Promise wording + replacement cap finalized at the Aug 8 pricing workshop | Dana + Camila | Aug 8 | ⬜ |

Reuses (never reinvents): `user_feedback_event`, `user_vector_state`, `notification_log`,
lifecycle stages, Resend, the OT-13 cron pattern.

Phase 2 preconditions from OPEN_TASKS: OT-2 (Cloud Scheduler job), OT-3 (phone number UI),
OT-4 (Twilio wiring) + an unticked SMS-consent checkbox at checkout with stored timestamp.

## Run command

**Step 09** — model: Opus/Fable — October
```
Read launch/README.md for context and rules, then execute the prompt in launch/70_feedback-loop/09_F1_feedback_loop.md exactly as written (Phase 1 only — Phase 2 SMS is blocked on Twilio + consent). Do only this step. Before writing code, locate and explain the existing vector-update, lifecycle, and cron mechanisms you will reuse. When done, show me how each ACCEPTANCE criterion is met.
```

## Post-deploy verification

- [ ] Simulate an order shipped 9 days ago → run the job → exactly ONE email arrives, from Liam, working token link
- [ ] Token link opens the form with the right coffee, no login required
- [ ] Positive path → row in user_feedback_event; declared vector updated; lifecycle stage moved
- [ ] Negative path → promise-redemption record (capped 1/customer), visible to admin
- [ ] Re-run the job → zero new sends (notification_log dedupe)
- [ ] `SELECT * FROM v_feedback_weekly;` as reporting_ro works; Looker card added
- [ ] Standing trio (`../REGRESSION.md`)

**Phase 2 (when built):** consented customer gets ONE SMS (not SMS + email); non-consented
gets email only; STOP works; no marketing SMS without a stored consent timestamp.
