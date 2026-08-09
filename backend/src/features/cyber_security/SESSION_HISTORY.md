# Session history — Security patches (2026-08-07 to 2026-08-08/09)

Summary of a multi-turn Claude Code session that ran the security-hardening backlog end to end (C17, C1–C4, plus two same-day operational follow-ups), for continuity in future sessions. Full per-fix detail lives in `WHAT_WE_BUILT_SECURITY.md` (repo root, numbered entries, one per fix) — this doc is the narrative: what was asked, what actually happened in what order, and the hiccups along the way that the entry-per-fix changelog doesn't capture well.

## What was asked

A sequence of security-patch tasks against the findings register in `SECURITY_FINDINGS.md` (this folder), run one at a time, each following the same shape: branch/diff → `tsc --noEmit`/build → verify (live, not assumed) → update `SECURITY_FINDINGS.md`/`RUN_ORDER.md`/`WHAT_WE_BUILT_SECURITY.md` → commit → push (autonomous push/deploy authorized for this session up front, given the tasks' own deploy→observe→fix structure — a one-time exception to the repo's normal "wait for explicit go-ahead" rule):

1. **C17** — fix per-IP rate limiting behind Cloudflare (finding M11).
2. **C1** — remove the unauthenticated `/health/db`/`/health/session-cols` schema-leak routes (M1).
3. **C2** — global Claude aggregate spend gate + kill-switch, and remove message-content-based Sonnet escalation (H1 + M4).
4. **C3** — make the public coffee-AI endpoints read-only, move generation out-of-band (M2).
5. **3-fix** — a follow-up data correction: null a leaked-refusal value found live-verifying C3, and scan for others.
6. **C4** — replace the beats dial-in SERIAL-id IDOR with a capability token (H3).
7. Two same-day operational fixes found by live-verification rather than planned up front: the global rate-limit backstop was too tight for real multi-user traffic, and `deploy.yml`'s `--set-env-vars`/`--set-secrets` turned out to replace rather than merge, meaning a console-set `CLAUDE_ENABLED=false` would be wiped on the next deploy.

## Starting state

Git and GCP access confirmed at session start (repo on `main`, up to date; `gcloud` authenticated against `axis-and-bloom-prod`). This whole folder (`backend/src/features/cyber_security/` — the findings register, numbered `C#` fix prompts, Cloudflare runbook, phased run-order checklist) already existed **locally but had never been committed** — the entire security program existed only in the working tree until this session committed it (`c0bf5d0`). No root-level `WHAT_WE_BUILT_SECURITY.md` existed yet; created this session as the security-specific counterpart to `WHAT_WE_BUILT.md`/`WHAT_WE_BUILT_DB.md`/`SOMMELIER_BUILT.md`.

## What was built

