// Cupping evidence brief 3, Part 0 (2026-10-18) — test fixtures never touch a
// live slot. Since brief 2, prod (and every test:db:refresh copy of it) holds
// real placements and real 12 oz prices on some slots; a fixture that placed
// on a hard-coded fruity/1 collided with them, and a cleanup that deleted
// "the 12 oz price of the slot I used" deleted the real price. These helpers
// pick slots at run time that have no active placement and no 12 oz price,
// so a fixture's placements and its 12 oz price cleanup only ever touch rows
// the fixture created.
import type pg from 'pg';
import { db } from '../db/client.js';

type Runner = Pick<pg.Pool | pg.PoolClient, 'query'>;

export interface FreeSlot { id: number; archetype: string; sortOrder: number }

/** Active slots of real archetypes (is_archetype) with no active placement and no 12 oz price, lowest sort order first. */
export async function freeSlots(filter: { archetype?: string } = {}, runner: Runner = db): Promise<FreeSlot[]> {
  const { rows } = await runner.query<{ id: number; archetype: string; sort_order: number }>(
    `SELECT s.id, s.archetype::text AS archetype, s.sort_order
       FROM coffee_dial_slot s
       JOIN v_coffee_archetype a ON a.code::text = s.archetype::text AND a.is_archetype
      WHERE s.is_active
        AND ($1::text IS NULL OR s.archetype::text = $1)
        AND NOT EXISTS (SELECT 1 FROM coffee_slot_assignment x WHERE x.slot_id = s.id AND x.is_active)
        AND NOT EXISTS (SELECT 1 FROM coffee_slot_price p WHERE p.slot_id = s.id AND p.weight_oz = 12)
      ORDER BY a.sort_order, s.sort_order`,
    [filter.archetype ?? null]
  );
  return rows.map(r => ({ id: r.id, archetype: r.archetype, sortOrder: r.sort_order }));
}

/** `count` free slots of one archetype: the one given, else the first archetype (not in `notArchetypes`) that has enough. */
export async function freeSlotsInOneArchetype(
  count: number,
  opts: { archetype?: string; notArchetypes?: string[] } = {},
  runner: Runner = db
): Promise<FreeSlot[]> {
  const all = await freeSlots({ archetype: opts.archetype }, runner);
  const byArchetype = new Map<string, FreeSlot[]>();
  for (const s of all) {
    if (opts.notArchetypes?.includes(s.archetype)) continue;
    byArchetype.set(s.archetype, [...(byArchetype.get(s.archetype) ?? []), s]);
  }
  for (const slots of byArchetype.values()) if (slots.length >= count) return slots.slice(0, count);
  throw new Error(`test fixture needs ${count} free slots in one archetype${opts.archetype ? ` (${opts.archetype})` : ''}; none has that many (live placements or 12 oz prices on the rest)`);
}

/** Archetypes with a real (not Vitest/Zzz) coffee sellable now: a fixture that counts an archetype's sellable positions avoids them. */
export async function liveSellableArchetypes(runner: Runner = db): Promise<string[]> {
  const { rows } = await runner.query<{ archetype: string }>(
    `SELECT DISTINCT ss.archetype::text AS archetype FROM v_coffee_sellable_slot ss JOIN coffees c ON c.id = ss.coffee_id
      WHERE c.name NOT LIKE 'Vitest%' AND c.name NOT LIKE 'Zzz%'`
  );
  return rows.map(r => r.archetype);
}

/** Coffees sellable now that no test fixture created (not Vitest/Zzz): pass them as a fixture's exclusions so a pool assertion sees only the fixture's own coffees. */
export async function liveSellableCoffeeIds(runner: Runner = db): Promise<number[]> {
  const { rows } = await runner.query<{ coffee_id: number }>(
    `SELECT DISTINCT ss.coffee_id FROM v_coffee_sellable_slot ss JOIN coffees c ON c.id = ss.coffee_id
      WHERE c.name NOT LIKE 'Vitest%' AND c.name NOT LIKE 'Zzz%'`
  );
  return rows.map(r => r.coffee_id);
}
