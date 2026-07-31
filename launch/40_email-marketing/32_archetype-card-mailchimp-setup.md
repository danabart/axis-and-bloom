# Plugging Camila's Archetype Card email into Mailchimp

**Dana + Claude, 2026-07-30.** Companion to Camila's `31-mailchimp-email-brief.md` (package:
`misc/marketing/You're __ARCHETYPE__.../You_re _ARCHETYPE_/`). Her brief owns the visuals and
copy; this doc resolves the two placeholders, lists what's already in place, and walks through
the Mailchimp setup. **One code blocker found — see §3; everything else is manual setup.**

---

## 1. What's already in place (verified in the codebase, 2026-07-30)

- **Step 05 (Mailchimp sync upgrade) is executed.** `backend/src/features/marketing/mailchimp.ts`
  upserts members with FNAME + ARCHETYPE merge fields (auto-creates the ARCHETYPE field on the
  audience if missing) and sets tags: `source:<source>`, `archetype:<name>`, `quiz-completed`
  (when source is `post_quiz`), `experimental`. Non-blocking, MC_ENABLED-guarded. A tag test
  script exists at repo root (`test-mailchimp-tags.mjs`).
- **Mailchimp account facts:** datacenter `us11`, audience `a5940f849b`, sender
  `hello@axisandbloomcoffee.com` (verified domain, DKIM/SPF done 2026-07-17), footer address set.
- **Image bucket is live and public:** `gs://axis-bloom-assets` (`axis-and-bloom-prod`,
  us-central1, public read). URL pattern: `https://storage.googleapis.com/axis-bloom-assets/<path>`.
- **The pre-launch curtain only gates `/`** — every other route (`/bloom`, `/find-my-flavor`,
  `/sign-in`, `/the-axis`…) is publicly reachable today, so the email CTA works pre-launch.

## 2. The two placeholders, resolved

### `%%ASSET_BASE%%`

Upload Camila's seven exports (already correctly named) to the bucket, then:

```
%%ASSET_BASE%% = https://storage.googleapis.com/axis-bloom-assets/raw/email/archetype-card
```

Upload (from the package's `31-mailchimp-email-images/` folder, PowerShell):

```powershell
cd "C:\Users\DanaB\axis-and-bloom\misc\marketing\You're __ARCHETYPE__-20260730T010523Z-1-001\You_re _ARCHETYPE_\31-mailchimp-email-images"
gsutil -m cp *.jpg *.png gs://axis-bloom-assets/raw/email/archetype-card/
```

Sanity check: open
`https://storage.googleapis.com/axis-bloom-assets/raw/email/archetype-card/floral-email.jpg`
in a browser. Notes: no `&` in these filenames, so the known gsutil/`&` issue doesn't apply;
the optimizer Cloud Function will also generate unused `optimized/...webp` copies — harmless;
if Camila re-exports Balanced & Sweet (her open item 7.2), re-upload over the same filename and
nothing else changes.

### `%%CTA_URL%%`

Camila's spec: "the page where the user creates an account, sets the Bloom Dial, and pre-orders."
No single page does all three yet (pre-order arrives with Stripe, step 12, September). The best
live destination today is **The Bloom** — public, owns the Bloom Dial, and is where the shop is
merging:

```
%%CTA_URL%% = https://axisandbloomcoffee.com/bloom?utm_source=mailchimp&utm_medium=email&utm_campaign=archetype-card
```

Alternative if the account should come first: `https://axisandbloomcoffee.com/sign-in?redirect=%2Fbloom`
(SignIn honors `?redirect=`), with the same UTMs. **Get Camila's sign-off on the choice** (her
brief reserves this call), and re-point the URL when the real account/dial/pre-order page ships
in September — that's a one-field edit in the Mailchimp template.

## 3. BLOCKER — the ARCHETYPE values don't match the template (code fix needed first)

Camila's template branches on **exact lowercase slugs**: `floral` · `fruity` · `balanced` ·
`chocolate` · `earthy` · `experimental`. But the sync writes **display names** into the
ARCHETYPE merge field — the quiz gate sends `ARCHETYPES[key].name` ("Balanced & Sweet",
"Chocolate & Nutty"…) via `subscribeNewsletter`, and `mailchimp.ts` passes it straight through.
As it stands, **every send would miss all six variants and render the fallback block.**

Cleanest fix: map display name → slug inside `mailchimp.ts` (one choke point — covers the live
sync *and* the backfill, and the DB keeps storing display names untouched). Per our working
rule, the change goes through Claude Code — ready-to-run prompt:

