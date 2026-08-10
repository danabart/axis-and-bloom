# AI Operations Admin Page — Claude Code Prompt

**Branch:** create and work on an isolated branch, e.g. `feature/ai-ops-admin`. Do not bundle unrelated work. This repo's checkout is sometimes shared by concurrent sessions — when committing, `git add` only the specific files this task touched, never `git add -A`/`git add .`.

---

## Goal

One new admin-portal page ("AI Operations") that gives an admin, on one screen: today's real AI spend (global and per feature) against the caps, an on/off switch for all AI and for each feature group, and editable daily budgets — global and per feature. All control flows through the existing shared guard; the env-var kill switch stays above everything as the infra-level backstop.

**Scope guard: this controls AI/Claude calls only.** Nothing here may touch or gate the store, quiz flow, checkout, auth, or any non-AI data path.

## Existing pieces to build on (verify each before relying on it)

- `backend/src/services/anthropicGuard.ts` — `guardClaudeCall(model, makeCall)`, the single shared gate every Claude call passes through. Tracks real usage-based cost (Anthropic `usage` tokens × a one-place rate table, rounded **up** to the cent) into Postgres `claude_daily_spend` (`date DATE PRIMARY KEY, cents INT`, one row per UTC day) via an atomic upsert. Checks, in order: `CLAUDE_ENABLED` env (no DB read), then today's spend vs `CLAUDE_GLOBAL_DAILY_USD` (default 20). **Fails closed** on spend-read errors. Only successful calls increment spend. Blocks throw `ClaudeGuardBlockedError`.
- **All 9 call sites** (confirm by grepping `.messages.create(` — the list may have grown since this prompt was written): `claude.ts` → `chatWithSommelier` (Sonnet), `getRecommendation`, `getCoffeeSummary`, `getCoffeeSurpriseNote`, `getCoffeeThreeVoiceStory` (Haiku); `storyLayer.ts` → `generateOnce` and the `attempt()` helper in `generateOneWarmSentence`; `sommelierEvaluator.ts` → Stage-2 briefing; `liamSmsFeedback.ts` → inbound-SMS reply parser.
- Every call site already degrades gracefully on `ClaudeGuardBlockedError` (Liam 503 message, quiz placeholder, keep-cached coffee content, template fallbacks). **Do not change any of these fallback paths** — new block reasons must flow through the exact same error.
- `config/sommelier` Firestore doc — canonical, admin-edited runtime config, with an existing audit-trail pattern at `config/sommelier/audit/{autoId}`. Reuse that audit pattern; do not invent a new one.
- `requireAdmin` — existing server-enforced admin auth. Every new endpoint sits behind it.
- `AdminSommelierFlow.tsx` already has a "Guard Layer" stats section fed by `GET /api/admin/sommelier/stats` — reuse its data-fetch/render patterns for the new page rather than reinventing them (house rule: reuse existing components).
- `.github/workflows/deploy.yml` pins `CLAUDE_ENABLED=true,CLAUDE_GLOBAL_DAILY_USD=20` in `--set-env-vars` (which **replaces** the whole list on every deploy).
- `backfillCoffeeContent()` (cron) already stops early via `isClaudeGuardBlocked` — must keep working unchanged.

## The layering model (the core design — preserve this intent exactly)

Checks run in this order; any "off/over" answer blocks the call with `ClaudeGuardBlockedError`:

1. **`CLAUDE_ENABLED` env** — checked first, no reads. The infra-level "everything's on fire" switch: works even when app/DB/Firestore are degraded, and it always wins. Unchanged.
2. **`aiControls.enabled`** (Firestore, global admin toggle).
3. **`aiControls.features[feature].enabled`** (per-feature admin toggle).
4. **Per-feature daily cap** — if `aiControls.features[feature].dailyUsd` is set (non-null), today's spend *for that feature* must be under it.
5. **Effective global daily cap** = `min(CLAUDE_GLOBAL_DAILY_USD env, aiControls.globalDailyUsd)` — today's *total* spend must be under it.

**Why min():** the admin UI must only ever be a brake, never an accelerator. From the portal you can lower spend or shut features off, but raising the ceiling above what's pinned in deploy.yml requires a commit + deploy. Same spirit as the existing rule that `modelRouting.expertiseModelOverride` is never admin-UI-editable. The server must enforce this on write too (see endpoints), not just in the UI.

