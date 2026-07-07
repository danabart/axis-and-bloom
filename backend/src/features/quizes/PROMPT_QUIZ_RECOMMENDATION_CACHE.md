# Claude Code Prompt — Pre-computed Quiz Recommendations

## What we're building and why

Right now `POST /api/quiz/results` calls Claude haiku on every quiz completion to generate a coffee recommendation. This cost scales 1:1 with every person who takes the quiz. We want to eliminate that by pre-generating all possible recommendations once and caching them in the DB. At quiz completion time, the backend does a DB lookup instead of an AI call.

This is the same pattern already used for coffee AI content (`ai_summary`, `surprise_note`, `three_voice_story` on the `coffees` table — generated once, cached forever).

**No frontend changes needed.** The response shape of `POST /api/quiz/results` stays the same — still returns `{ id: sessionId, recommendation }`. The change is entirely in the backend.

---

## Context you need to understand

### The quiz flow

1. `POST /api/quiz/score` — scores the answers, returns: `archetype`, `archetypeId`, `secondaryArchetype`, `foodSignal`, `recommendationMode`, `experimental`, `confidence`
2. `GET /api/quiz/branch?archetypeId=<uuid>` — optionally returns a branch question for Fruity (→ Floral) or Chocolate & Nutty (→ Earthy)
3. If branch exists, user picks an answer — the frontend uses `answer.archetypeName` as the final archetype (fully data-driven, no hardcoded logic)
4. `POST /api/quiz/results` — called with the **final** archetype (possibly reclassified by branch) + all other fields from step 1. Saves the session, calls `getRecommendation()` in `backend/src/services/claude.ts`, returns the recommendation text.

**The branch reclassification does NOT affect `secondaryArchetype`, `foodSignal`, `recommendationMode`, or `experimental` — those carry forward unchanged from step 1.**

### The 5 quiz archetypes

- Chocolate & Nutty
- Balanced & Sweet
- Fruity
- Floral ← only reachable via branch from Fruity
- Earthy ← only reachable via branch from Chocolate & Nutty

These map to rows in the `archetype` table (UUID PKs). You'll need to look up their UUIDs at generation time.

### The 6 recommendation modes

These are the values that can appear in `recommendationMode`. They come from `backend/src/services/quizScoring.ts` (the `computeConfidenceAndMode()` function):

| Mode | When it fires |
|---|---|
| `primary_only` | Food matches primary, no close secondary |
| `primary_plus_introduce_secondary` | Food matches secondary archetype |
| `primary_plus_active_secondary` | Experimental=true AND food matches secondary |
| `primary_plus_note_secondary` | Food matches primary AND secondary scored on Q5 or Q4 |
| `primary_as_starting_point` | Experimental=true AND food matches primary |
| `ai_agent` | Food matches neither primary nor secondary |

### The `experimental` flag

Set to `true` when the user selected Q3-C ("Interesting — what flavors am I getting here?"). It's a modifier on top of the mode. Some modes only fire when experimental is true (`primary_plus_active_secondary`, `primary_as_starting_point`).

### Valid combinations

Not all 5 × 6 × 2 = 60 combinations are reachable. When generating templates, enumerate only the valid ones. Use the logic in `quizScoring.ts` `computeConfidenceAndMode()` to determine which `(mode, experimental)` pairs can actually occur, then cross with all 5 archetypes. Approximately 45–50 valid rows.

---

## What to build

### 1. New DB table — add to `schema.sql`

Add this table at the end of `backend/src/db/schema.sql`, following the same idempotent `CREATE TABLE IF NOT EXISTS` pattern used for all other tables:

```sql
CREATE TABLE IF NOT EXISTS recommendation_template (
  id                  SERIAL PRIMARY KEY,
  archetype_id        UUID NOT NULL REFERENCES archetype(id),
  recommendation_mode TEXT NOT NULL,
  experimental        BOOLEAN NOT NULL DEFAULT FALSE,
  recommendation_text TEXT NOT NULL,
  generated_at        TIMESTAMPTZ,
  generated_by        TEXT DEFAULT 'admin',
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(archetype_id, recommendation_mode, experimental)
);
```

### 2. The `{{secondary_archetype}}` placeholder convention

Recommendation text for modes that reference the secondary archetype (specifically `primary_plus_introduce_secondary`, `primary_plus_active_secondary`, `primary_plus_note_secondary`) should use the literal string `{{secondary_archetype}}` as a placeholder. At query time, the backend does a simple string replace with the actual `secondaryArchetype` value from the quiz score result.

Example stored text:
> "Your profile is firmly Fruity — bright, alive, and curious. There's also a thread of {{secondary_archetype}} in your answers, which tells us you might enjoy exploring that direction as your palate develops. We'd start you with the Ethiopia from Path Coffee Roasters..."

At quiz time, if `secondaryArchetype = "Floral"`, the backend replaces `{{secondary_archetype}}` with `"Floral"` before returning.

Modes that don't reference the secondary archetype (`primary_only`, `primary_as_starting_point`, `ai_agent`) should NOT use the placeholder.

### 3. Admin generation endpoint

Add to `backend/src/routes/admin.ts` (behind `requireAdmin`):

**`POST /api/admin/quiz/recommendations/generate`**

