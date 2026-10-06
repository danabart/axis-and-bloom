# Feature: Roastery Portal, part 5 (admin preview of a roastery's form, with no impact)

> Folder: `backend/src/features/roastery_portal/` · Decided: 2026-10-06 (Dana) · Model: Sonnet is fine
> Status: EXECUTED 2026-10-06 (commit 3f7a698). Deployed, startup log clean, acceptance verified live (the interactive pass ran on a localhost harness with real production data, see the note); see WHAT_WE_BUILT.md #215.
> Depends on: parts 1 to 4 (executed, `WHAT_WE_BUILT.md` #209, #210, #212, #213).

## What this is

Today the only way to see a roastery's form is to create a link and open it, which registers the admin as a respondent of that roastery and saves real drafts. That is why part 4 had to purge. This brief adds an admin preview: Dana and Camila open any roastery's form exactly as the roaster sees it, click through it, and nothing is recorded anywhere.

## Decisions already made (Dana, 2026-10-06). Do not re-open.

1. **Preview needs no link.** It opens from the admin page for any roastery with a lineup, whether or not a link exists.
2. **Preview has zero impact.** No respondent is created, no draft or submit is saved, no link's "last opened" changes, no email is sent, no lineup coffee is added. The roastery's progress, counts and "last saved by" are identical before and after any amount of previewing.
3. **Preview is the real form, not a copy.** It renders the same partner components the roaster gets, so what the admin sees is what ships. No second implementation of any screen.
4. **Preview is interactive.** Chips, scales, notes, the wheel picker and the conditional questions all respond, so the form can be tried on a phone. Changes live in the browser only and are gone on refresh.
5. **Preview shows the roastery's current state.** If the roaster has drafts or submitted coffees, the preview shows their answers and statuses as the roaster would see them. If nothing is filled, it shows the empty form.
6. Admins only.

## Task 0: confirm before editing (report in the final report; STOP only if one contradicts this brief)

- How `RoasteryPortal.tsx`, `LineupScreen.tsx`, `CoffeeScreen.tsx`, `NotesSection.tsx` and `WhoScreen.tsx` reach the server today (the `portalApi` object in `roastery-portal/api.ts`), and every place a screen calls it.
- Which reads the public landing and coffee endpoints perform, so the admin preview endpoints can return the identical shapes from the same read functions.
- That the public `GET /:token` calls `touchLink`, so preview must not go through it.
- How the admin frontend attaches the admin's auth to API calls.

## TASK

### Backend

1. Two admin read endpoints under `/api/admin/roastery-portal` (`requireAdmin`), returning exactly the shapes of the public `GET /:token` and `GET /:token/coffees/:id`:
   - `GET /roasteries/:roasterId/preview`
   - `GET /roasteries/:roasterId/preview/coffees/:portalCoffeeId`
   Both call the existing functions in `roasteryPortalReads.ts`. No new SQL outside that file, no token, no `touchLink`, no write of any kind. A coffee id from another roastery returns 404.
2. No preview write endpoints exist. Nothing in `roasteryPortalService.ts` changes.

### Frontend

1. Give the partner screens their API client through one seam (a prop or a small context) instead of importing `portalApi` directly. The public route passes the existing `portalApi`, unchanged in behaviour.
2. A preview client with the same interface:
   - `landing` and `getCoffee` call the two admin endpoints with the admin's auth.
   - `registerRespondent`, `addCoffee`, `saveDraft`, `submit`, `saveLineup`, `submitLineup` make **no network request**. They resolve locally with plausible results so the screens behave normally (the draft indicator, the move to the next coffee, a locally added coffee row for this session).
3. Routes inside the admin area, behind `AdminRoute`: `/admin/roastery-portal/:roasterId/preview` and `/admin/roastery-portal/:roasterId/preview/coffee/:id`, rendering the same `RoasteryPortal` screens with the preview client, outside the admin layout chrome so the page looks as the roaster sees it. Navigation inside the preview stays inside the preview routes.
4. A fixed, slim banner on every preview screen: "Preview. Nothing you do here is saved." with a "Back to admin" link. It must not cover the form on a phone.
5. The "Who is filling this in?" screen is shown first in preview, with the link contact prefill if a link exists, and continues without saving or storing anything (no localStorage write).
6. `AdminRoasteryPortal.tsx`: a "Preview form" button on each roastery that has at least one active lineup coffee. It works with no link, with an active link, and with a revoked link.
7. The preview client must never import or call the public `portalApi`. Add a test that fails if any preview-mode action issues a request to `/api/roastery-portal`.

## CONSTRAINTS

- No schema change. No change to the public portal routes or to what a roaster experiences.
- No new shared components beyond the API seam and the banner. No copy of any screen.
- Both portal lints green, including the read lint.
- Do not act as Dana or any real person. Use a marked `Zzz Test` admin for checks, demoted and disabled at the end.
- `npx tsc --noEmit` clean in backend, no new frontend errors, `vite build` clean, existing tests green. Add tests for: the two preview endpoints require admin and return the public shapes; another roastery's coffee id returns 404; previewing changes no row (see acceptance 3).

## DONE = commits pushed straight to `main`, deploy green, startup log clean, acceptance verified live, `WHAT_WE_BUILT.md` entry, Status above flipped. One report at the end.

## ACCEPTANCE (live production)

Use Utopian for the read-only checks; it is real data and must end exactly as it started. Take a row-count and checksum of every `roastery_portal_*` table before step 1.

1. Signed out, both preview URLs redirect to sign-in or refuse. Signed in as a non-admin: refused. As the test admin: the preview opens for Utopian with no link existing.
2. In the preview at 390 wide: pass the who screen, open a coffee, tap chips and scales, add two notes and pick a wheel term, switch Blend on and off, press SAVE COFFEE, open the next coffee, fill the lineup block, add "a coffee not listed". Everything responds as on the real form.
3. After step 2: the row counts and checksums of every `roastery_portal_*` table are identical to the snapshot. No respondent, no response, no link change, no new lineup coffee, no `transactional_email_log` row. The browser's network log for the session shows zero requests to `/api/roastery-portal`.
4. Refresh the preview: everything entered in step 2 is gone and the form is back to the stored state.
5. Showing real state: on the Zzz Test Roastery, create a test link and submit one coffee through the real public form, leaving a second as a draft. Preview for Zzz then shows the first as Submitted and the second as In progress with its answers. Clean up as in part 3 (revoke the link, deactivate the lineup rows). This step is the only one that writes, and it writes to Zzz only.
6. The public form for a real link is unchanged: with the Zzz test link from step 5, saving and submitting still work exactly as before this brief.

**Nothing created, changed or submitted for Utopian or any real roastery. Do not create a Utopian link.**
