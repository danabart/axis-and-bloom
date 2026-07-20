# Step 05 (C1) — Mailchimp sync upgrade: tags, merge fields, backfill

> Order: 5 of 10 · Model: Sonnet · Depends on: Step 04 (archetype data reaches the subscribe endpoint). After this step: build the Mailchimp Customer Journey (manual) — the July pipeline is then complete.

CONTEXT: backend/src/routes/newsletter.ts syncs subscribers to Mailchimp via member upsert (PUT lists/{list}/members/{md5(email)}) sending ONLY email + FNAME, status 'subscribed', non-blocking, guarded by MC_ENABLED. The DB now stores source, archetype, experimental, confidence per subscriber (Step 04). Marketing needs archetype segmentation and a journey trigger.

TASK:

1. Extend the Mailchimp sync to also send:
   - merge_fields: FNAME (existing) + ARCHETYPE (create the merge field via API if missing, or document the one-time manual step)
   - tags via the member tags endpoint (POST .../members/{hash}/tags): "source:<source>", "archetype:<archetype>" (when present), "quiz-completed" (when source = post_quiz), "experimental" (when experimental = true).
2. Keep the sync non-blocking and MC_ENABLED-guarded exactly as today; tag failures must not fail the signup (log and continue).
3. Backfill script (repo root, like test-mailchimp.mjs): reads all newsletter_subscriber rows, upserts each to Mailchimp with FNAME + available tags, rate-limited (Mailchimp allows ~10 concurrent), idempotent, prints a summary. Dry-run flag.
4. Update test-mailchimp.mjs (or add a sibling test script) to verify a tag round-trip.

CONSTRAINTS: put the extended sync + backfill logic in backend/src/features/marketing/ (routes/newsletter.ts stays a thin registration importing from it); do not change subscribe API shape (frontend already updated); no new dependencies unless necessary.

ACCEPTANCE: new post-quiz signup appears in Mailchimp tagged quiz-completed + archetype:<name> with ARCHETYPE merge field populated; backfill dry-run lists existing subscribers correctly, real run tags them.
