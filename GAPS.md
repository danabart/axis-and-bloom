# Gaps — Consciously Deferred

Things found and deliberately not fixed, with the reasoning on record — so a future audit doesn't re-discover them from scratch or assume they're unknown. Created by HOME Task 9 (2026-08-04); see `SOMMELIER_BUILT.md`'s HOME Task 9 (S88) entry for the full context each of these came from.

## Launch-blocking (not home_v3 defects, but block the home_v3 loop from ever firing)

1. **Real checkout doesn't work — OT-6.** Zero of 52 active `roaster_blend` rows have a `shopify_variant_id`; `POST /api/orders`'s Shopify draft-order call has nothing to attach as a line item. Zero real orders exist in production. This is a roastery product-catalog sync gap, not a code defect — `createOrder()` itself is correctly implemented (confirmed: it makes a real, correct Shopify Admin API call). Nothing in Tasks 6/7/8 (arrival notes, beats, brew cards from a real order) can ever fire for a real customer until this is done. Human/business setup item.
2. **`axisandbloomcoffee.com` is not verified with Resend.** Found while trying to prove OT-16 (real Resend delivery) — even with the real production API key, every transactional send returns `403 — domain not verified`. Blocks arrival notes, dial-in beat emails, and the two pre-existing sponsored-lifecycle emails equally. DNS/Resend-side setup, not a code fix. The code-side half of OT-16 (checking the send result before marking sent) is fixed; this half isn't something a repo change can close.
3. **OT-15 — no Cloud Scheduler job for `brew-card-arrival-send`.** Confirmed via `gcloud scheduler jobs list`: only `purge-stale-anonymous-guests` exists. `liam-sms-send` (OT-2) is in the same state. Both are five-minute fixes once someone has Cloud Scheduler access — see `OPEN_TASKS.md` for the exact `gcloud scheduler jobs create` commands already written out.

## Real defects found and fixed this pass (recorded so the *fix* isn't mistaken for a still-open gap)

- Coffee 32 (and five more coffees) had cached AI refusals or stale-name leaks in `ai_summary`/`surprise_note` — fixed (nulled or mechanically stripped) directly against prod. See S88's own entry for the full list and reasoning per coffee.
- `RECOMMENDATION_MISS` never fired, and `outcomeTracker.ts`'s two outcome queries never wrote a result — a missing Firestore composite index, silently swallowed by a bare `catch`. Three indexes created; confirmed fixed.
- Four `resend.emails.send()` call sites in `cron.ts` never checked the send result before marking delivery successful — fixed at all four sites.

## Closed since S88

1. **`archetype_relationship` table (was flagged item 1) — CLOSED, S89 (HOME Task 9b).** `getAdjacentArchetypes()` migrated off the dead table onto `v_archetype_adjacency` (the real, actively-curated Bloom Dial hop-derived view); empty result now falls back to the hardcoded adjacency map the same as a thrown error (the S88 finding's actual root cause — empty ≠ error, pre-fix). `archetype_range`/`alternatives` RAG counts rose from `[2, 4]` (S88, degraded) to `[6, 6]` (S89, real multi-archetype spread) against the identical prod inputs. Table itself left in place, not dropped, with a `DEPRECATED` comment in `schema.sql`. See `SOMMELIER_BUILT.md`'s S89 entry for the full before/after.
2. **Missing `firestore.indexes.json`/`firebase.json` (was flagged item 2) — CLOSED, S89 (HOME Task 9b).** `firestore.indexes.json` created at repo root, generated directly from `firebase firestore:indexes` against live prod (guaranteed exact match by construction, not hand-typed). `firebase.json` — which does exist at repo root (already carrying real Hosting config; the task's premise that it existed was correct, an earlier pass's own audit had missed it) — extended with a `firestore` entry targeting the named `axis-bloom-fs` database. Not wired into CI this pass (declared-and-documented was the explicit goal). **A fourth, previously-undiscovered live instance of the same bug class was found and fixed during the required silent-catch audit**: `sommelier.ts`'s `RECOMMENDATION_MISS` handler (`excludeCoffeeIds`, a `sentiment` EQ + `createdAt` orderBy-DESC query — a different composite index than the one S88 created for `userSignals.ts`'s ASC-ordered version of the same shape) was also throwing `FAILED_PRECONDITION` on every call, silently swallowed by a bare `catch {}`. Fourth index created; catch upgraded to the unmissable-log-tag pattern. See `SOMMELIER_BUILT.md`'s S89 entry for the full silent-catch verdict table.

## Flagged, deliberately not fixed (real, but out of this task's own scope)

1. **One soft, debatable voice-pass finding, not auto-fixed.** A turn 4 Liam reply ("floral because it actually appeals to you, or because it seemed like a safe bet?") rhymes with S32's banned WHY-question pattern without using its literal phrasing. Judged genuinely ambiguous — flagged for whoever does the next monthly transcript read (S33's own cadence) rather than editing the prompt off one instance. Stays with the monthly transcript read, per Dana.
2. **E5 welcome email token-allowance wording** — still open from S72 (Task 3). Not re-checked this pass; still needs the reword to full-sommelier-access framing before it ships. Stays with the email workstream (`OPEN_TASKS.md`).

## Status updates (2026-08-04, post-S88 review with Dana; items 1/2 below closed by S89 — see above)

- **OT-6 (Shopify sync):** known and in progress — Dana is actively connecting the roasteries. Remains the launch long pole.
- **OT-15 / OT-2 (Cloud Scheduler jobs):** Dana currently cannot access GCP (console access issue) — parked here until access is restored. The exact `gcloud scheduler jobs create` commands are in `OPEN_TASKS.md`. Only `brew-card-arrival-send` is launch-relevant; `liam-sms-send` can wait for OT-17 (SMS day).
- **Resend domain verification:** Dana believes it may have been done before — being re-checked in the Resend dashboard now; will be updated here.
