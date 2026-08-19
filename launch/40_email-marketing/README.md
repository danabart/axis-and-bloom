# Email Marketing (workstream: email-marketing)

The subscriber pipeline: archetype-tagged Mailchimp sync, the five welcome emails, and the
Customer Journey. **The July pipeline's finish line: a live quiz run ends with Email #1
arriving within minutes, carrying the right archetype.**

## Tasks

| Global step | File / task | What | Owner | Depends on | Status |
|---|---|---|---|---|---|
| 05 | `05_C1_mailchimp_sync_upgrade.md` | Tags + ARCHETYPE merge field + backfill script | Claude Code (Sonnet) | Step 04 | ⬜ |
| M1 | manual | Draft the 5 welcome emails — Dana + Claude write v1, Camila edits for voice. **Email #1 spec (Dana, 2026-07-18):** "You're [Archetype]. Here's why." carrying (a) the DETAILED why-this-matches explanation (deeper than the on-screen version), (b) an invitation to personalize the match with the **Bloom Dial** (link to /bloom), (c) the order CTA — starts as "first access October 1" and **upgrades to a real pre-order button once Stripe checkout (step 12) is live in September**; nothing is purchasable before that, so no buy-links earlier | Dana → Camila | Step 05 (tags exist) | ⬜ |
| M2 | manual | Build the Mailchimp Customer Journey — trigger: tag `quiz-completed`; cadence instant / day 2 / 5 / 9 / 14 → run one live quiz end-to-end → then run the backfill for real | Dana + Camila | M1 | ⬜ |
| M-warmup | manual | Deliverability: DKIM/SPF ✅ done 7/17; keep sends low-volume before Aug (warm the domain gradually) | Dana | — | partly ✅ |
| 07 (C3) | `07_C3_resend_quiz_complete_email.md` | Quiz-complete email moves off the Mailchimp journey to a direct transactional send from the backend (Resend), at-most-once per (email, template) via a new `transactional_email_log` table | Claude Code (Sonnet) | Step 05 | code ✅ 2026-08-18 — manual send/placement check ⬜ |

Mailchimp facts (from `../00_manual-setup/MANUAL_SETUP_IDS.md`): us11 · audience `a5940f849b` ·
from `hello@axisandbloomcoffee.com` · footer address set · prod sync verified 2026-07-17.

## Voice rules for the welcome emails (from the brand docs)

Calm, no exclamation points, no jargon, no variety-framing; guide, don't push; state
deadlines once as plain facts — **no countdown timers or "last chance" repetition**.
Every email ladders to one of the four pillars; the archetype identity moment leads,
system depth is offered, never imposed. Source: Brand Plate v3.0, Brand Values &
Behavior v1.0, and the Marketing Plan Companion §1 watch-points
(`misc/Brand Strategy & Visual Foundations Brief/`, `backend/marketing/Marketing_Plan_Companion.docx`).

## Run command

**Step 05** — model: Sonnet
```
Read launch/README.md for context and rules, then execute the prompt in launch/40_email-marketing/05_C1_mailchimp_sync_upgrade.md exactly as written. Do only this step. When done, show me how each ACCEPTANCE criterion is met, and give me the exact command to run the backfill dry-run.
```

## Post-deploy verification

**Step 05 — Mailchimp sync upgrade**
- [ ] Fresh quiz signup → contact has tags `quiz-completed`, `archetype:<name>`, `source:post_quiz` + ARCHETYPE merge field filled
- [ ] Backfill `--dry-run` lists existing subscribers correctly → real run → spot-check 3 old contacts now tagged
- [ ] Break test (staging/local): wrong MC key → signup STILL succeeds (non-blocking), error logged
- [ ] Standing trio (`../REGRESSION.md`)

**M2 — journey live (manual)**
- [ ] One live quiz → Email #1 arrives within minutes with the right archetype → July pipeline done

**Step 07 (C3) — quiz-complete email on Resend**
- [x] Fresh quiz signup → correct archetype variant (card image, word set, why + promise), headline with name, footer clean — verified locally by rendering all six variants + fallback + no-first-name case and grepping for `*|` remnants (zero) and banned words (zero); `tsc --noEmit` clean
- [x] Same address completes the quiz again → no second send — `transactional_email_log` claim (`ON CONFLICT (email, template) DO NOTHING`) gates the send before it happens; Mailchimp sync untouched, still fires every time
- [x] `RESEND_API_KEY` unset → subscribe flow unaffected — `RESEND_ENABLED` guard matches `mailchimp.ts`'s contract exactly (no-op, returns true, single debug line)
- [x] `node test-resend.mjs <key> <to-email> --all` — real send of all six variants + fallback + no-name case, 2026-08-18, key pulled live from Secret Manager (`axis-and-bloom-prod`), sent to `danabar.mail@gmail.com`. All 8 sends returned a Resend message id, zero errors, zero merge-tag-remnant warnings. Message ids in `WHAT_WE_BUILT.md` #169.
- [ ] Placement check: 3–4 fresh Gmail accounts, record Primary/Promotions in the PR description (Dana)
- [ ] After placement confirms Primary: pause the "Archetype Card — post-quiz welcome" flow in Mailchimp (don't delete — it's the fallback) (Dana)