```
Read launch/README.md for context. In backend/src/features/marketing/mailchimp.ts, the
ARCHETYPE merge field and the archetype:<x> tag currently receive archetype display names
(e.g. "Balanced & Sweet"). Camila's Mailchimp template (misc/marketing/You're __ARCHETYPE__
-20260730T010523Z-1-001/You_re _ARCHETYPE_/31-mailchimp-email-brief.md §4) branches on exact
lowercase slugs: floral, fruity, balanced, chocolate, earthy, experimental.

Add a toArchetypeSlug(name) helper in mailchimp.ts that normalizes any known variant to those
slugs — "Floral"→floral, "Fruity"→fruity, "Balanced & Sweet" (and "Balanced and Sweet")→
balanced, "Chocolate & Nutty" (and "Chocolate and Nutty")→chocolate, "Earthy" and legacy
"Spicy & Earthy"/"Spicy and Earthy"→earthy, "Experimental"→experimental, case-insensitive;
an unrecognized value logs a warning and passes through unchanged. Apply it to BOTH the
ARCHETYPE merge field value and the archetype:<slug> tag in syncMailchimpMember/buildTags.
Do not change the subscribe API shape, the frontend, or what the DB stores. Update
test-mailchimp-tags.mjs to assert the slug round-trip for "Balanced & Sweet".

ACCEPTANCE: a fresh post-quiz signup with archetype "Balanced & Sweet" appears in Mailchimp
with ARCHETYPE=balanced and tags quiz-completed + archetype:balanced; the test script passes.
```

After it deploys, run one real quiz signup and confirm ARCHETYPE holds a slug before building
the journey. (Existing members synced with display-name values will be corrected the next time
they're upserted — the backfill run in §5 rewrites them all.)

## 4. Building it in Mailchimp (manual, ~30 min)

1. **Template:** Campaigns → Email templates → Create → **Code your own / Paste in code** →
   paste `31-mailchimp-email-production.html` **after** replacing both placeholders (do the
   replace in a copy of the file first — search for `%%`, two distinct values, multiple
   occurrences of ASSET_BASE). Name it `Archetype Card v1`.
2. **Journey:** Automations → Customer Journeys → new journey on audience `a5940f849b`.
   - **Starting point: "Tag added" = `quiz-completed`.** Not "signs up to the audience" —
     the audience also receives newsletter/pre-launch/footer signups that have no quiz result;
     Camila's fallback block is a safety net, not a valid state. The gate flow + step 05
     guarantee that everyone tagged `quiz-completed` has ARCHETYPE populated (post slug fix).
   - **Journey settings: one entry per contact, ever** (her "one send per subscriber" rule —
     returning quiz-takers must not get it twice).
   - **Single step: Send email**, immediately. Subject: `Your archetype card is here`.
     Preheader is embedded in the HTML. From: Axis & Bloom / `hello@axisandbloomcoffee.com`.
     Leave FNAME **without** a static default — the template's conditionals handle absence.
   - Attach the **plain-text** version (`31-mailchimp-email-production.txt`) as the
     plain-text alternative.
3. **Do not enable yet** — QA first (§6).

## 5. Backfill decision (make it before enabling)

The step-05 backfill script tags every existing subscriber. Order matters:

- Backfill **before** the journey is turned on → existing quiz-takers get tagged quietly, no
  email. The journey then only fires for new completions.
- Backfill **after** the journey is on → every past quiz-taker enters the journey and receives
  the Archetype Card.

Given the list is small and pre-launch, **after** is probably what we want (everyone gets their
card once), but it's Dana's call — and either way, run the backfill only after the §3 slug fix
is deployed, so the rewritten ARCHETYPE values are slugs.

## 6. QA before enabling — Camila's §8 checklist, in practice

Use Mailchimp's preview/test-send with a seeded test contact, changing its ARCHETYPE merge
value between sends:

- [ ] Six test sends (`floral`, `fruity`, `balanced`, `chocolate`, `earthy`, `experimental`) to
      real inboxes — Apple Mail, Gmail web, Gmail mobile, Outlook desktop: right photo, color
      line, word set, paragraphs each time.
- [ ] FNAME empty → headline "Your match is in.", footer "TO: YOU".
- [ ] ARCHETYPE empty → fallback block, no broken image (safety net only).
- [ ] Images off → alt text reads, button works.
- [ ] Mobile 375px, dark-mode spot check (Gmail iOS / Apple Mail).
- [ ] Button + footer links resolve; CTA carries the UTMs; `*|LIST:ADDRESSLINE|*` shows the
      correct legal address (check the audience's list profile).
- [ ] Plain-text variant renders the right archetype logic.
- [ ] Fire test: one live quiz → email arrives within minutes → contact shows exactly one send.
- [ ] Screenshots (desktop + 375px, per archetype) back to Camila before enabling — her §9.

## 7. Open items ledger

| Item | Owner | Status |
|---|---|---|
| Slug mapping fix (§3) | Claude Code prompt above | ⬜ blocker |
| Upload 7 images + verify URL | Dana (commands above) | ⬜ |
| CTA URL sign-off (/bloom vs sign-in-first) | Camila | ⬜ |
| Balanced & Sweet card contrast re-export | Camila | ⬜ (swap-in, same filename) |
| Journey build + QA + enable | Dana | ⬜ after blockers |
| Backfill timing decision | Dana | ⬜ |
| Re-point CTA to real pre-order page | Dana | later (Sept, with Stripe) |

Once §3 + the uploads are done and QA passes, enabling the journey completes the July
pipeline's finish line: live quiz → Archetype Card in the inbox within minutes.
