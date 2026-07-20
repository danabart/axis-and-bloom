# Step 02 (B1) — Launch date, GA4 + Meta Pixel, quiz funnel events

> Global step 02 of 11 · Workstream: analytics-and-tracking · Model: Sonnet · Depends on: GA4 + Pixel IDs created manually first (Business Manager + analytics.google.com).

CONTEXT: Axis & Bloom repo — React 18 + Vite SPA (Firebase Hosting), Node/Express backend (Cloud Run), Cloud SQL Postgres. There is currently ZERO analytics in the codebase. Launch moved to October 1. Marketing needs funnel measurement before paid ads start in August.

TASK:

1. PreLaunch.tsx: change "COMING SEPTEMBER 1" to "COMING OCTOBER 1".
2. Add GA4 (gtag.js) and Meta Pixel site-wide, configured via env vars VITE_GA4_ID and VITE_META_PIXEL_ID. Both must no-op cleanly when the env var is unset (dev/preview). SPA note: fire page_view/PageView on every route change via the router, not just initial load.
3. Create a small shared analytics utility exposing trackEvent(), placed per the existing frontend conventions (e.g. frontend/src/app/lib — follow the project's current structure; do NOT create a new features folder on the frontend); wire these events in both GA4 and Pixel:
   - QuizStart (user selects their first quiz answer)
   - QuizComplete (successful POST /api/quiz/score response)
   - EmailSubmitted (successful newsletter/subscribe call) — ALSO fire Meta standard "Lead" event here (ads will optimize on it)
   - Purchase: stub the call site now, activates with checkout later.
4. First-party funnel logging (source of truth; guests dominate and /api/quiz/score is public): new table quiz_funnel_event (id, session_key text, event text CHECK (event IN ('quiz_start','quiz_complete','email_submitted')), archetype text NULL, created_at timestamptz DEFAULT now()). New public endpoint POST /api/quiz/event {sessionKey, event, archetype?} with basic rate limiting — handler logic in a NEW folder backend/src/features/marketing/ (home for all new backend marketing logic across upcoming prompts; routes stay thin). Frontend generates a per-quiz-session key (crypto.randomUUID, in-memory) and calls it at the three moments above.
5. Structure the analytics utility so initialization can be gated behind a consent flag (a consent banner arrives in the next prompt).

CONSTRAINTS: no design changes; do not modify the homepage's lifecycle/Company-Gift widgets; keep everything env-driven so nothing breaks in dev.

ACCEPTANCE: with env IDs set, GA4 DebugView and Meta Pixel Helper show page views + the three custom events during a live quiz run; rows appear in quiz_funnel_event; with env IDs unset, console is clean.
