# Task 5 — Seed `dial_archetype_positions` (Bloom Dial)

## Depends on
Task 1 (`coffees_path_tcr.sql`) must be run first.

## Source
Read the **coffees** sheet from:
`backend/src/db/roasteries notes and conceptual matrix.xlsx`

Columns used: `name, roaster, archetype_estimate, dial_position`

## Goal
Generate `backend/src/db/seeds/dial_positions_path_tcr.sql`.

## Where Bloom Dial data comes from
The admin portal Bloom Dial page reads from:
- **Positions tab** → `GET /api/admin/dial/positions` → `v_dial_positions` view → `dial_archetype_positions` table
- **Navigation Hops tab** → `GET /api/admin/dial/navigation` → `v_dial_navigation` view → `dial_coffee_relationships` table

This task only seeds positions. Navigation hops require editorial judgment — do those via the admin UI after positions are confirmed.

## Schema
```sql
dial_archetype_positions (
  id            SERIAL PRIMARY KEY,
  archetype     archetype_enum NOT NULL,
  coffee_id     INT REFERENCES coffees(id),
  vocabulary_id INT REFERENCES dial_position_vocabulary(id),
  is_default    BOOLEAN DEFAULT FALSE,
  UNIQUE(archetype, coffee_id)
)
```

## `dial_position_vocabulary` — already seeded

| archetype | dimension | sort_order | label |
|---|---|---|---|
| balanced_sweet | Acidity (5) | 1 | Smooth |
| balanced_sweet | Acidity (5) | 2 | Balanced |
| balanced_sweet | Acidity (5) | 3 | Bright |
| balanced_sweet | Acidity (5) | 4 | Lively |
| chocolate_nutty | Body (7) | 1 | Lighter |
| chocolate_nutty | Body (7) | 2 | Classic |
| chocolate_nutty | Body (7) | 3 | Richer |
| chocolate_nutty | Body (7) | 4 | Full |
| fruity | Acidity (5) | 1 | Mellow |
| fruity | Acidity (5) | 2 | Balanced |
| fruity | Acidity (5) | 3 | Bright |
| fruity | Acidity (5) | 4 | Vibrant |
| floral | Savory/Depth (9) | 1 | Delicate |
| floral | Savory/Depth (9) | 2 | Balanced |
| floral | Savory/Depth (9) | 3 | Complex |
| floral | Savory/Depth (9) | 4 | Layered |
| earthy | Bitterness (6) | 1 | Gentle |
| earthy | Bitterness (6) | 2 | Earthy |
| earthy | Bitterness (6) | 3 | Bold |
| earthy | Bitterness (6) | 4 | Intense |

Note: `experimental`, `half_caf`, `decaf` have no vocabulary rows — skip those coffees.

## dial_position → sort_order mapping

| dial_position value in sheet | sort_order |
|---|---|
| Approachable / Gentle | 1 |
| Default | 2 |
| Bold | 3 |
| Complex | 4 |
| Bold / Complex | 3 or 4 — use 4 for the most intense coffees per archetype |

## is_default rules
One coffee per roaster per archetype should be `is_default = true` — the "Classic" middle position:
- **balanced_sweet**: Feather In Cap (Path, default), Guatemala (TCR, default)
- **chocolate_nutty**: Noam Blend (Path, default), Brazil Santos (TCR, default)
- **earthy**: Nocturnal Dark Roast (Path, default), Sumatra (TCR, default)
- **floral**: Honduras (Path, default), Ethiopia Natural (TCR, default)
- **fruity**: Ethiopia (Path, default), Tanzania (TCR, default)
All others: `is_default = false`

## Resolve vocabulary_id
```sql
SELECT id FROM dial_position_vocabulary
WHERE archetype = '<archetype_enum>' AND sort_order = <n>
```

## Rules
- Use `ON CONFLICT (archetype, coffee_id) DO NOTHING`
- File header must note: "Do NOT add to schema.sql — not idempotent"

## Verify
```sql
SELECT archetype, COUNT(*) AS coffees, 
       SUM(CASE WHEN is_default THEN 1 ELSE 0 END) AS defaults
FROM dial_archetype_positions
GROUP BY archetype ORDER BY archetype;
```
