# Task 6 — Add `coffee_alias` table + seed

## Depends on
Task 1 (`coffees_path_tcr.sql`) must be run first.

## Source
Read the **archetype_matrix** sheet from:
`backend/src/db/roasteries notes and conceptual matrix.xlsx`

This sheet has columns: `Archetype, Matrix, ← Label, ↖ Path, ↖ Temecula, Bag Name (Left), ◉ Label, ◉ Path, ◉ Temecula, Bag Name (Default), → Label, ↗ Path, ↗ Temecula, Bag Name (Right)`

## Goal
**Step A:** Add `coffee_alias` to `schema.sql` (idempotent `CREATE TABLE IF NOT EXISTS`).  
**Step B:** Generate `backend/src/db/seeds/coffee_alias_path_tcr.sql`.

## Step A — Add to schema.sql

Find the end of the cupping tool table group in `schema.sql` and insert:

```sql
-- Maps Axis & Bloom platform slot names to the coffees that fill them.
-- Multiple coffees (from different roasters) can share a platform_name slot.
-- priority=1 is preferred; priority=2 is fallback if priority=1 is out of stock.
CREATE TABLE IF NOT EXISTS coffee_alias (
  id              SERIAL PRIMARY KEY,
  platform_name   TEXT NOT NULL,
  archetype       archetype_enum,   -- NULL for Half-Caf / Decaf (no enum value)
  dial_sort_order INT,              -- matches dial_position_vocabulary.sort_order
  coffee_id       INT REFERENCES coffees(id) ON DELETE CASCADE,
  is_active       BOOLEAN DEFAULT TRUE,
  priority        INT DEFAULT 1,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (archetype, dial_sort_order, coffee_id)
);
```

## Step B — Seed coffee_alias

For each non-empty Path or Temecula cell in the archetype_matrix sheet, create one row:

| Field | Source |
|---|---|
| `platform_name` | Bag Name column for that position (Left/Default/Right) |
| `archetype` | archetype_enum for that row (NULL for Half-Caf/Decaf) |
| `dial_sort_order` | Left col = 1, Default col = 2, Right col = 3 (use 4 if right has two coffees at different intensities) |
| `coffee_id` | `SELECT id FROM coffees WHERE name = '<coffee>' AND roaster = '<roaster>'` |
| `priority` | Path coffees = 1, Temecula coffees = 2 |
| `is_active` | true |

### archetype_enum mapping
| Matrix row | enum |
|---|---|
| Balanced & Sweet | `balanced_sweet` |
| Chocolate & Nutty | `chocolate_nutty` |
| Spicy & Earthy | `earthy` |
| Floral | `floral` |
| Fruity | `fruity` |
| Experimental | `experimental` |
| Half-Caf | NULL |
| Decaf | NULL |

### Skip
- Empty cells ("—") in the Path/Temecula columns
- Any coffee name that doesn't resolve to a row in `coffees` (log a warning comment in the SQL)

### Conflict handling
```sql
ON CONFLICT (archetype, dial_sort_order, coffee_id) DO NOTHING
```

Note: rows where `archetype IS NULL` (Half-Caf/Decaf) won't hit this unique constraint — that's fine, insert them without conflict clause or use a separate INSERT.

## Rules
- File header must note: "Do NOT add to schema.sql — seed only"

## Verify
```sql
SELECT platform_name, archetype, dial_sort_order,
       c.name AS coffee, c.roaster, ca.priority
FROM coffee_alias ca
JOIN coffees c ON c.id = ca.coffee_id
ORDER BY archetype, dial_sort_order, priority;
```
