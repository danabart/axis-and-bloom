# Feature: the printed bag QR's short address, `/b`

> Folder: `backend/src/features/bag_qr/` · Decided: 2026-10-05 (Dana) · Model: Sonnet is fine
> Status: executed 2026-10-05 (`WHAT_WE_BUILT.md` #208, `SOMMELIER_BUILT.md` S104)
> Depends on: `ai_agent_liam/home_v3/` HOME_TASK_7, 7C, 7E (all executed). Amends 7E's universal-token behaviour.

## What this is

The bag artwork is going to print with one QR on the front, captioned "Scan to see how this coffee matches you." The ink encodes exactly:

`https://axisandbloomcoffee.com/b`

That address does not exist yet. Today only `/b/:token` exists (`frontend/src/app/App.tsx`, `QrDoor.tsx`, `GET /api/qr/:token/resolve` in `backend/src/routes/qr.ts`). This task makes the bare `/b` a permanent alias for the ONE canonical universal token (7E decision #0, `CANONICAL_UNIVERSAL_QR_SOURCE` in `services/qrDoor.ts`), and changes where a universal scan lands.

Print is immutable: once bags exist, `/b` must resolve forever. The server decides the destination; the ink never does.

## Decisions already made (Dana, 2026-10-05). Do not re-open.

1. The printed address is the bare `/b`. No token in the ink.
2. Signed-in customer (has any order or sponsorship) lands on their profile with the Past Orders tab open: `/profile?tab=orders`. (7E sent them to `/profile`, which opens Flavor Memory.)
3. Signed-in, not a customer: the quiz, `/find-my-flavor`. Unchanged from 7E.
4. Signed out (including the automatic anonymous Firebase session): a small page with two doors, rendered at `/b` itself. This replaces 7E's straight bounce to sign-in for universal scans.
   - Door 1, "I have a profile": goes to sign-in with the Sign In tab preselected, then returns to `/b`, which now resolves as signed in (decision 2 or 3).
   - Door 2, "I'm new here": goes to `/find-my-flavor`.
5. One behaviour, one code path. The long form `/b/<canonical universal token>` must behave identically to `/b`. Per-coffee tokens (`coffees.qr_token`) are untouched by this task in every state.
6. Every scan still logs exactly one `qr_scan_event` row.

## Task 0: confirm before editing (report findings in the final report; STOP only if one contradicts this brief)

- `routes/qr.ts` universal branch and `QrDoor.tsx` are as described above.
- How `schema.sql` adds a value to an existing enum elsewhere (precedent for `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, and whether the boot apply runs it inside a transaction). Follow that precedent.
- `Profile.tsx` honours `?tab=orders` (it reads `tabParam` against `VALID_TABS`).
- `SignIn.tsx` hard-codes the initial tab to `'create'` and reads `?redirect=`.

## TASK

### Backend

1. `services/qrDoor.ts` / `routes/qr.ts`: extract the universal branch into one function used by both routes (same file split as today: resolution logic in the service, request plumbing in the route).
2. New route `GET /api/qr/resolve` (no token): same `qrResolveLimiter` and `optionalAuth`. It gets the canonical token via `getOrMintCanonicalUniversalToken()` and runs the shared universal function. It never 404s.
3. Shared universal function outcomes (reuse the existing `isRealSignIn` rule verbatim, anonymous is NOT signed in):
   - signed out → `{ status: 'doors' }`, logged `auth_state 'signed_out'`, `destination 'door_choice'` (new enum value, see 4).
   - signed in, `hasAnyOrderOrSponsorship` true → `{ status: 'profile' }`, logged as today (`'owner'` / `'bag_view'`).
   - signed in, not a customer → `{ status: 'quiz' }`, logged as today (`'no_orders'` / `'brand_landing'`).
   - Log rows for bare `/b` carry the canonical token in `token`, `token_type 'universal'`, `source` = the canonical source, exactly like a long-form scan.
4. `schema.sql`: add `'door_choice'` to `qr_destination_enum`, following the Task 0 precedent. Add it to the `QrDestination` type. No other schema change.
5. `GET /api/admin/qr/universal-tokens`: add `printedUrl: \`${QR_BASE_URL}/b\`` to the response. Keep `token` and `url`.

### Frontend

6. `App.tsx`: add `<Route path="/b" element={<QrDoor />} />` next to `/b/:token`, inside `PublicLayout`, not wrapped in `PrelaunchGate`. Add `'/b'` to `PRELAUNCH_OPEN_ROUTES` in `lib/prelaunch.ts` with a one-line comment (documentation list, same as `/b/:token`).
7. `lib/api.ts`: `resolveQrToken(token?: string)` calls `/qr/resolve` when there is no token. Add `{ status: 'doors' }` to `QrResolveResult`.
8. `QrDoor.tsx`:
   - Remove the `if (!token) return <Navigate to="/" />` bounce; no token means the bare bag address.
   - `status 'profile'` → `<Navigate to="/profile?tab=orders" replace />`.
   - `status 'doors'` → render the two-door page (below). The sign-in door returns to the address the visitor arrived on: `/b`, or `/b/${token}` for a long-form scan.
   - `status 'sign_in'` keeps its current behaviour; it is now reached by per-coffee tokens only.
9. `SignIn.tsx`: honour an optional `?mode=signin` that preselects the Sign In tab. Default stays `'create'`. Door 1 links to `/sign-in?mode=signin&redirect=<encoded return address>`.
10. `AdminQrDoor.tsx`: show `printedUrl` as "the printed address". Keep the token line, labelled as the long form.

### The two-door page

Reuse the existing look of `QrDoor.tsx`'s states (RUST `#a33726`, uppercase tracked links, existing type scale). No new shared components, no new colours, no new fonts. Mobile first: this page is only ever opened from a phone camera.

Copy (positive register only, no em dashes):

- Eyebrow: `FROM: AXIS & BLOOM · TO: YOU`
- Heading: `See how this coffee matches you.`
- Door 1 label: `I have a profile` · line under it: `Sign in to see your coffee and your flavor memory.`
- Door 2 label: `I'm new here` · line under it: `Take the quiz and find your flavor.`

## CONSTRAINTS

- Do not touch per-coffee token resolution, `customer_bag_claim` writes, minting, or the token caches.
- No new Firestore config. No new tables. The only schema change is the one enum value.
- No raw coffee or roaster names on any customer surface (house rule).
- `npx tsc --noEmit` clean in backend and frontend, `vite build` clean, all three lints and the boot integrity checks green, existing `qrDoor.test.ts` still green.
- No dev environment: production only, with marked test data, cleaned up afterwards.

## DONE = one commit pushed straight to `main` (`qr: /b short address + two-door landing`), deploy green, acceptance verified live, `WHAT_WE_BUILT.md` entry (the full record), a short pointer entry in `SOMMELIER_BUILT.md` (next S number) because this amends 7E, Status above flipped. One report.

## ACCEPTANCE (live production, phone-sized viewport)

1. Signed out, fresh browser: `axisandbloomcoffee.com/b` shows the two-door page. One `qr_scan_event` row: `signed_out` / `door_choice` / `universal`.
2. Door 2 lands on `/find-my-flavor`.
3. Door 1 opens sign-in with the Sign In tab selected. After signing in with a marked test account that HAS an order line: lands on `/profile?tab=orders` with Past Orders open. Row: `owner` / `bag_view`.
4. Same flow with a signed-in account with no orders: lands on the quiz. Row: `no_orders` / `brand_landing`.
5. Already signed in, open `/b` directly: goes straight to the destination, no door page flash beyond the loading state.
6. `/b/<canonical universal token>` behaves identically in all three states.
7. A per-coffee token URL behaves exactly as before this task (state which token was used).
8. `/b` works while `VITE_PRELAUNCH_MODE` is on, without `?preview=true`.
9. Back button from each destination does not loop through `/b`.
10. Admin QR page shows `https://axisandbloomcoffee.com/b` as the printed address.
11. Test rows and test order data cleaned up; counts before/after stated.
