# Flavor Intelligence Page — Part 9: every coffee shows "Multi-Origin / Blend" — backfill wasn't applied correctly

Parts 1–8 (this same folder) are live. Dana reports every coffee on the page shows the same `originRegion` tag — "Multi-Origin / Blend" — regardless of whether it's actually a single-origin coffee. That's wrong for most of the catalogue: Part 1 Decision #7 specified real per-coffee regions for the majority of coffees, with "Multi-Origin / Blend" reserved for the handful that are genuinely blends or roastery-labeled as spanning regions.

## Diagnose before fixing

This looks like the one-time manual backfill (Part 1 Decision #7) either wasn't done per-coffee, or a migration/seed script defaulted every row to the same `origin_region_id` instead of following the mapping table. Before writing new UPDATE statements, check what actually happened:

```sql
SELECT c.name, c.roaster, c.origin, lv.label AS current_region
FROM coffees c
LEFT JOIN lookup_value lv ON lv.id = c.origin_region_id
ORDER BY c.roaster, c.name;
```
Compare the result against the table below. If literally every row shows the same `current_region`, look for whatever script or migration set `origin_region_id` and fix the root cause (e.g. a default value applied in the column definition, or a backfill script that used one static ID instead of iterating the mapping) so this doesn't silently happen again on the next deploy.

## The correct mapping (from Part 1 Decision #7 — restated here for direct use)

Checked against the real catalogue (`backend/src/db/seeds/coffees_path_tcr.sql`):

| Coffee | Roaster | Correct region |
|---|---|---|
| Ethiopia | Path | East Africa |
| Ethiopia Natural | Temecula | East Africa |
| Uganda | Temecula | East Africa |
| Tanzania | Temecula | East Africa |
| Kenya | Temecula | East Africa |
| African Espresso Blend (Uganda & Ethiopia Blend) | Temecula | East Africa |
| Honduras | Path | Central America |
| Guatemala | Temecula | Central America |
| Costa Rica | Temecula | Central America |
| Colombia | Path | South America |
| Colombia | Temecula | South America |
| Decaf (origin: Colombia) | Path | South America |
| Brazil Santos | Temecula | South America |
| Sumatra | Temecula | Southeast Asia & Pacific |
| Bali Blue | Temecula | Southeast Asia & Pacific |
| Papua New Guinea | Temecula | Southeast Asia & Pacific |
| Breakfast Blend | Temecula | Multi-Origin / Blend |
| Blonde Blend (Central America & Africa Blend) | Temecula | Multi-Origin / Blend |
| 6-Bean Espresso Blend | Temecula | Multi-Origin / Blend |
| Kopi Safari | Temecula | Multi-Origin / Blend |
| Vanilla, Hazelnut, Chocolate (flavored) | Path | Multi-Origin / Blend |
| Nocturnal Dark Roast, Vantablack Ultra-Dark (origin: "Central/South America") | Path | Multi-Origin / Blend |
| Sleepwalker Half-Caf (origin: "Decaf & Central/South America Blend") | Path | Multi-Origin / Blend |
| Noam Blend (origin: "Central Blend") | Path | Central America **or** Multi-Origin / Blend — genuinely ambiguous, use judgment (leaning Central America is defensible since the roastery's own label says "Central," not "multi-region") |
| Crosshatch | Path | Not in the seed file checked while writing Part 1 — look up `coffees.origin` directly and assign for real, don't leave defaulted |
| Feather In Cap | Path | Same as above — look up and assign |

## Fix

1. Run the diagnostic query above first — understand what's actually in the table before changing it.
2. For every coffee above, `UPDATE coffees SET origin_region_id = (SELECT id FROM lookup_value WHERE category = 'origin_region' AND value = '<correct value>') WHERE name = '<name>' AND roaster = '<roaster>';` — matching on both `name` and `roaster` since coffee names repeat across the two roasters (e.g. two coffees both named "Colombia").
3. Look up `Crosshatch` and `Feather In Cap`'s real `origin` column values and assign their region for real — don't default them to Multi-Origin just because they weren't in the original mapping table.
4. Confirm `AdminCoffees.tsx`'s origin-region dropdown (added in Part 1) actually lets an admin change this per coffee going forward, and that it isn't itself defaulting new/unset coffees to "Multi-Origin / Blend" — if the dropdown's default selected option is the cause of the bug, fix the default to be unset/blank, not a specific region, so a coffee without a deliberate assignment shows nothing (per Part 1 Decision #7's original "omit the element entirely if unset" rule) rather than a wrong-but-present value.

## Testing

- Re-run the diagnostic query: confirm each coffee now shows its correct region, and only the genuinely multi-origin/blend coffees still show "Multi-Origin / Blend."
- Spot-check the page itself for a few single-origin coffees (an Ethiopia, a Colombia, a Guatemala) and confirm the origin badge now shows the right region, not "Multi-Origin / Blend."
- Confirm the admin dropdown still works for manually correcting a coffee's region going forward, and doesn't silently default new coffees to the wrong value.