- Queries `archetype` table to get all archetype IDs and names
- Enumerates all valid `(archetype_id, recommendation_mode, experimental)` combinations using the same logic as `computeConfidenceAndMode()` in `quizScoring.ts`
- For each combination, calls Claude haiku to generate a recommendation text. Use `claude-haiku-4-5` (already used elsewhere in the project). Do NOT use Sonnet — these are high-volume cached texts and haiku is sufficient.
- The prompt to Claude for each row should include:
  - The archetype name and its personality description (from the archetypes table or hardcoded from the quiz docs)
  - The recommendation mode and what it means (confident/exploratory/low-confidence etc.)
  - Whether experimental is true
  - A note to use `{{secondary_archetype}}` placeholder where the secondary archetype name should appear
  - A note that actual coffee recommendations should reference coffees from the Axis & Bloom catalogue (Crosshatch, Ethiopia, Feather In Cap from Path Coffee Roasters — or leave a generic "your archetype-matched coffee" if the specific coffee catalogue isn't yet rich enough to hard-reference)
  - Tone: warm, editorial, confident — consistent with the brand voice used in other AI content on the site
  - Length: 2–4 sentences. Not a novel. Similar length to the existing `ai_summary` field.
- Upserts each row with `ON CONFLICT (archetype_id, recommendation_mode, experimental) DO UPDATE SET recommendation_text = EXCLUDED.recommendation_text, generated_at = NOW()` — so re-running the endpoint refreshes all rows
- Returns a summary: `{ generated: N, archetypes: [...], errors: [...] }` 
- Run these sequentially (not all in parallel) to avoid hitting the Anthropic rate limiter

**`POST /api/admin/quiz/recommendations/:id/regenerate`**

- Takes a single `recommendation_template` row ID
- Regenerates just that one row using the same haiku prompt logic
- Returns the updated row
- Useful for tweaking copy on a specific mode without re-running the full generation

**`GET /api/admin/quiz/recommendations`**

- Returns all rows from `recommendation_template` joined with archetype name
- Useful for the admin to inspect what's been generated (no UI needed yet — just the endpoint for debugging)

### 4. Change `POST /api/quiz/results` in `backend/src/routes/quiz.ts`

Current flow (in the handler):
1. Save quiz session to DB
2. Call `getRecommendation()` from `claude.ts`
3. Return `{ id: sessionId, recommendation }`

New flow:
1. Save quiz session to DB (unchanged)
2. Look up recommendation template:
   ```sql
   SELECT recommendation_text 
   FROM recommendation_template 
   WHERE archetype_id = $1 
     AND recommendation_mode = $2 
     AND experimental = $3
     AND is_active = true
   ```
   Where `$1` is the final archetype's UUID (look it up from the `archetype` table by name, same pattern used elsewhere), `$2` is `recommendationMode` from the request body, `$3` is `experimental` from the request body.
3. If a row is found: replace `{{secondary_archetype}}` with `secondaryArchetype` from the request body (if `secondaryArchetype` is null or not present, replace with empty string or omit the sentence gracefully)
4. If NO row is found (table not yet populated, or missing combination): **fall back to the existing `getRecommendation()` call** — do not break the quiz. Log a warning so the admin knows a template is missing.
5. Return `{ id: sessionId, recommendation }` — same shape as before

The fallback is important. During the transition (before `generate` has been run), or if a new quiz version introduces a new combination, the quiz must still work.

---

## Files to modify

- `backend/src/db/schema.sql` — add the new table (idempotent)
- `backend/src/routes/admin.ts` — add 3 new endpoints
- `backend/src/routes/quiz.ts` — update `POST /api/quiz/results` handler
- `backend/src/services/claude.ts` — no changes needed; `getRecommendation()` stays as the fallback

## Files to read first

Before writing any code, read these to understand the existing patterns:
- `backend/src/routes/quiz.ts` — specifically the `POST /api/quiz/results` handler and how it currently calls `getRecommendation()`
- `backend/src/services/claude.ts` — how `getRecommendation()` is structured and what context it currently sends to haiku
- `backend/src/services/quizScoring.ts` — the `computeConfidenceAndMode()` function, to enumerate valid mode/experimental combinations
- `backend/src/routes/admin.ts` — the existing pattern for admin endpoints, especially the `refresh-content` endpoint that generates AI content for coffees (same pattern we're replicating)
- `backend/src/db/schema.sql` — the end of the file, to see where to add the new table and follow the existing style

## Things to be careful about

1. **Archetype UUID lookup**: The recommendation_template stores `archetype_id` (UUID FK). When looking up a template in `POST /api/quiz/results`, the request body sends `archetype` as a name string. You'll need to resolve the name to a UUID — either query the `archetype` table, or cache the mapping. Follow whatever pattern is already used in `quiz.ts` for archetype lookups.

2. **The fallback must not break existing quizzes**: If `recommendation_template` is empty (hasn't been generated yet), `POST /api/quiz/results` must silently fall back to calling `getRecommendation()`. Log a warning, don't throw.

3. **Idempotent schema**: The `CREATE TABLE IF NOT EXISTS` must be safe to run on a DB that already has the table. Follow the same pattern as every other table in `schema.sql`.

4. **Do not remove `getRecommendation()`** from `claude.ts`. It stays as the fallback and can be used for future features.

5. **Generation endpoint is slow by design**: With ~50 Claude haiku calls run sequentially, `POST /api/admin/quiz/recommendations/generate` will take 30–60 seconds. That's fine — it's a one-time admin action. Set a long timeout or stream progress if needed. Do not run in parallel to avoid Anthropic rate limits.

6. **The Floral and Earthy archetype templates** should be written with awareness that these users made a deliberate reclassification choice. The Claude prompt for those rows should include this context — they're not uncertain, they chose the more specific profile.

## What success looks like

- `POST /api/admin/quiz/recommendations/generate` runs and fills ~50 rows in `recommendation_template`
- `POST /api/quiz/results` returns a recommendation from the DB in a single query, with no Anthropic API call
- If the table is empty or a row is missing, the quiz still works (falls back to live Claude call with a warning log)
- `GET /api/admin/quiz/recommendations` returns all generated rows for inspection
