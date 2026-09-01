# Feature: Hoboken Coffee Crawl — `/crawl` landing page + campaign attribution

> Folder: `backend/src/features/hoboken_crawl/` · Decided: 2026-08-31 (Dana) · Model: Sonnet is fine (small, contained; one new page, one new nullable column, one new tag)
> Status: ✅ executed 2026-08-31 (WHAT_WE_BUILT.md #173)
> Depends on: pre-launch gate (#156) executed; reveal-in-inbox executed; #169 (match email via Resend) executed; first-name field (#171) executed.
> Hard date: the event is **Saturday, September 20, 2026**. Everything below must be live and smoke-tested on production well before that day.

## Why this exists

The Hoboken Historical Museum runs the Hoboken Coffee Crawl on Sep 20 (30+ cafés, ticketed, wristband + guide). Axis & Bloom does not serve coffee; the Museum hands out our printed card at both check-in locations. The card (Camila, `40crawlcardmockupv10`) carries a QR + the printed URL `axisandbloomcoffee.com/crawl`, the headline "What's your coffee archetype?", a six-archetype field guide on the back, and two promises "for crawlers only": first order ships free, and five crawlers receive their first match free, drawn when the doors open Oct 1.

Goal: crawlers scan → take the quiz → leave first name + email → get their match in the inbox. We need to know afterwards **exactly which subscribers came from the crawl** (for the draw, the free shipping, and Camila's follow-up email), and how many scans turned into quiz starts, completions, and emails.

## CONTEXT — verified in code 2026-08-31, not assumed

- **Routing / gate.** `frontend/src/app/App.tsx` declares public routes inside `<PublicLayout />`; anything not in `PRELAUNCH_OPEN_ROUTES` (`frontend/src/app/lib/prelaunch.ts`) is wrapped in `<PrelaunchGate>` and redirects to the curtain at `/`. `/crawl` does not exist today; under the gate it would land on the curtain. `?preview=true` bypass is sessionStorage-based and must keep working.
- **Email capture.** `frontend/src/app/components/PostQuizEmailGate.tsx` (shared by the sealed pre-launch ending and the post-launch gate) calls `subscribeNewsletter({ email, firstName, source: 'post_quiz', archetype, experimental, confidence, quizSessionKey })` from `frontend/src/app/lib/api.ts`.
- **Backend subscribe.** `backend/src/routes/newsletter.ts` → `POST /api/newsletter/subscribe` (`optionalAuth`) destructures `{ email, firstName, source = 'newsletter', archetype, experimental, confidence, quizSessionKey }` → `handleSubscribe(clean, sourceName, cleanName, extra, res)` which (a) looks up `subscriber_source` by name, (b) upserts `newsletter_subscriber` (ON CONFLICT keeps the first non-null `source_id` via COALESCE), (c) fire-and-forget `syncMailchimpMember(clean, cleanName, { source, archetype, experimental })`, (d) **only if `sourceName === 'post_quiz'`** sends the Resend match email via `sendQuizCompleteEmailOnce`.
- **Mailchimp tags.** `backend/src/features/marketing/mailchimp.ts` → `buildTags({ source, archetype, experimental })` emits `source:<name>`, `archetype:<slug>`, `quiz-completed` (only when `source === 'post_quiz'`), `experimental`. `syncMailchimpMember` upserts the member (FNAME + ARCHETYPE merge fields) then `setMemberTags`.
- **Therefore `source` is load-bearing.** Replacing `post_quiz` with a crawl value would silently kill the match email and the `quiz-completed` tag. The crawl must be a **second, orthogonal dimension (`campaign`)**, never a new `source`.
- **Funnel.** `backend/src/features/marketing/funnelEvents.ts` → `logFunnelEvent(sessionKey, event, archetype)` inserts into `quiz_funnel_event(session_key, event CHECK IN ('quiz_start','quiz_complete','email_submitted'), archetype)`. Frontend: `logQuizFunnelEvent(sessionKey, event, archetype?)` in `api.ts`, called from `FlavorQuiz.tsx`.
- **Schema.** `backend/src/db/schema.sql` is idempotent and runs on every backend startup (`migrate.ts` reads the whole file). Dated files under `backend/src/db/migrations/` are the narrative record (see the header of `transactional_email_log_2026_08_18.sql`). Follow both conventions.
- **Analytics.** `frontend/src/app/lib/analytics.ts` exports `trackPageView`, `trackEvent(name, params)`, `trackLead(params)` (GA4 + Pixel, consent-aware). `PreLaunch.tsx` fires `trackEvent('PreLaunchCTA', { source: 'pre_launch' })` on its CTA.
- **Archetype visuals.** `frontend/src/app/components/bloom/bloomVisuals.ts` exports `ARCHETYPE_VISUALS` (keys `floral, fruity, balanced_sweet, chocolate_nutty, earthy, experimental`; `num` 01–06 and `color` match the card exactly: `#a34b78 #ca445f #d1ac11 #a54c2d #912f2f #056c7a`). `PreLaunch.tsx` has a local `ARCHETYPE_SWATCHES` array with the same six colors and `.pl-*` classes for the pre-launch look.
- **Deploy.** Push to `main` auto-deploys (`.github/workflows/deploy.yml`). `vite build` does not type-check; run `npx tsc --noEmit` too (12 known pre-existing errors in 6 files — do not add to them).
- **Domain.** Dana confirmed 2026-08-31 that `axisandbloomcoffee.com` serves the site. The QR will be regenerated by Camila with the URL in §"QR URL" below.

## Decisions already made (Dana, 2026-08-31) — do not re-open

1. `/crawl` is a **real landing page**, not a redirect.
2. Attribution lives in **both** Postgres (`newsletter_subscriber.campaign`) and Mailchimp (tag `campaign:hoboken-crawl-2026`).
3. `source` stays `post_quiz` for quiz signups; `campaign` is additive.
4. The pre-launch **sealed ending stays** (match arrives by email within a minute; that is the sign-up mechanism and it suits a crowd that is walking around). No on-screen reveal for crawlers.
5. Campaign slug for this event: **`hoboken-crawl-2026`**. The mechanism is generic (future events = one more entry in the allowlist + one more landing page), but build only this one.
6. Free shipping and the five-match draw are honored **manually at launch** from the tagged list. Nothing to build for them now (Stripe/checkout is a separate workstream).
7. **Capture everything we reasonably can in our own DB** (Dana, 2026-08-31: "I want to get whatever I can"): landing events with UTMs + referrer, an anonymous visitor key that joins scan → quiz → email, attribution timestamp on the subscriber, and reporting views. Mailchimp gets the tag only.

## TASK

### 1. Campaign attribution helper (frontend)

Create `frontend/src/app/lib/campaign.ts`:

- `export const CAMPAIGNS = { 'hoboken-crawl-2026': { label: 'Hoboken Coffee Crawl 2026' } } as const;` and `export type CampaignSlug = keyof typeof CAMPAIGNS;`
- `rememberCampaign(slug: CampaignSlug): CampaignStamp` → writes `localStorage['ab_campaign'] = JSON.stringify({ slug, vid, at: Date.now() })` where `vid` is a `crypto.randomUUID()` **visitor key**, kept if a stamp with the same slug already exists (a rescan refreshes `at`, never the `vid`). **localStorage, not sessionStorage**: a crawler scans in the morning and may finish the quiz that evening on the same phone. Wrap in try/catch (private mode → still return an in-memory stamp for this page load).
- `getActiveCampaign(): CampaignStamp | null` (`{ slug, vid, at }`) → reads it, returns `null` if missing, unknown slug, malformed, or older than **30 days** (Dana, 2026-08-31: consistent with how long we remember an anonymous visitor; a scan of `/crawl` at any time re-stamps it anyway). The `/crawl` page itself has no expiry; it can be deactivated whenever Dana decides.
- Both functions are the only place that touches this key. The `vid` is what joins scan → quiz → email in the DB regardless of cookie consent (GA4 events are consent-gated, so a large share of scans would otherwise be invisible).

### 2. `/crawl` landing page (frontend)

- New component `frontend/src/app/components/CrawlLanding.tsx`, route `<Route path="/crawl" element={<CrawlLanding />} />` inside `<PublicLayout />` in `App.tsx`, **not** wrapped in `<PrelaunchGate>`. Add `'/crawl'` to `PRELAUNCH_OPEN_ROUTES` in `prelaunch.ts` with a one-line comment (event page, Sep 20 2026). Nav/Footer trimmed link sets: do NOT add `/crawl` to them; it is reached by QR/URL only.
- On mount: `const stamp = rememberCampaign('hoboken-crawl-2026')`, `trackEvent('CampaignLanding', { campaign: 'hoboken-crawl-2026' })`, and fire-and-forget `logCampaignLanding({ campaign, vid: stamp.vid, utmSource, utmMedium, utmCampaign, referrer: document.referrer || null })` (new `api.ts` helper → `POST /api/campaign/landing`, §4). Read the three `utm_*` values from the URL only to pass them along; GA4 still consumes them natively. Never block rendering on this call.
- **Reuse, don't reinvent** (standing rule): the page uses the pre-launch visual language (`.pl-*` styles / same fonts, logo mark from `brandAssets.logoQuarter1`, `TERRA` etc.). If `ARCHETYPE_SWATCHES` in `PreLaunch.tsx` is the cleanest shared source for the six colors, export it from there or from `bloomVisuals.ts` and import it; do not paste a third copy of the six hex values. The six tiles below take `num` + `color` from `ARCHETYPE_VISUALS`.
- Content (positive register; lead with what the crawler gets; no "test", "verdict", "coupon", "free bag"; sentences with periods and commas, not dashes). Match the card's voice; Camila may polish wording later, so keep copy in one constants block at the top of the file:
  - Kicker: `HOBOKEN COFFEE CRAWL · SEPTEMBER 20`
  - H1: `What's your coffee archetype?`
  - Body: `You know you love coffee. Today you'll taste your way across Hoboken, and somewhere in those cups is a pattern: your family of taste. Three minutes, no jargon. Find it.`
  - Primary CTA (Link to `/find-my-flavor`): `Take the quiz →` with micro line `Free · three minutes · your match lands in your inbox`. On click: `trackEvent('CampaignCTA', { campaign: 'hoboken-crawl-2026' })`.
  - Field guide section, heading `A field guide for today`, sub `As you taste your way through Hoboken, notice which words keep coming back.` Six tiles in a 3×2 grid (2×3 on mobile), each: `num`, name, three or four descriptor words, on the archetype color with light text, exactly as the card back:
    - 01 Floral — Fragrant · Bright · Delicate · Clean
    - 02 Fruity — Sweet · Vibrant · Expressive · Lively
    - 03 Balanced & Sweet — Smooth · Sweet · Harmonious · Easy
    - 04 Chocolate & Nutty — Rich · Grounded · Full · Comforting
    - 05 Earthy — Warm · Deep · Bold · Lasting
    - 06 Experimental — Wild · Unique · Surprising
    Closing line under the grid: `The words that keep returning are your axis. Take the quiz and see if you were right.` with a second CTA to `/find-my-flavor` (same tracking).
  - Offer block: `FOR CRAWLERS ONLY` · `Find your archetype today and your first order ships free. Five of you will receive your first match free, drawn when the doors open.`
  - Foot: `Doors open this fall · axisandbloomcoffee.com` · `Follow @axisandbloom` · the `FROM: AXIS & BLOOM — TO: HOBOKEN` signature line. Museum/Crawl logos only if the assets are already in the repo; otherwise text only, no new image assets.
- Mobile-first: this is scanned on phones outdoors. Single column below 640px, CTA visible without scrolling on a 390×844 viewport, tap targets ≥ 44px, no hero video/heavy media (the page must load fast on cellular; keep total page weight small).
- `document.title` = `Hoboken Coffee Crawl · Axis & Bloom` via whatever the other pages use.

### 3. Carry the campaign into the quiz funnel and the signup (frontend)

- `api.ts`: `subscribeNewsletter` payload gains `campaign?: string; campaignVid?: string`; `logQuizFunnelEvent` gains an optional 4th param `attribution?: { campaign: string; vid: string }` sent in the body as `campaign` + `campaignVid`; new `logCampaignLanding(payload)` → `POST /api/campaign/landing`.
- `PostQuizEmailGate.tsx`: include `campaign` + `campaignVid` from `getActiveCampaign()` (when non-null) in the existing subscribe body. **`source` stays `'post_quiz'`.** Nothing else on the card changes (first-name field, sealed copy, returning masked state, signed-in auto-subscribe path all untouched).
- `FlavorQuiz.tsx`: every `logQuizFunnelEvent(...)` call passes the active stamp. If the signed-in auto-subscribe path calls `subscribeNewsletter` directly (lines ~859/879 send `source: 'post_quiz'`), pass `campaign` + `campaignVid` there too, so a signed-in crawler is attributed as well.

### 4. Backend: accept, validate, persist, tag

- `backend/src/features/marketing/campaigns.ts` (new): `export const KNOWN_CAMPAIGNS = new Set(['hoboken-crawl-2026']);`, `normalizeCampaign(input: unknown): string | null` → trimmed lowercase string if in the set, else `null`; `normalizeVid(input: unknown): string | null` → UUID-shaped string or `null`; `normalizeUtm(input: unknown): string | null` → trimmed, max 64 chars, `[a-z0-9_-]` only, else `null`. **Never write an unknown client-supplied campaign** to the DB or to Mailchimp (anyone can POST to `/subscribe`; an allowlist keeps tags and columns clean). If `campaign` normalizes to `null`, drop `vid` and UTMs too.
- `newsletter.ts`: destructure `campaign`, `campaignVid` from the body, normalize, add to `SubscribeExtras`, and in the upsert set them with the same first-wins rule as `source_id`: `campaign = COALESCE(newsletter_subscriber.campaign, EXCLUDED.campaign)`, same for `campaign_vid`, and `campaign_attributed_at = COALESCE(newsletter_subscriber.campaign_attributed_at, CASE WHEN EXCLUDED.campaign IS NOT NULL THEN now() END)`. Pass `campaign` into `syncMailchimpMember(..., { source, archetype, experimental, campaign })`. The `post_quiz` match-email branch is unchanged.
- `mailchimp.ts`: `MailchimpTagInputs` gains `campaign?: string | null`; `buildTags` appends `campaign:${campaign}` when present. Existing tags unchanged (the match email is Resend's; Mailchimp gets data only). Update the module's header comment (it lists the tag families).
- `funnelEvents.ts` + `quiz.ts` `/event`: accept `campaign` + `campaignVid`, normalize, insert into new nullable `quiz_funnel_event.campaign` / `campaign_vid` columns.
- New route `backend/src/routes/campaign.ts` mounted at `/api/campaign` (same mounting pattern as the others in `index.ts`): `POST /landing` body `{ campaign, vid, utmSource?, utmMedium?, utmCampaign?, referrer? }` → normalize; reject (400) if campaign or vid is invalid; insert one row into `campaign_landing_event`. Public, no auth, rate-limited per real client IP with the same `express-rate-limit` shape as `funnelEventLimiter` / `qrResolveLimiter` (keyed via `middleware/clientIp.ts`). Store `referrer` truncated to 512 chars, `user_agent` truncated to 256 chars from the request header (coarse device mix only; no IP stored).
- `test-mailchimp-tags.mjs` at repo root: extend it (or its `buildTags` assertions) to cover the campaign tag, if it asserts on `buildTags`.

### 5. Schema

Add to `backend/src/db/schema.sql` (idempotent, next to the other `newsletter_subscriber` ALTERs and the `quiz_funnel_event` block):

```sql
-- Hoboken Coffee Crawl (2026-08-31): campaign attribution, orthogonal to source.
-- vid = anonymous per-phone visitor key minted on the landing page; joins scan → quiz → email.
CREATE TABLE IF NOT EXISTS campaign_landing_event (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign     TEXT NOT NULL,
  vid          UUID NOT NULL,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  referrer     TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ DEFAULT timezone('utc', now())
);
CREATE INDEX IF NOT EXISTS idx_campaign_landing_event_campaign ON campaign_landing_event(campaign, created_at);
CREATE INDEX IF NOT EXISTS idx_campaign_landing_event_vid      ON campaign_landing_event(vid);

ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS campaign               TEXT;
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS campaign_vid           UUID;
ALTER TABLE newsletter_subscriber ADD COLUMN IF NOT EXISTS campaign_attributed_at TIMESTAMPTZ;
ALTER TABLE quiz_funnel_event     ADD COLUMN IF NOT EXISTS campaign               TEXT;
ALTER TABLE quiz_funnel_event     ADD COLUMN IF NOT EXISTS campaign_vid           UUID;
CREATE INDEX IF NOT EXISTS idx_newsletter_subscriber_campaign ON newsletter_subscriber(campaign) WHERE campaign IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quiz_funnel_event_campaign     ON quiz_funnel_event(campaign)     WHERE campaign IS NOT NULL;

-- One row per campaign: scans (distinct phones), quiz starts, completes, emails.
CREATE OR REPLACE VIEW campaign_funnel_v AS
WITH scans AS (
  SELECT campaign, COUNT(*) AS scans, COUNT(DISTINCT vid) AS unique_scanners,
         MIN(created_at) AS first_scan, MAX(created_at) AS last_scan
  FROM campaign_landing_event GROUP BY campaign
), quiz AS (
  SELECT campaign,
         COUNT(DISTINCT COALESCE(campaign_vid::text, session_key)) FILTER (WHERE event = 'quiz_start')      AS quiz_starts,
         COUNT(DISTINCT COALESCE(campaign_vid::text, session_key)) FILTER (WHERE event = 'quiz_complete')   AS quiz_completes,
         COUNT(DISTINCT COALESCE(campaign_vid::text, session_key)) FILTER (WHERE event = 'email_submitted') AS email_events
  FROM quiz_funnel_event WHERE campaign IS NOT NULL GROUP BY campaign
), subs AS (
  SELECT campaign, COUNT(*) AS subscribers FROM newsletter_subscriber WHERE campaign IS NOT NULL GROUP BY campaign
)
SELECT s.campaign, s.scans, s.unique_scanners, q.quiz_starts, q.quiz_completes, q.email_events,
       sb.subscribers, s.first_scan, s.last_scan
FROM scans s
LEFT JOIN quiz q  ON q.campaign  = s.campaign
LEFT JOIN subs sb ON sb.campaign = s.campaign;

-- Per-archetype split of campaign subscribers (for Camila's follow-up and the draw).
CREATE OR REPLACE VIEW campaign_subscriber_archetype_v AS
SELECT campaign, archetype, COUNT(*) AS subscribers
FROM newsletter_subscriber WHERE campaign IS NOT NULL
GROUP BY campaign, archetype ORDER BY campaign, subscribers DESC;
```

Plus the narrative file `backend/src/db/migrations/campaign_attribution_2026_08_31.sql` with the same statements and the standard header ("also in schema.sql, runs on startup, purely additive, no backfill, safe before or after the code deploy").

### 6. Not in scope (do not build)

Discount codes or free-shipping logic; the giveaway draw; changes to the sealed ending or the match email; a generic `?campaign=` reader on other routes; nav links to `/crawl`; new image assets; storing IP addresses or any fingerprinting beyond the self-issued `vid`.

## QR URL (for Camila — the code must resolve to this)

```
https://axisandbloomcoffee.com/crawl?utm_source=hoboken-crawl&utm_medium=print&utm_campaign=hoboken-crawl-2026
```

The printed text on the card stays `axisandbloomcoffee.com/crawl` (typed by hand it still attributes: the landing page stamps the campaign regardless of UTMs; the UTMs only give GA4 native scan attribution). Camila should regenerate at high error correction (level H) since the front QR is small on the card.

## CONSTRAINTS

Reuse the existing card, subscribe path, funnel logging and pre-launch styling: the only new endpoint is `POST /api/campaign/landing`; the two existing bodies are widened, not replaced; no duplicated archetype colors; no new components other than `CrawlLanding`. Copy in positive register. Do not send to real third-party addresses; disposable marked test data + cleanup is this repo's practice. Do not touch the Resend template, the sealed ending, or the Mailchimp merge-field logic.

## DONE = (run the whole sequence in ONE go, report ONCE at the end)

1. Code + schema committed with message `Hoboken Crawl: /crawl landing + campaign attribution`, pushed to `main`, deploy green, backend startup log shows `Migration complete.` with no errors.
2. `vite build` and `npx tsc --noEmit` clean (no new errors).
3. Build-log entry added to `WHAT_WE_BUILT.md` (next number) and this file's Status line flipped to executed with the number.

## ACCEPTANCE (live browser, gated production or a gated dev server, plus prod DB reads)

1. `https://axisandbloomcoffee.com/crawl?utm_source=hoboken-crawl&utm_medium=print&utm_campaign=hoboken-crawl-2026` on a phone-sized viewport with **no** `?preview=true`: the landing page renders (not the curtain), CTA visible above the fold, six tiles show the card's colors/numbers/words. `localStorage.ab_campaign` contains `{ slug, vid, at }`. One `campaign_landing_event` row exists with that `vid`, the three UTMs, and a user agent. Reloading the page adds a second landing row with the **same** `vid`.
2. Tap `Take the quiz →` → `/find-my-flavor` renders (open route), quiz runs as before. `quiz_funnel_event` rows for this session have `campaign = 'hoboken-crawl-2026'` and `campaign_vid` = that vid for `quiz_start`, `quiz_complete`, `email_submitted`.
3. Sealed ending card unchanged (First name + Email, confirmation state, masked returning state). Submitting lands `newsletter_subscriber` with `source_id` = post_quiz's id, `archetype` set, `campaign = 'hoboken-crawl-2026'`, `campaign_vid` = that vid, `campaign_attributed_at` set. The Resend match email still fires (log line or controlled address).
4. Mailchimp member for that test email carries tags `source:post_quiz`, `archetype:<slug>`, `quiz-completed`, **and** `campaign:hoboken-crawl-2026`. No other Mailchimp change (no merge field for campaign, no email from Mailchimp).
5. Control: a fresh browser that never visited `/crawl` completes the quiz → `campaign`/`campaign_vid` are NULL in both tables and no campaign tag in Mailchimp. Unchanged behavior for everyone else.
6. `POST /api/newsletter/subscribe` with `campaign: 'anything-else'` → row written with `campaign NULL`, no stray Mailchimp tag. `POST /api/campaign/landing` with an unknown campaign or a non-UUID vid → 400, no row. Hammering `/landing` trips the rate limiter (429).
7. `SELECT * FROM campaign_funnel_v;` shows scans = 2, unique_scanners = 1, quiz_starts = 1, quiz_completes = 1, email_events = 1, subscribers = 1 for the test run; `campaign_subscriber_archetype_v` shows the test archetype with 1.
8. `?preview=true` on `/crawl` still unlocks the rest of the site as before; `/crawl` never appears in nav or footer.
9. Privacy page: if `/privacy` enumerates what we store, add one line for the anonymous visitor key and landing analytics; otherwise no change.
10. Cleanup: delete the marked test subscriber/funnel/landing rows and the test Mailchimp member.

## After execution (Dana / Camila, not Claude Code)

- Camila: regenerate the QR with the URL above and re-export the card; create a Mailchimp segment on tag `campaign:hoboken-crawl-2026` for the follow-up and the Oct 1 draw.
- After Oct 1: the offer block's "drawn when the doors open" line needs a small copy update once the draw has happened (separate tiny task; keep the page live, the card stays in circulation).
- Dana: on Sep 20 evening, `SELECT * FROM campaign_funnel_v;` is the whole story in one row (scans → unique phones → quiz starts → completes → emails → subscribers); `SELECT * FROM campaign_subscriber_archetype_v;` for the archetype mix; `SELECT email, first_name, archetype, campaign_attributed_at FROM newsletter_subscriber WHERE campaign = 'hoboken-crawl-2026' ORDER BY campaign_attributed_at;` is the list for the Oct 1 draw and the free-shipping promise.
