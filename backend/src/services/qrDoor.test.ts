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
import { describe, it, expect } from 'vitest';
import { db } from '../db/client.js';
import { isCoffeeRetired, resolveUniversalToken, hasAnyOrderOrSponsorship, getOrMintCanonicalUniversalToken } from './qrDoor.js';

describe('isCoffeeRetired', () => {
  it('is true once a coffee is inactive, even with an active roaster_blend row', async () => {
    const coffee = (await db.query(
      `INSERT INTO coffees (name, roaster, is_active) VALUES ('Vitest Retired Coffee', 'Vitest Roastery', true) RETURNING id`
    )).rows[0];
    const blend = (await db.query(
      `INSERT INTO roaster_blend (blend_name, coffee_id, weight_oz, is_active) VALUES ('Vitest Retired Blend', $1, 12, true) RETURNING id`,
      [coffee.id]
    )).rows[0];
    try {
      expect(await isCoffeeRetired(coffee.id)).toBe(false);
      await db.query('UPDATE coffees SET is_active = false WHERE id = $1', [coffee.id]);
      expect(await isCoffeeRetired(coffee.id)).toBe(true);
    } finally {
      await db.query('DELETE FROM roaster_blend WHERE id = $1', [blend.id]);
      await db.query('DELETE FROM coffees WHERE id = $1', [coffee.id]);
    }
  });

  it('is also true (secondary signal) for an active coffee with no active roaster_blend row at all', async () => {
    const coffee = (await db.query(
      `INSERT INTO coffees (name, roaster, is_active) VALUES ('Vitest No-Blend Coffee', 'Vitest Roastery', true) RETURNING id`
    )).rows[0];
    try {
      expect(await isCoffeeRetired(coffee.id)).toBe(true);
    } finally {
      await db.query('DELETE FROM coffees WHERE id = $1', [coffee.id]);
    }
  });
});

describe('Universal QR resolve path stays independent of roastery/coffee active state (Decision 5)', () => {
  it('resolveUniversalToken resolves the canonical token, and hasAnyOrderOrSponsorship still sees a profile whose only order line is for an inactive coffee', async () => {
    const canonical = await getOrMintCanonicalUniversalToken();
    expect(await resolveUniversalToken(canonical.token)).toBe('path');

    const coffee = (await db.query(
      `INSERT INTO coffees (name, roaster, is_active) VALUES ('Vitest QR Fixture Coffee', 'Vitest Roastery', false) RETURNING id`
    )).rows[0];
    const blend = (await db.query(
      `INSERT INTO roaster_blend (blend_name, coffee_id, weight_oz, is_active) VALUES ('Vitest QR Fixture Blend', $1, 12, false) RETURNING id`,
      [coffee.id]
    )).rows[0];
    const profile = (await db.query(
      `INSERT INTO user_profile (firebase_uid) VALUES ('vitest-qr-fixture-uid') RETURNING id`
    )).rows[0];
    const order = (await db.query(
      `INSERT INTO "order" (user_id, fulfillment_status) VALUES ($1, 'delivered') RETURNING id`,
      [profile.id]
    )).rows[0];
    const lineItem = (await db.query(
      `INSERT INTO order_line_item (order_id, blend_id) VALUES ($1, $2) RETURNING id`,
      [order.id, blend.id]
    )).rows[0];
    try {
      expect(await hasAnyOrderOrSponsorship(profile.id)).toBe(true);
    } finally {
      await db.query('DELETE FROM order_line_item WHERE id = $1', [lineItem.id]);
      await db.query('DELETE FROM "order" WHERE id = $1', [order.id]);
      await db.query('DELETE FROM user_profile WHERE id = $1', [profile.id]);
      await db.query('DELETE FROM roaster_blend WHERE id = $1', [blend.id]);
      await db.query('DELETE FROM coffees WHERE id = $1', [coffee.id]);
    }
  });
});
