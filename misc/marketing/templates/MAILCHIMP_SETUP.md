# Mailchimp Setup — Welcome Journey templates (v3)

Source copy: `launch/40_email-marketing/WELCOME_EMAILS_DRAFT_v3.md` (final, verbatim — v1/v2
superseded). Code assets: `email1.html`–`email5.html` + matching `.txt` files, this folder.
Account facts (from `../../00_manual-setup/MANUAL_SETUP_IDS.md`): datacenter **us11**,
audience **"Axis & Bloom"** (`a5940f849b`), from **Axis & Bloom <hello@axisandbloomcoffee.com>**.

## Before you start

1. **The `ARCHETYPE` merge field and `quiz-completed` tag already exist** (Step 05, shipped
   `db2945a`) — a live quiz signup already tags contacts and fills `*|ARCHETYPE|*`. Nothing to
   create there.
2. **CTA destinations are all resolved** (Dana, 2026-07-23): Email 1 → `/signup`, Email 2 →
   `/the-axis`, Email 4 → `/profile`. Emails 3 and 5 personalize per recipient using the same
   `*|IF:ARCHETYPE=...|*` conditional pattern as Email 1's accent bar, linking to the real public
   `/match/<slug>` pages already live from Step 07 (slug convention confirmed against
   `frontend/src/app/components/ShareMatchRow.tsx`: `floral`, `fruity`, `earthy`,
   `chocolate-nutty`, `balanced-sweet`). Experimental and any missing/unsynced `ARCHETYPE` value
   fall back to `/profile` — there's no `/match` page for Experimental (`ShareMatchRow` hides its
   own share row for the same reason). No new pages or tokens were built for this.
3. **Domain note**: every link in these templates uses `https://axisandbloomcoffee.com` (no
   `www`), per `../README.md`'s explicit rule ("every link, test, ad, and doc uses
   axisandbloomcoffee.com"). `ShareMatchRow.tsx` itself actually hardcodes
   `https://www.axisandbloomcoffee.com` (with `www`) for the same `/match/<slug>` pages — both
   almost certainly resolve today, but it's a real inconsistency in the codebase worth Dana/Camila
   reconciling at some point. Not fixed here since it's outside this task's `frontend/` boundary.

Also note: Email 1's archetype-conditional block has a documented default/else branch (see the
HTML comment directly below it) that fires for `Experimental` or a missing `ARCHETYPE` value —
it reuses the site's existing on-screen Experimental description verbatim, since v3 explicitly
scoped only the five core archetypes for today. Fine to ship as-is; flag to Dana if she wants
bespoke Experimental email copy later.

## Typography — Genova, self-hosted

All five templates load the real brand typeface, **Genova** (per the visual identity deck,
`misc/design_documents/Axis & Bloom logo and visual identity_adjustments2 (1).pdf`, p.8), via
`@font-face` — not the site's current Lato (the live site reverted to Lato from Genova in its
most recent typography commit, `cab3716`, but that's a site-code decision, separate from these
email assets). Three weights only, matching the site's own settled convention (Regular 400 /
Thin 100 / Black 900, no Medium, no italics):

- The `.ttf` source files are committed at `misc/design_documents/genova/` (added 2026-07-23,
  commit `383184e`).
- For `@font-face` to work in a *sent* email, the font has to be fetched from a real public URL —
  a local file path or repo path doesn't work. Base64-embedding the fonts inline was considered
  and rejected: three weights raw ≈126KB, ~168KB once base64-inflated, per email — that alone
  would push every campaign past Gmail's ~102KB clipping threshold (the "view entire message"
  truncation), before any copy or markup.
- Instead, the three weights are uploaded to the existing **public** GCS bucket
  `gs://axis-bloom-assets` (already used for site image/video assets) at
  `raw/fonts/genova/Genova-Regular.ttf` / `Genova-Thin.ttf` / `Genova-Black.ttf`, following the
  same `raw/` (unprocessed passthrough) convention documented in
  `frontend/src/design/CLAUDE.md`. Verified publicly reachable (200, `Content-Type: font/ttf`).
  Each template's `@font-face` block points at
  `https://storage.googleapis.com/axis-bloom-assets/raw/fonts/genova/...`.
- Fallback stack is `'Genova', Arial, Helvetica, sans-serif` everywhere. Email clients that don't
  support `@font-face` at all (Outlook desktop on Windows is the big one) will always render
  Arial/Helvetica — that's expected, graceful degradation, not a bug.
- Type scale used across the series: 12px/900 letter-spaced wordmark → (Email 1 only) 15px/400
  kicker + 36px/900 archetype-colored headline for the identity moment, and a 17px callout with a
  left border in the archetype's color for the flavor paragraph, per the Visual Foundations
  brief's own stated hierarchy ("recognize the person, then present the system": Primary =
  Identity, Secondary = Recommendation) → 26px/900 section headline on Emails 2–5 (reusing each
  email's already-authored v3 working title verbatim, not new copy) → 16px/400 body → 12px/400
  footer. The Liam/Taste Memory paragraph in Email 1 is intentionally set in the site's existing
  muted gray (`#7b7f80`) rather than the main ink color — "depth available, never imposed," per
  the same brief.

## 1. Import each template

Repeat for `email1` through `email5`:

1. **Campaign → Content → Design → Templates** (left nav: *Content* → *Templates*).
2. Click **Create Template** → **Code your own** → **Import HTML**.
3. Paste the full contents of `emailN.html`, or drag-and-drop the file onto the importer.
4. Name it exactly `Welcome N — <working title>`, e.g. `Welcome 1 — You're ARCHETYPE`.
5. Click **Save**. Mailchimp auto-converts the design to its editor; you don't need to edit
   blocks — the HTML is already final and inlined.
6. On the template's plain-text tab (**Edit Code** → **Text** toggle, or the "Sync Changes"
   prompt Mailchimp shows when a template has no text part), paste in the matching `emailN.txt`
   content instead of letting Mailchimp auto-generate one from the HTML (auto-generation strips
   the conditional merge blocks incorrectly).
