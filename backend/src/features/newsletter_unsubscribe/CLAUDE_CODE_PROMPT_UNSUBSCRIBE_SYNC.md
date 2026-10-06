# CLAUDE_CODE_PROMPT — Unsubscribe: one source of truth across DB, Mailchimp and Resend

**Date:** 2026-10-01
**Feature folder:** `backend/src/features/newsletter_unsubscribe/`
**Status (2026-10-05):** built and committed, see `WHAT_WE_BUILT.md` #211. Manual steps (secret, backfill + migration step 3, webhook registration, reconcile) in `OPEN_TASKS.md` OT-35. One deviation: test 2 below says GET flips; it doesn't (Part 3 wins), the test asserts GET writes nothing and the POST flips.
**Trigger:** a quiz taker tapped "Unsubscribe" in the quiz-complete email. That link is a `mailto:` (Step 07 C3 left real unsubscribe handling as a follow-up, see WHAT_WE_BUILT.md "Deviation flagged"). The email landed in hello@, Mailchimp still shows her subscribed, `newsletter_subscriber.subscribed` is still `true`. Nothing was wired. This brief wires it.

## Goal

`newsletter_subscriber.subscribed` becomes the single source of truth for marketing consent, and every unsubscribe, wherever it originates, lands there and is mirrored outward:

| Origin | Path into DB | Mirrored to |
|---|---|---|
| Link in one of OUR emails (Resend) | `GET /api/newsletter/unsubscribe/:token` | Mailchimp (`status: unsubscribed`) |
| Mail client's native Unsubscribe button | `POST /api/newsletter/unsubscribe/:token` (RFC 8058 one-click) | Mailchimp |
| Mailchimp campaign footer | `POST /api/webhooks/mailchimp` | (already done on MC side) |
| Email to hello@ / manual | `POST /api/admin/newsletter/unsubscribe` + npm script | Mailchimp |

And every outbound **marketing** send from our backend checks that flag first. Resend has no audience/suppression list in use today (we only call `POST /emails`, no Audiences), so "syncing Resend" means two things: (a) our backend never hands Resend a marketing email for a suppressed address, and (b) every Resend send carries `List-Unsubscribe` headers so Gmail/Apple Mail show their own button pointing at our endpoint.

Read first: `backend/src/routes/newsletter.ts`, `backend/src/features/marketing/mailchimp.ts`, `backend/src/features/marketing/resendEmail.ts`, `backend/src/features/marketing/templates/quizCompleteEmail.ts`, `backend/src/routes/beats.ts` (the capability-token GET pattern to copy), `backend/src/middleware/appCheck.ts`, `backend/src/db/migrations/beat_event_respond_token_2026_08_09.sql` (the token-backfill pattern to copy), `backend/src/routes/newsletter.test.ts` (test harness to extend).

House rules that apply: raw data is never deleted (`newsletter_subscriber` rows are flipped, never removed). Reuse existing helpers (`memberHash`, `mcHeaders`, `sendResendEmail`, `requireAdmin`, `requireCronSecret` pattern). Non-blocking Mailchimp/Resend contract stays exactly as it is: an outward mirror failure never fails the user-facing request.

---

## Part 1 — Schema

New migration `backend/src/db/migrations/newsletter_unsubscribe_2026_10_01.sql`, and the same statements appended (idempotent, `IF NOT EXISTS`) to `backend/src/db/schema.sql` next to the existing `newsletter_subscriber` ALTERs:

```sql
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS unsubscribe_token   TEXT;
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS unsubscribed_at     TIMESTAMPTZ;
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS unsubscribe_source  TEXT;  -- 'link' | 'one_click' | 'mailchimp' | 'admin'
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscriber_unsubscribe_token_idx ON newsletter_subscriber (unsubscribe_token);
```

Token: 32 random bytes, hex, from `crypto.randomBytes` in app code, exactly like `beat_event.respond_token`. Three ordered steps like that migration: (1) add nullable column, (2) backfill via a Node script (`backend/src/scripts/backfillUnsubscribeTokens.ts`, `--dry-run` default, `--apply` to write, prints "rows backfilled / rows still NULL"), (3) `ALTER ... SET NOT NULL` only after step 2 reports zero NULLs. Document the deploy order in the migration header the same way the beat_event one does. `handleSubscribe` mints a token on INSERT (`COALESCE(newsletter_subscriber.unsubscribe_token, EXCLUDED.unsubscribe_token)` on conflict so an existing token is never rotated by a re-subscribe).

