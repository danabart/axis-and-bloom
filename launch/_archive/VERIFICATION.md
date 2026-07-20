# Post-Deploy Verification — what each step creates & how to confirm it worked

Three layers of testing on every step:

1. **In-session (before deploy):** each prompt's ACCEPTANCE section — Claude Code must demonstrate it before you accept the diff.
2. **Post-deploy smoke test (after deploy):** the per-step checklist below — 5–10 minutes on the live site.
3. **Standing regression trio — run after EVERY deploy, no exceptions:**
   - Quiz end-to-end as a guest (start → answers → reveal renders correctly)
   - Homepage still shows the lifecycle-aware sections AND the Company Gift redemption widget (these have been silently dropped twice before)
   - Newsletter signup on the live site → contact appears in Mailchimp

If any check fails: roll back or fix-forward the same day; don't stack the next step on a broken one.

---

## Step 01 — Archetype canon

**Created/changed:** frontend archetype taxonomy reduced to 5 (enumerations, counts, pickers, copy); Spicy & Earthy merged into Earthy; **Experimental visuals and logic UNCHANGED** (kept as-is per Dana's scope refinement — only its classification changed to category); no backend or DB changes.

**Verify after deploy:**
- [ ] Run quiz with answers that previously produced "Spicy & Earthy" → result shows **Earthy** with its world/wallpaper/bag
- [ ] Run quiz hitting the experimental gate (Q3-C) → renders **exactly as before** (same wallpaper/bag/experience — nothing visually removed)
- [ ] No enumeration/list/picker/count anywhere shows Experimental as a 6th archetype; no copy says "six archetypes"
- [ ] Standing regression trio

## Step 02 — Analytics + funnel events

**Created/changed:** analytics utility in the existing frontend structure (e.g. app/lib); event handler in `backend/src/features/marketing/`; DB table `quiz_funnel_event`; endpoint `POST /api/quiz/event`; PreLaunch says October 1; **two new env vars (`VITE_GA4_ID`, `VITE_META_PIXEL_ID`) — must be added to the production build config or nothing fires.**

**Verify after deploy:**
- [ ] Site shows "COMING OCTOBER 1"
- [ ] Take the quiz → GA4 Realtime/DebugView shows page_view, QuizStart, QuizComplete
- [ ] Meta Pixel Helper (Chrome extension) shows PageView + custom events on the same run
- [ ] `SELECT event, archetype, created_at FROM quiz_funnel_event ORDER BY created_at DESC LIMIT 10;` → your run's rows are there
- [ ] Local dev with env vars unset → no console errors, no network calls to google/facebook
- [ ] Standing regression trio

## Step 03 — Compliance pack

**Created/changed:** /privacy and /terms pages; consent banner component; footer links (incl. quiz layout); consent copy at email capture points.

**Verify after deploy:**
- [ ] Fresh incognito visit → banner appears once; choice is remembered on reload
- [ ] Accept → Network tab shows gtag/facebook requests
- [ ] "Essential only" (new incognito) → **zero** requests to google-analytics/facebook domains, but quiz_funnel_event rows still log
- [ ] /privacy and /terms render; linked from main footer AND the quiz layout
- [ ] Every email form shows the one-line consent copy
- [ ] Standing regression trio

## Step 04 — Soft gate (lifecycle-aware)

**Created/changed:** email capture card in `frontend/src/features/marketing/`; FlavorQuiz integration; DB migration (nullable columns `archetype`, `experimental`, `confidence`, `quiz_session_key` on `newsletter_subscriber`); extended subscribe endpoint; lifecycle stage update on quiz completion; local repeat-guest flag.

**Verify after deploy:**
- [ ] Guest: quiz → free reveal → email card → submit → "why" + coffees unlock
- [ ] `SELECT email, archetype, confidence FROM newsletter_subscriber ORDER BY created_at DESC LIMIT 5;` → your row has archetype + source post_quiz
- [ ] "Skip for now" unlocks sections without an email
- [ ] Same browser, retake quiz → no card; "your match is on its way to <masked email>" line instead
- [ ] Signed-in user: no card; lifecycle stage moved to a QUIZ_TAKEN_* state (check user_lifecycle_state)
- [ ] GA4 + quiz_funnel_event show email_submitted
- [ ] Standing regression trio — **especially the homepage widgets** (this step touches lifecycle)

## Step 05 — Mailchimp sync upgrade

**Created/changed:** sync module + backfill script in `backend/src/features/marketing/`; ARCHETYPE merge field in Mailchimp; routes/newsletter.ts thinned.

**Verify after deploy:**
- [ ] Fresh quiz signup → Mailchimp contact has tags `quiz-completed`, `archetype:<name>`, `source:post_quiz` + ARCHETYPE merge field filled
- [ ] Backfill `--dry-run` lists existing subscribers correctly → real run → spot-check 3 old contacts now tagged
- [ ] Break test (staging/local): wrong MC key → signup STILL succeeds (non-blocking), error logged
- [ ] Standing regression trio

**Then (manual):** build the Customer Journey on tag `quiz-completed` → run one live quiz → **Email #1 arrives within minutes with the right archetype**. That email arriving is the July pipeline's finish line.

## Step 06 — Reporting views + admin links

**Created/changed:** 4 SQL views (`v_subscribers_weekly`, `v_quiz_funnel_weekly`, `v_archetype_distribution`, `v_orders_weekly`); Postgres role `reporting_ro`; /admin "Marketing" links row; infra doc for the Looker connection.

**Verify after deploy:**
- [ ] `psql` as reporting_ro: SELECT on all 4 views works; `SELECT * FROM newsletter_subscriber` is **denied**
- [ ] View numbers sanity-match reality (subscriber count ≈ Mailchimp audience size)
- [ ] /admin shows the Marketing row; cupping cards still present below and correct
- [ ] Standing regression trio

**Then (manual):** assemble Looker Studio → the five cards + archetype distribution + growth line render real numbers; Camila can open it from her account.

## Step 07 — Share-your-match

**Created/changed:** 5 public share pages (/match/<slug>) + 5 OG images (1200×630); share row on results screen.

**Verify after deploy:**
- [ ] Paste each of the 5 links into WhatsApp or iMessage → image + title unfurl correctly
- [ ] Share button: native sheet on mobile, copy-link on desktop
- [ ] share_match event appears in GA4
- [ ] Share pages contain no personal data; CTA leads into the quiz
- [ ] Standing regression trio

## Step 08 — Shopify integration (after finalization)

**Created/changed:** real `createOrder()` with per-roastery routing; failed-order queue + admin visibility; alert emails; Purchase event live.

**Verify after deploy (staging first, then production):**
- [ ] Staging test order reaches the roastery sandbox with correct items, address, label data
- [ ] Mixed-roastery order → two fulfillment orders created correctly
- [ ] Simulated failure (bad SKU / roastery API down) → order lands in the failed queue, admin alert email arrives, customer payment state stays consistent
- [ ] Purchase event fires in GA4 + Pixel
- [ ] **The real test: the Sep 14–20 paid dry run** — order with real money → bag arrives at a real door, correctly labeled → photograph it
- [ ] Standing regression trio

## Step 09 — Feedback loop (Phase 1)

**Created/changed:** tokenized feedback form page; scheduled ask job (email from Liam via Resend); writes to `user_feedback_event` + `user_vector_state` + `notification_log`; Right Match Promise redemption records; lifecycle update; `v_feedback_weekly` view; feedback_submitted event.

**Verify after deploy:**
- [ ] Simulate an order shipped 9 days ago → run the job → exactly ONE email arrives, from Liam, with a working token link
- [ ] Token link opens the form with the right coffee, no login required
- [ ] Positive path → row in user_feedback_event; user_vector_state declared side updated; lifecycle stage moved
- [ ] Negative path → promise-redemption record created (capped at one per customer), visible to admin
- [ ] Re-run the job → zero new sends (notification_log dedupe)
- [ ] `SELECT * FROM v_feedback_weekly;` as reporting_ro works; Looker card added
- [ ] Standing regression trio

**Phase 2 (SMS), when built:** consented customer gets ONE SMS (not SMS + email); non-consented gets email only; STOP works; no marketing SMS to anyone without a stored consent timestamp.

## Step 10 — Gift the Quiz (after build)

**Verify:** staging gift purchase → recipient e-card email arrives (and honors a scheduled delivery date) → code redeems → quiz → recipient address → order created → recipient appears as subscriber (source: gift) with archetype tags → gift_purchased/gift_redeemed events logged. Then one real end-to-end gift between your own two emails before Nov 1.

## Step 11 — Lead-ad webhook (if ever built)

**Verify:** Meta's webhook test tool → lead flows end-to-end (webhook → archetype mapped → subscriber row → Mailchimp tags → journey fires); duplicate delivery of the same lead id does NOT double-subscribe; dashboard counts the subscriber under source lead_ad.
