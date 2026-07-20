# Step 09 (F1) — Post-purchase feedback loop (Liam asks, taste memory learns)

> Order: 9 of 11 · Model: **Opus/Fable** (touches taste vectors, lifecycle, scheduling, the Promise) · Depends on: Step 08 (orders must exist) · Build: early October, launch-critical — the Right Match Promise is meaningless without it. Phase 2 (SMS) additionally depends on Twilio infra (OPEN_TASKS OT-2/3/4) + checkout SMS consent.

CONTEXT: Axis & Bloom's Brand Plate RTB #2 is the "Personal Taste Memory & Feedback Loop": customers rate coffees post-purchase and their taste vector evolves. The launch offer, the Right Match Promise ("if your first match isn't right, tell us what felt off and the next bag is on us — and your profile gets smarter"), requires exactly this mechanism. Infrastructure that ALREADY EXISTS and must be reused, not reinvented: `user_feedback_event` (feedback audit), `user_vector_state` (declared + behavioral taste vectors), `user_recommendation_log`, `notification_log` (emails/SMS sent), the user lifecycle system (user_lifecycle_state / stages), transactional email via Resend (noreply@axisandbloomcoffee.com), and the Cloud Scheduler + cron pattern used for Company Gift lifecycle (OT-13). Liam is the brand's assistant persona — asks come "from Liam" in a calm, personal voice. Brand behavior: Remember, Never Reset.

## PHASE 1 — email ask + feedback form (build now)

1. **Feedback form page** (frontend, existing structure): reached via a tokenized link — no login required; the token resolves to (user, order, line item/coffee). Content, in brand voice: (a) the core question — "Was this the right match?" (simple positive/negative with a middle option); (b) if not right: "what felt off" chips mapped to the flavor dimensions (too bitter / too acidic / too heavy / too light / too roasty / other) — these map onto the existing sensory coordinate system; (c) optional free text. Calm, short, no survey-monster.
2. **Persist + learn:** submission writes `user_feedback_event` tied to the order/coffee/archetype, and feeds the declared side of `user_vector_state` through the EXISTING vector update mechanism — find it and reuse it; do not invent a parallel taste-memory path.
3. **The ask (email):** a scheduled job (reuse the Cloud Scheduler/cron pattern) finds orders shipped ~8–10 days ago with no feedback ask yet → sends a Resend email — from Liam, one question, one button ("How was the [coffee name]? — Liam"). Log every send in `notification_log`; never ask twice for the same order; cap at one open ask per customer at a time.
4. **Right Match Promise path:** a "not right" answer flows into the promise: "Tell us what felt off — your next bag is on us, and your profile gets smarter." Creates a promise-redemption record (enforce the cap: one replacement per customer per first order — wording per the Aug 8 workshop), flags it for admin visibility, and applies the feedback to the profile so the replacement match is actually better.
5. **Lifecycle:** feedback submission updates the customer's lifecycle stage through the existing lifecycle mechanism.
6. **Measurement:** fire a feedback_submitted analytics event; add a `v_feedback_weekly` reporting view (ask→response rate, % right-match, promise redemptions) readable by reporting_ro, so it lands on the Looker dashboard.

## PHASE 2 — SMS from Liam (only after Twilio OT-2/3/4 is done)

7. **Consent first (TCPA):** an unticked checkbox at checkout ("Text me about my match — from Liam, our coffee guide"), stored with a timestamp. No consent → email only, silently. STOP handling via Twilio's built-ins.
8. **The SMS ask:** same trigger and dedupe as the email path, one short message from Liam with the tokenized form link. Email becomes the fallback, not a duplicate — one channel per ask.

HARD BOUNDARIES: reuse user_feedback_event / user_vector_state / notification_log / the lifecycle mechanism / the cron pattern — creating parallel versions of any of these means the task failed. Backend logic in backend/src/features/marketing/; frontend per existing structure; no homepage modifications; no marketing SMS to anyone without stored consent.

ACCEPTANCE: simulate an order shipped 9 days ago → the job sends exactly one email → token link opens the form without login → positive path writes user_feedback_event + updates the taste vector + lifecycle; negative path additionally creates a capped promise-redemption record visible to admin; re-running the job sends nothing (dedupe); v_feedback_weekly returns the numbers.