7. Send yourself a **test email** (Preview → Send a test email) before wiring it into the
   journey. For Emails 1, 3, and 5 — the ones with `*|IF:ARCHETYPE=...|*` conditionals — send to
   a test contact that already has `ARCHETYPE` set (via the audience's contact profile → Edit) to
   confirm both the conditional paragraph (Email 1) and the personalized `/match/<slug>` button
   (Emails 3, 5) resolve correctly. Mailchimp's own preview pane does not evaluate `*|IF|*`
   blocks, only a real test send does.

## 2. Build the Customer Journey (M2)

1. **Automations → Customer Journeys → Create Journey** → **Start from scratch**.
2. Name it `Welcome Journey — Quiz Completed`.
3. **Starting point / trigger**: *Contact is added to Audience with tag* → select **`quiz-completed`**.
   (Not "tag is added" — the sync fires the tag at the same moment as first sync for a fresh
   quiz signup, so "added to audience with tag" and "tag added" behave the same here in practice;
   either works, but "added to audience with tag" is what re-fires correctly on any future
   audience import too.)
4. Add four **Email** action cards in sequence, each pointing at its imported template:

   | Journey step | Delay before send | Template |
   |---|---|---|
   | Email 1 | Immediately (0) | `Welcome 1 — You're ARCHETYPE` |
   | Email 2 | 5 days after Email 1 | `Welcome 2 — How we found it` |
   | Email 3 | 7 days after Email 2 (day 12 total) | `Welcome 3 — What arrives at your door` |
   | Email 4 | 9 days after Email 3 (day 21 total) | `Welcome 4 — Tell us what you taste` |

   Use the **Time Delay** card between each Email card (Mailchimp journeys chain delay → email →
   delay → email). Enter delays as *relative to previous step*, matching the day counts above —
   do not enter them as "day 5 / day 12 / day 21 from journey start," since the builder's delay
   fields are step-to-step, not absolute.
5. Subject lines (enter on each Email card):
   - Email 1: `You're *|ARCHETYPE|*. Here's the data behind it.` (v3's default choice; the
     alternate `Your match is saved for 30 days, *|FNAME|*` is noted in v3 as A/B-testable
     **only if** a real 30-day expiry is ever implemented — do not use it otherwise.)
   - Email 2: `How we found it`
   - Email 3: `What arrives at your door`
   - Email 4: `Tell us what you taste`
6. Preview text (each Email card → **Preview text** field) — copy verbatim from each template's
   hidden preheader div, also listed here for convenience:
   - Email 1: "Two streams of data met at one coordinate — yours."
   - Email 2: "The story that travels with the beans — and the AI that reads it."
   - Email 3: "Roasted to order, in your archetype's bag."
   - Email 4: "One sentence after each bag is enough — here's what it does."
7. **From name / from email**: `Axis & Bloom` / `hello@axisandbloomcoffee.com` (should be the
   account default already; confirm on each Email card's Settings tab).
8. Leave the journey **paused/draft** until a real end-to-end quiz completion has been run
   against it in test mode.
9. **Turn the journey on** (top-right toggle) only after that verification — per
   `../README.md`'s "M2 — journey live" checklist: one live quiz → Email 1 arrives within
   minutes with the correct archetype → July pipeline is done.

## 3. Schedule Email 5 as a one-off campaign (~Sept 23)

Email 5 is deliberately **not** in the journey (v3's own reasoning: a relative "day N" send
breaks for a date-anchored message). Set it up as a regular campaign instead:

1. **Campaigns → Create Campaign → Regular**.
2. Recipients: the full `Axis & Bloom` audience — segment to **contacts tagged `quiz-completed`**
   if you want to exclude non-quiz subscribers (v3's copy assumes the reader already has a match,
   so this segment is the safer default; check with Dana if the full list should get it instead).
3. Subject: `October 1, you're first`. Preview text: "First access — and the founding package."
4. Content → **Design → Templates** → select the imported `Welcome 5 — October 1, you're first`
   template.
5. **Schedule** (not "send now") for a date **~one week before October 1**, i.e. around
   **September 23, 2026** — v3's own target. Pick a morning send time consistent with the rest
   of the program (Mailchimp's send-time optimization can be enabled if you don't have a strong
   preference).
6. This campaign is separate from — and does not replace — the already-planned **launch-morning
   email** (the one with the real, live order button), which is a different, later deliverable.

## 4. Compliance footer

Every template's footer uses Mailchimp's own compliance merge tags rather than a hardcoded
address, so it always matches whatever is on file:

- `*|LIST:ADDRESS|*` → pulls the audience's saved mailing address (already set — LLC address,
  Union City NJ, per `MANUAL_SETUP_IDS.md`: "CAN-SPAM requirement done"). Nothing to do here
  unless that address changes, in which case update it once under **Audience → Settings →
  Audience name and defaults**, not in these templates.
- `*|UNSUB|*` → the unsubscribe link, present as a real link (not bare text) in every template.

## 5. Regression check

After the journey is live, re-run the standing trio in `../../REGRESSION.md` plus this
workstream's own checklist in `../README.md` (fresh quiz signup → tags/merge field correct;
backfill dry-run; MC-key break test).
