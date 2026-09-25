# Claude Code Prompt — Stop the recognized-guest resync from rewriting subscriber archetypes, and repair the rows it already rewrote

> **PARKED — do not run.** Dana, 2026-09-24: the subscriber-archetype drift is a separate problem from the
> secondary-archetype work and will be addressed on its own later. This file is kept as the diagnosis
> record and a ready brief. Nothing in the two interpretation briefs depends on it.
>
> Written 2026-09-24. Diagnosis confirmed from `api_event` on 2026-09-24.

## What is happening (confirmed)

`FlavorQuiz.tsx` has a "recognized guest resync" effect (around line 855):

```ts
useEffect(() => {
  if (!resultsArchetypeData || (user && !user.isAnonymous) || !postQuizEmail) return;
  const name = ARCHETYPES[archetypeKey].name;
  ...
  subscribeNewsletter({ email: postQuizEmail, source: 'post_quiz', archetype: name, ... })
}, [user, postQuizEmail, resultsArchetypeData, archetypeKey]);
```

`resultsArchetypeData` is derived from `archetypeKey`, whose initial state is `'balanced'`, and the
archetype list it looks up in is fetched on mount. So on **every page load** of the quiz by a
recognized guest (email remembered in localStorage), before any question is answered, the effect sees
"Balanced" and posts a subscribe call with `archetype: 'Balanced'`. `POST /api/newsletter/subscribe`
upserts with `archetype = COALESCE(EXCLUDED.archetype, newsletter_subscriber.archetype)`, so the
supplied value always wins, and `syncMailchimpMember` re-tags Mailchimp with it too.

Evidence from `api_event` (`call_type = 'POST /api/newsletter/subscribe'`) for four crawl subscribers
who scored Chocolate & Nutty: each shows the correct value at signup (two calls within ~200 ms: the
card submit plus this effect firing with the correct key), then one or more later calls carrying
`Balanced & Sweet` / `Balanced` with a **fresh** `quizSessionKey` and `is_anonymous` null (fired before
auth resolved). One subscriber fired it 3 s and 11 s after signing up (page reloads); another fired it
three times on 2026-09-23. Their `quiz_session` rows are all Chocolate & Nutty; nobody scored Balanced.

Impact: `newsletter_subscriber.archetype` and the Mailchimp archetype tag drift to Balanced for any
non-Balanced guest who returns to the quiz page. Balanced subscribers are affected invisibly. The
welcome email was not affected (`sendQuizCompleteEmailOnce` ran on the first, correct call).

## Part A — frontend guard (`FlavorQuiz.tsx`)

1. The resync effect must only run when there is a **scored result in this mount**: add
   `scoreData` to the guard (`if (!scoreData || !isComplete ...) return;`) and derive the archetype
   name from the scored/branched result, not from the `archetypeKey` default. Keep the ref-based
   "sync once per archetype" behaviour.
2. Apply the same guard to the signed-in auto-subscribe effect just below it (line ~873): it has the
   same shape and the same latent bug for signed-in users who revisit the page.
3. `handleRetake` resets `archetypeKey` to `'balanced'`; after the guard this no longer reaches the
   subscribe call, but confirm with a test or a manual check that a retake does not fire a subscribe
   until the new result is scored.
4. Add a `reportError`-free `console.debug` line when the resync fires, with the archetype and the
   reason (`'scored'` / `'branched'`), so the next drift is visible in the browser without guessing.

## Part B — backend defence (`backend/src/routes/newsletter.ts`)

The upsert should not accept a quiz-derived archetype that has no quiz behind it. Minimal change:
when `source === 'post_quiz'` and the payload carries `archetype` but **no** `quizSessionKey`, treat
`archetype`, `experimental`, `confidence` as absent (they then COALESCE to the existing values). The
legitimate paths (gate submit, post-score resync, signed-in auto-subscribe) always send
`quizSessionKey`. Log a one-line warning with the email hashed (never the plain address) when this
strips a value, so we can see whether any other caller trips it.

Do not add stronger validation (e.g. checking the session key exists) in this brief; keep the change
small and observable.

## Part C — repair (one-off script, `backend/scripts/repairSubscriberArchetypes.ts`)

Read-only first, then a guarded write:

1. **Report**: for every `newsletter_subscriber` with a `user_id`, compare `archetype` with the
   `coffee_archetype.name` of the user's **latest** `quiz_session`. List the mismatches with email,
   stored, latest-session archetype, latest `completed_at`, and the count of `api_event` subscribe calls
   for that email carrying an archetype that never appears on any of their sessions. Print the report
   and stop unless `--apply` is passed.
2. **Apply** (`--apply`): for each mismatch, `UPDATE newsletter_subscriber SET archetype = <latest
   session archetype>, experimental = <session experimental>` and re-run `syncMailchimpMember` for that
   email so the Mailchimp tag follows. Wrap in a transaction, log each row before and after, and write
   the report to `backend/scripts/out/repair_subscriber_archetypes_<timestamp>.json`.
3. Never touch `quiz_session`. Never touch subscribers without a `user_id` or without any session.
   Expected on 2026-09-24 prod: at least Thyago, Maryann, Hannah, Suzanna (Chocolate & Nutty), possibly
   more since Sunday. Dana runs the script; it is not part of the deploy.

## Verification

- Unit/dev: recognized guest loads `/find-my-flavor` → no subscribe call; completes the quiz → exactly
  one resync with the scored archetype; branch switch → one resync with the branch archetype;
  retake → nothing until the new score.
- `api_event` after deploy: `SELECT COUNT(*) ... WHERE call_type = 'POST /api/newsletter/subscribe' AND
  request_body->>'source' = 'post_quiz' AND request_body->>'quizSessionKey' IS NULL` over the next days
  should be 0 from the new bundle.

## Report back (`WHAT_WE_BUILT.md`, next sequential number)

The guard as implemented, the backend rule, and the repair report (count of rows fixed, Mailchimp
re-sync result). Note for the record that `newsletter_subscriber.archetype` is a *derived* copy of the
latest session and that the session table is the source of truth.
