// Roastery lifecycle (2026-08-25) — coverage for isCoffeeRetired's new
// primary signal (coffees.is_active) and the standing requirement that the
// universal QR resolve path (routes/qr.ts, via resolveUniversalToken +
// hasAnyOrderOrSponsorship) never depends on roastery/coffee active state —
// an owned-bag surface, untouched by the deactivation cascade (Decision 5).
//
// Requires DATABASE_URL pointed at a reachable Postgres instance with the
// roastery-lifecycle schema applied. Every fixture is disposable and deleted
// in a finally block; getOrMintCanonicalUniversalToken reuses (never
// re-mints past) the real, already-minted 'path' canonical token rather than
// writing a new universal token row.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../db/client.js';
import { isCoffeeRetired, resolveUniversalToken, hasAnyOrderOrSponsorship, getOrMintCanonicalUniversalToken } from './qrDoor.js';

// 2026-08-26 hardening round — the real safety net for a fixture whose
// creation itself fails partway. This file's own fixture also creates
// order/order_line_item/user_profile rows beyond the roaster/coffees/
// roaster_blend/coffee_alias set every other file's sweep covers — deleted
// first here, in FK order, since order_line_item.blend_id has no ON DELETE
// CASCADE from roaster_blend (a leftover order_line_item would otherwise
// make the roaster_blend delete below throw a foreign key violation).
afterAll(async () => {
  await db.query(`
    DELETE FROM order_line_item WHERE blend_id IN (SELECT id FROM roaster_blend WHERE blend_name LIKE 'Vitest%')
  `);
  await db.query(`DELETE FROM "order" WHERE user_id IN (SELECT id FROM user_profile WHERE firebase_uid LIKE 'vitest-%')`);
  await db.query(`DELETE FROM user_profile WHERE firebase_uid LIKE 'vitest-%'`);
  await db.query(`DELETE FROM coffee_alias WHERE platform_name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster_blend WHERE blend_name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest%'`);
});

describe('isCoffeeRetired', () => {
  it('is true once a coffee is inactive, even with an active roaster_blend row', async () => {
    let coffee: { id: number } | undefined;
    let blend: { id: string } | undefined;
    try {
      coffee = (await db.query(
        `INSERT INTO coffees (name, roaster, is_active) VALUES ('Vitest Retired Coffee', 'Vitest Roastery', true) RETURNING id`
      )).rows[0];
      blend = (await db.query(
        `INSERT INTO roaster_blend (blend_name, coffee_id, weight_oz, is_active) VALUES ('Vitest Retired Blend', $1, 12, true) RETURNING id`,
        [coffee!.id]
      )).rows[0];

      expect(await isCoffeeRetired(coffee!.id)).toBe(false);
      await db.query('UPDATE coffees SET is_active = false WHERE id = $1', [coffee!.id]);
      expect(await isCoffeeRetired(coffee!.id)).toBe(true);
    } finally {
      if (blend) await db.query('DELETE FROM roaster_blend WHERE id = $1', [blend.id]);
      if (coffee) await db.query('DELETE FROM coffees WHERE id = $1', [coffee.id]);
    }
  });

  it('is also true (secondary signal) for an active coffee with no active roaster_blend row at all', async () => {
    let coffee: { id: number } | undefined;
    try {
      coffee = (await db.query(
        `INSERT INTO coffees (name, roaster, is_active) VALUES ('Vitest No-Blend Coffee', 'Vitest Roastery', true) RETURNING id`
      )).rows[0];
      expect(await isCoffeeRetired(coffee!.id)).toBe(true);
    } finally {
      if (coffee) await db.query('DELETE FROM coffees WHERE id = $1', [coffee.id]);
    }
  });
});

describe('Universal QR resolve path stays independent of roastery/coffee active state (Decision 5)', () => {
  it('resolveUniversalToken resolves the canonical token, and hasAnyOrderOrSponsorship still sees a profile whose only order line is for an inactive coffee', async () => {
    let coffee: { id: number } | undefined;
    let blend: { id: string } | undefined;
    let profile: { id: string } | undefined;
    let order: { id: string } | undefined;
    let lineItem: { id: string } | undefined;
    try {
      const canonical = await getOrMintCanonicalUniversalToken();
      expect(await resolveUniversalToken(canonical.token)).toBe('path');

      coffee = (await db.query(
        `INSERT INTO coffees (name, roaster, is_active) VALUES ('Vitest QR Fixture Coffee', 'Vitest Roastery', false) RETURNING id`
      )).rows[0];
      blend = (await db.query(
        `INSERT INTO roaster_blend (blend_name, coffee_id, weight_oz, is_active) VALUES ('Vitest QR Fixture Blend', $1, 12, false) RETURNING id`,
        [coffee!.id]
      )).rows[0];
      profile = (await db.query(
        `INSERT INTO user_profile (firebase_uid) VALUES ('vitest-qr-fixture-uid') RETURNING id`
      )).rows[0];
      order = (await db.query(
        `INSERT INTO "order" (user_id, fulfillment_status) VALUES ($1, 'delivered') RETURNING id`,
        [profile!.id]
      )).rows[0];
      lineItem = (await db.query(
        `INSERT INTO order_line_item (order_id, blend_id) VALUES ($1, $2) RETURNING id`,
        [order!.id, blend!.id]
      )).rows[0];

      expect(await hasAnyOrderOrSponsorship(profile!.id)).toBe(true);
    } finally {
      if (lineItem) await db.query('DELETE FROM order_line_item WHERE id = $1', [lineItem.id]);
      if (order) await db.query('DELETE FROM "order" WHERE id = $1', [order.id]);
      if (profile) await db.query('DELETE FROM user_profile WHERE id = $1', [profile.id]);
      if (blend) await db.query('DELETE FROM roaster_blend WHERE id = $1', [blend.id]);
      if (coffee) await db.query('DELETE FROM coffees WHERE id = $1', [coffee.id]);
    }
  });
});
