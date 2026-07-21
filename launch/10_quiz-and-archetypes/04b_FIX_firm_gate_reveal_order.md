# Step 04b — FIX: firm gate shipped as a hard gate (reveal order + card hierarchy + unlock)

> Workstream: quiz-and-archetypes · Model: **Opus/Fable** (same flow as step 04) · Depends on: step 04 deployed · Written 2026-07-20 after live verification found the deploy deviating from the spec. One session, read the diff before deploy.

CONTEXT: Step 04 (`04_A2_quiz_firm_gate_lifecycle.md`) specified a **firm** gate on the quiz
results screen: the archetype reveal free, the substance behind email. The deployed result
is a **hard** gate — the email card appears at the end of the quiz BEFORE the reveal, so a
guest cannot see their archetype at all without submitting an email. That is exactly the
variant the spec rejects ("Section 1 stays completely free — the identity moment"). A
typography inversion also shipped on the card.

## Fixes — three, in this order

**FIX 1 — reorder the flow (the main one).**
For a first-time guest, the end of the quiz must play out as:
1. Last answer submitted → **full Section 1 reveal renders immediately and free**: the
   curtain/gift-unwrap animation, archetype name, wallpaper, bag imagery, one-line
   description — identical to its pre-step-04 appearance. No email, no interruption.
2. **Below the reveal**, the email card renders (one field, one button, no skip link —
   the firm-gate part is correct and stays).
3. Sections 2–3 ("Why this matches you", "Coffees selected for you") are absent from the
   page until a successful email submit.

**FIX 2 — the post-submit unlock must actually show the substance.**
On successful submit, Sections 2–3 must render **immediately, in place, on the same
screen** with the existing reveal animation — the full "why this matches you" content and
the matched coffees list, exactly as they rendered before step 04 existed. Not a thank-you
message, not a "check your inbox" note, not a redirect: the sections themselves, on screen.
(Email #1 separately extends the experience via Mailchimp — not this step's concern.)
Verify this renders correctly for all three paths: fresh guest after submit, signed-in
user (sections visible with no card at all), returning guest (sections visible with the
"your match is on its way to <masked email>" line instead of the card).

**FIX 3 — card typography is inverted.**
The HEADLINE (large) is: "Where should we send your match?"
The SUPPORTING line (smaller, beneath it) is: "The full why, your matched coffees, and
your archetype card — plus first access October 1."
Currently the supporting line renders as the huge heading and the headline as a small
eyebrow. Swap them to match the spec.

## Hard boundaries

- Do ONLY these three fixes. No other changes to the results screen, quiz flow, subscribe
  endpoint, lifecycle logic, or analytics events — all of that stays as step 04 built it.
- The firm-gate rule itself is correct and must remain: NO skip link, no bypass to
  Sections 2–3 for a first-time guest without an email.
- Do not modify the homepage's lifecycle personalization or Company Gift redemption
  widgets (standing warning in CAMILAS_UPDATES.md).

## ACCEPTANCE — demonstrate each before finishing

1. Fresh incognito guest: quiz → **full archetype reveal visible WITHOUT entering an
   email** → email card below it with correct text hierarchy and no skip link.
2. Submit a valid email → Sections 2–3 (full why + matched coffees) appear immediately
   on the same screen; row lands in newsletter_subscriber (archetype, source post_quiz);
   EmailSubmitted + quiz_funnel_event fire.
3. Still no path to Sections 2–3 without an email for a first-time guest (no skip, no
   URL trick, no scroll-past).
4. Signed-in user: no card; reveal + Sections 2–3 all visible; lifecycle stage updates.
5. Returning guest (same browser, after a prior submit): no card; masked-email line;
   sections visible.
6. Homepage lifecycle sections + Company Gift redemption widget intact; standing trio
   (`../REGRESSION.md`).
