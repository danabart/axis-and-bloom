# Task 3 — Seed `archetype_assignments`

## Depends on
Task 1 (`coffees_path_tcr.sql`) must be run first.

## Source
Read the **coffees** sheet from:
`backend/src/db/roasteries notes and conceptual matrix.xlsx`

Use the `archetype_estimate` column for the archetype value.

## Goal
Generate `backend/src/db/seeds/archetype_assignments_path_tcr.sql` — one INSERT per coffee.

## Schema
```sql
archetype_assignments (
  id                       SERIAL PRIMARY KEY,
  coffee_id                INTEGER REFERENCES coffees(id),
  archetype                archetype_enum NOT NULL,
  confidence               confidence_enum NOT NULL,
  assigned_from_session_id INTEGER,   -- NULL for manual assignments
  superseded_at            TIMESTAMPTZ, -- NULL = current
  notes                    TEXT
)
```

## archetype_enum mapping
The `archetype_estimate` column uses plain English. Map to the PostgreSQL enum:

| Sheet value | Enum value |
|---|---|
| Balanced & Sweet | `balanced_sweet` |
| Chocolate & Nutty | `chocolate_nutty` |
| Spicy & Earthy | `earthy` |
| Floral | `floral` |
| Fruity | `fruity` |
| Experimental | `experimental` |
| Half-Caf | skip — no enum value |
| Decaf | skip — no enum value |
| Flavored | skip — no enum value |

## Rules
- `confidence = 'medium'` for all (pre-cupping estimates, not session-derived)
- `assigned_from_session_id = NULL`
- `superseded_at = NULL`
- `notes = 'Pre-cupping estimate based on roaster bag notes'`
- **Skip** Crosshatch, Ethiopia, Feather In Cap — assignments already exist from session 001
- **Skip** Half-Caf, Decaf, Flavored coffees — no archetype_enum value exists for these
- Use `ON CONFLICT DO NOTHING` if a unique index exists; otherwise wrap in `WHERE NOT EXISTS`
- File header must note: "Do NOT add to schema.sql — not idempotent"

## Verify
```sql
SELECT archetype, COUNT(*)
FROM archetype_assignments
WHERE superseded_at IS NULL
GROUP BY archetype ORDER BY archetype;
```
