# Task 2 — Seed `roastery_coffee_descriptors`

## Depends on
Task 1 (`coffees_path_tcr.sql`) must be run first.

## Source
Read the **roastery_coffee_descriptors** sheet from:
`backend/src/db/roasteries notes and conceptual matrix.xlsx`

Columns: `coffee_name, roaster, bag_note, sca_descriptor, wheel_category, wheel_subcategory, notes`

## Goal
Generate `backend/src/db/seeds/roastery_descriptors_path_tcr.sql` — one INSERT per row in the sheet.

## Schema
```sql
roastery_coffee_descriptors (
  id              SERIAL PRIMARY KEY,
  coffee_id       INTEGER REFERENCES coffees(id),
  cupping_note_id INTEGER REFERENCES cupping_note(id),
  notes           TEXT,
  UNIQUE (coffee_id, cupping_note_id)
)
```

## Rules
- Resolve `coffee_id`:
  ```sql
  SELECT id FROM coffees WHERE name = '<coffee_name>' AND roaster = '<roaster>'
  ```
- Resolve `cupping_note_id`:
  ```sql
  SELECT id FROM cupping_note WHERE descriptor = '<sca_descriptor>'
  ```
- `notes` → the `notes` column from the sheet (roaster's original bag language)
- Use `ON CONFLICT (coffee_id, cupping_note_id) DO NOTHING` — safe to skip already-seeded rows (the 9 session 001 descriptors for Crosshatch, Ethiopia, Feather In Cap are already in DB)
- File header must note: "Do NOT add to schema.sql — not idempotent"

## Verify
```sql
SELECT c.roaster, COUNT(*) 
FROM roastery_coffee_descriptors rcd
JOIN coffees c ON c.id = rcd.coffee_id
GROUP BY c.roaster;
```
