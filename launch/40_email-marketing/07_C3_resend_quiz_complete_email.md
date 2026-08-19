# Step 07 (C3) — Quiz-complete email moves to Resend (transactional send from backend)

> Workstream: email-marketing · Model: Sonnet · Depends on: Step 05 (C1) Mailchimp sync. Resend account/domain/key/secret wiring already exists (see MANUAL SETUP below) — this step is pure code. After this step: the archetype-card email is sent transactionally by our backend the moment a quiz signup lands; the Mailchimp flow gets paused manually and stays as backup.

## WHY (context for the implementer)

The quiz-complete "Your archetype card is here" email currently goes out through a Mailchimp automation flow (customer-journey id=81, trigger = contact tagged `quiz-completed`). Two problems: (1) Mailchimp marketing sends carry bulk-campaign fingerprints (rewritten tracking links, campaign headers, marketing template markup), so Gmail files the email under Promotions; (2) the tag trigger only fires on an absent→present tag transition, so repeat quiz-takers and already-tagged contacts never receive the current version — stale sends have already caused confusion. A quiz-result email is transactional by nature ("here is the thing you just asked for"), so it moves to a direct API send from the backend at the moment of quiz completion. Mailchimp keeps everything else: audience, tags, merge fields, the welcome series, the Oct 1 campaign.

## MANUAL SETUP — ALREADY DONE (verified in the Resend dashboard + DNS 2026-08-17; nothing blocks execution)

- Resend account exists; ROOT domain `axisandbloomcoffee.com` is **Verified** (added May 24, DNS verified Aug 4; region us-east-1; SPF at send.axisandbloomcoffee.com + DKIM at resend._domainkey.axisandbloomcoffee.com live in DNS). **Send from the root domain** — do NOT use the separate `send.axisandbloomcoffee.com` domain entry created Aug 17 (status Not Started, redundant; Dana may delete it in the dashboard).
- API key "axis-and-bloom" (full access, created ~May, last used early Aug) exists; `RESEND_API_KEY` is already in backend/.env AND already mapped in .github/workflows/deploy.yml (`--set-secrets ...RESEND_API_KEY=RESEND_API_KEY:latest`) — deploys since Aug 14 succeeded, so the Secret Manager secret exists. No secret wiring work needed; deploy.yml must not be touched.
- Click/open tracking: not configured in Resend (Configuration → "Enable tracking metrics" unconfigured) = OFF. Keep it that way; also do not pass any tracking options on the API call.
- DMARC exists on the root: `v=DMARC1; p=none;`.
- Interim fix while this step is unexecuted: in the Mailchimp flow email, the footer contains an invalidly nested merge tag rendering literally as `*|UPPER:<<First Name>>|*` — change it to `*|UPPER:FNAME|*` in the editor.
- AFTER this step is verified live (acceptance below): pause the "Archetype Card — post-quiz welcome" flow in Mailchimp so nobody gets the email twice. Do not delete it — it's the fallback if Resend misbehaves.

## TASK

1. New module `backend/src/features/marketing/resendEmail.ts`:
   - `RESEND_API_KEY` + `RESEND_FROM` (default `Axis & Bloom <hello@axisandbloomcoffee.com>` — the root domain is the verified one) + `RESEND_REPLY_TO` (default `hello@axisandbloomcoffee.com`) from env; export `RESEND_ENABLED = Boolean(RESEND_API_KEY)`.
   - Plain `fetch` POST to `https://api.resend.com/emails` — no new dependencies (match the mailchimp.ts zero-SDK pattern).
   - Same contract as `syncMailchimpMember`: never throws, logs and returns false on failure, no-op returning true when disabled. A Resend failure must never fail the subscribe request.
