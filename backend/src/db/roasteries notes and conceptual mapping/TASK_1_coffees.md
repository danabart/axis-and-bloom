# Task 1 — Seed `coffees` table

## Source
Read the **coffees** sheet from:
`backend/src/db/roasteries notes and conceptual mapping/roasteries notes and conceptual matrix.xlsx`

Columns: `name, roaster, origin, blend_or_single, process, roast_level, roast_shade, archetype_estimate, dial_position, sku_12oz, sku_5lb`

## Goal
Generate `backend/src/db/seeds/coffees_path_tcr.sql` — one INSERT per coffee for both Path Coffee Roasters and Temecula Coffee Roasters.

## Schema
```sql
coffees (
  id                         SERIAL PRIMARY KEY,
  name                       TEXT NOT NULL,
  roaster                    TEXT,
  origin                     TEXT,
  blend_or_single            TEXT,
  process                    TEXT,
  roast_level                TEXT,
  roast_shade                TEXT,
  flavor_descriptors_roaster TEXT[],   -- leave NULL
  ai_summary                 TEXT,     -- leave NULL
  surprise_note              TEXT,     -- leave NULL
  three_voice_story          TEXT      -- leave NULL
)
```

## Rules
- **Skip these 3** — already in DB from session 001:
  - `Crosshatch` (Path Coffee Roasters)
  - `Ethiopia` (Path Coffee Roasters)
  - `Feather In Cap` (Path Coffee Roasters)
- `blend_or_single` → lowercase: `'blend'` or `'single origin'`
- `flavor_descriptors_roaster`, `ai_summary`, `surprise_note`, `three_voice_story` → all NULL
- Use `ON CONFLICT DO NOTHING` (no unique constraint exists on name+roaster, but safe to include)
- File header must note: "Do NOT add to schema.sql — not idempotent"

## Verify
```sql
SELECT roaster, COUNT(*) FROM coffees GROUP BY roaster ORDER BY roaster;
```
Expected: Path ~10 new rows, Temecula ~16 new rows (plus the 3 session 001 rows already there).
