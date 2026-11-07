// Website 10 (OT-96, D14, 2026-11-07): order_fulfillment_status.customer_label
// holds facts only. The seed-upgrade block in schema.sql moves a label only
// while it still equals the previous seed value: run twice, one effect; an
// edited label is never overwritten. Runs against the test DB; every label it
// touches is restored in afterAll.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_10_CLOSEOUT.md
import 'dotenv/config';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, 'schema.sql'), 'utf-8');
const UPGRADE = schema.split('-- seed-upgrade:order_fulfillment_status:begin')[1]?.split('-- seed-upgrade:order_fulfillment_status:end')[0] ?? '';

const EXPECTED: Record<string, string> = {
  awaiting_manual: 'Paid',
  placed: 'Paid · sent to the roastery',
  needs_attention: 'Paid',
  pending: 'Paid',
  shipped: 'On its way',
  delivered: 'Delivered',
};

let saved: Array<{ code: string; customer_label: string }> = [];
const labels = async () => Object.fromEntries((await db.query<{ code: string; customer_label: string }>(
  `SELECT code, customer_label FROM order_fulfillment_status`)).rows.map(r => [r.code, r.customer_label]));

beforeAll(async () => {
  saved = (await db.query(`SELECT code, customer_label FROM order_fulfillment_status`)).rows;
  await db.query(UPGRADE); // the boot's seed step, in case this test DB predates it
});
afterAll(async () => {
  for (const r of saved) await db.query(`UPDATE order_fulfillment_status SET customer_label = $2 WHERE code = $1`, [r.code, r.customer_label]);
  await db.query(UPGRADE);
});

describe('order_fulfillment_status customer labels (OT-96)', () => {
  it('the upgrade block is in schema.sql', () => {
    expect(UPGRADE).toMatch(/UPDATE order_fulfillment_status/);
  });

  it('reads the fact labels', async () => {
    expect(await labels()).toMatchObject(EXPECTED);
  });

  it('no label promises roasting or timing', async () => {
    for (const label of Object.values(await labels())) expect(label).not.toMatch(/roast(ed|ing)|prepar|fresh|week|day/i);
  });

  it('moves a label that still equals the previous seed; a second run changes nothing', async () => {
    await db.query(`UPDATE order_fulfillment_status SET customer_label = 'Paid · being roasted' WHERE code IN ('awaiting_manual', 'placed')`);
    await db.query(`UPDATE order_fulfillment_status SET customer_label = 'Being prepared' WHERE code = 'pending'`);
    const first = await db.query(UPGRADE);
    expect(first.rowCount).toBe(3);
    expect(await labels()).toMatchObject(EXPECTED);
    const second = await db.query(UPGRADE);
    expect(second.rowCount).toBe(0);
  });

  it('never overwrites an edited label', async () => {
    await db.query(`UPDATE order_fulfillment_status SET customer_label = 'Dana wrote this' WHERE code = 'placed'`);
    await db.query(UPGRADE);
    expect((await labels()).placed).toBe('Dana wrote this');
  });
});
