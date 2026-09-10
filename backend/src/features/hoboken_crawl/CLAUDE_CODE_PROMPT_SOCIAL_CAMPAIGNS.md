# Feature: Social campaign links — instagram + facebook slugs + generic `?campaign=` reader

> Folder: `backend/src/features/hoboken_crawl/` · Decided: 2026-09-10 (Dana) · Model: Sonnet is fine (small extension of a shipped mechanism)
> Status: ✅ executed 2026-09-10 (WHAT_WE_BUILT.md #175)
> Depends on: Crawl Parts 1+2 executed and live (WHAT_WE_BUILT.md #173 + #174). The campaign mechanism (stamp + vid + landing beacon + funnel/subscriber columns + Mailchimp tag + views) is reused as-is; this task adds two slugs and one small reader. **No schema changes.**

## CONTEXT — verified in code 2026-09-10, not assumed

- `frontend/src/app/lib/campaign.ts`: `CAMPAIGNS` map (currently only `hoboken-crawl-2026`), `rememberCampaign(slug)` (keeps `vid` on same-slug re-stamp), `getActiveCampaign()`, 30-day TTL, localStorage `ab_campaign`.
- `backend/src/features/marketing/campaigns.ts`: `KNOWN_CAMPAIGNS` Set (same single slug), `normalizeCampaign` / `normalizeVid` / `normalizeUtm`.
- `frontend/src/app/components/CrawlLanding.tsx` (lines ~78–89): the stamp + `logCampaignLanding({campaign, vid, utmSource, utmMedium, utmCampaign, referrer})` beacon pattern to reuse.
- `App.tsx`: `<AnalyticsRouteTracker />` and `<ConsentBanner />` mount once inside `<BrowserRouter>` above `<Routes>` — the reader goes next to them.
- Downstream needs nothing: `subscribeNewsletter`/`logQuizFunnelEvent` already read `getActiveCampaign()`, the backend already persists/tags any allowlisted campaign, and `campaign_funnel_v` / `campaign_subscriber_archetype_v` group by campaign.

## Decisions already made (Dana, 2026-09-10) — do not re-open

1. Two separate slugs: **`instagram`** and **`facebook`** (per-channel attribution; a combined social view is just a query). Evergreen, no year suffix — these are ongoing channels, not a one-day event.
2. Links are **direct quiz URLs with query params** — no new routes, no landing page, no `/ig`//`/fb` short paths.
3. First-wins stays: a visitor already attributed (e.g. crawl) who later clicks a social link keeps their first campaign. Same COALESCE rule, untouched.
4. The reader is **generic**: any route can carry `?campaign=<known slug>`; future channels become one entry in each allowlist plus a link.

## TASK

### 1. Frontend

- `campaign.ts`: add `instagram: { label: 'Instagram' }` and `facebook: { label: 'Facebook' }` to `CAMPAIGNS`.
- New `frontend/src/app/components/CampaignQueryReader.tsx`: renders null; mounted once in `App.tsx` next to `<AnalyticsRouteTracker />`. On every location change, read `campaign` from the query string; if it is a key of `CAMPAIGNS`, do exactly what CrawlLanding's mount effect does: `rememberCampaign(slug)`, `trackEvent('CampaignLanding', { campaign: slug })`, fire-and-forget `logCampaignLanding({...})` with the UTMs + referrer, wrapped with `reportError`. Guard so one page load fires the beacon at most once per slug (a ref), and an unknown/absent value does nothing. Do NOT strip the param from the URL (GA4 reads it; rewriting the URL fights the router for no gain).
- `/crawl` keeps its own hardcoded stamp (its printed URL carries no `campaign` param) — leave `CrawlLanding.tsx` untouched.

### 2. Backend

- `campaigns.ts`: `KNOWN_CAMPAIGNS` becomes `new Set(['hoboken-crawl-2026', 'instagram', 'facebook'])`.
- That is the whole backend change. Verify (don't assume) that `/api/campaign/landing`, subscribe, and funnel all accept the new slugs purely via the allowlist.

### 3. Not in scope

New routes or pages; schema changes; Mailchimp changes (the tag family `campaign:<slug>` already flows); any change to /crawl, the quiz, the sealed ending, or the email card; Meta pixel/ads config.

## CONSTRAINTS

Reuse `rememberCampaign`/`logCampaignLanding` — no duplicated beacon logic (extract CrawlLanding's effect body into a shared helper ONLY if that keeps both call sites byte-equivalent in behavior; otherwise a small amount of duplication in the reader is acceptable and preferred over refactoring the live crawl page two weeks before its event). `vite build` + `npx tsc --noEmit` clean (zero new errors). Test data marked + cleaned.

## DONE = (one go, one report)

1. One commit pushed to `main` (`campaigns: instagram + facebook slugs, generic ?campaign= reader`), deploy green, backend startup log clean ("DB schema verified").
2. Build-log entry in `WHAT_WE_BUILT.md` (next number); this file's Status flipped.

## ACCEPTANCE (live on production, phone-sized; prod DB reads; marked test data cleaned after)

1. Open `https://axisandbloomcoffee.com/find-my-flavor?campaign=instagram&utm_source=instagram&utm_medium=social&utm_campaign=launch-2026` in a fresh browser: quiz entry renders normally; `localStorage.ab_campaign` holds slug `instagram`; one `campaign_landing_event` row with that vid + UTMs.
2. Complete the quiz, submit the email card: `quiz_funnel_event` rows and the `newsletter_subscriber` row carry `campaign = 'instagram'` + that vid; Mailchimp member gets `campaign:instagram`.
3. Same check once for `facebook` (landing row + stamp is enough; full quiz not required twice).
4. `?campaign=twitter` (unknown): nothing stored, no beacon, no console error. No `campaign` param: behavior byte-identical to today.
5. First-wins: a browser stamped `instagram` that then visits `/crawl` — subscriber attribution stays whichever came first at subscribe time per the existing COALESCE (verify by reading the row, not by reasoning).
6. `/crawl` regression: scan-URL flow from #174 acceptance item 5 still lands a `hoboken-crawl-2026` row.
7. `SELECT * FROM campaign_funnel_v;` now shows one row per campaign that has data.

## After execution (Dana / Camila)

The links to paste (any page link can carry these; these two go in the bios / link stickers / post CTAs):

- Instagram: `https://axisandbloomcoffee.com/find-my-flavor?campaign=instagram&utm_source=instagram&utm_medium=social&utm_campaign=launch-2026`
- Facebook: `https://axisandbloomcoffee.com/find-my-flavor?campaign=facebook&utm_source=facebook&utm_medium=social&utm_campaign=launch-2026`

Camila can also create Mailchimp segments on `campaign:instagram` / `campaign:facebook` when she wants channel follow-ups.
