# Feature: Social short links — /ig and /fb

> Folder: `backend/src/features/hoboken_crawl/` · Decided: 2026-09-10 (Dana) · Model: Sonnet is fine (tiny frontend-only change)
> Status: ✅ executed 2026-09-10 (WHAT_WE_BUILT.md #177)
> Depends on: `CLAUDE_CODE_PROMPT_SOCIAL_CAMPAIGNS.md` executed (#175). Independent of `CLAUDE_CODE_PROMPT_CAMPAIGN_QUIZ_FASTSTART.md` (run in either order; if fast-start is live, short-link arrivals also start on question 1 automatically).

## What this is

Instagram-bio-friendly short URLs. `axisandbloomcoffee.com/ig` and `axisandbloomcoffee.com/fb` forward to the existing full campaign links, so every mechanism that already works (`CampaignQueryReader` stamp + vid, landing beacon, funnel columns, Mailchimp `campaign:` tag, GA4 UTMs, views) fires exactly as if the long URL had been clicked. **No logic lives in the short links.**

## Decisions already made (Dana, 2026-09-10) — do not re-open

1. Exactly two short links: `/ig` → instagram, `/fb` → facebook. No `/quiz` (one shared short link would collapse the per-channel attribution Dana chose).
2. Pure client-side forward to the canonical long URL — the address bar ends on `/find-my-flavor?campaign=...&utm_...`, which is what GA4 and the reader consume. No new stamp/beacon code, no backend, no schema.

## TASK (frontend only)

1. In `App.tsx`, add two routes rendering react-router's `<Navigate replace>` to the exact canonical URLs:
   - `/ig` → `/find-my-flavor?campaign=instagram&utm_source=instagram&utm_medium=social&utm_campaign=launch-2026`
   - `/fb` → `/find-my-flavor?campaign=facebook&utm_source=facebook&utm_medium=social&utm_campaign=launch-2026`
   Define the two target strings next to each other in one small constants block (a `SHORTLINKS` map) with a comment pointing at this brief, so a future channel is one line. Use `replace` so Back doesn't bounce through the short path.
2. Gate: add `/ig` and `/fb` to `PRELAUNCH_OPEN_ROUTES` in `prelaunch.ts` (one comment line; the target `/find-my-flavor` is already open). Not in nav/footer.
3. Nothing else. `/crawl`, the reader, the quiz, the backend are untouched.

## CONSTRAINTS

`vite build` + `npx tsc --noEmit` clean (zero new errors). No new components beyond what `<Navigate>` needs; no duplicated campaign constants beyond the two URL strings (they are links, not logic — do not import `CAMPAIGNS` to build them dynamically, plain strings are more greppable and match what marketing distributes).

## DONE = one commit pushed to `main` (`campaigns: /ig and /fb short links`), deploy green, acceptance verified live, WHAT_WE_BUILT.md entry, Status flipped. One report.

## ACCEPTANCE (live production, fresh browser)

1. `axisandbloomcoffee.com/ig` (gated, no preview): lands on the quiz with the full URL in the address bar; `localStorage.ab_campaign` slug `instagram`; one `campaign_landing_event` row with the UTMs. Same once for `/fb` → `facebook`.
2. If the fast-start brief is live: `/ig` lands on question 1; otherwise on today's entry screen. State which was in effect.
3. `/ig?preview=true`: params survive the forward OR the bypass still unlocks the site via the target page — verify the bypass works end to end, and if `<Navigate>` drops the extra query params, carry them through (spread the incoming search params onto the target, `campaign`/`utm_*` taking precedence).
4. Back button from the quiz leaves the site (no /ig loop).
5. `vite build` + `npx tsc --noEmit` clean; cleanup of the marked test rows.
