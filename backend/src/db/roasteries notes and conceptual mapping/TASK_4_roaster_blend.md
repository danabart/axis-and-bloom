# Task 4 — Seed `roaster_blend`

## Depends on
Task 1 (`coffees_path_tcr.sql`) must be run first.

## Source
Read the **coffees** sheet from:
`backend/src/db/roasteries notes and conceptual matrix.xlsx`

Columns used: `name, roaster, blend_or_single, archetype_estimate, sku_12oz, sku_5lb`

## Goal
Generate `backend/src/db/seeds/roaster_blend_both.sql` — two rows per coffee (one per bag size: 12oz and 5lb), for both Path Coffee Roasters and Temecula Coffee Roasters.

## Schema
```sql
roaster_blend (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roaster_id       UUID REFERENCES roaster(id),
  archetype_id     UUID REFERENCES archetype(id),
  blend_name       TEXT NOT NULL,
  roaster_sku      TEXT,
  coffee_type      TEXT DEFAULT 'blend',
  weight_oz        NUMERIC DEFAULT 12.0,
  is_active        BOOLEAN DEFAULT true,
  inventory_status TEXT DEFAULT 'in_stock'
)
```

## Rules

### Resolve FKs
- `roaster_id`:
  ```sql
  SELECT id FROM roaster WHERE name = 'Path Coffee Roasters'   -- or Temecula
  ```
- `archetype_id` (map from archetype_estimate):
  ```sql
  SELECT id FROM archetype WHERE name ILIKE '%balanced%'   -- for Balanced & Sweet
  SELECT id FROM archetype WHERE name ILIKE '%chocolate%'  -- for Chocolate & Nutty
  SELECT id FROM archetype WHERE name ILIKE '%earth%'      -- for Spicy & Earthy
  SELECT id FROM archetype WHERE name ILIKE '%floral%'
  SELECT id FROM archetype WHERE name ILIKE '%fruit%'
  SELECT id FROM archetype WHERE name ILIKE '%experiment%'
  -- NULL for Half-Caf, Decaf, Flavored
  ```

### Per-coffee, create two rows
| Row | `roaster_sku` | `weight_oz` | `inventory_status` |
|---|---|---|---|
| 12oz | `sku_12oz` from sheet | 12.0 | `'pending'` |
| 5lb | `sku_5lb` from sheet | 80.0 | `'pending'` |

### Other fields
- `blend_name` → coffee `name` from sheet (roaster's product name)
- `coffee_type` → `'blend'` if blend_or_single = 'Blend', else `'single_origin'`
- `is_active = true`
- `inventory_status = 'pending'` — neither roaster is live yet

### Skip
- Flavored coffees (Vanilla, Hazelnut, Chocolate) — ground-only, need separate handling
- File header must note: "Do NOT add to schema.sql — not idempotent"

## Verify
```sql
SELECT r.name AS roaster, COUNT(*) AS blend_rows
FROM roaster_blend rb
JOIN roaster r ON r.id = rb.roaster_id
GROUP BY r.name;
```
