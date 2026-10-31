// Commerce 1, Part D (2026-10-31) — commerce_parameter's one writer and reader,
// against the isolated test DB: the seed, supersede-not-update, the sane range
// and text formats from the note, and the 60 s read cache dropped on a write.
// Supersede checks run inside withRollback; the one committed write (the cache
// test, setParameter opens its own transaction) is undone in `finally` by
// deleting its row and clearing the original's superseded_at (test DB only).
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { db } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import {
  setParameterInTx, setParameter, commerceParam, commerceParamText, getParameters, parseFormat,
  invalidateCommerceParameterCache, CommerceParameterError,
} from './commerceParameters.js';

const SEEDED: Record<string, number | string> = {
  shipping_fee_cents: 595, free_shipping_min_bags: 2, checkout_session_expiry_minutes: 30, tax_collection_enabled: 1,
  stripe_tax_code_coffee: 'txcd_41050006', stripe_tax_code_shipping: 'txcd_92010001', admin_alert_email: 'dana@axisandbloomcoffee.com',
  subscription_discount_pct_1_bag: 5, subscription_discount_pct_2plus_bags: 10, subscription_frequency_weeks: '2,4,6',
  collection_discount_pct: 10, collection_min_members: 3,
};

async function expectInvalid(p: Promise<unknown>, status = 400) {
  await expect(p).rejects.toBeInstanceOf(CommerceParameterError);
  await p.catch(e => expect((e as CommerceParameterError).status).toBe(status));
}

describe('commerce_parameter seed', () => {
  it('every brief key has exactly one current row with its seed value', async () => {
    const rows = await getParameters();
    const byKey = new Map(rows.map(r => [r.key, r]));
    for (const [key, value] of Object.entries(SEEDED)) {
      expect(byKey.get(key)?.value, key).toBe(value);
    }
    const dupes = await db.query(`SELECT key FROM commerce_parameter WHERE superseded_at IS NULL GROUP BY key HAVING count(*) > 1`);
    expect(dupes.rows).toEqual([]);
  });

  it('reads numbers and text through commerceParam / commerceParamText', async () => {
    invalidateCommerceParameterCache();
    expect(await commerceParam('shipping_fee_cents')).toBe(595);
    expect(await commerceParamText('stripe_tax_code_shipping')).toBe('txcd_92010001');
    await expect(commerceParam('admin_alert_email')).rejects.toThrow(/no current numeric value/);
  });
});

describe('setParameterInTx', () => {
  it('supersedes, never updates a value: the old row keeps its value and gets superseded_at', async () => {
    await withRollback(async ({ client }) => {
      const before = (await client.query(`SELECT id, value_numeric FROM commerce_parameter WHERE key = 'shipping_fee_cents' AND superseded_at IS NULL`)).rows[0];
      const r = await setParameterInTx(client, { key: 'shipping_fee_cents', value: 650, note: 'vitest', adminId: 'vitest-admin' });
      expect(r).toMatchObject({ value: 650, previousValue: 595, unchanged: false });
      const old = (await client.query(`SELECT value_numeric, superseded_at FROM commerce_parameter WHERE id = $1`, [before.id])).rows[0];
      expect(Number(old.value_numeric)).toBe(595);
      expect(old.superseded_at).not.toBeNull();
      const cur = (await client.query(`SELECT value_numeric, note FROM commerce_parameter WHERE key = 'shipping_fee_cents' AND superseded_at IS NULL`)).rows;
      expect(cur).toHaveLength(1);
      expect(Number(cur[0].value_numeric)).toBe(650);
      expect(cur[0].note).toMatch(/Range: integer 0 <= value <= 2000\. \| changed \d{4}-\d{2}-\d{2} by vitest-admin: vitest$/);
    });
  });

  it('an unchanged value writes nothing', async () => {
    await withRollback(async ({ client }) => {
      const n = async () => Number((await client.query(`SELECT count(*) FROM commerce_parameter WHERE key = 'free_shipping_min_bags'`)).rows[0].count);
      const before = await n();
      expect((await setParameterInTx(client, { key: 'free_shipping_min_bags', value: 2 })).unchanged).toBe(true);
      expect(await n()).toBe(before);
    });
  });

  it('enforces the sane range in the note (bounds and integer), and refuses unknown keys', async () => {
    await withRollback(async ({ client, savepoint }) => {
      await expectInvalid(savepoint(() => setParameterInTx(client, { key: 'subscription_discount_pct_1_bag', value: 51 })));
      await expectInvalid(savepoint(() => setParameterInTx(client, { key: 'shipping_fee_cents', value: -1 })));
      await expectInvalid(savepoint(() => setParameterInTx(client, { key: 'free_shipping_min_bags', value: 2.5 })));
      await expectInvalid(savepoint(() => setParameterInTx(client, { key: 'checkout_session_expiry_minutes', value: 29 })));
      await expectInvalid(savepoint(() => setParameterInTx(client, { key: 'shipping_fee_cents', value: 'abc' })));
      await expectInvalid(savepoint(() => setParameterInTx(client, { key: 'no_such_key', value: 1 })), 404);
      expect((await setParameterInTx(client, { key: 'subscription_discount_pct_1_bag', value: 50 })).unchanged).toBe(false);
    });
  });

  it('checks text formats: email, stripe tax code, integer list', async () => {
    expect(parseFormat('... Format: email.')).toBe('email');
    await withRollback(async ({ client, savepoint }) => {
      await expectInvalid(savepoint(() => setParameterInTx(client, { key: 'admin_alert_email', value: 'not an email' })));
      await expectInvalid(savepoint(() => setParameterInTx(client, { key: 'stripe_tax_code_coffee', value: 'txcd_123' })));
      await expectInvalid(savepoint(() => setParameterInTx(client, { key: 'subscription_frequency_weeks', value: '2,four' })));
      expect((await setParameterInTx(client, { key: 'admin_alert_email', value: 'orders@axisandbloomcoffee.com' })).value).toBe('orders@axisandbloomcoffee.com');
      expect((await setParameterInTx(client, { key: 'subscription_frequency_weeks', value: '2, 4' })).unchanged).toBe(false);
    });
  });
});

describe('the read cache', () => {
  it('a write through setParameter is visible on the next read, without waiting for the 60 s cache', async () => {
    const KEY = 'subscription_discount_pct_2plus_bags';
    const original = (await db.query(`SELECT id, value_numeric FROM commerce_parameter WHERE key = $1 AND superseded_at IS NULL`, [KEY])).rows[0];
    try {
      invalidateCommerceParameterCache();
      const before = await commerceParam(KEY); // now cached
      await setParameter(KEY, before + 1, 'vitest cache', 'vitest-admin');
      expect(await commerceParam(KEY)).toBe(before + 1);
    } finally {
      await db.query(`DELETE FROM commerce_parameter WHERE key = $1 AND id <> $2`, [KEY, original.id]);
      await db.query(`UPDATE commerce_parameter SET superseded_at = NULL WHERE id = $1`, [original.id]);
      invalidateCommerceParameterCache();
    }
    expect(await commerceParam(KEY)).toBe(Number(original.value_numeric));
  });
});
