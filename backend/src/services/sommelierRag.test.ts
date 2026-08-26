// Roastery lifecycle (2026-08-25) — Liam must never *recommend* an inactive
// coffee, but must still be able to name a customer's own inactive coffee by
// its house alias (my_coffee/brew-card/SMS turns). Requires DATABASE_URL
// pointed at a reachable Postgres instance with the roastery-lifecycle schema
// applied — cannot run against a pre-migration database.
//
// The candidate-pool test temporarily deactivates and restores a REAL coffee
// (whichever curated_mix happens to return first) — same pattern
// admin.lookups.test.ts already uses on real rows, always inside a
// try/finally. Everything in the alias-fallback test is a disposable
// fixture, deleted at the end.
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { db } from '../db/client.js';
import { fetchSommelierCoffees, getAliases } from './sommelierRag.js';

describe('fetchSommelierCoffees — candidate pool excludes inactive coffees', () => {
  it('drops a coffee from the pool the moment it goes inactive, and returns once reactivated', async () => {
    const before = await fetchSommelierCoffees({ ragFocus: 'curated_mix', userArchetype: null });
    expect(before.coffeeIds.length).toBeGreaterThan(0);
    const targetId = before.coffeeIds[0];
    const original = (await db.query('SELECT is_active FROM coffees WHERE id = $1', [targetId])).rows[0].is_active;
    try {
      await db.query('UPDATE coffees SET is_active = false WHERE id = $1', [targetId]);
      const after = await fetchSommelierCoffees({ ragFocus: 'curated_mix', userArchetype: null });
      expect(after.coffeeIds).not.toContain(targetId);
    } finally {
      await db.query('UPDATE coffees SET is_active = $1 WHERE id = $2', [original, targetId]);
    }
  }, 20000);
});

describe('getAliases — owned-bag fallback for an inactive coffee', () => {
  it('still resolves a house/slot name via dial_archetype_positions when coffee_alias.is_active is false (the cascade\'s own post-deactivation state)', async () => {
    const vocab = (await db.query(`
      SELECT dpv.id AS vocabulary_id, dpv.archetype, dpv.sort_order, dsa.platform_name
      FROM dial_position_vocabulary dpv
      JOIN dial_slot_alias dsa ON dsa.archetype = dpv.archetype AND dsa.dial_sort_order = dpv.sort_order
      LIMIT 1
    `)).rows[0];
    expect(vocab).toBeTruthy();

    const coffee = (await db.query(
      `INSERT INTO coffees (name, roaster, is_active) VALUES ('Vitest Alias Fallback Coffee', 'Vitest Roastery', false) RETURNING id`
    )).rows[0];
    const position = (await db.query(
      `INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default, is_guest)
       VALUES ($1, $2, $3, false, false) RETURNING id`,
      [vocab.archetype, coffee.id, vocab.vocabulary_id]
    )).rows[0];
    // is_active=false + deactivation_reason='roaster' — exactly the cascade's
    // own shape for an alias row belonging to a deactivated roastery.
    const alias = (await db.query(
      `INSERT INTO coffee_alias (platform_name, coffee_id, is_active, deactivation_reason)
       VALUES ('Vitest Alias Fallback Alias', $1, false, 'roaster') RETURNING id`,
      [coffee.id]
    )).rows[0];
    try {
      const aliases = await getAliases([coffee.id]);
      expect(aliases.get(coffee.id)).toBe(vocab.platform_name);
    } finally {
      await db.query('DELETE FROM coffee_alias WHERE id = $1', [alias.id]);
      await db.query('DELETE FROM dial_archetype_positions WHERE id = $1', [position.id]);
      await db.query('DELETE FROM coffees WHERE id = $1', [coffee.id]);
    }
  });
});
