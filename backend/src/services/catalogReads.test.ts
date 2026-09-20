// Catalog Blueprint · brief 3, Part E. Requires DATABASE_URL, same convention
// as the rest of this feature's tests.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../db/client.js';
import { createCoffee, setMatchArchetype, placeCoffee } from './catalogService.js';
import { archetypeCode, archetypeUuid, getCatalogVersion } from './catalogReads.js';

const ACTOR = { actor: 'vitest' };

afterAll(async () => {
  await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffee_archetype_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest%')`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest%'`);
});

describe('archetypeCode', () => {
  it('resolves a display label, case-insensitively, to its enum code', async () => {
    expect(await archetypeCode('Chocolate & Nutty')).toBe('chocolate_nutty');
    expect(await archetypeCode('CHOCOLATE & nutty')).toBe('chocolate_nutty');
  });

  it('passes an already-valid code straight through', async () => {
    expect(await archetypeCode('chocolate_nutty')).toBe('chocolate_nutty');
  });

  it('returns null for an unrecognized label or code', async () => {
    expect(await archetypeCode('Not A Real Archetype')).toBeNull();
  });

  it('resolves the current name and the retired "Balanced & Sweet" names to the same code', async () => {
    expect(await archetypeCode('Balanced')).toBe('balanced_sweet');
    expect(await archetypeCode('Balanced & Sweet')).toBe('balanced_sweet');
    expect(await archetypeCode('balanced and sweet')).toBe('balanced_sweet');
  });
});

describe('archetypeUuid', () => {
  it('resolves the retired and current Balanced names to the same non-null UUID', async () => {
    const current = await archetypeUuid('Balanced');
    expect(current).not.toBeNull();
    expect(await archetypeUuid('Balanced & Sweet')).toBe(current);
    expect(await archetypeUuid('balanced_sweet')).toBe(current);
  });

  it('returns null for an unrecognized name', async () => {
    expect(await archetypeUuid('Not A Real Archetype')).toBeNull();
  });
});

describe('getCatalogVersion', () => {
  it('changes after a placeCoffee write', async () => {
    let roaster: { id: string } | undefined;
    let coffeeId: number | undefined;
    try {
      const before = await getCatalogVersion();

      roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Version Roastery', true) RETURNING id`)).rows[0];
      const { result: created } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Version Coffee' }, ACTOR);
      coffeeId = created.coffeeId;
      await setMatchArchetype({ coffeeId, archetype: 'floral', confidence: 'high', source: 'manual' }, ACTOR);
      const slot = (await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = 'floral' AND sort_order = 4`)).rows[0];
      await placeCoffee({ coffeeId, slotId: slot.id, role: 'home' }, ACTOR);

      const after = await getCatalogVersion();
      expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
    } finally {
      if (coffeeId) {
        await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id = $1`, [coffeeId]);
        await db.query(`DELETE FROM coffee_archetype_assignment WHERE coffee_id = $1`, [coffeeId]);
        await db.query(`DELETE FROM coffees WHERE id = $1`, [coffeeId]);
      }
      if (roaster) await db.query(`DELETE FROM roaster WHERE id = $1`, [roaster.id]);
    }
  }, 20000);
});