**Fail directions — asymmetric on purpose:**
- Spend reads (Postgres) keep **failing closed**, exactly as today.
- The new Firestore `aiControls` read **fails open**: on a read error, use the in-memory last-known-good value; if none exists yet (cold start + Firestore down), fall back to defaults (everything enabled, `globalDailyUsd` 20). Rationale: a Firestore blip must not take Liam down — the env var is the reliability-layer kill, the toggle is the convenience layer. Log a warning whenever a stale/default value is used.
- Cache the parsed `aiControls` in memory for ~60s per instance (same TTL spirit as other config caching in the app if a helper already exists — check `sommelierConfig.ts` first and reuse). A flip takes effect within ~a minute; that's acceptable and should be stated in the UI ("changes take effect within a minute").

## Feature groups (4, not 9 — one toggle per surface an admin reasons about)

Define a TypeScript union type (e.g. `type AiFeature = 'liam_chat' | 'quiz_recommendation' | 'coffee_content' | 'lifecycle'`) so an unmapped call site is a compile error, and map the call sites:

| Feature key | Call sites | Notes |
|---|---|---|
| `liam_chat` | `chatWithSommelier`, `sommelierEvaluator.ts` briefing | The only Sonnet surface — the expensive one. The evaluator briefing exists only in service of the Liam conversation, so it belongs here; if reading the code shows it's used more broadly, use your judgment and document the choice. |
| `quiz_recommendation` | `getRecommendation` | Public-facing quiz results. |
| `coffee_content` | `getCoffeeSummary`, `getCoffeeSurpriseNote`, `getCoffeeThreeVoiceStory`, `storyLayer.ts` `generateOnce` (full coffee story) | Cron backfill + admin refresh paths. |
| `lifecycle` | `generateOneWarmSentence`'s `attempt()`, `liamSmsFeedback.ts` parser | Beat/order one-liners + SMS reply parsing. |

If grep finds call sites not in this table, assign them to the closest group (or add a group if truly none fits) and record the decision in the docs update.

## Part 1 — Guard: feature attribution + new checks

- Change `guardClaudeCall(model, makeCall)` → `guardClaudeCall(feature, model, makeCall)` (or an options object — match the file's existing style). Update **all** call sites; the union type makes misses un-compilable.
- Add `feature TEXT NOT NULL DEFAULT 'unattributed'` to `claude_daily_spend`; primary key becomes `(date, feature)`. Global-cap check = `SUM(cents)` for today; per-feature check reads the feature's row. Keep the single atomic `INSERT ... ON CONFLICT (date, feature) DO UPDATE ... RETURNING` shape.
- **Migration:** follow the repo's established two-track pattern (see `beat_event_respond_token_2026_08_09.sql` and the schema.sql notes from that task): a manual, ordered migration file for the live table (it's days old and tiny — dropping/recreating the PK is safe, but do it explicitly, applied via the Cloud SQL Auth Proxy before deploy), plus idempotent `CREATE TABLE`/`ALTER` updates in `schema.sql` for fresh environments. Nothing in the automatic startup batch may be able to fail on a partially-migrated table.
- Existing pre-migration rows keep `feature='unattributed'`; the admin page may show that as a historical row but new writes must always carry a real feature.
- Include the block **reason** (which layer blocked: env / global toggle / feature toggle / feature cap / global cap) in the `ClaudeGuardBlockedError` and in the `[anthropicGuard]` log line — invaluable for ops; callers must not need to care (they already catch the error type, not the reason).

## Part 2 — Config shape in `config/sommelier`

Add one new field (do not restructure anything else in the doc):

```
aiControls: {
  enabled: true,
  globalDailyUsd: 20,
  features: {
    liam_chat:           { enabled: true, dailyUsd: null },
    quiz_recommendation: { enabled: true, dailyUsd: null },
    coffee_content:      { enabled: true, dailyUsd: null },
    lifecycle:           { enabled: true, dailyUsd: null }
  }
}
```

`dailyUsd: null` = no per-feature cap (global cap still applies). Update the Firestore seed file the same way (house rule: the live doc is canonical, seeds are for fresh environments). If the live doc lacks `aiControls`, the reader treats missing as the defaults above — no live patch script needed unless the repo convention prefers one.

**Never write spend numbers into Firestore.** There's a known open item that authenticated clients can read `config/sommelier` directly — on/off flags leaking is harmless, spend data is not. Spend lives in Postgres and surfaces only through the admin endpoint.

## Part 3 — Admin endpoints (both behind `requireAdmin`, in the existing admin router)