Re-subscribe semantics in `handleSubscribe`: the existing `SET subscribed = TRUE` stays (a form submission is fresh consent), and additionally `unsubscribed_at = NULL, unsubscribe_source = NULL`.

## Part 2 — Service: `backend/src/features/marketing/unsubscribe.ts`

One module, no I/O in the pure parts:

- `unsubscribeByToken(token, source)` → `{ ok: true, email } | { ok: false }`. `UPDATE newsletter_subscriber SET subscribed = false, unsubscribed_at = COALESCE(unsubscribed_at, now()), unsubscribe_source = COALESCE(unsubscribe_source, $source) WHERE unsubscribe_token = $1 RETURNING email`. Idempotent: a second click is a no-op that still returns ok (same reasoning as `respondToDialInBeat`). Then fire-and-forget `setMailchimpStatus(email, 'unsubscribed')`.
- `unsubscribeByEmail(email, source)` → same, keyed on lowercased trimmed email. Used by the webhook and the admin door. For `source = 'mailchimp'` do NOT call back into Mailchimp (it already knows; avoid the loop).
- `isSuppressed(email): Promise<boolean>` → `SELECT 1 FROM newsletter_subscriber WHERE email = $1 AND subscribed = false`. Unknown emails are not suppressed.
- `buildUnsubscribeUrl(token)` → `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/api/newsletter/unsubscribe/${token}` (same `FRONTEND_URL` convention as household/cron; the site domain proxies `/api` to Cloud Run).

In `mailchimp.ts` add `setMailchimpStatus(email, status: 'unsubscribed' | 'subscribed')`: `PATCH /lists/{list}/members/{hash}` with `{ status }`, `MC_ENABLED`-guarded, logs and returns false on error, never throws. Mailchimp returns 400 "Member In Compliance State" for some re-subscribes; treat 400 on a `subscribed` PATCH as a logged warning, not an error.

Also fix the existing upsert in `syncMailchimpMember`: it sends `status: 'subscribed'` unconditionally on every PUT. Keep it (a form submission is consent), but gate the whole call: `handleSubscribe` is the only caller on the live path and it has just set `subscribed = TRUE`, so no change in behavior there. The backfill script (`src/scripts/...mailchimp backfill`, if still present) must skip rows with `subscribed = false`. Grep for other callers of `syncMailchimpMember` and apply the same guard.

## Part 3 — Public routes in `routes/newsletter.ts`

