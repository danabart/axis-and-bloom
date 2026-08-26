# Feature: First-name field on the post-quiz email card

> Folder: `backend/src/features/pre_launch_reveal_in_inbox/` · Decided: 2026-08-12, revised 2026-08-19 (Dana) · Model: Sonnet is fine (small, contained, frontend-only change)
> Status: ✅ executed (2026-08-26) — see WHAT_WE_BUILT.md #171 (one live-testing note: anonymous Firebase sign-in 403'd locally, same App Check debug-token gap as #158 — worked around via the `?result=` preview shortcut and a real throwaway sign-up instead)
> Depends on: reveal-in-inbox (sealed ending) executed; #169 (quiz-complete email via Resend) executed.

CONTEXT — verified in code, not assumed: since #169 (2026-08-18), the quiz-complete match email is a TRANSACTIONAL Resend send from our backend (Mailchimp journeys landed in Gmail Promotions). The chain in `backend/src/routes/newsletter.ts` is already complete: the subscribe body accepts `firstName?` → `handleSubscribe(email, source, firstName, ...)` → on `source 'post_quiz'`, `sendQuizCompleteEmailOnce(email, firstName, archetype)` → `renderQuizCompleteEmail(firstName || null, archetypeSlug)`, whose template greets by first name and has a no-name fallback. Separately, the Mailchimp DATA sync (audience/tags/FNAME merge field) still runs on every signup and already maps `first_name` — it sends NO email (the Mailchimp archetype-card email flow is disabled; Resend is the only sender of the match email). Leave the sync exactly as is. **The only broken link is the frontend: the post-quiz email card collects email only, so `firstName` arrives empty and every match email falls back to the nameless greeting.** This task is frontend-only — the backend needs ZERO changes.

TASK:

1. Add a **First name** field to the post-quiz email card (`PostQuizEmailGate` / the sealed ending card), directly above the email field, matching the card's existing styling exactly. Make it **required** (trimmed, non-empty) — same enabled/disabled button logic as the email field. Label: "First name". No last-name field, no other fields.
2. Include the trimmed `firstName` in the EXISTING subscribe request body alongside the fields already sent (email, archetype, confidence, quizSessionKey, source). That is the whole data change — `handleSubscribe` already threads it into both the Resend send and the Mailchimp sync.
3. Apply the field to the shared card component in BOTH modes, not just the sealed pre-launch flow: after launch, the same card gates Sections 2–3 and the match email still greets by name. (If the sealed and post-launch flows render the card via different components, fix the shared source; do not duplicate the field in two places.)
4. Leave unchanged: the backend (all of it — routes, template, idempotency log, Mailchimp sync), the confirmation state ("It's on its way to <email>"), the recognized-returning-guest masked-email state (already submitted; do not re-ask), the signed-in auto-subscribe path (name comes from the account), all analytics events.

CONSTRAINTS: reuse the existing card and subscribe path — no new components, no new endpoints (standing rule). Copy stays positive-register. This frontend's `vite build` does not type-check — run `npx tsc --noEmit` too. Do not send to real third-party addresses; `test-resend.mjs` exists for template-level sends, and disposable marked test data + cleanup is this repo's established practice.

ACCEPTANCE (live browser on a gated dev server, not code reading):

1. Fresh guest completes a real quiz → card shows First name + Email; button stays disabled until both are filled; submitting lands a `newsletter_subscriber` row with `first_name` AND archetype AND `source post_quiz`.
2. The `sendQuizCompleteEmailOnce` call for that submit demonstrably receives the submitted first name (log line or captured call — the Resend send itself may be exercised against a controlled address per `test-resend.mjs` practice, or shown via the send path's own logging with `RESEND_ENABLED` false locally).
3. Confirmation state renders as before, addressed to the email; reload shows the masked-email returning state with no re-ask.
4. `?preview=true` (post-launch flow): the gate card before Sections 2–3 also shows and requires First name, and unlock behavior is unchanged after submit.
5. Signed-in real-account quiz completion: no card, auto-subscribe unchanged.
6. `git diff` shows no backend files touched. `vite build` AND `npx tsc --noEmit` clean.