- `GET /api/admin/ai-ops` → JSON: today's spend in cents per feature + total; last 14 days of daily totals per feature (for the trend); current `aiControls` (as the guard effectively sees them); the env ceiling value (`CLAUDE_GLOBAL_DAILY_USD`) and whether `CLAUDE_ENABLED` is currently false (so the UI can show "killed at infra level" instead of a confusing all-off state).
- `PUT /api/admin/ai-ops/controls` → validated write of `aiControls`: reject unknown feature keys, non-boolean toggles, negative or non-numeric caps; **clamp/reject `globalDailyUsd` above the env ceiling** (server-side enforcement of the min() rule — return a clear error, don't silently clamp, so the admin knows the ceiling exists). Write an audit entry to `config/sommelier/audit/{autoId}` using the existing pattern: who (admin uid/email), when, old → new values.
- No new public surface. Nothing anonymous-reachable.

## Part 4 — Admin UI: new "AI Operations" page

New page (e.g. `AdminAIOps.tsx`) wired into the admin portal's existing routing/nav next to the other admin pages, following the visual and data-fetch patterns of `AdminSommelierFlow.tsx` — reuse existing admin components/styles, don't invent a parallel design system.

On one screen:
- **Global:** today's total spend vs the effective cap (progress bar), the global on/off toggle, the working-cap editor (shown with the env ceiling as its max, labeled e.g. "max $50 — raised via deploy"), and a clear banner state if `CLAUDE_ENABLED=false` at the env level (toggles disabled with an explanation, since nothing the portal does can override it).
- **Per feature (4 rows):** today's spend, a small 14-day trend, the on/off toggle, the per-feature cap input (blank = no cap).
- **Audit:** the most recent handful of `aiControls` audit entries (who/when/what changed).
- Note near the toggles: "changes take effect within a minute" (the cache TTL).
- Confirm-before-apply on turning anything off (it's customer-facing).

Internal admin tool — customer-copy register rules don't apply here, but keep labels plain and operational.

## Part 5 — Ride-along cleanup (small, flagged in C2's docs)

Remove the orphaned `sonnetKeywords` / `sonnetMinMessageWords` admin-config fields — dead since the C2 model-routing fix but still editable, misleadingly implying effect: `AdminSommelierConfig.tsx`, `AdminSommelierFlow.tsx` (if referenced), `sommelierConfig.ts`, and the Firestore seed. Do not remove them from the live Firestore doc's data (harmless leftovers) unless a trivial cleanup script fits the repo convention.

## Part 6 — deploy.yml

In `--set-env-vars`: change `CLAUDE_GLOBAL_DAILY_USD=20` → `CLAUDE_GLOBAL_DAILY_USD=50`. The env var's meaning shifts from "the working cap" to "the ceiling the admin page can't exceed"; the working cap now lives in Firestore (default 20). Touch nothing else in the env/secrets strings — they replace wholesale on deploy.

## Out of scope — do not attempt

- The Anthropic-console monthly hard cap (manual, tracked in RUN_ORDER.md Phase 0).
- Spend alerts/notifications, email digests, monthly reporting views.
- Any change to per-route rate limiters, `checkDailyCap`, model routing, or `expertiseModelOverride`.
- Any gating of non-AI functionality.

## Verification (in order; the house standard is live verification, not assumption)

1. `tsc --noEmit` and `npm run build` clean (backend and frontend).
2. Grep re-confirmation: every `.messages.create(` site passes through `guardClaudeCall` with a feature label; no call site left unattributed.
3. Local/live behavior matrix — for each layer, flip it and confirm the graceful path (never a raw 500), then flip back:
   - global toggle off → Liam returns the friendly 503 message; quiz still returns 200 with placeholder; coffee content keeps cached values (nothing nulled); cron backfill stops early.
   - `liam_chat` off, everything else on → Liam blocked, quiz recommendation still generates.
   - tiny per-feature cap (e.g. $0.01) on `liam_chat` → a couple of turns trip it; block reason logged correctly; other features unaffected.
   - `globalDailyUsd` write above the env ceiling → rejected with a clear error.
4. Spend attribution: after real calls, `claude_daily_spend` rows carry the right feature; admin page totals match a direct SQL sum.
5. Audit: each toggle/cap change produces a `config/sommelier/audit` entry with the acting admin.
6. Auth: the new endpoints return 401/403 for non-admin users (test, don't assume).
7. Non-regression: full quiz retake, a real Liam conversation, `/bloom` reveal — all normal with everything enabled.

## Documentation (house convention)

Append an entry to `WHAT_WE_BUILT.md` (and the schema change to `WHAT_WE_BUILT_DB.md`'s table/path listings) in the established format: context, what was built, decisions (the min() rule and fail-direction asymmetry deserve explicit recording), verification performed, and anything flagged-not-done.
