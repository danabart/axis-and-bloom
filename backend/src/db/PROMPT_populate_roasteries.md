# DB Population — Task Index

Source file: `backend/src/db/roasteries notes and conceptual matrix.xlsx`

Run tasks in order. Each has its own prompt file.

| # | File | Seeds |
|---|---|---|
| 1 | `TASK_1_coffees.md` | `coffees` |
| 2 | `TASK_2_descriptors.md` | `roastery_coffee_descriptors` |
| 3 | `TASK_3_archetype_assignments.md` | `archetype_assignments` |
| 4 | `TASK_4_roaster_blend.md` | `roaster_blend` |
| 5 | `TASK_5_dial_positions.md` | `dial_archetype_positions` |
| 6 | `TASK_6_coffee_alias.md` | `coffee_alias` (+ schema.sql) |

## Already in the DB — do not re-insert
- `roaster` table: both Path Coffee Roasters and Temecula Coffee Roasters exist
- `coffees` table: Crosshatch, Ethiopia, Feather In Cap (from session 001)
- `roastery_coffee_descriptors`: 9 rows for the three session 001 coffees
- `archetype_assignments`: assignments for Crosshatch, Ethiopia, Feather In Cap
