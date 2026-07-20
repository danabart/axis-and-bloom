# Step 04 (A2) — FIRM email gate on quiz results (lifecycle-aware)

> Global step 04 of 11 · Workstream: quiz-and-archetypes · Model: **Opus/Fable** (cross-cutting: quiz flow + lifecycle + subscribe endpoint) · Depends on: Step 02.
> GATE DECISION REVISED (Dana + Camila, 2026-07-18): **firm gate** — supersedes the July 16 "soft gate" decision everywhere it appears (older docs in `_source-plans/` still say soft; this file wins). The filename keeps "soft_gate" for reference stability; the spec below is the firm gate.

CONTEXT: Axis & Bloom quiz results screen (FlavorQuiz.tsx, "gift-unwrap reveal", CAMILAS #43): Section 1 = curtain reveal of archetype + bag + name; Section 2 = "Why this matches you"; Section 3 = "Coffees selected for you"; Section 4 = closing CTA. Results are currently fully open with only a "sign in to save" nudge. DECISION (revised 2026-07-18): **FIRM GATE** — Section 1 (the archetype reveal: name, wallpaper, bag) stays completely free as the generous identity moment, but Sections 2–3 (the why, the matched coffees) unlock ONLY after an email is submitted. **There is NO skip link and no free path to Sections 2–3 for a first-time guest.** The email list is the one asset the business owns; the reveal is the gift, the substance is the trade. The ask must still FEEL calm — one card, one field, no countdown, no nagging — firm, not loud. Existing endpoint: POST /api/newsletter/subscribe {email, firstName?, source?} (newsletter.ts; upserts newsletter_subscriber then non-blocking Mailchimp sync). A 'post_quiz' source already exists in subscriber_source. An analytics utility with trackEvent() and POST /api/quiz/event exist (Step 02).

TASK:

1. Keep Section 1 (archetype reveal) completely free — the identity moment.
2. Before Sections 2–3, insert a calm inline email card:
   headline: "Where should we send your match?"
   sub: "The full why, your matched coffees, and your archetype card — plus first access October 1."
   One email field + one button. **NO skip link — Sections 2–3 are unreachable for a
   first-time guest without submitting an email** (firm gate). Keep the card calm and
   singular: it appears once, in place, does not follow the user, does not pop up, does
   not repeat-ask on scroll. Firmness comes from the absence of a bypass, not from
   pressure in the UI.
3. LIFECYCLE AWARENESS (the system tracks user_lifecycle_state / user_lifecycle_stage — QUIZ_TAKEN_*, SUBSCRIBER, etc. — and the brand behavior is "Remember, Never Reset"):
   a. Signed-in users never see the card (email known): auto-subscribe them with source 'post_quiz' after showing one-line consent copy once — unless they are already a newsletter subscriber, in which case just silently update their archetype fields (no card, no consent repeat).
   b. Signed-in users: on quiz completion, update the user's lifecycle stage through the existing lifecycle mechanism (QUIZ_TAKEN_* states) — reuse whatever service/trigger the homepage lifecycle logic reads from; do not invent a parallel mechanism.
   c. Guests who already submitted an email on a previous quiz run in this browser (persist a local flag + their archetype on submit): don't ask again — show a quiet "your match is on its way to <masked email>" line instead, and update their subscriber row via the same endpoint.
4. Extend POST /api/newsletter/subscribe to accept and persist: { email, firstName?, source, archetype?, experimental?, confidence?, quizSessionKey? }. Store the extras on newsletter_subscriber (add nullable columns archetype, experimental, confidence, quiz_session_key via migration) — Mailchimp mapping comes in Step 05; just make sure the data reaches this endpoint now.
5. On successful submit: fire the EmailSubmitted analytics event with the archetype, call POST /api/quiz/event ('email_submitted'), then reveal Sections 2–3 with the existing reveal animation. **The on-screen unlock is immediate — do not make the user wait for or depend on the email.** (Separately, Email #1 of the Mailchimp journey delivers the DETAILED why + a Bloom Dial personalization invitation + the first-access/pre-order CTA — that email's content is owned by `launch/40_email-marketing/`, not this step; this step only guarantees the data reaches the subscribe endpoint so the journey can fire.)

CONSTRAINTS: new UI components (email capture card and any shared pieces) follow the existing frontend structure (frontend/src/app/components); new backend logic goes in backend/src/features/marketing/. Reuse the existing newsletter endpoint and NewsletterModal styling patterns — do NOT create a second subscribe code path. Match the results screen's existing visual system exactly. No countdown/urgency elements. Do not modify homepage widgets, but DO reuse the same lifecycle mechanism they read from.

ACCEPTANCE: guest flow — quiz → free reveal (Section 1) → email card → submit → Sections 2–3 unlock immediately on screen → row in newsletter_subscriber with archetype + source post_quiz → events logged; **demonstrate there is NO path to Sections 2–3 for a first-time guest without submitting an email (no skip link, no URL trick, no scroll-past)**; signed-in flow shows no card and lifecycle stage updates; repeat guest is recognized and not re-asked (their sections unlock automatically since their email is known).
