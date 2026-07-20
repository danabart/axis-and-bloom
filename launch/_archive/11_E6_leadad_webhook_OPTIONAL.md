# Step 11 (E6) — Meta lead-ad mini-quiz webhook ⚠ OPTIONAL — only if cost/subscriber > $4 in September

> Order: 11 of 11 · Model: Opus · Depends on: Step 05 (Mailchimp tags) + manual Meta setup (Facebook App, page token, webhook subscription) · Decision rule: skip entirely if click-to-site ads hit the $2–4 cost-per-subscriber target.

CONTEXT: Fallback acquisition path — a 3-question taste mini-quiz running natively inside Instagram/Facebook lead ads (instant forms with custom multiple-choice questions). Email captured in-app by Meta; the archetype result is delivered by email ("your match is on its way to your inbox") because instant forms can't compute results on-screen.

TASK (draft — refine before running):

1. Backend endpoint receiving Meta's leadgen webhook (backend/src/features/marketing/): verify the webhook signature, fetch the lead via the Graph API (page token from Secret Manager), parse email + the 3 mini-quiz answers.
2. Map the 3 answers to one of the 5 canon archetypes — derive the mapping from the existing V7 scoring matrix (a reduced 3-question weight table; document the mapping); fallback: Balanced & Sweet.
3. Upsert to newsletter_subscriber (source: 'lead_ad') and to Mailchimp with tags quiz-completed + archetype:<name> — reuse Step 05's sync module; the existing welcome journey then fires. Email #1 subject variant for this source: the match delivered in the email itself.
4. Log quiz_funnel_event rows (quiz_complete + email_submitted, session_key = lead id) so the dashboard counts these subscribers.
5. Idempotency on lead id (Meta retries webhooks); never double-subscribe.

ACCEPTANCE: Meta's webhook test lead flows end-to-end: webhook → archetype mapped → subscriber row → Mailchimp tags → journey fires.
