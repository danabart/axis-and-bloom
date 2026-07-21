# Step 04c — COPY: email-gate card sub-line + CTA button text

> Workstream: quiz-and-archetypes · Model: Sonnet · Depends on: 04b deployed · Written 2026-07-20 (copy approved by Dana). Pure text change — one session, tiny diff.

CONTEXT: The quiz-results email gate card (built in steps 04/04b) currently reads:
- Headline: "Where should we send your match?" — KEEP EXACTLY AS IS.
- Sub-line: "The full why, your matched coffees, and your archetype card — plus first access October 1." — REPLACE.
- Button: "SHOW MY MATCH" — REPLACE (it's inaccurate: the match/archetype is already revealed above the card; the button unlocks the why + coffees).

TASK — exactly two string changes on the gate card:

1. Sub-line becomes, verbatim:
   "See why this is you — and meet the coffees chosen for your taste. First access when doors open October 1."
2. Button label becomes, verbatim:
   "SHOW ME WHY"
   (match the site's existing button letter-casing convention — if buttons render uppercase via CSS, just supply "Show me why" and let the style handle it).

HARD BOUNDARIES:
- Change ONLY these two strings. No layout, spacing, logic, validation, analytics, or
  flow changes. The headline, the email field placeholder, and all gate behavior
  (firm gate, no skip link, immediate on-screen unlock) stay exactly as deployed.
- If the same sub-line/button strings are reused anywhere else (e.g. a shared constant),
  update the constant once rather than forking a second copy — but do not touch other
  card variants (the returning-guest masked-email line is unrelated; leave it).
- No homepage changes.

ACCEPTANCE:
1. Fresh incognito guest: quiz → reveal → card shows headline "Where should we send your
   match?", the new sub-line verbatim, and the "SHOW ME WHY" button.
2. Submitting still unlocks the why + coffees immediately on screen; nothing else changed.
3. Grep output showing the old strings ("The full why, your matched coffees" and
   "SHOW MY MATCH" / "Show my match") no longer exist anywhere in frontend/src.