2. Template `backend/src/features/marketing/templates/quizCompleteEmail.ts` exporting `renderQuizCompleteEmail(firstName: string | null, archetypeSlug: string | null): { subject, html, text }`:
   - **Source of truth: `launch/40_email-marketing/resend/quiz-complete-source.html`** — the exact HTML that ran in Mailchimp (Camila's, copy locked). Port it 1:1: same markup, same inline styles, same images, same spacing. Do NOT redesign, simplify, or drop the per-archetype variants.
   - Subject: `Your archetype card is here`.
   - The source uses Mailchimp merge tags; convert them to code as follows (this is the complete list — grep the source for `*|` to verify none remain in output):
     - `*|IF:ARCHETYPE=<slug>|* ... *|ELSEIF...|* ... *|ELSE:|* ... *|END:IF|*` (preheader AND the big variant block) → switch on `archetypeSlug` (floral | fruity | balanced | chocolate | earthy | experimental); anything else/null → the ELSE fallback branch (generic paragraph, no card image). The six variants each carry: full-bleed card jpg from gs bucket, color line, word set, "why" paragraph, `DOORS OPEN OCTOBER 1`, promise paragraph — all verbatim from the source.
     - Headline `*|IF:FNAME|**|FNAME|*, your match is in.*|ELSE:|*Your match is in.*|END:IF|*` → firstName present ? `{firstName}, your match is in.` : `Your match is in.` (pink highlight span stays only on "match"). HTML-escape the injected name.
     - Footer `TO: *|IF:FNAME|**|UPPER:*|FNAME|*|**|ELSE:|*YOU*|END:IF|*` → `firstName.toUpperCase()` or `YOU`.
     - `*|LIST:ADDRESSLINE|*` → hardcode `Axis & Bloom Coffee · 159 19th Street · Union City, NJ 07087 · USA`.
     - `*|UNSUB|*` / `*|UPDATE_PROFILE|*` → Resend has no equivalent hosted pages. Replace the two links with a single `Unsubscribe` mailto link (`mailto:hello@axisandbloomcoffee.com?subject=Unsubscribe`) for now, and log unsubscribe handling as a follow-up in the PR description.
   - Wire `archetypeSlug` at the call site from the quiz signup's archetype via the existing `toArchetypeSlug()` in mailchimp.ts (input is a display name like "Balanced & Sweet"); pass null when absent.
   - Keep the existing image URLs (storage.googleapis.com/axis-bloom-assets/raw/email/archetype-card/...) exactly as-is.
   - Always include a plain-`text` alternative covering the recipient's variant (headline, word set, why, DOORS OPEN OCTOBER 1, promise, Instagram line + URL, footer).
   - Banned anywhere including alt text: "AI", "film", "photo essay" (Camila's brief). The source already complies — porting verbatim preserves that.
3. Trigger + idempotency in `backend/src/routes/newsletter.ts` → `handleSubscribe`:
   - When `sourceName === 'post_quiz'`, after the DB upsert, fire-and-forget the Resend send (`.catch` + log, same as the Mailchimp call next to it).
   - Send at most once per email address, enforced in the DB, not in memory: new table `transactional_email_log (email text, template text, sent_at timestamptz, PRIMARY KEY (email, template))` — insert with `ON CONFLICT DO NOTHING` and only send when the insert actually inserted a row; template key `quiz_complete_v2`. (Keying by template means a future redesign can re-enable one send of the new version by bumping the key — decide then, don't automate now.)
   - Insert the log row only after Resend accepts the send (2xx), so a failed send can retry on the next quiz completion.
   - The Mailchimp sync call stays exactly as-is — tags and merge fields still power segmentation and the rest of the series.
4. Test script `test-resend.mjs` at repo root (sibling of test-mailchimp.mjs): `node test-resend.mjs <api_key> <to-email> [firstName] [archetype]` — renders and sends the real template; with `--all` it sends all six archetype variants plus the no-archetype fallback and a no-first-name case to the given address. Print the Resend message id per send.
5. `.env.example`: add `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO` with comments.

## CONSTRAINTS

- No new npm dependencies. Routes stay thin — all logic in `backend/src/features/marketing/`.
- Do not touch the Mailchimp sync path, the subscribe API shape, or the frontend.
- No open/click tracking parameters on the Resend call; the Instagram link is the raw URL.
- Schema change ships as a migration consistent with how existing tables are created (check `backend/src/db/`).

## ACCEPTANCE

1. Quiz completed with a fresh address → the email arrives with the CORRECT archetype variant for that quiz result (card image, word set, why + promise paragraphs), headline with the name, pink highlight on "match" only, working Instagram link, clean footer (grep the sent HTML: zero `*|` merge-tag remnants).
2. Same address completes the quiz again → no second send (log row prevents it); Mailchimp tags still updated.
3. test-resend.mjs --all → all six variants + fallback + no-first-name case render correctly (no-name: `Your match is in.` and footer `TO: YOU`).
4. Placement check: send to 3–4 fresh Gmail accounts via test-resend.mjs — record Primary/Promotions placement in the PR description. (Expectation: Primary; if not, we iterate on content, not on infrastructure.)
5. `RESEND_API_KEY` unset → subscribe flow works exactly as today, zero errors logged beyond a single "resend disabled" debug line.