- `GET /api/newsletter/unsubscribe/:token` → **does NOT unsubscribe.** It only renders a page with one button. Reason: corporate mail security (Outlook Safe Links, Mimecast, Proofpoint) opens every link in an email to scan it; an immediate-action GET would let a scanner unsubscribe a reader who never tapped anything. The page is a minimal server-rendered form (same minimal HTML approach as `renderResponsePage` in `beats.ts`, reuse it if it's exportable, otherwise lift it into a shared helper rather than a second copy): `<form method="POST" action="/api/newsletter/unsubscribe/<token>"><button>Unsubscribe</button></form>` with the confirm copy below. The token is looked up only to decide between this page and the 404 page; no write. Unknown token → 404 page with neutral copy ("That link is no longer valid."). Never reveals whether the email exists.
- `POST /api/newsletter/unsubscribe/:token` → the only path that writes. Two callers hit it: the confirm button above (form body empty or `confirm=1`), and mail clients' RFC 8058 one-click (form body `List-Unsubscribe=One-Click`, sent only on a real user action). Add `express.urlencoded({ extended: false })` on this route only. Calls `unsubscribeByToken(token, body['List-Unsubscribe'] === 'One-Click' ? 'one_click' : 'link')`. Response: for one-click → `200` empty body, no redirect, no HTML (the spec requires that); for the form → the "You're unsubscribed." page below. Distinguish by the `List-Unsubscribe` body field, nothing else.
- Rate limit both with the existing `express-rate-limit` setup used elsewhere in the public routes (generous, e.g. 30/min/IP; this is a one-click link).
- **App Check:** these links are opened from an inbox with no App Check token. Add `/api/newsletter/unsubscribe` to `EXEMPT_PATH_PREFIXES` in `middleware/appCheck.ts` with a one-line comment. Note in WHAT_WE_BUILT that `/api/beats/dial-in` has the same latent exposure and will break the day `APP_CHECK_ENFORCED=true` is flipped; fix it there too in the same edit (one line), it is the identical case.

Confirm page copy (the GET page, positive register, no apology):

> **Unsubscribe from Axis & Bloom emails?**
> One tap and we stop sending marketing emails to this address.
> [Unsubscribe]  (the only button on the page)

Done page copy (after the POST):

> **You're unsubscribed.**
> We won't send marketing emails to this address. Your flavor profile and any orders stay exactly as they are.
> [Back to Axis & Bloom](https://axisandbloomcoffee.com)

## Part 4 — Resend side

In `resendEmail.ts`:

- `sendResendEmail` gains an optional `unsubscribeUrl?: string` and `kind: 'marketing' | 'transactional'` (make `kind` required so every caller declares it).
- When `kind === 'marketing'`: look up `isSuppressed(to)` first; if suppressed, log `[resend] suppressed — skipping marketing send` and return `{ ok: true, id: null }` (same shape as the disabled path). Add headers to the Resend payload:
  ```
  headers: {
    'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:hello@axisandbloomcoffee.com?subject=Unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
  ```
  (Resend's `POST /emails` accepts a `headers` object.)
- When `kind === 'transactional'`: no suppression check, no headers (order, account, password-reset, household-invite, brew-card arrival emails are not marketing and must keep flowing to an unsubscribed customer).
- Classify the existing callers: `routes/newsletter.ts` quiz-complete → `marketing`. The `resend.emails.send` calls in `auth.ts`, `household.ts`, `cron.ts` use the SDK directly, not this helper; leave them as transactional and do not route them through the check. List them in WHAT_WE_BUILT so the classification is on record.

In `templates/quizCompleteEmail.ts`: `renderQuizCompleteEmail(firstName, archetypeSlug, unsubscribeUrl)`; replace the `mailto:` href (HTML, line ~283) and the plain-text line (~331) with the hosted URL. The mailto stays only inside the `List-Unsubscribe` header as the secondary target. `sendQuizCompleteEmailOnce` reads the subscriber's token (`SELECT unsubscribe_token FROM newsletter_subscriber WHERE email = $1`) to build the URL. No other copy in the template changes (Camila's copy is locked).

## Part 5 — Mailchimp → DB webhook

`POST /api/webhooks/mailchimp` in `routes/cron.ts` next to the SMS inbound webhook (same router, already App-Check-exempt).

- Mailchimp has no signature. Protect it with a URL secret: the route requires `req.query.key === process.env.MAILCHIMP_WEBHOOK_KEY` (new secret in Secret Manager, same handling discipline as `CRON_SECRET`: trim, beware BOM). Missing/wrong key → 403.
- Mailchimp also sends a `GET` to the URL when you save the webhook in the UI to validate it. Add `GET /api/webhooks/mailchimp` returning `200` (still key-checked).
- Body is `application/x-www-form-urlencoded` with bracketed keys: `type=unsubscribe`, `data[email]=...`, `data[reason]=manual|abuse`, `data[action]=unsub`. Also `type=cleaned` (`data[email]`, `data[reason]=hard|abuse`). Use `express.urlencoded({ extended: true })` on this route only (the app only has `express.json()` globally).
- `unsubscribe` and `cleaned` → `unsubscribeByEmail(email, 'mailchimp')`. Every other `type` (`subscribe`, `profile`, `upemail`) → `200`, no-op, logged at debug. Always respond `200` quickly; do the DB write before responding (it is one UPDATE), mirror nothing back to Mailchimp.
- Write to `api_event` the way other webhook/cron entries do, if that capture-first logger wraps this router already; do not add a second logger.

## Part 6 — Admin door + script (the hello@ inbox path)

- `POST /api/admin/newsletter/unsubscribe` body `{ email }`, `requireAdmin`. Calls `unsubscribeByEmail(email, 'admin')` → mirrors to Mailchimp → returns `{ ok, email, wasSubscribed }` where `wasSubscribed` tells the admin whether this changed anything.
- `GET /api/admin/newsletter/subscriber?email=` → returns the row's `subscribed, unsubscribed_at, unsubscribe_source, archetype, source, created_at` plus the live Mailchimp status (one GET, `MC_ENABLED`-guarded) so a three-way mismatch is visible in one call.
- npm script in `backend/package.json`: `"newsletter:unsubscribe": "tsx src/scripts/unsubscribe.ts"`, usage `npm run newsletter:unsubscribe -- nrmisyak@gmail.com`. It calls the service directly (DB + Mailchimp), prints the before/after of both systems. This is what Dana runs for inbox requests; no SQL by hand.
- No admin UI in this brief. If `AdminDashboard.tsx` has a natural "tools" area, a single email input + Unsubscribe button is welcome but optional; do not build a subscribers page.

## Part 7 — Reconcile job (one-off now, reusable)

`GET /api/cron/newsletter-reconcile` (`requireCronSecret`) and the same logic as `npm run newsletter:reconcile -- --dry-run|--apply`:

- Pull Mailchimp members with `status=unsubscribed` or `cleaned` (paginate `GET /lists/{list}/members?status=unsubscribed&count=1000&fields=members.email_address,members.status`).
- For each, if DB has `subscribed = true` → `unsubscribeByEmail(email, 'mailchimp')`.
- Report: counted, flipped, already in sync. Never flips in the other direction (DB-unsubscribed but Mailchimp-subscribed is pushed outward by the service already; the reconcile only reports those as `mismatch_outward` and, with `--apply`, calls `setMailchimpStatus(email, 'unsubscribed')` for them too).
- Not scheduled in this brief; Dana runs it once after deploy to catch anything that happened in Mailchimp before the webhook existed. Add it to OPEN_TASKS as an optional weekly job.

## Part 8 — Tests

Extend `routes/newsletter.test.ts` (same real-DB harness, Mailchimp/Resend mocked):

1. Subscribe mints a token; re-subscribe keeps the same token.
2. `GET /unsubscribe/:token` flips `subscribed=false`, sets `unsubscribed_at` + `source='link'`, calls the mocked `setMailchimpStatus` once with `'unsubscribed'`; second GET is a 200 no-op and does not call Mailchimp again.
3. `POST /unsubscribe/:token` (form body `List-Unsubscribe=One-Click`) → 200, same DB effect, `source='one_click'`.
4. Unknown token → 404, no DB change, no Mailchimp call.
5. Marketing send to a suppressed email: `sendResendEmail` is never called by `sendQuizCompleteEmailOnce`... careful: the at-most-once claim row must NOT be left behind when the send is skipped for suppression (otherwise a later re-subscribe never gets the email). Check suppression **before** inserting the claim.
6. Webhook: correct key + `type=unsubscribe` form body → DB flipped, `source='mailchimp'`, Mailchimp mock NOT called. Wrong key → 403, no change. `type=subscribe` → 200 no-op.
7. Admin endpoint → flips + Mailchimp called; `wasSubscribed` false on second call.
8. `computeTagUpdates`-style pure unit test for the header builder: given a URL, the `List-Unsubscribe` string has both targets and the `-Post` header is exact.

`npm test` green. `tsc --noEmit` clean in backend.

## Part 9 — Deliverables and docs

- Code as above, migration file, backfill script, two npm scripts.
- `WHAT_WE_BUILT.md`: new entry "Unsubscribe sync (DB ⇄ Mailchimp ⇄ Resend)" with the table at the top of this brief, the transactional/marketing classification of every sender, the App Check exemption, and the deploy order (migration steps 1–2 → deploy → step 3; register webhook; set `MAILCHIMP_WEBHOOK_KEY`; run reconcile `--apply`).
- `WHAT_WE_BUILT_DB.md`: the three new columns.
- `OPEN_TASKS.md`: manual steps for Dana, each one line: (1) create `MAILCHIMP_WEBHOOK_KEY` in Secret Manager and expose to Cloud Run; (2) Mailchimp → Audience → Settings → Webhooks → add `https://axis-bloom-backend-oiub7eumya-uc.a.run.app/api/webhooks/mailchimp?key=<value>` with events Unsubscribes + Cleaned, sources "by a subscriber" + "by an admin" (uncheck "via the API", we are that API); (3) run `backfillUnsubscribeTokens --apply` then migration step 3; (4) run `newsletter:reconcile --apply` once; (5) Cloudflare WAF skip rule is NOT needed because the webhook targets the `*.run.app` URL, same reasoning already written for the SMS webhook.
- Do not touch Camila's email copy beyond the href swap. Do not add a frontend page; the confirmation is server-rendered.

## Out of scope (say so in WHAT_WE_BUILT, do not build)

- Resend Audiences/Broadcasts contact sync. We don't use Audiences; if Broadcasts are ever adopted, mirror `subscribed` into the Audience contact's `unsubscribed` flag from the same service function. Leave a one-line TODO in `unsubscribe.ts` pointing at `PATCH /audiences/{id}/contacts/{email}`.
- A preference center / update-profile page. One switch, on or off.
- SMS opt-out (STOP handling) stays in the SMS inbound webhook.