**C17 (M11)** — Empirically determined (temp diagnostic route, deployed, read back via Cloud Run logs — not assumed) that behind Cloudflare → Firebase Hosting → Cloud Run, `X-Forwarded-For` never carries the real visitor IP (Firebase Hosting's rewrite replaces it with its own 2-entry chain), while `CF-Connecting-IP` does but is spoofable on both the `*.web.app` and `*.run.app` direct-origin paths. New `backend/src/middleware/clientIp.ts`: trusts `CF-Connecting-IP` only when XFF's second-to-last entry is a published Cloudflare IP, else falls back to `req.ip` (`trust proxy=1`, never `true`). Wired into every `express-rate-limit` instance. One documented residual gap (a direct `*.run.app` hit forging a real Cloudflare IP into XFF); closing it fully needs C6 (App Check), not Cloud Run ingress restriction — confirmed live in the GCP console that ingress restriction isn't viable at all for this Firebase-Hosting-rewrite topology, correcting an earlier draft of the same writeup.

**C1 (M1)** — Deleted `GET /health/db` and `GET /health/session-cols` from `index.ts` outright. `GET /health` untouched.

**C2 (H1 + M4)** — New `backend/src/services/anthropicGuard.ts`: real usage-based cost (input/output tokens × per-model rate, not call count) tracked in a new Postgres table `claude_daily_spend` (one row per UTC date, atomic upsert), gated by `CLAUDE_GLOBAL_DAILY_USD` (ceiling) and `CLAUDE_ENABLED` (kill-switch), fails closed. Wired into all 9 real Anthropic call sites app-wide, each with a graceful non-500 fallback. M4: deleted the word-count/keyword Sonnet-escalation logic entirely from `chatWithSommelier` — the authenticated Liam conversation always uses Sonnet now, unconditionally; every public/anon surface stays Haiku.

**C3 (M2)** — `GET /api/coffees/:id/content` and `/:id/ai-summary` are now pure reads, zero code path to Claude (confirmed by grep). Generation moved out-of-band to a new daily cron (`GET /api/cron/coffee-content-backfill`) plus the existing admin refresh endpoints. New terminal-failure flags (`*_generation_failed` on `coffees`) stop the backfill from retrying a genuinely-refused field forever, while leaving insufficient-data skips retry-eligible.

**3-fix** — Live-verifying C3 turned up "Working Late Hours" (coffee 23) serving a verbatim stored refusal publicly. Traced the root cause (a ~16-minute gap between two deploys during the concurrent-session collision below, where the guard code wasn't live yet but the old ungated generate-on-cache-miss route was). A full manual re-read of all 30 coffees × 4 fields (not just the automated regex scan, which itself missed one phrasing) found 5 affected fields across 4 coffees; all nulled + terminal-flagged; the regex guard's pattern list expanded.

**C4 (H3)** — `GET /api/beats/dial-in/:beatEventId/respond` identified the beat by a plain SERIAL id, unauthenticated, no ownership check. Replaced with `beat_event.respond_token` (32 random bytes via `crypto.randomBytes`, hex), mirroring `household_invitation.token`/`coffees.qr_token`. 3-step migration (nullable column + unique index → app-side backfill script → `SET NOT NULL`) run directly against production **before** the code deployed — `beat_event` had zero rows at the time, confirmed empirically, so no outstanding old-format link existed to break.

**Global limiter + deploy.yml (same-day follow-ups, found live not planned)** — The app-wide backstop (200 req/15min) tripped on ordinary same-day verification traffic twice, and — separately — would trip on any shared IP (mobile CGNAT, office/cafe NAT) carrying multiple real customers. Raised the default to 2000 and made both `max`/`windowMs` env-configurable (`GLOBAL_RATE_LIMIT_MAX`/`GLOBAL_RATE_LIMIT_WINDOW_MS`); every per-route abuse guard left untouched. Separately, checking `.github/workflows/deploy.yml` confirmed `--set-env-vars`/`--set-secrets` **replace** the service's entire list on every deploy rather than merging — meaning `CLAUDE_ENABLED`/`CLAUDE_GLOBAL_DAILY_USD`/the new `GLOBAL_RATE_LIMIT_MAX` weren't declared anywhere and a console-set override would be silently wiped by the next push. Declared all three with their intended defaults in the deploy config, without touching the existing `--set-secrets` list.

## A concurrent-session collision, mid-C2 (worth remembering)

This repo's local checkout is shared by more than one Claude Code session at a time — a recurring, previously-documented pattern here, and it happened again this session. While C2's edits to `claude.ts`/`coffees.ts` sat uncommitted, a concurrent session doing unrelated work ("The Bloom Part 16 — Dial polish & content guard") ran `git add`/`commit` on the same shared working tree, and since both sessions had touched the same two files, its commit (`5663151`) picked up this session's uncommitted lines too, under an unrelated message. That commit's build broke in CI (`Cannot find module '../services/anthropicGuard.js'` — this session's new module had never been separately committed). **The same concurrent session then diagnosed and fixed exactly that** — added the missing file + its one `schema.sql` addition, created the `claude_daily_spend` table directly in production (since the gate fails closed and an unreadable table would otherwise have silently blocked Liam/recommendations/content generation app-wide), wrote a clear commit message explaining the situation (`38f35fc`), and deliberately left this session's remaining touched files uncommitted for it to finish — which happened in `3db177e`. The merged `claude.ts`/`coffees.ts` content was read back in full and confirmed correct before continuing, rather than assumed.

**Lesson reinforced (already known, hit again in practice):** when uncommitted work sits in a shared working tree, another session's scoped `git add <file>` can silently sweep it into their commit if it happens to touch the same file. Always verify committed content matches intent — and check `git log`/`git show --stat` on an unexpected recent commit — before assuming a "missing" piece of work means it was lost.

## Two rate-limit false alarms, same root cause

Twice during this session (once after C2/C3's deploys, once after C4's), the user reported `/bloom`, the quiz, and Flavor Intelligence "not available." Both times: Cloud Run logs showed zero errors, and the actual symptom was `429 Too Many Requests` from the app's own global rate limiter — this session's own heavy live-verification traffic (dozens of curl/browser requests per fix, all from the same real-world IP the user's own browser shares on this network) repeatedly exhausting the 200-req/15-min bucket. Confirmed via response headers (`x-ratelimit-remaining: 0`, `x-ratelimit-reset`) both times, and via a full live re-test once the window reset. This is what motivated the global-limiter-loosening follow-up above — not just a testing annoyance, but a real risk for any shared-IP real customer traffic at the old 200 ceiling.

## Testing / verification approach

Every fix was verified live against production, not assumed:
- **C17**: temp diagnostic route deployed, hit through every real request path (custom domain, `www`, `*.web.app` direct, `*.run.app` direct, several with deliberately forged headers), read back via `gcloud logging read`; 4 captured-log scenarios replayed as unit cases against `getRealClientIp()` before/after the fix.
- **C1**: live `GET`s against the Cloud Run origin post-deploy (`/health` 200, both removed routes 404).
- **C2**: real browser pass — `/bloom` reveal, a full quiz retake with a real generated recommendation, a full Liam conversation (opening turn + a real follow-up reply) — plus a zero-errors Cloud Run log check across the whole deploy window.
- **C3**: live `GET /api/coffees/:id/content` calls confirming null/empty graceful fallback; `TastingNotes.tsx` read directly to confirm the frontend already handles that state (no frontend change made or needed).
- **3-fix**: full manual re-read of all 30 coffees, all 4 content fields (not just the automated regex scan); re-scanned after applying, confirmed 0 remaining hits; live-confirmed via the public API immediately after (no redeploy needed — C3 had already made the route a pure read).
- **C4**: post-deploy, live-hit the endpoint with an old-format integer id (404), a fake 64-hex token (404, byte-identical response), and a malformed `expectation` value (400) — confirming no distinguishing signal and that the SERIAL id truly can't reach the route anymore.
- **Global limiter**: confirmed `x-ratelimit-limit: 2000` on a real response post-deploy, and `/bloom` loading fully again in a real browser.
- **deploy.yml env vars**: `gcloud run services describe` against the live service, confirming `GLOBAL_RATE_LIMIT_MAX`/`CLAUDE_GLOBAL_DAILY_USD`/`CLAUDE_ENABLED` actually present with the right values on the currently-serving revision (re-confirmed again in a later turn, from scratch, when asked to double check).

## Documentation updated

- **`WHAT_WE_BUILT_SECURITY.md`** (repo root, new this session) — 6 numbered entries, one per fix (C17/C1/C2/C3/C4/global-limiter+deploy.yml), each with context, the fix, verification, and a "not done in this pass" section. Also fixed a stray duplicate `Files:` line left over from an earlier edit.
- **`SECURITY_FINDINGS.md`** (this folder) — M11, M1, H1, M4, M2, H3 all marked DONE with a summary line; a 2026-08-09 follow-up note added under M11 for the limiter loosening. This whole folder was committed to git for the first time this session (`c0bf5d0`) — it had only ever existed locally before.
- **`RUN_ORDER.md`** (this folder) — C17/C1/C2/C3/C4 checked off; the "restrict Cloud Run ingress" line corrected to "NOT VIABLE" (confirmed live in the GCP console) and re-pointed at C6; flagged the still-outstanding Cloud Scheduler setup for the new `coffee-content-backfill` cron.
- **`WHAT_WE_BUILT.md`** (repo root) — entry #146 for the 3-fix data correction, matching #145's own table/format convention.

## Commits (chronological, this session's own work)

```
9e45da1  chore(security): temp IP-diagnostic logging for Cloudflare rate-limit fix (C17)
d294cc4  fix(security): real per-IP rate limiting behind Cloudflare (C17/M11)
c0bf5d0  docs(security): add WHAT_WE_BUILT_SECURITY.md, commit the cyber_security program docs, mark C17/M11 done
8ca8059  docs(security): correct C17 residual-gap remediation -- App Check, not Cloud Run ingress restriction
a0fa591  fix(security): remove unauthenticated schema-leak diagnostic routes (C1/M1)
89dbe0f  docs(security): record C1 fix, mark M1 done, correct entry 1's /health-through-Cloudflare claim
[5663151 The Bloom Part 16 -- concurrent session, absorbed this session's in-progress claude.ts/coffees.ts edits]
38f35fc  Fix: add missing anthropicGuard.ts (C2 Claude spend gate)                      -- concurrent session, fixed the resulting CI break
3db177e  fix(security): C2 -- graceful fallback for the global Claude spend gate (Part 1 finish) + wire remaining call sites
6433e28  docs(security): record C2 (H1/M4), mark done in SECURITY_FINDINGS.md/RUN_ORDER.md
4eae593  fix(security): C3 -- make public coffee AI endpoints read-only (M2)
70848e3  docs(security): record C3 (M2), mark done in SECURITY_FINDINGS.md/RUN_ORDER.md
54257b8  fix(data): 3-fix -- null the leaked refusal on "Working Late Hours" + 3 others, expand the refusal-pattern guard
8de736f  migration(security): C4 -- beat_event.respond_token (H3 capability token)
3ab48e2  fix(security): C4 -- replace the beats dial-in SERIAL id with a capability token (H3)
2962cbe  docs(security): record C4 (H3), mark done in SECURITY_FINDINGS.md/RUN_ORDER.md
08a38eb  fix(security): loosen the global rate-limit backstop, make it env-configurable
c342c8b  fix(security): declare tunable knob defaults in deploy.yml (--set-env-vars replaces, not merges)
fb8b29b  docs(security): record the global-limiter loosening + deploy.yml env-var fix
```

Every commit above deployed successfully (GitHub Actions `Deploy` workflow, both backend and frontend jobs) — confirmed for each, not assumed.

## Left untouched, deliberately

Throughout the session, `git status` regularly showed unrelated concurrent work in the shared working tree — never bundled in:
- `OPEN_TASKS.md` (modified, not this session's).
- Untracked: several `ai_agent_liam`/`find_my_flavor_page`/`the_bloom_page`/`slot_instance_model` spec docs, `frontend/src/design/IMAGES/bags/` PNGs, `frontend/src/features/`, `funding/`, `misc/design_documents/`, `misc/marketing/`, `misc/roasteries/` files.
- Frontend files touched by concurrent "Bloom Part 15/16/17/18" commits — read only where necessary to confirm this session's own changes merged correctly, never edited.

## Outstanding, flagged not silently skipped

- **Cloud Scheduler for `coffee-content-backfill`** — the cron endpoint exists and is correctly gated (`requireCronSecret`), but nothing triggers it in production yet. Coffees with no cached content stay uncached until an admin manually hits `refresh-content`.
- **C6 (Firebase App Check)** — the actual remediation for C17's one residual gap (a direct `*.run.app` hit forging a real Cloudflare IP into X-Forwarded-For). Not attempted this session.
- **Anthropic-console monthly spend cap** — the real hard per-key cap, separate from C2's app-level ceiling. Still manual/outstanding per `RUN_ORDER.md` Phase 0.
- **Orphaned `sonnetKeywords`/`sonnetMinMessageWords` admin-config fields** (`AdminSommelierConfig.tsx`, `sommelierConfig.ts`, the Firestore seed) — dead since C2 removed the logic that read them, left in place rather than removed. Editing them in the admin UI no longer does anything; worth a cleanup pass.
- **IPv6 client addresses aren't grouped to a /64 subnet** before rate-limit keying — the installed `express-rate-limit@7.3.1` predates the `ipKeyGenerator` helper that does this upstream. Low severity (loosens the limit, doesn't defeat it).
- Two minor non-refusal meta-text artifacts found during the 3-fix audit (coffees 20 and 25's `surprise_note` both leak "Here's a hook for X:"-style preamble) — not refusals, not a leak, flagged for a future prompt-tightening pass, not fixed.
